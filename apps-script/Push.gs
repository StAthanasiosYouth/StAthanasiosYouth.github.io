/**
 * WEB PUSH (Firebase Cloud Messaging, HTTP v1)
 *
 * A push is never its own content: it is a bell item (Notifications) that is
 * already LIVE on the public site, sent once more to the devices that turned
 * notifications on. One content system, one source of truth.
 *
 * Visitors (public, no token; doPost in Api.gs):
 *   pushSubscribe   { token, previous?, platform? }  → { ok } | { ok: false, code }
 *   pushUnsubscribe { token }                         → { ok } | { ok: false, code }
 *   Narrow on purpose: one FCM registration token in, one row in or out.
 *   Nothing is ever read back. Token format checked; a shared per-minute and
 *   per-day budget (like Route.gs); the PushSubs tab is capped.
 *
 * Admins (apiFunctions_, the usual ID token + allowlist + session):
 *   apiPushState()                → subscribers, candidates (bell items live now), recent sends
 *   apiPushCheck()                → is FCM reachable with the stored key? (no device is notified)
 *   apiSendPush(id, sendKey, edits) → sends one live bell item to every subscriber
 *
 * Safety:
 *  - only bell items in the LIVE content.json (fetched from the site itself),
 *    published now and not expired, in a section that is showing: never a
 *    draft, never a future or expired item;
 *  - one send per bell item (PushLog). A repeated sendKey (a retried request,
 *    a double click) returns the first result; a second send of the same
 *    item is refused; a 60 s cooldown and PUSH_SENDS_PER_DAY a day;
 *  - publishing never calls any of this: a push is a separate admin action,
 *    so a push failure can't break a publish;
 *  - tokens FCM reports as gone (UNREGISTERED, SENDER_ID_MISMATCH, an invalid
 *    registration token) are deleted after the send; a token that fails
 *    PUSH_MAX_FAILS sends in a row, or wasn't seen for PUSH_STALE_DAYS, too.
 *
 * Secret (Project Settings > Script Properties):
 *   FCM_SERVICE_ACCOUNT  the whole service-account JSON (role: Firebase Cloud
 *                        Messaging API Admin). Read here only; never logged,
 *                        never returned, never sent anywhere but Google's
 *                        token endpoint (as a signature, not the key).
 * Written here: PUSH_DAY_COUNT ("YYYY-MM-DD:n", the public budget).
 */

var PUSH_SUBS_SHEET = 'PushSubs';
var PUSH_LOG_SHEET = 'PushLog';
var PUSH_SUBS_COLUMNS = ['tokenHash', 'token', 'platform', 'createdAt', 'lastSeen', 'fails'];
var PUSH_LOG_COLUMNS = ['sendKey', 'notifId', 'status', 'by', 'startedAt', 'finishedAt', 'audience', 'sent', 'failed', 'removed', 'title', 'body', 'url', 'details'];

var PUSH_TOKEN_PATTERN = /^[\w:-]{100,400}$/;
var PUSH_PLATFORMS = ['android', 'ios', 'desktop', 'other'];
var PUSH_MAX_SUBS = 20000;
var PUSH_PUBLIC_PER_MINUTE = 60;
var PUSH_PUBLIC_PER_DAY = 5000;
var PUSH_SEEN_CACHE_SECONDS = 21600;
var PUSH_SEND_COOLDOWN_MS = 60000;
var PUSH_SENDS_PER_DAY = 10;
var PUSH_SENDING_STALE_MS = 10 * 60000;
var PUSH_BATCH = 100;
var PUSH_MAX_FAILS = 5;
var PUSH_STALE_DAYS = 270;
var PUSH_TIME_BUDGET_MS = 4.5 * 60000;
var PUSH_TITLE_MAX = 60;
var PUSH_BODY_MAX = 200;
var PUSH_TTL_MIN = 3600;
var PUSH_TTL_MAX = 4 * 86400;
var PUSH_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
var PUSH_OAUTH_URL = 'https://oauth2.googleapis.com/token';
var PUSH_FCM_URL = 'https://fcm.googleapis.com/v1/projects/';
var PUSH_CHECK_TOKEN = 'push-config-check';


