// Phase 1.5 step 5: the notification router (activity → outbox), its flood
// guard, grouping / dedupe, permissions and preferences, and the push claim
// with acknowledgements, retries and dead letters. Real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { activityStmt } from '../src/lib/activity.js';
import { route } from '../src/notify/router.js';
import { scheduled } from '../src/scheduled.js';
import { MAX_ATTEMPTS } from '../src/notify/claim.js';
import { typeOf, allTypes, messageOf } from '../src/notify/catalog.js';

const P = 'p@example.com', M = 'm@example.com', B = 'b@example.com';
const set = (h, key, value) => h.db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
const act = (h, a) => activityStmt(h.db, { actor: M, actorName: 'M', ...a }).run();
const outbox = h => h.db.prepare('SELECT * FROM notify_outbox ORDER BY created_ms, recipient, channel').all().then(r => r.results);
const notified = (h, id) => h.db.prepare('SELECT notified FROM activity WHERE id = ?').bind(id).first('notified');

async function world() {
  const h = harness();
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'مينا', 'primary', 1, 0), ('${M}', 'مرقس', 'admin', 1, 0), ('${B}', 'بيشوي', 'admin', 1, 0)`).run();
  return h;
}
async function on(h, now = Date.now()) {
  await set(h, 'NOTIFY_ROUTER', '1');
  await route(h.env, now - 1);             // the first tick stamps NOTIFY_SINCE
}
async function claim(h, ack = [], ts = Date.now()) {
  const raw = JSON.stringify({ v: 1, ack });
  return h.call('/v1/sync/notify-claim', { method: 'POST', body: raw, headers: { 'x-sync-ts': String(ts), 'x-sync-signature': await signSync('sync-test-secret', String(ts), raw) } });
}

test('router off: nothing routed; switched on: the waiting backlog is marked, never sent (no flood)', async () => {
  const h = await world();
  for (let i = 0; i < 30; i++) await act(h, { id: 'act-old' + String(i).padStart(8, '0'), action: 'publish', entityType: 'site' });
  assert.deepEqual(await route(h.env), { off: true });
  assert.equal((await outbox(h)).length, 0);
  await set(h, 'NOTIFY_ROUTER', '1');
  const first = await route(h.env);
  assert.equal(first.backlog, 30);
  assert.ok(await h.db.prepare("SELECT value FROM settings WHERE key = 'NOTIFY_SINCE'").first('value'));
  assert.equal(await notified(h, 'act-old00000000'), 3);
  assert.equal((await route(h.env)).routed, 0);
  assert.equal((await outbox(h)).length, 0, 'not one notification for the backlog');
});

test('router: the right people (permission holders, never the actor; critical always to the Primary); routine = nothing by default', async () => {
  const h = await world();
  await on(h);
  await act(h, { id: 'act-pub000000001', action: 'publish', entityType: 'site' });
  await act(h, { id: 'act-acc000000001', action: 'accounts.add', entityType: 'admin', entityId: 'x@example.com', summary: 'ضاف «x»', severity: 'critical' });
  await act(h, { id: 'act-upd000000001', action: 'update', entityType: 'news', entityId: 'n1', summary: 'عدّل' });
  await act(h, { id: 'act-dia000000001', action: 'diag.echo' });
  const r = await route(h.env);
  assert.deepEqual([r.routed, r.skipped], [2, 2]);
  const rows = await outbox(h);
  const who = kind => rows.filter(x => x.kind === kind).map(x => x.recipient + ':' + x.channel).sort();
  assert.deepEqual(who('publish'), [B + ':push', P + ':push'], 'everyone holding publish.publish but the actor');
  assert.deepEqual(who('accounts.add'), [P + ':push'], 'accounts.manage: the Primary only (switch off)');
  assert.equal(rows.find(x => x.kind === 'accounts.add').level, 'critical');
  assert.equal(rows.some(x => x.channel === 'email'), false, 'NOTIFY_EMAIL off: no email rows');
  assert.equal(await notified(h, 'act-upd000000001'), 2);
  assert.equal(await notified(h, 'act-dia000000001'), 2);
});

test('router: grants decide while enforcing; the type list (named / exclude); own preferences unless locked', async () => {
  const h = await world();
  await on(h);
  await set(h, 'PERMS_ENFORCE', '1');
  await h.db.prepare("INSERT INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, 'publish.publish', 'all', 't', 0)").bind(B).run();
  await act(h, { id: 'act-pub000000002', action: 'publish', entityType: 'site' });
  await route(h.env);
  assert.deepEqual((await outbox(h)).map(x => x.recipient).sort(), [B, P].sort(), 'M lacks publish.publish');

  await h.db.prepare("INSERT INTO notify_prefs (email, type, channel, mode, updated_at) VALUES (?, 'publish', 'push', 'off', 0)").bind(B).run();
  await act(h, { id: 'act-pub000000003', action: 'publish', entityType: 'site', at: Date.now() + 1 });
  await route(h.env);
  assert.equal((await outbox(h)).filter(x => x.recipient === B).length, 1, 'B turned publish pushes off');

  await h.db.prepare("INSERT INTO notify_settings (type, email_mode, push, recipients, locked, updated_at) VALUES ('publish', 'off', 1, ?, 1, 0)").bind(JSON.stringify({ mode: 'named', include: [B] })).run();
  await act(h, { id: 'act-pub000000004', action: 'publish', entityType: 'site', at: Date.now() + 2 });
  await route(h.env);
  const last = (await outbox(h)).filter(x => JSON.parse(x.activity_ids).includes('act-pub000000004'));
  assert.deepEqual(last.map(x => x.recipient), [B], 'named list, and locked: B\'s own «off» does not count');
});

test('router: new bookings of one event group in 10 minutes (one row, several ids); once sent, the next starts a new row', async () => {
  const h = await world();
  await on(h);
  const base = Math.ceil(Date.now() / 600000) * 600000 + 1000;   // a fresh 10-minute window, after NOTIFY_SINCE
  await h.db.prepare("INSERT INTO bookings (id, ref, event_id, source, status, name, phone, requested, seats_requested, quoted_total, price_rev, request_key, created_at, created_ms, updated_ms) VALUES ('bkg-aaaaaa', 'B-AAAA1', 'evt-1', 'site', 'pending', 'سارة', '01000000000', '{}', 1, 0, 'r', 'rk1', '', 0, 0), ('bkg-bbbbbb', 'B-BBBB2', 'evt-1', 'site', 'pending', 'مينا', '01000000001', '{}', 1, 0, 'r', 'rk2', '', 0, 0)").run();
  const nb = (id, bkg, at) => activityStmt(h.db, { id, at, actor: 'visitor', actorName: 'زائر', action: 'booking.new', entityType: 'booking', entityId: bkg, entityTitle: 'B-X', summary: 'رحلة إسكندرية · 2 أفراد' }).run();
  await nb('act-bn0000000001', 'bkg-aaaaaa', base);
  await nb('act-bn0000000002', 'bkg-bbbbbb', base + 60000);
  await route(h.env, base + 120000);
  let rows = (await outbox(h)).filter(x => x.recipient === P);
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0].activity_ids), ['act-bn0000000001', 'act-bn0000000002']);
  await h.db.prepare("UPDATE notify_outbox SET status = 'sent'").run();
  await nb('act-bn0000000003', 'bkg-aaaaaa', base + 180000);
  await route(h.env, base + 240000);
  rows = (await outbox(h)).filter(x => x.recipient === P);
  assert.equal(rows.length, 2, 'a new row after the sent one');
  // the message: counts and the event, never a name
  const msg = messageOf(typeOf({ action: 'booking.new' }), [{ id: 'a', action: 'booking.new', summary: 'رحلة إسكندرية · 2 أفراد', entity_title: 'B-1' }, { id: 'b', action: 'booking.new', summary: 'رحلة إسكندرية · 1 أفراد' }]);
  assert.equal(msg.title, '٢ حجوزات جديدة – رحلة إسكندرية');
  assert.doesNotMatch(JSON.stringify(msg), /سارة|010/);
});

test('router: email channel (switch on) — immediate for important, a daily summary row when chosen', async () => {
  const h = await world();
  await on(h);
  await set(h, 'NOTIFY_EMAIL', '1');
  await h.db.prepare("INSERT INTO notify_prefs (email, type, channel, mode, updated_at) VALUES (?, 'publish', 'email', 'summary', 0)").bind(B).run();
  await act(h, { id: 'act-pub000000005', action: 'publish', entityType: 'site' });
  await act(h, { id: 'act-pub000000006', action: 'publish', entityType: 'site', at: Date.now() + 1 });
  await route(h.env);
  const rows = await outbox(h);
  assert.equal(rows.filter(x => x.recipient === P && x.channel === 'email').length, 2, 'immediate, one per activity');
  const summary = rows.filter(x => x.recipient === B && x.channel === 'email');
  assert.equal(summary.length, 1);
  assert.equal(summary[0].status, 'deferred');
  assert.equal(summary[0].kind, 'summary');
  assert.deepEqual(JSON.parse(summary[0].activity_ids), ['act-pub000000005', 'act-pub000000006']);
  assert.ok(summary[0].next_ms > Date.now());
});

test('claim: signed; router off → nothing; on → leased items with messages, critical first; acks; retries; dead letter → critical alarm (once)', async () => {
  const h = await world();
  await on(h);
  await act(h, { id: 'act-pub000000007', action: 'publish', entityType: 'site', summary: 'نشر الموقع' });
  await act(h, { id: 'act-acc000000002', action: 'accounts.add', entityType: 'admin', summary: 'ضاف «x»', at: Date.now() + 1 });
  await route(h.env);

  const bad = await h.call('/v1/sync/notify-claim', { method: 'POST', body: '{}', headers: { 'x-sync-ts': String(Date.now()), 'x-sync-signature': 'v1=' + '0'.repeat(64) } });
  assert.equal(bad.status, 401);
  let t = Date.now();
  const r1 = await claim(h, [], t++);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.router, true);
  assert.equal(r1.body.items[0].level, 'critical', 'critical first');
  const pub = r1.body.items.find(i => i.recipient === B);
  assert.equal(pub.title, 'مرقس نشر الموقع');
  assert.match(pub.url, /^\/admin\/#activity\/act-/);
  assert.equal((await claim(h, [], t++)).body.items.length, 0, 'leased: not handed out twice');

  const okAck = r1.body.items.filter(i => i !== pub).map(i => ({ id: i.id, claim: i.claim, ok: true }));
  await claim(h, [...okAck, { id: pub.id, claim: pub.claim, ok: false, reason: 'error' }], t++);
  let rows = await outbox(h);
  assert.ok(rows.filter(x => x.id !== pub.id).every(x => x.status === 'sent'));
  const failed = rows.find(x => x.id === pub.id);
  assert.equal(failed.status, 'failed');
  assert.ok(failed.next_ms > Date.now());

  // a stale answer (an old claim id) changes nothing
  await claim(h, [{ id: pub.id, claim: 'clm-000000000000', ok: true }], t++);
  assert.equal((await outbox(h)).find(x => x.id === pub.id).status, 'failed');

  // keeps failing → dead after MAX_ATTEMPTS, one critical «notify.failed» row
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    await h.db.prepare('UPDATE notify_outbox SET next_ms = 0 WHERE id = ?').bind(pub.id).run();
    const r = await claim(h, [], t++);
    const item = r.body.items.find(x => x.id === pub.id);
    await claim(h, [{ id: item.id, claim: item.claim, ok: false, reason: 'error' }], t++);
  }
  rows = await outbox(h);
  assert.equal(rows.find(x => x.id === pub.id).status, 'dead');
  const alarm = await h.db.prepare("SELECT severity, notified FROM activity WHERE action = 'notify.failed'").all();
  assert.equal(alarm.results.length, 1);
  assert.equal(alarm.results[0].severity, 'critical');
  await route(h.env);
  assert.ok((await outbox(h)).some(x => x.kind === 'notify.failed' && x.recipient === P && x.channel === 'push'), 'the alarm goes to the Primary by push');
});

test('claim: an unanswered claim comes back after its lease; activity gone → dismissed; router off → no items', async () => {
  const h = await world();
  await on(h);
  await act(h, { id: 'act-pub000000008', action: 'publish', entityType: 'site' });
  await route(h.env);
  let t = Date.now();
  const first = (await claim(h, [], t++)).body.items;
  await h.db.prepare('UPDATE notify_outbox SET next_ms = 0').run();          // the lease ran out (no answer)
  const again = (await claim(h, [], t++)).body.items;
  assert.deepEqual(again.map(i => i.id).sort(), first.map(i => i.id).sort());
  assert.notEqual(again[0].claim, first[0].claim);

  await h.db.prepare('UPDATE notify_outbox SET next_ms = 0').run();
  await h.db.prepare("DELETE FROM activity WHERE id = 'act-pub000000008'").run();
  assert.equal((await claim(h, [], t++)).body.items.length, 0);
  assert.ok((await outbox(h)).every(x => x.status === 'dismissed'));

  await set(h, 'NOTIFY_ROUTER', '0');
  assert.deepEqual((await claim(h, [], t++)).body, { ok: true, router: false, items: [] });
});

test('cron: the minute routes; the daily keeps the outbox 30 days (never a waiting critical row)', async () => {
  const h = await world();
  await on(h);
  await act(h, { id: 'act-pub000000009', action: 'publish', entityType: 'site' });
  await scheduled({ cron: '* * * * *', scheduledTime: Date.now() + 1000 }, h.env);
  assert.equal((await outbox(h)).length, 2);
  const old = Date.now() - 31 * 864e5;
  await h.db.prepare("UPDATE notify_outbox SET created_ms = ?, status = 'sent'").bind(old).run();
  await h.db.prepare("INSERT INTO notify_outbox (id, dedupe_key, recipient, channel, kind, activity_ids, status, created_ms, level) VALUES ('ntf-c1', 'k1', ?, 'email', 'migrate', '[]', 'deferred_quota', ?, 'critical')").bind(P, old).run();
  await scheduled({ cron: '17 1 * * *', scheduledTime: Date.now() }, h.env);
  assert.deepEqual((await outbox(h)).map(x => x.id), ['ntf-c1']);
});

test('catalog: every listed type has a level and a catalog permission; technical rows are not notifications', () => {
  const types = allTypes();
  assert.ok(types.length > 40);
  for (const t of types) assert.ok(['critical', 'important', 'routine'].includes(t.level) && /^[a-z]+\.[a-z_]+$/.test(t.perm), t.key);
  assert.equal(typeOf({ action: 'diag.echo' }), null);
  assert.equal(typeOf({ action: 'create', entity_type: 'news' }).level, 'important');
  assert.equal(typeOf({ action: 'update', entity_type: 'news' }).level, 'routine');
});
