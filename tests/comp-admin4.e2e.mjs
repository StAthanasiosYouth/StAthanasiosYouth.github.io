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
import { PEOPLE_HEADERS, PEOPLE_SHEET } from '../admin/comp-sheets.js';

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

test('«المشاركة»: «السماح بالمشاركة بدون كود» brings the form; saved; a guest shows «ضيف», an out-of-range code «من غير نقاط (السن)»', async () => {

  await d.page.evaluate(id => A.compOpen(id, 'people'), ctx.comp);
  await $('.comp-tab[data-tab="people"] .comp-guests');
  assert.match(await text('.comp-guests'), /السماح بالمشاركة بدون كود[\s\S]*مبياخدش نقاط/);
  const formPart = () => d.page.evaluate(() => { const label = [...document.querySelectorAll('.comp-tab .section-label')].find(n => /البيانات اللي بيكتبها/.test(n.textContent)); return { shown: !label.parentElement.hidden, label: label.textContent }; });
  assert.equal((await formPart()).shown, false, 'no form without guests');
  await d.page.$eval('.comp-guests input[type=checkbox]', n => n.click());
  assert.deepEqual(await formPart(), { shown: true, label: 'البيانات اللي بيكتبها الضيف (اللي من غير كود)' });
  await shot('02-guests');
  await clickText('.comp-tab .comp-save button', 'حفظ');
  await d.page.waitForFunction(() => !A.dirty, { timeout: 10000 });
  await idle();
  assert.equal(gs.apiComp(ctx.comp).comp.allowGuests, true);

  // read back
  await d.page.evaluate(() => A.render());
  await $('.comp-guests input');
  assert.equal(await d.page.$eval('.comp-guests input', n => n.checked), true);
  assert.equal((await formPart()).shown, true);

  // a guest plays with the form; then the submissions say who is who
  gs.apiPublish(gs.apiReview().revision);
  world.as('');
  const guest = play('v3-guest-key-000001', { fields: { name: 'زائر كبير', phone: '01099990000' } });
  assert.equal(guest.result.guest, true);
  await d.page.evaluate(() => { A.comp.tab = 'subs'; A.render(); });
  await $('.comp-sub [data-flag]');
  const flags = await d.page.$$eval('.comp-sub', n => n.map(r => ({ who: r.querySelector('.comp-sub__name')?.textContent, flags: [...r.querySelectorAll('[data-flag]')].map(c => [c.dataset.flag, c.textContent]).filter(f => f[0] === 'guest' || f[0] === 'noPoints') })));
  assert.deepEqual(flags.find(r => r.who === 'زائر كبير').flags, [['guest', 'ضيف']], JSON.stringify(flags));
  assert.deepEqual(flags.find(r => r.who === 'فادي يوسف حنا').flags, [['noPoints', 'من غير نقاط (السن)']], JSON.stringify(flags));
  const options = await d.page.$$eval('.view select[aria-label="علامات"] option', n => n.map(o => o.value));
  assert.ok(options.includes('guest') && options.includes('noPoints'), options.join());
  await shot('03-subs-flags');

  // the detail
  await d.page.evaluate(() => [...document.querySelectorAll('.comp-sub')].find(r => /زائر كبير/.test(r.textContent)).click());
  await $('dialog.sheet[open] [data-flag="guest"]');
  assert.match(await d.page.$eval('dialog.sheet[open] [data-flag="guest"]', n => n.title), /من غير كود/);
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
  assert.deepEqual(d.problems, []);

});

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

