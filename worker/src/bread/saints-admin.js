/*
 * «خبزنا اليومي» P3 — the saints and church people registry in the admin (docs/daily-bread/saints/P3-PLAN.md).
 * Permission bread.saints (lib/perms.js); off (`disabled`) while BREAD_SAINTS ≠ '1'.
 *
 *   GET  /v1/admin/bread/saints                         the draft: people, occasions, each one's state, last publish
 *   POST /v1/admin/bread/saints/item          { kind, item, rev }      add (rev 0) or save (rev = the one read)
 *   POST /v1/admin/bread/saints/item/delete   { kind, id, rev }        removed in the draft (gone at the next publish)
 *   POST /v1/admin/bread/saints/item/restore  { kind, id }             a removed one back, before the publish
 *   POST /v1/admin/bread/saints/item/revert   { kind, id }             back to how it was published («رجّع»)
 *   GET  /v1/admin/bread/saints/review                  what changed since the last publish, the problems, who joins
 *                                                       or leaves the automatic days, and `expect` for the publish
 *   POST /v1/admin/bread/saints/publish       { expect } daily-bread/data/saints.json + a snapshot of the whole registry
 *   GET  /v1/admin/bread/saints/history                 the publishes
 *   POST /v1/admin/bread/saints/restore       { rev, confirm }  an older publish becomes the draft and is published again
 *   GET  /v1/admin/bread/saints/feasts?month=           the month's feasts from the PUBLISHED registry (bread.content:
 *                                                       the «الأعياد» tab, with St-Takla's suggestion when it has the day)
 *
 * The rules (checks, status/missing, feastsOfMonth, the published file) are worker/src/bread/saints.js, shared with
 * the tools. status/missing are computed here on every save: a person without a day is saved, stays out of the
 * automatic days, and joins them as soon as a day with its source is published — no code change, no import.
 * A 'bread' publish (store.js fileStmts): the Worker serves it at once and the mirror commits it to main.
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { sha256 } from '../lib/hash.js';
import { limit } from '../lib/ratelimit.js';
import { activityStmt } from '../lib/activity.js';
import { checkPerson, checkOccasion, check, withStatus, scheduled, feastsOfMonth, publicFile, ID_RE } from './saints.js';
import { fileStmts, mirrorSoon } from './store.js';

export const SAINTS_ITEM_MAX_BYTES = 32 * 1024;
const KINDS = ['person', 'occasion'];
const PERSON_KEYS = ['id', 'name', 'cat', 'class', 'feasts', 'milestones', 'sources', 'pending', 'album', 'praise', 'image', 'word', 'note'];
const OCCASION_KEYS = ['id', 'name', 'kind', 'coptic', 'gregorian', 'year', 'repeat', 'date', 'source', 'more', 'note'];
export const FILE_KEY = 'saints';

const bad = (message, extra = {}) => new ApiError('invalid', 'saints', { message, ...extra });
const stale = () => new ApiError('stale', 'saints', { message: 'حد تاني عدّل ده من شوية. حمّل الصفحة تاني وبعدين عدّل.' });
const act = (ctx, action, id, title, summary, changes) => activityStmt(ctx.env.DB, {
  actor: ctx.actor.email, actorName: ctx.actor.name, action, entityType: 'saints', entityId: id || '', entityTitle: title || '', summary, changes
});

/* off unless BREAD_SAINTS = '1' (the switch is the Primary Admin's, in «الإعدادات») */
async function gate(db) {
  const on = await retry(() => db.prepare("SELECT value FROM settings WHERE key = 'BREAD_SAINTS'").first('value'));
  if (on !== '1') throw new ApiError('disabled', 'BREAD_SAINTS', { message: 'سجل الشخصيات لسه مقفول.' });
}

const rowsOf = async db => (await retry(() => db.prepare('SELECT kind, id, ord, data, rev, pub_rev, deleted_ms, updated_at, updated_by FROM saints_items ORDER BY kind, ord').all())).results;
const lastSnapshot = db => retry(() => db.prepare('SELECT rev, data, people, occasions, note, at, by FROM saints_snapshots ORDER BY rev DESC LIMIT 1').first());

