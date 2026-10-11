/**
 * THE ADMIN APP'S SERVICE WORKER (scope /admin/): admin notifications only.
 *
 * Separate from the public site's /sw.js (scope /): its own registration,
 * so its own push subscription and FCM token (admin/push.js), and admin
 * notifications never land in the site's worker or the other way round.
 *
 * Deliberately no fetch handler and no cache: every admin page, script and
 * API answer keeps coming from the network (admin data must always be live).
 * This file only
 *  - shows an admin push (apps-script/AdminNotify.gs, FCM data-only message)
 *    as a notification, and
 *  - opens the admin at the item / log entry when it is tapped: an admin
 *    window already open is focused and told where to go (no second
 *    window, no second session); otherwise the admin app opens.
 *
 * Payload: { kind: 'admin', id, title, body, url: '/admin/#open/news/<id>' | '/admin/#activity/<id>', tag }
 * Anything unexpected falls back to safe defaults: a push must always show
 * a notification (Safari revokes push for sites that stay silent).
 */

'use strict';

const APP_NAME = 'لوحة تحكم الأسرة';
const ICON = '/admin/icon-192.png';
const BADGE = '/assets/img/push-badge.png';
const HOME = '/admin/';
const ROUTE = /^#(?:open\/(?:sessions|news|games|activities|notifications|types|links|sections|contacts|media)\/[\w-]{1,80}|open\/(?:settings|media)|activity(?:\/act-[0-9a-f]{12})?)$/;


function text(value, max) {

  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

}


/* only the admin page itself, with one of its links (anything else = the admin home) */
function safeUrl(value) {

  try {
    const url = new URL(String(value || HOME), self.location.origin);
    if (url.origin !== self.location.origin || url.pathname !== HOME) return HOME;
    return ROUTE.test(url.hash) ? HOME + url.hash : HOME;
  }
  catch {
    return HOME;
  }

}


function notificationFrom(data) {

  data = data && typeof data === 'object' ? data : {};

  const tag = /^[\w-]{1,80}$/.test(data.tag || '') ? data.tag : 'athanasios-admin';

  return {
    title: text(data.title, 90) || APP_NAME,
    options: {
      body: text(data.body, 200),
      icon: ICON,
      badge: BADGE,
      // the same thing again replaces its notification instead of stacking
      tag,
      renotify: false,
      lang: 'ar',
      dir: 'rtl',
      data: { url: safeUrl(data.url), id: text(data.id, 40) }
    }
  };

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

  const url = new URL((event.notification.data && event.notification.data.url) || HOME, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // the admin already open: bring it forward and let it go there (it asks first if something isn't saved)
    const open = windows.find(client => {
      const at = new URL(client.url);
      return at.origin === self.location.origin && at.pathname.startsWith(HOME);
    });
    if (open) {
      open.postMessage({ type: 'athanasios-admin:open', url });
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
