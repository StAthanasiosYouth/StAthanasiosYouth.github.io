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


/* =========================================================
   THE PANEL'S SESSION FOR THE WORKER (worker/src/lib/auth.js verifyWorkerToken)
   ---------------------------------------------------------
   A signed-in panel (Google, or the installed app's trusted device) asks for
   a short-lived token the Worker checks by itself, so «الحجوزات» and the
   other Worker sections use the SAME admin session — no second Google
   sign-in. HMAC with WORKER_SYNC_SECRET over "wk1." + payload (the sync's
   messages are "<ts>.<body>": never the same shape). It carries only the
   email, how the panel signed in, and the times; the Worker still checks the
   allowlist on every call. Requires the panel's live session (doPost).
========================================================= */

var WORKER_TOKEN_SECONDS = 15 * 60;

function apiWorkerSession() {

  var email = assertAdmin_();
  var secret = workerSyncSecret_();

  if (!secret) throw appError_('الحجوزات مش متاحة دلوقتي.', 'WORKER_SYNC_SECRET ناقص في Script Properties.');

  var now = Math.floor(Date.now() / 1000);
  var exp = now + WORKER_TOKEN_SECONDS;
  var via = API_REQUEST_ && API_REQUEST_.via === 'device' ? 'device' : 'google';
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ e: email, x: exp, v: via, i: now }), Utilities.Charset.UTF_8).replace(/=+$/, '');

  return { token: 'wk1.' + payload + '.' + hmacHex_(secret, 'wk1.' + payload), exp: exp };

}


/* =========================================================
   ACTIVITY → D1 (Phase 1.5 step 4, BOOKING-PHASE1-COMPLETION-PLAN §4.4)
   ---------------------------------------------------------
   The Activity tab's rows go to the Worker (POST /v1/sync/activity, signed
   like the allowlist), where «سجل النشاط» reads them together with the
   Worker's own rows (bookings, money, accounts). D1 upserts by the row's id:
   a resend or a merged row (ACTIVITY_MERGE_MS) updates it, never a copy.

   - What D1 has: the Script Property ACTIVITY_FWD { at, sent: { id: at } }.
     A tick sends the rows newer than `at` minus a 2-minute overlap whose
     (id, at) D1 doesn't have yet — a row written by a parallel execution a
     moment "in the past" is still caught. Oldest first, 200 per call.
   - History: until the whole tab was sent once (`done`), a tick reads the
     whole tab; after that only its last ACTIVITY_CHUNK rows.
   - When: critical rows right after the reply (doPost) or at once (triggers);
     the rest at most once a minute after any panel call, and from the
     5-minute booking trigger. Never on anyone's wait; never throws.
   - Not sent: «booking.new» (BookNotify.gs): D1 has those bookings itself.
========================================================= */

var ACTIVITY_FWD_KEY = 'ACTIVITY_FWD';
var ACTIVITY_FWD_CHECK = 'worker:act:check';
var ACTIVITY_FWD_EVERY_S = 60;
var ACTIVITY_FWD_BATCH = 200;
var ACTIVITY_FWD_OVERLAP_MS = 2 * 60000;
var ACTIVITY_FWD_SKIP = ['booking.new'];

/* critical | important | routine (the notification levels, §4.4) */
function activitySeverity_(row) {

  var action = row.action;

  if (action === 'pay.approve' || action === 'code.export' || action === 'migrate' || action === 'admin.add' || action === 'admin.remove') return 'critical';
  if (action === 'publish' || action === 'push' || action === 'import' || action === 'finalize' || action === 'points.adjust' ||
    action === 'redemption.status' || action === 'session.takeover') return 'important';
  if ((action === 'create' || action === 'delete') && ACTIVITY_CONTENT.indexOf(row.type) !== -1) return 'important';
  return 'routine';

}

