// The admin app in a real browser (the official /admin/ against the real
// .gs code in a fake Apps Script world):
//  - Phase 0: /admin/ is its own installable app (manifest, its own worker
//    at /admin/ next to the site's at /), signing in still works the same,
//    and the two workers get two different push subscriptions;
//  - «سجل النشاط»: rows with display names, filters, «افتح», the home card;
//  - links into the panel (#open/…, #activity/…), a deleted item;
//  - in-panel toasts when another admin acts while this panel is open;
//  - display names from «صلاحيات لوحة التحكم»; phone and desktop layouts.
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/admin-app.e2e.mjs

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4611;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'fady.youssef@gmail.com';
const SHOTS = `${ROOT}tools/.cache/review/admin-app/`;
const VAPID = 'BG1xbtyFFTedzotjPEgX4HEpiuMQ05R1KRCezOGMtjcXsgtdWEemVgamRZnegbztyomypmVL-D74niZLoKduS5Q';

const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const SMALL = { width: 360, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1440, height: 900 };
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

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
let claims = { email: ADMIN };

function freshWorld() {
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', `${SITE}/`);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  world.properties.set('ADMIN_NAMES', JSON.stringify({ [ADMIN]: 'مينا زكريا', [SECOND]: 'فادي يوسف' }));
  // a new device of the same account gets in without the takeover question
  world.gs.SESSION_STALE_SECONDS = 0;
  world.as('');
}

/* the other admin, straight to the API (their own token and session) */
function fady() {
  const token = world.issueToken({ email: SECOND });
  const started = world.post({ fn: 'apiSessionStart', args: [{ device: 'موبايل أندرويد – التطبيق', force: true, state: false }], token });
  assert.equal(started.ok, true, started.error);
  const call = (fn, ...args) => {
    const reply = world.post({ fn, args, token, sid: started.result.sid });
    assert.equal(reply.ok, true, `${fn}: ${reply.error}`);
    return reply.result;
  };
  // he leaves the panel: his session is parked (not "present")
  call.leave = () => world.post({ fn: 'apiSessionEnd', args: [{ park: true }], token, sid: started.result.sid });
  return call;
}

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  freshWorld();
  server = createSiteServer({
    world: { issueToken: c => world.issueToken(c), get github() { return world.github; } },
    config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK, timing: TIMING }),
    claims: () => claims
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => (server ? server.close(resolve) : resolve()));
});

/* one device: its own browser context, the admin at this server's own address (a secure context: workers allowed) */
async function device({ viewport = DESKTOP, ua = null, hash = '', path = '', before = '' } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];

  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(`csp: ${message.text()}`);
  });
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  if (ua) await page.setUserAgent(ua);
  await page.setViewport(viewport);
  await interceptGoogle(page, { post: body => world.post(body) });
  if (before) await page.evaluateOnNewDocument(before);
  await page.goto(`${LOCAL}/admin/${path}${hash}`, { waitUntil: 'networkidle0' });

  return { context, page, problems, close: () => context.close() };

}

async function signIn(page, email = ADMIN) {
  claims = { email };
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
}

const shot = async (page, name) => { await sleep(1700); await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: false }); };


/* ---------------- Phase 0: the admin app ---------------- */

