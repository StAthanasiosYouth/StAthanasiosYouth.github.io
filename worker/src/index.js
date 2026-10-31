/*
 * athanasios-api — the Cloudflare Worker behind the site (Phase 1 foundation).
 * docs: worker/README.md, docs/BACKEND-MIGRATION.md
 *
 * Request flow: CORS preflight → route match → (admin) Google token +
 * allowlist + route permission → handler → one JSON envelope with security headers → one log
 * line (+ api_log row for errors / slow requests, after the response).
 */

import { ApiError, errorResponse, json, preflight, readJson, readRaw } from './lib/http.js';
import { requireAdmin } from './lib/auth.js';
import { requireRoutePerm } from './lib/perms.js';
import { pseudonym } from './lib/hash.js';
import { logLine, persistIfNotable } from './lib/log.js';
import { match } from './routes.js';
import { consume, consumeDead } from './jobs.js';
import { scheduled } from './scheduled.js';
import { memberKick } from './notify/tick.js';

/* the routes that can write a member's email: it goes right after the reply instead of waiting for the minute */
const MAIL_ROUTES = /^\/v1\/(?:book\/|comp\/submit|shop\/|account\/(?:signin|forgot\/verify)|admin\/(?:book\/|participants|store\/|comp\/))/;

export async function handle(request, env, ectx, deps = {}) {
  const t0 = Date.now();
  const url = new URL(request.url);
  const ctx = {
    request, env, url,
    rid: (request.headers.get('cf-ray') || crypto.randomUUID()).slice(0, 36),
    colo: request.cf && request.cf.colo,
    // a wrapper, not the global itself: a Workers fetch called as ctx.fetch(...) throws «Illegal invocation»
    fetch: deps.fetch || ((...a) => fetch(...a)),
    actor: null,
    body: null,
    raw: null,
    params: {},
    defer: p => ectx.waitUntil(Promise.resolve(p).catch(err => logLine({ lvl: 'warn', rid: ctx.rid, msg: 'deferred failed', err: String(err && err.message).slice(0, 200) })))
  };
  let response;
  let route = null;
  let code = null;

  try {
    if (request.method === 'OPTIONS') return preflight(request, env);
    const hit = match(request.method, url.pathname);
    route = hit.route;
    ctx.route = route;
    ctx.params = hit.params;
    if (route.auth === 'admin') {
      await requireAdmin(ctx);
      ctx.perm = await requireRoutePerm(ctx, route);   // lib/perms.js ROUTE_PERMS
    }
    if (route.raw) ctx.raw = await readRaw(request, route.maxBytes);
    else ctx.body = request.method === 'POST' ? await readJson(request, route.maxBytes) : null;
    const data = await route.handler(ctx);
    if (data && data.__response) {
      response = data.__response;
    } else if (data && data.__replay) {
      response = json(ctx, data.__replay.body, { status: data.__replay.status, headers: { 'idempotency-replayed': '1' } });
    } else {
      const cache = data && data.__cache;
      if (cache) delete data.__cache;
      response = json(ctx, { ok: true, ...data }, cache ? { cache } : {});
    }
  } catch (err) {
    if (!(err instanceof ApiError)) logLine({ lvl: 'error', rid: ctx.rid, route: url.pathname, err: String(err && err.stack || err).slice(0, 500) });
    code = err instanceof ApiError ? err.code : 'error';
    response = errorResponse(ctx, err);
  }

  if (request.method === 'POST' && response.status < 400 && MAIL_ROUTES.test(url.pathname)) ctx.defer(memberKick(env));

  const entry = {
    rid: ctx.rid, method: request.method, route: route ? route.path : url.pathname.slice(0, 80),
    status: response.status, ms: Date.now() - t0, code, colo: ctx.colo,
    actor: ctx.actor ? await pseudonym(env, ctx.actor.email) : null
  };
  logLine(entry);
  persistIfNotable(env, ectx, entry);
  return response;
}

export default {
  fetch: (request, env, ectx) => handle(request, env, ectx),
  queue: (batch, env) => (/-dlq$/.test(batch.queue) ? consumeDead(batch, env) : consume(batch, env)),
  scheduled
};
