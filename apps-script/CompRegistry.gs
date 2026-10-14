/**
 * COMPETITIONS: THE PARTICIPANT REGISTRY AND CODES (Phase 2). docs/COMPETITIONS.md §7.
 *
 * Switch: Script Property COMP_REGISTRY = '1' («تفعيل المشاركين بالأكواد»),
 * changed only by apiCompSettings. Tab: Participants (CompStore.gs
 * COMP_TABLES), a draft tab written under the script lock (regWrite_).
 *
 * Codes: ATH-XXXX-XXXX, 8 symbols of REG_CODE_ALPHABET (30, no 0/O/1/I/L/U),
 * rejection-sampled from SHA-256 of fresh UUIDs. Stored twice:
 *   codeHash = hex HMAC-SHA256(normalized code, CODE_PEPPER)  (lookup)
 *   codeEnc  = compEncrypt_(normalized code, CODE_KEY)         (admins can see it again)
 * The secrets are made on first use (CompCrypto.gs compSecret_) and never
 * replaced. A code is NEVER in a list, the panel state, Activity, a log, an
 * error, a push, a URL or a public reply: only apiParticipantCode(s) /
 * apiParticipantResetCode hand it to an admin, and those are logged.
 *
 * Cache: reg:hash (chunked) = { codeHash: participantId }, dropped on every
 * code / participant change; a miss is checked against the tab itself, so a
 * stale cache never refuses a real code.
 *
 * Public: compCode { code } → { participant: { name, group }, ptoken }
 * (global failure budget + a pause after a wrong code), and the hook
 * compParticipantFromToken_ that compStart / compResult / the portal use.
 *
 * The pure part (normName_, normPhoneEg_, the code format, the import
 * planner) uses no Google service except the hash it is given.
 */

var REG_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
var REG_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;
var REG_ID = /^p-[0-9a-f]{8}$/;
var REG_BATCH = /^imp-[0-9a-f]{8}$/;
var REG_PTOKEN_HOURS = 3;
var REG_HASH_SECONDS = 21600;
var REG_IMPORT_MAX_ROWS = 3000;
var REG_IMPORT_MAX_TEXT = 1024 * 1024;
var REG_LIMITS = { name: 80, nameMin: 3, group: 40, church: 60, servant: 60, notes: 300, search: 60, page: 50, pageMax: 200, exportMax: 3000 };
var REG_FIELD_LABELS = { name: 'الاسم', phone: 'رقم الموبايل', group: 'المجموعة', church: 'الكنيسة', servant: 'الخادم المسؤول', notes: 'ملاحظات', birthDate: 'تاريخ الميلاد' };
/* the optional fields a file can set or clear («-» in a cell clears it) */
var REG_OPTIONAL = ['group', 'church', 'servant', 'notes', 'birthDate'];
var REG_CLEAR = /^[-–—]$/;

/* this execution's key bytes (read once) */
var REG_KEYS_ = null;


/* =========================================================
   MODULE
========================================================= */

/* the module is installed (CompStore.gs compModules_; §16.3) */
function compRegistryReady_() {

  return true;

}

/* admin writes need the switch on */
function regRequireOn_() {

  if (!compModules_().registry) {
    throw appError_('«المشاركين بالأكواد» مش متفعّل.', 'فعّله من إعدادات المسابقات الأول.');
  }

}


/* =========================================================
   PURE: NAMES, PHONES, CODES
========================================================= */

/* Arabic-Indic / Persian digits → ASCII */
function regDigits_(value) {

  return String(value === null || value === undefined ? '' : value)
    .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });

}

/* Arabic numerals for messages */
function regAr_(value) {

  return String(value).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; });

}

/* a name as compared: compNormalizeText_ (hamza, ة/ه, ى/ي, tashkeel, case) without punctuation */
function normName_(value) {

  return compNormalizeText_(value).replace(/[.\-_'"()،,؛;:!؟?]+/g, ' ').replace(/\s+/g, ' ').trim();

}

/* the letters of a name (Arabic or Latin) */
function regLetterCount_(name) {

  return (String(name).match(/[A-Za-zء-يٱ-ۓ]/g) || []).length;

}

/**
 * An Egyptian mobile number in any usual form → { phone: '+201XXXXXXXXX',
 * norm: '1XXXXXXXXX', local: '01XXXXXXXXX', problem: '' } or { problem }
 * (an Arabic reason). Arabic / Persian digits, spaces, dashes, dots,
 * parentheses and bidi marks are forgiven; +20 / 0020 / 20 and the trunk 0
 * are dropped; a 0 that a spreadsheet dropped (1012345678) is fine.
 */
function normPhoneEg_(value) {

  var fail = function (problem) { return { phone: '', norm: '', local: '', problem: problem }; };
  var text = regDigits_(value)
    .replace(/[‎‏؜‪-‮⁦-⁩﻿]/g, '')
    .replace(/[\s \-‐-―.()\/]/g, '');

  if (!text) return fail('رقم الموبايل ناقص');

  var plus = text.charAt(0) === '+';
  var digits = plus ? text.slice(1) : text;

  if (!/^\d+$/.test(digits)) return fail('رقم الموبايل فيه حروف أو رموز');

  var notEgyptian = 'الرقم مش رقم موبايل مصري';

  if (plus) {
    if (digits.indexOf('20') !== 0) return fail(notEgyptian);
    digits = digits.slice(2);
  }
  else if (digits.indexOf('0020') === 0) {
    digits = digits.slice(4);
  }
  else if (digits.indexOf('20') === 0 && digits.length >= 11) {
    digits = digits.slice(2);
  }

  // the trunk 0 (also after "+20 0…")
  if (digits.charAt(0) === '0') digits = digits.slice(1);

  if (digits.charAt(0) !== '1') return fail(notEgyptian);

  var count = digits.length + 1;

  if (digits.length < 10) {
    var missing = 10 - digits.length;
    return fail('رقم الموبايل ناقص ' + (missing === 1 ? 'رقم' : regAr_(missing) + ' أرقام') + ' (' + regAr_(count) + ' أرقام بدل ١١)');
  }

  if (digits.length > 10) {
    var extra = digits.length - 10;
    return fail('رقم الموبايل زيادة ' + (extra === 1 ? 'رقم' : regAr_(extra) + ' أرقام') + ' (' + regAr_(count) + ' رقم بدل ١١)');
  }

  if (!/^1[0125]\d{8}$/.test(digits)) return fail(notEgyptian);

  return { phone: '+20' + digits, norm: digits, local: '0' + digits, problem: '' };

}

/* typed code → its 8 symbols ('' when it can't be a code): Arabic digits, case, spaces, dashes, a leading ATH */
function regNormalizeCode_(value) {

  var text = regDigits_(typeof value === 'string' ? value.slice(0, 40) : '')
    .toUpperCase()
    .replace(/[‎‏؜‪-‮⁦-⁩﻿]/g, '')
    .replace(/[\s \-_.‐-―]/g, '');

  if (text.length === 11 && text.indexOf('ATH') === 0) text = text.slice(3);

  return REG_CODE_RE.test(text) ? text : '';

}

function regFormatCode_(code) {

  return 'ATH-' + code.slice(0, 4) + '-' + code.slice(4, 8);

}

/* rejection sampling: bytes ≥ 240 are skipped (240 = 8 × 30, no bias) → the symbols taken */
function regCodeFromBytes_(bytes, length) {

  var out = '';

  for (var i = 0; i < bytes.length && out.length < length; i++) {
    var b = bytes[i] & 255;
    if (b < 240) out += REG_CODE_ALPHABET.charAt(b % 30);
  }

  return out;

}

/* a fresh random code (8 symbols) */
function regNewCode_() {

  var code = '';

  while (code.length < 8) {
    code += regCodeFromBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid()), 8 - code.length);
  }

  return code;

}


/* =========================================================
   PURE: ONE PERSON'S FIELDS
========================================================= */

/**
 * The typed fields of one person → { name, nameNorm, phone, phoneNorm, local, group, church, notes,
 * errors: [{ field, message }], oneWord }. given: which of group / church / notes were in the input.
 */
function regCheckPerson_(input) {

  input = input || {};

  var out = { name: '', nameNorm: '', phone: '', phoneNorm: '', local: '', group: '', church: '', servant: '', notes: '', errors: [], oneWord: false };
  var name = contentLine_(input.name);

  out.name = name;
  out.nameNorm = normName_(name);

  if (!name) out.errors.push({ field: 'name', message: 'الاسم ناقص' });
  else if (/^[\d\s٠-٩۰-۹+\-.]+$/.test(name)) out.errors.push({ field: 'name', message: 'الاسم أرقام بس' });
  else if (name.length > REG_LIMITS.name) out.errors.push({ field: 'name', message: 'الاسم أطول من ' + regAr_(REG_LIMITS.name) + ' حرف' });
  else if (regLetterCount_(name) < REG_LIMITS.nameMin) out.errors.push({ field: 'name', message: 'الاسم قصير قوي (أقل من ٣ حروف)' });
  else if (out.nameNorm.split(' ').length < 2) out.oneWord = true;

  var phone = normPhoneEg_(input.phone);

  if (phone.problem) out.errors.push({ field: 'phone', message: phone.problem });
  else {
    out.phone = phone.phone;
    out.phoneNorm = phone.norm;
    out.local = phone.local;
  }

  // the birth date (optional; undefined = not given, so an edit keeps the stored one)
  if (input.birthDate !== undefined && input.birthDate !== null) {
    var birth = regBirthDate_(input.birthDate, compNow_().wall.slice(0, 10));
    if (birth.problem) out.errors.push({ field: 'birthDate', message: birth.problem });
    else out.birthDate = birth.date;
  }

  ['group', 'church', 'servant', 'notes'].forEach(function (key) {
    var value = key === 'notes' ? contentText_(input[key]).replace(/\s+/g, ' ').trim() : contentLine_(input[key]);
    if (value.length > REG_LIMITS[key]) out.errors.push({ field: key, message: REG_FIELD_LABELS[key] + ' أطول من ' + regAr_(REG_LIMITS[key]) + ' حرف' });
    out[key] = value;
  });

  return out;

}


