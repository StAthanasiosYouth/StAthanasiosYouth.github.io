// «الصفحات والفعاليات» in the admin, in a real browser: the official /admin/
// against the real .gs code (Pages.gs) in a fake Apps Script world, then the
// published files served like GitHub Pages would (the fake commit overlaid
// on the repository).
//  - «الخدام»: a servant with consent to show his WhatsApp
//  - «صفحات الخدمة»: a page with a cover from the library, its video card
//    (library clip), its home card in «خدماتنا»; the card read-only in
//    «كروت خدماتنا»; hiding it there unticks the page's own setting
//  - «الفعاليات»: an event with booking prices and a servant; its card
//  - «رتّب الكروت»: the order sheet changes the home order
//  - the preview frame (pages/index.html?preview) shows the draft
//  - publish → /black-theatre/, /events/<slug>/ and the home page's cards
//  - 360px: no sideways scroll on any of the new screens and editors
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/pages-admin.e2e.mjs

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4691;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN = 'menazakmena@gmail.com';
const SHOTS = `${ROOT}tools/.cache/pages-admin/`;
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

const webp = fill => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(40, fill)]);
const mp4 = fill => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(52, fill)]);
const plain = value => JSON.parse(JSON.stringify(value));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.ics': 'text/calendar', '.webmanifest': 'application/manifest+json' };

let world;
let gs;
let admin;
let site;
let browser;
let d;
const media = {};

/* the public site as GitHub Pages serves it: the fake repository's files over the working tree */
function createPublicServer() {
  return createServer((req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const key = (path.endsWith('/') ? path + 'index.html' : path).replace(/^\//, '');
      const committed = world.github.files()[key];
      if (typeof committed === 'string') {
        res.writeHead(200, { 'Content-Type': TYPES[extname(key)] || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(committed);
        return;
      }
      const file = normalize(join(ROOT, key));
      if (!file.startsWith(normalize(ROOT)) || !statSync(file).isFile()) throw new Error('404');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(readFileSync(file));
    }
    catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404');
    }
  });
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
  world.gs.SESSION_STALE_SECONDS = 0;
  gs = world.as(ADMIN).gs;
  const first = plain(gs.apiReview());
  gs.apiPublish(first.revision);
  media.cover = plain(gs.apiUploadMedia({ full: webp(7).toString('base64'), thumb: webp(7).toString('base64'), mime: 'image/webp', width: 1280, height: 720, alt: 'غلاف المسرح' })).media;
  media.card = plain(gs.apiUploadMedia({ full: webp(8).toString('base64'), thumb: webp(8).toString('base64'), mime: 'image/webp', width: 1280, height: 720, alt: 'عرض الكريسماس' })).media;
  media.clip = plain(gs.apiUploadMedia({ kind: 'video', video: mp4(3).toString('base64'), mime: 'video/mp4', poster: webp(9).toString('base64'), posterMime: 'image/webp',
    tiny: webp(9).toString('base64'), tinyMime: 'image/webp', color: '#224466', name: 'عرض', width: 854, height: 480, duration: 30, alt: 'مقطع من العرض' })).media;
  world.as('');

  admin = createSiteServer({
    world: { issueToken: c => world.issueToken(c), get github() { return world.github; } },
    config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK, timing: TIMING }),
    claims: () => ({ email: ADMIN })
  });
  await new Promise(resolve => admin.listen(PORT, '127.0.0.1', resolve));
  site = createPublicServer();
  await new Promise(resolve => site.listen(PORT + 1, '127.0.0.1', resolve));
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
  await new Promise(resolve => (admin ? admin.close(resolve) : resolve()));
  await new Promise(resolve => (site ? site.close(resolve) : resolve()));
});

const shot = async (name, page = d.page) => { await sleep(400); await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: false }); };
const $ = (selector, page = d.page) => page.waitForSelector(selector, { timeout: 10000 });
const idle = () => d.page.waitForNetworkIdle({ idleTime: 350, timeout: 15000 }).catch(() => {});

async function clickText(selector, words, page = d.page) {
  await page.waitForFunction((s, w) => [...document.querySelectorAll(s)].some(e => e.offsetParent !== null && e.textContent.includes(w) && !e.disabled), { timeout: 10000 }, selector, words);
  await page.evaluate((s, w) => [...document.querySelectorAll(s)].find(e => e.offsetParent !== null && e.textContent.includes(w) && !e.disabled).click(), selector, words);
}

