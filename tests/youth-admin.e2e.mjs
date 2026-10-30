// «حسابات الشباب» in the real admin (Chrome), on a fake of the Worker's /v1/admin/participants/*
// (worker/src/account/admin.js; the rules are in worker/test/participants.test.mjs): the tab follows
// the switch, the list, a new account, the sheet, viewing vs resetting a password, points, seasons.
// Run: cd tools && node --test ../tests/youth-admin.e2e.mjs

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4744;
const LOCAL = `http://127.0.0.1:${PORT}`;
const WORKER_URL = 'https://athanasios-api.menazak-lab.workers.dev';
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN = 'menazakmena@gmail.com';
const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 4000, render: 8000, beat: 900, beatFail: 2500 };
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

let world, server, browser;

const person = over => ({
  id: 'p-aaaaaaaa', name: 'مينا زكريا فؤاد', email: 'mina@example.com', emailVerified: true, emailVia: 'admin', phone: '01012345678', birthDate: '2000-03-12', age: 26,
  eligibility: { state: 'eligible', source: 'auto', soon: false, leavesAt: null, override: null }, group: '', church: '', servant: '', status: 'active', createdVia: 'admin', createdAt: Date.now(), balance: 0, ...over
});

const fake = {
  reset(mode = 'on') {
    this.mode = mode;
    this.calls = [];
    this.people = [person({ id: 'p-bbbbbbbb', name: 'سارة عادل نبيل', email: 'sara@example.com', phone: '01112345678', eligibility: { state: 'guest', source: 'auto', soon: false, leavesAt: null, override: null }, balance: 40 })];
    this.points = {};
    this.orders = [{ id: 'r-0000000001', itemName: 'كتاب هدية', cost: 30, status: 'pending', person: 'مينا زكريا', requestedAt: Date.now(), emailChangedRecently: true, next: ['approved', 'fulfilled', 'cancelled'] }];
    this.gradedWith = null;
    this.savedItem = null;
    this.schedule = null;
  },
  sheet(id) {
    const p = this.people.find(x => x.id === id);
    return {
      ok: true, person: { ...p, notes: '', blockedAt: null, blockedReason: '', pwIssuedAt: 1, pwIssuedBy: ADMIN, emailChangedRecently: false },
      points: { season: { id: 'sea-first', name: 'الموسم الأول' }, balance: p.balance, frozen: p.eligibility.state === 'guest' && p.balance > 0, ledger: [{ id: 'l1', amount: p.balance, kind: 'manual', at: Date.now(), note: 'حفظ', notePublic: true, actor: ADMIN, ref: null }], seasons: [] },
      sessions: [{ device: 'Android Chrome', kind: 'device', lastSeen: Date.now() }], audit: [{ at: Date.now(), actor: ADMIN, action: 'register.admin', field: null, oldValue: null, newValue: null, reason: null, check: 'in_person_readback' }],
      bookings: [{ id: 'bkg-1', ref: 'B-AAAA1', status: 'confirmed', event: 'رحلة', age: 26, ageSource: 'account', mismatch: true }], mail: [{ id: 'mo-1', kind: 'book.confirmed', tier: 1, status: 'sent', at: Date.now(), sentAt: Date.now() }],
      can: { edit: true, manage: true, viewPassword: fake.primary !== false, points: true, transfer: true }
    };
  }
};

const cors = { 'access-control-allow-origin': LOCAL };
const json = (status, body) => ({ status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });

