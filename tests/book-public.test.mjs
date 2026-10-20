// Online booking, the public side (docs/EVENTS.md §6, §7.1, §9;
// worker/BOOKING-API.md): the pure parts. The API address (book-config.js),
// the live state's words, counts and totals, the phone check, the draft
// (7 days, never pictures), «حجوزاتي», the token from the fragment, the
// error codes → step / field / words, the status view, and the transport's
// retries (book-api.js with a fake fetch). Browser: tests/book-public.e2e.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const M = await import('../assets/js/page/model.js');
const B = await import('../assets/js/page/book-model.js');
const C = await import('../assets/js/page/book-config.js');
const { createBookApi } = await import('../assets/js/page/book-api.js');

const ROOT = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, ROOT), 'utf8');
const EVENT_RAW = JSON.parse(read('tests/fixtures/pages/event.json'));
const EVENT = M.sanitizeEvent({
  ...EVENT_RAW,
  booking: { ...EVENT_RAW.booking, online: true, methods: EVENT_RAW.booking.methods.map(m => ({ ...m, needsProof: m.key === 'instapay' })) }
});
const BOOKING = EVENT.booking;
const FREE = M.sanitizeEvent({
  ...EVENT_RAW,
  booking: { ...EVENT_RAW.booking, online: true, pricing: { mode: 'group', categories: EVENT_RAW.booking.pricing.categories.map(c => ({ ...c, price: 0 })) } }
}).booking;
const TOKEN = 'bk1.eyJiIjoiYmtnLWFiYyIsImUiOjF9.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
const NOW = Date.UTC(2026, 9, 13, 9);


/* =========================================================
   THE API ADDRESS
========================================================= */

test('book-config: the production Worker everywhere; ?api= / the stored key only on localhost', () => {
  assert.equal(C.BOOK_API_URL, 'https://athanasios-api.menazak-lab.workers.dev');
  const storage = value => ({ getItem: key => (key === 'athanasios.book.api' ? value : null) });
  const site = { hostname: 'abanoubzak.github.io', search: '?api=https://evil.example' };
  assert.equal(C.resolveApiUrl(site, storage('https://evil.example')), C.BOOK_API_URL, 'the real site ignores overrides');
  assert.equal(C.resolveApiUrl(null, null), C.BOOK_API_URL);
  const local = search => ({ hostname: 'localhost', search });
  assert.equal(C.resolveApiUrl(local('?api=https://athanasios-api-staging.menazak-lab.workers.dev/'), null), C.BOOK_API_STAGING_URL);
  assert.equal(C.resolveApiUrl({ hostname: '127.0.0.1', search: '?api=http://127.0.0.1:8787' }, null), 'http://127.0.0.1:8787');
  assert.equal(C.resolveApiUrl(local(''), storage('http://localhost:8787')), 'http://localhost:8787');
  for (const bad of ['http://evil.example', 'javascript:alert(1)', 'https://u:p@x.example', 'https://x.example/?a=1', 'ftp://x.example']) {
    assert.equal(C.resolveApiUrl(local(`?api=${encodeURIComponent(bad)}`), null), C.BOOK_API_URL, bad);
  }
  assert.equal(C.resolveApiUrl(local(''), { getItem() { throw new Error('blocked'); } }), C.BOOK_API_URL, 'blocked storage');
});


/* =========================================================
   THE LIVE STATE
========================================================= */

test('live state: open (+ «فاضل N مكان»), not open (+ the date), closed, full; anything else → the WhatsApp display', () => {
  let s = B.liveState({ ok: true, open: true, left: 12, revision: 'r1', opensAt: '', closesAt: '' }, BOOKING);
  assert.deepEqual([s.live, s.chip, s.line, s.left, s.revision], ['open', 'الحجز مفتوح', 'فاضل ١٢ مكان', 12, 'r1']);
  assert.equal(B.liveState({ ok: true, open: true, left: null }).line, '', 'no number when the Worker hides it');
  assert.equal(B.liveState({ ok: true, open: true, left: 0 }).live, 'full');
  s = B.liveState({ ok: true, open: false, reason: 'not_open', opensAt: '2026-10-10T19:00', left: null }, BOOKING);
  assert.deepEqual([s.live, s.chip, s.line], ['not_open', 'لسه ما فتحش', 'الحجز يفتح السبت ١٠ أكتوبر الساعة ٧ بالليل']);
  assert.equal(B.liveState({ ok: true, open: false, reason: 'not_open', opensAt: 'x' }, BOOKING).opensAt, '2026-10-10T19:00', 'the published date when the reply has none');
  assert.deepEqual(['closed', 'full'].map(reason => B.liveState({ ok: true, open: false, reason }).chip), ['الحجز اتقفل', 'اكتمل العدد']);
  for (const reply of [null, { ok: false, code: 'disabled' }, { ok: false, code: 'network' }, { ok: true, open: false, reason: 'disabled' }, { ok: true }, { ok: true, open: 'yes' }]) {
    assert.equal(B.liveState(reply, BOOKING).live, 'fallback', JSON.stringify(reply));
  }
  assert.deepEqual([1, 2, 3, 10, 11, 0, -1, 1.5].map(B.leftText), ['فاضل مكان واحد', 'فاضل مكانين', 'فاضل ٣ أماكن', 'فاضل ١٠ أماكن', 'فاضل ١١ مكان', '', '', '']);
});


