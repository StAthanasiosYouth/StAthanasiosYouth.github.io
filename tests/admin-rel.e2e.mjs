// Admin reliability / collaboration in a real browser: the official admin
// at /admin/ (static) signing in with a stand-in for Google's script and
// talking to the real .gs code through doPost, in a fake Apps Script world
// that runs as the owner. Each browser context is one device.
//
//  - one live session per Google account: the second device is asked, takes
//    over, and the first tab goes back to the gate with the reason
//  - who else is online, and what they edit
//  - edit locks: read-only editor with who/since, refused save, another
//    item free, the lock runs out when its holder's heartbeat stops
//  - the sign-in never hangs: Google's script stalls, the silent sign-in
//    never answers, the API hangs ("slower than usual" → «جرّب تاني»),
//    a reload mid-session
//  - no horizontal overflow at 360 and 390 px, every area
//
// Short timings for the test: config.timing (boot.js) and the world's TTLs.
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/admin-rel.e2e.mjs
// Screenshots: tools/.cache/review/admin-rel-*.png

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4601;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN_URL = `${SITE}/admin/`;
const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'second.admin@gmail.com';
const SHOTS = `${ROOT}tools/.cache/review/`;

const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const SMALL = { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1440, height: 900 };
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* the page's stages, short (real pages: boot.js defaults) */
const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 3500, render: 8000, beat: 900, beatFail: 2500 };

let world;
let server;
let browser;
let claims;
let gisHangs = false;

/*
 * The API, with knobs: hold = every request waits until released (a cold,
 * hanging server); mute = requests of that account never come back (its
 * phone lost the network: its heartbeat stops).
 */
const api = { hold: false, held: [], mute: '' };

function post(body) {
  let email = '';
  try { email = world.idTokens.get(JSON.parse(body).token)?.email || ''; }
  catch { email = ''; }
  if (api.mute && email === api.mute) return new Promise(() => {});
  if (api.hold) return new Promise(resolve => api.held.push(() => resolve(world.post(body))));
  return world.post(body);
}

function release() {
  api.hold = false;
  const held = api.held.splice(0);
  held.forEach(go => go());
}

function freshWorld() {
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', `${SITE}/`);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  world.gs.apiSaveItem('sessions', { date: '2026-10-11', topic: 'الكسل الروحي', notify: { topic: false } });
  world.gs.apiSaveItem('news', { id: 'news-aaaa1111', title: 'رحلة الغردقة', summary: 'سجّل اسمك' });
  world.gs.apiSaveItem('news', { id: 'news-bbbb2222', title: 'مسابقة الكتاب المقدس', summary: 'كل أسبوع' });
  // short lives, so the test can watch them run out
  world.gs.SESSION_STALE_SECONDS = 4;
  world.gs.PRESENCE_ONLINE_SECONDS = 4;
  world.gs.LOCK_SECONDS = 3;
  world.as('');
  api.hold = false;
  api.held = [];
  api.mute = '';
  gisHangs = false;
}

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  freshWorld();
  claims = { email: ADMIN };
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


/* one device: its own browser context */
async function device({ viewport = DESKTOP, ua = null, wait = 'networkidle0' } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];

  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(`csp: ${message.text()}`);
  });
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });

  if (ua) await page.setUserAgent(ua);
  const google = await interceptGoogle(page, { post }, { site: { origin: SITE, local: LOCAL }, gisHangs: () => gisHangs });
  await page.setViewport(viewport);
  await page.goto(ADMIN_URL, { waitUntil: wait });

  return { page, problems, ...google, close: () => context.close() };

}

const gateState = page => page.$eval('#gate', gate => ({ state: gate.dataset.state || '', stage: gate.dataset.stage || '', hidden: gate.hidden, text: document.getElementById('gate-panel').innerText }));

async function signIn(page, email) {

  claims = { email };
  await page.waitForSelector('.gate[data-state="signin"] .gis-stub');
  await page.click('.gis-stub');

}

async function inPanel(page) {

  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden && document.getElementById('gate').hidden, { timeout: 15000 });

}

async function openNews(page, id) {

  await page.evaluate(newsId => A.go('content', 'news').then(() => A.editors.news(A.state.draft.news.find(n => n.id === newsId))), id);
  await page.waitForSelector('dialog.sheet[open] .sheet__foot .btn--primary');

}

