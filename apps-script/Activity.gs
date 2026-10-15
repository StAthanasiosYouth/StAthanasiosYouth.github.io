/**
 * ADMIN DISPLAY NAMES + THE ACTIVITY LOG («سجل النشاط»)
 *
 * Who did it is ALWAYS currentEmail_() (Auth.gs): the verified Google ID
 * token's email in the API, the Google session in the recovery admin. The
 * page never says who it is; nothing it sends names an actor.
 *
 * Display names («مينا زكريا») are only how an admin is shown: in presence,
 * edit locks, this log and admin notifications. They live in the Script
 * Property ADMIN_NAMES (JSON { email: name }), next to the allowlist
 * (ADMIN_EMAILS), where only script editors can touch them — never in the
 * Sheet, which may be shared. Any admin may rename any admin
 * (apiSetAdminName); every rename is logged. Two admins can never look the
 * same: a name is refused when it matches (ignoring spaces, case and Arabic
 * letter variants) another admin's name or the fallback (the email's local
 * part) another admin is shown with. Invisible and direction-changing
 * characters are removed.
 *
 * The Activity tab: one row per meaningful, completed action (a save, a
 * delete, a publish, a push send...), never reads, previews, heartbeats,
 * drafts or sign-ins. The technical Log tab (Store.gs log_) stays as it is.
 *
 *   id          act-<12 hex>, stable
 *   at          epoch ms (sorting)
 *   cairo       "2026-10-11 15:04" (Africa/Cairo)
 *   actor       the server-side email
 *   actorName   the display name at that time (kept for removed admins)
 *   action      create | update | delete | archive | unarchive | enable |
 *               disable | duplicate | reorder | settings | publish | push |
 *               upload | media.update | media.delete | media.restore |
 *               media.purge | import | live.stage | admin.add |
 *               admin.remove | admin.rename | migrate | session.takeover
 *   entityType  sessions | news | games | activities | notifications |
 *               types | links | sections | contacts | settings | media |
 *               site | admins | data | session
 *   entityId / entityTitle   the item (title as it was)
 *   summary     Arabic, WITHOUT the actor («عدّل اجتماع الأحد ١٢ أكتوبر»);
 *               the page puts the current display name in front
 *   changes     small JSON (≤ 1 KB): changed field labels, a few titles,
 *               counts — never a copy of the item
 *   ref         revision + commit, a push's notification id...
 *   count       saves merged into this row
 *   notified    admin devices notified, or why not (cooldown, none, ...)
 *   device      the actor's device label (API sessions)
 *
 * Merging: the same admin repeating a small action on the same thing
 * within ACTIVITY_MERGE_MS updates the row instead of adding one (a create
 * then edits stays «أضاف»; arrow clicks become one «رتّب»).
 * Retention: ACTIVITY_MAX_ROWS rows and ACTIVITY_MAX_DAYS days, trimmed
 * from the top in chunks.
 *
 * Writing a row NEVER fails the action it describes: every error is
 * caught and only reported to the execution log.
 *
 * Admin push (AdminNotify.gs) is decided here; in an admin request it is
 * sent after the reply, by the next heartbeat (activityPending_: DEFERRED
 * ADMIN PUSH below), elsewhere at once (activityDispatch_):
 *   now        publish, create/delete of meetings, news, games,
 *              activities, notifications; a public push send; import;
 *              admin add / remove
 *   cooldown   edits of those; links, sections, contacts (any change);
 *              settings — at most one per (admin, item) every
 *              ACTIVITY_COOLDOWN_MS
 *   never      everything else (reorder, show/hide, archive, duplicate,
 *              media, types, live stage, renames, upgrades, takeovers,
 *              an unchanged publish)
 * plus at most ACTIVITY_ACTOR_MAX pushes per admin per
 * ACTIVITY_ACTOR_WINDOW_MS (publish, push sends and admin changes always
 * go), never to the actor's own devices, never to an
 * admin who has the panel open right now (they get an in-panel toast from
 * their heartbeat instead: activitySince_).
 */

var ACTIVITY_SHEET = 'Activity';
var ACTIVITY_COLUMNS = ['id', 'at', 'cairo', 'actor', 'actorName', 'action', 'entityType', 'entityId', 'entityTitle', 'summary', 'changes', 'ref', 'count', 'notified', 'device'];
var ACTIVITY_MAX_ROWS = 5000;
var ACTIVITY_TRIM_SLACK = 250;
var ACTIVITY_MAX_DAYS = 365;
var ACTIVITY_MERGE_MS = 10 * 60000;
var ACTIVITY_MERGE_LOOKBACK = 15;
var ACTIVITY_PAGE = 50;
var ACTIVITY_PAGE_MAX = 100;
var ACTIVITY_CHUNK = 400;
var ACTIVITY_RECENT = 30;
var ACTIVITY_RECENT_KEY = 'adm:act:recent';
var ACTIVITY_TRIM_KEY = 'adm:act:trim';
var ACTIVITY_CHANGES_MAX = 1000;
var ACTIVITY_TITLE_MAX = 80;
var ACTIVITY_COOLDOWN_MS = 30 * 60000;
var ACTIVITY_ACTOR_WINDOW_MS = 10 * 60000;
var ACTIVITY_ACTOR_MAX = 6;
var ADMIN_NAME_MIN = 2;
var ADMIN_NAME_MAX = 40;

var ACTIVITY_ACTIONS = ['create', 'update', 'delete', 'archive', 'unarchive', 'enable', 'disable', 'duplicate', 'reorder', 'settings',
  'publish', 'push', 'upload', 'media.update', 'media.delete', 'media.restore', 'media.purge', 'import', 'live.stage',
  'admin.add', 'admin.remove', 'admin.rename', 'migrate', 'session.takeover',
  // competitions (docs/COMPETITIONS.md §11): never a code, a phone or an answer in `changes`
  'review', 'finalize', 'regrade', 'close', 'code.view', 'code.reset', 'code.export', 'participant.phone', 'points.adjust', 'redemption.status'];

var ACTIVITY_TYPES = ['sessions', 'news', 'games', 'activities', 'notifications', 'types', 'links', 'sections', 'contacts',
  'settings', 'media', 'site', 'admins', 'data', 'session',
  'competition', 'participant', 'points', 'shopitem', 'redemption',
  // service pages, events, servants (Pages.gs): never a phone in `changes`
  'page', 'event', 'servant'];

/* small, repeatable actions: merged into the admin's last row for the same thing */
var ACTIVITY_MERGEABLE = ['update', 'reorder', 'settings', 'enable', 'disable', 'media.update', 'live.stage', 'review', 'code.view'];

/* the content people see: create/delete notify now, edits with a cooldown */
var ACTIVITY_CONTENT = ['sessions', 'news', 'games', 'activities', 'notifications', 'competition', 'page', 'event'];
var ACTIVITY_PAGE_PARTS = ['links', 'sections', 'contacts'];

/*
 * The filters of «سجل النشاط»: a family of actions, a part of the panel.
 */
