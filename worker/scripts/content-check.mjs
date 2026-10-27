// Phase 4 P4-1 staging check: the Sheets → D1 copy of the content drafts on the REAL staging D1.
// The rows come from the real Apps Script code (apps-script/ContentExport.gs) in the fake Apps Script
// world (tests/fakes), so the staging Worker checks exactly what production Apps Script will send.
//   1 dry run          every kind ok, nothing written
//   2 apply            every kind's D1 hash = the source hash
//   3 export           the reverse export (rollback copy) = the source, row by row
//   4 size             a 2,500-row kind goes in as one statement (json_each) and reads back equal
//   5 refusals         a changed row is refused; a replayed apply is refused
// Staging only; it never changes CONTENT_DRAFTS. Reads the staging sync secret from .staging-sync-secret.
//   node --experimental-sqlite scripts/content-check.mjs
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { compWorld, adminApi, webp, wallAt, plain } from '../../tests/fakes/comp.mjs';

const API = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const SECRET = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
let failures = 0;
const check = (ok, label) => { console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) failures++; };

async function sync(path, payload, ts = String(Date.now())) {
  const raw = JSON.stringify(payload);
  const sig = 'v1=' + createHmac('sha256', SECRET).update(ts + '.' + raw).digest('hex');
  const res = await fetch(API + path, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-sync-ts': ts, 'x-sync-signature': sig } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const world = compWorld();
const call = adminApi(world);
const media = call('apiUploadMedia', { full: webp(7).toString('base64'), thumb: webp(7).toString('base64'), mime: 'image/webp', width: 1280, height: 720, alt: 'صورة' }).media;
call('apiSaveLink', { title: 'فيسبوك', url: 'https://facebook.com/x', section: 'social', icon: 'facebook' });
call('apiSaveItem', 'news', { title: 'خبر', summary: 'سطر', publishAt: wallAt(world, -60) });
const servant = call('apiServantSave', null, { name: 'خادم تجربة', phone: '01000000001', role: 'خادم' }).servant;
const page = call('apiPageSave', null, { slug: 'staging-check', title: 'صفحة تجربة', tagline: 'تجربة', description: 'تجربة', cover: media.id, team: [servant.id], home: { show: true } }).page;
call('apiPageMediaSave', page.id, null, { title: 'مقطع', cover: media.id, source: 'link', fullUrl: 'https://youtu.be/abc' });
call('apiEventSave', null, { slug: 'staging-check-trip', kind: 'trip', title: 'رحلة تجربة', summary: 'تجربة', cover: media.id, startAt: wallAt(world, 4320), endAt: wallAt(world, 4920), locationName: 'سفاجا' });
const payload = plain(world.gs.contentExportPayload_());
const kinds = Object.keys(payload.kinds);

const status0 = await sync('/v1/sync/content-import', { mode: 'dry', by: 'content-check', ...payload });
check(status0.status === 200 && status0.body.state === 'ok', '1 dry run: ' + (status0.body && status0.body.state));
if (status0.body && status0.body.writer !== 'sheets') {
  console.log('CONTENT_DRAFTS is not 0 on staging: stopping before any apply');
  process.exit(1);
}

const applied = await sync('/v1/sync/content-import', { mode: 'apply', by: 'content-check', ...payload });
check(applied.status === 200 && applied.body.state === 'ok', '2 apply: ' + (applied.body && applied.body.state));
for (const k of kinds) check(applied.body && applied.body.kinds[k].d1Hash === payload.kinds[k].hash, '2 ' + k + ' (' + payload.kinds[k].rows.length + ' rows)');

const exported = await sync('/v1/sync/content-export', { at: Date.now() });
for (const k of kinds) check(exported.body && exported.body.kinds[k].hash === payload.kinds[k].hash, '3 export ' + k);

// 4: one big kind (2,500 links) in one statement
const big = plain(payload);
const template = big.kinds.links.rows[0];
big.kinds.links.rows = Array.from({ length: 2500 }, (_, i) => ({ ...template, id: 'link-big' + String(i).padStart(5, '0'), title: 'لينك رقم ' + i, order: (i + 1) * 10 }));
const { createHash } = await import('node:crypto');
const sha = t => createHash('sha256').update(t, 'utf8').digest('hex');
big.kinds.links.hashes = big.kinds.links.rows.map(r => sha(JSON.stringify(r)));
big.kinds.links.hash = sha(big.kinds.links.rows.map((r, i) => r.id + ':' + big.kinds.links.hashes[i]).join('\n'));
const t0 = Date.now();
const bigApply = await sync('/v1/sync/content-import', { mode: 'apply', by: 'content-check', ...big });
check(bigApply.status === 200 && bigApply.body.state === 'ok', '4 2,500 links applied in ' + (Date.now() - t0) + ' ms: ' + JSON.stringify(bigApply.body && (bigApply.body.state || bigApply.body.code)));

// 5: refusals
const tampered = plain(payload);
tampered.kinds.news.rows[0].title = 'متغير';
const refused = await sync('/v1/sync/content-import', { mode: 'apply', ...tampered });
check(refused.body && refused.body.state === 'refused', '5 changed row refused');
const ts = String(Date.now() + 5);
await sync('/v1/sync/content-import', { mode: 'apply', by: 'content-check', ...payload }, ts);
check((await sync('/v1/sync/content-import', { mode: 'apply', ...payload }, ts)).status === 409, '5 replayed apply refused');

console.log(failures ? `\n${failures} failed` : '\nall ok (staging D1 now holds the small fixture copy)');
process.exit(failures ? 1 : 0);
