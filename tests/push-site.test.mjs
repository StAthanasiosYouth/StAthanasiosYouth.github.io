// Web push, site side: sw.js (what a push shows, where a tap goes),
// push-env.js (what this browser can do), the manifest and icons, the
// CSP vs. the vendored Firebase bundle, and the public config.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { ROOT, loadGs } from '../tools/lib/gs.mjs';
import { pushSupport, platformOf, loadMemo, saveMemo, shouldNudge, pushRequest, pushReplyOk, MEMO_KEY } from '../assets/js/push-env.js';
import { buildPushVendor } from '../tools/build-push-vendor.mjs';

const require = createRequire(new URL('../tools/package.json', import.meta.url));
const sharp = require('sharp');
const ORIGIN = 'https://stathanasiosyouth.github.io';


/* =========================================================
   sw.js in a fake service-worker scope
========================================================= */

function worker({ windows = [] } = {}) {

  const listeners = {};
  const shown = [];
  const opened = [];
  const posted = [];
  const focused = [];
  let claimed = false;

  const clientList = windows.map(url => ({
    url,
    postMessage: message => posted.push({ url, message }),
    focus: async () => { focused.push(url); }
  }));

  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
    clients: {
      claim: async () => { claimed = true; },
      matchAll: async () => clientList,
      openWindow: async url => { opened.push(url); }
    }
  };

  vm.runInNewContext(readFileSync(`${ROOT}sw.js`, 'utf8'), { self, URL, console }, { filename: 'sw.js' });

  const fire = async (type, event) => {
    let waiting = null;
    listeners[type]({ ...event, waitUntil: promise => { waiting = promise; } });
    await waiting;
  };

  return {
    listeners, shown, opened, posted, focused,
    get claimed() { return claimed; },
    push: payload => fire('push', { data: payload === undefined ? null : { json: () => (typeof payload === 'string' ? JSON.parse(payload) : payload) } }),
    click: data => {
      const notification = { data, closed: false, close() { this.closed = true; } };
      return fire('notificationclick', { notification }).then(() => notification);
    }
  };

}


