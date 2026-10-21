/*
 * The admin panel's session, presence and edit locks on the Worker (Phase 3,
 * docs/ADMIN-PLATFORM-PLAN.md). A port of apps-script/Presence.gs: the same
 * rules and the same answers, in D1 instead of CacheService, and with no
 * global lock (each heartbeat is one D1 batch).
 *
 * - One live session per account (admin_sessions, keyed by email). Live = a
 *   heartbeat < STALE_MS ago and its page did not leave (parked).
 * - Start: a live session elsewhere answers { active } (the takeover
 *   question) unless force, the same page load (tab), a session that never
 *   drew its panel on the same device label, or the same trusted device.
 * - The answer carries the panel token (wk1 with the sid inside,
 *   lib/auth.js mintPanelToken): every later Worker call is checked against
 *   the account's live sid (session_replaced / session_expired), and Apps
 *   Script checks the same token through POST /v1/sync/session.
 * - Park (the page leaves) / resume (the same tab after a reload) / end.
 * - Heartbeat: renews the session, takes/renews the wanted edit locks and
 *   lets go of the others, says where the admin is; answers with the lock
 *   states, who else is online, what the others did (activity), and a
 *   renewed token when the current one is near its end.
 *
 * Off (code 'off') until settings.ADMIN_PLATFORM = '1'.
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { mintPanelToken, verifyWorkerToken } from '../lib/auth.js';
import { verifySync } from '../lib/sync.js';
import { bootPayload } from './bootstrap.js';

export const STALE_MS = 90 * 1000;          // no heartbeat this long: taken over without asking
export const ONLINE_MS = 70 * 1000;         // shown as online
export const LOCK_MS = 90 * 1000;           // a lock outlives its last heartbeat by this much
export const PARK_MS = 45 * 1000;           // a parked session keeps its locks and shows online this long
export const RESUME_MS = 2 * 3600 * 1000;   // a parked or quiet session can be picked up by its tab this long
export const KEEP_MS = 6 * 3600 * 1000;     // a session row (and a replaced sid) is forgotten after this
export const MAX_LOCKS = 6;
const RENEW_BEFORE_S = 5 * 60;              // the heartbeat brings a new token this close to the end

export const LOCK_KINDS = ['sessions', 'news', 'games', 'notifications', 'activities', 'types', 'links', 'contacts', 'sections', 'settings', 'media',
  'comp', 'participant', 'shopitem', 'page', 'event', 'servant'];

const SID_RE = /^[\w-]{16,64}$/;

/* the switch: settings.ADMIN_PLATFORM = '1' */
export async function platformOn(env) {
  const v = await retry(() => env.DB.prepare("SELECT value FROM settings WHERE key = 'ADMIN_PLATFORM'").first('value'));
  return v === '1';
}

async function requireOn(env) {
  if (!(await platformOn(env))) throw new ApiError('off', 'ADMIN_PLATFORM');
}

