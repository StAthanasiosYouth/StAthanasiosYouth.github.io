// Phase 6 Step 4d: the new FCM web API (assets/js/push-fid.js) on a fake Firebase SDK.
// Run: cd tools && node --test ../tests/push-fid.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceId, forget, installationId, FID } from '../assets/js/push-fid.js';

const FAKE_FID = 'cR_m2xYz0123456789abcd';
const TOKEN = 'legacy-token-'.padEnd(150, 'x');

function sdk({ registerFails = false, fid = FAKE_FID } = {}) {
  const calls = [];
  let handler = null;
  return {
    calls,
    onRegistered(m, fn) { calls.push('onRegistered'); handler = fn; return () => { calls.push('stop'); handler = null; }; },
    async register(m, options) {
      calls.push('register:' + options.vapidKey + ':' + (options.serviceWorkerRegistration ? 'sw' : ''));
      if (registerFails) throw new Error('installations api disabled');
      if (!handler) throw new Error('invalid-on-registered-handler');
      handler(fid);
    },
    async unregister() { calls.push('unregister'); },
    async getToken() { calls.push('getToken'); return TOKEN; },
    async deleteToken() { calls.push('deleteToken'); return true; }
  };
}
const quiet = fn => async () => { const warn = console.warn; console.warn = () => {}; try { await fn(); } finally { console.warn = warn; } };

test('on the Worker: the FID from onRegistered, the handler removed after', async () => {
  const s = sdk();
  assert.equal(await deviceId(s, {}, {}, 'vapid', true), FAKE_FID);
  assert.deepEqual(s.calls, ['onRegistered', 'register:vapid:sw', 'stop']);
  assert.ok(FID.test(FAKE_FID) && !FID.test(TOKEN));
});

test('on Apps Script: the old token, register never called', async () => {
  const s = sdk();
  assert.equal(await deviceId(s, {}, {}, 'vapid', false), TOKEN);
  assert.deepEqual(s.calls, ['getToken']);
});

test('register fails (an API off, an old browser): the old token, which the Worker takes too', quiet(async () => {
  const s = sdk({ registerFails: true });
  assert.equal(await deviceId(s, {}, {}, 'vapid', true), TOKEN);
  assert.deepEqual(s.calls, ['onRegistered', 'register:vapid:sw', 'stop', 'getToken']);
  await assert.rejects(installationId(sdk({ fid: 'short' }), {}, {}, 'vapid'), /no installation id/);
}));

test('off: an FID is unregistered; an old token is deleted, tied to our worker first', async () => {
  const a = sdk();
  await forget(a, {}, {}, 'vapid', FAKE_FID);
  assert.deepEqual(a.calls, ['unregister']);
  const b = sdk();
  await forget(b, {}, {}, 'vapid', TOKEN);
  assert.deepEqual(b.calls, ['getToken', 'deleteToken']);
});
