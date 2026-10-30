/*
 * The store on the Worker (docs/PHASE5-PLAN.md P5-7, docs/COMPETITIONS.md §18, YOUTH-ACCOUNTS-PLAN §9.5).
 * A redemption and its charge are one batch, decided inside the write: stock, per-person and the spendable
 * balance can't race. Guests browse, and are refused on the server whatever the page shows. Every request
 * still needs an admin to approve or fulfil it. Items moved here from Apps Script once (POST /v1/sync/store-import).
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { randomId } from '../lib/hash.js';
import { activityStmt } from '../lib/activity.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { verifySync, syncStampStmt } from '../lib/sync.js';
import { requireAccount } from '../account/session.js';
import { gate } from '../account/routes.js';
import { eligibility, rulesFrom } from '../account/model.js';
import { memberEmailStmt } from '../notify/member.js';
import { activeSeason, ledgerStmt, HELD_SQL } from '../points/ledger.js';
import { wallOf } from '../comp/model.js';

const NEXT = { pending: ['approved', 'fulfilled', 'cancelled'], approved: ['fulfilled', 'cancelled'], fulfilled: [], cancelled: [] };
const MODES = ['auto', 'open', 'preview', 'closed'];
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const ITEM_ID = /^i-[0-9a-f]{8}$/;
const REDEMPTION_ID = /^r-[0-9a-f]{10}$/;
const LIMITS = { name: 60, description: 500, category: 30, cost: 1000000, stock: 100000, perPerson: 1000 };
const SETTINGS = ['SHOP_MODE', 'SHOP_OPENS_AT', 'SHOP_CLOSES_AT', 'SHOP_ALLOW_CANCEL'];

const invalid = (field, message) => new ApiError('invalid', field, { field, message });
const refuse = (code, message, extra) => new ApiError(code, code, { message, ...(extra || {}) });

async function storeSettings(db) {
  const { results } = await retry(() => db.prepare(`SELECT key, value FROM settings WHERE key IN (${SETTINGS.map(() => '?').join(',')})`).bind(...SETTINGS).all());
  return Object.fromEntries(results.map(r => [r.key, r.value]));
}

/* §18.3: auto: before opensAt = scheduled; after closesAt = closed; else open */
function stateOf(s, wall) {
  const mode = MODES.includes(s.SHOP_MODE) ? s.SHOP_MODE : 'auto';
  if (mode === 'open') return 'open';
  if (mode === 'closed') return 'closed';
  if (mode === 'preview') return 'preview';
  if (s.SHOP_OPENS_AT && wall < s.SHOP_OPENS_AT) return 'scheduled';
  if (s.SHOP_CLOSES_AT && wall >= s.SHOP_CLOSES_AT) return 'closed';
  return 'open';
}

export async function storeOf(db, wall) {
  const s = await storeSettings(db);
  return { state: stateOf(s, wall), opensAt: s.SHOP_OPENS_AT || '', closesAt: s.SHOP_CLOSES_AT || '', allowCancel: s.SHOP_ALLOW_CANCEL === '1' };
}

/*
 * The home page's «نقاطي / المتجر» widget reads points from the build (COMPETITIONS §18.4). Once accounts are on, the
 * store's schedule and the season are the Worker's, so they replace what Apps Script put there. Off: unchanged.
 */
export async function runtimePoints(db, points) {
  const on = await retry(() => db.prepare("SELECT value FROM settings WHERE key = 'accounts_mode'").first('value'));
  if (on !== 'on') return points;
  const s = await storeSettings(db);
  const season = await activeSeason(db);
  const mode = MODES.includes(s.SHOP_MODE) ? s.SHOP_MODE : 'auto';
  return {
    url: 'points/',
    shop: { on: true, mode, preview: mode === 'preview', opensAt: s.SHOP_OPENS_AT || '', closesAt: s.SHOP_CLOSES_AT || '' },
    season: season ? { name: season.name, startAt: season.start_at || '', endAt: season.end_at || '' } : null
  };
}

