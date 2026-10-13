// «نقاطي / المتجر» on the main page (content.json `points`, docs/COMPETITIONS.md
// §18.4) in headless Chrome: no widget without `points`; the widget's states
// from Cairo time (the server's Date header corrects the device's clock);
// a clock change and a world change while the page is open; its place in the
// layout; tap → points/ in the same tab; the top-bar entry; a bell item with
// target `points`; axe, overflow and touch targets on phone and desktop.
//
// Run: cd tools && node --test ../tests/points-widget.e2e.mjs

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';

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
    if (url.hostname !== 'localhost') return request.respond({ status: 204, body: '' });
    return request.continue();
  });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('main[data-state="ready"]', { timeout: 8000 });

  return { context, page, problems, requests };

}

const textOf = (page, selector) => page.$eval(selector, el => el.textContent.trim());
const words = page => page.$eval('.points', el => ({
  shop: el.dataset.shop,
  title: el.querySelector('.points__title').textContent.trim(),
  headline: el.querySelector('.points__headline').textContent.trim(),
  detail: el.querySelector('.points__detail').hidden ? '' : el.querySelector('.points__detail').textContent.trim(),
  season: el.querySelector('.points__season').hidden ? '' : el.querySelector('.points__season').textContent.trim()
}));
const waitHeadline = (page, pattern) => page.waitForFunction(p => new RegExp(p).test(document.querySelector('.points__headline')?.textContent || ''), { timeout: 8000 }, pattern.source);
// the page's own refresh (a tab coming back): content.json again, then its tick
const refresh = page => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));


test('no `points` in content.json: no widget, no top-bar entry, no points.js request', async () => {
  const { context, page, problems, requests } = await open(PHONE, null);
  assert.equal(await page.$('[data-area="points"]'), null);
  assert.equal(await page.$('#points-link:not([hidden])'), null);
  assert.ok(!requests.some(path => path.endsWith('/points.js')), 'the module is not loaded');
  assert.deepEqual(problems, []);
  await context.close();
});


test('states from Cairo time across a clock change and a world change; season line; same-tab link', async () => {

  const state = { content: world(), date: TUESDAY_NOON };
  const { context, page, problems, requests } = await open(PHONE, state);
  await waitHeadline(page, /المتجر بيفتح/);

  // the device clock is today's; the server says Tuesday noon: the widget follows the server
  assert.deepEqual(await words(page), {
    shop: 'scheduled',
    title: 'نقاطي والمتجر',
    headline: 'المتجر بيفتح السبت الساعة ٧ بالليل',
    detail: 'فاضل ٤ أيام',
    season: 'الموسم بيخلص بعد ٧ أيام'
  });
  assert.ok(requests.some(path => path.endsWith('/assets/js/points.js')));
  assert.equal(requests.filter(path => /script\.google/.test(path)).length, 0, 'no server call');

  // the clock moves to Saturday 19:00: the store opens on the page's own refresh
  state.date = SATURDAY_OPEN;
  await refresh(page);
  await waitHeadline(page, /مفتوح/);
  assert.deepEqual(await words(page), {
    shop: 'open',
    title: 'نقاطي والمتجر',
    headline: 'المتجر مفتوح لحد الخميس الساعة ٨ بالليل',
    detail: 'اطلب جايزتك بنقاطك',
    season: 'الموسم بيخلص بعد يومين'
  });

  // the world changes (a publish: the admin closed the store)
  state.content = world({ points: { url: 'points/', shop: { ...SHOP, mode: 'closed' }, season: SEASON } });
  await refresh(page);
  await waitHeadline(page, /مقفول/);
  assert.equal((await words(page)).headline, 'المتجر مقفول — نقاطك محفوظة');
  assert.equal(await page.$eval('.points', el => el.dataset.shop), 'closed');

  // no store, no season: just «نقاطي»
  state.content = world({ points: { url: 'points/', shop: null, season: null } });
  await refresh(page);
  await page.waitForFunction(() => document.querySelector('.points')?.dataset.shop === 'none');
  assert.deepEqual(await words(page), { shop: 'none', title: 'نقاطي', headline: 'نقاطك ومسابقاتك في مكان واحد', detail: '', season: '' });

  // the whole card opens points/ in this tab
  const link = await page.$eval('.points .stretched', a => ({ href: a.getAttribute('href'), target: a.getAttribute('target') }));
  assert.deepEqual(link, { href: 'points/', target: null });
  await Promise.all([page.waitForNavigation(), page.click('.points .points__art')]);
  assert.equal(new URL(page.url()).pathname, '/points/');
  assert.deepEqual(problems, []);
  await context.close();

});


