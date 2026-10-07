/**
 * CONTENT MODEL
 *
 * Turns the draft rows from the Sheet into the public content.json (and
 * meeting.ics). Pure functions only: no SpreadsheetApp, UrlFetchApp or other
 * Google services, so tools/ and tests/ run this exact file in Node.
 *
 * Everything that reaches the public site passes through here, so this is
 * where validation, URL allowlisting and stripping of internal fields happen.
 * The public site re-checks URLs on render as a second line of defence.
 */

/* 2 = adds sessions, news, games, notifications (additive: schema-1 readers ignore them)
   3 = adds layout: the page's sections in order, with their own visibility
       (additive: schema-2 readers ignore it) */
var CONTENT_SCHEMA_VERSION = 3;

var CONTENT_TIMEZONE = 'Africa/Cairo';

var LINK_STYLES = ['card', 'tile'];

var CONTACT_KINDS = ['service', 'support'];

var CONTACT_METHODS = ['call', 'whatsapp'];

var ANNOUNCEMENT_TONES = ['info', 'alert', 'celebrate'];

/* Keep in sync with assets/js/icons.js (tools/sync-admin.mjs checks this). */
var ICON_NAMES = [
  'voice', 'facebook', 'instagram', 'tiktok', 'youtube', 'whatsapp',
  'telegram', 'spotify', 'form', 'calendar', 'ticket', 'bus', 'book',
  'music', 'photos', 'video', 'church', 'cross', 'heart', 'star',
  'megaphone', 'gift', 'users', 'map', 'info', 'link', 'trophy', 'theatre',
  'messenger', 'discord', 'x', 'threads', 'snapchat', 'mail', 'phone'
];

/*
 * PAGE SECTIONS
 * Every block on the public page is a row in the Sections tab: the
 * built-in blocks below plus any number of link groups ("links") and
 * item sections ("items": competitions, activities...). A section can be
 * switched off or scheduled; switched off, nothing inside it is published.
 */
var SECTION_KINDS = ['meeting', 'featured', 'news', 'games', 'items', 'location', 'links', 'contacts', 'support', 'share'];

/* what a link may open first: '' (auto), 'none', or a key of PLATFORMS
   (Platforms.gs, generated from assets/js/platforms.js). A function, not a
   var: Platforms.gs may load after this file. */
function linkExperiences_() {

  return ['none'].concat(Object.keys(PLATFORMS));

}

var SECTION_THEMES = ['gold', 'ember', 'azure', 'rose', 'emerald', 'night'];

/* the cards' background in a section («شكل الخلفية»); '' = automatic (the site decides) */
var SECTION_SURFACES = ['glass', 'dark', 'filled', 'none'];

/* today's page order; link groups sit between "before" and "after" */
var BUILTIN_SECTIONS = [
  { key: 'meeting', kind: 'meeting', title: 'ركن الاجتماع', place: 'before' },
  { key: 'featured', kind: 'featured', title: 'الروابط المميزة', place: 'before' },
  { key: 'news', kind: 'news', title: 'جديد الأسرة', place: 'before' },
  { key: 'games', kind: 'games', title: 'تحديات وألعاب', place: 'before' },
  { key: 'competitions', kind: 'items', title: 'المسابقات', place: 'before' },
  { key: 'activities', kind: 'items', title: 'الفعاليات', place: 'before' },
  { key: 'location', kind: 'location', title: 'مكان الاجتماع', place: 'before' },
  { key: 'contacts', kind: 'contacts', title: 'تواصل مع الخدمة', place: 'after' },
  { key: 'support', kind: 'support', title: 'الدعم الفني', place: 'after' },
  { key: 'share', kind: 'share', title: 'شارك الصفحة', place: 'after' }
];

var DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

var DAY_ALIASES = {
  sunday: ['sunday', 'sun', 'الأحد', 'الاحد', 'احد', 'أحد'],
  monday: ['monday', 'mon', 'الاثنين', 'الإثنين', 'الاتنين', 'الإتنين', 'اتنين'],
  tuesday: ['tuesday', 'tue', 'الثلاثاء', 'التلات', 'الثلاث', 'تلات'],
  wednesday: ['wednesday', 'wed', 'الأربعاء', 'الاربعاء', 'الأربع', 'الاربع'],
  thursday: ['thursday', 'thu', 'الخميس', 'خميس'],
  friday: ['friday', 'fri', 'الجمعة', 'الجمعه', 'جمعة'],
  saturday: ['saturday', 'sat', 'السبت', 'سبت']
};

var LIMITS = {
  siteName: 120,
  tagline: 140,
  shareText: 200,
  title: 60,
  subtitle: 140,
  cta: 24,
  badge: 16,
  sectionTitle: 40,
  note: 200,
  address: 160,
  announcement: 280,
  linkLabel: 30,
  personName: 60,
  role: 60,
  description: 140,
  message: 300,
  contactIntro: 80,
  contactReply: 200,
  gallery: 6
};

/* a scene video's clip (seconds): «من» / «لحد» */
var GALLERY_CLIP = {
  maxSeconds: 600,
  minSeconds: 0.5
};


/* =========================================================
   SCENE GALLERY TOKENS (Links.gallery)
   "img-xxxxxxxx", "vid-xxxxxxxx" or "vid-xxxxxxxx@START-END" (seconds,
   up to one decimal), comma separated, up to LIMITS.gallery.
========================================================= */

function galleryTokens_(value) {

  return (Array.isArray(value) ? value : String(value === null || value === undefined ? '' : value).split(/[\s,،]+/))
    .map(function (token) { return contentLine_(token); })
    .filter(Boolean);

}


