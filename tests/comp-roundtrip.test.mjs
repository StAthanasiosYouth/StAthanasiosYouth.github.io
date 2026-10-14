// Participants round trip (docs/COMPETITIONS.md §7.5.1): export → edit → re-import matched by the
// participant id (ids and codes kept), «-» clears a field, stale rows wait, the code column is never
// read or echoed; the responsible servant; bulk assign / new codes in one write each.

import test from 'node:test';
import assert from 'node:assert/strict';
import { plain } from './fakes/comp.mjs';
import { regWorld, addPerson, codeOf, activityRows, tab, phone } from './fakes/reg.mjs';

const HEAD = ['رقم المشترك', 'الاسم بالكامل', 'رقم الموبايل', 'المجموعة', 'الكنيسة', 'الخادم المسؤول', 'تاريخ الميلاد', 'ملاحظات', 'الحالة', 'نسخة البيانات', 'الكود'];

/* what the admin's «تصدير البيانات الحالية» writes (one line per person, codes when asked) */
function exportText(call, codes = {}) {
  const all = call('apiParticipants', { all: true }).items;
  return [HEAD.join('\t')].concat(all.map(p => [p.id, p.name, p.phone, p.group, p.church, p.servant, p.birthDate, p.notes, p.active ? 'نشط' : 'موقوف', p.rev, codes[p.id] || ''].join('\t')));
}

function world3() {
  const { world, call } = regWorld();
  const mina = addPerson(call, 'مينا عادل جرجس', phone(1), { group: 'مجموعة الكليات', church: 'مارجرجس' });
  const mariam = addPerson(call, 'مريم زكريا عطا', phone(2), { group: 'مجموعة المغتربين', servant: 'أ. مارك' });
  const john = addPerson(call, 'يوحنا مجدي سمير', phone(3), { group: 'مجموعة الخريجين' });
  return { world, call, mina, mariam, john };
}

test('servant: saved, edited, listed (servants / churches), never required', () => {
  const { call, mina, mariam } = world3();
  assert.equal(mariam.servant, 'أ. مارك');
  assert.equal(mina.servant, '');
  const edited = call('apiParticipantSave', { id: mina.id, servant: 'أ. مارك' }).participant;
  assert.equal(edited.servant, 'أ. مارك');
  assert.equal(edited.church, 'مارجرجس', 'the other fields are kept');
  const list = call('apiParticipants', { all: true });
  assert.deepEqual(plain(list.servants), [{ name: 'أ. مارك', count: 2 }]);
  assert.deepEqual(plain(list.churches), [{ name: 'مارجرجس', count: 1 }]);
  assert.match(list.items[0].rev, /^[0-9a-f]{8}$/);
  assert.throws(() => call('apiParticipantSave', { id: mina.id, servant: 'خ'.repeat(61) }), /الخادم المسؤول أطول/);
});

test('round trip: an unchanged export changes nothing; ids, names, phones and codes kept; the code column is never read or echoed', () => {
  const { call, mina, mariam, john } = world3();
  const codes = { [mina.id]: codeOf(call, mina.id), [mariam.id]: codeOf(call, mariam.id), [john.id]: codeOf(call, john.id) };
  const text = exportText(call, codes).join('\n');
  const preview = call('apiParticipantsImportPreview', text);
  assert.equal(preview.codeIgnored, true);
  assert.deepEqual(preview.problems, []);
  assert.deepEqual(preview.rows.map(r => [r.status, r.fromId, r.changes.length, r.ticked]), [['exists', true, 0, false], ['exists', true, 0, false], ['exists', true, 0, false]]);
  const json = JSON.stringify(preview);
  for (const code of Object.values(codes)) {
    assert.equal(json.includes(code), false, 'no code in the preview');
    assert.equal(json.includes(code.replace(/-/g, '').slice(3)), false);
  }
  const report = call('apiParticipantsImportApply', text, {});
  assert.deepEqual([report.added, report.updated, report.skipped.exists], [0, 0, 3]);
  assert.equal(JSON.stringify(report).includes(codes[mina.id]), false);
});

