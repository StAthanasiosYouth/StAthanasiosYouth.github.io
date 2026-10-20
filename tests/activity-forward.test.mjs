// Phase 1.5 step 4 (apps-script/WorkerSync.gs activityForward_): the Activity
// tab's rows reach D1 — signed like the Worker checks, oldest first, the
// history once in batches, merged rows again (same id), critical rows at once,
// «booking.new» never, and a Worker that is away loses nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './fakes/gas.mjs';
import { signSync } from '../worker/src/lib/sync.js';

const URL_ = 'https://athanasios-api.menazak-lab.workers.dev/v1/sync/activity';
const SECRET = 's'.repeat(48);
const ADMIN = 'menazakmena@gmail.com';

function world() {
  const w = createWorld({ adminEmails: ADMIN });
  w.as(ADMIN).gs.setup();
  w.properties.set('WORKER_SYNC_SECRET', SECRET);
  w.web[URL_] = { status: 200, body: '{"ok":true}' };
  w.gs.API_REQUEST_ = null;
  return w;
}
const sent = w => w.webRequests.filter(r => r.url === URL_);
const bodyOf = req => Buffer.from(req.options.payload.map(b => (b < 0 ? b + 256 : b))).toString('utf8');
const rowsOf = req => JSON.parse(bodyOf(req)).rows;
const sheet = w => w.spreadsheet.getSheetByName('Activity') || w.gs.activitySheet_();
const write = (w, entry) => w.gs.activity_({ type: 'news', id: 'n-' + Math.random().toString(36).slice(2, 8), title: 'خبر', ...entry });

test('forward: signed exactly like the Worker checks; every row once; nothing new → no call', async () => {
  const w = world();
  write(w, { action: 'create' });
  write(w, { action: 'update' });
  assert.equal(w.gs.activityForward_(true), 2);
  const req = sent(w)[0];
  assert.equal(req.options.headers['x-sync-signature'], await signSync(SECRET, req.options.headers['x-sync-ts'], bodyOf(req)));
  const rows = rowsOf(req);
  assert.deepEqual(rows.map(r => r.action), ['create', 'update']);
  assert.ok(rows.every(r => /^act-[0-9a-f]{12}$/.test(r.id) && r.actor === ADMIN && r.at > 0));
  assert.equal(rows[0].severity, 'important', 'creating content people see');
  assert.equal(rows[1].severity, 'routine');

  assert.equal(w.gs.activityForward_(true), 0, 'nothing new');
  assert.equal(sent(w).length, 1);
  assert.equal(w.gs.activityForward_(false), 0, 'and a quiet tick inside the minute does nothing');
});

test('forward: a merged row (same id, later time) goes again; «booking.new» never goes', () => {
  const w = world();
  write(w, { action: 'update', id: 'n-1' });
  w.gs.activityForward_(true);
  const first = rowsOf(sent(w)[0])[0];
  w.advance(60000);
  write(w, { action: 'update', id: 'n-1' });          // merged into the same row (ACTIVITY_MERGE_MS)
  write(w, { action: 'booking.new', type: 'bookings', id: 'evt-1' });
  w.gs.activityForward_(true);
  const again = rowsOf(sent(w)[1]);
  assert.deepEqual(again.map(r => r.id), [first.id], 'the same id, once more');
  assert.equal(again[0].count, 2);
  assert.ok(again[0].at > first.at);
});

test('forward: the history once, oldest first, 200 a call; then only the tail', () => {
  const w = world();
  const s = sheet(w);
  const t0 = Date.now() - 30 * 864e5;
  for (let i = 0; i < 450; i++) {
    s.appendRow([`act-${i.toString(16).padStart(12, '0')}`, t0 + i * 60000, '2026-09-20 10:00', ADMIN, 'مينا', 'update', 'news', 'n', 'خبر', 'عدّل «خبر»', '', '', 1, '', '']);
  }
  assert.equal(w.gs.activityForward_(true), 200);
  assert.equal(w.gs.activityForward_(true), 200);
  assert.equal(w.gs.activityForward_(true), 50);
  assert.equal(w.gs.activityForward_(true), 0);
  const ids = sent(w).flatMap(r => rowsOf(r).map(x => x.id));
  assert.equal(new Set(ids).size, 450, 'each row once');
  assert.equal(ids[0], 'act-000000000000', 'oldest first');
  assert.equal(JSON.parse(w.properties.get('ACTIVITY_FWD')).done, true);
});

test('forward: the Worker away → nothing lost, never throws; a row written "in the past" by a parallel run is still caught', () => {
  const w = world();
  w.web[URL_] = { status: 503, body: 'down' };
  write(w, { action: 'create' });
  assert.equal(w.gs.activityForward_(true), 0);
  w.web[URL_] = { status: 200, body: '{"ok":true}' };
  assert.equal(w.gs.activityForward_(false), 1, 'a failure does not wait for the minute');

  // another execution's row lands with an `at` 30 s before what D1 has
  const mark = JSON.parse(w.properties.get('ACTIVITY_FWD'));
  sheet(w).appendRow(['act-aaaaaaaaaaaa', mark.at - 30000, '2026-10-18 10:00', ADMIN, 'مينا', 'delete', 'news', 'n9', 'خبر', 'مسح «خبر»', '', '', 1, '', '']);
  assert.equal(w.gs.activityForward_(true), 1);
  assert.equal(rowsOf(sent(w).at(-1))[0].id, 'act-aaaaaaaaaaaa');
  assert.equal(w.gs.activityForward_(true), 0);

  w.properties.delete('WORKER_SYNC_SECRET');
  write(w, { action: 'create' });
  assert.equal(w.gs.activityForward_(true), 0, 'no secret, no call');
});

test('forward: a critical row (servant payment number approval) goes at once outside a request', () => {
  const w = world();
  w.gs.activity_({ action: 'pay.approve', type: 'servant', id: 'srv-1', title: 'مينا' });
  assert.equal(sent(w).length, 1, 'sent without waiting for a tick');
  assert.equal(rowsOf(sent(w)[0])[0].severity, 'critical');
});
