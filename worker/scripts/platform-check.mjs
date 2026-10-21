// Live STAGING check for Phase 3 P3-1…P3-3 (src/admin/session.js, src/admin/me.js,
// docs/ADMIN-PLATFORM-PLAN.md): session start / takeover question / force,
// the panel token, heartbeat locks + presence, the Apps Script session check
// (signed /v1/sync/session), park + resume, end, /me, rename. Adds one test
// admin and removes it again. Signs with the staging test key; never production.
// Needs settings.ADMIN_PLATFORM = '1' on staging. Run: node scripts/platform-check.mjs
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { signSync } from '../src/lib/sync.js';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SYNC = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PRIMARY = 'loadtest@staging.invalid';
const RUN = Date.now().toString(36);
const NEW = `plat-${RUN}@staging.invalid`;
const TAB = n => ('tab-' + RUN + '-' + n).padEnd(20, 'x');
const KEY = 'news:chk-' + RUN;
const times = {};
let failed = 0;

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
}
function google(email, sub) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: email.split('@')[0], iat: now, exp: now + 3600 });
  return 'Bearer ' + head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function call(auth, method, path, body, label) {
  const t0 = Date.now();
  const res = await fetch(base + path, { method, headers: { origin: ORIGIN, ...(auth ? { authorization: auth } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const out = { status: res.status, body: await res.json().catch(() => null) };
  if (label) (times[label] = times[label] || []).push(Date.now() - t0);
  return out;
}
async function ask(body) {
  const raw = JSON.stringify(body);
  const ts = String(Date.now());
  const res = await fetch(base + '/v1/sync/session', { method: 'POST', headers: { 'content-type': 'text/plain', 'x-sync-ts': ts, 'x-sync-signature': await signSync(SYNC, ts, raw) }, body: raw });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const bearer = t => 'Bearer ' + t;

const P = google(PRIMARY, 'loadtest-1');
const N = google(NEW, 'plat-' + RUN);

const me = await call(P, 'GET', '/v1/admin/me', null, 'me');
check('switch on (/me platform = true), Primary holds accounts.manage', me.status === 200 && me.body.platform === true && me.body.perms['accounts.manage'] === 'all', me.body);
if (!me.body || me.body.platform !== true) { console.error('ADMIN_PLATFORM is not 1 on staging'); process.exit(1); }

const add = await call(P, 'POST', '/v1/admin/accounts', { email: NEW, grants: { 'content.view': 'all' } });
check('test admin added', add.status === 200, add.body);

// --- sessions
const p1 = await call(P, 'POST', '/v1/admin/session/start', { device: 'Check A', tab: TAB(1), force: true }, 'start');
check('start: sid + panel token', p1.status === 200 && /^wk1\./.test(p1.body.token) && p1.body.sid, p1.body);
const n1 = await call(N, 'POST', '/v1/admin/session/start', { device: 'Check B', tab: TAB(2) }, 'start');
check('second admin starts too', n1.status === 200 && n1.body.sid, n1.body);

const hb1 = await call(bearer(p1.body.token), 'POST', '/v1/admin/session/heartbeat', { area: 'home', locks: [KEY], item: { kind: 'news', id: 'chk-' + RUN, label: 'خبر تجربة' }, since: Date.now() - 60000 }, 'heartbeat');
check('heartbeat: lock granted', hb1.status === 200 && hb1.body.locks[KEY] && hb1.body.locks[KEY].granted === true, hb1.body);
const hb2 = await call(bearer(n1.body.token), 'POST', '/v1/admin/session/heartbeat', { area: 'news', locks: [KEY] }, 'heartbeat');
check('heartbeat: the same lock refused for the other admin, with the holder', hb2.status === 200 && hb2.body.locks[KEY].granted === false && hb2.body.locks[KEY].holder && hb2.body.locks[KEY].holder.device === 'Check A', hb2.body);
check('presence: the other admin is online, editing «خبر تجربة»', hb2.body.others.some(o => o.email === PRIMARY && o.item && o.item.label === 'خبر تجربة'), hb2.body.others);

const sNow = await ask({ email: NEW, sid: n1.body.sid, locks: [KEY] });
check('Apps Script check: live + the holder of the lock', sNow.status === 200 && sNow.body.state === 'live' && sNow.body.holders[KEY] && sNow.body.holders[KEY].email === PRIMARY, sNow.body);

const q = await call(P, 'POST', '/v1/admin/session/start', { device: 'Check C', tab: TAB(3) }, 'start');
check('another device: the takeover question', q.status === 200 && q.body.active && q.body.active.device === 'Check A', q.body);
const p2 = await call(P, 'POST', '/v1/admin/session/start', { device: 'Check C', tab: TAB(3), force: true }, 'start');
check('force: a new session', p2.status === 200 && p2.body.sid && p2.body.sid !== p1.body.sid, p2.body);
const old = await call(bearer(p1.body.token), 'POST', '/v1/admin/session/heartbeat', {});
check('the replaced tab: session_replaced', old.status === 401 && old.body.code === 'session_replaced', old.body);
check('Apps Script check: the old sid is replaced', (await ask({ email: PRIMARY, sid: p1.body.sid })).body.state === 'replaced');
const hb3 = await call(bearer(n1.body.token), 'POST', '/v1/admin/session/heartbeat', { locks: [KEY] }, 'heartbeat');
check('the takeover freed the lock', hb3.body.locks[KEY].granted === true, hb3.body);

// park + resume
const park = await fetch(base + '/v1/admin/session/park', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'text/plain' }, body: JSON.stringify({ token: p2.body.token, tab: TAB(3) }) }).then(r => r.json());
check('park (beacon body)', park.ok && park.parked === true, park);
const res = await call(P, 'POST', '/v1/admin/session/resume', { sid: p2.body.sid, device: 'Check C', tab: TAB(4), prev: TAB(3), left: true }, 'resume');
check('resume after a reload: the same sid', res.status === 200 && res.body.sid === p2.body.sid && res.body.resumed === true, res.body);

// P3-3: rename
const ren = await call(bearer(n1.body.token), 'POST', '/v1/admin/accounts/' + encodeURIComponent(NEW) + '/name', { name: 'تجربة ' + RUN.slice(-4).replace(/\d/g, 'ا') }, 'rename');
check('rename (any admin, panel token)', ren.status === 200 && ren.body.name.startsWith('تجربة'), ren.body);

// end
const e1 = await call(bearer(n1.body.token), 'POST', '/v1/admin/session/end', {});
const e2 = await call(bearer(res.body.token), 'POST', '/v1/admin/session/end', {});
check('end both sessions', e1.body.ended === true && e2.body.ended === true, [e1.body, e2.body]);
check('after end: session_expired', (await call(bearer(res.body.token), 'GET', '/v1/admin/whoami')).body.code === 'session_expired');

const rm = await call(P, 'POST', '/v1/admin/accounts/' + encodeURIComponent(NEW) + '/remove');
check('test admin removed', rm.status === 200, rm.body);

const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log('server round trips from here (ms, median): ' + Object.entries(times).map(([k, v]) => k + ' ' + med(v) + ' (n=' + v.length + ')').join(', '));
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
