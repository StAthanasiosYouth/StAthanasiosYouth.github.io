/*
 * «خبزنا اليومي» — the admin's routes (PLAN.md W3; screens in W4). Permissions (lib/perms.js ROUTE_PERMS):
 * bread.content (programs, upload, activate, stop, settings), bread.stats (numbers), bread.reflections (the texts:
 * each read writes an activity row; by default only the Primary Admin holds it, decision 10).
 *
 *   GET  /v1/admin/bread/programs                       programs + where each stands, the settings
 *   POST /v1/admin/bread/programs            { name, days }               → a draft
 *   POST /v1/admin/bread/programs/:id/topics { topics: [...] }  ≤ 20 a call (the browser resolved the text)
 *   POST /v1/admin/bread/programs/:id/activate { mode: 'after' | 'now', confirm }
 *   POST /v1/admin/bread/programs/:id/stop    { confirm }
 *   POST /v1/admin/bread/programs/:id/delete  (a draft / ready program, never one that was published)
 *   GET  /v1/admin/bread/stats?program=
 *   GET  /v1/admin/bread/reflections?program=&before=
 *   GET  /v1/admin/bread/settings · POST /v1/admin/bread/settings { defaultTime, maxSlots, emptyMuted, module, push }
 *
 * The upload is split: the Worker's 10 ms never parse a whole Excel or a whole program (STUDY §7.1).
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { sha256, randomId } from '../lib/hash.js';
import { limit } from '../lib/ratelimit.js';
import { activityStmt } from '../lib/activity.js';
import { checkProgram, checkTopic, topicFile, cairoDay, dayAdd, dayDiff, currentOf, nextOf, liveOn, PROGRAM_ID, minuteOf } from './model.js';
import { breadSettings, settingStmt, datedPrograms, publishStmts, mirrorSoon } from './store.js';

export const TOPICS_PER_CALL = 20;
export const UPLOAD_MAX_BYTES = 320 * 1024;
const PURGE_DAYS = 90;

const bad = (message, extra = {}) => new ApiError('invalid', 'bread', { message, ...extra });
const act = (ctx, action, p, summary, extra = {}) => activityStmt(ctx.env.DB, {
  actor: ctx.actor.email, actorName: ctx.actor.name, action, entityType: 'bread', entityId: p ? p.id : '', entityTitle: p ? p.name : '', summary, ...extra
});

async function programOf(db, id) {
  if (!PROGRAM_ID.test(String(id || ''))) throw new ApiError('not_found', 'program', { message: 'البرنامج ده مش موجود.' });
  const p = await retry(() => db.prepare('SELECT * FROM bread_programs WHERE id = ?').bind(id).first());
  if (!p) throw new ApiError('not_found', 'program', { message: 'البرنامج ده مش موجود.' });
  return p;
}

/* where a program stands today: draft | ready | next | live | ended | stopped */
export function stateOf(p, day) {
  if (p.status === 'draft' || p.status === 'ready') return p.status;
  if (liveOn(p, day)) return 'live';
  if (p.status === 'scheduled' && p.starts_on > day) return 'next';
  if (p.status === 'stopped' && (!p.ends_on || p.ends_on < p.starts_on)) return 'stopped';
  return 'ended';
}

const view = (p, day, extra = {}) => ({
  id: p.id, name: p.name, days: p.days, state: stateOf(p, day), startsOn: p.starts_on, endsOn: p.ends_on,
  daysLeft: liveOn(p, day) ? dayDiff(p.ends_on, day) : null, day: liveOn(p, day) ? dayDiff(day, p.starts_on) + 1 : null,
  createdMs: p.created_ms, activatedMs: p.activated_ms, stoppedMs: p.stopped_ms, purged: !!p.purged_ms, ...extra
});

