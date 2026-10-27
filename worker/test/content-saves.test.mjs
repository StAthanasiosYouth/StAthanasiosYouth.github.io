// Phase 4 P4-2 / P4-3: the admin's content calls on the Worker (src/content/runtime.js) give the
// SAME drafts, the same refusals and the same answers as Apps Script. Every scenario runs twice from
// one starting copy: in the fake Apps Script world (tests/fakes) and on the Worker (D1, the bundled
// .gs); the two end states are compared row by row (random ids and minute stamps masked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { KINDS, KIND_NAMES } from '../src/content/kinds.js';
import { GS_SOURCE } from '../src/content/gs.gen.js';
import { build } from '../../tools/build-worker-gs.mjs';
import { compWorld, adminApi, webp, wallAt, plain, errorText, ADMIN, SECOND } from '../../tests/fakes/comp.mjs';

const exportOf = world => plain(world.gs.contentExportPayload_());

/* one starting point: a few rows in every tab */
function startWorld() {
  const world = compWorld();
  const call = adminApi(world);
  const media = call('apiUploadMedia', { full: webp(7).toString('base64'), thumb: webp(7).toString('base64'), mime: 'image/webp', width: 1280, height: 720, alt: 'صورة' }).media;
  call('apiSaveLink', { title: 'فيسبوك', url: 'https://facebook.com/x', section: 'social', icon: 'facebook' });
  call('apiSaveItem', 'news', { title: 'خبر', summary: 'سطر', publishAt: wallAt(world, -60) });
  const servant = call('apiServantSave', null, { name: 'مينا', phone: '01012345678', role: 'خادم', publicWa: true }).servant;
  call('apiPageSave', null, { slug: 'black-theatre', title: 'المسرح الأسود', tagline: 'عروض', description: 'فريق', cover: media.id, team: [servant.id], home: { show: true } });
  return { world, call, media };
}

async function workerFrom(payload, { primary = ADMIN } = {}) {
  const g = await fakeGoogle();
  const h = harness({ env: { ADMIN_EMAILS: '', SITE_URL: 'https://stathanasiosyouth.github.io' } });
  await h.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES (?, 'المسؤول', 'primary', 1, 0), (?, 'التاني', 'admin', 1, 0)").bind(primary, SECOND).run();
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'ADMIN_PLATFORM'").run();
  const ts = String(Date.now());
  const raw = JSON.stringify({ mode: 'apply', ...payload });
  const imp = await h.call('/v1/sync/content-import', { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': await signSync('sync-test-secret', ts, raw) } });
  assert.equal(imp.body.state, 'ok', JSON.stringify(imp.body));
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'CONTENT_DRAFTS'").run();
  const tokens = {};
  const session = async email => {
    if (tokens[email]) return tokens[email];
    const r = await h.call('/v1/admin/session/start', { method: 'POST', body: { device: 'Chrome', tab: 'tab-' + email.length.toString().padStart(16, 'a') }, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email, sub: 'sub-' + email })) }, fetch: g.fetch });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    tokens[email] = 'Bearer ' + r.body.token;
    return tokens[email];
  };
  const call = async (fn, args, { as = ADMIN, expect } = {}) => h.call('/v1/admin/content/call', { method: 'POST', body: { fn, args, expect }, headers: { authorization: await session(as) }, fetch: g.fetch });
  const drafts = async () => {
    const out = {};
    const { results } = await h.db.prepare('SELECT kind, data FROM draft_rows WHERE deleted_ms IS NULL ORDER BY kind, pos, id').all();
    for (const k of KIND_NAMES) out[k] = [];
    for (const r of results) out[r.kind].push(JSON.parse(r.data));
    return out;
  };
  return { h, g, call, drafts, session };
}

/* random ids → their order of first appearance; minute stamps and epoch ms → fixed tokens */
function masked(kinds) {
  const ids = new Map();
  const ID = /\b(?:link|contact|news|game|notif|act|pg|pm|evt|srv|img|vid|n|g|a|t)-[a-z0-9]{6,12}\b/g;
  const text = JSON.stringify(KIND_NAMES.map(k => kinds[k]));
  return JSON.parse(text.replace(ID, m => { if (!ids.has(m)) ids.set(m, '#' + ids.size); return ids.get(m); })
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, 'STAMP').replace(/"1\d{12}"/g, '"MS"').replace(/:1\d{12}([,}])/g, ':0$1'));
}

