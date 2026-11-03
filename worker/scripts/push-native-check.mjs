// Live STAGING check for Phase 6 Step 4d (docs/PHASE6-PLAN.md, BACKEND-MIGRATION §22.2.4): one web device registered
// by its Firebase Installation ID (the new FCM web API) and one simulated native Android token, through the same
// register call and the same send. Both are made up, so FCM refuses them and no device gets anything.
// Removes its own rows. Run from worker/: node scripts/push-native-check.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const RUN = Date.now().toString(36);
const FID = ('f' + RUN + 'chk').padEnd(22, 'A').slice(0, 22);
const NATIVE = ('chk_' + RUN + '_native_').padEnd(152, 'x');
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
const wait = ms => new Promise(r => setTimeout(r, ms));

try {
  sql(`DELETE FROM push_devices WHERE audience = 'admin' AND email = '${ME}'`);
  const web = await call('/v1/admin/push/subscribe', { token: FID, os: 'android', device: 'فحص ويب' }, P);
  check('a web device by its Firebase Installation ID', web.status === 200 && web.body.on === true, web);
  const app = await call('/v1/admin/push/subscribe', { token: NATIVE, app: true, platform: 'android', os: 'android', appVersion: '0.0.1-check', device: 'فحص تطبيق' }, P);
  check('a native Android token, the same call', app.status === 200 && app.body.on === true, app);
  const rows = sql(`SELECT platform, os, app_version, length(token) AS n FROM push_devices WHERE email = '${ME}' ORDER BY n`);
  check('… stored as web (22) and android (app version kept)', rows.length === 2 && rows[0].platform === 'web' && rows[0].n === 22 && rows[1].platform === 'android' && rows[1].app_version === '0.0.1-check', rows);

  const t = await call('/v1/admin/push/test', {}, P);
  check('one send to both', t.status === 200 && t.body.targets === 2, t);
  let row = null;
  for (let i = 0; i < 20 && !(row && row.finished_ms); i++) {
    await wait(3000);
    row = sql(`SELECT status, sent, failed, removed, error, finished_ms FROM push_sends WHERE id = '${t.body.send}'`)[0];
  }
  check('FCM took both targets (`fid` and `token`) and refused the made-up ids: both removed, no auth error', row && row.finished_ms && row.removed === 2 && !row.error, row);
} finally {
  sql(`DELETE FROM push_devices WHERE audience = 'admin' AND email = '${ME}'`);
  sql(`DELETE FROM push_parts WHERE send_id IN (SELECT id FROM push_sends WHERE ref = 'test:${ME}')`);
  sql(`DELETE FROM push_sends WHERE ref = 'test:${ME}'`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