/* one token -> { id, kind: 'image'|'video', start, end, clip } or null (not a token) */
function parseGalleryToken_(token) {

  var match = /^(img|vid)-([a-z0-9]{8})(?:@(\d{1,4}(?:\.\d+)?)-(\d{1,4}(?:\.\d+)?))?$/.exec(String(token || '').trim().toLowerCase());

  if (!match) {
    return null;
  }

  var item = { id: match[1] + '-' + match[2], kind: match[1] === 'vid' ? 'video' : 'image', start: 0, end: 0, clip: false };

  if (match[3] !== undefined) {
    // a picture has no start and end
    if (item.kind !== 'video') return null;
    item.start = Math.round(Number(match[3]) * 10) / 10;
    item.end = Math.round(Number(match[4]) * 10) / 10;
    item.clip = true;
  }

  return item;

}


/* '' or what is wrong with a video's clip */
function galleryClipProblem_(item) {

  if (!item || !item.clip) return '';
  if (!(item.start >= 0) || !(item.end > item.start)) return 'وقت «لحد» لازم يكون بعد «من»';
  if (item.end > GALLERY_CLIP.maxSeconds) return 'المقطع لازم يخلص قبل الدقيقة ١٠';
  if (item.end - item.start < GALLERY_CLIP.minSeconds) return 'المقطع لازم يكون نص ثانية على الأقل';
  return '';

}


/* the stored form of a parsed token */
function galleryToken_(item) {

  return item.id + (item.clip ? '@' + item.start + '-' + item.end : '');

}


/* =========================================================
   SMALL HELPERS
========================================================= */

function contentText_(value) {

  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    // control characters (keep newlines out of single-line fields later)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();

}


function contentLine_(value) {

  return contentText_(value).replace(/\s+/g, ' ');

}


function contentBool_(value) {

  if (value === true || value === 1) {
    return true;
  }

  var text = contentLine_(value).toLowerCase();

  return ['true', 'yes', '1', 'نعم', 'اه', 'أه', 'ايوه', 'on', 'enabled', 'مفعل'].indexOf(text) !== -1;

}


/* Arabic-Indic and Persian digits to ASCII. */
function contentDigits_(value) {

  return contentText_(value)
    .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });

}


function contentNumber_(value) {

  var text = contentDigits_(value).replace(/,/g, '.');

  if (text === '') {
    return null;
  }

  var number = Number(text);

  return isFinite(number) ? number : NaN;

}


function pad2_(n) {

  return (n < 10 ? '0' : '') + n;

}


/**
 * Only absolute https URLs with a real hostname. No credentials, no spaces,
 * no quotes or angle brackets. Returns '' when the URL is not acceptable.
 */
function safeHttpsUrl(value) {

  var url = contentLine_(value);

  if (!url) {
    return '';
  }

  var match = /^https:\/\/([^\/?#\s]+)([\/?#][^\s]*)?$/i.exec(url);

  if (!match) {
    return '';
  }

  var authority = match[1];

  // user:pass@host is a classic phishing trick
  if (authority.indexOf('@') !== -1) {
    return '';
  }

  var host = authority.replace(/:\d{1,5}$/, '').toLowerCase();

  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    return '';
  }

  if (/["'<>`\\]/.test(url)) {
    return '';
  }

  return url;

}


/**
 * "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" (also with "T") in Cairo wall time.
 * Returns "YYYY-MM-DDTHH:MM", '' for empty input, or null when invalid.
 * Date-only values become the start or end of that day.
 */
function contentDateTime_(value, endOfDay) {

  var text = contentDigits_(value);

  if (!text) {
    return '';
  }

  var match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(text);

  if (!match) {
    return null;
  }

  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);

  var check = new Date(Date.UTC(year, month - 1, day));

  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }

  var hasTime = match[4] !== undefined;
  var hours = hasTime ? Number(match[4]) : (endOfDay ? 23 : 0);
  var minutes = hasTime ? Number(match[5]) : (endOfDay ? 59 : 0);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return year + '-' + pad2_(month) + '-' + pad2_(day) + 'T' + pad2_(hours) + ':' + pad2_(minutes);

}


function contentTime_(value) {

  var text = contentDigits_(value).replace(/\s+/g, ' ').toLowerCase();

  if (!text) {
    return '';
  }

  var pm = /(pm|م|مساء|مساءً|بالليل)$/.test(text);
  var am = /(am|ص|صباحا|صباحاً|الصبح)$/.test(text);

  text = text.replace(/(pm|am|مساءً|مساء|صباحاً|صباحا|بالليل|الصبح|م|ص)$/, '').trim();

  var match = /^(\d{1,2})(?::(\d{2}))?$/.exec(text);

  if (!match) {
    return null;
  }

  var hours = Number(match[1]);
  var minutes = match[2] === undefined ? 0 : Number(match[2]);

  if (pm || am) {
    if (hours < 1 || hours > 12) {
      return null;
    }
    if (pm && hours !== 12) {
      hours += 12;
    }
    if (am && hours === 12) {
      hours = 0;
    }
  }

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return pad2_(hours) + ':' + pad2_(minutes);

}


function contentDay_(value) {

  var text = contentDigits_(value).toLowerCase();

  if (text === '') {
    return null;
  }

  if (/^[0-6]$/.test(text)) {
    return Number(text);
  }

  for (var i = 0; i < DAY_KEYS.length; i++) {
    if (DAY_ALIASES[DAY_KEYS[i]].indexOf(text) !== -1) {
      return i;
    }
  }

  return null;

}


