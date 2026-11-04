// «نقاطي» on the main page (content.json `points`, docs/COMPETITIONS.md §18.4)
// in headless Chrome. Since Phase 8 track P (owner, 2026-11-04) the home page
// has no «نقاطي والمتجر» card: only the top bar's star, which opens points/ in
// the same tab; a bell item with target `points`; nothing without `points`;
// axe, overflow and the star's touch target on phone and desktop. (The store's
// words from Cairo time stay tested in points.test.mjs.)
//
// Run: cd tools && node --test ../tests/points-widget.e2e.mjs

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { seedSession } from './fakes/comp-worker.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 4965;
const BASE = `http://localhost:${PORT}/`;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const NARROW = { width: 280, height: 653, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const PHONE = { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1 };
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

const SEED = JSON.parse(readFileSync(`${ROOT}content.json`, 'utf8'));
const SHOP = { on: true, mode: 'auto', opensAt: '2026-10-17T19:00', closesAt: '2026-10-22T20:00' };
const SEASON = { name: 'موسم الخريف', startAt: '2026-10-01T00:00', endAt: '2026-10-20T00:00' };

// the server's clock (Cairo is UTC+3 until the end of October 2026)
const TUESDAY_NOON = 'Tue, 13 Oct 2026 09:00:00 GMT';      // 2026-10-13T12:00 Cairo
const SATURDAY_OPEN = 'Sat, 17 Oct 2026 16:00:20 GMT';     // 2026-10-17T19:00 Cairo

const world = (extra = {}) => ({
  ...SEED,
  points: { url: 'points/', shop: SHOP, season: SEASON },
  notifications: [{ id: 'notif-shop-open', type: 'general', title: 'المتجر فتح!', message: 'اطلب جايزتك بنقاطك', publishAt: '2026-10-10T19:00', expireAt: '', target: { kind: 'points' } }],
  ...extra
});

let server;
let browser;

test.before(async () => {
  server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT)], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  server?.kill();
});


/* content.json comes from `state` (body + the server's Date header), so a test can move the world and the clock */
async function open(viewport, state, { bypassCSP = false } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const requests = [];

  page.on('console', msg => { if (msg.type() === 'error') problems.push(`console: ${msg.text()}`); });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  await page.evaluateOnNewDocument(() => document.addEventListener('securitypolicyviolation', e => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)));
  // signed in: points/ stays put; signed out it goes on to /account/ (comp-accounts.e2e.mjs)
  await seedSession(page);
  // no opening intro (first visit of the session): straight to the page
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (bypassCSP) await page.setBypassCSP(true);
  await page.setViewport(viewport);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    requests.push(url.pathname);
    if (url.pathname === '/content.json' && state) {
      return request.respond({ status: 200, contentType: 'application/json', headers: { Date: state.date }, body: JSON.stringify(state.content) });
    }
    if (url.hostname !== 'localhost') return request.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' }, body: '' });
    return request.continue();
  });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('main[data-state="ready"]', { timeout: 8000 });

  return { context, page, problems, requests };

}

const textOf = (page, selector) => page.$eval(selector, el => el.textContent.trim());


test('no `points` in content.json: no widget, no top-bar entry, no points.js request', async () => {
  // the repo's content.json without its points block (the live one may have one now)
  const repo = JSON.parse(readFileSync(new URL('../content.json', import.meta.url), 'utf8'));
  delete repo.points;
  const { context, page, problems, requests } = await open(PHONE, { content: repo, date: new Date().toUTCString() });
  assert.equal(await page.$('[data-area="points"]'), null);
  assert.equal(await page.$('#points-link:not([hidden])'), null);
  assert.ok(!requests.some(path => path.endsWith('/points.js')), 'the module is not loaded');
  assert.deepEqual(problems, []);
  await context.close();
});