/* GET /v1/admin/bread/programs */
export async function adminBreadPrograms(ctx) {
  const db = ctx.env.DB;
  const day = cairoDay();
  const [programs, topics, totals] = await retry(() => db.batch([
    db.prepare('SELECT * FROM bread_programs ORDER BY created_ms DESC LIMIT 60'),
    db.prepare('SELECT program_id, COUNT(*) AS n FROM bread_topics GROUP BY program_id'),
    db.prepare('SELECT program_id, SUM(opens) AS opens, SUM(reads) AS reads, SUM(sent) AS sent, SUM(reflections) AS reflections FROM bread_daily GROUP BY program_id')
  ]));
  const have = new Map(topics.results.map(r => [r.program_id, r.n]));
  const sums = new Map(totals.results.map(r => [r.program_id, r]));
  const list = programs.results.map(p => {
    const s = sums.get(p.id) || {};
    return view(p, day, { uploaded: have.get(p.id) || 0, totals: { opens: s.opens || 0, reads: s.reads || 0, sent: s.sent || 0, reflections: s.reflections || 0 } });
  });
  const dated = programs.results.filter(p => p.status === 'scheduled' || p.status === 'stopped');
  const cur = currentOf(dated, day);
  const next = nextOf(dated, day);
  return { today: day, current: cur ? cur.id : null, next: next ? next.id : null, programs: list, settings: await breadSettings(db) };
}

/* POST /v1/admin/bread/programs { name, days } → the draft */
export async function adminBreadCreate(ctx) {
  await limit(ctx, 'bread.admin', ctx.actor.email, 60, 60);
  const c = checkProgram(ctx.body);
  if (!c.ok) throw bad('في بيانات محتاجة تتصلح.', { errors: c.errors });
  const db = ctx.env.DB;
  const now = Date.now();
  const p = { id: randomId('brd-', 5), name: c.name, days: c.days };
  await retry(() => db.batch([
    db.prepare("INSERT INTO bread_programs (id, name, days, status, created_by, created_ms) VALUES (?, ?, ?, 'draft', ?, ?)").bind(p.id, p.name, p.days, ctx.actor.email, now),
    act(ctx, 'bread.create', p, 'برنامج جديد: ' + p.days + ' يوم')
  ]));
  return { program: view({ ...p, status: 'draft', created_ms: now }, cairoDay(now), { uploaded: 0 }) };
}

/* POST /v1/admin/bread/programs/:id/topics { topics } → { uploaded, missing } (every row checked; a bad one stores nothing) */
export async function adminBreadTopics(ctx) {
  await limit(ctx, 'bread.admin', ctx.actor.email, 60, 60);
  const db = ctx.env.DB;
  const p = await programOf(db, ctx.params.id);
  if (p.status !== 'draft' && p.status !== 'ready') throw bad('البرنامج ده اتفعّل خلاص: مينفعش يتغير. ارفعه كبرنامج جديد.');
  const list = ctx.body && ctx.body.topics;
  if (!Array.isArray(list) || !list.length || list.length > TOPICS_PER_CALL) throw bad('ابعت من ١ لـ ' + TOPICS_PER_CALL + ' يوم في المرة.');
  const errors = [];
  const ok = [];
  const seen = new Set();
  for (const t of list) {
    const c = checkTopic(t, p.days);
    if (!c.ok) { errors.push(...c.errors); continue; }
    if (seen.has(c.topic.n)) { errors.push({ n: c.topic.n, field: 'n', message: 'اليوم ده متكرر.' }); continue; }
    seen.add(c.topic.n);
    ok.push(c.topic);
  }
  if (errors.length) throw bad('في أيام محتاجة تتصلح.', { errors: errors.slice(0, 50) });
  const stmts = [];
  for (const t of ok) {
    const body = topicFile(p.id, t);
    stmts.push(db.prepare(`INSERT INTO bread_topics (program_id, n, title, verse_ref, verse_text, verse_note, reading_ref, reading_json, meditation, question, body, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(program_id, n) DO UPDATE SET title = excluded.title, verse_ref = excluded.verse_ref, verse_text = excluded.verse_text,
      verse_note = excluded.verse_note, reading_ref = excluded.reading_ref, reading_json = excluded.reading_json, meditation = excluded.meditation, question = excluded.question,
      body = excluded.body, hash = excluded.hash`)
      .bind(p.id, t.n, t.title, t.verseRef, t.verse, t.verseNote, t.readingRef, JSON.stringify(t.reading), t.meditation, t.question, body, await sha256(body)));
  }
  stmts.push(db.prepare("UPDATE bread_programs SET status = CASE WHEN (SELECT COUNT(*) FROM bread_topics WHERE program_id = ?) = days THEN 'ready' ELSE 'draft' END WHERE id = ? AND status IN ('draft', 'ready')").bind(p.id, p.id));
  stmts.push(db.prepare('SELECT n FROM bread_topics WHERE program_id = ? ORDER BY n').bind(p.id));
  const r = await retry(() => db.batch(stmts));
  const have = new Set(r[r.length - 1].results.map(x => x.n));
  const missing = [];
  for (let n = 1; n <= p.days && missing.length < 200; n++) if (!have.has(n)) missing.push(n);
  return { uploaded: have.size, days: p.days, missing, ready: have.size === p.days };
}

