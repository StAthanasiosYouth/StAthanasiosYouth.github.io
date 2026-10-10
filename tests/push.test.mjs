// Web push, server side (apps-script/Push.gs) against the fake Apps Script
// world: a fake FCM HTTP v1 + Google token endpoint, and the live site's
// content.json. Covers the public subscribe/unsubscribe actions, the
// admin-only state/check/send, what may be sent (never a draft, a future
// or expired item), idempotency, limits, dead-token cleanup and the secret.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { createWorld } from './fakes/gas.mjs';

const ADMIN = 'menazakmena@gmail.com';
const STRANGER = 'someone@gmail.com';
const SITE = 'https://stathanasiosyouth.github.io/';
const plain = value => JSON.parse(JSON.stringify(value));

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: 'athanasios-links',
  private_key_id: 'abc123',
  private_key: PRIVATE_PEM,
  client_email: 'push-sender@athanasios-links.iam.gserviceaccount.com',
  token_uri: 'https://oauth2.googleapis.com/token'
});

/* Cairo wall time, minutes from now */
function wall(minutes) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(Date.now() + minutes * 60000)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/* a device token in FCM's shape */
const deviceToken = n => `d${String(n).padStart(3, '0')}Xk2:APA91b${'Q'.repeat(140)}${n}`;

function liveContent(overrides = {}) {
  return {
    schema: 3,
    revision: 'r1',
    layout: [
      { key: 'meeting', visibleFrom: '', visibleUntil: '' },
      { key: 'news', visibleFrom: '', visibleUntil: '' },
      { key: 'games', visibleFrom: wall(600), visibleUntil: '' },
      { key: 'competitions', visibleFrom: '', visibleUntil: '' }
    ],
    news: [{ id: 'news-aaaa1111', title: 'خبر' }],
    games: [{ id: 'game-1', title: 'لعبة' }],
    activities: [{ id: 'act-1', section: 'competitions', title: 'مسابقة' }],
    notifications: [
      { id: 'notif-session-1', type: 'meeting', title: 'اجتماع الأحد الجديد 🔔', message: 'موضوع الأسبوع اتنشر.. مستنيينكم الأحد الساعة 8 ❤️', target: { kind: 'meeting' }, image: null, publishAt: wall(-60), expireAt: wall(60 * 30) },
      { id: 'notif-news-aaaa1111', type: 'news', title: 'خبر جديد', message: 'تفاصيل', target: { kind: 'news', id: 'news-aaaa1111' }, image: { src: 'media/2026/img-af6b0c28.webp', thumb: 'media/2026/img-af6b0c28-480.webp', w: 1280, h: 720, alt: '' }, publishAt: wall(-10), expireAt: wall(60 * 24 * 14) },
      { id: 'notif-act-1', type: 'competition', title: 'المسابقة فتحت', message: '', target: { kind: 'activity', id: 'act-1' }, image: null, publishAt: wall(-5), expireAt: '' },
      { id: 'notif-later', type: 'general', title: 'بعدين', message: '', target: null, image: null, publishAt: wall(120), expireAt: wall(60 * 24) },
      { id: 'notif-old', type: 'general', title: 'قديم', message: '', target: null, image: null, publishAt: wall(-60 * 48), expireAt: wall(-60) },
      { id: 'notif-game-1-soon', type: 'game', title: 'التحدي قرب', message: '', target: { kind: 'game', id: 'game-1' }, image: null, publishAt: wall(-5), expireAt: wall(600) },
      { id: 'notif-gone', type: 'news', title: 'خبر اتشال', message: '', target: { kind: 'news', id: 'news-missing' }, image: null, publishAt: wall(-5), expireAt: '' },
      { id: 'notif-out', type: 'general', title: 'برا', message: '', target: { kind: 'url', url: 'https://example.com/' }, image: null, publishAt: wall(-5), expireAt: '' }
    ],
    ...overrides
  };
}

function pushWorld({ configured = true, content = liveContent() } = {}) {
  const world = createWorld();
  world.as(ADMIN).gs.setup();
  world.properties.set('SITE_URL', SITE);
  if (configured) world.properties.set('FCM_SERVICE_ACCOUNT', SERVICE_ACCOUNT);
  world.fcm.siteContent = JSON.stringify(content);
  return world;
}

