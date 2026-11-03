// Phase 6 Step 4c (docs/PHASE6-PLAN.md, COMPETITIONS §18.5): the automatic pushes, «إشعارات الموبايل» on the Worker,
// a booker's reminder and the account link. Real SQLite, a fake FCM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { sha256 } from '../src/lib/hash.js';
import { pushHash } from '../src/push/devices.js';
import { forgetAccessToken, OAUTH_URL } from '../src/push/fcm.js';
import { runPart, bookerPush } from '../src/push/send.js';
import { wallMs, when, wanted, syncSchedule, scheduleTick, bellItems, OVERDUE_MS } from '../src/push/schedule.js';
import { itemState, itemUrl } from '../src/push/screen.js';

const P = 'p@example.com';
const tok = n => ('tok_ok_' + n + '_').padEnd(150, 'x');

const pem = async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  return '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----\n';
};
const ACCOUNT = JSON.stringify({ project_id: 'athanasios-test', client_email: 'push-sender@athanasios-test.iam.gserviceaccount.com', private_key: await pem() });
const fcm = () => {
  const sends = [];
  const f = async (url, init) => {
    if (url === OAUTH_URL) return Response.json({ access_token: 'at', expires_in: 3600 });
    sends.push(JSON.parse(init.body).message);
    return Response.json({ name: 'x' });
  };
  return { f, sends };
};
const KEYS = { PW_PEPPER: 'pepper-test', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp-test', ACCOUNT_PAD_MS: '0' };

async function world({ sender = true, key = true } = {}) {
  forgetAccessToken();
  const g = await fakeGoogle();
  const h = harness({ env: { ADMIN_EMAILS: '', ...KEYS, ...(key ? { FCM_SERVICE_ACCOUNT: ACCOUNT } : {}) } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'مينا', 'primary', 1, 0)`).run();
  const set = (k, v) => h.db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v).run();
  if (sender) await set('PUSH_SENDER', 'worker');
  const admin = async (method, path, body) => h.call('/v1/admin/' + path, { method, body, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: P, sub: 's-p' })) }, fetch: g.fetch });
  const device = async (token, extra = {}) => {
    const id = await pushHash(token);
    await h.db.prepare("INSERT INTO push_devices (id, token, audience, account_id, topics, created_ms, last_ms) VALUES (?, ?, 'public', ?, ?, 1, 1)")
      .bind(id, token, extra.account || null, JSON.stringify(extra.topics || ['announcements', 'events', 'competitions', 'reminders'])).run();
    return id;
  };
  const schedule = () => h.db.prepare('SELECT * FROM push_schedule ORDER BY send_wall').all().then(r => r.results);
  const drain = async f => { for (let list = h.sent.splice(0); list.length; list = h.sent.splice(0)) for (const j of list) if (j.type === 'push.fanout') await runPart(h.env, j.payload, f); };
  return { h, set, admin, device, schedule, drain };
}

const future = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

test('Cairo wall time: to ms across the year, and the Egyptian words', () => {
  assert.equal(wallMs('2026-11-20T19:00'), Date.UTC(2026, 10, 20, 17, 0), 'winter: UTC+2');
  assert.equal(wallMs('2026-07-01T12:00'), Date.UTC(2026, 6, 1, 9, 0), 'summer: UTC+3');
  assert.equal(when('2026-11-19T19:00'), 'الخميس 19 نوفمبر الساعة 7 بالليل');
  assert.equal(when('2026-11-20T09:30'), 'الجمعة 20 نوفمبر الساعة 9:30 الصبح');
});

test('the store: notify choices beside the dates; the schedule follows each save', async () => {
  const w = await world();
  const opens = future(10) + 'T19:00';
  const closes = future(20) + 'T10:00';
  const r = await w.admin('POST', 'store/schedule', { mode: 'auto', opensAt: opens, closesAt: closes, notify: { open1d: true, openAt: true, close1h: true, bogus: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.notify, { open1d: true, open1h: false, openAt: true, close24h: false, close1h: true });
  let rows = await w.schedule();
  assert.deepEqual(rows.map(x => x.kind), ['shop-open-1d', 'shop-open', 'shop-close-1h']);
  assert.ok(rows.every(x => x.status === 'pending' && x.send_ms === wallMs(x.send_wall)));
  assert.match(rows[0].body, /بيفتح/);
  assert.equal(rows[0].notif_id, 'notif-shop-open-1d-' + (future(9) + 'T19:00').replace(/\D/g, ''));

  // a new opening time: the old moments go, new ones come; the close stays the same entry
  await w.admin('POST', 'store/schedule', { mode: 'auto', opensAt: future(11) + 'T19:00', closesAt: closes, notify: { open1d: true, openAt: true, close1h: true } });
  rows = await w.schedule();
  assert.equal(rows.filter(x => x.status === 'pending').length, 3);
  assert.equal(rows.filter(x => x.status === 'cancelled').length, 2);
  // by hand: no moments at all
  await w.admin('POST', 'store/schedule', { mode: 'open', opensAt: '', closesAt: '' });
  assert.equal((await w.schedule()).filter(x => x.status === 'pending').length, 0);
});

test('seasons: the end reminder, its bounds, a new name updates its words, closing the season cancels it', async () => {
  const w = await world();
  const season = (await w.h.db.prepare("SELECT id FROM seasons WHERE status = 'active'").first()).id;
  const bad = await w.admin('POST', 'points/seasons', { id: season, name: 'موسم الخريف', endAt: future(30) + 'T23:59', notifyDays: 40 });
  assert.equal(bad.status, 400);
  const ok = await w.admin('POST', 'points/seasons', { id: season, name: 'موسم الخريف', endAt: future(30) + 'T23:59', notifyDays: 3 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.seasons.find(s => s.id === season).notifyDays, 3);
  let rows = await w.schedule();
  assert.deepEqual(rows.map(r => [r.kind, r.ref_id, r.send_wall]), [['season-end', season, future(27) + 'T23:59']]);
  assert.match(rows[0].title, /موسم الخريف بيخلص بعد 3 أيام/);
  await w.admin('POST', 'points/seasons', { id: season, name: 'موسم الشتا', endAt: future(30) + 'T23:59', notifyDays: 3 });
  assert.match((await w.schedule())[0].title, /موسم الشتا/, 'the same moment, new words');
  const pre = await w.admin('GET', 'points/seasons/' + season + '/preview');
  const closed = await w.admin('POST', 'points/seasons/' + season + '/close', { key: pre.body.key, next: { name: 'الموسم الجاي' } });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  rows = await w.schedule();
  assert.deepEqual(rows.map(r => r.status), ['cancelled']);
});

test('the minute: due moments go once, through the visitors\' send; overdue is skipped and the admins hear; off = nothing', async () => {
  const off = await world({ sender: false });
  assert.equal(await scheduleTick(off.h.env), null);

  const w = await world();
  await w.device(tok(1));
  await w.h.db.prepare("UPDATE settings SET value = ? WHERE key = 'SHOP_MODE'").bind('auto').run();
  await w.admin('POST', 'store/schedule', { mode: 'auto', opensAt: future(5) + 'T19:00', closesAt: future(9) + 'T10:00', notify: { open1d: true, close1h: true } });
  const [open1d, close1h] = await w.schedule();
  const at = open1d.send_ms + 1000;
  const { f, sends } = fcm();
  const r = await scheduleTick(w.h.env, at, f);
  assert.deepEqual(r, { sent: 1, skipped: 0, failed: 0, waiting: 0 });
  await w.drain(f);
  assert.equal(sends.length, 1);
  assert.deepEqual([sends[0].data.url, sends[0].data.group, sends[0].data.id], ['/points/', 'points', open1d.notif_id]);
  assert.equal(await scheduleTick(w.h.env, at + 1000, f), null, 'once');

  // overdue by more than 6 h: skipped, with an activity row for the admins
  const late = close1h.send_ms + OVERDUE_MS + 1000;
  assert.equal((await scheduleTick(w.h.env, late, f)).skipped, 1);
  const row = (await w.schedule()).find(x => x.id === close1h.id);
  assert.deepEqual([row.status, row.result], ['skipped', 'فات ميعاده']);
  assert.ok(await w.h.db.prepare("SELECT 1 FROM activity WHERE action = 'push' AND entity_id = ?").bind(close1h.notif_id).first());
});

test('the minute: a send a moment ago makes it wait; no subscribers = skipped', async () => {
  const w = await world();
  await w.admin('POST', 'store/schedule', { mode: 'auto', opensAt: future(5) + 'T19:00', closesAt: '', notify: { open1d: true, openAt: true } });
  const [first] = await w.schedule();
  assert.equal((await scheduleTick(w.h.env, first.send_ms + 1000)).skipped, 1, 'nobody subscribed');
  await w.device(tok(1));
  const [, second] = await w.schedule();
  await w.h.db.prepare("INSERT INTO push_sends (id, audience, ref, status, started_ms, message, ttl) VALUES ('ps-000001', 'public', 'x', 'sent', ?, '{}', 1)").bind(second.send_ms).run();
  assert.equal((await scheduleTick(w.h.env, second.send_ms + 1000, fcm().f)).waiting, 1);
  assert.equal((await w.schedule())[1].status, 'pending', 'still waiting for the next minute');
  assert.equal((await scheduleTick(w.h.env, second.send_ms + 61000, fcm().f)).sent, 1);
});

test('the bell: the pending and sent moments, shaped like the hub\'s notifications (the publish: content-publish.test)', async () => {
  const w = await world();
  await w.admin('POST', 'store/schedule', { mode: 'auto', opensAt: future(5) + 'T19:00', closesAt: '', notify: { openAt: true } });
  const bells = await bellItems(w.h.db);
  assert.equal(bells.length, 1);
  assert.deepEqual(Object.keys(bells[0]), ['id', 'type', 'title', 'message', 'target', 'image', 'publishAt', 'expireAt']);
  assert.deepEqual(bells[0].target, { kind: 'points' });
  await w.h.db.prepare("UPDATE push_schedule SET status = 'cancelled'").run();
  assert.deepEqual(await bellItems(w.h.db), [], 'a cancelled moment leaves the bell');
});

test('the admin\'s schedule list, the auto state, and cancelling one', async () => {
  const w = await world();
  await w.admin('POST', 'store/schedule', { mode: 'auto', opensAt: future(5) + 'T19:00', closesAt: '', notify: { open1d: true, openAt: true } });
  const list = await w.admin('POST', 'push/schedule', {});
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.entries.length, 2);
  assert.deepEqual([list.body.auto.authorized, list.body.auto.pending], [true, 2]);
  const id = list.body.entries[0].id;
  const after = await w.admin('POST', 'push/schedule/cancel', { id });
  assert.equal(after.body.entries.find(e => e.id === id).status, 'cancelled');
  assert.equal(after.body.auto.pending, 1);
  assert.equal((await w.admin('POST', 'push/schedule/cancel', { id: 'psh-0000000000' })).status, 404);
  const nokey = await world({ key: false });
  assert.equal((await nokey.admin('POST', 'push/auto', {})).body.authorized, false);
});

const LIVE = {
  layout: [{ key: 'news' }, { key: 'meeting', visibleUntil: '2000-01-01T00:00' }],
  news: [{ id: 'n1' }],
  notifications: [
    { id: 'a', type: 'news', title: 'خبر جديد', message: 'اقرا', target: { kind: 'news', id: 'n1' }, image: { src: 'media/2026/x.webp' }, publishAt: '2026-01-01T00:00', expireAt: '' },
    { id: 'b', type: 'general', title: 'بعدين', message: '', target: null, publishAt: '2099-01-01T00:00' },
    { id: 'c', type: 'meeting', title: 'اجتماع', target: { kind: 'meeting' } },
    { id: 'd', type: 'general', title: 'خلص', expireAt: '2000-01-01T00:00' }
  ]
};

test('«إشعارات الموبايل»: the bell items live on the Worker\'s own content; a send; its key and its item once', async () => {
  assert.equal(itemUrl({ kind: 'event', slug: 'trip-2026' }), '/events/trip-2026/');
  assert.equal(itemUrl({ kind: 'link', url: 'https://x' }), '/#notifications');
  const now = '2026-11-03T12:00';
  assert.deepEqual(LIVE.notifications.map(n => itemState(LIVE, n, now)), ['live', 'scheduled', 'hidden', 'ended']);

  const w = await world();
  await w.device(tok(1));
  await w.device(tok(2));
  await w.h.db.prepare("INSERT INTO published_revisions (id, kind, key, rev, hash, body, live, publish_id, published_at) VALUES ('rev-1', 'content', 'site', 1, 'h', ?, 1, 'pub-1', 0)").bind(JSON.stringify(LIVE)).run();
  const state = await w.admin('POST', 'push/state', {});
  assert.equal(state.status, 200, JSON.stringify(state.body));
  assert.deepEqual([state.body.configured, state.body.subscribers, state.body.platforms.other], [true, 2, 2]);
  assert.deepEqual(state.body.candidates.map(c => [c.id, c.state]), [['a', 'live'], ['b', 'scheduled']]);
  assert.deepEqual([state.body.candidates[0].message.url, state.body.candidates[0].message.image], ['/#news/n1', '/media/2026/x.webp']);

  assert.equal((await w.admin('POST', 'push/send', { id: 'b', sendKey: 'key-00000001' })).status, 400, 'not live yet');
  const sent = await w.admin('POST', 'push/send', { id: 'a', sendKey: 'key-00000001', edits: { title: 'خبر مهم', image: false } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual([sent.body.status, sent.body.audience, sent.body.title, sent.body.by], ['sending', 2, 'خبر مهم', P]);
  const { f, sends } = fcm();
  await w.drain(f);
  assert.equal(sends.length, 2);
  assert.equal(sends[0].data.image, undefined, 'the picture turned off for this push');
  assert.equal((await w.admin('POST', 'push/send', { id: 'a', sendKey: 'key-00000001' })).body.replay, true);
  const again = await w.admin('POST', 'push/send', { id: 'a', sendKey: 'key-00000002' });
  assert.deepEqual([again.body.already, again.body.status, again.body.sent], [true, 'sent', 2]);
  const after = await w.admin('POST', 'push/state', {});
  assert.equal(after.body.candidates[0].last.status, 'sent');
  assert.equal(after.body.limits.sentToday, 1);
});

test('a booker\'s reminder: only the devices linked to the account that kept reminders, no amounts, once', async () => {
  const w = await world();
  await w.device(tok(1), { account: 'acc-1' });
  await w.device(tok(2), { account: 'acc-1', topics: ['events'] });
  await w.device(tok(3), { account: 'acc-2' });
  await w.device(tok(4));
  const list = [{ bookingId: 'bk-1', participantId: 'acc-1' }, { bookingId: 'bk-9', participantId: 'acc-9' }];
  assert.equal(await bookerPush(w.h.env, list, { stage: 'd3', event: 'رحلة الغردقة', day: '2026-11-03' }), 1);
  const jobs = w.h.sent.filter(j => j.type === 'push.fanout');
  assert.deepEqual(jobs.map(j => j.payload.ids), [[await pushHash(tok(1))]]);
  const { f, sends } = fcm();
  await w.drain(f);
  assert.equal(sends[0].data.url, '/account/#me/bookings');
  assert.match(sends[0].data.title, /رحلة الغردقة/);
  assert.doesNotMatch(JSON.stringify(sends[0]), /\d+ ?ج/, 'no amounts');
  assert.equal(await bookerPush(w.h.env, list, { stage: 'd3', event: 'رحلة الغردقة', day: '2026-11-03' }), 0, 'the same day and stage: once');
});

test('the account link: a visitor\'s device with the account\'s own token becomes that account\'s; a bad token changes nothing', async () => {
  const w = await world();
  await w.set('accounts_mode', 'on');
  const now = Date.now();
  await w.h.db.prepare(`INSERT INTO participants (id, name, name_norm, email, email_canon, email_source, phone, phone_norm, birth_date, pw_hash, pw_enc, pw_issued_at, pw_issued_by, created_via, created_at, updated_at)
    VALUES ('acc-1', 'م', 'م', 'a@x.invalid', 'a@x.invalid', 'self', '01000000001', '1000000001', '2000-01-01', 'h', 'e', 0, 'self', 'self', 0, 0)`).run();
  const token = 'as1.' + 'k'.repeat(40);
  await w.h.db.prepare("INSERT INTO account_sessions (id, participant_id, token_hash, pw_version, kind, created_at, last_seen, expires_at) VALUES ('ses-1', 'acc-1', ?, 1, 'device', ?, ?, ?)")
    .bind(await sha256(token), now, now, now + 86400000).run();
  const sub = (t, auth) => w.h.call('/v1/push/subscribe', { method: 'POST', body: { token: t }, headers: auth ? { authorization: 'Bearer ' + auth } : {} });
  assert.equal((await sub(tok(1), token)).body.ok, true);
  assert.equal((await w.h.db.prepare('SELECT account_id FROM push_devices WHERE id = ?').bind(await pushHash(tok(1))).first()).account_id, 'acc-1');
  assert.equal((await sub(tok(2), 'as1.' + 'z'.repeat(40))).body.ok, true, 'a bad token never stops the subscribe');
  assert.equal((await w.h.db.prepare('SELECT account_id FROM push_devices WHERE id = ?').bind(await pushHash(tok(2))).first()).account_id, null);
  const expires = (await w.h.db.prepare("SELECT expires_at FROM account_sessions WHERE id = 'ses-1'").first()).expires_at;
  assert.equal(expires, now + 86400000, 'the session is not stretched');
});

test('wanted: nothing in the past, nothing for a closed season', async () => {
  const w = await world();
  await w.h.db.prepare("INSERT INTO seasons (id, name, end_at, notify_days, status, created_ms, updated_ms) VALUES ('sea-old', 'قديم', '2000-01-01T00:00', 3, 'planned', 0, 0), ('sea-done', 'خلص', ?, 3, 'closed', 0, 0)").bind(future(30) + 'T00:00').run();
  assert.deepEqual(await wanted(w.h.db), []);
  assert.deepEqual(await syncSchedule(w.h.db, 'season-'), { wanted: 0, changed: 0 });
});

test('a bell item goes as a push by itself once it is live: once, after the switch only, one a minute, a scheduled one at its time', async () => {
  const { autoBellTick } = await import('../src/push/autobell.js');
  const w = await world();
  await w.device(tok(1));
  const site = notifications => JSON.stringify({ layout: [{ key: 'news' }], news: [{ id: 'n1' }], notifications });
  const live = async notifications => {
    await w.h.db.prepare("UPDATE published_revisions SET live = 0 WHERE kind = 'content'").run();
    await w.h.db.prepare("INSERT INTO published_revisions (id, kind, key, rev, hash, body, live, publish_id, published_at) VALUES (?, 'content', 'site', ?, 'h', ?, 1, 'p', 0)")
      .bind('rev-' + Math.random().toString(16).slice(2, 8), Math.floor(Math.random() * 1e9), site(notifications)).run();
  };
  const at = (min) => new Date(Date.now() + 2 * 3600000 + min * 60000).toISOString().slice(0, 16);   // Cairo is UTC+2 in November
  const { f, sends } = fcm();

  assert.equal(await autoBellTick(w.h.env, Date.now(), f), null, 'switch off');
  await w.set('PUSH_AUTO_BELL', '1');
  await live([{ id: 'notif-old', type: 'general', title: 'قديم', publishAt: at(-60) }]);
  assert.ok((await autoBellTick(w.h.env, Date.now(), f)).since, 'the first run only stamps when it started');
  assert.equal(await autoBellTick(w.h.env, Date.now(), f), null, 'an item from before is never sent this way');

  await live([
    { id: 'notif-old', type: 'general', title: 'قديم', publishAt: at(-60) },
    { id: 'notif-n1', type: 'news', title: 'خبر جديد', message: 'اقرا', target: { kind: 'news', id: 'n1' }, publishAt: at(1) },
    { id: 'notif-n2', type: 'general', title: 'كمان واحد', publishAt: at(1) },
    { id: 'notif-later', type: 'general', title: 'بعدين', publishAt: at(120) }
  ]);
  const now = Date.now() + 2 * 60000;
  assert.deepEqual(await autoBellTick(w.h.env, now, f), { sent: 'notif-n1' });
  await w.drain(f);
  assert.equal(sends[0].data.url, '/#news/n1', 'linked to its content');
  assert.deepEqual(await autoBellTick(w.h.env, now + 1000, f), { waiting: 'notif-n2' }, 'a minute between sends');
  assert.deepEqual(await autoBellTick(w.h.env, now + 61000, f), { sent: 'notif-n2' });
  assert.equal(await autoBellTick(w.h.env, now + 122000, f), null, 'each once; the later one not yet');
  assert.deepEqual(await autoBellTick(w.h.env, Date.now() + 121 * 60000, f), { sent: 'notif-later' }, 'a scheduled one at its time');
  const rows = (await w.h.db.prepare("SELECT ref, COUNT(*) AS n FROM push_sends GROUP BY ref").all()).results;
  assert.deepEqual(rows.map(r => [r.ref, r.n]).sort(), [['notif-later', 1], ['notif-n1', 1], ['notif-n2', 1]]);
});

test('a bell item already sent from the push screen is not sent again; no subscribers is logged once and handled', async () => {
  const { autoBellTick } = await import('../src/push/autobell.js');
  const w = await world();
  await w.set('PUSH_AUTO_BELL', '1');
  await w.set('PUSH_AUTO_BELL_SINCE', '2026-01-01T00:00');
  const at = new Date(Date.now() + 2 * 3600000 - 60000).toISOString().slice(0, 16);
  await w.h.db.prepare("INSERT INTO published_revisions (id, kind, key, rev, hash, body, live, publish_id, published_at) VALUES ('rev-1', 'content', 'site', 1, 'h', ?, 1, 'p', 0)")
    .bind(JSON.stringify({ notifications: [{ id: 'notif-a', type: 'general', title: 'أ', publishAt: at }] })).run();
  const first = await autoBellTick(w.h.env, Date.now(), fcm().f);
  assert.deepEqual([first.capped, first.reason], ['notif-a', 'invalid'], 'nobody subscribed yet');
  assert.ok(await w.h.db.prepare("SELECT 1 FROM activity WHERE action = 'push' AND entity_id = 'notif-a'").first());
  assert.equal(await autoBellTick(w.h.env, Date.now(), fcm().f), null, 'handled: not every minute');
});
