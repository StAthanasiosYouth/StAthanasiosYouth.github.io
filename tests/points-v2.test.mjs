// Points & Store v2 (docs/COMPETITIONS.md §18): short locks, stock claim,
// store schedule + participant cancel, automatic push schedule, seasons.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compWorld, adminApi, publish, scoredComp, pub, clientKey, errorText, ADMIN } from './fakes/comp.mjs';

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

import { regWorld, addPerson, codeOf, login, tab, activityRows } from './fakes/reg.mjs';
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

/* ---------- §18.4 the public «نقاطي / المتجر» facts and the `points` target ---------- */

test('content.json `points`: only with registry + wallet; the store schedule and the bell target travel with a publish', () => {
  const plainWorld = compWorld();
  const plainCall = adminApi(plainWorld);
  scoredComp(plainCall);
  publish(plainWorld, plainCall);
  assert.equal(JSON.parse(plainWorld.github.files()['content.json']).points, undefined, 'no widget without the modules');

  const { world, call } = storeWorld();
  call('apiShopScheduleSave', { mode: 'auto', opensAt: wallAt(world, 60), closesAt: wallAt(world, 600), notify: {} });
  call('apiSaveItem', 'notifications', { title: 'المتجر فتح', type: 'general', target: 'points' });
  const before = call('apiReview').revision;
  publish(world, call);
  const content = JSON.parse(world.github.files()['content.json']);
  assert.equal(content.points.url, 'points/');
  assert.equal(content.points.shop.mode, 'auto');
  assert.equal(content.points.shop.opensAt, wallAt(world, 60).replace(' ', 'T'));
  const note = content.notifications.find(n => n.title === 'المتجر فتح');
  assert.deepEqual(note.target, { kind: 'points' });
  assert.equal(world.gs.pushUrl_(note.target), '/points/');

  // a new schedule is a change to publish (the public widget follows it)
  call('apiShopScheduleSave', { mode: 'closed', notify: {} });
  assert.notEqual(call('apiReview').revision, before);
});

/* ---------- §18.5 the automatic push schedule ---------- */

import { generateKeyPairSync } from 'node:crypto';

const FCM_ACCOUNT = JSON.stringify({
  type: 'service_account', project_id: 'athanasios-links', private_key_id: 'k1',
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
  client_email: 'push@athanasios-links.iam.gserviceaccount.com', token_uri: 'https://oauth2.googleapis.com/token'
});
const device = n => `d${String(n).padStart(3, '0')}Xk2:APA91b${'Q'.repeat(140)}${n}`;
const bell = world => {
  const sheet = world.spreadsheet.getSheetByName('Notifications');
  const [header, ...rows] = sheet.data;
  return rows.filter(r => r[0]).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] === undefined ? '' : String(r[i]).replace(/^'/, '')])));
};

function scheduledWorld() {
  const store = storeWorld();
  store.world.properties.set('FCM_SERVICE_ACCOUNT', FCM_ACCOUNT);
  assert.equal(store.world.post({ fn: 'pushSubscribe', args: [{ token: device(1), platform: 'android' }] }).ok, true);
  return store;
}

const allMoments = { open1d: true, open1h: true, openAt: true, close24h: true, close1h: true };

test('automatic push: bell items + pending entries; nothing armed until the owner enables it; saves never break', () => {
  const { world, call } = scheduledWorld();
  const view = call('apiShopScheduleSave', { mode: 'auto', opensAt: wallAt(world, 2 * 1440), closesAt: wallAt(world, 5 * 1440), notify: allMoments });
  assert.equal(view.auto.authorized, false);
  const items = bell(world).filter(n => n.target === 'points');
  assert.equal(items.length, 5);
  assert.ok(items.every(n => /^notif-shop-(open|close)/.test(n.id)));
  assert.deepEqual(tab(world, 'PushSchedule').map(e => e.status), ['pending', 'pending', 'pending', 'pending', 'pending']);
  assert.equal(world.triggers.list.length, 0, 'no trigger before enableAutoPush');

  // no scope at all: still fine
  world.triggers.scope = false;
  assert.doesNotThrow(() => call('apiShopScheduleSave', { mode: 'auto', opensAt: wallAt(world, 2 * 1440), closesAt: wallAt(world, 5 * 1440), notify: allMoments }));
  assert.equal(call('apiPushAuto').authorized, false);
});

