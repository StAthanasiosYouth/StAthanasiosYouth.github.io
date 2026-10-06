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
    const all = document.querySelectorAll('.toast'); const toast = all[all.length - 1];
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


/* ---------------- Phase 1: the control center ---------------- */

const DESKTOP = { width: 1366, height: 860 };

test('navigation: dock on phones, rail on wide screens, tabs for sub-sections', async () => {

  for (const viewport of [PHONE, DESKTOP]) {
    const { page, problems, close } = await open(viewport);
    const nav = await page.evaluate(() => ({
      dock: getComputedStyle(document.getElementById('dock')).display !== 'none',
      rail: getComputedStyle(document.querySelector('.rail')).display !== 'none'
    }));
    assert.deepEqual(nav, viewport === PHONE ? { dock: true, rail: false } : { dock: false, rail: true });

    const container = viewport === PHONE ? '#dock' : '#rail-nav';
    await page.click(`${container} [data-area="content"]`);
    await page.waitForFunction(() => document.getElementById('page-title').textContent === 'الاجتماعات');
    assert.equal(await page.$eval(`${container} [aria-current="page"]`, b => b.dataset.area), 'content');

    const tabs = await page.$$eval('#subtabs .tab', t => t.map(b => b.textContent));
    assert.deepEqual(tabs, ['الاجتماعات', 'الأخبار', 'الألعاب', 'الإشعارات']);
    await page.click('#subtabs .tab:nth-child(4)');
    await page.waitForFunction(() => document.getElementById('page-title').textContent === 'الإشعارات');

    assert.deepEqual(problems, []);
    await close();
  }

});

test('delete asks with our own modal: cancel keeps it, confirm deletes it', async () => {

  world.gs.apiSaveItem('news', { title: 'خبر للمسح', summary: 'x' });
  const { page, problems, close } = await open();
  await page.evaluate(() => A.go('content', 'news'));
  await page.waitForSelector('[aria-label="مسح خبر للمسح"]');

  await page.click('[aria-label="مسح خبر للمسح"]');
  await page.waitForSelector('dialog.modal[open]');
  const modal = await page.$eval('dialog.modal[open]', d => ({
    title: d.querySelector('.modal__title').textContent,
    focused: document.activeElement.textContent,
    text: d.textContent
  }));
  assert.ok(!/null|undefined/.test(modal.text), modal.text);
  assert.match(modal.title, /تمسح «خبر للمسح»/);
  assert.equal(modal.focused, 'لأ، سيبه', 'the safe choice has focus');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.modal'));
  assert.ok(world.gs.readTable_('News').some(n => n.title === 'خبر للمسح'), 'Esc keeps it');

  await page.click('[aria-label="مسح خبر للمسح"]');
  await page.waitForSelector('dialog.modal[open]');
  await page.evaluate(() => [...document.querySelectorAll('dialog.modal[open] button')].find(b => b.textContent === 'امسح').click());
  await page.waitForFunction(() => !document.querySelector('[aria-label="مسح خبر للمسح"]'));
  assert.ok(!world.gs.readTable_('News').some(n => n.title === 'خبر للمسح'), 'confirm deletes it');

  assert.deepEqual(problems, [], 'no native dialogs');
  await close();

});

test('unsaved changes: closing the editor asks first (our modal), and can go back', async () => {

  const { page, problems, close } = await open();
  await page.evaluate(() => A.go('content', 'news'));
  await page.evaluate(() => A.editors.news(null));
  await page.waitForSelector('dialog.sheet[open] input');
  await page.type('dialog.sheet[open] input', 'عنوان جديد');

  await page.click('dialog.sheet[open] .sheet__head .icon-btn');
  await page.waitForSelector('dialog.modal[open]');
  assert.match(await page.$eval('dialog.modal .modal__title', n => n.textContent), /ما اتحفظتش/);
  await page.evaluate(() => [...document.querySelectorAll('dialog.modal[open] button')].find(b => b.textContent === 'ارجع للتعديل').click());
  await page.waitForFunction(() => !document.querySelector('dialog.modal'));
  assert.equal(await page.$eval('dialog.sheet', d => d.open), true, 'still editing');
  assert.equal(await page.$eval('dialog.sheet[open] input', i => i.value), 'عنوان جديد');

  // leaving through the navigation asks too
  await page.evaluate(() => { A.go('settings'); });
  await page.waitForSelector('dialog.modal[open]');
  await page.evaluate(() => [...document.querySelectorAll('dialog.modal[open] button')].find(b => b.textContent === 'سيبها من غير حفظ').click());
  await page.waitForFunction(() => document.getElementById('page-title').textContent === 'الإعدادات');

  assert.deepEqual(problems, []);
  await close();

});

test('validation errors appear under the field they belong to', async () => {

  const { page, problems, close } = await open(DESKTOP);
  await page.evaluate(() => A.go('content', 'games'));
  await page.evaluate(() => A.editors.games(null));
  await page.waitForSelector('dialog.sheet[open] .sheet__foot .btn--primary');
  await page.evaluate(() => document.querySelector('dialog.sheet[open] .sheet__foot .btn--primary').click());
  await page.waitForSelector('dialog.sheet[open] .field--invalid');

  const invalid = await page.$$eval('dialog.sheet[open] .field--invalid', fields => fields.map(f => ({
    label: f.dataset.label,
    error: f.querySelector('.field__error').textContent,
    aria: !!f.querySelector('[aria-invalid="true"]')
  })));
  assert.ok(invalid.some(f => f.label === 'اسم اللعبة' && /مطلوب/.test(f.error)), JSON.stringify(invalid));
  assert.ok(invalid.every(f => f.aria), 'inputs are marked aria-invalid');

  // typing in the field clears its error
  await page.type('dialog.sheet[open] .field--invalid input', 'لعبة');
  assert.equal(await page.$$eval('dialog.sheet[open] .field--invalid', f => f.filter(x => x.dataset.label === 'اسم اللعبة').length), 0);

  assert.deepEqual(problems, []);
  await close();

});

test('every list shows the same visibility words', async () => {

  world.gs.apiSaveItem('news', { title: 'لاحقًا', summary: 'x', publishAt: '2099-01-01 10:00' });
  world.gs.apiSaveItem('news', { title: 'خلص', summary: 'x', publishAt: '2020-01-01 10:00', expireAt: '2020-01-02' });
  const { page, problems, close } = await open();
  await page.evaluate(() => A.go('content', 'news'));
  await page.waitForSelector('.chip--state');
  const states = await page.$$eval('.chip--state', chips => chips.map(c => c.dataset.state + ':' + c.textContent.split(' · ')[0]));
  assert.ok(states.includes('scheduled:يظهر لاحقًا'), states.join(' | '));
  assert.ok(states.includes('ended:انتهى'), states.join(' | '));
  assert.deepEqual(problems, []);
  await close();

});
