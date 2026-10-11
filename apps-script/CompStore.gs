/**
 * COMPETITIONS: STORAGE. docs/COMPETITIONS.md §1.
 *
 * A separate, private spreadsheet (Script Property COMP_SHEET_ID), created
 * by the first admin write under the script lock — never by a public call
 * (no spreadsheet = `not_found` for the public). Tabs are made on first use
 * from COMP_TABLES: bold frozen header, every column '@' text, missing
 * columns appended on the right (never moved, never deleted).
 *
 * Unlike Store.gs (per-cell upsertRow_), everything here is batched: a row
 * is one setValues, list views read only the columns they need, an import
 * appends one block. Every written text goes through plainCell_ (no
 * formula injection) and is read back without the protecting apostrophe.
 *
 * Locks: draft tabs under the script lock (admin functions); live tabs
 * (Submissions, and later the ledger / redemptions) under compLock_():
 * LockService.getUserLock() — every API request runs as the owner, so it
 * is one shared mutex, separate from the script lock a publish holds —
 * falling back to the script lock.
 *
 * Caches (CacheService, never a source of truth): comp:draft (+ comp:draftsig),
 * comp:live:<slug>, comp:def:<compId>:<version>.
 */

var COMP_SHEET_TITLE = 'Athanasios — Competitions (private)';
var COMP_SCHEMA_VERSION = '1';

var COMP_TABLES = {
  Competitions: ['id', 'slug', 'title', 'shortTitle', 'description', 'instructions', 'ctaLabel', 'banner', 'icon', 'theme',
    'startAt', 'endAt', 'participation', 'scoring', 'resultShow', 'resultsAt', 'answersShow', 'answersAt', 'showPoints', 'wallet',
    'attempts', 'layout', 'shuffleQ', 'shuffleC', 'timeLimit', 'maxSubmissions', 'uniquePhone', 'fields', 'successText', 'enabled',
    'cardId', 'liveVersion', 'publishedAt', 'closedAt', 'finalizedAt', 'archived', 'createdBy', 'createdAt', 'updatedAt'],
  Questions: ['id', 'compId', 'order', 'type', 'text', 'help', 'media', 'choices', 'correct', 'points', 'required', 'explanation',
    'explanationMedia', 'review', 'enabled', 'updatedAt'],
  Snapshots: ['compId', 'version', 'part', 'json', 'publishedAt', 'publishedBy'],
  Submissions: ['id', 'compId', 'version', 'clientKey', 'attemptNo', 'participantId', 'name', 'phone', 'fields', 'status',
    'startedAt', 'submittedAt', 'startedMs', 'deadlineMs', 'submittedMs', 'durationSec', 'seed', 'qids', 'score', 'maxScore',
    'correctCount', 'gradableCount', 'pendingCount', 'flags', 'answers', 'grading', 'reviewedBy', 'updatedAt'],
  // Phase 2 / 3 (created by their modules on first use)
  Participants: ['id', 'name', 'nameNorm', 'phone', 'phoneNorm', 'group', 'church', 'notes', 'status', 'codeHash', 'codeEnc',
    'codeVersion', 'codeIssuedAt', 'codeIssuedBy', 'importBatch', 'createdBy', 'createdAt', 'updatedAt'],
  PointsLedger: ['id', 'participantId', 'amount', 'kind', 'refType', 'refId', 'compId', 'note', 'idemKey', 'actor', 'createdAt'],
  StoreItems: ['id', 'name', 'description', 'image', 'cost', 'stock', 'perPerson', 'category', 'order', 'active', 'createdAt', 'updatedAt'],
  Redemptions: ['id', 'participantId', 'itemId', 'itemName', 'cost', 'status', 'requestKey', 'ledgerId', 'refundLedgerId',
    'requestedAt', 'handledBy', 'handledAt', 'note', 'updatedAt']
};

/* made together with the spreadsheet */
var COMP_ENGINE_TABS = ['Competitions', 'Questions', 'Snapshots', 'Submissions'];

var COMP_SNAPSHOT_PART = 45000;      // chars per Snapshots.json cell (a cell holds 50,000)
var COMP_CACHE_CHUNK = 30000;        // chars per cache value (≤ 100 KB even for 3-byte characters)
var COMP_CACHE_MAX_CHUNKS = 60;
var COMP_LIVE_SECONDS = 60;
var COMP_DEF_SECONDS = 21600;
var COMP_DRAFT_SECONDS = 21600;

