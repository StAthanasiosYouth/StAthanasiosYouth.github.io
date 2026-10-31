/* =========================================================
   CONTENT DRAFTS: SHEETS ⇄ WORKER (Phase 4, docs/CONTENT-MIGRATION-PLAN.md)
   ---------------------------------------------------------
   The one-time copy of every draft the admin edits (the content Sheet and
   the pages / events tabs) into D1, and the way back for the rollback.

   - contentMigrate_('dry')    the copy is checked by the Worker, nothing
                                 written there but the report
   - contentMigrate_('apply')  D1 takes the copy (only while the Worker's
                                 CONTENT_DRAFTS = '0': the Sheets are the writer)
   - contentRestore_('dry' | 'apply')
                                 the rollback: D1's drafts written back into the
                                 Sheets' tabs, by column name (unknown columns
                                 keep what they hold); only for the owner

   Rows are sent exactly as the admin reads them (readTable_ / compRows_),
   every column in the tab's code order, with a SHA-256 per row and per kind
   (the recipe in worker/src/content/store.js). The Worker recomputes both and
   refuses anything that differs. Primary admin only; nothing runs by itself.
========================================================= */

/* [kind, spreadsheet, tab, key column] — the same list as worker/src/content/kinds.js */
var CONTENT_EXPORT_KINDS = [
  ['settings', 'content', 'Settings', 'key'],
  ['sections', 'content', 'Sections', 'key'],
  ['links', 'content', 'Links', 'id'],
  ['contacts', 'content', 'Contacts', 'id'],
  ['sessions', 'content', 'Sessions', 'date'],
  ['news', 'content', 'News', 'id'],
  ['games', 'content', 'Games', 'id'],
  ['notifications', 'content', 'Notifications', 'id'],
  ['media', 'content', 'Media', 'id'],
  ['activities', 'content', 'Activities', 'id'],
  ['types', 'content', 'Types', 'key'],
  ['pages', 'comp', 'Pages', 'id'],
  ['page_media', 'comp', 'PageMedia', 'id'],
  ['events', 'comp', 'Events', 'id'],
  ['servants', 'comp', 'Servants', 'id'],
  ['pay_methods', 'comp', 'PayMethods', 'key']
];

/* the competitions' drafts: moved on their own (WorkerComp.gs compExportForWorker_), never with the content's copy */
var COMP_EXPORT_KINDS = [
  ['competitions', 'comp', 'Competitions', 'id'],
  ['questions', 'comp', 'Questions', 'id']
];

function contentExportColumns_(sheet, tab) {

  return sheet === 'content' ? TABLES[tab].columns : COMP_TABLES[tab];

}

/* the tab's rows as the admin reads them, fresh (no cache), without the sheet position */
function contentExportRows_(sheet, tab) {

  if (sheet === 'content') return readOptionalTable_(tab);

  return pagesRows_(tab).map(compStrip_);

}

/* row hash, then the kind's: sha256(rows.map(key + ':' + rowHash).join('\n')) */
function contentExportKind_(spec) {

  var columns = contentExportColumns_(spec[1], spec[2]);
  var rows = contentExportRows_(spec[1], spec[2]).map(function (row) {
    var out = {};
    columns.forEach(function (column) {
      out[column] = row[column] === undefined || row[column] === null ? '' : row[column];
    });
    return out;
  });
  var hashes = rows.map(function (row) { return sha256Hex_(JSON.stringify(row)); });
  var hash = sha256Hex_(rows.map(function (row, i) { return String(row[spec[3]]) + ':' + hashes[i]; }).join('\n'));

  return { rows: rows, hashes: hashes, hash: hash };

}

function contentExportPayload_() {

  var kinds = {};

  CONTENT_EXPORT_KINDS.forEach(function (spec) {
    kinds[spec[0]] = contentExportKind_(spec);
  });

  return { kinds: kinds };

}

