/*
 * COMPETITIONS: the spreadsheets the admin hands out and takes in
 * (docs/COMPETITIONS.md §16.2). Pure: builds the `book` objects that
 * admin/xlsx.js writeXlsx() turns into a file, and reads uploaded books back
 * into the text the server's import parser takes (apiCompImportPreview).
 *
 *   questionTemplate()            → book: «الأسئلة» (headers + dropdowns), «شرح», «مثال»
 *   importText(book)              → tab-separated text of the questions sheet
 *   resultsBook(exported, slug, date) → { book, filename } from apiCompExport's reply
 *
 * Loaded on demand by the admin (AdminCompQuestions / AdminCompResults) with
 * import('./comp-sheets.js'); tested in Node (tests/comp-sheets.test.mjs).
 */

import { rowsToTsv, firstDataSheet } from './xlsx.js';

/* the exact headers CompAdmin.gs COMP_IMPORT_COLUMNS reads (Arabic first; English is accepted too) */
export const QUESTION_HEADERS = ['ترتيب', 'السؤال', 'النوع',
  'اختيار 1', 'اختيار 2', 'اختيار 3', 'اختيار 4', 'اختيار 5', 'اختيار 6', 'اختيار 7', 'اختيار 8',
  'الإجابة الصحيحة', 'الدرجة', 'إجباري', 'التوضيح', 'صورة', 'مراجعة'];

export const QUESTION_SHEET = 'الأسئلة';

/* the type words, as CompAdmin.gs COMP_IMPORT_TYPES knows them (first word of each) */
export const TYPE_WORDS = ['اختيار واحد', 'اختيارات متعددة', 'صح وغلط', 'إجابة قصيرة', 'إجابة مفتوحة', 'رقم', 'فقرة'];
export const REQUIRED_WORDS = ['نعم', 'لا'];
export const REVIEW_WORDS = ['تلقائي', 'يدوي', 'مراجعة لو مش مطابق'];

const col = name => QUESTION_HEADERS.indexOf(name);

/* one row in header order from { header: value } */
function row(values) {
  return QUESTION_HEADERS.map(name => (values[name] === undefined ? '' : values[name]));
}

/** one example of every type (the «مثال» sheet) */
export function exampleRows() {
  return [
    row({ 'ترتيب': '1', 'السؤال': 'مين بنى الفلك؟', 'النوع': 'اختيار واحد', 'اختيار 1': 'نوح', 'اختيار 2': 'موسى', 'اختيار 3': 'إبراهيم', 'الإجابة الصحيحة': '1', 'الدرجة': '10', 'إجباري': 'نعم', 'التوضيح': 'تكوين ٦: ربنا قال لنوح يبني الفلك.' }),
    row({ 'ترتيب': '2', 'السؤال': 'اختار الأناجيل من دول', 'النوع': 'اختيارات متعددة', 'اختيار 1': 'متى', 'اختيار 2': 'مرقس', 'اختيار 3': 'أعمال الرسل', 'اختيار 4': 'يوحنا', 'الإجابة الصحيحة': '1، 2، 4', 'الدرجة': '10', 'إجباري': 'نعم' }),
    row({ 'ترتيب': '3', 'السؤال': 'داود هو اللي غلب جليات', 'النوع': 'صح وغلط', 'الإجابة الصحيحة': 'صح', 'الدرجة': '5' }),
    row({ 'ترتيب': '4', 'السؤال': 'إيه اسم أول سفر في الكتاب المقدس؟', 'النوع': 'إجابة قصيرة', 'الإجابة الصحيحة': 'التكوين|سفر التكوين', 'الدرجة': '5', 'مراجعة': 'مراجعة لو مش مطابق' }),
    row({ 'ترتيب': '5', 'السؤال': 'اكتب في سطرين: إيه أكتر آية بتحبها وليه؟', 'النوع': 'إجابة مفتوحة', 'الدرجة': '10', 'إجباري': 'لا' }),
    row({ 'ترتيب': '6', 'السؤال': 'كام سفر في العهد الجديد؟', 'النوع': 'رقم', 'الإجابة الصحيحة': '27', 'الدرجة': '5' }),
    row({ 'ترتيب': '7', 'السؤال': 'الجزء التاني: أسئلة عن الأنبياء', 'النوع': 'فقرة' })
  ];
}

