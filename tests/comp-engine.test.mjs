// The competition engine's pure parts (assets/js/comp/flow.js, save.js,
// api.js) and the main site's competition hooks (content.js, router.js,
// items.js, bell.js, sw.js). Browser behaviour: tests/comp-public.e2e.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// icons.js builds a <template> at import time
globalThis.document = { createElement: () => ({ content: {} }) };

const F = await import('../assets/js/comp/flow.js');
const { createSave, memoryStorage, cleanRecord, storageKey } = await import('../assets/js/comp/save.js');
const { sanitizeContent } = await import('../assets/js/content.js');
const { pageForHash, parseHash } = await import('../assets/js/router.js');
const { competitionHref } = await import('../assets/js/items.js');
const { competitionPage } = await import('../assets/js/bell.js');

const ROOT = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, ROOT), 'utf8');
const DEF = JSON.parse(read('tests/fixtures/comp/quiz.json'));
const QS = JSON.parse(read('tests/fixtures/comp/quiz.questions.json'));
const IMG = { src: 'media/2026/img-ab12cd34.webp', thumb: 'media/2026/img-ab12cd34-480.webp', w: 1200, h: 900, alt: 'x' };


/* =========================================================
   SLUGS AND URLS
========================================================= */

test('slug: <html data-slug> first, else ?s=, only [a-z0-9-]{2,40}', () => {
  assert.equal(F.slugFrom({ dataSlug: 'quiz-2026', search: '?s=other' }), 'quiz-2026');
  assert.equal(F.slugFrom({ dataSlug: '', search: '?s=other' }), 'other');
  assert.equal(F.slugFrom({ dataSlug: 'Bad Slug', search: '?s=other' }), '', 'a broken stub never falls back to the query');
  for (const bad of ['?s=a', '?s=../x', '?s=ABC', `?s=${'a'.repeat(41)}`, '?s=a%2Fb', '', '?preview']) assert.equal(F.slugFrom({ search: bad }), '', bad);
  assert.equal(F.compJsonPath('quiz'), 'competition/quiz/comp.json');
  assert.equal(F.compJsonPath('quiz', 'a1b2c3'), 'competition/quiz/comp.json?v=a1b2c3');
  assert.equal(F.compJsonPath('quiz', 'x y'), 'competition/quiz/comp.json');
  assert.equal(F.compJsonPath('../x'), '');
  assert.equal(F.compPagePath('quiz'), 'competition/quiz/');
});

/* =========================================================
   PUBLISHED FILES
========================================================= */

test('comp.json: sanitized like content.json; withdrawn; nothing private kept', () => {
  const def = F.sanitizeDefinition(DEF);
  assert.equal(def.slug, 'quiz');
  assert.equal(def.scoring, true);
  assert.equal(def.showPoints, true);
  assert.equal(def.wallet, false);
  assert.equal(def.layout, 'paged');
  assert.equal(def.theme, 'azure');
  assert.equal(def.banner.src, 'media/2026/img-592fd134.webp');
  assert.equal(def.questions, undefined, 'comp.json has no questions');

  assert.deepEqual(F.sanitizeDefinition({ schema: 1, slug: 'old', withdrawn: true }), { withdrawn: true, slug: 'old' });
  assert.equal(F.sanitizeDefinition(null), null);
  assert.equal(F.sanitizeDefinition({ slug: 'x1' }), null, 'no title');

  const odd = F.sanitizeDefinition({ ...DEF, theme: 'pink', layout: 'grid', attempts: 99, timeLimit: -3, resultShow: 'all', banner: { ...IMG, src: 'https://evil.example/x.webp' }, startAt: '2026-10-11 20:00', endAt: 'tomorrow', fields: 'x' });
  assert.equal(odd.theme, '');
  assert.equal(odd.layout, 'paged');
  assert.equal(odd.attempts, 1);
  assert.equal(odd.timeLimit, 0);
  assert.equal(odd.resultShow, 'none');
  assert.equal(odd.banner, null);
  assert.equal(odd.startAt, '2026-10-11T20:00', 'the Sheet form is accepted');
  assert.equal(odd.endAt, '');
  assert.equal(F.sanitizeDefinition({ ...DEF, scoring: true, showPoints: 1 }).showPoints, true, 'booleans or "1"');
});