test('automatic push: one trigger at the earliest moment; it sends the live item, re-arms, and only our trigger may run it', () => {
  const { world, call } = scheduledWorld();
  call('apiShopScheduleSave', { mode: 'auto', opensAt: wallAt(world, 2 * 1440), closesAt: wallAt(world, 5 * 1440), notify: { open1d: true, openAt: true } });
  world.as(ADMIN).gs.enableAutoPush();
  world.as('');
  const ticks = () => world.triggers.list.filter(t => t.handler === 'pushScheduleTick');
  assert.equal(world.triggers.list.filter(t => t.handler === 'pushScheduleDaily').length, 1);
  assert.equal(ticks().length, 1);
  assert.ok(Math.abs(ticks()[0].at - world.gs.pushWallMs_(wallAt(world, 1440).replace(' ', 'T'))) <= 60000, 'armed at «قبل الفتح بيوم» (a test crossing a minute boundary is fine)');

  publish(world, call);
  world.gs.pushScheduleTick({ triggerUid: 'someone-else' });
  assert.equal(world.fcm.sent.length, 0, 'a call that is not our trigger does nothing');

  world.advance(1441 * 60000);
  assert.equal(world.fireTriggers(), 1);
  const sent = tab(world, 'PushSchedule').find(e => e.kind === 'shop-open-1d');
  assert.equal(sent.status, 'sent', sent.result);
  assert.ok(world.fcm.sent.length >= 1);
  assert.equal(ticks().length, 1, 'armed again for «وقت الفتح»');
  assert.ok(Math.abs(ticks()[0].at - world.gs.pushWallMs_(wallAt(world, 1439).replace(' ', 'T'))) <= 60000);
  assert.equal(world.scriptLock.lockedFetches.length, 0, 'the send held no lock');
});

test('automatic push: a moment whose bell item was never published is skipped (not live); a missed one older than 6 h too', () => {
  const { world, call } = scheduledWorld();
  publish(world, call);
  call('apiShopScheduleSave', { mode: 'auto', opensAt: wallAt(world, 120), notify: { open1h: true, openAt: true } });
  world.as(ADMIN).gs.enableAutoPush();
  world.as('');
  // never published: the 1 h reminder can't go out
  world.advance(61 * 60000);
  world.fireTriggers();
  const first = tab(world, 'PushSchedule').find(e => e.kind === 'shop-open-1h');
  assert.equal(first.status, 'skipped');
  assert.match(first.result, /مش منشور/);
  // the trigger is lost; the daily one finds «وقت الفتح» 7 h late
  world.triggers.list = world.triggers.list.filter(t => t.handler !== 'pushScheduleTick');
  world.advance(8 * 60 * 60000);
  world.fireDaily();
  const late = tab(world, 'PushSchedule').find(e => e.kind === 'shop-open');
  assert.equal(late.status, 'skipped');
  assert.equal(late.result, 'فات ميعاده');
});

test('automatic push: changing the times cancels the old moments (and their bell items) and makes new ones; cancel by hand', () => {
  const { world, call } = scheduledWorld();
  call('apiShopScheduleSave', { mode: 'auto', opensAt: wallAt(world, 3 * 1440), notify: { open1d: true } });
  const old = tab(world, 'PushSchedule')[0];
  call('apiShopScheduleSave', { mode: 'auto', opensAt: wallAt(world, 4 * 1440), notify: { open1d: true } });
  const rows = tab(world, 'PushSchedule');
  assert.equal(rows.find(e => e.id === old.id).status, 'cancelled');
  assert.ok(!bell(world).some(n => n.id === old.notifId), 'the old bell item is gone');
  const fresh = rows.find(e => e.status === 'pending');
  assert.ok(fresh && fresh.notifId !== old.notifId);
  assert.equal(call('apiPushScheduleCancel', fresh.id).entries.find(e => e.id === fresh.id).status, 'cancelled');
  // the manual modes have no moments
  call('apiShopScheduleSave', { mode: 'open', opensAt: wallAt(world, 4 * 1440), notify: { open1d: true } });
  assert.ok(!tab(world, 'PushSchedule').some(e => e.status === 'pending'));
});

/* ---------- §18.6 seasons ---------- */

import { codedComp, play as playCoded } from './fakes/reg.mjs';

function seasonWorld() {
  const store = storeWorld();
  const comp = codedComp(store.world, store.call, { slug: 'season-quiz', preset: 'points' });
  return { ...store, comp };
}

test('seasons: the first one exists by itself; points land in the competition\'s season; the maximum is the season\'s competitions', () => {
  const { world, call, tokens, comp } = seasonWorld();
  const seasons = call('apiSeasons');
  assert.equal(seasons.active, 'sea-first');
  const first = seasons.seasons.find(s => s.id === 'sea-first');
  assert.equal(first.maxTheoretical, 15, '10 + 5 points of the published points competition');
  assert.equal(first.competitions, 1);

  playCoded(world, tokens.mina, { slug: 'season-quiz' });
  const me = pub(world, 'portalMe', { ptoken: tokens.mina });
  assert.equal(me.balance, 515, '500 start + 15');
  assert.equal(me.season.id, 'sea-first');
  assert.equal(me.season.earned, 15);
  assert.equal(me.season.maxTheoretical, 15);
  assert.ok(tab(world, 'PointsLedger').every(l => l.seasonId === 'sea-first'));
  assert.equal(comp.id.startsWith('cmp-'), true);
});

