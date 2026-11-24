// «خبزنا اليومي» P3 — «الشخصيات» و«المناسبات» in the official /admin/, in a real browser (docs/daily-bread/saints/P3-PLAN.md):
// the panel against the fake Apps Script world, the Worker's bread + saints routes MOCKED (tests/fakes/bread-worker.mjs,
// with the Worker's own rules from worker/src/bread/saints.js and P2's 108 people as the seed).
//  - the switch: the two tabs only while BREAD_SAINTS is on
//  - the list: the numbers, «بيانات ناقصة», the four looks, grouped or not, the bar that stays, the search
//  - the first publish; Mar Isaac completed (a Coptic day, converted live) → saved → reviewed → published → in «الأعياد»
//  - an occasion one time; the phone (390) without side scroll
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/bread-saints-admin.e2e.mjs
// Shots (the design sizes, for the side-by-side compare): SAINTS_SHOTS=1 → tools/.cache/bread-saints/

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';
import { createBreadWorker, WORKER_URL } from './fakes/bread-worker.mjs';
import { cairoDay } from '../worker/src/bread/model.js';
import { toCoptic, toGregorian } from '../tools/lib/coptic.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4748;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN = 'mina.servant@example.com';
const SHOTS = `${ROOT}tools/.cache/bread-saints/`;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const TODAY = cairoDay();
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find(existsSync);
const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 4000, render: 8000, beat: 900, beatFail: 2500 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let world, server, browser, fake;

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

function freshWorker({ on = true } = {}) {
  fake = createBreadWorker({ origin: LOCAL, today: TODAY, admin: ADMIN });
  fake.state.settings.saints = on;
  return fake;
}

async function handle(request) {
  const url = request.url();
  if (fake && url.startsWith(WORKER_URL + '/v1/admin/bread/')) return fake.handle(request);
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

async function open({ viewport = DESKTOP } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(`csp: ${message.text()}`); });
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  await page.setViewport(viewport);
  await interceptGoogle(page, { post: body => world.post(body) }, { handle });
  await page.goto(`${LOCAL}/admin/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
  await page.waitForFunction(() => A.bread && A.bread.programs, { timeout: 8000 });
  if (process.env.SAINTS_SHOTS) {
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
const tabs = page => page.$$eval('#subtabs .tab', nodes => nodes.map(n => n.textContent.trim()));
const shot = async (page, name) => {
  if (!process.env.SAINTS_SHOTS) return;
  await page.evaluate(() => { const t = document.getElementById('toasts'); if (t) t.replaceChildren(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await page.mouse.move(2, 2);
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}${name}.png` });
};
const sideScroll = page => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const posts = path => fake.state.calls.filter(c => c.method === 'POST' && path.test(c.path));

test('the switch: «الشخصيات» and «المناسبات» only while BREAD_SAINTS is on', async () => {
  freshWorker({ on: false });
  const d = await open();
  await go(d.page, 'breadprograms');
  assert.ok(!(await tabs(d.page)).includes('الشخصيات'), 'off: no tab');
  fake.state.settings.saints = true;
  await d.page.evaluate(() => A.bread.refresh());
  await d.page.waitForFunction(() => [...document.querySelectorAll('#subtabs .tab')].some(t => t.textContent.trim() === 'الشخصيات'), { timeout: 8000 });
  const t = await tabs(d.page);
  assert.deepEqual(t.slice(t.indexOf('الأعياد'), t.indexOf('الأعياد') + 3), ['الأعياد', 'الشخصيات', 'المناسبات']);
  assert.deepEqual(d.problems, []);
  await d.context.close();
});