/** what each column means (the «شرح» sheet), in Egyptian Arabic */
export function explainRows() {
  return [
    ['العمود', 'تكتب فيه إيه', 'مثال'],
    ['ترتيب', 'رقم السؤال في المسابقة. سيبه فاضي والأسئلة هتتضاف بعد آخر سؤال بنفس ترتيب الملف.', '1'],
    ['السؤال', 'نص السؤال (لازم). للفقرة: الكلام اللي هيظهر بين الأسئلة.', 'مين بنى الفلك؟'],
    ['النوع', 'اختار من القايمة: ' + TYPE_WORDS.join('، ') + '. لو سبته فاضي وكتبت اختيارين أو أكتر هيبقى «اختيار واحد».', 'اختيار واحد'],
    ['اختيار 1 … اختيار 8', 'الاختيارات لأسئلة «اختيار واحد» و«اختيارات متعددة»: من ٢ لـ ٨. باقي الأنواع سيبهم فاضيين.', 'نوح'],
    ['الإجابة الصحيحة', 'اختيار: رقم الاختيار الصح (أو أكتر من رقم بينهم «،» للاختيارات المتعددة) أو نص الاختيار نفسه. صح وغلط: صح أو غلط. إجابة قصيرة: الإجابات المقبولة بينهم | . رقم: الرقم. إجابة مفتوحة وفقرة: سيبها فاضية.', '1'],
    ['الدرجة', 'درجة السؤال. فاضي = ١٠٠.', '10'],
    ['إجباري', 'نعم أو لا. فاضي = نعم.', 'نعم'],
    ['التوضيح', 'شرح الإجابة الصح، بيظهر للمشترك لما الإجابات تظهر (اختياري).', 'تكوين ٦'],
    ['صورة', 'كود صورة من مكتبة الصور (img-xxxxxxxx) أو سيبه فاضي. تقدر تضيف الصورة بعدين من لوحة التحكم.', ''],
    ['مراجعة', 'للإجابة القصيرة بس: تلقائي (فاضي)، يدوي (كل الإجابات تتراجع بإيدك)، أو «مراجعة لو مش مطابق» (اللي مش زي الإجابات المقبولة يستنى مراجعتك).', 'تلقائي'],
    [],
    ['ملاحظات', 'أول صف لازم يفضل العناوين زي ما هي. الاستيراد بيضيف أسئلة جديدة بس (مش بيعدّل الموجود). لحد ٣٠٠ سؤال في المرة.', ''],
    ['', 'قبل ما أي حاجة تتحفظ هتشوف كل صف: جديد، تحذير، أو فيه مشكلة وسببها — وتختار اللي يتضاف.', '']
  ];
}

const WIDTHS = [8, 46, 16, 18, 18, 18, 18, 14, 14, 14, 14, 22, 9, 9, 30, 15, 20];

/** the question template: «الأسئلة» (headers + dropdowns, text columns), «شرح», «مثال» */
export function questionTemplate() {
  // every column is text: "1، 2" must not turn into a number, nor 27 into 27.0
  const text = QUESTION_HEADERS.map((_, i) => i);
  return {
    sheets: [
      {
        name: QUESTION_SHEET,
        rtl: true,
        header: true,
        rows: [QUESTION_HEADERS.slice()],
        widths: WIDTHS,
        textColumns: text,
        lists: [
          { column: col('النوع'), values: TYPE_WORDS },
          { column: col('إجباري'), values: REQUIRED_WORDS },
          { column: col('مراجعة'), values: REVIEW_WORDS }
        ]
      },
      { name: 'شرح', rtl: true, header: true, rows: explainRows(), widths: [20, 90, 22], textColumns: [0, 1, 2] },
      { name: 'مثال', rtl: true, header: true, rows: [QUESTION_HEADERS.slice()].concat(exampleRows()), widths: WIDTHS, textColumns: text }
    ]
  };
}

/** an uploaded workbook → the questions sheet as the server's import text */
export function importText(book) {
  const sheet = firstDataSheet(book, QUESTION_SHEET);
  return sheet ? rowsToTsv(sheet.rows) : '';
}

/** "2026-10-11" → "bible-quiz-results-2026-10-11.xlsx" */
export function resultsFilename(slug, date) {
  const safe = String(slug || 'competition').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'competition';
  const day = /^\d{4}-\d{2}-\d{2}/.test(String(date || '')) ? String(date).slice(0, 10) : '';
  return safe + '-results' + (day ? '-' + day : '') + '.xlsx';
}

/**
 * apiCompExport's reply ({ header, rows }) → the results workbook: one row
 * per participant, RTL, frozen bold header, the phone and ids kept as text,
 * widths from the content.
 */
