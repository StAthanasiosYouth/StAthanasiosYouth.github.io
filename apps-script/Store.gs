/**
 * SHEET STORE
 *
 * The Google Sheet is the draft database. Each tab is a table whose first
 * row holds the column keys; every row below is one record. The Sheet stays
 * friendly to edit by hand (checkboxes, dropdowns, Arabic notes on headers),
 * and the admin panel reads/writes the same rows.
 *
 * Nothing here is public. Publishing (Publish.gs) turns these rows into
 * content.json through buildPublicContent() in Content.gs.
 */

var TABLES = {

  Settings: {
    columns: ['key', 'value', 'help'],
    notes: {
      key: 'اسم الإعداد (متغيرهوش)',
      value: 'القيمة',
      help: 'شرح الإعداد'
    }
  },

  Sections: {
    columns: ['key', 'title', 'order', 'enabled', 'kind', 'subtitle', 'icon', 'theme', 'banner', 'visibleFrom', 'visibleUntil', 'surface', 'surfaceMobile'],
    bool: ['enabled'],
    text: ['key', 'title', 'kind', 'subtitle', 'icon', 'theme', 'banner', 'visibleFrom', 'visibleUntil', 'surface', 'surfaceMobile'],
    notes: {
      key: 'مفتاح القسم بالإنجليزي الصغير (مثلاً social). اللينكات بتتربط بيه',
      title: 'عنوان القسم اللي بيظهر في الصفحة',
      order: 'الترتيب: الأصغر يظهر الأول',
      enabled: 'إظهار القسم (مقفول = مفيش حاجة منه بتتنشر)',
      kind: 'نوع القسم (متغيرهوش): meeting / featured / news / games / items / location / links / contacts / support / share',
      subtitle: 'سطر تحت العنوان (اختياري)',
      icon: 'أيقونة القسم (اختياري)',
      theme: 'الشكل: gold / ember / azure / rose / emerald / night',
      banner: 'معرّف صورة البانر من شيت Media (اختياري)',
      visibleFrom: 'القسم يظهر من (اختياري): 2026-10-12 18:00',
      visibleUntil: 'القسم يختفي بعد (اختياري)',
      surface: 'شكل خلفية الكروت: فاضي = تلقائي، glass = شفاف، dark = داكن، filled = ممتلئ، none = بدون خلفية',
      surfaceMobile: 'شكل الخلفية على الموبايل (فاضي = زي الكمبيوتر)'
    }
  },

  Links: {
    columns: ['id', 'enabled', 'order', 'section', 'style', 'featured', 'title', 'subtitle', 'cta', 'url', 'icon', 'badge', 'startAt', 'endAt', 'updatedAt', 'experience', 'gallery'],
    bool: ['enabled', 'featured'],
    autoId: 'link',
    text: ['id', 'section', 'style', 'title', 'subtitle', 'cta', 'url', 'icon', 'badge', 'startAt', 'endAt', 'updatedAt', 'experience', 'gallery'],
    notes: {
      id: 'معرّف ثابت للرابط. لو سبته فاضي لوحة التحكم هتعمله',
      enabled: 'إظهار الرابط',
      order: 'الترتيب: الأصغر يظهر الأول',
      section: 'القسم (من شيت Sections). الروابط المميزة ملهاش قسم',
      style: 'card = صف عريض، tile = مربع زي أيقونة التطبيق',
      featured: 'رابط مميز يظهر كبير فوق (زي صوتك يهمنا)',
      title: 'العنوان',
      subtitle: 'وصف قصير',
      cta: 'نص الزرار للروابط المميزة (مثلاً: ابعت دلوقتي)',
      url: 'اللينك كامل ويبدأ بـ https://',
      icon: 'الأيقونة',
      badge: 'شارة صغيرة زي: جديد',
      startAt: 'يبدأ يظهر من (اختياري): 2026-10-12 أو 2026-10-12 18:00',
      endAt: 'آخر ظهور (اختياري): 2026-10-20 أو 2026-10-20 22:00',
      updatedAt: 'آخر تعديل (تلقائي)',
      experience: 'التجربة اللي بتفتح قبل اللينك (مفتاح من assets/js/platforms.js زي facebook / telegram / voice)، none = يفتح على طول، فاضي = تلقائي (الأيقونة ثم الرابط)',
      gallery: 'محتوى المشهد (اختياري): أرقام من المكتبة مفصولة بفاصلة، لحد ١٢. الفيديو ممكن ياخد مقطع: vid-xxxxxxxx@37-43 (من الثانية 37 لحد 43). لو في كلام مع أي صورة أو فيديو بتتكتب JSON بدل كده: [{"id":"img-xxxxxxxx","text":"الكلام"},{"id":"vid-xxxxxxxx","start":37,"end":43},{"text":"رسالة من غير صورة","from":"them"}] — الأسهل تعدّلها من لوحة التحكم'
    }
  },

  Contacts: {
    columns: ['id', 'enabled', 'order', 'kind', 'name', 'role', 'description', 'phone', 'method', 'message', 'updatedAt', 'image', 'intro', 'reply'],
    bool: ['enabled'],
    autoId: 'contact',
    text: ['id', 'kind', 'name', 'role', 'description', 'phone', 'method', 'message', 'updatedAt', 'image', 'intro', 'reply'],
    notes: {
      id: 'معرّف ثابت',
      enabled: 'إظهار',
      order: 'الترتيب',
      kind: 'service = تواصل مع الخدمة، support = الدعم الفني (بيظهر أهدى)',
      name: 'الاسم',
      role: 'الدور',
      description: 'وصف قصير',
      phone: 'رقم التليفون (01xxxxxxxxx أو +20...)',
      method: 'call = اتصال بس، whatsapp = واتساب بس',
      message: 'رسالة الواتساب الجاهزة (اختياري)',
      updatedAt: 'آخر تعديل (تلقائي)',
      image: 'الصورة (اختياري): رقم صورة من المكتبة',
      intro: 'جملة البداية في الكارت (اختياري)، زي «عندك سؤال؟» أو رسالة الزائر في محادثة الدعم',
      reply: 'الرد اللي بيظهر في محادثة الدعم (اختياري)'
    }
  },

  Sessions: {
    columns: ['date', 'enabled', 'time', 'topic', 'speaker', 'description', 'image', 'status', 'note', 'visibleFrom', 'updatedAt', 'durationMinutes', 'program'],
    bool: ['enabled'],
    text: ['date', 'time', 'topic', 'speaker', 'description', 'image', 'status', 'note', 'visibleFrom', 'updatedAt', 'program'],
    notes: {
      date: 'تاريخ الاجتماع: 2026-10-11',
      enabled: 'ظاهر',
      time: 'الساعة لو مختلفة عن المعتاد (مثلاً 19:00)، أو فاضي',
      topic: 'الموضوع',
      speaker: 'الخادم / المتكلم',
      description: 'وصف (اختياري)',
      image: 'معرّف البوستر من شيت Media (اختياري)',
      status: 'normal = عادي، cancelled = ملغي',
      note: 'ملاحظة (مثلاً سبب الإلغاء)',
      visibleFrom: 'الموضوع يظهر من (اختياري): 2026-10-09 20:00',
      updatedAt: 'آخر تعديل (تلقائي)',
      durationMinutes: 'مدة الاجتماع ده بالدقايق لو مختلفة (اختياري)',
      program: 'برنامج الاجتماع (لوحة التحكم بتكتبه): [{"title":"تسبحة","time":"20:00","minutes":30}, ...]'
    }
  },

  News: {
    columns: ['id', 'enabled', 'featured', 'pinned', 'tone', 'title', 'summary', 'body', 'image', 'linkUrl', 'linkLabel', 'badge', 'publishAt', 'expireAt', 'updatedAt', 'archived', 'display', 'displayMobile'],
    lazy: ['display', 'displayMobile'],
    bool: ['enabled', 'featured', 'pinned', 'archived'],
    text: ['id', 'tone', 'title', 'summary', 'body', 'image', 'linkUrl', 'linkLabel', 'badge', 'publishAt', 'expireAt', 'updatedAt'],
    notes: {
      id: 'معرّف ثابت (تلقائي)',
      enabled: 'ظاهر',
      featured: 'مميز (كارت كبير)',
      pinned: 'مثبت كشريط فوق (بدل الإعلان)',
      tone: 'شكل الشريط: info / alert / celebrate',
      title: 'العنوان',
      summary: 'سطر قصير',
      body: 'التفاصيل (اختياري)',
      image: 'معرّف البوستر من شيت Media',
      linkUrl: 'لينك (اختياري، https)',
      linkLabel: 'نص زرار اللينك',
      badge: 'شارة زي: جديد',
      publishAt: 'يظهر من: 2026-10-08 20:00',
      expireAt: 'يختفي بعد (اختياري)',
      updatedAt: 'آخر تعديل (تلقائي)',
      archived: 'في الأرشيف (مش بيظهر في القايمة اليومية)',
      display: 'شكل العرض: فاضي = تلقائي، compact = كارت مدمج، side = صورة كبيرة جنب الكلام، banner = بانر عريض، stack = صورة فوق والكلام تحت',
      displayMobile: 'شكل العرض على الموبايل: فاضي = زي الكمبيوتر، auto = تلقائي، أو compact / side / banner / stack'
    }
  },

  Games: {
    columns: ['id', 'enabled', 'title', 'description', 'image', 'url', 'buttonLabel', 'visibleFrom', 'startAt', 'endAt', 'afterEnd', 'updatedAt', 'archived', 'display', 'displayMobile'],
    lazy: ['display', 'displayMobile'],
    bool: ['enabled', 'archived'],
    text: ['id', 'title', 'description', 'image', 'url', 'buttonLabel', 'visibleFrom', 'startAt', 'endAt', 'afterEnd', 'updatedAt'],
    notes: {
      id: 'معرّف ثابت (تلقائي)',
      enabled: 'ظاهر',
      title: 'اسم اللعبة',
      description: 'وصف قصير',
      image: 'معرّف البوستر من شيت Media',
      url: 'لينك اللعبة (https)',
      buttonLabel: 'نص الزرار (افتراضي: ابدأ اللعب)',
      visibleFrom: 'تظهر "قريبًا" من (اختياري)',
      startAt: 'تبدأ: 2026-10-11 22:00',
      endAt: 'تخلص: 2026-10-11 23:30',
      afterEnd: 'show = تفضل ظاهرة "انتهت" شوية، hide = تختفي',
      updatedAt: 'آخر تعديل (تلقائي)',
      archived: 'في الأرشيف',
      display: 'شكل العرض: فاضي = تلقائي، compact = كارت مدمج، side = صورة كبيرة جنب الكلام، banner = بانر عريض، stack = صورة فوق والكلام تحت',
      displayMobile: 'شكل العرض على الموبايل: فاضي = زي الكمبيوتر، auto = تلقائي، أو compact / side / banner / stack'
    }
  },

  Notifications: {
    columns: ['id', 'enabled', 'type', 'title', 'message', 'target', 'image', 'publishAt', 'expireAt', 'updatedAt', 'archived'],
    bool: ['enabled', 'archived'],
    text: ['id', 'type', 'title', 'message', 'target', 'image', 'publishAt', 'expireAt', 'updatedAt'],
    notes: {
      id: 'معرّف ثابت (تلقائي)',
      enabled: 'ظاهر',
      type: 'general / meeting / news / game / important',
      title: 'العنوان',
      message: 'الرسالة',
      target: 'بيفتح إيه: meeting أو news:id أو game:id أو لينك https',
      image: 'معرّف صورة من شيت Media (اختياري)',
      publishAt: 'يظهر في الجرس من: 2026-10-08 20:00',
      expireAt: 'يختفي بعد (اختياري، افتراضي 14 يوم)',
      updatedAt: 'آخر تعديل (تلقائي)',
      archived: 'في الأرشيف'
    }
  },

  Media: {
    columns: ['id', 'path', 'thumb', 'width', 'height', 'alt', 'mime', 'driveId', 'thumbDriveId', 'uploadedAt', 'publishedAt', 'name', 'tiny', 'color', 'hash', 'bytes', 'deletedAt'],
    text: ['id', 'path', 'thumb', 'alt', 'mime', 'driveId', 'thumbDriveId', 'uploadedAt', 'publishedAt', 'name', 'tiny', 'color', 'hash', 'deletedAt'],
    notes: {
      id: 'معرّف الصورة (تلقائي): img-… للصور، vid-… لمقاطع الفيديو',
      path: 'مكانها على الموقع بعد النشر',
      thumb: 'النسخة الصغيرة',
      width: 'العرض',
      height: 'الارتفاع',
      alt: 'وصف الصورة للي مش شايف',
      mime: 'النوع',
      driveId: 'الملف في Drive (مسودة)',
      thumbDriveId: 'النسخة الصغيرة في Drive',
      uploadedAt: 'اترفعت',
      publishedAt: 'اتنشرت على الموقع',
      name: 'اسم الصورة في المكتبة',
      tiny: 'صورة صغيرة جدًا للمكتبة (تلقائي)',
      color: 'اللون الغالب (تلقائي)',
      hash: 'بصمة الصورة لمنع التكرار (تلقائي)',
      bytes: 'الحجم بالبايت',
      deletedAt: 'اتشالت من المكتبة (بتتمسح نهائي بعدين)'
    }
  },

  Activities: {
    columns: ['id', 'enabled', 'type', 'title', 'subtitle', 'description', 'image', 'ctaLabel', 'url', 'location', 'startAt', 'endAt', 'visibleFrom', 'visibleUntil', 'order', 'archived', 'updatedAt', 'display', 'displayMobile'],
    bool: ['enabled', 'archived'],
    text: ['id', 'type', 'title', 'subtitle', 'description', 'image', 'ctaLabel', 'url', 'location', 'startAt', 'endAt', 'visibleFrom', 'visibleUntil', 'updatedAt', 'display', 'displayMobile'],
    // added by the first save that sets them (Items.gs lazyColumns_), never an upgrade step
    lazy: ['display', 'displayMobile'],
    notes: {
      id: 'معرّف ثابت (تلقائي)',
      enabled: 'ظاهر',
      type: 'النوع من شيت Types (مثلاً competition أو trip)',
      title: 'العنوان',
      subtitle: 'سطر قصير',
      description: 'التفاصيل (اختياري)',
      image: 'معرّف البوستر من شيت Media (اختياري)',
      ctaLabel: 'نص الزرار (فاضي = حسب النوع)',
      url: 'اللينك (https)',
      location: 'المكان (اختياري)',
      startAt: 'بيبدأ (اختياري): 2026-10-16 07:00',
      endAt: 'بيخلص (اختياري)',
      visibleFrom: 'يظهر من (اختياري)',
      visibleUntil: 'يختفي بعد (اختياري)',
      order: 'الترتيب',
      archived: 'في الأرشيف',
      updatedAt: 'آخر تعديل (تلقائي)',
      display: 'شكل العرض: فاضي = تلقائي، compact = كارت مدمج، side = صورة كبيرة جنب الكلام، banner = بانر عريض، stack = صورة فوق والكلام تحت',
      displayMobile: 'شكل العرض على الموبايل: فاضي = زي الكمبيوتر، auto = تلقائي، أو compact / side / banner / stack'
    }
  },

  Types: {
    columns: ['key', 'enabled', 'label', 'section', 'icon', 'theme', 'banner', 'ctaDefault', 'notifyTemplate', 'order', 'updatedAt'],
    bool: ['enabled'],
    text: ['key', 'label', 'section', 'icon', 'theme', 'banner', 'ctaDefault', 'notifyTemplate', 'updatedAt'],
    notes: {
      key: 'مفتاح النوع بالإنجليزي (مثلاً trip)',
      enabled: 'متاح في لوحة التحكم',
      label: 'اسم النوع (مثلاً رحلة)',
      section: 'القسم اللي بيظهر فيه (مفتاح من شيت Sections، مثلاً activities)',
      icon: 'الأيقونة',
      theme: 'الشكل: gold / ember / azure / rose / emerald / night',
      banner: 'معرّف البانر الافتراضي من شيت Media (اختياري)',
      ctaDefault: 'نص الزرار الافتراضي',
      notifyTemplate: 'نص الإشعار ({title} = العنوان)',
      order: 'الترتيب',
      updatedAt: 'آخر تعديل (تلقائي)'
    }
  },

  Log: {
    columns: ['time', 'user', 'action', 'details'],
    text: ['user', 'action', 'details'],
    notes: {
      time: 'الوقت',
      user: 'مين',
      action: 'العملية',
      details: 'التفاصيل'
    }
  }

};

