// Agent B (prog): the meetings import, the meeting program, the live stage
// (live.json), the cards' background («شكل الخلفية»), the schema-5 data
// upgrade, and a reload in the middle of signing in (Presence.gs).
// Runs the real .gs files in the fake Apps Script world (tests/fakes/gas.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './fakes/gas.mjs';
import { schema4World, SCHEMA_5_COLUMNS } from './fakes/legacy.mjs';

const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'second.admin@gmail.com';
const STRANGER = 'someone@gmail.com';
const CLIENT = 'test-client.apps.googleusercontent.com';

const plain = value => JSON.parse(JSON.stringify(value));
const snapshot = world => JSON.stringify(world.spreadsheet.getSheets().map(s => [s.name, s.data]));

function world(options = {}) {
  const w = createWorld(options);
  w.as(ADMIN).gs.setup();
  w.properties.set('GITHUB_TOKEN', 'test-token');
  w.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  w.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');
  w.gs.apiSaveSettings({ 'meeting.day': 'الأحد', 'meeting.time': '20:00', 'meeting.durationMinutes': '120' });
  return w;
}

const session = (w, date) => plain(w.gs.readTable_('Sessions')).find(s => s.date === date);
const build = (w, now = '2026-10-08T12:00') => plain(w.gs.buildPublicContent(w.gs.readDraft_(), { now }));


/* =========================================================
   IMPORT: parsing (pure)
========================================================= */

test('import parsing: Arabic header, BOM, tabs from Excel, Arabic digits, DD/MM/YYYY, 12-hour times', () => {
  const w = world();
  const text = '﻿التاريخ\tالموضوع\tالخادم\tالوقت\tملاحظات\n' +
    '١١/١٠/٢٠٩٩\tحياة التسليم\tأبونا أنطوني\t٨:٣٠ م\t\n' +
    '2099-10-18\tالصلاة\t\t7 ص\tفي القاعة الكبيرة\n' +
    '\t\t\t\t\n' +
    '1/11/2099\tالخدمة\t\t20:00:00\t\n';
  const parsed = plain(w.gs.parseImport_(text, '2026-10-08'));
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.columns, ['date', 'topic', 'speaker', 'time', 'note']);
  assert.deepEqual(parsed.rows.map(r => [r.line, r.date, r.values.time, r.errors.length]), [
    [2, '2099-10-11', '20:30', 0], [3, '2099-10-18', '07:00', 0], [5, '2099-11-01', '20:00', 0]
  ]);
  assert.equal(parsed.rows[0].values.topic, 'حياة التسليم');
  assert.equal(parsed.rows[0].values.speaker, 'أبونا أنطوني');
  assert.equal(parsed.rows[1].values.note, 'في القاعة الكبيرة');
});

test('import parsing: English CSV with quotes and a line break in a cell; header words matched loosely', () => {
  const w = world();
  const text = 'Date,Title,Speaker,Description,Time,Notes\r\n' +
    '2099-10-11,"Faith, hope","Fr. Antony","line one\nline two",8:00 PM,\r\n' +
    '2099/10/25,"He said ""yes""",,,,\r\n';
  const parsed = plain(w.gs.parseImport_(text, '2026-10-08'));
  assert.deepEqual(parsed.columns, ['date', 'topic', 'speaker', 'description', 'time', 'note']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].values.topic, 'Faith, hope');
  assert.equal(parsed.rows[0].values.description, 'line one\nline two');
  assert.equal(parsed.rows[0].values.time, '20:00');
  assert.equal(parsed.rows[1].line, 4, 'the line count follows the line break inside a cell');
  assert.equal(parsed.rows[1].date, '2099-10-25');
  assert.equal(parsed.rows[1].values.topic, 'He said "yes"');
  // "الخادم / المتكلم", "التاريخ" with a hamza variant, ";" separated
  const semi = plain(w.gs.parseImport_('تاريخ;الخادم / المتكلم;الموضوع\n11-10-2099;أبونا;موضوع', '2026-10-08'));
  assert.deepEqual(semi.columns, ['date', 'speaker', 'topic']);
  assert.equal(semi.rows[0].date, '2099-10-11');
});

