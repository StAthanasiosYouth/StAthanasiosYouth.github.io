// Admin display names, the Activity log («سجل النشاط») and admin push
// (apps-script/Activity.gs, apps-script/AdminNotify.gs) against the fake
// Apps Script world: the actor is always the server's identity, names can't
// be spoofed, rows are written / merged / trimmed, logging never breaks an
// action, and admin notifications go only to OTHER, absent admins'
// devices — separate from the public PushSubs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createWorld } from './fakes/gas.mjs';

const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'fady.youssef@gmail.com';
const THIRD = 'third.admin@gmail.com';
const CLIENT = '1234-abc.apps.googleusercontent.com';
const SITE = 'https://stathanasiosyouth.github.io/';
const plain = value => JSON.parse(JSON.stringify(value));

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: 'athanasios-links',
  private_key_id: 'abc123',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  client_email: 'push-sender@athanasios-links.iam.gserviceaccount.com',
  token_uri: 'https://oauth2.googleapis.com/token'
});

const deviceToken = n => `a${String(n).padStart(3, '0')}Xk2:APA91b${'Z'.repeat(140)}${n}`;

function apiWorld({ push = true } = {}) {
  const world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', SITE);
  world.properties.set('ADMIN_CLIENT_ID', CLIENT);
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}, ${THIRD}`);
  if (push) world.properties.set('FCM_SERVICE_ACCOUNT', SERVICE_ACCOUNT);
  world.as('');
  return world;
}

/* a browser tab: its token, its session */
function tab(world, email, device = 'كمبيوتر ويندوز – Chrome') {
  // valid on the world's clock (tests move it forward)
  const now = Math.floor((Date.now() + world.clock.skew) / 1000);
  const token = world.issueToken({ email, iat: String(now), exp: String(now + 3600) });
  const page = {
    sid: '',
    start() {
      const reply = world.post({ fn: 'apiSessionStart', args: [{ device, force: true, state: false }], token });
      assert.equal(reply.ok, true, reply.error);
      page.sid = reply.result.sid;
      return page;
    },
    call(fn, ...args) { return world.post({ fn, args, token, sid: page.sid }); },
    ok(fn, ...args) {
      const reply = page.call(fn, ...args);
      assert.equal(reply.ok, true, `${fn}: ${reply.error}`);
      return reply.result;
    },
    // leaves the panel: the session is parked (not "present" any more)
    leave() { return page.call('apiSessionEnd', { park: true }); }
  };
  return page;
}

const rows = world => {
  const sheet = world.spreadsheet.getSheetByName('Activity');
  if (!sheet) return [];
  const [head, ...body] = sheet.data;
  return body.filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(head.map((k, i) => [k, r[i]])));
};
const adminSubs = world => {
  const sheet = world.spreadsheet.getSheetByName('AdminPushSubs');
  return sheet ? sheet.data.slice(1).filter(r => r.some(v => v !== '')) : [];
};
const fcmSent = world => world.fcm.sent.map(s => s.body);


/* ---------------- display names ---------------- */

test('names: any admin renames any admin; the email stays the identity; every rename is logged', () => {
  const world = apiWorld();
  const mina = tab(world, ADMIN).start();
  const fady = tab(world, SECOND).start();

  let list = mina.ok('apiSetAdminName', ADMIN, '  مينا   زكريا ');
  assert.equal(list.names[ADMIN], 'مينا زكريا', 'spaces tidied');
  list = mina.ok('apiSetAdminName', SECOND, 'فادي يوسف');
  assert.equal(list.names[SECOND], 'فادي يوسف', 'another admin\'s name');
  assert.equal(list.names[THIRD], 'third.admin', 'no name yet: the email\'s local part');
  assert.deepEqual(JSON.parse(world.properties.get('ADMIN_NAMES')), { [SECOND]: 'فادي يوسف', [ADMIN]: 'مينا زكريا' });

  // the state carries the names; the identity is still the email
  const state = fady.ok('apiState');
  assert.equal(state.user, SECOND);
  assert.equal(state.me, 'فادي يوسف');
  assert.equal(state.names[ADMIN], 'مينا زكريا');

  const log = rows(world).filter(r => r.action === 'admin.rename');
  assert.equal(log.length, 2);
  assert.equal(log[1].actor, ADMIN, 'the server\'s identity');
  assert.match(log[1].summary, /غيّر اسم «fady.youssef@gmail.com» لـ «فادي يوسف»/);

  // clearing goes back to the local part
  list = fady.ok('apiSetAdminName', SECOND, '');
  assert.equal(list.names[SECOND], 'fady.youssef');
});

test('names: no two admins can look the same, no hidden direction tricks, no emails or symbols', () => {
  const world = apiWorld();
  const mina = tab(world, ADMIN).start();
  mina.ok('apiSetAdminName', ADMIN, 'مينا زكريا');

  for (const same of ['مينا زكريا', 'مينا  زكريا', 'مينـا زكريا', 'MINA'.toLowerCase() === 'mina' ? 'مينا زكريّا' : '']) {
    const reply = mina.call('apiSetAdminName', SECOND, same);
    assert.equal(reply.ok, false, same);
    assert.match(reply.error, /مستخدم لأدمن تاني/, same);
  }
  // nor another admin's fallback (their email's local part)
  const local = mina.call('apiSetAdminName', SECOND, 'Third.Admin');
  assert.equal(local.ok, false);
  assert.match(local.error, /مستخدم لأدمن تاني/);

  // right-to-left override / zero-width characters are stripped before comparing
  const sneaky = mina.call('apiSetAdminName', SECOND, '‮مينا​ زكريا');
  assert.equal(sneaky.ok, false, 'a disguised copy is still a copy');

  for (const bad of ['م', 'x'.repeat(41), 'a@b.com', '<b>x</b>', '=SUM(A1)', '١٢٣']) {
    const reply = mina.call('apiSetAdminName', SECOND, bad);
    assert.equal(reply.ok, false, bad);
  }
  // only someone on the list
  assert.equal(mina.call('apiSetAdminName', 'stranger@gmail.com', 'حد').ok, false);
  assert.equal(JSON.parse(world.properties.get('ADMIN_NAMES'))[SECOND], undefined, 'nothing refused was stored');

  // the page can't name the actor: an extra argument changes nothing
  mina.ok('apiSaveItem', 'news', { title: 'خبر', summary: 'x', actor: SECOND, by: SECOND });
  assert.equal(rows(world).at(-1).actor, ADMIN);
});

test('names: an admin removed in «الصلاحيات» (D1 → ADMIN_EMAILS mirror) loses their name and admin devices', () => {
  const world = apiWorld();
  const mina = tab(world, ADMIN).start();
  const fady = tab(world, SECOND, 'موبايل أندرويد – Chrome').start();
  mina.ok('apiSetAdminName', SECOND, 'فادي يوسف');
  fady.ok('apiAdminPushSubscribe', { token: deviceToken(1), platform: 'android', device: 'موبايل' });
  assert.equal(adminSubs(world).length, 1);

  world.properties.set('WORKER_SYNC_SECRET', 's'.repeat(48));
  world.web['https://athanasios-api.menazak-lab.workers.dev/v1/sync/grants'] = { status: 200, body: JSON.stringify({
    ok: true, v: 1, enforce: false, perms: ['content.view'], admins: [{ email: ADMIN, primary: true, g: 'A' }]
  }) };
  world.gs.API_REQUEST_ = null;
  world.gs.grantsSnapshot_();
  assert.equal(world.properties.get('ADMIN_EMAILS'), ADMIN);
  assert.equal(JSON.parse(world.properties.get('ADMIN_NAMES') || '{}')[SECOND], undefined);
  assert.equal(adminSubs(world).length, 0, 'their devices are gone');
});


/* ---------------- the log ---------------- */

test('activity: meaningful actions are logged with who (server-side), what, the item and Cairo time — reads are not', () => {
  const world = apiWorld();
  const mina = tab(world, ADMIN).start();
  mina.ok('apiSetAdminName', ADMIN, 'مينا زكريا');
  const before = rows(world).length;

  mina.ok('apiState');
  mina.ok('apiReview');
  mina.ok('apiHeartbeat', { area: 'home' });
  mina.ok('apiActivity', {});
  assert.equal(rows(world).length, before, 'reads, reviews, heartbeats: nothing');

  mina.ok('apiSaveItem', 'news', { title: 'مؤتمر الشباب', summary: 'x' });
  const created = rows(world).at(-1);
  assert.equal(created.action, 'create');
  assert.equal(created.entityType, 'news');
  assert.match(created.entityId, /^news-[0-9a-f]{8}$/);
  assert.equal(created.actor, ADMIN);
  assert.equal(created.actorName, 'مينا زكريا');
  assert.match(created.id, /^act-[0-9a-f]{12}$/);
  assert.match(created.cairo, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(created.summary, 'أضاف خبر جديد «مؤتمر الشباب»');

  mina.ok('apiSaveItem', 'sessions', { date: '2026-10-11', time: '20:00', topic: 'الصلاة' });
  assert.equal(rows(world).at(-1).summary, 'أضاف اجتماع الأحد ١١ أكتوبر');

  mina.ok('apiSaveSettings', { 'site.tagline': 'جملة جديدة' });
  assert.equal(rows(world).at(-1).summary, 'غيّر إعدادات الموقع');
  mina.ok('apiSaveSettings', { 'site.tagline': 'جملة جديدة' });
  assert.equal(rows(world).filter(r => r.action === 'settings').length, 1, 'saving the same values again: nothing changed, nothing logged');

  mina.ok('apiSetLinkEnabled', 'facebook', false);
  assert.equal(rows(world).at(-1).action, 'disable');
  mina.ok('apiMoveLink', 'facebook', 1);
  mina.ok('apiMoveLink', 'facebook', -1);
  const moves = rows(world).filter(r => r.action === 'reorder');
  assert.equal(moves.length, 1, 'arrow clicks become one row');
  assert.equal(Number(moves[0].count), 2);
  assert.equal(moves[0].summary, 'رتّب الروابط');

  // the page sees the current names in front
  const page = mina.ok('apiActivity', {});
  assert.equal(page.items[0].text, 'مينا زكريا رتّب الروابط');
  assert.equal(page.items.every(i => i.actor === ADMIN), true);
});

test('activity: a create then edits stay one «أضاف» row; edits by another admin are their own rows; changed fields are named', () => {
  const world = apiWorld();
  const mina = tab(world, ADMIN).start();
  const fady = tab(world, SECOND).start();

  const state = mina.ok('apiSaveItem', 'news', { title: 'خبر', summary: 'x' });
  const id = state.draft.news.find(n => n.title === 'خبر').id;
  mina.ok('apiSaveItem', 'news', { id, title: 'خبر', summary: 'y' });
  mina.ok('apiSaveItem', 'news', { id, title: 'خبر مهم', summary: 'y' });
  let log = rows(world).filter(r => r.entityId === id);
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'create');
  assert.equal(Number(log[0].count), 3);
  assert.equal(log[0].entityTitle, 'خبر مهم', 'the latest title');

  fady.ok('apiSaveItem', 'news', { id, title: 'خبر مهم', summary: 'z', body: 'تفاصيل' });
  log = rows(world).filter(r => r.entityId === id);
  assert.equal(log.length, 2);
  assert.equal(log[1].action, 'update');
  assert.equal(log[1].actor, SECOND);
  assert.deepEqual(JSON.parse(log[1].changes).fields, ['الملخص', 'التفاصيل']);
  assert.equal(log[1].summary, 'عدّل الخبر «خبر مهم»');

  // later than the merge window: a new row
  world.advance(11 * 60_000);
  fady.ok('apiSaveItem', 'news', { id, title: 'خبر مهم', summary: 'w', body: 'تفاصيل' });
  assert.equal(rows(world).filter(r => r.entityId === id).length, 3);

  fady.ok('apiDeleteItem', 'news', id);
  const gone = rows(world).at(-1);
  assert.equal(gone.action, 'delete');
  assert.equal(gone.summary, 'مسح الخبر «خبر مهم»', 'the title it had');
});

test('activity: logging can never break the action it describes', () => {
  const world = apiWorld();
  const mina = tab(world, ADMIN).start();
  // the Activity tab can't be written at all
  world.gs.activitySheet_ = () => { throw new Error('Sheets is down'); };
  const reply = mina.call('apiSaveItem', 'news', { title: 'برضه يتحفظ', summary: 'x' });
  assert.equal(reply.ok, true, reply.error);
  assert.ok(world.gs.readTable_('News').some(n => n.title === 'برضه يتحفظ'));
});

test('activity: retention keeps the newest rows (and nothing older than a year)', () => {
  const world = apiWorld();
  const gs = world.gs;
  gs.ACTIVITY_MAX_ROWS = 20;
  gs.ACTIVITY_TRIM_SLACK = 5;
  const mina = tab(world, ADMIN).start();
  for (let i = 0; i < 30; i++) mina.ok('apiSaveItem', 'news', { title: `خبر ${i}`, summary: 'x' });
  const kept = rows(world);
  assert.ok(kept.length <= 25, `capped (${kept.length})`);
  assert.equal(kept.at(-1).entityTitle, 'خبر 29', 'the newest stays');

  // a year later: the old rows go with the next write
  world.advance(366 * 86400_000);
  const page = tab(world, ADMIN).start();
  page.ok('apiSaveItem', 'news', { title: 'جديد', summary: 'x' });
  assert.deepEqual(rows(world).map(r => r.entityTitle), ['جديد']);
});

test('activity: filters (person, family, section, date), paging, one entry by id; admins only', () => {
  const world = apiWorld();
  const mina = tab(world, ADMIN).start();
  const fady = tab(world, SECOND).start();
  mina.ok('apiSaveItem', 'news', { title: 'خبر', summary: 'x' });
  world.advance(1000);
  fady.ok('apiSaveContact', { name: 'أبونا', phone: '01012345678', method: 'call' });
  world.advance(1000);
  fady.ok('apiSaveLink', { title: 'رابط', url: 'https://a.com', section: 'social' });
  world.advance(1000);
  mina.ok('apiSetLinkEnabled', 'facebook', false);

  assert.deepEqual(mina.ok('apiActivity', { actor: SECOND }).items.map(i => i.type), ['links', 'contacts']);
  assert.deepEqual(mina.ok('apiActivity', { family: 'add' }).items.map(i => i.type), ['links', 'contacts', 'news']);
  assert.deepEqual(mina.ok('apiActivity', { family: 'edit' }).items.map(i => i.action), ['disable']);
  assert.equal(mina.ok('apiActivity', { section: 'page' }).items.length, 3);
  assert.equal(mina.ok('apiActivity', { section: 'news' }).items.length, 1);
  const today = world.gs.Utilities.formatDate(new Date(Date.now() + world.clock.skew), 'Africa/Cairo', 'yyyy-MM-dd');
  assert.equal(mina.ok('apiActivity', { from: today, to: today }).items.length, 4);
  assert.equal(mina.ok('apiActivity', { from: '2000-01-01', to: '2000-01-02' }).items.length, 0);

  const first = mina.ok('apiActivity', { limit: 3 });
  assert.equal(first.items.length, 3);
  assert.equal(first.more, true);
  const second = mina.ok('apiActivity', { limit: 3, before: first.next });
  assert.equal(second.items.length, 1);
  assert.equal(second.more, false);

  const one = mina.ok('apiActivity', { id: first.items[1].id });
  assert.deepEqual(one.items.map(i => i.id), [first.items[1].id]);
  assert.ok(first.admins.some(a => a.email === SECOND));

  // the public can't read it: no token / not on the list
  assert.equal(world.post({ fn: 'apiActivity', args: [{}] }).ok, false);
  const stranger = world.issueToken({ email: 'stranger@gmail.com' });
  assert.equal(world.post({ fn: 'apiActivity', args: [{}], token: stranger }).code, 'denied');
});

test('activity: publish, public push send, import, admin changes and a takeover are logged; an unchanged publish says so', async () => {
  const world = apiWorld();
  const mina = tab(world, ADMIN).start();
  mina.ok('apiSaveItem', 'news', { title: 'خبر للنشر', summary: 'x' });
  const review = mina.ok('apiReview');
  mina.ok('apiPublish', review.revision);
  const pub = rows(world).at(-1);
  assert.equal(pub.action, 'publish');
  assert.equal(pub.summary, 'نشر تحديث الموقع');
  assert.match(pub.ref, /^\w+ [0-9a-f]{7}$/, 'revision + commit');
  assert.deepEqual(JSON.parse(pub.changes).items, ['خبر للنشر']);

  mina.ok('apiPublish', mina.ok('apiReview').revision);
  assert.equal(rows(world).at(-1).summary, 'نشر من غير تغييرات جديدة');

  // a takeover by the same account from another device
  tab(world, ADMIN, 'موبايل أندرويد – Chrome').start();
  const takeover = rows(world).at(-1);
  assert.equal(takeover.action, 'session.takeover');
});


/* ---------------- admin push ---------------- */

test('admin push: subscribe needs a signed-in admin; the row is the server\'s identity; a visitor token is refused', () => {
  const world = apiWorld();
  const fady = tab(world, SECOND, 'موبايل أندرويد – Chrome').start();

  // no token, no session: refused
  assert.equal(world.post({ fn: 'apiAdminPushSubscribe', args: [{ token: deviceToken(1) }] }).ok, false);

  const on = fady.ok('apiAdminPushSubscribe', { token: deviceToken(1), platform: 'android', device: 'موبايل أندرويد', email: ADMIN });
  assert.equal(on.on, true);
  assert.equal(on.devices.length, 1);
  assert.equal(on.devices[0].current, true);
  assert.equal(adminSubs(world)[0][2], SECOND, 'stored for the token\'s account, not what the page said');
  assert.equal(world.spreadsheet.getSheetByName('PushSubs')?.data.slice(1).filter(r => r[0]).length || 0, 0, 'never the public tab');

  // the same device again: one row
  fady.ok('apiAdminPushSubscribe', { token: deviceToken(1), platform: 'android' });
  assert.equal(adminSubs(world).length, 1);

  // a token that is a visitor subscription is never an admin one
  assert.equal(world.post({ fn: 'pushSubscribe', args: [{ token: deviceToken(9), platform: 'android' }] }).ok, true);
  const shared = fady.call('apiAdminPushSubscribe', { token: deviceToken(9) });
  assert.equal(shared.ok, false);

  // at most 5 devices: the oldest makes room
  for (let i = 2; i <= 7; i++) { world.advance(1000); fady.ok('apiAdminPushSubscribe', { token: deviceToken(i) }); }
  const mine = fady.ok('apiAdminPushDevices', { token: deviceToken(7) });
  assert.equal(mine.devices.length, 5);
  assert.equal(mine.on, true);

  // off: only my own device
  const mina = tab(world, ADMIN).start();
  mina.ok('apiAdminPushUnsubscribe', { token: deviceToken(7) });
  assert.equal(adminSubs(world).length, 5, 'not someone else\'s');
  fady.ok('apiAdminPushUnsubscribe', { token: deviceToken(7) });
  assert.equal(adminSubs(world).length, 4);
  const removeId = fady.ok('apiAdminPushDevices', {}).devices[0].id;
  fady.ok('apiAdminPushRemoveDevice', removeId);
  assert.equal(adminSubs(world).length, 3);
});

function pushWorld() {
  const world = apiWorld();
  world.fcm.siteContent = JSON.stringify({ schema: 3, revision: 'r', layout: [], notifications: [] });
  const mina = tab(world, ADMIN, 'كمبيوتر').start();
  const fady = tab(world, SECOND, 'موبايل فادي').start();
  const third = tab(world, THIRD, 'موبايل تالت').start();
  mina.ok('apiSetAdminName', ADMIN, 'مينا زكريا');
  mina.ok('apiSetAdminName', SECOND, 'فادي يوسف');
  mina.ok('apiAdminPushSubscribe', { token: deviceToken(1), platform: 'desktop' });
  fady.ok('apiAdminPushSubscribe', { token: deviceToken(2), platform: 'android' });
  third.ok('apiAdminPushSubscribe', { token: deviceToken(3), platform: 'ios' });
  for (const n of [1, 2, 3]) world.fcm.devices.set(deviceToken(n), 'ok');
  // everyone closes the panel (not "present"): pushes go to their phones
  for (const page of [mina, fady, third]) page.leave();
  world.advance(5 * 60_000);
  return { world, mina: { leave() {} } };
}

// the pushes waiting after the replies go out (what the next heartbeat does: activityPending_)
const send = world => world.gs.activityPending_('apiHeartbeat');
const sentTo = (world, from = 0) => fcmSent(world).slice(from).map(m => m.message.token);

test('admin push: a create goes to the OTHER admins now, never to the actor; the message names the actor and deep-links', () => {
  const { world, mina } = pushWorld();
  mina.leave();
  const fady = tab(world, SECOND).start();
  fady.leave();
  const before = fcmSent(world).length;

  const actor = tab(world, ADMIN).start();
  actor.leave();   // even with no panel open, never the actor's own devices
  const quiet = tab(world, ADMIN).start();
  quiet.ok('apiSaveItem', 'news', { title: 'خبر جديد للكل', summary: 'x' });
  assert.equal(fcmSent(world).length, before, 'the reply never waits for the push');
  assert.equal(rows(world).at(-1).notified, 'pending:now');
  quiet.leave();   // the closing panel's beacon (apiSessionEnd) carries it
  send(world);

  const to = sentTo(world, before);
  assert.deepEqual(to.sort(), [deviceToken(2), deviceToken(3)].sort());
  const message = fcmSent(world).at(-1).message;
  assert.equal(message.data.kind, 'admin');
  assert.equal(message.data.title, 'مينا زكريا أضاف خبر جديد «خبر جديد للكل»');
  assert.match(message.data.url, /^\/admin\/#open\/news\/news-[0-9a-f]{8}$/);
  assert.match(message.data.tag, /^adm-news-news-/);
  assert.equal(rows(world).at(-1).notified, '2');
});

test('admin push: edits have a 30-minute cooldown per admin and item; a create counts; deletes are immediate', () => {
  const { world, mina } = pushWorld();
  mina.leave();
  const actor = tab(world, ADMIN).start();
  const state = actor.ok('apiSaveItem', 'news', { title: 'خبر', summary: 'x' });
  const id = state.draft.news.find(n => n.title === 'خبر').id;
  actor.leave();
  send(world);
  const afterCreate = fcmSent(world).length;

  world.advance(12 * 60_000);
  const again = tab(world, ADMIN).start();
  again.ok('apiSaveItem', 'news', { id, title: 'خبر', summary: 'y' });
  again.leave();
  send(world);
  assert.equal(fcmSent(world).length, afterCreate, 'edit right after a create: no push');
  assert.equal(rows(world).at(-1).notified, 'cooldown');

  world.advance(31 * 60_000);
  const later = tab(world, ADMIN).start();
  later.ok('apiSaveItem', 'news', { id, title: 'خبر', summary: 'z' });
  later.leave();
  send(world);
  assert.equal(fcmSent(world).length, afterCreate + 2, 'after the cooldown: one push to each other admin');

  const now = tab(world, ADMIN).start();
  now.ok('apiDeleteItem', 'news', id);
  now.leave();
  send(world);
  assert.equal(fcmSent(world).length, afterCreate + 4, 'delete: immediate');

  // log-only actions: never a push
  const quiet = tab(world, ADMIN).start();
  quiet.ok('apiMoveLink', 'facebook', 1);
  quiet.ok('apiSetLinkEnabled', 'facebook', false);
  quiet.leave();
  send(world);
  assert.equal(fcmSent(world).length, afterCreate + 4);
});

test('admin push: an admin with the panel open gets a toast from the heartbeat instead of a push', () => {
  const { world, mina } = pushWorld();
  mina.leave();
  const fady = tab(world, SECOND).start();
  const since = fady.ok('apiState').activity.latest;
  fady.ok('apiHeartbeat', { area: 'home', since });   // Fady is in the panel now

  const before = fcmSent(world).length;
  const actor = tab(world, ADMIN).start();
  actor.ok('apiSaveItem', 'news', { title: 'خبر من مينا', summary: 'x' });
  actor.leave();
  send(world);

  assert.deepEqual(sentTo(world, before), [deviceToken(3)], 'only the absent admin\'s phone');

  const beat = fady.ok('apiHeartbeat', { area: 'home', since });
  assert.equal(beat.activity.length, 1);
  assert.equal(beat.activity[0].text, 'مينا زكريا أضاف خبر جديد «خبر من مينا»');
  assert.equal(beat.activity[0].type, 'news');
  // his own actions never come back to him
  fady.ok('apiSaveItem', 'news', { title: 'من فادي', summary: 'x' });
  const mine = fady.ok('apiHeartbeat', { area: 'home', since });
  assert.equal(mine.activity.some(a => a.actor === SECOND), false);
});

test('admin push: removed admins get nothing; the allowlist is read again for every send; no key = logged only', () => {
  const { world, mina } = pushWorld();
  mina.leave();
  // third is removed behind the panel's back (Script Properties edited by hand)
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  const before = fcmSent(world).length;
  const actor = tab(world, ADMIN).start();
  actor.ok('apiSaveItem', 'news', { title: 'خبر', summary: 'x' });
  actor.leave();
  send(world);
  assert.deepEqual(sentTo(world, before), [deviceToken(2)]);

  world.properties.delete('FCM_SERVICE_ACCOUNT');
  const quiet = tab(world, ADMIN).start();
  const reply = quiet.call('apiSaveItem', 'news', { title: 'خبر تاني', summary: 'x' });
  assert.equal(reply.ok, true, 'saving still works');
  send(world);
  assert.equal(rows(world).at(-1).notified, 'off');
});

test('admin push: FCM failing never breaks the save; dead admin tokens are removed', () => {
  const { world, mina } = pushWorld();
  mina.leave();
  world.fcm.devices.set(deviceToken(2), 'unregistered');
  world.fcm.revoked = false;
  const actor = tab(world, ADMIN).start();
  const reply = actor.call('apiSaveItem', 'news', { title: 'خبر', summary: 'x' });
  assert.equal(reply.ok, true);
  send(world);
  assert.equal(adminSubs(world).some(r => r[1] === deviceToken(2)), false, 'the dead token is gone');

  world.fcm.revoked = true;   // Google refuses every send
  const again = actor.call('apiSaveItem', 'news', { title: 'خبر ٢', summary: 'x' });
  assert.equal(again.ok, true, 'still saved');
  send(world);
  assert.equal(rows(world).at(-1).notified, 'error');
});

test('admin push: a public push send tells the other admins; publish too', () => {
  const { world, mina } = pushWorld();
  mina.leave();
  const actor = tab(world, ADMIN).start();
  actor.ok('apiSaveItem', 'news', { title: 'خبر للنشر', summary: 'x' });
  send(world);
  const before = fcmSent(world).length;
  actor.ok('apiPublish', actor.ok('apiReview').revision);
  actor.leave();
  send(world);
  const publish = fcmSent(world).slice(before);
  assert.equal(publish.length, 2);
  assert.equal(publish[0].message.data.title, 'مينا زكريا نشر تحديث الموقع');
  assert.equal(publish[0].message.data.body, 'فيه: خبر للنشر');
  assert.match(publish[0].message.data.url, /^\/admin\/#activity\/act-[0-9a-f]{12}$/);
});

test('admin push: at most 6 from one admin in 10 minutes — a publish still goes out', () => {
  const { world } = pushWorld();
  const actor = tab(world, ADMIN).start();
  for (let i = 0; i < 8; i++) actor.ok('apiSaveItem', 'news', { title: `خبر ${i}`, summary: 'x' });
  send(world);
  const log = rows(world).filter(r => r.action === 'create');
  assert.deepEqual(log.slice(0, 6).map(r => r.notified), ['2', '2', '2', '2', '2', '2']);
  assert.deepEqual(log.slice(6).map(r => r.notified), ['rate', 'rate']);
  actor.ok('apiPublish', actor.ok('apiReview').revision);
  send(world);
  assert.equal(rows(world).at(-1).action, 'publish');
  assert.equal(rows(world).at(-1).notified, '2', 'the publish is never held back');
});

test('admin push: none of the actor\'s devices (phone, PC…) hears about the actor\'s own action — by account, not by device', () => {
  const { world } = pushWorld();
  // Mina has a second device (his phone) besides the PC subscribed in pushWorld
  const phone = tab(world, ADMIN, 'موبايل مينا').start();
  phone.ok('apiAdminPushSubscribe', { token: deviceToken(4), platform: 'android' });
  world.fcm.devices.set(deviceToken(4), 'ok');
  phone.leave();
  world.advance(5 * 60_000);
  const before = fcmSent(world).length;
  // he edits from the PC
  const pc = tab(world, ADMIN, 'كمبيوتر').start();
  pc.ok('apiSaveItem', 'news', { title: 'من الكمبيوتر', summary: 'x' });
  pc.leave();
  send(world);
  const to = sentTo(world, before);
  assert.equal(to.includes(deviceToken(1)), false, 'not his PC');
  assert.equal(to.includes(deviceToken(4)), false, 'not his phone');
  assert.deepEqual(to.sort(), [deviceToken(2), deviceToken(3)].sort(), 'the other admins only');
});


/* ---------------- deferred admin push (the reply never waits for FCM) ---------------- */

test('admin push after the reply: the save sends nothing; another admin\'s next heartbeat sends it', () => {
  const { world, mina } = pushWorld();
  mina.leave();
  const fady = tab(world, SECOND).start();
  const before = fcmSent(world).length;
  const actor = tab(world, ADMIN).start();
  actor.ok('apiSaveItem', 'news', { title: 'خبر مؤجل', summary: 'x' });
  assert.equal(fcmSent(world).length, before, 'nothing sent before the reply');
  assert.equal(rows(world).at(-1).notified, 'pending:now');
  // the actor's own later save does not carry it either
  actor.ok('apiSaveItem', 'news', { title: 'خبر تاني', summary: 'x' });
  assert.equal(fcmSent(world).length, before);
  // any open panel's heartbeat does (Fady is in the panel: only the absent admin's phone)
  fady.ok('apiHeartbeat', { area: 'home' });
  assert.deepEqual(sentTo(world, before), [deviceToken(3), deviceToken(3)]);
  assert.deepEqual(rows(world).filter(r => r.action === 'create').slice(-2).map(r => r.notified), ['1', '1']);
  // nothing waits any more: the next beat sends nothing
  fady.ok('apiHeartbeat', { area: 'home' });
  assert.equal(fcmSent(world).length, before + 2);
});

test('admin push after the reply: exactly once — a claimed row is never sent again, a busy lock waits for the next beat', () => {
  const { world, mina } = pushWorld();
  mina.leave();
  const actor = tab(world, ADMIN).start();
  actor.ok('apiSaveItem', 'news', { title: 'مرة واحدة', summary: 'x' });
  const before = fcmSent(world).length;
  world.scriptLock.busy = true;
  assert.equal(send(world), 0, 'a publish holds the lock: not now');
  world.scriptLock.busy = false;
  assert.equal(send(world), 1);
  assert.equal(send(world), 0, 'the second dispatcher finds nothing');
  assert.equal(fcmSent(world).length, before + 2);
  // a run that died after claiming: the row says «sending», nobody sends it again
  actor.ok('apiSaveItem', 'news', { title: 'اتقطع', summary: 'x' });
  const sheet = world.spreadsheet.getSheetByName('Activity');
  sheet.data[sheet.data.length - 1][13] = 'sending';
  assert.equal(send(world), 0);
  assert.equal(fcmSent(world).length, before + 2);
});

test('admin push after the reply: with no heartbeat, a quiet call sends what waited a minute; a save never does', () => {
  const { world, mina } = pushWorld();
  mina.leave();
  const actor = tab(world, ADMIN).start();
  const before = fcmSent(world).length;
  actor.ok('apiSaveItem', 'news', { title: 'خبر', summary: 'x' });
  actor.ok('apiActivity', {});
  assert.equal(fcmSent(world).length, before, 'not yet: a heartbeat may still come');
  world.advance(61_000);
  actor.ok('apiSaveItem', 'news', { title: 'خبر ٢', summary: 'x' });
  assert.equal(fcmSent(world).length, before, 'a save never carries it');
  actor.ok('apiActivity', {});
  assert.equal(fcmSent(world).length, before + 4, 'both rows, to the two other admins');
});

test('admin push after the reply: a lost cache flag is swept by a heartbeat; the closing panel\'s beacon carries it', () => {
  const { world, mina } = pushWorld();
  mina.leave();
  const actor = tab(world, ADMIN).start();
  const before = fcmSent(world).length;
  actor.ok('apiSaveItem', 'news', { title: 'العلم ضاع', summary: 'x' });
  world.gs.CacheService.getScriptCache().remove('adm:act:pending');   // evicted
  world.gs.CacheService.getScriptCache().remove('adm:act:sweep');     // last sweep window over
  assert.equal(world.gs.activityPending_('apiActivity'), 0, 'a quiet call does not scan');
  assert.equal(world.gs.activityPending_('apiHeartbeat'), 1, 'the heartbeat sweeps the tail');
  assert.equal(fcmSent(world).length, before + 2);
  assert.equal(world.gs.activityPending_('apiHeartbeat'), 0, 'swept at most every 10 minutes');

  actor.ok('apiSaveItem', 'news', { title: 'وقفل على طول', summary: 'x' });
  assert.equal(world.gs.activityPending_('apiSessionEnd'), 1, 'the closing beacon sends it');
  assert.equal(fcmSent(world).length, before + 4);
});

test('warm: a public no-op — no token, nothing read or written', () => {
  const world = apiWorld();
  const sheets = JSON.stringify(world.spreadsheet.getSheets().map(s => [s.name, s.data]));
  const props = JSON.stringify([...world.properties.entries()]);
  const reply = world.post({ fn: 'warm', args: [] });
  assert.equal(reply.ok, true);
  assert.deepEqual(Object.keys(reply).sort(), ['mime', 'ok']);
  assert.equal(JSON.stringify(world.spreadsheet.getSheets().map(s => [s.name, s.data])), sheets);
  assert.equal(JSON.stringify([...world.properties.entries()]), props);
});
