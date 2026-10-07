/**
 * CONTENT CENTER API: sessions (upcoming meetings), news, games,
 * notifications. One save / delete / toggle path for all four.
 *
 * All dates are Cairo wall time, stored as "YYYY-MM-DD HH:MM" text.
 *
 * "Linked notifications": the game, news and session editors have
 * checkboxes such as "notify 15 minutes before". Each one creates a real
 * row in Notifications with a predictable id (e.g. notif-game-ab12cd34-soon)
 * that the admin can still edit or delete like any other notification.
 */

var ITEM_KINDS = {
  sessions: { table: 'Sessions', key: 'date', label: 'الاجتماع' },
  news: { table: 'News', key: 'id', prefix: 'news', label: 'الخبر', archive: true },
  games: { table: 'Games', key: 'id', prefix: 'game', label: 'اللعبة', archive: true },
  notifications: { table: 'Notifications', key: 'id', prefix: 'notif', label: 'الإشعار', archive: true },
  // competitions, trips, plays... one table; the type decides the section
  activities: { table: 'Activities', key: 'id', prefix: 'act', label: 'الفعالية', archive: true },
  types: { table: 'Types', key: 'key', label: 'النوع' }
};

var ACTIVITY_LIMITS = { title: 80, subtitle: 140, description: 1500, cta: 24, location: 120, typeLabel: 30, template: 120 };


function itemKind_(kind) {

  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(ITEM_KINDS, kind)) {
    throw new Error('نوع مش معروف');
  }

  return ITEM_KINDS[kind];

}


function ensureTable_(name) {

  if (!spreadsheet_().getSheetByName(name)) {
    throw new Error('تبويب ' + name + ' مش موجود. شغّل setup() مرة تانية من محرر Apps Script.');
  }

}


/* =========================================================
   FIELD HELPERS
========================================================= */

/* "YYYY-MM-DD HH:MM" -> "YYYY-MM-DDTHH:MM" (for comparisons / arithmetic) */
function wallOf_(value, endOfDay) {

  return value ? contentDateTime_(value, endOfDay) || '' : '';

}


/* back to the stored form */
function storedOf_(stamp) {

  return stamp ? stamp.replace('T', ' ') : '';

}


function imageRef_(value, problems) {

  var id = contentLine_(value);

  if (!id) {
    return '';
  }

  var media = /^img-[a-z0-9]{8}$/.test(id) ? readOptionalTable_('Media').filter(function (r) { return r.id === id; })[0] : null;

  if (!media || media.deletedAt) {
    problems.push('الصورة مش موجودة');
  }

  return id;

}


function textBlock_(value, max, label, problems) {

  var text = contentText_(value).replace(/\n{3,}/g, '\n\n');

  if (text.length > max) {
    problems.push(label + ' أطول من ' + max + ' حرف');
  }

  return text;

}


/* =========================================================
   VALIDATORS: input from the page -> clean row
========================================================= */

