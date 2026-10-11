// Competitions, end to end on the fake world (CompPublic.gs, CompPublish.gs,
// Publish.gs): build → import → publish (one commit; nothing secret in any
// committed file) → compStart / compSubmit / compResult with the server's
// clock, idempotency, limits, time limits, grace, «اقفل دلوقتي», the result
// policy over time, budgets and malformed requests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compWorld, adminApi, pub, clientKey, publish, scoredComp, wallAt, SITE, plain } from './fakes/comp.mjs';

const phone = n => '0101234' + String(n).padStart(4, '0');
const person = n => ({ name: 'مشترك ' + n, phone: phone(n) });

/* the right (or wrong) answer for each served question of scoredComp */
function answersFor(start, right = true) {
  const answers = {};
  for (const q of start.questions) {
    const pick = text => q.choices.find(c => c.text === text).id;
    if (q.type === 'single') answers[q.id] = pick(right ? 'نوح' : 'موسى');
    if (q.type === 'multi') answers[q.id] = right ? [pick('متى'), pick('مرقس')] : [pick('أعمال الرسل')];
    if (q.type === 'truefalse') answers[q.id] = right ? 't' : 'f';
    if (q.type === 'short') answers[q.id] = right ? 'سِفر  التكوين' : 'الخروج';
    if (q.type === 'number') answers[q.id] = right ? '٢٧' : '30';
    if (q.type === 'long') answers[q.id] = 'تأمل';
  }
  return answers;
}

/* a published scored competition: { world, call, id } */
function live(overrides = {}) {
  const world = compWorld();
  const call = adminApi(world);
  const { id, questions } = scoredComp(call, overrides);
  publish(world, call);
  return { world, call, id, questions };
}

const start = (world, n = 1, extra = {}) => pub(world, 'compStart', { slug: 'bible-quiz', clientKey: extra.clientKey || clientKey(), fields: person(n), ...extra });
const submit = (world, started, answers, extra = {}) => pub(world, 'compSubmit', { token: started.attempt.token, clientKey: extra.clientKey || started.key, answers: answers || answersFor(started), ...extra });
function begin(world, n = 1, extra = {}) {
  const key = extra.clientKey || clientKey();
  const reply = start(world, n, { ...extra, clientKey: key });
  return { ...reply, key };
}


/* ---------------- building and publishing ---------------- */

