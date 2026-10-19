// Public booking routes (src/book/public.js) on real SQLite + in-memory R2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWorld, eventJson, setModule } from './book-helpers.mjs';
import { msStamp } from '../src/book/model.js';

const DAY = 864e5;

test('state: open with places hidden above showLeftBelow; disabled when the module is off or the event is not online', async () => {
  const w = await bookWorld();
  const s = await w.pub('GET', '/v1/book/state?slug=alex-trip');
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.open, true);
  assert.equal(s.body.left, null, '10 left > showLeftBelow 5');
  assert.match(s.headers.get('cache-control'), /max-age=15/);
  await setModule(w, false);
  assert.equal((await w.pub('GET', '/v1/book/state?slug=alex-trip')).body.code, 'disabled');

  const off = await bookWorld({ event: eventJson({}, { online: false }) });
  assert.equal((await off.pub('GET', '/v1/book/state?slug=alex-trip')).body.reason, 'disabled');
  assert.equal((await off.submit()).body.code, 'disabled');
  assert.equal((await w.pub('GET', '/v1/book/state?slug=no-such')).status, 404);
});

test('submit → pending with ref + token; the same requestKey replays the same answer; nothing private in the reply', async () => {
  const w = await bookWorld();
  const body = { slug: 'alex-trip', requestKey: 'rq-same-000001', name: '  مينا   زكريا ', phone: '010 1234 5678', counts: { applicant: 1, adult: 1, child: 1 }, servantId: 'srv-aaaa1111', method: 'transfer', hp: '', revision: 'rev1' };
  const a = await w.pub('POST', '/v1/book/submit', body);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.match(a.body.ref, /^B-[0-9A-Z]{5}$/);
  assert.equal(a.body.status, 'pending');
  assert.equal(a.body.quotedTotal, 1500 + 1500 + 800, 'server price');
  assert.match(a.body.token, /^bk1\./);
  assert.ok(!JSON.stringify(a.body).includes('1012345678'), 'no phone in the reply');
  const b = await w.pub('POST', '/v1/book/submit', body);
  assert.equal(b.body.ref, a.body.ref);
  assert.equal(b.body.replay, true);
  assert.equal(b.body.token, a.body.token);
  const row = await w.db.prepare('SELECT name, phone, status, seats_requested, source FROM bookings').first();
  assert.deepEqual(row, { name: 'مينا زكريا', phone: '+201012345678', status: 'pending', seats_requested: 3, source: 'site' });
  const act = await w.db.prepare("SELECT actor, action, entity_title, changes FROM activity WHERE action = 'booking.new'").first();
  assert.equal(act.actor, 'visitor');
  assert.equal(act.entity_title, a.body.ref);
  assert.ok(!JSON.stringify(act).includes('1012345678') && !JSON.stringify(act).includes('مينا'), 'no name/phone in the audit row');
});

test('submit refusals: honeypot, fields, counts, servant/method, free events skip them, a changed price is flagged', async () => {
  const w = await bookWorld();
  assert.equal((await w.submit({ hp: 'bot' })).body.code, 'bad');
  for (const [over, field] of [[{ name: 'x' }, 'name'], [{ phone: '123' }, 'phone'], [{ counts: { applicant: 1, adult: 9 } }, 'counts'], [{ counts: { applicant: 1, dog: 1 } }, 'counts'],
    [{ servantId: 'srv-nobody00' }, 'servantId'], [{ servantId: 'srv-bbbb2222', method: 'instapay' }, 'method'], [{ method: 'instapay' }, 'proofs']]) {
    const r = await w.submit(over);
    assert.equal(r.body.code, 'invalid', JSON.stringify(over));
    assert.equal(r.body.field, field);
  }
  const changed = await w.submit({ revision: 'old-rev' });
  assert.equal(changed.body.priceChanged, true);

  const free = await bookWorld({ event: eventJson({}, { pricing: { mode: 'single', categories: [{ key: 'applicant', label: 'الحاجز', group: 'adult', price: 0, seat: true, min: 1, max: 1 }] } }) });
  const r = await free.submit({ counts: { applicant: 1 }, servantId: undefined, method: undefined });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.quotedTotal, 0);
});

test('window: not open yet (with opensAt) and closed', async () => {
  const now = Date.now();
  const early = await bookWorld({ event: eventJson({}, { opensAt: msStamp(now + DAY) }) });
  const r = await early.submit();
  assert.equal(r.body.code, 'not_open');
  assert.ok(r.body.opensAt);
  const late = await bookWorld({ event: eventJson({}, { closesAt: msStamp(now - 3600e3) }) });
  assert.equal((await late.submit()).body.code, 'closed');
});

