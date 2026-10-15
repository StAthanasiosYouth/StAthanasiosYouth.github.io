// STAGING-ONLY load / concurrency test. Signs admin tokens with the local
// staging test key (.staging-test-key.pem, gitignored; public half is the
// STAGING_TEST_JWK secret). Production ignores that key entirely.
// Usage: node scripts/load.mjs [stagingUrl]
import { readFileSync, writeFileSync } from 'node:fs';
import { createSign, randomUUID } from 'node:crypto';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: load tests run against staging only'); process.exit(2); }
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const out = { at: new Date().toISOString(), base, results: {} };

function token() {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'loadtest-1', email: 'loadtest@staging.invalid', email_verified: true, name: 'Load Test', iat: now, exp: now + 3600 });
  return head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
const AUTH = 'Bearer ' + token();

async function call(path, { method = 'GET', body, key } = {}) {
  const headers = { origin: ORIGIN, authorization: AUTH };
  if (body) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const t = performance.now();
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json, ms: performance.now() - t, replay: res.headers.get('idempotency-replayed') === '1' };
}
const pct = (a, p) => Math.round([...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))]);
const stats = rs => ({ n: rs.length, p50: pct(rs.map(r => r.ms), 0.5), p95: pct(rs.map(r => r.ms), 0.95), errors: rs.filter(r => r.status >= 400).length });
function record(name, value) { out.results[name] = value; console.log(name.padEnd(46), JSON.stringify(value)); }

async function seq(name, n, make) { const rs = []; for (let i = 0; i < n; i++) rs.push(await call(...make(i))); record(name, stats(rs)); return rs; }
async function burst(name, n, make) { const t = performance.now(); const rs = await Promise.all(Array.from({ length: n }, (_, i) => call(...make(i)))); record(name, { ...stats(rs), wallMs: Math.round(performance.now() - t), codes: [...new Set(rs.map(r => r.status))] }); return rs; }

await call('/v1/health');
await seq('health (no DB)', 20, () => ['/v1/health']);
await seq('admin whoami (token verify + allowlist)', 20, () => ['/v1/admin/whoami']);
await seq('admin activity list (30)', 20, () => ['/v1/admin/activity?limit=30']);
await seq('admin write: echo (idempotent batch + job)', 20, () => ['/v1/admin/diag/echo', { method: 'POST', body: { note: 'seq' }, key: 'seq-' + randomUUID() }]);

// the same Idempotency-Key 50× at once: exactly one write, everyone else replay or busy
const same = 'race-' + randomUUID();
const race = await burst('race: 50× same Idempotency-Key', 50, () => ['/v1/admin/diag/echo', { method: 'POST', body: { note: 'race' }, key: same }]);
const settle = await call('/v1/admin/diag/echo', { method: 'POST', body: { note: 'race' }, key: same });
const ref = same.slice(0, 40).replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
const conflict = await call('/v1/admin/diag/echo', { method: 'POST', body: { note: 'different' }, key: same });
record('race outcome', {
  ok200: race.filter(r => r.status === 200).length, replays: race.filter(r => r.replay).length, busy409: race.filter(r => r.status === 409).length,
  afterSettle: settle.status + (settle.replay ? ' replay' : ''), differentBody: conflict.status + ' ' + (conflict.body && conflict.body.code)
});

const raceList = await call('/v1/admin/activity?limit=100');
record('race: activity rows for that key (expect 1)', (raceList.body.items || []).filter(x => x.id === 'act-e' + ref).length);

await burst('burst: 100 distinct admin writes at once', 100, () => ['/v1/admin/diag/echo', { method: 'POST', body: { note: 'burst' }, key: 'b-' + randomUUID() }]);
await burst('burst: 100 reads at once', 100, () => ['/v1/admin/activity?limit=10']);

// queue round trip: echo enqueues diag.ping → consumer writes act-q<ref>
const qKey = 'queue-' + randomUUID();
const tq = Date.now();
await call('/v1/admin/diag/echo', { method: 'POST', body: { note: 'queue' }, key: qKey });
const qRef = 'act-q' + qKey.slice(0, 40).replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
let seen = false;
for (let i = 0; i < 30 && !seen; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const list = await call('/v1/admin/activity?limit=50');
  seen = (list.body.items || []).some(x => x.id === qRef);
}
record('queue round trip', { delivered: seen, seconds: Math.round((Date.now() - tq) / 1000) });

// rate limit on deep health: 30/min per IP → the 31st is 429
await new Promise(r => setTimeout(r, (60 - new Date().getUTCSeconds() + 1) * 1000));   // fresh 60 s window
const rl = [];
for (let i = 0; i < 32; i++) rl.push((await fetch(base + '/v1/health/deep', { headers: { origin: ORIGIN } })).status);
record('rate limit (30/min): expect first 429 at #31', { first429At: rl.indexOf(429) + 1, count429: rl.filter(s => s === 429).length });

writeFileSync(new URL('../load-results-staging.json', import.meta.url), JSON.stringify(out, null, 2));