/* =========================================================
   PUBLIC: SUBSCRIBE / UNSUBSCRIBE
========================================================= */

function publicPush_(fn, request) {

  try {
    return fn === 'pushSubscribe' ? pushSubscribe_(request) : pushUnsubscribe_(request);
  }
  catch (error) {
    // never the request or the token in the logs
    console.warn('push: ' + fn + ' failed');
    return { ok: false, code: 'error' };
  }

}


function pushSubscribe_(request) {

  var token = pushToken_(request && request.token);
  var previous = request && request.previous ? pushToken_(request.previous) : '';

  if (!token || (request.previous && !previous)) {
    return { ok: false, code: 'invalid' };
  }

  var platform = PUSH_PLATFORMS.indexOf(request.platform) !== -1 ? request.platform : 'other';
  var hash = pushHash_(token);
  var cache = CacheService.getScriptCache();

  // the same device again soon (a refresh, a second tab): nothing to write
  if (!previous && cache.get('push:seen:' + hash)) {
    return { ok: true };
  }

  if (!pushTakeQuota_(cache)) {
    return { ok: false, code: 'busy' };
  }

  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return { ok: false, code: 'busy' };
  }

  try {
    var sheet = pushSheet_(PUSH_SUBS_SHEET, PUSH_SUBS_COLUMNS);
    var hashes = pushColumn_(sheet, 1);
    var row = hashes.indexOf(hash);
    var now = Date.now();

    if (row !== -1) {
      sheet.getRange(row + 2, 3, 1, 4).setValues([[platform, sheet.getRange(row + 2, 4).getValue() || now, now, 0]]);
    }
    else {
      if (hashes.length >= PUSH_MAX_SUBS) {
        return { ok: false, code: 'full' };
      }
      sheet.appendRow([hash, token, platform, now, now, 0]);
    }

    if (previous && previous !== token) {
      pushDeleteRows_(sheet, [pushHash_(previous)]);
      cache.remove('push:seen:' + pushHash_(previous));
    }
  }
  finally {
    lock.releaseLock();
  }

  cache.put('push:seen:' + hash, '1', PUSH_SEEN_CACHE_SECONDS);

  return { ok: true };

}


function pushUnsubscribe_(request) {

  var token = pushToken_(request && request.token);

  if (!token) {
    return { ok: false, code: 'invalid' };
  }

  var cache = CacheService.getScriptCache();

  if (!pushTakeQuota_(cache)) {
    return { ok: false, code: 'busy' };
  }

  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return { ok: false, code: 'busy' };
  }

  try {
    pushDeleteRows_(pushSheet_(PUSH_SUBS_SHEET, PUSH_SUBS_COLUMNS), [pushHash_(token)]);
  }
  finally {
    lock.releaseLock();
  }

  cache.remove('push:seen:' + pushHash_(token));

  return { ok: true };

}


function pushToken_(value) {

  return typeof value === 'string' && PUSH_TOKEN_PATTERN.test(value) ? value : '';

}


/* 'h' + hex: a hash made only of digits and one "e" must never become a number in the Sheet */
function pushHash_(token) {

  return 'h' + sha256Hex_(token).slice(0, 40);

}


/* the shared public budget (a minute in CacheService, the UTC day in PUSH_DAY_COUNT) */
function pushTakeQuota_(cache) {

  var now = Date.now();
  var minuteKey = 'push:minute:' + Math.floor(now / 60000);
  var today = new Date(now).toISOString().slice(0, 10);
  var properties = PropertiesService.getScriptProperties();
  var minute = Number(cache.get(minuteKey)) || 0;
  var stored = String(properties.getProperty('PUSH_DAY_COUNT') || '').split(':');
  var day = stored[0] === today ? Number(stored[1]) || 0 : 0;

  if (minute >= PUSH_PUBLIC_PER_MINUTE || day >= PUSH_PUBLIC_PER_DAY) {
    return false;
  }

  cache.put(minuteKey, String(minute + 1), 120);
  properties.setProperty('PUSH_DAY_COUNT', today + ':' + (day + 1));

  return true;

}


