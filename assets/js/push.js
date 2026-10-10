/**
 * PUSH (visitor side). Loaded on demand only: when the bell opens, when the
 * invitation is due, or when a subscribed device needs its weekly refresh
 * (main.js decides that from localStorage without loading this file).
 *
 *  - The browser's permission prompt appears only after the visitor presses
 *    «فعّل الإشعارات» (never on load).
 *  - Firebase Messaging (assets/vendor/firebase-messaging.js) is loaded only
 *    to turn notifications on or off, or to refresh the token.
 *  - The token goes to the Apps Script API (pushSubscribe / pushUnsubscribe,
 *    apps-script/Push.gs); nothing else about the visitor is sent.
 *  - sw.js shows what arrives and opens the item's deep link when tapped.
 */

import { h } from './dom.js';
import { iconNode } from './icons.js';
import { toast } from './share.js';
import { PUSH_CONFIG } from './push-config.js';
import { pushSupport, platformOf, loadMemo, saveMemo, shouldNudge, pushRequest, pushReplyOk } from './push-env.js';

const SW_URL = '/sw.js';
const ICON = '/assets/img/icon-192.png';
const BADGE = '/assets/img/push-badge.png';

let styles = null;
let firebase = null;
let busy = false;
const cards = new Set();


/* =========================================================
   STYLES (assets/css/push.css, with this module only)
========================================================= */

function pushStyles() {

  if (!styles) {
    styles = new Promise(resolve => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('../css/push.css', import.meta.url).href;
      link.onload = resolve;
      link.onerror = resolve;
      document.head.append(link);
    });
  }

  return styles;

}


/* =========================================================
   FIREBASE + SERVER
========================================================= */

async function messaging() {

  if (!firebase) {
    firebase = import('../vendor/firebase-messaging.js').then(async sdk => {
      if (!(await sdk.isSupported())) throw new Error('messaging not supported');
      const app = sdk.initializeApp(PUSH_CONFIG.firebase, 'athanasios-push');
      return { sdk, messaging: sdk.getMessaging(app) };
    });
    firebase.catch(() => { firebase = null; });
  }

  return firebase;

}


async function registration() {

  await navigator.serviceWorker.register(SW_URL, { scope: '/' });

  return navigator.serviceWorker.ready;

}


async function tokenFor(reg) {

  const { sdk, messaging: m } = await messaging();

  return sdk.getToken(m, { vapidKey: PUSH_CONFIG.vapidKey, serviceWorkerRegistration: reg });

}


async function server(fn, arg) {

  try {
    const response = await fetch(PUSH_CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // no CORS preflight
      body: pushRequest(fn, arg),
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store'
    });
    return pushReplyOk(await response.json());
  }
  catch {
    return false;
  }

}


/* =========================================================
   ON / OFF / REFRESH
========================================================= */

function permission() {

  return 'Notification' in window ? Notification.permission : 'default';

}


/* must start inside the tap: Safari only asks during a user gesture */
async function enable() {

  if (busy) return;
  busy = true;
  repaint();

  try {
    const answer = await Notification.requestPermission();

    if (answer !== 'granted') {
      if (answer === 'default') toast('تقدر تفعّلها في أي وقت من الجرس 🔔');
      return;
    }

    const reg = await registration();
    const token = await tokenFor(reg);
    const memo = loadMemo();

    if (!token || !(await server('pushSubscribe', { token, platform: platformOf(), previous: memo.token && memo.token !== token ? memo.token : undefined }))) {
      throw new Error('subscribe failed');
    }

    saveMemo({ ...memo, token, at: Date.now() });

    // a first notification, from this device itself: proof it works
    reg.showNotification('تمام! الإشعارات شغالة 🔔', {
      body: 'هيوصلك الجديد أول بأول، حتى والموقع مقفول.',
      icon: ICON,
      badge: BADGE,
      tag: 'welcome',
      lang: 'ar',
      dir: 'rtl',
      data: { url: '/' }
    }).catch(() => {});
  }
  catch (error) {
    console.warn(error);
    toast('ما قدرناش نفعّل الإشعارات دلوقتي. جرّب تاني بعد شوية.');
  }
  finally {
    busy = false;
    repaint();
  }

}


async function disable() {

  if (busy) return;
  busy = true;
  repaint();

  const memo = loadMemo();

  try {
    if (memo.token) await server('pushUnsubscribe', { token: memo.token });
    if (permission() === 'granted') {
      // deleteToken needs the messaging instance tied to our worker (getToken does that)
      const reg = await registration();
      const { sdk, messaging: m } = await messaging();
      await sdk.getToken(m, { vapidKey: PUSH_CONFIG.vapidKey, serviceWorkerRegistration: reg });
      await sdk.deleteToken(m);
    }
  }
  catch (error) {
    // the server drops a token that no longer works on the next send anyway
    console.warn(error);
  }
  finally {
    const { token, at, ...rest } = memo;
    saveMemo(rest);
    busy = false;
    repaint();
    toast('وقفنا الإشعارات. تقدر ترجّعها من الجرس 🔔');
  }

}


/**
 * A subscribed device, now and then (main.js): confirm the token with the
 * server (it may have changed), or tidy up if notifications were turned off
 * in the browser's own settings.
 */
