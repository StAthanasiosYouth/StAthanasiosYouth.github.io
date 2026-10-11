// The SITE app next to the admin app (two apps, one origin): the page at "/"
// names itself /index.html (inside the site app's scope, so Chrome's «فتح في
// التطبيق» works), and the bell offers «ثبّت تطبيق الأسرة» — only on
// Android, only while the SITE app isn't installed (never fooled by the
// admin app), with Chrome's real dialog when it's there, else the menu steps.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { ROOT } from '../tools/lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4932;
const SITE = `http://localhost:${PORT}`;
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-G780F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const SITE_MANIFEST = 'https://stathanasiosyouth.github.io/manifest.webmanifest';
const ADMIN_MANIFEST = 'https://stathanasiosyouth.github.io/admin/manifest.webmanifest';
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

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

/* the platform, staged before the page runs */
function stage({ standalone = false, related = null, prompt = false } = {}) {
  return `(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = q => /display-mode: standalone/.test(q) ? { matches: ${standalone}, media: q, addEventListener() {}, removeEventListener() {} } : real(q);
    ${related === null ? 'delete Navigator.prototype.getInstalledRelatedApps;' : `navigator.getInstalledRelatedApps = async () => ${JSON.stringify(related)};`}
    window.__prompted = 0;
    ${prompt ? `window.addEventListener('load', () => setTimeout(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = () => { window.__prompted++; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    }, 50));` : ''}
  })();`;
}

async function visit({ ua = ANDROID, path = '/', ...options } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setUserAgent(ua);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(stage(options));
  await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle0' });
  return { ctx, page, errors };
}

async function openBell(page) {
  await page.waitForSelector('#main[data-state="ready"]', { timeout: 15000 });
  await page.click('#bell');
  await page.waitForSelector('.push-slot .push-card', { timeout: 8000 });
  await new Promise(resolve => setTimeout(resolve, 500));
  return page.evaluate(() => {
    const card = document.querySelector('.install-card');
    return card && !card.hidden ? card.innerText : '';
  });
}


test('"/" names itself /index.html (the site app\'s own address); the link\'s item stays', async () => {
  const { ctx, page, errors } = await visit({ path: '/#notifications' });
  assert.equal(new URL(page.url()).pathname, '/index.html');
  assert.equal(new URL(page.url()).hash, '#notifications');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('bell, Android, no install dialog: the Chrome-menu steps and «مش دلوقتي» (30 days)', async () => {
  const { ctx, page, errors } = await visit();
  const text = await openBell(page);
  assert.match(text, /ثبّت تطبيق الأسرة على موبايلك/);
  assert.match(text, /⋮/);
  assert.match(text, /تثبيت التطبيق/);
  assert.equal(await page.$('.install-card .btn--primary'), null, 'no dead button');
  await page.evaluate(() => [...document.querySelectorAll('.install-card .btn')].find(b => /مش دلوقتي/.test(b.textContent)).click());
  assert.equal(await page.$eval('.install-card', n => n.hidden), true);
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await openBell(page), '', 'not again for a while');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('bell, Android, Chrome\'s dialog ready: «تثبيت التطبيق» opens it', async () => {
  const { ctx, page, errors } = await visit({ prompt: true });
  const text = await openBell(page);
  assert.match(text, /تثبيت التطبيق/);
  await page.click('.install-card .btn--primary');
  await page.waitForFunction(() => window.__prompted === 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('bell: the SITE app installed → «متثبت»; only the ADMIN app installed → still offered; in the site app → nothing; iPhone → nothing extra', async () => {
  let v = await visit({ related: [{ platform: 'webapp', url: SITE_MANIFEST }] });
  assert.match(await openBell(v.page), /تطبيق الأسرة متثبت على الموبايل ده/);
  await v.ctx.close();

  v = await visit({ related: [{ platform: 'webapp', url: ADMIN_MANIFEST }] });
  const text = await openBell(v.page);
  assert.doesNotMatch(text, /متثبت/);
  assert.match(text, /ثبّت تطبيق الأسرة/);
  await v.ctx.close();

  v = await visit({ standalone: true });
  assert.equal(await openBell(v.page), '');
  await v.ctx.close();

  v = await visit({ ua: IPHONE });
  assert.equal(await openBell(v.page), '', 'the notifications card already explains «إضافة إلى الشاشة الرئيسية»');
  await v.ctx.close();
});