/* text from the page shown to other admins: one line, no controls/bidi tricks, no < > */
export function cleanLabel(value, max) {
  if (value == null || typeof value === 'object') return '';
  let out = '';
  for (const ch of String(value)) {
    const c = ch.codePointAt(0);
    const junk = c < 32 || (c >= 127 && c <= 159) || (c >= 8203 && c <= 8207) || (c >= 8232 && c <= 8238) ||
      (c >= 8294 && c <= 8297) || c === 65279 || c === 60 || c === 62;
    out += junk ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

const cleanPlace = v => (/^[a-z][a-z-]{0,23}$/.test(String(v == null ? '' : v)) ? String(v) : '');
const cleanTab = v => (typeof v === 'string' && SID_RE.test(v) ? v : '');

export function cleanLockKey(value) {
  const m = /^([a-z]+):([\w.,-]{1,80})$/.exec(typeof value === 'string' ? value : '');
  return m && LOCK_KINDS.includes(m[1]) ? m[0] : '';
}

function cleanItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const kind = LOCK_KINDS.includes(item.kind) ? item.kind : '';
  const id = typeof item.id === 'string' && /^[\w.,-]{1,80}$/.test(item.id) ? item.id : '';
  const label = cleanLabel(item.label, 80);
  return kind || label ? { kind, id, label } : null;
}

const ageS = (stamp, now) => (Number.isFinite(Number(stamp)) ? Math.max(0, Math.round((now - Number(stamp)) / 1000)) : 0);
const isLive = (row, now) => !!(row && row.sid && row.parked_ms == null && now - row.seen_ms < STALE_MS);
const parkedOut = (row, now) => !!(row && row.parked_ms != null && now - row.parked_ms >= PARK_MS);
const activeOf = (row, now) => ({ device: cleanLabel(row.device, 40), since: ageS(row.since_ms, now), seen: ageS(row.seen_ms, now) });
const nameOf = (name, email) => name || String(email).split('@')[0];

function replaced() { return new ApiError('session_replaced', 'replaced'); }
function expired() { return new ApiError('session_expired', 'expired'); }

async function sessionRow(db, email) {
  return retry(() => db.prepare('SELECT * FROM admin_sessions WHERE email = ?').bind(email).first());
}

/* replaced vs ended: a sid that was taken over is remembered (KEEP_MS) */
async function goneError(db, sid) {
  const gone = sid ? await retry(() => db.prepare('SELECT 1 AS x FROM admin_sessions_gone WHERE sid = ?').bind(sid).first()) : null;
  return gone ? replaced() : expired();
}

/* the statements that end a session row's hold: its panel locks go, its sid is remembered when replaced */
function endStmts(db, row, now, remember) {
  const out = [db.prepare("DELETE FROM edit_locks WHERE sid = ? AND kind <> 'booking'").bind(row.sid)];
  if (remember) out.push(db.prepare('INSERT OR IGNORE INTO admin_sessions_gone (sid, at_ms) VALUES (?, ?)').bind(row.sid, now));
  return out;
}

/* the panel token keeps naming the trusted device it came from (lib/auth.js checks it every call) */
async function tokenFor(ctx, sid, via) {
  return mintPanelToken(ctx.env, { email: ctx.actor.email, sid, via, deviceId: ctx.deviceId || '' });
}

function viaOf(actor) {
  return actor.via === 'device' ? 'device' : 'google';
}

/*
 * POST /v1/admin/session/start { device, tab, force, boot } (Google token, or a device's token)
 * → { sid, token, exp, device, boot? } | { active: { device, since, seen } }
 * boot: true → the panel's opening data in the same answer (bootstrap.js)
 * ctx.deviceId: set by the device sign-in (the same trusted device takes its own session over).
 */
export async function sessionStart(ctx, now = Date.now()) {
  await requireOn(ctx.env);
  const db = ctx.env.DB;
  const b = ctx.body || {};
  const email = ctx.actor.email;
  const device = cleanLabel(b.device, 40) || 'جهاز';
  const tab = cleanTab(b.tab);
  const deviceId = ctx.deviceId || null;
  const row = await sessionRow(db, email);
  const live = isLive(row, now);
  const unconfirmed = live && !row.beats && cleanLabel(row.device, 40) === device;
  const sameDevice = live && !!deviceId && row.device_id === deviceId;

  if (live && b.force !== true && !(tab && row.tab === tab) && !unconfirmed && !sameDevice) {
    return { active: activeOf(row, now) };
  }

  const sid = crypto.randomUUID();
  const stmts = row ? endStmts(db, row, now, true) : [];
  if (row && live && b.force === true) {
    stmts.push(activityStmt(db, {
      actor: email, actorName: ctx.actor.name, action: 'session.takeover', entityType: 'session', entityId: '', entityTitle: '',
      summary: 'دخل من ' + device + ' وقفل الجلسة على ' + cleanLabel(row.device, 40), changes: { device, from: cleanLabel(row.device, 40) }, device
    }));
  }
  // guarded: a parallel start that already replaced the row wins, this one retries the question
  stmts.push(db.prepare(
    'INSERT INTO admin_sessions (email, sid, tab, device, device_id, via, since_ms, seen_ms, parked_ms, hidden_ms, beats, area, view, item) ' +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, '', '', NULL) " +
    'ON CONFLICT(email) DO UPDATE SET sid = excluded.sid, tab = excluded.tab, device = excluded.device, device_id = excluded.device_id, ' +
    'via = excluded.via, since_ms = excluded.since_ms, seen_ms = excluded.seen_ms, parked_ms = NULL, hidden_ms = NULL, beats = 0, ' +
    "area = '', view = '', item = NULL WHERE admin_sessions.sid = ?"
  ).bind(email, sid, tab, device, deviceId, viaOf(ctx.actor), now, now, row ? row.sid : ''));
  const r = await retry(() => db.batch(stmts));
  if (r[r.length - 1].meta.changes !== 1) throw new ApiError('busy', 'session raced');

  ctx.defer(db.prepare('UPDATE admins SET last_seen = ? WHERE email = ?').bind(now, email).run());
  const [t, boot] = await Promise.all([tokenFor(ctx, sid, viaOf(ctx.actor)), b.boot === true ? bootPayload(ctx, now) : null]);
  return boot ? { sid, token: t.token, exp: t.exp, device, boot } : { sid, token: t.token, exp: t.exp, device };
}