test('sw.js: no fetch handler, no cache — push and notification taps only', () => {
  const code = readFileSync(`${ROOT}sw.js`, 'utf8');
  const sw = worker();
  assert.deepEqual(Object.keys(sw.listeners).sort(), ['activate', 'install', 'notificationclick', 'push']);
  assert.doesNotMatch(code, /caches\.|addEventListener\(\s*'fetch'|importScripts|firebase/);
});

test('sw.js: an FCM data message becomes an Arabic RTL notification with the item\'s link', async () => {
  const sw = worker();
  await sw.push({
    data: { id: 'notif-session-1', title: 'اجتماع الأحد الجديد 🔔', body: 'موضوع الأسبوع اتنشر.. مستنيينكم الأحد الساعة 8 ❤️', url: '/#meeting', tag: 'n-notif-session-1' },
    from: '824621770400', fcmMessageId: 'x'
  });
  assert.equal(sw.shown.length, 1);
  const { title, options } = sw.shown[0];
  assert.equal(title, 'اجتماع الأحد الجديد 🔔');
  assert.equal(options.body, 'موضوع الأسبوع اتنشر.. مستنيينكم الأحد الساعة 8 ❤️');
  assert.equal(options.dir, 'rtl');
  assert.equal(options.lang, 'ar');
  assert.equal(options.tag, 'n-notif-session-1', 'the same item twice replaces itself');
  assert.equal(options.renotify, false);
  assert.equal(options.icon, '/assets/img/icon-192.png');
  assert.equal(options.badge, '/assets/img/push-badge.png');
  assert.deepEqual({ ...options.data }, { url: '/#meeting', id: 'notif-session-1' });
  assert.equal(options.image, undefined);
});

test('sw.js: pictures only from the site\'s own media; links only to the site\'s own deep links', async () => {
  const sw = worker();
  const show = async data => { await sw.push({ data }); return sw.shown.at(-1).options; };
  assert.equal((await show({ title: 'x', image: '/media/2026/img-af6b0c28.webp' })).image, '/media/2026/img-af6b0c28.webp');
  for (const image of ['https://evil.example/x.png', '//evil.example/x.png', '/media/../x.webp.svg', 'javascript:alert(1)', '/assets/x.svg']) {
    assert.equal((await show({ title: 'x', image })).image, undefined, image);
  }
  const url = async value => (await show({ title: 'x', url: value })).data.url;
  assert.equal(await url('/#news/news-aaaa1111'), '/#news/news-aaaa1111');
  assert.equal(await url('/#activity/act-1'), '/#activity/act-1');
  assert.equal(await url('/#notifications'), '/#notifications');
  for (const bad of ['https://evil.example/#meeting', 'javascript:alert(1)', '/admin/#meeting', '/#news/', '/#news/<x>', '/?x=1#settings', 42, null]) {
    assert.equal(await url(bad), '/', String(bad));
  }
});

test('sw.js: an empty or broken push still shows something (Safari requires it)', async () => {
  const sw = worker();
  await sw.push(undefined);
  await sw.push('not json');
  await sw.push({ data: { title: '', body: 5, tag: 'x y' } });
  assert.equal(sw.shown.length, 3);
  for (const { title, options } of sw.shown) {
    assert.equal(title, 'أسرة البابا أثناسيوس');
    assert.equal(options.tag, 'athanasios');
    assert.equal(options.data.url, '/');
  }
  // long text is cut, whitespace folded
  await sw.push({ data: { title: 'ع'.repeat(200), body: 'a\n\n b   c' } });
  assert.equal(sw.shown.at(-1).title.length, 80);
  assert.equal(sw.shown.at(-1).options.body, 'a b c');
});

test('sw.js: a tap brings the open site forward and lets its router open the item', async () => {
  const sw = worker({ windows: [`${ORIGIN}/admin/`, `${ORIGIN}/#news/old`] });
  const notification = await sw.click({ url: '/#news/news-aaaa1111' });
  assert.equal(notification.closed, true);
  assert.deepEqual(JSON.parse(JSON.stringify(sw.posted)), [{ url: `${ORIGIN}/#news/old`, message: { type: 'athanasios:open', url: `${ORIGIN}/#news/news-aaaa1111` } }]);
  assert.deepEqual(sw.focused, [`${ORIGIN}/#news/old`]);
  assert.deepEqual(sw.opened, [], 'no second window, and never the admin');
});

test('sw.js: with no site window open, a tap opens the deep link', async () => {
  const sw = worker({ windows: [`${ORIGIN}/admin/`] });
  await sw.click({ url: '/#meeting' });
  assert.deepEqual(sw.opened, [`${ORIGIN}/#meeting`]);
  const bare = worker();
  await bare.click(null);
  assert.deepEqual(bare.opened, [`${ORIGIN}/`]);
});

test('sw.js and Push.gs agree: every link the server builds survives the worker', async () => {
  const gs = loadGs(['Push.gs']);
  const sw = worker();
  const targets = [null, { kind: 'meeting' }, { kind: 'news', id: 'news-aaaa1111' }, { kind: 'game', id: 'game-1' }, { kind: 'activity', id: 'act-1' }, { kind: 'url', url: 'https://x.com/' }];
  for (const target of targets) {
    const url = gs.pushUrl_(target);
    await sw.push({ data: { title: 'x', url } });
    assert.equal(sw.shown.at(-1).options.data.url, url, JSON.stringify(target));
  }
  const message = gs.pushMessage_({ id: 'n1', title: 'x', message: 'y', target: null, image: { src: 'media/2026/img-af6b0c28.webp' } }, {});
  await sw.push({ data: message });
  assert.equal(sw.shown.at(-1).options.image, '/media/2026/img-af6b0c28.webp');
});


/* =========================================================
   push-env.js
========================================================= */

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  instagram: 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36 Instagram 350.0',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
};

function env(ua, { push = true, standalone = false, platform = '', touch = 0, secure = true } = {}) {
  const navigator = { userAgent: ua, platform, maxTouchPoints: touch, ...(push ? { serviceWorker: {} } : {}), ...(standalone ? { standalone: true } : {}) };
  return {
    navigator,
    isSecureContext: secure,
    matchMedia: () => ({ matches: standalone }),
    ...(push ? { PushManager: function () {}, Notification: function () {} } : {})
  };
}

