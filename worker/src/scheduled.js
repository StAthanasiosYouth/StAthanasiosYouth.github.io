/*
 * Daily housekeeping (cron, wrangler.jsonc). Short, I/O-bound statements:
 * the Free plan gives cron handlers 10 ms CPU.
 */

import { logLine } from './lib/log.js';
import { sweepProofs } from './lib/proofs.js';
import { activityStmt } from './lib/activity.js';

const DAY = 24 * 3600 * 1000;
export const RETENTION = {
  rateLimitsS: 2 * 24 * 3600,
  idempotencyMs: 3 * DAY,
  apiLogMs: 30 * DAY,
  activityMs: 365 * DAY,
  activityRows: 5250,
  phoneMs: 365 * DAY,           // EVENTS.md §10: phones blanked 12 months after the event ends
  locksMs: DAY                  // edit locks long expired (book/locks.js)
};

export async function housekeeping(env, now = Date.now()) {
  const nowS = Math.floor(now / 1000);
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits WHERE window < ?').bind(nowS - RETENTION.rateLimitsS),
    env.DB.prepare('DELETE FROM idempotency WHERE created_at < ?').bind(now - RETENTION.idempotencyMs),
    env.DB.prepare('DELETE FROM api_log WHERE at < ?').bind(now - RETENTION.apiLogMs),
    env.DB.prepare('DELETE FROM activity WHERE at < ?').bind(now - RETENTION.activityMs),
    env.DB.prepare('DELETE FROM activity WHERE id IN (SELECT id FROM activity ORDER BY at DESC LIMIT -1 OFFSET ?)').bind(RETENTION.activityRows)
  ]);
  const removed = r.map(x => x.meta.changes);
  logLine({ kind: 'cron', job: 'housekeeping', removed });
  return removed;
}

/*
 * EVENTS.md §10: a booking's phone number is blanked ('') 12 months after
 * its event ends (event_cfg.end_ms; a booking whose event row is gone counts
 * from its own creation). Names, counts, payments stay for accounting.
 * Idempotent; one audit row (a count, never a number) when something was
 * blanked. `eventId` limits it to one event (the staging check, which runs
 * it "in the future": then long-dead edit locks are left alone). → how many.
 */
export async function blankPhones(env, now = Date.now(), { eventId = null } = {}) {
  const cutoff = now - RETENTION.phoneMs;
  const db = env.DB;
  const only = eventId ? ' AND event_id = ?' : '';
  const args = eventId ? [eventId] : [];
  const stmts = [
    db.prepare(`UPDATE bookings SET phone = '', phone_blanked_ms = ?
      WHERE phone <> ''${only} AND (
        event_id IN (SELECT id FROM event_cfg WHERE end_ms < ?)
        OR (event_id NOT IN (SELECT id FROM event_cfg) AND created_ms < ?))`).bind(now, ...args, cutoff, cutoff)
  ];
  if (!eventId) stmts.push(db.prepare('DELETE FROM edit_locks WHERE expires_ms < ?').bind(now - RETENTION.locksMs));
  const r = await db.batch(stmts);
  const blanked = r[0].meta.changes;
  if (blanked) {
    await activityStmt(db, { at: now, actor: 'system', action: 'booking.retention', entityType: 'bookings', entityId: eventId || '', summary: 'phones blanked: ' + blanked }).run();
  }
  logLine({ kind: 'cron', job: 'phones', blanked, locks: r[1] ? r[1].meta.changes : 0 });
  return blanked;
}

export async function scheduled(controller, env) {
  const now = controller.scheduledTime || Date.now();
  await housekeeping(env, now);
  await blankPhones(env, now);
  // proofs past their retention date, and R2 objects no row names (> 24 h)
  const proofs = await sweepProofs(env, { now });
  logLine({ kind: 'cron', job: 'proofs', ...proofs });
}