/* tabs added after the first release: missing until setup() / migrate() runs */
var OPTIONAL_TABLES = ['Sessions', 'News', 'Games', 'Notifications', 'Media', 'Activities', 'Types'];

var LOG_MAX_ROWS = 3000;


/* =========================================================
   SPREADSHEET ACCESS
========================================================= */

/* opened once per request: openById() is slow and every table read needs it */
var openSpreadsheet_ = null;


function spreadsheet_() {

  if (openSpreadsheet_) {
    return openSpreadsheet_;
  }

  openSpreadsheet_ = findSpreadsheet_();

  return openSpreadsheet_;

}


function findSpreadsheet_() {

  var active = null;

  try {
    active = SpreadsheetApp.getActiveSpreadsheet();
  }
  catch (error) {
    active = null;
  }

  if (active) {
    return active;
  }

  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');

  if (!id) {
    throw new Error('الشيت مش متوصل. شغّل setup() مرة من محرر Apps Script.');
  }

  return SpreadsheetApp.openById(id);

}


function sheet_(name) {

  var sheet = spreadsheet_().getSheetByName(name);

  if (!sheet) {
    throw new Error('مفيش شيت باسم ' + name + '. شغّل setup() من محرر Apps Script.');
  }

  return sheet;

}


/* =========================================================
   READ
========================================================= */