/* =========================================================
   COUNTS, TOTALS, STEPS
========================================================= */

test('counts and totals: the category limits, seats per booking, the total in the site\'s money words', () => {
  let counts = M.startCounts(BOOKING);
  assert.deepEqual(counts, { applicant: 1, adult: 0, child: 0, infant: 0 });
  assert.equal(M.money(M.totalOf(BOOKING, counts)), '١٬٥٠٠ جنيه');
  counts = M.stepCount(BOOKING, counts, 'adult', +1);
  counts = M.stepCount(BOOKING, counts, 'child', +1);
  counts = M.stepCount(BOOKING, counts, 'infant', +1);
  assert.equal(M.totalOf(BOOKING, counts), 1500 + 1500 + 800);
  assert.equal(M.seatsOf(BOOKING, counts), 3, 'an infant takes no seat');
  assert.equal(B.peopleCount(BOOKING, counts), 4);
  assert.deepEqual(B.peopleOf(BOOKING, counts), { adult: 2, child: 2, companion: 0, total: 4 });
  // perBookingMax 6: three more seats fit, a fourth doesn't
  for (let i = 0; i < 3; i++) counts = M.stepCount(BOOKING, counts, 'adult', +1);
  assert.equal(M.seatsOf(BOOKING, counts), 6);
  assert.equal(M.canStep(BOOKING, counts, 'adult', +1), false);
  assert.equal(M.canStep(BOOKING, counts, 'infant', +1), true, 'no seat, still allowed');
  // a stored draft's counts come back inside the limits
  assert.deepEqual(B.cleanCounts(BOOKING, { applicant: 3, adult: -2, child: 2.5, infant: 9, bogus: 4 }), { applicant: 1, adult: 0, child: 0, infant: 4 });
  assert.deepEqual(B.cleanCounts(BOOKING, { adult: 6, child: 6 }), M.startCounts(BOOKING), 'over the seats: back to the minimum');
  // the steps: a free event skips the servant/method step
  assert.deepEqual(B.stepsFor(BOOKING), ['a', 'b', 'c']);
  assert.equal(B.isFree(FREE), true);
  assert.deepEqual(B.stepsFor(FREE), ['a', 'c']);
});

