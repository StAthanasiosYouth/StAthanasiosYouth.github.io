// Competitions model (apps-script/CompModel.gs), pure: the builder's and
// the question editor's validation, the participant form, status, the
// definition, comp.json, compStart's questions, the stub page and what a
// publish gets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGs, sha256, ROOT } from '../tools/lib/gs.mjs';

const gs = loadGs(['Platforms.gs', 'Content.gs', 'Hub.gs', 'CompModel.gs', 'CompScore.gs']);
const plain = value => JSON.parse(JSON.stringify(value));
const modules = { registry: false, wallet: false };
const media = {
  'img-aaaaaaaa': { src: 'media/2026/img-aaaaaaaa.webp', thumb: 'media/2026/img-aaaaaaaa-480.webp', w: 1200, h: 630, alt: 'بانر' },
  'img-bbbbbbbb': { src: 'media/2026/img-bbbbbbbb.webp', thumb: 'media/2026/img-bbbbbbbb-480.webp', w: 800, h: 800, alt: '' }
};
const mediaOk = id => !!media[id];
const comp = (input, ctx = {}) => plain(gs.compValidateComp_(input, { modules, slugs: [], mediaOk, ...ctx }));
const question = (input, ctx = {}) => plain(gs.compValidateQuestion_(input, { mediaOk, ...ctx }));


/* ---------------- the competition ---------------- */

test('competition: a valid one is stored as text (flags 1/"", numbers as digits, fields as JSON)', () => {
  const { record, problems } = comp({ slug: 'bible-quiz', title: ' مسابقة  الكتاب ', scoring: true, resultShow: 'score', attempts: '٢', timeLimit: 30, startAt: '2026-10-20 18:00', endAt: '2026-10-21', enabled: true });
  assert.deepEqual(problems, []);
  assert.equal(record.title, 'مسابقة الكتاب');
  assert.equal(record.scoring, '1');
  assert.equal(record.attempts, '2');
  assert.equal(record.timeLimit, '30');
  assert.equal(record.endAt, '2026-10-21 23:59', 'a date-only end is the end of that day');
  assert.equal(record.participation, 'open');
  const fields = JSON.parse(record.fields);
  assert.deepEqual(fields.map(f => f.key), ['name', 'phone', 'age', 'church', 'group', 'custom1', 'custom2', 'custom3']);
  assert.deepEqual(fields.slice(0, 3).map(f => f.mode), ['required', 'required', 'hidden']);
});

test('competition: slug rules, reserved and taken slugs, the slug is fixed after the first publish', () => {
  assert.equal(comp({ slug: ' Bible-2026 ', title: 'x' }).record.slug, 'bible-2026', 'lower-cased, trimmed');
  for (const slug of ['', 'a', 'bible quiz', '-bible', 'bible-', 'bi--ble', 'x'.repeat(41), 'admin', 'points', 'مسابقة']) {
    assert.ok(comp({ slug, title: 'x' }).problems.some(p => /رابط المسابقة/.test(p)), `"${slug}"`);
  }
  assert.deepEqual(comp({ slug: 'ok-2026', title: 'x' }).problems, []);
  assert.ok(comp({ slug: 'taken', title: 'x' }, { slugs: ['taken'] }).problems.some(p => /بنفس الرابط/.test(p)));
  const existing = { slug: 'first', title: 'x', publishedAt: '2026-10-01 10:00' };
  const moved = comp({ slug: 'second' }, { existing });
  assert.ok(moved.problems.some(p => /مينفعش يتغير بعد أول نشر/.test(p)));
  assert.equal(moved.record.slug, 'first');
  assert.deepEqual(comp({ slug: 'second' }, { existing: { ...existing, publishedAt: '' } }).problems, [], 'before the first publish it may change');
});

