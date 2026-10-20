// Phase 1.5 step 7: «إعدادات الإشعارات» (Primary), «تنبيهاتي» (every admin),
// «حالة النظام» (delivery monitoring + waiting critical rows). Real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { activityStmt } from '../src/lib/activity.js';
import { route } from '../src/notify/router.js';

const P = 'admin@example.com', M = 'm@example.com';

async function world() {
  const g = await fakeGoogle();
  const h = harness();
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'مينا', 'primary', 1, 0), ('${M}', 'مرقس', 'admin', 1, 0)`).run();
  const as = async email => ({ authorization: 'Bearer ' + await g.sign(g.claims({ email, sub: 'sub-' + email })) });
  const call = async (email, method, path, body) => h.call(path, { method, body, headers: await as(email), fetch: g.fetch });
  return { h, call };
}

test('settings: every type with its defaults; the Primary manages, others only look (switch off)', async () => {
  const { call } = await world();
  const r = await call(P, 'GET', '/v1/admin/notify/settings');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.canManage, true);
  assert.deepEqual([r.body.router, r.body.email, r.body.summaryTime], [false, false, '21:00']);
  const publish = r.body.types.find(t => t.key === 'publish');
  assert.deepEqual([publish.level, publish.push, publish.email, publish.locked], ['important', true, 'immediate', false]);
  assert.deepEqual(r.body.budget, { target: 400, admin: 150, critical: 50, otp: 50 });
  const m = await call(M, 'GET', '/v1/admin/notify/settings');
  assert.equal(m.status, 200);
  assert.equal(m.body.canManage, false);
  const save = await call(M, 'POST', '/v1/admin/notify/settings', { email: true });
  assert.equal(save.status, 403);
  assert.equal(save.body.perm, 'notifications.manage');
});

test('settings: a type\'s channels, list and lock; the switches; budget checks; one critical audit row', async () => {
  const { h, call } = await world();
  await h.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('NOTIFY_SINCE', '1', 0)").run();
  const r = await call(P, 'POST', '/v1/admin/notify/settings', {
    types: { publish: { push: false, email: 'summary', locked: true, mode: 'named', include: [M], exclude: [] } },
    router: true, email: true, summaryTime: '20:30', budget: { target: 300, admin: 120 }
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const publish = r.body.types.find(t => t.key === 'publish');
  assert.deepEqual([publish.push, publish.email, publish.locked, publish.mode, publish.include], [false, 'summary', true, 'named', [M]]);
  assert.deepEqual([r.body.router, r.body.email, r.body.summaryTime, r.body.budget.target], [true, true, '20:30', 300]);
  assert.equal(await h.db.prepare("SELECT COUNT(*) n FROM settings WHERE key = 'NOTIFY_SINCE'").first('n'), 0, 'switched on: the next tick marks the backlog');
  const audit = await h.db.prepare("SELECT severity, changes FROM activity WHERE action = 'notify.settings'").first();
  assert.equal(audit.severity, 'critical');
  assert.match(audit.changes, /publish/);

  for (const bad of [{ types: { 'nope.x': { push: true, email: 'off', locked: false } } }, { types: { publish: { push: 'yes', email: 'off', locked: false } } },
    { types: { publish: { push: true, email: 'off', locked: false, include: ['stranger@example.com'] } } }, { summaryTime: '25:00' },
    { budget: { target: 600 } }, { budget: { critical: 250, otp: 100, target: 300 } }, { router: 'on' }]) {
    assert.equal((await call(P, 'POST', '/v1/admin/notify/settings', bad)).status, 400, JSON.stringify(bad));
  }
  const reset = await call(P, 'POST', '/v1/admin/notify/settings', { types: { publish: { reset: true } } });
  assert.equal(reset.body.types.find(t => t.key === 'publish').custom, false);
});

test('«تنبيهاتي»: only what I may receive; my choices stored; a locked type (and the Primary\'s critical) ignore them', async () => {
  const { h, call } = await world();
  const mine = await call(M, 'GET', '/v1/admin/notify/me');
  assert.equal(mine.status, 200);
  const keys = mine.body.types.map(t => t.key);
  assert.ok(keys.includes('publish'));
  assert.ok(!keys.includes('accounts.add'), 'accounts.manage is the Primary\'s');
  const saved = await call(M, 'POST', '/v1/admin/notify/me', { prefs: { publish: { push: 'off', email: 'summary' } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const pub = saved.body.types.find(t => t.key === 'publish');
  assert.deepEqual([pub.push, pub.emailMode], ['off', 'summary']);
  assert.equal((await call(M, 'POST', '/v1/admin/notify/me', { prefs: { 'accounts.add': { push: 'off' } } })).status, 400, 'not one of mine');
  assert.equal((await call(M, 'POST', '/v1/admin/notify/me', { prefs: { publish: { push: 'loud' } } })).status, 400);

  await call(P, 'POST', '/v1/admin/notify/settings', { types: { publish: { push: true, email: 'immediate', locked: true } } });
  const locked = (await call(M, 'GET', '/v1/admin/notify/me')).body.types.find(t => t.key === 'publish');
  assert.equal(locked.locked, true);
  const p = (await call(P, 'GET', '/v1/admin/notify/me')).body.types.find(t => t.key === 'accounts.add');
  assert.equal(p.locked, true, 'critical for the Primary: mandatory');
  await call(P, 'POST', '/v1/admin/notify/me', { prefs: { 'accounts.add': { push: 'off' } } });
  assert.equal(await h.db.prepare("SELECT COUNT(*) n FROM notify_prefs WHERE email = ? AND type = 'accounts.add'").bind(P).first('n'), 0);
});

test('«حالة النظام»: per-day delivery, last success, quota, Gmail health; critical rows waiting, dismissed only on purpose', async () => {
  const { h, call } = await world();
  await h.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('NOTIFY_ROUTER', '1', 0) ON CONFLICT(key) DO UPDATE SET value = '1'").run();
  await route(h.env, Date.now() - 1);
  await activityStmt(h.db, { actor: 'system', action: 'migrate', entityType: 'data', summary: 'نقل البيانات' }).run();
  await route(h.env);
  await h.db.prepare("UPDATE notify_outbox SET status = 'deferred_quota'").run();
  await h.db.prepare("INSERT INTO notify_outbox (id, dedupe_key, recipient, channel, kind, activity_ids, status, sent_ms, created_ms, level) VALUES ('ntf-aaaaaa01', 'k-sent', ?, 'push', 'publish', '[]', 'sent', ?, ?, 'important')").bind(M, Date.now(), Date.now()).run();
  const r = await call(P, 'GET', '/v1/admin/notify/status');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.critical.length, 2, 'the Primary and the other holder of system.manage');
  assert.equal(r.body.critical[0].status, 'deferred_quota');
  assert.match(r.body.critical[0].title, /نقل البيانات/);
  assert.ok(r.body.lastSuccess.push > 0);
  assert.equal(r.body.days[0].push.sent, 1);
  assert.equal(r.body.quota.target, 400);
  assert.equal(r.body.gmail.configured, false);

  assert.equal((await call(M, 'POST', `/v1/admin/notify/outbox/${r.body.critical[0].id}/dismiss`, {})).status, 403);
  const d = await call(P, 'POST', `/v1/admin/notify/outbox/${r.body.critical[0].id}/dismiss`, {});
  assert.equal(d.status, 200);
  assert.equal(d.body.critical.length, 1);
  assert.equal(await h.db.prepare("SELECT COUNT(*) n FROM activity WHERE action = 'notify.dismiss'").first('n'), 1);
  assert.equal((await call(P, 'POST', '/v1/admin/notify/outbox/ntf-ffffffff/dismiss', {})).status, 404);
});
