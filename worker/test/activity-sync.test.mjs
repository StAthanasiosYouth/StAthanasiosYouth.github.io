// Phase 1.5 step 4: Apps Script Activity rows forwarded into D1 (POST /v1/sync/activity)
// and the unified «سجل النشاط» (GET /v1/admin/activity). Real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { activityStmt, FAMILIES, SECTIONS } from '../src/lib/activity.js';

async function push(h, rows, { ts = Date.now(), secret = 'sync-test-secret' } = {}) {
  const raw = JSON.stringify({ rows });
  return h.call('/v1/sync/activity', { method: 'POST', body: raw, headers: { 'x-sync-ts': String(ts), 'x-sync-signature': await signSync(secret, String(ts), raw) } });
}
const row = (over = {}) => ({
  id: 'act-0123456789ab', at: Date.parse('2026-10-18T10:00:00Z'), cairo: '2026-10-18 13:00', actor: 'menazakmena@gmail.com', actorName: 'مينا',
  action: 'update', type: 'news', entityId: 'n1', title: 'خبر', summary: 'عدّل «خبر»', changes: { fields: ['العنوان'] }, ref: '', count: 1, device: 'كمبيوتر', severity: 'routine', ...over
});
const all = h => h.db.prepare('SELECT * FROM activity WHERE source = ? ORDER BY at').bind('apps-script').all().then(r => r.results);

test('sync/activity: signed, stored once as apps-script + notified; a resend or a merged row updates the same row', async () => {
  const h = harness();
  assert.equal((await push(h, [row()], { secret: 'wrong' })).status, 401);
  const t = Date.now();
  assert.equal((await push(h, [row(), row({ id: 'act-bbbbbbbbbbbb', at: row().at + 1000, action: 'publish', type: 'site', severity: 'important' })], { ts: t })).status, 200);
  let rows = await all(h);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].source, rows[0].notified, rows[0].severity, rows[1].severity], ['apps-script', 1, 'routine', 'important']);
  assert.deepEqual(JSON.parse(rows[0].changes), { fields: ['العنوان'] });
  assert.equal(rows[0].cairo, '2026-10-18 13:00', 'the Cairo text made from at');


  assert.equal((await push(h, [row()], { ts: t })).status, 409, 'replay refused');
  // the same row sent again, then merged (Activity.gs: same id, later `at`, count 3)
  await push(h, [row()], { ts: t + 1 });
  await push(h, [row({ at: row().at + 5 * 60000, cairo: '2026-10-18 13:05', count: 3, summary: 'عدّل «خبر» ٣ مرات' })], { ts: t + 2 });
  rows = await all(h);
  assert.equal(rows.length, 2, 'never a second row');
  const merged = rows.find(r => r.id === 'act-0123456789ab');
  assert.deepEqual([merged.count, merged.cairo, merged.summary], [3, '2026-10-18 13:05', 'عدّل «خبر» ٣ مرات']);

  // a Sheet cell read back as a Date: the text sent is ignored
  await push(h, [row({ id: 'act-ffffffffffff', cairo: 'Mon Oct 12 2026 20:00:00 GMT+0300 (Eastern European Summer Time)' })], { ts: t + 3 });
  assert.equal((await h.db.prepare("SELECT cairo FROM activity WHERE id = 'act-ffffffffffff'").first()).cairo, '2026-10-18 13:00');
  await h.db.prepare("DELETE FROM activity WHERE id = 'act-ffffffffffff'").run();
});

test('sync/activity: a Worker row with the same id is never overwritten; bad rows refuse the whole call', async () => {
  const h = harness();
  await activityStmt(h.db, { id: 'act-cccccccccccc', actor: 'x@example.com', action: 'booking.confirm', entityType: 'booking', summary: 'أكّد' }).run();
  await push(h, [row({ id: 'act-cccccccccccc', summary: 'forged' })]);
  const w = await h.db.prepare("SELECT summary, source FROM activity WHERE id = 'act-cccccccccccc'").first();
  assert.deepEqual({ ...w }, { summary: 'أكّد', source: 'worker' });

  let t = Date.now() + 10;
  for (const bad of [{ id: 'nope' }, { at: 'x' }, { action: 'DROP TABLE' }, { actor: '' }]) {
    assert.equal((await push(h, [row(), row({ id: 'act-dddddddddddd', ...bad })], { ts: t++ })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await all(h)).length, 0, 'nothing stored from a refused call');
  assert.equal((await push(h, Array.from({ length: 251 }, (_, i) => row({ id: 'act-' + String(i).padStart(12, '0') })), { ts: t++ })).status, 400, 'at most 250 rows');
});

test('unified log: Worker + Apps Script rows together, newest first, names from D1, technical rows hidden in view=log', async () => {
  const g = await fakeGoogle();
  const h = harness();
  await h.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES ('admin@example.com', 'الأدمن', 'primary', 1, 0), ('menazakmena@gmail.com', 'مينا زكريا', 'admin', 1, 0)").run();
  const base = Date.parse('2026-10-18T10:00:00Z');
  await push(h, [row({ at: base }), row({ id: 'act-eeeeeeeeeeee', at: base + 2000, action: 'create', type: 'news', summary: 'أضاف «خبر ٢»' })]);
  await activityStmt(h.db, { at: base + 1000, actor: 'admin@example.com', actorName: 'old', action: 'booking.confirm', entityType: 'booking', entityId: 'bkg-1', summary: 'أكّد الحجز B-AAAA1' }).run();
  await activityStmt(h.db, { at: base + 3000, actor: 'system', action: 'diag.queue', summary: 'tech' }).run();
  const get = async q => (await h.call('/v1/admin/activity' + q, { headers: { authorization: 'Bearer ' + await g.sign(g.claims()) }, fetch: g.fetch })).body;

  const log = await get('?view=log');
  assert.deepEqual(log.items.map(i => i.action), ['create', 'booking.confirm', 'update'], 'the technical row is hidden; the rest by time');
  const confirm = log.items[1];
  assert.equal(confirm.actorName, 'الأدمن', 'the current name from D1');
  assert.equal(confirm.text, 'الأدمن أكّد الحجز B-AAAA1');
  assert.equal(confirm.source, 'worker');
  assert.equal(log.items[2].actorName, 'مينا زكريا');
  assert.deepEqual(log.items[2].changes, { fields: ['العنوان'] });
  assert.deepEqual(log.families, Object.keys(FAMILIES));
  assert.deepEqual(log.sections, Object.keys(SECTIONS));
  assert.deepEqual(log.admins.map(a => a.name).sort(), ['الأدمن', 'مينا زكريا'].sort());
  assert.ok((await get('')).items.some(i => i.action === 'diag.queue'), 'without view=log: every row (diagnostics)');

  assert.deepEqual((await get('?view=log&section=bookings')).items.map(i => i.action), ['booking.confirm']);
  assert.deepEqual((await get('?view=log&family=add')).items.map(i => i.action), ['create']);
  assert.deepEqual((await get('?view=log&actor=menazakmena@gmail.com')).items.length, 2);
  assert.deepEqual((await get('?view=log&id=act-eeeeeeeeeeee')).items.map(i => i.id), ['act-eeeeeeeeeeee']);
  assert.equal((await get('?view=log&from=2026-10-19')).items.length, 0);
  assert.equal((await get('?view=log&from=2026-10-18&to=2026-10-18')).items.length, 3);
  const page = await get('?view=log&limit=2');
  assert.equal(page.more, true);
  assert.deepEqual((await get('?view=log&limit=2&before=' + page.next)).items.map(i => i.action), ['update']);
});
