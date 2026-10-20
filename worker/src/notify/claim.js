/*
 * POST /v1/sync/notify-claim  (signed by Apps Script; apps-script/NotifyClaim.gs)
 * The router's push rows, handed to Apps Script, which owns the admin push
 * devices (AdminNotify.gs) and sends to the NAMED admins only. At least once:
 *
 *   body  { v: 1, ack: [{ id, claim, ok, reason }] }   ← the results of the last claim
 *   reply { router, items: [{ id, claim, recipient, level, title, body, url, tag }] }
 *
 * - a claimed row is leased (next_ms = now + LEASE_MS); no ack in time → it is
 *   handed out again (Apps Script skips a claim id it already sent);
 * - ok → sent; a refusal → retried with backoff; after MAX_ATTEMPTS → dead and a
 *   critical «notify.failed» row for the Primary Admin (never for a failed
 *   notify.failed / gmail.token row: no loop);
 * - the bodies are made now from the activity rows (the outbox stores none).
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { randomId } from '../lib/hash.js';
import { activityStmt } from '../lib/activity.js';
import { verifySync, syncStampStmt } from '../lib/sync.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { typeOf, messageOf } from './catalog.js';

export const LEASE_MS = 3 * 60000;
export const MAX_ATTEMPTS = 5;
export const CLAIM_MAX = 40;
const NO_ALARM = ['notify.failed', 'gmail.token'];
export const backoffMs = attempts => Math.min(60, Math.pow(2, Math.max(0, attempts - 1))) * 60000;

/* a row given up on: dead, and (once) a critical row about it */
export function deadStmts(db, row, reason, now) {
  const stmts = [db.prepare("UPDATE notify_outbox SET status = 'dead', claim_id = NULL, error = ? WHERE id = ?").bind(String(reason || '').slice(0, 200), row.id)];
  if (!NO_ALARM.includes(row.kind)) {
    stmts.push(activityStmt(db, {
      at: now, actor: 'system', action: 'notify.failed', entityType: 'notify', entityId: row.id, severity: 'critical',
      summary: (row.channel === 'email' ? 'إيميل' : 'إشعار') + ' مقدرش يتبعت بعد ' + MAX_ATTEMPTS + ' محاولات', changes: { kind: row.kind, channel: row.channel }
    }));
  }
  return stmts;
}

/* activity ids → { id: row }, and the admins' names */
export async function sources(db, ids) {
  const out = new Map();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 80) {
    const part = unique.slice(i, i + 80);
    // a booking's event title, for the message (never the visitor's data)
    const r = await retry(() => db.prepare(`SELECT a.id, a.at, a.cairo, a.actor, a.actor_name, a.action, a.entity_type, a.entity_id, a.entity_title, a.summary, a.changes,
        (SELECT e.title FROM bookings b JOIN event_cfg e ON e.id = b.event_id WHERE a.entity_type = 'booking' AND b.id = a.entity_id) AS event_title,
        (SELECT b.event_id FROM bookings b WHERE a.entity_type = 'booking' AND b.id = a.entity_id) AS event_id
      FROM activity a WHERE a.id IN (${part.map(() => '?').join(',')})`).bind(...part).all());
    for (const row of r.results) out.set(row.id, row);
  }
  const names = Object.fromEntries((await retry(() => db.prepare('SELECT email, name FROM admins WHERE name IS NOT NULL').all())).results.map(a => [a.email, a.name]));
  return { rows: out, names };
}

/* an outbox row → its message (null when its activity rows are gone) */
export function messageFor(row, src) {
  let ids = [];
  try { ids = JSON.parse(row.activity_ids) || []; } catch { ids = []; }
  const acts = ids.map(id => src.rows.get(id)).filter(Boolean).sort((a, b) => a.at - b.at);
  if (!acts.length) return null;
  const type = typeOf(acts[acts.length - 1]) || { key: row.kind, level: row.level };
  return messageOf(type, acts, src.names);
}