const subscribe = (world, args) => world.post({ fn: 'pushSubscribe', args: [args] });
const unsubscribe = (world, args) => world.post({ fn: 'pushUnsubscribe', args: [args] });
const subsSheet = world => world.spreadsheet.getSheetByName('PushSubs');
const subRows = world => {
  const sheet = subsSheet(world);
  return sheet ? sheet.data.slice(1).filter(r => r.some(v => v !== '')) : [];
};
const logRows = world => world.spreadsheet.getSheetByName('PushLog').data.slice(1).filter(r => r.some(v => v !== ''));

/* n subscribed devices, each in an FCM state */
function devices(world, states) {
  states.forEach((state, i) => {
    const token = deviceToken(i);
    world.fcm.devices.set(token, state);
    assert.equal(subscribe(world, { token, platform: 'android' }).ok, true);
  });
}

let keyCounter = 0;
const sendKey = () => `s-${Date.now().toString(36)}-${++keyCounter}`;


/* =========================================================
   PUBLIC: subscribe / unsubscribe
========================================================= */

test('subscribe: a valid token is stored once (hash + token + platform), no admin token needed', () => {
  const world = pushWorld();
  const token = deviceToken(1);
  const reply = subscribe(world, { token, platform: 'ios' });
  assert.deepEqual({ ok: reply.ok }, { ok: true });
  const rows = subRows(world);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], token);
  assert.match(rows[0][0], /^h[0-9a-f]{40}$/);
  assert.equal(rows[0][2], 'ios');
  assert.deepEqual(subsSheet(world).data[0], ['tokenHash', 'token', 'platform', 'createdAt', 'lastSeen', 'fails']);
  // again (a refresh): no second row
  assert.equal(subscribe(world, { token, platform: 'ios' }).ok, true);
  world.cache.clear();
  assert.equal(subscribe(world, { token, platform: 'android' }).ok, true);
  assert.equal(subRows(world).length, 1);
  assert.equal(subRows(world)[0][2], 'android', 'updated in place');
});

test('subscribe: anything but an FCM token is refused; unknown platforms become "other"', () => {
  const world = pushWorld();
  for (const token of ['', 'short', `${'a'.repeat(120)}<script>`, `=IMPORTXML("x")${'a'.repeat(120)}`, 12345, null, 'a'.repeat(401)]) {
    assert.deepEqual(plain(subscribe(world, { token })), { mime: 'JSON', ok: false, code: 'invalid' }, String(token).slice(0, 20));
  }
  assert.deepEqual(plain(subscribe(world, null)), { mime: 'JSON', ok: false, code: 'invalid' });
  assert.equal(subscribe(world, { token: deviceToken(2), previous: 'bad' }).code, 'invalid');
  assert.equal(subscribe(world, { token: deviceToken(3), platform: 'toString' }).ok, true);
  assert.equal(subRows(world)[0][2], 'other');
});

test('subscribe with previous: a refreshed token replaces the old row', () => {
  const world = pushWorld();
  subscribe(world, { token: deviceToken(1) });
  subscribe(world, { token: deviceToken(2) });
  assert.equal(subscribe(world, { token: deviceToken(3), previous: deviceToken(1) }).ok, true);
  assert.deepEqual(subRows(world).map(r => r[1]).sort(), [deviceToken(2), deviceToken(3)].sort());
});

test('unsubscribe removes the row; unknown tokens are fine; invalid ones refused', () => {
  const world = pushWorld();
  subscribe(world, { token: deviceToken(1) });
  subscribe(world, { token: deviceToken(2) });
  assert.equal(unsubscribe(world, { token: deviceToken(1) }).ok, true);
  assert.deepEqual(subRows(world).map(r => r[1]), [deviceToken(2)]);
  assert.equal(unsubscribe(world, { token: deviceToken(9) }).ok, true);
  assert.equal(unsubscribe(world, { token: 'x' }).code, 'invalid');
  // subscribing again right after works (the "seen" cache was cleared)
  assert.equal(subscribe(world, { token: deviceToken(1) }).ok, true);
  assert.equal(subRows(world).length, 2);
});

test('public budget: at most 60 writes a minute, then "busy"; the next minute is open again', () => {
  const world = pushWorld();
  for (let i = 0; i < 60; i++) assert.equal(subscribe(world, { token: deviceToken(i) }).ok, true);
  assert.deepEqual(plain(subscribe(world, { token: deviceToken(99) })), { mime: 'JSON', ok: false, code: 'busy' });
  assert.equal(unsubscribe(world, { token: deviceToken(1) }).code, 'busy');
  world.advance(61000);
  assert.equal(subscribe(world, { token: deviceToken(99) }).ok, true);
  assert.match(world.properties.get('PUSH_DAY_COUNT'), /^\d{4}-\d{2}-\d{2}:61$/);
});