/*
 * POST /v1/admin/bread/programs/:id/activate { mode, confirm }
 *   'after': the day after the live program ends (today when nothing is live). One program waits at most.
 *   'now':   the live one stops (its last day = yesterday) and this one starts today; `confirm: true` needed when one
 *            is live. A program that was waiting moves to start after this one.
 * The days and the index are published at once (the Worker), and GitHub follows (the mirror).
 */
export async function adminBreadActivate(ctx) {
  await limit(ctx, 'bread.admin', ctx.actor.email, 20, 60);
  const db = ctx.env.DB;
  const now = Date.now();
  const day = cairoDay(now);
  const p = await programOf(db, ctx.params.id);
  const mode = ctx.body && ctx.body.mode;
  if (mode !== 'after' && mode !== 'now') throw bad('اختار: بعد الحالي ولا استبدال دلوقتي.');
  if (p.status !== 'ready') throw bad(p.status === 'draft' ? 'البرنامج لسه ناقص أيام.' : 'البرنامج ده اتفعّل قبل كده.');
  const dated = await datedPrograms(db);
  const cur = currentOf(dated, day);
  const waiting = nextOf(dated, day);
  const stmts = [];
  let start;
  if (mode === 'after') {
    if (waiting) throw new ApiError('conflict', 'bread next', { message: 'في برنامج مستني بعد الحالي: «' + waiting.name + '». أوقفه الأول أو استبدل دلوقتي.' });
    start = cur ? dayAdd(cur.ends_on, 1) : day;
  } else {
    if (cur && ctx.body.confirm !== true) throw bad('الاستبدال بيوقف «' + cur.name + '» النهارده: أكّد الأول.', { needsConfirm: true, current: cur.name });
    start = day;
    if (cur) {
      const end = dayAdd(day, -1);
      stmts.push(db.prepare("UPDATE bread_programs SET status = 'stopped', ends_on = ?, purge_on = ?, stopped_ms = ?, stopped_by = ? WHERE id = ?").bind(end, dayAdd(end, PURGE_DAYS), now, ctx.actor.email, cur.id));
      stmts.push(act(ctx, 'bread.stop', cur, 'اتوقف: اتبدل ببرنامج «' + p.name + '»'));
      cur.status = 'stopped';
      cur.ends_on = end;
    }
  }
  const end = dayAdd(start, p.days - 1);
  const rows = dated.filter(x => x.id !== p.id);
  rows.push({ ...p, status: 'scheduled', starts_on: start, ends_on: end });
  if (mode === 'now' && waiting) {
    const ws = dayAdd(end, 1);
    const we = dayAdd(ws, waiting.days - 1);
    stmts.push(db.prepare('UPDATE bread_programs SET starts_on = ?, ends_on = ?, purge_on = ? WHERE id = ?').bind(ws, we, dayAdd(we, PURGE_DAYS), waiting.id));
    Object.assign(rows.find(x => x.id === waiting.id), { starts_on: ws, ends_on: we });
  }
  const guard = db.prepare("UPDATE bread_programs SET status = 'scheduled', starts_on = ?, ends_on = ?, purge_on = ?, activated_ms = ?, activated_by = ? WHERE id = ? AND status = 'ready'")
    .bind(start, end, dayAdd(end, PURGE_DAYS), now, ctx.actor.email, p.id);
  const pub = await publishStmts(db, { rows, day, topicsOf: p.id, by: ctx.actor.email, now });
  await retry(() => db.batch([
    guard, ...stmts, ...pub.stmts,
    // «المحتوى خلص» comes back once there is content again (STUDY §7.3)
    settingStmt(db, 'BREAD_EMPTY_MUTED', '0', ctx.actor.email, now),
    act(ctx, 'bread.activate', p, (mode === 'now' ? 'اتفعّل دلوقتي' : 'اتجدول بعد الحالي') + ': من ' + start + ' لـ ' + end, { severity: 'important' })
  ]));
  await mirrorSoon(ctx.env, ctx.defer);
  return { program: view({ ...p, status: 'scheduled', starts_on: start, ends_on: end, activated_ms: now }, day), publish: pub.publishId };
}

