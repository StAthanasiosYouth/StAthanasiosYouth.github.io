/**
 * HUB CONTENT: meetings (sessions), news, games, notifications, media.
 *
 * Pure functions like Content.gs (no Google services), called from
 * buildPublicContent(). Every date/time is a Cairo wall-clock string
 * ("YYYY-MM-DDTHH:MM"); nothing here uses UTC or any visitor time zone.
 */

var SESSION_STATUSES = ['normal', 'cancelled'];

var GAME_AFTER_END = ['show', 'hide'];

var NOTIFICATION_TYPES = ['general', 'meeting', 'news', 'game', 'important'];

var HUB_LIMITS = {
  topic: 80,
  speaker: 60,
  sessionDescription: 600,
  newsTitle: 80,
  summary: 200,
  body: 1500,
  gameTitle: 60,
  gameDescription: 300,
  buttonLabel: 24,
  notificationTitle: 60,
  notificationMessage: 200,
  alt: 140
};

/* how many items content.json carries at most */
var HUB_CAPS = {
  sessions: 12,
  news: 30,
  games: 12,
  notifications: 40
};

var MEDIA_PATH = /^media\/\d{4}\/img-[a-z0-9]{8}(-480)?\.(webp|jpg)$/;


/* =========================================================
   CAIRO WALL-CLOCK ARITHMETIC
   A wall time is treated as if it were UTC, only to do arithmetic on the
   numbers. Results are wall times again. Daylight saving never enters.
========================================================= */

function wallToMinutes_(stamp) {

  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(stamp || '');

  if (!m) {
    return null;
  }

  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;

}


function wallFromMinutes_(minutes) {

  var d = new Date(minutes * 60000);

  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate()) +
    'T' + pad2_(d.getUTCHours()) + ':' + pad2_(d.getUTCMinutes());

}


function wallAdd_(stamp, minutes) {

  var base = wallToMinutes_(stamp);

  return base === null ? '' : wallFromMinutes_(base + minutes);

}


/* =========================================================
   MEDIA
========================================================= */

/**
 * Media rows -> { id: { src, thumb, w, h, alt } } for images that can be
 * published. Rows with bad paths are skipped (and reported if used).
 */
function mediaIndex_(rows) {

  var index = Object.create(null);

  (rows || []).forEach(function (row) {

    var id = contentLine_(row.id);
    var path = contentLine_(row.path);
    var thumb = contentLine_(row.thumb);
    var width = contentNumber_(row.width);
    var height = contentNumber_(row.height);

    if (!/^img-[a-z0-9]{8}$/.test(id) || !MEDIA_PATH.test(path) || (thumb && !MEDIA_PATH.test(thumb))) {
      return;
    }

    if (!(width > 0) || !(height > 0)) {
      return;
    }

    index[id] = {
      src: path,
      thumb: thumb || path,
      w: Math.round(width),
      h: Math.round(height),
      alt: contentLine_(row.alt).slice(0, HUB_LIMITS.alt)
    };

  });

  return index;

}


/* =========================================================
   BUILD
========================================================= */

/**
 * ctx = { now, error(where, msg), warn(where, msg), limited(where, value, max, label),
 *         setting(key) }
 * Returns { sessions, news, games, notifications, cancelledDates, usedMedia }.
 */