async function shot(page, name) {

  await sleep(350);
  await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}admin-rel-${name}.png` });

}


/* ---------------- one session per account ---------------- */

test('one session per account: the second device is asked, takes over, the first tab goes back to the gate', async () => {

  freshWorld();
  const laptop = await device({ viewport: DESKTOP });
  await signIn(laptop.page, ADMIN);
  await inPanel(laptop.page);

  // the phone, same account, while the laptop is live
  const phone = await device({ viewport: PHONE, ua: ANDROID });
  await signIn(phone.page, ADMIN);
  await phone.page.waitForSelector('.gate[data-state="session-active"]');
  const asked = await gateState(phone.page);
  assert.match(asked.text, /الحساب ده شغال دلوقتي على جهاز تاني/);
  assert.match(asked.text, /كمبيوتر ويندوز – Chrome|كمبيوتر .* – Chrome/, 'which device');
  assert.match(asked.text, /إنهاء الجلسة الأخرى والدخول هنا/);
  assert.match(asked.text, /إلغاء/);
  assert.equal(await phone.page.$eval('#shell', s => s.hidden), true, 'not in yet');
  await shot(phone.page, '01-session-active-phone');

  // the laptop is untouched so far
  await sleep(1500);
  assert.equal((await gateState(laptop.page)).hidden, true);

  // «إلغاء»: nothing changes for the laptop
  await phone.page.evaluate(() => [...document.querySelectorAll('.gate__btn')].find(b => b.textContent === 'إلغاء').click());
  await phone.page.waitForSelector('.gate[data-state="signin"] .gis-stub');
  await sleep(1200);
  assert.equal((await gateState(laptop.page)).hidden, true, 'cancel: the other device keeps working');

  // again, and take over
  await phone.page.click('.gis-stub');
  await phone.page.waitForSelector('.gate[data-state="session-active"]');
  await phone.page.evaluate(() => [...document.querySelectorAll('.gate__btn')].find(b => /إنهاء الجلسة الأخرى/.test(b.textContent)).click());
  await inPanel(phone.page);

  // the laptop's next heartbeat finds out: back at the gate, with the reason
  await laptop.page.waitForSelector('.gate[data-state="revoked"]', { timeout: 8000 });
  const revoked = await gateState(laptop.page);
  assert.equal(revoked.hidden, false);
  assert.match(revoked.text, /الجلسة اتقفلت لأنك دخلت من جهاز تاني/);
  assert.equal(await laptop.page.$eval('#shell', s => s.hidden), true, 'the panel is closed');
  await shot(laptop.page, '03-revoked-desktop');

  // its old session can't do anything any more (the server refuses, not just the page)
  const oldTry = world.post({ fn: 'apiState', args: [], token: world.issueToken({ email: ADMIN }), sid: '00000000-0000-4000-8000-000000000000' });
  assert.equal(oldTry.code, 'session_replaced');

  // the laptop asks to come back: it is asked too (desktop screenshot), and can take over again
  await laptop.page.evaluate(() => [...document.querySelectorAll('.gate__btn')].find(b => /ادخل من هنا تاني/.test(b.textContent)).click());
  await laptop.page.waitForSelector('.gate[data-state="session-active"]');
  assert.match((await gateState(laptop.page)).text, /موبايل أندرويد – Chrome/);
  await shot(laptop.page, '02-session-active-desktop');
  await laptop.page.evaluate(() => [...document.querySelectorAll('.gate__btn')].find(b => /إنهاء الجلسة الأخرى/.test(b.textContent)).click());
  await inPanel(laptop.page);
  await phone.page.waitForSelector('.gate[data-state="revoked"]', { timeout: 8000 });

  assert.deepEqual(laptop.problems, []);
  assert.deepEqual(phone.problems, []);
  await laptop.close();
  await phone.close();

});


/* ---------------- presence and edit locks ---------------- */

test('presence and edit locks: who is where, a read-only editor for a locked item, another item free, the lock runs out', async () => {

  freshWorld();
  const a = await device({ viewport: DESKTOP });
  await signIn(a.page, ADMIN);
  await inPanel(a.page);
  const b = await device({ viewport: DESKTOP });
  await signIn(b.page, SECOND);
  await inPanel(b.page);

  // A edits «رحلة الغردقة»
  await openNews(a.page, 'news-aaaa1111');

  // B sees A in the strip: name, online, what A edits
  await b.page.waitForFunction(() => /بيعدّل خبر «رحلة الغردقة»/.test(document.getElementById('presence').innerText), { timeout: 8000 });
  const strip = await b.page.$eval('#presence', node => ({ hidden: node.hidden, text: node.innerText, title: node.querySelector('.presence__item').title }));
  assert.equal(strip.hidden, false);
  assert.match(strip.text, /menazakmena/);
  assert.match(strip.text, /متصل الآن/);
  assert.ok(!strip.text.includes('second.admin'), 'yourself is not "someone else"');
  assert.match(strip.title, new RegExp(ADMIN.replace(/\./g, '\\.')));
  await shot(b.page, '04-presence-strip');

  // A sees B, and where B is
  await b.page.evaluate(() => A.go('page', 'links'));
  await a.page.waitForFunction(() => /second\.admin[\s\S]*في الصفحة ← الروابط/.test(document.getElementById('presence').innerText), { timeout: 8000 });

  // B opens the same news: read-only, who and since when, save off
  await openNews(b.page, 'news-aaaa1111');
  await b.page.waitForSelector('dialog.sheet[open] .lock-banner', { timeout: 8000 });
  const locked = await b.page.evaluate(() => {
    const sheet = document.querySelector('dialog.sheet[open]');
    return {
      banner: sheet.querySelector('.lock-banner').innerText,
      locked: sheet.classList.contains('is-locked'),
      save: sheet.querySelector('.sheet__foot .btn--primary').disabled,
      inputs: [...sheet.querySelectorAll('.sheet__body input, .sheet__body textarea')].every(i => i.disabled)
    };
  });
  assert.match(locked.banner, /menazakmena بيعدّل ده دلوقتي \(من أقل من دقيقة\)/);
  assert.match(locked.banner, /مفتوح للقراءة بس/);
  assert.equal(locked.locked, true);
  assert.equal(locked.save, true, 'save is off');
  assert.equal(locked.inputs, true, 'nothing to type into');
  await shot(b.page, '05-editor-locked-by-someone-else');

  // the server refuses B's save of that item anyway
  const refused = await b.page.evaluate(() => A.call('apiSaveItem', 'news', { id: 'news-aaaa1111', title: 'من B', summary: 'x' }).then(() => 'saved', e => A.parseError(e).message));
  assert.equal(refused, 'menazakmena بيعدّل ده دلوقتي (من أقل من دقيقة).');
  assert.equal(world.gs.readTable_('News').find(n => n.id === 'news-aaaa1111').title, 'رحلة الغردقة');

  // … while another item is free: B edits and saves «مسابقة الكتاب المقدس»
  await b.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
  await openNews(b.page, 'news-bbbb2222');
  await sleep(1500);
  assert.equal(await b.page.$('dialog.sheet[open] .lock-banner'), null, 'no banner on a free item');
  await b.page.evaluate(() => {
    const input = document.querySelector('dialog.sheet[open] .field[data-label="العنوان"] input');
    input.value = 'مسابقة الكتاب المقدس — الأسبوع ده';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('dialog.sheet[open] .sheet__foot .btn--primary').click();
  });
  await b.page.waitForFunction(() => !document.getElementById('sheet').open, { timeout: 8000 });
  assert.equal(world.gs.readTable_('News').find(n => n.id === 'news-bbbb2222').title, 'مسابقة الكتاب المقدس — الأسبوع ده');

  // A's phone loses the network: no more heartbeats. B keeps the editor open.
  await openNews(b.page, 'news-aaaa1111');
  await b.page.waitForSelector('dialog.sheet[open] .lock-banner');
  api.mute = ADMIN;
  // the lock runs out (3 s here, ~90 s for real) and B's next heartbeat takes it
  await b.page.waitForSelector('dialog.sheet[open] .lock-banner--free', { timeout: 12000 });
  assert.match(await b.page.$eval('.lock-banner--free', n => n.innerText), /menazakmena خلّص التعديل/);
  await b.page.click('.lock-banner--free .btn');
  await b.page.waitForFunction(() => {
    const sheet = document.querySelector('dialog.sheet[open]');
    return sheet && !sheet.classList.contains('is-locked') && !sheet.querySelector('.lock-banner') && !sheet.querySelector('.sheet__foot .btn--primary').disabled;
  }, { timeout: 8000 });
  await b.page.evaluate(() => {
    const input = document.querySelector('dialog.sheet[open] .field[data-label="العنوان"] input');
    input.value = 'رحلة الغردقة — اتأكدت';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('dialog.sheet[open] .sheet__foot .btn--primary').click();
  });
  await b.page.waitForFunction(() => !document.getElementById('sheet').open, { timeout: 8000 });
  assert.equal(world.gs.readTable_('News').find(n => n.id === 'news-aaaa1111').title, 'رحلة الغردقة — اتأكدت', 'saved after the lock ran out');

  // and A has dropped off B's strip
  await b.page.waitForFunction(() => document.getElementById('presence').hidden, { timeout: 10000 });

  api.mute = '';
  assert.deepEqual(a.problems, []);
  assert.deepEqual(b.problems, []);
  await a.close();
  await b.close();

});


test('settings cards lock their groups on the first change; the other admin\'s card says who, its save is off', async () => {

  freshWorld();
  const a = await device({ viewport: DESKTOP });
  await signIn(a.page, ADMIN);
  await inPanel(a.page);
  const b = await device({ viewport: PHONE, ua: ANDROID });
  await signIn(b.page, SECOND);
  await inPanel(b.page);

  const type = async (page, label, value) => page.evaluate((l, v) => {
    const input = document.querySelector(`#view .field[data-label="${l}"] input, #view .field[data-label="${l}"] textarea`);
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, label, value);

  await a.page.evaluate(() => A.go('page', 'location'));
  await a.page.waitForSelector('#view .card [data-lockable="settings"]');
  await type(a.page, 'اسم المكان', 'كنيسة الشهيد أبي سيفين');
  await sleep(1500);
  assert.ok([...world.cache.keys()].includes('adm:lck:settings:location'), 'the location group is locked');

  await b.page.evaluate(() => A.go('page', 'location'));
  await b.page.waitForSelector('#view .card [data-lockable="settings"]');
  await type(b.page, 'اسم المكان', 'من B');
  await b.page.waitForSelector('#view .card.is-locked .lock-banner', { timeout: 8000 });
  const card = await b.page.$eval('#view .card.is-locked', node => ({ banner: node.querySelector('.lock-banner').innerText, save: node.querySelector('[data-lockable]').disabled }));
  assert.match(card.banner, /menazakmena بيعدّل ده دلوقتي/);
  assert.equal(card.save, true);

  // the server agrees; a different group (the site's settings) is free
  const refused = await b.page.evaluate(() => A.call('apiSaveSettings', { 'location.name': 'من B' }).then(() => 'saved', e => A.parseError(e).message));
  assert.match(refused, /menazakmena بيعدّل ده دلوقتي/);
  const free = await b.page.evaluate(() => A.call('apiSaveSettings', { 'site.tagline': 'من B' }).then(() => 'saved', e => A.parseError(e).message));
  assert.equal(free, 'saved');

  // A saves: the group is free again
  await a.page.evaluate(() => document.querySelector('#view .card [data-lockable="settings"]').click());
  await a.page.waitForFunction(() => A.setting('location.name') === 'كنيسة الشهيد أبي سيفين', { timeout: 8000 });
  await b.page.waitForSelector('#view .card .lock-banner--free', { timeout: 8000 });

  assert.deepEqual(a.problems, []);
  assert.deepEqual(b.problems, []);
  await a.close();
  await b.close();

});