async function setField(label, value, scope = 'dialog.sheet[open]') {
  await d.page.waitForSelector(`${scope} .field[data-label="${label}"]`, { timeout: 10000 });
  await d.page.$eval(`${scope} .field[data-label="${label}"] input, ${scope} .field[data-label="${label}"] textarea`, (n, v) => {
    n.value = v;
    n.dispatchEvent(new Event('input', { bubbles: true }));
    n.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/* «من المكتبة» of the first image picker in scope, or of the one whose label is `label` */
async function pickImage(scopeSelector, label = '') {
  await d.page.evaluate((s, l) => {
    const labelOf = p => ((p.parentElement && p.parentElement.querySelector(':scope > .field__label')) || {}).textContent;
    const pickers = [...document.querySelectorAll(s)].filter(p => !l || labelOf(p) === l);
    if (!pickers.length) throw new Error('no picker labelled ' + l);
    [...pickers[0].querySelectorAll('button')].find(b => b.textContent.includes('من المكتبة')).click();
  }, scopeSelector, label);
  await $('dialog.picker-dialog[open] .media-tile');
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.picker-dialog[open] .media-tile')].find(t => !t.classList.contains('is-video')).click());
  await d.page.waitForFunction(() => !document.querySelector('dialog.picker-dialog'));
}

const sheetGone = () => d.page.waitForFunction(() => !document.querySelector('dialog.sheet[open]'), { timeout: 10000 });
const saveSheet = () => d.page.click('dialog.sheet[open] .sheet__foot .btn--primary');
const OVERFLOW = () => {
  const root = document.documentElement;
  const issues = [];
  if (root.scrollWidth > root.clientWidth) issues.push(`page ${root.scrollWidth} > ${root.clientWidth}`);
  for (const node of document.querySelectorAll('dialog[open], dialog[open] .sheet__body, .view, .card')) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1) issues.push(`${node.className || node.tagName} scrolls sideways`);
  }
  for (const node of document.querySelectorAll('#view *, .topbar *, dialog[open] *')) {
    const r = node.getBoundingClientRect();
    if (!r.width || node.closest('.tabs')) continue;
    if (r.right > root.clientWidth + 1 || r.left < -1) issues.push(`${node.tagName.toLowerCase()}.${String(node.className.baseVal ?? node.className).trim().split(/\s+/).join('.')}`);
  }
  return issues.slice(0, 6);
};


test('«الخدام»: a servant with his WhatsApp shown (by consent), and the payment methods', async () => {
  await d.page.evaluate(() => A.go('pages', 'servants'));
  await $('.view .empty-state');
  await clickText('.view button', 'خادم جديد');
  await setField('الاسم', 'مينا عادل');
  await setField('رقم الموبايل', '01012345678');
  await setField('الدور', 'مسؤول الفريق');
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .check')].find(c => c.textContent.includes('رقمه يظهر')).querySelector('input').click());
  await saveSheet();
  await sheetGone();
  await d.page.waitForFunction(() => /مينا عادل/.test(document.querySelector('.view').textContent), { timeout: 10000 });
  const servants = plain(world.as(ADMIN).gs.apiServants()).servants;
  assert.equal(servants.length, 1);
  assert.equal(servants[0].phone, '+201012345678');
  assert.equal(servants[0].publicWa, true);
  assert.match(await d.page.$eval('.view', n => n.textContent), /إنستاباي/, 'the seeded payment methods are listed');
  await shot('01-servants');
});

test('«صفحات الخدمة»: a new page with its cover, its video card; one card in «خدماتنا», read-only there', async () => {
  await d.page.evaluate(() => A.go('pages', 'svcpages'));
  await $('.view .empty-state');
  await clickText('.view button', 'صفحة جديدة');
  await setField('الرابط', 'black-theatre');
  await setField('العنوان', 'المسرح الأسود');
  await setField('السطر القصير', 'عروض بالنور والضلمة');
  await setField('الوصف', 'فريق المسرح الأسود بيقدم عروض بالإضاءة فوق البنفسجي.');
  await setField('رسالة الواتساب', 'عايز انضم لفريق المسرح الأسود');
  await pickImage('dialog.sheet[open] .picker');
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .pages-team .check')][0].querySelector('input').click());
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .check')].find(c => c.textContent.includes('بإشراف Brave Under Grace')).querySelector('input').click());
  const homeChecked = await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .pages-home .check input')][0].checked);
  assert.equal(homeChecked, true, '«إظهار في الصفحة الرئيسية» is on for a new page');
  await shot('02-page-editor');
  await saveSheet();

  // straight into its video cards
  await d.page.waitForFunction(() => /كروت الفيديو/.test(document.querySelector('dialog.sheet[open] .sheet__title')?.textContent || ''), { timeout: 10000 });
  await clickText('dialog.sheet[open] button', 'كارت جديد');
  // the card's own labels: never mixed up with the page's banner / cover
  const labels = await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] legend, dialog.sheet[open] .field__label')].map(n => n.textContent.trim()));
  for (const want of ['١. المقطع اللي بيشتغل جوه الصفحة', '٢. صورة الكارت', '٣. العنوان والوصف', '٤. الفيديو الكامل', 'مقطع العرض جوه الصفحة', 'أو ارفع فيديو جديد وقصّه', 'صورة الكارت', 'عنوان الفيديو', 'وصف قصير', 'لينك الفيديو الكامل', 'نص زرار الفيديو الكامل']) {
    assert.ok(labels.some(t => t.startsWith(want)), want + ' in ' + labels.join(' | '));
  }
  await setField('عنوان الفيديو', 'عرض الكريسماس');
  await setField('وصف قصير', 'أول عرض للفريق');
  await setField('لينك الفيديو الكامل', 'https://www.youtube.com/watch?v=abc');
  await pickImage('dialog.sheet[open] .picker', 'صورة الكارت');
  await shot('03a-card-editor');
  await d.page.$eval('dialog.sheet[open] .sheet__body', n => { n.scrollTop = n.scrollHeight; });
  await shot('03b-card-editor-end');
  await d.page.$eval('dialog.sheet[open] .sheet__body', n => { n.scrollTop = 0; });
  assert.match(await d.page.$eval('dialog.sheet[open] .gallery-picker', n => n.textContent), /لسه مفيش مقطع/, 'the card has its own empty words');
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .gallery-picker button')].find(b => b.textContent.includes('اختار مقطع من المكتبة')).click());
  await $('dialog.picker-dialog[open] .media-tile.is-video');
  await d.page.evaluate(() => document.querySelector('dialog.picker-dialog[open] .media-tile.is-video').click());
  await d.page.waitForFunction(() => !document.querySelector('dialog.picker-dialog'));
  await saveSheet();
  await d.page.waitForFunction(() => /كروت الفيديو/.test(document.querySelector('dialog.sheet[open] .sheet__title')?.textContent || '') && document.querySelectorAll('dialog.sheet[open] .list .item').length === 1, { timeout: 10000 });
  await shot('03-video-cards');
  await d.page.evaluate(() => A.closeSheet());
  await sheetGone();

  const pages = plain(world.as(ADMIN).gs.apiPages()).pages;
  assert.equal(pages.length, 1);
  assert.equal(pages[0].slug, 'black-theatre');
  assert.ok([media.cover.id, media.card.id].includes(pages[0].cover), 'a library picture');
  assert.equal(pages[0].clipCount, 1);
  assert.equal(pages[0].partner, 'bug', '«بإشراف B.U.G.»');
  const cards = plain(world.as(ADMIN).gs.readOptionalTable_('Activities')).filter(a => a.page === pages[0].id);
  assert.equal(cards.length, 1, 'one home card');
  assert.equal(cards[0].type, 'service');

  // the list says it: published? no; on the home page: yes
  await d.page.waitForFunction(() => /ظاهر في الرئيسية/.test(document.querySelector('.view').textContent), { timeout: 10000 });

  // «كروت خدماتنا»: the card is there, linked (no delete, no editor of its own)
  await d.page.evaluate(() => A.go('content', 'services'));
  await d.page.waitForFunction(() => document.querySelector('.view .item--linked'), { timeout: 10000 });
  assert.match(await d.page.$eval('.view .item--linked', n => n.textContent), /بيتعدل من صفحة الخدمة/);
  assert.equal(await d.page.$$eval('.view .item--linked .icon-btn--danger', l => l.length), 0, 'no delete');
  await shot('04-services-cards');

  // switching the card off there: the page's own «إظهار» follows
  await d.page.evaluate(() => document.querySelector('.view .item--linked .switch input, .view .item--linked input[type=checkbox]').click());
  await idle();
  await d.page.waitForFunction(id => {
    const card = (A.state.draft.activities || []).find(a => a.page === id);
    return card && !A.bool(card.enabled);
  }, { timeout: 10000 }, pages[0].id);
  assert.equal(plain(world.as(ADMIN).gs.apiPage(pages[0].id)).page.home.show, false);
  // and back on
  await d.page.evaluate(() => document.querySelector('.view .item--linked .switch input, .view .item--linked input[type=checkbox]').click());
  await idle();
  await d.page.waitForFunction(() => { const c = (A.state.draft.activities || []).find(a => a.page); return c && A.bool(c.enabled); }, { timeout: 10000 });
  assert.equal(plain(world.as(ADMIN).gs.apiPage(pages[0].id)).page.home.show, true);
});

