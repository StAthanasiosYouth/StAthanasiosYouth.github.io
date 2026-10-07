// final/r — an accidental reload of the official admin (/admin/) is almost
// invisible, in a real browser: the static admin, a stand-in for Google's
// script, and the real .gs code behind doPost in a fake Apps Script world.
//
//  - a reload shows only «جاري استعادة الجلسة...» (sampled every ~40 ms and
//    every frame: the full sign-in gate never flashes), Google signs in again
//    silently and apiSessionResume brings back the SAME session (sid, lock,
//    presence) — never the takeover question
//  - the same area / sub-tab (and scroll), the open editor and its unsaved
//    values with «رجعنا التعديلات اللي ماكانتش اتحفظت» + «تجاهلها»
//  - Google wants a click: its button inside the compact restore state
//  - a locked item: the draft read-only, under the lock banner
//  - a duplicated tab / another device: still the takeover question
//  - expired → the usual sign-in; replaced → «الجلسة اتقفلت…»
//  - sessionStorage holds only the sid, the place and the draft (no token,
//    no email); signing out clears it; pull-to-refresh is guarded
//  - Android (412×915) and desktop
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/final-r.e2e.mjs
// Screenshots: tools/.cache/review/final-r-*.png

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4840;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN_URL = `${SITE}/admin/`;
const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'second.admin@gmail.com';
const SHOTS = `${ROOT}tools/.cache/review/`;

const ANDROID_PHONE = { width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 };
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
const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1200, slow: 900, fail: 4000, render: 8000, beat: 900, beatFail: 2500 };

const RESTORE_TEXT = 'جاري استعادة الجلسة...';
const DRAFT_TEXT = 'رجعنا التعديلات اللي ماكانتش اتحفظت';

let world;
let server;
let browser;
let claims;

/*
 * The API, with knobs: hold = requests to these functions wait until
 * released; dropBeats = heartbeats never come back (that page can't find
 * out it was taken over before it reloads).
 */
const api = { hold: new Set(), held: [], dropBeats: false };

function post(body) {
  let fn = '';
  try { fn = JSON.parse(body).fn; }
  catch { fn = ''; }
  if (api.dropBeats && fn === 'apiHeartbeat') return new Promise(() => {});
  if (api.hold.has(fn)) return new Promise(resolve => api.held.push(() => resolve(world.post(body))));
  return world.post(body);
}

function release() {
  api.hold.clear();
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
  for (let i = 1; i <= 8; i++) world.gs.apiSaveLink({ title: `رابط رقم ${i}`, url: `https://example.com/${i}`, section: 'social' });
  // short lives, so the test can watch them
  world.gs.SESSION_STALE_SECONDS = 4;
  world.gs.PRESENCE_ONLINE_SECONDS = 4;
  world.gs.LOCK_SECONDS = 3;
  world.as('');
  api.hold.clear();
  api.held = [];
  api.dropBeats = false;
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


/* ---------------- helpers ---------------- */

async function preparePage(page, { viewport, ua, calls, problems }) {

  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(`csp: ${message.text()}`);
  });
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  if (ua) await page.setUserAgent(ua);
  const google = await interceptGoogle(page, { post }, { site: { origin: SITE, local: LOCAL }, calls });
  await page.setViewport(viewport);
  return google;

}

/* one device: its own browser context (its own sessionStorage) */
async function device({ viewport = DESKTOP, ua = null } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const calls = [];
  await preparePage(page, { viewport, ua, calls, problems });
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle0' });
  return { context, page, problems, calls, close: () => context.close() };

}

async function signIn(page, email) {

  claims = { email };
  await page.waitForSelector('.gate[data-state="signin"] .gis-stub');
  await page.click('.gis-stub');

}

async function inPanel(page) {

  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden && document.getElementById('gate').hidden, { timeout: 15000 });

}