/*
 * Runs steps on both sides. A step: side => [fn, ...args] (side.id(kind, field, value) finds a row's key there).
 * Returns the per-step outcomes; asserts the same success / the same error text.
 */
async function parity(steps, { as = ADMIN } = {}) {
  const { world, media } = startWorld();
  const payload = exportOf(world);
  const w = await workerFrom(payload);
  const gsCall = adminApi(world, as);
  let workerRows = await w.drafts();
  const sides = {
    gs: { media, id: (kind, field, value) => { const r = exportOf(world).kinds[kind].rows.find(x => x[field] === value); return r && r[KINDS[kind].key]; } },
    worker: { media, id: (kind, field, value) => { const r = workerRows[kind].find(x => x[field] === value); return r && r[KINDS[kind].key]; } }
  };
  const outcomes = [];
  for (const step of steps) {
    const [fnA, ...argsA] = step(sides.gs);
    let a;
    try { a = { ok: true, result: plain(gsCall(fnA, ...argsA)) }; } catch (err) { a = { ok: false, error: String(err.message) }; }
    const [fnB, ...argsB] = step(sides.worker);
    const r = await w.call(fnB, argsB, { as });
    const b = r.status === 200 ? { ok: true, result: r.body.result } : { ok: false, error: r.body.error ? errorText(r.body.error) : r.body.code, status: r.status, code: r.body.code };
    assert.equal(b.ok, a.ok, `${fnA}: Apps Script ${a.ok ? 'ok' : 'refused: ' + a.error} / Worker ${b.ok ? 'ok' : 'refused: ' + b.error}`);
    if (!a.ok) assert.equal(b.error, a.error, fnA + ': the same refusal text');
    if (process.env.PARITY_LOG) console.log(fnA, a.ok ? 'ok' : 'refused: ' + a.error);
    outcomes.push({ fn: fnA, gs: a, worker: b });
    workerRows = await w.drafts();
  }
  const gsRows = Object.fromEntries(Object.entries(exportOf(world).kinds).map(([k, v]) => [k, v.rows]));
  assert.deepEqual(masked(workerRows), masked(gsRows), 'the Worker drafts = the Apps Script drafts');
  return { outcomes, w, world };
}

test('the bundle is built from the current apps-script/ files (run: cd tools && node build-worker-gs.mjs)', () => {
  assert.equal(GS_SOURCE, build().hash);
});

test('one writer: while CONTENT_DRAFTS = 0 every content call is refused, nothing written', async () => {
  const { world } = startWorld();
  const w = await workerFrom(exportOf(world));
  await w.h.db.prepare("UPDATE settings SET value = '0' WHERE key = 'CONTENT_DRAFTS'").run();
  const r = await w.call('apiSaveLink', [{ title: 'x', url: 'https://a.com', section: 'social' }]);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'writer');
  assert.equal((await w.h.db.prepare("SELECT COUNT(*) AS n FROM draft_rows WHERE updated_by <> 'apps-script' AND updated_by <> ?").bind(ADMIN).first()).n, 0);
});

