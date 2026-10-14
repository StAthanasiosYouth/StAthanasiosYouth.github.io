// Service pages and events (docs/EVENTS.md §17) in headless Chrome: a
// service page (hero, the YouTube-style grid at three widths, the team),
// the video sheet (open / ready / next / Escape / back / #v/<id>), an event
// page with its «احجز الآن» area and WhatsApp text, a withdrawn page, the
// bare shell's redirect, the /events/ list, and the home page's cards
// («خدماتنا», the automatic button through the booking window, the card
// gone 12 h after the event, a card whose page isn't published), and the
// B.U.G. co-branding (docs/EVENTS.md §12): the co-brand line, the cards' chip,
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
// the published content.json as a base, without what admins publish of these features
// (so the tests don't change when a real page or event goes live)
const SEED = (({ pages, events, partners, ...rest }) => ({
  ...rest,
  activities: (rest.activities || []).filter(a => !a.page && !a.event),
  layout: Array.isArray(rest.layout) ? rest.layout.filter(s => s.key !== 'services') : rest.layout
}))(JSON.parse(readFileSync(`${ROOT}content.json`, 'utf8')));

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

/* 3 s of a soft tone, 16-bit mono WAV */
const TONE = (() => {
  const rate = 22050;
  const n = rate * 3;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 330 * i / rate) * 6000), 44 + i * 2);
  return b;
})();

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
    // a video card's own soundtrack («صوت المقطع»): a short tone (WAV bytes; the browser reads what it is)
    if (path === '/media/2026/aud-test0001.m4a') return ok('audio/mp4', TONE);
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

/* the clip sheet (page/video.js): the site's social sheet (sheet.js, variant xp) around the real clip */
const SHEET = 'dialog.sheet--clip';
const sheetOpen = page => page.waitForFunction(sel => document.querySelector(sel)?.open, {}, SHEET);
const sheetGone = page => page.waitForFunction(sel => !document.querySelector(sel), {}, SHEET);
const sheetState = page => page.evaluate(() => {
  const d = document.querySelector('dialog.sheet--clip');
  const v = d && d.querySelector('.xp-clip__video');
  const t = d && d.querySelector('.xp-clip__soundtrack');
  const cta = d && d.querySelector('.xp__cta--clip');
  return d && {
    open: d.open,
    id: d.dataset.id || '',
    hash: location.hash,
    sheetTitle: d.querySelector('.sheet__title').textContent,
    title: d.querySelector('.xp__line').textContent,
    text: d.querySelector('.xp__sub').hidden ? '' : d.querySelector('.xp__sub').textContent,
    cta: cta.closest('[hidden]') ? null : { href: cta.href, target: cta.target, rel: cta.rel, text: cta.textContent.replace(/\s*\(.*\)\s*/, '').trim() },
    src: v.getAttribute('src') || '',
    paused: v.paused,
    muted: v.muted,
    controls: v.controls,
    playsinline: v.hasAttribute('playsinline'),
    poster: v.getAttribute('poster') || '',
    audio: d.querySelector('.xp--clip').dataset.audio,
    track: { src: (t.getAttribute('src') || '').split('/').pop(), playing: !t.paused },
    speaker: d.querySelector('.xp-sound').getAttribute('aria-pressed'),
    nav: !d.querySelector('.xp-clip-nav').hidden
  };
});

