// Refine B in a real browser: the official admin at /admin/ (static, as on
// GitHub Pages) signing in with Google (a stand-in for Google's script) and
// talking to the real .gs code through doPost, in a fake Apps Script world
// that runs as the owner (the API deployment). Plus the editor panel
// (drawer), the scrollbars and «صلاحيات لوحة التحكم».
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/refine-b.e2e.mjs
// Screenshots: tools/.cache/review/b/

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4540;
const LOCAL = `http://127.0.0.1:${PORT}`;
// the real address: the browser asks for it, the local site server answers
const SITE = 'https://stathanasiosyouth.github.io';
const BASE = `${SITE}/`;
const ADMIN_URL = `${BASE}admin/`;
const ADMIN = 'menazakmena@gmail.com';
const STRANGER = 'someone@gmail.com';
const SHOTS = `${ROOT}tools/.cache/review/b/`;

const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1440, height: 900 };

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let world;
let server;
let browser;
let config;
let claims;

function freshWorld() {
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', BASE);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.gs.apiSaveItem('sessions', { date: '2026-10-11', topic: 'الكسل الروحي', notify: { topic: false } });
  // from now on the requests come from the browser, anonymously
  world.as('');
}

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  freshWorld();
  config = { apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK };
  claims = { email: ADMIN };
  server = createSiteServer({ world: { issueToken: c => world.issueToken(c), get github() { return world.github; } }, config: () => config, claims: () => claims });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  // real scrollbars in screenshots (puppeteer hides them by default)
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => (server ? server.close(resolve) : resolve()));
});


async function open({ viewport = DESKTOP, url = ADMIN_URL } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const navigations = [];

  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(`csp: ${message.text()}`);
  });
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame() && frame.url() !== 'about:blank') navigations.push(frame.url()); });

  const google = await interceptGoogle(page, { post: body => world.post(body) }, { site: { origin: SITE, local: LOCAL } });
  await page.setViewport(viewport);
  await page.goto(url, { waitUntil: 'networkidle0' });

  return { page, problems, navigations, ...google, close: () => context.close() };

}

async function signIn(page) {

  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });

}

/* no ID token (or anything like one) in storage or cookies on this origin */
async function noTokenStored(page, when) {

  const stored = await page.evaluate(() => {
    const all = [];
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) all.push(store.key(i) + '=' + store.getItem(store.key(i)));
    }
    return { all, session: sessionStorage.length, cookie: document.cookie };
  });
  assert.equal(stored.session, 0, `sessionStorage is empty (${when})`);
  assert.equal(stored.cookie, '', `no cookies (${when})`);
  assert.deepEqual(stored.all.filter(entry => /eyJ[\w-]+\.[\w-]+\.[\w-]+|token|credential|admin/i.test(entry)), [], `no token in storage (${when})`);

}

/* the address bar, drawn into the screenshot */
async function showAddress(page) {

  await page.evaluate(() => {
    const bar = document.createElement('div');
    bar.id = 'test-address';
    bar.textContent = '🔒 ' + location.href;
    bar.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:14px;transform:translateX(-50%);padding:6px 16px;border-radius:999px;background:#fff;color:#1f1f1f;font:600 14px system-ui;direction:ltr;box-shadow:0 6px 24px rgba(0,0,0,.4)';
    document.body.appendChild(bar);
  });

}

const rectOf = (page, selector) => page.$eval(selector, node => {
  const r = node.getBoundingClientRect();
  return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height), vw: innerWidth, vh: innerHeight };
});


/* ---------------- not set up ---------------- */

