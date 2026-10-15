// Online booking on the event page (docs/EVENTS.md §7.1; worker/BOOKING-API.md)
// in headless Chrome at 360×740, the Worker API MOCKED by request
// interception (nothing ever reaches a real Worker):
//   - online:false (today's production): exactly the Phase 3 display, no API
//     call, no booking module, no storage
//   - the happy path: state → name/phone/counts → servant/method (WhatsApp
//     text) → a real JPEG (sharp) prepared and uploaded → submit → done →
//     the status view → «إلغاء الطلب» (withdraw)
//   - back from WhatsApp: the draft opens the same step, same requestKey
//   - full / not_open / closed / invalid / limit
//   - the API down or switched off → the servants' WhatsApp, never broken
//   - the admin preview: the online look, no request, no storage
//
// Run: cd tools && node --test ../tests/book-public.e2e.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT } from '../tools/lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 4977;
const BASE = `http://localhost:${PORT}`;
const API = 'https://athanasios-api.menazak-lab.workers.dev';
const SHOTS = `${ROOT}tools/.cache/book/`;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const PHONE = { width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const CLOCK = 'Tue, 13 Oct 2026 09:00:00 GMT';     // 2026-10-13T12:00 Cairo: inside the window

const FIX = `${ROOT}tests/fixtures/pages/`;
const EVENT = JSON.parse(readFileSync(`${FIX}event.json`, 'utf8'));       // online: false (as production today)
const ONLINE = {
  ...EVENT,
  slug: 'online-trip',
  v: 'on1a2b3c4d',
  booking: { ...EVENT.booking, online: true, showLeft: true, showLeftBelow: 20, methods: EVENT.booking.methods.map(m => ({ ...m, needsProof: m.key === 'instapay' })) }
};
const SHELL = readFileSync(`${ROOT}pages/index.html`, 'utf8');
const TOKEN = 'bk1.eyJiIjoiYmtnLWFiY2RlZiIsImUiOjE3OTk5OTk5OTk5OTl9.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU';
const JPEG = `${SHOTS}proof.jpg`;
const NOT_IMAGE = `${SHOTS}notes.txt`;

/* what the publisher's pageStubHtml_ does (an event: one level deeper) */
function stub(slug, v) {
  return SHELL.replace(/\r\n/g, '\n').replace('  <meta name="robots" content="noindex">\n', '')
    .replace('<html lang="ar" dir="rtl">', `<html lang="ar" dir="rtl" data-kind="event" data-slug="${slug}" data-v="${v}">`)
    .replace(/(\s(?:href|src)=")\.\.\//g, '$1../../');
}

const PREVIEW_PARENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>preview parent</title></head>
<body><iframe id="frame" title="preview" src="/pages/index.html?preview" width="390" height="800"></iframe></body></html>`;


/* =========================================================
   THE MOCK WORKER (answered inside the browser: request interception)
========================================================= */

const OPEN = { ok: true, open: true, left: 12, opensAt: '', closesAt: '2026-10-21T23:00', revision: 'rev-1' };

let mock;

function resetMock() {
  mock = {
    down: false,
    state: { status: 200, body: OPEN },
    submit: null,          // null: success
    status: 'pending',
    proofs: 0,
    calls: []              // { method, path, body, type }
  };
}
resetMock();

const json = (status, body) => ({ status, body });

function answer({ method, path, body }) {
  const url = new URL(path, API);
  if (url.pathname === '/v1/book/state') return mock.state.status ? mock.state : json(200, mock.state);
  if (url.pathname === '/v1/book/proof') {
    const n = mock.proofs++;
    return json(200, { ok: true, proofId: `prf-abcdefg${'hijklmn'[n % 7]}`, claim: `claim-${n}` });
  }
  if (url.pathname === '/v1/book/submit') {
    if (mock.submit) return mock.submit;
    return json(200, { ok: true, ref: 'B-7K2QX', status: 'pending', token: TOKEN, quotedTotal: 3000 });
  }
  if (url.pathname === '/v1/book/status') {
    const data = JSON.parse(body || '{}');
    if (data.token !== TOKEN) return json(401, { ok: false, code: 'expired', message: 'x' });
    return json(200, {
      ok: true, ref: 'B-7K2QX', event: { slug: 'online-trip', title: ONLINE.title, startAt: ONLINE.startAt },
      status: mock.status, firstName: 'مينا', people: { adult: 2, child: 0, companion: 0, total: 2 }, quotedTotal: 3000, createdAt: '2026-10-13T12:00'
    });
  }
  if (url.pathname === '/v1/book/withdraw') {
    mock.status = 'withdrawn';
    return json(200, { ok: true, status: 'withdrawn' });
  }
  return json(404, { ok: false, code: 'not_found', message: 'x' });
}


/* =========================================================
   SERVER (site files + the stubs)
========================================================= */

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };
const PRIVATE = /^\/(apps-script|tools|tests|docs|node_modules)(\/|$)|\/\.|\.md$/i;

let server;
let browser;

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  // a real phone-sized photo (JPEG), and a file that is not a picture
  await sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 30, g: 110, b: 160 } } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect x="100" y="200" width="1000" height="300" fill="#fff"/><text x="150" y="400" font-size="120" fill="#000">InstaPay 3000</text></svg>'), top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toFile(JPEG);
  writeFileSync(NOT_IMAGE, 'this is not a picture');

  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const send = (type, body, status = 200) => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', Date: CLOCK });
      res.end(body);
    };
    if (path === '/__test/preview-parent.html') return send(TYPES['.html'], PREVIEW_PARENT);
    if (/^\/events\/online-trip\/(index\.html)?$/.test(path)) return send(TYPES['.html'], stub(ONLINE.slug, ONLINE.v));
    if (path === '/events/online-trip/event.json') return send(TYPES['.json'], JSON.stringify(ONLINE));
    if (/^\/events\/ain-sokhna-trip\/(index\.html)?$/.test(path)) return send(TYPES['.html'], stub(EVENT.slug, EVENT.v));
    if (path === '/events/ain-sokhna-trip/event.json') return send(TYPES['.json'], JSON.stringify(EVENT));
    try {
      if (PRIVATE.test(path)) throw new Error('private');
      const file = normalize(join(ROOT, path.endsWith('/') ? `${path}index.html` : path));
      if (!file.startsWith(normalize(ROOT)) || !statSync(file).isFile()) throw new Error('no');
      return send(TYPES[extname(file)] || 'application/octet-stream', readFileSync(file));
    }
    catch {
      return send('text/plain', '404', 404);
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
   HELPERS
========================================================= */

async function open(path, { init = null } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const outside = [];
  const modules = [];
  const apiCalls = [];
  page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) problems.push(`console: ${msg.text()}`); });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  await page.evaluateOnNewDocument(() => document.addEventListener('securitypolicyviolation', e => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport(PHONE);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === API) {
      const call = { method: request.method(), path: `${url.pathname}${url.search}`, body: request.postData() || '', type: request.headers()['content-type'] || '' };
      const cors = { 'Access-Control-Allow-Origin': BASE, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', Vary: 'Origin' };
      if (call.method === 'OPTIONS') return request.respond({ status: 204, headers: cors, body: '' });
      mock.calls.push(call);
      apiCalls.push(call);
      if (mock.down) return request.abort('connectionrefused');
      const { status, body } = answer(call);
      return request.respond({ status, headers: cors, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
    }
    if (url.hostname !== 'localhost' && url.protocol !== 'data:' && url.protocol !== 'blob:') {
      outside.push(url.href);
      return request.respond({ status: 204, body: '' });
    }
    if (/\/assets\/js\/page\/(booking|status|image|book-[a-z]+)\.js$/.test(url.pathname)) modules.push(url.pathname.split('/').pop());
    return request.continue();
  });
  for (const script of [].concat(init || [])) await page.evaluateOnNewDocument(script);
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
  return { context, page, problems, outside, modules, apiCalls };
}

const ready = page => page.waitForSelector('main[data-state="ready"]', { timeout: 8000 });
const textOf = (page, selector) => page.$eval(selector, el => el.textContent.replace(/\s+/g, ' ').trim());
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const live = (page, value) => page.waitForSelector(`#book[data-live="${value}"]`, { timeout: 8000 });
const step = (page, value) => page.waitForSelector(`.bk-flow[data-step="${value}"]`, { timeout: 8000 });
const storage = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('athanasios.book')).map(k => [k, JSON.parse(localStorage.getItem(k))])));
const calls = route => mock.calls.filter(c => c.path.startsWith(route));
const DRAFT = 'athanasios.book.v1:online-trip';

