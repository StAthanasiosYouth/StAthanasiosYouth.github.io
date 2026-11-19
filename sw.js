/**
 * SERVICE WORKER: push notifications, and «خبزنا اليومي» offline.
 *
 * The site itself has no cache here: the page, content.json and every
 * asset keep coming from the network exactly as before (a cached
 * content.json could show stale meetings). The one exception is
 * «خبزنا اليومي» (docs/daily-bread/PLAN.md W5): its page, its files and
 * today's reading are kept (network first, the copy only when the network
 * fails), so the reading stays there when the connection drops. Every other
 * request is never touched (no respondWith). This file also
 *  - shows a push (sent by apps-script/Push.gs through Firebase Cloud
 *    Messaging as a data-only message) as a notification, and
 *  - opens the site at the item's deep link when it is tapped.
 *
 * Registered by assets/js/push.js when a visitor turns notifications on.
 * Payload (FCM wraps it as { data: {...}, from, ... }):
 *   { id, title, body, url: '/#news/<id>' | '/#meeting' | '/' | '/competition/<slug>/' | '/points/'
 *                          | '/events/<slug>/' | '/<slug>/' (a service page), image?, tag }
 * A tap opens /index.html#… : the installed site app's own address (its
 * scope is /index.html, so the admin app at /admin/ is a separate app on
 * Android — manifest.webmanifest). '/' and '/index.html' are the same page.
 * Anything unexpected falls back to safe defaults: a push must always show
 * a notification (Safari revokes push for sites that stay silent).
 */

'use strict';

const SITE_NAME = 'أسرة البابا أثناسيوس - سفاجا';
const ICON = '/assets/img/icon-192.png';
const BADGE = '/assets/img/push-badge.png';
const BREAD_ICON = '/assets/img/bread/mark-192.png';
const BREAD_IMAGE = '/assets/img/bread/push-image.webp';
const HOME = '/index.html';
const ROUTE = /^#(?:notifications|meeting|points|(?:news|game|activity)\/[\w-]{1,60}|competition\/[a-z0-9-]{2,40}|(?:event|page)\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9]))$/;
/* the site's other pages a tap may open: a competition (the engine), «نقاطي», «خبزنا اليومي», an event,
   or a service page at the top level (docs/EVENTS.md §17.8; assets/js/page/model.js) */
const FIXED_PAGE = /^\/(?:competition\/[a-z0-9-]{2,40}|points|daily-bread|events\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9]))\/$/;
const TOP_PAGE = /^\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9]))\/$/;
const RESERVED = ['admin', 'assets', 'media', 'points', 'competition', 'events', 'pages', 'privacy', 'terms',
  'review', 'tools', 'docs', 'tests', 'apps-script', 'index', 'preview', 'new', 'card-athanasios', 'account', 'daily-bread'];
const PAGE = { test: path => FIXED_PAGE.test(path) || (TOP_PAGE.test(path) && !RESERVED.includes(TOP_PAGE.exec(path)[1])) };
const IMAGE = /^\/media\/[\w./-]{1,200}\.(?:webp|jpe?g|png)$/;


function text(value, max) {

  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

}


/* only this site's own page, with one of its deep links, as /index.html#… — or a
   competition page / «نقاطي» exactly (no query, no hash); anything else = the home page */
function safeUrl(value) {

  try {
    const url = new URL(String(value || '/'), self.location.origin);
    if (url.origin !== self.location.origin) return HOME;
    if (PAGE.test(url.pathname)) return url.pathname;
    if (url.pathname !== '/' && url.pathname !== HOME) return HOME;
    const top = /^#page\/(.+)$/.exec(url.hash);
    return ROUTE.test(url.hash) && !(top && RESERVED.includes(top[1])) ? HOME + url.hash : HOME;
  }
  catch {
    return HOME;
  }

}


/* the push's data → showNotification(title, options) */
function notificationFrom(data) {

  data = data && typeof data === 'object' ? data : {};

  const tag = /^[\w-]{1,80}$/.test(data.tag || '') ? data.tag : 'athanasios';
  const options = {
    body: text(data.body, 240),
    icon: ICON,
    badge: BADGE,
    // the same item twice replaces itself quietly instead of stacking
    tag,
    renotify: false,
    lang: 'ar',
    dir: 'rtl',
    data: { url: safeUrl(data.url), id: text(data.id, 80) }
  };

  if (typeof data.image === 'string' && IMAGE.test(data.image)) {
    options.image = data.image;
  }

  // «خبزنا اليومي» (W6, owner 2026-11-19): its own mark, and the big picture with the family's seal, so it reads as the family's
  if (data.group === 'bread') {
    options.icon = BREAD_ICON;
    options.image = BREAD_IMAGE;
  }

  return { title: text(data.title, 80) || SITE_NAME, options };

}


function readPush(event) {

  try {
    const json = event.data ? event.data.json() : null;
    return json && typeof json.data === 'object' && json.data ? json.data : json;
  }
  catch {
    return null;
  }

}


/* =========================================================
   «خبزنا اليومي» OFFLINE: only these addresses, nothing else
========================================================= */

