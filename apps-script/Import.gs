/**
 * «استيراد جدول الاجتماعات»: many future meetings at once.
 *
 * The admin pastes rows copied from Excel / Google Sheets (tab separated)
 * or uploads a .csv; the page sends that text as it is. Here it is parsed
 * (header in Arabic or English, dates YYYY-MM-DD or DD/MM/YYYY, Arabic
 * digits, 12-hour times with ص/م), checked row by row, and compared with
 * the meetings already in the Sheet:
 *
 *   apiImportPreview(text)            read-only: per row add / update (what
 *                                     changes) / skip (identical) / error /
 *                                     locked (another admin is editing it)
 *   apiImportApply(text, decisions)   under the script lock, again from the
 *                                     text: adds and updates the admin ticked.
 *
 * Never a silent overwrite: an update happens only when the admin ticked
 * it in the preview AND the meeting is still exactly what the preview
 * showed (a fingerprint of its fields). Empty cells never blank a field.
 * Every row goes through the meetings editor's own validation
 * (ITEM_VALIDATORS.sessions, Items.gs). Posters stay optional; no bell
 * notifications are created (months of topics would all ring at once).
 *
 * The parsing functions are pure (no Google services): tests/prog-b.test.mjs.
 */

var IMPORT_MAX_ROWS = 500;
var IMPORT_MAX_TEXT = 300000;

/* the columns a meeting row can have, and the words a header may use for them */
var IMPORT_COLUMNS = [
  { key: 'date', label: 'التاريخ', names: ['date', 'day', 'التاريخ', 'تاريخ', 'اليوم', 'تاريخ الاجتماع'] },
  { key: 'topic', label: 'الموضوع', names: ['topic', 'title', 'subject', 'الموضوع', 'موضوع', 'العنوان', 'عنوان', 'موضوع الاجتماع'] },
  { key: 'speaker', label: 'المتكلم', names: ['speaker', 'servant', 'المتكلم', 'متكلم', 'الخادم', 'خادم', 'المتحدث', 'متحدث', 'الخادم / المتكلم', 'الخادم/المتكلم', 'المتكلم / الخادم'] },
  { key: 'description', label: 'الوصف', names: ['description', 'details', 'الوصف', 'وصف', 'التفاصيل', 'تفاصيل'] },
  { key: 'time', label: 'الوقت', names: ['time', 'hour', 'الوقت', 'وقت', 'الساعة', 'ساعة', 'الميعاد', 'ميعاد'] },
  { key: 'note', label: 'ملاحظات', names: ['notes', 'note', 'remarks', 'ملاحظات', 'ملاحظة', 'ملاحظه'] }
];

/* the order of a file without a header row */
var IMPORT_DEFAULT_ORDER = ['date', 'topic', 'speaker', 'description', 'time', 'note'];

/* the fields an import may set, with their limits (same as the editor) */
function importFields_() {

  return [
    { key: 'topic', label: 'الموضوع', max: HUB_LIMITS.topic },
    { key: 'speaker', label: 'المتكلم', max: HUB_LIMITS.speaker },
    { key: 'description', label: 'الوصف', max: HUB_LIMITS.sessionDescription },
    { key: 'time', label: 'الوقت' },
    { key: 'note', label: 'ملاحظات', max: LIMITS.note }
  ];

}


/* =========================================================
   PARSING (pure)
========================================================= */

