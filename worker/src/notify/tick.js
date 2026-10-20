/*
 * The notifications' minute (cron '* * * * *', scheduled.js): route new
 * activity rows into the outbox (router.js); lease the due email rows and
 * hand them to the queue ('notify.email', or send them here without one:
 * email.js); once an hour, the Gmail token's health. Pushes leave through
 * Apps Script's claim (claim.js). Never throws: a bad minute is logged and the
 * next one picks up where it stopped (rows stay notified = 0).
 */

import { logLine } from '../lib/log.js';
import { route } from './router.js';
import { leaseDue, sendRows, tokenHealth } from './email.js';
import { makeJob } from '../jobs.js';

export async function notifyTick(env, now = Date.now()) {
  const out = {};
  try {
    out.route = await route(env, now);
  } catch (err) {
    out.error = String(err && err.message).slice(0, 200);
  }
  try {
    const ids = await leaseDue(env, now);
    if (ids.length && env.JOBS) await env.JOBS.send(makeJob('notify.email', { ids }));
    else if (ids.length) out.email = await sendRows(env, ids, now);
    out.leased = ids.length;
    if (new Date(now).getUTCMinutes() === 0) out.gmail = (await tokenHealth(env, now)).ok;
  } catch (err) {
    out.emailError = String(err && err.message).slice(0, 200);
  }
  logLine({ kind: 'cron', job: 'notify', ...out });
  return out;
}
