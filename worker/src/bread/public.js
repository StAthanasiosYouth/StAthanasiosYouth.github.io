/*
 * «خبزنا اليومي» — the member's routes (PLAN.md W3, STUDY §5, §7). All answer `disabled` while BREAD_MODULE ≠ '1'.
 *
 *   GET  /v1/bread/file/index · GET /v1/bread/file/:program/:n   the published files (the same text as GitHub Pages)
 *   POST /v1/bread/today      { seed }            today for this seed (signed in: the account's kept seed)
 *   POST /v1/bread/open       { seed, kind }      'open' | 'read' («قريت»): counted once a device a day, nothing more
 *   POST /v1/bread/slots      { token, seed, times? }   «فكّرني»: up to bread_max_slots 'HH:MM' (Cairo); [] = off;
 *                                                  without `times` it answers what is saved
 *   POST /v1/bread/me         { seed }            signed in: the kept seed (the device's on the first call in a
 *                                                  program), the look, eligible/guest, today's reflection
 *   POST /v1/bread/reflection        { seed, text }   signed in (eligible or guest): today's topic, once
 *   POST /v1/bread/reflection/edit   { id, text }     within EDIT_MS of writing it (the server decides)
 *   POST /v1/bread/reflection/delete { id }           within EDIT_MS too
 *
 * No route tells who opened what: opens are a salted hash of the device's random id, per day, kept 30 days.
 */

import { ApiError, publicFileResponse } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { randomId, pseudonym } from '../lib/hash.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { pushHash } from '../push/devices.js';
import { requireAccount } from '../account/session.js';
import { gate } from '../account/routes.js';
import { eligibility, rulesFrom } from '../account/model.js';
import { cairoDay, currentOf, nextOf, topicFor, minuteOf, timeOf, SEED, PROGRAM_ID, LIMITS } from './model.js';
import { requireModule, datedPrograms, breadSettings } from './store.js';

export const EDIT_MS = 20 * 60000;
const TOKEN = /^(?:[\w:-]{100,400}|[\w-]{22})$/;
const ID = /^rfl-[0-9a-f]{12}$/;
const bad = message => new ApiError('invalid', 'bread', { message });

const seedOf = body => {
  const s = body && body.seed;
  if (typeof s !== 'string' || !SEED.test(s)) throw bad('الجهاز مش معروف. حدّث الصفحة.');
  return s;
};

/* ---------- files ---------- */