test('placement: under the meeting; right after the competitions when they show', async () => {

  let { context, page } = await open(PHONE, { content: world(), date: TUESDAY_NOON });
  let order = await page.$$eval('#main > [data-area]', els => els.map(e => e.dataset.area));
  const at = order.indexOf('points');
  assert.ok(at > 0 && ['meeting', 'live-game', 'announcement', 'banner'].includes(order[at - 1]), order.join(' '));
  assert.ok(order.indexOf('meeting') < at);
  assert.equal(await page.$eval('.points', el => el.hasAttribute('data-wide')), true);
  await context.close();

  const content = world({
    types: [{ key: 'quiz', label: 'مسابقة', icon: 'trophy' }],
    activities: [{ id: 'a-1', type: 'quiz', section: 'competitions', title: 'مسابقة يونان', startAt: '2026-10-10T00:00', endAt: '2026-10-30T00:00' }]
  });
  ({ context, page } = await open(PHONE, { content, date: TUESDAY_NOON }));
  order = await page.$$eval('#main > [data-area]', els => els.map(e => e.dataset.area));
  const items = await page.$$eval('#main > [data-area]', els => els.map(e => e.dataset.area === 'items' && !!e.querySelector('[data-item], .item-card, li')));
  const points = order.indexOf('points');
  assert.equal(order[points - 1], 'items', order.join(' '));
  assert.ok(items[points - 1]);
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


test('axe phone + desktop; no horizontal scroll at 280 / 360 / 1280; touch targets', async () => {

  for (const [name, viewport] of Object.entries({ narrow: NARROW, phone: PHONE, desktop: DESKTOP })) {
    for (const shop of [SHOP, null]) {
      const { context, page, problems } = await open(viewport, { content: world({ points: { url: 'points/', shop, season: SEASON } }), date: TUESDAY_NOON }, { bypassCSP: name !== 'narrow' });
      await page.waitForFunction(() => document.querySelector('.points__headline')?.textContent);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 0, `${name}: horizontal overflow ${overflow}px`);
      const boxes = await page.$$eval('.points, #points-link', els => els.map(el => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      assert.ok(boxes.every(([w, h]) => w >= 44 && h >= 44), `${name}: ${JSON.stringify(boxes)}`);
      if (name !== 'narrow') {
        await page.evaluate(AXE);
        const results = await page.evaluate(tags => axe.run(document, { runOnly: { type: 'tag', values: tags } }), AXE_TAGS);
        assert.deepEqual(results.violations.map(v => `${name} ${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`), []);
      }
      else {
        assert.deepEqual(problems, [], 'no console errors / CSP violations');
      }
      if (shop) await page.screenshot({ path: `${ROOT}tools/.cache/comp/points-widget-${name}.png` });
      await context.close();
    }
  }

});


test('§19.1 preview: auto with preview before opensAt, then open on the clock; manual preview «قريب»', async () => {

  const state = { content: world({ points: { url: 'points/', shop: { ...SHOP, preview: true }, season: null } }), date: TUESDAY_NOON };
  const { context, page, problems } = await open(PHONE, state);
  await waitHeadline(page, /للعرض/);
  assert.deepEqual(await words(page), {
    shop: 'preview',
    title: 'نقاطي والمتجر',
    headline: 'المتجر مفتوح للعرض — الطلب هيفتح السبت الساعة ٧ بالليل',
    detail: 'فاضل ٤ أيام',
    season: ''
  });

  state.date = SATURDAY_OPEN;
  await refresh(page);
  await waitHeadline(page, /مفتوح لحد/);
  assert.equal(await page.$eval('.points', el => el.dataset.shop), 'open');

  // the admin switches to a manual preview (a publish), no date
  state.content = world({ points: { url: 'points/', shop: { on: true, mode: 'preview', preview: false, opensAt: '', closesAt: '' }, season: null } });
  await refresh(page);
  await waitHeadline(page, /قريب/);
  assert.deepEqual(await words(page), {
    shop: 'preview',
    title: 'نقاطي والمتجر',
    headline: 'المتجر مفتوح للعرض — الطلب هيفتح قريب',
    detail: 'اتفرج على الجوايز وجهّز نقاطك',
    season: ''
  });
  assert.deepEqual(problems, []);
  await context.close();

});
