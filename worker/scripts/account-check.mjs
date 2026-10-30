// Live STAGING check for the youth accounts, batch 1 (docs/PHASE5-PLAN.md P5-1, P5-2):
// the switch, registration + code, duplicates, discovery, sign-in, sessions, recovery, a
// parallel race, CORS, and a scan of D1 for secrets. Uses only @staging.invalid addresses:
// nothing is emailed. Removes its own accounts at the end; never runs against production.
// Run from worker/: node scripts/account-check.mjs
import { spawnSync } from 'node:child_process';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const ORIGIN = 'https://stathanasiosyouth.github.io';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const RUN = Date.now().toString(36);
const stamp = String(Date.now()).slice(-7);
let failed = 0;
let serial = 0;

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
}
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { shell: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('d1: ' + String(r.stderr).slice(0, 300));
  return JSON.parse(r.stdout)[0].results;
}
async function call(method, path, body, { token, origin = ORIGIN } = {}) {
  const t0 = Date.now();
  const res = await fetch(base + path, {
    method,
    headers: { origin, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, ms: Date.now() - t0, headers: res.headers, body: await res.json().catch(() => null) };
}
const post = (path, body, o) => call('POST', path, body, o);
const person = (over = {}) => {
  serial++;
  return { email: `acct-${RUN}-${serial}@staging.invalid`, phone: '010' + stamp + String(serial).padStart(1, '0'), name: 'مينا زكريا عبد المسيح', birthDate: '2000-03-12', turnstile: TOKEN, ...over };
};
const start = f => post('/v1/account/register/start', f);
const verify = (pendingId, code) => post('/v1/account/register/verify', { pendingId, code });
const signin = (email, password, extra = {}) => post('/v1/account/signin', { email, password, turnstile: TOKEN, ...extra });
const me = token => call('GET', '/v1/account/me', null, { token });

// a clean budget for this run (staging's own counters), the switch off first
sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%'");
sql("UPDATE settings SET value = 'off' WHERE key = 'accounts_mode'");
const off = await post('/v1/account/signin', { email: 'x@staging.invalid', turnstile: TOKEN });
check('switch off → every route says so', off.status === 503 && off.body.code === 'accounts_off', off.body);
check('… config too', (await call('GET', '/v1/account/config')).body.mode === 'off');
sql("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'");
sql("UPDATE settings SET value = '0' WHERE key = 'OTP_EMAIL'");

const config = await call('GET', '/v1/account/config');
check('switch on: config, the Turnstile key, the support contact', config.body.mode === 'on' && !!config.body.turnstile && !!config.body.support.whatsapp, config.body);

const noCheck = await post('/v1/account/signin', { email: 'x@staging.invalid' });
check('no Turnstile token → refused', noCheck.status === 403 && noCheck.body.code === 'turnstile', noCheck.body);

const cors = await post('/v1/account/signin', { email: 'x@staging.invalid', turnstile: TOKEN }, { origin: 'https://evil.example' });
check('another origin gets no CORS permission', !cors.headers.get('access-control-allow-origin'));
check('replies are no-store', cors.headers.get('cache-control') === 'no-store');

const real = await start(person({ email: `real-${RUN}@example.com` }));
check('a real address with OTP_EMAIL off → mail_down, nothing written', real.status === 503 && real.body.code === 'mail_down', real.body);
check('… no pending row for it', sql(`SELECT COUNT(*) AS n FROM pending_registrations WHERE email_canon = 'real-${RUN}@example.com'`)[0].n === 0);

const badName = await start(person({ name: 'مينا زكريا' }));
check('a two-part name names the field', badName.status === 400 && badName.body.field === 'name', badName.body);

const A = person();
const missing = await post('/v1/account/signin', { email: A.email, turnstile: TOKEN });
check('discovery: no account yet', missing.body.exists === false && Object.keys(missing.body).sort().join() === 'exists,ok', missing.body);
check('… padded to at least 300 ms', missing.ms >= 300, missing.ms);

const s1 = await start(A);
check('register/start → a pending id and the staging code', s1.status === 200 && /^reg-/.test(s1.body.pendingId) && /^\d{6}$/.test(s1.body.testCode), s1.body);
check('… still no account before the code', (await post('/v1/account/signin', { email: A.email, turnstile: TOKEN })).body.exists === false);
const again = await start(A);
check('asking again inside 60 s → otp_wait', again.status === 429 && again.body.code === 'otp_wait', again.body);
const wrongCode = s1.body.testCode === '000000' ? '000001' : '000000';
const w1 = await verify(s1.body.pendingId, wrongCode);
check('a wrong code → otp_bad, 4 left', w1.body.code === 'otp_bad' && w1.body.left === 4, w1.body);
const done = await verify(s1.body.pendingId, s1.body.testCode.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]));
check('the right code (Arabic digits) → account + password', done.status === 200 && /^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(done.body.password) && done.body.eligible === true, done.status);
const pw = done.body.password;