test('step checks: name, an Egyptian mobile (gently, any format), seats vs places left, names; servant + method; proofs + terms', () => {
  for (const [input, out] of [['01012345678', '+201012345678'], ['٠١٠١٢٣٤٥٦٧٨', '+201012345678'], ['+20 101 234 5678', '+201012345678'], ['00201112345678', '+201112345678'], ['201512345678', '+201512345678'], ['1012345678', '+201012345678'], ['0101-234-5678', '+201012345678']]) {
    assert.equal(B.normPhone(input), out, input);
  }
  for (const bad of ['', '0123', '01312345678', '+9661012345678', 'abc', '010123456789']) assert.equal(B.normPhone(bad), '', bad);

  const counts = { applicant: 1, adult: 2, child: 0, infant: 0 };
  assert.deepEqual(B.checkWho(BOOKING, { name: 'مينا', phone: '01012345678', counts }), {});
  assert.deepEqual(Object.keys(B.checkWho(BOOKING, { name: 'م', phone: '012', counts })), ['name', 'phone']);
  assert.match(B.checkWho(BOOKING, { name: 'مينا', phone: '01012345678', counts }, 2).counts, /فاضل مكانين بس/);
  assert.equal(B.checkWho(BOOKING, { name: 'مينا', phone: '01012345678', counts }, 3).counts, undefined);
  const named = { ...BOOKING, collectNames: true };
  assert.ok(B.checkWho(named, { name: 'مينا', phone: '01012345678', counts, names: ['مينا', 'مرقس'] }).names);
  assert.deepEqual(B.checkWho(named, { name: 'مينا', phone: '01012345678', counts, names: ['مينا', 'مرقس', 'بيتر'] }), {});

  assert.ok(B.checkPay(BOOKING, { servantId: '', method: 'cash' }).servantId);
  // Phase 1: a servant with cash only can't be picked on the site (the «كاش مع الخادم» card), and cash is never a choice
  assert.ok(B.checkPay(BOOKING, { servantId: 'srv-marc0003', method: 'instapay' }).servantId, 'no online method with this servant');
  assert.match(B.checkPay(BOOKING, { servantId: 'srv-mina0001', method: 'cash' }).method, /مع الخادم نفسه/);
  assert.deepEqual(B.onlineMethodsOf(BOOKING, BOOKING.servants[0]), ['instapay']);
  assert.deepEqual(B.offlineServants(BOOKING).map(s => [s.id, s.offline]), [['srv-mina0001', ['cash']], ['srv-marc0003', ['cash']]]);
  assert.equal(B.methodOnline({ needsProof: false }), false);
  assert.equal(B.methodOnline({ needsProof: false, online: true }), true);
  assert.equal(B.payCopyText('+20 10 1234 5678'), '01012345678');
  assert.equal(B.payCopyText('‏٠١٠١٢٣٤٥٦٧٨'), '01012345678');
  assert.equal(B.payGrouped('01012345678'), '010 1234 5678');
  assert.match(B.cashMessage(EVENT, BOOKING.servants[0], { name: 'مرقس', counts: { applicant: 1 } }), /عايز أحجز في «.+» وأدفع كاش/);
  assert.deepEqual(B.checkPay(BOOKING, { servantId: 'srv-mina0001', method: 'instapay' }), {});

  assert.equal(B.needsProof(BOOKING, 'instapay'), true);
  assert.equal(B.needsProof(BOOKING, 'cash'), false);
  assert.ok(B.checkSend(BOOKING, { method: 'instapay', proofs: [], agreed: true }).proofs, 'instapay needs a picture');
  assert.deepEqual(B.checkSend(BOOKING, { method: 'cash', proofs: [], agreed: true }, 'الشروط'), {}, 'cash: optional');
  assert.ok(B.checkSend(BOOKING, { method: 'cash', proofs: [], agreed: false }, 'الشروط').agreed);
  assert.ok(B.checkSend(BOOKING, { method: 'cash', proofs: [], agreed: true, uploading: 1 }).proofs, 'wait for the uploads');
  assert.ok(B.checkSend(BOOKING, { method: 'cash', proofs: [{}, {}, {}, {}], agreed: true }).proofs);
  assert.deepEqual(B.checkSend(FREE, { method: '', proofs: [], agreed: true }), {}, 'a free event has no proofs');
});

test('the submit body and the WhatsApp text: server-shaped, no extras; a free event sends no servant/method/proofs', () => {
  const key = B.newRequestKey(new Uint8Array(20).map((_, i) => i * 7));
  assert.match(key, /^[A-Za-z0-9_.:-]{8,100}$/);
  const draft = {
    ...B.emptyDraft(BOOKING, key, NOW),
    fields: { name: '  مينا   عادل ', phone: '01012345678' },
    counts: { applicant: 1, adult: 1, child: 1, infant: 0 },
    servantId: 'srv-mina0001', method: 'instapay', note: 'هنركب من الكنيسة',
    proofs: [{ proofId: 'prf-abcdefgh', claim: 'c1' }]
  };
  assert.deepEqual(B.submitBody(EVENT, draft, { revision: 'r9' }), {
    slug: 'ain-sokhna-trip', requestKey: key, name: 'مينا عادل', phone: '01012345678',
    counts: { applicant: 1, adult: 1, child: 1, infant: 0 }, hp: '', revision: 'r9',
    note: 'هنركب من الكنيسة', servantId: 'srv-mina0001', method: 'instapay', proofs: [{ proofId: 'prf-abcdefgh', claim: 'c1' }],
    payPlan: 'full'
  });
  const free = B.submitBody({ ...EVENT, booking: FREE }, { ...draft, note: '' }, {});
  assert.deepEqual(Object.keys(free).sort(), ['counts', 'hp', 'name', 'phone', 'requestKey', 'revision', 'slug']);
  assert.equal(free.revision, EVENT.v, 'no state yet: the published version');

  const text = B.payMessage(EVENT, BOOKING.servants[0], { name: draft.fields.name, counts: draft.counts, method: 'instapay' });
  assert.equal(text, 'سلام يا مينا عادل، أنا مينا عادل وعايز أحجز في «رحلة العين السخنة».\n- الحاجز: ١\n- فرد إضافي: ١\n- طفل: ١\nالإجمالي: ٣٬٨٠٠ جنيه\nهدفع إنستاباي.');
  assert.doesNotMatch(text, /0101/, 'never the phone');
});