test('P4-2 parity: links, sections, contacts, settings — saves, toggles, moves, deletes, and the refusals', async () => {
  await parity([
    () => ['apiSaveLink', { title: 'يوتيوب', url: 'https://youtube.com/x', section: 'social', icon: 'youtube' }],
    () => ['apiSaveLink', { title: 'ناقص', url: 'http://not-https.com', section: 'social' }],
    () => ['apiSaveLink', { title: '', url: 'https://a.com', section: 'nope' }],
    s => ['apiSetLinkEnabled', s.id('links', 'title', 'يوتيوب'), false],
    s => ['apiMoveLink', s.id('links', 'title', 'يوتيوب'), -1],
    s => ['apiSaveLink', { id: s.id('links', 'title', 'يوتيوب'), title: 'يوتيوب ٢', url: 'https://youtube.com/y', section: 'social', startAt: '2026-11-01', endAt: '2026-10-01' }],
    s => ['apiSaveLink', { id: s.id('links', 'title', 'يوتيوب'), title: 'يوتيوب ٢', url: 'https://youtube.com/y', section: 'social', badge: 'جديد' }],
    () => ['apiSaveSection', { key: 'friends', title: 'أصحابنا', subtitle: 'لينكات', theme: 'azure' }, true],
    () => ['apiSaveSection', { key: 'friends', title: 'أصحابنا تاني' }, true],
    () => ['apiMoveSection', 'friends', -1],
    () => ['apiSetSectionEnabled', 'friends', false],
    () => ['apiSaveContact', { name: 'أبونا', phone: '01012345678', method: 'whatsapp', kind: 'service', role: 'كاهن' }],
    () => ['apiSaveContact', { name: 'غلط', phone: '123', method: 'call' }],
    s => ['apiMoveContact', s.id('contacts', 'name', 'أبونا'), -1],
    () => ['apiSaveSettings', { 'site.tagline': 'شعار جديد', 'meeting.time': '19:30' }],
    () => ['apiSaveSettings', { 'meeting.time': 'بكرة' }],
    s => ['apiDeleteLink', s.id('links', 'title', 'فيسبوك')],
    () => ['apiDeleteSection', 'friends']
  ]);
});

test('P4-2 parity: hub items — news, games, notifications, activities, sessions: save, archive, duplicate, enable, delete', async () => {
  await parity([
    () => ['apiSaveItem', 'news', { title: 'خبر تاني', summary: 'تفاصيل', body: 'نص', pinned: true, tone: 'alert', publishAt: '2026-10-20 18:00' }],
    () => ['apiSaveItem', 'news', { title: '', summary: '' }],
    s => ['apiSetItemArchived', 'news', s.id('news', 'title', 'خبر'), true],
    s => ['apiDuplicateItem', 'news', s.id('news', 'title', 'خبر تاني')],
    s => ['apiSetItemEnabled', 'news', s.id('news', 'title', 'خبر تاني'), false],
    () => ['apiSaveItem', 'games', { title: 'لعبة', url: 'https://example.com/g', startAt: '2026-11-01 20:00', endAt: '2026-11-01 21:00', afterEnd: 'show' }],
    () => ['apiSaveItem', 'notifications', { title: 'تنبيه', message: 'رسالة', type: 'general', target: 'meeting', publishAt: '2026-10-25 10:00' }],
    () => ['apiSaveItem', 'activities', { title: 'رحلة', type: 'trip', url: 'https://example.com/trip', startAt: '2026-11-05 07:00' }],
    () => ['apiSaveItem', 'sessions', { date: '2026-11-07', topic: 'موضوع', speaker: 'أبونا', time: '19:00' }],
    () => ['apiSaveItem', 'sessions', { date: '2026-13-40', topic: 'غلط' }],
    s => ['apiDeleteItem', 'games', s.id('games', 'title', 'لعبة')],
    () => ['apiDeleteItem', 'sessions', '2026-11-07']
  ]);
});

