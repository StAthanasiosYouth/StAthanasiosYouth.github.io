/**
 * ONE SESSION PER ACCOUNT, WHO IS ONLINE, AND EDIT LOCKS
 * (the official admin at /admin/, API mode only)
 *
 * The page signs in with Google, then asks for a session:
 *
 *   apiSessionStart({ device, tab, force })
 *     → { sid, state }                          a new session (and the panel's state)
 *     → { active: { device, since, seen } }     this account is busy on another
 *                                               device/tab (heartbeat < 90 s ago)
 *
 * Every other call carries that sid next to the ID token (doPost checks it,
 * Api.gs). The token still decides who you are; the sid only says "this tab
 * is the account's one live session". A tab whose sid is no longer the
 * account's gets 'session_replaced' and goes back to the sign-in screen.
 *
 *   apiHeartbeat({ area, view, item, locks })   every ~25 s while the page is
 *     visible, and right away when an editor opens or closes: refreshes the
 *     session, says where the admin is, takes/renews the edit locks the page
 *     wants (and lets go of the others); answers with who else is online and
 *     the state of each lock.
 *   apiSessionEnd()                              sign out / leaving the page.
 *
 * Edit locks: '<kind>:<key>' (e.g. 'news:news-ab12cd34', 'sessions:2026-10-11',
 * 'links:link-1', 'settings:location'). A lock lives LOCK_SECONDS after its
 * last heartbeat, and only while its holder's session is still the account's
 * live one, so a closed laptop or a crashed phone never leaves it behind.
 * The save / delete / archive / toggle functions call assertUnlocked_(): a
 * lock held by ANOTHER live session refuses the change ('locked', naming who).
 *
 * State: CacheService (script cache), small JSON, namespaced 'adm:'. Writes
 * happen under the script lock. Nothing here is a credential, and nothing
 * here runs outside the API: in the recovery admin (HtmlService, no API
 * request) these functions answer { off: true } and nothing is ever locked.
 */

var SESSION_STALE_SECONDS = 90;      // no heartbeat this long: another device takes over without asking
var PRESENCE_ONLINE_SECONDS = 70;    // shown as online
var LOCK_SECONDS = 90;               // a lock outlives its last heartbeat by this much
var SESSION_KEEP_SECONDS = 21600;    // CacheService's limit (6 h)
var SESSION_MAX_LOCKS = 6;           // an editor + a settings card's groups
var LOCK_KINDS = ['sessions', 'news', 'games', 'notifications', 'activities', 'types', 'links', 'contacts', 'sections', 'settings', 'media'];


/* =========================================================
   SMALL HELPERS
========================================================= */

/* true inside a doPost request with a verified account */
function presenceMode_() {

  return !!(API_REQUEST_ && API_REQUEST_.email);

}

function presenceNow_() {

  return Date.now();

}

function sessionCacheKey_(email) {

  return 'adm:ses:' + sha256Hex_(email).slice(0, 40);

}

function lockCacheKey_(key) {

  return 'adm:lck:' + key;

}

function goneCacheKey_(sid) {

  return 'adm:gone:' + sid;

}

function readCached_(key) {

  var text = CacheService.getScriptCache().get(key);

  if (!text) return null;

  try {
    var value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }
  catch (ignored) {
    return null;
  }

}

function writeCached_(key, value, seconds) {

  CacheService.getScriptCache().put(key, JSON.stringify(value), seconds);

}

/* text from the page shown to other admins: one line, no controls or bidi tricks, short */
function cleanLabel_(value, max) {

  if (value === null || value === undefined || typeof value === 'object') return '';

  var text = String(value);
  var out = '';

  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    // C0/C1 controls, zero-width and bidi controls, line/paragraph separators, BOM, < >
    var junk = c < 32 || (c >= 127 && c <= 159) || (c >= 8203 && c <= 8207) || (c >= 8232 && c <= 8238) ||
      (c >= 8294 && c <= 8297) || c === 65279 || c === 60 || c === 62;
    out += junk ? ' ' : text.charAt(i);
  }

  return out.replace(/\s+/g, ' ').trim().slice(0, max);

}

