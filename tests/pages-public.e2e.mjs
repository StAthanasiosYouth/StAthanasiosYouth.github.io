// Service pages and events (docs/EVENTS.md §17) in headless Chrome: a
// service page (hero, the YouTube-style grid at three widths, the team),
// the video sheet (open / ready / next / Escape / back / #v/<id>), an event
// page with its «احجز الآن» area and WhatsApp text, a withdrawn page, the
// bare shell's redirect, the /events/ list, and the home page's cards
// («خدماتنا», the automatic button through the booking window, the card
// gone 12 h after the event, a card whose page isn't published), and the
// B.U.G. co-branding (docs/EVENTS.md §12): the hero lockup, the cards' chip,
// and collab.js's intro (first visit, once a session, skipped with reduced
// motion, a #hash, a tap, and in the preview).
//
// page.json / event.json come from tests/fixtures/pages/ through this
// test's own server (never committed into the site); stubs are made from
// the shell the way the publisher does. The world's clock is the server's
// Date header (the pages correct the device clock with it).
//
// Run: cd tools && node --test ../tests/pages-public.e2e.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT } from '../tools/lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 4975;
const SHOTS = `${ROOT}tools/.cache/pages/`;
const BASE = `http://localhost:${PORT}`;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const PHONE = { width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const TABLET = { width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1366, height: 768, deviceScaleFactor: 1 };
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

const FIX = `${ROOT}tests/fixtures/pages/`;
const PAGE = JSON.parse(readFileSync(`${FIX}page.json`, 'utf8'));
const EVENT = JSON.parse(readFileSync(`${FIX}event.json`, 'utf8'));
const WITHDRAWN = JSON.parse(readFileSync(`${FIX}withdrawn.json`, 'utf8'));
const PAGE_BUG = JSON.parse(readFileSync(`${FIX}page-partner.json`, 'utf8'));
const EVENT_BUG = JSON.parse(readFileSync(`${FIX}event-partner.json`, 'utf8'));
const SHELL = readFileSync(`${ROOT}pages/index.html`, 'utf8');
const SEED = JSON.parse(readFileSync(`${ROOT}content.json`, 'utf8'));

// the server's clock (Cairo is UTC+3 until the end of October 2026)
const BEFORE_OPEN = 'Fri, 09 Oct 2026 09:00:00 GMT';     // 2026-10-09T12:00 Cairo
const WINDOW_OPEN = 'Tue, 13 Oct 2026 09:00:00 GMT';     // 2026-10-13T12:00
const AFTER_CLOSE = 'Thu, 22 Oct 2026 09:00:00 GMT';     // 2026-10-22T12:00 (closesAt 10-21 23:00)
const AFTER_EVENT = 'Sun, 25 Oct 2026 08:00:00 GMT';     // 2026-10-25T11:00 (endAt 10-24 22:00 + 12 h = 10:00)

let clock = WINDOW_OPEN;


/* =========================================================
   THE WORLD
========================================================= */

/* the home page's content.json: a «خدماتنا» section, a page card, an event card, an unpublished page's card */
function siteContent() {
  const content = JSON.parse(JSON.stringify(SEED));
  const at = content.layout.findIndex(s => s.key === 'activities');
  content.layout.splice(at + 1, 0, { key: 'services', kind: 'items', title: 'خدماتنا', subtitle: '', icon: 'theatre', theme: 'night', banner: null, visibleFrom: '', visibleUntil: '' });
  content.types = [
    { key: 'trip', label: 'رحلة', icon: 'bus', theme: 'azure', banner: null },
    { key: 'service', label: 'خدمة', icon: 'theatre', theme: 'night', banner: null }
  ];
  content.pages = [{ id: PAGE.id, slug: PAGE.slug, title: PAGE.title, tagline: PAGE.tagline, cover: PAGE.cover, v: PAGE.v }];
  content.events = [{ id: EVENT.id, slug: EVENT.slug, kind: EVENT.kind, kindLabel: EVENT.kindLabel, title: EVENT.title, shortTitle: EVENT.shortTitle, summary: EVENT.summary, cover: EVENT.cover, startAt: EVENT.startAt, endAt: EVENT.endAt, booking: { opensAt: EVENT.booking.opensAt, closesAt: EVENT.booking.closesAt }, v: EVENT.v, partner: 'bug' }];
  // «بإشراف B.U.G.» (§12): the partner, once, for the cards' chips
  content.partners = { bug: PAGE_BUG.partner };
  content.activities = [
    { id: 'act-page0001', type: 'service', section: 'services', title: PAGE.title, subtitle: PAGE.tagline, description: '', image: PAGE.cover, cta: null, location: '', startAt: '', endAt: '', visibleFrom: '', visibleUntil: '', page: PAGE.slug, ctaLabel: '', watch: true },
    { id: 'act-page0002', type: 'service', section: 'services', title: 'المسرح الصامت', subtitle: '', description: '', image: null, cta: null, location: '', startAt: '', endAt: '', visibleFrom: '', visibleUntil: '', page: 'silent-theatre', ctaLabel: '', watch: false },
    { id: 'act-evt00001', type: 'trip', section: 'activities', title: EVENT.title, subtitle: EVENT.summary, description: '', image: EVENT.cover, cta: null, location: EVENT.location.name, startAt: EVENT.startAt, endAt: EVENT.endAt, visibleFrom: '', visibleUntil: '2026-10-25T10:00', event: EVENT.slug, ctaLabel: '', booking: { opensAt: EVENT.booking.opensAt, closesAt: EVENT.booking.closesAt }, partner: 'bug' }
  ];
  return content;
}

/* what the publisher's pageStubHtml_ does (plus its own head tags) */
function stub(kind, slug, v, partner = '') {
  const html = SHELL.replace(/\r\n/g, '\n').replace('  <meta name="robots" content="noindex">\n', '')
    .replace('<html lang="ar" dir="rtl">', `<html lang="ar" dir="rtl" data-kind="${kind}" data-slug="${slug}" data-v="${v}"${partner ? ` data-partner="${partner}"` : ''}>`);
  return kind === 'event' ? html.replace(/(\s(?:href|src)=")\.\.\//g, '$1../../') : html;
}

const PREVIEW_PARENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>preview parent</title></head>
<body><iframe id="frame" title="preview" src="/pages/index.html?preview" width="390" height="800"></iframe></body></html>`;


/* =========================================================
   SERVER (site files + test-only routes)
========================================================= */

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.ics': 'text/calendar', '.mp4': 'video/mp4' };
const PRIVATE = /^\/(apps-script|tools|tests|docs|node_modules)(\/|$)|\/\.|\.md$/i;

let server;
let browser;

function send(req, res, status, type, body) {
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', Date: clock, 'Accept-Ranges': 'bytes' };
  // byte ranges, like GitHub Pages (videos ask for them)
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (status === 200 && range && (range[1] || range[2]) && Buffer.isBuffer(body)) {
    const from = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
    const to = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${from}-${to}/${body.length}` });
    res.end(body.subarray(from, to + 1));
    return;
  }
  res.writeHead(status, headers);
  res.end(body);
}

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const ok = (type, body) => send(req, res, 200, type, body);
    if (path === '/__test/preview-parent.html') return ok(TYPES['.html'], PREVIEW_PARENT);
    if (path === '/content.json') return ok(TYPES['.json'], JSON.stringify(siteContent()));
    if (/^\/black-theatre\/(index\.html)?$/.test(path)) return ok(TYPES['.html'], stub('page', 'black-theatre', PAGE.v));
    if (path === '/black-theatre/page.json') return ok(TYPES['.json'], JSON.stringify(PAGE));
    if (/^\/old-page\/(index\.html)?$/.test(path)) return ok(TYPES['.html'], stub('page', 'old-page', 'x1'));
    if (path === '/old-page/page.json') return ok(TYPES['.json'], JSON.stringify(WITHDRAWN));
    if (/^\/events\/ain-sokhna-trip\/(index\.html)?$/.test(path)) return ok(TYPES['.html'], stub('event', EVENT.slug, EVENT.v));
    if (path === '/events/ain-sokhna-trip/event.json') return ok(TYPES['.json'], JSON.stringify(EVENT));
    // B.U.G. (§12): the stubs say data-partner="bug"
    if (/^\/bug-theatre\/(index\.html)?$/.test(path)) return ok(TYPES['.html'], stub('page', PAGE_BUG.slug, PAGE_BUG.v, 'bug'));
    if (path === '/bug-theatre/page.json') return ok(TYPES['.json'], JSON.stringify(PAGE_BUG));
    if (/^\/events\/bug-camp\/(index\.html)?$/.test(path)) return ok(TYPES['.html'], stub('event', EVENT_BUG.slug, EVENT_BUG.v, 'bug'));
    if (path === '/events/bug-camp/event.json') return ok(TYPES['.json'], JSON.stringify(EVENT_BUG));
    try {
      if (PRIVATE.test(path)) throw new Error('private');
      const file = normalize(join(ROOT, path.endsWith('/') ? `${path}index.html` : path));
      if (!file.startsWith(normalize(ROOT)) || !statSync(file).isFile()) throw new Error('no');
      return ok(TYPES[extname(file)] || 'application/octet-stream', readFileSync(file));
    }
    catch {
      return send(req, res, 404, 'text/plain', '404');
    }
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
});

