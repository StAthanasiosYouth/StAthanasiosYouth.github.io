// Participants round trip and «توزيع الأكواد» in the admin, in a real browser, against the real
// server (docs/COMPETITIONS.md §7.5.1, §7.7):
//  - «تصدير البيانات الحالية» (the template's layout, ids, no codes unless ticked) → edit → «استيراد / تحديث»
//    → the preview says what changes → apply: same ids, same codes, no duplicates
//  - «تحديد» → «حدد الخادم المسؤول» (one write)
//  - «توزيع الأكواد»: a zip of one file per servant (each only their people, a ready WhatsApp message,
//    the chat link without the code), the grouped screen with «نسخ كل الرسايل»; no code in browser storage
//  - 360px, no sideways scroll
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/people-roundtrip.e2e.mjs

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';
import { writeXlsx, readXlsx, unzip } from '../admin/xlsx.js';
import { PEOPLE_HEADERS, PEOPLE_SHEET } from '../admin/comp-sheets.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4971;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN = 'menazakmena@gmail.com';
const SHOTS = `${ROOT}tools/.cache/people-roundtrip/`;
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

const gs = new Proxy({}, { get: (_, name) => (...args) => { const g = world.as(ADMIN).gs; const api = /^api/.test(name) ? g.apiFunctions_()[name] : null; const fn = typeof api === 'function' ? api : g[name]; return JSON.parse(JSON.stringify(fn(...args)) ?? null); } });

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

  gs.apiCompSettings({ registry: true });
  ctx.mina = gs.apiParticipantSave({ name: 'مينا عادل جرجس', phone: '01012340001', group: 'مجموعة الكليات', servant: 'أ. بيتر سمير' }).participant;
  ctx.mariam = gs.apiParticipantSave({ name: 'مريم زكريا عطا', phone: '01012340002', group: 'مجموعة المغتربين', servant: 'أ. مارينا نبيل' }).participant;
  ctx.john = gs.apiParticipantSave({ name: 'يوحنا مجدي سمير', phone: '01012340003', group: 'مجموعة الخريجين' }).participant;
  ctx.fady = gs.apiParticipantSave({ name: 'فادي يوسف حنا', phone: '01012340004', group: 'مجموعة الكليات', church: 'مارجرجس' }).participant;
  ctx.codes = Object.fromEntries([ctx.mina, ctx.mariam, ctx.john, ctx.fady].map(p => [p.id, gs.apiParticipantCode(p.id).code]));
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

const shot = async name => { await sleep(400); await d.page.screenshot({ path: `${SHOTS}${name}.png` }); };
const $ = selector => d.page.waitForSelector(selector, { timeout: 10000 });
const idle = () => d.page.waitForNetworkIdle({ idleTime: 350, timeout: 15000 }).catch(() => {});
async function jsClick(selector) {
  await idle();
  await d.page.waitForSelector(selector, { timeout: 10000 });
  await d.page.$eval(selector, n => n.click());
}
const lastDownload = async () => ({
  filename: await d.page.evaluate(() => A.comp.lastDownload.filename),
  bytes: Uint8Array.from(await d.page.evaluate(() => Array.from(A.comp.lastDownload.bytes)))
});
const overflow = () => d.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const storage = () => d.page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
const openPeople = async () => {
  await d.page.evaluate(() => { A.compPeople.open = ''; A.compPeople.selecting = false; A.compPeople.selected = {}; return A.go('comps', 'people'); });
  await $('.comp-person');
  await idle();
};