async function handle(request) {
  const url = new URL(request.url());
  if (url.origin !== WORKER_URL) return null;
  const method = request.method();
  if (method === 'OPTIONS') return { status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'authorization, content-type, idempotency-key, accept, x-edit-session' }, body: '' };
  const body = request.postData() ? JSON.parse(request.postData()) : null;
  const path = url.pathname;
  fake.calls.push({ method, path, body });
  if (path === '/v1/account/config') return json(200, { ok: true, mode: fake.mode, turnstile: null, support: {} });
  if (path === '/v1/admin/book/module') return json(200, { ok: true, on: false, env: 'production' });
  if (path === '/v1/admin/participants/settings') return json(200, { ok: true, ageMin: 18, ageMax: 30, warnDays: 60, support: null, supportDefault: { name: 'مينا زكريا', phone: '01276162016' } });
  if (path === '/v1/admin/participants/review') return json(200, { ok: true, people: [{ ...fake.people[0], flags: ['same_name_dob'] }] });
  if (path === '/v1/admin/participants/export') return json(200, { ok: true, rows: fake.people.map(p => ({ id: p.id, name: p.name, email: p.email, emailVerified: true, phone: p.phone, birthDate: p.birthDate, age: p.age, eligibility: p.eligibility.state, eligibilitySource: 'auto', frozen: 0, status: p.status, group: '', church: '', servant: '', notes: '' })) });
  if (path === '/v1/admin/participants' && method === 'GET') {
    const q = url.searchParams.get('q');
    const list = q ? fake.people.filter(p => p.name.includes(q)) : fake.people;
    return json(200, { ok: true, people: list, total: list.length, offset: 0, limit: 50, season: { id: 'sea-first', name: 'الموسم الأول' }, can: { add: true, manage: true, viewPassword: true, export: true } });
  }
  if (path === '/v1/admin/participants' && method === 'POST') {
    if (body.email !== body.emailConfirm) return json(400, { ok: false, code: 'invalid', field: 'emailConfirm', message: 'الإيميل مش زي اللي فوق. اكتبه تاني.' });
    fake.people.unshift(person({ name: body.name, email: body.email, phone: body.phone, birthDate: body.birthDate }));
    return json(200, { ok: true, id: 'p-aaaaaaaa', password: 'ABCD-EFGH-JKMN' });
  }
  if (path === '/v1/admin/comp') return json(200, { ok: true, comps: [{ id: 'c-a', slug: 'quiz', title: 'مسابقة الكتاب', sent: 2, pending: 1, closedAt: '', finalizedAt: '' }] });
  if (path === '/v1/admin/comp/c-a/submissions') return json(200, { ok: true, submissions: [
    { id: 's-000000000001', name: 'مينا زكريا', phone: '01012345678', status: 'pending_review', score: 10, maxScore: 15, pending: 1, guest: false, rank: 1 },
    { id: 's-000000000002', name: 'سارة عادل', phone: '01112345678', status: 'graded', score: 15, maxScore: 15, pending: 0, guest: true, rank: null }] });
  if (path === '/v1/admin/comp/c-a/regrade') return json(200, { ok: true, checked: 2, changed: 1 });
  if (path.startsWith('/v1/admin/comp/submissions/')) {
    const graded = path.endsWith('/grade');
    if (graded) fake.gradedWith = body.grades;
    return json(200, { ok: true, submission: { id: 's-000000000001', name: 'مينا زكريا', status: graded ? 'graded' : 'pending_review', score: graded ? 15 : 10, maxScore: 15, pending: graded ? 0 : 1, guest: false }, questions: [{ id: 'q2', type: 'long', text: 'اكتب مقال', points: 5, choices: [], answer: 'إجابة المشترك', grade: graded ? { ok: true, pts: 5 } : { ok: null, pts: 0 } }] });
  }
  if (path === '/v1/admin/store/items') {
    if (method === 'POST') fake.savedItem = body;
    return json(200, { ok: true, items: [{ id: 'i-00000001', name: 'كتاب هدية', cost: 30, stock: 5, perPerson: 1, available: 4, redeemed: 1, active: true, category: '', order: 0, description: '' }] });
  }
  if (path === '/v1/admin/store/schedule') {
    if (method === 'POST') fake.schedule = body;
    return json(200, { ok: true, mode: 'auto', state: 'open', opensAt: '', closesAt: '', allowCancel: false });
  }
  if (path === '/v1/admin/store/redemptions') return json(200, { ok: true, redemptions: fake.orders });
  if (path.startsWith('/v1/admin/store/redemptions/')) {
    fake.orders = fake.orders.map(o => ({ ...o, status: body.status, next: [] }));
    return json(200, { ok: true, redemptions: fake.orders });
  }
  if (path === '/v1/admin/points/seasons') return json(200, { ok: true, seasons: [{ id: 'sea-first', name: 'الموسم الأول', status: 'active' }] });
  if (path === '/v1/admin/points/seasons/sea-first/preview') return json(200, { ok: true, participants: 2, total: 110, frozen: { participants: 1, total: 40 }, key: 'k1', season: {} });
  if (path === '/v1/admin/points/seasons/sea-first/close') return json(200, { ok: true, closed: 'sea-first', active: 'sea-next', seasons: [] });
  const m = /^\/v1\/admin\/participants\/([^/]+)(?:\/(.+))?$/.exec(path);
  if (m) {
    if (!m[2]) return json(200, fake.sheet(m[1]));
    if (m[2] === 'view-password') return json(200, { ok: true, password: 'CURR-ENTP-ASS2' });
    if (m[2] === 'reset-password') return json(200, { ok: true, password: 'NEWW-PASS-WRD3' });
    if (m[2] === 'points') {
      const p = fake.people.find(x => x.id === m[1]);
      p.balance += body.amount;
      return json(200, { ok: true, balance: p.balance });
    }
    return json(200, fake.sheet(m[1]));
  }
  return json(404, { ok: false, code: 'notfound', message: 'الطلب ده مش معروف.' });
}