const stateOf = r => (r.deleted_ms ? 'deleted' : r.pub_rev == null ? 'new' : r.rev !== r.pub_rev ? 'changed' : 'published');
const tag = r => r.kind + ':' + r.id + ':' + r.rev;

/* the draft as a registry (schema 2), in the owner's order; removed ones left out */
function registryOf(rows) {
  const meta = Object.fromEntries(rows.filter(r => r.kind === 'meta').map(r => [r.id, JSON.parse(r.data)]));
  const live = k => rows.filter(r => r.kind === k && !r.deleted_ms).sort((a, b) => a.ord - b.ord).map(r => JSON.parse(r.data));
  const reg = { schema: 2 };
  if (meta.about) reg.about = meta.about;
  if (meta.picturesRoot) reg.picturesRoot = meta.picturesRoot;
  reg.categories = meta.categories || {};
  reg.people = live('person');
  reg.occasions = live('occasion');
  return reg;
}

/* GET /v1/admin/bread/saints */
export async function adminSaintsList(ctx) {
  const db = ctx.env.DB;
  await gate(db);
  const [rows, snap] = await Promise.all([rowsOf(db), lastSnapshot(db)]);
  const meta = Object.fromEntries(rows.filter(r => r.kind === 'meta').map(r => [r.id, JSON.parse(r.data)]));
  const items = rows.filter(r => r.kind !== 'meta').map(r => ({ kind: r.kind, id: r.id, ord: r.ord, rev: r.rev, state: stateOf(r), at: r.updated_at, by: r.updated_by, data: JSON.parse(r.data) }));
  return {
    enabled: true,
    categories: meta.categories || {},
    items,
    changes: items.filter(i => i.state !== 'published').length,
    published: snap ? { rev: snap.rev, at: snap.at, by: snap.by, people: snap.people, occasions: snap.occasions } : null
  };
}

/* only the fields the schema knows (anything else from the browser is dropped) */
function clean(kind, item) {
  const keys = kind === 'person' ? PERSON_KEYS : OCCASION_KEYS;
  const out = {};
  for (const k of keys) if (item[k] !== undefined && item[k] !== null && !(Array.isArray(item[k]) && !item[k].length && k !== 'feasts' && k !== 'album')) out[k] = item[k];
  if (kind === 'person') { if (!Array.isArray(out.feasts)) out.feasts = []; if (!Array.isArray(out.album)) out.album = []; }
  if (kind === 'occasion' && out.repeat === 'yearly') delete out.repeat;
  return out;
}

/* the top-level fields that differ (null, missing and an empty list are the same: «nothing») */
const norm = v => (v == null || (Array.isArray(v) && !v.length) ? '' : JSON.stringify(v));
const changedKeys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter(k => norm((a || {})[k]) !== norm((b || {})[k]));