test('questions: public shape only; broken ones dropped; preview drafts strip the key', () => {
  const qs = F.cleanQuestions(QS);
  assert.equal(qs.length, 7);
  for (const q of qs) {
    assert.deepEqual(Object.keys(q).sort(), ['choices', 'help', 'id', 'media', 'points', 'required', 'text', 'type']);
  }
  assert.equal(qs.find(q => q.type === 'info').required, false);
  assert.deepEqual(qs.find(q => q.type === 'truefalse').choices, []);
  assert.equal(F.cleanQuestion({ id: 'q1', type: 'single', text: 'x', choices: [{ id: 'c1', text: 'a' }] }), null, 'one choice is not a question');
  assert.equal(F.cleanQuestion({ id: 'q1', type: 'essay', text: 'x' }), null);
  assert.equal(F.cleanQuestion({ id: '<x>', type: 'short', text: 'x' }), null);
  assert.equal(F.cleanQuestion({ id: 'q1', type: 'short', text: 'x', media: { ...IMG, src: '/etc/passwd' } }).media, null);
  assert.equal(F.cleanQuestions([...QS, QS[0]]).length, 7, 'duplicate ids dropped');
  const preview = F.sanitizeDefinition({ ...DEF, questions: QS }, { withQuestions: true });
  assert.equal(preview.questions.length, 7);
  assert.equal(preview.questionCount, 6);
  assert.equal(preview.totalPoints, 50);
  assert.ok(!JSON.stringify(preview).includes('c-aaaa02"') || !JSON.stringify(preview.questions).includes('correct'), 'no answer key');
  assert.ok(!JSON.stringify(preview.questions).includes('explanation'));
});

test('result: only well-shaped fields; review rows cleaned', () => {
  const r = F.sanitizeResult({ status: 'graded', submittedAt: '2026-10-11T20:00', score: 7, maxScore: '10', pointsAwarded: NaN, resultsAt: '2026-10-12 18:00', review: [{ id: 'q1', type: 'single', text: 'س', choices: [{ id: 'c1', text: 'أ' }], answer: 'c1', correct: 'c1', ok: true, pts: 5 }, { type: 'bogus' }], secret: 1 });
  assert.equal(r.score, 7);
  assert.equal(r.maxScore, undefined);
  assert.equal(r.pointsAwarded, undefined);
  assert.equal(r.resultsAt, '2026-10-12T18:00');
  assert.equal(r.review.length, 1);
  assert.equal(r.secret, undefined);
  assert.equal(F.sanitizeResult({ status: 'hacked' }).status, 'submitted');
  assert.equal(F.sanitizeResult(null), null);
});


/* =========================================================
   PHASE AND STEPS
========================================================= */

test('phase by Cairo wall time', () => {
  const def = F.sanitizeDefinition({ ...DEF, startAt: '2026-10-11T18:00', endAt: '2026-10-12T18:00', resultsAt: '2026-10-13T18:00' });
  assert.equal(F.compPhase(def, '2026-10-11T17:59'), 'scheduled');
  assert.equal(F.compPhase(def, '2026-10-11T18:00'), 'open');
  assert.equal(F.compPhase(def, '2026-10-12T18:00'), 'open', 'endAt inclusive');
  assert.equal(F.compPhase(def, '2026-10-12T18:01'), 'closed');
  assert.equal(F.compPhase(def, '2026-10-13T18:00'), 'results');
  assert.equal(F.compPhase({ ...def, resultShow: 'none' }, '2026-10-14T18:00'), 'closed');
  assert.equal(F.compPhase({ withdrawn: true }, '2026-10-11T18:00'), 'withdrawn');
  assert.equal(F.compPhase(F.sanitizeDefinition(DEF), '2030-01-01T00:00'), 'open', 'no dates = open');
});

