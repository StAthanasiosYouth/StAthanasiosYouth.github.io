// Live STAGING check for «خبزنا اليومي» W3 (docs/daily-bread/PLAN.md §3 W3): a fixture program uploaded in parts and
// activated, the published files, three devices' orders (each = the page's orderFor), a member's reflection and its
// 20-minute lock (simulated time: the row is aged in D1), an admin alert row from the daily housekeeping, the stats and
// the reflections' audit row. NEVER a real push: it refuses to run unless NOTIFY_ROUTER ≠ '1', PUSH_SENDER ≠ 'worker'
// and BREAD_PUSH = '0' on staging, and it never touches those settings. Uses @staging.invalid addresses (no email).
// Cleans up after itself (BREAD_MODULE back to what it was, the fixture's rows removed).
//
// Run from worker/:  node scripts/bread-check.mjs
// The staging keys (.staging-test-key.pem) are read from STAGING_KEYS_DIR, else from this worker/ folder.
// Staging rate limits are real: wait ~10 minutes between two runs.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSign } from 'node:crypto';
import { orderFor } from '../src/bread/model.js';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const ORIGIN = 'https://stathanasiosyouth.github.io';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const KEYS = process.env.STAGING_KEYS_DIR || fileURLToPath(new URL('..', import.meta.url));
const PEM = readFileSync(join(KEYS, '.staging-test-key.pem'), 'utf8');
const RUN = Date.now().toString(36);
const stamp = String(Date.now()).slice(-6);
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
async function call(method, path, body, token) {
  const res = await fetch(base + path, { method, headers: { origin: ORIGIN, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}
const P = google('loadtest@staging.invalid', 'loadtest-1');
const admin = (method, path, body) => call(method, '/v1/admin/' + path, body, P);
async function member() {
  const f = { email: `bread-${RUN}@staging.invalid`, phone: '012' + stamp + '77', name: 'مينا زكريا فؤاد', birthDate: '2001-05-09', turnstile: TOKEN };
  const s = await call('POST', '/v1/account/register/start', f);
  const d = await call('POST', '/v1/account/register/verify', { pendingId: s.body && s.body.pendingId, code: s.body && s.body.testCode });
  const si = await call('POST', '/v1/account/signin', { email: f.email, password: d.body && d.body.password, turnstile: TOKEN });
  if (!si.body || !si.body.session) throw new Error('member sign-in: ' + JSON.stringify([s.body, d.body && d.body.code, si.body]).slice(0, 300));
  return { token: si.body.session.token, id: si.body.account.id };
}
const topic = n => ({
  n, title: '[فحص] موضوع ' + n, verseRef: 'يوحنا ٦: ٣٥', verse: 'أَنَا هُوَ خُبْزُ الْحَيَاةِ. مَنْ يُقْبِلْ إِلَيَّ فَلاَ يَجُوعُ.', readingRef: 'يوحنا ٦: ٣٢–٣٥',
  reading: [{ book: 'يوحنا', chapter: 6, verses: [[32, 'نص تجربة ٣٢'], [33, 'نص تجربة ٣٣'], [34, 'نص تجربة ٣٤'], [35, 'نص تجربة ٣٥']] }],
  meditation: 'تأمل تجربة لليوم ' + n + '. ده نص فحص على Staging بس.', question: n % 2 ? 'سؤال تجربة؟' : null
});

// ---------- guards: no real notification can leave ----------
const guard = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('NOTIFY_ROUTER', 'PUSH_SENDER', 'BREAD_PUSH', 'BREAD_MODULE')").map(r => [r.key, r.value]));
if (guard.NOTIFY_ROUTER === '1' || guard.PUSH_SENDER === 'worker' || (guard.BREAD_PUSH || '0') !== '0') {
  console.error('refusing: staging could send a real push now', JSON.stringify(guard));
  process.exit(2);
}
check('guards: NOTIFY_ROUTER off, PUSH_SENDER not worker, BREAD_PUSH 0', true);
const moduleBefore = guard.BREAD_MODULE || '0';
const live = sql("SELECT id, name FROM bread_programs WHERE status = 'scheduled'");
if (live.length) { console.error('refusing: staging already has a scheduled program', JSON.stringify(live)); process.exit(2); }

let id = null;
try {
  // ---------- the program ----------
  const DAYS = 8;
  const c = await admin('POST', 'bread/programs', { name: '[فحص] برنامج ' + RUN, days: DAYS });
  check('create a draft', c.status === 200 && /^brd-/.test(c.body.program.id), c.body);
  id = c.body.program.id;
  const bad = await admin('POST', `bread/programs/${id}/topics`, { topics: [topic(1), { ...topic(2), title: '' }] });
  check('a bad row is refused, nothing stored', bad.status === 400 && bad.body.errors.some(e => e.n === 2), bad.body);
  const up1 = await admin('POST', `bread/programs/${id}/topics`, { topics: [1, 2, 3, 4, 5].map(topic) });
  const up2 = await admin('POST', `bread/programs/${id}/topics`, { topics: [6, 7, 8].map(topic) });
  check('upload in two parts → ready', up1.body.uploaded === 5 && up2.body.ready === true, [up1.body, up2.body]);
  const a = await admin('POST', `bread/programs/${id}/activate`, { mode: 'after' });
  check('activate: live today for 8 days', a.status === 200 && a.body.program.state === 'live' && a.body.program.daysLeft === DAYS - 1, a.body);
  const today = a.body.program.startsOn;

  // ---------- the member's side (module on for the check only) ----------
  const off = await call('POST', '/v1/bread/today', { seed: 'chk-dev-a-' + RUN });
  check('module off → disabled', off.body && off.body.code === 'disabled', off.body);
  await admin('POST', 'bread/settings', { module: true });
  const seeds = ['chk-dev-a-' + RUN, 'chk-dev-b-' + RUN, 'chk-dev-c-' + RUN];
  const days = [];
  for (const seed of seeds) {
    const t = await call('POST', '/v1/bread/today', { seed });
    const want = orderFor(seed, id, DAYS)[0] + 1;
    check('device ' + seed.slice(8, 9) + ': today = orderFor (n ' + want + ')', t.body && t.body.state === 'live' && t.body.n === want && t.body.topic && t.body.topic.n === want, t.body);
    days.push(t.body && t.body.n);
    const full = orderFor(seed, id, DAYS);
    check('device ' + seed.slice(8, 9) + ': a full order without repeats', new Set(full).size === DAYS, full);
  }
  check('three devices, three different orders', new Set(seeds.map(s => orderFor(s, id, DAYS).join(','))).size === 3, seeds.map(s => orderFor(s, id, DAYS)));
  const idx = await call('GET', '/v1/bread/file/index');
  check('the index file names the program', idx.status === 200 && idx.body.programs[0].id === id, idx.body);
  const f1 = await call('GET', `/v1/bread/file/${id}/${days[0]}`);
  check('a day file is served (etag)', f1.status === 200 && f1.body.n === days[0] && !!f1.headers.get('etag'), f1.body);
  const o1 = await call('POST', '/v1/bread/open', { seed: seeds[0], kind: 'open' });
  const o2 = await call('POST', '/v1/bread/open', { seed: seeds[0], kind: 'open' });
  const r1 = await call('POST', '/v1/bread/open', { seed: seeds[0], kind: 'read' });
  check('open counted once, «قريت» once', o1.body.counted === true && o2.body.counted === false && r1.body.counted === true, [o1.body, o2.body, r1.body]);

  // ---------- reflection + its 20 minutes ----------
  const m = await member();
  const me = await call('POST', '/v1/bread/me', { seed: seeds[1] }, m.token);
  check('the account keeps the device seed', me.body && me.body.seed === seeds[1] && me.body.today && me.body.today.n === days[1], me.body);
  const rf = await call('POST', '/v1/bread/reflection', { seed: 'another-device-' + RUN, text: 'تأمل فحص من Staging' }, m.token);
  check('reflection written for the account\'s topic', rf.status === 200 && rf.body.reflection.n === days[1] && rf.body.reflection.editable === true, rf.body);
  const rid = rf.body && rf.body.reflection && rf.body.reflection.id;
  const ed = await call('POST', '/v1/bread/reflection/edit', { id: rid, text: 'تأمل فحص اتعدّل' }, m.token);
  check('edit within 20 minutes', ed.status === 200 && ed.body.reflection.text === 'تأمل فحص اتعدّل', ed.body);
  sql(`UPDATE bread_reflections SET created_ms = created_ms - ${21 * 60000} WHERE id = '${rid}'`);
  const lk = await call('POST', '/v1/bread/reflection/edit', { id: rid, text: 'بعد الوقت' }, m.token);
  const lk2 = await call('POST', '/v1/bread/reflection/delete', { id: rid }, m.token);
  check('21 minutes later (simulated): edit and delete locked by the server', lk.status === 409 && lk.body.code === 'locked' && lk2.body.code === 'locked', [lk.body, lk2.body]);

  // ---------- admin: stats, reflections (audited), the alert ----------
  const st = await admin('GET', `bread/stats?program=${id}`);
  check('stats: opens 1, reads 1, reflections 1', st.body.totals && st.body.totals.opens === 1 && st.body.totals.reads === 1 && st.body.totals.reflections === 1, st.body);
  const rl = await admin('GET', `bread/reflections?program=${id}`);
  check('the reflections list (Primary Admin)', rl.status === 200 && rl.body.reflections.length === 1, rl.body);
  check('reading the reflections wrote an activity row', sql(`SELECT COUNT(*) AS n FROM activity WHERE action = 'bread.reflections.view' AND entity_id = '${id}'`)[0].n === 1);
  const hk = await admin('POST', 'diag/housekeeping', {});
  check('the daily housekeeping writes the «7 days left» alert', hk.status === 200 && hk.body.bread && hk.body.bread.alerts.includes('left7'), hk.body && hk.body.bread);
  const row = sql(`SELECT id, severity, notified FROM activity WHERE action = 'bread.left' AND entity_id = '${id}'`);
  check('one alert row (important), deduped', row.length === 1 && row[0].severity === 'important', row);
  const hk2 = await admin('POST', 'diag/housekeeping', {});
  check('a second housekeeping: no second alert', hk2.body.bread && hk2.body.bread.alerts.length === 0 && sql(`SELECT COUNT(*) AS n FROM activity WHERE action = 'bread.left' AND entity_id = '${id}'`)[0].n === 1, hk2.body && hk2.body.bread);
  check('no push was started for the program', sql("SELECT COUNT(*) AS n FROM push_sends WHERE ref LIKE 'bread:%'")[0].n === 0);

  // ---------- stop ----------
  const sp = await admin('POST', `bread/programs/${id}/stop`, { confirm: true });
  check('stop: nothing live, the index is empty', sp.status === 200 && (await call('GET', '/v1/bread/file/index')).body.programs.length === 0, sp.body);
  check('today is «empty» after the stop', (await call('POST', '/v1/bread/today', { seed: seeds[0] })).body.state === 'empty');
  console.log('today (Cairo):', today);
} catch (err) {
  check('no exception', false, String(err && err.stack || err));
} finally {
  // back as it was: the module switch, the fixture's rows (the published stubs stay: the index is live and empty)
  await admin('POST', 'bread/settings', { module: moduleBefore === '1' }).catch(() => {});
  if (id) {
    sql(`DELETE FROM bread_reflections WHERE program_id = '${id}'`);
    sql(`DELETE FROM bread_members WHERE program_id = '${id}'`);
    sql(`DELETE FROM bread_daily WHERE program_id = '${id}'`);
    sql(`DELETE FROM bread_opens WHERE program_id = '${id}'`);
    sql(`DELETE FROM bread_topics WHERE program_id = '${id}'`);
    sql(`UPDATE bread_programs SET purged_ms = ${Date.now()} WHERE id = '${id}'`);
  }
  const after = sql("SELECT value FROM settings WHERE key = 'BREAD_MODULE'")[0];
  check('BREAD_MODULE back to ' + moduleBefore, after && after.value === moduleBefore, after);
}
console.log(failed ? `\n${failed} FAILED` : '\nALL OK');
process.exit(failed ? 1 : 0);