async function axe(page, selector = '') {
  await page.evaluate(AXE);
  const result = await page.evaluate((tags, selector) => window.axe.run(selector ? document.querySelector(selector) : document, { runOnly: { type: 'tag', values: tags } }), AXE_TAGS, selector);
  return result.violations.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
}

async function typeInto(page, selector, text) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(selector, text);
}

/* step a: name, phone, one extra adult → «التالي» */
async function fillWho(page, { phone = '01012345678' } = {}) {
  await step(page, 'a');
  await typeInto(page, '#bk-name', 'مينا عادل');
  await typeInto(page, '#bk-phone', phone);
  await page.click('.bk-flow [aria-label="زوّد فرد إضافي"]');
  await page.click('.bk-flow .bk-next');
}

/* «قريت الشروط وموافق» ticked (it stays ticked while the visitor goes back and forth) */
async function agree(page) {
  if (!(await page.$eval('#bk-agree', el => el.checked))) await page.click('label[for="bk-agree"]');
}

/* step b: a servant and a method → «دفعت، كمّل» */
async function choosePay(page, method = 'instapay') {
  await step(page, 'b');
  await page.click('label[for="bk-servant-srv-mina0001"]');
  await page.click(`label[for="bk-method-${method}"]`);
  await page.click('.bk-flow .bk-next');
  await step(page, 'c');
}