var ITEM_VALIDATORS = {

  sessions: function (input, problems) {

    var date = contentDigits_(input.date);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || contentDateTime_(date, false) === null) {
      problems.push('تاريخ الاجتماع مطلوب (مثال: 2026-10-11)');
    }

    var time = contentTime_(input.time);

    if (time === null) {
      problems.push('الساعة لازم تكون بالشكل 20:00');
    }

    // this week's length, if different from the usual
    var duration = contentLine_(input.durationMinutes);
    var minutes = duration === '' ? '' : Number(duration);

    if (minutes !== '' && !(minutes >= 15 && minutes <= 600 && Math.round(minutes) === minutes)) {
      problems.push('مدة الاجتماع لازم تكون عدد دقايق بين 15 و 600، أو فاضية');
    }

    return {
      date: date,
      durationMinutes: minutes,
      enabled: input.enabled !== false,
      time: time || '',
      topic: input_(input.topic, HUB_LIMITS.topic, 'الموضوع', problems, false),
      speaker: input_(input.speaker, HUB_LIMITS.speaker, 'الخادم / المتكلم', problems, false),
      description: textBlock_(input.description, HUB_LIMITS.sessionDescription, 'الوصف', problems),
      image: imageRef_(input.image, problems),
      status: input.status === 'cancelled' ? 'cancelled' : 'normal',
      note: input_(input.note, LIMITS.note, 'الملاحظة', problems, false),
      visibleFrom: dateInput_(input.visibleFrom, false, 'ميعاد ظهور الموضوع', problems)
    };

  },

  news: function (input, problems) {

    var linkRaw = contentLine_(input.linkUrl);
    var link = safeHttpsUrl(linkRaw);

    if (linkRaw && !link) {
      problems.push('اللينك لازم يكون كامل ويبدأ بـ https://');
    }

    var record = {
      enabled: input.enabled !== false,
      featured: input.featured === true,
      pinned: input.pinned === true,
      tone: ANNOUNCEMENT_TONES.indexOf(input.tone) !== -1 ? input.tone : 'info',
      title: input_(input.title, HUB_LIMITS.newsTitle, 'العنوان', problems, true),
      summary: input_(input.summary, HUB_LIMITS.summary, 'الملخص', problems, false),
      body: textBlock_(input.body, HUB_LIMITS.body, 'التفاصيل', problems),
      image: imageRef_(input.image, problems),
      linkUrl: link,
      linkLabel: input_(input.linkLabel, LIMITS.linkLabel, 'نص الزرار', problems, false),
      badge: input_(input.badge, LIMITS.badge, 'الشارة', problems, false),
      // no publish time = from now
      publishAt: dateInput_(input.publishAt, false, 'ميعاد النشر', problems) || nowStamp_(),
      expireAt: dateInput_(input.expireAt, true, 'ميعاد الانتهاء', problems)
    };

    if (record.expireAt && wallOf_(record.publishAt) > wallOf_(record.expireAt, true)) {
      problems.push('ميعاد النشر بعد ميعاد الانتهاء');
    }

    return record;

  },

  games: function (input, problems) {

    var url = safeHttpsUrl(input.url);

    if (!url) {
      problems.push('لينك اللعبة لازم يكون كامل ويبدأ بـ https://');
    }

    var record = {
      enabled: input.enabled !== false,
      title: input_(input.title, HUB_LIMITS.gameTitle, 'اسم اللعبة', problems, true),
      description: textBlock_(input.description, HUB_LIMITS.gameDescription, 'الوصف', problems),
      image: imageRef_(input.image, problems),
      url: url,
      buttonLabel: input_(input.buttonLabel, HUB_LIMITS.buttonLabel, 'نص الزرار', problems, false),
      visibleFrom: dateInput_(input.visibleFrom, false, 'ميعاد الظهور', problems),
      startAt: dateInput_(input.startAt, false, 'ميعاد البداية', problems),
      endAt: dateInput_(input.endAt, true, 'ميعاد النهاية', problems),
      afterEnd: input.afterEnd === 'hide' ? 'hide' : 'show'
    };

    var start = wallOf_(record.startAt);
    var end = wallOf_(record.endAt, true);

    if (!record.startAt || !record.endAt) {
      problems.push('ميعاد البداية والنهاية مطلوبين');
    }
    else if (start && end && start >= end) {
      problems.push('ميعاد البداية لازم يكون قبل النهاية');
    }

    if (record.visibleFrom && start && wallOf_(record.visibleFrom) > start) {
      problems.push('ميعاد الظهور لازم يكون قبل ميعاد البداية');
    }

    return record;

  },

  activities: function (input, problems) {

    var typeKey = contentLine_(input.type).toLowerCase();
    var type = readOptionalTable_('Types').filter(function (t) { return t.key === typeKey; })[0];

    if (!type) {
      problems.push('النوع مطلوب (مسابقة، رحلة، مؤتمر...)');
    }

    var urlText = contentLine_(input.url);
    var url = safeHttpsUrl(urlText);

    if (urlText && !url) {
      problems.push('اللينك لازم يكون كامل ويبدأ بـ https://');
    }

    var order = contentNumber_(input.order);

    var record = {
      enabled: input.enabled !== false,
      type: typeKey,
      title: input_(input.title, ACTIVITY_LIMITS.title, 'العنوان', problems, true),
      subtitle: input_(input.subtitle, ACTIVITY_LIMITS.subtitle, 'سطر قصير', problems, false),
      description: textBlock_(input.description, ACTIVITY_LIMITS.description, 'التفاصيل', problems),
      image: imageRef_(input.image, problems),
      ctaLabel: input_(input.ctaLabel, ACTIVITY_LIMITS.cta, 'نص الزرار', problems, false),
      url: url || '',
      location: input_(input.location, ACTIVITY_LIMITS.location, 'المكان', problems, false),
      startAt: dateInput_(input.startAt, false, 'بيبدأ', problems),
      endAt: dateInput_(input.endAt, true, 'بيخلص', problems),
      visibleFrom: dateInput_(input.visibleFrom, false, 'يظهر من', problems),
      visibleUntil: dateInput_(input.visibleUntil, true, 'يختفي بعد', problems),
      order: order === null || isNaN(order) ? '' : order
    };

    if (record.startAt && record.endAt && wallOf_(record.startAt) >= wallOf_(record.endAt, true)) {
      problems.push('بيبدأ: لازم يكون قبل ميعاد النهاية');
    }

    if (record.visibleFrom && record.visibleUntil && wallOf_(record.visibleFrom) > wallOf_(record.visibleUntil, true)) {
      problems.push('يظهر من: لازم يكون قبل ميعاد الاختفاء');
    }

    return record;

  },

  types: function (input, problems) {

    var key = contentLine_(input.key).toLowerCase();

    if (!/^[a-z][a-z0-9-]{1,30}$/.test(key)) {
      problems.push('مفتاح النوع: حروف إنجليزي صغيرة وأرقام وشرطة (مثلاً trip)');
    }

    var section = contentLine_(input.section).toLowerCase();
    var row = readTable_('Sections').filter(function (s) { return s.key === section; })[0];

    if (!row || (contentLine_(row.kind).toLowerCase() || 'links') !== 'items') {
      problems.push('القسم لازم يكون قسم مسابقات أو فعاليات');
    }

    var icon = contentLine_(input.icon).toLowerCase();
    var theme = contentLine_(input.theme).toLowerCase();

    if (icon && ICON_NAMES.indexOf(icon) === -1) problems.push('الأيقونة مش معروفة');
    if (theme && SECTION_THEMES.indexOf(theme) === -1) problems.push('الشكل مش معروف');

    var order = contentNumber_(input.order);

    return {
      key: key,
      enabled: input.enabled !== false,
      label: input_(input.label, ACTIVITY_LIMITS.typeLabel, 'اسم النوع', problems, true),
      section: section,
      icon: icon,
      theme: theme,
      banner: imageRef_(input.banner, problems),
      ctaDefault: input_(input.ctaDefault, ACTIVITY_LIMITS.cta, 'نص الزرار', problems, false),
      notifyTemplate: input_(input.notifyTemplate, ACTIVITY_LIMITS.template, 'نص الإشعار', problems, false),
      order: order === null || isNaN(order) ? '' : order
    };

  },

  notifications: function (input, problems) {

    var target = contentLine_(input.target);
    var match = /^(news|game|activity):([\w-]{1,60})$/.exec(target);
    var TARGET_TABLES = { news: 'News', game: 'Games', activity: 'Activities' };

    if (!target || target === 'meeting') {
      // fine
    }
    else if (match) {
      ensureTable_(TARGET_TABLES[match[1]]);
      if (!findRow_(TARGET_TABLES[match[1]], 'id', match[2])) {
        problems.push('الإشعار بيشاور على حاجة مش موجودة');
      }
    }
    else if (safeHttpsUrl(target)) {
      target = safeHttpsUrl(target);
    }
    else {
      problems.push('الوجهة لازم تكون الاجتماع أو خبر أو لعبة أو فعالية أو لينك https');
    }

    var record = {
      enabled: input.enabled !== false,
      type: NOTIFICATION_TYPES.indexOf(input.type) !== -1 ? input.type : 'general',
      title: input_(input.title, HUB_LIMITS.notificationTitle, 'العنوان', problems, true),
      message: input_(input.message, HUB_LIMITS.notificationMessage, 'الرسالة', problems, false),
      target: target,
      image: imageRef_(input.image, problems),
      publishAt: dateInput_(input.publishAt, false, 'ميعاد الظهور', problems) || nowStamp_(),
      expireAt: dateInput_(input.expireAt, true, 'ميعاد الاختفاء', problems)
    };

    if (record.expireAt && wallOf_(record.publishAt) > wallOf_(record.expireAt, true)) {
      problems.push('ميعاد الظهور بعد ميعاد الاختفاء');
    }

    return record;

  }

};


