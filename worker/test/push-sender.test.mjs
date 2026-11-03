// Phase 6 Step 4b (docs/PHASE6-PLAN.md): the Worker's push sender, against a fake FCM, on real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { activityStmt } from '../src/lib/activity.js';
import { route } from '../src/notify/router.js';
import { pushHash } from '../src/push/devices.js';
import { model, fcmMessage, classify, accessToken, forgetAccessToken, serviceAccount, OAUTH_URL } from '../src/push/fcm.js';
import { startSend, runPart, adminPushTick, publicSend, presentDevice, spared, PART_SIZE, MAX_FAILS, RETRY_DELAY_S, SENDS_PER_DAY } from '../src/push/send.js';
import { consume } from '../src/jobs.js';

const P = 'p@example.com';
const M = 'm@example.com';
const B = 'b@example.com';
const tok = (n, kind = 'ok') => ('tok_' + kind + '_' + n + '_').padEnd(150, 'x');

async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  return { pair, pem: '-----BEGIN PRIVATE KEY-----\n' + der.match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n' };
}
const KEY = await keyPair();
const ACCOUNT = JSON.stringify({ project_id: 'athanasios-test', client_email: 'push-sender@athanasios-test.iam.gserviceaccount.com', private_key: KEY.pem });

/* Google's token endpoint and FCM: a token's name says how it answers */
function fakeFcm({ oauth = 200, fcmStatus = null } = {}) {
  const log = { oauth: 0, sends: [], flaky: new Map() };
  const f = async (url, init) => {
    if (url === OAUTH_URL) {
      log.oauth++;
      log.assertion = new URLSearchParams(init.body).get('assertion');
      return Response.json(oauth === 200 ? { access_token: 'at-' + log.oauth, expires_in: 3600 } : { error: 'invalid_grant' }, { status: oauth });
    }
    const body = JSON.parse(init.body);
    log.sends.push({ url, auth: init.headers.authorization, message: body.message });
    const t = body.message.token || body.message.fid;
    if (fcmStatus) return Response.json({ error: { message: 'x' } }, { status: fcmStatus });
    if (t.startsWith('tok_dead')) return Response.json({ error: { message: 'gone', details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 });
    if (t.startsWith('tok_bad')) return Response.json({ error: { message: 'busy' } }, { status: 503 });
    if (t.startsWith('tok_flaky')) {
      const seen = log.flaky.get(t) || 0;
      log.flaky.set(t, seen + 1);
      if (!seen) return Response.json({ error: { message: 'busy' } }, { status: 503 });
    }
    return Response.json({ name: 'projects/x/messages/1' });
  };
  return { f, log };
}

async function world({ key = true } = {}) {
  forgetAccessToken();
  const h = harness({ env: { ADMIN_EMAILS: '', ...(key ? { FCM_SERVICE_ACCOUNT: ACCOUNT } : {}) } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'مينا', 'primary', 1, 0), ('${M}', 'مرقس', 'admin', 1, 0), ('${B}', 'بيشوي', 'admin', 1, 0)`).run();
  const set = (k, v) => h.db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v).run();
  const device = async (token, { audience = 'public', email = null, label = null, platform = 'web', fails = 0, topics = null } = {}) => {
    const id = await pushHash(token);
    await h.db.prepare(`INSERT INTO push_devices (id, token, audience, email, platform, device, created_ms, last_ms, fails${topics ? ', topics' : ''}) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?${topics ? ', ?' : ''})`)
      .bind(id, token, audience, email, platform, label, fails, ...(topics ? [JSON.stringify(topics)] : [])).run();
    return id;
  };
  const jobs = () => h.sent.splice(0).filter(j => j.type === 'push.fanout');
  const drain = async f => { let n = 0; for (let list = jobs(); list.length; list = jobs()) for (const j of list) { await runPart(h.env, j.payload, f); n++; } return n; };
  const sendRow = id => h.db.prepare('SELECT * FROM push_sends WHERE id = ?').bind(id).first();
  return { h, set, device, jobs, drain, sendRow };
}

test('the message model: one shape, the web gets data only, a native app its own block; links are paths', () => {
  const m = model({ kind: 'public', id: 'n1', title: '  اجتماع   الجمعة ', body: 'تعالوا', url: '/events/trip/', tag: 'n-n1', image: '/media/a.webp', badge: 2, group: 'events' });
  assert.deepEqual(m, { kind: 'public', id: 'n1', title: 'اجتماع الجمعة', body: 'تعالوا', url: '/events/trip/', tag: 'n-n1', image: '/media/a.webp', badge: 2, group: 'events' });
  assert.equal(model({ title: '' }), null);
  const odd = model({ title: 'x', url: 'https://evil.example/', image: 'https://evil.example/a.png', tag: 'bad tag!' });
  assert.deepEqual([odd.url, odd.image, odd.tag], ['/#notifications', undefined, 'athanasios'], 'never an outside link or picture');
  assert.equal(model({ kind: 'admin', title: 'x', url: '//evil.example' }).url, '/admin/');

  const web = fcmMessage({ token: 't', platform: 'web' }, m, 3600);
  assert.deepEqual(Object.keys(web).sort(), ['data', 'token', 'webpush']);
  assert.equal(web.data.badge, '2', 'data values are strings');
  assert.equal(web.webpush.headers.TTL, '3600');
  const android = fcmMessage({ token: 't', platform: 'android' }, m, 3600);
  assert.deepEqual([android.android.ttl, android.android.notification.channel_id, android.android.notification.notification_count, android.data.url], ['3600s', 'events', 2, '/events/trip/']);
  const ios = fcmMessage({ token: 't', platform: 'ios' }, m, 60, 1000000);
  assert.deepEqual([ios.apns.payload.aps.badge, ios.apns.payload.aps['thread-id'], ios.apns.headers['apns-expiration']], [2, 'events', String(1000 + 60)]);
});

test('classify: as Push.gs, a token\'s own fault only is dead', () => {
  assert.equal(classify(200), 'ok');
  assert.equal(classify(401), 'auth');
  assert.equal(classify(404, {}), 'dead');
  assert.equal(classify(400, { error: { details: [{ errorCode: 'UNREGISTERED' }] } }), 'dead');
  assert.equal(classify(403, { error: { details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } }), 'dead');
  assert.equal(classify(400, { error: { message: 'The registration token is not a valid FCM registration token' } }), 'dead');
  assert.equal(classify(400, { error: { message: 'Invalid JSON payload' } }), 'retry', 'a bad message is not the device\'s fault');
  assert.equal(classify(403, {}), 'auth');
  assert.equal(classify(503, {}), 'retry');
});

test('the access token: a JWT Google can check, kept in memory, asked again when fresh; a refusal says auth', async () => {
  forgetAccessToken();
  const account = serviceAccount({ FCM_SERVICE_ACCOUNT: ACCOUNT });
  assert.ok(account);
  assert.equal(serviceAccount({ FCM_SERVICE_ACCOUNT: '{"project_id":"x"}' }), null);
  assert.equal(serviceAccount({}), null);
  const { f, log } = fakeFcm();
  assert.equal(await accessToken(account, f), 'at-1');
  const [head, claims, sig] = log.assertion.split('.');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', KEY.pair.publicKey, Buffer.from(sig, 'base64url'), new TextEncoder().encode(head + '.' + claims));
  assert.ok(ok, 'signed with the account\'s key');
  const c = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.deepEqual([c.iss, c.aud, c.scope], [account.email, OAUTH_URL, 'https://www.googleapis.com/auth/firebase.messaging']);
  assert.equal(await accessToken(account, f), 'at-1');
  assert.equal(log.oauth, 1, 'cached');
  assert.equal(await accessToken(account, f, { fresh: true }), 'at-2');
  forgetAccessToken();
  await assert.rejects(accessToken(account, fakeFcm({ oauth: 400 }).f), err => err.code === 'auth');
});

test('a send: parts of 45, each taken once; dead tokens go, a flaky one gets a second round, worn ones go', async () => {
  const w = await world();
  const ids = [];
  for (let i = 0; i < 2 * PART_SIZE + 5; i++) ids.push(await w.device(tok(i)));
  ids.push(await w.device(tok(1, 'dead')), await w.device(tok(1, 'flaky')), await w.device(tok(1, 'bad')), await w.device(tok(2, 'bad'), { fails: MAX_FAILS - 1 }));
  const message = model({ title: 'خبر', body: 'جديد', url: '/#news/n1', tag: 'n-n1' });
  const s = await startSend(w.h.env, { audience: 'public', ref: 'n1', message, ttl: 3600, devices: ids });
  assert.equal(s.targets, ids.length);
  const parts = w.jobs();
  assert.deepEqual(parts.map(p => p.payload.ids.length), [45, 45, 9]);
  assert.ok(!JSON.stringify(parts).includes('tok_'), 'a queue message never carries a token');

  const { f, log } = fakeFcm();
  for (const p of parts) await runPart(w.h.env, p.payload, f);
  assert.deepEqual(await runPart(w.h.env, parts[0].payload, f), { skipped: 'taken' }, 'delivered twice: sent once');
  const second = w.jobs();
  assert.equal(second.length, 1, 'one more round for the transient ones');
  assert.deepEqual(second[0].payload.ids.sort(), [await pushHash(tok(1, 'flaky')), await pushHash(tok(1, 'bad')), await pushHash(tok(2, 'bad'))].sort());
  let row = await w.sendRow(s.id);
  assert.equal(row.status, 'sending', 'waits for the second round');
  assert.equal(await w.h.db.prepare('SELECT 1 FROM push_devices WHERE token = ?').bind(tok(1, 'dead')).first(), null, 'a dead token is gone');

  await runPart(w.h.env, second[0].payload, f);
  row = await w.sendRow(s.id);
  assert.deepEqual([row.status, row.targets, row.sent, row.failed, row.removed, row.parts, row.parts_done], ['sent', ids.length, 2 * PART_SIZE + 5 + 1, 2, 2, 4, 4]);
  assert.ok(row.finished_ms);
  assert.equal((await w.h.db.prepare('SELECT fails FROM push_devices WHERE token = ?').bind(tok(1, 'bad')).first()).fails, 1);
  assert.equal(await w.h.db.prepare('SELECT 1 FROM push_devices WHERE token = ?').bind(tok(2, 'bad')).first(), null, 'failed MAX_FAILS in a row: gone');
  assert.equal(log.oauth, 1, 'one access token for the whole send');
  assert.ok(log.sends.every(x => x.url === 'https://fcm.googleapis.com/v1/projects/athanasios-test/messages:send' && x.auth === 'Bearer at-1'));
  assert.deepEqual(log.sends[0].message.data, { kind: 'public', id: '', title: 'خبر', body: 'جديد', url: '/#news/n1', tag: 'n-n1' });
});

test('a second round is queued with a delay; without a key nothing is sent and the send fails', async () => {
  const w = await world();
  const id = await w.device(tok(1, 'flaky'));
  const queued = [];
  w.h.env.JOBS.send = async (m, o) => { queued.push({ m, o }); };
  await startSend(w.h.env, { audience: 'public', ref: 'n1', message: model({ title: 'x' }), ttl: 60, devices: [id] });
  await runPart(w.h.env, queued[0].m.payload, fakeFcm().f);
  assert.deepEqual(queued[1].o, { delaySeconds: RETRY_DELAY_S });

  const k = await world({ key: false });
  const d = await k.device(tok(2));
  const s = await startSend(k.h.env, { audience: 'public', ref: 'n2', message: model({ title: 'x' }), ttl: 60, devices: [d] });
  const { f, log } = fakeFcm();
  await k.drain(f);
  const row = await k.sendRow(s.id);
  assert.deepEqual([row.status, row.failed, row.error, log.sends.length], ['failed', 1, 'no key', 0]);
  assert.equal((await k.h.db.prepare('SELECT fails FROM push_devices WHERE id = ?').bind(d).first()).fails, 0, 'no key is not the device\'s fault');
});

test('FCM refuses the access token: a fresh one is asked for the second round', async () => {
  const w = await world();
  const id = await w.device(tok(1));
  const s = await startSend(w.h.env, { audience: 'public', ref: 'n1', message: model({ title: 'x' }), ttl: 60, devices: [id] });
  const bad = fakeFcm({ fcmStatus: 401 });
  await runPart(w.h.env, w.jobs()[0].payload, bad.f);
  const good = fakeFcm();
  await w.drain(good.f);
  assert.equal(good.log.oauth, 1, 'the refused token was forgotten');
  const row = await w.sendRow(s.id);
  assert.deepEqual([row.status, row.sent, row.error], ['sent', 1, 'auth']);

  // refused both rounds: failed, and the device is not blamed
  const id2 = await w.device(tok(2));
  const s2 = await startSend(w.h.env, { audience: 'public', ref: 'n2', message: model({ title: 'x' }), ttl: 60, devices: [id2] });
  await w.drain(fakeFcm({ fcmStatus: 401 }).f);
  const row2 = await w.sendRow(s2.id);
  assert.deepEqual([row2.status, row2.failed], ['failed', 1]);
  assert.equal((await w.h.db.prepare('SELECT fails FROM push_devices WHERE id = ?').bind(id2).first()).fails, 0);
});

test('presence: only the device whose panel is in sight is spared', () => {
  const now = 1e9;
  const s = { sid: 's', device: 'لابتوب', seen_ms: now - 10000, parked_ms: null, hidden_ms: null };
  assert.equal(presentDevice(s, now), 'لابتوب');
  assert.equal(presentDevice({ ...s, hidden_ms: now }, now), null);
  assert.equal(presentDevice({ ...s, parked_ms: now }, now), null);
  assert.equal(presentDevice({ ...s, seen_ms: now - 71000 }, now), null);
  assert.equal(presentDevice(null, now), null);
  assert.equal(spared('لابتوب', 'لابتوب'), true);
  assert.equal(spared('موبايل', 'لابتوب'), false);
  assert.equal(spared('جهاز', 'لابتوب'), true, 'a device we can\'t tell apart counts as that one');
  assert.equal(spared('موبايل', null), false);
});

async function routed(w) {
  await w.set('NOTIFY_ROUTER', '1');
  await route(w.h.env, Date.now() - 1);
  await activityStmt(w.h.db, { id: 'act-pub000000001', actor: M, actorName: 'مرقس', action: 'publish', entityType: 'site', summary: 'نشر الموقع' }).run();
  await route(w.h.env);
  return (await w.h.db.prepare("SELECT * FROM notify_outbox WHERE channel = 'push' ORDER BY recipient").all()).results;
}
const claim = async (h, ts = Date.now()) => {
  const raw = JSON.stringify({ v: 1, ack: [] });
  return h.call('/v1/sync/notify-claim', { method: 'POST', body: raw, headers: { 'x-sync-ts': String(ts), 'x-sync-signature': await signSync('sync-test-secret', String(ts), raw) } });
};

test('admin pushes: from the outbox once PUSH_SENDER = worker; the claim feed then hands out nothing', async () => {
  const w = await world();
  const rows = await routed(w);
  assert.deepEqual(rows.map(r => r.recipient), [B, P]);
  assert.equal(await adminPushTick(w.h.env), null, 'switch off: Apps Script claims them');
  await w.set('PUSH_SENDER', 'worker');
  const c = await claim(w.h);
  assert.deepEqual([c.body.router, c.body.sender, c.body.items.length], [true, true, 0], 'router on (Apps Script keeps its own pushes off), Apps Script told to send nothing, nothing handed out');

  const looking = await w.device(tok(1), { audience: 'admin', email: P, label: 'لابتوب' });
  const phone = await w.device(tok(2), { audience: 'admin', email: P, label: 'موبايل' });
  await w.device(tok(3), { audience: 'public' });
  await w.h.db.prepare("INSERT INTO admin_sessions (email, sid, device, since_ms, seen_ms) VALUES (?, 'sid-1', 'لابتوب', ?, ?)").bind(P, Date.now(), Date.now()).run();
  const out = await adminPushTick(w.h.env);
  assert.deepEqual(out, { leased: 2, sent: 1, done: 1 });
  const bRow = await w.h.db.prepare('SELECT status, error FROM notify_outbox WHERE recipient = ? AND channel = ?').bind(B, 'push').first();
  assert.deepEqual([bRow.status, bRow.error], ['sent', 'none'], 'no devices is an answer');
  const parts = w.jobs();
  assert.deepEqual(parts[0].payload.ids, [phone], 'the laptop in sight is spared, the phone gets it; never a visitor');
  assert.notEqual(parts[0].payload.ids[0], looking);
  assert.equal(await adminPushTick(w.h.env).then(r => r.leased), 0, 'leased: not twice');

  const { f, log } = fakeFcm();
  for (const p of parts) await runPart(w.h.env, p.payload, f);
  const pRow = await w.h.db.prepare('SELECT status, claim_id FROM notify_outbox WHERE recipient = ? AND channel = ?').bind(P, 'push').first();
  assert.deepEqual([pRow.status, pRow.claim_id], ['sent', null], 'the send\'s result answers the row');
  const data = log.sends[0].message.data;
  assert.equal(data.kind, 'admin');
  assert.equal(data.group, 'admin');
  assert.match(data.title, /مرقس/);
  assert.match(data.url, /^\/admin\//);
});

test('admin pushes: a critical row reaches the device in sight; a failure retries with backoff; no key or a removed admin is an answer', async () => {
  const w = await world();
  await routed(w);
  await w.set('PUSH_SENDER', 'worker');
  const id = await w.device(tok(1, 'bad'), { audience: 'admin', email: P, label: 'لابتوب' });
  await w.h.db.prepare("INSERT INTO admin_sessions (email, sid, device, since_ms, seen_ms) VALUES (?, 'sid-1', 'لابتوب', ?, ?)").bind(P, Date.now(), Date.now()).run();
  await w.h.db.prepare("UPDATE notify_outbox SET level = 'critical' WHERE recipient = ?").bind(P).run();
  await adminPushTick(w.h.env);
  const parts = w.jobs();
  assert.deepEqual(parts.map(p => p.payload.ids), [[id]], 'critical: never spared');
  const { f } = fakeFcm();
  await runPart(w.h.env, parts[0].payload, f);
  await w.drain(f);
  const row = await w.h.db.prepare('SELECT status, next_ms, error FROM notify_outbox WHERE recipient = ? AND channel = ?').bind(P, 'push').first();
  assert.equal(row.status, 'failed');
  assert.ok(row.next_ms > Date.now(), 'backoff');

  const k = await world({ key: false });
  await routed(k);
  await k.set('PUSH_SENDER', 'worker');
  await k.device(tok(4), { audience: 'admin', email: P });
  await k.h.db.prepare('UPDATE admins SET active = 0 WHERE email = ?').bind(B).run();
  await adminPushTick(k.h.env);
  const answers = (await k.h.db.prepare("SELECT recipient, status, error FROM notify_outbox WHERE channel = 'push' ORDER BY recipient").all()).results;
  assert.deepEqual(answers.map(a => [a.status, a.error]), [['sent', 'off'], ['sent', 'off']]);
});

test('a send to the visitors: once per item, a repeated key gets its result, cooldown, a day\'s limit, topics', async () => {
  const w = await world();
  await w.device(tok(1));
  await w.device(tok(2), { topics: ['events'] });
  const go = (o = {}) => publicSend(w.h.env, { notifId: 'n1', sendKey: 'key-00000001', message: { title: 'خبر' }, ttl: 3600, ...o });
  const first = await go();
  assert.equal(first.targets, 2);
  assert.equal((await go()).replay, true);
  await w.drain(fakeFcm().f);
  assert.equal((await go({ sendKey: 'key-00000002' })).already, true, 'an item goes once');
  await assert.rejects(go({ notifId: 'n2', sendKey: 'key-00000003' }), err => err.code === 'rate', 'a minute between sends');
  const later = Date.now() + 61000;
  const topic = await go({ notifId: 'n2', sendKey: 'key-00000004', topic: 'announcements', now: later });
  assert.equal(topic.targets, 1, 'only devices that kept the topic');
  await w.h.db.prepare('UPDATE push_sends SET started_ms = started_ms - 120000').run();
  for (let i = 0; i < SENDS_PER_DAY; i++) await w.h.db.prepare("INSERT INTO push_sends (id, audience, ref, status, started_ms, message, ttl) VALUES (?, 'public', ?, 'sent', ?, '{}', 1)").bind('ps-00000' + i, 'x' + i, later - 100000).run();
  await assert.rejects(go({ notifId: 'n3', sendKey: 'key-00000005', now: later }), err => err.code === 'rate');
  const none = await world();
  await assert.rejects(publicSend(none.h.env, { notifId: 'n1', sendKey: 'key-00000001', message: { title: 'x' }, ttl: 60 }), err => err.code === 'invalid');
  const off = await world({ key: false });
  await assert.rejects(publicSend(off.h.env, { notifId: 'n1', sendKey: 'key-00000001', message: { title: 'x' }, ttl: 60 }), err => err.code === 'disabled');
});

test('the queue: a fan-out runs first in its batch; one after it waits for its own run, spending no retry', async () => {
  const w = await world();
  const ids = [await w.device(tok(1)), await w.device(tok(2))];
  await startSend(w.h.env, { audience: 'public', ref: 'n1', message: model({ title: 'x' }), ttl: 60, devices: [ids[0]] });
  await startSend(w.h.env, { audience: 'public', ref: 'n2', message: model({ title: 'x' }), ttl: 60, devices: [ids[1]] });
  const jobs = w.jobs();
  const acks = [];
  const resent = [];
  w.h.env.JOBS.send = async (m, o) => { resent.push({ m, o }); };
  const real = globalThis.fetch;
  globalThis.fetch = fakeFcm().f;
  try {
    await consume({ messages: jobs.map((body, i) => ({ body, attempts: 1, ack: () => acks.push(i), retry: () => assert.fail('no retry') })) }, w.h.env);
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(acks, [0, 1]);
  assert.equal(resent.length, 1);
  assert.deepEqual([resent[0].m.id, resent[0].o.delaySeconds], [jobs[1].id, 1], 'the same job, its own run');
});

test('the routes: the key check and a test to my own devices only', async () => {
  const g = await fakeGoogle();
  const w = await world();
  const call = async (email, path) => w.h.call('/v1/admin/push/' + path, { method: 'POST', body: {}, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email, sub: 's-' + email })) }, fetch: async (u, i) => (String(u).includes('googleapis.com/oauth2/v3/certs') || String(u).includes('accounts.google') ? g.fetch(u, i) : fakeFcm().f(u, i)) });
  const check = await call(P, 'check');
  assert.equal(check.status, 200, JSON.stringify(check.body));
  assert.equal(check.body.check, true);
  assert.equal((await call(P, 'test')).body.code, 'invalid', 'no devices yet');
  await w.device(tok(1), { audience: 'admin', email: P });
  await w.device(tok(2), { audience: 'admin', email: M });
  await w.device(tok(3));
  const t = await call(P, 'test');
  assert.equal(t.body.targets, 1);
  assert.equal((await call(P, 'test')).body.code, 'rate');
  const k = await world({ key: false });
  w.h = k.h;
  assert.equal((await call(P, 'check')).body.check, false);
});

test('Phase 6 Step 4d: a Firebase Installation ID registers like a token and is sent as `fid`; urgent is the high priority on native', async () => {
  const w = await world();
  const fid = 'cR_m2xYz0123456789abcd';
  const r = await w.h.call('/v1/push/subscribe', { method: 'POST', body: { token: fid, previous: tok(9) } });
  assert.equal(r.body.ok, true);
  const id = await pushHash(fid);
  assert.ok(await w.h.db.prepare('SELECT 1 FROM push_devices WHERE id = ?').bind(id).first());
  assert.equal((await w.h.call('/v1/push/subscribe', { method: 'POST', body: { token: 'x'.repeat(23) } })).body.code, 'invalid', '22 exactly, or a full token');

  const m = model({ title: 'x' });
  assert.deepEqual(Object.keys(fcmMessage({ token: fid, platform: 'web' }, m, 60)).sort(), ['data', 'fid', 'webpush']);
  assert.equal(fcmMessage({ token: tok(1), platform: 'web' }, m, 60).token, tok(1));
  const urgent = model({ title: 'x', urgent: true });
  assert.equal(fcmMessage({ token: tok(1), platform: 'android' }, urgent, 60).android.priority, 'HIGH');
  assert.equal(fcmMessage({ token: tok(1), platform: 'android' }, m, 60).android.priority, 'NORMAL');
  assert.equal(fcmMessage({ token: tok(1), platform: 'ios' }, urgent, 60).apns.headers['apns-priority'], '10');
  assert.equal(fcmMessage({ token: tok(1), platform: 'web' }, urgent, 60).data.urgent, undefined, 'not a data field');
  assert.equal(classify(400, { error: { message: 'The provided Firebase Installation ID is not valid' } }), 'dead');

  // a native token and a send: the `fid` / `token` targets go out as built
  const native = await w.device(tok(2), { platform: 'android' });
  await startSend(w.h.env, { audience: 'public', ref: 'n1', message: urgent, ttl: 60, devices: [id, native] });
  const { f, log } = fakeFcm();
  await w.drain(f);
  const targets = log.sends.map(s => Object.keys(s.message).filter(k => k === 'fid' || k === 'token')[0]).sort();
  assert.deepEqual(targets, ['fid', 'token']);
});

test('Phase 6 Step 4d: the allowed origins are configuration; a native shell\'s origin is one more entry, nothing in code', async () => {
  const h = harness({ env: { ALLOWED_ORIGINS: 'https://stathanasiosyouth.github.io,https://localhost,capacitor://localhost' } });
  const { handle } = await import('../src/index.js');
  for (const origin of ['https://localhost', 'capacitor://localhost']) {
    const res = await handle(new Request('https://api.test/v1/push/subscribe', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } }), h.env, { waitUntil() {} });
    assert.equal(res.status, 204, origin);
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
  }
  const plain = harness();
  const res = await handle(new Request('https://api.test/v1/push/subscribe', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost', 'access-control-request-method': 'POST' } }), plain.env, { waitUntil() {} });
  assert.equal(res.status, 403, 'not configured: refused');
});
