/**
 * ADMIN PUSH: notifications for the service team, separate from visitors'.
 *
 * Same Firebase project and the same sender (FCM HTTP v1 with the
 * FCM_SERVICE_ACCOUNT key, Push.gs), but its own everything else:
 *  - its own devices: the admin app's service worker (/admin/sw.js, scope
 *    /admin/) has its own push subscription, so its own FCM token, kept by
 *    its own Firebase copy (admin/vendor/firebase-messaging-admin.js: a
 *    separate IndexedDB) — the visitor token on the same phone is never
 *    touched;
 *  - its own tab, AdminPushSubs (never PushSubs): a visitor send can't reach
 *    an admin device and an admin send can't reach a visitor;
 *  - its own way in: only through the API with the usual ID token +
 *    allowlist + session (apiFunctions_). The email on a row is always
 *    currentEmail_(), never something the page says. A token that is
 *    already a visitor subscription is refused.
 *
 *   apiAdminPushSubscribe({ token, previous?, platform?, device? })  → this device on, { devices }
 *   apiAdminPushUnsubscribe({ token })                               → this device off
 *   apiAdminPushDevices()                                            → my devices
 *   apiAdminPushRemoveDevice(id)                                     → one of my devices off
 *
 * Sending (adminPushNotify_, from Activity.gs after an action): every admin
 * on the allowlist NOW, except the one who did it and anyone with the panel
 * open right now (they get an in-panel toast). Removed admins' devices are
 * deleted when they are removed (forgetAdminDevices_) and skipped anyway.
 * A send's failure never reaches the action that caused it.
 *
 * prefs (a JSON column) is kept for per-category choices later; v1 has
 * only on/off per device.
 */

var ADMIN_PUSH_SHEET = 'AdminPushSubs';
var ADMIN_PUSH_COLUMNS = ['tokenHash', 'token', 'email', 'device', 'platform', 'createdAt', 'lastSeen', 'fails', 'prefs'];
var ADMIN_PUSH_PER_ADMIN = 5;
var ADMIN_PUSH_MAX = 100;
var ADMIN_PUSH_TTL = 86400;
var ADMIN_PUSH_TITLE_MAX = 80;
var ADMIN_PUSH_BODY_MAX = 160;
var ADMIN_PUSH_OPEN_TYPES = ['sessions', 'news', 'games', 'activities', 'notifications', 'types', 'links', 'sections', 'contacts', 'media'];


function adminPushSheet_() {

  return pushSheet_(ADMIN_PUSH_SHEET, ADMIN_PUSH_COLUMNS);

}

function adminPushRows_() {

  return pushRows_(adminPushSheet_(), ADMIN_PUSH_COLUMNS);

}

/* deletes rows by tokenHash (bottom up) */
function adminPushDelete_(sheet, hashes) {

  return pushDeleteRows_(sheet, hashes);

}

function adminPushDeviceOut_(row, current) {

  return {
    id: String(row.tokenHash).slice(0, 16),
    device: activityCell_(row.device) || 'جهاز',
    platform: String(row.platform || 'other'),
    createdAt: Number(row.createdAt) || 0,
    lastSeen: Number(row.lastSeen) || 0,
    current: !!current && String(row.tokenHash) === current
  };

}

function adminPushDevicesOf_(email, currentHash) {

  return adminPushRows_()
    .filter(function (row) { return String(row.email).toLowerCase() === email; })
    .map(function (row) { return adminPushDeviceOut_(row, currentHash); })
    .sort(function (a, b) { return b.lastSeen - a.lastSeen; });

}

function adminPushToken_(value) {

  var token = pushToken_(value);

  if (!token) {
    throw appError_('رمز الإشعارات بتاع الجهاز ده مش مفهوم.', 'جرّب تقفل الإشعارات وتفتحها تاني.');
  }

  return token;

}


