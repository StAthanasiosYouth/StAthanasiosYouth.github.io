// «نقاطي» (points/index.html + assets/js/comp/portal.js) in headless Chrome
// against a MOCK of the public API (compCode, portalMe, portalReview,
// shopRedeem — docs/COMPETITIONS.md §5.1), answered in the browser the way
// Apps Script does it (POST → 302 → googleusercontent echo).
//
// Run: cd tools && node --test ../tests/comp-portal.e2e.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT } from '../tools/lib/gs.mjs';
import { PUSH_CONFIG } from '../assets/js/push-config.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 4962;
const BASE = `http://localhost:${PORT}`;
const API = PUSH_CONFIG.apiUrl;
const SHOTS = `${ROOT}tools/.cache/comp/`;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const PHONE = { width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const NARROW = { width: 280, height: 653, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1 };
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const IMG = { src: 'media/2026/img-af6b0c28.webp', thumb: 'media/2026/img-af6b0c28-480.webp', w: 1122, h: 1402, alt: 'كوباية الأسرة' };
const TOKEN_KEY = 'athanasios.portal.v1';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const PRIVATE = /^\/(apps-script|tools|tests|docs|node_modules)(\/|$)|\/\.|\.md$/i;

let server;
let browser;

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    try {
      if (PRIVATE.test(path)) throw new Error('private');
      const file = normalize(join(ROOT, path.endsWith('/') ? `${path}index.html` : path));
      if (!file.startsWith(normalize(ROOT)) || !statSync(file).isFile()) throw new Error('no');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(readFileSync(file));
    }
    catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404');
    }
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  server?.close();
});


/* =========================================================
   MOCK API
========================================================= */