test('import + publish: one commit with content.json, the stub and comp.json; NOTHING secret in any committed file', () => {
  const world = compWorld();
  const call = adminApi(world);
  const created = call('apiCompCreate', { preset: 'scored', title: 'مسابقة السر', slug: 'secret-quiz', description: 'وصف عام', enabled: true });
  const id = created.comp.id;
  const secrets = [];
  const add = input => call('apiCompQuestionSave', id, input);

  add({ type: 'single', text: 'سؤال-سري-أ', choices: [{ text: 'إجابة-صح-أ', correct: true }, { text: 'اختيار-غلط-أ' }], explanation: 'شرح-سري-أ' });
  add({ type: 'short', text: 'سؤال-سري-ب', correct: ['مقبول-سري-ب'], explanation: 'شرح-سري-ب' });
  add({ type: 'number', text: 'سؤال-سري-ج', correct: '987654' });
  add({ type: 'truefalse', text: 'سؤال-سري-د', correct: 'صح' });
  add({ type: 'long', text: 'سؤال-سري-ه' });
  secrets.push('سؤال-سري-', 'إجابة-صح-', 'اختيار-غلط-', 'مقبول-سري-', 'شرح-سري-', '987654');

  // 100 good rows + 4 bad ones, tab separated like a paste from Excel
  const lines = ['ترتيب\tالسؤال\tالنوع\tاختيار 1\tاختيار 2\tاختيار 3\tالإجابة الصحيحة\tالدرجة\tإجباري\tالتوضيح'];
  for (let i = 1; i <= 100; i++) {
    const kind = i % 4;
    if (kind === 0) lines.push(`\tسؤال-سري-${i}\tاختيار واحد\tاختيار-غلط-${i}\tإجابة-صح-${i}\tاختيار-غلط-x${i}\t٢\t\t\tشرح-سري-${i}`);
    if (kind === 1) lines.push(`\tسؤال-سري-${i}\tاختيارات متعددة\tإجابة-صح-${i}\tاختيار-غلط-${i}\tإجابة-صح-y${i}\t1،3\t5\tلا\t`);
    if (kind === 2) lines.push(`\tسؤال-سري-${i}\tصح وغلط\t\t\t\tغلط\t2\t\t`);
    if (kind === 3) lines.push(`\tسؤال-سري-${i}\tإجابة قصيرة\t\t\t\tمقبول-سري-${i}|مقبول-سري-z${i}\t\tنعم\tشرح-سري-${i}`);
  }
  lines.push('\tسؤال-سري-bad1\tلغز\t\t\t\t\t\t\t');
  lines.push('\t\tاختيار واحد\tأ\tب\t\t1\t\t\t');
  lines.push('\tسؤال-سري-bad3\tاختيار واحد\tأ\tب\t\t٥\t\t\t');
  lines.push('\tسؤال-سري-bad4\tرقم\t\t\t\tكتير\t\t\t');
  const text = lines.join('\n');

  const preview = call('apiCompImportPreview', id, text);
  assert.deepEqual(preview.problems, []);
  assert.equal(preview.counts.ok, 100);
  assert.equal(preview.counts.error, 4);
  const errors = preview.rows.filter(r => r.status === 'error').map(r => r.errors.join(' / '));
  assert.match(errors[0], /^صف ١٠٢، النوع: «لغز» مش نوع معروف/);
  assert.match(errors[1], /^صف ١٠٣، السؤال: نص السؤال ناقص/);
  assert.match(errors[2], /^صف ١٠٤، الإجابة الصحيحة: «٥» مش من الاختيارات/);
  assert.match(errors[3], /^صف ١٠٥، الإجابة الصحيحة: «كتير» مش رقم/);
  assert.equal(world.compSpreadsheet.getSheetByName('Questions').getLastRow(), 6, 'the preview wrote nothing');

  const decisions = Object.fromEntries(preview.rows.filter(r => r.status === 'ok').map(r => ['r' + r.line, 'add:' + r.fp]));
  const writes = world.compSpreadsheet.stats.writes;
  const applied = call('apiCompImportApply', id, text, decisions);
  assert.equal(applied.added, 100);
  assert.equal(applied.errors, 4);
  assert.equal(applied.count, 105);
  assert.ok(world.compSpreadsheet.stats.writes - writes <= 4, `one block for 100 rows (${world.compSpreadsheet.stats.writes - writes} writes)`);

  const published = publish(world, call);
  assert.ok(published.commit, 'a commit');
  const files = published.files;
  assert.ok(files['competition/secret-quiz/index.html']);
  assert.ok(files['competition/secret-quiz/comp.json']);
  const content = JSON.parse(files['content.json']);
  assert.equal(content.schema, 3, 'content.json schema unchanged');
  assert.equal(content.competitions.length, 1);
  const pubDef = JSON.parse(files['competition/secret-quiz/comp.json']);
  assert.equal(content.competitions[0].v, pubDef.v);
  assert.equal(pubDef.questionCount, 105);
  assert.match(files['competition/secret-quiz/index.html'], /data-slug="secret-quiz"/);
  assert.ok(published.review.changes.some(c => /مسابقة جديدة: مسابقة السر \(١٠٥ سؤال\)/.test(c)) || published.review.changes.includes('أول نشر للموقع'));

  // the leak test: every committed file, every secret
  for (const [path, value] of Object.entries(files)) {
    const body = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
    for (const secret of secrets) assert.ok(!body.includes(secret), `${secret} leaked in ${path}`);
  }

  // the private definition is in Snapshots, and liveVersion follows the commit
  const comps = world.compSpreadsheet.getSheetByName('Competitions').data;
  const header = comps[0];
  const row = comps.find(r => r[0] === id);
  assert.equal(row[header.indexOf('liveVersion')], pubDef.v);
  const snaps = world.compSpreadsheet.getSheetByName('Snapshots').data.slice(1).filter(r => r[0] === id && r[1] === pubDef.v);
  assert.ok(snaps.length >= 1);
  const def = JSON.parse(snaps.sort((a, b) => a[2] - b[2]).map(r => String(r[3]).replace(/^'(?=[=+\-@])/, '')).join(''));
  assert.equal(def.questions.length, 105);
  assert.ok(snaps.every(r => String(r[3]).length <= 45001), 'parts ≤ 45,000 characters');
});

test('publish again with nothing changed: no new commit, no new snapshot; a change → a new v and revision', () => {
  const { world, call, id, questions } = live();
  const head = world.github.head;
  const review = call('apiReview');
  assert.deepEqual(review.changes, [], 'nothing to publish');
  const again = call('apiPublish', review.revision);
  assert.equal(again.unchanged, true);
  assert.equal(world.github.head, head);
  const before = JSON.parse(world.github.files()['competition/bible-quiz/comp.json']).v;
  call('apiCompQuestionSave', id, { ...questions.single, text: 'مين اللي بنى الفلك؟', choices: questions.single.choices.map(c => ({ ...c, correct: c.id === questions.single.correct })) });
  const changed = call('apiReview');
  assert.ok(changed.changes.some(c => /^تعديل مسابقة: مسابقة الكتاب المقدس \(٦ سؤال\)/.test(c)), changed.changes.join(' / '));
  publish(world, call);
  assert.notEqual(JSON.parse(world.github.files()['competition/bible-quiz/comp.json']).v, before);
  assert.equal(world.compSpreadsheet.getSheetByName('Snapshots').data.slice(1).filter(r => r[0] === id).length, 2, 'two versions kept');
});

test('withdrawn: turning «enabled» off keeps the stub, comp.json says withdrawn, content.json drops it; public start → not_found', () => {
  const { world, call, id } = live();
  call('apiCompSave', id, { enabled: false });
  const review = call('apiReview');
  assert.ok(review.changes.includes('مسابقة هتختفي: مسابقة الكتاب المقدس'));
  // until the publish it keeps running
  assert.equal(start(world).ok, true);
  publish(world, call);
  const files = world.github.files();
  assert.deepEqual(JSON.parse(files['competition/bible-quiz/comp.json']), { schema: 1, slug: 'bible-quiz', withdrawn: true });
  assert.ok(files['competition/bible-quiz/index.html'], 'the stub stays');
  assert.equal(JSON.parse(files['content.json']).competitions, undefined);
  assert.equal(start(world).code, 'not_found');
});

test('publish errors block: a scored single-choice question without a key', () => {
  const world = compWorld();
  const call = adminApi(world);
  const { comp } = call('apiCompCreate', { preset: 'scored', title: 'ناقصة', slug: 'broken', enabled: true });
  call('apiCompQuestionSave', comp.id, { type: 'single', text: 'سؤال', choices: ['أ', 'ب'] });
  const review = call('apiReview');
  assert.ok(review.errors.some(e => e.where === 'المسابقات: ناقصة' && /س١: مفيش إجابة صحيحة/.test(e.message)));
  assert.throws(() => call('apiPublish', review.revision), /أخطاء لازم تتصلح/);
});


/* ---------------- compStart ---------------- */

test('start: questions without key / explanation / review; fields checked; honeypot; unknown slug', () => {
  const { world } = live();
  const s = begin(world);
  assert.equal(s.ok, true);
  assert.equal(s.questions.length, 7);
  assert.equal(s.comp.total, 7);
  assert.match(s.attempt.id, /^s-[0-9a-f]{12}$/);
  assert.equal(s.attempt.resumed, false);
  assert.equal(s.attempt.deadlineMs, 0);
  const text = JSON.stringify(s);
  for (const secret of ['correct', 'explanation', 'review', 'التكوين', '"27"']) assert.ok(!text.includes(secret), secret);
  assert.ok(s.questions.every(q => q.points === undefined), 'no points unless showPoints');

  assert.deepEqual(plain(pub(world, 'compStart', { slug: 'bible-quiz', clientKey: clientKey(), fields: { phone: phone(1) } })).field, 'name');
  assert.equal(pub(world, 'compStart', { slug: 'bible-quiz', clientKey: clientKey(), fields: { name: 'x', phone: '12' } }).code, 'invalid');
  assert.equal(pub(world, 'compStart', { slug: 'bible-quiz', clientKey: clientKey(), fields: person(2), hp: 'http://spam' }).code, 'bad');
  assert.equal(pub(world, 'compStart', { slug: 'nope-nope', clientKey: clientKey(), fields: person(2) }).code, 'not_found');
  for (const bad of [{ slug: 'Bible', clientKey: clientKey() }, { slug: 'bible-quiz', clientKey: 'short' }, { slug: 'bible-quiz' }, null, [1], 'x']) {
    assert.equal(pub(world, 'compStart', bad).code, 'bad', JSON.stringify(bad));
  }
  assert.match(pub(world, 'compStart', null).message, /حدّث الصفحة/);
});

test('start: before startAt → not_open (+startAt); after endAt → closed; no spreadsheet at all → not_found', () => {
  const fresh = compWorld();
  assert.equal(start(fresh).code, 'not_found', 'nothing was ever created: no spreadsheet, nothing read');
  assert.equal(fresh.compSpreadsheet, null);

  const { world } = live({ startAt: wallAtOf(10), endAt: wallAtOf(60) });
  const early = start(world);
  assert.equal(early.code, 'not_open');
  assert.match(early.startAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  world.advance(11 * 60000);
  assert.equal(start(world).ok, true);
  world.advance(60 * 60000);
  assert.equal(start(world).code, 'closed');
});

/* minutes from the real now, for comps made before any world.advance */
function wallAtOf(minutes) {
  return wallAt({ now: () => Date.now() }, minutes);
}

test('start is idempotent: the same clientKey → the same attempt (same order), resumed; a new key → a new attempt', () => {
  const { world, call, id } = live({ shuffleQ: true, shuffleC: true });
  const key = clientKey();
  const first = start(world, 1, { clientKey: key });
  const again = start(world, 1, { clientKey: key });
  assert.equal(again.attempt.id, first.attempt.id);
  assert.equal(again.attempt.resumed, true);
  assert.deepEqual(again.questions.map(q => q.id), first.questions.map(q => q.id));
  assert.deepEqual(again.questions.map(q => q.choices.map(c => c.id)), first.questions.map(q => q.choices.map(c => c.id)));
  const other = start(world, 2);
  assert.notEqual(other.attempt.id, first.attempt.id);
  const rows = world.compSpreadsheet.getSheetByName('Submissions').data.slice(1).filter(r => r[1] === id);
  assert.equal(rows.length, 2, 'one row per attempt');
  // the admin sees the order the person saw
  const detail = call('apiCompSubmission', first.attempt.id);
  assert.deepEqual(detail.questions.map(q => q.id), first.questions.map(q => q.id));
  assert.deepEqual(detail.questions.map(q => q.choices.map(c => c.id)), first.questions.map(q => q.choices.map(c => c.id)));
});


/* ---------------- compSubmit ---------------- */

test('submit: graded by the server, receipt + result; an exact replay gives the same result; a reused key changes nothing', () => {
  const { world } = live({ answersShow: 'never' });
  const s = begin(world);
  const done = submit(world, s);
  assert.equal(done.ok, true);
  assert.match(done.receipt, /^rc1\./);
  assert.deepEqual(plain(done.result), { status: 'pending_review', submittedAt: done.result.submittedAt, score: 35, maxScore: 45, correctCount: 5, gradableCount: 6, pending: 1 });
  const replay = submit(world, s, answersFor(s, false));
  assert.equal(replay.ok, true);
  assert.equal(replay.result.score, 35, 'already sent: the stored result, not the new answers');
  assert.equal(replay.receipt, done.receipt);
  const resumed = start(world, 1, { clientKey: s.key });
  assert.equal(resumed.attempt.status, 'pending_review');
  assert.equal(resumed.receipt, done.receipt, 'a reload after sending gets the receipt and result back');
  assert.equal(resumed.result.score, 35);
});

test('submit: a forged token, another attempt\'s clientKey, junk → bad; client-sent scores are ignored', () => {
  const { world } = live();
  const s = begin(world);
  const [k, body, sig] = s.attempt.token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), d: 1 })).toString('base64url');
  assert.equal(submit(world, s, undefined, { token: `${k}.${forged}.${sig}` }).code, 'bad');
  assert.equal(submit(world, s, undefined, { clientKey: clientKey() }).code, 'bad');
  assert.equal(pub(world, 'compSubmit', { clientKey: s.key, answers: {} }).code, 'bad');
  const sneaky = submit(world, s, { ...answersFor(s, false) }, { score: 999, result: { score: 999 } });
  assert.equal(sneaky.result.score, 0);
});

