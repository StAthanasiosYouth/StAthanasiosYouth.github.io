// Phase 1.5 step 2 (apps-script/Grants.gs): the signed grants pull, its 60-s
// cache and last-good copy, assertCan_ / API_PERMS (default-deny), the
// recovery panel while enforcing, and the ADMIN_EMAILS mirror.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createWorld } from './fakes/gas.mjs';
import { signSync } from '../worker/src/lib/sync.js';
import { PERMS, PRIMARY_DEFAULT } from '../worker/src/lib/perms.js';

const URL_ = 'https://athanasios-api.menazak-lab.workers.dev/v1/sync/grants';
const SECRET = 's'.repeat(48);
const OWNER = 'menazakmena@gmail.com';
const B = 'b@example.com';

const g = (fill, over = {}) => PERMS.map(p => over[p] || fill).join('');
function snap({ enforce = false, admins, adminsSyncTs = 1 } = {}) {
  return {
    ok: true, v: 1, enforce, adminsSyncTs, perms: PERMS, primaryDefault: PRIMARY_DEFAULT,
    admins: admins || [{ email: OWNER, name: '', primary: true, servantId: null, g: g('A') }, { email: B, name: '', primary: false, servantId: null, g: g('-') }]
  };
}

function world(reply = snap(), executeAs = 'USER_DEPLOYING') {
  const w = createWorld({ executeAs });
  w.as(OWNER).gs.setup();
  w.properties.set('ADMIN_CLIENT_ID', '1234-abc.apps.googleusercontent.com');
  w.properties.set('ADMIN_EMAILS', `${OWNER}, ${B}`);
  w.as('');
  w.properties.set('WORKER_SYNC_SECRET', SECRET);
  if (reply) w.web[URL_] = { status: 200, body: JSON.stringify(reply) };
  w.gs.API_REQUEST_ = null;
  return w;
}
const pulls = w => w.webRequests.filter(r => r.url === URL_);
const scope = (w, email, perm) => { w.gs.API_REQUEST_ = null; return w.gs.grantScope_(email, perm); };

function tab(w, email) {
  const now = Math.floor((Date.now() + w.clock.skew) / 1000);
  const token = w.issueToken({ email, iat: String(now), exp: String(now + 3600) });
  const started = w.post({ fn: 'apiSessionStart', args: [{ device: 'test', force: true, state: false }], token });
  assert.equal(started.ok, true, started.error);
  return (fn, ...args) => w.post({ fn, args, token, sid: started.result.sid });
}

// ---------- API_PERMS ----------