function cellOut_(table, column, value, key) {

  if (value instanceof Date) {

    if (column === 'time' || column === 'updatedAt') {
      return Utilities.formatDate(value, CONTENT_TIMEZONE, 'yyyy-MM-dd HH:mm');
    }

    // a time typed into the Settings sheet becomes a Date on 1899-12-30
    if (table === 'Settings' && key === 'meeting.time') {
      return Utilities.formatDate(value, CONTENT_TIMEZONE, 'HH:mm');
    }

    var withTime = Utilities.formatDate(value, CONTENT_TIMEZONE, 'HH:mm') !== '00:00';

    return Utilities.formatDate(value, CONTENT_TIMEZONE, withTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');

  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return value;

}


function blankCell_(value) {

  return value === '' || value === null || value === undefined || value === false ||
    (typeof value === 'string' && !value.trim());

}


/**
 * The columns that decide whether a sheet row is a record.
 *
 * A row that nobody filled in is not always empty: a checkbox column stores
 * FALSE in every row it covers (setup() puts checkboxes down the whole
 * column so rows typed by hand get them too). So checkbox columns never make
 * a row exist, nor do values the code writes by itself: updatedAt, and the
 * ids ensureIds_() gives to Links/Contacts rows (older versions also gave
 * ids to the empty checkbox rows; those rows stay ignored).
 */
function recordColumns_(spec) {

  return spec.columns.filter(function (column) {
    return (spec.bool || []).indexOf(column) === -1 &&
      column !== 'updatedAt' &&
      !(spec.autoId && column === 'id');
  });

}


/**
 * Rows as plain objects ({ column: value, __row: sheetRowNumber }).
 * Only the columns we know are read; extra columns someone adds are kept
 * in the Sheet but ignored. Rows with nothing in their record columns
 * (see recordColumns_) are skipped.
 */
function readTable_(name) {

  var sheet = sheet_(name);
  var values = sheet.getDataRange().getValues();

  if (!values.length) {
    return [];
  }

  var header = values[0].map(function (cell) { return String(cell).trim(); });
  var spec = TABLES[name];

  var index = {};

  spec.columns.forEach(function (column) {
    index[column] = header.indexOf(column);
  });

  var deciding = recordColumns_(spec)
    .map(function (column) { return index[column]; })
    .filter(function (i) { return i !== -1; });

  var rows = [];

  for (var r = 1; r < values.length; r++) {

    var line = values[r];

    if (deciding.every(function (i) { return blankCell_(line[i]); })) {
      continue;
    }

    var row = { __row: r + 1 };
    var key = index.key !== undefined && index.key !== -1 ? String(line[index.key]).trim() : '';

    spec.columns.forEach(function (column) {
      row[column] = index[column] === -1 ? '' : cellOut_(name, column, line[index[column]], key);
    });

    rows.push(row);

  }

  return rows;

}


/** The draft in the shape buildPublicContent() expects. */
function readDraft_() {

  var settings = Object.create(null);

  SETTINGS_SPEC.forEach(function (spec) {
    settings[spec[0]] = '';
  });

  readTable_('Settings').forEach(function (row) {
    if (row.key) {
      settings[row.key] = row.value;
    }
  });

  var strip = function (row) {
    var copy = {};
    for (var key in row) {
      if (key !== '__row') {
        copy[key] = row[key];
      }
    }
    copy.index = row.__row - 2;
    return copy;
  };

  return {
    settings: settings,
    sections: readTable_('Sections').map(strip),
    links: readTable_('Links').map(strip),
    contacts: readTable_('Contacts').map(strip),
    sessions: readOptionalTable_('Sessions').map(strip),
    news: readOptionalTable_('News').map(strip),
    games: readOptionalTable_('Games').map(strip),
    notifications: readOptionalTable_('Notifications').map(strip),
    media: readOptionalTable_('Media').map(strip),
    activities: readOptionalTable_('Activities').map(strip),
    types: readOptionalTable_('Types').map(strip)
  };

}


/* New tabs read as empty until setup() creates them, so updating the code
   never breaks a deployment that hasn't re-run setup yet. */
function readOptionalTable_(name) {

  if (!spreadsheet_().getSheetByName(name)) {
    return [];
  }

  return readTable_(name);

}


/* =========================================================
   WRITE
========================================================= */

function headerIndex_(sheet) {

  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (cell) { return String(cell).trim(); });

  var index = {};

  header.forEach(function (column, i) {
    if (column) {
      index[column] = i + 1;
    }
  });

  return index;

}


/** Finds the sheet row where column === value (null when missing). */
function findRow_(name, column, value) {

  var match = null;

  readTable_(name).some(function (row) {
    if (String(row[column]) === String(value)) {
      match = row.__row;
      return true;
    }
    return false;
  });

  return match;

}


/**
 * The first row after the last record. Not getLastRow(): the checkbox
 * columns hold FALSE down to the bottom of the sheet, so getLastRow() is
 * always the last row of the sheet and "last row + 1" would not exist.
 */
function nextRow_(name, rows) {

  var sheet = sheet_(name);
  var last = 1;

  (rows || readTable_(name)).forEach(function (row) {
    last = Math.max(last, row.__row);
  });

  if (last + 1 > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  }

  return last + 1;

}


/**
 * Writes record fields into the row identified by idColumn (or appends a
 * row). Only the given fields change; other columns keep their values.
 */
function upsertRow_(name, idColumn, record) {

  var sheet = sheet_(name);
  var index = headerIndex_(sheet);
  var rows = readTable_(name);
  var rowNumber = null;

  rows.some(function (row) {
    if (String(row[idColumn]) === String(record[idColumn])) {
      rowNumber = row.__row;
      return true;
    }
    return false;
  });

  if (!rowNumber) {

    rowNumber = nextRow_(name, rows);

    // the row may still hold a checkbox someone ticked or an old stray id:
    // a new record starts clean (unchecked boxes, empty cells)
    var fresh = {};

    TABLES[name].columns.forEach(function (column) {
      fresh[column] = (TABLES[name].bool || []).indexOf(column) !== -1 ? false : '';
    });

    record = Object.assign(fresh, record);

  }

  Object.keys(record).forEach(function (column) {
    if (index[column]) {
      var cell = sheet.getRange(rowNumber, index[column]);
      var value = record[column];
      // keep text text: phone numbers, dates and ids must not be reinterpreted
      if (typeof value === 'string' && (TABLES[name].text || []).indexOf(column) !== -1) {
        cell.setNumberFormat('@');
      }
      cell.setValue(value);
    }
  });

  return rowNumber;

}


function deleteRow_(name, idColumn, value) {

  var rowNumber = findRow_(name, idColumn, value);

  if (rowNumber) {
    sheet_(name).deleteRow(rowNumber);
  }

  return !!rowNumber;

}


/** Writes order = 10, 20, 30... following the given id list. */
function writeOrder_(name, idColumn, ids) {

  var sheet = sheet_(name);
  var index = headerIndex_(sheet);
  var rows = readTable_(name);

  ids.forEach(function (id, i) {
    rows.some(function (row) {
      if (String(row[idColumn]) === String(id)) {
        sheet.getRange(row.__row, index.order).setValue((i + 1) * 10);
        return true;
      }
      return false;
    });
  });

}


/** Rows missing an id get a stable one (useful after manual edits). */
function ensureIds_(name, prefix) {

  var sheet = sheet_(name);
  var index = headerIndex_(sheet);

  readTable_(name).forEach(function (row) {
    if (!row.id) {
      sheet.getRange(row.__row, index.id)
        .setNumberFormat('@')
        .setValue(prefix + '-' + Utilities.getUuid().slice(0, 8));
    }
  });

}


function plainCell_(value) {

  var text = String(value === null || value === undefined ? '' : value);

  return /^[=+\-@]/.test(text) ? "'" + text : text;

}


function log_(email, action, details) {

  try {

    var sheet = sheet_('Log');

    // plain text only: a value like "=IMPORTXML(...)" must never become a formula
    sheet.appendRow([new Date(), plainCell_(email), plainCell_(action), plainCell_(String(details || '').slice(0, 1000))]);

    var extra = sheet.getLastRow() - 1 - LOG_MAX_ROWS;

    if (extra > 0) {
      sheet.deleteRows(2, extra);
    }

  }
  catch (error) {
    console.warn('log failed: ' + error);
  }

}


/* =========================================================
   SETUP (run once from the Apps Script editor)
========================================================= */

/**
 * Creates the private data Sheet (first run) and its tabs, headers,
 * validation and seed rows. Safe to run again: tabs that already have data
 * are left untouched.
 *
 * The admin lives in a STANDALONE Apps Script project (not bound to the
 * Sheet): anyone with edit access to a Sheet can open a bound script and
 * read its Script Properties, including the GitHub token. Standalone, the
 * Sheet can be shared with future admins without exposing code or token.
 *
 * Before the first run, add ADMIN_EMAILS in Project Settings > Script
 * Properties. Only people who can edit the script can do that, so there is
 * no automatic "first caller becomes admin" path to abuse.
 */
function setup() {

  assertAdmin_();

  var props = PropertiesService.getScriptProperties();
  var ss = null;
  var fresh = false;

  try {
    ss = spreadsheet_();
  }
  catch (error) {
    ss = SpreadsheetApp.create('أسرة البابا أثناسيوس – بيانات الموقع');
    openSpreadsheet_ = ss;
    fresh = true;
  }

  props.setProperty('SHEET_ID', ss.getId());

  if (!props.getProperty('GITHUB_BRANCH')) {
    props.setProperty('GITHUB_BRANCH', 'main');
  }

  ss.setSpreadsheetTimeZone(CONTENT_TIMEZONE);

  var created = [];

  setupTable_(ss, 'Settings', SETTINGS_SPEC.map(function (spec) {
    return [spec[0], spec[1], spec[2]];
  }), created);

  setupTable_(ss, 'Sections', SEED_SECTIONS.map(function (row) {
    return TABLES.Sections.columns.map(function (column) { return row[column]; });
  }), created);

  setupTable_(ss, 'Links', SEED_LINKS.map(function (row) {
    return TABLES.Links.columns.map(function (column) { return row[column] === undefined ? '' : row[column]; });
  }), created);

  setupTable_(ss, 'Contacts', SEED_CONTACTS.map(function (row) {
    return TABLES.Contacts.columns.map(function (column) { return row[column] === undefined ? '' : row[column]; });
  }), created);

  OPTIONAL_TABLES.forEach(function (name) {
    setupTable_(ss, name, name === 'Types' ? typesSeedRows_() : [], created);
  });

  setupTable_(ss, 'Log', [], created);

  // add settings rows introduced by newer versions of the code
  addMissingSettings_();

  migrateAnnouncement_();

  migrateSkipDates_();

  applyValidation_(ss);

  // remove the empty default tab
  ['Sheet1', 'ورقة1'].forEach(function (name) {
    var blank = ss.getSheetByName(name);
    if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(blank);
    }
  });

  // the same upgrade as migrate(): new columns, page sections, WhatsApp
  // link. An existing Sheet is backed up first; a new one has nothing to back up.
  var upgrade = runMigration_({ backup: !fresh });

  log_(currentEmail_(), 'setup', (created.length ? 'created: ' + created.join(', ') : 'checked') + (upgrade.changed ? ' + upgrade' : ''));

  var message = (created.length
    ? 'تم تجهيز: ' + created.join('، ')
    : 'الشيت متجهز قبل كده.') + '\n' + upgrade.lines.join('\n') + '\n' + ss.getUrl();

  console.log(message);

  return message;

}