export async function refresh() {

  const memo = loadMemo();

  if (!memo.token) return;

  if (pushSupport() !== 'ok' || permission() !== 'granted') {
    if (await server('pushUnsubscribe', { token: memo.token })) {
      const { token, at, ...rest } = memo;
      saveMemo(rest);
    }
    return;
  }

  try {
    const token = await tokenFor(await registration());
    if (!token) return;
    const ok = await server('pushSubscribe', { token, platform: platformOf(), previous: token !== memo.token ? memo.token : undefined });
    if (ok) saveMemo({ ...loadMemo(), token, at: Date.now() });
  }
  catch (error) {
    console.warn(error);
  }

}


/* =========================================================
   THE CARD (top of the bell panel)
========================================================= */

function button(label, onclick, primary = true) {

  return h('button', { class: `btn push-card__btn${primary ? ' btn--primary' : ''}`, type: 'button', onclick, disabled: busy || null }, busy ? 'لحظة…' : label);

}


function steps(lines) {

  return h('ol', { class: 'push-card__steps' }, lines.map(line => h('li', {}, line)));

}


function cardContent(onDismiss) {

  const support = pushSupport();
  const memo = loadMemo();
  const state = permission();

  if (support === 'ios-install' || support === 'ios-safari') {
    return [
      h('p', { class: 'push-card__title' }, 'عايز الإشعارات على الآيفون؟ 🔔'),
      h('p', { class: 'push-card__text' }, 'الآيفون بيبعت الإشعارات للمواقع اللي متضافة على الشاشة الرئيسية بس:'),
      steps([
        support === 'ios-safari' ? 'افتح الموقع ده في Safari.' : null,
        h('span', {}, 'اضغط زرار المشاركة ', iconNode('share', 'push-card__inline-icon'), ' تحت.'),
        'اختار «إضافة إلى الشاشة الرئيسية» (Add to Home Screen).',
        'افتح الموقع من الأيقونة الجديدة، وافتح الجرس 🔔 ودوس «فعّل الإشعارات».'
      ].filter(Boolean)),
      h('p', { class: 'push-card__note' }, 'محتاج iOS 16.4 أو أحدث.')
    ];
  }

  if (support === 'inapp') {
    return [
      h('p', { class: 'push-card__title' }, 'خليك عارف الجديد أول بأول 🔔'),
      h('p', { class: 'push-card__text' }, 'افتح الموقع في Chrome أو Safari (من قايمة ⋮ أو ⋯ ← فتح في المتصفح) عشان تقدر تفعّل الإشعارات.')
    ];
  }

  if (support !== 'ok') return null;

  if (state === 'denied') {
    return [
      h('p', { class: 'push-card__title' }, 'الإشعارات مقفولة من المتصفح'),
      h('p', { class: 'push-card__text' }, platformOf() === 'ios'
        ? 'عشان تفتحها: الإعدادات ← الإشعارات ← أسرة أثناسيوس ← سماح.'
        : 'عشان تفتحها: اضغط 🔒 جنب عنوان الموقع ← الإشعارات ← سماح، وبعدين ارجع هنا.')
    ];
  }

  if (memo.token && state === 'granted') {
    return [
      h('p', { class: 'push-card__title' }, h('span', { class: 'push-card__ok', 'aria-hidden': 'true' }, iconNode('check')), 'الإشعارات شغالة'),
      h('p', { class: 'push-card__text' }, 'هيوصلك الجديد حتى والموقع مقفول.'),
      h('div', { class: 'push-card__actions' }, button('إيقاف', disable, false))
    ];
  }

  return [
    h('p', { class: 'push-card__title' }, 'خليك عارف الجديد أول بأول 🔔'),
    h('p', { class: 'push-card__text' }, 'هيوصلك إشعار بالاجتماع والأخبار المهمة بس — من غير إزعاج.'),
    h('div', { class: 'push-card__actions' },
      button('فعّل الإشعارات', enable),
      onDismiss ? button('مش دلوقتي', onDismiss, false) : null
    )
  ];

}


function paint(card) {

  const content = cardContent(card.onDismiss);

  card.node.hidden = !content;
  card.node.replaceChildren(...(content || []));

  // the invitation is done once notifications are on, blocked, or impossible here
  if (card.onDismiss && (!content || loadMemo().token || permission() !== 'default')) {
    if (!busy) card.remove();
  }

}


function repaint() {

  for (const card of cards) {
    if (!card.node.isConnected) cards.delete(card);
    else paint(card);
  }

}


/* bell.js: fills the slot at the top of the bell panel */
export function fillPushSlot(slot) {

  pushStyles().then(() => {
    const card = { node: h('div', { class: 'push-card', role: 'group', 'aria-label': 'إشعارات الموبايل' }), onDismiss: null, remove() {} };
    cards.add(card);
    paint(card);
    slot.replaceChildren(card.node);
  });

}


/* =========================================================
   THE INVITATION (from the second visit; at most twice)
========================================================= */

export function maybeNudge() {

  const memo = loadMemo();
  const now = Date.now();

  if (pushSupport() !== 'ok' || permission() !== 'default' || !shouldNudge(memo, now)) return;
  if (document.documentElement.classList.contains('has-sheet') || document.hidden) return;

  saveMemo({ ...memo, nudges: (Number(memo.nudges) || 0) + 1, nudgedAt: now });

  pushStyles().then(() => {
    const node = h('div', { class: 'push-nudge push-card', role: 'dialog', 'aria-label': 'إشعارات الموبايل' });
    const card = {
      node,
      onDismiss: () => card.remove(),
      remove() {
        cards.delete(card);
        node.classList.add('is-leaving');
        setTimeout(() => node.remove(), 260);
      }
    };
    cards.add(card);
    paint(card);
    document.body.append(node);
  });

}
