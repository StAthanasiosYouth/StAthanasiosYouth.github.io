// The competitions' admin on the Worker (docs/PHASE5-PLAN.md §3o): the move from Apps Script, then every
// call over D1 with the real apps-script/CompAdmin.gs. The fake Apps Script world is the source of the
// move and the reference for the answers; after the move it is never asked, and refuses changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { compImportTick } from '../src/content/compdrafts.js';
import { compWorld, adminApi, webp, wallAt, plain, scoredComp, errorText, ADMIN, SECOND } from '../../tests/fakes/comp.mjs';

const SECRET = 'sync-test-secret';
const APPS = 'https://script.google.test/macros/s/x/exec';
let tick = 0;
const thrown = fn => { try { fn(); } catch (err) { return errorText(err).replace(/^Error: /, ''); } return ''; };

function sheets() {
  const world = compWorld();
  const call = adminApi(world);
  const media = call('apiUploadMedia', { full: webp(7).toString('base64'), thumb: webp(7).toString('base64'), mime: 'image/webp', width: 1280, height: 720, alt: 'صورة' }).media;
  world.gs.upsertRow_('Media', 'id', { id: media.id, publishedAt: '2026-10-01 10:00' });
  call('apiCompSettings', { registry: true, wallet: true });
  const made = scoredComp(call, { startAt: wallAt(world, -60), endAt: wallAt(world, 1440) });
  world.properties.set('CONTENT_WRITER', 'worker');
  world.properties.set('WORKER_SYNC_SECRET', SECRET);
  return { world, call, media, made };
}

async function worker(world, env = {}) {
  const g = await fakeGoogle();
  const h = harness({ env: { ADMIN_EMAILS: '', SITE_URL: 'https://stathanasiosyouth.github.io', APPS_SCRIPT_URL: APPS, ...env } });
  await h.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES (?, 'المسؤول', 'primary', 1, 0), (?, 'التاني', 'admin', 1, 0)").bind(ADMIN, SECOND).run();
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'ADMIN_PLATFORM'").run();
  const sync = async (path, body) => {
    const raw = JSON.stringify(body);
    const ts = String(Date.now() + (++tick));
    return h.call(path, { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': await signSync(SECRET, ts, raw) } });
  };
  assert.equal((await sync('/v1/sync/content-import', { mode: 'apply', ...plain(world.gs.contentExportPayload_()) })).body.state, 'ok');
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'CONTENT_DRAFTS'").run();
  await h.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('BOOKING_ONLINE', '1', 0) ON CONFLICT(key) DO NOTHING").run();
  const asks = [];
  const fetch = async (url, init) => {
    if (url === APPS) {
      const body = JSON.parse(init.body);
      asks.push(JSON.parse(body.args[0].payload).call);
      const reply = world.post(body);
      delete reply.mime;
      return new Response(JSON.stringify(reply), { headers: { 'content-type': 'application/json' } });
    }
    return g.fetch(url, init);
  };
  const tokens = {};
  const session = async email => {
    if (tokens[email]) return tokens[email];
    const r = await h.call('/v1/admin/session/start', { method: 'POST', body: { device: 'كمبيوتر', tab: 'tab-' + email.length.toString().padStart(16, 'a') }, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email, sub: email })) }, fetch });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    tokens[email] = r.body;
    return r.body;
  };
  const call = async (fn, ...args) => h.call('/v1/admin/content/call', { method: 'POST', body: { fn, args }, headers: { authorization: 'Bearer ' + (await session(ADMIN)).token }, fetch });
  const ok = async (fn, ...args) => {
    const r = await call(fn, ...args);
    assert.equal(r.status, 200, fn + ': ' + JSON.stringify(r.body));
    return r.body.result;
  };
  const move = async mode => {
    await h.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('COMP_IMPORT', ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(mode).run();
    return compImportTick(h.env, fetch);
  };
  return { h, g, sync, call, ok, asks, fetch, move, session };
}

const setting = async (h, key) => (await h.db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first() || {}).value;
const rowsOf = async (h, kind) => (await h.db.prepare('SELECT data FROM draft_rows WHERE kind = ? AND deleted_ms IS NULL ORDER BY pos, id').bind(kind).all()).results.map(r => JSON.parse(r.data));

