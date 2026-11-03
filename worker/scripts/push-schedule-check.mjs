// Live STAGING check for Phase 6 Step 4c (docs/PHASE6-PLAN.md): the schedule, «إشعارات الموبايل» and the minute cron,
// against the real FCM with a made-up token (Google refuses it: no device gets anything).
// Turns settings.PUSH_SENDER = 'worker' on for the cron part and puts it back, restores the store's schedule, and
// removes its own rows. Run from worker/: node scripts/push-schedule-check.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const RUN = Date.now().toString(36);
const TOKEN = ('chk_' + RUN + '_1_').padEnd(150, 'x');
let failed = 0;

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
}
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { encoding: 'utf8', shell: true });
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
  const res = await fetch(base + path, { method, headers: { origin: ORIGIN, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const P = google('loadtest@staging.invalid', 'loadtest-1');
const wait = ms => new Promise(r => setTimeout(r, ms));
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const before = await call('GET', '/v1/admin/store/schedule', null, P);
if (before.status !== 200) { console.error('store schedule unreadable', before); process.exit(1); }
const hadSender = sql("SELECT value FROM settings WHERE key = 'PUSH_SENDER'")[0] || null;
const ENTRY = 'psh-' + RUN.padEnd(10, '0').slice(0, 10).replace(/[^0-9a-f]/g, 'a');

try {
  // the screen's calls, signed in
  check('the routes refuse without a credential', (await call('POST', '/v1/admin/push/state', {})).status === 401);
  const state = await call('POST', '/v1/admin/push/state', {}, P);
  check('«إشعارات الموبايل»: the state from the Worker\'s own live content', state.status === 200 && state.body.configured === true && Array.isArray(state.body.candidates) && state.body.limits.perDay === 10, state);

  // the store's notify choices make the schedule; the list and a cancel
  const saved = await call('POST', '/v1/admin/store/schedule', { mode: 'auto', opensAt: day(10) + 'T19:00', closesAt: day(20) + 'T10:00', notify: { open1d: true, close1h: true } }, P);
  check('the store saves its notify choices', saved.status === 200 && saved.body.notify.open1d === true && saved.body.notify.openAt === false, saved);
  const list = await call('POST', '/v1/admin/push/schedule', {}, P);
  const mine = (list.body.entries || []).filter(e => e.status === 'pending' && e.kind.startsWith('shop-'));
  check('… two moments scheduled', mine.length === 2, list.body);
  check('… the sender is off: «authorized» says so', list.body.auto && list.body.auto.authorized === false, list.body.auto);
  const cancelled = await call('POST', '/v1/admin/push/schedule/cancel', { id: mine[0].id }, P);
  check('… one cancelled', cancelled.status === 200 && cancelled.body.entries.find(e => e.id === mine[0].id).status === 'cancelled', cancelled.body);

  // the minute cron: one moment due now, a made-up device, the sender on
  sql(`INSERT INTO push_devices (id, token, audience, created_ms, last_ms) VALUES ('h${RUN.padEnd(40, '0').slice(0, 40).replace(/[^0-9a-f]/g, 'a')}', '${TOKEN}', 'public', 1, ${Date.now()})`);
  const now = Date.now();
  sql(`INSERT INTO push_schedule (id, notif_id, kind, send_wall, send_ms, expire_wall, title, body, send_key, updated_ms) VALUES ('${ENTRY}', 'notif-chk-${RUN}', 'shop-open', '2026-01-01T00:00', ${now - 1000}, '2099-01-01T00:00', 'فحص', 'فحص', 'auto-chk${RUN}', ${now})`);
  sql(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('PUSH_SENDER', 'worker', ${now}, 'check') ON CONFLICT(key) DO UPDATE SET value = 'worker'`);
  let row = null;
  for (let i = 0; i < 30 && !(row && row.status !== 'pending'); i++) {
    await wait(5000);
    row = sql(`SELECT status, result FROM push_schedule WHERE id = '${ENTRY}'`)[0];
  }
  check('the minute cron sent the due moment', row && row.status === 'sent', row);
  let send = null;
  for (let i = 0; i < 12 && !(send && send.finished_ms); i++) {
    await wait(3000);
    send = sql(`SELECT status, targets, sent, removed, error, finished_ms FROM push_sends WHERE ref = 'notif-chk-${RUN}'`)[0];
  }
  check('… through the queue to FCM, which refused the made-up token: removed, no auth error', send && send.finished_ms && send.removed === 1 && !send.error, send);
  check('… with the sender on, «authorized» says so', (await call('POST', '/v1/admin/push/auto', {}, P)).body.authorized === true);
} finally {
  // put everything back
  if (hadSender) sql(`UPDATE settings SET value = '${hadSender.value}' WHERE key = 'PUSH_SENDER'`);
  else sql("DELETE FROM settings WHERE key = 'PUSH_SENDER'");
  const b = before.body;
  await call('POST', '/v1/admin/store/schedule', { mode: b.mode, opensAt: b.opensAt || '', closesAt: b.closesAt || '', allowCancel: b.allowCancel === true, notify: b.notify || {} }, P);
  sql(`DELETE FROM push_parts WHERE send_id IN (SELECT id FROM push_sends WHERE ref = 'notif-chk-${RUN}')`);
  sql(`DELETE FROM push_sends WHERE ref = 'notif-chk-${RUN}'`);
  sql(`DELETE FROM push_schedule WHERE id = '${ENTRY}' OR (kind LIKE 'shop-%' AND updated_ms >= ${Date.now() - 3600000})`);
  sql(`DELETE FROM push_devices WHERE token LIKE 'chk_${RUN}%'`);
  sql("DELETE FROM activity WHERE action = 'push' AND entity_type = 'notifications' AND actor = 'loadtest@staging.invalid'");
}
const after = sql("SELECT value FROM settings WHERE key = 'PUSH_SENDER'")[0] || null;
check('PUSH_SENDER is back as it was', JSON.stringify(after) === JSON.stringify(hadSender), after);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
