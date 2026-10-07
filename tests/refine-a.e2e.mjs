// Refine A, in headless Chrome against the demo content (tools/demo.mjs)
// and the published content.json:
//   - the cinematic intro: first visit only, skipped on a repeat visit in
//     the session, on a deep link, with reduced motion, on a weak device
//     and in the admin's preview; never blocks a tap; ends exactly on the
//     normal page (the logo in its place, no layout shift, top bar height)
//   - the scrollbars: styled on a mouse screen, native on touch
//   - desktop banners: the slot follows the banner; text-heavy shapes are
//     shown whole (contain), near matches fill (cover, ≤ 3.5% off)
//   - the poster frame: its ratio is the poster's (16:9, 4:5, 1:1, tall)
//   - the support chat: loops while visible, pauses off screen and in a
//     hidden tab, static with reduced motion
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/refine-a.e2e.mjs

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');

const PORT = 4510;       // demo content
const LIVE = 4511;       // the published content.json
const DEMO = `${ROOT}tools/.cache/demo/`;

const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const SEEN = 'athanasios:intro';

let servers = [];
let browser;
let content;

test.before(async () => {
  execFileSync(process.execPath, [`${ROOT}tools/demo.mjs`], { stdio: 'pipe' });
  content = JSON.parse(readFileSync(`${DEMO}content.json`, 'utf8'));
  for (const args of [[String(PORT), '--demo'], [String(LIVE)]]) {
    const server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, ...args], { stdio: 'pipe' });
    await new Promise(resolve => server.stdout.once('data', resolve));
    servers.push(server);
  }
  // real scrollbars (headless hides them by default)
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
});

test.after(async () => {
  await browser?.close();
  for (const server of servers) server.kill();
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function open({ viewport = PHONE, port = PORT, hash = '', seen = false, reduced = false, weak = false, preview = false, json = null, files = null, until = 'networkidle0' } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') problems.push(msg.text()); });
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('securitypolicyviolation', e => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
    window.__shift = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  if (seen) await page.evaluateOnNewDocument(key => { try { sessionStorage.setItem(key, '1'); } catch {} }, SEEN);
  if (weak) {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 1 });
    });
  }
  // (explicit both ways: without --hide-scrollbars, headless Chrome may follow the OS setting)
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]);
  await page.setViewport(viewport);

  if (preview || json || files) {
    await page.setRequestInterception(true);
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (preview && path === '/') {
        const html = readFileSync(`${ROOT}index.html`, 'utf8').replace(/<html\b([^>]*)>/i, '<html$1 data-preview>');
        request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      }
      else if (json && path === '/content.json') {
        request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(json), headers: { Date: new Date().toUTCString() } });
      }
      else if (files && files[path]) {
        request.respond({ status: 200, contentType: 'image/webp', body: files[path] });
      }
      else request.continue();
    });
  }

  await page.goto(`http://localhost:${port}/${hash}`, { waitUntil: until });

  return { page, problems, close: () => context.close() };

}

const ready = page => page.waitForSelector('#main[data-state="ready"]');

const introAnimations = page => page.evaluate(() => document.getAnimations()
  .filter(a => /^intro-/.test(a.animationName || '') && a.playState === 'running').length);

const logoBox = page => page.evaluate(() => {
  const r = document.querySelector('.hero__logo').getBoundingClientRect();
  return [r.left, r.top + scrollY, r.width, r.height].map(v => Math.round(v * 10) / 10);
});


/* ---------------- the intro ---------------- */

