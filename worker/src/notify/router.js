/*
 * The notification router (Phase 1.5 step 5, BOOKING-PHASE1-COMPLETION-PLAN §4.4).
 * Cron, every minute: activity rows not yet routed → notify_outbox rows, one
 * per recipient and channel, in the same batch that marks the rows routed.
 *
 *   activity.notified   0 waiting · 1 routed · 2 nothing to send · 3 backlog (never sent)
 *
 * - Switch NOTIFY_ROUTER (D1 settings): '0' = nothing happens here and Apps
 *   Script keeps its own admin pushes, as before. The first tick after it is
 *   turned on stamps NOTIFY_SINCE and marks every older waiting row 3: an
 *   old backlog never turns into a flood.
 * - Recipients: active admins holding the type's permission (the grants, as
 *   lib/perms.js reads them), never the one who did it; the type's list
 *   ({ mode: 'all' | 'named', include, exclude }); the Primary Admin always
 *   gets a critical one.
 * - Channels: the type's settings (or the level's defaults), then each
 *   admin's own preference unless the type is locked. Email only while
 *   NOTIFY_EMAIL = '1'. A summary email collects the day's rows in one row.
 * - Dedupe: dedupe_key UNIQUE = type:entity:recipient:channel:window. A row
 *   inside a grouping window that is still waiting gets the new activity id
 *   added; once sent, the next one starts a new row.
 */

import { retry, cairoText } from '../lib/db.js';
import { randomId } from '../lib/hash.js';
import { PRIMARY_DEFAULT } from '../lib/perms.js';
import { typeOf, defaultsOf } from './catalog.js';

export const ROUTE_BATCH = 50;
const SENDABLE = ['queued', 'deferred', 'failed'];

