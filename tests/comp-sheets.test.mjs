// The competitions spreadsheets the admin makes and reads (admin/comp-sheets.js):
// the question template (headers = what CompAdmin.gs reads, dropdowns, help and
// examples that import cleanly), an uploaded workbook → import text, and the
// results export (one row per participant, text columns, the file name).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readXlsx, writeXlsx, unzip } from '../admin/xlsx.js';
import { QUESTION_HEADERS, QUESTION_SHEET, TYPE_WORDS, questionTemplate, exampleRows, importText, resultsBook, resultsFilename } from '../admin/comp-sheets.js';
import { compWorld, adminApi, plain } from './fakes/comp.mjs';

test('template headers are exactly the ones the server import reads (contract §16.2)', () => {
  assert.deepEqual(QUESTION_HEADERS, ['ترتيب', 'السؤال', 'النوع', 'اختيار 1', 'اختيار 2', 'اختيار 3', 'اختيار 4', 'اختيار 5', 'اختيار 6', 'اختيار 7', 'اختيار 8',
    'الإجابة الصحيحة', 'الدرجة', 'إجباري', 'التوضيح', 'صورة', 'مراجعة']);
  const gs = readFileSync(new URL('../apps-script/CompAdmin.gs', import.meta.url), 'utf8');
  // every type word in the dropdown is one CompAdmin.gs COMP_IMPORT_TYPES knows
  for (const word of TYPE_WORDS) assert.ok(gs.includes(`'${word}'`), word);
});

test('the template workbook: «الأسئلة» (headers, RTL, frozen, text columns, dropdowns), «شرح», «مثال»', async () => {
  const bytes = writeXlsx(questionTemplate());
  const book = await readXlsx(bytes);
  assert.deepEqual(book.sheets.map(s => s.name), [QUESTION_SHEET, 'شرح', 'مثال']);
  assert.deepEqual(book.sheets[0].rows, [QUESTION_HEADERS]);
  assert.ok(book.sheets[1].rows.length >= 12, 'a line per column');
  assert.equal(book.sheets[2].rows.length, 1 + 7, 'one example per type');
  const sheet = new TextDecoder().decode((await unzip(bytes))['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /rightToLeft="1"/);
  assert.match(sheet, /state="frozen"/);
  assert.equal((sheet.match(/<dataValidation /g) || []).length, 3, 'type, required, review');
  assert.match(sheet, /sqref="C2:C1000"><formula1>&quot;اختيار واحد,/);
  assert.match(sheet, /<col min="2" max="2" width="46"[^>]*style="2"/, 'the question column is wide text');
});

test('the examples import with no error on the real server code, one of each type', () => {
  const world = compWorld();
  const call = adminApi(world);
  const id = call('apiCompCreate', { preset: 'scored', title: 'نموذج', slug: 'sample' }).comp.id;
  const text = [QUESTION_HEADERS].concat(exampleRows()).map(r => r.join('\t')).join('\n');
  const preview = plain(call('apiCompImportPreview', id, text));
  assert.deepEqual(preview.rows.map(r => r.errors), preview.rows.map(() => []));
  assert.deepEqual(preview.rows.map(r => r.question.type), ['single', 'multi', 'truefalse', 'short', 'long', 'number', 'info']);
  assert.equal(preview.rows[3].question.review, 'fallback');
  assert.deepEqual(preview.rows[1].question.correct, ['متى', 'مرقس', 'يوحنا']);
});

test('importText: the named sheet first, tabs/newlines flattened, trailing blank rows dropped', async () => {
  const book = await readXlsx(writeXlsx({ sheets: [
    { name: 'ملاحظات', rows: [['اقرا الشرح']] },
    { name: QUESTION_SHEET, rows: [QUESTION_HEADERS, ['1', 'سؤال\nبسطرين', 'صح وغلط', '', '', '', '', '', '', '', '', 'صح'], ['', '', '']] }
  ] }));
  const text = importText(book);
  const lines = text.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], QUESTION_HEADERS.join('\t'));
  assert.equal(lines[1].split('\t')[1], 'سؤال بسطرين');
});

test('results: one row per participant, the header kept, ids / names / phones / answers as text, sized columns, a dated file name', async () => {
  const exported = {
    filename: 'bible-quiz-results.xlsx',
    header: ['المشاركة', 'الاسم', 'الموبايل', 'الحالة', 'الدرجة', 'س١: مين بنى الفلك؟', 'س١: مين بنى الفلك؟ (صح؟)', 'س١: مين بنى الفلك؟ (الدرجة)'],
    rows: [['s-000000000001', 'مارك', '+201011111111', 'اتصححت', 10, 'نوح', '✓', 10], ['s-000000000002', 'مريم', '+201022222222', 'اتصححت', 0, 'موسى', '✕', 0]]
  };
  const made = resultsBook(exported, 'bible-quiz', '2026-10-11 20:15');
  assert.equal(made.filename, 'bible-quiz-results-2026-10-11.xlsx');
  const sheet = made.book.sheets[0];
  assert.equal(sheet.rtl, true);
  assert.deepEqual(sheet.textColumns, [0, 1, 2, 5]);
  assert.equal(sheet.widths.length, exported.header.length);
  const book = await readXlsx(writeXlsx(made.book));
  assert.deepEqual(book.sheets[0].rows[0], exported.header);
  assert.equal(book.sheets[0].rows.length, 3);
  assert.deepEqual(book.sheets[0].rows[1], ['s-000000000001', 'مارك', '+201011111111', 'اتصححت', '10', 'نوح', '✓', '10']);
});

test('the export from the real server has a mark column per question and parses back', async () => {
  const world = compWorld();
  const call = adminApi(world);
  const id = call('apiCompCreate', { preset: 'scored', title: 'تجربة', slug: 'export-test', enabled: true }).comp.id;
  call('apiCompQuestionSave', id, { type: 'truefalse', text: 'داود غلب جليات', correct: 'صح', points: 5 });
  const review = call('apiReview');
  call('apiPublish', review.revision);
  const start = world.post({ fn: 'compStart', args: [{ slug: 'export-test', clientKey: 'export-key-000000001', fields: { name: 'مارك', phone: '01011111111' } }] });
  world.post({ fn: 'compSubmit', args: [{ token: start.attempt.token, clientKey: 'export-key-000000001', answers: { [start.questions[0].id]: 't' } }] });
  const exported = plain(call('apiCompExport', id));
  assert.ok(exported.header.includes('س١: داود غلب جليات (صح؟)'));
  const made = resultsBook(exported, 'export-test', '2026-10-11');
  const rows = (await readXlsx(writeXlsx(made.book))).sheets[0].rows;
  assert.equal(rows.length, 2);
  const at = rows[0].indexOf('س١: داود غلب جليات (صح؟)');
  assert.equal(rows[1][at], '✓');
  assert.equal(rows[1][at - 1], 'صح');
});

test('resultsFilename is safe whatever the slug / date', () => {
  assert.equal(resultsFilename('Bible Quiz!', ''), 'bible-quiz-results.xlsx');
  assert.equal(resultsFilename('', '2026-01-02T10:00'), 'competition-results-2026-01-02.xlsx');
});


/* ---------------- Phase 2 / 3: names, codes, phones, messages ---------------- */