const parseImage = text => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/* the prizes as a member sees them */
export async function shopForMember(db, participantId) {
  const [items, taken, mine] = await retry(() => db.batch([
    db.prepare('SELECT * FROM store_items WHERE active = 1 ORDER BY ord, created_ms'),
    db.prepare("SELECT item_id, COUNT(*) AS n FROM redemptions WHERE status <> 'cancelled' GROUP BY item_id"),
    db.prepare("SELECT item_id, COUNT(*) AS n FROM redemptions WHERE status <> 'cancelled' AND participant_id = ? GROUP BY item_id").bind(participantId)
  ]));
  const count = (rows, id) => (rows.results.find(r => r.item_id === id) || { n: 0 }).n;
  return items.results.map(i => ({
    id: i.id, name: i.name, description: i.description, image: parseImage(i.image), cost: i.cost, category: i.category,
    available: i.stock === null ? null : Math.max(0, i.stock - count(taken, i.id)),
    perPersonLeft: i.per_person === null ? null : Math.max(0, i.per_person - count(mine, i.id))
  }));
}

/* one person's requests; canCancel per §18.3 */
export async function redemptionsOf(db, participantId, season, settings, wall) {
  const store = await storeOf(db, wall);
  const rows = (await retry(() => db.prepare('SELECT * FROM redemptions WHERE participant_id = ? ORDER BY created_ms DESC LIMIT 200').bind(participantId).all())).results;
  return rows.map(r => ({
    id: r.id, itemName: r.item_name, cost: r.cost, status: r.status, requestedAt: wallOf(r.created_ms),
    canCancel: store.allowCancel && store.state === 'open' && r.status === 'pending' && !!season && r.season_id === season.id
  }));
}

