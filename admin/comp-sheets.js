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