test('admin app: its own manifest, installable, its own worker at /admin/ next to the site\'s; sign-in unchanged', async () => {

  freshWorld();
  const d = await device({ ua: ANDROID, viewport: PHONE });
  const cdp = await d.page.createCDPSession();

  const manifest = await cdp.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors, [], 'the manifest parses cleanly');
  assert.match(manifest.url, /\/admin\/manifest\.webmanifest$/);
  const parsed = JSON.parse(manifest.data);
  assert.equal(parsed.id, '/admin/');
  assert.equal(parsed.start_url, '/admin/?app=admin');
  assert.equal(parsed.scope, '/admin/');
  assert.equal(parsed.short_name, 'لوحة تحكم الأسرة');

  // the gate and Google sign-in work as before
  await signIn(d.page);
  assert.equal(await d.page.evaluate(() => A.state.user), ADMIN);
  assert.equal(await d.page.evaluate(() => A.state.me), 'مينا زكريا');

  // the admin worker, registered once the panel is open: scope /admin/
  const scope = await d.page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/admin/');
    return reg && reg.active && reg.scope;
  }, { timeout: 10000 }).then(h => h.jsonValue());
  assert.equal(scope, `${LOCAL}/admin/`);

  const installability = await cdp.send('Page.getInstallabilityErrors');
  // (the test browser's contexts are incognito, where Chrome never installs: that one reason only)
  assert.deepEqual(installability.installabilityErrors.map(e => e.errorId).filter(id => id !== 'in-incognito'), [], 'Chrome can install it');

  // the site next to it, on the same "phone": its own worker, its own scope
  const site = await d.context.newPage();
  await site.goto(`${LOCAL}/`, { waitUntil: 'networkidle0' });
  await site.evaluate(() => navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready));
  const scopes = await d.page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => r.scope + ' ' + (r.active || r.installing || r.waiting).scriptURL).sort());
  assert.deepEqual(scopes, [`${LOCAL}/ ${LOCAL}/sw.js`, `${LOCAL}/admin/ ${LOCAL}/admin/sw.js`]);

  // a reload: the admin page is controlled by ITS worker (not the site's)
  await d.page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await d.page.evaluate(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL), `${LOCAL}/admin/sw.js`);
  assert.equal(await site.evaluate(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL), `${LOCAL}/sw.js`);

  // two workers, two push subscriptions (two FCM tokens) — where this browser has a push service
  await d.context.overridePermissions(LOCAL, ['notifications']);
  const subscribe = (page, scopePath) => page.evaluate(async (path, key) => {
    try {
      const reg = await navigator.serviceWorker.getRegistration(path);
      const pad = '='.repeat((4 - key.length % 4) % 4);
      const raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
      return { endpoint: sub.endpoint };
    }
    catch (error) {
      return { error: String(error && error.message || error) };
    }
  }, scopePath, VAPID);
  const adminSub = await subscribe(d.page, '/admin/');
  const siteSub = await subscribe(site, '/');
  if (adminSub.endpoint && siteSub.endpoint) {
    assert.notEqual(adminSub.endpoint, siteSub.endpoint, 'separate subscriptions');
    test.diagnostic?.('push: two different endpoints');
  }
  else {
    // headless Chrome has no push service: noted, checked on a real phone
    console.log(`push service not available here (${adminSub.error || siteSub.error})`);
  }

  assert.deepEqual(d.problems, []);
  await d.close();

});


/* ---------------- «سجل النشاط» ---------------- */

test('activity: the home card and the log show who did what with display names; filters; «افتح» opens the item', async () => {

  freshWorld();
  const other = fady();
  const created = other('apiSaveItem', 'news', { title: 'خبر من فادي', summary: 'x' });
  const newsId = created.draft.news.find(n => n.title === 'خبر من فادي').id;
  other('apiSaveContact', { name: 'أبونا داود', phone: '01012345678', method: 'call' });
  other.leave();
  const d = await device();
  await signIn(d.page);

  // the home card
  await d.page.waitForSelector('#dash-activity .act');
  const home = await d.page.$eval('#dash-activity', n => n.innerText);
  assert.match(home, /فادي يوسف أضاف خبر جديد «خبر من فادي»/);
  assert.match(home, /فادي يوسف أضاف جهة تواصل جديدة «أبونا داود»/);
  await shot(d.page, '01-home-card');

  // the log
  await d.page.evaluate(() => A.go('activity'));
  await d.page.waitForSelector('.acts .act');
  assert.equal(await d.page.$eval('#page-title', n => n.textContent), 'سجل النشاط');
  const rows = await d.page.$$eval('.acts .act', list => list.map(n => n.innerText));
  assert.ok(rows.length >= 2);
  assert.match(rows[0], /فادي يوسف/);
  await shot(d.page, '02-log-desktop');

  // filter: a section
  await d.page.select('.act-filters select:nth-of-type(1)', '');
  const sectionSelect = (await d.page.$$('.act-filters select'))[2];
  await sectionSelect.select('news');
  await d.page.waitForFunction(() => document.querySelectorAll('.acts .act').length === 1 && document.querySelector('.acts[aria-busy="false"]'));
  assert.match(await d.page.$eval('.acts .act', n => n.innerText), /خبر من فادي/);

  // «افتح»: the news editor, with the item
  await d.page.click('.acts .act .act__open');
  await d.page.waitForSelector('dialog.sheet[open]');
  assert.equal(await d.page.evaluate(() => A.area + '/' + A.sub.content), 'content/news');
  const title = await d.page.$eval('dialog.sheet[open] .field[data-label="العنوان"] input', n => n.value);
  assert.equal(title, 'خبر من فادي');
  await d.page.evaluate(() => A.closeSheet());

  // the server's identity is what the log shows, whatever the page might send
  assert.equal(world.gs.readTable_('News').find(n => n.id === newsId).title, 'خبر من فادي');

  assert.deepEqual(d.problems, []);
  await d.close();

});