const row = sql(`SELECT email_verified_via, email_source, created_via, status, pw_version FROM participants WHERE email = '${A.email}'`)[0];
check('the row: verified by code, self, active', row && row.email_verified_via === 'otp' && row.email_source === 'self' && row.created_via === 'self' && row.status === 'active' && row.pw_version === 1, row);

const dupPhone = await start(person({ phone: '+20' + A.phone.slice(1) }));
check('same phone in another spelling → dup_phone', dupPhone.status === 409 && dupPhone.body.code === 'dup_phone', dupPhone.body);
const dupEmail = await start(person({ email: A.email.toUpperCase() }));
check('same email in capitals → dup_email', dupEmail.status === 409 && dupEmail.body.code === 'dup_email', dupEmail.body);

const exists = await post('/v1/account/signin', { email: A.email, turnstile: TOKEN });
check('discovery: exists, nothing else in the reply', exists.body.exists === true && Object.keys(exists.body).sort().join() === 'exists,ok', exists.body);
check('… padded the same', exists.ms >= 300, exists.ms);

const wrong = await signin(A.email, 'AAAA-AAAA-AAAA');
check('wrong password', wrong.status === 401 && wrong.body.code === 'password', wrong.body);
const login = await signin(A.email, pw.toLowerCase().replace(/-/g, ' '));
check('right password, typed forgivingly → a device session', login.status === 200 && /^as1\./.test(login.body.session.token) && login.body.session.kind === 'device', login.status);
const shared = await signin(A.email, pw, { shared: true });
check('shared device → 12 h at most', shared.body.session.kind === 'shared' && shared.body.session.expiresAt - Date.now() <= 12 * 3600000 + 5000, shared.body.session && shared.body.session.kind);
const seen = await me(login.body.session.token);
check('me: the account, eligibility', seen.status === 200 && seen.body.account.email === A.email && seen.body.account.eligibility.state === 'eligible', seen.status);
check('me without a token → session', (await call('GET', '/v1/account/me')).body.code === 'session');

await post('/v1/account/logout', {}, { token: shared.body.session.token });
check('logout ends that session', (await me(shared.body.session.token)).status === 401);
check('… the other device stays', (await me(login.body.session.token)).status === 200);

