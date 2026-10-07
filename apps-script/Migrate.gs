/**
 * DATA UPGRADE (schema 5)
 *
 * Brings an existing Sheet up to what this version of the code expects,
 * without touching real content:
 *   - new tabs (Activities, Types) are created, Types with its seed rows;
 *   - new columns are appended at the end of existing tabs (never moved,
 *     never renamed); their cells start empty (checkboxes unchecked).
 *     Schema 4 adds only columns: Contacts image / intro / reply (the
 *     person cards) and Links gallery (a scene's own photos). Schema 5
 *     adds only columns too: Sessions program (the meeting's stages) and
 *     Sections surface / surfaceMobile (the cards' background);
 *   - the page's built-in sections become rows in Sections, in the exact
 *     order the page already had (so nothing moves on the site), the
 *     meeting block taking the old "meeting.enabled" value;
 *   - the WhatsApp group link is added once (if no link has its URL).
 * Nothing is deleted, reordered or re-seeded.
 *
 * planMigration() only reads and says what migrate() would do.
 * migrate() first copies every tab to a hidden "_backup_YYYYMMDD_<tab>"
 * (never overwriting an older backup), then applies the steps, then checks
 * that no table lost a row. Running it again does nothing.
 *
 * Both run from the editor, or from الإعدادات → ترقية البيانات.
 */

var DATA_SCHEMA_VERSION = 5;

var WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/K5CfLt5X0uM5qCgr7Z2PTt';

var SEED_TYPES = [
  { key: 'competition', label: 'مسابقة', section: 'competitions', icon: 'trophy', theme: 'ember', ctaDefault: 'ابدأ المسابقة', notifyTemplate: 'المسابقة الجديدة بدأت: {title}' },
  { key: 'trip', label: 'رحلة', section: 'activities', icon: 'bus', theme: 'azure', ctaDefault: 'سجّل في الرحلة', notifyTemplate: 'التسجيل للرحلة فتح: {title}' },
  { key: 'play', label: 'مسرحية', section: 'activities', icon: 'theatre', theme: 'rose', ctaDefault: 'التفاصيل', notifyTemplate: 'مسرحية جديدة: {title}' },
  { key: 'black-theatre', label: 'مسرح أسود', section: 'activities', icon: 'theatre', theme: 'night', ctaDefault: 'التفاصيل', notifyTemplate: 'مسرح أسود: {title}' },
  { key: 'mime', label: 'مسرح صامت', section: 'activities', icon: 'theatre', theme: 'night', ctaDefault: 'التفاصيل', notifyTemplate: 'مسرح صامت: {title}' },
  { key: 'conference', label: 'مؤتمر', section: 'activities', icon: 'users', theme: 'gold', ctaDefault: 'سجّل في المؤتمر', notifyTemplate: 'التسجيل في المؤتمر فتح: {title}' },
  { key: 'retreat', label: 'يوم روحي', section: 'activities', icon: 'church', theme: 'emerald', ctaDefault: 'التفاصيل', notifyTemplate: 'يوم روحي: {title}' },
  { key: 'party', label: 'حفلة', section: 'activities', icon: 'music', theme: 'rose', ctaDefault: 'التفاصيل', notifyTemplate: 'حفلة: {title}' },
  { key: 'occasion', label: 'مناسبة', section: 'activities', icon: 'gift', theme: 'gold', ctaDefault: 'التفاصيل', notifyTemplate: 'مناسبة: {title}' },
  { key: 'activity', label: 'نشاط', section: 'activities', icon: 'star', theme: 'azure', ctaDefault: 'التفاصيل', notifyTemplate: 'نشاط جديد: {title}' },
  { key: 'other', label: 'أخرى', section: 'activities', icon: 'info', theme: 'gold', ctaDefault: 'التفاصيل', notifyTemplate: '{title}' }
];


/* =========================================================
   STEPS
   check() only reads: { needed, detail }. apply() changes, returns a line.
========================================================= */