test('the move: a dry run changes nothing; apply copies every row, freezes Apps Script, and is one batch', async () => {
  const { world, call: sheet, made } = sheets();
  const w = await worker(world);
  const source = plain(world.gs.compDraft_());

  const dry = await w.move('dry');
  assert.equal(dry.state, 'ok', JSON.stringify(dry));
  assert.equal(dry.competitions.length, 1);
  assert.equal(dry.questions, source.questions.length);
  assert.equal((await rowsOf(w.h, 'competitions')).length, 0, 'a dry run writes nothing');
  assert.equal(await setting(w.h, 'COMP_DRAFTS'), undefined);
  assert.equal(world.properties.get('COMP_DRAFTS') || null, null, 'and leaves Apps Script open');
  // its card was written to the Sheets' Activities (frozen for content): it comes along
  sheet('apiCompSave', made.id, { description: 'لسه بيتحفظ هناك', card: true });

  const applied = await w.move('apply');
  assert.equal(applied.state, 'applied', JSON.stringify(applied));
  assert.equal(await setting(w.h, 'COMP_DRAFTS'), 'worker');
  assert.equal(await setting(w.h, 'COMP_IMPORT'), '', 'asked once');
  const after = plain(world.gs.compDraft_());
  const strip = rows => rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => k !== '__row')));
  assert.deepEqual(await rowsOf(w.h, 'competitions'), strip(after.comps), 'every competition, every column');
  assert.deepEqual(await rowsOf(w.h, 'questions'), strip(after.questions), 'every question, with its key');
  assert.deepEqual(applied.cards, [after.comps[0].cardId], 'the linked card joined D1');
  assert.ok((await rowsOf(w.h, 'activities')).some(a => a.id === after.comps[0].cardId && a.type === 'competition'));
  assert.ok((await rowsOf(w.h, 'types')).some(a => a.key === 'competition'));
  assert.equal(await setting(w.h, 'COMP_REGISTRY'), '1');
  assert.equal(await setting(w.h, 'COMP_WALLET'), '1');
  assert.ok(await setting(w.h, 'COMP_HASH_KEY'));
  assert.ok(!(await setting(w.h, 'COMP_IMPORT_REPORT')).includes(await setting(w.h, 'COMP_HASH_KEY')), 'the report never holds the key');

  // one writer: Apps Script refuses, and says what to do
  assert.match(thrown(() => sheet('apiCompSave', made.id, { description: 'بعد النقل' })), /السيرفر الجديد/);
  assert.equal(plain(world.gs.compDraft_()).comps[0].description, 'لسه بيتحفظ هناك');

  // a second apply is refused and changes nothing
  const again = await w.move('apply');
  assert.equal(again.state, 'failed');
  assert.match(again.problems[0], /already worker/);
});

