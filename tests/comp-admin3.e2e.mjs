// Points & Store v2 in the admin, in a real browser (docs/COMPETITIONS.md §18):
//  - «مواعيد المتجر»: mode, times, the participant's cancel, the state chip,
//    notify choices saved and read back, the automatic sending's status (not
//    authorized → how to switch it on), the scheduled sends (cancel one), the
//    rules said (points never reset, requests stay, «راجع وانشر»)
//  - a prize's price as a % of the season's maximum
//  - «المواسم»: the active season (maximum, expected), add / edit, close —
//    blocked by an open request (with its link), then done after it is
//    handled; the next season; «تحويل من موسم فات»
//  - the builder's «الموسم» selector and the overview chip
//  - 360px, no sideways scroll
// Against the real server once §18 is in this tree; until then the v2 api*
// replies come from tests/fakes/pts.mjs (same shapes as the contract).
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/comp-admin3.e2e.mjs

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';
import { installPtsFakes } from './fakes/pts.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4679;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN = 'menazakmena@gmail.com';
const SHOTS = `${ROOT}tools/.cache/comp-admin3/`;
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
let faked = false;
const ctx = {};
const claims = { email: ADMIN };

/* the .gs functions as the admin, plain results; a v2 one not in this tree yet comes from the fakes (apiFunctions_) */
const gs = new Proxy({}, { get: (_, name) => (...args) => { const g = world.as(ADMIN).gs; const api = /^api/.test(name) ? g.apiFunctions_()[name] : null; const fn = typeof api === "function" ? api : g[name]; return JSON.parse(JSON.stringify(fn(...args)) ?? null); } });
const pub = (fn, arg) => { const r = world.post({ fn, args: [arg] }); delete r.mime; return r; };

/* Cairo wall clock "YYYY-MM-DD HH:MM", minutes from the world's now */
function wallAt(minutes) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(world.now() + minutes * 60000)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
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
  faked = installPtsFakes(world, ADMIN);

  // registry + wallet + store on; one participant; a coded points competition he played; a prize; one open request
  gs.apiCompSettings({ registry: true, wallet: true, shop: true });
  ctx.mark = gs.apiParticipantSave({ name: 'مارك ميلاد عزيز', phone: '01012345678', group: 'ثانوي بنين' }).participant;
  ctx.comp = gs.apiCompCreate({ preset: 'points', title: 'مسابقة النقاط', slug: 'points-quiz', enabled: true }).comp.id;
  gs.apiCompQuestionSave(ctx.comp, { type: 'single', text: 'مين بنى الفلك؟', choices: [{ text: 'نوح', correct: true }, { text: 'موسى' }], points: 10 });
  gs.apiCompQuestionSave(ctx.comp, { type: 'truefalse', text: 'داود غلب جليات', correct: 'صح', points: 5 });
  const review = gs.apiReview();
  gs.apiPublish(review.revision);
  const ptoken = pub('compCode', { code: gs.apiParticipantCode(ctx.mark.id).code }).ptoken;
  const start = pub('compStart', { slug: 'points-quiz', clientKey: 'v2-points-key-00001', ptoken });
  const answers = {};
  for (const q of start.questions) answers[q.id] = q.type === 'single' ? q.choices.find(c => c.text === 'نوح').id : 't';
  pub('compSubmit', { token: start.attempt.token, clientKey: 'v2-points-key-00001', answers });
  ctx.item = gs.apiShopItemSave({ name: 'كوباية الأسرة', cost: 10 }).item;
  // the store must be open for a request (v2 default: auto, no bounds = open)
  ctx.request = pub('shopRedeem', { ptoken, itemId: ctx.item.id, requestKey: 'v2-req-000000000001' });
  assert.equal(ctx.request.ok, true, JSON.stringify(ctx.request));
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
const overflow = () => d.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const text = selector => d.page.$eval(selector, n => n.textContent);


/* ---------------- the store's schedule ---------------- */