function migrationSteps_() {

  return [

    {
      id: 'tabs',
      label: 'تبويبات جديدة',
      check: function (ss) {
        var missing = OPTIONAL_TABLES.filter(function (name) { return !ss.getSheetByName(name); });
        return { needed: missing.length > 0, detail: missing.join('، ') };
      },
      apply: function (ss) {
        var created = [];
        OPTIONAL_TABLES.forEach(function (name) {
          if (ss.getSheetByName(name)) {
            return;
          }
          var seed = name === 'Types'
            ? SEED_TYPES.map(function (t, i) {
              return TABLES.Types.columns.map(function (column) {
                if (column === 'enabled') return true;
                if (column === 'order') return (i + 1) * 10;
                if (column === 'banner' || column === 'updatedAt') return '';
                return t[column] === undefined ? '' : t[column];
              });
            })
            : [];
          setupTable_(ss, name, seed, created);
        });
        return 'اتعمل: ' + created.join('، ');
      }
    },

    {
      id: 'columns',
      label: 'أعمدة جديدة في آخر التبويبات',
      check: function (ss) {
        var lines = [];
        Object.keys(TABLES).forEach(function (name) {
          var sheet = ss.getSheetByName(name);
          if (!sheet) {
            return;
          }
          var missing = missingColumns_(sheet, name);
          if (missing.length) {
            lines.push(name + ': ' + missing.join(', '));
          }
        });
        return { needed: lines.length > 0, detail: lines.join(' — ') };
      },
      apply: function (ss) {
        var lines = [];
        Object.keys(TABLES).forEach(function (name) {
          var sheet = ss.getSheetByName(name);
          if (!sheet) {
            return;
          }
          var missing = missingColumns_(sheet, name);
          if (missing.length) {
            appendColumns_(sheet, name, missing);
            lines.push(name + ': ' + missing.join(', '));
          }
        });
        return lines.join(' — ');
      }
    },

    {
      id: 'sections',
      label: 'أقسام الصفحة الأساسية (بنفس ترتيب الصفحة دلوقتي)',
      check: function (ss) {
        var missing = missingBuiltins_();
        return { needed: missing.length > 0, detail: missing.map(function (b) { return b.title; }).join('، ') };
      },
      apply: function () {
        var rows = readTable_('Sections');
        var orders = rows
          .filter(function (r) { return (contentLine_(r.kind).toLowerCase() || 'links') === 'links'; })
          .map(function (r) { return contentNumber_(r.order); })
          .filter(function (o) { return o !== null && !isNaN(o); });
        var first = orders.length ? Math.min.apply(null, orders) : 10;
        var last = orders.length ? Math.max.apply(null, orders) : 20;
        var meetingOn = contentBool_(currentSetting_('meeting.enabled'));
        var added = [];

        missingBuiltins_().forEach(function (b) {
          upsertRow_('Sections', 'key', {
            key: b.key,
            kind: b.kind,
            title: b.title,
            order: builtinOrder_(b.key, first, last),
            enabled: b.key === 'meeting' ? meetingOn : true
          });
          added.push(b.title);
        });

        return 'اتضاف: ' + added.join('، ') + (meetingOn ? '' : ' (ركن الاجتماع مقفول زي ما كان)');
      }
    },

    {
      id: 'whatsapp',
      label: 'رابط جروب الواتساب',
      check: function () {
        var exists = readTable_('Links').some(function (r) { return contentLine_(r.url) === WHATSAPP_GROUP_URL; });
        return { needed: !exists, detail: exists ? '' : 'هيتضاف في قسم التواصل الاجتماعي' };
      },
      apply: function () {
        var links = readTable_('Links');
        var sections = readTable_('Sections').filter(function (r) { return (contentLine_(r.kind).toLowerCase() || 'links') === 'links'; });
        var section = sections.some(function (r) { return r.key === 'social'; }) ? 'social' : (sections[0] ? sections[0].key : 'social');
        var orders = links
          .filter(function (r) { return r.section === section; })
          .map(function (r) { return contentNumber_(r.order); })
          .filter(function (o) { return o !== null && !isNaN(o); });
        var id = 'whatsapp-group';
        var n = 2;

        while (links.some(function (r) { return r.id === id; })) {
          id = 'whatsapp-group-' + n++;
        }

        upsertRow_('Links', 'id', {
          id: id,
          enabled: true,
          order: (orders.length ? Math.max.apply(null, orders) : 0) + 10,
          section: section,
          style: 'tile',
          featured: false,
          title: 'جروب الواتساب',
          subtitle: 'أخبارنا أول بأول',
          url: WHATSAPP_GROUP_URL,
          icon: 'whatsapp',
          experience: 'whatsapp',
          updatedAt: nowStamp_()
        });

        return 'اتضاف في قسم ' + section;
      }
    }

  ];

}