/* =========================================================
   LINKED NOTIFICATIONS
========================================================= */

/** Wanted notification rows for an item, keyed by id (subset of record fields). */
function linkedNotifications_(kind, record, notify) {

  notify = notify || {};

  var out = {};

  if (kind === 'games') {

    var start = wallOf_(record.startAt);
    var end = storedOf_(wallOf_(record.endAt, true));

    out['notif-' + record.id + '-soon'] = notify.soon && start ? {
      type: 'game',
      title: 'استعدوا 👀',
      message: 'تحدي «' + record.title + '» هيبدأ بعد ١٥ دقيقة',
      target: 'game:' + record.id,
      publishAt: storedOf_(wallAdd_(start, -15)),
      expireAt: end
    } : null;

    out['notif-' + record.id + '-start'] = notify.start && start ? {
      type: 'game',
      title: '🔥 اللعبة جاهزة!',
      message: '«' + record.title + '» — ادخل دلوقتي وابدأ التحدي',
      target: 'game:' + record.id,
      publishAt: storedOf_(start),
      expireAt: end
    } : null;

  }

  if (kind === 'news') {

    out['notif-' + record.id] = notify.publish ? {
      type: record.pinned && record.tone === 'alert' ? 'important' : 'news',
      title: record.title.slice(0, HUB_LIMITS.notificationTitle),
      message: record.summary.slice(0, HUB_LIMITS.notificationMessage),
      target: 'news:' + record.id,
      image: record.image,
      publishAt: record.publishAt,
      expireAt: record.expireAt
    } : null;

  }

  if (kind === 'activities') {

    var type = readOptionalTable_('Types').filter(function (t) { return t.key === record.type; })[0] || {};
    var competition = type.section === 'competitions';
    var template = contentLine_(type.notifyTemplate) || (competition ? 'المسابقة الجديدة: {title}' : '{title}');
    var until = record.visibleUntil || record.endAt || '';

    out['notif-' + record.id] = notify.publish ? {
      type: competition ? 'competition' : 'activity',
      title: template.replace('{title}', record.title).slice(0, HUB_LIMITS.notificationTitle),
      message: (record.subtitle || '').slice(0, HUB_LIMITS.notificationMessage),
      target: 'activity:' + record.id,
      image: record.image,
      publishAt: record.visibleFrom || nowStamp_(),
      expireAt: until
    } : null;

    out['notif-' + record.id + '-start'] = notify.start && record.startAt ? {
      type: competition ? 'competition' : 'activity',
      title: (competition ? '🏁 المسابقة بدأت!' : '✨ بدأت دلوقتي').slice(0, HUB_LIMITS.notificationTitle),
      message: ('«' + record.title + '»').slice(0, HUB_LIMITS.notificationMessage),
      target: 'activity:' + record.id,
      publishAt: record.startAt,
      expireAt: until
    } : null;

  }

  if (kind === 'sessions') {

    out['notif-session-' + record.date] = notify.topic && record.topic && record.status !== 'cancelled' ? {
      type: 'meeting',
      title: 'موضوع الاجتماع الجاي',
      message: (record.topic + (record.speaker ? ' — ' + record.speaker : '')).slice(0, HUB_LIMITS.notificationMessage),
      target: 'meeting',
      image: record.image,
      publishAt: record.visibleFrom || nowStamp_(),
      expireAt: record.date + ' ' + (record.time || '23:59')
    } : null;

  }

  return out;

}