test('participants: birth date day / month / year saved and read back; age + eligibility chips; the filter with counts; the person page', async () => {

  await d.page.evaluate(() => { A.compPeople.open = ''; return A.go('comps', 'people'); });
  await $('.comp-ages [data-eligibility="ok"]');
  const chips = await d.page.$$eval('.comp-ages .filter-chip', n => n.map(c => [c.dataset.eligibility, c.textContent]));
  assert.deepEqual(chips, [['all', 'كل الأعمار'], ['ok', 'مناسب (١)'], ['soon', 'قرب يخرج من السن (١)'], ['out', 'خارج السن (١)'], ['unknown', 'من غير تاريخ ميلاد (١)']]);
  const row = id => d.page.$eval(`.comp-person[data-id="${id}"]`, n => ({ text: n.textContent, state: n.querySelector('[data-eligibility]')?.dataset.eligibility }));
  assert.deepEqual((await row(ctx.young.id)).state, 'ok');
  assert.match((await row(ctx.young.id)).text, /٢٢ سنة/);
  assert.match((await row(ctx.soon.id)).text, /قرب يخرج من السن — هيكمّل ٣١ سنة يوم /);
  assert.equal((await row(ctx.old.id)).state, 'out');
  assert.equal((await row(ctx.none.id)).state, 'unknown');
  await shot('05-people-ages');

  // the filter
  await d.page.click('.comp-ages [data-eligibility="out"]');
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-person').length === 1, { timeout: 10000 });
  assert.equal(await d.page.$eval('.comp-person', n => n.dataset.id), ctx.old.id);
  assert.equal(await d.page.$eval('.comp-ages [data-eligibility="out"]', n => n.getAttribute('aria-pressed')), 'true');
  await d.page.click('.comp-ages [data-eligibility="all"]');
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-person').length === 4, { timeout: 10000 });

  // a new one with a birth date; half a date is refused in the sheet
  await d.page.evaluate(() => A.compPersonNew());
  await $('dialog.sheet[open] select[data-birth="day"]');
  assert.deepEqual(await d.page.$$eval('dialog.sheet[open] select[data-birth="month"] option', n => n.slice(1, 4).map(o => o.textContent)), ['يناير', 'فبراير', 'مارس']);
  await setField('dialog.sheet[open]', 'الاسم', 'مريم عادل فهمي');
  await setField('dialog.sheet[open]', 'رقم الموبايل', '01123456789');
  await setBirth('dialog.sheet[open]', '15', '03', '');
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await d.page.waitForFunction(() => /اختار اليوم والشهر والسنة/.test(document.querySelector('dialog.sheet[open]')?.textContent || ''), { timeout: 10000 });
  const year = String(new Date(world.now()).getUTCFullYear() - 20);
  await setBirth('dialog.sheet[open]', '15', '03', year);
  await shot('06-birth-editor');
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await d.page.waitForFunction(() => /مريم عادل فهمي/.test(document.querySelector('.comp-person-head')?.textContent || ''), { timeout: 10000 });
  const mariam = gs.apiParticipants({ q: 'مريم' }).items[0];
  assert.equal(mariam.birthDate, `${year}-03-15`);
  assert.equal(typeof mariam.age, 'number');
  const page = await text('.view');
  assert.match(page, new RegExp(`تاريخ الميلاد[\\s\\S]*١٥ مارس ${year.replace(/\d/g, x => '٠١٢٣٤٥٦٧٨٩'[x])}`));
  assert.match(page, /بيخرج من السن/);
  assert.ok(await d.page.$('.view [data-eligibility]'));

  // the editor reads it back; clearing all three clears it
  await clickText('.view button', 'تعديل البيانات');
  await $('dialog.sheet[open] select[data-birth="year"]');
  assert.deepEqual(await d.page.$$eval('dialog.sheet[open] select[data-birth]', n => n.map(s => s.value)), ['15', '03', year]);
  await setBirth('dialog.sheet[open]', '', '', '');
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await d.page.waitForFunction(() => !document.querySelector('dialog.sheet').open, { timeout: 10000 });
  await idle();
  assert.equal(gs.apiParticipants({ q: 'مريم' }).items[0].birthDate, '');
  assert.equal(gs.apiParticipants({ q: 'مريم' }).items[0].eligibility, 'unknown');

  // the soon one's page: when he leaves the range
  await d.page.evaluate(id => A.compPerson(id), ctx.soon.id);
  await d.page.waitForFunction(() => /كيرلس/.test(document.querySelector('.comp-person-head')?.textContent || ''), { timeout: 10000 });
  assert.equal(await d.page.$eval('.view [data-eligibility]', n => n.dataset.eligibility), 'soon');
  assert.match(await text('.view'), /بيخرج من السن/);
  assert.deepEqual(d.problems, []);

});

test('«الإعدادات»: «الفئة العمرية لنظام النقاط» — read, said, saved, applied at once (codes and history stay)', async () => {

  await d.page.evaluate(() => A.go('comps', 'compsettings'));
  await $('.comp-age-rules [data-act="age-save"]');
  const values = await d.page.$$eval('.comp-age-grid input', n => n.map(i => i.value));
  assert.deepEqual(values, ['18', '30', '60']);
  assert.match(await text('.comp-age-said'), /من ١٨ لحد ٣٠ سنة/);
  assert.match(await text('.comp-age-rules'), /الأكواد والتاريخ والمشاركات القديمة مبتتغيرش، والنقاط اللي اتاخدت قبل كده بتفضل/);

  await setField('.comp-age-rules', 'أكبر سن', '35');
  assert.match(await text('.comp-age-said'), /لحد ٣٥ سنة/);
  await shot('07-age-rules');
  const code = gs.apiParticipantCode(ctx.old.id).code;
  await jsClick('[data-act="age-save"]');
  await d.page.waitForFunction(() => !A.dirty, { timeout: 10000 });
  await idle();
  assert.deepEqual(gs.apiAgeRules(), { min: 18, max: 35, warnDays: 60 });
  assert.equal(gs.apiParticipants({ eligibility: 'out' }).total, 0, 'the 33-year-old fits now');
  assert.equal(gs.apiParticipantCode(ctx.old.id).code, code, 'the code never changes');

  // a bad range lands under its field
  await setField('.comp-age-rules', 'أكبر سن', '10');
  await jsClick('[data-act="age-save"]');
  await d.page.waitForFunction(() => /أكبر سن لازم يكون أكبر من أقل سن/.test(document.querySelector('.view')?.textContent || ''), { timeout: 10000 });
  gs.apiAgeRulesSave({ min: 18, max: 30, warnDays: 60 });
  await d.page.evaluate(() => { A.dirty = false; });
  assert.deepEqual(d.problems, []);

});