/* =========================================================
   TODAY'S PRODUCTION: online false
========================================================= */

test('online:false (production today): the Phase 3 display exactly; no API call, no booking module, no storage', async () => {
  resetMock();
  const { context, page, problems, outside, modules } = await open('/events/ain-sokhna-trip/');
  await ready(page);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(await page.$eval('#book', el => el.dataset.phase), 'open');
  assert.equal(await page.$eval('#book', el => el.className), 'pg-section book is-open');
  assert.equal(await page.$eval('#book', el => el.dataset.live), undefined);
  assert.equal(await textOf(page, '.book__state'), 'الحجز مفتوح');
  assert.equal(await textOf(page, '.book__line'), 'للحجز كلّم خادم من دول على واتساب');
  assert.equal((await page.$$('.price')).length, 4);
  assert.equal(await page.$('.bk'), null);
  assert.equal(await page.$('.bk-start'), null);
  assert.equal((await page.$$('#book .stepper__btn')).length, 6, 'the optional counter (extra adult, child, infant)');
  const wa = await page.$$eval('.people--servants .btn--wa', els => els.map(a => a.href));
  assert.equal(wa.length, 1);
  assert.match(wa[0], /^https:\/\/wa\.me\/201001234567\?text=/);
  assert.equal(await textOf(page, '.phero__cta'), 'احجز الآن');
  assert.deepEqual(mock.calls, [], 'no API call');
  assert.deepEqual(modules, [], 'no booking module loaded');
  assert.deepEqual(await storage(page), {});
  assert.deepEqual(outside, []);
  // a #b/ link on an event that isn't online: still nothing
  await page.goto(`${BASE}/events/ain-sokhna-trip/#b/${TOKEN}`, { waitUntil: 'networkidle0' });
  await ready(page);
  assert.equal(await page.$('#bstat'), null);
  assert.deepEqual(mock.calls, []);
  assert.deepEqual(problems, []);
  await context.close();
});


/* =========================================================
   THE HAPPY PATH
========================================================= */

