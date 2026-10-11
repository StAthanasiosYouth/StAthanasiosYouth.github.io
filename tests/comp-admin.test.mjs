// Competitions, the admin side (CompAdmin.gs and its hooks into the rest of
// the panel): the spreadsheet, the builder and questions, the import, the
// preview, review queue / manual grading / regrade / void, results and
// export, the Activity log, the linked card, bell targets, media usage,
// module switches, locks — and apiState staying fast.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compWorld, adminApi, pub, clientKey, publish, scoredComp, webp, plain, ADMIN, SECOND } from './fakes/comp.mjs';

const phone = n => '0101234' + String(n).padStart(4, '0');

function setup(overrides = {}) {
  const world = compWorld();
  const call = adminApi(world);
  const made = scoredComp(call, overrides);
  return { world, call, ...made };
}

function play(world, n, answer, slug = 'bible-quiz') {
  const key = clientKey();
  const s = pub(world, 'compStart', { slug, clientKey: key, fields: { name: 'مشترك ' + n, phone: phone(n) } });
  assert.equal(s.ok, true, JSON.stringify(s));
  const answers = {};
  for (const q of s.questions) {
    const pick = text => q.choices.find(c => c.text === text).id;
    if (q.type === 'single') answers[q.id] = pick(answer.single || 'نوح');
    if (q.type === 'multi') answers[q.id] = [pick('متى'), pick('مرقس')];
    if (q.type === 'truefalse') answers[q.id] = 't';
    if (q.type === 'short') answers[q.id] = answer.short || 'التكوين';
    if (q.type === 'number') answers[q.id] = '27';
    if (q.type === 'long' && answer.long !== undefined) answers[q.id] = answer.long;
  }
  const done = pub(world, 'compSubmit', { token: s.attempt.token, clientKey: key, answers });
  assert.equal(done.ok, true, JSON.stringify(done));
  return { id: s.attempt.id, receipt: done.receipt, result: done.result };
}

const activityRows = world => {
  const sheet = world.spreadsheet.getSheetByName('Activity');
  return sheet ? sheet.data.slice(1).filter(r => r[0]) : [];
};


/* ---------------- the spreadsheet ---------------- */

test('the competitions spreadsheet: made by the first admin write only (private, its own tabs, text columns)', () => {
  const world = compWorld();
  const call = adminApi(world);
  const list = call('apiComps');
  assert.equal(list.ready, false);
  assert.equal(world.properties.get('COMP_SHEET_ID'), undefined, 'reading creates nothing');
  assert.deepEqual(list.presets.map(p => p.key), ['survey', 'scored'], 'presets that need a switched-off module are hidden');
  assert.throws(() => call('apiCompCreate', { preset: 'coded', title: 'x' }), /محتاج جزء لسه مش متفعّل/);

  call('apiCompCreate', { preset: 'survey', title: 'أول مسابقة' });
  const ss = world.compSpreadsheet;
  assert.ok(ss, 'created');
  assert.notEqual(ss.getId(), world.spreadsheet.getId(), 'separate from the content Sheet');
  assert.equal(ss.getName(), 'Athanasios — Competitions (private)');
  assert.deepEqual(ss.getSheets().map(s => s.name), ['Competitions', 'Questions', 'Snapshots', 'Submissions']);
  assert.equal(world.properties.get('COMP_SCHEMA'), '1');
  assert.ok(world.properties.get('COMP_SECRET'), 'the token secret exists before any public call');
  assert.deepEqual(plain(ss.getSheetByName('Questions').data[0]), plain(world.gs.COMP_TABLES.Questions));
  assert.ok(!world.spreadsheet.getSheetByName('Competitions'), 'nothing in the content Sheet');
});

test('missing columns are appended on the right (never moved); written text is formula-safe', () => {
  const { world, call, id } = setup();
  const sheet = world.compSpreadsheet.getSheetByName('Competitions');
  // an older sheet without the last column
  const col = sheet.data[0].indexOf('updatedAt');
  sheet.data.forEach(line => line.splice(col, 1));
  world.gs.COMP_TABS_ = {};
  call('apiCompSave', id, { description: '=IMPORTXML("http://evil")' });
  assert.equal(sheet.data[0][sheet.data[0].length - 1], 'updatedAt', 'appended at the end');
  const row = sheet.data.find(r => r[0] === id);
  assert.equal(row[sheet.data[0].indexOf('description')], '\'=IMPORTXML("http://evil")');
  assert.equal(call('apiComp', id).comp.description, '=IMPORTXML("http://evil")', 'read back without the apostrophe');
});