test('the home page has no «نقاطي والمتجر» card (owner, Phase 8 track P): the top star stays and opens points/', async () => {

  const { context, page, problems, requests } = await open(PHONE, { content: world(), date: TUESDAY_NOON });
  assert.equal(await page.$('[data-area="points"]'), null, 'no card in the page');
  assert.equal(await page.$('.points'), null);
  assert.ok(!requests.some(path => path.endsWith('/assets/js/points.js')), 'the card\'s module is not loaded');
  assert.deepEqual(await page.$eval('#points-link', a => [a.getAttribute('href'), a.hidden]), ['points/', false]);
  await Promise.all([page.waitForNavigation(), page.click('#points-link')]);
  assert.equal(new URL(page.url()).pathname, '/points/');
  assert.deepEqual(problems, []);
  await context.close();

});


test('top bar «نقاطي» and a bell item with target points: same tab, points/', async () => {

  const { context, page, problems } = await open(PHONE, { content: world(), date: TUESDAY_NOON });
  assert.deepEqual(await page.$eval('#points-link', a => [a.getAttribute('href'), a.getAttribute('aria-label'), a.hidden, a.getAttribute('target')]), ['points/', 'نقاطي', false, null]);

  await page.click('#bell');
  await page.waitForSelector('dialog.sheet--panel[open]');
  const row = await page.$eval('.note-item[data-points]', a => ({ tag: a.tagName, href: a.getAttribute('href'), target: a.getAttribute('target'), text: a.textContent }));
  assert.equal(row.tag, 'A');
  assert.equal(row.href, 'points/');
  assert.equal(row.target, null);
  assert.match(row.text, /المتجر فتح!/);
  await Promise.all([page.waitForNavigation(), page.click('.note-item[data-points]')]);
  assert.equal(new URL(page.url()).pathname, '/points/');
  assert.deepEqual(problems, []);
  await context.close();

});


test('axe phone + desktop; no horizontal scroll at 280 / 360 / 1280; the star is a full touch target', async () => {

  for (const [name, viewport] of Object.entries({ narrow: NARROW, phone: PHONE, desktop: DESKTOP })) {
    for (const shop of [SHOP, null]) {
      const { context, page, problems } = await open(viewport, { content: world({ points: { url: 'points/', shop, season: SEASON } }), date: TUESDAY_NOON }, { bypassCSP: name !== 'narrow' });
      await page.waitForSelector('#points-link:not([hidden])');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 0, `${name}: horizontal overflow ${overflow}px`);
      const box = await page.$eval('#points-link', el => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
      assert.ok(box[0] >= 40 && box[1] >= 40, `${name}: ${JSON.stringify(box)}`);
      if (name !== 'narrow') {
        await page.evaluate(AXE);
        const results = await page.evaluate(tags => axe.run(document, { runOnly: { type: 'tag', values: tags } }), AXE_TAGS);
        assert.deepEqual(results.violations.map(v => `${name} ${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`), []);
      }
      else {
        assert.deepEqual(problems, [], 'no console errors / CSP violations');
      }
      await context.close();
    }
  }

});


test('Phase 8 (§22.1 item 11): a news item with an icon and no poster shows the branded tile, on its card and in its sheet', async () => {
  const base = (SEED.news && SEED.news[0]) || {};
  const item = { ...base, id: 'news-icon0001', title: 'رحلة الغردقة', summary: 'سجّل اسمك قبل الخميس', body: 'التفاصيل هنا', image: null, icon: 'bus', publishAt: '2026-10-01T10:00', expireAt: '', featured: false, pinned: false };
  const { context, page, problems } = await open(PHONE, { content: world({ news: [item] }), date: TUESDAY_NOON });
  await page.waitForSelector('[data-area="news"]', { timeout: 8000 });
  const tile = await page.evaluate(() => {
    const t = document.querySelector('[data-area="news"] .art--chosen');
    if (!t) return null;
    const use = t.querySelector('.art__icon');
    return { tile: true, icon: use ? (use.getAttribute('data-icon') || use.outerHTML.length) : null, img: !!t.closest('[data-area="news"]').querySelector('img.news-card__img, .news-card__media img') };
  });
  assert.ok(tile && tile.tile, 'the chosen icon stands where the poster would');
  assert.equal(tile.img, false, 'no picture in its place');
  const section = await page.$('[data-area="news"]');
  await section.scrollIntoView();
  await section.screenshot({ path: `${ROOT}tools/.cache/comp/news-icon-tile.png` });
  assert.deepEqual(problems, []);
  await context.close();
});