/* POST to the Worker, signed like every sync (WorkerSync.gs) → the parsed reply */
function contentWorkerPost_(path, payload) {

  var secret = workerSyncSecret_();

  if (!secret) {
    throw appError_('الربط مع الخادم الجديد مش متظبط.', 'محتاج WORKER_SYNC_SECRET في Script Properties.');
  }

  var body = JSON.stringify(payload);
  var ts = String(Date.now());
  var response = UrlFetchApp.fetch(WORKER_API_URL + path, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: Utilities.newBlob(body).getBytes(),
    headers: { 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + hmacHex_(secret, ts + '.' + body) },
    muteHttpExceptions: true,
    followRedirects: false
  });

  var text = response.getContentText();
  var reply = null;

  try {
    reply = JSON.parse(text);
  }
  catch (ignored) {
    reply = null;
  }

  if (response.getResponseCode() !== 200 || !reply || reply.ok !== true) {
    throw appError_('الخادم الجديد رفض الطلب.', '', 'HTTP ' + response.getResponseCode() + ' ' + (reply && (reply.code || reply.error) || ''));
  }

  return reply;

}

function contentAssertOwner_() {

  var email = assertAdmin_();

  if (email !== primaryAdmin_()) {
    throw appError_('النقل ده للمسؤول الأساسي بس.', '');
  }

  return email;

}

/* 'dry' | 'apply' → the Worker's report: { id, state, kinds: { kind: { rows, hash, d1Hash, ok, problems } } } */
function contentMigrate_(mode) {

  var email = contentAssertOwner_();

  if (mode !== 'dry' && mode !== 'apply') throw new Error('mode');

  var payload = tableScope_(function () {
    return contentExportPayload_();
  });

  payload.mode = mode;
  payload.by = email;

  var reply = contentWorkerPost_('/v1/sync/content-import', payload);

  log_(email, 'content.migrate', mode + ' ' + reply.state + ' ' + reply.id);

  return reply;

}


/* run by the owner from the Apps Script editor (not routed through doPost: no button reaches them) */
function contentMigrateDryRun() {
  console.log(JSON.stringify(contentMigrate_('dry')));
}

function contentMigrateApply() {
  console.log(JSON.stringify(contentMigrate_('apply')));
}

function contentRestoreDryRun() {
  console.log(JSON.stringify(contentRestore_('dry')));
}

function contentRestoreApply() {
  console.log(JSON.stringify(contentRestore_('apply')));
}

function mediaCopyDryRun() {
  console.log(JSON.stringify(mediaCopy_('dry')));
}

function mediaCopyApply() {
  console.log(JSON.stringify(mediaCopy_('apply')));
}


/* =========================================================
   THE MEDIA LIBRARY: DRIVE → R2 (P4-5, one time)
   ---------------------------------------------------------
   Every Media row's Drive files (the full file and the small one) go to the
   Worker one by one (signed, POST /v1/sync/media-copy), each with its SHA-256;
   the Worker checks it (a picture's full file also against the row's own
   hash), stores it in R2 and points D1's row at it. Run after the content
   copy (contentMigrateApply): D1's Media rows must exist. Safe to run again
   (a stored file is not sent twice by the Worker; a row copied again from the
   Sheets is pointed at R2 again). 'dry' lists what would be sent.
========================================================= */

function mediaCopy_(mode) {

  var email = contentAssertOwner_();

  if (mode !== 'dry' && mode !== 'apply') throw new Error('mode');

  var rows = readOptionalTable_('Media');
  var report = { rows: rows.length, files: 0, sent: 0, stored: 0, skipped: 0, failed: [] };

  rows.forEach(function (row) {
    [['full', row.driveId], ['thumb', row.thumbDriveId]].forEach(function (pair) {
      var part = pair[0];
      var fileId = String(pair[1] || '');
      if (!fileId || /^r2:/.test(fileId)) {
        report.skipped++;
        return;
      }
      report.files++;
      if (mode === 'dry') return;
      try {
        var base64 = driveDownloadBase64_(fileId);
        var bytes = Utilities.base64Decode(base64);
        var mime = part === 'thumb' ? thumbMime_(row) : String(row.mime || '');
        var reply = contentWorkerPost_('/v1/sync/media-copy', { id: row.id, part: part, mime: mime, data: base64, sha256: bytesHash_(bytes) });
        report.sent++;
        if (reply.stored) report.stored++;
      }
      catch (error) {
        report.failed.push(row.id + ':' + part + ' ' + errorDetails_(error).slice(0, 120));
      }
    });
  });

  log_(email, 'media.copy', mode + ' ' + JSON.stringify({ files: report.files, sent: report.sent, failed: report.failed.length }));

  return report;

}