export async function notifyClaim(ctx) {
  await limit(ctx, 'sync.claim', clientIp(ctx.request), 60, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { body, ts } = await verifySync(ctx.env, ctx.request, raw, 'notifyclaim');
  const db = ctx.env.DB;
  const now = Date.now();
  const stmts = [syncStampStmt(db, 'notifyclaim', ts)];

  // 1. the results of the last claim
  const acks = Array.isArray(body.ack) ? body.ack.slice(0, 200) : [];
  if (acks.some(a => !a || !/^ntf-[0-9a-f]{6,}$/.test(String(a.id)) || !/^clm-[0-9a-f]{6,}$/.test(String(a.claim)))) throw new ApiError('bad', 'ack');
  if (acks.length) {
    const r = await retry(() => db.prepare(`SELECT id, kind, channel, attempts, claim_id FROM notify_outbox WHERE id IN (${acks.map(() => '?').join(',')}) AND channel = 'push'`).bind(...acks.map(a => a.id)).all());
    const byId = new Map(r.results.map(x => [x.id, x]));
    for (const a of acks) {
      const row = byId.get(a.id);
      if (!row || row.claim_id !== a.claim) continue;   // an old claim: the row was handed out again
      const reason = String(a.reason || '').slice(0, 200) || null;
      if (a.ok === true) {
        stmts.push(db.prepare("UPDATE notify_outbox SET status = 'sent', sent_ms = ?, claim_id = NULL, error = ? WHERE id = ? AND claim_id = ?").bind(now, reason, row.id, a.claim));
      } else if (row.attempts >= MAX_ATTEMPTS) {
        stmts.push(...deadStmts(db, row, reason || 'push failed', now));
      } else {
        stmts.push(db.prepare("UPDATE notify_outbox SET status = 'failed', next_ms = ?, claim_id = NULL, error = ? WHERE id = ? AND claim_id = ?").bind(now + backoffMs(row.attempts), reason || 'push failed', row.id, a.claim));
      }
    }
  }

  const router = (await retry(() => db.prepare("SELECT value FROM settings WHERE key = 'NOTIFY_ROUTER'").first('value'))) === '1';
  if (!router) {
    await retry(() => db.batch(stmts));
    return { router: false, items: [] };
  }

  // 2. rows out of attempts with no answer: dead
  const stale = (await retry(() => db.prepare("SELECT id, kind, channel FROM notify_outbox WHERE channel = 'push' AND status IN ('queued', 'failed') AND next_ms <= ? AND attempts >= ?").bind(now, MAX_ATTEMPTS).all())).results;
  for (const row of stale) stmts.push(...deadStmts(db, row, 'no answer after ' + MAX_ATTEMPTS + ' claims', now));

  // 3. a new claim: critical first, then the oldest
  const claim = randomId('clm-');
  stmts.push(db.prepare(`UPDATE notify_outbox SET claim_id = ?, next_ms = ?, attempts = attempts + 1
    WHERE id IN (SELECT id FROM notify_outbox WHERE channel = 'push' AND status IN ('queued', 'failed') AND next_ms <= ? AND attempts < ?
      ORDER BY CASE level WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, created_ms LIMIT ?)`).bind(claim, now + LEASE_MS, now, MAX_ATTEMPTS, CLAIM_MAX));
  await retry(() => db.batch(stmts));

  const rows = (await retry(() => db.prepare("SELECT id, recipient, kind, level, activity_ids FROM notify_outbox WHERE claim_id = ? ORDER BY CASE level WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, created_ms").bind(claim).all())).results;
  if (!rows.length) return { router: true, items: [] };
  const src = await sources(db, rows.flatMap(r => { try { return JSON.parse(r.activity_ids) || []; } catch { return []; } }));
  const items = [];
  const gone = [];
  for (const row of rows) {
    const m = messageFor(row, src);
    if (!m) { gone.push(row.id); continue; }
    items.push({ id: row.id, claim, recipient: row.recipient, level: row.level, title: m.title, body: m.body, url: m.url, tag: m.tag });
  }
  if (gone.length) {
    await retry(() => db.prepare(`UPDATE notify_outbox SET status = 'dismissed', claim_id = NULL, error = 'activity gone' WHERE id IN (${gone.map(() => '?').join(',')})`).bind(...gone).run());
  }
  return { router: true, items };
}
