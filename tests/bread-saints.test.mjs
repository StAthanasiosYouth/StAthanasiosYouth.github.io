/*
 * «خبزنا اليومي» — the fixed saints registry (daily-bread/saints/registry.json) and the Coptic calendar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toGregorian, toCoptic, daysOfMonth } from '../tools/lib/coptic.mjs';
import { load, check, feastsOfMonth } from '../tools/lib/saints.mjs';

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

test('registry: the file in the repo is valid, ids unique, every day has a source', () => {
  const reg = load();
  assert.deepEqual(check(reg), []);
  assert.ok(reg.people.length >= 80);
  const ids = reg.people.map(p => p.id);
  for (const id of ['mercurius', 'athanasius', 'tawadros2', 'ilarion', 'makariosqena']) assert.ok(ids.includes(id), id);
  // living: only Pope Tawadros II and Anba Ilarion (owner, 2026-11-19)
  assert.deepEqual(reg.people.filter(p => p.alive).map(p => p.id).sort(), ['ilarion', 'tawadros2']);
});

test('registry: check() names each problem', () => {
  const reg = {
    schema: 1, categories: { martyrs: 'x' }, people: [
      { id: 'a', name: 'أ', cat: 'martyrs', feasts: [{ kind: 'k', coptic: '14-1', source: 'https://x.org' }] },
      { id: 'a', name: 'ب', cat: 'nope', feasts: [{ kind: 'k', gregorian: '02-30', source: 'http://x.org' }] },
      { id: 'c', name: 'ج', cat: 'martyrs', feasts: [{ kind: 'k', coptic: '1-1', gregorian: '01-01', source: 'https://x.org' }], image: { file: 'assets/img/saints/none.webp', source: 'https://x.org', license: 'CC0' } }
    ]
  };
  const errs = check(reg).join('\n');
  assert.match(errs, /a: .*اليوم القبطي «14-1»/);
  assert.match(errs, /a: id متكرر/);
  assert.match(errs, /a: المجموعة «nope»/);
  assert.match(errs, /a: .*اليوم الميلادي «02-30»/);
  assert.match(errs, /a: .*المصدر لازم رابط https/);
  assert.match(errs, /c: .*واحد بس/);
  assert.match(errs, /c: الصورة assets\/img\/saints\/none\.webp مش موجودة/);
});

test('feastsOfMonth: December 2026 from the registry, Coptic and Gregorian days, one a day with the others listed', () => {
  const list = feastsOfMonth(load(), '2026-12');
  const on = d => list.find(f => f.date === d);
  assert.equal(on('2026-12-04').person.id, 'mercurius');
  assert.equal(on('2026-12-04').feast.kind, 'استشهاده');
  assert.equal(on('2026-12-12').person.id, 'mary', 'St Mary first, the bishops ordained that day after her');
  assert.ok(on('2026-12-12').others.length >= 1);
  assert.equal(on('2026-12-27').person.id, 'kirolloskena', 'a Gregorian day');
  assert.equal(new Set(list.map(f => f.date)).size, list.length, 'one a day');
});

test('feastsOfMonth: 6 النسيء is kept on 5 النسيء in a common year', () => {
  const reg = { schema: 1, categories: { x: 'x' }, people: [{ id: 'n', name: 'ن', cat: 'x', feasts: [{ kind: 'k', coptic: '13-6', source: 'https://x.org' }] }] };
  assert.equal(feastsOfMonth(reg, '2027-09')[0].date, '2027-09-11', '1743 is leap: 6 النسيء exists');
  assert.equal(feastsOfMonth(reg, '2026-09')[0].date, '2026-09-10', '1742: 5 النسيء');
});