test.after(async () => {
  await browser?.close();
  server?.close();
});


/* =========================================================
   HELPERS
========================================================= */

async function open(path, viewport = PHONE, { reduced = true, init = null, waitUntil = 'networkidle0' } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const outside = [];
  page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource.*404/.test(msg.text())) problems.push(`console: ${msg.text()}`); });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  await page.evaluateOnNewDocument(() => document.addEventListener('securitypolicyviolation', e => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]);
  await page.setViewport(viewport);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname !== 'localhost' && url.protocol !== 'data:' && url.protocol !== 'blob:') {
      outside.push(url.href);
      return request.respond({ status: 204, body: '' });
    }
    return request.continue();
  });
  for (const script of [].concat(init || [])) await page.evaluateOnNewDocument(script);
  await page.goto(`${BASE}${path}`, { waitUntil });
  return { context, page, problems, outside };
}

const ready = page => page.waitForSelector('main[data-state="ready"], main[data-state="unavailable"], main[data-state="error"]', { timeout: 8000 });
const textOf = (page, selector) => page.$eval(selector, el => el.textContent.replace(/\s+/g, ' ').trim());
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const columns = (page, selector) => page.$$eval(selector, els => new Set(els.map(el => Math.round(el.getBoundingClientRect().left))).size);

async function axe(page, selector = '') {
  await page.evaluate(AXE);
  const result = await page.evaluate((tags, selector) => window.axe.run(selector ? document.querySelector(selector) : document, { runOnly: { type: 'tag', values: tags } }), AXE_TAGS, selector);
  return result.violations.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
}


/* =========================================================
   SERVICE PAGE
========================================================= */