test('competition: modules, dates, the answers date, unique phone, limits, unknown choices', () => {
  assert.ok(comp({ slug: 'aa', title: 'x', participation: 'registered' }).problems.some(p => /بأكواد/.test(p)));
  assert.deepEqual(comp({ slug: 'aa', title: 'x', participation: 'registered' }, { modules: { registry: true } }).problems, []);
  assert.ok(comp({ slug: 'aa', title: 'x', scoring: true, wallet: true, participation: 'registered' }, { modules: { registry: true, wallet: false } }).problems.some(p => /المحفظة/.test(p)));
  assert.ok(comp({ slug: 'aa', title: 'x', startAt: '2026-10-21 10:00', endAt: '2026-10-21 09:00' }).problems.some(p => /قبل النهاية/.test(p)));
  assert.ok(comp({ slug: 'aa', title: 'x', startAt: '2026-13-40' }).problems.some(p => /مش مفهوم/.test(p)));
  assert.ok(comp({ slug: 'aa', title: 'x', answersShow: 'atDate' }).problems.some(p => /ميعاد ظهور الإجابات/.test(p)));
  assert.equal(comp({ slug: 'aa', title: 'x', answersShow: 'afterClose', answersAt: '2026-10-20' }).record.answersAt, '', 'only kept for atDate');
  assert.ok(comp({ slug: 'aa', title: 'x', uniquePhone: true, fields: [{ key: 'phone', mode: 'optional' }] }).problems.some(p => /رقم الموبايل يكون إجباري/.test(p)));
  assert.ok(comp({ slug: 'aa', title: 'x', attempts: 0 }).problems.some(p => /عدد المحاولات/.test(p)));
  assert.ok(comp({ slug: 'aa', title: 'x', timeLimit: 601 }).problems.some(p => /الوقت/.test(p)));
  assert.ok(comp({ slug: 'aa', title: 'x', layout: 'grid' }).problems.some(p => /شكل الأسئلة/.test(p)));
  assert.ok(comp({ slug: 'aa', title: 'x', banner: 'img-zzzzzzzz' }).problems.some(p => /البانر/.test(p)));
  assert.ok(comp({ slug: 'aa', title: '' }).problems.some(p => /اسم المسابقة مطلوب/.test(p)));
  assert.ok(comp({ slug: 'aa', title: 'x'.repeat(81) }).problems.some(p => /أطول من 80/.test(p)));
  // no scoring: nothing score-like
  const survey = comp({ slug: 'aa', title: 'x', scoring: false, resultShow: 'score', wallet: true }).record;
  assert.equal(survey.resultShow, 'none');
  assert.equal(survey.wallet, '');
});

test('participant form: spec (labels, modes, select options) and values (required, phone, age, select, lengths)', () => {
  const problems = [];
  const spec = plain(gs.compFieldsSpec_([{ key: 'name', mode: 'required' }, { key: 'phone', mode: 'optional' }, { key: 'age', mode: 'required', label: 'سنك' },
    { key: 'group', mode: 'required', type: 'select', options: ['أولى', 'تانية', 'أولى'] }, { key: 'evil', mode: 'required' }], problems));
  assert.deepEqual(problems, []);
  assert.equal(spec.find(f => f.key === 'age').label, 'سنك');
  assert.deepEqual(spec.find(f => f.key === 'group').options, ['أولى', 'تانية']);
  assert.equal(spec.find(f => f.key === 'custom1').mode, 'hidden');
  assert.ok(!spec.some(f => f.key === 'evil'));
  const bad = [];
  gs.compFieldsSpec_([{ key: 'church', type: 'select', options: ['واحد'] }], bad);
  assert.ok(bad.some(p => /٢ على الأقل/.test(p)));

  const values = input => plain(gs.compFieldValues_(spec, input));
  const ok = values({ name: ' مينا  زكريا ', phone: '٠١٠١٢٣٤٥٦٧٨', age: '١٧', group: 'أولى', church: 'ignored (hidden)' });
  assert.equal(ok.problem, null);
  assert.equal(ok.name, 'مينا زكريا');
  assert.equal(ok.phone, '+201012345678');
  assert.deepEqual(ok.fields, { age: '17', group: 'أولى' });
  assert.equal(values({ phone: '01012345678', age: 17, group: 'أولى' }).problem.field, 'name');
  assert.equal(values({ name: 'x', phone: '123', age: 17, group: 'أولى' }).problem.field, 'phone');
  assert.equal(values({ name: 'x', age: 200, group: 'أولى' }).problem.field, 'age');
  assert.equal(values({ name: 'x', age: 17, group: 'تالتة' }).problem.field, 'group');
  assert.equal(values({ name: 'x'.repeat(61), age: 17, group: 'أولى' }).problem.field, 'name');
  assert.equal(values({ name: 'x', age: 17, group: 'أولى' }).problem, null, 'an optional phone may be empty');
  assert.equal(values(null).problem.field, 'name');
  assert.equal(values({ name: { x: 1 }, age: 17, group: 'أولى' }).problem.field, 'name', 'an object is not text');
});