test('import parsing: errors and warnings per row (bad date, bad time, too long, the same date twice, past date)', () => {
  const w = world();
  const long = 'م'.repeat(81);
  const text = 'التاريخ,الموضوع,الوقت\n' +
    '31/02/2099,x,\n' +              // no such day
    'بكره,x,\n' +                    // not a date
    ',x,\n' +                        // missing
    '2099-10-11,' + long + ',\n' +   // too long
    '2099-10-18,x,25:00\n' +         // bad time
    '2099-10-25,a,\n' +
    '25/10/2099,b,\n' +              // the same date twice
    '2020-01-05,old,\n';             // past
  const rows = plain(w.gs.parseImport_(text, '2026-10-08')).rows;
  assert.match(rows[0].errors[0], /مش مفهوم/);
  assert.match(rows[1].errors[0], /مش مفهوم/);
  assert.match(rows[2].errors[0], /التاريخ ناقص/);
  assert.match(rows[3].errors[0], /الموضوع أطول من 80/);
  assert.match(rows[4].errors[0], /الوقت «.?25:00.?» مش مفهوم/);
  assert.match(rows[5].errors[0], /متكرر في الملف \(سطر 8\)/);
  assert.match(rows[6].errors[0], /متكرر في الملف \(سطر 7\)/);
  assert.deepEqual([rows[7].errors, rows[7].warnings], [[], ['التاريخ ده فات']]);
});

test('import parsing: no header (dates first) is read in the template order; a header without a date column is refused; 500 rows at most', () => {
  const w = world();
  const bare = plain(w.gs.parseImport_('2099-10-11\tموضوع\tأبونا', '2026-10-08'));
  assert.deepEqual(bare.problems, []);
  assert.deepEqual([bare.rows[0].values.topic, bare.rows[0].values.speaker], ['موضوع', 'أبونا']);
  assert.match(plain(w.gs.parseImport_('الموضوع,المتكلم\nx,y', '2026-10-08')).problems[0], /التاريخ/);
  assert.match(plain(w.gs.parseImport_('', '2026-10-08')).problems[0], /مفيش صفوف/);
  const many = 'date,topic\n' + Array.from({ length: 501 }, (_, i) => `2099-01-01,x${i}`).join('\n');
  const capped = plain(w.gs.parseImport_(many, '2026-10-08'));
  assert.match(capped.problems[0], /501 صف، والحد 500/);
  assert.equal(capped.rows.length, 500);
});


/* =========================================================
   IMPORT: preview and apply (never a silent overwrite)
========================================================= */

function importWorld() {
  const w = world();
  w.gs.apiSaveItem('sessions', { date: '2099-10-11', topic: 'القديم', speaker: 'أبونا', description: 'وصف مهم', notify: { topic: false } });
  w.gs.apiSaveItem('sessions', { date: '2099-10-25', topic: 'زي ما هو', speaker: 'الخادم', notify: { topic: false } });
  return w;
}

const IMPORT = 'التاريخ\tالموضوع\tالمتكلم\tالوصف\n' +
  '2099-10-11\tالجديد\t\t\n' +          // update: topic only (empty cells keep the rest)
  '2099-10-18\tموضوع جديد\tأبونا\t\n' +  // add
  '2099-10-25\tزي ما هو\tالخادم\t\n' +   // identical: skip
  '2099-13-01\tx\t\t\n';                 // error

test('preview: add / update (what changes) / skip / error — and nothing is written', () => {
  const w = importWorld();
  const before = snapshot(w);
  const preview = plain(w.as(ADMIN).gs.apiImportPreview(IMPORT));
  assert.equal(snapshot(w), before, 'read-only');
  assert.deepEqual(preview.rows.map(r => [r.date || r.line, r.action]), [['2099-10-11', 'update'], ['2099-10-18', 'add'], ['2099-10-25', 'skip'], [5, 'error']]);
  assert.deepEqual(preview.rows[0].changes, [{ field: 'topic', label: 'الموضوع', from: 'القديم', to: 'الجديد' }]);
  assert.match(preview.rows[0].base, /^[0-9a-f]{16}$/);
  assert.deepEqual(preview.counts, { add: 1, update: 1, skip: 1, error: 1, locked: 0 });
});

