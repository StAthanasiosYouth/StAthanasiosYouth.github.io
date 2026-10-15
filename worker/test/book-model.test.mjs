// The pure booking model (src/book/model.js), with pricing checked against
// the Apps Script original (apps-script/BookModel.gs) on the same inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as M from '../src/book/model.js';

const gs = (() => {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(new URL('../../apps-script/BookModel.gs', import.meta.url), 'utf8'), ctx);
  return ctx;
})();

const PRICING = { mode: 'group', categories: [
  { key: 'applicant', group: 'adult', price: 1500, seat: true, min: 1, max: 1 },
  { key: 'adult', group: 'adult', price: 1500, seat: true, min: 0, max: 6 },
  { key: 'child', group: 'child', price: 800, seat: true, min: 0, max: 6 },
  { key: 'infant', group: 'child', price: 0, seat: false, min: 0, max: 4 },
  { key: 'guest', group: 'companion', price: 1700, seat: true, min: 0, max: 4 }
] };

test('pricing = BookModel.gs on 200 random requests (quote, seats, people)', () => {
  for (let i = 0; i < 200; i++) {
    const counts = { applicant: 1, adult: i % 7, child: (i * 3) % 7, infant: i % 5, guest: (i * 7) % 5 };
    assert.equal(M.quote(PRICING, counts), gs.bookQuote_(PRICING, counts));
    assert.equal(M.seats(PRICING, counts), gs.bookSeats_(PRICING, counts));
    assert.deepEqual(M.people(PRICING, counts), JSON.parse(JSON.stringify(gs.bookPeople_(PRICING, counts))));
  }
  assert.equal(M.quote(PRICING, { applicant: 1, adult: 2, child: 1, infant: 1, guest: 1 }), 1500 * 3 + 800 + 1700);
  assert.equal(M.seats(PRICING, { applicant: 1, infant: 3 }), 1, 'infants do not sit');
});

test('counts: min/max, unknown keys, per-booking max, single mode, someone coming', () => {
  const b = { pricing: PRICING, perBookingMax: 5 };
  assert.deepEqual(M.checkCounts(b, { applicant: 1, adult: 2 }).counts, { applicant: 1, adult: 2, child: 0, infant: 0, guest: 0 });
  assert.equal(M.checkCounts(b, { applicant: 2 }).problem, 'counts', 'applicant is exactly 1');
  assert.equal(M.checkCounts(b, { applicant: 1, pets: 1 }).problem, 'counts', 'unknown key');
  assert.equal(M.checkCounts(b, { applicant: 1, adult: 1.5 }).problem, 'counts');
  assert.equal(M.checkCounts(b, { applicant: 1, adult: 5 }).tooMany, true, 'seats over perBookingMax');
  assert.ok(M.checkCounts(b, { applicant: 1, adult: 4, infant: 4 }).counts, 'infants do not count toward seats');
  const single = { pricing: { mode: 'single', categories: PRICING.categories }, perBookingMax: 5 };
  assert.equal(M.checkCounts(single, { applicant: 1, adult: 1 }).problem, 'counts');
});

test('phones: Egyptian mobiles in every common form; others refused', () => {
  for (const v of ['01012345678', '+201012345678', '00201012345678', '201012345678', '٠١٠١٢٣٤٥٦٧٨', '010 1234 5678', '010-1234-5678']) assert.equal(M.normPhone(v), '+201012345678', v);
  for (const v of ['0101234567', '0131234567', '+441012345678', 'abc', '']) assert.equal(M.normPhone(v), '', v);
});

test('Cairo stamps ⇄ epoch, both sides of the summer-time switch', () => {
  for (const s of ['2026-01-15T10:30', '2026-07-15T10:30', '2026-10-29T23:59', '2026-10-30T00:30', '2026-04-24T01:30']) {
    assert.equal(M.msStamp(M.stampMs(s)), s, s);
  }
  assert.equal(M.stampMs('2026-01-15T10:30'), Date.UTC(2026, 0, 15, 8, 30), 'winter UTC+2');
  assert.equal(M.stampMs('2026-07-15T10:30'), Date.UTC(2026, 6, 15, 7, 30), 'summer UTC+3');
  assert.equal(M.stampMs('nope'), null);
});

