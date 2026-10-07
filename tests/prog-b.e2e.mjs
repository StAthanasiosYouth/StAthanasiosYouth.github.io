// Agent B (prog) in a real browser: the official admin at /admin/ with a
// stand-in for Google's script and the real .gs code behind doPost (fake
// Apps Script world, owner mode).
//
//  - Android Chrome (Samsung S20 FE) sign-in, never a blank screen: first
//    sign-in, a returning admin (auto-select), a reload mid-verification,
//    a slow server, a failing server, Google never answering; Google's
//    One Tap container can never cover the screen
//  - «استيراد جدول الاجتماعات»: paste → preview → tick the update → apply
//  - «برنامج الاجتماع»: add / reorder / delete stages, a validation error
//    under the field, saved, published as contiguous stages
//  - the live stage: «دي الحالية دلوقتي» writes live.json (fake GitHub),
//    «رجّع للتوقيت التلقائي»
//  - «شكل الخلفية» in the section editor
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/prog-b.e2e.mjs
// Screenshots: tools/.cache/review/prog-b-*.png

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4731;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN_URL = `${SITE}/admin/`;
const ADMIN = 'menazakmena@gmail.com';
const SHOTS = `${ROOT}tools/.cache/review/`;

// Samsung Galaxy S20 FE, Chrome
const S20FE = { width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 };
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-G781B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const DESKTOP = { width: 1280, height: 860 };

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 3500, render: 8000, beat: 900, beatFail: 2500 };

let world;
let server;
let browser;
let claims = { email: ADMIN };
let gisHangs = false;

/* the API with knobs: hold (requests wait until released), fail (the server answers 500) */
const api = { hold: false, held: [], fail: false, delay: 0 };

async function post(body) {
  if (api.fail) throw new Error('the server is down');
  if (api.delay) await sleep(api.delay);
  if (api.hold) return new Promise(resolve => api.held.push(() => resolve(world.post(body))));
  return world.post(body);
}

function release() {
  api.hold = false;
  api.held.splice(0).forEach(go => go());
}

/* Cairo wall time now, "YYYY-MM-DD" and minutes since midnight */
function cairoNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const hhmm = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

function freshWorld() {
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', `${SITE}/`);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.gs.apiSaveSettings({ 'meeting.day': 'الأحد', 'meeting.time': '20:00', 'meeting.durationMinutes': '120' });
  world.gs.apiSaveItem('sessions', { date: '2099-10-11', topic: 'القديم', speaker: 'أبونا', notify: { topic: false } });
  world.gs.apiSaveItem('sessions', { date: '2099-10-25', topic: 'زي ما هو', speaker: 'الخادم', notify: { topic: false } });
  world.as('');
  Object.assign(api, { hold: false, held: [], fail: false, delay: 0 });
  gisHangs = false;
  claims = { email: ADMIN };
}

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  freshWorld();
  server = createSiteServer({
    world: { issueToken: c => world.issueToken(c), get github() { return world.github; } },
    config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK, timing: TIMING }),
    claims: () => claims
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  release();
  await browser?.close();
  await new Promise(resolve => (server ? server.close(resolve) : resolve()));
});


/*
 * One device. A sampler in the page records every moment (every 40 ms)
 * where neither the sign-in screen nor a drawn panel is on screen.
 */
async function device({ viewport = S20FE, ua = ANDROID, silent = false, wait = 'domcontentloaded' } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];

  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(`csp: ${message.text()}`);
  });
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });

  await page.evaluateOnNewDocument(isSilent => {
    if (isSilent) window.__gisSilent = true;
    window.__blank = [];
    const check = () => {
      const gate = document.getElementById('gate');
      const shell = document.getElementById('shell');
      const view = document.getElementById('view');
      if (!gate || !shell) return;
      const panel = document.getElementById('gate-panel');
      const gateOn = !gate.hidden && gate.getBoundingClientRect().height > 200 && panel && panel.innerText.trim().length > 0;
      const shellOn = !shell.hidden && view && view.childElementCount > 0 && view.getBoundingClientRect().height > 0;
      if (!gateOn && !shellOn) window.__blank.push(`${Math.round(performance.now())}ms gate=${gate.hidden ? 'hidden' : gate.dataset.state} shell=${shell.hidden ? 'hidden' : 'shown'}`);
    };
    document.addEventListener('DOMContentLoaded', () => setInterval(check, 40));
  }, silent);

  if (ua) await page.setUserAgent(ua);
  const google = await interceptGoogle(page, { post }, { site: { origin: SITE, local: LOCAL }, gisHangs: () => gisHangs });
  await page.setViewport(viewport);
  await page.goto(ADMIN_URL, { waitUntil: wait });

  return { page, problems, ...google, close: () => context.close() };

}

