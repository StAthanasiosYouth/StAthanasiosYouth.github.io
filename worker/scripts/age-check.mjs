// Phase 1.5 step 10 on staging (age eligibility, BOOKING-PHASE1-COMPLETION-PLAN §4.9):
// a fixture event with a booker range and a switched-off category; public submits
// refused / accepted with the snapshot; an admin booking needing the override.
// Staging only (signed with the staging test key); nothing is notified (switches untouched).
//   node scripts/age-check.mjs
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const P = 'loadtest@staging.invalid';
const RUN = Date.now().toString(36);
const EV = 'evt-age' + RUN;
const SLUG = 'age-' + RUN;
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + String(JSON.stringify(detail)).slice(0, 300))); if (!ok) failed++; };

function token() {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'loadtest-1', email: P, email_verified: true, name: 'loadtest', iat: now, exp: now + 3600 });
  return 'Bearer ' + head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function call(method, path, body, auth = true) {
  const res = await fetch(base + path, { method, headers: { origin: 'https://stathanasiosyouth.github.io', ...(auth ? { authorization: token() } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
function sql(command) {
  const bin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const out = execFileSync(process.execPath, [bin, 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', command], { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) });
  return JSON.parse(out.slice(out.indexOf('['))).flatMap(r => r.results || []);
}
const stamp = ms => { const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day + 'T' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute; };

const start = stamp(Date.now() + 10 * 864e5);
const year = Number(start.slice(0, 4));
const md = start.slice(4, 10);    // '-MM-DD' of the event day
const fixture = {
  schema: 1, v: 'rev1', id: EV, slug: SLUG, kind: 'trip', title: 'بروفة السن ' + RUN, startAt: start, endAt: stamp(Date.now() + 11 * 864e5),
  booking: {
    online: true, opensAt: stamp(Date.now() - 864e5), closesAt: stamp(Date.now() + 9 * 864e5), capacity: 20, showLeft: true, showLeftBelow: 5, perBookingMax: 6, collectNames: false,
    bookerAge: { min: 18, max: 30 },
    pricing: { mode: 'group', categories: [
      { key: 'applicant', label: 'الحاجز', group: 'adult', price: 100, seat: true, min: 1, max: 1, note: '' },
      { key: 'child', label: 'طفل', group: 'child', price: 50, seat: true, min: 0, max: 3, note: '', allowed: false }] },
    payment: { mode: 'full', minFirst: 0, finalDueAt: '' },
    methods: [{ key: 'cash', label: 'كاش', needsProof: false }, { key: 'transfer', label: 'تحويل', needsProof: false, online: true }],
    servants: [{ id: 'srv-aaaa1111', name: 'مينا عادل', methods: ['cash', 'transfer'] }]
  }
};
const submit = over => fetch(base + '/v1/book/submit', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://stathanasiosyouth.github.io' },
  body: JSON.stringify({ slug: SLUG, requestKey: 'age-' + Math.random().toString(36).slice(2, 12), name: 'زائر السن', phone: '0101' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0'),
    counts: { applicant: 1 }, servantId: 'srv-aaaa1111', method: 'transfer', hp: '', revision: 'rev1', turnstile: 'XXXX.DUMMY.TOKEN.XXXX', ...over }) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

check('fixture event with a booker range (18–30) and children switched off', (await call('POST', '/v1/admin/diag/event-fixture', fixture)).status === 200);
const noDob = await submit({});
check('public: no date of birth → age / bookerDob', noDob.body && noDob.body.code === 'age' && noDob.body.field === 'bookerDob', noDob.body);
const dayAfter = new Date(Date.UTC(year - 18, Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)) + 1)).toISOString().slice(0, 10);
const turns18Tomorrow = await submit({ bookerDob: dayAfter });
check('public: 18 the day after the event → refused with the range in words', turns18Tomorrow.body && turns18Tomorrow.body.code === 'age' && /١٨ لـ ٣٠/.test(turns18Tomorrow.body.message || ''), turns18Tomorrow.body);
const child = await submit({ bookerDob: (year - 25) + '-01-01', counts: { applicant: 1, child: 1 } });
check('public: a child (category switched off) → age / counts', child.body && child.body.code === 'age' && child.body.field === 'counts', child.body);
const ok = await submit({ bookerDob: (year - 18) + md });
check('public: 18 on the event day → accepted', ok.status === 200, ok.body);
const row = sql(`SELECT booker_age, age_source, age_rule FROM bookings WHERE event_id = '${EV}'`)[0] || {};
check('snapshot stored: age 18, self, the rule', row.booker_age === 18 && row.age_source === 'self' && /"min":18/.test(row.age_rule || ''), row);
const adm = { eventId: EV, name: 'حجز بالتليفون', phone: '01099990000', counts: { applicant: 1, child: 1 }, bookerDob: (year - 40) + '-01-01' };
const ask = await call('POST', '/v1/admin/book/bookings', { ...adm, requestKey: 'age-adm-' + RUN });
check('admin: outside the rule → needs_override (two reasons)', ask.body && ask.body.code === 'needs_override' && (ask.body.warnings || []).length === 2, ask.body);
const over = await call('POST', '/v1/admin/book/bookings', { ...adm, requestKey: 'age-adm2-' + RUN, overrideAge: true, ageReason: 'بروفة: تجاوز مقصود' });
check('admin: override with a reason → stored, age shown (not the DOB)', over.status === 200 && over.body.booking.age && over.body.booking.age.override && !JSON.stringify(over.body).includes((year - 40) + '-01-01'), over.body);
check('activity: booking.ageOverride logged as important', (sql(`SELECT severity FROM activity WHERE action = 'booking.ageOverride' AND entity_title = '${over.body && over.body.booking ? over.body.booking.ref : ''}'`)[0] || {}).severity === 'important');
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exitCode = failed ? 1 : 0;