test('step machine: intro → the account → start → questions → review → submit → result', () => {
  const def = F.sanitizeDefinition(DEF);
  const ctx = { def, layout: 'paged', count: 3 };
  const t = (state, event, c = ctx) => F.transition(state, event, c);

  assert.deepEqual(F.firstStep(def, 'open'), { name: 'intro' });
  assert.deepEqual(F.firstStep(def, 'results'), { name: 'closed' });
  assert.deepEqual(t({ name: 'intro' }, { type: 'begin' }), { name: 'entering' });
  assert.deepEqual(t({ name: 'entering' }, { type: 'entered', participant: { name: 'م' } }), { name: 'starting', participant: { name: 'م' } });
  assert.deepEqual(t({ name: 'intro' }, { type: 'entered' }), { name: 'intro' }, 'only while entering');

  assert.deepEqual(t({ name: 'starting' }, { type: 'started' }), { name: 'question', index: 0 });
  assert.deepEqual(t({ name: 'starting' }, { type: 'started' }, { ...ctx, layout: 'single' }), { name: 'single' });
  assert.deepEqual(t({ name: 'starting' }, { type: 'started', step: 'q:2' }), { name: 'question', index: 2 }, 'restored step');
  assert.deepEqual(t({ name: 'starting' }, { type: 'started', step: 'q:9' }), { name: 'question', index: 0 }, 'out of range');

  assert.deepEqual(t({ name: 'question', index: 0 }, { type: 'next' }), { name: 'question', index: 1 });
  assert.deepEqual(t({ name: 'question', index: 2 }, { type: 'next' }), { name: 'review' });
  assert.deepEqual(t({ name: 'question', index: 0 }, { type: 'prev' }), { name: 'question', index: 0 });
  assert.deepEqual(t({ name: 'review' }, { type: 'prev' }), { name: 'question', index: 2 });
  assert.deepEqual(t({ name: 'review' }, { type: 'jump', index: 1 }), { name: 'question', index: 1 });
  assert.deepEqual(t({ name: 'review' }, { type: 'jump', index: 7 }), { name: 'review' });
  assert.deepEqual(t({ name: 'review' }, { type: 'jump', index: 1 }, { ...ctx, layout: 'single' }), { name: 'single', focus: 1 });

  assert.deepEqual(t({ name: 'review' }, { type: 'submit' }), { name: 'submitting' });
  assert.deepEqual(t({ name: 'question', index: 0 }, { type: 'submit' }), { name: 'question', index: 0 }, 'submit only from review');
  assert.deepEqual(t({ name: 'submitting' }, { type: 'offline' }), { name: 'queued', timeUp: undefined });
  assert.equal(t({ name: 'queued' }, { type: 'online' }).name, 'submitting');
  assert.deepEqual(t({ name: 'question', index: 1 }, { type: 'time-up' }), { name: 'submitting', timeUp: true });
  assert.deepEqual(t({ name: 'submitting' }, { type: 'submitted' }), { name: 'result' });
  assert.deepEqual(t({ name: 'result' }, { type: 'again' }), { name: 'intro' });

  // failures go somewhere sensible
  assert.equal(t({ name: 'starting' }, { type: 'start-failed', code: 'closed' }).name, 'closed');
  assert.equal(t({ name: 'starting' }, { type: 'start-failed', code: 'not_open' }).name, 'scheduled');
  assert.deepEqual(t({ name: 'starting' }, { type: 'start-failed', code: 'session', message: 'م' }), { name: 'entering', error: 'م' });
  assert.deepEqual(t({ name: 'starting' }, { type: 'start-failed', code: 'limit', message: 'م' }), { name: 'intro', error: 'م' }, 'a refusal stays on the intro: asking again would only go round');
  assert.deepEqual(t({ name: 'submitting' }, { type: 'submit-failed', code: 'invalid', index: 1, message: 'م' }), { name: 'question', index: 1, error: 'م' });
  assert.equal(t({ name: 'submitting' }, { type: 'submit-failed', code: 'expired' }).name, 'error');
  assert.equal(t({ name: 'submitting' }, { type: 'submit-failed', code: 'limit', message: 'م' }).name, 'review');
  assert.equal(F.stepKey({ name: 'question', index: 4 }), 'q:4');
  assert.equal(F.stepKey({ name: 'intro' }), '');
});