/**
 * Read-only health report, run from the Apps Script editor: per tab, how
 * many rows the sheet has, how many are records, and how many unused rows
 * still carry an id that older versions wrote into empty checkbox rows.
 * Also times one full draft read + validation (what the panel waits for).
 */
function checkSheet() {

  assertAdmin_();

  var lines = [];

  Object.keys(TABLES).forEach(function (name) {

    var sheet = spreadsheet_().getSheetByName(name);

    if (!sheet) {
      lines.push(name + ': (مش موجود — شغّل setup)');
      return;
    }

    lines.push(name + ': ' + readTable_(name).length + ' صف بيانات من ' + sheet.getMaxRows() +
      (TABLES[name].autoId ? '، معرّفات زيادة في صفوف فاضية: ' + strayIdRows_(name).length : ''));

  });

  var started = Date.now();
  var built = buildPublicContent(readDraft_(), { now: cairoNow_(), hash: sha256Hex_ });

  lines.push('قراية المسودة + المراجعة: ' + (Date.now() - started) + ' ms');
  lines.push('أخطاء: ' + built.errors.length + '، تنبيهات: ' + built.warnings.length);

  var report = lines.join('\n');

  console.log(report);

  return report;

}


/**
 * Optional cleanup, run from the Apps Script editor: empties the id cell of
 * rows that are not records but got an automatic id (link-xxxxxxxx /
 * contact-xxxxxxxx) from older versions. Nothing else is touched; the
 * panel already ignores these rows, this only tidies the Sheet.
 */
