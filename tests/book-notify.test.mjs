// New bookings → admin push (apps-script/BookNotify.gs, docs/EVENTS.md §7.3)
// against the fake Apps Script world: the time trigger asks the Worker
// (signed like the allowlist sync, checked with the Worker's own code), each
// group becomes ONE Activity row (system actor «visitor») and ONE push to the
// admins who are not in the panel; present admins get it as a toast.
// Nothing happens while BOOKING_ONLINE is off.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createWorld } from './fakes/gas.mjs';
import { signSync } from '../worker/src/lib/sync.js';

const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'fady.youssef@gmail.com';
const THIRD = 'third.admin@gmail.com';
const CLIENT = '1234-abc.apps.googleusercontent.com';
const NEWS_URL = 'https://athanasios-api.menazak-lab.workers.dev/v1/sync/book-news';
const SECRET = 's'.repeat(48);

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account', project_id: 'athanasios-links', private_key_id: 'abc123',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  client_email: 'push-sender@athanasios-links.iam.gserviceaccount.com', token_uri: 'https://oauth2.googleapis.com/token'
});
const deviceToken = n => `a${String(n).padStart(3, '0')}Xk2:APA91b${'Z'.repeat(140)}${n}`;

function tab(world, email) {
  const now = Math.floor((Date.now() + world.clock.skew) / 1000);
  const token = world.issueToken({ email, iat: String(now), exp: String(now + 3600) });
  const page = {
    sid: '',
    start() {
      const reply = world.post({ fn: 'apiSessionStart', args: [{ device: 'جهاز', force: true, state: false }], token });
      assert.equal(reply.ok, true, reply.error);
      page.sid = reply.result.sid;
      return page;
    },
    ok(fn, ...args) {
      const reply = world.post({ fn, args, token, sid: page.sid });
      assert.equal(reply.ok, true, `${fn}: ${reply.error}`);
      return reply.result;
    },
    leave() { return world.post({ fn: 'apiSessionEnd', args: [{ park: true }], token, sid: page.sid }); }
  };
  return page;
}