test('not configured: clear message and the recovery admin link — no redirect, nothing sent to Google', async () => {

  config = { apiUrl: '', clientId: '', fallbackUrl: TEST_FALLBACK };
  for (const [viewport, name] of [[DESKTOP, 'desktop'], [PHONE, 'phone']]) {
    const { page, problems, outside, calls, navigations, close } = await open({ viewport });
    await page.waitForSelector('.gate[data-state="unconfigured"]');
    const shown = await page.evaluate(() => ({
      text: document.getElementById('gate-panel').innerText,
      link: document.querySelector('.gate__panel a.gate__btn').href,
      google: !!document.querySelector('script[src*="accounts.google.com"]')
    }));
    assert.match(shown.text, /لسه مش متظبطة/);
    assert.equal(shown.link, TEST_FALLBACK);
    assert.equal(shown.google, false, 'Google\'s script is not even loaded');
    await sleep(600);
    await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}10-not-configured-${name}.png` });
    assert.equal(page.url(), ADMIN_URL);
    assert.deepEqual(navigations, [ADMIN_URL], 'never sent anywhere');
    assert.deepEqual(outside, []);
    assert.deepEqual(calls, []);
    assert.deepEqual(problems, []);
    await close();
  }

  // the client ID is set but the API deployment isn't yet: «لسه بتتجهز»
  config = { apiUrl: '', clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK };
  const { page, problems, outside, close } = await open();
  await page.waitForSelector('.gate[data-state="preparing"]');
  assert.match(await page.$eval('#gate-panel', n => n.innerText), /لوحة التحكم لسه بتتجهز/);
  await sleep(600);
  await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}11-preparing-desktop.png` });
  assert.deepEqual(outside, []);
  assert.deepEqual(problems, []);
  await close();

  config = { apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK };

});


/* ---------------- sign in → the dashboard, on /admin/ ---------------- */

test('sign in with Google → the dashboard, and the browser stays on /admin/', async () => {

  for (const [viewport, name] of [[PHONE, 'phone'], [DESKTOP, 'desktop']]) {
    const { page, problems, outside, calls, navigations, close } = await open({ viewport });
    await page.waitForSelector('.gate[data-state="signin"] .gis-stub');
    await sleep(900);
    await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}01-sign-in-${name}.png` });
    const gate = await page.evaluate(() => ({
      title: document.querySelector('.gate__title').textContent,
      heading: document.querySelector('.gate__heading').textContent,
      fallback: document.getElementById('fallback-link').href,
      fallbackShown: !document.getElementById('gate-fallback').hidden,
      gis: window.__gisOptions
    }));
    assert.equal(gate.title, 'لوحة التحكم');
    assert.equal(gate.heading, 'ادخل بحساب جوجل');
    assert.equal(gate.fallback, TEST_FALLBACK);
    assert.equal(gate.fallbackShown, true);
    assert.deepEqual(gate.gis, { client_id: TEST_CLIENT, auto_select: true });

    await signIn(page);
    await page.waitForSelector('.dash, .card');
    await sleep(700);

    assert.equal(page.url(), ADMIN_URL, 'still /admin/');
    assert.deepEqual(navigations, [ADMIN_URL], 'one page load, no redirect');
    assert.equal(await page.evaluate(() => A.state.user), ADMIN);
    assert.equal(await page.$('iframe:not(.preview-frame)'), null, 'nothing embedded');
    assert.ok(calls.length >= 1 && calls.every(c => /^text\/plain/.test(c.contentType) && !c.cookie), 'text/plain, no cookies');
    assert.deepEqual(outside, []);
    assert.deepEqual(problems, []);

    await showAddress(page);
    await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}02-dashboard-${name}-url.png` });
    console.log(`[refine-b] dashboard (${name}) at ${page.url()}`);

    // the token lives in memory only: not in any storage, after sign-in and after more API calls
    await noTokenStored(page, 'after sign-in');
    await page.evaluate(() => A.go('settings'));
    await page.waitForSelector('.card--admins .admin');
    assert.ok(calls.some(c => c.fn === 'apiAdmins'));
    await noTokenStored(page, 'after an API call');

    // a reload forgets it: Google signs in again silently (auto-select) …
    await page.evaluateOnNewDocument(() => { window.__gisSilent = true; });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__gisIssued), 1, 'a fresh token from Google after the reload');
    assert.equal(page.url(), ADMIN_URL);
    await noTokenStored(page, 'after a silent re-sign-in');
    await close();

    // … and without a Google session for auto-select, the button
    const again = await open({ viewport });
    await again.page.waitForSelector('.gate[data-state="signin"] .gis-stub');
    assert.equal(await again.page.evaluate(() => !!(window.A && A.state)), false, 'nothing restored');
    await again.close();
  }

});

