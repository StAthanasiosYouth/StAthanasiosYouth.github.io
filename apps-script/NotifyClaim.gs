/* =========================================================
   THE WORKER'S NOTIFICATION ROUTER → ADMIN PUSH (Phase 1.5 step 5)
   docs/BOOKING-PHASE1-COMPLETION-PLAN.md §4.4
   ---------------------------------------------------------
   The Worker decides who gets what (worker/src/notify/router.js: the
   catalog, the grants, «إعدادات الإشعارات», each admin's «تنبيهاتي»).
   This file only delivers its push rows: it claims them (POST
   /v1/sync/notify-claim, signed like the allowlist), sends each to the
   NAMED admin's devices (AdminPushSubs, the same sender as before) and
   answers with the result in the next call — at least once:

   - a claim id already sent is never sent twice (remembered 6 h): a lost
     answer only means the Worker hands it out again and we just confirm it;
   - no devices / push off → done (with the reason); an FCM error → the
     Worker retries with backoff, and gives up after 5 tries;
   - the device whose panel is in sight is spared (B8), except for a
     critical one.

   While the router is ON (the claim's reply says so; remembered 10 min),
   this script's own admin pushes stop — Activity.gs and the book-news feed
   (BookNotify.gs) — so nothing arrives twice. OFF: everything as before.
   When: at most once a minute after any panel call, and from the
   5-minute booking trigger. Never on anyone's wait; never throws.
========================================================= */

var NOTIFY_CLAIM_CHECK = 'worker:ntf:check';
var NOTIFY_CLAIM_EVERY_S = 60;
var NOTIFY_ROUTER_KEY = 'NOTIFY_ROUTER_ON';      // Script Property '1' | '0': the last answer
var NOTIFY_ROUTER_CACHE = 'worker:ntf:router';
var NOTIFY_ACKS_KEY = 'NOTIFY_ACKS';             // answers not delivered yet
var NOTIFY_SENT_PREFIX = 'ntf:sent:';
var NOTIFY_SENT_SECONDS = 6 * 3600;
var NOTIFY_ROUNDS = 3;

/* is the Worker's router on (the last claim said so)? */
function notifyRouterOn_() {

  try {
    var cached = CacheService.getScriptCache().get(NOTIFY_ROUTER_CACHE);
    if (cached) return cached === '1';
    return PropertiesService.getScriptProperties().getProperty(NOTIFY_ROUTER_KEY) === '1';
  }
  catch (ignored) {
    return false;
  }

}

function notifyRouterRemember_(on) {

  try {
    CacheService.getScriptCache().put(NOTIFY_ROUTER_CACHE, on ? '1' : '0', 600);
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(NOTIFY_ROUTER_KEY) !== (on ? '1' : '0')) props.setProperty(NOTIFY_ROUTER_KEY, on ? '1' : '0');
  }
  catch (ignored) {
    // next claim tells again
  }

}

/* POST /v1/sync/notify-claim → the reply, or null on any doubt */
function notifyClaimPost_(acks) {

  var secret = workerSyncSecret_();
  if (!secret) return null;

  var body = JSON.stringify({ v: 1, ack: acks });
  var ts = String(Date.now());
  var response = UrlFetchApp.fetch(WORKER_API_URL + '/v1/sync/notify-claim', {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: Utilities.newBlob(body).getBytes(),
    headers: { 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + hmacHex_(secret, ts + '.' + body) },
    muteHttpExceptions: true,
    followRedirects: false
  });

  if (response.getResponseCode() !== 200) {
    console.warn('notify claim: HTTP ' + response.getResponseCode());
    return null;
  }

  var reply = JSON.parse(response.getContentText());
  return reply && reply.ok === true ? reply : null;

}

/* one named admin's devices (AdminNotify.gs rules) → { sent, reason } */
function adminPushTo_(email, message, level) {

  var account = null;
  try { account = pushServiceAccount_(); } catch (ignored) { account = null; }
  if (!account) return { sent: 0, reason: 'off' };

  forgetAdminEmails_();
  if (adminEmails_().indexOf(email) === -1) return { sent: 0, reason: 'not admin' };

  var sheet = spreadsheet_().getSheetByName(ADMIN_PUSH_SHEET);
  if (!sheet) return { sent: 0, reason: 'none' };

  var looking = level === 'critical' ? null : adminPresentDevice_(email, Date.now());
  var spared = 0;
  var rows = pushRows_(sheet, ADMIN_PUSH_COLUMNS).filter(function (sub) {
    if (String(sub.email).toLowerCase() !== email) return false;
    var device = String(cleanLabel_(sub.device, 40) || '').toLowerCase();
    if (device === 'جهاز') device = '';
    if (looking !== null && (!device || !looking || looking === 'جهاز' || device === looking)) {
      spared++;
      return false;
    }
    return true;
  });

  if (!rows.length) return { sent: 0, reason: spared ? 'present' : 'none' };

  var outcome;
  try {
    outcome = pushFanout_(account, rows, message, ADMIN_PUSH_TTL);
  }
  catch (error) {
    console.warn('notify push: send failed: ' + pushErrorText_(error));
    return { sent: 0, reason: 'error' };
  }

  adminPushCleanup_(outcome);
  return { sent: outcome.delivered.length, reason: outcome.delivered.length ? '' : 'error' };

}

/* one claimed item → its answer { id, claim, ok, reason } */
function notifyDeliver_(item) {

  var cache = CacheService.getScriptCache();
  var seen = NOTIFY_SENT_PREFIX + item.id;

  if (cache.get(seen)) return { id: item.id, claim: item.claim, ok: true, reason: 'sent before' };

  var result = adminPushTo_(String(item.recipient || '').toLowerCase(), {
    kind: 'admin', id: item.id, title: item.title, body: item.body, url: item.url, tag: item.tag
  }, item.level);
  // nothing to send to (no device, push off, panel in sight, not an admin any more) is an answer too
  var done = result.sent > 0 || result.reason === 'none' || result.reason === 'present' || result.reason === 'off' || result.reason === 'not admin';

  if (result.sent > 0) cache.put(seen, '1', NOTIFY_SENT_SECONDS);
  return { id: item.id, claim: item.claim, ok: done, reason: result.reason || '' };

}

/* Claims and delivers the router's push rows (`force`: now). → how many were answered. Never throws. */
function notifyClaimRun_(force) {

  try {

    var cache = CacheService.getScriptCache();
    if (!force && cache.get(NOTIFY_CLAIM_CHECK)) return 0;
    cache.put(NOTIFY_CLAIM_CHECK, '1', NOTIFY_CLAIM_EVERY_S);

    var props = PropertiesService.getScriptProperties();
    var acks = [];
    try { acks = JSON.parse(props.getProperty(NOTIFY_ACKS_KEY) || '[]') || []; } catch (ignored) { acks = []; }
    var answered = 0;

    for (var round = 0; round < NOTIFY_ROUNDS; round++) {
      var reply = notifyClaimPost_(acks);
      if (!reply) break;
      // the Worker has these answers now
      acks = [];
      notifyRouterRemember_(reply.router === true);
      var items = Array.isArray(reply.items) ? reply.items : [];
      if (!items.length) break;
      acks = items.map(notifyDeliver_);
      answered += acks.length;
    }

    // answers not delivered yet go with the next call
    var text = JSON.stringify(acks.slice(0, 200));
    if (props.getProperty(NOTIFY_ACKS_KEY) !== text) props.setProperty(NOTIFY_ACKS_KEY, text);
    return answered;

  }
  catch (error) {
    console.warn('notify claim: not run');
    return 0;
  }

}