function buildHub_(draft, ctx) {

  var media = mediaIndex_(draft.media);
  var usedMedia = Object.create(null);
  var today = ctx.now ? ctx.now.slice(0, 10) : '';

  function image(where, value) {
    var id = contentLine_(value);
    if (!id) {
      return null;
    }
    if (!media[id]) {
      ctx.error(where, 'الصورة "' + id + '" مش موجودة في شيت Media');
      return null;
    }
    usedMedia[id] = true;
    return media[id];
  }

  function dateTime(where, value, endOfDay, label) {
    var stamp = contentDateTime_(value, endOfDay);
    if (stamp === null) {
      ctx.error(where, label + ' مش مفهوم (مثال: 2026-10-12 20:00)');
      return '';
    }
    return stamp;
  }

  function uniqueId(where, id, seen) {
    if (!id) {
      ctx.error(where, 'من غير id');
      return false;
    }
    if (seen[id]) {
      ctx.error(where, 'id متكرر: ' + id);
      return false;
    }
    seen[id] = true;
    return true;
  }

  function hours(key, fallback) {
    var value = contentNumber_(ctx.setting(key));
    return value === null || isNaN(value) || value < 0 ? fallback : value;
  }


  /* ---------- sessions (dated meetings: topic, speaker, cancellations) ---------- */

  var sessions = [];
  var seenDates = Object.create(null);
  var cancelledDates = [];

  sortRows_(draft.sessions || []).forEach(function (row) {

    if (!contentBool_(row.enabled)) {
      return;
    }

    var dateText = contentDigits_(row.date);
    var where = 'الاجتماعات: ' + (dateText || ('صف ' + (row.__index + 2)));
    var date = contentDateTime_(dateText, false);

    if (!date || /[ T]/.test(dateText)) {
      ctx.error(where, 'التاريخ لازم يكون بالشكل 2026-10-11');
      return;
    }

    date = date.slice(0, 10);

    if (seenDates[date]) {
      ctx.error(where, 'في اجتماعين بنفس التاريخ');
      return;
    }

    seenDates[date] = true;

    if (today && date < today) {
      return;
    }

    var status = contentLine_(row.status).toLowerCase() || 'normal';

    if (SESSION_STATUSES.indexOf(status) === -1) {
      ctx.error(where, 'الحالة لازم تكون normal أو cancelled');
      status = 'normal';
    }

    var time = contentTime_(row.time);

    if (time === null) {
      ctx.error(where, 'الساعة لازم تكون بالشكل 20:00');
      time = '';
    }

    if (status === 'cancelled') {
      cancelledDates.push(date);
    }

    sessions.push({
      date: date,
      time: time || '',
      topic: ctx.limited(where, contentLine_(row.topic), HUB_LIMITS.topic, 'الموضوع'),
      speaker: ctx.limited(where, contentLine_(row.speaker), HUB_LIMITS.speaker, 'الخادم / المتكلم'),
      description: ctx.limited(where, contentText_(row.description), HUB_LIMITS.sessionDescription, 'الوصف'),
      image: image(where, row.image),
      status: status,
      note: ctx.limited(where, contentLine_(row.note), LIMITS.note, 'الملاحظة'),
      visibleFrom: dateTime(where, row.visibleFrom, false, 'ميعاد الظهور')
    });

  });

  sessions.sort(function (a, b) { return a.date < b.date ? -1 : 1; });


  /* ---------- news ---------- */

  var news = [];
  var newsIds = Object.create(null);
  var allNewsIds = Object.create(null);

  sortRows_(draft.news || []).forEach(function (row) {

    var id = contentLine_(row.id);

    if (id) {
      allNewsIds[id] = true;
    }

    if (!contentBool_(row.enabled)) {
      return;
    }

    var title = contentLine_(row.title);
    var where = 'الأخبار: ' + (title || ('صف ' + (row.__index + 2)));

    if (!uniqueId(where, id, newsIds)) {
      return;
    }

    if (!title) {
      ctx.error(where, 'العنوان مطلوب');
    }

    var linkUrl = contentLine_(row.linkUrl);
    var safeLink = safeHttpsUrl(linkUrl);

    if (linkUrl && !safeLink) {
      ctx.error(where, 'اللينك لازم يبدأ بـ https://');
    }

    var tone = contentLine_(row.tone).toLowerCase() || 'info';

    if (ANNOUNCEMENT_TONES.indexOf(tone) === -1) {
      ctx.error(where, 'النوع لازم يكون info أو alert أو celebrate');
      tone = 'info';
    }

    var publishAt = dateTime(where, row.publishAt, false, 'ميعاد النشر');
    var expireAt = dateTime(where, row.expireAt, true, 'ميعاد الانتهاء');

    if (publishAt && expireAt && publishAt > expireAt) {
      ctx.error(where, 'ميعاد النشر بعد ميعاد الانتهاء');
    }

    if (expireAt && ctx.now && expireAt < ctx.now) {
      ctx.warn(where, 'الخبر انتهى ومش هيظهر');
      delete newsIds[id];
      return;
    }

    news.push({
      id: id,
      title: ctx.limited(where, title, HUB_LIMITS.newsTitle, 'العنوان'),
      summary: ctx.limited(where, contentLine_(row.summary), HUB_LIMITS.summary, 'الملخص'),
      body: ctx.limited(where, contentText_(row.body).replace(/\n{3,}/g, '\n\n'), HUB_LIMITS.body, 'التفاصيل'),
      image: image(where, row.image),
      link: safeLink
        ? { url: safeLink, label: ctx.limited(where, contentLine_(row.linkLabel), LIMITS.linkLabel, 'نص الزرار') || 'التفاصيل' }
        : null,
      badge: ctx.limited(where, contentLine_(row.badge), LIMITS.badge, 'الشارة'),
      featured: contentBool_(row.featured),
      pinned: contentBool_(row.pinned),
      tone: tone,
      publishAt: publishAt,
      expireAt: expireAt
    });

  });

  // newest first; undated items count as oldest
  news.sort(function (a, b) {
    return (b.publishAt || '0') < (a.publishAt || '0') ? -1 : (b.publishAt || '0') > (a.publishAt || '0') ? 1 : 0;
  });


  /* ---------- games ---------- */

  var games = [];
  var gameIds = Object.create(null);
  var allGameIds = Object.create(null);
  var endedHours = hours('games.endedHours', 12);

  sortRows_(draft.games || []).forEach(function (row) {

    var id = contentLine_(row.id);

    if (id) {
      allGameIds[id] = true;
    }

    if (!contentBool_(row.enabled)) {
      return;
    }

    var title = contentLine_(row.title);
    var where = 'الألعاب: ' + (title || ('صف ' + (row.__index + 2)));

    if (!uniqueId(where, id, gameIds)) {
      return;
    }

    if (!title) {
      ctx.error(where, 'العنوان مطلوب');
    }

    var url = safeHttpsUrl(row.url);

    if (!url) {
      ctx.error(where, 'لينك اللعبة لازم يكون كامل ويبدأ بـ https://');
    }

    var visibleFrom = dateTime(where, row.visibleFrom, false, 'ميعاد الظهور');
    var startAt = dateTime(where, row.startAt, false, 'ميعاد البداية');
    var endAt = dateTime(where, row.endAt, true, 'ميعاد النهاية');

    if (!startAt || !endAt) {
      ctx.error(where, 'ميعاد البداية والنهاية مطلوبين');
    }
    else if (startAt >= endAt) {
      ctx.error(where, 'ميعاد البداية لازم يكون قبل النهاية');
    }

    if (visibleFrom && startAt && visibleFrom > startAt) {
      ctx.error(where, 'ميعاد الظهور لازم يكون قبل ميعاد البداية');
    }

    var afterEnd = contentLine_(row.afterEnd).toLowerCase() || 'show';

    if (GAME_AFTER_END.indexOf(afterEnd) === -1) {
      ctx.error(where, 'بعد النهاية لازم يكون show أو hide');
      afterEnd = 'show';
    }

    var endedUntil = endAt && afterEnd === 'show' ? wallAdd_(endAt, endedHours * 60) : endAt;

    if (endedUntil && ctx.now && endedUntil < ctx.now) {
      ctx.warn(where, 'اللعبة خلصت ومش هتظهر');
      delete gameIds[id];
      return;
    }

    games.push({
      id: id,
      title: ctx.limited(where, title, HUB_LIMITS.gameTitle, 'العنوان'),
      description: ctx.limited(where, contentText_(row.description), HUB_LIMITS.gameDescription, 'الوصف'),
      image: image(where, row.image),
      url: url,
      buttonLabel: ctx.limited(where, contentLine_(row.buttonLabel), HUB_LIMITS.buttonLabel, 'نص الزرار'),
      visibleFrom: visibleFrom,
      startAt: startAt,
      endAt: endAt,
      afterEnd: afterEnd,
      endedUntil: endedUntil
    });

  });

  games.sort(function (a, b) { return a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0; });


  /* ---------- notifications (the bell) ---------- */

  var notifications = [];
  var notificationIds = Object.create(null);
  var historyDays = hours('notifications.historyDays', 14);

  sortRows_(draft.notifications || []).forEach(function (row) {

    if (!contentBool_(row.enabled)) {
      return;
    }

    var title = contentLine_(row.title);
    var id = contentLine_(row.id);
    var where = 'الإشعارات: ' + (title || ('صف ' + (row.__index + 2)));

    if (!uniqueId(where, id, notificationIds)) {
      return;
    }

    if (!title) {
      ctx.error(where, 'العنوان مطلوب');
    }

    var type = contentLine_(row.type).toLowerCase() || 'general';

    if (NOTIFICATION_TYPES.indexOf(type) === -1) {
      ctx.error(where, 'نوع الإشعار مش معروف: ' + type);
      type = 'general';
    }

    var publishAt = dateTime(where, row.publishAt, false, 'ميعاد الظهور');

    if (!publishAt) {
      ctx.error(where, 'ميعاد الظهور مطلوب');
      return;
    }

    var expireAt = dateTime(where, row.expireAt, true, 'ميعاد الاختفاء') || wallAdd_(publishAt, historyDays * 1440);

    if (expireAt < publishAt) {
      ctx.error(where, 'ميعاد الاختفاء قبل ميعاد الظهور');
    }

    if (ctx.now && expireAt < ctx.now) {
      return;
    }

    // what tapping the notification opens
    var targetText = contentLine_(row.target);
    var target = null;
    var match = /^(news|game):([\w-]{1,60})$/.exec(targetText);

    if (!targetText) {
      target = null;
    }
    else if (targetText === 'meeting') {
      target = { kind: 'meeting' };
    }
    else if (match) {
      var known = match[1] === 'news' ? allNewsIds : allGameIds;
      var live = match[1] === 'news' ? newsIds : gameIds;
      if (!known[match[2]]) {
        ctx.error(where, 'الإشعار بيشاور على ' + (match[1] === 'news' ? 'خبر' : 'لعبة') + ' مش موجودة: ' + match[2]);
      }
      else if (!live[match[2]]) {
        ctx.warn(where, 'الإشعار بيشاور على حاجة مش منشورة دلوقتي، هيظهر من غير لينك');
      }
      else {
        target = { kind: match[1], id: match[2] };
      }
    }
    else if (safeHttpsUrl(targetText)) {
      target = { kind: 'url', url: safeHttpsUrl(targetText) };
    }
    else {
      ctx.error(where, 'الوجهة لازم تكون meeting أو news:id أو game:id أو لينك https');
    }

    notifications.push({
      id: id,
      type: type,
      title: ctx.limited(where, title, HUB_LIMITS.notificationTitle, 'العنوان'),
      message: ctx.limited(where, contentLine_(row.message), HUB_LIMITS.notificationMessage, 'الرسالة'),
      target: target,
      image: image(where, row.image),
      publishAt: publishAt,
      expireAt: expireAt
    });

  });

  notifications.sort(function (a, b) { return a.publishAt > b.publishAt ? -1 : a.publishAt < b.publishAt ? 1 : 0; });

  return {
    sessions: sessions.slice(0, HUB_CAPS.sessions),
    news: news.slice(0, HUB_CAPS.news),
    games: games.slice(0, HUB_CAPS.games),
    notifications: notifications.slice(0, HUB_CAPS.notifications),
    cancelledDates: cancelledDates,
    usedMedia: Object.keys(usedMedia)
  };

}


