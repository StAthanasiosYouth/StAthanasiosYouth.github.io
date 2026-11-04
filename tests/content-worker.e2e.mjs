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

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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
import { fakeR2 } from '../worker/test/helpers.mjs';

// the signed-in Google account (Phase 8 A4 signs in another admin)
let who = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
// Phase 7: production's config has no apiUrl; only a rollback section (back to Apps Script) gets the old one
let legacy = false;
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
  who = ADMIN;
  resetAuthCaches();
  env = {
    ENVIRONMENT: 'test', ALLOWED_ORIGINS: SITE, GOOGLE_CLIENT_ID: TEST_CLIENT, LOG_SALT: 'salt', ADMIN_EMAILS: '', SYNC_SECRET: SECRET,
    DEVICE_KEY: 'k'.repeat(48), DB: migratedDb(), JOBS: { send: async () => {} }, COMPS_SOURCE: 'none', SITE_URL: SITE, PROOFS: fakeR2()
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
    // as production's admin/config.js since Phase 7: no apiUrl (Apps Script retired), the Worker alone
    config: () => ({ ...(legacy ? { apiUrl: TEST_API } : {}), clientId: TEST_CLIENT, timing: TIMING, workerUrl: WORKER_URL, platform: 'worker', content: 'worker' }),
    claims: () => ({ email: who })
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
  legacy = true;
  const r = await open();
  await signedIn(r.page);
  assert.equal(await r.page.evaluate(() => A.state.platform.content), 'sheets');
  assert.ok(r.appsScript.includes('apiState'), 'the state from Apps Script again');
  assert.ok(!workerCalls.includes('apiState'));
  await r.close();
  legacy = false;
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

test('the competition screens read seasons and the menu numbers from the Worker, never from Apps Script', async () => {
  await freshWorld();
  env.COMPS_SOURCE = '';
  env.DB.raw.exec("INSERT INTO settings (key, value, updated_at) VALUES ('COMP_DRAFTS', 'worker', 0), ('COMP_HASH_KEY', 'a2V5LWtleS1rZXkta2V5LWtleS1rZXk=', 0), ('COMP_WALLET', '1', 0)");
  env.DB.raw.exec("INSERT INTO seasons (id, name, status, created_ms, updated_ms) VALUES ('sea-summer27', 'موسم الصيف', 'planned', 0, 0)");
  env.DB.raw.exec("INSERT INTO redemptions (id, item_id, item_name, participant_id, season_id, cost, status, request_key, created_ms, updated_ms) VALUES ('r-1', 'i-1', 'جايزة', 'p-1', 'sea-first', 5, 'pending', 'k-1', 0, 0)");
  const s = await open();
  await signedIn(s.page);
  const { names, badges } = await s.page.evaluate(async () => {
    const seasons = await A.comp.seasons(true);
    return { names: seasons.seasons.map(x => x.name), badges: await A.call('apiBadges') };
  });
  assert.ok(names.includes('موسم الصيف'), 'a season made on the Worker reaches the picker');
  assert.equal(badges.shop, 1);
  // a few heartbeats ask for the numbers again
  await new Promise(resolve => setTimeout(resolve, 2 * TIMING.beat));
  assert.deepEqual(s.appsScript.filter(fn => fn === 'apiSeasons' || fn === 'apiBadges'), [], 'none of it went to Apps Script');
  assert.deepEqual(s.problems, []);
  await s.close();
});

test('an admin\'s push devices go to the Worker once the switch says so, and stay on Apps Script before it', async () => {
  await freshWorld();
  const token = 'admin_device_'.padEnd(150, 'z');
  legacy = true;
  const before = await open();
  await signedIn(before.page);
  // only where it goes: this world's Apps Script has no session of the Worker's to accept it
  await before.page.evaluate(() => A.call('apiAdminPushDevices', {}).catch(() => null));
  assert.ok(before.appsScript.includes('apiAdminPushDevices'), 'off: Apps Script (the rollback config)');
  await before.close();
  legacy = false;

  // Phase 7: production's config (no apiUrl) with the switch off: nothing goes to Apps Script, the call fails clearly
  await freshWorld();
  const retired = await open();
  await signedIn(retired.page);
  const failed = await retired.page.evaluate(() => A.call('apiAdminPushDevices', {}).then(() => '', e => e.message));
  assert.match(failed, /Apps Script retired/);
  assert.deepEqual(retired.appsScript, [], 'no request to Apps Script');
  await retired.close();

  // a new world: the closed tab's session would still hold the account
  await freshWorld();
  env.DB.raw.exec("INSERT INTO settings (key, value, updated_at) VALUES ('PUSH_DEVICES', 'worker', 0)");
  const s = await open();
  await signedIn(s.page);
  const on = await s.page.evaluate(t => A.call('apiAdminPushSubscribe', { token: t, platform: 'desktop', device: 'لابتوب' }), token);
  assert.equal(on.on, true);
  assert.equal(on.devices[0].device, 'لابتوب');
  assert.equal(env.DB.raw.prepare('SELECT email FROM push_devices').get().email, ADMIN);
  const listed = await s.page.evaluate(t => A.call('apiAdminPushDevices', { token: t }), token);
  assert.equal(listed.on, true);
  await s.page.evaluate(id => A.call('apiAdminPushRemoveDevice', id), listed.devices[0].id);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM push_devices').get().n, 0);
  assert.deepEqual(s.appsScript.filter(fn => /^apiAdminPush/.test(fn)), [], 'none of it went to Apps Script');
  assert.deepEqual(s.problems, []);
  await s.close();
});

test('Phase 6 Step 5: with production\'s switches, a walk through every area and tab asks Apps Script nothing', async () => {
  await freshWorld();
  Object.assign(env, { PW_PEPPER: 'p', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'o' });
  env.COMPS_SOURCE = '';
  env.DB.raw.exec(`INSERT INTO settings (key, value, updated_at) VALUES ('COMP_DRAFTS', 'worker', 0), ('COMP_HASH_KEY', 'a2V5LWtleS1rZXkta2V5LWtleS1rZXk=', 0), ('COMP_REGISTRY', '1', 0), ('COMP_WALLET', '1', 0), ('COMP_SHOP', '1', 0), ('BOOKING_ONLINE', '1', 0), ('PUSH_DEVICES', 'worker', 0), ('PUSH_SENDER', 'worker', 0)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'; DELETE FROM admin_sessions;`);
  const s = await open();
  await signedIn(s.page);
  // the accounts tab replaces the old points / store ones once the Worker says accounts are on
  await s.page.waitForFunction(() => window.A && A.AREAS.some(a => a.subs && a.subs.some(x => x.key === 'youth')), { timeout: 15000 }).catch(() => {});
  const visited = await s.page.evaluate(async () => {
    const seen = [];
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (const area of A.AREAS) {
      const subs = area.subs && area.subs.length ? area.subs.map(x => x.key) : [null];
      for (const sub of subs) {
        try { await (sub ? A.go(area.key, sub) : A.go(area.key)); } catch (e) { /* a screen that refuses still counts as visited */ }
        await wait(700);
        seen.push(area.key + (sub ? '/' + sub : ''));
      }
    }
    // the settings' own checks, and the push screen
    if (A.push && A.push.open) { try { A.push.open(); await wait(900); A.closeSheet && A.closeSheet(); } catch (e) { /* */ } }
    return seen;
  });
  await new Promise(r => setTimeout(r, 1500));
  console.log('visited', visited.length, visited.join(' '));
  assert.ok(visited.length >= 8, 'every area and tab');
  assert.deepEqual(s.appsScript, [], 'not one call reached Apps Script');
  await s.close();
});

test('Phase 6: closing the panel and opening it again comes back to the area and tab it was on', async () => {
  await freshWorld();
  const s = await open();
  await signedIn(s.page);
  await s.page.evaluate(() => A.go('pages', 'events'));
  await s.page.waitForFunction(() => A.area === 'pages' && A.sub.pages === 'events', { timeout: 8000 });
  // the app is put away (pagehide), then opened again: a new page, so no tab session of its own
  await s.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const context = s.page.browserContext();
  // the app closed: its page is gone and its session with it (a live one would rightly ask before a takeover)
  await s.page.close();
  env.DB.raw.exec('DELETE FROM admin_sessions;');
  const again = await context.newPage();
  const calls = [];
  await interceptGoogle(again, { post: body => world.post(body) }, { site: { origin: SITE, local: LOCAL }, handle: worker, calls });
  await again.setViewport(DESKTOP);
  await again.goto(ADMIN_URL, { waitUntil: 'networkidle0' });
  await signedIn(again);
  await again.waitForFunction(() => A.area === 'pages' && A.sub.pages === 'events', { timeout: 8000 });
  assert.ok(!(await again.evaluate(() => JSON.stringify(localStorage.getItem('athanasios-admin.place')))).includes('news-aaaa1111'), 'the place only, never an item');
  await context.close();
});

test('a kept place whose tab has no screen yet (or none at all) still opens the panel, never a blank one', async () => {
  // owner, 2026-11-03: «لوحة التحكم مظهرتش على الشاشة» after closing the app on «الصفحات والفعاليات»
  for (const place of [{ area: 'pages', sub: {} }, { area: 'pages', sub: { pages: 'bookings' } }, { area: 'pages', sub: { pages: 'nothing' } }]) {
    await freshWorld();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.evaluateOnNewDocument(value => { localStorage.setItem('athanasios-admin.place', value); }, JSON.stringify(place));
    await interceptGoogle(page, { post: body => world.post(body) }, { site: { origin: SITE, local: LOCAL }, handle: worker, calls: [] });
    await page.setViewport(DESKTOP);
    await page.goto(ADMIN_URL, { waitUntil: 'networkidle0' });
    await signedIn(page);
    const shown = await page.evaluate(() => ({ area: A.area, sub: A.sub.pages, children: document.getElementById('view').childElementCount }));
    assert.equal(shown.area, 'pages', JSON.stringify(place));
    assert.ok(shown.children > 0, 'the view has something: ' + JSON.stringify(place));
    assert.ok(['svcpages', 'bookings'].includes(shown.sub), JSON.stringify(shown));
    await context.close();
  }
});


test('Phase 8 A1: «المظهر» — the look shows at once, follows the admin to another device, and is there at the first paint', async () => {
  await freshWorld();
  const s = await open();
  await signedIn(s.page);
  const look = () => s.page.evaluate(() => ['mode', 'theme', 'accent', 'density', 'motion'].map(k => document.documentElement.getAttribute('data-' + k)));
  assert.deepEqual(await look(), ['dark', 'dark', 'gold', 'comfortable', 'full'], 'the family\'s look by default');
  await s.page.evaluate(() => A.go('settings'));
  await s.page.waitForSelector('[data-look-card]');
  const pick = (key, value) => s.page.$eval(`input[data-look="${key}"][value="${value}"]`, i => i.closest('label').click());
  await pick('theme', 'light');
  assert.equal((await look())[0], 'light', 'at once');
  assert.equal(await s.page.$eval('meta[name="theme-color"]', m => m.content), '#edf1f6');
  assert.equal(await s.page.evaluate(() => getComputedStyle(document.body).color), 'rgb(10, 26, 48)', 'the light text');
  await pick('accent', 'azure');
  await pick('density', 'compact');
  await pick('motion', 'lite');
  await s.page.$eval('input[data-look="sound"]', i => i.closest('label').click());
  assert.deepEqual(await look(), ['light', 'light', 'azure', 'compact', 'lite']);
  // nothing marked as unsaved: leaving asks nothing
  assert.equal(await s.page.evaluate(() => !!A.dirty), false);
  // on the server a moment later (the admin's own row), and the device copy is clean
  await s.page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('athanasios-admin.prefs.v1')).dirty === false; } catch { return false; } }, { timeout: 5000 });
  const row = env.DB.raw.prepare('SELECT prefs FROM admin_prefs WHERE email = ?').get(ADMIN);
  assert.deepEqual(JSON.parse(row.prefs), { theme: 'light', accent: 'azure', density: 'compact', motion: 'lite', sound: true });
  // the first paint of the next visit: look.js has put it on <html> before the panel's code runs
  // (the document is parsed, the deferred panel code has not run yet)
  await s.page.evaluateOnNewDocument(() => document.addEventListener('readystatechange', () => { if (document.readyState === 'interactive') window.__early = [document.documentElement.getAttribute('data-mode'), !!window.A]; }));
  await s.page.reload({ waitUntil: 'networkidle0' });
  const early = await s.page.evaluate(() => window.__early);
  assert.deepEqual(early, ['light', false], 'in the right colours before the panel starts');
  assert.deepEqual(s.problems, []);
  await s.close();

  // another device (nothing kept there): the server's copy after the sign-in
  env.DB.raw.exec('DELETE FROM admin_sessions;');
  const other = await open();
  assert.equal(await other.page.evaluate(() => document.documentElement.getAttribute('data-mode')), 'dark', 'a new device starts with the default');
  await signedIn(other.page);
  await other.page.waitForFunction(() => document.documentElement.getAttribute('data-accent') === 'azure', { timeout: 5000 });
  assert.equal(await other.page.evaluate(() => document.documentElement.getAttribute('data-mode')), 'light');
  await other.close();

  // the device's «reduce motion» always wins
  env.DB.raw.exec('DELETE FROM admin_sessions;');
  const calm = await open();
  await calm.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await signedIn(calm.page);
  await calm.page.waitForFunction(() => document.documentElement.getAttribute('data-accent') === 'azure', { timeout: 5000 });
  assert.equal(await calm.page.evaluate(() => document.documentElement.getAttribute('data-motion')), 'off');
  assert.equal(await calm.page.evaluate(() => A.reducedMotion()), true);
  await calm.close();
});