function newsWorld({ online = true, groups = [{ eventId: 'evt-alex01', slug: 'alex-trip', title: 'رحلة الإسكندرية', count: 3, pending: 5, firstAt: '', lastAt: '' }] } = {}) {
  const world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');
  world.properties.set('ADMIN_CLIENT_ID', CLIENT);
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}, ${THIRD}`);
  world.properties.set('FCM_SERVICE_ACCOUNT', SERVICE_ACCOUNT);
  world.properties.set('WORKER_SYNC_SECRET', SECRET);
  if (online) world.properties.set('BOOKING_ONLINE', '1');
  world.as('');
  world.fcm.siteContent = JSON.stringify({ schema: 3, revision: 'r', layout: [], notifications: [] });
  const pages = [ADMIN, SECOND, THIRD].map(email => tab(world, email).start());
  pages[0].ok('apiSetAdminName', SECOND, 'فادي يوسف');
  pages.forEach((page, i) => page.ok('apiAdminPushSubscribe', { token: deviceToken(i + 1), platform: 'android' }));
  for (const n of [1, 2, 3]) world.fcm.devices.set(deviceToken(n), 'ok');
  pages.forEach(page => page.leave());
  world.advance(5 * 60_000);
  world.web[NEWS_URL] = { status: 200, body: JSON.stringify({ ok: true, groups }) };
  world.as(ADMIN).gs.enableBookingAlerts();
  world.gs.API_REQUEST_ = null;    // a time trigger: no admin request around it
  world.as('');
  return { world, pages };
}

const activityRows = world => {
  const sheet = world.spreadsheet.getSheetByName('Activity');
  const [head, ...body] = sheet.data;
  return body.filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(head.map((k, i) => [k, r[i]])));
};
const fcmSent = world => world.fcm.sent.map(s => s.body);
const newsCalls = world => world.webRequests.filter(r => r.url === NEWS_URL);
// what the trigger does: its own uid (set by enableBookingAlerts)
const tick = world => world.gs.bookNewsTick({ triggerUid: world.properties.get('BOOK_NEWS_TRIGGER_ID') });

test('book news: off until BOOKING_ONLINE = 1 — no call to the Worker, nothing written', () => {
  const { world } = newsWorld({ online: false });
  const before = activityRows(world).length;
  assert.equal(tick(world), -1);
  assert.equal(newsCalls(world).length, 0);
  assert.equal(activityRows(world).length, before);
});

test('book news: one signed call; each group → one «visitor» Activity row and one push to every absent admin, deep-linked, nothing personal', async () => {
  const { world } = newsWorld();
  const before = fcmSent(world).length;
  assert.equal(tick(world), 1);

  const [call] = newsCalls(world);
  const body = Buffer.from(call.options.payload.map(b => (b < 0 ? b + 256 : b))).toString('utf8');
  const ts = call.options.headers['x-sync-ts'];
  assert.equal(call.options.headers['x-sync-signature'], await signSync(SECRET, ts, body), 'the Worker accepts this signature');

  const row = activityRows(world).at(-1);
  assert.deepEqual([row.actor, row.actorName, row.action, row.entityType, row.entityId], ['visitor', 'زوار', 'booking.new', 'bookings', 'evt-alex01']);
  assert.equal(row.summary, 'بعتوا ٣ طلبات حجز في «رحلة الإسكندرية»');
  assert.equal(row.notified, 'sent:3');
  assert.deepEqual(JSON.parse(row.changes), { count: 3, pending: 5 });

  const sent = fcmSent(world).slice(before).map(m => m.message);
  assert.deepEqual(sent.map(m => m.token).sort(), [1, 2, 3].map(deviceToken).sort(), 'no actor: every admin who is away');
  assert.equal(sent[0].data.title, '٣ حجوزات جديدة – رحلة الإسكندرية');
  assert.equal(sent[0].data.body, 'مستنيين المراجعة: ٥');
  assert.equal(sent[0].data.url, '/admin/#open/bookings/evt-alex01');
  assert.equal(sent[0].data.tag, 'adm-bookings-evt-alex01', 'the next group for the event replaces this notification');
  assert.doesNotMatch(JSON.stringify(sent) + JSON.stringify(row), /\+20|01\d{9}|B-[0-9A-Z]{5}/);
});

test('book news: an admin with the panel open gets the toast from the heartbeat, not a push', () => {
  const { world } = newsWorld({ groups: [{ eventId: 'evt-alex01', title: 'رحلة الإسكندرية', count: 1, pending: 1 }] });
  const fady = tab(world, SECOND).start();
  const since = fady.ok('apiState').activity.latest;
  fady.ok('apiHeartbeat', { area: 'home', since });
  world.as('');
  world.gs.API_REQUEST_ = null;
  const before = fcmSent(world).length;
  assert.equal(tick(world), 1);
  assert.deepEqual(fcmSent(world).slice(before).map(m => m.message.token).sort(), [deviceToken(1), deviceToken(3)].sort());
  assert.equal(fcmSent(world).at(-1).message.data.title, 'حجز جديد – رحلة الإسكندرية');

  const beat = fady.ok('apiHeartbeat', { area: 'home', since });
  const toast = beat.activity.find(a => a.action === 'booking.new');
  assert.ok(toast, 'the toast');
  assert.equal(toast.text, 'زائر بعت طلب حجز في «رحلة الإسكندرية»');
});

test('book news: odd groups are skipped; a Worker that fails or answers nothing never throws', () => {
  const { world } = newsWorld({ groups: [{ eventId: 'not-an-event', count: 2 }, { eventId: 'evt-alex01', count: 0 }, null, { eventId: 'evt-ok01', title: '', count: 2, pending: -1 }] });
  assert.equal(tick(world), 1);
  assert.equal(activityRows(world).at(-1).summary, 'بعتوا طلبين حجز في «فعالية»');
  assert.equal(fcmSent(world).at(-1).message.data.body, 'افتح الحجوزات');

  world.web[NEWS_URL] = { status: 503, body: 'down' };
  assert.equal(tick(world), 0);
  world.web[NEWS_URL] = { status: 200, body: 'not json' };
  assert.equal(tick(world), 0);
  world.properties.delete('WORKER_SYNC_SECRET');
  const calls = newsCalls(world).length;
  assert.equal(tick(world), 0, 'no secret: nothing asked');
  assert.equal(newsCalls(world).length, calls);
});

test('book news: the words for 1, 2, 3–10 and 11+', () => {
  const { world } = newsWorld();
  assert.deepEqual([1, 2, 3, 10, 11].map(n => world.gs.bookNewsCount_(n)), ['طلب حجز', 'طلبين حجز', '٣ طلبات حجز', '١٠ طلبات حجز', '١١ طلب حجز']);
  assert.deepEqual([1, 2, 5, 12].map(n => world.gs.bookNewsTitle_({ count: n, title: 'رحلة' })), ['حجز جديد – رحلة', 'حجزين جداد – رحلة', '٥ حجوزات جديدة – رحلة', '١٢ حجز جديد – رحلة']);
});

test('book news: enableBookingAlerts (the owner, once) installs ONE five-minute trigger, again replaces it; admins only', () => {
  const { world } = newsWorld();
  world.as(ADMIN);
  world.gs.enableBookingAlerts();
  world.gs.enableBookingAlerts();
  const mine = world.triggers.list.filter(t => t.getHandlerFunction() === 'bookNewsTick');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].everyMinutes, 5);
  world.as('someone@else.com');
  assert.throws(() => world.gs.enableBookingAlerts());
});

test('book news: only its own trigger runs it (google.script.run can reach public names)', () => {
  const { world } = newsWorld();
  assert.equal(world.gs.bookNewsTick(), -2);
  assert.equal(world.gs.bookNewsTick({ triggerUid: 'trg-other' }), -2);
  assert.equal(newsCalls(world).length, 0);
  assert.equal(tick(world), 1);
});