/* header words compared loosely: case, spaces, hamza forms, ة/ه, ى/ي, tatweel */
function importWord_(value) {

  return String(value === null || value === undefined ? '' : value)
    .replace(/^﻿/, '')
    .replace(/[‎‏؜ـ]/g, '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\s_\-:]+/g, '')
    .trim();

}

function importColumnOf_(cell) {

  var word = importWord_(cell);

  if (!word) return '';

  for (var i = 0; i < IMPORT_COLUMNS.length; i++) {
    var names = IMPORT_COLUMNS[i].names.map(importWord_);
    if (names.indexOf(word) !== -1) return IMPORT_COLUMNS[i].key;
  }

  return '';

}

/**
 * Text → lines of cells. Tab separated (pasted from a spreadsheet) when the
 * first line has a tab; otherwise CSV with "," (or ";" when that is what
 * the first line uses, as Excel does in some locales). Quotes per RFC 4180,
 * including line breaks inside a quoted cell. A UTF-8 BOM is dropped.
 */
function importCells_(text) {

  text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  var firstLine = text.split('\n')[0] || '';
  var separator = firstLine.indexOf('\t') !== -1 ? '\t'
    : (firstLine.split(';').length > firstLine.split(',').length ? ';' : ',');
  var lines = [];
  var line = [];
  var cell = '';
  var quoted = false;
  var lineNumber = 1;
  var startLine = 1;

  function endCell() {
    line.push(cell);
    cell = '';
  }

  function endLine() {
    endCell();
    lines.push({ line: startLine, cells: line });
    line = [];
    startLine = lineNumber + 1;
  }

  for (var i = 0; i < text.length; i++) {

    var c = text.charAt(i);

    if (quoted) {
      if (c === '"' && text.charAt(i + 1) === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else {
        if (c === '\n') lineNumber++;
        cell += c;
      }
      continue;
    }

    if (c === '"' && cell.replace(/\s/g, '') === '') { cell = ''; quoted = true; }
    else if (c === separator) endCell();
    else if (c === '\n') { endLine(); lineNumber++; }
    else cell += c;

  }

  if (cell !== '' || line.length) endLine();

  return {
    separator: separator,
    lines: lines.filter(function (l) { return l.cells.some(function (v) { return contentLine_(v) !== ''; }); })
  };

}

/* digits and dashes inside an Arabic sentence: kept left-to-right (Unicode isolate) */
function ltr_(text) {

  return '⁦' + String(text) + '⁩';

}

/* 'YYYY-MM-DD' from YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, D/M/YYYY (Arabic digits too); null when not a date */
function importDate_(value) {

  var text = contentDigits_(String(value === null || value === undefined ? '' : value))
    .replace(/[‎‏؜]/g, '')
    .replace(/[٫٬]/g, '/')
    .trim()
    // a spreadsheet may add midnight: "2026-10-11 00:00:00"
    .replace(/[ T]0?0:00(:00)?$/, '');

  var y, m, d, match;

  if ((match = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(text))) {
    y = match[1]; m = match[2]; d = match[3];
  }
  else if ((match = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(text))) {
    // Egypt writes the day first
    d = match[1]; m = match[2]; y = match[3];
  }
  else {
    return null;
  }

  var stamp = contentDateTime_(y + '-' + m + '-' + d, false);

  return stamp ? stamp.slice(0, 10) : null;

}

/* 'HH:MM' | '' | null, with 12-hour times (ص/م, am/pm) and seconds dropped */
function importTime_(value) {

  var text = contentDigits_(String(value === null || value === undefined ? '' : value))
    .replace(/[‎‏؜]/g, '')
    .trim()
    .replace(/^(\d{1,2}:\d{2}):\d{2}/, '$1');

  return contentTime_(text);

}

/**
 * The whole paste / file → rows, each checked on its own (no Sheet access):
 * { columns: ['date', …], rows: [{ line, date, values: { topic, … }, errors: [], warnings: [] }],
 *   problems: ['…'] (the file as a whole), ignored: ['header', …] }
 * today 'YYYY-MM-DD' (Cairo): earlier dates are flagged (a warning).
 */
function parseImport_(text, today) {

  var problems = [];

  if (String(text || '').length > IMPORT_MAX_TEXT) {
    return { columns: [], rows: [], ignored: [], problems: ['الملف كبير قوي. قسّمه لأكتر من مرة (لحد ' + IMPORT_MAX_ROWS + ' اجتماع في المرة).'] };
  }

  var table = importCells_(text);

  if (!table.lines.length) {
    return { columns: [], rows: [], ignored: [], problems: ['مفيش صفوف. الصق الصفوف من إكسل أو جوجل شيت، أو اختار ملف CSV.'] };
  }

  // a header row: at least the date column named
  var header = table.lines[0].cells.map(importColumnOf_);
  var hasHeader = header.indexOf('date') !== -1;
  var ignored = [];
  var columns;
  var body;

  if (hasHeader) {
    columns = header;
    table.lines[0].cells.forEach(function (cell, i) {
      if (!header[i] && contentLine_(cell)) ignored.push(contentLine_(cell));
    });
    // a column named twice: the first one counts
    columns = columns.map(function (key, i) { return key && columns.indexOf(key) === i ? key : ''; });
    body = table.lines.slice(1);
  }
  else if (importDate_(table.lines[0].cells[0]) !== null) {
    columns = IMPORT_DEFAULT_ORDER.slice();
    body = table.lines;
  }
  else {
    return { columns: [], rows: [], ignored: [], problems: ['أول صف لازم يكون العناوين وفيهم «التاريخ» (أو date). نزّل النموذج وامشي عليه.'] };
  }

  if (body.length > IMPORT_MAX_ROWS) {
    problems.push('الملف فيه ' + body.length + ' صف، والحد ' + IMPORT_MAX_ROWS + ' في المرة. قسّمه.');
    body = body.slice(0, IMPORT_MAX_ROWS);
  }

  var fields = importFields_();
  var byDate = Object.create(null);

  var rows = body.map(function (entry) {

    var raw = {};
    columns.forEach(function (key, i) {
      if (key) raw[key] = entry.cells[i] === undefined ? '' : entry.cells[i];
    });

    var row = { line: entry.line, date: '', values: {}, errors: [], warnings: [] };
    var dateText = contentLine_(raw.date);
    var date = importDate_(dateText);

    if (!dateText) row.errors.push('التاريخ ناقص');
    else if (date === null) row.errors.push('التاريخ «' + ltr_(dateText) + '» مش مفهوم (اكتبه ' + ltr_('2026-10-11') + ' أو ' + ltr_('11/10/2026') + ')');
    else row.date = date;

    if (row.date && today && row.date < today) {
      row.warnings.push('التاريخ ده فات');
    }

    fields.forEach(function (field) {
      if (raw[field.key] === undefined) return;
      if (field.key === 'time') {
        var timeText = contentLine_(raw.time);
        var time = importTime_(timeText);
        if (time === null) row.errors.push('الوقت «' + ltr_(timeText) + '» مش مفهوم (اكتبه ' + ltr_('20:00') + ' أو 8:00 م)');
        else row.values.time = time;
        return;
      }
      var value = field.key === 'description' ? contentText_(raw[field.key]).replace(/\n{3,}/g, '\n\n') : contentLine_(raw[field.key]);
      if (value.length > field.max) row.errors.push(field.label + ' أطول من ' + field.max + ' حرف');
      row.values[field.key] = value;
    });

    if (row.date) (byDate[row.date] = byDate[row.date] || []).push(row);

    return row;

  });

  // the same date twice in the file: none of them is taken (which one is right?)
  Object.keys(byDate).forEach(function (date) {
    var same = byDate[date];
    if (same.length < 2) return;
    same.forEach(function (row) {
      var others = same.filter(function (r) { return r !== row; }).map(function (r) { return r.line; });
      row.errors.push('التاريخ ده متكرر في الملف (سطر ' + others.join('، ') + ')');
    });
  });

  return { columns: columns.filter(Boolean), rows: rows, ignored: ignored, problems: problems };

}

/* the fields of a stored meeting the preview compares */
function importBase_(existing) {

  var fields = { date: existing.date, status: existing.status || 'normal' };

  importFields_().forEach(function (field) {
    fields[field.key] = contentText_(existing[field.key]);
  });

  fields.time = contentTime_(fields.time) || '';

  return sha256Hex_(JSON.stringify(fields)).slice(0, 16);

}

/**
 * Parsed rows + the meetings in the Sheet (by date) → what would happen:
 * row.action 'error' | 'add' | 'update' | 'skip', row.changes [{ field, label, from, to }],
 * row.base (update: the fingerprint of the meeting as shown).
 */
function planImport_(parsed, existingByDate) {

  var fields = importFields_();

  parsed.rows.forEach(function (row) {

    row.changes = [];

    if (row.errors.length) {
      row.action = 'error';
      return;
    }

    var existing = existingByDate[row.date];

    if (!existing) {
      row.action = 'add';
      return;
    }

    fields.forEach(function (field) {
      var to = row.values[field.key];
      // an empty cell never blanks what is there
      if (to === undefined || to === '') return;
      var from = field.key === 'time' ? (contentTime_(existing.time) || '') : contentText_(existing[field.key]);
      if (from !== to) row.changes.push({ field: field.key, label: field.label, from: from, to: to });
    });

    row.base = importBase_(existing);
    row.action = row.changes.length ? 'update' : 'skip';

    if (row.action === 'skip') row.reason = 'نفس اللي متسجل';
    if (existing.status === 'cancelled' && row.changes.length) row.warnings.push('الاجتماع ده متسجل «ملغي» وهيفضل ملغي');

  });

  return parsed;

}


/* =========================================================
   API
========================================================= */

function importExisting_() {

  var byDate = Object.create(null);

  readTable_('Sessions').forEach(function (row) {
    var date = contentDigits_(row.date);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) byDate[date] = row;
  });

  return byDate;

}

function importCounts_(rows) {

  var counts = { add: 0, update: 0, skip: 0, error: 0, locked: 0 };

  rows.forEach(function (row) { counts[row.action] = (counts[row.action] || 0) + 1; });

  return counts;

}

/* what the page shows of a row (nothing else of the Sheet) */
function importRowOut_(row) {

  return {
    line: row.line,
    date: row.date,
    action: row.action,
    values: row.values,
    changes: row.changes || [],
    base: row.base || '',
    errors: row.errors,
    warnings: row.warnings,
    reason: row.reason || '',
    holder: row.holder || null
  };

}

/** Read-only: what importing this text would do, row by row. */
function apiImportPreview(text) {

  assertAdmin_();
  ensureTable_('Sessions');

  var parsed = planImport_(parseImport_(text, cairoNow_().slice(0, 10)), importExisting_());

  // another admin is editing that meeting right now (Presence.gs, API mode only)
  parsed.rows.forEach(function (row) {
    if (row.action !== 'add' && row.action !== 'update') return;
    var holder = lockHolder_('sessions:' + row.date);
    if (holder) {
      row.action = 'locked';
      row.holder = { name: holder.name, device: holder.device };
      row.reason = holder.name + ' بيعدّل الاجتماع ده دلوقتي';
    }
  });

  return {
    columns: parsed.columns,
    ignored: parsed.ignored,
    problems: parsed.problems,
    rows: parsed.rows.map(importRowOut_),
    counts: importCounts_(parsed.rows),
    max: IMPORT_MAX_ROWS
  };

}

/**
 * decisions: { 'YYYY-MM-DD': 'add' | 'update:<base>' } — the rows the admin
 * ticked. An add happens only for a date still free; an update only when
 * the meeting is still exactly what the preview showed. Everything else is
 * reported, never forced.
 * → { added, updated, skipped, errors, rows: [{ line, date, result, reason }], state }
 */
function apiImportApply(text, decisions) {

  var email = assertAdmin_();

  ensureTable_('Sessions');

  decisions = decisions && typeof decisions === 'object' && !Array.isArray(decisions) ? decisions : {};

  var lock = LockService.getScriptLock();
  var report = { added: 0, updated: 0, skipped: 0, errors: 0, rows: [] };

  lock.waitLock(30000);

  try {

    var existing = importExisting_();
    var parsed = planImport_(parseImport_(text, cairoNow_().slice(0, 10)), existing);
    var adds = [];
    var updates = [];

    if (parsed.problems.length && !parsed.rows.length) {
      throw appError_(parsed.problems[0], '');
    }

    parsed.rows.forEach(function (row) {

      var wanted = Object.prototype.hasOwnProperty.call(decisions, row.date) ? String(decisions[row.date]) : '';
      var result = function (kind, reason) {
        report.rows.push({ line: row.line, date: row.date, result: kind, reason: reason || '' });
        if (kind === 'error') report.errors++;
        else if (kind === 'skipped') report.skipped++;
      };

      if (row.action === 'error') { result('error', row.errors.join('، ')); return; }
      if (row.action === 'skip') { result('skipped', row.reason || 'نفس اللي متسجل'); return; }

      // ticked for exactly this, against exactly what was shown
      if (row.action === 'add' && wanted !== 'add') {
        result('skipped', wanted.indexOf('update:') === 0 ? 'اتغير من بعد المعاينة' : 'مش متعلّم عليه');
        return;
      }
      if (row.action === 'update' && wanted !== 'update:' + row.base) {
        result('skipped', wanted === '' ? 'التعديل مش متعلّم عليه' : 'الاجتماع اتغير من بعد المعاينة — اعمل معاينة تاني');
        return;
      }

      var holder = lockHolder_('sessions:' + row.date);
      if (holder) { result('skipped', holder.name + ' بيعدّل الاجتماع ده دلوقتي'); return; }

      // the meetings editor's own validation, on the whole meeting as it would be
      var current = existing[row.date] || {};
      var input = {
        date: row.date,
        time: current.time || '',
        durationMinutes: current.durationMinutes === undefined ? '' : current.durationMinutes,
        topic: current.topic || '',
        speaker: current.speaker || '',
        description: current.description || '',
        image: current.image || '',
        status: current.status || 'normal',
        note: current.note || '',
        visibleFrom: current.visibleFrom || '',
        enabled: row.action === 'add' ? true : contentBool_(current.enabled)
      };

      Object.keys(row.values).forEach(function (key) {
        if (row.values[key] !== '') input[key] = row.values[key];
      });

      var problems = [];
      var record = ITEM_VALIDATORS.sessions(input, problems);

      if (problems.length) { result('error', problems.join('، ')); return; }

      record.updatedAt = nowStamp_();

      if (row.action === 'add') {
        adds.push(record);
        report.rows.push({ line: row.line, date: row.date, result: 'added', reason: '' });
      }
      else {
        var patch = { date: row.date, updatedAt: record.updatedAt };
        row.changes.forEach(function (change) { patch[change.field] = record[change.field]; });
        updates.push({ row: current.__row, patch: patch });
        report.rows.push({ line: row.line, date: row.date, result: 'updated', reason: row.changes.map(function (c) { return c.label; }).join('، ') });
      }

    });

    writeImportedSessions_(adds, updates);

    report.added = adds.length;
    report.updated = updates.length;

    log_(email, 'sessions.import', 'added ' + report.added + ', updated ' + report.updated + ', skipped ' + report.skipped + ', errors ' + report.errors +
      (adds.length ? ' | + ' + adds.map(function (r) { return r.date; }).join(' ') : '') +
      (updates.length ? ' | ~ ' + updates.map(function (u) { return u.patch.date; }).join(' ') : ''));

  }
  finally {
    lock.releaseLock();
  }

  report.state = apiStateFor_(email);

  return report;

}

/* new rows in one block after the last record; updates cell by cell (only the changed fields) */
function writeImportedSessions_(adds, updates) {

  if (!adds.length && !updates.length) return;

  var sheet = sheet_('Sessions');
  var index = headerIndex_(sheet);
  var spec = TABLES.Sessions;
  var text = spec.text || [];
  var bools = spec.bool || [];

  updates.forEach(function (update) {
    Object.keys(update.patch).forEach(function (column) {
      if (column === 'date' || !index[column]) return;
      var cell = sheet.getRange(update.row, index[column]);
      var value = update.patch[column];
      if (typeof value === 'string' && text.indexOf(column) !== -1) cell.setNumberFormat('@');
      cell.setValue(value);
    });
  });

  if (!adds.length) return;

  var width = sheet.getLastColumn();
  var first = nextRow_('Sessions');
  var last = first + adds.length - 1;

  if (last > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), last - sheet.getMaxRows());
  }

  var names = [];
  Object.keys(index).forEach(function (name) { names[index[name] - 1] = name; });

  var values = adds.map(function (record) {
    var line = [];
    for (var c = 0; c < width; c++) {
      var column = names[c];
      if (column && record[column] !== undefined) line.push(record[column]);
      else line.push(column && bools.indexOf(column) !== -1 ? false : '');
    }
    return line;
  });

  // text stays text (dates, times typed as "20:00")
  text.forEach(function (column) {
    if (index[column]) sheet.getRange(first, index[column], adds.length, 1).setNumberFormat('@');
  });

  sheet.getRange(first, 1, adds.length, width).setValues(values);

}
