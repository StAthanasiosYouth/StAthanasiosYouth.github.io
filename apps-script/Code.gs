/**
 * ADMIN WEB APP
 *
 * doGet serves the admin panel (Admin.html) to allowlisted Google accounts.
 * The page talks to the api* functions below through google.script.run.
 * Every api* function starts with assertAdmin_() (see Auth.gs).
 *
 * Saving writes to the Sheet (the draft). Nothing reaches the public site
 * until apiPublish() (Publish.gs).
 */

/* =========================================================
   ENTRY POINTS
========================================================= */

function doGet() {

  var email = currentEmail_();

  if (!isAdmin_(email)) {
    var denied = HtmlService.createTemplateFromFile('NoAccess');
    denied.email = email;
    return denied.evaluate()
      .setTitle('غير مسموح')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }

  return HtmlService.createTemplateFromFile('Admin')
    .evaluate()
    .setTitle('لوحة التحكم — أسرة البابا أثناسيوس')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    // no framing by other sites (clickjacking)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);

}


/* Used by Admin.html: <?!= include_('AdminStyles') ?> */
function include_(name) {

  return HtmlService.createHtmlOutputFromFile(name).getContent();

}


/* =========================================================
   STATE
========================================================= */

var ADMIN_META = {
  days: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
};


function apiState() {

  var email = assertAdmin_();
  var lock = LockService.getScriptLock();

  lock.waitLock(20000);

  try {
    assignMissingIds_();
  }
  finally {
    lock.releaseLock();
  }

  return apiStateFor_(email);

}


/* Rows added by hand in the Sheet get ids. Call only while holding the lock. */
function assignMissingIds_() {

  ensureIds_('Links', 'link');
  ensureIds_('Contacts', 'contact');

}


function apiStateFor_(email, built) {

  var draft = readDraft_();
  var help = Object.create(null);

  SETTINGS_SPEC.forEach(function (spec) {
    help[spec[0]] = spec[2];
  });

  built = built || buildPublicContent(draft, { now: cairoNow_(), hash: sha256Hex_ });

  var clean = function (row) {
    var copy = {};
    for (var key in row) {
      if (key !== 'index' && key !== '__row') {
        copy[key] = row[key];
      }
    }
    return copy;
  };

  return {
    user: email,
    draft: {
      settings: Object.keys(draft.settings).map(function (key) {
        return { key: key, value: draft.settings[key], help: help[key] || '' };
      }),
      sections: draft.sections.map(clean),
      links: draft.links.map(clean),
      contacts: draft.contacts.map(clean),
      sessions: draft.sessions.map(clean),
      news: draft.news.map(clean),
      games: draft.games.map(clean),
      notifications: draft.notifications.map(clean),
      activities: draft.activities.map(clean),
      types: draft.types.map(clean),
      // Drive ids stay on the server
      // no Drive ids and no tiny thumbnails here (the library loads those)
      media: draft.media.map(function (row) {
        return {
          id: row.id, path: row.path, thumb: row.thumb, width: row.width, height: row.height, alt: row.alt,
          publishedAt: row.publishedAt, name: row.name || '', color: row.color || '', hash: row.hash || '',
          bytes: row.bytes || '', uploadedAt: row.uploadedAt || '', deletedAt: row.deletedAt || ''
        };
      })
    },
    status: publishStatus_(built),
    config: publicConfig_(),
    // the tabs added by the content center exist (setup() was re-run)
    hubReady: ['Sessions', 'News', 'Games', 'Notifications', 'Media'].every(function (name) { return !!spreadsheet_().getSheetByName(name); }),
    // data upgrade: the Sheet's version vs what this code expects
    schema: { data: dataSchema_(), target: DATA_SCHEMA_VERSION },
    // every section in page order; virtual = not a Sheet row yet (before the upgrade)
    layout: adminLayout_(draft),
    now: cairoNow_(),
    meta: {
      icons: ICON_NAMES,
      styles: LINK_STYLES,
      kinds: CONTACT_KINDS,
      methods: CONTACT_METHODS,
      tones: ANNOUNCEMENT_TONES,
      notificationTypes: NOTIFICATION_TYPES,
      days: ADMIN_META.days,
      limits: LIMITS,
      hubLimits: HUB_LIMITS,
      historyDays: Number(draft.settings['notifications.historyDays']) || 14
    }
  };

}


