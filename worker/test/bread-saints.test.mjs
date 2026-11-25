/*
 * «خبزنا اليومي» P3 — the saints registry in the admin (docs/daily-bread/saints/P3-PLAN.md): the migration and the P2
 * seed, the switch, saving with rev, status/missing computed, the review, the publish (file + snapshot + mirror),
 * a day completed and published reaching the feasts with no code change, the living out of the saints card,
 * one-time occasions, delete / restore / revert, an older publish back. Real SQLite, real migrations.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness, fakeGoogle } from './helpers.mjs';
import { forgetAccessToken } from '../src/push/fcm.js';
import { occasionsOfMonth, feastsOfMonth, checkPerson } from '../src/bread/saints.js';

const KEYS = { PW_PEPPER: 'pepper-test', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp-test', ACCOUNT_PAD_MS: '0' };
const P = 'p@example.com';

async function world({ on = true } = {}) {
  forgetAccessToken();
  const g = await fakeGoogle();
  const h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ...KEYS } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'P', 'primary', 1, 0)`).run();
  const admin = async (method, path, body) => h.call('/v1/admin/' + path, { method, body, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: P, sub: 's-p' })) }, fetch: g.fetch });
  if (on) assert.equal((await admin('POST', 'bread/settings', { saints: true })).status, 200);
  return { h, admin };
}
const item = (w, id) => w.admin('GET', 'bread/saints').then(r => r.body.items.find(i => i.id === id));
async function publish(w) {
  const rv = await w.admin('GET', 'bread/saints/review');
  assert.equal(rv.status, 200, JSON.stringify(rv.body));
  const r = await w.admin('POST', 'bread/saints/publish', { expect: rv.body.expect });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { review: rv.body, publish: r.body };
}

test('migration + seed: the 108 people and the diocese from P2, status computed, BREAD_SAINTS off; the seed is the registry', async () => {
  const { h } = await world({ on: false });
  const n = k => h.db.prepare('SELECT COUNT(*) AS n FROM saints_items WHERE kind = ?').bind(k).first('n');
  assert.equal(await n('person'), 108);
  assert.equal(await n('occasion'), 16, 'the P2 diocese + the 15 of P5 (0037)');
  assert.equal(await h.db.prepare("SELECT value FROM settings WHERE key = 'BREAD_SAINTS'").first('value'), '0');
  const mar = JSON.parse(await h.db.prepare("SELECT data FROM saints_items WHERE kind = 'person' AND id = 'isaacsyrian'").first('data'));
  assert.deepEqual([mar.status, mar.missing], ['incomplete', ['feasts']]);
  // run again (INSERT OR IGNORE): nothing changes, nothing saved is overwritten
  await h.db.prepare("UPDATE saints_items SET data = json_set(data, '$.name', 'X') WHERE id = 'mary'").run();
  const sql = readFileSync(new URL('../migrations/0036_saints_seed.sql', import.meta.url), 'utf8');
  for (const line of sql.split('\n').filter(l => l.startsWith('INSERT'))) await h.db.prepare(line).run();
  assert.equal(await n('person'), 108);
  assert.equal(JSON.parse(await h.db.prepare("SELECT data FROM saints_items WHERE id = 'mary'").first('data')).name, 'X');
});

test('the switch: off → every saints route is `disabled`; the Primary Admin turns it on in the settings', async () => {
  const w = await world({ on: false });
  for (const [m, p] of [['GET', 'bread/saints'], ['GET', 'bread/saints/review'], ['POST', 'bread/saints/item'], ['POST', 'bread/saints/publish']]) {
    const r = await w.admin(m, p, m === 'POST' ? {} : undefined);
    assert.equal(r.body.code, 'disabled', p);
  }
  assert.equal((await w.admin('GET', 'bread/settings')).body.settings.saints, false);
  await w.admin('POST', 'bread/settings', { saints: true });
  assert.equal((await w.admin('GET', 'bread/settings')).body.settings.saints, true);
  const l = await w.admin('GET', 'bread/saints');
  assert.equal(l.status, 200);
  assert.equal(l.body.items.length, 124, '108 people + 16 occasions (P5)');
  assert.equal(l.body.published, null);
  assert.ok(l.body.items.every(i => i.state === 'new'), 'nothing published yet');
});

test('first publish: saints.json without the internal parts, a snapshot, a mirror job; the feasts come from it, never a living father', async () => {
  const w = await world();
  const { review, publish: p } = await publish(w);
  assert.equal(review.first, true);
  assert.deepEqual(review.errors, []);
  assert.equal(p.rev, 1);
  const row = await w.h.db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = 'saints' AND live = 1").first();
  const file = JSON.parse(row.body);
  assert.equal(file.people.length, 108);
  const raw = row.body;
  for (const internal of ['"pending"', '"src"', '"note"', 'picturesRoot', '"sources"']) assert.ok(!raw.includes(internal), internal + ' stays internal');
  assert.equal((await w.h.db.prepare("SELECT COUNT(*) AS n FROM publish_jobs WHERE mode = 'bread'").first('n')), 2, 'saints.json + occasions.json (P5)');
  assert.equal((await w.h.db.prepare('SELECT COUNT(*) AS n FROM saints_snapshots').first('n')), 1);
  assert.ok((await w.admin('GET', 'bread/saints')).body.items.every(i => i.state === 'published'));
  // the «الأعياد» tab: February 2027 has Anba Theophilus's repose (12 Feb); no living father anywhere
  const f = await w.admin('GET', 'bread/saints/feasts?month=2027-02');
  assert.equal(f.body.ready, true);
  assert.ok(f.body.feasts.some(x => x.id === 'theophilus' && x.date === '2027-02-12'));
  for (const m of ['2027-03', '2027-06', '2027-07', '2027-08']) {
    const r = await w.admin('GET', 'bread/saints/feasts?month=' + m);
    assert.ok(!r.body.feasts.some(x => ['angelosmourad', 'philopaterromany', 'ilarion', 'tawadros2', 'isaacnabih', 'ibrahimisravim'].includes(x.id)), m);
  }
  // the living fathers are «مناسبات كنيستنا» only
  assert.ok(occasionsOfMonth(file, '2027-03').some(o => o.person && o.person.id === 'angelosmourad'));
  assert.equal((await w.admin('POST', 'bread/saints/publish', { expect: (await w.admin('GET', 'bread/saints/review')).body.expect })).status, 400, 'nothing new to publish');
});

test('a day completed and published reaches the automatic feasts with no code change; before the publish it does not', async () => {
  const w = await world();
  await publish(w);
  const mar = await item(w, 'isaacsyrian');
  assert.equal(mar.data.status, 'incomplete');
  const day = { kind: 'نياحته', coptic: '4-17', source: 'https://st-takla.org/example.html' };
  const s = await w.admin('POST', 'bread/saints/item', { kind: 'person', rev: mar.rev, item: { ...mar.data, feasts: [day], status: 'incomplete', missing: ['feasts'] } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual([s.body.item.data.status, s.body.item.data.missing, s.body.item.state], ['complete', [], 'changed'], 'status is computed, never typed');
  const month = '2026-12';   // 17 Kiahk 1743 = 26 Dec 2026
  assert.ok(!(await w.admin('GET', 'bread/saints/feasts?month=' + month)).body.feasts.some(x => x.id === 'isaacsyrian'), 'not before the publish');
  const { review } = await publish(w);
  assert.deepEqual(review.joins.map(j => j.id), ['isaacsyrian']);
  assert.deepEqual(review.changes.map(c => [c.id, c.fields.map(f => f.field)]), [['isaacsyrian', ['feasts']]]);
  const f = (await w.admin('GET', 'bread/saints/feasts?month=' + month)).body.feasts;
  const hit = feastsOfMonth(JSON.parse((await w.h.db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = 'saints' AND live = 1").first()).body), month).find(x => x.person.id === 'isaacsyrian');
  assert.ok(hit, 'the shared rules see him in the file');
  assert.ok(f.some(x => x.date === hit.date && (x.id === 'isaacsyrian' || x.others.includes('القديس مار إسحق السرياني'))));
});

test('save: a stale rev is refused; a person without a day is saved and stays out; bad data is refused with its reasons', async () => {
  const w = await world();
  const mary = await item(w, 'mary');
  const ok = await w.admin('POST', 'bread/saints/item', { kind: 'person', rev: mary.rev, item: { ...mary.data, word: 'كلمة.' } });
  assert.equal(ok.status, 200);
  const old = await w.admin('POST', 'bread/saints/item', { kind: 'person', rev: mary.rev, item: { ...mary.data, word: 'تانية.' } });
  assert.equal(old.status, 409, 'someone saved in between');
  const fresh = { id: 'newfather', name: 'أبونا الجديد', cat: 'fathers', class: 'reposed', feasts: [], album: [] };
  const n = await w.admin('POST', 'bread/saints/item', { kind: 'person', rev: 0, item: fresh });
  assert.equal(n.status, 200, JSON.stringify(n.body));
  assert.deepEqual([n.body.item.data.status, n.body.item.data.missing, n.body.item.state], ['incomplete', ['feasts', 'album'], 'new']);
  assert.equal((await w.admin('POST', 'bread/saints/item', { kind: 'person', rev: 0, item: fresh })).status, 400, 'the id is taken');
  await publish(w);
  for (const m of ['2026-12', '2027-01', '2027-06']) assert.ok(!(await w.admin('GET', 'bread/saints/feasts?month=' + m)).body.feasts.some(x => x.id === 'newfather'));
  const bad = async (patch, why) => {
    const cur = await item(w, 'mary');
    const r = await w.admin('POST', 'bread/saints/item', { kind: 'person', rev: cur.rev, item: { ...cur.data, ...patch } });
    assert.equal(r.status, 400, why);
    return r.body;
  };
  await bad({ feasts: [{ kind: 'x', coptic: '4-17', source: 'http://not-https.example' }] }, 'a day needs an https source');
  await bad({ feasts: [{ kind: 'x', coptic: '13-7', source: 'https://a.example' }] }, 'no 7 النسيء');
  await bad({ class: 'saint' }, 'class');
  await bad({ cat: 'nope' }, 'category');
  await bad({ album: [{ src: 'a.png', type: 'ai', crop: { x: 50, y: 10, z: 5 } }] }, 'zoom 1–3');
  await bad({ album: [{ media: 'https://evil.example/a.webp', type: 'photo' }] }, 'the media library only');
  const crop = await item(w, 'mary');
  const c = await w.admin('POST', 'bread/saints/item', { kind: 'person', rev: crop.rev, item: { ...crop.data, album: [{ ...crop.data.album[0], crop: { x: 48.5, y: 7, z: 1.6 }, main: true }] } });
  assert.equal(c.status, 200, 'a crop is kept with its picture');
  assert.deepEqual(c.body.item.data.album[0].crop, { x: 48.5, y: 7, z: 1.6 });
});

test('occasions: yearly (Coptic or Gregorian) or one time, shown in its own year only', async () => {
  const w = await world();
  const once = { id: 'visit2027', name: 'زيارة', kind: 'زيارة الأسقف للكنيسة', repeat: 'once', date: '2027-03-05', source: 'https://example.org/news' };
  assert.equal((await w.admin('POST', 'bread/saints/item', { kind: 'occasion', rev: 0, item: once })).status, 200);
  assert.equal((await w.admin('POST', 'bread/saints/item', { kind: 'occasion', rev: 0, item: { ...once, id: 'bad1', date: '2027-02-30' } })).status, 400);
  assert.equal((await w.admin('POST', 'bread/saints/item', { kind: 'occasion', rev: 0, item: { id: 'yearly1', name: 'عيد', coptic: '3-8', source: 'https://example.org/x' } })).status, 200);
  await publish(w);
  const file = JSON.parse((await w.h.db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = 'saints' AND live = 1").first()).body);
  assert.ok(occasionsOfMonth(file, '2027-03').some(o => o.occasion.id === 'visit2027'));
  assert.ok(!occasionsOfMonth(file, '2028-03').some(o => o.occasion.id === 'visit2027'), 'one time: its own year only');
  assert.ok(occasionsOfMonth(file, '2026-11').some(o => o.occasion.id === 'yearly1') && occasionsOfMonth(file, '2027-11').some(o => o.occasion.id === 'yearly1'));
});

test('delete / restore / revert; a removed person leaves the site at the publish; an older publish comes back as a new one', async () => {
  const w = await world();
  await publish(w);
  const ver = await item(w, 'verena');
  assert.equal((await w.admin('POST', 'bread/saints/item/delete', { kind: 'person', id: 'verena', rev: ver.rev })).status, 200);
  assert.equal((await item(w, 'verena')).state, 'deleted');
  assert.equal((await w.admin('POST', 'bread/saints/item/restore', { kind: 'person', id: 'verena' })).status, 200);
  assert.equal((await item(w, 'verena')).state, 'changed');
  assert.equal((await w.admin('POST', 'bread/saints/item/revert', { kind: 'person', id: 'verena' })).status, 200);
  assert.equal((await item(w, 'verena')).state, 'published', '«رجّع»: the same as the site');
  const again = await item(w, 'verena');
  await w.admin('POST', 'bread/saints/item/delete', { kind: 'person', id: 'verena', rev: again.rev });
  const { review } = await publish(w);
  assert.deepEqual(review.leaves.map(l => l.id), ['verena']);
  assert.equal(await item(w, 'verena'), undefined, 'gone after the publish');
  const h = await w.admin('GET', 'bread/saints/history');
  assert.deepEqual(h.body.publishes.map(p => p.rev), [2, 1]);
  const back = await w.admin('POST', 'bread/saints/restore', { rev: 1, confirm: true });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(back.body.rev, 3);
  assert.ok(await item(w, 'verena'), 'back in the draft');
  assert.ok((await w.admin('GET', 'bread/saints')).body.items.every(i => i.state === 'published'));
  const file = JSON.parse((await w.h.db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = 'saints' AND live = 1").first()).body);
  assert.ok(file.people.some(p => p.id === 'verena'));
  assert.equal((await w.admin('POST', 'bread/saints/restore', { rev: 1 })).status, 400, 'a typed confirmation');
});

test('the shared rules: the P2 registry passes as is (statusTyped), and status is not trusted from the browser', () => {
  const reg = JSON.parse(readFileSync(new URL('../../daily-bread/saints/registry.json', import.meta.url), 'utf8'));
  for (const p of reg.people) assert.deepEqual(checkPerson(p, { cats: reg.categories }), [], p.id);
  assert.ok(checkPerson({ ...reg.people[0], status: 'incomplete' }, { cats: reg.categories }).length > 0);
});