function missingColumns_(sheet, name) {

  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (cell) { return String(cell).trim(); });

  return TABLES[name].columns.filter(function (column) { return header.indexOf(column) === -1; });

}


function appendColumns_(sheet, name, columns) {

  var spec = TABLES[name];
  var start = Math.max(sheet.getLastColumn(), 1) + 1;
  var needed = start + columns.length - 1;

  if (needed > sheet.getMaxColumns()) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), needed - sheet.getMaxColumns());
  }

  var checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  var rows = Math.max(sheet.getMaxRows() - 1, 1);

  columns.forEach(function (column, i) {

    var col = start + i;
    var head = sheet.getRange(1, col);

    head.setValue(column).setFontWeight('bold').setFontColor('#f2d28b').setBackground('#061a31');

    if (spec.notes && spec.notes[column]) {
      head.setNote(spec.notes[column]);
    }

    if ((spec.text || []).indexOf(column) !== -1) {
      sheet.getRange(2, col, rows, 1).setNumberFormat('@');
    }

    if ((spec.bool || []).indexOf(column) !== -1) {
      sheet.getRange(2, col, rows, 1).setDataValidation(checkbox);
    }

  });

}


function missingBuiltins_() {

  var keys = Object.create(null);

  readTable_('Sections').forEach(function (r) { keys[contentLine_(r.key).toLowerCase()] = true; });

  return BUILTIN_SECTIONS.filter(function (b) { return !keys[b.key]; });

}


function currentSetting_(key) {

  var row = readTable_('Settings').filter(function (r) { return r.key === key; })[0];

  return row ? row.value : '';

}


/* =========================================================
   PLAN / RUN
========================================================= */

function dataSchema_() {

  return Number(PropertiesService.getScriptProperties().getProperty('DATA_SCHEMA')) || 2;

}


function planMigrationReport_() {

  var ss = spreadsheet_();
  var steps = migrationSteps_().map(function (step) {
    var result;
    try {
      result = step.check(ss);
    }
    catch (error) {
      result = { needed: true, detail: 'مقدرناش نفحص: ' + errorDetails_(error) };
    }
    return { id: step.id, label: step.label, needed: !!result.needed, detail: result.detail || '' };
  });

  var pending = steps.some(function (s) { return s.needed; });

  return {
    current: dataSchema_(),
    target: DATA_SCHEMA_VERSION,
    pending: pending,
    steps: steps,
    backups: pending ? backupTabs_(ss).map(function (name) { return name; }) : []
  };

}


/* the tabs a backup copies (all data tabs that exist) */
function backupTabs_(ss) {

  return Object.keys(TABLES).filter(function (name) { return !!ss.getSheetByName(name); });

}


/** Read-only: what migrate() would do. */
function planMigration() {

  assertAdmin_();

  var plan = planMigrationReport_();
  var text = 'بيانات النسخة ' + plan.current + ' ← ' + plan.target + '\n' +
    plan.steps.map(function (s) {
      return (s.needed ? '• هيتعمل: ' : '✓ جاهز: ') + s.label + (s.detail ? ' — ' + s.detail : '');
    }).join('\n') +
    (plan.pending ? '\nقبل أي تغيير هتتعمل نسخة احتياطية مخفية من: ' + plan.backups.join('، ') : '\nمفيش حاجة محتاجة تتغير.');

  console.log(text);

  return text;

}


