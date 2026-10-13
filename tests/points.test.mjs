// «نقاطي / المتجر» on the main page: content.json `points` (assets/js/content.js
// cleanPoints) and the widget's state (assets/js/points.js), pure.
// Browser behaviour: tests/points-widget.e2e.mjs. Contract: docs/COMPETITIONS.md §18.4.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// icons.js builds a <template> at import time
globalThis.document = { createElement: () => ({ content: {} }) };

const { sanitizeContent, cleanPoints } = await import('../assets/js/content.js');
const P = await import('../assets/js/points.js');
const { leftText } = await import('../assets/js/words.js');
const seed = JSON.parse(readFileSync(new URL('../content.json', import.meta.url), 'utf8'));

const SHOP = { on: true, mode: 'auto', opensAt: '2026-10-17T19:00', closesAt: '2026-10-22T20:00' };
const points = (shop = SHOP, season = null) => ({ url: 'points/', shop, season });


test('content.json points: sanitized; url must be points/; no points → null', () => {
  const without = { ...seed }; delete without.points;
  assert.equal(sanitizeContent(without).points, null, 'no points block: no widget (the live content.json may have one)');
  const c = sanitizeContent({ ...seed, points: { url: 'points/', shop: { on: true, mode: 'auto', opensAt: '2026-10-17T19:00', closesAt: '2026-10-22 20:00', extra: 1 }, season: { name: ' الموسم الأول ', startAt: '2026-09-01T00:00', endAt: 'soon' } } });
  assert.deepEqual(c.points, {
    url: 'points/',
    shop: { on: true, mode: 'auto', preview: false, opensAt: '2026-10-17T19:00', closesAt: '' },
    season: { name: 'الموسم الأول', startAt: '2026-09-01T00:00', endAt: '' }
  });
  for (const url of ['https://evil.example/', '/points/', 'points', 'javascript:alert(1)', '../points/', undefined]) {
    assert.equal(cleanPoints({ url, shop: null, season: null }), null, String(url));
  }
  assert.equal(cleanPoints(null), null);
  assert.equal(cleanPoints('points/'), null);
  assert.deepEqual(cleanPoints({ url: 'points/', shop: { on: 'yes', mode: 'sometimes' }, season: { name: '' } }), {
    url: 'points/', shop: { on: false, mode: 'auto', preview: false, opensAt: '', closesAt: '' }, season: null
  });
  assert.deepEqual(cleanPoints({ url: 'points/', shop: null, season: null }), { url: 'points/', shop: null, season: null });
});


test('notification target points → { kind: points }', () => {
  const c = sanitizeContent({ ...seed, notifications: [
    { id: 'notif-shop-open', type: 'general', title: 'المتجر فتح', publishAt: '2026-10-17T19:00', target: { kind: 'points' } },
    { id: 'n2', type: 'general', title: 'x', publishAt: '2026-10-17T19:00', target: { kind: 'points', url: 'https://evil.example/' } },
    { id: 'n3', type: 'general', title: 'y', publishAt: '2026-10-17T19:00', target: { kind: 'pointz' } }
  ] });
  assert.deepEqual(c.notifications.map(n => n.target), [{ kind: 'points' }, { kind: 'points' }, null]);
});


test('store state boundaries (auto): before open, at open, before close, at/after close', () => {
  const at = now => P.shopState(SHOP, now);
  assert.equal(at('2026-10-13T12:00'), 'scheduled');
  assert.equal(at('2026-10-17T18:59'), 'scheduled');
  assert.equal(at('2026-10-17T19:00'), 'open', 'opens exactly at opensAt');
  assert.equal(at('2026-10-22T19:59'), 'open');
  assert.equal(at('2026-10-22T20:00'), 'closed', 'closed from closesAt on');
  assert.equal(at('2026-11-01T00:00'), 'closed');
  // open-ended bounds
  assert.equal(P.shopState({ ...SHOP, opensAt: '' }, '2020-01-01T00:00'), 'open');
  assert.equal(P.shopState({ ...SHOP, closesAt: '' }, '2030-01-01T00:00'), 'open');
});


test('mode overrides the dates; off / null store → no store state', () => {
  assert.equal(P.shopState({ ...SHOP, mode: 'open' }, '2026-10-13T12:00'), 'open');
  assert.equal(P.shopState({ ...SHOP, mode: 'open' }, '2026-12-01T12:00'), 'open');
  assert.equal(P.shopState({ ...SHOP, mode: 'closed' }, '2026-10-18T12:00'), 'closed');
  assert.equal(P.shopState({ ...SHOP, on: false }, '2026-10-18T12:00'), '');
  assert.equal(P.shopState(null, '2026-10-18T12:00'), '');
});


