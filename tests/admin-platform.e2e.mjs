// Phase 3 P3-2…P3-6 in a real browser (docs/ADMIN-PLATFORM-PLAN.md): the
// official admin with config.platform = 'worker'. The REAL Worker
// (worker/src/index.js on SQLite, the same migrations) answers the session,
// heartbeat, presence and lock calls; the fake Apps Script world runs the real
// .gs code with ADMIN_PLATFORM = 'worker' (AdminPlatform.gs): it takes the
// Worker's panel token and asks the Worker's D1 about sessions and locks.
//
//  - sign-in: the session is the Worker's, Apps Script only gives the state
//  - presence + edit locks across two admins; a save refused by Apps Script
//    because the Worker says someone else holds the lock
//  - one session per account: question, takeover, the first tab back at the gate
//  - a reload picks the same session up again
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/admin-platform.e2e.mjs

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { generateKeyPairSync, createSign } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';
import { handle as workerHandle } from '../worker/src/index.js';
import { resetAuthCaches, GOOGLE_JWKS_URL } from '../worker/src/lib/auth.js';
import { migratedDb } from '../worker/test/d1-sqlite.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4611;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN_URL = `${SITE}/admin/`;
const WORKER_URL = 'https://athanasios-api.menazak-lab.workers.dev';
const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'second.admin@gmail.com';
const SECRET = 's'.repeat(48);
const DESKTOP = { width: 1440, height: 900 };
const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 5000, render: 8000, beat: 900, beatFail: 2500 };

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(existsSync);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* a stand-in Google: real RS256 tokens the Worker verifies, registered with the fake tokeninfo too */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e', alg: 'RS256', use: 'sig' };
const jwksFetch = async url => {
  if (url !== GOOGLE_JWKS_URL) throw new Error('unexpected fetch ' + url);
  return new Response(JSON.stringify({ keys: [JWK] }), { headers: { 'cache-control': 'max-age=3600' } });
};

let world, env, server, browser, claims;

function issueToken(c) {
  const now = Math.floor(Date.now() / 1000);
  const full = { iss: 'https://accounts.google.com', aud: TEST_CLIENT, azp: TEST_CLIENT, sub: 'sub-' + c.email, email: c.email, email_verified: true, name: c.email.split('@')[0], iat: now, exp: now + 3600 };
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = b64({ alg: 'RS256', kid: 'e2e', typ: 'JWT' }) + '.' + b64(full);
  const token = head + '.' + createSign('RSA-SHA256').update(head).sign(privateKey).toString('base64url');
  world.idTokens.set(token, Object.fromEntries(Object.entries(full).map(([k, v]) => [k, typeof v === 'number' || typeof v === 'boolean' ? String(v) : v])));
  return token;
}

/* Apps Script → POST /v1/sync/session, answered from the Worker's D1 (synchronously, like UrlFetchApp) */
function sessionCheck(options) {
  const body = JSON.parse(Buffer.from(options.payload.map(b => (b < 0 ? b + 256 : b))).toString('utf8'));
  const raw = env.DB.raw;
  const now = Date.now();
  const live = raw.prepare('SELECT sid FROM admin_sessions WHERE email = ?').get(body.email);
  const gone = raw.prepare('SELECT 1 AS x FROM admin_sessions_gone WHERE sid = ?').get(body.sid);
  const state = live && live.sid === body.sid ? 'live' : live || gone ? 'replaced' : 'expired';
  const holders = {};
  const rows = raw.prepare("SELECT l.*, s.device, s.parked_ms, a.name FROM edit_locks l JOIN admin_sessions s ON s.sid = l.sid LEFT JOIN admins a ON a.email = l.email WHERE l.kind <> 'booking'").all()
    .filter(l => body.all === true || (body.locks || []).includes(l.kind + ':' + l.id));
  for (const l of rows) {
    const key = l.kind + ':' + l.id;
    if (l.sid !== body.sid && l.expires_ms > now && !(l.parked_ms != null && now - l.parked_ms >= 45000)) {
      holders[key] = { email: l.email, name: l.name || l.email.split('@')[0], device: l.device, since: Math.round((now - l.since_ms) / 1000) };
    }
  }
  return { status: 200, body: JSON.stringify({ ok: true, state, holders }) };
}

