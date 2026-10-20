// «الصلاحيات» in the real admin (Chrome): the list from D1 (a fake of the
// Worker's /v1/admin/accounts, worker/src/lib/accounts.js), a preset that
// pre-fills the boxes, add / change / remove with Google itself (never the
// panel's wk1 session token), and the Worker's refusals in plain words.
// Run: cd tools && node --test ../tests/accounts-admin.e2e.mjs

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';
import { PERMS, PRESETS, PRIMARY_DEFAULT } from '../worker/src/lib/perms.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4743;
const LOCAL = `http://127.0.0.1:${PORT}`;
const WORKER_URL = 'https://athanasios-api.menazak-lab.workers.dev';
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'fady.youssef@gmail.com';
const NEW = 'new.servant@gmail.com';
const SHOTS = `${ROOT}tools/.cache/accounts-admin/`;
const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 4000, render: 8000, beat: 900, beatFail: 2500 };
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

let world, server, browser;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* the Worker's accounts routes, in memory (only the shapes and refusals the screen reacts to) */
const fake = {
  calls: [],
  admins: [],
  reset() {
    this.calls = [];
    this.admins = [
      { email: ADMIN, name: '', primary: true, active: true, servantId: null, lastSeen: null, grants: {} },
      { email: SECOND, name: '', primary: false, active: true, servantId: null, lastSeen: null, grants: { 'bookings.view': 'all' } }
    ];
  },
  listing() {
    return { ok: true, me: ADMIN, canManage: true, enforce: false, max: 20, perms: PERMS, primaryDefault: PRIMARY_DEFAULT, presets: PRESETS, admins: this.admins };
  }
};

const cors = { 'access-control-allow-origin': LOCAL };
const json = (status, body) => ({ status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });

async function handle(request) {
  const url = new URL(request.url());
  if (url.origin !== WORKER_URL) return null;
  const method = request.method();
  if (method === 'OPTIONS') {
    return { status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'authorization, content-type, idempotency-key, accept, x-edit-session' }, body: '' };
  }
  const auth = request.headers().authorization || '';
  const body = request.postData() ? JSON.parse(request.postData()) : null;
  fake.calls.push({ method, path: url.pathname, body, auth });
  if (url.pathname === '/v1/admin/book/module') return json(200, { ok: true, on: false, env: 'production' });
  if (url.pathname === '/v1/admin/accounts' && method === 'GET') return json(200, fake.listing());
  if (method === 'POST' && url.pathname.startsWith('/v1/admin/accounts')) {
    // like the Worker: changes need a Google ID token, never the panel's session token
    if (/^Bearer wk1\./.test(auth)) return json(403, { ok: false, code: 'google', message: 'محتاجين نتأكد إنه انت.' });
    const m = /^\/v1\/admin\/accounts(?:\/([^/]+))?(\/remove)?$/.exec(url.pathname);
    const email = m[1] ? decodeURIComponent(m[1]) : body.email;
    if (email === ADMIN) return json(403, { ok: false, code: 'protected', reason: 'primary', message: 'التغيير ده مش مسموح.' });
    if (m[2]) fake.admins = fake.admins.filter(a => a.email !== email);
    else if (m[1]) Object.assign(fake.admins.find(a => a.email === email), { grants: body.grants, servantId: body.servantId });
    else fake.admins.push({ email, name: '', primary: false, active: true, servantId: body.servantId, lastSeen: null, grants: body.grants });
    return json(200, fake.listing());
  }
  return json(404, { ok: false, code: 'notfound', message: 'الطلب ده مش معروف.' });
}

function freshWorld() {
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', `${SITE}/`);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  world.properties.set('WORKER_SYNC_SECRET', 's'.repeat(48));
  world.properties.set('ADMIN_NAMES', JSON.stringify({ [ADMIN]: 'مينا زكريا', [SECOND]: 'فادي يوسف' }));
  world.gs.SESSION_STALE_SECONDS = 0;
  world.as('');
}

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  freshWorld();
  server = createSiteServer({
    world: { issueToken: c => world.issueToken(c), get github() { return world.github; } },
    config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK, timing: TIMING, workerUrl: WORKER_URL }),
    claims: () => ({ email: ADMIN })
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => (server ? server.close(resolve) : resolve()));
});

