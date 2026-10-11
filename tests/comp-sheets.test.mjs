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

test('names template: «الأسماء» with the exact headers (every column text: a phone keeps its 0), «شرح», «مثال» that the server imports', async () => {
  const m = await import('../admin/comp-sheets.js');
  assert.deepEqual(m.PEOPLE_HEADERS, ['الاسم بالكامل', 'رقم الموبايل', 'المجموعة / الفصل', 'الكنيسة', 'ملاحظات']);
  const book = await readXlsx(writeXlsx(m.peopleTemplate()));
  assert.deepEqual(book.sheets.map(s => s.name), [m.PEOPLE_SHEET, 'شرح', 'مثال']);
  assert.deepEqual(book.sheets[0].rows, [m.PEOPLE_HEADERS]);
  const sheet = new TextDecoder().decode((await unzip(writeXlsx(m.peopleTemplate())))['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /<col min="2" max="2" width="18"[^>]*style="2"/, 'the phone column is text');
  const { regWorld } = await import('./fakes/reg.mjs');
  const { call } = regWorld();
  const preview = plain(call('apiParticipantsImportPreview', book.sheets[2].rows.map(r => r.join('\t')).join('\n')));
  assert.deepEqual(preview.rows.map(r => r.status), ['new', 'new', 'new']);
  assert.ok(preview.rows[2].warnings.some(w => w.kind === 'sharedPhone'), 'the example shows a family phone');
});

test('peopleText: the preview rows with fixes back into import text (only the columns the file had)', async () => {
  const m = await import('../admin/comp-sheets.js');
  const text = m.peopleText([{ name: 'مارك\tميلاد', phone: '01012345678', group: 'ثانوي', church: 'x', notes: 'y' }, { name: 'مريم', phone: '0112', group: '' }], ['name', 'phone', 'group']);
  assert.equal(text, 'الاسم بالكامل\tرقم الموبايل\tالمجموعة / الفصل\nمارك ميلاد\t01012345678\tثانوي\nمريم\t0112\t');
});

test('codesBook: names, phones, groups and codes as text; the server file name', async () => {
  const m = await import('../admin/comp-sheets.js');
  const made = m.codesBook({ rows: [{ name: 'مارك', phone: '01012345678', group: 'ثانوي', code: 'ATH-ABCD-2345' }], filename: 'codes-2026-10-11.xlsx' });
  assert.equal(made.filename, 'codes-2026-10-11.xlsx');
  const rows = (await readXlsx(writeXlsx(made.book))).sheets[0].rows;
  assert.deepEqual(rows, [['الاسم', 'الموبايل', 'المجموعة / الفصل', 'الكود'], ['مارك', '01012345678', 'ثانوي', 'ATH-ABCD-2345']]);
});

test('normPhoneEg mirrors the server (normPhoneEg_) for the live preview', async () => {
  const m = await import('../admin/comp-sheets.js');
  const { regWorld } = await import('./fakes/reg.mjs');
  const { world } = regWorld();
  for (const value of ['01012345678', '1012345678', '+20 101 234 5678', '00201012345678', '+20 0101 234 5678', '٠١٠١٢٣٤٥٦٧٨', '(010) 1234-5678', '0101234567', '010123456789', '05012345678', '+44 7700 900123', '01x12345678', '', '201012345678']) {
    const server = plain(world.gs.normPhoneEg_(value));
    const mine = m.normPhoneEg(value);
    assert.deepEqual([mine.local, mine.norm, mine.problem], [server.local, server.norm, server.problem], value);
  }
});

test('WhatsApp: the message carries the code and the portal; the wa.me link never does', async () => {
  const m = await import('../admin/comp-sheets.js');
  const message = m.codeMessage({ name: 'مارك ميلاد', code: 'ATH-ABCD-2345', url: 'https://stathanasiosyouth.github.io/points/' });
  assert.match(message, /^أهلاً مارك 👋/);
  assert.ok(message.includes('ATH-ABCD-2345') && message.includes('https://stathanasiosyouth.github.io/points/'));
  assert.equal(m.waLink('0101 234 5678'), 'https://wa.me/201012345678');
  assert.equal(m.waLink('123'), '');
  assert.equal(m.MASKED_CODE, 'ATH-••••-••••');
});

test('groupTypos: a new group one letter off a known one (the file\'s bigger one or the registry\'s)', async () => {
  const m = await import('../admin/comp-sheets.js');
  assert.deepEqual(m.groupTypos([{ name: 'ثانوي بنين', count: 14, isNew: false }, { name: 'ثانوي بنن', count: 1, isNew: true }, { name: 'ابتدائي', count: 2, isNew: true }], []), { 'ثانوي بنن': 'ثانوي بنين' });
  assert.deepEqual(m.groupTypos([{ name: 'اعدادي بنات', count: 1, isNew: true }], ['إعدادي بنات']), { 'اعدادي بنات': 'إعدادي بنات' });
  assert.deepEqual(m.groupTypos([{ name: 'ثانوي', count: 3, isNew: true }, { name: 'ابتدائي', count: 3, isNew: true }], []), {});
});