/* POST /v1/shop/redeem { itemId, requestKey } → { redemption, balance }; the same key = the same request */
export async function shopRedeem(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  const body = ctx.body || {};
  if (!ITEM_ID.test(String(body.itemId)) || !KEY.test(String(body.requestKey))) throw new ApiError('bad', 'shape');
  await limit(ctx, 'shop.redeem', account.id, 30, 60);
  const db = ctx.env.DB;
  const now = Date.now();
  const balanceNow = async seasonId => retry(() => db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger l WHERE l.participant_id = ? AND l.season_id = ? AND ${HELD_SQL}`).bind(account.id, seasonId).first('n'));
  const twin = await retry(() => db.prepare('SELECT * FROM redemptions WHERE request_key = ?').bind(body.requestKey).first());
  if (twin) {
    if (twin.participant_id !== account.id) throw new ApiError('bad', 'key');
    return { redemption: { id: twin.id, status: twin.status, itemName: twin.item_name, cost: twin.cost }, balance: await balanceNow(twin.season_id) };
  }
  if (eligibility(account, rulesFrom(settings), now).state !== 'eligible') throw refuse('not_eligible', 'حسابك خارج النطاق العمري للخدمة، فالطلب مقفول.');
  const store = await storeOf(db, wallOf(now));
  if (store.state !== 'open') throw refuse('shop_closed', 'المتجر مقفول دلوقتي.');
  const item = await retry(() => db.prepare('SELECT * FROM store_items WHERE id = ? AND active = 1').bind(body.itemId).first());
  if (!item) throw refuse('not_found', 'الجايزة دي مش متاحة دلوقتي.');
  const season = await activeSeason(db);
  if (!season) throw refuse('shop_closed', 'المتجر مقفول دلوقتي.');
  const id = randomId('r-', 5);
  const ledgerId = randomId('led-', 8);
  const made = 'EXISTS (SELECT 1 FROM redemptions WHERE id = ?)';
  const r = await retry(() => db.batch([
    db.prepare(`INSERT INTO redemptions (id, item_id, item_name, participant_id, season_id, cost, status, request_key, elig, created_ms, updated_ms)
      SELECT ?, ?, ?, ?, ?, ?, 'pending', ?, 'eligible', ?, ?
      WHERE (? IS NULL OR (SELECT COUNT(*) FROM redemptions WHERE item_id = ? AND status <> 'cancelled') < ?)
        AND (? IS NULL OR (SELECT COUNT(*) FROM redemptions WHERE item_id = ? AND participant_id = ? AND status <> 'cancelled') < ?)
        AND (SELECT COALESCE(SUM(amount), 0) FROM points_ledger l WHERE l.participant_id = ? AND l.season_id = ? AND ${HELD_SQL}) >= ?
      ON CONFLICT(request_key) DO NOTHING`).bind(
      id, item.id, item.name, account.id, season.id, item.cost, body.requestKey, now, now,
      item.stock, item.id, item.stock, item.per_person, item.id, account.id, item.per_person, account.id, season.id, item.cost),
    ledgerStmt(db, { id: ledgerId, participantId: account.id, seasonId: season.id, amount: -item.cost, kind: 'spend', ref: 'red:' + id, idemKey: 'red:' + id, actor: 'account', now, force: true, guard: made, guardBinds: [id] }),
    memberEmailStmt(db, { kind: 'store.requested', participantId: account.id, entityType: 'redemption', entityId: id, dedupeKey: 'store:req:' + id, now, guard: made, guardBinds: [id] }),
    db.prepare(`INSERT INTO activity (id, at, cairo, actor, action, entity_type, entity_id, entity_title, summary)
      SELECT ?, ?, ?, 'account', 'redemption.status', 'redemption', ?, ?, 'طلب جديد من المتجر' WHERE ${made}`).bind(randomId('act-'), now, wallOf(now).replace('T', ' '), id, item.name, id)
  ]));
  if (r[0].meta.changes === 1) return { redemption: { id, status: 'pending', itemName: item.name, cost: item.cost }, balance: await balanceNow(season.id) };

  // refused inside the write: say why, the same reasons in the same order
  const twinAfter = await retry(() => db.prepare('SELECT * FROM redemptions WHERE request_key = ?').bind(body.requestKey).first());
  if (twinAfter) return { redemption: { id: twinAfter.id, status: twinAfter.status, itemName: twinAfter.item_name, cost: twinAfter.cost }, balance: await balanceNow(season.id) };
  const [taken, mine] = await retry(() => db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM redemptions WHERE item_id = ? AND status <> 'cancelled'").bind(item.id),
    db.prepare("SELECT COUNT(*) AS n FROM redemptions WHERE item_id = ? AND participant_id = ? AND status <> 'cancelled'").bind(item.id, account.id)
  ]));
  if (item.stock !== null && taken.results[0].n >= item.stock) throw refuse('stock', 'الجايزة دي خلصت.');
  if (item.per_person !== null && mine.results[0].n >= item.per_person) throw refuse('per_person', 'وصلت للحد المسموح من الجايزة دي.');
  throw refuse('insufficient', 'رصيدك مش كفاية.', { balance: await balanceNow(season.id) });
}

/* POST /v1/shop/cancel { redemptionId }: own, pending, store open, allowed, the active season; a refund once */
export async function shopCancel(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  const id = String((ctx.body || {}).redemptionId || '');
  if (!REDEMPTION_ID.test(id)) throw new ApiError('bad', 'shape');
  const db = ctx.env.DB;
  const now = Date.now();
  const row = await retry(() => db.prepare('SELECT * FROM redemptions WHERE id = ? AND participant_id = ?').bind(id, account.id).first());
  if (!row) throw refuse('not_found', 'الطلب ده مش موجود.');
  if (eligibility(account, rulesFrom(settings), now).state !== 'eligible') throw refuse('not_eligible', 'حسابك خارج النطاق العمري للخدمة، فالطلب مقفول.');
  const store = await storeOf(db, wallOf(now));
  if (store.state !== 'open') throw refuse('shop_closed', 'المتجر مقفول دلوقتي.');
  const season = await activeSeason(db);
  if (!store.allowCancel || row.status !== 'pending' || !season || row.season_id !== season.id) throw refuse('not_allowed', 'الطلب ده مينفعش يتلغي دلوقتي.');
  const done = "EXISTS (SELECT 1 FROM redemptions WHERE id = ? AND status = 'cancelled')";
  const r = await retry(() => db.batch([
    db.prepare("UPDATE redemptions SET status = 'cancelled', note = 'لغاه المشترك', updated_ms = ? WHERE id = ? AND status = 'pending'").bind(now, id),
    ledgerStmt(db, { participantId: account.id, seasonId: row.season_id, amount: row.cost, kind: 'refund', ref: 'ref:' + id, idemKey: 'ref:' + id, actor: 'account', now, guard: done, guardBinds: [id] })
  ]));
  if (r[0].meta.changes !== 1) throw refuse('not_allowed', 'الطلب ده مينفعش يتلغي دلوقتي.');
  const balance = await retry(() => db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger l WHERE l.participant_id = ? AND l.season_id = ? AND ${HELD_SQL}`).bind(account.id, row.season_id).first('n'));
  return { redemption: { id, status: 'cancelled', itemName: row.item_name, cost: row.cost }, balance };
}