/* POST /v1/admin/bread/saints/item { kind, item, rev } */
export async function adminSaintsSave(ctx) {
  await limit(ctx, 'bread.saints.save', ctx.actor.email, 60, 60);
  const db = ctx.env.DB;
  await gate(db);
  const b = ctx.body || {};
  if (!KINDS.includes(b.kind) || !b.item || typeof b.item !== 'object' || Array.isArray(b.item)) throw bad('الطلب مش مفهوم.');
  const rev = b.rev == null ? 0 : b.rev;
  if (!Number.isInteger(rev) || rev < 0) throw bad('الطلب مش مفهوم.');
  let item = clean(b.kind, b.item);
  if (typeof item.id !== 'string' || !ID_RE.test(item.id) || item.id.length > 40) throw bad('الـid لازم حروف إنجليزي صغيرة وأرقام بس.', { errors: ['id'] });
  let errors;
  if (b.kind === 'person') {
    item = withStatus(item);
    const cats = JSON.parse((await retry(() => db.prepare("SELECT data FROM saints_items WHERE kind = 'meta' AND id = 'categories'").first('data'))) || '{}');
    errors = checkPerson(item, { cats });
  } else errors = checkOccasion(item);
  if (errors.length) throw bad('فيه حاجات محتاجة تتصلح.', { errors: errors.slice(0, 20) });
  const data = JSON.stringify(item);
  if (data.length > SAINTS_ITEM_MAX_BYTES) throw bad('البيانات كبيرة أوي.');
  const now = Date.now(), by = ctx.actor.email;
  const old = await retry(() => db.prepare('SELECT kind, id, data, rev, deleted_ms FROM saints_items WHERE id = ? AND kind IN (\'person\', \'occasion\')').bind(item.id).first());
  let summary, changes;
  if (!rev) {
    if (old) throw bad('الـid ده مستعمل لحد تاني. اختار واحد تاني.', { errors: ['id'] });
    await retry(() => db.prepare(`INSERT INTO saints_items (kind, id, ord, data, rev, pub_rev, updated_at, updated_by)
      SELECT ?, ?, 1 + COALESCE((SELECT MAX(ord) FROM saints_items WHERE kind = ?), 0), ?, 1, NULL, ?, ?`).bind(b.kind, item.id, b.kind, data, now, by).run());
    summary = (b.kind === 'person' ? 'شخص جديد في السجل: ' : 'مناسبة جديدة: ') + item.name;
  } else {
    if (!old || old.kind !== b.kind) throw new ApiError('not_found', 'saints', { message: 'ده مش موجود في السجل.' });
    const r = await retry(() => db.prepare('UPDATE saints_items SET data = ?, rev = rev + 1, updated_at = ?, updated_by = ? WHERE kind = ? AND id = ? AND rev = ? AND deleted_ms IS NULL')
      .bind(data, now, by, b.kind, item.id, rev).run());
    if (!r.meta || r.meta.changes !== 1) throw stale();
    changes = { fields: changedKeys(JSON.parse(old.data), item) };
    summary = 'تعديل «' + item.name + '»: ' + (changes.fields.join('، ') || 'من غير تغيير');
  }
  await retry(() => act(ctx, 'bread.saints', item.id, item.name, summary, changes).run());
  const row = await retry(() => db.prepare('SELECT kind, id, ord, data, rev, pub_rev, deleted_ms, updated_at, updated_by FROM saints_items WHERE kind = ? AND id = ?').bind(b.kind, item.id).first());
  return { item: { kind: row.kind, id: row.id, ord: row.ord, rev: row.rev, state: stateOf(row), at: row.updated_at, by: row.updated_by, data: JSON.parse(row.data) } };
}

function target(b) {
  if (!b || !KINDS.includes(b.kind) || typeof b.id !== 'string' || !ID_RE.test(b.id)) throw bad('الطلب مش مفهوم.');
  return b;
}

/* POST /v1/admin/bread/saints/item/delete { kind, id, rev } — never published: gone now; else gone at the next publish */
export async function adminSaintsDelete(ctx) {
  await limit(ctx, 'bread.saints.delete', ctx.actor.email, 30, 60);
  const db = ctx.env.DB;
  await gate(db);
  const b = target(ctx.body);
  const row = await retry(() => db.prepare('SELECT data, rev, pub_rev FROM saints_items WHERE kind = ? AND id = ? AND deleted_ms IS NULL').bind(b.kind, b.id).first());
  if (!row) throw new ApiError('not_found', 'saints', { message: 'ده مش موجود في السجل.' });
  if (row.rev !== b.rev) throw stale();
  const name = JSON.parse(row.data).name;
  const now = Date.now();
  const r = row.pub_rev == null
    ? await retry(() => db.prepare('DELETE FROM saints_items WHERE kind = ? AND id = ? AND rev = ?').bind(b.kind, b.id, b.rev).run())
    : await retry(() => db.prepare('UPDATE saints_items SET deleted_ms = ?, rev = rev + 1, updated_at = ?, updated_by = ? WHERE kind = ? AND id = ? AND rev = ?').bind(now, now, ctx.actor.email, b.kind, b.id, b.rev).run());
  if (!r.meta || r.meta.changes !== 1) throw stale();
  await retry(() => act(ctx, 'bread.saints.delete', b.id, name, 'اتشال من السجل: ' + name + (row.pub_rev == null ? '' : ' (من الموقع بعد النشر)')).run());
  return { ok: true, gone: row.pub_rev == null };
}