const BREAD_CACHE = 'bread-v1';
// the section's own files (exact patterns)
const BREAD_OWN = /^\/(?:daily-bread\/(?:index\.html)?|daily-bread\/data\/[\w/.-]{1,80}\.json|assets\/(?:js\/bread\/[\w-]+\.js|css\/bread\.css|fonts\/amiri\/[\w-]+\.woff2|img\/bread\/[\w.-]+|media\/bread\/[\w.-]+))$/;
// the site's files the section's page loads: kept only when that page asked for them (the referrer)
const BREAD_SHARED = ['/assets/css/main.css', '/assets/css/nav.css', '/assets/js/icons.js', '/assets/js/icons-brand.js', '/assets/js/sound.js',
  '/assets/js/account/link.js', '/assets/js/page/book-config.js', '/assets/fonts/cairo-arabic.woff2', '/assets/fonts/cairo-latin.woff2',
  '/assets/fonts/aref-ruqaa-arabic.woff2', '/assets/img/favicon-32.png', '/assets/img/favicon-192.png'];
const BREAD_REFERRER = /^\/(?:daily-bread\/|assets\/(?:js\/bread\/|css\/bread\.css))/;
// the Worker's copy of the same files (GET only; the reflection and the counts are never cached)
const BREAD_API = /^https:\/\/athanasios-api(?:-staging)?\.menazak-lab\.workers\.dev\/v1\/bread\/file\/(?:index|brd-[0-9a-f]{10}\/\d{1,3})$/;
const BREAD_DAY = /\/(?:data|file)\/(brd-[0-9a-f]{10}\/\d{1,3})(?:\.json)?$/;

function fromBreadPage(request) {

  try {
    return BREAD_REFERRER.test(new URL(request.referrer).pathname);
  }
  catch {
    return false;
  }

}

/* own = the section's file (any page); shared = also the site files it loads */
function breadUrl(url, { shared = false } = {}) {

  if (url.origin === self.location.origin) return BREAD_OWN.test(url.pathname) || (shared && BREAD_SHARED.includes(url.pathname));
  return BREAD_API.test(url.origin + url.pathname);

}

function isBread(request) {

  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  return breadUrl(url) || (url.origin === self.location.origin && BREAD_SHARED.includes(url.pathname) && fromBreadPage(request));

}

/* icons-brand.js is imported by icons.js (its referrer), on any page: kept only when the tab is the section's page */
async function breadClient(event) {

  try {
    const client = await self.clients.get(event.clientId);
    return !!client && /^\/daily-bread\//.test(new URL(client.url).pathname);
  }
  catch {
    return false;
  }

}

/* the page is one copy whatever its ?query (?s=reminders, ?from=push) */
function keyOf(url) {

  if (url.origin === self.location.origin && /^\/daily-bread\/(?:index\.html)?$/.test(url.pathname)) return self.location.origin + '/daily-bread/';
  return url.origin + url.pathname;

}

/* only the two newest days are kept (a few KB each, but they add up over a program) */
async function prune(cache) {

  const seen = [];
  for (const request of (await cache.keys()).reverse()) {
    const m = BREAD_DAY.exec(new URL(request.url).pathname);
    if (!m) continue;
    if (!seen.includes(m[1])) seen.push(m[1]);
    if (seen.indexOf(m[1]) >= 2) await cache.delete(request);
  }

}

async function breadFetch(request) {

  const cache = await caches.open(BREAD_CACHE);
  const key = keyOf(new URL(request.url));
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(key, response.clone());
      if (BREAD_DAY.test(new URL(key).pathname)) await prune(cache);
    }
    return response;
  }
  catch (error) {
    const kept = await cache.match(key);
    if (kept) return kept;
    throw error;
  }

}

self.addEventListener('fetch', event => {

  const request = event.request;
  if (isBread(request)) {
    event.respondWith(breadFetch(request));
    return;
  }
  // the one indirect file: answered from the network as always, kept only for the section's page
  if (request.method === 'GET' && request.url === self.location.origin + '/assets/js/icons-brand.js') {
    event.respondWith(breadClient(event).then(bread => (bread ? breadFetch(request) : fetch(request))));
  }

});

/* the first visit happened before this worker was in charge: the page sends what it loaded, to keep */
self.addEventListener('message', event => {

  const data = event.data;
  if (!data || data.type !== 'bread:keep' || !Array.isArray(data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(BREAD_CACHE);
    for (const href of data.urls.slice(0, 60)) {
      try {
        const url = new URL(href, self.location.origin);
        if (!breadUrl(url, { shared: true })) continue;
        const key = keyOf(url);
        if (await cache.match(key)) continue;
        const response = await fetch(url.href, { credentials: 'omit' });
        if (response.ok) await cache.put(key, response);
      }
      catch {
        // offline right now: the next visit keeps it
      }
    }
    await prune(cache);
  })());

});


self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {

  const { title, options } = notificationFrom(readPush(event));

  event.waitUntil(self.registration.showNotification(title, options));

});


self.addEventListener('notificationclick', event => {

  event.notification.close();

  // (also a notification shown before the site app moved to /index.html)
  const url = new URL(safeUrl(event.notification.data && event.notification.data.url), self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // a competition / «نقاطي» already open on that very page: just bring it forward
    const page = new URL(url).pathname;
    const same = PAGE.test(page) && windows.find(client => {
      const at = new URL(client.url);
      return at.origin === self.location.origin && at.pathname === page;
    });
    if (same) {
      try {
        await same.focus();
        return;
      }
      catch {
        // focus refused: open it below
      }
    }
    // the site page already open (never the admin): bring it forward and let its router open the item
    const open = windows.find(client => {
      const at = new URL(client.url);
      return at.origin === self.location.origin && (at.pathname === '/' || at.pathname === HOME);
    });
    if (open) {
      open.postMessage({ type: 'athanasios:open', url });
      try {
        await open.focus();
      }
      catch {
        // focus can be refused; the message still opens the item
      }
      return;
    }
    await self.clients.openWindow(url);
  })());

});