/* =========================================================
   THE DRAFT AND «حجوزاتي»
========================================================= */

test('draft: 7 days, the same step and requestKey back, everything checked; never picture bytes or «موافق»', () => {
  const draft = { ...B.emptyDraft(BOOKING, 'web.abcdefghij', NOW), step: 'b', fields: { name: 'مينا', phone: '010' }, servantId: 'srv-mina0001', method: 'cash', agreed: true, proofs: [{ proofId: 'prf-abcdefgh', claim: 'x', blob: 'BYTES', url: 'blob:x' }] };
  const stored = JSON.parse(JSON.stringify(B.storeDraft(draft, NOW)));
  assert.deepEqual(Object.keys(stored).sort(), ['counts', 'fields', 'method', 'names', 'note', 'pay', 'payAmount', 'payPlan', 'people', 'proofs', 'requestKey', 'savedAt', 'servantId', 'step'].sort());
  assert.deepEqual(stored.proofs, [{ proofId: 'prf-abcdefgh', claim: 'x' }]);
  assert.doesNotMatch(JSON.stringify(stored), /BYTES|blob:/);

  const back = B.readDraft(stored, BOOKING, NOW + 6 * 24 * 3600 * 1000);
  assert.equal(back.step, 'b');
  assert.equal(back.requestKey, 'web.abcdefghij');
  assert.equal(back.agreed, false, '«موافق» is asked again');
  assert.equal(B.readDraft(stored, BOOKING, NOW + 7 * 24 * 3600 * 1000 + 1), null, 'expired after 7 days');
  assert.equal(B.readDraft(stored, BOOKING, NOW - 2 * 24 * 3600 * 1000), null, 'from the future');
  assert.equal(B.readDraft({ ...stored, requestKey: 'short' }, BOOKING, NOW), null);
  assert.equal(B.readDraft('garbage', BOOKING, NOW), null);
  assert.equal(B.readDraft({ ...stored, step: 'b' }, FREE, NOW).step, 'a', 'a step this event doesn\'t have');
  assert.equal(B.readDraft({ ...stored, step: 'z' }, BOOKING, NOW).step, 'a');
  assert.deepEqual(B.readDraft({ ...stored, proofs: [{ proofId: 'nope', claim: 'x' }, { proofId: 'prf-abcdefgh', claim: 5 }, ...Array(5).fill({ proofId: 'prf-abcdefgh', claim: 'y' })] }, BOOKING, NOW).proofs.length, 3);
  assert.equal(B.draftKey('ain-sokhna-trip'), 'athanasios.book.v1:ain-sokhna-trip');
});

test('«حجوزاتي»: [{ slug, ref, token }], the newest first, no duplicates, ≤ 20; this event\'s only', () => {
  let list = [];
  for (let i = 0; i < 25; i++) list = B.addMine(list, { slug: i % 2 ? 'ain-sokhna-trip' : 'other', ref: `B-${String(10000 + i)}`, token: `${TOKEN}${i}` });
  assert.equal(list.length, 20);
  assert.equal(list[0].ref, 'B-10024');
  list = B.addMine(list, { slug: 'other', ref: 'B-10024', token: `${TOKEN}24` });
  assert.equal(list.filter(e => e.ref === 'B-10024').length, 1);
  assert.ok(B.mineFor(list, 'ain-sokhna-trip').every(e => e.slug === 'ain-sokhna-trip'));
  assert.equal(B.dropMine(list, `${TOKEN}24`).length, 19);
  assert.deepEqual(B.readMine([{ slug: 'x', ref: 'B-1', token: 'bad' }, null, 'x', { slug: 'ok-slug', ref: 'B-ABCDE', token: TOKEN, extra: 1 }]), [{ slug: 'ok-slug', ref: 'B-ABCDE', token: TOKEN }]);
  assert.equal(B.MINE_KEY, 'athanasios.bookings.v1');
});