/* POST /v1/admin/bread/saints/item/restore { kind, id } — a removed one, back (before the publish) */
export async function adminSaintsRestoreItem(ctx) {
  const db = ctx.env.DB;
  await gate(db);
  const b = target(ctx.body);
  const r = await retry(() => db.prepare('UPDATE saints_items SET deleted_ms = NULL, rev = rev + 1, updated_at = ?, updated_by = ? WHERE kind = ? AND id = ? AND deleted_ms IS NOT NULL').bind(Date.now(), ctx.actor.email, b.kind, b.id).run());
  if (!r.meta || r.meta.changes !== 1) throw new ApiError('not_found', 'saints', { message: 'مفيش حاجة ترجع.' });
  return { ok: true };
}

/* POST /v1/admin/bread/saints/item/revert { kind, id } — back to the published version («رجّع» in the review) */
export async function adminSaintsRevert(ctx) {
  const db = ctx.env.DB;
  await gate(db);
  const b = target(ctx.body);
  const snap = await lastSnapshot(db);
  const reg = snap ? JSON.parse(snap.data) : null;
  const was = reg ? (b.kind === 'person' ? reg.people : reg.occasions || []).find(x => x.id === b.id) : null;
  const now = Date.now();
  const r = was
    // the published version again: rev moves on, and pub_rev follows it (same as what is on the site)
    ? await retry(() => db.prepare('UPDATE saints_items SET data = ?, deleted_ms = NULL, rev = rev + 1, pub_rev = rev + 1, updated_at = ?, updated_by = ? WHERE kind = ? AND id = ?').bind(JSON.stringify(was), now, ctx.actor.email, b.kind, b.id).run())
    : await retry(() => db.prepare('DELETE FROM saints_items WHERE kind = ? AND id = ? AND pub_rev IS NULL').bind(b.kind, b.id).run());
  if (!r.meta || r.meta.changes !== 1) throw new ApiError('not_found', 'saints', { message: 'مفيش حاجة ترجع.' });
  await retry(() => act(ctx, 'bread.saints', b.id, was ? was.name : b.id, 'رجّع زي المنشور: ' + (was ? was.name : b.id)).run());
  return { ok: true };
}

/* ---------- review and publish ---------- */

export const LABELS = { name: 'الاسم', class: 'النوع', cat: 'المجموعة', feasts: 'أيام التذكار', milestones: 'محطات العمر', album: 'الألبوم', praise: 'التمجيد', sources: 'مصادر السيرة', pending: 'لسه بندوّر على', image: 'الصورة على الموقع', word: 'الكلمة', note: 'ملحوظة', kind: 'المناسبة', coptic: 'اليوم القبطي', gregorian: 'اليوم الميلادي', year: 'السنة', repeat: 'التكرار', date: 'التاريخ', source: 'المصدر', more: 'مصادر زيادة' };
const SKIP = new Set(['status', 'missing', 'id']);

async function review(db) {
  const [rows, snap] = await Promise.all([rowsOf(db), lastSnapshot(db)]);
  const draft = registryOf(rows);
  const before = snap ? JSON.parse(snap.data) : { people: [], occasions: [] };
  const was = new Map([...before.people.map(p => ['person:' + p.id, p]), ...(before.occasions || []).map(o => ['occasion:' + o.id, o])]);
  const changes = rows.filter(r => r.kind !== 'meta' && stateOf(r) !== 'published').map(r => {
    const now = JSON.parse(r.data), old = was.get(r.kind + ':' + r.id) || null;
    return { kind: r.kind, id: r.id, rev: r.rev, state: stateOf(r), name: now.name, at: r.updated_at, by: r.updated_by,
      fields: old ? changedKeys(old, now).filter(k => !SKIP.has(k)).map(k => ({ field: k, label: LABELS[k] || k })) : [] };
  });
  const errors = check(draft);
  // who joins / leaves the automatic days (the saints card, «مناسبات كنيستنا»)
  const on = reg => new Map(reg.people.map(p => withStatus(p)).filter(scheduled).map(p => [p.id, p]));
  const a = on(before), z = on(draft);
  const joins = [...z.values()].filter(p => !a.has(p.id)).map(p => ({ id: p.id, name: p.name, class: p.class, days: p.feasts.map(f => ({ kind: f.kind, coptic: f.coptic, gregorian: f.gregorian })) }));
  const leaves = [...a.values()].filter(p => !z.has(p.id)).map(p => ({ id: p.id, name: p.name, class: p.class }));
  const live = rows.filter(r => r.kind !== 'meta' && !r.deleted_ms).map(tag).sort();
  const expect = await sha256(JSON.stringify([snap ? snap.rev : 0, rows.filter(r => r.kind !== 'meta').map(tag).sort(), rows.filter(r => r.deleted_ms).map(tag)]));
  return { draft, snap, rows, changes, errors, joins, leaves, live, expect, first: !snap };
}

