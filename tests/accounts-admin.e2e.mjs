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
import { allTypes, defaultsOf } from '../worker/src/notify/catalog.js';

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
    this.notify = notifyFake();
    this.activityDown = false;
    this.publish = { enabled: false, live: null, jobs: [] };
    const at = Date.now() - 60000;
    this.activity = [
      { id: 'act-w00000000001', at, cairo: '2026-10-20 10:00', actor: ADMIN, actorName: 'مينا زكريا', action: 'booking.confirm', type: 'booking', entityId: 'bkg-1', title: 'B-AAAA1', summary: 'أكّد الحجز B-AAAA1', text: 'مينا زكريا أكّد الحجز B-AAAA1', changes: null, ref: '', count: 1, device: '', severity: 'routine', source: 'worker' },
      { id: 'act-a00000000001', at: at - 1000, cairo: '2026-10-20 09:59', actor: ADMIN, actorName: 'مينا زكريا', action: 'accounts.add', type: 'admin', entityId: NEW, title: NEW, summary: 'ضاف «' + NEW + '» للوحة التحكم', text: '', changes: null, ref: '', count: 1, device: '', severity: 'critical', source: 'worker' }
    ];
    this.admins = [
      { email: ADMIN, name: '', primary: true, active: true, servantId: null, lastSeen: null, grants: {} },
      { email: SECOND, name: '', primary: false, active: true, servantId: null, lastSeen: null, grants: { 'bookings.view': 'all' } }
    ];
  },
  listing() {
    return { ok: true, me: ADMIN, canManage: true, enforce: false, max: 20, perms: PERMS, primaryDefault: PRIMARY_DEFAULT, presets: PRESETS, admins: this.admins };
  }
};

/* the Worker's notification routes (worker/src/notify/settings.js), in memory */
function notifyFake() {
  const types = allTypes().map(t => ({ ...t, ...defaultsOf(t.level), mode: 'all', include: [], exclude: [], locked: false, custom: false }));
  const n = {
    router: false, email: false, prefs: {}, saved: [],
    critical: [{ id: 'ntf-0000aaaa', recipient: ADMIN, channel: 'email', status: 'deferred_quota', attempts: 1, error: 'quota', at: Date.now(), title: 'النظام نقل البيانات' }],
    settings: () => ({ ok: true, canManage: true, router: n.router, email: n.email, gmail: false, summaryTime: '21:00', budget: { target: 400, admin: 150, critical: 50, otp: 50 },
      admins: [{ email: ADMIN, name: 'مينا زكريا', primary: true }, { email: SECOND, name: 'فادي يوسف', primary: false }], types }),
    apply: body => { n.saved.push(body); n.router = body.router; n.email = body.email; for (const [k, v] of Object.entries(body.types || {})) Object.assign(types.find(t => t.key === k), v, { custom: true }); },
    me: () => ({ ok: true, router: n.router, email: n.email, types: types.slice(0, 8).map(t => ({ key: t.key, level: t.level, module: t.module, locked: t.level === 'critical', push: (n.prefs[t.key] && n.prefs[t.key].push) || (t.push ? 'immediate' : 'off'), pushAllowed: t.push, emailMode: (n.prefs[t.key] && n.prefs[t.key].email) || t.email })) }),
    status: () => ({ ok: true, member: { on: false, codes: true, accounts: true, classes: { otp: { sent: 4 }, member_tx: { sent: 2, suppressed: 1, dead: 1 } }, lastSent: Date.now(), discovery: { today: 12, cap: 400, noAccount: 3, wideSources: 1 } }, canManage: true, router: n.router, email: n.email, days: [{ day: '2026-10-20', push: { sent: 3 }, email: { sent: 1, failed: 1 } }], lastSuccess: { push: Date.now() - 60000 }, gmail: { ok: false, configured: false }, quota: { total: 1, critical: 0, otp: 0, target: 400, admin: 150 }, critical: n.critical })
  };
  return n;
}

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
  if (url.pathname === '/v1/admin/notify/settings' && method === 'GET') return json(200, fake.notify.settings());
  if (url.pathname === '/v1/admin/notify/settings' && method === 'POST') { fake.notify.apply(body); return json(200, fake.notify.settings()); }
  if (url.pathname === '/v1/admin/notify/me') { if (method === 'POST') fake.notify.prefs = body.prefs; return json(200, fake.notify.me()); }
  if (url.pathname === '/v1/admin/notify/status') return json(200, fake.notify.status());
  if (url.pathname === '/v1/admin/publish/revisions') return json(200, { ok: true, ...fake.publish, jobs: fake.publish.jobs.map(j => ({ ...j, live: j.id === fake.publish.live })) });
  if (url.pathname === '/v1/admin/publish/restore' && method === 'POST') {
    const id = 'restore-' + fake.publish.jobs.length;
    fake.publish.jobs.unshift({ id, mode: 'restore', revision: 'r1', by: ADMIN, at: Date.now(), files: 1, changed: 1, state: 'live' });
    fake.publish.live = id;
    return json(200, { ok: true, id, to: body.to, unchanged: false });
  }
  if (url.pathname.startsWith('/v1/admin/notify/outbox/') && url.pathname.endsWith('/dismiss')) { fake.notify.critical = []; return json(200, fake.notify.status()); }
  if (url.pathname === '/v1/admin/activity' && method === 'GET') {
    if (fake.activityDown) return json(500, { ok: false, code: 'error', message: 'x' });
    return json(200, { ok: true, items: fake.activity, more: false, next: 0, admins: [{ email: ADMIN, name: 'مينا زكريا' }], families: ['add'], sections: ['bookings'] });
  }
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

