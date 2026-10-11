// Competitions Phase 3, the wallet (CompWallet.gs): competition points
// follow the grade (auto at submit, manual review, group review, regrade,
// void / unvoid) through walletReconcile_ — idempotent, append-only, only
// for wallet competitions and registered submissions, nothing while the
// switch is off — manual adjustments, the admin lists and the busy queue.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pub, clientKey, publish, plain } from './fakes/comp.mjs';
import { regWorld, addPerson, codeOf, login, codedComp, play, answersFor, activityRows, tab, phone } from './fakes/reg.mjs';

function walletWorld(options = {}) {
  const { world, call } = regWorld({ wallet: true });
  const mina = addPerson(call, 'مينا عادل', phone(1), { group: 'ثانوي' });
  const mariam = addPerson(call, 'مريم زكريا', phone(2), { group: 'ثانوي' });
  const comp = codedComp(world, call, { preset: 'points', long: !!options.long, overrides: options.overrides || {} });
  return { world, call, mina, mariam, comp, tokens: { mina: login(world, codeOf(call, mina.id)), mariam: login(world, codeOf(call, mariam.id)) } };
}

const ledger = world => tab(world, 'PointsLedger');

test('auto award: a graded submit puts the score in the wallet (one competition row, sub:<id>:0); the result shows the points', () => {
  const { world, mina, tokens } = walletWorld();
  const { id, done } = play(world, tokens.mina);
  assert.equal(done.result.status, 'graded');
  const rows = ledger(world);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].participantId, rows[0].amount, rows[0].kind, rows[0].refType, rows[0].refId, rows[0].idemKey, rows[0].actor], [mina.id, '15', 'competition', 'submission', id, `sub:${id}:0`, '']);
  assert.match(rows[0].id, /^l-[0-9a-f]{12}$/);
  assert.equal(done.result.pointsAwarded, 15);
  assert.equal(pub(world, 'compResult', { receipt: done.receipt }).result.pointsAwarded, 15);
  const me = pub(world, 'portalMe', { ptoken: tokens.mina });
  assert.equal(me.balance, 15);
  assert.deepEqual([me.history[0].submissionId, me.history[0].pointsAwarded], [id, 15]);
  assert.deepEqual([me.ledger[0].kind, me.ledger[0].amount], ['competition', 15]);
  assert.match(me.ledger[0].compTitle, /مسابقة بأكواد/);
  // a half-right attempt by someone else: only their score
  const other = play(world, tokens.mariam, { right: 'half' });
  assert.equal(other.done.result.pointsAwarded, 10);
  assert.equal(ledger(world).length, 2);
});

test('reconcile is idempotent: three more runs add nothing; the ledger is never edited', () => {
  const { world, tokens } = walletWorld();
  const { id } = play(world, tokens.mina);
  const before = JSON.stringify(ledger(world));
  for (let i = 0; i < 3; i++) world.gs.walletReconcile_(id);
  world.gs.walletReconcileMany_([id, id]);
  assert.equal(JSON.stringify(ledger(world)), before);
});

test('pending → manual grade → award; changing the mark again → a correction row; group grade too', () => {
  const { world, call, tokens } = walletWorld({ long: true });
  const a = play(world, tokens.mina);
  assert.equal(a.done.result.status, 'pending_review');
  assert.equal(ledger(world).length, 0, 'nothing while it waits for review');
  const sub = call('apiCompSubmission', a.id);
  const longQ = sub.questions.find(q => q.type === 'long').id;
  call('apiCompGrade', a.id, { [longQ]: 12 });
  let rows = ledger(world);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, '27');
  assert.equal(rows[0].kind, 'competition');
  call('apiCompGrade', a.id, { [longQ]: true });
  rows = ledger(world);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[1].amount, rows[1].kind, rows[1].idemKey], ['8', 'correction', `sub:${a.id}:1`]);
  // back to pending: the points go back out
  call('apiCompGrade', a.id, { [longQ]: null });
  rows = ledger(world);
  assert.equal(rows[2].amount, '-35');
  assert.equal(world.gs.walletPointsFor_(a.id), 0);

  // a group grade awards everyone in the group
  const b = play(world, tokens.mariam);
  const queue = call('apiCompReviewQueue', sub.comp.id);
  const group = queue.groups.find(g => g.qid === longQ);
  assert.equal(group.count, 2);
  call('apiCompGradeGroup', sub.comp.id, longQ, group.key, true);
  assert.equal(world.gs.walletPointsFor_(a.id), 35);
  assert.equal(world.gs.walletPointsFor_(b.id), 35);
});