function clearStrayIds() {

  var email = assertAdmin_();
  var lock = LockService.getScriptLock();
  var cleared = [];

  lock.waitLock(20000);

  try {

    Object.keys(TABLES).forEach(function (name) {

      if (!TABLES[name].autoId || !spreadsheet_().getSheetByName(name)) {
        return;
      }

      var sheet = sheet_(name);
      var column = headerIndex_(sheet).id;
      var rows = strayIdRows_(name);

      // consecutive rows are cleared with one call
      for (var i = 0; i < rows.length;) {
        var start = i;
        while (i + 1 < rows.length && rows[i + 1] === rows[i] + 1) {
          i++;
        }
        var count = i - start + 1;
        sheet.getRange(rows[start], column, count, 1).setValues(rows.slice(start, i + 1).map(function () { return ['']; }));
        i++;
      }

      cleared.push(name + ': ' + rows.length);

    });

    log_(email, 'clearStrayIds', cleared.join(', '));

  }
  finally {
    lock.releaseLock();
  }

  var report = 'اتمسح: ' + cleared.join('، ');

  console.log(report);

  return report;

}


/* Row numbers that are not records but hold an automatic id. */
function strayIdRows_(name) {

  var spec = TABLES[name];
  var sheet = sheet_(name);
  var values = sheet.getDataRange().getValues();

  if (!values.length) {
    return [];
  }

  var header = values[0].map(function (cell) { return String(cell).trim(); });
  var idIndex = header.indexOf('id');
  var deciding = recordColumns_(spec)
    .map(function (column) { return header.indexOf(column); })
    .filter(function (i) { return i !== -1; });
  var pattern = new RegExp('^' + spec.autoId + '-[0-9a-f]{8}$');
  var rows = [];

  if (idIndex === -1) {
    return [];
  }

  for (var r = 1; r < values.length; r++) {
    var line = values[r];
    if (pattern.test(String(line[idIndex]).trim()) && deciding.every(function (i) { return blankCell_(line[i]); })) {
      rows.push(r + 1);
    }
  }

  return rows;

}