test('service page: hero, title, tagline, cards, team; 1 / 2 / 3 columns; no overflow; axe', async () => {
  clock = WINDOW_OPEN;
  for (const [viewport, cols] of [[PHONE, 1], [TABLET, 2], [DESKTOP, 3]]) {
    const { context, page, problems, outside } = await open('/black-theatre/', viewport);
    await ready(page);
    assert.equal(await page.$eval('main', el => el.dataset.state), 'ready');
    assert.equal(await textOf(page, '.phero__title'), 'المسرح الأسود');
    assert.equal(await textOf(page, '.phero__lead'), PAGE.tagline);
    assert.equal(await page.title(), 'المسرح الأسود – أسرة البابا أثناسيوس');
    assert.equal(await page.$eval('html', el => el.dataset.theme), 'night');
    // reduced motion: the poster (the cover), never the looping clip
    assert.equal(await page.$('.phero video'), null);
    assert.match(await page.$eval('.phero__img', el => el.currentSrc || el.src), /img-b0d59876/);
    assert.equal((await page.$$('.mcard')).length, 4);
    assert.equal(await columns(page, '.mcard'), cols, `${viewport.width}px: ${cols} column(s)`);
    assert.ok(await overflow(page) <= 0, `${viewport.width}px: no horizontal scroll`);
    assert.equal(await textOf(page, '.mcard .mcard__dur'), '١:٢٠');
    // the link-only card opens the full play in a new tab
    const link = await page.$eval('.mcard--link .stretched', a => ({ href: a.href, target: a.target, rel: a.rel, tag: a.tagName }));
    assert.deepEqual(link, { href: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', target: '_blank', rel: 'noopener', tag: 'A' });
    // the team
    assert.equal(await textOf(page, '.team__title'), 'عايز تنضم لفريق المسرح؟');
    const wa = await page.$$eval('.team .btn--wa', els => els.map(a => [a.href, a.target, a.rel]));
    assert.equal(wa.length, 2);
    assert.match(wa[0][0], /^https:\/\/wa\.me\/201001234567\?text=/);
    assert.deepEqual(wa[0].slice(1), ['_blank', 'noopener']);
    await page.screenshot({ path: `${SHOTS}page-${viewport.width}.png`, fullPage: true });
    if (viewport === PHONE) assert.deepEqual(await axe(page), []);
    assert.deepEqual(problems, []);
    assert.deepEqual(outside, [], 'no outside requests');
    await context.close();
  }
});

test('service page with motion: the hero is a muted looping clip with a pause button', async () => {
  const { context, page, problems } = await open('/black-theatre/', DESKTOP, { reduced: false });
  await ready(page);
  const hero = await page.$eval('.phero video', v => ({ muted: v.muted, loop: v.loop, controls: v.controls, src: v.getAttribute('src') }));
  assert.equal(hero.muted, true);
  assert.equal(hero.loop, true);
  assert.equal(hero.controls, false);
  assert.match(hero.src, /vid-0e05ae88\.mp4$/);
  await page.click('.phero__toggle');
  assert.equal(await page.$eval('.phero video', v => v.paused), true);
  assert.equal(await page.$eval('.phero__toggle', b => b.getAttribute('aria-label')), 'شغّل الفيديو');
  assert.deepEqual(problems, []);
  await context.close();
});


/* =========================================================
   VIDEO SHEET
========================================================= */

const sheetState = page => page.evaluate(() => {
  const d = document.querySelector('dialog.vsheet');
  const v = d && d.querySelector('video');
  return d && {
    open: d.open,
    id: d.dataset.id || '',
    hash: location.hash,
    title: d.querySelector('.vsheet__title').textContent,
    cta: d.querySelector('.vsheet__cta').hidden ? null : { href: d.querySelector('.vsheet__cta').href, target: d.querySelector('.vsheet__cta').target, rel: d.querySelector('.vsheet__cta').rel },
    src: v.getAttribute('src') || '',
    paused: v.paused,
    controls: v.controls,
    playsinline: v.hasAttribute('playsinline'),
    preload: v.getAttribute('preload'),
    poster: v.getAttribute('poster') || '',
    focus: document.activeElement && document.activeElement.className
  };
});

test('video sheet: tap → open (#v/<id>), ready, own shape; next by button and arrow (link cards skipped); Escape and back close it', async () => {
  clock = WINDOW_OPEN;
  const { context, page, problems } = await open('/black-theatre/', PHONE);
  await ready(page);

  await page.click('[data-media="pm-clip0001"]');
  await page.waitForFunction(() => document.querySelector('dialog.vsheet')?.open);
  let s = await sheetState(page);
  assert.equal(s.open, true);
  assert.equal(s.hash, '#v/pm-clip0001');
  assert.equal(s.title, 'يونان في بطن الحوت');
  assert.match(s.src, /media\/2026\/vid-10486833\.mp4#t=1,4$/);
  assert.equal(s.controls, true);
  assert.equal(s.playsinline, true);
  assert.equal(s.preload, 'metadata');
  assert.match(s.poster, /img-c1308156\.webp$/);
  assert.equal(s.paused, true, 'no autoplay: playback starts on the visitor\'s tap');
  assert.equal(s.focus, 'vsheet__close', 'focus moves into the dialog');
  assert.deepEqual(s.cta, { href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', target: '_blank', rel: 'noopener' });
  // ready to play, at its start, at the clip's own (portrait) shape
  await page.waitForFunction(() => document.querySelector('dialog.vsheet video').readyState >= 1, { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector('dialog.vsheet video').currentTime >= 0.9, { timeout: 4000 });
  const box = await page.$eval('dialog.vsheet video', v => { const r = v.getBoundingClientRect(); return { w: r.width, h: r.height, vh: innerHeight }; });
  assert.ok(Math.abs(box.w / box.h - 270 / 480) < 0.03, `portrait ${box.w}x${box.h}`);
  assert.ok(box.h <= box.vh * 0.8 + 1, 'at most 80% of the screen height');
  assert.ok(await overflow(page) <= 0);
  await page.screenshot({ path: `${SHOTS}sheet-360.png` });

  // next (button), then ← (RTL: forward); the link-only card is not in the sheet
  await page.click('.vsheet__nav:last-child');
  s = await sheetState(page);
  assert.deepEqual([s.id, s.hash, s.title, s.cta], ['pm-clip0002', '#v/pm-clip0002', 'الابن الضال', null]);
  await page.keyboard.press('ArrowLeft');
  s = await sheetState(page);
  assert.deepEqual([s.id, s.hash], ['pm-clip0004', '#v/pm-clip0004']);
  await page.keyboard.press('ArrowRight');
  assert.equal((await sheetState(page)).id, 'pm-clip0002');

  // Escape closes it and takes the #v/ entry back off the history
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.vsheet').open);
  await page.waitForFunction(() => location.hash === '');
  s = await sheetState(page);
  assert.equal(s.src, '', 'the clip is unloaded');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.media), 'pm-clip0001', 'focus back on the card');

  // the phone's back button closes it too (and stays on the page)
  await page.click('[data-media="pm-clip0004"]');
  await page.waitForFunction(() => document.querySelector('dialog.vsheet')?.open);
  assert.equal((await sheetState(page)).hash, '#v/pm-clip0004');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('dialog.vsheet').open);
  assert.equal(new URL(page.url()).pathname, '/black-theatre/');
  assert.equal(await page.$eval('main', el => el.dataset.state), 'ready');

  // the close button
  await page.click('[data-media="pm-clip0002"]');
  await page.waitForFunction(() => document.querySelector('dialog.vsheet')?.open);
  await page.click('.vsheet__close');
  await page.waitForFunction(() => !document.querySelector('dialog.vsheet').open && location.hash === '');

  assert.deepEqual(problems, []);
  await context.close();
});

test('video sheet: #v/<id> deep link opens on load; closing cleans the address; an unknown id does nothing', async () => {
  const { context, page, problems } = await open('/black-theatre/#v/pm-clip0002', PHONE);
  await ready(page);
  await page.waitForFunction(() => document.querySelector('dialog.vsheet')?.open);
  const s = await sheetState(page);
  assert.deepEqual([s.id, s.title], ['pm-clip0002', 'الابن الضال']);
  await page.click('.vsheet__close');
  await page.waitForFunction(() => !document.querySelector('dialog.vsheet').open);
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(new URL(page.url()).pathname, '/black-theatre/');
  await context.close();

  const other = await open('/black-theatre/#v/pm-link0003', PHONE);
  await ready(other.page);
  assert.equal(await other.page.evaluate(() => !!document.querySelector('dialog.vsheet')?.open), false, 'a link card never opens the sheet');
  assert.deepEqual([...problems, ...other.problems], []);
  await other.context.close();
});


/* =========================================================
   EVENT PAGE
========================================================= */

test('event page: details, «احجز الآن» (prices, window, counter + total, servants\' WhatsApp text); axe; no overflow', async () => {
  clock = WINDOW_OPEN;
  const { context, page, problems, outside } = await open('/events/ain-sokhna-trip/', PHONE);
  await ready(page);
  assert.equal(await page.$eval('main', el => el.dataset.state), 'ready');
  assert.equal(await textOf(page, '.phero__title'), 'رحلة العين السخنة');
  assert.equal(await textOf(page, '.chip--kind'), 'رحلة');
  assert.equal(await page.$eval('html', el => el.dataset.theme), 'azure');
  assert.equal(await textOf(page, '.fact'), 'السبت ٢٤ أكتوبر من ٦ الصبح لـ ١٠ بالليل');
  assert.deepEqual(await page.$eval('.fact__link', a => [a.href, a.target, a.rel]), ['https://maps.google.com/?q=Ain+Sokhna', '_blank', 'noopener']);
  assert.equal((await page.$$('.gallery__item')).length, 2);

  assert.equal(await textOf(page, '#book-title'), 'احجز الآن');
  assert.equal(await page.$eval('#book', el => el.dataset.phase), 'open');
  assert.equal(await textOf(page, '.book__state'), 'الحجز مفتوح');
  assert.match(await textOf(page, '.book__window'), /^الحجز من السبت ١٠ أكتوبر الساعة ٧ بالليل لحد الأربع ٢١ أكتوبر الساعة ١١ بالليل$/);
  assert.equal(await textOf(page, '.book__line'), 'للحجز كلّم خادم من دول على واتساب');
  assert.equal((await page.$$('.price')).length, 4);
  assert.equal(await textOf(page, '.prices__total-n'), '١٬٥٠٠ جنيه');
  assert.deepEqual(await page.$$eval('.people--servants .chips', els => els.map(el => el.textContent)), ['كاشإنستاباي', 'كاش']);

  const servants = await page.$$eval('.people--servants .person', els => els.map(el => el.querySelector('.btn--wa')?.href || null));
  assert.equal(servants.length, 2);
  assert.equal(servants[1], null, 'no consent to publish WhatsApp: no button');
  let text = new URL(servants[0]).searchParams.get('text');
  assert.equal(text, 'سلام يا مينا عادل، عايز أحجز في «رحلة العين السخنة».');
  assert.equal(new URL(servants[0]).origin + new URL(servants[0]).pathname, 'https://wa.me/201001234567');

  // the optional counter: two extra people and a child → the total, and the WhatsApp text says so
  await page.click('[aria-label="زوّد فرد إضافي"]');
  await page.click('[aria-label="زوّد فرد إضافي"]');
  await page.click('[aria-label="زوّد طفل"]');
  assert.equal(await textOf(page, '.prices__total-n'), '٥٬٣٠٠ جنيه');
  text = new URL(await page.$eval('.people--servants .btn--wa', a => a.href)).searchParams.get('text');
  assert.equal(text, 'سلام يا مينا عادل، عايز أحجز في «رحلة العين السخنة».\n- الحاجز: ١\n- فرد إضافي: ٢\n- طفل: ١\nالإجمالي: ٥٬٣٠٠ جنيه');
  assert.equal(await page.$eval('[aria-label="قلّل فرد إضافي"]', b => b.disabled), false);
  assert.equal(await page.$eval('[aria-label="قلّل الحاجز"]', () => true).catch(() => false), false, 'the applicant has no counter');

  // the hero's button jumps to the booking area
  await page.click('.phero__cta');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'book-title');

  assert.ok(await overflow(page) <= 0);
  await page.screenshot({ path: `${SHOTS}event-360.png`, fullPage: true });
  assert.deepEqual(await axe(page), []);
  assert.deepEqual(problems, []);
  assert.deepEqual(outside, []);
  await context.close();
});

test('event page: before the window and after it closes', async () => {
  clock = BEFORE_OPEN;
  let { context, page } = await open('/events/ain-sokhna-trip/', TABLET);
  await ready(page);
  assert.equal(await page.$eval('#book', el => el.dataset.phase), 'before');
  assert.equal(await textOf(page, '.book__state'), 'الحجز لسه ما فتحش');
  assert.ok(await overflow(page) <= 0);
  await context.close();

  clock = AFTER_CLOSE;
  ({ context, page } = await open('/events/ain-sokhna-trip/', DESKTOP));
  await ready(page);
  assert.equal(await page.$eval('#book', el => el.dataset.phase), 'closed');
  await page.screenshot({ path: `${SHOTS}event-1366.png`, fullPage: true });
  assert.equal(await textOf(page, '.book__state'), 'الحجز اتقفل');
  assert.ok(await overflow(page) <= 0);
  await context.close();
  clock = WINDOW_OPEN;
});


/* =========================================================
   WITHDRAWN, THE BARE SHELL, THE LIST, THE PREVIEW
========================================================= */

test('a withdrawn page says so, with the way home', async () => {
  const { context, page, problems } = await open('/old-page/', PHONE);
  await ready(page);
  assert.equal(await page.$eval('main', el => el.dataset.state), 'unavailable');
  assert.equal(await textOf(page, '.pg-empty__title'), 'الصفحة دي مش متاحة دلوقتي');
  assert.equal(await page.$eval('.pg-empty a', a => a.href), `${BASE}/index.html`);
  assert.deepEqual(problems, []);
  await context.close();
});

test('/pages/ (the bare shell) goes to the home page', async () => {
  const { context, page } = await open('/pages/', PHONE);
  await page.waitForFunction(() => location.pathname === '/' || location.pathname === '/index.html', { timeout: 8000 });
  await context.close();
});

test('/events/: the published events, linked same-tab', async () => {
  clock = WINDOW_OPEN;
  const { context, page, problems } = await open('/events/', PHONE);
  await ready(page);
  assert.equal(await textOf(page, '.evlist__title'), 'الفعاليات');
  const cards = await page.$$eval('.ecard', els => els.map(el => ({ href: el.querySelector('a.stretched').href, target: el.querySelector('a.stretched').target, chip: el.querySelector('.chip--kind')?.textContent, cta: el.querySelector('.ecard__cta').textContent })));
  await page.screenshot({ path: `${SHOTS}events-360.png`, fullPage: true });
  assert.deepEqual(cards, [{ href: `${BASE}/events/ain-sokhna-trip/`, target: '', chip: 'رحلة', cta: 'احجز الآن' }]);
  assert.ok(await overflow(page) <= 0);
  assert.deepEqual(problems, []);
  await context.close();

  clock = AFTER_EVENT;
  const after = await open('/events/', PHONE);
  await ready(after.page);
  assert.equal((await after.page.$$('.ecard')).length, 0, 'gone 12 h after the event');
  assert.equal(await textOf(after.page, '.pg-empty__title'), 'مفيش فعاليات دلوقتي');
  await after.context.close();
  clock = WINDOW_OPEN;
});

test('preview: the draft by postMessage from a same-origin parent; images swapped for blob: URLs', async () => {
  const { context, page, problems } = await open('/__test/preview-parent.html', DESKTOP);
  const frame = await (await page.waitForSelector('#frame')).contentFrame();
  await frame.waitForSelector('main[data-state="loading"]');
  const shown = await page.evaluate(async page => {
    const blob = URL.createObjectURL(new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: 'image/webp' }));
    const frameWin = document.getElementById('frame').contentWindow;
    const got = new Promise(resolve => addEventListener('message', e => { if (e.data && /page-preview-(shown|error)/.test(e.data.type)) resolve(e.data.type); }));
    frameWin.postMessage({ type: 'athanasios:page-preview', kind: 'page', data: page, images: { 'media/2026/img-c1308156-480.webp': blob, 'media/2026/img-b0d59876-480.webp': 'https://evil.example/x.webp' } }, location.origin);
    return { type: await got, blob };
  }, PAGE);
  assert.equal(shown.type, 'athanasios:page-preview-shown');
  assert.equal(await frame.$eval('.phero__title', el => el.textContent), 'المسرح الأسود');
  const srcs = await frame.$$eval('.mcard__img', els => els.map(img => img.getAttribute('src')));
  assert.equal(srcs[0], shown.blob, 'a blob: of this origin replaces the published path');
  assert.equal(srcs[1], `${BASE}/media/2026/img-b0d59876-480.webp`, 'anything else is ignored');
  await frame.click('[data-media="pm-clip0001"]');
  await frame.waitForFunction(() => document.querySelector('dialog.vsheet')?.open);
  assert.equal(await frame.evaluate(() => location.hash), '', 'no history in the preview');
  // a broken draft
  const error = await page.evaluate(async () => {
    const got = new Promise(resolve => addEventListener('message', e => { if (e.data && /page-preview-(shown|error)/.test(e.data.type)) resolve(e.data.type); }));
    document.getElementById('frame').contentWindow.postMessage({ type: 'athanasios:page-preview', kind: 'page', data: { schema: 1, title: 'x' } }, location.origin);
    return got;
  });
  assert.equal(error, 'athanasios:page-preview-error');
  assert.deepEqual(problems, []);
  await context.close();
});