test('happy path at 360×740: state → who → servant + WhatsApp → a real JPEG uploaded → submit → done → status view → withdraw', async () => {
  resetMock();
  const { context, page, problems, outside, modules } = await open('/events/online-trip/');
  await ready(page);
  await live(page, 'open');
  assert.equal(await textOf(page, '.book__state'), 'الحجز مفتوح');
  assert.equal(await textOf(page, '.bk__left'), 'فاضل ١٢ مكان');
  assert.equal(await page.$eval('.book__line', el => getComputedStyle(el).display), 'none', 'the WhatsApp line gives way to the flow');
  assert.equal(await page.$eval('.people--servants', el => getComputedStyle(el).display), 'none');
  assert.equal(await textOf(page, '.bk-start'), 'احجز الآن');
  assert.deepEqual(calls('/v1/book/state').map(c => [c.method, c.path]), [['GET', '/v1/book/state?slug=online-trip']]);
  assert.ok(await overflow(page) <= 0);
  assert.deepEqual(await axe(page, '#book'), []);

  // a: who's coming
  await page.click('.bk-start');
  await step(page, 'a');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'bk-step-title');
  assert.equal(await textOf(page, '.bk-flow__progress'), 'خطوة ١ من ٣');
  const key = (await storage(page))[DRAFT].requestKey;
  assert.match(key, /^web\.[a-z0-9]{22}$/, 'the requestKey is made at step a and kept in the draft');
  // gentle checks first
  await page.click('.bk-flow .bk-next');
  assert.equal(await page.$eval('#bk-name', el => el.getAttribute('aria-invalid')), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'bk-name');
  assert.match(await textOf(page, '#bk-phone-err'), /رقم موبايل مصري/);
  assert.ok(await overflow(page) <= 0);
  await page.screenshot({ path: `${SHOTS}step-a-360.png`, fullPage: true });
  assert.deepEqual(await axe(page, '#book'), []);
  await fillWho(page);
  assert.equal(await textOf(page, '.bk-total strong'), '٣٬٠٠٠ جنيه');

  // b: the servant and the method, the WhatsApp text
  await step(page, 'b');
  await page.click('label[for="bk-servant-srv-mina0001"]');
  await page.click('label[for="bk-method-instapay"]');
  const wa = await page.$eval('.bk-wa__btn', a => ({ href: a.href, target: a.target, rel: a.rel }));
  assert.deepEqual([wa.target, wa.rel], ['_blank', 'noopener']);
  const text = new URL(wa.href).searchParams.get('text');
  assert.equal(text, 'سلام يا مينا عادل، أنا مينا عادل وعايز أحجز في «رحلة العين السخنة».\n- الحاجز: ١\n- فرد إضافي: ١\nالإجمالي: ٣٬٠٠٠ جنيه\nهدفع إنستاباي.');
  assert.doesNotMatch(wa.href, /01012345678|1012345678/, 'never the phone');
  assert.equal(await textOf(page, '.bk-wa .bk-note--strong'), 'بعد ما تدفع ارجع هنا وكمّل الحجز.');
  assert.equal((await storage(page))[DRAFT].step, 'b');
  assert.ok(await overflow(page) <= 0);
  await page.screenshot({ path: `${SHOTS}step-b-360.png`, fullPage: true });
  assert.deepEqual(await axe(page, '#book'), []);
  await page.click('.bk-flow .bk-next');
  await step(page, 'c');

  // c: instapay needs a picture; a file that isn't one is refused kindly
  await page.click('.bk-send');
  assert.match(await textOf(page, '#bk-proofs-err'), /صورة التحويل/);
  const input = await page.$('#bk-proof-input');
  await input.uploadFile(NOT_IMAGE);
  await page.waitForSelector('.bk-proof[data-state="failed"]');
  assert.equal(await textOf(page, '.bk-proof__state'), 'الصورة دي مش مدعومة، ابعت سكرين شوت');
  await page.click('.bk-proof [aria-label="شيل صورة ١"]');
  assert.equal((await page.$$('.bk-proof')).length, 0);
  await input.uploadFile(JPEG);
  await page.waitForSelector('.bk-proof[data-state="done"]', { timeout: 15000 });
  const sent = calls('/v1/book/proof');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, '/v1/book/proof?slug=online-trip');
  assert.match(sent[0].type, /^image\/(webp|jpeg)$/);
  const img = await page.$eval('.bk-proof__img', el => ({ src: el.src, w: el.naturalWidth, h: el.naturalHeight }));
  assert.match(img.src, /^blob:/);
  assert.ok(Math.max(img.w, img.h) <= 1600 && img.h === 1600, `prepared to ≤ 1600 px (${img.w}×${img.h})`);
  assert.deepEqual((await storage(page))[DRAFT].proofs, [{ proofId: 'prf-abcdefgh', claim: 'claim-0' }], 'the draft keeps the id and claim, never the bytes');
  await typeInto(page, '#bk-note', 'هنركب من الكنيسة');
  assert.equal(await textOf(page, '.bk-form > .bk-note--strong'), 'مكانك بيتأكد بعد مراجعة الدفع.');
  await page.click('.bk-send');
  assert.match(await textOf(page, '#bk-agree-err'), /توافق على الشروط/);
  await agree(page);
  assert.ok(await overflow(page) <= 0);
  await page.screenshot({ path: `${SHOTS}step-c-360.png`, fullPage: true });
  assert.deepEqual(await axe(page, '#book'), []);
  await page.click('.bk-send');

  // done
  await step(page, 'done');
  const [submit] = calls('/v1/book/submit');
  const body = JSON.parse(submit.body);
  assert.deepEqual(body, {
    slug: 'online-trip', requestKey: key, name: 'مينا عادل', phone: '01012345678',
    counts: { applicant: 1, adult: 1, child: 0, infant: 0 }, hp: '', revision: 'rev-1',
    note: 'هنركب من الكنيسة', servantId: 'srv-mina0001', method: 'instapay', proofs: [{ proofId: 'prf-abcdefgh', claim: 'claim-0' }]
  });
  assert.equal(await textOf(page, '.bk-done__code'), 'B-7K2QX');
  assert.equal(await textOf(page, '.bk-done__status'), 'قيد المراجعة');
  assert.match(await textOf(page, '.bk-done'), /هتوصلك رسالة من الخادم بعد التأكيد/);
  assert.equal(await page.$eval('#bk-link', el => el.value), `${BASE}/events/online-trip/#b/${TOKEN}`);
  assert.equal(await textOf(page, '.bk-copy'), 'انسخ الرابط');
  assert.doesNotMatch(await textOf(page, '#book'), /null|undefined/);
  const stored = await storage(page);
  assert.equal(stored[DRAFT], undefined, 'the draft is gone after success');
  assert.deepEqual(stored['athanasios.bookings.v1'], [{ slug: 'online-trip', ref: 'B-7K2QX', token: TOKEN }]);
  assert.ok(await overflow(page) <= 0);
  await page.screenshot({ path: `${SHOTS}done-360.png`, fullPage: true });
  assert.deepEqual(await axe(page, '#book'), []);

  // the status view (the token only in the fragment)
  await page.click('.bk-done__status-link');
  await page.waitForSelector('#bstat .bstat__chip');
  assert.equal(await page.evaluate(() => location.hash), `#b/${TOKEN}`);
  assert.equal(await textOf(page, '.bstat__chip'), 'قيد المراجعة');
  assert.equal(await textOf(page, '#bstat-title'), 'حجزك B-7K2QX');
  assert.match(await textOf(page, '.bstat__rows'), /فردين/);
  assert.deepEqual(JSON.parse(calls('/v1/book/status').at(-1).body), { token: TOKEN });
  assert.ok(calls('/v1/book/status').every(c => !c.path.includes(TOKEN)), 'never in an address');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'bstat-title');
  assert.ok(await overflow(page) <= 0);
  await page.screenshot({ path: `${SHOTS}status-360.png`, fullPage: true });
  assert.deepEqual(await axe(page, '#bstat'), []);
  assert.doesNotMatch(await textOf(page, '#bstat'), /null|undefined/);

  // «إلغاء الطلب»: asked first, then withdrawn
  await page.click('.bstat__cancel');
  assert.match(await textOf(page, '.bstat__ask'), /متأكد/);
  await page.click('.bstat__confirm .btn--primary');     // «لا، سيبه»
  assert.equal(calls('/v1/book/withdraw').length, 0);
  await page.click('.bstat__cancel');
  await page.click('.bstat__yes');
  await page.waitForFunction(() => document.querySelector('.bstat__chip')?.dataset.status === 'withdrawn');
  assert.equal(await textOf(page, '.bstat__chip'), 'اتلغى بطلبك');
  const [withdraw] = calls('/v1/book/withdraw');
  assert.equal(JSON.parse(withdraw.body).token, TOKEN);
  assert.match(JSON.parse(withdraw.body).requestKey, /^web\./);
  assert.equal(await page.$('.bstat__cancel'), null, 'final');

  // back on the page later: «حجزك B-7K2QX: …» links to the status view
  await page.goto(`${BASE}/events/online-trip/`, { waitUntil: 'networkidle0' });
  await ready(page);
  await page.waitForSelector('.bk-mine');
  assert.equal(await textOf(page, '.bk-mine'), 'حجزك B-7K2QX: اتلغى بطلبك');
  assert.equal(await page.$eval('.bk-mine', a => a.getAttribute('href')), `#b/${TOKEN}`);
  assert.equal(await textOf(page, '.bk-start'), 'احجز الآن', 'a new booking starts fresh');

  assert.deepEqual([...new Set(modules)].sort(), ['book-api.js', 'book-config.js', 'book-model.js', 'book-store.js', 'booking.js', 'image.js', 'status.js']);
  assert.deepEqual(problems, []);
  assert.deepEqual(outside, []);
  await context.close();
});


