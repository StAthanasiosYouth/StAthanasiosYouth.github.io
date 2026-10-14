// Service pages, events, servants and their home cards (apps-script/Pages.gs,
// BookModel.gs; docs/EVENTS.md §1.2, §17): the admin API through doPost, the
// one card per owner, show / hide without touching the page, the «خدماتنا»
// section, the publish (stubs + JSON in the same commit as content.json),
// the 12-hour expiry of an event card, withdrawal, and the guards (slugs,
// deleting, linked cards in the activities list).

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { compWorld, adminApi, publish, webp, wallAt, plain } from './fakes/comp.mjs';
import { ROOT as ROOT_DIR } from '../tools/lib/gs.mjs';

const mp4 = (fill = 1) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(52, fill)]);

function image(call, fill = 7, w = 1280, h = 720) {
  return call('apiUploadMedia', { full: webp(fill).toString('base64'), thumb: webp(fill).toString('base64'), mime: 'image/webp', width: w, height: h, alt: 'صورة ' + fill }).media;
}

function video(call, fill = 3) {
  return call('apiUploadMedia', {
    kind: 'video', video: mp4(fill).toString('base64'), mime: 'video/mp4', poster: webp(fill + 40).toString('base64'), posterMime: 'image/webp',
    tiny: webp(fill + 40).toString('base64'), tinyMime: 'image/webp', color: '#224466', name: 'مقطع', width: 854, height: 480, duration: 30, alt: 'مقطع من العرض'
  }).media;
}

const activities = world => plain(world.gs.readOptionalTable_('Activities'));
const sections = world => plain(world.gs.readTable_('Sections'));
const json = (files, path) => JSON.parse(files[path]);

function setup() {
  const world = compWorld();
  const call = adminApi(world);
  const cover = image(call, 7);
  const still = image(call, 8);
  const clip = video(call, 3);
  const servant = call('apiServantSave', null, { name: 'مينا عادل', phone: '01012345678', role: 'مسؤول الفريق', publicWa: true }).servant;
  const hidden = call('apiServantSave', null, { name: 'بيشوي', phone: '01112345678' }).servant;
  return { world, call, cover, still, clip, servant, hidden };
}

function theatre(ctx, extra = {}) {
  const { call, cover, clip, servant, hidden } = ctx;
  const saved = call('apiPageSave', null, {
    slug: 'black-theatre', title: 'المسرح الأسود', tagline: 'عروض بالنور والضلمة', description: 'فريق المسرح الأسود في الأسرة.',
    hero: clip.id + '@2-12', cover: cover.id, cardType: 'black-theatre', teamMessage: 'عايز انضم لفريق المسرح الأسود',
    team: [servant.id, hidden.id], home: { show: true }, ...extra
  });
  call('apiPageMediaSave', saved.page.id, null, { title: 'العرض الأول', text: 'عرض الكريسماس', duration: '٣:٢٠', cover: cover.id, source: 'clip', clip: clip.id, fullUrl: 'https://youtu.be/abc' });
  call('apiPageMediaSave', saved.page.id, null, { title: 'المسرحية كاملة', cover: cover.id, source: 'link', fullUrl: 'https://www.facebook.com/watch/1' });
  return call('apiPage', saved.page.id);
}

function trip(ctx, extra = {}) {
  const { world, call, cover, servant } = ctx;
  return call('apiEventSave', null, {
    slug: 'alex-trip', kind: 'trip', title: 'رحلة إسكندرية', summary: 'يوم على البحر', body: 'التفاصيل كلها هنا.',
    cover: cover.id, startAt: wallAt(world, 3 * 24 * 60), endAt: wallAt(world, 3 * 24 * 60 + 600), locationName: 'إسكندرية',
    booking: {
      opensAt: wallAt(world, -60), closesAt: wallAt(world, 2 * 24 * 60), capacity: 50,
      pricing: { mode: 'group', categories: [{ label: 'الحاجز', price: 1500 }, { key: 'child', label: 'طفل', group: 'child', price: 800, max: 4 }] },
      payment: { mode: 'installments', minFirst: 500 }
    },
    servants: [{ id: servant.id, methods: ['cash', 'instapay', 'nope'] }],
    home: { show: true }, ...extra
  });
}