/**
 * Egyptian-friendly phone normalization.
 * Returns { e164: '201220129458', display: '0122 012 9458' } or null.
 */
function normalizePhone(value) {

  var digits = contentDigits_(value).replace(/[^\d+]/g, '');

  if (digits.indexOf('+') > 0) {
    return null;
  }

  digits = digits.replace(/^\+/, '').replace(/^00/, '');

  if (/^0(1[0125]\d{8})$/.test(digits)) {
    digits = '2' + digits;
  }
  else if (/^1[0125]\d{8}$/.test(digits)) {
    digits = '20' + digits;
  }

  if (/^201[0125]\d{8}$/.test(digits)) {
    var local = '0' + digits.slice(2);
    return {
      e164: digits,
      display: local.slice(0, 4) + ' ' + local.slice(4, 7) + ' ' + local.slice(7)
    };
  }

  // other international numbers: accept plain E.164 lengths
  if (/^[1-9]\d{7,14}$/.test(digits)) {
    return {
      e164: digits,
      display: '+' + digits
    };
  }

  return null;

}


/* =========================================================
   BUILD
========================================================= */

/**
 * draft = {
 *   settings: { 'site.name': '...', ... },
 *   sections: [{ key, title, order, enabled }],
 *   links:    [{ id, enabled, order, section, style, featured, title, subtitle,
 *                cta, url, icon, badge, startAt, endAt }],
 *   contacts: [{ id, enabled, order, kind, name, role, description, phone,
 *                method, message }]
 * }
 *
 * options = { now: 'YYYY-MM-DDTHH:MM' (Cairo wall time), hash: fn(string) -> hex }
 *
 * Returns { content, errors: [{ where, message }], warnings: [...] }.
 * Publishing is refused when errors is not empty.
 */