/* =========================================================
   PURE: THE IMPORT PLAN (§7.5)
========================================================= */

var REG_IMPORT_COLUMNS = [
  // the export's first column: an existing person is matched by it (§7.5.1)
  { key: 'id', names: ['رقم المشترك', 'معرف المشترك', 'المعرف', 'id', 'participant id'] },
  { key: 'name', names: ['الاسم بالكامل', 'الاسم الكامل', 'الاسم', 'اسم', 'اسم المشترك', 'name', 'full name', 'fullname'] },
  { key: 'phone', names: ['رقم الموبايل', 'الموبايل', 'موبايل', 'التليفون', 'تليفون', 'رقم التليفون', 'الرقم', 'phone', 'mobile', 'phone number'] },
  { key: 'group', names: ['المجموعة / الفصل', 'المجموعة/الفصل', 'المجموعة', 'مجموعة', 'الفصل', 'فصل', 'group', 'class'] },
  { key: 'church', names: ['الكنيسة', 'كنيسة', 'church'] },
  { key: 'servant', names: ['الخادم المسؤول', 'الخادم المسئول', 'الخادم', 'خادم', 'servant'] },
  { key: 'notes', names: ['ملاحظات', 'ملاحظة', 'notes', 'note'] },
  { key: 'birthDate', names: ['تاريخ الميلاد', 'الميلاد', 'تاريخ ميلاد', 'birth date', 'birthdate', 'date of birth', 'dob'] },
  // the export's own columns: «نسخة البيانات» is checked; «الحالة» and «الكود» are never read
  { key: 'rev', names: ['نسخة البيانات', 'rev'] },
  { key: 'status', names: ['الحالة', 'status'] },
  { key: 'code', names: ['الكود', 'كود', 'code'] }
];

var REG_IMPORT_ORDER = ['name', 'phone', 'group', 'church', 'notes', 'birthDate'];

/* the columns a row's values are read from (never «الحالة» or «الكود») */
var REG_IMPORT_READ = ['id', 'name', 'phone', 'group', 'church', 'servant', 'notes', 'birthDate', 'rev'];

function regImportColumnOf_(cell) {

  var word = importWord_(cell);

  if (!word) return '';

  for (var i = 0; i < REG_IMPORT_COLUMNS.length; i++) {
    if (REG_IMPORT_COLUMNS[i].names.map(importWord_).indexOf(word) !== -1) return REG_IMPORT_COLUMNS[i].key;
  }

  return '';

}

/* the parts of a stored participant an import row is checked against (its fingerprint) */
function regMatchState_(p) {

  return p ? [p.id, p.nameNorm, p.phoneNorm, p.group || '', p.church || '', p.notes || '', p.status || '', p.servant || '', p.birthDate || '', p.updatedAt || ''] : null;

}

/*
 * A person's data version: a short hash of what an export shows (a re-imported row whose
 * person changed since the export is "stale"). Not a secret, only a change detector.
 */
