// Phase 1.5 step 3: «الصلاحيات» on the Worker — accounts + grants owned by D1,
// Primary Admin protections, Google-only changes, critical audit rows. Real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { harness, fakeGoogle } from './helpers.mjs';
import { PERMS, PRESETS, PRIMARY_DEFAULT } from '../src/lib/perms.js';
import { checkManagers, MAX_ADMINS } from '../src/lib/accounts.js';

const P = 'p@example.com', M = 'm@example.com', B = 'b@example.com';

async function world({ enforce = '0' } = {}) {
  const g = await fakeGoogle();
  const h = harness({ env: { ADMIN_EMAILS: '' } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES
    ('${P}', 'P', 'primary', 1, 0), ('${M}', 'M', 'admin', 1, 0)`).run();
  await h.db.prepare("UPDATE settings SET value = ? WHERE key = 'PERMS_ENFORCE'").bind(enforce).run();
  const as = async email => ({ authorization: 'Bearer ' + await g.sign(g.claims({ email, sub: 'sub-' + email })) });
  const call = async (email, method, path, body, headers) => h.call(path, { method, body, headers: headers || await as(email), fetch: g.fetch });
  const grant = (email, perm, scope = 'all') => h.db.prepare("INSERT OR REPLACE INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, ?, ?, 't', 0)").bind(email, perm, scope).run();
  const grantsOf = async email => Object.fromEntries((await h.db.prepare('SELECT perm, scope FROM admin_grants WHERE email = ?').bind(email).all()).results.map(r => [r.perm, r.scope]));
  return { h, g, call, grant, grantsOf };
}

const wk = (email, via = 'google') => {
  const now = Math.floor(Date.now() / 1000);
  const p = Buffer.from(JSON.stringify({ e: email, x: now + 600, v: via, i: now })).toString('base64url');
  return 'wk1.' + p + '.' + createHmac('sha256', 'sync-test-secret').update('wk1.' + p).digest('hex');
};

test('list: active admins with grants, presets, catalog; canManage only for the Primary (switch off)', async () => {
  const w = await world();
  await w.grant(M, 'bookings.view');
  const r = await w.call(M, 'GET', '/v1/admin/accounts');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.admins.map(a => [a.email, a.primary]), [[P, true], [M, false]]);
  assert.deepEqual(r.body.admins[1].grants, { 'bookings.view': 'all' });
  assert.equal(r.body.canManage, false);
  assert.deepEqual(r.body.perms, [...PERMS]);
  assert.ok(r.body.presets.servant_bookings && r.body.presets.treasurer);
  assert.equal((await w.call(P, 'GET', '/v1/admin/accounts')).body.canManage, true);
});

test('presets use catalog keys only and never the Primary defaults', () => {
  for (const [k, p] of Object.entries(PRESETS)) {
    assert.ok(p.label, k);
    for (const [perm, scope] of Object.entries(p.grants)) {
      assert.ok(PERMS.includes(perm), k + ' ' + perm);
      assert.ok(scope === 'all' || scope === 'own');
      assert.ok(!PRIMARY_DEFAULT.includes(perm), k + ' ' + perm);
    }
  }
});

test('add → grants stored, critical audit row (names only), the new admin can sign in; remove → refused at once; re-add works', async () => {
  const w = await world();
  const add = await w.call(P, 'POST', '/v1/admin/accounts', { email: 'B@Example.com', name: 'بيشوي', servantId: 'srv-aaaa1111', grants: PRESETS.servant_bookings.grants });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.deepEqual(await w.grantsOf(B), PRESETS.servant_bookings.grants);
  const row = await w.h.db.prepare('SELECT active, role, servant_id, name FROM admins WHERE email = ?').bind(B).first();
  assert.deepEqual({ ...row }, { active: 1, role: 'admin', servant_id: 'srv-aaaa1111', name: 'بيشوي' });
  const act = await w.h.db.prepare("SELECT actor, action, severity, entity_id, changes FROM activity WHERE action = 'accounts.add'").first();
  assert.equal(act.severity, 'critical');
  assert.equal(act.actor, P);
  assert.equal(act.entity_id, B);
  assert.match(act.changes, /bookings:create_cash\(own\)\+view/);
  assert.equal((await w.call(B, 'GET', '/v1/admin/whoami')).status, 200);

  assert.equal((await w.call(P, 'POST', '/v1/admin/accounts', { email: B, grants: {} })).body.code, 'conflict', 'already active');
  const rm = await w.call(P, 'POST', `/v1/admin/accounts/${B}/remove`, {});
  assert.equal(rm.status, 200, JSON.stringify(rm.body));
  assert.deepEqual(await w.grantsOf(B), {});
  assert.equal((await w.call(B, 'GET', '/v1/admin/whoami')).status, 403, 'removed: refused at the next call');
  assert.equal((await w.h.db.prepare("SELECT severity FROM activity WHERE action = 'accounts.remove'").first()).severity, 'critical');
  assert.equal((await w.call(P, 'POST', '/v1/admin/accounts', { email: B, grants: { 'content.view': 'all' } })).status, 200, 're-added');
  assert.equal((await w.call(B, 'GET', '/v1/admin/whoami')).status, 200, 'same Google account, binding kept');
});

test('changes need a Google ID token: the panel session token (Google or device) is refused with `google`', async () => {
  const w = await world();
  for (const via of ['google', 'device']) {
    const r = await w.call(P, 'POST', '/v1/admin/accounts', { email: B, grants: {} }, { authorization: 'Bearer ' + wk(P, via) });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'google');
  }
  assert.equal((await w.call(P, 'GET', '/v1/admin/accounts', undefined, { authorization: 'Bearer ' + wk(P) })).status, 200, 'reading is fine');
});

test('the Primary row is immutable; only holders of accounts.manage change accounts', async () => {
  const w = await world();
  assert.equal((await w.call(M, 'POST', '/v1/admin/accounts', { email: B, grants: {} })).body.perm, 'accounts.manage', 'switch off: still Primary-only');
  await w.grant(M, 'accounts.manage');
  for (const [path, body] of [[`/v1/admin/accounts/${P}`, { grants: {} }], [`/v1/admin/accounts/${P}/remove`, {}]]) {
    const r = await w.call(M, 'POST', path, body);
    assert.equal(r.body.code, 'protected', path);
    assert.equal(r.body.reason, 'primary');
  }
  const pg = await w.h.db.prepare('SELECT active, role FROM admins WHERE email = ?').bind(P).first();
  assert.deepEqual({ ...pg }, { active: 1, role: 'primary' });
});

test('nobody grants what they do not hold (or a wider scope); self-protection', async () => {
  const w = await world({ enforce: '1' });
  for (const p of ['accounts.manage', 'accounts.view', 'bookings.view']) await w.grant(M, p);
  await w.grant(M, 'bookings.create_cash', 'own');
  const add = grants => w.call(M, 'POST', '/v1/admin/accounts', { email: B, grants });
  assert.equal((await add({ 'finance.manage': 'all' })).body.perm, 'finance.manage');
  assert.equal((await add({ 'bookings.create_cash': 'all' })).body.perm, 'bookings.create_cash', 'own held → only own given');
  assert.equal((await add({ 'bookings.view': 'all', 'bookings.create_cash': 'own' })).status, 200);
  // a permission the manager lacks, already on the target, may be kept (not newly granted)
  await w.grant(B, 'finance.view');
  assert.equal((await w.call(M, 'POST', `/v1/admin/accounts/${B}`, { grants: { 'bookings.view': 'all', 'finance.view': 'all' } })).status, 200);
  assert.equal((await w.call(M, 'POST', `/v1/admin/accounts/${B}`, { grants: { 'finance.view': 'all', 'points.edit': 'all' } })).body.perm, 'points.edit');

  assert.equal((await w.call(M, 'POST', `/v1/admin/accounts/${M}`, { grants: { 'accounts.view': 'all' } })).body.reason, 'self', 'can not drop own accounts.manage');
  assert.equal((await w.call(M, 'POST', `/v1/admin/accounts/${M}/remove`, {})).body.reason, 'self');
  // the Primary grants anything, the Primary defaults included
  assert.equal((await w.call(P, 'POST', `/v1/admin/accounts/${B}`, { grants: { 'participants.manage': 'all', 'finance.manage': 'all' } })).status, 200);
});

test('last account manager: a change that leaves nobody able to manage accounts is refused', () => {
  const all = [
    { email: M, active: true, primary: false, grants: { 'accounts.manage': 'all' } },
    { email: B, active: true, primary: false, grants: {} }
  ];
  assert.throws(() => checkManagers(all, M, {}), e => e.extra.reason === 'last');
  assert.throws(() => checkManagers(all, M, null), e => e.extra.reason === 'last');
  assert.doesNotThrow(() => checkManagers(all, B, null));
  assert.doesNotThrow(() => checkManagers([...all, { email: P, active: true, primary: true, grants: {} }], M, null), 'the Primary always manages');
});

test('validation and the 20-admin limit', async () => {
  const w = await world();
  assert.equal((await w.call(P, 'POST', '/v1/admin/accounts', { email: 'nope', grants: {} })).body.field, 'email');
  assert.equal((await w.call(P, 'POST', '/v1/admin/accounts', { email: B, grants: { 'bookings.fly': 'all' } })).body.field, 'grants');
  assert.equal((await w.call(P, 'POST', '/v1/admin/accounts', { email: B, grants: { 'bookings.view': 'some' } })).body.field, 'grants');
  assert.equal((await w.call(P, 'POST', '/v1/admin/accounts', { email: B, servantId: 'x', grants: {} })).body.field, 'servantId');
  assert.equal((await w.call(P, 'POST', `/v1/admin/accounts/${B}`, { grants: {} })).status, 404);
  for (let i = 0; i < MAX_ADMINS - 2; i++) await w.h.db.prepare("INSERT INTO admins (email, role, active, created_at) VALUES (?, 'admin', 1, 0)").bind(`x${i}@example.com`).run();
  assert.equal((await w.call(P, 'POST', '/v1/admin/accounts', { email: B, grants: {} })).body.reason, 'max');
});
