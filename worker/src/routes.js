/*
 * Route table. Each route: method, path, auth ('public' | 'admin'), and
 * optional rate limit + idempotency. Booking routes join here in the pilot,
 * behind the BOOKING_MODULE switch (settings table).
 */

import { ApiError } from './lib/http.js';
import { listActivity, activityStmt } from './lib/activity.js';
import { begin, finishStmt, abandon, idempotencyKey } from './lib/idempotency.js';
import { limit, clientIp } from './lib/ratelimit.js';
import { retry } from './lib/db.js';
import { makeJob } from './jobs.js';

export const VERSION = '0.1.0';

async function health(ctx) {
  return { service: 'athanasios-api', env: ctx.env.ENVIRONMENT || 'unknown', version: VERSION, colo: ctx.colo, time: Date.now() };
}

async function healthDeep(ctx) {
  await limit(ctx, 'health', clientIp(ctx.request), 30, 60);
  const t0 = Date.now();
  const db = await retry(() => ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first()).catch(() => null);
  const dbMs = Date.now() - t0;
  let storage = 'not-configured';
  if (ctx.env.PRIVATE) {
    try { await ctx.env.PRIVATE.head('health/probe'); storage = 'ok'; } catch { storage = 'error'; }
  }
  return {
    db: db ? { ok: true, ms: dbMs, migrations: db.n } : { ok: false },
    storage,
    queue: ctx.env.JOBS ? 'bound' : 'not-configured',
    googleClient: !!ctx.env.GOOGLE_CLIENT_ID,
    version: VERSION
  };
}

async function whoami(ctx) {
  return { email: ctx.actor.email, name: ctx.actor.name, role: ctx.actor.role };
}

async function activity(ctx) {
  const url = new URL(ctx.request.url);
  const items = await retry(() => listActivity(ctx.env.DB, { before: url.searchParams.get('before'), limit: url.searchParams.get('limit') }));
  return { items };
}

/*
 * Diagnostics for the foundation (admin only): one idempotent write — an
 * activity row + a background job — exactly once per Idempotency-Key.
 */
async function diagEcho(ctx) {
  const key = idempotencyKey(ctx.request);
  const scope = 'diag.echo:' + ctx.actor.email;
  const started = await begin(ctx.env.DB, scope, key, ctx.body);
  if (started.replay) return { __replay: started.replay };
  try {
    const ref = key.slice(0, 40);
    const body = { echo: String(ctx.body.note || '').slice(0, 80), ref };
    await retry(() => ctx.env.DB.batch([
      activityStmt(ctx.env.DB, { id: 'act-e' + ref.replace(/[^A-Za-z0-9]/g, '').slice(0, 30), orIgnore: true, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'diag.echo', summary: 'foundation check' }),
      finishStmt(ctx.env.DB, started.claim, 200, { ok: true, ...body })
    ]));
    if (ctx.env.JOBS) ctx.defer(ctx.env.JOBS.send(makeJob('diag.ping', { ref })));
    return body;
  } catch (err) {
    await abandon(ctx.env.DB, started.claim).catch(() => {});
    throw err;
  }
}

export const ROUTES = [
  { method: 'GET', path: '/v1/health', auth: 'public', handler: health },
  { method: 'GET', path: '/v1/health/deep', auth: 'public', handler: healthDeep },
  { method: 'GET', path: '/v1/admin/whoami', auth: 'admin', handler: whoami },
  { method: 'GET', path: '/v1/admin/activity', auth: 'admin', handler: activity },
  { method: 'POST', path: '/v1/admin/diag/echo', auth: 'admin', handler: diagEcho }
];

export function match(method, path) {
  const sameP = ROUTES.filter(r => r.path === path);
  if (!sameP.length) throw new ApiError('notfound');
  const route = sameP.find(r => r.method === method);
  if (!route) throw new ApiError('method');
  return route;
}
