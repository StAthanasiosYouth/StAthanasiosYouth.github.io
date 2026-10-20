// Live STAGING check for «الصلاحيات» (src/lib/accounts.js, Phase 1.5 step 3):
// list, add with a preset, the new admin's own access, grant / Primary / self
// protections, the Google-only rule, remove (refused at once), the grants
// snapshot Apps Script pulls, and the audit rows. Signs with the staging test
// key (.staging-test-key.pem); never runs against production.
// Run: node scripts/accounts-check.mjs
import { readFileSync } from 'node:fs';
import { createSign, createHmac } from 'node:crypto';
import { signSync } from '../src/lib/sync.js';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SYNC = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PRIMARY = 'loadtest@staging.invalid';
const RUN = Date.now().toString(36);
const NEW = `acc-${RUN}@staging.invalid`;
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
function wk(email) {
  const now = Math.floor(Date.now() / 1000);
  const p = Buffer.from(JSON.stringify({ e: email, x: now + 600, v: 'google', i: now })).toString('base64url');
  return 'Bearer wk1.' + p + '.' + createHmac('sha256', SYNC).update('wk1.' + p).digest('hex');
}
async function call(auth, method, path, body) {
  const res = await fetch(base + path, { method, headers: { origin: ORIGIN, authorization: auth, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const P = google(PRIMARY, 'loadtest-1');
const N = google(NEW, 'acc-' + RUN);

const list = await call(P, 'GET', '/v1/admin/accounts');
check('list: 200, the Primary can manage', list.status === 200 && list.body.canManage === true && list.body.admins.some(a => a.email === PRIMARY && a.primary), list.body);
const preset = list.body.presets.servant_bookings.grants;

const viaSession = await call(wk(PRIMARY), 'POST', '/v1/admin/accounts', { email: NEW, grants: preset });
check('a change with the panel session token (wk1) → google', viaSession.status === 403 && viaSession.body.code === 'google', viaSession.body);

const add = await call(P, 'POST', '/v1/admin/accounts', { email: NEW, grants: preset, servantId: 'srv-aaaa1111' });
check('add with the «خادم – حجوزات» preset', add.status === 200 && add.body.admins.some(a => a.email === NEW && a.grants['bookings.create_cash'] === 'own'), add.body);
check('the new admin signs in', (await call(N, 'GET', '/v1/admin/whoami')).status === 200);
const theirs = await call(N, 'GET', '/v1/admin/accounts');
check('… sees «الصلاحيات» but can not manage', theirs.status === 200 && theirs.body.canManage === false, theirs.body);
const escalate = await call(N, 'POST', `/v1/admin/accounts/${encodeURIComponent(NEW)}`, { grants: { 'finance.manage': 'all' } });
check('… and can not change accounts (accounts.manage)', escalate.status === 403 && escalate.body.perm === 'accounts.manage', escalate.body);

const upd = await call(P, 'POST', `/v1/admin/accounts/${encodeURIComponent(NEW)}`, { grants: { ...preset, 'finance.view': 'all' }, servantId: 'srv-aaaa1111' });
check('change grants', upd.status === 200 && upd.body.admins.find(a => a.email === NEW).grants['finance.view'] === 'all', upd.body);
const bad = await call(P, 'POST', `/v1/admin/accounts/${encodeURIComponent(NEW)}`, { grants: { 'bookings.fly': 'all' } });
check('unknown permission → invalid grants', bad.status === 400 && bad.body.field === 'grants', bad.body);
const prim = await call(P, 'POST', `/v1/admin/accounts/${encodeURIComponent(PRIMARY)}`, { grants: {} });
check('the Primary row is immutable', prim.status === 403 && prim.body.reason === 'primary', prim.body);

const raw = '{"v":1}';
const ts = String(Date.now());
const snap = await fetch(base + '/v1/sync/grants', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-ts': ts, 'x-sync-signature': await signSync(SYNC, ts, raw) }, body: raw }).then(r => r.json());
const mine = snap.admins && snap.admins.find(a => a.email === NEW);
check('grants snapshot (Apps Script) carries the new admin', !!mine && mine.g[snap.perms.indexOf('bookings.create_cash')] === 'O' && mine.servantId === 'srv-aaaa1111', snap);

const rm = await call(P, 'POST', `/v1/admin/accounts/${encodeURIComponent(NEW)}/remove`, {});
check('remove', rm.status === 200 && !rm.body.admins.some(a => a.email === NEW), rm.body);
check('removed: refused at the next call', (await call(N, 'GET', '/v1/admin/whoami')).status === 403);

const acts = await call(P, 'GET', '/v1/admin/activity?limit=20');
const mineActs = (acts.body.items || []).filter(a => a.entityId === NEW).map(a => a.action);
check('audit: add, change, remove', ['accounts.add', 'accounts.grants', 'accounts.remove'].every(a => mineActs.includes(a)), mineActs);

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
