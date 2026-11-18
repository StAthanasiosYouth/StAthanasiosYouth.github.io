// «خبزنا اليومي» W5: the page's pure rules (assets/js/bread/model.js) and the site wiring that has no browser in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as page from '../assets/js/bread/model.js';
import * as server from '../worker/src/bread/model.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('the page\'s order is the Worker\'s (and so the prototype\'s), seed by seed', () => {
  for (const seed of ['k-7f3a91', 'dev-abc123', 'shot-000e', 'x'.repeat(40), 'ميناء']) {
    for (const prog of ['brd-0123456789', 'brd-42dd4a3499']) {
      for (const n of [1, 2, 7, 30, 120]) assert.deepEqual(page.orderFor(seed, prog, n), server.orderFor(seed, prog, n));
    }
  }
  assert.deepEqual(page.orderFor('k-7f3a91', 'prg-bread-of-life', 7), [1, 3, 0, 2, 5, 4, 6], 'the pinned prototype order');
});

test('Cairo days: the same day as the Worker, around midnight and the summer clock change', () => {
  for (const t of [Date.UTC(2026, 10, 17, 21, 59), Date.UTC(2026, 10, 17, 22, 1), Date.UTC(2026, 3, 24, 21, 30), Date.UTC(2026, 9, 29, 21, 30), Date.now()]) {
    assert.equal(page.cairoDay(t), server.cairoDay(t), new Date(t).toISOString());
  }
});

test('the index: the live program, the next one; the day, n, and a late joiner\'s own count', () => {
  const index = { schema: 1, programs: [
    { id: 'brd-0123456789', name: 'سلسلة «خبز الحياة»', days: 30, startsOn: '2026-11-13', endsOn: '2026-12-12' },
    { id: 'brd-abcdef0123', name: 'التالي', days: 10, startsOn: '2026-12-13', endsOn: '2026-12-22' },
    { id: 'bad', name: 'x', days: 3, startsOn: '2026-11-01', endsOn: '2026-11-03' }
  ] };
  const { live, next } = page.programsOn(index, '2026-11-17');
  assert.equal(live.id, 'brd-0123456789');
  assert.equal(next.id, 'brd-abcdef0123');
  const on = page.dayOf(live, '2026-11-17', 'shot-000e', '2026-11-13');
  assert.deepEqual({ d: on.d, late: on.late, dayNo: on.dayNo, ofDays: on.ofDays }, { d: 4, late: false, dayNo: 5, ofDays: 30 });
  assert.equal(on.n, server.orderFor('shot-000e', live.id, 30)[4] + 1, 'the same n as the Worker\'s topicFor');
  assert.equal(on.n, server.topicFor('shot-000e', { ...live, status: 'scheduled', starts_on: live.startsOn, ends_on: live.endsOn }, '2026-11-17').n);
  // joined 11 days after the start: «اليوم ١ من ١٩», the global d kept (the same topic as the server)
  const lateP = { ...live, startsOn: '2026-11-06', endsOn: '2026-12-05' };
  const late = page.dayOf(lateP, '2026-11-17', 's1234567', '2026-11-17');
  assert.deepEqual({ d: late.d, late: late.late, dayNo: late.dayNo, ofDays: late.ofDays, firstDay: late.firstDay, lateBy: late.lateBy }, { d: 11, late: true, dayNo: 1, ofDays: 19, firstDay: true, lateBy: 11 });
  assert.equal(page.dayOf(lateP, '2026-11-19', 's1234567', '2026-11-17').dayNo, 3);
  assert.equal(page.dayOf(live, '2026-12-13', 's1234567'), null, 'after the end');
  assert.deepEqual(page.programsOn({ programs: [] }, '2026-11-17'), { live: null, next: null, last: null });
});

test('words: dates, clocks, the program\'s bare name, m:ss, a device id', () => {
  assert.equal(page.dateText('2026-11-17'), 'التلات ١٧ نوفمبر');
  assert.deepEqual(page.clock('08:00'), ['٨:٠٠', 'ص']);
  assert.deepEqual(page.clock('22:30'), ['١٠:٣٠', 'م']);
  assert.equal(page.bareName('سلسلة «خبز الحياة»'), 'خبز الحياة');
  assert.equal(page.mmss(14 * 60000 + 20000), '١٤:٢٠');
  const s = page.newSeed();
  assert.match(s, page.SEED);
  assert.notEqual(s, page.newSeed());
});

test('a day file is taken only for its own program and day, and only with its parts', () => {
  const t = { program: 'brd-0123456789', n: 4, title: 'ت', verseRef: 'يو ٦: ٣٥', verse: 'آية', readingRef: 'يو ٦', reading: [{ book: 'يوحنا', chapter: 6, verses: [[35, 'نص']] }], meditation: 'تأمل' };
  assert.equal(page.cleanTopic(t, 'brd-0123456789', 4).title, 'ت');
  assert.equal(page.cleanTopic(t, 'brd-0123456789', 5), null, 'another day');
  assert.equal(page.cleanTopic({ ...t, reading: [] }, 'brd-0123456789', 4), null);
  assert.equal(page.cleanTopic(null, 'brd-0123456789', 4), null);
});

test('the site: «daily-bread» is reserved everywhere a page slug is checked', () => {
  for (const f of ['sw.js', 'assets/js/not-found.js', 'assets/js/page/model.js']) assert.match(read(f), /'daily-bread'/, f);
});

test('the page shell: noindex until the launch, the site\'s CSP, no inline style or script', () => {
  const html = read('daily-bread/index.html');
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(html, /script-src 'self'; style-src 'self'/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline script');
  assert.doesNotMatch(html, /\sstyle="/, 'no style attribute');
  // the page's own markup: no style attributes either (the CSP refuses them)
  for (const f of ['assets/js/bread/page.js', 'assets/js/bread/home-card.js']) assert.doesNotMatch(read(f), /\sstyle="/, f);
});

test('hidden while closed: the home card and the «المزيد» link wait for the section\'s gate', () => {
  assert.match(read('assets/js/home.js'), /bread\/home-card\.js/);
  assert.match(read('assets/js/bread/home-card.js'), /if \(!gate\.on/);
  assert.match(read('assets/js/nav.js'), /if \(bread\) pages\.push\(\{ title: 'خبزنا اليومي'/);
  assert.match(read('assets/js/bread/gate.js'), /code === 'disabled'/);
});
