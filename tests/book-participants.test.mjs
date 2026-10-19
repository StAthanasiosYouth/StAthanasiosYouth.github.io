// «كل فرد باسمه وسنه» in Apps Script (BookModel.gs): the editor's age ranges
// and flag are kept, refused when wrong, and published so the Worker and the
// page can price each person by age (category limits lifted to the booking's).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compWorld } from './fakes/comp.mjs';

const plain = v => JSON.parse(JSON.stringify(v));

test('participants: the editor input keeps the flag and age ranges; the public block lifts the limits', () => {
  const world = compWorld();
  const problems = [];
  const spec = world.gs.bookBookingInput_({
    participants: true, perBookingMax: 6,
    pricing: { mode: 'group', categories: [{ label: 'فرد', price: 100 }, { label: 'طفل', price: 50, group: 'child', max: 3, ageMin: '4', ageMax: '12' }] }
  }, '2026-12-01 10:00', problems);
  assert.deepEqual(plain(problems), []);
  assert.equal(spec.participants, true);
  assert.deepEqual([spec.pricing.categories[1].ageMin, spec.pricing.categories[1].ageMax], [4, 12]);
  assert.equal(spec.pricing.categories[0].ageMin, null, 'the first price has no range (everyone else)');

  const out = plain(world.gs.bookPublicBooking_(spec, [], [], [], () => null, true));
  assert.equal(out.participants, true);
  assert.equal(out.collectNames, true);
  assert.deepEqual(out.pricing.categories.map(c => [c.min, c.max]), [[0, 6], [0, 6]], 'limits come from the people list');
  assert.deepEqual([out.pricing.categories[1].ageMin, out.pricing.categories[1].ageMax], [4, 12]);
  assert.equal('ageMin' in out.pricing.categories[0], false);

  const bad = [];
  world.gs.bookBookingInput_({ pricing: { mode: 'group', categories: [{ label: 'فرد', price: 1 }, { label: 'طفل', price: 1, ageMin: '13', ageMax: '4' }] } }, '', bad);
  assert.match(plain(bad).join(' '), /أصغر من/);
});