test('places: pending never takes places; a request over what is left is full (with left)', async () => {
  const w = await bookWorld();
  for (let i = 0; i < 6; i++) assert.equal((await w.submit({ phone: '0101234500' + i, counts: { applicant: 1, adult: 2 } })).status, 200, 'pending: 18 seats asked of 10, all accepted');
  await w.db.prepare("UPDATE bookings SET status = 'confirmed', seats_actual = 3 WHERE id IN (SELECT id FROM bookings LIMIT 3)").run();   // 9 of 10 taken
  const full = await w.submit({ phone: '01099999999', counts: { applicant: 1, adult: 1 } });
  assert.equal(full.body.code, 'full');
  assert.equal(full.body.left, 1);
  assert.equal((await w.submit({ phone: '01099999999', counts: { applicant: 1 } })).status, 200, 'one place left: one person fits');
  const state = await w.pub('GET', '/v1/book/state?slug=alex-trip');
  assert.equal(state.body.reason, undefined);
  assert.equal(state.body.left, 1);
});

test('at most 2 pending per phone per event (the 3rd is limit); a withdrawn one frees a slot', async () => {
  const w = await bookWorld();
  const a = await w.submit({ phone: '01111111111' });
  await w.submit({ phone: '+201111111111' });
  const third = await w.submit({ phone: '00201111111111' });
  assert.equal(third.status, 429);
  assert.equal(third.body.code, 'limit');
  const wd = await w.pub('POST', '/v1/book/withdraw', { token: a.body.token, requestKey: 'wd-00000001' });
  assert.equal(wd.body.status, 'withdrawn');
  assert.equal((await w.submit({ phone: '01111111111' })).status, 200);
});

test('proofs: upload → claim; required for a needsProof method; a forged claim or someone else\'s proof is refused; attached proofs get the event retention', async () => {
  const w = await bookWorld();
  const up = await w.pub('POST', '/v1/book/proof?slug=alex-trip', w.jpeg(900, 600));
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.match(up.body.proofId, /^prf-[a-z2-7]{8}$/);
  const forged = await w.submit({ method: 'instapay', proofs: [{ proofId: up.body.proofId, claim: 'x'.repeat(32) }] });
  assert.equal(forged.body.code, 'proof');
  const ok = await w.submit({ method: 'instapay', proofs: [{ proofId: up.body.proofId, claim: up.body.claim }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const row = await w.db.prepare('SELECT booking_id, delete_after_ms FROM proofs WHERE id = ?').bind(up.body.proofId).first();
  assert.ok(row.booking_id && row.delete_after_ms > Date.now() + 60 * DAY, 'kept until the event end + 60 days');
  const again = await w.submit({ phone: '01222222222', method: 'instapay', proofs: [{ proofId: up.body.proofId, claim: up.body.claim }] });
  assert.equal(again.body.code, 'proof', 'a proof belongs to one booking');
  const png = new Uint8Array(64); png.set([0x89, 0x50, 0x4e, 0x47]);
  assert.equal((await w.pub('POST', '/v1/book/proof?slug=alex-trip', png)).body.code, 'proof');
});

test('status: the visitor view (first name, people, money once confirmed); tampered or expired tokens refused', async () => {
  const w = await bookWorld();
  const a = await w.submit({ counts: { applicant: 1, child: 2 } });
  const s = await w.pub('POST', '/v1/book/status', { token: a.body.token });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.firstName, 'مينا');
  assert.deepEqual(s.body.people, { adult: 1, child: 2, companion: 0, total: 3 });
  assert.equal(s.body.amountDue, undefined, 'no money while pending');
  assert.ok(!JSON.stringify(s.body).includes('1012345678') && !JSON.stringify(s.body).includes('زكريا'), 'no phone, no full name');
  const [p, body, sig] = a.body.token.split('.');
  const flipped = p + '.' + body + '.' + (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  assert.equal((await w.pub('POST', '/v1/book/status', { token: flipped })).body.code, 'expired');
  assert.equal((await w.pub('POST', '/v1/book/status', { token: 'bk1.zzz.yyy' })).body.code, 'expired');
});

test('withdraw: pending only; a confirmed booking is final; repeating is harmless', async () => {
  const w = await bookWorld();
  const a = await w.submit();
  assert.equal((await w.pub('POST', '/v1/book/withdraw', { token: a.body.token, requestKey: 'wd-00000002' })).body.status, 'withdrawn');
  assert.equal((await w.pub('POST', '/v1/book/withdraw', { token: a.body.token, requestKey: 'wd-00000002' })).body.status, 'withdrawn');
  const b = await w.submit({ phone: '01233333333' });
  await w.db.prepare("UPDATE bookings SET status = 'confirmed' WHERE ref = ?").bind(b.body.ref).run();
  assert.equal((await w.pub('POST', '/v1/book/withdraw', { token: b.body.token, requestKey: 'wd-00000003' })).body.code, 'final');
});

test('budgets: submit 10 a minute per IP', async () => {
  const w = await bookWorld();
  let last;
  for (let i = 0; i < 11; i++) last = await w.submit({ phone: '0100000000' + (i % 10), name: 'زائر ' + i }, '203.0.113.50');
  assert.equal(last.status, 429);
  assert.equal(last.body.code, 'rate');
});
