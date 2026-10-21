/**
 * AUTHORIZATION
 *
 * Two ways in, one allowlist:
 *
 * 1. The recovery admin (HtmlService, Admin.html): a deployment that runs as
 *    "User accessing the web app". Google signs the visitor in; the email is
 *    Session.getActiveUser().
 * 2. The official admin at https://stathanasiosyouth.github.io/admin/ talks
 *    to doPost (Api.gs) on a deployment that runs as the owner. Each request
 *    carries a Google ID token; Api.gs verifies it with Google and puts the
 *    verified email in API_REQUEST_ for that one request. In that mode the
 *    Session is never consulted: no verified token = no email = no access.
 *
 * - The allowlist is the ADMIN_EMAILS Script Property (comma separated).
 *   It is not in the code, so the public repo never contains it. Admins can
 *   add and remove emails from the panel (apiAddAdmin / apiRemoveAdmin);
 *   the primary admin (ADMIN_PRIMARY, default below) can't be removed and
 *   the list is never left empty.
 * - Every server function the page can call checks it first (assertAdmin_).
 * - Fails closed: no property, no admins.
 * - Session.getEffectiveUser() is never used to decide who someone is.
 *
 * Note for maintainers: Apps Script lets the browser call ANY top-level
 * function whose name does not end with "_" (google.script.run). Keep helpers
 * private with a trailing underscore, and start every public api* function
 * with assertAdmin_(). The API (doPost) only runs the functions listed in
 * apiFunctions_() (Api.gs).
 */

/* the primary admin: always on the list it is on, can never be removed */
var DEFAULT_PRIMARY_ADMIN = 'menazakmena@gmail.com';

/* how many emails the allowlist may hold */
var MAX_ADMINS = 20;

/*
 * One API request (doPost) at a time per execution: { email } once the ID
 * token is verified, '' before that, plus { sid } once the request's
 * session is checked (Presence.gs). null outside the API (HtmlService and
 * the Apps Script editor), where the Google session decides.
 */
var API_REQUEST_ = null;


function currentEmail_() {

  if (API_REQUEST_) {
    // API mode: only a verified token's email, never the Session
    return API_REQUEST_.email || '';
  }

  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();

}


/* a cleaned-up email, or '' when it isn't one */
function normalizeEmail_(value) {

  var email = String(value === null || value === undefined ? '' : value).trim().toLowerCase();

  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/.test(email)) {
    return '';
  }

  return email;

}


function adminEmails_() {

  // read once per API request (the heartbeat asks several times; Script
  // Properties reads have a daily quota). Never kept between requests.
  if (API_REQUEST_ && API_REQUEST_.admins) {
    return API_REQUEST_.admins.slice();
  }

  var seen = Object.create(null);

  var emails = String(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '')
    .split(',')
    .map(function (email) { return email.trim().toLowerCase(); })
    .filter(function (email) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || seen[email]) return false;
      seen[email] = true;
      return true;
    });

  if (API_REQUEST_) {
    API_REQUEST_.admins = emails.slice();
  }

  return emails;

}

/* the allowlist was just written: the next read is fresh */
function forgetAdminEmails_() {

  if (API_REQUEST_) {
    API_REQUEST_.admins = null;
  }

}


function primaryAdmin_() {

  return normalizeEmail_(PropertiesService.getScriptProperties().getProperty('ADMIN_PRIMARY')) || DEFAULT_PRIMARY_ADMIN;

}


function isAdmin_(email) {

  return !!email && adminEmails_().indexOf(email) !== -1;

}


/** Throws unless the signed-in Google account is on the allowlist. */
function assertAdmin_() {

  var email = currentEmail_();

  if (!isAdmin_(email)) {
    // generic message: don't reveal who the admins are
    throw new Error('مش مسموح لك تستخدم لوحة التحكم.');
  }

  // the recovery panel (HtmlService) has no per-function permission check:
  // while permissions are enforced (Grants.gs) it is the Primary Admin's only
  if (!API_REQUEST_ && email !== primaryAdmin_()) {
    var grants = grantsSnapshot_();
    if (grants && grants.enforce) throw new Error('مش مسموح لك تستخدم لوحة التحكم.');
  }

  return email;

}


/* =========================================================
   «صلاحيات لوحة التحكم»: the allowlist, from the panel
========================================================= */

function adminList_(me) {

  var primary = primaryAdmin_();

  return {
    emails: adminEmails_(),
    // how each is shown (Activity.gs): the display name, else the email's local part
    names: adminDirectory_(),
    stored: adminNames_(),
    primary: primary,
    me: me,
    max: MAX_ADMINS
  };

}


/** The allowed Google emails (admins only). */
function apiAdmins() {

  var me = assertAdmin_();
  grantsRefreshAllowlist_(true);   // «الصلاحيات» asks right after an add or a removal: follow D1 now (Grants.gs)
  return adminList_(me);

}


/*
 * Phase 1.5 (docs/BOOKING-PHASE1-COMPLETION-PLAN.md §4.3): D1 owns the admin
 * accounts. Adding and removing happen in «الصلاحيات» (the Worker,
 * worker/src/lib/accounts.js) with the Primary Admin protections and the audit;
 * ADMIN_EMAILS follows D1 (Grants.gs grantsMirror_: on a grants pull, and at once
 * at the sign-in gate, the rename and the admins list: grantsRefreshAllowlist_). These two
 * stay listed (older panels still call them) and only point there.
 */
function apiAddAdmin(value) {

  assertAdmin_();
  throw appError_('إضافة الأدمنز بقت من «الصلاحيات».', 'افتح «الصلاحيات» في لوحة التحكم وضيفه من هناك مع صلاحياته.');

}

function apiRemoveAdmin(value) {

  assertAdmin_();
  throw appError_('شيل الأدمنز بقى من «الصلاحيات».', 'افتح «الصلاحيات» في لوحة التحكم وشيله من هناك.');

}

/* what goes with an admin who is off the list (Grants.gs mirror): their name, admin push devices, trusted devices */
function adminCleanup_(email) {

  try { forgetAdminName_(email); } catch (ignored) { console.warn('admins: name not removed'); }
  try { forgetAdminDevices_(email); } catch (ignored) { console.warn('admins: devices not removed'); }
  try { forgetTrustedDevices_(email); } catch (ignored) { console.warn('admins: trusted devices not removed'); }

}
