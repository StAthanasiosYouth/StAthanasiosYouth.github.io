// The header's account icon and the one way back after signing in (accounts improvements, Step 2), in Chrome: the
// real pages with their real CSP, over HTTP, against the REAL Worker code on SQLite.
// Run: cd tools && node --experimental-sqlite --no-warnings --test ../tests/account-badge.e2e.mjs

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { harness } from '../worker/test/helpers.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const SITE_PORT = 4753;
const API_PORT = 4754;
const LOCAL = `http://localhost:${SITE_PORT}`;
const API = `http://localhost:${API_PORT}`;
const SHOTS = `${ROOT}tools/.cache/account-badge/`;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find(existsSync);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.ics': 'text/calendar' };
const KEYS = { PW_PEPPER: 'pepper', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp', ACCOUNT_PAD_MS: '0', BOOK_SECRET: 'b'.repeat(40) };
const SAMPLE = join(ROOT, 'assets/img/og-image.png');

let h, site, apiServer, browser, tick = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ALLOWED_ORIGINS: LOCAL, ...KEYS } });
  await h.db.prepare("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'").run();
  site = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, LOCAL).pathname);
    let file = normalize(path);
    if (file.endsWith('\\') || file.endsWith('/')) file += 'index.html';
    try {
      let body = readFileSync(join(ROOT, file));
      if (file.endsWith('.html')) body = body.toString().replace("connect-src 'self'", `connect-src 'self' ${API}`);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    }
    catch {
      res.writeHead(404);
      res.end('');
    }
  });
  apiServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    const init = { method: req.method, headers };
    if (chunks.length) init.body = Buffer.concat(chunks);
    const { handle } = await import('../worker/src/index.js');
    const reply = await handle(new Request('https://api.test' + req.url, init), h.env, { waitUntil: () => {} });
    const out = {};
    reply.headers.forEach((v, k) => { out[k] = v; });
    res.writeHead(reply.status, out);
    res.end(Buffer.from(await reply.arrayBuffer()));
  });
  await Promise.all([new Promise(r => site.listen(SITE_PORT, r)), new Promise(r => apiServer.listen(API_PORT, r))]);
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  await Promise.all([site, apiServer].map(s => new Promise(r => (s ? s.close(r) : r()))));
});