test('clip sheet: tap → the site\'s social sheet (#v/<id>), the clip plays at once in its own shape; its own sound; next by button and arrow (link cards skipped); Escape and back close it', async () => {
  clock = WINDOW_OPEN;
  const { context, page, problems } = await open('/black-theatre/', PHONE);
  await ready(page);

  await page.click('[data-media="pm-clip0001"]');
  await sheetOpen(page);
  let s = await sheetState(page);
  assert.equal(s.open, true);
  assert.equal(s.hash, '#v/pm-clip0001');
  assert.equal(s.sheetTitle, PAGE.title, 'the sheet is the page\'s');
  assert.equal(s.title, 'يونان في بطن الحوت');
  assert.match(s.src, /media\/2026\/vid-10486833\.mp4#t=1$/, 'from its start (it loops, no end in the address)');
  assert.equal(s.controls, false, 'no player chrome: a tap on the clip pauses / plays it');
  assert.equal(s.playsinline, true);
  assert.match(s.poster, /img-c1308156\.webp$/);
  assert.deepEqual(s.cta, { href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', target: '_blank', rel: 'noopener', text: 'شاهد المسرحية كاملة' });
  assert.equal(s.speaker, 'true', 'the speaker shows the site\'s sound setting');
  // the tap that opened it starts it with its own sound, at its own (portrait) shape
  assert.equal(s.audio, 'original');
  await page.waitForFunction(() => { const v = document.querySelector('.xp-clip__video'); return v && !v.paused && !v.muted && v.currentTime > 0; }, { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector('.xp-clip__video').currentTime >= 1.9, { timeout: 4000 });
  const box = await page.$eval('.xp-clip', el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, vh: innerHeight }; });
  assert.ok(Math.abs(box.w / box.h - 270 / 480) < 0.03, `portrait ${box.w}x${box.h}`);
  assert.ok(box.h <= box.vh * 0.6 + 1, 'about half the screen at most');
  assert.ok(await overflow(page) <= 0);
  await page.screenshot({ path: `${SHOTS}sheet-360.png` });

  // a tap on the clip pauses it, another plays it
  await page.click('.xp-clip__toggle');
  assert.equal((await sheetState(page)).paused, true);
  await page.click('.xp-clip__toggle');
  await page.waitForFunction(() => !document.querySelector('.xp-clip__video').paused, { timeout: 4000 });

  // next (button): its own soundtrack, the clip muted (never both)
  await page.click('.xp-clip-nav__btn:last-child');
  await page.waitForFunction(() => document.querySelector('.xp__line').textContent === 'الابن الضال', { timeout: 4000 });
  await page.waitForFunction(() => !document.querySelector('.xp-clip__soundtrack').paused, { timeout: 6000 });
  s = await sheetState(page);
  assert.deepEqual([s.id, s.hash, s.cta, s.audio, s.muted, s.track.src], ['pm-clip0002', '#v/pm-clip0002', null, 'custom', true, 'aud-test0001.m4a']);
  // ← (RTL: forward): a card without sound — silent, the soundtrack stopped
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('.xp__line').textContent === 'داود وجليات', { timeout: 4000 });
  await page.waitForFunction(() => document.querySelector('.xp-clip__soundtrack').paused, { timeout: 4000 });
  s = await sheetState(page);
  assert.deepEqual([s.id, s.hash, s.audio, s.muted, s.track.playing], ['pm-clip0004', '#v/pm-clip0004', 'none', true, false]);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.xp__line').textContent === 'الابن الضال', { timeout: 4000 });
  await page.waitForFunction(() => !document.querySelector('.xp-clip__video').paused && !document.querySelector('.xp-clip__soundtrack').paused, { timeout: 8000 });

  // the site's sound setting off (the speaker): everything silent; on again: the soundtrack again
  await page.click('.xp-sound');
  await page.waitForFunction(() => document.querySelector('.xp-clip__soundtrack').paused, { timeout: 4000 });
  assert.equal((await sheetState(page)).speaker, 'false');
  assert.equal(await page.evaluate(() => localStorage.getItem('athanasios.sound')), 'off');
  assert.equal(await page.$eval('.usound', b => b.getAttribute('aria-pressed')), 'false', 'the top bar\'s button says the same');
  await page.click('.xp-sound');
  await page.waitForFunction(() => !document.querySelector('.xp-clip__soundtrack').paused, { timeout: 4000 });

  // another tab / a locked phone: it all stops
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => document.querySelector('.xp-clip__soundtrack').paused, { timeout: 2000 });
  assert.equal((await sheetState(page)).paused, true, 'paused when the page is hidden');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => !document.querySelector('.xp-clip__video').paused, { timeout: 4000 });

  // Escape closes it, takes the #v/ entry back off the history, nothing plays on
  const video = await page.$('.xp-clip__video');
  const track = await page.$('.xp-clip__soundtrack');
  await page.keyboard.press('Escape');
  await sheetGone(page);
  await page.waitForFunction(() => location.hash === '');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.deepEqual(await video.evaluate(v => [v.paused, v.getAttribute('src') || '']), [true, ''], 'the clip stopped and unloaded');
  assert.equal(await track.evaluate(t => t.paused), true, 'the soundtrack stopped');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.media), 'pm-clip0001', 'focus back on the card');

  // the phone's back button closes it too (and stays on the page)
  await page.click('[data-media="pm-clip0004"]');
  await sheetOpen(page);
  assert.equal((await sheetState(page)).hash, '#v/pm-clip0004');
  await page.goBack();
  await sheetGone(page);
  assert.equal(new URL(page.url()).pathname, '/black-theatre/');
  assert.equal(await page.$eval('main', el => el.dataset.state), 'ready');

  // the close button
  await page.click('[data-media="pm-clip0002"]');
  await sheetOpen(page);
  await page.click(`${SHEET} .sheet__close`);
  await sheetGone(page);
  await page.waitForFunction(() => location.hash === '');

  assert.deepEqual(problems, []);
  await context.close();
});