/* =========================================================
   ROLLBACK: D1 → THE SHEETS
========================================================= */

/*
 * Writes one kind of the Worker's export into its tab: the header stays, each
 * known column takes D1's value, a column the code doesn't know keeps the
 * value it had on the row with the same key, rows left over are blanked.
 */
function contentRestoreKind_(spec, kind) {

  var ss = spec[1] === 'content' ? spreadsheet_() : compSpreadsheet_(false);

  if (!ss) throw new Error('restore: no spreadsheet for ' + spec[2]);

  var sheet = ss.getSheetByName(spec[2]);

  if (!sheet) {
    if (!kind.rows.length) return 0;
    throw new Error('restore: tab ' + spec[2] + ' is missing');
  }

  var width = Math.max(sheet.getLastColumn(), 1);
  var lastRow = sheet.getLastRow();
  var header = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (cell) { return String(cell).trim(); });
  var old = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
  var keyAt = header.indexOf(spec[3]);
  var byKey = {};

  if (keyAt !== -1) {
    old.forEach(function (line) {
      var key = String(line[keyAt]).trim();
      if (key && !byKey[key]) byKey[key] = line;
    });
  }

  kind.columns.forEach(function (column) {
    if (header.indexOf(column) === -1) throw new Error('restore: column ' + column + ' missing in ' + spec[2]);
  });

  // the content Sheet keeps text text the way upsertRow_ does: plain-text format on its text columns
  var cellOut = function (value) {
    return spec[1] === 'comp' ? compCellOut_(value) : value;
  };

  var lines = kind.rows.map(function (cells) {
    var record = {};
    kind.columns.forEach(function (column, i) { record[column] = cells[i]; });
    var base = byKey[String(record[spec[3]])] || null;
    return header.map(function (column, c) {
      if (column && record[column] !== undefined) return cellOut(record[column]);
      return base ? base[c] : '';
    });
  });

  var blanks = [];
  for (var r = lines.length; r < old.length; r++) {
    blanks.push(header.map(function () { return ''; }));
  }

  var all = lines.concat(blanks);

  if (all.length) {
    if (all.length + 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), all.length + 1 - sheet.getMaxRows());
    if (spec[1] === 'content') {
      (TABLES[spec[2]].text || []).forEach(function (column) {
        var c = header.indexOf(column);
        if (c !== -1) sheet.getRange(2, c + 1, all.length, 1).setNumberFormat('@');
      });
    }
    sheet.getRange(2, 1, all.length, width).setValues(all);
  }

  return lines.length;

}

/* the Worker's export checked against itself (row and kind hashes) before anything is written */
function contentRestoreCheck_(exported) {

  var problems = [];

  CONTENT_EXPORT_KINDS.forEach(function (spec) {
    var kind = exported[spec[0]];
    var columns = contentExportColumns_(spec[1], spec[2]);
    if (!kind || !Array.isArray(kind.rows)) {
      problems.push(spec[0] + ': missing');
      return;
    }
    if (JSON.stringify(kind.columns) !== JSON.stringify(columns)) {
      problems.push(spec[0] + ': columns differ from this code');
      return;
    }
    var keyed = kind.rows.map(function (cells, i) {
      var row = {};
      columns.forEach(function (column, c) { row[column] = cells[c]; });
      var hash = sha256Hex_(JSON.stringify(row));
      if (!kind.hashes || kind.hashes[i] !== hash) problems.push(spec[0] + ': row ' + (i + 1) + ' hash differs');
      return String(row[spec[3]]) + ':' + hash;
    });
    if (sha256Hex_(keyed.join('\n')) !== kind.hash) problems.push(spec[0] + ': kind hash differs');
  });

  return problems;

}