test('Phase 8 A2: the shell — the welcome, the rail in groups with its light and collapse, the palette, the menus, sign-out', async () => {
  await freshWorld();
  const shots = `${ROOT}tools/.cache/phase8-a2/`;
  mkdirSync(shots, { recursive: true });
  const s = await open();
  await s.page.waitForSelector('.gate[data-state="signin"] .gis-stub');
  await s.page.click('.gis-stub');
  // the welcome inside the shell, right after signing in; then it steps aside by itself
  await s.page.waitForSelector('.welcome', { timeout: 15000 });
  await s.page.waitForFunction(() => /أهلاً يا/.test(document.querySelector('.welcome__hello')?.textContent || ''), { timeout: 8000 });
  await s.page.screenshot({ path: `${shots}welcome.png` });
  await s.page.waitForFunction(() => !document.querySelector('.welcome'), { timeout: 6000 });
  await s.page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });

  // the rail: its groups in order, one light under the current area
  const rail = await s.page.evaluate(() => [...document.querySelectorAll('#rail-nav > *')].map(n => n.classList.contains('rail__group') ? '#' + n.textContent : n.dataset.area || 'light'));
  assert.deepEqual(rail, ['light', '#الشغل', 'home', 'comps', 'pages', '#الموقع', 'content', 'page', 'media', '#الفريق', 'activity']);
  await s.page.evaluate(() => A.go('media'));
  await s.page.waitForFunction(() => { const l = document.querySelector('.rail__light'); const c = document.querySelector('#rail-nav .navlink[aria-current="page"]'); return l && c && Math.abs(new DOMMatrix(getComputedStyle(l).transform).m42 - c.offsetTop) < 1; }, { timeout: 4000 });
  // «الإعدادات», collapse and sign-out at the rail's foot; sign-out is red
  assert.deepEqual(await s.page.$$eval('#rail-foot > *', ns => ns.map(n => n.dataset.area || n.className.split(' ').pop())), ['settings', 'navlink--quiet', 'rail__collapse', 'rail__user', 'navlink--out']);
  assert.equal(await s.page.$eval('.navlink--out', b => getComputedStyle(b).color), 'rgb(255, 138, 125)');
  await s.page.click('.rail__collapse');
  assert.equal(await s.page.evaluate(() => document.documentElement.getAttribute('data-rail')), 'closed');
  await sleep(450);
  assert.ok(await s.page.$eval('.rail', r => r.getBoundingClientRect().width) < 100, 'icons only');
  await s.page.screenshot({ path: `${shots}rail-closed.png` });
  await s.page.click('.rail__collapse');
  assert.equal(await s.page.evaluate(() => localStorage.getItem('athanasios-admin.rail')), 'open');

  // the palette: Ctrl K, a few letters, Enter
  await s.page.keyboard.down('Control');
  await s.page.keyboard.press('KeyK');
  await s.page.keyboard.up('Control');
  await s.page.waitForSelector('dialog.palette[open]');
  await s.page.keyboard.type('الاخبار');
  assert.equal(await s.page.$eval('.palette__item[aria-selected="true"] span', n => n.textContent), 'الأخبار', 'the folding finds «الأخبار» from «الاخبار»');
  await s.page.screenshot({ path: `${shots}palette.png` });
  await s.page.keyboard.press('Enter');
  await s.page.waitForFunction(() => A.area === 'content' && A.sub.content === 'news' && !document.querySelector('dialog.palette[open]'), { timeout: 4000 });

  // the account menu: name, «المظهر», the mode, sign-out (red)
  await s.page.click('#acct-open');
  await s.page.waitForSelector('.menu--account:popover-open');
  const items = await s.page.$$eval('.menu--account .menu__item', ns => ns.map(n => n.textContent.trim()));
  assert.deepEqual(items.filter(t => !/افتح الموقع/.test(t)), ['المظهر', 'الوضع الفاتح', 'تسجيل الخروج']);
  await s.page.screenshot({ path: `${shots}account-menu.png` });
  await s.page.click('.menu--account .menu__item:nth-of-type(2)');
  assert.equal(await s.page.evaluate(() => document.documentElement.getAttribute('data-mode')), 'light', 'the mode from the menu');
  // «اللي مستنيك»
  await s.page.click('#bell-open');
  await s.page.waitForSelector('.menu--bell:popover-open');
  await s.page.screenshot({ path: `${shots}bell-light.png` });
  await s.page.keyboard.press('Escape');
  assert.deepEqual(s.problems, []);
  await s.close();

  // phones: four areas and «المزيد», with the rest, the settings and sign-out
  env.DB.raw.exec('DELETE FROM admin_sessions;');
  const p = await open();
  await p.page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await signedIn(p.page);
  await p.page.waitForFunction(() => !document.querySelector('.welcome'), { timeout: 6000 });
  assert.deepEqual(await p.page.$$eval('#dock .dockbtn', ns => ns.map(n => n.dataset.area)), ['home', 'comps', 'pages', 'content', 'more']);
  await p.page.click('#dock [data-area="more"]');
  await p.page.waitForSelector('#sheet[open] .more');
  assert.deepEqual(await p.page.$$eval('.more__item', ns => ns.map(n => n.dataset.area)), ['page', 'media', 'activity', 'settings']);
  assert.ok(await p.page.$('#sheet [data-signout]'), 'sign-out in «المزيد»');
  await p.page.screenshot({ path: `${shots}more-phone.png` });
  await p.page.click('.more__item[data-area="media"]');
  await p.page.waitForFunction(() => A.area === 'media' && !document.getElementById('sheet').open, { timeout: 4000 });
  assert.equal(await p.page.$eval('#dock [data-area="more"]', b => b.getAttribute('aria-current')), 'page', '«المزيد» lit for an area inside it');
  assert.deepEqual(p.problems, []);
  await p.close();
});


