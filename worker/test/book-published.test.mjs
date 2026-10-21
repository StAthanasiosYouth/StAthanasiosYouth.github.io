// Phase 2 P2-6: the booking reads an event's definition from the live D1 revision when a
// PUBLISH_MODE='worker' publish made it (D1 is then the truth); otherwise from the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWorld, eventJson } from './book-helpers.mjs';
import { signSync } from '../src/lib/sync.js';

let clock = Date.now();
async function publish(w, id, mode, event) {
  const raw = JSON.stringify({ id, mode, by: 'admin@example.com', at: ++clock, files: { [`events/${event.slug}/event.json`]: JSON.stringify(event) } });
  const ts = String(++clock);
  return w.call('/v1/sync/publish', { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': await signSync('sync-test-secret', ts, raw) } });
}
/* the site's event.json, counted */
function site(event) {
  const calls = [];
  return { calls, fetch: async url => { calls.push(String(url)); return event ? new Response(JSON.stringify(event)) : new Response('nope', { status: 404 }); } };
}
const state = (w, s) => w.call('/v1/book/state?slug=alex-trip', { headers: { 'cf-connecting-ip': '198.51.100.9' }, fetch: s.fetch });

test('worker-mode revision: the booking uses it, the site is not asked; a new publish counts at once', async () => {
  const w = await bookWorld({ event: null });
  const s = site(eventJson({ v: 'site-old' }));
  assert.equal((await publish(w, 'pub-1', 'worker', eventJson({ v: 'd1-v1' }))).status, 200);
  let r = await state(w, s);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.revision, 'd1-v1');
  assert.equal(s.calls.length, 0, 'the site is not read');
  assert.equal((await w.db.prepare("SELECT source FROM event_cfg WHERE slug = 'alex-trip'").first()).source, 'published');

  // within the 60-s freshness window: the publish expires the copy, so the next request already sees it
  await publish(w, 'pub-2', 'worker', eventJson({ v: 'd1-v2' }, { capacity: 3 }));
  r = await state(w, s);
  assert.equal(r.body.revision, 'd1-v2');
  assert.equal(r.body.left, 3);
});

test('shadow-mode revision: the site stays the truth (github / shadow)', async () => {
  const w = await bookWorld({ event: null });
  const s = site(eventJson({ v: 'site-v' }));
  await publish(w, 'pub-1', 'shadow', eventJson({ v: 'd1-shadow' }));
  const r = await state(w, s);
  assert.equal(r.body.revision, 'site-v');
  assert.equal(s.calls.length, 1);
});

test('a withdrawn worker-mode revision: not bookable, even if the site still has the old file', async () => {
  const w = await bookWorld({ event: null });
  const s = site(eventJson({ v: 'site-v' }));
  await publish(w, 'pub-1', 'worker', eventJson({ v: 'd1-v1' }));
  assert.equal((await state(w, s)).status, 200);
  await publish(w, 'pub-2', 'worker', { schema: 1, slug: 'alex-trip', withdrawn: true });
  const r = await state(w, s);
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'not_found');
  assert.equal(s.calls.length, 0);
});

test('a staging fixture is never replaced by a publish', async () => {
  const w = await bookWorld();                    // the fixture (source 'fixture', v rev1)
  const s = site(null);
  await publish(w, 'pub-1', 'worker', eventJson({ v: 'd1-v1' }));
  assert.equal((await state(w, s)).body.revision, 'rev1');
});