test('regrade with a corrected key → a correction row with the difference; void → the points go back; unvoid → they return', () => {
  const { world, call, comp, tokens } = walletWorld();
  const { id } = play(world, tokens.mina);                 // 15 (نوح + صح)
  const tf = call('apiComp', comp.id).questions.find(q => q.type === 'truefalse');
  call('apiCompQuestionSave', comp.id, { ...tf, correct: 'غلط' });
  publish(world, call);
  const report = call('apiCompRegrade', comp.id);
  assert.equal(report.changed, 1);
  let rows = ledger(world);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[1].amount, rows[1].kind, rows[1].idemKey], ['-5', 'correction', `sub:${id}:1`]);
  // regrading again changes nothing
  call('apiCompRegrade', comp.id);
  assert.equal(ledger(world).length, 2);

  call('apiCompVoid', id, true);
  rows = ledger(world);
  assert.equal(rows[2].amount, '-10');
  assert.equal(world.gs.walletBalance_(rows[0].participantId, true), 0);
  call('apiCompVoid', id, false);
  assert.equal(ledger(world)[3].amount, '10');
  assert.equal(world.gs.walletPointsFor_(id), 10);
});

test('no points: the wallet switched off (nothing written; healed when it comes back), a competition without wallet, open competitions', () => {
  const { world, call, tokens } = walletWorld();
  call('apiCompSettings', { wallet: false });
  const { id } = play(world, tokens.mina);
  assert.equal(ledger(world).length, 0, 'switched off: no ledger rows');
  assert.equal(world.gs.walletReconcile_(id).appended, 0, 'a direct call is a no-op too');
  call('apiCompSettings', { wallet: true });
  world.gs.walletReconcile_(id);
  assert.equal(ledger(world).length, 1, 'back on: the next reconcile catches up');

  // a registered competition with scoring but no wallet
  codedComp(world, call, { slug: 'no-wallet', preset: 'coded' });
  play(world, tokens.mariam, { slug: 'no-wallet' });
  assert.equal(ledger(world).length, 1);

  // an open competition never touches the ledger
  const open = call('apiCompCreate', { preset: 'scored', title: 'مفتوحة', slug: 'open-quiz', enabled: true });
  call('apiCompQuestionSave', open.comp.id, { type: 'truefalse', text: 'سؤال', correct: 'صح', points: 5 });
  publish(world, call);
  const key = clientKey();
  const s = pub(world, 'compStart', { slug: 'open-quiz', clientKey: key, fields: { name: 'زائر', phone: phone(9) } });
  pub(world, 'compSubmit', { token: s.attempt.token, clientKey: key, answers: { [s.questions[0].id]: 't' } });
  world.gs.walletReconcile_(s.attempt.id);
  assert.equal(ledger(world).length, 1);
});

test('busy live lock: the reconcile waits in a queue and the next one (or the wallet screen) catches up', () => {
  const { world, call, mina, tokens } = walletWorld({ long: true });
  const a = play(world, tokens.mina);
  const longQ = call('apiCompSubmission', a.id).questions.find(q => q.type === 'long').id;
  // grade with the wallet code failing to get the lock right after
  const reconcile = world.gs.walletReconcileMany_;
  let failNext = true;
  world.gs.walletReconcileMany_ = ids => {
    if (failNext && ids.length) { failNext = false; world.userLock.busy = true; try { return reconcile(ids); } finally { world.userLock.busy = false; } }
    return reconcile(ids);
  };
  call('apiCompGrade', a.id, { [longQ]: true });
  assert.equal(ledger(world).length, 0, 'the lock was busy');
  assert.ok(world.cache.get('wal:retry'), 'queued');
  world.gs.walletReconcileMany_ = reconcile;
  const list = call('apiWallet', {});
  assert.equal(ledger(world).length, 1);
  assert.equal(list.items.find(i => i.id === mina.id).balance, 35);
});