/* ---------------- the sign-in never hangs ---------------- */

test('sign-in: Google\'s script stalls → "slower" → a message with «جرّب تاني» that recovers; a silent sign-in that never answers leaves the button', async () => {

  freshWorld();
  gisHangs = true;
  const phone = await device({ viewport: PHONE, wait: 'domcontentloaded' });
  await phone.page.waitForFunction(() => /جوجل بياخد وقت أطول من العادي/.test(document.getElementById('gate-panel').innerText), { timeout: 5000 });
  await phone.page.waitForSelector('.gate[data-state="problem"]', { timeout: 6000 });
  const failed = await gateState(phone.page);
  assert.match(failed.text, /مقدرناش نفتح تسجيل الدخول بتاع جوجل/);
  assert.match(failed.text, /جرّب تاني/);
  assert.equal(await phone.page.$eval('#gate-fallback', n => n.hidden), false, 'the recovery admin link is there');

  gisHangs = false;
  await phone.page.click('.gate__btn');
  await phone.page.waitForSelector('.gate[data-state="signin"] .gis-stub', { timeout: 6000 });

  // the stand-in's prompt() never calls back (no Google session): the button is there anyway, the hint goes
  assert.equal(await phone.page.evaluate(() => !!window.__gisSilent), false);
  await sleep(TIMING.silent + 500);
  const quiet = await phone.page.evaluate(() => ({
    button: !!document.querySelector('.gate__google .gis-stub') && document.querySelector('.gate__google').offsetHeight > 20,
    hints: [...document.querySelectorAll('.gate__note--slow')].filter(n => !n.hidden).map(n => n.textContent)
  }));
  assert.equal(quiet.button, true);
  assert.deepEqual(quiet.hints, []);

  await signIn(phone.page, ADMIN);
  await inPanel(phone.page);
  assert.deepEqual(phone.problems, []);
  await phone.close();

});

