// Phase 4 P4-7 in a real browser (docs/CONTENT-MIGRATION-PLAN.md §12): the official admin with the
// content drafts on the Worker (settings.CONTENT_DRAFTS = '1'). The REAL Worker (worker/src/index.js on
// SQLite, the same migrations) answers the session AND the content calls; the fake Apps Script world
// holds the Sheets the copy came from.
//
//  - the panel opens from the Worker (apiState there), timed
//  - a save goes to the Worker (D1 changes, the Sheets don't: one writer)
//  - «راجع وانشر»: the review computed in the page (admin/review-kit.js), 3 steps, publish live at once
//  - the switch back (rollback): after a reload the content calls go to Apps Script again
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/content-worker.e2e.mjs

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { generateKeyPairSync, createSign, createHmac } from 'node:crypto';
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

const PORT = 4612;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN_URL = `${SITE}/admin/`;
const WORKER_URL = 'https://athanasios-api.menazak-lab.workers.dev';
const ADMIN = 'menazakmena@gmail.com';
const SECRET = 's'.repeat(48);
const DESKTOP = { width: 1440, height: 900 };
const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 8000, render: 8000, beat: 900, beatFail: 2500 };
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(existsSync);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e', alg: 'RS256', use: 'sig' };
const jwksFetch = async url => {
  if (url !== GOOGLE_JWKS_URL) throw new Error('unexpected fetch ' + url);
  return new Response(JSON.stringify({ keys: [JWK] }), { headers: { 'cache-control': 'max-age=3600' } });
};

let world, env, server, browser;
const workerCalls = [];

function issueToken(c) {
  const now = Math.floor(Date.now() / 1000);
  const full = { iss: 'https://accounts.google.com', aud: TEST_CLIENT, azp: TEST_CLIENT, sub: 'sub-' + c.email, email: c.email, email_verified: true, name: c.email.split('@')[0], iat: now, exp: now + 3600 };
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = b64({ alg: 'RS256', kid: 'e2e', typ: 'JWT' }) + '.' + b64(full);
  const token = head + '.' + createSign('RSA-SHA256').update(head).sign(privateKey).toString('base64url');
  world.idTokens.set(token, Object.fromEntries(Object.entries(full).map(([k, v]) => [k, typeof v === 'number' || typeof v === 'boolean' ? String(v) : v])));
  return token;
}

async function call(path, init) {
  const waits = [];
  const res = await workerHandle(new Request(WORKER_URL + path, init), env, { waitUntil: p => waits.push(p) }, { fetch: jwksFetch });
  await Promise.all(waits);
  return res;
}