function buildPublicContent(draft, options) {

  options = options || {};

  var errors = [];
  var warnings = [];
  var now = options.now || '';

  function error(where, message) {
    errors.push({ where: where, message: message });
  }

  function warn(where, message) {
    warnings.push({ where: where, message: message });
  }

  function limited(where, value, max, label) {
    if (value.length > max) {
      error(where, label + ' أطول من ' + max + ' حرف');
    }
    return value;
  }

  var s = draft.settings || {};

  function setting(key) {
    return s[key] === undefined ? '' : s[key];
  }


  /* ---------- site ---------- */

  var site = {
    name: limited('الإعدادات', contentLine_(setting('site.name')), LIMITS.siteName, 'اسم الخدمة'),
    tagline: limited('الإعدادات', contentLine_(setting('site.tagline')), LIMITS.tagline, 'الجملة التعريفية'),
    shareText: limited('الإعدادات', contentLine_(setting('site.shareText')), LIMITS.shareText, 'نص المشاركة')
  };

  if (!site.name) {
    error('الإعدادات', 'اسم الخدمة مطلوب');
  }


  /* ---------- page layout: which sections show, in what order ---------- */

  var layout = resolveLayout_(draft.sections || [], setting, error, limited);

  function sectionOn(key) {
    var row = layout.byKey[key];
    return !row || row.enabled;
  }


  /* ---------- meeting ---------- */

  var meeting = null;

  // the meeting section wins: switched off, no session or topic can show it
  if (sectionOn('meeting')) {

    var day = contentDay_(setting('meeting.day'));
    var time = contentTime_(setting('meeting.time'));
    var duration = contentNumber_(setting('meeting.durationMinutes'));

    if (day === null) {
      error('الاجتماع', 'يوم الاجتماع مش مفهوم');
    }

    if (!time) {
      error('الاجتماع', 'ميعاد الاجتماع مطلوب بالشكل 20:00');
    }

    if (duration !== null && (isNaN(duration) || duration < 15 || duration > 600 || Math.round(duration) !== duration)) {
      error('الاجتماع', 'مدة الاجتماع لازم تكون عدد دقايق بين 15 و 600، أو تتساب فاضية');
    }

    var skipDates = [];

    contentDigits_(setting('meeting.skipDates'))
      .split(/[,،\s]+/)
      .filter(Boolean)
      .forEach(function (item) {
        var date = contentDateTime_(item, false);
        if (!date) {
          error('الاجتماع', 'تاريخ إلغاء مش مفهوم: ' + item);
          return;
        }
        var dateOnly = date.slice(0, 10);
        // past dates are irrelevant to visitors
        if (!now || dateOnly >= now.slice(0, 10)) {
          skipDates.push(dateOnly);
        }
      });

    meeting = {
      title: limited('الاجتماع', contentLine_(setting('meeting.title')), LIMITS.title, 'اسم الاجتماع') || 'الاجتماع',
      day: day,
      dayKey: day === null ? '' : DAY_KEYS[day],
      time: time || '',
      durationMinutes: duration === null || isNaN(duration) ? null : duration,
      note: limited('الاجتماع', contentLine_(setting('meeting.note')), LIMITS.note, 'ملاحظة الاجتماع'),
      skipDates: skipDates.sort(),
      ics: 'meeting.ics'
    };

  }


  /* ---------- location ---------- */

  var location = null;

  var locationName = contentLine_(setting('location.name'));

  if (locationName && sectionOn('location')) {

    var mapsUrl = contentLine_(setting('location.mapsUrl'));
    var safeMaps = safeHttpsUrl(mapsUrl);

    if (mapsUrl && !safeMaps) {
      error('المكان', 'رابط الخريطة لازم يبدأ بـ https://');
    }

    var lat = contentNumber_(setting('location.lat'));
    var lng = contentNumber_(setting('location.lng'));
    var hasCoords = lat !== null && lng !== null;

    if ((lat === null) !== (lng === null)) {
      error('المكان', 'لازم تكتب خط العرض وخط الطول مع بعض، أو تسيبهم فاضيين');
      hasCoords = false;
    }
    else if (hasCoords && (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)) {
      error('المكان', 'الإحداثيات مش صحيحة');
      hasCoords = false;
    }

    var destination = hasCoords
      ? lat + ',' + lng
      : locationName;

    location = {
      name: limited('المكان', locationName, LIMITS.title, 'اسم المكان'),
      address: limited('المكان', contentLine_(setting('location.address')), LIMITS.address, 'العنوان'),
      note: limited('المكان', contentLine_(setting('location.note')), LIMITS.note, 'ملاحظة المكان'),
      mapsUrl: safeMaps || ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(destination)),
      directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(destination),
      lat: hasCoords ? lat : null,
      lng: hasCoords ? lng : null
    };

  }


  /* ---------- announcement ---------- */

  var announcement = null;

  if (contentBool_(setting('announcement.enabled'))) {

    var text = contentText_(setting('announcement.text'));
    var expiresAt = contentDateTime_(setting('announcement.expiresAt'), true);
    var tone = contentLine_(setting('announcement.tone')).toLowerCase() || 'info';
    var linkUrl = contentLine_(setting('announcement.linkUrl'));
    var safeLink = safeHttpsUrl(linkUrl);

    if (!text) {
      error('الإعلان', 'الإعلان مفعّل بس مفيش نص');
    }

    limited('الإعلان', text, LIMITS.announcement, 'نص الإعلان');

    if (expiresAt === null) {
      error('الإعلان', 'تاريخ انتهاء الإعلان مش مفهوم');
    }

    if (ANNOUNCEMENT_TONES.indexOf(tone) === -1) {
      error('الإعلان', 'نوع الإعلان لازم يكون info أو alert أو celebrate');
    }

    if (linkUrl && !safeLink) {
      error('الإعلان', 'رابط الإعلان لازم يبدأ بـ https://');
    }

    var expired = expiresAt && now && expiresAt < now;

    if (expired) {
      warn('الإعلان', 'الإعلان انتهى ومش هيظهر');
    }
    else if (text) {
      announcement = {
        text: text.replace(/\n{3,}/g, '\n\n'),
        tone: tone,
        link: safeLink
          ? {
            url: safeLink,
            label: limited('الإعلان', contentLine_(setting('announcement.linkLabel')), LIMITS.linkLabel, 'نص زرار الإعلان') || 'التفاصيل'
          }
          : null,
        expiresAt: expiresAt || ''
      };
    }

  }


  /* ---------- sections ---------- */

  // link groups only; the other sections are checked in resolveLayout_
  var sectionRows = (draft.sections || [])
    .map(function (row, index) {
      return {
        key: contentLine_(row.key).toLowerCase(),
        kind: contentLine_(row.kind).toLowerCase() || 'links',
        title: contentLine_(row.title),
        order: contentNumber_(row.order),
        enabled: contentBool_(row.enabled),
        index: index
      };
    })
    .filter(function (row) { return row.kind === 'links'; });

  // null-prototype maps: keys like "constructor" or "__proto__" are just keys
  var sectionsByKey = Object.create(null);

  sectionRows.forEach(function (row) {

    // bad or repeated keys are reported once, by resolveLayout_
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(row.key) || sectionsByKey[row.key]) {
      return;
    }

    sectionsByKey[row.key] = row;

  });


  /* ---------- library images used outside the hub (scene photos, avatars) ---------- */

  var mediaById = mediaIndex_(draft.media);
  var extraMedia = [];

  /* one library image, or null (a missing one is a warning, not a blocker) */
  function libraryImage(id, where, label) {
    id = contentLine_(id);
    if (!id) return null;
    if (!mediaById[id]) {
      warn(where, label + ' "' + id + '" مش موجودة في المكتبة، ومش هتظهر');
      return null;
    }
    if (extraMedia.indexOf(id) === -1) extraMedia.push(id);
    return mediaById[id];
  }

  var videoById = videoIndex_(draft.media);

  /* one library video in a scene (item from parseGalleryToken_), or null;
     end 0 = to the end of the video */
  function libraryVideo(item, where) {
    var video = videoById[item.id];
    if (!video) {
      warn(where, 'فيديو المشهد "' + item.id + '" مش موجود في المكتبة، ومش هيظهر');
      return null;
    }
    var clipProblem = galleryClipProblem_(item);
    if (clipProblem) {
      warn(where, 'فيديو المشهد "' + item.id + '": ' + clipProblem + ' — هيشتغل من الأول');
    }
    if (extraMedia.indexOf(item.id) === -1) extraMedia.push(item.id);
    return {
      type: 'video',
      src: video.src,
      poster: video.poster,
      w: video.w,
      h: video.h,
      alt: video.alt,
      start: item.clip && !clipProblem ? item.start : 0,
      end: item.clip && !clipProblem ? item.end : 0
    };
  }


  /* ---------- links ---------- */

  var seenLinkIds = Object.create(null);
  var featured = [];
  var linksBySection = Object.create(null);

  sortRows_(draft.links || []).forEach(function (row) {

    if (!contentBool_(row.enabled)) {
      return;
    }

    // the featured block switched off: its links aren't published
    if (contentBool_(row.featured) && !sectionOn('featured')) {
      return;
    }

    var title = contentLine_(row.title);
    var where = 'الروابط: ' + (title || ('صف ' + (row.__index + 2)));
    var id = contentLine_(row.id);

    if (!id) {
      error(where, 'الرابط من غير id');
      return;
    }

    if (seenLinkIds[id]) {
      error(where, 'id متكرر: ' + id);
      return;
    }

    seenLinkIds[id] = true;

    var url = safeHttpsUrl(row.url);

    if (!title) {
      error(where, 'العنوان مطلوب');
    }

    if (!url) {
      error(where, 'الرابط لازم يكون كامل ويبدأ بـ https://');
    }

    var isFeatured = contentBool_(row.featured);
    var style = contentLine_(row.style).toLowerCase() || 'card';

    if (LINK_STYLES.indexOf(style) === -1) {
      error(where, 'الشكل لازم يكون card أو tile');
    }

    var icon = contentLine_(row.icon).toLowerCase() || 'link';

    if (ICON_NAMES.indexOf(icon) === -1) {
      warn(where, 'الأيقونة "' + icon + '" مش معروفة، هيتحط بدلها أيقونة رابط');
      icon = 'link';
    }

    var startAt = contentDateTime_(row.startAt, false);
    var endAt = contentDateTime_(row.endAt, true);

    if (startAt === null) {
      error(where, 'تاريخ البداية مش مفهوم');
    }

    if (endAt === null) {
      error(where, 'تاريخ النهاية مش مفهوم');
    }

    if (startAt && endAt && startAt > endAt) {
      error(where, 'تاريخ البداية بعد تاريخ النهاية');
    }

    var section = contentLine_(row.section).toLowerCase();

    if (!isFeatured) {
      if (!section) {
        error(where, 'لازم تختار قسم للرابط (أو تخليه مميز)');
      }
      else if (!sectionsByKey[section]) {
        error(where, layout.byKey[section]
          ? 'القسم "' + section + '" مش قسم روابط — اختار قسم روابط (زي social)'
          : 'القسم "' + section + '" مش موجود في شيت الأقسام');
      }
    }

    if (endAt && now && endAt < now) {
      warn(where, 'ميعاد الرابط خلص ومش هيظهر');
      return;
    }

    var link = {
      id: id,
      title: limited(where, title, LIMITS.title, 'العنوان'),
      subtitle: limited(where, contentLine_(row.subtitle), LIMITS.subtitle, 'الوصف'),
      url: url,
      icon: icon,
      style: style,
      badge: limited(where, contentLine_(row.badge), LIMITS.badge, 'الشارة'),
      startAt: startAt || '',
      endAt: endAt || ''
    };

    // a social link opens its short mini-experience first (site: xp.js)
    var experience = linkExperience_(row.experience, icon, url, where, warn);

    if (experience) {
      link.experience = experience;
    }

    // the scene's own photos (Media Library ids, comma separated); without
    // them the site uses our newest published posters. Only resolved for a
    // link that is really published (its images go public with it).
    // Videos (vid-…, optionally @start-end) play their clip in the scene.
    function withGallery() {
      if (!experience) return link;
      var gallery = galleryTokens_(row.gallery).slice(0, LIMITS.gallery)
        .map(function (token) {
          var item = parseGalleryToken_(token);
          if (!item) {
            warn(where, 'عنصر المشهد "' + token.slice(0, 40) + '" مش مفهوم، ومش هيظهر');
            return null;
          }
          return item.kind === 'video' ? libraryVideo(item, where) : libraryImage(item.id, where, 'صورة المشهد');
        })
        .filter(Boolean);
      if (gallery.length) link.gallery = gallery;
      return link;
    }

    if (isFeatured) {
      link.cta = limited(where, contentLine_(row.cta), LIMITS.cta, 'نص الزرار');
      featured.push(withGallery());
      return;
    }

    if (!sectionsByKey[section]) {
      return;
    }

    if (!sectionsByKey[section].enabled) {
      return;
    }

    (linksBySection[section] = linksBySection[section] || []).push(withGallery());

  });

  var sections = sortRows_(sectionRows.filter(function (row) {
    return row.enabled && sectionsByKey[row.key] === row && linksBySection[row.key];
  }))
    .map(function (row) {
      return {
        key: row.key,
        title: row.title,
        links: linksBySection[row.key]
      };
    });


  /* ---------- contacts ---------- */

  var seenContactIds = Object.create(null);
  var contacts = [];

  sortRows_(draft.contacts || []).forEach(function (row) {

    if (!contentBool_(row.enabled)) {
      return;
    }

    var name = contentLine_(row.name);
    var where = 'التواصل: ' + (name || ('صف ' + (row.__index + 2)));
    var id = contentLine_(row.id);

    if (!id) {
      error(where, 'جهة التواصل من غير id');
      return;
    }

    if (seenContactIds[id]) {
      error(where, 'id متكرر: ' + id);
      return;
    }

    seenContactIds[id] = true;

    var kind = contentLine_(row.kind).toLowerCase() || 'service';
    var method = contentLine_(row.method).toLowerCase();
    var phone = normalizePhone(row.phone);

    if (!name) {
      error(where, 'الاسم مطلوب');
    }

    if (CONTACT_KINDS.indexOf(kind) === -1) {
      error(where, 'النوع لازم يكون service أو support');
    }

    if (CONTACT_METHODS.indexOf(method) === -1) {
      error(where, 'طريقة التواصل لازم تكون call أو whatsapp');
    }

    if (!phone) {
      error(where, 'رقم التليفون مش صحيح');
      return;
    }

    var message = limited(where, contentText_(row.message), LIMITS.message, 'رسالة الواتساب');

    var action = method === 'whatsapp'
      ? {
        type: 'whatsapp',
        href: 'https://wa.me/' + phone.e164 + (message ? '?text=' + encodeURIComponent(message) : ''),
        label: 'واتساب'
      }
      : {
        type: 'call',
        href: 'tel:+' + phone.e164,
        label: 'اتصال'
      };

    contacts.push({
      id: id,
      kind: kind,
      name: limited(where, name, LIMITS.personName, 'الاسم'),
      role: limited(where, contentLine_(row.role), LIMITS.role, 'الدور'),
      description: limited(where, contentLine_(row.description), LIMITS.description, 'الوصف'),
      phoneDisplay: phone.display,
      action: action,
      // the person card's words (optional; the site has defaults)
      intro: limited(where, contentLine_(row.intro), LIMITS.contactIntro, 'جملة البداية'),
      reply: limited(where, contentText_(row.reply), LIMITS.contactReply, 'الرد'),
      _image: contentLine_(row.image),
      _where: where
    });

  });


  // the contact blocks switched off
  contacts = contacts.filter(function (contact) {
    return sectionOn(contact.kind === 'support' ? 'support' : 'contacts');
  });

  // avatars: only for the people really published
  contacts.forEach(function (contact) {
    var image = libraryImage(contact._image, contact._where, 'الصورة');
    if (image) contact.image = image;
    if (!contact.intro) delete contact.intro;
    if (!contact.reply) delete contact.reply;
    delete contact._image;
    delete contact._where;
  });


  /* ---------- hub: sessions, news, games, notifications (Hub.gs) ---------- */

  var hub = buildHub_(draft, {
    now: now,
    error: error,
    warn: warn,
    limited: limited,
    setting: setting,
    sections: { meeting: sectionOn('meeting'), news: sectionOn('news'), games: sectionOn('games') },
    sectionOn: sectionOn
  });

  // a cancelled session is a skipped date for the countdown and calendar
  if (meeting) {
    hub.cancelledDates.forEach(function (date) {
      if (meeting.skipDates.indexOf(date) === -1) {
        meeting.skipDates.push(date);
      }
    });
    meeting.skipDates.sort();
  }


  /* ---------- section banners (an item without a poster falls back to its section's) ---------- */

  var usedMedia = hub.usedMedia.slice();

  extraMedia.forEach(function (id) {
    if (usedMedia.indexOf(id) === -1) usedMedia.push(id);
  });
  var banners = Object.create(null);

  layout.rows.forEach(function (row) {
    if (!row.enabled || !row.banner) {
      return;
    }
    if (!mediaById[row.banner]) {
      error('الأقسام: ' + row.title, 'صورة البانر "' + row.banner + '" مش موجودة في المكتبة');
      return;
    }
    banners[row.key] = mediaById[row.banner];
    if (usedMedia.indexOf(row.banner) === -1) {
      usedMedia.push(row.banner);
    }
  });


  /* ---------- assemble ---------- */

  var content = {
    schema: CONTENT_SCHEMA_VERSION,
    revision: '',
    publishedAt: '',
    timezone: CONTENT_TIMEZONE,
    site: site,
    meeting: meeting,
    location: location,
    // legacy banner; new banners are pinned news items
    announcement: announcement,
    featured: featured,
    sections: sections,
    contacts: contacts,
    sessions: hub.sessions,
    news: hub.news,
    games: hub.games,
    notifications: hub.notifications,
    activities: hub.activities,
    types: hub.types,
    layout: publicLayout_(layout.rows, sections, banners)
  };

  if (options.hash) {
    content.revision = contentRevision(content, options.hash);
  }

  if (options.publishedAt) {
    content.publishedAt = options.publishedAt;
  }

  return {
    content: content,
    errors: errors,
    warnings: warnings,
    // Media ids the published content shows (their files go in the commit)
    media: usedMedia
  };

}