test('API_PERMS covers every api* function (in apiFunctions_ and in every .gs file); values are Worker catalog keys', () => {
  const w = world();
  const table = w.gs.API_PERMS;
  const listed = Object.keys(w.gs.apiFunctions_());
  const dir = new URL('../apps-script/', import.meta.url);
  const declared = readdirSync(dir).filter(f => f.endsWith('.gs'))
    .flatMap(f => [...readFileSync(new URL(f, dir), 'utf8').matchAll(/^function (api[A-Z]\w*)\s*\(/gm)].map(m => m[1])).filter(n => !n.endsWith('_'));
  for (const fn of new Set([...listed, ...declared])) assert.ok(Object.prototype.hasOwnProperty.call(table, fn), 'unmapped: ' + fn);
  for (const fn of Object.keys(table)) assert.ok(listed.includes(fn), 'stale: ' + fn);
  for (const [fn, p] of Object.entries(table)) assert.ok(p === '*' || PERMS.includes(p), fn + ' → ' + p);
  // write functions never open to any admin by default, except the admin's own session / devices / name
  const any = Object.entries(table).filter(([, p]) => p === '*').map(([fn]) => fn).sort();
  assert.deepEqual(any, ['apiAdminPushDevices', 'apiAdminPushRemoveDevice', 'apiAdminPushSubscribe', 'apiAdminPushUnsubscribe', 'apiForgetDevice',
    'apiHeartbeat', 'apiSessionEnd', 'apiSessionResume', 'apiSessionStart', 'apiSetAdminName', 'apiState', 'apiTrustDevice', 'apiWorkerSession']);
  assert.equal(table.apiAddAdmin, 'accounts.manage');
  assert.equal(table.apiRemoveAdmin, 'accounts.manage');
});

test('default-deny: an api* function missing from API_PERMS is refused', () => {
  const w = world();
  w.gs.API_REQUEST_ = { email: OWNER };
  assert.throws(() => w.gs.assertApiPerm_('apiSomethingNew'), /مش مسموح لك تعمل ده/);
  assert.equal(w.gs.assertApiPerm_('apiState'), 'all');
});

// ---------- the pull ----------

test('pull: signed exactly like the Worker checks; cached 60 s; refetched after', async () => {
  const w = world();
  assert.ok(w.gs.grantsSnapshot_());
  const req = pulls(w)[0];
  const body = Buffer.from(req.options.payload.map(b => (b < 0 ? b + 256 : b))).toString('utf8');
  assert.equal(req.options.headers['x-sync-signature'], await signSync(SECRET, req.options.headers['x-sync-ts'], body));
  w.gs.API_REQUEST_ = null; w.gs.grantsSnapshot_();
  assert.equal(pulls(w).length, 1, 'cached');
  w.advance(61 * 1000);
  w.gs.API_REQUEST_ = null; w.gs.grantsSnapshot_();
  assert.equal(pulls(w).length, 2, 'refetched after 60 s');
  assert.ok(w.properties.get('GRANTS_LAST_GOOD'), 'last-good kept');
  assert.ok(w.properties.get('GRANTS_LAST_GOOD').length < 9000, 'fits one Script Property');
});

test('pull: Worker down → last-good; no last-good → allowlist alone; a miss is retried once a minute, never throws', () => {
  const w = world(null);
  assert.equal(w.gs.grantsSnapshot_(), null);
  assert.equal(scope(w, B, 'bookings.approve'), 'all', 'no snapshot: as before');
  assert.equal(scope(w, B, 'accounts.manage'), '', 'no snapshot: account management stays Primary');
  const misses = w.webRequests.length;
  scope(w, B, 'content.edit');
  assert.equal(w.webRequests.length, misses, 'the miss is cached');

  w.properties.set('GRANTS_LAST_GOOD', JSON.stringify(snap({ enforce: true })));
  assert.equal(scope(w, B, 'content.edit'), '', 'last-good (enforcing) used while the Worker is down');
  w.web[URL_] = { status: 503, body: 'down' };
  w.advance(61 * 1000);
  assert.equal(scope(w, B, 'content.edit'), '');
  w.web[URL_] = { status: 200, body: JSON.stringify({ ok: true, v: 1, perms: ['x'], admins: [{ email: B, g: '' }] }) };
  w.advance(61 * 1000);
  assert.equal(scope(w, B, 'content.edit'), '', 'a malformed reply is ignored (last-good stays)');
});

// ---------- the matrix ----------

test('matrix: enforce off = everything but the Primary defaults; on = grants only; Primary = all; own scope', () => {
  const off = world(snap({ enforce: false }));
  for (const p of PERMS) assert.equal(scope(off, B, p), PRIMARY_DEFAULT.includes(p) ? '' : 'all', 'off ' + p);
  for (const p of PERMS) assert.equal(scope(off, OWNER, p), 'all', 'primary ' + p);
  assert.equal(scope(off, 'stranger@example.com', 'content.view'), '', 'not on the allowlist: nothing');

  const on = world(snap({ enforce: true, admins: [
    { email: OWNER, name: '', primary: true, servantId: null, g: g('-') },
    { email: B, name: '', primary: false, servantId: 'srv-1', g: g('-', { 'content.view': 'A', 'bookings.create_cash': 'O', 'accounts.manage': 'A' }) }
  ] }));
  assert.equal(scope(on, B, 'content.view'), 'all');
  assert.equal(scope(on, B, 'content.edit'), '');
  assert.equal(scope(on, B, 'bookings.create_cash'), 'own');
  assert.equal(scope(on, B, 'accounts.manage'), 'all', 'an explicit grant counts');
  assert.equal(scope(on, OWNER, 'content.edit'), 'all', 'Primary needs no grant');
  assert.equal(scope(on, B, '*'), 'all');
});

test('doPost: every call checks its permission; refusal code perm; revocation within the cache minute', () => {
  const w = world(snap({ enforce: true, admins: [
    { email: OWNER, name: '', primary: true, servantId: null, g: g('A') },
    { email: B, name: '', primary: false, servantId: null, g: g('-', { 'activity.view': 'A' }) }
  ] }));
  const call = tab(w, B);
  assert.equal(call('apiActivity', {}).ok, true);
  const r = call('apiAdmins');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'perm');
  assert.equal(call('apiAddAdmin', 'c@example.com').code, 'perm');

  w.web[URL_] = { status: 200, body: JSON.stringify(snap({ enforce: true })) };   // activity.view revoked
  w.advance(61 * 1000);
  assert.equal(call('apiActivity', {}).code, 'perm', 'revoked after the cache minute');
  assert.equal(tab(w, OWNER)('apiAdmins').ok, true, 'Primary unaffected');
});