/* =========================================================
   THE HOME PAGE
========================================================= */

const homeCards = page => page.$$eval('.item-card[data-entry]', els => els.map(el => {
  const cta = el.querySelector('.item-card__cta');
  return {
    kind: el.dataset.entry,
    title: el.querySelector('.item-card__title').textContent.trim(),
    section: el.closest('[data-key]').dataset.key,
    label: cta.textContent.trim(),
    href: cta.href,
    target: cta.getAttribute('target'),
    chip: el.querySelector('.item-card__state')?.textContent.trim() || ''
  };
}));

async function home(viewport = PHONE) {
  const opened = await open('/', viewport);
  await opened.page.waitForSelector('main[data-state="ready"]', { timeout: 8000 });
  return opened;
}

test('home: «خدماتنا» with the page card («شاهد», same tab); the event card through its booking window; unpublished pages never linked', async () => {

  clock = WINDOW_OPEN;
  let { context, page, problems } = await home();
  assert.equal(await textOf(page, '[data-key="services"] .widget__title'), 'خدماتنا');
  assert.deepEqual(await homeCards(page), [
    { kind: 'event', title: 'رحلة العين السخنة', section: 'activities', label: 'احجز الآن', href: `${BASE}/events/ain-sokhna-trip/`, target: null, chip: 'بعد ١١ يوم' },
    { kind: 'page', title: 'المسرح الأسود', section: 'services', label: 'شاهد', href: `${BASE}/black-theatre/`, target: null, chip: '' }
  ]);
  assert.equal(await page.evaluate(() => document.body.textContent.includes('المسرح الصامت')), false, 'a card whose page isn\'t in content.pages is dropped');
  assert.ok(await overflow(page) <= 0);
  await (await page.$('[data-key="services"]')).screenshot({ path: `${SHOTS}home-services-360.png` });
  // a tap opens the page in this tab
  await Promise.all([page.waitForNavigation(), page.click('[data-key="services"] .item-card__cta')]);
  assert.equal(new URL(page.url()).pathname, '/black-theatre/');
  await ready(page);
  assert.deepEqual(problems, []);
  await context.close();

  clock = BEFORE_OPEN;
  ({ context, page } = await home());
  let event = (await homeCards(page)).find(c => c.kind === 'event');
  assert.deepEqual([event.label, event.chip], ['اعرف التفاصيل', 'الحجز يفتح السبت ١٠ أكتوبر']);
  await context.close();

  clock = AFTER_CLOSE;
  ({ context, page } = await home(DESKTOP));
  event = (await homeCards(page)).find(c => c.kind === 'event');
  assert.deepEqual([event.label, event.chip, event.href], ['اعرف التفاصيل', 'الحجز اتقفل', `${BASE}/events/ain-sokhna-trip/`]);
  assert.ok(await overflow(page) <= 0);
  await context.close();

  clock = AFTER_EVENT;
  ({ context, page } = await home());
  assert.deepEqual((await homeCards(page)).map(c => c.kind), ['page'], 'the event card is gone 12 h after the event');
  await context.close();

  clock = WINDOW_OPEN;

});