/* ---------- admin ---------- */

const adminItem = (i, counts) => ({
  id: i.id, name: i.name, description: i.description, image: parseImage(i.image), cost: i.cost, stock: i.stock, perPerson: i.per_person, category: i.category, order: i.ord, active: !!i.active,
  redeemed: (counts.find(c => c.item_id === i.id) || { n: 0 }).n, pending: (counts.find(c => c.item_id === i.id) || { p: 0 }).p,
  available: i.stock === null ? null : Math.max(0, i.stock - (counts.find(c => c.item_id === i.id) || { n: 0 }).n)
});

/* GET /v1/admin/store/items */
export async function adminStoreItems(ctx) {
  const db = ctx.env.DB;
  const [items, counts] = await retry(() => db.batch([
    db.prepare('SELECT * FROM store_items ORDER BY ord, created_ms'),
    db.prepare("SELECT item_id, SUM(status <> 'cancelled') AS n, SUM(status = 'pending') AS p FROM redemptions GROUP BY item_id")
  ]));
  return { items: items.results.map(i => adminItem(i, counts.results)) };
}

function itemFields(body) {
  const name = String(body.name == null ? '' : body.name).trim();
  if (!name) throw invalid('name', 'اكتب اسم الجايزة.');
  if (name.length > LIMITS.name) throw invalid('name', 'الاسم طويل زيادة.');
  const description = String(body.description == null ? '' : body.description).trim();
  if (description.length > LIMITS.description) throw invalid('description', 'الوصف طويل زيادة.');
  const cost = Number(body.cost);
  if (!Number.isInteger(cost) || cost < 1 || cost > LIMITS.cost) throw invalid('cost', 'النقاط لازم تكون رقم صحيح أكبر من صفر.');
  const whole = (v, field, max) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) throw invalid(field, 'الرقم مش صح.');
    return n;
  };
  const image = body.image && typeof body.image === 'object' ? JSON.stringify(body.image).slice(0, 4000) : null;
  return { name, description, cost, stock: whole(body.stock, 'stock', LIMITS.stock), perPerson: whole(body.perPerson, 'perPerson', LIMITS.perPerson), category: String(body.category == null ? '' : body.category).trim().slice(0, LIMITS.category), order: Number(body.order) || 0, active: body.active !== false, image };
}

