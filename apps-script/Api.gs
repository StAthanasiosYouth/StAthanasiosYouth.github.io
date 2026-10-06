/**
 * THE ADMIN API (doPost) — for the official admin page at
 * https://stathanasiosyouth.github.io/admin/
 *
 * The page is static (GitHub Pages). It signs the admin in with "Sign in with
 * Google" and sends every call here as
 *
 *     POST <API deployment>/exec   (Content-Type: text/plain, no cookies)
 *     { "fn": "apiState", "args": [...], "token": "<Google ID token>" }
 *
 * and gets back JSON: { ok: true, result } or { ok: false, error, code }.
 * `error` is the same text google.script.run would have passed to the page
 * (appError_ JSON or plain Arabic), so the admin's error UI is unchanged.
 *
 * This deployment runs as the owner and accepts anonymous requests (a fetch
 * from github.io can't carry Google cookies), so NOTHING here trusts the
 * Session. For every request, before anything else:
 *
 *  1. the ID token is verified with Google (tokeninfo; cached per token hash
 *     in CacheService until it expires): aud = ADMIN_CLIENT_ID (Script
 *     Property), iss = accounts.google.com, not expired, email verified;
 *  2. that email must be on the allowlist (ADMIN_EMAILS, Auth.gs);
 *  3. only a function listed in apiFunctions_() runs — never any other
 *     global — and it runs with currentEmail_() = that verified email.
 *
 * Anything missing or wrong fails closed, for every function. Responses never
 * contain Script Properties, the token, or the GitHub token.
 */

var ID_TOKEN_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
var API_MAX_BODY = 12 * 1024 * 1024;
var API_MAX_ARGS = 6;
var TOKEN_CACHE_MAX_SECONDS = 21600;   // CacheService's limit (6 h); ID tokens live 1 h
var BAD_TOKEN_CACHE_SECONDS = 600;


/*
 * The only functions the API runs. Adding an api* function means adding it
 * here too (tests/refine-b.test.mjs checks the two lists match).
 */
function apiFunctions_() {

  return {
    apiState: apiState,
    apiReview: apiReview,
    apiPreview: apiPreview,
    apiPublish: apiPublish,
    apiCheckGithub: apiCheckGithub,
    apiSaveLink: apiSaveLink,
    apiSetLinkEnabled: apiSetLinkEnabled,
    apiDeleteLink: apiDeleteLink,
    apiMoveLink: apiMoveLink,
    apiSaveSection: apiSaveSection,
    apiSetSectionEnabled: apiSetSectionEnabled,
    apiDeleteSection: apiDeleteSection,
    apiMoveSection: apiMoveSection,
    apiSaveContact: apiSaveContact,
    apiDeleteContact: apiDeleteContact,
    apiMoveContact: apiMoveContact,
    apiSaveSettings: apiSaveSettings,
    apiResolveMapsUrl: apiResolveMapsUrl,
    apiSaveItem: apiSaveItem,
    apiDeleteItem: apiDeleteItem,
    apiSetItemArchived: apiSetItemArchived,
    apiDuplicateItem: apiDuplicateItem,
    apiSetItemEnabled: apiSetItemEnabled,
    apiUploadMedia: apiUploadMedia,
    apiCheckMedia: apiCheckMedia,
    apiMediaLibrary: apiMediaLibrary,
    apiUpdateMedia: apiUpdateMedia,
    apiDeleteMedia: apiDeleteMedia,
    apiRestoreMedia: apiRestoreMedia,
    apiPurgeMedia: apiPurgeMedia,
    apiMediaPreview: apiMediaPreview,
    apiSetMediaAlt: apiSetMediaAlt,
    apiPlanMigration: apiPlanMigration,
    apiMigrate: apiMigrate,
    apiAdmins: apiAdmins,
    apiAddAdmin: apiAddAdmin,
    apiRemoveAdmin: apiRemoveAdmin
  };

}


function doPost(e) {

  // API mode from the first line: no verified token yet = nobody
  API_REQUEST_ = { email: '' };

  var reply;

  try {

    var request = readApiRequest_(e);
    var email = verifyIdToken_(request.token);

    if (!isAdmin_(email)) {
      console.warn('api: not on the allowlist: ' + email);
      throw apiError_('denied', 'مش مسموح لك تستخدم لوحة التحكم.', 'الحساب ده (' + email + ') مش في قايمة الصلاحيات. اطلب من أدمن يضيفه، أو ادخل بحساب تاني.');
    }

    var functions = apiFunctions_();

    if (!Object.prototype.hasOwnProperty.call(functions, request.fn) || typeof functions[request.fn] !== 'function') {
      throw apiError_('fn', 'الطلب ده مش معروف.', 'اعمل Refresh للصفحة.');
    }

    API_REQUEST_.email = email;

    var result = functions[request.fn].apply(null, request.args);

    reply = { ok: true, result: result === undefined ? null : result };

  }
  catch (error) {

    reply = { ok: false, error: String((error && error.message) || error || ''), code: (error && error.apiCode) || '' };

  }
  finally {

    API_REQUEST_ = null;

  }

  return jsonOutput_(reply);

}


