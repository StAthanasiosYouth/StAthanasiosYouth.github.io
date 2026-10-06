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
import { legacyWorld } from './fakes/legacy.mjs';

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
  // a third, different picture (the same one twice would be reused, not uploaded)
  photos.other = join(tmpdir(), 'athanasios-e2e-other.png');
  writeFileSync(photos.other, await sharp({ create: { width: 900, height: 900, channels: 3, background: '#7a3b1d' } }).png().toBuffer());

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

  const stages = await upload(page, photos.other);
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
    assert.deepEqual(tabs, ['الاجتماعات', 'الأخبار', 'الألعاب', 'المسابقات', 'الفعاليات', 'الإشعارات']);
    await page.click('#subtabs .tab:nth-child(6)');
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


/* ---------------- Phase 2: page sections + the data upgrade ---------------- */

/* a second admin, on a Sheet shaped like the live one before the upgrade */
async function legacyAdmin(viewport = PHONE) {

  const legacy = legacyWorld();
  legacy.properties.set('GITHUB_TOKEN', 'test-token');
  legacy.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  legacy.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');
  const legacyServer = createAdminServer({ world: legacy, admin: ADMIN, latency: 20 });
  await new Promise(resolve => legacyServer.listen(4395, '127.0.0.1', resolve));

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  await page.setViewport(viewport);
  await page.goto('http://localhost:4395/', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.A && A.state);

  return {
    legacy, page, problems,
    close: async () => { await context.close(); await new Promise(resolve => legacyServer.close(resolve)); }
  };

}

const clickText = (page, scope, text) => page.evaluate((s, t) => {
  const button = [...document.querySelectorAll(`${s} button`)].find(b => b.textContent.trim() === t || b.textContent.includes(t));
  if (!button) throw new Error('no button: ' + t);
  button.click();
}, scope, text);

test('upgrade: notice on home, plan, confirm with our modal, done — data intact', async () => {

  const { legacy, page, problems, close } = await legacyAdmin();
  try {
  const linksBefore = legacy.gs.readTable_('Links').map(l => l.id);

  // home tells the admin about it
  await page.waitForSelector('.card--notice');
  await clickText(page, '.card--notice', 'روح للترقية');
  await page.waitForFunction(() => document.getElementById('page-title').textContent === 'الإعدادات');

  // plan: read-only list of steps
  await clickText(page, '.view', 'شوف هيتعمل إيه');
  await page.waitForSelector('.upgrade .checklist__steps li');
  const steps = await page.$$eval('.upgrade .checklist__steps li', items => items.map(li => li.className + ' ' + li.querySelector('strong').textContent));
  assert.equal(steps.length, 4);
  assert.ok(steps.every(s => s.startsWith('is-todo')), steps.join(' | '));
  assert.equal(legacy.properties.get('DATA_SCHEMA'), undefined, 'planning changed nothing');

  // run, through our confirm modal
  await clickText(page, '.view', 'نفّذ الترقية');
  await page.waitForSelector('dialog.modal[open]');
  await clickText(page, 'dialog.modal[open]', 'نفّذ');
  await page.waitForFunction(() => document.querySelector('dialog.modal--success[open]'));
  const message = await page.$eval('dialog.modal--success .modal__text', n => n.textContent);
  assert.match(message, /نسخة احتياطية/);

  assert.equal(legacy.properties.get('DATA_SCHEMA'), '3');
  const linksAfter = legacy.gs.readTable_('Links').map(l => l.id);
  assert.deepEqual(linksAfter.slice(0, linksBefore.length), linksBefore, 'every link still there, same order');
  assert.ok(linksAfter.includes('whatsapp-group'));
  assert.ok(legacy.spreadsheet.getSheets().some(s => s.name.startsWith('_backup_')), 'backups made');

  assert.deepEqual(problems, []);
  }
  finally {
    await close();
  }

});