test('widget words: scheduled with a countdown, open until, closed, no store', () => {
  let s = P.pointsWidgetState(points(), '2026-10-13T12:00');   // Tuesday
  assert.equal(s.state, 'scheduled');
  assert.equal(s.title, 'نقاطي والمتجر');
  assert.equal(s.headline, 'المتجر بيفتح السبت الساعة ٧ بالليل');
  assert.equal(s.detail, 'فاضل ٤ أيام');

  s = P.pointsWidgetState(points(), '2026-10-16T21:00');
  assert.equal(s.headline, 'المتجر بيفتح بكره الساعة ٧ بالليل');
  assert.equal(s.detail, 'فاضل ٢٢ ساعة');

  s = P.pointsWidgetState(points(), '2026-10-17T18:15');
  assert.equal(s.headline, 'المتجر بيفتح النهارده الساعة ٧ بالليل');
  assert.equal(s.detail, 'فاضل ٤٥ دقيقة');

  s = P.pointsWidgetState(points(), '2026-10-17T19:00');
  assert.equal(s.state, 'open');
  assert.equal(s.headline, 'المتجر مفتوح لحد الخميس الساعة ٨ بالليل');
  assert.equal(s.detail, 'اطلب جايزتك بنقاطك');

  s = P.pointsWidgetState(points(), '2026-10-22T17:00');
  assert.equal(s.headline, 'المتجر مفتوح لحد النهارده الساعة ٨ بالليل');
  assert.equal(s.detail, 'بيقفل بعد ٣ ساعات — اطلب جايزتك بنقاطك');

  s = P.pointsWidgetState(points(), '2026-10-22T20:00');
  assert.equal(s.state, 'closed');
  assert.equal(s.headline, 'المتجر مقفول — نقاطك محفوظة');

  // far away: the date too
  s = P.pointsWidgetState(points({ ...SHOP, opensAt: '2026-11-05T19:00', closesAt: '' }), '2026-10-13T12:00');
  assert.equal(s.headline, 'المتجر بيفتح الخميس ٥ نوفمبر الساعة ٧ بالليل');
  assert.equal(s.detail, 'فاضل ٢٣ يوم');

  // mode open: no "until" (the dates don't apply)
  s = P.pointsWidgetState(points({ ...SHOP, mode: 'open' }), '2026-10-13T12:00');
  assert.equal(s.headline, 'المتجر مفتوح دلوقتي');

  // no store: just «نقاطي»
  for (const shop of [null, { ...SHOP, on: false }]) {
    s = P.pointsWidgetState(points(shop), '2026-10-18T12:00');
    assert.equal(s.state, '');
    assert.equal(s.title, 'نقاطي');
    assert.equal(s.detail, '');
  }
  assert.equal(P.pointsWidgetState(null, '2026-10-18T12:00'), null);
});


test('season line only when 7 days or less are left (and not after the end)', () => {
  const season = { name: 'الموسم الأول', startAt: '2026-09-01T00:00', endAt: '2026-10-20T00:00' };
  const line = now => P.pointsWidgetState(points(null, season), now).season;
  assert.equal(line('2026-10-12T23:59'), '', 'more than 7 days');
  assert.equal(line('2026-10-13T00:00'), 'الموسم بيخلص بعد ٧ أيام');
  assert.equal(line('2026-10-17T00:00'), 'الموسم بيخلص بعد ٣ أيام');
  assert.equal(line('2026-10-19T21:00'), 'الموسم بيخلص بعد ٣ ساعات');
  assert.equal(line('2026-10-20T00:00'), '', 'over');
  assert.equal(P.pointsWidgetState(points(null, { ...season, endAt: '' }), '2026-10-19T00:00').season, '');
  // the key changes with the words (the page repaints on its tick)
  assert.notEqual(P.pointsWidgetState(points(null, season), '2026-10-17T00:00').key, P.pointsWidgetState(points(null, season), '2026-10-18T00:00').key);
});


test('countdown words (shared with the portal)', () => {
  assert.equal(leftText(4 * 1440 + 30), 'فاضل ٤ أيام');
  assert.equal(leftText(1440 + 6 * 60), 'فاضل يوم و٦ ساعات');
  assert.equal(leftText(2 * 1440), 'فاضل يومين');
  assert.equal(leftText(19 * 60 + 37), 'فاضل ١٩ ساعة');
  assert.equal(leftText(45), 'فاضل ٤٥ دقيقة');
  assert.equal(leftText(0), 'فاضل دقيقة');
});


test('§19.1 preview: manual mode, and auto with preview before opensAt', () => {
  assert.deepEqual(cleanPoints({ url: 'points/', shop: { on: true, mode: 'preview', preview: true } }).shop, { on: true, mode: 'preview', preview: true, opensAt: '', closesAt: '' });
  const auto = { ...SHOP, preview: true };
  assert.equal(P.shopState(auto, '2026-10-13T12:00'), 'preview');
  assert.equal(P.shopState(auto, '2026-10-17T18:59'), 'preview');
  assert.equal(P.shopState(auto, '2026-10-17T19:00'), 'open', 'ordering opens at opensAt');
  assert.equal(P.shopState(auto, '2026-10-22T20:00'), 'closed');
  assert.equal(P.shopState({ ...auto, opensAt: '' }, '2026-10-13T12:00'), 'open', 'no opening date: nothing to wait for');
  assert.equal(P.shopState({ ...SHOP, preview: false }, '2026-10-13T12:00'), 'scheduled');
  // manual preview ignores the dates
  assert.equal(P.shopState({ ...SHOP, mode: 'preview' }, '2026-10-19T12:00'), 'preview');
  assert.equal(P.shopState({ ...SHOP, mode: 'preview' }, '2026-12-01T12:00'), 'preview');

  let s = P.pointsWidgetState(points(auto), '2026-10-13T12:00');
  assert.deepEqual([s.state, s.headline, s.detail], ['preview', 'المتجر مفتوح للعرض — الطلب هيفتح السبت الساعة ٧ بالليل', 'فاضل ٤ أيام']);
  s = P.pointsWidgetState(points({ ...SHOP, mode: 'preview', opensAt: '' }), '2026-10-13T12:00');
  assert.deepEqual([s.state, s.headline, s.detail], ['preview', 'المتجر مفتوح للعرض — الطلب هيفتح قريب', 'اتفرج على الجوايز وجهّز نقاطك']);
  // a manual preview whose date passed: «قريب», not a date in the past
  s = P.pointsWidgetState(points({ ...SHOP, mode: 'preview' }), '2026-10-19T12:00');
  assert.equal(s.headline, 'المتجر مفتوح للعرض — الطلب هيفتح قريب');
});