function cleanPlace_(value) {

  value = String(value === null || value === undefined ? '' : value);
  return /^[a-z][a-z-]{0,23}$/.test(value) ? value : '';

}

/* '<kind>:<key>' with a known kind, or '' */
function cleanLockKey_(value) {

  var key = typeof value === 'string' ? value : '';
  var match = /^([a-z]+):([\w.,-]{1,80})$/.exec(key);

  return match && LOCK_KINDS.indexOf(match[1]) !== -1 ? key : '';

}

function cleanItem_(item) {

  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

  var kind = LOCK_KINDS.indexOf(item.kind) !== -1 ? item.kind : '';
  var id = typeof item.id === 'string' && /^[\w.,-]{1,80}$/.test(item.id) ? item.id : '';
  var label = cleanLabel_(item.label, 80);

  return kind || label ? { kind: kind, id: id, label: label } : null;

}

function ageSeconds_(stamp, now) {

  var value = Number(stamp);
  return isFinite(value) ? Math.max(0, Math.round((now - value) / 1000)) : 0;

}

function nameOf_(email) {

  return String(email || '').split('@')[0];

}

/* «من دقيقتين» */
function agoText_(seconds) {

  var minutes = Math.floor(seconds / 60);
  var digits = function (n) { return String(n).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; }); };

  if (minutes < 1) return 'من أقل من دقيقة';
  if (minutes === 1) return 'من دقيقة';
  if (minutes === 2) return 'من دقيقتين';
  if (minutes <= 10) return 'من ' + digits(minutes) + ' دقايق';
  if (minutes < 60) return 'من ' + digits(minutes) + ' دقيقة';
  return 'من أكتر من ساعة';

}

function replacedError_() {

  return apiError_('session_replaced', 'الجلسة اتقفلت لأنك دخلت من جهاز تاني.', 'لو عايز تكمّل من هنا، ادخل تاني — الجهاز التاني هيخرج.');

}


/* =========================================================
   THE SESSION
========================================================= */

/**
 * Called by doPost for every function except apiSessionStart. Returns the
 * account's live session record, or throws:
 *  - 'session_replaced' when the sid is missing or another session took over
 *  - 'session_expired' when the account has no session any more (ended,
 *    or forgotten by the cache): the page starts a new one by itself.
 */
function requireSession_(email, sid) {

  sid = typeof sid === 'string' ? sid : '';

  if (!/^[\w-]{16,64}$/.test(sid)) {
    throw apiError_('session_replaced', 'الصفحة دي محتاجة تتفتح من جديد.', 'اعمل Refresh للصفحة وادخل تاني.');
  }

  var current = readCached_(sessionCacheKey_(email));

  if (current && current.sid === sid) {
    return current;
  }

  if (current || CacheService.getScriptCache().get(goneCacheKey_(sid))) {
    throw replacedError_();
  }

  throw apiError_('session_expired', 'الجلسة انتهت.', 'ادخل تاني.');

}

/* lets go of a session's locks; replaced = remember its sid as taken over */
function endSession_(record, replaced) {

  var cache = CacheService.getScriptCache();

  (record.locks || []).forEach(function (key) {
    dropLock_(key, record.sid);
  });

  if (replaced && record.sid) {
    cache.put(goneCacheKey_(record.sid), '1', SESSION_KEEP_SECONDS);
  }

}

/**
 * Starts this account's session on this device.
 * options.device  a coarse label from the page («موبايل أندرويد – Chrome»)
 * options.tab     a random id of this page load: a retry from the same page
 *                 (e.g. after a timeout) is never "another device"
 * options.force   true: end the other session now
 * options.state   false: no panel state in the answer (a quiet restart)
 */
