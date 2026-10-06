// The public page follows the published layout: sections in order, hidden
// ones absent, scheduled ones appearing at their Cairo time, bell items
// only for sections that show. content.json is built by the real publish
// code (fake Sheet) and served through request interception, with the
// server clock set by the Date header.
//
// Run: cd tools && npm run e2e

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const ADMIN = 'menazakmena@gmail.com';
const PORT = 4393;
const BASE = `http://localhost:${PORT}/`;
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

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


/* content.json from a fake Sheet, after `change(gs)` */
function publish(change = () => {}) {
  const world = createWorld();
  const gs = world.as(ADMIN).gs;
  gs.setup();
  gs.apiSaveItem('news', { title: 'رحلة الغردقة', summary: 'سجّل اسمك', publishAt: '2026-10-01 10:00', notify: { publish: true } });
  gs.apiSaveItem('sessions', { date: '2026-10-11', topic: 'الكسل الروحي', visibleFrom: '2026-10-01 10:00', notify: { topic: true } });
  change(gs);
  const built = JSON.parse(JSON.stringify(gs.buildPublicContent(gs.readDraft_(), { now: '2026-10-08T12:00' })));
  assert.deepEqual(built.errors, []);
  return built.content;
}

/* opens the page with this content.json, the server clock at this UTC time */
async function open(content, utc) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.setViewport(PHONE);
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/content.json') {
      request.respond({
        status: 200,
        contentType: 'application/json',
        headers: { Date: new Date(utc).toUTCString(), 'Cache-Control': 'no-cache' },
        body: JSON.stringify(content)
      });
    }
    else request.continue();
  });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main[data-state="ready"]');

  const areas = await page.$$eval('#main > [data-area]', nodes => nodes.map(n => n.dataset.area));

  return { page, areas, problems, close: () => context.close() };

}

const sectionTitles = page => page.$$eval('.links-section .widget__title', t => t.map(x => x.textContent));

// Thursday 8 Oct 2026, 12:00 Cairo (UTC+3 in summer time)
const THURSDAY_NOON = '2026-10-08T09:00:00Z';


test('the default page: every section in its usual order', async () => {
  const { areas, problems, close } = await open(publish(), THURSDAY_NOON);
  assert.deepEqual(areas.filter(a => a !== 'section'), ['hero', 'meeting', 'banner', 'featured', 'news', 'location', 'contacts', 'support', 'share', 'footer'].filter(a => areas.includes(a)));
  assert.ok(areas.indexOf('meeting') < areas.indexOf('section'));
  assert.ok(areas.indexOf('section') < areas.indexOf('contacts'));
  assert.deepEqual(problems, []);
  await close();
});

test('only the social links and one news item: everything else is gone', async () => {
  const content = publish(gs => {
    for (const s of gs.readTable_('Sections')) {
      if (!['social', 'news'].includes(s.key)) gs.apiSetSectionEnabled(s.key, false);
    }
  });
  const { page, areas, problems, close } = await open(content, THURSDAY_NOON);
  assert.deepEqual(areas.filter(a => !['hero', 'footer'].includes(a)), ['news', 'section']);
  assert.deepEqual(await sectionTitles(page), ['تابعنا']);
  assert.equal(await page.$('[data-area="meeting"]'), null);
  // the bell has no meeting notification either
  const bellItems = await page.evaluate(() => document.querySelector('.bell__badge')?.textContent || '');
  assert.ok(!/2/.test(bellItems), 'only the news notification counts');
  assert.deepEqual(problems, []);
  await close();
});

test('sections follow the admin\'s order', async () => {
  const content = publish(gs => {
    // location to the very top
    for (let i = 0; i < 12; i++) gs.apiMoveSection('location', -1);
  });
  const { areas, problems, close } = await open(content, THURSDAY_NOON);
  assert.equal(areas[1], 'location', areas.join(' > '));
  assert.deepEqual(problems, []);
  await close();
});