test('«مواعيد المتجر»: state chip, mode and times, notify choices saved and read back, the participant\'s cancel', async () => {

  await d.page.evaluate(() => A.go('comps', 'shop'));
  await $('.comp-shop-schedule .comp-shop-state');
  assert.match(await text('.comp-shop-state'), /المتجر مفتوح/);
  assert.match(await text('.comp-shop-rules'), /قفل المتجر عمره ما بيصفّر النقاط[\s\S]*الطلبات/);
  assert.ok(await d.page.$('.comp-shop-rules button'), '«راجع وانشر» from here');

  const opens = wallAt(3 * 24 * 60);
  const closes = wallAt(10 * 24 * 60);
  await setDate('.comp-shop-schedule', 'بيفتح', opens);
  await setDate('.comp-shop-schedule', 'بيقفل', closes);
  await d.page.$eval('.comp-shop-schedule .check:not([data-notify]):not([data-preview]) input', n => n.click());   // allow cancel
  for (const key of ['open1d', 'openAt', 'close1h']) await d.page.$eval(`.comp-shop-schedule [data-notify="${key}"] input`, n => n.click());
  await shot('01-schedule-form');
  await jsClick('[data-act="schedule-save"]');
  await d.page.waitForFunction(() => /هيفتح/.test(document.querySelector('.comp-shop-state')?.textContent || ''), { timeout: 10000 });

  const saved = gs.apiShopSchedule();
  assert.equal(saved.mode, 'auto');
  assert.equal(saved.opensAt.replace('T', ' ').slice(0, 16), opens);
  assert.equal(saved.closesAt.replace('T', ' ').slice(0, 16), closes);
  assert.equal(saved.allowCancel, true);
  assert.deepEqual(saved.notify, { open1d: true, open1h: false, openAt: true, close24h: false, close1h: true });
  assert.equal(saved.state, 'scheduled');

  // read back after a reload of the screen
  await d.page.evaluate(() => A.render());
  await $('.comp-shop-schedule [data-notify="open1d"] input');
  const ticks = await d.page.$$eval('.comp-shop-schedule [data-notify] input', n => n.map(i => [i.closest('[data-notify]').dataset.notify, i.checked]));
  assert.deepEqual(Object.fromEntries(ticks), { open1d: true, open1h: false, openAt: true, close24h: false, close1h: true });
  assert.equal(await d.page.$eval('.comp-shop-schedule .check:not([data-notify]):not([data-preview]) input', n => n.checked), true);
  assert.deepEqual(d.problems, []);

});

test('automatic sending: not authorized → said, with how the owner switches it on; scheduled sends listed with their status; cancel one', async () => {

  await $('.comp-auto');
  assert.equal(await d.page.$eval('.comp-auto', n => n.dataset.auto), 'off');
  assert.match(await text('.comp-auto'), /مش متفعل — المالك لازم يفعّله مرة واحدة من Apps Script/);
  assert.match(await text('.comp-auto'), /enableAutoPush/);

  await $('.comp-sends [data-send]');
  const rows = await d.page.$$eval('.comp-sends [data-send]', n => n.map(r => ({ text: r.textContent, status: r.dataset.status })));
  assert.equal(rows.length, 3, JSON.stringify(rows));
  assert.ok(rows.every(r => r.status === 'pending' && /مستني/.test(r.text)));
  assert.ok(rows.some(r => /قبل فتح المتجر بيوم/.test(r.text)) && rows.some(r => /وقت فتح المتجر/.test(r.text)) && rows.some(r => /قبل قفل المتجر بساعة/.test(r.text)));
  await shot('02-schedule-sends');

  const first = await d.page.$eval('.comp-sends [data-send]', n => n.dataset.send);
  await jsClick(`.comp-sends [data-send="${first}"] [data-act="send-cancel"]`);
  await $('dialog.modal[open]');
  assert.match(await text('dialog.modal[open]'), /الإشعار نفسه بيفضل في الجرس/);
  await d.page.click('dialog.modal[open] .modal__actions .btn:first-child');
  await d.page.waitForFunction(id => document.querySelector(`.comp-sends [data-send="${id}"]`)?.dataset.status === 'cancelled', { timeout: 10000 }, first);
  assert.match(await text(`.comp-sends [data-send="${first}"]`), /اتلغى/);
  const entries = gs.apiPushSchedule();
  const list = Array.isArray(entries) ? entries : entries.entries;
  assert.equal(list.find(e => e.id === first).status, 'cancelled');
  assert.deepEqual(d.problems, []);

});

test('a prize\'s price as a % of the season\'s maximum (chip and the editor\'s pricing hint)', async () => {

  await $('.comp-shop-items .comp-pct');
  const max = gs.apiSeasons().seasons.find(s => s.status === 'active').maxTheoretical;
  const pct = Math.round(ctx.item.cost * 100 / max).toString().replace(/\d/g, x => '٠١٢٣٤٥٦٧٨٩'[x]);
  assert.match(await text('.comp-shop-items .comp-pct'), new RegExp(`^١٠ = ${pct}٪ من أقصى الموسم$`));
  await jsClick(`.comp-shop-items .item[data-id="${ctx.item.id}"] .icon-btn`);
  await d.page.waitForFunction(() => !document.querySelector('dialog.sheet[open] .comp-pricing')?.hidden, { timeout: 10000 });
  assert.match(await text('dialog.sheet[open] .comp-pricing'), /أقصى نقاط ممكنة في «.*»: [٠-٩]+ — يعني ١٠ = [٠-٩]+٪ منه/);
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });

});


/* ---------------- seasons ---------------- */