test('ترتيب الصفحة: every section, what visitors see now, hide and show', async () => {

  const { page, problems, close } = await open(DESKTOP);
  await page.evaluate(() => { A.go('page', 'layout'); });
  await page.waitForSelector('.layout-list .item');

  const titles = await page.$$eval('.layout-list .item__title', t => t.map(x => x.textContent));
  assert.equal(titles.length, 12);
  assert.equal(titles[0], 'ركن الاجتماع');
  const showing = await page.$$eval('.now-showing__item', t => t.map(x => x.textContent));
  assert.ok(showing.includes('تابعنا'), showing.join(' | '));
  assert.ok(!showing.includes('المسابقات'), 'an empty section is not "showing"');

  // hide "تابعنا"
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('.layout-list .item')].find(i => i.querySelector('.item__title').textContent === 'تابعنا');
    item.querySelector('.switch input').click();
  });
  await page.waitForFunction(() => ![...document.querySelectorAll('.now-showing__item')].some(x => x.textContent === 'تابعنا'));
  assert.equal(world.gs.readTable_('Sections').find(s => s.key === 'social').enabled, false);
  world.gs.apiSetSectionEnabled('social', true);

  assert.deepEqual(problems, []);
  await close();

});

test('ركن الاجتماع: one switch hides the whole meeting block, topics included', async () => {

  const { page, problems, close } = await open();
  await page.evaluate(() => { A.go('content', 'meetings'); });
  await page.waitForSelector('.card--switch .switch input');
  assert.equal(await page.$eval('.card--switch .switch input', i => i.checked), true);

  await page.click('.card--switch .switch');
  await page.waitForSelector('.card--switch.is-off');
  const built = JSON.parse(JSON.stringify(world.gs.buildPublicContent(world.gs.readDraft_(), { now: '2026-10-08T12:00' })));
  assert.equal(built.content.meeting, null);
  assert.deepEqual(built.content.sessions, [], 'the topic of 2026-10-11 is not published either');

  await page.click('.card--switch .switch');
  await page.waitForSelector('.card--switch:not(.is-off)');

  assert.deepEqual(problems, []);
  await close();

});

test('a section can be scheduled (Cairo time) from its editor', async () => {

  const { page, problems, close } = await open(DESKTOP);
  await page.evaluate(() => { A.go('page', 'layout'); });
  await page.waitForSelector('[aria-label="تعديل تحديات وألعاب"]');
  await page.click('[aria-label="تعديل تحديات وألعاب"]');
  await page.waitForSelector('dialog.sheet[open] input[type=date]');
  await page.evaluate(() => {
    const [from] = document.querySelectorAll('dialog.sheet[open] .datetime');
    const date = from.querySelector('input[type=date]');
    const time = from.querySelector('input[type=time]');
    date.value = '2099-01-01'; date.dispatchEvent(new Event('input'));
    time.value = '18:00'; time.dispatchEvent(new Event('input'));
    document.querySelector('dialog.sheet[open] .sheet__foot .btn--primary').click();
  });
  await page.waitForFunction(() => !document.querySelector('dialog.sheet').open);
  const games = world.gs.readTable_('Sections').find(s => s.key === 'games');
  assert.equal(games.visibleFrom, '2099-01-01 18:00');
  const chip = await page.evaluate(() => [...document.querySelectorAll('.layout-list .item')].find(i => i.querySelector('.item__title').textContent === 'تحديات وألعاب').querySelector('.chip--state').dataset.state);
  assert.equal(chip, 'scheduled');
  world.gs.apiSaveSection({ key: 'games', title: 'تحديات وألعاب', visibleFrom: '', visibleUntil: '' });

  assert.deepEqual(problems, []);
  await close();

});


/* ---------------- Phase 4: the media library ---------------- */

test('library: tiles from tiny thumbnails, details with usage, a used image is protected', async () => {

  const { page, problems, close } = await open(DESKTOP);
  await page.evaluate(() => { A.go('media'); });
  await page.waitForSelector('.media-grid .media-tile');
  const tiles = await page.$$eval('.media-grid .media-tile', t => t.length);
  assert.ok(tiles >= 2, `${tiles} tiles`);

  // the photo uploaded by the first test is used by the 2026-10-11 meeting
  const used = await page.evaluate(() => {
    const tile = [...document.querySelectorAll('.media-tile')].find(t => t.querySelector('.media-tile__badge'));
    tile.click();
    return tile.getAttribute('aria-label');
  });
  assert.match(used, /مستخدمة/);
  await page.waitForSelector('dialog.sheet[open] .usage-list li');
  assert.match(await page.$eval('dialog.sheet[open] .usage-list', n => n.textContent), /اجتماع 2026-10-11/);

  await page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .actions button')].find(b => b.textContent.includes('شيلها')).click());
  await page.waitForSelector('dialog.modal--warn[open]');
  assert.match(await page.$eval('dialog.modal--warn .modal__text', n => n.textContent), /اجتماع 2026-10-11/);
  await page.evaluate(() => document.querySelector('dialog.modal--warn button').click());
  assert.ok(world.gs.readTable_('Media').every(m => !m.deletedAt), 'nothing removed');

  assert.deepEqual(problems, []);
  await close();

});