/* =========================================================
   SHEETS (PushSubs, PushLog: created on first use)
========================================================= */

function pushSheet_(name, columns) {

  var ss = spreadsheet_();
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    // plain text everywhere: no token, hash or id is ever read as a number or a date
    sheet.getRange(1, 1, sheet.getMaxRows(), columns.length).setNumberFormat('@');
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;

}


/* one column's values below the header (1-based column) */
function pushColumn_(sheet, column) {

  var last = sheet.getLastRow();

  if (last < 2) {
    return [];
  }

  return sheet.getRange(2, column, last - 1, 1).getValues().map(function (row) { return String(row[0]); });

}


function pushRows_(sheet, columns) {

  var last = sheet.getLastRow();

  if (last < 2) {
    return [];
  }

  return sheet.getRange(2, 1, last - 1, columns.length).getValues().map(function (values, i) {
    var record = { row: i + 2 };
    columns.forEach(function (key, c) { record[key] = values[c]; });
    return record;
  });

}


/* deletes the rows whose tokenHash is listed (bottom up, so row numbers stay right) */
function pushDeleteRows_(sheet, hashes) {

  if (!hashes.length) {
    return 0;
  }

  var wanted = {};
  hashes.forEach(function (hash) { wanted[hash] = true; });

  var rows = [];
  pushColumn_(sheet, 1).forEach(function (hash, i) {
    if (wanted[hash]) rows.push(i + 2);
  });

  rows.sort(function (a, b) { return b - a; }).forEach(function (row) { sheet.deleteRow(row); });

  return rows.length;

}


/* =========================================================
   CONFIG (the secret stays here)
========================================================= */

/* the parsed service account, or null; nothing about it leaves this file */
function pushServiceAccount_() {

  var raw = PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT');
  var account = null;

  try {
    account = raw ? JSON.parse(raw) : null;
  }
  catch (ignored) {
    account = null;
  }

  if (!account || typeof account !== 'object' ||
      !/^[a-z][a-z0-9-]{4,40}$/.test(String(account.project_id || '')) ||
      !/^[^@\s]+@[\w.-]+\.iam\.gserviceaccount\.com$/.test(String(account.client_email || '')) ||
      String(account.private_key || '').indexOf('PRIVATE KEY') === -1) {
    return null;
  }

  return { projectId: account.project_id, email: account.client_email, key: account.private_key };

}


function pushConfigError_() {

  return appError_('إشعارات الموبايل لسه مش متظبطة.', 'FCM_SERVICE_ACCOUNT ناقص أو مش صحيح في Script Properties (docs/ADMIN-SETUP.md).');

}


function pushTokenKey_(account) {

  return 'push:oauth:' + sha256Hex_(account.email).slice(0, 16);

}


/* a short-lived access token for FCM (a signed JWT exchanged at Google), cached ~50 min */
function pushAccessToken_(account, fresh) {

  var cache = CacheService.getScriptCache();
  var key = pushTokenKey_(account);
  var cached = fresh ? null : cache.get(key);

  if (cached) {
    return cached;
  }

  var now = Math.floor(Date.now() / 1000);
  var encode = function (value) {
    return Utilities.base64EncodeWebSafe(Utilities.newBlob(JSON.stringify(value)).getBytes()).replace(/=+$/, '');
  };
  var unsigned = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({
    iss: account.email,
    scope: PUSH_SCOPE,
    aud: PUSH_OAUTH_URL,
    iat: now,
    exp: now + 3600
  });
  var signature = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, account.key)).replace(/=+$/, '');

  var response = UrlFetchApp.fetch(PUSH_OAUTH_URL, {
    method: 'post',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature },
    muteHttpExceptions: true
  });
  var body = null;

  try {
    body = JSON.parse(response.getContentText());
  }
  catch (ignored) {
    body = null;
  }

  if (response.getResponseCode() !== 200 || !body || typeof body.access_token !== 'string') {
    var error = appError_('جوجل رفض مفتاح الإشعارات.', 'اعمل مفتاح JSON جديد لحساب الخدمة push-sender وحطه في FCM_SERVICE_ACCOUNT (docs/ADMIN-SETUP.md).');
    error.pushCode = 'auth';
    throw error;
  }

  cache.put(key, body.access_token, Math.max(60, Math.min(3000, (Number(body.expires_in) || 3600) - 300)));

  return body.access_token;

}