/* ---------------- builder ---------------- */

test('builder: list summary, save (merge), slug locked after publish, duplicate, archive, delete only without submissions', () => {
  const { world, call, id } = setup();
  let list = call('apiComps');
  assert.equal(list.ready, true);
  const summary = list.comps[0];
  assert.equal(summary.questionCount, 6);
  assert.equal(summary.status, 'draft');
  assert.equal(summary.hasChanges, true);
  assert.equal(summary.url, 'https://stathanasiosyouth.github.io/competition/bible-quiz/');

  const saved = call('apiCompSave', id, { shortTitle: 'الكتاب' });
  assert.equal(saved.comp.shortTitle, 'الكتاب');
  assert.equal(saved.comp.title, 'مسابقة الكتاب المقدس', 'fields left out keep their value');
  assert.throws(() => call('apiCompSave', id, { attempts: 99 }), /عدد المحاولات/);

  publish(world, call);
  list = call('apiComps');
  assert.equal(list.comps[0].status, 'open');
  assert.equal(list.comps[0].hasChanges, false);
  assert.throws(() => call('apiCompSave', id, { slug: 'new-slug' }), /بعد أول نشر/);

  const copy = call('apiCompDuplicate', id);
  assert.notEqual(copy.id, id);
  assert.match(copy.comp.comp.slug, /^bible-quiz-[0-9a-f]{4}$/);
  assert.equal(copy.comp.comp.enabled, false);
  assert.equal(copy.comp.comp.liveVersion, '');
  assert.equal(copy.comp.questions.length, 7);
  assert.notEqual(copy.comp.questions[0].id, call('apiComp', id).questions[0].id);

  play(world, 1, {});
  assert.throws(() => call('apiCompDelete', id), /عليها مشاركات/);
  assert.equal(call('apiCompDelete', copy.id).deleted, true);
  assert.throws(() => call('apiComp', copy.id), /مش موجودة/);
  assert.equal(world.compSpreadsheet.getSheetByName('Questions').data.slice(1).filter(r => r[1] === copy.id).length, 0, 'its questions too');

  const archived = call('apiCompArchive', id, true);
  assert.equal(archived.summary.status, 'archived');
  assert.ok(call('apiReview').changes.includes('مسابقة هتختفي: مسابقة الكتاب المقدس'));
});

test('edit lock comp:<id>: another admin editing the builder blocks saves and question changes', () => {
  const { world, call, id, questions } = setup();
  const second = adminApi(world, SECOND);
  second('apiHeartbeat', { locks: ['comp:' + id] });
  for (const run of [() => call('apiCompSave', id, { title: 'x' }), () => call('apiCompQuestionDelete', id, questions.tf.id), () => call('apiCompQuestionsReorder', id, [])]) {
    assert.throws(run, error => error.code === 'locked' && /بيعدّل ده دلوقتي/.test(error.message));
  }
});

