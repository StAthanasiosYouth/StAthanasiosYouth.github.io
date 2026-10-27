// Phase 4 P4-8: the cutover and its rollback, rehearsed end to end on STAGING with timings
// (docs/CONTENT-MIGRATION-PLAN.md §13). The "Sheets" are the fake Apps Script world running the real
// .gs code (tests/fakes), the Worker / D1 / R2 are staging's. Staging only; it flips staging's
// CONTENT_DRAFTS itself (wrangler d1 execute --env staging) and leaves it at '0'.
//
//   1  copy: dry run → apply → every kind's hash = the Sheets'
//   2  media: each library file sent (the Drive copy) → no row left on Drive
//   3  switch on (CONTENT_DRAFTS = 1) → the session says content 'worker'
//   4  the panel on the Worker: state, a save, the review (server + browser kit), the publish — timed
//   5  rollback: D1 → the Sheets (reverse export, written with ContentExport.gs) → the Sheets = D1
//   6  switch off (CONTENT_DRAFTS = 0) → the session says 'sheets', a Worker content call is refused
//   7  the Worker publish rolled back too: «ارجع للنسخة دي» to the publish before (Phase 2 restore)
//   node --experimental-sqlite scripts/cutover-rehearsal.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createSign, createHmac, createHash } from 'node:crypto';
import { compWorld, adminApi, webp, wallAt, plain } from '../../tests/fakes/comp.mjs';