test('the status link: the token only from #b/<token>, checked; the link is /events/<slug>/#b/<token>', () => {
  assert.equal(B.tokenFromHash(`#b/${TOKEN}`), TOKEN);
  assert.equal(B.tokenFromHash(`#b/${encodeURIComponent(TOKEN)}`), TOKEN);
  for (const bad of ['', '#b/', '#v/pm-1', `#b/${TOKEN}<x>`, '#b/bk2.a.b', `?t=${TOKEN}`, `#b/${TOKEN}/x`, '#b/%E0%A4%A']) assert.equal(B.tokenFromHash(bad), '', bad);
  assert.equal(B.statusHref(new URL('https://abanoubzak.github.io/athanasios-links/'), 'ain-sokhna-trip', TOKEN), `https://abanoubzak.github.io/athanasios-links/events/ain-sokhna-trip/#b/${TOKEN}`);
});


/* =========================================================
   ERRORS
========================================================= */

test('error codes → step, field, words, what to do (BOOKING-API.md)', () => {
  const e = reply => B.bookingError(reply);
  assert.deepEqual(['name', 'phone', 'counts', 'names', 'servantId', 'method', 'proofs', 'note'].map(field => [field, e({ ok: false, code: 'invalid', field }).step]),
    [['name', 'a'], ['phone', 'a'], ['counts', 'a'], ['names', 'a'], ['servantId', 'b'], ['method', 'b'], ['proofs', 'c'], ['note', 'c']]);
  assert.equal(e({ code: 'invalid', field: 'phone' }).action, 'field');
  assert.equal(e({ code: 'invalid', field: 'amount' }).action, 'stop', 'an admin field: no step');
  const full = e({ code: 'full', left: 2 });
  assert.deepEqual([full.action, full.step, full.field, full.left], ['field', 'a', 'counts', 2]);
  assert.match(full.message, /فاضل مكانين بس/);
  assert.match(e({ code: 'full', left: 0 }).message, /اكتمل العدد/);
  assert.equal(e({ code: 'limit' }).action, 'stop');
  assert.match(e({ code: 'limit' }).message, /طلبين/);
  assert.deepEqual([e({ code: 'not_open', opensAt: '2026-10-10T19:00' }).action, e({ code: 'not_open', opensAt: '2026-10-10T19:00' }).message], ['refresh', 'الحجز لسه ما فتحش. بيفتح السبت ١٠ أكتوبر الساعة ٧ بالليل.']);
  assert.equal(e({ code: 'closed' }).action, 'refresh');
  assert.equal(e({ code: 'disabled' }).action, 'fallback');
  assert.equal(e({ code: 'not_found' }).action, 'fallback');
  assert.deepEqual([e({ code: 'proof' }).step, e({ code: 'proof' }).field], ['c', 'proofs']);
  for (const code of ['network', 'busy', 'rate', 'error', 'weird']) assert.equal(e({ code }).action, 'retry', code);
  assert.equal(e(null).action, 'retry');
  assert.equal(e({ code: 'expired' }).action, 'stop');
});


/* =========================================================
   THE STATUS VIEW
========================================================= */