async function member() {
  tick++;
  const email = `badge${tick}${Date.now()}@staging.invalid`;
  const start = await h.call('/v1/account/register/start', { method: 'POST', body: { email, phone: '012' + String(40000000 + tick), name: 'مارك سامي فوزي', birthDate: '2000-03-12' } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const done = await h.call('/v1/account/register/verify', { method: 'POST', body: { pendingId: start.body.pendingId, code: start.body.testCode } });
  return { email, password: done.body.password };
}

async function open(path, { width = 390, height = 844, context = null } = {}) {
  const ctx = context || await browser.createBrowserContext();
  const page = await ctx.newPage();
  const problems = [];
  const calls = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('request', r => { if (r.url().startsWith(API) && r.method() !== 'OPTIONS') calls.push(new URL(r.url()).pathname); });
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument(api => localStorage.setItem('athanasios.book.api', api), API);
  await page.goto(LOCAL + path, { waitUntil: 'domcontentloaded' });
  return { page, ctx, problems, calls };
}

const set = (page, selector, value) => page.$eval(selector, (n, v) => { n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); }, value);

async function signIn(page, m, { shared = false } = {}) {
  await page.waitForSelector('#acct-email', { timeout: 10000 });
  await set(page, '#acct-email', m.email);
  await set(page, '#acct-password', m.password);
  if (shared) await page.click('#acct-shared');
  await page.$eval('form', f => f.requestSubmit());
}

const badge = (page, timeout = 10000) => page.waitForSelector('.acct-badge', { timeout });
const label = page => page.$eval('.acct-badge', n => n.getAttribute('aria-label'));
const pressBadge = async page => {
  await badge(page);
  // the intro on a first visit covers the bar for a moment, and a tap only skips it
  await page.waitForFunction(() => { const b = document.querySelector('.acct-badge'); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e && b.contains(e); }, { timeout: 12000 });
  await page.click('.acct-badge');
};

test('signed out on a page: the icon says sign in, and after signing in you are back on that page with your letter', async () => {
  const m = await member();
  const { page, ctx, problems } = await open('/black-theatre/?x=1');
  await badge(page);
  assert.equal(await label(page), 'سجّل دخولك');
  await page.screenshot({ path: SHOTS + 'signed-out-page-mobile.png' });
  await pressBadge(page);
  await signIn(page, m);
  await page.waitForFunction(() => location.pathname === '/black-theatre/' && location.search === '?x=1', { timeout: 10000 });
  await badge(page);
  assert.equal(await label(page), 'حسابي: مارك');
  assert.equal(await page.$eval('.acct-badge__face', n => n.textContent), 'م');
  await page.screenshot({ path: SHOTS + 'signed-in-page-mobile.png' });
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('the home page: the icon in the top bar, no call to the Worker for it; back home after signing in', async () => {
  const m = await member();
  const { page, ctx, problems, calls } = await open('/');
  await badge(page);
  await sleep(500);
  assert.ok(!calls.some(c => c.startsWith('/v1/account/')), 'no request: ' + calls);
  assert.ok(await page.$('.topbar__actions .acct-badge.topbar__btn'));
  assert.equal(await page.$eval('.topbar__actions', n => n.lastElementChild.id), 'bell', 'the bell stays last: its hint points at it');
  await sleep(3200);
  await page.screenshot({ path: SHOTS + 'home-mobile.png' });
  await pressBadge(page);
  await signIn(page, m);
  await page.waitForFunction(() => location.pathname === '/' || location.pathname === '/index.html', { timeout: 10000 });
  await badge(page);
  assert.equal(await label(page), 'حسابي: مارك');
  const before = calls.length;
  await sleep(500);
  assert.equal(calls.filter(c => c.startsWith('/v1/account/')).length, calls.slice(0, before).filter(c => c.startsWith('/v1/account/')).length);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('signed in: the icon opens the account directly, and «ارجع للموقع» goes back to the page you came from', async () => {
  const m = await member();
  const { page, ctx } = await open('/account/');
  await signIn(page, m);
  await page.waitForSelector('[data-home]', { timeout: 10000 });
  await page.goto(LOCAL + '/black-theatre/', { waitUntil: 'domcontentloaded' });
  await pressBadge(page);
  await page.waitForSelector('[data-home]', { timeout: 10000 });
  assert.equal(await page.evaluate(() => location.pathname), '/account/', 'no bounce back');
  assert.equal(await page.$eval('.cbar__home', a => new URL(a.href).pathname), '/black-theatre/');
  assert.equal(await page.$('.acct-badge'), null, 'no icon on the account page');
  await ctx.close();
});

test('the photo reaches the header without a request; removing it and signing out clear it', async () => {
  const m = await member();
  const { page, ctx, problems } = await open('/account/');
  await signIn(page, m);
  await page.waitForSelector('[data-home]', { timeout: 10000 });
  await page.click('.ac-hero .ac-arch');
  await page.waitForSelector('[data-photo-sheet][open]');
  await (await page.$('#ac-photo-file')).uploadFile(SAMPLE);
  await page.waitForSelector('[data-photo-crop] canvas');
  await page.click('[data-photo-save]');
  await page.waitForSelector('.ac-toast__b--ok', { timeout: 10000 });
  await sleep(200);

  const other = await open('/black-theatre/', { context: ctx });
  await badge(other.page);
  await other.page.waitForFunction(() => { const i = document.querySelector('.acct-badge img'); return i && i.complete && i.naturalWidth === 256; }, { timeout: 8000 });
  assert.ok(!other.calls.includes('/v1/account/avatar'), 'drawn from this device');
  await sleep(3200);
  await other.page.screenshot({ path: SHOTS + 'photo-page-mobile.png' });
  await other.page.close();

  await page.bringToFront();
  await sleep(400);
  await page.click('.ac-hero .ac-arch');
  await page.waitForSelector('[data-photo-delete]');
  await page.click('[data-photo-delete]');
  await page.waitForSelector('[data-photo-delete-yes]');
  await page.click('[data-photo-delete-yes]');
  await page.waitForSelector('.ac-hero .ac-arch__initial', { timeout: 8000 });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('athanasios.account.face.v1')).photo), '');

  await sleep(500);
  await page.$eval('.ac-signout--m', n => n.scrollIntoView({ block: 'center' }));
  await sleep(100);
  await page.click('.ac-signout--m');
  await page.waitForSelector('#acct-email', { timeout: 8000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('athanasios.account.face.v1')), null, 'gone with the session');
  await page.goto(LOCAL + '/black-theatre/', { waitUntil: 'domcontentloaded' });
  await badge(page);
  assert.equal(await label(page), 'سجّل دخولك');
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('a shared device: the icon\'s memory stays in the tab, a new tab is signed out', async () => {
  const m = await member();
  const { page, ctx } = await open('/account/');
  await signIn(page, m, { shared: true });
  await page.waitForSelector('[data-home]', { timeout: 10000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('athanasios.account.face.v1')), null);
  assert.ok(await page.evaluate(() => sessionStorage.getItem('athanasios.account.face.v1')));
  await page.goto(LOCAL + '/black-theatre/', { waitUntil: 'domcontentloaded' });
  await badge(page);
  assert.equal(await label(page), 'حسابي: مارك');
  const fresh = await open('/black-theatre/', { context: ctx });
  await badge(fresh.page);
  assert.equal(await label(fresh.page), 'سجّل دخولك');
  await ctx.close();
});

test('a session that ended: the icon opens the account, which asks; then back to where they asked from', async () => {
  const m = await member();
  const { page, ctx } = await open('/account/');
  await signIn(page, m);
  await page.waitForSelector('[data-home]', { timeout: 10000 });
  await h.db.prepare('UPDATE account_sessions SET revoked_at = ?').bind(Date.now()).run();
  await page.goto(LOCAL + '/points/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => location.pathname === '/account/', { timeout: 15000 });
  await page.waitForSelector('[data-continue]', { timeout: 10000 });
  await page.click('[data-continue]');
  await page.waitForSelector('#acct-password');
  await set(page, '#acct-password', m.password);
  await page.$eval('form', f => f.requestSubmit());
  await page.waitForFunction(() => location.pathname === '/points/', { timeout: 10000 });
  await ctx.close();
});

test('a link from outside the site can\'t set where they return: a bad value goes to the account', async () => {
  const m = await member();
  const { page, ctx } = await open('/account/');
  await page.evaluate(() => sessionStorage.setItem('athanasios.account.return.v1', 'https://evil.example/'));
  await signIn(page, m);
  await page.waitForSelector('[data-home]', { timeout: 10000 });
  assert.equal(await page.evaluate(() => location.origin + location.pathname), LOCAL + '/account/');
  await ctx.close();
});

test('not in a frame; the account switched off hides it', async () => {
  const { page, ctx } = await open('/black-theatre/');
  await badge(page);
  await page.evaluate(() => {
    const f = document.createElement('iframe');
    f.src = '/black-theatre/';
    f.id = 'f';
    document.body.append(f);
  });
  await sleep(1200);
  const frame = await (await page.$('#f')).contentFrame();
  assert.equal(await frame.$('.acct-badge'), null);
  await page.evaluate(() => localStorage.setItem('athanasios.account.mode.v1', 'off'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1200);
  assert.equal(await page.$('.acct-badge'), null);
  await ctx.close();
});

test('every header at every width: fits, one row, 44px, RTL', async () => {
  for (const path of ['/', '/black-theatre/', '/points/']) {
    for (const width of [320, 360, 390, 820, 1280]) {
      const { page, ctx, problems } = await open(path === '/points/' ? '/account/' : path, { width, height: 800 });
      if (path === '/points/') {
        await signIn(page, await member());
        await page.waitForSelector('[data-home]', { timeout: 10000 });
        await page.goto(LOCAL + path, { waitUntil: 'domcontentloaded' });
      }
      await badge(page);
      await sleep(3200);
      const r = await page.evaluate(() => {
        const a = document.querySelector('.acct-badge');
        const box = a.getBoundingClientRect();
        const bar = a.closest('.topbar, .pbar, .cbar');
        const items = [...bar.querySelectorAll('a, button')].filter(n => n.offsetParent).map(n => n.getBoundingClientRect());
        return { w: box.width, h: box.height, left: box.left, right: box.right, inner: innerWidth, over: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: document.documentElement.dir,
          overlap: items.some((x, i) => items.some((y, j) => i < j && x.left < y.right - 1 && y.left < x.right - 1 && x.top < y.bottom - 1 && y.top < x.bottom - 1)) };
      });
      const name = path + ' at ' + width + ': ' + JSON.stringify(r);
      assert.ok(r.w >= 44 && r.h >= 44, name);
      assert.ok(r.left >= 0 && r.right <= r.inner, name);
      assert.ok(r.over <= 0, name);
      assert.equal(r.overlap, false, name);
      assert.equal(r.dir, 'rtl', name);
      assert.deepEqual(problems, [], name);
      if (width === 360 || width === 1280) await page.screenshot({ path: SHOTS + `${path.replace(/\W/g, '') || 'home'}-${width}.png` });
      await ctx.close();
    }
  }
});
