// «الآيات والقراءات اليومية» («خبزنا اليومي», docs/daily-bread/PLAN.md §3 W4) in the official /admin/, in a real browser:
// the panel against the fake Apps Script world, the Worker's bread routes MOCKED by request interception
// (tests/fakes/bread-worker.mjs: the W3 shapes, the Worker's own day checks from worker/src/bread/model.js).
//  - the section: its place in the rail («الشغل», after «الفعاليات والصفحات»), under «المزيد» on phones, the tabs
//  - a good file: the template (admin/xlsx.js), the file read on the device, the text from Van Dyck
//    (assets/bible/vd), the day's preview, the upload in parts (20 + 1), scheduled after the current program
//  - a file with errors: the rows by day and field, «التالي» locked; the Worker refusing a day → drawn on its row
//  - replace now: the typed confirmation, the current one ends, the new one is live
//  - «المحتوى خلص»: the alert, the mute, the bell; the 7 / 3 / 1 alert in the bell opens «البرامج»
//  - stats, reflections (and without the permission), settings
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/bread-admin.e2e.mjs
// Shots (W1 sizes, for the side-by-side compare): BREAD_SHOTS=1 → tools/.cache/bread-admin/

import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';
import { createBreadWorker, WORKER_URL } from './fakes/bread-worker.mjs';
import { readXlsx, writeXlsx } from '../admin/xlsx.js';
import { cairoDay, dayAdd } from '../worker/src/bread/model.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4746;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN = 'mina.servant@example.com';
const SHOTS = `${ROOT}tools/.cache/bread-admin/`;
const TMP = mkdtempSync(join(tmpdir(), 'bread-admin-'));
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const TODAY = cairoDay();

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 4000, render: 8000, beat: 900, beatFail: 2500 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const COLUMNS = ['رقم', 'العنوان', 'مرجع الآية', 'مرجع القراءة', 'التأمل', 'السؤال (اختياري)'];
const VD = code => JSON.parse(readFileSync(`${ROOT}assets/bible/vd/${code}.json`, 'utf8'));

let world;
let server;
let browser;
let fake;

