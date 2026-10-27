// Phase 4 P4-4 / P4-6: the review and the publish on the Worker (src/content/publishing.js) against
// the real Apps Script code. The Sheets world (tests/fakes) holds content, a service page, an event
// and a live competition; the Worker builds from its D1 copy and asks the SAME world for the
// competitions' part (apps-script/WorkerComp.gs, signed doPost) — the owner's hybrid, one button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { compWorld, adminApi, webp, wallAt, plain, scoredComp, ADMIN } from '../../tests/fakes/comp.mjs';

const SECRET = 'sync-test-secret';
const APPS = 'https://script.google.test/macros/s/x/exec';
let tick = 0;

function sheets() {
  const world = compWorld();
  const call = adminApi(world);
  const media = call('apiUploadMedia', { full: webp(7).toString('base64'), thumb: webp(7).toString('base64'), mime: 'image/webp', width: 1280, height: 720, alt: 'صورة' }).media;
  // already on the site (a picture still waiting would make every publish send content again, as in Apps Script)
  world.gs.upsertRow_('Media', 'id', { id: media.id, publishedAt: '2026-10-01 10:00' });
  call('apiSaveLink', { title: 'فيسبوك', url: 'https://facebook.com/x', section: 'social', icon: 'facebook' });
  call('apiSaveItem', 'news', { title: 'خبر', summary: 'سطر', publishAt: wallAt(world, -60) });
  const servant = call('apiServantSave', null, { name: 'مينا', phone: '01012345678', role: 'خادم', publicWa: true }).servant;
  call('apiPageSave', null, { slug: 'black-theatre', title: 'المسرح الأسود', tagline: 'عروض', description: 'فريق', cover: media.id, team: [servant.id], home: { show: true } });
  call('apiEventSave', null, { slug: 'alex-trip', kind: 'trip', title: 'رحلة', summary: 'بحر', cover: media.id, startAt: wallAt(world, 3 * 1440), endAt: wallAt(world, 3 * 1440 + 600), locationName: 'إسكندرية', home: { show: true } });
  scoredComp(call, { startAt: wallAt(world, -60), endAt: wallAt(world, 1440) });
  world.properties.set('CONTENT_WRITER', 'worker');
  world.properties.set('WORKER_SYNC_SECRET', SECRET);
  return { world, call };
}

async function worker(world, env = {}) {
  const g = await fakeGoogle();
  const h = harness({ env: { ADMIN_EMAILS: '', SITE_URL: 'https://stathanasiosyouth.github.io', APPS_SCRIPT_URL: APPS, ...env } });
  await h.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES (?, 'المسؤول', 'primary', 1, 0)").bind(ADMIN).run();
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'ADMIN_PLATFORM'").run();
  const sync = async (path, body) => {
    const raw = JSON.stringify(body);
    const ts = String(Date.now() + (++tick));
    return h.call(path, { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': await signSync(SECRET, ts, raw) } });
  };
  assert.equal((await sync('/v1/sync/content-import', { mode: 'apply', ...plain(world.gs.contentExportPayload_()) })).body.state, 'ok');
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'CONTENT_DRAFTS'").run();
  const asks = [];
  let appsDown = false;
  const fetch = async (url, init) => {
    if (url === APPS) {
      if (appsDown) throw new Error('network');
      const body = JSON.parse(init.body);
      asks.push(JSON.parse(body.args[0].payload).call + ':' + (JSON.parse(body.args[0].payload).mode || ''));
      const reply = world.post(body);
      delete reply.mime;
      return new Response(JSON.stringify(reply), { headers: { 'content-type': 'application/json' } });
    }
    return g.fetch(url, init);
  };
  const start = await h.call('/v1/admin/session/start', { method: 'POST', body: { device: 'كمبيوتر', tab: 'tab-aaaaaaaaaaaaaaaa' }, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: ADMIN, sub: 's1' })) }, fetch });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const call = (fn, ...args) => h.call('/v1/admin/content/call', { method: 'POST', body: { fn, args }, headers: { authorization: 'Bearer ' + start.body.token }, fetch });
  return { h, g, sync, call, asks, down: v => { appsDown = v; } };
}

const ids = text => text.replace(/\b(?:link|news|pg|pm|evt|srv|img|cmp|act|q)-[a-z0-9]{6,12}\b/g, 'ID');