/* =========================================================
   BACK FROM WHATSAPP
========================================================= */

test('back from WhatsApp: the page opens on the same step with the same requestKey and choices', async () => {
  resetMock();
  const { context, page, problems } = await open('/events/online-trip/');
  await ready(page);
  await live(page, 'open');
  await page.click('.bk-start');
  await fillWho(page);
  await step(page, 'b');
  await page.click('label[for="bk-servant-srv-mina0001"]');
  await page.click('label[for="bk-method-cash"]');
  // the visitor taps WhatsApp (the draft is saved right then); the phone drops the page meanwhile
  await page.evaluate(() => { document.querySelector('.bk-wa__btn').addEventListener('click', e => e.preventDefault()); });
  await page.click('.bk-wa__btn');
  const before = (await storage(page))[DRAFT];
  assert.deepEqual([before.step, before.servantId, before.method, before.fields.name], ['b', 'srv-mina0001', 'cash', 'مينا عادل']);
  assert.equal(JSON.stringify(before).includes('blob'), false);

  await page.reload({ waitUntil: 'networkidle0' });
  await ready(page);
  await step(page, 'b');
  assert.equal(await textOf(page, '.bk-alert'), 'كمّلنا من مكان ما وقفت.');
  assert.equal(await page.$eval('#bk-servant-srv-mina0001', el => el.checked), true);
  assert.equal(await page.$eval('#bk-method-cash', el => el.checked), true);
  assert.equal((await storage(page))[DRAFT].requestKey, before.requestKey);
  // back to a: the name and the counts are still there
  await page.click('.bk-back');
  await step(page, 'a');
  assert.equal(await page.$eval('#bk-name', el => el.value), 'مينا عادل');
  assert.equal(await textOf(page, '.bk-flow .prices__total-n'), '٣٬٠٠٠ جنيه');
  assert.deepEqual(problems, []);
  await context.close();

  // a draft older than 7 days is dropped: a fresh start
  const old = { ...before, savedAt: Date.now() - 8 * 24 * 3600 * 1000 };
  const again = await open('/events/online-trip/', { init: new Function(`try { localStorage.setItem(${JSON.stringify(DRAFT)}, ${JSON.stringify(JSON.stringify(old))}); } catch {}`) });
  await ready(again.page);
  await live(again.page, 'open');
  assert.equal(await textOf(again.page, '.bk-start'), 'احجز الآن');
  assert.equal(await again.page.$('.bk-flow'), null);
  assert.equal((await storage(again.page))[DRAFT], undefined);
  await again.context.close();
});


