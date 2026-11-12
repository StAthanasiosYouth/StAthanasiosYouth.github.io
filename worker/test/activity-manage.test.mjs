// Phase 8 A6 (BACKEND-MIGRATION §22.1 item 22): «إدارة السجل» — size, preview, archive to private R2, safe delete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';

const DAY = 24 * 3600 * 1000;
const ME = 'admin@example.com';

async function world() {
  const g = await fakeGoogle();
  const h = harness();
  const headers = async () => ({ authorization: 'Bearer ' + await g.sign(g.claims()) });
  const call = async (method, path, body) => h.call(path, { method, body, headers: await headers(), fetch: g.fetch });
  const now = Date.now();
  const row = (id, days, action, type = 'news') => h.db.prepare("INSERT INTO activity (id, at, cairo, actor, action, entity_type, summary) VALUES (?, ?, '2026-01-01 00:00', 'x@example.com', ?, ?, 's')").bind(id, now - days * DAY, action, type).run();
  await row('act-new000001', 10, 'update');              // too young
  await row('act-old000001', 200, 'update');             // old: goes
  await row('act-old000002', 200, 'diag.echo', 'diag');  // old, technical: goes
  await row('act-sec000001', 200, 'accounts.grants', 'admins');  // security, this year: kept
  await row('act-sec000002', 400, 'accounts.grants', 'admins');  // security, older than a year: goes
  return { h, call };
}

const grant = (h, perm) => h.db.prepare("INSERT INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, ?, 'all', 't', 0)").bind(ME, perm).run();

test('needs activity.manage (never by default for a non-Primary admin)', async () => {
  const { h, call } = await world();
  assert.equal((await call('GET', '/v1/admin/activity/manage')).status, 403);
  await grant(h, 'activity.manage');
  const s = await call('GET', '/v1/admin/activity/manage');
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.rows, 5);
  assert.equal(s.body.technical, 1);
  assert.equal(s.body.minDays, 0);
});

test('preview and delete: any age, never the security rows of the last year, the word required, logged as one row', async () => {
  const { h, call } = await world();
  await grant(h, 'activity.manage');
  assert.equal((await call('POST', '/v1/admin/activity/manage/preview', { days: -1 })).body.code, 'invalid', 'no negative age');
  // owner 2026-11-12: any age — «days: 0» is every row up to now (the security rows of the last year stay)
  assert.equal((await call('POST', '/v1/admin/activity/manage/preview', { days: 0 })).status, 200);
  const p = await call('POST', '/v1/admin/activity/manage/preview', { days: 90 });
  const pick = b => ({ count: b.count, kept: b.kept });
  assert.deepEqual(pick(p.body), { count: 3, kept: 1 });
  assert.deepEqual(pick((await call('POST', '/v1/admin/activity/manage/preview', { days: 90, technical: true })).body), { count: 1, kept: 0 });
  assert.equal((await call('POST', '/v1/admin/activity/manage/delete', { days: 90 })).body.code, 'invalid', 'the word first');
  const d = await call('POST', '/v1/admin/activity/manage/delete', { days: 90, confirm: 'امسح' });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.deepEqual({ deleted: d.body.deleted, kept: d.body.kept }, { deleted: 3, kept: 1 });
  const left = (await h.db.prepare("SELECT id FROM activity WHERE action <> 'activity.trim' ORDER BY id").all()).results.map(r => r.id);
  assert.deepEqual(left, ['act-new000001', 'act-sec000001']);
  const trim = await h.db.prepare("SELECT actor, severity, summary FROM activity WHERE action = 'activity.trim'").first();
  assert.equal(trim.actor, ME);
  assert.equal(trim.severity, 'important');
  assert.match(trim.summary, /^مسح 3 صف/);
});

test('archive: the rows as a private CSV, listed and downloadable; the rows stay', async () => {
  const { h, call } = await world();
  await grant(h, 'activity.manage');
  const a = await call('POST', '/v1/admin/activity/manage/archive', { days: 90 });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.archive.rows, 4, 'an archive keeps everything in the range (it deletes nothing)');
  const listed = (await call('GET', '/v1/admin/activity/manage')).body.archives;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, a.body.archive.id);
  const file = await call('GET', '/v1/admin/activity/manage/archive/' + a.body.archive.id);
  assert.equal(file.status, 200);
  assert.deepEqual([...file.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'a BOM: Excel reads the Arabic right');
  const text = new TextDecoder().decode(file.bytes);
  assert.match(text, /^cairo,actor,actor_name,action,entity_type/);
  assert.equal(text.trim().split('\r\n').length, 5);
  assert.equal((await call('GET', '/v1/admin/activity/manage/archive/../../proofs')).status, 404);
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action <> 'activity.archive'").first()).n, 5);
});