/* =========================================================
   FORM AND ANSWERS
========================================================= */

test('answers: answered / errors / payload in the contract shapes (§5.2)', () => {
  const qs = F.cleanQuestions(QS);
  const by = id => qs.find(q => q.id === id);
  assert.equal(F.isAnswered(by('q-multi002'), []), false);
  assert.equal(F.isAnswered(by('q-short005'), '   '), false);
  assert.equal(F.isAnswered(by('q-info0004'), 'x'), false);
  assert.equal(F.answerError(by('q-single01'), 'c-zzz'), 'اختار إجابة من الاختيارات');
  assert.equal(F.answerError(by('q-multi002'), ['c-bbbb01', 'c-bbbb01']), 'اختار من الاختيارات بس');
  assert.equal(F.answerError(by('q-tf000003'), 'yes'), 'اختار صح أو غلط');
  assert.equal(F.answerError(by('q-number06'), 'أربعين'), 'اكتب رقم بس (من غير حروف)');
  assert.equal(F.answerError(by('q-number06'), '٤٠'), '');
  assert.equal(F.answerError(by('q-number06'), '12٫5'), '');
  assert.equal(F.normalizeNumber('١٢٫٥'), '12.5');
  assert.equal(F.answerError(by('q-short005'), 'x'.repeat(201)), 'الإجابة أطول من ٢٠٠ حرف');

  const answers = { 'q-single01': 'c-aaaa02', 'q-multi002': ['c-bbbb02', 'c-bbbb01'], 'q-tf000003': 'f', 'q-info0004': 'x', 'q-short005': ' يقطينة ', 'q-number06': 'oops', 'q-long0007': '' };
  assert.deepEqual(F.answersPayload(qs, answers), { 'q-single01': 'c-aaaa02', 'q-multi002': ['c-bbbb01', 'c-bbbb02'], 'q-tf000003': 'f', 'q-short005': 'يقطينة' });
  assert.deepEqual(F.progress(qs, answers), { answered: 5, total: 6 }, 'a typed (even invalid) number counts as answered; review points at it');
  assert.deepEqual(F.unanswered(qs, { 'q-single01': 'c-aaaa02' }).map(u => [u.index, u.required]), [[1, true], [2, true], [4, true], [5, true], [6, false]]);
  assert.deepEqual(F.missingRequired(qs, answers), []);
  assert.deepEqual(F.invalidAnswers(qs, answers).map(x => x.id), ['q-number06']);
  assert.deepEqual(F.cleanSavedAnswers(qs, { 'q-single01': 5, 'q-multi002': ['c-bbbb01', 'evil'], ghost: 'x', 'q-short005': 'ي' }), { 'q-multi002': ['c-bbbb01'], 'q-short005': 'ي' });
});


/* =========================================================
   RESULT WORDING (decided from what the server sent)
========================================================= */

