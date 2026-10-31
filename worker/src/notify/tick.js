/*
 * The notifications' minute (cron '* * * * *', scheduled.js): route new
 * activity rows into the outbox (router.js); lease the due email rows and
 * hand them to the queue ('notify.email', or send them here without one:
 * email.js); the same for member email, up to three batches (member.js; memberKick already sent the fresh ones); once an hour, the Gmail token's health. Pushes leave through
 * Apps Script's claim (claim.js). Never throws: a bad minute is logged and the
 * next one picks up where it stopped (rows stay notified = 0).
 */

import { logLine } from '../lib/log.js';
import { route } from './router.js';
import { leaseDue, sendRows, tokenHealth } from './email.js';
import { memberLease, memberSend } from './member.js';
import { makeJob } from '../jobs.js';
import { retry } from '../lib/db.js';

const MEMBER_BATCHES = 3;
const KICK_DIRECT = 2;

/*
 * Right after a change that may have written a row, so it needn't wait for the minute. A row or two go here and now:
 * on Staging the queue itself once held a leased row for 57 s. More go through the queue. Never in the reply's way
 * (ctx.defer), and a failure here costs only the wait: the row is committed, and the cron sends it.
 */
export async function memberKick(env, now = Date.now()) {
  const db = env.DB;
  const due = await retry(() => db.prepare("SELECT 1 AS y FROM member_outbox WHERE status = 'queued' AND class <> 'otp' AND next_ms <= ? LIMIT 1").bind(now).first());
  if (!due) return 0;
  const ids = await memberLease(env, now, { fresh: true });
  if (!ids.length) return 0;
  try {
    if (env.JOBS && (ids.length > KICK_DIRECT || env.KICK_VIA_QUEUE === '1')) await env.JOBS.send(makeJob('member.email', { ids }));
    else await memberSend(env, ids, now);
  } catch (err) {
    await retry(() => db.prepare(`UPDATE member_outbox SET next_ms = ? WHERE status = 'queued' AND id IN (${ids.map(() => '?').join(',')})`).bind(now, ...ids).run());
    throw err;
  }
  return ids.length;
}

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
  try {
    out.memberLeased = 0;
    for (let batch = 0; batch < MEMBER_BATCHES; batch++) {
      const ids = await memberLease(env, now);
      if (!ids.length) break;
      if (env.JOBS) await env.JOBS.send(makeJob('member.email', { ids }));
      else out.member = await memberSend(env, ids, now);
      out.memberLeased += ids.length;
    }
  } catch (err) {
    out.memberError = String(err && err.message).slice(0, 200);
  }
  logLine({ kind: 'cron', job: 'notify', ...out });
  return out;
}
