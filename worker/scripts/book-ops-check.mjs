// STAGING-ONLY live check of the booking pilot's operations (on the real
// Worker + D1): Turnstile on submit, edit locks, the grouped «new bookings»
// feed Apps Script turns into admin pushes (signed sync), and the 12-month
// phone retention. Uses the staging test admin key (.staging-test-key.pem)
// and the staging sync secret (.staging-sync-secret).
//
// Usage: node scripts/book-ops-check.mjs                 (staging's Turnstile secret = the always-PASS test secret)
//        node scripts/book-ops-check.mjs --turnstile-fails (secret temporarily = the always-FAIL test secret)
import { readFileSync } from 'node:fs';
import { createSign, createHmac, randomUUID } from 'node:crypto';

const base = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const FAILS = process.argv.includes('--turnstile-fails');
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SYNC = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const RUN = Date.now().toString(36);
const DAY = 864e5;
let failed = 0;

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
}
function token() {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'loadtest-1', email: 'loadtest@staging.invalid', email_verified: true, name: 'Load Test', iat: now, exp: now + 3600 });
  return head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
const AUTH = 'Bearer ' + token();
async function call(method, path, body, { admin = false, headers = {} } = {}) {
  const h = { origin: ORIGIN, ...headers };
  if (admin) h.authorization = AUTH;
  let payload;
  if (body !== undefined) { payload = typeof body === 'string' ? body : JSON.stringify(body); h['content-type'] = 'application/json'; }
  const res = await fetch(base + path, { method, headers: h, body: payload });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const A = (m, p, b, sid) => call(m, p, b, { admin: true, headers: sid ? { 'x-edit-session': sid } : {} });
async function sync(path) {
  const body = '{}';
  const ts = String(Date.now());
  const sig = 'v1=' + createHmac('sha256', SYNC).update(ts + '.' + body).digest('hex');
  return call('POST', path, body, { headers: { 'x-sync-ts': ts, 'x-sync-signature': sig } });
}
const stamp = ms => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const phone = i => '011' + String(Number(RUN.replace(/\D/g, '').slice(-4) || 0) * 1000 + i).padStart(8, '0').slice(-8);

const now = Date.now();
const slug = 'ops-' + RUN;
const evId = 'evt-o' + RUN;
const endMs = now + 11 * DAY;
const event = {
  schema: 1, v: 'rev-' + RUN, id: evId, slug, title: 'تجربة تشغيل ' + RUN, startAt: stamp(now + 10 * DAY), endAt: stamp(endMs),
  booking: {
    online: true, opensAt: stamp(now - DAY), closesAt: '', capacity: 30, showLeft: true, showLeftBelow: 5, perBookingMax: 6, collectNames: false,
    pricing: { mode: 'group', categories: [{ key: 'applicant', label: 'الحاجز', group: 'adult', price: 1000, seat: true, min: 1, max: 1 }] },
    payment: { mode: 'full', minFirst: 0, finalDueAt: '' },
    methods: [{ key: 'cash', label: 'كاش', needsProof: false }],
    servants: [{ id: 'srv-aaaa1111', name: 'مينا عادل', methods: ['cash'] }]
  }
};
const submit = (i, over = {}) => call('POST', '/v1/book/submit', { slug, requestKey: 'rk-' + randomUUID(), name: 'تشغيل ' + i, phone: phone(i), counts: { applicant: 1 }, servantId: 'srv-aaaa1111', method: 'cash', hp: '', ...over });

check('module on (staging)', (await A('POST', '/v1/admin/book/module', { on: true })).body.on === true);
check('fixture event stored', (await A('POST', '/v1/admin/diag/event-fixture', event)).status === 200);

// ---------------- Turnstile ----------------
const st = await call('GET', '/v1/book/state?slug=' + slug);
check('state names the Turnstile site key', st.body.turnstile === '1x00000000000000000000AA', st.body);
const none = await submit(1);
check('submit without a token → 403 turnstile, nothing stored', none.status === 403 && none.body.code === 'turnstile', none.body);

if (FAILS) {
  const bad = await submit(2, { turnstile: TEST_TOKEN });
  check('a token siteverify refuses → 403 turnstile (+ reasons)', bad.status === 403 && bad.body.code === 'turnstile' && Array.isArray(bad.body.reasons), bad.body);
  const q = await A('GET', '/v1/admin/book/bookings?eventId=' + evId + '&status=all');
  check('nothing was booked', q.body.rows.length === 0, q.body.rows.length);
  await A('POST', `/v1/admin/book/events/${evId}/cancel-all`, { reason: 'نهاية الاختبار', idemKey: 'ca-' + evId });
  console.log(failed ? `${failed} FAILED` : 'all ok');
  process.exit(failed ? 1 : 0);
}

const ok1 = await submit(3, { turnstile: TEST_TOKEN });
check('submit with a token that verifies → pending', ok1.status === 200 && ok1.body.status === 'pending', ok1.body);

// ---------------- new bookings → the admin push feed ----------------
await submit(4, { turnstile: TEST_TOKEN });
await submit(5, { turnstile: TEST_TOKEN });
const waiting = await A('GET', '/v1/admin/diag/book-news?eventId=' + evId);
check('3 visitor bookings counted for the next push', waiting.body.news && waiting.body.news.unsent === 3, waiting.body);
const feed = await sync('/v1/sync/book-news');
const group = feed.body && feed.body.groups && feed.body.groups.find(g => g.eventId === evId);
check('signed sync hands out ONE group: count 3, pending 3, the title', group && group.count === 3 && group.pending === 3 && group.title === event.title && group.slug === slug, feed.body);
check('the feed carries no names, phones or refs', !/تشغيل \d|011\d{8}|\+20|B-[0-9A-Z]{5}/.test(JSON.stringify(feed.body)), feed.body);
await submit(6, { turnstile: TEST_TOKEN });
const again = await sync('/v1/sync/book-news');
check('a booking inside the 10-minute window waits (not handed out again yet)', !again.body.groups.some(g => g.eventId === evId), again.body);
const still = await A('GET', '/v1/admin/diag/book-news?eventId=' + evId);
check('… and is kept for the next group', still.body.news.unsent === 1, still.body);
const badSig = await call('POST', '/v1/sync/book-news', '{}', { headers: { 'x-sync-ts': String(Date.now()), 'x-sync-signature': 'v1=' + '0'.repeat(64) } });
check('a bad signature → 401', badSig.status === 401, badSig.body);
const adminMade = await A('POST', '/v1/admin/book/bookings', { eventId: evId, requestKey: 'adm-' + RUN, name: 'يدوي', phone: phone(9), counts: { applicant: 1 }, servantId: 'srv-aaaa1111', method: 'cash' });
const after = await A('GET', '/v1/admin/diag/book-news?eventId=' + evId);
check('an admin-made booking is not news', adminMade.status === 200 && after.body.news.unsent === 1, after.body);

// ---------------- edit locks ----------------
const q = await A('GET', '/v1/admin/book/bookings?eventId=' + evId + '&status=pending');
const b = q.body.rows.find(r => r.ref === ok1.body.ref);
const S1 = 'sid-ops-one-' + RUN, S2 = 'sid-ops-two-' + RUN;
const take = await A('POST', `/v1/admin/book/bookings/${b.id}/lock`, {}, S1);
check('page 1 takes the lock', take.body.granted === true && take.body.ttl === 90000, take.body);
const other = await A('POST', `/v1/admin/book/bookings/${b.id}/lock`, {}, S2);
check('page 2: not granted, told who', other.body.granted === false && other.body.holder.name === 'Load Test', other.body);
const d2 = await A('GET', '/v1/admin/book/bookings/' + b.id, undefined, S2);
check('detail for page 2 says locked, not mine', d2.body.lock && d2.body.lock.mine === false, d2.body.lock);
const refused = await A('POST', `/v1/admin/book/bookings/${b.id}/reject`, { version: d2.body.booking.version, reason: 'تجربة قفل' }, S2);
check('page 2 reject → 409 locked, nothing written', refused.status === 409 && refused.body.code === 'locked', refused.body);
const noSid = await A('POST', `/v1/admin/book/bookings/${b.id}/payments`, { kind: 'payment', amount: 100, servantId: 'srv-aaaa1111', method: 'cash', receivedAt: stamp(Date.now() - 60000), idemKey: 'p-' + randomUUID() });
check('a write without a session → locked too', noSid.body.code === 'locked', noSid.body);
const conf = await A('POST', `/v1/admin/book/bookings/${b.id}/confirm`, { version: d2.body.booking.version, payments: [{ kind: 'payment', amount: 1000, servantId: 'srv-aaaa1111', method: 'cash', receivedAt: stamp(Date.now() - 60000), idemKey: 'p-' + randomUUID() }] }, S1);
check('the holder confirms', conf.status === 200 && conf.body.booking.status === 'confirmed', conf.body);
const rel = await call('DELETE', `/v1/admin/book/bookings/${b.id}/lock`, undefined, { admin: true, headers: { 'x-edit-session': S1 } });
check('the holder releases', rel.body.released === true, rel.body);
const now2 = await A('POST', `/v1/admin/book/bookings/${b.id}/lock`, {}, S2);
check('free → page 2 gets it', now2.body.granted === true, now2.body);
await call('DELETE', `/v1/admin/book/bookings/${b.id}/lock`, undefined, { admin: true, headers: { 'x-edit-session': S2 } });
const pre = await call('OPTIONS', `/v1/admin/book/bookings/${b.id}/lock`, undefined, { headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-edit-session' } });
check('CORS preflight allows x-edit-session', pre.status === 204, pre.status);

// ---------------- 12-month phone retention ----------------
const early = await A('POST', '/v1/admin/diag/retention', { eventId: evId, atMs: endMs + 364 * DAY });
check('11 months 29 days after the end: nothing blanked', early.body.blanked === 0, early.body);
const late = await A('POST', '/v1/admin/diag/retention', { eventId: evId, atMs: endMs + 366 * DAY });
check('12 months after the end: every phone of the event blanked (5 bookings)', late.body.blanked === 5, late.body);
const blanked = await A('GET', '/v1/admin/book/bookings/' + b.id);
check('the booking keeps name, status and money; phone empty + phoneBlanked', blanked.body.booking.phone === '' && blanked.body.booking.phoneBlanked === true && blanked.body.booking.status === 'confirmed' && blanked.body.derived.paid === 1000 && blanked.body.booking.name === 'تشغيل 3', blanked.body.booking);
const twice = await A('POST', '/v1/admin/diag/retention', { eventId: evId, atMs: endMs + 400 * DAY });
check('idempotent', twice.body.blanked === 0, twice.body);

await A('POST', `/v1/admin/book/events/${evId}/cancel-all`, { reason: 'نهاية الاختبار', idemKey: 'ca-' + evId });
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