test.before(async () => {
  mkdirSync(`${ROOT}tools/.cache/youth-admin/`, { recursive: true });
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', `${SITE}/`);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.properties.set('ADMIN_EMAILS', ADMIN);
  world.properties.set('WORKER_SYNC_SECRET', 's'.repeat(48));
  world.gs.SESSION_STALE_SECONDS = 0;
  world.as('');
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

async function open(viewport = { width: 1366, height: 900 }) {
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
  return { context, page, problems };
}
const subs = page => page.evaluate(() => A.AREAS.find(a => a.key === 'comps').subs.map(s => s.key));
const click = (page, selector) => page.evaluate(s => document.querySelector(s).click(), selector);
const textOf = (page, selector) => page.$eval(selector, n => n.innerText);
const sheetText = page => textOf(page, '#sheet');

async function goYouth(page) {
  await page.waitForFunction(() => A.AREAS.find(a => a.key === 'comps').subs.some(s => s.key === 'youth'), { timeout: 15000 });
  await page.evaluate(() => A.go('comps', 'youth'));
  await page.waitForSelector('[data-youth]', { timeout: 8000 });
}
async function saveSheet(page) {
  await click(page, '[data-act="youth-save"]');
}

test('accounts off: no tab, nothing asked of the participants routes', async () => {
  fake.reset('off');
  const { context, page, problems } = await open();
  await new Promise(r => setTimeout(r, 2500));
  assert.ok(!(await subs(page)).includes('youth'));
  assert.ok(!fake.calls.some(c => c.path.startsWith('/v1/admin/participants')));
  assert.deepEqual(problems, []);
  await context.close();
});

test('a new account: typed twice, the password once on screen, nothing left behind', async () => {
  fake.reset();
  const { context, page, problems } = await open();
  await goYouth(page);
  assert.match(await textOf(page, '#view'), /سارة عادل نبيل/);
  assert.match(await textOf(page, '#view'), /متجمد/);
  await click(page, '[data-act="youth-add"]');
  await page.waitForSelector('#sheet[open] [data-act="youth-save"]');
  const inputs = await page.$$('#sheet .form input, #sheet .form select');
  await inputs[0].type('مينا زكريا فؤاد');
  await inputs[1].type('mina@example.com');
  await inputs[2].type('other@example.com');
  await page.select('#sheet .form select', 'in_person_readback');
  await inputs[4].type('01012345678');
  await inputs[5].evaluate(n => { n.value = '2000-03-12'; });
  await saveSheet(page);
  await page.waitForFunction(() => /مش زي اللي فوق/.test(document.querySelector('#sheet').innerText), { timeout: 5000 });
  await inputs[2].evaluate(n => { n.value = ''; });
  await inputs[2].type('mina@example.com');
  await saveSheet(page);
  await page.waitForSelector('[data-youth-password]', { timeout: 5000 });
  assert.equal(await textOf(page, '[data-youth-password]'), 'ABCD-EFGH-JKMN');
  assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + location.href)).includes('ABCD-EFGH-JKMN'), 'never stored, never in the URL');
  await page.evaluate(() => [...document.querySelectorAll('#sheet .btn')].find(b => b.textContent.trim() === 'قفل').click());
  await page.waitForFunction(() => !document.querySelector('[data-youth-password]') || !document.querySelector('#sheet').open, { timeout: 5000 });
  assert.deepEqual(problems, []);
  await context.close();
});