async function openSettings(viewport = { width: 1366, height: 900 }, rows = 2) {
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
  await page.waitForFunction(n => document.querySelectorAll('.card--admins .admin').length === n && /صلاحية واحدة/.test(document.querySelector('.card--admins').innerText), { timeout: 8000 }, rows);
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

test('«سجل النشاط» reads the unified log from D1 (Worker + Apps Script rows); the Activity tab when the Worker is away', async () => {
  fake.reset();
  const { context, page, problems } = await openSettings();
  await page.evaluate(() => A.go('activity'));
  await page.waitForFunction(() => /أكّد الحجز B-AAAA1/.test(document.body.innerText), { timeout: 8000 });
  assert.match(await page.evaluate(() => document.body.innerText), /للوحة التحكم/);
  const asked = fake.calls.find(c => c.path === '/v1/admin/activity');
  assert.ok(asked, 'asked the Worker');
  await page.screenshot({ path: `${SHOTS}activity-unified.png` });

  // the Worker away: the same screen from the Activity tab (Apps Script)
  fake.activityDown = true;
  world.as(ADMIN).gs.activity_({ action: 'create', type: 'news', id: 'n-1', title: 'خبر من الشيت' });
  world.as('');
  await page.evaluate(() => A.go('home'));
  await page.evaluate(() => A.go('activity'));
  await page.waitForFunction(() => /خبر من الشيت/.test(document.body.innerText), { timeout: 8000 });
  assert.deepEqual(problems, []);
  await context.close();
});

test('notifications: «تنبيهاتي», «إعدادات الإشعارات» (switch on with a confirm), «حالة النظام» (dismiss), the home banner', async () => {
  fake.reset();
  const { context, page, problems } = await openSettings();
  await page.waitForSelector('.card--notify-settings .nt-row');
  await page.waitForSelector('.card--system-status .nt-critical');
  const memberPart = await page.evaluate(() => document.querySelector('.card--system-status .nt-member').innerText);
  assert.match(memberPart, /الحسابات شغالة/);
  assert.match(memberPart, /إيميلات الأعضاء مقفولة/);
  assert.match(memberPart, /12 \/ 400/);
  assert.match(memberPart, /مصدر بيجرّب إيميلات كتير/);
  await page.waitForSelector('.card--notify-me .nt-row');
  await page.screenshot({ path: `${SHOTS}notify-settings.png`, fullPage: true });

  // «إعدادات الإشعارات»: publish → no push, summary email; then the switch on (asks first)
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.card--notify-settings .nt-row')].find(r => r.textContent.includes('نشر الموقع'));
    row.querySelector('.check input').click();
    const sel = row.querySelector('select'); sel.value = 'summary'; sel.dispatchEvent(new Event('change'));
    const on = [...document.querySelectorAll('.card--notify-settings .check')].find(c => c.textContent.includes('شغّل الإشعارات الجديدة'));
    on.querySelector('input').click();
  });
  await page.click('.card--notify-settings .actions .btn--primary');
  await clickDialogButton(page, 'شغّل');
  await page.waitForFunction(() => /اتحفظت إعدادات الإشعارات/.test(document.body.innerText), { timeout: 8000 });
  const sent = fake.notify.saved[0];
  assert.equal(sent.router, true);
  assert.deepEqual([sent.types.publish.push, sent.types.publish.email], [false, 'summary']);
  assert.equal(Object.keys(sent.types).length, 1, 'only what changed');

  // «تنبيهاتي»: a choice saved; critical ones locked
  assert.equal(await page.$$eval('.card--notify-me .nt-row', rows => rows.filter(r => r.textContent.includes('إجباري')).every(r => [...r.querySelectorAll('select')].every(s => s.disabled))), true);
  await page.click('.card--notify-me .actions .btn--primary');
  await page.waitForFunction(() => /اتحفظت اختياراتك/.test(document.body.innerText), { timeout: 8000 });
  assert.ok(fake.notify.prefs && typeof fake.notify.prefs === 'object');

  // «حالة النظام»: the waiting critical row, dismissed on purpose
  await page.evaluate(() => [...document.querySelectorAll('.card--system-status .nt-critical button')][0].click());
  await clickDialogButton(page, 'شيله');
  await page.waitForFunction(() => /مفيش تنبيهات مهمة مستنية/.test(document.querySelector('.card--system-status').innerText), { timeout: 8000 });

  // the home banner (before the dismiss there was one critical waiting)
  fake.notify.critical = [{ id: 'ntf-0000bbbb', recipient: ADMIN, channel: 'email', status: 'deferred_quota', attempts: 1, error: '', at: Date.now(), title: 'x' }];
  await page.evaluate(() => A.go('home'));
  await page.waitForSelector('.nt-banner:not([hidden])', { timeout: 8000 });
  assert.match(await page.$eval('.nt-banner', n => n.innerText), /تنبيه مهم جدًا/);
  assert.deepEqual(problems, []);
  await context.close();
});