function freshWorld() {
  world = createWorld({ owner: ADMIN, executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', `${SITE}/`);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.properties.set('ADMIN_EMAILS', ADMIN);
  world.properties.set('WORKER_SYNC_SECRET', 's'.repeat(48));
  world.properties.set('ADMIN_NAMES', JSON.stringify({ [ADMIN]: 'مينا' }));
  world.gs.SESSION_STALE_SECONDS = 0;
  world.as('');
}

/*
 * The Worker as W1 drew it (docs/daily-bread/w1/admin.js): «خبز الحياة» (30 days, day 5) live, «النور» (21) waiting,
 * two past programs with their numbers, today's numbers, 210 devices on 264 reminders, three reflections.
 * { left } puts the live one that many days from its end with nothing waiting; { empty } has none live.
 */
function freshWorker({ left = null, empty = false, next = true } = {}) {
  fake = createBreadWorker({ origin: LOCAL, today: TODAY, admin: ADMIN });
  const day = left === null ? 5 : 30 - left;
  fake.seed({ name: '«صلوات قصيرة» — أسبوع الصوم', days: 7, startsOn: dayAdd(TODAY, -80), daily: [{ day: dayAdd(TODAY, -79), opens: 690, reads: 502, reflections: 88 }] });
  fake.seed({ name: 'سلسلة «أمثال المسيح»', days: 21, startsOn: dayAdd(TODAY, -60), daily: [{ day: dayAdd(TODAY, -50), opens: 1840, reads: 1220, reflections: 312 }] });
  const series = [[60, 41], [72, 50], [58, 39], [80, 61], [91, 70], [77, 52], [69, 47], [96, 71], [88, 66], [101, 79], [93, 70], [118, 85], [126, 90], [142, 98]];
  const daily = series.map(([opens, reads], i) => ({ day: dayAdd(TODAY, i - 13), opens, reads, sent: i === 13 ? 241 : 200, reflections: i === 13 ? 12 : 9 }));
  const live = empty
    ? fake.seed({ name: 'سلسلة «خبز الحياة»', days: 30, startsOn: dayAdd(TODAY, -30), daily })
    : fake.seed({ name: 'سلسلة «خبز الحياة»', days: 30, startsOn: dayAdd(TODAY, 1 - day), daily, titles: ['أنا هو خبز الحياة', 'خبزنا كفافنا', 'الرب راعيّ', 'تعالوا إليّ', 'سراج لرجلي'] });
  if (next && left === null && !empty) fake.seed({ name: 'سلسلة «النور»', days: 21, startsOn: dayAdd(TODAY, 30 - day + 1) });
  for (let i = 0; i < 264; i++) fake.state.slots.push({ device_id: 'dev-' + (i % 210), minute: i % 5 ? 480 : 1275 });
  fake.state.accounts = 132;
  const at = (h, m, back = 0) => Date.parse(`${dayAdd(TODAY, -back)}T${String(h - 2).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  fake.state.reflections.push(
    { id: 'rfl-1', program_id: live.id, n: 1, day: TODAY, text: 'حاسس إني بدوّر على الشبع في الموبايل والسوشيال، وبعدها بحس بفراغ أكتر. محتاج أبدأ يومي بكلمة من ربنا قبل أي حاجة.', state: 'eligible', name: 'مارك سامي', created_ms: at(9, 38) },
    { id: 'rfl-2', program_id: live.id, n: 3, day: TODAY, text: 'السنة دي كانت صعبة في الدراسة، بس فعلًا في كل مرة كنت بحس إني لوحدي كان فيه حد بيبعته ربنا.', state: 'guest', name: 'كيرلس عادل', created_ms: at(8, 12), edited_ms: at(8, 20) },
    { id: 'rfl-3', program_id: live.id, n: 4, day: dayAdd(TODAY, -1), text: 'الآية دي ريحتني. كنت شايلة حاجات كتير لوحدي.', state: 'eligible', name: 'مريم جرجس', created_ms: at(22, 40, 1) }
  );
  return fake;
}

async function handle(request) {
  const url = request.url();
  if (fake && url.startsWith(WORKER_URL + '/v1/admin/bread/')) return fake.handle(request);
  // every other Worker call (the bookings switch, the heartbeat, …): not here, quietly
  if (url.startsWith(WORKER_URL)) {
    if (request.method() === 'OPTIONS') return { status: 204, headers: { 'access-control-allow-origin': LOCAL, 'access-control-allow-headers': 'authorization, content-type, idempotency-key, accept, x-edit-session', 'access-control-allow-methods': 'GET, POST' }, body: '' };
    return { status: 404, headers: { 'access-control-allow-origin': LOCAL, 'content-type': 'application/json' }, body: JSON.stringify({ ok: false, code: 'not_found', message: 'x' }) };
  }
  return null;
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

async function open({ viewport = DESKTOP, before = '' } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(`csp: ${message.text()}`);
  });
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  await page.setViewport(viewport);
  await interceptGoogle(page, { post: body => world.post(body) }, { handle });
  if (before) await page.evaluateOnNewDocument(before);
  await page.goto(`${LOCAL}/admin/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
  await page.waitForFunction(() => A.bread && A.bread.programs, { timeout: 8000 });
  if (process.env.BREAD_SHOTS) {
    // as tools/guide-shots.mjs: the boot intro gone, no motion mid-shot
    await sleep(2500);
    await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; } .intro, .p8intro { display: none !important; }' });
  }
  return { context, page, problems };
}

async function go(page, sub) {
  await page.evaluate(s => A.go('bread', s), sub);
  await page.waitForFunction(s => A.area === 'bread' && A.sub.bread === s && document.querySelector('#view .ba'), { timeout: 8000 }, sub);
  await sleep(250);
}

const viewText = page => page.$eval('#view', n => n.innerText);
const tabs = page => page.$$eval('#subtabs .tab', nodes => nodes.map(n => n.textContent.trim()));
const writes = path => fake.state.calls.filter(c => c.method === 'POST' && path.test(c.path));
const shot = async (page, name, { keepFocus = false } = {}) => {
  if (!process.env.BREAD_SHOTS) return;
  if (!keepFocus) await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  // the shot is the screen, not this test's last toast or the pointer resting on a card
  await page.evaluate(() => { const t = document.getElementById('toasts'); if (t) t.replaceChildren(); });
  await page.mouse.move(2, 2);
  await sleep(700);
  await page.screenshot({ path: `${SHOTS}${name}.png` });
};

/* a program file: rows = [[title, verseRef, readingRef, meditation, question]] */
function xlsxFile(name, rows) {
  const bytes = writeXlsx({ sheets: [{ name: 'البرنامج', rtl: true, header: true, rows: [COLUMNS, ...rows.map((r, i) => [i + 1, ...r])] }] });
  const path = join(TMP, name);
  writeFileSync(path, bytes);
  return path;
}

/* W1's own review rows (docs/daily-bread/w1/admin.js ROWS) + 9 more: «سلسلة «النور»», 21 days, two psalms (Agpeya notes) */
const W1_ROWS = [
  ['أنا هو خبز الحياة', 'يوحنا ٦: ٣٥', 'يوحنا ٦: ٣٢–٣٥', 1], ['خبزنا كفافنا', 'متى ٦: ١١', 'متى ٦: ٩–١٣', 1], ['الرب راعيّ', 'مزمور ٢٣: ١', 'مزمور ٢٣: ١–٤', 1],
  ['تعالوا إليّ', 'متى ١١: ٢٨', 'متى ١١: ٢٨–٣٠', 0], ['سراج لرجلي', 'مزمور ١١٩: ١٠٥', 'مزمور ١١٩: ١٠٥', 1], ['اثبتوا فيّ', 'يوحنا ١٥: ٥', 'يوحنا ١٥: ٤–٥', 1],
  ['اطلبوا أولًا', 'متى ٦: ٣٣', 'متى ٦: ٣٣–٣٤', 1], ['نور العالم', 'يوحنا ٨: ١٢', 'يوحنا ٨: ١٢–٢٠', 1], ['الكرمة الحقيقية', 'يوحنا ١٥: ١', 'يوحنا ١٥: ١–٨', 1],
  ['سلامي أعطيكم', 'يوحنا ١٤: ٢٧', 'يوحنا ١٤: ٢٥–٢٧', 1], ['الابن الضال', 'لوقا ١٥: ٢٠', 'لوقا ١٥: ١١–٢٤', 1], ['الراعي الصالح', 'يوحنا ١٠: ١١', 'يوحنا ١٠: ١١–١٦', 1],
  ['المحبة لا تسقط', '1كو 13: 8', 'كورنثوس الأولى 13: 4-8', 1], ['ابن الإنسان', 'مرقس ١٠: ٤٥', 'مرقس ١٠: ٤٢–٤٥', 0], ['السامري الصالح', 'لوقا ١٠: ٣٣', 'لوقا ١٠: ٢٥–٣٧', 1],
  ['زكا', 'لو 19: 10', 'لوقا 19: 1-10', 1], ['لا تضطرب قلوبكم', 'يوحنا ١٤: ١', 'يوحنا ١٤: ١–٦', 1], ['اذهبوا وتلمذوا', 'متى ٢٨: ١٩', 'متى ٢٨: ١٦–٢٠', 0],
  ['الإيمان', 'عبرانيين ١١: ١', 'العبرانيين ١١: ١–٦', 1], ['افرحوا', 'فيلبي ٤: ٤', 'فيلبي ٤: ٤–٧', 1], ['نور وملح', 'متى ٥: ١٤', 'متى ٥: ١٣–١٦', 1]
];
const GOOD = W1_ROWS.map(([title, verse, reading, q], i) => [title, verse, reading, 'تأمل اليوم ' + (i + 1) + ': كلمة قصيرة من خدام الأسرة.', q ? 'سؤال اليوم ' + (i + 1) + '؟' : '']);
/* the same file with W1's two red rows (day 9: a reading past John 6's end; day 11: no title) */
const WITH_ERRORS = GOOD.map((r, i) => (i === 8 ? [r[0], r[1], 'يوحنا ٦: ٧٥–٧٨', r[3], r[4]] : i === 10 ? ['', r[1], r[2], r[3], r[4]] : r));

async function uploadFile(page, path) {
  await go(page, 'breadnew');
  await page.evaluate(() => { A.bread.wiz.step = 2; A.render(); });
  const input = await page.waitForSelector('input[type=file][data-act="bread-file"]');
  await input.uploadFile(path);
  await page.waitForFunction(() => A.bread.wiz.step === 3 && document.querySelector('.ba-table'), { timeout: 15000 });
  await sleep(300);
}

async function setName(page, name) {
  await page.evaluate(n => { A.bread.wiz.name = n; }, name);
}


/* ---------------- the section ---------------- */

test('the section: «الشغل» after «الفعاليات والصفحات», five tabs, the live program, the next one, the past ones', async () => {
  freshWorker();
  const d = await open();
  const rail = await d.page.$$eval('#rail-nav .navlink', nodes => nodes.map(n => n.dataset.area));
  assert.equal(rail[rail.indexOf('pages') + 1], 'bread', rail.join(','));
  await go(d.page, 'breadprograms');
  assert.deepEqual(await tabs(d.page), ['البرامج', 'برنامج جديد', 'الإحصائيات', 'التأملات', 'الإعدادات']);
  assert.equal(await d.page.$eval('#page-title', n => n.textContent), 'الآيات والقراءات اليومية');
  assert.equal(await d.page.$eval('#crumb', n => n.textContent), 'خبزنا اليومي');
  const text = await viewText(d.page);
  for (const want of ['سلسلة «خبز الحياة»', 'شغال', 'من ٣٠ يوم', 'فاضل ٢٥ يوم', '١٤٢', '٩٨', '١٢', '٢١٠', 'سلسلة «النور»', 'رفعه مينا', 'سلسلة «أمثال المسيح»', '١٬٨٤٠', 'إزاي بيشتغل']) assert.ok(text.includes(want), want);
  assert.equal(await d.page.$$eval('.ba-track i', n => n.length), 30);
  assert.equal(await d.page.$('.ba-alert'), null, 'nothing to warn about: the next one is ready');
  // «المواضيع»: the days' titles and references
  await d.page.click('.ba-hero .p8-card__acts .btn');
  await d.page.waitForFunction(() => document.querySelectorAll('#sheet[open] .ba-table tbody tr').length === 30, { timeout: 8000 });
  assert.match(await d.page.$eval('#sheet', n => n.innerText), /أنا هو خبز الحياة/);
  await d.page.evaluate(() => A.closeSheet());
  await shot(d.page, '20-programs-d');
  assert.deepEqual(d.problems, []);
  await d.context.close();

  // phones: under «المزيد» (W1 20-programs-m)
  const m = await open({ viewport: PHONE });
  assert.ok(!(await m.page.$$eval('#dock .dockbtn', n => n.map(x => x.dataset.area))).includes('bread'));
  await go(m.page, 'breadprograms');
  assert.equal(await m.page.$eval('#dock .dockbtn--more', n => n.getAttribute('aria-current')), 'page');
  await shot(m.page, '20-programs-m');
  assert.deepEqual(m.problems, []);
  await m.context.close();
});


/* ---------------- a good file → after the current one ---------------- */

test('a good file: the template, the file read here with the Van Dyck text, the preview, the upload in parts, scheduled after the current one', async () => {
  freshWorker({ next: false });
  const d = await open();
  await go(d.page, 'breadnew');
  assert.match(await viewText(d.page), /النموذج[\s\S]*قبل ما تملاه/);
  await shot(d.page, '21-new-1-d');
  // the template: a real workbook with the right columns
  await d.page.click('[data-act="bread-template"]');
  await d.page.waitForFunction(() => A.bread.lastTemplate, { timeout: 8000 });
  const template = await d.page.evaluate(() => Array.from(A.bread.lastTemplate.bytes));
  const book = await readXlsx(new Uint8Array(template));
  assert.deepEqual(book.sheets[0].rows[0], COLUMNS);
  assert.equal(book.sheets[0].rows.length, 4);
  await d.page.click('[data-act="bread-next"]');
  await d.page.waitForSelector('.ba-drop');
  await d.page.type('[data-act="bread-name"]', 'سلسلة «النور»');
  if (process.env.BREAD_SHOTS) {
    // W1 21-new-2 shows a file half read («١٨ من ٢١»): the same drawing, held at that moment for the shot
    await d.page.evaluate(() => { Object.assign(A.bread.wiz, { file: 'khobzna-noor.xlsx', reading: { done: 18, total: 21 } }); A.render(); });
    await shot(d.page, '21-new-2-d');
    await d.page.evaluate(() => { Object.assign(A.bread.wiz, { file: '', reading: null }); A.render(); });
  }

  const input = await d.page.$('input[type=file][data-act="bread-file"]');
  await input.uploadFile(xlsxFile('noor.xlsx', GOOD));
  await d.page.waitForFunction(() => A.bread.wiz.step === 3 && document.querySelector('.ba-table'), { timeout: 15000 });
  const sum = await d.page.$eval('.ba-sum', n => n.innerText);
  assert.match(sum, /٢١ يوم/);
  assert.doesNotMatch(sum, /لازم يتصلّحوا/);
  assert.match(sum, /ملاحظة/, 'the psalms (Agpeya number)');
  assert.equal(await d.page.$eval('[data-act="bread-to-activate"]', n => n.disabled), false);
  // the psalm day: the Agpeya note, and the preview draws it from Van Dyck
  assert.match(await viewText(d.page), /ترقيم فاندايك: ده مزمور ٢٢ في الأجبية/);
  await d.page.click('.ba-table tr[data-n="1"]');
  const frame = await (await d.page.waitForSelector('.ba-phone iframe')).contentFrame();
  await frame.waitForFunction(() => document.documentElement.dataset.ready === '1' && document.querySelector('.br-title'), { timeout: 8000 });
  await frame.waitForFunction(() => document.querySelector('.br-title').textContent === 'أنا هو خبز الحياة', { timeout: 8000 });
  const jhn = VD('JHN');
  const pv = await frame.evaluate(() => ({ title: document.querySelector('.br-title').textContent, verse: document.querySelector('.br-verse').textContent, reading: document.querySelector('.br-reading').textContent, ref: document.querySelector('.br-ref').textContent }));
  assert.equal(pv.ref, 'يوحنا ٦: ٣٥');
  assert.ok(pv.verse.includes(jhn.chapters[5][34]), 'the verse is Van Dyck\'s own');
  assert.ok(pv.reading.includes(jhn.chapters[5][31]) && pv.reading.includes(jhn.chapters[5][34]));
  await shot(d.page, '21-new-3-ok-d');

  // upload: the draft, then the days in parts (20 + 1)
  await d.page.click('[data-act="bread-to-activate"]');
  await d.page.waitForFunction(() => A.bread.wiz.step === 4, { timeout: 15000 });
  const create = writes(/^\/v1\/admin\/bread\/programs$/);
  assert.deepEqual(create.map(c => c.body), [{ name: 'سلسلة «النور»', days: 21 }]);
  const parts = writes(/\/topics$/).map(c => c.body.topics.length);
  assert.deepEqual(parts, [20, 1]);
  const sent = writes(/\/topics$/)[0].body.topics;
  assert.equal(sent[0].verse, jhn.chapters[5][34]);
  assert.deepEqual(sent[0].reading[0].verses.map(v => v[0]), [32, 33, 34, 35]);
  assert.equal(sent[2].verseNote, 'مزمور ٢٢ في الأجبية');
  assert.equal(sent[1].question, 'سؤال اليوم 2؟');
  assert.equal(sent[3].question, undefined, 'no question → none sent');
  assert.match(await viewText(d.page), /بعد البرنامج الحالي[\s\S]*استبدال دلوقتي/);
  await shot(d.page, '21-new-4-d');
  await d.page.click('[data-act="bread-activate"]');
  await d.page.waitForFunction(() => A.sub.bread === 'breadprograms' && document.querySelector('.ba-next'), { timeout: 8000 });
  const act = writes(/\/activate$/);
  assert.deepEqual(act.map(c => c.body), [{ mode: 'after' }]);
  const text = await viewText(d.page);
  assert.ok(text.includes('سلسلة «النور»') && text.includes('بيبدأ لوحده لما الحالي يخلص'), text);
  assert.deepEqual(d.problems, []);
  await d.context.close();
});


/* ---------------- a file with errors ---------------- */

test('a file with errors: by day and field, «التالي» locked; a day the Worker refuses is drawn on its row', async () => {
  freshWorker();
  const d = await open();
  await uploadFile(d.page, xlsxFile('errors.xlsx', WITH_ERRORS));
  await setName(d.page, 'سلسلة «النور»');
  const sum = await d.page.$eval('.ba-sum', n => n.innerText);
  for (const want of [/٢١ يوم/, /١٧ سليم/, /٢ ملاحظة/, /٢ لازم يتصلّحوا/]) assert.match(sum, want);
  assert.equal(await d.page.$eval('[data-act="bread-to-activate"]', n => n.disabled), true);
  const why = await d.page.$$eval('.ba-table tr.is-err', rows => rows.map(r => ({ n: r.dataset.n, fields: Array.from(r.querySelectorAll('.ba-why'), w => w.dataset.field), text: r.innerText })));
  assert.deepEqual(why.map(w => w.n), ['9', '11']);
  assert.deepEqual(why[0].fields, ['readingRef']);
  assert.match(why[0].text, /يوحنا ٦ فيه ٧١ عدد بس، فـ«٧٥–٧٨» مش موجودين\. صلّح المرجع في الملف\./);
  assert.deepEqual(why[1].fields, ['title']);
  assert.match(why[1].text, /العنوان فاضي\. كل يوم محتاج عنوان قصير\./);
  assert.ok(await d.page.$('.ba-table tr[data-n="9"] .ba-ref--bad'), 'the bad reference is marked');
  assert.match(await viewText(d.page), /صلّح الصفين الحمر في الملف وارفعه تاني[\s\S]*… و٩ أيام كمان/);
  assert.equal(await d.page.evaluate(() => A.bread.wiz.day), 3, 'the preview opens on the first day with a note (W1)');
  await shot(d.page, '21-new-3-d');
  // every field by its name: a chapter past the book's end, an empty meditation
  await uploadFile(d.page, xlsxFile('errors2.xlsx', [['الراعي', 'يوحنا 30: 1', 'يوحنا ١٠: ١١–١٦', '', '']]));
  const one = await d.page.$eval('.ba-table tr.is-err', r => ({ fields: Array.from(r.querySelectorAll('.ba-why'), w => w.dataset.field).sort(), text: r.innerText }));
  assert.deepEqual(one.fields, ['meditation', 'verseRef']);
  assert.match(one.text, /مرجع الآية: يوحنا فيه ٢١ أصحاح بس/);
  assert.equal(writes(/bread\/programs/).length, 0, 'nothing reaches the Worker');

  // a clean file the Worker still refuses (day 2): stored nothing, drawn on row 2 by its field
  fake.state.refuse = t => t.n === 2;
  await uploadFile(d.page, xlsxFile('refused.xlsx', GOOD.slice(0, 5)));
  await setName(d.page, 'سلسلة «النور»');
  await d.page.click('[data-act="bread-to-activate"]');
  await d.page.waitForSelector('.ba-table tr.is-err[data-n="2"] .ba-why[data-field="meditation"]', { timeout: 8000 });
  assert.match(await d.page.$eval('.ba-table tr[data-n="2"]', n => n.innerText), /السيرفر: التأمل فيه كلام مش مقبول/);
  assert.equal(await d.page.evaluate(() => A.bread.wiz.step), 3);
  assert.equal(writes(/\/delete$/).length, 1, 'the half draft is dropped');
  assert.equal(fake.state.programs.filter(p => p.status === 'draft').length, 0);
  fake.state.refuse = null;
  assert.deepEqual(d.problems, []);
  await d.context.close();
});


/* ---------------- replace now ---------------- */

test('replace now: a typed «استبدال», the current program stops, the new one is live today', async () => {
  // a program already waiting: only «استبدال دلوقتي» is open
  freshWorker();
  const w = await open();
  await uploadFile(w.page, xlsxFile('wait.xlsx', GOOD.slice(0, 7)));
  await setName(w.page, 'أسبوع «الصلاة»');
  await w.page.click('[data-act="bread-to-activate"]');
  await w.page.waitForFunction(() => A.bread.wiz.step === 4, { timeout: 15000 });
  assert.equal(await w.page.$eval('input[name="bread-when"][value="after"]', n => n.disabled), true);
  assert.equal(await w.page.$eval('input[name="bread-when"][value="now"]', n => n.checked), true);
  assert.match(await viewText(w.page), /في برنامج مستني بعد الحالي: سلسلة «النور»/);
  assert.deepEqual(w.problems, []);
  await w.context.close();

  // nothing waiting (W1 21-new-4-now): «استبدال دلوقتي» chosen by hand, the typed confirmation
  freshWorker({ next: false });
  const d = await open();
  await uploadFile(d.page, xlsxFile('now.xlsx', GOOD.slice(0, 7)));
  await setName(d.page, 'أسبوع «الصلاة»');
  await d.page.click('[data-act="bread-to-activate"]');
  await d.page.waitForFunction(() => A.bread.wiz.step === 4, { timeout: 15000 });
  assert.equal(await d.page.$eval('input[name="bread-when"][value="after"]', n => n.checked), true, 'after the current one is the suggestion');
  await d.page.click('.ba-choice--danger');
  await d.page.waitForFunction(() => document.querySelector('input[name="bread-when"][value="now"]').checked && document.querySelector('[data-act="bread-activate"]').classList.contains('btn--danger'));
  await d.page.click('[data-act="bread-activate"]');
  await d.page.waitForSelector('dialog.modal[open] .modal__typed');
  const ok = await d.page.$('dialog.modal[open] .modal__actions .btn--danger');
  assert.deepEqual(await d.page.$$eval('dialog.modal[open] .modal__actions button', n => n.map(b => b.textContent)), ['إلغاء', 'استبدل'], 'W1: «إلغاء» first');
  assert.equal(await ok.evaluate(n => n.disabled), true, 'locked until the word');
  await d.page.type('dialog.modal[open] .modal__typed', 'استبد');
  await shot(d.page, '21-new-4-now-d', { keepFocus: true });
  await d.page.type('dialog.modal[open] .modal__typed', 'ال');
  assert.equal(await ok.evaluate(n => n.disabled), false);
  await ok.click();
  await d.page.waitForFunction(() => A.sub.bread === 'breadprograms' && /أسبوع «الصلاة»/.test(document.querySelector('.ba-name') ? document.querySelector('.ba-name').textContent : ''), { timeout: 8000 });
  assert.deepEqual(writes(/\/activate$/).map(c => c.body), [{ mode: 'now', confirm: true }]);
  const old = fake.state.programs.find(p => p.name === 'سلسلة «خبز الحياة»');
  assert.deepEqual([old.status, old.ends_on], ['stopped', dayAdd(TODAY, -1)]);
  assert.match(await viewText(d.page), /اليوم|١\s*من ٧ يوم/);
  assert.deepEqual(d.problems, []);
  await d.context.close();
});


/* ---------------- alerts: 7 / 3 / 1, «المحتوى خلص», mute, the bell ---------------- */

test('alerts: «فاضل ٣ أيام» in the tab and the bell (→ «البرامج»); «المحتوى خلص» and its mute', async () => {
  for (const left of [7, 3, 1]) {
    freshWorker({ left });
    const d = await open();
    await go(d.page, 'breadprograms');
    const al = await d.page.$eval('.ba-alert', n => ({ text: n.innerText, on: n.querySelector('.ba-steps-left .is-on').textContent, danger: n.classList.contains('ba-alert--danger') }));
    assert.equal(al.on, String(left).replace(/\d/, c => '٠١٢٣٤٥٦٧٨٩'[c]));
    assert.equal(al.danger, left === 1);
    assert.match(al.text, left === 1 ? /بكره آخر يوم في سلسلة «خبز الحياة»/ : /فاضل [٣٧] أيام على نهاية/);
    if (left === 7) await shot(d.page, '20-ending7-d');
    if (left === 1) await shot(d.page, '20-ending1-d');
    if (left === 3) {
      await shot(d.page, '20-ending3-d');
      // the bell: the program's words and today's reflections; a tap opens «البرامج»
      await d.page.evaluate(() => A.go('home'));
      await d.page.waitForFunction(() => A.area === 'home');
      await d.page.click('#bell-open');
      await d.page.waitForSelector('.menu--bell');
      const items = await d.page.$$eval('.menu--bell .menu__item', n => n.map(x => x.innerText));
      assert.ok(items.some(t => /سلسلة «خبز الحياة» فاضله ٣ أيام/.test(t) && /ومفيش برنامج جاي/.test(t)), items.join(' | '));
      assert.ok(items.some(t => /١٢ تأمل جديد النهارده/.test(t)), items.join(' | '));
      await d.page.evaluate(() => A.go('bread', 'breadprograms'));
      await d.page.waitForFunction(() => A.area === 'bread');
      await d.page.click('#bell-open');
      await d.page.waitForSelector('.menu--bell');
      await shot(d.page, '25-bell-d');
      await d.page.evaluate(() => { const m = document.querySelector('.menu--bell'); if (m) m.hidePopover(); A.go('home'); });
      await d.page.waitForFunction(() => A.area === 'home');
      await d.page.click('#bell-open');
      await d.page.waitForSelector('.menu--bell');
      await d.page.evaluate(() => Array.from(document.querySelectorAll('.menu--bell .menu__item')).find(n => /فاضله/.test(n.textContent)).click());
      await d.page.waitForFunction(() => A.area === 'bread' && A.sub.bread === 'breadprograms', { timeout: 8000 });
      // the Worker's push link
      await d.page.evaluate(() => A.go('home'));
      assert.equal(await d.page.evaluate(() => A.openLink('#open/bread').then(() => A.area + '/' + A.sub.bread)), 'bread/breadprograms');
    }
    assert.deepEqual(d.problems, []);
    await d.context.close();
  }

  // nothing live: «المحتوى خلص» → mute → gone from the tab and the bell
  freshWorker({ empty: true });
  const e = await open();
  await go(e.page, 'breadprograms');
  assert.match(await e.page.$eval('.ba-alert', n => n.innerText), /المحتوى خلص: مفيش برنامج شغال دلوقتي[\s\S]*سلسلة «خبز الحياة» خلص امبارح/);
  assert.equal(await e.page.evaluate(() => !!A.AREAS.find(a => a.key === 'bread').subs[0].wait), true);
  await shot(e.page, '20-empty-d');
  await e.page.evaluate(() => Array.from(document.querySelectorAll('.ba-alert .btn')).find(b => /كتم/.test(b.textContent)).click());
  await e.page.waitForFunction(() => !document.querySelector('.ba-alert'), { timeout: 8000 });
  assert.deepEqual(writes(/bread\/settings$/).map(c => c.body), [{ emptyMuted: true }]);
  assert.equal(await e.page.$eval('.ba .switch input', n => n.checked), true);
  assert.match(await viewText(e.page), /التنبيه مكتوم لحد ما يترفع برنامج جديد/);
  assert.equal(await e.page.evaluate(() => A.AREAS.find(a => a.key === 'bread').subs[0].wait), null, 'not in the bell either');
  await shot(e.page, '20-muted-d');
  // the switch brings it back
  await e.page.click('.ba .switch');
  await e.page.waitForSelector('.ba-alert', { timeout: 8000 });
  assert.deepEqual(writes(/bread\/settings$/).map(c => c.body), [{ emptyMuted: true }, { emptyMuted: false }]);
  assert.deepEqual(e.problems, []);
  await e.context.close();
});


/* ---------------- stats, reflections, settings ---------------- */

test('stats (aggregate), reflections (logged by the Worker; without the permission: the lock), settings saved', async () => {
  freshWorker();
  const d = await open();
  const statsBefore = fake.state.calls.filter(c => c.path === '/v1/admin/bread/stats').length;
  await go(d.page, 'breadstats');
  await sleep(1500);
  const statsAsked = fake.state.calls.filter(c => c.path === '/v1/admin/bread/stats').length - statsBefore;
  assert.ok(statsAsked >= 1 && statsAsked <= 2, 'the tab reads the numbers once a visit, not on every redraw: ' + statsAsked);
  const s = await viewText(d.page);
  for (const want of ['فتحوا النهارده', '١٤٢', '+١٦ عن امبارح', '٦٩٪ من اللي فتحوا', '٢١٠', 'على ٢٦٤ ميعاد', 'آخر ١٤ يوم', 'أكتر ميعاد', '٨:٠٠ ص', '١٣٢']) assert.ok(s.includes(want), want);
  assert.equal(await d.page.$$eval('.ba-chart__day', n => n.length), 14);
  await shot(d.page, '22-stats-d');

  await go(d.page, 'breadrefl');
  await d.page.waitForSelector('.ba-refl-item');
  assert.equal(await d.page.$$eval('.ba-refl-item', n => n.length), 3);
  const r = await viewText(d.page);
  assert.ok(r.includes('مارك سامي') && r.includes('ضيف') && r.includes('اتعدّل') && r.includes('امبارح') && r.includes('٩:٣٨ ص'), r);
  assert.equal(fake.state.reflectionReads, 1, 'one read (one activity row) for the visit');
  await shot(d.page, '23-reflections-d');
  await d.page.evaluate(() => Array.from(document.querySelectorAll('.filter-chip')).find(b => b.textContent === 'النهارده').click());
  await d.page.waitForFunction(() => document.querySelectorAll('.ba-refl-item').length === 2);
  await d.page.evaluate(() => Array.from(document.querySelectorAll('.filter-chip')).find(b => b.textContent === 'بسؤال').click());
  await d.page.waitForFunction(() => document.querySelectorAll('.ba-refl-item').length === 2, { timeout: 4000 });
  assert.equal(fake.state.reflectionReads, 1, 'filtering reads nothing again');

  await go(d.page, 'breadsettings');
  assert.match(await viewText(d.page), /الميعاد الافتراضي[\s\S]*أقصى عدد مواعيد[\s\S]*نص الإشعار[\s\S]*تنبيهات الأدمن[\s\S]*مين يشوف التأملات[\s\S]*مقفول/);
  await shot(d.page, '24-settings-d');
  const time = await d.page.$('[data-act="bread-time"]');
  await time.click({ clickCount: 3 });
  await time.type('٩:٣٠ م');
  await time.evaluate(n => n.blur());
  await d.page.waitForFunction(() => A.bread.programs.settings.defaultTime === '21:30', { timeout: 8000 });
  await d.page.evaluate(() => Array.from(document.querySelectorAll('.seg__opt')).find(o => o.textContent === '٢').click());
  await d.page.waitForFunction(() => A.bread.programs.settings.maxSlots === 2, { timeout: 8000 });
  assert.deepEqual(writes(/bread\/settings$/).map(c => c.body), [{ defaultTime: '21:30' }, { maxSlots: 2 }]);
  assert.deepEqual(d.problems, []);
  await d.context.close();

  // the reflections are the Primary Admin's (decision 10): the Worker refuses → the lock card, nothing shown
  freshWorker();
  fake.state.perms.reflections = false;
  const n = await open();
  await go(n.page, 'breadrefl');
  await n.page.waitForFunction(() => /محتاجة صلاحية «تأملات خبزنا اليومي»/.test(document.getElementById('view').innerText), { timeout: 8000 });
  assert.equal(await n.page.$('.ba-refl-item'), null);
  await shot(n.page, '23-noperm-d');
  assert.deepEqual(n.problems, []);
  await n.context.close();
});


/* ---------------- phones (W1 *-m shots) ---------------- */

test('phones: every screen draws in 390 px with no sideways scroll', async () => {
  const sideways = async (page, what) => {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(wide <= 1, what + ' scrolls sideways by ' + wide);
  };
  // the programs tab warning (W1 20-ending3-m), and the bell over it (25-bell-m); nothing live (20-empty-m)
  for (const [opts, name] of [[{ left: 3 }, '20-ending3-m'], [{ empty: true }, '20-empty-m']]) {
    freshWorker(opts);
    const p = await open({ viewport: PHONE });
    await go(p.page, 'breadprograms');
    await sideways(p.page, name);
    await shot(p.page, name);
    if (opts.left) {
      await p.page.click('#bell-open');
      await p.page.waitForSelector('.menu--bell');
      await shot(p.page, '25-bell-m');
    }
    assert.deepEqual(p.problems, []);
    await p.context.close();
  }

  freshWorker({ next: false });
  const m = await open({ viewport: PHONE });
  for (const [sub, name] of [['breadstats', '22-stats-m'], ['breadrefl', '23-reflections-m'], ['breadsettings', '24-settings-m'], ['breadnew', '21-new-1-m']]) {
    await go(m.page, sub);
    if (sub === 'breadrefl') await m.page.waitForSelector('.ba-refl-item');
    await sideways(m.page, sub);
    await shot(m.page, name);
  }
  await uploadFile(m.page, xlsxFile('m.xlsx', WITH_ERRORS));
  await m.page.evaluate(() => window.scrollTo(0, 0));
  await sideways(m.page, 'the review');
  await shot(m.page, '21-new-3-m');
  await uploadFile(m.page, xlsxFile('m2.xlsx', GOOD));
  await setName(m.page, 'سلسلة «النور»');
  await m.page.click('[data-act="bread-to-activate"]');
  await m.page.waitForFunction(() => A.bread.wiz.step === 4, { timeout: 15000 });
  await m.page.evaluate(() => window.scrollTo(0, 0));
  await sideways(m.page, 'activation');
  await shot(m.page, '21-new-4-m');
  await m.page.click('.ba-choice--danger');
  await m.page.click('[data-act="bread-activate"]');
  await m.page.waitForSelector('dialog.modal[open] .modal__typed');
  await m.page.type('dialog.modal[open] .modal__typed', 'استبد');
  await shot(m.page, '21-new-4-now-m', { keepFocus: true });
  await m.page.evaluate(() => document.querySelector('dialog.modal[open] .modal__actions button').click());
  await m.page.waitForFunction(() => !document.querySelector('dialog.modal[open]'));
  assert.equal(writes(/\/activate$/).length, 0, '«إلغاء» activates nothing');
  assert.deepEqual(m.problems, []);
  await m.context.close();
});

// ---------- W7: St-Takla's month (made-up text in St-Takla's file shape; no text of theirs in the repo) ----------

const monthOf = (day, add) => { const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1 + add, 1)); return d.toISOString().slice(0, 7); };
const lastDay = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
function taklaFile(month) {
  const opt = (n, k) => ({ title: `رسالة ${n}-${k}`, verseRef: 'يوحنا ٣: ١٦', readingRef: 'يوحنا ٣: ١٤-١٨', meditation: `كلمة تجربة لليوم ${n} [رابط](https://st-takla.org/x-${n}.html).`, sourceUrl: `https://st-takla.org/p-${n}-${k}.html`, sourceRefs: 'كتاب «تجربة»' });
  const days = Array.from({ length: lastDay(month) }, (_, i) => ({ n: i + 1, pick: 0, options: [opt(i + 1, 1), opt(i + 1, 2), opt(i + 1, 3)] }));
  const feasts = [1, 4, lastDay(month)].map(d => ({ date: `${month}-${String(d).padStart(2, '0')}`, on: true, name: 'قديس ' + d, title: 'تذكار ' + d, word: 'كلمة عنه.', sourceUrl: 'https://st-takla.org/k.html', img: null }));
  return { schema: 2, month, made: 'x', days, feasts };
}