test('result: only the simple final result; the review list only when sent', () => {
  // the counts of right answers are never spelled out (only the score)
  let s = F.resultSummary({ status: 'graded', score: 8, maxScore: 10, correctCount: 8, gradableCount: 10 }, { successText: '' });
  assert.equal(s.headline, 'مبروك!');
  assert.deepEqual(s.lines.map(l => l.text), ['جبت ٨ من ١٠']);
  assert.equal(s.review, null);

  s = F.resultSummary({ status: 'graded', pointsAwarded: 700 }, { successText: 'شكرًا!' });
  assert.equal(s.headline, 'شكرًا!');
  assert.deepEqual(s.lines.map(l => l.text), ['جمعت ٧٠٠ نقطة']);

  // both
  s = F.resultSummary({ status: 'graded', score: 8, maxScore: 10, pointsAwarded: 800 }, {});
  assert.deepEqual(s.lines.map(l => [l.kind, l.text]), [['score', 'جبت ٨ من ١٠'], ['points', 'جمعت ٨٠٠ نقطة']]);
  // nothing to show: the plain thanks; zero points: no points line
  assert.equal(F.resultSummary({ status: 'submitted' }, {}).headline, 'إجاباتك وصلت ✓ شكرًا لمشاركتك');
  assert.deepEqual(F.resultSummary({ status: 'graded', pointsAwarded: 0 }, {}).lines, []);

  s = F.resultSummary({ status: 'pending_review', score: 5, maxScore: 10, pending: 2 }, {});
  assert.ok(s.lines.some(l => l.kind === 'pending' && l.text.startsWith('فيه إجابات بتتراجع')));

  s = F.resultSummary({ status: 'submitted', resultsAt: '2026-10-11T20:00', answersAt: '2026-10-12T20:00' }, {});
  assert.deepEqual(s.lines.map(l => l.text), ['النتيجة هتظهر الأحد ١١ أكتوبر الساعة ٨ بالليل', 'الإجابات الصحيحة هتظهر الإتنين ١٢ أكتوبر الساعة ٨ بالليل']);

  s = F.resultSummary({ status: 'graded', review: [{ id: 'q', type: 'single', text: 'x', choices: [], answer: null, correct: null, ok: false, pts: 0 }] }, {});
  assert.equal(s.review.length, 1);
  assert.equal(F.resultSummary({ status: 'void' }, {}).headline, 'المشاركة دي اتلغت');
  assert.equal(F.countPoints(1), 'نقطة واحدة');
  assert.equal(F.countPoints(5), '٥ نقط');
  assert.equal(F.countQuestions(2), 'سؤالين');
  assert.equal(F.countQuestions(20), '٢٠ سؤال');
  assert.equal(F.formatClock(65000), '٠١:٠٥');
  assert.equal(F.formatClock(3725000), '١:٠٢:٠٥');
  assert.equal(F.formatClock(-5), '٠٠:٠٠');
  const item = { type: 'multi', choices: [{ id: 'a', text: 'أ' }, { id: 'b', text: 'ب' }] };
  assert.equal(F.answerText(item, ['a', 'b']), 'أ، ب');
  assert.equal(F.answerText({ type: 'truefalse', choices: [] }, 'f'), 'غلط');
  assert.equal(F.answerText({ type: 'short', choices: [] }, ['يقطينة', 'اليقطينة']), 'يقطينة / اليقطينة');
});

test('retry timing: jittered exponential backoff, capped', () => {
  assert.equal(F.retryDelay(0, () => 0.5), 800);
  assert.equal(F.retryDelay(2, () => 0.5), 3200);
  assert.equal(F.retryDelay(10, () => 0.5), 15000);
  assert.equal(F.retryDelay(1, () => 0), 800);
  assert.equal(F.retryDelay(1, () => 0.999), 2398);
  assert.ok(F.RETRYABLE.has('busy') && F.RETRYABLE.has('network') && !F.RETRYABLE.has('invalid'));
});


/* =========================================================
   AUTOSAVE (§13)
========================================================= */

