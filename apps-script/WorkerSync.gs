/* =========================================================
   APPS SCRIPT → CLOUDFLARE WORKER SYNC
   ---------------------------------------------------------
   The new backend (worker/, docs/BACKEND-MIGRATION.md) takes its admin
   allowlist from here: the Script Property ADMIN_EMAILS stays the one place
   admins are added or removed («صلاحيات لوحة التحكم»), and the Worker's
   `admins` table follows it.

   - Signed: HMAC-SHA256 with the Script Property WORKER_SYNC_SECRET over
     "<ts>.<body>" (the Worker holds the same value as SYNC_SECRET, checks
     ±5 min and refuses replays).
   - Sent from the background only: after an admin's heartbeat (doPost, Api.gs)
     at most every WORKER_SYNC_CHECK_S — at once after an allowlist change —
     and from the daily trigger. Only a changed list is sent, plus a refresh
     every WORKER_SYNC_REFRESH_S. Never on anyone's wait; never throws.
   - First deploy: a git-ignored WorkerSyncSeed.local.gs may define
     WORKER_SYNC_SEED_; it is copied into the Script Property once and the
     file is removed again (worker/README.md, "Admin allowlist").
========================================================= */

var WORKER_API_URL = 'https://athanasios-api.menazak-lab.workers.dev';
var WORKER_SYNC_SENT_KEY = 'worker:admins:sent';     // hash of the list the Worker last accepted
var WORKER_SYNC_CHECK_KEY = 'worker:admins:check';   // checked recently: skip
var WORKER_SYNC_CHECK_S = 600;
var WORKER_SYNC_REFRESH_S = 21600;

function workerSyncSecret_() {

  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('WORKER_SYNC_SECRET') || '';

  if (!secret && typeof WORKER_SYNC_SEED_ === 'string' && WORKER_SYNC_SEED_.length >= 32) {
    props.setProperty('WORKER_SYNC_SECRET', WORKER_SYNC_SEED_);
    secret = WORKER_SYNC_SEED_;
  }

  return secret;

}

/* { admins: [{ email, name, primary }] } — the same list isAdmin_ uses */
function workerAdminsPayload_() {

  var primary = primaryAdmin_();
  var names = adminDirectory_();

  return {
    admins: adminEmails_().map(function (email) {
      return { email: email, name: names[email] || '', primary: email === primary };
    })
  };

}

/* Sends the allowlist when it changed (or `force`). True when the Worker took it. */
function workerSyncAdmins_(force) {

  try {

    var cache = CacheService.getScriptCache();

    if (!force && cache.get(WORKER_SYNC_CHECK_KEY)) return false;
    cache.put(WORKER_SYNC_CHECK_KEY, '1', WORKER_SYNC_CHECK_S);

    var secret = workerSyncSecret_();
    if (!secret) return false;

    var payload = workerAdminsPayload_();
    if (!payload.admins.length) return false;

    var body = JSON.stringify(payload);
    var hash = sha256Hex_(body);

    if (!force && cache.get(WORKER_SYNC_SENT_KEY) === hash) return false;

    var ts = String(Date.now());
    var response = UrlFetchApp.fetch(WORKER_API_URL + '/v1/sync/admins', {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      payload: Utilities.newBlob(body).getBytes(),   // UTF-8 bytes: exactly what was signed
      headers: { 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + hmacHex_(secret, ts + '.' + body) },
      muteHttpExceptions: true,
      followRedirects: false
    });

    if (response.getResponseCode() === 200) {
      cache.put(WORKER_SYNC_SENT_KEY, hash, WORKER_SYNC_REFRESH_S);
      return true;
    }

    console.warn('worker sync: HTTP ' + response.getResponseCode());

  }
  catch (error) {
    console.warn('worker sync: not sent');
  }

  return false;

}

/* the allowlist just changed: the next heartbeat sends it */
function workerSyncSoon_() {

  try {
    CacheService.getScriptCache().remove(WORKER_SYNC_CHECK_KEY);
  }
  catch (ignored) {
    // the 10-minute check sends it anyway
  }

}