function createMock({ wallet = true, shop = true, registry = true } = {}) {

  const m = {
    calls: [], outside: [], valid: 'pt1.good.sig', force: {}, busyOnce: false,
    balance: 1550, redemptions: [{ id: 'r-1', itemName: 'كتاب التسبحة', cost: 300, status: 'approved', requestedAt: '2026-10-09 18:00' }],
    ledger: [
      { amount: 700, kind: 'competition', note: '', compTitle: 'مسابقة يونان', createdAt: '2026-10-08 20:00' },
      { amount: -300, kind: 'redeem', note: 'كتاب التسبحة', compTitle: '', createdAt: '2026-10-09 18:00' },
      { amount: 1150, kind: 'manual', note: 'مكافأة الخدمة', compTitle: '', createdAt: '2026-10-09 19:00' }
    ],
    items: [
      { id: 'i-mug', name: 'كوباية الأسرة', description: 'كوباية سيراميك عليها شعار الأسرة', image: IMG, cost: 700, category: 'هدايا', available: 5, perPersonLeft: 2 },
      { id: 'i-bag', name: 'شنطة قماش', description: '', image: null, cost: 200, category: 'هدايا', available: 3, perPersonLeft: null },
      { id: 'i-book', name: 'كتاب القديس أثناسيوس', description: 'سيرة مبسطة', image: null, cost: 300, category: 'كتب', available: 0, perPersonLeft: null },
      { id: 'i-pen', name: 'قلم', description: '', image: null, cost: 100, category: 'كتب', available: null, perPersonLeft: 0 },
      { id: 'i-cap', name: 'كاب', description: '', image: null, cost: 150, category: 'هدايا', available: null, perPersonLeft: 1 },
      { id: 'i-shirt', name: 'تيشيرت', description: '', image: null, cost: 1000, category: 'هدايا', available: 9, perPersonLeft: 1 }
    ],
    keys: new Map()
  };

  const history = [
    { submissionId: 's-1', compId: 'cmp-1', title: 'مسابقة يونان', slug: 'quiz', submittedAt: '2026-10-08 20:00', status: 'graded', score: 7, maxScore: 10, pointsAwarded: 700, pending: 0, canReview: true },
    { submissionId: 's-2', compId: 'cmp-2', title: 'مسابقة الأصوام', slug: 'fasts', submittedAt: '2026-10-10 21:00', status: 'pending_review', score: 4, maxScore: 10, pending: 2, canReview: false }
  ];

  m.post = body => {
    const { fn, args } = JSON.parse(body);
    const arg = args[0] || {};
    m.calls.push({ fn, arg });
    if (!registry) return { ok: false, code: 'disabled', message: 'x' };
    if (fn === 'compCode') {
      return String(arg.code).replace(/[^0-9A-Z]/g, '') === 'ATH2345678A'
        ? { ok: true, participant: { name: 'مينا عادل', group: 'ثانوي' }, ptoken: m.valid }
        : { ok: false, code: 'code', message: 'الكود ده مش صح، راجع الحروف والأرقام.' };
    }
    if (arg.ptoken !== m.valid) return { ok: false, code: 'session', message: 'سجّل دخولك تاني' };
    if (fn === 'portalMe') {
      return {
        ok: true,
        participant: { name: 'مينا عادل', group: 'ثانوي' },
        features: { wallet, shop },
        ...(wallet ? { balance: m.balance, ledger: m.ledger } : {}),
        history,
        ...(shop ? { redemptions: m.redemptions, shop: m.items } : {})
      };
    }
    if (fn === 'portalReview') {
      if (arg.submissionId !== 's-1') return { ok: false, code: 'not_found', message: 'x' };
      return { ok: true, result: { status: 'graded', score: 7, maxScore: 10, review: [{ id: 'q1', type: 'single', text: 'يونان هرب لمدينة إيه؟', choices: [{ id: 'c1', text: 'نينوى' }, { id: 'c2', text: 'ترشيش' }], answer: 'c2', correct: 'c2', ok: true, pts: 7, explanation: 'يونان ١: ٣' }, { id: 'q2', type: 'truefalse', text: 'الحوت بلع يونان', choices: [], answer: 'f', correct: 't', ok: false, pts: 0, explanation: '' }] } };
    }
    if (fn === 'shopRedeem') {
      if (m.keys.has(arg.requestKey)) return m.keys.get(arg.requestKey);
      if (m.busyOnce) { m.busyOnce = false; return { ok: false, code: 'busy', message: 'ضغط' }; }
      if (m.force[arg.itemId]) return { ok: false, code: m.force[arg.itemId], message: 'x' };
      const item = m.items.find(i => i.id === arg.itemId);
      if (!item) return { ok: false, code: 'not_found', message: 'x' };
      if (item.available === 0) return { ok: false, code: 'stock', message: 'x' };
      if (item.perPersonLeft === 0) return { ok: false, code: 'per_person', message: 'x' };
      if (m.balance < item.cost) return { ok: false, code: 'insufficient', message: 'x' };
      m.balance -= item.cost;
      if (item.available !== null) item.available -= 1;
      if (item.perPersonLeft !== null) item.perPersonLeft -= 1;
      const redemption = { id: `r-${m.redemptions.length + 1}`, status: 'pending', itemName: item.name, cost: item.cost };
      m.redemptions = [{ ...redemption, requestedAt: '2026-10-11 12:00' }, ...m.redemptions];
      m.ledger = [{ amount: -item.cost, kind: 'redeem', note: item.name, compTitle: '', createdAt: '2026-10-11 12:00' }, ...m.ledger];
      const reply = { ok: true, redemption, balance: m.balance };
      m.keys.set(arg.requestKey, reply);
      return reply;
    }
    return { ok: false, code: 'bad', message: 'x' };
  };

  m.fns = name => m.calls.filter(c => c.fn === name);
  return m;

}


/* =========================================================
   PAGES
========================================================= */