test('autosave: written on every change, restored, cleared except the receipt; storage failures are harmless', () => {
  const storage = memoryStorage();
  let clock = 1000;
  const save = createSave('quiz', storage, () => clock);
  const questions = F.cleanQuestions(QS);
  save.write({ clientKey: '0f8fad5b-d9cb-469f-a165-70867728950e', token: 'at1.x.y', questions, answers: { 'q-single01': 'c-aaaa02' }, step: 'q:1', fields: { name: 'م', phone: '01012345678', evil: 'x' } });
  clock = 2000;
  save.write({ answers: { 'q-single01': 'c-aaaa02', 'q-tf000003': 't' } });
  const back = createSave('quiz', storage).read();
  assert.equal(back.token, 'at1.x.y');
  assert.equal(back.step, 'q:1');
  assert.equal(back.at, 2000);
  assert.deepEqual(back.answers, { 'q-single01': 'c-aaaa02', 'q-tf000003': 't' });
  assert.equal(back.questions.length, 7);
  assert.ok(storage.getItem(storageKey('quiz')).includes('"clientKey"'));

  save.afterSubmit('rc1.abc.sig', '2026-10-11T20:00');
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem('athanasios.comp.v1:quiz'))).sort(), ['at', 'receipt', 'submittedAt']);
  const after = createSave('quiz', storage).read();
  assert.equal(after.receipt, 'rc1.abc.sig');
  assert.equal(after.token, '');
  assert.deepEqual(after.answers, {});

  // tampered / broken records
  assert.equal(cleanRecord({ token: 'at1', questions: [] }).token, '', 'no questions: no attempt to resume');
  assert.equal(cleanRecord({ clientKey: '<script>' }).clientKey, '');
  storage.setItem('athanasios.comp.v1:quiz', '{not json');
  assert.equal(createSave('quiz', storage).read(), null);

  // a storage that throws everywhere
  const hostile = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('x'); } };
  const h = createSave('quiz', hostile);
  assert.equal(h.read(), null);
  assert.equal(h.write({ answers: {} }), false);
  h.clear();
  assert.equal(createSave('quiz', () => { throw new Error('SecurityError'); }).write({}), false);
  assert.equal(createSave('BAD SLUG', storage).write({ token: 'x' }), false, 'no key without a valid slug');
});


/* =========================================================
   TRANSPORT
========================================================= */

function fakeFetch(replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status ? next.status < 400 : true, status: next.status || 200, json: async () => next.body };
  };
  fn.calls = calls;
  return fn;
}

/* =========================================================
   MAIN SITE HOOKS
========================================================= */

const seed = JSON.parse(read('content.json'));

test('content.js: competitions index, activity competition slug, competition notification target', () => {
  const c = sanitizeContent({
    ...seed,
    types: [{ key: 'competition', label: 'مسابقة' }],
    activities: [
      { id: 'a1', type: 'competition', section: 'competitions', title: 'م', competition: 'quiz-1' },
      { id: 'a2', type: 'competition', section: 'competitions', title: 'م', competition: '../evil' },
      { id: 'a3', type: 'competition', section: 'competitions', title: 'م' }
    ],
    notifications: [
      { id: 'n1', title: 'x', publishAt: '2026-10-11T10:00', type: 'competition', target: { kind: 'competition', slug: 'quiz-1' } },
      { id: 'n2', title: 'x', publishAt: '2026-10-11T10:00', target: { kind: 'competition', slug: 'Quiz 1' } },
      { id: 'n3', title: 'x', publishAt: '2026-10-11T10:00', target: { kind: 'competition', id: 'quiz-2' } }
    ],
    competitions: [
      { id: 'cmp-1', slug: 'quiz-1', title: 'مسابقة', shortTitle: 'م', startAt: '2026-10-11T10:00', endAt: 'soon', v: 'abc123', answers: 'secret' },
      { id: 'cmp-2', slug: 'quiz-1', title: 'تكرار' },
      { id: 'cmp-3', slug: 'BAD', title: 'x' },
      { id: 'cmp-4', slug: 'no-title' }
    ]
  });
  assert.deepEqual(c.activities.map(a => a.competition), ['quiz-1', '', '']);
  assert.deepEqual(c.notifications.map(n => n.target), [{ kind: 'competition', slug: 'quiz-1' }, null, { kind: 'competition', slug: 'quiz-2' }]);
  assert.deepEqual(c.competitions, [{ id: 'cmp-1', slug: 'quiz-1', title: 'مسابقة', shortTitle: 'م', startAt: '2026-10-11T10:00', endAt: '', v: 'abc123' }]);
  assert.deepEqual(sanitizeContent(seed).competitions, [], 'older content: no competitions');
});