test('round trip: edits by id (name, phone, servant, clear with «-»), a new row, unknown / bad / repeated ids, a clash; apply keeps ids and codes', () => {
  const { world, call, mina, mariam, john } = world3();
  const before = { [mina.id]: codeOf(call, mina.id), [mariam.id]: codeOf(call, mariam.id), [john.id]: codeOf(call, john.id) };
  const lines = exportText(call);
  const cells = lines.map(l => l.split('\t'));
  const row = id => cells.find(c => c[0] === id);
  row(mina.id)[1] = 'مينا عادل جرجس حنا';          // a new name
  row(mina.id)[5] = 'أ. بيتر';                       // a servant
  row(mina.id)[4] = '-';                             // clear the church
  row(mariam.id)[2] = '01299998888';                 // a new phone
  row(john.id)[3] = '';                              // an empty cell keeps the group
  cells.push(['', 'كيرلس سامح نبيل', '01011110000', 'مجموعة الكليات', '', 'أ. بيتر', '', '', '', '', '']);   // new
  cells.push(['p-00000000', 'شخص مش موجود', '01011110001', '', '', '', '', '', '', '', '']);              // unknown id
  cells.push(['p-zz', 'رقم غلط خالص', '01011110002', '', '', '', '', '', '', '', '']);                      // bad id
  cells.push([john.id, 'يوحنا مجدي سمير', phone(3), 'مجموعة الخريجين', '', '', '', '', '', '', '']);      // the same id again
  cells.push([john.id.replace(/.$/, c => (c === '0' ? '1' : '0')), 'مريم زكريا عطا', '01299998888', '', '', '', '', '', '', '', '']);
  const text = cells.map(c => c.join('\t')).join('\n');

  const preview = call('apiParticipantsImportPreview', text);
  const at = line => preview.rows.find(r => r.line === line);
  const byId = id => preview.rows.find(r => r.id === id);
  assert.equal(byId(mina.id).status, 'exists');
  assert.deepEqual(plain(byId(mina.id).changes).map(c => [c.field, c.from, c.to]), [['name', 'مينا عادل جرجس', 'مينا عادل جرجس حنا'], ['church', 'مارجرجس', ''], ['servant', '', 'أ. بيتر']]);
  assert.equal(byId(mina.id).ticked, true, 'an export row matched by id is ticked');
  assert.deepEqual(plain(byId(mariam.id).changes).map(c => c.field), ['phone']);
  assert.equal(byId(john.id).changes.length, 0, 'an empty cell keeps what is stored');
  assert.equal(at(5).status, 'new');
  assert.equal(at(6).status, 'error');
  assert.match(at(6).errors[0], /مش موجود في السجل/);
  assert.match(at(7).errors[0], /رقم المشترك «p-zz» مش صحيح/);
  assert.equal(at(8).status, 'dup');
  assert.equal(at(9).status, 'error', 'the last row is an unknown id');

  const decisions = Object.fromEntries(preview.rows.filter(r => r.ticked).map(r => ['r' + r.line, r.choices[0].value]));
  const report = call('apiParticipantsImportApply', text, decisions);
  assert.deepEqual([report.added, report.updated], [1, 2]);

  const now = Object.fromEntries(call('apiParticipants', { all: true }).items.map(p => [p.id, p]));
  assert.equal(now[mina.id].name, 'مينا عادل جرجس حنا');
  assert.equal(now[mina.id].church, '');
  assert.equal(now[mina.id].servant, 'أ. بيتر');
  assert.equal(now[mariam.id].phone, '01299998888');
  assert.equal(now[john.id].group, 'مجموعة الخريجين');
  for (const id of [mina.id, mariam.id, john.id]) assert.equal(codeOf(call, id), before[id], 'the code stays');
  assert.equal(Object.keys(now).length, 4);
  // the old name + phone finds nobody; the new ones do
  const rows = tab(world, 'Participants');
  assert.equal(rows.find(r => r.id === mariam.id).phoneNorm, '1299998888');
  const log = activityRows(world).map(r => r.join(' ')).join('\n');
  for (const code of Object.values(before)) assert.equal(log.includes(code), false, 'no code in Activity');
});

