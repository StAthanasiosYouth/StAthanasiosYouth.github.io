// The admin fix pass in a real browser (the official /admin/ against the
// real .gs code in a fake Apps Script world): a publish under way reopens
// at its step (never a second publish), and an upload stays listed while
// the admin moves between screens (never a second upload).
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/fix-admin.e2e.mjs

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4545;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const BASE = `${SITE}/`;
const ADMIN_URL = `${BASE}admin/`;
const ADMIN = 'menazakmena@gmail.com';
const DESKTOP = { width: 1440, height: 900 };

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

let world;
let server;
let browser;

test.before(async () => {
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', BASE);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.gs.SESSION_STALE_SECONDS = 0;
  world.as('');
  const config = { apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK };
  server = createSiteServer({ world: { issueToken: c => world.issueToken(c), get github() { return world.github; } }, config: () => config, claims: () => ({ email: ADMIN }) });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => (server ? server.close(resolve) : resolve()));
});

async function open() {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  const google = await interceptGoogle(page, { post: body => world.post(body) }, { site: { origin: SITE, local: LOCAL } });
  await page.setViewport(DESKTOP);
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
  // `fn` calls wait until window.__release[fn]() (counted in window.__calls)
  await page.evaluate(() => {
    const real = A.call;
    window.__calls = {};
    window.__release = {};
    window.__hold = new Set();
    A.call = function (fn) {
      const args = arguments;
      window.__calls[fn] = (window.__calls[fn] || 0) + 1;
      if (!window.__hold.has(fn)) return real.apply(A, args);
      return new Promise(resolve => { window.__release[fn] = () => resolve(real.apply(A, args)); });
    };
  });
  return { page, problems, close: () => context.close() };

}

const current = page => page.evaluate(() => {
  const step = document.querySelector('dialog.sheet[open] .stepper[data-publish] .is-current');
  return step ? [...step.parentNode.children].indexOf(step) : -1;
});

test('a publish under way: closing the editor and opening it again shows the same job at its step', async () => {

  const { page, problems, close } = await open();

  await page.evaluate(() => A.go('settings'));
  await page.waitForSelector('.card .input');
  await page.evaluate(() => {
    const field = [...document.querySelectorAll('.field')].find(f => f.dataset.label === 'الجملة التعريفية');
    const input = field.querySelector('input, textarea');
    input.value = 'نشر وهو مقفول';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    field.closest('.card').querySelector('.btn--primary').click();
  });
  await page.waitForFunction(() => A.setting('site.tagline') === 'نشر وهو مقفول');

  await page.evaluate(() => window.__hold.add('apiPublish'));
  await page.click('#publish-open');
  await page.waitForSelector('dialog.sheet[open] .changes');
  await page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .sheet__foot .btn--primary')][0].click());
  await page.waitForFunction(() => window.__release.apiPublish);
  const before = await current(page);
  assert.ok(before >= 1, `publishing shows a later step (${before})`);

  // closed while it runs, then opened again: the same step, no new review, no second publish
  await page.evaluate(() => A.closeSheet());
  await page.waitForFunction(() => !document.querySelector('dialog.sheet[open]'));
  await page.click('#publish-open');
  await page.waitForSelector('dialog.sheet[open] .stepper[data-publish]');
  assert.equal(await current(page), before, 'reopened at the same step');
  assert.equal(await page.$('dialog.sheet[open] .changes'), null, 'not the review again');

  // it finishes while closed; reopened, it shows where the same job got to
  await page.evaluate(() => A.closeSheet());
  await page.evaluate(() => window.__release.apiPublish());
  await page.waitForFunction(() => A.publishState() && A.publishState().step >= 2, { timeout: 20000 });
  await page.click('#publish-open');
  await page.waitForSelector('dialog.sheet[open] .stepper[data-publish]');
  assert.ok(await current(page) >= 2 || await page.$('dialog.sheet[open] .note--ok'), 'the job moved on');
  assert.equal(await page.evaluate(() => window.__calls.apiPublish), 1, 'published once');
  assert.match(String(world.github.files()['content.json']), /نشر وهو مقفول/);
  assert.deepEqual(problems, []);
  await close();

});

test('an upload stays listed (name, progress, result) after leaving «الصور» and coming back', async () => {

  const { page, problems, close } = await open();

  await page.evaluate(() => { window.__hold.add('apiUploadMedia'); A.go('media'); });
  await page.waitForSelector('input[type="file"]');
  const file = `${ROOT}tools/.cache/fix-admin-upload.png`;
  const sharp = require('sharp');
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#d7aa50' } }).png().toFile(file);
  const input = await page.$('input[type="file"]');
  await input.uploadFile(file);
  await page.waitForFunction(() => window.__release.apiUploadMedia, { timeout: 20000 });

  // away and back while it is still sending
  await page.evaluate(() => A.go('settings'));
  await page.waitForSelector('.card .input');
  assert.equal(await page.evaluate(() => A.uploads.length), 1);
  await page.evaluate(() => A.go('media'));
  await page.waitForFunction(() => [...document.querySelectorAll('.uploads .uploads__name, .upload')].some(n => n.textContent.includes('fix-admin-upload')), { timeout: 10000 });

  // it ends: the same entry says so, and it was sent once
  await page.evaluate(() => window.__release.apiUploadMedia());
  await page.waitForFunction(() => A.uploads.length === 1 && A.uploads[0].stage === 'done', { timeout: 20000 });
  assert.equal(await page.evaluate(() => window.__calls.apiUploadMedia), 1, 'uploaded once');
  assert.ok(readFileSync(file).length > 0);
  assert.deepEqual(problems, []);
  await close();

});