test('P4-3 parity: servants, pay methods, pages, page media, events (booking), home order, archive, delete', async () => {
  const { outcomes } = await parity([
    () => ['apiServantSave', null, { name: 'بيشوي', phone: '01112345678', role: 'خادم', instapayNumber: '01212345678', payName: 'بيشوي' }],
    () => ['apiServantSave', null, { name: '', phone: '12' }],
    s => ['apiServantSetActive', s.id('servants', 'name', 'مينا'), false],
    s => ['apiServantSetActive', s.id('servants', 'name', 'مينا'), true],
    () => ['apiPayMethodsSave', [{ key: 'cash', label: 'كاش', active: true }, { key: 'instapay', label: 'إنستاباي', active: true }]],
    s => ['apiPageSave', null, { slug: 'choir', title: 'الكورال', tagline: 'ترانيم', description: 'فريق الكورال', cover: s.media.id, team: [s.id('servants', 'name', 'مينا')], home: { show: true } }],
    s => ['apiPageSave', null, { slug: 'choir', title: 'تاني', cover: s.media.id }],
    s => ['apiPageSave', null, { slug: 'admin', title: 'محجوز', cover: s.media.id }],
    s => ['apiPageMediaSave', s.id('pages', 'slug', 'choir'), null, { title: 'ترنيمة', cover: s.media.id, source: 'link', fullUrl: 'https://youtu.be/abc' }],
    s => ['apiPageMediaSave', s.id('pages', 'slug', 'choir'), null, { title: 'ترنيمة ٢', cover: s.media.id, source: 'link', fullUrl: 'https://youtu.be/def' }],
    s => ['apiPageMediaOrder', s.id('pages', 'slug', 'choir'), [s.id('page_media', 'title', 'ترنيمة ٢'), s.id('page_media', 'title', 'ترنيمة')]],
    s => ['apiPageMediaDelete', s.id('page_media', 'title', 'ترنيمة')],
    s => ['apiPageSetEnabled', s.id('pages', 'slug', 'choir'), false],
    s => ['apiEventSave', null, {
      slug: 'alex-trip', kind: 'trip', title: 'رحلة إسكندرية', summary: 'بحر', cover: s.media.id, startAt: '2026-12-10 07:00', endAt: '2026-12-10 22:00', locationName: 'إسكندرية',
      booking: {
        opensAt: '2026-11-01 10:00', closesAt: '2026-12-05 22:00', capacity: 40,
        pricing: { mode: 'group', categories: [{ label: 'الحاجز', price: 1500 }, { key: 'child', label: 'طفل', group: 'child', price: 800, max: 4 }] },
        payment: { mode: 'installments', minFirst: 500 }
      },
      servants: [{ id: s.id('servants', 'name', 'مينا'), methods: ['cash', 'instapay'] }], home: { show: true }
    }],
    s => ['apiEventSetEnabled', s.id('events', 'slug', 'alex-trip'), false],
    s => ['apiEventArchive', s.id('events', 'slug', 'alex-trip'), true],
    s => ['apiHomeOrder', [s.id('activities', 'title', 'المسرح الأسود')].filter(Boolean)],
    s => ['apiPages'],
    s => ['apiPage', s.id('pages', 'slug', 'choir')],
    s => ['apiEvents'],
    s => ['apiServants'],
    s => ['apiPageDelete', s.id('pages', 'slug', 'choir')]
  ]);
  // the read calls answer the same (ids / stamps masked)
  for (const o of outcomes.filter(o => ['apiPages', 'apiEvents', 'apiServants'].includes(o.fn))) {
    assert.deepEqual(masked({ settings: [o.worker.result] }), masked({ settings: [o.gs.result] }), o.fn);
  }
});

test('P4-3: the primary admin approves a payment number → pay_dest in the same write; others refused; no number in Activity', async () => {
  const { w } = await parity([
    () => ['apiServantSave', null, { name: 'بيشوي', phone: '01112345678', role: 'خادم', instapayNumber: '01212345678', payName: 'بيشوي' }],
    s => ['apiServantPayApprove', s.id('servants', 'name', 'بيشوي'), 'instapay', '01212345678', true]
  ]);
  const dest = await w.h.db.prepare('SELECT servant_id, method, number, approved_by FROM pay_dest').all();
  assert.deepEqual(dest.results.map(d => d.method + ' ' + d.number + ' ' + d.approved_by), ['instapay 01212345678 ' + ADMIN]);
  const act = await w.h.db.prepare("SELECT action, entity_type, changes, summary FROM activity WHERE source = 'worker' AND entity_type = 'servant'").all();
  assert.ok(act.results.length >= 2, JSON.stringify((await w.h.db.prepare("SELECT action, entity_type, source FROM activity").all()).results));
  assert.ok(!JSON.stringify(act.results).includes('01212345678'), 'never a number in Activity');

  const id = (await w.drafts()).servants.find(s => s.name === 'بيشوي').id;
  const other = await w.call('apiServantPayApprove', [id, 'instapay', '01212345678', false], { as: SECOND });
  assert.equal(other.status, 400);
  assert.match(other.body.error, /للأدمن الرئيسي/);
});