export async function readSettings(db) {
  const rows = (await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'NOTIFY_%' OR key LIKE 'MAIL_%' OR key = 'PERMS_ENFORCE'").all()).results;
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

/* 'HH:MM' Cairo → the next such moment (ms) from `now` */
export function nextSummaryMs(time, now) {
  const [h, m] = /^(\d{2}):(\d{2})$/.test(time || '') ? time.split(':').map(Number) : [21, 0];
  const today = cairoText(now).slice(0, 10);
  // Cairo offset at `now`, from the wall clock text
  const wall = Date.parse(cairoText(now).replace(' ', 'T') + ':00Z');
  const offset = wall - Math.floor(now / 60000) * 60000;
  let at = Date.parse(today + 'T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00Z') - offset;
  if (at <= now) at += 24 * 3600 * 1000;
  return at;
}

async function people(db) {
  const [admins, grants, settings, prefs] = await db.batch([
    db.prepare('SELECT email, name, role FROM admins WHERE active = 1'),
    db.prepare('SELECT g.email, g.perm FROM admin_grants g JOIN admins a ON a.email = g.email AND a.active = 1'),
    db.prepare('SELECT type, email_mode, push, recipients, locked FROM notify_settings'),
    db.prepare('SELECT email, type, channel, mode FROM notify_prefs')
  ]);
  const held = new Map();
  for (const g of grants.results) {
    if (!held.has(g.email)) held.set(g.email, new Set());
    held.get(g.email).add(g.perm);
  }
  const types = new Map();
  for (const s of settings.results) {
    let rec = {};
    try { rec = JSON.parse(s.recipients || '{}') || {}; } catch { rec = {}; }
    types.set(s.type, { email: s.email_mode, push: !!s.push, mode: rec.mode === 'named' ? 'named' : 'all', include: rec.include || [], exclude: rec.exclude || [], locked: !!s.locked });
  }
  const pref = new Map();
  for (const p of prefs.results) pref.set(p.email + '|' + p.type + '|' + p.channel, p.mode);
  return { admins: admins.results, held, types, pref };
}

function holds(who, perm, held, enforce) {
  if (who.role === 'primary') return true;
  if (held.has(who.email) && held.get(who.email).has(perm)) return true;
  return !enforce && !PRIMARY_DEFAULT.includes(perm);
}

/* one activity row → [{ recipient, channel, mode }] */
export function plan(row, type, ctx) {
  const { admins, held, types, pref, enforce, emailOn } = ctx;
  const set = types.get(type.key) || {};
  const d = defaultsOf(type.level);
  const push = set.push !== undefined ? set.push : d.push;
  const email = set.email || d.email;
  const out = [];
  for (const a of admins) {
    const primary = a.role === 'primary';
    if (a.email === row.actor) continue;
    const forcedCritical = primary && type.level === 'critical';
    if (!forcedCritical) {
      // only holders of the permission; then the type's list: everyone (minus exclude) or named only
      if (!holds(a, type.perm, held, enforce)) continue;
      if ((set.exclude || []).includes(a.email)) continue;
      if (set.mode === 'named' && !(set.include || []).includes(a.email)) continue;
    }
    const own = ch => (set.locked || forcedCritical ? undefined : pref.get(a.email + '|' + type.key + '|' + ch));
    const pushMode = own('push');
    if ((push || forcedCritical) && pushMode !== 'off') out.push({ recipient: a.email, channel: 'push', mode: 'immediate' });
    if (emailOn && type.email !== false) {
      const mode = forcedCritical ? 'immediate' : (own('email') || email);
      if (mode === 'immediate' || mode === 'summary') out.push({ recipient: a.email, channel: 'email', mode });
    }
  }
  return out;
}

/* Routes up to ROUTE_BATCH rows. → { routed, skipped, backlog, rows } */
export async function route(env, now = Date.now()) {
  const db = env.DB;
  const s = await retry(() => readSettings(db));
  if (s.NOTIFY_ROUTER !== '1') return { off: true };

  // first tick after the switch: older waiting rows never go out (no flood)
  if (!s.NOTIFY_SINCE) {
    const r = await retry(() => db.batch([
      db.prepare("INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES ('NOTIFY_SINCE', ?, ?, 'router')").bind(String(now), now),
      db.prepare('UPDATE activity SET notified = 3 WHERE notified = 0 AND at < ?').bind(now)
    ]));
    return { backlog: r[1].meta.changes, routed: 0, skipped: 0 };
  }
  const since = Number(s.NOTIFY_SINCE);

  const rows = (await retry(() => db.prepare(`SELECT a.id, a.at, a.cairo, a.actor, a.actor_name, a.action, a.entity_type, a.entity_id, a.entity_title, a.summary, a.severity,
      b.event_id FROM activity a LEFT JOIN bookings b ON b.id = a.entity_id AND a.entity_type = 'booking'
      WHERE a.notified = 0 AND a.at >= ? ORDER BY a.at LIMIT ?`).bind(since, ROUTE_BATCH).all())).results;
  if (!rows.length) return { routed: 0, skipped: 0 };

  const ctx = { ...(await retry(() => people(db))), enforce: s.PERMS_ENFORCE === '1', emailOn: s.NOTIFY_EMAIL === '1' };
  const summaryAt = nextSummaryMs(s.NOTIFY_SUMMARY_TIME, now);
  const wanted = [];
  const marks = [];
  for (const row of rows) {
    const type = typeOf(row);
    const targets = type ? plan(row, type, ctx) : [];
    marks.push({ id: row.id, notified: targets.length ? 1 : 2 });
    for (const t of targets) {
      const entity = type.by === 'event' ? (row.event_id || row.entity_id || row.id) : (row.entity_id || row.id);
      const window = type.group ? Math.floor(row.at / type.group) : row.id;
      const key = t.mode === 'summary'
        ? 'summary:' + t.recipient + ':' + cairoText(summaryAt).slice(0, 10)
        : [type.key, entity, t.recipient, t.channel, window].join(':');
      wanted.push({ key, row, type, t });
    }
  }

  // rows already there for these keys: still waiting → add the id; sent → a new row
  const keys = [...new Set(wanted.map(w => w.key))];
  const existing = new Map();
  for (let i = 0; i < keys.length; i += 80) {
    const part = keys.slice(i, i + 80);
    const r = await retry(() => db.prepare(`SELECT dedupe_key, status FROM notify_outbox WHERE dedupe_key IN (${part.map(() => '?').join(',')})`).bind(...part).all());
    for (const x of r.results) existing.set(x.dedupe_key, x.status);
  }
  const stmts = [];
  for (const w of wanted) {
    let key = w.key;
    const status = existing.get(key);
    if (status && !SENDABLE.includes(status)) key = key + ':' + w.row.id;
    const summary = w.t.mode === 'summary';
    stmts.push(db.prepare(`INSERT INTO notify_outbox (id, dedupe_key, recipient, channel, kind, activity_ids, status, attempts, next_ms, created_ms, level)
      VALUES (?, ?, ?, ?, ?, json_array(?), ?, 0, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO UPDATE SET activity_ids = CASE WHEN EXISTS (SELECT 1 FROM json_each(notify_outbox.activity_ids) WHERE value = ?)
        THEN notify_outbox.activity_ids ELSE json_insert(notify_outbox.activity_ids, '$[#]', ?) END,
        level = CASE WHEN excluded.level = 'critical' OR notify_outbox.level = 'critical' THEN 'critical' WHEN excluded.level = 'important' OR notify_outbox.level = 'important' THEN 'important' ELSE 'routine' END
      WHERE notify_outbox.status IN ('queued', 'deferred', 'failed')`).bind(
      randomId('ntf-'), key, w.t.recipient, w.t.channel, summary ? 'summary' : w.type.key, w.row.id, summary ? 'deferred' : 'queued',
      summary ? summaryAt : now, now, w.type.level, w.row.id, w.row.id));
    existing.set(key, summary ? 'deferred' : 'queued');
  }
  for (const m of marks) stmts.push(db.prepare('UPDATE activity SET notified = ? WHERE id = ? AND notified = 0').bind(m.notified, m.id));
  await retry(() => db.batch(stmts));
  return { routed: marks.filter(m => m.notified === 1).length, skipped: marks.filter(m => m.notified === 2).length, rows: wanted.length };
}
