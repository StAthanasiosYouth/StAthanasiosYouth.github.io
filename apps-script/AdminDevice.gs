/**
 * «خليك داخل» ON THE INSTALLED ADMIN APP: a trusted device.
 *
 * The admin API takes a Google ID token on every call (Api.gs); it lives
 * one hour, and getting a new one at each app launch meant choosing the
 * Google account every time. The installed admin app («لوحة تحكم الأسرة»,
 * opened from its own icon) may instead keep a DEVICE credential:
 *
 *  1. Right after a real Google sign-in in the app, the page asks
 *     apiTrustDevice (Google token only — never with a device token). The
 *     server makes a random 256-bit secret, keeps it in Script Properties
 *     (ADMIN_DEVICE_<id>: never in the Sheet, never logged) with the
 *     account, a label and a hard end: DEVICE_TRUST_DAYS after THIS Google
 *     sign-in (never extended by use; the next Google sign-in in the app
 *     makes a new one and drops the old). The page turns the secret into a
 *     NON-EXTRACTABLE WebCrypto HMAC key (admin/device.js): script can sign
 *     with it, nothing can read it back.
 *  2. A later launch signs "<id>.<ms>.<nonce>" with that key and sends it to
 *     deviceSignIn (doPost, no Google token): the device must exist, not be
 *     past its end, the time within DEVICE_SKEW_MS, the nonce unused, the
 *     signature right (constant-time), the account still on the allowlist.
 *     Then a random access token ('adm1.…', DEVICE_TOKEN_SECONDS, kept
 *     hashed in CacheService) stands in for the ID token: the same allowlist
 *     check, sessions, locks and logging on every call (Api.gs). The device
 *     is checked again on every call, so removing it works at once.
 *  3. It ends: «خروج» (apiForgetDevice), the end date, the admin being
 *     removed (Auth.gs → forgetTrustedDevices_), too many bad signatures.
 *
 * With a device token, the calls in GOOGLE_ONLY_FUNCTIONS answer 'reauth':
 * the page asks Google again (adding/removing admins, trusting a device).
 */

var DEVICE_PREFIX = 'ADMIN_DEVICE_';
var DEVICE_TRUST_DAYS = 30;
var DEVICE_PER_ADMIN = 5;
var DEVICE_MAX = 50;
var DEVICE_SKEW_MS = 10 * 60000;
var DEVICE_TOKEN_SECONDS = 3600;
var DEVICE_FAIL_MAX = 10;
// approving a payment number redirects real money (PayDest.gs): Google itself, never a remembered device
var GOOGLE_ONLY_FUNCTIONS = ['apiAddAdmin', 'apiRemoveAdmin', 'apiTrustDevice', 'apiServantPayApprove'];


function deviceKey_(id) {

  return DEVICE_PREFIX + id;

}

function cleanDeviceId_(value) {

  var id = String(value || '');
  return /^[0-9a-f]{24}$/.test(id) ? id : '';

}

function randomHex_(bytes) {

  var text = '';
  while (text.length < bytes * 2) {
    text += sha256Hex_(Utilities.getUuid() + Utilities.getUuid() + Date.now() + text);
  }
  return text.slice(0, bytes * 2);

}

function readDevice_(id) {

  id = cleanDeviceId_(id);
  if (!id) return null;

  try {
    var value = JSON.parse(PropertiesService.getScriptProperties().getProperty(deviceKey_(id)) || 'null');
    return value && typeof value === 'object' && value.email && value.secret ? value : null;
  }
  catch (ignored) {
    return null;
  }

}

/* every trusted device: [{ id, email, until, created, last, label }] (never the secret) */
function trustedDevices_() {

  var all = PropertiesService.getScriptProperties().getProperties();

  return Object.keys(all).filter(function (key) { return key.indexOf(DEVICE_PREFIX) === 0; }).map(function (key) {
    var value = null;
    try { value = JSON.parse(all[key]); }
    catch (ignored) { value = null; }
    return value ? { id: key.slice(DEVICE_PREFIX.length), email: value.email, until: value.until, created: value.created, last: value.last || 0, label: value.label || '' } : null;
  }).filter(Boolean);

}

