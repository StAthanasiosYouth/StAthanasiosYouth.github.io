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
  assert.deepEqual(M.historyLines(me.history[0]), ['درجتك ٧/١٠', 'حصلت على ٧٠٠ نقطة']);
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

test('participant token: sessionStorage only, validated, failures harmless', () => {
  const data = new Map();
  const store = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  assert.equal(M.readToken(store), '');
  M.writeToken(store, 'pt1.eyJwIjoxfQ.sig');
  assert.equal(M.readToken(store), 'pt1.eyJwIjoxfQ.sig');
  assert.deepEqual([...data.keys()], ['athanasios.portal.v1']);
  M.clearToken(store);
  assert.equal(M.readToken(store), '');
  data.set('athanasios.portal.v1', '<script>');
  assert.equal(M.readToken(store), '', 'not a token');
  const hostile = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.equal(M.readToken(hostile), '');
  assert.equal(M.writeToken(hostile, 'pt1.a.b'), false);
  M.clearToken(hostile);
  assert.equal(M.readToken(null), '');
  const code = read('assets/js/comp/portal.js') + read('assets/js/comp/portal-model.js');
  assert.doesNotMatch(code, /localStorage/, 'never localStorage');
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|\beval\(/);
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