test('St-Takla: next month starts on its 1st by itself; the default question; «غيّر الموضوع»; back; the month\'s feasts', async () => {
  freshWorker({ next: false });
  const next = monthOf(TODAY, 1);
  fake.state.suggest = { [next]: taklaFile(next) };
  const d = await open();
  await go(d.page, 'breadnew');
  await d.page.click('[data-act="bread-takla"]');
  await d.page.waitForSelector('.ba-table', { timeout: 15000 });
  assert.equal(await d.page.evaluate(() => A.bread.wiz.rows.length), lastDay(next));
  assert.equal(await d.page.evaluate(() => A.bread.wiz.rows[0].question), 'إيه أكتر حاجة لمستك في كلام النهارده؟', 'a day with no question gets the default one');
  // back to the month choice, and again
  await d.page.click('[data-act="bread-takla-back"]');
  await d.page.waitForSelector('[data-act="bread-takla"]');
  await d.page.click('[data-act="bread-takla"]');
  await d.page.waitForSelector('[data-act="bread-swap"]', { timeout: 15000 });
  await d.page.click('[data-act="bread-swap"]');
  await d.page.waitForFunction(() => A.bread.wiz.rows[0].title === 'رسالة 1-2', { timeout: 8000 });
  await d.page.click('[data-act="bread-feasts"]');
  await d.page.waitForFunction(m => true, {}, next);
  await sleep(800);
  assert.equal((fake.state.feasts || {})[next].length, 3);
  // activation: the live program ends inside next month → blocked, never «today»
  await d.page.click('[data-act="bread-to-activate"]');
  await d.page.waitForSelector('[data-act="bread-activate"]', { timeout: 15000 });
  const cur = await d.page.evaluate(() => { const c = A.bread.programs.programs.find(p => p.id === A.bread.programs.current); return c && c.endsOn; });
  const blocked = await d.page.$eval('[data-act="bread-activate"]', b => b.disabled);
  assert.equal(blocked, !!cur && cur >= next + '-01', 'blocked only while the live program runs into the month');
  if (!blocked) {
    await d.page.click('[data-act="bread-activate"]');
    await d.page.waitForFunction(() => A.sub.bread === 'breadprograms', { timeout: 8000 });
    const act = writes(/\/activate$/).pop();
    assert.deepEqual(act.body, { mode: 'on', startsOn: next + '-01' });
  }
  assert.deepEqual(d.problems, []);
  await d.context.close();
});

