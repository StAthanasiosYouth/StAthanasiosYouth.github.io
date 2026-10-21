/*
 * Daily housekeeping (cron, wrangler.jsonc). Short, I/O-bound statements:
 * the Free plan gives cron handlers 10 ms CPU.
 */

import { logLine } from './lib/log.js';
import { sweepProofs } from './lib/proofs.js';
import { activityStmt } from './lib/activity.js';
import { notifyTick } from './notify/tick.js';
import { shadowCheck, SHADOW_EVERY_MIN } from './publish-shadow.js';
import { mirrorDue, mirrorPending } from './publish-mirror.js';

const DAY = 24 * 3600 * 1000;
export const RETENTION = {
  rateLimitsS: 2 * 24 * 3600,
  idempotencyMs: 3 * DAY,
  apiLogMs: 30 * DAY,
  activityMs: 365 * DAY,
  activityRows: 5250,
  phoneMs: 365 * DAY,           // EVENTS.md §10: phones blanked 12 months after the event ends
  locksMs: DAY,                 // edit locks long expired (book/locks.js)
  outboxMs: 30 * DAY,           // §4.4: the outbox is kept 30 days (a critical row never expires unsent)
  shadowMs: 60 * DAY            // Phase 2 shadow comparison runs (the gate looks back 1–2 weeks)
};

export async function housekeeping(env, now = Date.now()) {
  const nowS = Math.floor(now / 1000);
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits WHERE window < ?').bind(nowS - RETENTION.rateLimitsS),
    env.DB.prepare('DELETE FROM idempotency WHERE created_at < ?').bind(now - RETENTION.idempotencyMs),
    env.DB.prepare('DELETE FROM api_log WHERE at < ?').bind(now - RETENTION.apiLogMs),
    env.DB.prepare('DELETE FROM activity WHERE at < ?').bind(now - RETENTION.activityMs),
    env.DB.prepare('DELETE FROM activity WHERE id IN (SELECT id FROM activity ORDER BY at DESC LIMIT -1 OFFSET ?)').bind(RETENTION.activityRows),
    env.DB.prepare("DELETE FROM notify_outbox WHERE created_ms < ? AND (status IN ('sent', 'dead', 'dismissed') OR level <> 'critical')").bind(now - RETENTION.outboxMs),
    // email counters: hour buckets older than 2 days (and the old per-day rows) are no longer in any window
    env.DB.prepare('DELETE FROM notify_quota WHERE day < ?').bind('h:' + new Date(now - 2 * DAY).toISOString().slice(0, 13)),
    env.DB.prepare('DELETE FROM shadow_checks WHERE at < ?').bind(now - RETENTION.shadowMs)
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
    db.prepare(`UPDATE bookings SET phone = '', booker_dob = NULL, phone_blanked_ms = ?
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

/* wrangler.jsonc: '* * * * *' = the notifications (notify/tick.js); the other cron = the daily housekeeping */
export async function scheduled(controller, env) {
  const now = controller.scheduledTime || Date.now();
  if (controller.cron === '* * * * *') {
    await notifyTick(env, now);
    // Phase 2: the shadow comparison every 15 minutes (nothing until a publish was posted)
    if (new Date(now).getUTCMinutes() % SHADOW_EVERY_MIN === 0) {
      await shadowCheck(env, { now }).catch(err => logLine({ lvl: 'warn', kind: 'cron', job: 'shadow', err: String(err && err.message).slice(0, 200) }));
    }
    // Phase 2 P2-4: the GitHub mirror, while something is pending (with backoff after a failure)
    if (await mirrorDue(env.DB, now).catch(() => false)) {
      await mirrorPending(env, { now }).catch(err => logLine({ lvl: 'warn', kind: 'cron', job: 'mirror', err: String(err && err.message).slice(0, 200) }));
    }
    return;
  }
  await housekeeping(env, now);
  await blankPhones(env, now);
  // proofs past their retention date, and R2 objects no row names (> 24 h)
  const proofs = await sweepProofs(env, { now });
  logLine({ kind: 'cron', job: 'proofs', ...proofs });
}
