// Phase 2 P2-8 on staging (docs/PUBLISH-SEPARATION-PLAN.md): two worker-mode publishes of a test page
// (restore-check/), then «ارجع للنسخة دي» to the first through the admin route: live at once, a
// stale `expect` refused, the list shows the restore as live, the mirror commits it to the staging
// TEST repository. Only the restore-check page changes (everything else was the same at both times).
//   node scripts/restore-check.mjs
import { readFileSync } from 'node:fs';
import { createSign, createHmac } from 'node:crypto';

const base = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const ORIGIN = 'https://stathanasiosyouth.github.io';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SECRET = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const RUN = Date.now().toString(36);
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + String(JSON.stringify(detail)).slice(0, 400))); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function token() {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'loadtest-1', email: 'loadtest@staging.invalid', email_verified: true, name: 'loadtest', iat: now, exp: now + 3600 });
  return 'Bearer ' + head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function admin(method, path, body) {
  const res = await fetch(base + path, { method, headers: { origin: ORIGIN, authorization: token(), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function publish(id, v) {
  const raw = JSON.stringify({ id, mode: 'worker', by: 'restore-check@staging.invalid', at: Date.now(), files: { 'restore-check/page.json': JSON.stringify({ schema: 1, slug: 'restore-check', v, run: RUN }) } });
  const ts = String(Date.now());
  const r = await fetch(base + '/v1/sync/publish', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + createHmac('sha256', SECRET).update(ts + '.' + raw).digest('hex') }, body: raw });
  await sleep(20);
  return r.status;
}
const page = async () => JSON.parse(await (await fetch(base + '/v1/public/page/restore-check', { headers: { origin: ORIGIN } })).text());

const a = 'restore-a-' + RUN, b = 'restore-b-' + RUN;
check('publish v1', await publish(a, 1) === 200);
check('publish v2', await publish(b, 2) === 200);
check('v2 live', (await page()).v === 2);

const list = await admin('GET', '/v1/admin/publish/revisions');
check('the list: restore on, v2 live', list.status === 200 && list.body.enabled && list.body.live === b, list.body && { enabled: list.body.enabled, live: list.body.live });

const stale = await admin('POST', '/v1/admin/publish/restore', { to: a, expect: a });
check('a stale view is refused (someone published in between)', stale.status === 409 && stale.body.code === 'conflict', stale);

const t0 = Date.now();
const r = await admin('POST', '/v1/admin/publish/restore', { to: a, expect: b });
check('restore to v1 (' + (Date.now() - t0) + ' ms)', r.status === 200 && !r.body.unchanged, r.body);
check('only the test page changed', r.body.changed && r.body.changed.length === 1 && r.body.changed[0].key === 'restore-check', r.body.changed);
check('v1 live at once', (await page()).v === 1);
const after = await admin('GET', '/v1/admin/publish/revisions');
check('the restore is the live one', after.body.live === r.body.id && after.body.jobs[0].mode === 'restore', after.body.jobs.slice(0, 2));

let s;
for (let i = 0; i < 24; i++) { s = (await admin('GET', '/v1/admin/publish/status')).body; if (!s.mirror.pending) break; await sleep(5000); }
check('mirrored to the test repository', s.mirror.pending === 0 && s.mirror.last.ok, s.mirror);
console.log('     commit ' + (s.mirror.last && s.mirror.last.sha));

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