/* =========================================================
   LINKS
========================================================= */

/* the platform registry decides: explicit choice, then icon, then URL host;
   a plain website opens directly. 'none' switches it off. */
function linkExperience_(value, icon, url, where, warn) {

  var chosen = experienceKey_(value);

  if (chosen && chosen !== 'none' && chosen !== 'auto' && !PLATFORMS[chosen] && warn) {
    warn(where, 'التجربة "' + chosen + '" مش معروفة، هيظهر المشهد العام');
  }

  return resolveExperience_({ experience: value, icon: icon, url: url || '' }, PLATFORMS);

}


/* =========================================================
   PAGE LAYOUT
========================================================= */

function builtinSection_(key) {

  return BUILTIN_SECTIONS.filter(function (b) { return b.key === key; })[0] || null;

}


/**
 * Where a built-in section goes when its row doesn't exist yet: around the
 * link groups exactly like the page always looked. The data upgrade
 * (Migrate.gs) writes these same numbers into the new rows.
 */
function builtinOrder_(key, firstLinks, lastLinks) {

  var before = BUILTIN_SECTIONS.filter(function (b) { return b.place === 'before'; }).map(function (b) { return b.key; });
  var after = BUILTIN_SECTIONS.filter(function (b) { return b.place === 'after'; }).map(function (b) { return b.key; });
  var i = before.indexOf(key);

  if (i !== -1) {
    return Math.round((firstLinks - (before.length - i) * 0.1) * 100) / 100;
  }

  return lastLinks + (after.indexOf(key) + 1) * 10;

}


