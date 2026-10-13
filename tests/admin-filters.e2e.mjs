// Admin list filters stay instant and never queue requests: Participants
// filter / search / sort / page locally (one load), and server-paged lists
// (store requests, submissions, points, activity) keep ONE request in flight
// with the newest filters winning (A.latest). Regression for «quick filter
// clicks lag or hang».

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4683;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN = 'menazakmena@gmail.com';
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);
const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 4000, render: 8000, beat: 900, beatFail: 2500 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let world;
let server;
let browser;
let page;
const calls = [];
// every API answer waits this long (like a real Apps Script round trip)
let delay = 0;

const gs = new Proxy({}, { get: (_, name) => (...args) => JSON.parse(JSON.stringify(world.as(ADMIN).gs[name](...args)) ?? null) });

test.before(async () => {
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', `${SITE}/`);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.properties.set('ADMIN_EMAILS', ADMIN);
  world.gs.SESSION_STALE_SECONDS = 0;
  gs.apiCompSettings({ registry: true, wallet: true, shop: true });
  const year = new Date(world.now()).getUTCFullYear();
  for (let i = 0; i < 40; i++) {
    const p = gs.apiParticipantSave({ name: `مشارك رقم ${i} اسم`, phone: '0101234' + String(i).padStart(4, '0'), group: i % 2 ? 'ثانوي' : 'جامعة', birthDate: `${year - (i % 3 ? 22 : 40)}-01-15` }).participant;
    if (i % 4 === 0) gs.apiParticipantSetActive(p.id, false);
  }
  world.as('');
  server = createSiteServer({
    world: { issueToken: c => world.issueToken(c), get github() { return world.github; } },
    config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK, timing: TIMING }),
    claims: () => ({ email: ADMIN })
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await interceptGoogle(page, { post: async body => {
    calls.push((typeof body === 'string' ? JSON.parse(body || '{}') : body).fn);
    if (delay) await sleep(delay);
    return world.post(body);
  } });
  await page.goto(`${LOCAL}/admin/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => (server ? server.close(resolve) : resolve()));
});

const count = fn => calls.filter(c => c === fn).length;
const rows = () => page.$$eval('.comp-subs .comp-person', n => n.length);

test('participants: one load; every chip, search, group and page is local and instant', async () => {
  delay = 400;
  await page.evaluate(() => A.go('comps', 'people'));
  await page.waitForSelector('.comp-subs .comp-person', { timeout: 15000 });
  await page.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
  const before = count('apiParticipants');
  assert.ok(before >= 1);

  // 12 quick clicks across the chips: no request at all, the last choice shows at once
  const started = Date.now();
  for (const chip of ['active', 'inactive', 'all', 'active', 'inactive', 'all', 'inactive', 'active', 'all', 'inactive', 'all', 'inactive']) {
    await page.$eval(`.filter-chip[data-status="${chip}"]`, n => n.click());
  }
  const pressed = await page.$eval('.filter-chip[data-status="inactive"]', n => n.getAttribute('aria-pressed'));
  assert.equal(pressed, 'true');
  assert.equal(await rows(), 10, 'every 4th of 40 is inactive');
  assert.ok(Date.now() - started < 2000, 'instant (no round trips)');

  await page.$eval('.filter-chip[data-eligibility="out"]', n => n.click());
  assert.ok(await rows() > 0);
  await page.$eval('.filter-chip[data-eligibility="all"]', n => n.click());
  await page.$eval('.filter-chip[data-status="all"]', n => n.click());

  // search: Arabic digits / name, locally
  await page.$eval('.comp-subs__tools input[type=search]', n => { n.value = 'رقم ١٢'; n.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => document.querySelectorAll('.comp-subs .comp-person').length === 1, { timeout: 3000 });
  await page.$eval('.comp-subs__tools input[type=search]', n => { n.value = ''; n.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => document.querySelectorAll('.comp-subs .comp-person').length === 40, { timeout: 3000 });

  assert.equal(count('apiParticipants'), before, 'no server call for any filter, search or page');
  delay = 0;
});

test('store requests and other server-paged lists: rapid chip clicks → at most two requests, the newest choice wins', async () => {
  delay = 500;
  await page.evaluate(() => A.go('comps', 'shop'));
  await page.waitForSelector('.filter-chip[data-status="all"]', { timeout: 15000 });
  await page.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
  const before = count('apiShopRedemptions');
  for (const chip of ['pending', 'approved', 'fulfilled', 'cancelled', 'all', 'pending', 'cancelled']) {
    await page.$eval(`.filter-chip[data-status="${chip}"]`, n => n.click());
  }
  assert.equal(await page.$eval('.filter-chip[data-status="cancelled"]', n => n.getAttribute('aria-pressed')), 'true', 'the pressed chip moved at once');
  await page.waitForNetworkIdle({ idleTime: 700, timeout: 15000 }).catch(() => {});
  const made = count('apiShopRedemptions') - before;
  assert.ok(made <= 2, `7 quick clicks made ${made} requests (≤ 2: the one in flight + one with the newest choice)`);
  assert.equal(await page.$eval('.filter-chip[data-status="cancelled"]', n => n.getAttribute('aria-pressed')), 'true', 'the final list is the last choice');
  delay = 0;
});

test('A.latest: one in flight, stale answers dropped, one follow-up with the latest state', async () => {
  const result = await page.evaluate(async () => {
    let n = 0;
    const seen = [];
    let state = 0;
    const go = A.latest(() => { n++; const asked = state; return new Promise(r => setTimeout(() => r(asked), 50)); }, value => seen.push(value));
    for (state = 1; state <= 6; state++) go();
    state = 6;
    await new Promise(r => setTimeout(r, 300));
    return { n, seen };
  });
  assert.equal(result.n, 2);
  assert.deepEqual(result.seen, [6], 'only the newest answer is drawn');
});