test('questions: edit keeps ids, duplicate lands right after, delete, reorder (exactly the competition\'s ids)', () => {
  const { call, id, questions } = setup();
  const edited = call('apiCompQuestionSave', id, { ...questions.single, text: 'مين اللي بنى الفلك؟', choices: questions.single.choices.map(c => ({ ...c, correct: c.text === 'نوح' })) }).question;
  assert.equal(edited.id, questions.single.id);
  assert.deepEqual(edited.choices.map(c => c.id), questions.single.choices.map(c => c.id));
  assert.equal(edited.correct, questions.single.correct);

  const dup = call('apiCompQuestionDuplicate', id, questions.single.id);
  const order = dup.questions.map(q => q.id);
  assert.equal(order[order.indexOf(questions.single.id) + 1], dup.question.id);
  assert.deepEqual(dup.questions.map(q => q.order), dup.questions.map((q, i) => (i + 1) * 10));

  assert.equal(call('apiCompQuestionDelete', id, dup.question.id).count, 7);
  const ids = call('apiComp', id).questions.map(q => q.id);
  const reversed = ids.slice().reverse();
  assert.deepEqual(call('apiCompQuestionsReorder', id, reversed).questions.map(q => q.id), reversed);
  assert.throws(() => call('apiCompQuestionsReorder', id, reversed.slice(1)), /اتغيرت/);
  assert.throws(() => call('apiCompQuestionsReorder', id, ['nope']), /الترتيب مش مفهوم/);
  assert.throws(() => call('apiCompQuestionSave', id, { type: 'single', text: '' }), /نص السؤال مطلوب/);
  // a half-done question saves, with a warning
  const half = call('apiCompQuestionSave', id, { type: 'single', text: 'لسه', choices: ['أ', 'ب'] });
  assert.ok(half.warnings.some(w => /مفيش إجابة صحيحة/.test(w)));
  assert.ok(call('apiComp', id).problems.some(p => /مفيش إجابة صحيحة/.test(p)));
});


/* ---------------- import ---------------- */

test('import: English headers too, warnings (no accepted answers, 0 points, duplicates), a changed row is skipped, limits', () => {
  const { world, call, id } = setup();
  const text = [
    'order\tquestion\ttype\tchoice1\tchoice2\tcorrect\tpoints\trequired\treview\timage',
    '5\tمين بنى الفلك؟\tsingle\tنوح\tموسى\tنوح\t\tyes\t\t',
    '\tسؤال مفتوح\tshort\t\t\t\t0\tno\tauto\t',
    '\tسؤال يدوي\tshort\t\t\t\t\t\tيدوي\t',
    '\tبصورة\tlong\t\t\t\t\t\t\timg-zzzzzzzz',
    '\tرقم\tnumber\t\t\t٣٫٥\t\t\t\t'
  ].join('\n');
  const preview = call('apiCompImportPreview', id, text);
  assert.deepEqual(preview.counts, { ok: 4, error: 1, warnings: 2 });
  const [dupRow, openRow, manualRow, imageRow, numberRow] = preview.rows;
  assert.ok(dupRow.warnings.some(w => /متكرر/.test(w)), 'already in the competition');
  assert.equal(dupRow.question.correct, 'نوح');
  assert.ok(openRow.warnings.some(w => /كل الإجابات هتتحسب غلط/.test(w)));
  assert.ok(openRow.warnings.some(w => /الدرجة صفر/.test(w)));
  assert.deepEqual(manualRow.warnings, []);
  assert.equal(manualRow.question.review, 'manual');
  assert.match(imageRow.errors[0], /^صف ٥، صورة: «img-zzzzzzzz» مش موجودة في المكتبة/);
  assert.equal(numberRow.question.correct, '3.5');

  // a row edited after the preview (another fingerprint) is not taken
  const changed = text.replace('سؤال يدوي', 'سؤال يدوي اتغير');
  const decisions = Object.fromEntries(preview.rows.filter(r => r.status === 'ok').map(r => ['r' + r.line, 'add:' + r.fp]));
  const applied = call('apiCompImportApply', id, changed, decisions);
  assert.equal(applied.added, 3);
  assert.equal(applied.skipped, 1);
  assert.ok(applied.rows.some(r => r.result === 'skipped' && /اتغير من بعد المعاينة/.test(r.reason)));
  const questions = call('apiComp', id).questions;
  assert.equal(questions.length, 10);
  assert.equal(questions.find(q => q.text === 'مين بنى الفلك؟' && q.order === 5).points, 100, 'empty points = 100');
  assert.ok(activityRows(world).some(r => r[5] === 'import' && r[6] === 'competition' && /استورد ٣ سؤال/.test(r[9])));

  assert.match(call('apiCompImportPreview', id, 'x\ty\n1\t2').problems[0], /«السؤال»/);
  const many = ['السؤال\tالنوع'].concat(Array.from({ length: 301 }, (_, i) => `سؤال ${i}\tإجابة قصيرة`)).join('\n');
  assert.match(call('apiCompImportPreview', id, many).problems[0], /الحد ٣٠٠/);
  assert.match(call('apiCompImportPreview', id, 'السؤال\n' + 'x'.repeat(410 * 1024)).problems[0], /كبير قوي/);
  // the competition's own limit: 300 questions
  const room = ['السؤال\tالنوع'].concat(Array.from({ length: 295 }, (_, i) => `زيادة ${i}\tإجابة قصيرة`)).join('\n');
  const full = call('apiCompImportPreview', id, room);
  assert.equal(full.counts.ok, 290);
  assert.match(full.rows[290].errors[0], /هتعدّي ٣٠٠ سؤال/);
});