test('the public actions never read anything back and never touch admin data', () => {
  const world = pushWorld();
  devices(world, ['ok']);
  const reply = subscribe(world, { token: deviceToken(5) });
  assert.deepEqual(Object.keys(reply).sort(), ['mime', 'ok']);
  // an admin function by its public name is still an admin function
  const admin = world.post({ fn: 'apiPushState', args: [] });
  assert.equal(admin.ok, false);
  assert.equal(admin.code, 'auth');
  const send = world.post({ fn: 'apiSendPush', args: ['notif-session-1', sendKey(), {}] });
  assert.equal(send.ok, false);
  assert.equal(world.fcm.sent.length, 0);
});


/* =========================================================
   ADMIN: authorization, state, check
========================================================= */

test('the admin push functions reject non-admins', () => {
  const world = pushWorld().as(STRANGER);
  assert.throws(() => world.gs.apiPushState(), /مش مسموح/);
  assert.throws(() => world.gs.apiPushCheck(), /مش مسموح/);
  assert.throws(() => world.gs.apiSendPush('notif-session-1', sendKey(), {}), /مش مسموح/);
  assert.equal(world.fcm.sent.length, 0);
});

test('state: subscribers by platform, and only bell items live now (or later) on the real site', () => {
  const world = pushWorld();
  subscribe(world, { token: deviceToken(1), platform: 'android' });
  subscribe(world, { token: deviceToken(2), platform: 'ios' });
  const state = plain(world.as(ADMIN).gs.apiPushState());
  assert.equal(state.configured, true);
  assert.equal(state.subscribers, 2);
  assert.deepEqual(state.platforms, { android: 1, ios: 1, desktop: 0, other: 0 });
  assert.equal(state.contentError, '');
  const byId = Object.fromEntries(state.candidates.map(c => [c.id, c]));
  assert.deepEqual(Object.keys(byId).sort(), ['notif-act-1', 'notif-later', 'notif-news-aaaa1111', 'notif-out', 'notif-session-1'].sort(),
    'no expired item, none whose section is hidden (games) and none whose target is gone');
  assert.equal(byId['notif-later'].state, 'scheduled');
  assert.equal(state.candidates.at(-1).id, 'notif-later', 'live first, then scheduled');
  assert.deepEqual(byId['notif-session-1'].message, {
    id: 'notif-session-1', title: 'اجتماع الأحد الجديد 🔔', body: 'موضوع الأسبوع اتنشر.. مستنيينكم الأحد الساعة 8 ❤️', url: '/#meeting', tag: 'n-notif-session-1'
  });
  assert.equal(byId['notif-news-aaaa1111'].message.url, '/#news/news-aaaa1111');
  assert.equal(byId['notif-news-aaaa1111'].message.image, '/media/2026/img-af6b0c28.webp');
  assert.equal(byId['notif-act-1'].message.url, '/#activity/act-1');
  assert.equal(byId['notif-out'].message.url, '/#notifications', 'an outside link opens the bell, never the outside site');
  assert.ok(!JSON.stringify(state).includes('PRIVATE KEY'));
  assert.ok(!JSON.stringify(state).includes(deviceToken(1)), 'tokens never leave the server');
});

test('state: not configured, and a site that does not answer, are reported (no throw)', () => {
  const world = pushWorld({ configured: false });
  world.fcm.siteContent = null;
  const state = plain(world.as(ADMIN).gs.apiPushState());
  assert.equal(state.configured, false);
  assert.deepEqual(state.candidates, []);
  assert.match(state.contentError, /مش قادرين نقرا الموقع/);
});

