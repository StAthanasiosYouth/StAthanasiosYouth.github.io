// Points & Store v2 (docs/COMPETITIONS.md §18): short locks, stock claim,
// store schedule + participant cancel, automatic push schedule, seasons.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compWorld, adminApi, publish, scoredComp, pub, clientKey, errorText } from './fakes/comp.mjs';

const phone = n => '0101234' + String(n).padStart(4, '0');

/* an answer for every question a start served (right or wrong does not matter here) */
const anyAnswers = start => Object.fromEntries(start.questions.filter(q => q.type !== 'info' && q.type !== 'long').map(q => [q.id,
  q.type === 'single' ? q.choices[0].id : q.type === 'multi' ? [q.choices[0].id] : q.type === 'truefalse' ? 't' : q.type === 'number' ? '1' : 'x']));

/* ---------- §18.1 one lock, never held during network work ---------- */

test('a publish in its GitHub step holds no lock: a visitor starts and submits meanwhile; a second publish is refused', () => {
  const world = compWorld();
  const call = adminApi(world);
  scoredComp(call);
  publish(world, call);
  call('apiCompSave', (call('apiComps').comps[0] || {}).id, { description: 'تعديل بسيط' });

  const review = call('apiReview');
  const seen = { during: null, second: null, held: null };

  world.github.onRequest = (method) => {
    if (method !== 'post' || seen.during) return;
    seen.held = world.scriptLock.held;
    const saved = world.gs.API_REQUEST_;
    const key = clientKey();
    const start = pub(world, 'compStart', { slug: 'bible-quiz', clientKey: key, fields: { name: 'مينا', phone: phone(1) } });
    seen.during = start.ok ? pub(world, 'compSubmit', { token: start.attempt.token, clientKey: key, answers: anyAnswers(start) }) : start;
    try { call('apiPublish', review.revision); } catch (error) { seen.second = error.message; }
    world.gs.API_REQUEST_ = saved;
  };

  const result = call('apiPublish', review.revision);
  world.github.onRequest = null;

  assert.equal(seen.held, 0, 'no lock held while GitHub is called');
  assert.equal(seen.during.ok, true, JSON.stringify(seen.during));
  assert.match(errorText(seen.second || ''), /فيه نشر شغال دلوقتي/);
  assert.ok(result.commit, 'the first publish still lands');
  assert.equal(world.scriptLock.lockedFetches.length, 0);
  assert.ok(!world.cache.get('publish:claim'), 'the claim is dropped');
});

test('a publish whose commit fails leaves nothing behind: no claim, nothing stamped, next publish works', () => {
  const world = compWorld();
  const call = adminApi(world);
  scoredComp(call);
  const review = call('apiReview');
  world.github.onRequest = (method) => { if (method === 'post') throw new Error('network down'); };
  assert.throws(() => call('apiPublish', review.revision));
  world.github.onRequest = null;
  assert.ok(!world.cache.get('publish:claim'));
  assert.equal(call('apiComps').comps[0].liveVersion || '', '');
  assert.ok(publish(world, call).commit);
});