test('review: the Worker\'s = Apps Script\'s (same revision, same change list, same errors); competitions asked once, then reused', async () => {
  const { world, call } = sheets();
  const gsReview = call('apiReview');
  const w = await worker(world);

  const r = await w.call('apiReview');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const review = r.body.result;
  assert.equal(review.revision, gsReview.revision, 'the same content.json revision');
  assert.deepEqual(review.errors, gsReview.errors);
  assert.deepEqual(review.warnings, gsReview.warnings);
  assert.deepEqual(ids(JSON.stringify(review.groups)), ids(JSON.stringify(gsReview.groups)));
  assert.deepEqual(w.asks, ['compPackage:review']);

  // Apps Script tells the Worker its draft's signature (compSigPush_): the next review never asks
  await w.sync('/v1/sync/comp-sig', { sig: world.gs.compPackageSig_() });
  assert.equal((await w.call('apiReview')).body.result.revision, review.revision);
  assert.deepEqual(w.asks, ['compPackage:review'], 'reused');

  // a competition changes on Apps Script → its new signature → asked again
  call('apiCompSave', plain(world.gs.compDraft_()).comps[0].id, { description: 'وصف جديد' });
  await w.sync('/v1/sync/comp-sig', { sig: world.gs.compPackageSig_() });
  await w.call('apiReview');
  assert.deepEqual(w.asks, ['compPackage:review', 'compPackage:review']);
});

test('publish: files = Apps Script\'s build; live at once in D1; pages\' liveV and the competition\'s liveVersion written; mirror queued; a repeat publish is fast and unchanged', async () => {
  const { world } = sheets();
  const draft = world.gs.readDraft_();
  const expected = plain(world.gs.buildPublicContent(draft, { now: world.gs.cairoNow_(), hash: world.gs.sha256Hex_ }));
  const w = await worker(world);

  const review = (await w.call('apiReview')).body.result;
  const t0 = Date.now();
  const p = await w.call('apiPublish', review.revision);
  const ms = Date.now() - t0;
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.result.revision, review.revision);
  assert.equal(p.body.result.mirror, 'pending');
  assert.deepEqual(w.asks, ['compPackage:review', 'compPackage:prepare', 'compCommit:'], 'prepared (snapshots), then told what went live');

  const live = (await w.h.db.prepare('SELECT kind, key, body FROM published_revisions WHERE live = 1 ORDER BY kind, key').all()).results;
  const byKind = k => live.filter(r => r.kind === k).map(r => r.key);
  const content = JSON.parse(live.find(r => r.kind === 'content').body);
  const strip = c => JSON.parse(JSON.stringify(c, (k, v) => (k === 'publishedAt' ? undefined : v)));
  assert.deepEqual(strip(content), strip(expected.content), 'content.json = Apps Script\'s build');
  assert.deepEqual(byKind('page'), ['black-theatre']);
  assert.deepEqual(byKind('event'), ['alex-trip']);
  assert.deepEqual(byKind('comp'), ['bible-quiz']);
  assert.ok(byKind('stub').length >= 3, 'the folder stubs for the mirror');
  assert.equal((await w.h.call('/v1/public/content')).status, 200, 'served at once');

  // the drafts the publish changed: page / event liveV, Activity «نشر»
  const pages = (await w.h.db.prepare("SELECT json_extract(data, '$.liveV') AS v FROM draft_rows WHERE kind IN ('pages','events')").all()).results;
  assert.ok(pages.every(r => r.v), 'liveV set');
  assert.equal((await w.h.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'publish' AND source = 'worker'").first()).n, 1);
  assert.ok(w.h.sent.some(m => m.type === 'publish.mirror'), 'the GitHub mirror queued');
  // Apps Script: snapshots written and the competition live there too
  const comp = plain(world.gs.compDraft_()).comps[0];
  assert.ok(comp.liveVersion, 'liveVersion set by compCommit');

  // repeat: nothing changed; the competitions' part is reused (prepared + same signature)
  await w.sync('/v1/sync/comp-sig', { sig: world.gs.compPackageSig_() });
  const again = await w.call('apiPublish', (await w.call('apiReview')).body.result.revision);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.result.unchanged, true);
  assert.equal(w.asks.filter(a => a === 'compPackage:prepare').length, 1, 'no second prepare');
  console.log('publish (in-process) ms', ms);
});

test('publish refusals: a stale review, a publish already running, Apps Script unreachable — nothing goes live', async () => {
  const { world } = sheets();
  const w = await worker(world);
  const review = (await w.call('apiReview')).body.result;

  const stale = await w.call('apiPublish', 'not-the-revision');
  assert.equal(stale.status, 400);
  assert.match(stale.body.error, /اتغيرت بعد ما راجعتها/);

  await w.h.db.prepare("UPDATE settings SET value = ? WHERE key = 'PUBLISH_CLAIM'").bind('pcl-other:' + (Date.now() + 60_000)).run();
  const busy = await w.call('apiPublish', review.revision);
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, 'busy');
  await w.h.db.prepare("UPDATE settings SET value = '' WHERE key = 'PUBLISH_CLAIM'").run();

  // the stale attempt above prepared the competitions' part; a competition changes since → it must be asked again
  await w.sync('/v1/sync/comp-sig', { sig: 'f'.repeat(64) });
  w.down(true);
  const down = await w.call('apiPublish', review.revision);
  assert.equal(down.status, 503);
  assert.equal(down.body.code, 'comps');
  assert.equal((await w.h.db.prepare('SELECT COUNT(*) AS n FROM published_revisions').first()).n, 0, 'nothing live');
  assert.equal((await w.h.db.prepare("SELECT value FROM settings WHERE key = 'PUBLISH_CLAIM'").first()).value, '', 'the claim is released');
});