/* =========================================================
   B.U.G. CO-BRANDING (docs/EVENTS.md §12)
========================================================= */

/* before any page script: a capable device (collab.js skips weak ones), and a record of the intro */
function recordIntro() {
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 8, configurable: true });
  Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 8, configurable: true });
  const log = { added: null, removed: null, modes: [] };
  window.__collab = log;
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'attributes' && r.target === document.documentElement && r.attributeName === 'data-collab') {
        const mode = document.documentElement.getAttribute('data-collab');
        if (mode) log.modes.push(mode);
      }
      for (const node of r.addedNodes) if (node.classList && node.classList.contains('cintro')) log.added = performance.now();
      for (const node of r.removedNodes) if (node.classList && node.classList.contains('cintro')) log.removed = performance.now();
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-collab'] });
}

const introLog = page => page.evaluate(() => ({ ...window.__collab, overlay: !!document.querySelector('.cintro'), state: document.documentElement.dataset.collabState || '' }));

const lockup = page => page.evaluate(() => {
  const el = document.querySelector('.phero .collab');
  if (!el) return null;
  const box = el.getBoundingClientRect();
  const plate = el.querySelector('.collab__plate');
  const logo = el.querySelector('.collab__logo');
  const seal = el.querySelector('.collab__seal');
  const shown = logo.getBoundingClientRect();
  return {
    inside: box.left >= 0 && box.right <= document.documentElement.clientWidth && box.width > 0 && box.height > 0,
    caption: el.querySelector('.collab__caption').textContent,
    alt: logo.alt,
    loaded: logo.complete && logo.naturalWidth === 360 && seal.complete && seal.naturalWidth > 0,
    // the whole logo, at its own shape (never cropped)
    shape: Math.abs(shown.width / shown.height - 720 / 305) < 0.03,
    plate: getComputedStyle(plate).backgroundColor,
    x: el.querySelector('.collab__x').getAttribute('aria-hidden')
  };
});