for (const [name, viewport] of Object.entries({ phone: PHONE, desktop: DESKTOP })) {

  test(`${name}: the intro plays on a first visit and ends exactly on the normal page`, async () => {

    const { page, problems, close } = await open({ viewport, until: 'domcontentloaded' });

    const start = await page.evaluate(() => ({
      intro: document.documentElement.dataset.intro,
      state: document.documentElement.dataset.introState,
      bar: Math.round(document.getElementById('topbar').getBoundingClientRect().height),
      // the real logo is the intro's hero: on screen, larger, from the first frame
      scale: getComputedStyle(document.querySelector('.hero__logo')).scale
    }));
    assert.equal(start.intro, 'play');
    assert.equal(start.state, 'playing');
    assert.notEqual(start.scale, 'none', 'the logo starts staged (scaled)');

    await ready(page);
    await wait(900);
    assert.ok(await introAnimations(page) > 0, 'still playing a moment later');
    const mid = await page.evaluate(() => Math.round(document.getElementById('topbar').getBoundingClientRect().height));

    await page.waitForFunction(() => document.documentElement.dataset.introState === 'done', { timeout: 4000 });
    await page.waitForFunction(() => !document.getAnimations().some(a => /^(intro-|rise-depth$)/.test(a.animationName || '') && a.playState === 'running'), { timeout: 4000 });

    const end = await page.evaluate(() => ({
      bar: Math.round(document.getElementById('topbar').getBoundingClientRect().height),
      scale: getComputedStyle(document.querySelector('.hero__logo')).scale,
      translate: getComputedStyle(document.querySelector('.hero__arch')).translate,
      shift: window.__shift,
      overflow: document.documentElement.scrollWidth - innerWidth
    }));
    assert.equal(start.bar, mid, 'the top bar never changes height');
    assert.equal(end.bar, start.bar);
    assert.deepEqual([end.scale, end.translate], ['none', 'none'], 'nothing staged is left');
    assert.ok(end.shift < 0.001, `layout shift ${end.shift}`);
    assert.ok(end.overflow <= 0, `horizontal overflow ${end.overflow}`);

    // the logo is exactly where it lives without the intro
    const after = await logoBox(page);
    const plain = await open({ viewport, seen: true });
    await ready(plain.page);
    await wait(1400);
    assert.deepEqual(after, await logoBox(plain.page), 'the logo lands in its real place');
    await plain.close();

    // the page is fully interactive: the bell opens its sheet
    await page.click('#bell');
    await page.waitForSelector('dialog.sheet[open]');

    assert.deepEqual(problems, []);
    await close();

  });

}

test('the intro: a repeat visit in the same session skips it', async () => {

  const { page, problems, close } = await open();
  await ready(page);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.intro), 'play');
  await page.reload({ waitUntil: 'networkidle0' });
  await ready(page);
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-intro')), false, 'not again in this session');
  assert.equal(await introAnimations(page), 0);
  assert.deepEqual(problems, []);
  await close();

});

for (const [label, options] of Object.entries({
  'a deep link': { hash: '#meeting' },
  'reduced motion': { reduced: true },
  'a weak device': { weak: true },
  "the admin's preview": { preview: true }
})) {

  test(`the intro never plays for ${label}`, async () => {

    const { page, problems, close } = await open({ ...options, until: 'domcontentloaded' });
    await wait(300);
    const state = await page.evaluate(() => ({
      intro: document.documentElement.hasAttribute('data-intro'),
      running: document.getAnimations().filter(a => /^intro-/.test(a.animationName || '')).length,
      logo: getComputedStyle(document.querySelector('.hero__logo')).scale
    }));
    assert.deepEqual(state, { intro: false, running: 0, logo: 'none' });
    if (!options.preview) await ready(page);
    assert.deepEqual(problems.filter(p => !/preview|postMessage/i.test(p)), []);
    await close();

  });

}

test('the intro never blocks a tap: the first tap works and fast-forwards it', async () => {

  const { page, problems, close } = await open({ viewport: DESKTOP, until: 'domcontentloaded' });
  await ready(page);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.introState), 'playing');

  // a real control on the page, tapped while the intro is still playing
  const toggle = await page.$('.meeting__actions button[aria-controls="cal-menu"]');
  await toggle.click();
  assert.equal(await page.$eval('.meeting__actions button[aria-controls="cal-menu"]', b => b.getAttribute('aria-expanded')), 'true', 'the tap did its job');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.introState), 'done');

  // everything still on its way arrives within a few frames
  await page.waitForFunction(() => !document.getAnimations().some(a => /^(intro-|rise-depth$)/.test(a.animationName || '') && a.playState === 'running'), { timeout: 900 });
  const hidden = await page.evaluate(() => [...document.querySelectorAll('#topbar, .hero__logo, .hero__name, .hero__tagline, #main > [data-area="meeting"]')]
    .filter(el => Number(getComputedStyle(el).opacity) < 1).map(el => el.className || el.id));
  assert.deepEqual(hidden, []);

  assert.deepEqual(problems, []);
  await close();

});

test('the intro script stays tiny and decides before the body is parsed', async () => {

  const html = readFileSync(`${ROOT}index.html`, 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /<script src="assets\/js\/intro\.js"><\/script>/, 'a classic script in <head>');
  assert.ok(gzipSync(readFileSync(`${ROOT}assets/js/intro.js`)).length < 1600, 'under 1.6 KB compressed');

});


/* ---------------- scrollbars ---------------- */