test('clip sheet: #v/<id> deep link opens on load; closing cleans the address; an unknown id does nothing', async () => {
  const { context, page, problems } = await open('/black-theatre/#v/pm-clip0002', PHONE);
  await ready(page);
  await sheetOpen(page);
  const s = await sheetState(page);
  assert.deepEqual([s.id, s.title], ['pm-clip0002', 'الابن الضال']);
  await page.waitForFunction(() => !document.querySelector('.xp-clip__video').paused, { timeout: 8000 });   // a link plays too
  await page.click(`${SHEET} .sheet__close`);
  await sheetGone(page);
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(new URL(page.url()).pathname, '/black-theatre/');
  await context.close();

  const other = await open('/black-theatre/#v/pm-link0003', PHONE);
  await ready(other.page);
  assert.equal(await other.page.evaluate(sel => !!document.querySelector(sel)?.open, SHEET), false, 'a link card never opens the sheet');
  assert.deepEqual([...problems, ...other.problems], []);
  await other.context.close();
});

test('clip sheet: alive like the site\'s social sheets (reactions beside the clip, words at its edges, behind the sheet on a computer); still with reduced motion', async () => {
  // motion allowed: reactions float up beside the clip; a computer gets words behind the sheet too
  for (const [viewport, wide] of [[PHONE, false], [DESKTOP, true]]) {
    const { context, page, problems } = await open('/black-theatre/', viewport, { reduced: false });
    await ready(page);
    await page.click('[data-media="pm-clip0001"]');
    await sheetOpen(page);
    await page.waitForFunction(() => document.querySelectorAll('.xp-fx .xp-float').length >= 2, { timeout: 6000 });
    if (wide) await page.waitForFunction(() => document.querySelectorAll('.xp-side .xp-side__item').length >= 1, { timeout: 8000 });
    assert.ok(await overflow(page) <= 0);
    assert.deepEqual(await axe(page, SHEET), []);
    await page.screenshot({ path: `${SHOTS}sheet-alive-${viewport.width}.png` });
    await page.keyboard.press('Escape');
    await sheetGone(page);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.xp-side, .xp-fx .xp-float').length), 0, 'all of it gone with the sheet');
    assert.deepEqual(problems, []);
    await context.close();
  }

  // reduced motion: the clip and its words, nothing moving around it
  const { context, page } = await open('/black-theatre/', PHONE);
  await ready(page);
  await page.click('[data-media="pm-clip0001"]');
  await sheetOpen(page);
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.xp-fx .xp-float, .xp-side').length), 0);
  await context.close();
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
  await frame.waitForFunction(() => document.querySelector('dialog.sheet--clip')?.open);
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

/* the quiet co-brand line: under the title (never on the banner), inside the screen, small */
const lockup = page => page.evaluate(() => {
  const el = document.querySelector('.phero .cobrand');
  if (!el) return null;
  const box = el.getBoundingClientRect();
  const seal = el.querySelector('.cobrand__seal');
  const mark = el.querySelector('.cobrand__mark');
  const title = document.querySelector('.phero__title').getBoundingClientRect();
  const banner = document.querySelector('.phero__media').getBoundingClientRect();
  return {
    inside: box.left >= 0 && box.right <= document.documentElement.clientWidth && box.width > 0 && box.height > 0,
    // what is seen (the screen reader's «بالتعاون مع» aside)
    text: [...el.childNodes].filter(n => !(n.classList && n.classList.contains('visually-hidden'))).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim(),
    spoken: el.querySelector('.visually-hidden').textContent,
    loaded: seal.complete && seal.naturalWidth > 0 && !!mark && mark.complete && mark.naturalWidth > 0,
    under: box.top >= title.bottom - 1 && box.top >= banner.bottom,
    quiet: box.height <= 72 && mark.getBoundingClientRect().height <= 20
  };
});

const LOCKUP = { inside: true, text: 'أسرة البابا أثناسيوس × Brave Under Grace', spoken: 'بالتعاون مع', loaded: true, under: true, quiet: true };

test('B.U.G. co-brand line: a partnered service page and event page at 360 and 1366; quiet, under the title, no overflow; axe', async () => {
  clock = WINDOW_OPEN;
  for (const [path, name] of [['/bug-theatre/', 'page'], ['/events/bug-camp/', 'event']]) {
    for (const viewport of [PHONE, DESKTOP]) {
      const { context, page, problems, outside } = await open(path, viewport);
      await ready(page);
      assert.equal(await page.$eval('html', el => el.dataset.partner), 'bug');
      assert.deepEqual(await lockup(page), LOCKUP, `${name} ${viewport.width}px`);
      assert.equal(await page.$('.cintro'), null, 'reduced motion: no intro');
      assert.ok(await overflow(page) <= 0, `${name} ${viewport.width}px: no horizontal scroll`);
      await page.screenshot({ path: `${SHOTS}partner-${name}-${viewport.width}.png` });
      if (viewport === PHONE) assert.deepEqual(await axe(page), []);
      assert.deepEqual(problems, []);
      assert.deepEqual(outside, []);
      await context.close();
    }
  }
  // a page without a partner has no co-brand line
  const plain = await open('/black-theatre/', PHONE);
  await ready(plain.page);
  assert.equal(await plain.page.$('.cobrand'), null);
  assert.equal(await plain.page.$eval('html', el => el.dataset.partner), undefined);
  await plain.context.close();
});

test('B.U.G. intro: full screen, plays to its end onto the lockup; again every time the visitor comes into a B.U.G. page', async () => {
  clock = WINDOW_OPEN;
  const { context, page, problems } = await open('/bug-theatre/', PHONE, { reduced: false, init: recordIntro, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__collab.added !== null, { timeout: 3000 });
  assert.equal(await page.$eval('.cintro', el => el.getAttribute('aria-hidden')), 'true');
  // the whole screen (100vw × 100dvh), «تخطي» in its corner
  assert.deepEqual(await page.$eval('.cintro', el => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), innerWidth, innerHeight]; }).then(([l, t, w, h, vw, vh]) => [l, t, w === vw, h === vh]), [0, 0, true, true]);
  assert.equal(await page.$eval('.cintro__skip', b => [b.tagName, b.textContent, b.tabIndex].join()), 'BUTTON,تخطي,-1');
  await page.waitForFunction(() => performance.now() - window.__collab.added > 1700);
  await page.screenshot({ path: `${SHOTS}intro-360.png` });
  // the page renders underneath from the start (the overlay never holds it back)
  assert.equal(await page.$eval('main', el => el.dataset.state), 'ready');
  assert.equal(await page.evaluate(() => document.activeElement === document.body || document.activeElement === null), true, 'focus never moved');
  await page.waitForFunction(() => window.__collab.removed !== null, { timeout: 3000 });
  let log = await introLog(page);
  assert.deepEqual(log.modes, ['full']);
  assert.ok(log.removed - log.added <= 3300, `removed after ${Math.round(log.removed - log.added)} ms`);
  assert.ok(log.removed - log.added >= 2200, 'the ident plays to its end (≈ 2.35 s)');
  assert.equal(log.overlay, false);
  assert.equal(log.state, 'done');
  assert.equal((await lockup(page)).inside, true, 'the page underneath, with its co-brand line');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('athanasios:collab:bug')), null, 'nothing remembered');
  await page.screenshot({ path: `${SHOTS}intro-after-360.png` });
  // a resize / a turn of the phone is not coming in again
  await page.setViewport({ ...PHONE, width: 740, height: 360 });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await page.$('.cintro'), null, 'no replay on a rotation');
  await page.setViewport(PHONE);

  // another B.U.G. page, then back to this one: the visitor comes in again, the ident plays again
  await page.goto(`${BASE}/events/bug-camp/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__collab.added !== null, { timeout: 3000 });
  await page.waitForFunction(() => window.__collab.removed !== null, { timeout: 4000 });
  await page.goto(`${BASE}/bug-theatre/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__collab.added !== null, { timeout: 3000 });
  await page.waitForFunction(() => window.__collab.removed !== null, { timeout: 4000 });
  await ready(page);
  assert.equal((await lockup(page)).inside, true);
  assert.deepEqual(problems, []);
  await context.close();
});