/* ---------------- preview ---------------- */

test('preview: the draft definition without keys; grading against the draft key writes nothing', () => {
  const { world, call, id, questions } = setup();
  const def = call('apiCompPreviewDefinition', id);
  assert.equal(def.questions.length, 7);
  assert.ok(!JSON.stringify(def).includes('"correct"'));
  assert.equal(def.comp.slug, 'bible-quiz');
  const before = JSON.stringify(world.compSpreadsheet.getSheets().map(s => s.data));
  const graded = call('apiCompPreviewGrade', id, { [questions.single.id]: questions.single.correct, [questions.tf.id]: 'f' });
  assert.equal(graded.score, 10);
  assert.ok(graded.problems.some(p => /إجباري/.test(p.message)), 'required answers reported, still graded');
  assert.equal(graded.review.find(r => r.id === questions.tf.id).correct, 't');
  assert.equal(JSON.stringify(world.compSpreadsheet.getSheets().map(s => s.data)), before, 'nothing written');
});


/* ---------------- review queue, grading, regrade, void ---------------- */

test('review: pending answers grouped by the same normalized answer; group mark, single mark; status follows', () => {
  const { world, call, id, questions } = setup({ answersShow: 'never' });
  publish(world, call);
  const a = play(world, 1, { long: 'أَحبُّ الله' });
  const b = play(world, 2, { long: 'احب   الله' });
  const c = play(world, 3, { long: 'شيء تاني' });
  assert.equal(a.result.status, 'pending_review');

  const queue = call('apiCompReviewQueue', id);
  assert.equal(queue.total, 3);
  assert.equal(queue.questions[0].qid, questions.long.id);
  assert.match(queue.questions[0].number, /^س\d|^س[٠-٩]/);
  assert.deepEqual(queue.groups.map(g => g.count), [2, 1]);
  const group = queue.groups[0];
  assert.deepEqual(group.ids.sort(), [a.id, b.id].sort());

  const after = call('apiCompGradeGroup', id, questions.long.id, group.key, 8);
  assert.equal(after.updated, 2);
  assert.equal(after.queue.total, 1);
  assert.equal(pub(world, 'compResult', { receipt: a.receipt }).result.status, 'graded');
  assert.equal(pub(world, 'compResult', { receipt: a.receipt }).result.score, 43);

  const one = call('apiCompGrade', c.id, { [questions.long.id]: false });
  assert.equal(one.submission.status, 'graded');
  assert.equal(one.questions.find(q => q.id === questions.long.id).grade.by, ADMIN);
  assert.equal(call('apiCompReviewQueue', id).total, 0);
  assert.throws(() => call('apiCompGrade', c.id, { 'q-12345678': 1 }), /مش مفهوم/);
  assert.throws(() => call('apiCompGrade', c.id, { [questions.long.id]: 'كتير' }), /مش مفهوم/);

  // the log: one merged row per admin + competition, counts only
  const reviews = activityRows(world).filter(r => r[5] === 'review');
  assert.equal(reviews.length, 1, 'merged within 10 minutes');
  assert.match(reviews[0][9], /^راجع ٣ إجابة/);
});