test('notifications on a phone: no page overflow in the settings page', async () => {
  fake.reset();
  const { context, page, problems } = await openSettings({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.waitForSelector('.card--notify-settings .nt-row');
  await page.evaluate(() => document.querySelector('.card--notify-settings .grants').scrollIntoView({ block: 'start' }));
  await sleep(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  await page.screenshot({ path: `${SHOTS}notify-phone.png` });
  assert.equal(overflow, false);
  assert.deepEqual(problems, []);
  await context.close();
});

test('an email / push link to one account (#open/account/<key>) opens «الصلاحيات» on that row; never the email in the link', async () => {
  fake.reset();
  const { accountKey } = await import('../worker/src/notify/catalog.js');
  const { context, page, problems } = await openSettings();
  await page.evaluate(() => A.go('home'));
  await page.evaluate(key => { window.location.hash = '#open/account/' + key; }, accountKey(SECOND));
  await page.waitForFunction(email => {
    const row = document.querySelector('.card--admins .admin.is-focus');
    return row && row.getAttribute('data-email') === email;
  }, { timeout: 8000 }, SECOND);
  assert.equal(await page.$$eval('.card--admins .admin.is-focus', n => n.length), 1, 'only that row');
  assert.equal(await page.evaluate(() => window.location.hash), '', 'the link leaves the address bar at once');
  await page.screenshot({ path: `${SHOTS}account-link.png` });
  // a key that matches nobody (the account was removed since): a short note, nothing highlighted
  await page.evaluate(() => A.go('home'));
  await page.evaluate(() => { window.location.hash = '#open/account/acc-0000000000000000'; });
  await page.waitForFunction(() => /مبقاش في لوحة التحكم/.test(document.body.innerText), { timeout: 8000 });
  assert.equal(await page.$$eval('.card--admins .admin.is-focus', n => n.length), 0);
  assert.deepEqual(problems, []);
  await context.close();
});

test('rename an account Apps Script does not know yet: the error stays in the card (never under the add form email); D1 known → renamed', async () => {
  fake.reset();
  fake.admins.push({ email: NEW, name: '', primary: false, active: true, servantId: null, lastSeen: null, grants: { 'bookings.view': 'all' } });
  const { context, page, problems } = await openSettings(undefined, 3);
  await page.waitForFunction(email => document.querySelector('.card--admins').innerText.includes(email), { timeout: 8000 }, NEW);

  const rename = async name => {
    await page.click(`.card--admins .admin[data-email="${NEW}"] [title="غيّر الاسم"]`);
    await page.waitForSelector('dialog.modal input');
    // the dialog focuses and selects its field itself (30 ms later): type after that, or the selection eats the text
    await page.waitForFunction(() => document.activeElement && document.activeElement.matches('dialog.modal input'), { timeout: 3000 });
    await new Promise(r => setTimeout(r, 50));
    await page.type('dialog.modal input', name);
    await clickDialogButton(page, 'احفظ الاسم');
  };

  // the grants pull is not reachable: Apps Script cannot learn the account → refused, shown in the card's box
  await rename('خدمة الشباب');
  await page.waitForFunction(() => /مش في القايمة/.test(document.querySelector('.card--admins').innerText), { timeout: 8000 });
  assert.equal(await page.$$eval('.card--admins .admins__add .field--invalid, .card--admins .admins__add [aria-invalid="true"]', n => n.length), 0, 'the add form email is not marked');
  await page.screenshot({ path: `${SHOTS}rename-unknown.png` });

  // D1 answers with the account: the rename asks it first and goes through
  world.web['https://athanasios-api.menazak-lab.workers.dev/v1/sync/grants'] = { status: 200, body: JSON.stringify({
    ok: true, v: 1, enforce: false, adminsSyncTs: 1, perms: PERMS, primaryDefault: PRIMARY_DEFAULT,
    admins: [ADMIN, SECOND, NEW].map(email => ({ email, name: '', primary: email === ADMIN, servantId: null, g: PERMS.map(() => '-').join('') }))
  }) };
  world.advance(61 * 1000);
  await rename('خدمة الشباب');
  await page.waitForFunction(() => /اتحفظ الاسم/.test(document.body.innerText), { timeout: 8000 });
  assert.match(await cardText(page), /خدمة الشباب/);
  assert.ok(world.properties.get('ADMIN_EMAILS').includes(NEW), 'ADMIN_EMAILS follows D1');

  delete world.web['https://athanasios-api.menazak-lab.workers.dev/v1/sync/grants'];
  assert.deepEqual(problems, []);
  await context.close();
});

test('«نسخ النشر»: the last publishes; while the Worker is the truth one goes live again after a clear confirm', async () => {
  fake.reset();
  const t = Date.now() - 3600e3;
  fake.publish = { enabled: false, live: 'pub-2', jobs: [
    { id: 'pub-2', mode: 'shadow', revision: 'r2', by: ADMIN, at: t + 1000, files: 2, changed: 2, state: 'live' },
    { id: 'pub-1', mode: 'shadow', revision: 'r1', by: ADMIN, at: t, files: 2, changed: 2, state: 'live' }
  ] };
  let { context, page, problems } = await openSettings();
  await page.waitForFunction(() => document.querySelector('.card--publish-history [data-publish]'), { timeout: 8000 });
  let text = await page.$eval('.card--publish-history', n => n.innerText);
  assert.match(text, /بيشتغل لما النشر يبقى من السيرفر الجديد/);
  assert.match(text, /الحالية/);
  assert.equal(await page.$$eval('.card--publish-history button', n => n.length), 0, 'github/shadow mode: no restore button');
  await context.close();

  fake.publish = { ...fake.publish, enabled: true, jobs: fake.publish.jobs.map(j => ({ ...j, mode: 'worker' })) };
  ({ context, page, problems } = await openSettings());
  await page.waitForSelector('.card--publish-history [data-publish="pub-1"] button');
  assert.equal(await page.$$eval('.card--publish-history [data-publish="pub-2"] button', n => n.length), 0, 'the live one has none');
  await page.click('.card--publish-history [data-publish="pub-1"] button');
  await page.waitForFunction(() => /المسودة في لوحة التحكم مش هتتغير/.test(document.querySelector('dialog.modal').innerText), { timeout: 5000 });
  await page.screenshot({ path: `${SHOTS}restore-confirm.png` });
  await clickDialogButton(page, 'رجّع النسخة دي');
  await page.waitForFunction(() => /رجع الموقع للنسخة دي/.test(document.body.innerText), { timeout: 8000 });
  const call = fake.calls.find(c => c.path === '/v1/admin/publish/restore');
  assert.deepEqual(call.body, { to: 'pub-1', expect: 'pub-2' });
  // the new restore row, live (after the panel redraws)
  await page.waitForFunction(() => {
    const row = document.querySelector('.card--publish-history [data-publish^="restore-"]');
    return row && /رجوع لنسخة/.test(row.innerText) && /الحالية/.test(row.innerText);
  }, { timeout: 8000 });
  assert.deepEqual(problems, []);
  await context.close();
});