/*
 * POST /v1/admin/session/resume { sid, device, tab, prev, left }
 * The same tab after a reload: the SAME session (sid, locks, presence) goes on.
 * → { sid, token, exp, device, resumed } | { active } | session_replaced / session_expired
 */
export async function sessionResume(ctx, now = Date.now()) {
  await requireOn(ctx.env);
  const db = ctx.env.DB;
  const b = ctx.body || {};
  const email = ctx.actor.email;
  const sid = typeof b.sid === 'string' && SID_RE.test(b.sid) ? b.sid : '';
  if (!sid) throw new ApiError('session_replaced', 'no sid');
  const device = cleanLabel(b.device, 40) || 'جهاز';
  const tab = cleanTab(b.tab);
  const prev = cleanTab(b.prev);
  const row = await sessionRow(db, email);

  if (!row || row.sid !== sid) throw row ? replaced() : await goneError(db, sid);

  if (!(now - (row.parked_ms != null ? row.parked_ms : row.seen_ms) < RESUME_MS)) {
    await retry(() => db.batch([...endStmts(db, row, now, false), db.prepare('DELETE FROM admin_sessions WHERE email = ? AND sid = ?').bind(email, sid)]));
    throw expired();
  }

  const reloaded = !!(prev && b.left === true && row.tab === prev);
  if (isLive(row, now) && !reloaded) return { active: activeOf(row, now) };

  const r = await retry(() => db.prepare('UPDATE admin_sessions SET parked_ms = NULL, tab = ?, device = ?, seen_ms = ? WHERE email = ? AND sid = ?')
    .bind(tab, device, now, email, sid).run());
  if (r.meta.changes !== 1) throw replaced();
  const [t, boot] = await Promise.all([tokenFor(ctx, sid, viaOf(ctx.actor)), b.boot === true ? bootPayload(ctx, now) : null]);
  return boot ? { sid, token: t.token, exp: t.exp, device, resumed: true, boot } : { sid, token: t.token, exp: t.exp, device, resumed: true };
}

/*
 * POST /v1/admin/session/renew { sid } — a fresh panel token for the open panel
 * (its token ran out while the tab was hidden: no heartbeat renewed it).
 * Auth: Google, a device token, or the panel token itself. Only the account's live sid.
 */
export async function sessionRenew(ctx) {
  await requireOn(ctx.env);
  const b = ctx.body || {};
  const sid = typeof b.sid === 'string' && SID_RE.test(b.sid) ? b.sid : '';
  const row = await sessionRow(ctx.env.DB, ctx.actor.email);
  if (!sid || !row || row.sid !== sid) throw row ? replaced() : await goneError(ctx.env.DB, sid);
  const t = await tokenFor(ctx, sid, row.via === 'device' ? 'device' : 'google');
  return { sid, token: t.token, exp: t.exp };
}

/* POST /v1/admin/session/end — sign out: the session and its locks end now */
export async function sessionEnd(ctx) {
  await requireOn(ctx.env);
  const db = ctx.env.DB;
  const row = ctx.session;
  if (!row) return { ended: false };
  await retry(() => db.batch([...endStmts(db, row, Date.now(), false), db.prepare('DELETE FROM admin_sessions WHERE email = ? AND sid = ?').bind(row.email, row.sid)]));
  return { ended: true };
}

/*
 * POST /v1/admin/session/park (public route: a beacon can't send headers)
 * text/plain body { token, tab } — the panel token itself says who and which session.
 * Parks the session for that page load only; a late goodbye from a page load
 * that already reloaded and resumed changes nothing.
 */
export async function sessionPark(ctx, now = Date.now()) {
  let body = null;
  try { body = JSON.parse(new TextDecoder().decode(ctx.raw)); } catch { body = null; }
  if (!body || typeof body !== 'object') throw new ApiError('bad', 'park body');
  const claims = await verifyWorkerToken(ctx.env, body.token, now);
  if (!claims.sid) throw new ApiError('auth', 'no sid');
  const tab = cleanTab(body.tab);
  const r = await retry(() => ctx.env.DB.prepare(
    "UPDATE admin_sessions SET parked_ms = ? WHERE email = ? AND sid = ? AND (tab = '' OR tab = ?)"
  ).bind(now, claims.email, claims.sid, tab).run());
  return { parked: r.meta.changes === 1 };
}

