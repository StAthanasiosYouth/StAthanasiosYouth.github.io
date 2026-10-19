/* =========================================================
   NEW BOOKINGS → ADMIN PUSH (docs/EVENTS.md §7.3)
   ---------------------------------------------------------
   Visitor bookings land on the Worker (worker/BOOKING-API.md), which only
   COUNTS them per event (book_news). The admins' devices and who has the
   panel open live here, so this side announces them:

   - every BOOK_NEWS_EVERY_MIN minutes (a time trigger, installed once by
     the owner: enableBookingAlerts) and only while BOOKING_ONLINE = '1'
     (Pages.gs bookOnline_), bookNewsTick asks the Worker
     POST /v1/sync/book-news — signed like the admin allowlist
     (WorkerSync.gs: WORKER_SYNC_SECRET, HMAC over "<ts>.<body>");
   - the Worker hands out each event's new bookings at most once per 10
     minutes, grouped: [{ eventId, slug, title, count, pending }];
   - each group → ONE Activity row (system actor «visitor»: «زوار بعتوا
     ٣ طلبات حجز في «رحلة الإسكندرية»») — admins with the panel open see
     it as a toast on their next heartbeat (activitySince_) — and ONE push
     to every other admin's devices (adminPushNotify_ skips the present):
     «٣ حجوزات جديدة – رحلة الإسكندرية», opening /admin/#open/bookings/<eventId>.

   Nothing personal crosses: no names, phones or refs (the Worker never
   sends them here). Never throws; a failed run is retried by the next tick
   (the Worker only hands out what it hands out: at most once).
========================================================= */

var BOOK_NEWS_HANDLER = 'bookNewsTick';
var BOOK_NEWS_EVERY_MIN = 5;
var BOOK_NEWS_ACTOR = 'visitor';
var BOOK_NEWS_MAX = 20;

/*
 * The time trigger's handler (a public name: triggers can't call name_
 * functions). Public names are also reachable from google.script.run, so it
 * runs only for ITS trigger (the uid saved by enableBookingAlerts), like
 * pushScheduleTick (CompSchedule.gs).
 */
function bookNewsTick(e) {

  var uid = e && e.triggerUid ? String(e.triggerUid) : '';
  if (!uid || uid !== PropertiesService.getScriptProperties().getProperty('BOOK_NEWS_TRIGGER_ID')) return -2;

  // admin pushes still waiting for a panel's heartbeat go out now (Activity.gs, deferred push)
  try {
    activityPending_('trigger');
  }
  catch (error) {
    console.warn('activity: pending pushes not sent from the trigger');
  }

  return bookNewsRun_();

}

/* → how many groups were announced (−1: off, nothing asked) */
function bookNewsRun_(fetchGroups) {

  try {

    if (!bookOnline_()) return -1;

    // an approved InstaPay / wallet set that didn't reach the Worker earlier goes again (PayDest.gs)
    if (!fetchGroups) payDestRetry_();

    var groups = (fetchGroups || bookNewsFetch_)();
    if (!groups || !groups.length) return 0;

    var n = 0;
    var acks = [];
    groups.slice(0, BOOK_NEWS_MAX).forEach(function (group) {
      var clean = bookNewsGroup_(group);
      if (!clean) return;
      // v2 (at least once): a claim handed out again after a lost ack is acked, never pushed twice
      if (clean.claimId && bookNewsAnnounced_(clean.claimId)) {
        acks.push(clean.claimId);
        return;
      }
      bookNewsAnnounce_(clean);
      if (clean.claimId) {
        bookNewsRemember_(clean.claimId);
        acks.push(clean.claimId);
      }
      n++;
    });
    if (acks.length) (fetchGroups && fetchGroups.ack ? fetchGroups.ack : bookNewsAck_)(acks);
    return n;

  }
  catch (error) {
    console.warn('book news: ' + ((error && error.message) || error));
    return 0;
  }

}

/* POST /v1/sync/book-news, signed → the reply (or null on any doubt) */
function bookNewsPost_(payload) {

  var secret = workerSyncSecret_();
  if (!secret) {
    console.warn('book news: WORKER_SYNC_SECRET missing');
    return null;
  }

  var body = JSON.stringify(payload);
  var ts = String(Date.now());
  var response = UrlFetchApp.fetch(WORKER_API_URL + '/v1/sync/book-news', {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: Utilities.newBlob(body).getBytes(),
    headers: { 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + hmacHex_(secret, ts + '.' + body) },
    muteHttpExceptions: true,
    followRedirects: false
  });

  if (response.getResponseCode() !== 200) {
    console.warn('book news: HTTP ' + response.getResponseCode());
    return null;
  }

  var reply = JSON.parse(response.getContentText());
  return reply && reply.ok === true ? reply : null;

}

/* v2: the groups, each with its claimId (acked after the announce) */
function bookNewsFetch_() {

  var reply = bookNewsPost_({ v: 2 });
  return reply && Array.isArray(reply.groups) ? reply.groups : [];

}

/* v2: these claims were announced (a lost ack: the Worker hands them out again, bookNewsAnnounced_ skips the push) */
function bookNewsAck_(ids) {

  try {
    // the sync stamp must move forward: never the same millisecond as the claim
    Utilities.sleep(5);
    bookNewsPost_({ v: 2, ack: ids });
  }
  catch (error) {
    console.warn('book news: ack failed: ' + ((error && error.message) || error));
  }

}

/* the claims this project announced lately (6 h: well past the Worker's re-hand time) */
var BOOK_NEWS_SEEN_SECONDS = 6 * 3600;