test('push-env: what each browser is offered', () => {
  assert.equal(pushSupport(env(UA.androidChrome)), 'ok');
  assert.equal(pushSupport(env(UA.windows)), 'ok');
  // iPhone Safari tab: no Push API there — add to the Home Screen first
  assert.equal(pushSupport(env(UA.iphoneSafari, { push: false })), 'ios-install');
  assert.equal(pushSupport(env(UA.iphoneChrome, { push: false })), 'ios-safari');
  assert.equal(pushSupport(env(UA.ipad, { push: false, platform: 'MacIntel', touch: 5 })), 'ios-install');
  // the Home Screen app on iOS 16.4+: the Push API is there
  assert.equal(pushSupport(env(UA.iphoneSafari, { push: true, standalone: true })), 'ok');
  // Home Screen app on an older iOS: nothing to offer
  assert.equal(pushSupport(env(UA.iphoneSafari, { push: false, standalone: true })), 'unsupported');
  assert.equal(pushSupport(env(UA.instagram)), 'inapp');
  assert.equal(pushSupport(env(UA.windows, { secure: false })), 'unsupported');
  assert.equal(pushSupport(env(UA.windows, { push: false })), 'unsupported');
});

test('push-env: platform names match the server\'s list', () => {
  assert.equal(platformOf(env(UA.androidChrome)), 'android');
  assert.equal(platformOf(env(UA.iphoneSafari)), 'ios');
  assert.equal(platformOf(env(UA.ipad, { platform: 'MacIntel', touch: 5 })), 'ios');
  assert.equal(platformOf(env(UA.ipad, { platform: 'MacIntel', touch: 0 })), 'desktop');
  assert.equal(platformOf(env(UA.windows)), 'desktop');
  assert.equal(platformOf(env('Mozilla/5.0 (PlayStation)')), 'other');
  const gs = loadGs(['Push.gs']);
  assert.deepEqual([...gs.PUSH_PLATFORMS], ['android', 'ios', 'desktop', 'other']);
});

test('push-env: the invitation — from the second visit, at most twice, a week apart, never when on', () => {
  const now = Date.UTC(2026, 9, 11);
  const week = 7 * 86400000;
  assert.equal(shouldNudge({}, now), false, 'first visit');
  assert.equal(shouldNudge({ visits: 1 }, now), false);
  assert.equal(shouldNudge({ visits: 2 }, now), true);
  assert.equal(shouldNudge({ visits: 5, nudges: 1, nudgedAt: now - week + 1000 }, now), false);
  assert.equal(shouldNudge({ visits: 5, nudges: 1, nudgedAt: now - week }, now), true);
  assert.equal(shouldNudge({ visits: 9, nudges: 2, nudgedAt: 0 }, now), false);
  assert.equal(shouldNudge({ visits: 9, token: 'x' }, now), false);
});

test('push-env: the memo survives broken storage; requests and replies', () => {
  const store = new Map();
  const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(loadMemo(storage), {});
  saveMemo({ token: 't', at: 1 }, storage);
  assert.deepEqual(loadMemo(storage), { token: 't', at: 1 });
  store.set(MEMO_KEY, '{bad');
  assert.deepEqual(loadMemo(storage), {});
  store.set(MEMO_KEY, '[1]');
  assert.deepEqual(loadMemo(storage), {});
  assert.deepEqual(loadMemo({ getItem() { throw new Error('blocked'); } }), {});
  saveMemo({ a: 1 }, { setItem() { throw new Error('full'); } });
  assert.deepEqual(JSON.parse(pushRequest('pushSubscribe', { token: 't' })), { fn: 'pushSubscribe', args: [{ token: 't' }] });
  assert.equal(pushReplyOk({ ok: true }), true);
  for (const reply of [null, {}, { ok: 'true' }, { ok: false, code: 'busy' }, 'ok']) assert.equal(pushReplyOk(reply), false);
  // main.js reads the same memo key without importing push-env.js
  assert.match(readFileSync(`${ROOT}assets/js/main.js`, 'utf8'), new RegExp(`const PUSH_MEMO = '${MEMO_KEY.replace(/\./g, '\\.')}'`));
});


/* =========================================================
   manifest, icons, page, config, vendor
========================================================= */

