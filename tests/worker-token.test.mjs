// apps-script/WorkerSync.gs apiWorkerSession: the panel's session → a short-lived
// token the Worker verifies with its own code (worker/src/lib/auth.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compWorld, adminApi, ADMIN } from './fakes/comp.mjs';
import { verifyWorkerToken, WK_MAX_S } from '../worker/src/lib/auth.js';

const SECRET = 'w'.repeat(48);

test('apiWorkerSession: a signed-in panel gets a token the Worker accepts, as that admin, ≤ 20 min, nothing else inside', async () => {
  const world = compWorld();
  world.properties.set('WORKER_SYNC_SECRET', SECRET);
  const call = adminApi(world);
  const { token, exp } = call('apiWorkerSession');
  assert.match(token, /^wk1\.[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
  const claims = await verifyWorkerToken({ SYNC_SECRET: SECRET }, token, (exp - 60) * 1000);
  assert.equal(claims.email, ADMIN);
  assert.ok(exp - Math.floor((Date.now() + world.clock.skew) / 1000) <= WK_MAX_S);
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.deepEqual(Object.keys(payload).sort(), ['e', 'i', 'v', 'x']);
  await assert.rejects(() => verifyWorkerToken({ SYNC_SECRET: 'x'.repeat(48) }, token, (exp - 60) * 1000));
  // no session / not an admin: nothing
  assert.equal(world.post({ fn: 'apiWorkerSession', args: [] }).ok, false);
});
