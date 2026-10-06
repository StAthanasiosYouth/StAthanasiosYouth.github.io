// Site-wide feel (feel.js): motion tiers, scroll reveals that never leave
// anything hidden, touch ripples that never cost a second tap, the pointer
// light on desktop, reduced motion, weak devices, and a scroll budget
// on a throttled CPU.
//
// Run: cd tools && npm run e2e

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4393;
const BASE = `http://localhost:${PORT}/`;
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const DESKTOP = { width: 1280, height: 900 };

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

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

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function open({ viewport = PHONE, reduced = false, weak = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.setViewport(viewport);
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (weak) {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 1 });
    });
  }
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main[data-state="ready"]');
  return { page, problems, close: () => context.close() };
}

/* scroll to the bottom in steps, the way a thumb does */
async function scrollThrough(page, step = 500, pause = 120) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += step) {
    await page.evaluate(top => scrollTo(0, top), y);
    await wait(pause);
  }
}

const hiddenWidgets = page => page.evaluate(() =>
  [...document.querySelectorAll('#main > [data-dynamic]')]
    .filter(w => getComputedStyle(w).opacity !== '1')
    .map(w => w.className));


test('phone: sections below the fold wait, then rise in; nothing stays hidden', async () => {

  const { page, problems, close } = await open();

  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'full');
  const waiting = await page.evaluate(() => document.querySelectorAll('.will-reveal').length);
  assert.ok(waiting > 3, `below-the-fold sections wait (${waiting})`);
  // the first screen is never held back
  const firstScreen = await page.evaluate(() => [...document.querySelectorAll('#main > [data-dynamic]')]
    .filter(w => w.getBoundingClientRect().top < innerHeight * 0.9)
    .filter(w => w.classList.contains('will-reveal')).length);
  assert.equal(firstScreen, 0);

  await scrollThrough(page);
  await wait(1400);

  assert.equal(await page.evaluate(() => document.querySelectorAll('.will-reveal').length), 0, 'every section revealed');
  assert.deepEqual(await hiddenWidgets(page), []);
  assert.deepEqual(problems, []);
  await close();

});

test('touch: one tap opens, the ripple is decoration only and cleans up', async () => {

  const { page, problems, close } = await open();

  // a link group tile (opens its experience scene on the first tap)
  const tile = await page.$('[data-experience="facebook"]');
  await tile.scrollIntoView();
  await wait(1200);
  await tile.tap();
  await page.waitForSelector('dialog.sheet--xp[open]', { timeout: 2000 });
  assert.match(await page.evaluate(() => location.hash), /^#follow\//);

  const fx = await page.evaluate(() => {
    const layer = document.querySelector('[data-experience="facebook"] > .fx');
    return layer && { events: getComputedStyle(layer).pointerEvents, hidden: layer.getAttribute('aria-hidden') };
  });
  assert.deepEqual(fx, { events: 'none', hidden: 'true' });

  await wait(1000);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.ripple').length), 0, 'ripples removed');

  // a plain button on the page: the first tap still does its job
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  const details = await page.$('.news-lead');
  await details.scrollIntoView();
  await wait(1200);
  await details.tap();
  await page.waitForFunction(() => location.hash.startsWith('#news/'), { timeout: 2000 });

  assert.deepEqual(problems, []);
  await close();

});

test('desktop: the light follows the pointer, posters drift, clicks still land', async () => {

  const { page, problems, close } = await open({ viewport: DESKTOP });

  const card = await page.$('.news-lead');
  await card.scrollIntoView();
  await wait(1300);
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.4, { steps: 3 });
  await wait(100);

  const lit = await page.evaluate(() => {
    const c = document.querySelector('.news-lead');
    return { lit: c.classList.contains('is-lit'), mx: c.style.getPropertyValue('--mx'), px: c.style.getPropertyValue('--px') };
  });
  assert.equal(lit.lit, true);
  assert.equal(lit.mx, '25.0%');
  assert.match(lit.px, /^-?\d+\.\d\dpx$/);

  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.4);
  await page.waitForFunction(() => location.hash.startsWith('#news/'), { timeout: 2000 });

  assert.deepEqual(problems, []);
  await close();

});

test('reduced motion: everything is simply there; no reveals, ripples or light', async () => {

  const { page, problems, close } = await open({ reduced: true });

  const state = await page.evaluate(() => ({
    tier: document.documentElement.dataset.motion,
    waiting: document.querySelectorAll('.will-reveal, .is-entering').length
  }));
  assert.deepEqual(state, { tier: 'reduced', waiting: 0 });
  assert.deepEqual(await hiddenWidgets(page), []);

  const tile = await page.$('[data-experience="instagram"]');
  await tile.scrollIntoView();
  await tile.tap();
  assert.equal(await page.evaluate(() => document.querySelectorAll('.ripple').length), 0);
  await page.waitForSelector('dialog.sheet--xp[open]');

  assert.deepEqual(problems, []);
  await close();

});

test('a weak phone gets the lite tier: no waiting, no dust, still one-tap', async () => {

  const { page, problems, close } = await open({ weak: true });

  const state = await page.evaluate(() => ({
    tier: document.documentElement.dataset.motion,
    waiting: document.querySelectorAll('.will-reveal').length,
    dust: getComputedStyle(document.querySelector('.hero__dust')).display
  }));
  assert.deepEqual(state, { tier: 'lite', waiting: 0, dust: 'none' });
  assert.deepEqual(await hiddenWidgets(page).then(list => list.filter(c => !/is-entering/.test(c))), []);

  const tile = await page.$('[data-experience="tiktok"]');
  await tile.scrollIntoView();
  await tile.tap();
  await page.waitForSelector('dialog.sheet--xp[open]');

  assert.deepEqual(problems, []);
  await close();

});

test('scrolling on a slow phone (4x CPU) stays free of long tasks', async () => {

  const { page, problems, close } = await open();
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.__long.push(Math.round(entry.duration));
    }).observe({ type: 'longtask' });
  });

  await scrollThrough(page, 300, 90);
  await wait(800);

  const long = await page.evaluate(() => window.__long);
  const worst = Math.max(0, ...long);
  assert.ok(worst < 200, `worst task while scrolling: ${worst} ms (${long.join(', ') || 'none'})`);

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  assert.deepEqual(problems, []);
  await close();

});
