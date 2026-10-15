// «الحجوزات» in the admin, in a real browser: the official /admin/ against the
// real .gs code (fake Apps Script world) with the Worker MOCKED by request
// interception of config.workerUrl (tests/fakes/book-worker.mjs, the
// worker/BOOKING-API.md shapes).
//  - module off / 401 / 403 / unreachable → no booking UI, nothing else changes
//  - module on → the tab, «الحجوزات (N جديد)» on the event, the queue (chips,
//    counts, search, last answer drawn at once), the booking sheet (flags,
//    proofs as blob: URLs), confirm with the first payment (needs_override →
//    «أكّد برضه»), a payment that warns → «سجّل برضه», a busy write retried
//    with the same key, a version conflict → reloaded, cancel with retain
//  - reject with money → «مرتجعات مطلوبة» → refund → void → reopen; a proof
//    uploaded with a payment
//  - a manual booking confirmed in the same dialog; summary + XLSX (sheets,
//    headers, the phone warning first); cancelling the whole event
//  - the installed app on its remembered device → «ادخل بحساب جوجل» first
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/book-admin.e2e.mjs

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';
import { wallAt } from './fakes/comp.mjs';
import { createBookWorker, WORKER_URL } from './fakes/book-worker.mjs';
import { readXlsx } from '../admin/xlsx.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');

const PORT = 4741;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN = 'menazakmena@gmail.com';
const SHOTS = `${ROOT}tools/.cache/book-admin/`;
const TMP = mkdtempSync(join(tmpdir(), 'book-admin-'));
const DESKTOP = { width: 1366, height: 900 };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

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
let fake;
let eventId;
let proofPng;
let proofFile;
let abortModule = false;

const PRICING = {
  mode: 'group',
  categories: [
    { key: 'applicant', label: 'الحاجز', group: 'adult', price: 1500, seat: true, min: 1, max: 1, note: '' },
    { key: 'adult', label: 'فرد إضافي', group: 'adult', price: 1500, seat: true, min: 0, max: 6, note: '' },
    { key: 'child', label: 'طفل', group: 'child', price: 800, seat: true, min: 0, max: 6, note: '' }
  ]
};
const METHODS = [{ key: 'cash', label: 'كاش', needsProof: false }, { key: 'instapay', label: 'إنستاباي', needsProof: true }];
const SERVANTS = [{ id: 'srv-mina', name: 'مينا عادل', methods: ['cash', 'instapay'] }, { id: 'srv-fady', name: 'فادي يوسف', methods: ['cash'] }];

function freshWorld() {
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', `${SITE}/`);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.properties.set('ADMIN_EMAILS', ADMIN);
  world.properties.set('ADMIN_NAMES', JSON.stringify({ [ADMIN]: 'مينا زكريا' }));
  world.gs.SESSION_STALE_SECONDS = 0;
  // the event as the admin made it (Apps Script); the Worker knows it by the same id
  const saved = JSON.parse(JSON.stringify(world.as(ADMIN).gs.apiEventSave(null, {
    slug: 'alex-trip', kind: 'trip', title: 'رحلة إسكندرية', summary: 'يوم على البحر', startAt: wallAt(world, 20 * 24 * 60), endAt: wallAt(world, 20 * 24 * 60 + 600),
    booking: { capacity: 40, pricing: { mode: 'group', categories: [{ label: 'الحاجز', price: 1500 }, { key: 'child', label: 'طفل', group: 'child', price: 800, max: 6 }] }, payment: { mode: 'full' } },
    home: { show: false }
  })));
  eventId = saved.event.id;
  world.as('');
}

/* the Worker, with five bookings as visitors (and one admin) left them */
function freshWorker({ module = { on: true, env: 'production' } } = {}) {
  fake = createBookWorker({
    origin: LOCAL,
    proofBytes: proofPng,
    event: {
      id: eventId, slug: 'alex-trip', title: 'رحلة إسكندرية', startAt: '2026-11-04T07:00', endAt: '2026-11-04T22:00', capacity: 40,
      perBookingMax: 10, collectNames: false, pricing: PRICING, payment: { mode: 'full', minFirst: 0, finalDueAt: '' }, methods: METHODS, servants: SERVANTS
    }
  });
  fake.state.module = module;
  fake.seed({ ref: 'B-AAAA1', name: 'مريم سمير', phone: '+201012345678', counts: { applicant: 1, child: 1 }, servantId: 'srv-mina', method: 'instapay', proofs: 1, flags: { phoneTwice: true }, createdAt: '2026-10-12T09:00' });
  fake.seed({ ref: 'B-BBBB2', name: 'بيتر نبيل', phone: '+201112223334', counts: { applicant: 1 }, servantId: 'srv-fady', method: 'cash', proofs: 1, flags: { dupProof: true }, createdAt: '2026-10-13T09:00' });
  fake.seed({ ref: 'B-CCCC3', name: 'كيرلس عماد', phone: '+201234567890', counts: { applicant: 1, adult: 1 }, servantId: 'srv-fady', method: 'cash', status: 'confirmed', amountDue: 3000,
    paid: [{ amount: 1000, servantId: 'srv-fady', method: 'cash' }], overdue: true, createdAt: '2026-10-09T09:00' });
  fake.seed({ ref: 'B-DDDD4', name: 'ماريان فادي', phone: '+201555666777', counts: { applicant: 1 }, servantId: 'srv-mina', method: 'cash', status: 'rejected', paid: [{ amount: 500 }], createdAt: '2026-10-08T09:00' });
  fake.seed({ ref: 'B-EEEE5', name: 'جورج سامي', phone: '+201000000001', counts: { applicant: 1 }, servantId: 'srv-mina', method: 'cash', status: 'confirmed', amountDue: 1500,
    paid: [{ amount: 1500, servantId: 'srv-mina', method: 'cash' }], createdAt: '2026-10-07T09:00' });
  return fake;
}