test('check: a validate_only call with a signed JWT; no device is notified; a broken key says so', () => {
  const world = pushWorld();
  world.fcm.verify = assertion => {
    const [h, p, s] = assertion.split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    assert.equal(JSON.parse(Buffer.from(h, 'base64url').toString()).alg, 'RS256');
    assert.equal(claims.iss, 'push-sender@athanasios-links.iam.gserviceaccount.com');
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
    assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
    assert.equal(claims.exp - claims.iat, 3600);
    return createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'));
  };
  const result = plain(world.as(ADMIN).gs.apiPushCheck());
  assert.equal(result.ok, true, result.message);
  assert.equal(world.fcm.sent.length, 1);
  assert.equal(world.fcm.sent[0].body.validate_only, true);
  assert.match(world.fcm.sent[0].url, /\/v1\/projects\/athanasios-links\/messages:send$/);

  world.fcm.rejectAuth = true;
  const broken = plain(world.gs.apiPushCheck());
  assert.equal(broken.ok, false);
  assert.match(broken.message, /جوجل رفض مفتاح الإشعارات/);
  assert.ok(!broken.message.includes('PRIVATE'));

  world.properties.set('FCM_SERVICE_ACCOUNT', '{"project_id":"x"}');
  assert.equal(plain(world.gs.apiPushCheck()).ok, false);
});


/* =========================================================
   ADMIN: send
========================================================= */

test('send: every subscriber gets the item as a data message; dead tokens are removed; one log row', () => {
  const world = pushWorld();
  devices(world, ['ok', 'ok', 'unregistered', 'invalid', 'mismatch', 'busy-once']);
  const key = sendKey();
  const result = plain(world.as(ADMIN).gs.apiSendPush('notif-news-aaaa1111', key, {}));
  assert.equal(result.status, 'sent');
  assert.equal(result.audience, 6);
  assert.equal(result.sent, 3, 'two ok + one after a retry');
  assert.equal(result.removed, 3);
  assert.equal(result.failed, 0);
  assert.equal(result.replay, false);
  assert.equal(result.already, false);
  assert.equal(subRows(world).length, 3);
  assert.ok(!subRows(world).some(r => [deviceToken(2), deviceToken(3), deviceToken(4)].includes(r[1])));

  const delivered = world.fcm.sent.filter(s => world.fcm.devices.get(s.body.message.token) === 'ok');
  const message = delivered[0].body.message;
  assert.deepEqual(message.data, {
    id: 'notif-news-aaaa1111', title: 'خبر جديد', body: 'تفاصيل', url: '/#news/news-aaaa1111',
    tag: 'n-notif-news-aaaa1111', image: '/media/2026/img-af6b0c28.webp'
  });
  assert.equal(message.notification, undefined, 'data only: the service worker shows it');
  assert.equal(message.webpush.headers.Urgency, 'high');
  assert.equal(message.webpush.headers.TTL, String(4 * 86400), 'capped at four days');
  assert.ok(Object.values(message.data).every(v => typeof v === 'string'));

  const log = logRows(world);
  assert.equal(log.length, 1);
  assert.equal(log[0][0], key);
  assert.equal(log[0][2], 'sent');
  assert.equal(log[0][3], ADMIN);
  assert.equal(log[0][7], 3);
  assert.ok(!JSON.stringify(world.spreadsheet.getSheets().map(s => s.data)).includes('PRIVATE KEY'), 'the key is never written to the Sheet');
});

test('send: edits change only the push (title, body, no image); the bell item is untouched', () => {
  const world = pushWorld();
  devices(world, ['ok']);
  world.as(ADMIN).gs.apiSendPush('notif-news-aaaa1111', sendKey(), { title: '  عنوان   تاني  ', body: '', image: false });
  const data = world.fcm.sent.at(-1).body.message.data;
  assert.equal(data.title, 'عنوان تاني');
  assert.equal(data.body, '');
  assert.equal(data.image, undefined);
  const long = world.gs.pushMessage_({ id: 'x', title: 'ع'.repeat(90), message: 'م'.repeat(300), target: null, image: null }, {});
  assert.equal(long.title.length, 60);
  assert.equal(long.body.length, 200);
});

test('send: TTL follows the item (until it expires), at least an hour', () => {
  const world = pushWorld();
  assert.equal(world.gs.pushTtl_({ expireAt: '2026-10-11T12:30' }, '2026-10-11T10:00'), 9000);
  assert.equal(world.gs.pushTtl_({ expireAt: '2026-10-11T10:10' }, '2026-10-11T10:00'), 3600);
  assert.equal(world.gs.pushTtl_({ expireAt: '' }, '2026-10-11T10:00'), 4 * 86400);
});

