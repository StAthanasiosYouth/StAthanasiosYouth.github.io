// «المسابقات» in the admin, in a real browser: the official /admin/ against
// the real .gs code (CompAdmin.gs and friends) in a fake Apps Script world.
//  - the wizard → the builder; basics with errors under the field
//  - every question type from the editor; reorder (buttons + drag);
//    duplicate; delete
//  - the question template (a real XLSX, the contract's headers); a
//    generated 100-question XLSX with bad rows: errors per row and column,
//    ticks, only the good rows added, the list fast
//  - the preview: the real engine (competition/index.html?preview) on phone
//    and desktop; a preview submit comes back graded
//  - publish through «راجع وانشر» (the fake GitHub gets the competition files)
//  - public submissions (world.post compStart / compSubmit): the list,
//    one submission (answers, key, ✓ / ✕, points, manual grading), grouped
//    review, results, the XLSX export
//  - the activity log («افتح» opens the builder), the edit lock (read-only
//    while another admin edits), module switches, 360px with no sideways scroll
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/comp-admin.e2e.mjs

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';
import { writeXlsx, readXlsx, unzip } from '../admin/xlsx.js';
import { QUESTION_HEADERS, QUESTION_SHEET } from '../admin/comp-sheets.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4675;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'fady.youssef@gmail.com';
const SHOTS = `${ROOT}tools/.cache/comp-admin/`;

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
let d;              // the admin's browser page (one session for the whole run)
let compId = '';
const claims = { email: ADMIN };

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', `${SITE}/`);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  world.properties.set('ADMIN_NAMES', JSON.stringify({ [ADMIN]: 'مينا زكريا', [SECOND]: 'فادي يوسف' }));
  world.gs.SESSION_STALE_SECONDS = 0;
  // the site was published once before (the review then lists what changed since)
  const first = world.as(ADMIN).gs.apiReview();
  world.as(ADMIN).gs.apiPublish(JSON.parse(JSON.stringify(first)).revision);
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
    // after a publish the panel watches the live site's content.json: same origin in production (/admin/ on the site), not here
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

const shot = async (name, page = d.page) => { await sleep(500); await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: false }); };

/* the page: wait for a selector, click a button by its words */
const $ = selector => d.page.waitForSelector(selector, { timeout: 10000 });
async function clickText(selector, words, page = d.page) {
  await page.waitForFunction((s, w) => [...document.querySelectorAll(s)].some(e => e.offsetParent !== null && e.textContent.includes(w) && !e.disabled), { timeout: 10000 }, selector, words);
  await page.evaluate((s, w) => [...document.querySelectorAll(s)].find(e => e.offsetParent !== null && e.textContent.includes(w) && !e.disabled).click(), selector, words);
}
/* a click through the DOM (a toast may sit over the spot), after the page settled */
const idle = () => d.page.waitForNetworkIdle({ idleTime: 350, timeout: 15000 }).catch(() => {});
async function jsClick(selector) {
  await idle();
  await d.page.waitForSelector(selector, { timeout: 10000 });
  await d.page.$eval(selector, n => n.click());
}
const sheetGone = () => d.page.waitForFunction(() => !document.querySelector('dialog.sheet').open, { timeout: 10000 });
const confirmModal = async () => { await $('dialog.modal[open] .btn--primary, dialog.modal[open] .btn--danger-solid'); await d.page.click('dialog.modal[open] .modal__actions .btn:first-child'); await d.page.waitForFunction(() => !document.querySelector('dialog.modal[open]')); };
/* the .gs functions as the admin (outside the API), results as plain objects (another realm's arrays) */
const gs = new Proxy({}, { get: (_, name) => (...args) => JSON.parse(JSON.stringify(world.as(ADMIN).gs[name](...args)) ?? null) });
const comp = () => gs.apiComp(compId);
const tab = async key => {
  await jsClick(`.comp-tabs__tab[data-tab="${key}"]`);
  await d.page.waitForFunction(k => document.querySelector(`.comp-tab[data-tab="${k}"]`), { timeout: 10000 }, key)
    .catch(async error => { await d.page.screenshot({ path: `${SHOTS}fail-tab-${key}.png` }); throw error; });
};
const setField = (scope, label, value) => d.page.evaluate((s, l, v) => {
  const field = [...document.querySelectorAll(`${s} .field[data-label="${l}"]`)].find(f => f.offsetParent !== null && f.querySelector('input:not([type=checkbox]):not([type=radio]), textarea'));
  const input = field.querySelector('input:not([type=checkbox]):not([type=radio]), textarea');
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, scope, label, value);
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);


/* ---------------- wizard → builder ---------------- */