test('seasons: closing is refused with open requests, then writes frozen totals once; the new season starts at 0; history stays', () => {
  const { world, call, mina, tokens, item, redeem } = seasonWorld();
  playCoded(world, tokens.mina, { slug: 'season-quiz' });
  const mug = item({ name: 'كوباية', cost: 100 });
  const request = redeem('mina', mug.id).redemption;

  let preview = call('apiSeasonClosePreview', 'sea-first');
  assert.equal(preview.canClose, false);
  assert.equal(preview.openRequests.length, 1);
  assert.throws(() => call('apiSeasonClose', 'sea-first', preview.confirmKey, { name: 'موسم الشتا' }), /لازم تخلّص طلبات/);

  call('apiShopRedemptionStatus', request.id, 'fulfilled', '');
  preview = call('apiSeasonClosePreview', 'sea-first');
  assert.equal(preview.canClose, true);
  const minaTotals = preview.totals.find(t => t.pid === mina.id);
  assert.deepEqual([minaTotals.earned, minaTotals.spent, minaTotals.adjusted, minaTotals.final], [15, 100, 500, 415]);

  // a stale preview is refused
  call('apiWalletAdjust', mina.id, 1, 'تعديل', 'late-adjust-0001');
  assert.throws(() => call('apiSeasonClose', 'sea-first', preview.confirmKey, { name: 'موسم الشتا' }), /اتغيرت/);
  preview = call('apiSeasonClosePreview', 'sea-first');

  const closed = call('apiSeasonClose', 'sea-first', preview.confirmKey, { name: 'موسم الشتا', endAt: wallAt(world, 60 * 1440) });
  assert.equal(closed.closed, 'sea-first');
  assert.notEqual(closed.active, 'sea-first');
  assert.equal(tab(world, 'SeasonTotals').filter(r => r.seasonId === 'sea-first').length, 2);
  assert.equal(world.gs.walletBalance_(mina.id, true), 0, 'a new season starts at 0');
  assert.ok(tab(world, 'PointsLedger').length >= 5, 'nothing was deleted');

  const me = pub(world, 'portalMe', { ptoken: login(world, codeOf(call, mina.id)) });
  assert.equal(me.balance, 0);
  assert.equal(me.season.name, 'موسم الشتا');
  assert.equal(me.seasons[0].id, 'sea-first');
  assert.equal(me.seasons[0].final, 416);
  assert.throws(() => call('apiSeasonSave', { id: 'sea-first', name: 'تغيير' }), /اتقفل/);
});

test('seasons: a closed season is frozen (a regrade writes nothing); carry-over only by an explicit transfer', () => {
  const { world, call, mina, tokens, comp } = seasonWorld();
  call('apiCompSave', comp.id, { seasonId: 'sea-first' });
  const played = playCoded(world, tokens.mina, { slug: 'season-quiz', right: 'half' });
  const preview = call('apiSeasonClosePreview', 'sea-first');
  call('apiSeasonClose', 'sea-first', preview.confirmKey, { name: 'الموسم التاني' });
  const before = tab(world, 'PointsLedger').length;

  // the key changes: everyone would get more, but the season is closed
  call('apiCompQuestionSave', comp.id, { ...comp.questions.tf, correct: 'غلط' });
  publish(world, call);
  call('apiCompRegrade', comp.id);
  assert.equal(tab(world, 'PointsLedger').length, before, 'frozen');
  assert.equal(played.done.ok, true);

  const moved = call('apiWalletAdjust', mina.id, 300, 'تحويل من الموسم الأول', 'transfer-key-0001', 'transfer');
  assert.equal(moved.entry.kind, 'transfer');
  assert.equal(moved.balance, 300);
  assert.ok(activityRows(world).length > 0);
});

test('seasons: planned season + ending notice through the same automatic schedule', () => {
  const { world, call } = seasonWorld();
  const active = call('apiSeasons').active;
  call('apiSeasonSave', { id: active, name: 'الموسم الأول', endAt: wallAt(world, 10 * 1440), notifyDays: 3 });
  const notice = tab(world, 'PushSchedule').find(e => e.kind === 'season-end');
  assert.ok(notice, 'a «season ends» moment');
  assert.equal(notice.sendAt, wallAt(world, 7 * 1440));
  assert.equal(bell(world).find(n => n.id === notice.notifId).target, 'points');
  const planned = call('apiSeasonSave', { name: 'موسم الصيف', startAt: wallAt(world, 11 * 1440) }).season;
  assert.equal(planned.status, 'planned');
});