function apiSessionStart(options) {

  var email = assertAdmin_();

  if (!presenceMode_()) {
    return { off: true };
  }

  options = options && typeof options === 'object' ? options : {};

  var device = cleanLabel_(options.device, 40) || 'جهاز';
  var tab = typeof options.tab === 'string' && /^[\w-]{16,64}$/.test(options.tab) ? options.tab : '';
  var withState = options.state !== false;
  var key = sessionCacheKey_(email);
  var lock = LockService.getScriptLock();
  var sid = '';

  lock.waitLock(20000);

  try {

    var now = presenceNow_();
    var current = readCached_(key);
    var live = !!(current && current.sid && now - Number(current.seen) < SESSION_STALE_SECONDS * 1000);

    if (live && options.force !== true && !(tab && current.tab === tab)) {
      return { active: { device: cleanLabel_(current.device, 40), since: ageSeconds_(current.since, now), seen: ageSeconds_(current.seen, now) } };
    }

    if (current && current.sid) {
      endSession_(current, true);
      if (live && options.force === true) log_(email, 'session.takeover', device + ' ← ' + cleanLabel_(current.device, 40));
    }

    sid = Utilities.getUuid();

    writeCached_(key, {
      sid: sid, email: email, tab: tab, device: device,
      since: now, seen: now, area: '', view: '', item: null, locks: []
    }, SESSION_KEEP_SECONDS);

    if (withState) {
      assignMissingIds_();
    }

  }
  finally {
    lock.releaseLock();
  }

  API_REQUEST_.sid = sid;

  return { sid: sid, device: device, state: withState ? apiStateFor_(email) : null };

}

/** Sign out, or the page goes away: the session and its locks end now. */
function apiSessionEnd() {

  var email = assertAdmin_();

  if (!presenceMode_()) {
    return { off: true };
  }

  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    // the heartbeat stops anyway: everything runs out by itself
    return { ended: false };
  }

  try {
    var current = readCached_(sessionCacheKey_(email));
    if (current && current.sid === API_REQUEST_.sid) {
      endSession_(current, false);
      CacheService.getScriptCache().remove(sessionCacheKey_(email));
    }
  }
  finally {
    lock.releaseLock();
  }

  return { ended: true };

}


/* =========================================================
   HEARTBEAT + PRESENCE
========================================================= */

/**
 * info: { area, view, item: { kind, id, label } | null, locks: ['<kind>:<key>', …] }
 * → { locks: { key: { granted } | { granted: false, holder } }, others: [...], busy? }
 */
function apiHeartbeat(info) {

  var email = assertAdmin_();

  if (!presenceMode_()) {
    return { off: true };
  }

  info = info && typeof info === 'object' ? info : {};

  var wanted = [];

  (Array.isArray(info.locks) ? info.locks : []).forEach(function (value) {
    var key = cleanLockKey_(value);
    if (key && wanted.indexOf(key) === -1 && wanted.length < SESSION_MAX_LOCKS) wanted.push(key);
  });

  var result = { locks: {}, others: [] };
  var lock = LockService.getScriptLock();

  // a long publish holds the lock: skip this beat's writes rather than wait (the next one renews)
  if (lock.tryLock(8000)) {

    try {

      var now = presenceNow_();
      var record = requireSession_(email, API_REQUEST_.sid);
      var held = [];

      wanted.forEach(function (key) {
        var status = takeLock_(key, record, now);
        result.locks[key] = status;
        if (status.granted) held.push(key);
      });

      (record.locks || []).forEach(function (key) {
        if (held.indexOf(key) === -1) dropLock_(key, record.sid);
      });

      record.locks = held;
      record.seen = now;
      record.area = cleanPlace_(info.area);
      record.view = cleanPlace_(info.view);
      record.item = cleanItem_(info.item);

      writeCached_(sessionCacheKey_(email), record, SESSION_KEEP_SECONDS);

    }
    finally {
      lock.releaseLock();
    }

  }
  else {
    result.busy = true;
  }

  result.others = othersOnline_(email, presenceNow_());

  return result;

}

