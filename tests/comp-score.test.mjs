// Competitions scoring (apps-script/CompScore.gs), pure: Arabic
// normalization, every question type, fallback / manual review, scoring
// off, the browser's answers checked, manual marks and regrading.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGs } from '../tools/lib/gs.mjs';

const gs = loadGs(['Platforms.gs', 'Content.gs', 'Hub.gs', 'CompModel.gs', 'CompScore.gs']);
const plain = value => JSON.parse(JSON.stringify(value));

const def = (questions, extra = {}) => ({ scoring: true, questions, ...extra });
const Q = {
  single: { id: 'q-00000001', type: 'single', choices: [{ id: 'c-aaaaaa', text: 'نوح' }, { id: 'c-bbbbbb', text: 'موسى' }], correct: 'c-aaaaaa', points: 10, required: true, review: 'auto' },
  multi: { id: 'q-00000002', type: 'multi', choices: [{ id: 'c-aaaaaa', text: 'متى' }, { id: 'c-bbbbbb', text: 'مرقس' }, { id: 'c-cccccc', text: 'أعمال' }], correct: ['c-aaaaaa', 'c-bbbbbb'], points: 10, required: true, review: 'auto' },
  tf: { id: 'q-00000003', type: 'truefalse', choices: [], correct: 't', points: 5, required: true, review: 'auto' },
  short: { id: 'q-00000004', type: 'short', choices: [], correct: ['سفر التكوين', 'التكوين'], points: 5, required: true, review: 'auto' },
  number: { id: 'q-00000005', type: 'number', choices: [], correct: '27', points: 5, required: true, review: 'auto' },
  long: { id: 'q-00000006', type: 'long', choices: [], correct: null, points: 10, required: false, review: 'manual' },
  info: { id: 'q-00000007', type: 'info', choices: [], correct: null, points: 0, required: false, review: 'auto' }
};
const all = Object.values(Q);
const ids = all.map(q => q.id);


/* ---------------- normalization ---------------- */

test('normalize: tashkeel, tatweel, bidi marks, hamza forms, ة/ه, ى/ي, ؤ, ئ, digits, case, spaces', () => {
  const n = gs.compNormalizeText_;
  assert.equal(n('  سِفْرُ   التَّكْوِينِ '), 'سفر التكوين');
  assert.equal(n('التكـــوين'), 'التكوين');
  assert.equal(n('‏سفر‎ ؜التكوين‫'), 'سفر التكوين');
  assert.equal(n('أحمد إبراهيم آدم ٱلله'), 'احمد ابراهيم ادم الله');
  assert.equal(n('مدرسة'), n('مدرسه'));
  assert.equal(n('موسى'), n('موسي'));
  assert.equal(n('مؤمن'), 'مومن');
  assert.equal(n('بريئة'), 'برييه');
  assert.equal(n('٢٧ و ۳۵'), '27 و 35');
  assert.equal(n('Genesis  BOOK'), 'genesis book');
  assert.equal(n('ٰالرحمٰن'), 'الرحمن');
  // NFC: a decomposed alef + madda is the composed آ, then ا
  assert.equal(n('آدم'), n('آدم'));
  assert.equal(n(null), '');
  assert.equal(n(undefined), '');
});

test('numbers: Arabic / Persian digits, Arabic decimal mark, a single comma; nothing else', () => {
  const num = gs.compNumber_;
  assert.equal(num('٢٧'), 27);
  assert.equal(num(' ۳۵ '), 35);
  assert.equal(num('٣٫٥'), 3.5);
  assert.equal(num('3,5'), 3.5);
  assert.equal(num('-4'), -4);
  assert.equal(num(12), 12);
  for (const bad of ['', 'abc', '1e5', '0x10', '1,000,000', '12 سنة', NaN, Infinity, null, {}, '1.2.3']) assert.equal(num(bad), null, String(bad));
  assert.equal(gs.compNumberText_('٠٢٧'), '27');
});


/* ---------------- grading ---------------- */

test('grade: every type right → full marks; status graded only when nothing is pending', () => {
  const answers = { [Q.single.id]: 'c-aaaaaa', [Q.multi.id]: ['c-bbbbbb', 'c-aaaaaa'], [Q.tf.id]: 't', [Q.short.id]: '  سِفْر التكوين ', [Q.number.id]: '٢٧' };
  const graded = plain(gs.compGrade_(def(all.filter(q => q.type !== 'long')), answers, { at: '2026-10-11 20:00' }));
  assert.equal(graded.score, 35);
  assert.equal(graded.maxScore, 35);
  assert.equal(graded.correctCount, 5);
  assert.equal(graded.gradableCount, 5);
  assert.equal(graded.pendingCount, 0);
  assert.equal(graded.status, 'graded');
  assert.deepEqual(graded.grading[Q.single.id], { ok: true, pts: 10, by: 'auto', at: '2026-10-11 20:00' });
  assert.equal(graded.grading[Q.info.id], undefined, 'info is never graded');
});

