/**
 * AUTHORIZATION
 *
 * The admin web app is deployed as "Execute as: User accessing the web app"
 * and "Who has access: Anyone with a Google account". Google handles sign-in;
 * this file decides who is allowed in.
 *
 * - The allowlist is the ADMIN_EMAILS Script Property (comma separated).
 *   It is not in the code, so the public repo never contains it.
 * - Every server function the page can call checks it first (assertAdmin_).
 * - Fails closed: no property, no admins.
 *
 * Note for maintainers: Apps Script lets the browser call ANY top-level
 * function whose name does not end with "_" (google.script.run). Keep helpers
 * private with a trailing underscore, and start every public api* function
 * with assertAdmin_().
 */

function currentEmail_() {

  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();

}


function adminEmails_() {

  return String(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '')
    .split(',')
    .map(function (email) { return email.trim().toLowerCase(); })
    .filter(function (email) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email); });

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
