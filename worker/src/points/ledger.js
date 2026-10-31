/*
 * Points (docs/PHASE5-PLAN.md P5-6, YOUTH-ACCOUNTS-PLAN §9.4): the append-only ledger and seasons.
 * The balance is the active season's sum; nothing stores it. «متجمد» is derived: guest AND balance > 0,
 * so no row is written when someone ages out and nothing needs undoing if they come back in range.
 * Earning from competitions and spending in the store arrive with P5-7, P5-8, on these same functions.
 */

import { ApiError } from '../lib/http.js';
import { retry, cairoText } from '../lib/db.js';
import { randomId, sha256 } from '../lib/hash.js';
import { activityStmt } from '../lib/activity.js';
import { limit } from '../lib/ratelimit.js';
import { memberEmailStmt } from '../notify/member.js';
import { eligibility, rulesFrom } from '../account/model.js';

export const MAX_ADJUST = 1000000;
const NOTE_MAX = 200;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const SEASON_ID = /^sea-[a-z0-9-]{3,40}$/;
const PID = /^p-[a-z2-7]{8}$/;
const invalid = (field, message) => new ApiError('invalid', field, { field, message });

export const activeSeason = db => retry(() => db.prepare("SELECT * FROM seasons WHERE status = 'active'").first());

export async function balanceOf(db, participantId, seasonId) {
  return retry(() => db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger WHERE participant_id = ? AND season_id = ?').bind(participantId, seasonId).first('n'));
}

/* COMPETITIONS §20.2: a row a member may count: not a credit still held back. Alias the ledger as l. */
export const HELD_SQL = "NOT EXISTS (SELECT 1 FROM submissions s WHERE 'sub:' || s.id = l.ref AND s.released_ms IS NULL)";
export const visibleBalance = rows => rows.reduce((n, l) => n + l.amount, 0);

/*
 * One ledger row, written only when the balance stays at or above zero (decided inside the write).
 * force: a correction may go below zero (points already spent: the balance tells the truth).
 * guard: an extra condition, for a row that depends on the rest of its batch.
 */
export function ledgerStmt(db, { id = randomId('led-', 8), participantId, seasonId, amount, kind, note = null, notePublic = false, ref = null, compId = null, idemKey, actor, now = Date.now(), force = false, guard = '', guardBinds = [] }) {
  return db.prepare(`INSERT INTO points_ledger (id, participant_id, season_id, amount, kind, note, note_public, ref, comp_id, idem_key, actor, created_ms)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (? >= 0 OR (SELECT COALESCE(SUM(amount), 0) FROM points_ledger WHERE participant_id = ? AND season_id = ?) + ? >= 0)${guard ? ' AND ' + guard : ''}
    ON CONFLICT(idem_key) DO NOTHING`).bind(id, participantId, seasonId, amount, kind, note, notePublic ? 1 : 0, ref, compId, idemKey, actor, now, force ? 0 : amount, participantId, seasonId, amount, ...guardBinds);
}

const entryView = (l, admin) => ({
  id: l.id, amount: l.amount, kind: l.kind, at: l.created_ms,
  note: admin || l.note_public ? l.note : null,
  ...(admin ? { notePublic: !!l.note_public, actor: l.actor, ref: l.ref } : {})
});

/* the person sheet's part (account/admin.js) */
export async function pointsOf(db, participantId, frozenFrom) {
  const season = await activeSeason(db);
  const [rows, totals] = await retry(() => db.batch([
    db.prepare('SELECT * FROM points_ledger WHERE participant_id = ? AND season_id = ? ORDER BY created_ms DESC, id DESC LIMIT 200').bind(participantId, season ? season.id : ''),
    db.prepare('SELECT t.season_id, s.name, t.earned, t.spent, t.adjusted, t.final, t.closed_ms FROM season_totals t JOIN seasons s ON s.id = t.season_id WHERE t.participant_id = ? ORDER BY t.closed_ms DESC').bind(participantId)
  ]));
  const balance = season ? await balanceOf(db, participantId, season.id) : 0;
  return {
    season: season ? { id: season.id, name: season.name } : null,
    balance, frozen: frozenFrom === 'guest' && balance > 0,
    ledger: rows.results.map(l => entryView(l, true)),
    seasons: totals.results.map(t => ({ id: t.season_id, name: t.name, earned: t.earned, spent: t.spent, adjusted: t.adjusted, final: t.final, closedAt: t.closed_ms }))
  };
}

/* GET /v1/account/points: «نقاطي» for the signed-in account; the notes it may read, and no one else's */
const compTitle = meta => {
  try {
    const m = meta ? JSON.parse(meta) : null;
    return m ? m.shortTitle || m.title || '' : '';
  } catch {
    return '';
  }
};

export async function memberPoints(ctx, account, settings) {
  const db = ctx.env.DB;
  const state = eligibility(account, rulesFrom(settings)).state;
  const p = await pointsOf(db, account.id, state);
  const rows = (await retry(() => db.prepare(`SELECT l.*,
      (SELECT v.meta FROM comp_versions v WHERE v.comp_id = l.comp_id ORDER BY v.version DESC LIMIT 1) AS comp_meta,
      (SELECT r.item_name FROM redemptions r WHERE r.id = substr(l.ref, 5) AND substr(l.ref, 1, 4) IN ('red:', 'ref:')) AS item_name
    FROM points_ledger l WHERE l.participant_id = ? AND l.season_id = ? AND ${HELD_SQL} ORDER BY l.created_ms DESC, l.id DESC LIMIT 100`).bind(account.id, p.season ? p.season.id : '').all())).results;
  const balance = p.season ? await retry(() => db.prepare(`SELECT COALESCE(SUM(l.amount), 0) AS n FROM points_ledger l WHERE l.participant_id = ? AND l.season_id = ? AND ${HELD_SQL}`).bind(account.id, p.season.id).first('n')) : 0;
  return { season: p.season, balance, frozen: state === 'guest' && balance > 0, eligible: state === 'eligible', ledger: rows.map(l => ({ ...entryView(l, false), title: l.item_name || compTitle(l.comp_meta) })), seasons: p.seasons.map(s => ({ name: s.name, earned: s.earned, spent: s.spent, final: s.final })) };
}

function adjustInput(body) {
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > MAX_ADJUST) throw invalid('amount', 'عدد النقاط لازم يكون رقم صحيح مش صفر (لحد مليون).');
  const note = String(body.note == null ? '' : body.note).trim();
  if (!note) throw invalid('note', 'اكتب سبب التعديل.');
  if (note.length > NOTE_MAX) throw invalid('note', 'السبب أطول من ٢٠٠ حرف.');
  const key = String(body.key || '');
  if (!KEY.test(key)) throw new ApiError('bad', 'key');
  return { amount, note, key };
}