test('round trip: a person edited in the panel after the export is stale (shown, not ticked); a name+phone that is someone else is refused', () => {
  const { call, mina, mariam } = world3();
  const cells = exportText(call).map(l => l.split('\t'));
  call('apiParticipantSave', { id: mina.id, notes: 'اتعدل بعد التصدير' });
  cells.find(c => c[0] === mina.id)[3] = 'مجموعة الخريجين';
  const m = cells.find(c => c[0] === mariam.id);
  m[1] = 'يوحنا مجدي سمير';
  m[2] = phone(3);
  const preview = call('apiParticipantsImportPreview', cells.map(c => c.join('\t')).join('\n'));
  const mine = preview.rows.find(r => r.id === mina.id);
  assert.equal(mine.ticked, false);
  assert.ok(mine.warnings.some(w => w.kind === 'stale'));
  assert.equal(preview.summary.warnings.stale, 1);
  const clash = preview.rows.find(r => r.id === mariam.id);
  assert.equal(clash.status, 'error');
  assert.match(clash.errors[0], /متسجلين لمشترك تاني: يوحنا مجدي سمير/);
});

test('round trip: a long file sends only the rows that change (the rest counted)', () => {
  const { call } = regWorld();
  const lines = ['الاسم بالكامل\tرقم الموبايل'];
  for (let i = 0; i < 230; i++) lines.push(`مشترك رقم ${i} تجريبي\t010${String(40000000 + i).padStart(8, '0')}`);
  const first = call('apiParticipantsImportPreview', lines.join('\n'));
  call('apiParticipantsImportApply', lines.join('\n'), Object.fromEntries(first.rows.map(r => ['r' + r.line, r.choices[0].value])));
  const cells = exportText(call).map(l => l.split('\t'));
  cells[5][3] = 'مجموعة الكليات';
  const preview = call('apiParticipantsImportPreview', cells.map(c => c.join('\t')).join('\n'));
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.hiddenSame, 229);
  assert.equal(preview.summary.total, 230);
});

test('bulk: assign a servant / a group, and new codes for a selection, in one write each; Activity has counts only', () => {
  const { world, call, mina, mariam, john } = world3();
  const old = { [mina.id]: codeOf(call, mina.id), [john.id]: codeOf(call, john.id), [mariam.id]: codeOf(call, mariam.id) };
  assert.equal(call('apiParticipantsAssign', [mina.id, john.id, mariam.id], { servant: 'أ. مارك' }).count, 2, 'Mariam has him already');
  assert.equal(call('apiParticipantsAssign', [john.id], { group: 'مجموعة الكليات' }).count, 1);
  const now = Object.fromEntries(call('apiParticipants', { all: true }).items.map(p => [p.id, p]));
  assert.deepEqual([now[mina.id].servant, now[john.id].servant, now[john.id].group, now[mina.id].church], ['أ. مارك', 'أ. مارك', 'مجموعة الكليات', 'مارجرجس']);
  assert.throws(() => call('apiParticipantsAssign', [], { servant: 'x' }), /اختار المشتركين/);
  assert.throws(() => call('apiParticipantsAssign', ['bad'], { servant: 'x' }), /اختار المشتركين/);
  assert.throws(() => call('apiParticipantsAssign', [mina.id], {}), /اختار تغيّر إيه/);

  const reset = call('apiParticipantsResetCodes', [mina.id, john.id]);
  assert.deepEqual(plain(reset), { count: 2 });
  assert.notEqual(codeOf(call, mina.id), old[mina.id]);
  assert.notEqual(codeOf(call, john.id), old[john.id]);
  assert.equal(codeOf(call, mariam.id), old[mariam.id]);
  const rows = tab(world, 'Participants');
  assert.equal(rows.find(r => r.id === mina.id).codeVersion, '2');
  assert.equal(rows.find(r => r.id === mariam.id).phone, '+201012340002', 'untouched cells keep their form');
  const log = activityRows(world).map(r => r.join(' ')).join('\n');
  assert.match(log, /عمل أكواد جديدة لـ ٢ مشترك/);
  assert.match(log, /غيّر الخادم المسؤول لـ ٢ مشترك/);
  for (const code of Object.values(old)) assert.equal(log.includes(code), false);

  const codes = call('apiParticipantCodes', { ids: [mina.id, mariam.id] });
  assert.deepEqual(codes.rows.map(r => [r.name, r.servant, r.group]).sort(), [['مريم زكريا عطا', 'أ. مارك', 'مجموعة المغتربين'], ['مينا عادل جرجس', 'أ. مارك', 'مجموعة الكليات']].sort());
});
