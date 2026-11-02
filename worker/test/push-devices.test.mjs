// Phase 6 Step 4a (docs/PHASE6-PLAN.md, BACKEND-MIGRATION §22.2.4): the devices that get push, on real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { pushHash, importDevices, pushImportTick, PER_ADMIN, TOPICS } from '../src/push/devices.js';
import { ROUTE_PERMS, ANY_ADMIN } from '../src/lib/perms.js';

const P = 'p@example.com';
const S = 's@example.com';
const tok = n => ('tok_' + n + '_').padEnd(150, 'x');

async function world(env = {}) {
  const g = await fakeGoogle();
  const h = harness({ env: { ADMIN_EMAILS: '', ...env } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'P', 'primary', 1, 0), ('${S}', 'S', 'admin', 1, 0)`).run();
  const admin = async (email, path, body) => h.call('/v1/admin/push/' + path, { method: 'POST', body, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email, sub: 's-' + email })) }, fetch: g.fetch });
  const pub = (path, body) => h.call('/v1/push/' + path, { method: 'POST', body });
  const row = async token => h.db.prepare('SELECT * FROM push_devices WHERE id = ?').bind(await pushHash(token)).first();
  const count = async () => (await h.db.prepare('SELECT COUNT(*) AS n FROM push_devices').first()).n;
  return { h, admin, pub, row, count };
}

test('the hash is Apps Script\'s, so a copied row is the same row', async () => {
  assert.equal(await pushHash('abc'), 'hba7816bf8f01cfea414140de5dae2223b00361a3');
});

test('a visitor: one token in, nothing read back; topics on the server; refused shapes', async () => {
  const w = await world();
  const r = await w.pub('subscribe', { token: tok(1), platform: 'android' });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).filter(k => k !== 'requestId').sort(), ['ok']);
  const saved = await w.row(tok(1));
  assert.deepEqual([saved.audience, saved.platform, saved.os, saved.email], ['public', 'web', 'android', null]);
  assert.deepEqual(JSON.parse(saved.topics), TOPICS, 'every topic, until someone chooses');
  assert.equal((await w.pub('subscribe', { token: 'short' })).body.code, 'invalid');
  assert.equal((await w.pub('subscribe', { token: tok(2), previous: 'short' })).body.code, 'invalid');
  await w.pub('subscribe', { token: tok(2), topics: ['events', 'nonsense'] });
  assert.deepEqual(JSON.parse((await w.row(tok(2))).topics), ['events']);
  await w.pub('subscribe', { token: tok(3), os: 'ios', platform: 'ios', app: true, appVersion: '1.2.0' });
  const native = await w.row(tok(3));
  assert.deepEqual([native.platform, native.os, native.app_version], ['ios', 'ios', '1.2.0'], 'a native token, the same call');
});

test('a visitor: a new token replaces the old; again soon writes nothing; off removes it', async () => {
  const w = await world();
  await w.pub('subscribe', { token: tok(1) });
  const first = await w.row(tok(1));
  await w.h.db.prepare('UPDATE push_devices SET fails = 3').run();
  await w.pub('subscribe', { token: tok(1) });
  assert.equal((await w.row(tok(1))).fails, 3, 'seen lately: no write');
  await w.h.db.prepare('UPDATE push_devices SET last_ms = 1').run();
  await w.pub('subscribe', { token: tok(1) });
  const again = await w.row(tok(1));
  assert.equal(again.fails, 0);
  assert.ok(again.last_ms > 1);
  assert.equal(again.created_ms, first.created_ms);
  await w.pub('subscribe', { token: tok(2), previous: tok(1) });
  assert.equal(await w.row(tok(1)), null);
  assert.ok(await w.row(tok(2)));
  assert.equal((await w.pub('unsubscribe', { token: tok(2) })).body.ok, true);
  assert.equal(await w.count(), 0);
});

test('an admin: their own devices, a label, a full set makes room, the current one is marked', async () => {
  const w = await world();
  const on = await w.admin(P, 'subscribe', { token: tok(1), platform: 'desktop', device: 'لابتوب' });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.on, true);
  assert.equal(on.body.configured, false, 'no key yet');
  assert.deepEqual([on.body.devices[0].device, on.body.devices[0].platform, on.body.devices[0].current], ['لابتوب', 'desktop', true]);
  assert.ok(!JSON.stringify(on.body).includes(tok(1)), 'the token never comes back');
  assert.equal((await w.row(tok(1))).email, P);
  for (let i = 2; i <= PER_ADMIN + 1; i++) {
    await w.admin(P, 'subscribe', { token: tok(i), platform: 'android' });
    await w.h.db.prepare('UPDATE push_devices SET last_ms = ? WHERE id = ?').bind(i, await pushHash(tok(i))).run();
  }
  assert.equal((await w.h.db.prepare("SELECT COUNT(*) AS n FROM push_devices WHERE email = ?").bind(P).first()).n, PER_ADMIN);
  assert.equal((await w.admin(P, 'devices', { token: tok(3) })).body.on, true);
  assert.equal((await w.admin(P, 'devices', { token: tok(99) })).body.on, false);
  assert.equal((await w.admin(P, 'devices', {})).body.max, PER_ADMIN);
});

test('admins and visitors never mix, and an admin only touches their own', async () => {
  const w = await world();
  await w.pub('subscribe', { token: tok(1) });
  assert.equal((await w.admin(P, 'subscribe', { token: tok(1) })).status, 400, 'a visitor\'s token');
  assert.equal((await w.row(tok(1))).audience, 'public');
  await w.admin(P, 'subscribe', { token: tok(2) });
  assert.equal((await w.pub('subscribe', { token: tok(2) })).body.code, 'invalid', 'an admin\'s token');
  assert.equal((await w.row(tok(2))).audience, 'admin');
  await w.pub('unsubscribe', { token: tok(2) });
  assert.ok(await w.row(tok(2)), 'a visitor call can\'t remove an admin\'s');

  await w.admin(S, 'unsubscribe', { token: tok(2) });
  assert.ok(await w.row(tok(2)), 'nor another admin');
  const id = (await w.admin(P, 'devices', {})).body.devices[0].id;
  await w.admin(S, 'remove', { id });
  assert.ok(await w.row(tok(2)));
  assert.equal((await w.admin(P, 'remove', { id: 'nonsense' })).status, 400);
  assert.equal((await w.admin(P, 'remove', { id })).body.devices.length, 0);
  assert.equal(await w.row(tok(2)), null);

  // the same device in other hands is the signed-in admin's now
  await w.admin(P, 'subscribe', { token: tok(3) });
  await w.admin(S, 'subscribe', { token: tok(3) });
  assert.equal((await w.row(tok(3))).email, S);
});

test('the routes: no credential is refused, every admin may manage their own', async () => {
  const w = await world();
  assert.equal((await w.h.call('/v1/admin/push/devices', { method: 'POST', body: {} })).status, 401);
  for (const p of ['subscribe', 'unsubscribe', 'devices', 'remove']) assert.equal(ROUTE_PERMS['POST /v1/admin/push/' + p], ANY_ADMIN);
});

test('the copy: dry changes nothing; apply keeps what is here; it can run again; a report has no token', async () => {
  const w = await world();
  const sent = {
    public: [{ token: tok(1), platform: 'ios', createdAt: 5, lastSeen: 6, fails: 2 }, { token: 'bad', platform: 'ios' }, { token: tok(2), platform: 'weird', createdAt: 0, lastSeen: 0, fails: 0 }],
    admin: [{ token: tok(3), email: 'P@Example.com', device: 'موبايل', platform: 'android', createdAt: 7, lastSeen: 8, fails: 0 }, { token: tok(4), email: '', device: '', platform: 'other' }]
  };
  const dry = await importDevices(w.h.env, sent, { apply: false, now: 1000 });
  assert.deepEqual([dry.state, dry.public, dry.admin, dry.skipped], ['ok', 2, 1, 2]);
  assert.equal(await w.count(), 0);
  await w.pub('subscribe', { token: tok(2), platform: 'android' });
  const applied = await importDevices(w.h.env, sent, { apply: true, now: 1000 });
  assert.deepEqual([applied.state, applied.added], ['applied', 2]);
  assert.ok(!JSON.stringify(applied).includes('tok_'), 'never a token in a report');
  const one = await w.row(tok(1));
  assert.deepEqual([one.audience, one.os, one.created_ms, one.last_ms, one.fails], ['public', 'ios', 5, 6, 2]);
  assert.equal((await w.row(tok(2))).os, 'android', 'a row already here stays');
  assert.deepEqual([(await w.row(tok(3))).email, (await w.row(tok(3))).device], ['p@example.com', 'موبايل']);
  assert.equal((await importDevices(w.h.env, sent, { apply: true, now: 2000 })).added, 0, 'again: nothing new');
});

test('the setting asks once; a failure is reported', async () => {
  const w = await world({ APPS_SCRIPT_URL: 'https://script.test/exec', SYNC_SECRET: 'sync-secret-sync-secret-sync-secret' });
  const db = w.h.db;
  const set = v => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('PUSH_IMPORT', ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(v).run();
  const report = async () => JSON.parse((await db.prepare("SELECT value FROM settings WHERE key = 'PUSH_IMPORT_REPORT'").first()).value);
  let asked = 0;
  const reply = { ok: true, result: { public: [{ token: tok(1), platform: 'android', createdAt: 1, lastSeen: 2, fails: 0 }], admin: [] } };
  const fetchOk = async () => { asked++; return new Response(JSON.stringify(reply)); };
  assert.equal(await pushImportTick(w.h.env, fetchOk), null, 'nobody asked');
  assert.equal(asked, 0);
  await set('dry');
  await pushImportTick(w.h.env, fetchOk);
  assert.equal((await report()).mode, 'dry');
  assert.equal(await w.count(), 0);
  assert.equal(await pushImportTick(w.h.env, fetchOk), null, 'once per request');
  await set('apply');
  await pushImportTick(w.h.env, fetchOk);
  assert.equal((await report()).added, 1);
  await set('apply');
  await pushImportTick(w.h.env, async () => { throw new Error('down'); });
  assert.equal((await report()).state, 'failed');
});