test('regrade: after a new key is published, automatic marks follow it; manual marks stay; only changed rows written', () => {
  const { world, call, id, questions } = setup({ answersShow: 'never' });
  call('apiCompQuestionSave', id, { ...questions.short, review: 'fallback', correct: ['التكوين'] });
  publish(world, call);
  const right = play(world, 1, { short: 'التكوين' });
  const fallback = play(world, 2, { short: 'تكوين' });
  const wrong = play(world, 3, { single: 'موسى' });
  assert.equal(fallback.result.status, 'pending_review');
  call('apiCompGrade', fallback.id, { [questions.short.id]: true });

  // the key changes: «موسى» is now right; the short answer takes only «سفر التكوين»
  const single = call('apiComp', id).questions.find(q => q.id === questions.single.id);
  call('apiCompQuestionSave', id, { ...single, choices: single.choices.map(c => ({ ...c, correct: c.text === 'موسى' })) });
  call('apiCompQuestionSave', id, { ...questions.short, review: 'fallback', correct: ['سفر التكوين'] });
  assert.throws(() => call('apiCompRegrade', 'cmp-00000000'), /مش موجودة/);
  publish(world, call);
  const report = call('apiCompRegrade', id);
  assert.equal(report.regraded, 3);
  assert.equal(report.changed, 3);
  const detail = id2 => call('apiCompSubmission', id2);
  assert.equal(detail(wrong.id).submission.score, 30, '«موسى» is right now (its short answer waits for a reviewer now)');
  assert.equal(detail(right.id).questions.find(q => q.id === questions.short.id).grade.ok, null, 'no longer matches: pending (fallback)');
  assert.equal(detail(fallback.id).questions.find(q => q.id === questions.short.id).grade.by, ADMIN, 'the reviewer\'s mark is kept');
  assert.equal(call('apiCompRegrade', id).changed, 0, 'running it again changes nothing');
  assert.ok(activityRows(world).some(r => r[5] === 'regrade' && /صحّح المسابقة «مسابقة الكتاب المقدس» تاني/.test(r[9])));
});

test('void: the submission stops counting and comes back with its status; the public result says void', () => {
  const { world, call, questions } = setup();
  publish(world, call);
  const a = play(world, 1, { long: 'x' });
  const voided = call('apiCompVoid', a.id, true);
  assert.equal(voided.submission.status, 'void');
  assert.deepEqual(plain(pub(world, 'compResult', { receipt: a.receipt }).result), { status: 'void', submittedAt: a.result.submittedAt });
  assert.equal(call('apiCompResults', voided.comp.id).ranking.length, 0);
  assert.equal(play(world, 1, {}).result.status, 'graded', 'a void attempt does not use up the person\'s attempt');
  assert.equal(call('apiCompVoid', a.id, false).submission.status, 'pending_review');
  assert.equal(questions.long.review, 'manual');
});

test('live writes: only from /admin/ (the recovery admin runs as another user lock); busy lock → a clear error', () => {
  const { world, call, id } = setup();
  publish(world, call);
  const a = play(world, 1, { long: 'x' });
  world.as(ADMIN);
  assert.throws(() => world.gs.apiCompVoid(a.id, true), /لوحة التحكم الرسمية/);
  world.as('');
  world.userLock.busy = true;
  assert.throws(() => call('apiCompRegrade', id), /ضغط/);
  const key = clientKey();
  assert.equal(pub(world, 'compStart', { slug: 'bible-quiz', clientKey: key, fields: { name: 'x', phone: phone(5) } }).code, 'busy');
  world.userLock.busy = false;
  // a publish holds the SCRIPT lock: the public keeps working
  world.scriptLock.busy = true;
  assert.equal(pub(world, 'compStart', { slug: 'bible-quiz', clientKey: key, fields: { name: 'x', phone: phone(5) } }).ok, true);
  world.scriptLock.busy = false;
});


/* ---------------- submissions, results, export ---------------- */