/* POST /v1/admin/bread/programs/:id/stop { confirm: true }: live → its last day was yesterday; waiting → never starts */
export async function adminBreadStop(ctx) {
  await limit(ctx, 'bread.admin', ctx.actor.email, 20, 60);
  const db = ctx.env.DB;
  const now = Date.now();
  const day = cairoDay(now);
  const p = await programOf(db, ctx.params.id);
  if (!ctx.body || ctx.body.confirm !== true) throw bad('أكّد الإيقاف الأول.', { needsConfirm: true });
  const state = stateOf(p, day);
  if (state !== 'live' && state !== 'next') throw bad('البرنامج ده مش شغال ولا مستني.');
  const end = state === 'live' ? dayAdd(day, -1) : null;
  const purge = end ? dayAdd(end, PURGE_DAYS) : day;
  const dated = (await datedPrograms(db)).map(x => (x.id === p.id ? { ...x, status: 'stopped', ends_on: end } : x));
  const pub = await publishStmts(db, { rows: dated, day, by: ctx.actor.email, now });
  await retry(() => db.batch([
    db.prepare("UPDATE bread_programs SET status = 'stopped', ends_on = ?, purge_on = ?, stopped_ms = ?, stopped_by = ? WHERE id = ?").bind(end, purge, now, ctx.actor.email, p.id),
    ...pub.stmts,
    act(ctx, 'bread.stop', p, state === 'live' ? 'اتوقف وهو شغال' : 'اتلغى قبل ما يبدأ', { severity: 'important' })
  ]));
  await mirrorSoon(ctx.env, ctx.defer);
  return { program: view({ ...p, status: 'stopped', ends_on: end, stopped_ms: now }, day) };
}

/* POST /v1/admin/bread/programs/:id/delete: a program never published goes entirely */
export async function adminBreadDelete(ctx) {
  const db = ctx.env.DB;
  const p = await programOf(db, ctx.params.id);
  if (p.status !== 'draft' && p.status !== 'ready') throw bad('البرنامج ده اتفعّل: بيتوقف بس، والأرقام بتفضل.');
  await retry(() => db.batch([
    db.prepare('DELETE FROM bread_topics WHERE program_id = ?').bind(p.id),
    db.prepare("DELETE FROM bread_programs WHERE id = ? AND status IN ('draft', 'ready')").bind(p.id),
    act(ctx, 'bread.delete', p, 'اتمسح قبل التفعيل')
  ]));
  return { deleted: p.id };
}

/* GET /v1/admin/bread/stats?program= → the days' numbers (aggregate only) */
export async function adminBreadStats(ctx) {
  const db = ctx.env.DB;
  const url = new URL(ctx.request.url);
  const day = cairoDay();
  let id = url.searchParams.get('program');
  if (!id) {
    const cur = currentOf(await datedPrograms(db), day);
    if (!cur) return { program: null, days: [], totals: null };
    id = cur.id;
  }
  const p = await programOf(db, id);
  const [days, devices, members, reflections] = await retry(() => db.batch([
    db.prepare('SELECT day, opens, reads, sent, reflections FROM bread_daily WHERE program_id = ? ORDER BY day').bind(p.id),
    db.prepare('SELECT COUNT(DISTINCT device_id) AS devices, COUNT(*) AS slots FROM bread_slots'),
    db.prepare('SELECT COUNT(*) AS n FROM bread_members WHERE program_id = ?').bind(p.id),
    db.prepare('SELECT COUNT(*) AS n FROM bread_reflections WHERE program_id = ? AND deleted_ms IS NULL').bind(p.id)
  ]));
  const sum = k => days.results.reduce((a, r) => a + (r[k] || 0), 0);
  return {
    program: view(p, day),
    days: days.results,
    totals: { opens: sum('opens'), reads: sum('reads'), sent: sum('sent'), reflections: reflections.results[0].n },
    subscribers: { devices: devices.results[0].devices, slots: devices.results[0].slots },
    accounts: members.results[0].n
  };
}

