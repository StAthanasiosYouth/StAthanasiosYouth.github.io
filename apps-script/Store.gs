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
    columns: ['key', 'title', 'order', 'enabled'],
    bool: ['enabled'],
    text: ['key', 'title'],
    notes: {
      key: 'مفتاح القسم بالإنجليزي الصغير (مثلاً social). اللينكات بتتربط بيه',
      title: 'عنوان القسم اللي بيظهر في الصفحة',
      order: 'الترتيب: الأصغر يظهر الأول',
      enabled: 'إظهار القسم'
    }
  },

  Links: {
    columns: ['id', 'enabled', 'order', 'section', 'style', 'featured', 'title', 'subtitle', 'cta', 'url', 'icon', 'badge', 'startAt', 'endAt', 'updatedAt'],
    bool: ['enabled', 'featured'],
    text: ['id', 'section', 'style', 'title', 'subtitle', 'cta', 'url', 'icon', 'badge', 'startAt', 'endAt', 'updatedAt'],
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
      updatedAt: 'آخر تعديل (تلقائي)'
    }
  },

  Contacts: {
    columns: ['id', 'enabled', 'order', 'kind', 'name', 'role', 'description', 'phone', 'method', 'message', 'updatedAt'],
    bool: ['enabled'],
    text: ['id', 'kind', 'name', 'role', 'description', 'phone', 'method', 'message', 'updatedAt'],
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

var LOG_MAX_ROWS = 3000;


/* =========================================================
   SPREADSHEET ACCESS
========================================================= */

function spreadsheet_() {

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


/**
 * Rows as plain objects ({ column: value, __row: sheetRowNumber }).
 * Only the columns we know are read; extra columns someone adds are kept
 * in the Sheet but ignored.
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

  var rows = [];

  for (var r = 1; r < values.length; r++) {

    var line = values[r];

    if (line.every(function (cell) { return cell === '' || cell === null; })) {
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
    contacts: readTable_('Contacts').map(strip)
  };

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
 * Writes record fields into the row identified by idColumn (or appends a
 * row). Only the given fields change; other columns keep their values.
 */
function upsertRow_(name, idColumn, record) {

  var sheet = sheet_(name);
  var index = headerIndex_(sheet);
  var rowNumber = findRow_(name, idColumn, record[idColumn]);

  if (!rowNumber) {
    rowNumber = Math.max(sheet.getLastRow(), 1) + 1;
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

  try {
    ss = spreadsheet_();
  }
  catch (error) {
    ss = SpreadsheetApp.create('أسرة البابا أثناسيوس – بيانات الموقع');
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

  setupTable_(ss, 'Log', [], created);

  // add settings rows introduced by newer versions of the code
  addMissingSettings_();

  applyValidation_(ss);

  // remove the empty default tab
  ['Sheet1', 'ورقة1'].forEach(function (name) {
    var blank = ss.getSheetByName(name);
    if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(blank);
    }
  });

  log_(currentEmail_(), 'setup', created.length ? 'created: ' + created.join(', ') : 'checked');

  var message = (created.length
    ? 'تم تجهيز: ' + created.join('، ')
    : 'الشيت متجهز قبل كده، متغيرش حاجة في البيانات.') + '\n' + ss.getUrl();

  console.log(message);

  return message;

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


function applyValidation_(ss) {

  var checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();

  function list(values) {
    return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  }

  function columnRange(sheet, name, column) {
    var col = TABLES[name].columns.indexOf(column) + 1;
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
