// «نقاطي» v2 (points/index.html + assets/js/comp/portal.js) in headless Chrome
// against a MOCK of the public API (docs/COMPETITIONS.md §18.3, §18.4):
// portalMe `store` (open / preview / scheduled / closed), `season`, `seasons`,
// redemptions[].canCancel, shopCancel, and shopRedeem `shop_closed`;
// §19.1 preview, §19.3 eligible:false + notice (compCode, portalMe) and
// shopRedeem `not_eligible`.
// Answered in the browser the way Apps Script does it (POST → 302 → echo).
//
// Run: cd tools && node --test ../tests/comp-portal2.e2e.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT } from '../tools/lib/gs.mjs';
import { seedSession, workerRoute } from './fakes/comp-worker.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 4964;
const BASE = `http://localhost:${PORT}`;
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
const TOKEN = 'pt1.good.sig';
const AGE_NOTICE = 'نأسف، سنك حاليًا خارج الفئة العمرية المخصصة لنظام نقاط الاجتماع. تقدر تشارك في المسابقة بدون نقاط.';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const PRIVATE = /^\/(apps-script|tools|tests|docs|node_modules)(\/|$)|\/\.|\.md$/i;

/* Cairo wall time, `minutes` from now: "YYYY-MM-DDTHH:MM" */
function cairo(minutes = 0) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(Date.now() + minutes * 60000)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

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
   MOCK API (v2)
========================================================= */

function createMock({ state = 'open', opensAt = '', closesAt = '', allowCancel = true, season = true, seasons = true, eligible = true } = {}) {

  const m = {
    calls: [], outside: [],
    eligible,           // §19.3 what compCode / portalMe say
    redeemIneligible: false,   // shopRedeem answers not_eligible (the rules changed meanwhile)
    store: { state, opensAt, closesAt, allowCancel },
    force: {},          // fn → error code (once)
    balance: 1550,
    redemptions: [
      { id: 'r-3', itemName: 'كاب', cost: 150, status: 'pending', requestedAt: '2026-10-12 18:00' },
      { id: 'r-1', itemName: 'كتاب التسبحة', cost: 300, status: 'approved', requestedAt: '2026-10-09 18:00' }
    ],
    ledger: [
      { amount: -150, kind: 'redeem', note: 'كاب', compTitle: '', createdAt: '2026-10-12 18:00' },
      { amount: 700, kind: 'competition', note: '', compTitle: 'مسابقة يونان', createdAt: '2026-10-08 20:00' }
    ],
    items: [
      { id: 'i-mug', name: 'كوباية الأسرة', description: 'كوباية سيراميك', image: null, cost: 700, category: 'هدايا', available: 5, perPersonLeft: 2 },
      { id: 'i-bag', name: 'شنطة قماش', description: '', image: null, cost: 200, category: 'هدايا', available: 3, perPersonLeft: null }
    ],
    season: season ? { id: 'sea-2', name: 'موسم الخريف', startAt: '2026-10-01T00:00', endAt: '2026-12-31T23:59', earned: 900, maxTheoretical: 1200 } : null,
    seasons: seasons ? [
      { id: 'sea-first', name: 'الموسم الأول', startAt: '2026-06-01T00:00', endAt: '2026-09-30T23:59', final: 600, earned: 900, spent: 300 },
      { id: 'sea-0', name: 'موسم الصيف اللي فات', startAt: '2025-06-01T00:00', endAt: '2025-09-30T23:59', final: 40, earned: 340, spent: 300 }
    ] : []
  };

  const canCancel = r => m.store.allowCancel && m.store.state === 'open' && r.status === 'pending';

  m.post = body => {
    const { fn, args } = JSON.parse(body);
    const arg = args[0] || {};
    m.calls.push({ fn, arg });
    const age = m.eligible ? {} : { eligible: false, notice: AGE_NOTICE };
    if (fn === 'compCode') return { ok: true, participant: { name: 'مينا عادل', group: 'ثانوي' }, ptoken: TOKEN, ...age };
    if (arg.ptoken !== TOKEN) return { ok: false, code: 'session', message: 'سجّل دخولك تاني' };
    if (m.force[fn]) {
      const code = m.force[fn];
      delete m.force[fn];
      return { ok: false, code, message: 'x' };
    }
    if (fn === 'portalMe') {
      return {
        ok: true,
        participant: { name: 'مينا عادل', group: 'ثانوي' },
        features: { wallet: true, shop: true },
        balance: m.balance,
        ledger: m.ledger,
        history: [],
        redemptions: m.redemptions.map(r => ({ ...r, canCancel: canCancel(r) })),
        shop: m.items,
        store: m.store,
        season: m.season,
        seasons: m.seasons,
        ...age
      };
    }
    if (fn === 'shopRedeem') {
      if (m.store.state !== 'open') return { ok: false, code: 'shop_closed', message: 'المتجر مقفول' };
      if (!m.eligible || m.redeemIneligible) return { ok: false, code: 'not_eligible', message: 'سنك حاليًا خارج الفئة العمرية، فمش هتقدر تطلب جوايز.' };
      const item = m.items.find(i => i.id === arg.itemId);
      m.balance -= item.cost;
      const redemption = { id: `r-${m.redemptions.length + 10}`, status: 'pending', itemName: item.name, cost: item.cost };
      m.redemptions = [{ ...redemption, requestedAt: '2026-10-13 12:00' }, ...m.redemptions];
      return { ok: true, redemption, balance: m.balance };
    }
    if (fn === 'shopCancel') {
      const r = m.redemptions.find(x => x.id === arg.redemptionId);
      if (!r) return { ok: false, code: 'not_found', message: 'x' };
      if (m.store.state !== 'open') return { ok: false, code: 'shop_closed', message: 'x' };
      if (!canCancel(r)) return { ok: false, code: 'not_allowed', message: 'x' };
      r.status = 'cancelled';
      m.balance += r.cost;
      return { ok: true, redemption: { id: r.id, status: 'cancelled', itemName: r.itemName, cost: r.cost }, balance: m.balance };
    }
    return { ok: false, code: 'bad', message: 'x' };
  };

  m.fns = name => m.calls.filter(c => c.fn === name);
  return m;

}


