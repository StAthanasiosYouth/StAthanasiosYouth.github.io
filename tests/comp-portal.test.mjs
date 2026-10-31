// «نقاطي»: the portal's pure parts (assets/js/comp/portal-model.js) and the
// page shell. Browser behaviour: tests/comp-portal.e2e.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const M = await import('../assets/js/comp/portal-model.js');
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const IMG = { src: 'media/2026/img-af6b0c28.webp', thumb: 'media/2026/img-af6b0c28-480.webp', w: 1122, h: 1402, alt: '' };

const ME = {
  ok: true,
  participant: { name: 'مينا عادل', group: 'ثانوي' },
  features: { wallet: true, shop: true },
  balance: 1550,
  ledger: [{ amount: 700, kind: 'competition', note: '', compTitle: 'مسابقة يونان', createdAt: '2026-10-10 20:00' }, { amount: -300, kind: 'redeem', note: 'كتاب', compTitle: '', createdAt: '2026-10-11T09:00' }, { amount: 5, kind: 'hack' }],
  history: [
    { submissionId: 's-1', compId: 'cmp-1', title: 'مسابقة يونان', slug: 'quiz', submittedAt: '2026-10-10 20:00', status: 'graded', score: 7, maxScore: 10, pointsAwarded: 700, canReview: true },
    { id: 's-2', compId: 'cmp-2', title: 'مسابقة ٢', slug: 'BAD', submittedAt: '', status: 'pending_review', pending: 2, canReview: false },
    { compId: 'cmp-3', title: 'x', status: 'graded', canReview: true }
  ],
  redemptions: [{ id: 'r-1', itemName: 'كتاب', cost: 300, status: 'approved', requestedAt: '2026-10-11T09:00' }, { id: 'r-2', itemName: '', cost: 1, status: 'pending' }],
  shop: [
    { id: 'i-mug', name: 'كوباية', description: 'd', image: IMG, cost: 700, category: 'هدايا', available: 5, perPersonLeft: 2 },
    { id: 'i-book', name: 'كتاب', cost: 300, category: 'كتب', available: 0, perPersonLeft: null },
    { id: 'i-bad', name: 'x', cost: 0 },
    { id: 'i-evil', name: 'y', cost: 10, image: { ...IMG, src: 'https://evil.example/x.webp' } }
  ]
};

test('portalMe: sanitized; wallet/shop parts only with their features', () => {
  const me = M.sanitizeMe(ME);
  assert.deepEqual(me.participant, { name: 'مينا عادل', group: 'ثانوي' });
  assert.deepEqual(me.features, { wallet: true, shop: true });
  assert.equal(me.balance, 1550);
  assert.equal(me.ledger[0].createdAt, '2026-10-10T20:00');
  assert.equal(me.ledger[2].kind, 'manual', 'unknown kind → a neutral label');
  assert.deepEqual(me.history.map(h => [h.submissionId, h.canReview]), [['s-1', true], ['s-2', false], ['', false]], 'no id → no review button');
  assert.equal(me.history[1].slug, '');
  assert.deepEqual(me.redemptions.map(r => r.id), ['r-1']);
  assert.deepEqual(me.shop.map(i => i.id), ['i-mug', 'i-book', 'i-evil']);
  assert.equal(me.shop[2].image, null);

  const noWallet = M.sanitizeMe({ ...ME, features: { wallet: false, shop: true } });
  assert.equal(noWallet.balance, null);
  assert.deepEqual([noWallet.ledger, noWallet.shop], [[], []]);
  assert.equal(noWallet.features.shop, false, 'the store needs the wallet');
  assert.equal(noWallet.history.length, 3);
  assert.equal(M.sanitizeMe({ ok: true }), null);
  assert.equal(M.sanitizeMe({ participant: { name: '' } }), null);
});

test('labels: ledger kinds, requests, history', () => {
  assert.deepEqual(M.KIND_LABELS, { competition: 'مسابقة', correction: 'تعديل نتيجة', manual: 'تعديل من الخدام', redeem: 'جايزة', refund: 'استرجاع' });
  assert.deepEqual(M.REDEMPTION_LABELS, { pending: 'مستني', approved: 'جاهزة للاستلام', fulfilled: 'اتسلمت', cancelled: 'اتلغت (النقاط رجعت)' });
  assert.equal(M.formatAmount(700), '+٧٠٠');
  assert.equal(M.formatAmount(-300), '−٣٠٠');
  const me = M.sanitizeMe(ME);
  assert.deepEqual(M.historyLines(me.history[0]), ['جبت ٧ من ١٠', 'جمعت ٧٠٠ نقطة']);
  assert.deepEqual(M.historyLines(me.history[1]), ['مستني مراجعة']);
  assert.equal(M.dateText('2026-10-11T09:00'), 'الأحد ١١ أكتوبر الساعة ٩ الصبح');
});