function typesSeedRows_() {

  return SEED_TYPES.map(function (t, i) {
    return TABLES.Types.columns.map(function (column) {
      if (column === 'enabled') return true;
      if (column === 'order') return (i + 1) * 10;
      return t[column] === undefined ? '' : t[column];
    });
  });

}


function setupTable_(ss, name, seedRows, created) {

  var spec = TABLES[name];
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);

  if (sheet.getLastRow() > 0) {
    return;
  }

  var width = spec.columns.length;

  sheet.getRange(1, 1, 1, width)
    .setValues([spec.columns])
    .setFontWeight('bold')
    .setFontColor('#f2d28b')
    .setBackground('#061a31');

  spec.columns.forEach(function (column, i) {
    if (spec.notes && spec.notes[column]) {
      sheet.getRange(1, i + 1).setNote(spec.notes[column]);
    }
  });

  sheet.setFrozenRows(1);
  sheet.setRightToLeft(true);

  // text columns stay text (leading zeros, "+20", dates typed by hand)
  (spec.text || []).forEach(function (column) {
    var col = spec.columns.indexOf(column) + 1;
    sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  });

  if (name === 'Settings') {
    sheet.getRange(2, 1, sheet.getMaxRows() - 1, 2).setNumberFormat('@');
    sheet.setColumnWidth(1, 210);
    sheet.setColumnWidth(2, 380);
    sheet.setColumnWidth(3, 460);
  }

  if (seedRows.length) {
    sheet.getRange(2, 1, seedRows.length, width).setValues(seedRows);
  }

  created.push(name);

}