test('submit: unknown questions and foreign choice ids are refused with the qid; nothing is written', () => {
  const { world, id } = live();
  const s = begin(world);
  const single = s.questions.find(q => q.type === 'single');
  const bad = submit(world, s, { ...answersFor(s), [single.id]: 'c-zzzzzz' });
  assert.equal(bad.code, 'invalid');
  assert.equal(bad.qid, single.id);
  const unknown = submit(world, s, { ...answersFor(s), 'q-12345678': 'x' });
  assert.equal(unknown.code, 'invalid');
  assert.equal(unknown.qid, 'q-12345678');
  const missing = submit(world, s, { [single.id]: single.choices[0].id });
  assert.equal(missing.code, 'invalid', 'required questions');
  const row = world.compSpreadsheet.getSheetByName('Submissions').data.slice(1).find(r => r[1] === id);
  assert.equal(row[9], 'in_progress');
  assert.equal(submit(world, s).ok, true, 'a correct retry still works');
});

test('limits: attempts (by phone), uniquePhone, maxSubmissions — at start AND at submit', () => {
  const { world, call, id } = live();
  const a = begin(world, 1);
  const b = begin(world, 1);
  assert.equal(submit(world, a).ok, true);
  assert.equal(start(world, 1).code, 'limit', 'one attempt per person');
  assert.match(start(world, 1).message, /شاركت/);
  assert.equal(submit(world, b).code, 'limit', 'an attempt opened before is refused at submit');

  call('apiCompSave', id, { attempts: 3, uniquePhone: true, maxSubmissions: 3 });
  publish(world, call);
  assert.equal(start(world, 1).code, 'limit', 'uniquePhone wins over attempts');
  assert.match(start(world, 1).message, /الرقم ده/);
  assert.equal(submit(world, begin(world, 2)).ok, true);
  const c = begin(world, 3);
  const d = begin(world, 4);
  assert.equal(submit(world, c).ok, true);
  assert.equal(submit(world, d).code, 'limit', 'the cap counts at submit too');
  assert.equal(start(world, 5).code, 'limit');
  assert.match(start(world, 5).message, /اكتملت/);
});

