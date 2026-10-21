// Phase 3 P3-2 / P3-3 (apps-script/AdminPlatform.gs, docs/ADMIN-PLATFORM-PLAN.md):
// while ADMIN_PLATFORM = 'worker', Apps Script takes the Worker's panel token,
// asks the Worker about the session and the edit locks, and shows D1's names.
// Without the property nothing changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createWorld } from './fakes/gas.mjs';
import { PERMS, PRIMARY_DEFAULT } from '../worker/src/lib/perms.js';

const API = 'https://athanasios-api.menazak-lab.workers.dev';
const SESSION_URL = API + '/v1/sync/session';
const GRANTS_URL = API + '/v1/sync/grants';
const SECRET = 's'.repeat(48);
const OWNER = 'menazakmena@gmail.com';
const B = 'b@example.com';
const SID = 'sid-aaaaaaaaaaaaaaaaaaaa';

function panelToken(w, { email = OWNER, sid = SID, via = 'google', secret = SECRET, life = 900 } = {}) {
  const i = Math.floor((Date.now() + w.clock.skew) / 1000);
  const p = Buffer.from(JSON.stringify({ e: email, x: i + life, v: via, i, s: sid })).toString('base64url');
  return 'wk1.' + p + '.' + createHmac('sha256', secret).update('wk1.' + p).digest('hex');
}

function world({ on = true } = {}) {
  const w = createWorld({ executeAs: 'USER_DEPLOYING' });
  w.as(OWNER).gs.setup();
  w.properties.set('ADMIN_CLIENT_ID', '1234-abc.apps.googleusercontent.com');
  w.properties.set('ADMIN_EMAILS', `${OWNER}, ${B}`);
  w.as('');
  w.properties.set('WORKER_SYNC_SECRET', SECRET);
  if (on) w.properties.set('ADMIN_PLATFORM', 'worker');
  w.web[GRANTS_URL] = { status: 200, body: JSON.stringify({
    ok: true, v: 1, enforce: false, adminsSyncTs: 1, perms: PERMS, primaryDefault: PRIMARY_DEFAULT,
    admins: [{ email: OWNER, name: 'مينا من D1', primary: true, servantId: null, g: PERMS.map(() => 'A').join('') },
      { email: B, name: 'بيشوي', primary: false, servantId: null, g: PERMS.map(() => '-').join('') }]
  }) };
  w.gs.API_REQUEST_ = null;
  return w;
}
const worker = (w, reply, status = 200) => { w.web[SESSION_URL] = { status, body: JSON.stringify({ ok: status === 200, ...reply }) }; };
const asks = w => w.webRequests.filter(r => r.url === SESSION_URL);

test('switch off: a Worker panel token is not accepted (today\'s behaviour)', () => {
  const w = world({ on: false });
  worker(w, { state: 'live', holders: {} });
  const r = w.post({ fn: 'apiState', args: [], token: panelToken(w), sid: SID });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'auth');
  assert.equal(asks(w).length, 0);
});

test('on: the panel token + its sid opens the API; the Worker is asked once per 20 s, signed', () => {
  const w = world();
  worker(w, { state: 'live', holders: {} });
  const token = panelToken(w);
  const r = w.post({ fn: 'apiState', args: [], token, sid: SID });
  assert.equal(r.ok, true, r.error);
  assert.equal(w.post({ fn: 'apiState', args: [], token, sid: SID }).ok, true);
  assert.equal(asks(w).length, 1);
  const sent = asks(w)[0].options;
  const body = Buffer.from(sent.payload.map(b => (b < 0 ? b + 256 : b))).toString('utf8');
  assert.deepEqual(JSON.parse(body), { email: OWNER, sid: SID, locks: [] });
  assert.equal(sent.headers['x-sync-signature'], 'v1=' + createHmac('sha256', SECRET).update(sent.headers['x-sync-ts'] + '.' + body).digest('hex'));
  w.advance(21000);
  w.post({ fn: 'apiState', args: [], token, sid: SID });
  assert.equal(asks(w).length, 2);
});

