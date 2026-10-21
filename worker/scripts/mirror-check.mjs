// Phase 2 P2-4 on staging (docs/PUBLISH-SEPARATION-PLAN.md): a signed PUBLISH_MODE='worker' publish,
// live at once on the staging Worker, then the mirror's commit to the staging TEST repository
// (vars GITHUB_REPO / GITHUB_BRANCH of the staging env; never the production repo: src/lib/github.js).
// Needs the staging secret GITHUB_TOKEN (fine-grained, Contents read/write on the test repo only).
// Without it: the publish is live and the mirror reports "GITHUB_TOKEN not set" (also checked).
// Files go under mirror-check/ (a page slug), never content.json, so other staging checks are unaffected.
//   node scripts/mirror-check.mjs
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
const status = async () => (await (await fetch(base + '/v1/admin/publish/status', { headers: { origin: ORIGIN, authorization: token() } })).json());

const page = JSON.stringify({ schema: 1, slug: 'mirror-check', title: 'mirror check ' + RUN });
const raw = JSON.stringify({ id: 'mirror-check-' + RUN, mode: 'worker', by: 'mirror-check@staging.invalid', at: Date.now(), files: { 'mirror-check/page.json': page } });
const ts = String(Date.now());
const t0 = Date.now();
const res = await fetch(base + '/v1/sync/publish', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + createHmac('sha256', SECRET).update(ts + '.' + raw).digest('hex') }, body: raw });
check('worker-mode publish accepted (' + (Date.now() - t0) + ' ms)', res.status === 200, await res.clone().json());
const live = await (await fetch(base + '/v1/public/page/mirror-check', { headers: { origin: ORIGIN } })).text();
check('live on the Worker at once', live === page, live.slice(0, 120));

let s = await status();
const configured = s.mirror && s.mirror.configured;
console.log('     mirror configured: ' + configured + (configured ? '' : ' (' + s.mirror.reason + ')'));
if (!configured) {
  check('not configured: the publish is pending, nothing else', s.mirror.pending >= 1, s.mirror);
} else {
  for (let i = 0; i < 24 && s.mirror.pending; i++) { await sleep(5000); s = await status(); }
  check('mirrored (' + Math.round((Date.now() - t0) / 1000) + ' s)', s.mirror.pending === 0 && s.mirror.last && s.mirror.last.ok, s.mirror);
  const job = s.jobs.find(j => j.id === 'mirror-check-' + RUN);
  check('the job is marked mirrored', job && job.state === 'mirrored', job);
  console.log('     commit ' + (s.mirror.last && s.mirror.last.sha));
}

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