/* the published event.json (a manual booking reads its prices from it) */
const EVENT_JSON = () => ({
  schema: 1, id: eventId, slug: 'alex-trip', title: 'رحلة إسكندرية', startAt: '2026-11-04T07:00', endAt: '2026-11-04T22:00',
  booking: { online: true, capacity: 40, perBookingMax: 10, collectNames: false, pricing: PRICING, payment: { mode: 'full', minFirst: 0, finalDueAt: '' },
    methods: METHODS.map(m => ({ key: m.key, label: m.label, icon: '' })), servants: SERVANTS.map(s => ({ ...s, role: '', image: null, wa: null })) }
});

async function handle(request) {
  const url = request.url();
  if (url.split('?')[0] === `${LOCAL}/events/alex-trip/event.json`) {
    return { status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(EVENT_JSON()) };
  }
  if (abortModule && url.startsWith(`${WORKER_URL}/v1/admin/book/module`) && request.method() !== 'OPTIONS') return 'abort';
  return fake ? fake.handle(request) : null;
}

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  proofPng = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#d7aa50' } }).png().toBuffer();
  proofFile = join(TMP, 'proof.png');
  writeFileSync(proofFile, await sharp({ create: { width: 300, height: 500, channels: 3, background: '#4cc3cb' } }).png().toBuffer());
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

async function open({ viewport = DESKTOP, path = '', hash = '', before = '', ua = null, context = null } = {}) {
  context = context || await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const outside = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(`csp: ${message.text()}`);
  });
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  if (ua) await page.setUserAgent(ua);
  await page.setViewport(viewport);
  await interceptGoogle(page, { post: body => world.post(body) }, { handle, outside });
  if (before) await page.evaluateOnNewDocument(before);
  await page.goto(`${LOCAL}/admin/${path}${hash}`, { waitUntil: 'networkidle0' });
  return { context, page, problems, outside };
}

async function signIn(page) {
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
}

const subtabs = page => page.$$eval('#subtabs .tab', nodes => nodes.map(n => n.textContent.trim()));
const sheetText = page => page.$eval('#sheet', n => n.innerText);
/* the money tiles of the open booking: { label: value } */
const tiles = page => page.$$eval('#sheet .book-money .comp-tile', nodes => Object.fromEntries(nodes.map(n => [n.querySelector('.comp-tile__label').textContent, n.querySelector('.comp-tile__n').textContent])));
const rows = page => page.$$eval('.book-row', nodes => nodes.map(n => n.dataset.ref));
const shot = async (page, name) => { await sleep(400); await page.screenshot({ path: `${SHOTS}${name}.png` }); };

async function waitRows(page, refs) {
  await page.waitForFunction(want => JSON.stringify(Array.from(document.querySelectorAll('.book-row'), n => n.dataset.ref).sort()) === JSON.stringify(want.slice().sort()), { timeout: 8000 }, refs);
}

async function clickAct(page, act, scope = '#sheet') {
  await page.waitForSelector(`${scope} [data-act="${act}"]:not([disabled])`, { visible: true });
  await page.click(`${scope} [data-act="${act}"]`);
}

/* a field in the open sheet, by its label */
async function fill(page, label, value) {
  const handle = await page.waitForSelector(`#sheet .field[data-label="${label}"] input:not([type=checkbox]):not([type=radio]):not([type=file]), #sheet .field[data-label="${label}"] textarea`, { visible: true });
  await handle.click({ clickCount: 3 });
  await handle.evaluate(n => { n.value = ''; });
  await handle.type(String(value));
}

async function pick(page, label, value) {
  await page.select(`#sheet .field[data-label="${label}"] select`, value);
}

async function sheetTitle(page, text) {
  await page.waitForFunction(t => { const n = document.querySelector('#sheet[open] .sheet__title'); return n && n.textContent === t; }, { timeout: 8000 }, text);
}

async function openBookings(page) {
  await page.evaluate(() => A.go('pages', 'events'));
  await page.waitForSelector('[data-act="book-open"]', { visible: true, timeout: 8000 });
  await page.click('[data-act="book-open"]');
  await page.waitForSelector('.book-row');
}

async function closeSheet(page) {
  await page.evaluate(() => A.closeSheet());
  await page.waitForFunction(() => !document.getElementById('sheet').open);
}

const lastWrite = (path) => fake.writes().filter(c => path.test(c.path)).at(-1);


/* ---------------- off: nothing changes ---------------- */