/* this execution's open spreadsheet and checked tabs */
var COMP_SS_ = null;
var COMP_TABS_ = {};


/* =========================================================
   TIME (the world's clock: Date.now, never a bare new Date())
========================================================= */

function compNow_() {

  var ms = Date.now();
  var date = new Date(ms);

  return {
    ms: ms,
    wall: Utilities.formatDate(date, CONTENT_TIMEZONE, "yyyy-MM-dd'T'HH:mm"),
    stamp: Utilities.formatDate(date, CONTENT_TIMEZONE, 'yyyy-MM-dd HH:mm')
  };

}

function compStampOf_(ms) {

  return Utilities.formatDate(new Date(ms), CONTENT_TIMEZONE, 'yyyy-MM-dd HH:mm');

}

/* Cairo wall "YYYY-MM-DDTHH:MM" → epoch ms (Cairo is UTC+2 or +3; NaN when not a stamp) */
function compWallMs_(stamp) {

  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(stamp || ''));

  if (!m) return NaN;

  var base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);

  for (var offset = 2; offset <= 3; offset++) {
    var guess = base - offset * 3600000;
    if (Utilities.formatDate(new Date(guess), CONTENT_TIMEZONE, "yyyy-MM-dd'T'HH:mm") === stamp) return guess;
  }

  return base - 2 * 3600000;

}


/* =========================================================
   MODULE SWITCHES (§0)
========================================================= */

/* a module is on when its switch is '1' AND its code is installed */
function compModules_() {

  var props = PropertiesService.getScriptProperties();
  var on = function (key) { return String(props.getProperty(key) || '') === '1'; };
  var registry = on('COMP_REGISTRY') && typeof compRegistryReady_ === 'function';
  var wallet = registry && on('COMP_WALLET') && typeof compWalletReady_ === 'function';
  var shop = wallet && on('COMP_SHOP') && typeof compShopReady_ === 'function';

  return { registry: registry, wallet: wallet, shop: shop };

}


/* =========================================================
   THE SPREADSHEET AND ITS TABS
========================================================= */

/**
 * The competitions spreadsheet. create = true only from admin writes (they
 * hold the script lock): makes it the first time. Otherwise null when
 * there is none yet.
 */
function compSpreadsheet_(create) {

  if (COMP_SS_) return COMP_SS_;

  var props = PropertiesService.getScriptProperties();
  var id = String(props.getProperty('COMP_SHEET_ID') || '').trim();

  if (id) {
    COMP_SS_ = SpreadsheetApp.openById(id);
    COMP_TABS_ = {};
    return COMP_SS_;
  }

  if (!create) return null;

  var ss = SpreadsheetApp.create(COMP_SHEET_TITLE);

  try {
    ss.setSpreadsheetTimeZone(CONTENT_TIMEZONE);
  }
  catch (ignored) {
    // the default zone; every stamp is written as text anyway
  }

  COMP_SS_ = ss;
  COMP_TABS_ = {};

  COMP_ENGINE_TABS.forEach(function (name) { compSheet_(name); });

  ['Sheet1', 'ورقة1'].forEach(function (name) {
    var blank = ss.getSheetByName(name);
    if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
  });

  props.setProperties({ COMP_SHEET_ID: ss.getId(), COMP_SCHEMA: COMP_SCHEMA_VERSION });

  // the secrets exist before any public call needs them
  compEnsureSecrets_();

  return ss;

}


/* a tab as { name, sheet, index: { column: 1-based }, width } (made / completed on first use) */
function compSheet_(name) {

  if (COMP_TABS_[name]) return COMP_TABS_[name];

  var columns = COMP_TABLES[name];
  var ss = compSpreadsheet_(false);

  if (!columns || !ss) {
    throw new Error('comp: ' + name);
  }

  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, sheet.getMaxRows(), columns.length).setNumberFormat('@');
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var width = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (cell) { return String(cell).trim(); });

  while (header.length && !header[header.length - 1]) header.pop();

  var missing = columns.filter(function (column) { return header.indexOf(column) === -1; });

  if (missing.length) {
    var start = header.length + 1;
    var needed = start + missing.length - 1;
    if (needed > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), needed - sheet.getMaxColumns());
    sheet.getRange(1, start, sheet.getMaxRows(), missing.length).setNumberFormat('@');
    sheet.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
    header = header.concat(missing);
  }

  var index = {};

  header.forEach(function (column, i) {
    if (column && !index[column]) index[column] = i + 1;
  });

  COMP_TABS_[name] = { name: name, sheet: sheet, index: index, width: header.length, header: header };

  return COMP_TABS_[name];

}


