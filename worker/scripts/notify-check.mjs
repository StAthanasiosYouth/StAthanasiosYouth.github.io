// Live STAGING check for the notification router (Phase 1.5 step 5): the
// switch's flood guard, a critical row routed by the minute cron, the push
// claim (signed) with its lease, the acknowledgement, and the switch back
// off. Acts as Apps Script itself (claims and acks): no push is really sent.
// Run: node scripts/notify-check.mjs   (about 2–3 minutes: it waits for the cron)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSign } from 'node:crypto';
import { signSync } from '../src/lib/sync.js';

const base = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SYNC = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PRIMARY = 'loadtest@staging.invalid';
const RUN = Date.now().toString(36);
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400))); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sql(command) {
  // wrangler's own entry with node: no shell, so the SQL stays one argument
  const bin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const out = execFileSync(process.execPath, [bin, 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', command], { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) });
  return JSON.parse(out.slice(out.indexOf('['))).flatMap(r => r.results || []);
}
function google(email, sub) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: email.split('@')[0], iat: now, exp: now + 3600 });
  return 'Bearer ' + head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
let lastTs = 0;
async function claim(ack = []) {
  const raw = JSON.stringify({ v: 1, ack });
  const ts = String(lastTs = Math.max(Date.now(), lastTs + 1));
  const res = await fetch(base + '/v1/sync/notify-claim', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-ts': ts, 'x-sync-signature': await signSync(SYNC, ts, raw) }, body: raw });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const call = async (auth, method, path, body) => {
  const res = await fetch(base + path, { method, headers: { origin: 'https://stathanasiosyouth.github.io', authorization: auth, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// a second admin to receive (the actor never gets their own), switched on afresh
const OTHER = `ntf-${RUN}@staging.invalid`;
const P = google(PRIMARY, 'loadtest-1');
check('a second admin (receives the publish-style rows)', (await call(P, 'POST', '/v1/admin/accounts', { email: OTHER, grants: { 'accounts.view': 'all' } })).status === 200);
sql("UPDATE settings SET value = '0' WHERE key = 'NOTIFY_ROUTER'; DELETE FROM settings WHERE key = 'NOTIFY_SINCE'");
sql(`INSERT INTO activity (id, at, cairo, actor, action, notified) VALUES ('act-bk${RUN}', ${Date.now() - 60000}, '', 'system', 'migrate', 0)`);
check('router off: the claim says so, no items', (await claim()).body.router === false);

sql("UPDATE settings SET value = '1' WHERE key = 'NOTIFY_ROUTER'");
console.log('… waiting for the minute cron (first tick: the flood guard)');
let since = null;
for (let i = 0; i < 18 && !since; i++) { await sleep(10000); since = (sql("SELECT value FROM settings WHERE key = 'NOTIFY_SINCE'")[0] || {}).value; }
check('first tick stamps NOTIFY_SINCE', !!since);
check('the waiting backlog is marked, never sent', (sql(`SELECT notified FROM activity WHERE id = 'act-bk${RUN}'`)[0] || {}).notified === 3);

// a critical row after the switch (a background job given up on: actor «system»)
sql(`INSERT INTO activity (id, at, cairo, actor, action, entity_type, summary, severity, notified) VALUES ('act-jf${RUN}', ${Date.now()}, '', 'system', 'job.failed', 'job', 'check', 'critical', 0)`);
console.log('… waiting for the router');
let items = [];
for (let i = 0; i < 18 && !items.length; i++) {
  await sleep(10000);
  const r = await claim();
  items = (r.body && r.body.items) || [];
}
const mine = items.filter(x => x.recipient === PRIMARY);
check('routed and claimed: the Primary gets a critical push', mine.length >= 1 && mine[0].level === 'critical' && /فشلت/.test(mine[0].title), items);
check('… and the other holder of system.manage too', items.some(x => x.recipient === OTHER), items);
check('leased: the next claim does not hand it out again', !((await claim()).body.items || []).some(x => mine.some(m => m.id === x.id)));
await claim(items.map(x => ({ id: x.id, claim: x.claim, ok: true, reason: 'check' })));
const ids = mine.map(m => `'${m.id}'`).join(',') || "''";
check('acknowledged → sent', sql(`SELECT status FROM notify_outbox WHERE id IN (${ids})`).every(r => r.status === 'sent'));

sql("UPDATE settings SET value = '0' WHERE key = 'NOTIFY_ROUTER'");
await call(P, 'POST', `/v1/admin/accounts/${encodeURIComponent(OTHER)}/remove`, {});
check('switched back off', (await claim()).body.router === false);
// step 7: the screens' routes (the Primary), the switch through the API
const st = await call(P, 'GET', '/v1/admin/notify/settings');
check('«إعدادات الإشعارات»: the Primary manages', st.status === 200 && st.body.canManage === true && st.body.types.length > 40, st.body);
const sv = await call(P, 'POST', '/v1/admin/notify/settings', { types: { publish: { push: true, email: 'summary', locked: false } }, summaryTime: '21:00' });
check('… saves a type', sv.status === 200 && sv.body.types.find(t => t.key === 'publish').email === 'summary', sv.body);
await call(P, 'POST', '/v1/admin/notify/settings', { types: { publish: { reset: true } } });
check('«تنبيهاتي»', (await call(P, 'GET', '/v1/admin/notify/me')).status === 200);
const stat = await call(P, 'GET', '/v1/admin/notify/status');
check('«حالة النظام»', stat.status === 200 && Array.isArray(stat.body.days) && stat.body.quota.target > 0, stat.body);

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
