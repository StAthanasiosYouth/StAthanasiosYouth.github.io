/**
 * PUSH ENVIRONMENT: what this browser can do, and what this device remembers.
 * Pure helpers (no DOM), shared by push.js and the tests.
 *
 * Remembered in localStorage under MEMO_KEY (main.js reads the same key to
 * decide, without loading push.js, whether anything needs doing):
 *   token      the FCM token while notifications are on (else absent)
 *   at         when it was last confirmed with the server (ms)
 *   visits     visits so far (one per browser session)
 *   nudges     how often the invitation was shown (never more than NUDGE_MAX)
 *   nudgedAt   when it was last shown (ms)
 */

export const MEMO_KEY = 'athanasios.push.v1';
export const REFRESH_MS = 7 * 86400000;
export const NUDGE_MAX = 2;
export const NUDGE_GAP_MS = 7 * 86400000;
export const NUDGE_MIN_VISITS = 2;


function isIos(env) {

  const nav = env.navigator || {};
  const ua = String(nav.userAgent || '');

  // iPadOS reports a Mac; a Mac has no touch screen
  return /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);

}


function isStandalone(env) {

  const nav = env.navigator || {};

  try {
    return nav.standalone === true || !!(env.matchMedia && env.matchMedia('(display-mode: standalone)').matches);
  }
  catch {
    return false;
  }

}


/* in-app browsers (Facebook, Instagram, …) can't keep a push subscription */
function isInApp(env) {

  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|; wv\)/.test(String((env.navigator || {}).userAgent || ''));

}


/**
 * 'ok'            push works here
 * 'ios-install'   iPhone/iPad in Safari: add to the Home Screen first
 * 'ios-safari'    iPhone/iPad in another browser: open in Safari, then add
 * 'inapp'         an app's built-in browser: open in Chrome/Safari
 * 'unsupported'   nothing to offer (old browser, insecure page)
 */
export function pushSupport(env = globalThis) {

  const nav = env.navigator || {};
  const ios = isIos(env);

  if (env.isSecureContext === false) return 'unsupported';
  if (isInApp(env)) return 'inapp';

  if ('serviceWorker' in nav && 'PushManager' in env && 'Notification' in env) {
    return 'ok';
  }

  if (ios && !isStandalone(env)) {
    return /CriOS|FxiOS|EdgiOS|OPiOS/.test(String(nav.userAgent || '')) ? 'ios-safari' : 'ios-install';
  }

  return 'unsupported';

}


export function platformOf(env = globalThis) {

  const ua = String((env.navigator || {}).userAgent || '');

  if (isIos(env)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return 'desktop';
  return 'other';

}


export function loadMemo(storage = globalThis.localStorage) {

  try {
    const memo = JSON.parse(storage.getItem(MEMO_KEY) || 'null');
    return memo && typeof memo === 'object' && !Array.isArray(memo) ? memo : {};
  }
  catch {
    return {};
  }

}


export function saveMemo(memo, storage = globalThis.localStorage) {

  try {
    storage.setItem(MEMO_KEY, JSON.stringify(memo));
  }
  catch {
    // blocked storage: works for this visit only
  }

}


/* show the invitation now? (from the second visit, at most twice, a week apart) */
export function shouldNudge(memo, now) {

  return !memo.token &&
    (Number(memo.visits) || 0) >= NUDGE_MIN_VISITS &&
    (Number(memo.nudges) || 0) < NUDGE_MAX &&
    now - (Number(memo.nudgedAt) || 0) >= NUDGE_GAP_MS;

}


/* the POST body for PUSH_CONFIG.apiUrl (apps-script/Push.gs) */
export function pushRequest(fn, arg) {

  return JSON.stringify({ fn, args: [arg] });

}


/* the server's answer: true only for a clear { ok: true } */
export function pushReplyOk(reply) {

  return !!reply && typeof reply === 'object' && reply.ok === true;

}
