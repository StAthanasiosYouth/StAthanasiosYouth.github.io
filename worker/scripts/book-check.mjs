// STAGING-ONLY live check of the booking pilot: the whole flow on the real
// Worker + D1 + R2, then concurrency races. Uses the staging test admin key
// (.staging-test-key.pem) and test events stored as fixtures.
// Usage: node scripts/book-check.mjs [stagingUrl]
import { readFileSync, writeFileSync } from 'node:fs';
import { createSign, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const sharp = createRequire(process.env.SHARP_FROM || 'D:/private_projects/athanasios-events/tools/package.json')('sharp');
const RUN = Date.now().toString(36);
const DAY = 864e5;
let failed = 0;
const timings = {};

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
async function call(method, path, body, { admin = false, headers = {}, raw = null } = {}) {
  const t = performance.now();
  const h = { origin: ORIGIN, ...headers };
  if (admin) h.authorization = AUTH;
  let payload;
  if (raw) { payload = raw; h['content-type'] = h['content-type'] || 'image/jpeg'; } else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const res = await fetch(base + path, { method, headers: h, body: payload });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json, ms: Math.round(performance.now() - t) };
}
const A = (m, p, b, o = {}) => call(m, p, b, { ...o, admin: true });
const time = (k, r) => { (timings[k] = timings[k] || []).push(r.ms); return r; };
const stamp = ms => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const nextMinute = () => new Promise(r => setTimeout(r, (61 - new Date().getUTCSeconds()) * 1000));

function event(slug, id, booking = {}) {
  const now = Date.now();
  return {
    schema: 1, v: 'rev-' + RUN, id, slug, title: 'تجربة حجز ' + slug, startAt: stamp(now + 10 * DAY), endAt: stamp(now + 11 * DAY),
    booking: {
      online: true, opensAt: stamp(now - DAY), closesAt: '', capacity: 20, showLeft: true, showLeftBelow: 5, perBookingMax: 6, collectNames: false,
      pricing: { mode: 'group', categories: [
        { key: 'applicant', label: 'الحاجز', group: 'adult', price: 1500, seat: true, min: 1, max: 1 },
        { key: 'adult', label: 'فرد إضافي', group: 'adult', price: 1500, seat: true, min: 0, max: 5 },
        { key: 'child', label: 'طفل', group: 'child', price: 800, seat: true, min: 0, max: 5 }
      ] },
      payment: { mode: 'installments', minFirst: 500, finalDueAt: '' },
      methods: [{ key: 'cash', label: 'كاش', needsProof: false }, { key: 'instapay', label: 'إنستاباي', needsProof: true }],
      servants: [{ id: 'srv-aaaa1111', name: 'مينا عادل', methods: ['cash', 'instapay'] }, { id: 'srv-bbbb2222', name: 'مرقس فادي', methods: ['cash'] }],
      ...booking
    }
  };
}
const pay = (o = {}) => ({ kind: 'payment', amount: 500, servantId: 'srv-aaaa1111', method: 'cash', receivedAt: stamp(Date.now() - 60000), idemKey: 'p-' + randomUUID(), ...o });
const phone = i => '010' + String(Number(RUN.replace(/\D/g, '').slice(-4) || 0) * 1000 + i).padStart(8, '0').slice(-8);

// ---------------- setup ----------------
check('module on (staging)', (await A('POST', '/v1/admin/book/module', { on: true })).body.on === true);
const slugA = 'chk-' + RUN, slugB = 'race-' + RUN, slugC = 'cap-' + RUN;
const evA = 'evt-a' + RUN, evB = 'evt-b' + RUN, evC = 'evt-c' + RUN;
check('fixture events stored', (await A('POST', '/v1/admin/diag/event-fixture', event(slugA, evA))).status === 200
  && (await A('POST', '/v1/admin/diag/event-fixture', event(slugB, evB, { capacity: 100 }))).status === 200
  && (await A('POST', '/v1/admin/diag/event-fixture', event(slugC, evC, { capacity: 5 }))).status === 200);