test('status view: words per status; the money only once confirmed; the reason when rejected / cancelled; cancel while pending', () => {
  const base = { ok: true, ref: 'B-7K2QX', event: { slug: 'ain-sokhna-trip', title: 'رحلة العين السخنة', startAt: '2026-10-24T06:00' }, firstName: 'مينا', people: { adult: 2, child: 1, companion: 0, total: 3 }, quotedTotal: 3800, createdAt: '2026-10-13T12:00' };
  let v = B.statusView({ ...base, status: 'pending' });
  assert.deepEqual([v.word, v.canWithdraw, v.rows], ['قيد المراجعة', true, [['الأفراد', '٣ أفراد: ٢ كبار، ١ طفل'], ['الإجمالي', '٣٬٨٠٠ جنيه']]]);
  v = B.statusView({ ...base, status: 'confirmed', amountDue: 3800, paid: 1000, balance: 2800, paymentStatus: 'partial', overdue: true, finalDueAt: '2026-10-20T23:00' });
  assert.deepEqual(v.rows, [['الأفراد', '٣ أفراد: ٢ كبار، ١ طفل'], ['المطلوب', '٣٬٨٠٠ جنيه'], ['اتدفع', '١٬٠٠٠ جنيه'], ['الباقي', '٢٬٨٠٠ جنيه'], ['آخر معاد للباقي', 'التلات ٢٠ أكتوبر الساعة ١١ بالليل']]);
  assert.equal(v.overdue, true);
  assert.equal(v.canWithdraw, false);
  v = B.statusView({ ...base, status: 'confirmed', amountDue: 0, paid: 0, balance: 0 });
  assert.deepEqual(v.rows.slice(1), [['المطلوب', 'مجانًا']]);
  v = B.statusView({ ...base, status: 'rejected', reason: 'الصورة مش واضحة', amountDue: 0 });
  assert.deepEqual([v.word, v.reason, v.rows.length], ['اترفض', 'الصورة مش واضحة', 1]);
  assert.equal(B.statusView({ ...base, status: 'cancelled', reason: 'اتلغت الرحلة' }).reason, 'اتلغت الرحلة');
  assert.equal(B.statusView({ ...base, status: 'withdrawn', reason: 'x' }).reason, '', 'no reason for the visitor\'s own cancel');
  assert.equal(B.statusView({ ...base, ref: 'nope', status: 'pending' }), null);
  assert.equal(B.statusView({ ok: false, code: 'expired' }), null);
  assert.equal(B.peopleText({ adult: 1, child: 0, companion: 0, total: 1 }), 'فرد واحد');
  assert.equal(B.peopleText({ adult: 1, child: 0, companion: 1, total: 2 }), 'فردين: ١ كبير، ١ مرافق');
});


/* =========================================================
   TRANSPORT
========================================================= */

function fakeFetch(script) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step === 'throw') throw new TypeError('Failed to fetch');
    return { status: step.status, json: async () => { if (step.body === undefined) throw new Error('no json'); return step.body; } };
  };
  return { impl, calls };
}

test('transport: the envelope; network, 5xx and busy tried again with the same body; never a cookie or a referrer', async () => {
  const sleep = async () => {};
  let f = fakeFetch([{ status: 200, body: { ok: true, open: true, left: 3 } }]);
  let api = createBookApi({ base: 'https://api.example/', fetchImpl: f.impl, sleep });
  assert.deepEqual(await api.state('ain-sokhna-trip'), { ok: true, open: true, left: 3, httpStatus: 200 });
  assert.equal(f.calls[0].url, 'https://api.example/v1/book/state?slug=ain-sokhna-trip');
  assert.deepEqual([f.calls[0].init.method, f.calls[0].init.credentials, f.calls[0].init.referrerPolicy], ['GET', 'omit', 'no-referrer']);

  f = fakeFetch(['throw', { status: 503 }, { status: 200, body: { ok: true, ref: 'B-AAAAA', token: TOKEN, status: 'pending' } }]);
  api = createBookApi({ base: 'https://api.example', fetchImpl: f.impl, sleep });
  const reply = await api.submit({ requestKey: 'web.same', slug: 's' });
  assert.equal(reply.ok, true);
  assert.equal(reply.status, 'pending', 'the booking\'s own status is kept');
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(c => c.init.body === JSON.stringify({ requestKey: 'web.same', slug: 's' })), 'the same requestKey every time');
  assert.equal(f.calls[0].init.headers['Content-Type'], 'application/json');

  f = fakeFetch([{ status: 409, body: { ok: false, code: 'busy' } }, { status: 409, body: { ok: false, code: 'full', left: 2, message: 'x' } }]);
  api = createBookApi({ base: 'https://api.example', fetchImpl: f.impl, sleep });
  assert.deepEqual(await api.submit({}), { ok: false, code: 'full', left: 2, message: 'x', httpStatus: 409 });

  f = fakeFetch(['throw']);
  api = createBookApi({ base: 'https://api.example', fetchImpl: f.impl, sleep });
  assert.deepEqual(await api.status(TOKEN), { ok: false, code: 'network', httpStatus: 0 });
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].url, 'https://api.example/v1/book/status', 'the token in the body, never the address');

  f = fakeFetch([{ status: 429, body: { ok: false, code: 'rate' } }]);
  api = createBookApi({ base: 'https://api.example', fetchImpl: f.impl, sleep });
  assert.equal((await api.withdraw(TOKEN, 'web.k')).code, 'rate');
  assert.equal(f.calls.length, 1, 'rate is not hammered');

  f = fakeFetch([{ status: 200, body: { ok: true, proofId: 'prf-abcdefgh', claim: 'c' } }]);
  api = createBookApi({ base: 'https://api.example', fetchImpl: f.impl, sleep });
  const blob = { type: 'image/webp', size: 10 };
  await api.proof('ain-sokhna-trip', blob);
  assert.equal(f.calls[0].url, 'https://api.example/v1/book/proof?slug=ain-sokhna-trip');
  assert.equal(f.calls[0].init.body, blob, 'the raw picture');
  assert.equal(f.calls[0].init.headers['Content-Type'], 'image/webp');
});