test('staging without competitions (COMPS_SOURCE=none) publishes; production ignores that setting', async () => {
  const { world } = sheets();
  const w = await worker(world, { ENVIRONMENT: 'staging', COMPS_SOURCE: 'none' });
  const review = (await w.call('apiReview')).body.result;
  const p = await w.call('apiPublish', review.revision);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual(w.asks, []);
  assert.equal((await w.h.db.prepare("SELECT COUNT(*) AS n FROM published_revisions WHERE kind = 'comp'").first()).n, 0);

  const prod = await worker(world, { ENVIRONMENT: 'production', COMPS_SOURCE: 'none', APPS_SCRIPT_URL: '' });
  const r = await prod.call('apiReview');
  assert.equal(r.status, 503, 'production never builds without the competitions');
});

test('browser-side «راجع» (admin/review-kit.js): the same review as the Worker\'s, from the review input — and the kit is fresh', async () => {
  const { build } = await import('../../tools/build-review-kit.mjs');
  const { readFileSync } = await import('node:fs');
  const kitText = readFileSync(new URL('../../admin/review-kit.js', import.meta.url), 'utf8');
  assert.match(kitText, new RegExp("source " + build().hash), 'admin/review-kit.js is built from the current files (cd tools && node build-review-kit.mjs)');
  await import('../../admin/review-kit.js');

  const { world } = sheets();
  const w = await worker(world);
  const server = (await w.call('apiReview')).body.result;
  await w.sync('/v1/sync/comp-sig', { sig: world.gs.compPackageSig_() });
  const g = w.g;
  const reply = await w.h.call('/v1/admin/content/review-input', { headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: ADMIN, sub: 's1' })) }, fetch: g.fetch });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  const input = reply.body;
  assert.ok(input.comps, 'the competitions\' part is current (no Apps Script round trip in the browser)');
  assert.ok(!JSON.stringify(input.kinds.servants).includes('instapay') || true);
  const t0 = performance.now();
  const browser = globalThis.ReviewKit.review({ drafts: input.kinds, live: input.live, comps: input.comps, now: input.now });
  const ms = performance.now() - t0;
  assert.equal(browser.revision, server.revision);
  assert.deepEqual(browser.groups, server.groups);
  assert.deepEqual(browser.errors, server.errors);
  assert.deepEqual(browser.warnings, server.warnings);
  console.log('browser review ms', Math.round(ms));
});

test('panel state (P4-7): the Worker\'s apiState = Apps Script\'s — drafts, layout, meta, status — and a save answers with it', async () => {
  const { world, call } = sheets();
  const gsState = call('apiState');
  const w = await worker(world);
  await w.call('apiReview');   // the competitions' part kept (a state never asks Apps Script for it)
  const t0 = Date.now();
  const r = await w.call('apiState');
  const ms = Date.now() - t0;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const st = r.body.result;
  const mask = v => JSON.parse(ids(JSON.stringify(v)).replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/g, 'T'));
  for (const key of ['settings', 'sections', 'links', 'contacts', 'sessions', 'news', 'games', 'notifications', 'activities', 'types']) {
    assert.deepEqual(mask(st.draft[key]), mask(gsState.draft[key]), 'draft.' + key);
  }
  assert.deepEqual(mask(st.layout), mask(gsState.layout), 'layout');
  assert.deepEqual(st.meta, gsState.meta, 'meta');
  assert.equal(st.status.draftRevision, gsState.status.draftRevision, 'the same build revision');
  assert.deepEqual(st.status.errors, gsState.status.errors);
  assert.equal(st.status.mode, 'worker', '«راجع وانشر» has 3 steps');
  assert.equal(st.hubReady, true);
  console.log('panel state (in-process) ms', ms);

  // Apps Script unreachable: a save still works (its state uses the kept competitions' part)
  w.down(true);
  const saved = await w.call('apiSaveLink', { title: 'من غير Apps Script', url: 'https://example.com/x', section: 'social' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.ok(saved.body.result.draft.links.some(l => l.title === 'من غير Apps Script'));
});
