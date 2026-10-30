// Live STAGING check for batch 2 (docs/PHASE5-PLAN.md P5-3, P5-4): the account's sections, «إشعاراتي»,
// the new-device email through the real cron + queue, and «حالة النظام». Uses only @staging.invalid
// addresses: nothing is emailed. Removes its accounts at the end; never runs against production.
// Run from worker/: node scripts/member-check.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const ORIGIN = 'https://stathanasiosyouth.github.io';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const RUN = Date.now().toString(36);
const stamp = String(Date.now()).slice(-7);
let failed = 0;

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
async function call(method, path, body, { token, ua } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { origin: ORIGIN, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(ua ? { 'user-agent': ua } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const UA = { android: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537', windows: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537', iphone: 'Mozilla/5.0 (iPhone) Version/17 Mobile Safari/604' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%'");
const before = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('MEMBER_EMAIL', 'accounts_mode')").map(r => [r.key, r.value]));
sql("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'");

const budget = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key LIKE 'MAIL_%'").map(r => [r.key, r.value]));
check('the reservations (owner D4)', budget.MAIL_RESERVE_OTP === '100' && budget.MAIL_RESERVE_MEMBER === '100' && budget.MAIL_ADMIN_BUDGET === '120' && budget.MAIL_RESERVE_CRITICAL === '50' && budget.MAIL_BULK_PER_HOUR === '30', budget);

const email = `mem-${RUN}@staging.invalid`;
const s = await call('POST', '/v1/account/register/start', { email, phone: '012' + stamp + '1', name: 'مينا زكريا فؤاد', birthDate: '2000-03-12', turnstile: TOKEN });
const d = await call('POST', '/v1/account/register/verify', { pendingId: s.body.pendingId, code: s.body.testCode });
check('a fresh account', d.status === 200, d.body);
const signin = ua => call('POST', '/v1/account/signin', { email, password: d.body.password, turnstile: TOKEN }, { ua });

const first = await signin(UA.android);
const token = first.body.session.token;
check('first sign-in: no new-device row', sql(`SELECT COUNT(*) AS n FROM member_outbox WHERE kind = 'acct.dev' AND participant_id = '${first.body.account.id}'`)[0].n === 0);

const prefs = await call('GET', '/v1/account/prefs', null, { token });
const on = Object.fromEntries(prefs.body.groups.map(g => [g.key, g.on]));
check('«إشعاراتي»: Tier 2 on, Tier 3 off by default', on.bookings && on.results && on.store && !on.security, prefs.body);
check('… needs a session', (await call('GET', '/v1/account/prefs')).status === 401);
const refused = await call('POST', '/v1/account/prefs', { prefs: { nope: true } }, { token });
check('… an unknown group is refused', refused.status === 400, refused.body);

const id = first.body.account.id;
const statusOf = dedupe => sql(`SELECT status, error FROM member_outbox WHERE participant_id = '${id}' AND kind = 'acct.dev' ORDER BY created_ms DESC LIMIT ${dedupe}`);
async function settle(ms = 150000) {
  const t0 = Date.now();
  for (;;) {
    const open = sql(`SELECT COUNT(*) AS n FROM member_outbox WHERE participant_id = '${id}' AND status IN ('queued', 'failed', 'deferred')`)[0].n;
    if (!open || Date.now() - t0 > ms) return open;
    await sleep(10000);
  }
}

// the switch off: a row waits, nothing leaves
sql("UPDATE settings SET value = '0' WHERE key = 'MEMBER_EMAIL'");
await signin(UA.windows);
const waiting = statusOf(1)[0];
check('new device: a row, in the same request', waiting && waiting.status === 'queued', waiting);
await sleep(75000);
check('MEMBER_EMAIL off: the cron leaves it waiting', statusOf(1)[0].status === 'queued', statusOf(1)[0]);

// on, but not opted in: the real cron + queue suppress it
sql("UPDATE settings SET value = '1' WHERE key = 'MEMBER_EMAIL'");
check('… on: the real cron and queue finish it', (await settle()) === 0);
const muted = statusOf(1)[0];
check('not opted in → suppressed by choice', muted.status === 'suppressed' && muted.error === 'prefs', muted);

// opted in: delivered (to the test inbox)
const saved = await call('POST', '/v1/account/prefs', { prefs: { security: true } }, { token });
check('opt in, saved', saved.body.groups.find(g => g.key === 'security').on === true, saved.body);
await signin(UA.iphone);
check('opted in: the cron delivers it', (await settle()) === 0);
const sent = statusOf(1)[0];
check('… marked sent, to the test inbox (no Gmail)', sent.status === 'sent' && sent.error === 'test inbox', sent);

const sec = await call('GET', '/v1/account/security', null, { token });
const devices = sec.body.sessions.map(x => x.device).sort().join();
check('security: the three devices, this one marked', devices === 'Android Chrome,Windows Chrome,iPhone Safari' && sec.body.sessions.filter(x => x.current).length === 1, sec.body);
check('… no token in the reply', !JSON.stringify(sec.body).includes('as1.'));

// «حالة النظام» as the Primary sees it
const status = await call('GET', '/v1/admin/notify/status', null, { token: google('loadtest@staging.invalid', 'loadtest-1') });
check('«حالة النظام»: member email in the reply', status.status === 200 && status.body.member && status.body.member.accounts === true && status.body.member.on === true, status.body);
check('… counts per class', status.body.member.classes.member_tx && status.body.member.classes.member_tx.sent >= 1 && status.body.member.classes.member_tx.suppressed >= 1, status.body.member);
check('… the sign-in form\'s budget', typeof status.body.member.discovery.today === 'number' && status.body.member.discovery.cap === 400, status.body.member.discovery);
check('… the shared budget carries the new classes', status.body.quota.member === 100 && status.body.quota.bulkPerHour === 30, status.body.quota);

const scan = JSON.stringify(sql(`SELECT * FROM member_outbox WHERE participant_id = '${id}'`));
check('the outbox holds no address, password or body', !scan.includes(email) && !scan.includes(d.body.password));

// cleanup: this run's rows; the switches as they were
sql(`DELETE FROM member_prefs WHERE participant_id = '${id}'`);
sql(`DELETE FROM member_outbox WHERE participant_id = '${id}'`);
sql(`DELETE FROM account_sessions WHERE participant_id = '${id}'`);
sql(`DELETE FROM participant_audit WHERE participant_id = '${id}'`);
sql(`DELETE FROM participants WHERE id = '${id}'`);
sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%'");
sql(`UPDATE settings SET value = '${before.MEMBER_EMAIL}' WHERE key = 'MEMBER_EMAIL'`);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