test('idempotency: the same sendKey replays its result; the same item is never sent twice', () => {
  const world = pushWorld();
  devices(world, ['ok', 'ok']);
  const gs = world.as(ADMIN).gs;
  const key = sendKey();
  gs.apiSendPush('notif-session-1', key, {});
  const sent = world.fcm.sent.length;
  const replay = plain(gs.apiSendPush('notif-session-1', key, {}));
  assert.equal(replay.replay, true);
  assert.equal(replay.sent, 2);
  world.advance(5 * 60000);
  const again = plain(gs.apiSendPush('notif-session-1', sendKey(), {}));
  assert.equal(again.already, true);
  assert.equal(world.fcm.sent.length, sent, 'nothing sent the second or third time');
  assert.equal(logRows(world).length, 1);
  const state = plain(gs.apiPushState());
  assert.equal(state.candidates.find(c => c.id === 'notif-session-1').last.status, 'sent');
});

test('a send that is still running blocks a second one; an interrupted one (10 min) may be retried', () => {
  const world = pushWorld();
  devices(world, ['ok']);
  const log = world.as(ADMIN).gs.pushSheet_('PushLog', world.gs.PUSH_LOG_COLUMNS);
  log.appendRow(['s-crashed-1', 'notif-session-1', 'sending', ADMIN, Date.now() - 2 * 60000, '', 1, 0, 0, 0, 'x', '', '/#meeting', '']);
  world.advance(61000);
  assert.throws(() => world.gs.apiSendPush('notif-session-1', sendKey(), {}), /بيتبعت دلوقتي/);
  world.advance(10 * 60000);
  assert.equal(plain(world.gs.apiPushState()).log[0].status, 'interrupted');
  assert.equal(plain(world.gs.apiSendPush('notif-session-1', sendKey(), {})).status, 'sent');
});

test('limits: 60 s between sends, and 10 a (Cairo) day', () => {
  const world = pushWorld();
  devices(world, ['ok']);
  const gs = world.as(ADMIN).gs;
  gs.apiSendPush('notif-session-1', sendKey(), {});
  assert.throws(() => gs.apiSendPush('notif-news-aaaa1111', sendKey(), {}), /استنى دقيقة/);
  world.advance(61000);
  assert.equal(plain(gs.apiSendPush('notif-news-aaaa1111', sendKey(), {})).status, 'sent');
  // fill the day
  const log = gs.pushSheet_('PushLog', gs.PUSH_LOG_COLUMNS);
  for (let i = 0; i < 8; i++) log.appendRow([`s-fill-${i}`, `notif-x${i}`, 'sent', ADMIN, Date.now() - 1000 * (i + 1), '', 1, 1, 0, 0, 'x', '', '/', '']);
  world.advance(61000);
  assert.throws(() => gs.apiSendPush('notif-act-1', sendKey(), {}), /10 إشعارات في اليوم/);
});

test('never a draft, a future, an expired or a hidden item; nothing sent without subscribers', () => {
  const world = pushWorld();
  const gs = world.as(ADMIN).gs;
  assert.throws(() => gs.apiSendPush('notif-session-1', sendKey(), {}), /مفيش مشتركين/);
  devices(world, ['ok']);
  assert.throws(() => gs.apiSendPush('notif-draft-only', sendKey(), {}), /مش على الموقع/);
  assert.throws(() => gs.apiSendPush('notif-later', sendKey(), {}), /لسه معاده مجاش/);
  assert.throws(() => gs.apiSendPush('notif-old', sendKey(), {}), /مش ظاهر على الموقع/);
  assert.throws(() => gs.apiSendPush('notif-game-1-soon', sendKey(), {}), /مش ظاهر على الموقع/);
  assert.throws(() => gs.apiSendPush('notif-gone', sendKey(), {}), /مش ظاهر على الموقع/);
  assert.throws(() => gs.apiSendPush('../x', sendKey(), {}), /مش مفهوم/);
  assert.throws(() => gs.apiSendPush('notif-session-1', 'short', {}), /مش مفهوم/);
  assert.equal(world.fcm.sent.length, 0);
  assert.equal(logRows(world).length, 0, 'refusals leave no log row');
});

test('not configured: a clear error, nothing sent', () => {
  const world = pushWorld({ configured: false });
  devices(world, ['ok']);
  assert.throws(() => world.as(ADMIN).gs.apiSendPush('notif-session-1', sendKey(), {}), /مش متظبطة/);
  assert.equal(world.fcm.sent.length, 0);
});