test('router: #competition/<slug> and #points are other pages; sheets unchanged', () => {
  assert.equal(pageForHash('#competition/quiz-1'), 'competition/quiz-1/');
  assert.equal(pageForHash('#competition/quiz-1/'), 'competition/quiz-1/');
  assert.equal(pageForHash('#points'), 'points/');
  for (const bad of ['#competition/', '#competition/Quiz', '#competition/../x', '#competition/a', '#competition/x?y', '#pointsx', '#news/1', '']) assert.equal(pageForHash(bad), '', bad);
  assert.equal(parseHash('#competition/quiz'), null, 'not a sheet');
  assert.deepEqual(parseHash('#activity/act-1'), { name: 'activity', id: 'act-1' });
});

test('items.js / bell.js: competition links are same-tab pages relative to the site root', () => {
  assert.equal(competitionHref({ competition: 'quiz-1' }), 'competition/quiz-1/');
  assert.equal(competitionHref({ competition: 'https://evil.example' }), '');
  assert.equal(competitionHref({}), '');
  assert.equal(competitionPage('quiz-1'), 'competition/quiz-1/');
  assert.equal(competitionPage('../x'), '');
  const items = read('assets/js/items.js');
  assert.match(items, /href: engine, 'data-competition'/, 'no target=_blank on the engine link');
});

function worker(windows = []) {
  const listeners = {};
  const opened = [];
  const posted = [];
  const focused = [];
  const self = {
    location: new URL('https://stathanasiosyouth.github.io/sw.js'),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    registration: { showNotification: async (title, options) => { self.shown = { title, options }; } },
    clients: {
      claim: async () => {},
      matchAll: async () => windows.map(url => ({ url, postMessage: m => posted.push({ url, m }), focus: async () => { focused.push(url); } })),
      openWindow: async url => { opened.push(url); }
    }
  };
  vm.runInNewContext(read('sw.js'), { self, URL, console });
  const fire = async (type, event) => { let wait; listeners[type]({ ...event, waitUntil: p => { wait = p; } }); await wait; };
  return {
    self, opened, posted, focused,
    url: async value => { await fire('push', { data: { json: () => ({ data: { title: 'x', url: value } }) } }); return self.shown.options.data.url; },
    click: url => fire('notificationclick', { notification: { data: { url }, close() {} } })
  };
}

test('sw.js: safeUrl allows /competition/<slug>/ and /points/ exactly; everything else as strict as before', async () => {
  const sw = worker();
  assert.equal(await sw.url('/competition/quiz-1/'), '/competition/quiz-1/');
  assert.equal(await sw.url('https://stathanasiosyouth.github.io/competition/quiz-1/'), '/competition/quiz-1/');
  assert.equal(await sw.url('/points/'), '/points/');
  assert.equal(await sw.url('/competition/quiz-1/?x=1#y'), '/competition/quiz-1/', 'query and hash dropped');
  assert.equal(await sw.url('/#competition/quiz-1'), '/index.html#competition/quiz-1');
  assert.equal(await sw.url('/#points'), '/index.html#points');
  for (const bad of ['/competition/', '/competition/Quiz/', '/competition/quiz-1', '/competition/quiz-1/comp.json', '/competition/a/b/', '/points', '/points/x', 'https://evil.example/competition/quiz/', '//evil.example/points/', '/admin/', 'javascript:alert(1)']) {
    assert.equal(await sw.url(bad), '/index.html', bad);
  }
  assert.equal(await sw.url('/#news/n-1'), '/index.html#news/n-1', 'old routes unchanged');
});