export function resultsBook(exported, slug, date) {
  const header = Array.isArray(exported && exported.header) ? exported.header.map(h => String(h)) : [];
  const rows = Array.isArray(exported && exported.rows) ? exported.rows : [];
  // ids, names, phones and the answers themselves stay text (a phone keeps its 0, «1، 2» stays as typed)
  const isText = h => /^(المشاركة|الاسم|الموبايل)$/.test(h) || (/^س[٠-٩0-9]+: /.test(h) && !/\)$/.test(h));
  const textColumns = header.map((h, i) => (isText(h) ? i : -1)).filter(i => i >= 0);
  const widths = header.map((h, i) => {
    const longest = rows.slice(0, 200).reduce((max, r) => Math.max(max, String(r[i] === undefined || r[i] === null ? '' : r[i]).length), h.length);
    return Math.max(8, Math.min(48, Math.round(longest * 1.1) + 2));
  });
  return {
    filename: resultsFilename(slug, date),
    book: {
      sheets: [{
        name: 'النتائج',
        rtl: true,
        header: true,
        rows: [header].concat(rows.map(r => header.map((_, i) => (r[i] === undefined || r[i] === null ? '' : r[i])))),
        widths,
        textColumns
      }]
    }
  };
}


/* =========================================================
   PHASE 2 / 3: participants (the names template, the import text after
   inline fixes, codes), WhatsApp messages, phone preview (docs/COMPETITIONS.md §7, §17.2)
========================================================= */

/* the headers CompRegistry.gs REG_IMPORT_COLUMNS reads first (aliases are accepted too) */
export const PEOPLE_HEADERS = ['الاسم بالكامل', 'رقم الموبايل', 'المجموعة / الفصل', 'الكنيسة', 'ملاحظات'];
export const PEOPLE_SHEET = 'الأسماء';
const PEOPLE_KEYS = ['name', 'phone', 'group', 'church', 'notes'];

/** the names template: «الأسماء» (headers, every column text so a phone keeps its 0), «شرح», «مثال» */
export function peopleTemplate() {
  const text = [0, 1, 2, 3, 4];
  const widths = [30, 18, 22, 24, 34];
  return {
    sheets: [
      { name: PEOPLE_SHEET, rtl: true, header: true, rows: [PEOPLE_HEADERS.slice()], widths, textColumns: text },
      {
        name: 'شرح', rtl: true, header: true, widths: [20, 90], textColumns: [0, 1],
        rows: [
          ['العمود', 'تكتب فيه إيه'],
          ['الاسم بالكامل', 'اسم المشترك بالكامل (لازم). الاسم والرقم مع بعض هما اللي بيعرّفوا الشخص.'],
          ['رقم الموبايل', 'موبايل مصري (لازم): 01xxxxxxxxx. لو إكسل شال الصفر مفيش مشكلة، وكمان +20 مقبولة. عمود الموبايل نص علشان الصفر ميضيعش.'],
          ['المجموعة / الفصل', 'اختياري: مثلاً «ثانوي بنين». اكتب الاسم بنفس الشكل في كل الصفوف.'],
          ['الكنيسة', 'اختياري.'],
          ['ملاحظات', 'اختياري: أي حاجة للخدام بس (مش بتظهر للمشترك).'],
          [],
          ['ملاحظات', 'أول صف لازم يفضل العناوين. لحد ٥٠٠ اسم في المرة. قبل أي حفظ هتشوف كل صف: جديد، موجود قبل كده، مكرر في الملف، رقم مشترك، أو فيه مشكلة وسببها.'],
          ['', 'الإخوات ممكن يبقوا على نفس رقم موبايل الأب أو الأم: ده مسموح (هيظهر «رقم مشترك» للتأكيد بس). كل واحد بياخد كود خاص بيه.']
        ]
      },
      {
        name: 'مثال', rtl: true, header: true, widths, textColumns: text,
        rows: [PEOPLE_HEADERS.slice(),
          ['مارك ميلاد عزيز', '01012345678', 'ثانوي بنين', 'مارجرجس', ''],
          ['مريم عادل فهمي', '01123456789', 'إعدادي بنات', 'العدرا', 'جديدة'],
          ['بيشوي عادل فهمي', '01123456789', 'ابتدائي', 'العدرا', 'أخو مريم: نفس رقم الأم']]
      }
    ]
  };
}

/**
 * The import rows as they would be typed (preview rows, with the admin's inline fixes) → tab-separated
 * text with a header of the given columns (name and phone always), so the server classifies them again.
 * rows: [{ name, phone, group, church, notes }]; columns: the keys the original file had.
 */
