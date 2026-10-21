// Paying a remaining balance through the existing booking (Phase 1.5 step 11,
// BOOKING-PHASE1-COMPLETION-PLAN §4.10): the participant's payment request from the
// status view (never a payment), one open per booking, the admin's accept (through
// «إضافة دفعة») and reject, permissions, and the queue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWorld, eventJson, pay } from './book-helpers.mjs';
import { saveRow, rowFromJson } from '../src/book/event.js';
import { msStamp } from '../src/book/model.js';
import { forgetPayDest } from '../src/book/pay.js';

/* the payment card needs an approved destination (§4.7): the servant's own number */
async function approveDest(w) {
  await w.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('PAY_DEST', '1', 0) ON CONFLICT(key) DO UPDATE SET value = '1'").run();
  for (const m of ['instapay', 'transfer']) await w.db.prepare("INSERT OR REPLACE INTO pay_dest (servant_id, method, number, name, source, approved_ms, approved_by, synced_ms) VALUES ('srv-aaaa1111', ?, '01012345678', 'مينا', 'own', 1, 'p', 1)").bind(m).run();
  forgetPayDest();
}

const A = 'admin@example.com';
const DAY = 864e5;

/* a confirmed booking (3000 due) with 1000 paid; → { w, id, token } */
async function owing({ event } = {}) {
  const w = await bookWorld(event ? { event } : {});
  const r = await w.submit({ counts: { applicant: 1, adult: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id = (await w.db.prepare('SELECT id FROM bookings').first()).id;
  const c = await w.admin('POST', '/v1/admin/book/bookings/' + id + '/confirm', { version: 1, actual: { applicant: 1, adult: 1 }, amountDue: 3000, payments: [pay({ amount: 1000 })], overridePay: true, reason: 'الباقي في الرحلة' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  return { w, id, token: r.body.token };
}
const proof = async (w, token) => {
  const up = await w.call('/v1/book/proof?slug=alex-trip', { method: 'POST', body: w.jpeg(900, 600), headers: { 'x-status-token': token, 'cf-connecting-ip': '198.51.100.9' } });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  return { proofId: up.body.proofId, claim: up.body.claim };
};
const request = (w, token, over = {}) => w.pub('POST', '/v1/book/pay-request', { token, requestKey: w.key('pr'), servantId: 'srv-aaaa1111', method: 'instapay', amount: 2000, ...over });
const status = (w, token) => w.pub('POST', '/v1/book/status', { token });

test('the status view offers «ادفع الباقي» only for a confirmed booking that owes money; the payment card shows the balance', async () => {
  const { w, token } = await owing();
  await approveDest(w);
  const s = await status(w, token);
  assert.equal(s.body.balance, 2000);
  assert.equal(s.body.canPay, true);
  assert.equal(s.body.request, null);
  const card = await w.pub('POST', '/v1/book/pay', { slug: 'alex-trip', servantId: 'srv-aaaa1111', method: 'transfer', token });
  assert.equal(card.status, 200, JSON.stringify(card.body));
  assert.equal(card.body.amount, 2000, 'the amount is what is left, server-derived');
});

test('a request: proofs + amount → pending; never a payments row; the screenshots join the booking; logged as important', async () => {
  const { w, id, token } = await owing();
  const p = await proof(w, token);
  const r = await request(w, token, { proofs: [p] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.request, { status: 'pending', amount: 2000 });
  assert.equal((await w.db.prepare("SELECT COUNT(*) AS n FROM payments WHERE booking_id = ? AND kind = 'payment'").bind(id).first()).n, 1, 'still only the first payment');
  const pr = await w.db.prepare('SELECT booking_id, payment_id FROM proofs WHERE id = ?').bind(p.proofId).first();
  assert.equal(pr.booking_id, id);
  assert.equal(pr.payment_id, null, 'a screenshot is not a payment');
  const log = await w.db.prepare("SELECT severity, changes FROM activity WHERE action = 'payment.request'").first();
  assert.equal(log.severity, 'important');
  assert.equal(JSON.parse(log.changes).amount, 2000);
  const s = await status(w, token);
  assert.deepEqual([s.body.request.status, s.body.request.amount, s.body.canPay, s.body.balance], ['pending', 2000, false, 2000]);
});

test('duplicates and bad requests: one open per booking, the same key answers again, amount 1…balance, proofs required, only confirmed bookings', async () => {
  const { w, token } = await owing();
  const key = w.key('pr');
  const first = await request(w, token, { requestKey: key, amount: 500, proofs: [await proof(w, token)] });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const again = await request(w, token, { requestKey: key, amount: 500, proofs: [await proof(w, token)] });
  assert.deepEqual(again.body.request, { status: 'pending', amount: 500 }, 'a resend: the same answer');
  const second = await request(w, token, { amount: 300, proofs: [await proof(w, token)] });
  assert.deepEqual([second.status, second.body.code], [409, 'conflict'], 'one open request per booking');
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM payment_claims').first()).n, 1);

  const w2 = (await owing()).w;
  const t2 = (await w2.db.prepare('SELECT id FROM bookings').first()) && (await owing());
  const bad = async over => (await request(t2.w, t2.token, over)).body;
  assert.equal((await bad({ amount: 2001, proofs: [await proof(t2.w, t2.token)] })).field, 'amount', 'over the balance');
  assert.equal((await bad({ amount: 0, proofs: [await proof(t2.w, t2.token)] })).field, 'amount');
  assert.equal((await bad({ proofs: [] })).field, 'proofs');
  assert.equal((await bad({ method: 'cash', proofs: [await proof(t2.w, t2.token)] })).field, 'method', 'cash is with the servant');
  assert.equal((await bad({ proofs: [{ proofId: 'prf-aaaaaaaa', claim: 'x' }] })).code, 'proof');

  const pending = await bookWorld();
  const pr = await pending.submit({ counts: { applicant: 1 } });
  const refused = await request(pending, pr.body.token, { amount: 100, proofs: [await proof(pending, pr.body.token).catch(() => ({ proofId: 'prf-aaaaaaaa', claim: 'x' }))] });
  assert.equal(refused.body.code, 'final', 'a pending booking has nothing to pay through here');
  assert.ok(w2);
});

test('withdraw: the participant takes the request back and can send another', async () => {
  const { w, token } = await owing();
  await request(w, token, { proofs: [await proof(w, token)] });
  const back = await w.pub('POST', '/v1/book/pay-request/withdraw', { token });
  assert.equal(back.body.withdrawn, true);
  const s = await status(w, token);
  assert.equal(s.body.request, null);
  assert.equal(s.body.canPay, true);
  const again = await request(w, token, { amount: 1500, proofs: [await proof(w, token)] });
  assert.equal(again.status, 200, JSON.stringify(again.body));
});

test('admin accept: «إضافة دفعة» with the claim → the payment (with the screenshots) and the request accepted in one go; never twice', async () => {
  const { w, id, token } = await owing();
  const p = await proof(w, token);
  await request(w, token, { proofs: [p] });
  let d = await w.admin('GET', '/v1/admin/book/bookings/' + id);
  const claim = d.body.claims[0];
  assert.deepEqual([claim.status, claim.amount, claim.method, claim.proofIds], ['pending', 2000, 'instapay', [p.proofId]]);
  const list = await w.admin('GET', '/v1/admin/book/bookings?eventId=evt-alex01&claims=1');
  assert.deepEqual([list.body.rows.length, list.body.rows[0].claim, list.body.counts.claims], [1, 2000, 1], 'the «طلبات دفع» queue');

  const accept = await w.admin('POST', '/v1/admin/book/bookings/' + id + '/payments', pay({ amount: 2000, method: 'instapay', claimId: claim.id }));
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  const row = await w.db.prepare("SELECT id, amount, proof_ids FROM payments WHERE booking_id = ? AND amount = 2000").bind(id).first();
  assert.deepEqual(JSON.parse(row.proof_ids), [p.proofId], 'the claim\'s screenshots became this payment\'s proofs');
  assert.equal((await w.db.prepare('SELECT payment_id FROM proofs WHERE id = ?').bind(p.proofId).first()).payment_id, row.id);
  const c = await w.db.prepare('SELECT status, payment_id, decided_by FROM payment_claims WHERE id = ?').bind(claim.id).first();
  assert.deepEqual([c.status, c.payment_id, c.decided_by], ['accepted', row.id, A]);
  const s = await status(w, token);
  assert.deepEqual([s.body.balance, s.body.canPay, s.body.request.status], [0, false, 'accepted']);
  const twice = await w.admin('POST', '/v1/admin/book/bookings/' + id + '/payments', pay({ amount: 2000, method: 'instapay', claimId: claim.id }));
  assert.equal(twice.body.code, 'final');
  d = await w.admin('GET', '/v1/admin/book/bookings/' + id);
  assert.equal(d.body.claims[0].paymentId, row.id);
});

test('admin reject: a reason is required; the participant sees it and can try again', async () => {
  const { w, id, token } = await owing();
  await request(w, token, { proofs: [await proof(w, token)] });
  const claimId = (await w.db.prepare('SELECT id FROM payment_claims').first()).id;
  assert.equal((await w.admin('POST', '/v1/admin/book/claims/' + claimId + '/reject', {})).body.field, 'reason');
  const r = await w.admin('POST', '/v1/admin/book/claims/' + claimId + '/reject', { reason: 'الصورة مش واضحة' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = await status(w, token);
  assert.deepEqual([s.body.request.status, s.body.request.reason, s.body.canPay], ['rejected', 'الصورة مش واضحة', true]);
  assert.equal((await w.admin('POST', '/v1/admin/book/claims/' + claimId + '/reject', { reason: 'تاني' })).body.code, 'final');
  assert.equal((await w.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'payment.requestReject'").first()).n, 1);
  assert.ok(id);
});

test('permissions: accept and reject need bookings.approve + finance.manage when grants are enforced', async () => {
  const { w, id, token } = await owing();
  await request(w, token, { proofs: [await proof(w, token)] });
  const claimId = (await w.db.prepare('SELECT id FROM payment_claims').first()).id;
  await w.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES (?, 'أدمن', 'admin', 1, 0) ON CONFLICT(email) DO NOTHING").bind(A).run();
  await w.db.prepare("UPDATE settings SET value = '1' WHERE key = 'PERMS_ENFORCE'").run();
  await w.db.prepare("INSERT OR REPLACE INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, 'bookings.approve', 'all', 't', 0)").bind(A).run();
  assert.equal((await w.admin('POST', '/v1/admin/book/claims/' + claimId + '/reject', { reason: 'لا' })).status, 403);
  assert.equal((await w.admin('POST', '/v1/admin/book/bookings/' + id + '/payments', pay({ amount: 2000, method: 'instapay', claimId }))).status, 403);
  await w.db.prepare("INSERT OR REPLACE INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, 'finance.manage', 'all', 't', 0)").bind(A).run();
  assert.equal((await w.admin('POST', '/v1/admin/book/claims/' + claimId + '/reject', { reason: 'الصورة مش واضحة' })).status, 200);
});

test('after booking closed: the status token still opens the card and the upload for a participant who owes money (and nobody else)', async () => {
  const { w, token } = await owing();
  await approveDest(w);
  // the booking window closes (the event itself is still ahead)
  const closed = eventJson({ v: 'rev2' }, { opensAt: msStamp(Date.now() - 3 * DAY), closesAt: msStamp(Date.now() - DAY) });
  await saveRow(w.env, rowFromJson(closed, 'fixture'));
  const plain = await w.pub('POST', '/v1/book/proof?slug=alex-trip', w.jpeg(400, 300));
  assert.equal(plain.body.code, 'closed', 'a new visitor: closed');
  const p = await proof(w, token);
  const r = await request(w, token, { proofs: [p] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const card = await w.pub('POST', '/v1/book/pay', { slug: 'alex-trip', servantId: 'srv-aaaa1111', method: 'transfer', token });
  assert.equal(card.status, 200, JSON.stringify(card.body));
  const noToken = await w.pub('POST', '/v1/book/pay', { slug: 'alex-trip', servantId: 'srv-aaaa1111', method: 'transfer' });
  assert.equal(noToken.body.code, 'closed');
});
