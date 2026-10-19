// Booking Phase 1 completion (docs/BOOKING-PHASE1-COMPLETION-PLAN.md rev. 4):
// cash is servant-assisted (refused on the site, registered by an admin — also
// PENDING with the money recorded), and InstaPay / wallet numbers the primary
// admin approved are synced from Apps Script and shown at the payment step only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWorld, eventJson, pay } from './book-helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { methodOnline, localPhone } from '../src/book/model.js';
import { forgetPayDest } from '../src/book/pay.js';

const B = (id, action = '') => '/v1/admin/book/bookings/' + id + (action ? '/' + action : '');
const phone = () => '010' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

async function signed(w, path, payload, { ts = Date.now(), secret = w.env.SYNC_SECRET } = {}) {
  const body = JSON.stringify(payload);
  return w.call(path, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-sync-ts': String(ts), 'x-sync-signature': await signSync(secret, String(ts), body) } });
}

async function payOn(w) {
  await w.db.prepare("UPDATE settings SET value = '1' WHERE key = 'PAY_DEST'").run();
  forgetPayDest();
}

const DEST = { servantId: 'srv-aaaa1111', method: 'instapay', number: '+201012345678', name: 'مينا عادل', source: 'own', approvedAt: Date.now() - 60_000, approvedBy: 'menazakmena@gmail.com' };

/* ---------------- cash: servant-assisted ---------------- */

test('cash: a visitor cannot book with cash (nor any offline method); online methods still work', async () => {
  const w = await bookWorld();
  const r = await w.submit({ method: 'cash' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'invalid');
  assert.equal(r.body.field, 'method');
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM bookings').first()).n, 0, 'nothing stored');
  assert.equal((await w.submit({ method: 'transfer' })).status, 200);

  // an explicit online:false wins over everything; an explicit online:true too
  const w2 = await bookWorld({ event: eventJson({}, { methods: [{ key: 'cash', label: 'كاش', needsProof: false, online: false }, { key: 'wallet', label: 'محفظة', needsProof: false, online: false }], servants: [{ id: 'srv-aaaa1111', name: 'م', methods: ['cash', 'wallet'] }] }) });
  assert.equal((await w2.submit({ method: 'wallet' })).body.field, 'method');
});

test('cash: methodOnline — explicit flag, else «needs a proof» = online (event.json before the flag)', () => {
  assert.equal(methodOnline({ key: 'cash', needsProof: false }), false);
  assert.equal(methodOnline({ key: 'instapay', needsProof: true }), true);
  assert.equal(methodOnline({ key: 'x', needsProof: true, online: false }), false);
  assert.equal(methodOnline({ key: 'x', needsProof: false, online: true }), true);
  assert.equal(methodOnline(null), false);
  assert.equal(localPhone('+201012345678'), '01012345678');
  assert.equal(localPhone('٠١٠ ١٢٣٤ ٥٦٧٨'), '01012345678');
  assert.equal(localPhone('12345'), '');
});

test('cash: an admin registers it and confirms at once (one call), payment + audit rows', async () => {
  const w = await bookWorld();
  const r = await w.admin('POST', '/v1/admin/book/bookings', {
    eventId: 'evt-alex01', requestKey: w.key('adm'), name: 'حجز كاش', phone: phone(), counts: { applicant: 1 }, servantId: 'srv-bbbb2222', method: 'cash',
    confirm: { payments: [pay({ amount: 1500, servantId: 'srv-bbbb2222' })] }
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.booking.status, 'confirmed');
  assert.equal(r.body.derived.paid, 1500);
  const acts = (await w.db.prepare("SELECT action FROM activity WHERE entity_id = ? ORDER BY at").bind(r.body.booking.id).all()).results.map(a => a.action);
  assert.ok(acts.includes('booking.create') && acts.includes('booking.confirm'), acts.join());
});

test('cash: registered PENDING with the money recorded; the approver confirms later without retyping it', async () => {
  const w = await bookWorld();
  const form = { eventId: 'evt-alex01', requestKey: w.key('adm'), name: 'حجز كاش مستني', phone: phone(), counts: { applicant: 1, adult: 1 }, servantId: 'srv-bbbb2222', method: 'cash',
    payments: [pay({ amount: 1000, servantId: 'srv-bbbb2222' })] };
  const r = await w.admin('POST', '/v1/admin/book/bookings', form);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = r.body.booking;
  assert.equal(b.status, 'pending');
  assert.equal(r.body.payments.length, 1);
  assert.equal(r.body.payments[0].amount, 1000);
  assert.equal(r.body.payments[0].servantId, 'srv-bbbb2222');
  assert.equal(r.body.derived.paid, 1000);
  const acts = (await w.db.prepare("SELECT action, summary FROM activity WHERE entity_id = ? ORDER BY at").bind(b.id).all()).results;
  assert.deepEqual(acts.map(a => a.action).sort(), ['booking.create', 'payment.add']);

  // the same form again (a retry): the same booking, still one payment
  const again = await w.admin('POST', '/v1/admin/book/bookings', form);
  assert.equal(again.body.booking.id, b.id);
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM payments WHERE booking_id = ?').bind(b.id).first()).n, 1);

  // full mode: 3000 due, 1000 in → confirm is blocked (§5.1) until the rest comes or an override
  const blocked = await w.admin('POST', B(b.id, 'confirm'), { version: b.version });
  assert.equal(blocked.body.code, 'needs_override');
  const ok = await w.admin('POST', B(b.id, 'confirm'), { version: b.version, payments: [pay({ amount: 2000, servantId: 'srv-bbbb2222' })] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.booking.status, 'confirmed');
  assert.equal(ok.body.derived.paid, 3000);
  assert.equal(ok.body.derived.paymentStatus, 'paid');
});

test('cash: early payments refuse refunds and proofs; a bad payment stores nothing', async () => {
  const w = await bookWorld();
  const base = { eventId: 'evt-alex01', name: 'x y', phone: phone(), counts: { applicant: 1 }, servantId: 'srv-bbbb2222', method: 'cash' };
  assert.equal((await w.admin('POST', '/v1/admin/book/bookings', { ...base, requestKey: w.key('a'), payments: [pay({ kind: 'refund' })] })).body.field, 'payments');
  assert.equal((await w.admin('POST', '/v1/admin/book/bookings', { ...base, requestKey: w.key('a'), payments: [pay({ proofIds: ['prf-aaaaaaaa'] })] })).body.field, 'payments');
  assert.equal((await w.admin('POST', '/v1/admin/book/bookings', { ...base, requestKey: w.key('a'), payments: [pay({ amount: -5 })] })).body.field, 'amount');
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM bookings').first()).n, 0);
});

/* ---------------- InstaPay / wallet destinations ---------------- */

test('pay-dest: the approved set is synced (signed), replaces the old one, audited without numbers', async () => {
  const w = await bookWorld();
  const r = await signed(w, '/v1/sync/pay-dest', { dests: [DEST, { ...DEST, method: 'transfer', number: '01198765432', source: 'phone', name: '' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.approved, 2);
  const rows = (await w.db.prepare('SELECT servant_id, method, number, source FROM pay_dest ORDER BY method').all()).results;
  assert.deepEqual(rows.map(x => x.number), ['01012345678', '01198765432'], 'stored in the local 01x form');
  const act = await w.db.prepare("SELECT summary, changes FROM activity WHERE action = 'paydest.sync'").first();
  assert.equal(act.summary, '2 approved');
  assert.doesNotMatch(JSON.stringify(act), /0101|0119/);

  // a later sync without the transfer one: gone
  assert.equal((await signed(w, '/v1/sync/pay-dest', { dests: [DEST] }, { ts: Date.now() + 5 })).body.approved, 1);
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM pay_dest').first()).n, 1);

  // refused: bad number, no approval, duplicates, bad signature, replay
  assert.equal((await signed(w, '/v1/sync/pay-dest', { dests: [{ ...DEST, number: '123' }] }, { ts: Date.now() + 10 })).body.code, 'bad');
  assert.equal((await signed(w, '/v1/sync/pay-dest', { dests: [{ ...DEST, approvedAt: 0 }] }, { ts: Date.now() + 11 })).body.code, 'bad');
  assert.equal((await signed(w, '/v1/sync/pay-dest', { dests: [DEST, DEST] }, { ts: Date.now() + 12 })).body.code, 'bad');
  assert.equal((await signed(w, '/v1/sync/pay-dest', { dests: [] }, { ts: Date.now() + 13, secret: 'wrong' })).status, 401);
  const ts = Date.now() + 20;
  assert.equal((await signed(w, '/v1/sync/pay-dest', { dests: [DEST] }, { ts })).status, 200);
  assert.equal((await signed(w, '/v1/sync/pay-dest', { dests: [] }, { ts })).status, 409, 'replay');
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM pay_dest').first()).n, 1, 'refused syncs changed nothing');
});

test('pay-dest: the payment card answers only with PAY_DEST on, for an approved servant × online method; no-store', async () => {
  const w = await bookWorld();
  await signed(w, '/v1/sync/pay-dest', { dests: [DEST] });
  const ask = (body = {}) => w.pub('POST', '/v1/book/pay', { slug: 'alex-trip', servantId: 'srv-aaaa1111', method: 'instapay', counts: { applicant: 1, adult: 1 }, ...body });
  assert.equal((await ask()).body.code, 'disabled', 'off until PAY_DEST = 1');
  await payOn(w);
  const r = await ask();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.number, '01012345678');
  assert.equal(r.body.name, 'مينا عادل');
  assert.equal(r.body.amount, 3000, 'the server quote for these counts');
  assert.equal(r.body.mode, 'full');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await ask({ counts: undefined })).body.amount, null, 'no counts: no amount');
  assert.equal((await ask({ method: 'cash' })).body.field, 'method', 'cash has no number to show');
  assert.equal((await ask({ method: 'transfer' })).body.field, 'method', 'not approved');
  assert.equal((await ask({ servantId: 'srv-bbbb2222' })).body.field, 'method', 'not this servant’s method');
  assert.equal((await ask({ servantId: 'srv-zzzz9999' })).body.field, 'servantId');
});

test('pay-dest: with PAY_DEST on, a visitor can only pick a method whose destination is approved', async () => {
  const w = await bookWorld();
  await payOn(w);
  // nothing approved yet: transfer refused
  assert.equal((await w.submit({ method: 'transfer' })).body.field, 'method');
  await signed(w, '/v1/sync/pay-dest', { dests: [{ ...DEST, method: 'transfer' }] });
  assert.equal((await w.submit({ method: 'transfer' })).status, 200);
});
