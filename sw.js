/**
 * SERVICE WORKER: push notifications only.
 *
 * Deliberately no fetch handler and no cache: the page, content.json and
 * every asset keep coming from the network exactly as before (a cached
 * content.json could show stale meetings). This file only
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
const HOME = '/index.html';
const ROUTE = /^#(?:notifications|meeting|points|(?:news|game|activity)\/[\w-]{1,60}|competition\/[a-z0-9-]{2,40}|(?:event|page)\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9]))$/;
/* the site's other pages a tap may open: a competition (the engine), «نقاطي», an event,
   or a service page at the top level (docs/EVENTS.md §17.8; assets/js/page/model.js) */
const FIXED_PAGE = /^\/(?:competition\/[a-z0-9-]{2,40}|points|events\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9]))\/$/;
const TOP_PAGE = /^\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9]))\/$/;
const RESERVED = ['admin', 'assets', 'media', 'points', 'competition', 'events', 'pages', 'privacy', 'terms',
  'review', 'tools', 'docs', 'tests', 'apps-script', 'index', 'preview', 'new', 'card-athanasios'];
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
