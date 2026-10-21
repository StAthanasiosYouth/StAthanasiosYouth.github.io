// Phase 2 step 2 on staging (docs/PUBLISH-SEPARATION-PLAN.md P2-2): the shadow comparison against
// the REAL GitHub Pages site. 1) a run with seed (files staging D1 lacks are copied from the site),
// 2) a signed shadow publish of exactly what the site serves now (as Apps Script would post after
// its commit), 3) a run → every file equal, 4) the gate status. Staging only; no switch is changed.
//   node scripts/shadow-check.mjs
import { readFileSync } from 'node:fs';
import { createSign, createHmac } from 'node:crypto';

const base = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const SITE = 'https://stathanasiosyouth.github.io';
const ORIGIN = SITE;
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SECRET = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + String(JSON.stringify(detail)).slice(0, 400))); if (!ok) failed++; };

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
const site = async path => { const r = await fetch(`${SITE}/${path}?c=${Date.now()}`); return r.ok ? r.text() : null; };

// 1) seed run
const seeded = await admin('POST', '/v1/admin/publish/shadow-check', { seed: true });
check('seed run', seeded.status === 200 && !seeded.body.skipped, seeded);
console.log('     total ' + seeded.body.total + ', equal ' + seeded.body.equal + ', seeded ' + seeded.body.seeded + ', lag ' + seeded.body.lag + ', mismatch ' + seeded.body.mismatch + ', missing ' + seeded.body.missing);
for (const d of seeded.body.detail || []) console.log('     · ' + d.kind + ':' + d.key + ' ' + d.state + (d.note ? ' (' + d.note + ')' : ''));

// 2) a shadow publish of what the site serves now
const content = JSON.parse(await site('content.json'));
const files = { 'content.json': await site('content.json') };
const ics = await site('meeting.ics');
if (ics) files['meeting.ics'] = ics;
for (const p of content.pages || []) files[`${p.slug}/page.json`] = await site(`${p.slug}/page.json`);
for (const e of content.events || []) files[`events/${e.slug}/event.json`] = await site(`events/${e.slug}/event.json`);
for (const c of content.competitions || []) files[`competition/${c.slug}/comp.json`] = await site(`competition/${c.slug}/comp.json`);
for (const [k, v] of Object.entries(files)) if (v == null) delete files[k];
const raw = JSON.stringify({ id: 'shadow-check-' + Date.now().toString(36), mode: 'shadow', by: 'shadow-check@staging.invalid', at: Date.now(), files });
const ts = String(Date.now());
const posted = await fetch(base + '/v1/sync/publish', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + createHmac('sha256', SECRET).update(ts + '.' + raw).digest('hex') }, body: raw });
const pb = await posted.json();
check('shadow publish of the live site (' + Object.keys(files).length + ' files, ' + (pb.changed || []).length + ' changed)', posted.status === 200, pb);

// 3) the comparison now: every file equal
const after = await admin('POST', '/v1/admin/publish/shadow-check', {});
check('after the shadow publish: clean (' + after.body.equal + '/' + after.body.total + ' equal)', after.status === 200 && after.body.clean === true, after.body);

// 4) the gate status
const status = await admin('GET', '/v1/admin/publish/status');
check('status', status.status === 200 && status.body.checks >= 2 && status.body.last && status.body.last.equal === after.body.equal, status.body);
console.log('     checks ' + status.body.checks + ', clean since ' + (status.body.cleanSince ? new Date(status.body.cleanSince).toISOString() : '—') + ', last jobs: ' + status.body.jobs.slice(0, 3).map(j => j.mode + ':' + j.id).join(', '));

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
