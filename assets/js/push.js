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
import { pushSupport, platformOf, loadMemo, saveMemo, shouldNudge, pushRequest, pushReplyOk, bellHint } from './push-env.js';
import { installState, promptInstall, onInstallChange } from './install.js';

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
        ? 'عشان تفتحها: الإعدادات ← الإشعارات ← أسرة البابا أثناسيوس - سفاجا ← سماح.'
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

  // on, off, blocked: the bell's hint follows
  if (!busy) syncBellHint();

}


/* bell.js: fills the slot at the top of the bell panel */
export function fillPushSlot(slot) {

  // the bell is open: it has been seen, so the hint calms down (the dot stays)
  pauseBellHint();

  pushStyles().then(() => {
    const card = { node: h('div', { class: 'push-card', role: 'group', 'aria-label': 'إشعارات الموبايل' }), onDismiss: null, remove() {} };
    const install = h('div', { class: 'push-card install-card', role: 'group', 'aria-label': 'تطبيق الأسرة', hidden: true });
    cards.add(card);
    paint(card);
    slot.replaceChildren(card.node, install);
    paintInstall(install);
    const stop = onInstallChange(() => {
      if (!install.isConnected) { stop(); return; }
      paintInstall(install);
    });
  });

}


/* =========================================================
   «ثبّت تطبيق الأسرة» (optional, under the notifications card)
   Only on Android phones and only while the SITE app isn't installed
   (install.js: never the admin app). «مش دلوقتي» hides it for 30 days.
   On an iPhone the notifications card above already explains «إضافة
   إلى الشاشة الرئيسية», so nothing is repeated here.
========================================================= */

const INSTALL_LATER_KEY = 'athanasios.install.later';
const INSTALL_LATER_MS = 30 * 86400000;

function installLater() {

  try {
    return Date.now() - (Number(localStorage.getItem(INSTALL_LATER_KEY)) || 0) < INSTALL_LATER_MS;
  }
  catch {
    return false;
  }

}

async function paintInstall(node) {

  const state = await installState();

  // the bell closed meanwhile
  if (!node.isConnected) return;

  if (state === 'running') {
    node.hidden = true;
    return;
  }

  if (state === 'installed') {
    node.hidden = false;
    node.replaceChildren(
      h('p', { class: 'push-card__title' }, h('span', { class: 'push-card__ok', 'aria-hidden': 'true' }, iconNode('check')), 'تطبيق الأسرة متثبت على الموبايل ده'),
      h('p', { class: 'push-card__text' }, 'افتحه من أيقونته «أسرة البابا أثناسيوس - سفاجا» على الشاشة الرئيسية.')
    );
    return;
  }

  if (platformOf() !== 'android' || pushSupport() === 'inapp' || installLater()) {
    node.hidden = true;
    return;
  }

  const later = h('button', { class: 'btn push-card__btn', type: 'button', onclick: () => {
    try { localStorage.setItem(INSTALL_LATER_KEY, String(Date.now())); }
    catch { /* shown again next time */ }
    node.hidden = true;
  } }, 'مش دلوقتي');

  node.hidden = false;

  if (state === 'prompt') {
    node.replaceChildren(
      h('p', { class: 'push-card__title' }, 'ثبّت تطبيق الأسرة على موبايلك'),
      h('p', { class: 'push-card__text' }, 'يتفتح من أيقونة على الشاشة الرئيسية، زي أي تطبيق.'),
      h('div', { class: 'push-card__actions' },
        h('button', { class: 'btn push-card__btn btn--primary', type: 'button', onclick: async () => {
          if (await promptInstall()) toast('اتثبت ✓ هتلاقيه على الشاشة الرئيسية');
          paintInstall(node);
        } }, 'تثبيت التطبيق'),
        later
      )
    );
    return;
  }

  node.replaceChildren(
    h('p', { class: 'push-card__title' }, 'ثبّت تطبيق الأسرة على موبايلك'),
    steps([
      h('span', {}, 'افتح قايمة Chrome ', h('b', { class: 'install-card__key' }, '⋮'), ' فوق.'),
      'اختار «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية» ← «تثبيت».'
    ]),
    h('div', { class: 'push-card__actions' }, later)
  );

}


