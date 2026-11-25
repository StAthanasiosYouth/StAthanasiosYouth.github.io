/*
 * «خبزنا اليومي» P5b — the praises actually sung (several per person: a main one, others for a day or a season;
 * candidates admin only) and the words of each day («نحب نفكّرك»): the checks, the choice per day, praises.json beside
 * saints.json, the seed 0038 (only empty words, only empty lists, never an occasion), the feasts tab, the public file.
 * Real SQLite, real migrations, the real Worker routes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness, fakeGoogle } from './helpers.mjs';
import { forgetAccessToken } from '../src/push/fcm.js';
import { checkPerson, praiseFor, praisesFile, publicFile, confirmedPraises } from '../src/bread/saints.js';
import { dateOf, placeTexts } from '../../tools/bread-p5b-seed.mjs';

const KEYS = { PW_PEPPER: 'pepper-test', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp-test', ACCOUNT_PAD_MS: '0' };
const P = 'p@example.com';
const REG = JSON.parse(readFileSync(new URL('../../daily-bread/data/saints.json', import.meta.url), 'utf8'));
const TEXTS = JSON.parse(readFileSync(new URL('../../daily-bread/saints/texts-seed.json', import.meta.url), 'utf8')).texts;
const SEED = JSON.parse(readFileSync(new URL('../../daily-bread/saints/praises-seed.json', import.meta.url), 'utf8')).praises;
const SQL = readFileSync(new URL('../migrations/0038_bread_praises.sql', import.meta.url), 'utf8');

async function world() {
  forgetAccessToken();
  const g = await fakeGoogle();
  const h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ...KEYS } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'P', 'primary', 1, 0)`).run();
  const admin = async (method, path, body) => h.call('/v1/admin/' + path, { method, body, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: P, sub: 's-p' })) }, fetch: g.fetch });
  assert.equal((await admin('POST', 'bread/settings', { saints: true, module: true })).status, 200);
  return { h, admin };
}
async function publish(w) {
  const rv = await w.admin('GET', 'bread/saints/review');
  const r = await w.admin('POST', 'bread/saints/publish', { expect: rv.body.expect });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const person = id => structuredClone(REG.people.find(p => p.id === id));
const ok = p => checkPerson(p, { cats: { [p.cat]: 'x' }, statusTyped: false }).filter(e => !/محطة/.test(e));
const sung = (id, extra = {}) => ({ id, type: 'tamgeed', title: 'تمجيد ' + id, source: 'https://example.org/' + id, status: 'confirmed', verses: [['بيت ١', 'بيت ٢']], ...extra });

test('the checks: types, https source, candidate or confirmed, a confirmed one has its text, one confirmed main, days of the person only', () => {
  const p = person('george');
  p.praises = [sung('pr1', { main: true }), { id: 'pr2', type: 'madih', title: 'مديح', source: 'https://example.org/m', status: 'candidate' }];
  assert.deepEqual(ok(p), []);
  const bad = (q, re) => { const x = person('george'); x.praises = q; assert.ok(ok(x).some(e => re.test(e)), JSON.stringify(ok(x))); };
  bad([sung('pr1', { type: 'song' })], /النوع/);
  bad([sung('pr1', { source: 'http://x.org' })], /https/);
  bad([sung('pr1', { status: 'maybe' })], /الحالة/);
  bad([sung('pr1', { verses: undefined })], /المؤكد لازم/);
  bad([sung('pr1', { main: true }), sung('pr2', { main: true })], /أساسي واحد/);
  bad([sung('pr1', { days: ['يوم مش موجود'] })], /أيام/);
  bad([sung('pr1'), sung('pr1')], /متكرر/);
  bad([sung('pr1', { verses: [['١', '٢', '٣', '٤', '٥', '٦', '٧']] })], /مقاطع/);
});

test('the choice per day: the one set for that day, else the main, never a candidate; nothing at all is fine', () => {
  const p = person('michael');
  const k = p.feasts[1].kind;
  p.praises = [sung('pr1', { main: true }), sung('pr2', { days: [k], context: 'عيده في بؤونة' }), { ...sung('pr3', { days: [k] }), status: 'candidate' }];
  assert.equal(praiseFor(p, k).id, 'pr2');
  assert.equal(praiseFor(p, 'غيره').id, 'pr1');
  p.praises = [{ ...sung('pr1', { main: true }), status: 'candidate' }];
  assert.equal(praiseFor(p, k), null, 'a candidate is never shown');
  delete p.praises;
  assert.equal(praiseFor(p, k), null);
  assert.deepEqual(confirmedPraises(p), []);
});

test('praises.json: only confirmed ones with their text; saints.json carries their names, never a candidate or the text', () => {
  const reg = structuredClone(REG);
  const g = reg.people.find(p => p.id === 'george');
  g.praises = [sung('pr1', { main: true }), { id: 'pr2', type: 'madih', title: 'مرشح', source: 'https://example.org/c', status: 'candidate', verses: [['سر']] }];
  const f = praisesFile(reg);
  assert.equal(f.schema, 1);
  assert.deepEqual(f.people.george.praises.map(q => q.id), ['pr1']);
  assert.deepEqual(f.people.george.praises[0].verses, [['بيت ١', 'بيت ٢']]);
  const pub = JSON.stringify(publicFile(reg));
  assert.ok(!pub.includes('مرشح') && !pub.includes('بيت ١'), 'no candidate, no text in saints.json');
});

test('the 137 texts: each placed by person + kind + its own date (Michael\'s two «عيده», Gabriel\'s three), no emoji, all different days', () => {
  assert.deepEqual(dateOf('في مثل هذا اليوم، الموافق ١٢ بـؤونة، نحتفل'), { coptic: '10-12' });
  assert.deepEqual(dateOf('الموافق ٦ يوليو'), { gregorian: '07-06' });
  assert.equal(TEXTS.length, 137);
  const again = placeTexts(TEXTS.map(t => ({ id: t.person, kind: t.kind, text: t.text })), REG.people);
  assert.deepEqual(again.map(t => t.at), TEXTS.map(t => t.at));
  const mich = TEXTS.filter(t => t.person === 'michael');
  assert.equal(new Set(mich.map(t => t.at)).size, mich.length);
  assert.throws(() => placeTexts([{ id: 'michael', kind: 'عيده', text: 'الموافق ١ توت' }], REG.people), /0 days/);
});

test('the seed (0038): the words go to empty days only, the lists to people with none, the occasions untouched; a second run changes nothing', async () => {
  assert.ok(!/kind = 'occasion'/.test(SQL), 'never an occasion (the owner\'s own words)');
  const { h } = await world();
  const people = (await h.db.prepare("SELECT id, data, rev FROM saints_items WHERE kind = 'person'").all()).results.map(r => ({ ...JSON.parse(r.data), rev: r.rev }));
  const words = people.flatMap(p => p.feasts.filter(f => f.word));
  assert.equal(words.length, 137, 'every text found its day in the seeded registry');
  assert.equal(people.filter(p => p.praises).length, Object.keys(SEED).length);
  const merc = people.find(p => p.id === 'mercurius');
  assert.equal(praiseFor(merc, merc.feasts[0].kind).title, merc.praise.title, 'Abu Sefein: «تعالوا نتهلل بالألحان»');
  const mary = people.find(p => p.id === 'mary');
  assert.ok(mary.praises.some(q => q.status === 'confirmed' && q.main && /يا أم الله القدوس/.test(q.title)));
  // what the owner edits stays: a word he wrote, a list he changed
  const g = people.find(p => p.id === 'george');
  await h.db.prepare("UPDATE saints_items SET data = json_set(json_set(data, '$.feasts[0].word', 'كلامي'), '$.praises', json('[]')) WHERE kind = 'person' AND id = 'george'").run();
  // the words have line breaks: one statement per «;» at a line's end
  for (const line of SQL.split(/;\n(?=UPDATE|$)/).filter(l => /^UPDATE/.test(l))) await h.db.prepare(line).run();
  const g2 = JSON.parse(await h.db.prepare("SELECT data FROM saints_items WHERE kind = 'person' AND id = 'george'").first('data'));
  assert.equal(g2.feasts[0].word, 'كلامي');
  assert.deepEqual(g2.praises, []);
  assert.equal(await h.db.prepare("SELECT rev FROM saints_items WHERE kind = 'person' AND id = 'mary'").first('rev'), people.find(p => p.id === 'mary').rev, 'nothing again');
  assert.ok(g.rev > 1, 'changed by the seed: the review shows it');
});

test('publish: praises.json beside saints.json; the feasts tab gets the day\'s words and its praise to open in full; the public file', async () => {
  const w = await world();
  await publish(w);
  const row = await w.h.db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = 'praises' AND live = 1").first();
  const file = JSON.parse(row.body);
  assert.ok(file.people.mercurius && file.people.george && file.people.mary);
  assert.ok(Object.values(file.people).every(p => p.praises.every(q => q.verses.length)));
  const mary = REG.people.find(p => p.id === 'mary');
  const words = TEXTS.filter(t => t.person === 'george');
  assert.ok(words.length);
  const pub = await w.h.call('/v1/bread/file/praises');
  assert.equal(pub.status, 200);
  assert.deepEqual(Object.keys(JSON.parse(pub.text || JSON.stringify(pub.body)).people).sort(), Object.keys(file.people).sort());
  // George's day (23 برموده = 1 May 2027): his own words, and «السلام لك يا جاورجيوس» to open on our page
  const feasts = (await w.admin('GET', 'bread/saints/feasts?month=2027-05')).body.feasts;
  const day = feasts.find(f => f.id === 'george');
  assert.ok(day, JSON.stringify(feasts.map(f => f.id)));
  assert.equal(day.ownWord, true);
  assert.match(day.word, /جاورجيوس|جرجس/);
  assert.match(day.praiseTitle, /جاورجيوس/);
  assert.ok(day.praiseId);
  assert.ok(mary);
});

test('seasons (owner 2026-11-25): Coptic Easter, the seasons of a day, a praise set for a season wins only inside it; the admin\'s list is the Worker\'s', async () => {
  const { easter, seasonsOn, SEASONS } = await import('../src/bread/coptic.js');
  assert.deepEqual([2025, 2026, 2027, 2028, 2030].map(easter), ['2025-04-20', '2026-04-12', '2027-05-02', '2028-04-16', '2030-04-28']);
  assert.deepEqual(seasonsOn('2026-11-25'), ['nativity-fast']);
  assert.deepEqual(seasonsOn('2026-12-20'), ['kiahk', 'nativity-fast']);
  assert.deepEqual(seasonsOn('2027-04-30'), ['holy-week', 'great-lent']);
  assert.deepEqual(seasonsOn('2027-06-20'), ['pentecost50']);
  assert.deepEqual(seasonsOn('2027-06-21'), ['apostles-fast']);
  assert.deepEqual(seasonsOn('2027-08-10'), ['virgin-fast']);
  assert.deepEqual(seasonsOn('2027-09-01'), []);
  const p = person('mary');
  const k = p.feasts[0].kind;
  p.praises = [sung('pr1', { main: true }), sung('pr2', { seasons: ['kiahk'] }), sung('pr3', { seasons: ['virgin-fast'], days: [k] })];
  assert.equal(praiseFor(p, 'غيره', '2026-12-20').id, 'pr2', 'in Kiahk');
  assert.equal(praiseFor(p, 'غيره', '2027-09-01').id, 'pr1', 'out of it: the main one');
  assert.equal(praiseFor(p, k, '2027-08-10').id, 'pr3', 'that day, in its season');
  assert.equal(praiseFor(p, k, '2027-09-01').id, 'pr1', 'that day, out of its season');
  const x = person('mary'); x.praises = [sung('pr1', { seasons: ['lent'] })];
  assert.ok(ok(x).some(e => /فترة/.test(e)));
  const admin = readFileSync(new URL('../../apps-script/AdminSaints.html', import.meta.url), 'utf8');
  assert.ok(admin.includes('var PR_SEASONS = ' + JSON.stringify(SEASONS).replace(/","/g, '", "').replace(/\],\[/g, '], [').replace(/"/g, "'") + ';'));
  // 0039: the Virgin's two
  const { h } = await world();
  const mary = JSON.parse(await h.db.prepare("SELECT data FROM saints_items WHERE kind = 'person' AND id = 'mary'").first('data'));
  assert.deepEqual(mary.praises.filter(q => q.seasons).map(q => [q.title, q.seasons]), [['الصوم هو أول وصية', ['virgin-fast']], ['يا م ر ي م', ['kiahk']]]);
});
