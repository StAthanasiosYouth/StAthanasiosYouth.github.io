// Competitions and «نقاطي» with accounts on (docs/PHASE5-PLAN.md P5-8), in headless Chrome against the REAL pages and
// the REAL Worker code on SQLite (nothing mocked but Google's and Cloudflare's parts): signed out → /account/ → back;
// a whole competition; the store; the guest lock; and that nothing reaches Apps Script.
// Run: cd tools && node --experimental-sqlite --no-warnings --test ../tests/comp-accounts.e2e.mjs

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { harness } from '../worker/test/helpers.mjs';
import { signSync } from '../worker/src/lib/sync.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4745;
const LOCAL = `http://localhost:${PORT}`;
const API = 'https://athanasios-api.menazak-lab.workers.dev';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find(existsSync);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const KEYS = { PW_PEPPER: 'pepper', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp', ACCOUNT_PAD_MS: '0' };

const COMP = {
  schema: 1, id: 'c-aaaaaaaa', slug: 'bible-quiz', v: 'v1', title: 'مسابقة الكتاب', shortTitle: 'الكتاب', description: '', instructions: '', ctaLabel: 'ابدأ', banner: null, icon: null, theme: '', startAt: '', endAt: '', resultsAt: '',
  participation: 'open', scoring: true, resultShow: 'both', answersShow: 'immediately', answersAt: '', showPoints: true, wallet: true, attempts: 1, layout: 'one', shuffleQ: false, shuffleC: false, timeLimit: 0, maxSubmissions: 0, uniquePhone: false, allowGuests: false, fields: [], successText: 'شكرًا',
  questions: [{ id: 'q1', type: 'single', text: 'سؤال واحد', help: '', media: null, required: true, points: 10, choices: [{ id: 'a', text: 'الصح' }, { id: 'b', text: 'الغلط' }], correct: 'a', explanation: 'الشرح', review: '' }]
};

let h, server, browser, tick = 0;
const appsScript = [];

test.before(async () => {
  h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ...KEYS } });
  await h.db.prepare("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'").run();
  await h.db.prepare("UPDATE settings SET value = 'open' WHERE key = 'SHOP_MODE'").run();
  await h.db.prepare("INSERT INTO store_items (id, name, cost, created_ms, updated_ms) VALUES ('i-aaaaaaaa', 'كتاب هدية', 5, 1, 1)").run();
  const raw = JSON.stringify({ comps: [{ slug: COMP.slug, compId: COMP.id, version: 'v1', def: COMP, closedAt: '', finalizedAt: '' }] });
  const ts = String(Date.now() + (++tick));
  const pushed = await h.call('/v1/sync/comp-live', { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': await signSync(h.env.SYNC_SECRET, ts, raw) } });
  assert.equal(pushed.status, 200, JSON.stringify(pushed.body));
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, LOCAL).pathname);
    let file = normalize(path);
    // a published competition's stub is the shell with the slug on <html>
    if (path === `/competition/${COMP.slug}/`) {
      const shell = readFileSync(join(ROOT, 'competition/index.html'), 'utf8').replace('<html', `<html data-slug="${COMP.slug}" data-v="v1"`).replace(/(href|src)="\.\.\//g, '$1="../../');
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      res.end(shell);
      return;
    }
    if (path === `/competition/${COMP.slug}/comp.json`) {
      res.writeHead(200, { 'content-type': TYPES['.json'] });
      const { questions, ...pub } = COMP;
      res.end(JSON.stringify(pub));
      return;
    }
    if (file.endsWith('\\') || file.endsWith('/')) file += 'index.html';
    try {
      const body = readFileSync(join(ROOT, file));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    }
    catch {
      res.writeHead(404);
      res.end('');
    }
  });
  await new Promise(resolve => server.listen(PORT, resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => (server ? server.close(resolve) : resolve()));
});

