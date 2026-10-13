// Competitions Phase 3, the store and «نقاطي» (CompStoreItems.gs, the portal
// parts of CompRegistry.gs / CompWallet.gs): items, redeeming under the live
// lock (balance, stock, per-person limit, idempotent requestKey, never an
// overspend), statuses with a refund once, pictures that reach the site with
// the publish, portalMe shapes per module, portalReview's policy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pub, publish, webp, plain } from './fakes/comp.mjs';
import { regWorld, addPerson, codeOf, login, codedComp, play, activityRows, tab, phone } from './fakes/reg.mjs';

let keys = 0;
const requestKey = () => 'req-' + Date.now().toString(36) + '-' + String(++keys).padStart(8, '0');

function shopWorld() {
  const { world, call } = regWorld({ shop: true });
  const mina = addPerson(call, 'مينا عادل', phone(1), { group: 'ثانوي' });
  const mariam = addPerson(call, 'مريم زكريا', phone(2), { group: 'ثانوي' });
  call('apiWalletAdjust', mina.id, 500, 'رصيد البداية', 'start-key-mina');
  call('apiWalletAdjust', mariam.id, 500, 'رصيد البداية', 'start-key-mariam');
  const tokens = { mina: login(world, codeOf(call, mina.id)), mariam: login(world, codeOf(call, mariam.id)) };
  const item = input => call('apiShopItemSave', input).item;
  return { world, call, mina, mariam, tokens, item };
}

const redeem = (world, ptoken, itemId, key = requestKey()) => pub(world, 'shopRedeem', { ptoken, itemId, requestKey: key });
const ledger = world => tab(world, 'PointsLedger');

test('items: add / edit (validated, fields left out kept) / delete only without redemptions; logged', () => {
  const { world, call, tokens, item } = shopWorld();
  const mug = item({ name: 'كوباية', description: 'كوباية عليها اسمك', cost: 300, stock: 5, perPerson: 2, category: 'هدايا' });
  assert.match(mug.id, /^i-[0-9a-f]{8}$/);
  assert.deepEqual([mug.cost, mug.stock, mug.perPerson, mug.available, mug.redeemed, mug.active], [300, 5, 2, 5, 0, true]);
  const book = item({ name: 'كتاب', cost: 100 });
  assert.deepEqual([book.stock, book.perPerson, book.available], [null, null, null], 'empty = unlimited');
  assert.equal(item({ id: book.id, cost: 120 }).name, 'كتاب', 'left-out fields keep their value');
  for (const bad of [{ name: '', cost: 5 }, { name: 'x', cost: 0 }, { name: 'x', cost: 1.5 }, { name: 'x', cost: 5, stock: -1 }, { name: 'x', cost: 5, perPerson: 0 }, { name: 'x'.repeat(61), cost: 5 }, { name: 'x', cost: 5, image: 'img-zzzzzzzz' }]) {
    assert.throws(() => call('apiShopItemSave', bad), JSON.stringify(bad));
  }
  assert.equal(redeem(world, tokens.mina, mug.id).ok, true);
  assert.throws(() => call('apiShopItemSave', { id: mug.id, stock: 0 }), /أقل من اللي اتطلب فعلًا \(١\)/);
  assert.throws(() => call('apiShopItemDelete', mug.id), /اتطلبت قبل كده/);
  assert.equal(call('apiShopItemDelete', book.id).deleted, true);
  const list = call('apiShopItems');
  assert.deepEqual(list.items.map(i => i.id), [mug.id]);
  assert.deepEqual(list.categories, ['هدايا']);
  assert.equal(list.items[0].pending, 1);
  // (an edit right after the create is merged into it, like every other edit)
  assert.ok(['create', 'delete'].every(a => activityRows(world).some(r => r[5] === a && r[6] === 'shopitem')));
});