test('the signature with a big view is accepted: the store items keep arriving after the move', async () => {
  const { world } = sheets();
  const w = await worker(world);
  await w.move('apply');
  const items = Array.from({ length: 200 }, (_, i) => ({ id: 'itm-' + i, name: 'جائزة ' + i, image: 'img-' + i, active: '1' }));
  const comps = Array.from({ length: 50 }, (_, i) => ({ id: 'cmp-' + i, slug: 's-' + i, title: 'مسابقة ' + i, banner: '', icon: '' }));
  const sent = await w.sync('/v1/sync/comp-sig', { sig: 'a'.repeat(64), view: { comps, questions: [], items } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const view = JSON.parse((await w.h.db.prepare("SELECT data FROM comp_package WHERE id = 'view'").first()).data);
  assert.equal(view.items.length, 200);
  assert.equal(view.items[0].active, '1');
  assert.equal((await rowsOf(w.h, 'competitions')).length, 1, 'the drafts stay D1\'s: the view never replaces them');
});

test('before the move the calls are refused and the panel keeps using Apps Script', async () => {
  const { world } = sheets();
  const w = await worker(world);
  assert.equal((await w.call('apiComps')).status, 409);
  const start = await w.session(ADMIN);
  assert.equal(start.boot, undefined);
  const r = await w.h.call('/v1/admin/session/start', { method: 'POST', body: { device: 'كمبيوتر', tab: 'tab-bbbbbbbbbbbbbbbb', boot: true, force: true }, headers: { authorization: 'Bearer ' + await w.g.sign(w.g.claims({ email: SECOND, sub: 'x' })) }, fetch: w.fetch });
  assert.equal(r.body.boot.comps, 'apps-script');
});

test('authoring on the Worker = Apps Script: the same scenario gives the same rows and answers, and none of it asks Apps Script', async () => {
  const { world, call: sheet, made } = sheets();
  const reference = sheets();
  const w = await worker(world);
  assert.equal((await w.move('apply')).state, 'applied');
  const asked = w.asks.length;
  const id = made.id;
  const refId = reference.made.id;
  const same = text => JSON.stringify(text).replace(/\b(?:cmp|q|act|c)-[a-z0-9]{6,12}\b/g, 'ID').replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/g, 'T').replace(/-[0-9a-f]{4}"/g, '-X"').replace(/"[0-9a-f]{16}"/g, '"V"');

  const steps = [
    ['apiCompSave', i => [i, { description: 'وصف جديد', participation: 'registered', wallet: true, showPoints: true }]],
    ['apiCompQuestionSave', i => [i, { type: 'single', text: 'سؤال زيادة', choices: [{ text: 'أ', correct: true }, { text: 'ب' }], points: 3 }]],
    ['apiCompArchive', i => [i, true]],
    ['apiCompArchive', i => [i, false]],
    ['apiCompPreviewDefinition', i => [i]]
  ];
  for (const [fn, args] of steps) {
    const mine = await w.ok(fn, ...args(id));
    const theirs = plain(reference.call(fn, ...args(refId)));
    assert.equal(same(mine), same(theirs), fn);
  }

  // a bad save gets Apps Script's own words
  const bad = await w.call('apiCompSave', id, { slug: 'x y' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, thrown(() => reference.call('apiCompSave', refId, { slug: 'x y' })));

  const created = await w.ok('apiCompCreate', { preset: 'scored', title: 'مسابقة نقاط', slug: 'msabqa-nqat', enabled: true, startAt: wallAt(world, -5), endAt: wallAt(world, 600) });
  const newId = created.comp.id;
  const q1 = (await w.ok('apiCompQuestionSave', newId, { type: 'truefalse', text: 'صح؟', correct: 'صح', points: 5 })).question;
  const q2 = (await w.ok('apiCompQuestionDuplicate', newId, q1.id)).question;
  await w.ok('apiCompQuestionsReorder', newId, [q2.id, q1.id]);
  await w.ok('apiCompQuestionDelete', newId, q2.id);
  const preview = await w.ok('apiCompPreviewGrade', newId, { [q1.id]: 't' });
  assert.equal(preview.score, 5, 'the trial grade');
  assert.equal((await w.ok('apiCompPreviewDefinition', newId)).questions.length, 1);
  const text = 'نوع\tالسؤال\tالاختيارات\tالصح\tالدرجة\nsingle\tمين؟\tأ|ب\tأ\t2';
  const imported = await w.call('apiCompImportPreview', newId, text);
  assert.ok([200, 400].includes(imported.status), 'answers like Apps Script: ' + JSON.stringify(imported.body).slice(0, 200));
  const settings = await w.ok('apiCompSettings', { shop: true });
  assert.equal(settings.modules.shop, true);
  assert.equal(await setting(w.h, 'COMP_SHOP'), '1', 'kept in D1');
  await w.h.flush?.();
  const list = await w.ok('apiComps');
  assert.equal(list.comps.length, 2);
  assert.ok(list.modules.wallet, 'the switches are D1\'s');
  assert.ok(list.comps.find(c => c.id === newId).hasChanges, '«فيه تعديلات لسه متنشرتش»');
  const copy = await w.ok('apiCompDuplicate', newId);
  await w.ok('apiCompDelete', copy.id);
  assert.equal((await rowsOf(w.h, 'competitions')).length, 2);
  assert.deepEqual(w.asks.slice(asked).filter(a => a !== 'compModules'), [], 'Apps Script was never asked but to hear the switches');
  assert.equal(world.gs.compRows_(world.gs.compSheet_('Competitions')).length, 1, 'and its frozen copy did not move');
  void sheet;
});

test('review and publish: the new competition is in the changes, goes live in one batch, plays, and stays «not changed»', async () => {
  const { world } = sheets();
  const w = await worker(world);
  assert.equal((await w.move('apply')).state, 'applied');
  const asked = w.asks.length;
  await w.ok('apiPublish', (await w.ok('apiReview')).revision);

  const created = await w.ok('apiCompCreate', { preset: 'scored', title: 'مسابقة نقاط', slug: 'msabqa-nqat', enabled: true, startAt: wallAt(world, -5), endAt: wallAt(world, 600), participation: 'registered', wallet: true, showPoints: true });
  const id = created.comp.id;
  await w.ok('apiCompQuestionSave', id, { type: 'truefalse', text: 'صح؟', correct: 'صح', points: 5 });
  await w.ok('apiCompSave', id, { card: true });

  const review = await w.ok('apiReview');
  assert.deepEqual(review.errors, []);
  assert.match(JSON.stringify(review.groups), /مسابقة نقاط/, 'it is among the changes ready to publish');

  const p = await w.ok('apiPublish', review.revision);
  assert.equal(p.revision, review.revision);
  const live = await w.h.db.prepare('SELECT * FROM comp_live WHERE comp_id = ?').bind(id).first();
  assert.equal(live.slug, 'msabqa-nqat');
  const row = (await rowsOf(w.h, 'competitions')).find(c => c.id === id);
  assert.equal(row.liveVersion, live.version, 'the draft says the same version as the runtime');
  assert.ok(row.publishedAt);
  const version = await w.h.db.prepare('SELECT def FROM comp_versions WHERE comp_id = ? AND version = ?').bind(id, live.version).first();
  assert.ok(JSON.parse(version.def).questions.length === 1, 'the definition with its key, for grading');
  assert.equal(JSON.parse(version.def).wallet, true, 'points on');
  const files = (await w.h.db.prepare("SELECT kind, key, body FROM published_revisions WHERE live = 1 AND key LIKE 'msabqa-nqat%'").all()).results;
  assert.ok(files.some(f => f.kind === 'comp'), 'comp.json is live');
  assert.ok(!files.find(f => f.kind === 'comp').body.includes('"correct"'), 'never the key in the public file');
  const content = JSON.parse((await w.h.db.prepare("SELECT body FROM published_revisions WHERE live = 1 AND kind = 'content'").first()).body);
  assert.ok(content.competitions.some(c => c.slug === 'msabqa-nqat'));
  assert.ok(JSON.stringify(content).includes('"competition":"msabqa-nqat"'), 'its card is on the site');
  assert.equal(w.asks.length, asked, 'Apps Script was never asked');

  const summary = (await w.ok('apiComps')).comps.find(c => c.id === id);
  assert.equal(summary.hasChanges, false, 'published: nothing waits');
  const repeat = await w.ok('apiPublish', (await w.ok('apiReview')).revision);
  assert.equal(repeat.unchanged, true);

  // close, finalize: at once, without a publish
  await w.ok('apiCompClose', id);
  assert.ok((await w.h.db.prepare('SELECT closed_at FROM comp_live WHERE comp_id = ?').bind(id).first()).closed_at);
  await w.ok('apiCompClose', id, true);
  assert.equal((await w.h.db.prepare('SELECT closed_at FROM comp_live WHERE comp_id = ?').bind(id).first()).closed_at, null);
  await w.ok('apiCompFinalize', id, true);
  assert.ok((await w.h.db.prepare('SELECT finalized_at FROM comp_live WHERE comp_id = ?').bind(id).first()).finalized_at);
  await w.ok('apiCompFinalize', id, false);

  // withdrawn by the next publish
  await w.ok('apiCompArchive', id, true);
  await w.ok('apiPublish', (await w.ok('apiReview')).revision);
  assert.equal(await w.h.db.prepare('SELECT 1 FROM comp_live WHERE comp_id = ?').bind(id).first(), null);
  assert.equal((await rowsOf(w.h, 'competitions')).find(c => c.id === id).liveVersion, '');
});

test('a competition published by Apps Script before the move keeps its version: the same key, no needless change', async () => {
  const { world, call: sheet, made } = sheets();
  world.properties.delete('CONTENT_WRITER');
  const published = sheet('apiReview');
  sheet('apiPublish', published.revision);
  world.properties.set('CONTENT_WRITER', 'worker');
  const before = plain(world.gs.compDraft_()).comps[0].liveVersion;
  assert.ok(before);
  const w = await worker(world);
  assert.equal((await w.move('apply')).state, 'applied');
  const summary = (await w.ok('apiComps')).comps.find(c => c.id === made.id);
  assert.equal(summary.draftVersion, before, 'the Worker computes the very same version');
  assert.equal(summary.hasChanges, false);
});

test('answers stay private: not in the panel\'s drafts, the browser\'s review input or the export', async () => {
  const { world } = sheets();
  const w = await worker(world);
  await w.move('apply');
  const auth = { authorization: 'Bearer ' + (await w.session(ADMIN)).token };
  const drafts = await w.h.call('/v1/admin/content/drafts', { headers: auth });
  assert.equal(drafts.status, 200);
  assert.equal(drafts.body.kinds.questions, undefined);
  assert.equal(drafts.body.kinds.competitions, undefined);
  const input = await w.h.call('/v1/admin/content/review-input', { headers: auth });
  assert.equal(input.status, 200);
  assert.equal(input.body.comps, null, 'the panel asks the Worker\'s review');
  assert.ok(!JSON.stringify(input.body).includes('مين بنى الفلك'));
  const exported = await w.h.call('/v1/admin/content/export', { headers: auth });
  assert.ok(!JSON.stringify(exported.body).includes('مين بنى الفلك'));

});

test('results: the same screens over the Worker\'s submissions; a mark updates the row and its points', async () => {
  const { world } = sheets();
  const w = await worker(world);
  await w.move('apply');
  const made = await w.ok('apiCompCreate', { preset: 'scored', title: 'نتائج', slug: 'results-comp', enabled: true, startAt: wallAt(world, -5), endAt: wallAt(world, 600) });
  const id = made.comp.id;
  const q = (await w.ok('apiCompQuestionSave', id, { type: 'long', text: 'اكتب تأمل', points: 10 })).question;
  await w.ok('apiPublish', (await w.ok('apiReview')).revision);
  const live = await w.h.db.prepare('SELECT version FROM comp_live WHERE comp_id = ?').bind(id).first();
  const now = Date.now();
  await w.h.db.prepare(`INSERT INTO participants (id, name, name_norm, email, email_canon, email_verified_at, email_source, email_verified_via, phone, phone_norm, birth_date, status, pw_hash, pw_enc, pw_version, pw_issued_at, pw_issued_by, created_via, created_at, updated_at)
    VALUES ('p-aaaaaaaa', 'مينا', 'مينا', 'a@b.co', 'a@b.co', 1, 'self', 'otp', '01012345678', '1012345678', '2000-03-12', 'active', 'h', 'e', 1, 1, 'self', 'self', 1, 1)`).run();
  await w.h.db.prepare(`INSERT INTO submissions (id, comp_id, version, client_key, participant_id, attempt_no, status, started_ms, submitted_ms, duration_sec, seed, qids, answers, grading, score, max_score, gradable_count, pending_count, elig, updated_ms)
    VALUES ('s-aaaaaaaaaaaa', ?, ?, 'k1', 'p-aaaaaaaa', 1, 'pending_review', ?, ?, 30, 'seed', ?, ?, ?, 0, 10, 1, 1, 'eligible', ?)`)
    .bind(id, live.version, now - 30000, now, JSON.stringify([q.id]), JSON.stringify({ [q.id]: 'تأمل طويل' }), JSON.stringify({ [q.id]: { ok: null, pts: 0, by: 'auto' } }), now).run();

  const list = await w.ok('apiCompSubmissions', id, { status: 'done' });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, 's-aaaaaaaaaaaa');
  assert.equal(list.items[0].name, 'مينا');
  assert.equal(list.items[0].status, 'pending_review');
  assert.equal(list.counts.pending_review, 1);

  const one = await w.ok('apiCompSubmission', 's-aaaaaaaaaaaa');
  assert.equal(one.questions[0].answerText, 'تأمل طويل');
  assert.equal(one.comp.id, id);

  const queue = await w.ok('apiCompReviewQueue', id);
  assert.equal(queue.total, 1);

  const graded = await w.ok('apiCompGrade', 's-aaaaaaaaaaaa', { [q.id]: 8 });
  assert.equal(graded.submission.score, 8);
  assert.equal(graded.submission.status, 'graded');

  const results = await w.ok('apiCompResults', id);
  assert.equal(results.ranking[0].score, 8);
  assert.equal(results.stats.participants, 1);
  assert.equal((await w.ok('apiCompExport', id)).rows.length, 1);

  const voided = await w.ok('apiCompVoid', 's-aaaaaaaaaaaa', true);
  assert.equal(voided.submission.status, 'void');
  assert.equal((await w.ok('apiCompVoid', 's-aaaaaaaaaaaa', false)).submission.status, 'graded');
  assert.equal((await w.ok('apiCompRegrade', id)).regraded, 1);
  const refused = await w.call('apiCompDelete', id);
  assert.equal(refused.status, 400, 'a competition with submissions is never deleted');
});