test('submissions list: server-side status / search / sort / paging; detail = the served version', () => {
  const { world, call, id } = setup();
  publish(world, call);
  play(world, 1, {});
  play(world, 2, { single: 'موسى' });
  play(world, 3, { long: 'x' });
  pub(world, 'compStart', { slug: 'bible-quiz', clientKey: clientKey(), fields: { name: 'لسه بيحل', phone: phone(4) } });

  const all = call('apiCompSubmissions', id, {});
  assert.equal(all.total, 4);
  assert.deepEqual(plain(all.counts), { all: 4, done: 3, in_progress: 1, submitted: 0, pending_review: 1, graded: 2, void: 0 });
  assert.equal(call('apiCompSubmissions', id, { status: 'in_progress' }).items[0].name, 'لسه بيحل');
  assert.equal(call('apiCompSubmissions', id, { q: 'مُشترك ٢' }).total, 1, 'Arabic digits and marks typed in the search still match');
  assert.equal(call('apiCompSubmissions', id, { q: 'مشترك 2' }).total, 1);
  assert.equal(call('apiCompSubmissions', id, { q: phone(3) }).total, 1, 'by phone (with the leading 0)');
  const byScore = call('apiCompSubmissions', id, { status: 'done', sort: 'score', dir: 'asc' }).items.map(i => i.score);
  assert.deepEqual(byScore, byScore.slice().sort((x, y) => x - y));
  const page = call('apiCompSubmissions', id, { limit: 2, offset: 2 });
  assert.equal(page.items.length, 2);
  assert.equal(page.total, 4);

  // the question changes after these were sent: the detail still shows what they saw
  const first = all.items.find(i => i.status !== 'in_progress');
  const comp = call('apiComp', id);
  const single = comp.questions.find(q => q.type === 'single');
  call('apiCompQuestionSave', id, { ...single, text: 'نص جديد', choices: single.choices.map(c => ({ ...c, correct: c.id === single.correct })) });
  publish(world, call);
  const detail = call('apiCompSubmission', first.id);
  assert.equal(detail.latest, false);
  assert.equal(detail.questions.find(q => q.type === 'single').text, 'مين بنى الفلك؟');
  assert.ok(detail.questions.find(q => q.type === 'single').answerText);
});

test('results: best attempt per person, ranking (score desc, duration asc, sent first) with ties; per-question stats; export rows', () => {
  const { world, call, id } = setup({ attempts: 2 });
  publish(world, call);
  play(world, 1, { single: 'موسى' });
  play(world, 1, {});
  play(world, 2, {});
  play(world, 3, { single: 'موسى' });
  const results = call('apiCompResults', id);
  assert.equal(results.stats.submissions, 4);
  assert.equal(results.stats.participants, 3);
  assert.equal(results.ranking[0].attempts + results.ranking[1].attempts + results.ranking[2].attempts, 4);
  assert.deepEqual(results.ranking.map(r => r.score), [35, 35, 25]);
  assert.equal(results.ranking[0].rank, 1);
  assert.equal(results.ranking[1].rank, results.ranking[0].durationSec === results.ranking[1].durationSec ? 1 : 2, 'ties share a rank');
  assert.equal(results.ranking[2].rank, 3);
  const singleStat = results.questions.find(q => q.type === 'single');
  assert.equal(singleStat.answered, 4);
  assert.equal(singleStat.correct, 2);
  assert.equal(singleStat.rate, 50);
  assert.deepEqual(singleStat.choices.map(c => c.count), [2, 2, 0]);
  assert.equal(results.stats.maxScore, 45);

  const exported = call('apiCompExport', id);
  assert.equal(exported.filename, 'bible-quiz-results.xlsx');
  assert.equal(exported.rows.length, 4);
  assert.equal(exported.header.length, exported.rows[0].length);
  assert.ok(exported.header.includes('الموبايل'));
  assert.ok(exported.header.some(h => /^س١: /.test(h)));
  assert.ok(exported.rows.some(r => r.includes('نوح')), 'answers as the choice text');
});


/* ---------------- the Activity log ---------------- */

test('activity: competition rows with Arabic summaries; never a phone, an answer or a code in them', () => {
  const { world, call, id } = setup();
  publish(world, call);
  const a = play(world, 1, { long: 'إجابة سرية جدا' });
  call('apiCompGrade', a.id, { [call('apiComp', id).questions.find(q => q.type === 'long').id]: 5 });
  call('apiCompClose', id);
  call('apiCompFinalize', id, true);
  call('apiCompVoid', a.id, true);
  const rows = activityRows(world).filter(r => r[6] === 'competition');
  const summaries = rows.map(r => r[9]);
  for (const want of [/^أضاف مسابقة جديدة «مسابقة الكتاب المقدس»$/,/^راجع ١ إجابة في المسابقة/, /^قفل المسابقة/, /^اعتمد نتايج المسابقة/, /^لغى مشاركة في المسابقة/]) {
    assert.ok(summaries.some(s => want.test(s)), `${want} in ${summaries.join(' | ')}`);
  }
  const all = JSON.stringify(activityRows(world));
  for (const secret of [phone(1), '+20101234', 'إجابة سرية', 'مشترك 1', 'التكوين']) assert.ok(!all.includes(secret), secret);
  assert.ok(world.gs.activitySummary_({ action: 'settings', type: 'competition', title: 'المسابقات' }).includes('المسابقات'));
});