test('«تعديل» opens the page editor at once from the list (the full copy follows; a slow server never holds the sheet)', async () => {
  await d.page.evaluate(() => A.go('pages', 'svcpages'));
  await d.page.waitForFunction(() => document.querySelector('.view .item [aria-label^="تعديل"]'), { timeout: 10000 });
  // the server answers apiPage 3 s late from here on
  await d.page.evaluate(() => {
    const call = A.call;
    window.__apiPageCalls = 0;
    A.call = function (fn) {
      if (fn === 'apiPage') {
        window.__apiPageCalls++;
        const answer = call.apply(A, arguments);
        return new Promise(resolve => setTimeout(resolve, 3000)).then(() => answer);
      }
      return call.apply(A, arguments);
    };
    window.__restoreCall = () => { A.call = call; };
  });
  const opened = await d.page.evaluate(() => new Promise(resolve => {
    const t0 = performance.now();
    document.querySelector('.view .item [aria-label^="تعديل"]').click();
    const check = () => {
      const input = document.querySelector('dialog.sheet[open] .field[data-label="العنوان"] input');
      if (input && input.value) resolve({ ms: performance.now() - t0, title: input.value });
      else if (performance.now() - t0 > 6000) resolve({ ms: Infinity, title: '' });
      else requestAnimationFrame(check);
    };
    check();
  }));
  assert.ok(opened.ms < 400, `the sheet was open and filled after ${Math.round(opened.ms)} ms`);
  assert.equal(opened.title, 'المسرح الأسود');
  assert.equal(await d.page.evaluate(() => window.__apiPageCalls), 1, 'one background request, not one per field');
  // «كروت الفيديو» waits for that same request (no second one), then shows the cards
  await clickText('dialog.sheet[open] button', 'كروت الفيديو');
  await d.page.waitForFunction(() => /كروت الفيديو/.test(document.querySelector('dialog.sheet[open] .sheet__title')?.textContent || '') && document.querySelectorAll('dialog.sheet[open] .list .item').length === 1, { timeout: 8000 });
  assert.equal(await d.page.evaluate(() => window.__apiPageCalls), 1, 'the video cards reused the request already on its way');
  await d.page.evaluate(() => { window.__restoreCall(); A.dirty = false; return A.closeSheet(); });
  await sheetGone();
});

