// Program A (the public page), in headless Chrome against the published
// content.json with fixtures injected by request interception (no admin
// code needed) and a Cairo clock override:
//   - the location card on phones (320/360/390/412): no sideways overflow,
//     one map toggle (aria-expanded, keyboard), buttons ≥ 44px, the real
//     map exactly as wide as the card; desktop keeps its two-up grid
//   - the live program: «دلوقتي / بعدها» by Cairo time, following the
//     tick without a layout jump; live.json wins for its own date; stage
//     null / another date / 404 / broken JSON = automatic; live.json is
//     asked only inside the live window and only while the tab is visible;
//     «أول حاجة» before; nothing after; the meeting sheet's program list
//   - «شكل الخلفية»: glass / dark / filled / none on a section,
//     surfaceMobile on phones only (and live on a resize), axe contrast,
//     blur only in the full tier
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/prog-a.e2e.mjs

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { cairoInstant } from '../assets/js/schedule.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 4700;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const phone = width => ({ width, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const PHONE = phone(390);
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };

const PUBLISHED = JSON.parse(readFileSync(`${ROOT}content.json`, 'utf8'));

/* a Sunday meeting at 20:00 (two hours) with a four-stage program */
const D = '2026-10-11';
const PROGRAM = [
  { title: 'تسبحة', start: `${D}T20:00`, end: `${D}T20:30` },
  { title: 'الكلمة', start: `${D}T20:30`, end: `${D}T21:15` },
  { title: 'ترانيم', start: `${D}T21:15`, end: `${D}T21:45` },
  { title: 'الختام', start: `${D}T21:45`, end: `${D}T22:00` }
];

function withProgram() {
  const content = structuredClone(PUBLISHED);
  content.meeting = { ...content.meeting, day: 0, time: '20:00', durationMinutes: 120, skipDates: [] };
  content.sessions = [{ date: D, time: '20:00', topic: 'حياة التسليم', speaker: 'أبونا أنطوني عياد', description: '', status: 'normal', note: '', visibleFrom: '', durationMinutes: 120, program: PROGRAM }];
  return content;
}

function withSurface(key, surface, surfaceMobile) {
  const content = structuredClone(PUBLISHED);
  const section = content.layout.find(s => s.key === key);
  if (surface) section.surface = surface;
  if (surfaceMobile) section.surfaceMobile = surfaceMobile;
  return content;
}

let server;
let browser;

test.before(async () => {
  server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT)], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  server?.kill();
});


/*
 * at: a Cairo wall time ("YYYY-MM-DDTHH:MM") the page believes it is
 * (Date is shifted; content.json answers with a matching Date header);
 * live: what live.json answers (an object, 404, or a raw string).
 * The page gets window.__tick() (the 15 s tick, on demand),
 * window.__advance(ms) and window.__setHidden(bool).
 */
