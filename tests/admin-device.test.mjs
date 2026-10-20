// «خليك داخل» on the installed admin app (apps-script/AdminDevice.gs): a
// trusted device made only after a real Google sign-in, a signed challenge
// for a short-lived access token, nothing readable, and every way it ends
// (logout, end date, admin removed, bad signatures, replay).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createWorld } from './fakes/gas.mjs';

const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'fady.youssef@gmail.com';
const CLIENT = '1234-abc.apps.googleusercontent.com';

function apiWorld() {
  const world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('ADMIN_CLIENT_ID', CLIENT);
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  world.as('');
  return world;
}

function googleTab(world, email) {
  const now = Math.floor((Date.now() + world.clock.skew) / 1000);
  const token = world.issueToken({ email, iat: String(now), exp: String(now + 3600) });
  const started = world.post({ fn: 'apiSessionStart', args: [{ device: 'موبايل أندرويد – التطبيق', force: true, state: false }], token });
  assert.equal(started.ok, true, started.error);
  return { token, sid: started.result.sid, call: (fn, ...args) => world.post({ fn, args, token, sid: started.result.sid }) };
}

/* what admin/device.js does, with the secret it was given */
function signIn(world, device, { ts, nonce, secret = device.secret, id = device.deviceId } = {}) {
  ts = ts ?? Date.now() + world.clock.skew;
  nonce = nonce ?? randomBytes(16).toString('hex');
  const sig = createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${id}.${ts}.${nonce}`, 'utf8').digest('hex');
  return world.post({ fn: 'deviceSignIn', args: [{ deviceId: id, ts, nonce, sig }] });
}

function deviceTab(world, access) {
  const started = world.post({ fn: 'apiSessionStart', args: [{ device: 'موبايل أندرويد – التطبيق', force: true, state: false }], token: access });
  assert.equal(started.ok, true, started.error);
  return { call: (fn, ...args) => world.post({ fn, args, token: access, sid: started.result.sid }) };
}


test('trust: only after a Google sign-in; the secret is stored server-side only (Script Properties), with a hard end', () => {
  const world = apiWorld();
  const app = googleTab(world, ADMIN);
  const trusted = app.call('apiTrustDevice', { label: 'موبايل أندرويد – التطبيق' });
  assert.equal(trusted.ok, true, trusted.error);
  const { deviceId, secret, until } = trusted.result;
  assert.match(deviceId, /^[0-9a-f]{24}$/);
  assert.match(secret, /^[0-9a-f]{64}$/);
  const days = (until - (Date.now() + world.clock.skew)) / 86400000;
  assert.ok(days > 29.9 && days <= 30, 'thirty days from this Google sign-in');
  const stored = JSON.parse(world.properties.get(`ADMIN_DEVICE_${deviceId}`));
  assert.equal(stored.email, ADMIN);
  assert.equal(world.spreadsheet.getSheets().some(s => JSON.stringify(s.data).includes(secret)), false, 'never in the Sheet');

  // no token at all: refused
  assert.equal(world.post({ fn: 'apiTrustDevice', args: [{}] }).ok, false);
});

test('device sign-in: a right signature → a short-lived access token that works like the Google token, as that account', () => {
  const world = apiWorld();
  const device = googleTab(world, ADMIN).call('apiTrustDevice', {}).result;
  const reply = signIn(world, device);
  assert.equal(reply.ok, true);
  assert.equal(reply.email, ADMIN);
  assert.match(reply.token, /^adm1\.[0-9a-f]{64}$/);
  const app = deviceTab(world, reply.token);
  const state = app.call('apiState');
  assert.equal(state.ok, true);
  assert.equal(state.result.user, ADMIN);
  // logged as the account
  app.call('apiSaveItem', 'news', { title: 'من التطبيق', summary: 'x' });
  const activity = world.spreadsheet.getSheetByName('Activity').data.at(-1);
  assert.equal(activity[3], ADMIN);
});

/* deviceSignIn with { start }: the app's launch in ONE round trip */
function launch(world, device, start = { device: 'موبايل أندرويد – التطبيق', tab: 't' + Math.random().toString(36).slice(2, 10) }) {
  const ts = Date.now() + world.clock.skew;
  const nonce = randomBytes(16).toString('hex');
  const sig = createHmac('sha256', Buffer.from(device.secret, 'utf8')).update(`${device.deviceId}.${ts}.${nonce}`, 'utf8').digest('hex');
  return world.post({ fn: 'deviceSignIn', args: [{ deviceId: device.deviceId, ts, nonce, sig, start }] });
}

test('app launch: the token AND the panel session + state in one answer; the same phone takes its own swiped-away session silently, another phone still asks', () => {
  const world = apiWorld();
  const device = googleTab(world, ADMIN).call('apiTrustDevice', {}).result;
  const first = launch(world, device);
  assert.equal(first.ok, true);
  assert.match(first.token, /^adm1\./);
  assert.match(first.session.sid, /^[0-9a-f-]{36}$/);
  assert.equal(first.session.state.user, ADMIN, 'the panel state came with it');
  // it works as a session right away
  const beat = world.post({ fn: 'apiHeartbeat', args: [{ area: 'home' }], token: first.token, sid: first.session.sid });
  assert.equal(beat.ok, true, beat.error);

  // the app swiped away (no beacon), opened again a moment later: no «another device» question
  world.advance(10_000);
  const again = launch(world, device);
  assert.equal(again.ok, true);
  assert.ok(again.session.sid && again.session.sid !== first.session.sid, 'a new session, no takeover question');
  assert.equal(world.post({ fn: 'apiHeartbeat', args: [{ area: 'home' }], token: first.token, sid: first.session.sid }).code, 'session_replaced');

  // a DIFFERENT trusted phone of the same admin while this one is live: still the question
  world.post({ fn: 'apiHeartbeat', args: [{ area: 'home' }], token: again.token, sid: again.session.sid });
  const other = googleTab(world, ADMIN);
  void other;
  const phone2 = googleTab(world, ADMIN).call('apiTrustDevice', {}).result;
  const live = launch(world, device);    // takes it back (same device)
  world.post({ fn: 'apiHeartbeat', args: [{ area: 'home' }], token: live.token, sid: live.session.sid });
  const asked = launch(world, phone2);
  assert.ok(asked.session.active, 'another device: the takeover question');
});

test('pending admin pushes: the 5-minute trigger carries them (nobody left in the panel)', () => {
  const world = apiWorld();
  assert.ok(world.gs.ACTIVITY_CARRIER_FNS.includes('trigger'));
});

test('device sign-in: wrong secret, old time, a replayed nonce, an unknown device — all refused alike; ten bad tries end the device', () => {
  const world = apiWorld();
  const device = googleTab(world, ADMIN).call('apiTrustDevice', {}).result;
  assert.equal(signIn(world, device, { secret: 'f'.repeat(64) }).code, 'device');
  assert.equal(signIn(world, device, { ts: Date.now() + world.clock.skew - 11 * 60000 }).code, 'device');
  const nonce = randomBytes(16).toString('hex');
  assert.equal(signIn(world, device, { nonce }).ok, true);
  assert.equal(signIn(world, device, { nonce }).ok, false, 'a replay');
  assert.equal(signIn(world, device, { id: '0'.repeat(24) }).ok, false);
  for (let i = 0; i < 10; i++) signIn(world, device, { secret: 'e'.repeat(64) });
  assert.equal(signIn(world, device).ok, false, 'locked out after ten bad signatures');
  assert.equal(world.properties.get(`ADMIN_DEVICE_${device.deviceId}`), undefined);
});

test('device tokens can\'t add/remove admins or trust another device (Google again: reauth)', () => {
  const world = apiWorld();
  const device = googleTab(world, ADMIN).call('apiTrustDevice', {}).result;
  const app = deviceTab(world, signIn(world, device).token);
  for (const [fn, arg] of [['apiAddAdmin', 'x@gmail.com'], ['apiRemoveAdmin', SECOND], ['apiTrustDevice', {}]]) {
    const reply = app.call(fn, arg);
    assert.equal(reply.ok, false, fn);
    assert.equal(reply.code, 'reauth', fn);
  }
  assert.match(world.properties.get('ADMIN_EMAILS'), new RegExp(SECOND));
});

test('it ends: logout, the end date (never extended by use), the admin removed — at once, also for tokens already given', () => {
  const world = apiWorld();

  // logout
  let device = googleTab(world, ADMIN).call('apiTrustDevice', {}).result;
  let app = deviceTab(world, signIn(world, device).token);
  assert.equal(app.call('apiForgetDevice', {}).ok, true);
  assert.equal(app.call('apiState').code, 'auth', 'the token it had stops working');
  assert.equal(signIn(world, device).ok, false);

  // end date: daily use doesn't extend it
  device = googleTab(world, ADMIN).call('apiTrustDevice', {}).result;
  for (let day = 0; day < 29; day++) {
    world.advance(86400000);
    assert.equal(signIn(world, device).ok, true, `day ${day + 1}`);
  }
  world.advance(2 * 86400000);
  assert.equal(signIn(world, device).code, 'expired');

  // the admin removed
  const fady = googleTab(world, SECOND).call('apiTrustDevice', {}).result;
  const fadyApp = deviceTab(world, signIn(world, fady).token);
  // removed in «الصلاحيات»: D1's list reaches ADMIN_EMAILS (Grants.gs mirror)
  world.properties.set('WORKER_SYNC_SECRET', 's'.repeat(48));
  world.web['https://athanasios-api.menazak-lab.workers.dev/v1/sync/grants'] = { status: 200, body: JSON.stringify({
    ok: true, v: 1, enforce: false, perms: ['content.view'], admins: [{ email: ADMIN, primary: true, g: 'A' }]
  }) };
  world.gs.API_REQUEST_ = null;
  world.gs.grantsSnapshot_();
  assert.equal(signIn(world, fady).ok, false);
  assert.equal(fadyApp.call('apiState').ok, false);
});

test('a new Google sign-in on the same phone replaces its old credential; at most five per admin', () => {
  const world = apiWorld();
  const first = googleTab(world, ADMIN).call('apiTrustDevice', {}).result;
  const again = googleTab(world, ADMIN).call('apiTrustDevice', { previous: first.deviceId }).result;
  assert.equal(signIn(world, first).ok, false, 'the old one is gone');
  assert.equal(signIn(world, again).ok, true);
  for (let i = 0; i < 6; i++) { world.advance(1000); googleTab(world, ADMIN).call('apiTrustDevice', {}); }
  const mine = [...world.properties.keys()].filter(k => k.startsWith('ADMIN_DEVICE_'));
  assert.equal(mine.length, 5);
});