/* =========================================================
   CELLS
========================================================= */

/* a value as written: text, '1' / '' for booleans, JSON for objects, plainCell_ always */
function compCellOut_(value) {

  if (value === null || value === undefined) return '';
  if (value === true) return '1';
  if (value === false) return '';
  if (typeof value === 'number') return isFinite(value) ? String(value) : '';
  if (typeof value === 'object') return JSON.stringify(value);

  return plainCell_(value);

}

/* a cell as read: text, without plainCell_'s apostrophe (never trimmed: JSON parts) */
function compCellIn_(value) {

  if (value instanceof Date) return Utilities.formatDate(value, CONTENT_TIMEZONE, 'yyyy-MM-dd HH:mm');
  if (value === true) return '1';
  if (value === false || value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);

  var text = String(value);

  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;

}


/* =========================================================
   READ
========================================================= */

function compLastRow_(t) {

  return t.sheet.getLastRow();

}

/* every row (the tab's known columns) as { column: text, __row } — for the small draft tabs */
function compRows_(t) {

  var last = compLastRow_(t);

  if (last < 2) return [];

  var columns = COMP_TABLES[t.name];
  var values = t.sheet.getRange(2, 1, last - 1, t.width).getValues();
  var rows = [];

  values.forEach(function (line, r) {
    var row = { __row: r + 2 };
    var any = false;
    columns.forEach(function (column) {
      var i = t.index[column];
      var value = i ? compCellIn_(line[i - 1]) : '';
      if (value !== '') any = true;
      row[column] = value;
    });
    if (any) rows.push(row);
  });

  return rows;

}

/* only these columns (contiguous runs read in one call each): [{ __row, column: text }] */
function compColumns_(t, columns) {

  var last = compLastRow_(t);

  if (last < 2) return [];

  var wanted = columns.filter(function (c) { return t.index[c]; }).map(function (c) { return { name: c, col: t.index[c] }; })
    .sort(function (a, b) { return a.col - b.col; });
  var rows = [];

  for (var r = 0; r < last - 1; r++) rows.push({ __row: r + 2 });

  for (var i = 0; i < wanted.length;) {
    var start = i;
    // a gap of up to 3 columns is read through: one call instead of two
    while (i + 1 < wanted.length && wanted[i + 1].col <= wanted[i].col + 4) i++;
    var from = wanted[start].col;
    var to = wanted[i].col;
    var values = t.sheet.getRange(2, from, last - 1, to - from + 1).getValues();
    for (var k = start; k <= i; k++) {
      var offset = wanted[k].col - from;
      for (var row = 0; row < values.length; row++) rows[row][wanted[k].name] = compCellIn_(values[row][offset]);
    }
    i++;
  }

  columns.forEach(function (c) {
    if (!t.index[c]) rows.forEach(function (row) { row[c] = ''; });
  });

  return rows.filter(function (row) {
    return columns.some(function (c) { return row[c] !== ''; });
  });

}

/* one row (every known column) or null */
function compRowAt_(t, rowNumber) {

  if (!(rowNumber >= 2) || rowNumber > compLastRow_(t)) return null;

  var line = t.sheet.getRange(rowNumber, 1, 1, t.width).getValues()[0];
  var row = { __row: rowNumber };

  COMP_TABLES[t.name].forEach(function (column) {
    var i = t.index[column];
    row[column] = i ? compCellIn_(line[i - 1]) : '';
  });

  return row;

}

/* the row number where column === value (one column read), 0 when none */
function compFindRow_(t, column, value) {

  var last = compLastRow_(t);

  if (last < 2 || !t.index[column]) return 0;

  var values = t.sheet.getRange(2, t.index[column], last - 1, 1).getValues();

  for (var i = 0; i < values.length; i++) {
    if (compCellIn_(values[i][0]) === String(value)) return i + 2;
  }

  return 0;

}

/* a row without its sheet position (for caches and replies) */
function compStrip_(row) {

  var copy = {};

  Object.keys(row).forEach(function (key) {
    if (key !== '__row') copy[key] = row[key];
  });

  return copy;

}


/* =========================================================
   WRITE (batched)
========================================================= */