async function open({ viewport = PHONE, content = PUBLISHED, at = null, live = 404, reduced = false, weak = false, hash = '', bypass = false } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const liveRequests = [];
  const skew = at ? cairoInstant(at) - Date.now() : 0;

  page.on('pageerror', error => problems.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/live\.json|404/.test(msg.text())) problems.push(msg.text()); });

  await page.evaluateOnNewDocument(skewMs => {
    try { sessionStorage.setItem('athanasios:intro', '1'); } catch {}
    window.__skew = skewMs;
    const RealDate = Date;
    const realNow = RealDate.now.bind(RealDate);
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [realNow() + window.__skew])); }
      static now() { return realNow() + window.__skew; }
    };
    window.__advance = ms => { window.__skew += ms; };
    const realSetInterval = window.setInterval;
    window.setInterval = (fn, ms, ...rest) => {
      if (ms === 15000) window.__tick = fn;
      return realSetInterval(fn, ms, ...rest);
    };
    let hidden = false;
    Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible'), configurable: true });
    window.__setHidden = value => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
  }, skew);

  if (weak) {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 1 });
    });
  }
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]);
  await page.setViewport(viewport);
  if (bypass) await page.setBypassCSP(true);

  const state = { live };
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname === 'www.google.com') {
      request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>map</title>' });
    }
    else if (url.pathname === '/content.json') {
      request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(content), headers: { Date: new Date(Date.now() + skew).toUTCString() } });
    }
    else if (url.pathname === '/live.json') {
      liveRequests.push(url.search);
      const answer = state.live;
      if (answer === 404) request.respond({ status: 404, contentType: 'text/plain', body: '404' });
      else request.respond({ status: 200, contentType: 'application/json', body: typeof answer === 'string' ? answer : JSON.stringify(answer) });
    }
    else request.continue();
  });

  await page.goto(`http://localhost:${PORT}/${hash}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main[data-state="ready"]');

  return { page, problems, liveRequests, state, close: () => context.close() };

}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const overflow = page => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));

/* the 15 s tick, now (after moving the clock) */
async function tick(page, ms = 0) {
  await page.evaluate(step => { window.__advance(step); window.__tick(); }, ms);
  await wait(520);   // (a full-tier swap: out, then in)
}

const programNow = page => page.evaluate(() => {
  const box = document.querySelector('.meeting .program-now');
  if (!box || box.hidden) return null;
  const rows = [...box.querySelectorAll('.program-now__row')].filter(row => !row.hidden);
  return rows.map(row => [...row.children].map(el => el.textContent.trim()).filter(Boolean).join(' | '));
});

/* the widget's rows, once they settle (a full-tier swap rolls out, then in) */
async function expectProgram(page, expected, message) {
  const t0 = Date.now();
  let rows = await programNow(page);
  while (JSON.stringify(rows) !== JSON.stringify(expected) && Date.now() - t0 < 4000) {
    await wait(100);
    rows = await programNow(page);
  }
  assert.deepEqual(rows, expected, message);
}

const titleIs = (page, text) => page.waitForFunction(t => document.querySelector('.program-now__title')?.textContent === t, { timeout: 4000 }, text).then(() => true, () => false);


/* ---------------- the location card ---------------- */

for (const width of [320, 360, 390, 412]) {

  test(`location card at ${width}px: fits, one toggle, big buttons, the map as wide as the card`, async () => {

    const { page, problems, close } = await open({ viewport: phone(width) });
    const card = await page.$('.location');
    await card.evaluate(el => el.scrollIntoView({ block: 'center' }));

    const check = () => page.evaluate(() => {
      const card = document.querySelector('.location');
      const box = card.getBoundingClientRect();
      const outside = [...card.querySelectorAll('.location__body *, .location__map, .location__map > iframe')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.left < box.left - 0.5 || r.right > box.right + 0.5); })
        .map(el => el.className || el.tagName);
      const buttons = [...card.querySelectorAll('.location__actions > *')].map(el => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent.trim(), w: r.width, h: r.height, clipped: el.scrollWidth > el.clientWidth + 1, top: Math.round(r.top) };
      });
      const map = card.querySelector('.location__map').getBoundingClientRect();
      const frame = card.querySelector('.location__map iframe');
      return {
        outside,
        buttons,
        toggles: card.querySelectorAll('[aria-controls="location-map"]').length,
        mapButtons: [...document.querySelectorAll('button')].filter(b => /الخريطة/.test(b.innerText)).length,
        visibleLabel: [...card.querySelectorAll('.location__toggle-label > span')].filter(s => getComputedStyle(s).visibility === 'visible').map(s => s.textContent),
        card: card.clientWidth,   // (inside its hairline)
        map: { w: map.width, h: map.height },
        frame: frame ? frame.getBoundingClientRect().width : null
      };
    });

    const closed = await check();
    assert.equal(await overflow(page), 0, 'no sideways scroll');
    assert.deepEqual(closed.outside, [], 'nothing sticks out of the card');
    assert.equal(closed.toggles, 1, 'one map toggle');
    assert.equal(closed.mapButtons, 1, 'one button about the map');
    assert.deepEqual(closed.visibleLabel, ['عرض الخريطة']);
    for (const b of closed.buttons) {
      assert.ok(b.h >= 44 && b.w >= 44, `${b.text}: ${b.w}×${b.h}`);
      assert.ok(!b.clipped, `${b.text} is not cut`);
    }
    assert.ok(Math.abs(closed.map.w - closed.card) <= 1, 'the map art spans the card');

    // open it (a tap), then close it from the keyboard
    const toggle = await page.$('.location__toggle');
    await toggle.click();
    await page.waitForSelector('.location__map.is-live iframe');
    assert.equal(await toggle.evaluate(el => el.getAttribute('aria-expanded')), 'true');
    const opened = await check();
    assert.equal(await overflow(page), 0);
    assert.deepEqual(opened.outside, []);
    assert.deepEqual(opened.visibleLabel, ['اخفي الخريطة']);
    assert.ok(Math.abs(opened.frame - opened.card) <= 1, `the map is as wide as the card (${opened.frame} vs ${opened.card})`);
    assert.ok(opened.map.h >= 200 && opened.map.h <= 320, `a sensible map height: ${opened.map.h}`);
    assert.deepEqual(opened.buttons.map(b => Math.round(b.w)), closed.buttons.map(b => Math.round(b.w)), 'the toggle keeps its size');
    for (const b of opened.buttons) assert.ok(!b.clipped, `${b.text} is not cut when open`);

    await toggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await toggle.evaluate(el => el.getAttribute('aria-expanded')), 'false');
    assert.equal(await page.$('.location__map iframe'), null, 'back to the drawing');
    await page.keyboard.press('Space');
    assert.equal(await toggle.evaluate(el => el.getAttribute('aria-expanded')), 'true');

    assert.deepEqual(problems, []);
    await close();

  });

}

test('location card on desktop: the same two-up grid as before', async () => {
  const { page, close } = await open({ viewport: DESKTOP });
  const layout = await page.$eval('.location__actions', el => ({
    display: getComputedStyle(el).display,
    rows: new Set([...el.children].map(b => Math.round(b.getBoundingClientRect().top))).size
  }));
  assert.deepEqual(layout, { display: 'grid', rows: 2 });
  assert.equal(await overflow(page), 0);
  await close();
});


/* ---------------- the live program ---------------- */

for (const [name, viewport] of Object.entries({ phone: PHONE, desktop: DESKTOP })) {

  test(`${name}: «دلوقتي / بعدها» follows the Cairo clock without a jump`, async () => {

    const { page, problems, close } = await open({ viewport, content: withProgram(), at: `${D}T20:40` });

    assert.match(await page.$eval('.meeting__headline', el => el.textContent), /بدأ/);
    await expectProgram(page, ['دلوقتي | الكلمة', 'بعدها | ترانيم | الساعة ٩:١٥ بالليل']);
    assert.equal(await overflow(page), 0);
    const height = await page.$eval('.meeting', el => el.offsetHeight);

    await tick(page, 40 * 60000);                       // 21:20
    await expectProgram(page, ['دلوقتي | ترانيم', 'بعدها | الختام | الساعة ٩:٤٥ بالليل']);
    await wait(600);                                    // (a full-tier swap settles)
    assert.equal(await page.$eval('.meeting', el => el.offsetHeight), height, 'no layout jump');

    await tick(page, 30 * 60000);                       // 21:50
    await expectProgram(page, ['دلوقتي | الختام', 'بعدها | نهاية الاجتماع | الساعة ١٠ بالليل']);

    await tick(page, 15 * 60000);                       // 22:05: over
    await expectProgram(page, null);

    assert.deepEqual(problems, []);
    await close();

  });

}

test('before the meeting: one quiet «أول حاجة» line; another day: nothing', async () => {
  let { page, close } = await open({ content: withProgram(), at: `${D}T18:30` });
  await expectProgram(page, ['أول حاجة | تسبحة'], "its time is the meeting's, said just above");
  await close();
  ({ page, close } = await open({ content: withProgram(), at: '2026-10-09T18:30' }));
  await expectProgram(page, null);
  await close();
});

test('live.json: its stage wins for its own date; null, another date, 404 and broken JSON stay automatic', async () => {

  const cases = [
    [{ schema: 1, date: D, stage: 3, updatedAt: '2026-10-11T17:41:00Z' }, 'الختام'],
    [{ schema: 1, date: D, stage: 0 }, 'تسبحة'],
    [{ schema: 1, date: D, stage: null }, 'الكلمة'],
    [{ schema: 1, date: '2026-10-04', stage: 3 }, 'الكلمة'],
    [{ schema: 1, date: D, stage: 9 }, 'الكلمة'],
    [404, 'الكلمة'],
    ['{"schema":1,"date":', 'الكلمة']
  ];

  for (const [live, expected] of cases) {
    const { page, problems, liveRequests, close } = await open({ content: withProgram(), at: `${D}T20:40`, live });
    await page.waitForFunction(() => document.querySelector('.program-now__title'));
    await wait(150);
    assert.ok(liveRequests.length >= 1, 'asked during the meeting');
    assert.match(liveRequests[0], /^\?ts=\d+$/, 'cache-busting query');
    await titleIs(page, expected);
    await wait(300);   // (nothing changes after that)
    assert.equal(await page.$eval('.program-now__title', el => el.textContent), expected, JSON.stringify(live));
    assert.deepEqual(problems, []);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => /live/i.test(k) || /"stage"/.test(localStorage.getItem(k))).length), 0, 'never cached');
    await close();
  }

});

test('live.json changes during the meeting: the page follows on the next poll, and back to automatic', async () => {

  const { page, liveRequests, state, close } = await open({ content: withProgram(), at: `${D}T20:40`, live: { schema: 1, date: D, stage: null } });
  assert.ok(await titleIs(page, 'الكلمة'));

  state.live = { schema: 1, date: D, stage: 2 };
  await tick(page, 31000);
  assert.equal(liveRequests.length, 2);
  await expectProgram(page, ['دلوقتي | ترانيم', 'بعدها | الختام | الساعة ٩:٤٥ بالليل']);

  state.live = 404;
  await tick(page, 31000);
  assert.ok(await titleIs(page, 'الكلمة'));
  await close();

});

test('live.json is asked about every 30 s, only in the live window, never while hidden', async () => {

  // in the window: once at start, then not before ~30 s
  const { page, liveRequests, close } = await open({ content: withProgram(), at: `${D}T20:40`, live: { schema: 1, date: D, stage: null } });
  assert.equal(liveRequests.length, 1, 'once on load');
  await tick(page, 15000);
  assert.equal(liveRequests.length, 1, 'not every tick');
  await tick(page, 15000);
  assert.equal(liveRequests.length, 2, 'about every 30 s');

  // hidden: nothing, whatever the clock does
  await page.evaluate(() => window.__setHidden(true));
  await tick(page, 60000);
  await tick(page, 60000);
  assert.equal(liveRequests.length, 2, 'never while hidden');

  // back: at once
  await page.evaluate(() => { window.__advance(1000); window.__setHidden(false); });
  await wait(200);
  assert.equal(liveRequests.length, 3, 'asked when the tab comes back');
  await close();

  // outside the window: never (another day, the morning, after the end)
  for (const at of ['2026-10-09T20:40', `${D}T12:00`, `${D}T19:40`, `${D}T22:10`]) {
    const run = await open({ content: withProgram(), at, live: { schema: 1, date: D, stage: 1 } });
    await tick(run.page, 31000);
    await run.page.evaluate(() => { window.__setHidden(true); window.__setHidden(false); });
    await wait(150);
    assert.equal(run.liveRequests.length, 0, `nothing asked at ${at}`);
    await run.close();
  }

  // a few minutes before the start: the window is open
  const early = await open({ content: withProgram(), at: `${D}T19:50`, live: { schema: 1, date: D, stage: 0 } });
  assert.equal(early.liveRequests.length, 1);
  await expectProgram(early.page, ['دلوقتي | تسبحة', 'بعدها | الكلمة | الساعة ٨:٣٠ بالليل'], 'the leader started early');
  await early.close();

  // no program at all: never
  const plain = await open({ at: `${D}T20:40` });
  await tick(plain.page, 31000);
  assert.equal(plain.liveRequests.length, 0);
  await plain.close();

});

test('the meeting sheet lists the program with the stage on now', async () => {

  const { page, close } = await open({ content: withProgram(), at: `${D}T20:40`, live: 404 });
  await page.evaluate(() => { location.hash = '#meeting'; });
  await page.waitForSelector('dialog.sheet[open] .program');

  const read = () => page.$$eval('dialog.sheet .program__stage', els => els.map(li => [
    li.querySelector('.program__title').textContent,
    li.querySelector('.program__time').textContent,
    li.classList.contains('is-now') ? 'now' : li.classList.contains('is-done') ? 'done' : '',
    li.getAttribute('aria-current') || ''
  ]));

  assert.deepEqual(await read(), [
    ['تسبحة', '٨ بالليل', 'done', ''],
    ['الكلمة', '٨:٣٠ بالليل', 'now', 'step'],
    ['ترانيم', '٩:١٥ بالليل', '', ''],
    ['الختام', '٩:٤٥ بالليل', '', '']
  ]);

  // it follows the clock while open
  await tick(page, 40 * 60000);
  await wait(200);
  assert.deepEqual((await read()).map(r => r[2]), ['done', 'done', 'now', '']);

  // axe inside the sheet
  await close();

  const run = await open({ content: withProgram(), at: `${D}T20:40`, bypass: true });
  await run.page.evaluate(() => { location.hash = '#meeting'; });
  await run.page.waitForSelector('dialog.sheet[open] .program');
  await wait(700);
  await run.page.evaluate(AXE);
  const results = await run.page.evaluate(() => axe.run(document.querySelector('dialog.sheet'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
  assert.deepEqual(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`), []);
  await run.close();

});

