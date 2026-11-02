// Live STAGING check for Phase 6 Step 4a (docs/PHASE6-PLAN.md): the devices table and its routes. Sends no notification: the tokens are made up.
// Removes its own rows. Run from worker/: node scripts/push-devices-check.mjs
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
  return { status: res.status, cors: res.headers.get('access-control-allow-origin'), body: await res.json().catch(() => null) };
}
const P = google('loadtest@staging.invalid', 'loadtest-1');
const outsider = google('nobody@staging.invalid', 'nobody-1');
const count = () => sql(`SELECT COUNT(*) AS n FROM push_devices WHERE token LIKE 'chk_${RUN}%'`)[0].n;

try {
  const on = await call('/v1/push/subscribe', { token: tok(1), platform: 'android' });
  check('a visitor subscribes from the site', on.status === 200 && on.body.ok === true && on.cors === ORIGIN, on);
  check('… nothing read back', !JSON.stringify(on.body).includes('chk_'));
  check('… the row', count() === 1);
  const moved = await call('/v1/push/subscribe', { token: tok(2), previous: tok(1), platform: 'android' });
  check('a new token replaces the old', moved.body.ok === true && count() === 1, moved);
  check('a bad shape is refused', (await call('/v1/push/subscribe', { token: 'short' })).body.code === 'invalid');

  check('no credential: refused', (await call('/v1/admin/push/devices', {})).status === 401);
  check('not an admin: refused', (await call('/v1/admin/push/devices', {}, outsider)).status === 403);
  const mine = await call('/v1/admin/push/subscribe', { token: tok(3), platform: 'desktop', device: 'فحص' }, P);
  check('an admin\'s device', mine.status === 200 && mine.body.on === true, mine);
  check('… its email is the session\'s', sql(`SELECT email FROM push_devices WHERE token LIKE 'chk_${RUN}_3%'`)[0].email === 'loadtest@staging.invalid');
  check('a visitor\'s token is refused for an admin', (await call('/v1/admin/push/subscribe', { token: tok(2) }, P)).status === 400);
  check('an admin\'s token is refused for a visitor', (await call('/v1/push/subscribe', { token: tok(3) })).body.code === 'invalid');
  const listed = await call('/v1/admin/push/devices', { token: tok(3) }, P);
  const own = listed.body.devices.find(d => d.current);
  check('the list marks this device', listed.body.on === true && !!own, listed);
  check('… and never shows a token', !JSON.stringify(listed.body).includes('chk_'));
  const removed = await call('/v1/admin/push/remove', { id: own.id }, P);
  check('removed', removed.status === 200 && !removed.body.devices.some(d => d.id === own.id), removed);
  check('a visitor turns off', (await call('/v1/push/unsubscribe', { token: tok(2) })).body.ok === true && count() === 0);
} finally {
  sql(`DELETE FROM push_devices WHERE token LIKE 'chk_${RUN}%'`);
  sql("DELETE FROM rate_limits WHERE key LIKE 'push.%'");
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