test('apply: an update is applied only when ticked, against exactly what was previewed; empty cells never blank a field', () => {
  const w = importWorld();
  const gs = w.as(ADMIN).gs;
  const preview = plain(gs.apiImportPreview(IMPORT));
  const update = preview.rows.find(r => r.action === 'update');

  // nothing ticked but the add: the update is reported, not applied
  let report = plain(gs.apiImportApply(IMPORT, { '2099-10-18': 'add' }));
  assert.deepEqual([report.added, report.updated, report.skipped, report.errors], [1, 0, 2, 1]);
  assert.equal(session(w, '2099-10-11').topic, 'القديم', 'not overwritten');
  assert.equal(session(w, '2099-10-18').topic, 'موضوع جديد');
  assert.equal(session(w, '2099-10-18').enabled, true);
  assert.match(report.rows.find(r => r.date === '2099-10-11').reason, /مش متعلّم/);
  assert.ok(Array.isArray(report.state.draft.sessions), 'the fresh state comes back');

  // someone changed the meeting after the preview: the old tick is refused
  gs.apiSaveItem('sessions', { originalDate: '2099-10-11', date: '2099-10-11', topic: 'اتعدل', speaker: 'أبونا', description: 'وصف مهم', notify: { topic: false } });
  report = plain(gs.apiImportApply(IMPORT, { '2099-10-11': 'update:' + update.base }));
  assert.equal(report.updated, 0);
  assert.match(report.rows.find(r => r.date === '2099-10-11').reason, /اتغير من بعد المعاينة/);
  assert.equal(session(w, '2099-10-11').topic, 'اتعدل');

  // a fresh preview, ticked: applied — only the topic, the rest kept
  const again = plain(gs.apiImportPreview(IMPORT)).rows.find(r => r.date === '2099-10-11');
  assert.deepEqual(again.changes.map(c => [c.from, c.to]), [['اتعدل', 'الجديد']]);
  report = plain(gs.apiImportApply(IMPORT, { '2099-10-11': 'update:' + again.base }));
  assert.equal(report.updated, 1);
  const updated = session(w, '2099-10-11');
  assert.deepEqual([updated.topic, updated.speaker, updated.description], ['الجديد', 'أبونا', 'وصف مهم']);
  // the added row (18th) is now identical: skipped, not added twice
  assert.equal(report.rows.find(r => r.date === '2099-10-18').result, 'skipped');
  assert.equal(plain(gs.readTable_('Sessions')).filter(s => s.date === '2099-10-18').length, 1);

  // logged; no bell notification made by an import
  const log = w.spreadsheet.getSheetByName('Log').data.filter(r => r[2] === 'sessions.import');
  assert.equal(log.length, 3);
  assert.match(log[0][3], /added 1, updated 0/);
  assert.ok(!plain(gs.readTable_('Notifications')).some(n => n.id === 'notif-session-2099-10-18'));
});

test('apply: an add that is not ticked (e.g. a past date) is not added; months ahead in one go are fine', () => {
  const w = importWorld();
  const gs = w.as(ADMIN).gs;
  const rows = ['التاريخ,الموضوع', '2020-01-05,فات'];
  for (let i = 0; i < 40; i++) rows.push(`${2100 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-07,موضوع ${i + 1}`);
  const text = rows.join('\n');
  const preview = plain(gs.apiImportPreview(text));
  assert.deepEqual(preview.rows[0].warnings, ['التاريخ ده فات']);
  const decisions = Object.fromEntries(preview.rows.filter(r => r.action === 'add' && !r.warnings.length).map(r => [r.date, 'add']));
  const report = plain(gs.apiImportApply(text, decisions));
  assert.deepEqual([report.added, report.skipped], [40, 1]);
  assert.equal(session(w, '2020-01-05'), undefined);
  assert.equal(session(w, '2103-04-07').topic, 'موضوع 40');
  // the same validation as the editor: a written row reads back like one saved there
  const built = build(w);
  assert.deepEqual(built.errors, []);
});