function addMissingSettings_() {

  var sheet = sheet_('Settings');
  var existing = Object.create(null);

  readTable_('Settings').forEach(function (row) {
    existing[row.key] = true;
  });

  SETTINGS_SPEC.forEach(function (spec) {
    if (!existing[spec[0]]) {
      sheet.appendRow([spec[0], spec[1], spec[2]]);
    }
  });

}


/**
 * The single announcement became "pinned news". An announcement that is
 * still switched on moves into the News tab once, then is switched off.
 */
function migrateAnnouncement_() {

  var rows = readTable_('Settings');
  var value = function (key) {
    var row = rows.filter(function (r) { return r.key === key; })[0];
    return row ? row.value : '';
  };

  var enabledRow = rows.filter(function (r) { return r.key === 'announcement.enabled'; })[0];

  if (!enabledRow || !contentBool_(enabledRow.value) || !contentText_(value('announcement.text'))) {
    return false;
  }

  var text = contentText_(value('announcement.text'));
  var lines = text.split('\n');

  upsertRow_('News', 'id', {
    id: 'news-' + Utilities.getUuid().slice(0, 8),
    enabled: true,
    featured: false,
    pinned: true,
    tone: ANNOUNCEMENT_TONES.indexOf(value('announcement.tone')) !== -1 ? value('announcement.tone') : 'info',
    title: lines[0].slice(0, HUB_LIMITS.newsTitle),
    summary: lines.slice(1).join(' ').slice(0, HUB_LIMITS.summary),
    linkUrl: safeHttpsUrl(value('announcement.linkUrl')),
    linkLabel: contentLine_(value('announcement.linkLabel')),
    publishAt: nowStamp_(),
    expireAt: contentLine_(value('announcement.expiresAt')),
    updatedAt: nowStamp_()
  });

  sheet_('Settings').getRange(enabledRow.__row, 2).setValue(false);

  return true;

}


/**
 * "Days without a meeting" became cancelled sessions (one place for
 * cancellations, with a note). Future dates move once; the setting empties.
 */