/* the page's calls to the Worker run the Worker's own handle() here */
async function open(path) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.setViewport({ width: 390, height: 844 });
  await page.setRequestInterception(true);
  page.on('request', async request => {
    const url = new URL(request.url());
    if (url.origin === LOCAL) return request.continue();
    if (url.hostname === 'script.google.com') appsScript.push(url.href);
    if (url.origin === API) {
      const cors = { 'Access-Control-Allow-Origin': LOCAL, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type' };
      if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers: cors, body: '' });
      const headers = request.headers().authorization ? { authorization: request.headers().authorization } : {};
      const reply = await h.call(url.pathname + url.search, { method: request.method(), body: request.postData() || undefined, headers: { ...headers, 'cf-connecting-ip': '10.1.1.' + (++tick % 200) } });
      return request.respond({ status: reply.status, headers: cors, contentType: 'application/json', body: JSON.stringify(reply.body) });
    }
    return request.respond({ status: 204, body: '' });
  });
  await page.goto(LOCAL + path, { waitUntil: 'domcontentloaded' });
  return { context, page, problems };
}

async function register(page, { birth = ['12', '3', '2003'] } = {}) {
  const email = `e2e${++tick}${Date.now()}@staging.invalid`;
  const set = (selector, value) => page.$eval(selector, (n, v) => { n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  await page.waitForSelector('#acct-email', { timeout: 10000 });
  await set('#acct-email', email);
  await page.$eval('form', f => f.requestSubmit());
  await page.waitForSelector('[data-create]:not([hidden])', { timeout: 8000 });
  await page.waitForFunction(() => { const n = document.querySelector('[data-none]'); return n && !n.hidden; });
  await page.click('[data-create]');
  await page.waitForSelector('#acct-phone');
  await set('#acct-phone', '011' + String(10000000 + (++tick)));
  await set('#acct-name', 'مينا زكريا فؤاد');
  await set('#acct-day', birth[0]);
  await set('#acct-month', birth[1]);
  await set('#acct-year', birth[2]);
  await page.$eval('form', f => f.requestSubmit());
  await page.waitForSelector('[data-send]');
  await page.click('[data-send]');
  await page.waitForSelector('[data-test-code]', { timeout: 8000 });
  const code = await page.$eval('[data-test-code]', n => n.dataset.testCode);
  await set('#acct-code', code);
  await page.$eval('form', f => f.requestSubmit());
  await page.waitForSelector('[data-password]', { timeout: 8000 });
  await page.$eval('form', f => f.requestSubmit());
}

test('a new person starts from the first screen: the button, the email on the form, the support name, and back to sign in', async () => {
  const { context, page, problems } = await open('/account/');
  await page.waitForSelector('[data-create-new]', { timeout: 10000 });
  assert.match(await page.$eval('[data-support]', n => n.textContent), /مينا زكريا/);
  await page.click('[data-create-new]');
  await page.waitForSelector('#acct-reg-email');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'acct-reg-email');
  await page.$eval('form', f => f.requestSubmit());
  await page.waitForSelector('[data-field="email"] .field__error');
  const set = (selector, value) => page.$eval(selector, (n, v) => { n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  const email = `first${Date.now()}@staging.invalid`;
  await set('#acct-reg-email', email);
  await set('#acct-phone', '011' + String(10000000 + (++tick)));
  await set('#acct-name', 'مينا زكريا فؤاد');
  await set('#acct-day', '12');
  await set('#acct-month', '3');
  await set('#acct-year', '2003');
  await page.$eval('form', f => f.requestSubmit());
  await page.waitForSelector('[data-send]');
  await page.click('[data-send]');
  await page.waitForSelector('[data-test-code]', { timeout: 8000 });
  assert.deepEqual(problems, []);
  await context.close();

  const again = await open('/account/');
  await again.page.waitForSelector('[data-create-new]', { timeout: 10000 });
  await again.page.click('[data-create-new]');
  await again.page.waitForSelector('#acct-reg-email');
  const typed = (selector, value) => again.page.$eval(selector, (n, v) => { n.value = v; n.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  await typed('#acct-reg-email', 'someone@gmial.com');
  await typed('#acct-phone', '01112345678');
  await typed('#acct-name', 'مينا زكريا فؤاد');
  await typed('#acct-day', '12');
  await typed('#acct-month', '3');
  await typed('#acct-year', '2003');
  await again.page.$eval('form', f => f.requestSubmit());
  await again.page.waitForFunction(() => /قصدك/.test(document.body.innerText), { timeout: 5000 });
  assert.equal(await again.page.$eval('#acct-phone', n => n.value), '01112345678', 'what was typed stays');
  await again.page.waitForSelector('[data-have-account]');
  await again.page.click('[data-have-account]');
  await again.page.waitForSelector('#acct-email');
  assert.equal(await again.page.$eval('#acct-email', n => n.value), 'someone@gmial.com', 'the email typed comes along');
  await again.context.close();
});

test('signed out at a competition → /account/ → back to it → answers → result with points; «نقاطي» and the store follow', async () => {
  const { context, page, problems } = await open(`/competition/${COMP.slug}/`);
  await page.waitForFunction(() => /ابدأ/.test(document.body.innerText), { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /ابدأ/.test(b.textContent)).click());
  await page.waitForFunction(() => location.pathname === '/account/', { timeout: 10000 });
  await register(page);
  await page.waitForFunction(slug => location.pathname === `/competition/${slug}/`, { timeout: 10000 }, COMP.slug);
  await page.waitForFunction(() => /ابدأ/.test(document.body.innerText), { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /ابدأ/.test(b.textContent)).click());
  await page.waitForFunction(() => /سؤال واحد/.test(document.body.innerText), { timeout: 10000 });
  assert.ok(!/الشرح/.test(await page.evaluate(() => document.body.innerText)), 'no key on the question');
  await page.evaluate(() => { [...document.querySelectorAll('label, button')].find(n => /الصح/.test(n.textContent)).click(); });
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /ابعت|إرسال|خلصت|التالي|راجع/.test(x.textContent)); if (b) b.click(); });
  for (let i = 0; i < 4 && !(await page.evaluate(() => /الدرجة|١٠|10/.test(document.body.innerText) && /شكرًا|نتيجة|درجت/.test(document.body.innerText))); i++) {
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /ابعت|إرسال|تأكيد|أيوه/.test(x.textContent)); if (b) b.click(); });
  }
  await page.waitForFunction(() => /١٠/.test(document.body.innerText), { timeout: 10000 });

  const sub = await h.db.prepare('SELECT * FROM submissions').first();
  assert.equal(sub.status, 'graded');
  assert.equal(sub.score, 10);
  assert.equal((await h.db.prepare('SELECT SUM(amount) AS n FROM points_ledger').first()).n, 10);

  await page.goto(`${LOCAL}/points/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-balance="10"]', { timeout: 10000 });
  const portal = await page.evaluate(() => document.body.innerText);
  assert.match(portal, /كتاب هدية/);
  assert.match(portal, /الكتاب/);
  await page.evaluate(() => document.querySelector('[data-order]').click());
  await page.waitForSelector('[data-confirm-order]', { timeout: 5000 });
  await page.evaluate(() => document.querySelector('[data-confirm-order]').click());
  await page.waitForSelector('[data-balance="5"]', { timeout: 10000 });
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM redemptions WHERE status = 'pending'").first()).n, 1);
  assert.deepEqual(problems, []);
  assert.deepEqual(appsScript, [], 'nothing reaches Apps Script');
  await context.close();
});

test('«نقاطي» signed out → /account/; a guest sees the order locked, the server agrees', async () => {
  const { context, page, problems } = await open('/points/');
  await page.waitForFunction(() => location.pathname === '/account/', { timeout: 10000 });
  await register(page, { birth: ['1', '1', '1980'] });
  await page.waitForFunction(() => location.pathname === '/points/', { timeout: 10000 });
  await page.waitForSelector('[data-balance]', { timeout: 10000 });
  const text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /خارج النطاق العمري/);
  assert.match(text, /كتاب هدية/, 'still browses');
  assert.equal(await page.$$eval('[data-order]', n => n.length), 0, 'no order button');
  assert.deepEqual(problems, []);
  await context.close();
});