test('B.U.G. intro at 1366: the same composition, centred', async () => {
  const { context, page, problems } = await open('/events/bug-camp/', DESKTOP, { reduced: false, init: recordIntro, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__collab.added !== null, { timeout: 3000 });
  await page.waitForFunction(() => performance.now() - window.__collab.added > 1700);
  await page.screenshot({ path: `${SHOTS}intro-1366.png` });
  assert.deepEqual(await page.$eval('.cintro', el => { const r = el.getBoundingClientRect(); return [r.width === innerWidth, r.height === innerHeight]; }), [true, true], 'the whole screen');
  await page.waitForFunction(() => window.__collab.removed !== null, { timeout: 3000 });
  assert.ok(await overflow(page) <= 0);
  assert.deepEqual(problems, []);
  await context.close();
});

test('B.U.G. intro: «تخطي» or any tap skips it at once and is spent on it (nothing underneath opens)', async () => {
  const { context, page, problems } = await open('/bug-theatre/', PHONE, { reduced: false, init: recordIntro, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__collab.added !== null && document.querySelector('main[data-state="ready"]'), { timeout: 3000 });
  const at = await page.evaluate(() => performance.now());
  await page.mouse.click(180, 600);
  const log = await introLog(page);
  assert.equal(log.overlay, false);
  assert.ok(log.removed - at < 300, `gone ${Math.round(log.removed - at)} ms after the tap`);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(new URL(page.url()).pathname, '/bug-theatre/');
  assert.equal(await page.evaluate(sel => !!document.querySelector(sel)?.open, SHEET), false, 'the tap was spent on the overlay');
  assert.deepEqual(problems, []);
  await context.close();

  // the «تخطي» button itself
  const again = await open('/bug-theatre/', PHONE, { reduced: false, init: recordIntro, waitUntil: 'domcontentloaded' });
  await again.page.waitForSelector('.cintro__skip');
  await again.page.waitForFunction(() => getComputedStyle(document.querySelector('.cintro__skip')).opacity > 0.5, { timeout: 3000 });
  await again.page.click('.cintro__skip');
  assert.equal(await again.page.$('.cintro'), null);
  await again.context.close();
});

test('B.U.G. intro: none with reduced motion or a #hash deep link; a light version on a weak phone; again in a new session', async () => {
  // reduced motion: no intro, the co-brand line only
  let { context, page } = await open('/bug-theatre/', PHONE, { reduced: true, init: recordIntro });
  await ready(page);
  let log = await introLog(page);
  assert.deepEqual([log.added, log.modes], [null, []]);
  assert.equal((await lockup(page)).inside, true);
  await context.close();

  // a deep link (#v/<id>) goes straight to what was asked for
  ({ context, page } = await open('/bug-theatre/#v/pm-clip0001', PHONE, { reduced: false, init: recordIntro }));
  await ready(page);
  await sheetOpen(page);
  log = await introLog(page);
  assert.deepEqual([log.added, log.modes], [null, []]);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('athanasios:collab:bug')), null, 'not counted as seen');
  await context.close();

  // a weak phone (4 cores, 3 GB): the same ident, without the 3D and the blurs, to its end
  const weakPhone = () => {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4, configurable: true });
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 3, configurable: true });
  };
  ({ context, page } = await open('/bug-theatre/', PHONE, { reduced: false, init: [recordIntro, weakPhone], waitUntil: 'domcontentloaded' }));
  await page.waitForSelector('.cintro.cintro--lite.is-go', { timeout: 3000 });
  const lite = await page.evaluate(() => ({
    blur: getComputedStyle(document.querySelector('.cintro__side--ours')).filter,
    motes: getComputedStyle(document.querySelector('.cintro__mote')).display
  }));
  assert.equal(lite.blur, 'none');
  assert.equal(lite.motes, 'none');
  await page.waitForFunction(() => window.__collab.removed !== null, { timeout: 4000 });
  log = await introLog(page);
  assert.deepEqual(log.modes, ['full']);
  await context.close();

  // a new session (a fresh tab), whatever was seen before: it plays again
  ({ context, page } = await open('/bug-theatre/', PHONE, { reduced: false, init: recordIntro, waitUntil: 'domcontentloaded' }));
  await page.waitForFunction(() => window.__collab.added !== null, { timeout: 3000 });
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
  assert.equal(await frame.$eval('.cobrand', el => el.textContent.replace(/\s+/g, ' ').trim()), 'أسرة البابا أثناسيوس × بالتعاون مع Brave Under Grace');
  assert.equal(await frame.$('.cintro'), null);
  assert.equal(await frame.evaluate(() => document.documentElement.hasAttribute('data-collab')), false);
  const bad = { ...EVENT_BUG, partner: { ...EVENT_BUG.partner, logo: { ...EVENT_BUG.partner.logo, src: 'https://evil.example/logo.webp' } } };
  assert.equal(await post(bad), 'athanasios:page-preview-shown');
  assert.equal(await frame.$('.cobrand'), null);
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
  assert.deepEqual(chips, [{ entry: 'event', text: 'بإشراف B.U.G.', src: 'assets/img/partners/bug-symbol-320.webp', alt: '', plate: 'rgb(255, 253, 249)' }]);
  const card = await page.$('.item-card[data-entry="event"]');
  await card.scrollIntoView();
  await page.waitForFunction(() => { const img = document.querySelector('.item-card__partner img'); return img.complete && img.naturalWidth === 320; }, { timeout: 5000 });
  assert.ok(await overflow(page) <= 0);
  await card.screenshot({ path: `${SHOTS}partner-card-360.png` });
  assert.deepEqual(await axe(page, '[data-key="activities"]'), []);
  assert.deepEqual(problems, []);
  await context.close();

  const list = await open('/events/', PHONE);
  await ready(list.page);
  assert.equal(await textOf(list.page, '.ecard .pchip'), 'بإشراف B.U.G.');
  await list.page.waitForFunction(() => { const img = document.querySelector('.pchip img'); return img.complete && img.naturalWidth === 320; }, { timeout: 5000 });
  await list.page.screenshot({ path: `${SHOTS}partner-events-360.png` });
  assert.deepEqual(await axe(list.page), []);
  assert.deepEqual(list.problems, []);
  await list.context.close();
});
