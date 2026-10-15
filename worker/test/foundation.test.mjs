import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle, ORIGIN, CLIENT_ID } from './helpers.mjs';
import { verifyGoogleIdToken, resetAuthCaches } from '../src/lib/auth.js';
import { hit } from '../src/lib/ratelimit.js';
import { begin, finishStmt, abandon } from '../src/lib/idempotency.js';
import { retry, isTransient, cairoText } from '../src/lib/db.js';
import { housekeeping } from '../src/scheduled.js';
import { consume, consumeDead, makeJob } from '../src/jobs.js';
import { migratedDb } from './d1-sqlite.mjs';

// ---------- HTTP policy ----------

test('health: envelope, security headers, CORS for the site only', async () => {
  const h = harness();
  const r = await h.call('/v1/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.service, 'athanasios-api');
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.ok(r.headers.get('x-request-id'));

  const other = await h.call('/v1/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('preflight: allowed origin gets 204 + methods/headers, others 403', async () => {
  const h = harness();
  const ok = await h.call('/v1/admin/whoami', { method: 'OPTIONS' });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(ok.headers.get('access-control-allow-headers'), /authorization/);
  const bad = await h.call('/v1/admin/whoami', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
});

test('unknown route 404, wrong method 405, Arabic message + requestId', async () => {
  const h = harness();
  const nf = await h.call('/v1/nope');
  assert.equal(nf.status, 404);
  assert.equal(nf.body.code, 'notfound');
  assert.ok(nf.body.message && nf.body.requestId);
  const m = await h.call('/v1/health', { method: 'POST', body: {} });
  assert.equal(m.status, 405);
});

test('deep health reports DB and migrations; storage not configured without R2', async () => {
  const h = harness();
  const r = await h.call('/v1/health/deep');
  assert.equal(r.body.db.ok, true);
  assert.ok(r.body.db.migrations >= 1);
  assert.equal(r.body.storage, 'not-configured');
  assert.equal(r.body.queue, 'bound');
});

// ---------- Google sign-in ----------

test('admin route without token → 401 auth', async () => {
  const h = harness();
  const r = await h.call('/v1/admin/whoami');
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'auth');
});

test('valid Google token for a bootstrap admin → whoami, sub bound on first use', async () => {
  const g = await fakeGoogle();
  const h = harness();
  const token = await g.sign(g.claims());
  const r = await h.call('/v1/admin/whoami', { headers: { authorization: 'Bearer ' + token }, fetch: g.fetch });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.email, 'admin@example.com');
  const row = await h.db.prepare('SELECT google_sub FROM admins WHERE email = ?').bind('admin@example.com').first();
  assert.equal(row.google_sub, '1001');
});

test('recycled email with a different Google sub is refused', async () => {
  const g = await fakeGoogle();
  const h = harness();
  await h.db.prepare("INSERT INTO admins (email, google_sub, role, active, created_at) VALUES ('admin@example.com', '999', 'admin', 1, 0)").run();
  const r = await h.call('/v1/admin/whoami', { headers: { authorization: 'Bearer ' + await g.sign(g.claims()) }, fetch: g.fetch });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'denied');
});

test('not on the allowlist → 403 denied; inactive admin → denied', async () => {
  const g = await fakeGoogle();
  const h = harness();
  const r = await h.call('/v1/admin/whoami', { headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: 'x@example.com', sub: '2' })) }, fetch: g.fetch });
  assert.equal(r.status, 403);
  await h.db.prepare("INSERT INTO admins (email, role, active, created_at) VALUES ('off@example.com', 'admin', 0, 0)").run();
  const r2 = await h.call('/v1/admin/whoami', { headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: 'off@example.com', sub: '3' })) }, fetch: g.fetch });
  assert.equal(r2.status, 403);
});

test('token checks: aud, iss, exp, email_verified, signature, alg, kid', async () => {
  const g = await fakeGoogle();
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const now = Math.floor(Date.now() / 1000);
  const cases = {
    aud: await g.sign(g.claims({ aud: 'someone-else' })),
    iss: await g.sign(g.claims({ iss: 'https://evil.example' })),
    exp: await g.sign(g.claims({ exp: now - 3600 })),
    iat: await g.sign(g.claims({ iat: now + 3600 })),
    email_verified: await g.sign(g.claims({ email_verified: false })),
    signature: await g.sign(g.claims(), { key: other.privateKey }),
    alg: await g.sign(g.claims(), { alg: 'HS256' }),
    kid: await g.sign(g.claims(), { kid: 'unknown' }),
    shape: 'not.a-token'
  };
  for (const [name, token] of Object.entries(cases)) {
    resetAuthCaches();
    await assert.rejects(verifyGoogleIdToken(token, { clientId: CLIENT_ID, fetchImpl: g.fetch }), e => e.code === 'auth', name);
  }
});

