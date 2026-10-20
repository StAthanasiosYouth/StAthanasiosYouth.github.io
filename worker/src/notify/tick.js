/*
 * The notifications' minute (cron '* * * * *', scheduled.js): route new
 * activity rows into the outbox (router.js). Pushes leave through Apps
 * Script's claim (claim.js). Never throws: a bad minute is logged and the
 * next one picks up where it stopped (rows stay notified = 0).
 */

import { logLine } from '../lib/log.js';
import { route } from './router.js';

export async function notifyTick(env, now = Date.now()) {
  const out = {};
  try {
    out.route = await route(env, now);
  } catch (err) {
    out.error = String(err && err.message).slice(0, 200);
  }
  logLine({ kind: 'cron', job: 'notify', ...out });
  return out;
}