async function open({ viewport = PHONE, mock = createMock(), bypassCSP = false, token = '' } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const echoes = new Map();
  let echo = 0;

  page.on('console', msg => { if (msg.type() === 'error' && /CSP|Content Security|Refused/i.test(msg.text())) problems.push(msg.text()); });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  await page.evaluateOnNewDocument(() => document.addEventListener('securitypolicyviolation', e => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)));
  if (token) await page.evaluateOnNewDocument((k, v) => { try { if (location.protocol === 'http:' && !sessionStorage.getItem(k + ':seeded')) { sessionStorage.setItem(k, v); sessionStorage.setItem(k + ':seeded', '1'); } } catch { /* about:blank */ } }, TOKEN_KEY, token);
  if (bypassCSP) await page.setBypassCSP(true);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport(viewport);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (url === API && request.method() === 'POST') {
      const key = `k${++echo}`;
      echoes.set(key, JSON.stringify(mock.post(request.postData() || '{}')));
      return request.respond({ status: 302, headers: { Location: `https://script.googleusercontent.com/macros/echo?user_content_key=${key}`, 'Access-Control-Allow-Origin': '*' }, body: '' });
    }
    if (url.startsWith('https://script.googleusercontent.com/macros/echo?')) {
      return request.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: echoes.get(new URL(url).searchParams.get('user_content_key')) || '{}' });
    }
    if (/^(https?:\/\/(localhost|127\.0\.0\.1)[:/]|data:|blob:|about:)/.test(url)) return request.continue();
    if (!url.endsWith('/v1/account/config')) mock.outside.push(url);
    return request.respond({ status: 204, body: '' });
  });
  await page.goto(`${BASE}/points/`, { waitUntil: 'networkidle0' });

  return { context, page, problems, mock };

}

const screen = page => page.$eval('#comp-main', m => m.dataset.state);
const waitScreen = (page, name) => page.waitForFunction(n => document.getElementById('comp-main')?.dataset.state === n, { timeout: 8000 }, name);
const textOf = (page, selector) => page.$eval(selector, el => el.textContent.trim());
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const clickText = (page, selector, words) => page.evaluate((s, w) => {
  const el = [...document.querySelectorAll(s)].find(e => e.textContent.includes(w));
  if (!el) throw new Error(`no ${s} with ${w}`);
  el.click();
}, selector, words);

async function axe(page, label) {
  await page.evaluate(AXE);
  const results = await page.evaluate(tags => axe.run(document, { runOnly: { type: 'tag', values: tags } }), AXE_TAGS);
  assert.deepEqual(results.violations.map(v => `${label} ${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`), []);
}

async function login(page) {
  await waitScreen(page, 'code');
  await page.type('#f-code', 'ath-2345-678a');
  await page.click('button[type="submit"]');
  await waitScreen(page, 'confirm');
  await clickText(page, 'button', 'أيوه، ده أنا');
  await waitScreen(page, 'dashboard');
}

async function order(page, itemId) {
  await page.click(`[data-item="${itemId}"] [data-order]`);
  await page.waitForSelector('dialog.order[open]');
  await page.click('[data-confirm-order]');
}


/* =========================================================
   TESTS
========================================================= */