test('«المواسم»: the active season with its maximum and expected; the balances say it is that season; add and edit a planned one', async () => {

  await d.page.evaluate(() => A.go('comps', 'points'));
  await $('.comp-season--active');
  const active = gs.apiSeasons().seasons.find(s => s.status === 'active');
  assert.match(await text('.comp-season--active'), new RegExp(active.name));
  assert.match(await text('.comp-season--active .comp-season__max'), /أقصى نقاط ممكنة: [٠-٩]+ من [٠-٩]+ مسابقة/);
  await d.page.waitForFunction(() => !document.querySelector('.comp-season-said').hidden, { timeout: 10000 });
  assert.match(await text('.comp-season-said'), /الأرصدة هنا للموسم الشغال/);
  await shot('03-seasons');

  await jsClick('[data-act="season-new"]');
  await $('dialog.sheet[open] .field[data-label="اسم الموسم"]');
  await setField('dialog.sheet[open]', 'اسم الموسم', 'موسم الشتا');
  await setDate('dialog.sheet[open]', 'بيبدأ', wallAt(30 * 24 * 60));
  await d.page.$eval('dialog.sheet[open] .comp-number', n => { n.value = '3'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await d.page.waitForFunction(() => [...document.querySelectorAll('.comp-seasons [data-season]')].some(n => /موسم الشتا/.test(n.textContent)), { timeout: 10000 });
  const planned = gs.apiSeasons().seasons.find(s => s.name === 'موسم الشتا');
  assert.equal(planned.status, 'planned');
  assert.equal(Number(planned.notifyDays), 3);
  ctx.planned = planned.id;

  // edit it
  await jsClick(`.comp-seasons [data-season="${planned.id}"] [data-act="season-edit"]`);
  await $('dialog.sheet[open] .field[data-label="اسم الموسم"]');
  await setField('dialog.sheet[open]', 'اسم الموسم', 'موسم الشتا ٢٠٢٧');
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await d.page.waitForFunction(() => /موسم الشتا ٢٠٢٧/.test(document.querySelector('.comp-seasons').textContent), { timeout: 10000 });
  assert.deepEqual(d.problems, []);

});

test('builder: «الموسم» selector (wallet on) saved; the overview names the season', async () => {

  await d.page.evaluate(id => A.compOpen(id, 'result'), ctx.comp);
  await d.page.waitForFunction(() => { const f = document.querySelector('.comp-season-field'); return f && !f.hidden && f.querySelectorAll('option').length > 1; }, { timeout: 10000 });
  await idle();
  const options = await d.page.$$eval('.comp-season-field select option', n => n.map(o => [o.value, o.textContent]));
  assert.ok(options[0][1].startsWith('تلقائي'), 'automatic first');
  assert.ok(options.some(o => o[0] === ctx.planned), JSON.stringify(options));
  await d.page.select('.comp-season-field select', ctx.planned);
  await d.page.click('.comp-tab .comp-save .btn--primary');
  await d.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /اتحفظ/.test(t.textContent)), { timeout: 10000 });
  // stored on the competition (Competitions.seasonId)
  const sheet = world.compSpreadsheet.getSheetByName('Competitions').data;
  assert.equal(String(sheet.find(r => r[0] === ctx.comp)[sheet[0].indexOf('seasonId')]).replace(/^'/, ''), ctx.planned);
  // read back by the builder once apiComp carries it (see the report: the server's admin reply)
  const back = gs.apiComp(ctx.comp).comp;
  if ('seasonId' in back) {
    assert.equal(back.seasonId, ctx.planned);
    await d.page.evaluate(() => { A.comp.data = null; A.comp.tab = 'overview'; A.render(); });
    await d.page.waitForFunction(() => /الموسم: موسم الشتا ٢٠٢٧/.test(document.querySelector('.comp-head')?.textContent || ''), { timeout: 10000 });
  }
  else {
    await d.page.evaluate(() => { A.comp.tab = 'overview'; A.render(); });
    await d.page.waitForFunction(() => /الموسم: /.test(document.querySelector('.comp-head')?.textContent || ''), { timeout: 10000 });
  }
  // back to automatic (the competition's points stay in the active season for the close below)
  gs.apiCompSave(ctx.comp, { seasonId: '' });
  assert.deepEqual(d.problems, []);

});

test('close the season: blocked by an open request (with its link) → the request handled → next = the planned one → type the name → closed; nothing deleted', async () => {

  await d.page.evaluate(() => A.go('comps', 'points'));
  await $('[data-act="season-close"]');
  const active = gs.apiSeasons().seasons.find(s => s.status === 'active');
  await jsClick('[data-act="season-close"]');
  await $('dialog.sheet[open] .comp-season__blocked');
  assert.match(await text('dialog.sheet[open] .comp-season__blocked'), /لازم تخلّص الطلبات دي الأول/);
  assert.match(await text('dialog.sheet[open] .comp-season__totals'), /مارك ميلاد عزيز/);
  assert.equal(await d.page.$('dialog.sheet[open] [data-act="season-close-confirm"]'), null, 'no close while blocked');
  await shot('04-close-blocked');

  // the request's link opens it in the store
  await d.page.click('dialog.sheet[open] [data-act="open-request"]');
  await d.page.waitForFunction(id => document.querySelector(`.comp-req[data-id="${id}"]`), { timeout: 10000 }, ctx.request.redemption.id);
  await jsClick(`.comp-req[data-id="${ctx.request.redemption.id}"] [data-next="fulfilled"]`);
  await d.page.waitForFunction(id => !document.querySelector(`.comp-req[data-id="${id}"] [data-next]`), { timeout: 10000 }, ctx.request.redemption.id);

  await d.page.evaluate(() => A.go('comps', 'points'));
  await jsClick('[data-act="season-close"]');
  await $('dialog.sheet[open] [data-act="season-close-confirm"]');
  assert.equal(await d.page.$eval(`dialog.sheet[open] input[name="next-season"][value="${ctx.planned}"]`, n => n.checked), true, 'the planned one by default');
  assert.equal(await d.page.$eval('dialog.sheet[open] [data-act="season-close-confirm"]', n => n.disabled), true);
  await d.page.type('dialog.sheet[open] .field[data-label^="اكتب اسم الموسم"] input', 'اسم غلط');
  assert.equal(await d.page.$eval('dialog.sheet[open] [data-act="season-close-confirm"]', n => n.disabled), true);
  await d.page.$eval('dialog.sheet[open] .field[data-label^="اكتب اسم الموسم"] input', (n, v) => { n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); }, active.name);
  await shot('05-close-ready');
  await d.page.click('dialog.sheet[open] [data-act="season-close-confirm"]');
  await $('dialog.modal[open]');
  assert.match(await text('dialog.modal[open]'), new RegExp(`«${active.name}» اتقفل ✓[\\s\\S]*مفيش حاجة اتمسحت`));
  await d.page.click('dialog.modal[open] .modal__actions .btn');
  const after = gs.apiSeasons();
  assert.equal(after.seasons.find(s => s.id === active.id).status, 'closed');
  assert.equal(after.seasons.find(s => s.id === ctx.planned).status, 'active');
  await d.page.waitForFunction(() => /موسم الشتا ٢٠٢٧/.test(document.querySelector('.comp-season--active')?.textContent || ''), { timeout: 10000 });
  assert.match(await text('.comp-seasons'), /مواسم خلصت[\s\S]*الموسم الأول/);
  assert.deepEqual(d.problems, []);

});

test('«تحويل من موسم فات»: an explicit carry-over into the active season, with a reason', async () => {

  await d.page.evaluate(id => A.compWalletOpen(id), ctx.mark.id);
  await $('dialog.sheet[open] [data-kind="adjust-kind"]');
  await d.page.$eval('dialog.sheet[open] [data-kind="adjust-kind"] input[value="transfer"]', n => n.click());
  assert.match(await text('dialog.sheet[open] .comp-adjust'), /لازم السبب/);
  await d.page.$eval('dialog.sheet[open] .field[data-label="عدد النقاط"] input', n => { n.value = '5'; });
  await d.page.$eval('dialog.sheet[open] .field[data-label="السبب"] textarea, dialog.sheet[open] .field[data-label="السبب"] input', n => { n.value = 'رصيد الموسم الأول'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await d.page.click('dialog.sheet[open] [data-act="adjust"]');
  await d.page.waitForFunction(() => /تحويل من موسم فات/.test(document.querySelector('dialog.sheet[open] .comp-ledger')?.textContent || ''), { timeout: 10000 });
  assert.match(await text('dialog.sheet[open] .comp-ledger'), /\+٥[\s\S]*تحويل من موسم فات[\s\S]*رصيد الموسم الأول/);
  if (faked) assert.equal(world.ptsFakes.calls.find(c => c[0] === 'apiWalletAdjust')[5], 'transfer', 'sent as kind transfer');
  await shot('06-transfer');
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
  assert.deepEqual(d.problems, []);

});

test('360px: the store\'s schedule, seasons and the close sheet — no sideways scroll', async () => {

  await d.page.setViewport(SMALL);
  await sleep(300);
  for (const sub of ['shop', 'points']) {
    await d.page.evaluate(s => A.go('comps', s), sub);
    await sleep(1200);
    assert.ok(await overflow() <= 0, sub);
    await shot(`07-phone-${sub}`);
  }
  await jsClick('[data-act="season-close"]');
  await $('dialog.sheet[open] .comp-season__totals, dialog.sheet[open] .empty');
  assert.ok(await overflow() <= 0, 'close sheet');
  await shot('08-phone-close');
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
  await d.page.setViewport(DESKTOP);
  assert.deepEqual(d.problems, []);

});
