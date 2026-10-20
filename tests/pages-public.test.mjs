// Service pages and events, the public side (docs/EVENTS.md §17): the pure
// model (assets/js/page/model.js), the home page's hooks (content.js,
// items.js, layout.js, router.js, sw.js, main.js) and the two shells.
// Browser behaviour: tests/pages-public.e2e.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

// icons.js builds a <template> at import time
globalThis.document = { createElement: () => ({ content: {} }) };

const M = await import('../assets/js/page/model.js');
const { sanitizeContent } = await import('../assets/js/content.js');
const { entryButton, entryHref, competitionHref, partnerChip } = await import('../assets/js/items.js');
const { pageForHash, parseHash } = await import('../assets/js/router.js');
const { pageLayout } = await import('../assets/js/layout.js');

const ROOT = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, ROOT), 'utf8');
const json = path => JSON.parse(read(path));
const PAGE = json('tests/fixtures/pages/page.json');
const EVENT = json('tests/fixtures/pages/event.json');
// the published content.json as a base, without what admins publish of these features
// (so the tests don't change when a real page or event goes live)
const SEED = (({ pages, events, partners, ...rest }) => ({
  ...rest,
  activities: (rest.activities || []).filter(a => !a.page && !a.event),
  layout: Array.isArray(rest.layout) ? rest.layout.filter(s => s.key !== 'services') : rest.layout
}))(json('content.json'));
const IMG = { src: 'media/2026/img-ab12cd34.webp', thumb: 'media/2026/img-ab12cd34-480.webp', w: 1600, h: 900, alt: 'x' };
const clone = value => JSON.parse(JSON.stringify(value));


/* =========================================================
   SLUGS
========================================================= */

test('slugs: 2–40, a-z 0-9 and inner dashes; pages never take a reserved top-level name', () => {
  for (const good of ['ab', 'black-theatre', 'a1', 'x'.repeat(40), 'trip-2026']) assert.equal(M.eventSlug(good), good, good);
  for (const bad of ['a', '-ab', 'ab-', 'Black', 'a_b', 'x'.repeat(41), 'a/b', '', null, 7, '../x']) assert.equal(M.eventSlug(bad), '', String(bad));
  for (const name of M.PAGE_RESERVED) assert.equal(M.pageSlug(name), '', name);
  assert.equal(M.pageSlug('black-theatre'), 'black-theatre');
  assert.equal(M.eventSlug('events'), 'events', 'an event may be called anything (it lives under events/)');
  assert.equal(M.pageHref('black-theatre'), 'black-theatre/');
  assert.equal(M.pageHref('admin'), '');
  assert.equal(M.eventHref('ain-sokhna'), 'events/ain-sokhna/');
  assert.equal(M.eventHref('https://evil.example'), '');
  assert.ok(M.isEntryPath('/black-theatre/'));
  assert.ok(M.isEntryPath('/events/ain-sokhna/'));
  for (const bad of ['/admin/', '/events/', '/pages/', '/black-theatre', '/black-theatre/page.json', '/a/b/', '/events/a/b/', '/Black/', '/competition/']) assert.ok(!M.isEntryPath(bad), bad);
});


/* =========================================================
   page.json
========================================================= */

test('page.json: the fixture as published', () => {
  const p = M.sanitizePage(PAGE);
  assert.equal(p.slug, 'black-theatre');
  assert.equal(p.title, 'المسرح الأسود');
  assert.equal(p.theme, 'night');
  assert.equal(p.hero.type, 'video');
  assert.equal(p.hero.thumb, p.hero.poster);
  assert.equal(p.partner, null);
  assert.deepEqual(p.media.map(m => [m.id, m.source]), [['pm-clip0001', 'clip'], ['pm-clip0002', 'clip'], ['pm-link0003', 'link'], ['pm-clip0004', 'clip']]);
  assert.deepEqual([p.media[0].clip.start, p.media[0].clip.end], [1, 4]);
  assert.equal(p.media[2].clip, null);
  assert.equal(p.team.people.length, 2);
  assert.match(p.team.people[0].wa, /^https:\/\/wa\.me\/201001234567\?text=/);
  assert.match(p.description, /\n\n/, 'paragraphs kept');
});

test('page.json: every field validated (media paths, https, wa.me, limits, defaults)', () => {
  const raw = clone(PAGE);
  raw.title = `  ${'ط'.repeat(80)}  `;
  raw.theme = 'neon';
  raw.cover = { ...IMG, src: 'https://evil.example/x.webp' };
  raw.hero = { type: 'video', src: '../secret.mp4', poster: 'media/2026/vid-0e05ae88-480.webp', w: 1, h: 1 };
  raw.partner = { key: 'bug' };
  raw.media = [
    { ...raw.media[0], fullUrl: 'http://insecure.example/x' },
    { ...raw.media[1], clip: { ...raw.media[1].clip, src: 'media/2026/vid-zz.mp4' } },     // clip broken, no link: dropped
    { ...raw.media[2], fullUrl: 'javascript:alert(1)' },                                  // link card without a link: dropped
    { ...raw.media[0], id: 'pm-clip0001' },                                               // duplicate id: dropped
    { ...raw.media[3], cover: null },                                                     // no cover: dropped
    { ...raw.media[3], id: 'pm-x', source: 'clip', clip: null, fullUrl: 'https://example.org/full', ctaLabel: '' }  // a clip card without a clip but with a link: a link card
  ];
  raw.team = { title: '', text: '', people: [
    { name: 'أ', wa: 'https://evil.example/201001234567' },
    { name: 'ب', wa: 'https://wa.me/abc' },
    { name: 'ج', wa: 'https://wa.me/201001234567?x=1' },
    { name: '', wa: 'https://wa.me/201001234567' },
    ...Array.from({ length: 8 }, (_, i) => ({ name: `خادم ${i}`, wa: 'https://wa.me/201001234567' }))
  ] };
  const p = M.sanitizePage(raw);
  assert.equal(p.title.length, 60);
  assert.equal(p.theme, '');
  assert.equal(p.cover, null);
  assert.equal(p.hero, null);
  assert.equal(p.partner, null);
  assert.deepEqual(p.media.map(m => [m.id, m.source, m.fullUrl]), [['pm-clip0001', 'clip', null], ['pm-x', 'link', 'https://example.org/full']]);
  assert.equal(p.media[1].ctaLabel, 'شاهد المسرحية كاملة');
  assert.equal(p.team.title, 'عايز تنضم لفريق المسرح؟', 'the default title');
  assert.equal(p.team.people.length, 6);
  assert.deepEqual(p.team.people.slice(0, 3).map(x => x.wa), [null, null, null]);

  assert.equal(M.sanitizePage({ ...PAGE, slug: 'admin' }), null, 'a reserved slug');
  assert.equal(M.sanitizePage({ ...PAGE, title: '' }), null);
  assert.equal(M.sanitizePage({ ...PAGE, schema: 2 }), null);
  assert.equal(M.sanitizePage([]), null);
  assert.equal(M.sanitizePage(null), null);
  assert.equal(M.sanitizePage({ ...PAGE, media: Array.from({ length: 70 }, (_, i) => ({ ...PAGE.media[2], id: `pm-${i}` })) }).media.length, 60);
  assert.equal(M.sanitizePage({ ...PAGE, team: { people: [] } }).team, null, 'an empty team block is not shown');
});