test('the sheet: viewing and resetting are separate; a reset needs its reason on the server; points; audit', async () => {
  fake.reset();
  fake.people.unshift(person({ balance: 70 }));
  const { context, page, problems } = await open({ width: 390, height: 844 });
  await goYouth(page);
  await click(page, '[data-youth="p-aaaaaaaa"]');
  await page.waitForSelector('[data-youth-facts]', { timeout: 8000 });
  const body = await textOf(page, '#view');
  assert.match(body, /mina@example\.com/);
  assert.match(body, /متأكد من الأدمن/);
  assert.match(body, /B-AAAA1/);
  assert.match(body, /تاريخ الميلاد مختلف عن الحجز/);
  assert.match(body, /اتعمل من الأدمن/);

  // the Primary Admin sees it among the facts, with no click; one logged call per view; no reset
  await page.waitForSelector('[data-youth-current-value]', { timeout: 5000 });
  assert.equal(await textOf(page, '[data-youth-current-value]'), 'CURR-ENTP-ASS2');
  const views = () => fake.calls.filter(c => c.path.endsWith('/view-password')).length;
  assert.equal(views(), 1);
  assert.ok(!fake.calls.some(c => c.path.endsWith('/reset-password')), 'viewing never resets');
  assert.ok(!await page.$('[data-act="youth-view-password"]'), 'no extra button');
  assert.match(await textOf(page, '[data-act="youth-reset"]'), /توليد باسورد جديد/);
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('CURR-ENTP-ASS2')), false, 'never kept in the browser');

  // it leaves the page by itself; showing it again is another logged view
  await page.evaluate(() => { const set = window.setTimeout; window.setTimeout = (f, ms, ...rest) => set(f, ms === 300000 ? 30 : ms, ...rest); });
  await page.evaluate(() => A.render());
  await page.waitForSelector('[data-act="youth-password-again"]', { timeout: 5000 });
  assert.ok(!(await textOf(page, '#view')).includes('CURR-ENTP-ASS2'));
  const before = views();
  await click(page, '[data-act="youth-password-again"]');
  await page.waitForSelector('[data-youth-current-value]', { timeout: 5000 });
  assert.equal(views(), before + 1);
  await page.evaluate(() => A.render());
  await page.waitForSelector('[data-youth-facts]', { timeout: 8000 });

  await click(page, '[data-act="youth-reset"]');
  await page.waitForSelector('#sheet[open] [data-act="youth-save"]');
  await page.type('#sheet .form textarea', 'نسي الباسورد');
  await saveSheet(page);
  await page.waitForFunction(() => document.querySelector('[data-youth-password]') && document.querySelector('[data-youth-password]').innerText === 'NEWW-PASS-WRD3', { timeout: 5000 });
  assert.equal(fake.calls.find(c => c.path.endsWith('/reset-password')).body.reason, 'نسي الباسورد');
  await page.evaluate(() => [...document.querySelectorAll('#sheet .btn')].find(b => b.textContent.trim() === 'قفل').click());

  await page.waitForFunction(() => !document.querySelector('#sheet').open, { timeout: 5000 });
  await page.waitForSelector('[data-act="youth-points"]', { timeout: 8000 });
  await click(page, '[data-act="youth-points"]');
  await page.waitForSelector('#sheet[open] [data-act="youth-save"]');
  const fields = await page.$$('#sheet .form input');
  await fields[0].type('-20');
  await fields[1].type('خصم');
  await saveSheet(page);
  await page.waitForFunction(() => document.querySelector('[data-youth-balance]') && /٥٠/.test(document.querySelector('[data-youth-balance]').innerText), { timeout: 8000 });
  const sent = fake.calls.find(c => c.path.endsWith('/points'));
  assert.equal(sent.body.amount, -20);
  assert.match(sent.body.key, /^[A-Za-z0-9_-]{8,64}$/);
  assert.ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no sideways scroll on a phone');
  assert.deepEqual(problems, []);
  await context.close();
});