test('sign-in: the API hangs → "slower than usual" → «جرّب تاني» (never a blank page) → the retry gets in', async () => {

  freshWorld();
  const phone = await device({ viewport: PHONE, ua: ANDROID });
  api.hold = true;
  await signIn(phone.page, ADMIN);

  await phone.page.waitForSelector('.gate[data-state="loading"][data-stage="server"]');
  await phone.page.waitForSelector('.gate[data-slow="1"]', { timeout: 5000 });
  const slow = await gateState(phone.page);
  assert.equal(slow.hidden, false, 'the gate stays up');
  assert.match(slow.text, /بنفتح لوحة التحكم/);
  assert.match(slow.text, /بياخد وقت أطول من العادي/);
  await shot(phone.page, '06-login-slow');

  await phone.page.waitForSelector('.gate[data-state="problem"]', { timeout: 8000 });
  const failed = await gateState(phone.page);
  assert.match(failed.text, /خادم لوحة التحكم مردّش في الوقت المعتاد/);
  assert.match(failed.text, /جرّب تاني/);
  assert.equal(await phone.page.$eval('#gate-fallback', n => n.hidden), false, 'and the recovery admin link');
  assert.equal(await phone.page.$eval('#shell', n => n.hidden), true);
  await shot(phone.page, '07-login-failed-retry');

  // the stuck request does reach the server late (a session for this page), then the server is fine again
  release();
  await sleep(300);
  await phone.page.click('.gate__btn');
  await inPanel(phone.page);
  assert.equal(await phone.page.$('.gate[data-state="session-active"]'), null, 'the same page is never "another device"');
  assert.deepEqual(phone.problems, []);

  // a retry while still hanging, then a second retry: idempotent
  await phone.close();

});