function regRev_(p) {

  var text = JSON.stringify([p.name || '', p.phoneNorm || '', p.group || '', p.church || '', p.servant || '', p.notes || '', p.birthDate || '', p.status === 'inactive' ? 'inactive' : 'active']);
  var h = 0x811c9dc5;

  for (var i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  return ('0000000' + h.toString(16)).slice(-8);

}

/*
 * What a file row changes on a stored person: identity = the row was matched by its id
 * (then the name and the phone can change too). An empty cell keeps the stored value;
 * «-» (row.clears) empties it. → [{ field, label, from, to }]
 */
function regChanges_(row, match, given, identity) {

  var changes = [];

  if (identity) {
    if (row.name !== match.name) changes.push({ field: 'name', label: REG_FIELD_LABELS.name, from: match.name, to: row.name });
    if (row.phoneNorm !== match.phoneNorm) changes.push({ field: 'phone', label: REG_FIELD_LABELS.phone, from: match.phoneNorm ? '0' + match.phoneNorm : '', to: row.phone });
  }

  REG_OPTIONAL.forEach(function (field) {
    if (!given[field]) return;
    var clear = row.clears.indexOf(field) !== -1;
    var to = clear ? '' : row[field];
    var from = match[field] || '';
    if ((!clear && to === '') || to === from) return;
    changes.push({ field: field, label: REG_FIELD_LABELS[field], from: from, to: to });
  });

  return changes;

}

/**
 * The pasted / uploaded text against the registry (no writes):
 * existing = Participants rows ({ id, name, nameNorm, phone, phoneNorm, group, church, notes, status }).
 * → { problems, columns, ignored, rows, summary, groups }
 * row = { line, status: 'error' | 'exists' | 'dup' | 'new', name, phone (local), phoneNorm, group, church,
 *         notes, errors: [text], warnings: [{ kind, text, candidates? }], reason, match, changes,
 *         dupOf, fp, tickable, ticked, choices: [{ value, label }] }
 */
function planParticipantImport_(text, existing, hash) {

  var out = { problems: [], columns: [], ignored: [], rows: [], summary: null, groups: [] };

  hash = hash || sha256Hex_;

  if (String(text || '').length > REG_IMPORT_MAX_TEXT) {
    out.problems.push('الملف كبير قوي (الحد ١ ميجا). قسّمه لأكتر من مرة.');
    out.summary = regImportSummary_([]);
    return out;
  }

  var table = importCells_(text);

  if (!table.lines.length) {
    out.problems.push('مفيش صفوف. الصق الصفوف من إكسل أو جوجل شيت، أو اختار ملف.');
    out.summary = regImportSummary_([]);
    return out;
  }

  var header = table.lines[0].cells.map(regImportColumnOf_);
  var columns;
  var body;

  if (header.indexOf('name') !== -1 && header.indexOf('phone') !== -1) {
    columns = header.map(function (key, i) { return key && header.indexOf(key) === i ? key : ''; });
    table.lines[0].cells.forEach(function (cell, i) {
      if (!header[i] && contentLine_(cell)) out.ignored.push(contentLine_(cell));
    });
    body = table.lines.slice(1);
  }
  else if (!normPhoneEg_(table.lines[0].cells[1]).problem) {
    // no header: الاسم، الموبايل، المجموعة، الكنيسة، ملاحظات
    columns = REG_IMPORT_ORDER.slice();
    body = table.lines;
  }
  else {
    out.problems.push('أول صف لازم يكون العناوين وفيهم «الاسم بالكامل» و«رقم الموبايل». نزّل النموذج وامشي عليه.');
    out.summary = regImportSummary_([]);
    return out;
  }

  out.columns = columns.filter(function (key) { return REG_IMPORT_READ.indexOf(key) !== -1; });
  // a «الكود» column is never read (codes are made only by the panel)
  out.codeIgnored = columns.indexOf('code') !== -1;

  if (body.length > REG_IMPORT_MAX_ROWS) {
    out.problems.push('الملف فيه ' + regAr_(body.length) + ' صف، والحد ' + regAr_(REG_IMPORT_MAX_ROWS) + ' في المرة. قسّمه.');
    body = body.slice(0, REG_IMPORT_MAX_ROWS);
  }

  /* the registry, indexed */
  var byKey = Object.create(null);
  var byId = Object.create(null);
  var byName = Object.create(null);
  var byPhone = Object.create(null);
  var knownGroups = Object.create(null);

  (existing || []).forEach(function (p) {
    var nameNorm = p.nameNorm || normName_(p.name);
    var record = { id: p.id, name: p.name, nameNorm: nameNorm, phoneNorm: p.phoneNorm, group: p.group || '', church: p.church || '', servant: p.servant || '', notes: p.notes || '', birthDate: p.birthDate || '', status: p.status || 'active', updatedAt: p.updatedAt || '' };
    record.rev = regRev_(record);
    byId[p.id] = record;
    byKey[nameNorm + '|' + p.phoneNorm] = byKey[nameNorm + '|' + p.phoneNorm] || record;
    (byName[nameNorm] = byName[nameNorm] || []).push(record);
    (byPhone[p.phoneNorm] = byPhone[p.phoneNorm] || []).push(record);
    if (record.group) knownGroups[normName_(record.group)] = true;
  });

  /* every row checked on its own */
  var given = {};

  REG_OPTIONAL.forEach(function (key) { given[key] = columns.indexOf(key) !== -1; });

  var rows = body.map(function (entry) {
    var raw = {};
    var clears = [];
    columns.forEach(function (key, i) { if (REG_IMPORT_READ.indexOf(key) !== -1) raw[key] = entry.cells[i] === undefined ? '' : String(entry.cells[i]); });
    REG_OPTIONAL.forEach(function (key) {
      if (raw[key] !== undefined && REG_CLEAR.test(raw[key].trim())) {
        clears.push(key);
        raw[key] = '';
      }
    });
    var checked = regCheckPerson_(raw);
    var id = contentLine_(raw.id);
    if (id && !REG_ID.test(id)) checked.errors.push({ field: 'id', message: 'رقم المشترك «' + id.slice(0, 20) + '» مش صحيح: سيبه زي ما اتصدّر، أو امسحه لو ده شخص جديد' });
    else if (id && !byId[id]) checked.errors.push({ field: 'id', message: 'رقم المشترك ' + id + ' مش موجود في السجل: لو ده شخص جديد امسح رقم المشترك من الصف' });
    var row = {
      line: entry.line,
      status: checked.errors.length ? 'error' : 'new',
      name: checked.name,
      nameNorm: checked.nameNorm,
      phone: checked.local || contentLine_(raw.phone),
      phoneNorm: checked.phoneNorm,
      phoneIntl: checked.phone,
      group: checked.group,
      church: checked.church,
      servant: checked.servant,
      notes: checked.notes,
      birthDate: checked.birthDate || '',
      id: id,
      rev: contentLine_(raw.rev),
      clears: clears,
      fromId: false,
      stale: false,
      errors: checked.errors.map(function (e) { return e.message; }),
      warnings: [],
      reason: '',
      match: null,
      changes: [],
      dupOf: 0,
      oneWord: checked.oneWord,
      sameName: [],
      fileSameName: [],
      sharedPhone: [],
      fileSharedPhone: []
    };
    return row;
  });

  /* in-file relations */
  var firstByKey = Object.create(null);
  var firstById = Object.create(null);
  var fileByName = Object.create(null);
  var fileByPhone = Object.create(null);

  rows.forEach(function (row) {
    if (row.status === 'error') return;
    (fileByName[row.nameNorm] = fileByName[row.nameNorm] || []).push(row);
    (fileByPhone[row.phoneNorm] = fileByPhone[row.phoneNorm] || []).push(row);
  });

  rows.forEach(function (row) {

    if (row.status === 'error') return;

    var key = row.nameNorm + '|' + row.phoneNorm;
    var earlier = firstByKey[key];

    /* a row with the export's id: that person, whatever the name and phone say now */
    if (row.id) {
      var sameId = firstById[row.id];
      var owner = byKey[key];
      var earlierId = earlier ? earlier.id || (earlier.match && earlier.match.id) || '' : '';
      if (sameId || (earlier && earlierId === row.id)) {
        row.status = 'dup';
        row.dupOf = (sameId || earlier).line;
        row.reason = 'نفس المشترك في صف ' + regAr_(row.dupOf);
        return;
      }
      if ((owner && owner.id !== row.id) || earlier) {
        row.status = 'error';
        row.errors.push('الاسم والرقم دول ' + (owner && owner.id !== row.id ? 'متسجلين لمشترك تاني: ' + owner.name + (owner.group ? ' (' + owner.group + ')' : '') : 'في صف ' + regAr_(earlier.line) + ' كمان'));
        return;
      }
      firstById[row.id] = row;
      firstByKey[key] = row;
      row.status = 'exists';
      row.fromId = true;
      row.match = byId[row.id];
      row.changes = regChanges_(row, row.match, given, true);
      row.stale = !!(row.changes.length && row.rev && row.rev !== row.match.rev);
      row.reason = row.changes.length ? 'فيه بيانات اتغيرت' : 'زي ما هو';
      return;
    }

    if (earlier) {
      row.status = 'dup';
      row.dupOf = earlier.line;
      row.reason = 'نفس صف ' + regAr_(earlier.line);
      return;
    }

    firstByKey[key] = row;

    var match = byKey[key];

    if (match) {
      row.status = 'exists';
      row.match = match;
      row.changes = regChanges_(row, match, given, false);
      row.reason = row.changes.length ? 'متسجل، وفيه بيانات مختلفة' : 'متسجل قبل كده';
      return;
    }

    row.status = 'new';
    row.sameName = (byName[row.nameNorm] || []).filter(function (p) { return p.phoneNorm !== row.phoneNorm; });
    row.sharedPhone = (byPhone[row.phoneNorm] || []).filter(function (p) { return p.nameNorm !== row.nameNorm; });
    row.fileSameName = (fileByName[row.nameNorm] || []).filter(function (r) { return r !== row && r.phoneNorm !== row.phoneNorm; });
    row.fileSharedPhone = (fileByPhone[row.phoneNorm] || []).filter(function (r) { return r !== row && r.nameNorm !== row.nameNorm; });

  });

  /* warnings, choices, fingerprints */
  rows.forEach(function (row) {

    if (row.status === 'new') {

      if (row.sharedPhone.length || row.fileSharedPhone.length) {
        var with_ = row.sharedPhone.slice(0, 3).map(function (p) { return p.name + ' (في السجل)'; })
          .concat(row.fileSharedPhone.slice(0, 3).map(function (r) { return 'صف ' + regAr_(r.line); }));
        row.warnings.push({ kind: 'sharedPhone', text: 'نفس الرقم مع: ' + with_.join(' · '), candidates: row.sharedPhone.slice(0, 5).map(regCandidate_) });
      }

      if (row.sameName.length) {
        row.warnings.push({
          kind: 'sameName',
          text: 'نفس الاسم متسجل برقم تاني: ' + row.sameName.slice(0, 3).map(function (p) { return '0' + p.phoneNorm + (p.group ? ' (' + p.group + ')' : ''); }).join(' · '),
          candidates: row.sameName.slice(0, 5).map(regCandidate_)
        });
      }
      else if (row.fileSameName.length) {
        row.warnings.push({ kind: 'sameName', text: 'نفس الاسم في ' + row.fileSameName.slice(0, 3).map(function (r) { return 'صف ' + regAr_(r.line); }).join(' · ') + ' برقم تاني', candidates: [] });
      }

      if (row.oneWord) row.warnings.push({ kind: 'oneWord', text: 'الاسم كلمة واحدة بس: الأحسن الاسم بالكامل' });
    }

    if (row.stale) {
      row.warnings.push({ kind: 'stale', text: 'المشترك ده اتعدّل في لوحة التحكم بعد ما الملف اتصدّر: قارن قبل ما تعلّم عليه' });
    }

    row.fp = hash(JSON.stringify([
      row.status, row.nameNorm, row.phoneNorm, row.name, row.group, row.church, row.notes,
      row.servant, row.birthDate, row.id, row.clears,
      regMatchState_(row.match),
      row.sameName.map(function (p) { return [p.id, p.phoneNorm, p.status]; }),
      row.sharedPhone.map(function (p) { return p.id; })
    ])).slice(0, 16);

    row.choices = [];

    if (row.status === 'new') {
      row.choices.push({ value: 'add:' + row.fp, label: 'ضيفه كمشترك جديد' });
      row.sameName.slice(0, 5).forEach(function (p) {
        row.choices.push({ value: 'phone:' + p.id + ':' + row.fp, label: 'نفس الشخص «' + p.name + '»: غيّر رقمه للرقم الجديد (الكود بيفضل زي ما هو)' });
      });
    }
    else if (row.status === 'exists' && row.changes.length) {
      row.choices.push({ value: 'update:' + row.match.id + ':' + row.fp, label: 'حدّث ' + row.changes.map(function (c) { return c.label; }).join(' و') });
    }

    row.tickable = row.choices.length > 0;
    // new rows and the export's own rows (matched by id, not changed since) are ticked;
    // name + phone updates, stale rows and the same-name ones wait for the admin
    row.ticked = row.status === 'new' ? !row.warnings.some(function (w) { return w.kind === 'sameName'; })
      : row.status === 'exists' && row.fromId && row.changes.length > 0 && !row.stale;

  });

  out.rows = rows;
  out.summary = regImportSummary_(rows);

  /* the groups the file uses (new = not in the registry yet) */
  var groups = Object.create(null);
  var order = [];

  rows.forEach(function (row) {
    if (row.status === 'error' || !row.group) return;
    var key = normName_(row.group);
    if (!groups[key]) {
      groups[key] = { name: row.group, count: 0, isNew: !knownGroups[key] };
      order.push(key);
    }
    groups[key].count++;
  });

  out.groups = order.map(function (k) { return groups[k]; });

  return out;

}

function regCandidate_(p) {

  return { id: p.id, name: p.name, phone: p.phoneNorm ? '0' + p.phoneNorm : '', group: p.group || '', status: p.status || 'active' };

}

function regImportSummary_(rows) {

  var s = { total: rows.length, new: 0, exists: 0, update: 0, dup: 0, error: 0, ticked: 0, warnings: { sharedPhone: 0, sameName: 0, oneWord: 0, stale: 0 } };

  rows.forEach(function (row) {
    s[row.status]++;
    if (row.status === 'exists' && row.changes.length) s.update++;
    if (row.ticked) s.ticked++;
    row.warnings.forEach(function (w) { s.warnings[w.kind]++; });
  });

  return s;

}

/* what the page gets of a planned row (internal links dropped) */
function regImportRowOut_(row) {

  return {
    line: row.line,
    status: row.status,
    name: row.name,
    phone: row.phone,
    group: row.group,
    church: row.church,
    servant: row.servant || '',
    notes: row.notes,
    birthDate: row.birthDate || '',
    id: row.id || '',
    rev: row.rev || '',
    clears: row.clears || [],
    fromId: !!row.fromId,
    errors: row.errors,
    warnings: row.warnings,
    reason: row.reason,
    match: row.match ? regCandidate_(row.match) : null,
    changes: row.changes,
    dupOf: row.dupOf,
    fp: row.fp,
    tickable: row.tickable,
    ticked: row.ticked,
    choices: row.choices
  };

}


/* =========================================================
   STORAGE
========================================================= */

function regKeys_() {

  if (!REG_KEYS_) {
    REG_KEYS_ = { pepper: compSecretBytes_('CODE_PEPPER'), key: compSecretBytes_('CODE_KEY') };
  }

  return REG_KEYS_;

}

function regHex_(bytes) {

  return bytes.map(function (b) {
    var h = (b & 255).toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');

}

/* codeHash of 8 normalized symbols */
function regHash_(code) {

  return regHex_(Utilities.computeHmacSha256Signature(compUtf8_(code), regKeys_().pepper));

}

/* a code the registry doesn't have yet → { code, codeHash, codeEnc } (taken: { hash: true }) */
function regIssueCode_(taken) {

  for (var i = 0; i < 20; i++) {
    var code = regNewCode_();
    var hash = regHash_(code);
    if (taken[hash]) continue;
    taken[hash] = true;
    return { code: code, codeHash: hash, codeEnc: compEncrypt_(code, regKeys_().key) };
  }

  throw new Error('code');

}

/* the Participants tab (made on first use; the spreadsheet only from admin writes) */
function regSheet_() {

  return compSheet_('Participants');

}

/* every participant row (small tab: one read) */
function regRows_() {

  return compSpreadsheet_(false) ? compRows_(regSheet_()) : [];

}

/* the codeHash column as { hash: true } */
function regTakenHashes_(rows) {

  var taken = Object.create(null);

  rows.forEach(function (r) { if (r.codeHash) taken[r.codeHash] = true; });

  return taken;

}

function regFind_(id) {

  compValidId_(id, REG_ID, 'معرّف المشترك');

  var row = regRows_().filter(function (r) { return r.id === id; })[0];

  if (!row) throw new Error('المشترك مش موجود');

  return row;

}

function regDropHashes_() {

  compCacheDrop_('reg:hash');

}

/* { codeHash: participantId } (cached; fresh = read the tab) */
function regHashMap_(fresh) {

  if (!fresh) {
    var text = compCacheGet_('reg:hash');
    if (text) {
      try {
        return { map: JSON.parse(text), cached: true };
      }
      catch (ignored) {
        // read again
      }
    }
  }

  var map = {};

  compColumns_(regSheet_(), ['id', 'codeHash']).forEach(function (r) {
    if (r.codeHash && r.id) map[r.codeHash] = r.id;
  });

  compCachePut_('reg:hash', JSON.stringify(map), REG_HASH_SECONDS);

  return { map: map, cached: false };

}

/* the participant as the admin sees it (NEVER the code, its hash or its encrypted copy) */
function regPerson_(row) {

  var age = regEligibilityOf_(row);

  return {
    id: row.id,
    name: row.name,
    phone: row.phoneNorm ? '0' + row.phoneNorm : '',
    phoneIntl: row.phone || '',
    group: row.group || '',
    church: row.church || '',
    servant: row.servant || '',
    notes: row.notes || '',
    status: row.status === 'inactive' ? 'inactive' : 'active',
    active: row.status !== 'inactive',
    codeVersion: Number(row.codeVersion) || 1,
    codeIssuedAt: row.codeIssuedAt || '',
    // who made the current code (an admin's email; the admin page shows the display name)
    codeIssuedBy: row.codeIssuedBy || '',
    hasCode: !!row.codeHash,
    importBatch: row.importBatch || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    birthDate: row.birthDate || '',
    rev: regRev_(row),
    age: age.age,
    eligibility: age.state,
    leavesAt: age.leavesAt
  };

}

/* a participant's draft change under the script lock; Activity written after it succeeded */
function regWrite_(label, change) {

  var email = currentEmail_();
  var lock = LockService.getScriptLock();
  var result;

  // the code secrets are made before the lock (never inside it)
  compEnsureSecrets_();
  lock.waitLock(30000);
  COMP_SCRIPT_LOCK_HELD_ = true;

  try {
    takeActivityNotes_();
    compSpreadsheet_(true);
    result = change(email);
    try {
      // counts only: never a code or a phone in the log
      log_(email, 'reg.' + label, result && typeof result.log === 'string' ? result.log : '');
    }
    catch (ignored) {
      // the change stands
    }
    takeActivityNotes_().forEach(function (entry) { activity_(entry); });
  }
  finally {
    takeActivityNotes_();
    COMP_SCRIPT_LOCK_HELD_ = false;
    lock.releaseLock();
  }

  if (result && result.log !== undefined) delete result.log;

  return result;

}

/* a participant's new row (the code is made by the caller) */
function regNewRecord_(checked, issued, email, stamp, batch) {

  return {
    id: 'p-' + compRandomHex_(4),
    name: checked.name,
    nameNorm: checked.nameNorm,
    phone: checked.phone,
    phoneNorm: checked.phoneNorm,
    group: checked.group,
    church: checked.church,
    servant: checked.servant || '',
    notes: checked.notes,
    birthDate: checked.birthDate || '',
    status: 'active',
    codeHash: issued.codeHash,
    codeEnc: issued.codeEnc,
    codeVersion: '1',
    codeIssuedAt: stamp,
    codeIssuedBy: email,
    importBatch: batch || '',
    createdBy: email,
    createdAt: stamp,
    updatedAt: stamp
  };

}


/* =========================================================
   ADMIN: LIST, ONE, SAVE, ACTIVE
========================================================= */

/* the digits of a phone search, in the stored 10-digit form ('' when too short) */
function regPhoneSearch_(text) {

  var digits = regDigits_(text).replace(/\D/g, '');

  if (digits.indexOf('0020') === 0) digits = digits.slice(4);
  else if (digits.indexOf('20') === 0 && digits.length >= 11) digits = digits.slice(2);
  if (digits.charAt(0) === '0') digits = digits.slice(1);

  return digits.length >= 3 ? digits : '';

}

/**
 * query: { q (name / phone / id), group, status: 'all' | 'active' | 'inactive',
 *          sort: 'name' | 'group' | 'createdAt' | 'updatedAt' | 'balance', dir, offset, limit ≤ 200 }
 * → { ready, items: [Person (+ balance when the wallet is on)], total, offset, limit, counts, groups, batches, modules }
 */
function apiParticipants(query) {

  assertAdmin_();

  query = query && typeof query === 'object' && !Array.isArray(query) ? query : {};

  var modules = compModules_();
  // all: the whole registry in one answer (≤ exportMax): the admin filters, searches and sorts it locally
  var all = query.all === true;
  var limit = all ? REG_LIMITS.exportMax : Math.max(1, Math.min(REG_LIMITS.pageMax, Math.floor(Number(query.limit)) || REG_LIMITS.page));
  var offset = all ? 0 : Math.max(0, Math.floor(Number(query.offset)) || 0);
  var result = { ready: false, items: [], total: 0, offset: offset, limit: limit, counts: { all: 0, active: 0, inactive: 0 }, groups: [], batches: [], modules: modules };

  if (!compSpreadsheet_(false)) return result;

  var rows = regRows_();
  var search = typeof query.q === 'string' ? query.q.slice(0, REG_LIMITS.search) : '';
  var nameKey = normName_(search);
  var phoneKey = regPhoneSearch_(search);
  var group = typeof query.group === 'string' ? normName_(query.group) : '';
  var status = query.status === 'active' || query.status === 'inactive' ? query.status : 'all';
  var eligibility = ['ok', 'soon', 'out', 'unknown'].indexOf(query.eligibility) !== -1 ? query.eligibility : 'all';
  var balances = modules.wallet && typeof walletBalances_ === 'function' ? walletBalances_() : null;
  var groups = Object.create(null);
  var batches = Object.create(null);

  result.ready = true;

  rows.forEach(function (r) {
    var active = r.status !== 'inactive';
    result.counts.all++;
    result.counts[active ? 'active' : 'inactive']++;
    if (r.group) {
      var g = groups[normName_(r.group)] = groups[normName_(r.group)] || { name: r.group, count: 0 };
      g.count++;
    }
    if (r.importBatch) {
      var b = batches[r.importBatch] = batches[r.importBatch] || { id: r.importBatch, count: 0, at: r.createdAt || '' };
      b.count++;
    }
  });

  var found = rows.filter(function (r) {
    if (status !== 'all' && (r.status === 'inactive' ? 'inactive' : 'active') !== status) return false;
    if (eligibility !== 'all' && regEligibilityOf_(r).state !== eligibility) return false;
    if (group && normName_(r.group) !== group) return false;
    if (search) {
      var inName = !!nameKey && (r.nameNorm || normName_(r.name)).indexOf(nameKey) !== -1;
      var inPhone = !!phoneKey && String(r.phoneNorm || '').indexOf(phoneKey) !== -1;
      if (!inName && !inPhone && r.id !== search.trim()) return false;
    }
    return true;
  });

  var dir = query.dir === 'desc' ? -1 : 1;
  var key = {
    group: function (r) { return normName_(r.group) + '|' + (r.nameNorm || ''); },
    createdAt: function (r) { return r.createdAt || ''; },
    updatedAt: function (r) { return r.updatedAt || ''; },
    balance: function (r) { return balances ? balances[r.id] || 0 : 0; }
  }[query.sort] || function (r) { return r.nameNorm || normName_(r.name); };

  found.sort(function (a, b) { var x = key(a); var y = key(b); return x === y ? a.__row - b.__row : (x < y ? -dir : dir); });

  result.total = found.length;
  result.items = found.slice(offset, offset + limit).map(function (r) {
    var person = regPerson_(r);
    if (balances) person.balance = balances[r.id] || 0;
    return person;
  });
  result.groups = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.count - a.count; });
  // the churches and the responsible servants in use (filters, the editor's suggestions, distribution)
  ['church', 'servant'].forEach(function (field) {
    var seen = Object.create(null);
    rows.forEach(function (r) {
      if (!r[field]) return;
      var k = normName_(r[field]);
      (seen[k] = seen[k] || { name: r[field], count: 0 }).count++;
    });
    result[field === 'church' ? 'churches' : 'servants'] = Object.keys(seen).map(function (k) { return seen[k]; }).sort(function (a, b) { return b.count - a.count; });
  });
  result.eligibility = { ok: 0, soon: 0, out: 0, unknown: 0 };
  result.ageRules = regAgeRules_();
  rows.forEach(function (r) { result.eligibility[regEligibilityOf_(r).state]++; });
  result.batches = Object.keys(batches).map(function (k) { return batches[k]; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 20);

  return result;

}


/**
 * One participant: { participant: Person, history: [{ submissionId, compId, title, slug, attemptNo, status,
 * startedAt, submittedAt, score, maxScore, pending, points (null without the wallet) }], wallet: { balance,
 * earned, adjusted, spent, entries } | null, modules }   — never the code.
 */
function apiParticipant(id) {

  assertAdmin_();

  var row = regFind_(id);
  var modules = compModules_();
  var titles = Object.create(null);

  compRows_(compSheet_('Competitions')).forEach(function (c) { titles[c.id] = { title: c.title, slug: c.slug }; });

  var points = Object.create(null);
  var wallet = null;

  if (modules.wallet && typeof walletLedger_ === 'function') {
    var entries = walletLedger_().filter(function (l) { return l.participantId === id; });
    wallet = walletTotals_(entries);
    entries.forEach(function (l) {
      if (l.refType === 'submission') points[l.refId] = (points[l.refId] || 0) + (Number(l.amount) || 0);
    });
  }

  var history = compColumns_(compSheet_('Submissions'), ['id', 'compId', 'attemptNo', 'participantId', 'status', 'startedAt', 'submittedAt',
    'startedMs', 'score', 'maxScore', 'pendingCount'])
    .filter(function (s) { return s.participantId === id; })
    .sort(function (a, b) { return (Number(b.startedMs) || 0) - (Number(a.startedMs) || 0); })
    .map(function (s) {
      var comp = titles[s.compId] || { title: '', slug: '' };
      return {
        submissionId: s.id,
        compId: s.compId,
        title: comp.title,
        slug: comp.slug,
        attemptNo: Number(s.attemptNo) || 1,
        status: s.status,
        startedAt: s.startedAt,
        submittedAt: s.submittedAt,
        score: Number(s.score) || 0,
        maxScore: Number(s.maxScore) || 0,
        pending: Number(s.pendingCount) || 0,
        points: wallet ? points[s.id] || 0 : null
      };
    });

  return { participant: regPerson_(row), history: history, wallet: wallet, modules: modules };

}


/* the other participants a person collides with: { exists, samePhone: [names], sameName: [count] } */
function regDuplicates_(checked, rows, selfId) {

  var others = rows.filter(function (r) { return r.id !== selfId; });

  return {
    exists: others.filter(function (r) { return (r.nameNorm || normName_(r.name)) === checked.nameNorm && r.phoneNorm === checked.phoneNorm; })[0] || null,
    samePhone: others.filter(function (r) { return r.phoneNorm === checked.phoneNorm && (r.nameNorm || normName_(r.name)) !== checked.nameNorm; }),
    sameName: others.filter(function (r) { return (r.nameNorm || normName_(r.name)) === checked.nameNorm && r.phoneNorm !== checked.phoneNorm; })
  };

}


/**
 * Adds (no input.id) or edits a participant: input { id?, name, phone, group, church, notes }.
 * The phone is normalized; the same name + phone as someone else is refused («متسجل قبل كده»);
 * the same phone with another name (a family) and the same name with another phone are
 * warnings. An edit keeps the id and the code; a new phone is logged as participant.phone.
 * → { participant: Person, created, warnings: [text] }   (no code: apiParticipantCode shows it)
 */
function apiParticipantSave(input) {

  assertAdmin_();
  regRequireOn_();

  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  var id = input.id === undefined || input.id === null || input.id === '' ? '' : compValidId_(input.id, REG_ID, 'معرّف المشترك');

  var saved = regWrite_('save', function (email) {

    if (id) assertUnlocked_('participant:' + id);

    var t = regSheet_();
    var rows = compRows_(t);
    var current = id ? rows.filter(function (r) { return r.id === id; })[0] : null;

    if (id && !current) throw new Error('المشترك مش موجود');

    var merged = {
      name: input.name !== undefined ? input.name : current && current.name,
      phone: input.phone !== undefined ? input.phone : current && current.phone,
      group: input.group !== undefined ? input.group : current && current.group,
      church: input.church !== undefined ? input.church : current && current.church,
      servant: input.servant !== undefined ? input.servant : current && current.servant,
      notes: input.notes !== undefined ? input.notes : current && current.notes,
      // undefined = not sent: an edit keeps the stored birth date
      birthDate: input.birthDate !== undefined ? input.birthDate : current ? current.birthDate || '' : undefined
    };
    var checked = regCheckPerson_(merged);

    if (checked.errors.length) {
      throw appError_(checked.errors[0].message, '', '', checked.errors[0].field);
    }

    var dup = regDuplicates_(checked, rows, id);

    if (dup.exists) {
      throw appError_('المشترك ده متسجل قبل كده: ' + dup.exists.name + (dup.exists.group ? ' (' + dup.exists.group + ')' : '') + '.', 'نفس الاسم ونفس الرقم. دوّر عليه في القايمة وعدّل بياناته.');
    }

    var warnings = [];

    if (dup.samePhone.length) warnings.push('نفس الرقم متسجل كمان لـ: ' + dup.samePhone.slice(0, 3).map(function (r) { return r.name; }).join('، '));
    if (dup.sameName.length) warnings.push('فيه ' + (dup.sameName.length === 1 ? 'مشترك تاني' : regAr_(dup.sameName.length) + ' مشتركين') + ' بنفس الاسم برقم تاني');
    if (checked.oneWord) warnings.push('الاسم كلمة واحدة بس: الأحسن الاسم بالكامل');

    var stamp = compNow_().stamp;
    var record;

    if (!current) {
      record = regNewRecord_(checked, regIssueCode_(regTakenHashes_(rows)), email, stamp, '');
      compAppend_(t, [record]);
      regDropHashes_();
      activityNote_({ action: 'create', type: 'participant', id: record.id, title: record.name });
      return { id: record.id, created: true, warnings: warnings, log: record.id };
    }

    record = {
      name: checked.name,
      nameNorm: checked.nameNorm,
      phone: checked.phone,
      phoneNorm: checked.phoneNorm,
      group: checked.group,
      church: checked.church,
      servant: checked.servant,
      notes: checked.notes,
      birthDate: checked.birthDate === undefined ? current.birthDate || '' : checked.birthDate,
      updatedAt: stamp
    };

    compUpdate_(t, current.__row, record, current);

    if (current.phoneNorm !== checked.phoneNorm) {
      activityNote_({ action: 'participant.phone', type: 'participant', id: id, title: checked.name });
    }

    var before = { name: current.name, group: current.group, church: current.church, servant: current.servant || '', notes: current.notes };
    var after = { name: checked.name, group: checked.group, church: checked.church, servant: checked.servant, notes: checked.notes };
    var diff = activityDiff_(before, after);

    if (diff && diff.fields && (diff.fields.length || diff.other)) {
      activityNote_({ action: 'update', type: 'participant', id: id, title: checked.name, changes: diff });
    }

    return { id: id, created: false, warnings: warnings, log: id };

  });

  return { participant: regPerson_(regFind_(saved.id)), created: saved.created, warnings: saved.warnings };

}


/** active === false stops the code working at once (its tokens too); true brings it back. → { participant } */
function apiParticipantSetActive(id, active) {

  assertAdmin_();
  regRequireOn_();
  compValidId_(id, REG_ID, 'معرّف المشترك');

  regWrite_('active', function () {
    assertUnlocked_('participant:' + id);
    var row = regFind_(id);
    var status = active === false ? 'inactive' : 'active';
    if ((row.status === 'inactive' ? 'inactive' : 'active') !== status) {
      compUpdate_(regSheet_(), row.__row, { status: status, updatedAt: compNow_().stamp }, row);
      regDropHashes_();
      activityNote_({ action: status === 'active' ? 'enable' : 'disable', type: 'participant', id: id, title: row.name });
    }
    return { log: id + ' ' + status };
  });

  return { participant: regPerson_(regFind_(id)) };

}


/* =========================================================
   ADMIN: CODES (view, export, reset) — every one logged
========================================================= */

/* the readable code of a row ('' when its encrypted copy can't be read) */
function regCodeOf_(row) {

  var code = row.codeEnc ? compDecrypt_(row.codeEnc, regKeys_().key) : null;

  return code && REG_CODE_RE.test(code) ? regFormatCode_(code) : '';

}

/** «اعرض الكود»: → { id, code, codeVersion } (logged as code.view, merged per admin + participant for 10 minutes) */
function apiParticipantCode(id) {

  assertAdmin_();

  var row = regFind_(id);
  var code = regCodeOf_(row);

  if (!code) {
    throw appError_('الكود ده مش متاح للعرض.', 'اعمل كود جديد للمشترك ده («كود جديد»): القديم هيبطل.');
  }

  activity_({ action: 'code.view', type: 'participant', id: id, title: row.name, notify: false });

  return { id: id, code: code, codeVersion: Number(row.codeVersion) || 1 };

}


/**
 * Codes for printing / sharing: sel = { batch } | { ids: [...] } | { all: true }.
 * → { rows: [{ id, name, phone, group, code }], count, filename }   (logged as code.export with the count)
 */
function apiParticipantCodes(sel) {

  assertAdmin_();

  sel = sel && typeof sel === 'object' && !Array.isArray(sel) ? sel : {};

  var rows = regRows_();
  var picked;
  var label;

  if (typeof sel.batch === 'string' && REG_BATCH.test(sel.batch)) {
    picked = rows.filter(function (r) { return r.importBatch === sel.batch; });
    label = sel.batch;
  }
  else if (Array.isArray(sel.ids) && sel.ids.length && sel.ids.length <= REG_LIMITS.exportMax && sel.ids.every(function (x) { return typeof x === 'string' && REG_ID.test(x); })) {
    var wanted = Object.create(null);
    sel.ids.forEach(function (x) { wanted[x] = true; });
    picked = rows.filter(function (r) { return wanted[r.id]; });
    label = 'selected';
  }
  else if (sel.all === true) {
    picked = rows.filter(function (r) { return r.status !== 'inactive'; });
    label = 'all';
  }
  else {
    throw new Error('اختار مين اللي عايز أكوادهم');
  }

  picked = picked.slice(0, REG_LIMITS.exportMax).sort(function (a, b) {
    var x = normName_(a.group) + '|' + a.nameNorm;
    var y = normName_(b.group) + '|' + b.nameNorm;
    return x < y ? -1 : x > y ? 1 : 0;
  });

  var out = picked.map(function (r) {
    return { id: r.id, name: r.name, phone: r.phoneNorm ? '0' + r.phoneNorm : '', group: r.group || '', church: r.church || '', servant: r.servant || '', code: regCodeOf_(r) };
  });

  activity_({ action: 'code.export', type: 'participant', id: label, title: '', changes: { count: out.length } });

  return { rows: out, count: out.length, filename: 'codes-' + compNow_().stamp.slice(0, 10) + '.xlsx' };

}


/**
 * «كود جديد»: a new code (new hash and encrypted copy, codeVersion + 1). The old code and every
 * old participant token stop at once. → { id, code, codeVersion }   (the new code, once; logged code.reset)
 */
function apiParticipantResetCode(id) {

  assertAdmin_();
  compValidId_(id, REG_ID, 'معرّف المشترك');

  var holder = {};

  regWrite_('code.reset', function (email) {
    assertUnlocked_('participant:' + id);
    var t = regSheet_();
    var rows = compRows_(t);
    var row = rows.filter(function (r) { return r.id === id; })[0];
    if (!row) throw new Error('المشترك مش موجود');
    var issued = regIssueCode_(regTakenHashes_(rows));
    var stamp = compNow_().stamp;
    var version = (Number(row.codeVersion) || 1) + 1;
    compUpdate_(t, row.__row, { codeHash: issued.codeHash, codeEnc: issued.codeEnc, codeVersion: String(version), codeIssuedAt: stamp, codeIssuedBy: email, updatedAt: stamp }, row);
    regDropHashes_();
    activityNote_({ action: 'code.reset', type: 'participant', id: id, title: row.name });
    holder.code = regFormatCode_(issued.code);
    holder.version = version;
    return { log: id + ' v' + version };
  });

  return { id: id, code: holder.code, codeVersion: holder.version };

}


/* ids from the page (the selection): every one a p- id, ≤ exportMax → { id: true } */
function regIdSet_(ids) {

  if (!Array.isArray(ids) || !ids.length || ids.length > REG_LIMITS.exportMax || !ids.every(function (x) { return typeof x === 'string' && REG_ID.test(x); })) {
    throw new Error('اختار المشتركين الأول');
  }

  var set = Object.create(null);

  ids.forEach(function (x) { set[x] = true; });

  return set;

}

/**
 * «كود جديد للمحددين»: every selected participant gets a new code (the old ones and their
 * tokens stop at once). One read, one write. → { count }   (never the codes: «توزيع الأكواد» shows them)
 */
function apiParticipantsResetCodes(ids) {

  assertAdmin_();
  regRequireOn_();

  var set = regIdSet_(ids);

  return regWrite_('code.reset', function (email) {
    var t = regSheet_();
    var rows = compRows_(t);
    var taken = regTakenHashes_(rows);
    var stamp = compNow_().stamp;
    var updates = [];
    rows.forEach(function (r) {
      if (!set[r.id]) return;
      var issued = regIssueCode_(taken);
      updates.push({ row: r.__row, record: { codeHash: issued.codeHash, codeEnc: issued.codeEnc, codeVersion: String((Number(r.codeVersion) || 1) + 1), codeIssuedAt: stamp, codeIssuedBy: email, updatedAt: stamp } });
    });
    compUpdateMany_(t, updates);
    if (updates.length) {
      regDropHashes_();
      activityNote_({ action: 'code.reset', type: 'participant', id: 'bulk-' + compRandomHex_(4), title: '', changes: { count: updates.length } });
    }
    return { count: updates.length, log: 'bulk ' + updates.length };
  });

}

/**
 * Sets one field for every selected participant: change = { servant } | { group } (text, '' clears).
 * One read, one write. → { count }   (only the rows whose value changes)
 */
function apiParticipantsAssign(ids, change) {

  assertAdmin_();
  regRequireOn_();

  var set = regIdSet_(ids);

  change = change && typeof change === 'object' && !Array.isArray(change) ? change : {};

  var field = change.servant !== undefined ? 'servant' : change.group !== undefined ? 'group' : '';

  if (!field) throw new Error('اختار تغيّر إيه');

  var value = contentLine_(change[field]);

  if (value.length > REG_LIMITS[field]) throw appError_(REG_FIELD_LABELS[field] + ' أطول من ' + regAr_(REG_LIMITS[field]) + ' حرف', '', '', field);

  return regWrite_('assign', function () {
    var t = regSheet_();
    var stamp = compNow_().stamp;
    var updates = [];
    compRows_(t).forEach(function (r) {
      if (!set[r.id] || (r[field] || '') === value) return;
      var record = { updatedAt: stamp };
      record[field] = value;
      updates.push({ row: r.__row, record: record });
    });
    compUpdateMany_(t, updates);
    if (updates.length) {
      activityNote_({ action: 'update', type: 'participant', id: 'bulk-' + compRandomHex_(4), title: '', changes: { bulk: updates.length, field: field } });
    }
    return { count: updates.length, log: field + ' ' + updates.length };
  });

}


/* =========================================================
   ADMIN: BULK IMPORT (§7.5; same flow as Import.gs)
========================================================= */

function regImportExisting_() {

  return regRows_().map(function (r) {
    return { id: r.id, name: r.name, nameNorm: r.nameNorm || normName_(r.name), phone: r.phone, phoneNorm: r.phoneNorm, group: r.group, church: r.church, servant: r.servant, notes: r.notes, birthDate: r.birthDate, updatedAt: r.updatedAt, status: r.status === 'inactive' ? 'inactive' : 'active', __row: r.__row, codeHash: r.codeHash };
  });

}

/**
 * Read-only: what importing this text would do.
 * → { rows: [ImportRow], summary, groups: [{ name, count, isNew }], problems, columns, ignored, codeIgnored, fingerprint,
 *     hiddenSame (a long file: the unchanged rows are only counted), max }
 */
function apiParticipantsImportPreview(text) {

  assertAdmin_();

  var plan = planParticipantImport_(text, regImportExisting_(), sha256Hex_);
  // a re-imported export: the rows that change nothing are counted, not sent
  var long = plan.rows.length > 200;
  var same = function (r) { return r.status === 'exists' && !r.changes.length && !r.warnings.length; };
  var shown = long ? plan.rows.filter(function (r) { return !same(r); }) : plan.rows;

  return {
    rows: shown.map(regImportRowOut_),
    hiddenSame: plan.rows.length - shown.length,
    codeIgnored: !!plan.codeIgnored,
    summary: plan.summary,
    groups: plan.groups,
    problems: plan.problems,
    columns: plan.columns,
    ignored: plan.ignored,
    fingerprint: sha256Hex_(plan.rows.map(function (r) { return r.fp; }).join(',')).slice(0, 16),
    max: REG_IMPORT_MAX_ROWS
  };

}


/**
 * decisions: { 'r<line>': 'add:<fp>' | 'update:<pid>:<fp>' | 'phone:<pid>:<fp>' } — what the admin ticked.
 * Under the script lock the text is planned again against the registry as it is NOW; a row is applied
 * only when its fingerprint still matches. New participants get p- ids, codes and one importBatch;
 * existing ones keep id and code. One block for the new rows, one read + one write for the changed ones.
 * → { added, updated, phoneUpdated, skipped: { unticked, changed, error, exists, dup }, changed, batch,
 *     rows: [{ line, result: 'added' | 'updated' | 'phone' | 'skipped' | 'error', reason, id? }], total }
 */
function apiParticipantsImportApply(text, decisions) {

  assertAdmin_();
  regRequireOn_();

  decisions = decisions && typeof decisions === 'object' && !Array.isArray(decisions) ? decisions : {};

  return regWrite_('import', function (email) {

    var existing = regImportExisting_();
    var plan = planParticipantImport_(text, existing, sha256Hex_);
    var byId = Object.create(null);
    var report = { added: 0, updated: 0, phoneUpdated: 0, skipped: { unticked: 0, changed: 0, error: 0, exists: 0, dup: 0 }, changed: 0, batch: '', rows: [], total: plan.rows.length };
    var t = regSheet_();
    var stamp = compNow_().stamp;
    var batch = 'imp-' + compRandomHex_(4);
    var taken = regTakenHashes_(existing);
    var adds = [];
    var touched = Object.create(null);
    var updates = [];

    if (plan.problems.length && !plan.rows.length) {
      throw appError_(plan.problems[0], '');
    }

    existing.forEach(function (p) { byId[p.id] = p; });

    var skip = function (row, why, reason) {
      report.skipped[why]++;
      report.rows.push({ line: row.line, result: why === 'error' ? 'error' : 'skipped', reason: reason });
    };

    plan.rows.forEach(function (row) {

      var wanted = Object.prototype.hasOwnProperty.call(decisions, 'r' + row.line) ? String(decisions['r' + row.line]) : '';
      var parsed = /^(add|update|phone):(?:(p-[0-9a-f]{8}):)?([0-9a-f]{16})$/.exec(wanted);

      if (row.status === 'error') { skip(row, 'error', row.errors.join('، ')); return; }
      if (row.status === 'dup') { skip(row, 'dup', row.reason); return; }

      if (!wanted) {
        // an unchanged row of a re-imported export: counted only
        if (row.status === 'exists' && !row.changes.length) { report.skipped.exists++; return; }
        if (row.status === 'exists') skip(row, 'exists', row.reason);
        else skip(row, 'unticked', 'مش متعلّم عليه');
        return;
      }

      var allowed = row.choices.some(function (c) { return c.value === wanted; });

      if (!parsed || !allowed) {
        report.changed++;
        skip(row, 'changed', 'الصف اتغير من بعد المعاينة — اعمل معاينة تاني');
        return;
      }

      var kind = parsed[1];
      var pid = parsed[2] || '';

      if (kind === 'add') {
        var record = regNewRecord_(row, regIssueCode_(taken), email, stamp, batch);
        record.phone = row.phoneIntl;
        adds.push(record);
        report.rows.push({ line: row.line, result: 'added', reason: '', id: record.id });
        return;
      }

      var target = byId[pid];

      if (!target || touched[pid]) {
        report.changed++;
        skip(row, 'changed', 'المشترك ده اتغير من بعد المعاينة');
        return;
      }

      touched[pid] = true;

      if (kind === 'update') {
        var patch = { updatedAt: stamp };
        row.changes.forEach(function (c) {
          if (c.field === 'name') { patch.name = row.name; patch.nameNorm = row.nameNorm; }
          else if (c.field === 'phone') { patch.phone = row.phoneIntl; patch.phoneNorm = row.phoneNorm; }
          else patch[c.field] = c.to;
        });
        updates.push({ row: target.__row, record: patch });
        report.updated++;
        report.rows.push({ line: row.line, result: 'updated', reason: row.changes.map(function (c) { return c.label; }).join('، '), id: pid });
        return;
      }

      // the same person with a new phone: id and code stay
      var phonePatch = { phone: row.phoneIntl, phoneNorm: row.phoneNorm, updatedAt: stamp };
      ['group', 'church', 'servant', 'notes', 'birthDate'].forEach(function (field) { if (row[field]) phonePatch[field] = row[field]; });
      updates.push({ row: target.__row, record: phonePatch });
      report.phoneUpdated++;
      report.rows.push({ line: row.line, result: 'phone', reason: 'اتغير الرقم', id: pid });

    });

    compUpdateMany_(t, updates);
    compAppend_(t, adds);

    report.added = adds.length;
    report.batch = adds.length ? batch : '';

    if (adds.length || report.updated || report.phoneUpdated) {
      regDropHashes_();
      // counts only: never a code or a phone
      activityNote_({ action: 'import', type: 'participant', id: report.batch || 'update', title: '', changes: { added: report.added, updated: report.updated, phone: report.phoneUpdated } });
    }

    report.log = 'added ' + report.added + ', updated ' + report.updated + ', phone ' + report.phoneUpdated + (report.batch ? ' ' + report.batch : '');

    return report;

  });

}


/**
 * Takes an import back: deletes the participants that batch ADDED, only when none of them has a
 * submission or a ledger row (rows the import only updated stay as they are). → { removed, batch }
 */
function apiParticipantsUndoImport(batch) {

  assertAdmin_();
  regRequireOn_();

  if (typeof batch !== 'string' || !REG_BATCH.test(batch)) throw new Error('رقم الاستيراد مش صحيح');

  return regWrite_('import.undo', function () {

    var t = regSheet_();
    var mine = compRows_(t).filter(function (r) { return r.importBatch === batch; });

    if (!mine.length) throw new Error('الاستيراد ده مش موجود أو اتلغى قبل كده');

    var ids = Object.create(null);

    mine.forEach(function (r) { ids[r.id] = true; });

    var live = compLock_(20000);

    if (!live) throw appError_('فيه ضغط على المسابقات دلوقتي.', 'استنى ثواني وجرّب تاني.');

    try {

      var used = compColumns_(compSheet_('Submissions'), ['participantId']).some(function (r) { return ids[r.participantId]; });
      var ledger = compSpreadsheet_(false).getSheetByName('PointsLedger') ? compColumns_(compSheet_('PointsLedger'), ['participantId']).some(function (r) { return ids[r.participantId]; }) : false;

      if (used || ledger) {
        throw appError_('مينفعش نلغي الاستيراد ده: فيه مشتركين منه شاركوا في مسابقات أو ليهم نقاط.', 'وقّف اللي مش عايزهم بدل ما تمسحهم (إيقاف المشترك).');
      }

      compDeleteRows_(t, mine.map(function (r) { return r.__row; }));

    }
    finally {
      live.releaseLock();
    }

    regDropHashes_();
    activityNote_({ action: 'delete', type: 'participant', id: batch, title: '', changes: { undoImport: mine.length } });

    return { removed: mine.length, batch: batch, log: batch + ' ' + mine.length };

  });

}


/* =========================================================
   PUBLIC: compCode AND THE PARTICIPANT TOKEN (§7.4)
========================================================= */

/* a participant row by id (one column read + one row), or null */
function regRowById_(id) {

  if (typeof id !== 'string' || !REG_ID.test(id) || !compSpreadsheet_(false)) return null;

  var ss = compSpreadsheet_(false);

  if (!ss.getSheetByName('Participants')) return null;

  var t = regSheet_();

  // the row read must be the one found (rows shift when an import is undone): look again once
  for (var attempt = 0; attempt < 2; attempt++) {
    var rowNumber = compFindRow_(t, 'id', id);
    var row = rowNumber ? compRowAt_(t, rowNumber) : null;
    if (!row) return null;
    if (row.id === id) return row;
  }

  return null;

}

/**
 * compCode { code } → { ok, participant: { name, group }, ptoken }. The failure budget comes first
 * (≤ 60 a minute: then `busy`; no daily cap), every wrong / unknown / inactive code is counted and
 * paused (~300 ms) and gets the same answer. The code itself is never logged or echoed.
 */
function compCodeAction_(arg) {

  arg = compArg_(arg);

  if (!arg || typeof arg.code !== 'string' || arg.code.length > 40) return compFail_('bad');

  if (!compCodeBudgetOk_()) return compFail_('busy');

  var wrong = function () {
    compCodeFailed_();
    return compFail_('code', 'الكود ده مش صحيح. اتأكد منه وجرّب تاني.');
  };

  var code = regNormalizeCode_(arg.code);
  var ss = compSpreadsheet_(false);

  if (!code || !ss || !ss.getSheetByName('Participants')) return wrong();

  var hash = regHash_(code);
  var found = regHashMap_(false);
  var id = found.map[hash];

  // a cached map can be older than a new code: check the tab itself before saying no
  if (!id && found.cached) id = regHashMap_(true).map[hash];

  var row = id ? regRowById_(id) : null;

  if (!row || row.status === 'inactive' || !compSafeEqual_(row.codeHash, hash)) return wrong();

  var reply = {
    ok: true,
    participant: { name: row.name, group: row.group || '' },
    ptoken: compSignToken_('pt1', { p: row.id, cv: Number(row.codeVersion) || 1, e: Date.now() + REG_PTOKEN_HOURS * 3600000 })
  };

  // outside the points age range: the code is fine and stays theirs (§19.3)
  if (regEligibilityOf_(row).state === 'out') {
    reply.eligible = false;
    reply.notice = REG_AGE_NOTICE;
  }

  return reply;

}

/**
 * The participant a pt1 token stands for → { id, name, group, phone } or null (bad, expired,
 * unknown, inactive, or the code was reset since: codeVersion changed).
 */
function compParticipantFromToken_(ptoken) {

  var read = compReadToken_('pt1', ptoken);

  if (!read.ok || typeof read.payload.p !== 'string' || !REG_ID.test(read.payload.p)) return null;

  var row = regRowById_(read.payload.p);

  if (!row || row.status === 'inactive' || String(Number(row.codeVersion) || 1) !== String(read.payload.cv)) return null;

  return { id: row.id, name: row.name, group: row.group || '', phone: row.phone || '', birthDate: row.birthDate || '' };

}


/* =========================================================
   PUBLIC: «نقاطي» (portalMe, portalReview)
========================================================= */

/* the participant's submissions as the portal lists them (newest first; the result policy of NOW) */
function regPortalHistory_(pid, now) {

  if (!compSpreadsheet_(false) || !compSpreadsheet_(false).getSheetByName('Submissions')) return [];

  var t = compSheet_('Submissions');
  var mine = compColumns_(t, ['participantId', 'startedMs']).filter(function (r) { return r.participantId === pid; })
    .sort(function (a, b) { return (Number(b.startedMs) || 0) - (Number(a.startedMs) || 0); })
    .slice(0, 300);
  var defs = Object.create(null);
  var def = function (compId, version) {
    var key = compId + ':' + version;
    if (defs[key] === undefined) defs[key] = compDefinitionFor_(compId, version) || null;
    return defs[key];
  };

  return mine.map(function (m) {

    var row = compRowAt_(t, m.__row);
    var served = row ? def(row.compId, row.version) : null;

    if (!served) return null;

    var live = compLiveFor_(served);
    var shown = live && live.version !== row.version ? def(row.compId, live.version) || served : served;
    var result = compResult_(served, row, live, now);
    var item = {
      submissionId: row.id,
      compId: row.compId,
      title: shown.title,
      slug: shown.slug,
      submittedAt: result.submittedAt,
      status: result.status,
      canReview: !!result.review
    };

    ['score', 'maxScore', 'pointsAwarded', 'pending'].forEach(function (key) {
      if (result[key] !== undefined) item[key] = result[key];
    });

    return item;

  }).filter(Boolean);

}

/**
 * portalMe { ptoken } → { ok, participant: { name, group }, features: { wallet, shop }, history,
 * balance?, ledger? (wallet on), redemptions?, shop? (store on) }   — docs §5.1.
 */
function portalMeAction_(arg) {

  arg = compArg_(arg);

  if (!arg) return compFail_('bad');

  var participant = compParticipantFromToken_(arg.ptoken);

  if (!participant) return compFail_('session');

  var modules = compModules_();
  var reply = {
    ok: true,
    participant: { name: participant.name, group: participant.group },
    features: { wallet: !!modules.wallet, shop: !!modules.shop },
    history: regPortalHistory_(participant.id, compNow_())
  };

  if (regEligibilityOf_(participant).state === 'out') {
    reply.eligible = false;
    reply.notice = REG_AGE_NOTICE;
  }

  if (modules.wallet && typeof walletPortal_ === 'function') {
    var wallet = walletPortal_(participant.id);
    reply.balance = wallet.balance;
    reply.ledger = wallet.ledger;
    if (typeof seasonPortal_ === 'function') {
      var seasons = seasonPortal_(participant.id);
      reply.season = seasons.season;
      reply.seasons = seasons.seasons;
    }
  }

  if (modules.shop && typeof shopPortal_ === 'function') {
    var shop = shopPortal_(participant.id);
    reply.redemptions = shop.redemptions;
    reply.shop = shop.shop;
    reply.store = shopStoreState_();
  }

  return reply;

}

/** portalReview { ptoken, submissionId } → { ok, result } (the review only when the competition allows it now) */
function portalReviewAction_(arg) {

  arg = compArg_(arg);

  if (!arg) return compFail_('bad');

  var participant = compParticipantFromToken_(arg.ptoken);

  if (!participant) return compFail_('session');

  if (typeof arg.submissionId !== 'string' || !COMP_SUBMISSION_ID.test(arg.submissionId)) return compFail_('bad');

  var t = compSheet_('Submissions');
  var rowNumber = compFindRow_(t, 'id', arg.submissionId);
  var row = rowNumber ? compRowAt_(t, rowNumber) : null;

  if (!row || row.participantId !== participant.id) return compFail_('not_found', 'المشاركة دي مش موجودة.');

  var def = compDefinitionFor_(row.compId, row.version);

  if (!def) return compFail_('not_found', 'المشاركة دي مش موجودة.');

  return { ok: true, result: compResult_(def, row, compLiveFor_(def), compNow_()) };

}


/* =========================================================
   BIRTH DATE AND AGE ELIGIBILITY (docs/COMPETITIONS.md §19.3)
========================================================= */

var REG_AGE_NOTICE = 'نأسف، سنك حاليًا خارج الفئة العمرية المخصصة لنظام نقاط الاجتماع. تقدر تشارك في المسابقة بدون نقاط.';
var REG_AGE_DEFAULTS = { min: 18, max: 30, warnDays: 60 };

/* this execution's rules (read once) */
var REG_AGE_RULES_ = null;

/*
 * PURE. A birth date as typed (YYYY-MM-DD, DD/MM/YYYY, D-M-YYYY, Arabic digits) or
 * { day, month, year } → { date: 'YYYY-MM-DD' | '' } | { problem }. today: 'YYYY-MM-DD'.
 */
function regBirthDate_(value, today) {

  var y, m, d;

  if (value && typeof value === 'object') {
    y = Number(contentDigits_(String(value.year || '')));
    m = Number(contentDigits_(String(value.month || '')));
    d = Number(contentDigits_(String(value.day || '')));
    if (!y && !m && !d) return { date: '' };
  }
  else {
    var text = contentDigits_(String(value || '')).trim();
    if (!text) return { date: '' };
    var iso = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(text);
    var dmy = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(text);
    if (iso) { y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]); }
    else if (dmy) { d = Number(dmy[1]); m = Number(dmy[2]); y = Number(dmy[3]); }
    else return { problem: 'تاريخ الميلاد مش مفهوم (اكتبه يوم/شهر/سنة)' };
  }

  var probe = new Date(Date.UTC(y, m - 1, d));

  if (!y || !m || !d || probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return { problem: 'تاريخ الميلاد مش تاريخ حقيقي' };
  }

  var date = y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;

  if (today && date > today) return { problem: 'تاريخ الميلاد في المستقبل' };

  var age = regAgeOn_(date, today);

  if (today && (age < 5 || age > 100)) return { problem: 'تاريخ الميلاد مش منطقي (السن ' + regAr_(age) + ')' };

  return { date: date };

}