test('FCM refuses the credentials: the send fails cleanly, no device is punished, the log says failed', () => {
  const world = pushWorld();
  devices(world, ['ok', 'ok']);
  world.fcm.revoked = true;   // every send answers 401
  assert.throws(() => world.as(ADMIN).gs.apiSendPush('notif-session-1', sendKey(), {}), /ما اتبعتش/);
  assert.equal(subRows(world).length, 2);
  assert.ok(subRows(world).every(r => Number(r[5]) === 0));
  assert.equal(logRows(world)[0][2], 'failed');
  // a failed send can be tried again once it works
  world.fcm.revoked = false;
  world.advance(61000);
  assert.equal(plain(world.gs.apiSendPush('notif-session-1', sendKey(), {})).status, 'sent');
});

test('cleanup: a device that keeps failing is dropped after 5 sends; one not seen for 270 days too', () => {
  const world = pushWorld();
  devices(world, ['ok', 'busy']);
  const gs = world.as(ADMIN).gs;
  const ids = ['notif-session-1', 'notif-news-aaaa1111', 'notif-act-1', 'notif-out'];
  for (let i = 0; i < 4; i++) {
    gs.apiSendPush(ids[i], sendKey(), {});
    world.advance(61000);
  }
  assert.equal(subRows(world).length, 2);
  assert.equal(Number(subRows(world).find(r => r[1] === deviceToken(1))[5]), 4);
  // a fifth failure (fresh content with one more item)
  world.fcm.siteContent = JSON.stringify(liveContent({ notifications: [...liveContent().notifications, { id: 'notif-five', type: 'general', title: 'خمسة', message: '', target: null, image: null, publishAt: wall(-1), expireAt: '' }] }));
  const fifth = plain(gs.apiSendPush('notif-five', sendKey(), {}));
  assert.equal(fifth.failed, 1);
  assert.equal(fifth.removed, 1);
  assert.deepEqual(subRows(world).map(r => r[1]), [deviceToken(0)]);

  // stale: last seen 271 days ago
  subsSheet(world).data[1][4] = Date.now() - 271 * 86400000;
  world.fcm.devices.set(deviceToken(0), 'busy');
  world.fcm.siteContent = JSON.stringify(liveContent({ notifications: [{ id: 'notif-six', type: 'general', title: 'ستة', message: '', target: null, image: null, publishAt: wall(-1), expireAt: '' }] }));
  world.advance(61000);
  const sixth = plain(gs.apiSendPush('notif-six', sendKey(), {}));
  assert.equal(sixth.removed, 1);
  assert.equal(subRows(world).length, 0);
});

test('the error classifier: only the token\'s own errors delete it', () => {
  const world = pushWorld();
  const response = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
  const fcm = (code, errorCode, message) => response(code, { error: { code, message, details: [{ errorCode }] } });
  const c = r => world.gs.pushClassify_(r);
  assert.equal(c(response(200, {})), 'ok');
  assert.equal(c(fcm(404, 'UNREGISTERED', 'x')), 'dead');
  assert.equal(c(fcm(403, 'SENDER_ID_MISMATCH', 'x')), 'dead');
  assert.equal(c(fcm(400, 'INVALID_ARGUMENT', 'The registration token is not a valid FCM registration token')), 'dead');
  assert.equal(c(fcm(400, 'INVALID_ARGUMENT', "Invalid value at 'message.data[0].value'")), 'retry', 'a bad message must not wipe the list');
  assert.equal(c(fcm(401, '', 'x')), 'auth');
  assert.equal(c(fcm(403, 'THIRD_PARTY_AUTH_ERROR', 'x')), 'auth');
  assert.equal(c(fcm(429, 'QUOTA_EXCEEDED', 'x')), 'retry');
  assert.equal(c(fcm(503, 'UNAVAILABLE', 'x')), 'retry');
  assert.equal(c(response(500, 'not json')), 'retry');
});

test('publishing does not involve push at all', () => {
  const world = pushWorld();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('FCM_SERVICE_ACCOUNT', 'broken {');
  const gs = world.as(ADMIN).gs;
  const review = plain(gs.apiReview());
  const result = plain(gs.apiPublish(review.revision));
  assert.ok(result.commit, 'published even with a broken push setup');
  assert.equal(world.fcm.sent.length, 0);
  assert.equal(world.fcm.tokenRequests, 0);
});