test('links: #open/news/<id> opens its editor (address bar cleaned); a deleted item shows what happened; #activity/<id> highlights it', async () => {

  freshWorld();
  const other = fady();
  const state = other('apiSaveItem', 'news', { title: 'خبر للرابط', summary: 'x' });
  const id = state.draft.news.find(n => n.title === 'خبر للرابط').id;
  const gone = other('apiSaveItem', 'news', { title: 'خبر هيتمسح', summary: 'x' }).draft.news.find(n => n.title === 'خبر هيتمسح').id;
  other('apiDeleteItem', 'news', gone);
  other.leave();
  const entry = world.gs.apiActivity ? null : null;

  // a notification tap opens the app at /admin/#open/news/<id>
  const d = await device({ hash: `#open/news/${id}` });
  await signIn(d.page);
  await d.page.waitForSelector('dialog.sheet[open]', { timeout: 8000 });
  assert.equal(await d.page.$eval('dialog.sheet[open] .field[data-label="العنوان"] input', n => n.value), 'خبر للرابط');
  assert.equal(await d.page.evaluate(() => location.hash), '', 'not left in the address bar');
  await d.page.evaluate(() => A.closeSheet());

  // the deleted one: the log, saying it's gone
  await d.page.evaluate(h => { location.hash = h; }, `#open/news/${gone}`);
  await d.page.waitForSelector('.act-focus .note--warn');
  assert.match(await d.page.$eval('.act-focus', n => n.innerText), /اتمسح/);
  await d.page.waitForSelector('.acts .act');
  assert.match(await d.page.$eval('.acts', n => n.innerText), /مسح الخبر «خبر هيتمسح»/);
  await shot(d.page, '03-gone-item');

  // one entry: highlighted
  const rows = await d.page.evaluate(() => A.call('apiActivity', {}));
  const target = rows.items.find(i => i.action === 'create' && i.title === 'خبر للرابط');
  await d.page.evaluate(h => { location.hash = h; }, `#activity/${target.id}`);
  await d.page.waitForSelector(`.act.is-focus[data-id="${target.id}"]`);
  assert.equal(await d.page.$$eval('.acts .act', l => l.length), 1);

  // the service worker's message (an open admin window): the same
  await d.page.evaluate(h => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'athanasios-admin:open', url: location.origin + '/admin/' + h } })), `#open/news/${id}`);
  await d.page.waitForSelector('dialog.sheet[open]', { timeout: 8000 });
  await d.page.evaluate(() => A.closeSheet());

  // anything else is ignored
  await d.page.evaluate(() => { location.hash = '#open/../../x'; });
  await sleep(300);
  assert.equal(await d.page.evaluate(() => document.querySelector('dialog.sheet[open]')), null);

  assert.deepEqual(d.problems, []);
  await d.close();

});

test('toasts: another admin acts while this panel is open → a toast with «افتح» (no push for this admin); never your own', async () => {

  freshWorld();
  const d = await device();
  await signIn(d.page);
  await d.page.evaluate(() => A.go('page', 'links'));
  await sleep(1500);   // a heartbeat or two: this admin is "present"

  const other = fady();
  other('apiSaveItem', 'news', { title: 'خبر جديد من فادي', summary: 'x' });
  other.leave();

  await d.page.waitForFunction(() => /فادي يوسف أضاف خبر جديد «خبر جديد من فادي»/.test(document.getElementById('toasts')?.innerText || document.body.innerText), { timeout: 8000 });
  const toast = await d.page.$eval('.toast--action', n => ({ text: n.innerText, button: !!n.querySelector('.toast__action') }));
  assert.ok(toast.button, 'with a button');
  await shot(d.page, '04-toast');
  const last = world.spreadsheet.getSheetByName('Activity').data.at(-1);
  assert.equal(last[13], 'off', 'no push key in this world: logged, and this admin got the toast instead');

  // the button opens it
  await d.page.click('.toast--action .toast__action');
  await d.page.waitForSelector('dialog.sheet[open]');
  await d.page.evaluate(() => A.closeSheet());

  // my own save: no toast about myself
  const before = await d.page.$$eval('.toast', l => l.length);
  await d.page.evaluate(() => A.call('apiSaveItem', 'news', { title: 'خبر مني', summary: 'x' }));
  await sleep(2000);
  const mine = await d.page.$$eval('.toast', l => l.map(n => n.innerText).join('\n'));
  assert.doesNotMatch(mine, /مينا زكريا أضاف/);
  assert.ok((await d.page.$$eval('.toast', l => l.length)) <= Math.max(before, 3));

  assert.deepEqual(d.problems, []);
  await d.close();

});

