// Phase 4 batch 2 staging check (P4-4 review, P4-5 media on R2, P4-6 publish on the Worker) on the REAL staging
// Worker + D1 + R2 + the staging mirror repository. Needs staging CONTENT_DRAFTS = '1' for the run (the caller flips
// it and back) and the fixture drafts (scripts/content-check.mjs). Staging has no competitions (COMPS_SOURCE=none).
//   review on the Worker; the same review in the browser kit (admin/review-kit.js) from /review-input
//   upload → R2, media-status, the background GitHub copy, publishedAt
//   publish (live at once, served, mirror state), a repeat publish unchanged, a stale review refused
//   node scripts/content-publish-check.mjs
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const base = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const RUN = Date.now().toString(36);
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 500))); if (!ok) failed++; };
function google(email, sub) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: email.split('@')[0], iat: now, exp: now + 3600 });
  return 'Bearer ' + head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function call(auth, method, path, body) {
  const t0 = Date.now();
  const res = await fetch(base + path, { method, headers: { origin: ORIGIN, authorization: auth, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null), ms: Date.now() - t0 };
}
const webp = fill => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(40, fill)]);

const P = google('loadtest@staging.invalid', 'loadtest-1');
const st = await call(P, 'GET', '/v1/admin/content/status');
if (!st.body || st.body.writer !== 'worker') { console.error('CONTENT_DRAFTS is not 1 on staging'); process.exit(1); }
const s = await call(P, 'POST', '/v1/admin/session/start', { device: 'Publish check', tab: ('tab-' + RUN).padEnd(20, 'x'), force: true });
const T = 'Bearer ' + s.body.token;
const run = (fn, ...args) => call(T, 'POST', '/v1/admin/content/call', { fn, args });

/* P4-5: upload → R2 → the site copy */
const fill = Date.now() % 200;
const up = await call(T, 'POST', '/v1/admin/media/upload', { full: webp(fill).toString('base64'), thumb: webp(fill + 1).toString('base64'), mime: 'image/webp', width: 800, height: 600, alt: 'فحص ' + RUN });
check('upload → R2 (' + up.ms + ' ms)', up.status === 200 && up.body.result.media && /^img-/.test(up.body.result.media.id), up.body);
const mediaId = up.body.result.media.id;
const prev = await run('apiMediaPreview', mediaId);
check('preview read back from R2', prev.status === 200 && prev.body.result === 'data:image/webp;base64,' + webp(fill + 1).toString('base64'), prev.body);
let ms0 = Date.now(), waiting = 1;
while (Date.now() - ms0 < 90_000) {
  const ms = await call(P, 'GET', '/v1/admin/content/media-status');
  waiting = (ms.body.files || []).reduce((n, f) => n + (f.waiting || 0), 0);
  if (!waiting) break;
  await new Promise(r => setTimeout(r, 3000));
}
check('the background GitHub copy done (' + Math.round((Date.now() - ms0) / 1000) + ' s)', waiting === 0, waiting);
// publishedAt follows the copy in the same job, a moment later
let row = null;
ms0 = Date.now();
while (Date.now() - ms0 < 30_000) {
  const lib = await run('apiMediaLibrary');
  row = lib.body && lib.body.result && (lib.body.result.media || lib.body.result.items || []).find(m => m.id === mediaId);
  if (row && row.publishedAt) break;
  await new Promise(r => setTimeout(r, 1500));
}
check('publishedAt set once on the site', !!(row && row.publishedAt), row);

/* P4-4: review on the Worker and in the browser kit */
await run('apiSaveItem', 'news', { title: 'خبر نشر ' + RUN, summary: 'فحص', image: mediaId });
const r1 = await run('apiReview');
check('Worker review (' + r1.ms + ' ms)', r1.status === 200 && r1.body.result.revision && !r1.body.result.errors.length, r1.body);
const input = await call(P, 'GET', '/v1/admin/content/review-input');
await import('../../admin/review-kit.js');
const t0 = performance.now();
const kit = globalThis.ReviewKit.review({ drafts: input.body.kinds, live: input.body.live, comps: input.body.comps, now: input.body.now, props: input.body.props });
check('browser review = Worker review (' + Math.round(performance.now() - t0) + ' ms in Node, input ' + input.ms + ' ms)', kit.revision === r1.body.result.revision && JSON.stringify(kit.groups) === JSON.stringify(r1.body.result.groups), { kit: kit.revision, worker: r1.body.result.revision });

/* P4-6: publish */
const stale = await run('apiPublish', 'not-the-revision');
check('a stale review is refused', stale.status === 400, stale.body);
const pub = await run('apiPublish', r1.body.result.revision);
check('publish on the Worker (' + pub.ms + ' ms)', pub.status === 200 && pub.body.result.revision === r1.body.result.revision, pub.body);
const live = await fetch(base + '/v1/public/content').then(r => r.json());
check('live at once: the public read serves it', live.revision === r1.body.result.revision && JSON.stringify(live).includes('خبر نشر ' + RUN), live.revision);
// (the staging fixture's own picture never went to the site, so — as in Apps Script — a repeat publish sends
// content.json again; what matters: the same revision, nothing else changed)
const again = await run('apiPublish', (await run('apiReview')).body.result.revision);
check('a repeat publish: same revision (' + again.ms + ' ms)', again.status === 200 && again.body.result.revision === r1.body.result.revision, again.body);
ms0 = Date.now();
let mirror = null;
while (Date.now() - ms0 < 90_000) {
  mirror = (await call(P, 'GET', '/v1/admin/publish/status')).body.mirror;
  if (mirror && !mirror.pending) break;
  await new Promise(r => setTimeout(r, 3000));
}
check('the GitHub mirror of the publish caught up (' + Math.round((Date.now() - ms0) / 1000) + ' s)', mirror && !mirror.pending && !mirror.late, mirror);

console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
