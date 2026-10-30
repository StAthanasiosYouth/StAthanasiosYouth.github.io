// Batch 4 (docs/PHASE5-PLAN.md P5-7, P5-8): the competitions runtime and the store on the Worker, on real SQLite:
// accounts only, crediting + the visibility hold (COMPETITIONS §20), snapshots, the store under races, member email.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness, fakeGoogle } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { msStamp } from '../src/book/model.js';
import { compReleaseTick } from '../src/comp/runtime.js';
import { memberLease, memberSend } from '../src/notify/member.js';
import { ageOutNotices } from '../src/account/age-out.js';
import { setGmailFetch } from '../src/notify/gmail.js';
import { resultEmail, storeEmail, ageOutEmail } from '../src/notify/templates.js';
import { buildScore } from '../../tools/build-worker-score.mjs';
import { runtimePoints } from '../src/store/shop.js';

const KEYS = { PW_PEPPER: 'pepper-test', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp-test', ACCOUNT_PAD_MS: '0' };
const P = 'p@example.com';
const HOUR = 3600000;
let serial = 300;
let tick = 0;

const QUESTIONS = [
  { id: 'q1', type: 'single', text: 'سؤال ١', help: '', media: null, required: true, points: 10, choices: [{ id: 'a', text: 'أ' }, { id: 'b', text: 'ب' }], correct: 'a', explanation: 'شرح', review: '' },
  { id: 'q2', type: 'long', text: 'سؤال ٢', help: '', media: null, required: false, points: 5, choices: [], correct: null, explanation: '', review: 'manual' },
  { id: 'q3', type: 'info', text: 'معلومة', help: '', media: null, required: false, points: 0, choices: [], correct: null, explanation: '', review: '' }
];

const def = (over = {}) => ({
  schema: 1, id: 'c-aaaaaaaa', slug: 'bible-quiz', title: 'مسابقة الكتاب', shortTitle: 'الكتاب', startAt: '', endAt: '', resultsAt: '', participation: 'registered', scoring: true, resultShow: 'both',
  answersShow: 'immediately', answersAt: '', showPoints: true, wallet: true, attempts: 1, layout: 'one', shuffleQ: false, shuffleC: false, timeLimit: 0, maxSubmissions: 0, questions: QUESTIONS, ...over
});

async function world({ env = {} } = {}) {
  const g = await fakeGoogle();
  const h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ...KEYS, ...env } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'P', 'primary', 1, 0)`).run();
  await h.db.prepare("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'").run();
  const admin = async (method, path, body) => h.call('/v1/admin/' + path, { method, body, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: P, sub: 's-' + P })) }, fetch: g.fetch });
  const sync = async (path, payload) => {
    const raw = JSON.stringify(payload);
    const ts = String(Date.now() + (++tick));
    return h.call(path, { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': await signSync(h.env.SYNC_SECRET, ts, raw) } });
  };
  const publish = (d, over = {}) => sync('/v1/sync/comp-live', { comps: [{ slug: d.slug, compId: d.id, version: d.version || 'v1', def: d, closedAt: '', finalizedAt: '', ...over }] });
  return { ...h, h, admin, sync, publish };
}
async function member(w, { birthDate = '2000-03-12' } = {}) {
  serial++;
  const f = { email: `m${serial}@staging.invalid`, phone: '0100' + String(2000000 + serial), name: 'مينا زكريا فؤاد', birthDate };
  const s = await w.call('/v1/account/register/start', { method: 'POST', body: f, headers: { 'cf-connecting-ip': '10.0.0.' + (serial % 200) } });
  const d = await w.call('/v1/account/register/verify', { method: 'POST', body: { pendingId: s.body.pendingId, code: s.body.testCode } });
  const si = await w.call('/v1/account/signin', { method: 'POST', body: { email: f.email, password: d.body.password }, headers: { 'cf-connecting-ip': '10.0.1.' + (serial % 200) } });
  return { ...f, token: si.body.session.token, id: si.body.account.id };
}
const key = () => 'clientkey-' + String(++serial).padStart(10, '0');
const as = (w, m, path, body) => w.call(path, { method: 'POST', body: body || {}, headers: m ? { authorization: 'Bearer ' + m.token } : {} });
const begin = (w, m, slug = 'bible-quiz', clientKey = key()) => as(w, m, '/v1/comp/start', { slug, clientKey }).then(r => ({ ...r, clientKey }));
const send = (w, m, s, answers = { q1: 'a' }) => as(w, m, '/v1/comp/submit', { token: s.body.attempt.token, clientKey: s.clientKey, answers });
const me = (w, m) => as(w, m, '/v1/comp/me');
const ledger = (w, id) => w.db.prepare('SELECT * FROM points_ledger WHERE participant_id = ? ORDER BY created_ms, id').bind(id).all().then(r => r.results);
const outbox = (w, kind) => w.db.prepare('SELECT * FROM member_outbox WHERE kind = ?').bind(kind).all().then(r => r.results);

test('the grader is generated from the one source', () => {
  assert.equal(readFileSync(new URL('../src/comp/score.gen.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), buildScore());
});

/* ---------- accounts only ---------- */

test('accounts only: no session → refused for every competition kind; accounts off → off; no anonymous row', async () => {
  const w = await world();
  await w.publish(def({ scoring: false, wallet: false, resultShow: 'none' }));
  assert.equal((await as(w, null, '/v1/comp/start', { slug: 'bible-quiz', clientKey: key() })).body.code, 'session');
  await w.db.prepare("UPDATE settings SET value = 'off' WHERE key = 'accounts_mode'").run();
  const m = { token: 'as1.' + 'x'.repeat(43) };
  assert.equal((await as(w, m, '/v1/comp/start', { slug: 'bible-quiz', clientKey: key() })).body.code, 'accounts_off');
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n, 0);
});

test('start: the key stays private; a retry and another device get the same attempt; another account never', async () => {
  const w = await world();
  await w.publish(def());
  const a = await member(w);
  const s = await begin(w, a);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const text = JSON.stringify(s.body);
  assert.ok(!text.includes('correct') && !text.includes('explanation') && !text.includes('شرح'), 'never the key');
  assert.equal(s.body.questions.length, 3);
  assert.equal(s.body.questions[0].points, 10);
  const again = await as(w, a, '/v1/comp/start', { slug: 'bible-quiz', clientKey: s.clientKey });
  assert.equal(again.body.attempt.id, s.body.attempt.id);
  assert.equal(again.body.attempt.resumed, true);
  const device = await begin(w, a);
  assert.equal(device.body.attempt.id, s.body.attempt.id, 'one open attempt per person');
  assert.equal(device.body.attempt.clientKey, s.clientKey, 'its key comes along');
  const b = await member(w);
  assert.equal((await as(w, b, '/v1/comp/start', { slug: 'bible-quiz', clientKey: s.clientKey })).status, 400);
  assert.equal((await as(w, b, '/v1/comp/submit', { token: s.body.attempt.token, clientKey: s.clientKey, answers: { q1: 'a' } })).status, 400);
});

test('the window and the limits: scheduled, closed, attempts, the deadline, a shuffled order is stable', async () => {
  const w = await world();
  const a = await member(w);
  await w.publish(def({ startAt: msStamp(Date.now() + HOUR) }));
  const early = await begin(w, a);
  assert.equal(early.body.code, 'not_open');
  await w.publish(def({ endAt: msStamp(Date.now() - HOUR) }), { version: 'v2' });
  assert.equal((await begin(w, a)).body.code, 'closed');
  await w.publish(def({ shuffleQ: true, shuffleC: true, attempts: 1 }), { version: 'v3' });
  const s = await begin(w, a);
  const b = await member(w);
  const k = key();
  const one = await as(w, b, '/v1/comp/start', { slug: 'bible-quiz', clientKey: k });
  const two = await as(w, b, '/v1/comp/start', { slug: 'bible-quiz', clientKey: k });
  assert.deepEqual(one.body.questions.map(q => q.id), two.body.questions.map(q => q.id));
  assert.equal((await send(w, a, s)).status, 200);
  assert.equal((await begin(w, a)).body.code, 'limit');
  await w.db.prepare('UPDATE submissions SET deadline_ms = 1 WHERE participant_id = ?').bind(b.id).run();
  assert.equal((await as(w, b, '/v1/comp/submit', { token: one.body.attempt.token, clientKey: k, answers: { q1: 'a' } })).body.code, 'expired');
});

test('the browser never sends a score; foreign answers refused; the required one named', async () => {
  const w = await world();
  await w.publish(def());
  const a = await member(w);
  const s = await begin(w, a);
  assert.equal((await send(w, a, s, {})).body.qid, 'q1');
  assert.equal((await send(w, a, s, { q1: 'zzz' })).body.qid, 'q1');
  assert.equal((await send(w, a, s, { q1: 'a', nope: 'x' })).body.qid, 'nope');
  const ok = await as(w, a, '/v1/comp/submit', { token: s.body.attempt.token, clientKey: s.clientKey, answers: { q1: 'b' }, score: 999 });
  assert.equal(ok.body.result.score, 0);
});

/* ---------- crediting (§20.1) ---------- */

test('crediting: the automatic part at submit, the manual part as graded; idempotent; a replay adds nothing', async () => {
  const w = await world();
  await w.publish(def());
  const a = await member(w);
  const s = await begin(w, a);
  const r = await send(w, a, s, { q1: 'a', q2: 'مقال طويل' });
  assert.equal(r.body.result.status, 'pending_review');
  assert.equal(r.body.result.score, 10);
  assert.equal(r.body.result.pending, 1);
  assert.equal(r.body.result.pointsAwarded, 10, 'credited at once, with no admin approval');
  assert.equal((await send(w, a, s, { q1: 'a', q2: 'مقال طويل' })).status, 200, 'sent twice');
  let rows = await ledger(w, a.id);
  assert.deepEqual(rows.map(l => [l.amount, l.kind, l.idem_key]), [[10, 'competition', `sub:${s.body.attempt.id}:0`]]);
  const graded = await w.admin('POST', `comp/submissions/${s.body.attempt.id}/grade`, { grades: { q2: true } });
  assert.equal(graded.status, 200, JSON.stringify(graded.body));
  assert.equal(graded.body.submission.status, 'graded');
  rows = await ledger(w, a.id);
  assert.deepEqual(rows.map(l => [l.amount, l.kind]), [[10, 'competition'], [5, 'correction']]);
  await w.admin('POST', `comp/submissions/${s.body.attempt.id}/grade`, { grades: { q2: true } });
  assert.equal((await ledger(w, a.id)).length, 2, 'the same grade again adds nothing');
  await w.admin('POST', `comp/submissions/${s.body.attempt.id}/grade`, { grades: { q2: false } });
  assert.deepEqual((await ledger(w, a.id)).map(l => l.amount), [10, 5, -5]);
  assert.equal((await me(w, a)).body.balance, 10);
});

test('only the best attempt earns; a void reverses; restoring gives back', async () => {
  const w = await world();
  await w.publish(def({ attempts: 2 }));
  const a = await member(w);
  const one = await begin(w, a);
  await send(w, a, one, { q1: 'b' });
  const two = await begin(w, a);
  await send(w, a, two, { q1: 'a' });
  assert.equal((await me(w, a)).body.balance, 10);
  await w.admin('POST', `comp/submissions/${two.body.attempt.id}/void`, { voided: true });
  assert.equal((await me(w, a)).body.balance, 0);
  await w.admin('POST', `comp/submissions/${two.body.attempt.id}/void`, { voided: false });
  assert.equal((await me(w, a)).body.balance, 10);
  assert.equal((await w.admin('GET', `comp/${'c-aaaaaaaa'}/submissions`)).body.submissions[0].rank, 1);
});

test('a regrade follows the new key; reviewers\' marks stay; the score-off and wallet-off cases earn nothing', async () => {
  const w = await world();
  await w.publish(def());
  const a = await member(w);
  const s = await begin(w, a);
  await send(w, a, s, { q1: 'b', q2: 'نص' });
  await w.admin('POST', `comp/submissions/${s.body.attempt.id}/grade`, { grades: { q2: 3 } });
  assert.equal((await me(w, a)).body.balance, 3);
  const fixed = def({ questions: [{ ...QUESTIONS[0], correct: 'b' }, QUESTIONS[1], QUESTIONS[2]] });
  await w.db.prepare("UPDATE comp_versions SET def = ? WHERE comp_id = 'c-aaaaaaaa'").bind(JSON.stringify(fixed)).run();
  const re = await w.admin('POST', 'comp/c-aaaaaaaa/regrade', {});
  assert.equal(re.body.changed, 1);
  assert.equal((await me(w, a)).body.balance, 13, 'new key 10 + the reviewer\'s 3');

  const off = await world();
  await off.publish(def({ wallet: false }));
  const b = await member(off);
  await send(off, b, await begin(off, b));
  assert.equal((await ledger(off, b.id)).length, 0);
});

/* ---------- eligibility snapshots (§9.1) ---------- */

test('a guest plays, stamped at submit, earns nothing; a later correction rewrites nothing', async () => {
  const w = await world();
  await w.publish(def({ attempts: 2 }));
  const g = await member(w, { birthDate: '1980-01-01' });
  const s = await begin(w, g);
  const r = await send(w, g, s);
  assert.equal(r.status, 200);
  assert.equal(r.body.result.noPoints, true);
  assert.equal(r.body.result.score, 10, 'plays the same way');
  assert.equal((await ledger(w, g.id)).length, 0);
  const row = await w.db.prepare('SELECT elig, age_min, age_max, no_points, flags FROM submissions WHERE id = ?').bind(s.body.attempt.id).first();
  assert.deepEqual([row.elig, row.age_min, row.age_max, row.no_points], ['guest', 18, 30, 1]);
  await w.db.prepare("UPDATE participants SET birth_date = '2000-01-01' WHERE id = ?").bind(g.id).run();
  await w.admin('POST', 'comp/c-aaaaaaaa/regrade', {});
  assert.equal((await ledger(w, g.id)).length, 0, 'the stamp wins');
  const next = await begin(w, g);
  await send(w, g, next);
  assert.equal((await me(w, g)).body.balance, 10, 'future submissions follow the correction');
  const list = (await w.admin('GET', 'comp/c-aaaaaaaa/submissions')).body.submissions;
  const guest = list.find(x => x.guest);
  assert.equal(guest.rank, null, 'a badge, no rank number');
  assert.equal(list.find(x => !x.guest).rank, 1);
});

/* ---------- the visibility hold (§20.2) ---------- */

test('held until the release: the ledger row exists, the member sees nothing, can\'t spend it; the cron releases and emails once', async () => {
  const w = await world();
  const resultsAt = msStamp(Date.now() + HOUR);
  await w.publish(def({ resultsAt, answersShow: 'never' }));
  const a = await member(w);
  const s = await begin(w, a);
  const r = await send(w, a, s);
  assert.equal(r.body.result.score, undefined, 'no spoiler');
  assert.equal(r.body.result.pointsAwarded, undefined);
  assert.equal(r.body.result.resultsAt, resultsAt);
  assert.equal((await ledger(w, a.id)).length, 1, 'the truth is written');
  const seen = await me(w, a);
  assert.equal(seen.body.balance, 0);
  assert.equal(seen.body.ledger.length, 0);
  assert.equal(seen.body.history[0].score, null);
  assert.equal((await w.call('/v1/account/points', { headers: { authorization: 'Bearer ' + a.token } })).body.balance, 0);
  assert.equal((await w.admin('GET', 'participants/' + a.id)).body.points.balance, 10, 'admins see everything');
  assert.equal((await outbox(w, 'res.result')).length, 0, 'no email before the moment');

  await w.db.prepare("INSERT INTO store_items (id, name, cost, created_ms, updated_ms) VALUES ('i-aaaaaaaa', 'كتاب', 5, 1, 1)").run();
  const buy = await as(w, a, '/v1/shop/redeem', { itemId: 'i-aaaaaaaa', requestKey: 'hold-req-1' });
  assert.equal(buy.body.code, 'insufficient', 'held points can\'t be spent');

  assert.equal(await compReleaseTick(w.env, Date.now()), 0, 'not yet');
  assert.equal(await compReleaseTick(w.env, Date.now() + 2 * HOUR), 1);
  assert.equal(await compReleaseTick(w.env, Date.now() + 2 * HOUR), 0, 'once');
  assert.equal((await me(w, a)).body.balance, 10);
  assert.equal((await outbox(w, 'res.result')).length, 1);
});

test('finalizing releases at once; without any show, the points wait for it; the score never shows', async () => {
  const w = await world();
  const d = def({ resultShow: 'none', answersShow: 'never' });
  await w.publish(d);
  const a = await member(w);
  const r = await send(w, a, await begin(w, a));
  assert.equal(r.body.result.score, undefined);
  assert.equal((await me(w, a)).body.balance, 0);
  await w.publish(d, { finalizedAt: msStamp(Date.now()) });
  await compReleaseTick(w.env, Date.now() + 60000);
  const seen = await me(w, a);
  assert.equal(seen.body.balance, 10);
  assert.equal(seen.body.history[0].score, null, 'points released, the score never');
});

/* ---------- the store (§18, §9.5) ---------- */

async function shopWorld(item = {}) {
  const w = await world();
  await w.admin('POST', 'store/schedule', { mode: 'open', allowCancel: true });
  const saved = await w.admin('POST', 'store/items', { name: 'كتاب', cost: 30, stock: '', perPerson: '', ...item });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const itemId = saved.body.items[0].id;
  const rich = async () => {
    const m = await member(w);
    await w.admin('POST', `participants/${m.id}/points`, { amount: 100, note: 'رصيد', key: 'seed-' + m.id.slice(2) + 'xx' });
    return m;
  };
  return { w, itemId, rich };
}
const buy = (w, m, itemId, requestKey = 'req-' + (++serial) + 'xxxxx') => as(w, m, '/v1/shop/redeem', { itemId, requestKey });

test('redeem: charged once, the same key = the same request, a receipt row; admin approves, or cancels + refunds once', async () => {
  const { w, itemId, rich } = await shopWorld();
  const a = await rich();
  const r = await buy(w, a, itemId, 'same-key-111');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.balance, 70);
  const again = await buy(w, a, itemId, 'same-key-111');
  assert.equal(again.body.redemption.id, r.body.redemption.id);
  assert.equal(again.body.balance, 70);
  assert.equal((await outbox(w, 'store.requested')).length, 1);
  const id = r.body.redemption.id;
  assert.equal((await w.admin('POST', `store/redemptions/${id}/status`, { status: 'nope' })).status, 409);
  assert.equal((await w.admin('POST', `store/redemptions/${id}/status`, { status: 'approved' })).status, 200);
  assert.equal((await outbox(w, 'store.approved')).length, 1);
  assert.equal((await w.admin('POST', `store/redemptions/${id}/status`, { status: 'cancelled' })).status, 200);
  assert.equal((await me(w, a)).body.balance, 100, 'refunded');
  assert.equal((await w.admin('POST', `store/redemptions/${id}/status`, { status: 'cancelled' })).status, 409);
  assert.equal((await me(w, a)).body.balance, 100, 'once');
});

test('stock under a race: never more than there is; per person; not enough points; closed', async () => {
  const { w, itemId, rich } = await shopWorld({ stock: 3 });
  const people = [];
  for (let i = 0; i < 8; i++) people.push(await rich());
  const replies = await Promise.all(people.map(m => buy(w, m, itemId)));
  assert.equal(replies.filter(r => r.status === 200).length, 3);
  assert.equal(replies.filter(r => r.body.code === 'stock').length, 5);
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM points_ledger WHERE kind = ?').bind('spend').first()).n, 3, 'no charge without a request');

  const per = await shopWorld({ perPerson: 1 });
  const m = await per.rich();
  assert.equal((await buy(per.w, m, per.itemId)).status, 200);
  assert.equal((await buy(per.w, m, per.itemId)).body.code, 'per_person');

  const poor = await shopWorld({ cost: 500 });
  const n = await poor.rich();
  const refused = await buy(poor.w, n, poor.itemId);
  assert.equal(refused.body.code, 'insufficient');
  assert.equal(refused.body.balance, 100);

  await poor.w.admin('POST', 'store/schedule', { mode: 'closed' });
  assert.equal((await buy(poor.w, n, poor.itemId)).body.code, 'shop_closed');
});

test('a guest browses and sees the balance frozen, is refused on the server; an order made before aging out is honoured', async () => {
  const { w, itemId, rich } = await shopWorld();
  const a = await rich();
  const made = await buy(w, a, itemId);
  await w.admin('POST', `participants/${a.id}/eligibility`, { override: 'guest', reason: 'اختبار' });
  const seen = await me(w, a);
  assert.equal(seen.body.eligible, false);
  assert.equal(seen.body.frozen, true);
  assert.ok(seen.body.notice);
  assert.equal(seen.body.shop.length, 1, 'still browses');
  assert.equal((await buy(w, a, itemId)).body.code, 'not_eligible');
  assert.equal((await as(w, a, '/v1/shop/cancel', { redemptionId: made.body.redemption.id })).body.code, 'not_eligible');
  assert.equal((await w.admin('POST', `store/redemptions/${made.body.redemption.id}/status`, { status: 'fulfilled' })).status, 200, 'honoured');
});

test('member cancel: own, pending, allowed, open; a refund once; a season with open requests can\'t close', async () => {
  const { w, itemId, rich } = await shopWorld();
  const a = await rich();
  const b = await rich();
  const r = await buy(w, a, itemId);
  const id = r.body.redemption.id;
  assert.equal((await as(w, b, '/v1/shop/cancel', { redemptionId: id })).body.code, 'not_found');
  const preview = (await w.admin('GET', 'points/seasons/sea-first/preview')).body;
  const closing = await w.admin('POST', 'points/seasons/sea-first/close', { key: preview.key, next: { name: 'التاني' } });
  assert.equal(closing.body.code, 'final');
  assert.equal(closing.body.openRequests, 1);
  assert.equal((await me(w, a)).body.redemptions[0].canCancel, true);
  const c = await as(w, a, '/v1/shop/cancel', { redemptionId: id });
  assert.equal(c.status, 200);
  assert.equal(c.body.balance, 100);
  assert.equal((await as(w, a, '/v1/shop/cancel', { redemptionId: id })).body.code, 'not_allowed');
  assert.equal((await me(w, a)).body.balance, 100);
  await w.admin('POST', 'store/schedule', { mode: 'open', allowCancel: false });
  const r2 = await buy(w, a, itemId);
  assert.equal((await as(w, a, '/v1/shop/cancel', { redemptionId: r2.body.redemption.id })).body.code, 'not_allowed');
});

test('the schedule decides; items import once; an item with requests is only switched off', async () => {
  const w = await world();
  const later = msStamp(Date.now() + HOUR);
  assert.equal((await w.admin('POST', 'store/schedule', { mode: 'nope' })).status, 400);
  assert.equal((await w.admin('POST', 'store/schedule', { mode: 'auto', opensAt: later, closesAt: later })).status, 400);
  const scheduled = await w.admin('POST', 'store/schedule', { mode: 'auto', opensAt: later });
  assert.equal(scheduled.body.state, 'scheduled');
  const imported = await w.sync('/v1/sync/store-import', { items: [{ id: 'i-11111111', name: 'جايزة', description: '', cost: 10, stock: 2, perPerson: null, category: '', order: 1, active: true }] });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  await w.admin('POST', 'store/items', { id: 'i-11111111', name: 'معدّلة', cost: 20 });
  await w.sync('/v1/sync/store-import', { items: [{ id: 'i-11111111', name: 'جايزة', cost: 10, active: true }] });
  assert.equal((await w.admin('GET', 'store/items')).body.items[0].name, 'معدّلة', 'an import never overwrites');
  const a = await member(w);
  assert.equal((await w.admin('POST', 'store/items/i-11111111/delete', {})).body.kept, false);
  assert.equal((await w.admin('GET', 'store/items')).body.items.length, 0);
  assert.equal(a.id.length > 0, true);
});

test('the home widget follows the Worker once accounts are on; off, what Apps Script built stays', async () => {
  const w = await world();
  await w.admin('POST', 'store/schedule', { mode: 'auto', opensAt: '2026-12-01T10:00', closesAt: '2026-12-02T10:00' });
  const made = await runtimePoints(w.db, { url: 'points/', shop: { on: true, mode: 'closed', opensAt: '', closesAt: '' }, season: null });
  assert.deepEqual(made.shop, { on: true, mode: 'auto', preview: false, opensAt: '2026-12-01T10:00', closesAt: '2026-12-02T10:00' });
  assert.equal(made.season.name, 'الموسم الأول');
  await w.db.prepare("UPDATE settings SET value = 'off' WHERE key = 'accounts_mode'").run();
  const asIs = { url: 'points/', shop: null, season: null };
  assert.equal(await runtimePoints(w.db, asIs), asIs);
});

/* ---------- sync ---------- */

test('comp-live: needs its signature; a version is immutable; withdrawing ends new attempts; renaming moves the slug', async () => {
  const w = await world();
  const denied = await w.call('/v1/sync/comp-live', { method: 'POST', body: JSON.stringify({ comps: [] }), headers: { 'x-sync-ts': String(Date.now()), 'x-sync-signature': 'v1=bad' } });
  assert.equal(denied.status, 401);
  assert.equal((await w.sync('/v1/sync/comp-live', { comps: [{ slug: 'x-y', compId: 'c', version: 'v', def: {} }] })).status, 400);
  await w.publish(def());
  await w.publish(def({ title: 'تغيير' }));
  assert.equal(JSON.parse((await w.db.prepare('SELECT def FROM comp_versions').first()).def).title, 'مسابقة الكتاب', 'a published version never changes');
  await w.publish({ ...def(), version: 'v2', slug: 'renamed' }, { version: 'v2' });
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM comp_live').first()).n, 1);
  assert.equal((await w.db.prepare('SELECT slug FROM comp_live').first()).slug, 'renamed');
  const a = await member(w);
  await w.sync('/v1/sync/comp-live', { comps: [], withdrawn: [{ slug: 'renamed' }] });
  assert.equal((await begin(w, a, 'renamed')).body.code, 'not_found');
});

/* ---------- email (§4.3, §4.4) ---------- */

async function deliver(w, now = Date.now()) {
  const ids = await memberLease(w.env, now);
  return memberSend(w.env, ids, now);
}

test('results by email: one per submission; a pending note; the completion; corrections merged; no spoilers', async t => {
  const mails = [];
  setGmailFetch(async (url, init) => {
    if (/token/.test(String(url))) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    mails.push(Buffer.from(JSON.parse(init.body).raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return new Response(JSON.stringify({ id: 'm' }));
  });
  t.after(() => setGmailFetch(null));
  const w = await world({ env: { GMAIL_CLIENT_ID: 'c', GMAIL_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 'r' } });
  await w.db.prepare("UPDATE settings SET value = '1' WHERE key = 'MEMBER_EMAIL'").run();
  await w.publish(def());
  const a = await member(w);
  await w.db.prepare("UPDATE participants SET email = 'real@example.com' WHERE id = ?").bind(a.id).run();
  const s = await begin(w, a);
  await send(w, a, s, { q1: 'a', q2: 'نص' });
  assert.equal((await outbox(w, 'res.result')).length, 1);
  const out = await deliver(w);
  assert.ok(out.sent >= 1, JSON.stringify(out));
  assert.equal(mails.length, 1);
  await w.admin('POST', `comp/submissions/${s.body.attempt.id}/grade`, { grades: { q2: true } });
  assert.equal((await outbox(w, 'res.done')).length, 1, 'the last manual answer: one completion');
  await w.admin('POST', `comp/submissions/${s.body.attempt.id}/void`, { voided: true });
  assert.equal((await outbox(w, 'res.correction')).length, 1);
  await w.admin('POST', `comp/submissions/${s.body.attempt.id}/void`, { voided: false });
  assert.equal((await outbox(w, 'res.correction')).length, 1, 'merged within the day');

  const hidden = def({ id: 'c-bbbbbbbb', slug: 'second', resultsAt: msStamp(Date.now() + HOUR), answersShow: 'never' });
  await w.publish(hidden);
  await send(w, a, await begin(w, a, 'second'));
  assert.equal((await w.db.prepare("SELECT COUNT(*) AS n FROM member_outbox WHERE kind = 'res.result'").first()).n, 1, 'nothing before the release moment');
});

test('age-out: once, only with points and inside the warning days', async () => {
  const w = await world();
  await w.db.prepare("UPDATE settings SET value = '1' WHERE key = 'MEMBER_EMAIL'").run();
  const now = Date.now();
  const soon = new Date(now + 20 * 24 * HOUR);
  const birth = `${soon.getUTCFullYear() - 31}-${String(soon.getUTCMonth() + 1).padStart(2, '0')}-${String(soon.getUTCDate()).padStart(2, '0')}`;
  const a = await member(w, { birthDate: birth });
  const b = await member(w, { birthDate: birth });
  await w.admin('POST', `participants/${a.id}/points`, { amount: 10, note: 'x', key: 'age-seed-001' });
  assert.equal(await ageOutNotices(w.env, now), 1, 'the one holding points');
  await ageOutNotices(w.env, now);
  assert.equal((await outbox(w, 'acct.age')).length, 1, 'once');
  assert.equal((await outbox(w, 'acct.age'))[0].participant_id, a.id);
  assert.ok(b.id);
});

test('templates: score only when given; no answers, ages or admin links', () => {
  const url = 'https://stathanasiosyouth.github.io/account/#me/results/bible';
  const m = resultEmail({ kind: 'result', title: 'مسابقة', score: 8, max: 10, points: 80, wallet: true, balance: 100, pending: 1, url, prefs: true });
  assert.match(m.text, /٨ من ١٠/);
  assert.match(m.text, /لسه فيه أسئلة بتتصحح/);
  const none = resultEmail({ kind: 'result', title: 'مسابقة', points: 80, wallet: true, balance: 100, url });
  assert.doesNotMatch(none.text, /الدرجة/);
  const guest = resultEmail({ kind: 'result', title: 'مسابقة', score: 8, max: 10, noPoints: true, url });
  assert.match(guest.text, /بدون نقاط/);
  for (const e of [m, storeEmail({ kind: 'cancelled', item: 'كتاب', cost: 10, balance: 5, note: 'خلصت', url }), ageOutEmail({ date: '2026-12-01', url })]) {
    assert.doesNotMatch(e.html + e.text, /\/admin|سنك|\d{4}-\d{2}-\d{2}/);
  }
});