test('time limit: the deadline (+60 s slack) is the server\'s; late inside the slack is flagged', () => {
  const { world, call, id } = live({ timeLimit: 2 });
  const a = begin(world, 1);
  assert.ok(a.attempt.deadlineMs > a.attempt.serverNow);
  assert.equal(Math.round((a.attempt.deadlineMs - a.attempt.serverNow) / 1000), 120);
  world.advance(150_000);
  const late = submit(world, a);
  assert.equal(late.ok, true);
  const b = begin(world, 2);
  world.advance(181_000);
  assert.equal(submit(world, b).code, 'expired');
  const list = call('apiCompSubmissions', id, { status: 'done' });
  assert.deepEqual(list.items[0].flags, ['late']);
});

test('time limit: the automatic submit at the deadline goes in with required questions unanswered; before that they are required', () => {
  const { world, call, id } = live({ timeLimit: 2 });
  const a = begin(world, 1);
  const single = a.questions.find(q => q.type === 'single');
  const partial = { [single.id]: single.choices.find(c => c.text === 'نوح').id };
  assert.equal(submit(world, a, partial).code, 'invalid', 'early: required means required');
  world.advance(110_000);   // 10 s before the deadline (the page's clock may be ahead)
  const sent = submit(world, a, partial);
  assert.equal(sent.ok, true);
  assert.equal(sent.result.score, 10);
  const c = begin(world, 3);
  world.advance(100_000);
  assert.equal(submit(world, c, partial).code, 'invalid', '20 s before: still required');
  assert.equal(call('apiCompSubmissions', id, { status: 'done' }).total, 1);
});