test('manual adjustment: idempotent by key, never below zero, note required, logged (no phone); apiWallet / apiWalletParticipant', () => {
  const { world, call, mina, mariam, tokens } = walletWorld();
  play(world, tokens.mina);                                  // +15
  const first = call('apiWalletAdjust', mina.id, 50, 'حضور الاجتماع ٤ مرات', 'adjust-key-0001');
  assert.equal(first.replay, false);
  assert.equal(first.balance, 65);
  assert.equal(first.entry.amount, 50);
  const again = call('apiWalletAdjust', mina.id, 50, 'حضور الاجتماع ٤ مرات', 'adjust-key-0001');
  assert.equal(again.replay, true);
  assert.equal(again.entry.id, first.entry.id);
  assert.equal(again.balance, 65);
  assert.equal(ledger(world).filter(r => r.kind === 'manual').length, 1, 'one row for one key');
  assert.equal(ledger(world).find(r => r.kind === 'manual').idemKey, 'adj:adjust-key-0001');

  assert.throws(() => call('apiWalletAdjust', mina.id, -66, 'غلطة', 'adjust-key-0002'), /بالسالب: رصيده دلوقتي ٦٥/);
  assert.equal(call('apiWalletAdjust', mina.id, -65, 'تصحيح', 'adjust-key-0003').balance, 0);
  for (const [amount, note] of [[0, 'x'], [1.5, 'x'], [2000000, 'x'], ['10', 'x'], [5, ''], [5, 'x'.repeat(201)]]) {
    assert.throws(() => call('apiWalletAdjust', mina.id, amount, note, 'adjust-key-0004'));
  }
  assert.throws(() => call('apiWalletAdjust', mina.id, 5, 'x', 'bad key'), /adjustKey/);
  call('apiWalletAdjust', mariam.id, 20, 'مساعدة في الخدمة', 'adjust-key-0005');

  const acts = activityRows(world).filter(r => r[5] === 'points.adjust');
  assert.equal(acts.length, 3, 'a replay is not logged again');
  assert.match(acts[0][9], /عدّل نقاط «مينا عادل» \(\+٥٠\)/);
  assert.ok(!acts.flat().some(c => String(c).includes(mina.phone.slice(1))));

  const list = call('apiWallet', {});
  assert.deepEqual(list.items.map(i => [i.name, i.balance]), [['مريم زكريا', 20], ['مينا عادل', 0]]);
  assert.deepEqual(plain(list.totals), { participants: 2, balance: 20, earned: 15, adjusted: 5, spent: 0, entries: 4 });
  assert.equal(call('apiWallet', { q: 'مينا' }).items.length, 1);
  assert.equal(call('apiWallet', { sort: 'name' }).items[0].name, 'مريم زكريا');

  const detail = call('apiWalletParticipant', mina.id);
  assert.equal(detail.balance, 0);
  assert.deepEqual(detail.entries.map(e => [e.kind, e.amount, e.balanceAfter]), [['manual', -65, 0], ['manual', 50, 65], ['competition', 15, 15]]);
  assert.match(detail.entries[2].compTitle, /مسابقة بأكواد/);
  assert.equal(detail.totals.earned, 15);
  assert.ok(!JSON.stringify(detail).includes('ATH-'));

  // the participant's page lists points per competition
  const one = call('apiParticipant', mina.id);
  assert.equal(one.history[0].points, 15);
  assert.equal(one.wallet.balance, 0);
  assert.equal(call('apiParticipants', {}).items.find(p => p.id === mina.id).balance, 0);
});

test('live wallet writes run only from the official admin (API mode)', () => {
  const { world, mina } = walletWorld();
  world.properties.set('ADMIN_EMAILS', 'menazakmena@gmail.com');
  assert.throws(() => world.as('menazakmena@gmail.com').gs.apiWalletAdjust(mina.id, 5, 'x', 'adjust-key-0009'), /لوحة التحكم الرسمية/);
});


/* ---------------- drift safety ---------------- */

/* plays while every reconcile fails and nothing is queued (as if wal:retry were lost) */
function playLost(world, ptoken) {
  const real = world.gs.walletReconcileMany_;
  world.gs.walletReconcileMany_ = () => { throw new Error('lost'); };
  try {
    return play(world, ptoken);
  }
  finally {
    world.gs.walletReconcileMany_ = real;
    world.cache.delete('wal:retry');
  }
}

test('drift: a lost reconcile is healed by the participant\'s wallet page (theirs only) and by apiWalletSync (everyone, idempotent, logged only when it fixed something)', () => {
  const { world, call, mina, mariam, tokens } = walletWorld();
  playLost(world, tokens.mina);
  playLost(world, tokens.mariam);
  assert.equal(ledger(world).length, 0, 'drifted');

  const detail = call('apiWalletParticipant', mina.id);
  assert.equal(detail.balance, 15, 'healed on view');
  assert.deepEqual(ledger(world).map(r => r.participantId), [mina.id], 'only theirs');

  const sync = call('apiWalletSync');
  assert.deepEqual(plain(sync), { checked: 2, fixed: 1, entries: 1 });
  assert.equal(world.gs.walletBalance_(mariam.id, true), 15);
  const logged = activityRows(world).filter(r => r[5] === 'points.adjust' && r[7] === 'sync');
  assert.equal(logged.length, 1);
  assert.equal(logged[0][9], 'راجع النقاط مع النتايج (١ مشاركة اتصلحت)');

  assert.deepEqual(plain(call('apiWalletSync')), { checked: 2, fixed: 0, entries: 0 }, 'a second run fixes nothing');
  assert.equal(activityRows(world).filter(r => r[7] === 'sync').length, 1, 'not logged when nothing was fixed');
  assert.equal(ledger(world).length, 2);
});

test('drift: the wallet list heals the latest graded submissions; apiWalletSync also reverses points of a competition whose wallet went off', () => {
  const { world, call, mina, comp, tokens } = walletWorld();
  playLost(world, tokens.mina);
  assert.equal(call('apiWallet', {}).items.find(i => i.id === mina.id).balance, 15);

  // the competition stops giving points (republished without the wallet): the sync takes them back
  call('apiCompSave', comp.id, { wallet: false, resultShow: 'score' });
  publish(world, call);
  const sync = call('apiWalletSync');
  assert.equal(sync.fixed, 1);
  assert.equal(world.gs.walletBalance_(mina.id, true), 0);
  assert.equal(ledger(world).at(-1).kind, 'correction');
});