test('any editor can choose an existing image «من المكتبة»', async () => {

  const { page, problems, close } = await open();
  await page.evaluate(() => { A.go('content', 'news'); });
  await page.evaluate(() => A.editors.news(null));
  await page.waitForSelector('dialog.sheet[open] .picker');
  await page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .picker button')].find(b => b.textContent.includes('من المكتبة')).click());
  await page.waitForSelector('dialog.picker-dialog[open] .media-tile');
  const chosen = await page.evaluate(() => {
    const tile = document.querySelector('dialog.picker-dialog[open] .media-tile');
    tile.click();
    return tile.getAttribute('aria-label');
  });
  await page.waitForFunction(() => !document.querySelector('dialog.picker-dialog'));
  await page.waitForSelector('dialog.sheet[open] .picker__img');

  await page.type('dialog.sheet[open] input', 'خبر بصورة من المكتبة');
  await page.evaluate(() => document.querySelector('dialog.sheet[open] .sheet__foot .btn--primary').click());
  await page.waitForFunction(() => !document.querySelector('dialog.sheet').open);
  const news = world.gs.readTable_('News').find(n => n.title === 'خبر بصورة من المكتبة');
  assert.match(news.image, /^img-[0-9a-f]{8}$/, chosen);

  assert.deepEqual(problems, []);
  await close();

});

test('a section gets a colour and a banner from its editor', async () => {

  const { page, problems, close } = await open(DESKTOP);
  await page.evaluate(() => { A.go('page', 'layout'); });
  await page.waitForSelector('[aria-label="تعديل جديد الأسرة"]');
  await page.click('[aria-label="تعديل جديد الأسرة"]');
  await page.waitForSelector('dialog.sheet[open] .swatches');
  await page.evaluate(() => document.querySelector('dialog.sheet[open] .swatch--emerald input').click());
  await page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .picker button')].find(b => b.textContent.includes('من المكتبة')).click());
  await page.waitForSelector('dialog.picker-dialog[open] .media-tile');
  await page.evaluate(() => document.querySelector('dialog.picker-dialog[open] .media-tile').click());
  await page.waitForFunction(() => !document.querySelector('dialog.picker-dialog'));
  await page.evaluate(() => document.querySelector('dialog.sheet[open] .sheet__foot .btn--primary').click());
  await page.waitForFunction(() => !document.querySelector('dialog.sheet').open);

  const news = world.gs.readTable_('Sections').find(s => s.key === 'news');
  assert.equal(news.theme, 'emerald');
  assert.match(news.banner, /^img-/);
  world.gs.apiSaveSection({ key: 'news', title: 'جديد الأسرة', theme: '', banner: '' });

  assert.deepEqual(problems, []);
  await close();

});


/* ---------------- Phase 5: competitions, activities, archive ---------------- */

