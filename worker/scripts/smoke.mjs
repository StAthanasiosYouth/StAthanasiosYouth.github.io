// Post-deploy smoke test (read-only). Usage: node scripts/smoke.mjs staging|production [baseUrl]
// Exit code 1 on any failure — CI stops before touching production.
const target = process.argv[2] || 'staging';
const BASES = {
  staging: process.env.STAGING_URL || 'https://athanasios-api-staging.menazak-lab.workers.dev',
  production: process.env.PRODUCTION_URL || 'https://athanasios-api.menazak-lab.workers.dev'
};
const base = process.argv[3] || BASES[target];
const ORIGIN = 'https://stathanasiosyouth.github.io';
let failed = 0;

function check(name, cond, detail) {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(detail)));
  if (!cond) failed++;
}

async function get(path, init = {}) {
  const t = performance.now();
  const res = await fetch(base + path, { ...init, headers: { origin: ORIGIN, ...(init.headers || {}) } });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch {}
  return { res, body, ms: Math.round(performance.now() - t) };
}

const h = await get('/v1/health');
check('health 200', h.res.status === 200 && h.body.ok, h.body);
check('health env = ' + target, h.body && h.body.env === target, h.body && h.body.env);
check('security headers', h.res.headers.get('x-content-type-options') === 'nosniff' && /default-src 'none'/.test(h.res.headers.get('content-security-policy') || ''), [...h.res.headers]);
check('CORS for the site', h.res.headers.get('access-control-allow-origin') === ORIGIN);

const d = await get('/v1/health/deep');
check('deep health: db ok', d.body && d.body.db && d.body.db.ok, d.body);
check('deep health: migrations applied', d.body && d.body.db && d.body.db.migrations >= 1, d.body);
check('deep health: queue bound', d.body && d.body.queue === 'bound', d.body);

const p = await get('/v1/admin/whoami', { method: 'OPTIONS', headers: { 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
check('preflight 204', p.res.status === 204);
const evil = await get('/v1/health', { headers: { origin: 'https://evil.example' } });
check('no CORS for other origins', evil.res.headers.get('access-control-allow-origin') === null);

const a = await get('/v1/admin/whoami');
check('admin without token → 401', a.res.status === 401 && a.body.code === 'auth', a.body);
const bad = await get('/v1/admin/whoami', { headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.e30.c2ln' } });
check('admin with forged token → 401', bad.res.status === 401, bad.body);

console.log(`${target} ${base}: health ${h.ms} ms, deep ${d.ms} ms (db ${d.body && d.body.db && d.body.db.ms} ms)`);
process.exit(failed ? 1 : 0);