test('names template «تاريخ الميلاد» (DD/MM/YYYY, explained); import: a new one with a date, an existing one\'s changed date offered', async () => {

  await d.page.evaluate(() => { A.compPeople.open = ''; return A.go('comps', 'people'); });
  await $('.comp-person');
  await clickText('.view button', 'تحميل نموذج الأسماء');
  await d.page.waitForFunction(() => A.comp.lastDownload && /الأسماء/.test(A.comp.lastDownload.filename));
  const template = await readXlsx(Uint8Array.from(await d.page.evaluate(() => Array.from(A.comp.lastDownload.bytes))));
  assert.deepEqual(template.sheets[0].rows[0], PEOPLE_HEADERS);
  assert.ok(PEOPLE_HEADERS.includes('تاريخ الميلاد'));
  assert.match(JSON.stringify(template.sheets[1].rows), /تاريخ الميلاد[^\]]*(يوم\/شهر\/سنة|DD\/MM\/YYYY)/);

  const youngDate = '01/02/2003';
  const rows = [['الاسم بالكامل', 'رقم الموبايل', 'المجموعة / الفصل', 'تاريخ الميلاد'],
    ['يوسف سمير نبيل', '01001112223', 'جامعة', '15/03/2004'],
    ['مينا عادل جرجس', '01012340001', 'جامعة', youngDate]];
  const path = `${SHOTS}names.xlsx`;
  writeFileSync(path, writeXlsx({ sheets: [{ name: PEOPLE_SHEET, rows, textColumns: [0, 1, 2, 3] }] }));
  await clickText('.view button', 'استيراد أسماء');
  await $('dialog.sheet[open] .import__file');
  await (await d.page.$('dialog.sheet[open] .import__file')).uploadFile(path);
  await d.page.waitForFunction(() => document.querySelector('dialog.sheet[open] .sheet__title')?.textContent === 'معاينة الأسماء', { timeout: 20000 });
  const line = n => d.page.$eval(`dialog.sheet[open] .import__row[data-line="${n}"]`, r => r.textContent);
  assert.match(await line(2), /مواليد ١٥ مارس ٢٠٠٤/);
  assert.match(await line(3), /تاريخ الميلاد: .* ← ١ فبراير ٢٠٠٣/);
  await d.page.$eval('dialog.sheet[open] .import__row[data-line="3"] .import__tick', n => { if (!n.checked) n.click(); });
  await shot('08-import-birth');
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await d.page.waitForFunction(() => document.querySelector('dialog.sheet[open] .sheet__title')?.textContent === 'الاستيراد خلص ✓', { timeout: 20000 });
  assert.equal(gs.apiParticipants({ q: 'يوسف سمير' }).items.find(p => p.name === 'يوسف سمير نبيل').birthDate, '2004-03-15');
  assert.equal(gs.apiParticipants({ q: 'مينا عادل' }).items[0].birthDate, '2003-02-01');
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
  assert.deepEqual(d.problems, []);

});


/* ---------------- phone width ---------------- */

test('360px: people (ages), the editor\'s birth selects, settings (age rules), the store — no sideways scroll', async () => {

  await d.page.setViewport(SMALL);
  try {
    await d.page.evaluate(() => { A.compPeople.open = ''; return A.go('comps', 'people'); });
    await $('.comp-ages [data-eligibility]');
    assert.ok(await overflow() <= 0, 'people');
    await shot('09-small-people');
    await d.page.evaluate(() => A.compPersonNew());
    await $('dialog.sheet[open] select[data-birth="day"]');
    const widths = await d.page.$$eval('dialog.sheet[open] select[data-birth]', n => n.map(s => { const r = s.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
    const sheet = await d.page.$eval('dialog.sheet[open]', n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right }; });
    assert.ok(widths.length === 3 && widths.every(r => r.right <= sheet.right + 1 && r.left >= sheet.left - 1), 'the selects fit');
    assert.ok(await overflow() <= 0, 'editor');
    await shot('10-small-birth');
    await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
    await d.page.evaluate(() => A.go('comps', 'compsettings'));
    await $('.comp-age-rules [data-act="age-save"]');
    assert.ok(await overflow() <= 0, 'settings');
    await shot('11-small-age');
    await d.page.evaluate(() => A.go('comps', 'shop'));
    await $('.comp-shop-schedule [data-preview]');
    assert.ok(await overflow() <= 0, 'shop');
  }
  finally {
    await d.page.setViewport(DESKTOP);
  }
  assert.deepEqual(d.problems, []);

});
