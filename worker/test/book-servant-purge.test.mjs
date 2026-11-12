// «احذف نهائي» for a servant (Phase 8B, owner 2026-11-12, docs/phase8b/shots servant-remove.png):
// POST /v1/admin/book/servants/:id/purge moves the servant's bookings, payments and handovers to another servant,
// drops their approved numbers and unlinks an admin — the primary admin only, «احذف» typed; { check } only counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWorld, pay } from './book-helpers.mjs';

const PURGE = id => '/v1/admin/book/servants/' + id + '/purge';
const A = 'srv-aaaa1111';
const B = 'srv-bbbb2222';

async function count(w, table, where = '1 = 1', ...args) {
  return (await w.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).bind(...args).first()).n;
}

test('servant purge: counts first, then the primary admin moves everything to another servant with «احذف»', async () => {
  const w = await bookWorld();
  await w.admin('GET', '/v1/admin/book/module');
  await w.db.prepare("UPDATE admins SET role = 'primary'").run();
  const a = await w.submit({ phone: '01011111111' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const b = await w.submit({ phone: '01022222222' });
  const row = await w.db.prepare('SELECT id FROM bookings WHERE ref = ?').bind(b.body.ref).first();
  const ok = await w.admin('POST', '/v1/admin/book/bookings/' + row.id + '/confirm', { version: 1, payments: [pay({ amount: 3000 })] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  await w.db.prepare("INSERT INTO pay_dest (servant_id, method, number, source, approved_ms, approved_by, synced_ms) VALUES (?, 'instapay', '01011111111', 'own', 0, 'x', 0)").bind(A).run();
  await w.db.prepare("INSERT OR REPLACE INTO admins (email, name, role, active, created_at, servant_id) VALUES ('linked@example.com', 'L', 'admin', 1, 0, ?)").bind(A).run();

  // the dialog's facts
  const check = await w.admin('POST', PURGE(A), { check: true });
  assert.equal(check.status, 200, JSON.stringify(check.body));
  assert.deepEqual([check.body.bookings, check.body.payments, check.body.holding], [2, 1, 3000]);

  // «احذف» must be typed, and another servant chosen
  const wrong = await w.admin('POST', PURGE(A), { to: B, confirm: 'لأ' });
  assert.equal(wrong.body.field, 'confirm');
  const self = await w.admin('POST', PURGE(A), { to: A, confirm: 'احذف' });
  assert.equal(self.body.field, 'to');
  assert.equal(await count(w, 'bookings', 'servant_id = ?', A), 2, 'nothing moved yet');

  // another admin (not the primary) is refused
  await w.db.prepare("INSERT OR REPLACE INTO admins (email, name, role, active, created_at) VALUES ('helper@example.com', 'H', 'admin', 1, 0)").run();
  const other = await w.call(PURGE(A), { method: 'POST', body: { to: B, confirm: 'احذف' }, headers: await w.auth({ email: 'helper@example.com', sub: 'sub-helper' }), fetch: w.g.fetch });
  assert.equal(other.body.code, 'denied');

  const done = await w.admin('POST', PURGE(A), { to: B, confirm: 'احذف' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(await count(w, 'bookings', 'servant_id = ?', A), 0);
  assert.equal(await count(w, 'bookings', 'servant_id = ?', B), 2, 'its bookings went to the other servant');
  assert.equal(await count(w, 'payments', 'servant_id = ?', A), 0);
  assert.equal(await count(w, 'payments', 'servant_id = ?', B), 1, 'the money goes with it');
  assert.equal(await count(w, 'pay_dest', 'servant_id = ?', A), 0, 'its numbers are gone');
  assert.equal(await count(w, 'admins', 'servant_id = ?', A), 0, 'no admin stays linked to it');
  assert.equal(await count(w, 'activity', "action = 'book.purge' AND entity_type = 'servant'"), 1, 'written in «سجل النشاط»');
});