test('apply: a meeting another admin is editing right now is skipped (locked), the rest goes in', () => {
  const w = importWorld();
  w.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  w.properties.set('ADMIN_CLIENT_ID', CLIENT);
  w.as('');
  const start = email => {
    const token = w.issueToken({ email, aud: CLIENT });
    const sid = w.post({ fn: 'apiSessionStart', args: [{ device: email, state: false }], token }).result.sid;
    return (fn, ...args) => w.post({ fn, args, token, sid });
  };
  const second = start(SECOND);
  assert.equal(second('apiHeartbeat', { locks: ['sessions:2099-10-11'] }).result.locks['sessions:2099-10-11'].granted, true);
  const me = start(ADMIN);
  const preview = me('apiImportPreview', IMPORT).result;
  const row = preview.rows.find(r => r.date === '2099-10-11');
  assert.equal(row.action, 'locked');
  assert.match(row.reason, /second\.admin بيعدّل/);
  const report = me('apiImportApply', IMPORT, { '2099-10-18': 'add', '2099-10-11': 'update:anything' }).result;
  assert.deepEqual([report.added, report.updated], [1, 0]);
  assert.equal(session(w, '2099-10-11').topic, 'القديم');
});

test('import: admins only', () => {
  const w = importWorld();
  const before = snapshot(w);
  w.as(STRANGER);
  assert.throws(() => w.gs.apiImportPreview(IMPORT), /مش مسموح/);
  assert.throws(() => w.gs.apiImportApply(IMPORT, { '2099-10-18': 'add' }), /مش مسموح/);
  assert.equal(snapshot(w), before);
});


/* =========================================================
   MEETING PROGRAM
========================================================= */

const PROGRAM = [
  { title: 'تسبحة', time: '20:00', minutes: 30 },
  { title: 'كلمة', time: '', minutes: 45 },
  { title: 'ترانيم', time: '', minutes: '' },
  { title: 'ختام', time: '21:40', minutes: '' }
];

test('program: saved as JSON text, published as contiguous stages in Cairo wall time', () => {
  const w = world();
  w.as(ADMIN).gs.apiSaveItem('sessions', { date: '2099-10-11', topic: 'x', program: PROGRAM, notify: {} });
  const stored = JSON.parse(session(w, '2099-10-11').program);
  assert.deepEqual(stored, PROGRAM);
  const { content, errors } = build(w);
  assert.deepEqual(errors, []);
  assert.deepEqual(content.sessions.find(s => s.date === '2099-10-11').program, [
    { title: 'تسبحة', start: '2099-10-11T20:00', end: '2099-10-11T20:30' },
    { title: 'كلمة', start: '2099-10-11T20:30', end: '2099-10-11T21:15' },
    { title: 'ترانيم', start: '2099-10-11T21:15', end: '2099-10-11T21:40' },
    { title: 'ختام', start: '2099-10-11T21:40', end: '2099-10-11T22:00' }
  ]);
});

test('program: a meeting without one has no program key; the week\'s own time and length are used', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  gs.apiSaveItem('sessions', { date: '2099-10-11', topic: 'x', notify: {} });
  gs.apiSaveItem('sessions', { date: '2099-10-18', time: '19:00', durationMinutes: '90', program: [{ title: 'أ', minutes: 60 }, { title: 'ب' }], notify: {} });
  const sessions = build(w).content.sessions;
  assert.equal('program' in sessions.find(s => s.date === '2099-10-11'), false);
  assert.deepEqual(sessions.find(s => s.date === '2099-10-18').program, [
    { title: 'أ', start: '2099-10-18T19:00', end: '2099-10-18T20:00' },
    { title: 'ب', start: '2099-10-18T20:00', end: '2099-10-18T20:30' }
  ]);
  // a stage can start later than the meeting
  const later = plain(w.gs.resolveProgram_([{ title: 'أ', time: '20:15', minutes: '' }], '2099-10-11', '20:00', 120));
  assert.deepEqual(later.stages, [{ title: 'أ', start: '2099-10-11T20:15', end: '2099-10-11T22:00' }]);
  // unknown meeting length: the last stage's own minutes end it
  const open = plain(w.gs.resolveProgram_([{ title: 'أ', time: '', minutes: 50 }], '2099-10-11', '20:00', null));
  assert.equal(open.stages[0].end, '2099-10-11T20:50');
});