test('seasons: the preview shows frozen points apart; review list; settings; export', async () => {
  fake.reset();
  const { context, page, problems } = await open();
  await goYouth(page);
  await click(page, '[data-act="youth-seasons"]');
  await page.waitForSelector('[data-act="season-close"]', { timeout: 8000 });
  await click(page, '[data-act="season-close"]');
  await page.waitForSelector('#sheet[open] [data-act="youth-save"]');
  assert.match(await sheetText(page), /متجمدين/);
  await page.type('#sheet .form input', 'الموسم التاني');
  await saveSheet(page);
  await page.waitForFunction(() => !document.querySelector('#sheet').open, { timeout: 5000 });
  const closed = fake.calls.find(c => c.path.endsWith('/close'));
  assert.deepEqual(closed.body, { key: 'k1', next: { name: 'الموسم التاني' } });

  await click(page, '[data-act="youth-back"]');
  await page.waitForSelector('[data-act="youth-review"]', { timeout: 8000 });
  await click(page, '[data-act="youth-review"]');
  await page.waitForFunction(() => /نفس الاسم وتاريخ الميلاد/.test(document.body.innerText), { timeout: 8000 });

  await click(page, '[data-act="youth-back"]');
  await page.waitForSelector('[data-act="youth-settings"]', { timeout: 8000 });
  await click(page, '[data-act="youth-settings"]');
  await page.waitForSelector('#sheet[open] [data-act="youth-save"]');
  assert.match(await sheetText(page), /اسم مسؤول الدعم الفني/);
  await saveSheet(page);
  await page.waitForFunction(() => !document.querySelector('#sheet').open, { timeout: 5000 });
  const saved = fake.calls.find(c => c.path === '/v1/admin/participants/settings' && c.method === 'POST');
  assert.deepEqual([saved.body.ageMin, saved.body.ageMax], ['18', '30']);
  assert.deepEqual(saved.body.support, { id: null, name: 'مينا زكريا', phone: '01276162016' }, 'the name and number are shown and saved');

  await page.waitForSelector('[data-act="youth-export"]', { timeout: 8000 });
  await click(page, '[data-act="youth-export"]');
  await page.waitForFunction(() => window.A.comp.lastDownload, { timeout: 8000 });
  assert.equal(await page.evaluate(() => A.comp.lastDownload.filename), 'حسابات-الشباب.xlsx');
  assert.deepEqual(problems, []);
  await context.close();
});