test('redeem: success (ledger −cost red:<id> + a pending redemption), the same requestKey again = the same redemption', () => {
  const { world, mina, tokens, item } = shopWorld();
  const mug = item({ name: 'كوباية', cost: 300 });
  const key = requestKey();
  const first = redeem(world, tokens.mina, mug.id, key);
  assert.equal(first.ok, true);
  assert.match(first.redemption.id, /^r-[0-9a-f]{10}$/);
  assert.deepEqual(plain(first.redemption), { id: first.redemption.id, status: 'pending', itemName: 'كوباية', cost: 300 });
  assert.equal(first.balance, 200);
  const row = ledger(world).find(r => r.kind === 'redeem');
  assert.deepEqual([row.participantId, row.amount, row.refType, row.refId, row.idemKey], [mina.id, '-300', 'redemption', first.redemption.id, 'red:' + first.redemption.id]);
  const red = tab(world, 'Redemptions')[0];
  assert.deepEqual([red.status, red.requestKey, red.ledgerId, red.itemName, red.cost], ['pending', key, row.id, 'كوباية', '300']);

  const replay = redeem(world, tokens.mina, mug.id, key);
  assert.equal(replay.ok, true);
  assert.equal(replay.redemption.id, first.redemption.id);
  assert.equal(replay.balance, 200);
  assert.equal(tab(world, 'Redemptions').length, 1);
  assert.equal(ledger(world).filter(r => r.kind === 'redeem').length, 1);
  // the key is per participant: someone else's same key is their own request
  assert.notEqual(redeem(world, tokens.mariam, mug.id, key).redemption.id, first.redemption.id);
});

test('redeem refusals: insufficient, stock, per-person, inactive item, bad / expired tokens, malformed', () => {
  const { world, tokens, item } = shopWorld();
  const big = item({ name: 'عجلة', cost: 501 });
  assert.equal(redeem(world, tokens.mina, big.id).code, 'insufficient');
  assert.match(redeem(world, tokens.mina, big.id).message, /رصيدك مش كفاية/);
  const last = item({ name: 'آخر واحدة', cost: 10, stock: 1 });
  assert.equal(redeem(world, tokens.mina, last.id).ok, true);
  const out = redeem(world, tokens.mariam, last.id);
  assert.equal(out.code, 'stock');
  assert.match(out.message, /الجايزة دي خلصت/);
  const pen = item({ name: 'قلم', cost: 10, perPerson: 2 });
  assert.equal(redeem(world, tokens.mina, pen.id).ok, true);
  assert.equal(redeem(world, tokens.mina, pen.id).ok, true);
  const limit = redeem(world, tokens.mina, pen.id);
  assert.equal(limit.code, 'per_person');
  assert.match(limit.message, /وصلت للحد المسموح/);
  assert.equal(redeem(world, tokens.mariam, pen.id).ok, true, 'the limit is per person');
  const hidden = item({ name: 'مخفية', cost: 5, active: false });
  assert.equal(redeem(world, tokens.mina, hidden.id).code, 'not_found');
  assert.equal(redeem(world, 'pt1.bad.token', pen.id).code, 'session');
  assert.equal(pub(world, 'shopRedeem', { ptoken: tokens.mina, itemId: pen.id }).code, 'bad');
  assert.equal(pub(world, 'shopRedeem', { ptoken: tokens.mina, itemId: 'x', requestKey: requestKey() }).code, 'bad');
  world.advance(3 * 3600000 + 1000);
  assert.equal(redeem(world, tokens.mina, pen.id).code, 'session', 'the 3-hour token ran out');
});

test('never an overspend: back-to-back requests under the live lock, two items together over the balance, a busy lock writes nothing', () => {
  const { world, mina, tokens, item } = shopWorld();
  const a = item({ name: 'أ', cost: 300 });
  const b = item({ name: 'ب', cost: 300 });
  // two requests for the same item (two tabs): the second runs after the first released the lock
  const first = redeem(world, tokens.mina, a.id);
  const second = redeem(world, tokens.mina, a.id);
  assert.equal(first.ok, true);
  assert.equal(second.code, 'insufficient');
  // two different items that together cost more than the balance
  const third = redeem(world, tokens.mariam, a.id);
  const fourth = redeem(world, tokens.mariam, b.id);
  assert.equal(third.ok, true);
  assert.equal(fourth.code, 'insufficient');
  for (const id of [mina.id]) assert.ok(world.gs.walletBalance_(id, true) >= 0);
  const balances = world.gs.walletBalances_();
  assert.ok(Object.values(balances).every(v => v >= 0), JSON.stringify(balances));
  // the live lock is taken by someone else: busy, nothing written
  const before = tab(world, 'Redemptions').length;
  world.scriptLock.busy = true;
  assert.equal(redeem(world, tokens.mina, b.id).code, 'busy');
  world.scriptLock.busy = false;
  assert.equal(tab(world, 'Redemptions').length, before);
  // a simulated race: the stock check sees the other request's row (written under the same lock)
  const one = item({ name: 'واحدة بس', cost: 1, stock: 1 });
  const results = [redeem(world, tokens.mina, one.id), redeem(world, tokens.mariam, one.id)];
  assert.deepEqual(results.map(r => r.ok ? 'ok' : r.code), ['ok', 'stock']);
});

