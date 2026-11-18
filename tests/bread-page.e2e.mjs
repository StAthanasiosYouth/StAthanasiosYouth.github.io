// «خبزنا اليومي» W5 (docs/daily-bread/PLAN.md §3 W5): the member page in Chrome, its real CSP, against the REAL Worker
// code on SQLite with a program published by the real admin routes (tests/bread-world.mjs).
//   no account · eligible · guest · a late joiner · the content finished · the section closed (BREAD_MODULE = 0)
//   the intro (decision 15): on every load (a push, the home card, the menu, a link), again after leaving and coming
//   back, after a back-button return (bfcache), never on in-page navigation or the return after signing in
//   the beacon (keepalive, text/plain), the look saved to the account, offline (sw.js keeps today's reading)
// Run: cd tools && node --experimental-sqlite --no-warnings --test --test-concurrency=1 ../tests/bread-page.e2e.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { startWorld, seedFor, prime, CHROME } from './bread-world.mjs';
import { cairoDay, dayAdd } from '../worker/src/bread/model.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const PROD = 'https://athanasios-api.menazak-lab.workers.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let w, browser, prog, seed;

test.before(async () => {
  w = await startWorld({ sitePort: 4764, apiPort: 4765 });
  prog = await w.program({ dayNo: 5 });
  seed = seedFor(prog.id, 30, 4, 0);
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => {
  await browser?.close();
  await w?.close();
});

/* a page with this device primed; counts every intro that starts; never reaches the production Worker */
async function open(path, { member = null, look = null, extra = {}, width = 390, height = 844, ctx = null, joined = true } = {}) {
  ctx ||= await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  // the account page's own view transition, cut by the test's quick navigation, is not this page's
  page.on('pageerror', e => { if (!/ViewTransition|Transition was aborted/.test(e.message)) errors.push(e.message); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
  await page.setViewport({ width, height, isMobile: width < 700, hasTouch: width < 700 });
  await page.setRequestInterception(true);
  page.on('request', r => (r.url().startsWith(PROD) ? r.abort() : r.continue()));
  await prime(page, w.API, { seed, member, look, extra: { ...(joined ? { ['bread.joined.' + prog.id]: dayAdd(cairoDay(), -4) } : {}), ...extra } });
  await page.evaluateOnNewDocument(() => {
    window.__intros = 0;
    new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) if (n.classList && n.classList.contains('br-intro')) window.__intros++; })
      .observe(document, { childList: true, subtree: true });
  });
  if (path) await page.goto(w.LOCAL + path, { waitUntil: 'domcontentloaded' });
  return { page, ctx, errors };
}
const ready = page => page.waitForSelector('.br-dawn, .br-rest', { timeout: 20000 });
const intros = page => page.evaluate(() => window.__intros);
const introGone = page => page.waitForFunction(() => !document.querySelector('.br-intro'), { timeout: 8000 });
const text = (page, sel) => page.$eval(sel, n => n.textContent.replace(/\s+/g, ' ').trim());
const lastCall = path => [...w.calls].reverse().find(c => c.path === path);

