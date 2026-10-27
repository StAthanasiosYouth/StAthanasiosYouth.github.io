// Phase 4: content saved on the Worker keeps today's Activity behaviour —
//   merge: a repeat edit by the same admin within 10 minutes stays ONE row (Activity.gs activityMergeTarget_),
//   push:  the admin pushes Activity.gs decides (router off) reach the other admins' devices through
//          Apps Script, unchanged (ContentExport.gs contentNotifyPull_ → activityDispatchPending_),
//          only once the owner sets CONTENT_WRITER = 'worker' at the cutover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { harness, fakeGoogle } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { createWorld } from '../../tests/fakes/gas.mjs';
import { compWorld, adminApi, plain } from '../../tests/fakes/comp.mjs';

const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'fady.youssef@gmail.com';
const THIRD = 'third.admin@gmail.com';
const CLIENT = '1234-abc.apps.googleusercontent.com';
const WORKER = 'https://athanasios-api.menazak-lab.workers.dev';
const SECRET = 'sync-test-secret';
let tick = 0;
const deviceToken = n => `a${String(n).padStart(3, '0')}Xk2:APA91b${'Z'.repeat(140)}${n}`;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account', project_id: 'athanasios-links', private_key_id: 'abc123',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  client_email: 'push-sender@athanasios-links.iam.gserviceaccount.com', token_uri: 'https://oauth2.googleapis.com/token'
});