function activityForwardMark_() {

  try {
    var mark = JSON.parse(PropertiesService.getScriptProperties().getProperty(ACTIVITY_FWD_KEY) || 'null');
    if (mark && typeof mark.at === 'number' && mark.sent && typeof mark.sent === 'object') return mark;
  }
  catch (ignored) {
    // a broken mark: send again from the start (D1 upserts, nothing doubles)
  }
  return { at: 0, sent: {}, done: false };

}

/* rows D1 doesn't have yet, oldest first */
function activityForwardDue_(mark) {

  var sheet = spreadsheet_().getSheetByName(ACTIVITY_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var last = sheet.getLastRow();
  var first = mark.done ? Math.max(2, last - ACTIVITY_CHUNK + 1) : 2;
  var cutoff = mark.at - ACTIVITY_FWD_OVERLAP_MS;

  return sheet.getRange(first, 1, last - first + 1, ACTIVITY_COLUMNS.length).getValues()
    .map(activityRecord_)
    .filter(function (row) {
      return /^act-[0-9a-f]{12}$/.test(row.id) && row.at > cutoff && mark.sent[row.id] !== row.at && ACTIVITY_FWD_SKIP.indexOf(row.action) === -1;
    })
    .sort(function (a, b) { return a.at - b.at; });

}

/* Sends what D1 is missing (`force`: now, else at most once a minute). The number of rows D1 took. */
function activityForward_(force) {

  try {

    var cache = CacheService.getScriptCache();
    if (!force && cache.get(ACTIVITY_FWD_CHECK)) return 0;
    cache.put(ACTIVITY_FWD_CHECK, '1', ACTIVITY_FWD_EVERY_S);

    var secret = workerSyncSecret_();
    if (!secret) return 0;

    var mark = activityForwardMark_();
    var due = activityForwardDue_(mark);
    var batch = due.slice(0, ACTIVITY_FWD_BATCH);
    var props = PropertiesService.getScriptProperties();

    if (!batch.length) {
      if (!mark.done) {
        mark.done = true;
        props.setProperty(ACTIVITY_FWD_KEY, JSON.stringify(mark));
      }
      return 0;
    }

    var body = JSON.stringify({ rows: batch.map(function (row) {
      return {
        id: row.id, at: row.at, cairo: row.cairo, actor: row.actor, actorName: row.actorName, action: row.action, type: row.type,
        entityId: row.entityId, title: row.title, summary: row.summary, changes: row.changes || null, ref: row.ref,
        count: row.count, device: row.device, severity: activitySeverity_(row)
      };
    }) });
    var ts = String(Date.now());
    var response = UrlFetchApp.fetch(WORKER_API_URL + '/v1/sync/activity', {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      payload: Utilities.newBlob(body).getBytes(),
      headers: { 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + hmacHex_(secret, ts + '.' + body) },
      muteHttpExceptions: true,
      followRedirects: false
    });

    if (response.getResponseCode() !== 200) {
      console.warn('activity forward: HTTP ' + response.getResponseCode());
      cache.remove(ACTIVITY_FWD_CHECK);
      return 0;
    }

    batch.forEach(function (row) {
      mark.sent[row.id] = row.at;
      if (row.at > mark.at) mark.at = row.at;
    });
    // only the overlap window is remembered (older rows are below the cutoff anyway)
    Object.keys(mark.sent).forEach(function (id) {
      if (mark.sent[id] <= mark.at - ACTIVITY_FWD_OVERLAP_MS) delete mark.sent[id];
    });
    if (due.length <= ACTIVITY_FWD_BATCH) mark.done = true;
    props.setProperty(ACTIVITY_FWD_KEY, JSON.stringify(mark));
    return batch.length;

  }
  catch (error) {
    console.warn('activity forward: not sent');
    return 0;
  }

}


/* =========================================================
   PUBLISH → WORKER (Phase 2, docs/PUBLISH-SEPARATION-PLAN.md)
   ---------------------------------------------------------
   PUBLISH_MODE (Script Property):
   - 'github' (default): one GitHub commit, as always; nothing to the Worker.
   - 'shadow' (P2-2): the commit as always, then the same files to the Worker
     (POST /v1/sync/publish). Visitors read GitHub Pages; the Worker compares
     the two every 15 minutes. A failed post never fails the publish (kept in
     PUBLISH_SHADOW_LAST; the comparison shows it as lag/missing).
   - 'worker' (P2-4): new pictures are committed first, then the files go to
     the Worker and are live there at once; GitHub follows in the background
     (the Worker's mirror). If the Worker does not take them, the publish
     fails with a clear message — never a GitHub commit instead (that would
     be a second writer). Rollback: 'shadow' (D1 follows every publish, so
     nothing the mirror still holds can come back), then 'github'.
   Any other value means 'github'.
========================================================= */

var PUBLISH_SHADOW_LAST = 'PUBLISH_SHADOW_LAST';
var PUBLISH_MODES = ['github', 'shadow', 'worker'];

function publishMode_() {

  var mode = PropertiesService.getScriptProperties().getProperty('PUBLISH_MODE') || 'github';
  return PUBLISH_MODES.indexOf(mode) === -1 ? 'github' : mode;

}

/* the signed post, one retry on 5xx / 429 / network → { outcome: 'ok' | 'no secret' | 'HTTP n' | 'network', reply } */
function publishPost_(mode, files, revision, at, email) {

  var secret = workerSyncSecret_();
  if (!secret) return { outcome: 'no secret', reply: null };

  // one id per publish; the retry reuses it, so the Worker stores it once
  var body = JSON.stringify({ id: 'pub-' + revision + '-' + at, mode: mode, by: email || '', at: at, files: files });
  var outcome = 'network';
  var reply = null;

  for (var attempt = 0; attempt < 2; attempt++) {

    if (attempt) Utilities.sleep(800);

    try {
      var ts = String(Date.now());
      var response = UrlFetchApp.fetch(WORKER_API_URL + '/v1/sync/publish', {
        method: 'post',
        contentType: 'application/json; charset=utf-8',
        payload: Utilities.newBlob(body).getBytes(),   // UTF-8 bytes: exactly what was signed
        headers: { 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + hmacHex_(secret, ts + '.' + body) },
        muteHttpExceptions: true,
        followRedirects: false
      });
      var code = response.getResponseCode();
      if (code === 200) {
        try { reply = JSON.parse(response.getContentText()); } catch (ignored) { reply = null; }
        return { outcome: 'ok', reply: reply };
      }
      outcome = 'HTTP ' + code;
      if (code < 500 && code !== 429) break;     // refused: a retry would be refused too
    }
    catch (error) {
      outcome = 'network';
    }

  }

  return { outcome: outcome, reply: reply };

}

/* 'shadow': files of the commit that just landed; true when the Worker stored them (never throws) */
function publishShadow_(files, revision, at, email) {

  if (publishMode_() !== 'shadow') return false;

  var outcome = 'not sent';

  try {
    outcome = publishPost_('shadow', files, revision, at, email).outcome;
  }
  catch (error) {
    outcome = 'network';
  }

  if (outcome !== 'ok') console.warn('publish shadow: ' + outcome);

  try {
    PropertiesService.getScriptProperties().setProperty(PUBLISH_SHADOW_LAST, JSON.stringify({ at: at, revision: revision, outcome: outcome }));
  }
  catch (ignored) {
    // only a note for the diagnostics
  }

  return outcome === 'ok';

}

/* 'worker': the publish itself. → the Worker's reply; throws (Arabic, for the panel) when it was not taken */
function publishToWorker_(files, revision, at, email) {

  var sent = publishPost_('worker', files, revision, at, email);

  if (sent.outcome === 'ok') return sent.reply || {};

  console.warn('publish worker: ' + sent.outcome);
  throw appError_(
    'النشر ما اتمش: السيرفر الجديد مردش (' + sent.outcome + ').',
    'مفيش حاجة اتغيرت في الموقع. جرّب تاني بعد دقيقة، ولو فضلت المشكلة قول للأدمن الأساسي.'
  );

}