test('a competition from the admin: type preset, dates in Cairo time, a notification', async () => {

  const { page, problems, close } = await open();
  await page.evaluate(() => { A.go('content', 'competitions'); });
  await page.waitForSelector('#subtabs .tab[aria-current="page"]');
  assert.equal(await page.$eval('#page-title', n => n.textContent), 'المسابقات');
  await page.evaluate(() => [...document.querySelectorAll('.view button')].find(b => b.textContent.includes('مسابقة جديدة')).click());
  await page.waitForSelector('dialog.sheet[open] input');

  await page.evaluate(() => {
    const sheet = document.querySelector('dialog.sheet[open]');
    const set = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
    set(sheet.querySelector('.field[data-label="العنوان"] input'), 'مسابقة الكتاب المقدس');
    set(sheet.querySelector('input[type=url]'), 'https://forms.gle/bible');
    const [start, end] = sheet.querySelectorAll('.datetime');
    set(start.querySelector('input[type=date]'), '2099-10-09'); set(start.querySelector('input[type=time]'), '18:00');
    set(end.querySelector('input[type=date]'), '2099-10-16'); set(end.querySelector('input[type=time]'), '23:00');
    sheet.querySelector('.sheet__foot .btn--primary').click();
  });
  await page.waitForFunction(() => !document.querySelector('dialog.sheet').open);

  const row = world.gs.readTable_('Activities').find(a => a.title === 'مسابقة الكتاب المقدس');
  assert.equal(row.type, 'competition');
  assert.deepEqual([row.startAt, row.endAt], ['2099-10-09 18:00', '2099-10-16 23:00']);
  assert.ok(world.gs.readTable_('Notifications').some(n => n.id === 'notif-' + row.id), 'publish notification');
  assert.ok(world.gs.readTable_('Notifications').some(n => n.id === 'notif-' + row.id + '-start'), 'start notification');
  assert.match(await page.$eval('.list .item__title', n => n.textContent), /مسابقة الكتاب المقدس/);

  assert.deepEqual(problems, []);
  await close();

});

test('archive and «استخدم تاني»: old items leave the list, come back, or become a hidden copy', async () => {

  world.gs.apiSaveItem('activities', { type: 'trip', title: 'رحلة السنة اللي فاتت', url: 'https://forms.gle/old' });
  const { page, problems, close } = await open(DESKTOP);
  await page.evaluate(() => { A.go('content', 'activities'); });
  await page.waitForSelector('[aria-label="أرشفة: رحلة السنة اللي فاتت"]');

  await page.click('[aria-label="أرشفة: رحلة السنة اللي فاتت"]');
  await page.waitForFunction(() => !document.querySelector('[aria-label="أرشفة: رحلة السنة اللي فاتت"]'));
  assert.equal(world.gs.readTable_('Activities').find(a => a.title === 'رحلة السنة اللي فاتت').archived, true);

  // the archive view
  await page.evaluate(() => [...document.querySelectorAll('.view button')].find(b => b.textContent.startsWith('الأرشيف')).click());
  await page.waitForSelector('[aria-label="استخدم تاني: رحلة السنة اللي فاتت"]');
  await page.click('[aria-label="استخدم تاني: رحلة السنة اللي فاتت"]');
  // the copy opens straight in its editor
  await page.waitForSelector('dialog.sheet[open]');
  assert.match(await page.$eval('#sheet-title', n => n.textContent), /\(نسخة\)/);
  const copy = world.gs.readTable_('Activities').find(a => a.title === 'رحلة السنة اللي فاتت (نسخة)');
  assert.equal(copy.enabled, false);

  assert.deepEqual(problems, []);
  await close();

});

test('a new activity type, from the admin, without code', async () => {

  const { page, problems, close } = await open(DESKTOP);
  await page.evaluate(() => { A.go('content', 'activities'); });
  await page.evaluate(() => [...document.querySelectorAll('.view button')].find(b => b.textContent.includes('نوع جديد')).click());
  await page.waitForSelector('dialog.sheet[open] .icon-grid');
  await page.evaluate(() => {
    const sheet = document.querySelector('dialog.sheet[open]');
    const set = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
    set(sheet.querySelector('.field[data-label="مفتاح النوع"] input'), 'bazaar');
    set(sheet.querySelector('.field[data-label="اسم النوع"] input'), 'بازار');
    sheet.querySelector('.icon-grid input[value="gift"]').click();
    sheet.querySelector('.swatch--rose input').click();
    sheet.querySelector('.sheet__foot .btn--primary').click();
  });
  await page.waitForFunction(() => !document.querySelector('dialog.sheet').open);
  const type = world.gs.readTable_('Types').find(t => t.key === 'bazaar');
  assert.deepEqual([type.label, type.section, type.icon, type.theme], ['بازار', 'activities', 'gift', 'rose']);

  assert.deepEqual(problems, []);
  await close();

});