test('withdrawn: { schema: 1, slug, withdrawn: true } → unavailable', () => {
  assert.deepEqual(M.sanitizePage(json('tests/fixtures/pages/withdrawn.json')), { withdrawn: true, slug: 'old-page' });
  assert.deepEqual(M.sanitizeEvent({ schema: 1, slug: 'x-trip', withdrawn: true }), { withdrawn: true, slug: 'x-trip' });
  assert.equal(M.sanitizeEvent({ schema: 1, slug: 'x-trip', withdrawn: 'yes' }), null);
});

test('media: images and clips only from this site\'s media/ (the content.js rules)', () => {
  assert.deepEqual(M.cleanImage({ ...IMG, color: '#AABBCC', extra: 1 }), { ...IMG, color: '#AABBCC' });
  assert.equal(M.cleanImage({ ...IMG, thumb: 'javascript:x' }).thumb, IMG.src);
  for (const src of ['media/2026/img-ab12cd34.png', '/media/2026/img-ab12cd34.webp', 'media/x/img-ab12cd34.webp', 'https://x.example/media/2026/img-ab12cd34.webp', 'media/2026/img-AB12CD34.webp']) {
    assert.equal(M.cleanImage({ ...IMG, src }), null, src);
  }
  assert.equal(M.cleanImage({ ...IMG, w: 0 }), null);
  assert.equal(M.cleanImage({ ...IMG, color: 'red' }).color, undefined);
  const video = { type: 'video', src: 'media/2026/vid-0e05ae88.mp4', poster: 'media/2026/vid-0e05ae88-480.webp', w: 270, h: 480, start: 5, end: 3 };
  assert.deepEqual(M.cleanVideo(video), { type: 'video', src: video.src, poster: video.poster, thumb: video.poster, w: 270, h: 480, alt: '', start: 5, end: 0 });
  assert.equal(M.cleanVideo({ ...video, poster: 'media/2026/vid-0e05ae88.webp' }), null);
  assert.equal(M.cleanVideo({ ...video, start: 9999 }).start, 0);
});

test('links: https only; WhatsApp only wa.me/<digits> (a ?text= only where the contract has one)', () => {
  assert.equal(M.safeHttps('https://example.org/a b'), 'https://example.org/a%20b');
  for (const bad of ['http://example.org', 'javascript:alert(1)', 'https://user:pw@example.org', 'https://localhost/', '//example.org', 'data:text/html,x']) assert.equal(M.safeHttps(bad), '', bad);
  assert.equal(M.waLink('https://wa.me/201001234567'), 'https://wa.me/201001234567');
  assert.equal(M.waLink('https://wa.me/201001234567?text=hi'), '');
  assert.equal(M.waLink('https://wa.me/201001234567?text=hi', { withText: true }), 'https://wa.me/201001234567?text=hi');
  for (const bad of ['https://api.whatsapp.com/send?phone=20100', 'https://wa.me/+201001234567', 'https://wa.me/2010', 'https://wa.me.evil.example/201001234567', 'https://wa.me/201001234567#x', 'http://wa.me/201001234567', 'https://wa.me/201001234567?text=a&phone=1']) {
    assert.equal(M.waLink(bad, { withText: true }), '', bad);
  }
});


/* =========================================================
   event.json
========================================================= */

test('event.json: the fixture as published; online only when it says exactly true (the online fields default as the Worker does)', () => {
  const e = M.sanitizeEvent(EVENT);
  assert.equal(e.slug, 'ain-sokhna-trip');
  assert.equal(e.kind, 'trip');
  assert.equal(e.kindLabel, 'رحلة');
  assert.equal(e.gallery.length, 2);
  assert.equal(e.gallery[1].type, 'video');
  assert.deepEqual(e.location, { name: 'العين السخنة', url: 'https://maps.google.com/?q=Ain+Sokhna' });
  assert.equal(e.booking.online, false);
  assert.equal(e.booking.pricing.mode, 'group');
  assert.equal(e.booking.pricing.categories.length, 4);
  assert.equal(e.booking.payment.mode, 'installments');
  assert.deepEqual(e.booking.servants.map(s => [s.name, s.wa, s.methods]), [['مينا عادل', 'https://wa.me/201001234567', ['cash', 'instapay']], ['مرقس فادي', null, ['cash']]]);
  // missing → online false, showLeft true, showLeftBelow 20, needsProof false
  assert.equal(e.booking.showLeft, true);
  assert.equal(e.booking.showLeftBelow, 20);
  assert.deepEqual(e.booking.methods.map(m => m.needsProof), [false, false]);
  for (const online of [false, 'true', 1, null, undefined, {}]) {
    assert.equal(M.sanitizeEvent({ ...EVENT, booking: { ...EVENT.booking, online } }).booking.online, false, String(online));
  }
  const on = M.sanitizeEvent({
    ...EVENT,
    booking: { ...EVENT.booking, online: true, showLeft: false, showLeftBelow: 5, methods: EVENT.booking.methods.map(m => ({ ...m, needsProof: m.key === 'instapay' })) }
  });
  assert.equal(on.booking.online, true);
  assert.equal(on.booking.showLeft, false);
  assert.equal(on.booking.showLeftBelow, 5);
  assert.deepEqual(on.booking.methods.map(m => [m.key, m.needsProof]), [['cash', false], ['instapay', true]]);
  assert.equal(M.sanitizeEvent({ ...EVENT, booking: { ...EVENT.booking, methods: [{ key: 'cash', label: 'كاش', needsProof: '1' }] } }).booking.methods[0].needsProof, false, 'true only');
});