test('store: groups, availability, the confirm sentence', () => {
  const me = M.sanitizeMe(ME);
  assert.deepEqual(M.groupShop(me.shop).map(g => [g.category, g.items.length]), [['هدايا', 1], ['كتب', 1], ['', 1]]);
  const mug = me.shop[0];
  assert.deepEqual(M.itemAvailability(mug, 1550), { canOrder: true, reason: '', label: 'اطلب', notes: ['فاضل ٥', 'تقدر تطلب ٢ كمان'] });
  assert.equal(M.itemAvailability(me.shop[1], 1550).label, 'خلصت');
  assert.equal(M.itemAvailability({ ...mug, perPersonLeft: 0 }, 1550).label, 'وصلت للحد المسموح');
  assert.equal(M.itemAvailability(mug, 500).reason, 'insufficient');
  assert.equal(M.itemAvailability({ ...mug, available: null, perPersonLeft: null }, 1550).notes.length, 0, 'unlimited says nothing');
  assert.deepEqual(M.redeemPreview(mug, 1550), { text: 'هيتخصم ٧٠٠ نقطة، رصيدك هيبقى ٨٥٠', enough: true });
  assert.equal(M.redeemPreview({ ...mug, cost: 5 }, 1550).text, 'هيتخصم ٥ نقط، رصيدك هيبقى ١٥٤٥');
  assert.equal(M.redeemPreview(mug, 100).enough, false);
});

test('redeem replies and errors; which failures keep the requestKey', () => {
  assert.deepEqual(M.sanitizeRedeem({ ok: true, redemption: { id: 'r-9', status: 'pending', itemName: 'كوباية', cost: 700 }, balance: 850 }), { redemption: { id: 'r-9', status: 'pending', itemName: 'كوباية', cost: 700 }, balance: 850 });
  assert.equal(M.sanitizeRedeem({ ok: true }), null);
  assert.equal(M.redeemError({ code: 'insufficient' }), 'رصيدك مش كفاية');
  assert.equal(M.redeemError({ code: 'stock' }), 'الجايزة دي خلصت');
  assert.equal(M.redeemError({ code: 'per_person' }), 'وصلت للحد المسموح من الجايزة دي');
  assert.equal(M.redeemError({ code: 'weird', message: 'رسالة' }), 'رسالة');
  assert.ok(M.KEEP_KEY.has('network') && M.KEEP_KEY.has('busy') && !M.KEEP_KEY.has('stock') && !M.KEEP_KEY.has('insufficient'));
});