/* POST /v1/admin/store/items { id?, name, description, cost, stock, perPerson, category, order, active, image } */
export async function adminStoreItemSave(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const f = itemFields(body);
  const now = Date.now();
  const id = body.id ? String(body.id) : randomId('i-', 4);
  if (body.id && !ITEM_ID.test(id)) throw new ApiError('not_found', 'item');
  await retry(() => db.batch([
    db.prepare(`INSERT INTO store_items (id, name, description, image, cost, stock, per_person, category, ord, active, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, image = excluded.image, cost = excluded.cost, stock = excluded.stock, per_person = excluded.per_person,
        category = excluded.category, ord = excluded.ord, active = excluded.active, updated_ms = excluded.updated_ms`)
      .bind(id, f.name, f.description, f.image, f.cost, f.stock, f.perPerson, f.category, f.order, f.active ? 1 : 0, now, now),
    activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: body.id ? 'update' : 'create', entityType: 'shopitem', entityId: id, entityTitle: f.name, summary: 'جايزة في المتجر' })
  ]));
  return adminStoreItems(ctx);
}

/* POST /v1/admin/store/items/:id/delete: an item with requests stays, switched off (its history needs it) */
export async function adminStoreItemDelete(ctx) {
  const db = ctx.env.DB;
  const id = String(ctx.params.id);
  if (!ITEM_ID.test(id)) throw new ApiError('not_found', 'item');
  const used = await retry(() => db.prepare('SELECT COUNT(*) AS n FROM redemptions WHERE item_id = ?').bind(id).first('n'));
  const now = Date.now();
  await retry(() => db.batch([
    used ? db.prepare('UPDATE store_items SET active = 0, updated_ms = ? WHERE id = ?').bind(now, id) : db.prepare('DELETE FROM store_items WHERE id = ?').bind(id),
    activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'delete', entityType: 'shopitem', entityId: id, summary: used ? 'اتقفلت (عليها طلبات)' : 'اتمسحت' })
  ]));
  return { ...(await adminStoreItems(ctx)), kept: !!used };
}

/* GET /v1/admin/store/redemptions?status=&offset= */
export async function adminRedemptions(ctx) {
  const db = ctx.env.DB;
  const status = ctx.url.searchParams.get('status') || '';
  const offset = Math.max(0, Number(ctx.url.searchParams.get('offset')) || 0);
  const where = NEXT[status] ? 'WHERE r.status = ?' : '';
  const rows = (await retry(() => db.prepare(`SELECT r.*, p.name AS person, p.phone,
      (SELECT MAX(a.at) FROM participant_audit a WHERE a.participant_id = r.participant_id AND a.action = 'email.change') AS email_changed
    FROM redemptions r LEFT JOIN participants p ON p.id = r.participant_id ${where} ORDER BY r.created_ms DESC LIMIT 100 OFFSET ?`).bind(...(where ? [status] : []), offset).all())).results;
  const now = Date.now();
  return {
    redemptions: rows.map(r => ({
      id: r.id, itemId: r.item_id, itemName: r.item_name, cost: r.cost, status: r.status, participantId: r.participant_id, person: r.person || '', phone: r.phone || '', note: r.note || '', requestedAt: r.created_ms,
      // §11: an email changed lately on the person asking: a reason to look twice
      emailChangedRecently: !!(r.email_changed && now - r.email_changed < 7 * 86400000), next: NEXT[r.status] || []
    }))
  };
}