test('event.json: every field validated', () => {
  const raw = clone(EVENT);
  raw.kind = 'party';
  raw.endAt = '2026-10-23T06:00';         // before the start: dropped
  raw.location = { name: '', url: 'https://x.example' };
  raw.gallery = [...raw.gallery, { src: 'https://evil.example/x.webp', w: 1, h: 1 }, ...Array.from({ length: 10 }, () => raw.gallery[0])];
  raw.partner = { key: 'bug' };
  raw.booking.pricing.categories.push(
    { key: 'Bad Key', label: 'x', price: 1 },
    { key: 'pricey', label: 'x', price: 200001 },
    { key: 'adult', label: 'تكرار', price: 1 }
  );
  raw.booking.methods.push({ key: 'x', label: 'قصير' }, { key: 'wallet', label: '' });
  raw.booking.servants[0].wa = 'https://wa.me/201001234567?text=injected';
  raw.booking.servants[0].methods = ['cash', 'iban', 'cash'];
  raw.booking.capacity = -5;
  raw.booking.perBookingMax = 0;
  const e = M.sanitizeEvent(raw);
  assert.equal(e.kind, '');
  assert.equal(e.endAt, '');
  assert.equal(e.location, null);
  assert.equal(e.gallery.length, 8);
  assert.equal(e.partner, null);
  assert.deepEqual(e.booking.pricing.categories.map(c => c.key), ['applicant', 'adult', 'child', 'infant']);
  assert.deepEqual(e.booking.methods.map(m => m.key), ['cash', 'instapay']);
  assert.equal(e.booking.servants[0].wa, null, 'a servant link never carries its own text');
  assert.deepEqual(e.booking.servants[0].methods, ['cash']);
  assert.equal(e.booking.capacity, null);
  assert.equal(e.booking.perBookingMax, 10);

  const single = M.sanitizeEvent({ ...EVENT, booking: { ...EVENT.booking, pricing: { mode: 'single', categories: EVENT.booking.pricing.categories } } });
  assert.deepEqual(single.booking.pricing.categories.map(c => c.key), ['applicant'], 'single = the applicant only');
  assert.equal(M.sanitizeEvent({ ...EVENT, booking: { ...EVENT.booking, pricing: { categories: [] } } }).booking, null, 'no prices: no booking area');
  assert.equal(M.sanitizeEvent({ ...EVENT, booking: null }).booking, null);
  assert.equal(M.sanitizeEvent({ ...EVENT, startAt: '' }), null);
  assert.equal(M.sanitizeEvent({ ...EVENT, slug: 'Bad' }), null);
  assert.equal(M.sanitizeEntry('event', EVENT).slug, 'ain-sokhna-trip');
  assert.equal(M.sanitizeEntry('page', PAGE).slug, 'black-theatre');
  assert.equal(M.sanitizeEntry('other', PAGE), null);
});

test('booking: counter within min/max and seats per booking; total; WhatsApp text', () => {
  const event = M.sanitizeEvent(EVENT);
  const b = event.booking;
  let counts = M.startCounts(b);
  assert.deepEqual(counts, { applicant: 1, adult: 0, child: 0, infant: 0 });
  assert.equal(M.stepCount(b, counts, 'applicant', +1), counts, 'the applicant is always one');
  assert.equal(M.stepCount(b, counts, 'adult', -1), counts);
  assert.ok(!M.canStep(b, counts, 'nope', +1));
  for (let i = 0; i < 9; i += 1) counts = M.stepCount(b, counts, 'adult', +1);
  assert.equal(counts.adult, 5, 'perBookingMax 6 seats (with the applicant)');
  counts = M.stepCount(b, counts, 'infant', +1);
  assert.equal(counts.infant, 1, 'an infant takes no seat');
  assert.equal(M.seatsOf(b, counts), 6);
  assert.equal(M.totalOf(b, counts), 9000);
  assert.equal(M.money(9000), '٩٬٠٠٠ جنيه');
  assert.equal(M.money(1500), '١٬٥٠٠ جنيه');
  assert.equal(M.money(0), 'مجانًا');
  const servant = b.servants[0];
  assert.equal(M.bookingMessage(event, servant), 'سلام يا مينا عادل، عايز أحجز في «رحلة العين السخنة».');
  assert.equal(M.bookingMessage(event, servant, counts), 'سلام يا مينا عادل، عايز أحجز في «رحلة العين السخنة».\n- الحاجز: ١\n- فرد إضافي: ٥\n- أقل من ٤ سنين: ١\nالإجمالي: ٩٬٠٠٠ جنيه');
  const href = M.waWithText(servant.wa, 'أهلًا & سلام');
  assert.equal(href, `https://wa.me/201001234567?text=${encodeURIComponent('أهلًا & سلام')}`);
  assert.equal(new URL(href).searchParams.get('text'), 'أهلًا & سلام');
  assert.equal(M.waWithText('https://evil.example/1', 'x'), '');
});


/* =========================================================
   THE HOME CARD'S BUTTON (§1.2 / §17.7 label table)
========================================================= */

const WINDOW = { opensAt: '2026-10-10T19:00', closesAt: '2026-10-21T23:00' };
const card = extra => ({ id: 'act-1', title: 'x', startAt: '2026-10-24T06:00', endAt: '2026-10-24T22:00', ctaLabel: '', ...extra });

test('label table: event before / during / after the booking window, no booking; page with / without clips; the override wins', () => {
  const rows = [
    [card({ event: 'trip', booking: WINDOW }), '2026-10-09T12:00', 'اعرف التفاصيل', 'الحجز يفتح السبت ١٠ أكتوبر'],
    [card({ event: 'trip', booking: WINDOW }), '2026-10-10T19:00', 'احجز الآن', ''],
    [card({ event: 'trip', booking: WINDOW }), '2026-10-21T23:00', 'احجز الآن', '', 'closesAt is inclusive'],
    [card({ event: 'trip', booking: WINDOW }), '2026-10-21T23:01', 'اعرف التفاصيل', 'الحجز اتقفل'],
    [card({ event: 'trip', booking: WINDOW }), '2026-10-25T09:00', 'اعرف التفاصيل', 'الحجز اتقفل', 'after the event too'],
    [card({ event: 'trip', booking: { opensAt: '', closesAt: '' } }), '2026-10-24T05:59', 'احجز الآن', '', 'open from publish until the start'],
    [card({ event: 'trip', booking: { opensAt: '', closesAt: '' } }), '2026-10-24T06:01', 'اعرف التفاصيل', 'الحجز اتقفل'],
    [card({ event: 'trip', booking: null }), '2026-10-12T12:00', 'اعرف التفاصيل', ''],
    [card({ page: 'black-theatre', watch: true, startAt: '', endAt: '' }), '2026-10-12T12:00', 'شاهد', ''],
    [card({ page: 'black-theatre', watch: false, startAt: '', endAt: '' }), '2026-10-12T12:00', 'اعرف التفاصيل', ''],
    [card({ event: 'trip', booking: WINDOW, ctaLabel: 'اكتمل العدد – التفاصيل' }), '2026-10-12T12:00', 'اكتمل العدد – التفاصيل', ''],
    [card({ event: 'trip', booking: WINDOW, ctaLabel: 'شوف الرحلة' }), '2026-10-01T12:00', 'شوف الرحلة', 'الحجز يفتح السبت ١٠ أكتوبر', 'the chip stays'],
    [card({ page: 'black-theatre', watch: true, ctaLabel: 'اتفرّج' }), '2026-10-12T12:00', 'اتفرّج', '']
  ];
  for (const [item, now, label, chip, note] of rows) {
    const b = entryButton(item, now);
    assert.equal(b.label, label, `${note || ''} ${JSON.stringify(item)} @ ${now}`);
    assert.equal(b.chip, chip, `${note || ''} chip @ ${now}`);
  }
  assert.deepEqual(entryButton(card({ event: 'trip', booking: null }), '2026-10-12T12:00').href, 'events/trip/');
  assert.deepEqual(entryButton(card({ page: 'black-theatre' }), '2026-10-12T12:00').href, 'black-theatre/');
  assert.equal(entryButton(card({}), '2026-10-12T12:00'), null, 'not linked');
  assert.equal(entryHref({ page: 'admin' }), '');
  assert.equal(entryHref({ event: '../x' }), '');
  assert.equal(competitionHref({ page: 'black-theatre' }), '');
  const items = read('assets/js/items.js');
  assert.match(items, /href: entry\.href, 'data-entry': entry\.kind/, 'same tab (no target=_blank)');
  assert.match(items, /services: 'theatre'/);
  assert.match(items, /services: 'خدماتنا'/);
});