/* =========================================================
   THE CODE
========================================================= */

test('booking modules: text only; storage only in book-store.js and always inside try; loaded only for an online event', () => {
  const code = file => read(`assets/js/page/${file}`);
  for (const file of ['booking.js', 'status.js', 'book-model.js', 'book-api.js', 'book-store.js', 'book-config.js', 'image.js', 'turnstile.js']) {
    assert.doesNotMatch(code(file), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, file);
  }
  for (const file of ['booking.js', 'status.js', 'book-model.js', 'book-api.js', 'image.js', 'main.js', 'view.js', 'model.js']) {
    assert.doesNotMatch(code(file), /localStorage\.|sessionStorage|indexedDB/, file);
  }
  const lines = code('book-store.js').split('\n');
  for (const [i, text] of lines.entries()) {
    if (/\bs\.(getItem|setItem|removeItem)|localStorage/.test(text) && !/^\s*(\*|\/\/)/.test(text)) {
      assert.match(lines.slice(Math.max(0, i - 5), i + 1).join(' '), /try \{/, `book-store.js line ${i + 1}: inside try`);
    }
  }
  // main.js: the booking modules come only by import() for booking.online, never in the preview's network
  const main = code('main.js');
  assert.doesNotMatch(main, /^import [^;]*from '\.\/(booking|status|image|book-[a-z]+)\.js'/m, 'not loaded for every page');
  assert.match(main, /if \(!data\.booking \|\| !data\.booking\.online\) return;/);
  assert.match(main, /import\('\.\/booking\.js'\)/);
  // the token: in the fragment only (never a query string), no referrer on API calls
  assert.match(code('book-api.js'), /referrerPolicy: 'no-referrer'/);
  assert.match(code('book-api.js'), /credentials: 'omit'/);
  assert.doesNotMatch(code('booking.js') + code('status.js'), /[?&](token|phone|name)=/);
});


/* =========================================================
   TURNSTILE (worker/BOOKING-API.md «Turnstile»)
========================================================= */

test('turnstile: the site key from the state (checked), required before the send, sent once, its error → the send step', () => {
  assert.equal(B.liveState({ ok: true, open: true, left: 3, turnstile: '0x4AAAAAAA-good_key' }).turnstile, '0x4AAAAAAA-good_key');
  for (const bad of [undefined, '', 'short', '<script>', 5, 'x'.repeat(81)]) {
    assert.equal(B.liveState({ ok: true, open: true, left: 3, turnstile: bad }).turnstile, '', String(bad));
  }
  const base = { method: 'cash', proofs: [], agreed: true };
  assert.deepEqual(B.checkSend(BOOKING, base), {}, 'no check asked: nothing to wait for');
  assert.equal(B.checkSend(BOOKING, { ...base, captcha: { required: true, token: '' } }).turnstile, 'استنى علامة التأكيد تخلص، أو اضغط عليها.');
  assert.deepEqual(B.checkSend(BOOKING, { ...base, captcha: { required: true, token: 'tok' } }), {});

  const draft = { ...B.emptyDraft(BOOKING, 'web.abcdefgh12', NOW), fields: { name: 'مينا', phone: '01012345678' }, counts: { applicant: 1 }, servantId: 'srv-mina0001', method: 'cash' };
  assert.equal(B.submitBody(EVENT, draft, { turnstile: 'tok-1' }).turnstile, 'tok-1');
  assert.equal('turnstile' in B.submitBody(EVENT, draft, {}), false, 'no token: no field');

  const e = B.bookingError({ ok: false, code: 'turnstile', reasons: ['timeout-or-duplicate'] });
  assert.deepEqual([e.action, e.step, e.field], ['field', 'c', 'turnstile']);
  assert.match(e.message, /روبوت/);
});

test('turnstile.js: one script from challenges.cloudflare.com, explicit render with the site key, tokens in and out, reset, remove', async () => {
  const T = await import('../assets/js/page/turnstile.js');
  const added = [];
  const listeners = {};
  const doc = {
    head: { appendChild: el => { added.push(el); setTimeout(() => { win.turnstile = fake; listeners.load(); }, 0); } },
    createElement: () => ({ addEventListener: (type, fn) => { listeners[type] = fn; } })
  };
  const calls = [];
  let options = null;
  const fake = {
    render: (box, o) => { options = o; calls.push(['render', box]); return 'w1'; },
    reset: id => calls.push(['reset', id]),
    remove: id => calls.push(['remove', id])
  };
  const win = {};
  const seen = [];
  const box = { id: 'bk-turnstile' };
  const handle = T.mountTurnstile(box, '0x4AAAAAAAkey', { doc, win, onChange: t => seen.push(t) });
  await handle.ready;
  assert.equal(added.length, 1);
  assert.equal(added[0].src, 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  assert.equal(options.sitekey, '0x4AAAAAAAkey');
  assert.equal(options.action, 'book');
  assert.equal(options.language, 'ar');
  options.callback('tok-1');
  assert.equal(handle.token(), 'tok-1');
  options['expired-callback']();
  assert.equal(handle.token(), '');
  options.callback('tok-2');
  handle.reset();
  assert.equal(handle.token(), '', 'a reset forgets the used token');
  handle.remove();
  assert.deepEqual(calls.map(c => c[0]), ['render', 'reset', 'remove']);
  assert.deepEqual(seen, ['tok-1', '', 'tok-2', '']);
  // a second widget reuses the loaded script
  await T.mountTurnstile(box, '0x4AAAAAAAkey', { doc, win }).ready;
  assert.equal(added.length, 1);

  // blocked script → onChange('') + onError, no throw
  const blockedDoc = { head: { appendChild: () => setTimeout(() => blockedListeners.error(), 0) }, createElement: () => ({ addEventListener: (t, fn) => { blockedListeners[t] = fn; } }) };
  const blockedListeners = {};
  let errored = false;
  await T.mountTurnstile(box, '0x4AAAAAAAkey', { doc: blockedDoc, win: {}, onError: () => { errored = true; } }).ready;
  assert.equal(errored, true);
});

test('the event page shells allow Turnstile (script + frame) and nothing else from Cloudflare', () => {
  for (const file of ['pages/index.html', 'events/index.html']) {
    const policy = /Content-Security-Policy" content="([^"]+)"/.exec(read(file))[1];
    assert.ok(policy.includes("script-src 'self' https://challenges.cloudflare.com;"), file);
    assert.ok(policy.includes('frame-src https://www.google.com https://challenges.cloudflare.com;'), file);
    assert.equal(policy.match(/cloudflare/g).length, 2, file);
  }
});

test('«دفع كامل» / «دفع قسط»: only with installments; the installment is checked like the Worker', () => {
  const inst = { ...BOOKING, payment: { mode: 'installments', minFirst: 500, finalDueAt: '' } };
  assert.equal(B.partAllowed({ ...BOOKING, payment: { mode: 'full', minFirst: 0 } }, 2000), false);
  assert.equal(B.partAllowed(inst, 2000), true);
  assert.equal(B.minPart(inst, 2000), 500);
  assert.equal(B.minPart(inst, 300), 299, 'a minimum above the total never blocks an installment');
  assert.equal(B.partAmount('٧٥٠'), 750);
  assert.ok(Number.isNaN(B.partAmount('7a')));
  assert.match(B.partProblem(inst, 2000, '499'), /^أقل قسط/);
  assert.match(B.partProblem(inst, 2000, '2000'), /دفع كامل/);
  assert.equal(B.partProblem(inst, 2000, '750'), '');
});

test('personProblemAt: the first person with a missing name or age, and which box', () => {
  assert.equal(B.personProblemAt([{ name: 'مينا', age: '30' }]), null);
  assert.deepEqual(B.personProblemAt([{ name: 'مينا', age: '30' }, { name: 'م', age: '8' }]).index, 1);
  assert.equal(B.personProblemAt([{ name: 'مينا', age: '30' }, { name: 'م', age: '8' }]).part, 'name');
  assert.equal(B.personProblemAt([{ name: 'مينا', age: '' }]).part, 'age');
});