test('reduced motion and the lite tier: the stage changes without animation', async () => {

  for (const options of [{ reduced: true }, { weak: true }]) {
    const { page, close } = await open({ content: withProgram(), at: `${D}T20:40`, ...options });
    await page.waitForFunction(() => document.documentElement.dataset.motion !== 'full');
    await tick(page, 40 * 60000);
    const running = await page.$eval('.program-now', el => el.getAnimations({ subtree: true }).length);
    assert.equal(running, 0, JSON.stringify(options));
    assert.equal(await page.$eval('.program-now__title', el => el.textContent), 'ترانيم');
    await close();
  }

});


/* ---------------- «شكل الخلفية» ---------------- */

const surfaceOf = page => page.$eval('[data-area="section"]', el => {
  const style = getComputedStyle(el);
  return {
    surface: el.dataset.surface || '',
    background: style.backgroundImage === 'none' ? style.backgroundColor : style.backgroundImage.slice(0, 15),
    border: style.borderTopColor,
    shadow: style.boxShadow === 'none' ? 'none' : 'shadow',
    blur: style.backdropFilter
  };
});

for (const [name, viewport] of Object.entries({ phone: PHONE, desktop: DESKTOP })) {

  test(`${name}: each surface renders on the social section and passes axe`, async () => {

    const seen = {};

    for (const surface of ['', 'glass', 'dark', 'filled', 'none']) {
      const { page, problems, close } = await open({ viewport, content: withSurface('social', surface), bypass: true });
      await page.evaluate(() => { document.documentElement.dataset.motion = 'full'; });
      const look = await surfaceOf(page);
      seen[surface || 'auto'] = look;
      assert.equal(look.surface, surface);
      assert.equal(await overflow(page), 0);

      // contrast (after the entrance animations: fading cards are see-through)
      await page.$eval('[data-area="section"]', el => el.scrollIntoView({ block: 'center' }));
      await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), { timeout: 8000 }).catch(() => {});
      await wait(400);
      await page.evaluate(AXE);
      const results = await page.evaluate(() => axe.run(document.querySelector('[data-area="section"]'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
      assert.deepEqual(results.violations.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`), [], `${surface || 'auto'}`);

      // focus rings stay visible on its links
      const ring = await page.evaluate(() => {
        const link = document.querySelector('[data-area="section"] a');
        link.focus({ focusVisible: true });
        const style = getComputedStyle(link);
        return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
      });
      assert.ok(ring, `focus ring with ${surface || 'auto'}`);
      assert.deepEqual(problems, []);
      await close();
    }

    assert.match(seen.glass.blur, /blur/, 'glass is frosted in the full tier');
    assert.equal(seen.dark.background, 'rgb(4, 17, 39)', 'dark: one solid deep navy');
    assert.match(seen.filled.background, /gradient/);
    assert.equal(seen.none.background, 'rgba(0, 0, 0, 0)');
    assert.equal(seen.none.shadow, 'none');
    assert.equal(seen.none.border, 'rgba(0, 0, 0, 0)');
    for (const surface of ['glass', 'dark', 'filled', 'none']) {
      assert.notDeepEqual(seen[surface], seen.auto, `${surface} differs from the default`);
    }

  });

}

test('surfaceMobile: phones only, and it follows a resize; any section kind', async () => {

  const content = withSurface('social', 'dark', 'glass');
  Object.assign(content.layout.find(s => s.kind === 'location'), { surface: 'none' });
  Object.assign(content.layout.find(s => s.kind === 'meeting'), { surfaceMobile: 'filled' });

  const { page, close } = await open({ viewport: PHONE, content });
  const read = () => page.evaluate(() => ['section', 'location', 'meeting'].map(area => document.querySelector(`[data-area="${area}"]`).dataset.surface || ''));
  assert.deepEqual(await read(), ['glass', 'none', 'filled']);

  await page.setViewport(DESKTOP);
  await page.waitForFunction(() => document.querySelector('[data-area="section"]').dataset.surface === 'dark');
  assert.deepEqual(await read(), ['dark', 'none', '']);

  await page.setViewport(PHONE);
  await page.waitForFunction(() => document.querySelector('[data-area="section"]').dataset.surface === 'glass');
  assert.equal(await overflow(page), 0);
  await close();

});

test('glass: blur only in the full tier (none when reduced or lite)', async () => {

  for (const options of [{ reduced: true }, { weak: true }]) {
    const { page, close } = await open({ viewport: PHONE, content: withSurface('social', 'glass'), ...options });
    await page.waitForFunction(() => document.documentElement.dataset.motion !== 'full');
    assert.equal(await page.$eval('[data-area="section"]', el => getComputedStyle(el).backdropFilter), 'none', JSON.stringify(options));
    await close();
  }

});