test('events list: upcoming and running first by start, finished last, gone 12 h after the end', () => {
  const ev = (slug, startAt, endAt = '') => ({ slug, startAt, endAt });
  const list = [ev('late', '2026-11-01T10:00'), ev('done', '2026-10-13T10:00', '2026-10-14T08:00'), ev('soon', '2026-10-15T10:00', '2026-10-15T20:00'), ev('gone', '2026-10-12T10:00', '2026-10-13T20:00'), ev('now', '2026-10-14T09:00', '2026-10-14T18:00'), ev('noend', '2026-10-14T00:30')];
  assert.deepEqual(M.eventsList(list, '2026-10-14T12:00').map(e => e.slug), ['now', 'soon', 'late', 'done', 'noend']);
  assert.equal(M.eventHideAt(ev('x', '2026-10-14T18:00')), '2026-10-15T06:00');
  assert.equal(M.eventHideAt(ev('x', '2026-10-14T10:00', '2026-12-31T20:00')), '2027-01-01T08:00');
  assert.deepEqual(M.eventsList(list, '2026-10-14T20:31').map(e => e.slug), ['soon', 'late', 'now']);
  assert.ok(!M.eventsList(list, '2026-10-15T08:01').some(e => e.slug === 'done'), 'done + 12 h');
});


/* =========================================================
   content.js
========================================================= */

const TYPES = [{ key: 'trip', label: 'رحلة', icon: 'bus' }, { key: 'service', label: 'خدمة', icon: 'theatre', theme: 'night' }, { key: 'competition', label: 'مسابقة', icon: 'trophy' }];
const act = (id, extra) => ({ id, type: 'trip', section: 'activities', title: id, ...extra });

test('content.js: pages[] and events[] indexes; linked cards kept only when published, else dropped', () => {
  const c = sanitizeContent({
    ...SEED,
    types: TYPES,
    pages: [
      { id: 'pg-1', slug: 'black-theatre', title: 'المسرح الأسود', tagline: 'x', cover: IMG, v: 'abc', secret: 1 },
      { id: 'pg-2', slug: 'black-theatre', title: 'تكرار' },
      { id: 'pg-3', slug: 'admin', title: 'محجوز' },
      { id: 'pg-4', slug: 'no-title' }
    ],
    events: [
      { id: 'evt-1', slug: 'ain-sokhna-trip', kind: 'trip', kindLabel: 'رحلة', title: 'رحلة', shortTitle: 'ر', summary: 's', cover: { ...IMG, src: 'https://evil.example/x.webp' }, startAt: '2026-10-24T06:00', endAt: '2026-10-24T22:00', booking: { opensAt: '2026-10-10T19:00', closesAt: 'soon' }, v: 'v1' },
      { id: 'evt-2', slug: 'no-start', title: 'x', startAt: '' }
    ],
    activities: [
      act('a-plain', { cta: { label: 'سجّل', url: 'https://forms.example/x' } }),
      act('a-page', { type: 'service', section: 'services', page: 'black-theatre', watch: true, ctaLabel: '', cta: { label: 'x', url: 'https://example.org' } }),
      act('a-event', { event: 'ain-sokhna-trip', booking: { opensAt: '2026-10-10T19:00', closesAt: '2026-10-21T23:00' }, ctaLabel: 'احجز مكانك', startAt: '2026-10-24T06:00', endAt: '2026-10-24T22:00' }),
      act('a-unlisted', { page: 'silent-theatre' }),
      act('a-reserved', { page: 'admin' }),
      act('a-badslug', { event: '../x' }),
      act('a-both', { page: 'black-theatre', event: 'ain-sokhna-trip' }),
      act('a-comp', { page: 'black-theatre', competition: 'quiz-1' }),
      act('a-quiz', { type: 'competition', section: 'competitions', competition: 'quiz-1', ctaLabel: 'ادخل' }),
      act('a-eventlong', { event: 'ain-sokhna-trip', visibleUntil: '2026-12-01T00:00' })
    ],
    notifications: [
      { id: 'n1', title: 't', publishAt: '2026-10-11T10:00', target: { kind: 'page', slug: 'black-theatre' } },
      { id: 'n2', title: 't', publishAt: '2026-10-11T10:00', target: { kind: 'event', slug: 'ain-sokhna-trip' } },
      { id: 'n3', title: 't', publishAt: '2026-10-11T10:00', target: { kind: 'page', slug: 'silent-theatre' } },
      { id: 'n4', title: 't', publishAt: '2026-10-11T10:00', target: { kind: 'event', slug: '../../x' } }
    ]
  });

  assert.deepEqual(c.pages, [{ id: 'pg-1', slug: 'black-theatre', title: 'المسرح الأسود', tagline: 'x', cover: IMG, v: 'abc' }]);
  assert.deepEqual(c.events, [{ id: 'evt-1', slug: 'ain-sokhna-trip', kind: 'trip', kindLabel: 'رحلة', title: 'رحلة', shortTitle: 'ر', summary: 's', cover: null, startAt: '2026-10-24T06:00', endAt: '2026-10-24T22:00', booking: { opensAt: '2026-10-10T19:00', closesAt: '' }, v: 'v1' }]);

  assert.deepEqual(c.activities.map(a => a.id), ['a-plain', 'a-page', 'a-event', 'a-quiz', 'a-eventlong']);
  const [plain, page, event, quiz, long] = c.activities;
  assert.equal(plain.page, undefined, 'unlinked cards keep their old shape');
  assert.equal(plain.event, undefined);
  assert.equal(plain.cta.url, 'https://forms.example/x');
  assert.deepEqual([page.page, page.watch, page.cta, page.competition], ['black-theatre', true, null, '']);
  assert.deepEqual([event.event, event.booking, event.ctaLabel, event.cta], ['ain-sokhna-trip', { opensAt: '2026-10-10T19:00', closesAt: '2026-10-21T23:00' }, 'احجز مكانك', null]);
  assert.equal(event.visibleUntil, '2026-10-25T10:00', 'endAt + 12 h');
  assert.equal(long.visibleUntil, '2026-10-25T10:00', 'never later than endAt + 12 h');
  assert.equal(long.booking, null);
  assert.equal(quiz.competition, 'quiz-1');

  assert.deepEqual(c.notifications.map(n => n.target), [{ kind: 'page', slug: 'black-theatre' }, { kind: 'event', slug: 'ain-sokhna-trip' }, null, null]);

  const old = sanitizeContent(SEED);
  assert.deepEqual([old.pages, old.events], [[], []], 'older content: none');
});