test('names: renamed from «صلاحيات لوحة التحكم»; a copy is refused; the rail and the log follow', async () => {

  freshWorld();
  const d = await device();
  await signIn(d.page);
  await d.page.evaluate(() => A.go('settings'));
  await d.page.waitForSelector(`.admin[data-email="${SECOND}"] .admin__name`);
  assert.equal(await d.page.$eval(`.admin[data-email="${SECOND}"] .admin__name`, n => n.textContent), 'فادي يوسف');

  // rename
  await d.page.click(`.admin[data-email="${SECOND}"] .icon-btn[title="غيّر الاسم"]`);
  await d.page.waitForSelector('dialog.modal[open] input');
  await d.page.$eval('dialog.modal[open] input', n => { n.value = ''; });
  await d.page.type('dialog.modal[open] input', 'فادي يوسف كامل');
  await shot(d.page, '05-rename');
  await d.page.click('dialog.modal[open] .btn--primary');
  await d.page.waitForFunction(e => document.querySelector(`.admin[data-email="${e}"] .admin__name`)?.textContent === 'فادي يوسف كامل', {}, SECOND);
  assert.equal(JSON.parse(world.properties.get('ADMIN_NAMES'))[SECOND], 'فادي يوسف كامل');

  // a copy of someone else's name: refused, with the reason
  await d.page.click(`.admin[data-email="${SECOND}"] .icon-btn[title="غيّر الاسم"]`);
  await d.page.waitForSelector('dialog.modal[open] input');
  await d.page.$eval('dialog.modal[open] input', n => { n.value = ''; });
  await d.page.type('dialog.modal[open] input', 'مينا  زكريا');
  await d.page.click('dialog.modal[open] .btn--primary');
  await d.page.waitForFunction(() => /مستخدم لأدمن تاني/.test(document.querySelector('.card--admins')?.innerText || ''));

  // logged
  await d.page.evaluate(() => A.go('activity'));
  await d.page.waitForSelector('.acts .act');
  assert.match(await d.page.$eval('.acts', n => n.innerText), /مينا زكريا غيّر اسم «fady\.youssef@gmail\.com» لـ «فادي يوسف كامل»/);

  // the rail shows my name
  assert.match(await d.page.$eval('#rail-foot', n => n.innerText), /مينا زكريا/);

  assert.deepEqual(d.problems, []);
  await d.close();

});

test('layout: the log, its filters and the app card fit a phone (no sideways scroll), and the dock has room', async () => {

  freshWorld();
  const other = fady();
  for (let i = 0; i < 6; i++) other('apiSaveItem', 'news', { title: `خبر رقم ${i} بعنوان طويل شوية علشان نشوف الالتفاف`, summary: 'x' });
  other.leave();

  for (const [name, viewport] of [['phone', PHONE], ['small', SMALL]]) {
    const d = await device({ viewport, ua: ANDROID });
    await signIn(d.page);
    await d.page.evaluate(() => A.go('activity'));
    await d.page.waitForSelector('.acts .act');
    const fit = await d.page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: window.innerWidth,
      dock: [...document.querySelectorAll('#dock .dockbtn')].map(b => {
        const r = b.getBoundingClientRect();
        const label = b.querySelector('.dockbtn__label');
        return { w: r.width, overflow: label ? label.scrollWidth > label.clientWidth + 1 : false };
      })
    }));
    assert.ok(fit.scroll <= fit.width, `${name}: no sideways scroll (${fit.scroll} > ${fit.width})`);
    // seven areas since «المسابقات» (AdminComp)
    assert.equal(fit.dock.length, 7);
    assert.ok(fit.dock.every(b => !b.overflow), `${name}: dock labels fit`);
    await shot(d.page, `06-log-${name}`);

    await d.page.evaluate(() => A.go('settings'));
    await d.page.waitForSelector('.card--app');
    const app = await d.page.$eval('.card--app', n => n.innerText);
    assert.match(app, /إعداد تطبيق الإدارة/);
    assert.match(app, /إشعارات الإدارة/);
    assert.ok(await d.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await d.page.$eval('.card--app', n => n.scrollIntoView());
    await shot(d.page, `07-app-card-${name}`);

    assert.deepEqual(d.problems, []);
    await d.close();
  }

});