/**
 * Creates/updates/deletes the linked rows. An existing row keeps the admin's
 * own wording; only its timing and target follow the item.
 */
function syncLinkedNotifications_(kind, record, notify) {

  var wanted = linkedNotifications_(kind, record, notify);

  Object.keys(wanted).forEach(function (id) {

    var exists = !!findRow_('Notifications', 'id', id);
    var fields = wanted[id];

    if (!fields) {
      if (exists) deleteRow_('Notifications', 'id', id);
      return;
    }

    if (exists) {
      upsertRow_('Notifications', 'id', {
        id: id,
        target: fields.target,
        publishAt: fields.publishAt,
        expireAt: fields.expireAt,
        updatedAt: nowStamp_()
      });
      return;
    }

    upsertRow_('Notifications', 'id', Object.assign({ id: id, enabled: true, image: '', updatedAt: nowStamp_() }, fields));

  });

}


/* Linked rows of an item (for delete). */
function linkedIds_(kind, key) {

  if (kind === 'games') return ['notif-' + key + '-soon', 'notif-' + key + '-start'];
  if (kind === 'news') return ['notif-' + key];
  if (kind === 'sessions') return ['notif-session-' + key];
  if (kind === 'activities') return ['notif-' + key, 'notif-' + key + '-start'];

  return [];

}