/* three admins with a device each, none in the panel (tests/activity.test.mjs pushWorld) */
function pushWorld() {
  const world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');
  world.properties.set('ADMIN_CLIENT_ID', CLIENT);
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}, ${THIRD}`);
  world.properties.set('FCM_SERVICE_ACCOUNT', SERVICE_ACCOUNT);
  world.properties.set('WORKER_SYNC_SECRET', SECRET);
  world.as('');
  world.fcm.siteContent = JSON.stringify({ schema: 3, revision: 'r', layout: [], notifications: [] });
  const tab = email => {
    const now = Math.floor((Date.now() + world.clock.skew) / 1000);
    const token = world.issueToken({ email, iat: String(now), exp: String(now + 3600) });
    const started = world.post({ fn: 'apiSessionStart', args: [{ device: 'موبايل', force: true, state: false }], token });
    assert.equal(started.ok, true, started.error);
    const sid = started.result.sid;
    return { ok: (fn, ...args) => { const r = world.post({ fn, args, token, sid }); assert.equal(r.ok, true, `${fn}: ${r.error}`); return r.result; } };
  };
  const pages = [ADMIN, SECOND, THIRD].map(tab);
  pages[0].ok('apiSetAdminName', ADMIN, 'مينا زكريا');
  pages.forEach((p, i) => p.ok('apiAdminPushSubscribe', { token: deviceToken(i + 1), platform: 'android' }));
  for (const n of [1, 2, 3]) world.fcm.devices.set(deviceToken(n), 'ok');
  pages.forEach(p => p.ok('apiSessionEnd', { park: true }));
  world.advance(5 * 60_000);
  return world;
}

async function workerOf(payload, names = {}) {
  const g = await fakeGoogle();
  const h = harness({ env: { ADMIN_EMAILS: '' } });
  for (const [email, role] of [[ADMIN, 'primary'], [SECOND, 'admin'], [THIRD, 'admin']]) {
    await h.db.prepare('INSERT INTO admins (email, name, role, active, created_at) VALUES (?, ?, ?, 1, 0)').bind(email, names[email] || '', role).run();
  }
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'ADMIN_PLATFORM'").run();
  const sync = async (path, body) => {
    const raw = JSON.stringify(body);
    const ts = String(Date.now() + (++tick));
    return h.call(path, { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': await signSync(SECRET, ts, raw) } });
  };
  assert.equal((await sync('/v1/sync/content-import', { mode: 'apply', ...payload })).body.state, 'ok');
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'CONTENT_DRAFTS'").run();
  const start = await h.call('/v1/admin/session/start', { method: 'POST', body: { device: 'كمبيوتر', tab: 'tab-aaaaaaaaaaaaaaaa' }, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: ADMIN, sub: 's1' })) }, fetch: g.fetch });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const call = (fn, ...args) => h.call('/v1/admin/content/call', { method: 'POST', body: { fn, args }, headers: { authorization: 'Bearer ' + start.body.token }, fetch: g.fetch });
  return { h, sync, call };
}

test('merge: a create then two edits by the same admin stay one «أضاف» row with count 3 — on the Worker as in Apps Script', async () => {
  const world = compWorld();
  const call = adminApi(world);
  const w = await workerOf(plain(world.gs.contentExportPayload_()));

  call('apiSaveLink', { title: 'لينك', url: 'https://a.com/1', section: 'social' });
  const gsId = plain(world.gs.readTable_('Links')).find(l => l.title === 'لينك').id;
  call('apiSaveLink', { id: gsId, title: 'لينك ٢', url: 'https://a.com/2', section: 'social' });
  call('apiSaveLink', { id: gsId, title: 'لينك ٣', url: 'https://a.com/3', section: 'social' });
  const sheet = world.spreadsheet.getSheetByName('Activity');
  const [head, ...body] = sheet.data;
  const gsRows = body.map(r => Object.fromEntries(head.map((k, i) => [k, r[i]]))).filter(r => r.entityId === gsId);

  assert.equal((await w.call('apiSaveLink', { title: 'لينك', url: 'https://a.com/1', section: 'social' })).status, 200);
  const id = (await w.h.db.prepare("SELECT id FROM draft_rows WHERE kind = 'links' AND json_extract(data, '$.title') = 'لينك'").first()).id;
  assert.equal((await w.call('apiSaveLink', { id, title: 'لينك ٢', url: 'https://a.com/2', section: 'social' })).status, 200);
  assert.equal((await w.call('apiSaveLink', { id, title: 'لينك ٣', url: 'https://a.com/3', section: 'social' })).status, 200);
  const rows = (await w.h.db.prepare('SELECT action, entity_title, count FROM activity WHERE entity_id = ?').bind(id).all()).results;

  assert.deepEqual(rows.map(r => [r.action, r.entity_title, r.count]), gsRows.map(r => [r.action, r.entityTitle, Number(r.count)]));
  assert.deepEqual(rows.map(r => [r.action, r.count]), [['create', 3]]);
});

test('push: a news item created on the Worker reaches the OTHER admins\' devices through Apps Script, once — only after CONTENT_WRITER = worker', async () => {
  const world = pushWorld();
  const w = await workerOf(plain(world.gs.contentExportPayload_()), { [ADMIN]: 'مينا زكريا' });

  const saved = await w.call('apiSaveItem', 'news', { title: 'خبر جديد للكل', summary: 'x' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const queued = (await w.h.db.prepare('SELECT row FROM content_notify').all()).results.map(r => JSON.parse(r.row));
  assert.deepEqual(queued.map(r => r.notified), ['pending:now']);

  // the Apps Script side asks the Worker (signed); here the fake fetch hands it what the Worker answers
  const answers = [];
  world.web[WORKER + '/v1/sync/content-notify'] = () => ({ status: 200, body: JSON.stringify(answers.shift() || { ok: true, items: [] }) });
  const before = world.fcm.sent.length;

  world.gs.activityPending_('trigger');
  assert.equal(world.webRequests.filter(r => r.url.endsWith('/v1/sync/content-notify')).length, 0, 'off before the cutover: never asked');

  world.properties.set('CONTENT_WRITER', 'worker');
  answers.push((await w.sync('/v1/sync/content-notify', { at: 1 })).body);
  world.gs.activityPending_('trigger');
  const sent = world.fcm.sent.slice(before).map(s => s.body.message);
  assert.deepEqual(sent.map(m => m.token).sort(), [deviceToken(2), deviceToken(3)].sort(), 'the other admins, never the actor');
  assert.equal(sent[0].data.title, 'مينا زكريا أضاف خبر جديد «خبر جديد للكل»');
  const newsId = (await w.h.db.prepare("SELECT id FROM draft_rows WHERE kind = 'news' AND json_extract(data, '$.title') = 'خبر جديد للكل'").first()).id;
  assert.equal(sent[0].data.url, '/admin/#open/news/' + newsId);

  // handed out once: the Worker gives nothing more
  assert.deepEqual((await w.sync('/v1/sync/content-notify', { at: 2 })).body.items, []);
});