test('export → edit → re-import: ids and codes kept, changes previewed, a new row added, nothing duplicated', async () => {

  await openPeople();
  await jsClick('[data-act="export-data"]');
  await $('dialog.sheet[open] [data-act="export-go"]');
  await shot('01-export-sheet');
  await d.page.click('dialog.sheet[open] [data-act="export-go"]');
  await d.page.waitForFunction(() => A.comp.lastDownload && /^المشاركين-/.test(A.comp.lastDownload.filename), { timeout: 10000 });
  const file = await lastDownload();
  const book = await readXlsx(file.bytes);
  assert.deepEqual(book.sheets.map(s => s.name), [PEOPLE_SHEET, 'شرح', 'القوائم']);
  const rows = book.sheets[0].rows;
  assert.deepEqual(rows[0], PEOPLE_HEADERS, 'no code column unless asked');
  assert.equal(rows.length, 5);
  assert.ok(!Object.values(ctx.codes).some(c => JSON.stringify(book).includes(c)), 'no codes in the file');
  assert.deepEqual(book.sheets[2].rows[0], ['المجموعات', 'الكنايس', 'الخدام']);

  // edit like a servant would in Excel
  const at = id => rows.find(r => r[0] === id);
  at(ctx.mina.id)[1] = 'مينا عادل جرجس حنا';
  at(ctx.john.id)[5] = 'أ. بيتر سمير';
  at(ctx.fady.id)[4] = '-';
  rows.push(['', 'كيرلس سامح نبيل', '01012340009', 'مجموعة الكليات', '', 'أ. مارينا نبيل', '', '', '', '']);
  const path = `${SHOTS}edited.xlsx`;
  writeFileSync(path, writeXlsx({ sheets: [{ name: PEOPLE_SHEET, rows, textColumns: rows[0].map((_, i) => i) }] }));

  await jsClick('.view button.btn:not(.btn--primary):not(.btn--ghost)');
  await $('dialog.sheet[open] .import__file');
  await (await d.page.$('dialog.sheet[open] .import__file')).uploadFile(path);
  await d.page.waitForFunction(() => document.querySelector('dialog.sheet[open] .sheet__title')?.textContent === 'معاينة الأسماء', { timeout: 20000 });
  const kinds = await d.page.$eval('dialog.sheet[open] .comp-import__kinds', n => n.textContent);
  assert.match(kinds, /جديد ✓: ١/);
  assert.match(kinds, /هيتحدّث: ٣/);
  const row = id => d.page.$eval(`dialog.sheet[open] .import__row[data-line="${rows.findIndex(r => r[0] === id) + 1}"]`, n => ({ text: n.textContent, ticked: n.querySelector('.import__tick')?.checked }));
  const mina = await row(ctx.mina.id);
  assert.match(mina.text, /الاسم: مينا عادل جرجس ← مينا عادل جرجس حنا/);
  assert.equal(mina.ticked, true);
  assert.match((await row(ctx.fady.id)).text, /الكنيسة: مارجرجس ← \(هيتمسح\)/);
  assert.match((await row(ctx.john.id)).text, /الخادم المسؤول: \(فاضي\) ← أ. بيتر سمير/);
  await shot('02-roundtrip-preview');
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await d.page.waitForFunction(() => document.querySelector('dialog.sheet[open] .sheet__title')?.textContent === 'الاستيراد خلص ✓', { timeout: 20000 });
  const summary = await d.page.$eval('dialog.sheet[open] .import__summary', n => n.textContent);
  assert.match(summary, /اتسجل جديد: ١/);
  assert.match(summary, /اتحدّث: ٣/);

  const now = Object.fromEntries(gs.apiParticipants({ all: true }).items.map(p => [p.id, p]));
  assert.equal(Object.keys(now).length, 5, 'one new, no duplicates');
  assert.equal(now[ctx.mina.id].name, 'مينا عادل جرجس حنا');
  assert.equal(now[ctx.john.id].servant, 'أ. بيتر سمير');
  assert.equal(now[ctx.fady.id].church, '');
  for (const [id, code] of Object.entries(ctx.codes)) assert.equal(gs.apiParticipantCode(id).code, code, 'the code stays');
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
  assert.deepEqual(d.problems, []);

});