test('login → dashboard with wallet and store; the token lives in this tab only', async () => {

  const { context, page, problems, mock } = await open();
  await waitScreen(page, 'code');
  assert.equal(await page.$('.actions .btn:not([type="submit"])'), null, 'no «رجوع» on the portal code screen');
  await page.screenshot({ path: `${SHOTS}portal-mobile-code.png` });

  await page.type('#f-code', 'ATH-2345-6789');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.getElementById('f-code-err')?.textContent.includes('مش صح'));
  await page.$eval('#f-code', el => { el.value = ''; });
  await page.type('#f-code', 'ath-2345-678a');
  await page.click('button[type="submit"]');
  await waitScreen(page, 'confirm');
  assert.equal(mock.fns('compCode').at(-1).arg.code, 'ATH-2345-678A');
  assert.equal(await textOf(page, '.who__name'), 'مينا عادل');
  await clickText(page, 'button', 'أيوه، ده أنا');
  await waitScreen(page, 'dashboard');

  assert.deepEqual(mock.fns('portalMe')[0].arg, { ptoken: 'pt1.good.sig' });
  assert.equal(await textOf(page, '.portal__name'), 'أهلًا يا مينا عادل');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'portal__name');
  assert.match(await textOf(page, '.portal__balance'), /رصيدك.*١٥٥٠ نقطة/);

  // history: score, points, pending, a review button only where allowed
  assert.match(await textOf(page, '[data-history="s-1"]'), /جبت ٧ من ١٠/);
  assert.match(await textOf(page, '[data-history="s-1"]'), /جمعت ٧٠٠ نقطة/);
  assert.match(await textOf(page, '[data-history="s-2"]'), /مستني مراجعة/);
  assert.ok(await page.$('[data-history="s-1"] [data-review-btn]'));
  assert.equal(await page.$('[data-history="s-2"] [data-review-btn]'), null);

  // ledger and requests
  assert.deepEqual(await page.$$eval('.prow--ledger', rows => rows.map(r => [r.dataset.kind, r.querySelector('.prow__amount').textContent])), [['competition', '+٧٠٠'], ['redeem', '−٣٠٠'], ['manual', '+١١٥٠']]);
  assert.match(await textOf(page, '.prow--ledger[data-kind="manual"]'), /تعديل من الخدام — |تعديل من الخدام/);
  assert.equal(await textOf(page, '[data-redemption="r-1"] .pstatus'), 'جاهزة للاستلام');

  // store: categories, sold out, limit reached
  assert.deepEqual(await page.$$eval('.shop__cat', els => els.map(e => e.textContent)), ['هدايا', 'كتب']);
  assert.equal(await textOf(page, '[data-item="i-book"] [data-off]'), 'خلصت');
  assert.equal(await textOf(page, '[data-item="i-pen"] [data-off]'), 'وصلت للحد المسموح');
  assert.match(await textOf(page, '[data-item="i-mug"]'), /فاضل ٥ · تقدر تطلب ٢ كمان/);
  assert.ok(await page.$('[data-item="i-mug"] img[src$="/media/2026/img-af6b0c28-480.webp"]'));

  // only sessionStorage; a reload goes straight to the dashboard
  assert.equal(await page.evaluate(k => sessionStorage.getItem(k), TOKEN_KEY), 'pt1.good.sig');
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  assert.equal(new URL(page.url()).search + new URL(page.url()).hash, '', 'nothing about the participant in the URL');
  await page.reload({ waitUntil: 'networkidle0' });
  await waitScreen(page, 'dashboard');
  assert.equal(mock.fns('compCode').length, 2, 'no new code check after a reload');
  await page.screenshot({ path: `${SHOTS}portal-mobile-dashboard.png`, fullPage: true });
  assert.ok(await overflow(page) <= 0);

  // «خروج»
  await page.click('[data-logout]');
  await waitScreen(page, 'code');
  assert.equal(await page.evaluate(k => sessionStorage.getItem(k), TOKEN_KEY), null);

  assert.deepEqual(mock.outside, []);
  assert.deepEqual(problems, []);
  await context.close();

});


test('«شوف إجاباتك»: portalReview → the engine\'s review list → back', async () => {

  const { context, page, problems, mock } = await open({ token: 'pt1.good.sig' });
  await waitScreen(page, 'dashboard');
  await page.click('[data-history="s-1"] [data-review-btn]');
  await waitScreen(page, 'review');
  assert.deepEqual(mock.fns('portalReview')[0].arg, { ptoken: 'pt1.good.sig', submissionId: 's-1' });
  assert.equal(await textOf(page, '#rv-t'), 'مسابقة يونان');
  assert.equal(await textOf(page, '.result__line--score'), 'جبت ٧ من ١٠');
  assert.equal(await page.$$eval('.answer', els => els.length), 2);
  assert.match(await textOf(page, '.answer--no'), /الإجابة الصح: صح/);
  await page.screenshot({ path: `${SHOTS}portal-mobile-review.png`, fullPage: true });
  await page.click('[data-back]');
  await waitScreen(page, 'dashboard');
  assert.deepEqual(problems, []);
  await context.close();

});