test('statuses: pending → approved → fulfilled (final); cancel refunds once (a second cancel changes nothing); logged', () => {
  const { world, call, mina, tokens, item } = shopWorld();
  const mug = item({ name: 'كوباية', cost: 300 });
  const r1 = redeem(world, tokens.mina, mug.id).redemption;
  const approved = call('apiShopRedemptionStatus', r1.id, 'approved', 'تعالى استلمها يوم الجمعة');
  assert.equal(approved.redemption.status, 'approved');
  assert.deepEqual(approved.redemption.next, ['fulfilled', 'cancelled']);
  assert.equal(approved.redemption.note, 'تعالى استلمها يوم الجمعة');
  const fulfilled = call('apiShopRedemptionStatus', r1.id, 'fulfilled');
  assert.equal(fulfilled.redemption.status, 'fulfilled');
  assert.equal(fulfilled.redemption.handledBy, 'menazakmena@gmail.com');
  assert.throws(() => call('apiShopRedemptionStatus', r1.id, 'cancelled'), /اتسلم خلاص/);
  assert.equal(call('apiShopRedemptionStatus', r1.id, 'fulfilled').changed, false, 'the same status: nothing');

  const r2 = redeem(world, tokens.mina, item({ name: 'كتاب', cost: 100 }).id).redemption;
  assert.equal(world.gs.walletBalance_(mina.id, true), 100);
  const cancelled = call('apiShopRedemptionStatus', r2.id, 'cancelled', 'خلصت من المخزن');
  assert.equal(cancelled.changed, true);
  assert.equal(cancelled.balance, 200);
  assert.equal(cancelled.redemption.refunded, true);
  const refund = ledger(world).filter(r => r.kind === 'refund');
  assert.equal(refund.length, 1);
  assert.deepEqual([refund[0].amount, refund[0].idemKey, refund[0].refId], ['100', 'ref:' + r2.id, r2.id]);
  const again = call('apiShopRedemptionStatus', r2.id, 'cancelled');
  assert.equal(again.changed, false);
  assert.equal(ledger(world).filter(r => r.kind === 'refund').length, 1, 'refunded once');
  assert.throws(() => call('apiShopRedemptionStatus', r2.id, 'approved'), /النقاط رجعت/);
  assert.throws(() => call('apiShopRedemptionStatus', r2.id, 'pending'), /الحالة مش مفهومة/);
  // a cancelled request frees its stock
  const list = call('apiShopRedemptions', { status: 'all' });
  assert.deepEqual(plain(list.counts), { all: 2, pending: 0, approved: 0, fulfilled: 1, cancelled: 1 });
  assert.equal(list.items[0].id, r2.id, 'newest first');
  assert.equal(list.items[0].participantName, 'مينا عادل');
  assert.equal(call('apiShopRedemptions', { status: 'open' }).total, 0);
  assert.equal(call('apiShopRedemptions', { q: 'كتاب' }).total, 1);
  assert.equal(call('apiShopRedemptions', { participant: mina.id }).total, 2);
  const acts = activityRows(world).filter(r => r[5] === 'redemption.status');
  assert.ok(acts.some(r => r[9] === 'غيّر حالة طلب الجايزة «كتاب» لـ «اتلغت»'));
  assert.equal(call('apiWalletParticipant', mina.id).entries[0].redemption.status, 'cancelled');
});

