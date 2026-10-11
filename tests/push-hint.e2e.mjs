// The bell's hint (push.js syncBellHint), in headless Chrome against the
// real page: a visitor without notifications sees the gold dot, the
// ripples and the «فعّل الإشعارات» pill; a subscribed one sees nothing (and
// push.js isn't even loaded); turning notifications on removes it all;
// dismissing or opening the bell quiets it for a week; reduced motion
// keeps it still; nothing shifts the layout. Firebase and the Apps Script
// API are stubbed (no network, no real subscription).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { ROOT } from '../tools/lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4930;
const SITE = `http://localhost:${PORT}`;
const MEMO = 'athanasios.push.v1';
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

/* Firebase, stubbed: a token comes back without any network */
const FIREBASE_STUB = `
export const isSupported = async () => true;
export const initializeApp = () => ({});
export const getMessaging = () => ({});
export const getToken = async () => 'e2eHint:APA91b${'Q'.repeat(140)}';
export const deleteToken = async () => true;
`;

let server;
let browser;
let browserSession;

test.before(async () => {
  server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT)], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  browserSession = await browser.target().createCDPSession();
});

test.after(async () => {
  await browser?.close();
  server?.kill();
});


/**
 * A fresh visitor (own storage), notifications in the given state.
 * memo: localStorage push memo before the page runs.
 */
async function visit({ permission = 'prompt', memo = null, reducedMotion = false, viewport = { width: 390, height: 844, isMobile: true, hasTouch: true }, context = null } = {}) {

  const ctx = context || await browser.createBrowserContext();
  const requests = [];
  const errors = [];
  const api = [];

  // (one browser session for the whole run: an override ends with the session that set it)
  await browserSession.send('Browser.setPermission', { origin: SITE, browserContextId: ctx.id, permission: { name: 'notifications' }, setting: permission });
  const page = await ctx.newPage();

  await page.setViewport(viewport);
  if (reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (memo) await page.evaluateOnNewDocument((key, value) => localStorage.setItem(key, value), MEMO, JSON.stringify(memo));

  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    requests.push(url);
    if (url.endsWith('/assets/vendor/firebase-messaging.js')) {
      return req.respond({ status: 200, contentType: 'text/javascript', body: FIREBASE_STUB });
    }
    if (url.startsWith('https://script.google.com/')) {
      api.push(JSON.parse(req.postData() || '{}').fn);
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"ok":true}' });
    }
    return req.continue();
  });
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(`${SITE}/`, { waitUntil: 'networkidle0' });

  return { ctx, page, requests, errors, api };

}

const hint = page => page.evaluate(() => {
  const bell = document.getElementById('bell');
  const pill = document.querySelector('.bell-hint');
  return {
    dot: !!bell.querySelector('.bell__spark'),
    halo: bell.classList.contains('bell--halo'),
    pill: !!pill && !pill.classList.contains('is-leaving'),
    described: bell.getAttribute('aria-describedby')
  };
});

const layout = page => page.evaluate(() => ({
  bar: document.getElementById('topbar').getBoundingClientRect().height,
  main: document.getElementById('main').getBoundingClientRect().top,
  bell: document.getElementById('bell').getBoundingClientRect().toJSON()
}));

const waitForHint = page => page.waitForSelector('.bell__spark', { timeout: 10000 });


