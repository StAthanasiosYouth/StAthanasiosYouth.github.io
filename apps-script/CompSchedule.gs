/**
 * AUTOMATIC PUSH SCHEDULE (docs/COMPETITIONS.md §18.5)
 *
 * The admin picks moments («قبل الفتح بيوم», «قبل القفل بساعة», «قبل نهاية
 * الموسم بـ ٣ أيام»…). Each one is two things:
 *   - a normal bell item (Notifications row, target `points`, publishAt =
 *     the moment) — the site shows it on time once published;
 *   - a PushSchedule entry: at that moment the same item is sent as a push,
 *     through the one send path (Push.gs pushSendItem_: live check against
 *     the published site, PushLog once per item, cooldown, daily cap).
 *
 * Lowest overhead: ONE one-off time trigger (`pushScheduleTick`) set to the
 * earliest pending moment, re-set after every run and every schedule change,
 * removed when nothing waits; plus ONE daily safety trigger
 * (`pushScheduleDaily`) that re-arms a lost one and sends what is overdue by
 * less than 6 h. No trigger exists while nothing is scheduled.
 *
 * Triggers need the OAuth scope script.scriptapp, granted once by the owner
 * running enableAutoPush() from the Apps Script editor. Until then every
 * ScriptApp call is a guarded no-op: saves work, bell items appear on time,
 * entries wait as `pending`, and the admin shows «الإرسال التلقائي مش متفعل».
 *
 * Bell item ids carry the moment (notif-shop-open-1d-<yyyymmddhhmm>), so the
 * next opening of the store is a new item (PushLog sends each item once).
 */

var PUSH_SCHEDULE_OVERDUE_MS = 6 * 60 * 60 * 1000;
var PUSH_SCHEDULE_RETRY_MS = 2 * 60 * 1000;
var PUSH_TICK_HANDLER = 'pushScheduleTick';
var PUSH_DAILY_HANDLER = 'pushScheduleDaily';
var PUSH_SCHEDULE_KINDS = {
  'shop-open-1d': { notify: 'open1d', base: 'opensAt', minutes: -1440 },
  'shop-open-1h': { notify: 'open1h', base: 'opensAt', minutes: -60 },
  'shop-open': { notify: 'openAt', base: 'opensAt', minutes: 0 },
  'shop-close-24h': { notify: 'close24h', base: 'closesAt', minutes: -1440 },
  'shop-close-1h': { notify: 'close1h', base: 'closesAt', minutes: -60 }
};


/* =========================================================
   TIME
========================================================= */

/* 'YYYY-MM-DDTHH:MM' (Cairo) → epoch ms (one correction step: right across a DST change) */
function pushWallMs_(wall) {

  var target = wallToMinutes_(wall) * 60000;
  var guess = target - (wallToMinutes_(compNow_().wall) * 60000 - Math.floor(Date.now() / 60000) * 60000);
  var seen = wallToMinutes_(Utilities.formatDate(new Date(guess), CONTENT_TIMEZONE, "yyyy-MM-dd'T'HH:mm")) * 60000;

  return guess + (target - seen);

}

/* 'YYYY-MM-DDTHH:MM' → 'YYYY-MM-DD HH:MM' */
function pushStamp_(wall) {

  return String(wall || '').replace('T', ' ');

}

/* a short Egyptian date/time: «الخميس ٢٢ أكتوبر الساعة ٧ بالليل» */
function pushWhen_(wall) {

  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(wall || ''));

  if (!m) return '';

  var days = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
  var months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  // the wall date's own weekday (calendar arithmetic, no time zone involved)
  var day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  var hour = Number(m[4]);
  var h12 = hour % 12 || 12;
  var part = hour < 12 ? 'الصبح' : hour < 17 ? 'الضهر' : 'بالليل';

  return days[day] + ' ' + Number(m[3]) + ' ' + months[Number(m[2]) - 1] +
    ' الساعة ' + h12 + (m[5] !== '00' ? ':' + m[5] : '') + ' ' + part;

}


/* =========================================================
   WHAT SHOULD BE SCHEDULED
========================================================= */

