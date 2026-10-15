// Admin booking routes (src/book/admin.js) on real SQLite + in-memory R2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWorld, eventJson, pay } from './book-helpers.mjs';
import { msStamp } from '../src/book/model.js';

async function pending(w, over = {}) {
  const r = await w.submit({ phone: '010' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'), ...over });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (await w.db.prepare('SELECT id, version FROM bookings WHERE ref = ?').bind(r.body.ref).first());
}

const B = (id, action = '') => '/v1/admin/book/bookings/' + id + (action ? '/' + action : '');

test('module, events, queue and detail', async () => {
  const w = await bookWorld();
  assert.deepEqual((await w.admin('GET', '/v1/admin/book/module')).body, { ok: true, on: true, env: 'test' });
  const b = await pending(w, { counts: { applicant: 1, child: 1 } });
  const evs = await w.admin('GET', '/v1/admin/book/events');
  assert.equal(evs.body.events[0].counts.pending, 1);
  const q = await w.admin('GET', '/v1/admin/book/bookings?eventId=evt-alex01&status=pending');
  assert.equal(q.body.rows.length, 1);
  assert.equal(q.body.rows[0].quotedTotal, 2300);
  assert.equal(q.body.rows[0].paymentStatus, null);
  assert.equal((await w.admin('GET', '/v1/admin/book/bookings?eventId=evt-alex01&q=' + encodeURIComponent(q.body.rows[0].ref))).body.rows.length, 1);
  const d = await w.admin('GET', B(b.id));
  assert.equal(d.body.booking.version, 1);
  assert.equal(d.body.event.capacity, 10);
  assert.deepEqual(d.body.booking.requested, { applicant: 1, adult: 0, child: 1, infant: 0 });
  assert.equal((await w.pub('GET', B(b.id))).status, 401, 'admin only');
});

test('confirm (full mode): needs the money unless overridden with a reason; payments land with it, once', async () => {
  const w = await bookWorld();
  const b = await pending(w);                                     // quote 3000
  const short = await w.admin('POST', B(b.id, 'confirm'), { version: 1, payments: [pay({ amount: 1000 })] });
  assert.equal(short.body.code, 'needs_override');
  assert.equal(short.body.warnings[0].code, 'payment');
  const noReason = await w.admin('POST', B(b.id, 'confirm'), { version: 1, overridePay: true, payments: [pay({ amount: 1000 })] });
  assert.equal(noReason.body.field, 'reason');
  const p = pay({ amount: 3000 });
  const ok = await w.admin('POST', B(b.id, 'confirm'), { version: 1, payments: [p] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.booking.status, 'confirmed');
  assert.equal(ok.body.derived.paymentStatus, 'paid');
  assert.equal(ok.body.payments.length, 1);
  const again = await w.admin('POST', B(b.id, 'confirm'), { version: 1, payments: [p] });
  assert.equal(again.status, 200, 'a retried confirm answers with the booking as stored');
  assert.equal(again.body.payments.length, 1, 'no second payment row');
});

test('confirm (instalments): the first payment is enough; amount due changed needs a reason (dueHistory)', async () => {
  const w = await bookWorld({ event: eventJson({}, { payment: { mode: 'installments', minFirst: 500, finalDueAt: '' } }) });
  const b = await pending(w);
  assert.equal((await w.admin('POST', B(b.id, 'confirm'), { version: 1, amountDue: 2500, payments: [pay({ amount: 500 })] })).body.field, 'dueReason');
  const ok = await w.admin('POST', B(b.id, 'confirm'), { version: 1, amountDue: 2500, dueReason: 'خصم أخوات', payments: [pay({ amount: 500 })] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.derived.paymentStatus, 'partial');
  assert.equal(ok.body.derived.balance, 2000);
  assert.equal(ok.body.booking.dueHistory[0].to, 2500);
});

test('capacity: two admins race for the last places — one wins, the other gets needs_override; override with a reason works', async () => {
  const w = await bookWorld({ event: eventJson({}, { capacity: 3, payment: { mode: 'installments', minFirst: 0, finalDueAt: '' } }) });
  const a = await pending(w, { counts: { applicant: 1, adult: 1 } });
  const b = await pending(w, { counts: { applicant: 1, adult: 1 } });
  const [ra, rb] = await Promise.all([w.admin('POST', B(a.id, 'confirm'), { version: 1 }), w.admin('POST', B(b.id, 'confirm'), { version: 1 })]);
  const codes = [ra.body.ok ? 'ok' : ra.body.code, rb.body.ok ? 'ok' : rb.body.code].sort();
  assert.deepEqual(codes, ['needs_override', 'ok']);
  const loser = ra.body.ok ? b : a;
  const lost = ra.body.ok ? rb : ra;
  assert.equal(lost.body.warnings[0].code, 'capacity');
  assert.equal(lost.body.left, 1);
  const forced = await w.admin('POST', B(loser.id, 'confirm'), { version: 1, overrideCap: true, reason: 'أتوبيس تاني' });
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  assert.equal(forced.body.booking.capOverride.reason, 'أتوبيس تاني');
  assert.equal(forced.body.event.taken, 4);
});

test('version: a stale write is a conflict; the event over → final', async () => {
  const w = await bookWorld({ event: eventJson({}, { payment: { mode: 'installments', minFirst: 0, finalDueAt: '' } }) });
  const b = await pending(w);
  await w.admin('POST', B(b.id, 'update'), { version: 1, adminNote: 'اتصلنا بيه' });
  const stale = await w.admin('POST', B(b.id, 'confirm'), { version: 1 });
  assert.equal(stale.body.code, 'conflict');
  assert.equal(stale.body.version, 2);
  const past = await bookWorld({ event: eventJson({ startAt: msStamp(Date.now() - 3 * 864e5), endAt: msStamp(Date.now() - 2 * 864e5) }, { opensAt: '', closesAt: '' }) });
  await past.db.prepare(`INSERT INTO bookings (id, ref, event_id, source, status, name, phone, requested, seats_requested, quoted_total, price_rev, request_key, created_at, created_ms, updated_ms)
    VALUES ('bkg-old001', 'B-OLD01', 'evt-alex01', 'admin', 'pending', 'x', '+201000000000', '{"applicant":1}', 1, 1500, 'r', 'rq-old-0001', 'x', 0, 0)`).run();
  assert.equal((await past.admin('POST', B('bkg-old001', 'confirm'), { version: 1 })).body.code, 'final');
});

test('payments: warnings vs refusals, force, idemKey replay; pending only through confirm/reject', async () => {
  const w = await bookWorld({ event: eventJson({}, { payment: { mode: 'installments', minFirst: 0, finalDueAt: '' } }) });
  const b = await pending(w);
  assert.equal((await w.admin('POST', B(b.id, 'payments'), pay())).body.code, 'final', 'pending: use confirm');
  await w.admin('POST', B(b.id, 'confirm'), { version: 1 });
  assert.equal((await w.admin('POST', B(b.id, 'payments'), pay({ receivedAt: msStamp(Date.now() + 3600e3) }))).body.field, 'receivedAt', 'future: refused');
  assert.equal((await w.admin('POST', B(b.id, 'payments'), pay({ amount: 10.5 }))).body.field, 'amount');
  assert.equal((await w.admin('POST', B(b.id, 'payments'), pay({ kind: 'refund' }))).body.field, 'amount', 'refund with nothing paid');
  const wrongMethod = await w.admin('POST', B(b.id, 'payments'), pay({ servantId: 'srv-bbbb2222', method: 'instapay' }));
  assert.equal(wrongMethod.body.code, 'warn');
  assert.equal(wrongMethod.body.warnings[0].code, 'method');
  const p1 = pay({ amount: 1000 });
  assert.equal((await w.admin('POST', B(b.id, 'payments'), p1)).status, 200);
  assert.equal((await w.admin('POST', B(b.id, 'payments'), p1)).body.payments.length, 1, 'same idemKey: no second row');
  const dupe = await w.admin('POST', B(b.id, 'payments'), pay({ amount: 1000 }));
  assert.equal(dupe.body.warnings[0].code, 'duplicate');
  const forced = await w.admin('POST', B(b.id, 'payments'), pay({ amount: 1000, force: true }));
  assert.equal(forced.body.derived.paid, 2000);
  const over = await w.admin('POST', B(b.id, 'payments'), pay({ amount: 5000 }));
  assert.equal(over.body.warnings[0].code, 'overpaid');
});

test('void: once per row, never a void; the total follows; a refund row', async () => {
  const w = await bookWorld({ event: eventJson({}, { payment: { mode: 'installments', minFirst: 0, finalDueAt: '' } }) });
  const b = await pending(w);
  await w.admin('POST', B(b.id, 'confirm'), { version: 1, payments: [pay({ amount: 1200 })] });
  const typo = await w.admin('POST', B(b.id, 'payments'), pay({ amount: 800, servantId: 'srv-bbbb2222' }));
  const target = typo.body.payments.find(p => p.amount === 800);
  assert.equal((await w.admin('POST', '/v1/admin/book/payments/' + target.id + '/void', { idemKey: 'void-0000001' })).body.field, 'reason');
  const v = await w.admin('POST', '/v1/admin/book/payments/' + target.id + '/void', { reason: 'غلط في المبلغ', idemKey: 'void-0000001' });
  assert.equal(v.body.derived.paid, 1200);
  assert.equal((await w.admin('POST', '/v1/admin/book/payments/' + target.id + '/void', { reason: 'تاني', idemKey: 'void-0000002' })).body.code, 'final', 'already voided');
  assert.equal((await w.admin('POST', '/v1/admin/book/payments/' + target.id + '/void', { reason: 'غلط في المبلغ', idemKey: 'void-0000001' })).status, 200, 'replay');
  const voidRow = v.body.payments.find(p => p.kind === 'void');
  assert.equal((await w.admin('POST', '/v1/admin/book/payments/' + voidRow.id + '/void', { reason: 'x y', idemKey: 'void-0000003' })).body.code, 'final', 'a void cannot be voided');
  const r = await w.admin('POST', B(b.id, 'payments'), pay({ kind: 'refund', amount: 200, force: true }));
  assert.equal(r.body.derived.paid, 1000);
});

test('reject with money in → refund owed; reopen; cancel keeps a retained fee ≤ paid', async () => {
  const w = await bookWorld({ event: eventJson({}, { payment: { mode: 'installments', minFirst: 0, finalDueAt: '' } }) });
  const b = await pending(w);
  assert.equal((await w.admin('POST', B(b.id, 'reject'), { version: 1 })).body.field, 'reason');
  const rj = await w.admin('POST', B(b.id, 'reject'), { version: 1, reason: 'الدفع مش واضح', payments: [pay({ amount: 700 })] });
  assert.equal(rj.status, 200, JSON.stringify(rj.body));
  assert.equal(rj.body.derived.refundOwed, 700);
  assert.equal((await w.admin('GET', '/v1/admin/book/bookings?eventId=evt-alex01&refunds=1')).body.rows.length, 1);
  const ro = await w.admin('POST', B(b.id, 'reopen'), { version: rj.body.booking.version });
  assert.equal(ro.body.booking.status, 'pending');
  const c = await w.admin('POST', B(b.id, 'confirm'), { version: ro.body.booking.version });
  assert.equal((await w.admin('POST', B(b.id, 'cancel'), { version: c.body.booking.version, reason: 'سافر', retain: 800 })).body.field, 'retain', 'more than paid');
  const cn = await w.admin('POST', B(b.id, 'cancel'), { version: c.body.booking.version, reason: 'سافر', retain: 200 });
  assert.equal(cn.body.booking.status, 'cancelled');
  assert.equal(cn.body.derived.refundOwed, 500);
  assert.equal((await w.admin('POST', B(b.id, 'reopen'), { version: cn.body.booking.version })).body.code, 'final', 'cancelled is final');
});

test('update: more people re-checks places (override with reason); amount due change needs a reason', async () => {
  const w = await bookWorld({ event: eventJson({}, { capacity: 3, payment: { mode: 'installments', minFirst: 0, finalDueAt: '' } }) });
  const b = await pending(w, { counts: { applicant: 1, adult: 1 } });
  const c = await w.admin('POST', B(b.id, 'confirm'), { version: 1 });
  const big = await w.admin('POST', B(b.id, 'update'), { version: c.body.booking.version, actual: { applicant: 1, adult: 3 } });
  assert.equal(big.body.code, 'needs_override');
  const ok = await w.admin('POST', B(b.id, 'update'), { version: c.body.booking.version, actual: { applicant: 1, adult: 2 } });
  assert.equal(ok.body.event.taken, 3);
  assert.equal((await w.admin('POST', B(b.id, 'update'), { version: ok.body.booking.version, amountDue: 100 })).body.field, 'reason');
});

test('manual booking (source admin), confirmed in the same call; cancel-all; summary and export', async () => {
  const w = await bookWorld({ event: eventJson({}, { payment: { mode: 'installments', minFirst: 0, finalDueAt: '' } }) });
  const m = await w.admin('POST', '/v1/admin/book/bookings', { eventId: 'evt-alex01', requestKey: 'adm-req-0001', name: 'حجز بالتليفون', phone: '01011112222', counts: { applicant: 1 }, servantId: 'srv-bbbb2222', method: 'cash', confirm: { payments: [pay({ amount: 1500, servantId: 'srv-bbbb2222' })] } });
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.equal(m.body.booking.source, 'admin');
  assert.equal(m.body.booking.status, 'confirmed');
  assert.equal((await w.admin('POST', '/v1/admin/book/bookings', { eventId: 'evt-alex01', requestKey: 'adm-req-0001', name: 'حجز بالتليفون', phone: '01011112222', counts: { applicant: 1 } })).body.booking.id, m.body.booking.id, 'requestKey replay');
  await pending(w);

  const s = await w.admin('GET', '/v1/admin/book/summary?eventId=evt-alex01');
  assert.equal(s.body.overall.money.received, 1500);
  assert.equal(s.body.servants.find(x => x.id === 'srv-bbbb2222').net, 1500);
  const ex = await w.admin('GET', '/v1/admin/book/export?eventId=evt-alex01');
  assert.equal(ex.body.bookings.length, 2);
  assert.equal(ex.body.payments[0].servantName, 'مرقس فادي');

  const all = await w.admin('POST', '/v1/admin/book/events/evt-alex01/cancel-all', { reason: 'الرحلة اتلغت', idemKey: 'cancel-all-0001' });
  assert.equal(all.body.cancelled, 2);
  const again = await w.admin('POST', '/v1/admin/book/events/evt-alex01/cancel-all', { reason: 'الرحلة اتلغت', idemKey: 'cancel-all-0001' });
  assert.equal(again.body.cancelled, 2, 'replay');
  assert.equal((await w.admin('GET', '/v1/admin/book/bookings?eventId=evt-alex01&refunds=1')).body.rows.length, 1, 'the paid one owes a refund');
});

test('admin proofs for a booking: upload (purpose payment) → attach to a payment; module switch is primary-only outside staging', async () => {
  const w = await bookWorld({ event: eventJson({}, { payment: { mode: 'installments', minFirst: 0, finalDueAt: '' } }) });
  const b = await pending(w);
  const up = await w.admin('POST', '/v1/admin/proofs?purpose=payment&bookingId=' + b.id, w.jpeg(), { 'idempotency-key': 'prf-up-00001' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const c = await w.admin('POST', B(b.id, 'confirm'), { version: 1, payments: [pay({ amount: 500, proofIds: [up.body.proof.id] })] });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual(c.body.payments[0].proofIds, [up.body.proof.id]);
  assert.equal(c.body.proofs[0].paymentId, c.body.payments[0].id);
  assert.equal((await w.admin('POST', B(b.id, 'payments'), pay({ proofIds: ['prf-zzzzzzzz'] }))).body.field, 'proofIds');
  assert.equal((await w.admin('POST', '/v1/admin/book/module', { on: false })).status, 403, 'a non-primary admin cannot switch it');
  await w.db.prepare("INSERT INTO admins (email, role, active, created_at) VALUES ('admin@example.com', 'primary', 1, 0) ON CONFLICT(email) DO UPDATE SET role = 'primary'").run();
  assert.equal((await w.admin('POST', '/v1/admin/book/module', { on: false })).body.on, false);
});