/* the other admins with a recent heartbeat: email, device and where they are — nothing else */
function othersOnline_(email, now) {

  var emails = adminEmails_().filter(function (other) { return other !== email; });

  if (!emails.length) return [];

  var keys = emails.map(sessionCacheKey_);
  var found = CacheService.getScriptCache().getAll(keys) || {};
  var others = [];

  emails.forEach(function (other, i) {
    var record = null;
    try { record = found[keys[i]] ? JSON.parse(found[keys[i]]) : null; }
    catch (ignored) { record = null; }
    if (!record || now - Number(record.seen) >= PRESENCE_ONLINE_SECONDS * 1000) return;
    others.push({
      email: other,
      name: nameOf_(other),
      device: cleanLabel_(record.device, 40),
      seen: ageSeconds_(record.seen, now),
      area: cleanPlace_(record.area),
      view: cleanPlace_(record.view),
      item: cleanItem_(record.item)
    });
  });

  return others;

}


/* =========================================================
   EDIT LOCKS
========================================================= */

/* alive = not run out, and its holder is still its account's live session */
function lockAlive_(lock, now) {

  if (!lock || !(Number(lock.exp) > now) || !lock.email) return false;

  var holder = readCached_(sessionCacheKey_(lock.email));

  return !!(holder && holder.sid === lock.sid);

}

function holderOf_(lock, now) {

  return { email: lock.email, name: nameOf_(lock.email), device: cleanLabel_(lock.device, 40), since: ageSeconds_(lock.since, now) };

}

/* call under the script lock */
function takeLock_(key, record, now) {

  var current = readCached_(lockCacheKey_(key));

  if (current && current.sid !== record.sid && lockAlive_(current, now)) {
    return { granted: false, holder: holderOf_(current, now) };
  }

  writeCached_(lockCacheKey_(key), {
    sid: record.sid,
    email: record.email,
    device: record.device,
    since: current && current.sid === record.sid ? current.since : now,
    exp: now + LOCK_SECONDS * 1000
  }, LOCK_SECONDS + 60);

  return { granted: true };

}

function dropLock_(key, sid) {

  var current = readCached_(lockCacheKey_(key));

  if (current && current.sid === sid) {
    CacheService.getScriptCache().remove(lockCacheKey_(key));
  }

}

/**
 * Refuses a change to something another live session is editing. Only in
 * API mode (the recovery admin is unchanged); a lock of the caller's own
 * session, a lock that ran out, or no lock: go ahead.
 */
function assertUnlocked_(keys) {

  if (!API_REQUEST_ || !API_REQUEST_.sid) {
    return;
  }

  var now = presenceNow_();

  [].concat(keys).forEach(function (key) {

    // a key nobody could have locked (locks are taken only with clean keys)
    if (!cleanLockKey_(key)) return;

    var current = readCached_(lockCacheKey_(key));

    if (current && current.sid !== API_REQUEST_.sid && lockAlive_(current, now)) {
      var holder = holderOf_(current, now);
      throw apiError_('locked', holder.name + ' بيعدّل ده دلوقتي (' + agoText_(holder.since) + ').',
        'استنى لما يخلّص، وبعدين افتح آخر نسخة وعدّل. الحاجات التانية تقدر تعدّلها عادي.');
    }

  });

}

/* the locks of a settings save: one per group it touches ('settings:location', 'settings:games') */
function settingsLockKeys_(values) {

  var keys = [];

  Object.keys(values || {}).forEach(function (name) {
    var key = 'settings:' + String(name).split('.')[0];
    if (cleanLockKey_(key) && keys.indexOf(key) === -1) keys.push(key);
  });

  return keys;

}