/**
 * Sections rows -> { rows: [...ordered], byKey }.
 * Built-in sections missing from the Sheet (before the data upgrade) are
 * filled in where the page always had them; the meeting block then follows
 * the old "meeting.enabled" setting.
 */
function resolveLayout_(rows, setting, error, limited) {

  var byKey = Object.create(null);
  var list = [];

  rows.forEach(function (row, index) {

    var key = contentLine_(row.key).toLowerCase();
    var kind = contentLine_(row.kind).toLowerCase() || 'links';
    var title = contentLine_(row.title);
    var where = 'الأقسام: ' + (title || key || ('صف ' + (index + 2)));

    if (!/^[a-z][a-z0-9-]{0,30}$/.test(key)) {
      error(where, 'مفتاح القسم لازم يكون حروف إنجليزي صغيرة وأرقام وشرطة (مثلاً social)');
      return;
    }

    if (byKey[key]) {
      error(where, 'مفتاح القسم متكرر: ' + key);
      return;
    }

    if (SECTION_KINDS.indexOf(kind) === -1) {
      error(where, 'نوع القسم مش معروف: ' + kind);
      return;
    }

    var builtin = builtinSection_(key);

    if (builtin && builtin.kind !== kind) {
      error(where, 'القسم "' + key + '" نوعه لازم يكون ' + builtin.kind);
      return;
    }

    if (!builtin && kind !== 'links' && kind !== 'items') {
      error(where, 'النوع ' + kind + ' بيتعمل منه قسم واحد بس (' + kind + ')');
      return;
    }

    if (kind === 'links' && !title) {
      error(where, 'عنوان القسم مطلوب');
    }

    var from = contentDateTime_(row.visibleFrom, false);
    var until = contentDateTime_(row.visibleUntil, true);

    if (from === null) {
      error(where, 'ميعاد الظهور مش مفهوم');
    }

    if (until === null) {
      error(where, 'ميعاد الاختفاء مش مفهوم');
    }

    if (from && until && from > until) {
      error(where, 'ميعاد الظهور بعد ميعاد الاختفاء');
    }

    var theme = contentLine_(row.theme).toLowerCase();

    if (theme && SECTION_THEMES.indexOf(theme) === -1) {
      error(where, 'الشكل "' + theme + '" مش معروف');
      theme = '';
    }

    var icon = contentLine_(row.icon).toLowerCase();

    // «شكل الخلفية»: a whitelist; '' = automatic, the phone one '' = same as the computer
    var surface = contentLine_(row.surface).toLowerCase();
    var surfaceMobile = contentLine_(row.surfaceMobile).toLowerCase();

    if (surface && SECTION_SURFACES.indexOf(surface) === -1) {
      error(where, 'شكل الخلفية "' + surface + '" مش معروف');
      surface = '';
    }

    if (surfaceMobile && SECTION_SURFACES.indexOf(surfaceMobile) === -1) {
      error(where, 'شكل الخلفية على الموبايل "' + surfaceMobile + '" مش معروف');
      surfaceMobile = '';
    }

    var entry = {
      key: key,
      kind: kind,
      title: limited(where, title || (builtin ? builtin.title : ''), LIMITS.sectionTitle, 'عنوان القسم'),
      subtitle: limited(where, contentLine_(row.subtitle), LIMITS.subtitle, 'وصف القسم'),
      icon: ICON_NAMES.indexOf(icon) !== -1 ? icon : '',
      theme: theme,
      banner: contentLine_(row.banner),
      surface: surface,
      surfaceMobile: surfaceMobile,
      enabled: contentBool_(row.enabled),
      visibleFrom: from || '',
      visibleUntil: until || '',
      order: contentNumber_(row.order),
      index: index,
      virtual: false
    };

    byKey[key] = entry;
    list.push(entry);

  });

  var linkOrders = list
    .filter(function (r) { return r.kind === 'links' && r.order !== null && !isNaN(r.order); })
    .map(function (r) { return r.order; });
  var firstLinks = linkOrders.length ? Math.min.apply(null, linkOrders) : 10;
  var lastLinks = linkOrders.length ? Math.max.apply(null, linkOrders) : 20;

  BUILTIN_SECTIONS.forEach(function (b, i) {
    if (byKey[b.key]) {
      return;
    }
    var entry = {
      key: b.key,
      kind: b.kind,
      title: b.title,
      subtitle: '',
      icon: '',
      theme: '',
      banner: '',
      surface: '',
      surfaceMobile: '',
      enabled: b.key === 'meeting' ? contentBool_(setting('meeting.enabled')) : true,
      visibleFrom: '',
      visibleUntil: '',
      order: builtinOrder_(b.key, firstLinks, lastLinks),
      index: 10000 + i,
      virtual: true
    };
    byKey[b.key] = entry;
    list.push(entry);
  });

  list.sort(function (a, b) {
    var x = a.order === null || isNaN(a.order) ? Infinity : a.order;
    var y = b.order === null || isNaN(b.order) ? Infinity : b.order;
    return x === y ? a.index - b.index : (x < y ? -1 : 1);
  });

  return { rows: list, byKey: byKey };

}