test('program: validation in the editor (named under the field) — order, inside the meeting, missing start, overlap', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  const save = program => { try { gs.apiSaveItem('sessions', { date: '2099-10-11', program, notify: {} }); return ''; } catch (e) { return e.message; } };

  assert.match(save([{ title: '', minutes: 10 }]), /^برنامج الاجتماع: الفقرة 1: الاسم مطلوب/m);
  assert.match(save([{ title: 'م'.repeat(41) }]), /برنامج الاجتماع: .*أطول من 40/);
  assert.match(save([{ title: 'أ', time: '٢٥:٠٠' }]), /الوقت لازم يكون/);
  assert.match(save([{ title: 'أ', minutes: 0 }]), /المدة لازم تكون عدد دقايق من 1/);
  assert.match(save([{ title: 'أ', time: '21:00' }, { title: 'ب', time: '20:30' }]), /مش بالترتيب: «ب» لازم تبدأ بعد «أ»/);
  assert.match(save([{ title: 'أ', time: '19:00' }]), /«أ» بتبدأ قبل ميعاد الاجتماع/);
  assert.match(save([{ title: 'أ', time: '22:30' }]), /«أ» بتبدأ بعد ما الاجتماع يخلص/);
  assert.match(save([{ title: 'أ' }, { title: 'ب' }]), /«ب» محتاجة وقت بداية، أو الفقرة اللي قبلها محتاجة مدة/);
  assert.match(save(Array.from({ length: 21 }, (_, i) => ({ title: 'ف' + i, minutes: 1 }))), /أقصى عدد فقرات 20/);
  assert.equal(session(w, '2099-10-11'), undefined, 'nothing saved');

  // an overlap is a warning: the stage ends when the next one starts
  assert.equal(save([{ title: 'أ', minutes: 60 }, { title: 'ب', time: '20:30' }]), '');
  const built = build(w);
  assert.deepEqual(built.errors, []);
  assert.ok(built.warnings.some(x => /«أ» مدتها بتدخل في «ب»/.test(x.message)));
  assert.equal(built.content.sessions[0].program[0].end, '2099-10-11T20:30');
});

test('program: kept by saves that don\'t send it; a hand-broken cell blocks publishing with a clear error; cancelled weeks publish none', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  gs.apiSaveItem('sessions', { date: '2099-10-11', topic: 'x', program: PROGRAM, notify: {} });
  // an older editor / the import: no program field
  gs.apiSaveItem('sessions', { originalDate: '2099-10-11', date: '2099-10-11', topic: 'y', notify: {} });
  assert.equal(JSON.parse(session(w, '2099-10-11').program).length, 4);
  // the weekly time moves: the stored program no longer fits → a publish error, named
  gs.apiSaveSettings({ 'meeting.time': '21:00' });
  assert.ok(build(w).errors.some(e => e.where === 'الاجتماعات: 2099-10-11' && /برنامج الاجتماع: «تسبحة» بتبدأ قبل ميعاد الاجتماع/.test(e.message)));
  gs.apiSaveSettings({ 'meeting.time': '20:00' });
  // a cell edited by hand into nonsense
  const sheet = w.spreadsheet.getSheetByName('Sessions');
  const col = sheet.data[0].indexOf('program');
  sheet.data[session(w, '2099-10-11').__row - 1][col] = '[{oops';
  assert.ok(build(w).errors.some(e => /البرنامج المتسجل مش مفهوم/.test(e.message)));
  // cancelled: no program, no error
  sheet.data[session(w, '2099-10-11').__row - 1][col] = JSON.stringify(PROGRAM);
  gs.apiSaveItem('sessions', { originalDate: '2099-10-11', date: '2099-10-11', status: 'cancelled', notify: {} });
  const built = build(w);
  assert.deepEqual(built.errors, []);
  assert.equal('program' in built.content.sessions[0], false);
});