function freshWorld() {
  resetAuthCaches();
  env = {
    ENVIRONMENT: 'test', ALLOWED_ORIGINS: SITE, GOOGLE_CLIENT_ID: TEST_CLIENT, LOG_SALT: 'salt', ADMIN_EMAILS: '', SYNC_SECRET: SECRET,
    DEVICE_KEY: 'k'.repeat(48), DB: migratedDb(), JOBS: { send: async () => {} }
  };
  env.DB.raw.exec(`INSERT INTO admins (email, role, active, created_at) VALUES ('${ADMIN}', 'primary', 1, 0), ('${SECOND}', 'admin', 1, 0);
    UPDATE settings SET value = '1' WHERE key = 'ADMIN_PLATFORM';`);

  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', `${SITE}/`);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  world.gs.apiSaveItem('news', { id: 'news-aaaa1111', title: 'رحلة الغردقة', summary: 'سجّل اسمك' });
  world.gs.apiSaveItem('news', { id: 'news-bbbb2222', title: 'مسابقة الكتاب المقدس', summary: 'كل أسبوع' });
  world.as('');
  world.properties.set('WORKER_SYNC_SECRET', SECRET);
  world.properties.set('ADMIN_PLATFORM', 'worker');
  world.web[WORKER_URL + '/v1/sync/session'] = sessionCheck;
  world.gs.API_REQUEST_ = null;
}

/* the browser's calls to the Worker → the real Worker, in process */
async function worker(request) {
  if (!request.url().startsWith(WORKER_URL + '/')) return null;
  const init = { method: request.method(), headers: request.headers() };
  if (request.method() !== 'GET' && request.method() !== 'HEAD' && request.method() !== 'OPTIONS') {
    init.body = request.postData() ?? (request.hasPostData() ? await request.fetchPostData() : undefined);
  }
  const waits = [];
  const res = await workerHandle(new Request(request.url(), init), env, { waitUntil: p => waits.push(p) }, { fetch: jwksFetch });
  await Promise.all(waits);
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) };
}

test.before(async () => {
  freshWorld();
  claims = { email: ADMIN };
  server = createSiteServer({
    world: { issueToken: c => issueToken(c), get github() { return world.github; } },
    config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK, timing: TIMING, workerUrl: WORKER_URL, platform: 'worker' }),
    claims: () => claims
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => (server ? server.close(resolve) : resolve()));
});

async function device() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  const google = await interceptGoogle(page, { post: body => world.post(body) }, { site: { origin: SITE, local: LOCAL }, handle: worker });
  await page.setViewport(DESKTOP);
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle0' });
  return { page, problems, ...google, close: () => context.close() };
}

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

const sessionOf = email => env.DB.raw.prepare('SELECT * FROM admin_sessions WHERE email = ?').get(email);

test('sign-in: the session is the Worker\'s; Apps Script only gives the state, with the panel token', async () => {
  freshWorld();
  const a = await device();
  await signIn(a.page, ADMIN);
  await inPanel(a.page);
  const fns = a.calls.map(c => c.fn);
  assert.ok(!fns.includes('apiSessionStart') && !fns.includes('apiHeartbeat'), fns.join(','));
  assert.ok(fns.includes('apiState'), fns.join(','));
  const row = sessionOf(ADMIN);
  assert.ok(row && row.sid, 'a D1 session');
  await a.page.waitForFunction(() => true);
  await sleep(2500);
  assert.ok(sessionOf(ADMIN).beats >= 1, 'the Worker heartbeat runs');
  assert.ok(a.calls.map(c => c.fn).includes('apiBadges'), 'the menu numbers still come');
  assert.deepEqual(a.problems, []);
  await a.close();
});

test('presence + edit locks through the Worker; Apps Script refuses the save the Worker says is locked', async () => {
  freshWorld();
  const a = await device();
  await signIn(a.page, ADMIN);
  await inPanel(a.page);
  const b = await device();
  await signIn(b.page, SECOND);
  await inPanel(b.page);

  await openNews(a.page, 'news-aaaa1111');
  await b.page.waitForFunction(() => /بيعدّل خبر «رحلة الغردقة»/.test(document.getElementById('presence').innerText), { timeout: 8000 });
  assert.ok(env.DB.raw.prepare("SELECT 1 FROM edit_locks WHERE kind = 'news' AND id = 'news-aaaa1111'").get(), 'the lock is in D1');

  await openNews(b.page, 'news-aaaa1111');
  await b.page.waitForSelector('dialog.sheet[open] .lock-banner', { timeout: 8000 });
  assert.match(await b.page.$eval('dialog.sheet[open] .lock-banner', n => n.innerText), /menazakmena بيعدّل ده دلوقتي/);

  const refused = await b.page.evaluate(() => A.call('apiSaveItem', 'news', { id: 'news-aaaa1111', title: 'من B', summary: 'x' }).then(() => 'saved', e => A.parseError(e).message));
  assert.match(refused, /menazakmena بيعدّل ده دلوقتي/);
  assert.equal(world.gs.readTable_('News').find(n => n.id === 'news-aaaa1111').title, 'رحلة الغردقة');

  // another item is free: B saves it (Apps Script asked the Worker, nobody holds it)
  await b.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
  const saved = await b.page.evaluate(() => A.call('apiSaveItem', 'news', { id: 'news-bbbb2222', title: 'مسابقة — B', summary: 'كل أسبوع' }).then(() => 'saved', e => A.parseError(e).message));
  assert.equal(saved, 'saved');
  assert.deepEqual([...a.problems, ...b.problems], []);
  await a.close();
  await b.close();
});