/* What the site gets: switched-on sections in order. A link group without
   published links is left out; its time window travels with it. */
function publicLayout_(rows, linkSections, banners) {

  var withLinks = Object.create(null);

  linkSections.forEach(function (section) { withLinks[section.key] = true; });

  return rows
    .filter(function (row) { return row.enabled && (row.kind !== 'links' || withLinks[row.key]); })
    .map(function (row) {
      var entry = {
        key: row.key,
        kind: row.kind,
        title: row.title,
        subtitle: row.subtitle,
        icon: row.icon,
        theme: row.theme,
        banner: (banners && banners[row.key]) || null,
        visibleFrom: row.visibleFrom,
        visibleUntil: row.visibleUntil
      };
      // «شكل الخلفية» (schema-5 data): only when chosen, so older pages stay byte-identical
      if (row.surface) entry.surface = row.surface;
      if (row.surfaceMobile) entry.surfaceMobile = row.surfaceMobile;
      return entry;
    });

}


/* Stable rows order: by "order", then by original position. */
function sortRows_(rows) {

  return rows
    .map(function (row, index) {
      var copy = {};
      for (var key in row) {
        copy[key] = row[key];
      }
      copy.__index = row.__index === undefined ? (row.index === undefined ? index : row.index) : row.__index;
      var order = contentNumber_(row.order);
      copy.__order = order === null || isNaN(order) ? Infinity : order;
      return copy;
    })
    .sort(function (a, b) {
      return a.__order === b.__order ? a.__index - b.__index : (a.__order < b.__order ? -1 : 1);
    });

}