/*
 * POST /v1/admin/participants/:id/points { amount, note, notePublic, key } (points.edit)
 * A manual row. Refused when it would take the balance below zero; the same key = the same row.
 */
export async function adminPointsAdjust(ctx) {
  const db = ctx.env.DB;
  const id = String(ctx.params.id);
  if (!PID.test(id)) throw new ApiError('not_found', 'id');
  const p = await retry(() => db.prepare('SELECT id FROM participants WHERE id = ?').bind(id).first());
  if (!p) throw new ApiError('not_found', 'participant');
  const { amount, note, key } = adjustInput(ctx.body || {});
  const season = await activeSeason(db);
  if (!season) throw new ApiError('final', 'no active season');
  const idemKey = 'adj:' + id + ':' + key;
  const entry = randomId('led-', 8);
  const now = Date.now();
  const made = 'EXISTS (SELECT 1 FROM points_ledger WHERE id = ?)';
  const r = await retry(() => db.batch([
    ledgerStmt(db, { id: entry, participantId: id, seasonId: season.id, amount, kind: 'manual', note, notePublic: ctx.body.notePublic === true, idemKey, actor: ctx.actor.email, now }),
    db.prepare(`INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, summary, changes)
      SELECT ?, ?, ?, ?, ?, 'points.adjust', 'points', ?, 'عدّل نقاط مشترك', ? WHERE ${made}`).bind(randomId('act-'), now, cairoText(now), ctx.actor.email, ctx.actor.name || null, id, JSON.stringify({ amount }), entry),
    // a deduction is told to the member (§4.4); additions are not
    ...(amount < 0 ? [memberEmailStmt(db, { kind: 'pts.deduct', participantId: id, entityType: 'ledger', entityId: entry, dedupeKey: 'pts:deduct:' + entry, now, guard: made, guardBinds: [entry] })] : [])
  ]));
  const balance = await balanceOf(db, id, season.id);
  if (r[0].meta.changes !== 1) {
    const twin = await retry(() => db.prepare('SELECT id, amount FROM points_ledger WHERE idem_key = ?').bind(idemKey).first());
    if (twin) {
      if (twin.amount !== amount) throw new ApiError('conflict', 'key');
      return { entry: twin.id, balance, replay: true };
    }
    throw invalid('amount', 'مينفعش الرصيد يبقى بالسالب: رصيده دلوقتي ' + balance + ' نقطة.');
  }
  return { entry, balance, replay: false };
}

