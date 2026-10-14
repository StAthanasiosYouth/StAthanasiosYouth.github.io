// «المسابقات» Phase 2 / 3 screens in a real browser: the official /admin/
// against the real .gs code (CompRegistry / CompWallet / CompStoreItems) in a
// fake Apps Script world.
//  - the switches' chain and the sub-tabs they bring
//  - «المشاركين»: add (phone preview, duplicate warnings), the code (shown,
//    copied, WhatsApp without the code in the URL, never in browser storage,
//    a new code kills the old one)
//  - the names import with every classification, filters, an inline fix
//    re-checked by the server, same-name choices, apply → codes (masked),
//    export, printed cards (10 a page; the QR decodes to «نقاطي», no code),
//    printed list, undo
//  - builder: registered mode / wallet toggle; a coded submission links to
//    its participant
//  - «النقاط»: balances, ledger, adjust (negative balance refused), sync
//  - «المتجر»: prize CRUD with the library picker; requests from shopRedeem:
//    ready, handed over, cancelled with a refund
//  - the activity log's new rows open their screens; 360px, no sideways scroll
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/comp-admin2.e2e.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const JSQR = readFileSync(require.resolve('jsqr/dist/jsQR.js'), 'utf8');

const PORT = 4677;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const PORTAL = `${SITE}/points/`;
const ADMIN = 'menazakmena@gmail.com';
const SHOTS = `${ROOT}tools/.cache/comp-admin2/`;
const DESKTOP = { width: 1366, height: 900 };
const SMALL = { width: 360, height: 760 };
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);
const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 4000, render: 8000, beat: 900, beatFail: 2500 };
const CODE = /^ATH-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const webp = (fill = 7) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(40, fill)]);

let world;
let server;
let browser;
let d;
const people = {};
const claims = { email: ADMIN };

