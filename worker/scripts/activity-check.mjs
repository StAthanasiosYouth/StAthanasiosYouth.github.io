// Live STAGING check for the unified «سجل النشاط» (Phase 1.5 step 4): rows sent
// the way Apps Script sends them (signed POST /v1/sync/activity), resent and
// merged without a second row, read back with the Worker's own rows through
// GET /v1/admin/activity?view=log. Staging only.
// Run: node scripts/activity-check.mjs
import { readFileSync } from 'node:fs';
import { createSign, randomBytes } from 'node:crypto';
import { signSync } from '../src/lib/sync.js';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SYNC = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400))); if (!ok) failed++; };

function google() {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'loadtest-1', email: 'loadtest@staging.invalid', email_verified: true, name: 'Load Test', iat: now, exp: now + 3600 });
  return 'Bearer ' + head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
let lastTs = 0;
async function push(rows) {
  const raw = JSON.stringify({ rows });
  const ts = String(lastTs = Math.max(Date.now(), lastTs + 1));
  const res = await fetch(base + '/v1/sync/activity', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-ts': ts, 'x-sync-signature': await signSync(SYNC, ts, raw) }, body: raw });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const AUTH = google();
const log = async q => (await fetch(base + '/v1/admin/activity?view=log' + q, { headers: { authorization: AUTH, origin: 'https://stathanasiosyouth.github.io' } })).json();

const id = 'act-' + randomBytes(6).toString('hex');
const at = Date.now();
const row = over => ({ id, at, actor: 'loadtest@staging.invalid', actorName: 'Load Test', action: 'update', type: 'news', entityId: 'n-check', title: 'خبر تجربة', summary: 'عدّل «خبر تجربة»', changes: { fields: ['العنوان'] }, ref: '', count: 1, device: '', severity: 'routine', ...over });

const bad = await fetch(base + '/v1/sync/activity', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-ts': String(Date.now()), 'x-sync-signature': 'v1=' + '0'.repeat(64) }, body: '{"rows":[]}' });
check('unsigned → 401', bad.status === 401);
check('signed rows stored', (await push([row()])).status === 200);
check('the same row again: fine', (await push([row()])).status === 200);
check('merged (same id, later, count 2)', (await push([row({ at: at + 60000, count: 2, summary: 'عدّل «خبر تجربة» مرتين' })])).status === 200);
const one = await log('&id=' + id);
check('one row, merged', one.items && one.items.length === 1 && one.items[0].count === 2 && one.items[0].source === 'apps-script', one);
const page = await log('&limit=50');
check('read with the Worker rows, newest first', page.items.some(i => i.id === id) && page.items.every((x, i, a) => !i || a[i - 1].at >= x.at), page.items && page.items.slice(0, 3));
check('technical rows hidden in view=log', !page.items.some(i => /^(diag\.|booknews\.|admins\.sync|paydest\.sync)/.test(i.action)), page.items.map(i => i.action));
check('families + sections for the filters', page.families.includes('admins') && page.sections.includes('bookings'), page);

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