/* the tab's full-width line for a record (base: the row as it is, for columns the record leaves out) */
function compSheetLine_(t, record, base) {

  var line = [];

  for (var c = 1; c <= t.width; c++) {
    var column = t.header[c - 1];
    if (column && record[column] !== undefined) line.push(compCellOut_(record[column]));
    else if (column && base && base[column] !== undefined) line.push(compCellOut_(base[column]));
    else line.push('');
  }

  return line;

}

/* new rows after the last one, in one setValues → their row numbers */
function compAppend_(t, records) {

  if (!records.length) return [];

  var first = Math.max(compLastRow_(t), 1) + 1;
  var last = first + records.length - 1;
  var sheet = t.sheet;

  if (last > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), last - sheet.getMaxRows() + Math.min(500, records.length));
  }

  sheet.getRange(first, 1, records.length, t.width).setValues(records.map(function (record) { return compSheetLine_(t, record, null); }));

  return records.map(function (record, i) { return first + i; });

}

/*
 * Changes some columns of one row with ONE setValues over the span they
 * cover; columns in between keep `current` (the row as read), else they are
 * read first.
 */
function compUpdate_(t, rowNumber, record, current) {

  var cols = Object.keys(record).filter(function (c) { return t.index[c]; }).map(function (c) { return t.index[c]; });

  if (!cols.length) return;

  var from = Math.min.apply(null, cols);
  var to = Math.max.apply(null, cols);

  if (!current && to > from) {
    current = compRowAt_(t, rowNumber);
  }

  var line = compSheetLine_(t, record, current).slice(from - 1, to);

  t.sheet.getRange(rowNumber, from, 1, to - from + 1).setValues([line]);

}

/* one whole column (rows 2..last) in one setValues: values[i] for row i + 2 */
function compWriteColumn_(t, column, values) {

  if (!values.length || !t.index[column]) return;

  t.sheet.getRange(2, t.index[column], values.length, 1).setValues(values.map(function (v) { return [compCellOut_(v)]; }));

}

/* deletes rows (bottom up, consecutive ones together) */
function compDeleteRows_(t, rowNumbers) {

  var rows = rowNumbers.slice().sort(function (a, b) { return b - a; });

  for (var i = 0; i < rows.length;) {
    var start = i;
    while (i + 1 < rows.length && rows[i + 1] === rows[i] - 1) i++;
    t.sheet.deleteRows(rows[i], start === i ? 1 : i - start + 1);
    i++;
  }

}


/* =========================================================
   LOCK FOR THE LIVE TABS
========================================================= */

/* the shared mutex for live writes, or null (busy) */
function compLock_(ms) {

  var lock = null;

  try {
    lock = LockService.getUserLock();
  }
  catch (ignored) {
    lock = null;
  }

  if (!lock) lock = LockService.getScriptLock();

  try {
    return lock.tryLock(ms || 10000) ? lock : null;
  }
  catch (ignored) {
    return null;
  }

}


/* =========================================================
   CACHES
========================================================= */

function compCachePut_(key, text, seconds) {

  try {
    var count = Math.ceil(text.length / COMP_CACHE_CHUNK) || 1;
    if (count > COMP_CACHE_MAX_CHUNKS) return false;
    var values = {};
    for (var i = 0; i < count; i++) values[key + ':' + i] = text.slice(i * COMP_CACHE_CHUNK, (i + 1) * COMP_CACHE_CHUNK);
    values[key + ':n'] = String(count);
    CacheService.getScriptCache().putAll(values, seconds);
    return true;
  }
  catch (ignored) {
    return false;
  }

}

function compCacheGet_(key) {

  try {
    var cache = CacheService.getScriptCache();
    var count = Number(cache.get(key + ':n'));
    if (!(count >= 1)) return null;
    var keys = [];
    for (var i = 0; i < count; i++) keys.push(key + ':' + i);
    var values = cache.getAll(keys);
    var text = '';
    for (var j = 0; j < count; j++) {
      if (typeof values[key + ':' + j] !== 'string') return null;
      text += values[key + ':' + j];
    }
    return text;
  }
  catch (ignored) {
    return null;
  }

}

function compCacheDrop_(key) {

  try {
    CacheService.getScriptCache().remove(key + ':n');
  }
  catch (ignored) {
    // it runs out by itself
  }

}

