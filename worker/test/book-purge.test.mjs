// «امسحها نهائي من اللوحة» (Phase 8B, owner 2026-11-11, docs/phase8b/shots event-delete.png):
// POST /v1/admin/book/events/:id/purge removes an event's bookings and everything on them — the primary admin only,
// the event's title typed again; other events untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWorld, eventJson, pay } from './book-helpers.mjs';
import { saveRow, rowFromJson } from '../src/book/event.js';

const PURGE = id => '/v1/admin/book/events/' + id + '/purge';

async function count(w, table, where = '1 = 1', ...args) {
  return (await w.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).bind(...args).first()).n;
}

test('purge: the primary admin, the title typed again; bookings, payments and the booking copy go; another event stays', async () => {
  const w = await bookWorld();
  // the signed-in test admin (its row made on the first call) is the primary one here
  await w.admin('GET', '/v1/admin/book/module');
  await w.db.prepare("UPDATE admins SET role = 'primary'").run();
  // a second event with a booking that must stay
  await saveRow(w.env, rowFromJson(eventJson({ id: 'evt-other01', slug: 'other-trip', title: 'رحلة تانية' }), 'fixture'));
  const a = await w.submit({ phone: '01011111111' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const b = await w.submit({ phone: '01022222222' });
  const kept = await w.submit({ slug: 'other-trip', phone: '01033333333' });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  const row = await w.db.prepare('SELECT id FROM bookings WHERE ref = ?').bind(b.body.ref).first();
  const ok = await w.admin('POST', '/v1/admin/book/bookings/' + row.id + '/confirm', { version: 1, payments: [pay({ amount: 3000 })] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await count(w, 'payments', 'event_id = ?', 'evt-alex01'), 1);

  // the name must match
  const wrong = await w.admin('POST', PURGE('evt-alex01'), { confirm: 'رحلة' });
  assert.equal(wrong.body.code, 'invalid');
  assert.equal(wrong.body.field, 'confirm');
  assert.equal(await count(w, 'bookings', 'event_id = ?', 'evt-alex01'), 2, 'nothing removed');

  // another admin (not the primary) is refused
  await w.db.prepare("INSERT OR REPLACE INTO admins (email, name, role, active, created_at) VALUES ('helper@example.com', 'H', 'admin', 1, 0)").run();
  const other = await w.call(PURGE('evt-alex01'), { method: 'POST', body: { confirm: 'رحلة الإسكندرية' }, headers: await w.auth({ email: 'helper@example.com', sub: 'sub-helper' }), fetch: w.g.fetch });
  assert.equal(other.body.code, 'denied');
  assert.equal(await count(w, 'bookings', 'event_id = ?', 'evt-alex01'), 2, 'still nothing removed');

  const gone = await w.admin('POST', PURGE('evt-alex01'), { confirm: 'رحلة الإسكندرية' });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal(gone.body.bookings, 2);
  for (const t of ['bookings', 'payments', 'payment_claims', 'reminders', 'handovers', 'event_notices', 'book_news']) {
    assert.equal(await count(w, t, 'event_id = ?', 'evt-alex01'), 0, t);
  }
  assert.equal(await count(w, 'event_cfg', 'id = ?', 'evt-alex01'), 0, 'the booking copy of the event');
  assert.equal(await count(w, 'bookings', 'event_id = ?', 'evt-other01'), 1, 'the other event keeps its booking');
  assert.equal(await count(w, 'activity', "action = 'book.purge'"), 1, 'written in «سجل النشاط»');
});