// final/r changed what a reload does: the SAME session comes back (apiSessionResume),
// with the editor that was open and its lock (tests/final-r.e2e.mjs); closing the
// editor (or signing out) is what frees the lock now.
test('a reload mid-session (an editor open) comes back without a question, the same session keeps its lock; closing frees it', async () => {

  freshWorld();
  const laptop = await device({ viewport: DESKTOP });
  await signIn(laptop.page, ADMIN);
  await inPanel(laptop.page);
  await openNews(laptop.page, 'news-aaaa1111');
  await sleep(1500);
  assert.ok([...world.cache.keys()].some(k => k === 'adm:lck:news:news-aaaa1111'), 'locked while open');

  await laptop.page.evaluateOnNewDocument(() => { window.__gisSilent = true; });
  await laptop.page.evaluate(() => { A.dirty = false; });
  const sidBefore = [...world.cache.entries()].filter(([k]) => k.startsWith('adm:ses:')).map(([, v]) => JSON.parse(v.value)).find(r => r.email === ADMIN).sid;
  await laptop.page.reload({ waitUntil: 'networkidle0' });
  await inPanel(laptop.page);
  assert.equal(await laptop.page.$('.gate[data-state="session-active"]'), null);

  // the same session, the editor back, still its lock: the other admin is refused …
  await laptop.page.waitForSelector('dialog.sheet[open] .sheet__foot .btn--primary');
  await sleep(1200);
  assert.equal(JSON.parse(world.cache.get('adm:lck:news:news-aaaa1111').value).sid, sidBefore, 'the same session holds it');
  const other = world.issueToken({ email: SECOND });
  const started = world.post({ fn: 'apiSessionStart', args: [{ device: 'x', state: false }], token: other });
  const refused = world.post({ fn: 'apiSaveItem', args: ['news', { id: 'news-aaaa1111', title: 'بعد الريفرش', summary: 'x' }], token: other, sid: started.result.sid });
  assert.equal(refused.code, 'locked');

  // … until the editor closes
  await laptop.page.evaluate(() => { A.closeSheet(); });
  await sleep(1200);
  const saved = world.post({ fn: 'apiSaveItem', args: ['news', { id: 'news-aaaa1111', title: 'بعد الريفرش', summary: 'x' }], token: other, sid: started.result.sid });
  assert.equal(saved.ok, true, saved.error);

  // sign out, then in again: no question either
  await Promise.all([laptop.page.waitForNavigation({ waitUntil: 'networkidle0' }), laptop.page.evaluate(() => A.signOut())]);
  await inPanel(laptop.page);
  assert.deepEqual(laptop.problems, []);
  await laptop.close();

});