test('wizard: name + kind → dates → a suggested Latin link (unique check) → created → the builder', async () => {

  await d.page.evaluate(() => A.go('comps', 'comps'));
  await $('.comp-list .empty-state');
  assert.equal(await d.page.$eval('#page-title', n => n.textContent), 'المسابقات');
  assert.equal(await d.page.$eval('#rail-nav [data-area="comps"]', n => n.getAttribute('aria-current')), 'page');
  await shot('01-list-empty');

  await clickText('.view button', 'مسابقة جديدة');
  await $('dialog.sheet[open] .comp-presets');
  const presets = await d.page.$$eval('dialog.sheet[open] .comp-preset strong', n => n.map(x => x.textContent));
  assert.deepEqual(presets, ['استبيان بسيط', 'مسابقة عامة بدرجات'], 'presets needing a switched-off module are hidden');

  // the name is required (said under the field)
  await clickText('dialog.sheet[open] .sheet__foot button', 'التالي');
  await $('dialog.sheet[open] .field--invalid[data-label="اسم المسابقة"]');
  await setField('dialog.sheet[open]', 'اسم المسابقة', 'مسابقة الكتاب المقدس');
  await d.page.click('dialog.sheet[open] .comp-preset input[value="scored"]');
  await shot('02-wizard-kind');
  await clickText('dialog.sheet[open] .sheet__foot button', 'التالي');
  await $('dialog.sheet[open] .datetime');
  await clickText('dialog.sheet[open] .sheet__foot button', 'التالي');

  // the link: suggested from the name, Latin, checked live
  await $('dialog.sheet[open] .comp-slug__url');
  const suggested = await d.page.$eval('dialog.sheet[open] .field[data-label="رابط المسابقة"] input', n => n.value);
  assert.match(suggested, /^[a-z0-9-]{2,40}$/);
  await setField('dialog.sheet[open]', 'رابط المسابقة', 'Admin');
  assert.match(await d.page.$eval('.comp-slug__problem', n => n.textContent), /إنجليزي صغير|محجوز/);
  assert.equal(await d.page.$eval('dialog.sheet[open] .sheet__foot .btn--primary', n => n.disabled), true);
  await setField('dialog.sheet[open]', 'رابط المسابقة', 'bible-quiz');
  assert.match(await d.page.$eval('.comp-slug__url', n => n.textContent), /competition\/bible-quiz\/$/);
  await shot('03-wizard-link');
  await clickText('dialog.sheet[open] .sheet__foot button', 'اعمل المسابقة');
  await sheetGone();
  await $('.comp-head .comp-head__title');

  const list = gs.apiComps();
  assert.equal(list.comps.length, 1);
  compId = list.comps[0].id;
  assert.equal(list.comps[0].slug, 'bible-quiz');
  assert.equal(list.comps[0].scoring, true, 'the preset filled the defaults');
  assert.equal(await d.page.$eval('.comp-head__title', n => n.textContent), 'مسابقة الكتاب المقدس');
  assert.equal(await d.page.$eval('.comp-tabs__tab[aria-selected="true"]', n => n.dataset.tab), 'overview');
  assert.match(await d.page.$eval('.comp-checks', n => n.textContent), /مفيش أسئلة لسه/);
  await shot('04-builder-overview');
  assert.deepEqual(d.problems, []);

});


test('basics: saved fields; a server error lands under its field; unsaved changes are asked about', async () => {

  await tab('basics');
  await setField('.comp-tab', 'اسم المسابقة', '');
  await clickText('.comp-tab .comp-save button', 'حفظ');
  await $('.comp-tab .field--invalid[data-label="اسم المسابقة"]');
  assert.match(await d.page.$eval('.comp-tab .field--invalid[data-label="اسم المسابقة"] .field__error', n => n.textContent), /اسم المسابقة مطلوب/);

  await setField('.comp-tab', 'اسم المسابقة', 'مسابقة الكتاب المقدس — الصوم');
  await setField('.comp-tab', 'الوصف', 'اختبر معلوماتك في الكتاب المقدس');
  await setField('.comp-tab', 'التعليمات', 'اقرا كل سؤال كويس.');
  // leaving with unsaved changes asks first (our modal), and staying keeps them
  await d.page.click('.comp-tabs__tab[data-tab="rules"]');
  await $('dialog.modal[open]');
  await d.page.click('dialog.modal[open] .modal__actions .btn--ghost');
  await d.page.waitForFunction(() => !document.querySelector('dialog.modal[open]'));
  assert.equal(await d.page.$eval('.comp-tab', n => n.dataset.tab), 'basics');
  await clickText('.comp-tab .comp-save button', 'حفظ');
  await d.page.waitForFunction(() => document.querySelector('.comp-head__title').textContent.includes('الصوم'));
  const saved = comp().comp;
  assert.equal(saved.title, 'مسابقة الكتاب المقدس — الصوم');
  assert.equal(saved.description, 'اختبر معلوماتك في الكتاب المقدس');
  assert.equal(saved.instructions, 'اقرا كل سؤال كويس.');
  await shot('05-basics');

});


/* ---------------- questions ---------------- */

async function openNewQuestion(type) {
  await clickText('.comp-tab button', 'سؤال جديد');
  await $('dialog.sheet[open] .comp-q-editor');
  await d.page.select('dialog.sheet[open] .field[data-label="نوع السؤال"] select', type);
}

async function setEditor(label, value) {
  await setField('dialog.sheet[open]', label, value);
}

async function saveQuestion() {
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await sheetGone();
}

test('questions: every type from the editor, with its key', async () => {

  await tab('questions');
  await $('.comp-tab .empty-state');

  // single: three choices, the first is right
  await openNewQuestion('single');
  await setEditor('نص السؤال', 'مين بنى الفلك؟');
  await d.page.evaluate(() => {
    const inputs = [...document.querySelectorAll('dialog.sheet[open] .comp-choice input[type=text]')];
    ['نوح', 'موسى', 'إبراهيم'].forEach((t, i) => { inputs[i].value = t; inputs[i].dispatchEvent(new Event('input', { bubbles: true })); });
  });
  await d.page.click('dialog.sheet[open] .comp-choice:nth-child(1) .comp-choice__mark input');
  await setEditor('الدرجة', '10');
  await shot('06-question-editor');
  await saveQuestion();

  // multi: two right out of four
  await openNewQuestion('multi');
  await setEditor('نص السؤال', 'اختار الأناجيل');
  await d.page.click('dialog.sheet[open] .comp-choices + button');   // «اختيار كمان»
  await d.page.evaluate(() => {
    const inputs = [...document.querySelectorAll('dialog.sheet[open] .comp-choice input[type=text]')];
    ['متى', 'مرقس', 'أعمال الرسل', 'رومية'].forEach((t, i) => { inputs[i].value = t; inputs[i].dispatchEvent(new Event('input', { bubbles: true })); });
  });
  await d.page.click('dialog.sheet[open] .comp-choice:nth-child(1) .comp-choice__mark input');
  await d.page.click('dialog.sheet[open] .comp-choice:nth-child(2) .comp-choice__mark input');
  await setEditor('الدرجة', '10');
  await saveQuestion();

  // true / false
  await openNewQuestion('truefalse');
  await setEditor('نص السؤال', 'داود غلب جليات');
  await d.page.click('dialog.sheet[open] .field[data-label="الإجابة الصحيحة"] input[value="t"]');
  await setEditor('الدرجة', '5');
  await saveQuestion();

  // short: accepted answers, «مراجعة لو مش مطابق»
  await openNewQuestion('short');
  await setEditor('نص السؤال', 'مين اتباع بعشرين من الفضة؟');
  await setEditor('الإجابات المقبولة', 'يوسف\nيوسف الصديق');
  await d.page.select('dialog.sheet[open] .field[data-label="التصحيح"] select', 'fallback');
  await setEditor('الدرجة', '5');
  await saveQuestion();

  // long (manual), optional
  await openNewQuestion('long');
  await setEditor('نص السؤال', 'اكتب تأمل قصير');
  await d.page.click('dialog.sheet[open] .check input');   // «إجباري» off
  await setEditor('الدرجة', '10');
  await saveQuestion();

  // number
  await openNewQuestion('number');
  await setEditor('نص السؤال', 'كام سفر في العهد الجديد؟');
  await setEditor('الإجابة الصحيحة', '٢٧');
  await setEditor('الدرجة', '5');
  await saveQuestion();

  // info
  await openNewQuestion('info');
  await setEditor('نص الفقرة', 'الجزء التاني');
  await saveQuestion();

  await d.page.waitForFunction(() => document.querySelectorAll('.comp-q').length === 7);
  const qs = comp().questions;
  assert.deepEqual(qs.map(q => q.type), ['single', 'multi', 'truefalse', 'short', 'long', 'number', 'info']);
  assert.equal(qs[0].correct, qs[0].choices.find(c => c.text === 'نوح').id);
  assert.deepEqual(qs[1].correct.map(id => qs[1].choices.find(c => c.id === id).text), ['متى', 'مرقس']);
  assert.equal(qs[2].correct, 't');
  assert.deepEqual(qs[3].correct, ['يوسف', 'يوسف الصديق']);
  assert.equal(qs[3].review, 'fallback');
  assert.equal(qs[4].required, false);
  assert.equal(qs[5].correct, '27');
  assert.ok(qs.every(q => !q.problems.length), 'nothing missing: ' + JSON.stringify(qs.map(q => q.problems)));
  // the key in words on each row
  assert.match(await d.page.$eval('.comp-q[data-type="multi"] .comp-q__key', n => n.textContent), /متى، مرقس/);
  await shot('07-questions');

});