test('grace: an attempt started before the end may send until end + 3 minutes; then closed', () => {
  const { world } = live({ endAt: wallAtOf(5) });
  const a = begin(world, 1);
  const b = begin(world, 2);
  world.advance(7 * 60000);
  assert.equal(start(world, 3).code, 'closed', 'no new attempt after the end');
  const late = submit(world, a);
  assert.equal(late.ok, true);
  world.advance(3 * 60000);
  assert.equal(submit(world, b).code, 'closed');
});

test('«اقفل دلوقتي»: start closes at once (even with the cache warm); started attempts get the grace', () => {
  const { world, call, id } = live();
  const a = begin(world, 1);
  const b = begin(world, 2);
  call('apiCompClose', id);
  assert.equal(start(world, 3).code, 'closed');
  assert.equal(submit(world, a).ok, true);
  world.advance(4 * 60000);
  assert.equal(submit(world, b).code, 'closed');
  call('apiCompClose', id, true);
  assert.equal(start(world, 3).ok, true, 'opened again');
});


/* ---------------- the result over time ---------------- */

test('result policy: resultsAt hides the score until then; answers immediately / afterClose / atDate / never', () => {
  const { world, call, id } = live({ resultShow: 'score', resultsAt: wallAtOf(30), answersShow: 'afterClose', endAt: wallAtOf(60) });
  const s = begin(world);
  const done = submit(world, s);
  assert.equal(done.result.score, undefined, 'hidden until resultsAt');
  assert.match(done.result.resultsAt, /T/);
  assert.equal(done.result.review, undefined);
  assert.match(done.result.answersAt, /T/, 'afterClose: when the answers show');
  world.advance(31 * 60000);
  const later = pub(world, 'compResult', { receipt: done.receipt });
  assert.equal(later.result.score, 35);
  assert.equal(later.result.review, undefined, 'not closed yet');
  world.advance(31 * 60000);
  const closed = pub(world, 'compResult', { receipt: done.receipt });
  assert.equal(closed.result.review.length, 6, 'every question but info');
  const single = closed.result.review.find(r => r.type === 'single');
  assert.equal(single.ok, true);
  assert.equal(single.pts, 10);
  assert.equal(typeof single.correct, 'string');
  assert.equal(closed.result.review.find(r => r.type === 'short').answer, 'سِفر التكوين');

  // immediately / atDate / never on the same submission
  for (const [answersShow, extra, shows] of [['immediately', {}, true], ['never', {}, false], ['atDate', { answersAt: wallAt(world, 10) }, false]]) {
    call('apiCompSave', id, { answersShow, ...extra });
    publish(world, call);
    const r = pub(world, 'compResult', { receipt: done.receipt }).result;
    assert.equal(!!r.review, shows, answersShow);
  }
  world.advance(11 * 60000);
  assert.ok(pub(world, 'compResult', { receipt: done.receipt }).result.review, 'atDate passed');
  // finalized: the score shows whatever resultsAt says
  call('apiCompSave', id, { resultsAt: wallAt(world, 600) });
  publish(world, call);
  assert.equal(pub(world, 'compResult', { receipt: done.receipt }).result.score, undefined);
  call('apiCompFinalize', id, true);
  assert.equal(pub(world, 'compResult', { receipt: done.receipt }).result.score, 35);
  assert.equal(pub(world, 'compResult', { receipt: 'rc1.x.y' }).code, 'bad');
});

