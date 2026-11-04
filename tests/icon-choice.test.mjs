// Phase 8 (BACKEND-MIGRATION §22.1 item 11): «صورة أو أيقونة» — an icon instead of a poster for the meeting,
// news, games and activities. Saved only as one of the site's own icons; published only when there is no image
// (the image wins); the public page keeps it only when it is a known icon; old content is unchanged.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './fakes/gas.mjs';
import { readFileSync } from 'node:fs';

// the browser module needs a document (as content-client.test.mjs)
globalThis.document = { createElement: () => ({ content: {} }) };
const { sanitizeContent } = await import('../assets/js/content.js');
const seed = JSON.parse(readFileSync(new URL('../content.json', import.meta.url), 'utf8'));

const ADMIN = 'menazakmena@gmail.com';
const plain = value => JSON.parse(JSON.stringify(value));
const build = (gs, now = '2026-10-08T12:00') => plain(gs.buildPublicContent(gs.readDraft_(), { now }));

function world() {
  const w = createWorld();
  w.as(ADMIN).gs.setup();
  return w;
}

test('saved as a known icon only; published for an item with no image; the image wins', () => {
  const w = world();
  const gs = w.gs;
  gs.apiSaveItem('news', { title: 'رحلة الغردقة', summary: 'سجّل اسمك', icon: 'bus' });
  gs.apiSaveItem('games', { title: 'الكويز', url: 'https://example.org/quiz', startAt: '2026-10-08 10:00', endAt: '2026-10-09 23:00', icon: 'trophy' });
  const { content } = build(gs);
  assert.equal(content.news[0].icon, 'bus');
  assert.equal(content.news[0].image, null);
  assert.equal(content.games[0].icon, 'trophy');

  // an unknown icon is refused with the reason (nothing saved)
  assert.throws(() => gs.apiSaveItem('news', { title: 'خبر', summary: 'x', icon: 'rocket-ship' }), /الأيقونة مش معروفة/);

  // the image wins: a row with both publishes the image only
  const id = gs.readDraft_().news[0].id;
  const media = gs.readDraft_().media || [];
  if (media.length) {
    gs.apiSaveItem('news', { id, title: 'رحلة الغردقة', summary: 'سجّل اسمك', icon: 'bus', image: media[0].id });
    const after = build(gs).content.news.find(n => n.id === id);
    assert.ok(after.image);
    assert.equal(after.icon, '');
  }
});

test('old content (no icon column, no icon) reads and publishes exactly as before', () => {
  const w = world();
  w.gs.apiSaveItem('news', { title: 'خبر قديم', summary: 'من غير أيقونة' });
  const n = build(w.gs).content.news[0];
  assert.equal(n.icon, '');
  assert.equal(n.image, null);
});

test('the public page keeps a known icon and drops anything else', () => {
  const raw = icon => ({ ...seed, news: [{ ...(seed.news && seed.news[0] || { id: 'news-aaaa1111', title: 'خبر', summary: 's' }), image: null, icon }] });
  const ok = sanitizeContent(raw('bus'));
  const bad = sanitizeContent(raw('javascript:alert(1)'));
  const none = sanitizeContent(raw(undefined));
  const news = c => (c && c.news ? c.news : [])[0];
  assert.equal(news(ok).icon, 'bus');
  assert.equal(news(bad).icon, '');
  assert.equal(news(none).icon, '');
});
