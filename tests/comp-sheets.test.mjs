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

test('names template = the export layout: «الأسماء» (exact headers, text columns, filters, «نسخة البيانات» hidden, dropdowns from «القوائم»), «شرح», «القوائم», «مثال» that the server imports', async () => {
  const m = await import('../admin/comp-sheets.js');
  assert.deepEqual(m.PEOPLE_HEADERS, ['رقم المشترك', 'الاسم بالكامل', 'رقم الموبايل', 'المجموعة', 'الكنيسة', 'الخادم المسؤول', 'تاريخ الميلاد', 'ملاحظات', 'الحالة', 'نسخة البيانات']);
  const bytes = writeXlsx(m.peopleTemplate({ groups: ['مجموعة الكليات', 'مجموعة المغتربين'], churches: [], servants: ['أ. بيتر'] }));
  const book = await readXlsx(bytes);
  assert.deepEqual(book.sheets.map(s => s.name), [m.PEOPLE_SHEET, 'شرح', 'القوائم', 'مثال']);
  assert.deepEqual(book.sheets[0].rows, [m.PEOPLE_HEADERS]);
  assert.deepEqual(book.sheets[2].rows, [['المجموعات', 'الكنايس', 'الخدام'], ['مجموعة الكليات', '', 'أ. بيتر'], ['مجموعة المغتربين']]);
  const files = await unzip(bytes);
  const sheet = new TextDecoder().decode(files['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /<col min="3" max="3" width="16"[^>]*style="2"/, 'the phone column is text');
  assert.match(sheet, /<col min="10" max="10"[^>]*hidden="1"/, '«نسخة البيانات» is hidden');
  assert.match(sheet, /<autoFilter ref="A1:J2"\/>/);
  assert.match(sheet, /showErrorMessage="0" sqref="D2:D1000"><formula1>'القوائم'!\$A\$2:\$A\$3<\/formula1>/, 'groups: a dropdown that takes a new word');
  assert.match(sheet, /sqref="F2:F1000"><formula1>'القوائم'!\$C\$2:\$C\$2</, 'servants');
  assert.doesNotMatch(sheet, /sqref="E2/, 'no churches yet: no dropdown');
  assert.match(new TextDecoder().decode(files['xl/workbook.xml']), /<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'الأسماء'!\$A\$1:\$J\$2<\/definedName>/);
  assert.doesNotMatch(JSON.stringify(book), /ثانوي|إعدادي|ابتدائي/, 'youth groups, not school years');
  const { regWorld } = await import('./fakes/reg.mjs');
  const { call } = regWorld();
  const preview = plain(call('apiParticipantsImportPreview', book.sheets[3].rows.map(r => r.join('\t')).join('\n')));
  assert.deepEqual(preview.rows.map(r => r.status), ['new', 'new', 'new']);
  assert.deepEqual(preview.rows.map(r => r.servant), ['أ. بيتر سمير', 'أ. مارينا نبيل', 'أ. مارينا نبيل']);
  assert.ok(preview.rows[2].warnings.some(w => w.kind === 'sharedPhone'), 'the example shows a family phone');
});

test('peopleBook: the export (ids, phones with their 0, DD/MM/YYYY, status, rev), codes only when given, read back by the server unchanged', async () => {
  const m = await import('../admin/comp-sheets.js');
  const { regWorld, addPerson, codeOf } = await import('./fakes/reg.mjs');
  const { call } = regWorld();
  const a = addPerson(call, 'مينا عادل جرجس', '01012345678', { group: 'مجموعة الكليات', servant: 'أ. بيتر', birthDate: '2004-03-15' });
  addPerson(call, 'مريم زكريا عطا', '01112345678', { church: 'العدرا' });
  const people = call('apiParticipants', { all: true }).items;
  const plainBook = await readXlsx(writeXlsx(m.peopleBook(people, {})));
  const row = plainBook.sheets[0].rows.find(r => r[0] === a.id);
  assert.deepEqual(row, [a.id, 'مينا عادل جرجس', '01012345678', 'مجموعة الكليات', '', 'أ. بيتر', '15/03/2004', '', 'نشط', people.find(p => p.id === a.id).rev]);
  assert.equal(plainBook.sheets[0].rows[0].includes(m.CODE_HEADER), false, 'no code column unless asked');
  const code = codeOf(call, a.id);
  const withCodes = await readXlsx(writeXlsx(m.peopleBook(people, { codes: { [a.id]: code } })));
  assert.equal(withCodes.sheets[0].rows[0].at(-1), 'الكود');
  assert.equal(withCodes.sheets[0].rows.find(r => r[0] === a.id).at(-1), code);
  // back in: nothing changes, nothing ticked, the code column ignored
  const preview = call('apiParticipantsImportPreview', withCodes.sheets[0].rows.map(r => r.join('\t')).join('\n'));
  assert.equal(preview.codeIgnored, true);
  assert.deepEqual(preview.rows.map(r => [r.status, r.changes.length, r.ticked]), [['exists', 0, false], ['exists', 0, false]]);
  assert.equal(m.peopleFilename('2026-10-14 10:00', false), 'المشاركين-2026-10-14.xlsx');
  assert.equal(m.peopleFilename('2026-10-14', true), 'المشاركين-بالأكواد-2026-10-14.xlsx');
});

test('peopleText: the preview rows with fixes back into import text (the file\'s columns; id and «-» kept)', async () => {
  const m = await import('../admin/comp-sheets.js');
  const text = m.peopleText([{ name: 'مارك\tميلاد', phone: '01012345678', group: 'مجموعة الكليات', church: 'x', notes: 'y' }, { name: 'مريم', phone: '0112', group: '' }], ['name', 'phone', 'group']);
  assert.equal(text, 'الاسم بالكامل\tرقم الموبايل\tالمجموعة\nمارك ميلاد\t01012345678\tمجموعة الكليات\nمريم\t0112\t');
  const back = m.peopleText([{ id: 'p-0000abcd', name: 'مينا', phone: '010', church: '', clears: ['church'], rev: '1234abcd', status: 'x' }], ['id', 'name', 'phone', 'church', 'rev']);
  assert.equal(back, 'رقم المشترك\tالاسم بالكامل\tرقم الموبايل\tالكنيسة\tنسخة البيانات\np-0000abcd\tمينا\t010\t-\t1234abcd');
});

test('codesBook: names, phones, groups, servants and codes as text; the server file name', async () => {
  const m = await import('../admin/comp-sheets.js');
  const made = m.codesBook({ rows: [{ name: 'مارك', phone: '01012345678', group: 'مجموعة الكليات', servant: 'أ. بيتر', code: 'ATH-ABCD-2345' }], filename: 'codes-2026-10-11.xlsx' });
  assert.equal(made.filename, 'codes-2026-10-11.xlsx');
  const rows = (await readXlsx(writeXlsx(made.book))).sheets[0].rows;
  assert.deepEqual(rows, [['الاسم', 'الموبايل', 'المجموعة', 'الخادم المسؤول', 'الكود'], ['مارك', '01012345678', 'مجموعة الكليات', 'أ. بيتر', 'ATH-ABCD-2345']]);
});

test('distribution: one file per servant with only their people (no servant → by group), a ready message each, the chat link never carries the code', async () => {
  const m = await import('../admin/comp-sheets.js');
  const rows = [
    { id: 'p-1', name: 'مينا عادل', phone: '01012345678', group: 'مجموعة الكليات', servant: 'أ. بيتر', code: 'ATH-AAAA-2222' },
    { id: 'p-2', name: 'مريم زكريا', phone: '01112345678', group: 'مجموعة المغتربين', servant: 'أ. مارينا', code: 'ATH-BBBB-3333' },
    { id: 'p-3', name: 'بيشوي سمير', phone: '01212345678', group: 'مجموعة الكليات', servant: 'أ.  بيتر', code: 'ATH-CCCC-4444' },
    { id: 'p-4', name: 'كيرلس نبيل', phone: '01512345678', group: 'مجموعة الخريجين', servant: '', code: 'ATH-DDDD-5555' }
  ];
  const files = m.distributionFiles(rows, { by: 'servant', url: 'https://example.org/points/', date: '2026-10-14 09:00' });
  assert.deepEqual(files.map(f => [f.name, f.count]), [['أ. بيتر', 2], ['أ. مارينا', 1], ['من غير خادم – مجموعة الخريجين', 1]]);
  assert.equal(files[0].filename, 'أكواد-أ.-بيتر-2026-10-14.xlsx');
  assert.equal(files[2].filename, 'أكواد-من-غير-خادم-–-مجموعة-الخريجين-2026-10-14.xlsx');
  const book = await readXlsx(writeXlsx(files[0].book));
  assert.deepEqual(book.sheets.map(s => s.name), ['الأكواد', 'إزاي تبعت']);
  const sheet = book.sheets[0].rows;
  assert.deepEqual(sheet[0], ['الاسم', 'الموبايل', 'المجموعة', 'الكود', 'رسالة واتساب', 'فتح الشات']);
  assert.deepEqual(sheet.slice(1).map(r => r[0]), ['بيشوي سمير', 'مينا عادل'], 'only this servant\'s people');
  assert.equal(JSON.stringify(book).includes('ATH-BBBB-3333'), false, 'another servant\'s code is not in the file');
  const mina = sheet.find(r => r[0] === 'مينا عادل');
  assert.match(mina[4], /أهلاً مينا/);
  assert.match(mina[4], /ATH-AAAA-2222/);
  assert.match(mina[4], /https:\/\/example\.org\/points\//);
  assert.equal(mina[5], 'https://wa.me/201012345678', 'the chat only, no text');
  assert.deepEqual(m.distributionFiles(rows, { by: 'group' }).map(f => [f.name, f.count]), [['مجموعة الخريجين', 1], ['مجموعة الكليات', 2], ['مجموعة المغتربين', 1]]);
  assert.deepEqual(m.distributionFiles(rows, { by: 'one' }).map(f => f.count), [4]);
  assert.equal(m.bucketOf({ church: '' }, 'church'), 'من غير كنيسة');
  const text = m.messagesText(rows.slice(0, 2), 'https://example.org/points/');
  assert.match(text, /^— مينا عادل \(01012345678\)\nأهلاً مينا/);
  assert.match(text, /\n\n— مريم زكريا/);
  // a zip of the files opens back into the same workbooks
  const { zip } = await import('../admin/xlsx.js');
  const packed = await unzip(zip(files.map(f => ({ name: f.filename, data: writeXlsx(f.book) }))));
  assert.deepEqual(Object.keys(packed).sort(), files.map(f => f.filename).sort());
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