/* =========================================================
   WHAT CAN BE SENT: the bell items live on the site now
========================================================= */

function pushSiteBase_() {

  var url = githubConfig_().siteUrl;

  return url ? url.replace(/\/?$/, '/') : '';

}


/* the content.json visitors get right now (not GitHub's: GitHub Pages may still be deploying) */
function pushLiveContent_() {

  var base = pushSiteBase_();

  if (!base) {
    throw appError_('عنوان الموقع مش متسجل.', 'SITE_URL ناقص في Script Properties.');
  }

  var response = UrlFetchApp.fetch(base + 'content.json?push=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
  var content = null;

  try {
    content = response.getResponseCode() === 200 ? JSON.parse(response.getContentText()) : null;
  }
  catch (ignored) {
    content = null;
  }

  if (!content || !Array.isArray(content.notifications)) {
    throw appError_('مش قادرين نقرا الموقع دلوقتي.', 'جرّب تاني بعد دقيقة.');
  }

  return content;

}


/* like the page (schedule.js visibilityState): from ≤ now ≤ until, Cairo wall time */
function pushWindowLive_(from, until, now) {

  return !(from && now < from) && !(until && now > until);

}


/* the page's own rules (bell.js visibleNotifications): published, and its section is showing */
function pushItemState_(content, item, now) {

  if (item.publishAt && now < item.publishAt) {
    return 'scheduled';
  }

  if (item.expireAt && now > item.expireAt) {
    return 'ended';
  }

  var layout = Array.isArray(content.layout) ? content.layout : null;
  var live = function (key) {
    if (!layout) return true;
    return layout.some(function (s) { return s && s.key === key && pushWindowLive_(s.visibleFrom, s.visibleUntil, now); });
  };
  var bySection = { meeting: 'meeting', news: 'news', game: 'games', competition: 'competitions' }[item.type];
  var target = item.target || null;
  var targetSection = null;

  if (target && target.kind === 'meeting') targetSection = 'meeting';
  if (target && (target.kind === 'news' || target.kind === 'game' || target.kind === 'activity')) {
    var list = { news: content.news, game: content.games, activity: content.activities }[target.kind] || [];
    var found = list.filter(function (x) { return x && x.id === target.id; })[0];
    if (!found) return 'hidden';
    targetSection = target.kind === 'news' ? 'news' : target.kind === 'game' ? 'games' : found.section;
  }

  if ((bySection && !live(bySection)) || (targetSection && !live(targetSection))) {
    return 'hidden';
  }

  return 'live';

}


/* the deep link a tap opens (router.js) */
function pushUrl_(target) {

  if (!target) return '/#notifications';
  if (target.kind === 'meeting') return '/#meeting';
  if ((target.kind === 'news' || target.kind === 'game' || target.kind === 'activity') && /^[\w-]{1,60}$/.test(String(target.id || ''))) {
    return '/#' + target.kind + '/' + target.id;
  }

  // an outside link: the site's bell, where the item links out
  return '/#notifications';

}


function pushText_(value, max) {

  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

}


/* the message every device gets (data only: sw.js shows it) */
function pushMessage_(item, edits) {

  edits = edits && typeof edits === 'object' ? edits : {};

  var title = pushText_(edits.title, PUSH_TITLE_MAX) || pushText_(item.title, PUSH_TITLE_MAX);
  var body = typeof edits.body === 'string' ? pushText_(edits.body, PUSH_BODY_MAX) : pushText_(item.message, PUSH_BODY_MAX);
  var src = item.image && typeof item.image.src === 'string' && /^media\/[\w./-]{1,200}\.(?:webp|jpe?g|png)$/.test(item.image.src) ? '/' + item.image.src : '';
  var message = {
    id: item.id,
    title: title,
    body: body,
    url: pushUrl_(item.target),
    tag: ('n-' + item.id).slice(0, 80)
  };

  if (src && edits.image !== false) {
    message.image = src;
  }

  return message;

}


/* minutes between two Cairo wall times "YYYY-MM-DDTHH:MM" */
function pushWallMinutes_(from, to) {

  var parse = function (value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : NaN;
  };

  return parse(to) - parse(from);

}


/* how long a push may wait for a phone that's off: until the item expires (1 h … 4 days) */
function pushTtl_(item, now) {

  var minutes = item.expireAt ? pushWallMinutes_(now, item.expireAt) : NaN;
  var seconds = isFinite(minutes) ? minutes * 60 : PUSH_TTL_MAX;

  return Math.max(PUSH_TTL_MIN, Math.min(PUSH_TTL_MAX, Math.round(seconds)));

}


/* =========================================================
   PUSH LOG
========================================================= */

function pushLogRows_() {

  return pushRows_(pushSheet_(PUSH_LOG_SHEET, PUSH_LOG_COLUMNS), PUSH_LOG_COLUMNS);

}


function pushLogSummary_(entry) {

  var stale = entry.status === 'sending' && Date.now() - Number(entry.startedAt) > PUSH_SENDING_STALE_MS;

  return {
    sendKey: String(entry.sendKey),
    notifId: String(entry.notifId),
    status: stale ? 'interrupted' : String(entry.status),
    by: String(entry.by),
    at: Number(entry.startedAt) || 0,
    finishedAt: Number(entry.finishedAt) || 0,
    audience: Number(entry.audience) || 0,
    sent: Number(entry.sent) || 0,
    failed: Number(entry.failed) || 0,
    removed: Number(entry.removed) || 0,
    title: String(entry.title).replace(/^'/, ''),
    url: String(entry.url)
  };

}


function pushCairoDay_(ms) {

  return Utilities.formatDate(new Date(ms), CONTENT_TIMEZONE, 'yyyy-MM-dd');

}


/* =========================================================
   ADMIN: STATE
========================================================= */

function apiPushState() {

  assertAdmin_();

  var subs = pushRows_(pushSheet_(PUSH_SUBS_SHEET, PUSH_SUBS_COLUMNS), PUSH_SUBS_COLUMNS);
  var platforms = { android: 0, ios: 0, desktop: 0, other: 0 };
  subs.forEach(function (s) { platforms[PUSH_PLATFORMS.indexOf(s.platform) !== -1 ? s.platform : 'other']++; });

  var log = pushLogRows_().map(pushLogSummary_);
  var latest = {};
  log.forEach(function (entry) { latest[entry.notifId] = entry; });

  var today = pushCairoDay_(Date.now());
  var sentToday = log.filter(function (e) { return e.at && pushCairoDay_(e.at) === today; }).length;
  var last = log.length ? log[log.length - 1] : null;

  var state = {
    configured: !!pushServiceAccount_(),
    subscribers: subs.length,
    platforms: platforms,
    candidates: [],
    contentError: '',
    log: log.slice(-15).reverse(),
    limits: {
      perDay: PUSH_SENDS_PER_DAY,
      sentToday: sentToday,
      cooldownSeconds: Math.round(PUSH_SEND_COOLDOWN_MS / 1000),
      waitSeconds: last && last.at ? Math.max(0, Math.ceil((last.at + PUSH_SEND_COOLDOWN_MS - Date.now()) / 1000)) : 0,
      titleMax: PUSH_TITLE_MAX,
      bodyMax: PUSH_BODY_MAX
    }
  };

  try {
    var content = pushLiveContent_();
    var now = cairoNow_();
    state.candidates = content.notifications
      .map(function (item) {
        var itemState = pushItemState_(content, item, now);
        return {
          id: item.id,
          type: item.type,
          state: itemState,
          publishAt: item.publishAt || '',
          expireAt: item.expireAt || '',
          image: item.image && item.image.thumb ? item.image.thumb : (item.image && item.image.src) || '',
          message: pushMessage_(item, {}),
          last: latest[item.id] || null
        };
      })
      .filter(function (c) { return c.state === 'live' || c.state === 'scheduled'; })
      .sort(function (a, b) {
        if (a.state !== b.state) return a.state === 'live' ? -1 : 1;
        return a.state === 'live' ? (b.publishAt < a.publishAt ? -1 : 1) : (a.publishAt < b.publishAt ? -1 : 1);
      });
  }
  catch (error) {
    state.contentError = pushErrorText_(error);
  }

  return state;

}


/* =========================================================
   ADMIN: CHECK THE SETUP (no device gets anything)
========================================================= */

function apiPushCheck() {

  assertAdmin_();

  var account = pushServiceAccount_();

  if (!account) {
    return { ok: false, message: 'FCM_SERVICE_ACCOUNT ناقص أو مش صحيح في Script Properties.' };
  }

  try {
    var token = pushAccessToken_(account, true);
    // validate_only to a token that can't exist: auth + permission are checked, nothing is delivered
    var response = UrlFetchApp.fetch(PUSH_FCM_URL + account.projectId + '/messages:send', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ validate_only: true, message: { token: PUSH_CHECK_TOKEN, data: { title: 'check' } } }),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    if (code === 200 || code === 400 || code === 404) {
      return { ok: true, message: 'الإعداد سليم ✓ جوجل قبل المفتاح والصلاحية.' };
    }
    if (code === 403) {
      return { ok: false, message: 'حساب الخدمة مالوش صلاحية Firebase Cloud Messaging API Admin، أو الـ API مقفول.' };
    }
    return { ok: false, message: 'FCM رد بـ HTTP ' + code + '. جرّب تاني بعد شوية.' };
  }
  catch (error) {
    return { ok: false, message: pushErrorText_(error) };
  }

}


/* =========================================================
   ADMIN: SEND
========================================================= */

function apiSendPush(id, sendKey, edits) {

  var email = assertAdmin_();

  id = String(id || '');
  sendKey = String(sendKey || '');

  if (!/^[\w-]{1,80}$/.test(id) || !/^[\w-]{8,64}$/.test(sendKey)) {
    throw appError_('الطلب مش مفهوم.', 'اعمل Refresh للصفحة.');
  }

  var account = pushServiceAccount_();

  if (!account) {
    throw pushConfigError_();
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  var message;
  var item;
  var content;
  var subs;
  var logRow;

  try {

    var logSheet = pushSheet_(PUSH_LOG_SHEET, PUSH_LOG_COLUMNS);
    var log = pushRows_(logSheet, PUSH_LOG_COLUMNS);

    // the same request again (a retry, a double click): its own result, never a second send
    var replay = log.filter(function (e) { return String(e.sendKey) === sendKey; })[0];
    if (replay) {
      return pushResult_(pushLogSummary_(replay), { replay: true });
    }

    var previous = log.filter(function (e) { return String(e.notifId) === id; }).map(pushLogSummary_);
    var done = previous.filter(function (e) { return e.status === 'sent'; })[0];
    if (done) {
      return pushResult_(done, { already: true });
    }
    if (previous.some(function (e) { return e.status === 'sending'; })) {
      throw appError_('الإشعار ده بيتبعت دلوقتي.', 'استنى دقيقة وبص على السجل.');
    }

    var now = Date.now();
    var last = log.length ? Number(log[log.length - 1].startedAt) || 0 : 0;
    if (now - last < PUSH_SEND_COOLDOWN_MS) {
      throw appError_('استنى دقيقة بين كل إشعار والتاني.', 'باقي ' + Math.ceil((last + PUSH_SEND_COOLDOWN_MS - now) / 1000) + ' ثانية.');
    }

    var today = pushCairoDay_(now);
    if (log.filter(function (e) { return pushCairoDay_(Number(e.startedAt) || 0) === today; }).length >= PUSH_SENDS_PER_DAY) {
      throw appError_('وصلنا للحد: ' + PUSH_SENDS_PER_DAY + ' إشعارات في اليوم.', 'الإشعارات الكتير بتخلي الناس تقفلها. كمّل بكرة.');
    }

    content = pushLiveContent_();
    item = content.notifications.filter(function (n) { return n && n.id === id; })[0];

    if (!item) {
      throw appError_('الإشعار ده مش على الموقع.', 'انشر الأول، واستنى لحد ما يظهر على الموقع.');
    }

    var state = pushItemState_(content, item, cairoNow_());
    if (state !== 'live') {
      throw appError_(state === 'scheduled' ? 'الإشعار ده لسه معاده مجاش.' : 'الإشعار ده مش ظاهر على الموقع دلوقتي.',
        state === 'scheduled' ? 'تقدر تبعته من ' + String(item.publishAt).replace('T', ' ') + '.' : 'اتأكد إنه مش منتهي وإن القسم بتاعه ظاهر.');
    }

    message = pushMessage_(item, edits);
    if (!message.title) {
      throw appError_('العنوان فاضي.', '');
    }

    subs = pushRows_(pushSheet_(PUSH_SUBS_SHEET, PUSH_SUBS_COLUMNS), PUSH_SUBS_COLUMNS);
    if (!subs.length) {
      throw appError_('مفيش مشتركين لسه.', 'أول ما حد يفعّل الإشعارات من الموقع هيظهر هنا.');
    }

    // claimed before anything goes out: a second request now sees "sending"
    logSheet.appendRow([sendKey, id, 'sending', plainCell_(email), now, '', subs.length, 0, 0, 0,
      plainCell_(message.title), plainCell_(message.body), message.url, '']);
    logRow = logSheet.getLastRow();

  }
  finally {
    lock.releaseLock();
  }

  var outcome = { delivered: [], dead: [], failed: [], skipped: 0, error: '' };

  try {
    outcome = pushFanout_(account, subs, message, pushTtl_(item, cairoNow_()));
  }
  catch (error) {
    // nothing is known about the devices: none of them is counted against
    outcome = { delivered: [], dead: [], failed: [], skipped: subs.length, error: pushErrorText_(error) };
  }

  var removed = pushCleanup_(outcome);
  var status = outcome.delivered.length ? 'sent' : 'failed';
  var finished = Date.now();
  var details = outcome.error ? outcome.error.slice(0, 300) : (outcome.skipped ? 'skipped ' + outcome.skipped : '');

  var logSheetAfter = pushSheet_(PUSH_LOG_SHEET, PUSH_LOG_COLUMNS);
  logSheetAfter.getRange(logRow, 3).setValue(status);
  logSheetAfter.getRange(logRow, 6, 1, 5).setValues([[finished, subs.length, outcome.delivered.length, outcome.failed.length + outcome.skipped, removed]]);
  if (details) logSheetAfter.getRange(logRow, 14).setValue(plainCell_(details));

  log_(email, 'push', id + ': ' + outcome.delivered.length + '/' + subs.length + (removed ? ', removed ' + removed : ''));

  if (status === 'failed' && outcome.error) {
    throw appError_('الإشعار ما اتبعتش.', outcome.error);
  }

  return pushResult_({
    sendKey: sendKey, notifId: id, status: status, by: email, at: now, finishedAt: finished,
    audience: subs.length, sent: outcome.delivered.length, failed: outcome.failed.length + outcome.skipped, removed: removed,
    title: message.title, url: message.url
  }, {});

}


/* an appError_ (JSON) or any error, as one readable line */
function pushErrorText_(error) {

  var text = String((error && error.message) || error || '');

  try {
    var parsed = JSON.parse(text);
    if (parsed && parsed.appError) return (parsed.message + (parsed.hint ? ' ' + parsed.hint : '')).trim();
  }
  catch (ignored) {
    // plain text
  }

  return text;

}


function pushResult_(summary, flags) {

  var result = {};
  Object.keys(summary).forEach(function (k) { result[k] = summary[k]; });
  result.replay = !!flags.replay;
  result.already = !!flags.already;

  return result;

}


/* one FCM request per device, PUSH_BATCH at a time; transient failures get one retry */
function pushFanout_(account, subs, message, ttl) {

  var started = Date.now();
  var url = PUSH_FCM_URL + account.projectId + '/messages:send';
  var token = pushAccessToken_(account, false);
  var outcome = { delivered: [], dead: [], failed: [], skipped: 0, error: '' };
  var data = {};

  Object.keys(message).forEach(function (k) { data[k] = String(message[k]); });

  var request = function (sub) {
    return {
      url: url,
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({
        message: {
          token: String(sub.token),
          data: data,
          webpush: { headers: { Urgency: 'high', TTL: String(ttl) } }
        }
      }),
      muteHttpExceptions: true
    };
  };

  var send = function (list) {
    var retry = [];
    for (var i = 0; i < list.length; i += PUSH_BATCH) {
      if (Date.now() - started > PUSH_TIME_BUDGET_MS) {
        outcome.skipped += list.length - i;
        break;
      }
      var batch = list.slice(i, i + PUSH_BATCH);
      var responses = UrlFetchApp.fetchAll(batch.map(request));
      for (var j = 0; j < batch.length; j++) {
        var kind = pushClassify_(responses[j]);
        var hash = String(batch[j].tokenHash);
        if (kind === 'auth') {
          // the next try asks Google for a fresh token
          CacheService.getScriptCache().remove(pushTokenKey_(account));
          throw appError_('جوجل رفض صلاحية الإرسال.', 'اضغط «اختبر الإعداد» في الإشعارات.');
        }
        if (kind === 'ok') outcome.delivered.push(hash);
        else if (kind === 'dead') outcome.dead.push(hash);
        else retry.push(batch[j]);
      }
    }
    return retry;
  };

  var retry = send(subs);

  if (retry.length) {
    Utilities.sleep(1500);
    send(retry).forEach(function (sub) { outcome.failed.push(String(sub.tokenHash)); });
  }

  return outcome;

}


/* 'ok' | 'dead' (the token is gone for good) | 'auth' | 'retry' */
function pushClassify_(response) {

  var code = response.getResponseCode();

  if (code === 200) return 'ok';
  if (code === 401) return 'auth';

  var error = null;
  try {
    error = JSON.parse(response.getContentText()).error;
  }
  catch (ignored) {
    error = null;
  }

  var fcmCode = '';
  ((error && error.details) || []).forEach(function (d) { if (d && d.errorCode) fcmCode = d.errorCode; });

  if (code === 404 || fcmCode === 'UNREGISTERED' || fcmCode === 'SENDER_ID_MISMATCH') return 'dead';
  // only the token's own fault; a bad message would fail every device the same way
  if (code === 400 && /registration token/i.test(String(error && error.message))) return 'dead';
  if (code === 403 && fcmCode !== 'SENDER_ID_MISMATCH') return 'auth';

  return 'retry';

}


/* after a send: dead and worn-out tokens go, the rest get their failure count */
function pushCleanup_(outcome) {

  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(20000);
  }
  catch (ignored) {
    return 0;   // tidying waits for the next send
  }

  try {
    var sheet = pushSheet_(PUSH_SUBS_SHEET, PUSH_SUBS_COLUMNS);
    var rows = pushRows_(sheet, PUSH_SUBS_COLUMNS);
    var delivered = {};
    var failed = {};
    var remove = outcome.dead.slice();
    var staleBefore = Date.now() - PUSH_STALE_DAYS * 86400000;

    outcome.delivered.forEach(function (h) { delivered[h] = true; });
    outcome.failed.forEach(function (h) { failed[h] = true; });

    var fails = rows.map(function (s) {
      var hash = String(s.tokenHash);
      var count = Number(s.fails) || 0;
      if (delivered[hash]) count = 0;
      else if (failed[hash]) count++;
      if (count >= PUSH_MAX_FAILS || (Number(s.lastSeen) && Number(s.lastSeen) < staleBefore)) remove.push(hash);
      return [count];
    });

    if (rows.length) {
      sheet.getRange(2, 6, rows.length, 1).setValues(fails);
    }

    return pushDeleteRows_(sheet, remove);
  }
  finally {
    lock.releaseLock();
  }

}