test('home: the site state, the next meeting, quick actions, the bell; fits a phone', async () => {

  const { page, problems, close } = await open();
  await page.evaluate(() => A.go('home'));
  await page.waitForSelector('.dash .dash-site');

  // a saved change waits for publishing: said plainly, one tap to review
  world.gs.apiPublish(JSON.parse(JSON.stringify(world.gs.apiReview())).revision);
  world.gs.apiSaveItem('news', { title: 'خبر للوحة الرئيسية', publishAt: '2099-01-01 10:00' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.dash .dash-site');
  assert.equal(await page.$eval('.dash-site h2', n => n.textContent), 'في تغييرات مستنية النشر');

  // the next meeting: its date, and its topic or a button to add one
  const meeting = await page.evaluate(() => {
    const next = A.nextMeeting();
    return {
      date: next.date,
      topic: next.session ? next.session.topic : '',
      shown: document.querySelector('.dash-meeting__topic').textContent,
      when: document.querySelector('.dash-meeting__when strong').textContent
    };
  });
  assert.match(meeting.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(meeting.shown, meeting.topic ? `«${meeting.topic}»` : 'لسه مفيش موضوع للاجتماع ده');
  assert.match(meeting.when, /[٠-٩]/, 'Arabic digits, Cairo time');

  await page.evaluate(() => document.querySelector('.dash-card .actions .btn').click());
  await page.waitForSelector('dialog.sheet[open]');
  const editing = await page.evaluate(() => document.querySelector('dialog.sheet[open] input[type=date]').value);
  assert.equal(editing, meeting.date, 'the editor opens on that meeting');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet').open);

  // quick actions open the right editors
  await page.evaluate(() => [...document.querySelectorAll('.quick')].find(b => b.textContent.includes('مسابقة')).click());
  await page.waitForSelector('dialog.sheet[open] input');
  assert.match(await page.$eval('dialog.sheet[open] .sheet__title', n => n.textContent), /مسابقة/);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet').open);

  // the bell card counts what visitors see in the bell now
  assert.match(await page.$eval('#dash-bell-title', n => n.closest('.dash-card').querySelector('.chip').textContent), /[٠-٩]+ إشعار/);

  // nothing wider than the phone
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');

  assert.deepEqual(problems, []);
  await close();

});

test('review: changes grouped in plain words, scheduled ones say when', async () => {

  const { page, problems, close } = await open(DESKTOP);
  await page.evaluate(() => A.go('home'));
  await page.waitForSelector('.dash-site .btn--primary');
  await page.click('.dash-site .btn--primary');
  await page.waitForSelector('dialog.sheet[open] .review-groups');

  const groups = await page.evaluate(() => [...document.querySelectorAll('.review-group')].map(g => ({
    title: g.querySelector('.review-group__title').textContent,
    items: [...g.querySelectorAll('li')].map(li => ({ tone: li.className, text: li.querySelector('.change__text > span').textContent, when: li.querySelector('.change__when')?.textContent || '' }))
  })));
  const news = groups.find(g => g.title === 'الأخبار');
  assert.ok(news, groups.map(g => g.title).join(' | '));
  const line = news.items.find(i => i.text === 'خبر جديد: خبر للوحة الرئيسية');
  assert.deepEqual(line, { tone: 'is-add', text: 'خبر جديد: خبر للوحة الرئيسية', when: 'يظهر الخميس ١ يناير، ١٠:٠٠ ص' });

  // publish from here: the stepper moves on
  await page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await page.waitForFunction(() => document.querySelector('dialog.sheet[open] .stepper .is-done'));
  assert.ok(JSON.parse(world.github.files()['content.json']).news.some(n => n.title === 'خبر للوحة الرئيسية'));

  assert.deepEqual(problems, []);
  await close();

});

/* the live site's files, served from this checkout (no network in tests) */
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', webp: 'image/webp', png: 'image/png', svg: 'image/svg+xml', woff2: 'font/woff2', ico: 'image/x-icon', ics: 'text/calendar' };

async function serveSiteLocally(page) {
  const { readFileSync, existsSync: exists } = await import('node:fs');
  const site = 'https://stathanasiosyouth.github.io/';
  const sent = [];
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (url.startsWith(site)) {
      const path = decodeURIComponent(new URL(url).pathname.slice(1)) || 'index.html';
      sent.push(path);
      const file = `${ROOT}${path}`;
      if (!exists(file)) return request.respond({ status: 404, body: '' });
      return request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: TYPES[path.split('.').pop()] || 'application/octet-stream', body: readFileSync(file) });
    }
    if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return request.continue();
    return request.respond({ status: 204, body: '' });
  });
  return sent;
}