function migrateSkipDates_() {

  var row = readTable_('Settings').filter(function (r) { return r.key === 'meeting.skipDates'; })[0];
  var text = row ? contentDigits_(row.value) : '';

  if (!text) {
    return 0;
  }

  var today = Utilities.formatDate(new Date(), CONTENT_TIMEZONE, 'yyyy-MM-dd');
  var moved = 0;

  text.split(/[,،\s]+/).filter(Boolean).forEach(function (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || findRow_('Sessions', 'date', date)) {
      return;
    }
    upsertRow_('Sessions', 'date', { date: date, enabled: true, status: 'cancelled', updatedAt: nowStamp_() });
    moved++;
  });

  sheet_('Settings').getRange(row.__row, 2).setNumberFormat('@').setValue('');

  return moved;

}


function applyValidation_(ss) {

  var checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();

  function list(values) {
    return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  }

  function columnRange(sheet, name, column) {
    // by header name: a tab whose columns were moved by hand still works
    var col = headerIndex_(sheet)[column] || (TABLES[name].columns.indexOf(column) + 1);
    return sheet.getRange(2, col, sheet.getMaxRows() - 1, 1);
  }

  var links = ss.getSheetByName('Links');
  columnRange(links, 'Links', 'enabled').setDataValidation(checkbox);
  columnRange(links, 'Links', 'featured').setDataValidation(checkbox);
  columnRange(links, 'Links', 'style').setDataValidation(list(LINK_STYLES));
  columnRange(links, 'Links', 'icon').setDataValidation(list(ICON_NAMES));
  columnRange(links, 'Links', 'section').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(ss.getSheetByName('Sections').getRange('A2:A'), true)
      .setAllowInvalid(true)
      .build()
  );

  var sections = ss.getSheetByName('Sections');
  columnRange(sections, 'Sections', 'enabled').setDataValidation(checkbox);

  var contacts = ss.getSheetByName('Contacts');
  columnRange(contacts, 'Contacts', 'enabled').setDataValidation(checkbox);
  columnRange(contacts, 'Contacts', 'kind').setDataValidation(list(CONTACT_KINDS));
  columnRange(contacts, 'Contacts', 'method').setDataValidation(list(CONTACT_METHODS));

  var sessionsSheet = ss.getSheetByName('Sessions');
  columnRange(sessionsSheet, 'Sessions', 'enabled').setDataValidation(checkbox);
  columnRange(sessionsSheet, 'Sessions', 'status').setDataValidation(list(SESSION_STATUSES));

  var news = ss.getSheetByName('News');
  ['enabled', 'featured', 'pinned'].forEach(function (column) {
    columnRange(news, 'News', column).setDataValidation(checkbox);
  });
  columnRange(news, 'News', 'tone').setDataValidation(list(ANNOUNCEMENT_TONES));

  var games = ss.getSheetByName('Games');
  columnRange(games, 'Games', 'enabled').setDataValidation(checkbox);
  columnRange(games, 'Games', 'afterEnd').setDataValidation(list(GAME_AFTER_END));

  var notifications = ss.getSheetByName('Notifications');
  columnRange(notifications, 'Notifications', 'enabled').setDataValidation(checkbox);
  columnRange(notifications, 'Notifications', 'type').setDataValidation(list(NOTIFICATION_TYPES));

  // columns added by the schema-3 upgrade (only where they exist yet)
  function ifColumn(sheet, name, column, rule) {
    if (sheet && headerIndex_(sheet)[column]) {
      sheet.getRange(2, headerIndex_(sheet)[column], sheet.getMaxRows() - 1, 1).setDataValidation(rule);
    }
  }

  ifColumn(news, 'News', 'archived', checkbox);
  ifColumn(games, 'Games', 'archived', checkbox);
  ifColumn(notifications, 'Notifications', 'archived', checkbox);
  ifColumn(sections, 'Sections', 'theme', list(SECTION_THEMES));
  ifColumn(sections, 'Sections', 'surface', list(SECTION_SURFACES));
  ifColumn(sections, 'Sections', 'surfaceMobile', list(SECTION_SURFACES));
  ifColumn(links, 'Links', 'experience', list(linkExperiences_()));

  var activities = ss.getSheetByName('Activities');
  if (activities) {
    ifColumn(activities, 'Activities', 'enabled', checkbox);
    ifColumn(activities, 'Activities', 'archived', checkbox);
  }

  var types = ss.getSheetByName('Types');
  if (types) {
    ifColumn(types, 'Types', 'enabled', checkbox);
    ifColumn(types, 'Types', 'theme', list(SECTION_THEMES));
  }

  // boolean settings as checkboxes, tone as a dropdown
  var settings = ss.getSheetByName('Settings');

  readTable_('Settings').forEach(function (row) {
    var cell = settings.getRange(row.__row, 2);
    if (/\.enabled$/.test(row.key)) {
      cell.setNumberFormat('General');
      cell.setDataValidation(checkbox);
      if (typeof row.value !== 'boolean') {
        cell.setValue(contentBool_(row.value));
      }
    }
    else if (row.key === 'announcement.tone') {
      cell.setDataValidation(list(ANNOUNCEMENT_TONES));
    }
    else if (row.key === 'meeting.day') {
      cell.setDataValidation(list(DAY_ALIASES_LIST_()));
    }
  });

}


function DAY_ALIASES_LIST_() {

  return ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

}
