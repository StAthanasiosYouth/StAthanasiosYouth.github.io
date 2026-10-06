// The browser re-validates content.json (assets/js/content.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// icons.js builds a <template> at import time
globalThis.document = { createElement: () => ({ content: {} }) };

const { sanitizeContent } = await import('../assets/js/content.js');
const seed = JSON.parse(readFileSync(new URL('../content.json', import.meta.url), 'utf8'));

const IMG = { src: 'media/2026/img-ab12cd34.webp', thumb: 'media/2026/img-ab12cd34-480.webp', w: 1200, h: 1500, alt: 'x' };

test('schema 1 content still works (hub lists empty)', () => {
  const v1 = { ...seed, schema: 1 };
  delete v1.news;
  const c = sanitizeContent(v1);
  assert.deepEqual([c.sessions, c.news, c.games, c.notifications], [[], [], [], []]);
  assert.equal(c.featured.length, 1);
});

test('images must be this site\'s media files', () => {
  const c = sanitizeContent({
    ...seed,
    news: [
      { id: 'a', title: 'a', image: { ...IMG, src: 'https://evil.example/x.webp' } },
      { id: 'b', title: 'b', image: { ...IMG, src: '../../secret.webp' } },
      { id: 'c', title: 'c', image: { ...IMG, thumb: 'javascript:alert(1)' } },
      { id: 'd', title: 'd', image: { ...IMG, w: 0 } }
    ]
  });
  assert.equal(c.news[0].image, null);
  assert.equal(c.news[1].image, null);
  assert.equal(c.news[2].image.thumb, IMG.src, 'bad thumb falls back to the main image');
  assert.equal(c.news[3].image, null);
});

test('notification targets and game links are allowlisted', () => {
  const c = sanitizeContent({
    ...seed,
    notifications: [
      { id: 'n1', title: 't', publishAt: '2026-10-08T20:00', target: { kind: 'url', url: 'javascript:alert(1)' } },
      { id: 'n2', title: 't', publishAt: '2026-10-08T20:00', target: { kind: 'news', id: '"><img>' } },
      { id: 'n3', title: 't', publishAt: '2026-10-08T20:00', target: { kind: 'game', id: 'explore' }, type: 'evil' },
      { id: 'n4', title: 't' }
    ],
    games: [
      { id: 'g', title: 'g', url: 'http://insecure.example', startAt: '2026-10-11T22:00', endAt: '2026-10-11T23:00' },
      { id: 'h', title: 'h', url: 'https://example.org', startAt: '2026-10-11T22:00', endAt: '2026-10-11T23:00' }
    ]
  });
  assert.deepEqual(c.notifications.map(n => n.target), [null, null, { kind: 'game', id: 'explore' }]);
  assert.equal(c.notifications[2].type, 'general');
  assert.deepEqual(c.games.map(g => g.id), ['h']);
});
