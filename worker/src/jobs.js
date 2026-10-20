/*
 * Background jobs (Cloudflare Queues). Every message: { type, id, at, payload }.
 * Handlers must be idempotent: a message can be delivered more than once.
 * Failures retry with backoff; after `max_retries` the message lands in the
 * dead-letter queue (wrangler.jsonc) and is logged.
 *
 * Free plan: 50 external subrequests per consumer invocation — fan-out jobs
 * (push, later) put ≤ 45 targets in ONE message (Phase 0: 300 sends ≈ 9 s).
 */

import { randomId } from './lib/hash.js';
import { logLine } from './lib/log.js';
import { activityStmt } from './lib/activity.js';
import { sendRows } from './notify/email.js';

export const JOB_TYPES = {
  // diagnostics: proves enqueue → consume → D1 write end to end
  async 'diag.ping'(env, payload) {
    const ref = String(payload.ref || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
    await activityStmt(env.DB, { id: 'act-q' + ref, orIgnore: true, actor: 'system', action: 'diag.queue', summary: 'queue round trip' }).run();
  },
  // leased email rows (notify/tick.js): each row records its own result, so the job never retries
  async 'notify.email'(env, payload) {
    const ids = Array.isArray(payload.ids) ? payload.ids.filter(id => /^ntf-[0-9a-f]{6,}$/.test(String(id))).slice(0, 20) : [];
    await sendRows(env, ids);
  }
};

export function makeJob(type, payload) {
  if (!JOB_TYPES[type]) throw new Error('unknown job type ' + type);
  return { type, id: randomId('job-'), at: Date.now(), payload: payload || {} };
}

export async function enqueue(env, type, payload) {
  if (!env.JOBS) throw new Error('JOBS queue not bound');
  await env.JOBS.send(makeJob(type, payload));
}

export async function consume(batch, env) {
  for (const msg of batch.messages) {
    const job = msg.body || {};
    const handler = JOB_TYPES[job.type];
    const t0 = Date.now();
    if (!handler) {
      logLine({ lvl: 'warn', kind: 'job', type: job.type, id: job.id, msg: 'unknown type, dropped' });
      msg.ack();
      continue;
    }
    try {
      await handler(env, job.payload || {});
      msg.ack();
      logLine({ kind: 'job', type: job.type, id: job.id, ms: Date.now() - t0, attempts: msg.attempts });
    } catch (err) {
      const delay = Math.min(300, 10 * Math.pow(2, msg.attempts || 1));
      logLine({ lvl: 'error', kind: 'job', type: job.type, id: job.id, attempts: msg.attempts, err: String(err && err.message).slice(0, 200) });
      msg.retry({ delaySeconds: delay });
    }
  }
}

/* Dead letters: record them in the audit log so an admin can see them. */
export async function consumeDead(batch, env) {
  const stmts = batch.messages.map(msg => activityStmt(env.DB, {
    actor: 'system', action: 'job.failed', entityType: 'job', entityId: (msg.body && msg.body.id) || '',
    summary: 'background job failed after retries: ' + ((msg.body && msg.body.type) || '?')
  }));
  if (stmts.length) await env.DB.batch(stmts);
  batch.ackAll();
}