function jsonOutput_(value) {

  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);

}


/* an error the page shows (appError_ shape) plus a code its transport acts on */
function apiError_(code, message, hint) {

  var error = appError_(message, hint);
  error.apiCode = code;
  return error;

}


function readApiRequest_(e) {

  var body = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  var data = null;

  if (!body || body.length > API_MAX_BODY) {
    throw apiError_('bad', 'الطلب مش مفهوم.', 'اعمل Refresh للصفحة.');
  }

  try {
    data = JSON.parse(body);
  }
  catch (ignored) {
    data = null;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.fn !== 'string' ||
      (data.args !== undefined && !Array.isArray(data.args)) || (data.args && data.args.length > API_MAX_ARGS)) {
    throw apiError_('bad', 'الطلب مش مفهوم.', 'اعمل Refresh للصفحة.');
  }

  return { fn: data.fn, args: data.args || [], token: typeof data.token === 'string' ? data.token : '' };

}


/* =========================================================
   GOOGLE ID TOKEN
========================================================= */

function adminClientId_() {

  var id = String(PropertiesService.getScriptProperties().getProperty('ADMIN_CLIENT_ID') || '').trim();

  return /^[\w-]+\.apps\.googleusercontent\.com$/.test(id) ? id : '';

}


function authError_() {

  return apiError_('auth', 'لازم تدخل بحساب جوجل تاني.', 'الدخول انتهى أو مش صحيح. ادخل تاني وكمّل من مكانك.');

}


/**
 * The verified, lower-case email of a Google ID token, or an 'auth' error.
 * Google checks the signature (tokeninfo); we check what it is for.
 */
function verifyIdToken_(token) {

  token = String(token || '');

  // a JWT: three base64url parts, of a sane size
  if (token.length < 20 || token.length > 4096 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
    throw authError_();
  }

  var clientId = adminClientId_();

  if (!clientId) {
    throw apiError_('config', 'لوحة التحكم لسه مش متظبطة.', 'ADMIN_CLIENT_ID ناقص في Script Properties (docs/ADMIN-SETUP.md).');
  }

  var cache = CacheService.getScriptCache();
  var key = 'idtoken:' + sha256Hex_(token);
  var cached = cache.get(key);
  var claims = null;

  if (cached) {
    claims = JSON.parse(cached);
    if (claims.bad) {
      throw authError_();
    }
  }
  else {
    var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'post',
      payload: { id_token: token },
      muteHttpExceptions: true
    });

    try {
      claims = response.getResponseCode() === 200 ? JSON.parse(response.getContentText()) : null;
    }
    catch (ignored) {
      claims = null;
    }

    if (!claims || typeof claims !== 'object') {
      cache.put(key, JSON.stringify({ bad: 1 }), BAD_TOKEN_CACHE_SECONDS);
      throw authError_();
    }
  }

  // checked every time, cached or not (the client ID may have changed, time moves on)
  var now = Math.floor(Date.now() / 1000);
  var exp = Number(claims.exp);
  var email = normalizeEmail_(claims.email);
  var ok = claims.aud === clientId &&
    ID_TOKEN_ISSUERS.indexOf(claims.iss) !== -1 &&
    isFinite(exp) && exp > now &&
    (claims.email_verified === true || claims.email_verified === 'true') &&
    !!email;

  if (!ok) {
    if (!cached) {
      cache.put(key, JSON.stringify({ bad: 1 }), BAD_TOKEN_CACHE_SECONDS);
    }
    throw authError_();
  }

  if (!cached) {
    cache.put(key, JSON.stringify({
      aud: claims.aud, iss: claims.iss, exp: exp, email: email, email_verified: true
    }), Math.max(1, Math.min(TOKEN_CACHE_MAX_SECONDS, exp - now)));
  }

  return email;

}


/* =========================================================
   WHICH DEPLOYMENT IS THIS?
========================================================= */

/**
 * True when this execution runs as the owner rather than as the visitor
 * (manifest webapp.executeAs USER_DEPLOYING: the API deployment). There the
 * visitor's email is unknown (''), so it differs from the owner's.
 *
 * Used only to REFUSE the HTML admin (doGet), never to let anyone in. The
 * one case it can't tell apart, the owner himself opening the API URL while
 * signed in to Google, is the same person the recovery admin would serve.
 */
function runsAsOwner_() {

  var visitor = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  var runner = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();

  return !visitor || visitor !== runner;

}