test('not subscribed: the dot, the ripples and the pill appear — and nothing moves', async () => {
  const { ctx, page, errors } = await visit();
  const before = await layout(page);
  await waitForHint(page);
  await page.waitForSelector('.bell-hint', { timeout: 5000 });
  assert.deepEqual(await hint(page), { dot: true, halo: true, pill: true, described: 'bell-hint-note' });
  assert.equal(await page.$eval('.bell-hint__go', n => n.textContent), 'فعّل الإشعارات من هنا 🔔');
  assert.match(await page.$eval('#bell-hint-note', n => n.textContent), /مش مفعّلة/);
  assert.deepEqual(await layout(page), before, 'no layout shift');
  // the pill hangs under the bell, its arrow at the bell's middle, inside a phone screen
  const box = await page.evaluate(() => {
    const pill = document.querySelector('.bell-hint').getBoundingClientRect();
    const bell = document.getElementById('bell').getBoundingClientRect();
    const arrow = getComputedStyle(document.querySelector('.bell-hint'), '::before');
    return { pill: pill.toJSON(), bell: bell.toJSON(), vw: innerWidth, arrowEnd: parseFloat(arrow.insetInlineEnd), arrowWidth: parseFloat(arrow.width) };
  });
  assert.ok(box.pill.top > box.bell.bottom, 'below the bell');
  assert.ok(box.pill.left >= 0 && box.pill.right <= box.vw, 'on screen');
  const arrowCenter = box.pill.left + box.arrowEnd + box.arrowWidth / 2;   // RTL: inline-end = left
  assert.ok(Math.abs(arrowCenter - (box.bell.left + box.bell.width / 2)) <= 2, 'the arrow points at the bell');
  // the halo is a real (finite) animation
  const halo = await page.$eval('#bell', bell => { const s = getComputedStyle(bell, '::after'); return { name: s.animationName, count: s.animationIterationCount }; });
  assert.equal(halo.name, 'bell-halo');
  assert.equal(halo.count, '3', 'a few ripples, then still');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('subscribed: no hint at all, and push.js is never loaded', async () => {
  const { ctx, page, requests } = await visit({ permission: 'granted', memo: { token: `t${'Q'.repeat(150)}`, at: Date.now(), visits: 4 } });
  await new Promise(resolve => setTimeout(resolve, 4500));
  assert.deepEqual(await hint(page), { dot: false, halo: false, pill: false, described: null });
  assert.ok(!requests.some(url => url.endsWith('/assets/js/push.js')), 'nothing to do: push.js stays unloaded');
  await ctx.close();
});

test('blocked in the browser: no hint (nothing to nag about)', async () => {
  const { ctx, page, requests } = await visit({ permission: 'denied' });
  await new Promise(resolve => setTimeout(resolve, 4500));
  assert.deepEqual(await hint(page), { dot: false, halo: false, pill: false, described: null });
  assert.ok(!requests.some(url => url.endsWith('/assets/js/push.js')));
  await ctx.close();
});

test('turning notifications on removes the dot, the ripples and the pill at once', async () => {
  const { ctx, page, api, errors } = await visit({ permission: 'granted' });
  await waitForHint(page);
  await page.waitForSelector('.bell-hint', { timeout: 5000 });
  // the pill opens the bell
  await page.click('.bell-hint__go');
  await page.waitForSelector('.push-card .btn--primary', { timeout: 8000 });
  await new Promise(resolve => setTimeout(resolve, 900));   // the sheet's spring
  await page.click('.push-card .btn--primary');
  await page.waitForFunction(() => /شغالة/.test(document.querySelector('.push-card')?.textContent || ''), { timeout: 15000 });
  assert.deepEqual(await hint(page), { dot: false, halo: false, pill: false, described: null });
  assert.deepEqual(api, ['pushSubscribe']);
  assert.equal(await page.$('#bell-hint-note'), null);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the × or opening the bell quiets it for a week: the dot stays, no ripples, no pill', async () => {
  const first = await visit();
  await waitForHint(first.page);
  await first.page.waitForSelector('.bell-hint', { timeout: 5000 });
  await first.page.click('.bell-hint__close');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.deepEqual(await hint(first.page), { dot: true, halo: false, pill: false, described: 'bell-hint-note' });
  const memo = await first.page.evaluate(key => JSON.parse(localStorage.getItem(key)), MEMO);
  assert.ok(Date.now() - memo.hintPausedAt < 60000);

  // another visit (a new tab, same browser): still quiet
  const again = await visit({ context: first.ctx });
  await waitForHint(again.page);
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.deepEqual(await hint(again.page), { dot: true, halo: false, pill: false, described: 'bell-hint-note' });
  await first.ctx.close();

  // opening the bell does the same
  const other = await visit();
  await waitForHint(other.page);
  await other.page.click('#bell');
  await other.page.waitForSelector('.push-card', { timeout: 8000 });
  assert.equal((await hint(other.page)).halo, false);
  assert.equal((await hint(other.page)).pill, false);
  assert.ok((await other.page.evaluate(key => JSON.parse(localStorage.getItem(key)), MEMO)).hintPausedAt);
  await other.ctx.close();
});

test('reduced motion: no ripples and no slide — the dot and the pill still show', async () => {
  const { ctx, page } = await visit({ reducedMotion: true });
  await waitForHint(page);
  await page.waitForSelector('.bell-hint', { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'reduced');
  const motion = await page.evaluate(() => ({
    halo: getComputedStyle(document.getElementById('bell'), '::after').animationName,
    pill: getComputedStyle(document.querySelector('.bell-hint')).animationName
  }));
  assert.deepEqual(motion, { halo: 'none', pill: 'none' });
  const state = await hint(page);
  assert.equal(state.dot, true);
  assert.equal(state.pill, true);
  await ctx.close();
});

test('desktop: the pill fits under the bell too', async () => {
  const { ctx, page } = await visit({ viewport: { width: 1280, height: 800 } });
  await page.waitForSelector('.bell-hint', { timeout: 10000 });
  const box = await page.evaluate(() => ({ pill: document.querySelector('.bell-hint').getBoundingClientRect().toJSON(), vw: innerWidth }));
  assert.ok(box.pill.left >= 0 && box.pill.right <= box.vw);
  await ctx.close();
});