/* PURE: completed years on 'YYYY-MM-DD' */
function regAgeOn_(birth, today) {

  var b = birth.split('-').map(Number);
  var t = today.split('-').map(Number);

  return t[0] - b[0] - (t[1] < b[1] || (t[1] === b[1] && t[2] < b[2]) ? 1 : 0);

}

/* PURE: 'YYYY-MM-DD' of the birthday at that age (29 Feb → 1 Mar in other years) */
function regBirthdayAt_(birth, age) {

  var b = birth.split('-').map(Number);
  var date = new Date(Date.UTC(b[0] + age, b[1] - 1, b[2]));

  return date.toISOString().slice(0, 10);

}

/*
 * PURE. { age, state: ok | soon | out | unknown, leavesAt } for a birth date under the rules
 * { min, max, warnDays } on 'YYYY-MM-DD' today. ok = min ≤ age ≤ max; soon = ok and the
 * (max+1)th birthday is within warnDays; no birth date = unknown (treated as eligible).
 */
function regEligibility_(birthDate, rules, today) {

  if (!birthDate) return { age: null, state: 'unknown', leavesAt: '' };

  var age = regAgeOn_(birthDate, today);
  var leavesAt = regBirthdayAt_(birthDate, rules.max + 1);

  if (age < rules.min || age > rules.max) return { age: age, state: 'out', leavesAt: leavesAt };

  var days = Math.round((Date.UTC.apply(null, leavesAt.split('-').map(function (v, i) { return i === 1 ? Number(v) - 1 : Number(v); })) -
    Date.UTC.apply(null, today.split('-').map(function (v, i) { return i === 1 ? Number(v) - 1 : Number(v); }))) / 86400000);

  return { age: age, state: days <= rules.warnDays ? 'soon' : 'ok', leavesAt: leavesAt };

}

