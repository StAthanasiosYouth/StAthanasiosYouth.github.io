// The admin panel's session token for the Worker (lib/auth.js verifyWorkerToken):
// issued by Apps Script, HMAC with SYNC_SECRET, short-lived, admin must be active.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { bookWorld } from './book-helpers.mjs';

function wk(secret, claims) {
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return 'wk1.' + p + '.' + createHmac('sha256', secret).update('wk1.' + p).digest('hex');
}

test('wk1: a panel session token opens the bookings (device or Google), with the D1 admin\'s role', async () => {
  const w = await bookWorld();
  const s = Math.floor(Date.now() / 1000);
  await w.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES ('boss@x.org', 'Boss', 'primary', 1, 0)").run();
  const call = (t, path = '/v1/admin/book/events') => w.call(path, { method: 'GET', headers: { authorization: 'Bearer ' + t } });
  const good = wk(w.env.SYNC_SECRET, { e: 'boss@x.org', x: s + 600, v: 'device', i: s });
  const r = await call(good);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const who = await call(good, '/v1/admin/whoami');
  assert.deepEqual([who.body.email, who.body.role], ['boss@x.org', 'primary']);

  // refused: wrong secret, expired, too long-lived, not an admin, inactive, tampered
  assert.equal((await call(wk('nope'.repeat(10), { e: 'boss@x.org', x: s + 600, v: 'device', i: s }))).status, 401);
  assert.equal((await call(wk(w.env.SYNC_SECRET, { e: 'boss@x.org', x: s - 120, v: 'device', i: s - 700 }))).status, 401);
  assert.equal((await call(wk(w.env.SYNC_SECRET, { e: 'boss@x.org', x: s + 7200, v: 'device', i: s }))).status, 401);
  assert.equal((await call(wk(w.env.SYNC_SECRET, { e: 'stranger@x.org', x: s + 600, v: 'device', i: s }))).status, 403);
  await w.db.prepare("UPDATE admins SET active = 0 WHERE email = 'boss@x.org'").run();
  assert.equal((await call(good)).status, 403, 'removed from the allowlist: refused at once');
  assert.equal((await call(good.slice(0, -2) + '00')).status, 401);
});