// ---------------- public flow ----------------
await nextMinute();
const st = time('state', await call('GET', '/v1/book/state?slug=' + slugA));
check('state: open', st.body.open === true, st.body);
const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 20, g: 120, b: 80 } } }).composite([{ input: Buffer.from('<svg width="1200" height="900"><text x="60" y="450" font-size="90" fill="white">تحويل إنستاباي 1500</text></svg>'), top: 0, left: 0 }]).jpeg({ quality: 80 }).toBuffer();
const proof = time('proof upload', await call('POST', '/v1/book/proof?slug=' + slugA, undefined, { raw: jpeg }));
check('proof upload → proofId + claim', proof.status === 200 && proof.body.proofId && proof.body.claim, proof.body);
const rk = 'rk-' + randomUUID();
const sub = { slug: slugA, requestKey: rk, name: 'زائر تجربة ' + RUN, phone: phone(1), counts: { applicant: 1, adult: 1, child: 1 }, servantId: 'srv-aaaa1111', method: 'instapay', proofs: [{ proofId: proof.body.proofId, claim: proof.body.claim }], hp: '', revision: 'rev-' + RUN };
const s1 = time('submit', await call('POST', '/v1/book/submit', sub));
check('submit → pending, ref, token, server price 3800', s1.status === 200 && s1.body.status === 'pending' && s1.body.quotedTotal === 3800 && /^bk1\./.test(s1.body.token), s1.body);
const s2 = await call('POST', '/v1/book/submit', sub);
check('same requestKey → same ref (replay)', s2.body.ref === s1.body.ref && s2.body.replay === true, s2.body);
const stat = time('status', await call('POST', '/v1/book/status', { token: s1.body.token }));
check('status view: first name, people, no phone', stat.body.status === 'pending' && stat.body.people.total === 3 && !JSON.stringify(stat.body).includes(phone(1).slice(3)), stat.body);
const noProof = await call('POST', '/v1/book/submit', { ...sub, requestKey: 'rk-' + randomUUID(), phone: phone(2), proofs: [] });
check('instapay without a proof → invalid(proofs)', noProof.body.code === 'invalid' && noProof.body.field === 'proofs', noProof.body);