test('redeem: confirm sheet with the new balance, then the balance from the reply', async () => {

  const { context, page, problems, mock } = await open({ token: 'pt1.good.sig' });
  await waitScreen(page, 'dashboard');
  await page.click('[data-item="i-mug"] [data-order]');
  await page.waitForSelector('dialog.order[open]');
  assert.equal(await textOf(page, '#order-d'), 'هيتخصم ٧٠٠ نقطة، رصيدك هيبقى ٨٥٠');
  await page.screenshot({ path: `${SHOTS}portal-mobile-order.png` });
  // «لا» closes without a request
  await clickText(page, 'dialog.order button', 'لا');
  await page.waitForFunction(() => !document.querySelector('dialog.order'));
  assert.equal(mock.fns('shopRedeem').length, 0);

  await order(page, 'i-mug');
  await page.waitForSelector('.portal__notice');
  assert.match(await textOf(page, '.portal__notice'), /تم طلب «كوباية الأسرة»/);
  const sent = mock.fns('shopRedeem')[0].arg;
  assert.equal(sent.ptoken, 'pt1.good.sig');
  assert.equal(sent.itemId, 'i-mug');
  assert.match(sent.requestKey, /^[0-9a-f-]{36}$/);
  await page.waitForFunction(() => document.querySelector('[data-balance]')?.dataset.balance === '850');
  assert.match(await textOf(page, '.portal__balance'), /٨٥٠ نقطة/);
  await page.waitForFunction(() => document.querySelector('[data-item="i-mug"]')?.textContent.includes('فاضل ٤'));
  assert.equal(await textOf(page, '[data-redemption="r-2"] .pstatus'), 'مستني');

  // a second order of the same item is a NEW request (new key)
  await order(page, 'i-mug');
  await page.waitForFunction(() => document.querySelector('[data-balance]')?.dataset.balance === '150');
  const keys = mock.fns('shopRedeem').map(c => c.arg.requestKey);
  assert.equal(new Set(keys).size, 2);
  // now the mug's per-person limit is reached and the shirt is too expensive
  await page.waitForFunction(() => document.querySelector('[data-item="i-mug"] [data-off]')?.textContent === 'وصلت للحد المسموح');
  assert.equal(await textOf(page, '[data-item="i-shirt"] [data-off]'), 'رصيدك مش كفاية');
  assert.deepEqual(problems, []);
  await context.close();

});


test('redeem errors from the server: insufficient, stock, per_person', async () => {

  const mock = createMock();
  mock.force = { 'i-shirt': 'insufficient', 'i-bag': 'stock', 'i-cap': 'per_person' };
  const { context, page, problems } = await open({ token: 'pt1.good.sig', mock });
  await waitScreen(page, 'dashboard');
  for (const [item, words] of [['i-shirt', 'رصيدك مش كفاية'], ['i-bag', 'الجايزة دي خلصت'], ['i-cap', 'وصلت للحد المسموح من الجايزة دي']]) {
    await order(page, item);
    await page.waitForSelector('dialog.order[open] .alert');
    assert.equal(await textOf(page, 'dialog.order .alert'), words, item);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('alert')), true);
    await clickText(page, 'dialog.order button', 'لا');
    await page.waitForFunction(() => !document.querySelector('dialog.order'));
  }
  assert.equal(await textOf(page, '[data-balance]'), 'رصيدك١٥٥٠ نقطة');
  assert.deepEqual(problems, []);
  await context.close();

});


test('busy: the redeem is retried with the SAME requestKey and lands once', async () => {

  const mock = createMock();
  mock.busyOnce = true;
  const { context, page, problems } = await open({ token: 'pt1.good.sig', mock });
  await waitScreen(page, 'dashboard');
  await order(page, 'i-bag');
  await page.waitForSelector('.portal__notice', { timeout: 15000 });
  const calls = mock.fns('shopRedeem');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].arg, calls[1].arg, 'same ptoken, itemId and requestKey');
  assert.equal(mock.redemptions.length, 2, 'one new request');
  assert.equal(mock.balance, 1350);
  assert.deepEqual(problems, []);
  await context.close();

});


