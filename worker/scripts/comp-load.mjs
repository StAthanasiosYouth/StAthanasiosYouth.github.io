// STAGING load check for the accounts runtime (docs/PHASE5-PLAN.md P5-9): a meeting's burst (start + submit by many
// accounts at once), the heaviest «نقاطي», a store race. Reports latencies and, from `wrangler tail`, the CPU time per
// route against the plan's 10 ms limit. Accounts are seeded directly and removed at the end. Nothing is emailed.
// Run from worker/: node scripts/comp-load.mjs [people=40]
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signSync } from '../src/lib/sync.js';

const base = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const ORIGIN = 'https://stathanasiosyouth.github.io';
const SYNC = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const PEOPLE = Number(process.argv[2]) || 40;
const RUN = Date.now().toString(36);
const COMPS = 30;
const QUESTIONS = 20;
let ok = true;

function sqlFile(text) {
  const file = join(tmpdir(), `comp-load-${RUN}.sql`);
  writeFileSync(file, text);
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--file', `"${file}"`, '--yes'], { shell: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('d1: ' + String(r.stderr).slice(0, 400));
}
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { shell: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('d1: ' + String(r.stderr).slice(0, 300));
  return JSON.parse(r.stdout)[0].results;
}
async function call(path, body, token) {
  const t0 = Date.now();
  const res = await fetch(base + path, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => null);
  return { status: res.status, ms: Date.now() - t0, body: data };
}
const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
const report = (name, list) => console.log(`${name.padEnd(26)} n=${String(list.length).padStart(3)}  p50 ${String(pct(list, 0.5)).padStart(5)} ms  p95 ${String(pct(list, 0.95)).padStart(5)} ms  max ${String(Math.max(0, ...list)).padStart(5)} ms`);