/* POST /v1/admin/store/redemptions/:id/status { status, note } → approve, fulfil, or cancel + refund once */
export async function adminRedemptionStatus(ctx) {
  const db = ctx.env.DB;
  const id = String(ctx.params.id);
  const body = ctx.body || {};
  if (!REDEMPTION_ID.test(id)) throw new ApiError('not_found', 'redemption');
  const row = await retry(() => db.prepare('SELECT * FROM redemptions WHERE id = ?').bind(id).first());
  if (!row) throw new ApiError('not_found', 'redemption');
  const status = String(body.status || '');
  if (!(NEXT[row.status] || []).includes(status)) throw new ApiError('final', row.status);
  const note = String(body.note == null ? '' : body.note).trim().slice(0, 200) || null;
  const season = await activeSeason(db);
  if (status === 'cancelled' && (!season || season.id !== row.season_id)) throw new ApiError('final', 'closed season');
  const now = Date.now();
  const moved = 'EXISTS (SELECT 1 FROM redemptions WHERE id = ? AND status = ? AND updated_ms = ?)';
  const r = await retry(() => db.batch([
    db.prepare('UPDATE redemptions SET status = ?, note = COALESCE(?, note), decided_by = ?, updated_ms = ? WHERE id = ? AND status = ?').bind(status, note, ctx.actor.email, now, id, row.status),
    ...(status === 'cancelled' ? [
      ledgerStmt(db, { participantId: row.participant_id, seasonId: row.season_id, amount: row.cost, kind: 'refund', ref: 'ref:' + id, idemKey: 'ref:' + id, actor: ctx.actor.email, now, guard: moved, guardBinds: [id, status, now] }),
      memberEmailStmt(db, { kind: 'store.cancelled', participantId: row.participant_id, entityType: 'redemption', entityId: id, dedupeKey: 'store:cancel:' + id, now, guard: moved, guardBinds: [id, status, now] })
    ] : []),
    ...(status === 'approved' ? [memberEmailStmt(db, { kind: 'store.approved', participantId: row.participant_id, entityType: 'redemption', entityId: id, dedupeKey: 'store:ok:' + id, now, guard: moved, guardBinds: [id, status, now] })] : []),
    activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'redemption.status', entityType: 'redemption', entityId: id, entityTitle: row.item_name, summary: status })
  ]));
  if (r[0].meta.changes !== 1) throw new ApiError('final', 'moved');
  return adminRedemptions(ctx);
}

/* GET + POST /v1/admin/store/schedule */
export async function adminStoreSchedule(ctx) {
  return storeOf(ctx.env.DB, wallOf(Date.now())).then(async store => ({ ...store, mode: (await storeSettings(ctx.env.DB)).SHOP_MODE || 'auto' }));
}

export async function adminStoreScheduleSave(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  if (!MODES.includes(body.mode)) throw invalid('mode', 'اختار حالة المتجر.');
  const stamp = (v, field) => {
    const text = String(v == null ? '' : v);
    if (text && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) throw invalid(field, 'التاريخ مش صح.');
    return text;
  };
  const opens = stamp(body.opensAt, 'opensAt');
  const closes = stamp(body.closesAt, 'closesAt');
  if (opens && closes && opens >= closes) throw invalid('closesAt', 'ميعاد القفل لازم يكون بعد الفتح.');
  const now = Date.now();
  const set = (key, value) => db.prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by').bind(key, value, now, ctx.actor.email);
  await retry(() => db.batch([
    set('SHOP_MODE', body.mode), set('SHOP_OPENS_AT', opens), set('SHOP_CLOSES_AT', closes), set('SHOP_ALLOW_CANCEL', body.allowCancel === true ? '1' : ''),
    activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'settings', entityType: 'shopitem', entityId: 'schedule', summary: 'مواعيد المتجر' })
  ]));
  return adminStoreSchedule(ctx);
}

/* POST /v1/sync/store-import (signed, Apps Script, once at the move): the prizes; rows already here are left alone */
export async function syncStoreImport(ctx) {
  await limit(ctx, 'sync.store', clientIp(ctx.request), 30, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { body, ts } = await verifySync(ctx.env, ctx.request, raw, 'store-import');
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length > 500) throw new ApiError('bad', 'too many');
  const db = ctx.env.DB;
  const now = Date.now();
  const stmts = items.map(i => {
    if (!i || !ITEM_ID.test(String(i.id))) throw new ApiError('bad', 'item');
    const f = itemFields(i);
    return db.prepare('INSERT OR IGNORE INTO store_items (id, name, description, image, cost, stock, per_person, category, ord, active, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(i.id, f.name, f.description, f.image, f.cost, f.stock, f.perPerson, f.category, f.order, f.active ? 1 : 0, now, now);
  });
  await retry(() => db.batch([...stmts, syncStampStmt(db, 'store-import', ts)]));
  return { imported: items.length };
}