test('grade: wrong, partial multi, unanswered = 0 (ok false); long answered = pending', () => {
  const answers = { [Q.single.id]: 'c-bbbbbb', [Q.multi.id]: ['c-aaaaaa'], [Q.tf.id]: 'f', [Q.short.id]: 'الخروج', [Q.number.id]: '28', [Q.long.id]: 'تأمل' };
  const graded = plain(gs.compGrade_(def(all), answers));
  assert.equal(graded.score, 0);
  assert.equal(graded.maxScore, 45);
  assert.equal(graded.pendingCount, 1);
  assert.equal(graded.status, 'pending_review');
  assert.equal(graded.grading[Q.long.id].ok, null);
  assert.equal(graded.grading[Q.multi.id].ok, false, 'a multi answer must be the exact set');
  const empty = plain(gs.compGrade_(def(all), {}));
  assert.equal(empty.grading[Q.long.id].ok, false, 'an unanswered long question is not pending');
  assert.equal(empty.status, 'graded');
  assert.equal(empty.score, 0);
});

test('short answers: fallback → no match is pending; manual → always pending; auto → wrong', () => {
  const fallback = { ...Q.short, review: 'fallback' };
  const manual = { ...Q.short, review: 'manual' };
  assert.equal(gs.compGrade_(def([fallback]), { [Q.short.id]: 'تكوين' }).grading[Q.short.id].ok, null);
  assert.equal(gs.compGrade_(def([fallback]), { [Q.short.id]: 'التكوين' }).grading[Q.short.id].ok, true);
  assert.equal(gs.compGrade_(def([manual]), { [Q.short.id]: 'التكوين' }).grading[Q.short.id].ok, null);
  assert.equal(gs.compGrade_(def([Q.short]), { [Q.short.id]: 'تكوين' }).grading[Q.short.id].ok, false);
  // an empty accepted list never matches an empty string
  assert.equal(gs.compGrade_(def([{ ...Q.short, correct: [] }]), { [Q.short.id]: ' ' }).grading[Q.short.id].ok, false);
});

test('scoring off: every question ok null, 0 points, status submitted', () => {
  const graded = plain(gs.compGrade_(def(all, { scoring: false }), { [Q.single.id]: 'c-aaaaaa' }));
  assert.equal(graded.status, 'submitted');
  assert.equal(graded.score, 0);
  assert.equal(graded.maxScore, 0);
  assert.ok(Object.values(graded.grading).every(g => g.ok === null && g.pts === 0));
});

test('qids: only the served questions count', () => {
  const graded = gs.compGrade_(def(all), { [Q.single.id]: 'c-aaaaaa' }, { qids: [Q.single.id, Q.tf.id] });
  assert.equal(graded.maxScore, 15);
  assert.deepEqual(Object.keys(graded.grading).sort(), [Q.single.id, Q.tf.id].sort());
});


/* ---------------- manual marks, regrade ---------------- */

test('manual: true / false / points / null; totals and status follow', () => {
  const first = gs.compGrade_(def(all), { [Q.long.id]: 'تأمل', [Q.single.id]: 'c-aaaaaa' });
  assert.equal(first.status, 'pending_review');
  const marked = plain(gs.compApplyManual_(first.grading, Q.long.id, 7, 'menazakmena@gmail.com', def(all), '2026-10-12 10:00'));
  assert.deepEqual(marked.grading[Q.long.id], { ok: true, pts: 7, by: 'menazakmena@gmail.com', at: '2026-10-12 10:00' });
  assert.equal(marked.score, 17);
  assert.equal(marked.status, 'graded');
  assert.equal(gs.compApplyManual_(first.grading, Q.long.id, true, 'a', def(all)).grading[Q.long.id].pts, 10);
  assert.equal(gs.compApplyManual_(first.grading, Q.long.id, 99, 'a', def(all)).grading[Q.long.id].pts, 10, 'capped at the question\'s points');
  assert.equal(gs.compApplyManual_(first.grading, Q.long.id, false, 'a', def(all)).grading[Q.long.id].ok, false);
  assert.equal(gs.compApplyManual_(marked.grading, Q.long.id, null, 'a', def(all)).status, 'pending_review', 'null = back to pending');
  assert.equal(gs.compApplyManual_(first.grading, Q.info.id, 1, 'a', def(all)), null, 'info can\'t be graded');
  assert.equal(gs.compApplyManual_(first.grading, 'q-99999999', 1, 'a', def(all)), null);
  assert.equal(gs.compApplyManual_(first.grading, Q.long.id, 1, 'a', def(all, { scoring: false })), null);
});