test('sw.js: a competition tap focuses that page if open, else hands it to the open site, else opens it', async () => {
  const origin = 'https://stathanasiosyouth.github.io';
  let sw = worker([`${origin}/index.html`, `${origin}/competition/quiz-1/`]);
  await sw.click('/competition/quiz-1/');
  assert.deepEqual(sw.focused, [`${origin}/competition/quiz-1/`]);
  assert.deepEqual(sw.posted, []);
  sw = worker([`${origin}/index.html`]);
  await sw.click('/competition/quiz-1/');
  assert.deepEqual(JSON.parse(JSON.stringify(sw.posted.map(p => p.m))), [{ type: 'athanasios:open', url: `${origin}/competition/quiz-1/` }]);
  sw = worker([`${origin}/admin/`]);
  await sw.click('/points/');
  assert.deepEqual(sw.opened, [`${origin}/points/`]);
});


/* =========================================================
   THE SHELL
========================================================= */

test('competition/index.html: the site CSP, no inline code, relative URLs one level up; privacy section exists', () => {
  const shell = read('competition/index.html');
  const site = read('index.html');
  const csp = html => /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  assert.equal(csp(shell), csp(site));
  assert.match(shell, /<html lang="ar" dir="rtl">/);
  assert.doesNotMatch(shell, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline script');
  assert.doesNotMatch(shell, /<style|\sstyle="/, 'no inline style');
  assert.doesNotMatch(shell, /<html[^>]*data-slug/, 'the shell itself has no slug');
  for (const [, url] of shell.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    if (url.startsWith('#')) continue;
    assert.match(url, /^\.\.\//, `${url} is relative to the site root`);
  }
  assert.match(shell, /src="\.\.\/assets\/js\/comp\/main\.js"/);
  assert.match(shell, /href="\.\.\/assets\/css\/comp\.css"/);
  assert.doesNotMatch(shell, /main\.css/, 'self-contained styles');
  assert.match(read('assets/js/comp/main.js'), /new URL\('\.\.\/\.\.\/\.\.\/', import\.meta\.url\)/, 'URLs from the module, not the page');
  const privacy = read('privacy/index.html');
  assert.match(privacy, /<section id="competitions">/);
  assert.match(privacy, /اسمك ورقم موبايلك/);
});

test('engine code: text only (no innerHTML / eval), no storage outside save.js', () => {
  for (const file of ['flow.js', 'view.js', 'save.js', 'main.js']) {
    const code = read(`assets/js/comp/${file}`);
    assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, file);
    if (file !== 'save.js') assert.doesNotMatch(code, /localStorage|sessionStorage/, file);
  }
});


/* ---------- §19.2 guests, §19.3 age eligibility ---------- */

test('guest result: «دي نتيجتك…», never a points line; noPoints (age): no points line', () => {
  const guest = F.sanitizeResult({ status: 'graded', score: 8, maxScore: 10, pointsAwarded: 800, guest: true });
  assert.equal(guest.guest, true);
  let s = F.resultSummary(guest, {});
  assert.deepEqual(s.lines.map(l => l.text), ['دي نتيجتك — المشاركة دي مفيهاش نقاط', 'جبت ٨ من ١٠']);
  assert.equal(F.sanitizeResult({ status: 'graded', guest: 'yes' }).guest, undefined);

  s = F.resultSummary({ status: 'graded', score: 8, maxScore: 10, pointsAwarded: 800 }, {}, { noPoints: true });
  assert.deepEqual(s.lines.map(l => l.kind), ['score', 'hint']);
  assert.equal(s.lines[1].text, 'المشاركة دي متسجلة بحسابك من غير نقاط.');
  assert.ok(!F.resultSummary(F.sanitizeResult({ status: 'graded', pointsAwarded: 5, noPoints: true }), {}).lines.some(l => l.kind === 'points'));
});

test('eligibility from portalMe', () => {
  assert.deepEqual(F.eligibility({ ok: true }), { eligible: true, notice: '' });
  assert.deepEqual(F.eligibility({ eligible: true, notice: 'x' }), { eligible: true, notice: '' });
  assert.deepEqual(F.eligibility({ eligible: false, notice: ' رسالة ' }), { eligible: false, notice: 'رسالة' });
  assert.deepEqual(F.eligibility({ eligible: false }), { eligible: false, notice: F.AGE_NOTICE });
});