test('an account that is not allowed gets the Arabic message, still on /admin/', async () => {

  claims = { email: STRANGER };
  const { page, problems, navigations, close } = await open({ viewport: PHONE });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForSelector('.gate[data-state="denied"]');
  const shown = await page.evaluate(() => ({
    text: document.getElementById('gate-panel').innerText,
    shell: document.getElementById('shell').hidden,
    stored: sessionStorage.length,
    autoOff: window.__gisAutoDisabled
  }));
  assert.match(shown.text, /الحساب ده مش مسموح له يدخل لوحة التحكم/);
  assert.ok(shown.text.includes(STRANGER));
  assert.equal(shown.shell, true, 'the panel stays closed');
  assert.equal(shown.stored, 0, 'the refused sign-in is not kept');
  assert.equal(shown.autoOff, true, 'the next sign-in asks which account');
  await page.waitForSelector('.gate[data-state="denied"] .gis-stub');
  await sleep(500);
  await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}12-not-allowed-phone.png` });
  assert.equal(page.url(), ADMIN_URL);
  assert.deepEqual(navigations, [ADMIN_URL]);

  // then the right account
  claims = { email: ADMIN };
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
  assert.deepEqual(problems, []);
  await close();

});


/* ---------------- editing and publishing ---------------- */

test('editing and publishing work through the API', async () => {

  const { page, problems, calls, close } = await open();
  await signIn(page);

  await page.evaluate(() => A.go('settings'));
  await page.waitForSelector('.card .input');
  await page.evaluate(() => {
    const field = [...document.querySelectorAll('.field')].find(f => f.dataset.label === 'الجملة التعريفية');
    const input = field.querySelector('input, textarea');
    input.value = 'اتعدلت من github.io';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    field.closest('.card').querySelector('.btn--primary').click();
  });
  await page.waitForFunction(() => A.setting('site.tagline') === 'اتعدلت من github.io');

  const head = world.github.head;
  await page.click('#publish-open');
  await page.waitForSelector('dialog.sheet[open] .changes');
  await page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .sheet__foot .btn--primary')][0].click());
  await page.waitForFunction(() => document.querySelector('#sheet-title')?.textContent === 'تم النشر ✓', { timeout: 20000 });
  assert.notEqual(world.github.head, head, 'committed');
  assert.match(String(world.github.files()['content.json']), /اتعدلت من github\.io/);
  assert.ok(calls.some(c => c.fn === 'apiPublish'));
  assert.equal(page.url(), ADMIN_URL);
  assert.deepEqual(problems, []);
  await close();

});

test('the token runs out (server or clock) → sign in again over the open editor, nothing lost', async () => {

  const { page, problems, calls, close } = await open();
  await signIn(page);

  // 1. the server stops taking the token while an editor has unsaved text
  await page.evaluate(() => A.go('page', 'contacts'));
  await page.waitForSelector('[aria-label^="تعديل "]');
  await page.click('[aria-label^="تعديل "]');
  await page.waitForSelector('dialog.sheet[open] input');
  const name = await page.evaluate(() => {
    const input = document.querySelector('dialog.sheet[open] .field[data-label="الاسم"] input');
    input.value = 'اسم بعد انتهاء الدخول';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  });
  world.idTokens.clear();
  world.cache.clear();
  const before = calls.length;
  await page.evaluate(() => document.querySelector('dialog.sheet[open] .sheet__foot .btn--primary').click());
  await page.waitForSelector('dialog.reauth[open] .gis-stub');
  await sleep(400);
  await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}13-sign-in-again-over-editor.png` });
  assert.equal(await page.$eval('dialog.sheet', d => d.open), true, 'the editor is still open');
  assert.equal(await page.$eval('dialog.sheet[open] .field[data-label="الاسم"] input', i => i.value), name, 'with what was typed');
  assert.equal(calls.length, before + 1, 'one refused call, not a loop');

  await page.click('dialog.reauth[open] .gis-stub');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet').open, { timeout: 15000 });
  assert.equal(await page.$('dialog.reauth'), null);
  assert.ok(world.gs.readTable_('Contacts').some(c => c.name === name), 'saved after signing in again');
  await noTokenStored(page, 'after signing in again');
  assert.equal(page.url(), ADMIN_URL);

  // 2. the token is about to expire by the clock: renewed before the call is sent
  assert.deepEqual(problems, []);
  await close();

  claims = { email: ADMIN, exp: String(Math.floor(Date.now() / 1000) + 63) };
  const second = await open();
  await signIn(second.page);
  await sleep(3500);
  const sent = second.calls.length;
  claims = { email: ADMIN };
  await second.page.evaluate(() => A.go('settings'));
  await second.page.waitForSelector('dialog.reauth[open] .gis-stub');
  assert.equal(second.calls.length, sent, 'nothing sent with a token about to expire');
  await second.page.click('dialog.reauth[open] .gis-stub');
  await second.page.waitForSelector('.admin');
  assert.deepEqual(second.problems, []);
  await second.close();

});