function adminLayout_(draft) {

  var setting = function (key) { return draft.settings[key] === undefined ? '' : draft.settings[key]; };
  var quiet = function () {};
  var same = function (where, value) { return value; };

  return resolveLayout_(draft.sections, setting, quiet, same).rows.map(function (row) {
    return {
      key: row.key,
      kind: row.kind,
      title: row.title,
      subtitle: row.subtitle,
      icon: row.icon,
      theme: row.theme,
      banner: row.banner,
      enabled: row.enabled,
      visibleFrom: row.visibleFrom.replace('T', ' '),
      visibleUntil: row.visibleUntil.replace('T', ' '),
      virtual: row.virtual
    };
  });

}


/* Runs a change under the script lock, logs it, returns the fresh state. */
function mutate_(action, details, change) {

  var email = assertAdmin_();
  var lock = LockService.getScriptLock();

  lock.waitLock(20000);

  try {
    assignMissingIds_();
    var summary = change();
    log_(email, action, summary || details);
  }
  finally {
    lock.releaseLock();
  }

  return apiStateFor_(email);

}


/* =========================================================
   VALIDATION HELPERS
========================================================= */

/* ids and section keys: letters, digits, dash, underscore */
function validId_(id) {

  if (typeof id !== 'string' || !/^[\w-]{1,60}$/.test(id)) {
    throw new Error('معرّف مش صحيح');
  }

  return id;

}


function fail_(problems) {

  throw new Error(problems.join('\n'));

}


/**
 * An error the admin can act on: what happened (message), what to do
 * (hint), and technical details folded away behind «تفاصيل تقنية».
 * google.script.run only passes error.message to the page, so the parts
 * travel as JSON inside it; the page parses them back (A.parseError).
 */
function appError_(message, hint, details, field) {

  var error = new Error(JSON.stringify({
    appError: 1,
    message: String(message || ''),
    hint: String(hint || ''),
    details: cleanDetails_(details),
    field: field || ''
  }));

  error.plain = String(message || '');

  return error;

}


/* technical details for the admin: never a token, never a long dump */
function cleanDetails_(details) {

  return String(details || '')
    .replace(/(access_token|token|Bearer)[=: ]+[\w.\-]+/gi, '$1=…')
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}/g, '…')
    .slice(0, 600);

}


/* one line for the Log tab / a report, from any error */
function errorDetails_(error) {

  var text = String((error && error.message) || error || '');

  try {
    var parsed = JSON.parse(text);
    if (parsed && parsed.appError) {
      return parsed.message + (parsed.details ? ' [' + parsed.details + ']' : '');
    }
  }
  catch (ignored) {
    // a plain message
  }

  return cleanDetails_(text);

}


function input_(value, max, label, problems, required) {

  var text = contentLine_(value);

  if (required && !text) {
    problems.push(label + ' مطلوب');
  }

  if (text.length > max) {
    problems.push(label + ' أطول من ' + max + ' حرف');
  }

  return text;

}


/* Normalized "YYYY-MM-DD" / "YYYY-MM-DD HH:MM", '' when empty. */
function dateInput_(value, endOfDay, label, problems) {

  var text = contentDigits_(value).replace('T', ' ');

  if (!text) {
    return '';
  }

  if (contentDateTime_(text, endOfDay) === null) {
    problems.push(label + ' مش مفهوم (اكتبه كده: 2026-10-20 أو 2026-10-20 18:00)');
    return text;
  }

  return text;

}


