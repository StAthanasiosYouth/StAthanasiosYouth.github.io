// v3 in the admin, in a real browser, against the real server (docs/COMPETITIONS.md §19):
//  - «مواعيد المتجر»: «للعرض بس (من غير طلب)», «اعرض الجوايز قبل ما الطلب يفتح» in
//    تلقائي, the «للعرض» state chip, each mode said
//  - the builder: «السماح بالمشاركة بدون كود» brings the form fields; a guest's
//    submission says «ضيف», an out-of-range code's «من غير نقاط (السن)»
//  - «النتيجة»: the answers never by default; the reveal is optional, with its warning
//  - participants: birth date (day / month / year), age, eligibility chips, the
//    filter with its counts, the person page (age, leaving the range)
//  - «الإعدادات»: «الفئة العمرية لنظام النقاط» saved and applied at once
//  - the names template's «تاريخ الميلاد» and its import (new + a changed date)
//  - 360px, no sideways scroll
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/comp-admin4.e2e.mjs

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';
import { writeXlsx, readXlsx } from '../admin/xlsx.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4681;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN = 'menazakmena@gmail.com';
const SHOTS = `${ROOT}tools/.cache/comp-admin4/`;
const DESKTOP = { width: 1366, height: 900 };
const SMALL = { width: 360, height: 760 };
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
let d;
const ctx = {};
const claims = { email: ADMIN };

/* the .gs functions as the admin, plain results */
const gs = new Proxy({}, { get: (_, name) => (...args) => { const g = world.as(ADMIN).gs; const api = /^api/.test(name) ? g.apiFunctions_()[name] : null; const fn = typeof api === 'function' ? api : g[name]; return JSON.parse(JSON.stringify(fn(...args)) ?? null); } });
const pub = (fn, arg) => { const r = world.post({ fn, args: [arg] }); delete r.mime; return r; };

/* Cairo wall clock "YYYY-MM-DD HH:MM", minutes from the world's now */
function wallAt(minutes) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(world.now() + minutes * 60000)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/* a birth date that makes someone `years` old today, the next birthday `days` away */
function bornFor(years, days = 100) {
  const today = new Date(world.now());
  return new Date(Date.UTC(today.getUTCFullYear() - years - 1, today.getUTCMonth(), today.getUTCDate() + days)).toISOString().slice(0, 10);
}

/* plays the coded competition with a code (or as a guest with the form) */
function play(key, start) {
  const begun = pub('compStart', { slug: 'points-quiz', clientKey: key, ...start });
  assert.equal(begun.ok, true, JSON.stringify(begun));
  const answers = {};
  for (const q of begun.questions) answers[q.id] = q.type === 'single' ? q.choices.find(c => c.text === 'نوح').id : 't';
  const done = pub('compSubmit', { token: begun.attempt.token, clientKey: key, answers });
  assert.equal(done.ok, true, JSON.stringify(done));
  return done;
}

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', `${SITE}/`);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.properties.set('ADMIN_EMAILS', ADMIN);
  world.properties.set('ADMIN_NAMES', JSON.stringify({ [ADMIN]: 'مينا زكريا' }));
  world.gs.SESSION_STALE_SECONDS = 0;

  // registry + wallet + store; the default age rules (18–30, 60 days' warning)
  gs.apiCompSettings({ registry: true, wallet: true, shop: true });
  ctx.young = gs.apiParticipantSave({ name: 'مينا عادل جرجس', phone: '01012340001', group: 'جامعة', birthDate: bornFor(22) }).participant;
  ctx.soon = gs.apiParticipantSave({ name: 'كيرلس سامي نبيل', phone: '01012340002', group: 'خريجين', birthDate: bornFor(30, 20) }).participant;
  ctx.old = gs.apiParticipantSave({ name: 'فادي يوسف حنا', phone: '01012340003', group: 'خريجين', birthDate: bornFor(33) }).participant;
  ctx.none = gs.apiParticipantSave({ name: 'بيتر مجدي', phone: '01012340004', group: 'جامعة' }).participant;
  ctx.comp = gs.apiCompCreate({ preset: 'points', title: 'مسابقة النقاط', slug: 'points-quiz', enabled: true }).comp.id;
  gs.apiCompQuestionSave(ctx.comp, { type: 'single', text: 'مين بنى الفلك؟', choices: [{ text: 'نوح', correct: true }, { text: 'موسى' }], points: 10 });
  gs.apiCompQuestionSave(ctx.comp, { type: 'truefalse', text: 'داود غلب جليات', correct: 'صح', points: 5 });
  gs.apiPublish(gs.apiReview().revision);
  // the out-of-range code plays: recorded without points
  play('v3-old-key-0000001', { ptoken: pub('compCode', { code: gs.apiParticipantCode(ctx.old.id).code }).ptoken });
  world.as('');

  server = createSiteServer({
    world: { issueToken: c => world.issueToken(c), get github() { return world.github; } },
    config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK, timing: TIMING }),
    claims: () => claims
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (/content\.json\?check=/.test(message.text())) return;
    if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(`csp: ${message.text()}`);
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text()}`);
  });
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  await page.setViewport(DESKTOP);
  await interceptGoogle(page, { post: body => world.post(body) });
  await page.goto(`${LOCAL}/admin/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
  d = { context, page, problems };
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => (server ? server.close(resolve) : resolve()));
});