/** Turns admin notifications on for this device (the signed-in admin's). */
function apiAdminPushSubscribe(info) {

  var me = assertAdmin_();

  info = info && typeof info === 'object' ? info : {};

  var token = adminPushToken_(info.token);
  var previous = info.previous ? pushToken_(info.previous) : '';
  var platform = PUSH_PLATFORMS.indexOf(info.platform) !== -1 ? info.platform : 'other';
  var device = cleanLabel_(info.device, 40) || 'جهاز';
  var hash = pushHash_(token);
  var lock = LockService.getScriptLock();

  lock.waitLock(20000);

  try {

    // a visitor's token is never an admin's (the admin app has its own worker and token)
    var publicSheet = spreadsheet_().getSheetByName(PUSH_SUBS_SHEET);
    if (publicSheet && pushColumn_(publicSheet, 1).indexOf(hash) !== -1) {
      throw appError_('الجهاز ده مسجل لإشعارات الموقع بنفس الرمز.', 'افتح لوحة التحكم من التطبيق بتاعها (مش من الموقع) وفعّل الإشعارات تاني.');
    }

    var sheet = adminPushSheet_();
    var rows = pushRows_(sheet, ADMIN_PUSH_COLUMNS);
    var now = Date.now();
    var mine = rows.filter(function (row) { return String(row.email).toLowerCase() === me; });
    var existing = rows.filter(function (row) { return String(row.tokenHash) === hash; })[0];
    var remove = [];

    if (previous && previous !== token) {
      var old = pushHash_(previous);
      if (mine.some(function (row) { return String(row.tokenHash) === old; })) remove.push(old);
    }

    if (existing) {
      // the same device (it may have changed hands: it is the signed-in admin's now)
      sheet.getRange(existing.row, 3, 1, 6).setValues([[me, plainCell_(device), platform, Number(existing.createdAt) || now, now, 0]]);
    }
    else {
      // a full set: the device not seen for the longest makes room
      var others = mine.filter(function (row) { return remove.indexOf(String(row.tokenHash)) === -1; })
        .sort(function (a, b) { return (Number(a.lastSeen) || 0) - (Number(b.lastSeen) || 0); });
      while (others.length >= ADMIN_PUSH_PER_ADMIN) {
        remove.push(String(others.shift().tokenHash));
      }
      if (rows.length - remove.length >= ADMIN_PUSH_MAX) {
        throw appError_('وصلنا لأقصى عدد أجهزة لإشعارات لوحة التحكم.', 'شيل جهاز مش مستخدم من «أجهزتي».');
      }
      sheet.appendRow([hash, token, me, plainCell_(device), platform, now, now, 0, '']);
    }

    adminPushDelete_(sheet, remove);

  }
  finally {
    lock.releaseLock();
  }

  return { on: true, devices: adminPushDevicesOf_(me, hash), configured: !!pushServiceAccount_() };

}


/** Turns admin notifications off for this device (only if it is the signed-in admin's). */
function apiAdminPushUnsubscribe(info) {

  var me = assertAdmin_();
  var token = pushToken_(info && info.token);

  if (!token) {
    return { on: false, devices: adminPushDevicesOf_(me, '') };
  }

  var hash = pushHash_(token);
  var lock = LockService.getScriptLock();

  lock.waitLock(20000);

  try {
    var sheet = adminPushSheet_();
    var row = pushRows_(sheet, ADMIN_PUSH_COLUMNS).filter(function (r) { return String(r.tokenHash) === hash; })[0];
    if (row && String(row.email).toLowerCase() === me) {
      adminPushDelete_(sheet, [hash]);
    }
  }
  finally {
    lock.releaseLock();
  }

  return { on: false, devices: adminPushDevicesOf_(me, '') };

}


/** My devices with admin notifications on. info.token (optional): which one is this device. */
function apiAdminPushDevices(info) {

  var me = assertAdmin_();
  var token = pushToken_(info && info.token);
  var hash = token ? pushHash_(token) : '';
  var devices = adminPushDevicesOf_(me, hash);

  return {
    devices: devices,
    on: !!hash && devices.some(function (d) { return d.current; }),
    configured: !!pushServiceAccount_(),
    max: ADMIN_PUSH_PER_ADMIN
  };

}


/** Turns one of my devices off (by the id apiAdminPushDevices gave). */
function apiAdminPushRemoveDevice(id) {

  var me = assertAdmin_();

  id = String(id || '');

  if (!/^h[0-9a-f]{15}$/.test(id)) {
    throw appError_('الجهاز ده مش معروف.', 'اعمل Refresh للصفحة.');
  }

  var lock = LockService.getScriptLock();

  lock.waitLock(20000);

  try {
    var sheet = adminPushSheet_();
    var hashes = pushRows_(sheet, ADMIN_PUSH_COLUMNS)
      .filter(function (row) { return String(row.email).toLowerCase() === me && String(row.tokenHash).slice(0, 16) === id; })
      .map(function (row) { return String(row.tokenHash); });
    adminPushDelete_(sheet, hashes);
  }
  finally {
    lock.releaseLock();
  }

  return { devices: adminPushDevicesOf_(me, '') };

}


/* an admin left the list: every device of theirs goes (Auth.gs apiRemoveAdmin, under its lock) */
function forgetAdminDevices_(email) {

  try {
    var sheet = spreadsheet_().getSheetByName(ADMIN_PUSH_SHEET);
    if (!sheet) return 0;
    var hashes = pushRows_(sheet, ADMIN_PUSH_COLUMNS)
      .filter(function (row) { return String(row.email).toLowerCase() === email; })
      .map(function (row) { return String(row.tokenHash); });
    return adminPushDelete_(sheet, hashes);
  }
  catch (error) {
    console.warn('admin push: devices of a removed admin not deleted');
    return 0;
  }

}


/* =========================================================
   SENDING
========================================================= */