/* ---------------- questions ---------------- */

test('question: choices get ids (kept when valid), the key by flag / id / position, problems named', () => {
  let n = 0;
  const ids = { newChoiceId: () => 'c-' + String(++n).padStart(6, '0') };
  const single = question({ type: 'single', text: 'مين بنى الفلك؟', choices: [{ text: 'نوح', correct: true }, { text: 'موسى' }, { text: ' ' }], points: 10 }, ids);
  assert.deepEqual(single.problems, []);
  const choices = JSON.parse(single.record.choices);
  assert.deepEqual(choices.map(c => c.text), ['نوح', 'موسى'], 'empty choices dropped');
  assert.equal(JSON.parse(single.record.correct), choices[0].id);
  // an edit keeps the ids it sends; the key by id
  const edit = question({ type: 'single', text: 'x', choices: [{ id: choices[1].id, text: 'موسى' }, { id: 'c-NOTVALID', text: 'نوح' }], correct: choices[1].id }, ids);
  const kept = JSON.parse(edit.record.choices);
  assert.equal(kept[0].id, choices[1].id);
  assert.match(kept[1].id, /^c-[0-9a-z]{6}$/);
  assert.equal(JSON.parse(edit.record.correct), choices[1].id);
  // by position (the import)
  const byPosition = question({ type: 'single', text: 'x', choices: ['أ', 'ب'], correct: 1 }, ids).record;
  assert.equal(JSON.parse(byPosition.correct), JSON.parse(byPosition.choices)[1].id);
  assert.ok(question({ type: 'single', text: 'x', choices: ['أ', 'ب'], correct: 'c-zzzzzz' }).problems.some(p => /مش من الاختيارات/.test(p)));
  assert.ok(question({ type: 'single', text: 'x', choices: [{ text: 'أ', correct: true }, { text: 'ب', correct: true }] }).problems.some(p => /واحدة بس/.test(p)));
  assert.ok(question({ type: 'single', text: 'x', choices: ['أ'] }).problems.some(p => /اختيارين/.test(p)));
  assert.ok(question({ type: 'multi', text: 'x', choices: Array.from({ length: 9 }, (_, i) => 'c' + i) }).problems.some(p => /أقصى عدد اختيارات/.test(p)));
  assert.ok(question({ type: 'single', text: 'x', choices: ['أحمد', 'احمد'] }).problems.some(p => /متكرر/.test(p)), 'the same choice in another spelling');
  assert.ok(question({ type: 'riddle', text: 'x' }).problems.some(p => /نوع السؤال/.test(p)));
  assert.ok(question({ type: 'short', text: '' }).problems.some(p => /نص السؤال مطلوب/.test(p)));
  assert.ok(question({ type: 'short', text: 'x', media: 'img-zzzzzzzz' }).problems.some(p => /صورة السؤال/.test(p)));
});