/* GET /v1/admin/bread/reflections?program=&before=&limit= — each read is in «النشاط» (STUDY §4.4) */
export async function adminBreadReflections(ctx) {
  await limit(ctx, 'bread.reflections', ctx.actor.email, 60, 60);
  const db = ctx.env.DB;
  const url = new URL(ctx.request.url);
  const p = await programOf(db, url.searchParams.get('program'));
  const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
  const max = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
  const [rows] = await retry(() => db.batch([
    db.prepare(`SELECT r.id, r.n, r.day, r.text, r.state, r.created_ms, r.edited_ms, t.title, p.name
      FROM bread_reflections r LEFT JOIN bread_topics t ON t.program_id = r.program_id AND t.n = r.n LEFT JOIN participants p ON p.id = r.participant_id
      WHERE r.program_id = ? AND r.deleted_ms IS NULL AND r.created_ms < ? ORDER BY r.created_ms DESC LIMIT ?`).bind(p.id, before, max),
    act(ctx, 'bread.reflections.view', p, 'فتح تأملات البرنامج')
  ]));
  return {
    program: { id: p.id, name: p.name },
    reflections: rows.results.map(r => ({ id: r.id, n: r.n, day: r.day, title: r.title || '', text: r.text, state: r.state, name: r.name || '', createdMs: r.created_ms, editedMs: r.edited_ms })),
    more: rows.results.length === max ? rows.results[rows.results.length - 1].created_ms : null
  };
}

/* GET /v1/admin/bread/settings */
export async function adminBreadSettings(ctx) {
  return { settings: await breadSettings(ctx.env.DB) };
}

/*
 * POST /v1/admin/bread/settings { defaultTime?, maxSlots?, emptyMuted?, module?, push? }
 * The two switches are the Primary Admin's (staging: any admin, for the checks), like the booking switch.
 */
export async function adminBreadSettingsSave(ctx) {
  await limit(ctx, 'bread.admin', ctx.actor.email, 30, 60);
  const b = ctx.body || {};
  const db = ctx.env.DB;
  const now = Date.now();
  const by = ctx.actor.email;
  const stmts = [];
  const changed = [];
  if (b.defaultTime !== undefined) {
    if (minuteOf(b.defaultTime) === null) throw bad('الميعاد مش مفهوم (HH:MM).');
    stmts.push(settingStmt(db, 'bread_default_time', b.defaultTime, by, now)); changed.push('defaultTime');
  }
  if (b.maxSlots !== undefined) {
    if (![1, 2, 3].includes(b.maxSlots)) throw bad('أقصى عدد للمواعيد من ١ لـ ٣.');
    stmts.push(settingStmt(db, 'bread_max_slots', String(b.maxSlots), by, now)); changed.push('maxSlots');
  }
  if (b.emptyMuted !== undefined) {
    if (typeof b.emptyMuted !== 'boolean') throw bad('الطلب مش مفهوم.');
    stmts.push(settingStmt(db, 'BREAD_EMPTY_MUTED', b.emptyMuted ? '1' : '0', by, now)); changed.push('emptyMuted');
  }
  for (const [k, key] of [['module', 'BREAD_MODULE'], ['push', 'BREAD_PUSH']]) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'boolean') throw bad('الطلب مش مفهوم.');
    if (ctx.env.ENVIRONMENT !== 'staging' && ctx.env.ENVIRONMENT !== 'test' && ctx.actor.role !== 'primary') throw new ApiError('denied', 'primary only', { perm: 'primary' });
    stmts.push(settingStmt(db, key, b[k] ? '1' : '0', by, now)); changed.push(k);
  }
  if (!stmts.length) throw bad('مفيش حاجة اتغيرت.');
  stmts.push(activityStmt(db, { actor: by, actorName: ctx.actor.name, action: 'bread.settings', entityType: 'bread', entityId: 'settings', summary: 'إعدادات خبزنا اليومي: ' + changed.join('، '), changes: { fields: changed } }));
  await retry(() => db.batch(stmts));
  return adminBreadSettings(ctx);
}