test('staging test key works ONLY when ENVIRONMENT is staging', async () => {
  const g = await fakeGoogle();
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey));
  const token = await g.sign(g.claims(), { kid: 'staging-test', key: pair.privateKey });
  const auth = { authorization: 'Bearer ' + token };

  const staging = harness({ env: { ENVIRONMENT: 'staging', STAGING_TEST_JWK: jwk } });
  assert.equal((await staging.call('/v1/admin/whoami', { headers: auth, fetch: g.fetch })).status, 200);

  for (const env of ['production', 'Staging', 'staging ']) {
    const h = harness({ env: { ENVIRONMENT: env, STAGING_TEST_JWK: jwk } });
    assert.equal((await h.call('/v1/admin/whoami', { headers: auth, fetch: g.fetch })).status, 401, env);
  }
});

test('JWKS is cached; an unknown kid refetches at most once a minute', async () => {
  const g = await fakeGoogle();
  resetAuthCaches();
  const t = Date.now();
  await verifyGoogleIdToken(await g.sign(g.claims()), { clientId: CLIENT_ID, fetchImpl: g.fetch, now: t });
  await verifyGoogleIdToken(await g.sign(g.claims({ sub: '5' })), { clientId: CLIENT_ID, fetchImpl: g.fetch, now: t });
  assert.equal(g.jwksCalls, 1);
  // unknown kid right after a fetch: no refetch (throttled)
  await verifyGoogleIdToken(await g.sign(g.claims(), { kid: 'rotated' }), { clientId: CLIENT_ID, fetchImpl: g.fetch, now: t + 1000 }).catch(() => {});
  assert.equal(g.jwksCalls, 1);
  // a minute later: one refetch, then throttled again
  for (let i = 0; i < 3; i++) await verifyGoogleIdToken(await g.sign(g.claims(), { kid: 'rotated' }), { clientId: CLIENT_ID, fetchImpl: g.fetch, now: t + 61_000 + i }).catch(() => {});
  assert.equal(g.jwksCalls, 2);
});

// ---------- abuse protection ----------

test('rate limit: exact count per window, then 429 with retry-after', async () => {
  const db = migratedDb();
  const t = Date.UTC(2026, 9, 15, 10, 0, 5);
  for (let i = 1; i <= 3; i++) assert.equal((await hit(db, 'k', 3, 60, t)).ok, true);
  const over = await hit(db, 'k', 3, 60, t);
  assert.equal(over.ok, false);
  assert.equal(over.count, 4);
  assert.equal((await hit(db, 'k', 3, 60, t + 60_000)).ok, true, 'next window resets');

  const h = harness();
  let last;
  for (let i = 0; i < 31; i++) last = await h.call('/v1/health/deep', { headers: { 'cf-connecting-ip': '203.0.113.9' } });
  assert.equal(last.status, 429);
  assert.equal(last.body.code, 'rate');
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  const keys = (await h.db.prepare('SELECT key FROM rate_limits').all()).results.map(r => r.key);
  assert.ok(keys.every(k => !k.includes('203.0.113.9')), 'no raw IP stored');
});

test('body limits and bad JSON', async () => {
  const g = await fakeGoogle();
  const h = harness();
  const auth = { authorization: 'Bearer ' + await g.sign(g.claims()), 'idempotency-key': 'key-12345678' };
  const big = await h.call('/v1/admin/diag/echo', { method: 'POST', body: JSON.stringify({ note: 'x'.repeat(70 * 1024) }), headers: auth, fetch: g.fetch });
  assert.equal(big.status, 413);
  const bad = await h.call('/v1/admin/diag/echo', { method: 'POST', body: '{nope', headers: auth, fetch: g.fetch });
  assert.equal(bad.status, 400);
});

// ---------- idempotency ----------

test('idempotency: replay same answer, conflict on different body, busy while running, takeover when stale', async () => {
  const db = migratedDb();
  const a = await begin(db, 's', 'k1', { x: 1 }, 1000);
  assert.ok(a.claim);
  await assert.rejects(begin(db, 's', 'k1', { x: 1 }, 2000), e => e.code === 'busy');
  await assert.rejects(begin(db, 's', 'k1', { x: 2 }, 2000), e => e.code === 'conflict');
  await finishStmt(db, a.claim, 200, { ok: true, n: 7 }).run();
  const again = await begin(db, 's', 'k1', { x: 1 }, 3000);
  assert.deepEqual(again.replay, { status: 200, body: { ok: true, n: 7 } });

  const b = await begin(db, 's', 'k2', {}, 1000);
  assert.ok(b.claim);
  const taken = await begin(db, 's', 'k2', {}, 1000 + 61_000);
  assert.ok(taken.claim, 'stale pending is taken over');

  const c = await begin(db, 's', 'k3', {}, 1000);
  await abandon(db, c.claim);
  assert.ok((await begin(db, 's', 'k3', {}, 1001)).claim, 'abandoned key can run again');
});