test('questions: reorder with the buttons and by dragging; duplicate; delete with a confirm', async () => {

  const before = comp().questions.map(q => q.id);

  // ↓ on the first
  await jsClick('.comp-q:nth-child(1) .comp-q__down');
  await d.page.waitForFunction(id => document.querySelector('.comp-q:nth-child(2)').dataset.id === id, {}, before[0]);
  await d.page.waitForFunction(() => true);
  await sleep(600);
  assert.deepEqual(comp().questions.map(q => q.id).slice(0, 2), [before[1], before[0]], 'saved on the server');

  // drag the true/false (3rd) to the top by its handle
  const grip = await d.page.$('.comp-q:nth-child(3) .comp-q__grip');
  const box = await grip.boundingBox();
  const top = await (await d.page.$('.comp-q:nth-child(1)')).boundingBox();
  await d.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await d.page.mouse.down();
  for (let y = box.y + box.height / 2; y > top.y + 4; y -= 12) await d.page.mouse.move(box.x + box.width / 2, y);
  await d.page.mouse.move(box.x + box.width / 2, top.y + 2);
  await d.page.mouse.up();
  await d.page.waitForFunction(id => document.querySelector('.comp-q:nth-child(1)').dataset.id === id, {}, before[2]);
  await sleep(800);
  assert.equal(comp().questions[0].id, before[2], 'the drag is saved');

  // duplicate the number question: the copy right after it
  const number = comp().questions.find(q => q.type === 'number');
  await jsClick(`.comp-q[data-id="${number.id}"] .comp-q__copy`);
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-q').length === 8);
  const after = comp().questions;
  const at = after.findIndex(q => q.id === number.id);
  assert.equal(after[at + 1].text, number.text);

  // delete the copy (our confirm)
  await jsClick(`.comp-q[data-id="${after[at + 1].id}"] .comp-q__delete`);
  await $('dialog.modal[open]');
  assert.match(await d.page.$eval('dialog.modal[open]', n => n.textContent), /تمسح السؤال ده/);
  await d.page.click('dialog.modal[open] .modal__actions .btn:first-child');
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-q').length === 7);
  assert.equal(comp().questions.length, 7);

  // back to the natural order for the rest of the run
  const natural = ['single', 'multi', 'truefalse', 'short', 'long', 'number', 'info'].map(type => comp().questions.find(q => q.type === type).id);
  gs.apiCompQuestionsReorder(compId, natural);
  await d.page.evaluate(() => A.comp.refresh());
  assert.deepEqual(d.problems, []);

});


/* ---------------- the template and the import ---------------- */

test('template: «تحميل نموذج الأسئلة» makes a real XLSX with the contract headers, a type dropdown, «شرح» and «مثال»', async () => {

  await clickText('.comp-tab button', 'تحميل نموذج الأسئلة');
  await d.page.waitForFunction(() => A.comp.lastDownload && /نموذج/.test(A.comp.lastDownload.filename));
  const bytes = Uint8Array.from(await d.page.evaluate(() => Array.from(A.comp.lastDownload.bytes)));
  const book = await readXlsx(bytes);
  assert.deepEqual(book.sheets.map(s => s.name), [QUESTION_SHEET, 'شرح', 'مثال']);
  assert.deepEqual(book.sheets[0].rows[0], QUESTION_HEADERS);
  assert.deepEqual(QUESTION_HEADERS, ['ترتيب', 'السؤال', 'النوع', 'اختيار 1', 'اختيار 2', 'اختيار 3', 'اختيار 4', 'اختيار 5', 'اختيار 6', 'اختيار 7', 'اختيار 8', 'الإجابة الصحيحة', 'الدرجة', 'إجباري', 'التوضيح', 'صورة', 'مراجعة']);
  assert.equal(book.sheets[2].rows.length, 8, 'one example per type');
  const xml = new TextDecoder().decode((await unzip(bytes))['xl/worksheets/sheet1.xml']);
  assert.match(xml, /rightToLeft="1"/);
  assert.match(xml, /<dataValidation type="list"[^>]*sqref="C2:C1000"><formula1>&quot;اختيار واحد,اختيارات متعددة,صح وغلط,إجابة قصيرة,إجابة مفتوحة,رقم,فقرة&quot;/);
  writeFileSync(`${SHOTS}template.xlsx`, bytes);

  // the example sheet itself imports cleanly (the server agrees with the template)
  const examples = [QUESTION_HEADERS].concat(book.sheets[2].rows.slice(1)).map(r => r.join('\t')).join('\n');
  const preview = gs.apiCompImportPreview(compId, examples);
  assert.deepEqual(preview.rows.filter(r => r.status !== 'ok').map(r => r.errors), [], 'every example row is valid');

});