/* link groups only: the sections a link can go into */
function sectionKeys_() {

  return readTable_('Sections')
    .filter(function (row) { return (contentLine_(row.kind).toLowerCase() || 'links') === 'links'; })
    .map(function (row) { return contentLine_(row.key).toLowerCase(); });

}


function nextOrder_(rows, filter) {

  var max = 0;

  rows.filter(filter).forEach(function (row) {
    var order = contentNumber_(row.order);
    if (order !== null && !isNaN(order) && order > max) {
      max = order;
    }
  });

  return max + 10;

}


function nowStamp_() {

  return Utilities.formatDate(new Date(), CONTENT_TIMEZONE, 'yyyy-MM-dd HH:mm');

}


/* =========================================================
   LINKS
========================================================= */

function apiSaveLink(input) {

  assertAdmin_();

  input = input || {};

  var problems = [];
  var existingId = contentLine_(input.id);

  if (existingId && !/^[\w-]{1,60}$/.test(existingId)) {
    problems.push('معرّف الرابط مش صحيح');
  }

  var featured = input.featured === true;
  var link = {
    title: input_(input.title, LIMITS.title, 'العنوان', problems, true),
    subtitle: input_(input.subtitle, LIMITS.subtitle, 'الوصف', problems, false),
    cta: featured ? input_(input.cta, LIMITS.cta, 'نص الزرار', problems, false) : '',
    badge: input_(input.badge, LIMITS.badge, 'الشارة', problems, false),
    url: safeHttpsUrl(input.url),
    icon: ICON_NAMES.indexOf(input.icon) !== -1 ? input.icon : 'link',
    style: LINK_STYLES.indexOf(input.style) !== -1 ? input.style : 'card',
    featured: featured,
    enabled: input.enabled !== false,
    section: featured ? '' : contentLine_(input.section).toLowerCase(),
    startAt: dateInput_(input.startAt, false, 'تاريخ البداية', problems),
    endAt: dateInput_(input.endAt, true, 'تاريخ النهاية', problems)
  };

  if (!link.url) {
    problems.push('الرابط لازم يكون كامل ويبدأ بـ https://');
  }

  if (!featured && sectionKeys_().indexOf(link.section) === -1) {
    problems.push('اختار قسم للرابط');
  }

  var start = link.startAt && contentDateTime_(link.startAt, false);
  var end = link.endAt && contentDateTime_(link.endAt, true);

  if (start && end && start > end) {
    problems.push('تاريخ البداية بعد تاريخ النهاية');
  }

  if (problems.length) {
    fail_(problems);
  }

  return mutate_('link.save', link.title, function () {

    var rows = readTable_('Links');
    var isNew = !existingId || !rows.some(function (row) { return row.id === existingId; });

    link.id = existingId || ('link-' + Utilities.getUuid().slice(0, 8));
    link.updatedAt = nowStamp_();

    if (isNew) {
      link.order = nextOrder_(rows, function (row) {
        return featured ? contentBool_(row.featured) : (!contentBool_(row.featured) && row.section === link.section);
      });
    }

    upsertRow_('Links', 'id', link);

    return (isNew ? 'new ' : '') + link.id + ' ' + link.title;

  });

}


function apiSetLinkEnabled(id, enabled) {

  assertAdmin_();
  validId_(id);

  return mutate_('link.toggle', id + ' ' + enabled, function () {
    if (!findRow_('Links', 'id', id)) {
      throw new Error('الرابط مش موجود');
    }
    upsertRow_('Links', 'id', { id: id, enabled: enabled === true, updatedAt: nowStamp_() });
  });

}


function apiDeleteLink(id) {

  assertAdmin_();
  validId_(id);

  return mutate_('link.delete', id, function () {
    if (!deleteRow_('Links', 'id', id)) {
      throw new Error('الرابط مش موجود');
    }
  });

}