test('diag echo: exactly one activity row and one job per Idempotency-Key, replay flagged', async () => {
  const g = await fakeGoogle();
  const h = harness();
  const headers = { authorization: 'Bearer ' + await g.sign(g.claims()), 'idempotency-key': 'echo-key-0001' };
  const first = await h.call('/v1/admin/diag/echo', { method: 'POST', body: { note: 'hi' }, headers, fetch: g.fetch });
  const second = await h.call('/v1/admin/diag/echo', { method: 'POST', body: { note: 'hi' }, headers, fetch: g.fetch });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(second.body, first.body);
  assert.equal(second.headers.get('idempotency-replayed'), '1');
  const n = await h.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'diag.echo'").first();
  assert.equal(n.n, 1);
  assert.equal(h.sent.length, 1);
  const missing = await h.call('/v1/admin/diag/echo', { method: 'POST', body: {}, headers: { authorization: headers.authorization }, fetch: g.fetch });
  assert.equal(missing.status, 400, 'Idempotency-Key required');
});

// ---------- retries ----------

test('retry: transient D1 errors are retried, others are not', async () => {
  const db = migratedDb();
  db.failNext = 2;
  const r = await retry(() => db.prepare('SELECT 1 AS one').first());
  assert.equal(r.one, 1);
  assert.equal(isTransient(new Error('D1_ERROR: Network connection lost.')), true);
  assert.equal(isTransient(new Error('UNIQUE constraint failed')), false);
  let calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Error('UNIQUE constraint failed'); }));
  assert.equal(calls, 1);
});

test('admin endpoint survives a transient D1 failure (activity list)', async () => {
  const g = await fakeGoogle();
  const h = harness();
  const auth = { authorization: 'Bearer ' + await g.sign(g.claims()) };
  await h.call('/v1/admin/whoami', { headers: auth, fetch: g.fetch });   // binds the admin row
  h.db.failNext = 1;
  const r = await h.call('/v1/admin/activity?limit=5', { headers: auth, fetch: g.fetch });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

// ---------- logs, jobs, cron ----------

test('errors are kept in api_log without personal data', async () => {
  const g = await fakeGoogle();
  const h = harness();
  const orig = h.env.DB.prepare.bind(h.env.DB);
  const auth = { authorization: 'Bearer ' + await g.sign(g.claims()) };
  await h.call('/v1/admin/whoami', { headers: auth, fetch: g.fetch });
  h.env.DB.prepare = sql => (/FROM activity/.test(sql) ? { bind: () => ({ all: async () => { throw new Error('boom'); } }) } : orig(sql));
  const r = await h.call('/v1/admin/activity', { headers: auth, fetch: g.fetch });
  h.env.DB.prepare = orig;
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'error');
  assert.ok(!JSON.stringify(r.body).includes('boom'), 'internal error text not leaked');
  const row = await h.db.prepare('SELECT * FROM api_log').first();
  assert.equal(row.status, 500);
  assert.ok(row.actor && !row.actor.includes('@'), 'actor is a pseudonym');
});

test('queue consumer: known job runs once (idempotent), unknown acked, failures retried, DLQ audited', async () => {
  const db = migratedDb();
  const env = { DB: db };
  const msgs = [];
  const msg = body => { const m = { body, attempts: 1, acked: false, retried: null, ack() { this.acked = true; }, retry(o) { this.retried = o; } }; msgs.push(m); return m; };
  const job = makeJob('diag.ping', { ref: 'abc123' });
  await consume({ queue: 'q', messages: [msg(job), msg(job), msg({ type: 'mystery' })] }, env);
  assert.ok(msgs.every(m => m.acked));
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'diag.queue'").first()).n, 1);

  const broken = { DB: { prepare: () => { throw new Error('down'); } } };
  const m = msg(makeJob('diag.ping', { ref: 'x' }));
  await consume({ queue: 'q', messages: [m] }, broken);
  assert.ok(m.retried && m.retried.delaySeconds > 0);

  const dead = { messages: [msg(makeJob('diag.ping', { ref: 'y' }))], ackAll() { this.acked = true; } };
  await consumeDead(dead, env);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'job.failed'").first()).n, 1);
});

test('housekeeping trims old counters, idempotency, logs and activity', async () => {
  const db = migratedDb();
  const now = Date.UTC(2026, 9, 15);
  await db.batch([
    db.prepare("INSERT INTO rate_limits VALUES ('old', ?, 1)").bind(Math.floor(now / 1000) - 5 * 86400),
    db.prepare("INSERT INTO rate_limits VALUES ('new', ?, 1)").bind(Math.floor(now / 1000)),
    db.prepare("INSERT INTO idempotency (scope, key, req_hash, status, created_at) VALUES ('s','old','h','done', ?)").bind(now - 10 * 86400e3),
    db.prepare("INSERT INTO activity (id, at, cairo, actor, action) VALUES ('act-old', ?, '', 'a', 'x')").bind(now - 400 * 86400e3),
    db.prepare("INSERT INTO activity (id, at, cairo, actor, action) VALUES ('act-new', ?, '', 'a', 'x')").bind(now)
  ]);
  await housekeeping({ DB: db }, now);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM rate_limits').first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM idempotency').first()).n, 0);
  assert.deepEqual((await db.prepare('SELECT id FROM activity').all()).results.map(r => r.id), ['act-new']);
});

test('cairo wall-clock text', () => {
  assert.equal(cairoText(Date.UTC(2026, 0, 15, 10, 5)), '2026-01-15 12:05');
});