/*
 * POST /v1/admin/session/heartbeat { area, view, item, locks: ['<kind>:<key>'], hidden, since }
 * → { locks: { key: { granted } | { granted: false, holder } }, others, activity?, token?, exp? }
 * One D1 batch: the lock upserts, the release of the others, the session
 * renewal, then the reads (the lock rows, who is online, the activity).
 */
export async function sessionHeartbeat(ctx, now = Date.now()) {
  await requireOn(ctx.env);
  const db = ctx.env.DB;
  const b = ctx.body || {};
  const me = ctx.session;
  // only the panel token carries a session (a Google token alone is none)
  if (!me) throw expired();
  const wanted = [];
  for (const v of Array.isArray(b.locks) ? b.locks : []) {
    const key = cleanLockKey(v);
    if (key && !wanted.includes(key) && wanted.length < MAX_LOCKS) wanted.push(key);
  }

  const stmts = wanted.map(key => {
    const i = key.indexOf(':');
    return db.prepare(
      'INSERT INTO edit_locks (kind, id, email, name, sid, since_ms, expires_ms) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(kind, id) DO UPDATE SET email = excluded.email, name = excluded.name, sid = excluded.sid, ' +
      'since_ms = CASE WHEN edit_locks.sid = excluded.sid THEN edit_locks.since_ms ELSE excluded.since_ms END, expires_ms = excluded.expires_ms ' +
      // free: its own, run out, or its holder is no longer its account's session (or parked past the grace)
      'WHERE edit_locks.sid = excluded.sid OR edit_locks.expires_ms < ? OR NOT EXISTS ' +
      '(SELECT 1 FROM admin_sessions s WHERE s.sid = edit_locks.sid AND (s.parked_ms IS NULL OR s.parked_ms > ?))'
    ).bind(key.slice(0, i), key.slice(i + 1), me.email, String(ctx.actor.name || '').slice(0, 80), me.sid, now, now + LOCK_MS, now, now - PARK_MS);
  });
  stmts.push(db.prepare("DELETE FROM edit_locks WHERE sid = ? AND kind <> 'booking' AND (kind || ':' || id) NOT IN (SELECT value FROM json_each(?))")
    .bind(me.sid, JSON.stringify(wanted)));
  const item = cleanItem(b.item);
  stmts.push(db.prepare(
    'UPDATE admin_sessions SET seen_ms = ?, parked_ms = NULL, hidden_ms = ?, beats = MIN(beats + 1, 1000000), area = ?, view = ?, item = ? WHERE email = ? AND sid = ?'
  ).bind(now, b.hidden === true ? now : null, cleanPlace(b.area), cleanPlace(b.view), item ? JSON.stringify(item) : null, me.email, me.sid));
  const nWrites = stmts.length;
  stmts.push(db.prepare("SELECT l.kind, l.id, l.sid, l.email, l.since_ms, s.device, a.name FROM edit_locks l LEFT JOIN admin_sessions s ON s.sid = l.sid " +
    "LEFT JOIN admins a ON a.email = l.email WHERE l.kind <> 'booking' AND (l.kind || ':' || l.id) IN (SELECT value FROM json_each(?))").bind(JSON.stringify(wanted)));
  stmts.push(db.prepare('SELECT s.email, s.device, s.seen_ms, s.parked_ms, s.area, s.view, s.item, a.name FROM admin_sessions s JOIN admins a ON a.email = s.email ' +
    'WHERE s.email <> ? AND a.active = 1 AND s.seen_ms > ? ORDER BY s.email').bind(me.email, now - ONLINE_MS));
  const since = Number(b.since);
  const withActivity = b.since !== undefined && Number.isFinite(since) && since > 0;
  if (withActivity) {
    stmts.push(db.prepare('SELECT a.id, a.at, a.actor, a.actor_name, d.name AS admin_name, a.action, a.entity_type, a.entity_id, a.entity_title, a.summary, a.count, a.severity ' +
      "FROM activity a LEFT JOIN admins d ON d.email = a.actor WHERE a.at > ? AND a.actor <> ? AND a.actor NOT IN ('system', 'public') ORDER BY a.at DESC LIMIT 5").bind(since, me.email));
  }

  const r = await retry(() => db.batch(stmts));
  if (r[nWrites - 1].meta.changes !== 1) throw await goneError(db, me.sid);

  const locks = {};
  const rows = new Map(r[nWrites].results.map(x => [x.kind + ':' + x.id, x]));
  for (const key of wanted) {
    const x = rows.get(key);
    locks[key] = x && x.sid === me.sid ? { granted: true }
      : { granted: false, holder: x ? { email: x.email, name: nameOf(x.name, x.email), device: cleanLabel(x.device, 40), since: ageS(x.since_ms, now) } : null };
  }
  const others = r[nWrites + 1].results.filter(x => !parkedOut(x, now)).map(x => {
    let it = null;
    try { it = cleanItem(x.item ? JSON.parse(x.item) : null); } catch { it = null; }
    return { email: x.email, name: nameOf(x.name, x.email), device: cleanLabel(x.device, 40), seen: ageS(x.seen_ms, now), area: cleanPlace(x.area), view: cleanPlace(x.view), item: it };
  });

  const out = { locks, others };
  if (withActivity) {
    out.activity = r[nWrites + 2].results.reverse().map(x => {
      const shown = x.admin_name || x.actor_name || String(x.actor).split('@')[0];
      return { id: x.id, at: x.at, actor: x.actor, actorName: shown, action: x.action, type: x.entity_type || '', entityId: x.entity_id || '',
        title: x.entity_title || '', summary: x.summary || '', text: shown + ' ' + (x.summary || ''), count: x.count || 1, severity: x.severity || 'routine' };
    });
  }
  if (ctx.tokenExp && ctx.tokenExp - Math.floor(now / 1000) < RENEW_BEFORE_S) {
    const t = await tokenFor(ctx, me.sid, me.via === 'device' ? 'device' : 'google');
    out.token = t.token;
    out.exp = t.exp;
  }
  return out;
}