/** Moves a link up (-1) or down (+1) within its group (featured or its section). */
function apiMoveLink(id, direction) {

  assertAdmin_();
  validId_(id);

  return mutate_('link.move', id + ' ' + direction, function () {

    var rows = sortRows_(readTable_('Links'));
    var target = rows.filter(function (row) { return row.id === id; })[0];

    if (!target) {
      throw new Error('الرابط مش موجود');
    }

    var group = rows.filter(function (row) {
      return contentBool_(target.featured)
        ? contentBool_(row.featured)
        : !contentBool_(row.featured) && row.section === target.section;
    });

    moveWithin_('Links', group, id, direction);

  });

}


function moveWithin_(table, group, id, direction) {

  var ids = group.map(function (row) { return row.id || row.key; });
  var from = ids.indexOf(id);
  var to = from + (direction < 0 ? -1 : 1);

  if (from === -1 || to < 0 || to >= ids.length) {
    return;
  }

  ids.splice(to, 0, ids.splice(from, 1)[0]);
  writeOrder_(table, table === 'Sections' ? 'key' : 'id', ids);

}


/* =========================================================
   SECTIONS
========================================================= */

/*
 * Saves a page section. New ones are link groups, placed right after the
 * last link group. Built-in sections (meeting, news, games...) are edited
 * here too (title, subtitle, schedule, look) but keep their kind.
 */
function apiSaveSection(input, isNew) {

  assertAdmin_();

  input = input || {};

  var problems = [];
  var key = contentLine_(input.key).toLowerCase();
  var builtin = builtinSection_(key);
  var title = input_(input.title, LIMITS.sectionTitle, 'عنوان القسم', problems, !builtin);
  var subtitle = input_(input.subtitle, LIMITS.subtitle, 'وصف القسم', problems, false);
  var visibleFrom = dateInput_(input.visibleFrom, false, 'يظهر من', problems);
  var visibleUntil = dateInput_(input.visibleUntil, true, 'يختفي بعد', problems);
  var theme = contentLine_(input.theme).toLowerCase();
  var icon = contentLine_(input.icon).toLowerCase();
  var banner = imageRef_(input.banner, problems);

  if (!/^[a-z][a-z0-9-]{0,30}$/.test(key)) {
    problems.push('مفتاح القسم: حروف إنجليزي صغيرة وأرقام وشرطة، ويبدأ بحرف (مثلاً events)');
  }

  if (isNew && builtin) {
    problems.push('مفتاح القسم ده محجوز لقسم أساسي، اختار مفتاح تاني');
  }

  if (visibleFrom && visibleUntil && contentDateTime_(visibleFrom, false) > contentDateTime_(visibleUntil, true)) {
    problems.push('يظهر من: لازم يكون قبل ميعاد الاختفاء');
  }

  if (theme && SECTION_THEMES.indexOf(theme) === -1) {
    problems.push('الشكل مش معروف');
  }

  if (icon && ICON_NAMES.indexOf(icon) === -1) {
    problems.push('الأيقونة مش معروفة');
  }

  if (problems.length) {
    fail_(problems);
  }

  return mutate_('section.save', key, function () {

    var rows = sortRows_(readTable_('Sections'));
    var exists = rows.some(function (row) { return row.key === key; });

    if (isNew && exists) {
      throw new Error('في قسم بنفس المفتاح ده');
    }

    if (!isNew && !exists) {
      throw builtin
        ? appError_('الأقسام الأساسية محتاجة ترقية البيانات الأول.', 'من الإعدادات ← ترقية البيانات.')
        : new Error('القسم مش موجود');
    }

    var record = {
      key: key,
      title: title || (builtin ? builtin.title : ''),
      subtitle: subtitle,
      enabled: input.enabled !== false,
      visibleFrom: visibleFrom,
      visibleUntil: visibleUntil,
      theme: theme,
      icon: icon,
      banner: banner
    };

    if (!exists) {
      record.kind = 'links';
      record.order = 0;
    }

    upsertRow_('Sections', 'key', record);

    if (!exists) {
      // after the last link group, then everything renumbered 10, 20, 30...
      var keys = rows.map(function (row) { return row.key; });
      var lastLinks = -1;
      rows.forEach(function (row, i) {
        if ((contentLine_(row.kind).toLowerCase() || 'links') === 'links') lastLinks = i;
      });
      keys.splice(lastLinks + 1, 0, key);
      writeOrder_('Sections', 'key', keys);
    }

  });

}