test('scrollbars: slim and styled with a mouse, native on touch', async () => {

  const desk = await open({ viewport: DESKTOP, seen: true });
  await ready(desk.page);
  const styled = await desk.page.evaluate(() => {
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list;
      try { list = sheet.cssRules; } catch { continue; }
      for (const rule of list) if (rule.media && rule.conditionText === '(hover: hover) and (pointer: fine)') rules.push(rule.cssText);
    }
    const all = rules.join('\n');
    return {
      fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
      gutter: innerWidth - document.documentElement.clientWidth,
      thumb: /::-webkit-scrollbar-thumb\s*\{[^}]*border-radius: 999px/.test(all),
      hover: /::-webkit-scrollbar-thumb:hover/.test(all),
      firefox: /scrollbar-color: var\(--sb-firefox\) transparent/.test(all),
      tokens: getComputedStyle(document.documentElement).getPropertyValue('--sb-thumb').trim()
    };
  });
  assert.deepEqual(styled, { fine: true, gutter: 10, thumb: true, hover: true, firefox: true, tokens: 'rgba(215, 170, 80, .42)' });

  // the poster sheet's own scroller gets the same slim bar
  const item = content.news.find(n => n.title === 'رحلة الغردقة');
  await desk.page.goto(`http://localhost:${PORT}/#news/${item.id}`, { waitUntil: 'networkidle0' });
  await desk.page.waitForSelector('dialog.sheet[open] .sheet__body');
  await wait(800);
  const body = await desk.page.$eval('.sheet__body', el => ({ scrolls: el.scrollHeight > el.clientHeight, bar: el.offsetWidth - el.clientWidth }));
  if (body.scrolls) assert.ok(body.bar >= 9 && body.bar <= 11, `sheet bar ${body.bar}px`);
  assert.deepEqual(desk.problems, []);
  await desk.close();

  const phone = await open({ viewport: PHONE, seen: true });
  await ready(phone.page);
  const native = await phone.page.evaluate(() => ({
    fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
    gutter: innerWidth - document.documentElement.clientWidth
  }));
  assert.deepEqual(native, { fine: false, gutter: 0 }, 'touch keeps its own overlay bars');
  await phone.close();

});


/* ---------------- banners on desktop ---------------- */

