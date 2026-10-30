// Live STAGING check for batch 3 (docs/PHASE5-PLAN.md P5-5, P5-6, 5A-4): accounts in the admin, the grant
// split, view vs reset password, corrections, points and seasons, a signed-in booking through the real
// cron + queue. Uses only @staging.invalid addresses: nothing is emailed. Cleans up after itself.
// Run from worker/: node scripts/participants-check.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { msStamp } from '../src/book/model.js';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const ORIGIN = 'https://stathanasiosyouth.github.io';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const RUN = Date.now().toString(36);
const stamp = String(Date.now()).slice(-6);
const PRIMARY = 'loadtest@staging.invalid';
const ADMIN = `chk-${RUN}@staging.invalid`;
const SLUG = `acct-chk-${RUN}`;
const EVENT_ID = 'evt-chk' + RUN;
let failed = 0;
let serial = 0;
const ids = [];

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
}
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { shell: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('d1: ' + String(r.stderr).slice(0, 300));
  return JSON.parse(r.stdout)[0].results;
}
function google(email, sub) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: 'check', iat: now, exp: now + 3600 });
  return head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function call(method, path, body, token) {
  const res = await fetch(base + path, { method, headers: { origin: ORIGIN, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}
const P = google(PRIMARY, 'loadtest-1');
const adminP = (method, path, body) => call(method, '/v1/admin/' + path, body, P);
const person = (over = {}) => {
  serial++;
  const email = over.email || `part-${RUN}-${serial}@staging.invalid`;
  return { name: 'مينا زكريا فؤاد', email, emailConfirm: email, checkMethod: 'in_person_readback', phone: '015' + stamp + String(serial).padStart(2, '0'), birthDate: '2000-03-12', ...over };
};
async function create(over) {
  const f = person(over);
  const r = await adminP('POST', 'participants', f);
  if (r.status === 200) ids.push(r.body.id);
  return { ...f, ...r.body, status: r.status };
}
const signin = (a, password) => call('POST', '/v1/account/signin', { email: a.email, password: password || a.password, turnstile: TOKEN });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const before = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('MEMBER_EMAIL', 'PERMS_ENFORCE', 'BOOKING_MODULE')").map(r => [r.key, r.value]));
sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%' OR key LIKE 'book.%' OR key LIKE 'participants.%'");
sql("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'");
sql("UPDATE settings SET value = '1' WHERE key = 'MEMBER_EMAIL'");
sql("UPDATE settings SET value = '1' WHERE key IN ('PERMS_ENFORCE', 'BOOKING_MODULE')");

try {
  // ---------- create without OTP ----------
  const a = await create();
  check('create without OTP → a password, once', a.status === 200 && /^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(a.password), a);
  const row = sql(`SELECT status, email_source, email_verified_via FROM participants WHERE id = '${a.id}'`)[0];
  check('… active and administratively verified', row.status === 'active' && row.email_source === 'admin' && row.email_verified_via === 'admin', row);
  check('… signs in', (await signin(a)).status === 200);
  check('… the email typed differently twice is refused', (await adminP('POST', 'participants', person({ emailConfirm: 'x@staging.invalid' }))).body.field === 'emailConfirm');
  const dup = await adminP('POST', 'participants', person({ phone: a.phone }));
  check('… a phone in use is refused, naming the field', dup.body.code === 'dup_phone' && dup.body.field === 'phone', dup.body);

  // ---------- the grant split ----------
  sql(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${ADMIN}', 'chk', 'admin', 1, 0)`);
  const N = google(ADMIN, 'chk-' + RUN);
  const asN = (method, path, body) => call(method, '/v1/admin/' + path, body, N);
  check('no grant: the list is refused', (await asN('GET', 'participants')).status === 403);
  sql(`INSERT INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES ('${ADMIN}', 'participants.view', 'all', '${PRIMARY}', 0)`);
  check('participants.view: the list', (await asN('GET', 'participants')).status === 200);
  check('… can not correct a date of birth', (await asN('POST', `participants/${a.id}/dob`, { birthDate: '1999-01-01', reason: 'x y' })).status === 403);
  check('… can not reset a password', (await asN('POST', `participants/${a.id}/reset-password`, { reason: 'x y' })).status === 403);
  check('… can not view a password', (await asN('POST', `participants/${a.id}/view-password`, {})).status === 403);

  // ---------- viewing vs resetting ----------
  const token = (await signin(a)).body.session.token;
  const views = await Promise.all([1, 2, 3].map(() => adminP('POST', `participants/${a.id}/view-password`, {})));
  check('Primary views the current password, repeatedly', views.every(v => v.status === 200 && v.body.password === a.password), views.map(v => v.status));
  check('… no-store', views[0].headers.get('cache-control') === 'no-store');
  check('… sessions untouched', (await call('GET', '/v1/account/me', null, token)).status === 200);
  check('… every view logged', sql(`SELECT COUNT(*) AS n FROM participant_audit WHERE participant_id = '${a.id}' AND action = 'password.view'`)[0].n === 3);
  const noCheck = await adminP('POST', `participants/${a.id}/reset-password`, { reason: 'طلب', support: true });
  check('support reset needs a check method', noCheck.body.field === 'checkMethod', noCheck.body);
  const reset = await adminP('POST', `participants/${a.id}/reset-password`, { reason: 'نسي الباسورد', support: true, checkMethod: 'details_match' });
  check('reset: a new password', reset.status === 200 && reset.body.password !== a.password, reset.status);
  check('… the old one and every session are dead', (await signin(a)).body.code === 'password' && (await call('GET', '/v1/account/me', null, token)).status === 401);
  check('… a critical notification row', sql(`SELECT severity FROM activity WHERE action = 'participant.reset' AND entity_id = '${a.id}'`)[0].severity === 'critical');
  const pw = reset.body.password;

  // ---------- corrections ----------
  const g = await create({ birthDate: '1980-01-01' });
  const sheetG = await adminP('GET', 'participants/' + g.id);
  check('a guest shows as guest', sheetG.body.person.eligibility.state === 'guest', sheetG.body.person);
  const dob = await adminP('POST', `participants/${g.id}/dob`, { birthDate: '2001-01-01', reason: 'اتكتب غلط' });
  check('DOB correction: eligible on the next request', dob.body.person.eligibility.state === 'eligible', dob.body.person);
  const audit = sql(`SELECT old_value, new_value FROM participant_audit WHERE participant_id = '${g.id}' AND action = 'dob.correct'`)[0];
  check('… audited old → new', audit.old_value === '1980-01-01' && audit.new_value === '2001-01-01', audit);
  const over = await adminP('POST', `participants/${g.id}/eligibility`, { override: 'guest', reason: 'قرار' });
  check('override to guest', over.body.person.eligibility.state === 'guest' && over.body.person.eligibility.source === 'override', over.body.person);
  await adminP('POST', `participants/${g.id}/eligibility`, { override: 'auto', reason: 'رجوع' });
  const newMail = `part-${RUN}-new@staging.invalid`;
  const em = await adminP('POST', `participants/${g.id}/email`, { email: newMail, emailConfirm: newMail, checkMethod: 'member_typed', reason: 'الإيميل ضاع' });
  check('email correction', em.status === 200 && em.body.person.email === newMail && em.body.person.emailChangedRecently === true, em.status);
  const em2 = await adminP('POST', `participants/${g.id}/email`, { email: 'z' + newMail, emailConfirm: 'z' + newMail, checkMethod: 'member_typed', reason: 'تاني' });
  check('… a second within 7 days is refused without the override', em2.body.code === 'recent', em2.body);
  const block = await adminP('POST', `participants/${g.id}/block`, { reason: 'مكرر' });
  check('block', block.body.person.status === 'blocked', block.body.person);
  check('… sign-in says blocked', (await signin({ email: newMail, password: g.password })).body.code === 'blocked');
  await adminP('POST', `participants/${g.id}/unblock`, { reason: 'اتحلت' });
  check('unblock', (await signin({ email: newMail, password: g.password })).status === 200);
  const review = await adminP('GET', 'participants/review');
  check('the review list answers', review.status === 200 && Array.isArray(review.body.people), review.status);
  const exp = await adminP('GET', 'participants/export');
  check('export: rows, no credential', exp.status === 200 && exp.body.rows.length >= 2 && !JSON.stringify(exp.body).includes(pw) && !/pw_|password/.test(JSON.stringify(Object.keys(exp.body.rows[0]))), exp.status);

  // ---------- points ----------
  const season = (await adminP('GET', 'points/seasons')).body.seasons.find(s => s.status === 'active');
  check('an active season', !!season, season);
  const add = await adminP('POST', `participants/${a.id}/points`, { amount: 100, note: 'حفظ', notePublic: true, key: 'chk-add-' + RUN });
  check('add points', add.status === 200 && add.body.balance === 100, add.body);
  const same = await adminP('POST', `participants/${a.id}/points`, { amount: 100, note: 'حفظ', notePublic: true, key: 'chk-add-' + RUN });
  check('… the same key adds nothing', same.body.replay === true && same.body.balance === 100, same.body);
  check('… below zero is refused', (await adminP('POST', `participants/${a.id}/points`, { amount: -101, note: 'خصم', key: 'chk-low-' + RUN })).status === 400);
  const deduct = await adminP('POST', `participants/${a.id}/points`, { amount: -30, note: 'خصم خاص', key: 'chk-ded-' + RUN });
  check('deduct', deduct.body.balance === 70, deduct.body);
  const mine = (await signin(a, pw)).body.session.token;
  const pts = await call('GET', '/v1/account/points', null, mine);
  check('member view: balance, the public note, not the private one', pts.body.balance === 70 && JSON.stringify(pts.body).includes('حفظ') && !JSON.stringify(pts.body).includes('خصم خاص'), pts.body);
  check('… not frozen while eligible', pts.body.frozen === false);
  await adminP('POST', `participants/${a.id}/eligibility`, { override: 'guest', reason: 'اختبار' });
  check('out of range: frozen, kept', (await call('GET', '/v1/account/points', null, mine)).body.frozen === true);
  await adminP('POST', `participants/${a.id}/eligibility`, { override: 'auto', reason: 'رجوع' });

  const b = await create();
  const moved = await adminP('POST', `participants/${a.id}/transfer`, { to: b.id, amount: 20, note: 'حساب مكرر', key: 'chk-trn-' + RUN });
  check('transfer: both sides', moved.body.balance === 50 && (await adminP('GET', 'participants/' + b.id)).body.points.balance === 20, moved.body);
  const stale = await adminP('POST', `points/seasons/${season.id}/close`, { key: 'not-the-key', next: { name: 'موسم الفحص' } });
  check('closing with old numbers is refused', stale.body.code === 'stale', stale.body);

  // ---------- a signed-in booking ----------
  const startAt = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 16);
  const endAt = new Date(Date.now() + 11 * 86400000).toISOString().slice(0, 16);
  const opensAt = new Date(Date.now() - 86400000).toISOString().slice(0, 16);
  const closesAt = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 16);
  const fixture = await adminP('POST', 'diag/event-fixture', {
    schema: 1, v: 'rev' + RUN, id: EVENT_ID, slug: SLUG, kind: 'trip', title: 'فعالية الفحص', startAt, endAt,
    booking: {
      online: true, opensAt, closesAt, capacity: 10, perBookingMax: 6, bookerAge: { min: 18, max: 30 },
      pricing: { mode: 'group', categories: [{ key: 'applicant', label: 'الحاجز', group: 'adult', price: 100, seat: true, min: 1, max: 1 }] },
      payment: { mode: 'full', minFirst: 0, finalDueAt: '' },
      methods: [{ key: 'transfer', label: 'تحويل', needsProof: false, online: true }],
      servants: [{ id: 'srv-chk11111', name: 'خادم', methods: ['transfer'] }]
    }
  });
  check('a test event with a booker range', fixture.status === 200, fixture.body);
  await sleep(11000);   // the module switch's own 10 s cache
  const state = await call('GET', `/v1/book/state?slug=${SLUG}`);
  check('state: accounts on, this event needs one', state.body.account && state.body.account.on === true && state.body.account.required === true, state.body);
  const sub = over2 => ({ slug: SLUG, requestKey: 'rq-' + RUN + '-' + (++serial), name: 'مينا زكريا', phone: '01012345678', counts: { applicant: 1 }, servantId: 'srv-chk11111', method: 'transfer', hp: '', revision: state.body.revision, turnstile: TOKEN, ...over2 });
  const anon = await call('POST', '/v1/book/submit', sub({ bookerDob: '2000-01-01' }));
  check('signed out: refused', anon.status === 401 && anon.body.code === 'account_required', anon.body);
  const yes = await call('POST', '/v1/book/submit', sub({ bookerDob: '1950-01-01' }), mine);
  check('signed in: booked, a client DOB ignored', yes.status === 200, yes.body);
  const bk = sql(`SELECT id, version, participant_id, age_source, booker_dob FROM bookings WHERE event_id = '${EVENT_ID}'`)[0];
  check('… linked, the age from the account', bk.participant_id === a.id && bk.age_source === 'account' && bk.booker_dob === a.birthDate, bk);
  const list = await call('GET', '/v1/account/bookings', null, mine);
  check('«حجوزاتي» lists it, no token', list.body.bookings.some(x => x.ref === yes.body.ref) && !JSON.stringify(list.body).includes('status_token'), list.body);
  const rejected = await call('POST', '/v1/book/submit', sub({ phone: '01012345679' }), (await signin({ email: g.email === newMail ? newMail : newMail, password: g.password })).body.session.token);
  check('… another booker of age books too', rejected.status === 200, rejected.body);

  const conf = await adminP('POST', `book/bookings/${bk.id}/confirm`, { version: bk.version, payments: [{ kind: 'payment', amount: 100, servantId: 'srv-chk11111', method: 'transfer', receivedAt: msStamp(Date.now() - 60000), idemKey: 'pay-chk-' + RUN }] });
  check('confirm', conf.status === 200, conf.body);
  const notified = await adminP('POST', `book/events/${EVENT_ID}/notify`, { changes: [{ field: 'time', from: '٦ ص', to: '٧ ص' }], idemKey: 'ntc-chk-' + RUN });
  check('«بلّغ الحاجزين»', notified.status === 200 && notified.body.notified >= 1, notified.body);

  // the real cron and queue finish every row of this person
  const open = () => sql(`SELECT COUNT(*) AS n FROM member_outbox WHERE participant_id = '${a.id}' AND status IN ('queued', 'failed', 'deferred')`)[0].n;
  const t0 = Date.now();
  while (open() && Date.now() - t0 < 200000) await sleep(10000);
  check('the cron and queue finish every email', open() === 0);
  const rows = sql(`SELECT kind, status, error FROM member_outbox WHERE participant_id = '${a.id}'`);
  const of = kind => rows.filter(r => r.kind === kind);
  check('the creation notice: to the test inbox', of('acct.new')[0] && of('acct.new')[0].status === 'sent' && of('acct.new')[0].error === 'test inbox', rows);
  check('the support-reset notice', of('acct.pw')[0] && of('acct.pw')[0].status === 'sent', rows);
  check('the points deduction', of('pts.deduct')[0] && of('pts.deduct')[0].status === 'sent', rows);
  check('the confirmation', of('book.confirmed')[0] && of('book.confirmed')[0].status === 'sent', rows);
  check('the event change', of('book.eventChange')[0] && of('book.eventChange')[0].status === 'sent', rows);
  check('the receipt of a confirmed booking: superseded, or sent before it', ['superseded', 'sent'].includes((of('book.received')[0] || {}).status), rows);
  const scan = JSON.stringify(sql(`SELECT * FROM member_outbox WHERE participant_id = '${a.id}'`)) + JSON.stringify(sql(`SELECT * FROM activity WHERE entity_id = '${a.id}'`));
  check('no password, or member email, in the outbox or activity', !scan.includes(pw) && !scan.includes(a.password) && !scan.includes(a.email));
} finally {
  // this run's rows only; the switches as they were
  const q = "(SELECT id FROM participants WHERE email LIKE 'part-" + RUN + "%')";
  sql(`DELETE FROM payments WHERE event_id = '${EVENT_ID}'`);
  sql(`DELETE FROM bookings WHERE event_id = '${EVENT_ID}'`);
  sql(`DELETE FROM event_notices WHERE event_id = '${EVENT_ID}'`);
  sql(`DELETE FROM event_cfg WHERE id = '${EVENT_ID}'`);
  sql(`DELETE FROM book_news WHERE event_id = '${EVENT_ID}'`);
  sql(`DELETE FROM points_ledger WHERE participant_id IN ${q}`);
  sql(`DELETE FROM member_outbox WHERE participant_id IN ${q}`);
  sql(`DELETE FROM account_sessions WHERE participant_id IN ${q}`);
  sql(`DELETE FROM participant_audit WHERE participant_id IN ${q}`);
  sql(`DELETE FROM participants WHERE email LIKE 'part-${RUN}%'`);
  sql(`DELETE FROM admin_grants WHERE email = '${ADMIN}'`);
  sql(`DELETE FROM admins WHERE email = '${ADMIN}'`);
  sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%' OR key LIKE 'book.%'");
  for (const [k, v] of Object.entries(before)) sql(`UPDATE settings SET value = '${v}' WHERE key = '${k}'`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