/**
 * Hash of everything a visitor can see. Used to detect unpublished changes
 * and as the cache key on the public site. publishedAt is excluded so
 * re-publishing identical content keeps the same revision.
 */
function contentRevision(content, hash) {

  var copy = JSON.parse(JSON.stringify(content));

  delete copy.revision;
  delete copy.publishedAt;

  return hash(JSON.stringify(copy)).slice(0, 12);

}


/* =========================================================
   CALENDAR (meeting.ics)
========================================================= */

function icsEscape_(text) {

  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');

}


/* Fold lines at 75 octets without splitting UTF-8 characters (RFC 5545 3.1). */
function icsFold_(line) {

  var out = [];
  var current = '';
  var bytes = 0;

  for (var i = 0; i < line.length; i++) {

    var ch = line[i];
    var code = line.charCodeAt(i);

    // keep surrogate pairs together
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < line.length) {
      ch += line[++i];
    }

    var size = encodeURIComponent(ch).replace(/%[0-9A-F]{2}/gi, 'x').length;
    var limit = out.length === 0 ? 75 : 74;

    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }

    current += ch;
    bytes += size;

  }

  out.push(current);

  return out.join('\r\n ');

}


/**
 * Weekly recurring event in Africa/Cairo.
 * today = 'YYYY-MM-DD' (Cairo), stamp = 'YYYYMMDDTHHMMSSZ' (UTC), siteUrl optional.
 * Returns '' when there is no usable meeting.
 */
function buildMeetingIcs(content, today, stamp, siteUrl) {

  var meeting = content.meeting;

  if (!meeting || meeting.day === null || !meeting.time) {
    return '';
  }

  // first occurrence on or after today
  var parts = today.split('-').map(Number);
  var start = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));

  while (start.getUTCDay() !== meeting.day) {
    start.setUTCDate(start.getUTCDate() + 1);
  }

  var hm = meeting.time.split(':');

  function stampOf(date, hours, minutes) {
    return date.getUTCFullYear() + pad2_(date.getUTCMonth() + 1) + pad2_(date.getUTCDate()) +
      'T' + pad2_(hours) + pad2_(minutes) + '00';
  }

  var startStamp = stampOf(start, Number(hm[0]), Number(hm[1]));
  var byDay = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][meeting.day];

  var description = [meeting.note, content.site.name].filter(Boolean).join('\n');

  var lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//St Athanasius Safaga//Portal//AR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Africa/Cairo',
    'BEGIN:STANDARD',
    // Egypt: DST ends at the end of the last Thursday of October
    'DTSTART:20231026T235959',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1TH',
    'TZOFFSETFROM:+0300',
    'TZOFFSETTO:+0200',
    'TZNAME:EET',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    // and starts at the beginning of the last Friday of April
    'DTSTART:20230428T000000',
    'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=-1FR',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0300',
    'TZNAME:EEST',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:weekly-meeting@st-athanasius-safaga',
    'DTSTAMP:' + stamp,
    'DTSTART;TZID=Africa/Cairo:' + startStamp
  ];

  if (meeting.durationMinutes) {
    lines.push('DURATION:PT' + meeting.durationMinutes + 'M');
  }

  lines.push('RRULE:FREQ=WEEKLY;BYDAY=' + byDay);

  (meeting.skipDates || []).forEach(function (date) {
    var p = date.split('-').map(Number);
    lines.push('EXDATE;TZID=Africa/Cairo:' + stampOf(new Date(Date.UTC(p[0], p[1] - 1, p[2])), Number(hm[0]), Number(hm[1])));
  });

  lines.push('SUMMARY:' + icsEscape_(meeting.title + ' — ' + content.site.name));

  if (description) {
    lines.push('DESCRIPTION:' + icsEscape_(description));
  }

  if (content.location) {
    lines.push('LOCATION:' + icsEscape_([content.location.name, content.location.address].filter(Boolean).join('، ')));
    if (content.location.lat !== null) {
      lines.push('GEO:' + content.location.lat + ';' + content.location.lng);
    }
  }

  if (siteUrl) {
    lines.push('URL:' + siteUrl);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.map(icsFold_).join('\r\n') + '\r\n';

}