test('manifest: installable, standalone, Arabic RTL, every icon present at its size', async () => {
  const manifest = JSON.parse(readFileSync(`${ROOT}manifest.webmanifest`, 'utf8'));
  assert.equal(manifest.display, 'standalone', 'iPhone needs a Home Screen web app for push');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.dir, 'rtl');
  assert.equal(manifest.lang, 'ar');
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    const file = `${ROOT}${icon.src.slice(1)}`;
    assert.ok(existsSync(file), icon.src);
    const meta = await sharp(file).metadata();
    assert.equal(`${meta.width}x${meta.height}`, icon.sizes, icon.src);
    assert.equal(meta.format, 'png');
  }
  const badge = await sharp(`${ROOT}assets/img/push-badge.png`).metadata();
  assert.equal(badge.width, 96);
  assert.equal(badge.hasAlpha, true);
});

test('index.html: links the manifest; the service worker is at the root (scope /)', () => {
  const html = readFileSync(`${ROOT}index.html`, 'utf8');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.ok(existsSync(`${ROOT}sw.js`));
  assert.match(readFileSync(`${ROOT}assets/js/push.js`, 'utf8'), /const SW_URL = '\/sw\.js';/);
  // the page never asks for permission by itself: only push.js, only inside enable()
  for (const file of ['main.js', 'bell.js', 'push-env.js']) {
    assert.doesNotMatch(readFileSync(`${ROOT}assets/js/${file}`, 'utf8'), /requestPermission/, file);
  }
  const push = readFileSync(`${ROOT}assets/js/push.js`, 'utf8');
  assert.equal(push.match(/requestPermission/g).length, 1);
  assert.match(push, /async function enable\(\) \{[\s\S]*?await Notification\.requestPermission\(\)/);
});

test('CSP allows exactly the hosts the Firebase bundle talks to; the bundle is current', async () => {
  const html = readFileSync(`${ROOT}index.html`, 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  const connect = csp.split(';').map(s => s.trim().split(/\s+/)).find(([k]) => k === 'connect-src').slice(1);
  const vendor = readFileSync(`${ROOT}assets/vendor/firebase-messaging.js`, 'utf8');
  const hosts = [...new Set([...vendor.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)].map(m => m[1]))]
    .filter(host => !/github\.com$/.test(host));
  assert.deepEqual(hosts.sort(), ['fcmregistrations.googleapis.com', 'firebaseinstallations.googleapis.com']);
  for (const host of hosts) assert.ok(connect.includes(`https://${host}`), host);
  assert.doesNotMatch(vendor, /\beval\(|new Function\(/);
  const { code } = await buildPushVendor();
  // (a Windows checkout may turn its line ends into CRLF)
  assert.equal(vendor.replace(/\r\n/g, '\n'), code, 'assets/vendor/firebase-messaging.js is stale: cd tools && npm run build-push-vendor');
});

test('push config: the VAPID key is a real P-256 public key (a mistyped one makes FCM answer 401)', async () => {
  const { PUSH_CONFIG } = await import('../assets/js/push-config.js');
  const raw = Buffer.from(PUSH_CONFIG.vapidKey, 'base64url');
  assert.equal(raw.length, 65);
  assert.equal(raw[0], 4, 'uncompressed point');
  await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
});

test('push config: public values only, and the same API deployment as the admin and the map', () => {
  const config = readFileSync(`${ROOT}assets/js/push-config.js`, 'utf8');
  const exec = text => /https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/.exec(text)[0];
  assert.equal(exec(config), exec(readFileSync(`${ROOT}admin/config.js`, 'utf8')));
  assert.equal(exec(config), exec(readFileSync(`${ROOT}assets/js/map-config.js`, 'utf8')));
  assert.doesNotMatch(config, /PRIVATE KEY|private_key|client_email|AAAA[\w-]{100,}/);
  // nothing secret anywhere on the public site or in the repo's apps-script code
  for (const file of ['assets/js/push.js', 'assets/js/push-env.js', 'sw.js', 'apps-script/Push.gs']) {
    assert.doesNotMatch(readFileSync(`${ROOT}${file}`, 'utf8'), /-----BEGIN PRIVATE KEY-----|"private_key"\s*:/, file);
  }
});