/* ---------------- «إعداد تطبيق الإدارة»: what the page can honestly say ---------------- */

/*
 * The platform, staged before the page loads: an app window or a tab
 * (display-mode), the browser's install dialog, and what
 * getInstalledRelatedApps says about the ADMIN app.
 */
function stage({ standalone = false, related = null, prompt = false } = {}) {
  return `(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = q => /display-mode: standalone/.test(q) ? { matches: ${standalone}, media: q, addEventListener() {}, removeEventListener() {} } : real(q);
    ${related === null ? 'delete Navigator.prototype.getInstalledRelatedApps;' : `navigator.getInstalledRelatedApps = async () => ${JSON.stringify(related)};`}
    window.__prompted = 0;
    ${prompt ? `window.addEventListener('load', () => setTimeout(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = () => { window.__prompted++; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    }, 50));` : ''}
  })();`;
}

async function staged(options, path = '') {
  const d = await device({ viewport: PHONE, ua: ANDROID, path, before: stage(options) });
  await signIn(d.page);
  await d.page.evaluate(() => A.go('settings'));
  await d.page.waitForSelector('#app-setup .setup__step');
  await sleep(600);
  const read = () => d.page.$eval('#app-setup', n => ({
    text: n.innerText,
    progress: n.querySelector('.setup__head .chip').textContent,
    install: n.querySelectorAll('.setup__step')[1].className,
    push: n.querySelectorAll('.setup__step')[2].className
  }));
  return { d, read };
}

const ADMIN_MANIFEST = 'https://stathanasiosyouth.github.io/admin/manifest.webmanifest';

test('setup: a Chrome tab with no install dialog → the drawn Chrome-menu guide, nothing claimed installed', async () => {
  freshWorld();
  const { d, read } = await staged({});
  const s = await read();
  assert.match(s.text, /إعداد تطبيق الإدارة/);
  assert.match(s.text, /تسجيل الدخول/);
  assert.match(s.text, /افتح قايمة Chrome/);
  assert.match(s.text, /تثبيت التطبيق/);
  assert.match(s.text, /فتح في تطبيق أسرة البابا أثناسيوس/, 'the old site app trap is explained');
  assert.doesNotMatch(s.text, /مثبتة|متثبتة/);
  assert.match(s.install, /is-next/);
  assert.doesNotMatch(s.install, /is-done/);
  assert.equal(s.progress, '١ من ٣');
  assert.equal(await d.page.$('#app-setup .setup__step:nth-child(2) .btn--primary'), null, 'no dead install button');
  await shot(d.page, '08-setup-android-guide');
  assert.deepEqual(d.problems, []);
  await d.close();
});

test('setup: the browser\'s install dialog is ready → «تثبيت التطبيق» opens it for real', async () => {
  freshWorld();
  const { d } = await staged({ prompt: true });
  await d.page.waitForFunction(() => [...document.querySelectorAll('#app-setup .btn--primary')].some(b => /تثبيت التطبيق/.test(b.textContent)));
  await shot(d.page, '09-setup-install-button');
  await d.page.evaluate(() => [...document.querySelectorAll('#app-setup .btn--primary')].find(b => /تثبيت التطبيق/.test(b.textContent)).click());
  await d.page.waitForFunction(() => window.__prompted === 1);
  await d.page.waitForFunction(() => /اتثبتت/.test(document.getElementById('toasts')?.innerText || ''));
  assert.deepEqual(d.problems, []);
  await d.close();
});

