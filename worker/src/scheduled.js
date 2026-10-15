/*
 * Daily housekeeping (cron, wrangler.jsonc). Short, I/O-bound statements:
 * the Free plan gives cron handlers 10 ms CPU.
 */

import { logLine } from './lib/log.js';

const DAY = 24 * 3600 * 1000;
export const RETENTION = {
  rateLimitsS: 2 * 24 * 3600,
  idempotencyMs: 3 * DAY,
  apiLogMs: 30 * DAY,
  activityMs: 365 * DAY,
  activityRows: 5250
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

export async function scheduled(controller, env) {
  await housekeeping(env, controller.scheduledTime || Date.now());
}
