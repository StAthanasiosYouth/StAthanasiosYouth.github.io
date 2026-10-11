// The admin app (PWA) next to the public site's, statically and in a fake
// service-worker scope: its own manifest (id / scope /admin/), its own
// worker (admin/sw.js: push and taps only, links only into /admin/), its
// own Firebase copy (a separate token database, so the visitor token on
// the same phone is never touched) — and the public PWA unchanged.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { ROOT } from '../tools/lib/gs.mjs';

const sharp = createRequire(`${ROOT}tools/package.json`)('sharp');

const ORIGIN = 'https://stathanasiosyouth.github.io';
const read = path => readFileSync(`${ROOT}${path}`, 'utf8');


/* ---------------- manifests ---------------- */

test('manifest: the admin app is its own app (id, scope, start /admin/), named as agreed', () => {
  const admin = JSON.parse(read('admin/manifest.webmanifest'));
  const site = JSON.parse(read('manifest.webmanifest'));

  assert.equal(admin.id, '/admin/');
  // ?app=admin: the page can tell it was opened as the admin app (not a tab, not another app)
  assert.equal(admin.start_url, '/admin/?app=admin');
  assert.equal(admin.scope, '/admin/');
  assert.deepEqual(admin.related_applications, [{ platform: 'webapp', url: 'https://stathanasiosyouth.github.io/admin/manifest.webmanifest' }]);
  assert.equal(admin.display, 'standalone');
  assert.equal(admin.short_name, 'لوحة تحكم الأسرة');
  assert.equal(admin.name, 'إدارة أسرة البابا أثناسيوس - سفاجا');
  assert.equal(admin.dir, 'rtl');
  assert.equal(admin.lang, 'ar');
  assert.notEqual(admin.id, site.id, 'two apps, not one');

  // the public app keeps its id and name; its scope is /index.html so that it never contains /admin/
  // (nested scopes: Android gives /admin/ to the site's WebAPK and never installs the admin one)
  assert.equal(site.id, '/');
  assert.equal(site.scope, '/index.html');
  assert.equal(site.start_url, '/index.html');
  assert.equal(site.name, 'أسرة البابا أثناسيوس - سفاجا');
  const inScope = (path, scope) => path.startsWith(scope);
  assert.equal(inScope('/admin/', site.scope), false, 'the admin is outside the site app');
  assert.equal(inScope('/index.html', admin.scope), false, 'and the site outside the admin app');
  assert.equal(inScope(new URL(admin.start_url, 'https://x/').pathname, admin.scope), true);
});

