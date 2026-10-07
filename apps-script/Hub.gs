/**
 * HUB CONTENT: meetings (sessions), news, games, notifications, media.
 *
 * Pure functions like Content.gs (no Google services), called from
 * buildPublicContent(). Every date/time is a Cairo wall-clock string
 * ("YYYY-MM-DDTHH:MM"); nothing here uses UTC or any visitor time zone.
 */

var SESSION_STATUSES = ['normal', 'cancelled'];

var GAME_AFTER_END = ['show', 'hide'];

var NOTIFICATION_TYPES = ['general', 'meeting', 'news', 'game', 'important', 'competition', 'activity'];

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

/* scene videos (Links.gallery only): the file and its poster frame */
var VIDEO_PATH = /^media\/\d{4}\/vid-[a-z0-9]{8}\.(mp4|webm)$/;
var VIDEO_POSTER_PATH = /^media\/\d{4}\/vid-[a-z0-9]{8}-480\.(webp|jpg)$/;


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
   VISIBILITY
   The one rule for sections and items (same as assets/js/schedule.js
   visibilityState and the admin's A.visibility):
   'off' | 'scheduled' | 'ended' | 'live'. Stamps are "YYYY-MM-DDTHH:MM"
   wall times; "until" is inclusive.
========================================================= */

function visibilityState_(enabled, from, until, now) {

  if (!enabled) {
    return 'off';
  }

  if (from && now < from) {
    return 'scheduled';
  }

  if (until && now > until) {
    return 'ended';
  }

  return 'live';

}


/* a week's own length in minutes (15..600), or null = the usual */
function sessionDuration_(value) {

  var n = contentNumber_(value);

  return n !== null && !isNaN(n) && n >= 15 && n <= 600 ? Math.round(n) : null;

}


/* =========================================================
   MEETING PROGRAM «برنامج الاجتماع»
   Stored (Sessions.program) as JSON text, in order:
     [{ title (≤ 40), time 'HH:MM' | '', minutes 1..600 | '' }]
   Published (content.json sessions[].program) as contiguous Cairo wall
   times: [{ title, start, end }] — a stage ends where the next one
   starts, the last one at the meeting's end.
========================================================= */

var PROGRAM_LIMITS = { stages: 20, title: 40, minutes: 600 };

/**
 * The stages of a cell / an editor's list, checked for shape only:
 * { stages: [{ title, time, minutes }], problems: ['…'] }. '' = no program.
 */
function programStages_(value) {

  var problems = [];
  var list = value;

  if (value === null || value === undefined || value === '') {
    return { stages: [], problems: problems };
  }

  if (typeof value === 'string') {
    var text = contentText_(value);
    if (!text) return { stages: [], problems: problems };
    try {
      list = JSON.parse(text);
    }
    catch (ignored) {
      return { stages: [], problems: ['البرنامج المتسجل مش مفهوم (افتحه من لوحة التحكم واحفظه تاني)'] };
    }
  }

  if (!Array.isArray(list)) {
    return { stages: [], problems: ['البرنامج المتسجل مش مفهوم (افتحه من لوحة التحكم واحفظه تاني)'] };
  }

  if (list.length > PROGRAM_LIMITS.stages) {
    problems.push('أقصى عدد فقرات ' + PROGRAM_LIMITS.stages);
  }

  var stages = [];

  list.slice(0, PROGRAM_LIMITS.stages).forEach(function (item, i) {

    item = item && typeof item === 'object' ? item : {};

    var title = contentLine_(item.title);
    var label = 'الفقرة ' + (i + 1) + (title ? ' «' + title + '»' : '');
    var time = contentTime_(item.time === undefined || item.time === null ? '' : item.time);
    var minutesText = contentDigits_(item.minutes === undefined || item.minutes === null ? '' : String(item.minutes));
    var minutes = minutesText === '' ? '' : Number(minutesText);

    if (!title) problems.push(label + ': الاسم مطلوب');
    if (title.length > PROGRAM_LIMITS.title) problems.push(label + ': الاسم أطول من ' + PROGRAM_LIMITS.title + ' حرف');
    if (time === null) problems.push(label + ': الوقت لازم يكون بالشكل 20:30');
    if (minutes !== '' && !(minutes >= 1 && minutes <= PROGRAM_LIMITS.minutes && Math.round(minutes) === minutes)) {
      problems.push(label + ': المدة لازم تكون عدد دقايق من 1 لـ ' + PROGRAM_LIMITS.minutes);
    }

    stages.push({ title: title, time: time || '', minutes: minutes === '' || isNaN(minutes) ? '' : minutes });

  });

  return { stages: stages, problems: problems };

}


/**
 * Stages → the published, contiguous program of one meeting.
 * date 'YYYY-MM-DD', startTime 'HH:MM' (the meeting's), duration minutes
 * or null (unknown). A stage starts at its own time, else right after the
 * previous one (its start + its minutes); the first defaults to the
 * meeting's start. Each ends where the next starts; the last at the
 * meeting's end (or its own minutes when the meeting's length is unknown).
 * → { stages: [{ title, start, end }], errors: [], warnings: [] }
 */
function resolveProgram_(stages, date, startTime, duration) {

  var errors = [];
  var warnings = [];
  var out = [];

  if (!stages || !stages.length) {
    return { stages: out, errors: errors, warnings: warnings };
  }

  if (!startTime) {
    errors.push('ميعاد الاجتماع نفسه مش معروف، فمينفعش نحسب أوقات الفقرات');
    return { stages: out, errors: errors, warnings: warnings };
  }

  var meetingStart = date + 'T' + startTime;
  var meetingEnd = duration ? wallAdd_(meetingStart, duration) : '';
  var crossesMidnight = !!meetingEnd && meetingEnd.slice(0, 10) !== date;
  var name = function (stage, i) { return '«' + (stage.title || ('الفقرة ' + (i + 1))) + '»'; };

  for (var i = 0; i < stages.length; i++) {

    var stage = stages[i];
    var start = '';

    if (stage.time) {
      start = date + 'T' + stage.time;
      // a meeting that runs past midnight: an early time is the next day
      if (crossesMidnight && stage.time < startTime) start = wallAdd_(start, 1440);
    }
    else if (i === 0) {
      start = meetingStart;
    }
    else if (stages[i - 1].minutes && out[i - 1]) {
      start = wallAdd_(out[i - 1].start, stages[i - 1].minutes);
    }
    else {
      errors.push(name(stage, i) + ' محتاجة وقت بداية، أو الفقرة اللي قبلها محتاجة مدة');
      return { stages: [], errors: errors, warnings: warnings };
    }

    if (start < meetingStart) {
      errors.push(name(stage, i) + ' بتبدأ قبل ميعاد الاجتماع');
    }

    if (meetingEnd && start >= meetingEnd) {
      errors.push(name(stage, i) + ' بتبدأ بعد ما الاجتماع يخلص');
    }

    if (i > 0 && out[i - 1] && start <= out[i - 1].start) {
      errors.push('الفقرات مش بالترتيب: ' + name(stage, i) + ' لازم تبدأ بعد ' + name(stages[i - 1], i - 1));
    }
    else if (i > 0 && stage.time && stages[i - 1].minutes && wallAdd_(out[i - 1].start, stages[i - 1].minutes) > start) {
      warnings.push(name(stages[i - 1], i - 1) + ' مدتها بتدخل في ' + name(stage, i) + '، فهتخلص أول ما اللي بعدها تبدأ');
    }

    out.push({ title: stage.title, start: start, end: '' });

  }

  for (var j = 0; j < out.length - 1; j++) {
    out[j].end = out[j + 1].start;
  }

  var last = out[out.length - 1];
  var lastStage = stages[stages.length - 1];

  if (meetingEnd) {
    last.end = meetingEnd;
    if (lastStage.minutes && wallAdd_(last.start, lastStage.minutes) > meetingEnd) {
      warnings.push(name(lastStage, stages.length - 1) + ' هتخلص مع نهاية الاجتماع');
    }
  }
  else if (lastStage.minutes) {
    last.end = wallAdd_(last.start, lastStage.minutes);
  }
  else {
    errors.push('حدد مدة الاجتماع، أو مدة آخر فقرة، علشان نعرف البرنامج بيخلص إمتى');
  }

  return { stages: errors.length ? [] : out, errors: errors, warnings: warnings };

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

    // removed from the library: never published again
    if (contentLine_(row.deletedAt)) {
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

    // the dominant colour shows while the picture loads
    var color = contentLine_(row.color).toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color)) {
      index[id].color = color;
    }

  });

  return index;

}