test('portalMe: registry only / + wallet / + store shapes; history with submissionId and canReview; pictures only once published', () => {
  const { world, call } = regWorld();
  const mina = addPerson(call, 'مينا عادل', phone(1), { group: 'ثانوي' });
  const ptoken = login(world, codeOf(call, mina.id));
  codedComp(world, call, { overrides: { answersShow: 'immediately' } });
  codedComp(world, call, { slug: 'hidden-answers' });
  const shown = play(world, ptoken);
  const hidden = play(world, ptoken, { slug: 'hidden-answers' });

  // registry only
  let me = pub(world, 'portalMe', { ptoken });
  assert.equal(me.ok, true);
  assert.deepEqual(plain(me.participant), { name: 'مينا عادل', group: 'ثانوي' });
  assert.deepEqual(plain(me.features), { wallet: false, shop: false });
  for (const key of ['balance', 'ledger', 'redemptions', 'shop']) assert.ok(!(key in me), key);
  assert.equal(me.history.length, 2);
  const h = Object.fromEntries(me.history.map(x => [x.submissionId, x]));
  assert.equal(h[shown.id].canReview, true);
  assert.equal(h[hidden.id].canReview, false);
  assert.equal(h[shown.id].score, 15);
  assert.equal(h[shown.id].slug, 'coded-quiz');
  assert.match(h[shown.id].submittedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.ok(!JSON.stringify(me).includes(mina.phone.slice(1)), 'no phone in the portal');

  // portalReview: the review only when allowed; never someone else's
  const review = pub(world, 'portalReview', { ptoken, submissionId: shown.id });
  assert.equal(review.ok, true);
  assert.equal(review.result.review.length, 2);
  assert.ok('correct' in review.result.review[0]);
  const noReview = pub(world, 'portalReview', { ptoken, submissionId: hidden.id });
  assert.equal(noReview.ok, true);
  assert.equal(noReview.result.review, undefined);
  const other = addPerson(call, 'مريم زكريا', phone(2));
  const otherToken = login(world, codeOf(call, other.id));
  assert.equal(pub(world, 'portalReview', { ptoken: otherToken, submissionId: shown.id }).code, 'not_found');
  assert.equal(pub(world, 'portalReview', { ptoken, submissionId: 'nope' }).code, 'bad');

  // + wallet
  call('apiCompSettings', { wallet: true });
  call('apiWalletAdjust', mina.id, 700, 'هدية', 'gift-key-0001');
  me = pub(world, 'portalMe', { ptoken });
  assert.deepEqual(plain(me.features), { wallet: true, shop: false });
  assert.equal(me.balance, 700);
  assert.deepEqual(plain(me.ledger), [{ amount: 700, kind: 'manual', note: 'هدية', compTitle: '', createdAt: me.ledger[0].createdAt }]);
  assert.ok(!('shop' in me));

  // + store, with a picture that is not on the site yet
  call('apiCompSettings', { shop: true });
  const pic = call('apiUploadMedia', { full: webp(21).toString('base64'), thumb: webp(21).toString('base64'), mime: 'image/webp', width: 800, height: 800, alt: 'كوباية' }).media;
  const offPic = call('apiUploadMedia', { full: webp(22).toString('base64'), thumb: webp(22).toString('base64'), mime: 'image/webp', width: 800, height: 800, alt: 'مخفية' }).media;
  const mug = call('apiShopItemSave', { name: 'كوباية', cost: 300, stock: 3, perPerson: 1, category: 'هدايا', image: pic.id }).item;
  call('apiShopItemSave', { name: 'مخفية', cost: 10, image: offPic.id, active: false });
  assert.equal(mug.imagePublished, false);
  assert.equal(mug.imageObj.src, pic.path);
  const usage = call('apiMediaLibrary').usage;
  assert.ok(usage[pic.id].some(u => u.area === 'competitions' && u.key === mug.id && /جايزة في المتجر/.test(u.label)));
  me = pub(world, 'portalMe', { ptoken });
  assert.deepEqual(plain(me.features), { wallet: true, shop: true });
  assert.deepEqual(me.shop.map(i => i.name), ['كوباية'], 'active items only');
  assert.equal(me.shop[0].image, null, 'not published yet: no picture');
  assert.deepEqual([me.shop[0].available, me.shop[0].perPersonLeft], [3, 1]);
  assert.deepEqual(plain(me.redemptions), []);

  // the publish takes the active item's picture to the site (not the hidden one's), even with nothing else changed
  const before = publish(world, call);
  assert.ok(before.files[pic.path], 'the store picture is in the commit');
  assert.ok(!before.files[offPic.path], 'an inactive item\'s picture is not');
  world.cache.delete('shop:img');
  me = pub(world, 'portalMe', { ptoken });
  assert.equal(me.shop[0].image.src, pic.path);
  assert.ok(!me.shop[0].image.src.startsWith('http'));

  const r = redeem(world, ptoken, mug.id);
  me = pub(world, 'portalMe', { ptoken });
  assert.equal(me.balance, 400);
  assert.deepEqual([me.shop[0].available, me.shop[0].perPersonLeft], [2, 0]);
  assert.deepEqual(me.redemptions.map(x => [x.id, x.status, x.itemName, x.cost]), [[r.redemption.id, 'pending', 'كوباية', 300]]);
  assert.equal(me.ledger[0].kind, 'redeem');
  assert.equal(me.ledger[0].note, 'كوباية');
  assert.equal(pub(world, 'portalMe', {}).code, 'bad', 'no token at all: refused before any budget (CompPublic.gs compShapeOk_)');
  assert.equal(pub(world, 'portalMe', { ptoken: 'x' }).code, 'session');
});

test('a store picture added after the last publish: «انشر» still uploads it (content.json unchanged)', () => {
  const { world, call } = regWorld({ shop: true });
  codedComp(world, call);
  const pic = call('apiUploadMedia', { full: webp(31).toString('base64'), thumb: webp(31).toString('base64'), mime: 'image/webp', width: 600, height: 600, alt: 'جايزة' }).media;
  call('apiShopItemSave', { name: 'جايزة', cost: 50, image: pic.id });
  const review = call('apiReview');
  const result = call('apiPublish', review.revision);
  assert.ok(result.commit, 'a commit for the picture');
  assert.ok(world.github.files()[pic.path]);
  const again = call('apiPublish', call('apiReview').revision);
  assert.equal(again.unchanged, true, 'nothing waits any more');
});


test('a charge that fails half-way: the request is cancelled (never an uncharged prize), the same requestKey then goes through charged once; a lost link is healed', () => {
  const { world, mina, tokens, item } = shopWorld();
  const mug = item({ name: 'كوباية', cost: 300 });
  const real = world.gs.walletAppend_;
  world.gs.walletAppend_ = () => { throw new Error('sheet down'); };
  const key = requestKey();
  const failed = redeem(world, tokens.mina, mug.id, key);
  world.gs.walletAppend_ = real;
  assert.equal(failed.code, 'busy');
  let reds = tab(world, 'Redemptions');
  assert.deepEqual(reds.map(r => [r.status, r.ledgerId]), [['cancelled', '']]);
  assert.equal(world.gs.walletBalance_(mina.id, true), 500, 'nothing charged');
  const retry = redeem(world, tokens.mina, mug.id, key);
  assert.equal(retry.ok, true);
  assert.equal(retry.balance, 200);
  reds = tab(world, 'Redemptions');
  assert.equal(reds.length, 2);
  assert.ok(reds[1].ledgerId, 'linked');
  assert.equal(redeem(world, tokens.mina, mug.id, key).redemption.id, retry.redemption.id, 'then a normal replay');
  assert.equal(ledger(world).filter(r => r.kind === 'redeem').length, 1);

  // the link write is lost after the charge: the replay links the existing ledger row (no second charge)
  const sheet = world.compSpreadsheet.getSheetByName('Redemptions');
  const col = sheet.data[0].indexOf('ledgerId');
  sheet.data.find(r => r[0] === retry.redemption.id)[col] = '';
  world.gs.COMP_TABS_ = {};
  assert.equal(redeem(world, tokens.mina, mug.id, key).ok, true);
  assert.equal(ledger(world).filter(r => r.kind === 'redeem').length, 1);
  assert.ok(tab(world, 'Redemptions').find(r => r.id === retry.redemption.id).ledgerId);
});