test('«الفعاليات»: a trip with prices and a servant; its card in «الفعاليات»', async () => {
  await d.page.evaluate(() => A.go('pages', 'events'));
  await $('.view .empty-state');
  await clickText('.view button', 'فعالية جديدة');
  await setField('العنوان', 'رحلة إسكندرية');
  await setField('الرابط', 'alex-trip');
  await setField('الملخص', 'يوم على البحر');
  await setField('المكان', 'إسكندرية');
  const day = await d.page.evaluate(() => A.nextWeekday(5, '07:00'));
  await d.page.$eval('dialog.sheet[open] .field[data-label="بتبدأ"] input[type=date]', (n, v) => { n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); }, day.slice(0, 10));
  await d.page.$eval('dialog.sheet[open] .field[data-label="بتبدأ"] input[type=time]', n => { n.value = '07:00'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await d.page.$eval('dialog.sheet[open] .field[data-label="بتخلص"] input[type=date]', (n, v) => { n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); }, day.slice(0, 10));
  await d.page.$eval('dialog.sheet[open] .field[data-label="بتخلص"] input[type=time]', n => { n.value = '22:00'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await pickImage('dialog.sheet[open] .picker');
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .check')].find(c => c.textContent.includes('فيه حجز')).querySelector('input').click());
  await d.page.$eval('dialog.sheet[open] .field[data-label="العدد المتاح"] input', n => { n.value = '50'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await d.page.$eval('dialog.sheet[open] .field[data-label="السعر"] input', n => { n.value = '1500'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .pages-servant .check')][0].querySelector('input').click());
  await shot('05-event-editor');
  await saveSheet();
  await sheetGone();
  await d.page.waitForFunction(() => /رحلة إسكندرية/.test(document.querySelector('.view').textContent), { timeout: 10000 });

  const events = plain(world.as(ADMIN).gs.apiEvents()).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'trip');
  assert.equal(events[0].booking.capacity, 50);
  assert.equal(events[0].booking.pricing.categories[0].price, 1500);
  assert.deepEqual(events[0].servants.map(s => s.methods), [['cash']], 'cash is ticked by default');
  const card = plain(world.as(ADMIN).gs.readOptionalTable_('Activities')).find(a => a.event === events[0].id);
  assert.ok(card && card.enabled, 'its home card');
  assert.equal(card.location, 'إسكندرية');
  assert.ok(card.visibleUntil, 'it ends 12 h after the trip');
  await shot('06-events');
});

test('«رتّب الكروت»: the order sheet moves a card up and saves the home order', async () => {
  // a plain activity card next to the event's
  world.as(ADMIN).gs.apiSaveItem('activities', { type: 'trip', title: 'مسرحية العيد', enabled: true });
  world.as('');
  await d.page.evaluate(() => A.call('apiState').then(s => A.applyState(s)));
  await d.page.evaluate(() => A.go('pages', 'events'));
  await clickText('.view button', 'ترتيب كروت «الفعاليات»');
  await $('dialog.sheet[open] .pages-order');
  const before = await d.page.$$eval('dialog.sheet[open] .pages-order .item__title', l => l.map(n => n.textContent));
  assert.equal(before.length, 2);
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .pages-order .item')][1].querySelector('.icon-btn').click());
  const after = await d.page.$$eval('dialog.sheet[open] .pages-order .item__title', l => l.map(n => n.textContent.replace(/^[٠-٩]+\. /, '')));
  assert.equal(after[0], before[1].replace(/^[٠-٩]+\. /, ''));
  await shot('07-order');
  await saveSheet();
  await sheetGone();
  const rows = plain(world.as(ADMIN).gs.readOptionalTable_('Activities')).filter(a => a.type === 'trip').sort((a, b) => Number(a.order) - Number(b.order));
  assert.equal(rows[0].title, after[0]);
});

test('the preview frame shows the draft page (not published yet)', async () => {
  await d.page.evaluate(() => A.go('pages', 'svcpages'));
  await d.page.waitForFunction(() => document.querySelector('.view .item [aria-label^="معاينة"]'), { timeout: 10000 });
  await d.page.evaluate(() => document.querySelector('.view .item [aria-label^="معاينة"]').click());
  await $('dialog.sheet[open] iframe.comp-preview__frame');
  await d.page.waitForFunction(() => /دي شكل الصفحة من المسودة/.test(document.querySelector('dialog.sheet[open] .preview-status')?.textContent || ''), { timeout: 15000 });
  const frame = d.page.frames().find(f => /pages\/index\.html\?preview/.test(f.url()));
  assert.ok(frame, 'the preview frame');
  await frame.waitForFunction(() => /المسرح الأسود/.test(document.body.textContent), { timeout: 10000 });
  await shot('08-preview');
  await d.page.evaluate(() => A.closeSheet());
  await sheetGone();
});

test('publish → /black-theatre/, /events/alex-trip/ and the home page\'s cards, served like GitHub Pages', async () => {
  // the shell is in the repository (deployed with the code) before any page is published
  world.github.pushOther('pages/index.html', readFileSync(`${ROOT}pages/index.html`, 'utf8'));
  const g = world.as(ADMIN).gs;
  const review = plain(g.apiReview());
  assert.deepEqual(review.errors, []);
  g.apiPublish(review.revision);
  world.as('');
  const files = world.github.files();
  assert.ok(files['black-theatre/index.html'] && files['black-theatre/page.json']);
  assert.ok(files['events/alex-trip/index.html'] && files['events/alex-trip/event.json']);

  const pub = await d.context.newPage();
  const problems = [];
  pub.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  pub.on('console', message => { if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(`csp: ${message.text()}`); });
  await pub.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const PUB = `http://127.0.0.1:${PORT + 1}`;

  await pub.goto(`${PUB}/black-theatre/`, { waitUntil: 'networkidle0' });
  await pub.waitForFunction(() => /المسرح الأسود/.test(document.body.textContent) && /عرض الكريسماس/.test(document.body.textContent), { timeout: 15000 });
  assert.equal(await pub.evaluate(() => document.documentElement.dataset.partner), 'bug');
  // the quiet co-brand line under the title, its two marks drawn
  await pub.waitForFunction(() => [...document.querySelectorAll('.cobrand img')].length === 2 && [...document.querySelectorAll('.cobrand img')].every(i => i.complete && i.naturalWidth > 0), { timeout: 10000 });
  await pub.waitForFunction(() => !document.querySelector('.collab'), { timeout: 4000 }).catch(() => {});
  await shot('09-public-page', pub);

  await pub.goto(`${PUB}/events/alex-trip/`, { waitUntil: 'networkidle0' });
  await pub.waitForFunction(() => /رحلة إسكندرية/.test(document.body.textContent), { timeout: 15000 });
  assert.ok(await pub.evaluate(() => [...document.querySelectorAll('a[href^="https://wa.me/201012345678"]')].length > 0), 'the servant\'s WhatsApp');
  await shot('10-public-event', pub);

  await pub.goto(`${PUB}/index.html`, { waitUntil: 'networkidle0' });
  await pub.waitForFunction(() => document.querySelector('a[href$="black-theatre/"]') && document.querySelector('a[href$="events/alex-trip/"]'), { timeout: 15000 });
  const links = await pub.evaluate(() => {
    const all = sel => [...document.querySelectorAll(sel)];
    return {
      page: all('a[href$="black-theatre/"]').map(a => a.textContent.trim()).join(' | '),
      event: all('a[href$="events/alex-trip/"]').map(a => a.textContent.trim()).join(' | '),
      target: all('a[href$="black-theatre/"]').map(a => a.target).join('')
    };
  });
  assert.match(links.page, /شاهد/);
  assert.match(links.event, /احجز الآن|اعرف التفاصيل/);
  assert.notEqual(links.target, '_blank', 'same tab');
  await pub.evaluate(() => document.querySelector('a[href$="black-theatre/"]').scrollIntoView({ block: 'center' }));
  await shot('11-public-home', pub);
  assert.deepEqual(problems, []);
  await pub.close();
});

test('360px: the new screens and editors never scroll sideways', async () => {
  await d.page.setViewport(SMALL);
  await sleep(300);
  // eight areas in the dock: every word still fits
  const dock = await d.page.$$eval('#dock .dockbtn', list => list.map(b => {
    const label = b.querySelector('.dockbtn__label');
    return { text: label.textContent, overflow: label.scrollWidth > label.clientWidth + 1, size: parseFloat(getComputedStyle(label).fontSize) };
  }));
  assert.equal(dock.length, 8);
  assert.ok(dock.every(b => !b.overflow), 'dock labels fit: ' + JSON.stringify(dock));
  assert.ok(dock.every(b => b.size >= 9), 'readable: ' + JSON.stringify(dock));
  await shot('00-dock-360');
  for (const sub of ['svcpages', 'events', 'servants']) {
    await d.page.evaluate(s => A.go('pages', s), sub);
    await idle();
    await sleep(500);
    assert.deepEqual(await d.page.evaluate(OVERFLOW), [], sub);
  }
  await d.page.evaluate(() => A.go('pages', 'events'));
  await clickText('.view button', 'فعالية جديدة');
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .check')].find(c => c.textContent.includes('فيه حجز')).querySelector('input').click());
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .choice input')].find(i => i.value === 'group').click());
  await d.page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] button')].find(b => b.textContent.includes('فئة سعر')).click());
  await sleep(400);
  assert.deepEqual(await d.page.evaluate(OVERFLOW), [], 'event editor with prices');
  await shot('12-event-editor-360');
  await d.page.evaluate(() => { A.dirty = false; return A.closeSheet(); });
  await d.page.evaluate(() => A.go('content', 'services'));
  await sleep(500);
  assert.deepEqual(await d.page.evaluate(OVERFLOW), [], 'كروت خدماتنا');
  await d.page.setViewport(DESKTOP);
  assert.deepEqual(d.problems, []);
});