async function bannerImage(w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#7a1f3d"/><rect x="8" y="8" width="${w - 16}" height="${h - 16}" fill="none" stroke="#ffd36b" stroke-width="14"/><text x="50%" y="55%" text-anchor="middle" font-family="Arial" font-size="${Math.round(h / 6)}" fill="#fff">TEXT AT THE EDGES</text></svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

const bannerState = (page, selector) => page.$eval(`${selector} > .section-banner`, el => {
  const r = el.getBoundingClientRect();
  const img = el.querySelector('.section-banner__img');
  return { wide: el.parentElement.hasAttribute('data-wide'), height: r.height, slot: r.width / r.height, fit: el.dataset.fit, ar: Number(el.dataset.ar), objectFit: getComputedStyle(img).objectFit, img: [img.getBoundingClientRect().width, img.getBoundingClientRect().height], natural: img.naturalWidth / img.naturalHeight };
});

test('desktop banners: the whole of a text-heavy banner is visible; a near match fills', async () => {

  const files = {
    '/media/2026/img-aaaaaaaa.webp': await bannerImage(1600, 600),
    '/media/2026/img-bbbbbbbb.webp': await bannerImage(1200, 1200)
  };
  const shape = (id, w, h) => ({ src: `media/2026/img-${id}.webp`, thumb: `media/2026/img-${id}.webp`, w, h, alt: '', color: '#7a1f3d' });

  for (const [label, banner, sections, expect] of [
    ['near-square on the featured card', shape('bbbbbbbb', 1200, 1200), ['featured'], 'contain'],
    ['near-square on a full row', shape('bbbbbbbb', 1200, 1200), ['social'], 'contain'],
    ['1600×600 on the featured card', shape('aaaaaaaa', 1600, 600), ['featured'], null],
    ['1600×600 on a full row', shape('aaaaaaaa', 1600, 600), ['social'], null]
  ]) {

    const json = JSON.parse(readFileSync(`${DEMO}content.json`, 'utf8'));
    for (const s of json.layout) if (sections.includes(s.key)) s.banner = banner;
    const { page, problems, close } = await open({ viewport: DESKTOP, seen: true, json, files });
    await ready(page);
    const selector = sections[0] === 'featured' ? '.featured' : '.links-section';
    await page.$eval(selector, el => el.scrollIntoView({ block: 'center' }));
    await page.waitForFunction(sel => { const i = document.querySelector(`${sel} .section-banner__img`); return i.complete && i.naturalWidth; }, {}, selector);
    await wait(300);
    const b = await bannerState(page, selector);

    assert.ok(Math.abs(b.natural - b.ar) < 0.01, `${label}: the file has the banner's ratio`);
    if (expect === 'contain' || b.fit === 'contain') {
      assert.equal(b.fit, 'contain', label);
      assert.equal(b.objectFit, 'contain', `${label}: the whole banner, never cropped`);
    }
    else {
      assert.equal(b.objectFit, 'cover');
      assert.ok(Math.abs(b.slot / b.ar - 1) < 0.035, `${label}: a near match (${b.slot.toFixed(3)} vs ${b.ar})`);
    }
    // a wide banner short enough for its slot simply gets its own shape
    if (banner.w / banner.h > 2 && b.height < 370) assert.ok(Math.abs(b.slot / b.ar - 1) < 0.01, `${label}: exact fit (${b.slot})`);
    assert.deepEqual(problems, []);
    await close();

  }

});

test('the live featured banner (img-cadc4835) is shown whole on desktop', async () => {

  const live = JSON.parse(readFileSync(`${ROOT}content.json`, 'utf8'));
  const featured = live.layout.find(s => s.key === 'featured');
  if (!featured || !featured.banner) return;     // the live content changed

  const { page, problems, close } = await open({ viewport: DESKTOP, port: LIVE, seen: true });
  await ready(page);
  // below the first screen its full-size file loads as it comes near
  await page.$eval('.featured', n => n.scrollIntoView({ block: 'center' }));
  await page.waitForFunction(() => { const i = document.querySelector('.featured .section-banner__img'); return i && i.complete && i.naturalWidth > 480; }, { timeout: 5000 });
  const b = await bannerState(page, '.featured');
  assert.ok(b.fit === 'contain' || Math.abs(b.slot / b.ar - 1) < 0.035, `whole banner (${b.fit}, slot ${b.slot.toFixed(3)} vs ${b.ar})`);
  assert.deepEqual(problems, []);
  await close();

});


/* ---------------- the poster frame ---------------- */

for (const [name, viewport] of Object.entries({ phone: PHONE, desktop: DESKTOP })) {

  test(`${name}: the poster frame is the poster's own shape (16:9, 4:5, 1:1, very tall)`, async () => {

    const cap = name === 'phone' ? 0.56 : 0.62;

    for (const title of ['بوستر عريض', 'رحلة الغردقة', 'بوستر مربع', 'بوستر طويل جداً']) {

      const item = content.news.find(n => n.title === title);
      const { page, problems, close } = await open({ viewport, seen: true, hash: `#news/${item.id}` });
      await page.waitForSelector('dialog.sheet[open] .media-hero');
      await page.waitForFunction(() => { const i = document.querySelector('.media-hero__img'); return i.complete && i.naturalWidth; });
      await wait(900);

      const m = await page.evaluate(() => {
        const fig = document.querySelector('.media-hero').getBoundingClientRect();
        const img = document.querySelector('.media-hero__img').getBoundingClientRect();
        const body = document.querySelector('.sheet__body');
        const inner = body.clientWidth - parseFloat(getComputedStyle(body).paddingLeft) - parseFloat(getComputedStyle(body).paddingRight);
        return { w: fig.width, h: fig.height, img: [img.width, img.height], centre: (fig.left + fig.right) / 2 - (body.getBoundingClientRect().left + body.clientLeft + body.clientWidth / 2), inner, vh: innerHeight };
      });
      const ratio = item.image.w / item.image.h;

      assert.ok(Math.abs(m.w / m.h - ratio) / ratio < 0.01, `${title}: frame ${(m.w / m.h).toFixed(3)} = image ${ratio.toFixed(3)}`);
      assert.ok(Math.abs(m.img[0] - m.w) < 1 && Math.abs(m.img[1] - m.h) < 1, `${title}: the picture fills its frame (no bars)`);
      assert.ok(m.h <= m.vh * cap + 1, `${title}: capped`);
      assert.ok(m.w <= m.inner + 1, `${title}: never wider than the sheet`);
      if (m.w < m.inner - 2) assert.ok(Math.abs(m.centre) < 2, `${title}: a narrowed frame stands centred (${m.centre})`);
      assert.ok(await page.$('.media-hero__zoom'), 'the full-poster action is still there');

      assert.deepEqual(problems, []);
      await close();

    }

  });

}


/* ---------------- the support chat ---------------- */

async function showChat(page) {
  await page.$eval('.support', el => el.scrollIntoView({ block: 'center' }));
  await wait(200);
  await page.evaluate(() => window.scrollBy(0, 1));
}

test('support chat: loops while visible (two cycles), the words and the button stay put', async () => {

  const { page, problems, close } = await open({ seen: true });
  await ready(page);
  const before = await page.$eval('.chat__log', el => el.textContent);
  await showChat(page);
  await page.waitForFunction(() => document.querySelector('.chat').classList.contains('is-looping'), { timeout: 3000 });

  // sample the reply's opacity: it comes and goes, cycle after cycle
  const samples = await page.evaluate(() => new Promise(resolve => {
    const out = [];
    const t0 = performance.now();
    const timer = setInterval(() => {
      out.push(Number(getComputedStyle(document.querySelector('.chat__bubble')).opacity));
      if (performance.now() - t0 > 9600) { clearInterval(timer); resolve(out); }
    }, 100);
  }));
  const cycles = await page.$eval('.chat', el => Number(el.dataset.cycle));
  assert.ok(cycles >= 2, `two cycles at least (${cycles})`);
  const shown = samples.filter((v, i) => v > 0.99 && (i === 0 || samples[i - 1] <= 0.99)).length;
  assert.ok(shown >= 2, `the reply appeared ${shown} times`);
  assert.equal(await page.$eval('.chat__log', el => el.textContent), before, 'the conversation text never changes');
  assert.equal(await page.$$eval('.chat [aria-live]', els => els.length), 0, 'no live region');
  assert.equal(await page.$eval('.support .btn--whatsapp', el => getComputedStyle(el).opacity), '1', 'the button never waits');

  assert.deepEqual(problems, []);
  await close();

});

test('support chat: pauses off screen and in a hidden tab', async () => {

  const { page, problems, close } = await open({ seen: true });
  await ready(page);
  await showChat(page);
  await page.waitForFunction(() => document.querySelector('.chat').classList.contains('is-looping'), { timeout: 3000 });

  const playState = () => page.$eval('.chat__msg--out', el => el.getAnimations().map(a => a.playState).join());

  // off screen
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => document.querySelector('.chat').classList.contains('is-paused'), { timeout: 2000 });
  assert.equal(await playState(), 'paused');
  // (a pause applies on the next frame: let it land before reading the clock; final/s)
  const frozen = await page.$eval('.chat__msg--out', el => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(el.getAnimations()[0].currentTime)))));
  await wait(600);
  assert.equal(await page.$eval('.chat__msg--out', el => el.getAnimations()[0].currentTime), frozen, 'nothing moves off screen');

  // back on screen: it goes on
  await showChat(page);
  await page.waitForFunction(() => !document.querySelector('.chat').classList.contains('is-paused'), { timeout: 2000 });
  assert.equal(await playState(), 'running');

  // a hidden tab
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.$eval('.chat', el => el.classList.contains('is-paused')), true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.$eval('.chat', el => el.classList.contains('is-paused')), false);

  assert.deepEqual(problems, []);
  await close();

});

