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
 * token is verified, '' before that. null outside the API (HtmlService and
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

  var seen = Object.create(null);

  return String(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '')
    .split(',')
    .map(function (email) { return email.trim().toLowerCase(); })
    .filter(function (email) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || seen[email]) return false;
      seen[email] = true;
      return true;
    });

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

  return email;

}


/* =========================================================
   «صلاحيات لوحة التحكم»: the allowlist, from the panel
========================================================= */

function adminList_(me) {

  var primary = primaryAdmin_();

  return {
    emails: adminEmails_(),
    primary: primary,
    me: me,
    max: MAX_ADMINS
  };

}


/** The allowed Google emails (admins only). */
function apiAdmins() {

  return adminList_(assertAdmin_());

}


/** Allows one more Google email. */
function apiAddAdmin(value) {

  var me = assertAdmin_();
  var email = normalizeEmail_(value);

  if (!email) {
    throw appError_('الإيميل ده مش مكتوب صح.', 'اكتب إيميل جوجل كامل، مثلاً name@gmail.com', '', 'الإيميل');
  }

  var lock = LockService.getScriptLock();

  lock.waitLock(20000);

  try {

    var emails = adminEmails_();

    if (emails.indexOf(email) !== -1) {
      throw appError_('الإيميل ده مسموح له قبل كده.', '');
    }

    if (emails.length >= MAX_ADMINS) {
      throw appError_('وصلت لأقصى عدد (' + MAX_ADMINS + ').', 'شيل إيميل مش محتاجه الأول.');
    }

    emails.push(email);
    PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', emails.join(', '));
    log_(me, 'admins.add', email);

  }
  finally {
    lock.releaseLock();
  }

  return adminList_(me);

}


/** Takes a Google email off the list (never the primary, never the last one, never yourself). */
function apiRemoveAdmin(value) {

  var me = assertAdmin_();
  var email = normalizeEmail_(value);

  if (!email) {
    throw appError_('الإيميل ده مش مكتوب صح.', '');
  }

  if (email === primaryAdmin_()) {
    throw appError_('ده الحساب الأساسي ومينفعش يتشال.', 'الحساب الأساسي بيفضل مسموح له دايمًا.');
  }

  if (email === me) {
    throw appError_('مينفعش تشيل نفسك.', 'لو لازم، أدمن تاني يشيلك.');
  }

  var lock = LockService.getScriptLock();

  lock.waitLock(20000);

  try {

    var emails = adminEmails_();
    var index = emails.indexOf(email);

    if (index === -1) {
      throw appError_('الإيميل ده مش في القايمة.', 'اعمل Refresh للصفحة.');
    }

    emails.splice(index, 1);

    if (!emails.length) {
      throw appError_('القايمة مينفعش تفضل فاضية.', '');
    }

    PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', emails.join(', '));
    log_(me, 'admins.remove', email);

  }
  finally {
    lock.releaseLock();
  }

  return adminList_(me);

}
