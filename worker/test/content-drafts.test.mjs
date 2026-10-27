// Phase 4 P4-1: the content drafts in D1 (src/content/*) against the real Apps Script code
// (apps-script/ContentExport.gs in the fake Apps Script world, tests/fakes/gas.mjs):
// the copy Sheets → D1 (dry run, apply, every row checked), the refusals, the one-writer
// switch, the panel's read (whole / same / delta), and the rollback D1 → Sheets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { KINDS, KIND_NAMES } from '../src/content/kinds.js';
import { compWorld, adminApi, webp, wallAt, plain } from '../../tests/fakes/comp.mjs';

const SECRET = 'sync-test-secret';
let clock = Date.now();

async function worker() {
  const g = await fakeGoogle();
  const h = harness();
  await h.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES ('admin@example.com', 'الأدمن', 'primary', 1, 0)").run();
  const admin = async (path, claims = {}) => h.call(path, { headers: { authorization: 'Bearer ' + await g.sign(g.claims(claims)) }, fetch: g.fetch });
  const sync = async (path, payload, ts = String(++clock)) => {
    const raw = JSON.stringify(payload);
    return h.call(path, { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': await signSync(SECRET, ts, raw) } });
  };
  return { h, admin, sync };
}

/* an Apps Script world with something in every tab the admin edits */
function sheets() {
  const world = compWorld();
  const call = adminApi(world);
  const media = call('apiUploadMedia', { full: webp(7).toString('base64'), thumb: webp(7).toString('base64'), mime: 'image/webp', width: 1280, height: 720, alt: 'صورة' }).media;
  call('apiSaveLink', { title: 'فيسبوك', url: 'https://facebook.com/x', section: 'social', icon: 'facebook' });
  call('apiSaveLink', { title: '=SUM(A1)', url: 'https://example.com/=x', section: 'social' });
  call('apiSaveItem', 'news', { title: 'خبر', summary: 'سطر', publishAt: wallAt(world, -60) });
  call('apiSaveItem', 'games', { title: 'لعبة', url: 'https://example.com/g', startAt: wallAt(world, 60), endAt: wallAt(world, 120) });
  const servant = call('apiServantSave', null, { name: 'مينا', phone: '01012345678', role: 'خادم', publicWa: true }).servant;
  const page = call('apiPageSave', null, { slug: 'black-theatre', title: 'المسرح الأسود', tagline: 'عروض', description: 'فريق', cover: media.id, team: [servant.id], home: { show: true } }).page;
  call('apiPageMediaSave', page.id, null, { title: 'العرض', cover: media.id, source: 'link', fullUrl: 'https://youtu.be/abc' });
  call('apiEventSave', null, { slug: 'alex-trip', kind: 'trip', title: 'رحلة', summary: 'بحر', cover: media.id, startAt: wallAt(world, 3 * 1440), endAt: wallAt(world, 3 * 1440 + 600), locationName: 'إسكندرية' });
  return { world, call };
}

const exportOf = world => plain(world.gs.contentExportPayload_());

test('kinds: the Worker list = ContentExport.gs = the tabs the code writes (Store.gs TABLES, CompStore.gs COMP_TABLES)', () => {
  const { gs } = compWorld();
  const list = plain(gs.CONTENT_EXPORT_KINDS);
  assert.deepEqual(list.map(k => k[0]), KIND_NAMES);
  for (const [kind, sheet, tab, key] of list) {
    const spec = KINDS[kind];
    assert.equal(spec.tab, tab, kind);
    assert.equal(spec.sheet, sheet, kind);
    assert.equal(spec.key, key, kind);
    assert.deepEqual(spec.columns, plain(sheet === 'content' ? gs.TABLES[tab].columns : gs.COMP_TABLES[tab]), kind + ' columns');
  }
  // every content tab the admin edits is copied (Log is the old activity, already in D1)
  const contentTabs = Object.keys(plain(gs.TABLES)).filter(t => t !== 'Log');
  assert.deepEqual(contentTabs.sort(), list.filter(k => k[1] === 'content').map(k => k[2]).sort());
});

test('import: dry run checks every row and writes nothing; apply copies exactly; D1 read back = the Sheets', async () => {
  const { world } = sheets();
  const payload = exportOf(world);
  for (const kind of ['settings', 'sections', 'links', 'news', 'games', 'media', 'activities', 'types', 'pages', 'page_media', 'events', 'servants']) {
    assert.ok(payload.kinds[kind].rows.length > 0, kind + ' has rows in the fixture');
  }
  const { h, admin, sync } = await worker();

  const dry = await sync('/v1/sync/content-import', { mode: 'dry', by: 'menazakmena@gmail.com', ...payload });
  assert.equal(dry.status, 200, JSON.stringify(dry.body));
  assert.equal(dry.body.state, 'ok');
  assert.equal(dry.body.kinds.links.rows, payload.kinds.links.rows.length);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM draft_rows').first()).n, 0, 'dry run writes no draft');

  const apply = await sync('/v1/sync/content-import', { mode: 'apply', by: 'menazakmena@gmail.com', ...payload });
  assert.equal(apply.status, 200, JSON.stringify(apply.body));
  assert.equal(apply.body.state, 'ok');
  for (const kind of KIND_NAMES) {
    assert.equal(apply.body.kinds[kind].ok, true, kind);
    assert.equal(apply.body.kinds[kind].d1Hash, payload.kinds[kind].hash, kind);
  }

  // the panel's read: every row, in the Sheet's order, the same values; private columns only as "set"
  const read = await admin('/v1/admin/content/drafts');
  assert.equal(read.status, 200, JSON.stringify(read.body));
  for (const kind of KIND_NAMES) {
    const got = read.body.kinds[kind].rows.map(r => r.data);
    const want = payload.kinds[kind].rows.map(row => {
      const copy = { ...row };
      for (const c of KINDS[kind].private || []) copy[c] = copy[c] === '' ? '' : true;
      return copy;
    });
    assert.deepEqual(got, want, kind);
  }
  const servant = read.body.kinds.servants.rows[0].data;
  assert.equal(servant.phone, true, 'a servant phone is not sent to the panel read');
  assert.ok(!JSON.stringify(read.body).includes('01012345678'));

  const status = await admin('/v1/admin/content/status');
  assert.equal(status.body.writer, 'sheets');
  assert.deepEqual(status.body.imports.map(i => i.mode + ':' + i.state), ['apply:ok', 'dry:ok']);
  const act = await h.db.prepare("SELECT action, actor FROM activity WHERE entity_type = 'content'").all();
  assert.deepEqual(act.results.map(a => a.action + ' ' + a.actor), ['import menazakmena@gmail.com']);
});

test('import refusals: a changed row, a missing kind, a replay, a bad signature, and apply while D1 is the writer', async () => {
  const { world } = sheets();
  const payload = exportOf(world);
  const { h, sync } = await worker();

  const tampered = plain(payload);
  tampered.kinds.links.rows[0].title = 'غيرناه في السكة';
  const r1 = await sync('/v1/sync/content-import', { mode: 'apply', ...tampered });
  assert.equal(r1.body.state, 'refused');
  assert.match(r1.body.kinds.links.problems.join(' '), /hash differs/);

  const partial = plain(payload);
  delete partial.kinds.events;
  const r2 = await sync('/v1/sync/content-import', { mode: 'apply', ...partial });
  assert.equal(r2.body.state, 'refused');
  assert.match(r2.body.error, /missing kinds: events/);

  const extra = plain(payload);
  extra.kinds.links.rows[0].secret = 'x';
  assert.match((await sync('/v1/sync/content-import', { mode: 'dry', ...extra })).body.kinds.links.problems.join(' '), /unknown column secret/);

  const dup = plain(payload);
  dup.kinds.links.rows[1].id = dup.kinds.links.rows[0].id;
  assert.match((await sync('/v1/sync/content-import', { mode: 'dry', ...dup })).body.kinds.links.problems.join(' '), /duplicate key/);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM draft_rows').first()).n, 0, 'nothing written by a refused copy');

  const ts = String(++clock);
  assert.equal((await sync('/v1/sync/content-import', { mode: 'apply', ...payload }, ts)).status, 200);
  assert.equal((await sync('/v1/sync/content-import', { mode: 'apply', ...payload }, ts)).status, 409, 'an apply is never replayed');

  const raw = JSON.stringify({ mode: 'dry', ...payload });
  const forged = await h.call('/v1/sync/content-import', { method: 'POST', body: raw, headers: { 'x-sync-ts': String(++clock), 'x-sync-signature': await signSync('wrong-secret', String(clock), raw) } });
  assert.equal(forged.status, 401);

  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'CONTENT_DRAFTS'").run();
  const refused = await sync('/v1/sync/content-import', { mode: 'apply', ...payload });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'writer');
  const dryStill = await sync('/v1/sync/content-import', { mode: 'dry', ...payload });
  assert.equal(dryStill.body.state, 'ok', 'a dry run still compares while D1 writes');
  assert.equal(dryStill.body.kinds.links.d1Before.same, true, 'and says D1 equals the Sheets');
});

test('panel read: unchanged kinds come back as "same", a newer kind as the rows changed since (tombstones too); an import resets deltas', async () => {
  const { world } = sheets();
  const payload = exportOf(world);
  const { h, admin, sync } = await worker();
  await sync('/v1/sync/content-import', { mode: 'apply', ...payload });

  const first = (await admin('/v1/admin/content/drafts?kinds=links,news')).body.kinds;
  assert.deepEqual(Object.keys(first), ['links', 'news']);
  const v = first.links.version;
  const same = (await admin(`/v1/admin/content/drafts?kinds=links,news&since=links:${v},news:${first.news.version}`)).body.kinds;
  assert.equal(same.links.same, true);
  assert.equal(same.news.same, true);

  // a Worker-side change (P4-2 writes this way): bump the kind, stamp the row with the new kind version
  const [a, b] = first.links.rows;
  await h.db.batch([
    h.db.prepare("UPDATE draft_kinds SET version = version + 1, source = 'worker' WHERE kind = 'links'"),
    h.db.prepare("UPDATE draft_rows SET version = version + 1, kver = (SELECT version FROM draft_kinds WHERE kind = 'links'), data = json_set(data, '$.title', 'جديد') WHERE kind = 'links' AND id = ?").bind(a.id),
    h.db.prepare("UPDATE draft_rows SET deleted_ms = 1, kver = (SELECT version FROM draft_kinds WHERE kind = 'links') WHERE kind = 'links' AND id = ?").bind(b.id)
  ]);
  const delta = (await admin(`/v1/admin/content/drafts?kinds=links&since=links:${v}`)).body.kinds.links;
  assert.equal(delta.delta, true);
  assert.deepEqual(delta.rows.map(r => r.deleted ? r.id + ':deleted' : r.id + ':' + r.data.title), [a.id + ':جديد', b.id + ':deleted']);

  // a new import replaces the kind whole: a holder of an older version gets the whole kind again
  await sync('/v1/sync/content-import', { mode: 'apply', ...payload });
  const after = (await admin(`/v1/admin/content/drafts?kinds=links&since=links:${v + 1}`)).body.kinds.links;
  assert.equal(after.delta, undefined);
  assert.equal(after.rows.length, payload.kinds.links.rows.length);
});

test('rollback: D1 → the Sheets by column name; the Sheets read back equal D1; unknown columns kept; a bad copy writes nothing', async () => {
  const { world, call } = sheets();
  const payload = exportOf(world);
  const before = plain(world.gs.readDraftNow_());
  const { h, sync } = await worker();
  await sync('/v1/sync/content-import', { mode: 'apply', ...payload });

  // a column someone added by hand on the Links tab
  const links = world.spreadsheet.getSheetByName('Links');
  const width = links.getLastColumn();
  links.getRange(1, width + 1).setValue('handNote');
  links.getRange(2, width + 1).setValue('ملاحظة');
  const keptId = links.getRange(2, 1).getValue();

  // the Sheets drift after the copy (what a rollback undoes)
  const ids = payload.kinds.links.rows.map(r => r.id);
  call('apiDeleteLink', ids[1]);
  call('apiSaveLink', { title: 'لينك بعد النقل', url: 'https://example.com/late', section: 'social' });
  assert.notEqual(exportOf(world).kinds.links.hash, payload.kinds.links.hash);

  const exported = (await sync('/v1/sync/content-export', { at: 1 })).body.kinds;
  assert.equal(exported.links.hash, payload.kinds.links.hash);

  const bad = plain(exported);
  bad.events.rows[0][5] = 'متغير';
  assert.throws(() => world.gs.contentRestoreFrom_(bad, 'apply'), /مش سليمة/);
  assert.notEqual(exportOf(world).kinds.links.hash, payload.kinds.links.hash, 'nothing written');

  const written = plain(world.gs.contentRestoreFrom_(exported, 'apply'));
  assert.equal(written.links, payload.kinds.links.rows.length);
  const after = exportOf(world);
  for (const kind of KIND_NAMES) assert.equal(after.kinds[kind].hash, exported[kind].hash, kind);
  assert.deepEqual(plain(world.gs.readDraftNow_()).links, before.links, 'the admin reads the same links again');
  const row = links.getRange(1, 1, links.getLastRow(), width + 1).getValues().find(line => line[0] === keptId);
  assert.equal(row[width], 'ملاحظة', 'a hand-added column keeps its value');
  // a text that looks like a formula stays text
  assert.ok(plain(world.gs.readTable_('Links')).some(l => l.title === '=SUM(A1)'));

  // the reverse export through the admin route needs system.manage (primary here) and carries private columns
  const g = await fakeGoogle();
  const full = await h.call('/v1/admin/content/export', { headers: { authorization: 'Bearer ' + await g.sign(g.claims()) }, fetch: g.fetch });
  assert.equal(full.status, 200);
  assert.ok(JSON.stringify(full.body).includes('01012345678'), 'the rollback copy keeps servant phones');
});

test('admin routes: content reads need a signed-in admin', async () => {
  const { h } = await worker();
  assert.equal((await h.call('/v1/admin/content/drafts')).status, 401);
  assert.equal((await h.call('/v1/admin/content/export')).status, 401);
  const exp = await h.call('/v1/sync/content-export', { method: 'POST', body: '{}', headers: { 'x-sync-ts': String(Date.now()), 'x-sync-signature': 'v1=00' } });
  assert.equal(exp.status, 401);
});