/* [{ kind, refId, notifId, sendAt (T-form), title, message, expireAt (T-form) }] wanted now (future only) */
function pushScheduleWanted_() {

  var wanted = [];
  var nowWall = compNow_().wall;
  var modules = compModules_();

  if (modules.shop && typeof shopSettings_ === 'function') {

    var settings = shopSettings_();
    var opens = shopWall_(settings.opensAt);
    var closes = shopWall_(settings.closesAt);

    // only the automatic mode has moments; «مفتوح» / «مقفول» by hand has none
    if (settings.mode === 'auto') {
      Object.keys(PUSH_SCHEDULE_KINDS).forEach(function (kind) {
        var spec = PUSH_SCHEDULE_KINDS[kind];
        var base = spec.base === 'opensAt' ? opens : closes;
        if (!settings.notify[spec.notify] || !base) return;
        var sendAt = wallAdd_(base, spec.minutes);
        if (sendAt <= nowWall) return;
        wanted.push(pushShopEntry_(kind, sendAt, opens, closes));
      });
    }

  }

  // seasons (CompWallet.gs): «الموسم بيخلص بعد … يوم»
  if (modules.wallet && typeof walletSeasonNotices_ === 'function') {
    walletSeasonNotices_().forEach(function (notice) {
      if (notice.sendAt > nowWall) wanted.push(notice);
    });
  }

  return wanted;

}

function pushShopEntry_(kind, sendAt, opens, closes) {

  var id = 'notif-' + kind + '-' + sendAt.replace(/\D/g, '');
  var texts = {
    'shop-open-1d': ['🛍️ المتجر هيفتح بكره', 'المتجر بيفتح ' + (opens ? pushWhen_(opens) : '') + '. جهّز نقاطك واختار جايزتك.'],
    'shop-open-1h': ['⏰ المتجر هيفتح كمان ساعة', 'ادخل «نقاطي» وشوف الجوايز.'],
    'shop-open': ['🎁 المتجر فتح دلوقتي!', 'ادخل «نقاطي» واطلب جايزتك' + (closes ? ' قبل ' + pushWhen_(closes) : '') + '.'],
    'shop-close-24h': ['⌛ المتجر هيقفل بكره', 'آخر فرصة تطلب جايزتك قبل ' + (closes ? pushWhen_(closes) : '') + '.'],
    'shop-close-1h': ['⌛ فاضل ساعة ويقفل المتجر', 'لو لسه ما طلبتش جايزتك، دي آخر فرصة.']
  }[kind];
  var opening = kind.indexOf('shop-open') === 0;
  var until = opening ? (kind === 'shop-open' ? (closes || wallAdd_(sendAt, 3 * 1440)) : opens) : closes;

  return { kind: kind, refId: '', notifId: id, sendAt: sendAt, title: texts[0], message: texts[1], expireAt: until || wallAdd_(sendAt, 1440) };

}


/* =========================================================
   SYNC (bell items + entries), then arm the trigger
========================================================= */

function pushScheduleRows_() {

  return compRows_(compSheet_('PushSchedule'));

}

/*
 * Makes the bell items and the entries match what is wanted now. Called after a
 * store schedule or a season changes. Entries already sent or skipped stay as
 * history; pending ones no longer wanted are cancelled and their bell item removed.
 */
function pushScheduleSync_(scope) {

  var wanted = pushScheduleWanted_().filter(function (w) { return !scope || w.kind.indexOf(scope) === 0; });
  var byNotif = {};

  wanted.forEach(function (w) { byNotif[w.notifId] = w; });

  var lock = LockService.getScriptLock();

  lock.waitLock(20000);

  try {

    var t = compSheet_('PushSchedule');
    var rows = compRows_(t);
    var stamp = compNow_().stamp;
    var have = {};

    rows.forEach(function (row) {
      if (scope && String(row.kind).indexOf(scope) !== 0) return;
      have[row.notifId] = row;
      if (row.status === 'pending' && !byNotif[row.notifId]) {
        compUpdate_(t, row.__row, { status: 'cancelled', result: 'اتلغى (الميعاد اتغير أو اتشال)', updatedAt: stamp }, row);
        deleteRow_('Notifications', 'id', row.notifId);
      }
    });

    var fresh = [];

    wanted.forEach(function (w) {
      upsertRow_('Notifications', 'id', {
        id: w.notifId, enabled: true, type: 'general', title: w.title, message: w.message, target: 'points',
        image: '', publishAt: pushStamp_(w.sendAt), expireAt: pushStamp_(w.expireAt), updatedAt: stamp
      });
      if (!have[w.notifId]) {
        fresh.push({ id: 'psh-' + compRandomHex_(5), notifId: w.notifId, kind: w.kind, refId: w.refId || '', sendAt: pushStamp_(w.sendAt),
          status: 'pending', result: '', sendKey: 'auto-' + compRandomHex_(8), updatedAt: stamp });
      }
    });

    if (fresh.length) compAppend_(t, fresh);

  }
  finally {
    lock.releaseLock();
  }

  pushScheduleArm_();

}

function pushScheduleSyncShop_() {

  pushScheduleSync_('shop-');

}

function pushScheduleSyncSeasons_() {

  pushScheduleSync_('season-');

}