test('concurrency: an editor opened at an older version is refused (stale), nothing written; another session\'s edit lock refuses too', async () => {
  const { world } = startWorld();
  const w = await workerFrom(exportOf(world));
  const link = (await w.drafts()).links.find(l => l.title === 'فيسبوك');
  const v = (await w.h.db.prepare("SELECT version FROM draft_rows WHERE kind = 'links' AND id = ?").bind(link.id).first()).version;
  const first = await w.call('apiSaveLink', [{ id: link.id, title: 'فيسبوك ١', url: link.url, section: 'social' }], { expect: { ['links:' + link.id]: v } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.changed, ['links']);
  const second = await w.call('apiSaveLink', [{ id: link.id, title: 'فيسبوك ٢', url: link.url, section: 'social' }], { expect: { ['links:' + link.id]: v } });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'stale');
  assert.equal((await w.drafts()).links.find(l => l.id === link.id).title, 'فيسبوك ١');

  // the other admin's open editor (Phase 3 edit lock on this link)
  await w.session(SECOND);
  const sid = (await w.h.db.prepare('SELECT sid FROM admin_sessions WHERE email = ?').bind(SECOND).first()).sid;
  await w.h.db.prepare("INSERT INTO edit_locks (kind, id, email, name, sid, since_ms, expires_ms) VALUES ('links', ?, ?, 'التاني', ?, ?, ?)").bind(link.id, SECOND, sid, Date.now(), Date.now() + 60_000).run();
  const locked = await w.call('apiSaveLink', [{ id: link.id, title: 'فيسبوك ٣', url: link.url, section: 'social' }]);
  assert.equal(locked.status, 409, JSON.stringify(locked.body));
  assert.equal(locked.body.code, 'locked');
  assert.match(locked.body.error, /بيعدّل ده دلوقتي/);
});

test('after a save: the panel reads only what changed (delta), Activity has the row, the Worker reply carries the kind versions', async () => {
  const { world } = startWorld();
  const w = await workerFrom(exportOf(world));
  const g = w.g;
  const before = (await w.h.call('/v1/admin/content/drafts?kinds=links,news', { headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: ADMIN, sub: 'sub-' + ADMIN })) }, fetch: g.fetch })).body.kinds;
  const r = await w.call('apiSaveLink', [{ title: 'جديد', url: 'https://example.com/n', section: 'social' }]);
  assert.equal(r.status, 200);
  // P4-7: a save answers with the panel state, as Apps Script does (the page redraws from it)
  assert.ok(r.body.result.draft.links.some(l => l.title === 'جديد'), 'the state after the save has it');
  assert.ok(r.body.result.status && r.body.result.layout, 'status and layout as in Apps Script');
  assert.equal(r.body.versions.links, before.links.version + 1);
  const delta = (await w.h.call(`/v1/admin/content/drafts?kinds=links,news&since=links:${before.links.version},news:${before.news.version}`, { headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: ADMIN, sub: 'sub-' + ADMIN })) }, fetch: g.fetch })).body.kinds;
  assert.equal(delta.news.same, true);
  assert.deepEqual(delta.links.rows.map(x => x.data.title), ['جديد']);
  const act = await w.h.db.prepare("SELECT action, entity_type, entity_title, actor FROM activity WHERE source = 'worker' AND entity_type = 'links'").all();
  assert.deepEqual(act.results.map(a => [a.action, a.entity_title, a.actor].join(' ')), ['create جديد ' + ADMIN]);
});

test('permissions: the Apps Script table decides (PERMS_ENFORCE = 1, no grant → denied); a call outside the list is refused', async () => {
  const { world } = startWorld();
  const w = await workerFrom(exportOf(world));
  await w.h.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('PERMS_ENFORCE', '1', 0) ON CONFLICT(key) DO UPDATE SET value = '1'").run();
  const denied = await w.call('apiSaveLink', [{ title: 'x', url: 'https://a.com', section: 'social' }], { as: SECOND });
  assert.equal(denied.status, 403);
  const odd = await w.call('apiCheckGithub', []);
  assert.equal(odd.status, 400);
  const media = await w.call('apiUploadMedia', [{}]);
  assert.equal(media.status, 400, 'media stays on Apps Script until P4-5');
});