const neutral = await post('/v1/account/forgot', { email: `nobody-${RUN}@staging.invalid`, turnstile: TOKEN });
const asked = await post('/v1/account/forgot', { email: A.email, turnstile: TOKEN });
check('forgot: the same words for a stranger and an account', neutral.status === 200 && asked.status === 200 && neutral.body.sent === asked.body.sent && neutral.body.minutes === asked.body.minutes, [neutral.body.sent, asked.body.sent]);
check('… and the old password still works', (await signin(A.email, pw)).status === 200);
const unknownVerify = await post('/v1/account/forgot/verify', { email: `nobody-${RUN}@staging.invalid`, code: wrongCode });
const knownVerify = await post('/v1/account/forgot/verify', { email: A.email, code: asked.body.testCode === '000000' ? '000001' : '000000' });
check('forgot/verify: unknown email looks like a wrong code', unknownVerify.body.code === 'otp_bad' && knownVerify.body.code === 'otp_bad' && unknownVerify.body.left === knownVerify.body.left, [unknownVerify.body, knownVerify.body]);
const reset = await post('/v1/account/forgot/verify', { email: A.email, code: asked.body.testCode });
check('the right code → a new password', reset.status === 200 && reset.body.password !== pw, reset.status);
check('… the old password is dead', (await signin(A.email, pw)).body.code === 'password');
check('… every session is dead', (await me(login.body.session.token)).status === 401);
const relogin = await signin(A.email, reset.body.password);
check('… the new password signs in', relogin.status === 200);
await post('/v1/account/logout', { all: true }, { token: relogin.body.session.token });
check('logout everywhere', (await me(relogin.body.session.token)).status === 401);

const G = person({ birthDate: '1980-01-01' });
const g1 = await start(G);
const g2 = await verify(g1.body.pendingId, g1.body.testCode);
check('out of the Admin range: a normal account, eligible false', g2.status === 200 && g2.body.eligible === false, g2.status);
sql("UPDATE settings SET value = '60' WHERE key = 'age_max'");
const wider = await signin(G.email, g2.body.password);
check('wider Admin range: the same person is eligible on the next request', wider.body.account.eligibility.state === 'eligible', wider.body.account);
sql("UPDATE settings SET value = '30' WHERE key = 'age_max'");

// one phone, six people, all at once: D1's UNIQUE index decides
const sharedPhone = '010' + stamp + '9';
const racers = [];
for (let i = 0; i < 6; i++) racers.push(await start(person({ phone: sharedPhone })));
const race = await Promise.all(racers.map(r => verify(r.body.pendingId, r.body.testCode)));
check('6 parallel registrations with one phone → exactly 1', race.filter(r => r.status === 200).length === 1 && race.filter(r => r.body.code === 'dup_phone').length === 5, race.map(r => r.body.code || r.status));

// nothing secret anywhere it should not be
const scan = JSON.stringify([
  sql("SELECT * FROM member_outbox WHERE created_ms > 0 ORDER BY created_ms DESC LIMIT 60"),
  sql("SELECT * FROM participant_audit ORDER BY at DESC LIMIT 60"),
  sql("SELECT * FROM activity WHERE action LIKE 'account.%' ORDER BY at DESC LIMIT 60"),
  sql("SELECT rid, route, code FROM api_log ORDER BY at DESC LIMIT 60")
]);
for (const [what, secret] of [['password', pw], ['new password', reset.body.password], ['code', asked.body.testCode], ['session', login.body.session.token], ['email', A.email], ['phone', A.phone]]) {
  check('no ' + what + ' in the outbox, audit, activity or logs', !scan.includes(secret));
}
const stored = sql(`SELECT pw_hash, pw_enc FROM participants WHERE email = '${A.email}'`)[0];
check('the row has no plain password', !JSON.stringify(stored).includes(reset.body.password));
check('the outbox says test inbox, nothing went to Gmail', sql(`SELECT COUNT(*) AS n FROM member_outbox WHERE class = 'otp' AND status = 'sent' AND (error IS NULL OR error <> 'test inbox') AND created_ms > ${Date.now() - 3600000}`)[0].n === 0);

// this run's own rows go; the switch stays as the page tests need it
sql("DELETE FROM account_sessions WHERE participant_id IN (SELECT id FROM participants WHERE email LIKE '%@staging.invalid')");
sql("DELETE FROM participant_audit WHERE participant_id IN (SELECT id FROM participants WHERE email LIKE '%@staging.invalid')");
sql("DELETE FROM otp_codes WHERE participant_id IN (SELECT id FROM participants WHERE email LIKE '%@staging.invalid')");
sql("DELETE FROM participants WHERE email LIKE '%@staging.invalid'");
sql("DELETE FROM pending_registrations");
sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%'");

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
