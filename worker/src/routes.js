/*
 * Route table. Each route: method, path (":id" params), auth ('public' |
 * 'admin' | 'sync'), raw (an upload body, with maxBytes) — everything else is
 * JSON. Booking routes join here in the pilot, behind the BOOKING_MODULE
 * switch (settings table).
 */

import { ApiError, fileResponse } from './lib/http.js';
import { listActivity, activityStmt } from './lib/activity.js';
import { begin, finishStmt, abandon, idempotencyKey } from './lib/idempotency.js';
import { limit, clientIp } from './lib/ratelimit.js';
import { retry } from './lib/db.js';
import { sha256Bytes } from './lib/hash.js';
import { putProof, readProof, deleteProof, sweepProofs } from './lib/proofs.js';
import { PROOF_MAX_BYTES } from './lib/image.js';
import { verifySync, syncStampStmt } from './lib/sync.js';
import { housekeeping } from './scheduled.js';
import { makeJob } from './jobs.js';

export const VERSION = '0.2.0';

async function health(ctx) {
  return { service: 'athanasios-api', env: ctx.env.ENVIRONMENT || 'unknown', version: VERSION, colo: ctx.colo, time: Date.now() };
}

async function healthDeep(ctx) {
  await limit(ctx, 'health', clientIp(ctx.request), 30, 60);
  const t0 = Date.now();
  const db = await retry(() => ctx.env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM d1_migrations) AS migrations, (SELECT COUNT(*) FROM admins WHERE active = 1) AS admins, (SELECT value FROM settings WHERE key = 'SYNC_TS_admins') AS adminsSync"
  ).first()).catch(() => null);
  const dbMs = Date.now() - t0;
  let storage = 'not-configured';
  if (ctx.env.PROOFS) {
    // a read of a key that never exists: proves the binding and permission, writes nothing
    try { await ctx.env.PROOFS.head('health/never-exists'); storage = 'ok'; } catch { storage = 'error'; }
  }
  return {
    db: db ? { ok: true, ms: dbMs, migrations: db.migrations } : { ok: false },
    admins: db ? { active: db.admins, syncedAt: db.adminsSync ? Number(db.adminsSync) : null } : null,
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
  const items = await retry(() => listActivity(ctx.env.DB, { before: ctx.url.searchParams.get('before'), limit: ctx.url.searchParams.get('limit') }));
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

/* ---------------- private proofs (R2) ---------------- */

const TEST_RETENTION_MAX_MS = 24 * 3600 * 1000;

/*
 * POST /v1/admin/proofs?purpose=test   body: the image bytes (webp/jpeg)
 * Until the booking pilot, only `test` proofs can be uploaded here; the
 * booking routes will call putProof() themselves with a booking/payment id.
 */
async function proofUpload(ctx) {
  await limit(ctx, 'proof.upload', ctx.actor.email, 60, 60);
  const key = idempotencyKey(ctx.request);
  const purpose = ctx.url.searchParams.get('purpose') || '';
  if (purpose !== 'test') throw new ApiError('bad', 'purpose');

  // staging only: a short retention so the cleanup can be tested
  let deleteAfterMs = null;
  const testRetention = Number(ctx.request.headers.get('x-test-retention-ms') || 0);
  if (testRetention) {
    if (ctx.env.ENVIRONMENT !== 'staging' || testRetention < 0 || testRetention > TEST_RETENTION_MAX_MS) throw new ApiError('bad', 'x-test-retention-ms');
    deleteAfterMs = Date.now() + testRetention;
  }

  const started = await begin(ctx.env.DB, 'proof.upload:' + ctx.actor.email, key, { sha: await sha256Bytes(ctx.raw), purpose, testRetention });
  if (started.replay) return { __replay: started.replay };
  try {
    const out = await putProof(ctx.env, {
      bytes: ctx.raw, purpose, by: ctx.actor.email, deleteAfterMs,
      extra: ({ proof, duplicates }) => [
        activityStmt(ctx.env.DB, { actor: ctx.actor.email, actorName: ctx.actor.name, action: 'proof.upload', entityType: 'proof', entityId: proof.id, summary: purpose + ' · ' + proof.bytes + ' bytes' }),
        finishStmt(ctx.env.DB, started.claim, 200, { ok: true, proof, duplicates })
      ]
    });
    return out;
  } catch (err) {
    await abandon(ctx.env.DB, started.claim).catch(() => {});
    throw err;
  }
}

/* GET /v1/admin/proofs/:id → the bytes, streamed; no public URL ever exists */
async function proofRead(ctx) {
  await limit(ctx, 'proof.read', ctx.actor.email, 300, 60);
  const { row, obj } = await readProof(ctx.env, ctx.params.id);
  return { __response: fileResponse(ctx, obj.body, { contentType: row.mime, length: row.bytes, filename: row.id + (row.mime === 'image/webp' ? '.webp' : '.jpg') }) };
}

/* DELETE /v1/admin/proofs/:id → file gone, row kept with deleted_at */
async function proofDelete(ctx) {
  const out = await deleteProof(ctx.env, ctx.params.id, ctx.actor.email);
  if (out.deleted) {
    await retry(() => activityStmt(ctx.env.DB, { actor: ctx.actor.email, actorName: ctx.actor.name, action: 'proof.delete', entityType: 'proof', entityId: out.proof.id, summary: out.proof.purpose }).run());
  }
  return out;
}

/* POST /v1/admin/diag/housekeeping → what the daily cron does, now */
async function diagHousekeeping(ctx) {
  await limit(ctx, 'housekeeping', ctx.actor.email, 6, 60);
  const opts = {};
  if (ctx.env.ENVIRONMENT === 'staging' && ctx.body && Number.isFinite(ctx.body.orphanAgeMs)) opts.orphanAgeMs = Math.max(0, ctx.body.orphanAgeMs);
  const removed = await housekeeping(ctx.env);
  const proofs = await sweepProofs(ctx.env, opts);
  return { removed, proofs };
}

/* ---------------- Apps Script → Worker sync ---------------- */

const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;

/*
 * POST /v1/sync/admins  (signed by Apps Script, lib/sync.js)
 * body: { admins: [{ email, name, primary }] }
 * The Apps Script allowlist is the source of truth: listed → active, the
 * rest → inactive (rows kept: their Google sub binding stays).
 */
async function syncAdmins(ctx) {
  await limit(ctx, 'sync', clientIp(ctx.request), 30, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { body, ts } = await verifySync(ctx.env, ctx.request, raw, 'admins');
  const list = Array.isArray(body.admins) ? body.admins : null;
  if (!list || !list.length || list.length > 50) throw new ApiError('bad', 'admins');
  const admins = list.map(a => ({ email: String(a.email || '').trim().toLowerCase(), name: String(a.name || '').slice(0, 80), primary: a.primary === true }));
  if (admins.some(a => !EMAIL_RE.test(a.email))) throw new ApiError('bad', 'email');
  if (admins.filter(a => a.primary).length > 1) throw new ApiError('bad', 'primary');

  const db = ctx.env.DB;
  const now = Date.now();
  const emails = admins.map(a => a.email);
  const stmts = admins.map(a => db.prepare(
    "INSERT INTO admins (email, name, role, active, created_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role, active = 1"
  ).bind(a.email, a.name, a.primary ? 'primary' : 'admin', now));
  stmts.push(db.prepare(`UPDATE admins SET active = 0 WHERE email NOT IN (${emails.map(() => '?').join(',')})`).bind(...emails));
  stmts.push(syncStampStmt(db, 'admins', ts));
  stmts.push(activityStmt(db, { actor: 'apps-script', action: 'admins.sync', entityType: 'admins', summary: admins.length + ' active' }));
  await retry(() => db.batch(stmts));
  return { active: admins.length };
}

export const ROUTES = [
  { method: 'GET', path: '/v1/health', auth: 'public', handler: health },
  { method: 'GET', path: '/v1/health/deep', auth: 'public', handler: healthDeep },
  { method: 'GET', path: '/v1/admin/whoami', auth: 'admin', handler: whoami },
  { method: 'GET', path: '/v1/admin/activity', auth: 'admin', handler: activity },
  { method: 'POST', path: '/v1/admin/diag/echo', auth: 'admin', handler: diagEcho },
  { method: 'POST', path: '/v1/admin/diag/housekeeping', auth: 'admin', handler: diagHousekeeping },
  { method: 'POST', path: '/v1/admin/proofs', auth: 'admin', raw: true, maxBytes: PROOF_MAX_BYTES, handler: proofUpload },
  { method: 'GET', path: '/v1/admin/proofs/:id', auth: 'admin', handler: proofRead },
  { method: 'DELETE', path: '/v1/admin/proofs/:id', auth: 'admin', handler: proofDelete },
  { method: 'POST', path: '/v1/sync/admins', auth: 'sync', raw: true, maxBytes: 16 * 1024, handler: syncAdmins }
];

const COMPILED = ROUTES.map(r => {
  const names = [];
  const re = new RegExp('^' + r.path.replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
  return { route: r, re, names };
});

/* { route, params } or throws notfound / method */
export function match(method, path) {
  const hits = COMPILED.map(c => ({ c, m: c.re.exec(path) })).filter(x => x.m);
  if (!hits.length) throw new ApiError('notfound');
  const hit = hits.find(x => x.c.route.method === method);
  if (!hit) throw new ApiError('method');
  const params = {};
  hit.c.names.forEach((n, i) => { params[n] = decodeURIComponent(hit.m[i + 1]); });
  return { route: hit.c.route, params };
}