// ---------------- admin flow ----------------
const q = time('admin queue', await A('GET', '/v1/admin/book/bookings?eventId=' + evA + '&status=pending'));
check('queue shows the pending booking', q.body.rows.some(r => r.ref === s1.body.ref), q.body);
const id = q.body.rows.find(r => r.ref === s1.body.ref).id;
const d = time('admin detail', await A('GET', '/v1/admin/book/bookings/' + id));
check('detail: visitor proof attached', d.body.proofs.length === 1 && d.body.proofs[0].id === proof.body.proofId, d.body.proofs);
const shortPay = await A('POST', `/v1/admin/book/bookings/${id}/confirm`, { version: d.body.booking.version, payments: [pay({ amount: 300 })] });
check('confirm with 300 < minFirst 500 → needs_override(payment)', shortPay.body.code === 'needs_override' && shortPay.body.warnings[0].code === 'payment', shortPay.body);
const c = time('confirm', await A('POST', `/v1/admin/book/bookings/${id}/confirm`, { version: d.body.booking.version, payments: [pay({ amount: 1000, method: 'instapay', proofIds: [proof.body.proofId] })] }));
check('confirm with a 1000 first payment', c.status === 200 && c.body.booking.status === 'confirmed' && c.body.derived.paid === 1000 && c.body.derived.balance === 2800, c.body);
const dup = await A('POST', `/v1/admin/book/bookings/${id}/payments`, pay({ amount: 1000, method: 'instapay' }));
check('same amount/servant/day → warn', dup.body.code === 'warn' && dup.body.warnings.some(w => w.code === 'duplicate'), dup.body);
const p2 = time('add payment', await A('POST', `/v1/admin/book/bookings/${id}/payments`, pay({ amount: 800, servantId: 'srv-bbbb2222' })));
check('add payment (servant B, cash)', p2.body.derived.paid === 1800, p2.body.derived);
const voidMe = p2.body.payments.find(p => p.amount === 800);
const v = time('void', await A('POST', `/v1/admin/book/payments/${voidMe.id}/void`, { reason: 'غلط', idemKey: 'v-' + randomUUID() }));
check('void → paid back to 1000', v.body.derived.paid === 1000, v.body.derived);
const p3 = await A('POST', `/v1/admin/book/bookings/${id}/payments`, pay({ amount: 2800, servantId: 'srv-bbbb2222' }));
check('pay the rest → paid', p3.body.derived.paymentStatus === 'paid', p3.body.derived);
const up = await A('POST', `/v1/admin/book/bookings/${id}/update`, { version: p3.body.booking.version, amountDue: 3500, reason: 'خصم' });
check('amount due lowered → overpaid, refund owed 300', up.body.derived.paymentStatus === 'overpaid' && up.body.derived.refundOwed === 300, up.body.derived);
const rf = await A('POST', `/v1/admin/book/bookings/${id}/payments`, pay({ kind: 'refund', amount: 300, servantId: 'srv-bbbb2222' }));
check('refund 300 → paid', rf.body.derived.paymentStatus === 'paid' && rf.body.derived.refundOwed === 0, rf.body.derived);
const sum = time('summary', await A('GET', '/v1/admin/book/summary?eventId=' + evA));
check('summary: money by servant (who received)', sum.body.overall.money.net === 3500 && sum.body.servants.find(s => s.id === 'srv-bbbb2222').net === 2500, sum.body.overall.money);
const ex = time('export', await A('GET', '/v1/admin/book/export?eventId=' + evA));
check('export: bookings + payments with void flag', ex.body.bookings.length >= 1 && ex.body.payments.some(p => p.voided), ex.body.payments.length);
const pubSt = await call('POST', '/v1/book/status', { token: s1.body.token });
check('visitor status after confirm: paid', pubSt.body.status === 'confirmed' && pubSt.body.paymentStatus === 'paid', pubSt.body);

// ---------------- concurrency ----------------
await nextMinute();
const sameKey = { slug: slugB, requestKey: 'rk-same-' + RUN, name: 'سباق', phone: phone(10), counts: { applicant: 1 }, servantId: 'srv-bbbb2222', method: 'cash', hp: '', revision: '' };
const same = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/v1/book/submit', sameKey)));
const refs = new Set(same.filter(r => r.status === 200).map(r => r.body.ref));
check('8× same requestKey at once → exactly 1 booking', refs.size === 1, same.map(r => r.status + ':' + (r.body.ref || r.body.code)));

await nextMinute();
const samePhone = await Promise.all(Array.from({ length: 6 }, (_, i) => call('POST', '/v1/book/submit', { ...sameKey, requestKey: 'rk-ph-' + i + '-' + RUN, phone: phone(20) })));
const okPhone = samePhone.filter(r => r.status === 200).length;
check('6 submits, same phone at once → exactly 2 pending, the rest limit', okPhone === 2 && samePhone.filter(r => r.body.code === 'limit').length === 4, samePhone.map(r => r.status + ':' + (r.body.code || 'ok')));

await nextMinute();
const burst = await Promise.all(Array.from({ length: 14 }, (_, i) => call('POST', '/v1/book/submit', { ...sameKey, requestKey: 'rk-b-' + i + '-' + RUN, phone: phone(40 + i) })));
check('14 submits from one IP at once → exactly 10 accepted (10/min), 4 rate', burst.filter(r => r.status === 200).length === 10 && burst.filter(r => r.body.code === 'rate').length === 4, burst.map(r => r.status));

