/*
 * «خبزنا اليومي» P5 — «مناسبات كنيستنا» (docs/daily-bread/saints/P5-PLAN.md): the seed (0037), the checks for the new
 * fields, the day rules (one card a day, «من يوم شخص», «بتغطّي», the living fathers' plain cards), the published
 * occasions.json beside saints.json, Abu Sefein's full praise, the switch BREAD_OCCASIONS and its public file.
 * Real SQLite, real migrations, the real Worker routes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness, fakeGoogle } from './helpers.mjs';
import { forgetAccessToken } from '../src/push/fcm.js';
import { occasionsOn, occasionsFile, checkOccasion, hidesOf, dayOfOccasion } from '../src/bread/saints.js';

const KEYS = { PW_PEPPER: 'pepper-test', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp-test', ACCOUNT_PAD_MS: '0' };
const P = 'p@example.com';
const REG = JSON.parse(readFileSync(new URL('../../daily-bread/data/saints.json', import.meta.url), 'utf8'));
const SEED = JSON.parse(readFileSync(new URL('../../daily-bread/saints/occasions-seed.json', import.meta.url), 'utf8'));
const withSeed = () => ({ ...REG, occasions: SEED.occasions });

async function world({ module = true, occasions = false } = {}) {
  forgetAccessToken();
  const g = await fakeGoogle();
  const h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ...KEYS } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'P', 'primary', 1, 0)`).run();
  const admin = async (method, path, body) => h.call('/v1/admin/' + path, { method, body, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: P, sub: 's-p' })) }, fetch: g.fetch });
  assert.equal((await admin('POST', 'bread/settings', { saints: true, module, occasions })).status, 200);
  return { h, admin };
}
async function publish(w) {
  const rv = await w.admin('GET', 'bread/saints/review');
  const r = await w.admin('POST', 'bread/saints/publish', { expect: rv.body.expect });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { review: rv.body, publish: r.body };
}
const ids = (reg, d) => occasionsOn(reg, d).map(o => o.id);

test('the seed (0037): 15 new occasions + the diocese in its P5 form, BREAD_OCCASIONS off, Abu Sefein\'s tamgeed; a second run changes nothing', async () => {
  const { h } = await world();
  const rows = (await h.db.prepare("SELECT id, data, rev FROM saints_items WHERE kind = 'occasion' ORDER BY ord").all()).results;
  assert.equal(rows.length, 16);
  assert.equal(rows[0].id, 'redseadiocese');
  const red = JSON.parse(rows[0].data);
  assert.deepEqual([red.type, red.look, red.covers], ['diocese', 'memorial', [{ person: 'theophilus', feast: 'تذكار رسامته' }]]);
  assert.equal(rows[0].rev, 2, 'changed since P2: the review shows it');
  assert.equal(await h.db.prepare("SELECT value FROM settings WHERE key = 'BREAD_OCCASIONS'").first('value'), '0', 'migration default');
  const merc = JSON.parse(await h.db.prepare("SELECT data FROM saints_items WHERE kind = 'person' AND id = 'mercurius'").first('data'));
  assert.equal(merc.praise.verses.length, 35);
  assert.equal(merc.praise.refrain, 'فيلوباتير مرقوريوس');
  assert.match(merc.praise.source, /avarewase\.org/);
  assert.match(merc.praise.verses[0][0], /تعالوا نتهلل بالألحان/);
  // again: INSERT OR IGNORE, and the UPDATEs only touch what nobody edited
  await h.db.prepare("UPDATE saints_items SET data = json_set(data, '$.lead', 'X') WHERE id = 'ibrahimpriest'").run();
  const sql = readFileSync(new URL('../migrations/0037_occasions.sql', import.meta.url), 'utf8');
  for (const line of sql.split('\n').filter(l => /^(INSERT|UPDATE)/.test(l))) await h.db.prepare(line).run();
  assert.equal(JSON.parse(await h.db.prepare("SELECT data FROM saints_items WHERE id = 'ibrahimpriest'").first('data')).lead, 'X');
  assert.equal(await h.db.prepare("SELECT rev FROM saints_items WHERE id = 'redseadiocese'").first('rev'), 2);
});

test('the checks: «من يوم شخص» must point at a real day and carry no date of its own; types, looks, pictures, covers', () => {
  const people = REG.people;
  const ok = { id: 'x', name: 'x', type: 'fathers', from: { person: 'ibrahimisravim', feast: 'عيد رسامته قس' }, headline: 'النهارده', lead: 'كل سنة وأبونا طيب.' };
  assert.deepEqual(checkOccasion(ok, { people }), []);
  assert.equal(checkOccasion({ ...ok, from: { person: 'ibrahimisravim', feast: 'مش موجود' } }, { people }).length, 1);
  assert.equal(checkOccasion({ ...ok, gregorian: '02-21' }, { people }).length, 1, 'no second date');
  assert.equal(checkOccasion({ ...ok, type: 'party' }, { people }).length, 1);
  assert.equal(checkOccasion({ ...ok, look: 'neon' }, { people }).length, 1);
  assert.equal(checkOccasion({ ...ok, pictures: [{ media: 'https://example.com/a.jpg' }] }, { people }).length, 1, 'the media library only');
  assert.equal(checkOccasion({ ...ok, covers: [{ person: 'nobody', feast: 'x' }] }, { people }).length, 1);
  assert.equal(checkOccasion({ ...ok, lead: 'x'.repeat(701) }, { people }).length, 1);
  // an own day still needs its source (P3's rule)
  assert.equal(checkOccasion({ id: 'y', name: 'y', gregorian: '01-01' }).length, 1);
  assert.deepEqual(SEED.occasions.flatMap(o => checkOccasion(o, { people })), [], 'the approved list is clean');
});

test('one card a day; «من يوم شخص» and «بتغطّي» hide those saints\' days; the living fathers keep a card', () => {
  const reg = withSeed();
  assert.deepEqual(ids(reg, '2026-12-04'), ['abusefeinmartyrdom'], '25 Hatour');
  assert.deepEqual(ids(reg, '2027-06-16'), ['abusefeinrelics'], '9 Paona');
  assert.deepEqual(ids(reg, '2027-08-01'), ['abusefeinconsecration'], '25 Abib');
  assert.deepEqual(ids(reg, '2027-05-15'), ['athanasiusrepose'], '7 Pashons');
  assert.deepEqual(ids(reg, '2026-10-10'), ['athanasiusmiracle'], '30 Thout');
  assert.deepEqual(ids(reg, '2027-06-14'), ['redseadiocese'], '14 June: the diocese stands for Anba Theophilus\'s ordination, ONE card');
  assert.deepEqual(hidesOf(occasionsOn(reg, '2027-06-14')[0]), [['theophilus', 'تذكار رسامته']]);
  assert.deepEqual(ids(reg, '2027-03-20'), ['ordination2021'], 'two fathers, one card');
  assert.deepEqual(ids(reg, '2027-11-24'), [], 'an ordinary day');
  // a living father's day with no occasion linked: a plain card (nobody's day is lost)
  const bare = { ...reg, occasions: reg.occasions.filter(o => o.id !== 'isaacpriest') };
  const auto = occasionsOn(bare, '2027-08-31');
  assert.equal(auto.length, 1);
  assert.equal(auto[0].auto, true);
  assert.deepEqual(auto[0].from, { person: 'isaacnabih', feast: 'عيد رسامته' });
  // the day follows the person: change Fr Ibrahim's day in the registry, the occasion moves with it
  const moved = structuredClone(reg);
  moved.people.find(p => p.id === 'ibrahimisravim').feasts[0].gregorian = '02-22';
  assert.deepEqual(ids(moved, '2027-02-22'), ['ibrahimpriest']);
  assert.equal(dayOfOccasion(moved, moved.occasions.find(o => o.id === 'ibrahimpriest')).source, reg.people.find(p => p.id === 'ibrahimisravim').feasts[0].source);
});

test('occasions.json: resolved days, names, pictures from the albums, what each hides, the two patrons with Abu Sefein\'s full praise', () => {
  const reg = withSeed();
  reg.people = reg.people.map(p => (p.id === 'mercurius' ? { ...p, praise: SEED.praises.mercurius } : p));
  const f = occasionsFile(reg);
  assert.equal(f.schema, 1);
  // the seed's 16, plus any automatic one the live registry has since (a newly published person)
  assert.equal(f.occasions.filter(o => SEED.occasions.some(x => x.id === o.id)).length, 16);
  const red = f.occasions.find(o => o.id === 'redseadiocese');
  assert.deepEqual([red.gregorian, red.year, red.who], ['06-14', 1992, 'مثلث الرحمات الأنبا ثاؤفيلس أول أسقف للبحر الأحمر']);
  assert.deepEqual(red.hides, [['theophilus', 'تذكار رسامته', 'الأنبا ثاؤفيلس أول أسقف للبحر الأحمر']]);
  assert.ok(red.pictures.every(p => /^\/media\/\d{4}\//.test(p.img)));
  const two = f.occasions.find(o => o.id === 'ordination2021');
  assert.deepEqual(two.names, ['أبونا أنجيلوس مراد', 'أبونا فيلوباتير روماني']);
  const ab = f.occasions.find(o => o.id === 'abusefeinmartyrdom');
  assert.deepEqual([ab.coptic, ab.type, ab.from], ['3-25', 'patron', ['mercurius', 'استشهاده']]);
  assert.equal(ab.pictures[0].ai, true, 'AI picture: «صورة تعبيرية»');
  assert.deepEqual(Object.keys(f.patrons).sort(), ['family', 'patron']);
  assert.equal(f.patrons.patron.praise.verses.length, 35);
  assert.equal(f.patrons.family.id, 'athanasius');
  assert.deepEqual(f.patrons.family.days.map(d => d.coptic), ['1-30', '9-7']);
  const raw = JSON.stringify(f);
  for (const internal of ['"src"', '"credit"', '"pending"', '"note"']) assert.ok(!raw.includes(internal), internal + ' stays internal');
  assert.ok(raw.length < 30000, 'small: ' + raw.length);
});

test('the publish writes occasions.json beside saints.json; its public file is `disabled` until BREAD_OCCASIONS = 1', async () => {
  const w = await world();
  await publish(w);
  const body = await w.h.db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = 'occasions' AND live = 1").first('body');
  const file = JSON.parse(body);
  assert.equal(file.occasions.length, 16);
  assert.equal(file.patrons.patron.praise.verses.length, 35, 'Abu Sefein\'s tamgeed, in full');
  const off = await w.h.call('/v1/bread/file/occasions');
  assert.equal(off.body.code, 'disabled');
  assert.equal((await w.admin('GET', 'bread/settings')).body.settings.occasions, false);
  await w.admin('POST', 'bread/settings', { occasions: true });
  const on = await w.h.call('/v1/bread/file/occasions');
  assert.equal(on.status, 200);
  // the section itself off → off too
  await w.admin('POST', 'bread/settings', { module: false });
  assert.equal((await w.h.call('/v1/bread/file/occasions')).body.code, 'disabled');
});

test('the admin saves the new fields; a link to a missing day is refused; «رجّع النسخة دي» publishes occasions.json again', async () => {
  const w = await world();
  await publish(w);
  const list = (await w.admin('GET', 'bread/saints')).body.items;
  const it = list.find(i => i.id === 'ibrahimpriest');
  const s = await w.admin('POST', 'bread/saints/item', { kind: 'occasion', rev: it.rev, item: { ...it.data, lead: 'كل سنة وأبونا طيب.', notify: { off: true } } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual(s.body.item.data.notify, { off: true }, 'P6\'s place is kept');
  const badLink = await w.admin('POST', 'bread/saints/item', { kind: 'occasion', rev: 0, item: { id: 'xx', name: 'x', type: 'fathers', from: { person: 'ibrahimisravim', feast: 'عيد ميلاده' }, headline: 'x' } });
  assert.equal(badLink.status, 400);
  await publish(w);
  const r = await w.admin('POST', 'bread/saints/restore', { rev: 1, confirm: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const n = await w.h.db.prepare("SELECT COUNT(*) AS n FROM published_revisions WHERE kind = 'bread' AND key = 'occasions'").first('n');
  assert.equal(n, 3);
  const lead = JSON.parse(await w.h.db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = 'occasions' AND live = 1").first('body')).occasions.find(o => o.id === 'ibrahimpriest').lead;
  assert.notEqual(lead, 'كل سنة وأبونا طيب.', 'back to version 1');
});

test('the feasts file keeps whose day it is (person, kind), so the page can hide the day a card stands for', async () => {
  const w = await world();
  const r = await w.admin('POST', 'bread/feasts', { month: '2027-06', feasts: [{ date: '2027-06-14', name: 'الشهيد أباسخيرون القليني', word: 'كلمة.', url: 'https://st-takla.org/a.html', person: 'abaskhiron', kind: 'استشهاده' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const file = JSON.parse(await w.h.db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = 'feasts/2027-06' AND live = 1").first('body'));
  assert.deepEqual([file.feasts[0].person, file.feasts[0].kind], ['abaskhiron', 'استشهاده']);
});

test('owner 2026-11-25: «من غير مصدر مكتوب» (source owner) for a day and an occasion of our own; anything else still needs https', () => {
  const people = REG.people;
  assert.deepEqual(checkOccasion({ id: 'bday', name: 'x', type: 'fathers', gregorian: '06-06', source: 'owner', headline: 'النهارده عيد ميلاد أبونا' }, { people }), []);
  assert.equal(checkOccasion({ id: 'bday', name: 'x', gregorian: '06-06', source: 'facebook' }, { people }).length, 1);
  assert.equal(checkOccasion({ id: 'bday', name: 'x', gregorian: '06-06' }, { people }).length, 1, 'empty: refused');
});