/* =========================================================
   TRIGGERS (guarded: no scope = a no-op)
========================================================= */

function pushTriggers_() {

  try {
    return ScriptApp.getProjectTriggers();
  }
  catch (ignored) {
    return null;
  }

}

/* has the owner run enableAutoPush() (and can this deployment use ScriptApp)? */
function pushAutoAuthorized_() {

  return PropertiesService.getScriptProperties().getProperty('PUSH_AUTO') === '1' && pushTriggers_() !== null;

}

/* the earliest pending moment (T-form), or '' */
function pushScheduleNext_() {

  var next = '';

  if (!compSpreadsheetIdOrEmpty_()) return '';

  pushScheduleRows_().forEach(function (row) {
    if (row.status === 'pending' && row.sendAt && (!next || row.sendAt < next)) next = row.sendAt;
  });

  return next ? next.replace(' ', 'T') : '';

}

function compSpreadsheetIdOrEmpty_() {

  return String(PropertiesService.getScriptProperties().getProperty('COMP_SHEET_ID') || '').trim();

}

/* one one-off trigger at the earliest pending moment; none when nothing waits */
function pushScheduleArm_() {

  if (!pushAutoAuthorized_()) return;

  try {

    pushTriggers_().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === PUSH_TICK_HANDLER) ScriptApp.deleteTrigger(trigger);
    });

    var next = pushScheduleNext_();
    var props = PropertiesService.getScriptProperties();

    if (!next) {
      props.deleteProperty('PUSH_TICK_ID');
      return;
    }

    var at = Math.max(pushWallMs_(next), Date.now() + 60000);
    var trigger = ScriptApp.newTrigger(PUSH_TICK_HANDLER).timeBased().at(new Date(at)).create();

    props.setProperty('PUSH_TICK_ID', trigger.getUniqueId());

  }
  catch (error) {
    console.warn('push schedule: the trigger was not set');
  }

}

/* the Apps Script trigger's event (only our own triggers may run these) */
function pushFromOurTrigger_(e) {

  var uid = e && e.triggerUid ? String(e.triggerUid) : '';
  var props = PropertiesService.getScriptProperties();

  return !!uid && (uid === props.getProperty('PUSH_TICK_ID') || uid === props.getProperty('PUSH_DAILY_ID'));

}

/* the one-off trigger: sends what is due, then sets itself for the next moment */
function pushScheduleTick(e) {

  if (!pushFromOurTrigger_(e)) return;

  pushScheduleRun_();

}

/* the daily safety net: re-arms, sends what is overdue by < 6 h, gives up on older ones */
function pushScheduleDaily(e) {

  if (!pushFromOurTrigger_(e)) return;

  // once a day the new backend's admin list is refreshed too (WorkerSync.gs)
  workerSyncAdmins_(true);

  pushScheduleRun_();

}

/* due entries → pushSendItem_ (no lock around the send); results written under a short lock */
function pushScheduleRun_() {

  if (!compSpreadsheetIdOrEmpty_()) return;

  var nowMs = Date.now();
  var due = pushScheduleRows_().filter(function (row) {
    return row.status === 'pending' && row.sendAt && pushWallMs_(row.sendAt.replace(' ', 'T')) <= nowMs;
  });
  var results = [];
  var retry = false;

  due.forEach(function (row) {

    var late = nowMs - pushWallMs_(row.sendAt.replace(' ', 'T'));

    if (late > PUSH_SCHEDULE_OVERDUE_MS) {
      results.push({ row: row, status: 'skipped', result: 'فات ميعاده' });
      return;
    }

    try {
      var sent = pushSendItem_(row.notifId, row.sendKey, '');
      results.push({ row: row, status: 'sent', result: (sent.already ? 'كان اتبعت قبل كده' : 'وصل لـ ' + sent.sent + ' جهاز') });
    }
    catch (error) {
      var text = pushErrorText_(error);
      if (/استنى دقيقة|بيتبعت دلوقتي/.test(text)) {
        retry = true;
        return;
      }
      var notLive = /مش على الموقع|مش ظاهر|معاده مجاش/.test(text);
      results.push({ row: row, status: notLive ? 'skipped' : 'failed', result: notLive ? 'مش منشور: ' + text : text.slice(0, 200) });
    }

  });

  if (results.length) {

    var lock = LockService.getScriptLock();

    lock.waitLock(20000);

    try {
      var t = compSheet_('PushSchedule');
      var stamp = compNow_().stamp;
      results.forEach(function (r) {
        compUpdate_(t, r.row.__row, { status: r.status, result: plainCell_(r.result), updatedAt: stamp }, r.row);
        // the admins hear about what didn't go out
        if (r.status !== 'sent') {
          activity_({ action: 'push', type: 'notifications', id: r.row.notifId, title: 'إرسال تلقائي ما اتبعتش', changes: { auto: true, skipped: r.result.slice(0, 120) } });
        }
      });
    }
    finally {
      lock.releaseLock();
    }

  }

  try {
    if (typeof activityDispatch_ === 'function') activityDispatch_();
  }
  catch (ignored) {
    // admin pushes are best effort
  }

  pushScheduleArm_();

  // a cooldown: the next tick a couple of minutes later
  if (retry && pushAutoAuthorized_()) {
    try {
      pushTriggers_().forEach(function (trigger) {
        if (trigger.getHandlerFunction() === PUSH_TICK_HANDLER) ScriptApp.deleteTrigger(trigger);
      });
      var trigger = ScriptApp.newTrigger(PUSH_TICK_HANDLER).timeBased().at(new Date(Date.now() + PUSH_SCHEDULE_RETRY_MS)).create();
      PropertiesService.getScriptProperties().setProperty('PUSH_TICK_ID', trigger.getUniqueId());
    }
    catch (ignored) {
      // the daily one catches up
    }
  }

}