test('survey (scoring off): status submitted, no score, no review marks', () => {
  const world = compWorld();
  const call = adminApi(world);
  const { comp } = call('apiCompCreate', { preset: 'survey', title: 'استبيان', slug: 'survey', enabled: true, answersShow: 'immediately' });
  call('apiCompQuestionSave', comp.id, { type: 'single', text: 'إيه رأيك؟', choices: ['حلو', 'وحش'] });
  call('apiCompQuestionSave', comp.id, { type: 'long', text: 'اقتراحاتك', required: false });
  publish(world, call);
  const s = pub(world, 'compStart', { slug: 'survey', clientKey: clientKey(), fields: person(1) });
  // without its clientKey a token is useless
  const done = pub(world, 'compSubmit', { token: s.attempt.token, answers: {} });
  assert.equal(done.code, 'bad');
  const key = clientKey();
  const s2 = pub(world, 'compStart', { slug: 'survey', clientKey: key, fields: person(2) });
  const sent = pub(world, 'compSubmit', { token: s2.attempt.token, clientKey: key, answers: { [s2.questions[0].id]: s2.questions[0].choices[0].id } });
  assert.equal(sent.result.status, 'submitted');
  assert.equal(sent.result.score, undefined);
  assert.equal(sent.result.review[0].correct, null);
  assert.equal(sent.result.review[0].ok, null);
});