function bookNewsAnnounced_(claimId) {

  try {
    return CacheService.getScriptCache().get('booknews:' + claimId) === '1';
  }
  catch (ignored) {
    return false;
  }

}

function bookNewsRemember_(claimId) {

  try {
    CacheService.getScriptCache().put('booknews:' + claimId, '1', BOOK_NEWS_SEEN_SECONDS);
  }
  catch (ignored) {
    // at worst one push twice after a lost ack
  }

}

/* only the shapes we expect (the Worker is trusted, the text still is text) */
function bookNewsGroup_(group) {

  if (!group || typeof group !== 'object') return null;
  var eventId = String(group.eventId || '');
  var count = Math.floor(Number(group.count));
  if (!/^evt-[a-z0-9-]{2,60}$/.test(eventId) || !(count >= 1 && count <= 100000)) return null;
  var pending = Math.floor(Number(group.pending));
  var claimId = /^nc-[0-9a-f]{16}$/.test(String(group.claimId || '')) ? String(group.claimId) : '';

  return {
    claimId: claimId,
    eventId: eventId,
    title: activityText_(group.title, ACTIVITY_TITLE_MAX) || 'فعالية',
    count: count,
    pending: pending >= 0 ? pending : null
  };

}

/* «طلب حجز» / «طلبين حجز» / «٣ طلبات حجز» / «١١ طلب حجز» */
function bookNewsCount_(n) {

  if (n === 1) return 'طلب حجز';
  if (n === 2) return 'طلبين حجز';
  return activityDigits_(n) + (n <= 10 ? ' طلبات حجز' : ' طلب حجز');

}

/* the push's title: «حجز جديد – …» / «٣ حجوزات جديدة – …» */
function bookNewsTitle_(group) {

  var what = group.count === 1 ? 'حجز جديد' : group.count === 2 ? 'حجزين جداد' : activityDigits_(group.count) + (group.count <= 10 ? ' حجوزات جديدة' : ' حجز جديد');
  return activityText_(what + ' – ' + group.title, ADMIN_PUSH_TITLE_MAX);

}

/* one group → one Activity row (+ the toast for present admins) + one push for the others */
function bookNewsAnnounce_(group) {

  var now = Date.now();
  var many = group.count > 1;
  var row = {
    id: 'act-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12),
    at: now,
    cairo: activityCairo_(now),
    actor: BOOK_NEWS_ACTOR,
    actorName: many ? 'زوار' : 'زائر',
    action: 'booking.new',
    type: 'bookings',
    entityId: group.eventId,
    title: group.title,
    summary: (many ? 'بعتوا ' : 'بعت ') + bookNewsCount_(group.count) + ' في «' + group.title + '»',
    changes: { count: group.count, pending: group.pending },
    ref: '',
    count: 1,
    notified: '',
    device: ''
  };

  var outcome = { sent: 0, reason: 'none' };
  try {
    outcome = adminPushNotify_(row, '');
  }
  catch (error) {
    outcome = { sent: 0, reason: 'error' };
  }
  row.notified = outcome.sent ? 'sent:' + outcome.sent : outcome.reason || '';

  try {
    var sheet = activitySheet_();
    sheet.appendRow([row.id, row.at, row.cairo, row.actor, plainCell_(row.actorName), row.action, row.type, plainCell_(row.entityId),
      plainCell_(row.title), plainCell_(row.summary), activityChanges_(row.changes), '', 1, plainCell_(row.notified), '']);
    activityTrim_(sheet, now);
  }
  catch (error) {
    console.warn('book news: activity row not written');
  }
  rememberActivity_(row);

  return row;

}

/**
 * Run ONCE by the owner from the Apps Script editor at go-live
 * (Run ▸ enableBookingAlerts): installs the every-5-minutes check. It does
 * nothing until BOOKING_ONLINE = '1'.
 */
function enableBookingAlerts() {

  assertAdmin_();

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === BOOK_NEWS_HANDLER) ScriptApp.deleteTrigger(trigger);
  });
  var trigger = ScriptApp.newTrigger(BOOK_NEWS_HANDLER).timeBased().everyMinutes(BOOK_NEWS_EVERY_MIN).create();
  PropertiesService.getScriptProperties().setProperty('BOOK_NEWS_TRIGGER_ID', trigger.getUniqueId());

  return 'تنبيهات الحجوزات الجديدة اتفعّلت ✓ (كل ' + activityDigits_(BOOK_NEWS_EVERY_MIN) + ' دقايق، لما الحجز أونلاين يشتغل)';

}

/**
 * The go-live switch BOOKING_ONLINE, run by the owner from the Apps Script
 * editor (Run ▸ bookingOnlineOn / bookingOnlineOff). Project Settings can't
 * add it while other properties hold an empty value (SHOP_* do on purpose:
 * the editor refuses to save). Takes effect at the next publish.
 */
function bookingOnlineOn() {

  assertAdmin_();
  PropertiesService.getScriptProperties().setProperty('BOOKING_ONLINE', '1');
  return 'BOOKING_ONLINE = 1 ✓ (انشر علشان الفعاليات تاخد الحجز أونلاين)';

}

function bookingOnlineOff() {

  assertAdmin_();
  PropertiesService.getScriptProperties().deleteProperty('BOOKING_ONLINE');
  return 'BOOKING_ONLINE اتشال ✓ (انشر علشان الفعاليات ترجع للحجز مع الخدام)';

}