/* the .gs functions as the admin (outside the API), results as plain objects */
const gs = new Proxy({}, { get: (_, name) => (...args) => JSON.parse(JSON.stringify(world.as(ADMIN).gs[name](...args)) ?? null) });
const pub = (fn, arg) => { const r = world.post({ fn, args: [arg] }); delete r.mime; return r; };

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
  const first = gs.apiReview();
  gs.apiPublish(first.revision);
  // a prize picture in the library
  people.pic = gs.apiUploadMedia({ full: webp(31).toString('base64'), thumb: webp(31).toString('base64'), mime: 'image/webp', width: 600, height: 600, alt: 'كوباية' }).media;
  world.as('');
  server = createSiteServer({
    world: { issueToken: c => world.issueToken(c), get github() { return world.github; } },
    config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK, timing: TIMING }),
    claims: () => claims
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const context = await browser.createBrowserContext();
  await context.overridePermissions(LOCAL, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (/content\.json\?check=/.test(message.text())) return;
    if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(`csp: ${message.text()}`);
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text()}`);
  });
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  // wa.me never opens a real tab here: the address is recorded
  await page.evaluateOnNewDocument(() => { window.__opened = []; window.open = url => { window.__opened.push(String(url)); return null; }; window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
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
async function clickText(selector, words) {
  await d.page.waitForFunction((s, w) => [...document.querySelectorAll(s)].some(e => e.offsetParent !== null && e.textContent.includes(w) && !e.disabled), { timeout: 10000 }, selector, words);
  await d.page.evaluate((s, w) => [...document.querySelectorAll(s)].find(e => e.offsetParent !== null && e.textContent.includes(w) && !e.disabled).click(), selector, words);
}
const setField = (scope, label, value) => d.page.evaluate((s, l, v) => {
  const field = [...document.querySelectorAll(`${s} .field[data-label="${l}"]`)].find(f => f.offsetParent !== null);
  const input = field.querySelector('input:not([type=checkbox]):not([type=radio]), textarea');
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, scope, label, value);
const sheetGone = () => d.page.waitForFunction(() => !document.querySelector('dialog.sheet').open, { timeout: 10000 });
const modalOk = async () => { await $('dialog.modal[open]'); await d.page.click('dialog.modal[open] .modal__actions .btn:first-child'); await d.page.waitForFunction(() => !document.querySelector('dialog.modal[open]')); };
const storage = () => d.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
const overflow = () => d.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const tabs = () => d.page.$$eval('#subtabs .tab', n => n.map(t => t.textContent));


/* ---------------- switches ---------------- */

test('switches: the chain (المتجر ← النقاط ← المشاركين), sub-tabs appear, turning one off asks and keeps the data', async () => {

  await d.page.evaluate(() => A.go('comps', 'compsettings'));
  await $('[data-module="registry"] input');
  assert.equal(await d.page.$eval('[data-module="wallet"] input', n => n.disabled), true, 'the wallet needs the registry first');
  assert.match(await d.page.$eval('[data-module-card="wallet"]', n => n.textContent), /محتاج «المشاركين بالأكواد» الأول/);
  assert.deepEqual(await tabs(), ['المسابقات', 'الإعدادات']);

  for (const key of ['registry', 'wallet', 'shop']) {
    await d.page.waitForFunction(k => !document.querySelector(`[data-module="${k}"] input`).disabled, { timeout: 10000 }, key);
    await d.page.$eval(`[data-module="${key}"] input`, n => n.click());
    await d.page.waitForFunction(k => document.querySelector(`[data-module-card="${k}"].is-on`), { timeout: 10000 }, key);
  }
  assert.deepEqual(await tabs(), ['المسابقات', 'المشاركين', 'النقاط', 'المتجر', 'الإعدادات']);
  assert.match(await d.page.$eval('.view', n => n.textContent), /مفيش أي حاجة بتتمسح/);
  await shot('01-switches');

  // off: asks, naming what goes with it — and we keep it on
  await d.page.$eval('[data-module="registry"] input', n => n.click());
  await $('dialog.modal[open]');
  assert.match(await d.page.$eval('dialog.modal[open]', n => n.textContent), /هيتقفل معاه: «المحفظة والنقاط» و«متجر الجوائز»[\s\S]*مفيش أي بيانات هتتمسح/);
  await d.page.click('dialog.modal[open] .modal__actions .btn--ghost');
  await d.page.waitForFunction(() => !document.querySelector('dialog.modal[open]') && document.querySelector('[data-module="registry"] input').checked);
  assert.equal(world.properties.get('COMP_SHOP'), '1');
  assert.deepEqual(d.problems, []);

});


/* ---------------- participants ---------------- */

async function addPerson(name, phone, group) {
  await d.page.evaluate(() => A.compPersonNew());
  await $('dialog.sheet[open] .field[data-label="رقم الموبايل"]');
  await setField('dialog.sheet[open]', 'الاسم', name);
  await setField('dialog.sheet[open]', 'رقم الموبايل', phone);
  if (group) await setField('dialog.sheet[open]', 'المجموعة', group);
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
}

test('«+ مشارك»: the phone as it will be stored; saved → its page; same phone / same name warnings; an exact duplicate refused', async () => {

  await d.page.evaluate(() => A.go('comps', 'people'));
  await $('.view .empty-state');
  await d.page.evaluate(() => A.compPersonNew());
  await $('dialog.sheet[open] .comp-phone-said');
  await setField('dialog.sheet[open]', 'رقم الموبايل', '1012345678');
  await d.page.waitForFunction(() => /هيتسجل 01012345678 ✓/.test(document.querySelector('.comp-phone-said').textContent));
  await setField('dialog.sheet[open]', 'رقم الموبايل', '010123');
  await d.page.waitForFunction(() => /ناقص/.test(document.querySelector('.comp-phone-said').textContent));
  await setField('dialog.sheet[open]', 'رقم الموبايل', '1012345678');
  await setField('dialog.sheet[open]', 'الاسم', 'مارك ميلاد عزيز');
  await setField('dialog.sheet[open]', 'المجموعة', 'ثانوي بنين');
  await shot('02-person-editor');
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await $('.comp-person-head');
  people.mark = gs.apiParticipants({ q: 'مارك' }).items[0];
  assert.equal(people.mark.phone, '01012345678');

  await addPerson('مريم عادل فهمي', '01123456789', 'إعدادي بنات');
  await d.page.waitForFunction(() => /مريم عادل فهمي/.test(document.querySelector('.comp-person-head')?.textContent || ''), { timeout: 10000 });
  // a sister on the same phone: saved, with the warning said plainly
  await addPerson('بيشوي عادل فهمي', '0112 345 6789', 'ابتدائي');
  await $('dialog.modal[open]');
  assert.match(await d.page.$eval('dialog.modal[open]', n => n.textContent), /نفس الرقم متسجل كمان لـ: مريم عادل فهمي/);
  await modalOk();
  await d.page.waitForFunction(() => /بيشوي/.test(document.querySelector('.comp-person-head')?.textContent || ''), { timeout: 10000 });

  // the same name and phone again: refused in the editor
  await addPerson('مارك ميلاد عزيز', '01012345678');
  await d.page.waitForFunction(() => /متسجل قبل كده/.test(document.querySelector('dialog.sheet[open] .errors')?.textContent || ''), { timeout: 10000 });
  // a bad phone lands under its field
  await setField('dialog.sheet[open]', 'الاسم', 'اسم تجريبي');
  await setField('dialog.sheet[open]', 'رقم الموبايل', '05012345678');
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await d.page.waitForFunction(() => /مش رقم موبايل مصري/.test(document.querySelector('dialog.sheet[open] .field--invalid[data-label="رقم الموبايل"]')?.textContent || ''), { timeout: 10000 });
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
  assert.equal(gs.apiParticipants({}).total, 3);
  assert.deepEqual(d.problems, []);

});

test('the code: masked; «إظهار الكود»; copy; WhatsApp copies the message and opens wa.me WITHOUT the code; never in browser storage; a new code kills the old one', async () => {

  await d.page.evaluate(id => A.compPerson(id), people.mark.id);
  await $('.comp-code');
  assert.equal(await d.page.$eval('.comp-code', n => n.textContent), 'ATH-••••-••••');
  assert.match(await d.page.$eval('.view', n => n.textContent), /آخر توليد: .* — مينا زكريا · نسخة ١/);

  await jsClick('[data-act="reveal"]');
  await d.page.waitForFunction(() => document.querySelector('.comp-code').dataset.masked === 'false');
  const shown = await d.page.$eval('.comp-code', n => n.textContent);
  assert.match(shown, CODE);
  assert.equal(shown, gs.apiParticipantCode(people.mark.id).code);
  assert.match(await d.page.$eval('.comp-code__left', n => n.textContent), /هيستخبى تاني بعد/);
  await shot('03-code-shown');

  await jsClick('[data-act="copy"]');
  await d.page.waitForFunction(c => A.comp.lastCopied === c, {}, shown);
  assert.equal(await d.page.evaluate(() => navigator.clipboard.readText()), shown, 'on the clipboard');

  await jsClick('[data-act="whatsapp"]');
  await d.page.waitForFunction(() => window.__opened.length === 1);
  const opened = await d.page.evaluate(() => window.__opened[0]);
  assert.equal(opened, 'https://wa.me/201012345678', 'the chat only');
  assert.ok(!opened.includes(shown) && !/text=/.test(opened), 'no code, no text in the URL');
  const message = await d.page.evaluate(() => navigator.clipboard.readText());
  assert.match(message, new RegExp(shown));
  assert.ok(message.includes(PORTAL), 'the portal link');
  assert.match(await d.page.$eval('.toasts', n => n.textContent), /الرسالة اتنسخت ✓ — الصقها في واتساب/);

  assert.ok(!(await storage()).includes(shown), 'the code is never in localStorage / sessionStorage');

  // leaving hides it
  await d.page.evaluate(() => A.render());
  assert.equal(await d.page.$eval('.comp-code', n => n.textContent), 'ATH-••••-••••');

  // a new code: the old one stops at once
  await jsClick('[data-act="reset"]');
  await $('dialog.modal[open]');
  assert.match(await d.page.$eval('dialog.modal[open]', n => n.textContent), /الكود القديم هيبطل فورًا/);
  await d.page.click('dialog.modal[open] .modal__actions .btn:first-child');
  await d.page.waitForFunction(() => /الكود الجديد/.test(document.querySelector('dialog.modal[open] .modal__title')?.textContent || ''), { timeout: 10000 });
  const fresh = await d.page.$eval('dialog.modal[open] .comp-code', n => n.textContent);
  assert.match(fresh, CODE);
  assert.notEqual(fresh, shown);
  await shot('04-new-code');
  await d.page.click('dialog.modal[open] .modal__actions .btn');
  await d.page.waitForFunction(() => /نسخة ٢/.test(document.querySelector('.view').textContent), { timeout: 10000 });
  assert.equal(pub('compCode', { code: shown }).code, 'code', 'the old code is refused');
  assert.equal(pub('compCode', { code: fresh }).ok, true, 'the new one works');
  assert.ok(!(await storage()).includes(fresh));

  // stopped: the code stops too (and back)
  await d.page.$eval('.comp-person-head .switch input', n => n.click());
  await $('dialog.modal[open]');
  assert.match(await d.page.$eval('dialog.modal[open]', n => n.textContent), /الكود بتاعه هيبطل على طول/);
  await d.page.click('dialog.modal[open] .modal__actions .btn:first-child');
  await d.page.waitForFunction(() => /موقوف/.test(document.querySelector('.comp-person-head').textContent), { timeout: 10000 });
  assert.equal(pub('compCode', { code: fresh }).code, 'code');
  await d.page.$eval('.comp-person-head .switch input', n => n.click());
  await d.page.waitForFunction(() => !/موقوف/.test(document.querySelector('.comp-person-head .item__meta').textContent), { timeout: 10000 });
  assert.deepEqual(d.problems, []);

});


/* ---------------- the names import ---------------- */

function namesFile() {
  const rows = [PEOPLE_HEADERS.slice(1, 4),
    ['يوسف سمير نبيل', '01001112223', 'ثانوي بنين'],          // 2 new
    ['مارك ميلاد عزيز', '01012345678', 'ثانوي بنين'],         // 3 exists
    ['مريم عادل فهمي', '01123456789', 'ثانوي بنات'],          // 4 exists, another group (an update)
    ['يوسف سمير نبيل', '1001112223', 'ثانوي بنين'],           // 5 the same as line 2
    ['كيرلس ميلاد عزيز', '01012345678', 'ابتدائي'],          // 6 new, Mark's phone (a family)
    ['بيشوي عادل فهمي', '01234567890', 'ابتدائي'],           // 7 the registry's Bishoy, another phone
    ['ماريو هاني', '0123', 'ابتدائي'],                         // 8 a bad phone
    ['', '01055556666', 'ابتدائي']                             // 9 no name
  ];
  for (let i = 1; i <= 12; i++) rows.push([`مشترك رقم ${i} تجريبي`, `0109000${String(i).padStart(4, '0')}`, i === 1 ? 'ثانوي بنن' : 'ثانوي بنين']);
  return rows;
}

test('names import: template; every kind classified with its why; filters; groups (a likely typo); inline fixes re-checked; same-name choice; apply', async () => {

  await d.page.evaluate(() => { A.compPeople.open = ''; return A.go('comps', 'people'); });
  await $('.comp-person');

  // the template
  await clickText('.view button', 'تحميل نموذج الأسماء');
  await d.page.waitForFunction(() => A.comp.lastDownload && /الأسماء/.test(A.comp.lastDownload.filename));
  const template = await readXlsx(Uint8Array.from(await d.page.evaluate(() => Array.from(A.comp.lastDownload.bytes))));
  assert.deepEqual(template.sheets.map(s => s.name), [PEOPLE_SHEET, 'شرح', 'القوائم', 'مثال']);
  assert.deepEqual(template.sheets[0].rows[0], PEOPLE_HEADERS);

  const path = `${SHOTS}names.xlsx`;
  writeFileSync(path, writeXlsx({ sheets: [{ name: PEOPLE_SHEET, rows: namesFile(), textColumns: [0, 1, 2] }] }));
  await clickText('.view button', 'استيراد / تحديث');
  await $('dialog.sheet[open] .import__file');
  await (await d.page.$('dialog.sheet[open] .import__file')).uploadFile(path);
  await d.page.waitForFunction(() => document.querySelector('dialog.sheet[open] .sheet__title')?.textContent === 'معاينة الأسماء', { timeout: 20000 });

  const kinds = await d.page.$eval('dialog.sheet[open] .comp-import__kinds', n => n.textContent);
  for (const want of [/جديد ✓: ١٥/, /موجود بالفعل: ٢/, /مكرر في الملف: ١/, /رقم مشترك: ١/, /اسم موجود برقم مختلف: ١/, /خطأ: ٢/]) assert.match(kinds, want);
  const row = line => d.page.$eval(`dialog.sheet[open] .import__row[data-line="${line}"]`, n => n.textContent);
  assert.match(await row(3), /متسجل قبل كده/);
  assert.match(await row(4), /المجموعة: إعدادي بنات ← ثانوي بنات/);
  assert.match(await row(5), /مكرر في الملف: نفس صف ٢/);
  assert.match(await row(6), /نفس الرقم مع: مارك ميلاد عزيز/);
  assert.match(await row(7), /نفس الاسم متسجل برقم تاني/);
  assert.match(await row(8), /رقم الموبايل ناقص/);
  assert.match(await row(9), /الاسم ناقص/);
  assert.match(await d.page.$eval('dialog.sheet[open] .comp-import__groups', n => n.textContent), /«ثانوي بنن» شبه «ثانوي بنين»/);
  // ticks: exists / dup / error can't be ticked; same-name waits for a choice
  for (const line of [3, 5, 8, 9]) assert.equal(await d.page.$(`dialog.sheet[open] .import__row[data-line="${line}"] .import__tick`), null);
  assert.equal(await d.page.$eval('dialog.sheet[open] .import__row[data-line="4"] .import__tick', n => n.checked), false, 'an update waits');
  assert.equal(await d.page.$eval('dialog.sheet[open] .import__row[data-line="7"] input[type=radio]:checked', n => n.value), '', 'same name: nothing chosen yet');

  // filters
  await d.page.click('dialog.sheet[open] .filter-chip[data-filter="error"]');
  assert.equal(await d.page.$$eval('dialog.sheet[open] .import__row:not([hidden])', n => n.length), 2);
  await shot('05-import-errors');
  await d.page.click('dialog.sheet[open] .filter-chip[data-filter="sameName"]');
  assert.deepEqual(await d.page.$$eval('dialog.sheet[open] .import__row:not([hidden])', n => n.map(r => r.dataset.line)), ['7']);
  await d.page.click('dialog.sheet[open] .filter-chip[data-filter="all"]');

  // inline fixes → the server checks again
  const fix = async (line, key, value) => {
    const button = await d.page.$(`dialog.sheet[open] .import__row[data-line="${line}"] [data-act="fix"]`);
    if (button) await button.evaluate(n => n.click());
    await d.page.$eval(`dialog.sheet[open] .import__row[data-line="${line}"] [data-fix="${key}"]`, (n, v) => { n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  };
  await fix(8, 'phone', '01077778888');
  await fix(9, 'name', 'جرجس عاطف');
  await clickText('dialog.sheet[open] .sheet__foot button', 'راجع تاني بالتعديلات');
  await d.page.waitForFunction(() => /خطأ/.test(document.querySelector('dialog.sheet[open] .comp-import__kinds').textContent) === false, { timeout: 15000 });
  assert.match(await d.page.$eval('dialog.sheet[open] .comp-import__kinds', n => n.textContent), /جديد ✓: ١٧/);

  // the same-name row: «نفس الشخص — حدّث رقمه»; the update: ticked
  await d.page.$eval('dialog.sheet[open] .import__row[data-line="7"] input[type=radio][value^="phone:"]', n => n.click());
  await d.page.$eval('dialog.sheet[open] .import__row[data-line="4"] .import__tick', n => n.click());
  assert.match(await d.page.$eval('dialog.sheet[open] .sheet__foot .btn--primary', n => n.textContent), /\(١٨\)/);
  await shot('06-import-ready');
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await d.page.waitForFunction(() => document.querySelector('dialog.sheet[open] .sheet__title')?.textContent === 'الاستيراد خلص ✓', { timeout: 20000 });
  const summary = await d.page.$eval('dialog.sheet[open] .import__summary', n => n.textContent);
  assert.match(summary, /اتسجل جديد: ١٦/);
  assert.match(summary, /اتحدّث: ١/);
  assert.match(summary, /رقم اتغيّر: ١/);
  await shot('07-import-result');
  assert.equal(gs.apiParticipants({ q: 'مريم' }).items[0].group, 'ثانوي بنات');
  assert.equal(gs.apiParticipants({ q: 'بيشوي' }).items[0].phone, '01234567890');
  people.batch = gs.apiParticipants({}).batches[0].id;
  assert.deepEqual(d.problems, []);

});

test('after the import: codes masked until shown, export parses, printed cards (10 a page; the QR decodes to «نقاطي», never a code), printed list, undo', async () => {

  // codes
  await jsClick('dialog.sheet[open] [data-act="codes"]');
  await d.page.waitForFunction(() => /الأكواد \(١٦\)/.test(document.querySelector('dialog.sheet[open] .sheet__title')?.textContent || ''), { timeout: 10000 });
  assert.ok(await d.page.$$eval('dialog.sheet[open] .comp-codes .comp-code', n => n.every(c => c.textContent === 'ATH-••••-••••')), 'masked first');
  await d.page.click('dialog.sheet[open] [data-act="reveal-all"]');
  const codes = await d.page.$$eval('dialog.sheet[open] .comp-codes .comp-code', n => n.map(c => c.textContent));
  assert.equal(codes.length, 16);
  assert.ok(codes.every(c => /^ATH-/.test(c) && c.length === 13));
  await shot('08-codes');
  const kept = await storage();
  assert.ok(!codes.some(c => kept.includes(c)), 'no code in browser storage');
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });

  // the batch's actions from the list too
  await d.page.evaluate(() => { A.compPeople.open = ''; A.render(); });
  await $(`.comp-batch[data-batch="${people.batch}"]`);

  // export
  await jsClick(`.comp-batch[data-batch="${people.batch}"] [data-act="export"]`);
  await d.page.waitForFunction(() => A.comp.lastDownload && /^codes-/.test(A.comp.lastDownload.filename), { timeout: 10000 });
  const book = await readXlsx(Uint8Array.from(await d.page.evaluate(() => Array.from(A.comp.lastDownload.bytes))));
  assert.deepEqual(book.sheets[0].rows[0], ['الاسم', 'الموبايل', 'المجموعة', 'الخادم المسؤول', 'الكود']);
  assert.equal(book.sheets[0].rows.length, 17);
  assert.ok(book.sheets[0].rows.slice(1).every(r => CODE.test(r[4]) && /^01/.test(r[1])), 'codes and phones as text');

  // printed cards
  await jsClick(`.comp-batch[data-batch="${people.batch}"] [data-act="cards"]`);
  await $('dialog.print-root[open] .print-card');
  const pages = await d.page.$$eval('dialog.print-root .print-page', n => n.map(p => p.querySelectorAll('.print-card').length));
  assert.deepEqual(pages, [10, 6], '10 cards a page');
  const card = await d.page.$eval('dialog.print-root .print-card', n => ({ text: n.textContent, qr: n.querySelector('.print-card__qr').dataset.qr }));
  assert.match(card.text, /ATH-/, 'the code is printed on the card');
  assert.equal(card.qr, PORTAL);
  await d.page.evaluate(JSQR);
  const decoded = await d.page.evaluate(() => new Promise(resolve => {
    const img = document.querySelector('dialog.print-root .print-card__qr');
    const go = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = window.jsQR(data.data, canvas.width, canvas.height);
      resolve(found ? found.data : null);
    };
    if (img.complete) go(); else img.onload = go;
  }));
  assert.equal(decoded, PORTAL, 'the QR opens «نقاطي»');
  assert.ok(!/ATH-/.test(decoded), 'no code in the QR');
  await shot('09-print-cards');
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.print-root .print-bar button')].find(b => b.textContent.includes('اطبع')).click());
  assert.equal(await d.page.evaluate(() => window.__printed), 1, 'window.print()');
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.print-root .print-bar button')].find(b => b.textContent.includes('قفل')).click());
  await d.page.waitForFunction(() => !document.querySelector('dialog.print-root') && !document.documentElement.classList.contains('is-printing'));

  // printed list
  await jsClick(`.comp-batch[data-batch="${people.batch}"] [data-act="list"]`);
  await $('dialog.print-root[open] .print-list');
  assert.equal(await d.page.$$eval('dialog.print-root .print-list tbody tr', n => n.length), 16);
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.print-root .print-bar button')].find(b => b.textContent.includes('قفل')).click());

  // undo
  await jsClick(`.comp-batch[data-batch="${people.batch}"] [data-act="undo"]`);
  await $('dialog.modal[open]');
  await d.page.click('dialog.modal[open] .modal__actions .btn:first-child');
  await d.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /اتشال ١٦ مشترك/.test(t.textContent)), { timeout: 10000 });
  assert.equal(gs.apiParticipants({}).total, 3);
  assert.deepEqual(d.problems, []);

});


/* ---------------- a coded competition with points ---------------- */

test('builder: registered mode explained; the wallet toggle only for coded + scored; a coded submission links to its participant', async () => {

  const created = gs.apiCompCreate({ preset: 'points', title: 'مسابقة النقاط', slug: 'points-quiz', enabled: true });
  people.comp = created.comp.id;
  gs.apiCompQuestionSave(people.comp, { type: 'single', text: 'مين بنى الفلك؟', choices: [{ text: 'نوح', correct: true }, { text: 'موسى' }], points: 10 });
  gs.apiCompQuestionSave(people.comp, { type: 'truefalse', text: 'داود غلب جليات', correct: 'صح', points: 5 });
  const review = gs.apiReview();
  assert.deepEqual(review.errors, []);
  gs.apiPublish(review.revision);

  // Mark plays with his code
  const code = gs.apiParticipantCode(people.mark.id).code;
  const ptoken = pub('compCode', { code }).ptoken;
  const key = 'e2e-points-key-0001';
  const start = pub('compStart', { slug: 'points-quiz', clientKey: key, ptoken });
  assert.equal(start.ok, true, JSON.stringify(start));
  const answers = {};
  for (const q of start.questions) answers[q.id] = q.type === 'single' ? q.choices.find(c => c.text === 'نوح').id : 't';
  const done = pub('compSubmit', { token: start.attempt.token, clientKey: key, answers });
  assert.equal(done.ok, true);
  people.ptoken = ptoken;

  await d.page.evaluate(id => A.compOpen(id, 'people'), people.comp);
  await $('.comp-tab[data-tab="people"]');
  assert.match(await d.page.$eval('.comp-tab', n => n.textContent), /الشخص بيتعرف من الكود بتاعه/);
  assert.equal(await d.page.$eval('.comp-tab input[value="registered"]', n => n.checked && !n.disabled), true);

  await d.page.evaluate(() => { A.comp.tab = 'result'; A.render(); });
  await $('.comp-tab[data-tab="result"]');
  const wallet = await d.page.evaluate(() => { const box = [...document.querySelectorAll('.comp-tab .check')].find(n => /محفظة المشترك/.test(n.textContent)); return { on: box.querySelector('input').checked, disabled: box.querySelector('input').disabled, text: box.textContent }; });
  assert.deepEqual([wallet.on, wallet.disabled], [true, false]);
  assert.match(wallet.text, /النقاط هتتضاف لرصيد المشترك أوتوماتيك لما تتصحح/);
  await shot('10-result-wallet');

  await d.page.evaluate(() => { A.comp.tab = 'subs'; A.render(); });
  await $('.comp-sub');
  await jsClick('.comp-sub');
  await $('dialog.sheet[open] [data-act="person"]');
  await d.page.click('dialog.sheet[open] [data-act="person"]');
  await d.page.waitForFunction(() => /مارك ميلاد عزيز/.test(document.querySelector('.comp-person-head')?.textContent || ''), { timeout: 10000 });
  // his page: the competition with its points, and the wallet summary
  assert.match(await d.page.$eval('.view', n => n.textContent), /مسابقة النقاط[\s\S]*\+١٥ نقطة/);
  assert.match(await d.page.$eval('.view', n => n.textContent), /الرصيد/);
  assert.deepEqual(d.problems, []);

});


/* ---------------- points ---------------- */

test('«النقاط»: balances, the ledger (kinds, competition, who), adjust (a negative balance refused, the key kept for a retry), sync', async () => {

  await d.page.evaluate(() => A.go('comps', 'points'));
  await $('.comp-balance');
  assert.match(await d.page.$eval('.comp-balance', n => n.textContent), /مارك ميلاد عزيز[\s\S]*١٥ نقطة/);
  await shot('11-points');

  await jsClick('.comp-balance');
  await $('dialog.sheet[open] .comp-ledger__row');
  assert.match(await d.page.$eval('dialog.sheet[open] .comp-ledger', n => n.textContent), /\+١٥[\s\S]*مسابقة[\s\S]*«مسابقة النقاط»[\s\S]*تلقائي/);

  // too much off: refused before anything is sent
  await d.page.$eval('dialog.sheet[open] .field[data-label="عدد النقاط"] input', n => { n.value = '-100'; });
  await setField('dialog.sheet[open]', 'السبب', 'تجربة');
  await d.page.click('dialog.sheet[open] [data-act="adjust"]');
  await d.page.waitForFunction(() => /مينفعش الرصيد يبقى بالسالب/.test(document.querySelector('dialog.sheet[open] .errors')?.textContent || ''));

  await d.page.$eval('dialog.sheet[open] .field[data-label="عدد النقاط"] input', n => { n.value = '+20'; });
  await setField('dialog.sheet[open]', 'السبب', 'حضور الرحلة');
  await d.page.click('dialog.sheet[open] [data-act="adjust"]');
  await d.page.waitForFunction(() => /\+٢٠/.test(document.querySelector('dialog.sheet[open] .comp-ledger')?.textContent || ''), { timeout: 10000 });
  assert.match(await d.page.$eval('dialog.sheet[open] .comp-ledger', n => n.textContent), /تعديل من الخدام[\s\S]*حضور الرحلة[\s\S]*مينا زكريا[\s\S]*الرصيد بعدها ٣٥/);
  assert.equal(gs.apiWalletParticipant(people.mark.id).balance, 35);
  await shot('12-ledger');
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });

  await jsClick('[data-act="sync"]');
  await $('dialog.modal[open]');
  assert.match(await d.page.$eval('dialog.modal[open]', n => n.textContent), /النقاط مظبوطة ✓|اتصلح/);
  await modalOk();
  assert.deepEqual(d.problems, []);

});


/* ---------------- the store ---------------- */

test('«المتجر»: a prize with a library picture, edited, another deleted; requests: ready → handed over; cancel refunds', async () => {

  await d.page.evaluate(() => A.go('comps', 'shop'));
  await $('.comp-shop-items .empty-state');
  await clickText('.view button', 'جايزة جديدة');
  await $('dialog.sheet[open] .picker');
  await setField('dialog.sheet[open]', 'اسم الجايزة', 'كوباية الأسرة');
  await d.page.$eval('dialog.sheet[open] .field[data-label="النقاط المطلوبة"] input', n => { n.value = '10'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await d.page.$eval('dialog.sheet[open] .field[data-label="الكمية"] input', n => { n.value = '5'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .picker button')].find(b => b.textContent.includes('من المكتبة')).click());
  await $('dialog.picker-dialog[open] .media-tile');
  await d.page.evaluate(() => document.querySelector('dialog.picker-dialog[open] .media-tile').click());
  await d.page.waitForFunction(() => !document.querySelector('dialog.picker-dialog'));
  await $('dialog.sheet[open] .picker__img');
  await shot('13-prize-editor');
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await sheetGone();
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-shop-items .item').length === 1, { timeout: 10000 });
  assert.match(await d.page.$eval('.toasts', n => n.textContent), /الصورة هتظهر في نقاطي بعد ما تنشر/);
  const cup = gs.apiShopItems().items[0];
  assert.equal(cup.image, people.pic.id);
  assert.equal(cup.cost, 10);

  // edit: 15 points
  await jsClick(`.comp-shop-items .item[data-id="${cup.id}"] .icon-btn`);
  await $('dialog.sheet[open] .field[data-label="النقاط المطلوبة"]');
  await d.page.$eval('dialog.sheet[open] .field[data-label="النقاط المطلوبة"] input', n => { n.value = '15'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await sheetGone();
  await d.page.waitForFunction(() => /١٥ نقطة/.test(document.querySelector('.comp-shop-items').textContent), { timeout: 10000 });

  // another prize, deleted
  gs.apiShopItemSave({ name: 'قلم', cost: 5 });
  await d.page.evaluate(() => A.render());
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-shop-items .item').length === 2, { timeout: 10000 });
  const pen = gs.apiShopItems().items.find(i => i.name === 'قلم');
  await jsClick(`.comp-shop-items .item[data-id="${pen.id}"] .icon-btn--danger`);
  await modalOk();
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-shop-items .item').length === 1, { timeout: 10000 });

  // two requests from «نقاطي»
  const r1 = pub('shopRedeem', { ptoken: people.ptoken, itemId: cup.id, requestKey: 'e2e-req-000000000001' });
  const r2 = pub('shopRedeem', { ptoken: people.ptoken, itemId: cup.id, requestKey: 'e2e-req-000000000002' });
  assert.equal(r1.ok && r2.ok, true, JSON.stringify([r1, r2]));
  assert.equal(r2.balance, 5);
  await d.page.evaluate(() => A.render());
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-req').length === 2, { timeout: 10000 });
  await shot('14-requests');

  const req = id => `.comp-req[data-id="${id}"]`;
  await jsClick(`${req(r1.redemption.id)} [data-next="approved"]`);
  await d.page.waitForFunction(s => document.querySelector(s)?.querySelector('[data-next="fulfilled"]') && !document.querySelector(s).querySelector('[data-next="approved"]'), { timeout: 10000 }, req(r1.redemption.id));
  await jsClick(`${req(r1.redemption.id)} [data-next="fulfilled"]`);
  await d.page.waitForFunction(s => !document.querySelector(s), { timeout: 10000 }, req(r1.redemption.id));

  await d.page.$eval(`${req(r2.redemption.id)} input`, n => { n.value = 'خلصت من المخزن'; });
  await jsClick(`${req(r2.redemption.id)} [data-next="cancelled"]`);
  await $('dialog.modal[open]');
  assert.match(await d.page.$eval('dialog.modal[open]', n => n.textContent), /الـ١٥ نقطة هترجع لرصيد مارك ميلاد عزيز/);
  await d.page.click('dialog.modal[open] .modal__actions .btn:first-child');
  await d.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /١٥ نقطة رجعت، الرصيد دلوقتي ٢٠/.test(t.textContent)), { timeout: 10000 });
  const all = gs.apiShopRedemptions({ status: 'all' });
  assert.deepEqual(all.items.map(r => r.status).sort(), ['cancelled', 'fulfilled']);
  assert.equal(all.items.find(r => r.status === 'cancelled').note, 'خلصت من المخزن');
  assert.equal(gs.apiWalletParticipant(people.mark.id).entries.filter(e => e.kind === 'refund').length, 1, 'refunded once');
  await d.page.click('.filter-chip[data-status="all"]');
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-req').length === 2, { timeout: 10000 });
  assert.match(await d.page.$eval('.comp-reqs', n => n.textContent), /النقاط رجعت/);
  assert.deepEqual(d.problems, []);

});


/* ---------------- the rest of the panel ---------------- */

test('activity log: participant, points, prize, request rows have icons and «افتح» to their screens; #open links; admin push types', async () => {

  await d.page.evaluate(() => { A.dirty = false; return A.go('activity'); });
  await $('.acts .act');
  const rows = await d.page.$$eval('.acts .act', n => n.map(r => ({ text: r.textContent, open: !!r.querySelector('.act__open') })));
  for (const want of [/المشترك|مشترك/, /نقاط/, /الجايزة/, /طلب/]) {
    const hit = rows.find(r => want.test(r.text));
    assert.ok(hit, `${want} in ${rows.map(r => r.text).join(' | ')}`);
  }
  // (a deletion and the publish row have nothing to open)
  const closed = rows.filter(r => /طلب الجايزة|الجايزة|نقاط|المشترك/.test(r.text) && !/مسح|نشر تحديث/.test(r.text) && !r.open);
  assert.deepEqual(closed.map(r => r.text), []);
  await shot('15-activity');

  await d.page.evaluate(() => [...document.querySelectorAll('.acts .act')].find(r => /نقاط/.test(r.textContent) && r.querySelector('.act__open')).querySelector('.act__open').click());
  await $('dialog.sheet[open] .comp-ledger');
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });

  await d.page.evaluate(id => A.openLink('#open/participant/' + id), people.mark.id);
  await d.page.waitForFunction(() => /مارك ميلاد عزيز/.test(document.querySelector('.comp-person-head')?.textContent || ''), { timeout: 10000 });
  const item = gs.apiShopItems().items[0];
  await d.page.evaluate(id => A.openLink('#open/shopitem/' + id), item.id);
  await $('dialog.sheet[open] .field[data-label="اسم الجايزة"]');
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });

  for (const type of ['participant', 'points', 'shopitem', 'redemption']) assert.ok(world.gs.ADMIN_PUSH_OPEN_TYPES.includes(type));
  assert.equal(world.gs.adminPushUrl_({ action: 'redemption.status', type: 'redemption', entityId: 'r-0123456789', id: 'act-0' }), '/admin/#open/redemption/r-0123456789');

  // home: «+ مشارك» while the registry is on
  await d.page.evaluate(() => A.go('home'));
  await $('.quick');
  assert.ok(await d.page.$$eval('.quick', n => n.some(b => b.textContent.includes('مشارك'))));

});


test('360px: the dock, participants, a participant, the import preview, points and the store — no sideways scroll', async () => {

  await d.page.setViewport(SMALL);
  await sleep(300);
  await d.page.evaluate(() => { A.compPeople.open = ''; return A.go('comps', 'people'); });
  await $('.comp-person');
  assert.ok(await overflow() <= 0, 'people');
  await shot('16-phone-people');
  await d.page.evaluate(id => A.compPerson(id), people.mark.id);
  await $('.comp-code');
  assert.ok(await overflow() <= 0, 'a participant');
  await shot('17-phone-person');
  await d.page.evaluate(() => A.compPeople.openImport('الاسم بالكامل\tرقم الموبايل\nمارك ميلاد عزيز\t01012345678\nاسم\t0123\nمريم جديدة\t01123456789'));
  await $('dialog.sheet[open] .import__paste');
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .sheet__foot button')][0].click());
  await d.page.waitForFunction(() => document.querySelector('dialog.sheet[open] .sheet__title')?.textContent === 'معاينة الأسماء', { timeout: 10000 });
  assert.ok(await overflow() <= 0, 'import preview');
  await shot('18-phone-import');
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
  for (const sub of ['points', 'shop', 'compsettings']) {
    await d.page.evaluate(s => A.go('comps', s), sub);
    await sleep(900);
    assert.ok(await overflow() <= 0, sub);
    await shot(`19-phone-${sub}`);
  }
  const dock = await d.page.evaluate(() => [...document.querySelectorAll('#dock .dockbtn__label')].every(l => l.scrollWidth <= l.clientWidth + 1));
  assert.ok(dock, 'dock labels fit');
  await d.page.setViewport(DESKTOP);
  assert.deepEqual(d.problems, []);

});
