// Booking pilot readiness: the DRAFT schema (drafts/0003_bookings.sql) and the
// guarded statements the pilot will use. Real SQLite, same rules as D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migratedDb } from './d1-sqlite.mjs';

function db() {
  const d = migratedDb();
  d.raw.exec(readFileSync(new URL('../drafts/0003_bookings.sql', import.meta.url), 'utf8'));
  d.raw.exec("INSERT INTO event_cfg (id, slug, title, booking, capacity, price_rev, revision, published, synced_at) VALUES ('evt-1', 'trip', 'Trip', '{}', 5, 'p1', 'r1', 1, 0)");
  return d;
}

let n = 0;
function addBooking(d, seats, status = 'pending') {
  n++;
  d.raw.prepare(`INSERT INTO bookings (id, ref, event_id, source, status, name, phone, requested, seats_requested, seats_actual, quoted_total, price_rev, request_key, created_at, created_ms, updated_ms)
    VALUES (?, ?, 'evt-1', 'site', ?, 'x', '+201000000000', '{}', ?, ?, 100, 'p1', ?, '2026-10-15 10:00', 0, 0)`).run('bkg-' + n, 'B-' + n, status, seats, status === 'confirmed' ? seats : 0, 'rk-' + n);
  return 'bkg-' + n;
}

const CONFIRM = `UPDATE bookings SET status = 'confirmed', seats_actual = ?, version = version + 1
  WHERE id = ? AND status = 'pending' AND version = ?
    AND ((SELECT capacity FROM event_cfg WHERE id = bookings.event_id) IS NULL
      OR (SELECT COALESCE(SUM(b2.seats_actual), 0) FROM bookings b2 WHERE b2.event_id = bookings.event_id AND b2.status = 'confirmed') + ?
         <= (SELECT capacity FROM event_cfg WHERE id = bookings.event_id)
      OR ? = 1)`;

test('confirm respects capacity exactly; override needs the flag; stale version refused', async () => {
  const d = db();
  const a = addBooking(d, 3), b = addBooking(d, 2), c = addBooking(d, 1);
  assert.equal((await d.prepare(CONFIRM).bind(3, a, 1, 3, 0).run()).meta.changes, 1);
  assert.equal((await d.prepare(CONFIRM).bind(2, b, 1, 2, 0).run()).meta.changes, 1);   // 5/5
  assert.equal((await d.prepare(CONFIRM).bind(1, c, 1, 1, 0).run()).meta.changes, 0, 'full');
  assert.equal((await d.prepare(CONFIRM).bind(1, c, 2, 1, 1).run()).meta.changes, 0, 'stale version');
  assert.equal((await d.prepare(CONFIRM).bind(1, c, 1, 1, 1).run()).meta.changes, 1, 'override with reason');
  assert.equal((await d.prepare(CONFIRM).bind(1, c, 2, 1, 1).run()).meta.changes, 0, 'already confirmed');
});

test('payments: idempotent, append-only, one void per row, void cannot be voided', async () => {
  const d = db();
  const b = addBooking(d, 1, 'confirmed');
  const pay = (id, kind, amount, key, voids = null) => d.prepare(`INSERT INTO payments (id, booking_id, event_id, kind, amount, received_at, recorded_at, recorded_ms, recorded_by, voids_id, idem_key)
    VALUES (?, ?, 'evt-1', ?, ?, 'x', 'x', 0, 'a', ?, ?) ON CONFLICT(idem_key) DO NOTHING`).bind(id, b, kind, amount, voids, key).run();
  assert.equal((await pay('pay-1', 'payment', 1200, 'k1')).meta.changes, 1);
  assert.equal((await pay('pay-1b', 'payment', 1200, 'k1')).meta.changes, 0, 'same idemKey → no second row');
  await pay('pay-2', 'payment', 800, 'k2');

  const VOID = (voidId, target, key) => d.batch([
    d.prepare(`INSERT INTO payments (id, booking_id, event_id, kind, amount, received_at, recorded_at, recorded_ms, recorded_by, voids_id, idem_key, note)
      SELECT ?, t.booking_id, t.event_id, 'void', t.amount, 'x', 'x', 0, 'a', t.id, ?, 'typo' FROM payments t
      WHERE t.id = ? AND t.voided_by IS NULL AND t.kind <> 'void'`).bind(voidId, key, target),
    d.prepare('UPDATE payments SET voided_by = ? WHERE id = ? AND voided_by IS NULL AND EXISTS (SELECT 1 FROM payments WHERE id = ?)').bind(voidId, target, voidId)
  ]);
  const r = await VOID('pay-v1', 'pay-2', 'kv1');
  assert.deepEqual(r.map(x => x.meta.changes), [1, 1]);
  const again = await VOID('pay-v2', 'pay-2', 'kv2');
  assert.deepEqual(again.map(x => x.meta.changes), [0, 0], 'second void of the same row does nothing');
  const voidVoid = await VOID('pay-v3', 'pay-v1', 'kv3');
  assert.deepEqual(voidVoid.map(x => x.meta.changes), [0, 0], 'a void cannot be voided');

  await pay('pay-3', 'payment', 1800, 'k3');
  await pay('pay-4', 'refund', 200, 'k4');
  const paid = await d.prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'payment' THEN amount WHEN 'refund' THEN -amount ELSE 0 END), 0) AS paid
    FROM payments WHERE booking_id = ? AND voided_by IS NULL AND kind <> 'void'`).bind(b).first();
  assert.equal(paid.paid, 1200 + 1800 - 200, 'derived total (EVENTS.md §5.4 shape)');
  await assert.rejects(pay('pay-5', 'payment', 0, 'k5'), /CHECK/, 'amount > 0 enforced by the DB');
});

test('submit is idempotent by request_key; status values are constrained', async () => {
  const d = db();
  addBooking(d, 1);
  assert.throws(() => d.raw.prepare(`INSERT INTO bookings (id, ref, event_id, source, status, name, phone, requested, seats_requested, quoted_total, price_rev, request_key, created_at, created_ms, updated_ms)
    VALUES ('bkg-x', 'B-x', 'evt-1', 'site', 'pending', 'x', 'p', '{}', 1, 1, 'p', 'rk-${n}', 'x', 0, 0)`).run(), /UNIQUE/);
  assert.throws(() => d.raw.prepare(`UPDATE bookings SET status = 'paid' WHERE id = 'bkg-${n}'`).run(), /CHECK/);
});