test('question: every type\'s key; points default and limits; review forced by type; info is plain text', () => {
  const multi = question({ type: 'multi', text: 'x', choices: [{ text: 'أ', correct: true }, { text: 'ب' }, { text: 'ج', correct: true }] });
  assert.equal(JSON.parse(multi.record.correct).length, 2);
  for (const [value, want] of [['صح', 't'], ['صحيح', 't'], ['غلط', 'f'], ['خطأ', 'f'], [true, 't'], [false, 'f'], ['t', 't'], ['F', 'f']]) {
    assert.equal(JSON.parse(question({ type: 'truefalse', text: 'x', correct: value }).record.correct), want, String(value));
  }
  assert.ok(question({ type: 'truefalse', text: 'x', correct: 'يمكن' }).problems.length);
  assert.deepEqual(JSON.parse(question({ type: 'short', text: 'x', correct: 'التكوين | سفر التكوين|التكوين' }).record.correct), ['التكوين', 'سفر التكوين'], 'split on |, duplicates (normalized) once');
  assert.equal(JSON.parse(question({ type: 'number', text: 'x', correct: '٢٧' }).record.correct), '27');
  assert.ok(question({ type: 'number', text: 'x', correct: 'كتير' }).problems.some(p => /رقم/.test(p)));
  assert.equal(question({ type: 'short', text: 'x' }).record.points, '100', 'empty points = the default (100)');
  assert.equal(question({ type: 'short', text: 'x', points: '٥' }).record.points, '5');
  assert.ok(question({ type: 'short', text: 'x', points: 10001 }).problems.some(p => /الدرجة/.test(p)));
  assert.ok(question({ type: 'short', text: 'x', points: 2.5 }).problems.some(p => /الدرجة/.test(p)));
  assert.equal(question({ type: 'long', text: 'x', review: 'auto' }).record.review, 'manual');
  assert.equal(question({ type: 'single', text: 'x', choices: ['أ', 'ب'], review: 'manual' }).record.review, 'auto');
  assert.equal(question({ type: 'short', text: 'x', review: 'fallback' }).record.review, 'fallback');
  const info = question({ type: 'info', text: 'فقرة '.repeat(300), points: 50, required: true, explanation: 'x' });
  assert.deepEqual(info.problems, []);
  assert.equal(info.record.points, '0');
  assert.equal(info.record.required, '');
  assert.equal(info.record.explanation, '');
  // a draft may be half done: a missing key is a warning, not a problem
  const draft = question({ type: 'single', text: 'x', choices: ['أ', 'ب'] });
  assert.deepEqual(draft.problems, []);
  assert.ok(draft.warnings.some(w => /مفيش إجابة صحيحة/.test(w)));
});

test('publish problems: keys by type when scoring; none when not', () => {
  const p = (q, scoring = true) => plain(gs.compQuestionProblems_(gs.compParseQuestion_(q), scoring));
  assert.deepEqual(p({ type: 'single', text: 'x', choices: '[{"id":"c-aaaaaa","text":"a"},{"id":"c-bbbbbb","text":"b"}]', correct: '' }), ['مفيش إجابة صحيحة']);
  assert.deepEqual(p({ type: 'single', text: 'x', choices: '[{"id":"c-aaaaaa","text":"a"},{"id":"c-bbbbbb","text":"b"}]', correct: '' }, false), []);
  assert.ok(p({ type: 'short', text: 'x', correct: '[]', review: 'auto' }).length);
  assert.deepEqual(p({ type: 'short', text: 'x', correct: '[]', review: 'manual' }), []);
  assert.ok(p({ type: 'number', text: 'x', correct: '"abc"' }).length);
  assert.deepEqual(p({ type: 'long', text: 'x' }), []);
});


/* ---------------- status ---------------- */