/* the rules now (Script Properties; defaults 18 / 30 / 60 days) */
function regAgeRules_() {

  if (REG_AGE_RULES_) return REG_AGE_RULES_;

  var props = PropertiesService.getScriptProperties();
  var read = function (key, fallback) {
    var value = props.getProperty(key);
    return value === null || value === '' || !isFinite(Number(value)) ? fallback : Number(value);
  };

  REG_AGE_RULES_ = { min: read('AGE_MIN', REG_AGE_DEFAULTS.min), max: read('AGE_MAX', REG_AGE_DEFAULTS.max), warnDays: read('AGE_WARN_DAYS', REG_AGE_DEFAULTS.warnDays) };

  return REG_AGE_RULES_;

}

/* a participant row's eligibility today */
function regEligibilityOf_(row) {

  return regEligibility_(row && row.birthDate ? String(row.birthDate) : '', regAgeRules_(), compNow_().wall.slice(0, 10));

}

function apiAgeRules() {

  assertAdmin_();

  return regAgeRules_();

}

/* { min, max, warnDays }: 0 ≤ min < max ≤ 100, 0 ≤ warnDays ≤ 365. Codes, history and points never change. */
function apiAgeRulesSave(input) {

  assertAdmin_();

  input = input || {};

  var min = compInt_(input.min, 0, 99, NaN);
  var max = compInt_(input.max, 1, 100, NaN);
  var warn = compInt_(input.warnDays, 0, 365, NaN);

  if (isNaN(min)) throw appError_('أقل سن لازم يكون رقم من ٠ لـ ٩٩.', '', '', 'min');
  if (isNaN(max) || max <= min) throw appError_('أكبر سن لازم يكون أكبر من أقل سن (لحد ١٠٠).', '', '', 'max');
  if (isNaN(warn)) throw appError_('التنبيه قبل الخروج من السن بين ٠ و٣٦٥ يوم.', '', '', 'warnDays');

  var before = regAgeRules_();

  PropertiesService.getScriptProperties().setProperties({ AGE_MIN: String(min), AGE_MAX: String(max), AGE_WARN_DAYS: String(warn) });
  REG_AGE_RULES_ = null;

  activity_({ action: 'settings', type: 'participant', id: 'age', title: 'الفئة العمرية لنظام النقاط',
    changes: { min: min, max: max, warnDays: warn, was: before.min + '-' + before.max } });

  return regAgeRules_();

}