/* ---------------- the editor panel ---------------- */

async function measureSheet(page) {

  return page.evaluate(() => {
    const sheet = document.querySelector('dialog.sheet[open]');
    const body = sheet.querySelector('.sheet__body');
    const r = sheet.getBoundingClientRect();
    const head = sheet.querySelector('.sheet__head').getBoundingClientRect();
    const foot = sheet.querySelector('.sheet__foot')?.getBoundingClientRect();
    return {
      top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height),
      vw: innerWidth, vh: innerHeight,
      scrolls: body.scrollHeight > body.clientHeight + 1,
      headIn: head.top >= r.top && head.bottom <= r.bottom,
      footIn: !foot || (foot.top >= r.top && foot.bottom <= r.bottom + 1),
      radius: getComputedStyle(sheet).borderTopLeftRadius,
      blur: getComputedStyle(sheet).backdropFilter
    };
  });

}

test('the editor panel: as tall as its content, floating on wide screens, a bottom sheet on phones', async () => {

  // desktop
  {
    const { page, problems, close } = await open();
    await signIn(page);

    await page.evaluate(() => A.openReview());
    await page.waitForSelector('dialog.sheet[open] .empty-state, dialog.sheet[open] .changes');
    await sleep(700);
    const small = await measureSheet(page);
    await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}20-drawer-desktop-little.png` });
    assert.equal(small.top, 14);
    assert.equal(small.left, 14, 'floating, with a margin');
    assert.ok(small.height < small.vh - 28 - 150, `follows its content (${small.height}px)`);
    assert.equal(small.scrolls, false);
    assert.ok(small.headIn && small.footIn);
    assert.match(small.blur, /blur/);
    await page.evaluate(() => A.closeSheet());
    await page.waitForFunction(() => !document.querySelector('dialog.sheet').open);

    await page.evaluate(() => A.editors.news(null));
    await page.waitForSelector('dialog.sheet[open] input');
    await sleep(700);
    const big = await measureSheet(page);
    await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}21-drawer-desktop-lot.png` });
    assert.equal(big.top, 14);
    assert.equal(big.height, big.vh - 28, 'up to the screen, with the same margin');
    assert.equal(big.scrolls, true, 'only the body scrolls');
    assert.ok(big.headIn && big.footIn, 'title and buttons stay in view');
    assert.ok(big.width <= 560);

    // unsaved changes still ask, with our modal
    await page.type('dialog.sheet[open] input', 'خبر');
    await page.click('dialog.sheet[open] .sheet__head .icon-btn');
    await page.waitForSelector('dialog.modal[open]');
    await page.evaluate(() => [...document.querySelectorAll('dialog.modal[open] .btn')].find(b => b.textContent.includes('سيبها')).click());
    await page.waitForFunction(() => !document.querySelector('dialog.sheet').open);
    assert.deepEqual(problems, []);
    await close();
  }

  // phone
  {
    const { page, problems, close } = await open({ viewport: PHONE });
    await signIn(page);
    await page.evaluate(() => A.openReview());
    await page.waitForSelector('dialog.sheet[open] .empty-state, dialog.sheet[open] .changes');
    await sleep(800);
    const small = await measureSheet(page);
    await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}22-drawer-phone-little.png` });
    assert.equal(small.bottom, small.vh, 'a bottom sheet');
    assert.equal(small.width, small.vw);
    assert.ok(small.top > 250, `as tall as its content (top ${small.top})`);
    await page.evaluate(() => A.closeSheet());
    await page.waitForFunction(() => !document.querySelector('dialog.sheet').open);

    await page.evaluate(() => A.editors.news(null));
    await page.waitForSelector('dialog.sheet[open] input');
    await sleep(800);
    const big = await measureSheet(page);
    await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}23-drawer-phone-lot.png` });
    assert.equal(big.bottom, big.vh);
    assert.ok(big.top >= 24 && big.top <= 30, `nearly full height (top ${big.top})`);
    assert.equal(big.scrolls, true);
    assert.ok(big.headIn && big.footIn);

    // drag the handle down: closes (nothing typed, so no question)
    const head = await rectOf(page, 'dialog.sheet[open] .sheet__head');
    const x = head.left + head.width / 2;
    await page.mouse.move(x, head.top + 24);
    await page.mouse.down();
    await page.mouse.move(x, head.top + 120, { steps: 6 });
    await page.mouse.move(x, head.top + 260, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('dialog.sheet').open, { timeout: 5000 });
    assert.deepEqual(problems, []);
    await close();
  }

});