test('one session per account: question → takeover → the first tab back at the gate; a reload resumes the same sid', async () => {
  freshWorld();
  const laptop = await device();
  await signIn(laptop.page, ADMIN);
  await inPanel(laptop.page);
  await sleep(1500);

  const phone = await device();
  await signIn(phone.page, ADMIN);
  await phone.page.waitForSelector('.gate[data-state="session-active"]', { timeout: 8000 });
  await phone.page.click('.gate__actions--stack .gate__btn');
  await inPanel(phone.page);
  await laptop.page.waitForSelector('.gate[data-state="revoked"]', { timeout: 8000 });
  assert.ok(env.DB.raw.prepare("SELECT 1 FROM activity WHERE action = 'session.takeover'").get(), 'takeover audited in D1');

  const before = sessionOf(ADMIN).sid;
  await sleep(1200);
  await phone.page.reload({ waitUntil: 'networkidle0' });
  // the restore gate: Google again (the stub needs its button), then the SAME session
  await phone.page.waitForSelector('.gate[data-state="restoring"] .gis-stub', { timeout: 8000 });
  await phone.page.click('.gis-stub');
  await inPanel(phone.page);
  assert.equal(sessionOf(ADMIN).sid, before, 'the same session after a reload');
  assert.deepEqual(phone.problems, []);
  await laptop.close();
  await phone.close();
});

/* ---------------- P3-4: «خليك داخل» with the Worker's trusted devices ---------------- */

const STANDALONE = `(() => { const real = window.matchMedia.bind(window);
  window.matchMedia = q => /display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q); })();`;

async function launch(context) {
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await interceptGoogle(page, { post: body => world.post(body) }, { site: { origin: SITE, local: LOCAL }, handle: worker });
  await page.evaluateOnNewDocument(STANDALONE);
  await page.goto(ADMIN_URL + '?app=admin', { waitUntil: 'networkidle0' });
  return { page, problems };
}

const deviceRows = () => env.DB.raw.prepare('SELECT * FROM admin_devices').all();

test('stay signed in: Google once in the app → the Worker remembers the phone → a relaunch opens the panel with no Google; «خروج» ends it', async () => {
  freshWorld();
  const context = await browser.createBrowserContext();
  const first = await launch(context);
  await signIn(first.page, ADMIN);
  await inPanel(first.page);
  for (let i = 0; i < 40 && !deviceRows().length; i++) await sleep(150);
  assert.equal(deviceRows().length, 1, 'a device credential in D1 after the Google sign-in');
  assert.ok(!Object.keys(Object.fromEntries(world.properties)).some(k => k.startsWith('ADMIN_DEVICE_')), 'nothing in Script Properties');
  await first.page.close();

  const checked = world.tokeninfo.calls;
  const again = await launch(context);
  await inPanel(again.page);
  assert.equal(await again.page.$('.gis-stub'), null, 'no Google button');
  assert.equal(world.tokeninfo.calls, checked, 'no Google token checked by Apps Script');
  assert.equal(sessionOf(ADMIN).device_id, deviceRows()[0].id, 'the session belongs to the device');

  await again.page.evaluate(() => { A.signOut(); });
  await again.page.waitForFunction(() => [...document.querySelectorAll('dialog[open] button')].some(b => b.textContent.includes('تسجيل الخروج')), { timeout: 8000 });
  await again.page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.includes('تسجيل الخروج')).click());
  await again.page.waitForSelector('.gis-stub', { timeout: 15000 });
  assert.equal(deviceRows().length, 0, 'the device is gone in D1');
  assert.equal(sessionOf(ADMIN), undefined, 'the session ended');
  assert.deepEqual([...first.problems, ...again.problems], []);
  await again.page.close();
  await context.close();
});