/* a 100-row file: mostly good, a few broken in different ways */
function hundredRows() {
  const rows = [QUESTION_HEADERS];
  const blank = () => QUESTION_HEADERS.map(() => '');
  const put = (row, name, value) => { row[QUESTION_HEADERS.indexOf(name)] = value; };
  for (let i = 1; i <= 100; i++) {
    const row = blank();
    const kind = i % 4;
    put(row, 'السؤال', `سؤال رقم ${i} من الملف`);
    if (kind === 0) { put(row, 'النوع', 'صح وغلط'); put(row, 'الإجابة الصحيحة', i % 8 ? 'صح' : 'غلط'); }
    else if (kind === 1) { put(row, 'النوع', 'اختيار واحد'); put(row, 'اختيار 1', 'أ'); put(row, 'اختيار 2', 'ب'); put(row, 'اختيار 3', 'ج'); put(row, 'الإجابة الصحيحة', '2'); }
    else if (kind === 2) { put(row, 'النوع', 'رقم'); put(row, 'الإجابة الصحيحة', String(i)); }
    else { put(row, 'النوع', 'اختيارات متعددة'); put(row, 'اختيار 1', 'س'); put(row, 'اختيار 2', 'ص'); put(row, 'اختيار 3', 'ع'); put(row, 'الإجابة الصحيحة', '1، 3'); }
    put(row, 'الدرجة', '2');
    rows.push(row);
  }
  // broken rows (file lines 11, 21, 30, 41, 51): the file's line is the index + 1 (line 1 = the headers)
  rows[10][QUESTION_HEADERS.indexOf('النوع')] = 'سؤال غريب';
  rows[20][QUESTION_HEADERS.indexOf('السؤال')] = '';
  rows[29][QUESTION_HEADERS.indexOf('الإجابة الصحيحة')] = '٥';
  rows[40][QUESTION_HEADERS.indexOf('النوع')] = 'رقم';
  rows[40][QUESTION_HEADERS.indexOf('الإجابة الصحيحة')] = 'كتير';
  rows[50][QUESTION_HEADERS.indexOf('الدرجة')] = 'عشرة';
  return rows;
}

test('import: a generated 100-question XLSX with broken rows → reasons by row and column → only the ticked good rows → fast list', async () => {

  const path = `${SHOTS}import-100.xlsx`;
  writeFileSync(path, writeXlsx({ sheets: [{ name: QUESTION_SHEET, rows: hundredRows(), textColumns: QUESTION_HEADERS.map((_, i) => i) }] }));

  await clickText('.comp-tab button', 'استيراد أسئلة');
  await $('dialog.sheet[open] .import__file');
  const input = await d.page.$('dialog.sheet[open] .import__file');
  await input.uploadFile(path);

  // the file is read here (XLSX → rows) and previewed by the server
  await d.page.waitForFunction(() => document.querySelector('dialog.sheet[open] .sheet__title')?.textContent === 'معاينة الاستيراد', { timeout: 20000 });
  const summary = await d.page.$eval('dialog.sheet[open] .import__summary', n => n.textContent);
  assert.match(summary, /جديد: ٩٥/);
  assert.match(summary, /خطأ: ٥/);
  const errors = await d.page.$$eval('dialog.sheet[open] .import__row[data-status="error"]', rows => rows.map(r => ({ line: r.dataset.line, text: r.querySelector('.import__lines').textContent })));
  assert.deepEqual(errors.map(e => e.line), ['11', '21', '30', '41', '51']);
  assert.match(errors[0].text, /صف ١١، النوع: «سؤال غريب» مش نوع معروف/);
  assert.match(errors[1].text, /صف ٢١، السؤال: نص السؤال ناقص/);
  assert.match(errors[2].text, /صف ٣٠، الإجابة الصحيحة: «٥» مش من الاختيارات/);
  assert.match(errors[3].text, /صف ٤١، الإجابة الصحيحة: «كتير» مش رقم/);
  assert.match(errors[4].text, /صف ٥١، الدرجة/);
  assert.match(await d.page.$eval('dialog.sheet[open]', n => n.textContent), /صلّح الملف وارفعه تاني/);
  assert.equal(await d.page.$$eval('dialog.sheet[open] .import__row[data-status="error"] .import__tick', n => n.length), 0, 'a broken row cannot be ticked');

  // the error filter, then untick one good row
  await d.page.click('dialog.sheet[open] .filter-chip[data-filter="error"]');
  assert.equal(await d.page.$$eval('dialog.sheet[open] .import__row:not([hidden])', n => n.length), 5);
  await shot('08-import-errors');
  await d.page.click('dialog.sheet[open] .filter-chip[data-filter="all"]');
  await d.page.click('dialog.sheet[open] .import__row[data-line="2"] .import__tick');
  assert.match(await d.page.$eval('dialog.sheet[open] .sheet__foot .btn--primary', n => n.textContent), /\(٩٤\)/);

  const started = Date.now();
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await d.page.waitForFunction(() => document.querySelector('dialog.sheet[open] .sheet__title')?.textContent === 'الاستيراد خلص ✓', { timeout: 20000 });
  assert.match(await d.page.$eval('dialog.sheet[open] .import__summary', n => n.textContent), /اتضاف: ٩٤/);
  await shot('09-import-result');
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await sheetGone();
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-q').length === 101, { timeout: 15000 });
  const took = Date.now() - started;
  assert.ok(took < 8000, `the long list shows fast (${took} ms incl. the import)`);
  assert.equal(comp().questions.length, 101);
  await shot('10-questions-101');

  // imported questions stay out of this run's preview / public part: hidden
  for (const q of comp().questions.slice(7)) gs.apiCompQuestionSave(compId, { ...q, enabled: false });
  await d.page.evaluate(() => A.comp.refresh());
  assert.deepEqual(d.problems, []);

});