/* =========================================================
   CHANGE SUMMARY for the hub parts (used by summarizeChanges)
========================================================= */

function summarizeHubChanges_(previous, next, lines) {

  var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };

  function list(name, label, titleOf) {
    diffById_(previous[name] || [], next[name] || [], function (item) { return item.id || item.date; }, {
      added: function (item) { lines.push(label.added + ': ' + titleOf(item)); },
      removed: function (item) { lines.push(label.removed + ': ' + titleOf(item)); },
      changed: function (before, after) {
        if (!same(before, after)) {
          lines.push(label.changed + ': ' + titleOf(after));
        }
      }
    });
  }

  list('sessions', { added: 'اجتماع اتضاف', removed: 'اجتماع اتشال', changed: 'تعديل اجتماع' }, function (s) {
    return s.date + (s.status === 'cancelled' ? ' (ملغي)' : s.topic ? ' — ' + s.topic : '');
  });

  list('news', { added: 'خبر جديد', removed: 'إخفاء/حذف خبر', changed: 'تعديل خبر' }, function (n) { return n.title; });
  list('games', { added: 'لعبة جديدة', removed: 'إخفاء/حذف لعبة', changed: 'تعديل لعبة' }, function (g) { return g.title; });
  list('notifications', { added: 'إشعار جديد', removed: 'إخفاء/حذف إشعار', changed: 'تعديل إشعار' }, function (n) { return n.title; });

}
