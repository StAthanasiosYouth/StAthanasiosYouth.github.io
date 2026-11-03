// Live STAGING check for Phase 6 Step 5 (docs/PHASE6-PLAN.md): the settings and tools calls on the Worker
// (src/admin/tools.js), signed in as the load-test admin. Commits nothing (the live stage is not called).
// Run from worker/: node scripts/tools-check.mjs
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
let failed = 0;

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
}
function google(email, sub) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: 'check', iat: now, exp: now + 3600 });
  return head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
const P = google('loadtest@staging.invalid', 'loadtest-1');
async function call(path, body, token = P) {
  const res = await fetch(base + '/v1/admin/' + path, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

check('no credential: refused', (await call('tools/github', {}, '')).status === 401);
const gh = await call('tools/github');
check('GitHub: the Staging mirror repository, its head, a write proved', gh.status === 200 && /publish-mirror-staging/.test(gh.body.repo) && gh.body.head.length === 7, gh);
const media = await call('tools/media');
check('the media check: every step', media.status === 200 && media.body.ok === true && media.body.steps.length === 6, media.body);
const maps = await call('tools/maps', { url: 'https://www.google.com/maps/place/Safaga/@26.7292,33.9365,14z' });
check('Google Maps: coordinates from a link', maps.status === 200 && maps.body.lat === 26.7292 && maps.body.lng === 33.9365, maps.body);
const img = await call('tools/fetch-media', { url: ORIGIN + '/assets/img/icon-192.png' });
check('a picture by its link (the site\'s own icon)', img.status === 200 && img.body.mime === 'image/png' && img.body.bytes > 100, { status: img.status, mime: img.body && img.body.mime, code: img.body && img.body.code });
check('… a page is refused', (await call('tools/fetch-media', { url: ORIGIN + '/' })).status === 400);
const plan = await call('tools/migration');
check('the Sheets\' upgrade: finished', plan.status === 200 && plan.body.pending === false, plan.body);
const admins = await call('tools/admins');
check('the admins list from D1', admins.status === 200 && admins.body.emails.includes('loadtest@staging.invalid') && admins.body.me === 'loadtest@staging.invalid', admins.body);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
