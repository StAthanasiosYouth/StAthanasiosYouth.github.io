// Home from the account / «نقاطي» in headless Chrome, over real HTTP: one press on Home always lands on the home
// page, however many sections (#me/…) were opened since the page came from home. Both ways: the browser's
// Navigation API (Chrome, Edge, Safari 26) and the history mark (browsers without it).
// Run: cd tools && node --test ../tests/nav-home.e2e.mjs

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4761;
const LOCAL = `http://localhost:${PORT}`;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find(existsSync);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let site, browser;

test.before(async () => {
  site = createServer((req, res) => {
    let file = normalize(decodeURIComponent(new URL(req.url, LOCAL).pathname));
    if (file.endsWith('\\') || file.endsWith('/')) file += 'index.html';
    try {
      const body = readFileSync(join(ROOT, file));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    }
    catch {
      res.writeHead(404);
      res.end('');
    }
  });
  await new Promise(r => site.listen(PORT, r));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  site?.close();
});

async function walk({ path, sections, noNavigationApi = false, reduced = true }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (noNavigationApi) await page.evaluateOnNewDocument(() => { try { Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }); } catch { /* */ } });
  await page.goto(`${LOCAL}/`, { waitUntil: 'load' });
  await sleep(300);
  // to the account the way a visitor goes: a link on the home page (the referrer is home)
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.evaluate(p => { location.href = p; }, path)]);
  await page.waitForSelector('.cbar__home');
  await sleep(400);
  for (const hash of sections) {
    await page.evaluate(h => { location.hash = h; }, hash);
    await sleep(120);
  }
  const before = await page.evaluate(() => history.length);
  await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 8000 }), page.click('.cbar__home')]);
  await sleep(200);
  const url = new URL(page.url());
  const after = await page.evaluate(() => history.length);
  await ctx.close();
  return { url, before, after };
}

const home = url => url.pathname === '/' || url.pathname === '/index.html';

test('the account: one press on Home after three sections lands on the home page', async () => {
  const { url } = await walk({ path: '/account/', sections: ['#me/profile', '#me/points', '#me/orders'] });
  assert.ok(home(url), `landed on ${url.href}`);
  assert.equal(url.hash, '');
});

test('the account: one press on Home after one section, and with no section', async () => {
  for (const sections of [['#me/points'], []]) {
    const { url } = await walk({ path: '/account/', sections });
    assert.ok(home(url), `${sections.join(',')} → ${url.href}`);
  }
});

test('the account with the leaving motion (no reduced motion): still one press', async () => {
  const { url } = await walk({ path: '/account/', sections: ['#me/profile', '#me/points'], reduced: false });
  assert.ok(home(url), `landed on ${url.href}`);
});

test('«نقاطي»: one press on Home after sections', async () => {
  const { url } = await walk({ path: '/points/', sections: ['#a', '#b', '#c'] });
  assert.ok(home(url), `landed on ${url.href}`);
});

test('a browser without the Navigation API: one press on Home after sections still lands home', async () => {
  for (const sections of [['#me/profile', '#me/points', '#me/orders'], ['#me/points'], []]) {
    const { url } = await walk({ path: '/account/', sections, noNavigationApi: true });
    assert.ok(home(url), `${sections.join(',')} → ${url.href}`);
  }
});

test('Home goes back in history (not a new entry) when it can', async () => {
  const { before, after } = await walk({ path: '/account/', sections: ['#me/profile', '#me/points'] });
  assert.ok(after <= before, `history grew from ${before} to ${after}`);
});