/* =========================================================
   THE WINDOW AND THE ERRORS
========================================================= */

test('live state: not open (+ the date), closed, full — no flow, the servants\' WhatsApp for questions', async () => {
  for (const [state, chip, line, cls] of [
    [{ ok: true, open: false, reason: 'not_open', opensAt: '2026-10-15T19:00', closesAt: '', left: null, revision: 'r' }, 'لسه ما فتحش', 'الحجز يفتح الخميس ١٥ أكتوبر الساعة ٧ بالليل', 'is-before'],
    [{ ok: true, open: false, reason: 'closed', opensAt: '', closesAt: '', left: null, revision: 'r' }, 'الحجز اتقفل', '', 'is-closed'],
    [{ ok: true, open: false, reason: 'full', opensAt: '', closesAt: '', left: 0, revision: 'r' }, 'اكتمل العدد', 'اكتمل العدد. لو حد اعتذر هيفضى مكان.', 'is-closed']
  ]) {
    resetMock();
    mock.state = { status: 200, body: state };
    const { context, page, problems } = await open('/events/online-trip/');
    await ready(page);
    await live(page, state.reason);
    assert.equal(await textOf(page, '.book__state'), chip);
    assert.ok(await page.$eval('#book', (el, cls) => el.classList.contains(cls), cls));
    if (line) assert.equal(await textOf(page, '.bk__state'), line);
    assert.equal(await page.$('.bk-start'), null);
    assert.equal(await page.$eval('.people--servants', el => getComputedStyle(el).display), 'grid');
    assert.match(await textOf(page, '.book__line'), /كلّم خادم من دول على واتساب/);
    assert.equal(await textOf(page, '.phero__cta'), 'الأسعار والحجز');
    assert.ok(await overflow(page) <= 0);
    assert.deepEqual(problems, []);
    await context.close();
  }
});

