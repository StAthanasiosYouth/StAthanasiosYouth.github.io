// Store preview, guests in coded competitions, birth dates and age eligibility,
// and the answers-private default (docs/COMPETITIONS.md §19).

import test from 'node:test';
import assert from 'node:assert/strict';
import { pub, publish, wallAt, clientKey } from './fakes/comp.mjs';
import { regWorld, addPerson, codeOf, login, codedComp, play, answersFor, tab } from './fakes/reg.mjs';

const phone = n => '0101234' + String(n).padStart(4, '0');
let keys = 0;
const requestKey = () => 'req-v3-' + Date.now().toString(36) + '-' + String(++keys).padStart(6, '0');

/* a birth date that makes someone `years` old today (+ `days` until the next birthday) */
function bornFor(world, years, daysToBirthday = 100) {
  const today = new Date(world.now());
  const next = new Date(Date.UTC(today.getUTCFullYear() - years - 1, today.getUTCMonth(), today.getUTCDate() + daysToBirthday));
  return next.toISOString().slice(0, 10);
}

function v3World() {
  const { world, call } = regWorld({ shop: true });
  const young = addPerson(call, 'مينا عادل', phone(1), { birthDate: bornFor(world, 22) });
  const old = addPerson(call, 'فادي يوسف', phone(2), { birthDate: bornFor(world, 31) });
  call('apiWalletAdjust', young.id, 500, 'بداية', 'v3-start-young1');
  call('apiWalletAdjust', old.id, 500, 'بداية', 'v3-start-old-001');
  return { world, call, young, old };
}

/* ---------- §19.1 store preview ---------- */

test('store preview: prizes visible, ordering off; manual or before opening (auto + preview); then the schedule opens it', () => {
  const { world, call, young } = v3World();
  const mug = call('apiShopItemSave', { name: 'كوباية', cost: 50 }).item;
  const token = login(world, codeOf(call, young.id));
  const redeem = () => pub(world, 'shopRedeem', { ptoken: token, itemId: mug.id, requestKey: requestKey() });

  assert.equal(call('apiShopScheduleSave', { mode: 'preview', notify: {} }).state, 'preview');
  assert.equal(redeem().code, 'shop_closed');
  const me = pub(world, 'portalMe', { ptoken: token });
  assert.equal(me.store.state, 'preview');
  assert.ok(me.shop.some(i => i.id === mug.id), 'the prizes come along');

  assert.equal(call('apiShopScheduleSave', { mode: 'auto', preview: true, opensAt: wallAt(world, 60), notify: {} }).state, 'preview');
  assert.equal(call('apiShopScheduleSave', { mode: 'auto', preview: false, opensAt: wallAt(world, 60), notify: {} }).state, 'scheduled');
  call('apiShopScheduleSave', { mode: 'auto', preview: true, opensAt: wallAt(world, 60), notify: {} });
  publish(world, call);
  const shop = JSON.parse(world.github.files()['content.json']).points.shop;
  assert.equal(shop.preview, true);
  assert.equal(shop.mode, 'auto');

  world.advance(61 * 60000);
  world.cache.delete('shop:settings');
  const done = pub(world, 'shopRedeem', { ptoken: login(world, codeOf(call, young.id)), itemId: mug.id, requestKey: requestKey() });
  assert.equal(done.ok, true, JSON.stringify(done));
});

/* ---------- §19.2 guests ---------- */

test('guests: a coded competition that allows guests takes the form; the guest sees the score, never points; codes work as before', () => {
  const { world, call, young } = v3World();
  const comp = codedComp(world, call, { slug: 'guests-ok', preset: 'points', overrides: { allowGuests: true } });
  const json = JSON.parse(world.github.files()['competition/guests-ok/comp.json']);
  assert.equal(json.allowGuests, true);
  assert.ok(json.fields.some(f => f.key === 'name'), 'the guest form');

  const key = clientKey();
  const start = pub(world, 'compStart', { slug: 'guests-ok', clientKey: key, fields: { name: 'زائر كبير', phone: phone(77) } });
  assert.equal(start.ok, true, JSON.stringify(start));
  const done = pub(world, 'compSubmit', { token: start.attempt.token, clientKey: key, answers: answersFor(start, true) });
  assert.equal(done.ok, true);
  assert.equal(done.result.guest, true);
  assert.ok(!('pointsAwarded' in done.result) || !done.result.pointsAwarded, 'no points for a guest');
  const row = tab(world, 'Submissions').find(s => s.id === start.attempt.id);
  assert.equal(row.participantId, '');
  assert.match(row.flags, /guest/);
  assert.ok(!tab(world, 'PointsLedger').some(l => l.refId === start.attempt.id));

  // a code still earns
  const coded = play(world, login(world, codeOf(call, young.id)), { slug: 'guests-ok' });
  assert.ok(tab(world, 'PointsLedger').some(l => l.refId === coded.id && Number(l.amount) === 15));
  assert.ok(comp.id);

  // without the option: a code is needed
  codedComp(world, call, { slug: 'codes-only', preset: 'points' });
  assert.equal(pub(world, 'compStart', { slug: 'codes-only', clientKey: clientKey(), fields: { name: 'x y', phone: phone(78) } }).code, 'session');
});