export function peopleText(rows, columns) {
  const keys = PEOPLE_KEYS.filter(k => k === 'name' || k === 'phone' || (columns || []).indexOf(k) !== -1);
  const clean = v => String(v === undefined || v === null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();
  return [keys.map(k => PEOPLE_HEADERS[PEOPLE_KEYS.indexOf(k)]).join('\t')]
    .concat((rows || []).map(r => keys.map(k => clean(r[k])).join('\t')))
    .join('\n');
}

/** apiParticipantCodes' reply → the names-and-codes workbook (phones and codes as text) */
export function codesBook(reply) {
  const rows = Array.isArray(reply && reply.rows) ? reply.rows : [];
  return {
    filename: (reply && reply.filename) || 'codes.xlsx',
    book: {
      sheets: [{
        name: 'الأكواد', rtl: true, header: true, widths: [30, 16, 22, 18], textColumns: [0, 1, 2, 3],
        rows: [['الاسم', 'الموبايل', 'المجموعة / الفصل', 'الكود']].concat(rows.map(r => [r.name || '', r.phone || '', r.group || '', r.code || '']))
      }]
    }
  };
}

const arDigits = v => String(v).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

/**
 * An Egyptian mobile as the server stores it (CompRegistry.gs normPhoneEg_, mirrored for a live preview):
 * → { local: '01…' | '', norm: '1…' | '', problem: '' | the server's reason }
 */
export function normPhoneEg(value) {
  const fail = problem => ({ local: '', norm: '', problem });
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[‎‏؜‪-‮⁦-⁩﻿]/g, '')
    .replace(/[\s \-‐-―.()/]/g, '');
  if (!text) return fail('رقم الموبايل ناقص');
  const plus = text.charAt(0) === '+';
  let digits = plus ? text.slice(1) : text;
  if (!/^\d+$/.test(digits)) return fail('رقم الموبايل فيه حروف أو رموز');
  const notEgyptian = 'الرقم مش رقم موبايل مصري';
  if (plus) {
    if (digits.indexOf('20') !== 0) return fail(notEgyptian);
    digits = digits.slice(2);
  }
  else if (digits.indexOf('0020') === 0) digits = digits.slice(4);
  else if (digits.indexOf('20') === 0 && digits.length >= 11) digits = digits.slice(2);
  if (digits.charAt(0) === '0') digits = digits.slice(1);
  if (digits.charAt(0) !== '1') return fail(notEgyptian);
  const count = digits.length + 1;
  if (digits.length < 10) {
    const missing = 10 - digits.length;
    return fail('رقم الموبايل ناقص ' + (missing === 1 ? 'رقم' : arDigits(missing) + ' أرقام') + ' (' + arDigits(count) + ' أرقام بدل ١١)');
  }
  if (digits.length > 10) {
    const extra = digits.length - 10;
    return fail('رقم الموبايل زيادة ' + (extra === 1 ? 'رقم' : arDigits(extra) + ' أرقام') + ' (' + arDigits(count) + ' رقم بدل ١١)');
  }
  if (!/^1[0125]\d{8}$/.test(digits)) return fail(notEgyptian);
  return { local: '0' + digits, norm: digits, problem: '' };
}

/** «ATH-••••-••••»: a code's shape without the code */
export const MASKED_CODE = 'ATH-••••-••••';

/** the message an admin pastes in WhatsApp (the code is in the message, never in a URL) */
export function codeMessage({ name, code, url }) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return [
    'أهلاً ' + first + ' 👋',
    'ده الكود بتاعك لمسابقات أسرة البابا أثناسيوس – سفاجا:',
    code,
    'ادخل بيه من هنا: ' + url,
    'الكود ده ليك إنت بس، متدّيهوش لحد. ربنا يباركك 🙏'
  ].join('\n');
}

/** wa.me for an Egyptian mobile — the chat only, NEVER with text (the code must not travel in a URL) */
export function waLink(phone) {
  const n = normPhoneEg(phone);
  return n.norm ? 'https://wa.me/20' + n.norm : '';
}

/* a group name without spaces, «ال» and the usual spelling differences (for "did you mean …") */
function groupKey(name) {
  return String(name || '').normalize('NFC')
    .replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/(^|\s)ال/g, '$1').replace(/[\s/\-_.،,]+/g, '').toLowerCase();
}

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * The file's groups that look like a typo of another group (the file's or the registry's):
 * groups [{ name, count, isNew }], known: [registry group names] → { '<name>': 'the likely one' }
 */
export function groupTypos(groups, known) {
  const list = groups || [];
  const all = list.map(g => g.name).concat(known || []);
  const out = {};
  list.forEach(g => {
    if (!g.isNew) return;
    const k = groupKey(g.name);
    const like = all.find(other => other !== g.name && (groupKey(other) === k || (k.length > 3 && distance(groupKey(other), k) <= 1)));
    if (!like) return;
    const other = list.find(x => x.name === like);
    // the one with more rows (or the registry's) is the likely spelling
    if (other && other.isNew && other.count < g.count) return;
    out[g.name] = like;
  });
  return out;
}
