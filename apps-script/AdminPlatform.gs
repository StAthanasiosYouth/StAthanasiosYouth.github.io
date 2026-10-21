/* =========================================================
   PHASE 3 — THE ADMIN PLATFORM ON THE WORKER (docs/ADMIN-PLATFORM-PLAN.md)
   ---------------------------------------------------------
   While the Script Property ADMIN_PLATFORM is 'worker', the panel's session,
   presence and edit locks live in D1 (worker/src/admin/session.js), not in
   this script's cache. This script then:

   - takes the Worker's panel token ('wk1.' with the session id `s` inside,
     HMAC with WORKER_SYNC_SECRET — the same secret and shape as
     apiWorkerSession) in place of a Google ID token; the request's sid must
     be the one inside it;
   - asks the Worker whether that sid is still the account's live session
     (POST /v1/sync/session, signed; the answer cached SESSION_CHECK_S per
     sid) — requireSession_ in Presence.gs;
   - asks the Worker who holds an edit lock before a save (lockHolder_ /
     assertUnlocked_, never cached);
   - shows the admins' names from D1 (the grants snapshot).

   Anything else (absent, 'apps') = today's behaviour, unchanged. Rollback:
   delete the property (the panel's config goes back first, see the plan).
   A panel token is never a Google token: GOOGLE_ONLY_FUNCTIONS still answer
   'reauth' to it.
========================================================= */

var ADMIN_PLATFORM_KEY = 'ADMIN_PLATFORM';
var SESSION_CHECK_S = 20;

/* true while the Worker owns the panel's sessions */
function adminPlatformWorker_() {

  if (API_REQUEST_ && API_REQUEST_.platform !== undefined) return API_REQUEST_.platform;

  var on = false;
  try {
    on = PropertiesService.getScriptProperties().getProperty(ADMIN_PLATFORM_KEY) === 'worker';
  }
  catch (ignored) {
    on = false;
  }

  if (API_REQUEST_) API_REQUEST_.platform = on;
  return on;

}

/* the Worker's panel token → { email, via, sid }, or an 'auth' error. Checked here, no call. */
function verifyPanelToken_(token) {

  var m = /^wk1\.([A-Za-z0-9_-]{10,600})\.([0-9a-f]{64})$/.exec(String(token || ''));
  var secret = workerSyncSecret_();

  if (!m || !secret || !sameHex_(hmacHex_(secret, 'wk1.' + m[1]), m[2])) throw authError_();

  var claims = null;
  try {
    var padded = m[1] + '===='.slice(0, (4 - m[1].length % 4) % 4);
    claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString('UTF-8'));
  }
  catch (ignored) {
    claims = null;
  }

  var now = Math.floor(Date.now() / 1000);
  var email = claims ? normalizeEmail_(claims.e) : '';
  var sid = claims && typeof claims.s === 'string' && /^[\w-]{16,64}$/.test(claims.s) ? claims.s : '';

  // 60 s of clock skew, at most 20 minutes long, and only a panel token (with its session)
  if (!email || !sid || !(Number(claims.x) > now - 60) || Number(claims.x) - Number(claims.i) > 1200 || Number(claims.i) > now + 60) {
    throw authError_();
  }

  return { email: email, via: claims.v === 'device' ? 'device' : 'google', sid: sid };

}

/* POST /v1/sync/session → { state, holders } or null (the Worker can't be asked) */
function workerSessionAsk_(email, sid, locks) {

  var secret = workerSyncSecret_();
  if (!secret) return null;

  try {
    var body = JSON.stringify({ email: email, sid: sid, locks: locks || [] });
    var ts = String(Date.now());
    var response = UrlFetchApp.fetch(WORKER_API_URL + '/v1/sync/session', {
      method: 'post',
      contentType: 'text/plain; charset=utf-8',
      payload: Utilities.newBlob(body).getBytes(),
      headers: { 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + hmacHex_(secret, ts + '.' + body) },
      muteHttpExceptions: true,
      followRedirects: false
    });
    if (response.getResponseCode() !== 200) {
      console.warn('platform: session check HTTP ' + response.getResponseCode());
      return null;
    }
    var reply = JSON.parse(response.getContentText());
    return reply && reply.ok ? reply : null;
  }
  catch (error) {
    console.warn('platform: session check failed');
    return null;
  }

}

/*
 * requireSession_ while the Worker owns the sessions: the sid must be the
 * account's live one there. A recent 'live' answer is reused SESSION_CHECK_S;
 * the Worker unreachable = refused (fails closed: 'session_expired' makes the
 * page start again, through the Worker).
 */
function requireWorkerSession_(email, sid) {

  if (!/^[\w-]{16,64}$/.test(String(sid || ''))) {
    throw apiError_('session_replaced', 'الصفحة دي محتاجة تتفتح من جديد.', 'اعمل Refresh للصفحة وادخل تاني.');
  }

  var cache = CacheService.getScriptCache();
  var key = 'adm:wsc:' + sha256Hex_(email + '|' + sid).slice(0, 40);

  if (cache.get(key) === 'live') return { sid: sid, email: email };

  var reply = workerSessionAsk_(email, sid, []);
  var state = reply ? reply.state : '';

  if (state === 'live') {
    cache.put(key, 'live', SESSION_CHECK_S);
    return { sid: sid, email: email };
  }
  if (state === 'replaced') throw replacedError_();
  if (state === 'expired') throw expiredError_();

  throw apiError_('busy', 'مقدرناش نتأكد من الجلسة دلوقتي.', 'جرّب تاني كمان شوية.');

}

/* lockHolder_ while the Worker owns the locks: another live session's holder, else null */
function workerLockHolder_(key) {

  var reply = workerSessionAsk_(API_REQUEST_.email, API_REQUEST_.sid, [key]);

  // the Worker can't be asked: refuse the change rather than overwrite someone's open editor
  if (!reply) {
    throw apiError_('busy', 'مقدرناش نتأكد إن محدش بيعدّل ده دلوقتي.', 'جرّب تاني كمان شوية.');
  }

  var h = reply.holders && reply.holders[key];

  return h ? { email: h.email, name: h.name || nameOf_(h.email), device: cleanLabel_(h.device, 40), since: Number(h.since) || 0 } : null;

}

/* the old session calls of a panel that still runs the Apps Script sessions: «refresh» */
function platformMovedError_() {

  return apiError_('session_expired', 'لوحة التحكم اتحدّثت.', 'اعمل Refresh للصفحة وادخل تاني.');

}

/* the admins' names from D1 (the grants snapshot), over ADMIN_NAMES; {} when it can't be read */
function platformNames_() {

  try {
    var snapshot = grantsFresh_();
    var names = {};
    (snapshot && snapshot.admins || []).forEach(function (a) {
      var email = normalizeEmail_(a.email);
      var name = cleanDisplayName_(a.name).slice(0, ADMIN_NAME_MAX);
      if (email && name.length >= ADMIN_NAME_MIN) names[email] = name;
    });
    return names;
  }
  catch (ignored) {
    return {};
  }

}