test('window: not open yet / open / closed (closesAt empty = until the start)', () => {
  const ev = (b, start = '2026-11-10T09:00') => ({ online: true, startAt: start, booking: b });
  const t = M.stampMs('2026-11-01T12:00');
  assert.equal(M.windowState(ev({ opensAt: '2026-11-02T00:00', closesAt: '' }), t).reason, 'not_open');
  assert.equal(M.windowState(ev({ opensAt: '2026-10-01T00:00', closesAt: '' }), t).open, true);
  assert.equal(M.windowState(ev({ opensAt: '', closesAt: '2026-11-01T11:59' }), t).reason, 'closed');
  assert.equal(M.windowState(ev({ opensAt: '', closesAt: '' }, '2026-11-01T11:00'), t).reason, 'closed', 'past the start');
  assert.equal(M.windowState({ online: false, booking: {} }, t).reason, 'disabled');
});

test('public left: unlimited null, hidden above showLeftBelow, 0 when full', () => {
  assert.equal(M.publicLeft({ capacity: null }, 5), null);
  assert.equal(M.publicLeft({ capacity: 100, showLeftBelow: 20 }, 50), null);
  assert.equal(M.publicLeft({ capacity: 100, showLeftBelow: 20 }, 85), 15);
  assert.equal(M.publicLeft({ capacity: 100, showLeft: false }, 99), null);
  assert.equal(M.publicLeft({ capacity: 10 }, 12), 0);
});

const pay = (kind, amount, extra = {}) => ({ kind, amount, voided_by: null, ...extra });

test('derived money for every status and payment status branch', () => {
  const full = { mode: 'full' };
  const now = Date.now();
  assert.deepEqual(M.derive({ status: 'pending' }, [pay('payment', 500)], full, now), { paid: 500, balance: null, paymentStatus: null, overdue: false, refundOwed: 500 });
  const c = due => ({ status: 'confirmed', amount_due: due });
  assert.equal(M.derive(c(0), [], full, now).paymentStatus, 'free');
  assert.equal(M.derive(c(3000), [], full, now).paymentStatus, 'unpaid');
  assert.equal(M.derive(c(3000), [pay('payment', 1000)], full, now).paymentStatus, 'partial');
  assert.equal(M.derive(c(3000), [pay('payment', 3000)], full, now).paymentStatus, 'paid');
  const over = M.derive(c(3000), [pay('payment', 3500)], full, now);
  assert.equal(over.paymentStatus, 'overpaid');
  assert.equal(over.refundOwed, 500);
  assert.equal(M.derive({ status: 'rejected', amount_due: 999 }, [pay('payment', 700)], full, now).refundOwed, 700, 'rejected: all of it is owed back');
  assert.equal(M.derive({ status: 'cancelled', amount_due: 200 }, [pay('payment', 700)], full, now).refundOwed, 500, 'cancel keeps the retained fee');
  assert.equal(M.derive({ status: 'withdrawn' }, [], full, now).paymentStatus, 'free');
});

test('§5.4 worked example: 1200 + 800, the 800 voided, 1800 → paid; voids add nothing', () => {
  const rows = [pay('payment', 1200), pay('payment', 800, { voided_by: 'pay-v' }), pay('void', 800, { id: 'pay-v' }), pay('payment', 1800)];
  const d = M.derive({ status: 'confirmed', amount_due: 3000 }, rows, { mode: 'installments', minFirst: 500 }, Date.now());
  assert.deepEqual([d.paid, d.balance, d.paymentStatus], [3000, 0, 'paid']);
  assert.equal(M.paidOf([pay('payment', 1000), pay('refund', 300)]), 700);
});

test('overdue: instalments past finalDueAt with a balance, confirmed only', () => {
  const p = { mode: 'installments', minFirst: 500, finalDueAt: '2026-01-01T00:00' };
  const after = M.stampMs('2026-01-02T00:00');
  assert.equal(M.derive({ status: 'confirmed', amount_due: 3000 }, [pay('payment', 500)], p, after).overdue, true);
  assert.equal(M.derive({ status: 'confirmed', amount_due: 3000 }, [pay('payment', 3000)], p, after).overdue, false);
  assert.equal(M.derive({ status: 'confirmed', amount_due: 3000 }, [pay('payment', 500)], p, M.stampMs('2025-12-01T00:00')).overdue, false);
  assert.equal(M.derive({ status: 'confirmed', amount_due: 3000 }, [], { mode: 'full' }, after).overdue, false);
});