function deleteDevice_(id) {

  if (cleanDeviceId_(id)) PropertiesService.getScriptProperties().deleteProperty(deviceKey_(id));

}

/* an admin left the list (Auth.gs): none of their devices signs in again */
function forgetTrustedDevices_(email) {

  try {
    trustedDevices_().forEach(function (d) { if (d.email === email) deleteDevice_(d.id); });
  }
  catch (error) {
    console.warn('device: not removed for a removed admin');
  }

}

function hmacHex_(secret, message) {

  return Utilities.computeHmacSha256Signature(message, secret, Utilities.Charset.UTF_8)
    .map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; })
    .join('');

}

/* the same length, every character compared (no early exit) */
function sameHex_(a, b) {

  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length || !a.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;

}


/**
 * After a Google sign-in in the installed admin app: a device credential.
 * options: { label, previous } → { deviceId, secret, until }
 */
function apiTrustDevice(options) {

  var email = assertAdmin_();

  // only the API, only with a Google token (doPost refuses device tokens here too)
  if (!presenceMode_() || API_REQUEST_.via !== 'google') {
    throw apiError_('reauth', 'محتاجين نتأكد إنه انت.', 'ادخل بحساب جوجل وكمّل.');
  }

  options = options && typeof options === 'object' ? options : {};

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {

    var now = Date.now();
    var mine = trustedDevices_().filter(function (d) { return d.email === email; });
    var previous = cleanDeviceId_(options.previous);

    // the same phone again: its old credential goes
    if (previous && mine.some(function (d) { return d.id === previous; })) {
      deleteDevice_(previous);
      mine = mine.filter(function (d) { return d.id !== previous; });
    }

    // expired ones go; a full set: the least recently used makes room
    mine.filter(function (d) { return !(Number(d.until) > now); }).forEach(function (d) { deleteDevice_(d.id); });
    mine = mine.filter(function (d) { return Number(d.until) > now; }).sort(function (a, b) { return (a.last || a.created) - (b.last || b.created); });
    while (mine.length >= DEVICE_PER_ADMIN) deleteDevice_(mine.shift().id);

    if (trustedDevices_().length >= DEVICE_MAX) {
      throw appError_('وصلنا لأقصى عدد أجهزة متذكرة.', 'ادخل عادي من غير «خليك داخل».');
    }

    var id = randomHex_(12);
    var secret = randomHex_(32);
    var until = now + DEVICE_TRUST_DAYS * 86400000;

    PropertiesService.getScriptProperties().setProperty(deviceKey_(id), JSON.stringify({
      email: email, secret: secret, created: now, until: until, last: now, label: cleanLabel_(options.label, 40)
    }));

  }
  finally {
    lock.releaseLock();
  }

  log_(email, 'device.trust', cleanLabel_(options.label, 40));

  return { deviceId: id, secret: secret, until: until };

}


/** «خروج» on the app: its device credential ends now. options: { deviceId } (a device token: its own) */
function apiForgetDevice(options) {

  var email = assertAdmin_();
  var id = API_REQUEST_ && API_REQUEST_.device ? API_REQUEST_.device : cleanDeviceId_(options && options.deviceId);
  var device = readDevice_(id);

  if (device && device.email === email) {
    deleteDevice_(id);
    log_(email, 'device.forget', id.slice(0, 6));
  }

  return { forgotten: !!device };

}


/*
 * doPost 'deviceSignIn' (no Google token): { deviceId, ts, nonce, sig }
 * → { ok, token, exp, email } | { ok: false, code }
 * Never says which part was wrong.
 */
