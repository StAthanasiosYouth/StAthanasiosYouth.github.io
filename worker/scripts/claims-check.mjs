// Phase 1.5 step 11 on staging (paying a remaining balance, BOOKING-PHASE1-COMPLETION-PLAN §4.10):
// a fixture event, a visitor booking confirmed with part paid, then the participant's
// payment request from the status token (proof upload, duplicate refused, resend
// harmless), the admin's accept through «إضافة دفعة», a second request rejected with a
// reason, a third withdrawn. Staging only; PAY_REQUESTS is on for the run and left at '0';
// the notification switches are not touched; no money moves.
//   node scripts/claims-check.mjs
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const ORIGIN = 'https://stathanasiosyouth.github.io';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const P = 'loadtest@staging.invalid';
const RUN = Date.now().toString(36);
const EV = 'evt-pay' + RUN;
const SLUG = 'pay-' + RUN;
const SRV = 'srv-aaaa1111';
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + String(JSON.stringify(detail)).slice(0, 300))); if (!ok) failed++; };

function token() {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'loadtest-1', email: P, email_verified: true, name: 'loadtest', iat: now, exp: now + 3600 });
  return 'Bearer ' + head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function call(method, path, body, { auth = true, headers = {}, raw = null } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { origin: ORIGIN, ...(auth ? { authorization: token() } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(raw ? { 'content-type': 'image/jpeg' } : {}), ...headers },
    body: raw || (body ? JSON.stringify(body) : undefined)
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
function sql(command) {
  const bin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const out = execFileSync(process.execPath, [bin, 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', command], { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) });
  return JSON.parse(out.slice(out.indexOf('['))).flatMap(r => r.results || []);
}
const stamp = ms => { const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day + 'T' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute; };
/* a minimal valid JPEG header (the Worker reads the size, never decodes) */
function jpeg(w = 900, h = 600, pad = 300) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const b = new Uint8Array(head.length + pad + 2);
  b.set(head); for (let i = head.length; i < b.length - 2; i++) b[i] = (i * 7 + Math.floor(Math.random() * 9)) & 255; b[b.length - 2] = 0xff; b[b.length - 1] = 0xd9;
  return b;
}

const fixture = {
  schema: 1, v: 'rev1', id: EV, slug: SLUG, kind: 'trip', title: 'بروفة دفع الباقي ' + RUN, startAt: stamp(Date.now() + 10 * 864e5), endAt: stamp(Date.now() + 11 * 864e5),
  booking: {
    online: true, opensAt: stamp(Date.now() - 864e5), closesAt: stamp(Date.now() + 9 * 864e5), capacity: 20, showLeft: true, showLeftBelow: 5, perBookingMax: 6, collectNames: false,
    pricing: { mode: 'group', categories: [{ key: 'applicant', label: 'الحاجز', group: 'adult', price: 1000, seat: true, min: 1, max: 1, note: '' }] },
    payment: { mode: 'installments', minFirst: 300, finalDueAt: '' },
    methods: [{ key: 'cash', label: 'كاش', needsProof: false }, { key: 'transfer', label: 'تحويل', needsProof: false, online: true }],
    servants: [{ id: SRV, name: 'مينا عادل', methods: ['cash', 'transfer'] }]
  }
};
const upload = async tok => (await call('POST', '/v1/book/proof?slug=' + SLUG, null, { auth: false, raw: jpeg(), headers: { 'x-status-token': tok } })).body;
const ask = (tok, over = {}) => call('POST', '/v1/book/pay-request', { token: tok, requestKey: 'pr-' + Math.random().toString(36).slice(2, 12), servantId: SRV, method: 'transfer', amount: 400, turnstile: 'XXXX.DUMMY.TOKEN.XXXX', ...over }, { auth: false });

// «ادفع الباقي» is off unless PAY_REQUESTS = '1': on for this run, back to '0' at the end
const setSwitch = v => sql(`INSERT INTO settings (key, value, updated_at) VALUES ('PAY_REQUESTS', '${v}', ${Date.now()}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
setSwitch('1');
await new Promise(r => setTimeout(r, 11_000));   // the Worker caches the switch 10 s
check('fixture event (installments, 1000)',(await call('POST', '/v1/admin/diag/event-fixture', fixture)).status === 200);
const sub = await call('POST', '/v1/book/submit', { slug: SLUG, requestKey: 'pay-sub-' + RUN, name: 'زائر الباقي', phone: '0101' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0'),
  counts: { applicant: 1 }, servantId: SRV, method: 'transfer', hp: '', revision: 'rev1', turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }, { auth: false });
check('visitor booking', sub.status === 200, sub.body);
const tok = sub.body && sub.body.token;
const id = (sql(`SELECT id FROM bookings WHERE event_id = '${EV}'`)[0] || {}).id;
const conf = await call('POST', '/v1/admin/book/bookings/' + id + '/confirm', { version: 1, actual: { applicant: 1 }, amountDue: 1000,
  payments: [{ kind: 'payment', amount: 300, servantId: SRV, method: 'cash', receivedAt: stamp(Date.now() - 60000).replace('T', ' '), idemKey: 'pay-c-' + RUN }] });
check('confirmed with 300 of 1000 paid', conf.status === 200, conf.body);
let st = await call('POST', '/v1/book/status', { token: tok }, { auth: false });
check('status: balance 700, «ادفع الباقي» offered', st.body && st.body.balance === 700 && st.body.canPay === true, st.body);

const p1 = await upload(tok);
check('proof uploaded with the status token', p1 && /^prf-/.test(p1.proofId || ''), p1);
const key = 'pr-key-' + RUN;
const r1 = await ask(tok, { requestKey: key, proofs: [p1] });
check('request: pending (no payment written)', r1.status === 200 && r1.body.request.status === 'pending', r1.body);
check('… still one payment (300) on the booking', sql(`SELECT COUNT(*) n FROM payments WHERE booking_id = '${id}'`)[0].n === 1);
const resend = await ask(tok, { requestKey: key, proofs: [p1] });
check('resend with the same key: the same answer', resend.status === 200 && resend.body.request.status === 'pending', resend.body);
const dup = await ask(tok, { proofs: [await upload(tok)] });
check('a second open request: refused (one per booking)', dup.status === 409, dup.body);
const over = await call('POST', '/v1/book/pay-request/withdraw', { token: tok }, { auth: false });
check('withdraw', over.body && over.body.withdrawn === true, over.body);
const tooMuch = await ask(tok, { amount: 701, proofs: [await upload(tok)] });
check('over the balance: refused', tooMuch.body && tooMuch.body.field === 'amount', tooMuch.body);
const r2 = await ask(tok, { amount: 400, proofs: [await upload(tok)] });
check('a new request after withdrawing', r2.status === 200, r2.body);

let d = await call('GET', '/v1/admin/book/bookings/' + id);
const claim = (d.body.claims || []).find(c => c.status === 'pending');
check('admin sheet lists the request', !!claim && claim.amount === 400, d.body && d.body.claims);
const q = await call('GET', '/v1/admin/book/bookings?eventId=' + EV + '&claims=1');
check('queue: «طلبات دفع» has it', q.body && q.body.counts && q.body.counts.claims === 1 && q.body.rows.length === 1, q.body && q.body.counts);
const acc = await call('POST', '/v1/admin/book/bookings/' + id + '/payments', { kind: 'payment', amount: 400, servantId: SRV, method: 'transfer', receivedAt: stamp(Date.now() - 60000).replace('T', ' '), idemKey: 'pay-a-' + RUN, claimId: claim.id });
check('accept through «إضافة دفعة»: payment + claim accepted', acc.status === 200 && (acc.body.claims || []).some(c => c.id === claim.id && c.status === 'accepted' && c.paymentId), acc.body);
const twice = await call('POST', '/v1/admin/book/bookings/' + id + '/payments', { kind: 'payment', amount: 400, servantId: SRV, method: 'transfer', receivedAt: stamp(Date.now() - 60000).replace('T', ' '), idemKey: 'pay-a2-' + RUN, claimId: claim.id });
check('accepting the same request again: refused', twice.body && twice.body.code === 'final', twice.body);
st = await call('POST', '/v1/book/status', { token: tok }, { auth: false });
check('status: balance 300, request accepted', st.body && st.body.balance === 300 && st.body.request && st.body.request.status === 'accepted', st.body);

const r3 = await ask(tok, { amount: 300, proofs: [await upload(tok)] });
const claim3 = (sql(`SELECT id FROM payment_claims WHERE booking_id = '${id}' AND status = 'pending'`)[0] || {}).id;
const rej = await call('POST', '/v1/admin/book/claims/' + claim3 + '/reject', { reason: 'بروفة: الصورة مش واضحة' });
check('reject with a reason', r3.status === 200 && rej.status === 200, rej.body);
st = await call('POST', '/v1/book/status', { token: tok }, { auth: false });
check('status: the reason shown, «ادفع الباقي» back', st.body && st.body.request && st.body.request.status === 'rejected' && /مش واضحة/.test(st.body.request.reason) && st.body.canPay === true, st.body);
check('activity: payment.request important', (sql(`SELECT severity FROM activity WHERE action = 'payment.request' AND entity_id = '${id}' LIMIT 1`)[0] || {}).severity === 'important');
setSwitch('0');
await new Promise(r => setTimeout(r, 11_000));
st = await call('POST', '/v1/book/status', { token: tok }, { auth: false });
check('switch off: «ادفع الباقي» hidden', st.body && st.body.canPay === false, st.body);
const off = await ask(tok, { amount: 100, proofs: [{ proofId: 'prf-aaaaaaaa', claim: 'x' }] });
check('switch off: a new request refused', off.body && off.body.code === 'disabled', off.body);
const sw = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('NOTIFY_ROUTER', 'NOTIFY_EMAIL', 'PERMS_ENFORCE')").map(r => [r.key, r.value]));
check('switches untouched (all 0)', sw.NOTIFY_ROUTER === '0' && sw.NOTIFY_EMAIL === '0' && sw.PERMS_ENFORCE === '0', sw);
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exitCode = failed ? 1 : 0;
