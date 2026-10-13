// admin/push.js status(): the truth is THIS browser's subscription, not only the
// remembered token — a reopened admin never asks to turn on notifications that
// already work, and a token the server lost is registered again, quietly.

import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: key => { store.delete(key); }
};
globalThis.Notification = { permission: 'granted' };

const { status } = await import('../admin/push.js');

const MEMO = 'athanasios-admin.push';
const TOKEN = 'a001Xk2:APA91b' + 'Z'.repeat(140);
const info = { platform: 'android', device: 'موبايل أندرويد – التطبيق' };
const reg = subscribed => ({ pushManager: { getSubscription: async () => (subscribed ? { endpoint: 'https://fcm.googleapis.com/x' } : null) } });

/* a fake server: the tokens it knows; every call recorded */
function server(known = []) {
  const tokens = new Set(known);
  const calls = [];
  const call = async (fn, arg) => {
    calls.push(fn);
    if (fn === 'apiAdminPushDevices') return { on: !!(arg && arg.token && tokens.has(arg.token)), devices: [...tokens].map(t => ({ id: t.slice(-4), current: arg && arg.token === t })) };
    if (fn === 'apiAdminPushSubscribe') { tokens.add(arg.token); if (arg.previous) tokens.delete(arg.previous); return { on: true }; }
    throw new Error(fn);
  };
  return { call, calls, tokens };
}

test('the memo got lost but this browser is still subscribed: on, and the memo comes back', async () => {
  store.clear();
  const s = server([TOKEN]);
  const result = await status(s.call, reg(true), info, async () => TOKEN);
  assert.equal(result.on, true);
  assert.equal(JSON.parse(store.get(MEMO)).token, TOKEN);
  assert.ok(!s.calls.includes('apiAdminPushSubscribe'), 'nothing to register again');
});

test('the server lost this device (or Firebase rotated the token): registered again quietly, on', async () => {
  store.clear();
  store.set(MEMO, JSON.stringify({ token: 'old-' + TOKEN, at: 1 }));
  const s = server(['old-' + TOKEN]);
  const rotated = 'new-' + TOKEN;
  const result = await status(s.call, reg(true), info, async () => rotated);
  assert.equal(result.on, true);
  assert.ok(s.tokens.has(rotated) && !s.tokens.has('old-' + TOKEN), 'the rotated token replaced the old one');
  assert.equal(JSON.parse(store.get(MEMO)).token, rotated);
});

test('turned off in the browser (no subscription): off, and a stale memo is dropped', async () => {
  store.clear();
  store.set(MEMO, JSON.stringify({ token: TOKEN, at: 1 }));
  const s = server([]);
  const result = await status(s.call, reg(false), info, async () => { throw new Error('never asked'); });
  assert.equal(result.on, false);
  assert.equal(store.get(MEMO), undefined);
  assert.ok(!s.calls.includes('apiAdminPushSubscribe'));
});

test('notifications not allowed here: never registers anything', async () => {
  store.clear();
  globalThis.Notification.permission = 'default';
  const s = server([]);
  const result = await status(s.call, reg(true), info, async () => TOKEN);
  assert.equal(result.on, false);
  assert.ok(!s.calls.includes('apiAdminPushSubscribe'));
  globalThis.Notification.permission = 'granted';
});