test('scrollbars: slim navy/gold on desktop (idle + hover), native on touch', async () => {

  const { page, problems, close } = await open();
  await signIn(page);
  await page.evaluate(() => A.editors.news(null));
  await page.waitForSelector('dialog.sheet[open] input');
  await sleep(700);
  const bar = await page.$eval('dialog.sheet[open] .sheet__body', body => ({ gutter: body.offsetWidth - body.clientWidth, height: body.clientHeight }));
  assert.equal(bar.gutter, 10, 'a 10px bar');
  const box = await rectOf(page, 'dialog.sheet[open] .sheet__body');
  const clip = { x: box.left, y: box.top, width: 140, height: Math.min(260, box.height) };
  await page.mouse.move(box.left + 300, box.top + 100);
  await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}30-scrollbar-idle.png`, clip });
  await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}30-scrollbar-idle-full.png` });
  // the thumb sits at the top of the bar (RTL: the bar is on the left)
  await page.mouse.move(box.left + 5, box.top + 30);
  await sleep(250);
  await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}31-scrollbar-hover.png`, clip });
  const rules = await page.evaluate(() => {
    const found = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.media && /hover: hover/.test(rule.media.mediaText) && /pointer: fine/.test(rule.media.mediaText)) {
            for (const inner of rule.cssRules) found.push(inner.cssText);
          }
        }
      }
      catch { /* other origin */ }
    }
    return found.join('\n');
  });
  assert.match(rules, /::-webkit-scrollbar-thumb \{[^}]*rgba\(215, 170, 80, 0\.42\)/);
  assert.match(rules, /::-webkit-scrollbar-thumb:hover[^{]*\{[^}]*rgba\(242, 210, 139, 0\.75\)/);
  assert.match(rules, /scrollbar-color: rgba\(215, 170, 80, 0\.45\) transparent/);
  assert.deepEqual(problems, []);
  await close();

  const phone = await open({ viewport: PHONE });
  await signIn(phone.page);
  await phone.page.evaluate(() => A.editors.news(null));
  await phone.page.waitForSelector('dialog.sheet[open] input');
  const gutter = await phone.page.$eval('dialog.sheet[open] .sheet__body', body => body.offsetWidth - body.clientWidth);
  assert.equal(gutter, 0, 'touch: the native overlay scrollbar');
  await phone.close();

});


/* ---------------- «صلاحيات لوحة التحكم» ---------------- */

test('allowlist card: the list, add and remove with our modal, the primary account locked', async () => {

  const { page, problems, close } = await open();
  await signIn(page);
  await page.evaluate(() => A.go('settings'));
  await page.waitForSelector('.card--admins .admin');
  await page.evaluate(() => document.querySelector('.card--admins').scrollIntoView({ block: 'center' }));
  await sleep(400);

  const primary = await page.$eval('.admin--primary', row => ({
    email: row.dataset.email, remove: !!row.querySelector('button'), lock: !!row.querySelector('.admin__lock'), text: row.innerText
  }));
  assert.deepEqual([primary.email, primary.remove, primary.lock], [ADMIN, false, true], 'primary: locked, no remove button');
  assert.match(primary.text, /الحساب الأساسي/);
  await (await page.$('.card--admins')).screenshot({ captureBeyondViewport: false, path: `${SHOTS}40-allowlist-list.png` });

  // a typo: under the field, nothing sent
  await page.type('.card--admins input[type=email]', 'not-an-email');
  await page.click('.card--admins .btn--primary');
  await page.waitForSelector('.card--admins .field--invalid');
  assert.equal(await page.$('dialog.modal[open]'), null);

  // add: asks first
  await page.$eval('.card--admins input[type=email]', input => { input.value = ''; });
  await page.type('.card--admins input[type=email]', 'Second.Admin@Gmail.com');
  await page.click('.card--admins .btn--primary');
  await page.waitForSelector('dialog.modal[open]');
  await sleep(300);
  await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}41-allowlist-add-confirm.png` });
  assert.match(await page.$eval('dialog.modal[open]', d => d.innerText), /second\.admin@gmail\.com/);
  await page.evaluate(() => [...document.querySelectorAll('dialog.modal[open] .btn')].find(b => b.textContent === 'ضيف').click());
  await page.waitForSelector('.admin[data-email="second.admin@gmail.com"]');
  assert.equal(world.properties.get('ADMIN_EMAILS'), `${ADMIN}, second.admin@gmail.com`);
  await sleep(400);
  await (await page.$('.card--admins')).screenshot({ captureBeyondViewport: false, path: `${SHOTS}42-allowlist-added-primary-locked.png` });

  // remove: asks first; «لأ» keeps it
  await page.click('.admin[data-email="second.admin@gmail.com"] .icon-btn--danger');
  await page.waitForSelector('dialog.modal[open]');
  await sleep(300);
  await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}43-allowlist-remove-confirm.png` });
  await page.evaluate(() => [...document.querySelectorAll('dialog.modal[open] .btn')].find(b => b.textContent.includes('سيبه')).click());
  await page.waitForFunction(() => !document.querySelector('dialog.modal'));
  assert.ok(await page.$('.admin[data-email="second.admin@gmail.com"]'));
  await page.click('.admin[data-email="second.admin@gmail.com"] .icon-btn--danger');
  await page.waitForSelector('dialog.modal[open]');
  await page.evaluate(() => [...document.querySelectorAll('dialog.modal[open] .btn')].find(b => b.textContent === 'شيل الصلاحية').click());
  await page.waitForFunction(() => !document.querySelector('.admin[data-email="second.admin@gmail.com"]'));
  assert.equal(world.properties.get('ADMIN_EMAILS'), ADMIN);

  assert.deepEqual(problems, []);
  await close();

});


/* ---------------- the preview on the site's own origin ---------------- */

test('preview on /admin/: the draft on the real page, in memory only — the site\'s storage untouched', async () => {

  const { page, problems, close } = await open();
  await signIn(page);
  await page.evaluate(() => { localStorage.setItem('athanasios.visitor', 'kept'); });

  await page.evaluate(() => A.openPreview());
  await page.waitForSelector('.preview-status--ok, .preview-status--warn', { timeout: 20000 });
  const frame = page.frames().find(f => f.url() === 'about:srcdoc');
  assert.ok(frame);
  const inside = await frame.evaluate(() => {
    localStorage.setItem('athanasios.content.v1', 'draft!');
    return {
      preview: document.documentElement.hasAttribute('data-preview'),
      origin: self.origin,
      own: localStorage.getItem('athanasios.content.v1'),
      visitor: localStorage.getItem('athanasios.visitor')
    };
  });
  assert.equal(inside.preview, true);
  assert.equal(inside.origin, new URL(BASE).origin, 'same origin as the site (and this admin)');
  assert.equal(inside.own, 'draft!', 'the page has a storage of its own');
  assert.equal(inside.visitor, null, 'which is not the site\'s');
  assert.equal(await page.evaluate(() => localStorage.getItem('athanasios.content.v1')), null, 'nothing reached the site\'s storage');
  assert.equal(await page.evaluate(() => localStorage.getItem('athanasios.visitor')), 'kept');
  await sleep(500);
  await page.screenshot({ captureBeyondViewport: false, path: `${SHOTS}50-preview-on-admin-origin.png` });
  assert.deepEqual(problems, []);
  await close();

});