test('status: draft / scheduled / open / closed / results / archived, grace for submits, live view', () => {
  const c = extra => ({ liveVersion: 'v1', enabled: true, archived: false, startAt: '2026-10-20T10:00', endAt: '2026-10-20T12:00', resultsAt: '', closedAt: '', finalizedAt: '', ...extra });
  const s = (extra, now, opts) => gs.compStatus_(c(extra), null, now, opts);
  assert.equal(s({ liveVersion: '' }, '2026-10-20T11:00'), 'draft');
  assert.equal(s({ enabled: false }, '2026-10-20T11:00'), 'draft');
  assert.equal(s({ enabled: false }, '2026-10-20T11:00', { live: true }), 'open', 'published stays live until the next publish');
  assert.equal(s({ archived: true }, '2026-10-20T11:00'), 'archived');
  assert.equal(s({}, '2026-10-20T09:59'), 'scheduled');
  assert.equal(s({}, '2026-10-20T10:00'), 'open');
  assert.equal(s({}, '2026-10-20T12:00'), 'open', 'the end minute is inclusive');
  assert.equal(s({}, '2026-10-20T12:01'), 'closed');
  assert.equal(s({}, '2026-10-20T12:03', { graceMinutes: 3 }), 'open', 'a submit within the grace');
  assert.equal(s({}, '2026-10-20T12:04', { graceMinutes: 3 }), 'closed');
  assert.equal(s({ closedAt: '2026-10-20T10:30' }, '2026-10-20T10:30'), 'closed', '«اقفل دلوقتي» at once');
  assert.equal(s({ resultsAt: '2026-10-21T00:00' }, '2026-10-20T13:00'), 'closed');
  assert.equal(s({ resultsAt: '2026-10-21T00:00' }, '2026-10-21T00:00'), 'results');
  assert.equal(s({ finalizedAt: '2026-10-20 13:00' }, '2026-10-20T13:00'), 'results');
  assert.equal(s({ startAt: '', endAt: '' }, '2030-01-01T00:00'), 'open', 'no dates: open as soon as published, never closes by itself');
  // the live definition's dates win over the draft's
  assert.equal(gs.compStatus_(c({ endAt: '2026-10-20T11:00' }), { startAt: '2026-10-20T10:00', endAt: '2026-10-20T12:00', resultsAt: '' }, '2026-10-20T11:30', { live: true }), 'open');
});


/* ---------------- definition, comp.json, compStart's questions ---------------- */

function sample() {
  const row = { id: 'cmp-0000000a', slug: 'bible-quiz', title: 'مسابقة <الكتاب> "المقدس"', shortTitle: 'الكتاب', description: 'وصف قصير', banner: 'img-aaaaaaaa', theme: 'ember',
    participation: 'open', scoring: '1', resultShow: 'score', answersShow: 'afterClose', attempts: '1', layout: 'paged', enabled: '1', startAt: '2026-10-20 10:00', endAt: '2026-10-20' };
  const questions = [
    { id: 'q-00000002', compId: row.id, order: '20', type: 'short', text: 'اسم أول سفر؟', correct: '["التكوين"]', points: '5', required: '1', explanation: 'شرح سري', review: 'auto', enabled: '1' },
    { id: 'q-00000001', compId: row.id, order: '10', type: 'single', text: 'مين بنى الفلك؟', choices: '[{"id":"c-aaaaaa","text":"نوح"},{"id":"c-bbbbbb","text":"موسى"}]', correct: '"c-aaaaaa"', points: '10', required: '1', media: 'img-bbbbbbbb', enabled: '1' },
    { id: 'q-00000003', compId: row.id, order: '30', type: 'number', text: 'سؤال مخفي', correct: '"3"', points: '5', enabled: '' },
    { id: 'q-00000004', compId: row.id, order: '15', type: 'info', text: 'فقرة', enabled: '1' }
  ];
  return { row, questions };
}

test('definition: enabled questions in order, image objects, private parts kept; version = sha256[0..16]', () => {
  const { row, questions } = sample();
  const def = plain(gs.compDefinition_(gs.compParseComp_(row), questions.map(gs.compParseQuestion_), media));
  assert.deepEqual(def.questions.map(q => q.id), ['q-00000001', 'q-00000004', 'q-00000002']);
  assert.equal(def.questions[0].correct, 'c-aaaaaa');
  assert.equal(def.questions[2].explanation, 'شرح سري');
  assert.deepEqual(def.questions[0].media, media['img-bbbbbbbb']);
  assert.deepEqual(def.banner, media['img-aaaaaaaa']);
  assert.equal(def.endAt, '2026-10-20T23:59');
  assert.equal(def.ctaLabel, 'ابدأ المسابقة', 'the default button');
  assert.equal(def.scoring, true);
  assert.equal(gs.compVersion_(def, sha256), sha256(JSON.stringify(def)).slice(0, 16));
});

