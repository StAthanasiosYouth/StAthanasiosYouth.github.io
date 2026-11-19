// «خبزنا اليومي» W3 (docs/daily-bread/PLAN.md §3): migration 0033, the order (same as the prototype), the admin's
// programs (upload, activate after / now, stop, publish to the pipeline), the member's routes, the 20 minutes,
// breadTick + each device's own text in the consumer, the admin alerts and the retention. Real SQLite, real migrations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { harness, fakeGoogle } from './helpers.mjs';
import { migratedDb } from './d1-sqlite.mjs';
import { orderFor, cairoDay, dayAdd, topicFor, checkTopic } from '../src/bread/model.js';
import { breadTick } from '../src/bread/tick.js';
import { breadDaily, alertStmts } from '../src/bread/alerts.js';
import { EDIT_MS } from '../src/bread/public.js';
import { pushHash } from '../src/push/devices.js';
import { runPart } from '../src/push/send.js';
import { forgetAccessToken, OAUTH_URL } from '../src/push/fcm.js';
import { revisionPath, mirrorPending } from '../src/publish-mirror.js';
import { typeOf, messageOf } from '../src/notify/catalog.js';
import { cairoText } from '../src/lib/db.js';
import { wallMs } from '../src/push/schedule.js';

const KEYS = { PW_PEPPER: 'pepper-test', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp-test', ACCOUNT_PAD_MS: '0' };
const P = 'p@example.com';
const A = 'a@example.com';
const DAY = 86400000;
let serial = 700;

/* the prototype's orders, computed by the prototype itself on 2026-11-17 (pinned: `main` has no docs/daily-bread/) */
const GOLDEN = [
  ['k-7f3a91', 'prg-bread-of-life', 7, [1, 3, 0, 2, 5, 4, 6]],
  ['dev-abc123', 'brd-0123456789', 12, [0, 11, 6, 3, 8, 10, 9, 5, 7, 4, 1, 2]],
  ['ميناء', 'brd-0123456789', 30, [4, 0, 12, 3, 18, 28, 23, 7, 16, 10, 8, 5, 21, 27, 15, 14, 1, 6, 25, 29, 26, 19, 2, 20, 9, 11, 22, 17, 13, 24]]
];

/* the prototype's own functions, taken from its file as they are (null where the file is not in the checkout) */
function prototypeOrder() {
  if (!existsSync(new URL('../../docs/daily-bread/prototype/app.js', import.meta.url))) return null;
  const src = readFileSync(new URL('../../docs/daily-bread/prototype/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const pick = re => { const m = re.exec(src); assert.ok(m, 'prototype: ' + re); return m[0]; };
  const code = [pick(/function hash32\([^]*?\n/), pick(/function mulberry32\([^]*?\n/), pick(/export function orderFor\([^]*?\n\}\n/).replace('export ', '')].join('\n');
  return new Function(code + '\nreturn orderFor;')();
}

const topic = (n, over = {}) => ({
  n, title: 'موضوع رقم ' + n, verseRef: 'يوحنا ٦: ' + n, verse: 'أَنَا هُوَ خُبْزُ الْحَيَاةِ ' + n, readingRef: 'يوحنا ٦: ٣٢–٣٥',
  reading: [{ book: 'يوحنا', chapter: 6, verses: [[32, 'نص العدد ٣٢'], [33, 'نص العدد ٣٣']] }], meditation: 'تأمل اليوم ' + n, question: n % 2 ? 'سؤال ' + n : null, ...over
});

async function world({ env = {} } = {}) {
  forgetAccessToken();
  const g = await fakeGoogle();
  const h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ...KEYS, ...env } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'P', 'primary', 1, 0), ('${A}', 'A', 'admin', 1, 0)`).run();
  await h.db.prepare("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'").run();
  const as = email => async (method, path, body) => h.call('/v1/admin/' + path, { method, body, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email, sub: 's-' + email })) }, fetch: g.fetch });
  const admin = as(P);
  const setting = (key, value) => h.db.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(value, key).run();
  const program = async (days, { mode = 'after', confirm, name = 'برنامج تجربة' } = {}) => {
    const c = await admin('POST', 'bread/programs', { name, days });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const id = c.body.program.id;
    for (let i = 1; i <= days; i += 20) {
      const r = await admin('POST', `bread/programs/${id}/topics`, { topics: Array.from({ length: Math.min(20, days - i + 1) }, (_, k) => topic(i + k)) });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const a = await admin('POST', `bread/programs/${id}/activate`, { mode, confirm });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    return a.body.program;
  };
  const pub = (path, body, token) => h.call(path, { method: body === undefined ? 'GET' : 'POST', body, headers: token ? { authorization: 'Bearer ' + token } : {} });
  return { ...h, h, g, admin, adminA: as(A), setting, program, pub };
}

async function member(w, { birthDate = '2000-03-12' } = {}) {
  serial++;
  const f = { email: `b${serial}@staging.invalid`, phone: '0100' + String(3000000 + serial), name: 'مينا زكريا فؤاد', birthDate };
  const s = await w.call('/v1/account/register/start', { method: 'POST', body: f, headers: { 'cf-connecting-ip': '10.0.2.' + (serial % 200) } });
  const d = await w.call('/v1/account/register/verify', { method: 'POST', body: { pendingId: s.body.pendingId, code: s.body.testCode } });
  const si = await w.call('/v1/account/signin', { method: 'POST', body: { email: f.email, password: d.body.password }, headers: { 'cf-connecting-ip': '10.0.3.' + (serial % 200) } });
  return { ...f, token: si.body.session.token, id: si.body.account.id };
}

// ---------- the order ----------

test('orderFor gives exactly the prototype order (docs/daily-bread/prototype/app.js), a permutation, fixed per seed', () => {
  for (const [seed, prog, n, want] of GOLDEN) assert.deepEqual(orderFor(seed, prog, n), want, 'pinned ' + seed);
  const proto = prototypeOrder();
  for (const seed of ['k-7f3a91', 'dev-abc123', 'p-00000001', 'x'.repeat(40), 'ميناء']) {
    for (const prog of ['prg-bread-of-life', 'brd-0123456789']) {
      for (const n of [1, 2, 7, 30, 120]) {
        const o = orderFor(seed, prog, n);
        if (proto) assert.deepEqual(o, proto(seed, prog, n), seed + ' ' + prog + ' ' + n);
        assert.deepEqual([...o].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i), 'no repeat, nothing missing');
      }
    }
  }
  assert.notDeepEqual(orderFor('dev-aaaaaa', 'brd-0123456789', 30), orderFor('dev-bbbbbb', 'brd-0123456789', 30), 'another person, another order');
});

test('topicFor: the Cairo day index, the late joiner gets the rest only, nothing outside the dates', () => {
  const p = { id: 'brd-0123456789', days: 10, status: 'scheduled', starts_on: '2026-11-01', ends_on: '2026-11-10' };
  const o = orderFor('dev-late01', p.id, 10);
  assert.deepEqual(topicFor('dev-late01', p, '2026-11-01'), { d: 0, n: o[0] + 1 });
  assert.deepEqual(topicFor('dev-late01', p, '2026-11-07'), { d: 6, n: o[6] + 1 }, 'joins on day 7: day 7 of the order, the 6 before are not carried');
  assert.equal(topicFor('dev-late01', p, '2026-10-31'), null);
  assert.equal(topicFor('dev-late01', p, '2026-11-11'), null);
  // Cairo day across midnight UTC (22:30 UTC in winter = 00:30 Cairo next day)
  assert.equal(cairoDay(Date.parse('2026-12-01T22:30:00Z')), '2026-12-02');
});

test('checkTopic refuses missing / long / malformed fields and keeps a clean copy', () => {
  assert.equal(checkTopic(topic(1), 7).ok, true);
  const bad = checkTopic(topic(9, { title: '', verse: 'x'.repeat(2000), reading: [{ book: 'يوحنا', chapter: 0, verses: [] }] }), 7);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map(e => e.field).sort(), ['n', 'reading', 'title', 'verse']);
  assert.equal(checkTopic(topic(1, { reading: [{ book: 'يوحنا', chapter: 6, verses: [['x', 'y']] }] }), 7).ok, false);
});

// ---------- migration ----------

test('0033: the tables, the settings off by default, bread_look on participants', () => {
  const db = migratedDb();
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  for (const t of ['bread_programs', 'bread_topics', 'bread_members', 'bread_slots', 'bread_reflections', 'bread_opens', 'bread_daily']) assert.ok(tables.includes(t), t);
  const s = Object.fromEntries(db.raw.prepare("SELECT key, value FROM settings WHERE key LIKE 'BREAD%' OR key LIKE 'bread%'").all().map(r => [r.key, r.value]));
  assert.deepEqual(s, { BREAD_MODULE: '0', BREAD_PUSH: '0', BREAD_EMPTY_MUTED: '0', bread_default_time: '08:00', bread_max_slots: '3' });
  assert.ok(db.raw.prepare('PRAGMA table_info(participants)').all().some(c => c.name === 'bread_look'));
  assert.ok(db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'bread_slots_minute'").get());
});

// ---------- the admin ----------

test('admin: draft → upload in parts (bad rows refused) → ready → activate publishes the days and the index to the pipeline', async () => {
  const w = await world();
  const c = await w.admin('POST', 'bread/programs', { name: 'خبز الحياة', days: 3 });
  const id = c.body.program.id;
  assert.match(id, /^brd-[0-9a-f]{10}$/);
  assert.equal((await w.admin('POST', 'bread/programs', { name: '', days: 200 })).body.errors.length, 2);
  const badUp = await w.admin('POST', `bread/programs/${id}/topics`, { topics: [topic(1), topic(4)] });
  assert.equal(badUp.status, 400);
  assert.ok(badUp.body.errors.some(e => e.n === 4));
  assert.equal((await w.h.db.prepare('SELECT COUNT(*) AS n FROM bread_topics').first('n')), 0, 'a bad row stores nothing');
  const up1 = await w.admin('POST', `bread/programs/${id}/topics`, { topics: [topic(1), topic(2)] });
  assert.deepEqual([up1.body.uploaded, up1.body.missing, up1.body.ready], [2, [3], false]);
  assert.equal((await w.admin('POST', `bread/programs/${id}/activate`, { mode: 'after' })).status, 400, 'not ready');
  const up2 = await w.admin('POST', `bread/programs/${id}/topics`, { topics: [topic(3), topic(2, { title: 'عنوان اتصلح' })] });
  assert.equal(up2.body.ready, true);
  const a = await w.admin('POST', `bread/programs/${id}/activate`, { mode: 'after' });
  const today = cairoDay();
  assert.deepEqual([a.body.program.state, a.body.program.startsOn, a.body.program.endsOn], ['live', today, dayAdd(today, 2)]);
  const revs = (await w.h.db.prepare("SELECT key, live, body FROM published_revisions WHERE kind = 'bread' ORDER BY key").all()).results;
  assert.deepEqual(revs.map(r => r.key), [id + '/1', id + '/2', id + '/3', 'index']);
  assert.ok(revs.every(r => r.live === 1));
  assert.equal(JSON.parse(revs[1].body).title, 'عنوان اتصلح');
  assert.deepEqual(JSON.parse(revs[3].body).programs.map(p => p.id), [id]);
  const job = await w.h.db.prepare("SELECT mode, files, state FROM publish_jobs WHERE id = (SELECT publish_id FROM published_revisions WHERE key = 'index' AND live = 1)").first();
  assert.deepEqual({ ...job }, { mode: 'bread', files: 4, state: 'live' });
  assert.equal(revisionPath('bread', id + '/2'), 'daily-bread/data/' + id + '/2.json');
  assert.ok(w.sent.some(j => j.type === 'publish.mirror'), 'the mirror is asked at once');
  assert.equal((await w.admin('POST', `bread/programs/${id}/topics`, { topics: [topic(1)] })).status, 400, 'a published program never changes');
  // a bread publish is not a site publish: restore stays off, the history does not list it
  const rv = await w.admin('GET', 'publish/revisions');
  assert.equal(rv.body.jobs.length, 0);
  assert.equal(rv.body.live, null);
  const list = await w.admin('GET', 'bread/programs');
  assert.equal(list.body.current, id);
  assert.equal(list.body.programs[0].uploaded, 3);
  // W4 «المواضيع»: the days' titles and references, no texts
  const tl = await w.admin('GET', `bread/programs/${id}/topics`);
  assert.deepEqual(tl.body.topics.map(t => t.n), [1, 2, 3]);
  assert.ok(tl.body.topics.every(t => t.title && t.verseRef && t.readingRef && typeof t.asked === 'boolean' && !('meditation' in t)));
  // W4: who uploaded and who activated (the admin shows «رفعه <name>»)
  assert.ok(list.body.programs[0].createdBy && list.body.programs[0].createdBy === list.body.programs[0].activatedBy);
});

test('the mirror commits the bread files under daily-bread/data/ (one commit, «daily bread»)', async () => {
  const w = await world({ env: { GITHUB_TOKEN: 'tok', GITHUB_REPO: 'o/r', GITHUB_BRANCH: 'main', ENVIRONMENT: 'staging' } });
  const p = await w.program(2);
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/branches/main')) return Response.json({ commit: { sha: 'parent', commit: { tree: { sha: 'base' } } } });
    if (url.endsWith('/git/trees')) return Response.json({ sha: 'tree2' });
    if (url.endsWith('/git/commits')) return Response.json({ sha: 'commit2' });
    return Response.json({ ref: 'x' });
  };
  const r = await mirrorPending(w.env, { fetchImpl });
  assert.equal(r.committed, true, JSON.stringify(r));
  const tree = calls.find(c => c.url.endsWith('/git/trees')).body.tree.map(e => e.path).sort();
  assert.deepEqual(tree, ['daily-bread/data/' + p.id + '/1.json', 'daily-bread/data/' + p.id + '/2.json', 'daily-bread/data/index.json']);
  assert.match(calls.find(c => c.url.endsWith('/git/commits')).body.message, /daily bread/);
  assert.equal(await w.h.db.prepare("SELECT COUNT(*) AS n FROM published_revisions WHERE kind = 'bread' AND mirrored_at IS NULL").first('n'), 0);
});

test('activate after / replace now / stop: one live a day, one waiting, the waiting one moves after a replacement', async () => {
  const w = await world();
  const today = cairoDay();
  const first = await w.program(5, { name: 'الأول' });
  const second = await w.program(4, { name: 'التاني' });
  assert.deepEqual([second.state, second.startsOn], ['next', dayAdd(today, 5)]);
  // only one waits
  const c = await w.admin('POST', 'bread/programs', { name: 'التالت', days: 2 });
  await w.admin('POST', `bread/programs/${c.body.program.id}/topics`, { topics: [topic(1), topic(2)] });
  const after = await w.admin('POST', `bread/programs/${c.body.program.id}/activate`, { mode: 'after' });
  assert.equal(after.status, 409);
  // replace now: needs the confirmation, then the first stops (last day = yesterday) and the waiting one moves
  const noConfirm = await w.admin('POST', `bread/programs/${c.body.program.id}/activate`, { mode: 'now' });
  assert.equal(noConfirm.body.needsConfirm, true);
  const now = await w.admin('POST', `bread/programs/${c.body.program.id}/activate`, { mode: 'now', confirm: true });
  assert.deepEqual([now.body.program.state, now.body.program.startsOn], ['live', today]);
  const rows = Object.fromEntries((await w.h.db.prepare('SELECT id, status, starts_on, ends_on FROM bread_programs').all()).results.map(r => [r.id, r]));
  assert.deepEqual([rows[first.id].status, rows[first.id].ends_on], ['stopped', dayAdd(today, -1)]);
  assert.deepEqual([rows[second.id].starts_on, rows[second.id].ends_on], [dayAdd(today, 2), dayAdd(today, 5)]);
  const index = JSON.parse(await w.h.db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = 'index' AND live = 1").first('body'));
  assert.deepEqual(index.programs.map(p => p.id), [c.body.program.id, second.id]);
  // stop the waiting one: it never starts; stop the live one: nothing is live, the index is empty
  assert.equal((await w.admin('POST', `bread/programs/${second.id}/stop`, {})).body.needsConfirm, true);
  assert.equal((await w.admin('POST', `bread/programs/${second.id}/stop`, { confirm: true })).body.program.state, 'stopped');
  assert.equal((await w.admin('POST', `bread/programs/${c.body.program.id}/stop`, { confirm: true })).status, 200);
  const empty = JSON.parse(await w.h.db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = 'index' AND live = 1").first('body'));
  assert.deepEqual(empty.programs, []);
  const acts = (await w.h.db.prepare("SELECT action FROM activity WHERE entity_type = 'bread' ORDER BY at").all()).results.map(r => r.action);
  assert.ok(acts.includes('bread.activate') && acts.includes('bread.stop') && acts.includes('bread.create'));
  // a draft can be deleted, a published one cannot
  const d = await w.admin('POST', 'bread/programs', { name: 'مسودة', days: 2 });
  assert.equal((await w.admin('POST', `bread/programs/${d.body.program.id}/delete`, {})).status, 200);
  assert.equal((await w.admin('POST', `bread/programs/${first.id}/delete`, {})).status, 400);
});

test('permissions: bread.reflections is the Primary Admin\'s by default; reading reflections writes an activity row; switches are primary', async () => {
  const w = await world({ env: { ENVIRONMENT: 'production' } });
  const p = await w.program(2);
  assert.equal((await w.adminA('GET', 'bread/programs')).status, 200, 'bread.content: any admin while PERMS_ENFORCE = 0');
  assert.equal((await w.adminA('GET', `bread/reflections?program=${p.id}`)).status, 403, 'not the reflections');
  const r = await w.admin('GET', `bread/reflections?program=${p.id}`);
  assert.equal(r.status, 200);
  assert.equal(await w.h.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'bread.reflections.view'").first('n'), 1);
  assert.equal((await w.adminA('POST', 'bread/settings', { module: true })).status, 403, 'the module switch is the Primary Admin\'s');
  const s = await w.admin('POST', 'bread/settings', { module: true, defaultTime: '07:30', maxSlots: 2 });
  assert.deepEqual([s.body.settings.module, s.body.settings.defaultTime, s.body.settings.maxSlots, s.body.settings.push], [true, '07:30', 2, false]);
  assert.equal((await w.admin('POST', 'bread/settings', { maxSlots: 5 })).status, 400);
  await w.h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'PERMS_ENFORCE'").run();
  assert.equal((await w.adminA('GET', 'bread/stats')).status, 403, 'enforced: no grant, no stats');
  await w.h.db.prepare("INSERT INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, 'bread.stats', 'all', 't', 0)").bind(A).run();
  assert.equal((await w.adminA('GET', 'bread/stats')).status, 200);
});

// ---------- the member ----------

test('public: off → disabled; today for a seed, the files, open/«قريت» counted once a device a day', async () => {
  const w = await world();
  const p = await w.program(5);
  assert.equal((await w.pub('/v1/bread/today', { seed: 'dev-000001' })).body.code, 'disabled');
  assert.equal((await w.pub('/v1/bread/file/index')).body.code, 'disabled');
  await w.setting('BREAD_MODULE', '1');
  const t = await w.pub('/v1/bread/today', { seed: 'dev-000001' });
  assert.equal(t.body.state, 'live');
  assert.equal(t.body.n, orderFor('dev-000001', p.id, 5)[0] + 1);
  assert.equal(t.body.topic.n, t.body.n);
  assert.equal((await w.pub('/v1/bread/today', { seed: 'bad' })).status, 400);
  const f = await w.pub(`/v1/bread/file/${p.id}/${t.body.n}`);
  assert.equal(f.status, 200);
  assert.equal(f.body.title, 'موضوع رقم ' + t.body.n);
  const etag = f.headers.get('etag');
  const again = await w.h.call(`/v1/bread/file/${p.id}/${t.body.n}`, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
  assert.equal((await w.pub('/v1/bread/file/index')).body.programs[0].id, p.id);
  assert.equal((await w.pub(`/v1/bread/file/${p.id}/99`)).status, 404);
  for (const [seed, kind, counted] of [['dev-000001', 'open', true], ['dev-000001', 'open', false], ['dev-000002', 'open', true], ['dev-000001', 'read', true], ['dev-000001', 'read', false]]) {
    assert.equal((await w.pub('/v1/bread/open', { seed, kind })).body.counted, counted, seed + ' ' + kind);
  }
  const daily = await w.h.db.prepare('SELECT opens, reads FROM bread_daily WHERE program_id = ?').bind(p.id).first();
  assert.deepEqual({ ...daily }, { opens: 2, reads: 1 });
  const hashes = (await w.h.db.prepare('SELECT device_hash FROM bread_opens').all()).results.map(r => r.device_hash);
  assert.ok(hashes.every(h => !h.includes('dev-')), 'never the device id itself');
  const stats = await w.admin('GET', 'bread/stats');
  assert.deepEqual([stats.body.totals.opens, stats.body.totals.reads], [2, 1]);
  // W4: today's Cairo day for the «النهارده» numbers; no slots yet → no «أكتر ميعاد»
  assert.deepEqual([stats.body.today, stats.body.topMinute], [cairoDay(), null]);
  await w.h.db.prepare("INSERT INTO bread_slots (device_id, minute, seed, created_ms) VALUES ('d1', 480, 's', 1), ('d2', 480, 's', 1), ('d3', 1275, 's', 1)").run();
  assert.equal((await w.admin('GET', 'bread/stats')).body.topMinute, 480);
});

test('nothing live: empty, or waiting with the next program\'s date', async () => {
  const w = await world();
  await w.setting('BREAD_MODULE', '1');
  assert.equal((await w.pub('/v1/bread/today', { seed: 'dev-000003' })).body.state, 'empty');
  const p = await w.program(3);
  await w.h.db.prepare('UPDATE bread_programs SET starts_on = ?, ends_on = ? WHERE id = ?').bind(dayAdd(cairoDay(), 2), dayAdd(cairoDay(), 4), p.id).run();
  const t = await w.pub('/v1/bread/today', { seed: 'dev-000003' });
  assert.deepEqual([t.body.state, t.body.next.startsOn], ['waiting', dayAdd(cairoDay(), 2)]);
});

test('slots: a subscribed device only, up to bread_max_slots, [] turns them off', async () => {
  const w = await world();
  await w.setting('BREAD_MODULE', '1');
  const token = 'tok_bread_1_'.padEnd(150, 'x');
  assert.equal((await w.pub('/v1/bread/slots', { token, seed: 'dev-000004', times: ['08:00'] })).body.reason, 'no_device');
  const id = await pushHash(token);
  await w.h.db.prepare("INSERT INTO push_devices (id, token, audience, topics, created_ms, last_ms) VALUES (?, ?, 'public', '[]', 1, 1)").bind(id, token).run();
  const r = await w.pub('/v1/bread/slots', { token, seed: 'dev-000004', times: ['21:15', '08:00', '08:00'] });
  assert.deepEqual([r.body.times, r.body.max, r.body.defaultTime], [['08:00', '21:15'], 3, '08:00']);
  assert.equal((await w.pub('/v1/bread/slots', { token, seed: 'dev-000004', times: ['1', '2', '3', '4'] })).status, 400);
  assert.equal((await w.pub('/v1/bread/slots', { token, seed: 'dev-000004', times: ['25:00'] })).status, 400);
  assert.deepEqual((await w.pub('/v1/bread/slots', { token })).body.times, ['08:00', '21:15'], 'read back');
  assert.deepEqual((await w.pub('/v1/bread/slots', { token, times: [] })).body.times, []);
  assert.equal(await w.h.db.prepare('SELECT COUNT(*) AS n FROM bread_slots').first('n'), 0);
});

test('an account keeps the device seed it first came with; another device later gets the same order', async () => {
  const w = await world();
  await w.setting('BREAD_MODULE', '1');
  const p = await w.program(7);
  const m = await member(w);
  const first = await w.pub('/v1/bread/me', { seed: 'phone-seed-1' }, m.token);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual([first.body.seed, first.body.look, first.body.state], ['phone-seed-1', 'night', 'eligible']);
  const laptop = await w.pub('/v1/bread/today', { seed: 'laptop-seed-2' }, m.token);
  assert.equal(laptop.body.seed, 'phone-seed-1');
  assert.equal(laptop.body.n, orderFor('phone-seed-1', p.id, 7)[0] + 1);
  assert.equal((await w.pub('/v1/bread/me', { seed: 'phone-seed-1' })).body.code, 'session', 'me needs the account');
  // the look lives in the account prefs (W1 decision)
  const pr = await w.h.call('/v1/account/prefs', { method: 'POST', body: { prefs: { bread_look: 'dawn' } }, headers: { authorization: 'Bearer ' + m.token } });
  assert.equal(pr.body.bread_look, 'dawn');
  assert.equal((await w.pub('/v1/bread/me', { seed: 'x-seed-3' }, m.token)).body.look, 'dawn');
  assert.equal((await w.h.call('/v1/account/prefs', { method: 'POST', body: { prefs: { bread_look: 'blue' } }, headers: { authorization: 'Bearer ' + m.token } })).status, 400);
});

test('reflections: one a day for today\'s topic, edit/delete within 20 minutes on the server, locked after', async () => {
  const w = await world();
  await w.setting('BREAD_MODULE', '1');
  const p = await w.program(5);
  const m = await member(w);
  const guest = await member(w, { birthDate: '1980-01-01' });
  assert.equal((await w.pub('/v1/bread/reflection', { seed: 'dev-r00001', text: 'تأمل' })).body.code, 'session');
  const r = await w.pub('/v1/bread/reflection', { seed: 'dev-r00001', text: '  ربنا يباركك  ' }, m.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.reflection.text, 'ربنا يباركك');
  assert.equal(r.body.reflection.n, orderFor('dev-r00001', p.id, 5)[0] + 1);
  assert.equal(r.body.reflection.editable, true);
  const dup = await w.pub('/v1/bread/reflection', { seed: 'dev-r00001', text: 'تاني' }, m.token);
  assert.equal(dup.status, 409);
  assert.equal((await w.pub('/v1/bread/reflection', { seed: 'dev-r00001', text: 'x'.repeat(1001) }, m.token)).status, 400);
  const g = await w.pub('/v1/bread/reflection', { seed: 'dev-r00002', text: 'من ضيف' }, guest.token);
  assert.equal(g.status, 200);
  assert.equal(await w.h.db.prepare('SELECT state FROM bread_reflections WHERE id = ?').bind(g.body.reflection.id).first('state'), 'guest');
  const e = await w.pub('/v1/bread/reflection/edit', { id: r.body.reflection.id, text: 'اتعدل' }, m.token);
  assert.equal(e.body.reflection.text, 'اتعدل');
  assert.equal((await w.pub('/v1/bread/reflection/edit', { id: r.body.reflection.id, text: 'مش بتاعي' }, guest.token)).status, 404, 'only one\'s own');
  // simulated time: 21 minutes later
  await w.h.db.prepare('UPDATE bread_reflections SET created_ms = created_ms - ? WHERE id = ?').bind(EDIT_MS + 60000, r.body.reflection.id).run();
  const locked = await w.pub('/v1/bread/reflection/edit', { id: r.body.reflection.id, text: 'متأخر' }, m.token);
  assert.deepEqual([locked.status, locked.body.code], [409, 'locked']);
  assert.equal((await w.pub('/v1/bread/reflection/delete', { id: r.body.reflection.id }, m.token)).body.code, 'locked');
  // inside the window: delete, then a new one is allowed (the counter follows)
  assert.equal((await w.pub('/v1/bread/reflection/delete', { id: g.body.reflection.id }, guest.token)).status, 200);
  assert.equal((await w.pub('/v1/bread/me', { seed: 'dev-r00002' }, guest.token)).body.reflection, null);
  assert.equal((await w.pub('/v1/bread/reflection', { seed: 'dev-r00002', text: 'من جديد' }, guest.token)).status, 200);
  assert.equal(await w.h.db.prepare('SELECT reflections FROM bread_daily WHERE program_id = ?').bind(p.id).first('reflections'), 2);
  const list = await w.admin('GET', `bread/reflections?program=${p.id}`);
  assert.deepEqual(list.body.reflections.map(x => x.text).sort(), ['اتعدل', 'من جديد'].sort());
  assert.ok(list.body.reflections.every(x => x.title.startsWith('موضوع رقم')));
  // W4 «بسؤال»: whether the day had a question
  assert.ok(list.body.reflections.every(x => typeof x.asked === 'boolean'));
});

// ---------- breadTick + the consumer ----------

const pem = async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  return '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----\n';
};

test('breadTick: off unless BREAD_MODULE, BREAD_PUSH and PUSH_SENDER; then each device its own topic, once a minute; «قريت» skips', async () => {
  const ACCOUNT = JSON.stringify({ project_id: 'athanasios-test', client_email: 'push@athanasios-test.iam.gserviceaccount.com', private_key: await pem() });
  const w = await world({ env: { FCM_SERVICE_ACCOUNT: ACCOUNT } });
  const p = await w.program(7);
  const m = await member(w);
  const devices = [];
  for (let i = 1; i <= 3; i++) {
    const token = ('tok_tick_' + i + '_').padEnd(150, 'x');
    const id = await pushHash(token);
    await w.h.db.prepare("INSERT INTO push_devices (id, token, audience, topics, created_ms, last_ms, account_id) VALUES (?, ?, 'public', '[]', 1, 1, ?)").bind(id, token, i === 3 ? m.id : null).run();
    await w.h.db.prepare('INSERT INTO bread_slots (device_id, minute, seed, created_ms) VALUES (?, 480, ?, 1)').bind(id, 'dev-tick0' + i).run();
    devices.push({ id, token, seed: 'dev-tick0' + i });
  }
  // device 3 belongs to an account that kept another seed in this program
  await w.h.db.prepare('INSERT INTO bread_members (participant_id, program_id, seed, created_ms) VALUES (?, ?, ?, 1)').bind(m.id, p.id, 'acct-seed-9').run();
  const at = wallMs(cairoDay() + 'T08:00');
  assert.equal(await breadTick(w.env, at), null, 'switches off');
  await w.setting('BREAD_MODULE', '1');
  await w.setting('BREAD_PUSH', '1');
  assert.equal(await breadTick(w.env, at), null, 'PUSH_SENDER is not the Worker');
  await w.h.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('PUSH_SENDER', 'worker', 0)").run();
  assert.equal(await breadTick(w.env, at + 60000), null, '08:01: nobody');
  // device 2 pressed «قريت» today
  await w.pub('/v1/bread/open', { seed: 'dev-tick02', kind: 'read' });
  const t = await breadTick(w.env, at);
  assert.equal(t.devices, 3);
  assert.equal((await breadTick(w.env, at)).replay, true, 'the same minute twice: one send');
  const jobs = w.sent.filter(j => j.type === 'push.fanout');
  assert.equal(jobs.length, 1);
  const sends = [];
  const f = async (url, init) => {
    if (url === OAUTH_URL) return Response.json({ access_token: 'at', expires_in: 3600 });
    sends.push(JSON.parse(init.body).message);
    return Response.json({ name: 'x' });
  };
  await runPart(w.env, jobs[0].payload, f);
  const byToken = Object.fromEntries(sends.map(s => [s.token, s.data]));
  assert.equal(sends.length, 2, 'the device that read today gets nothing');
  const want = seed => 'موضوع رقم ' + (orderFor(seed, p.id, 7)[0] + 1);
  assert.equal(byToken[devices[0].token].title, want('dev-tick01'));
  assert.equal(byToken[devices[2].token].title, want('acct-seed-9'), 'the account\'s kept seed, not the device\'s');
  assert.match(byToken[devices[0].token].body, /^«أَنَا هُوَ خُبْزُ الْحَيَاةِ/);
  assert.equal(byToken[devices[0].token].url, '/daily-bread/?from=push');
  assert.equal(await w.h.db.prepare("SELECT status FROM push_sends WHERE ref LIKE 'bread:%'").first('status'), 'sent');
  assert.equal(await w.h.db.prepare('SELECT sent FROM bread_daily WHERE program_id = ?').bind(p.id).first('sent'), 3);
});

test('W6 on by default: a device with the site\'s notifications gets the default time until «فكّرني» is off; seedless → the general text', async () => {
  const ACCOUNT = JSON.stringify({ project_id: 'athanasios-test', client_email: 'push@athanasios-test.iam.gserviceaccount.com', private_key: await pem() });
  const w = await world({ env: { FCM_SERVICE_ACCOUNT: ACCOUNT } });
  await w.program(7);
  await w.setting('BREAD_MODULE', '1');
  await w.setting('BREAD_PUSH', '1');
  await w.h.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('PUSH_SENDER', 'worker', 0)").run();
  const dev = [];
  for (let i = 1; i <= 3; i++) {
    const token = ('tok_auto_' + i + '_').padEnd(150, 'x');
    const id = await pushHash(token);
    await w.h.db.prepare("INSERT INTO push_devices (id, token, audience, topics, created_ms, last_ms) VALUES (?, ?, 'public', '[]', 1, 1)").bind(id, token).run();
    dev.push({ id, token });
  }
  // the read: device 1 is on the default
  const r = await w.pub('/v1/bread/slots', { token: dev[0].token, seed: 'dev-auto01' });
  assert.equal(r.body.auto, true);
  assert.deepEqual(r.body.times, []);
  // device 2 turns it off; device 3 chose 09:00
  assert.equal((await w.pub('/v1/bread/slots', { token: dev[1].token, seed: 'dev-auto02', times: [] })).status, 200);
  assert.equal((await w.pub('/v1/bread/slots', { token: dev[1].token, seed: 'dev-auto02' })).body.auto, false, 'off is remembered');
  assert.equal((await w.pub('/v1/bread/slots', { token: dev[2].token, seed: 'dev-auto03', times: ['09:00'] })).status, 200);
  const at = wallMs(cairoDay() + 'T08:00');
  const t = await breadTick(w.env, at);
  assert.equal(t.devices, 1, 'only the device on the default');
  assert.equal(await breadTick(w.env, at + 60000), null, '08:01: nobody');
  // the default time moved: 08:00 is nobody's now
  await w.setting('bread_default_time', '07:30');
  assert.equal(await breadTick(w.env, wallMs(cairoDay() + 'T08:00') + 120000), null);
  // the consumer: no seed yet → the general text (not skipped)
  const sends = [];
  const f = async (url, init) => {
    if (url === OAUTH_URL) return Response.json({ access_token: 'at', expires_in: 3600 });
    sends.push(JSON.parse(init.body).message);
    return Response.json({ name: 'x' });
  };
  await runPart(w.env, w.sent.filter(j => j.type === 'push.fanout')[0].payload, f);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].token, dev[0].token);
  assert.equal(sends[0].data.title, 'خبزنا اليومي');
  // turning it on again (a time) forgets the "off"
  await w.pub('/v1/bread/slots', { token: dev[1].token, seed: 'dev-auto02', times: ['08:00'] });
  assert.equal(await w.h.db.prepare('SELECT COUNT(*) AS n FROM bread_optout').first('n'), 0);
});

// ---------- alerts + retention ----------

test('alerts: 7/3/1 days left once each, none while a program waits; «content finished» once, muted until the next activation', async () => {
  const w = await world();
  const p = await w.program(10);
  const at = d => wallMs(dayAdd(cairoDay(), d) + 'T04:17');
  const rows = () => w.h.db.prepare("SELECT id, action, summary FROM activity WHERE action LIKE 'bread.%' AND actor = 'system' ORDER BY at, id").all().then(r => r.results);
  assert.deepEqual((await breadDaily(w.env, at(0))).alerts, [], '9 days left');
  assert.deepEqual((await breadDaily(w.env, at(2))).alerts, ['left7']);
  assert.deepEqual((await breadDaily(w.env, at(3))).alerts, [], 'once');
  assert.deepEqual((await breadDaily(w.env, at(7))).alerts, ['left3'], 'a missed day: only the nearest threshold');
  assert.deepEqual((await breadDaily(w.env, at(8))).alerts, ['left1']);
  assert.deepEqual((await breadDaily(w.env, at(9))).alerts, [], 'last day: 1 was sent');
  const r = await rows();
  assert.equal(r.length, 3);
  assert.match(r[0].summary, /فاضل ٧ أيام على نهاية «برنامج تجربة»/);
  // the router's catalog: an important bread.content notification, its text from the row
  const type = typeOf({ action: 'bread.left' });
  assert.deepEqual([type.level, type.perm, type.email], ['important', 'bread.content', false]);
  assert.match(messageOf(type, [{ ...r[0], actor: 'system', action: 'bread.left' }]).body, /فاضل ٧ أيام/);
  // W4: the alert opens the section's programs tab, not the activity entry
  assert.equal(messageOf(type, [{ ...r[0], actor: 'system', action: 'bread.left' }]).url, '/admin/#open/bread');
  // the program ended: «content finished», once; muted → nothing
  assert.deepEqual((await breadDaily(w.env, at(10))).alerts, ['empty']);
  assert.deepEqual((await breadDaily(w.env, at(11))).alerts, []);
  await w.h.db.prepare("DELETE FROM activity WHERE action = 'bread.empty'").run();
  await w.setting('BREAD_EMPTY_MUTED', '1');
  assert.deepEqual((await breadDaily(w.env, at(12))).alerts, [], 'muted');
  // a waiting program: no «days left»
  const w2 = await world();
  await w2.program(5);
  await w2.program(5);
  assert.deepEqual((await alertStmts(w2.h.db, at(2))).alerts, []);
});

test('activation clears the mute; retention: opens after 30 days, the program content at end + 90 (name and numbers stay)', async () => {
  const w = await world();
  await w.setting('BREAD_EMPTY_MUTED', '1');
  await w.setting('BREAD_MODULE', '1');
  const p = await w.program(2);
  assert.equal(await w.h.db.prepare("SELECT value FROM settings WHERE key = 'BREAD_EMPTY_MUTED'").first('value'), '0');
  const m = await member(w);
  await w.pub('/v1/bread/reflection', { seed: 'dev-ret001', text: 'تأمل' }, m.token);
  await w.pub('/v1/bread/open', { seed: 'dev-ret001', kind: 'open' });
  await w.h.db.prepare("INSERT INTO bread_opens (day, device_hash, kind, program_id) VALUES ('2020-01-01', 'old', 'open', ?)").bind(p.id).run();
  const purge = await w.h.db.prepare('SELECT purge_on FROM bread_programs WHERE id = ?').bind(p.id).first('purge_on');
  assert.equal(purge, dayAdd(cairoDay(), 1 + 90));
  await breadDaily(w.env, Date.now());
  assert.equal(await w.h.db.prepare("SELECT COUNT(*) AS n FROM bread_opens WHERE day = '2020-01-01'").first('n'), 0);
  assert.equal(await w.h.db.prepare('SELECT COUNT(*) AS n FROM bread_opens').first('n'), 1);
  const later = wallMs(purge + 'T04:17');
  const r = await breadDaily(w.env, later);
  assert.deepEqual(r.purged, [p.id]);
  for (const t of ['bread_topics', 'bread_reflections', 'bread_members']) assert.equal(await w.h.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first('n'), 0, t);
  const prog = await w.h.db.prepare('SELECT name, purged_ms FROM bread_programs WHERE id = ?').bind(p.id).first();
  assert.ok(prog.name && prog.purged_ms);
  assert.ok(await w.h.db.prepare('SELECT opens FROM bread_daily WHERE program_id = ?').bind(p.id).first('opens'), 'the numbers stay');
  const files = (await w.h.db.prepare("SELECT key, body, live FROM published_revisions WHERE kind = 'bread' AND key LIKE ?").bind(p.id + '/%').all()).results;
  assert.equal(files.length, 2);
  assert.ok(files.every(f => f.live === 1 && JSON.parse(f.body).gone === true), 'the published days became stubs');
  assert.equal((await breadDaily(w.env, later)).purged.length, 0, 'once');
});

test('the Cairo minute of a slot follows DST (summer 08:00 Cairo = 05:00 UTC)', () => {
  assert.equal(cairoText(wallMs('2026-07-01T08:00')).slice(11), '08:00');
  assert.equal(new Date(wallMs('2026-07-01T08:00')).toISOString().slice(11, 16), '05:00');
  assert.equal(new Date(wallMs('2026-12-01T08:00')).toISOString().slice(11, 16), '06:00');
  assert.equal(DAY, 86400000);
});
