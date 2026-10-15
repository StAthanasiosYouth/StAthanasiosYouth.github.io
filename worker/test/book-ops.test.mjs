// Booking pilot operations: phone retention (12 months), edit locks, the
// grouped «new bookings» feed for the admin push, Turnstile on submit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWorld, eventJson, pay } from './book-helpers.mjs';
import { msStamp } from '../src/book/model.js';
import { blankPhones, RETENTION } from '../src/scheduled.js';
import { claimNews, NEWS_COOLDOWN_MS } from '../src/book/news.js';
import { LOCK_TTL_MS } from '../src/book/locks.js';
import { signSync } from '../src/lib/sync.js';
import { SITEVERIFY } from '../src/book/turnstile.js';

const DAY = 864e5;
const B = (id, action = '') => '/v1/admin/book/bookings/' + id + (action ? '/' + action : '');
const phone = () => '010' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

async function pending(w, over = {}) {
  const r = await w.submit({ phone: phone(), ...over });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return w.db.prepare('SELECT id, version, event_id FROM bookings WHERE ref = ?').bind(r.body.ref).first();
}

/* ---------------- retention ---------------- */

test('retention: phones blanked 12 months after the event ends, nothing else touched, once', async () => {
  const w = await bookWorld();
  const a = await pending(w);
  const b = await pending(w);
  const end = (await w.db.prepare('SELECT end_ms FROM event_cfg WHERE id = ?').bind('evt-alex01').first()).end_ms;

  assert.equal(await blankPhones(w.env, end + RETENTION.phoneMs - DAY), 0, 'not yet: a day short of 12 months');
  assert.equal((await w.db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE phone <> ''").first()).n, 2);

  const at = end + RETENTION.phoneMs + 1000;
  assert.equal(await blankPhones(w.env, at), 2);
  const rows = (await w.db.prepare('SELECT phone, phone_blanked_ms, name, quoted_total, status FROM bookings').all()).results;
  for (const r of rows) {
    assert.equal(r.phone, '');
    assert.equal(r.phone_blanked_ms, at);
    assert.equal(r.name, 'مينا زكريا', 'names stay for accounting');
    assert.equal(r.quoted_total, 3000);
  }
  assert.equal(await blankPhones(w.env, at + DAY), 0, 'idempotent');
  const act = (await w.db.prepare("SELECT summary FROM activity WHERE action = 'booking.retention'").all()).results;
  assert.deepEqual(act.map(x => x.summary), ['phones blanked: 2'], 'one audit row, a count only');
  assert.doesNotMatch(JSON.stringify(act), /\+20|010/);

  // the admin sheet says so, and the phone search no longer finds it
  const d = await w.admin('GET', B(a.id));
  assert.equal(d.body.booking.phone, '');
  assert.equal(d.body.booking.phoneBlanked, true);
  void b;
});

test('retention: only events that ended; a booking without its event counts from its creation; per-event limit', async () => {
  const w = await bookWorld();
  const now = Date.now();
  const old = await pending(w);
  // a second event that ends in 2 years
  const { rowFromJson, saveRow } = await import('../src/book/event.js');
  await saveRow(w.env, rowFromJson(eventJson({ id: 'evt-later01', slug: 'later', startAt: msStamp(now + 700 * DAY), endAt: msStamp(now + 730 * DAY) }), 'fixture'));
  const later = await pending(w, { slug: 'later' });
  // an orphan booking (its event row gone) created 13 months ago
  await w.db.prepare("UPDATE bookings SET event_id = 'evt-gone01', created_ms = ? WHERE id = ?").bind(now - 400 * DAY, old.id).run();
  const at = now + 380 * DAY;    // 12 months after alex ended, long before «later» ends
  assert.equal(await blankPhones(w.env, at, { eventId: 'evt-later01' }), 0, 'limited to one event: not ended');
  await w.db.prepare("INSERT INTO edit_locks (kind, id, email, name, sid, since_ms, expires_ms) VALUES ('booking', 'bkg-live01', 'a@b.c', 'A', 'sid-live-0001', ?, ?)").bind(now, now + 60_000).run();
  await blankPhones(w.env, at, { eventId: 'evt-later01' });
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM edit_locks').first()).n, 1, 'a per-event run in the future never touches live locks');
  assert.equal(await blankPhones(w.env, at), 1, 'only the orphan');
  assert.equal((await w.db.prepare('SELECT phone FROM bookings WHERE id = ?').bind(old.id).first()).phone, '');
  assert.notEqual((await w.db.prepare('SELECT phone FROM bookings WHERE id = ?').bind(later.id).first()).phone, '');
});

/* ---------------- edit locks ---------------- */

async function twoAdmins() {
  const w = await bookWorld({ env: { ADMIN_EMAILS: 'admin@example.com,second@example.com' } });
  const as = (claims, sid) => async (method, path, body) => w.call(path, {
    method, body, fetch: w.g.fetch,
    headers: { ...(await w.auth(claims)), ...(sid ? { 'x-edit-session': sid } : {}) }
  });
  return {
    w,
    mina: as({}, 'sid-mina-0001'),
    mina2: as({}, 'sid-mina-0002'),               // the same admin on another phone
    fady: as({ email: 'second@example.com', sub: '1002', name: 'فادي' }, 'sid-fady-0001'),
    nosid: as({ email: 'second@example.com', sub: '1002', name: 'فادي' }, '')
  };
}

test('locks: one sheet holds a booking; others are told who and refused every write; renew, release', async () => {
  const { w, mina, mina2, fady, nosid } = await twoAdmins();
  const b = await pending(w);

  const take = await mina('POST', B(b.id, 'lock'));
  assert.equal(take.body.granted, true);
  assert.equal(take.body.ttl, LOCK_TTL_MS);
  assert.equal((await mina('POST', B(b.id, 'lock'))).body.granted, true, 'renewal');

  const other = await fady('POST', B(b.id, 'lock'));
  assert.equal(other.body.granted, false);
  assert.equal(other.body.holder.name, 'Admin');
  assert.equal(typeof other.body.holder.since, 'number');
  assert.equal(other.body.holder.email, undefined, 'only a name');
  assert.equal((await mina2('POST', B(b.id, 'lock'))).body.granted, false, 'same admin, other page session');

  const seen = await fady('GET', B(b.id));
  assert.deepEqual(seen.body.lock.mine, false);
  assert.equal((await mina('GET', B(b.id))).body.lock.mine, true);

  for (const [who, name] of [[fady, 'fady'], [nosid, 'no session'], [mina2, 'other session']]) {
    const r = await who('POST', B(b.id, 'reject'), { version: 1, reason: 'مكرر' });
    assert.equal(r.status, 409, name);
    assert.equal(r.body.code, 'locked', name);
    assert.equal(r.body.holder.name, 'Admin', name);
  }
  assert.equal((await w.db.prepare('SELECT status, version FROM bookings WHERE id = ?').bind(b.id).first()).version, 1, 'nothing written');

  // the holder writes; the lock stays theirs
  const ok = await mina('POST', B(b.id, 'confirm'), { version: 1, payments: [pay({ amount: 3000 })] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  for (const [path, body] of [
    [B(b.id, 'payments'), pay({ amount: 100 })],
    [B(b.id, 'update'), { version: 2, adminNote: 'x' }],
    [B(b.id, 'cancel'), { version: 2, reason: 'سبب' }]
  ]) {
    assert.equal((await fady('POST', path, body)).body.code, 'locked', path);
  }
  const payId = ok.body.payments[0].id;
  assert.equal((await fady('POST', '/v1/admin/book/payments/' + payId + '/void', { idemKey: 'void-000001', reason: 'غلط' })).body.code, 'locked');

  // released → anyone writes again (the version still guards)
  assert.equal((await fady('DELETE', B(b.id, 'lock'))).body.released, false, 'not theirs to release');
  assert.equal((await mina('DELETE', B(b.id, 'lock'))).body.released, true);
  const add = await fady('POST', B(b.id, 'payments'), pay({ amount: 100, force: true }));
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal((await fady('POST', B(b.id, 'lock'))).body.granted, true, 'free → theirs');
});

test('locks: a lease lapses after the TTL; a lock call needs a session; unknown booking 404', async () => {
  const { w, mina, fady, nosid } = await twoAdmins();
  const b = await pending(w);
  await mina('POST', B(b.id, 'lock'));
  await w.db.prepare('UPDATE edit_locks SET expires_ms = ? WHERE id = ?').bind(Date.now() - 1, b.id).run();
  const r = await fady('POST', B(b.id, 'reject'), { version: 1, reason: 'مكرر' });
  assert.equal(r.status, 200, 'expired lease: no longer blocks');
  assert.equal((await fady('POST', B(b.id, 'lock'))).body.granted, true, 'and can be taken');
  assert.equal((await nosid('POST', B(b.id, 'lock'))).body.code, 'bad');
  assert.equal((await mina('POST', B('bkg-nothere1', 'lock'))).status, 404);
  // the daily cron removes long-dead leases
  await w.db.prepare('UPDATE edit_locks SET expires_ms = ?').bind(Date.now() - 2 * DAY).run();
  await blankPhones(w.env, Date.now());
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM edit_locks').first()).n, 0);
});

test('locks: CORS lets the admin send x-edit-session', async () => {
  const w = await bookWorld();
  const r = await w.call('/v1/admin/book/bookings/bkg-abcdef/lock', { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST' } });
  assert.match(r.headers.get('access-control-allow-headers'), /x-edit-session/);
});

/* ---------------- new bookings → admin push feed ---------------- */

async function syncCall(w, body = '{}', { ts = Date.now(), secret = w.env.SYNC_SECRET } = {}) {
  return w.call('/v1/sync/book-news', {
    method: 'POST', body, headers: { 'content-type': 'application/json', 'x-sync-ts': String(ts), 'x-sync-signature': await signSync(secret, String(ts), body) }
  });
}

test('news: visitor bookings are counted per event and handed out grouped, once, nothing personal', async () => {
  const w = await bookWorld();
  await pending(w);
  await pending(w);
  await pending(w);
  const r = await syncCall(w);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.groups.length, 1);
  const g = r.body.groups[0];
  assert.equal(g.eventId, 'evt-alex01');
  assert.equal(g.slug, 'alex-trip');
  assert.equal(g.title, 'رحلة الإسكندرية');
  assert.equal(g.count, 3);
  assert.equal(g.pending, 3);
  assert.doesNotMatch(JSON.stringify(r.body), /مينا|\+20|B-[0-9A-Z]{5}/, 'no names, phones or refs');
  assert.deepEqual((await syncCall(w, '{}', { ts: Date.now() + 1 })).body.groups, [], 'handed out once');
});

test('news: an event is handed out at most once per 10 minutes; bookings in between come together', async () => {
  const w = await bookWorld();
  const t0 = Date.now();
  await pending(w);
  assert.equal((await claimNews(w.env, t0)).length, 1);
  await pending(w);
  await pending(w);
  assert.deepEqual(await claimNews(w.env, t0 + 60_000), [], 'cooldown');
  const later = await claimNews(w.env, t0 + NEWS_COOLDOWN_MS + 1);
  assert.equal(later.length, 1);
  assert.equal(later[0].count, 2);
});

test('news: admin bookings are not news; a refused booking adds nothing', async () => {
  const w = await bookWorld();
  const created = await w.admin('POST', '/v1/admin/book/bookings', { eventId: 'evt-alex01', requestKey: w.key('adm'), name: 'حجز يدوي', phone: phone(), counts: { applicant: 1 }, servantId: 'srv-aaaa1111', method: 'cash' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const p = phone();
  await pending(w, { phone: p });
  await pending(w, { phone: p });
  assert.equal((await w.submit({ phone: p })).body.code, 'limit');
  const g = await claimNews(w.env);
  assert.equal(g[0].count, 2);
});

test('news: the sync channel refuses bad signatures, old timestamps and replays', async () => {
  const w = await bookWorld();
  assert.equal((await syncCall(w, '{}', { secret: 'wrong-secret' })).status, 401);
  assert.equal((await syncCall(w, '{}', { ts: Date.now() - 10 * 60_000 })).status, 401);
  const ts = Date.now();
  assert.equal((await syncCall(w, '{}', { ts })).status, 200);
  assert.equal((await syncCall(w, '{}', { ts })).status, 409, 'replay');
  const noSecret = await bookWorld({ env: { SYNC_SECRET: '' } });
  assert.equal((await syncCall(noSecret, '{}', { secret: 'x' })).body.code, 'disabled');
});

/* ---------------- Turnstile ---------------- */

function siteverify(answer) {
  const calls = [];
  const f = async (url, init) => {
    if (url !== SITEVERIFY) throw new Error('unexpected fetch ' + url);
    const form = init.body;
    calls.push({ secret: form.get('secret'), response: form.get('response'), remoteip: form.get('remoteip') });
    return new Response(JSON.stringify(typeof answer === 'function' ? answer(form) : answer), { headers: { 'content-type': 'application/json' } });
  };
  f.calls = calls;
  return f;
}

async function tsWorld(env = {}, answer = { success: true, hostname: 'stathanasiosyouth.github.io' }) {
  const w = await bookWorld({ env: { TURNSTILE_SECRET: 'ts-secret', TURNSTILE_SITEKEY: '0x4AAAAAAAtest', ...env } });
  const f = siteverify(answer);
  const pub = (method, path, body, ip = '198.51.100.7') => w.call(path, { method, body, headers: { 'cf-connecting-ip': ip }, fetch: f });
  const submit = (over = {}) => pub('POST', '/v1/book/submit', {
    slug: 'alex-trip', requestKey: w.key('rq'), name: 'مينا زكريا', phone: phone(), counts: { applicant: 1, adult: 1 },
    servantId: 'srv-aaaa1111', method: 'cash', hp: '', revision: 'rev1', ...over
  });
  return { w, f, pub, submit };
}

test('turnstile: state gives the site key; submit needs a token that verifies; checked once per booking', async () => {
  const { w, f, pub, submit } = await tsWorld();
  assert.equal((await pub('GET', '/v1/book/state?slug=alex-trip')).body.turnstile, '0x4AAAAAAAtest');

  const none = await submit();
  assert.equal(none.status, 403);
  assert.equal(none.body.code, 'turnstile');
  assert.equal(f.calls.length, 0, 'no token: no siteverify call');

  const key = w.key('rq');
  const ok = await submit({ requestKey: key, turnstile: 'tok-good' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(f.calls[0], { secret: 'ts-secret', response: 'tok-good', remoteip: '198.51.100.7' });

  // a network retry of the same request: answered from the booking, token not re-checked
  const again = await submit({ requestKey: key, turnstile: 'tok-good' });
  assert.equal(again.body.replay, true);
  assert.equal(again.body.ref, ok.body.ref);
  assert.equal(f.calls.length, 1);
});

test('turnstile: a token siteverify refuses → turnstile (reasons), nothing stored; siteverify down → busy', async () => {
  const { w, submit } = await tsWorld({}, { success: false, 'error-codes': ['timeout-or-duplicate'] });
  const r = await submit({ turnstile: 'tok-used' });
  assert.equal(r.body.code, 'turnstile');
  assert.deepEqual(r.body.reasons, ['timeout-or-duplicate']);
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM bookings').first()).n, 0);
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM book_news').first()).n, 0);

  const down = await bookWorld({ env: { TURNSTILE_SECRET: 'ts-secret', TURNSTILE_SITEKEY: 'k' } });
  const res = await down.call('/v1/book/submit', {
    method: 'POST', fetch: async () => { throw new Error('network'); }, headers: { 'cf-connecting-ip': '198.51.100.9' },
    body: { slug: 'alex-trip', requestKey: down.key('rq'), name: 'مينا زكريا', phone: phone(), counts: { applicant: 1 }, servantId: 'srv-aaaa1111', method: 'cash', hp: '', turnstile: 't' }
  });
  assert.equal(res.body.code, 'busy');
});

test('turnstile: production fails closed without the secret, and checks the hostname', async () => {
  const noSecret = await tsWorld({ ENVIRONMENT: 'production', TURNSTILE_SECRET: '', SITE_URL: 'https://stathanasiosyouth.github.io' });
  assert.equal((await noSecret.pub('GET', '/v1/book/state?slug=alex-trip')).body.turnstile, null, 'no widget without a secret');
  assert.equal((await noSecret.submit({ turnstile: 'x' })).body.code, 'disabled');

  const wrongHost = await tsWorld({ ENVIRONMENT: 'production', SITE_URL: 'https://stathanasiosyouth.github.io' }, { success: true, hostname: 'evil.example' });
  assert.equal((await wrongHost.submit({ turnstile: 'x' })).body.code, 'turnstile');
  const rightHost = await tsWorld({ ENVIRONMENT: 'production', SITE_URL: 'https://stathanasiosyouth.github.io' });
  assert.equal((await rightHost.submit({ turnstile: 'x' })).status, 200);
});

test('turnstile: admin manual bookings never need it', async () => {
  const { w } = await tsWorld();
  const r = await w.admin('POST', '/v1/admin/book/bookings', { eventId: 'evt-alex01', requestKey: w.key('adm'), name: 'حجز يدوي', phone: phone(), counts: { applicant: 1 }, servantId: 'srv-aaaa1111', method: 'cash' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
