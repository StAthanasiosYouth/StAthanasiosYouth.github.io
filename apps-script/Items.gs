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
  news: { table: 'News', key: 'id', prefix: 'news', label: 'الخبر' },
  games: { table: 'Games', key: 'id', prefix: 'game', label: 'اللعبة' },
  notifications: { table: 'Notifications', key: 'id', prefix: 'notif', label: 'الإشعار' }
};


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

  if (!/^img-[a-z0-9]{8}$/.test(id) || !findRow_('Media', 'id', id)) {
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

  notifications: function (input, problems) {

    var target = contentLine_(input.target);
    var match = /^(news|game):([\w-]{1,60})$/.exec(target);

    if (!target || target === 'meeting') {
      // fine
    }
    else if (match) {
      ensureTable_(match[1] === 'news' ? 'News' : 'Games');
      if (!findRow_(match[1] === 'news' ? 'News' : 'Games', 'id', match[2])) {
        problems.push('الإشعار بيشاور على حاجة مش موجودة');
      }
    }
    else if (safeHttpsUrl(target)) {
      target = safeHttpsUrl(target);
    }
    else {
      problems.push('الوجهة لازم تكون الاجتماع أو خبر أو لعبة أو لينك https');
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

    if (spec.key === 'id') {

      var existing = contentLine_(input.id);

      if (existing) {
        validId_(existing);
      }

      record.id = existing || (spec.prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8));

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

    if (kind !== 'notifications') {
      syncLinkedNotifications_(kind, record, input.notify);
    }

    return record[spec.key] + ' ' + (record.title || record.topic || '');

  });

}


function apiDeleteItem(kind, key) {

  assertAdmin_();
  validId_(key);

  var spec = itemKind_(kind);

  return mutate_(kind + '.delete', key, function () {

    ensureTable_(spec.table);

    if (!deleteRow_(spec.table, spec.key, key)) {
      throw new Error(spec.label + ' مش موجود');
    }

    if (kind !== 'notifications' && spreadsheet_().getSheetByName('Notifications')) {
      linkedIds_(kind, key).forEach(function (id) { deleteRow_('Notifications', 'id', id); });
    }

  });

}


function apiSetItemEnabled(kind, key, enabled) {

  assertAdmin_();
  validId_(key);

  var spec = itemKind_(kind);

  return mutate_(kind + '.toggle', key + ' ' + enabled, function () {

    ensureTable_(spec.table);

    if (!findRow_(spec.table, spec.key, key)) {
      throw new Error(spec.label + ' مش موجود');
    }

    var record = { enabled: enabled === true, updatedAt: nowStamp_() };
    record[spec.key] = key;

    upsertRow_(spec.table, spec.key, record);

  });

}
