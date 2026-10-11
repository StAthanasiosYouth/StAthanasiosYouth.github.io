// Competitions security fixes (review H1, M1–M5, L1–L2): the public `v` is a
// keyed hash; explanation pictures stay off the site until the answers
// open; «afterClose» waits for the grace; per-family / per-competition
// budgets counted after a shape check; a cap on unsent attempts; publish
// warnings; one phone identity; registered attempts die with their code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { compWorld, adminApi, pub, clientKey, publish, scoredComp, webp, plain } from './fakes/comp.mjs';
import { regWorld, addPerson, codeOf, login, codedComp, answersFor as codedAnswers } from './fakes/reg.mjs';
import { loadGs } from '../tools/lib/gs.mjs';

const phone = n => '0101234' + String(n).padStart(4, '0');
const person = n => ({ name: 'مشترك ' + n, phone: phone(n) });
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');

function snapshotDef(world, compId, version) {
  const rows = world.compSpreadsheet.getSheetByName('Snapshots').data.slice(1).filter(r => r[0] === compId && r[1] === version);
  return rows.sort((a, b) => a[2] - b[2]).map(r => String(r[3]).replace(/^'(?=[=+\-@])/, '')).join('');
}

function playOnce(world, slug, n, answers = {}) {
  const key = clientKey();
  const s = pub(world, 'compStart', { slug, clientKey: key, fields: person(n) });
  assert.equal(s.ok, true, JSON.stringify(s));
  const sent = {};
  for (const q of s.questions) {
    if (q.type === 'single') sent[q.id] = q.choices[0].id;
    if (q.type === 'truefalse') sent[q.id] = 't';
    if (q.type === 'short') sent[q.id] = 'التكوين';
    if (q.type === 'number') sent[q.id] = '27';
    if (q.type === 'multi') sent[q.id] = [q.choices[0].id];
    Object.assign(sent, answers);
  }
  const done = pub(world, 'compSubmit', { token: s.attempt.token, clientKey: key, answers: sent });
  assert.equal(done.ok, true, JSON.stringify(done));
  return done;
}


/* ---------------- H1: the version is a keyed hash ---------------- */

test('H1: v = HMAC-SHA256(definition, COMP_SECRET)[0..16], not sha256: the public v can\'t test a guessed key', () => {
  const world = compWorld();
  const call = adminApi(world);
  const { id } = scoredComp(call);
  publish(world, call);
  const v = JSON.parse(world.github.files()['competition/bible-quiz/comp.json']).v;
  const json = snapshotDef(world, id, v);
  assert.ok(json.includes('"correct"'), 'the private definition');
  assert.notEqual(v, sha(json).slice(0, 16), 'never the plain hash');
  assert.equal(v, createHmac('sha256', Buffer.from(world.properties.get('COMP_SECRET'), 'utf8')).update(json, 'utf8').digest('hex').slice(0, 16));
  assert.equal(JSON.parse(world.github.files()['content.json']).competitions[0].v, v);
  assert.match(world.github.files()['competition/bible-quiz/index.html'], new RegExp(`data-v="${v}"`));
  // the builder compares like with like
  assert.equal(call('apiComps').comps[0].hasChanges, false);
  assert.equal(call('apiComp', id).draftVersion, v);
  // another deployment (another secret), the same content: another v
  const other = compWorld();
  const otherCall = adminApi(other);
  scoredComp(otherCall);
  publish(other, otherCall);
  assert.notEqual(JSON.parse(other.github.files()['competition/bible-quiz/comp.json']).v, v);
});


/* ---------------- M1: explanation pictures wait for the answers ---------------- */

test('M1: explanation pictures are not committed until the answers open; review shows them only once published; warnings', () => {
  const world = compWorld();
  const call = adminApi(world);
  const qpic = call('apiUploadMedia', { full: webp(21).toString('base64'), thumb: webp(21).toString('base64'), mime: 'image/webp', width: 800, height: 800, alt: 'س' }).media;
  const xpic = call('apiUploadMedia', { full: webp(22).toString('base64'), thumb: webp(22).toString('base64'), mime: 'image/webp', width: 800, height: 800, alt: 'ش' }).media;
  const { comp } = call('apiCompCreate', { preset: 'scored', title: 'بشرح', slug: 'explained', enabled: true, answersShow: 'afterClose', resultShow: 'score' });
  call('apiCompQuestionSave', comp.id, { type: 'truefalse', text: 'ده؟', media: qpic.id, correct: 't', explanation: 'شرح', explanationMedia: xpic.id });

  const warnings = call('apiComp', comp.id).warnings;
  assert.ok(warnings.includes('صور الأسئلة بتبقى على الموقع من وقت النشر — متحطش صورة فيها الإجابة'));
  assert.ok(warnings.some(w => /صور شرح الإجابات/.test(w)));
  const review = call('apiReview');
  assert.ok(review.warnings.some(w => w.message === 'صور الأسئلة بتبقى على الموقع من وقت النشر — متحطش صورة فيها الإجابة'));
  assert.deepEqual(review.errors, []);

  publish(world, call);
  let files = world.github.files();
  assert.ok(files[qpic.path], 'the question picture goes out (needed at start)');
  assert.ok(!files[xpic.path], 'the explanation picture does not');

  const done = playOnce(world, 'explained', 1);
  call('apiCompClose', comp.id);
  world.advance(5 * 60000);
  const r1 = pub(world, 'compResult', { receipt: done.receipt }).result;
  assert.equal(r1.review[0].explanation, 'شرح');
  assert.equal(r1.review[0].explanationMedia, null, 'not on the site yet: no picture');

  // a publish after the answers opened sends it (the revision is the same: the waiting picture makes the commit)
  publish(world, call);
  files = world.github.files();
  assert.ok(files[xpic.path], 'now committed');
  assert.ok(!call('apiComp', comp.id).warnings.some(w => /صور شرح الإجابات/.test(w)));
  const r2 = pub(world, 'compResult', { receipt: done.receipt }).result;
  assert.equal(r2.review[0].explanationMedia.src, xpic.path);
});


/* ---------------- M2: afterClose waits for every possible submit ---------------- */

test('M2: afterClose opens only after the effective end (end or «اقفل دلوقتي») + grace + slack; withdrawn is not closed', () => {
  const world = compWorld();
  const call = adminApi(world);
  const { id } = scoredComp(call, { answersShow: 'afterClose', resultShow: 'score' });
  publish(world, call);
  const done = playOnce(world, 'bible-quiz', 1);
  call('apiCompClose', id);
  const at = minutes => { world.advance(minutes * 60000); return pub(world, 'compResult', { receipt: done.receipt }).result; };
  assert.equal(at(0).review, undefined, 'closed now, but attempts in their grace may still send');
  assert.equal(at(3).review, undefined);
  assert.ok(at(2).review, 'after the grace and the slack');

  // a withdrawn competition before its end: no key
  const w2 = compWorld();
  const c2 = adminApi(w2);
  const made = scoredComp(c2, { answersShow: 'afterClose', resultShow: 'score', endAt: '2099-01-01 10:00' });
  publish(w2, c2);
  const d2 = playOnce(w2, 'bible-quiz', 1);
  c2('apiCompSave', made.id, { enabled: false });
  publish(w2, c2);
  assert.equal(pub(w2, 'compResult', { receipt: d2.receipt }).result.review, undefined, 'withdrawn ≠ closed');

  // pure rule
  const gs = loadGs(['Platforms.gs', 'Content.gs', 'Hub.gs', 'CompModel.gs', 'CompScore.gs']);
  const def = { answersShow: 'afterClose', endAt: '2026-10-20T12:00', startAt: '' };
  assert.equal(gs.compAnswersOpen_(def, {}, '2026-10-20T12:04'), false);
  assert.equal(gs.compAnswersOpen_(def, {}, '2026-10-20T12:05'), true);
  assert.equal(gs.compAnswersOpen_(def, { closedAt: '2026-10-20T11:00' }, '2026-10-20T11:05'), true, 'the earlier of end and close');
  assert.equal(gs.compAnswersOpen_({ answersShow: 'afterClose', endAt: '' }, {}, '2099-01-01T00:00'), false, 'no end: never by itself');
  assert.equal(gs.compAnswersOpen_({ answersShow: 'afterClose', endAt: '' }, { finalizedAt: '2026-10-20 10:00' }, '2026-10-20T10:00'), true);
  assert.equal(gs.compAnswersOpen_({ answersShow: 'immediately', startAt: '2026-10-20T10:00' }, {}, '2026-10-20T09:59'), false);
});


/* ---------------- M3: budgets ---------------- */

test('M3: malformed calls never spend a budget; families are separate; one competition can\'t take all the starts', () => {
  const world = compWorld();
  const call = adminApi(world);
  scoredComp(call);
  publish(world, call);
  const minute = () => Math.floor(world.now() / 60000);
  for (let i = 0; i < 20; i++) assert.equal(pub(world, 'compStart', { slug: 'Bad Slug', clientKey: 'x' }).code, 'bad');
  for (let i = 0; i < 5; i++) assert.equal(pub(world, 'compSubmit', { token: 'nope', clientKey: clientKey() }).code, 'bad');
  assert.equal(world.cache.get('comp:min:play:' + minute()), undefined, 'nothing counted');

  // the play family full: start / submit / result busy; codes and the portal still answer
  world.cache.set('comp:min:play:' + minute(), { value: '600', until: world.now() + 60000 });
  assert.equal(pub(world, 'compStart', { slug: 'bible-quiz', clientKey: clientKey(), fields: person(1) }).code, 'busy');
  assert.equal(pub(world, 'compCode', { code: 'ATH-2345-6789' }).code, 'disabled', 'its own budget (and its switch)');
  assert.equal(world.cache.get('comp:min:code:' + minute()).value, '1');
  world.advance(60000);

  // one slug's start budget
  world.cache.set('comp:start:bible-quiz:' + minute(), { value: '200', until: world.now() + 60000 });
  assert.equal(pub(world, 'compStart', { slug: 'bible-quiz', clientKey: clientKey(), fields: person(2) }).code, 'busy');
  world.advance(60000);
  assert.equal(pub(world, 'compStart', { slug: 'bible-quiz', clientKey: clientKey(), fields: person(2) }).ok, true);
  const gs = world.gs;
  assert.equal(gs.COMP_FAMILY_PER_MINUTE.play, 600);
  assert.equal(gs.COMP_FAMILY_PER_MINUTE.code, 120);
  assert.equal(gs.COMP_FAMILY_PER_MINUTE.portal, 300);
  assert.equal(gs.COMP_FAIL_PER_MINUTE, 60);
});


/* ---------------- M4: a cap on unsent attempts ---------------- */

test('M4: unsent attempts per competition are capped (live ones only: older than 48 h no longer count)', () => {
  const world = compWorld();
  const call = adminApi(world);
  scoredComp(call);
  publish(world, call);
  world.gs.COMP_MAX_OPEN_ATTEMPTS = 2;
  const start = n => pub(world, 'compStart', { slug: 'bible-quiz', clientKey: clientKey(), fields: person(n) });
  assert.equal(start(1).ok, true);
  assert.equal(start(2).ok, true);
  const full = start(3);
  assert.equal(full.code, 'limit');
  assert.match(full.message, /ضغط كبير/);
  world.advance(49 * 3600000);
  assert.equal(start(3).ok, true, 'abandoned attempts age out');
});


/* ---------------- M5: warnings, one phone identity ---------------- */

test('M5a: an open competition that shows the score at once warns unless it is one submission per number and one attempt', () => {
  const world = compWorld();
  const call = adminApi(world);
  const { id } = scoredComp(call, { resultShow: 'score' });
  const retry = 'أي حد يقدر يحاول كذا مرة ويعرف الإجابات من الدرجة';
  assert.ok(call('apiComp', id).warnings.includes(retry));
  call('apiCompSave', id, { uniquePhone: true, attempts: 1 });
  assert.ok(!call('apiComp', id).warnings.includes(retry));
  call('apiCompSave', id, { uniquePhone: false, resultsAt: '2099-01-01 10:00' });
  assert.ok(!call('apiComp', id).warnings.includes(retry), 'the score waits: no warning');
});

test('M5b: every way of writing an Egyptian number is one identity (uniquePhone, attempts); other numbers are their digits', () => {
  const gs = loadGs(['Platforms.gs', 'Content.gs', 'Hub.gs', 'CompModel.gs', 'CompScore.gs']);
  for (const form of ['01012345678', '+20 010 1234 5678', '+201012345678', '00201012345678', '0020 10 1234 5678', '1012345678', '٠١٠١٢٣٤٥٦٧٨', '(010) 1234-5678', '2001012345678']) {
    assert.equal(gs.compNormPhoneEg_(form), '+201012345678', form);
  }
  assert.equal(gs.compNormPhoneEg_('+44 7700 900123'), '');
  const values = plain(gs.compFieldValues_([{ key: 'phone', label: 'الموبايل', type: 'phone', mode: 'required' }], { phone: '+44 7700 900123' }));
  assert.equal(values.phone, '+447700900123');

  const world = compWorld();
  const call = adminApi(world);
  scoredComp(call, { uniquePhone: true, attempts: 3 });
  publish(world, call);
  playOnce(world, 'bible-quiz', 99);
  const key = clientKey();
  const done = playOnceWith(world, key, { name: 'أ', phone: '01012345678' });
  assert.equal(done.ok, true);
  for (const form of ['+20 010 1234 5678', '0020 1012345678', '1012345678']) {
    assert.equal(pub(world, 'compStart', { slug: 'bible-quiz', clientKey: clientKey(), fields: { name: 'ب', phone: form } }).code, 'limit', form);
  }
});

function playOnceWith(world, key, fields) {
  const s = pub(world, 'compStart', { slug: 'bible-quiz', clientKey: key, fields });
  const sent = {};
  for (const q of s.questions) {
    if (q.type === 'single') sent[q.id] = q.choices[0].id;
    if (q.type === 'truefalse') sent[q.id] = 't';
    if (q.type === 'short') sent[q.id] = 'x';
    if (q.type === 'number') sent[q.id] = '1';
    if (q.type === 'multi') sent[q.id] = [q.choices[0].id];
  }
  return pub(world, 'compSubmit', { token: s.attempt.token, clientKey: key, answers: sent });
}


/* ---------------- L1 / L2: registered attempts ---------------- */

test('L1: another participant\'s attempt key is refused, never resumed', () => {
  const { world, call } = regWorld();
  const a = addPerson(call, 'مينا عادل', phone(61));
  const b = addPerson(call, 'بيتر سمير', phone(62));
  codedComp(world, call);
  const key = clientKey();
  const mine = pub(world, 'compStart', { slug: 'coded-quiz', clientKey: key, ptoken: login(world, codeOf(call, a.id)) });
  assert.equal(mine.ok, true);
  const theirs = pub(world, 'compStart', { slug: 'coded-quiz', clientKey: key, ptoken: login(world, codeOf(call, b.id)) });
  assert.equal(theirs.code, 'bad');
  assert.ok(!JSON.stringify(theirs).includes(mine.attempt.id));
});

test('L2: a code reset or a deactivation kills a registered attempt in flight (session); the token carries the codeVersion', () => {
  const { world, call } = regWorld();
  const p = addPerson(call, 'مينا عادل', phone(63));
  const q = addPerson(call, 'بيتر سمير', phone(64));
  codedComp(world, call);
  const key = clientKey();
  const s = pub(world, 'compStart', { slug: 'coded-quiz', clientKey: key, ptoken: login(world, codeOf(call, p.id)) });
  const payload = world.gs.compReadToken_('at1', s.attempt.token).payload;
  assert.equal(payload.p, p.id);
  assert.equal(payload.cv, 1);
  call('apiParticipantResetCode', p.id);
  const dead = pub(world, 'compSubmit', { token: s.attempt.token, clientKey: key, answers: codedAnswers(s) });
  assert.equal(dead.code, 'session');

  const key2 = clientKey();
  const s2 = pub(world, 'compStart', { slug: 'coded-quiz', clientKey: key2, ptoken: login(world, codeOf(call, q.id)) });
  call('apiParticipantSetActive', q.id, false);
  assert.equal(pub(world, 'compSubmit', { token: s2.attempt.token, clientKey: key2, answers: codedAnswers(s2) }).code, 'session');
  call('apiParticipantSetActive', q.id, true);
  assert.equal(pub(world, 'compSubmit', { token: s2.attempt.token, clientKey: key2, answers: codedAnswers(s2) }).ok, true, 'active again, same code: fine');
});