test('a scheduled section appears at its Cairo time, not before', async () => {
  const content = publish(gs => {
    gs.apiSaveSection({ key: 'news', title: 'جديد الأسرة', subtitle: 'كل جديد عندنا', visibleFrom: '2026-10-09 20:00', visibleUntil: '' });
  });

  const before = await open(content, '2026-10-09T16:59:00Z'); // 19:59 Cairo
  assert.ok(!before.areas.includes('news'), before.areas.join(' > '));
  assert.ok(!before.areas.includes('banner'));
  await before.close();

  const after = await open(content, '2026-10-09T17:00:00Z'); // 20:00 Cairo
  assert.ok(after.areas.includes('news'), after.areas.join(' > '));
  assert.equal(await after.page.$eval('.news .section-head__sub', n => n.textContent), 'كل جديد عندنا');
  assert.deepEqual(after.problems, []);
  await after.close();
});

test('a scheduled meeting section hides its bell notification until then', async () => {
  const content = publish(gs => {
    gs.apiSaveSection({ key: 'meeting', title: 'ركن الاجتماع', visibleFrom: '2026-10-10 10:00', visibleUntil: '' });
  });
  const { page, areas, problems, close } = await open(content, THURSDAY_NOON);
  assert.ok(!areas.includes('meeting'));
  const ids = await page.evaluate(async () => {
    const { visibleNotifications } = await import('./assets/js/bell.js');
    const { readCached } = await import('./assets/js/content.js');
    const { stamp, zonedNow } = await import('./assets/js/schedule.js');
    return visibleNotifications(readCached(), stamp(zonedNow())).map(n => n.id);
  });
  assert.ok(!ids.some(id => id.startsWith('notif-session-')), ids.join(','));
  assert.ok(ids.some(id => id.startsWith('notif-news-')), ids.join(','));
  assert.deepEqual(problems, []);
  await close();
});

test('older content without a layout still renders the usual page', async () => {
  const content = publish();
  delete content.layout;
  content.schema = 2;
  const { areas, problems, close } = await open(content, THURSDAY_NOON);
  assert.ok(areas.includes('meeting') && areas.includes('share') && areas.includes('section'));
  assert.deepEqual(problems, []);
  await close();
});


/* ---------------- Phase 4: themes, banners, never an empty picture ---------------- */

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(40, 5)]).toString('base64');

test('an item without a poster gets built-in art in its section colour', async () => {
  const content = publish(gs => gs.apiSaveSection({ key: 'news', title: 'جديد الأسرة', theme: 'ember' }));
  const { page, problems, close } = await open(content, THURSDAY_NOON);
  assert.equal(await page.$eval('[data-area="news"]', n => n.dataset.theme), 'ember');
  assert.ok(await page.$('[data-area="news"] .art'), 'art instead of an empty box');
  assert.equal(await page.$('[data-area="news"] .news-card--text'), null);
  assert.deepEqual(problems, []);
  await close();
});

test('a section banner shows on top, and stands in for missing posters', async () => {
  const content = publish(gs => {
    const banner = JSON.parse(JSON.stringify(gs.apiUploadMedia({ full: WEBP, thumb: WEBP, mime: 'image/webp', width: 1600, height: 600, alt: 'بانر', color: '#204060' }))).media;
    gs.apiSaveSection({ key: 'news', title: 'جديد الأسرة', banner: banner.id });
  });
  const { page, problems, close } = await open(content, THURSDAY_NOON);
  const srcs = await page.$$eval('[data-area="news"] img', imgs => imgs.map(i => i.getAttribute('src')));
  assert.ok(await page.$('[data-area="news"] .section-banner img'));
  assert.ok(srcs.length >= 2 && srcs.every(s => /^media\/\d{4}\/img-/.test(s)), srcs.join(' '));
  assert.equal(await page.$('[data-area="news"] .art'), null, 'the banner, not art');
  const bg = await page.$eval('[data-area="news"] .section-banner img', i => i.style.backgroundColor);
  assert.equal(bg, 'rgb(32, 64, 96)', 'its colour while loading');
  assert.deepEqual(problems, []);
  await close();
});