async function serveFile(ctx, key) {
  await requireModule(ctx.env.DB);
  const row = await retry(() => ctx.env.DB.prepare("SELECT body, hash FROM published_revisions WHERE kind = 'bread' AND key = ? AND live = 1").bind(key).first());
  if (!row) throw new ApiError('not_found', 'bread', { message: 'القراءة دي مش موجودة.' });
  const etag = '"' + row.hash.slice(0, 32) + '"';
  const match = (ctx.request.headers.get('if-none-match') || '').split(',').map(t => t.trim().replace(/^W\//, ''));
  return { __response: publicFileResponse(ctx, row.body, { contentType: 'application/json; charset=utf-8', etag, status: match.includes(etag) ? 304 : 200 }) };
}

export const breadFileIndex = ctx => serveFile(ctx, 'index');
export async function breadFileFeasts(ctx) {
  const { month } = ctx.params;
  if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(String(month))) throw new ApiError('not_found', 'bread');
  return serveFile(ctx, 'feasts/' + month);
}
export async function breadFileDay(ctx) {
  const { program, n } = ctx.params;
  if (!PROGRAM_ID.test(String(program)) || !/^[1-9]\d{0,2}$/.test(String(n))) throw new ApiError('not_found', 'bread');
  return serveFile(ctx, program + '/' + n);
}

/* ---------- the signed-in member (optional for today, required for reflections) ---------- */

/* the account when the request carries a session, else null (a broken session is an error only where needed) */
async function maybeAccount(ctx) {
  if (!/^Bearer\s/i.test(ctx.request.headers.get('authorization') || '')) return null;
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  return { account, settings };
}

/* the account's seed in program p: kept from its first call, else this device's (stored now) */
async function memberSeed(db, accountId, p, deviceSeed, now) {
  await retry(() => db.prepare('INSERT INTO bread_members (participant_id, program_id, seed, created_ms) VALUES (?, ?, ?, ?) ON CONFLICT(participant_id, program_id) DO NOTHING')
    .bind(accountId, p.id, deviceSeed, now).run());
  return retry(() => db.prepare('SELECT seed FROM bread_members WHERE participant_id = ? AND program_id = ?').bind(accountId, p.id).first('seed'));
}

const dayView = (p, day, t) => ({ program: { id: p.id, name: p.name, days: p.days, startsOn: p.starts_on, endsOn: p.ends_on }, day: t.d + 1, n: t.n, today: day });

/* POST /v1/bread/today { seed } */
export async function breadToday(ctx) {
  const db = ctx.env.DB;
  await requireModule(db);
  await limit(ctx, 'bread.today', clientIp(ctx.request), 120, 60);
  let seed = seedOf(ctx.body);
  const now = Date.now();
  const day = cairoDay(now);
  const rows = await datedPrograms(db);
  const p = currentOf(rows, day);
  if (!p) {
    const next = nextOf(rows, day);
    return { state: next ? 'waiting' : 'empty', next: next ? { name: next.name, startsOn: next.starts_on } : null, today: day };
  }
  const who = await maybeAccount(ctx);
  if (who) seed = await memberSeed(db, who.account.id, p, seed, now);
  const t = topicFor(seed, p, day);
  const file = await retry(() => db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = ? AND live = 1").bind(p.id + '/' + t.n).first('body'));
  return { state: 'live', ...dayView(p, day, t), seed, topic: file ? JSON.parse(file) : null };
}

/* POST /v1/bread/open { seed, kind } → { counted } */
export async function breadOpen(ctx) {
  const db = ctx.env.DB;
  await requireModule(db);
  await limit(ctx, 'bread.open', clientIp(ctx.request), 60, 60);
  const seed = seedOf(ctx.body);
  const kind = ctx.body.kind === 'read' ? 'read' : ctx.body.kind === 'open' ? 'open' : null;
  if (!kind) throw bad('الطلب مش مفهوم.');
  const day = cairoDay();
  const p = currentOf(await datedPrograms(db), day);
  if (!p) return { counted: false };
  const hash = (await pseudonym(ctx.env, 'bread:' + seed)).slice(0, 32);
  // once per device, day and kind: the counter moves only when the row is new (changes() of the insert just before)
  const r = await retry(() => db.batch([
    db.prepare('INSERT INTO bread_opens (day, device_hash, kind, program_id) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(day, hash, kind, p.id),
    db.prepare(`INSERT INTO bread_daily (day, program_id, ${kind === 'read' ? 'reads' : 'opens'}) SELECT ?, ?, 1 WHERE changes() = 1
      ON CONFLICT(day, program_id) DO UPDATE SET ${kind === 'read' ? 'reads = reads' : 'opens = opens'} + 1`).bind(day, p.id)
  ]));
  return { counted: r[0].meta.changes === 1 };
}

/* POST /v1/bread/slots { token, seed, times? } → { times, max, defaultTime } */
export async function breadSlots(ctx) {
  const db = ctx.env.DB;
  await requireModule(db);
  const body = ctx.body || {};
  const token = typeof body.token === 'string' && TOKEN.test(body.token) ? body.token : '';
  if (!token) throw bad('فعّل الإشعارات الأول.');
  await limit(ctx, 'bread.slots', clientIp(ctx.request), 30, 60);
  const id = await pushHash(token);
  const s = await breadSettings(db);
  const out = rows => ({ times: rows.map(r => timeOf(r.minute)), max: s.maxSlots, defaultTime: s.defaultTime });
  if (body.times === undefined) {
    const [rows, off] = await retry(() => db.batch([
      db.prepare('SELECT minute FROM bread_slots WHERE device_id = ? ORDER BY minute').bind(id),
      db.prepare('SELECT 1 AS y FROM bread_optout WHERE device_id = ?').bind(id)
    ]));
    // W6: never chose, never turned off → on at the default time (the page saves it with its own seed)
    return { ...out(rows.results), auto: !rows.results.length && !off.results.length };
  }
  if (!Array.isArray(body.times) || body.times.length > s.maxSlots) throw bad('لحد ' + s.maxSlots + ' مواعيد.');
  const minutes = [...new Set(body.times.map(minuteOf))];
  if (minutes.some(m => m === null)) throw bad('الميعاد مش مفهوم.');
  const seed = minutes.length ? seedOf(body) : '';
  if (minutes.length) {
    const device = await retry(() => db.prepare("SELECT id FROM push_devices WHERE id = ? AND audience = 'public'").bind(id).first());
    if (!device) throw new ApiError('invalid', 'no_device', { message: 'فعّل الإشعارات الأول.', reason: 'no_device' });
  }
  const now = Date.now();
  await retry(() => db.batch([
    db.prepare('DELETE FROM bread_slots WHERE device_id = ?').bind(id),
    minutes.length ? db.prepare('DELETE FROM bread_optout WHERE device_id = ?').bind(id) : db.prepare('INSERT OR REPLACE INTO bread_optout (device_id, created_ms) VALUES (?, ?)').bind(id, now),
    ...minutes.map(m => db.prepare('INSERT INTO bread_slots (device_id, minute, seed, created_ms) VALUES (?, ?, ?, ?)').bind(id, m, seed, now))
  ]));
  return out(minutes.sort((a, b) => a - b).map(minute => ({ minute })));
}

/* ---------- reflections (signed in) ---------- */

async function signedIn(ctx) {
  const who = await maybeAccount(ctx);
  if (!who) throw new ApiError('session');
  const e = eligibility(who.account, rulesFrom(who.settings));
  if (e.state === 'blocked') throw new ApiError('blocked', 'bread');
  return { ...who, state: e.state };
}

const reflectionView = (r, now) => r && ({
  id: r.id, n: r.n, day: r.day, text: r.text, createdMs: r.created_ms, editedMs: r.edited_ms,
  editableUntil: r.created_ms + EDIT_MS, editable: now - r.created_ms <= EDIT_MS
});

/* POST /v1/bread/me { seed } → { seed, look, state, today, reflection } */
export async function breadMe(ctx) {
  const db = ctx.env.DB;
  await requireModule(db);
  const who = await signedIn(ctx);
  await limit(ctx, 'bread.me', who.account.id, 60, 60);
  const seed = seedOf(ctx.body);
  const now = Date.now();
  const day = cairoDay(now);
  const p = currentOf(await datedPrograms(db), day);
  const look = who.account.bread_look === 'dawn' ? 'dawn' : 'night';
  if (!p) return { seed, look, state: who.state, today: null, reflection: null };
  const kept = await memberSeed(db, who.account.id, p, seed, now);
  const t = topicFor(kept, p, day);
  const r = await retry(() => db.prepare('SELECT * FROM bread_reflections WHERE participant_id = ? AND program_id = ? AND n = ? AND deleted_ms IS NULL').bind(who.account.id, p.id, t.n).first());
  return { seed: kept, look, state: who.state, today: dayView(p, day, t), reflection: reflectionView(r, now) };
}

function cleanText(v) {
  if (typeof v !== 'string') throw bad('اكتب تأملك.');
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (!s) throw bad('اكتب تأملك.');
  if (s.length > LIMITS.reflection) throw bad('التأمل أطول من ' + LIMITS.reflection + ' حرف.');
  return s;
}

/* POST /v1/bread/reflection { seed, text } → { reflection } */
export async function breadReflect(ctx) {
  const db = ctx.env.DB;
  await requireModule(db);
  const who = await signedIn(ctx);
  await limit(ctx, 'bread.reflect', who.account.id, 10, 60);
  await limit(ctx, 'bread.reflect.day', who.account.id, 40, 86400);
  const seed = seedOf(ctx.body);
  const text = cleanText(ctx.body.text);
  const now = Date.now();
  const day = cairoDay(now);
  const p = currentOf(await datedPrograms(db), day);
  if (!p) throw new ApiError('not_found', 'bread', { message: 'مفيش قراءة النهارده.' });
  const kept = await memberSeed(db, who.account.id, p, seed, now);
  const t = topicFor(kept, p, day);
  const id = randomId('rfl-', 6);
  // a new one, or the slot of one deleted earlier; an existing reflection stays as it is
  const r = await retry(() => db.batch([
    db.prepare(`INSERT INTO bread_reflections (id, participant_id, program_id, n, day, text, state, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(participant_id, program_id, n) DO UPDATE SET id = excluded.id, day = excluded.day, text = excluded.text, state = excluded.state,
        created_ms = excluded.created_ms, edited_ms = NULL, deleted_ms = NULL WHERE bread_reflections.deleted_ms IS NOT NULL`)
      .bind(id, who.account.id, p.id, t.n, day, text, who.state, now),
    db.prepare(`INSERT INTO bread_daily (day, program_id, reflections) SELECT ?, ?, 1 WHERE changes() = 1
      ON CONFLICT(day, program_id) DO UPDATE SET reflections = reflections + 1`).bind(day, p.id),
    db.prepare('SELECT * FROM bread_reflections WHERE participant_id = ? AND program_id = ? AND n = ?').bind(who.account.id, p.id, t.n)
  ]));
  const row = r[2].results[0];
  if (r[0].meta.changes !== 1) throw new ApiError('conflict', 'bread reflection', { message: 'انت كتبت تأمل النهارده خلاص.', reflection: reflectionView(row, now) });
  return { reflection: reflectionView(row, now) };
}

/* the member's own reflection, still inside its 20 minutes */
async function ownEditable(ctx, who, now) {
  const id = String(ctx.body && ctx.body.id || '');
  if (!ID.test(id)) throw bad('الطلب مش مفهوم.');
  const r = await retry(() => ctx.env.DB.prepare('SELECT * FROM bread_reflections WHERE id = ? AND participant_id = ? AND deleted_ms IS NULL').bind(id, who.account.id).first());
  if (!r) throw new ApiError('not_found', 'bread', { message: 'التأمل ده مش موجود.' });
  if (now - r.created_ms > EDIT_MS) throw new ApiError('locked', 'bread reflection', { message: 'عدّت ٢٠ دقيقة: التأمل اتقفل ومينفعش يتعدّل أو يتمسح.', hint: '' });
  return r;
}

/* POST /v1/bread/reflection/edit { id, text } */
export async function breadReflectEdit(ctx) {
  const db = ctx.env.DB;
  await requireModule(db);
  const who = await signedIn(ctx);
  await limit(ctx, 'bread.reflect', who.account.id, 10, 60);
  const now = Date.now();
  const r = await ownEditable(ctx, who, now);
  const text = cleanText(ctx.body.text);
  // the window is checked again in the statement itself (a slow request never edits a locked one)
  const u = await retry(() => db.prepare('UPDATE bread_reflections SET text = ?, edited_ms = ? WHERE id = ? AND deleted_ms IS NULL AND created_ms >= ?').bind(text, now, r.id, now - EDIT_MS).run());
  if (!u.meta.changes) throw new ApiError('locked', 'bread reflection', { message: 'عدّت ٢٠ دقيقة: التأمل اتقفل.', hint: '' });
  return { reflection: reflectionView({ ...r, text, edited_ms: now }, now) };
}

/* POST /v1/bread/reflection/delete { id } */
export async function breadReflectDelete(ctx) {
  const db = ctx.env.DB;
  await requireModule(db);
  const who = await signedIn(ctx);
  await limit(ctx, 'bread.reflect', who.account.id, 10, 60);
  const now = Date.now();
  const r = await ownEditable(ctx, who, now);
  const u = await retry(() => db.batch([
    db.prepare("UPDATE bread_reflections SET text = '', deleted_ms = ? WHERE id = ? AND deleted_ms IS NULL AND created_ms >= ?").bind(now, r.id, now - EDIT_MS),
    db.prepare('UPDATE bread_daily SET reflections = MAX(0, reflections - 1) WHERE day = ? AND program_id = ? AND changes() = 1').bind(r.day, r.program_id)
  ]));
  if (!u[0].meta.changes) throw new ApiError('locked', 'bread reflection', { message: 'عدّت ٢٠ دقيقة: التأمل اتقفل.', hint: '' });
  return { deleted: r.id };
}