/* every draft write: the next apiState / review reads the tabs again */
function compDropDraft_() {

  compCacheDrop_('comp:draft');

  try {
    CacheService.getScriptCache().remove('comp:draftsig');
  }
  catch (ignored) {
    // it runs out by itself
  }

}

function compDropLive_(slug) {

  if (!slug) return;

  try {
    CacheService.getScriptCache().remove('comp:live:' + slug);
  }
  catch (ignored) {
    // 60 s at most
  }

}


/* =========================================================
   THE DRAFT (for buildPublicContent, apiState, the review)
========================================================= */

/**
 * draft.competitions: { comps, questions, modules } — through the cache
 * (a cold read is one read of each of the two tabs); null when there is
 * no competitions spreadsheet; { error } when it can't be read (a publish
 * error then, never a silent withdrawal).
 */
function compDraft_() {

  if (!String(PropertiesService.getScriptProperties().getProperty('COMP_SHEET_ID') || '').trim()) {
    return null;
  }

  var modules = compModules_();
  var data = null;
  var text = compCacheGet_('comp:draft');

  if (text) {
    try {
      data = JSON.parse(text);
    }
    catch (ignored) {
      data = null;
    }
  }

  if (!data || !Array.isArray(data.comps) || !Array.isArray(data.questions) || !Array.isArray(data.items)) {

    try {
      data = {
        comps: compRows_(compSheet_('Competitions')).map(compStrip_),
        questions: compRows_(compSheet_('Questions')).map(compStrip_),
        // the store's items (CompStoreItems.gs): the pictures of active ones join the publish
        items: typeof compShopDraftItems_ === 'function' ? compShopDraftItems_() : []
      };
    }
    catch (error) {
      console.warn('comp: draft not read: ' + ((error && error.message) || error));
      return { error: 'مقدرناش نقرا بيانات المسابقات دلوقتي. جرّب تاني بعد شوية.', comps: [], questions: [], modules: modules };
    }

    text = JSON.stringify(data);

    if (compCachePut_('comp:draft', text, COMP_DRAFT_SECONDS)) {
      try {
        CacheService.getScriptCache().put('comp:draftsig', sha256Hex_(text).slice(0, 16), COMP_DRAFT_SECONDS);
      }
      catch (ignored) {
        // only a hint
      }
    }

  }

  data.modules = modules;

  return data;

}


/* =========================================================
   LIVE STATE (public calls)
========================================================= */

/* { compId, version, closedAt, finalizedAt, slug } of a published slug, or null (cached 60 s) */
function compLive_(slug) {

  var cache = CacheService.getScriptCache();
  var key = 'comp:live:' + slug;
  var cached = cache.get(key);

  if (cached) {
    try {
      var value = JSON.parse(cached);
      return value && value.compId ? value : null;
    }
    catch (ignored) {
      // read again
    }
  }

  var found = null;

  compRows_(compSheet_('Competitions')).some(function (row) {
    if (row.slug === slug && String(row.liveVersion || '').trim()) {
      found = {
        compId: row.id,
        version: String(row.liveVersion).trim(),
        closedAt: contentDateTime_(row.closedAt, false) || '',
        finalizedAt: String(row.finalizedAt || '').trim(),
        slug: slug
      };
      return true;
    }
    return false;
  });

  cache.put(key, JSON.stringify(found || { none: 1 }), COMP_LIVE_SECONDS);

  return found;

}


/* the definition of (compId, version): cache, else the Snapshots rows; null when missing */
function compDefinitionFor_(compId, version) {

  if (!compId || !version) return null;

  var key = 'comp:def:' + compId + ':' + version;
  var text = compCacheGet_(key);

  if (!text) {

    var t = compSheet_('Snapshots');
    var parts = compColumns_(t, ['compId', 'version', 'part']).filter(function (row) {
      return row.compId === compId && row.version === version;
    }).sort(function (a, b) { return Number(a.part) - Number(b.part); });

    if (!parts.length) return null;

    var first = Math.min.apply(null, parts.map(function (p) { return p.__row; }));
    var last = Math.max.apply(null, parts.map(function (p) { return p.__row; }));
    var cells = t.sheet.getRange(first, t.index.json, last - first + 1, 1).getValues();

    text = parts.map(function (p) { return compCellIn_(cells[p.__row - first][0]); }).join('');

    compCachePut_(key, text, COMP_DEF_SECONDS);

  }

  try {
    return JSON.parse(text);
  }
  catch (ignored) {
    return null;
  }

}


