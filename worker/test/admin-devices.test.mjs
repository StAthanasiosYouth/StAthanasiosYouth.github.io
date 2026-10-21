// Phase 3 P3-4 (src/admin/devices.js): «خليك داخل» on the Worker — trust (Google only),
// signed sign-in (skew, nonce, signature, fails), the device token, start in the
// same round trip, forget, the admin removed, the session renew. Real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { harness, fakeGoogle } from './helpers.mjs';
import { verifyWorkerToken } from '../src/lib/auth.js';
import { DEVICE_FAIL_MAX, DEVICE_PER_ADMIN } from '../src/admin/devices.js';

const P = 'p@example.com', M = 'm@example.com';
const TAB = 'tab-aaaaaaaaaaaaaaaa';

async function world() {
  const g = await fakeGoogle();
  const h = harness({ env: { ADMIN_EMAILS: '', DEVICE_KEY: 'k'.repeat(48) } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'Primary', 'primary', 1, 0), ('${M}', 'Mina', 'admin', 1, 0)`).run();
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'ADMIN_PLATFORM'").run();
  const google = async email => 'Bearer ' + await g.sign(g.claims({ email, sub: 'sub-' + email }));
  const call = async (auth, method, path, body) => h.call(path, { method, body, headers: auth ? { authorization: auth } : {}, fetch: g.fetch });
  const trust = async (email = M, body = {}) => call(await google(email), 'POST', '/v1/admin/devices/trust', { label: 'Pixel', ...body });
  const signIn = (dev, over = {}) => {
    const ts = over.ts ?? Date.now();
    const nonce = over.nonce ?? randomBytes(16).toString('hex');
    const sig = createHmac('sha256', over.secret ?? dev.secret).update(dev.deviceId + '.' + ts + '.' + nonce).digest('hex');
    return call(null, 'POST', '/v1/public/device/sign-in', { deviceId: dev.deviceId, ts, nonce, sig, ...(over.start ? { start: over.start } : {}) });
  };
  return { h, g, google, call, trust, signIn };
}

test('trust needs a Google ID token; the secret is stored encrypted, never in clear', async () => {
  const w = await world();
  const t = await w.trust();
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.match(t.body.deviceId, /^[0-9a-f]{24}$/);
  assert.match(t.body.secret, /^[0-9a-f]{64}$/);
  const row = await w.h.db.prepare('SELECT * FROM admin_devices WHERE id = ?').bind(t.body.deviceId).first();
  assert.ok(!row.secret_enc.includes(t.body.secret));
  assert.equal(row.label, 'Pixel');
  // with the device's own token: refused (Google itself only)
  const s = await w.signIn(t.body);
  const again = await w.call('Bearer ' + s.body.token, 'POST', '/v1/admin/devices/trust', {});
  assert.equal(again.body.code, 'google');
});

test('sign-in → a device token (v device, d id, no session); it opens admin routes and starts a session', async () => {
  const w = await world();
  const dev = (await w.trust()).body;
  const s = await w.signIn(dev);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const c = await verifyWorkerToken(w.h.env, s.body.token);
  assert.deepEqual([c.email, c.via, c.deviceId, c.sid], [M, 'device', dev.deviceId, '']);
  const start = await w.call('Bearer ' + s.body.token, 'POST', '/v1/admin/session/start', { device: 'Pixel', tab: TAB });
  assert.ok(start.body.sid, JSON.stringify(start.body));
  const pc = await verifyWorkerToken(w.h.env, start.body.token);
  assert.equal(pc.deviceId, dev.deviceId);
  assert.equal((await w.h.db.prepare('SELECT device_id FROM admin_sessions WHERE email = ?').bind(M).first('device_id')), dev.deviceId);
});

test('sign-in with start: the session in the same round trip; the same device takes its own live session over without a question', async () => {
  const w = await world();
  const dev = (await w.trust()).body;
  const a = await w.signIn(dev, { start: { device: 'Pixel', tab: TAB } });
  assert.ok(a.body.session.sid, JSON.stringify(a.body));
  await w.call('Bearer ' + a.body.session.token, 'POST', '/v1/admin/session/heartbeat', {});
  // the app swiped away and opened again (another tab id, no beacon): no «another device»
  const b = await w.signIn(dev, { start: { device: 'Pixel', tab: 'tab-cccccccccccccccc' } });
  assert.ok(b.body.session.sid && b.body.session.sid !== a.body.session.sid, JSON.stringify(b.body));
  // a Google sign-in elsewhere is still asked
  const other = await w.call(await w.google(M), 'POST', '/v1/admin/session/start', { device: 'Laptop', tab: 'tab-dddddddddddddddd' });
  assert.ok(other.body.active);
});

test('sign-in refused: bad signature, old time, reused nonce, unknown device — never says which; too many fails end the device', async () => {
  const w = await world();
  const dev = (await w.trust()).body;
  assert.equal((await w.signIn(dev, { secret: 'f'.repeat(64) })).body.code, 'device');
  assert.equal((await w.signIn(dev, { ts: Date.now() - 11 * 60000 })).body.code, 'device');
  const nonce = randomBytes(16).toString('hex');
  assert.equal((await w.signIn(dev, { nonce })).status, 200);
  assert.equal((await w.signIn(dev, { nonce })).body.code, 'device');
  assert.equal((await w.signIn({ deviceId: 'a'.repeat(24), secret: dev.secret })).body.code, 'device');
  assert.equal((await w.call(null, 'POST', '/v1/public/device/sign-in', { deviceId: 'x' })).body.code, 'bad');
  for (let i = 0; i < DEVICE_FAIL_MAX; i++) await w.signIn(dev, { secret: 'e'.repeat(64) });
  assert.equal(await w.h.db.prepare('SELECT COUNT(*) AS n FROM admin_devices').first('n'), 0);
  assert.equal((await w.signIn(dev)).body.code, 'device');
});

test('past its end: expired and deleted', async () => {
  const w = await world();
  const dev = (await w.trust()).body;
  await w.h.db.prepare('UPDATE admin_devices SET until_ms = ?').bind(Date.now() - 1).run();
  assert.equal((await w.signIn(dev)).body.code, 'expired');
  assert.equal(await w.h.db.prepare('SELECT COUNT(*) AS n FROM admin_devices').first('n'), 0);
});

test('forget (with the device token) stops every token naming the device at once', async () => {
  const w = await world();
  const dev = (await w.trust()).body;
  const s = await w.signIn(dev, { start: { device: 'Pixel', tab: TAB } });
  const panel = 'Bearer ' + s.body.session.token;
  assert.equal((await w.call(panel, 'GET', '/v1/admin/whoami')).status, 200);
  assert.equal((await w.call('Bearer ' + s.body.token, 'POST', '/v1/admin/devices/forget', {})).body.forgotten, true);
  assert.equal((await w.call(panel, 'GET', '/v1/admin/whoami')).body.code, 'auth');
  assert.equal((await w.signIn(dev)).body.code, 'device');
});

test('the same phone again (previous) replaces its credential; at most 5 per admin (least recently used goes)', async () => {
  const w = await world();
  const a = (await w.trust()).body;
  const b = (await w.trust(M, { previous: a.deviceId })).body;
  assert.equal(await w.h.db.prepare('SELECT COUNT(*) AS n FROM admin_devices WHERE email = ?').bind(M).first('n'), 1);
  assert.equal((await w.signIn(a)).body.code, 'device');
  assert.equal((await w.signIn(b)).status, 200);
  for (let i = 0; i < DEVICE_PER_ADMIN + 2; i++) await w.trust();
  assert.equal(await w.h.db.prepare('SELECT COUNT(*) AS n FROM admin_devices WHERE email = ?').bind(M).first('n'), DEVICE_PER_ADMIN);
});

test('an admin removed in «الصلاحيات»: devices, session and locks go in the same batch', async () => {
  const w = await world();
  const dev = (await w.trust()).body;
  const s = await w.signIn(dev, { start: { device: 'Pixel', tab: TAB } });
  await w.call('Bearer ' + s.body.session.token, 'POST', '/v1/admin/session/heartbeat', { locks: ['news:n1'] });
  const rm = await w.call(await w.google(P), 'POST', '/v1/admin/accounts/' + encodeURIComponent(M) + '/remove');
  assert.equal(rm.status, 200, JSON.stringify(rm.body));
  for (const t of ['admin_devices', 'admin_sessions', 'edit_locks']) assert.equal(await w.h.db.prepare('SELECT COUNT(*) AS n FROM ' + t).first('n'), 0, t);
});

test('renew: a fresh panel token for the live sid only', async () => {
  const w = await world();
  const s = await w.call(await w.google(M), 'POST', '/v1/admin/session/start', { device: 'x', tab: TAB });
  const r = await w.call(await w.google(M), 'POST', '/v1/admin/session/renew', { sid: s.body.sid });
  assert.equal((await verifyWorkerToken(w.h.env, r.body.token)).sid, s.body.sid);
  assert.equal((await w.call(await w.google(M), 'POST', '/v1/admin/session/renew', { sid: 'zzzzzzzzzzzzzzzzzzzz' })).body.code, 'session_replaced');
});

test('switch off or no DEVICE_KEY: devices refused', async () => {
  const w = await world();
  w.h.env.DEVICE_KEY = '';
  assert.equal((await w.trust()).body.code, 'disabled');
  await w.h.db.prepare("UPDATE settings SET value = '0' WHERE key = 'ADMIN_PLATFORM'").run();
  assert.equal((await w.trust()).body.code, 'off');
});

test('trust with the open sid binds that session to the device (a relaunch takes it over); forget ends that session', async () => {
  const w = await world();
  const s = await w.call(await w.google(M), 'POST', '/v1/admin/session/start', { device: 'Pixel', tab: TAB });
  await w.call('Bearer ' + s.body.token, 'POST', '/v1/admin/session/heartbeat', { locks: ['news:n1'] });
  const dev = (await w.trust(M, { sid: s.body.sid })).body;
  assert.equal(await w.h.db.prepare('SELECT device_id FROM admin_sessions WHERE email = ?').bind(M).first('device_id'), dev.deviceId);
  // the app opened again (other tab id, the old session still live): no question
  const again = await w.signIn(dev, { start: { device: 'Pixel', tab: 'tab-eeeeeeeeeeeeeeee' } });
  assert.ok(again.body.session.sid && again.body.session.sid !== s.body.sid, JSON.stringify(again.body));
  assert.equal((await w.call('Bearer ' + again.body.token, 'POST', '/v1/admin/devices/forget', {})).body.forgotten, true);
  for (const t of ['admin_devices', 'admin_sessions', 'edit_locks']) assert.equal(await w.h.db.prepare('SELECT COUNT(*) AS n FROM ' + t).first('n'), 0, t);
});