test('comp.json and compStart questions: no question text, choices, keys or explanations', () => {
  const { row, questions } = sample();
  const def = gs.compDefinition_(gs.compParseComp_(row), questions.map(gs.compParseQuestion_), media);
  const pub = plain(gs.compPublicDef_(def, 'abcdef0123456789', '2026-10-19T10:00'));
  const text = JSON.stringify(pub);
  for (const secret of ['مين بنى الفلك', 'نوح', 'التكوين', 'شرح سري', 'c-aaaaaa', 'questions']) assert.ok(!text.includes(secret), secret);
  assert.equal(pub.questionCount, 2, 'info is not a question');
  assert.equal(pub.totalPoints, 15);
  assert.equal(pub.v, 'abcdef0123456789');
  assert.deepEqual(plain(gs.compWithdrawnDef_('bible-quiz')), { schema: 1, slug: 'bible-quiz', withdrawn: true });

  const q = plain(gs.compPublicQuestion_(def.questions[0], false, ['c-bbbbbb', 'c-aaaaaa']));
  assert.deepEqual(Object.keys(q).sort(), ['choices', 'help', 'id', 'media', 'required', 'text', 'type']);
  assert.deepEqual(q.choices.map(c => c.id), ['c-bbbbbb', 'c-aaaaaa'], 'the served (shuffled) order');
  assert.equal(gs.compPublicQuestion_(def.questions[0], true).points, 10, 'points only when the competition shows them');
});

test('stub page: the site\'s exact CSP, data-slug, escaped head, absolute OG URLs, the engine module and styles', () => {
  const { row, questions } = sample();
  const def = gs.compDefinition_(gs.compParseComp_(row), questions.map(gs.compParseQuestion_), media);
  const html = gs.compStubHtml_(def, 'https://stathanasiosyouth.github.io/', 'abcdef0123456789', '');
  const indexCsp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(`${ROOT}index.html`, 'utf8'))[1];
  assert.equal(/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1], indexCsp, 'same CSP as index.html');
  assert.match(html, /<html lang="ar" dir="rtl" data-slug="bible-quiz" data-v="abcdef0123456789">/);
  assert.equal((html.match(/<title>/g) || []).length, 1, 'the shell\'s own title replaced');
  assert.match(html, /<title>مسابقة &lt;الكتاب&gt; &quot;المقدس&quot; \| /);
  assert.ok(!html.includes('<الكتاب>'), 'nothing unescaped');
  assert.match(html, /<link rel="canonical" href="https:\/\/stathanasiosyouth\.github\.io\/competition\/bible-quiz\/">/);
  assert.match(html, /property="og:image" content="https:\/\/stathanasiosyouth\.github\.io\/media\/2026\/img-aaaaaaaa\.webp"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /<script type="module" src="\.\.\/\.\.\/assets\/js\/comp\/main\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\.\.\/\.\.\/assets\/css\/comp\.css">/);
  assert.match(html, /<noscript>/);
  assert.equal((html.match(/<script/g) || []).length, 1, 'no inline script');
  assert.ok(!/style=/.test(html), 'no inline style');
  for (const secret of ['مين بنى الفلك', 'نوح', 'التكوين', 'شرح سري']) assert.ok(!html.includes(secret), secret);
  // no banner: the site's picture
  assert.match(gs.compStubHtml_({ ...def, banner: null }, ''), /og-image\.png/);
});

