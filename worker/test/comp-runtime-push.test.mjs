// Apps Script → Worker, both real (docs/PHASE5-PLAN.md P5-9): what compRuntimePush_ really sends, through the real
// signature check and stored by the Worker's own code; then an account plays what was pushed. And the one-writer switch.
// Run: node --experimental-sqlite --no-warnings --test test/comp-runtime-push.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compWorld, adminApi, pub, clientKey, publish, scoredComp, ADMIN } from '../../tests/fakes/comp.mjs';
import { harness } from './helpers.mjs';
import { compReleaseTick } from '../src/comp/runtime.js';

const SECRET = 'sync-test-secret';
const URL_BASE = 'https://athanasios-api.menazak-lab.workers.dev';
const KEYS = { PW_PEPPER: 'p', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'o', ACCOUNT_PAD_MS: '0' };

/* every signed call Apps Script makes is kept, to be replayed into the real Worker */
function pipe(world) {
  const sent = [];
  const answer = path => options => {
    sent.push({ path, body: Buffer.from(options.payload).toString('utf8'), headers: options.headers });
    return { body: JSON.stringify({ ok: true }) };
  };
  world.web[URL_BASE + '/v1/sync/comp-live'] = answer('/v1/sync/comp-live');
  world.web[URL_BASE + '/v1/sync/store-import'] = answer('/v1/sync/store-import');
  world.properties.set('WORKER_SYNC_SECRET', SECRET);
  return sent;
}

async function workerWorld() {
  const h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ...KEYS } });
  await h.db.prepare("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'").run();
  return h;
}
const replay = (h, c) => h.call(c.path, { method: 'POST', body: c.body, headers: c.headers });

async function member(h) {
  const f = { email: `push${Date.now()}@staging.invalid`, phone: '01012340000', name: 'مينا زكريا فؤاد', birthDate: '2000-03-12' };
  const s = await h.call('/v1/account/register/start', { method: 'POST', body: f });
  const d = await h.call('/v1/account/register/verify', { method: 'POST', body: { pendingId: s.body.pendingId, code: s.body.testCode } });
  return (await h.call('/v1/account/signin', { method: 'POST', body: { email: f.email, password: d.body.password } })).body.session.token;
}

test('finalize on Apps Script → the signed push → the Worker stores it → an account plays with the real key', async () => {
  const world = compWorld();
  const call = adminApi(world);
  const made = scoredComp(call, {});
  const comp = made.id || made.comp.id;
  publish(world, call);
  const sent = pipe(world);

  // off until the content writer is the Worker: nothing leaves
  call('apiCompClose', comp, true);
  assert.equal(sent.length, 0);

  world.properties.set('CONTENT_WRITER', 'worker');
  call('apiCompClose', comp, true);
  assert.equal(sent.length, 1, 'a close (or reopen) pushes');
  const body = JSON.parse(sent[0].body);
  assert.equal(body.comps.length, 1);
  assert.equal(body.comps[0].compId, comp);
  assert.ok(body.comps[0].def.questions.length > 0);
  assert.ok(body.comps[0].def.questions.some(q => q.correct !== null && q.correct !== undefined && q.correct !== ''), 'the key goes: the Worker grades');

  const h = await workerWorld();
  const stored = await replay(h, sent[0]);
  assert.equal(stored.status, 200, JSON.stringify(stored.body));
  const live = await h.db.prepare('SELECT * FROM comp_live').first();
  assert.equal(live.comp_id, comp);

  const token = await member(h);
  const auth = { authorization: 'Bearer ' + token };
  const clientKeyValue = 'pushtest-key-000001';
  const start = await h.call('/v1/comp/start', { method: 'POST', headers: auth, body: { slug: body.comps[0].slug, clientKey: clientKeyValue } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.ok(!JSON.stringify(start.body).includes('"correct"'));
  const answers = Object.fromEntries(body.comps[0].def.questions.filter(q => q.type === 'single' || q.type === 'truefalse').map(q => [q.id, q.correct]));
  const required = body.comps[0].def.questions.filter(q => q.required && !(q.id in answers));
  for (const q of required) answers[q.id] = q.type === 'multi' ? q.correct : q.type === 'number' ? String(q.correct) : 'إجابة';
  const submit = await h.call('/v1/comp/submit', { method: 'POST', headers: auth, body: { token: start.body.attempt.token, clientKey: clientKeyValue, answers } });
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  assert.ok(submit.body.result.status === 'graded' || submit.body.result.status === 'pending_review');
  const score = (await h.db.prepare('SELECT score FROM submissions').first()).score;
  assert.ok(score > 0, 'graded with the pushed key');

  // «اعتماد النتائج» on Apps Script reaches the Worker and releases
  call('apiCompFinalize', comp, true);
  assert.equal(sent.length, 2);
  assert.ok(JSON.parse(sent[1].body).comps[0].finalizedAt);
  await new Promise(r => setTimeout(r, 2));
  assert.equal((await replay(h, sent[1])).status, 200);
  await compReleaseTick(h.env, Date.now() + 60000);
  assert.ok((await h.db.prepare('SELECT finalized_at FROM comp_live').first()).finalized_at);
});

test('the seed: every live competition and the prizes, as the Worker accepts them', async () => {
  const world = compWorld();
  const call = adminApi(world);
  scoredComp(call, {});
  publish(world, call);
  call('apiCompSettings', { registry: true });
  call('apiCompSettings', { registry: true, wallet: true });
  call('apiCompSettings', { registry: true, wallet: true, shop: true });
  const item = call('apiShopItemSave', { name: 'كتاب هدية', description: 'وصف', cost: 50, stock: 3, perPerson: 1, category: '', order: 1, active: true });
  assert.ok(item);
  const sent = pipe(world);
  world.properties.set('CONTENT_WRITER', 'worker');
  world.as(ADMIN).gs.workerRuntimeSeed();
  world.as('');
  assert.deepEqual(sent.map(c => c.path), ['/v1/sync/comp-live', '/v1/sync/store-import']);
  const h = await workerWorld();
  assert.equal((await replay(h, sent[0])).status, 200);
  await new Promise(r => setTimeout(r, 2));
  const imported = await replay(h, sent[1]);
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  const row = await h.db.prepare('SELECT * FROM store_items').first();
  assert.deepEqual([row.name, row.cost, row.stock, row.per_person], ['كتاب هدية', 50, 3, 1]);
});

test('the one-writer switch: COMP_RUNTIME = worker closes the public actions on Apps Script; every other answer stays', () => {
  const world = compWorld();
  const call = adminApi(world);
  const made = scoredComp(call, {});
  publish(world, call);
  const slug = made.slug || made.comp.slug;
  const open = pub(world, 'compStart', { slug, clientKey: clientKey() });
  assert.notEqual(open.code, 'disabled');
  world.properties.set('COMP_RUNTIME', 'worker');
  for (const [fn, arg] of [['compStart', { slug, clientKey: clientKey() }], ['compCode', { code: 'ATH-K7P2-9QXM' }], ['portalMe', { ptoken: 'pt1.a.b' }], ['shopRedeem', { ptoken: 'pt1.a.b', itemId: 'i-00000000', requestKey: 'abcdefgh12345678' }]]) {
    const r = pub(world, fn, arg);
    assert.equal(r.ok, false, fn);
    assert.equal(r.code, 'disabled', fn);
  }
});