test('support chat: reduced motion shows the whole conversation, still; lite plays it once', async () => {

  const reduced = await open({ reduced: true });
  await ready(reduced.page);
  await showChat(reduced.page);
  await wait(500);
  const still = await reduced.page.evaluate(() => ({
    classes: document.querySelector('.chat').className.includes('is-'),
    moving: document.querySelector('.chat').getAnimations({ subtree: true }).length,
    reply: Number(getComputedStyle(document.querySelector('.chat__bubble')).opacity),
    out: Number(getComputedStyle(document.querySelector('.chat__msg--out')).opacity)
  }));
  assert.deepEqual(still, { classes: false, moving: 0, reply: 1, out: 1 });
  await reduced.close();

  const lite = await open({ weak: true });
  await ready(lite.page);
  await showChat(lite.page);
  await lite.page.waitForFunction(() => !document.querySelector('.chat').className.includes('is-'), { timeout: 7000 });
  const rest = await lite.page.evaluate(() => ({
    running: document.querySelector('.chat').getAnimations({ subtree: true }).filter(a => a.playState === 'running').length,
    reply: Number(getComputedStyle(document.querySelector('.chat__bubble')).opacity),
    reaction: Number(getComputedStyle(document.querySelector('.chat__reaction')).opacity)
  }));
  assert.deepEqual(rest, { running: 0, reply: 1, reaction: 1 });
  await lite.close();

});