const question = (i, comp) => ({ id: 'q' + i, type: 'single', text: `سؤال رقم ${i} في المسابقة ${comp}، بنص طبيعي الطول زي الأسئلة الحقيقية؟`, help: '', media: null, required: true, points: 5, choices: ['أ', 'ب', 'ج', 'د'].map((t, n) => ({ id: 'c' + n, text: 'اختيار ' + t + ' طبيعي الطول' })), correct: 'c0', explanation: 'شرح الإجابة الصحيحة بطول طبيعي.', review: '' });
const def = n => ({
  schema: 1, id: `c-ld${RUN}${n}`, slug: `ld-${RUN}-${n}`, title: `مسابقة الحمل ${n}`, shortTitle: `حمل ${n}`, startAt: '', endAt: '', resultsAt: '', participation: 'registered', scoring: true, resultShow: 'both', answersShow: 'immediately', answersAt: '',
  showPoints: true, wallet: true, attempts: 1, layout: 'one', shuffleQ: true, shuffleC: true, timeLimit: 0, maxSubmissions: 0, questions: Array.from({ length: QUESTIONS }, (_, i) => question(i + 1, n))
});
const tokens = [];
const q = v => "'" + String(v).replace(/'/g, "''") + "'";

const before = sql("SELECT value FROM settings WHERE key = 'SHOP_MODE'")[0].value;
const now = Date.now();
let seed = "UPDATE settings SET value = 'on' WHERE key = 'accounts_mode';\nUPDATE settings SET value = 'open' WHERE key = 'SHOP_MODE';\n";
for (let i = 0; i < PEOPLE; i++) {
  const id = 'p-' + (RUN + 'aaaaaaaa').slice(0, 5).replace(/[^a-z2-7]/g, 'a') + 'abcdefghijklmnopqrstuvwxyz234567'[i % 32] + 'abcdefghijklmnopqrstuvwxyz234567'[Math.floor(i / 32)] + 'a';
  const token = 'as1.' + randomBytes(32).toString('base64url');
  tokens.push({ id, token });
  seed += `INSERT INTO participants (id, name, name_norm, email, email_canon, email_verified_at, email_source, email_verified_via, phone, phone_norm, birth_date, pw_hash, pw_enc, pw_version, pw_issued_at, pw_issued_by, created_via, created_at, updated_at) VALUES (${q(id)}, 'حمل حمل حمل', 'حمل حمل حمل', ${q(`ld-${RUN}-${i}@staging.invalid`)}, ${q(`ld-${RUN}-${i}@staging.invalid`)}, ${now}, 'self', 'otp', ${q('019' + String(10000000 + i))}, ${q(RUN.slice(-3) + String(1000000 + i))}, '2000-03-12', 'x', 'x', 1, ${now}, 'self', 'self', ${now}, ${now});\n`;
  seed += `INSERT INTO account_sessions (id, participant_id, token_hash, pw_version, kind, created_at, last_seen, expires_at) VALUES (${q('ses-ld' + RUN + i)}, ${q(id)}, ${q(createHash('sha256').update(token).digest('hex'))}, 1, 'device', ${now}, ${now}, ${now + 86400000});\n`;
}
seed += `INSERT INTO store_items (id, name, cost, stock, created_ms, updated_ms) VALUES ('i-0a0a0a0a', 'جايزة الحمل', 1, 5, ${now}, ${now});\n`;
sqlFile(seed);

// the push of real-size definitions
let tsBump = 0;
const comps = Array.from({ length: COMPS }, (_, n) => def(n));
for (let i = 0; i < comps.length; i += 10) {
  const raw = JSON.stringify({ comps: comps.slice(i, i + 10).map(d => ({ slug: d.slug, compId: d.id, version: 'v1', def: d, closedAt: '', finalizedAt: '' })) });
  const ts = String(Date.now() + (++tsBump) * 50);
  const res = await fetch(base + '/v1/sync/comp-live', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-ts': ts, 'x-sync-signature': await signSync(SYNC, ts, raw) }, body: raw });
  if (res.status !== 200) throw new Error('push ' + res.status + ' ' + (await res.text()).slice(0, 200));
}

// CPU per route, from the Worker's own trace events
const tail = spawn('npx', ['wrangler', 'tail', '--env', 'staging', '--format', 'json'], { shell: true });
let buffer = '';
tail.stdout.on('data', d => { buffer += d; });
await new Promise(r => setTimeout(r, 12000));

try {
  const answers = Object.fromEntries(Array.from({ length: QUESTIONS }, (_, i) => ['q' + (i + 1), 'c0']));
  const slug = comps[0].slug;
  const keyOf = i => `load-${RUN}-${String(i).padStart(6, '0')}`;
  const starts = await Promise.all(tokens.map((t, i) => call('/v1/comp/start', { slug, clientKey: keyOf(i) }, t.token)));
  report('burst: start', starts.map(r => r.ms));
  const startBad = starts.filter(r => r.status !== 200);
  console.log('  start errors:', startBad.length, startBad.slice(0, 2).map(r => r.body && r.body.code));
  const submits = await Promise.all(starts.map((s, i) => (s.status === 200 ? call('/v1/comp/submit', { token: s.body.attempt.token, clientKey: keyOf(i), answers }, tokens[i].token) : null)));
  const sent = submits.filter(Boolean);
  report('burst: submit', sent.map(r => r.ms));
  const submitBad = sent.filter(r => r.status !== 200);
  console.log('  submit errors:', submitBad.length, submitBad.slice(0, 2).map(r => r.body && r.body.code));
  if (startBad.length || submitBad.length) ok = false;

  // the heaviest person: every competition, then «نقاطي»
  const heavy = tokens[0];
  for (let n = 1; n < COMPS; n++) {
    const k = `heavy-${RUN}-${String(n).padStart(6, '0')}`;
    const s = await call('/v1/comp/start', { slug: comps[n].slug, clientKey: k }, heavy.token);
    if (s.status === 200) await call('/v1/comp/submit', { token: s.body.attempt.token, clientKey: k, answers }, heavy.token);
  }
  const mine = [];
  for (let i = 0; i < 10; i++) mine.push(await call('/v1/comp/me', {}, heavy.token));
  report(`«نقاطي» (${COMPS} competitions)`, mine.map(r => r.ms));
  if (mine.some(r => r.status !== 200)) ok = false;
  const light = [];
  for (let i = 1; i < 11; i++) light.push(await call('/v1/comp/me', {}, tokens[i].token));
  report('«نقاطي» (1 competition)', light.map(r => r.ms));

  const redeem = await Promise.all(tokens.slice(0, 30).map((t, i) => call('/v1/shop/redeem', { itemId: 'i-0a0a0a0a', requestKey: `load-${RUN}-r${i}` }, t.token)));
  report('store race', redeem.map(r => r.ms));
  const won = redeem.filter(r => r.status === 200).length;
  console.log('  stock 5: won', won, 'codes', [...new Set(redeem.map(r => r.body && r.body.code))]);
  if (won !== 5) ok = false;
  await new Promise(r => setTimeout(r, 8000));
} finally {
  tail.kill();
  sql(`DELETE FROM redemptions WHERE item_id = 'i-0a0a0a0a'`);
  sql(`DELETE FROM store_items WHERE id = 'i-0a0a0a0a'`);
  sql(`DELETE FROM submissions WHERE comp_id LIKE 'c-ld${RUN}%'`);
  sql(`DELETE FROM comp_live WHERE comp_id LIKE 'c-ld${RUN}%'`);
  sql(`DELETE FROM comp_versions WHERE comp_id LIKE 'c-ld${RUN}%'`);
  sql(`DELETE FROM member_outbox WHERE participant_id IN (SELECT id FROM participants WHERE email LIKE 'ld-${RUN}-%')`);
  sql(`DELETE FROM points_ledger WHERE participant_id IN (SELECT id FROM participants WHERE email LIKE 'ld-${RUN}-%')`);
  sql(`DELETE FROM account_sessions WHERE participant_id IN (SELECT id FROM participants WHERE email LIKE 'ld-${RUN}-%')`);
  sql(`DELETE FROM participants WHERE email LIKE 'ld-${RUN}-%'`);
  sql("DELETE FROM rate_limits WHERE key LIKE 'comp.%' OR key LIKE 'shop.%'");
  sql(`UPDATE settings SET value = '${before}' WHERE key = 'SHOP_MODE'`);
}

// the trace: { event: { request: { url } }, cpuTime?, wallTime?, outcome }
const events = [];
let depth = 0, from = -1;
for (let i = 0; i < buffer.length; i++) {
  if (buffer[i] === '{') { if (!depth) from = i; depth++; }
  else if (buffer[i] === '}') { depth--; if (!depth && from >= 0) { try { events.push(JSON.parse(buffer.slice(from, i + 1))); } catch { /* a broken line */ } } }
}
const byRoute = {};
for (const e of events) {
  const url = e.event && e.event.request && e.event.request.url;
  if (!url || !('cpuTime' in e)) continue;
  const path = new URL(url).pathname;
  if (!/\/v1\/(comp|shop)\//.test(path)) continue;
  (byRoute[path] = byRoute[path] || []).push(e.cpuTime);
}
console.log('\nCPU per route (ms, limit 10):', events.length ? '' : '(no trace events)');
for (const [path, list] of Object.entries(byRoute)) report(path, list);
const over = Object.values(byRoute).flat().filter(x => x > 10).length;
const outcomes = events.reduce((m, e) => { m[e.outcome] = (m[e.outcome] || 0) + 1; return m; }, {});
console.log('over 10 ms:', over, '· outcomes:', JSON.stringify(outcomes));
console.log(ok ? '\nall passed' : '\nFAILED');
process.exit(ok ? 0 : 1);