test('submit errors: invalid field → that step and field; full → the counts and the places left; limit; closed → the state again', async () => {
  resetMock();
  const { context, page, problems } = await open('/events/online-trip/');
  await ready(page);
  await live(page, 'open');
  await page.click('.bk-start');
  await fillWho(page);
  await choosePay(page, 'cash');                                  // cash: the picture is optional
  await agree(page);

  mock.submit = json(400, { ok: false, code: 'invalid', field: 'phone', message: 'x' });
  await page.click('.bk-send');
  await step(page, 'a');
  await page.waitForFunction(() => document.querySelector('#bk-phone')?.getAttribute('aria-invalid') === 'true');
  assert.match(await textOf(page, '#bk-phone-err'), /رقم الموبايل مش مظبوط/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'bk-phone');
  const key = JSON.parse(calls('/v1/book/submit')[0].body).requestKey;

  mock.submit = json(409, { ok: false, code: 'full', left: 1, message: 'x' });
  await page.click('.bk-flow .bk-next');
  await choosePay(page, 'cash');
  await agree(page);
  await page.click('.bk-send');
  await step(page, 'a');
  await page.waitForSelector('[data-field="counts"].is-invalid');
  assert.match(await textOf(page, '#bk-counts-err'), /فاضل مكان واحد بس/);

  mock.submit = json(429, { ok: false, code: 'limit', message: 'x' });
  await page.click('.bk-flow [aria-label="قلّل فرد إضافي"]');
  await page.click('.bk-flow .bk-next');
  await choosePay(page, 'cash');
  await agree(page);
  await page.click('.bk-send');
  await page.waitForFunction(() => /طلبين/.test(document.querySelector('.bk-alert')?.textContent || ''));
  assert.equal(await page.$eval('.bk-send', b => b.disabled), false, 'can try again');

  mock.submit = json(409, { ok: false, code: 'closed', message: 'x' });
  mock.state = { status: 200, body: { ok: true, open: false, reason: 'closed', opensAt: '', closesAt: '', left: null, revision: 'r' } };
  await page.click('.bk-send');
  await live(page, 'closed');
  assert.equal(await textOf(page, '.book__state'), 'الحجز اتقفل');
  assert.equal(await textOf(page, '.bk__state'), 'الحجز اتقفل.');
  assert.equal(await page.$('.bk-flow'), null);

  // every attempt carried the same requestKey (a repeat never books twice)
  assert.ok(calls('/v1/book/submit').every(c => JSON.parse(c.body).requestKey === key));
  assert.deepEqual(problems, []);
  await context.close();
});

test('not open at submit: the words with the date, the state read again', async () => {
  resetMock();
  const { context, page, problems } = await open('/events/online-trip/');
  await ready(page);
  await live(page, 'open');
  await page.click('.bk-start');
  await fillWho(page);
  await choosePay(page, 'cash');
  await agree(page);
  mock.submit = json(409, { ok: false, code: 'not_open', opensAt: '2026-10-15T19:00', message: 'x' });
  mock.state = { status: 200, body: { ok: true, open: false, reason: 'not_open', opensAt: '2026-10-15T19:00', closesAt: '', left: null, revision: 'r' } };
  const before = calls('/v1/book/state').length;
  await page.click('.bk-send');
  await live(page, 'not_open');
  assert.ok(calls('/v1/book/state').length > before);
  assert.equal(await textOf(page, '.book__state'), 'لسه ما فتحش');
  assert.match(await textOf(page, '.bk__state'), /بيفتح الخميس ١٥ أكتوبر/);
  assert.ok((await storage(page))[DRAFT], 'the draft waits for the window');
  assert.deepEqual(problems, []);
  await context.close();
});