/* ---------------- servants ---------------- */

test('servants: phone normalized, consent needs a phone, list sorted, never in the activity changes', () => {
  const { world, call, servant } = setup();
  assert.equal(servant.phone, '+201012345678');
  assert.throws(() => call('apiServantSave', null, { name: 'من غير رقم', publicWa: true }), /لازم رقم موبايل/);
  assert.throws(() => call('apiServantSave', null, { name: 'رقم غلط', phone: '123' }), /مش صحيح/);
  const list = call('apiServants');
  assert.equal(list.servants.length, 2);
  assert.deepEqual(list.methods.map(m => m.key), ['cash', 'instapay', 'wallet'], 'seeded methods');
  call('apiServantSave', servant.id, { name: 'مينا عادل', phone: '01099999999', publicWa: true });
  const rows = call('apiActivity', {});
  assert.ok(!JSON.stringify(rows).includes('1099999999') && !JSON.stringify(rows).includes('1012345678'), 'no phone in the activity log');
});


/* ---------------- service pages + home card ---------------- */

test('a page with «إظهار في الصفحة الرئيسية» gets ONE card in a «خدماتنا» section; saves update it, never duplicate it', () => {
  const ctx = setup();
  const { world, call } = ctx;
  const page = theatre(ctx);

  assert.ok(page.card && page.card.show, 'the card exists and is on');
  let cards = activities(world).filter(a => a.page === page.page.id);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].type, 'black-theatre');
  assert.equal(cards[0].title, 'المسرح الأسود');
  assert.equal(cards[0].subtitle, 'عروض بالنور والضلمة');
  assert.equal(cards[0].image, ctx.cover.id);

  // the type was moved? no: an existing type keeps its section; a `service` card makes «خدماتنا»
  call('apiPageSave', page.page.id, { ...page.page, cardType: 'service', title: 'المسرح الأسود ✨', home: { show: true, cta: 'اتفرج' } });
  call('apiPageSave', page.page.id, { ...page.page, cardType: 'service', title: 'المسرح الأسود ✨', home: { show: true, cta: 'اتفرج' } });
  cards = activities(world).filter(a => a.page === page.page.id);
  assert.equal(cards.length, 1, 'still one card');
  assert.equal(cards[0].title, 'المسرح الأسود ✨');
  assert.equal(cards[0].ctaLabel, 'اتفرج');
  const services = sections(world).filter(s => s.key === 'services');
  assert.equal(services.length, 1, 'the services section was made once');
  assert.equal(services[0].kind, 'items');
  const order = Object.fromEntries(sections(world).map(s => [s.key, Number(s.order)]));
  if (!Number.isNaN(order.activities)) assert.ok(order.services > order.activities, 'right after «الفعاليات»');
  assert.equal(world.gs.readOptionalTable_('Types').filter(t => t.key === 'service').length, 1);
});