/**
 * Run ONCE by the owner from the Apps Script editor (Run ▸ enableAutoPush):
 * Google asks for the permission to manage triggers; then the daily safety
 * trigger is installed and the next moment armed.
 */
function enableAutoPush() {

  assertAdmin_();

  var props = PropertiesService.getScriptProperties();

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === PUSH_DAILY_HANDLER) ScriptApp.deleteTrigger(trigger);
  });

  var daily = ScriptApp.newTrigger(PUSH_DAILY_HANDLER).timeBased().everyDays(1).atHour(6).create();

  props.setProperties({ PUSH_AUTO: '1', PUSH_DAILY_ID: daily.getUniqueId() });
  pushScheduleArm_();

  return 'الإرسال التلقائي اتفعّل ✓';

}

/* { authorized, daily, nextDue, pending } */
function pushAutoState_() {

  var triggers = pushTriggers_();
  var authorized = PropertiesService.getScriptProperties().getProperty('PUSH_AUTO') === '1' && triggers !== null;
  var pending = 0;

  if (compSpreadsheetIdOrEmpty_()) {
    try {
      pending = pushScheduleRows_().filter(function (row) { return row.status === 'pending'; }).length;
    }
    catch (ignored) {
      pending = 0;
    }
  }

  return {
    authorized: authorized,
    daily: !!(triggers && triggers.some(function (t) { return t.getHandlerFunction() === PUSH_DAILY_HANDLER; })),
    nextDue: pushScheduleNext_(),
    pending: pending
  };

}


/* =========================================================
   ADMIN API
========================================================= */

function apiPushAuto() {

  assertAdmin_();

  return pushAutoState_();

}

/* entries, newest moment first: { entries: [{ id, notifId, kind, refId, sendAt, status, result, title }], auto } */
function apiPushSchedule() {

  assertAdmin_();

  if (!compSpreadsheetIdOrEmpty_()) return { entries: [], auto: pushAutoState_() };

  var titles = {};

  readOptionalTable_('Notifications').forEach(function (n) { titles[n.id] = n.title; });

  var entries = pushScheduleRows_().map(function (row) {
    return { id: row.id, notifId: row.notifId, kind: row.kind, refId: row.refId, sendAt: row.sendAt, status: row.status, result: row.result, title: titles[row.notifId] || '' };
  }).sort(function (a, b) { return a.sendAt < b.sendAt ? 1 : a.sendAt > b.sendAt ? -1 : 0; });

  return { entries: entries, auto: pushAutoState_() };

}

/* cancels one pending automatic send (the bell item stays: unpublish it from «الإشعارات» if wanted) */
function apiPushScheduleCancel(id) {

  assertAdmin_();

  if (typeof id !== 'string' || !/^psh-[0-9a-f]{10}$/.test(id)) throw new Error('الطلب مش مفهوم');

  var lock = LockService.getScriptLock();

  lock.waitLock(20000);

  try {
    var t = compSheet_('PushSchedule');
    var rowNumber = compFindRow_(t, 'id', id);
    var row = rowNumber ? compRowAt_(t, rowNumber) : null;
    if (!row) throw appError_('الإرسال ده مش موجود.', '');
    if (row.status === 'pending') {
      compUpdate_(t, rowNumber, { status: 'cancelled', result: 'اتلغى من لوحة التحكم', updatedAt: compNow_().stamp }, row);
    }
  }
  finally {
    lock.releaseLock();
  }

  pushScheduleArm_();

  return apiPushSchedule();

}
