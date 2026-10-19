// The menu's numbers (apps-script/Presence.gs adminBadges_): the heartbeat
// brings what waits for an admin — competition answers to review, store
// requests — cached a minute for everyone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compWorld, adminApi } from './fakes/comp.mjs';

test('heartbeat carries the menu badges { comps, shop } (numbers, cached)', () => {
  const world = compWorld();
  const call = adminApi(world);
  const beat = call('apiHeartbeat', { area: 'home' });
  assert.deepEqual(Object.keys(beat.badges).sort(), ['comps', 'shop']);
  assert.equal(typeof beat.badges.comps, 'number');
  assert.equal(typeof beat.badges.shop, 'number');
  assert.ok(world.gs.CacheService.getScriptCache().get('adm:badges'), 'cached for the next minute');
});