test('points/index.html: the site CSP, no inline code, relative URLs; sw.js allows /points/', () => {
  const page = read('points/index.html');
  const csp = html => /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  assert.equal(csp(page), csp(read('index.html')));
  assert.doesNotMatch(page, /<script(?![^>]*\bsrc=)[^>]*>|<style|\sstyle="/);
  assert.match(page, /src="\.\.\/assets\/js\/comp\/portal\.js"/);
  for (const [, url] of page.matchAll(/\s(?:href|src)="([^"]+)"/g)) if (!url.startsWith('#')) assert.match(url, /^\.\.\//, url);
  const self = { location: new URL('https://x.github.io/sw.js'), addEventListener: (t, fn) => { self[t] = fn; }, registration: { showNotification: async (title, options) => { self.shown = options; } }, clients: {} };
  vm.runInNewContext(read('sw.js'), { self, URL, console });
  let wait;
  self.push({ data: { json: () => ({ data: { title: 'x', url: '/points/' } }) }, waitUntil: p => { wait = p; } });
  return wait.then(() => assert.equal(self.shown.data.url, '/points/'));
});


/* ---------- v2: store schedule, cancel, seasons (§18.3, §18.4) ---------- */

const V2 = {
  ...ME,
  store: { state: 'scheduled', opensAt: '2026-10-17T19:00', closesAt: '2026-10-22 20:00', allowCancel: true },
  season: { id: 'sea-2', name: 'موسم الخريف', startAt: '2026-10-01T00:00', endAt: '2026-12-31T23:59', earned: 900, maxTheoretical: 1200 },
  seasons: [
    { id: 'sea-first', name: 'الموسم الأول', startAt: '2026-06-01T00:00', endAt: '2026-09-30T23:59', final: 600, earned: 900, spent: 300 },
    { id: 'x', name: '' }
  ],
  redemptions: [
    { id: 'r-1', itemName: 'كتاب', cost: 300, status: 'pending', requestedAt: '2026-10-11T09:00', canCancel: true },
    { id: 'r-2', itemName: 'قلم', cost: 100, status: 'approved', canCancel: true },
    { id: 'r-3', itemName: 'كاب', cost: 150, status: 'pending', canCancel: 'yes' }
  ]
};

test('portalMe v2: store state, season, past seasons, canCancel', () => {
  const me = M.sanitizeMe(V2);
  assert.deepEqual(me.store, { state: 'scheduled', opensAt: '2026-10-17T19:00', closesAt: '2026-10-22T20:00', allowCancel: true });
  assert.equal(me.shop.length, 3, 'the prizes stay in `shop`');
  assert.deepEqual(me.season, { id: 'sea-2', name: 'موسم الخريف', startAt: '2026-10-01T00:00', endAt: '2026-12-31T23:59', earned: 900, maxTheoretical: 1200 });
  assert.deepEqual(me.seasons, [{ id: 'sea-first', name: 'الموسم الأول', startAt: '2026-06-01T00:00', endAt: '2026-09-30T23:59', final: 600, earned: 900, spent: 300 }]);
  assert.deepEqual(me.redemptions.map(r => r.canCancel), [true, false, false], 'only a pending request, only a real true');
  // v1 server (no store): open as before; unknown state → open; no wallet → no seasons
  assert.equal(M.sanitizeMe(ME).store.state, 'open');
  assert.equal(M.sanitizeMe({ ...V2, store: { state: 'party' } }).store.state, 'open');
  const off = M.sanitizeMe({ ...V2, features: { wallet: false, shop: false } });
  assert.deepEqual([off.store, off.season, off.seasons], [null, null, []]);
  assert.equal(M.sanitizeMe({ ...V2, season: { name: '', earned: 5 } }).season, null);
  assert.equal(M.sanitizeMe({ ...V2, season: { ...V2.season, maxTheoretical: -3 } }).season.maxTheoretical, 0);
});

test('season bar words and meter; past season line; dates', () => {
  const me = M.sanitizeMe(V2);
  assert.deepEqual(M.seasonProgress(me.season), { text: 'جمعت ٩٠٠ نقطة من أقصى ١٢٠٠', ratio: 0.75 });
  assert.deepEqual(M.seasonProgress({ ...me.season, maxTheoretical: 0 }), { text: 'جمعت ٩٠٠ نقطة في الموسم ده', ratio: null });
  assert.equal(M.seasonProgress({ ...me.season, earned: 1500 }).ratio, 1, 'clamped (manual points on top)');
  assert.equal(M.seasonProgress(null), null);
  assert.equal(M.seasonDates(me.season), 'من الخميس ١ أكتوبر لحد الخميس ٣١ ديسمبر');
  assert.equal(M.seasonDates({ startAt: '', endAt: '' }), '');
  assert.equal(M.pastSeasonLine(me.seasons[0]), 'جمعت ٩٠٠ · صرفت ٣٠٠ · آخر رصيد ٦٠٠');
});

test('store words: scheduled (countdown), open until, closed; due once the time passes', () => {
  const store = M.sanitizeStore(V2.store);
  assert.deepEqual(M.storeWords(store, '2026-10-15T19:00'), { headline: 'المتجر هيفتح يوم السبت ١٧ أكتوبر الساعة ٧ بالليل', countdown: 'فاضل يومين', due: false });
  assert.equal(M.storeWords(store, '2026-10-17T18:30').countdown, 'فاضل ٣٠ دقيقة');
  assert.equal(M.storeWords(store, '2026-10-17T19:00').due, true, 'past opensAt on this clock: ask the server');
  const open = { ...store, state: 'open' };
  assert.deepEqual(M.storeWords(open, '2026-10-18T12:00'), { headline: 'المتجر مفتوح لحد الخميس ٢٢ أكتوبر الساعة ٨ بالليل', countdown: '', due: false });
  assert.equal(M.storeWords(open, '2026-10-22T17:00').countdown, 'فاضل ٣ ساعات');
  assert.equal(M.storeWords(open, '2026-10-22T20:00').due, true);
  assert.deepEqual(M.storeWords({ ...open, closesAt: '' }, '2026-10-18T12:00'), { headline: '', countdown: '', due: false });
  assert.equal(M.storeWords({ ...store, state: 'closed' }, '2026-10-18T12:00').headline, 'المتجر مقفول دلوقتي — طلباتك محفوظة والخدام بيسلّموها');
  assert.equal(M.storeWords({ state: 'scheduled', opensAt: '', closesAt: '' }, '2026-10-18T12:00').headline, 'المتجر هيفتح قريب');
});

test('cancel: preview, reply → balance and status, refusals, store closed', () => {
  const me = M.sanitizeMe(V2);
  const r = me.redemptions[0];
  assert.equal(M.cancelPreview(r, 1550), 'هيرجعلك ٣٠٠ نقطة، رصيدك هيبقى ١٨٥٠');
  assert.equal(M.cancelPreview(r, null), 'هيرجعلك ٣٠٠ نقطة');
  const after = M.applyCancel(me, 'r-1', { ok: true, redemption: { id: 'r-1', status: 'cancelled', itemName: 'كتاب', cost: 300 }, balance: 1850 });
  assert.equal(after.balance, 1850);
  assert.deepEqual([after.redemptions[0].status, after.redemptions[0].canCancel], ['cancelled', false]);
  assert.equal(me.redemptions[0].status, 'pending', 'pure');
  assert.equal(M.applyCancel(me, 'r-1', { ok: true }).balance, 1550, 'no balance in the reply: unchanged');
  assert.equal(M.withoutCancel(me, 'r-1').redemptions[0].canCancel, false);
  const closed = M.storeClosed(me);
  assert.equal(closed.store.state, 'closed');
  assert.ok(closed.redemptions.every(x => !x.canCancel));
  assert.equal(M.cancelError({ code: 'shop_closed' }), 'المتجر قفل، مينفعش تلغي الطلب دلوقتي');
  assert.match(M.cancelError({ code: 'not_allowed' }), /مينفعش يتلغي/);
  assert.equal(M.cancelError({ code: 'not_found' }), 'الطلب ده مش موجود');
  assert.equal(M.redeemError({ code: 'shop_closed' }), 'المتجر قفل دلوقتي — طلباتك محفوظة');
});


/* ---------- §19.1 preview, §19.3 eligibility ---------- */

test('store preview: prizes on show, ordering later (with or without a date)', () => {
  const store = M.sanitizeStore({ state: 'preview', opensAt: '2026-10-17T19:00', closesAt: '' });
  assert.equal(store.state, 'preview');
  assert.deepEqual(M.storeWords(store, '2026-10-15T19:00'), { headline: 'المتجر مفتوح للعرض — الطلب هيفتح يوم السبت ١٧ أكتوبر الساعة ٧ بالليل', countdown: 'فاضل يومين', due: false });
  assert.deepEqual(M.storeWords({ ...store, opensAt: '' }, '2026-10-15T19:00'), { headline: 'المتجر مفتوح للعرض — الطلب هيفتح قريب', countdown: '', due: false });
  assert.equal(M.storeWords(store, '2026-10-17T19:00').due, true);
  assert.equal(M.storeWords(store, '2026-10-17T19:00').headline, 'المتجر مفتوح للعرض — الطلب هيفتح قريب');
});

test('portalMe eligible:false + notice; shopRedeem not_eligible uses the server message', () => {
  const me = M.sanitizeMe({ ...ME, eligible: false, notice: 'نأسف، سنك…' });
  assert.deepEqual([me.eligible, me.notice], [false, 'نأسف، سنك…']);
  assert.deepEqual([M.sanitizeMe(ME).eligible, M.sanitizeMe(ME).notice], [true, '']);
  assert.equal(M.redeemError({ code: 'not_eligible', message: 'سنك خارج الفئة' }), 'سنك خارج الفئة');
  assert.match(M.redeemError({ code: 'not_eligible' }), /^نأسف، سنك حاليًا خارج الفئة العمرية/);
});
