// Points & Store v2 (docs/COMPETITIONS.md §18): short locks, stock claim,
// store schedule + participant cancel, automatic push schedule, seasons.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compWorld, adminApi, publish, scoredComp, pub, clientKey, errorText } from './fakes/comp.mjs';

const phone = n => '0101234' + String(n).padStart(4, '0');

/* an answer for every question a start served (right or wrong does not matter here) */
const anyAnswers = start => Object.fromEntries(start.questions.filter(q => q.type !== 'info' && q.type !== 'long').map(q => [q.id,
  q.type === 'single' ? q.choices[0].id : q.type === 'multi' ? [q.choices[0].id] : q.type === 'truefalse' ? 't' : q.type === 'number' ? '1' : 'x']));

/* ---------- §18.1 one lock, never held during network work ---------- */

test('a publish in its GitHub step holds no lock: a visitor starts and submits meanwhile; a second publish is refused', () => {
  const world = compWorld();
  const call = adminApi(world);
  scoredComp(call);
  publish(world, call);
  call('apiCompSave', (call('apiComps').comps[0] || {}).id, { description: 'تعديل بسيط' });

  const review = call('apiReview');
  const seen = { during: null, second: null, held: null };

  world.github.onRequest = (method) => {
    if (method !== 'post' || seen.during) return;
    seen.held = world.scriptLock.held;
    const saved = world.gs.API_REQUEST_;
    const key = clientKey();
    const start = pub(world, 'compStart', { slug: 'bible-quiz', clientKey: key, fields: { name: 'مينا', phone: phone(1) } });
    seen.during = start.ok ? pub(world, 'compSubmit', { token: start.attempt.token, clientKey: key, answers: anyAnswers(start) }) : start;
    try { call('apiPublish', review.revision); } catch (error) { seen.second = error.message; }
    world.gs.API_REQUEST_ = saved;
  };

  const result = call('apiPublish', review.revision);
  world.github.onRequest = null;

  assert.equal(seen.held, 0, 'no lock held while GitHub is called');
  assert.equal(seen.during.ok, true, JSON.stringify(seen.during));
  assert.match(errorText(seen.second || ''), /فيه نشر شغال دلوقتي/);
  assert.ok(result.commit, 'the first publish still lands');
  assert.equal(world.scriptLock.lockedFetches.length, 0);
  assert.ok(!world.cache.get('publish:claim'), 'the claim is dropped');
});

test('a publish whose commit fails leaves nothing behind: no claim, nothing stamped, next publish works', () => {
  const world = compWorld();
  const call = adminApi(world);
  scoredComp(call);
  const review = call('apiReview');
  world.github.onRequest = (method) => { if (method === 'post') throw new Error('network down'); };
  assert.throws(() => call('apiPublish', review.revision));
  world.github.onRequest = null;
  assert.ok(!world.cache.get('publish:claim'));
  assert.equal(call('apiComps').comps[0].liveVersion || '', '');
  assert.ok(publish(world, call).commit);
});

/* ---------- §18.2 / §18.3 the store: the last item, the schedule, the participant's cancel ---------- */

import { regWorld, addPerson, codeOf, login, tab } from './fakes/reg.mjs';
import { wallAt } from './fakes/comp.mjs';

let reqKeys = 0;
const requestKey = () => 'req-' + Date.now().toString(36) + '-' + String(++reqKeys).padStart(8, '0');

function storeWorld() {
  const { world, call } = regWorld({ shop: true });
  const mina = addPerson(call, 'مينا عادل', phone(1));
  const mariam = addPerson(call, 'مريم زكريا', phone(2));
  call('apiWalletAdjust', mina.id, 500, 'بداية', 'start-mina-0001');
  call('apiWalletAdjust', mariam.id, 500, 'بداية', 'start-mariam-001');
  const tokens = { mina: login(world, codeOf(call, mina.id)), mariam: login(world, codeOf(call, mariam.id)) };
  const item = input => call('apiShopItemSave', input).item;
  const redeem = (who, itemId, key = requestKey()) => pub(world, 'shopRedeem', { ptoken: tokens[who], itemId, requestKey: key });
  return { world, call, mina, mariam, tokens, item, redeem };
}