test('preview: the draft on the real page, phone/computer, time travel; nothing cached or sent', async () => {

  const pad = n => String(n).padStart(2, '0');
  const cairoDay = days => { const d = new Date(Date.now() + 3 * 3600e3 + days * 86400e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

  const poster = await sharp({ create: { width: 600, height: 750, channels: 3, background: '#2a6f4e' } }).webp().toBuffer();
  const thumb = await sharp(poster).resize(480).webp().toBuffer();
  const { media } = JSON.parse(JSON.stringify(world.gs.apiUploadMedia({
    full: poster.toString('base64'), thumb: thumb.toString('base64'), mime: 'image/webp', width: 600, height: 750, alt: 'بوستر المعاينة', name: 'معاينة'
  })));
  world.gs.apiSaveItem('news', { title: 'خبر المعاينة', image: media.id, publishAt: '2020-01-01 00:00' });
  world.gs.apiSaveItem('news', { title: 'خبر بكره الصبح', publishAt: `${cairoDay(1)} 09:00` });
  const githubCalls = world.github.requests.length;

  const { page, problems, close } = await open(DESKTOP);
  const sent = await serveSiteLocally(page);
  await page.evaluate(() => A.go('home'));
  await page.waitForSelector('.dash-site');
  await page.evaluate(() => [...document.querySelectorAll('.dash-site .btn')].find(b => b.textContent.includes('معاينة')).click());
  await page.waitForSelector('.preview-status--ok', { timeout: 20000 });

  const frame = page.frames().find(f => f.url() === 'about:srcdoc');
  assert.ok(frame, 'the preview runs in the admin\'s own frame');
  await frame.waitForSelector('#main[data-state="ready"]');
  const shown = await frame.evaluate(() => ({
    preview: document.documentElement.hasAttribute('data-preview'),
    text: document.body.innerText,
    poster: [...document.querySelectorAll('.news-lead img, .news-card img')].map(i => i.currentSrc).find(s => s.startsWith('blob:')) || '',
    cached: localStorage.getItem('athanasios.content.v1')
  }));
  assert.equal(shown.preview, true);
  assert.ok(shown.text.includes('خبر المعاينة'), 'the draft is on the page');
  assert.ok(!shown.text.includes('خبر بكره الصبح'), 'not before its time');
  assert.match(shown.poster, /^blob:/, 'an image not on the site yet comes from our own preview');
  assert.equal(shown.cached, null, 'the draft is never cached as site content');
  assert.ok(sent.includes('assets/js/main.js') && sent.includes('assets/css/main.css'), 'the site\'s own files');
  assert.ok(!sent.includes('content.json'), 'the published content is not fetched');

  // time travel: tomorrow morning shows tomorrow's news
  await page.evaluate(() => [...document.querySelectorAll('.segment')].find(b => b.textContent.includes('بكره')).click());
  await page.waitForFunction(() => document.querySelector('.preview-status--ok')?.textContent.includes('زي ما هيبان'), { timeout: 20000 });
  await frame.waitForFunction(() => document.body.innerText.includes('خبر بكره الصبح'), { timeout: 10000 });

  // phone width
  await page.evaluate(() => [...document.querySelectorAll('.segment')].find(b => b.textContent.includes('موبايل')).click());
  assert.equal(await page.$eval('.preview-frame', f => f.style.width), '390px');
  assert.equal(await frame.evaluate(() => innerWidth), 390);

  assert.equal(world.github.requests.length, githubCalls, 'nothing sent to GitHub');
  assert.deepEqual(Object.keys(world.github.files()).filter(f => f.includes(media.id)), [], 'the draft image stays private');
  assert.deepEqual(problems, []);
  await close();

});