test('Phase 8 A3 + A5: typed confirmation, saved/failed on the button, Ctrl+S, the save bar\'s count and way between fields', async () => {
  await freshWorld();
  const shots = `${ROOT}tools/.cache/phase8-a3/`;
  mkdirSync(shots, { recursive: true });
  const s = await open();
  await signedIn(s.page);
  await s.page.waitForFunction(() => !document.querySelector('.welcome'), { timeout: 6000 });

  // what cannot come back asks for the word first
  const asked = s.page.evaluate(() => A.confirm({ title: 'تمسح ٣ حاجات؟', message: 'المسح مش بيرجع.', typed: 'امسح', confirmLabel: 'امسح' }));
  await s.page.waitForSelector('dialog.modal[open] .modal__typed');
  const ok = 'dialog.modal[open] .modal__actions .btn:first-child';
  assert.equal(await s.page.$eval(ok, b => b.disabled), true, 'off until the word');
  await s.page.type('dialog.modal[open] .modal__typed', 'امس');
  assert.equal(await s.page.$eval(ok, b => b.disabled), true);
  await s.page.type('dialog.modal[open] .modal__typed', 'ح');
  assert.equal(await s.page.$eval(ok, b => b.disabled), false);
  assert.match(await s.page.$eval('dialog.modal[open]', d => d.className), /modal--danger/);
  await s.page.screenshot({ path: `${shots}typed-confirm.png` });
  await s.page.click(ok);
  assert.equal(await asked, true);

  // a busy button ends on itself: saved, or failed
  const states = await s.page.evaluate(async () => {
    const b = A.el('button', { class: 'btn', type: 'button', text: 'حفظ' });
    document.getElementById('view').prepend(b);
    await A.withBusy(b, Promise.resolve({ ok: true }));
    const done = b.classList.contains('is-done');
    await A.withBusy(b, Promise.reject(new Error('x'))).catch(() => {});
    const failed = b.classList.contains('is-failed');
    b.remove();
    return [done, failed];
  });
  assert.deepEqual(states, [true, true]);

  // an editor: two fields to fix → the save bar counts them and moves between them; Ctrl+S saves
  await s.page.evaluate(() => A.go('content', 'news'));
  await s.page.waitForSelector('.btn--primary');
  await s.page.evaluate(() => [...document.querySelectorAll('#view .btn--primary')].find(b => /خبر/.test(b.textContent)).click());
  await s.page.waitForSelector('dialog.sheet[open] .field[data-label]');
  const labels = await s.page.$$eval('dialog.sheet[open] .field[data-label]', fs => fs.filter(f => f.offsetParent).map(f => f.dataset.label).slice(0, 2));
  assert.equal(labels.length, 2, JSON.stringify(labels));
  await s.page.evaluate(ls => A.fail(new Error(ls.map(l => l + ' مطلوب').join('\n')), document.querySelector('dialog.sheet[open] .errors')), labels);
  await s.page.waitForSelector('.fix-nav');
  assert.match(await s.page.$eval('.fix-nav__count', n => n.textContent), /^٢ حقول محتاجة تتصلح$/);
  assert.equal(await s.page.evaluate(() => document.activeElement.closest('.field')?.dataset.label), labels[0], 'the first one, focused');
  await s.page.click('.fix-nav .btn:last-child');
  assert.equal(await s.page.evaluate(() => document.activeElement.closest('.field')?.dataset.label), labels[1], 'the next one');
  await s.page.screenshot({ path: `${shots}fix-nav.png` });
  // toggle rows: the words, then the switch
  const toggles = await s.page.$$eval('dialog.sheet[open] .check--toggle', ns => ns.map(n => [n.firstElementChild.tagName, !!n.querySelector('.switch__track')]));
  assert.ok(toggles.every(t => t[0] === 'SPAN' && t[1]), JSON.stringify(toggles));
  // Ctrl+S presses the editor's save
  const pressed = s.page.evaluate(() => new Promise(resolve => {
    const save = [...document.querySelectorAll('dialog.sheet[open] .sheet__foot .btn--primary')].find(b => !b.disabled);
    save.addEventListener('click', e => { e.stopImmediatePropagation(); e.preventDefault(); resolve(true); }, { capture: true, once: true });
  }));
  await s.page.keyboard.down('Control');
  await s.page.keyboard.press('KeyS');
  await s.page.keyboard.up('Control');
  assert.equal(await pressed, true);
  assert.deepEqual(s.problems, []);
  await s.close();
});