var ACTIVITY_FAMILIES = {
  add: ['create', 'upload', 'import', 'duplicate'],
  edit: ['update', 'settings', 'reorder', 'enable', 'disable', 'archive', 'unarchive', 'media.update', 'media.restore', 'live.stage',
    'review', 'finalize', 'regrade', 'close', 'code.view', 'code.reset', 'code.export', 'participant.phone', 'points.adjust', 'redemption.status'],
  remove: ['delete', 'media.delete', 'media.purge'],
  publish: ['publish'],
  push: ['push'],
  admins: ['admin.add', 'admin.remove', 'admin.rename', 'migrate', 'session.takeover']
};

var ACTIVITY_SECTIONS = {
  sessions: ['sessions'],
  news: ['news'],
  games: ['games'],
  activities: ['activities', 'types'],
  notifications: ['notifications'],
  page: ['links', 'sections', 'contacts', 'settings'],
  media: ['media'],
  site: ['site', 'data'],
  admins: ['admins', 'session'],
  competitions: ['competition', 'participant', 'points', 'shopitem', 'redemption'],
  pages: ['page', 'event', 'servant']
};

/* how each kind of thing is named: the (title), a new one, several */
var ACTIVITY_NOUNS = {
  page: { one: 'صفحة الخدمة', fresh: 'صفحة خدمة جديدة', many: 'صفحات الخدمة' },
  event: { one: 'الفعالية', fresh: 'فعالية جديدة', many: 'الفعاليات' },
  servant: { one: 'الخادم', fresh: 'خادم جديد', many: 'الخدام' },
  competition: { one: 'المسابقة', fresh: 'مسابقة جديدة', many: 'المسابقات' },
  participant: { one: 'المشترك', fresh: 'مشترك جديد', many: 'المشتركين' },
  points: { one: 'نقاط', fresh: 'نقاط', many: 'النقاط' },
  shopitem: { one: 'الجايزة', fresh: 'جايزة جديدة', many: 'الجوايز' },
  redemption: { one: 'طلب الجايزة', fresh: 'طلب جايزة', many: 'طلبات الجوايز' },
  sessions: { one: 'الاجتماع', fresh: 'اجتماع جديد', many: 'الاجتماعات' },
  news: { one: 'الخبر', fresh: 'خبر جديد', many: 'الأخبار' },
  games: { one: 'اللعبة', fresh: 'لعبة جديدة', many: 'الألعاب' },
  competitions: { one: 'المسابقة', fresh: 'مسابقة جديدة', many: 'المسابقات' },
  activities: { one: 'الفعالية', fresh: 'فعالية جديدة', many: 'الفعاليات' },
  notifications: { one: 'الإشعار', fresh: 'إشعار جديد', many: 'الإشعارات' },
  types: { one: 'النوع', fresh: 'نوع جديد', many: 'الأنواع' },
  links: { one: 'الرابط', fresh: 'رابط جديد', many: 'الروابط' },
  sections: { one: 'القسم', fresh: 'قسم جديد', many: 'أقسام الصفحة' },
  contacts: { one: 'جهة التواصل', fresh: 'جهة تواصل جديدة', many: 'أرقام التواصل' },
  media: { one: 'الصورة', fresh: 'صورة جديدة', many: 'الصور' },
  video: { one: 'الفيديو', fresh: 'فيديو جديد', many: 'الفيديوهات' }
};

/* the fields an edit names (only these; the rest is «تفاصيل تانية») */
var ACTIVITY_FIELDS = {
  title: 'العنوان', topic: 'الموضوع', name: 'الاسم', label: 'الاسم', date: 'التاريخ', time: 'الميعاد', speaker: 'الخادم',
  description: 'الوصف', subtitle: 'الوصف القصير', summary: 'الملخص', body: 'التفاصيل', message: 'النص', note: 'الملاحظة',
  image: 'الصورة', banner: 'البانر', gallery: 'الصور', url: 'الرابط', linkUrl: 'الرابط', ctaLabel: 'الزرار', buttonLabel: 'الزرار',
  cta: 'الزرار', linkLabel: 'الزرار', location: 'المكان', program: 'البرنامج', status: 'الحالة', enabled: 'الظهور',
  publishAt: 'ميعاد الظهور', expireAt: 'ميعاد الاختفاء', visibleFrom: 'يظهر من', visibleUntil: 'يختفي بعد', startAt: 'البداية',
  endAt: 'النهاية', durationMinutes: 'المدة', phone: 'الرقم', role: 'الدور', method: 'طريقة التواصل', icon: 'الأيقونة',
  theme: 'الشكل', badge: 'الشارة', section: 'القسم', type: 'النوع', target: 'بيفتح', featured: 'مميز', pinned: 'متثبت',
  tone: 'اللون', display: 'العرض', displayMobile: 'العرض على الموبايل', style: 'الشكل', experience: 'التجربة',
  afterEnd: 'بعد النهاية', intro: 'المقدمة', reply: 'الرد', surface: 'الخلفية', surfaceMobile: 'الخلفية على الموبايل',
  notifyTemplate: 'نص الإشعار', ctaDefault: 'الزرار', alt: 'وصف الصورة'
};

var ACTIVITY_IGNORED_FIELDS = ['updatedAt', 'order', 'id', 'key', '__row', 'index', 'archived', 'originalDate', 'isNew', 'notify'];

/* settings keys → the group an edit is named by */
var ACTIVITY_SETTING_GROUPS = [
  [/^site\./, 'الموقع'],
  [/^location\./, 'المكان'],
  [/^notifications\.|^games\./, 'المحتوى'],
  [/^meeting\./, 'الاجتماع الأسبوعي'],
  [/^announcement\./, 'الإعلان'],
  [/^contact/, 'التواصل']
];

/* the groups a set of changed settings keys belongs to: «الموقع والمكان» */
function settingsGroups_(keys) {

  var groups = [];

  keys.forEach(function (key) {
    var match = ACTIVITY_SETTING_GROUPS.filter(function (g) { return g[0].test(key); })[0];
    var label = match ? match[1] : 'الموقع';
    if (groups.indexOf(label) === -1) groups.push(label);
  });

  return groups.join(' و');

}

var ACTIVITY_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
var ACTIVITY_DAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];

/* this request's pending rows (mutate_) and pushes to send (doPost) */
var ACTIVITY_NOTES_ = [];
var ACTIVITY_QUEUE_ = [];


/* =========================================================
   DISPLAY NAMES
========================================================= */