/* ---------------- the transport ---------------- */

test('budget: 300 calls a minute for all comp/portal/shop actions, then busy; the next minute is open', () => {
  const { world } = live();
  world.cache.set('comp:min:' + Math.floor(world.now() / 60000), { value: '300', until: world.now() + 60000 });
  const busy = start(world);
  assert.equal(busy.code, 'busy');
  assert.match(busy.message, /ضغط/);
  world.advance(60000);
  assert.equal(start(world).ok, true);
});

test('size: a request over 64 KB is refused before anything is read; unknown actions; later modules answer disabled', () => {
  const { world } = live();
  const s = begin(world);
  const huge = submit(world, s, { [s.questions[0].id]: 'x'.repeat(70 * 1024) });
  assert.equal(huge.code, 'bad');
  assert.match(huge.message, /كبيرة/);
  for (const fn of ['compCode', 'portalMe', 'portalReview', 'shopRedeem']) assert.equal(pub(world, fn, {}).code, 'disabled', fn);
  assert.equal(pub(world, 'compHack', {}).code, 'bad');
  assert.equal(pub(world, 'shopEverything', {}).code, 'bad');
});

test('later modules plug in: a switched-on module\'s handler answers (and only then)', () => {
  const { world } = live();
  world.gs.compRegistryReady_ = () => true;
  world.gs.compCodeAction_ = arg => ({ ok: true, echo: arg.code });
  assert.equal(pub(world, 'compCode', { code: 'ATH' }).code, 'disabled', 'the switch is off');
  world.properties.set('COMP_REGISTRY', '1');
  assert.deepEqual(plain(pub(world, 'compCode', { code: 'ATH' })), { ok: true, echo: 'ATH' });
  assert.equal(pub(world, 'shopRedeem', {}).code, 'disabled', 'the store needs its own module');
});

test('a broken handler never throws out of doPost and never echoes the request', () => {
  const { world } = live();
  world.gs.compRegistryReady_ = () => true;
  world.gs.compCodeAction_ = () => { throw new Error('secret ATH-2345-6789'); };
  world.properties.set('COMP_REGISTRY', '1');
  const reply = pub(world, 'compCode', { code: 'ATH-2345-6789' });
  assert.equal(reply.code, 'busy');
  assert.ok(!JSON.stringify(reply).includes('2345'));
});

test('the API URL in the page config is the same doPost (text/plain, JSON reply)', () => {
  const { world } = live();
  const reply = world.post({ fn: 'compStart', args: [{ slug: 'bible-quiz', clientKey: clientKey(), fields: person(9) }] });
  assert.equal(reply.mime, 'JSON');
  assert.equal(reply.ok, true);
  assert.ok(SITE);
});

test('stubs are made from the committed engine shell (read from GitHub, cached); without it, the built-in copy', async () => {
  const { FakeGitHub } = await import('./fakes/gas.mjs');
  const shell = '<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">\n<title>shell</title>\n<script type="module" src="../assets/js/comp/main.js"></script>\n</head>\n<body><div id="engine-root"></div></body>\n</html>\n';
  const world = compWorld({ github: new FakeGitHub({ files: { 'competition/index.html': shell } }) });
  const call = adminApi(world);
  scoredComp(call);
  publish(world, call);
  const stub = world.github.files()['competition/bible-quiz/index.html'];
  assert.match(stub, /<div id="engine-root"><\/div>/);
  assert.match(stub, /src="\.\.\/\.\.\/assets\/js\/comp\/main\.js"/);
  assert.match(stub, /data-slug="bible-quiz" data-v="[0-9a-f]{16}"/);
  assert.ok(world.cache.get('comp:shell'), 'cached');
  // the plain world has no shell committed: the built-in copy
  const plainWorld = live().world;
  assert.match(plainWorld.github.files()['competition/bible-quiz/index.html'], /id="comp-main"/, 'the built-in copy has the engine mount points');
});