test('module off (and 401 / 403 / unreachable): no «الحجوزات» anywhere, no dialog, the events screen as before', async () => {
  freshWorker({ module: { on: false, env: 'production' } });
  const d = await open();
  await signIn(d.page);
  await d.page.waitForFunction(() => A.book.off === true, { timeout: 8000 });
  await d.page.evaluate(() => A.go('pages', 'events'));
  await d.page.waitForSelector(`.item`);
  await sleep(900);
  assert.deepEqual(await subtabs(d.page), ['صفحات الخدمة', 'الفعاليات', 'الخدام']);
  assert.equal(await d.page.$('.book-link'), null, 'not even a hidden slot on the event');
  // (besides boot.js's quiet sign-in check, unchanged)
  const asked = fake.state.calls.filter(c => c.path !== '/v1/admin/whoami');
  assert.deepEqual(asked.map(c => `${c.method} ${c.path}`), ['GET /v1/admin/book/module'], 'one quiet question, nothing else');
  assert.match(asked[0].auth, /^Bearer \S+/, 'the Google ID token');
  // a push link to the bookings goes nowhere; the events editor has no booking button either
  assert.equal(await d.page.evaluate(id => A.openLink('#open/bookings/' + id), eventId), false);
  await d.page.click('.item .icon-btn[aria-label^="تعديل"]');
  await d.page.waitForSelector('#sheet[open]');
  assert.doesNotMatch(await sheetText(d.page), /الحجوزات|حدّث بيانات الفعالية/);
  await closeSheet(d.page);
  assert.deepEqual(d.problems, []);
  await d.context.close();

  for (const variant of ['401', '403', 'abort', '500']) {
    freshWorker();
    abortModule = variant === 'abort';
    if (variant !== 'abort') fake.state.moduleReply = { status: Number(variant), body: JSON.stringify({ ok: false, code: variant === '401' ? 'auth' : variant === '403' ? 'denied' : 'error', message: 'x' }) };
    const v = await open();
    await signIn(v.page);
    await v.page.evaluate(() => A.go('pages', 'events'));
    await sleep(variant === '401' || variant === '403' ? 1200 : 3800);
    assert.deepEqual(await subtabs(v.page), ['صفحات الخدمة', 'الفعاليات', 'الخدام'], variant);
    assert.equal(await v.page.$('dialog.reauth'), null, `${variant}: no sign-in dialog`);
    assert.equal(await v.page.$('.toast--error'), null, `${variant}: no error toast`);
    assert.ok(fake.state.calls.every(c => c.path === '/v1/admin/book/module' || c.path === '/v1/admin/whoami'), variant);
    assert.deepEqual(v.problems, [], variant);
    await v.context.close();
  }
  abortModule = false;
});


/* ---------------- on: the queue, the sheet, confirm, warn, busy, conflict, cancel ---------------- */

test('module on: the tab, «الحجوزات (٢ جديد)», chips with counts, search, the last answer at once', async () => {
  freshWorker();
  const d = await open();
  await signIn(d.page);
  await d.page.evaluate(() => A.go('pages', 'events'));
  await d.page.waitForFunction(() => { const b = document.querySelector('[data-act="book-open"]'); return b && /الحجوزات \(٢ جديد\)/.test(b.textContent); }, { timeout: 8000 });
  assert.deepEqual(await subtabs(d.page), ['صفحات الخدمة', 'الفعاليات', 'الخدام', 'الحجوزات']);
  await d.page.click('[data-act="book-open"]');
  await waitRows(d.page, ['B-AAAA1', 'B-BBBB2']);
  assert.equal(await d.page.evaluate(() => A.sub.pages), 'bookings');
  const chips = await d.page.$$eval('.book-chips .filter-chip', n => n.map(x => x.textContent));
  assert.deepEqual(chips, ['الجديدة (٢)', 'المؤكدة (٢)', 'متأخر (١)', 'مرتجعات مطلوبة (١)', 'المرفوضة والملغية (١)', 'الكل (٥)']);
  const first = await d.page.$eval('.book-row[data-ref="B-AAAA1"]', n => n.innerText);
  assert.match(first, /مريم سمير/);
  assert.match(first, /01012345678/);
  assert.match(first, /الرقم ده عنده طلب تاني/);
  assert.match(await d.page.$eval('.book-row[data-ref="B-BBBB2"]', n => n.innerText), /إثبات متكرر/);
  await shot(d.page, '01-queue');

  // «المرفوضة والملغية»: three lists merged
  await d.page.click('[data-filter="closed"]');
  await waitRows(d.page, ['B-DDDD4']);
  const statuses = fake.state.calls.filter(c => c.path === '/v1/admin/book/bookings').map(c => new URLSearchParams(c.query).get('status'));
  assert.deepEqual(statuses.slice(-3).sort(), ['cancelled', 'rejected', 'withdrawn']);
  await d.page.click('[data-filter="overdue"]');
  await waitRows(d.page, ['B-CCCC3']);
  await d.page.click('[data-filter="refunds"]');
  await waitRows(d.page, ['B-DDDD4']);
  await d.page.click('[data-filter="all"]');
  await waitRows(d.page, ['B-AAAA1', 'B-BBBB2', 'B-CCCC3', 'B-DDDD4', 'B-EEEE5']);
  // back to a chip seen before: its last answer is on screen at once, before any reply
  const instant = await d.page.evaluate(() => {
    document.querySelector('[data-filter="pending"]').click();
    return Array.from(document.querySelectorAll('.book-row'), n => n.dataset.ref).sort();
  });
  assert.deepEqual(instant, ['B-AAAA1', 'B-BBBB2']);

  // search: ref, then a phone's last digits (server side, q)
  await d.page.type('input[type="search"][aria-label="دوّر في الحجوزات"]', 'B-BBBB2');
  await waitRows(d.page, ['B-BBBB2']);
  assert.equal(new URLSearchParams(fake.state.calls.filter(c => c.path === '/v1/admin/book/bookings').at(-1).query).get('q'), 'B-BBBB2');
  await d.page.$eval('input[type="search"][aria-label="دوّر في الحجوزات"]', n => { n.value = ''; n.dispatchEvent(new Event('input')); });
  await waitRows(d.page, ['B-AAAA1', 'B-BBBB2']);
  assert.ok(fake.state.calls.every(c => /^Bearer /.test(c.auth)));
  assert.deepEqual(d.problems, []);
  await d.context.close();
});