async function openSettings(viewport = { width: 1366, height: 900 }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  await page.setViewport(viewport);
  await interceptGoogle(page, { post: body => world.post(body) }, { handle, outside: [] });
  await page.goto(`${LOCAL}/admin/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
  await page.evaluate(() => A.go('settings'));
  await page.waitForFunction(() => document.querySelectorAll('.card--admins .admin').length === 2 && /صلاحية واحدة/.test(document.querySelector('.card--admins').innerText), { timeout: 8000 });
  return { context, page, problems };
}

const cardText = page => page.$eval('.card--admins', n => n.innerText);
async function clickDialogButton(page, label) {
  await page.waitForFunction(text => [...document.querySelectorAll('dialog.modal .btn')].some(b => b.textContent.trim() === text), { timeout: 5000 }, label);
  await page.evaluate(text => [...document.querySelectorAll('dialog.modal .btn')].find(b => b.textContent.trim() === text).click(), label);
}

test('«الصلاحيات»: list from D1, add with a preset, change, remove — Google ID token for every change; the Primary locked', async () => {
  fake.reset();
  const { context, page, problems } = await openSettings();
  const text = await cardText(page);
  assert.match(text, /الصلاحيات/);
  assert.match(text, /الحساب الأساسي/, 'the Primary is marked');
  assert.match(text, /صلاحية واحدة/, 'the second admin: their grants count');
  assert.equal(await page.$$eval('.card--admins .admin--primary .icon-btn--danger', n => n.length), 0, 'the Primary has no remove button');

  // add, starting from the «خادم – حجوزات» preset
  await page.type('.card--admins .admins__add input', NEW);
  await page.click('.card--admins .admins__add .btn--primary');
  await page.waitForSelector('dialog.modal .grants');
  await page.evaluate(label => [...document.querySelectorAll('dialog.modal .choice')].find(c => c.textContent.trim() === label).click(), PRESETS.servant_bookings.label);
  await sleep(200);
  await page.screenshot({ path: `${SHOTS}add-preset.png` });
  await clickDialogButton(page, 'ضيف');
  await page.waitForFunction(email => document.querySelectorAll('.card--admins .admin').length === 3 && document.querySelector('.card--admins').innerText.includes(email), { timeout: 8000 }, NEW);
  const added = fake.calls.find(c => c.method === 'POST' && c.path === '/v1/admin/accounts');
  assert.deepEqual(added.body.grants, PRESETS.servant_bookings.grants, 'the preset pre-filled exactly its boxes (own scope kept)');
  assert.equal(added.body.email, NEW);
  assert.doesNotMatch(added.auth, /^Bearer wk1\./, 'a change goes with Google itself');
  assert.match(await cardText(page), new RegExp(PRESETS.servant_bookings.label));

  // change the second admin: add «يشوف · الفلوس»
  await page.click(`.card--admins .admin[data-email="${SECOND}"] [title="الصلاحيات"]`);
  await page.waitForSelector('dialog.modal .grants');
  await page.evaluate(() => {
    const group = [...document.querySelectorAll('dialog.modal .grants__group')].find(g => g.querySelector('legend').textContent === 'الفلوس');
    group.querySelector('input[type=checkbox]').click();
  });
  await clickDialogButton(page, 'احفظ الصلاحيات');
  await page.waitForFunction(() => /صلاحيتين/.test(document.querySelector('.card--admins').innerText), { timeout: 8000 });
  const changed = fake.calls.find(c => c.path === `/v1/admin/accounts/${encodeURIComponent(SECOND)}`);
  assert.deepEqual(changed.body.grants, { 'bookings.view': 'all', 'finance.view': 'all' });

  // remove the new one
  await page.click(`.card--admins .admin[data-email="${NEW}"] .icon-btn--danger`);
  await clickDialogButton(page, 'شيل الصلاحية');
  await page.waitForFunction(() => document.querySelectorAll('.card--admins .admin').length === 2, { timeout: 8000 });
  assert.ok(fake.calls.some(c => c.path === `/v1/admin/accounts/${encodeURIComponent(NEW)}/remove`));

  await page.screenshot({ path: `${SHOTS}after.png` });
  assert.deepEqual(problems, []);
  await context.close();
});

test('«الصلاحيات» on a phone: the grants form scrolls inside the dialog, no page overflow', async () => {
  fake.reset();
  const { context, page, problems } = await openSettings({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.click(`.card--admins .admin[data-email="${SECOND}"] [title="الصلاحيات"]`);
  await page.waitForSelector('dialog.modal .grants');
  await sleep(300);
  const fit = await page.evaluate(() => {
    const d = document.querySelector('dialog.modal');
    const r = d.getBoundingClientRect();
    return { inside: r.left >= 0 && r.right <= innerWidth + 1, overflowX: document.documentElement.scrollWidth > innerWidth + 1, scrolls: getComputedStyle(d.querySelector('.grants')).overflowY };
  });
  await page.screenshot({ path: `${SHOTS}phone-grants.png` });
  assert.deepEqual(fit, { inside: true, overflowX: false, scrolls: 'auto' });
  assert.deepEqual(problems, []);
  await context.close();
});
