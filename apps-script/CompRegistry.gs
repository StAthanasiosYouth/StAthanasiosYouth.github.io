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
var REG_IMPORT_MAX_ROWS = 500;
var REG_IMPORT_MAX_TEXT = 300 * 1024;
var REG_LIMITS = { name: 80, nameMin: 3, group: 40, church: 60, notes: 300, search: 60, page: 50, pageMax: 200, exportMax: 3000 };
var REG_FIELD_LABELS = { name: 'الاسم', phone: 'رقم الموبايل', group: 'المجموعة', church: 'الكنيسة', notes: 'ملاحظات' };

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

  var out = { name: '', nameNorm: '', phone: '', phoneNorm: '', local: '', group: '', church: '', notes: '', errors: [], oneWord: false };
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

  ['group', 'church', 'notes'].forEach(function (key) {
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
  { key: 'name', names: ['الاسم بالكامل', 'الاسم الكامل', 'الاسم', 'اسم', 'اسم المشترك', 'name', 'full name', 'fullname'] },
  { key: 'phone', names: ['رقم الموبايل', 'الموبايل', 'موبايل', 'التليفون', 'تليفون', 'رقم التليفون', 'الرقم', 'phone', 'mobile', 'phone number'] },
  { key: 'group', names: ['المجموعة / الفصل', 'المجموعة/الفصل', 'المجموعة', 'مجموعة', 'الفصل', 'فصل', 'group', 'class'] },
  { key: 'church', names: ['الكنيسة', 'كنيسة', 'church'] },
  { key: 'notes', names: ['ملاحظات', 'ملاحظة', 'notes', 'note'] }
];

var REG_IMPORT_ORDER = ['name', 'phone', 'group', 'church', 'notes'];

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

  return p ? [p.id, p.nameNorm, p.phoneNorm, p.group || '', p.church || '', p.notes || '', p.status || ''] : null;

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
    out.problems.push('الملف كبير قوي (الحد ٣٠٠ كيلوبايت). قسّمه لأكتر من مرة.');
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

  out.columns = columns.filter(Boolean);

  if (body.length > REG_IMPORT_MAX_ROWS) {
    out.problems.push('الملف فيه ' + regAr_(body.length) + ' صف، والحد ' + regAr_(REG_IMPORT_MAX_ROWS) + ' في المرة. قسّمه.');
    body = body.slice(0, REG_IMPORT_MAX_ROWS);
  }

  /* the registry, indexed */
  var byKey = Object.create(null);
  var byName = Object.create(null);
  var byPhone = Object.create(null);
  var knownGroups = Object.create(null);

  (existing || []).forEach(function (p) {
    var nameNorm = p.nameNorm || normName_(p.name);
    var record = { id: p.id, name: p.name, nameNorm: nameNorm, phoneNorm: p.phoneNorm, group: p.group || '', church: p.church || '', notes: p.notes || '', status: p.status || 'active' };
    byKey[nameNorm + '|' + p.phoneNorm] = byKey[nameNorm + '|' + p.phoneNorm] || record;
    (byName[nameNorm] = byName[nameNorm] || []).push(record);
    (byPhone[p.phoneNorm] = byPhone[p.phoneNorm] || []).push(record);
    if (record.group) knownGroups[normName_(record.group)] = true;
  });

  /* every row checked on its own */
  var given = { group: columns.indexOf('group') !== -1, church: columns.indexOf('church') !== -1, notes: columns.indexOf('notes') !== -1 };

  var rows = body.map(function (entry) {
    var raw = {};
    columns.forEach(function (key, i) { if (key) raw[key] = entry.cells[i] === undefined ? '' : String(entry.cells[i]); });
    var checked = regCheckPerson_(raw);
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
      notes: checked.notes,
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
      ['group', 'church', 'notes'].forEach(function (field) {
        if (!given[field] || row[field] === '' || row[field] === match[field]) return;
        row.changes.push({ field: field, label: REG_FIELD_LABELS[field], from: match[field], to: row[field] });
      });
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

    row.fp = hash(JSON.stringify([
      row.status, row.nameNorm, row.phoneNorm, row.name, row.group, row.church, row.notes,
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
    // new rows are ticked; updates and the same-name ones wait for the admin
    row.ticked = row.status === 'new' && !row.warnings.some(function (w) { return w.kind === 'sameName'; });

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

  var s = { total: rows.length, new: 0, exists: 0, update: 0, dup: 0, error: 0, ticked: 0, warnings: { sharedPhone: 0, sameName: 0, oneWord: 0 } };

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
    notes: row.notes,
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

  return {
    id: row.id,
    name: row.name,
    phone: row.phoneNorm ? '0' + row.phoneNorm : '',
    phoneIntl: row.phone || '',
    group: row.group || '',
    church: row.church || '',
    notes: row.notes || '',
    status: row.status === 'inactive' ? 'inactive' : 'active',
    active: row.status !== 'inactive',
    codeVersion: Number(row.codeVersion) || 1,
    codeIssuedAt: row.codeIssuedAt || '',
    hasCode: !!row.codeHash,
    importBatch: row.importBatch || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || ''
  };

}

/* a participant's draft change under the script lock; Activity written after it succeeded */
function regWrite_(label, change) {

  var email = currentEmail_();
  var lock = LockService.getScriptLock();
  var result;

  lock.waitLock(30000);

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
    notes: checked.notes,
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
  var limit = Math.max(1, Math.min(REG_LIMITS.pageMax, Math.floor(Number(query.limit)) || REG_LIMITS.page));
  var offset = Math.max(0, Math.floor(Number(query.offset)) || 0);
  var result = { ready: false, items: [], total: 0, offset: offset, limit: limit, counts: { all: 0, active: 0, inactive: 0 }, groups: [], batches: [], modules: modules };

  if (!compSpreadsheet_(false)) return result;

  var rows = regRows_();
  var search = typeof query.q === 'string' ? query.q.slice(0, REG_LIMITS.search) : '';
  var nameKey = normName_(search);
  var phoneKey = regPhoneSearch_(search);
  var group = typeof query.group === 'string' ? normName_(query.group) : '';
  var status = query.status === 'active' || query.status === 'inactive' ? query.status : 'all';
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
      notes: input.notes !== undefined ? input.notes : current && current.notes
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
      notes: checked.notes,
      updatedAt: stamp
    };

    compUpdate_(t, current.__row, record, current);

    if (current.phoneNorm !== checked.phoneNorm) {
      activityNote_({ action: 'participant.phone', type: 'participant', id: id, title: checked.name });
    }

    var before = { name: current.name, group: current.group, church: current.church, notes: current.notes };
    var after = { name: checked.name, group: checked.group, church: checked.church, notes: checked.notes };
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
    picked = rows.filter(function (r) { return sel.ids.indexOf(r.id) !== -1; });
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
    return { id: r.id, name: r.name, phone: r.phoneNorm ? '0' + r.phoneNorm : '', group: r.group || '', code: regCodeOf_(r) };
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


/* =========================================================
   ADMIN: BULK IMPORT (§7.5; same flow as Import.gs)
========================================================= */

function regImportExisting_() {

  return regRows_().map(function (r) {
    return { id: r.id, name: r.name, nameNorm: r.nameNorm || normName_(r.name), phone: r.phone, phoneNorm: r.phoneNorm, group: r.group, church: r.church, notes: r.notes, status: r.status === 'inactive' ? 'inactive' : 'active', __row: r.__row, codeHash: r.codeHash };
  });

}

/**
 * Read-only: what importing this text would do.
 * → { rows: [ImportRow], summary, groups: [{ name, count, isNew }], problems, columns, ignored, fingerprint, max: 500 }
 */
function apiParticipantsImportPreview(text) {

  assertAdmin_();

  var plan = planParticipantImport_(text, regImportExisting_(), sha256Hex_);

  return {
    rows: plan.rows.map(regImportRowOut_),
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
 * existing ones keep id and code. One block for the new rows, one write per changed row.
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
        row.changes.forEach(function (c) { patch[c.field] = c.to; });
        compUpdate_(t, target.__row, patch, null);
        report.updated++;
        report.rows.push({ line: row.line, result: 'updated', reason: row.changes.map(function (c) { return c.label; }).join('، '), id: pid });
        return;
      }

      // the same person with a new phone: id and code stay
      var phonePatch = { phone: row.phoneIntl, phoneNorm: row.phoneNorm, updatedAt: stamp };
      ['group', 'church', 'notes'].forEach(function (field) { if (row[field]) phonePatch[field] = row[field]; });
      compUpdate_(t, target.__row, phonePatch, null);
      report.phoneUpdated++;
      report.rows.push({ line: row.line, result: 'phone', reason: 'اتغير الرقم', id: pid });

    });

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
  var rowNumber = compFindRow_(t, 'id', id);

  return rowNumber ? compRowAt_(t, rowNumber) : null;

}

/**
 * compCode { code } → { ok, participant: { name, group }, ptoken }. The failure budget comes first
 * (≤ 30 / minute, ≤ 1,000 / day: then `busy`), every wrong / unknown / inactive code is counted and
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

  return {
    ok: true,
    participant: { name: row.name, group: row.group || '' },
    ptoken: compSignToken_('pt1', { p: row.id, cv: Number(row.codeVersion) || 1, e: Date.now() + REG_PTOKEN_HOURS * 3600000 })
  };

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

  return { id: row.id, name: row.name, group: row.group || '', phone: row.phone || '' };

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

  if (modules.wallet && typeof walletPortal_ === 'function') {
    var wallet = walletPortal_(participant.id);
    reply.balance = wallet.balance;
    reply.ledger = wallet.ledger;
  }

  if (modules.shop && typeof shopPortal_ === 'function') {
    var shop = shopPortal_(participant.id);
    reply.redemptions = shop.redemptions;
    reply.shop = shop.shop;
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