const base = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SYNC = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const RUN = Date.now().toString(36);
const T = {};
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 500))); if (!ok) failed++; };
const time = async (label, fn) => { const t0 = Date.now(); const r = await fn(); T[label] = Date.now() - t0; return r; };
const sha = b => createHash('sha256').update(b).digest('hex');
function google(email, sub) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: email.split('@')[0], iat: now, exp: now + 3600 });
  return 'Bearer ' + head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function call(auth, method, path, body) {
  const res = await fetch(base + path, { method, headers: { origin: ORIGIN, ...(auth ? { authorization: auth } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
let tick = 0;
async function sync(path, payload) {
  const raw = JSON.stringify(payload);
  const ts = String(Date.now() + (++tick));
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'text/plain', 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + createHmac('sha256', SYNC).update(ts + '.' + raw).digest('hex') }, body: raw });
  return { status: res.status, body: await res.json().catch(() => null) };
}
function d1(sql) {
  // Windows runs npx through a shell: the SQL goes as ONE quoted argument (it never holds a double quote)
  const win = process.platform === 'win32';
  const out = execFileSync(win ? 'npx.cmd' : 'npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', win ? '"' + sql + '"' : sql], { encoding: 'utf8', shell: win });
  return JSON.parse(out)[0].results;
}
const P = google('loadtest@staging.invalid', 'loadtest-1');
const session = async tab => call(P, 'POST', '/v1/admin/session/start', { device: 'Cutover rehearsal', tab: ('tab-' + RUN + tab).padEnd(20, 'x'), force: true, boot: true });

if (d1("SELECT value FROM settings WHERE key = 'CONTENT_DRAFTS'")[0].value !== '0') { console.error('staging CONTENT_DRAFTS is not 0: stop'); process.exit(1); }
const payDest = d1('SELECT servant_id, method, number, name, source, approved_ms, approved_by FROM pay_dest');

/* the Sheets as they are before the cutover */
const world = compWorld();
const gs = adminApi(world);
const media = gs('apiUploadMedia', { full: webp(21).toString('base64'), thumb: webp(22).toString('base64'), mime: 'image/webp', width: 1024, height: 768, alt: 'صورة البروفة' }).media;
gs('apiSaveLink', { title: 'لينك البروفة ' + RUN, url: 'https://example.com/r' + RUN, section: 'social' });
gs('apiSaveItem', 'news', { title: 'خبر البروفة ' + RUN, summary: 'قبل النقل', image: media.id, publishAt: wallAt(world, -30) });
const sv = gs('apiServantSave', null, { name: 'خادم البروفة', phone: '01000000003', role: 'خادم' }).servant;
gs('apiPageSave', null, { slug: 'rh-' + RUN, title: 'صفحة البروفة', tagline: 'بروفة', description: 'بروفة', cover: media.id, team: [sv.id], home: { show: true } });
const payload = plain(world.gs.contentExportPayload_());

try {
  /* 1 copy */
  const dry = await time('copy: dry run', () => sync('/v1/sync/content-import', { mode: 'dry', by: 'rehearsal', ...payload }));
  check('1 dry run: every kind checked', dry.body && dry.body.state === 'ok', dry.body);
  const applied = await time('copy: apply + check', () => sync('/v1/sync/content-import', { mode: 'apply', by: 'rehearsal', ...payload }));
  check('1 apply: every kind = the Sheets', applied.body && applied.body.state === 'ok' && Object.values(applied.body.kinds).every(k => k.ok), applied.body && applied.body.state);

  /* 2 media */
  const rows = payload.kinds.media.rows;
  await time('media copy', async () => {
    for (const row of rows) {
      for (const [part, fileId] of [['full', row.driveId], ['thumb', row.thumbDriveId]]) {
        if (!fileId || /^r2:/.test(fileId)) continue;
        const data = world.gs.driveDownloadBase64_(fileId);
        const r = await sync('/v1/sync/media-copy', { id: row.id, part, mime: 'image/webp', data, sha256: sha(Buffer.from(data, 'base64')) });
        check('2 media ' + row.id + ' ' + part, r.status === 200, r.body);
      }
    }
  });
  const ms = await call(P, 'GET', '/v1/admin/content/media-status');
  check('2 no library row left on Drive', ms.body && ms.body.onDrive === 0, ms.body);

  /* 3 switch on */
  await time('switch on', async () => d1("UPDATE settings SET value = '1', updated_at = " + Date.now() + ", updated_by = 'cutover-rehearsal' WHERE key = 'CONTENT_DRAFTS'"));
  const s1 = await session('a');
  check('3 the session says: content on the Worker', s1.body && s1.body.boot && s1.body.boot.content === 'worker', s1.body && s1.body.boot);
  const W = 'Bearer ' + s1.body.token;
  const run = (fn, ...args) => call(W, 'POST', '/v1/admin/content/call', { fn, args });

  /* 4 the panel on the Worker */
  const st = await time('panel state (apiState)', () => run('apiState'));
  check('4 panel state from the Worker', st.status === 200 && st.body.result.draft.news.some(n => n.title === 'خبر البروفة ' + RUN), st.status);
  const saved = await time('a save (apiSaveItem)', () => run('apiSaveItem', 'news', { id: st.body.result.draft.news.find(n => n.title === 'خبر البروفة ' + RUN).id, title: 'خبر البروفة ' + RUN + ' — بعد النقل', summary: 'بعد النقل', image: media.id }));
  check('4 a save on the Worker answers with the state', saved.status === 200 && saved.body.result.draft.news.some(n => n.title.endsWith('بعد النقل')), saved.body && saved.body.code);
  const review = await time('review (server)', () => run('apiReview'));
  check('4 review on the Worker', review.status === 200 && !review.body.result.errors.length, review.body && review.body.result && review.body.result.errors);
  const input = await time('review input (browser kit)', () => call(W, 'GET', '/v1/admin/content/review-input'));
  await import('../../admin/review-kit.js');
  const kit = await time('review in the browser kit', async () => globalThis.ReviewKit.review({ drafts: input.body.kinds, live: input.body.live, comps: input.body.comps, now: input.body.now }));
  check('4 browser review = server review', kit.revision === review.body.result.revision, { kit: kit.revision, server: review.body.result.revision });
  const before = (await call(P, 'GET', '/v1/admin/publish/revisions')).body;
  const pub = await time('publish (warm)', () => run('apiPublish', review.body.result.revision));
  check('4 publish live at once', pub.status === 200 && pub.body.result.revision === review.body.result.revision, pub.body && (pub.body.code || pub.body.error));
  const pub2 = await time('publish again (warm, unchanged)', async () => run('apiPublish', (await run('apiReview')).body.result.revision));
  check('4 a second publish', pub2.status === 200, pub2.body && pub2.body.code);
  const live = await fetch(base + '/v1/public/content').then(r => r.json());
  check('4 the public read serves it', JSON.stringify(live).includes('خبر البروفة ' + RUN + ' — بعد النقل'), live.revision);

  /* 5 rollback: D1 → the Sheets */
  const exported = await time('rollback: reverse export', () => sync('/v1/sync/content-export', { at: Date.now() }));
  world.properties.set('WORKER_SYNC_SECRET', SYNC);
  const written = await time('rollback: write the Sheets', async () => plain(world.gs.contentRestoreFrom_(exported.body.kinds, 'apply')));
  const back = plain(world.gs.contentExportPayload_());
  const same = Object.keys(back.kinds).every(k => back.kinds[k].hash === exported.body.kinds[k].hash);
  check('5 the Sheets = D1 after the restore (every kind hash), the edit made on the Worker included', same && JSON.stringify(world.gs.readOptionalTable_('News')).includes('بعد النقل'), written);

  /* 6 switch off */
  await time('switch off', async () => d1("UPDATE settings SET value = '0', updated_at = " + Date.now() + ", updated_by = 'cutover-rehearsal' WHERE key = 'CONTENT_DRAFTS'"));
  const s2 = await session('b');
  check('6 the session says: content on the Sheets again', s2.body && s2.body.boot && s2.body.boot.content === 'sheets', s2.body && s2.body.boot);
  const refused = await call('Bearer ' + s2.body.token, 'POST', '/v1/admin/content/call', { fn: 'apiState', args: [] });
  check('6 a Worker content call is refused (one writer)', refused.status === 409 && refused.body.code === 'writer', refused.body);

  /* 7 the publish rolled back too */
  const prev = before && before.jobs && before.jobs.find(j => j.live);
  if (prev) {
    const after = (await call(P, 'GET', '/v1/admin/publish/revisions')).body;
    const current = after.jobs.find(j => j.live);
    const restored = await time('rollback: restore the publish before', () => call(P, 'POST', '/v1/admin/publish/restore', { to: prev.id, expect: current.id }));
    check('7 «ارجع للنسخة دي» to the publish before the cutover', restored.status === 200, restored.body);
    const liveAgain = await fetch(base + '/v1/public/content').then(r => r.json());
    check('7 the site serves the earlier text', !JSON.stringify(liveAgain).includes('خبر البروفة ' + RUN + ' — بعد النقل'), liveAgain.revision);
  } else {
    console.log('skip 7: no earlier publish on staging');
  }
} finally {
  const now = d1("SELECT value FROM settings WHERE key = 'CONTENT_DRAFTS'")[0].value;
  if (now !== '0') d1("UPDATE settings SET value = '0', updated_at = " + Date.now() + ", updated_by = 'cutover-rehearsal' WHERE key = 'CONTENT_DRAFTS'");
  // the approval checks replace staging's approved set: put the one from before back
  const raw = JSON.stringify({ dests: payDest.map(r => ({ servantId: r.servant_id, method: r.method, number: r.number, name: r.name, source: r.source, approvedAt: r.approved_ms, approvedBy: r.approved_by })) });
  const ts = String(Date.now() + 99);
  await fetch(base + '/v1/sync/pay-dest', { method: 'POST', headers: { 'content-type': 'text/plain', 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + createHmac('sha256', SYNC).update(ts + '.' + raw).digest('hex') }, body: raw });
}

console.log('\ntimings (ms):');
for (const [k, v] of Object.entries(T)) console.log('  ' + k.padEnd(36) + v);
console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
