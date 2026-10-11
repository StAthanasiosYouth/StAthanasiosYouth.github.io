/**
 * ADMIN NOTIFICATIONS (this device). Loaded on demand only (boot.js:
 * AdminApp.push), never on a first load of the panel.
 *
 *  - The browser's permission prompt appears only after the admin presses
 *    «فعّل إشعارات الإدارة» (boot.js asks inside the tap, Safari needs that).
 *  - Firebase Messaging comes from admin/vendor/firebase-messaging-admin.js:
 *    its own token database and its own Firebase app name, so the visitor
 *    token the site keeps on the same phone is never read, revoked or
 *    replaced. The token belongs to the ADMIN worker (/admin/sw.js), so FCM
 *    gives a different token from the site's.
 *  - The token goes to the Apps Script API with the usual ID token + session
 *    (apiAdminPushSubscribe …, apps-script/AdminPush.gs): the server stores
 *    it for the signed-in account. Nothing here says who the admin is.
 *  - This tab keeps only { token, at } (localStorage), to recognise this
 *    device and to rotate the token; no Google token, no email.
 */

import { PUSH_CONFIG } from '../assets/js/push-config.js';

const MEMO = 'athanasios-admin.push';
const APP_NAME = 'athanasios-admin-push';
const REFRESH_MS = 3 * 86400000;

let firebase = null;


function loadMemo() {

  try {
    const value = JSON.parse(window.localStorage.getItem(MEMO) || '{}');
    return value && typeof value === 'object' ? value : {};
  }
  catch {
    return {};
  }

}

function saveMemo(value) {

  try {
    if (value && value.token) window.localStorage.setItem(MEMO, JSON.stringify({ token: value.token, at: value.at || Date.now() }));
    else window.localStorage.removeItem(MEMO);
  }
  catch {
    // private mode: the server still has the device
  }

}

function messaging() {

  if (!firebase) {
    firebase = import('./vendor/firebase-messaging-admin.js').then(async sdk => {
      if (!(await sdk.isSupported())) throw new Error('هنا مفيش دعم للإشعارات.');
      const app = sdk.initializeApp(PUSH_CONFIG.firebase, APP_NAME);
      return { sdk, messaging: sdk.getMessaging(app) };
    });
    firebase.catch(() => { firebase = null; });
  }

  return firebase;

}

async function tokenFor(reg) {

  const { sdk, messaging: m } = await messaging();

  return sdk.getToken(m, { vapidKey: PUSH_CONFIG.vapidKey, serviceWorkerRegistration: reg });

}

export function memo() {

  return loadMemo();

}

/** { on, devices, configured, max } — on: this device is subscribed for the signed-in admin */
export async function status(call) {

  const { token } = loadMemo();

  return call('apiAdminPushDevices', token ? { token } : {});

}

/** Notifications already allowed (boot.js asked inside the tap): subscribe this device. */
export async function enable(call, reg, info) {

  const token = await tokenFor(reg);

  if (!token) throw new Error('مقدرناش ناخد رمز إشعارات للجهاز ده. جرّب تاني.');

  const before = loadMemo();
  const result = await call('apiAdminPushSubscribe', {
    token,
    previous: before.token && before.token !== token ? before.token : undefined,
    platform: info.platform,
    device: info.device
  });

  saveMemo({ token, at: Date.now() });

  // a first notification, from this device itself: proof it works
  reg.showNotification('تمام! إشعارات الإدارة شغالة 🔔', {
    body: 'هيوصلك لما أدمن تاني ينشر أو يضيف أو يعدّل حاجة.',
    icon: '/admin/icon-192.png',
    badge: '/assets/img/push-badge.png',
    tag: 'admin-welcome',
    lang: 'ar',
    dir: 'rtl',
    data: { url: '/admin/' }
  }).catch(() => {});

  return result;

}

export async function disable(call, reg) {

  const { token } = loadMemo();
  let result = { on: false };

  try {
    if (token) result = await call('apiAdminPushUnsubscribe', { token });
  }
  finally {
    saveMemo(null);
    try {
      if (window.Notification && Notification.permission === 'granted' && reg) {
        // deleteToken needs the messaging instance tied to our worker (getToken does that)
        const { sdk, messaging: m } = await messaging();
        await sdk.getToken(m, { vapidKey: PUSH_CONFIG.vapidKey, serviceWorkerRegistration: reg });
        await sdk.deleteToken(m);
      }
    }
    catch (error) {
      // the server drops a token that no longer works on the next send anyway
      console.warn(error);
    }
  }

  return result;

}

export async function removeDevice(call, id) {

  return call('apiAdminPushRemoveDevice', id);

}

/**
 * Now and then (boot.js, after the panel opened): a subscribed device
 * confirms its token with the server (Firebase may have rotated it), or
 * tidies up when notifications were turned off in the browser.
 */
export async function refresh(call, reg, info) {

  const before = loadMemo();

  if (!before.token || Date.now() - (Number(before.at) || 0) < REFRESH_MS) return;

  if (!window.Notification || Notification.permission !== 'granted') {
    try {
      await call('apiAdminPushUnsubscribe', { token: before.token });
    }
    finally {
      saveMemo(null);
    }
    return;
  }

  const token = await tokenFor(reg);

  if (!token) return;

  await call('apiAdminPushSubscribe', {
    token,
    previous: token !== before.token ? before.token : undefined,
    platform: info.platform,
    device: info.device
  });

  saveMemo({ token, at: Date.now() });

}
