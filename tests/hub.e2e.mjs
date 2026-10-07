// Browser checks for the hub (news, games, bell, sheets, motion, sound),
// against demo content produced by the real admin code (tools/demo.mjs).
//
// Run: cd tools && npm run e2e

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 4398;
const BASE = `http://localhost:${PORT}/`;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const PHONE = { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1366, height: 900, deviceScaleFactor: 1 };
const ENTRANCES = ['rise-depth', 'arch-in', 'logo-in', 'cross-in', 'name-in'];

let server;
let browser;

test.before(async () => {
  execFileSync(process.execPath, [`${ROOT}tools/demo.mjs`], { stdio: 'pipe' });
  server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT), '--demo'], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  server?.kill();
});


async function open(viewport, { before, hash = '', bypassCSP = false } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];

  page.on('console', msg => { if (msg.type() === 'error') problems.push(`console: ${msg.text()}`); });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));

  await page.evaluateOnNewDocument(() => {
    document.addEventListener('securitypolicyviolation', e => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });

  if (before) await page.evaluateOnNewDocument(before);
  if (bypassCSP) await page.setBypassCSP(true);

  await page.setViewport(viewport);
  await page.goto(BASE + hash, { waitUntil: 'networkidle0' });
  await page.waitForSelector('main[data-state="ready"]');

  return { page, problems };

}

const settle = page => page.waitForFunction(names => document.getAnimations()
  .filter(a => names.includes(a.animationName))
  .every(a => a.playState !== 'running'), { timeout: 8000 }, ENTRANCES);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


for (const [name, viewport] of Object.entries({ phone: PHONE, desktop: DESKTOP })) {

  test(`${name}: hub sections render, fit and pass axe`, async () => {

    const { page, problems } = await open(viewport);

    const areas = await page.$$eval('[data-area]', els => [...new Set(els.map(e => e.dataset.area))]);
    assert.deepEqual(areas.slice(0, 7), ['hero', 'meeting', 'live-game', 'announcement', 'featured', 'news', 'games']);

    assert.ok(await page.$('.topic'), 'meeting topic shown');
    assert.ok(await page.$('.game--live .game__play[href^="https://"]'), 'live game is playable');
    assert.ok(await page.$('.game--soon .game__play[aria-disabled="true"]'), 'upcoming game is locked');
    assert.equal(await page.$eval('.bell__badge', el => el.hidden), false);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);

    await settle(page);
    const small = await page.$$eval('a[href], button', els => els
      .filter(el => el.offsetParent !== null && !el.closest('.news__rail'))
      .map(el => {
        const target = el.classList.contains('stretched') ? el.closest('article') : el;
        const r = target.getBoundingClientRect();
        return { text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter(r => r.w < 44 || r.h < 44));
    assert.deepEqual(small, [], 'touch targets under 44px');

    await page.setBypassCSP(true);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('main[data-state="ready"]');
    await settle(page);
    await page.evaluate(AXE);
    const results = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
    assert.deepEqual(results.violations.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`), []);

    assert.deepEqual(problems.filter(p => !p.includes('Refused to apply inline style')), []);
    await page.close();

  });

}


test('bell: badge, panel groups, read state survives a reload, axe inside the panel', async () => {

  const { page } = await open(PHONE, { bypassCSP: true });

  const badge = await page.$eval('.bell__badge', el => el.textContent);
  assert.equal(badge, '٧', '5 notifications + the competition and the trip (tools/demo.mjs)');

  await page.click('#bell');
  await page.waitForSelector('dialog.sheet--panel[open]');
  assert.equal(await page.evaluate(() => location.hash), '#notifications');
  assert.equal(await page.$eval('.bell__badge', el => el.hidden), true, 'opening clears the badge');

  const groups = await page.$$eval('.inbox__day', els => els.map(e => e.textContent));
  assert.equal(groups[0], 'النهارده');

  // axe on the open panel
  await sleep(700);
  await page.evaluate(AXE);
  const results = await page.evaluate(() => axe.run(document.querySelector('dialog.sheet'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
  assert.deepEqual(results.violations.map(v => `${v.id}: ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`), []);

  // tap the trip notification: opens the news item, marks it read
  // (the news item; the trip activity has its own «التسجيل للرحلة فتح» notification)
  await page.evaluate(() => [...document.querySelectorAll('.note-item')].find(e => e.textContent.includes('رحلة الغردقة') && !e.textContent.includes('التسجيل')).click());
  await page.waitForFunction(() => location.hash.startsWith('#news/'));
  await page.waitForSelector('dialog.sheet--detail[open] .detail__body');

  // phone back button: back to the bell
  await page.goBack();
  await page.waitForFunction(() => location.hash === '#notifications');
  await page.waitForSelector('dialog.sheet--panel[open]');
  const tripNew = await page.evaluate(() => [...document.querySelectorAll('.note-item.is-new')].some(e => e.textContent.includes('رحلة الغردقة') && !e.textContent.includes('التسجيل')));
  assert.equal(tripNew, false);

  await page.goBack();
  await page.waitForFunction(() => !location.hash && !document.querySelector('dialog.sheet'));

  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('main[data-state="ready"]');
  assert.equal(await page.$eval('.bell__badge', el => el.hidden), true, 'still read after reload');

  await page.close();

});


test('deep links: game and meeting open directly; unknown ids are cleaned up', async () => {

  const content = JSON.parse(readFileSync(`${ROOT}tools/.cache/demo/content.json`, 'utf8'));
  const live = content.games.find(g => g.title.includes('الاستكشاف'));

  const { page } = await open(PHONE, { hash: `#game/${live.id}` });
  await page.waitForSelector('dialog.sheet[open] .detail__game');
  assert.ok(await page.$('dialog.sheet .game__play[href]'));
  const before = await page.evaluate(() => history.length);
  await page.evaluate(() => document.querySelector('dialog.sheet .sheet__close').click());
  await page.waitForFunction(() => !document.querySelector('dialog.sheet') && !location.hash);
  assert.equal(await page.evaluate(() => history.length), before, 'closing a link opened from outside adds no history entry');

  await page.evaluate(() => { location.hash = '#meeting'; });
  await page.waitForSelector('dialog.sheet[open] .detail__topic');
  assert.equal(await page.$eval('.detail__topic', el => el.textContent), 'حياة التسليم');

  await page.evaluate(() => { location.hash = '#news/nope'; });
  await page.waitForFunction(() => !location.hash && !document.querySelector('dialog.sheet'));

  await page.close();

});


test('a device clock 5 hours off still shows Egypt time states (server Date header)', async () => {

  const { page } = await open(PHONE, {
    before: () => {
      const skew = 5 * 3600 * 1000;
      const RealDate = Date;
      const realNow = RealDate.now.bind(RealDate);
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [realNow() + skew])); }
        static now() { return realNow() + skew; }
      };
    }
  });

  // the explore game is open right now in Cairo; with a +5h clock it would look ended
  await page.waitForSelector('.game--live');
  const state = await page.$eval('.game--live .game__state', el => el.textContent);
  assert.match(state, /جاهزة/);
  await page.close();

});