test('session over: back to the code screen with a message; registry off: unavailable', async () => {

  const mock = createMock();
  let { context, page, problems } = await open({ token: 'pt1.good.sig', mock });
  await waitScreen(page, 'dashboard');
  mock.valid = 'pt1.other.sig';   // e.g. the code was reset
  await page.click('[data-history="s-1"] [data-review-btn]');
  await waitScreen(page, 'code');
  assert.match(await textOf(page, '#f-code-err'), /ادخل الكود بتاعك تاني/);
  assert.equal(await page.evaluate(k => sessionStorage.getItem(k), TOKEN_KEY), null);
  await context.close();

  ({ context, page, problems } = await open({ token: 'pt1.expired.sig' }));
  await waitScreen(page, 'code');
  assert.deepEqual(problems, []);
  await context.close();

  ({ context, page } = await open({ mock: createMock({ registry: false }) }));
  await page.type('#f-code', 'ATH-2345-678A');
  await page.click('button[type="submit"]');
  await waitScreen(page, 'unavailable');
  assert.equal(await textOf(page, '#comp-main h1'), 'الصفحة دي مش متاحة دلوقتي');
  await context.close();

});


test('wallet off: no balance, no ledger, no store; history still there', async () => {

  const { context, page, problems } = await open({ token: 'pt1.good.sig', mock: createMock({ wallet: false, shop: false }) });
  await waitScreen(page, 'dashboard');
  assert.equal(await page.$('.portal__balance'), null);
  assert.equal(await page.$('#p-ledger'), null);
  assert.equal(await page.$('#p-shop'), null);
  assert.equal(await page.$('#p-orders'), null);
  assert.ok(await page.$('[data-history="s-1"]'));
  assert.deepEqual(problems, []);
  await context.close();

});


test('accessibility (axe) phone + desktop, and no horizontal scroll at 280 / 360 / 1280', async () => {

  for (const [name, viewport] of Object.entries({ narrow: NARROW, phone: PHONE, desktop: DESKTOP })) {
    const { context, page, problems } = await open({ viewport, bypassCSP: name !== 'narrow' });
    await waitScreen(page, 'code');
    if (name !== 'narrow') await axe(page, `${name} code`);
    await login(page);
    assert.ok(await overflow(page) <= 0, `${name} dashboard overflow`);
    if (name !== 'narrow') await axe(page, `${name} dashboard`);
    if (name === 'desktop') await page.screenshot({ path: `${SHOTS}portal-desktop-dashboard.png`, fullPage: true });
    if (name === 'narrow') await page.screenshot({ path: `${SHOTS}portal-280-dashboard.png`, fullPage: true });
    // touch targets on the dashboard
    const small = await page.$$eval('#comp-main button, #comp-main a[href]', els => els
      .filter(el => el.offsetParent !== null)
      .map(el => { const r = el.getBoundingClientRect(); return { t: el.textContent.trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter(r => r.w < 44 || r.h < 44));
    assert.deepEqual(small, [], `${name}: touch targets ≥ 44px`);
    await page.click('[data-item="i-mug"] [data-order]');
    await page.waitForSelector('dialog.order[open]');
    assert.ok(await overflow(page) <= 0, `${name} sheet overflow`);
    if (name !== 'narrow') await axe(page, `${name} order sheet`);
    await clickText(page, 'dialog.order button', 'لا');
    await page.click('[data-history="s-1"] [data-review-btn]');
    await waitScreen(page, 'review');
    assert.ok(await overflow(page) <= 0, `${name} review overflow`);
    if (name !== 'narrow') await axe(page, `${name} review`);
    if (name === 'narrow') assert.deepEqual(problems, [], 'no CSP violations');
    await context.close();
  }

});
