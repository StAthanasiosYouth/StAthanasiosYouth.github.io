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
 *   { id, title, body, url: '/#news/<id>' | '/#meeting' | '/', image?, tag }
 * Anything unexpected falls back to safe defaults: a push must always show
 * a notification (Safari revokes push for sites that stay silent).
 */

'use strict';

const SITE_NAME = 'أسرة البابا أثناسيوس';
const ICON = '/assets/img/icon-192.png';
const BADGE = '/assets/img/push-badge.png';
const ROUTE = /^#(?:notifications|meeting|(?:news|game|activity)\/[\w-]{1,60})$/;
const IMAGE = /^\/media\/[\w./-]{1,200}\.(?:webp|jpe?g|png)$/;


function text(value, max) {

  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

}


/* only this site's own page, with one of its deep links (anything else = the home page) */
function safeUrl(value) {

  try {
    const url = new URL(String(value || '/'), self.location.origin);
    if (url.origin !== self.location.origin || url.pathname !== '/') return '/';
    return ROUTE.test(url.hash) ? `/${url.hash}` : '/';
  }
  catch {
    return '/';
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

  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // the site already open (not the admin): bring it forward and let its router open the item
    const open = windows.find(client => {
      const at = new URL(client.url);
      return at.origin === self.location.origin && !at.pathname.startsWith('/admin');
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
