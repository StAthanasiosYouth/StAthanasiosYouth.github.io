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

test('Phase 8B W6: the list says who is online and who was removed; «اخرّجه من كل الأجهزة» ends their sessions and devices (accounts.manage, Google, audited)', async () => {
  const w = await world();
  const now = Date.now();
  await w.h.db.prepare("INSERT INTO admin_sessions (email, sid, since_ms, seen_ms) VALUES (?, 'sid-m-1234567890abcdef', ?, ?)").bind(M, now - 60000, now - 5000).run();
  await w.h.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES (?, 'Gone', 'admin', 0, 0)").bind(B).run();
  const list = await w.call(P, 'GET', '/v1/admin/accounts');
  assert.deepEqual(list.body.online, [M]);
  assert.deepEqual(list.body.removed.map(r => [r.email, r.name]), [[B, 'Gone']]);
  // not for an admin without accounts.manage
  assert.equal((await w.call(M, 'POST', '/v1/admin/accounts/' + encodeURIComponent(P) + '/signout', {})).status, 403);
  const out = await w.call(P, 'POST', '/v1/admin/accounts/' + encodeURIComponent(M) + '/signout', {});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(out.body.online, []);
  assert.equal(await w.h.db.prepare('SELECT 1 FROM admin_sessions WHERE email = ?').bind(M).first(), null);
  assert.equal((await w.h.db.prepare('SELECT active FROM admins WHERE email = ?').bind(M).first('active')), 1, 'the account stays');
  const row = await w.h.db.prepare("SELECT severity, actor FROM activity WHERE action = 'accounts.signout' AND entity_id = ?").bind(M).first();
  assert.deepEqual({ ...row }, { severity: 'critical', actor: P });
  assert.equal((await w.call(P, 'POST', '/v1/admin/accounts/nobody%40example.com/signout', {})).body.code, 'not_found');
});

test('Phase 8B W6: «ابعتله إيميل بالدعوة» — only when asked, and never without Gmail', async () => {
  const w = await world();
  const plain = await w.call(P, 'POST', '/v1/admin/accounts', { email: B, grants: {} });
  assert.equal(plain.status, 200, JSON.stringify(plain.body));
  assert.equal(plain.body.invite, undefined);
  await w.call(P, 'POST', '/v1/admin/accounts/' + encodeURIComponent(B) + '/remove', {});
  const asked = await w.call(P, 'POST', '/v1/admin/accounts', { email: B, grants: {}, invite: true, role: 'viewer' });
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  assert.equal(asked.body.invite, 'off', 'no Gmail in the tests: nothing is sent');
});

test('Phase 8B W6: «اطلب الصلاحية» — any admin, a critical row for the account managers, nothing granted', async () => {
  const w = await world({ enforce: '1' });
  const r = await w.call(M, 'POST', '/v1/admin/me/ask-access', { area: 'bookings', sub: 'finance', label: 'الفلوس' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = await w.h.db.prepare("SELECT actor, severity, summary FROM activity WHERE action = 'accounts.ask'").first();
  assert.deepEqual({ ...row }, { actor: M, severity: 'critical', summary: 'طلب صلاحية «الفلوس»' });
  assert.deepEqual(await w.grantsOf(M), {});
  assert.equal((await w.call(M, 'POST', '/v1/admin/me/ask-access', { area: '' })).body.code, 'invalid');
});

test('Phase 8B W6 (team-enforce.png): «شغّل الصلاحيات» — the Primary Admin alone, Google itself, audited; off again the same way', async () => {
  const w = await world();
  await w.grant(M, 'accounts.manage');
  assert.equal((await w.call(M, 'POST', '/v1/admin/accounts/enforce', { on: true })).status, 403, 'not for an account manager');
  const on = await w.call(P, 'POST', '/v1/admin/accounts/enforce', { on: true });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.enforce, true);
  assert.equal(await w.h.db.prepare("SELECT value FROM settings WHERE key = 'PERMS_ENFORCE'").first('value'), '1');
  const off = await w.call(P, 'POST', '/v1/admin/accounts/enforce', { on: false });
  assert.equal(off.body.enforce, false);
  assert.equal((await w.h.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'accounts.enforce' AND severity = 'critical'").first('n')), 2);
  // never with the panel's own session token
  const token = await w.call(P, 'POST', '/v1/admin/accounts/enforce', { on: true }, { authorization: 'Bearer ' + wk(P) });
  assert.equal(token.body.code, 'google');
});

test('Phase 8B W6 (B12 me-avatar.png): each admin sets and removes their own photo; real image bytes ≤ 200 KB only; removed admins drop out', async () => {
  const w = await world();
  const webp = n => { const b = Buffer.alloc(n); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); return 'data:image/webp;base64,' + b.toString('base64'); };
  const save = await w.call(M, 'POST', '/v1/admin/me/avatar', { image: webp(3000) });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  assert.deepEqual(Object.keys(save.body.avatars), [M]);
  assert.match(save.body.avatars[M].src, /^data:image\/webp;base64,/);
  // anyone signed in sees it
  assert.deepEqual(Object.keys((await w.call(P, 'GET', '/v1/admin/avatars')).body.avatars), [M]);
  // not an image, too big, a type we don't take
  assert.equal((await w.call(M, 'POST', '/v1/admin/me/avatar', { image: 'data:image/webp;base64,' + Buffer.alloc(3000).toString('base64') })).body.code, 'invalid');
  assert.equal((await w.call(M, 'POST', '/v1/admin/me/avatar', { image: webp(205 * 1024) })).body.code, 'invalid');
  assert.equal((await w.call(M, 'POST', '/v1/admin/me/avatar', { image: 'data:image/svg+xml;base64,PHN2Zz4=' })).body.code, 'invalid');
  // only their own: the route has no email in it; remove
  const del = await w.call(M, 'POST', '/v1/admin/me/avatar/delete', {});
  assert.deepEqual(del.body.avatars, {});
  await w.call(M, 'POST', '/v1/admin/me/avatar', { image: webp(3000) });
  await w.call(P, 'POST', '/v1/admin/accounts/' + encodeURIComponent(M) + '/remove', {});
  assert.deepEqual((await w.call(P, 'GET', '/v1/admin/avatars')).body.avatars, {}, 'a removed admin is not shown');
});
