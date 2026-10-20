// Phase 1.5 step 5 (apps-script/NotifyClaim.gs): the Worker router's push rows
// claimed with a signature the Worker checks, sent to the NAMED admin only,
// answered in the next call (at least once, never twice), and this script's
// own admin pushes paused while the router is on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createWorld } from './fakes/gas.mjs';
import { signSync } from '../worker/src/lib/sync.js';

const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'fady.youssef@gmail.com';
const URL_ = 'https://athanasios-api.menazak-lab.workers.dev/v1/sync/notify-claim';
const SECRET = 's'.repeat(48);
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account', project_id: 'athanasios-links', private_key_id: 'k', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), client_email: 'push@x.iam.gserviceaccount.com', token_uri: 'https://oauth2.googleapis.com/token' });
const deviceToken = n => `a${String(n).padStart(3, '0')}Xk2:APA91b${'Z'.repeat(140)}${n}`;

function tab(world, email, device) {
  const now = Math.floor((Date.now() + world.clock.skew) / 1000);
  const token = world.issueToken({ email, iat: String(now), exp: String(now + 3600) });
  const reply = world.post({ fn: 'apiSessionStart', args: [{ device, force: true, state: false }], token });
  assert.equal(reply.ok, true, reply.error);
  const sid = reply.result.sid;
  return { call: (fn, ...args) => world.post({ fn, args, token, sid }) };
}

function world() {
  const w = createWorld({ executeAs: 'USER_DEPLOYING' });
  w.as(ADMIN).gs.setup();
  w.properties.set('ADMIN_CLIENT_ID', '1234-abc.apps.googleusercontent.com');
  w.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  w.properties.set('FCM_SERVICE_ACCOUNT', SERVICE_ACCOUNT);
  w.as('');
  const mina = tab(w, ADMIN, 'كمبيوتر');
  const fady = tab(w, SECOND, 'موبايل فادي');
  assert.equal(mina.call('apiAdminPushSubscribe', { token: deviceToken(1), platform: 'desktop' }).ok, true);
  assert.equal(fady.call('apiAdminPushSubscribe', { token: deviceToken(2), platform: 'android' }).ok, true);
  for (const n of [1, 2]) w.fcm.devices.set(deviceToken(n), 'ok');
  for (const page of [mina, fady]) page.call('apiSessionEnd');
  w.advance(5 * 60_000);
  w.properties.set('WORKER_SYNC_SECRET', SECRET);
  w.gs.API_REQUEST_ = null;
  return w;
}
const reply = (items, router = true) => ({ status: 200, body: JSON.stringify({ ok: true, router, items }) });
const claims = w => w.webRequests.filter(r => r.url === URL_);
const bodyOf = req => JSON.parse(Buffer.from(req.options.payload.map(b => (b < 0 ? b + 256 : b))).toString('utf8'));
const item = (n, recipient = SECOND, level = 'important') => ({ id: 'ntf-' + String(n).padStart(8, '0'), claim: 'clm-aaaaaaaa', recipient, level, title: 'مينا نشر الموقع', body: 'لوحة تحكم الأسرة', url: '/admin/#activity/act-1', tag: 'adm-publish-1' });
const sentTokens = (w, from = 0) => w.fcm.sent.slice(from).map(s => s.body.message.token);

test('claim: signed like the Worker checks; the item goes to the named admin only; the answer goes in the next call', async () => {
  const w = world();
  w.web[URL_] = reply([item(1)]);
  w.gs.notifyClaimRun_(true);
  const first = claims(w)[0];
  const raw = Buffer.from(first.options.payload.map(b => (b < 0 ? b + 256 : b))).toString('utf8');
  assert.equal(first.options.headers['x-sync-signature'], await signSync(SECRET, first.options.headers['x-sync-ts'], raw));
  assert.deepEqual(sentTokens(w), [deviceToken(2)], 'Fady\'s device only');
  // the answer rode on the next claim (the fake keeps answering the same item: delivered once)
  const answers = claims(w).slice(1).map(r => bodyOf(r).ack).filter(a => a.length);
  assert.deepEqual(answers[0], [{ id: item(1).id, claim: 'clm-aaaaaaaa', ok: true, reason: '' }]);
  assert.equal(sentTokens(w).length, 1, 'the same id handed out again is confirmed, not sent twice');
  assert.equal(w.properties.get('NOTIFY_ROUTER_ON'), '1');
});

test('claim: nothing to send to is an answer; an FCM error is not (the Worker retries); answers kept until the Worker has them', () => {
  const w = world();
  w.fcm.devices.set(deviceToken(2), 'error');
  w.web[URL_] = reply([item(2), item(3, 'nobody@gmail.com')]);
  w.gs.notifyClaimRun_(true);
  const last = bodyOf(claims(w)[1]).ack;
  assert.deepEqual(last.map(a => [a.ok, a.reason]), [[false, 'error'], [true, 'not admin']]);

  w.fcm.devices.set(deviceToken(2), 'ok');
  // one round answers, then the Worker is away: the answer waits in the property
  w.web[URL_] = { status: 200, body: JSON.stringify({ ok: true, router: true, items: [item(4)] }) };
  w.gs.NOTIFY_ROUNDS = 1;
  w.gs.notifyClaimRun_(true);
  assert.equal(JSON.parse(w.properties.get('NOTIFY_ACKS'))[0].id, item(4).id);
  w.web[URL_] = reply([]);
  w.gs.notifyClaimRun_(true);
  assert.equal(bodyOf(claims(w).at(-1)).ack[0].id, item(4).id, 'sent with the next call');
  assert.equal(w.properties.get('NOTIFY_ACKS'), '[]');
});

test('router on: this script\'s own admin pushes stop (no double); off again: they come back', () => {
  const w = world();
  w.web[URL_] = reply([], true);
  w.gs.notifyClaimRun_(true);
  assert.equal(w.gs.notifyRouterOn_(), true);
  const before = w.fcm.sent.length;
  w.as(ADMIN).gs.activity_({ action: 'create', type: 'news', id: 'n-1', title: 'خبر' });
  w.gs.activityPending_('trigger');
  assert.equal(w.fcm.sent.length, before, 'no push from Activity.gs while the router is on');

  w.web[URL_] = reply([], false);
  w.gs.notifyClaimRun_(true);
  assert.equal(w.gs.notifyRouterOn_(), false);
  w.as(ADMIN).gs.activity_({ action: 'create', type: 'news', id: 'n-2', title: 'خبر ٢' });
  assert.ok(w.fcm.sent.length > before, 'router off: Activity.gs pushes as before');
});

test('claim: no secret → nothing; a quiet tick inside the minute does nothing; never throws', () => {
  const w = world();
  w.properties.delete('WORKER_SYNC_SECRET');
  assert.equal(w.gs.notifyClaimRun_(true), 0);
  assert.equal(claims(w).length, 0);
  w.properties.set('WORKER_SYNC_SECRET', SECRET);
  w.web[URL_] = { status: 200, body: 'not json' };
  assert.equal(w.gs.notifyClaimRun_(true), 0);
  assert.equal(w.gs.notifyClaimRun_(false), 0, 'checked a moment ago');
});