test('the booking sheet + confirm with the first payment: needs_override → «أكّد برضه»; then warn → «سجّل برضه», busy retried with the same key, a conflict reloads, cancel with retain', async () => {
  freshWorker();
  const d = await open();
  await signIn(d.page);
  await openBookings(d.page);

  // the sheet: flags, proofs through blob: URLs (never the API in <img>), the money
  await d.page.click('.book-row[data-ref="B-AAAA1"]');
  await sheetTitle(d.page, 'حجز B-AAAA1');
  await d.page.waitForFunction(() => { const img = document.querySelector('#sheet .book-proof img'); return img && !img.hidden && img.src.startsWith('blob:') && img.complete && img.naturalWidth === 40; }, { timeout: 8000 });
  const text = await sheetText(d.page);
  assert.match(text, /نفس الموبايل عنده طلب تاني مستني المراجعة/);
  assert.equal((await tiles(d.page))['السعر'], '٢٬٣٠٠ ج');
  assert.match(text, /الحاجز × ١/);
  assert.ok(fake.state.calls.some(c => /^\/v1\/admin\/proofs\/prf-/.test(c.path)), 'the proof fetched with the token');
  assert.ok(!(await d.page.$$eval('#sheet img', n => n.map(i => i.src))).some(src => src.startsWith(WORKER_URL)));
  await shot(d.page, '02-sheet');

  // confirm: actual from the request, amountDue the quote, the first payment prefilled (servant, method, the visitor's proof), amount empty
  await clickAct(d.page, 'confirm');
  await sheetTitle(d.page, 'تأكيد B-AAAA1');
  assert.equal(await d.page.$eval('#sheet .field[data-label="المطلوب"] input', n => n.value), '2300');
  assert.equal(await d.page.$eval('#sheet .field[data-label="الخادم"] select', n => n.value), 'srv-mina');
  assert.equal(await d.page.$eval('#sheet .field[data-label="طريقة الدفع"] select', n => n.value), 'instapay');
  assert.equal(await d.page.$eval('#sheet .field[data-label="المبلغ"] input', n => n.value), '');
  assert.equal(await d.page.$eval('#sheet .book-uploads input[type=checkbox]', n => n.checked), true);
  // the client says what the server would refuse: a receivedAt in the future
  await fill(d.page, 'المبلغ', '1000');
  await d.page.$eval('#sheet .field[data-label="وقت الاستلام"] input[type=date]', n => { n.value = '2099-01-01'; n.dispatchEvent(new Event('input')); });
  const before = fake.writes().length;
  await clickAct(d.page, 'submit');
  await d.page.waitForSelector('#sheet .field--invalid[data-label="وقت الاستلام"]');
  assert.equal(fake.writes().length, before, 'nothing sent');
  await d.page.click('#sheet .field[data-label="وقت الاستلام"] .preset');
  await clickAct(d.page, 'submit');
  // full payment mode: 1000 of 2300 → the reason, then «أكّد برضه» with a reason
  await d.page.waitForSelector('#sheet .book-warn:not([hidden])');
  assert.match(await d.page.$eval('#sheet .book-warn', n => n.innerText), /الدفع كامل: المدفوع أقل من المطلوب/);
  await fill(d.page, 'سبب التأكيد برضه', 'الباقي في الأتوبيس');
  await clickAct(d.page, 'override');
  await sheetTitle(d.page, 'حجز B-AAAA1');
  await d.page.waitForFunction(() => /مؤكد/.test(document.querySelector('#sheet .book-chips').innerText));
  const confirms = fake.writes().filter(c => /\/confirm$/.test(c.path));
  assert.equal(confirms.length, 2);
  assert.equal(confirms[0].body.overridePay, undefined);
  assert.equal(confirms[1].body.overridePay, true);
  assert.equal(confirms[1].body.reason, 'الباقي في الأتوبيس');
  assert.deepEqual(confirms[1].body.actual, { applicant: 1, adult: 0, child: 1 });
  assert.equal(confirms[1].body.amountDue, 2300);
  assert.equal(confirms[1].body.version, 1);
  const pay = confirms[1].body.payments[0];
  assert.deepEqual({ kind: pay.kind, amount: pay.amount, servantId: pay.servantId, method: pay.method }, { kind: 'payment', amount: 1000, servantId: 'srv-mina', method: 'instapay' });
  assert.deepEqual(pay.proofIds, fake.state.proofs.filter(p => p.purpose === 'visitor' && p.bookingId === fake.find('B-AAAA1').id).map(p => p.id), 'the visitor\'s proof attached');
  assert.match(pay.idemKey, /^pay-[0-9a-f]{24}$/);
  assert.match(pay.receivedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.ok(confirms[0].key && confirms[1].key && confirms[0].key !== confirms[1].key, 'a changed body is another write');
  assert.equal(fake.find('B-AAAA1').status, 'confirmed');
  assert.equal((await tiles(d.page))['المدفوع'], '١٬٠٠٠ ج');

  // a payment the servant doesn't take that way: the warning, then «سجّل برضه» (force, a new key)
  await clickAct(d.page, 'payment');
  await pick(d.page, 'الخادم', 'srv-fady');
  await pick(d.page, 'طريقة الدفع', 'instapay');
  await fill(d.page, 'المبلغ', '300');
  await clickAct(d.page, 'submit');
  await d.page.waitForSelector('#sheet .book-warn:not([hidden])');
  assert.match(await d.page.$eval('#sheet .book-warn', n => n.innerText), /الخادم ده مش بيقبل الطريقة دي/);
  await shot(d.page, '03-warn');
  await clickAct(d.page, 'force');
  await sheetTitle(d.page, 'حجز B-AAAA1');
  const payWrites = fake.writes().filter(c => /\/payments$/.test(c.path));
  assert.equal(payWrites.length, 2);
  assert.equal(payWrites[0].body.force, undefined);
  assert.equal(payWrites[1].body.force, true);
  assert.notEqual(payWrites[0].body.idemKey, payWrites[1].body.idemKey);
  assert.equal(payWrites[1].key, payWrites[1].body.idemKey, 'the header carries the same key');
  assert.equal((await tiles(d.page))['المدفوع'], '١٬٣٠٠ ج');

  // money is never optimistic: the button waits for the server; a «busy» is tried again with the SAME key
  fake.inject('POST', /\/payments$/, 'busy');
  await clickAct(d.page, 'payment');
  await fill(d.page, 'المبلغ', '1000');
  await clickAct(d.page, 'submit');
  await d.page.waitForSelector('#sheet [data-act="submit"][aria-busy="true"]', { timeout: 2000 });
  await sheetTitle(d.page, 'حجز B-AAAA1');
  const tries = fake.writes().filter(c => /\/payments$/.test(c.path)).slice(-2);
  assert.equal(tries[0].key, tries[1].key, 'the same Idempotency-Key');
  assert.deepEqual(tries[0].body, tries[1].body);
  assert.equal(fake.state.payments.filter(p => p.bookingId === fake.find('B-AAAA1').id && p.amount === 1000 && p.kind === 'payment').length, 2, 'the first payment + this one, once');
  assert.equal((await tiles(d.page))['المدفوع'], '٢٬٣٠٠ ج');

  // someone else changed it meanwhile: «حد عدّل الحجز ده، اتحدّث» and the booking read again
  const b = fake.find('B-AAAA1');
  fake.inject('POST', /\/cancel$/, 'conflict', {}, 1, () => { b.version++; b.adminNote = 'عدّلها فادي'; });
  await clickAct(d.page, 'cancel');
  await fill(d.page, 'السبب', 'اعتذرت');
  await clickAct(d.page, 'submit');
  await d.page.waitForFunction(() => /حد عدّل الحجز ده، اتحدّث/.test(document.querySelector('#sheet').innerText), { timeout: 8000 });
  await d.page.waitForFunction(() => /عدّلها فادي/.test(document.querySelector('#sheet').innerText), { timeout: 8000 });
  await shot(d.page, '04-conflict');

  // cancel with a retained fee: retain ≤ paid (said before sending), then the rest is a refund owed
  await clickAct(d.page, 'cancel');
  await fill(d.page, 'السبب', 'اعتذرت');
  await fill(d.page, 'المبلغ اللي هيتخصم', '5000');
  await clickAct(d.page, 'submit');
  await d.page.waitForSelector('#sheet .field--invalid[data-label="المبلغ اللي هيتخصم"]');
  await fill(d.page, 'المبلغ اللي هيتخصم', '300');
  assert.match(await sheetText(d.page), /المرتجع المطلوب بعد الإلغاء: ٢٬٠٠٠ ج/);
  await clickAct(d.page, 'submit');
  await sheetTitle(d.page, 'حجز B-AAAA1');
  const cancel = lastWrite(/\/cancel$/);
  assert.deepEqual({ reason: cancel.body.reason, retain: cancel.body.retain, version: cancel.body.version }, { reason: 'اعتذرت', retain: 300, version: b.version - 1 });
  assert.equal((await tiles(d.page))['مرتجع مطلوب'], '٢٬٠٠٠ ج');
  assert.equal(b.status, 'cancelled');
  assert.deepEqual(d.problems, []);
  await d.context.close();
});

test('reject with money → «مرتجعات مطلوبة» → refund (a proof uploaded) → void → reopen', async () => {
  freshWorker();
  const d = await open();
  await signIn(d.page);
  await openBookings(d.page);

  await d.page.click('.book-row[data-ref="B-BBBB2"]');
  await sheetTitle(d.page, 'حجز B-BBBB2');
  assert.match(await sheetText(d.page), /صورة الإثبات دي اتبعتت قبل كده في حجز تاني/);
  await clickAct(d.page, 'reject');
  await d.page.click('#sheet [data-reason="الدفع مش واضح"]');
  await d.page.$eval('#sheet .choice input[value="yes"]', n => n.click());
  await fill(d.page, 'المبلغ', '1500');
  await shot(d.page, '05-reject');
  await clickAct(d.page, 'submit');
  await sheetTitle(d.page, 'حجز B-BBBB2');
  const reject = lastWrite(/\/reject$/);
  assert.equal(reject.body.reason, 'الدفع مش واضح');
  assert.equal(reject.body.payments[0].amount, 1500);
  assert.equal(reject.body.payments[0].servantId, 'srv-fady');
  assert.equal((await tiles(d.page))['مرتجع مطلوب'], '١٬٥٠٠ ج');
  await closeSheet(d.page);
  await d.page.click('[data-filter="refunds"]');
  await waitRows(d.page, ['B-BBBB2', 'B-DDDD4']);

  // the refund: prefilled with the refund owed, a proof prepared and uploaded raw first
  await d.page.click('.book-row[data-ref="B-BBBB2"]');
  await sheetTitle(d.page, 'حجز B-BBBB2');
  await clickAct(d.page, 'refund');
  assert.equal(await d.page.$eval('#sheet .field[data-label="المبلغ"] input', n => n.value), '1500');
  const input = await d.page.$('#sheet .book-payblock input[type=file]');
  await input.uploadFile(proofFile);
  await d.page.waitForFunction(() => /اترفع ✓/.test(document.querySelector('#sheet .book-uploads').innerText), { timeout: 8000 });
  const upload = fake.writes().filter(c => c.path === '/v1/admin/proofs').at(-1);
  assert.match(upload.query, /purpose=payment&bookingId=bk-/);
  assert.match(upload.contentType, /^image\/(webp|jpeg)$/);
  assert.ok(upload.key, 'the upload carries an Idempotency-Key');
  await clickAct(d.page, 'submit');
  await sheetTitle(d.page, 'حجز B-BBBB2');
  const refund = lastWrite(/\/payments$/);
  assert.equal(refund.body.kind, 'refund');
  assert.equal(refund.body.amount, 1500);
  assert.equal(refund.body.proofIds.length, 1);
  assert.equal((await tiles(d.page))['مرتجع مطلوب'], undefined);

  // void the refund (a reason): struck through, not counted, the refund owed back
  const refundId = fake.state.payments.filter(p => p.kind === 'refund').at(-1).id;
  await d.page.click(`#sheet .book-pay[data-payment="${refundId}"] [data-act="void"]`);
  await clickAct(d.page, 'submit');
  await d.page.waitForSelector('#sheet .field--invalid[data-label="السبب"]');
  await fill(d.page, 'السبب', 'اتسجل مرتين');
  await clickAct(d.page, 'submit');
  await sheetTitle(d.page, 'حجز B-BBBB2');
  await d.page.waitForSelector(`#sheet .book-pay.is-void[data-payment="${refundId}"]`);
  assert.match(await d.page.$eval(`#sheet .book-pay[data-payment="${refundId}"]`, n => n.innerText), /اتلغت: اتسجل مرتين/);
  assert.equal(await d.page.$(`#sheet .book-pay[data-payment="${refundId}"] [data-act="void"]`), null, 'a void can\'t be voided');
  const voidCall = lastWrite(/\/void$/);
  assert.equal(voidCall.body.reason, 'اتسجل مرتين');
  assert.match(voidCall.body.idemKey, /^void-/);
  assert.equal((await tiles(d.page))['مرتجع مطلوب'], '١٬٥٠٠ ج');
  await shot(d.page, '06-void');

  // reopen the rejected request
  await clickAct(d.page, 'reopen');
  await d.page.waitForSelector('dialog.modal[open] .btn--primary');
  await d.page.click('dialog.modal[open] .btn--primary');
  await d.page.waitForFunction(() => /جديد/.test(document.querySelector('#sheet .book-chips').innerText), { timeout: 8000 });
  assert.equal(fake.find('B-BBBB2').status, 'pending');
  assert.ok(await d.page.$('#sheet [data-act="confirm"]'), 'pending again: confirm / reject');
  await closeSheet(d.page);

  // update a confirmed booking: one more child → the new quote offered → amount due with a reason, the admin note
  await d.page.click('[data-filter="confirmed"]');
  await waitRows(d.page, ['B-CCCC3', 'B-EEEE5']);
  await d.page.click('.book-row[data-ref="B-EEEE5"]');
  await sheetTitle(d.page, 'حجز B-EEEE5');
  await clickAct(d.page, 'update');
  await d.page.$eval('#sheet input[data-cat="child"]', n => { n.value = '1'; n.dispatchEvent(new Event('input')); });
  await d.page.waitForFunction(() => /السعر بالعدد ده ٢٬٣٠٠ ج — استخدمه/.test(document.querySelector('#sheet [data-act="use-quote"]').textContent));
  await d.page.click('#sheet [data-act="use-quote"]');
  assert.equal(await d.page.$eval('#sheet .field[data-label="المطلوب"] input', n => n.value), '2300');
  await fill(d.page, 'ملاحظة الأدمن', 'هيركب من الغردقة');
  await clickAct(d.page, 'submit');
  await d.page.waitForSelector('#sheet .field--invalid[data-label="السبب"]');
  await fill(d.page, 'السبب', 'زوّد طفل');
  await clickAct(d.page, 'submit');
  await sheetTitle(d.page, 'حجز B-EEEE5');
  const update = lastWrite(/\/update$/);
  assert.deepEqual(update.body, { version: 1, actual: { applicant: 1, adult: 0, child: 1 }, amountDue: 2300, reason: 'زوّد طفل', adminNote: 'هيركب من الغردقة' });
  assert.equal((await tiles(d.page))['المطلوب'], '٢٬٣٠٠ ج');
  assert.equal((await tiles(d.page))['الباقي'], '٨٠٠ ج');
  assert.match(await sheetText(d.page), /١٬٥٠٠ ج ← ٢٬٣٠٠ ج — زوّد طفل/);
  assert.match(await sheetText(d.page), /هيركب من الغردقة/);
  assert.deepEqual(d.problems, []);
  await d.context.close();
});

test('a manual booking confirmed in the same dialog; summary + XLSX (the phone warning first); cancelling the whole event', async () => {
  freshWorker();
  const d = await open();
  await signIn(d.page);
  await openBookings(d.page);

  await d.page.click('[data-act="book-new"]');
  await sheetTitle(d.page, 'حجز يدوي: رحلة إسكندرية');
  await fill(d.page, 'الاسم', 'فيرونيا عادل');
  await fill(d.page, 'الموبايل', '٠١٠٩٨٧٦٥٤٣٢');
  await d.page.$eval('#sheet input[data-cat="child"]', n => { n.value = '1'; n.dispatchEvent(new Event('input')); });
  assert.match(await sheetText(d.page), /السعر: ٢٬٣٠٠ ج/);
  await pick(d.page, 'الخادم', 'srv-mina');
  await d.page.$eval('#sheet label.check:not(.check--inline) input[type=checkbox]', n => n.click());
  await fill(d.page, 'المبلغ', '2300');
  assert.equal(await d.page.$eval('#sheet .book-payblock .field[data-label="الخادم"] select', n => n.value), 'srv-mina', 'the first payment follows the chosen servant');
  await pick(d.page, 'طريقة الدفع', 'cash');
  await shot(d.page, '07-manual');
  await clickAct(d.page, 'submit');
  await d.page.waitForFunction(() => /^حجز B-ADM/.test((document.querySelector('#sheet[open] .sheet__title') || {}).textContent || ''), { timeout: 8000 });
  const made = lastWrite(/^\/v1\/admin\/book\/bookings$/);
  assert.match(made.body.requestKey, /^adm-[0-9a-f]{24}$/);
  assert.deepEqual(made.body.counts, { applicant: 1, adult: 0, child: 1 });
  assert.equal(made.body.phone, '+201098765432', 'normalized (Arabic digits too)');
  assert.equal(made.body.confirm.amountDue, 2300);
  assert.equal(made.body.confirm.payments[0].amount, 2300);
  assert.match(await sheetText(d.page), /حجز يدوي/);
  assert.match(await sheetText(d.page), /مؤكد/);
  await closeSheet(d.page);

  // summary per servant, then the XLSX after the phone warning
  await d.page.click('[data-act="book-summary"]');
  await sheetTitle(d.page, 'الملخص والحسابات: رحلة إسكندرية');
  await d.page.waitForSelector('#sheet .book-servants [data-servant="srv-mina"]');
  assert.match(await d.page.$eval('#sheet .book-servants [data-servant="srv-mina"]', n => n.innerText), /٤٬٣٠٠ ج/);
  await shot(d.page, '08-summary');
  await clickAct(d.page, 'export');
  await d.page.waitForSelector('dialog.modal[open]');
  assert.match(await d.page.$eval('dialog.modal[open]', n => n.innerText), /الملف فيه أرقام تليفونات، ماتبعتوش في جروبات/);
  await d.page.click('dialog.modal[open] .btn--primary');
  await d.page.waitForFunction(() => A.book.lastDownload, { timeout: 8000 });
  const file = await d.page.evaluate(() => ({ filename: A.book.lastDownload.filename, bytes: Array.from(A.book.lastDownload.bytes) }));
  assert.match(file.filename, /^حجوزات-alex-trip-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const book = await readXlsx(Uint8Array.from(file.bytes));
  assert.deepEqual(book.sheets.map(s => s.name), ['ملخص', 'حسب الخادم', 'الحجوزات', 'الدفعات', 'مينا عادل', 'فادي يوسف']);
  assert.deepEqual(book.sheets[2].rows[0].slice(0, 4), ['الرقم', 'الحالة', 'الاسم', 'الموبايل']);
  assert.equal(book.sheets[2].rows.length, 1 + 6);
  assert.ok(book.sheets[2].rows.some(r => r[3] === '+201098765432'), 'the phone as text');
  assert.deepEqual(book.sheets[3].rows[0].slice(0, 3), ['رقم الدفعة', 'رقم الحجز', 'الاسم']);
  assert.equal(book.sheets[4].rows.at(-1)[0], 'الإجمالي');
  await closeSheet(d.page);

  // the event is cancelled: a typed confirmation and a reason; everyone who paid → «مرتجعات مطلوبة»
  await d.page.click('[data-act="book-cancel-all"]');
  await sheetTitle(d.page, 'إلغاء الفعالية: رحلة إسكندرية');
  await fill(d.page, 'السبب', 'الرحلة اتلغت بسبب الجو');
  await clickAct(d.page, 'submit');
  await d.page.waitForSelector('#sheet .errors:not([hidden])');
  assert.equal(fake.writes().filter(c => /cancel-all/.test(c.path)).length, 0, 'not without the word');
  await fill(d.page, 'التأكيد', 'إلغاء');
  await clickAct(d.page, 'submit');
  await d.page.waitForFunction(() => !document.getElementById('sheet').open, { timeout: 8000 });
  const all = lastWrite(/cancel-all$/);
  assert.equal(all.path, `/v1/admin/book/events/${eventId}/cancel-all`);
  assert.equal(all.body.reason, 'الرحلة اتلغت بسبب الجو');
  assert.equal(all.key, all.body.idemKey);
  await d.page.waitForSelector('[data-filter="refunds"][aria-pressed="true"]');
  assert.deepEqual(fake.state.bookings.map(b => b.status).sort(), ['cancelled', 'cancelled', 'cancelled', 'cancelled', 'cancelled', 'rejected']);
  assert.deepEqual(d.problems, []);
  await d.context.close();
});

test('edit locks: another admin holds the booking → who and since when, read only, no move sent; free again → «افتح آخر نسخة»; refused mid-way → told; closing gives it back', async () => {
  freshWorker();
  fake.state.lockHolder = { name: 'فادي يوسف', since: 125 };
  fake.state.lockRenew = 1200;
  const d = await open();
  await signIn(d.page);
  await openBookings(d.page);
  await d.page.click('.book-row[data-ref="B-AAAA1"]');
  await sheetTitle(d.page, 'حجز B-AAAA1');
  await d.page.waitForSelector('#sheet.is-locked .lock-banner[data-lock="held"]');
  assert.equal(await d.page.$eval('#sheet .lock-banner__title', n => n.textContent), 'فادي يوسف بيعدّل الحجز ده دلوقتي (من دقيقتين)');
  for (const act of ['confirm', 'reject']) assert.equal(await d.page.$eval(`#sheet [data-act="${act}"]`, n => n.disabled), true, act);
  assert.equal(await d.page.$eval('#sheet .book-proof', n => n.disabled), false, 'the proofs stay viewable');
  await shot(d.page, '09-locked');
  const lockCalls = () => fake.state.calls.filter(c => /\/lock$/.test(c.path));
  await d.page.waitForFunction(() => true);
  assert.equal(lockCalls()[0].method, 'POST');
  assert.equal(fake.writes().filter(c => !/\/lock$/.test(c.path)).length, 0, 'nothing sent');
  // one edit session per page load, on every Worker call
  assert.equal(fake.state.sessions.size, 1);
  assert.match([...fake.state.sessions][0], /^es[0-9a-f]{24}$/);

  // the other admin is done: the next renewal says free → «افتح آخر نسخة» → the sheet as it is now, moves back
  fake.state.lockHolder = null;
  await d.page.waitForSelector('#sheet .lock-banner[data-lock="free"] [data-lock-refresh]', { timeout: 6000 });
  assert.equal(await d.page.$eval('#sheet .lock-banner__title', n => n.textContent), 'فادي يوسف خلّص التعديل.');
  await d.page.click('#sheet [data-lock-refresh]');
  await d.page.waitForFunction(() => { const s = document.getElementById('sheet'); return s.open && !s.classList.contains('is-locked') && !s.querySelector('.lock-banner'); });
  assert.equal(await d.page.$eval('#sheet [data-act="confirm"]', n => n.disabled), false);

  // taken in between (the server refuses the move): told who, the booking again, read only
  await clickAct(d.page, 'reject');
  await sheetTitle(d.page, 'رفض B-AAAA1');
  await fill(d.page, 'السبب', 'مكرر');
  fake.state.lockHolder = { name: 'فادي يوسف', since: 3 };
  await d.page.click('#sheet [data-act="submit"]');
  await sheetTitle(d.page, 'حجز B-AAAA1');
  await d.page.waitForSelector('#sheet.is-locked .lock-banner[data-lock="held"]');
  assert.equal(await d.page.$eval('#sheet .lock-banner__title', n => n.textContent), 'فادي يوسف بيعدّل الحجز ده دلوقتي (من أقل من دقيقة)');
  assert.equal(fake.find('B-AAAA1').status, 'pending');

  // closing the sheet gives the lock back
  fake.state.lockHolder = null;
  await closeSheet(d.page);
  await d.page.waitForFunction(() => true);
  await sleep(300);
  assert.equal(lockCalls().at(-1).method, 'DELETE');
  assert.deepEqual(d.problems, []);
  await d.context.close();
});

test('360px: the queue and the booking sheet fit (no sideways scroll)', async () => {
  freshWorker();
  const d = await open({ viewport: { width: 360, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, ua: ANDROID });
  await signIn(d.page);
  await d.page.evaluate(() => A.go('pages', 'bookings'));
  await d.page.waitForSelector('.book-row');
  assert.ok(await d.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'queue');
  await d.page.click('.book-row[data-ref="B-AAAA1"]');
  await sheetTitle(d.page, 'حجز B-AAAA1');
  assert.ok(await d.page.evaluate(() => { const s = document.querySelector('#sheet .sheet__body'); return s.scrollWidth <= s.clientWidth + 1; }), 'sheet');
  await shot(d.page, '09-phone-sheet');
  assert.deepEqual(d.problems, []);
  await d.context.close();
});


/* ---------------- the installed app on its remembered device ---------------- */

function stage() {
  return `(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = q => /display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q);
    delete Navigator.prototype.getInstalledRelatedApps;
  })();`;
}

test('device session (the app\'s remembered phone): «الحجوزات محتاجة دخول بحساب جوجل» → Google → the queue; no device token ever reaches the Worker', async () => {
  freshWorker();
  const context = await browser.createBrowserContext();
  const devices = () => [...world.properties.keys()].filter(k => k.startsWith('ADMIN_DEVICE_'));
  const before = devices().length;
  const first = await open({ context, viewport: PHONE, ua: ANDROID, path: '?app=admin', before: stage() });
  await signIn(first.page);
  for (let i = 0; i < 40 && devices().length === before; i++) await sleep(150);
  assert.equal(devices().length, before + 1, 'this phone remembered');
  // and its key is stored on the phone (IndexedDB) before the app is closed
  await first.page.waitForFunction(() => new Promise(resolve => {
    const open = indexedDB.open('athanasios-admin-device');
    open.onsuccess = () => {
      try {
        const get = open.result.transaction('device').objectStore('device').get('current');
        get.onsuccess = () => resolve(!!get.result);
        get.onerror = () => resolve(false);
      } catch { resolve(false); }
    };
    open.onerror = () => resolve(false);
  }), { timeout: 8000, polling: 200 });
  await first.page.close();

  fake.state.calls.length = 0;
  const again = await open({ context, viewport: PHONE, ua: ANDROID, path: '?app=admin', before: stage() });
  await again.page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
  assert.equal(await again.page.$('.gis-stub'), null, 'in with the device, no Google');
  await sleep(800);
  assert.equal(fake.state.calls.length, 0, 'the device token is never sent to the Worker');
  await again.page.evaluate(() => A.go('pages', 'events'));
  await sleep(300);
  assert.deepEqual(await subtabs(again.page), ['صفحات الخدمة', 'الفعاليات', 'الخدام']);
  assert.equal(fake.state.calls.length, 0);

  // the admin push link → the bookings ask for Google first
  await again.page.evaluate(id => A.openLink('#open/bookings/' + id), eventId);
  await again.page.waitForSelector('[data-act="book-google"]');
  assert.match(await again.page.$eval('#view', n => n.innerText), /الحجوزات محتاجة دخول بحساب جوجل/);
  await shot(again.page, '10-device-google');
  await again.page.click('[data-act="book-google"]');
  await again.page.waitForSelector('dialog.reauth[open] .gis-stub', { timeout: 8000 });
  await again.page.click('dialog.reauth[open] .gis-stub');
  await again.page.waitForSelector('.book-row', { timeout: 10000 });
  assert.deepEqual((await rows(again.page)).sort(), ['B-AAAA1', 'B-BBBB2']);
  assert.ok(fake.state.calls.length > 0 && fake.state.calls.every(c => /^Bearer \S+/.test(c.auth)));
  assert.deepEqual(await subtabs(again.page), ['صفحات الخدمة', 'الفعاليات', 'الخدام', 'الحجوزات']);
  assert.deepEqual(again.problems, []);
  await context.close();
});