/* =========================================================
   LIVE STAGE: live.json
========================================================= */

test('live stage: one commit with live.json only (never content.json), the agreed shape, back to automatic, logged', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  gs.apiSaveItem('sessions', { date: '2099-10-11', topic: 'x', program: PROGRAM, notify: {} });
  w.github.pushOther('content.json', '{"published":true}\n');
  const head = w.github.head;
  const before = { ...w.github.files() };

  const result = plain(gs.apiSetLiveStage('2099-10-11', 1));
  assert.match(result.commit, /^[0-9a-f]{40}$/);
  const files = w.github.files();
  const live = JSON.parse(files['live.json']);
  assert.deepEqual(Object.keys(live), ['schema', 'date', 'stage', 'updatedAt']);
  assert.deepEqual([live.schema, live.date, live.stage], [1, '2099-10-11', 1]);
  assert.match(live.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  // exactly one new commit, on top of the old head, changing live.json only
  const commit = w.github.commits.get(w.github.head);
  assert.deepEqual(commit.parents, [head]);
  assert.match(commit.message, /^Live stage 2099-10-11: stage 2$/);
  const { 'live.json': added, ...rest } = files;
  assert.deepEqual(rest, before, 'content.json and everything else untouched');
  const posted = w.github.requests.filter(r => r.method === 'post' && r.url.endsWith('/git/trees')).map(r => JSON.parse(r.payload).tree.map(e => e.path));
  assert.deepEqual(posted, [['live.json']]);

  // the panel knows the mode; the draft and the publish state are untouched
  const state = plain(gs.apiState());
  assert.deepEqual([state.live.date, state.live.stage], ['2099-10-11', 1]);
  assert.equal(w.properties.get('PUBLISHED_REVISION'), undefined);

  // automatic again
  plain(gs.apiSetLiveStage('2099-10-11', null));
  assert.equal(JSON.parse(w.github.files()['live.json']).stage, null);
  assert.equal(plain(gs.apiState()).live.stage, null);
  assert.equal(w.spreadsheet.getSheetByName('Log').data.filter(r => r[2] === 'live.stage').length, 2);
});

test('live stage: only a stage the meeting has; a bad date; admins only; through the API it needs the session', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  gs.apiSaveItem('sessions', { date: '2099-10-11', topic: 'x', program: PROGRAM, notify: {} });
  const head = w.github.head;
  assert.throws(() => gs.apiSetLiveStage('2099-10-11', 4), /الفقرة دي مش موجودة/);
  assert.throws(() => gs.apiSetLiveStage('2099-10-11', -1), /الفقرة دي مش موجودة/);
  assert.throws(() => gs.apiSetLiveStage('2099-10-11', 1.5), /الفقرة دي مش موجودة/);
  assert.throws(() => gs.apiSetLiveStage('2099-10-18', 0), /الفقرة دي مش موجودة/, 'no such meeting');
  assert.throws(() => gs.apiSetLiveStage('11/10/2099', null), /تاريخ الاجتماع مش صحيح/);
  w.as(STRANGER);
  assert.throws(() => w.gs.apiSetLiveStage('2099-10-11', 0), /مش مسموح/);
  assert.equal(w.github.head, head, 'nothing committed');

  const api = createWorld({ executeAs: 'USER_DEPLOYING' });
  api.as(ADMIN).gs.setup();
  api.properties.set('ADMIN_CLIENT_ID', CLIENT);
  api.as('');
  const token = api.issueToken({ email: ADMIN, aud: CLIENT });
  const reply = api.post({ fn: 'apiSetLiveStage', args: ['2099-10-11', null], token });
  assert.equal(reply.code, 'session_replaced');
  assert.equal(api.github.files()['live.json'], undefined);
});