test('router / layout: #event/<slug> and #page/<slug> are other pages; «خدماتنا» after the activities', () => {
  assert.equal(pageForHash('#event/ain-sokhna-trip'), 'events/ain-sokhna-trip/');
  assert.equal(pageForHash('#event/ain-sokhna-trip/'), 'events/ain-sokhna-trip/');
  assert.equal(pageForHash('#page/black-theatre'), 'black-theatre/');
  for (const bad of ['#page/admin', '#page/', '#event/', '#event/Bad', '#page/../x', '#page/a', '#event/x?y', '#pagex/black-theatre']) assert.equal(pageForHash(bad), '', bad);
  assert.equal(pageForHash('#competition/quiz-1'), 'competition/quiz-1/', 'competitions unchanged');
  assert.equal(parseHash('#page/black-theatre'), null, 'not a sheet');
  const keys = pageLayout({ layout: null, sections: [] }).map(s => s.key);
  assert.equal(keys.indexOf('services'), keys.indexOf('activities') + 1);
  assert.equal(pageLayout({ layout: null, sections: [] }).find(s => s.key === 'services').kind, 'items');
  assert.match(read('assets/js/bell.js'), /target\.kind === 'page' \? pageHref\(target\.slug\)/);
  assert.match(read('assets/js/main.js'), /isEntryPath\(url\.pathname\)/);
});


/* =========================================================
   sw.js
========================================================= */

function worker(windows = []) {
  const listeners = {};
  const opened = [];
  const focused = [];
  const self = {
    location: new URL('https://stathanasiosyouth.github.io/sw.js'),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    registration: { showNotification: async (title, options) => { self.shown = { title, options }; } },
    clients: {
      claim: async () => {},
      matchAll: async () => windows.map(url => ({ url, postMessage: () => {}, focus: async () => { focused.push(url); } })),
      openWindow: async url => { opened.push(url); }
    }
  };
  vm.runInNewContext(read('sw.js'), { self, URL, console });
  const fire = async (type, event) => { let wait; listeners[type]({ ...event, waitUntil: p => { wait = p; } }); await wait; };
  return {
    opened, focused,
    url: async value => { await fire('push', { data: { json: () => ({ data: { title: 'x', url: value } }) } }); return self.shown.options.data.url; },
    click: url => fire('notificationclick', { notification: { data: { url }, close() {} } })
  };
}

test('sw.js: /events/<slug>/ and a non-reserved /<slug>/ open exactly; #event/ #page/ deep links', async () => {
  const sw = worker();
  assert.equal(await sw.url('/events/ain-sokhna-trip/'), '/events/ain-sokhna-trip/');
  assert.equal(await sw.url('/black-theatre/'), '/black-theatre/');
  assert.equal(await sw.url('/black-theatre/?x=1#v/pm-1'), '/black-theatre/', 'query and hash dropped');
  assert.equal(await sw.url('/#event/ain-sokhna-trip'), '/index.html#event/ain-sokhna-trip');
  assert.equal(await sw.url('/#page/black-theatre'), '/index.html#page/black-theatre');
  for (const bad of ['/admin/', '/events/', '/pages/', '/media/', '/assets/', '/competition/', '/black-theatre', '/Black-Theatre/', '/-x/', '/events/a/b/', '/events/Bad/', '/black-theatre/page.json', '//evil.example/black-theatre/', 'https://evil.example/events/x-y/', '/#page/admin']) {
    assert.equal(await sw.url(bad), '/index.html', bad);
  }
  assert.equal(await sw.url('/competition/quiz-1/'), '/competition/quiz-1/', 'competitions unchanged');
  const origin = 'https://stathanasiosyouth.github.io';
  const open = worker([`${origin}/index.html`, `${origin}/black-theatre/`]);
  await open.click('/black-theatre/');
  assert.deepEqual(open.focused, [`${origin}/black-theatre/`], 'already open: brought forward');
  const none = worker([]);
  await none.click('/events/ain-sokhna-trip/');
  assert.deepEqual(none.opened, [`${origin}/events/ain-sokhna-trip/`]);
});


/* =========================================================
   THE SHELLS
========================================================= */

const csp = html => /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];