// last places: 12 admin-made pending bookings, capacity 5, all confirmed at once
const made = [];
for (let i = 0; i < 12; i++) {
  const m = await A('POST', '/v1/admin/book/bookings', { eventId: evC, requestKey: 'adm-' + i + '-' + RUN, name: 'سباق مكان ' + i, phone: phone(70 + i), counts: { applicant: 1 }, servantId: 'srv-bbbb2222', method: 'cash' });
  made.push(m.body.booking);
}
const t0 = performance.now();
const confirms = await Promise.all(made.map(b => A('POST', `/v1/admin/book/bookings/${b.id}/confirm`, { version: b.version, payments: [pay({ amount: 1500, servantId: 'srv-bbbb2222' })] })));
const wall = Math.round(performance.now() - t0);
const won = confirms.filter(r => r.status === 200).length;
const evRow = (await A('GET', '/v1/admin/book/events')).body.events.find(e => e.id === evC);
check(`12 confirms at once for 5 places → exactly 5 confirmed (${wall} ms)`, won === 5 && evRow.taken === 5 && confirms.filter(r => r.body.code === 'needs_override').length === 7, { won, taken: evRow.taken, codes: confirms.map(r => r.body.code || 'ok') });
const losers = confirms.map((r, i) => ({ r, b: made[i] })).filter(x => x.r.status !== 200);
const lostPay = await A('GET', '/v1/admin/book/bookings/' + losers[0].b.id);
check('a losing confirm wrote no payment', lostPay.body.payments.length === 0 && lostPay.body.booking.status === 'pending', lostPay.body.payments);

// payments in parallel on one booking
const target = made[confirms.findIndex(r => r.status === 200)];
const pays = Array.from({ length: 20 }, (_, i) => pay({ amount: 10 + i, servantId: 'srv-bbbb2222', force: true }));
const parallel = await Promise.all(pays.map(p => A('POST', `/v1/admin/book/bookings/${target.id}/payments`, p)));
const after = await A('GET', '/v1/admin/book/bookings/' + target.id);
const expectPaid = 1500 + pays.reduce((s, p) => s + p.amount, 0);
check('20 payments at once → 20 rows, exact total', parallel.every(r => r.status === 200) && after.body.payments.length === 21 && after.body.derived.paid === expectPaid, { paid: after.body.derived.paid, expectPaid, n: after.body.payments.length });
const one = pay({ amount: 7, servantId: 'srv-bbbb2222', force: true });
await Promise.all(Array.from({ length: 10 }, () => A('POST', `/v1/admin/book/bookings/${target.id}/payments`, one)));
const after2 = await A('GET', '/v1/admin/book/bookings/' + target.id);
check('10× the same idemKey at once → 1 row', after2.body.payments.filter(p => p.amount === 7).length === 1, after2.body.payments.length);
const victim = after2.body.payments.find(p => p.amount === 7);
const voids = await Promise.all(Array.from({ length: 8 }, () => A('POST', `/v1/admin/book/payments/${victim.id}/void`, { reason: 'سباق', idemKey: 'v-' + randomUUID() })));
const after3 = await A('GET', '/v1/admin/book/bookings/' + target.id);
check('8 different voids of one row at once → exactly 1 void', after3.body.payments.filter(p => p.kind === 'void').length === 1 && voids.filter(r => r.status === 200).length === 1, voids.map(r => r.body.code || 'ok'));

// tidy: cancel the test events' bookings
for (const e of [evA, evB, evC]) await A('POST', `/v1/admin/book/events/${e}/cancel-all`, { reason: 'نهاية الاختبار', idemKey: 'ca-' + e });

const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
const lat = Object.fromEntries(Object.entries(timings).map(([k, a]) => [k, a.length > 1 ? { p50: pct(a, 0.5), n: a.length } : a[0]]));
console.log('latency ms', JSON.stringify(lat));
writeFileSync(new URL('../book-check-results.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), failed, timings: lat }, null, 2));
process.exit(failed ? 1 : 0);