test('Phase 8 A4: with PERMS_ENFORCE on, an admin with competitions only lands on «المسابقات», sees only what they may open, and a kept place says «مش متاح لحسابك»', async () => {
  await freshWorld();
  const COMPS = 'comps.servant@example.com';
  env.DB.raw.exec(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${COMPS}', 'بيشوي', 'admin', 1, 0);
    INSERT INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES ('${COMPS}', 'competitions.view', 'all', 't', 0), ('${COMPS}', 'competitions.edit', 'all', 't', 0);
    UPDATE settings SET value = '1' WHERE key = 'PERMS_ENFORCE';`);
  world.properties.set('ADMIN_EMAILS', ADMIN + ',' + COMPS);
  who = COMPS;
  try {
    const s = await open();
    await signedIn(s.page);
    await s.page.waitForFunction(() => A.access && A.area === 'comps', { timeout: 8000 });
    // only what they may open, everywhere
    const rail = await s.page.$$eval('#rail-nav .navlink', ns => ns.map(n => n.dataset.area));
    assert.deepEqual(rail, ['comps']);
    assert.ok(await s.page.$('#rail-foot [data-area="settings"]'), '«الإعدادات» stays (their own look, their devices)');
    await s.page.keyboard.down('Control');
    await s.page.keyboard.press('KeyK');
    await s.page.keyboard.up('Control');
    await s.page.waitForSelector('dialog.palette[open]');
    const found = await s.page.$$eval('.palette__item span', ns => ns.map(n => n.textContent));
    assert.ok(!found.includes('الأخبار') && !found.includes('الصور') && found.includes('المسابقات'), JSON.stringify(found));
    await s.page.keyboard.press('Escape');
    // a place they may not open (a kept one, a link): told, with the way home
    await s.page.evaluate(() => A.go('media'));
    await s.page.waitForFunction(() => /مش متاح لحسابك/.test(document.getElementById('view').textContent), { timeout: 4000 });
    await s.page.click('#view .btn--primary');
    await s.page.waitForFunction(() => A.area === 'comps', { timeout: 4000 });
    // and the Worker refuses the call anyway
    const refused = await s.page.evaluate(() => A.call('apiMediaList').then(() => 'ok', e => String(e && e.message || e)));
    assert.notEqual(refused, 'ok');
    await s.close();
    // phones: the dock starts with their home
    env.DB.raw.exec('DELETE FROM admin_sessions;');
    const p = await open();
    await p.page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await signedIn(p.page);
    await p.page.waitForFunction(() => A.access && A.area === 'comps', { timeout: 8000 });
    assert.deepEqual(await p.page.$$eval('#dock .dockbtn', ns => ns.map(n => n.dataset.area)), ['comps', 'more']);
    await p.close();
  }
  finally {
    who = ADMIN;
    env.DB.raw.exec("UPDATE settings SET value = '0' WHERE key = 'PERMS_ENFORCE';");
  }

  // the switch off (today on production): the same admin sees every area, as before
  env.DB.raw.exec('DELETE FROM admin_sessions;');
  who = COMPS;
  try {
    const o = await open();
    await signedIn(o.page);
    await o.page.waitForFunction(() => !!A.access, { timeout: 8000 });
    assert.ok((await o.page.$$eval('#rail-nav .navlink', ns => ns.length)) >= 7, 'nothing hidden while the switch is off');
    await o.close();
  }
  finally {
    who = ADMIN;
  }
});


test('Phase 8 A6: «إدارة السجل» — the size, an archive to a private file, a safe delete with the word; only with activity.manage', async () => {
  await freshWorld();
  const now = Date.now();
  for (let i = 0; i < 4; i++) env.DB.raw.prepare("INSERT INTO activity (id, at, cairo, actor, action, entity_type, summary) VALUES (?, ?, '2025-01-01 00:00', 'x@example.com', 'diag.echo', 'diag', 's')").run('act-oldtech0' + i, now - 200 * 24 * 3600 * 1000);
  const s = await open();
  await signedIn(s.page);
  await s.page.waitForFunction(() => !!A.access, { timeout: 8000 });
  await s.page.evaluate(() => A.go('activity'));
  await s.page.waitForSelector('[data-act="log-manage"]', { timeout: 8000 });
  await s.page.click('[data-act="log-manage"]');
  await s.page.waitForSelector('dialog.sheet[open] .logm__stats[aria-busy="false"]', { timeout: 8000 });
  await s.page.$eval('dialog.sheet[open] .check--toggle input', i => i.click());
  await s.page.waitForFunction(() => /هيتأثر ٤ صف/.test(document.querySelector('.logm__count')?.textContent || ''), { timeout: 5000 });
  // an archive first (nothing deleted)
  await s.page.click('[data-act="log-archive"]');
  await s.page.waitForSelector('.logm__archive', { timeout: 8000 });
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'diag.echo'").get().n, 4);
  // the safe delete asks for the word
  await s.page.click('[data-act="log-delete"]');
  await s.page.waitForSelector('dialog.modal[open] .modal__typed');
  await s.page.type('dialog.modal[open] .modal__typed', 'امسح');
  await s.page.click('dialog.modal[open] .modal__actions .btn:first-child');
  await s.page.waitForFunction(() => /هيتأثر ٠ صف/.test(document.querySelector('.logm__count')?.textContent || ''), { timeout: 8000 });
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'diag.echo'").get().n, 0);
  assert.ok(env.DB.raw.prepare("SELECT 1 FROM activity WHERE action = 'activity.trim'").get(), 'the delete is in the log');
  await s.page.screenshot({ path: `${ROOT}tools/.cache/phase8-a3/log-manage.png` });
  assert.deepEqual(s.problems, []);
  await s.close();
});


test('Phase 8 A7 + A8: the locked games corner (GAMES_MODULE), and axe (serious / critical) in both themes on the main screens, desktop and phone', async () => {
  await freshWorld();
  env.DB.raw.exec("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('GAMES_MODULE', '1', 0)");
  const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const found = [];
  for (const [mode, viewport] of [['dark', DESKTOP], ['light', DESKTOP], ['dark', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['light', { width: 390, height: 844, isMobile: true, hasTouch: true }]]) {
    env.DB.raw.exec('DELETE FROM admin_sessions;');
    const s = await open();
    await s.page.evaluateOnNewDocument(m => { try { localStorage.setItem('athanasios-admin.prefs.v1', JSON.stringify({ prefs: { theme: m }, dirty: true })); } catch { /* none */ } }, mode);
    await s.page.setViewport(viewport);
    await s.page.reload({ waitUntil: 'networkidle0' });
    await signedIn(s.page);
    await s.page.waitForFunction(() => !document.querySelector('.welcome') && A.access, { timeout: 8000 });
    // A7: the games corner, locked
    await s.page.waitForFunction(() => A.AREAS.some(a => a.key === 'gamescorner'), { timeout: 5000 });
    for (const [area, sub] of [['home'], ['content', 'news'], ['comps', 'comps'], ['pages', 'events'], ['media'], ['activity'], ['settings'], ['gamescorner']]) {
      await s.page.evaluate((a, b) => A.go(a, b), area, sub);
      await sleep(700);
      // (the screen's entrance has to end first: a half-faded row reads as low contrast)
      await s.page.evaluate(() => Promise.all(document.getAnimations().filter(x => x.effect && x.effect.getComputedTiming().iterations !== Infinity).map(x => x.finished.catch(() => {}))));
      await s.page.evaluate(AXE);
      const v = await s.page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })
        .then(r => r.violations.filter(x => x.impact === 'serious' || x.impact === 'critical').map(x => x.id + ': ' + x.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | '))));
      v.forEach(x => found.push(`[${mode} ${viewport.width}] ${area}${sub ? '/' + sub : ''} ${x}`));
    }
    if (mode === 'light' && viewport.width > 1000) {
      await s.page.evaluate(() => A.go('gamescorner'));
      await sleep(400);
      assert.match(await s.page.$eval('#view', n => n.textContent), /قريبًا/);
      assert.equal(await s.page.$$eval('#view .coming__game', ns => ns.length), 6, 'the six approved games, as a list only');
      await s.page.screenshot({ path: `${ROOT}tools/.cache/phase8-a3/games-corner-light.png` });
    }
    assert.deepEqual(s.problems, []);
    await s.close();
  }
  assert.deepEqual(found, [], 'axe serious/critical:\n' + found.join('\n'));

  // the switch off: no area, nothing else changes
  env.DB.raw.exec("UPDATE settings SET value = '0' WHERE key = 'GAMES_MODULE'; DELETE FROM admin_sessions;");
  const off = await open();
  await signedIn(off.page);
  await off.page.waitForFunction(() => !!A.access, { timeout: 8000 });
  assert.equal(await off.page.evaluate(() => A.AREAS.some(a => a.key === 'gamescorner')), false);
  await off.close();
});