const LOCKUP = { inside: true, caption: 'بإشراف Brave Under Grace – B.U.G.', alt: 'شعار Brave Under Grace – B.U.G.', loaded: true, shape: true, plate: 'rgb(255, 253, 249)', x: 'true' };

test('B.U.G. lockup: a partnered service page and event page at 360 and 1366; the whole logo on its light plate; no overflow; axe', async () => {
  clock = WINDOW_OPEN;
  for (const [path, name] of [['/bug-theatre/', 'page'], ['/events/bug-camp/', 'event']]) {
    for (const viewport of [PHONE, DESKTOP]) {
      const { context, page, problems, outside } = await open(path, viewport);
      await ready(page);
      assert.equal(await page.$eval('html', el => el.dataset.partner), 'bug');
      assert.deepEqual(await lockup(page), LOCKUP, `${name} ${viewport.width}px`);
      assert.equal(await page.$('.cintro'), null, 'reduced motion: no intro, the static lockup only');
      assert.ok(await overflow(page) <= 0, `${name} ${viewport.width}px: no horizontal scroll`);
      await page.screenshot({ path: `${SHOTS}partner-${name}-${viewport.width}.png` });
      if (viewport === PHONE) assert.deepEqual(await axe(page), []);
      assert.deepEqual(problems, []);
      assert.deepEqual(outside, []);
      await context.close();
    }
  }
  // a page without a partner has no lockup
  const plain = await open('/black-theatre/', PHONE);
  await ready(plain.page);
  assert.equal(await plain.page.$('.collab'), null);
  assert.equal(await plain.page.$eval('html', el => el.dataset.partner), undefined);
  await plain.context.close();
});