async function shot(page, name) {

  await sleep(350);
  await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}final-r-${name}.png` });

}

const gateState = page => page.$eval('#gate', gate => ({ state: gate.dataset.state || '', stage: gate.dataset.stage || '', hidden: gate.hidden, text: document.getElementById('gate-panel').innerText }));

/* this tab's sessionStorage, as [key, value] */
const stored = page => page.evaluate(() => {
  const all = [];
  for (let i = 0; i < sessionStorage.length; i++) all.push([sessionStorage.key(i), sessionStorage.getItem(sessionStorage.key(i))]);
  for (let i = 0; i < localStorage.length; i++) all.push(['local:' + localStorage.key(i), localStorage.getItem(localStorage.key(i))]);
  return { all, cookie: document.cookie };
});

/* only the sid, the place and the draft — no token, no email, nothing from Google */
async function onlyAllowedStored(page, when) {

  const { all, cookie } = await stored(page);
  assert.equal(cookie, '', `no cookies (${when})`);
  for (const [key, value] of all) {
    assert.ok(['athanasios-admin.session', 'athanasios-admin.ui', 'athanasios-admin.draft'].includes(key), `unexpected storage key ${key} (${when})`);
    assert.doesNotMatch(value, /eyJ[\w-]+\.[\w-]+\.[\w-]+|[\w-]{10,}\.[\w-]{20,}\.[\w-]{10,}/, `nothing JWT-like in ${key} (${when})`);
    assert.doesNotMatch(value, /@|token|credential|gmail/i, `no email or token in ${key} (${when})`);
  }
  const session = all.find(([key]) => key === 'athanasios-admin.session');
  if (session) assert.deepEqual(Object.keys(JSON.parse(session[1])).sort().filter(k => k !== 'left'), ['sid', 'tab'], 'the session entry: sid + page load only');
  return Object.fromEntries(all.map(([key, value]) => [key, JSON.parse(value)]));

}

/* the server's record of this account's session */
function serverSession(email) {
  const key = [...world.cache.keys()].find(k => k.startsWith('adm:ses:') && JSON.parse(world.cache.get(k).value).email === email);
  return key ? JSON.parse(world.cache.get(key).value) : null;
}

/*
 * Watches the gate from the very first moment of the next page load: every
 * ~40 ms and every frame, whether any part of the full sign-in gate (the
 * door, the title, the sign-in or verifying states) is on screen.
 */
async function watchGate(page) {

  await page.evaluateOnNewDocument(() => {
    window.__samples = [];
    const shown = node => !!node && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().height > 0;
    function sample(kind) {
      const gate = document.getElementById('gate');
      if (!gate) return;
      window.__samples.push({
        kind,
        t: Math.round(performance.now()),
        state: gate.dataset.state || '',
        stage: gate.dataset.stage || '',
        gate: !gate.hidden,
        door: shown(document.querySelector('.gate__arch')),
        title: shown(document.querySelector('.gate__title')),
        sub: shown(document.querySelector('.gate__sub')),
        restoring: document.documentElement.classList.contains('is-restoring'),
        text: gate.hidden ? '' : (document.getElementById('gate-panel') || {}).innerText || '',
        panel: !document.getElementById('shell')?.hidden
      });
    }
    setInterval(() => sample('40ms'), 40);
    (function frame() { sample('frame'); requestAnimationFrame(frame); })();
    document.addEventListener('readystatechange', () => sample('ready'));
  });

}

const samples = page => page.evaluate(() => window.__samples || []);

/* the full gate never showed while the gate was up */
function noFullGate(list, label) {
  const up = list.filter(s => s.gate && !s.panel);
  assert.ok(up.length >= 3, `${label}: sampled the gate (${up.length})`);
  const full = up.filter(s => s.door || s.title || s.sub || ['signin', 'loading', 'session-active', 'revoked', 'denied'].includes(s.state));
  assert.deepEqual(full.slice(0, 3), [], `${label}: the full sign-in gate never flashed`);
  assert.ok(up.some(s => s.text.includes(RESTORE_TEXT)), `${label}: «${RESTORE_TEXT}» was on screen`);
  assert.ok(up.every(s => !s.text || s.text.includes(RESTORE_TEXT)), `${label}: only the restore words`);
}

async function openNews(page, id) {

  await page.evaluate(newsId => A.go('content', 'news').then(() => A.editors.news(newsId ? A.state.draft.news.find(n => n.id === newsId) : null)), id);
  await page.waitForSelector('dialog.sheet[open] .sheet__foot .btn--primary');

}

async function typeTitle(page, text) {

  const input = await page.$('dialog.sheet[open] .field[data-label="العنوان"] input');
  await input.evaluate(node => { node.scrollIntoView({ block: 'center' }); node.focus(); node.select(); });
  await page.keyboard.type(text, { delay: 5 });
  await sleep(700);   // the draft is kept ~400 ms after the last change

}

const sheetTitle = page => page.$eval('dialog.sheet[open] .field[data-label="العنوان"] input', input => input.value);


/* ---------------- the reload: desktop ---------------- */

test('desktop: a reload brings back the same session, area, editor and unsaved title — only «جاري استعادة الجلسة...» in between', async () => {

  freshWorld();
  const laptop = await device({ viewport: DESKTOP });
  const { page, calls } = laptop;
  await signIn(page, ADMIN);
  await inPanel(page);
  assert.equal((await stored(page)).all.find(([k]) => k === 'athanasios-admin.session') ? true : false, true, 'the sid is kept for this tab');

  await openNews(page, 'news-aaaa1111');
  await typeTitle(page, 'رحلة الغردقة — اتغيّر الميعاد');
  await sleep(1200);
  const before = serverSession(ADMIN);
  assert.ok(before?.sid);
  assert.equal(JSON.parse(world.cache.get('adm:lck:news:news-aaaa1111').value).sid, before.sid, 'locked while open');
  const kept = await onlyAllowedStored(page, 'while editing');
  assert.equal(kept['athanasios-admin.session'].sid, before.sid);
  assert.equal(kept['athanasios-admin.draft'].kind, 'news');
  assert.equal(kept['athanasios-admin.draft'].dirty, true);
  assert.equal(await page.evaluate(() => A.unrestorable()), false, 'an editor\'s unsaved values come back: no "leave the page?"');

  // the reload: Google signs in silently; the server answers when we say so
  await watchGate(page);
  await page.evaluateOnNewDocument(() => { window.__gisSilent = true; });
  api.hold.add('apiSessionResume');
  const callsBefore = calls.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.gate[data-state="restoring"][data-stage="server"]', { timeout: 8000 });
  const restoring = await gateState(page);
  assert.equal(restoring.text.trim(), RESTORE_TEXT, 'only the restore words — no account, no intro');
  await shot(page, '01-restoring-desktop');
  release();
  await inPanel(page);

  noFullGate(await samples(page), 'desktop reload');
  const after = calls.slice(callsBefore).map(c => c.fn);
  assert.ok(after.includes('apiSessionResume'));
  assert.ok(!after.includes('apiSessionStart'), 'no new session');
  assert.equal(await page.$('.gate[data-state="session-active"]'), null);

  // the same session, its lock, its place
  const now = serverSession(ADMIN);
  assert.equal(now.sid, before.sid, 'the same sid');
  assert.equal(now.since, before.since, 'the same session');
  assert.equal(now.parked, undefined);
  await page.waitForSelector('dialog.sheet[open] .draft-note');
  const view = await page.evaluate(() => ({ area: A.area, sub: A.sub.content, title: document.getElementById('page-title').textContent }));
  assert.equal(view.area, 'content');
  assert.equal(view.sub, 'news');
  assert.equal(await sheetTitle(page), 'رحلة الغردقة — اتغيّر الميعاد', 'the unsaved title is back');
  assert.match(await page.$eval('dialog.sheet[open] .draft-note', n => n.innerText), new RegExp(DRAFT_TEXT));
  await sleep(1500);
  assert.equal(JSON.parse(world.cache.get('adm:lck:news:news-aaaa1111').value).sid, before.sid, 'still its lock');
  // the other admin is still refused that item
  const other = world.issueToken({ email: SECOND });
  const otherSid = world.post({ fn: 'apiSessionStart', args: [{ device: 'x', state: false }], token: other }).result.sid;
  assert.equal(world.post({ fn: 'apiSaveItem', args: ['news', { id: 'news-aaaa1111', title: 'من التاني', summary: 'x' }], token: other, sid: otherSid }).code, 'locked');
  await shot(page, '03-draft-restored-desktop');

  // «تجاهلها»: the saved version, nothing pending
  await page.evaluate(() => document.querySelector('dialog.sheet[open] .draft-note__drop').click());
  await page.waitForFunction(() => !document.querySelector('dialog.sheet[open] .draft-note'));
  assert.equal(await sheetTitle(page), 'رحلة الغردقة', 'back to what is saved');
  assert.equal(await page.evaluate(() => A.dirty), false);
  const cleared = await onlyAllowedStored(page, 'after «تجاهلها»');
  assert.equal(cleared['athanasios-admin.draft'].dirty, false, 'the draft is gone (only the open editor is remembered)');
  assert.equal(cleared['athanasios-admin.draft'].fields, undefined);

  // closing the editor forgets it; nothing was saved to the server by itself
  await page.evaluate(() => A.closeSheet());
  await sleep(300);
  assert.equal((await onlyAllowedStored(page, 'after closing'))['athanasios-admin.draft'], undefined);
  assert.equal(world.gs.readTable_('News').find(n => n.id === 'news-aaaa1111').title, 'رحلة الغردقة');

  assert.deepEqual(laptop.problems, []);
  await laptop.close();

});


/* ---------------- the reload: Android ---------------- */

test('Android 412×915: pull-to-refresh guarded; a reload returns to the same sub-tab and scroll; a NEW item\'s draft comes back', async () => {

  freshWorld();
  const phone = await device({ viewport: ANDROID_PHONE, ua: ANDROID });
  const { page } = phone;

  const guard = await page.evaluate(() => ({ html: getComputedStyle(document.documentElement).overscrollBehaviorY, body: getComputedStyle(document.body).overscrollBehaviorY }));
  assert.deepEqual(guard, { html: 'contain', body: 'contain' }, 'no accidental pull-to-refresh');

  await signIn(page, ADMIN);
  await inPanel(page);
  await page.evaluate(() => A.go('page', 'links'));
  await sleep(400);
  const scrolled = await page.evaluate(() => { window.scrollTo(0, 420); return Math.round(window.scrollY); });
  assert.ok(scrolled > 100, `the links page scrolls (${scrolled})`);
  await sleep(200);
  await onlyAllowedStored(page, 'phone, in the panel');

  await watchGate(page);
  await page.evaluateOnNewDocument(() => { window.__gisSilent = true; });
  api.hold.add('apiSessionResume');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.gate[data-state="restoring"][data-stage="server"]', { timeout: 8000 });
  await shot(page, '02-restoring-phone');
  release();
  await inPanel(page);
  noFullGate(await samples(page), 'phone reload');

  const back = await page.evaluate(() => ({ area: A.area, sub: A.sub.page, y: Math.round(window.scrollY), title: document.getElementById('page-title').textContent }));
  assert.equal(back.area, 'page');
  assert.equal(back.sub, 'links');
  assert.ok(Math.abs(back.y - scrolled) < 60, `the scroll position too (${back.y} vs ${scrolled})`);
  await shot(page, '04-dashboard-same-area-phone');

  // a NEW item: its draft comes back too (a temporary key)
  await openNews(page, null);
  await typeTitle(page, 'خبر لسه ماتحفظش');
  await page.evaluateOnNewDocument(() => { window.__gisSilent = true; });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await inPanel(page);
  await page.waitForSelector('dialog.sheet[open] .draft-note');
  assert.equal(await page.$eval('#sheet-title', n => n.textContent), 'خبر جديد');
  assert.equal(await sheetTitle(page), 'خبر لسه ماتحفظش');
  await shot(page, '05-draft-restored-phone');
  assert.equal(world.gs.readTable_('News').length, 2, 'never saved by itself');

  // signing out: nothing of this admin stays in the tab (and Google won't sign in by itself)
  await page.evaluate(() => { A.dirty = false; });
  await page.evaluateOnNewDocument(() => { window.__gisSilent = false; });
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.evaluate(() => A.signOut())]);
  assert.deepEqual((await stored(page)).all, [], 'sign-out cleared it all');
  await page.waitForSelector('.gate[data-state="signin"]');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('is-restoring')), false);

  assert.deepEqual(phone.problems, []);
  await phone.close();

});


/* ---------------- Google wants a click ---------------- */

test('Google wants a click: its button inside the compact restore state, then the same session', async () => {

  freshWorld();
  const laptop = await device({ viewport: DESKTOP });
  const { page } = laptop;
  await signIn(page, ADMIN);
  await inPanel(page);
  await page.evaluate(() => A.go('settings'));
  const sid = serverSession(ADMIN).sid;

  await watchGate(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  // no silent sign-in this time: the button comes, under the same words
  await page.waitForSelector('.gate[data-state="restoring"] .gate__google:not([hidden]) .gis-stub', { timeout: 8000 });
  const asking = await gateState(page);
  assert.match(asking.text, new RegExp(RESTORE_TEXT));
  assert.match(asking.text, /جوجل محتاج تأكيد/);
  await shot(page, '06-restoring-google-button-desktop');
  await page.click('.gis-stub');
  await inPanel(page);
  noFullGate(await samples(page), 'restore with the button');
  assert.equal(serverSession(ADMIN).sid, sid, 'the same session');
  assert.equal(await page.evaluate(() => A.area), 'settings');

  assert.deepEqual(laptop.problems, []);
  await laptop.close();

});


/* ---------------- a locked item ---------------- */

test('the item got locked by someone else during the reload: the draft comes back read-only, under the lock banner', async () => {

  freshWorld();
  world.gs.SESSION_PARK_SECONDS = 1;
  const laptop = await device({ viewport: DESKTOP });
  const { page } = laptop;
  await signIn(page, ADMIN);
  await inPanel(page);
  await openNews(page, 'news-aaaa1111');
  await typeTitle(page, 'تعديل مش محفوظ');

  // the reload: the server is slow to answer; meanwhile the other admin takes the item
  await page.evaluateOnNewDocument(() => { window.__gisSilent = true; });
  api.hold.add('apiSessionResume');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.gate[data-state="restoring"][data-stage="server"]', { timeout: 8000 });
  await sleep(3500);   // the parked session's grace and its lock run out
  const token = world.issueToken({ email: SECOND });
  const otherSid = world.post({ fn: 'apiSessionStart', args: [{ device: 'موبايل أندرويد – Chrome', state: false }], token }).result.sid;
  const beat = () => world.post({ fn: 'apiHeartbeat', args: [{ area: 'content', view: 'news', item: { kind: 'news', id: 'news-aaaa1111', label: 'خبر' }, locks: ['news:news-aaaa1111'] }], token, sid: otherSid });
  assert.equal(beat().result.locks['news:news-aaaa1111'].granted, true, 'the other admin has it now');
  const keepBeating = setInterval(beat, 700);

  try {
    release();
    await inPanel(page);
    await page.waitForSelector('dialog.sheet[open].is-locked .lock-banner', { timeout: 8000 });
    const shown = await page.evaluate(() => {
      const sheet = document.querySelector('dialog.sheet[open]');
      return {
        banner: sheet.querySelector('.lock-banner').innerText,
        note: sheet.querySelector('.draft-note')?.innerText || '',
        title: sheet.querySelector('.field[data-label="العنوان"] input').value,
        inputs: [...sheet.querySelectorAll('.sheet__body input, .sheet__body textarea')].filter(i => !i.closest('.draft-note')).every(i => i.disabled),
        save: sheet.querySelector('.sheet__foot .btn--primary').disabled,
        drop: sheet.querySelector('.draft-note__drop')?.disabled
      };
    });
    assert.match(shown.banner, /second\.admin بيعدّل ده دلوقتي/);
    assert.match(shown.note, new RegExp(DRAFT_TEXT));
    assert.equal(shown.title, 'تعديل مش محفوظ', 'the draft is there, to read');
    assert.equal(shown.inputs, true, 'read-only');
    assert.equal(shown.save, true, 'no save over the other admin');
    assert.equal(shown.drop, false, '«تجاهلها» still works');
    assert.equal(await page.$('.gate[data-state="session-active"]'), null);
    await shot(page, '07-draft-locked-readonly-desktop');
    assert.equal(world.gs.readTable_('News').find(n => n.id === 'news-aaaa1111').title, 'رحلة الغردقة', 'nothing overwritten');

    // closing asks first (those values would be lost)
    await page.evaluate(() => { A.closeSheet(); });
    await page.waitForSelector('dialog.modal[open]');
    await page.evaluate(() => [...document.querySelectorAll('dialog.modal[open] button')].find(b => /سيبها من غير حفظ/.test(b.textContent)).click());
    await page.waitForFunction(() => !document.getElementById('sheet').open);
    assert.equal((await onlyAllowedStored(page, 'locked, closed'))['athanasios-admin.draft'], undefined);
  }
  finally {
    clearInterval(keepBeating);
  }

  assert.deepEqual(laptop.problems, []);
  await laptop.close();

});


/* ---------------- another tab, another device ---------------- */

test('a duplicated tab (same sid copied) and another device still get the takeover question; the first tab goes on', async () => {

  freshWorld();
  const laptop = await device({ viewport: DESKTOP });
  await signIn(laptop.page, ADMIN);
  await inPanel(laptop.page);
  const kept = (await onlyAllowedStored(laptop.page, 'first tab'))['athanasios-admin.session'];
  await sleep(1200);

  // a duplicated tab: the browser copies sessionStorage while the first tab is still live
  const copy = await laptop.context.newPage();
  const problems = [];
  await preparePage(copy, { viewport: DESKTOP, calls: [], problems });
  await copy.evaluateOnNewDocument(value => {
    sessionStorage.setItem('athanasios-admin.session', value);
    window.__gisSilent = true;
  }, JSON.stringify(kept));
  await copy.goto(ADMIN_URL, { waitUntil: 'networkidle0' });
  await copy.waitForSelector('.gate[data-state="session-active"]', { timeout: 8000 });
  assert.match((await gateState(copy)).text, /الحساب ده شغال دلوقتي على جهاز تاني/);
  assert.equal(await copy.evaluate(() => sessionStorage.getItem('athanasios-admin.session')), null, 'the copy let go of the other tab\'s sid');
  await sleep(1200);
  assert.equal((await gateState(laptop.page)).hidden, true, 'the first tab goes on');
  assert.equal(serverSession(ADMIN).sid, kept.sid);
  await copy.close();

  // another device: asked, as always
  const phone = await device({ viewport: ANDROID_PHONE, ua: ANDROID });
  await signIn(phone.page, ADMIN);
  await phone.page.waitForSelector('.gate[data-state="session-active"]');

  assert.deepEqual(problems, []);
  assert.deepEqual(laptop.problems, []);
  await phone.close();
  await laptop.close();

});


/* ---------------- expired, replaced ---------------- */

test('expired: the usual sign-in («جاري التحقق...») and a new session; replaced: «الجلسة اتقفلت…»', async () => {

  freshWorld();
  const laptop = await device({ viewport: DESKTOP });
  const { page } = laptop;
  await signIn(page, ADMIN);
  await inPanel(page);
  await page.evaluate(() => A.go('content', 'games'));
  const first = serverSession(ADMIN).sid;

  // the server forgot the session (6 h, or evicted) by the time the page reloads
  // (no heartbeat in between: it would quietly start a new one)
  api.dropBeats = true;
  await sleep(300);
  for (const key of [...world.cache.keys()].filter(k => k.startsWith('adm:ses:'))) world.cache.delete(key);
  await page.evaluateOnNewDocument(() => { window.__gisSilent = true; });
  api.hold.add('apiSessionStart');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.gate[data-state="loading"]', { timeout: 8000 });
  const usual = await gateState(page);
  assert.match(usual.text, /جاري التحقق/, 'the usual sign-in screen');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('is-restoring')), false, 'the full gate, not the restore state');
  await shot(page, '08-expired-fallback-signin-desktop');
  release();
  await inPanel(page);
  const second = serverSession(ADMIN).sid;
  assert.notEqual(second, first, 'a new session');
  assert.equal((await onlyAllowedStored(page, 'after the fallback'))['athanasios-admin.session'].sid, second);
  assert.equal(await page.evaluate(() => A.area), 'content', 'still where the admin was');

  // replaced: another device took over while this tab could not hear about it
  api.dropBeats = true;
  const phoneToken = world.issueToken({ email: ADMIN });
  assert.ok(world.post({ fn: 'apiSessionStart', args: [{ device: 'موبايل أندرويد – Chrome', force: true, state: false }], token: phoneToken }).result.sid);
  await page.evaluateOnNewDocument(() => { window.__gisSilent = true; });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.gate[data-state="revoked"]', { timeout: 8000 });
  assert.match((await gateState(page)).text, /الجلسة اتقفلت لأنك دخلت من جهاز تاني/);
  assert.equal((await stored(page)).all.find(([k]) => k === 'athanasios-admin.session'), undefined, 'the old sid is forgotten');
  await shot(page, '09-replaced-desktop');

  assert.deepEqual(laptop.problems, []);
  await laptop.close();

});


/* ---------------- what can't come back ---------------- */

test('the browser\'s own "leave the page?" only for what a reload can\'t bring back (a photo uploading, a settings card)', async () => {

  freshWorld();
  const laptop = await device({ viewport: DESKTOP });
  const { page } = laptop;
  await signIn(page, ADMIN);
  await inPanel(page);

  const asks = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

  await openNews(page, 'news-aaaa1111');
  await typeTitle(page, 'تعديل');
  assert.equal(await asks(), false, 'an editor: it comes back by itself');
  await page.evaluate(() => { A.uploadsInFlight = 1; });
  assert.equal(await asks(), true, 'a photo uploading: asked');
  await page.evaluate(() => { A.uploadsInFlight = 0; A.dirty = false; document.getElementById('sheet').close(); });

  // a settings card (no editor): its changes can't come back
  await page.evaluate(() => A.go('settings'));
  await page.evaluate(() => A.markDirty());
  assert.equal(await asks(), true, 'a settings card: asked');
  await page.evaluate(() => { A.dirty = false; });
  assert.equal(await asks(), false);

  assert.deepEqual(laptop.problems, []);
  await laptop.close();

});