/* is this admin in the panel right now (a heartbeat a moment ago, not left)? */
function adminPresent_(email, now) {

  try {
    var record = readCached_(sessionCacheKey_(email));
    return !!(record && record.sid && !record.parked && now - Number(record.seen) < PRESENCE_ONLINE_SECONDS * 1000);
  }
  catch (ignored) {
    return false;
  }

}

/* where a tap opens the admin: the item, else the log entry */
function adminPushUrl_(row) {

  var id = String(row.entityId || '');

  if (row.action !== 'delete' && row.action !== 'media.purge' && ADMIN_PUSH_OPEN_TYPES.indexOf(row.type) !== -1 && /^[\w-]{1,60}$/.test(id)) {
    return '/admin/#open/' + row.type + '/' + id;
  }

  if (row.type === 'settings') return '/admin/#open/settings';

  return '/admin/#activity/' + row.id;

}

/* the message: «مينا زكريا عدّل اجتماع الأحد ١٢ أكتوبر» (+ a detail line) */
function adminPushMessage_(row) {

  var title = activityText_(displayName_(row.actor) + ' ' + row.summary, ADMIN_PUSH_TITLE_MAX);
  var body = '';
  var changes = row.changes || {};

  if (row.action === 'publish' && changes.items && changes.items.length) {
    body = 'فيه: ' + changes.items.join('، ') + (changes.more ? ' و' + activityDigits_(changes.more) + ' كمان' : '');
  }
  else if (Array.isArray(changes.fields) && changes.fields.length) {
    body = 'اتغيّر: ' + changes.fields.slice(0, 4).join('، ');
  }
  else if (row.action === 'push' && changes.body) {
    body = String(changes.body);
  }

  return {
    kind: 'admin',
    id: row.id,
    title: title,
    body: activityText_(body || 'لوحة تحكم الأسرة', ADMIN_PUSH_BODY_MAX),
    url: adminPushUrl_(row),
    // the same thing again replaces its notification instead of stacking
    tag: ('adm-' + row.type + '-' + String(row.entityId || row.id)).replace(/[^\w-]/g, '').slice(0, 80)
  };

}

/**
 * One activity row → every other admin's devices. Never throws.
 * → { sent, reason }   reason: '' | 'off' | 'none' | 'present' | 'error'
 */
function adminPushNotify_(row, actor) {

  var account = null;

  try {
    account = pushServiceAccount_();
  }
  catch (ignored) {
    account = null;
  }

  if (!account) {
    return { sent: 0, reason: 'off' };
  }

  var sheet = spreadsheet_().getSheetByName(ADMIN_PUSH_SHEET);

  if (!sheet) {
    return { sent: 0, reason: 'none' };
  }

  var now = Date.now();
  // re-read the allowlist: a removed admin gets nothing, whatever is left in the tab
  forgetAdminEmails_();
  var admins = adminEmails_();
  var present = {};
  var rows = pushRows_(sheet, ADMIN_PUSH_COLUMNS).filter(function (sub) {
    var email = String(sub.email).toLowerCase();
    if (email === actor || admins.indexOf(email) === -1) return false;
    if (present[email] === undefined) present[email] = adminPresent_(email, now);
    return !present[email];
  });

  if (!rows.length) {
    return { sent: 0, reason: Object.keys(present).some(function (k) { return present[k]; }) ? 'present' : 'none' };
  }

  var outcome;

  try {
    outcome = pushFanout_(account, rows, adminPushMessage_(row), ADMIN_PUSH_TTL);
  }
  catch (error) {
    console.warn('admin push: send failed: ' + pushErrorText_(error));
    return { sent: 0, reason: 'error' };
  }

  adminPushCleanup_(outcome);

  return { sent: outcome.delivered.length, reason: outcome.delivered.length ? '' : 'error' };

}

/* after a send: dead tokens go, failures counted, delivered ones reset (no lock wait: best effort) */
function adminPushCleanup_(outcome) {

  var lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) return 0;

  try {
    var sheet = adminPushSheet_();
    var rows = pushRows_(sheet, ADMIN_PUSH_COLUMNS);
    var delivered = {};
    var failed = {};
    var remove = outcome.dead.slice();

    outcome.delivered.forEach(function (h) { delivered[h] = true; });
    outcome.failed.forEach(function (h) { failed[h] = true; });

    if (!rows.length) return 0;

    var fails = rows.map(function (sub) {
      var hash = String(sub.tokenHash);
      var count = Number(sub.fails) || 0;
      if (delivered[hash]) count = 0;
      else if (failed[hash]) count++;
      if (count >= PUSH_MAX_FAILS) remove.push(hash);
      return [count];
    });

    sheet.getRange(2, 8, rows.length, 1).setValues(fails);

    return adminPushDelete_(sheet, remove);
  }
  finally {
    lock.releaseLock();
  }

}