/* invisible / direction-changing characters, control characters */
var ADMIN_NAME_STRIP = /[\u0000-\u001f\u007f-\u009f­؜ᅟᅠ᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;

function cleanDisplayName_(value) {

  return String(value === null || value === undefined ? '' : value)
    .normalize('NFC')
    .replace(ADMIN_NAME_STRIP, '')
    .replace(/\s+/g, ' ')
    .trim();

}

/* what two names are compared by: no spaces/marks/tatweel, one form per Arabic letter, lower case */
function nameKey_(value) {

  return cleanDisplayName_(value)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\s._\-'"«»()]/g, '');

}

/* the stored names of the admins on the list now: { email: name } */
function adminNames_() {

  if (API_REQUEST_ && API_REQUEST_.names) {
    return API_REQUEST_.names;
  }

  var raw = PropertiesService.getScriptProperties().getProperty('ADMIN_NAMES');
  var parsed = null;
  var names = {};

  try {
    parsed = raw ? JSON.parse(raw) : null;
  }
  catch (ignored) {
    parsed = null;
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    Object.keys(parsed).forEach(function (key) {
      var email = normalizeEmail_(key);
      var name = cleanDisplayName_(parsed[key]).slice(0, ADMIN_NAME_MAX);
      if (email && name.length >= ADMIN_NAME_MIN) names[email] = name;
    });
  }

  if (API_REQUEST_) {
    API_REQUEST_.names = names;
  }

  return names;

}

function forgetAdminNames_() {

  if (API_REQUEST_) {
    API_REQUEST_.names = null;
  }

}

function writeAdminNames_(names) {

  var keep = {};

  Object.keys(names).sort().forEach(function (email) {
    if (names[email]) keep[email] = names[email];
  });

  PropertiesService.getScriptProperties().setProperty('ADMIN_NAMES', JSON.stringify(keep));
  forgetAdminNames_();

}

/* how an admin is shown: the display name, else the email's local part */
function displayName_(email) {

  email = String(email || '').toLowerCase();

  return adminNames_()[email] || email.split('@')[0] || '';

}

/* { email: shown name } for every admin on the list */
function adminDirectory_() {

  var names = {};

  adminEmails_().forEach(function (email) {
    names[email] = displayName_(email);
  });

  return names;

}


/** Sets (or clears, with '') an admin's display name. Any admin may rename any admin. */
function apiSetAdminName(value, name) {

  var me = assertAdmin_();
  var email = normalizeEmail_(value);
  var clean = cleanDisplayName_(name);

  if (!email) {
    throw appError_('الإيميل ده مش مكتوب صح.', '');
  }

  if (clean && (clean.length < ADMIN_NAME_MIN || clean.length > ADMIN_NAME_MAX)) {
    throw appError_('الاسم لازم يكون من ' + ADMIN_NAME_MIN + ' لـ ' + ADMIN_NAME_MAX + ' حرف.', 'مثلاً: مينا زكريا', '', 'الاسم');
  }

  if (clean && (/[@<>{}\[\]\\\/|`=]/.test(clean) || !/[A-Za-zء-ي]/.test(clean))) {
    throw appError_('الاسم ده مش مقبول.', 'اكتب الاسم بالحروف العربي أو الإنجليزي، من غير إيميل أو رموز.', '', 'الاسم');
  }

  var lock = LockService.getScriptLock();
  var before = '';

  lock.waitLock(20000);

  try {

    forgetAdminEmails_();
    forgetAdminNames_();

    var emails = adminEmails_();

    if (emails.indexOf(email) === -1) {
      throw appError_('الإيميل ده مش في القايمة.', 'اعمل Refresh للصفحة.');
    }

    var names = {};
    var stored = adminNames_();
    Object.keys(stored).forEach(function (key) { names[key] = stored[key]; });
    before = displayName_(email);

    if (clean) {
      var key = nameKey_(clean);
      var taken = emails.some(function (other) {
        if (other === email) return false;
        return nameKey_(displayName_(other)) === key || nameKey_(other.split('@')[0]) === key;
      });
      if (taken) {
        throw appError_('الاسم ده مستخدم لأدمن تاني.', 'كل أدمن لازم يكون له اسم مختلف علشان محدش يتلخبط.', '', 'الاسم');
      }
    }

    if ((names[email] || '') === clean) {
      return adminList_(me);
    }

    if (clean) names[email] = clean;
    else delete names[email];

    writeAdminNames_(names);

    activity_({
      action: 'admin.rename', type: 'admins', id: email, title: email,
      changes: { from: before, to: displayName_(email) }
    });

  }
  finally {
    lock.releaseLock();
  }

  return adminList_(me);

}

/* an admin left the list: their name goes too (Auth.gs apiRemoveAdmin) */
function forgetAdminName_(email) {

  var stored = adminNames_();

  if (!stored[email]) return;

  var names = {};
  Object.keys(stored).forEach(function (key) { if (key !== email) names[key] = stored[key]; });
  writeAdminNames_(names);

}


/* =========================================================
   WRITING A ROW
========================================================= */

/* the Activity tab (made on first use: plain text, frozen header) */
function activitySheet_() {

  return pushSheet_(ACTIVITY_SHEET, ACTIVITY_COLUMNS);

}

function activityText_(value, max) {

  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

}

/* a cell back as written (plainCell_ puts a ' in front of =+-@) */
function activityCell_(value) {

  var text = String(value === null || value === undefined ? '' : value);

  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;

}

function activityDigits_(value) {

  return String(value).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; });

}

/* "2026-10-11" → «الأحد ١١ أكتوبر» */
function activityDay_(date) {

  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));

  if (!m) return activityText_(date, 30);

  var day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();

  return ACTIVITY_DAYS[day] + ' ' + activityDigits_(+m[3]) + ' ' + ACTIVITY_MONTHS[+m[2] - 1];

}

function activityCairo_(ms) {

  return Utilities.formatDate(new Date(ms), CONTENT_TIMEZONE, 'yyyy-MM-dd HH:mm');

}

/* the noun of a thing: competitions and other activities by their type's section */
function activityNoun_(type, sub) {

  if (type === 'activities' && sub === 'competitions') return ACTIVITY_NOUNS.competitions;
  if (type === 'media' && sub === 'video') return ACTIVITY_NOUNS.video;

  return ACTIVITY_NOUNS[type] || { one: '', fresh: '', many: '' };

}

/* «الخبر «…»», «اجتماع الأحد ١١ أكتوبر» */
function activityThing_(type, title, sub) {

  if (type === 'sessions') {
    return 'اجتماع ' + activityDay_(title);
  }

  var noun = activityNoun_(type, sub).one;
  var name = activityText_(title, ACTIVITY_TITLE_MAX);

  return name ? (noun ? noun + ' «' + name + '»' : '«' + name + '»') : noun;

}

/* the Arabic sentence, without who did it */
function activitySummary_(entry) {

  var type = entry.type;
  var sub = entry.sub;
  var title = entry.title;
  var changes = entry.changes || {};
  var thing = activityThing_(type, title, sub);
  var noun = activityNoun_(type, sub);
  var quoted = function (text) { return '«' + activityText_(text, ACTIVITY_TITLE_MAX) + '»'; };

  switch (entry.action) {
    case 'create':
      if (type === 'sessions') return 'أضاف ' + thing;
      return 'أضاف ' + noun.fresh + (title ? ' ' + quoted(title) : '');
    case 'update':
      if (type === 'participant' && changes.bulk) return 'غيّر ' + ({ servant: 'الخادم المسؤول', group: 'المجموعة' }[changes.field] || 'بيانات') + ' لـ ' + activityDigits_(changes.bulk) + ' مشترك';
      return 'عدّل ' + thing;
    case 'delete': return type === 'participant' && changes.undoImport ? 'لغى استيراد ' + activityDigits_(changes.undoImport) + ' مشترك' : 'مسح ' + thing;
    case 'archive': return 'أرشف ' + thing;
    case 'unarchive': return 'رجّع ' + thing + ' من الأرشيف';
    case 'enable': return (type === 'participant' ? 'فعّل ' : 'أظهر ') + thing;
    case 'disable': return (type === 'participant' ? 'وقّف ' : 'أخفى ') + thing;
    case 'duplicate': return 'عمل نسخة من ' + thing;
    case 'reorder': return 'رتّب ' + (noun.many || 'العناصر');
    case 'settings': return 'غيّر إعدادات ' + (title || 'الموقع');
    case 'publish': return changes.unchanged ? 'نشر من غير تغييرات جديدة' : 'نشر تحديث الموقع';
    case 'push': return 'أرسل إشعار ' + quoted(title) + (changes.sent !== undefined ? ' لـ ' + activityDigits_(changes.sent) + ' جهاز' : '');
    case 'upload': return 'رفع ' + noun.fresh + (title ? ' ' + quoted(title) : '');
    case 'media.update': return 'عدّل بيانات ' + thing;
    case 'media.delete': return 'رمى ' + thing + ' في سلة المحذوفات';
    case 'media.restore': return 'رجّع ' + thing + ' من سلة المحذوفات';
    case 'media.purge': return 'مسح ' + thing + ' نهائيًا';
    case 'import':
      if (type === 'competition') return 'استورد ' + activityDigits_(changes.added || 0) + ' سؤال في ' + thing;
      if (type === 'participant') return 'استورد ' + activityDigits_(changes.added || 0) + ' مشترك' + (changes.updated || changes.phone ? ' (' + activityDigits_((changes.updated || 0) + (changes.phone || 0)) + ' اتعدّلوا)' : '');
      return 'استورد اجتماعات من ملف (' + activityDigits_(changes.added || 0) + ' جديد، ' + activityDigits_(changes.updated || 0) + ' متعدّل)';
    case 'review':
      if (changes['void'] === true) return 'لغى مشاركة في ' + thing;
      if (changes['void'] === false) return 'رجّع مشاركة في ' + thing;
      return 'راجع ' + activityDigits_(changes.answers || 1) + ' إجابة' + (changes.q ? ' في ' + activityText_(changes.q, 10) : '') + ' في ' + thing;
    case 'finalize': return changes.undo ? 'رجّع اعتماد نتايج ' + thing : 'اعتمد نتايج ' + thing;
    case 'regrade': return 'صحّح ' + thing + ' تاني (' + activityDigits_(changes.changed || 0) + ' مشاركة اتغيرت)';
    case 'close': return changes.reopen ? 'فتح ' + thing + ' تاني' : 'قفل ' + thing;
    case 'code.view': return 'شاف كود ' + quoted(title);
    case 'code.reset': return changes.count ? 'عمل أكواد جديدة لـ ' + activityDigits_(changes.count) + ' مشترك' : 'عمل كود جديد لـ ' + quoted(title);
    case 'code.export': return 'صدّر أكواد (' + activityDigits_(changes.count || 0) + ')';
    case 'participant.phone': return 'غيّر رقم ' + quoted(title);
    case 'points.adjust': if (changes.sync) return 'راجع النقاط مع النتايج (' + activityDigits_(changes.sync) + ' مشاركة اتصلحت)';
      return 'عدّل نقاط ' + quoted(title) + (typeof changes.amount === 'number' ? ' (' + (changes.amount > 0 ? '+' : '−') + activityDigits_(Math.abs(changes.amount)) + ')' : '');
    case 'redemption.status': return 'غيّر حالة ' + thing + ({ approved: ' لـ «جاهزة للاستلام»', fulfilled: ' لـ «اتسلمت»', cancelled: ' لـ «اتلغت»' }[changes.status] || '');
    case 'live.stage': return 'غيّر الفقرة الحالية في ' + thing;
    case 'admin.add': return 'ضاف ' + quoted(title) + ' للوحة التحكم';
    case 'admin.remove': return 'شال صلاحية ' + quoted(changes.name || title);
    case 'admin.rename': return 'غيّر اسم ' + quoted(title) + ' لـ ' + quoted(changes.to || title);
    case 'migrate': return 'رقّى بيانات لوحة التحكم';
    case 'session.takeover': return 'دخل من ' + quoted(changes.device || 'جهاز تاني') + ' وقفل الجلسة القديمة';
    default: return activityText_(entry.action, 40);
  }

}

/* changes as a short JSON string (dropped, never cut, when too big) */
function activityChanges_(changes) {

  if (!changes || typeof changes !== 'object') return '';

  var text = '';

  try {
    text = JSON.stringify(changes);
  }
  catch (ignored) {
    return '';
  }

  if (text === '{}') return '';
  if (text.length <= ACTIVITY_CHANGES_MAX) return text;

  // too big: keep only the field list, trimmed
  if (Array.isArray(changes.fields)) {
    return JSON.stringify({ fields: changes.fields.slice(0, 12) }).slice(0, ACTIVITY_CHANGES_MAX);
  }

  return '';

}

function parseChanges_(text) {

  if (!text) return null;

  try {
    var value = JSON.parse(activityCell_(text));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }
  catch (ignored) {
    return null;
  }

}

/* the fields that differ between two versions of a row (labels, known ones only) */
function activityDiff_(before, after) {

  if (!before || !after) return null;

  var fields = [];
  var other = 0;

  Object.keys(after).forEach(function (key) {
    if (ACTIVITY_IGNORED_FIELDS.indexOf(key) !== -1 || key.charAt(0) === '_') return;
    if (!Object.prototype.hasOwnProperty.call(before, key)) return;
    var a = before[key];
    var b = after[key];
    var same = String(a === null || a === undefined ? '' : (typeof a === 'object' ? JSON.stringify(a) : a)) ===
      String(b === null || b === undefined ? '' : (typeof b === 'object' ? JSON.stringify(b) : b));
    if (same) return;
    if (ACTIVITY_FIELDS[key]) {
      if (fields.indexOf(ACTIVITY_FIELDS[key]) === -1) fields.push(ACTIVITY_FIELDS[key]);
    }
    else {
      other++;
    }
  });

  if (!fields.length && !other) return { fields: [] };

  var result = { fields: fields.slice(0, 12) };
  if (other) result.other = other;

  var oldTitle = activityText_(before.title || before.topic || before.name || before.label || '', ACTIVITY_TITLE_MAX);
  var newTitle = activityText_(after.title || after.topic || after.name || after.label || '', ACTIVITY_TITLE_MAX);

  if (oldTitle && newTitle && oldTitle !== newTitle) result.title = [oldTitle, newTitle];

  return result;

}

/* the merged fields of two change lists */
function mergeChanges_(older, newer) {

  if (!older) return newer;
  if (!newer) return older;

  var result = {};
  Object.keys(older).forEach(function (k) { result[k] = older[k]; });
  Object.keys(newer).forEach(function (k) { result[k] = newer[k]; });

  if (Array.isArray(older.fields) && Array.isArray(newer.fields)) {
    result.fields = older.fields.concat(newer.fields.filter(function (f) { return older.fields.indexOf(f) === -1; })).slice(0, 12);
  }

  if (older.title && newer.title) result.title = [older.title[0], newer.title[1]];
  if (older.other || newer.other) result.other = (older.other || 0) + (newer.other || 0);
  // reviews merged within the window: their answers add up («راجع ٣١ إجابة»)
  if (typeof older.answers === 'number' && typeof newer.answers === 'number') result.answers = older.answers + newer.answers;

  return result;

}

/* the actor's device label, from their live session (API mode only) */
function activityDevice_(email) {

  if (!API_REQUEST_ || !API_REQUEST_.email) return '';

  try {
    var record = readCached_(sessionCacheKey_(email));
    return record ? cleanLabel_(record.device, 40) : '';
  }
  catch (ignored) {
    return '';
  }

}

function activityRecord_(values) {

  var record = {};

  ACTIVITY_COLUMNS.forEach(function (key, i) {
    record[key] = values[i];
  });

  return {
    id: String(record.id),
    at: Number(record.at) || 0,
    cairo: String(record.cairo),
    actor: String(record.actor).toLowerCase(),
    actorName: activityCell_(record.actorName),
    action: String(record.action),
    type: String(record.entityType),
    entityId: activityCell_(record.entityId),
    title: activityCell_(record.entityTitle),
    summary: activityCell_(record.summary),
    changes: parseChanges_(record.changes),
    ref: activityCell_(record.ref),
    count: Number(record.count) || 1,
    notified: activityCell_(record.notified),
    device: activityCell_(record.device)
  };

}

/*
 * Notes a row for the action under way (inside mutate_'s change()): written
 * only when the change succeeds.
 */
function activityNote_(entry) {

  ACTIVITY_NOTES_.push(entry);

}

function takeActivityNotes_() {

  var notes = ACTIVITY_NOTES_;
  ACTIVITY_NOTES_ = [];
  return notes;

}

/**
 * Writes one Activity row (or merges it into the actor's last one) and
 * decides whether other admins get a push. Never throws.
 *
 * entry: { action, type, id, title, sub?, changes?, ref?, actor? }
 * Returns the row as the page sees it, or null.
 */
function activity_(entry) {

  try {

    if (!entry || ACTIVITY_ACTIONS.indexOf(entry.action) === -1 || ACTIVITY_TYPES.indexOf(entry.type) === -1) {
      return null;
    }

    // the server's identity, never anything the page sent
    var actor = normalizeEmail_(currentEmail_());

    if (!actor) {
      return null;
    }

    var now = Date.now();
    var sheet = activitySheet_();
    var id = activityText_(entry.id, 120);
    var title = activityText_(entry.title, ACTIVITY_TITLE_MAX);
    var sub = entry.sub === 'competitions' || entry.sub === 'video' ? entry.sub : '';
    var changes = entry.changes && typeof entry.changes === 'object' ? entry.changes : null;
    var merged = null;
    var decision = '';

    if (sub) {
      changes = changes || {};
      changes.sub = sub;
    }

    // the same admin, the same small action on the same thing, a moment ago: one row
    if (ACTIVITY_MERGEABLE.indexOf(entry.action) !== -1) {
      merged = activityMergeTarget_(sheet, actor, entry.action, entry.type, id, now);
    }

    var row;

    if (merged) {
      var action = merged.record.action === 'create' ? 'create' : entry.action;
      var mergedChanges = action === 'create' ? merged.record.changes : mergeChanges_(merged.record.changes, changes);
      var mergedTitle = title || merged.record.title;
      var summary = activitySummary_({ action: action, type: entry.type, title: mergedTitle, sub: sub || (merged.record.changes && merged.record.changes.sub), changes: mergedChanges || {} });
      var count = merged.record.count + 1;

      row = merged.record;
      row.at = now;
      row.cairo = activityCairo_(now);
      row.title = mergedTitle;
      row.summary = summary;
      row.changes = mergedChanges;
      row.ref = activityText_(entry.ref, 120) || merged.record.ref;
      row.count = count;
      row.merged = true;
      row.sheetRow = merged.row;
      row.action = action;

      // a push due for it is sent later (activityPending_): marked on the row
      decision = activityNotifyKind_(row, entry);
      if (decision && API_REQUEST_) row.notified = activityPendingMark_(row.notified, decision);

      // one write: columns at … notified (actor, type and id are the same; the action stays)
      sheet.getRange(merged.row, 2, 1, 13).setValues([[now, row.cairo, row.actor, plainCell_(row.actorName), row.action, row.type, plainCell_(row.entityId),
        plainCell_(mergedTitle), plainCell_(summary), activityChanges_(mergedChanges), plainCell_(row.ref), count, plainCell_(row.notified)]]);
    }
    else {
      row = {
        id: 'act-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12),
        at: now,
        cairo: activityCairo_(now),
        actor: actor,
        actorName: displayName_(actor),
        action: entry.action,
        type: entry.type,
        entityId: id,
        title: title,
        summary: activitySummary_({ action: entry.action, type: entry.type, title: title, sub: sub, changes: changes || {} }),
        changes: changes,
        ref: activityText_(entry.ref, 120),
        count: 1,
        notified: '',
        device: activityDevice_(actor)
      };

      decision = activityNotifyKind_(row, entry);
      if (decision && API_REQUEST_) row.notified = activityPendingMark_('', decision);

      sheet.appendRow([row.id, row.at, row.cairo, row.actor, plainCell_(row.actorName), row.action, row.type, plainCell_(row.entityId),
        plainCell_(row.title), plainCell_(row.summary), activityChanges_(row.changes), plainCell_(row.ref), 1, row.notified, plainCell_(row.device)]);

      activityTrim_(sheet, now);
      // the trim never takes the last row: it is this one (the dispatch checks the id again)
      row.sheetRow = sheet.getLastRow();
    }

    rememberActivity_(row);

    if (decision && API_REQUEST_) {
      // an admin's request: the reply does not wait for the push. The row
      // says «pending»; the next heartbeat (or a later quiet call) sends it
      activityPendingFlag_();
    }
    else if (decision) {
      // no doPost around it (the recovery admin, a trigger): send now
      ACTIVITY_QUEUE_.push({ row: row, kind: decision, actor: actor });
      activityDispatch_();
    }

    return publicActivity_(row);

  }
  catch (error) {
    console.warn('activity: not written: ' + ((error && error.message) || error));
    return null;
  }

}

/* the actor's last row for the same thing, still within the merge window */
function activityMergeTarget_(sheet, actor, action, type, id, now) {

  var last = sheet.getLastRow();

  if (last < 2) return null;

  var count = Math.min(ACTIVITY_MERGE_LOOKBACK, last - 1);
  var values = sheet.getRange(last - count + 1, 1, count, ACTIVITY_COLUMNS.length).getValues();

  for (var i = values.length - 1; i >= 0; i--) {
    var record = activityRecord_(values[i]);
    if (now - record.at > ACTIVITY_MERGE_MS) continue;
    if (record.actor !== actor || record.type !== type || record.entityId !== id) continue;
    if (record.action === action || (record.action === 'create' && action === 'update')) {
      return { row: last - count + 1 + i, record: record };
    }
    // something else happened to it since: a new row
    return null;
  }

  return null;

}

/* the row number of an id (it moved up when the top was trimmed) */
function activityRowOf_(sheet, id, guess) {

  var last = sheet.getLastRow();

  if (guess >= 2 && guess <= last && String(sheet.getRange(guess, 1).getValue()) === id) return guess;

  var from = Math.max(2, last - 20);
  var ids = sheet.getRange(from, 1, last - from + 1, 1).getValues();

  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === id) return from + i;
  }

  return 0;

}

/* retention: rows beyond the cap, then rows older than the time limit, from the top */
function activityTrim_(sheet, now) {

  var rows = sheet.getLastRow() - 1;

  if (rows > ACTIVITY_MAX_ROWS + ACTIVITY_TRIM_SLACK) {
    sheet.deleteRows(2, rows - ACTIVITY_MAX_ROWS);
    rows = ACTIVITY_MAX_ROWS;
  }

  if (rows < 1) return;

  // the age check reads the Sheet: at most once an hour (rows a year old can wait that long)
  var cache = CacheService.getScriptCache();
  if (cache.get(ACTIVITY_TRIM_KEY)) return;
  cache.put(ACTIVITY_TRIM_KEY, '1', 3600);

  var cutoff = now - ACTIVITY_MAX_DAYS * 86400000;
  var first = Number(sheet.getRange(2, 2).getValue()) || 0;

  if (!first || first >= cutoff) return;

  var count = Math.min(rows, ACTIVITY_CHUNK);
  var ats = sheet.getRange(2, 2, count, 1).getValues();
  var old = 0;

  while (old < ats.length && (Number(ats[old][0]) || 0) < cutoff) old++;

  // never the row just written (the last one)
  old = Math.min(old, rows - 1);

  if (old > 0) sheet.deleteRows(2, old);

}


/* =========================================================
   RECENT ROWS (CacheService): the home card and in-panel toasts
========================================================= */

function compactActivity_(row) {

  return {
    id: row.id, at: row.at, cairo: row.cairo, actor: row.actor, action: row.action, type: row.type,
    entityId: row.entityId, title: row.title, summary: row.summary, count: row.count,
    sub: row.changes && row.changes.sub ? row.changes.sub : ''
  };

}

function rememberActivity_(row) {

  try {
    var list = recentActivity_().filter(function (item) { return item.id !== row.id; });
    list.push(compactActivity_(row));
    list.sort(function (a, b) { return a.at - b.at; });
    CacheService.getScriptCache().put(ACTIVITY_RECENT_KEY, JSON.stringify(list.slice(-ACTIVITY_RECENT)), SESSION_KEEP_SECONDS);
  }
  catch (error) {
    console.warn('activity: recent not kept');
  }

}

/* the last ACTIVITY_RECENT rows, oldest first (from the cache; read again from the Sheet when it ran out) */
function recentActivity_() {

  var cache = CacheService.getScriptCache();
  var text = cache.get(ACTIVITY_RECENT_KEY);

  if (text) {
    try {
      var list = JSON.parse(text);
      if (Array.isArray(list)) return list;
    }
    catch (ignored) {
      // read again
    }
  }

  var sheet = spreadsheet_().getSheetByName(ACTIVITY_SHEET);
  var rows = [];

  // nothing logged yet: nothing to keep
  if (!sheet) return rows;

  if (sheet.getLastRow() >= 2) {
    var last = sheet.getLastRow();
    var count = Math.min(ACTIVITY_RECENT, last - 1);
    rows = sheet.getRange(last - count + 1, 1, count, ACTIVITY_COLUMNS.length).getValues()
      .map(activityRecord_)
      .filter(function (r) { return r.id; })
      .map(compactActivity_)
      .sort(function (a, b) { return a.at - b.at; });
  }

  cache.put(ACTIVITY_RECENT_KEY, JSON.stringify(rows), SESSION_KEEP_SECONDS);

  return rows;

}

/* a row as the page gets it: the actor's CURRENT display name in front */
function publicActivity_(row, names) {

  var shown = names && names[row.actor] ? names[row.actor] : (adminEmails_().indexOf(row.actor) !== -1 ? displayName_(row.actor) : (row.actorName || row.actor.split('@')[0]));

  return {
    id: row.id,
    at: row.at,
    cairo: row.cairo,
    actor: row.actor,
    actorName: shown,
    action: row.action,
    type: row.type,
    entityId: row.entityId,
    title: row.title,
    summary: row.summary,
    text: shown + ' ' + row.summary,
    sub: row.sub || (row.changes && row.changes.sub) || '',
    changes: row.changes || null,
    ref: row.ref || '',
    count: row.count || 1,
    notified: row.notified || '',
    device: row.device || ''
  };

}

/* for apiStateFor_: the home card's rows (newest first) and the toasts' starting point */
function activityState_() {

  try {
    var names = adminDirectory_();
    var recent = recentActivity_();
    return {
      recent: recent.slice(-6).reverse().map(function (row) { return publicActivity_(row, names); }),
      latest: recent.length ? recent[recent.length - 1].at : 0,
      now: Date.now()
    };
  }
  catch (error) {
    return { recent: [], latest: 0, now: Date.now() };
  }

}

/*
 * For the heartbeat (Presence.gs): what OTHER admins did after `since`
 * (ms), newest last, at most 5 — shown as in-panel toasts.
 */
function activitySince_(email, since) {

  since = Number(since);

  if (!isFinite(since) || since <= 0) return [];

  var names = adminDirectory_();

  return recentActivity_()
    .filter(function (row) { return row.at > since && row.actor !== email; })
    .slice(-5)
    .map(function (row) { return publicActivity_(row, names); });

}


/* =========================================================
   READING: «سجل النشاط»
========================================================= */

function cairoDayStart_(day, end) {

  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));

  if (!m) return NaN;

  // Cairo is UTC+2 or UTC+3: find the instant whose Cairo wall time is the day's start (or the next day's)
  var base = Date.UTC(+m[1], +m[2] - 1, +m[3] + (end ? 1 : 0), 0, 0);

  for (var offset = 2; offset <= 3; offset++) {
    var guess = base - offset * 3600000;
    if (Utilities.formatDate(new Date(guess), CONTENT_TIMEZONE, 'HH:mm') === '00:00') return guess;
  }

  return base - 2 * 3600000;

}

/**
 * The log, newest first, a page at a time.
 * query: { actor, family, section, from: 'YYYY-MM-DD', to, before: ms, limit, id }
 * → { items, more, next, admins: [{ email, name }], families, sections }
 */
function apiActivity(query) {

  assertAdmin_();

  query = query && typeof query === 'object' ? query : {};

  var limit = Math.max(1, Math.min(ACTIVITY_PAGE_MAX, Math.floor(Number(query.limit)) || ACTIVITY_PAGE));
  var actor = normalizeEmail_(query.actor);
  var actions = Object.prototype.hasOwnProperty.call(ACTIVITY_FAMILIES, query.family) ? ACTIVITY_FAMILIES[query.family] : null;
  var types = Object.prototype.hasOwnProperty.call(ACTIVITY_SECTIONS, query.section) ? ACTIVITY_SECTIONS[query.section] : null;
  var from = query.from ? cairoDayStart_(query.from, false) : NaN;
  var to = query.to ? cairoDayStart_(query.to, true) : NaN;
  var before = Number(query.before);
  var wantId = typeof query.id === 'string' && /^act-[0-9a-f]{12}$/.test(query.id) ? query.id : '';
  var names = adminDirectory_();
  var admins = Object.keys(names).map(function (email) { return { email: email, name: names[email] }; });
  var sheet = spreadsheet_().getSheetByName(ACTIVITY_SHEET);
  var found = [];

  var result = {
    items: [],
    more: false,
    next: 0,
    admins: admins,
    families: Object.keys(ACTIVITY_FAMILIES),
    sections: Object.keys(ACTIVITY_SECTIONS)
  };

  if (!sheet || sheet.getLastRow() < 2) {
    return result;
  }

  var match = function (row) {
    if (!row.id) return false;
    if (wantId) return row.id === wantId;
    if (actor && row.actor !== actor) return false;
    if (actions && actions.indexOf(row.action) === -1) return false;
    if (types && types.indexOf(row.type) === -1) return false;
    if (isFinite(from) && row.at < from) return false;
    if (isFinite(to) && row.at >= to) return false;
    if (isFinite(before) && before > 0 && row.at >= before) return false;
    return true;
  };

  // from the bottom up, a chunk at a time, until a page (and one more) is found
  var end = sheet.getLastRow();

  while (end >= 2 && found.length <= limit) {
    var start = Math.max(2, end - ACTIVITY_CHUNK + 1);
    var values = sheet.getRange(start, 1, end - start + 1, ACTIVITY_COLUMNS.length).getValues();
    for (var i = values.length - 1; i >= 0; i--) {
      var row = activityRecord_(values[i]);
      if (match(row)) found.push(row);
    }
    // everything older than the start of the range: nothing before `from` can match
    if (isFinite(from) && values.length && (Number(values[0][1]) || 0) < from - ACTIVITY_MERGE_MS) break;
    if (wantId && found.length) break;
    end = start - 1;
  }

  found.sort(function (a, b) { return b.at - a.at; });

  result.more = found.length > limit;
  result.items = found.slice(0, limit).map(function (row) { return publicActivity_(row, names); });
  result.next = result.more && result.items.length ? result.items[result.items.length - 1].at : 0;

  return result;

}


/* =========================================================
   ADMIN PUSH: what to send, after the action (AdminNotify.gs sends)
========================================================= */

/* 'now' | 'cooldown' | '' */
function activityNotifyKind_(row, entry) {

  var action = row.action;
  var type = row.type;

  if (entry && entry.notify === false) return '';

  if (action === 'publish') return row.changes && row.changes.unchanged ? '' : 'now';
  if (action === 'push' || action === 'import' || action === 'admin.add' || action === 'admin.remove') return 'now';

  if (ACTIVITY_CONTENT.indexOf(type) !== -1) {
    if (action === 'create' || action === 'delete') return row.merged ? 'cooldown' : 'now';
    if (action === 'update') return 'cooldown';
    return '';
  }

  if (ACTIVITY_PAGE_PARTS.indexOf(type) !== -1 && (action === 'create' || action === 'update' || action === 'delete')) {
    return 'cooldown';
  }

  if (action === 'settings') return 'cooldown';

  // the registry, the wallet and the store (docs/COMPETITIONS.md §11): a code view never rings
  if (action === 'code.view') return '';
  if (action === 'code.export') return 'now';
  if (action === 'code.reset' || action === 'points.adjust' || action === 'redemption.status') return 'cooldown';

  return '';

}

function activityCooldownKey_(actor, row) {

  return 'adm:ntf:' + sha256Hex_(actor + '|' + row.type + '|' + row.entityId).slice(0, 40);

}

function activityRateKey_(actor) {

  return 'adm:ntr:' + sha256Hex_(actor).slice(0, 40);

}

/*
 * Sends this request's queued admin pushes (doPost calls it after the
 * function returned, outside every lock). Records on each row what
 * happened. Never throws.
 */
function activityDispatch_() {

  var queue = ACTIVITY_QUEUE_;
  ACTIVITY_QUEUE_ = [];

  queue.forEach(function (item) {

    var outcome = '';

    try {
      outcome = activitySend_(item);
    }
    catch (error) {
      console.warn('activity: admin push failed: ' + ((error && error.message) || error));
      outcome = 'error';
    }

    try {
      if (outcome && item.row.sheetRow) {
        var sheet = activitySheet_();
        var at = 0;
        var current = '';
        if (item.claimed) {
          // one read: the id (did the row move?) and what it says now
          var cells = item.row.sheetRow <= sheet.getLastRow() ? sheet.getRange(item.row.sheetRow, 1, 1, 14).getValues()[0] : [];
          if (String(cells[0]) === item.row.id) {
            at = item.row.sheetRow;
            current = activityCell_(cells[13]);
          }
          else {
            at = activityRowOf_(sheet, item.row.id, 0);
            current = at ? activityCell_(sheet.getRange(at, 14).getValue()) : '';
          }
        }
        else {
          at = activityRowOf_(sheet, item.row.id, item.row.sheetRow);
        }
        // a claimed row edited again meanwhile («pending» again): its next send records it
        if (at && !/^pending:/.test(current)) {
          sheet.getRange(at, 14).setValue(plainCell_(String(outcome)));
        }
      }
    }
    catch (ignored) {
      // the row stays without it
    }

  });

}

/* =========================================================
   DEFERRED ADMIN PUSH: an admin's reply never waits for FCM
   ---------------------------------------------------------
   In an admin request (doPost) a due push is not sent before the reply:
   the row's `notified` says «pending:now» / «pending:cooldown» (written with
   the row itself, no extra write) and a CacheService flag
   (ACTIVITY_PENDING_KEY = when the oldest one was queued) tells the
   dispatcher there is work. activityPending_ sends them: on every
   apiHeartbeat (any open panel beats every ~25 s) and on a quiet call
   (ACTIVITY_LATE_FNS) when one has waited ACTIVITY_LATE_MS. So the other
   admins hear about it ≤ ~30 s later; their presence, the cooldown and the
   rate limit are judged at send time.
   Exactly once: the rows are claimed («sending») under the script lock,
   then sent outside it. The flag is cleared BEFORE the rows are read, so a
   row written after that read always leaves the flag set behind it.
   A run that dies mid-send leaves «sending»: never sent twice.
   (If the cache loses the flag the rows wait for the next push's flag.)
========================================================= */

var ACTIVITY_PENDING_KEY = 'adm:act:pending';
var ACTIVITY_PENDING_SCAN = 100;
var ACTIVITY_LATE_MS = 60000;
var ACTIVITY_LATE_FNS = ['apiActivity', 'apiAdmins', 'apiAdminPushDevices', 'apiPushState', 'apiMediaLibrary', 'apiComps',
  'apiPages', 'apiEvents', 'apiServants', 'apiParticipants', 'apiWallet', 'apiShopItems', 'apiShopRedemptions', 'apiShopSchedule',
  'apiSeasons', 'apiPushSchedule'];

/* «pending:now» beats «pending:cooldown» (a merged edit of a row that is still waiting) */
function activityPendingMark_(current, kind) {

  return /^pending:now$/.test(String(current || '')) ? 'pending:now' : 'pending:' + kind;

}

/* there is a row to send (keeps the oldest time; never throws) */
function activityPendingFlag_() {

  try {
    var cache = CacheService.getScriptCache();
    if (!cache.get(ACTIVITY_PENDING_KEY)) cache.put(ACTIVITY_PENDING_KEY, String(Date.now()), 21600);
  }
  catch (error) {
    console.warn('activity: pending flag not kept');
  }

}

/*
 * doPost, after the call: sends the waiting admin pushes when this call may
 * carry them (a heartbeat: any; a quiet call: once one waited
 * ACTIVITY_LATE_MS). Never throws; returns how many rows it sent.
 */
function activityPending_(fn) {

  try {
    var since = Number(CacheService.getScriptCache().get(ACTIVITY_PENDING_KEY)) || 0;
    if (!since) return 0;
    if (fn !== 'apiHeartbeat' && !(ACTIVITY_LATE_FNS.indexOf(fn) !== -1 && Date.now() - since >= ACTIVITY_LATE_MS)) return 0;
    return activityDispatchPending_();
  }
  catch (error) {
    console.warn('activity: pending pushes not sent');
    return 0;
  }

}

function activityDispatchPending_() {

  var lock = LockService.getScriptLock();
  var claimed = [];

  // a publish holds the lock: the next beat sends them
  if (!lock.tryLock(3000)) return 0;

  try {

    // first (see above): a row written after the read below sets it again
    CacheService.getScriptCache().remove(ACTIVITY_PENDING_KEY);

    var sheet = spreadsheet_().getSheetByName(ACTIVITY_SHEET);
    var last = sheet ? sheet.getLastRow() : 0;

    if (last < 2) return 0;

    var count = Math.min(ACTIVITY_PENDING_SCAN, last - 1);
    var first = last - count + 1;
    var values = sheet.getRange(first, 1, count, ACTIVITY_COLUMNS.length).getValues();

    values.forEach(function (value, i) {
      var record = activityRecord_(value);
      var match = /^pending:(now|cooldown)$/.exec(record.notified);
      if (!record.id || !match) return;
      record.sheetRow = first + i;
      claimed.push({ row: record, kind: match[1], actor: record.actor, claimed: true });
    });

    // claimed: no other dispatcher sends them again
    claimed.forEach(function (item) {
      sheet.getRange(item.row.sheetRow, 14).setValue('sending');
    });

  }
  finally {
    lock.releaseLock();
  }

  if (!claimed.length) return 0;

  // sent outside the lock, oldest first (the rate limit counts in order)
  ACTIVITY_QUEUE_ = ACTIVITY_QUEUE_.concat(claimed);
  activityDispatch_();

  return claimed.length;

}

function activitySend_(item) {

  var cache = CacheService.getScriptCache();
  var row = item.row;
  var actor = item.actor;
  var now = Date.now();

  // edits: one push per (admin, thing) every ACTIVITY_COOLDOWN_MS; a create counts too
  var coolKey = activityCooldownKey_(actor, row);

  if (item.kind === 'cooldown' && cache.get(coolKey)) {
    return 'cooldown';
  }

  // and at most ACTIVITY_ACTOR_MAX from one admin in a short while
  var rateKey = activityRateKey_(actor);
  var stamps = [];

  try {
    stamps = JSON.parse(cache.get(rateKey) || '[]').filter(function (t) { return now - Number(t) < ACTIVITY_ACTOR_WINDOW_MS; });
  }
  catch (ignored) {
    stamps = [];
  }

  // (a publish, a public push send and admin changes always go out)
  var always = row.action === 'publish' || row.action === 'push' || row.action === 'admin.add' || row.action === 'admin.remove';

  if (!always && stamps.length >= ACTIVITY_ACTOR_MAX) {
    return 'rate';
  }

  if (row.type !== 'site' && row.type !== 'admins' && row.entityId) {
    cache.put(coolKey, '1', Math.round(ACTIVITY_COOLDOWN_MS / 1000));
  }

  var result = adminPushNotify_(row, actor);

  if (result.sent > 0) {
    stamps.push(now);
    cache.put(rateKey, JSON.stringify(stamps), Math.round(ACTIVITY_ACTOR_WINDOW_MS / 1000) + 60);
  }

  return result.sent > 0 ? String(result.sent) : result.reason;

}

/* for a publish: what changed since the previous one (titles, from this log) */
function activitySincePublish_() {

  var sheet = spreadsheet_().getSheetByName(ACTIVITY_SHEET);
  var titles = [];
  var total = 0;
  var seen = {};

  if (!sheet || sheet.getLastRow() < 2) return { items: [], more: 0 };

  var last = sheet.getLastRow();
  var count = Math.min(300, last - 1);
  var values = sheet.getRange(last - count + 1, 1, count, ACTIVITY_COLUMNS.length).getValues();

  for (var i = values.length - 1; i >= 0; i--) {
    var row = activityRecord_(values[i]);
    if (row.action === 'publish') break;
    if (['site', 'admins', 'data', 'session', 'media'].indexOf(row.type) !== -1) continue;
    var key = row.type + ':' + row.entityId;
    if (seen[key]) continue;
    seen[key] = true;
    total++;
    var label = row.type === 'sessions' ? activityThing_('sessions', row.title) : (row.title || '');
    if (label && titles.length < 3) titles.push(activityText_(label, 40));
  }

  return { items: titles, more: Math.max(0, total - titles.length) };

}