function publicDeviceSignIn_(request) {

  try {

    request = request && typeof request === 'object' ? request : {};

    var id = cleanDeviceId_(request.deviceId);
    var ts = Number(request.ts);
    var nonce = String(request.nonce || '');
    var sig = String(request.sig || '');
    var now = Date.now();
    var cache = CacheService.getScriptCache();

    if (!id || !isFinite(ts) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) {
      return { ok: false, code: 'bad' };
    }

    var failKey = 'adm:df:' + id;
    var fails = Number(cache.get(failKey)) || 0;
    var device = readDevice_(id);

    if (!device || fails >= DEVICE_FAIL_MAX) {
      return { ok: false, code: 'device' };
    }

    if (!(Number(device.until) > now)) {
      deleteDevice_(id);
      return { ok: false, code: 'expired' };
    }

    var fresh = Math.abs(now - ts) <= DEVICE_SKEW_MS;
    var used = cache.get('adm:dn:' + nonce);
    var good = fresh && !used && sameHex_(hmacHex_(device.secret, id + '.' + ts + '.' + nonce), sig);

    if (!good) {
      cache.put(failKey, String(fails + 1), 3600);
      if (fails + 1 >= DEVICE_FAIL_MAX) deleteDevice_(id);
      return { ok: false, code: 'device' };
    }

    cache.put('adm:dn:' + nonce, '1', Math.round(DEVICE_SKEW_MS * 2 / 1000));

    // still an admin? (else the device goes too)
    if (!isAdmin_(normalizeEmail_(device.email))) {
      deleteDevice_(id);
      return { ok: false, code: 'denied' };
    }

    var token = 'adm1.' + randomHex_(32);
    var exp = Math.floor(now / 1000) + DEVICE_TOKEN_SECONDS;

    cache.put('adm:at:' + sha256Hex_(token).slice(0, 40), JSON.stringify({ email: device.email, device: id, exp: exp }), DEVICE_TOKEN_SECONDS);

    device.last = now;
    PropertiesService.getScriptProperties().setProperty(deviceKey_(id), JSON.stringify(device));

    var reply = { ok: true, token: token, exp: exp, email: device.email };

    // the app's launch: the panel's session too, in the SAME round trip (before: deviceSignIn,
    // then apiSessionStart — two Apps Script waits behind «جاري استعادة الجلسة»)
    if (request.start && typeof request.start === 'object') {
      reply.session = deviceStartSession_(device.email, id, request.start);
    }

    return reply;

  }
  catch (error) {
    console.warn('device: sign-in failed');
    return { ok: false, code: 'error' };
  }

}


/*
 * apiSessionStart for a device that just proved itself: as that admin, with
 * this device credential's id on the session. The app swiped away earlier
 * leaves its session "live" for a while (no beacon on a phone): the SAME
 * device credential takes its own session over without the «another device»
 * question; any other device still gets it. → apiSessionStart's answer
 * ({ sid, state } | { active }), or { error } (the client then starts the usual way).
 */
function deviceStartSession_(email, deviceId, start) {

  var before = API_REQUEST_;

  try {
    API_REQUEST_ = { email: normalizeEmail_(email), via: 'device', sid: '' };
    return apiSessionStart({ device: start.device, tab: start.tab, force: start.force === true, state: true }, { deviceId: deviceId });
  }
  catch (error) {
    console.warn('device: session not started: ' + ((error && error.message) || error));
    return { error: true };
  }
  finally {
    API_REQUEST_ = before;
  }

}

/* doPost: the email of a device access token ('adm1.…'), or an 'auth' error */
function verifyDeviceToken_(token) {

  token = String(token || '');

  if (!/^adm1\.[0-9a-f]{64}$/.test(token)) throw authError_();

  var text = CacheService.getScriptCache().get('adm:at:' + sha256Hex_(token).slice(0, 40));
  var claims = null;

  try { claims = text ? JSON.parse(text) : null; }
  catch (ignored) { claims = null; }

  // gone, run out, or its device was removed meanwhile (logout, admin removed)
  if (!claims || !(Number(claims.exp) * 1000 > Date.now())) throw authError_();

  var device = readDevice_(claims.device);

  if (!device || device.email !== claims.email || !(Number(device.until) > Date.now())) throw authError_();

  API_REQUEST_.device = claims.device;

  return normalizeEmail_(claims.email);

}
