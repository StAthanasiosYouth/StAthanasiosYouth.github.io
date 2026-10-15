// Apps Script → Cloudflare Worker allowlist sync (apps-script/WorkerSync.gs),
// checked against the Worker's own signature code (worker/src/lib/sync.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './fakes/gas.mjs';
import { signSync } from '../worker/src/lib/sync.js';

const SYNC_URL = 'https://athanasios-api.menazak-lab.workers.dev/v1/sync/admins';
const SECRET = 's'.repeat(48);

function world() {
  const w = createWorld({ adminEmails: 'menazakmena@gmail.com, b@example.com' });
  w.web[SYNC_URL] = { status: 200, body: '{"ok":true,"active":2}' };
  w.gs.API_REQUEST_ = null;
  return w;
}
const syncs = w => w.webRequests.filter(r => r.url === SYNC_URL);

test('worker sync: nothing without a secret; the seed is stored once; the Worker accepts the signature', async () => {
  const w = world();
  assert.equal(w.gs.workerSyncAdmins_(true), false, 'no secret, no call');
  assert.equal(syncs(w).length, 0);

  w.gs.WORKER_SYNC_SEED_ = SECRET;
  assert.equal(w.gs.workerSyncAdmins_(true), true);
  assert.equal(w.properties.get('WORKER_SYNC_SECRET'), SECRET, 'seed copied into the Script Property');

  const req = syncs(w)[0];
  const body = Buffer.from(req.options.payload.map(b => (b < 0 ? b + 256 : b))).toString('utf8');
  const ts = req.options.headers['x-sync-ts'];
  assert.equal(req.options.headers['x-sync-signature'], await signSync(SECRET, ts, body), 'same HMAC as the Worker computes');
  const list = JSON.parse(body).admins;
  assert.deepEqual(list.map(a => a.email), ['menazakmena@gmail.com', 'b@example.com']);
  assert.deepEqual(list.map(a => a.primary), [true, false]);
});

test('worker sync: unchanged list not resent; a change goes out on the next heartbeat check; failures never throw', () => {
  const w = world();
  w.properties.set('WORKER_SYNC_SECRET', SECRET);
  assert.equal(w.gs.workerSyncAdmins_(false), true, 'first check sends');
  assert.equal(w.gs.workerSyncAdmins_(false), false, 'checked recently: skip');
  w.gs.workerSyncSoon_();
  assert.equal(w.gs.workerSyncAdmins_(false), false, 'same list: not resent');
  assert.equal(syncs(w).length, 1);

  w.properties.set('ADMIN_EMAILS', 'menazakmena@gmail.com, b@example.com, c@example.com');
  w.gs.workerSyncSoon_();
  assert.equal(w.gs.workerSyncAdmins_(false), true, 'changed list: sent');
  assert.equal(syncs(w).length, 2);

  w.web[SYNC_URL] = { status: 503, body: 'down' };
  w.properties.set('ADMIN_EMAILS', 'menazakmena@gmail.com');
  w.gs.workerSyncSoon_();
  assert.equal(w.gs.workerSyncAdmins_(false), false, 'Worker down: false, no throw');
  w.web[SYNC_URL] = { status: 200, body: '{}' };
  w.gs.workerSyncSoon_();
  assert.equal(w.gs.workerSyncAdmins_(false), true, 'retried next time');
});
