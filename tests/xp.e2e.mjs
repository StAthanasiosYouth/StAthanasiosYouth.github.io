// The social mini-experiences (xp.js): first tap opens the scene, never the
// platform; the button is the real link; first vs later visits; keyboard;
// reduced motion; nothing keeps running after close.
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

const PORT = 4392;
const BASE = `http://localhost:${PORT}/`;
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };

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

async function open({ reduced = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const outside = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(BASE) && !request.url().startsWith('data:')) outside.push(request.url()); });
  await page.setViewport(PHONE);
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main[data-state="ready"]');
  return { page, problems, outside, context, close: () => context.close() };
}

const PLATFORMS = {
  facebook: { scene: '.fb', cta: 'افتح صفحتنا على فيسبوك', host: 'www.facebook.com' },
  instagram: { scene: '.ig', cta: 'افتح إنستجرام', host: 'www.instagram.com' },
  tiktok: { scene: '.tt', cta: 'افتح تيك توك', host: 'www.tiktok.com' },
  whatsapp: { scene: '.wa', cta: 'انضم لجروب الواتساب', host: 'chat.whatsapp.com' }
};


test('each platform: the first tap opens its own scene, never the platform', async () => {

  const { page, problems, outside, context, close } = await open();
  const tabs = (await context.pages()).length;

  for (const [platform, expect] of Object.entries(PLATFORMS)) {
    await page.tap(`[data-experience="${platform}"]`);
    await page.waitForSelector(`dialog.sheet--xp[open] ${expect.scene}`);
    const info = await page.evaluate(() => {
      const cta = document.querySelector('dialog.sheet--xp[open] .xp__cta');
      return { hash: location.hash, href: cta.href, target: cta.target, rel: cta.rel, text: cta.textContent.trim() };
    });
    assert.match(info.hash, /^#follow\//, platform);
    assert.equal(new URL(info.href).host, expect.host, platform);
    assert.equal(info.target, '_blank');
    assert.match(info.rel, /noopener/);
    assert.equal(info.text, expect.cta, platform);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.sheet') && !location.hash);
  }

  assert.equal(new URL(page.url()).host, `localhost:${PORT}`, 'still on our page');
  assert.equal((await context.pages()).length, tabs, 'no new tab opened by the first tap');
  assert.deepEqual(outside.filter(u => /facebook|instagram|tiktok|whatsapp/.test(u)), [], 'nothing requested from the platforms');
  assert.deepEqual(problems, []);
  await close();

});

test('first visit: the full scene, the button within a second; later visits: the button at once', async () => {

  const { page, problems, close } = await open();

  await page.tap('[data-experience="instagram"]');
  await page.waitForSelector('dialog.sheet--xp[open] .xp');
  assert.equal(await page.$eval('.xp', n => n.classList.contains('is-first') && n.classList.contains('cta-pending')), true);
  await page.waitForFunction(() => !document.querySelector('.xp').classList.contains('cta-pending'), { timeout: 1500 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));

  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('athanasios.xp.v1'))), { instagram: 1 });

  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#main[data-state="ready"]');
  await page.tap('[data-experience="instagram"]');
  await page.waitForSelector('dialog.sheet--xp[open] .xp');
  assert.equal(await page.$eval('.xp', n => n.classList.contains('cta-pending') || n.classList.contains('is-first')), false, 'quick version');

  assert.deepEqual(problems, []);
  await close();

});

test('keyboard: Enter opens it, the button is reachable, Esc closes and returns', async () => {

  const { page, problems, close } = await open();
  await page.focus('[data-experience="tiktok"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog.sheet--xp[open] .tt');
  const focusable = await page.evaluate(() => [...document.querySelectorAll('dialog.sheet--xp[open] a, dialog.sheet--xp[open] button')].map(n => n.textContent.trim() || n.getAttribute('aria-label')));
  assert.ok(focusable.includes('افتح تيك توك') && focusable.includes('قفل'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  assert.deepEqual(problems, []);
  await close();

});

test('ctrl/cmd-click and middle-click still go straight to the platform', async () => {

  const { page, problems, close } = await open();
  const prevented = await page.evaluate(() => {
    const link = document.querySelector('[data-experience="facebook"]');
    const results = {};
    for (const [name, init] of Object.entries({ ctrl: { ctrlKey: true }, meta: { metaKey: true }, middle: { button: 1 } })) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
      // keep the test page here: stop the default after our handler ran
      link.addEventListener('click', e => { results[name] = e.defaultPrevented; e.preventDefault(); }, { once: true });
      link.dispatchEvent(event);
    }
    return results;
  });
  assert.deepEqual(prevented, { ctrl: false, meta: false, middle: false });
  assert.equal(await page.$('dialog.sheet'), null, 'no scene for a modified click');
  assert.deepEqual(problems, []);
  await close();

});

test('reduced motion: the finished picture, no movement, the button at once', async () => {

  const { page, problems, close } = await open({ reduced: true });
  await page.tap('[data-experience="whatsapp"]');
  await page.waitForSelector('dialog.sheet--xp[open] .wa-reaction');
  const state = await page.evaluate(() => ({
    pending: document.querySelector('.xp').classList.contains('cta-pending'),
    reaction: getComputedStyle(document.querySelector('.wa-reaction')).opacity,
    read: document.querySelector('.wa-ticks').classList.contains('is-read'),
    moving: document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.xp-stage')).length
  }));
  assert.deepEqual(state, { pending: false, reaction: '1', read: true, moving: 0 });
  assert.deepEqual(problems, []);
  await close();

});

test('closing the sheet stops the scene', async () => {

  const { page, problems, close } = await open();
  await page.tap('[data-experience="facebook"]');
  await page.waitForSelector('dialog.sheet--xp[open] .fb');
  await new Promise(resolve => setTimeout(resolve, 900));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  await new Promise(resolve => setTimeout(resolve, 600));
  const leftovers = await page.evaluate(() => document.querySelectorAll('.xp-float, .xp-stage').length);
  assert.equal(leftovers, 0);
  assert.deepEqual(problems, []);
  await close();

});
