// Phase 1 final: the visitor's «دفع كامل» / «دفع قسط» choice (checked server
// side, a claim — never money), and admin payment reminders (logged, one per
// booking per gap, only for confirmed bookings that still owe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWorld, eventJson, pay } from './book-helpers.mjs';
import { payClaim, minPart } from '../src/book/model.js';

const installments = () => eventJson({}, { payment: { mode: 'installments', minFirst: 1000, finalDueAt: '' } });
const phone = () => '010' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

test('payClaim: full = the total; part only with installments, minimum ≤ amount < total; nothing sent = nothing claimed', () => {
  const inst = { mode: 'installments', minFirst: 1000 };
  assert.deepEqual(payClaim(inst, 3000, 'full'), { plan: 'full', claim: 3000 });
  assert.deepEqual(payClaim(inst, 3000, 'part', 1000), { plan: 'part', claim: 1000 });
  assert.deepEqual(payClaim(inst, 3000, 'part', 2999), { plan: 'part', claim: 2999 });
  for (const bad of [999, 3000, 3500, 0, -5, 1500.5, '1500x', null]) assert.equal(payClaim(inst, 3000, 'part', bad).problem, 'payAmount', String(bad));
  assert.equal(payClaim({ mode: 'full', minFirst: 0 }, 3000, 'part', 1500).problem, 'payPlan');
  assert.equal(payClaim(inst, 3000, 'later').problem, 'payPlan');
  assert.deepEqual(payClaim(inst, 3000, undefined), { plan: null, claim: null });
  // a minimum above the total can't block a part payment of less than the total
  assert.equal(minPart({ mode: 'installments', minFirst: 5000 }, 3000), 2999);
  assert.equal(minPart({ mode: 'installments', minFirst: 0 }, 3000), 1);
});

test('submit: «دفع قسط» stored as a claim (admin sees it), refused when out of range or the event takes full payment only', async () => {
  const w = await bookWorld({ event: installments() });
  let r = await w.submit({ phone: phone(), payPlan: 'part', payAmount: 999 });
  assert.deepEqual([r.status, r.body.code, r.body.field], [400, 'invalid', 'payAmount']);
  r = await w.submit({ phone: phone(), payPlan: 'part', payAmount: 3000 });
  assert.equal(r.body.field, 'payAmount', 'the whole total is «دفع كامل», not an installment');
  r = await w.submit({ phone: phone(), payPlan: 'part', payAmount: 1200 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await w.submit({ phone: phone(), payPlan: 'full' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const list = (await w.admin('GET', '/v1/admin/book/bookings?eventId=evt-alex01&status=pending')).body.rows;
  assert.deepEqual(list.map(b => [b.payPlan, b.payClaim]).sort(), [['full', 3000], ['part', 1200]]);
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM payments').first()).n, 0, 'a claim is never money');

  const full = await bookWorld();
  r = await full.submit({ phone: phone(), payPlan: 'part', payAmount: 1500 });
  assert.equal(r.body.field, 'payPlan');
  r = await full.submit({ phone: phone() });
  assert.equal(r.status, 200, 'an older page (no choice) still books');
});

test('reminders: only a confirmed booking that owes; once per booking per gap; logged with the activity', async () => {
  const w = await bookWorld();
  const R = '/v1/admin/book/events/evt-alex01/reminders';
  const owes = await w.admin('POST', '/v1/admin/book/bookings', { eventId: 'evt-alex01', requestKey: w.key('a'), name: 'أ ب', phone: phone(), counts: { applicant: 1, adult: 1 }, servantId: 'srv-aaaa1111', method: 'cash',
    confirm: { overridePay: true, reason: 'مقدم', payments: [pay({ amount: 1000 })] } });
  const paid = await w.admin('POST', '/v1/admin/book/bookings', { eventId: 'evt-alex01', requestKey: w.key('b'), name: 'ج د', phone: phone(), counts: { applicant: 1 }, servantId: 'srv-aaaa1111', method: 'cash',
    confirm: { payments: [pay({ amount: 1500 })] } });
  const pending = await w.submit({ phone: phone() });
  const owesId = owes.body.booking.id;

  let r = await w.admin('POST', R, { bookingId: paid.body.booking.id, idemKey: w.key('r') });
  assert.deepEqual([r.status, r.body.field], [400, 'bookingId'], 'nothing owed → no reminder');
  r = await w.admin('POST', R, { bookingId: pending.body.bookingId || pending.body.id || 'x', idemKey: w.key('r') });
  assert.ok(r.status >= 400, 'a pending request is not reminded');

  const k = w.key('r');
  r = await w.admin('POST', R, { bookingId: owesId, idemKey: k });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.reminders.map(x => [x.bookingId, x.balance, x.channel]), [[owesId, 2000, 'whatsapp']]);
  r = await w.admin('POST', R, { bookingId: owesId, idemKey: k });
  assert.equal(r.body.reminders.length, 1, 'a retry is the same reminder');
  r = await w.admin('POST', R, { bookingId: owesId, idemKey: w.key('r') });
  assert.deepEqual([r.status, r.body.code], [409, 'recent']);
  // a day later → allowed again
  await w.db.prepare('UPDATE reminders SET sent_ms = sent_ms - ?').bind(21 * 3600 * 1000).run();
  r = await w.admin('POST', R, { bookingId: owesId, idemKey: w.key('r') });
  assert.equal(r.body.reminders.length, 2);
  assert.equal((await w.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'booking.remind'").first()).n, 2);
});

test('handover: one payment method required; capped by what the servant holds by that method', async () => {
  const w = await bookWorld();
  const H = '/v1/admin/book/events/evt-alex01/handovers';
  await w.admin('POST', '/v1/admin/book/bookings', { eventId: 'evt-alex01', requestKey: w.key('a'), name: 'أ ب', phone: phone(), counts: { applicant: 1 }, servantId: 'srv-aaaa1111', method: 'cash',
    confirm: { payments: [pay({ amount: 1500 })] } });
  const at = new Date(Date.now() + 2 * 3600 * 1000 - 60000).toISOString().slice(0, 16).replace('T', ' ');
  let r = await w.admin('POST', H, { servantId: 'srv-aaaa1111', amount: 100, handedAt: at, idemKey: w.key('h') });
  assert.equal(r.body.field, 'method');
  r = await w.admin('POST', H, { servantId: 'srv-aaaa1111', method: 'cash', amount: 0, handedAt: at, idemKey: w.key('h') });
  assert.equal(r.body.field, 'amount');
  r = await w.admin('POST', H, { servantId: 'srv-aaaa1111', method: 'cash', amount: 1501, handedAt: at, idemKey: w.key('h') });
  assert.equal(r.body.code, 'over');
  r = await w.admin('POST', H, { servantId: 'srv-aaaa1111', method: 'cash', amount: 1500, handedAt: at, idemKey: w.key('h') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