// (final/s: sound is ON by default now; nothing audible before a gesture, a mute is remembered)
test('sound: on by default, woken by the first gesture; a mute is remembered', async () => {

  const { page } = await open(PHONE, {
    before: () => {
      window.__audioContexts = 0;
      const Real = window.AudioContext;
      window.AudioContext = class extends Real { constructor(...a) { super(...a); window.__audioContexts++; } };
    }
  });

  assert.equal(await page.$eval('#sound-toggle', el => el.getAttribute('aria-pressed')), 'true', 'on by default');
  assert.equal(await page.evaluate(() => window.__audioContexts), 0, 'no audio context before a gesture');

  await page.click('#bell');
  await page.waitForSelector('dialog.sheet[open]');
  await page.evaluate(() => document.querySelector('dialog.sheet .sheet__close').click());
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  assert.equal(await page.evaluate(() => window.__audioContexts), 1, 'the first gesture wakes it');

  await page.click('#sound-toggle');
  assert.equal(await page.$eval('#sound-toggle', el => el.getAttribute('aria-pressed')), 'false');
  assert.equal(await page.evaluate(() => localStorage.getItem('athanasios.sound')), 'off');

  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await page.$eval('#sound-toggle', el => el.getAttribute('aria-pressed')), 'false', 'the mute is remembered');
  await page.click('#bell');
  await page.waitForSelector('dialog.sheet[open]');
  assert.equal(await page.evaluate(() => window.__audioContexts), 0, 'muted: no audio at all');
  await page.close();

});


test('reduced motion: no particles, no rim, no intro animation', async () => {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport(PHONE);
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.game--live');

  const report = await page.evaluate(() => ({
    dust: getComputedStyle(document.querySelector('.hero__dust')).display,
    embers: getComputedStyle(document.querySelector('.game__embers')).display,
    rim: getComputedStyle(document.querySelector('.game--live'), '::before').animationName,
    name: getComputedStyle(document.querySelector('.hero__name-lead')).animationName
  }));

  assert.deepEqual(report, { dust: 'none', embers: 'none', rim: 'none', name: 'none' });
  await page.close();

});