/*
 * POST /v1/admin/participants/:id/transfer { to, amount, note, key } (points.approve)
 * A duplicate person's points move to the real account (§12.2): two rows, one batch, both or neither.
 */
export async function adminPointsTransfer(ctx) {
  const db = ctx.env.DB;
  const from = String(ctx.params.id);
  const to = String((ctx.body || {}).to || '');
  if (!PID.test(from) || !PID.test(to) || from === to) throw invalid('to', 'اختار حساب تاني صح.');
  const found = await retry(() => db.prepare('SELECT id FROM participants WHERE id IN (?, ?)').bind(from, to).all());
  if (found.results.length !== 2) throw new ApiError('not_found', 'participant');
  const { amount, note, key } = adjustInput(ctx.body);
  if (amount <= 0) throw invalid('amount', 'اكتب عدد النقاط اللي هتتنقل.');
  const season = await activeSeason(db);
  if (!season) throw new ApiError('final', 'no active season');
  const now = Date.now();
  const out = randomId('led-', 8);
  const inId = randomId('led-', 8);
  const made = 'EXISTS (SELECT 1 FROM points_ledger WHERE id = ?)';
  const r = await retry(() => db.batch([
    ledgerStmt(db, { id: out, participantId: from, seasonId: season.id, amount: -amount, kind: 'transfer', note, ref: to, idemKey: 'trn:out:' + key, actor: ctx.actor.email, now }),
    db.prepare(`INSERT INTO points_ledger (id, participant_id, season_id, amount, kind, note, ref, idem_key, actor, created_ms)
      SELECT ?, ?, ?, ?, 'transfer', ?, ?, ?, ?, ? WHERE ${made}`).bind(inId, to, season.id, amount, note, from, 'trn:in:' + key, ctx.actor.email, now, out),
    db.prepare(`INSERT INTO participant_audit (id, participant_id, at, actor, action, new_value, reason) SELECT ?, ?, ?, ?, 'transfer', ?, ? WHERE ${made}`).bind(randomId('pa-', 8), from, now, ctx.actor.email, String(amount) + ' → ' + to, note, out),
    db.prepare(`INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, summary, changes)
      SELECT ?, ?, ?, ?, ?, 'points.adjust', 'points', ?, 'نقل نقاط بين حسابين', ? WHERE ${made}`).bind(randomId('act-'), now, cairoText(now), ctx.actor.email, ctx.actor.name || null, from, JSON.stringify({ amount, transfer: true }), out)
  ]));
  if (r[0].meta.changes !== 1) {
    const twin = await retry(() => db.prepare('SELECT id FROM points_ledger WHERE idem_key = ?').bind('trn:out:' + key).first());
    if (twin) return { replay: true, balance: await balanceOf(db, from, season.id) };
    throw invalid('amount', 'الرصيد مش كفاية.');
  }
  return { replay: false, balance: await balanceOf(db, from, season.id) };
}