test('results: a guest has no place number; a servant grades; the store: a prize, a request, the schedule', async () => {
  fake.reset();
  const { context, page, problems } = await open();
  await goYouth(page);
  await click(page, '[data-act="youth-results"]');
  await page.waitForSelector('[data-comp="c-a"]', { timeout: 8000 });
  await click(page, '[data-comp="c-a"]');
  await page.waitForSelector('[data-submission]', { timeout: 8000 });
  const list = await textOf(page, '#view');
  assert.match(list, /١. /);
  assert.match(list, /ضيف/);
  await click(page, '[data-submission="s-000000000001"]');
  await page.waitForSelector('[data-question="q2"]', { timeout: 8000 });
  assert.match(await sheetText(page), /إجابة المشترك/);
  await click(page, '[data-grade="q2:true"]');
  await page.waitForFunction(() => /١٥ من ١٥/.test(document.querySelector('[data-sub-score]').innerText), { timeout: 5000 });
  assert.deepEqual(fake.gradedWith, { q2: true });
  await page.evaluate(() => [...document.querySelectorAll('#sheet .btn')].find(b => b.textContent.trim() === 'قفل').click());
  await page.waitForFunction(() => !document.querySelector('#sheet').open, { timeout: 5000 });

  await page.evaluate(() => { A.compYouth.view = 'store'; A.render(); });
  await page.waitForSelector('[data-order="r-0000000001"]', { timeout: 8000 });
  assert.match(await textOf(page, '#view'), /الإيميل اتغير من قريب/);
  await click(page, '[data-order-act="approved"]');
  await page.waitForFunction(() => /جاهزة للاستلام/.test(document.querySelector('[data-order]').innerText), { timeout: 5000 });
  await click(page, '[data-act="item-add"]');
  await page.waitForSelector('#sheet[open] [data-act="youth-save"]');
  const fields = await page.$$('#sheet .form input:not([type="checkbox"]):not([type="file"])');
  await fields[0].type('جايزة جديدة');
  await page.$$eval('#sheet .form input', ns => { const c = ns.find(n => n.getAttribute('inputmode') !== 'x' && n.value === ''); return !!c; });
  await page.evaluate(() => { const inputs = [...document.querySelectorAll('#sheet .form input:not([type="checkbox"]):not([type="file"])')]; inputs[1].value = '40'; inputs[1].dispatchEvent(new Event('input', { bubbles: true })); });
  await saveSheet(page);
  await page.waitForFunction(() => !document.querySelector('#sheet').open, { timeout: 5000 });
  assert.equal(fake.savedItem.name, 'جايزة جديدة');
  assert.equal(fake.savedItem.active, true);
  await page.waitForSelector('[data-act="store-schedule"]', { timeout: 8000 });
  await click(page, '[data-act="store-schedule"]');
  await page.waitForFunction(() => true);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(fake.schedule.mode, 'auto');
  assert.deepEqual(problems, []);
  await context.close();
});

test('accounts on: the old people / points / store tabs give way to «حسابات الشباب»', async () => {
  fake.reset();
  const { context, page, problems } = await open();
  await goYouth(page);
  const keys = await subs(page);
  assert.ok(keys.includes('youth'));
  for (const old of ['people', 'points', 'shop']) assert.ok(!keys.includes(old), old);
  assert.deepEqual(problems, []);
  await context.close();
});

test('not the Primary Admin: no password row, no call for it, and the separate reset stays', async () => {
  fake.reset();
  fake.people.unshift(person({ balance: 70 }));
  fake.primary = false;
  fake.calls.length = 0;
  const { context, page, problems } = await open();
  await goYouth(page);
  await page.waitForSelector('[data-youth="p-aaaaaaaa"]', { timeout: 8000 });
  await click(page, '[data-youth="p-aaaaaaaa"]');
  await page.waitForSelector('[data-youth-facts]', { timeout: 8000 });
  assert.ok(!await page.$('[data-youth-current]'));
  assert.ok(!(await textOf(page, '#view')).includes('الباسورد الحالي'));
  assert.ok(!fake.calls.some(c => c.path.endsWith('/view-password')), 'never asked for');
  assert.ok(await page.$('[data-act="youth-reset"]'));
  assert.deepEqual(problems, []);
  fake.primary = true;
  await context.close();
});