const gateState = page => page.$eval('#gate', gate => ({ state: gate.dataset.state || '', stage: gate.dataset.stage || '', hidden: gate.hidden, slow: gate.dataset.slow || '', text: document.getElementById('gate-panel').innerText, fallback: !document.getElementById('gate-fallback').hidden }));
const blanks = page => page.evaluate(() => window.__blank.slice(0, 5));

async function signIn(page) {
  await page.waitForSelector('.gate[data-state="signin"] .gis-stub');
  await page.click('.gis-stub');
}

async function inPanel(page) {
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden && document.getElementById('gate').hidden, { timeout: 15000 });
}

async function shot(page, name, wait = 350) {
  await sleep(wait);
  await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}prog-b-${name}.png` });
}

async function verifyingShown(page) {
  await page.waitForFunction(() => /جاري التحقق/.test(document.getElementById('gate-panel').innerText) && document.querySelector('.gate[data-state="loading"]'), { timeout: 8000 });
  const state = await gateState(page);
  assert.equal(state.hidden, false, 'the sign-in screen stays');
  assert.match(state.text, /جاري التحقق\.\.\./);
  assert.match(state.text, new RegExp(ADMIN.replace('.', '\\.')), 'which account');
  assert.equal(await page.$eval('#shell', n => n.hidden), true, 'no panel before it is drawn');
  return state;
}


/* =========================================================
   SIGN-IN ON ANDROID CHROME: never a blank screen
========================================================= */

test('Android: first sign-in — «جاري التحقق...» on the sign-in screen until the panel is drawn', async () => {
  freshWorld();
  const phone = await device();
  api.hold = true;
  await signIn(phone.page);
  const state = await verifyingShown(phone.page);
  assert.equal(state.stage, 'server');
  await shot(phone.page, '01-login-verifying-android');
  release();
  await inPanel(phone.page);
  assert.deepEqual(await blanks(phone.page), []);
  assert.deepEqual(phone.problems, []);
  await phone.close();
});

test('Android: a returning admin (auto-select) is verified on the sign-in screen and lands in the panel', async () => {
  freshWorld();
  api.hold = true;
  const phone = await device({ silent: true });
  await verifyingShown(phone.page);
  assert.equal(await phone.page.evaluate(() => window.__gisOptions.auto_select), true);
  release();
  await inPanel(phone.page);
  assert.ok(await phone.page.$eval('#view', v => v.childElementCount > 0 && v.getBoundingClientRect().height > 0));
  assert.deepEqual(await blanks(phone.page), []);
  assert.deepEqual(phone.problems, []);
  await phone.close();
});

test('Android: a reload in the middle of verifying comes back by itself — no "another device" question, no blank', async () => {
  freshWorld();
  api.hold = true;
  const phone = await device({ silent: true });
  await verifyingShown(phone.page);
  // the phone reloads the tab while the first sessionStart is still on its way
  await phone.page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(300);
  release();               // the old request reaches the server now (a session for the old page load)
  await sleep(200);
  release();               // and the new page's
  await inPanel(phone.page);
  assert.equal(await phone.page.$('.gate[data-state="session-active"]'), null, 'its own reload is never "another device"');
  assert.deepEqual(await blanks(phone.page), []);
  assert.deepEqual(phone.problems, []);
  await phone.close();
});

test('Android: a slow server — "slower than usual" under «جاري التحقق...», then the panel', async () => {
  freshWorld();
  const phone = await device();
  api.delay = 2200;
  await signIn(phone.page);
  await phone.page.waitForSelector('.gate[data-slow="1"]', { timeout: 5000 });
  const slow = await gateState(phone.page);
  assert.match(slow.text, /جاري التحقق/);
  assert.match(slow.text, /بياخد وقت أطول من العادي/);
  await inPanel(phone.page);
  api.delay = 0;
  assert.deepEqual(await blanks(phone.page), []);
  await phone.close();
});

test('Android: a failing server — «جرّب تاني» and the recovery link, then the retry gets in', async () => {
  freshWorld();
  const phone = await device();
  api.fail = true;
  await signIn(phone.page);
  await phone.page.waitForSelector('.gate[data-state="problem"]', { timeout: 6000 });
  const failed = await gateState(phone.page);
  assert.match(failed.text, /جرّب تاني/);
  assert.equal(failed.fallback, true, 'the recovery admin link');
  assert.equal(await phone.page.$eval('#shell', n => n.hidden), true);
  await shot(phone.page, '02-login-retry-android');
  api.fail = false;
  await phone.page.click('.gate__btn');
  await inPanel(phone.page);
  assert.deepEqual(await blanks(phone.page), []);
  await phone.close();
});

test('Android: Google never answers — the silent sign-in leaves the button; a stalled Google script → «جرّب تاني»', async () => {
  freshWorld();
  // the prompt never calls back
  const quiet = await device();
  await quiet.page.waitForSelector('.gate[data-state="signin"] .gis-stub');
  await sleep(TIMING.silent + 400);
  const state = await gateState(quiet.page);
  assert.equal(state.state, 'signin');
  assert.ok(await quiet.page.$eval('.gate__google', n => n.offsetHeight > 20), 'the button is there');
  assert.deepEqual(await blanks(quiet.page), []);
  await quiet.close();

  // Google's script never arrives
  gisHangs = true;
  const stalled = await device();
  await stalled.page.waitForSelector('.gate[data-state="problem"]', { timeout: 6000 });
  const failed = await gateState(stalled.page);
  assert.match(failed.text, /جرّب تاني/);
  assert.equal(failed.fallback, true);
  assert.deepEqual(await blanks(stalled.page), []);
  gisHangs = false;
  await stalled.close();
});

test('Google\'s One Tap container can never cover the screen, whatever size its script sets', async () => {
  freshWorld();
  const phone = await device();
  await phone.page.waitForSelector('.gate[data-state="signin"] .gis-stub');
  const box = await phone.page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'credential_picker_container';
    const frame = document.createElement('iframe');
    frame.id = 'credential_picker_iframe';
    // like Google's script: sizes through the CSSOM (allowed by the CSP)
    container.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh';
    frame.style.width = '100vw';
    frame.style.height = '100vh';
    container.appendChild(frame);
    document.body.appendChild(container);
    const r = frame.getBoundingClientRect();
    return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
  });
  assert.ok(box.h <= 420 && box.h < box.vh * 0.71, JSON.stringify(box));
  assert.ok(box.w <= Math.min(400, box.vw - 24) + 1, JSON.stringify(box));
  await phone.close();
});


/* =========================================================
   THE PANEL: import, program, live stage, «شكل الخلفية»
========================================================= */

async function panel(viewport = DESKTOP) {
  const pc = await device({ viewport, ua: null, wait: 'networkidle0' });
  await signIn(pc.page);
  await inPanel(pc.page);
  return pc;
}

const clickText = (page, scope, text) => page.evaluate((s, t) => {
  const button = [...document.querySelectorAll(`${s} button, ${s} a, ${s} label`)].find(b => b.textContent.includes(t) && !b.disabled);
  if (!button) throw new Error(`no "${t}" in ${s}`);
  button.click();
}, scope, text);

const IMPORT = 'التاريخ\tالموضوع\tالمتكلم\tالوقت\n' +
  '2099-10-11\tالجديد\t\t\n' +
  '١٨/١٠/٢٠٩٩\tموضوع جديد\tأبونا\t٨:٣٠ م\n' +
  '2099-10-25\tزي ما هو\tالخادم\t\n' +
  '2099-13-01\tغلط\t\t\n';

test('import: paste rows → preview (add / update / skip / error) → tick the update → apply → the result', async () => {
  freshWorld();
  const pc = await panel({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const { page } = pc;
  await page.evaluate(() => A.go('content', 'meetings'));
  await clickText(page, '.view', 'استيراد جدول الاجتماعات');
  await page.waitForSelector('dialog.sheet[open] .import__paste');
  await page.evaluate(text => {
    const area = document.querySelector('.import__paste');
    area.value = text;
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }, IMPORT);
  await shot(page, '03-import-paste');

  await clickText(page, 'dialog.sheet[open]', 'معاينة');
  await page.waitForSelector('dialog.sheet[open] .import__list');
  const preview = await page.evaluate(() => [...document.querySelectorAll('.import__row')].map(row => ({
    action: row.className.replace(/.*import__row--(\w+).*/, '$1'),
    ticked: row.querySelector('.import__tick') ? row.querySelector('.import__tick').checked : null,
    text: row.innerText.replace(/\s+/g, ' ')
  })));
  assert.deepEqual(preview.map(r => [r.action, r.ticked]), [['update', false], ['add', true], ['skip', null], ['error', null]]);
  assert.match(preview[0].text, /القديم ← الجديد/);
  assert.match(preview[3].text, /مش مفهوم/);
  await shot(page, '04-import-preview');

  // tick the update, apply
  await page.evaluate(() => { document.querySelector('.import__row--update .import__tick').click(); });
  await clickText(page, 'dialog.sheet[open]', 'استورد اللي متعلّم عليه');
  await page.waitForFunction(() => /الاستيراد خلص/.test(document.querySelector('dialog.sheet[open] .sheet__title')?.textContent || ''));
  const result = await page.$eval('dialog.sheet[open] .sheet__body', n => n.innerText);
  assert.match(result, /اتضاف: ١/);
  assert.match(result, /اتعدل: ١/);
  await shot(page, '05-import-result');

  const sessions = world.gs.readTable_('Sessions').map(s => [s.date, s.topic, s.time]);
  assert.deepEqual(sessions.find(s => s[0] === '2099-10-11'), ['2099-10-11', 'الجديد', '']);
  assert.deepEqual(sessions.find(s => s[0] === '2099-10-18'), ['2099-10-18', 'موضوع جديد', '20:30']);
  assert.deepEqual(pc.problems, []);
  await pc.close();
});

test('program: add, reorder and delete stages; an error shows under the field; saved and published as contiguous stages', async () => {
  freshWorld();
  const pc = await panel({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const { page } = pc;
  await page.evaluate(() => A.go('content', 'meetings').then(() => A.editors.sessions(A.state.draft.sessions.find(s => s.date === '2099-10-11'))));
  await page.waitForSelector('dialog.sheet[open] .program-editor');

  const addStage = async (title, time, minutes) => {
    await clickText(page, 'dialog.sheet[open] .program-editor', 'فقرة');
    await page.evaluate((t, h, m) => {
      const row = [...document.querySelectorAll('.program__row')].at(-1);
      const set = (selector, value) => { const input = row.querySelector(selector); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
      set('.program__title', t);
      if (h) set('.program__time', h);
      if (m) set('.program__minutes', m);
    }, title, time, minutes);
  };
  await addStage('كلمة', '', '45');
  await addStage('تسبحة', '20:00', '30');
  await addStage('حاجة غلط', '', '10');
  await addStage('ختام', '21:40', '');
  // reorder: «تسبحة» first; delete the wrong one
  await page.evaluate(() => document.querySelectorAll('.program__row')[1].querySelector('.program__up').click());
  await page.evaluate(() => document.querySelectorAll('.program__row')[2].querySelector('.program__delete').click());
  const titles = await page.$$eval('.program__title', inputs => inputs.map(i => i.value));
  assert.deepEqual(titles, ['تسبحة', 'كلمة', 'ختام']);
  const spans = await page.$$eval('.program__span', nodes => nodes.map(n => n.textContent));
  assert.equal(spans.length, 3);
  assert.ok(spans.every(s => /←/.test(s)), spans.join(' | '));
  await page.evaluate(() => document.querySelector('.program-editor').scrollIntoView({ block: 'center' }));
  await shot(page, '06-program-editor');

  // an impossible order: the error sits under «برنامج الاجتماع»
  await page.evaluate(() => {
    const input = document.querySelectorAll('.program__time')[2];
    input.value = '19:00';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText(page, 'dialog.sheet[open] .sheet__foot', 'حفظ');
  await page.waitForSelector('.field--invalid[data-label="برنامج الاجتماع"] .field__error');
  const error = await page.$eval('.field--invalid[data-label="برنامج الاجتماع"] .field__error', n => n.textContent);
  assert.match(error, /«ختام»/);
  await shot(page, '07-program-error');

  await page.evaluate(() => {
    const input = document.querySelectorAll('.program__time')[2];
    input.value = '21:40';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText(page, 'dialog.sheet[open] .sheet__foot', 'حفظ');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet[open]'));
  const stored = JSON.parse(world.gs.readTable_('Sessions').find(s => s.date === '2099-10-11').program);
  assert.deepEqual(stored, [{ title: 'تسبحة', time: '20:00', minutes: 30 }, { title: 'كلمة', time: '', minutes: 45 }, { title: 'ختام', time: '21:40', minutes: '' }]);

  // publish (review → publish) and read what the site got
  await page.evaluate(() => A.call('apiReview').then(review => A.call('apiPublish', review.revision)));
  const published = JSON.parse(world.github.files()['content.json']).sessions.find(s => s.date === '2099-10-11').program;
  assert.deepEqual(published, [
    { title: 'تسبحة', start: '2099-10-11T20:00', end: '2099-10-11T20:30' },
    { title: 'كلمة', start: '2099-10-11T20:30', end: '2099-10-11T21:40' },
    { title: 'ختام', start: '2099-10-11T21:40', end: '2099-10-11T22:00' }
  ]);
  assert.equal(world.github.files()['live.json'], undefined, 'publishing never writes live.json');
  assert.deepEqual(pc.problems, []);
  await pc.close();
});

test('live stage: during the meeting, «دي الحالية دلوقتي» writes live.json only; «رجّع للتوقيت التلقائي» goes back', async () => {
  freshWorld();
  const now = cairoNow();
  const start = Math.max(0, now.minutes - 30);
  world.as(ADMIN).gs.apiSaveItem('sessions', {
    date: now.date, time: hhmm(start), durationMinutes: '120', topic: 'اجتماع النهارده',
    program: [{ title: 'تسبحة', minutes: 20 }, { title: 'كلمة', minutes: 60 }, { title: 'ترانيم وختام' }], notify: {}
  });
  world.as('');
  const contentBefore = world.github.files()['content.json'];
  const pc = await panel({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const { page } = pc;
  await page.evaluate(() => A.go('home'));
  await page.waitForSelector('.dash-card .live-control');
  const mode = () => page.$eval('.live-control__mode', n => n.textContent);
  assert.match(await mode(), /تلقائي: كلمة/);
  await page.evaluate(() => document.querySelector('.live-control').scrollIntoView({ block: 'center' }));
  await shot(page, '08-live-automatic');

  // the meeting runs late: the hymns are on now
  await page.evaluate(() => [...document.querySelectorAll('.live-control__row')][2].querySelector('button').click());
  await page.waitForFunction(() => /يدوي: ترانيم وختام/.test(document.querySelector('.live-control__mode').textContent));
  const live = JSON.parse(world.github.files()['live.json']);
  assert.deepEqual([live.schema, live.date, live.stage], [1, now.date, 2]);
  assert.equal(world.github.files()['content.json'], contentBefore, 'content.json untouched');
  assert.equal(world.properties.get('PUBLISHED_REVISION'), undefined, 'nothing published');
  await page.evaluate(() => document.querySelector('.live-control').scrollIntoView({ block: 'center' }));
  await shot(page, '09-live-manual');

  await clickText(page, '.live-control', 'رجّع للتوقيت التلقائي');
  await page.waitForFunction(() => /تلقائي/.test(document.querySelector('.live-control__mode').textContent) && !/يدوي/.test(document.querySelector('.live-control__mode').textContent));
  assert.equal(JSON.parse(world.github.files()['live.json']).stage, null);
  assert.deepEqual(pc.problems, []);
  await pc.close();
});

test('section editor: «شكل الخلفية» and «على الموبايل» save', async () => {
  freshWorld();
  const pc = await panel();
  const { page } = pc;
  await page.evaluate(() => A.go('page', 'layout').then(() => A.editSection(A.state.layout.find(s => s.key === 'news'))));
  await page.waitForSelector('dialog.sheet[open] .field[data-label="شكل الخلفية"]');
  await clickText(page, 'dialog.sheet[open] .field[data-label="شكل الخلفية"]', 'داكن');
  await clickText(page, 'dialog.sheet[open] .field[data-label="على الموبايل"]', 'بدون خلفية');
  await page.evaluate(() => document.querySelector('.field[data-label="شكل الخلفية"]').scrollIntoView({ block: 'center' }));
  await shot(page, '10-section-surface');
  await clickText(page, 'dialog.sheet[open] .sheet__foot', 'حفظ');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet[open]'));
  const row = world.gs.readTable_('Sections').find(s => s.key === 'news');
  assert.deepEqual([row.surface, row.surfaceMobile], ['dark', 'none']);
  const layout = JSON.parse(JSON.stringify(world.gs.buildDraft_().content.layout)).find(s => s.key === 'news');
  assert.deepEqual([layout.surface, layout.surfaceMobile], ['dark', 'none']);
  // reopened, it shows what was saved
  await page.evaluate(() => A.editSection(A.state.layout.find(s => s.key === 'news')));
  await page.waitForSelector('dialog.sheet[open] .field[data-label="شكل الخلفية"]');
  const checked = await page.$$eval('dialog.sheet[open] .field[data-label="شكل الخلفية"] input:checked, dialog.sheet[open] .field[data-label="على الموبايل"] input:checked', inputs => inputs.map(i => i.value));
  assert.deepEqual(checked, ['dark', 'none']);
  assert.deepEqual(pc.problems, []);
  await pc.close();
});