test('doPost, enforce off: today\'s access, except account management (Primary only)', () => {
  const w = world(snap({ enforce: false }));
  const call = tab(w, B);
  assert.equal(call('apiAdmins').ok, true);
  assert.equal(call('apiAddAdmin', 'c@example.com').code, 'perm');
  const moved = tab(w, OWNER)('apiAddAdmin', 'c@example.com');
  assert.equal(moved.ok, false);
  assert.match(moved.error, /الصلاحيات/, 'the Primary is pointed to «الصلاحيات» (D1 owns accounts)');
});

test('recovery panel (HtmlService): open to the allowlist while not enforcing; Primary only while enforcing', () => {
  const w = world(snap({ enforce: false }), 'USER_ACCESSING');
  w.as(B); w.gs.API_REQUEST_ = null;
  assert.equal(w.gs.assertAdmin_(), B);
  w.web[URL_] = { status: 200, body: JSON.stringify(snap({ enforce: true })) };
  w.advance(61 * 1000);
  assert.throws(() => w.gs.assertAdmin_(), /مش مسموح/);
  w.as(OWNER);
  assert.equal(w.gs.assertAdmin_(), OWNER);
});

// ---------- the ADMIN_EMAILS mirror ----------

const adminsOf = (...emails) => emails.map((email, i) => ({ email, name: '', primary: email === OWNER, servantId: null, g: g(i ? '-' : 'A') }));

test('mirror: D1 active admins → ADMIN_EMAILS; guarded (never empty, never without the Primary, never over 20)', () => {
  const w = world(snap({ admins: adminsOf(OWNER, B, 'c@example.com') }));
  w.gs.grantsSnapshot_();
  assert.equal(w.properties.get('ADMIN_EMAILS'), `${OWNER}, ${B}, c@example.com`, 'mirrored');

  for (const bad of [adminsOf(B), [], adminsOf(OWNER, ...Array.from({ length: 25 }, (_, i) => `x${i}@example.com`))]) {
    w.web[URL_] = { status: 200, body: JSON.stringify(snap({ admins: bad })) };
    w.advance(61 * 1000); w.gs.API_REQUEST_ = null; w.gs.grantsSnapshot_();
    assert.equal(w.properties.get('ADMIN_EMAILS'), `${OWNER}, ${B}, c@example.com`, 'refused: no primary / empty / too many');
  }

  w.web[URL_] = { status: 200, body: JSON.stringify(snap({ admins: adminsOf(OWNER) })) };
  w.advance(61 * 1000); w.gs.API_REQUEST_ = null; w.gs.grantsSnapshot_();
  assert.equal(w.properties.get('ADMIN_EMAILS'), OWNER, 'removals follow D1');
  assert.equal(w.gs.isAdmin_(B), false);
});