test('publish: stub + page.json at /<slug>/, content.json pages[] and a linked «شاهد» card; hiding the card keeps the page', () => {
  const ctx = setup();
  const { world, call } = ctx;
  publish(world, call);
  const page = theatre(ctx, { cardType: 'service' });
  const first = publish(world, call);

  const files = world.github.files();
  const stub = files['black-theatre/index.html'];
  assert.ok(stub, 'the stub');
  assert.match(stub, /<html lang="ar" dir="rtl" data-kind="page" data-slug="black-theatre" data-v="[0-9a-f]{12}">/);
  assert.match(stub, /<title>المسرح الأسود \|/);
  assert.match(stub, /property="og:url" content="https:\/\/stathanasiosyouth\.github\.io\/black-theatre\/"/);
  assert.match(stub, /href="\.\.\/assets\/css\/page\.css"/, 'same depth as the shell: URLs unchanged');

  const def = json(files, 'black-theatre/page.json');
  assert.equal(def.slug, 'black-theatre');
  assert.equal(def.hero.type, 'video');
  assert.deepEqual([def.hero.start, def.hero.end], [2, 12]);
  assert.equal(def.media.length, 2);
  assert.equal(def.media[0].source, 'clip');
  assert.equal(def.media[0].ctaLabel, 'شاهد المسرحية كاملة');
  assert.equal(def.media[1].source, 'link');
  assert.equal(def.team.people.length, 1, 'only the servant who agreed to show his number');
  assert.match(def.team.people[0].wa, /^https:\/\/wa\.me\/201012345678\?text=/);
  assert.equal(def.team.title, 'عايز تنضم لفريق المسرح؟');
  assert.ok(!JSON.stringify(def).includes('1112345678'), 'the other servant\'s number is not published');

  const content = json(files, 'content.json');
  assert.deepEqual(content.pages.map(p => p.slug), ['black-theatre']);
  assert.equal(content.pages[0].v, def.v);
  const card = content.activities.find(a => a.page === 'black-theatre');
  assert.ok(card, 'the home card');
  assert.equal(card.section, 'services');
  assert.equal(card.watch, true);
  assert.equal(card.cta, null);
  assert.equal(card.ctaLabel, '');
  assert.ok(content.layout.some(s => s.key === 'services'), '«خدماتنا» on the page');
  assert.ok(first.review.groups.some(g => g.key === 'services'), 'the review names it');

  // hide the card: page stays, card goes
  call('apiPageSave', page.page.id, { ...call('apiPage', page.page.id).page, home: { show: false } });
  publish(world, call);
  const after = json(world.github.files(), 'content.json');
  assert.equal(after.activities.some(a => a.page), false, 'no card');
  assert.deepEqual(after.pages.map(p => p.slug), ['black-theatre'], 'the page is still published');
  assert.equal(activities(world).filter(a => a.page === page.page.id).length, 1, 'the card row is kept (hidden)');

  // show again: the SAME card comes back
  call('apiPageSave', page.page.id, { ...call('apiPage', page.page.id).page, home: { show: true } });
  assert.equal(activities(world).filter(a => a.page === page.page.id).length, 1);
  publish(world, call);
  assert.ok(json(world.github.files(), 'content.json').activities.some(a => a.page === 'black-theatre'));
});