test('stub page from the real shell: ../ → ../../, data-slug + data-v, its own identity tags replaced, nothing else touched', () => {
  const { row, questions } = sample();
  const def = gs.compDefinition_(gs.compParseComp_(row), questions.map(gs.compParseQuestion_), media);
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(`${ROOT}index.html`, 'utf8'))[1];
  const shell = [
    '<!doctype html>', '<html lang="ar" dir="rtl">', '<head>', '  <meta charset="utf-8">',
    `  <meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '  <title>المسابقة</title>', '  <meta name="description" content="محرك المسابقات">', '  <link rel="canonical" href="https://x.example/competition/">',
    '  <meta property="og:title" content="shell">', '  <meta name="twitter:card" content="summary">',
    '  <link rel="manifest" href="../manifest.webmanifest">', '  <link rel="stylesheet" href="../assets/css/comp.css">',
    '  <script type="module" src="../assets/js/comp/main.js"></script>', '</head>',
    '<body class="comp-shell"><div id="comp-root" data-x="1"></div><img src="../assets/img/logo.webp" alt=""><a href="https://example.org/../x">x</a></body>', '</html>'
  ].join('\r\n');
  const html = gs.compStubHtml_(def, 'https://stathanasiosyouth.github.io/', 'v123', shell);
  assert.match(html, /<html lang="ar" dir="rtl" data-slug="bible-quiz" data-v="v123">/);
  assert.match(html, /href="\.\.\/\.\.\/manifest\.webmanifest"/);
  assert.match(html, /src="\.\.\/\.\.\/assets\/js\/comp\/main\.js"/);
  assert.match(html, /src="\.\.\/\.\.\/assets\/img\/logo\.webp"/);
  assert.match(html, /href="https:\/\/example\.org\/\.\.\/x"/, 'absolute URLs untouched');
  assert.match(html, /<body class="comp-shell"><div id="comp-root" data-x="1"><\/div>/, 'the body is the shell\'s');
  assert.ok(!html.includes('محرك المسابقات') && !html.includes('x.example') && !html.includes('content="shell"') && !html.includes('content="summary"'));
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/stathanasiosyouth\.github\.io\/competition\/bible-quiz\/">/);
  assert.ok(!html.includes('\r'));
  // something that is not the shell (an error page, a 404 body) is never used
  assert.match(gs.compStubHtml_(def, '', 'v', '<html><body>Not Found</body></html>'), /comp-app/);
});

test('publish build: index with v, withdrawn ones, media, errors (keys, modules, slugs), card data', () => {
  const { row, questions } = sample();
  const errors = [];
  const ctx = { media, error: (where, message) => errors.push(where + ': ' + message), warn() {}, hash: sha256 };
  const out = plain(gs.compBuildPublic_({ comps: [row, { ...row, id: 'cmp-0000000b', slug: 'old', liveVersion: 'x', enabled: '' }], questions, modules }, ctx));
  assert.deepEqual(errors, []);
  assert.equal(out.index.length, 1);
  assert.deepEqual(Object.keys(out.index[0]), ['id', 'slug', 'title', 'shortTitle', 'startAt', 'endAt', 'v']);
  assert.match(out.index[0].v, /^[0-9a-f]{16}$/);
  assert.deepEqual(out.withdrawn, [{ id: 'cmp-0000000b', slug: 'old' }]);
  assert.deepEqual(out.media.sort(), ['img-aaaaaaaa', 'img-bbbbbbbb']);
  assert.equal(out.byId['cmp-0000000a'].slug, 'bible-quiz');
  assert.equal(out.slugs.old, 'draft');
  assert.equal(out.slugs['bible-quiz'], 'live');
  assert.equal(out.live['cmp-0000000a'].questionCount, 2);

  const broken = [];
  gs.compBuildPublic_({
    comps: [row, { ...row, id: 'cmp-0000000c' }, { ...row, id: 'cmp-0000000d', slug: 'coded', participation: 'registered' }],
    questions: questions.concat([{ id: 'q-00000009', compId: 'cmp-0000000c', order: '1', type: 'single', text: 'x', choices: '[{"id":"c-aaaaaa","text":"a"},{"id":"c-bbbbbb","text":"b"}]', correct: '', enabled: '1' }]),
    modules
  }, { ...ctx, error: (where, message) => broken.push(message) });
  assert.ok(broken.some(m => /س١: مفيش إجابة صحيحة/.test(m)), broken.join(' / '));
  assert.ok(broken.some(m => /بنفس الرابط/.test(m)));
  assert.ok(broken.some(m => /بأكواد/.test(m)));
  assert.ok(broken.some(m => /مفيش أسئلة ظاهرة/.test(m)), 'a competition with no questions');
  // a sheet that can't be read is a publish error, never a silent withdrawal
  const unread = [];
  gs.compBuildPublic_({ error: 'مقدرناش نقرا', comps: [], questions: [] }, { ...ctx, error: (w, m) => unread.push(m) });
  assert.deepEqual(unread, ['مقدرناش نقرا']);
});