test('manifest: the admin icons exist at their sizes, and they are not the site\'s', async () => {
  const admin = JSON.parse(read('admin/manifest.webmanifest'));
  assert.ok(admin.icons.some(i => i.purpose === 'maskable'));
  for (const icon of admin.icons) {
    const path = icon.src.replace(/^\//, '');
    assert.ok(existsSync(`${ROOT}${path}`), path);
    const meta = await sharp(`${ROOT}${path}`).metadata();
    assert.equal(`${meta.width}x${meta.height}`, icon.sizes, path);
    assert.ok(path.startsWith('admin/'), 'the admin\'s own icon');
  }
  const apple = await sharp(`${ROOT}admin/apple-touch-icon.png`).metadata();
  assert.equal(apple.width, 180);
  assert.notEqual(readFileSync(`${ROOT}admin/icon-192.png`).toString('base64'), readFileSync(`${ROOT}assets/img/icon-192.png`).toString('base64'));
});

test('admin page: links its manifest and iPhone metadata; the public page keeps its own', () => {
  const html = read('admin/index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="apple-touch-icon\.png">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="لوحة تحكم الأسرة">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  const site = read('index.html');
  assert.match(site, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.doesNotMatch(site, /admin\/manifest/);
});


/* ---------------- the admin worker ---------------- */

function worker({ windows = [] } = {}) {

  const listeners = {};
  const shown = [];
  const opened = [];
  const posted = [];
  const focused = [];

  const clientList = windows.map(url => ({
    url,
    postMessage: message => posted.push({ url, message }),
    focus: async () => { focused.push(url); }
  }));

  const self = {
    location: new URL(`${ORIGIN}/admin/sw.js`),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
    clients: {
      claim: async () => {},
      matchAll: async () => clientList,
      openWindow: async url => { opened.push(url); }
    }
  };

  vm.runInNewContext(read('admin/sw.js'), { self, URL, console }, { filename: 'admin/sw.js' });

  const fire = async (type, event) => {
    let waiting = null;
    listeners[type]({ ...event, waitUntil: promise => { waiting = promise; } });
    await waiting;
  };

  return {
    listeners, shown, opened, posted, focused,
    push: payload => fire('push', { data: payload === undefined ? null : { json: () => payload } }),
    click: data => fire('notificationclick', { notification: { data, close() {} } })
  };

}

test('admin/sw.js: no fetch handler, no cache — push and taps only', () => {
  const code = read('admin/sw.js');
  assert.doesNotMatch(code, /addEventListener\('fetch'|caches\.|importScripts/);
  const w = worker();
  assert.deepEqual(Object.keys(w.listeners).sort(), ['activate', 'install', 'notificationclick', 'push']);
});

test('admin/sw.js: an admin push becomes an Arabic RTL notification; links only into /admin/', async () => {
  const w = worker();
  await w.push({ data: { kind: 'admin', id: 'act-0123456789ab', title: 'فادي يوسف عدّل اجتماع الأحد', body: 'اتغيّر: الموضوع', url: '/admin/#open/sessions/2026-10-11', tag: 'adm-sessions-2026-10-11' } });
  const [n] = w.shown;
  assert.equal(n.title, 'فادي يوسف عدّل اجتماع الأحد');
  assert.equal(n.options.dir, 'rtl');
  assert.equal(n.options.lang, 'ar');
  assert.equal(n.options.icon, '/admin/icon-192.png');
  assert.equal(n.options.tag, 'adm-sessions-2026-10-11');
  assert.equal(n.options.data.url, '/admin/#open/sessions/2026-10-11');

  const urls = {
    '/admin/#activity/act-0123456789ab': '/admin/#activity/act-0123456789ab',
    '/admin/#activity': '/admin/#activity',
    '/admin/#open/settings': '/admin/#open/settings',
    '/admin/#open/news/news-ab12cd34': '/admin/#open/news/news-ab12cd34',
    '/#news/news-ab12cd34': '/admin/',
    '/admin/#open/news/<script>': '/admin/',
    'https://evil.example/admin/#activity': '/admin/',
    'javascript:alert(1)': '/admin/',
    '/admin/other.html#activity': '/admin/',
    '': '/admin/'
  };
  for (const [from, to] of Object.entries(urls)) {
    const fresh = worker();
    await fresh.push({ data: { title: 'x', url: from } });
    assert.equal(fresh.shown[0].options.data.url, to, from);
  }

  // broken payloads still show something
  const empty = worker();
  await empty.push(undefined);
  assert.equal(empty.shown[0].title, 'لوحة تحكم الأسرة');
});

test('admin/sw.js: a tap focuses an open admin window and tells it where to go; else opens the admin app', async () => {
  const open = worker({ windows: [`${ORIGIN}/`, `${ORIGIN}/admin/`] });
  await open.click({ url: '/admin/#open/news/news-ab12cd34' });
  assert.deepEqual(open.focused, [`${ORIGIN}/admin/`], 'the admin window, never the site\'s');
  assert.deepEqual(JSON.parse(JSON.stringify(open.posted)), [{ url: `${ORIGIN}/admin/`, message: { type: 'athanasios-admin:open', url: `${ORIGIN}/admin/#open/news/news-ab12cd34` } }]);
  assert.deepEqual(open.opened, []);

  const none = worker({ windows: [`${ORIGIN}/`] });
  await none.click({ url: '/admin/#activity/act-0123456789ab' });
  assert.deepEqual(none.opened, ["/admin/?app=admin#activity/act-0123456789ab"], "the admin app's own start address");
});

test('the public sw.js still never handles admin windows (unchanged)', () => {
  const code = read('sw.js');
  assert.match(code, /at\.pathname === '\/' \|\| at\.pathname === HOME/, 'the site page only, never an admin window');
  assert.match(code, /const HOME = '\/index\.html';/, 'taps open the installed site app');
});


/* ---------------- Firebase: two copies, two token databases ---------------- */

test('admin Firebase copy keeps its token in its own database; the site\'s copy is unchanged', () => {
  const admin = read('admin/vendor/firebase-messaging-admin.js');
  const site = read('assets/vendor/firebase-messaging.js');
  assert.ok(admin.includes("'athanasios-admin-messaging-database'"));
  assert.ok(!admin.includes("'firebase-messaging-database'"), 'never the visitor token database');
  assert.ok(site.includes('"firebase-messaging-database"') || site.includes("'firebase-messaging-database'"), 'the site keeps the standard one');
  assert.ok(!site.includes('athanasios-admin-messaging-database'));
});

test('admin/push.js: the admin copy, its own Firebase app name, the API (never the public push actions)', () => {
  const code = read('admin/push.js');
  assert.match(code, /import\('\.\/vendor\/firebase-messaging-admin\.js'\)/);
  assert.doesNotMatch(code, /assets\/vendor\/firebase-messaging\.js/);
  assert.match(code, /'athanasios-admin-push'/);
  assert.doesNotMatch(code, /'athanasios-push'/, 'not the site\'s Firebase app name');
  assert.doesNotMatch(code, /pushSubscribe'|pushUnsubscribe'/, 'never the public actions');
  assert.match(code, /apiAdminPushSubscribe/);
  // the public client keeps its own copy and app
  const site = read('assets/js/push.js');
  assert.match(site, /'\.\.\/vendor\/firebase-messaging\.js'/);
  assert.match(site, /'athanasios-push'/);
});

test('boot.js: the admin worker is /admin/sw.js with scope /admin/; still no persistent storage in boot.js', () => {
  const boot = read('admin/boot.js');
  assert.match(boot, /serviceWorker\.register\('sw\.js', \{ scope: '\.\/' \}\)/);
  assert.doesNotMatch(boot, /register\('\/sw\.js'/);
  assert.doesNotMatch(boot, /localStorage|indexedDB|document\.cookie/);
  assert.match(boot, /requestPermission/);
});
