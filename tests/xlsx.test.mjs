// The admin's small XLSX reader/writer (admin/xlsx.js): round trips, a file
// saved by real Excel (deflate + shared strings), Arabic, phone numbers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeXlsx, readXlsx, rowsToTsv, unzip, zip, crc32, columnName, firstDataSheet } from '../admin/xlsx.js';

const fixture = (name) => readFileSync(new URL('./fixtures/' + name, import.meta.url));

test('written workbooks read back cell for cell', async () => {
  const rows = [['الاسم بالكامل', 'رقم الموبايل'], ['مينا زكريا عطاالله', '01012345678'], ['A & B <x> "q"', 42], ['  مسافات  ', 'سطر\nتاني']];
  const book = await readXlsx(writeXlsx({ sheets: [{ name: 'الأسماء', rows, textColumns: [1] }, { name: 'شرح', header: false, rows: [['x']] }] }));
  assert.equal(book.sheets.length, 2);
  assert.equal(book.sheets[0].name, 'الأسماء');
  assert.deepEqual(book.sheets[0].rows, [['الاسم بالكامل', 'رقم الموبايل'], ['مينا زكريا عطاالله', '01012345678'], ['A & B <x> "q"', '42'], ['  مسافات  ', 'سطر\nتاني']]);
});

test('a file saved by Excel reads (deflate, shared strings, a number that lost its 0)', async () => {
  const book = await readXlsx(fixture('excel-saved.xlsx'));
  const rows = book.sheets[0].rows;
  assert.deepEqual(rows[1], ['مينا زكريا عطاالله', '01012345678', 'ثانوي']);
  assert.deepEqual(rows[3], ['فادي يوسف', '1098765432', 'إعدادي']);
  assert.equal(book.sheets[1].name, 'شرح');
});

test('templates carry RTL, frozen header, text columns and dropdowns', async () => {
  const files = await unzip(writeXlsx({ sheets: [{ name: 'Q', rows: [['النوع']], lists: [{ column: 0, values: ['اختيار واحد', 'صح وغلط'] }], textColumns: [0] }] }));
  const sheet = new TextDecoder().decode(files['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /rightToLeft="1"/);
  assert.match(sheet, /state="frozen"/);
  assert.match(sheet, /<dataValidation type="list"[^>]*sqref="A2:A1000"><formula1>&quot;اختيار واحد,صح وغلط&quot;<\/formula1>/);
  assert.match(sheet, /<col min="1" max="1"[^>]*style="2"/);
});

test('rowsToTsv flattens tabs and newlines and drops trailing empty rows', () => {
  assert.equal(rowsToTsv([['a', 'b\tc'], ['d\ne', ''], ['', ''], []]), 'a\tb c\nd e\t');
});

test('zip helpers', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.deepEqual([columnName(0), columnName(25), columnName(26), columnName(701)], ['A', 'Z', 'AA', 'ZZ']);
  const files = await unzip(zip([{ name: 'ملف.txt', data: new TextEncoder().encode('مرحبا') }]));
  assert.equal(new TextDecoder().decode(files['ملف.txt']), 'مرحبا');
});

test('not an xlsx: a clear Arabic error', async () => {
  await assert.rejects(readXlsx(new TextEncoder().encode('name,phone\nمينا,010')), /مش ملف Excel/);
});

test('firstDataSheet prefers the named sheet, else the first with data', () => {
  const book = { sheets: [{ name: 'فاضي', rows: [[]] }, { name: 'الأسئلة', rows: [['x']] }] };
  assert.equal(firstDataSheet(book).name, 'الأسئلة');
  assert.equal(firstDataSheet(book, 'فاضي').name, 'فاضي');
});