/* GET /v1/admin/bread/saints/review */
export async function adminSaintsReview(ctx) {
  const db = ctx.env.DB;
  await gate(db);
  const r = await review(db);
  return {
    first: r.first, changes: r.changes, errors: r.errors.slice(0, 50), joins: r.joins, leaves: r.leaves, expect: r.expect,
    people: r.draft.people.length, occasions: r.draft.occasions.length,
    published: r.snap ? { rev: r.snap.rev, at: r.snap.at, by: r.snap.by } : null
  };
}

const noteOf = r => r.first
  ? `أول نشرة: ${r.draft.people.length} شخص و${r.draft.occasions.length} مناسبة`
  : r.changes.map(c => (c.state === 'new' ? '+ ' : c.state === 'deleted' ? '− ' : '') + c.name).slice(0, 12).join('، ') + (r.changes.length > 12 ? ' …' : '');

/* POST /v1/admin/bread/saints/publish { expect } */
export async function adminSaintsPublish(ctx) {
  await limit(ctx, 'bread.saints.publish', ctx.actor.email, 10, 60);
  const db = ctx.env.DB;
  await gate(db);
  const r = await review(db);
  if (r.errors.length) throw bad('فيه حاجات محتاجة تتصلح قبل النشر.', { errors: r.errors.slice(0, 50) });
  if (!ctx.body || ctx.body.expect !== r.expect) throw new ApiError('stale', 'saints', { message: 'فيه تعديل جديد من ساعة ما فتحت المراجعة. راجع تاني وانشر.' });
  if (!r.first && !r.changes.length) throw bad('مفيش حاجة جديدة تتنشر.');
  const now = Date.now(), by = ctx.actor.email;
  const body = JSON.stringify(publicFile(r.draft)) + '\n';
  const pub = await fileStmts(db, { key: FILE_KEY, body, by, now });
  const rev = (r.snap ? r.snap.rev : 0) + 1;
  const note = noteOf(r);
  const tags = JSON.stringify(r.live);
  const gone = JSON.stringify(r.rows.filter(x => x.deleted_ms).map(tag));
  await retry(() => db.batch([
    db.prepare('INSERT INTO saints_snapshots (rev, data, people, occasions, note, publish_id, at, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(rev, JSON.stringify(r.draft), r.draft.people.length, r.draft.occasions.length, note, pub.publishId, now, by),
    ...pub.stmts,
    // exactly the versions this review saw are now published (a save in between stays «changed»)
    db.prepare("UPDATE saints_items SET pub_rev = rev WHERE deleted_ms IS NULL AND (kind || ':' || id || ':' || rev) IN (SELECT value FROM json_each(?))").bind(tags),
    db.prepare("DELETE FROM saints_items WHERE deleted_ms IS NOT NULL AND (kind || ':' || id || ':' || rev) IN (SELECT value FROM json_each(?))").bind(gone),
    act(ctx, 'bread.saints.publish', 'v' + rev, 'سجل الشخصيات', 'نشر سجل الشخصيات (النسخة ' + rev + '): ' + note, { joins: r.joins.map(p => p.id), leaves: r.leaves.map(p => p.id) })
  ]));
  await mirrorSoon(ctx.env, ctx.defer);
  return { rev, publish: pub.publishId, people: r.draft.people.length, occasions: r.draft.occasions.length, joins: r.joins, leaves: r.leaves };
}

/* GET /v1/admin/bread/saints/history */
export async function adminSaintsHistory(ctx) {
  const db = ctx.env.DB;
  await gate(db);
  const { results } = await retry(() => db.prepare('SELECT rev, people, occasions, note, at, by FROM saints_snapshots ORDER BY rev DESC LIMIT 30').all());
  return { publishes: results };
}

/* POST /v1/admin/bread/saints/restore { rev, confirm: true } — that publish becomes the draft and is published again */
export async function adminSaintsRestore(ctx) {
  await limit(ctx, 'bread.saints.restore', ctx.actor.email, 5, 60);
  const db = ctx.env.DB;
  await gate(db);
  const b = ctx.body || {};
  if (!Number.isInteger(b.rev) || b.confirm !== true) throw bad('الطلب مش مفهوم.');
  const [old, last] = await Promise.all([retry(() => db.prepare('SELECT rev, data FROM saints_snapshots WHERE rev = ?').bind(b.rev).first()), lastSnapshot(db)]);
  if (!old) throw new ApiError('not_found', 'saints', { message: 'النسخة دي مش موجودة.' });
  const reg = JSON.parse(old.data);
  const now = Date.now(), by = ctx.actor.email;
  const rev = last.rev + 1;
  const body = JSON.stringify(publicFile(reg)) + '\n';
  const pub = await fileStmts(db, { key: FILE_KEY, body, by, now });
  const note = 'رجوع للنسخة ' + old.rev;
  await retry(() => db.batch([
    db.prepare("DELETE FROM saints_items WHERE kind IN ('person', 'occasion')"),
    db.prepare("INSERT INTO saints_items (kind, id, ord, data, rev, pub_rev, updated_at, updated_by) SELECT 'person', json_extract(value, '$.id'), key + 1, value, 1, 1, ?, ? FROM json_each(?, '$.people')").bind(now, by, old.data),
    db.prepare("INSERT INTO saints_items (kind, id, ord, data, rev, pub_rev, updated_at, updated_by) SELECT 'occasion', json_extract(value, '$.id'), key + 1, value, 1, 1, ?, ? FROM json_each(?, '$.occasions')").bind(now, by, old.data),
    db.prepare('INSERT INTO saints_snapshots (rev, data, people, occasions, note, publish_id, at, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(rev, old.data, reg.people.length, (reg.occasions || []).length, note, pub.publishId, now, by),
    ...pub.stmts,
    act(ctx, 'bread.saints.restore', 'v' + rev, 'سجل الشخصيات', 'سجل الشخصيات رجع للنسخة ' + old.rev + ' (اتنشرت كنسخة ' + rev + ')')
  ]));
  await mirrorSoon(ctx.env, ctx.defer);
  return { rev, from: old.rev };
}

/*
 * GET /v1/admin/bread/saints/feasts?month=YYYY-MM → the month's feasts from the PUBLISHED registry, in the shape of
 * St-Takla's suggestion (tools/bread-takla.mjs feastEntry): a person completed and published today is here today.
 * No synaxarium word (that needs St-Takla's page): the registry's own word, or a line. { ready: false } = nothing published.
 */
export async function adminSaintsFeasts(ctx) {
  const month = new URL(ctx.request.url).searchParams.get('month') || '';
  if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(month)) throw bad('اختار الشهر.');
  const row = await retry(() => ctx.env.DB.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = ? AND live = 1").bind(FILE_KEY).first());
  if (!row) return { month, ready: false, feasts: [] };
  const reg = JSON.parse(row.body);
  const feasts = feastsOfMonth(reg, month).map(hit => {
    const p = hit.person, f = hit.feast;
    return {
      date: hit.date, on: true, id: p.id, name: p.name, kind: f.kind, title: (f.title || (f.kind + ' ' + p.name)).slice(0, 120),
      word: p.word || `النهارده ${f.kind} ${p.name}.`, sourceUrl: f.source,
      img: p.image ? '/' + p.image.file : null,
      praise: p.praise ? p.praise.source : null, praiseTitle: p.praise ? p.praise.title || null : null, praiseText: p.praise ? p.praise.text : null,
      others: hit.others
    };
  });
  return { month, ready: true, feasts };
}
