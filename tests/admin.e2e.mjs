// The admin panel in a real browser: the real apps-script/*.html talking to
// the real .gs code in a fake Apps Script world (Sheet, Drive, GitHub).
//
// Run: cd tools && npm run e2e

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createAdminServer } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');

const ADMIN = 'menazakmena@gmail.com';
const PORT = 4397;
const BASE = `http://localhost:${PORT}/`;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

const DISABLED = {
  code: 403,
  body: { error: { code: 403, message: 'Google Drive API has not been used in project 1234 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } }
};

let world;
let server;
let browser;
const photos = {};

test.before(async () => {

  world = createWorld();
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');
  world.gs.apiSaveItem('sessions', { date: '2026-10-11', topic: 'الكسل الروحي', notify: { topic: false } });

  server = createAdminServer({ world, admin: ADMIN, latency: 40 });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));

  // a 12 MP phone photo with real detail (worst case for compression) and a small poster
  const noise = Buffer.alloc(4032 * 3024 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919 + (i >> 9) * 31) & 255;
  photos.big = join(tmpdir(), 'athanasios-e2e-big.jpg');
  writeFileSync(photos.big, await sharp(noise, { raw: { width: 4032, height: 3024, channels: 3 } }).jpeg({ quality: 92 }).toBuffer());
  photos.small = join(tmpdir(), 'athanasios-e2e-small.png');
  writeFileSync(photos.small, await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#1d3557' } }).png().toBuffer());

  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
});


async function open(viewport = PHONE) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];

  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  // native browser dialogs are not part of the admin's UX
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}: ${dialog.message()}`); await dialog.dismiss(); });

  await page.setViewport(viewport);
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.A && A.state);

  return { page, problems, close: () => context.close() };

}

async function openMeeting(page) {

  await page.evaluate(() => A.go('content', 'meetings'));
  await page.waitForSelector('[aria-label="تعديل الاجتماع"]');
  await page.click('[aria-label="تعديل الاجتماع"]');
  await page.waitForSelector('dialog[open] input[type=file]');

}

/* uploads through the picker; returns every stage label seen */
async function upload(page, file) {

  await page.evaluate(() => {
    window.__stages = [];
    const label = document.querySelector('dialog[open] .upload__label');
    new MutationObserver(() => window.__stages.push(label.textContent)).observe(label, { childList: true, characterData: true, subtree: true });
  });
  const input = await page.$('dialog[open] input[type=file]');
  await input.uploadFile(file);
  await page.waitForFunction(() => {
    const box = document.querySelector('dialog[open] .upload');
    return box && (box.classList.contains('is-done') || box.classList.contains('is-error'));
  }, { timeout: 60000 });
  return page.evaluate(() => window.__stages.map(s => s.replace(/ \d+ ث$/, '')));

}


test('a 12 MP phone photo: staged progress, preview, saved, still there after reopening, published', async () => {

  const { page, problems, close } = await open();
  await openMeeting(page);

  const stages = await upload(page, photos.big);
  assert.ok(stages.includes('جاري تجهيز الصورة…'), stages.join(' | '));
  assert.ok(stages.includes('جاري ضغط الصورة…'));
  assert.ok(stages.includes('جاري الرفع…'));
  assert.ok(stages.some(s => s.startsWith('تم الرفع ✓')));

  const preview = await page.evaluate(() => {
    const img = document.querySelector('dialog[open] .picker__img');
    return img && new Promise(resolve => (img.complete ? resolve(img.naturalWidth) : img.addEventListener('load', () => resolve(img.naturalWidth))));
  });
  assert.equal(preview, 480, 'thumbnail preview shown right away');

  const media = world.gs.readTable_('Media');
  assert.equal(media.length, 1);
  assert.deepEqual([media[0].width, media[0].height], [1600, 1200], 'resized to 1600 px');
  const bytes = world.drive.files.get(media[0].driveId).bytes.length;
  assert.ok(bytes < 900 * 1024, `compressed to ${Math.round(bytes / 1024)} KB`);

  await page.click('dialog[open] .sheet__foot .btn--primary');
  await page.waitForFunction(() => !document.querySelector('dialog#sheet').open);
  assert.equal(world.gs.readTable_('Sessions')[0].image, media[0].id, 'the session keeps the poster');

  await openMeeting(page);
  const reopened = await page.waitForFunction(() => {
    const img = document.querySelector('dialog[open] .picker__img');
    return img && img.complete && img.naturalWidth;
  });
  assert.ok(await reopened.jsonValue());

  const review = JSON.parse(JSON.stringify(world.as(ADMIN).gs.apiReview()));
  world.gs.apiPublish(review.revision);
  const files = world.github.files();
  const content = JSON.parse(files['content.json']);
  assert.equal(content.sessions[0].image.src, media[0].path);
  assert.ok(files[media[0].path] && files[media[0].thumb], 'image files in the same commit');

  assert.deepEqual(problems, []);
  await close();

});

test('a small image works the same way', async () => {

  const { page, problems, close } = await open({ width: 1280, height: 860 });
  await openMeeting(page);
  const stages = await upload(page, photos.small);
  assert.ok(stages.some(s => s.startsWith('تم الرفع ✓')), stages.join(' | '));
  const last = world.gs.readTable_('Media').at(-1);
  assert.deepEqual([last.width, last.height], [800, 1000], 'never upscaled');
  assert.deepEqual(problems, []);
  await close();

});

test('a Drive failure is visible inside the editor, with the real reason, and retry works', async () => {

  const { page, problems, close } = await open();
  await openMeeting(page);
  world.drive.failWith = DISABLED;

  const stages = await upload(page, photos.small);
  assert.ok(stages.includes('حدث خطأ أثناء الرفع'), stages.join(' | '));

  const shown = await page.evaluate(() => {
    const box = document.querySelector('dialog[open] .upload-error');
    return {
      visible: !!box && !box.hidden && box.getBoundingClientRect().height > 0,
      text: box ? box.textContent : '',
      details: box ? (box.querySelector('.tech pre') || {}).textContent : '',
      retry: !!box && [...box.querySelectorAll('button')].some(b => b.textContent === 'جرّب الرفع تاني')
    };
  });

  assert.equal(shown.visible, true);
  assert.match(shown.text, /مش مفعّلة/);
  assert.match(shown.details, /accessNotConfigured/);

  // any message raised while an editor is open is drawn above it
  await page.evaluate(() => A.toast('اختبار', true));
  await new Promise(resolve => setTimeout(resolve, 600));
  const toastOnTop = await page.evaluate(() => {
    const toast = document.getElementById('toast');
    const rect = toast.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.height > 0 && !!hit && (hit === toast || toast.contains(hit));
  });
  assert.equal(toastOnTop, true, 'the toast is drawn above the open dialog');
  assert.equal(shown.retry, true);

  // the problem is fixed: retry reuses the prepared image (no re-compression)
  world.drive.failWith = null;
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] .upload-error button')].find(b => b.textContent === 'جرّب الرفع تاني').click());
  await page.waitForFunction(() => document.querySelector('dialog[open] .upload').classList.contains('is-done'));
  assert.equal(await page.$eval('dialog[open] .upload-error', box => box.hidden), true);

  const failed = world.spreadsheet.getSheetByName('Log').data.filter(r => r[2] === 'media.upload.failed');
  assert.ok(failed.length >= 1, 'the failure is in the Log tab');

  assert.deepEqual(problems, []);
  await close();

});

test('Settings: «اختبر رفع الصور» shows each step', async () => {

  const { page, problems, close } = await open();
  await page.evaluate(() => A.go('settings'));
  const button = await page.waitForSelector('xpath/.//button[contains(., "اختبر رفع الصور")]');
  await button.click();
  await page.waitForSelector('.checklist:not([hidden]) .checklist__steps li');
  const steps = await page.$$eval('.checklist__steps li', items => items.map(li => li.className));
  assert.equal(steps.length, 6);
  assert.ok(steps.every(c => c === 'is-ok'));
  assert.deepEqual(problems, []);
  await close();

});