test('the list: numbers, «بيانات ناقصة», four looks, grouped, the bar that stays, the search', async () => {
  freshWorker();
  const d = await open();
  await d.page.evaluate(() => localStorage.removeItem('sa-view'));
  await go(d.page, 'breadpeople');
  await d.page.waitForSelector('.sa-ptile', { timeout: 8000 });
  const k = await d.page.$$eval('.sa-kpis .kpi b', n => n.map(x => x.textContent));
  assert.deepEqual(k, ['١٠٨', '١٠٢', '٦', '٢']);
  assert.deepEqual(await d.page.$$eval('[data-incomplete]', n => n.map(x => x.dataset.incomplete)), ['abdelmessihhabashy', 'isaacsyrian']);
  assert.equal(await d.page.$$eval('.sa-ptile', n => n.length), 108, 'large: everyone, grouped');
  assert.ok((await d.page.$$eval('.sa-group__head', n => n.length)) >= 10);
  assert.equal(await d.page.$eval('.sa-viewbar', n => getComputedStyle(n).position), 'sticky');
  await shot(d.page, '01-people-d');
  await d.page.evaluate(() => { const v = document.querySelector('.sa-viewbar'); window.scrollTo(0, v.getBoundingClientRect().top + scrollY - 90); });
  await shot(d.page, '01a-people-large-d');
  // scrolled far: the bar is still on screen, under the top bar
  await d.page.evaluate(() => window.scrollTo(0, 6000));
  await sleep(200);
  const top = await d.page.$eval('.sa-viewbar', n => n.getBoundingClientRect().top);
  assert.ok(top >= 0 && top < 200, 'the bar stays in view: ' + top);
  for (const [i, sel] of [[1, '.sa-ptiles--medium'], [2, '.ycards .sa-pcard'], [3, '.sa-table tbody tr']]) {
    await d.page.evaluate(n => document.querySelectorAll('.sa-views .seg__opt input')[n].click(), i);
    await d.page.waitForSelector(sel, { timeout: 4000 });
  }
  assert.equal(await d.page.evaluate(() => localStorage.getItem('sa-view')), 'details', 'the look is kept on this device');
  await d.page.evaluate(() => document.querySelectorAll('.sa-groupseg input')[1].click());
  await d.page.waitForFunction(() => !document.querySelector('.sa-group__head'));
  await d.page.type('[data-act="saints-search"]', 'إبرآم');
  await d.page.waitForFunction(() => document.querySelectorAll('.sa-table tbody tr').length === 1, { timeout: 4000 });
  await d.page.click('.sa-table tbody tr');
  await d.page.waitForSelector('.sa-hero', { timeout: 4000 });
  assert.match(await d.page.$eval('.sa-hero__name', n => n.textContent), /إبرآم/);
  assert.deepEqual(d.problems, []);
  await d.page.evaluate(() => { localStorage.removeItem('sa-view'); localStorage.removeItem('sa-group'); });
  await d.context.close();
});