test('«تحديد» → «حدد الخادم المسؤول» for the ticked ones; the servant filter', async () => {

  await openPeople();
  await jsClick('[data-act="select"]');
  await $('.comp-person--pick');
  for (const id of [ctx.fady.id, ctx.mariam.id]) await d.page.$eval(`.comp-person--pick[data-id="${id}"] .import__tick`, n => n.click());
  assert.match(await d.page.$eval('.comp-select-bar__n', n => n.textContent), /محدد: ٢/);
  await shot('03-selecting');
  await jsClick('.comp-select-bar [data-act="assign"]');
  await $('dialog.sheet[open] input[list]');
  await d.page.$eval('dialog.sheet[open] input[list]', n => { n.value = 'أ. مارينا نبيل'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
  await d.page.waitForFunction(() => !document.getElementById('sheet').open, { timeout: 10000 });
  const now = Object.fromEntries(gs.apiParticipants({ all: true }).items.map(p => [p.id, p]));
  assert.equal(now[ctx.fady.id].servant, 'أ. مارينا نبيل');
  assert.equal(now[ctx.mariam.id].servant, 'أ. مارينا نبيل');
  // the servant filter (after the list reloads)
  await d.page.waitForFunction(() => [...document.querySelectorAll('select[aria-label="الخادم المسؤول"] option')].some(o => /أ. مارينا نبيل \(٣\)/.test(o.textContent)), { timeout: 10000 });
  await d.page.select('select[aria-label="الخادم المسؤول"]', 'أ. مارينا نبيل');
  await d.page.waitForFunction(() => document.querySelectorAll('.comp-person--pick').length === 3);
  await d.page.select('select[aria-label="الخادم المسؤول"]', '');
  assert.deepEqual(d.problems, []);

});

test('«توزيع الأكواد»: a zip of one file per servant (only their people, a ready message, the chat without the code); the grouped screen; nothing in browser storage', async () => {

  await openPeople();
  await jsClick('[data-act="distribute"]');
  await $('dialog.sheet[open] [data-bucket]');
  const names = await d.page.$$eval('dialog.sheet[open] [data-bucket]', n => n.map(b => b.dataset.bucket));
  assert.deepEqual(names, ['أ. بيتر سمير', 'أ. مارينا نبيل']);
  await shot('04-distribute');
  await d.page.click('dialog.sheet[open] [data-act="distribute-files"]');
  await d.page.waitForFunction(() => A.comp.lastDownload && /\.zip$/.test(A.comp.lastDownload.filename), { timeout: 15000 });
  const zip = await lastDownload();
  assert.match(zip.filename, /^توزيع-الأكواد-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = await unzip(zip.bytes);
  const fileNames = Object.keys(files).sort();
  assert.equal(fileNames.length, 2);
  const peter = await readXlsx(files[fileNames.find(f => /بيتر/.test(f))]);
  const sheet = peter.sheets[0].rows;
  assert.deepEqual(sheet.slice(1).map(r => r[0]).sort(), ['مينا عادل جرجس حنا', 'يوحنا مجدي سمير'].sort(), 'only his people');
  const mina = sheet.find(r => r[0] === 'مينا عادل جرجس حنا');
  assert.equal(mina[3], ctx.codes[ctx.mina.id]);
  assert.match(mina[4], new RegExp(ctx.codes[ctx.mina.id]));
  assert.match(mina[4], /points\//);
  assert.equal(mina[5], 'https://wa.me/201012340001');
  assert.ok(!JSON.stringify(peter).includes(ctx.codes[ctx.mariam.id]), 'another servant\'s code is not in his file');
  await $('dialog.modal[open]');
  assert.match(await d.page.$eval('dialog.modal[open]', n => n.textContent), /ابعت كل ملف للخادم بتاعه هو بس/);
  await d.page.$eval('dialog.modal[open] .btn--primary', n => n.click());
  await d.page.waitForFunction(() => !document.querySelector('dialog.modal[open]'), { timeout: 10000 });

  // the grouped screen
  await jsClick('dialog.sheet[open] [data-act="distribute-screen"]');
  await $('dialog.sheet[open] .comp-dist__bucket');
  assert.equal(await d.page.$$eval('dialog.sheet[open] .comp-dist__bucket', n => n.length), 2);
  assert.ok(await d.page.$$eval('dialog.sheet[open] .comp-code', n => n.every(c => c.textContent === 'ATH-••••-••••')), 'masked first');
  await d.page.$eval('dialog.sheet[open] .comp-dist__bucket[data-bucket="أ. بيتر سمير"] [data-act="copy-bucket"]', n => n.click());
  await d.page.waitForFunction(() => /أهلاً/.test(A.comp.lastCopied || ''));
  const copied = await d.page.evaluate(() => A.comp.lastCopied);
  assert.ok(copied.includes(ctx.codes[ctx.mina.id]) && copied.includes(ctx.codes[ctx.john.id]));
  assert.ok(!copied.includes(ctx.codes[ctx.mariam.id]), 'only that servant\'s messages');
  await shot('05-distribute-screen');
  const kept = await storage();
  assert.ok(!Object.values(ctx.codes).some(c => kept.includes(c)), 'no code in browser storage');
  // Activity: counts only
  const log = JSON.stringify(gs.apiActivity ? gs.apiActivity({}) : {});
  assert.ok(!Object.values(ctx.codes).some(c => log.includes(c)), 'no code in the activity log');
  await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
  assert.deepEqual(d.problems, []);

});

test('360px: the list with «تحديد», the export and distribution sheets — no sideways scroll', async () => {

  await d.page.setViewport(SMALL);
  try {
    await openPeople();
    await jsClick('[data-act="select"]');
    await $('.comp-select-bar');
    assert.ok(await overflow() <= 0, 'list + select bar');
    await shot('06-small-select');
    await jsClick('[data-act="distribute"]');
    await $('dialog.sheet[open] [data-bucket]');
    assert.ok(await overflow() <= 0, 'distribute');
    await shot('07-small-distribute');
    await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
    await jsClick('[data-act="export-data"]');
    await $('dialog.sheet[open] [data-act="export-go"]');
    assert.ok(await overflow() <= 0, 'export');
    await d.page.evaluate(() => { A.dirty = false; document.getElementById('sheet').close(); });
  }
  finally {
    await d.page.setViewport(DESKTOP);
  }
  assert.deepEqual(d.problems, []);

});