test('stubs come from the committed shell (pages/index.html): its robots line dropped, an event one level deeper', async () => {
  const { readFileSync } = await import('node:fs');
  const { ROOT } = await import('../tools/lib/gs.mjs');
  const ctx = setup();
  const { world, call } = ctx;
  world.github.pushOther('pages/index.html', readFileSync(`${ROOT}pages/index.html`, 'utf8'));
  theatre(ctx, { cardType: 'service' });
  trip(ctx);
  publish(world, call);
  const files = world.github.files();
  const page = files['black-theatre/index.html'];
  const event = files['events/alex-trip/index.html'];
  for (const stub of [page, event]) {
    assert.ok(!/name="robots"/.test(stub), 'searchable');
    assert.ok(!/<!--/.test(stub), 'no comments');
    assert.match(stub, /assets\/js\/page\/main\.js/);
    assert.match(stub, /class="pbar__home"/, 'the real shell, not the built-in copy');
    assert.equal((stub.match(/<title>/g) || []).length, 1);
  }
  assert.match(page, /<html lang="ar" dir="rtl" data-kind="page" data-slug="black-theatre" data-v="[0-9a-f]{12}">/);
  assert.match(page, /href="\.\.\/assets\/css\/page\.css"/);
  assert.match(event, /<html lang="ar" dir="rtl" data-kind="event" data-slug="alex-trip" data-v="[0-9a-f]{12}">/);
  assert.ok(!/(?:href|src)="\.\.\/(?!\.\.\/)/.test(event), 'every relative URL one level deeper');
  assert.match(event, /href="\.\.\/\.\.\/"/, 'the home link');
});

test('a page that is switched off: card dropped, page.json says withdrawn, the stub stays; it can\'t be deleted once published', () => {
  const ctx = setup();
  const { world, call } = ctx;
  const page = theatre(ctx, { cardType: 'service' });
  publish(world, call);

  call('apiPageSetEnabled', page.page.id, false);
  assert.equal(activities(world).find(a => a.page === page.page.id).enabled, false, 'the card follows the page');
  publish(world, call);
  const files = world.github.files();
  assert.deepEqual(json(files, 'black-theatre/page.json'), { schema: 1, slug: 'black-theatre', withdrawn: true });
  assert.ok(files['black-theatre/index.html'], 'the stub stays: links keep working');
  const content = json(files, 'content.json');
  assert.equal(content.pages, undefined);
  assert.equal(content.activities.some(a => a.page), false);

  assert.throws(() => call('apiPageDelete', page.page.id), /اتنشرت قبل كده/);

  // back on: published again under the same slug, the card returns
  call('apiPageSetEnabled', page.page.id, true);
  publish(world, call);
  assert.equal(json(world.github.files(), 'black-theatre/page.json').withdrawn, undefined);
  assert.ok(json(world.github.files(), 'content.json').activities.some(a => a.page === 'black-theatre'));
});

test('slugs: reserved paths, repository folders, duplicates and a locked slug after publishing are refused', () => {
  const ctx = setup();
  const { world, call } = ctx;
  for (const slug of ['admin', 'assets', 'points', 'competition', 'events', 'media', 'privacy', 'Bad Slug', 'a', '-x-', 'x--y']) {
    assert.throws(() => call('apiPageSave', null, { slug, title: 'x' }), /الرابط/, slug);
  }
  // a folder that exists in the repository (GitHub's top-level listing, cached)
  world.github.pushOther('my-folder/readme.md', 'x');
  world.cache.clear();
  assert.throws(() => call('apiPageSave', null, { slug: 'my-folder', title: 'x' }), /محجوز/);
  const page = theatre(ctx);
  assert.throws(() => call('apiPageSave', null, { slug: 'black-theatre', title: 'تاني' }), /مستخدم/);
  publish(world, call);
  assert.throws(() => call('apiPageSave', page.page.id, { ...page.page, slug: 'other-name' }), /مينفعش يتغير بعد النشر/);
});

test('linked cards in the activities list: no delete / archive; switching one off hides it from its page\'s setting too', () => {
  const ctx = setup();
  const { world, call } = ctx;
  const page = theatre(ctx);
  const cardId = page.card.id;
  assert.throws(() => call('apiDeleteItem', 'activities', cardId), /ومينفعش يتمسح/);
  assert.throws(() => call('apiSetItemArchived', 'activities', cardId, true), /ومينفعش يتأرشف/);
  call('apiSetItemEnabled', 'activities', cardId, false);
  assert.equal(call('apiPage', page.page.id).page.home.show, false, 'the page\'s «إظهار» follows');
  call('apiSetItemEnabled', 'activities', cardId, true);
  assert.equal(call('apiPage', page.page.id).page.home.show, true);
  assert.equal(activities(world).filter(a => a.page === page.page.id).length, 1);
  // a copy of a linked card is a plain card
  const copy = call('apiDuplicateItem', 'activities', cardId);
  const rows = activities(world).filter(a => a.title && a.title.includes('المسرح الأسود'));
  assert.equal(rows.filter(a => a.page).length, 1, 'only the original is linked');
  void copy;
});

test('a never-published page can be deleted: its card and its media cards go with it', () => {
  const ctx = setup();
  const { world, call } = ctx;
  const page = theatre(ctx);
  call('apiPageDelete', page.page.id);
  assert.equal(activities(world).some(a => a.page === page.page.id), false);
  assert.equal(call('apiPages').pages.length, 0);
});


/* ---------------- events ---------------- */

test('an event: stub + event.json under /events/<slug>/, booking shown (online false), its card with the booking window', () => {
  const ctx = setup();
  const { world, call } = ctx;
  const saved = trip(ctx);
  assert.equal(saved.event.servants[0].methods.join(), 'cash,instapay', 'unknown methods dropped');
  assert.equal(saved.event.booking.pricing.categories[0].key, 'applicant');
  assert.ok(saved.card.show);

  publish(world, call);
  const files = world.github.files();
  const stub = files['events/alex-trip/index.html'];
  assert.ok(stub);
  assert.match(stub, /data-kind="event" data-slug="alex-trip"/);
  assert.match(stub, /href="\.\.\/\.\.\/assets\/css\/page\.css"/, 'one level deeper');
  assert.ok(!/(?:href|src)="\.\.\/(?!\.\.)/.test(stub.replace(/<head>[\s\S]*?<\/head>/, m => m)), 'no URL left one level up');

  const def = json(files, 'events/alex-trip/event.json');
  assert.equal(def.kind, 'trip');
  assert.equal(def.kindLabel, 'رحلة');
  assert.equal(def.booking.online, false);
  assert.equal(def.booking.capacity, 50);
  assert.deepEqual(def.booking.methods.map(m => m.key), ['cash', 'instapay']);
  assert.equal(def.booking.servants[0].wa, 'https://wa.me/201012345678');
  assert.equal(def.booking.payment.mode, 'installments');
  assert.equal(def.booking.payment.minFirst, 500);
  assert.match(def.startAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

  const content = json(files, 'content.json');
  assert.equal(content.events[0].slug, 'alex-trip');
  const card = content.activities.find(a => a.event === 'alex-trip');
  assert.ok(card);
  assert.equal(card.section, 'activities');
  assert.deepEqual(card.booking, { opensAt: def.booking.opensAt, closesAt: def.booking.closesAt });
  assert.equal(card.location, 'إسكندرية');
  assert.equal(card.startAt, def.startAt);
  // 12 hours after the end
  const end = new Date(def.endAt + ':00Z').getTime();
  const until = new Date(card.visibleUntil + ':00Z').getTime();
  assert.equal(until - end, 12 * 3600000);
});

test('the event card expires 12 hours after the event ends (the page stays)', () => {
  const ctx = setup();
  const { world, call } = ctx;
  trip(ctx, { startAt: wallAt(ctxNow(ctx), 60), endAt: wallAt(ctxNow(ctx), 120), booking: null });
  publish(world, call);
  assert.ok(json(world.github.files(), 'content.json').activities.some(a => a.event === 'alex-trip'));
  world.advance((2 + 11) * 3600000);
  call('apiSaveSettings', { 'site.tagline': 'تغيير صغير' });
  publish(world, call);
  assert.ok(json(world.github.files(), 'content.json').activities.some(a => a.event === 'alex-trip'), 'still there 11 h after the end');
  world.advance(2 * 3600000);
  call('apiSaveSettings', { 'site.tagline': 'تغيير تاني' });
  publish(world, call);
  const content = json(world.github.files(), 'content.json');
  assert.equal(content.activities.some(a => a.event === 'alex-trip'), false, 'gone 13 h after');
  assert.deepEqual(content.events.map(e => e.slug), ['alex-trip'], 'the event page itself is still published');
});

function ctxNow(ctx) { return ctx.world; }

test('event validation: kind, times, booking window and pricing problems are named', () => {
  const ctx = setup();
  const { world, call } = ctx;
  assert.throws(() => call('apiEventSave', null, { slug: 'x-trip', title: 'x', kind: 'boat', startAt: wallAt(world, 60) }), /نوع الفعالية/);
  assert.throws(() => call('apiEventSave', null, { slug: 'x-trip', title: 'x', kind: 'trip' }), /ميعاد البداية مطلوب/);
  assert.throws(() => call('apiEventSave', null, { slug: 'x-trip', title: 'x', kind: 'trip', startAt: wallAt(world, 120), endAt: wallAt(world, 60) }), /بعد البداية/);
  assert.throws(() => call('apiEventSave', null, {
    slug: 'x-trip', title: 'x', kind: 'trip', startAt: wallAt(world, 120),
    booking: { opensAt: wallAt(world, 10), closesAt: wallAt(world, 200), pricing: { categories: [{ price: 100 }] } }
  }), /لازم يقفل قبل ما الفعالية تبدأ/);
  assert.throws(() => call('apiEventSave', null, {
    slug: 'x-trip', title: 'x', kind: 'trip', startAt: wallAt(world, 120),
    booking: { pricing: { categories: [{ price: -5 }] } }
  }), /السعر/);
  assert.throws(() => call('apiEventSave', null, { slug: 'x-trip', title: 'x', kind: 'trip', startAt: wallAt(world, 120), home: { show: true } }), /صورة الغلاف مطلوبة/);
});

test('archiving an event hides its card and withdraws its page; a fun day is its own kind with its own card type', () => {
  const ctx = setup();
  const { world, call } = ctx;
  const saved = trip(ctx);
  const fun = call('apiEventSave', null, { slug: 'fun-day', kind: 'funday', title: 'يوم ترفيهي', cover: ctx.cover.id, startAt: wallAt(world, 2000), home: { show: true } });
  assert.equal(activities(world).find(a => a.event === fun.event.id).type, 'funday');
  assert.equal(world.gs.readOptionalTable_('Types').filter(t => t.key === 'funday').length, 1);
  publish(world, call);
  call('apiEventArchive', saved.event.id, true);
  publish(world, call);
  const files = world.github.files();
  assert.equal(json(files, 'events/alex-trip/event.json').withdrawn, true);
  const content = json(files, 'content.json');
  assert.deepEqual(content.events.map(e => e.slug), ['fun-day']);
  assert.deepEqual(content.activities.filter(a => a.event).map(a => a.event), ['fun-day']);
});

test('notifications can point at a page or an event; the push opens it in the same tab', () => {
  const ctx = setup();
  const { world, call } = ctx;
  theatre(ctx, { cardType: 'service' });
  trip(ctx);
  call('apiSaveItem', 'notifications', { title: 'شوف المسرح', target: 'page:black-theatre', publishAt: wallAt(world, -5) });
  call('apiSaveItem', 'notifications', { title: 'الحجز فتح', target: 'event:alex-trip', publishAt: wallAt(world, -5) });
  assert.throws(() => call('apiSaveItem', 'notifications', { title: 'x', target: 'page:nothing-here' }), /صفحة مش موجودة/);
  publish(world, call);
  const content = json(world.github.files(), 'content.json');
  const targets = content.notifications.map(n => n.target).filter(Boolean);
  assert.deepEqual(targets.filter(t => t.kind === 'page' || t.kind === 'event'), [{ kind: 'page', slug: 'black-theatre' }, { kind: 'event', slug: 'alex-trip' }].filter(t => targets.some(x => x.kind === t.kind)));
  assert.equal(world.gs.pushUrl_({ kind: 'page', slug: 'black-theatre' }), '/black-theatre/');
  assert.equal(world.gs.pushUrl_({ kind: 'event', slug: 'alex-trip' }), '/events/alex-trip/');
});

test('an unchanged page is not rewritten; a changed one gets a new v (and a new revision)', () => {
  const ctx = setup();
  const { world, call } = ctx;
  const page = theatre(ctx, { cardType: 'service' });
  const first = publish(world, call);
  const v1 = json(world.github.files(), 'black-theatre/page.json').v;
  call('apiPageSave', page.page.id, { ...call('apiPage', page.page.id).page, description: 'وصف جديد' });
  const second = publish(world, call);
  const v2 = json(world.github.files(), 'black-theatre/page.json').v;
  assert.notEqual(v1, v2);
  assert.notEqual(first.revision, second.revision);
});

test('the preview builds the draft page even while it is off, with the media it needs', () => {
  const ctx = setup();
  const { call } = ctx;
  const page = theatre(ctx, { enabled: false });
  const preview = call('apiPagePreview', 'page', page.page.id);
  assert.equal(preview.kind, 'page');
  assert.equal(preview.data.slug, 'black-theatre');
  assert.ok(preview.media.some(m => m.id === ctx.cover.id && m.published === false));
});


/* ---------------- partners (B.U.G., §12) ---------------- */

test('«بإشراف B.U.G.»: the page / event JSON carry the partner, the stub says data-partner, the card and content.json name it', () => {
  const ctx = setup();
  const { world, call } = ctx;
  const page = theatre(ctx, { cardType: 'service', partner: 'bug' });
  assert.equal(page.page.partner, 'bug');
  trip(ctx);
  assert.equal(call('apiEventSave', null, { slug: 'x-trip', title: 'x', kind: 'trip', startAt: wallAt(world, 600), partner: 'someone' }).event.partner, '', 'unknown partner keys are dropped');
  publish(world, call);
  const files = world.github.files();
  const def = json(files, 'black-theatre/page.json');
  assert.equal(def.partner.key, 'bug');
  assert.equal(def.partner.name, 'Brave Under Grace – B.U.G.');
  assert.match(def.partner.logo.src, /^assets\/img\/partners\/bug-logo-720\.webp$/);
  assert.match(def.partner.mark.src, /^assets\/img\/partners\/bug-symbol-320\.webp$/);
  assert.match(files['black-theatre/index.html'], /data-partner="bug">/);
  assert.equal(json(files, 'events/alex-trip/event.json').partner, null);
  assert.ok(!/data-partner/.test(files['events/alex-trip/index.html']));
  const content = json(files, 'content.json');
  assert.deepEqual(Object.keys(content.partners), ['bug']);
  assert.equal(content.pages[0].partner, 'bug');
  assert.equal(content.events.find(e => e.slug === 'alex-trip').partner, null);
  assert.equal(content.activities.find(a => a.page === 'black-theatre').partner, 'bug');
  assert.equal(content.activities.find(a => a.event === 'alex-trip').partner, undefined);

  // taken off: no partner anywhere, content.json without `partners`
  call('apiPageSave', page.page.id, { ...call('apiPage', page.page.id).page, partner: '' });
  publish(world, call);
  const after = json(world.github.files(), 'content.json');
  assert.equal(after.partners, undefined);
  assert.equal(json(world.github.files(), 'black-theatre/page.json').partner, null);
  for (const path of ['assets/img/partners/bug-logo-720.webp', 'assets/img/partners/bug-logo-360.webp', 'assets/img/partners/bug-symbol-320.webp']) {
    assert.ok(existsSync(`${ROOT_DIR}${path}`), path + ' is in the repository');
  }
});


/* ---------------- video cards: the cover is optional with a preview clip ---------------- */

test('a video card with a preview clip and no picture shows a frame of the clip; a link-only card still needs its picture', () => {
  const ctx = setup();
  const { world, call, clip } = ctx;
  const page = call('apiPageSave', null, { slug: 'silent-theatre', title: 'المسرح الصامت', cover: ctx.cover.id, home: { show: false } });
  call('apiPageMediaSave', page.page.id, null, { title: 'مقطع من العرض', text: 'وصف قصير', source: 'clip', clip: clip.id + '@1-9', fullUrl: 'https://youtu.be/full', ctaLabel: 'شاهد العرض كامل' });
  assert.throws(() => call('apiPageMediaSave', page.page.id, null, { title: 'لينك بس', source: 'link', fullUrl: 'https://youtu.be/x' }), /صورة الكارت مطلوبة/);
  assert.throws(() => call('apiPageMediaSave', page.page.id, null, { title: 'من غير مقطع', source: 'clip' }), /مقطع العرض جوه الصفحة/);
  publish(world, call);
  const def = json(world.github.files(), 'silent-theatre/page.json');
  assert.equal(def.media.length, 1);
  const card = def.media[0];
  assert.equal(card.source, 'clip');
  assert.equal(card.cover.src, card.clip.poster, 'the clip\'s poster is the card\'s picture');
  assert.deepEqual([card.clip.start, card.clip.end], [1, 9]);
  assert.equal(card.text, 'وصف قصير');
  assert.equal(card.fullUrl, 'https://youtu.be/full');
  assert.equal(card.ctaLabel, 'شاهد العرض كامل');
});