/* the quick ظاهر / مخفي switch for any section */
function apiSetSectionEnabled(key, enabled) {

  assertAdmin_();
  validId_(key);

  return mutate_('section.enabled', key + ' ' + (enabled === true), function () {
    if (!findRow_('Sections', 'key', key)) {
      throw builtinSection_(key)
        ? appError_('الأقسام الأساسية محتاجة ترقية البيانات الأول.', 'من الإعدادات ← ترقية البيانات.')
        : new Error('القسم مش موجود');
    }
    upsertRow_('Sections', 'key', { key: key, enabled: enabled === true });
  });

}


function apiDeleteSection(key) {

  assertAdmin_();
  validId_(key);

  if (builtinSection_(key)) {
    throw appError_('القسم ده أساسي ومينفعش يتمسح.', 'لو مش عايزه يظهر، اقفل «ظاهر» بتاعه.');
  }

  return mutate_('section.delete', key, function () {

    var used = readTable_('Links').some(function (row) {
      return !contentBool_(row.featured) && row.section === key;
    });

    if (used) {
      throw new Error('القسم فيه روابط. انقلها أو امسحها الأول.');
    }

    if (!deleteRow_('Sections', 'key', key)) {
      throw new Error('القسم مش موجود');
    }

  });

}


function apiMoveSection(key, direction) {

  assertAdmin_();
  validId_(key);

  return mutate_('section.move', key + ' ' + direction, function () {
    moveWithin_('Sections', sortRows_(readTable_('Sections')), key, direction);
  });

}


/* =========================================================
   CONTACTS
========================================================= */

function apiSaveContact(input) {

  assertAdmin_();

  input = input || {};

  var problems = [];
  var existingId = contentLine_(input.id);

  if (existingId && !/^[\w-]{1,60}$/.test(existingId)) {
    problems.push('معرّف جهة التواصل مش صحيح');
  }

  var method = CONTACT_METHODS.indexOf(input.method) !== -1 ? input.method : '';
  var phone = normalizePhone(input.phone);

  var contact = {
    name: input_(input.name, LIMITS.personName, 'الاسم', problems, true),
    role: input_(input.role, LIMITS.role, 'الدور', problems, false),
    description: input_(input.description, LIMITS.description, 'الوصف', problems, false),
    kind: CONTACT_KINDS.indexOf(input.kind) !== -1 ? input.kind : 'service',
    method: method,
    message: method === 'whatsapp' ? contentText_(input.message).slice(0, LIMITS.message) : '',
    enabled: input.enabled !== false
  };

  if (!method) {
    problems.push('اختار طريقة التواصل: اتصال أو واتساب');
  }

  if (!phone) {
    problems.push('رقم التليفون مش صحيح (مثال: 01012345678)');
  }
  else {
    // stored the way people write it locally; normalized again on publish
    contact.phone = phone.display.replace(/\s/g, '');
  }

  if (problems.length) {
    fail_(problems);
  }

  return mutate_('contact.save', contact.name, function () {

    var rows = readTable_('Contacts');
    var isNew = !existingId || !rows.some(function (row) { return row.id === existingId; });

    contact.id = existingId || ('contact-' + Utilities.getUuid().slice(0, 8));
    contact.updatedAt = nowStamp_();

    if (isNew) {
      contact.order = nextOrder_(rows, function () { return true; });
    }

    upsertRow_('Contacts', 'id', contact);

    return (isNew ? 'new ' : '') + contact.id + ' ' + contact.name;

  });

}