function apiPlanMigration() {

  assertAdmin_();

  return planMigrationReport_();

}


function migrate() {

  // run from the editor by the owner; refuse anyone else who reaches it
  assertAdmin_();

  var result = runMigration_({ backup: true });

  console.log(result.lines.join('\n'));

  return result.lines.join('\n');

}


function apiMigrate() {

  var email = assertAdmin_();
  var result = runMigration_({ backup: true });

  return { report: result, state: apiStateFor_(email) };

}


/**
 * options.backup: copy every tab first (skipped for a brand-new Sheet).
 * Returns { changed, backups, lines, counts: { table: [before, after] } }.
 */
function runMigration_(options) {

  var email = assertAdmin_();
  var lock = LockService.getScriptLock();

  lock.waitLock(30000);

  try {

    var ss = spreadsheet_();
    var steps = migrationSteps_();
    var todo = steps.filter(function (step) { return step.check(ss).needed; });
    var lines = [];
    var backups = [];

    if (!todo.length) {
      PropertiesService.getScriptProperties().setProperty('DATA_SCHEMA', String(DATA_SCHEMA_VERSION));
      return { changed: false, backups: [], lines: ['البيانات محدثة، مفيش حاجة اتغيرت.'], counts: {} };
    }

    var before = tableCounts_(ss);

    if (options.backup) {
      backups = backupSheets_(ss);
      lines.push('نسخة احتياطية: ' + backups.join('، '));
    }

    todo.forEach(function (step) {
      // re-checked: an earlier step may have done the work already
      if (step.check(ss).needed) {
        lines.push('✓ ' + step.label + ': ' + step.apply(ss));
      }
    });

    applyValidation_(ss);

    var after = tableCounts_(ss);
    var counts = {};
    var lost = [];

    Object.keys(before).forEach(function (name) {
      counts[name] = [before[name], after[name]];
      if (after[name] < before[name]) {
        lost.push(name + ' ' + before[name] + ' ← ' + after[name]);
      }
    });

    if (lost.length) {
      log_(email, 'migrate.failed', lost.join(', '));
      throw appError_('الترقية وقفت: عدد الصفوف قل في ' + lost.join('، '), 'متعملش أي مسح. النسخة الاحتياطية موجودة: ' + backups.join('، '), lost.join(', '));
    }

    PropertiesService.getScriptProperties().setProperty('DATA_SCHEMA', String(DATA_SCHEMA_VERSION));
    log_(email, 'migrate', lines.join(' | ').slice(0, 1000));

    return { changed: true, backups: backups, lines: lines, counts: counts };

  }
  finally {
    lock.releaseLock();
  }

}


function tableCounts_(ss) {

  var counts = {};

  Object.keys(TABLES).forEach(function (name) {
    if (ss.getSheetByName(name) && name !== 'Log') {
      counts[name] = readTable_(name).length;
    }
  });

  return counts;

}


/* hidden copies of every data tab, under a name no older backup uses */
function backupSheets_(ss) {

  var day = Utilities.formatDate(new Date(), CONTENT_TIMEZONE, 'yyyyMMdd');
  var tabs = backupTabs_(ss);
  var prefix = '_backup_' + day;
  var n = 2;

  var taken = function (p) {
    return tabs.some(function (name) { return !!ss.getSheetByName(p + '_' + name); });
  };

  while (taken(prefix)) {
    prefix = '_backup_' + day + '-' + n++;
  }

  return tabs.map(function (name) {
    var copy = ss.getSheetByName(name).copyTo(ss);
    copy.setName(prefix + '_' + name);
    copy.hideSheet();
    return copy.getName();
  });

}