/* ---------------- card, bell, push, media, settings ---------------- */

test('card: «اعرض كارت» makes a competition card (type seeded if missing); it follows the competition at publish; other cards unchanged', () => {
  const { world, call, id } = setup({ endAt: '2030-01-01 20:00' });
  // the competition type was removed by hand: it comes back from the seed
  world.gs.deleteRow_('Types', 'key', 'competition');
  const saved = call('apiCompSave', id, { card: true });
  const cardId = saved.comp.cardId;
  assert.match(cardId, /^act-[0-9a-f]{8}$/);
  assert.equal(saved.card.enabled, true);
  const row = world.gs.readTable_('Activities').find(r => r.id === cardId);
  assert.equal(row.competition, id);
  assert.equal(row.type, 'competition');
  assert.ok(world.gs.readTable_('Types').some(t => t.key === 'competition'));
  // an ordinary card with an outside link
  call('apiSaveItem', 'activities', { type: 'trip', title: 'رحلة', url: 'https://forms.gle/x', notify: {} });

  call('apiCompSave', id, { title: 'مسابقة الميلاد' });
  publish(world, call);
  const content = JSON.parse(world.github.files()['content.json']);
  const card = content.activities.find(a => a.id === cardId);
  assert.equal(card.competition, 'bible-quiz');
  assert.equal(card.title, 'مسابقة الميلاد', 'the title follows the competition');
  assert.equal(card.cta, null, 'the page makes the button');
  assert.equal(card.endAt, '2030-01-01T20:00');
  const trip = content.activities.find(a => a.title === 'رحلة');
  assert.equal(trip.competition, undefined);
  assert.equal(trip.cta.url, 'https://forms.gle/x');

  // hidden with its competition
  call('apiCompSave', id, { enabled: false });
  const review = call('apiReview');
  assert.ok(review.warnings.some(w => /المسابقة المربوطة بالكارت ده مش في النشر ده/.test(w.message)));
  assert.ok(review.changes.some(c => /كارت مسابقة هيختفي/.test(c)));
  call('apiCompSave', id, { enabled: true, card: false });
  assert.equal(world.gs.readTable_('Activities').find(r => r.id === cardId).enabled, false);
});

test('bell: target competition:<slug> → { kind: competition, slug }; push opens /competition/<slug>/; unknown slugs refused', () => {
  const { world, call } = setup();
  assert.throws(() => call('apiSaveItem', 'notifications', { title: 'x', target: 'competition:nope-nope' }), /مسابقة مش موجودة/);
  call('apiSaveItem', 'notifications', { title: 'المسابقة فتحت', type: 'competition', target: 'competition:bible-quiz' });
  publish(world, call);
  const content = JSON.parse(world.github.files()['content.json']);
  const item = content.notifications.find(n => n.title === 'المسابقة فتحت');
  assert.deepEqual(item.target, { kind: 'competition', slug: 'bible-quiz' });
  assert.equal(world.gs.pushUrl_(item.target), '/competition/bible-quiz/');
  assert.equal(world.gs.pushUrl_({ kind: 'competition', slug: '../evil' }), '/#notifications');
  assert.equal(world.gs.pushItemState_(content, item, world.gs.cairoNow_()), 'live');
  assert.equal(world.gs.pushItemState_({ ...content, competitions: [] }, item, world.gs.cairoNow_()), 'hidden');
});