test('live stage: a normal publish never writes live.json', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  gs.apiSaveItem('sessions', { date: '2099-10-11', topic: 'x', program: PROGRAM, notify: {} });
  const review = plain(gs.apiReview());
  gs.apiPublish(review.revision);
  assert.equal(w.github.files()['live.json'], undefined);
  assert.ok(JSON.parse(w.github.files()['content.json']).sessions[0].program.length === 4);
});


/* =========================================================
   «شكل الخلفية»
========================================================= */

test('surface: whitelist on save, published only when chosen, the phone one optional', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  const before = build(w).content.layout;
  assert.ok(before.every(s => !('surface' in s) && !('surfaceMobile' in s)), 'nothing chosen: nothing published');

  gs.apiSaveSection({ key: 'news', title: 'جديد الأسرة', surface: 'glass' });
  gs.apiSaveSection({ key: 'social', title: 'تابعنا', surface: 'dark', surfaceMobile: 'none' });
  gs.apiSaveSection({ key: 'contacts', title: 'تواصل', surface: 'filled', surfaceMobile: '' });
  const layout = build(w).content.layout;
  const of = key => { const s = layout.find(x => x.key === key); return [s.surface, s.surfaceMobile]; };
  assert.deepEqual(of('news'), ['glass', undefined]);
  assert.deepEqual(of('social'), ['dark', 'none']);
  assert.deepEqual(of('contacts'), ['filled', undefined]);
  assert.deepEqual(plain(gs.apiState()).layout.find(s => s.key === 'social').surfaceMobile, 'none');

  // not on the list: refused, named under its field
  assert.throws(() => gs.apiSaveSection({ key: 'news', title: 'x', surface: 'neon' }), /شكل الخلفية: الاختيار ده مش معروف/);
  assert.throws(() => gs.apiSaveSection({ key: 'news', title: 'x', surfaceMobile: '<b>' }), /على الموبايل: الاختيار ده مش معروف/);
  // a save that doesn't send it keeps it
  gs.apiSaveSection({ key: 'news', title: 'الأخبار' });
  assert.equal(plain(gs.readTable_('Sections')).find(s => s.key === 'news').surface, 'glass');
  // back to automatic
  gs.apiSaveSection({ key: 'news', title: 'الأخبار', surface: '' });
  assert.equal('surface' in build(w).content.layout.find(s => s.key === 'news'), false);
  // a value typed by hand into the Sheet is checked at publish
  const sheet = w.spreadsheet.getSheetByName('Sections');
  const row = plain(gs.readTable_('Sections')).find(s => s.key === 'social').__row;
  sheet.data[row - 1][sheet.data[0].indexOf('surface')] = 'sparkles';
  assert.ok(build(w).errors.some(e => /شكل الخلفية "sparkles" مش معروف/.test(e.message)));
});


/* =========================================================
   DATA UPGRADE v5 on a live-like schema-4 Sheet
========================================================= */