for (const file of ['pages/index.html', 'events/index.html']) {
  test(`${file}: the site CSP (+ the booking Worker in connect-src, Turnstile in script-src and frame-src), no inline code, relative URLs one level up, the page module`, () => {
    const shell = read(file);
    // the site's policy, with the booking API (production, and staging for a developer's machine) added to connect-src
    const WORKERS = ' https://athanasios-api.menazak-lab.workers.dev https://athanasios-api-staging.menazak-lab.workers.dev';
    const site = csp(read('index.html'));
    const TURNSTILE = ' https://challenges.cloudflare.com';
    assert.equal(csp(shell), site.replace(/(connect-src [^;]+)/, `$1${WORKERS}`).replace(/(script-src [^;]+)/, `$1${TURNSTILE}`).replace(/(frame-src [^;]+)/, `$1${TURNSTILE}`));
    assert.notEqual(csp(shell), site);
    assert.doesNotMatch(shell, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline script');
    assert.doesNotMatch(shell, /<style|\sstyle="/, 'no inline style');
    assert.doesNotMatch(shell, /<html[^>]*data-(slug|v)=/, 'the shell itself has no slug');
    for (const [, url] of shell.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      if (url.startsWith('#')) continue;
      assert.match(url, /^\.\.\//, `${url} is relative to the site root`);
    }
    assert.match(shell, /src="\.\.\/assets\/js\/page\/main\.js"/);
    assert.match(shell, /href="\.\.\/assets\/css\/page\.css"/);
    assert.doesNotMatch(shell, /main\.css|comp\.css/, 'self-contained styles');
    assert.match(shell, /<main id="page-main"/);
    assert.match(shell, /class="pbar__home" href="\.\.\/">ارجع للموقع</);
  });
}

test('the two shells: events/index.html is pages/index.html with data-kind="events" (and its own head words)', () => {
  const shell = read('pages/index.html').replace(/\r\n/g, '\n');
  const list = read('events/index.html').replace(/\r\n/g, '\n');
  assert.match(shell, /<html lang="ar" dir="rtl">/);
  assert.match(shell, /<meta name="robots" content="noindex">/, 'the bare shell is not a page');
  assert.match(list, /<html lang="ar" dir="rtl" data-kind="events">/);
  assert.doesNotMatch(list, /noindex/);
  const body = html => html.slice(html.indexOf('<body>'));
  assert.equal(body(list), body(shell));
  // an event stub (Pages.gs pageStubHtml_): every ="../ one level deeper
  const stub = shell.replace(/(\s(?:href|src)=")\.\.\//g, '$1../../');
  for (const [, url] of stub.matchAll(/\s(?:href|src)="([^"]+)"/g)) if (!url.startsWith('#')) assert.match(url, /^\.\.\/\.\.\//, url);
});

test('page modules: URLs from the module, text only, no storage; page.css self-contained', () => {
  const code = file => read(`assets/js/page/${file}`);
  assert.match(code('main.js'), /new URL\('\.\.\/\.\.\/\.\.\/', import\.meta\.url\)/, 'the site root from the module, not the page');
  for (const file of ['main.js', 'view.js', 'video.js', 'clip-audio.js', 'model.js']) {
    assert.doesNotMatch(code(file), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, file);
    assert.doesNotMatch(code(file), /localStorage|sessionStorage|indexedDB/, file);
  }
  assert.doesNotMatch(code('model.js'), /document\.|window\.|fetch\(/, 'model.js is pure');
  assert.match(code('main.js'), /event\.source !== window\.parent \|\| event\.origin !== location\.origin/, 'preview: same-origin parent only');
  assert.match(code('video.js'), /preload: 'metadata'/);
  // the clip starts as the sheet opens (no autoplay attribute), muted when sound is refused; a hidden page stops it
  assert.doesNotMatch(code('video.js'), /autoplay:|\.autoplay\b/, 'no autoplay attribute');
  assert.match(code('video.js'), /function playClip\(\)[\s\S]*video\.muted = true;\s*video\.play\(\)/, 'muted retry when sound is refused');
  assert.match(code('video.js'), /visibilitychange[\s\S]*video\.pause\(\);\s*sound\.pause\(\)/, 'a hidden page pauses the clip and its sound');
  // «صوت المقطع»: one source at a time, faded; the site's one sound setting wins
  assert.match(code('clip-audio.js'), /video\.muted = mode !== 'original' \|\| !soundEnabled\(\)/, 'custom / none: the clip is never heard; sound off: nothing is');
  assert.match(code('clip-audio.js'), /linearRampToValueAtTime/, 'fades, not cuts');
  const css = read('assets/css/page.css');
  assert.match(css, /@font-face[\s\S]*Aref Ruqaa/);
  assert.doesNotMatch(css, /@import|https?:\/\//, 'no outside requests');
  assert.match(css, /prefers-reduced-motion: no-preference/);
});


/* =========================================================
   PARTNERS: B.U.G. (docs/EVENTS.md §12)
========================================================= */

const PAGE_BUG = json('tests/fixtures/pages/page-partner.json');
const EVENT_BUG = json('tests/fixtures/pages/event-partner.json');
const BUG = PAGE_BUG.partner;

test('partner: page.json / event.json keep a partner whose pictures are ours (assets/img/partners/ only); anything else → null', () => {
  assert.deepEqual(M.sanitizePage(PAGE_BUG).partner, BUG, 'the published shape, unchanged');
  assert.deepEqual(M.sanitizeEvent(EVENT_BUG).partner, BUG);
  assert.equal(M.sanitizePage(PAGE).partner, null, 'no partner');
  assert.equal(M.sanitizeEntry('event', EVENT_BUG).partner.key, 'bug', 'the admin preview too');

  const with_ = change => M.cleanPartner({ ...clone(BUG), ...change(clone(BUG)) });
  const logo = src => b => ({ logo: { ...b.logo, src } });

  // the key
  for (const key of ['BUG', 'b', 'abcdefghijklm', 'bug1', 'b-g', '', null, 7, ['bug']]) assert.equal(with_(() => ({ key })), null, String(key));
  assert.equal(with_(() => ({ key: 'abcdefghijkl' })).key, 'abcdefghijkl', '12 letters');

  // the logo: a committed file under assets/img/partners/, .webp or .png
  for (const src of [
    'media/2026/img-ab12cd34.webp', '/assets/img/partners/bug.webp', '../assets/img/partners/bug.webp', 'assets/img/partners/../logo-128.webp',
    'assets/img/partners/sub/bug.webp', 'https://evil.example/bug.webp', '//evil.example/bug.webp', 'assets/img/partners/bug.svg', 'assets/img/partners/bug.webp?x=1',
    'assets/img/partners/bug.webp#x', 'assets/img/partners/Bug.webp', 'assets/img/partners/.webp', 'javascript:alert(1)', 'data:image/webp;base64,AAAA', ''
  ]) assert.equal(with_(logo(src)), null, src);
  assert.equal(with_(logo('assets/img/partners/bug-logo.png')).logo.src, 'assets/img/partners/bug-logo.png');
  assert.equal(with_(b => ({ logo: { ...b.logo, w: 0 } })), null, 'a size is required');
  assert.equal(with_(b => ({ logo: { ...b.logo, thumb: 'https://evil.example/x.webp' } })).logo.thumb, BUG.logo.src, 'a bad thumb falls back to the logo');

  // the mark is optional (the chip shows the words alone)
  assert.equal(with_(b => ({ mark: { ...b.mark, src: 'https://evil.example/m.webp' } })).mark, null);
  assert.equal(with_(() => ({ mark: null })).mark, null);
  assert.deepEqual(with_(() => ({})).mark, BUG.mark, '{ src, w, h, alt }');

  // words: one line, capped; a name is required; short falls back to the name
  assert.equal(with_(() => ({ name: '' })), null);
  assert.equal(with_(() => ({ name: `  ${'x'.repeat(200)}\n` })).name.length, 80);
  assert.equal(with_(() => ({ short: '' })).short, BUG.name.slice(0, 24));
  assert.equal(with_(() => ({ short: 'B.U.G.\u0000\u0007' })).short, 'B.U.G.', 'control characters out');
  assert.equal(with_(b => ({ logo: { ...b.logo, alt: 'x'.repeat(500) } })).logo.alt.length, 140);

  // its link: https only
  assert.equal(with_(() => ({ url: 'http://bug.example' })).url, null);
  assert.equal(with_(() => ({ url: 'javascript:alert(1)' })).url, null);
  assert.equal(with_(() => ({ url: 'https://bug.example/about' })).url, 'https://bug.example/about');

  // never more than the contract's fields
  assert.deepEqual(Object.keys(with_(() => ({ extra: 1, style: 'x' }))).sort(), ['key', 'logo', 'mark', 'name', 'short', 'url']);
  for (const raw of [null, 'bug', ['bug'], { key: 'bug' }]) assert.equal(M.cleanPartner(raw), null, JSON.stringify(raw));
  assert.equal(M.sanitizePage({ ...PAGE_BUG, partner: 'bug' }).partner, null, 'a bare key in page.json is not a partner');
});

test('content.js: partners{}; a card / page / event keeps its partner key only when content.partners has it', () => {
  const c = sanitizeContent({
    ...SEED,
    types: TYPES,
    partners: {
      bug: BUG,
      evil: { ...BUG, key: 'evil', logo: { ...BUG.logo, src: 'https://evil.example/x.webp' } },
      xyz: { ...BUG, key: 'abc' },
      __proto__: { polluted: true }
    },
    pages: [
      { id: 'pg-1', slug: 'bug-theatre', title: 'مسرح', cover: null, v: 'a', partner: 'bug' },
      { id: 'pg-2', slug: 'black-theatre', title: 'المسرح الأسود', cover: null, v: 'b', partner: 'evil' },
      { id: 'pg-3', slug: 'other-page', title: 'صفحة', cover: null, v: 'c', partner: null }
    ],
    events: [
      { id: 'evt-1', slug: 'bug-camp', title: 'يوم', startAt: '2026-10-24T06:00', v: 'v', partner: 'bug' },
      { id: 'evt-2', slug: 'trip', title: 'رحلة', startAt: '2026-10-24T06:00', v: 'v', partner: 'BUG' }
    ],
    activities: [
      act('a-bug', { type: 'service', section: 'services', page: 'bug-theatre', partner: 'bug' }),
      act('a-evt', { event: 'bug-camp', partner: 'bug' }),
      act('a-evil', { page: 'black-theatre', partner: 'evil' }),
      act('a-nope', { event: 'trip', partner: 'nope' }),
      act('a-proto', { partner: '__proto__' }),
      act('a-ctor', { partner: 'constructor' }),
      act('a-obj', { partner: { key: 'bug' } }),
      act('a-plain', {})
    ]
  });

  assert.deepEqual(Object.keys(c.partners), ['bug'], 'only valid partners under their own key');
  assert.deepEqual(c.partners.bug, BUG);
  assert.equal(Object.getPrototypeOf(c.partners), Object.prototype);
  assert.equal(c.partners.polluted, undefined);
  assert.deepEqual(c.pages.map(p => p.partner), ['bug', undefined, undefined]);
  assert.deepEqual(c.events.map(e => e.partner), ['bug', undefined]);
  assert.deepEqual(c.activities.map(a => [a.id, a.partner]), [['a-bug', 'bug'], ['a-evt', 'bug'], ['a-evil', undefined], ['a-nope', undefined], ['a-proto', undefined], ['a-ctor', undefined], ['a-obj', undefined], ['a-plain', undefined]]);
  assert.equal('partner' in c.activities.find(a => a.id === 'a-plain'), false, 'no partner: the card keeps its old shape');

  // the chip only for a known partner (items.js)
  assert.equal(partnerChip({ partner: 'nope' }, c.partners), null);
  assert.equal(partnerChip({}, c.partners), null);
  assert.equal(partnerChip({ partner: 'bug' }, {}), null);

  const old = sanitizeContent(SEED);
  assert.deepEqual(old.partners, {}, 'older content: none');
});

/* collab.js in a tiny fake browser: which version plays, and what it remembers */
function runCollab({ partner = 'bug', hash = '', search = '', reduced = false, hidden = false, framed = false, cores = 8, memory = 8, saveData = false, session = {}, local = {}, broken = false, animations = true, now = 1_800_000_000_000, preview = false } = {}) {
  const attrs = partner ? { 'data-partner': partner } : {};
  if (preview) attrs['data-preview'] = '';
  const appended = [];
  const html = {
    getAttribute: k => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: k => { delete attrs[k]; },
    hasAttribute: k => k in attrs,
    appendChild: node => { appended.push(node); node.parentNode = html; return node; },
    removeChild: node => { appended.splice(appended.indexOf(node), 1); }
  };
  const store = data => (broken
    ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }
    : { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } });
  const element = tag => ({ tag, children: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(child) { this.children.push(child); }, addEventListener() {} });
  const listeners = [];
  const win = { addEventListener: (type, fn, options) => listeners.push(type), removeEventListener() {} };
  win.self = win;
  win.top = framed ? {} : win;
  win.matchMedia = () => ({ matches: reduced });
  const document = {
    documentElement: html,
    currentScript: { src: 'https://site.test/events/bug-camp/../../assets/js/page/collab.js' },
    visibilityState: hidden ? 'hidden' : 'visible',
    getAnimations: animations ? () => [] : undefined,
    createElement: element,
    createTextNode: text => ({ text }),
    addEventListener() {},
    removeEventListener() {}
  };
  const timers = [];
  vm.runInNewContext(read('assets/js/page/collab.js'), {
    window: win, document, matchMedia: win.matchMedia, location: { hash, search },
    navigator: { hardwareConcurrency: cores, deviceMemory: memory, connection: { saveData } },
    sessionStorage: store(session), localStorage: store(local),
    URL, URLSearchParams, JSON, Math, Number, Object, isFinite, Date: { now: () => now }, Promise, performance: { now: () => 0 },
    setTimeout: (fn, ms) => timers.push(ms), clearTimeout() {},
    addEventListener: win.addEventListener, removeEventListener: win.removeEventListener
  });
  const find = (node, cls) => (node.className === cls ? node : (node.children || []).map(c => find(c, cls)).find(Boolean));
  const overlay = appended[0] || null;
  return {
    mode: attrs['data-collab'] || '',
    overlay,
    images: overlay ? ['cintro__seal', 'cintro__logo'].map(cls => find(overlay, cls).src) : [],
    hidden: overlay ? overlay.attrs['aria-hidden'] : null,
    session, local, timers, listeners
  };
}

test('collab.js: the ident every time the page is entered; a light version on weak phones; never when it shouldn\'t', () => {
  // a visit: the overlay, aria-hidden, the two logos (transparent, from the site root), nothing remembered
  let r = runCollab();
  assert.equal(r.mode, 'full');
  assert.equal(r.hidden, 'true');
  assert.deepEqual(r.images, ['https://site.test/assets/img/partners/athanasios-family-240.webp', 'https://site.test/assets/img/partners/bug-symbol-320.webp']);
  assert.deepEqual([r.session, r.local], [{}, {}], 'nothing stored: it plays on every entry');
  assert.ok(r.timers.includes(700), 'starts by 0.7 s even if the logos are slow');
  assert.ok(r.timers.includes(3300), 'the hard limit');
  assert.ok(Math.max(...r.timers) <= 3300);
  // any input skips it; leaving ends it; back from the back/forward cache plays it again
  assert.deepEqual([...new Set(r.listeners)].sort(), ['keydown', 'pagehide', 'pageshow', 'pointerdown', 'wheel']);
  assert.doesNotMatch(r.overlay.className, /cintro--lite/);

  // coming into the page again (the old once-a-session mark, anything stored): it plays again
  assert.equal(runCollab({ session: { 'athanasios:collab:bug': '1' } }).mode, 'full');
  assert.equal(runCollab({ local: { 'athanasios.sound': 'off' } }).mode, 'full', 'sound off: the ident still plays (silent)');

  // a weak phone: the same ident, light
  for (const options of [{ cores: 4, memory: 4 }, { memory: 2 }]) {
    r = runCollab(options);
    assert.equal(r.mode, 'full');
    assert.match(r.overlay.className, /cintro--lite/);
  }
  assert.doesNotMatch(runCollab({ cores: 4, memory: 8 }).overlay.className, /cintro--lite/, '4 cores with 8 GB is fine');

  // storage that throws: it still plays (the sound setting falls back to on)
  assert.equal(runCollab({ broken: true }).mode, 'full');

  // the gates
  for (const [why, options] of [
    ['no partner', { partner: '' }], ['unknown partner', { partner: 'acme' }], ['bad key', { partner: 'BUG' }],
    ['reduced motion', { reduced: true }], ['deep link', { hash: '#v/pm-clip0001' }], ['hidden tab', { hidden: true }],
    ['framed', { framed: true }], ['data saver', { saveData: true }],
    ['admin preview (?preview)', { search: '?preview' }], ['admin preview (data-preview)', { preview: true }],
    ['no getAnimations', { animations: false }]
  ]) {
    r = runCollab(options);
    assert.deepEqual([r.mode, r.overlay, r.session['athanasios:collab:bug']], ['', null, undefined], why);
  }
  assert.equal(runCollab({ hash: '#' }).mode, 'full', 'an empty # is not a deep link');
});

test('collab.js: a classic script in both shells\' <head>; text only; every storage access guarded; page.css has its styles', () => {
  const code = read('assets/js/page/collab.js');
  assert.doesNotMatch(code, /^\s*(import|export)\b/m, 'classic, not a module');
  assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|\.style\b|setAttribute\('style'/);
  assert.match(code, /new URL\('\.\.\/\.\.\/\.\.\/', script\.src\)/, 'the site root from the script, not the page');
  const lines = code.split('\n');
  for (const [i, lineText] of lines.entries()) {
    if (/(session|local)Storage\./.test(lineText)) assert.match(lines.slice(Math.max(0, i - 2), i + 1).join(' '), /try \{/, `line ${i + 1}: storage inside try`);
  }
  assert.doesNotMatch(code, /\.focus\(/, 'never moves focus');
  for (const file of ['pages/index.html', 'events/index.html']) {
    const shell = read(file).replace(/\r\n/g, '\n');
    const head = shell.slice(0, shell.indexOf('</head>'));
    assert.match(head, /<script src="\.\.\/assets\/js\/page\/collab\.js"><\/script>/, file);
    assert.ok(head.indexOf('page.css') < head.indexOf('collab.js'), `${file}: after the stylesheet (styled from the first paint)`);
  }
  const css = read('assets/css/page.css');
  for (const rule of ['.cobrand {', '.cobrand__mark {', '.cintro {', '@keyframes cintro-out', '--partner-plate:']) assert.ok(css.includes(rule), rule);
  // the ident fits in 2.35 s: the last step starts at 1.95 s and lasts .4 s (collab.js FULL)
  assert.match(css, /\.cintro\.is-go \{\r?\n  animation: cintro-out \.4s cubic-bezier\(\.4, 0, \.2, 1\) 1\.95s both;/);
  assert.match(read('assets/js/page/collab.js'), /var FULL = 2350;/);
  // the logos it shows are in the repository, transparent
  for (const file of ['athanasios-family-240', 'athanasios-family-480', 'bug-symbol-320', 'bug-symbol-640']) {
    assert.ok(existsSync(new URL(`assets/img/partners/${file}.webp`, ROOT)), file);
  }
});


/* «صوت المقطع» (§17.9): what a video card plays; only this site's own sound files */
test('model: a video card\'s audio — original by default, custom only with this site\'s own MP3 / M4A, else silence', async () => {
  const { cleanAudio } = await import(new URL("assets/js/page/model.js", ROOT).href);
  assert.deepEqual(cleanAudio(undefined), { mode: 'original', src: null });
  assert.deepEqual(cleanAudio({ mode: 'original', src: 'media/2026/aud-abcd1234.mp3' }), { mode: 'original', src: null });
  assert.deepEqual(cleanAudio({ mode: 'none' }), { mode: 'none', src: null });
  assert.deepEqual(cleanAudio({ mode: 'custom', src: 'media/2026/aud-abcd1234.mp3' }), { mode: 'custom', src: 'media/2026/aud-abcd1234.mp3' });
  assert.deepEqual(cleanAudio({ mode: 'custom', src: 'media/2026/aud-abcd1234.m4a' }), { mode: 'custom', src: 'media/2026/aud-abcd1234.m4a' });
  for (const src of ['https://evil.example/a.mp3', 'media/2026/vid-abcd1234.mp4', 'media/2026/aud-abcd1234.wav', '../aud-abcd1234.mp3', 'media/2026/aud-ABCD1234.mp3', '']) {
    assert.deepEqual(cleanAudio({ mode: 'custom', src }), { mode: 'none', src: null }, src);
  }
  assert.deepEqual(cleanAudio({ mode: 'loud' }), { mode: 'original', src: null });
});

test('booking contact visibility: on the page by default, after booking only when asked; the WhatsApp is still the servant\'s approved one', () => {
  const base = M.sanitizeEvent(EVENT);
  if (!base || !base.booking) return;                   // the fixture has no booking: nothing to check
  assert.equal(base.booking.contactOnPage, true);
  assert.equal(base.booking.contactAfter, false);
  const off = M.sanitizeEvent({ ...EVENT, booking: { ...EVENT.booking, contactOnPage: false, contactAfter: true } });
  assert.deepEqual([off.booking.contactOnPage, off.booking.contactAfter], [false, true]);
});