test('confirm rule §5.1: full needs everything, instalments the first payment', () => {
  assert.equal(M.confirmPaymentOk({ mode: 'full' }, 3000, 2999), false);
  assert.equal(M.confirmPaymentOk({ mode: 'full' }, 3000, 3000), true);
  assert.equal(M.confirmPaymentOk({ mode: 'installments', minFirst: 500 }, 3000, 500), true);
  assert.equal(M.confirmPaymentOk({ mode: 'installments', minFirst: 500 }, 3000, 499), false);
  assert.equal(M.confirmPaymentOk({ mode: 'installments', minFirst: 5000 }, 300, 300), true, 'min(minFirst, due)');
  assert.equal(M.confirmPaymentOk({ mode: 'full' }, 0, 0), true, 'free');
});

test('summary §13: money from live rows only, per servant by who received it, from/to filter', () => {
  const event = { booking: { capacity: 10, pricing: PRICING, payment: { mode: 'full' }, servants: [{ id: 'srv-a', name: 'A' }, { id: 'srv-b', name: 'B' }] } };
  const bookings = [
    { id: 'b1', status: 'confirmed', seats_actual: 2, actual: '{"applicant":1,"adult":1}', amount_due: 3000, quoted_total: 3000, servant_id: 'srv-a' },
    { id: 'b2', status: 'pending', seats_actual: 0, quoted_total: 1500, servant_id: 'srv-b' },
    { id: 'b3', status: 'rejected', seats_actual: 0, amount_due: 0, quoted_total: 1500, servant_id: 'srv-a' }
  ];
  const T = M.stampMs('2026-05-10T12:00');
  const payments = [
    { id: 'p1', booking_id: 'b1', kind: 'payment', amount: 2000, servant_id: 'srv-b', servant_name: 'B', method: 'cash', received_ms: T, voided_by: null },
    { id: 'p2', booking_id: 'b1', kind: 'payment', amount: 1000, servant_id: 'srv-a', servant_name: 'A', method: 'instapay', received_ms: T + 86400e3, voided_by: null },
    { id: 'p3', booking_id: 'b3', kind: 'payment', amount: 500, servant_id: 'srv-a', servant_name: 'A', method: 'cash', received_ms: T, voided_by: 'p4' },
    { id: 'p4', booking_id: 'b3', kind: 'void', amount: 500, servant_id: 'srv-a', servant_name: 'A', method: 'cash', received_ms: T, voided_by: null }
  ];
  const s = M.summary(event, bookings, payments, event.booking.servants);
  assert.deepEqual(s.overall.bookings, { pending: 1, confirmed: 1, rejected: 1, withdrawn: 0, cancelled: 0 });
  assert.deepEqual(s.overall.seats, { capacity: 10, taken: 2, left: 8 });
  assert.equal(s.overall.money.received, 3000, 'voided and void rows add 0');
  assert.equal(s.overall.money.byMethod.cash.net, 2000);
  assert.deepEqual(s.overall.pending, { count: 1, quoted: 1500 });
  const a = s.servants.find(x => x.id === 'srv-a'), b = s.servants.find(x => x.id === 'srv-b');
  assert.equal(a.net, 1000);
  assert.equal(b.net, 2000, 'money counted for who received it, not who was chosen');
  assert.equal(b.chosenBy, 1);
  const day1 = M.summary(event, bookings, payments, event.booking.servants, { from: T - 1000, to: T + 1000 });
  assert.equal(day1.overall.money.received, 2000, 'from/to filters payments only');
  assert.equal(day1.overall.bookings.confirmed, 1, 'booking counts cover the whole event');
});

test('price revision changes with a price, references avoid I L O U', () => {
  assert.notEqual(M.priceRev(PRICING), M.priceRev({ categories: [{ ...PRICING.categories[0], price: 1600 }, ...PRICING.categories.slice(1)] }));
  for (let i = 0; i < 200; i++) assert.match(M.newRef(), /^B-[0-9A-HJKMNP-TV-Z]{5}$/);
});