/* ---------- §19.3 birth dates and age eligibility ---------- */

test('birth dates: typed forms, Arabic digits, a real date only; the import column', () => {
  const { world, call } = v3World();
  const today = new Date(world.now()).toISOString().slice(0, 10);
  const parse = value => world.gs.regBirthDate_(value, today);
  assert.equal(parse('15/03/1998').date, '1998-03-15');
  assert.equal(parse('١٥-٣-١٩٩٨').date, '1998-03-15');
  assert.equal(parse('1998-03-15').date, '1998-03-15');
  assert.equal(parse({ day: 9, month: 1, year: 2001 }).date, '2001-01-09');
  assert.equal(parse('').date, '');
  assert.match(parse('31/02/2000').problem, /حقيقي/);
  assert.match(parse('01/01/2999').problem, /المستقبل/);
  assert.throws(() => call('apiParticipantSave', { name: 'تاريخ غلط', phone: phone(40), birthDate: '31/02/2000' }), /حقيقي/);

  const preview = call('apiParticipantsImportPreview', 'الاسم بالكامل\tرقم الموبايل\tتاريخ الميلاد\nمريم عادل\t' + phone(41) + '\t20/05/2003');
  assert.equal(preview.rows[0].birthDate, '2003-05-20');
});

test('age: eligibility follows the rules at once; codes and history never change; outside = a friendly notice, no points, no ordering', () => {
  const { world, call, young, old } = v3World();
  const list = call('apiParticipants', {});
  assert.deepEqual(list.ageRules, { min: 18, max: 30, warnDays: 60 });
  assert.equal(list.items.find(p => p.id === old.id).eligibility, 'out');
  assert.equal(list.items.find(p => p.id === young.id).eligibility, 'ok');
  assert.equal(call('apiParticipants', { eligibility: 'out' }).items.length, 1);

  codedComp(world, call, { slug: 'age-quiz', preset: 'points' });
  const oldCode = codeOf(call, old.id);
  const entered = pub(world, 'compCode', { code: oldCode });
  assert.equal(entered.ok, true, 'the code still works');
  assert.equal(entered.eligible, false);
  assert.match(entered.notice, /خارج الفئة العمرية/);
  assert.doesNotMatch(entered.notice, /اتمسح|مش صحيح/);

  const played = play(world, entered.ptoken, { slug: 'age-quiz' });
  assert.equal(played.done.result.noPoints, true);
  assert.ok(!tab(world, 'PointsLedger').some(l => l.refId === played.id && l.kind === 'competition'), 'no points');
  const mug = call('apiShopItemSave', { name: 'كوباية', cost: 50 }).item;
  assert.equal(pub(world, 'shopRedeem', { ptoken: entered.ptoken, itemId: mug.id, requestKey: requestKey() }).code, 'not_eligible');
  assert.equal(pub(world, 'portalMe', { ptoken: entered.ptoken }).eligible, false);

  // the rules move: the same code is eligible again at once; the earlier attempt keeps «no points»
  call('apiAgeRulesSave', { min: 18, max: 35, warnDays: 60 });
  const again = pub(world, 'compCode', { code: oldCode });
  assert.equal(again.eligible, undefined);
  assert.equal(codeOf(call, old.id), oldCode, 'the same code');
  call('apiWalletSync');
  assert.ok(!tab(world, 'PointsLedger').some(l => l.refId === played.id && l.kind === 'competition'), 'past attempt stays without points');
});

test('age: «قرب يخرج من السن» within the warning days, with the day they leave', () => {
  const { world, call } = v3World();
  const soon = addPerson(call, 'بيشوي سمير', phone(9), { birthDate: bornFor(world, 30, 20) });
  const person = call('apiParticipants', { eligibility: 'soon' }).items.find(p => p.id === soon.id);
  assert.ok(person, 'listed as soon');
  assert.equal(person.age, 30);
  assert.match(person.leavesAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(call('apiParticipants', {}).eligibility.soon >= 1);
});

/* ---------- answers stay private by default ---------- */

test('privacy: every preset keeps the answers hidden; the result is only the score', () => {
  const { world, call } = v3World();
  for (const preset of ['survey', 'scored', 'points']) {
    assert.equal(world.gs.COMP_PRESETS[preset].answersShow, 'never', preset);
  }
  const created = call('apiCompCreate', { preset: 'scored', title: 'مسابقة سرية', slug: 'secret-quiz', enabled: true });
  call('apiCompQuestionSave', created.comp.id, { type: 'truefalse', text: 'سؤال', correct: 'صح', points: 10 });
  publish(world, call);
  const key = clientKey();
  const start = pub(world, 'compStart', { slug: 'secret-quiz', clientKey: key, fields: { name: 'مينا عادل', phone: phone(55) } });
  const done = pub(world, 'compSubmit', { token: start.attempt.token, clientKey: key, answers: { [start.questions[0].id]: 'f' } });
  assert.equal(done.result.review, undefined, 'no per-question data');
  assert.equal(done.result.answersAt, undefined);
  assert.ok('score' in done.result || 'correctCount' in done.result);
});