/* ---------- seasons ---------- */

const seasonView = s => ({ id: s.id, name: s.name, startAt: s.start_at || '', endAt: s.end_at || '', status: s.status, closedAt: s.closed_ms || null, closedBy: s.closed_by || '' });

/* GET /v1/admin/points/seasons */
export async function adminSeasons(ctx) {
  const db = ctx.env.DB;
  const rows = (await retry(() => db.prepare("SELECT * FROM seasons ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, updated_ms DESC").all())).results;
  return { seasons: rows.map(seasonView) };
}

const seasonFields = body => {
  const name = String(body.name == null ? '' : body.name).trim().slice(0, 80);
  if (name.length < 2) throw invalid('name', 'اكتب اسم الموسم.');
  const stamp = v => {
    const text = String(v == null ? '' : v);
    if (text && !/^\d{4}-\d{2}-\d{2}/.test(text)) throw invalid('date', 'التاريخ مش صح.');
    return text.slice(0, 16) || null;
  };
  return { name, startAt: stamp(body.startAt), endAt: stamp(body.endAt) };
};

/* POST /v1/admin/points/seasons { id?, name, startAt, endAt }: a new planned season, or edit one not closed */
export async function adminSeasonSave(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const f = seasonFields(body);
  const now = Date.now();
  if (body.id) {
    if (!SEASON_ID.test(String(body.id))) throw new ApiError('not_found', 'id');
    const r = await retry(() => db.prepare("UPDATE seasons SET name = ?, start_at = ?, end_at = ?, updated_ms = ? WHERE id = ? AND status <> 'closed'").bind(f.name, f.startAt, f.endAt, now, body.id).run());
    if (r.meta.changes !== 1) throw new ApiError('final', 'season');
  } else {
    await retry(() => db.prepare("INSERT INTO seasons (id, name, start_at, end_at, status, created_ms, updated_ms) VALUES (?, ?, ?, ?, 'planned', ?, ?)").bind(randomId('sea-', 4), f.name, f.startAt, f.endAt, now, now).run());
  }
  return adminSeasons(ctx);
}

async function totalsOf(db, seasonId) {
  const rows = (await retry(() => db.prepare(`SELECT participant_id,
      COALESCE(SUM(CASE WHEN kind IN ('earn', 'competition', 'correction') THEN amount END), 0) AS earned,
      COALESCE(SUM(CASE WHEN kind IN ('spend', 'refund') THEN amount END), 0) AS spent,
      COALESCE(SUM(CASE WHEN kind IN ('manual', 'transfer') THEN amount END), 0) AS adjusted,
      SUM(amount) AS final
    FROM points_ledger WHERE season_id = ? GROUP BY participant_id`).bind(seasonId).all())).results;
  const key = await sha256(seasonId + '|' + rows.map(r => r.participant_id + ':' + r.final).sort().join(','));
  return { rows, key };
}

/* GET /v1/admin/points/seasons/:id/preview: what closing would freeze; its key proves the numbers didn't move */
export async function adminSeasonPreview(ctx) {
  const db = ctx.env.DB;
  const id = String(ctx.params.id);
  const season = SEASON_ID.test(id) ? await retry(() => db.prepare('SELECT * FROM seasons WHERE id = ?').bind(id).first()) : null;
  if (!season) throw new ApiError('not_found', 'season');
  const { rows, key } = await totalsOf(db, id);
  const settings = Object.fromEntries((await retry(() => db.prepare("SELECT key, value FROM settings WHERE key IN ('age_min', 'age_max', 'age_warn_days')").all())).results.map(r => [r.key, r.value]));
  const rules = rulesFrom(settings);
  const people = rows.length ? (await retry(() => db.prepare('SELECT DISTINCT p.id, p.birth_date, p.status, p.eligibility_override FROM participants p JOIN points_ledger l ON l.participant_id = p.id WHERE l.season_id = ?').bind(id).all())).results : [];
  const guests = new Set(people.filter(p => eligibility(p, rules).state === 'guest').map(p => p.id));
  const frozen = rows.filter(r => guests.has(r.participant_id) && r.final > 0);
  return { season: seasonView(season), participants: rows.length, total: rows.reduce((n, r) => n + r.final, 0), frozen: { participants: frozen.length, total: frozen.reduce((n, r) => n + r.final, 0) }, key };
}