test('schema 4 -> 5: exactly the three new columns, a backup first, the page unchanged, idempotent', () => {
  const w = schema4World();
  const gs = w.as(ADMIN).gs;
  const plan = plain(gs.apiPlanMigration());
  assert.deepEqual([plan.current, plan.target, plan.pending], [4, 5, true]);
  assert.deepEqual(plan.steps.filter(s => s.needed).map(s => [s.id, s.detail]), [['columns', 'Sections: surface, surfaceMobile — Sessions: program']]);
  assert.deepEqual(Object.values(SCHEMA_5_COLUMNS).flat(), ['surface', 'surfaceMobile', 'program']);

  const tabs = Object.fromEntries(w.spreadsheet.getSheets().map(s => [s.name, s.data.map(line => line.slice())]));
  const page = plain(gs.buildDraft_()).content;
  const counts = plain(gs.tableCounts_(gs.spreadsheet_()));

  // before the upgrade: a program or a surface can't be saved (never dropped silently)
  assert.throws(() => gs.apiSaveItem('sessions', { date: '2099-10-25', program: [{ title: 'أ', minutes: 30 }], notify: {} }), /ترقية البيانات/);
  assert.throws(() => gs.apiSaveSection({ key: 'news', title: 'x', surface: 'glass' }), /ترقية البيانات/);
  assert.equal(session(w, '2099-10-25'), undefined);

  const report = plain(gs.apiMigrate()).report;
  assert.equal(report.changed, true);
  for (const name of ['Sections', 'Sessions', 'Links', 'Contacts']) {
    assert.ok(report.backups.some(b => new RegExp(`_backup_\\d{8}(-\\d+)?_${name}$`).test(b)), `${name} backed up`);
  }
  assert.equal(w.properties.get('DATA_SCHEMA'), '5');
  assert.deepEqual(plain(gs.tableCounts_(gs.spreadsheet_())), counts, 'no row added or lost');
  assert.deepEqual(plain(gs.buildDraft_()).content, page, 'visitors see exactly the same page');

  // every old cell in its place; the new columns at the end, empty
  for (const name of ['Sections', 'Sessions', 'Contacts', 'Links']) {
    const now = w.spreadsheet.getSheetByName(name).data;
    tabs[name].forEach((line, r) => line.forEach((value, c) => assert.deepEqual(now[r][c], value, `${name} ${r + 1}:${c + 1}`)));
  }
  const sections = w.spreadsheet.getSheetByName('Sections').data[0];
  assert.deepEqual(sections.slice(-2), ['surface', 'surfaceMobile']);
  assert.equal(w.spreadsheet.getSheetByName('Sessions').data[0].at(-1), 'program');

  // again: nothing
  const after = snapshot(w);
  assert.equal(plain(gs.apiMigrate()).report.changed, false);
  assert.equal(snapshot(w), after);
  assert.equal(plain(gs.apiPlanMigration()).pending, false);

  // and now both save
  gs.apiSaveItem('sessions', { date: '2099-10-25', program: [{ title: 'أ', minutes: 30 }], notify: {} });
  gs.apiSaveSection({ key: 'news', title: 'جديد الأسرة', surface: 'glass' });
  assert.deepEqual(build(w).errors, []);
});


/* =========================================================
   SIGN-IN: a reload while the session was starting
========================================================= */

test('a reload mid sign-in (the session never drew its panel) is not "another device"; a drawn one, or another device, is asked', () => {
  const w = createWorld({ executeAs: 'USER_DEPLOYING' });
  w.as(ADMIN).gs.setup();
  w.properties.set('ADMIN_CLIENT_ID', CLIENT);
  w.as('');
  const PHONE = 'موبايل أندرويد – Chrome';
  const start = (device, tab) => w.post({ fn: 'apiSessionStart', args: [{ device, tab, state: false }], token: w.issueToken({ email: ADMIN, aud: CLIENT }) });

  const first = start(PHONE, 'tab-aaaaaaaaaaaaaaaaaaaa');
  assert.ok(first.result.sid);
  // the phone reloads before the panel showed: a new page load, same phone
  const reloaded = start(PHONE, 'tab-bbbbbbbbbbbbbbbbbbbb');
  assert.ok(reloaded.result.sid, 'no question');
  // another device while that one is still unconfirmed: asked
  assert.ok(start('كمبيوتر ويندوز – Chrome', 'tab-cccccccccccccccccccc').result.active);
  // once its panel is drawn (a heartbeat), even the same kind of phone is asked
  const token = w.issueToken({ email: ADMIN, aud: CLIENT });
  assert.equal(w.post({ fn: 'apiHeartbeat', args: [{ area: 'home' }], token, sid: reloaded.result.sid }).ok, true);
  assert.ok(start(PHONE, 'tab-dddddddddddddddddddd').result.active);
  // the replaced page load is out
  assert.equal(w.post({ fn: 'apiState', args: [], token, sid: first.result.sid }).code, 'session_replaced');
});