/* =========================================================
   PAGES
========================================================= */

async function open({ viewport = PHONE, mock = createMock(), bypassCSP = false, token = TOKEN } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const echoes = new Map();
  let echo = 0;

  page.on('console', msg => { if (msg.type() === 'error' && /CSP|Content Security|Refused/i.test(msg.text())) problems.push(msg.text()); });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  await page.evaluateOnNewDocument(() => document.addEventListener('securitypolicyviolation', e => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)));
  if (token) await seedSession(page);
  if (bypassCSP) await page.setBypassCSP(true);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport(viewport);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (workerRoute(request, mock)) return undefined;
    if (/^(https?:\/\/(localhost|127\.0\.0\.1)[:/]|data:|blob:|about:)/.test(url)) return request.continue();
    if (!url.endsWith('/v1/account/config')) mock.outside.push(url);
    return request.respond({ status: 204, body: '' });
  });
  await page.goto(`${BASE}/points/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(n => document.getElementById('comp-main')?.dataset.state === n, { timeout: 8000 }, token ? 'dashboard' : 'code');

  return { context, page, problems, mock };

}

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

async function smallTargets(page) {
  return page.$$eval('#comp-main button, #comp-main a[href], #comp-main summary', els => els
    .filter(el => el.offsetParent !== null)
    .map(el => { const r = el.getBoundingClientRect(); return { t: el.textContent.trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter(r => r.w < 44 || r.h < 44));
}


/* =========================================================
   TESTS
========================================================= */

test('scheduled: «المتجر هيفتح يوم …» and a countdown, the prizes hidden; «طلباتي» stays', async () => {

  const mock = createMock({ state: 'scheduled', opensAt: cairo(2 * 1440 + 90), closesAt: cairo(9 * 1440) });
  const { context, page, problems } = await open({ mock });

  assert.equal(await page.$eval('[data-store]', el => el.dataset.store), 'scheduled');
  assert.match(await textOf(page, '.store-state__headline'), /^المتجر هيفتح يوم .+ الساعة .+/);
  assert.match(await textOf(page, '[data-countdown]'), /^فاضل يومين/);
  assert.equal(await page.$('.shop__item'), null, 'the prizes are hidden until the store opens (§19.1)');
  assert.equal(await page.$('[data-order]'), null, 'nothing can be ordered yet');
  assert.ok(await page.$('[aria-labelledby="p-orders"] [data-redemption="r-3"]'), '«طلباتي» visible');
  assert.equal(await page.$('[data-cancel]'), null, 'no cancel while the store is not open');
  await page.screenshot({ path: `${SHOTS}portal2-mobile-scheduled.png`, fullPage: true });

  // the store opens (the server says so): a reload shows it open, orders allowed
  mock.store = { ...mock.store, state: 'open', opensAt: cairo(-1) };
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('[data-store]')?.dataset.store === 'open');
  assert.match(await textOf(page, '.store-state__headline'), /^المتجر مفتوح لحد /);
  assert.equal(await page.$$eval('[data-order]', els => els.length), 2);
  assert.ok(await page.$('[data-redemption="r-3"] [data-cancel]'), 'a pending request can be cancelled now');
  assert.deepEqual(mock.outside, []);
  assert.deepEqual(problems, []);
  await context.close();

});


test('closed: the closed sentence, prizes hidden, requests still listed', async () => {

  const { context, page, problems } = await open({ mock: createMock({ state: 'closed' }) });
  assert.equal(await textOf(page, '.store-state__headline'), 'المتجر مقفول دلوقتي — طلباتك محفوظة والخدام بيسلّموها');
  assert.equal(await page.$('.shop__item'), null);
  assert.equal(await page.$$eval('[aria-labelledby="p-orders"] [data-redemption]', els => els.length), 2);
  assert.equal(await page.$('[data-cancel]'), null);
  await page.screenshot({ path: `${SHOTS}portal2-mobile-closed.png`, fullPage: true });
  assert.deepEqual(problems, []);
  await context.close();

});


test('cancel: confirm sheet → shopCancel → refund in the balance, status «اتلغت»', async () => {

  const { context, page, problems, mock } = await open();
  assert.match(await textOf(page, '[data-redemption="r-3"] [data-cancel]'), /إلغاء الطلب/);
  assert.equal(await page.$('[data-redemption="r-1"] [data-cancel]'), null, 'an approved request has no cancel');

  // «لا، سيبه» closes without a request, the focus back on the button
  await page.click('[data-redemption="r-3"] [data-cancel]');
  await page.waitForSelector('dialog[data-cancel-sheet][open]');
  assert.equal(await textOf(page, '#cancel-t'), 'تلغي طلب «كاب»؟');
  assert.equal(await textOf(page, '#cancel-d'), 'هيرجعلك ١٥٠ نقطة، رصيدك هيبقى ١٧٠٠');
  await page.screenshot({ path: `${SHOTS}portal2-mobile-cancel.png` });
  await clickText(page, 'dialog[data-cancel-sheet] button', 'لا، سيبه');
  await page.waitForFunction(() => !document.querySelector('dialog[data-cancel-sheet]'));
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-cancel')), true);
  assert.equal(mock.fns('shopCancel').length, 0);

  await page.click('[data-redemption="r-3"] [data-cancel]');
  await page.waitForSelector('dialog[data-cancel-sheet][open]');
  await page.click('[data-confirm-cancel]');
  await page.waitForSelector('.portal__notice');
  assert.deepEqual(mock.fns('shopCancel')[0].arg, { ptoken: TOKEN, redemptionId: 'r-3' });
  assert.equal(await textOf(page, '.portal__notice'), 'اتلغى طلب «كاب» ✓ ورجعلك ١٥٠ نقطة.');
  await page.waitForFunction(() => document.querySelector('[data-balance]')?.dataset.balance === '1700');
  assert.equal(await textOf(page, '[data-redemption="r-3"] .pstatus'), 'اتلغت (النقاط رجعت)');
  assert.equal(await page.$('[data-redemption="r-3"] [data-cancel]'), null);
  assert.deepEqual(problems, []);
  await context.close();

});


test('cancel refused: not_allowed (handed over meanwhile), then shop_closed (the store closed mid-way)', async () => {

  const mock = createMock();
  mock.redemptions.unshift({ id: 'r-4', itemName: 'قلم', cost: 100, status: 'pending', requestedAt: '2026-10-12 19:00' });
  const { context, page, problems } = await open({ mock });

  // the servants approved r-4 while the page was open
  mock.redemptions[0].status = 'approved';
  await page.click('[data-redemption="r-4"] [data-cancel]');
  await page.waitForSelector('dialog[data-cancel-sheet][open]');
  await page.click('[data-confirm-cancel]');
  await page.waitForSelector('.portal__alert');
  assert.match(await textOf(page, '.portal__alert'), /الطلب ده مينفعش يتلغي دلوقتي/);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('portal__alert')), true);
  assert.equal(await page.$('dialog[data-cancel-sheet]'), null);
  await page.waitForFunction(() => document.querySelector('[data-redemption="r-4"] .pstatus')?.textContent === 'جاهزة للاستلام');
  assert.equal(await page.$('[data-redemption="r-4"] [data-cancel]'), null);
  assert.equal(mock.balance, 1550, 'nothing refunded');

  // the store closes while the sheet is open
  await page.click('[data-redemption="r-3"] [data-cancel]');
  await page.waitForSelector('dialog[data-cancel-sheet][open]');
  mock.store = { ...mock.store, state: 'closed' };
  await page.click('[data-confirm-cancel]');
  await page.waitForFunction(() => document.querySelector('[data-store]')?.dataset.store === 'closed');
  assert.equal(await textOf(page, '.portal__alert'), 'المتجر قفل، مينفعش تلغي الطلب دلوقتي');
  assert.equal(await page.$('[data-cancel]'), null);
  assert.equal(await page.$('.shop__item'), null);
  assert.deepEqual(problems, []);
  await context.close();

});


test('redeem when the store just closed: shop_closed → the closed state with a warning', async () => {

  const { context, page, problems, mock } = await open();
  await page.click('[data-item="i-bag"] [data-order]');
  await page.waitForSelector('dialog.order[open]');
  mock.store = { ...mock.store, state: 'closed' };
  await page.click('[data-confirm-order]');
  await page.waitForSelector('.portal__alert');
  assert.equal(await textOf(page, '.portal__alert'), 'المتجر قفل دلوقتي — طلباتك محفوظة');
  assert.equal(await page.$('dialog.order'), null, 'the sheet is gone');
  assert.equal(await page.$eval('[data-store]', el => el.dataset.store), 'closed');
  assert.equal(await page.$('.shop__item'), null);
  assert.equal(mock.balance, 1550);
  assert.equal(await textOf(page, '[data-balance]'), 'رصيدك في الموسم ده١٥٥٠ نقطة');
  assert.deepEqual(problems, []);
  await context.close();

});


test('season bar: name, dates, earned of the maximum with a meter; past seasons folded', async () => {

  const { context, page, problems } = await open();
  assert.equal(await textOf(page, '#p-season'), 'الموسم: موسم الخريف');
  assert.equal(await textOf(page, '.season__dates'), 'من الخميس ١ أكتوبر لحد الخميس ٣١ ديسمبر');
  assert.equal(await textOf(page, '.season__earned'), 'جمعت ٩٠٠ نقطة من أقصى ١٢٠٠');
  assert.deepEqual(await page.$eval('meter.season__meter', m => [m.value, m.max, m.getAttribute('aria-label')]), [900, 1200, 'جمعت ٩٠٠ نقطة من أقصى ١٢٠٠']);
  assert.equal(await textOf(page, '.portal__balance-label'), 'رصيدك في الموسم ده');
  assert.equal(await textOf(page, '#p-ledger'), 'حركة النقاط في الموسم ده');

  // history: collapsed by default
  assert.equal(await page.$eval('details.seasons', d => d.open), false);
  assert.equal(await textOf(page, '.seasons__summary'), 'المواسم اللي فاتت (٢)');
  assert.equal(await page.$eval('[data-season="sea-first"]', el => el.checkVisibility()), false, 'hidden while folded');
  await page.click('.seasons__summary');
  assert.equal(await page.$eval('details.seasons', d => d.open), true);
  assert.match(await textOf(page, '[data-season="sea-first"]'), /الموسم الأول.*من الإتنين ١ يونيو لحد الأربع ٣٠ سبتمبر.*جمعت ٩٠٠ · صرفت ٣٠٠ · آخر رصيد ٦٠٠/);
  await page.screenshot({ path: `${SHOTS}portal2-mobile-season.png`, fullPage: true });
  assert.deepEqual(problems, []);
  await context.close();

  // no maximum yet: the words without a meter; no season at all: no card
  const noMax = createMock();
  noMax.season = { ...noMax.season, maxTheoretical: 0 };
  let opened = await open({ mock: noMax });
  assert.equal(await textOf(opened.page, '.season__earned'), 'جمعت ٩٠٠ نقطة في الموسم ده');
  assert.equal(await opened.page.$('meter'), null);
  await opened.context.close();
  opened = await open({ mock: createMock({ season: false, seasons: false }) });
  assert.equal(await opened.page.$('#p-season'), null);
  assert.equal(await textOf(opened.page, '.portal__balance-label'), 'رصيدك');
  await opened.context.close();

});


test('v2 accessibility (axe) phone + desktop; no horizontal scroll at 280 / 360 / 1280; touch targets; no CSP violations', async () => {

  for (const [name, viewport] of Object.entries({ narrow: NARROW, phone: PHONE, desktop: DESKTOP })) {
    for (const state of ['preview', 'scheduled', 'open', 'closed']) {
      const mock = createMock({ state, opensAt: state === 'scheduled' || state === 'preview' ? cairo(3000) : '', closesAt: state === 'open' ? cairo(600) : '' });
      const { context, page, problems } = await open({ viewport, mock, bypassCSP: name !== 'narrow' });
      await page.click('.seasons__summary');
      assert.ok(await overflow(page) <= 0, `${name} ${state} overflow`);
      assert.deepEqual(await smallTargets(page), [], `${name} ${state}: touch targets ≥ 44px`);
      if (name !== 'narrow') await axe(page, `${name} ${state}`);
      if (state === 'open') {
        assert.match(await textOf(page, '[data-countdown]'), /^فاضل (٩|١٠) ساعات$/);
        await page.click('[data-redemption="r-3"] [data-cancel]');
        await page.waitForSelector('dialog[data-cancel-sheet][open]');
        assert.ok(await overflow(page) <= 0, `${name} cancel sheet overflow`);
        if (name !== 'narrow') await axe(page, `${name} cancel sheet`);
        if (name === 'desktop') await page.screenshot({ path: `${SHOTS}portal2-desktop-cancel.png` });
      }
      if (name === 'desktop' && state === 'scheduled') await page.screenshot({ path: `${SHOTS}portal2-desktop-scheduled.png`, fullPage: true });
      if (name === 'narrow') {
        await page.screenshot({ path: `${SHOTS}portal2-280-${state}.png`, fullPage: true });
        assert.deepEqual(problems, [], 'no CSP violations');
      }
      await context.close();
    }
  }

});



/* =========================================================
   §19.1 PREVIEW, §19.3 AGE ELIGIBILITY
========================================================= */

test('preview: the prizes on show, the order buttons off with their reason; with or without a date', async () => {

  const mock = createMock({ state: 'preview', opensAt: cairo(2 * 1440 + 90) });
  const { context, page, problems } = await open({ mock });
  assert.equal(await page.$eval('[data-store]', el => el.dataset.store), 'preview');
  assert.match(await textOf(page, '.store-state__headline'), /^المتجر مفتوح للعرض — الطلب هيفتح يوم .+ الساعة .+/);
  assert.match(await textOf(page, '[data-countdown]'), /^فاضل يومين/);
  assert.equal(await page.$$eval('.shop__item', els => els.length), 2, 'the prizes are on show');
  assert.equal(await page.$('[data-order]'), null);
  assert.deepEqual(await page.$$eval('button[data-off="preview"]', els => els.map(e => [e.textContent, e.disabled, e.getAttribute('aria-label')])), [
    ['الطلب لسه مفتحش', true, 'الطلب لسه مفتحش: كوباية الأسرة'],
    ['الطلب لسه مفتحش', true, 'الطلب لسه مفتحش: شنطة قماش']
  ]);
  assert.match(await textOf(page, '[data-item="i-mug"]'), /٧٠٠ نقطة/);
  assert.equal(await page.$('[data-cancel]'), null, 'no cancel outside open');
  await page.screenshot({ path: `${SHOTS}portal3-mobile-preview.png`, fullPage: true });

  // a manual preview without a date: «قريب», no countdown
  mock.store = { ...mock.store, opensAt: '' };
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.store-state__headline')?.textContent === 'المتجر مفتوح للعرض — الطلب هيفتح قريب');
  assert.equal(await textOf(page, '[data-countdown]'), '');
  assert.deepEqual(problems, []);
  await context.close();

});


test('age: the dashboard says it and the store takes no orders', async () => {

  const { context, page, problems, mock } = await open({ mock: createMock({ eligible: false }), bypassCSP: true });
  await page.waitForFunction(() => document.getElementById('comp-main')?.dataset.state === 'dashboard');

  assert.equal(await textOf(page, '.portal__me ~ [data-age-notice]'), AGE_NOTICE);
  assert.equal(await page.$('[data-order]'), null, 'no orders');
  assert.deepEqual(await page.$$eval('[data-off="not_eligible"]', els => els.map(e => e.textContent)), ['الطلب مش متاح ليك', 'الطلب مش متاح ليك']);
  assert.ok(await page.$('[data-history], [aria-labelledby="p-history"]'), 'the history stays');
  assert.match(await textOf(page, '[data-balance]'), /١٥٥٠/);
  await axe(page, 'dashboard ineligible');
  assert.equal(mock.fns('shopRedeem').length, 0);
  assert.deepEqual(problems.filter(p => !/Refused to apply inline style/.test(p)), []);
  await context.close();

});


test('shopRedeem not_eligible (the rules changed meanwhile): the server\'s message, orders off', async () => {

  const mock = createMock();
  const { context, page, problems } = await open({ mock });
  mock.redeemIneligible = true;
  await page.click('[data-item="i-bag"] [data-order]');
  await page.waitForSelector('dialog.order[open]');
  await page.click('[data-confirm-order]');
  await page.waitForSelector('.portal__alert');
  assert.equal(await textOf(page, '.portal__alert'), 'سنك حاليًا خارج الفئة العمرية، فمش هتقدر تطلب جوايز.');
  assert.equal(await page.$('dialog.order'), null);
  assert.equal(await page.$('[data-order]'), null, 'no more orders');
  assert.equal(await page.$$eval('[data-off="not_eligible"]', els => els.length), 2);
  assert.equal(mock.balance, 1550, 'nothing charged');
  assert.deepEqual(problems, []);
  await context.close();

});