test('on: replaced / expired / Worker away / another sid / bad signature / expired token', () => {
  const w = world();
  worker(w, { state: 'replaced', holders: {} });
  assert.equal(w.post({ fn: 'apiState', args: [], token: panelToken(w), sid: SID }).code, 'session_replaced');
  worker(w, { state: 'expired', holders: {} });
  assert.equal(w.post({ fn: 'apiState', args: [], token: panelToken(w), sid: SID }).code, 'session_expired');
  worker(w, {}, 503);
  assert.equal(w.post({ fn: 'apiState', args: [], token: panelToken(w), sid: SID }).code, 'busy');
  worker(w, { state: 'live', holders: {} });
  assert.equal(w.post({ fn: 'apiState', args: [], token: panelToken(w), sid: 'sid-bbbbbbbbbbbbbbbbbbbb' }).code, 'session_replaced');
  assert.equal(w.post({ fn: 'apiState', args: [], token: panelToken(w, { secret: 'x'.repeat(48) }), sid: SID }).code, 'auth');
  assert.equal(w.post({ fn: 'apiState', args: [], token: panelToken(w, { life: -120 }), sid: SID }).code, 'auth');
  assert.equal(w.post({ fn: 'apiState', args: [], token: panelToken(w, { life: 3600 }), sid: SID }).code, 'auth');
});

test('on: a removed admin\'s panel token is refused; Google-only functions answer reauth', () => {
  const w = world();
  worker(w, { state: 'live', holders: {} });
  const r = w.post({ fn: 'apiState', args: [], token: panelToken(w, { email: 'gone@example.com' }), sid: SID });
  assert.equal(r.code, 'denied');
  assert.equal(w.post({ fn: 'apiTrustDevice', args: [{}], token: panelToken(w), sid: SID }).code, 'reauth');
});

test('on: the Apps Script sessions are closed (an older panel reloads), the Google token alone opens nothing', () => {
  const w = world();
  const now = Math.floor((Date.now() + w.clock.skew) / 1000);
  const google = w.issueToken({ email: OWNER, iat: String(now), exp: String(now + 3600) });
  const start = w.post({ fn: 'apiSessionStart', args: [{ device: 'x', force: true }], token: google });
  assert.equal(start.ok, false);
  assert.equal(start.code, 'session_expired');
  assert.match(start.error, /اتحدّثت/);
  worker(w, { state: 'expired', holders: {} });
  assert.equal(w.post({ fn: 'apiState', args: [], token: google, sid: SID }).code, 'session_expired');
});

test('on: edit locks are the Worker\'s — another session\'s holder refuses the save; the Worker away refuses too', () => {
  const w = world();
  worker(w, { state: 'live', holders: { 'links:l-1': { email: B, name: 'بيشوي', device: 'Android', since: 120 } } });
  w.gs.API_REQUEST_ = { email: OWNER, sid: SID };
  // a write asks once, fresh, for every lock — before the script lock
  w.gs.requireSession_(OWNER, SID, 'apiSaveLink');
  const asked = JSON.parse(Buffer.from(asks(w).at(-1).options.payload.map(b => (b < 0 ? b + 256 : b))).toString('utf8'));
  assert.equal(asked.all, true);
  assert.equal(w.gs.lockHolder_('links:l-1').name, 'بيشوي');
  assert.equal(w.gs.lockHolder_('links:l-2'), null);
  assert.throws(() => w.gs.assertUnlocked_('links:l-1'), /بيشوي بيعدّل ده دلوقتي/);
  // a write never reuses a cached «live»
  w.gs.API_REQUEST_ = { email: OWNER, sid: SID };
  w.gs.requireSession_(OWNER, SID, 'apiSaveLink');
  assert.equal(asks(w).length, 2);
  // not asked for this write, or the Worker away: refused, never a save over an open editor
  w.gs.API_REQUEST_ = { email: OWNER, sid: SID };
  assert.throws(() => w.gs.lockHolder_('links:l-1'), /مقدرناش نتأكد/);
  worker(w, {}, 500);
  assert.throws(() => w.gs.requireSession_(OWNER, SID, 'apiSaveLink'), /مقدرناش نتأكد من الجلسة/);
  w.gs.API_REQUEST_ = null;
});

test('on: a real save through doPost — no Worker call under the script lock', () => {
  const w = world();
  worker(w, { state: 'live', holders: {} });
  w.scriptLock.strict = true;
  const r = w.post({ fn: 'apiSaveItem', args: ['news', { title: 'خبر', summary: 'تجربة' }], token: panelToken(w), sid: SID });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(w.scriptLock.lockedFetches, []);
});

test('P3-3 on: the names come from D1; the Apps Script rename points to «الصلاحيات»', () => {
  const w = world();
  w.gs.API_REQUEST_ = { email: OWNER, sid: SID };
  assert.equal(w.gs.displayName_(B), 'بيشوي');
  assert.equal(w.gs.displayName_(OWNER), 'مينا من D1');
  assert.throws(() => w.gs.apiSetAdminName(B, 'اسم'), /«الصلاحيات»/);
  w.gs.API_REQUEST_ = null;
});

test('off: names and rename unchanged (ADMIN_NAMES)', () => {
  const w = world({ on: false });
  w.gs.API_REQUEST_ = null;
  assert.equal(w.gs.displayName_(B), 'b');
});