/*
 * POST /v1/admin/points/seasons/:id/close { key, next: id | { name, startAt, endAt } } (points.approve)
 * Totals frozen, the season closed, the next one active: one batch. Everyone starts the next at 0.
 */
export async function adminSeasonClose(ctx) {
  const db = ctx.env.DB;
  const id = String(ctx.params.id);
  const body = ctx.body || {};
  await limit(ctx, 'points.season', ctx.actor.email, 10, 60);
  const season = SEASON_ID.test(id) ? await retry(() => db.prepare('SELECT * FROM seasons WHERE id = ?').bind(id).first()) : null;
  if (!season) throw new ApiError('not_found', 'season');
  if (season.status !== 'active') throw new ApiError('final', season.status);
  // §18.6: an open request's refund must still have a season to land in
  const open = await retry(() => db.prepare("SELECT COUNT(*) AS n FROM redemptions WHERE season_id = ? AND status IN ('pending', 'approved')").bind(id).first('n'));
  if (open) throw new ApiError('final', 'open requests', { message: 'لازم تخلّص طلبات الجوايز اللي في الموسم ده الأول.', hint: 'سلّمها أو الغيها (النقاط هترجع في نفس الموسم)، وبعدين اقفله.', openRequests: open });
  const { rows, key } = await totalsOf(db, id);
  if (String(body.key || '') !== key) throw new ApiError('stale', 'totals');
  const now = Date.now();
  const stmts = rows.map(r => db.prepare('INSERT OR IGNORE INTO season_totals (season_id, participant_id, earned, spent, adjusted, final, closed_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, r.participant_id, r.earned, r.spent, r.adjusted, r.final, now));
  stmts.push(db.prepare("UPDATE seasons SET status = 'closed', closed_ms = ?, closed_by = ?, updated_ms = ? WHERE id = ? AND status = 'active'").bind(now, ctx.actor.email, now, id));
  let nextId;
  if (typeof body.next === 'string' && body.next) {
    nextId = body.next;
    if (!SEASON_ID.test(nextId)) throw invalid('next', 'اختار موسم جاي.');
    const planned = await retry(() => db.prepare("SELECT id FROM seasons WHERE id = ? AND status = 'planned'").bind(nextId).first());
    if (!planned) throw invalid('next', 'اختار موسم جاي (متخطط) أو اعمل واحد جديد.');
    stmts.push(db.prepare("UPDATE seasons SET status = 'active', updated_ms = ? WHERE id = ? AND status = 'planned'").bind(now, nextId));
  } else {
    const f = seasonFields(body.next || {});
    nextId = randomId('sea-', 4);
    stmts.push(db.prepare("INSERT INTO seasons (id, name, start_at, end_at, status, created_ms, updated_ms) VALUES (?, ?, ?, ?, 'active', ?, ?)").bind(nextId, f.name, f.startAt, f.endAt, now, now));
  }
  stmts.push(activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'finalize', entityType: 'points', entityId: id, entityTitle: 'قفل الموسم', summary: 'قفل الموسم', changes: { season: true, participants: rows.length, next: nextId } }));
  await retry(() => db.batch(stmts));
  return { closed: id, active: nextId, participants: rows.length, ...(await adminSeasons(ctx)) };
}