/* =========================================================
   NEVER BROKEN
========================================================= */

test('API down or booking switched off → the servants\' WhatsApp display (Phase 3), the page works', async () => {
  for (const setup of [() => { mock.down = true; }, () => { mock.state = json(403, { ok: false, code: 'disabled', message: 'x' }); }, () => { mock.state = json(200, { ok: true, open: false, reason: 'disabled', left: null }); }]) {
    resetMock();
    setup();
    const { context, page, problems } = await open('/events/online-trip/');
    await ready(page);
    await page.waitForSelector('.bk[data-live="fallback"]', { timeout: 8000 });
    assert.equal(await page.$eval('.bk', el => el.hidden), true);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await page.$eval('#book', el => el.className), 'pg-section book is-open', 'as view.js drew it');
    assert.equal(await textOf(page, '.book__state'), 'الحجز مفتوح');
    assert.equal(await textOf(page, '.book__line'), 'للحجز كلّم خادم من دول على واتساب');
    assert.equal(await page.$eval('.people--servants', el => getComputedStyle(el).display), 'grid');
    assert.match(await page.$eval('.people--servants .btn--wa', a => a.href), /^https:\/\/wa\.me\/201001234567\?text=/);
    assert.equal(await page.$('.bk-start'), null);
    // the optional counter works as today
    await page.click('#book > .prices [aria-label="زوّد فرد إضافي"]');
    assert.equal(await textOf(page, '#book > .prices .prices__total-n'), '٣٬٠٠٠ جنيه');
    if (mock.down) assert.equal(calls('/v1/book/state').length, 3, 'tried three times');
    assert.deepEqual(problems.filter(p => !/ERR_CONNECTION_REFUSED|net::/.test(p)), []);
    await context.close();
  }
});

test('submit says disabled → the WhatsApp display, the draft kept', async () => {
  resetMock();
  const { context, page, problems } = await open('/events/online-trip/');
  await ready(page);
  await live(page, 'open');
  await page.click('.bk-start');
  await fillWho(page);
  await choosePay(page, 'cash');
  await agree(page);
  mock.submit = json(403, { ok: false, code: 'disabled', message: 'x' });
  await page.click('.bk-send');
  await page.waitForFunction(() => !document.getElementById('book').classList.contains('is-online'));
  assert.equal(await page.$('.bk-flow'), null);
  assert.equal(await page.$eval('.people--servants', el => getComputedStyle(el).display), 'grid');
  assert.ok((await storage(page))[DRAFT]);
  assert.deepEqual(problems, []);
  await context.close();
});


/* =========================================================
   THE ADMIN PREVIEW
========================================================= */

test('preview (?preview): an online event shows the online look, still — no request to the API, nothing stored', async () => {
  resetMock();
  const { context, page, problems, apiCalls } = await open('/__test/preview-parent.html');
  const frame = await (await page.waitForSelector('#frame')).contentFrame();
  await frame.waitForSelector('main[data-state="loading"]');
  const shown = await page.evaluate(async data => {
    const got = new Promise(resolve => addEventListener('message', e => { if (e.data && /page-preview-(shown|error)/.test(e.data.type)) resolve(e.data.type); }));
    document.getElementById('frame').contentWindow.postMessage({ type: 'athanasios:page-preview', kind: 'event', data }, location.origin);
    return got;
  }, ONLINE);
  assert.equal(shown, 'athanasios:page-preview-shown');
  await frame.waitForSelector('.bk-start');
  assert.equal(await frame.$eval('.bk-start', b => b.disabled), true);
  assert.equal(await frame.$eval('#book', el => el.dataset.live), 'open');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.deepEqual(apiCalls, [], 'no API call');
  assert.deepEqual(await frame.evaluate(() => Object.keys(localStorage)), []);
  assert.deepEqual(problems, []);
  await context.close();
});