test('setup: an app window that is NOT the admin app (the site\'s, a shortcut) is never called the installed admin app', async () => {
  freshWorld();
  const { d, read } = await staged({ standalone: true, related: [] });
  const s = await read();
  assert.match(s.text, /مش تطبيق «لوحة تحكم الأسرة»/);
  assert.doesNotMatch(s.text, /مثبتة، وانت فاتحها|متثبتة على الجهاز/);
  assert.doesNotMatch(s.install, /is-done/);
  assert.match(await d.page.evaluate(() => A.state && document.querySelector('#app-setup').innerText), /\/admin\//, 'where to open it instead');
  await shot(d.page, '10-setup-other-app');
  await d.close();
});

test('setup: opened from the admin app\'s icon (?app=admin) → installed ✓; notifications are the obvious next step', async () => {
  freshWorld();
  const { d, read } = await staged({ standalone: true, related: null }, '?app=admin');
  const s = await read();
  assert.match(s.text, /لوحة تحكم الأسرة مثبتة، وانت فاتحها كتطبيق/);
  assert.match(s.install, /is-done/);
  assert.match(s.push, /is-next/);
  assert.equal(s.progress, '٢ من ٣');
  assert.ok(await d.page.$('#app-setup .setup__step.is-next .btn--primary'), 'the push button is the primary action');
  // the address keeps the mark through a link (reloads stay "the app")
  await d.page.evaluate(() => { location.hash = '#activity'; });
  await d.page.waitForSelector('.acts');
  assert.equal(await d.page.evaluate(() => location.search), '?app=admin');
  await shot(d.page, '11-setup-admin-app');
  assert.deepEqual(d.problems, []);
  await d.close();
});

test('setup: a Chrome tab where the browser says the ADMIN app is installed → «متثبتة»; another installed app doesn\'t count', async () => {
  freshWorld();
  const yes = await staged({ related: [{ platform: 'webapp', url: ADMIN_MANIFEST }] });
  assert.match((await yes.read()).text, /متثبتة على الجهاز ده/);
  await yes.d.close();
  const other = await staged({ related: [{ platform: 'webapp', url: 'https://stathanasiosyouth.github.io/manifest.webmanifest' }] });
  assert.doesNotMatch((await other.read()).text, /متثبتة على الجهاز ده/, 'the site\'s app is not the admin app');
  await other.d.close();
});

test('home: one nudge while setup isn\'t finished; «مش دلوقتي» hides it (and stays hidden after a reload)', async () => {
  freshWorld();
  const d = await device({ viewport: PHONE, ua: ANDROID, before: stage({}) });
  await signIn(d.page);
  await d.page.waitForSelector('.dash-setup:not([hidden])');
  assert.match(await d.page.$eval('.dash-setup', n => n.innerText), /ثبّت «لوحة تحكم الأسرة»/);
  await shot(d.page, '12-home-nudge');
  await d.page.evaluate(() => [...document.querySelectorAll('.dash-setup .btn')].find(b => /كمّل/.test(b.textContent)).click());
  await d.page.waitForFunction(() => A.area === 'settings');
  await d.page.evaluate(() => { A.go('home'); });
  await d.page.waitForSelector('.dash-setup:not([hidden])');
  await d.page.evaluate(() => [...document.querySelectorAll('.dash-setup .btn')].find(b => /مش دلوقتي/.test(b.textContent)).click());
  assert.equal(await d.page.$('.dash-setup'), null);
  await d.page.evaluate(() => A.render());
  await sleep(500);
  assert.equal(await d.page.$('.dash-setup:not([hidden])'), null, 'not again for a while');
  assert.deepEqual(d.problems, []);
  await d.close();
});


/* ---------------- «خليك داخل»: the installed admin app remembers this phone ---------------- */

/* the admin app on this "phone": its own window, opened from its icon */
async function launch(context) {
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  await page.setUserAgent(ANDROID);
  await page.setViewport(PHONE);
  await interceptGoogle(page, { post: body => world.post(body) });
  await page.evaluateOnNewDocument(stage({ standalone: true }));
  await page.goto(`${LOCAL}/admin/?app=admin`, { waitUntil: 'networkidle0' });
  return { page, problems };
}

const devices = () => [...world.properties.keys()].filter(k => k.startsWith('ADMIN_DEVICE_'));

test('stay signed in: Google once in the app → later launches open the panel with no Google screen; Logout ends it (device + admin push)', async () => {
  freshWorld();
  const context = await browser.createBrowserContext();

  // first launch: Google, then this phone is remembered
  const first = await launch(context);
  await signIn(first.page);
  await first.page.waitForFunction(() => true);
  for (let i = 0; i < 40 && !devices().length; i++) await sleep(150);
  assert.equal(devices().length, 1, 'a device credential after the Google sign-in');
  const stored = await first.page.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open('athanasios-admin-device');
    open.onsuccess = () => {
      const get = open.result.transaction('device').objectStore('device').get('current');
      get.onsuccess = () => resolve({ extractable: get.result.key.extractable, type: get.result.key.type, keys: Object.keys(get.result).sort() });
    };
  }));
  assert.deepEqual(stored, { extractable: false, type: 'secret', keys: ['deviceId', 'key', 'until'] }, 'only a key that can\'t be read back');
  await first.page.close();

  // the app killed and opened again: straight in, no Google
  const issued = world.tokeninfo.calls;
  const again = await launch(context);
  await again.page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
  assert.equal(await again.page.$('.gis-stub'), null, 'no Google button');
  assert.equal(world.tokeninfo.calls, issued, 'no Google token checked');
  assert.equal(await again.page.evaluate(() => A.state.user), ADMIN);
  await shot(again.page, '13-relaunch-no-google');

  // something that needs Google itself: asked once, then done
  await again.page.evaluate(() => { window.__added = A.call('apiAddAdmin', 'new.admin@gmail.com').then(() => 'ok', e => A.parseError(e).message); });
  await again.page.waitForSelector('dialog.reauth[open] .gis-stub', { timeout: 8000 });
  await again.page.click('dialog.reauth[open] .gis-stub');
  assert.equal(await again.page.evaluate(() => window.__added), 'ok');
  assert.match(world.properties.get('ADMIN_EMAILS'), /new\.admin/);

  // admin notifications on this device (the server's row), then «خروج»
  const sid = await again.page.evaluate(() => A.state && true);
  assert.ok(sid);
  world.gs.apiAdminPushSubscribe; // (subscribing needs a real push service; the row is checked below by token)
  await again.page.evaluate(() => {
    // as admin/push.js leaves it after «فعّل»: its mark for this device
    localStorage.setItem('athanasios-admin.push', JSON.stringify({ token: 'a001Xk2:APA91b' + 'Z'.repeat(140) + '1', at: Date.now() }));
  });
  await again.page.evaluate(token => A.call('apiAdminPushSubscribe', { token, platform: 'android' }), 'a001Xk2:APA91b' + 'Z'.repeat(140) + '1');
  assert.equal(world.spreadsheet.getSheetByName('AdminPushSubs').data.slice(1).filter(r => r[0]).length, 1);
  await again.page.evaluate(() => { A.signOut(); });
  await again.page.waitForSelector('.gis-stub', { timeout: 15000 });
  assert.equal(devices().length, 0, 'the device credential is gone on the server');
  assert.equal(world.spreadsheet.getSheetByName('AdminPushSubs').data.slice(1).filter(r => r[0]).length, 0, 'and this device gets no admin notifications');
  assert.equal(await again.page.evaluate(() => localStorage.getItem('athanasios-admin.push')), null);
  await again.page.close();

  // after Logout: Google again
  const after = await launch(context);
  await after.page.waitForSelector('.gis-stub', { timeout: 15000 });
  await after.page.close();
  await context.close();
});

test('stay signed in: a browser tab never keeps anything; a removed admin\'s phone is back at Google', async () => {
  freshWorld();
  // a tab (not the installed app): no device credential
  const tab = await device({ viewport: PHONE, ua: ANDROID });
  await signIn(tab.page);
  await sleep(1500);
  assert.equal(devices().length, 0, 'nothing remembered in a browser tab');
  await tab.close();

  // the app for Fady, then he is removed
  const context = await browser.createBrowserContext();
  const app = await launch(context);
  await signIn(app.page, SECOND);
  for (let i = 0; i < 40 && !devices().length; i++) await sleep(150);
  assert.equal(devices().length, 1);
  await app.page.close();
  world.gs.forgetTrustedDevices_(SECOND);
  world.properties.set('ADMIN_EMAILS', ADMIN);
  const again = await launch(context);
  await again.page.waitForSelector('.gis-stub', { timeout: 15000 });
  await again.page.close();
  await context.close();
});
