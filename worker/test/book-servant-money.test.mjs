// Per-servant accounting (Phase 1): received (cash vs online), owed by the
// participants who chose them, handed over to the service (append-only,
// voidable), still to hand over — each amount from one ledger row, once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWorld, pay } from './book-helpers.mjs';
import { msStamp } from '../src/book/model.js';

const H = '/v1/admin/book/events/evt-alex01/handovers';
const phone = () => '010' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

test('servant money: cash vs online, owed, handover, still to hand over; a void puts it back; nothing counted twice', async () => {
  const w = await bookWorld();
  // A (srv-aaaa1111): 3000 due, 1000 cash + 500 transfer (online) → owes 1500
  const a = await w.admin('POST', '/v1/admin/book/bookings', { eventId: 'evt-alex01', requestKey: w.key('a'), name: 'أ ب', phone: phone(), counts: { applicant: 1, adult: 1 }, servantId: 'srv-aaaa1111', method: 'cash',
    confirm: { overridePay: true, reason: 'مقدم', payments: [pay({ amount: 1000 }), pay({ amount: 500, method: 'transfer', receivedAt: msStamp(Date.now() - 120000) })] } });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  // B (srv-bbbb2222): paid in full, cash
  const b = await w.admin('POST', '/v1/admin/book/bookings', { eventId: 'evt-alex01', requestKey: w.key('b'), name: 'ج د', phone: phone(), counts: { applicant: 1 }, servantId: 'srv-bbbb2222', method: 'cash',
    confirm: { payments: [pay({ amount: 1500, servantId: 'srv-bbbb2222' })] } });
  assert.equal(b.status, 200, JSON.stringify(b.body));

  let r = await w.admin('GET', H);
  let mina = r.body.servants.find(s => s.id === 'srv-aaaa1111');
  // the 500 transfer went to an account that isn't his (no approved number): verified, but NOT in his custody
  assert.deepEqual([mina.net, mina.cash, mina.online, mina.held, mina.owed, mina.handedOver, mina.toHandOver], [1500, 1000, 500, 1000, 1500, 0, 1000]);
  const byM = Object.fromEntries(mina.methods.map(m => [m.method, m]));
  assert.deepEqual([byM.cash.held, byM.transfer.net, byM.transfer.held], [1000, 500, 0]);
  const pays = (await w.admin('GET', '/v1/admin/book/export?eventId=evt-alex01')).body.payments;
  assert.deepEqual(pays.filter(p => p.servantId === 'srv-aaaa1111').map(p => p.custody).sort(), ['servant', 'service']);

  // more than he holds → warn; then 1200 handed over
  const over = await w.admin('POST', H, { servantId: 'srv-aaaa1111', amount: 2000, handedAt: msStamp(Date.now() - 1000), idemKey: w.key('h') });
  assert.equal(over.body.code, 'warn');
  const key = w.key('h');
  r = await w.admin('POST', H, { servantId: 'srv-aaaa1111', amount: 800, method: 'cash', handedAt: msStamp(Date.now() - 1000), receivedBy: 'أمين الصندوق', idemKey: key });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await w.admin('POST', H, { servantId: 'srv-aaaa1111', amount: 800, method: 'cash', handedAt: msStamp(Date.now() - 1000), receivedBy: 'أمين الصندوق', idemKey: key });
  assert.equal(r.body.handovers.filter(h => h.kind === 'handover').length, 1, 'a retry records it once');
  mina = r.body.servants.find(s => s.id === 'srv-aaaa1111');
  assert.deepEqual([mina.handedOver, mina.toHandOver], [800, 200]);
  assert.equal(mina.methods.find(m => m.method === 'cash').toHandOver, 200);
  assert.deepEqual(r.body.totals, { total: 800, held: 2500, toHandOver: 2500 - 800 });

  // the summary and the export carry the same
  const sum = await w.admin('GET', '/v1/admin/book/summary?eventId=evt-alex01');
  assert.equal(sum.body.servants.find(s => s.id === 'srv-bbbb2222').toHandOver, 1500);
  const exp = await w.admin('GET', '/v1/admin/book/export?eventId=evt-alex01');
  assert.equal(exp.body.handovers.length, 1);

  // void → back to 1500 to hand over; voiding again changes nothing
  const id = r.body.handovers[0].id;
  r = await w.admin('POST', '/v1/admin/book/handovers/' + id + '/void', { reason: 'اتسجل غلط', idemKey: w.key('v') });
  mina = r.body.servants.find(s => s.id === 'srv-aaaa1111');
  assert.deepEqual([mina.handedOver, mina.toHandOver], [0, 1000]);
  r = await w.admin('POST', '/v1/admin/book/handovers/' + id + '/void', { reason: 'تاني', idemKey: w.key('v') });
  assert.equal(r.body.handovers.filter(h => h.kind === 'void').length, 1);
  assert.ok((await w.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action IN ('handover.add','handover.void')").first()).n >= 2);
});

test('custody: a transfer to the servant\'s OWN approved number is his to hand over; pending proofs are «pending verification», not money', async () => {
  const w = await bookWorld();
  await w.db.prepare("INSERT INTO pay_dest (servant_id, method, number, name, source, approved_ms, approved_by, synced_ms) VALUES ('srv-aaaa1111', 'transfer', '01012345678', '', 'own', 1, 'p', 1)").run();
  const a = await w.admin('POST', '/v1/admin/book/bookings', { eventId: 'evt-alex01', requestKey: w.key('a'), name: 'أ ب', phone: phone(), counts: { applicant: 1 }, servantId: 'srv-aaaa1111', method: 'transfer',
    confirm: { payments: [pay({ amount: 1500, method: 'transfer' })] } });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  await w.submit({ phone: phone() });        // a visitor's transfer, waiting for review (quoted 3000)
  const r = await w.admin('GET', H);
  const t = r.body.servants.find(s => s.id === 'srv-aaaa1111').methods.find(m => m.method === 'transfer');
  assert.deepEqual([t.net, t.held, t.toHandOver, t.pendingCount, t.pendingQuoted], [1500, 1500, 1500, 1, 3000]);
});

test('finance: one event or all of them added up (same summary), servant × method, read only', async () => {
  const w = await bookWorld();
  const { rowFromJson, saveRow } = await import('../src/book/event.js');
  const { eventJson } = await import('./book-helpers.mjs');
  await saveRow(w.env, rowFromJson(eventJson({ id: 'evt-second01', slug: 'second-trip', title: 'رحلة تانية' }), 'fixture'));
  for (const [eventId, amount] of [['evt-alex01', 1000], ['evt-second01', 700]]) {
    const r = await w.admin('POST', '/v1/admin/book/bookings', { eventId, requestKey: w.key('f'), name: 'أ ب', phone: phone(), counts: { applicant: 1 }, servantId: 'srv-aaaa1111', method: 'cash',
      confirm: { overridePay: true, reason: 'مقدم', payments: [pay({ amount })] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  await w.admin('POST', '/v1/admin/book/events/evt-alex01/handovers', { servantId: 'srv-aaaa1111', method: 'cash', amount: 400, handedAt: msStamp(Date.now() - 1000), idemKey: w.key('h') });

  const all = await w.admin('GET', '/v1/admin/book/finance?eventId=all');
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.events.length, 2);
  const mina = all.body.servants.find(s => s.id === 'srv-aaaa1111');
  assert.deepEqual([mina.events, mina.net, mina.held, mina.handedOver, mina.toHandOver], [2, 1700, 1700, 400, 1300]);
  assert.deepEqual(mina.methods.map(m => [m.method, m.held, m.handedOver]), [['cash', 1700, 400]]);
  assert.deepEqual([all.body.money.net, all.body.totals.total], [1700, 400]);

  const one = await w.admin('GET', '/v1/admin/book/finance?eventId=evt-second01');
  assert.equal(one.body.servants.find(s => s.id === 'srv-aaaa1111').toHandOver, 700);
});