async function freshWorld() {
  resetAuthCaches();
  env = {
    ENVIRONMENT: 'test', ALLOWED_ORIGINS: SITE, GOOGLE_CLIENT_ID: TEST_CLIENT, LOG_SALT: 'salt', ADMIN_EMAILS: '', SYNC_SECRET: SECRET,
    DEVICE_KEY: 'k'.repeat(48), DB: migratedDb(), JOBS: { send: async () => {} }, COMPS_SOURCE: 'none', SITE_URL: SITE
  };
  env.DB.raw.exec(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${ADMIN}', 'مينا', 'primary', 1, 0);
    UPDATE settings SET value = '1' WHERE key = 'ADMIN_PLATFORM';`);
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('SITE_URL', `${SITE}/`);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.properties.set('ADMIN_EMAILS', ADMIN);
  world.gs.apiSaveItem('news', { id: 'news-aaaa1111', title: 'رحلة الغردقة', summary: 'سجّل اسمك' });
  world.as('');
  world.properties.set('WORKER_SYNC_SECRET', SECRET);
  world.properties.set('ADMIN_PLATFORM', 'worker');
  world.gs.API_REQUEST_ = null;
  // the copy Sheets → D1, then the switch (the cutover's two steps)
  const raw = JSON.stringify({ mode: 'apply', ...JSON.parse(JSON.stringify(world.gs.contentExportPayload_())) });
  const ts = String(Date.now());
  const sig = 'v1=' + createHmac('sha256', SECRET).update(ts + '.' + raw).digest('hex');
  const imp = await call('/v1/sync/content-import', { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': sig } });
  assert.equal((await imp.json()).state, 'ok');
  env.DB.raw.exec("UPDATE settings SET value = '1' WHERE key = 'CONTENT_DRAFTS'");
}

async function worker(request) {
  if (!request.url().startsWith(WORKER_URL + '/')) return null;
  const init = { method: request.method(), headers: request.headers() };
  if (request.method() !== 'GET' && request.method() !== 'HEAD' && request.method() !== 'OPTIONS') {
    init.body = request.postData() ?? (request.hasPostData() ? await request.fetchPostData() : undefined);
    if (request.url().endsWith('/v1/admin/content/call')) { try { workerCalls.push(JSON.parse(init.body).fn); } catch { /* not JSON */ } }
  }
  if (request.url().includes('/v1/admin/content/review-input')) workerCalls.push('review-input');
  const res = await call(request.url().slice(WORKER_URL.length), init);
  if (process.env.E2E_DEBUG) console.log('worker', request.method(), request.url().slice(WORKER_URL.length), res.status, res.status >= 400 ? (await res.clone().text()).slice(0, 300) : '');
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) };
}

test.before(async () => {
  await freshWorld();
  server = createSiteServer({
    world: { issueToken: c => issueToken(c), get github() { return world.github; } },
    config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK, timing: TIMING, workerUrl: WORKER_URL, platform: 'worker' }),
    claims: () => ({ email: ADMIN })
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => (server ? server.close(resolve) : resolve()));
});

async function open() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  const calls = [];
  await interceptGoogle(page, { post: body => world.post(body) }, { site: { origin: SITE, local: LOCAL }, handle: worker, calls });
  await page.setViewport(DESKTOP);
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle0' });
  return { page, problems, get appsScript() { return calls.map(c => c.fn); }, close: () => context.close() };
}

async function signedIn(page) {
  const t0 = Date.now();
  await page.waitForSelector('.gate[data-state="signin"] .gis-stub');
  await page.click('.gis-stub');
  try {
    await page.waitForFunction(() => window.A && A.state && A.state.draft && !document.getElementById('shell').hidden && document.getElementById('gate').hidden, { timeout: 15000 });
  } catch (err) {
    if (process.env.E2E_DEBUG) console.log('gate', await page.evaluate(() => JSON.stringify({ gate: document.getElementById('gate').dataset, text: document.getElementById('gate').textContent.slice(0, 300) })));
    throw err;
  }
  return Date.now() - t0;
}

test('content on the Worker: the panel, a save, the review in the page (3 steps), the publish live at once; the switch back', async () => {
  const s = await open();
  const ms = await signedIn(s.page);
  console.log('sign-in → panel ms', ms);
  assert.ok(workerCalls.includes('apiState'), 'the panel state came from the Worker');
  assert.equal(await s.page.evaluate(() => A.state.platform.content), 'worker');
  assert.equal(await s.page.evaluate(() => A.state.status.mode), 'worker');

  // a save: the Worker's D1 changes, the Sheets don't
  await s.page.evaluate(() => A.go('content', 'news').then(() => A.editors.news(A.state.draft.news.find(n => n.id === 'news-aaaa1111'))));
  await s.page.waitForSelector('dialog.sheet[open] .sheet__foot .btn--primary');
  // the editor's first field is the title
  await s.page.click('dialog.sheet[open] input', { clickCount: 3 });
  await s.page.type('dialog.sheet[open] input', 'رحلة الغردقة — اتغيرت');
  await s.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await s.page.waitForFunction(() => A.state.draft.news.some(n => n.title === 'رحلة الغردقة — اتغيرت'), { timeout: 10000 });
  assert.ok(workerCalls.includes('apiSaveItem'));
  const d1 = env.DB.raw.prepare("SELECT json_extract(data, '$.title') AS t FROM draft_rows WHERE kind = 'news' AND id = 'news-aaaa1111'").get();
  assert.equal(d1.t, 'رحلة الغردقة — اتغيرت');
  assert.equal(JSON.parse(JSON.stringify(world.gs.readOptionalTable_('News'))).find(n => n.id === 'news-aaaa1111').title, 'رحلة الغردقة', 'the Sheets are not written');
  assert.ok(!s.appsScript.includes('apiSaveItem'), 'no content write to Apps Script');

  // «راجع وانشر»: 3 steps, the review computed here (review-input + the kit), then the publish
  await s.page.evaluate(() => A.closeSheet && A.closeSheet());
  await s.page.click('#publish-open');
  await s.page.waitForSelector('dialog.sheet[open] .stepper[data-publish]');
  await s.page.waitForFunction(() => document.querySelector('dialog.sheet[open] .review-groups, dialog.sheet[open] .empty-state'), { timeout: 10000 });
  const steps = await s.page.$$eval('dialog.sheet[open] .stepper__label', els => els.map(e => e.textContent));
  assert.deepEqual(steps, ['مراجعة', 'نشر', 'ظهر على الموقع']);
  assert.ok(workerCalls.includes('review-input'), 'the review was computed in the page');
  assert.ok(!workerCalls.includes('apiReview'), 'no server review needed');
  const t0 = Date.now();
  await s.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await s.page.waitForFunction(() => {
    const done = document.querySelectorAll('dialog.sheet[open] .stepper__step.is-done');
    return done.length === 2 && document.querySelector('dialog.sheet[open] .stepper__step.is-current .stepper__label, dialog.sheet[open] .stepper__step:last-child.is-done');
  }, { timeout: 10000 });
  console.log('publish click → live ms', Date.now() - t0);
  const live = env.DB.raw.prepare("SELECT body FROM published_revisions WHERE live = 1 AND kind = 'content'").get();
  assert.ok(live && live.body.includes('رحلة الغردقة — اتغيرت'), 'live in D1 at once');
  assert.ok(!(await s.page.$eval('dialog.sheet[open]', el => el.textContent)).includes('GitHub Pages'), 'no GitHub Pages wait in the dialog');
  assert.deepEqual(s.problems, []);
  await s.close();

  // rollback: the switch back to the Sheets → after a reload the content calls go to Apps Script
  env.DB.raw.exec("UPDATE settings SET value = '0' WHERE key = 'CONTENT_DRAFTS'; DELETE FROM admin_sessions;");
  workerCalls.length = 0;
  const r = await open();
  await signedIn(r.page);
  assert.equal(await r.page.evaluate(() => A.state.platform.content), 'sheets');
  assert.ok(r.appsScript.includes('apiState'), 'the state from Apps Script again');
  assert.ok(!workerCalls.includes('apiState'));
  await r.close();
});

test('competitions on the Worker: the list, a new one with a question, in the review, published: Apps Script is never asked', async () => {
  await freshWorld();
  env.COMPS_SOURCE = '';
  env.DB.raw.exec("INSERT INTO settings (key, value, updated_at) VALUES ('COMP_DRAFTS', 'worker', 0), ('COMP_HASH_KEY', 'a2V5LWtleS1rZXkta2V5LWtleS1rZXk=', 0), ('COMP_REGISTRY', '1', 0), ('COMP_WALLET', '1', 0), ('BOOKING_ONLINE', '1', 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value; DELETE FROM admin_sessions;");
  workerCalls.length = 0;
  const s = await open();
  await signedIn(s.page);
  await s.page.evaluate(() => A.go('comps', 'comps'));
  await s.page.waitForFunction(() => document.getElementById('view') && !document.querySelector('#view .skeleton-list'), { timeout: 10000 });
  assert.ok(workerCalls.includes('apiComps'), 'the list came from the Worker');

  // the site is already live: the review then lists what changed
  await s.page.evaluate(() => A.call('apiReview').then(r => A.call('apiPublish', r.revision)));

  const start = await s.page.evaluate(() => A.call('apiCompCreate', { preset: 'scored', title: 'مسابقة نقاط', slug: 'msabqa-nqat', enabled: true, participation: 'registered', wallet: true, showPoints: true, startAt: '2026-01-01 10:00', endAt: '2036-01-01 10:00' }));
  await s.page.evaluate(id => A.call('apiCompQuestionSave', id, { type: 'truefalse', text: 'صح؟', correct: 'صح', points: 5 }), start.comp.id);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM draft_rows WHERE kind = 'questions'").get().n, 1, 'in D1');

  await s.page.evaluate(() => A.refresh ? A.refresh() : null);
  await s.page.click('#publish-open');
  await s.page.waitForSelector('dialog.sheet[open] .stepper[data-publish]');
  await s.page.waitForFunction(() => document.querySelector('dialog.sheet[open] .review-groups'), { timeout: 15000 });
  assert.ok(workerCalls.includes('apiReview'), 'the Worker\'s review: the answers stay on the server');
  assert.deepEqual(await s.page.$eval('dialog.sheet[open]', el => el.textContent.includes('مسابقة نقاط')), true, 'it is among the changes');
  await s.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await s.page.waitForFunction(() => document.querySelectorAll('dialog.sheet[open] .stepper__step.is-done').length === 2, { timeout: 15000 });
  const live = env.DB.raw.prepare('SELECT slug, version FROM comp_live').get();
  assert.equal(live.slug, 'msabqa-nqat');
  const row = JSON.parse(env.DB.raw.prepare("SELECT data FROM draft_rows WHERE kind = 'competitions'").get().data);
  assert.equal(row.liveVersion, live.version);
  assert.deepEqual(s.appsScript.filter(fn => /^apiComp|apiReview|apiPublish/.test(fn)), [], 'none of it went to Apps Script');
  assert.deepEqual(s.problems, []);
  await s.close();
});