/* =========================================================
   API
========================================================= */

/**
 * input: the item's fields; for an existing item its key (id, or the
 * original date for sessions as input.originalDate); input.notify: linked
 * notification checkboxes.
 */
/* the edit locks a save touches (Presence.gs): an existing item's, never a new one's */
function itemLockKeys_(kind, spec, input, record) {

  if (spec.key === 'id') {
    var id = contentLine_(input.id);
    return id ? [kind + ':' + id] : [];
  }

  if (kind === 'types') {
    return input.isNew ? [] : [kind + ':' + record.key];
  }

  // sessions: the date it had, and the date it moves to
  return [contentLine_(input.originalDate), record.date].filter(Boolean).map(function (date) { return kind + ':' + date; });

}


function apiSaveItem(kind, input) {

  assertAdmin_();

  var spec = itemKind_(kind);

  input = input || {};

  ensureTable_(spec.table);

  if (kind !== 'notifications') {
    ensureTable_('Notifications');
  }

  var problems = [];
  var record = ITEM_VALIDATORS[kind](input, problems);

  if (problems.length) {
    fail_(problems);
  }

  return mutate_(kind + '.save', '', function () {

    // someone else is editing it right now (Presence.gs; API mode only)
    assertUnlocked_(itemLockKeys_(kind, spec, input, record));

    if (spec.key === 'id') {

      var existing = contentLine_(input.id);

      if (existing) {
        validId_(existing);
      }

      record.id = existing || (spec.prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8));

    }
    else if (kind === 'types') {

      var exists = !!findRow_(spec.table, 'key', record.key);

      if (input.isNew && exists) {
        throw new Error('في نوع بنفس المفتاح ده');
      }

      if (!input.isNew && !exists) {
        throw new Error('النوع مش موجود');
      }

    }
    else {

      var original = contentLine_(input.originalDate);
      var clash = findRow_(spec.table, 'date', record.date);

      if (clash && record.date !== original) {
        throw new Error('في اجتماع متسجل بنفس التاريخ ده');
      }

      if (original && original !== record.date) {
        validId_(original);
        deleteRow_(spec.table, 'date', original);
        linkedIds_(kind, original).forEach(function (id) { deleteRow_('Notifications', 'id', id); });
      }

    }

    record.updatedAt = nowStamp_();
    upsertRow_(spec.table, spec.key, record);

    if (kind !== 'notifications' && kind !== 'types') {
      syncLinkedNotifications_(kind, record, input.notify);
    }

    return record[spec.key] + ' ' + (record.title || record.topic || record.label || '');

  });

}


