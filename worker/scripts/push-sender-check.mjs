// Live STAGING check for Phase 6 Step 4b (docs/PHASE6-PLAN.md): the sender against the real FCM, with made-up tokens.
// Google refuses them, so no device gets anything: the key, the access token, the queue fan-out and the clean-up are what is checked.
// Removes its own rows. Run from worker/: node scripts/push-sender-check.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const RUN = Date.now().toString(36);
const tok = n => ('chk_' + RUN + '_' + n + '_').padEnd(150, 'x');
const ME = 'loadtest@staging.invalid';
let failed = 0;

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
}
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { encoding: 'utf8', shell: true });
  if (r.status !== 0) throw new Error('d1: ' + String(r.stderr).slice(0, 300));
  return JSON.parse(r.stdout)[0].results;
}
function google(email, sub) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: 'check', iat: now, exp: now + 3600 });
  return head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function call(path, body, token) {
  const res = await fetch(base + path, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const P = google(ME, 'loadtest-1');
const outsider = google('nobody@staging.invalid', 'nobody-1');
const wait = ms => new Promise(r => setTimeout(r, ms));

try {
  check('the key check: no credential refused', (await call('/v1/admin/push/check', {})).status === 401);
  check('… not an admin refused', (await call('/v1/admin/push/check', {}, outsider)).status === 403);
  const key = await call('/v1/admin/push/check', {}, P);
  check('the key: Google gives a token and FCM takes it (validate_only)', key.status === 200 && key.body.check === true, key);

  sql(`DELETE FROM push_devices WHERE audience = 'admin' AND email = '${ME}'`);
  check('a test with no devices is refused', (await call('/v1/admin/push/test', {}, P)).body.code === 'invalid');
  for (const n of [1, 2]) await call('/v1/admin/push/subscribe', { token: tok(n), platform: 'desktop', device: 'فحص ' + n }, P);
  const t = await call('/v1/admin/push/test', {}, P);
  check('a test to my own devices', t.status === 200 && t.body.targets === 2, t);
  check('… once a minute', (await call('/v1/admin/push/test', {}, P)).body.code === 'rate_limited');

  let row = null;
  for (let i = 0; i < 20 && !(row && row.finished_ms); i++) {
    await wait(3000);
    row = sql(`SELECT status, targets, sent, failed, removed, parts, parts_done, error, finished_ms FROM push_sends WHERE id = '${t.body.send}'`)[0];
  }
  check('the queue ran its part', row && row.finished_ms && row.parts_done === row.parts, row);
  check('… FCM answered: made-up tokens are gone, no auth error', row && row.removed === 2 && row.sent === 0 && !row.error, row);
  check('… their rows are deleted', sql(`SELECT COUNT(*) AS n FROM push_devices WHERE token LIKE 'chk_${RUN}%'`)[0].n === 0);
} finally {
  sql(`DELETE FROM push_devices WHERE token LIKE 'chk_${RUN}%'`);
  sql(`DELETE FROM push_parts WHERE send_id IN (SELECT id FROM push_sends WHERE ref = 'test:${ME}')`);
  sql(`DELETE FROM push_sends WHERE ref = 'test:${ME}'`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