/**
 * Media rows -> { id: { src, poster, w, h, alt } } for the library's videos
 * (vid-…). Never mixed into mediaIndex_: every other field takes images only.
 */
function videoIndex_(rows) {

  var index = Object.create(null);

  (rows || []).forEach(function (row) {

    var id = contentLine_(row.id);
    var path = contentLine_(row.path);
    var thumb = contentLine_(row.thumb);
    var width = contentNumber_(row.width);
    var height = contentNumber_(row.height);

    if (!/^vid-[a-z0-9]{8}$/.test(id) || !VIDEO_PATH.test(path) || !VIDEO_POSTER_PATH.test(thumb) || contentLine_(row.deletedAt)) {
      return;
    }

    if (!(width > 0) || !(height > 0)) {
      return;
    }

    index[id] = {
      src: path,
      poster: thumb,
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
 *         setting(key), sections: { meeting, news, games } }
 * ctx.sections: false = that whole section is switched off. Its items are
 * not built at all (not validated, not published, their images stay
 * private), and bell notifications that point into it are dropped:
 * section visibility always wins.
 * Returns { sessions, news, games, notifications, cancelledDates, usedMedia }.
 */
function buildHub_(draft, ctx) {

  var sectionsOn = ctx.sections || {};
  var on = function (key) {
    if (ctx.sectionOn) return ctx.sectionOn(key);
    return sectionsOn[key] !== false;
  };
  // archived items are kept in the Sheet, never published
  var archived = function (row) { return contentBool_(row.archived); };
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

  sortRows_(on('meeting') ? draft.sessions || [] : []).forEach(function (row) {

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

    var entry = {
      date: date,
      time: time || '',
      topic: ctx.limited(where, contentLine_(row.topic), HUB_LIMITS.topic, 'الموضوع'),
      speaker: ctx.limited(where, contentLine_(row.speaker), HUB_LIMITS.speaker, 'الخادم / المتكلم'),
      description: ctx.limited(where, contentText_(row.description), HUB_LIMITS.sessionDescription, 'الوصف'),
      image: image(where, row.image),
      status: status,
      note: ctx.limited(where, contentLine_(row.note), LIMITS.note, 'الملاحظة'),
      visibleFrom: dateTime(where, row.visibleFrom, false, 'ميعاد الظهور'),
      durationMinutes: sessionDuration_(row.durationMinutes)
    };

    // «برنامج الاجتماع»: contiguous stages in Cairo wall time (only when there is one)
    var program = programStages_(row.program);

    program.problems.forEach(function (problem) { ctx.error(where, 'برنامج الاجتماع: ' + problem); });

    if (!program.problems.length && program.stages.length && status !== 'cancelled') {
      var resolved = resolveProgram_(
        program.stages,
        date,
        time || contentTime_(ctx.setting('meeting.time')) || '',
        entry.durationMinutes || sessionDuration_(ctx.setting('meeting.durationMinutes'))
      );
      resolved.errors.forEach(function (problem) { ctx.error(where, 'برنامج الاجتماع: ' + problem); });
      resolved.warnings.forEach(function (problem) { ctx.warn(where, 'برنامج الاجتماع: ' + problem); });
      if (!resolved.errors.length && resolved.stages.length) entry.program = resolved.stages;
    }

    sessions.push(entry);

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

    if (!on('news') || !contentBool_(row.enabled) || archived(row)) {
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

    if (!on('games') || !contentBool_(row.enabled) || archived(row)) {
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


  /* ---------- activities: competitions, trips, plays... (Activities + Types) ---------- */

  var types = Object.create(null);

  sortRows_(draft.types || []).forEach(function (row) {
    var key = contentLine_(row.key).toLowerCase();
    if (!key || !contentBool_(row.enabled)) return;
    types[key] = {
      key: key,
      label: contentLine_(row.label) || key,
      section: contentLine_(row.section).toLowerCase(),
      icon: ICON_NAMES.indexOf(contentLine_(row.icon)) !== -1 ? contentLine_(row.icon) : '',
      theme: SECTION_THEMES.indexOf(contentLine_(row.theme)) !== -1 ? contentLine_(row.theme) : '',
      bannerId: contentLine_(row.banner),
      ctaDefault: contentLine_(row.ctaDefault)
    };
  });

  var activities = [];
  var activityIds = Object.create(null);
  var allActivityIds = Object.create(null);
  var activitySection = Object.create(null);
  var usedTypes = Object.create(null);

  sortRows_(draft.activities || []).forEach(function (row) {

    var id = contentLine_(row.id);

    if (id) {
      allActivityIds[id] = true;
    }

    if (!contentBool_(row.enabled) || archived(row)) {
      return;
    }

    var title = contentLine_(row.title);
    var where = 'الفعاليات: ' + (title || ('صف ' + (row.__index + 2)));
    var type = types[contentLine_(row.type).toLowerCase()];

    if (!type) {
      ctx.error(where, 'النوع "' + contentLine_(row.type) + '" مش موجود أو مقفول في شيت Types');
      return;
    }

    // its section switched off: nothing of it is published
    if (!on(type.section)) {
      return;
    }

    if (!uniqueId(where, id, activityIds)) {
      return;
    }

    if (!title) {
      ctx.error(where, 'العنوان مطلوب');
    }

    var urlText = contentLine_(row.url);
    var url = safeHttpsUrl(urlText);

    if (urlText && !url) {
      ctx.error(where, 'اللينك لازم يبدأ بـ https://');
    }

    var startAt = dateTime(where, row.startAt, false, 'بيبدأ');
    var endAt = dateTime(where, row.endAt, true, 'بيخلص');
    var visibleFrom = dateTime(where, row.visibleFrom, false, 'يظهر من');
    var visibleUntil = dateTime(where, row.visibleUntil, true, 'يختفي بعد') || endAt;

    if (startAt && endAt && startAt >= endAt) {
      ctx.error(where, 'ميعاد البداية بعد النهاية');
    }

    if (visibleUntil && ctx.now && visibleUntil < ctx.now) {
      ctx.warn(where, 'خلصت ومش هتظهر');
      delete activityIds[id];
      return;
    }

    activitySection[id] = type.section;
    usedTypes[type.key] = true;

    activities.push({
      id: id,
      type: type.key,
      section: type.section,
      title: ctx.limited(where, title, 80, 'العنوان'),
      subtitle: ctx.limited(where, contentLine_(row.subtitle), 140, 'السطر القصير'),
      description: ctx.limited(where, contentText_(row.description).replace(/\n{3,}/g, '\n\n'), 1500, 'التفاصيل'),
      image: image(where, row.image),
      cta: url ? { label: ctx.limited(where, contentLine_(row.ctaLabel) || type.ctaDefault || 'التفاصيل', 24, 'نص الزرار'), url: url } : null,
      location: ctx.limited(where, contentLine_(row.location), 120, 'المكان'),
      startAt: startAt,
      endAt: endAt,
      visibleFrom: visibleFrom,
      visibleUntil: visibleUntil
    });

  });

  var publishedTypes = Object.keys(usedTypes).map(function (key) {
    var t = types[key];
    return { key: t.key, label: t.label, icon: t.icon, theme: t.theme, banner: t.bannerId ? image('الأنواع: ' + t.label, t.bannerId) : null };
  });


  /* ---------- notifications (the bell) ---------- */

  var notifications = [];
  var notificationIds = Object.create(null);
  var historyDays = hours('notifications.historyDays', 14);

  sortRows_(draft.notifications || []).forEach(function (row) {

    if (!contentBool_(row.enabled) || archived(row)) {
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

    // a meeting / news / game notification never announces a hidden section
    var typeSection = { meeting: 'meeting', news: 'news', game: 'games', competition: 'competitions' }[type];

    if (typeSection && !on(typeSection)) {
      ctx.warn(where, 'القسم بتاعه مخفي، فالإشعار ده مش هيظهر');
      return;
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
    var match = /^(news|game|activity):([\w-]{1,60})$/.exec(targetText);

    if (!targetText) {
      target = null;
    }
    else if (targetText === 'meeting') {
      if (!on('meeting')) {
        ctx.warn(where, 'ركن الاجتماع مخفي، فالإشعار ده مش هيظهر');
        return;
      }
      target = { kind: 'meeting' };
    }
    else if (match && match[1] !== 'activity' && !on(match[1] === 'news' ? 'news' : 'games')) {
      ctx.warn(where, 'قسم ' + (match[1] === 'news' ? 'الأخبار' : 'الألعاب') + ' مخفي، فالإشعار ده مش هيظهر');
      return;
    }
    else if (match && match[1] === 'activity' && allActivityIds[match[2]] && !activityIds[match[2]]) {
      ctx.warn(where, 'الفعالية بتاعته مش ظاهرة، فالإشعار ده مش هيظهر');
      return;
    }
    else if (match) {
      var known = match[1] === 'news' ? allNewsIds : match[1] === 'game' ? allGameIds : allActivityIds;
      var live = match[1] === 'news' ? newsIds : match[1] === 'game' ? gameIds : activityIds;
      if (!known[match[2]]) {
        ctx.error(where, 'الإشعار بيشاور على ' + ({ news: 'خبر', game: 'لعبة', activity: 'فعالية' })[match[1]] + ' مش موجودة: ' + match[2]);
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
    activities: activities.slice(0, 60),
    types: publishedTypes,
    cancelledDates: cancelledDates,
    usedMedia: Object.keys(usedMedia)
  };

}