function apiDeleteItem(kind, key) {

  assertAdmin_();
  validId_(key);

  var spec = itemKind_(kind);

  if (kind === 'types' && readOptionalTable_('Activities').some(function (a) { return a.type === key; })) {
    throw appError_('النوع ده عليه فعاليات، ومينفعش يتمسح.', 'غيّر نوعها أو امسحها الأول، أو اقفل النوع بدل ما تمسحه.');
  }

  return mutate_(kind + '.delete', key, function () {

    // someone else is editing it right now (Presence.gs; API mode only)
    assertUnlocked_(kind + ':' + key);

    ensureTable_(spec.table);

    if (!deleteRow_(spec.table, spec.key, key)) {
      throw new Error(spec.label + ' مش موجود');
    }

    if (kind !== 'notifications' && spreadsheet_().getSheetByName('Notifications')) {
      linkedIds_(kind, key).forEach(function (id) { deleteRow_('Notifications', 'id', id); });
    }

  });

}


/*
 * The archive: old items leave the daily lists and the site, without
 * being deleted. They can come back, or be reused as a copy.
 */
function apiSetItemArchived(kind, key, archived) {

  assertAdmin_();
  validId_(key);

  var spec = itemKind_(kind);

  if (!spec.archive) {
    throw new Error('النوع ده مبيتأرشفش');
  }

  return mutate_(kind + (archived ? '.archive' : '.unarchive'), key, function () {

    // someone else is editing it right now (Presence.gs; API mode only)
    assertUnlocked_(kind + ':' + key);

    ensureTable_(spec.table);

    if (!headerIndex_(sheet_(spec.table)).archived) {
      throw appError_('الأرشيف محتاج ترقية البيانات الأول.', 'من الإعدادات ← ترقية البيانات.');
    }

    if (!findRow_(spec.table, spec.key, key)) {
      throw new Error(spec.label + ' مش موجود');
    }

    var record = { archived: archived === true, updatedAt: nowStamp_() };
    record[spec.key] = key;
    upsertRow_(spec.table, spec.key, record);

  });

}


/** «استخدم تاني»: a hidden copy without dates, ready to edit. */
function apiDuplicateItem(kind, key) {

  assertAdmin_();
  validId_(key);

  var spec = itemKind_(kind);

  if (spec.key !== 'id') {
    throw new Error('النوع ده مبيتنسخش');
  }

  var copyId = null;

  var state = mutate_(kind + '.duplicate', key, function () {

    var row = readTable_(spec.table).filter(function (r) { return r[spec.key] === key; })[0];

    if (!row) {
      throw new Error(spec.label + ' مش موجود');
    }

    var copy = {};

    TABLES[spec.table].columns.forEach(function (column) {
      if (/^(publishAt|expireAt|visibleFrom|visibleUntil|startAt|endAt)$/.test(column)) return;
      copy[column] = row[column];
    });

    copyId = spec.prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    copy.id = copyId;
    copy.title = String(row.title || '').slice(0, 70) + ' (نسخة)';
    copy.enabled = false;
    copy.archived = false;
    copy.updatedAt = nowStamp_();

    upsertRow_(spec.table, 'id', copy);

    return copyId;

  });

  return { state: state, id: copyId };

}


function apiSetItemEnabled(kind, key, enabled) {

  assertAdmin_();
  validId_(key);

  var spec = itemKind_(kind);

  return mutate_(kind + '.toggle', key + ' ' + enabled, function () {

    // someone else is editing it right now (Presence.gs; API mode only)
    assertUnlocked_(kind + ':' + key);

    ensureTable_(spec.table);

    if (!findRow_(spec.table, spec.key, key)) {
      throw new Error(spec.label + ' مش موجود');
    }

    var record = { enabled: enabled === true, updatedAt: nowStamp_() };
    record[spec.key] = key;

    upsertRow_(spec.table, spec.key, record);

  });

}