const shot = async name => { await sleep(500); await d.page.screenshot({ path: `${SHOTS}${name}.png` }); };
const $ = selector => d.page.waitForSelector(selector, { timeout: 10000 });
const idle = () => d.page.waitForNetworkIdle({ idleTime: 350, timeout: 15000 }).catch(() => {});
async function jsClick(selector) {
  await idle();
  await d.page.waitForSelector(selector, { timeout: 10000 });
  await d.page.$eval(selector, n => n.click());
}
const clickText = (selector, words) => d.page.evaluate((s, w) => {
  const node = [...document.querySelectorAll(s)].find(n => n.textContent.includes(w) && n.offsetParent !== null);
  if (!node) throw new Error(`no ${s} with ${w}`);
  node.click();
}, selector, words);
const setDate = (scope, label, value) => d.page.evaluate((s, l, v) => {
  const field = [...document.querySelectorAll(`${s} .field[data-label="${l}"]`)].find(f => f.offsetParent !== null);
  const [date, time] = v.split(' ');
  const set = (input, x) => { input.value = x; input.dispatchEvent(new Event('input', { bubbles: true })); };
  set(field.querySelector('input[type=date]'), date);
  set(field.querySelector('input[type=time]'), time || '');
}, scope, label, value);
const setField = (scope, label, value) => d.page.evaluate((s, l, v) => {
  const field = [...document.querySelectorAll(`${s} .field[data-label="${l}"]`)].find(f => f.offsetParent !== null);
  const input = field.querySelector('input:not([type=checkbox]):not([type=radio]), textarea');
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, scope, label, value);
const setBirth = (scope, day, month, year) => d.page.evaluate((s, parts) => {
  for (const [key, value] of Object.entries(parts)) {
    const select = document.querySelector(`${s} select[data-birth="${key}"]`);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}, scope, { day, month, year });
const overflow = () => d.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const text = selector => d.page.$eval(selector, n => n.textContent);
const visible = selector => d.page.$eval(selector, n => !n.closest('[hidden]') && n.offsetParent !== null);


/* ---------------- the store: preview ---------------- */

test('«مواعيد المتجر»: «للعرض بس (من غير طلب)»; in تلقائي «اعرض الجوايز قبل ما الطلب يفتح»; the «للعرض» chip; each mode said', async () => {

  await d.page.evaluate(() => A.go('comps', 'shop'));
  await $('.comp-shop-schedule .comp-shop-state');
  // تلقائي: the preview tick is there, off
  assert.equal(await visible('.comp-shop-schedule [data-preview]'), true);
  assert.equal(await d.page.$eval('.comp-shop-schedule [data-preview] input', n => n.checked), false);
  assert.match(await text('.comp-shop-schedule .comp-mode-said'), /تلقائي = بيفتح ويقفل لوحده/);

  // للعرض بس: said, and the tick goes (it belongs to تلقائي)
  await d.page.$eval('.comp-shop-schedule input[type=radio][value="preview"]', n => n.click());
  assert.match(await text('.comp-shop-schedule .comp-mode-said'), /للعرض بس = الجوايز وأسعارها ظاهرة في «نقاطي»، بس الطلب مقفول/);
  assert.equal(await d.page.$eval('.comp-shop-schedule [data-preview]', n => n.hidden), true);
  await jsClick('[data-act="schedule-save"]');
  await d.page.waitForFunction(() => /للعرض/.test(document.querySelector('.comp-shop-state')?.textContent || ''), { timeout: 10000 });
  let saved = gs.apiShopSchedule();
  assert.deepEqual([saved.mode, saved.state], ['preview', 'preview']);
  await shot('01-shop-preview');

  // تلقائي + «اعرض الجوايز قبل ما الطلب يفتح» before the opening
  await d.page.$eval('.comp-shop-schedule input[type=radio][value="auto"]', n => n.click());
  assert.equal(await visible('.comp-shop-schedule [data-preview]'), true);
  await setDate('.comp-shop-schedule', 'بيفتح', wallAt(2 * 24 * 60));
  await d.page.$eval('.comp-shop-schedule [data-preview] input', n => n.click());
  await jsClick('[data-act="schedule-save"]');
  await d.page.waitForFunction(() => /للعرض — الطلب هيفتح/.test(document.querySelector('.comp-shop-state')?.textContent || ''), { timeout: 10000 });
  saved = gs.apiShopSchedule();
  assert.deepEqual([saved.mode, saved.preview, saved.state], ['auto', true, 'preview']);

  // read back
  await d.page.evaluate(() => A.render());
  await $('.comp-shop-schedule [data-preview] input');
  assert.equal(await d.page.$eval('.comp-shop-schedule [data-preview] input', n => n.checked), true);
  assert.equal(await d.page.$eval('.comp-shop-schedule input[type=radio][value="auto"]', n => n.checked), true);

  // without the tick: «هيفتح»
  await d.page.$eval('.comp-shop-schedule [data-preview] input', n => n.click());
  await jsClick('[data-act="schedule-save"]');
  await d.page.waitForFunction(() => /^هيفتح/.test((document.querySelector('.comp-shop-state .chip')?.textContent || '').trim()), { timeout: 10000 });
  assert.equal(gs.apiShopSchedule().state, 'scheduled');
  // back to open for the rest
  gs.apiShopScheduleSave({ mode: 'open', notify: {} });
  assert.deepEqual(d.problems, []);

});


/* ---------------- the builder: guests, and the answers kept private ---------------- */

test('«النتيجة»: the answers never by default («أبدًا (مُستحسن)»); the reveal is optional, with its warning; per-question points off', async () => {

  const fresh = gs.apiCompCreate({ preset: 'scored', title: 'مسابقة عامة', slug: 'scored-quiz' }).comp;
  assert.equal(fresh.answersShow, 'never');
  await d.page.evaluate(id => A.compOpen(id, 'result'), fresh.id);
  await $('.comp-tab[data-tab="result"] .comp-reveal-group');
  assert.equal(await d.page.$eval('.comp-reveal-group input[value="never"]', n => n.checked), true);
  assert.match(await text('.comp-reveal-group'), /أبدًا \(مُستحسن\)/);
  assert.equal(await d.page.$eval('.comp-reveal', n => n.open), false, 'the reveals are tucked away');
  assert.match(await text('.comp-reveal summary'), /كشف الإجابات \(اختياري\)/);
  assert.match(await text('.comp-reveal__warn'), /لو كشفت الإجابات، الأسئلة مش هتنفع تتعاد تاني من غير ما تتسرب/);
  const points = await d.page.evaluate(() => { const box = [...document.querySelectorAll('.comp-tab .check')].find(n => /تظهر درجة كل سؤال وهو بيحل/.test(n.textContent)); return { on: box.querySelector('input').checked, text: box.textContent }; });
  assert.equal(points.on, false);
  assert.match(points.text, /نتيجته النهائية بس/);
  assert.match(await text('.comp-tab'), /نتيجته النهائية بس/);

  // an explicit reveal is saved; back to never
  await d.page.$eval('.comp-reveal summary', n => n.click());
  await d.page.$eval('.comp-reveal input[value="afterClose"]', n => n.click());
  await shot('04-reveal');
  await clickText('.comp-tab .comp-save button', 'حفظ');
  await d.page.waitForFunction(() => !A.dirty, { timeout: 10000 });
  await idle();
  assert.equal(gs.apiComp(fresh.id).comp.answersShow, 'afterClose');
  await d.page.evaluate(() => A.render());
  await $('.comp-reveal');
  assert.equal(await d.page.$eval('.comp-reveal', n => n.open), true, 'a chosen reveal shows open');
  await d.page.$eval('.comp-reveal-group input[value="never"]', n => n.click());
  await clickText('.comp-tab .comp-save button', 'حفظ');
  await d.page.waitForFunction(() => !A.dirty, { timeout: 10000 });
  await idle();
  assert.equal(gs.apiComp(fresh.id).comp.answersShow, 'never');
  assert.deepEqual(d.problems, []);

});


/* ---------------- participants: birth dates and eligibility ---------------- */

/* ---------------- phone width ---------------- */