function apiDeleteContact(id) {

  assertAdmin_();
  validId_(id);

  return mutate_('contact.delete', id, function () {
    if (!deleteRow_('Contacts', 'id', id)) {
      throw new Error('جهة التواصل مش موجودة');
    }
  });

}


function apiMoveContact(id, direction) {

  assertAdmin_();
  validId_(id);

  return mutate_('contact.move', id + ' ' + direction, function () {
    moveWithin_('Contacts', sortRows_(readTable_('Contacts')), id, direction);
  });

}


/* =========================================================
   SETTINGS (site, meeting, location, announcement)
========================================================= */

function apiSaveSettings(values) {

  assertAdmin_();

  values = values || {};

  var known = Object.create(null);

  SETTINGS_SPEC.forEach(function (spec) {
    known[spec[0]] = true;
  });

  var problems = [];
  var clean = {};

  Object.keys(values).forEach(function (key) {

    if (!known[key]) {
      problems.push('إعداد مش معروف: ' + key);
      return;
    }

    var value = values[key];

    if (/\.enabled$/.test(key)) {
      clean[key] = value === true;
      return;
    }

    switch (key) {

      case 'meeting.day': {
        var day = contentDay_(value);
        if (day === null) problems.push('يوم الاجتماع مش مفهوم');
        else clean[key] = ADMIN_META.days[day];
        return;
      }

      case 'meeting.time': {
        var time = contentTime_(value);
        if (!time) problems.push('الميعاد لازم يكون بالشكل 20:00');
        else clean[key] = time;
        return;
      }

      case 'meeting.durationMinutes': {
        var minutes = contentNumber_(value);
        if (minutes !== null && (isNaN(minutes) || minutes < 15 || minutes > 600 || Math.round(minutes) !== minutes)) {
          problems.push('مدة الاجتماع: عدد دقايق بين 15 و 600، أو سيبها فاضية');
        }
        else clean[key] = minutes === null ? '' : String(minutes);
        return;
      }

      case 'meeting.skipDates': {
        var dates = contentDigits_(value).split(/[,،\s]+/).filter(Boolean);
        var bad = dates.filter(function (d) { return contentDateTime_(d, false) === null || /[ T]/.test(d); });
        if (bad.length) problems.push('تواريخ الإلغاء مش مفهومة: ' + bad.join('، '));
        else clean[key] = dates.join(', ');
        return;
      }

      case 'notifications.historyDays':
      case 'games.endedHours': {
        var count = contentNumber_(value);
        var max = key === 'games.endedHours' ? 72 : 90;
        var min = key === 'games.endedHours' ? 0 : 1;
        if (count === null || isNaN(count) || count < min || count > max || Math.round(count) !== count) {
          problems.push((key === 'games.endedHours' ? 'عدد الساعات' : 'عدد الأيام') + ' لازم يكون رقم صحيح بين ' + min + ' و ' + max);
        }
        else clean[key] = String(count);
        return;
      }

      case 'location.lat':
      case 'location.lng': {
        var number = contentNumber_(value);
        var limit = key === 'location.lat' ? 90 : 180;
        if (number !== null && (isNaN(number) || Math.abs(number) > limit)) problems.push('الإحداثيات مش صحيحة');
        else clean[key] = number === null ? '' : String(number);
        return;
      }

      case 'location.mapsUrl':
      case 'announcement.linkUrl': {
        var raw = contentLine_(value);
        var url = safeHttpsUrl(raw);
        if (raw && !url) problems.push('اللينك لازم يكون كامل ويبدأ بـ https://');
        else clean[key] = url;
        return;
      }

      case 'announcement.expiresAt': {
        var date = dateInput_(value, true, 'تاريخ انتهاء الإعلان', problems);
        clean[key] = date;
        return;
      }

      case 'announcement.tone': {
        clean[key] = ANNOUNCEMENT_TONES.indexOf(value) !== -1 ? value : 'info';
        return;
      }

      case 'announcement.text': {
        var text = contentText_(value);
        if (text.length > LIMITS.announcement) problems.push('نص الإعلان أطول من ' + LIMITS.announcement + ' حرف');
        clean[key] = text;
        return;
      }

      case 'site.name': {
        clean[key] = input_(value, LIMITS.siteName, 'اسم الخدمة', problems, true);
        return;
      }

      default: {
        var limits = {
          'site.tagline': LIMITS.tagline,
          'site.shareText': LIMITS.shareText,
          'meeting.title': LIMITS.title,
          'meeting.note': LIMITS.note,
          'location.name': LIMITS.title,
          'location.address': LIMITS.address,
          'location.note': LIMITS.note,
          'announcement.linkLabel': LIMITS.linkLabel
        };
        clean[key] = input_(value, limits[key] || 200, key, problems, false);
      }

    }

  });

  if (problems.length) {
    fail_(problems);
  }

  return mutate_('settings.save', Object.keys(clean).join(', '), function () {

    var sheet = sheet_('Settings');
    var rows = readTable_('Settings');
    var next = null;

    Object.keys(clean).forEach(function (key) {

      var row = rows.filter(function (r) { return r.key === key; })[0];

      if (!row) {
        next = next ? next + 1 : nextRow_('Settings', rows);
        if (next > sheet.getMaxRows()) {
          sheet.insertRowsAfter(sheet.getMaxRows(), 1);
        }
      }

      var rowNumber = row ? row.__row : next;

      if (!row) {
        sheet.getRange(rowNumber, 1).setNumberFormat('@').setValue(key);
      }

      var cell = sheet.getRange(rowNumber, 2);

      if (typeof clean[key] === 'string') {
        cell.setNumberFormat('@');
      }

      cell.setValue(clean[key]);

    });

  });

}