test('closed (BREAD_MODULE = 0): the page says it is not open, no intro, no reminders; the home card and the menu link stay away', async () => {
  await w.setting('BREAD_MODULE', '0');
  try {
    const { page, ctx, errors } = await open('/daily-bread/');
    await page.waitForSelector('.br-rest h1', { timeout: 20000 });
    assert.match(await text(page, '.br-rest h1'), /لسه مبدأش/);
    await sleep(800);
    assert.equal(await intros(page), 0, 'no intro while closed');
    assert.equal(await page.$('[data-nav="reminders"]'), null);
    assert.equal(await page.$('#br-cover'), null, 'the cover lifted');
    // the home page: no card; «المزيد»: no link
    await page.evaluateOnNewDocument(() => { try { sessionStorage.setItem('athanasios:intro', '1'); } catch { /* fine */ } });
    await page.goto(w.LOCAL + '/index.html', { waitUntil: 'networkidle0' });
    await sleep(1500);
    assert.equal(await page.$('.br-home'), null, 'no home card');
    const more = await page.waitForSelector('.tabbar [aria-haspopup="dialog"]', { timeout: 8000 });
    {
      await more.click();
      await page.waitForSelector('dialog.nav-more', { timeout: 5000 });
      assert.doesNotMatch(await text(page, 'dialog.nav-more'), /خبزنا اليومي/);
    }
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  finally {
    await w.setting('BREAD_MODULE', '1');
  }
});

test('no account: today\'s own topic, the intro plays once on load, the open beacon (keepalive, text/plain), font size / tashkeel / look without the intro', async () => {
  const { page, ctx, errors } = await open('/daily-bread/?from=push');
  await page.waitForSelector('.br-intro', { timeout: 20000 });
  await ready(page);
  await introGone(page);
  assert.equal(await intros(page), 1);
  assert.equal(new URL(page.url()).searchParams.get('from'), null, 'the entry flag is cleaned from the address');
  assert.match(await text(page, '.br-title'), /أنا هو خبز الحياة/);
  assert.match(await text(page, '.br-day'), /اليوم ٥ من ٣٠/);
  assert.ok(await page.$('.br-reading mark'), 'the day\'s verse is marked inside the reading');
  const open1 = lastCall('/v1/bread/open');
  assert.ok(open1, 'the open beacon');
  assert.match(open1.type, /^text\/plain/);
  assert.deepEqual(JSON.parse(open1.body), { seed, kind: 'open' });
  // in-page: none of these replays the intro
  const before = await page.$eval('.br-reading', n => getComputedStyle(n).fontSize);
  await page.click('[data-act="bigger"]');
  assert.notEqual(await page.$eval('.br-reading', n => getComputedStyle(n).fontSize), before);
  const marked = await page.$eval('.br-verse', n => n.textContent);
  await page.click('[data-act="plain"]');
  assert.notEqual(await page.$eval('.br-verse', n => n.textContent), marked, 'tashkeel off');
  assert.doesNotMatch(await page.$eval('.br-verse', n => n.textContent), /[ًٌٍَُِّْ]/);
  await page.click('[data-act="look"]');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.look), 'dawn');
  assert.equal(await page.evaluate(() => localStorage.getItem('bread.look')), 'dawn');
  await page.click('[data-nav="reminders"]');
  await page.waitForSelector('.br-h1');
  await page.click('.tabbar__tab[data-tab="today"]');
  await ready(page);
  await page.type('.br-field textarea', 'سطر');
  await sleep(600);
  assert.equal(await intros(page), 1, 'still one intro after the in-page moves');
  // «قريت»
  await page.click('[data-act="read"]');
  assert.equal(await page.$eval('.br-done', n => n.getAttribute('aria-pressed')), 'true');
  await sleep(300);
  assert.deepEqual(JSON.parse(lastCall('/v1/bread/open').body), { seed, kind: 'read' });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('no account → «ادخل بحسابك وابعت»: the draft is kept, back with ?from=signin: no intro, the draft is there, send → 20 minutes to edit / delete', async () => {
  const { page, ctx, errors } = await open('/daily-bread/?intro=0');
  await ready(page);
  await page.type('.br-field textarea', 'تأمل تجربة من الصفحة');
  await page.click('[data-act="signin"]');
  await page.waitForSelector('.br-sheet[aria-label="ادخل بحسابك"]');
  await Promise.all([page.waitForNavigation(), page.click('[data-act="go-signin"]')]);
  assert.match(page.url(), /\/account\/$/);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('athanasios.account.return.v1')), '/daily-bread/?from=signin#reflect');
  // signed in (the account page writes the session) and sent back
  const m = await w.member();
  await page.evaluate(m => {
    localStorage.setItem('athanasios.account.v1', JSON.stringify({ token: m.token, email: m.email, firstName: m.firstName, at: Date.now() }));
    localStorage.setItem('athanasios.account.face.v1', JSON.stringify({ firstName: m.firstName, photo: '', version: 1 }));
  }, m);
  await page.goto(w.LOCAL + '/daily-bread/?from=signin#reflect', { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.waitForSelector('[data-act="send"]', { timeout: 10000 });
  assert.equal(await page.$eval('.br-field textarea', n => n.value), 'تأمل تجربة من الصفحة', await page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => k.startsWith('bread')))));
  assert.match(await text(page, '.br-hello b'), /أهلاً يا مارك/);
  assert.doesNotMatch(await text(page, '.br-hello b'), /ضيف/);
  await sleep(800);
  assert.equal(await intros(page), 0, 'no intro after signing in');
  await page.click('[data-act="send"]');
  await page.waitForSelector('.br-sent', { timeout: 10000 });
  assert.match(await text(page, '.br-ring b'), /^(١٩|٢٠):/);
  const row = await w.h.db.prepare('SELECT text, state FROM bread_reflections WHERE participant_id = ?').bind(m.id).first();
  assert.deepEqual({ ...row }, { text: 'تأمل تجربة من الصفحة', state: 'eligible' });
  // edit
  await page.click('[data-act="edit"]');
  await page.$eval('.br-field textarea', n => { n.value = 'تأمل بعد التعديل'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('[data-act="save"]');
  await page.waitForFunction(() => /بعد التعديل/.test(document.querySelector('.br-sent')?.textContent || ''));
  // the 20 minutes pass (the server decides): locked on the next load, no edit or delete
  await w.h.db.prepare('UPDATE bread_reflections SET created_ms = ? WHERE participant_id = ?').bind(Date.now() - 21 * 60000, m.id).run();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.br-locked', { timeout: 10000 });
  assert.equal(await page.$('[data-act="edit"]'), null);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('delete within the 20 minutes; guest: the welcome says «ضيف»', async () => {
  const g = await w.member({ guest: true });
  const { page, ctx, errors } = await open('/daily-bread/?intro=0#reflect', { member: g });
  await ready(page);
  await page.waitForSelector('.br-tag--guest', { timeout: 10000 });
  assert.match(await text(page, '.br-hello'), /أهلاً بيك يا مارك 🤍 ضيف/);
  await page.type('.br-field textarea', 'تأمل ضيف');
  await page.click('[data-act="send"]');
  await page.waitForSelector('[data-act="delete"]', { timeout: 10000 });
  assert.equal((await w.h.db.prepare('SELECT state FROM bread_reflections WHERE participant_id = ?').bind(g.id).first()).state, 'guest');
  await page.click('[data-act="delete"]');
  await page.waitForSelector('[data-act="send"]', { timeout: 10000 });
  assert.ok((await w.h.db.prepare('SELECT deleted_ms FROM bread_reflections WHERE participant_id = ?').bind(g.id).first()).deleted_ms);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the look follows the account: saved to prefs.bread_look, and an account\'s look wins on a new device', async () => {
  const m = await w.member();
  const { page, ctx } = await open('/daily-bread/?intro=0&s=reminders', { member: m });
  await page.waitForSelector('[data-act="look-dawn"]', { timeout: 20000 });
  await sleep(1200);
  await page.evaluate(() => document.querySelector('[data-act="look-dawn"]').click());
  await sleep(800);
  assert.equal((await w.h.db.prepare('SELECT bread_look FROM participants WHERE id = ?').bind(m.id).first()).bread_look, 'dawn');
  await ctx.close();
  const fresh = await open('/daily-bread/?intro=0', { member: m });
  await ready(fresh.page);
  await fresh.page.waitForFunction(() => document.documentElement.dataset.look === 'dawn', { timeout: 10000 });
  await fresh.ctx.close();
  // a choice made on the device before signing in is kept, and goes to the account (the account never chose)
  const m2 = await w.member();
  const chose = await open('/daily-bread/?intro=0', { member: m2, look: 'dawn' });
  await ready(chose.page);
  await sleep(2000);
  assert.equal(await chose.page.evaluate(() => document.documentElement.dataset.look), 'dawn');
  assert.equal((await w.h.db.prepare('SELECT bread_look FROM participants WHERE id = ?').bind(m2.id).first()).bread_look, 'dawn');
  await chose.ctx.close();
});

test('a late joiner: «اليوم ١ من ١٩» and the welcome once', async () => {
  await w.startOn(prog.id, dayAdd(cairoDay(), -11));
  try {
    const { page, ctx, errors } = await open('/daily-bread/?intro=0', { joined: false });
    await ready(page);
    assert.match(await text(page, '.br-day'), /اليوم ١ من ١٩/);
    assert.match(await text(page, '.br-note'), /بدأ من ١١ يوم، فهتشارك في الـ١٩ يوم الباقيين/);
    assert.equal(await page.evaluate(id => localStorage.getItem('bread.joined.' + id), prog.id), cairoDay());
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  finally {
    await w.startOn(prog.id, dayAdd(cairoDay(), -4));
  }
});

test('the content finished: «خلّصنا» with the program\'s name and days', async () => {
  await w.startOn(prog.id, dayAdd(cairoDay(), -30));
  try {
    // this device read the program (the index lists only the live and the next one)
    const { page, ctx, errors } = await open('/daily-bread/?intro=0', { extra: { 'bread.last': JSON.stringify({ id: prog.id, name: 'سلسلة «خبز الحياة»', days: 30, endsOn: dayAdd(cairoDay(), -1) }) } });
    await page.waitForSelector('.br-rest h1', { timeout: 20000 });
    assert.match(await text(page, '.br-rest h1'), /خلّصنا «خبز الحياة»/);
    assert.match(await text(page, '.br-rest p'), /٣٠ يوم/);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  finally {
    await w.startOn(prog.id, dayAdd(cairoDay(), -4));
  }
});

test('the intro: from the home card and from the menu; again after leaving and coming back; after «رجوع» (bfcache)', async () => {
  const { page, ctx, errors } = await open(null);
  await page.evaluateOnNewDocument(() => { try { sessionStorage.setItem('athanasios:intro', '1'); } catch { /* fine */ } });
  await page.goto(w.LOCAL + '/index.html', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.br-home', { timeout: 20000 });
  assert.match(await text(page, '.br-home'), /أنا هو خبز الحياة/);
  assert.match(await text(page, '.br-home__chip'), /اليوم ٥ من ٣٠/);
  // the home card → the section: the intro
  await Promise.all([page.waitForNavigation(), page.$eval('.br-home', a => a.click())]);
  await page.waitForSelector('.br-intro', { timeout: 20000 });
  await introGone(page);
  // out to the site and back with a link: a new entry, the intro again
  await Promise.all([page.waitForNavigation(), page.click('.br-brand')]);
  await page.waitForSelector('.br-home', { timeout: 20000 });
  await Promise.all([page.waitForNavigation(), page.$eval('.br-home', a => a.click())]);
  await page.waitForSelector('.br-intro', { timeout: 20000 });
  await introGone(page);
  // «رجوع» to the home page and «رجوع للأمام»… then «رجوع» from another page back into the section: the intro again
  await page.goto(w.LOCAL + '/privacy/', { waitUntil: 'domcontentloaded' });
  await page.goBack({ waitUntil: 'domcontentloaded' });
  const persisted = await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.type);
  await page.waitForSelector('.br-intro', { timeout: 20000 });
  await introGone(page);
  // the menu «المزيد» lists the section while it is open, and its link is a new entry: the intro
  await page.goto(w.LOCAL + '/index.html', { waitUntil: 'networkidle0' });
  await (await page.waitForSelector('.tabbar [aria-haspopup="dialog"]', { timeout: 8000 })).click();
  const link = await page.waitForSelector('dialog.nav-more a[href$="/daily-bread/"]', { timeout: 8000 });
  await Promise.all([page.waitForNavigation(), link.evaluate(a => a.click())]);
  await page.waitForSelector('.br-intro', { timeout: 20000 });
  assert.deepEqual(errors, [], 'errors (' + persisted + ')');
  await ctx.close();
});

test('the back-button return from the bfcache plays the intro (pageshow persisted)', async () => {
  const { page, ctx } = await open('/daily-bread/?intro=0');
  await ready(page);
  // a pageshow with persisted = true is what the bfcache sends; the page plays the intro on it
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.waitForSelector('.br-intro', { timeout: 5000 });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })));
  await introGone(page);
  assert.equal(await intros(page), 1, 'a normal pageshow does not');
  await ctx.close();
});

test('reduced motion: the intro is a short fade (≈ 1.1 s)', async () => {
  const { page, ctx } = await open(null);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(w.LOCAL + '/daily-bread/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.br-intro', { timeout: 20000 });
  const t0 = Date.now();
  await introGone(page);
  assert.ok(Date.now() - t0 < 2000, 'gone in under 2 s');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'reduced');
  await ctx.close();
});

test('offline: sw.js keeps today\'s reading; the network gone, the page still reads', async () => {
  const { page, ctx } = await open('/daily-bread/?intro=0');
  await ready(page);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true), { timeout: 10000 });
  await sleep(2500);
  // a second load under the worker's control, then offline
  await page.reload({ waitUntil: 'networkidle0' });
  await ready(page);
  await sleep(1500);
  await page.setOfflineMode(true);
  w.apiDown = true;
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.br-dawn', { timeout: 20000 });
    assert.match(await text(page, '.br-title'), /أنا هو خبز الحياة/);
  }
  finally {
    w.apiDown = false;
    await page.setOfflineMode(false);
  }
  // the site's other pages are never answered by the worker
  const handled = await page.evaluate(async () => {
    const keys = await (await caches.open('bread-v1')).keys();
    return keys.map(k => new URL(k.url).pathname);
  });
  assert.ok(handled.includes('/daily-bread/'));
  assert.ok(!handled.some(p => p === '/index.html' || p === '/content.json'), handled.join(', '));
  await ctx.close();
});