test('St-Takla: the current month asks first (the days left), then only those days and the feasts still to come', async () => {
  freshWorker({ empty: true });
  const now = monthOf(TODAY, 0);
  fake.state.suggest = { [now]: taklaFile(now) };
  const d = await open();
  await go(d.page, 'breadnew');
  await d.page.click(`[data-act="bread-takla-month"][data-month="${now}"]`);
  await d.page.waitForFunction(m => A.bread.wiz.takMonth === m, { timeout: 5000 }, now);
  await d.page.click('[data-act="bread-takla"]');
  await d.page.waitForSelector('[data-act="bread-takla-ok"]', { timeout: 5000 });
  const left = lastDay(now) - +TODAY.slice(8, 10) + 1;
  assert.match(await viewText(d.page), new RegExp('فاضل'));
  await d.page.click('[data-act="bread-takla-ok"]');
  await d.page.waitForSelector('.ba-table', { timeout: 15000 });
  assert.equal(await d.page.evaluate(() => A.bread.wiz.rows.length), left);
  assert.ok(await d.page.evaluate(t => A.bread.wiz.feasts.every(f => f.date >= t), TODAY));
  assert.deepEqual(d.problems, []);
  await d.context.close();
});

test('a past program can be deleted for good: typed «امسح», then it is gone from the list', async () => {
  freshWorker({ next: false });
  const d = await open();
  await go(d.page, 'breadprograms');
  const before = fake.state.programs.length;
  const btns = await d.page.$$('[data-act="bread-past-delete"]');
  assert.ok(btns.length >= 2, 'the past programs have «امسح»');
  await btns[0].click();
  await d.page.waitForSelector('dialog.modal[open] .modal__typed');
  await d.page.type('dialog.modal[open] .modal__typed', 'امسح');
  await (await d.page.$('dialog.modal[open] .modal__actions .btn--danger')).click();
  await d.page.waitForFunction(n => A.bread.programs.programs.length === n - 1, { timeout: 8000 }, before);
  assert.deepEqual(writes(/\/delete$/).map(c => c.body), [{ confirm: true }]);
  assert.equal(fake.state.programs.length, before - 1);
  assert.deepEqual(d.problems, []);
  await d.context.close();
});