/*
 * POST /v1/sync/session (Apps Script, signed): { email, sid, locks?: ['<kind>:<key>'], all?: true }
 * → { state: 'live' | 'replaced' | 'expired', holders: { key: { email, name, device, since } } }
 * What apps-script/Presence.gs requireSession_ / assertUnlocked_ ask while the
 * Worker owns the sessions. Read-only (no replay stamp: an answer, never a change).
 * all: every live panel lock (Apps Script asks once BEFORE a write, outside its script lock).
 */
export async function syncSession(ctx, now = Date.now()) {
  const { body } = await verifySync(ctx.env, ctx.request, new TextDecoder().decode(ctx.raw), 'session', now, { monotonic: false });
  const email = String(body.email || '').toLowerCase();
  const sid = typeof body.sid === 'string' && SID_RE.test(body.sid) ? body.sid : '';
  const keys = (Array.isArray(body.locks) ? body.locks : []).map(cleanLockKey).filter(Boolean).slice(0, 20);
  const all = body.all === true;
  const db = ctx.env.DB;
  const [s, gone, l] = await retry(() => db.batch([
    db.prepare('SELECT sid FROM admin_sessions WHERE email = ?').bind(email),
    db.prepare('SELECT 1 AS x FROM admin_sessions_gone WHERE sid = ?').bind(sid),
    db.prepare('SELECT l.kind, l.id, l.sid, l.email, l.since_ms, l.expires_ms, s.device, s.parked_ms, a.name FROM edit_locks l ' +
      'JOIN admin_sessions s ON s.sid = l.sid LEFT JOIN admins a ON a.email = l.email ' +
      "WHERE l.kind <> 'booking' AND (? OR (l.kind || ':' || l.id) IN (SELECT value FROM json_each(?)))").bind(all ? 1 : 0, JSON.stringify(keys))
  ]));
  const live = s.results[0] && s.results[0].sid;
  const state = sid && live === sid ? 'live' : live || gone.results.length ? 'replaced' : 'expired';
  const holders = {};
  for (const x of l.results) {
    if (x.sid === sid || !(x.expires_ms > now) || parkedOut(x, now)) continue;
    holders[x.kind + ':' + x.id] = { email: x.email, name: nameOf(x.name, x.email), device: cleanLabel(x.device, 40), since: ageS(x.since_ms, now) };
  }
  return { state, holders };
}

/* daily housekeeping (scheduled.js): forgotten sessions, old replaced sids, used nonces */
export function sessionSweepStmts(db, now = Date.now()) {
  return [
    db.prepare('DELETE FROM admin_sessions WHERE seen_ms < ? AND (parked_ms IS NULL OR parked_ms < ?)').bind(now - KEEP_MS, now - KEEP_MS),
    db.prepare('DELETE FROM admin_sessions_gone WHERE at_ms < ?').bind(now - KEEP_MS),
    db.prepare('DELETE FROM admin_device_nonces WHERE exp_ms < ?').bind(now)
  ];
}