/* =========================================================
   THE INVITATION (from the second visit; at most twice)
========================================================= */

export function maybeNudge() {

  const memo = loadMemo();
  const now = Date.now();

  if (pushSupport() !== 'ok' || permission() !== 'default' || !shouldNudge(memo, now)) return false;
  if (document.documentElement.classList.contains('has-sheet') || document.hidden) return false;

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

  return true;

}


/* =========================================================
   THE BELL'S HINT (push-env.js bellHint)
   A gold dot on the bell while notifications are off here; on a visit,
   a few slow gold ripples and a small pill under the bell («فعّل
   الإشعارات من هنا»), once per session, gone after PILL_MS. Opening the
   bell or × pauses the ripples and the pill for a week (the dot stays);
   turning notifications on removes all of it. Nothing moves the layout:
   the dot and the pill are absolutely positioned (push.css).
========================================================= */

const PILL_SESSION_KEY = 'athanasios.push.hint';
const PILL_MS = 8000;

let pill = null;
let pillTimer = 0;


function bellButton() {

  return document.getElementById('bell');

}


function hintState() {

  return bellHint(globalThis, loadMemo(), Date.now());

}


function removePill() {

  clearTimeout(pillTimer);
  if (!pill) return;
  const node = pill;
  pill = null;
  node.classList.add('is-leaving');
  setTimeout(() => node.remove(), 260);

}


function showPill(bell) {

  try {
    if (sessionStorage.getItem(PILL_SESSION_KEY)) return;
    sessionStorage.setItem(PILL_SESSION_KEY, '1');
  }
  catch {
    // no storage: show it this once
  }

  pill = h('div', { class: 'bell-hint' },
    h('button', { class: 'bell-hint__go', type: 'button', onclick: () => bell.click() }, 'فعّل الإشعارات من هنا 🔔'),
    h('button', { class: 'bell-hint__close', type: 'button', 'aria-label': 'إخفاء', onclick: () => pauseBellHint() }, iconNode('close'))
  );

  bell.parentElement.append(pill);
  pillTimer = setTimeout(removePill, PILL_MS);

}


/* the dot, the ripples and the pill as the state says (allowPill: a fresh visit) */
function syncBellHint({ allowPill = false } = {}) {

  const bell = bellButton();

  if (!bell) return;

  const state = hintState();
  let spark = bell.querySelector('.bell__spark');

  if (state.dot && !spark) {
    spark = h('span', { class: 'bell__spark', 'aria-hidden': 'true' });
    bell.append(spark);
  }
  if (!state.dot && spark) spark.remove();

  // for screen readers: the dot, said once next to the bell's own label
  let note = document.getElementById('bell-hint-note');
  if (state.dot && !note) {
    note = h('span', { id: 'bell-hint-note', class: 'visually-hidden' }, 'إشعارات الموبايل مش مفعّلة. افتح الجرس وفعّلها.');
    bell.parentElement.append(note);
    bell.setAttribute('aria-describedby', 'bell-hint-note');
  }
  if (!state.dot && note) {
    note.remove();
    bell.removeAttribute('aria-describedby');
  }

  bell.classList.toggle('bell--halo', state.invite);
  if (!state.invite) removePill();
  else if (allowPill && !pill) showPill(bell);

}


/* the bell was opened, or the pill dismissed: quiet for a week (the dot stays) */
export function pauseBellHint() {

  const memo = loadMemo();

  if (!memo.token) saveMemo({ ...memo, hintPausedAt: Date.now() });
  syncBellHint();

}


/* main.js, a little after load: the hint, and the invitation card when it's due (never both at once) */
export function invite() {

  return pushStyles().then(() => {
    const due = pushSupport() === 'ok' && permission() === 'default' && shouldNudge(loadMemo(), Date.now());
    syncBellHint({ allowPill: !due });
    if (due) setTimeout(maybeNudge, 3500);
  });

}