test('regrade: a new key changes automatic marks; a reviewer\'s marks are kept', () => {
  const answers = { [Q.single.id]: 'c-bbbbbb', [Q.short.id]: 'تكوين' };
  const first = gs.compGrade_(def([Q.single, { ...Q.short, review: 'fallback' }]), answers, { qids: [Q.single.id, Q.short.id] });
  const marked = gs.compApplyManual_(first.grading, Q.short.id, 5, 'admin@x.com', def([Q.single, { ...Q.short, review: 'fallback' }]));
  assert.equal(marked.score, 5);
  const newKey = def([{ ...Q.single, correct: 'c-bbbbbb' }, { ...Q.short, correct: ['الخروج'], review: 'fallback' }]);
  const again = plain(gs.compRegrade_(newKey, answers, marked.grading, [Q.single.id, Q.short.id], 'now'));
  assert.equal(again.grading[Q.single.id].ok, true, 'automatic mark follows the new key');
  assert.equal(again.grading[Q.short.id].by, 'admin@x.com', 'the reviewer\'s mark stays');
  assert.equal(again.score, 15);
  assert.equal(again.status, 'graded');
});


/* ---------------- the browser's answers ---------------- */

test('answers: clean values; unknown qids, foreign choices, wrong types, long text, required → problems', () => {
  const d = def(all);
  const ok = plain(gs.compValidateAnswers_(d, ids, {
    [Q.single.id]: 'c-aaaaaa', [Q.multi.id]: ['c-bbbbbb', 'c-aaaaaa'], [Q.tf.id]: 'f', [Q.short.id]: '  سفر\nالتكوين ', [Q.number.id]: ' ٢٧ ', [Q.long.id]: 'سطر\r\nتاني'
  }));
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.answers[Q.multi.id], ['c-aaaaaa', 'c-bbbbbb'], 'in the question\'s order');
  assert.equal(ok.answers[Q.short.id], 'سفر التكوين');
  assert.equal(ok.answers[Q.number.id], '27');
  assert.equal(ok.answers[Q.long.id], 'سطر\nتاني');

  const problems = (answers, qids = ids) => plain(gs.compValidateAnswers_(d, qids, answers)).problems.map(p => p.qid + ' ' + p.message);
  const base = { [Q.single.id]: 'c-aaaaaa', [Q.multi.id]: ['c-aaaaaa'], [Q.tf.id]: 't', [Q.short.id]: 'x', [Q.number.id]: '1' };
  assert.deepEqual(problems(base), []);
  assert.match(problems({ ...base, 'q-12345678': 'x' })[0], /q-12345678 السؤال ده مش من المسابقة/);
  assert.match(problems({ ...base, [Q.single.id]: 'c-zzzzzz' })[0], /مش من اختيارات/);
  assert.match(problems({ ...base, [Q.multi.id]: ['c-aaaaaa', 'c-aaaaaa'] })[0], /متكرر/);
  assert.match(problems({ ...base, [Q.multi.id]: 'c-aaaaaa' })[0], /مش مفهومة/);
  assert.match(problems({ ...base, [Q.tf.id]: true })[0], /صح أو غلط/);
  assert.match(problems({ ...base, [Q.short.id]: 'x'.repeat(201) })[0], /أطول من 200/);
  assert.match(problems({ ...base, [Q.long.id]: 'x'.repeat(3001) })[0], /أطول من 3000/);
  assert.match(problems({ ...base, [Q.number.id]: 'كتير' })[0], /الرقم مش مفهوم/);
  assert.match(problems({ ...base, [Q.single.id]: '' })[0], /إجباري/);
  assert.match(problems({ ...base, [Q.short.id]: '   ' })[0], /إجباري/);
  assert.deepEqual(problems({ ...base, [Q.long.id]: '' }), [], 'an optional question may stay empty');
  assert.match(problems([1, 2])[0], /مش مفهومة/);
  assert.match(problems(base, [Q.single.id])[0], /مش من المسابقة/, 'a question that was not served is unknown');
  // score-like keys are just unknown keys: nothing reads them
  assert.ok(problems({ ...base, score: 100 }).some(p => p.startsWith('score ')));
});

test('answer keys for grouping: normalized text, canonical number, sorted sets', () => {
  assert.equal(gs.compAnswerKey_(Q.short, ' سِفر  التكوين'), 'سفر التكوين');
  assert.equal(gs.compAnswerKey_(Q.number, '٠٢٧'), '27');
  assert.equal(gs.compAnswerKey_(Q.multi, ['c-bbbbbb', 'c-aaaaaa']), 'c-aaaaaa,c-bbbbbb');
  assert.equal(gs.compAnswerKey_(Q.long, ''), '');
});