/* ---------------- the preview ---------------- */

/* the engine in the frame: answer every question (whatever its type) and send */
async function playPreview(frame) {
  const state = () => frame.evaluate(() => document.getElementById('comp-main')?.dataset.state);
  await frame.waitForFunction(() => document.getElementById('comp-main')?.dataset.state === 'intro', { timeout: 15000 });
  await frame.click('[data-cta]');
  await frame.waitForFunction(() => ['identity', 'question'].includes(document.getElementById('comp-main')?.dataset.state));
  if (await state() === 'identity') {
    await frame.type('#f-name', 'تجربة الأدمن');
    await frame.type('#f-phone', '01012345678');
    await frame.click('button[type="submit"]');
  }
  for (let guard = 0; guard < 20; guard++) {
    await frame.waitForFunction(() => ['question', 'review'].includes(document.getElementById('comp-main')?.dataset.state));
    if (await state() === 'review') break;
    await frame.evaluate(() => {
      const q = document.querySelector('[data-q]');
      const choices = [...q.querySelectorAll('label.choice')];
      if (choices.length) choices[0].click();
      const text = q.querySelector('input[type=text], input:not([type]), input[inputmode], textarea');
      if (text) { text.value = q.querySelector('input[inputmode="decimal"], input[inputmode="numeric"]') ? '27' : 'يوسف'; text.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    const before = await frame.evaluate(() => document.querySelector('[data-q]')?.dataset.q);
    await frame.click('[data-next]');
    await frame.waitForFunction(b => document.getElementById('comp-main')?.dataset.state === 'review' || document.querySelector('[data-q]')?.dataset.q !== b, {}, before);
  }
  await frame.click('[data-submit]');
  await frame.waitForSelector('[data-confirm]');
  await frame.click('[data-confirm]');
  await frame.waitForFunction(() => document.getElementById('comp-main')?.dataset.state === 'result', { timeout: 15000 });
}

test('preview: the real engine (competition/index.html?preview), phone and desktop; a preview submit is graded by the draft key', async () => {

  await tab('preview');
  await $('.comp-preview__frame');
  const frameEl = await d.page.$('.comp-preview__frame');
  assert.match(await frameEl.evaluate(n => n.src), /\/competition\/index\.html\?preview$/);
  await d.page.waitForFunction(() => /جاهزة/.test(document.querySelector('.comp-tab .preview-status')?.textContent || ''), { timeout: 20000 });
  const frame = await frameEl.contentFrame();
  assert.equal(await frame.evaluate(() => document.documentElement.hasAttribute('data-preview')), true, 'the page is in preview mode');
  assert.match(await frame.$eval('.hero__title', n => n.textContent), /الصوم/);

  // desktop, then phone
  await d.page.click('.comp-preview .segment[data-value="desktop"]');
  assert.equal(await frameEl.evaluate(n => n.style.width), '1100px');
  await shot('11-preview-desktop');
  await d.page.click('.comp-preview .segment[data-value="phone"]');
  assert.equal(await frameEl.evaluate(n => n.style.width), '390px');
  assert.equal(await frame.evaluate(() => innerWidth), 390, 'the engine lays out at a phone width');

  // «مقفولة» forces the closed intro
  await d.page.click('.comp-preview .segment[data-value="closed"]');
  await frame.waitForFunction(() => !document.querySelector('[data-cta]'), { timeout: 8000 });
  await d.page.click('.comp-preview .segment[data-value="auto"]');

  await playPreview(frame);
  await d.page.waitForFunction(() => !document.querySelector('.comp-preview__result').hidden, { timeout: 15000 });
  const said = await d.page.$eval('.comp-preview__result', n => n.textContent);
  assert.match(said, /آخر تجربة: [٠-٩]+ من ٤٥/);
  // the engine shows the result the admin computed (score + the review with the key)
  await frame.waitForSelector('.result__line--score');
  assert.match(await frame.$eval('.result__line--score', n => n.textContent), /٤٥/);
  assert.ok(await frame.$$eval('.answer', n => n.length) >= 5, 'answers with the key');
  await shot('12-preview-phone-result');
  assert.equal(world.compSpreadsheet.getSheetByName('Submissions').data.length, 1, 'the preview writes no submission');
  assert.deepEqual(d.problems, []);

});


/* ---------------- publish ---------------- */

test('publish: «تتنشر مع الموقع» + the card, then «راجع وانشر» → the fake GitHub gets the competition files', async () => {

  await tab('overview');
  await d.page.click('.comp-switches .switch:nth-child(1) input');
  await d.page.waitForFunction(() => A.comp.data.comp.enabled === true, { timeout: 10000 });
  await d.page.click('.comp-switches .switch:nth-child(2) input');
  await d.page.waitForFunction(() => !!(A.comp.data.card && A.comp.data.card.enabled), { timeout: 10000 });
  assert.ok(comp().comp.cardId, 'the linked card exists');
  await shot('13-overview-ready');

  await clickText('.comp-tab button', 'راجع وانشر');
  await $('dialog.sheet[open] .review-groups');
  assert.match(await d.page.$eval('dialog.sheet[open] .review-groups', n => n.textContent), /مسابقة جديدة: مسابقة الكتاب المقدس/);
  await clickText('dialog.sheet[open] .sheet__foot button', 'نشر التغييرات');
  await d.page.waitForFunction(() => /تم النشر/.test(document.querySelector('dialog.sheet[open] .sheet__title')?.textContent || ''), { timeout: 30000 });
  const files = world.github.files();
  assert.ok(files['competition/bible-quiz/index.html'], 'the stub page');
  const pub = JSON.parse(files['competition/bible-quiz/comp.json']);
  assert.equal(pub.slug, 'bible-quiz');
  assert.equal(pub.questionCount, 6);
  assert.ok(!/مين بنى الفلك|نوح/.test(files['competition/bible-quiz/comp.json']), 'no question text or key in GitHub');
  assert.ok(JSON.parse(files['content.json']).competitions.some(c => c.slug === 'bible-quiz'));
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await sheetGone();
  await d.page.evaluate(() => A.comp.refresh());
  await d.page.waitForFunction(() => A.comp.data.summary.status === 'open', { timeout: 10000 });

});


/* ---------------- public submissions ---------------- */

const PEOPLE = [
  { name: 'مارك ميلاد', phone: '01011111111', right: true, short: 'يوسف', long: 'ربنا بيحبنا' },
  { name: 'مريم عادل', phone: '01022222222', right: false, short: 'يوسف ', long: 'آية جميلة' },
  { name: 'بيشوي سمير', phone: '01033333333', right: true, short: 'يُوسُف', long: '' },
  { name: 'كيرلس نبيل', phone: '01044444444', right: true, short: 'يعقوب', long: '' },
  { name: 'ماريو هاني', phone: '01055555555', right: false, short: 'يعقوب', long: 'تأمل' }
];

function submitAs(person, key) {
  const clientKey = `e2e-key-${person.phone}`;
  const start = world.post({ fn: 'compStart', args: [{ slug: 'bible-quiz', clientKey, fields: { name: person.name, phone: person.phone }, hp: '' }] });
  assert.equal(start.ok, true, JSON.stringify(start));
  const answers = {};
  for (const q of start.questions) {
    const k = key.find(x => x.id === q.id);
    if (q.type === 'single') answers[q.id] = person.right ? k.correct : q.choices.find(c => c.id !== k.correct).id;
    if (q.type === 'multi') answers[q.id] = person.right ? k.correct : [q.choices[2].id];
    if (q.type === 'truefalse') answers[q.id] = person.right ? 't' : 'f';
    if (q.type === 'short') answers[q.id] = person.short;
    if (q.type === 'number') answers[q.id] = person.right ? '٢٧' : '30';
    if (q.type === 'long' && person.long) answers[q.id] = person.long;
  }
  const done = world.post({ fn: 'compSubmit', args: [{ token: start.attempt.token, clientKey, answers }] });
  assert.equal(done.ok, true, JSON.stringify(done));
  return { id: start.attempt.id, result: done.result };
}

test('submissions: people send (compStart / compSubmit); the list searches on the server; one submission shows answers, the key, ✓ / ✕, points; manual grading', async () => {

  const key = comp().questions;
  const sent = PEOPLE.map(p => submitAs(p, key));
  assert.equal(sent[0].result.status, 'pending_review', 'the long answer waits for a reviewer');

  await tab('subs');
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-sub').length === 5, { timeout: 10000 });
  assert.match(await d.page.$eval('.comp-subs__status', n => n.textContent), /اللي بعتوا \(٥\)/);
  await shot('14-submissions');

  // server-side search by name, then by phone
  await d.page.type('.comp-subs__tools input[type=search]', 'مريم');
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-sub').length === 1, { timeout: 10000 });
  await d.page.$eval('.comp-subs__tools input[type=search]', n => { n.value = ''; });
  await d.page.type('.comp-subs__tools input[type=search]', '3333');
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-sub').length === 1 && document.querySelector('.comp-sub__name').textContent === 'بيشوي سمير', { timeout: 10000 });
  await d.page.$eval('.comp-subs__tools input[type=search]', n => { n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-sub').length === 5, { timeout: 10000 });

  // Mariam's submission: wrong single, her pick and the right one both shown
  await d.page.click(`.comp-sub[data-id="${sent[1].id}"]`);
  await $('dialog.sheet[open] .comp-answers');
  const card = await d.page.$eval('dialog.sheet[open] .comp-ans[data-type="single"]', n => ({ text: n.textContent, wrong: n.classList.contains('is-wrong') }));
  assert.ok(card.wrong, 'marked wrong');
  assert.match(card.text, /✕ غلط/);
  assert.match(card.text, /نوح/);
  assert.equal(await d.page.$$eval('dialog.sheet[open] .comp-ans[data-type="single"] .comp-ans__choice.is-right', n => n.map(x => x.textContent.includes('نوح'))[0]), true);
  assert.match(await d.page.$eval('dialog.sheet[open] .comp-ans[data-type="number"]', n => n.textContent), /إجابته\s*30[\s\S]*الصح\s*27/);
  await shot('15-submission-detail');

  // her long answer: partial points by hand
  await d.page.$eval('dialog.sheet[open] .comp-ans[data-type="long"] .comp-grade__pts', n => { n.value = '7'; });
  await clickText('dialog.sheet[open] .comp-ans[data-type="long"] button', 'حط الدرجة');
  await d.page.waitForFunction(() => /٧ من ١٠/.test(document.querySelector('dialog.sheet[open] .comp-ans[data-type="long"] .comp-grade')?.textContent || ''), { timeout: 10000 });
  const graded = gs.apiCompSubmission(sent[1].id);
  const longQ = graded.questions.find(q => q.type === 'long');
  assert.equal(longQ.grade.pts, 7);
  assert.equal(longQ.grade.by, ADMIN);

  // void, then back
  await clickText('dialog.sheet[open] .sheet__foot button', 'إلغاء المشاركة');
  await confirmModal();
  await d.page.waitForFunction(() => /رجّع المشاركة/.test(document.querySelector('dialog.sheet[open] .sheet__foot').textContent), { timeout: 10000 });
  assert.equal(gs.apiCompSubmission(sent[1].id).submission.status, 'void');
  await clickText('dialog.sheet[open] .sheet__foot button', 'رجّع المشاركة');
  await d.page.waitForFunction(() => /إلغاء المشاركة/.test(document.querySelector('dialog.sheet[open] .sheet__foot').textContent), { timeout: 10000 });
  assert.notEqual(gs.apiCompSubmission(sent[1].id).submission.status, 'void');
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--ghost');
  await sheetGone();
  assert.deepEqual(d.problems, []);

});


test('review: the same answers grouped («يوسف ×٣») — one tap grades the whole group; partial points for a long answer', async () => {

  await tab('review');
  await $('.comp-review .comp-group');
  assert.ok(await d.page.$('.comp-tabs__tab[data-tab="review"] .comp-tabs__badge'), 'a pending badge on the tab');
  const short = comp().questions.find(q => q.type === 'short');
  // «يوسف» / «يوسف » / «يُوسُف» are one answer after normalizing… but «يوسف» is an accepted answer: those were right at once.
  // what waits is «يعقوب» (×2, not accepted, fallback review)
  const group = await d.page.$eval(`.comp-rq[data-qid="${short.id}"] .comp-group`, n => ({ sample: n.querySelector('.comp-group__sample').textContent, count: n.querySelector('.comp-group__count')?.textContent }));
  assert.equal(group.sample, 'يعقوب');
  assert.equal(group.count, '×٢');
  await shot('16-review-groups');
  await clickText(`.comp-rq[data-qid="${short.id}"] .comp-group button`, 'غلط');
  await d.page.waitForFunction(id => !document.querySelector(`.comp-rq[data-qid="${id}"]`), { timeout: 10000 }, short.id);

  // the long answers: one partial, the others right
  const longQ = comp().questions.find(q => q.type === 'long');
  const first = await d.page.$(`.comp-rq[data-qid="${longQ.id}"] .comp-group`);
  await first.$eval('input[type=number]', n => { n.value = '5'; });
  await first.evaluate(n => [...n.querySelectorAll('button')].find(b => b.textContent.includes('درجة جزئية')).click());
  await sleep(400);
  while (await d.page.$(`.comp-rq[data-qid="${longQ.id}"] .comp-group`)) {
    await d.page.evaluate(id => [...document.querySelectorAll(`.comp-rq[data-qid="${id}"] .comp-group button`)].find(b => b.textContent.includes('صح')).click(), longQ.id);
    await sleep(700);
  }
  await d.page.waitForSelector('.comp-review .empty-state--ok', { timeout: 10000 });
  assert.equal(gs.apiCompReviewQueue(compId).total, 0);

});


test('results: ranking, per-question stats, regrade (manual marks kept), the XLSX export parses', async () => {

  await tab('results');
  await $('.comp-rank .comp-rank__row[data-id]');
  assert.equal(await d.page.$$eval('.comp-rank .comp-rank__row[data-id]', n => n.length), 5);
  assert.match(await d.page.$eval('.comp-rank .comp-rank__row[data-id] .comp-rank__rank', n => n.textContent), /🥇/);
  assert.ok(await d.page.$('.comp-qstat .comp-qstat__bar'), 'a % bar per question');
  assert.match(await d.page.$eval('.comp-qstats', n => n.textContent), /أكتر إجابة غلط/);
  await shot('17-results');

  await clickText('.comp-tab button', 'إعادة التصحيح');
  await $('dialog.modal[open]');
  assert.match(await d.page.$eval('dialog.modal[open]', n => n.textContent), /التصحيح اليدوي اللي عملته بإيدك هيفضل/);
  await d.page.click('dialog.modal[open] .modal__actions .btn:first-child');
  await d.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /اتصحح ٥ مشاركة/.test(t.textContent)), { timeout: 10000 });

  await clickText('.comp-tab button', 'تصدير Excel');
  await d.page.waitForFunction(() => A.comp.lastDownload && /results/.test(A.comp.lastDownload.filename), { timeout: 10000 });
  const exported = await d.page.evaluate(() => ({ name: A.comp.lastDownload.filename, bytes: Array.from(A.comp.lastDownload.bytes) }));
  assert.match(exported.name, /^bible-quiz-results-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const book = await readXlsx(Uint8Array.from(exported.bytes));
  const [header, ...rows] = book.sheets[0].rows;
  assert.equal(rows.length, 5, 'one row per participant');
  assert.ok(header.includes('الاسم') && header.includes('الموبايل'));
  assert.ok(header.some(h => /^س١: .*\(صح؟\)$/.test(h)), 'a ✓ / ✕ column per question');
  assert.ok(rows.some(r => r.includes('نوح') && r.includes('✓')), 'answers as the choice text, with their mark');
  assert.ok(rows.some(r => r.includes('01011111111') || r.includes('+201011111111')), 'the phone stays text');
  writeFileSync(`${SHOTS}results.xlsx`, Uint8Array.from(exported.bytes));
  assert.deepEqual(d.problems, []);

});


/* ---------------- the rest of the panel ---------------- */

test('activity log: competition rows with their icon and «افتح» → the builder; #open/competition/<id> too', async () => {

  await d.page.evaluate(() => { A.dirty = false; return A.go('activity'); });
  await $('.acts .act');
  const rows = await d.page.$$eval('.acts .act', n => n.map(r => ({ text: r.textContent, open: !!r.querySelector('.act__open') })));
  const mine = rows.filter(r => /المسابقة/.test(r.text));
  assert.ok(mine.length >= 3, 'competition rows: ' + rows.map(r => r.text).join(' | '));
  assert.ok(mine.every(r => r.open), 'each one opens');
  await shot('18-activity');
  await d.page.evaluate(() => [...document.querySelectorAll('.acts .act')].find(r => /المسابقة/.test(r.textContent)).querySelector('.act__open').click());
  await $('.comp-head .comp-head__title');
  assert.equal(await d.page.evaluate(() => A.comp.open), compId);

  await d.page.evaluate(() => A.go('home'));
  await d.page.evaluate(id => A.openLink('#open/competition/' + id), compId);
  await $('.comp-head .comp-head__title');
  assert.equal(await d.page.evaluate(() => A.area + '/' + A.comp.open), 'comps/' + compId);

  // the admin push link for a competition opens the builder
  assert.ok(world.gs.ADMIN_PUSH_OPEN_TYPES.includes('competition'));
  assert.equal(world.gs.adminPushUrl_({ action: 'create', type: 'competition', entityId: compId, id: 'act-0' }), '/admin/#open/competition/' + compId);

});


test('edit lock: another admin in the builder → read-only with who; free again → «افتح آخر نسخة»', async () => {

  await d.page.evaluate(() => { A.comp.open = ''; A.comp.data = null; return A.go('comps', 'comps'); });
  const token = world.issueToken({ email: SECOND });
  const started = world.post({ fn: 'apiSessionStart', args: [{ device: 'موبايل', force: true, state: false }], token });
  const beat = () => world.post({ fn: 'apiHeartbeat', args: [{ area: 'comps', view: 'comps', item: { kind: 'comp', id: compId, label: 'مسابقة' }, locks: ['comp:' + compId] }], token, sid: started.result.sid });
  assert.equal(beat().ok, true);

  await d.page.evaluate(id => A.compOpen(id, 'basics'), compId);
  await d.page.waitForFunction(() => /فادي يوسف بيعدّل/.test(document.querySelector('.lock-banner')?.textContent || ''), { timeout: 10000 });
  assert.equal(await d.page.$eval('.comp-tab[data-tab="basics"] .comp-save button', n => n.disabled), true, 'nothing can be saved');
  assert.equal(await d.page.$eval('.comp-tab[data-tab="basics"] .field[data-label="اسم المسابقة"] input', n => n.disabled), true);
  await shot('19-locked');

  world.post({ fn: 'apiSessionEnd', args: [{}], token, sid: started.result.sid });
  await d.page.waitForFunction(() => /خلّص التعديل/.test(document.querySelector('.lock-banner')?.textContent || ''), { timeout: 15000 });
  await clickText('.lock-banner button', 'افتح آخر نسخة');
  await d.page.waitForFunction(() => !document.querySelector('.lock-banner'), { timeout: 10000 });
  assert.equal(await d.page.$eval('.comp-tab[data-tab="basics"] .comp-save button', n => n.disabled), false);

});


test('module switches: the registry on, and the coded preset appears in the wizard (Phase 2 / 3 are installed now: tests/comp-admin2.e2e.mjs)', async () => {

  await d.page.evaluate(() => A.go('comps', 'compsettings'));
  await $('.comp-module');
  assert.equal(await d.page.$eval('[data-module="wallet"] input', n => n.disabled), true, 'the wallet waits for the registry');
  await d.page.waitForFunction(() => !document.querySelector('[data-module="registry"] input').disabled, { timeout: 10000 });
  await d.page.$eval('[data-module="registry"] input', n => n.click());
  for (let i = 0; i < 40 && world.properties.get('COMP_REGISTRY') !== '1'; i++) await sleep(250);
  assert.equal(world.properties.get('COMP_REGISTRY'), '1');
  await d.page.waitForFunction(() => document.querySelector('.comp-module.is-on [data-module="registry"]'), { timeout: 10000 });
  await shot('20-modules');

  await d.page.evaluate(() => A.compNew());
  await $('dialog.sheet[open] .comp-presets');
  assert.ok((await d.page.$$eval('dialog.sheet[open] .comp-preset strong', n => n.map(x => x.textContent))).includes('مسابقة بأكواد'));
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });

  await d.page.evaluate(() => A.go('comps', 'compsettings'));
  await $('[data-module="registry"] input');
  await d.page.$eval('[data-module="registry"] input', n => n.click());
  for (let i = 0; i < 40 && world.properties.get('COMP_REGISTRY') !== ''; i++) await sleep(250);
  assert.equal(world.properties.get('COMP_REGISTRY'), '');

});


test('«كروت المسابقات»: the linked card is read-only with «افتح المسابقة»; the help topic follows the screen', async () => {

  await d.page.evaluate(() => A.go('content', 'competitions'));
  await $('.item--linked');
  assert.equal(await d.page.$eval('#page-title', n => n.textContent), 'كروت المسابقات');
  assert.match(await d.page.$eval('.item--linked', n => n.textContent), /بيتعدل من المسابقة/);
  assert.equal(await d.page.$$eval('.item--linked .icon-btn', n => n.length), 0, 'no edit / delete there');
  await d.page.click('.item--linked .btn');
  await $('.comp-head .comp-head__title');

  await d.page.click('#help-open');
  await d.page.waitForSelector('dialog.help[open] .help__title');
  assert.equal(await d.page.$eval('dialog.help[open] .help__title', n => n.textContent), 'المسابقات');
  await d.page.keyboard.press('Escape');

});


test('360px: the dock fits seven areas; the list, the builder tabs and screens never scroll sideways', async () => {

  await d.page.setViewport(SMALL);
  await sleep(300);
  const dock = await d.page.evaluate(() => [...document.querySelectorAll('#dock .dockbtn')].map(b => {
    const label = b.querySelector('.dockbtn__label');
    return { text: label.textContent, overflow: label.scrollWidth > label.clientWidth + 1 };
  }));
  assert.equal(dock.length, 7);
  assert.ok(dock.every(b => !b.overflow), 'dock labels fit: ' + JSON.stringify(dock));

  await d.page.evaluate(() => { A.comp.open = ''; return A.go('comps', 'comps'); });
  await $('.comp-items .comp-item');
  assert.ok(await overflow(d.page) <= 0, 'list');
  await shot('21-phone-list');

  for (const key of ['overview', 'basics', 'people', 'rules', 'result', 'questions', 'notify', 'subs', 'review', 'results', 'preview']) {
    await d.page.evaluate(id => { A.dirty = false; return A.compOpen(id, 'overview'); }, compId);
    await d.page.evaluate(k => { A.comp.tab = k; A.render(); }, key);
    await d.page.waitForFunction(k => document.querySelector(`.comp-tab[data-tab="${k}"]`), {}, key);
    await sleep(key === 'subs' || key === 'results' || key === 'preview' ? 900 : 250);
    assert.ok(await overflow(d.page) <= 0, `no sideways scroll on «${key}»`);
    if (['overview', 'questions', 'subs', 'results', 'preview'].includes(key)) await shot(`22-phone-${key}`);
  }

  // a submission on a phone
  await d.page.evaluate(() => { A.comp.tab = 'subs'; A.render(); });
  await jsClick('.comp-sub');
  await $('dialog.sheet[open] .comp-answers');
  assert.ok(await overflow(d.page) <= 0);
  await shot('23-phone-submission');
  await d.page.keyboard.press('Escape');
  await d.page.setViewport(DESKTOP);
  assert.deepEqual(d.problems, []);

});