/* exported: the Worker's { kind: { columns, rows, hashes, hash } } → { kind: rows written } */
function contentRestoreFrom_(exported, mode) {

  var problems = contentRestoreCheck_(exported);

  if (problems.length) {
    throw appError_('النسخة اللي جاية من الخادم الجديد مش سليمة، ومفيش حاجة اتكتبت.', '', problems.slice(0, 10).join(' | '));
  }

  var written = {};

  CONTENT_EXPORT_KINDS.forEach(function (spec) {
    written[spec[0]] = mode === 'apply' ? contentRestoreKind_(spec, exported[spec[0]]) : exported[spec[0]].rows.length;
  });

  if (mode === 'apply') {
    tableTouchAll_();
    if (typeof pagesDropDraft_ === 'function') pagesDropDraft_();
    try {
      CacheService.getScriptCache().remove('ids:checked');
    }
    catch (ignored) {
      // only a shortcut
    }
  }

  return written;

}

/* the rollback; 'dry' only checks the Worker's copy. After 'apply', the copy back is compared with D1 */
function contentRestore_(mode) {

  var email = contentAssertOwner_();

  if (mode !== 'dry' && mode !== 'apply') throw new Error('mode');

  var exported = contentWorkerPost_('/v1/sync/content-export', { at: Date.now() }).kinds;
  var lock = LockService.getScriptLock();

  lock.waitLock(20000);

  try {
    var written = contentRestoreFrom_(exported, mode);
    var check = null;
    if (mode === 'apply') {
      var after = contentExportPayload_().kinds;
      check = {};
      CONTENT_EXPORT_KINDS.forEach(function (spec) {
        check[spec[0]] = after[spec[0]].hash === exported[spec[0]].hash;
      });
    }
    log_(email, 'content.restore', mode + ' ' + JSON.stringify(written));
    return { mode: mode, written: written, same: check };
  }
  finally {
    lock.releaseLock();
  }

}


/* =========================================================
   ADMIN PUSHES FOR CONTENT SAVED ON THE WORKER
   ---------------------------------------------------------
   After the Phase 4 cutover the content saves run on the Worker (the same
   Activity.gs code decides each admin push there, while NOTIFY_ROUTER is
   off). The devices and the sender stay here, so the decided rows come back:
   pulled (signed, at most once a minute) when this script sends its own
   pending pushes (activityPending_: a quiet call, the 5-minute trigger),
   appended to the Activity sheet as «pending», and sent by the same
   activityDispatchPending_. Off until the owner sets the Script Property
   CONTENT_WRITER = 'worker' at the cutover: nothing changes before it.
========================================================= */

var CONTENT_NOTIFY_CHECK = 'worker:content-notify';
var CONTENT_NOTIFY_EVERY_S = 60;

/* → how many rows were added (never throws; never inside the script lock) */
function contentNotifyPull_() {

  try {

    if (PropertiesService.getScriptProperties().getProperty('CONTENT_WRITER') !== 'worker') return 0;

    var cache = CacheService.getScriptCache();
    if (cache.get(CONTENT_NOTIFY_CHECK)) return 0;
    cache.put(CONTENT_NOTIFY_CHECK, '1', CONTENT_NOTIFY_EVERY_S);

    var items = contentWorkerPost_('/v1/sync/content-notify', { at: Date.now() }).items || [];
    if (!items.length) return 0;

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return 0;

    try {
      var sheet = activitySheet_();
      items.forEach(function (row) {
        if (!row || !/^act-/.test(String(row.id)) || !/^pending:(now|cooldown)$/.test(String(row.notified))) return;
        sheet.appendRow([String(row.id), Number(row.at) || Date.now(), String(row.cairo || ''), String(row.actor || '').toLowerCase(), plainCell_(row.actorName),
          String(row.action || ''), String(row.type || ''), plainCell_(row.entityId), plainCell_(row.title), plainCell_(row.summary),
          activityChanges_(row.changes), plainCell_(row.ref), Number(row.count) || 1, String(row.notified), plainCell_(row.device)]);
      });
    }
    finally {
      lock.releaseLock();
    }

    return items.length;

  }
  catch (error) {
    console.warn('content notify: not pulled: ' + ((error && error.message) || error));
    return 0;
  }

}
