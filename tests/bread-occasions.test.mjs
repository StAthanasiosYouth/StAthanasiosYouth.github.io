// «خبزنا اليومي» P5 «مناسبات كنيستنا»: the member page's own rules (assets/js/bread/occasions.js) against the Worker's
// (worker/src/bread/saints.js) on the approved list; the site's Coptic calendar is the Worker's, byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanOccasions, occasionsOnDay, feastHidden, upcoming, yearsOf, occasionKey, nextDate } from '../assets/js/bread/occasions.js';
import { occasionsFile, occasionsOn } from '../worker/src/bread/saints.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const REG = JSON.parse(read('daily-bread/data/saints.json'));
const SEED = JSON.parse(read('daily-bread/saints/occasions-seed.json'));
const reg = { ...REG, occasions: SEED.occasions, people: REG.people.map(p => (p.id === 'mercurius' ? { ...p, praise: SEED.praises.mercurius } : p)) };
const file = cleanOccasions(JSON.parse(JSON.stringify(occasionsFile(reg))));

test('the site\'s Coptic calendar is the Worker\'s, byte for byte', () => {
  assert.equal(read('assets/js/bread/coptic.js'), read('worker/src/bread/coptic.js'));
});

test('the page sees the same occasions as the Worker, every day of a whole year', () => {
  for (let k = 0; k < 400; k++) {
    const d = new Date(Date.UTC(2026, 10, 25) + k * 864e5).toISOString().slice(0, 10);
    assert.deepEqual(occasionsOnDay(file, d).map(o => o.id), occasionsOn(reg, d).map(o => o.id), d);
  }
});

test('«نحب نفكّرك» hides the day a card stands for: by id and day, or by the name in an older file', () => {
  const june14 = occasionsOnDay(file, '2027-06-14');
  assert.equal(feastHidden({ person: 'theophilus', kind: 'تذكار رسامته', name: 'x' }, june14), true);
  assert.equal(feastHidden({ person: 'abaskhiron', kind: 'استشهاده', name: 'x' }, june14), false, 'the martyr of the day stays');
  assert.equal(feastHidden({ person: '', name: 'الأنبا ثاؤفيلس أول أسقف للبحر الأحمر' }, june14), true, 'a feasts file from before P5');
  assert.equal(feastHidden({ person: 'mercurius', kind: 'استشهاده', name: 'x' }, occasionsOnDay(file, '2026-12-04')), true);
  assert.equal(feastHidden(null, june14), false);
});

test('what is coming, the anniversary, the P5b key; a bad file is refused, bad parts dropped', () => {
  const next = upcoming(file, '2026-11-25');
  assert.equal(next[0].o.id, 'abusefeinmartyrdom');
  assert.equal(next[0].at, '2026-12-04');
  assert.equal(nextDate(file.occasions.find(o => o.id === 'athanasiusrepose'), '2026-11-25'), '2027-05-15');
  assert.equal(yearsOf(file.occasions.find(o => o.id === 'redseadiocese'), '2027-06-14'), 35);
  assert.equal(occasionKey({ id: 'redseadiocese' }, '2027-06-14'), 'occ:redseadiocese:2027');
  assert.equal(cleanOccasions(null), null);
  assert.equal(cleanOccasions({ occasions: 'x' }), null);
  const bad = cleanOccasions({ occasions: [{ id: 'a', headline: 'x', gregorian: '01-01', pictures: [{ img: 'https://evil.example/a.jpg' }], source: 'javascript:x' }, { id: 'B!', headline: 'x', gregorian: '01-01' }] });
  assert.equal(bad.occasions.length, 1);
  assert.deepEqual(bad.occasions[0].pictures, []);
  assert.equal(bad.occasions[0].source, '');
  assert.equal(file.patrons.patron.praise.verses.length, 35);
  assert.equal(file.patrons.family.id, 'athanasius');
});