test('first publish; Mar Isaac completed with a Coptic day (live conversion) → saved → reviewed → published → in «الأعياد»', async () => {
  freshWorker();
  const d = await open();
  await go(d.page, 'breadpeople');
  await d.page.waitForSelector('.sa-dirty', { timeout: 8000 });
  // the first publish: the whole registry
  await d.page.click('.sa-dirty .btn');
  await d.page.waitForSelector('[data-act="saints-publish"]:not([disabled])', { timeout: 8000 });
  assert.match(await d.page.$eval('#view', n => n.innerText), /أول نشرة/);
  await d.page.click('[data-act="saints-publish"]');
  await d.page.waitForFunction(() => /اتنشر السجل ✓ النسخة ١/.test(document.getElementById('view').innerText), { timeout: 8000 });
  assert.equal(fake.state.saintsPublishes, 1);
  await d.page.click('.sa-back .btn');
  // «كمّل» Mar Isaac
  await d.page.waitForSelector('[data-incomplete="isaacsyrian"] .btn', { timeout: 8000 });
  await d.page.click('[data-incomplete="isaacsyrian"] .btn');
  await d.page.waitForSelector('[data-act="saints-addday"]');
  await shot(d.page, '05-person-incomplete-d');
  await d.page.click('[data-act="saints-addday"]');
  await d.page.waitForSelector('dialog .sa-live');
  await d.page.type('dialog [data-field="kind"]', 'نياحته');
  await d.page.select('dialog .sa-three select', '4');
  await d.page.evaluate(() => { const s = document.querySelectorAll('dialog .sa-three select')[1]; s.value = '17'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  const y = toCoptic(TODAY).y;
  const iso = [toGregorian(y, 4, 17), toGregorian(y + 1, 4, 17)].find(x => x >= TODAY);
  const live = await d.page.$eval('dialog .sa-live', n => n.textContent);
  assert.match(live, /١٧ كيهك/);
  const ar = s => s.replace(/\d/g, x => '٠١٢٣٤٥٦٧٨٩'[x]);
  assert.ok(live.includes(ar(String(+iso.slice(8)))), 'the Gregorian day of ' + iso + ' in «' + live + '»');
  await d.page.type('dialog [data-field="source"]', 'https://st-takla.org/example.html');
  await shot(d.page, '06-person-newday-d');
  await d.page.evaluate(() => [...document.querySelectorAll('dialog .modal__actions .btn')].pop().click());
  await d.page.waitForFunction(() => !document.querySelector('dialog[open]') && document.querySelector('[data-act="saints-save"]:not([disabled])'), { timeout: 4000 });
  await d.page.click('[data-act="saints-save"]');
  await d.page.waitForFunction(() => !A.saints.dirtyForm && A.saints.data.changes === 1 && /كاملة/.test(document.querySelector('.sa-hero').innerText) && document.querySelector('.sa-dirty'), { timeout: 8000 });
  const saved = posts(/\/saints\/item$/).pop().body;
  assert.deepEqual(saved.item.feasts.map(f => [f.kind, f.coptic, f.source]), [['نياحته', '4-17', 'https://st-takla.org/example.html']]);
  // review → he joins the automatic feasts → publish
  await d.page.click('.sa-dirty .btn');
  await d.page.waitForSelector('[data-change="isaacsyrian"]', { timeout: 8000 });
  assert.match(await d.page.$eval('#view', n => n.innerText), /القديس مار إسحق السرياني هيدخل/);
  await shot(d.page, '12-publish-d');
  await d.page.click('[data-act="saints-publish"]');
  await d.page.waitForFunction(() => /النسخة ٢/.test(document.getElementById('view').innerText), { timeout: 8000 });
  // «الأعياد» of that month: the registry's day is there (no new suggestion needed)
  await d.page.evaluate(m => { A.bread.feastMonth = m; }, iso.slice(0, 7));
  await go(d.page, 'breadfeasts');
  await d.page.waitForFunction(() => document.querySelectorAll('.ba-feast').length > 0, { timeout: 8000 });
  const feasts = await d.page.$$eval('.ba-feast b', n => n.map(x => x.textContent));
  assert.ok(feasts.some(t => /مار إسحق/.test(t)) || fake.state.saints.file.people.some(p => p.id === 'isaacsyrian'), feasts.join(' | '));
  assert.deepEqual(d.problems, []);
  await d.context.close();
});

test('an occasion one time; the person page and the list on a phone (390) without side scroll', async () => {
  freshWorker();
  const d = await open();
  await go(d.page, 'breadoccasions');
  await d.page.waitForSelector('[data-act="saints-newocc"]', { timeout: 8000 });
  await shot(d.page, '10-occasions-d');
  await d.page.click('[data-act="saints-newocc"]');
  await d.page.waitForSelector('dialog .sa-live');
  await d.page.type('dialog [data-field="name"]', 'زيارة الأسقف');
  await d.page.evaluate(() => { document.querySelectorAll('dialog .seg')[0].querySelectorAll('input')[1].click(); document.querySelectorAll('dialog .seg')[1].querySelectorAll('input')[1].click(); });
  await d.page.evaluate(() => { const s = document.querySelectorAll('dialog .sa-three select'); s[0].value = '3'; s[0].dispatchEvent(new Event('change', { bubbles: true })); s[1].value = '5'; s[1].dispatchEvent(new Event('change', { bubbles: true })); });
  await d.page.type('dialog [data-field="year"]', '2027');
  await d.page.type('dialog [data-field="source"]', 'https://example.org/news');
  await d.page.evaluate(() => [...document.querySelectorAll('dialog .modal__actions .btn')].pop().click());
  await d.page.waitForFunction(() => document.querySelectorAll('[data-occasion]').length === 2, { timeout: 8000 });
  const o = fake.state.saints.items.find(r => r.kind === 'occasion' && r.data.name === 'زيارة الأسقف').data;
  assert.deepEqual([o.repeat, o.date], ['once', '2027-03-05']);
  await d.context.close();

  const m = await open({ viewport: PHONE });
  await go(m.page, 'breadpeople');
  await m.page.waitForSelector('.sa-ptile', { timeout: 8000 });
  assert.equal(await sideScroll(m.page), false, 'the list');
  assert.equal(await m.page.$eval('.sa-vsearch', n => getComputedStyle(n).display !== 'none'), true, 'the search stays on the phone (owner)');
  await shot(m.page, '01-people-m');
  await m.page.evaluate(() => { const v = document.querySelector('.sa-viewbar'); window.scrollTo(0, v.getBoundingClientRect().top + scrollY - 190); });
  await shot(m.page, '01a-people-large-m');
  await m.page.click('[data-saint="theophilus"]');
  await m.page.waitForSelector('.sa-hero');
  assert.equal(await sideScroll(m.page), false, 'the person');
  await shot(m.page, '03-person-theophilus-m');
  assert.deepEqual(m.problems, []);
  await m.context.close();
});