test('B.U.G. intro: the first visit plays the full overlay, gone within 2 s onto the lockup; the next B.U.G. page this session does not replay', async () => {
  clock = WINDOW_OPEN;
  const { context, page, problems } = await open('/bug-theatre/', PHONE, { reduced: false, init: recordIntro, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__collab.added !== null, { timeout: 3000 });
  assert.equal(await page.$eval('.cintro', el => el.getAttribute('aria-hidden')), 'true');
  await page.waitForFunction(() => performance.now() - window.__collab.added > 950);
  await page.screenshot({ path: `${SHOTS}intro-360.png` });
  // the page renders underneath from the start (the overlay never holds it back)
  assert.equal(await page.$eval('main', el => el.dataset.state), 'ready');
  assert.equal(await page.evaluate(() => document.activeElement === document.body || document.activeElement === null), true, 'focus never moved');
  await page.waitForFunction(() => window.__collab.removed !== null, { timeout: 3000 });
  let log = await introLog(page);
  assert.deepEqual(log.modes, ['full']);
  assert.ok(log.removed - log.added <= 2000, `removed after ${Math.round(log.removed - log.added)} ms`);
  assert.ok(log.removed - log.added >= 1200, 'the full version plays to its end');
  assert.equal(log.overlay, false);
  assert.equal(log.state, 'done');
  assert.equal((await lockup(page)).inside, true, 'it lifts onto the hero lockup');
  const stored = await page.evaluate(() => ({ session: sessionStorage.getItem('athanasios:collab:bug'), local: JSON.parse(localStorage.getItem('athanasios.collab.v1:bug')) }));
  assert.equal(stored.session, '1');
  assert.equal(stored.local.n, 1);
  assert.ok(stored.local.last > Date.now() - 60000);
  await page.screenshot({ path: `${SHOTS}intro-after-360.png` });

  // another B.U.G. page in the same session: no intro
  await page.goto(`${BASE}/events/bug-camp/`, { waitUntil: 'networkidle0' });
  await ready(page);
  log = await introLog(page);
  assert.deepEqual([log.added, log.modes, log.overlay], [null, [], false]);
  assert.equal((await lockup(page)).inside, true);
  assert.deepEqual(problems, []);
  await context.close();
});

test('B.U.G. intro at 1366: the same composition, centred', async () => {
  const { context, page, problems } = await open('/events/bug-camp/', DESKTOP, { reduced: false, init: recordIntro, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__collab.added !== null, { timeout: 3000 });
  await page.waitForFunction(() => performance.now() - window.__collab.added > 1000);
  await page.screenshot({ path: `${SHOTS}intro-1366.png` });
  await page.waitForFunction(() => window.__collab.removed !== null, { timeout: 3000 });
  assert.ok(await overflow(page) <= 0);
  assert.deepEqual(problems, []);
  await context.close();
});

test('B.U.G. intro: a tap skips it at once and is spent on it (nothing underneath opens)', async () => {
  const { context, page, problems } = await open('/bug-theatre/', PHONE, { reduced: false, init: recordIntro, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__collab.added !== null && document.querySelector('main[data-state="ready"]'), { timeout: 3000 });
  const at = await page.evaluate(() => performance.now());
  await page.mouse.click(180, 600);
  const log = await introLog(page);
  assert.equal(log.overlay, false);
  assert.ok(log.removed - at < 300, `gone ${Math.round(log.removed - at)} ms after the tap`);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(new URL(page.url()).pathname, '/bug-theatre/');
  assert.equal(await page.evaluate(() => !!document.querySelector('dialog.vsheet')?.open), false, 'the tap was spent on the overlay');
  assert.deepEqual(problems, []);
  await context.close();
});

test('B.U.G. intro: none with reduced motion or a #hash deep link; the short version after 3 sessions; none within 6 hours', async () => {
  // reduced motion: the static lockup
  let { context, page } = await open('/bug-theatre/', PHONE, { reduced: true, init: recordIntro });
  await ready(page);
  let log = await introLog(page);
  assert.deepEqual([log.added, log.modes], [null, []]);
  assert.equal((await lockup(page)).inside, true);
  await context.close();

  // a deep link (#v/<id>) goes straight to what was asked for
  ({ context, page } = await open('/bug-theatre/#v/pm-clip0001', PHONE, { reduced: false, init: recordIntro }));
  await ready(page);
  await page.waitForFunction(() => document.querySelector('dialog.vsheet')?.open);
  log = await introLog(page);
  assert.deepEqual([log.added, log.modes], [null, []]);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('athanasios:collab:bug')), null, 'not counted as seen');
  await context.close();

  // the 4th session, 7 hours after the last: the short cross-fade, no overlay
  const seenBefore = hours => new Function(`localStorage.setItem('athanasios.collab.v1:bug', JSON.stringify({ n: 3, last: Date.now() - ${hours} * 3600000 }));`);
  ({ context, page } = await open('/bug-theatre/', PHONE, { reduced: false, init: [recordIntro, seenBefore(7)], waitUntil: 'domcontentloaded' }));
  await page.waitForSelector('.phero .collab__plate', { timeout: 5000 });
  const animated = await page.evaluate(() => document.querySelector('.collab__plate').getAnimations().map(a => a.animationName));
  assert.ok(animated.includes('collab-plate'), `the lockup cross-fades in place (${animated})`);
  log = await introLog(page);
  assert.deepEqual([log.added, log.modes], [null, ['short']]);
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-collab'), { timeout: 4000 });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.collabState), 'done');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('athanasios.collab.v1:bug')).n), 4);
  await context.close();

  // seen an hour ago (another session): nothing
  ({ context, page } = await open('/bug-theatre/', PHONE, { reduced: false, init: [recordIntro, seenBefore(1)] }));
  await ready(page);
  log = await introLog(page);
  assert.deepEqual([log.added, log.modes], [null, []]);
  await context.close();
});

test('B.U.G. in the admin preview: the lockup, never the intro; a partner logo from elsewhere: no lockup', async () => {
  const { context, page, problems } = await open('/__test/preview-parent.html', DESKTOP, { reduced: false, init: recordIntro });
  const frame = await (await page.waitForSelector('#frame')).contentFrame();
  await frame.waitForSelector('main[data-state="loading"]');
  const post = data => page.evaluate(async data => {
    const got = new Promise(resolve => addEventListener('message', e => { if (e.data && /page-preview-(shown|error)/.test(e.data.type)) resolve(e.data.type); }));
    document.getElementById('frame').contentWindow.postMessage({ type: 'athanasios:page-preview', kind: 'event', data }, location.origin);
    return got;
  }, data);
  assert.equal(await post(EVENT_BUG), 'athanasios:page-preview-shown');
  assert.equal(await frame.$eval('.collab__caption', el => el.textContent), 'بإشراف Brave Under Grace – B.U.G.');
  assert.equal(await frame.$('.cintro'), null);
  assert.equal(await frame.evaluate(() => document.documentElement.hasAttribute('data-collab')), false);
  const bad = { ...EVENT_BUG, partner: { ...EVENT_BUG.partner, logo: { ...EVENT_BUG.partner.logo, src: 'https://evil.example/logo.webp' } } };
  assert.equal(await post(bad), 'athanasios:page-preview-shown');
  assert.equal(await frame.$('.collab'), null);
  assert.deepEqual(problems, []);
  await context.close();
});

test('B.U.G. chip: «بإشراف B.U.G.» on the partnered home card and its /events/ card, never on others; axe', async () => {
  clock = WINDOW_OPEN;
  const { context, page, problems } = await home();
  const chips = await page.$$eval('.item-card', els => els.map(el => {
    const chip = el.querySelector('.item-card__partner');
    return chip && { entry: el.dataset.entry, text: chip.textContent.replace(/\s+/g, ' ').trim(), src: chip.querySelector('img').getAttribute('src'), alt: chip.querySelector('img').alt, plate: getComputedStyle(chip.querySelector('.partner-plate')).backgroundColor };
  }).filter(Boolean));
  assert.deepEqual(chips, [{ entry: 'event', text: 'بإشراف B.U.G.', src: 'assets/img/partners/bug-mark-96.webp', alt: '', plate: 'rgb(255, 253, 249)' }]);
  const card = await page.$('.item-card[data-entry="event"]');
  await card.scrollIntoView();
  await page.waitForFunction(() => { const img = document.querySelector('.item-card__partner img'); return img.complete && img.naturalWidth === 306; }, { timeout: 5000 });
  assert.ok(await overflow(page) <= 0);
  await card.screenshot({ path: `${SHOTS}partner-card-360.png` });
  assert.deepEqual(await axe(page, '[data-key="activities"]'), []);
  assert.deepEqual(problems, []);
  await context.close();

  const list = await open('/events/', PHONE);
  await ready(list.page);
  assert.equal(await textOf(list.page, '.ecard .pchip'), 'بإشراف B.U.G.');
  await list.page.waitForFunction(() => { const img = document.querySelector('.pchip img'); return img.complete && img.naturalWidth === 306; }, { timeout: 5000 });
  await list.page.screenshot({ path: `${SHOTS}partner-events-360.png` });
  assert.deepEqual(await axe(list.page), []);
  assert.deepEqual(list.problems, []);
  await list.context.close();
});
