/*
 * «خبزنا اليومي» — the saints and church people registry (daily-bread/saints/registry.json) and the Coptic calendar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toGregorian, toCoptic, daysOfMonth } from '../tools/lib/coptic.mjs';
import { load, check, feastsOfMonth, occasionsOfMonth, missingOf } from '../tools/lib/saints.mjs';

test('coptic: known dates both ways (Christmas, the Nayrouz, Pope Shenouda III enthronement, Pope Kyrillos VI repose)', () => {
  assert.equal(toGregorian(1743, 4, 29), '2027-01-07');
  assert.equal(toGregorian(1743, 1, 1), '2026-09-11');
  assert.equal(toGregorian(1744, 1, 1), '2027-09-12', '1743 is a leap year: 6 النسيء, then the new year a day later');
  assert.equal(toGregorian(1743, 13, 6), '2027-09-11');
  assert.deepEqual(toCoptic('1971-11-14'), { y: 1688, m: 3, d: 4 });
  assert.deepEqual(toCoptic('1971-03-09'), { y: 1687, m: 6, d: 30 });
  assert.deepEqual(toCoptic('2026-12-04'), { y: 1743, m: 3, d: 25 });
  for (let t = Date.UTC(2020, 0, 1); t < Date.UTC(2032, 0, 1); t += 864e5 * 7) {
    const iso = new Date(t).toISOString().slice(0, 10), c = toCoptic(iso);
    assert.equal(toGregorian(c.y, c.m, c.d), iso, 'round trip ' + iso);
  }
  assert.equal(daysOfMonth('2027-02').length, 28);
});

test('coptic: the P2 dates, by code (1978-01-03 = 25 Kiahk, Fr Andraos, Fr Mina Aboud, Fr Mikhail El-Behiry)', () => {
  assert.deepEqual(toCoptic('1978-01-03'), { y: 1694, m: 4, d: 25 });
  assert.deepEqual(toCoptic('1989-02-07'), { y: 1705, m: 5, d: 30 });
  assert.deepEqual(toCoptic('2013-07-06'), { y: 1729, m: 10, d: 29 });
  assert.deepEqual(toCoptic('1992-06-14'), { y: 1708, m: 10, d: 7 });
  assert.deepEqual(toCoptic('1991-02-03'), { y: 1707, m: 5, d: 26 });
  assert.equal(toGregorian(1639, 6, 16), '1923-02-23');
  assert.equal(toGregorian(1742, 6, 16), '2026-02-23', 'the 103rd feast of Fr Mikhail El-Behiry, Monday');
});

test('registry: the file in the repo is valid, ids unique, every day has a source', () => {
  const reg = load();
  assert.deepEqual(check(reg), []);
  // P2: everyone in the owner's picture folders: 65 AI + 37 reposed + 6 living
  assert.equal(reg.people.length, 108);
  assert.equal(reg.people.reduce((a, p) => a + p.album.length, 0), 115, '65 + 43 + 7 files');
  assert.equal(reg.people.filter(p => p.album.some(a => a.type === 'ai')).length, 65);
  const ids = reg.people.map(p => p.id);
  for (const id of ['mercurius', 'athanasius', 'tawadros2', 'ilarion', 'makariosqena', 'cosmasdamian', 'ephrem', 'severus', 'verena',
    'isaacsyrian', 'julius', 'abdelmessihhabashy', 'minaaboud', 'behiry', 'salibsoryal', 'lukasidarous', 'mattaelmeskeen', 'morcosdawood',
    'youssefasaad', 'mikhailibrahim', 'habibgirgis', 'andraos']) assert.ok(ids.includes(id), id);
  // living: the Pope, our bishop and the four fathers of our church (owner, 2026-11-24)
  assert.deepEqual(reg.people.filter(p => p.class === 'living').map(p => p.id).sort(),
    ['angelosmourad', 'ibrahimisravim', 'ilarion', 'isaacnabih', 'philopaterromany', 'tawadros2']);
  assert.equal(reg.people.find(p => p.id === 'theophilus').album.length, 7, 'all 7 pictures of Anba Theophilus');
});

test('registry: the owner decisions (names, dates) are in the file', () => {
  const reg = load();
  const by = id => reg.people.find(p => p.id === id);
  assert.equal(by('ibrahimisravim').name, 'القمص إبراهيم إسراڤيم');
  // the name with ڤ everywhere; only the owner's own file name (album src, not renamed) keeps its spelling
  const noSrc = JSON.stringify(reg.people.map(p => ({ ...p, album: [] })).concat(reg.occasions));
  assert.ok(!noSrc.includes('إسرافيم'));
  assert.equal(by('mattaelmeskeen').name, 'القمص متى المسكين');
  assert.deepEqual(by('matthew1').feasts.map(f => f.coptic), ['5-5'], 'Pope Matthew I on 5 Tobi');
  assert.equal(by('verena').feasts[0].coptic, '1-4');
  assert.equal(by('behiry').feasts[0].coptic, '6-16');
  assert.deepEqual(by('cosmasdamian').feasts.map(f => f.coptic), ['3-22', '3-30']);
  assert.equal(by('ephrem').feasts[0].coptic, '11-15');
  assert.equal(by('severus').feasts[0].coptic, '6-14');
  assert.equal(by('julius').feasts[0].coptic, '1-22');
  const day = f => f.year + '-' + f.gregorian;
  assert.equal(day(by('andraos').feasts[0]), '1989-02-07');
  assert.equal(day(by('minaaboud').feasts[0]), '2013-07-06');
  assert.equal(day(by('mikhailibrahim').feasts[0]), '1975-03-26');
  assert.equal(day(by('habibgirgis').feasts[0]), '1951-08-21');
  assert.equal(day(by('lukasidarous').feasts[0]), '2020-08-26');
  assert.equal(day(by('mattaelmeskeen').feasts[0]), '2006-06-08');
  assert.equal(day(by('salibsoryal').feasts[0]), '1994-09-02');
  assert.deepEqual(by('ilarion').feasts.map(day), ['2019-06-09', '2019-07-27']);
  for (const id of ['angelosmourad', 'philopaterromany']) assert.equal(day(by(id).feasts[0]), '2021-03-20');
  // St-Takla's page for our church: Fr Ibrahim priest 1988-02-21, hegumen 1990-04-30; Fr Isaac priest 1997-08-31
  assert.deepEqual(by('ibrahimisravim').feasts.map(day), ['1988-02-21', '1990-04-30']);
  assert.deepEqual(by('isaacnabih').feasts.map(day), ['1997-08-31']);
  assert.deepEqual(toCoptic('1988-02-21'), { y: 1704, m: 6, d: 13 });
  assert.deepEqual(toCoptic('1990-04-30'), { y: 1706, m: 8, d: 22 });
  assert.deepEqual(toCoptic('1997-08-31'), { y: 1713, m: 12, d: 25 });
  // Abu Sefein: the three feasts on our church's page are his feasts (one card, no duplicate occasion)
  assert.deepEqual(by('mercurius').feasts.map(f => f.coptic), ['3-25', '10-9', '11-25']);
  assert.ok(!reg.occasions.some(o => /سيفين|مرقوريوس/.test(o.name + o.kind)));
  const th = by('theophilus').milestones;
  const at = word => th.find(m => m.kind.startsWith(word)).date;
  assert.equal(at('القسيسية'), '1978-01-03', 'the film wins: priesthood 3 Jan 1978, not 2 Jan');
  assert.equal(at('القمصية'), '1980-10-05');
  assert.equal(at('دخول'), '1975-05-06');
  assert.equal(at('الرهبنة'), '1975-10-05');
  assert.equal(at('الأسقفية'), '1992-06-14');
  assert.deepEqual(by('theophilus').feasts.map(day), ['1992-06-14', '2019-02-12']);
  const dio = reg.occasions.find(o => o.id === 'redseadiocese');
  assert.equal(day(dio), '1992-06-14');
});

test('registry: missing data keeps the person and keeps them out of the automatic days', () => {
  const reg = load();
  const inc = reg.people.filter(p => p.status === 'incomplete');
  assert.deepEqual(inc.map(p => p.id).sort(), ['abdelmessihhabashy', 'isaacsyrian']);
  for (const p of inc) {
    assert.deepEqual(p.missing, ['feasts']);
    assert.ok(p.album.length > 0, p.id + ' keeps its pictures');
    assert.ok(p.pending.length > 0, p.id + ' says what to find');
  }
  for (const p of reg.people) assert.deepEqual(p.missing, missingOf(p), p.id);
  // a day filled in later: check() asks for the status to follow, then it reaches the automatic days, no code change
  const tmp = structuredClone(reg);
  const isaac = tmp.people.find(p => p.id === 'isaacsyrian');
  isaac.feasts.push({ kind: 'نياحته', coptic: '1-1', source: 'https://example.org' });
  assert.match(check(tmp).join('\n'), /isaacsyrian: missing لازم \[\]/);
  const sep = () => feastsOfMonth(tmp, '2026-09').find(f => f.date === '2026-09-11');
  assert.ok(!sep() || sep().person.id !== 'isaacsyrian', 'not before the status follows');
  isaac.missing = []; isaac.status = 'complete';
  assert.deepEqual(check(tmp), []);
  assert.ok(sep().person.id === 'isaacsyrian' || sep().others.includes(isaac.name));
});

test('living fathers never reach the saints card; they are in «مناسبات كنيستنا»', () => {
  const reg = load();
  const living = reg.people.filter(p => p.class === 'living');
  const ids = new Set(living.map(p => p.id)), names = new Set(living.map(p => p.name));
  for (let m = 1; m <= 12; m++) {
    for (const f of feastsOfMonth(reg, '2027-' + String(m).padStart(2, '0'))) {
      assert.ok(!ids.has(f.person.id), f.person.id);
      for (const o of f.others) assert.ok(!names.has(o), o);
    }
  }
  assert.ok(occasionsOfMonth(reg, '2026-11').some(o => o.person && o.person.id === 'tawadros2'));
  assert.deepEqual(occasionsOfMonth(reg, '2026-06').map(o => o.date + ' ' + (o.person ? o.person.id : o.occasion.id)),
    ['2026-06-09 ilarion', '2026-06-14 redseadiocese']);
  assert.deepEqual(occasionsOfMonth(reg, '2027-03').map(o => o.person.id).sort(), ['angelosmourad', 'philopaterromany']);
  assert.equal(occasionsOfMonth(reg, '2026-07').find(o => o.date === '2026-07-27').person.id, 'ilarion');
  assert.equal(occasionsOfMonth(reg, '2027-02').find(o => o.date === '2027-02-21').person.id, 'ibrahimisravim');
  assert.equal(occasionsOfMonth(reg, '2027-08').find(o => o.date === '2027-08-31').person.id, 'isaacnabih');
});

test('registry: check() names each problem', () => {
  const ok = { class: 'reposed', status: 'complete', missing: [], album: [{ src: 'a.png', type: 'ai' }] };
  const reg = {
    schema: 2, categories: { martyrs: 'x' }, people: [
      { id: 'a', name: 'أ', cat: 'martyrs', ...ok, feasts: [{ kind: 'k', coptic: '14-1', source: 'https://x.org' }] },
      { id: 'a', name: 'ب', cat: 'nope', ...ok, feasts: [{ kind: 'k', gregorian: '02-30', source: 'http://x.org' }] },
      { id: 'c', name: 'ج', cat: 'martyrs', ...ok, feasts: [{ kind: 'k', coptic: '1-1', gregorian: '01-01', source: 'https://x.org' }], image: { file: 'assets/img/saints/none.webp', source: 'https://x.org', license: 'CC0' } },
      { id: 'd', name: 'د', cat: 'martyrs', class: 'saint', status: 'complete', missing: [], album: [{ src: 'x.png', type: 'drawing' }], feasts: [],
        milestones: [{ kind: 'm', date: '1975-02-30', source: 'https://x.org', status: 'maybe' }] },
      { id: 'e', name: 'ه', cat: 'martyrs', class: 'living', status: 'incomplete', missing: ['feasts'], album: [], feasts: [{ kind: 'k', gregorian: '06-31', year: 2019, source: 'https://x.org' }] }
    ],
    occasions: [{ id: 'a', name: 'م', kind: 'k', gregorian: '06-14', source: 'https://x.org' }]
  };
  const errs = check(reg).join('\n');
  assert.match(errs, /a: .*اليوم القبطي «14-1»/);
  assert.match(errs, /a: id متكرر/);
  assert.match(errs, /a: المجموعة «nope»/);
  assert.match(errs, /a: .*اليوم الميلادي «02-30»/);
  assert.match(errs, /a: .*المصدر لازم رابط https/);
  assert.match(errs, /c: .*واحد بس/);
  assert.match(errs, /c: الصورة assets\/img\/saints\/none\.webp مش موجودة/);
  assert.match(errs, /d: class لازم/);
  assert.match(errs, /d: missing لازم \[feasts\]/);
  assert.match(errs, /d: status لازم «incomplete»/);
  assert.match(errs, /d: album: النوع «drawing»/);
  assert.match(errs, /d: محطة «m»: status لازم/);
  assert.match(errs, /d: محطة «m»: التاريخ «1975-02-30»/);
  assert.match(errs, /e: .*اليوم الميلادي «06-31»/);
  assert.match(errs, /e: missing لازم \[album\]/);
  assert.match(check({ schema: 1, people: [] })[0], /schema 2/);
});

test('feastsOfMonth: December 2026 from the registry, Coptic and Gregorian days, one a day with the others listed', () => {
  const list = feastsOfMonth(load(), '2026-12');
  const on = d => list.find(f => f.date === d);
  assert.equal(on('2026-12-04').person.id, 'mercurius');
  assert.equal(on('2026-12-04').feast.kind, 'استشهاده');
  assert.equal(on('2026-12-12').person.id, 'mary', 'St Mary first, the bishops ordained that day after her');
  assert.ok(on('2026-12-12').others.length >= 1);
  assert.equal(on('2026-12-27').person.id, 'kirolloskena', 'a Gregorian day');
  assert.equal(on('2026-12-01').person.id, 'cosmasdamian');
  assert.equal(new Set(list.map(f => f.date)).size, list.length, 'one a day');
  assert.equal(feastsOfMonth(load(), '2027-01').find(f => f.date === '2027-01-13').person.id, 'matthew1');
});

test('feastsOfMonth: 6 النسيء is kept on 5 النسيء in a common year', () => {
  const reg = { schema: 2, categories: { x: 'x' }, people: [{ id: 'n', name: 'ن', cat: 'x', class: 'reposed', status: 'complete', missing: [], album: [{ src: 'n.png', type: 'ai' }], feasts: [{ kind: 'k', coptic: '13-6', source: 'https://x.org' }] }] };
  assert.equal(feastsOfMonth(reg, '2027-09')[0].date, '2027-09-11', '1743 is leap: 6 النسيء exists');
  assert.equal(feastsOfMonth(reg, '2026-09')[0].date, '2026-09-10', '1742: 5 النسيء');
});