test('the last item: two requests that overlap (as if the lock failed) → exactly one charged, the other cancelled uncharged', () => {
  const { world, call, mina, mariam, item, redeem } = storeWorld();
  const last = item({ name: 'آخر واحدة', cost: 100, stock: 1 });

  // the other request lands between our stock check and our own row
  const append = world.gs.compAppend_;
  let nested = null;
  world.gs.compAppend_ = function (t, records) {
    if (!nested && t.name === 'Redemptions') {
      nested = 'running';
      world.gs.compAppend_ = append;
      nested = redeem('mariam', last.id);
    }
    return append(t, records);
  };
  const mine = redeem('mina', last.id);
  world.gs.compAppend_ = append;

  assert.equal(nested.ok, true, 'the first row in the sheet wins: ' + JSON.stringify(nested));
  assert.equal(mine.code, 'stock', JSON.stringify(mine));
  const rows = tab(world, 'Redemptions').filter(r => r.itemId === last.id);
  assert.deepEqual(rows.map(r => r.status), ['pending', 'cancelled']);
  assert.equal(rows[1].note, 'الجايزة خلصت');
  assert.equal(rows[1].ledgerId, '', 'never charged');
  assert.equal(world.gs.walletBalance_(mina.id, true), 500, 'mina keeps every point');
  assert.equal(world.gs.walletBalance_(mariam.id, true), 400);
  assert.equal(tab(world, 'PointsLedger').filter(l => l.kind === 'redeem').length, 1);
});

test('store schedule: scheduled / open / closed by the server clock; closing keeps requests and points; admin still handles them', () => {
  const { world, call, mina, tokens, item, redeem } = storeWorld();
  const mug = item({ name: 'كوباية', cost: 50 });
  const set = input => call('apiShopScheduleSave', { mode: 'auto', notify: {}, ...input });

  let view = set({ opensAt: wallAt(world, 60), closesAt: wallAt(world, 180) });
  assert.equal(view.state, 'scheduled');
  assert.equal(redeem('mina', mug.id).code, 'shop_closed');
  assert.equal(pub(world, 'portalMe', { ptoken: tokens.mina }).store.state, 'scheduled');

  world.advance(61 * 60000);
  world.cache.delete('shop:settings');
  const ok = redeem('mina', mug.id);
  assert.equal(ok.ok, true, JSON.stringify(ok));

  world.advance(120 * 60000);
  world.cache.delete('shop:settings');
  assert.equal(call('apiShopSchedule').state, 'closed');
  tokens.mina = login(world, codeOf(call, mina.id));
  assert.equal(redeem('mina', mug.id).code, 'shop_closed');
  assert.equal(world.gs.walletBalance_(mina.id, true), 450, 'closing never touches points');
  // the request stays; the admin still moves it
  assert.equal(call('apiShopRedemptionStatus', ok.redemption.id, 'fulfilled', '').redemption.status, 'fulfilled');

  // manual overrides
  assert.equal(set({ mode: 'open', opensAt: wallAt(world, 600) }).state, 'open');
  assert.equal(set({ mode: 'closed' }).state, 'closed');
  assert.throws(() => set({ opensAt: wallAt(world, 120), closesAt: wallAt(world, 60) }), /بعد ميعاد الفتح/);
});


test('participant cancel: only open + allowed + own + pending; refunds once; frozen when the store closes', () => {
  const { world, call, mina, mariam, tokens, item, redeem } = storeWorld();
  const mug = item({ name: 'كوباية', cost: 50 });
  const a = redeem('mina', mug.id).redemption;
  const b = redeem('mina', mug.id).redemption;
  const cancel = (who, id) => pub(world, 'shopCancel', { ptoken: tokens[who], redemptionId: id });

  assert.equal(cancel('mina', a.id).code, 'not_allowed', 'off by default');
  call('apiShopScheduleSave', { mode: 'auto', allowCancel: true, notify: {} });
  assert.equal(pub(world, 'portalMe', { ptoken: tokens.mina }).redemptions.find(r => r.id === a.id).canCancel, true);
  assert.equal(cancel('mariam', a.id).code, 'not_found', 'not someone else\'s');

  const done = cancel('mina', a.id);
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.balance, 450);
  assert.equal(cancel('mina', a.id).ok, true, 'a retry answers the same');
  assert.equal(tab(world, 'PointsLedger').filter(l => l.kind === 'refund').length, 1, 'refunded once');

  call('apiShopRedemptionStatus', b.id, 'approved', '');
  assert.equal(cancel('mina', b.id).code, 'not_allowed', 'ready for pickup: only the admin');

  const c = redeem('mina', mug.id).redemption;
  call('apiShopScheduleSave', { mode: 'closed', allowCancel: true, notify: {} });
  assert.equal(cancel('mina', c.id).code, 'shop_closed', 'frozen from the participant side');
  assert.equal(pub(world, 'portalMe', { ptoken: tokens.mina }).redemptions.find(r => r.id === c.id).canCancel, false);
  assert.equal(call('apiShopRedemptionStatus', c.id, 'cancelled', '').redemption.status, 'cancelled', 'the admin can');
  assert.equal(world.gs.walletBalance_(mariam.id, true), 500);
});