/* ---------------- no horizontal overflow ---------------- */

const OVERFLOW = () => {
  const root = document.documentElement;
  const issues = [];
  if (root.scrollWidth > root.clientWidth) issues.push(`page ${root.scrollWidth} > ${root.clientWidth}`);
  for (const node of document.querySelectorAll('dialog[open], dialog[open] .sheet__body, .gate, .view, .card')) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1) issues.push(`${node.className || node.tagName} scrolls sideways ${node.scrollWidth} > ${node.clientWidth}`);
  }
  for (const node of document.querySelectorAll('#view *, #presence *, .topbar *, #gate-panel *, dialog[open] *')) {
    const r = node.getBoundingClientRect();
    if (!r.width || node.closest('.tabs')) continue;
    if (r.right > root.clientWidth + 1 || r.left < -1) issues.push(`${node.tagName.toLowerCase()}.${String(node.className.baseVal ?? node.className).trim().split(/\s+/).join('.')} [${Math.round(r.left)}..${Math.round(r.right)}]`);
  }
  return issues.slice(0, 10);
};

test('no horizontal overflow at 360 and 390 px: the gate, every area and sub-tab, an editor, the presence strip', async () => {

  freshWorld();
  world.as(ADMIN);
  world.gs.apiSaveItem('news', { title: 'خبر بعنوان طويل جدًا علشان نشوف السطر بيلف ولا بيطلع بره الشاشة خالص', summary: 'https://example.com/a/very/long/path/that/never/breaks/anywhere/1234567890', publishAt: '2026-10-20 18:00', expireAt: '2026-10-27 18:00' });
  world.gs.apiSaveItem('games', { title: 'لعبة', url: 'https://example.com/game', startAt: '2026-10-20 18:00', endAt: '2026-10-20 20:00' });
  world.as('');
  world.gs.SESSION_STALE_SECONDS = 0;

  for (const viewport of [SMALL, PHONE]) {
    const phone = await device({ viewport, ua: ANDROID });
    await phone.page.waitForSelector('.gate[data-state="signin"] .gis-stub');
    assert.deepEqual(await phone.page.evaluate(OVERFLOW), [], `${viewport.width}: the gate`);
    await signIn(phone.page, ADMIN);
    await inPanel(phone.page);

    const places = await phone.page.evaluate(() => A.AREAS.flatMap(a => (a.subs ? a.subs.map(s => [a.key, s.key]) : [[a.key, '']])));
    for (const [area, sub] of places) {
      await phone.page.evaluate((a, s) => A.go(a, s || undefined), area, sub);
      await sleep(400);
      assert.deepEqual(await phone.page.evaluate(OVERFLOW), [], `${viewport.width}: ${area} ${sub}`);
    }

    // an editor with dates side by side, and the strip with a long name
    await phone.page.evaluate(() => A.go('content', 'news').then(() => A.editors.news(A.state.draft.news[A.state.draft.news.length - 1])));
    await phone.page.waitForSelector('dialog.sheet[open] .sheet__body');
    await sleep(500);
    assert.deepEqual(await phone.page.evaluate(OVERFLOW), [], `${viewport.width}: news editor`);
    await phone.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
    await phone.page.evaluate(() => A.renderPresence([{ email: 'a.very.long.email.address.for.testing@gmail.com', name: 'a.very.long.email.address.for.testing', device: 'موبايل أندرويد – Chrome', seen: 3, area: 'content', view: 'news', item: { kind: 'news', id: 'x', label: 'خبر «خبر بعنوان طويل جدًا علشان نشوف السطر بيلف»' } }]));
    assert.deepEqual(await phone.page.evaluate(OVERFLOW), [], `${viewport.width}: presence strip`);

    if (viewport === SMALL) {
      await phone.page.evaluate(() => A.go('home'));
      await sleep(600);
      await phone.page.evaluate(() => window.scrollTo(0, 0));
      await shot(phone.page, '08-admin-360-no-overflow');
    }
    assert.deepEqual(phone.problems, []);
    await phone.close();
  }

});