test('media: banner and question pictures are «used» in the library, go out with the publish, and show in compStart', () => {
  const world = compWorld();
  const call = adminApi(world);
  const banner = call('apiUploadMedia', { full: webp(11).toString('base64'), thumb: webp(11).toString('base64'), mime: 'image/webp', width: 1200, height: 630, alt: 'بانر' }).media;
  const pic = call('apiUploadMedia', { full: webp(12).toString('base64'), thumb: webp(12).toString('base64'), mime: 'image/webp', width: 800, height: 800, alt: 'صورة' }).media;
  const { comp } = call('apiCompCreate', { preset: 'scored', title: 'بالصور', slug: 'pics', banner: banner.id, enabled: true });
  call('apiCompQuestionSave', comp.id, { type: 'truefalse', text: 'ده نوح؟', media: pic.id, correct: 't' });
  const usage = call('apiMediaLibrary').usage;
  assert.ok(usage[banner.id].some(u => u.area === 'competitions' && u.key === comp.id));
  assert.ok(usage[pic.id].some(u => u.area === 'competitions'));
  publish(world, call);
  const files = world.github.files();
  assert.ok(files[banner.path] && files[pic.path], 'both pictures in the commit');
  assert.match(files['competition/pics/index.html'], new RegExp(banner.path.replace(/\./g, '\\.')));
  const s = pub(world, 'compStart', { slug: 'pics', clientKey: clientKey(), fields: { name: 'x', phone: phone(1) } });
  assert.equal(s.questions[0].media.src, pic.path);
  assert.throws(() => call('apiCompSave', comp.id, { icon: 'img-zzzzzzzz' }), /الأيقونة: الصورة مش موجودة/);
});

test('module switches: refused until the module is installed; each needs the one before; logged', () => {
  const world = compWorld();
  const call = adminApi(world);
  // as if the registry's code were not installed (CompRegistry.gs defines compRegistryReady_)
  const installed = world.gs.compRegistryReady_;
  world.gs.compRegistryReady_ = undefined;
  assert.throws(() => call('apiCompSettings', { registry: true }), /لسه مش متركب/);
  world.gs.compRegistryReady_ = installed;
  world.gs.compRegistryReady_ = () => true;
  assert.deepEqual(plain(call('apiCompSettings', { registry: true }).modules), { registry: true, wallet: false, shop: false });
  assert.equal(world.properties.get('COMP_REGISTRY'), '1');
  assert.ok(call('apiComps').presets.some(p => p.key === 'coded'), 'the coded preset shows now');
  world.gs.compWalletReady_ = () => true;
  call('apiCompSettings', { wallet: true });
  assert.deepEqual(plain(call('apiCompSettings', { registry: false }).modules), { registry: false, wallet: false, shop: false }, 'the wallet goes with the registry');
  assert.ok(activityRows(world).some(r => r[5] === 'settings' && r[6] === 'competition'));
});


/* ---------------- the rest of the panel stays as it was ---------------- */

test('apiState: works with competitions; a warm cache reads nothing from the competitions spreadsheet', () => {
  const { world, call } = setup();
  publish(world, call);
  const first = call('apiState');
  assert.equal(first.status.hasChanges, false, 'the competitions part of the revision is stable after a publish');
  assert.ok(!JSON.stringify(first).includes('"correct"'), 'no key in the panel state');
  const stats = world.compSpreadsheet.stats;
  const read = stats.cellsRead;
  const again = call('apiState');
  assert.equal(stats.cellsRead, read, 'no competitions cells read');
  assert.equal(again.status.draftRevision, first.status.draftRevision);
  // a draft write drops the cache: the next state reads the two tabs once
  const id = call('apiComps').comps[0].id;
  call('apiCompSave', id, { shortTitle: 'جديد' });
  const before = stats.cellsRead;
  const changed = call('apiState');
  assert.ok(stats.cellsRead > before);
  assert.equal(changed.status.hasChanges, true);
});

test('the content Sheet\'s own tables are untouched by competitions (only the lazy Activities column)', () => {
  const { world, call, id } = setup();
  call('apiCompSave', id, { card: true });
  const header = world.spreadsheet.getSheetByName('Activities').data[0];
  assert.ok(header.includes('competition'));
  assert.equal(call('apiPlanMigration').pending, false, 'no data upgrade wanted');
});