/* =========================================================
   MAPS HELPER
========================================================= */

/**
 * Reads coordinates from a Google Maps link (short links are followed).
 * Only Google Maps hosts are fetched.
 */
function apiResolveMapsUrl(url) {

  assertAdmin_();

  var current = safeHttpsUrl(url);

  if (!isGoogleMapsUrl_(current)) {
    throw new Error('ده مش لينك جوجل ماب');
  }

  for (var hop = 0; hop < 5; hop++) {

    var coords = coordsFromMapsUrl_(current);

    if (coords) {
      return coords;
    }

    var response = UrlFetchApp.fetch(current, { followRedirects: false, muteHttpExceptions: true });
    var headers = response.getHeaders();
    var next = safeHttpsUrl(headers.Location || headers.location || '');

    // only ever follow redirects that stay on Google Maps
    if (!isGoogleMapsUrl_(next)) {
      break;
    }

    current = next;

  }

  throw new Error('مقدرناش نطلع الإحداثيات من اللينك. اكتبها بإيدك.');

}


/* Exact host match (a prefix/regex check would accept maps.app.goo.gl.evil.com). */
function isGoogleMapsUrl_(url) {

  var match = /^https:\/\/([^\/?#:]+)(?::\d+)?(\/[^?#]*)?/i.exec(url || '');

  if (!match) {
    return false;
  }

  var host = match[1].toLowerCase();
  var path = match[2] || '/';

  if (host === 'maps.app.goo.gl') {
    return true;
  }

  if (host === 'goo.gl') {
    return path.indexOf('/maps') === 0;
  }

  if (/^maps\.google\.(com|com\.eg)$/.test(host)) {
    return true;
  }

  return /^(www\.)?google\.(com|com\.eg)$/.test(host) && path.indexOf('/maps') === 0;

}


function coordsFromMapsUrl_(url) {

  var place = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url);
  var at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url);
  var query = /[?&](?:q|query|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i.exec(url);
  var match = place || query || at;

  if (!match) {
    return null;
  }

  var lat = Number(match[1]);
  var lng = Number(match[2]);

  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: lat, lng: lng } : null;

}
