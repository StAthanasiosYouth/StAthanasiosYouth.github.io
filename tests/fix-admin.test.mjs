// Per-item captions on a scene's gallery (Links.gallery): the stored forms
// (tokens, or JSON when any item has words) read back the same, and the
// site keeps the words as plain text (at most 280, never half an emoji).
//
// Run: cd tools && node --test ../tests/fix-admin.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createWorld } from './fakes/gas.mjs';
// icons.js builds a <template> at import time
globalThis.document = { createElement: () => ({ content: {} }) };
const { caption, sanitizeContent } = await import('../assets/js/content.js');
const seed = JSON.parse(readFileSync(new URL('../content.json', import.meta.url), 'utf8'));

test('gallery cell: the old tokens and the JSON form both read; captions ride along', () => {

  const gs = createWorld().gs;
  // (the .gs code runs in its own realm)
  const plain = value => JSON.parse(JSON.stringify(value));

  assert.deepEqual(plain(gs.galleryEntries_('img-aaaaaaaa, vid-bbbbbbbb@4-9')), [
    { token: 'img-aaaaaaaa', text: '' },
    { token: 'vid-bbbbbbbb@4-9', text: '' }
  ], 'the old form, unchanged');

  const cell = JSON.stringify([{ id: 'img-aaaaaaaa', text: 'موضوع الأحد الجاي 🙏' }, { id: 'vid-bbbbbbbb', start: 37, end: 43, text: 'من أحلى لحظات ألعاب الاجتماع 😂🔥' }, { id: 'img-cccccccc' }]);
  assert.deepEqual(plain(gs.galleryEntries_(cell)), [
    { token: 'img-aaaaaaaa', text: 'موضوع الأحد الجاي 🙏' },
    { token: 'vid-bbbbbbbb@37-43', text: 'من أحلى لحظات ألعاب الاجتماع 😂🔥' },
    { token: 'img-cccccccc', text: '' }
  ]);
  assert.deepEqual(plain(gs.galleryTokens_(cell)), ['img-aaaaaaaa', 'vid-bbbbbbbb@37-43', 'img-cccccccc']);
  assert.equal(plain(gs.galleryEntries_('[not json')).length, 1, 'unreadable: one item that says so, never dropped silently');

  assert.equal(gs.galleryText_('  سطر ١ \r\n\r\n\r\nسطر ٢\t🙂 '), 'سطر ١\n\nسطر ٢ 🙂');
  const long = 'أ'.repeat(279) + '😂';
  assert.equal(gs.galleryTextCut_(long).length, 279, 'never half an emoji');

});

test('the site: a caption is plain text, line breaks kept, at most 280', () => {

  assert.equal(caption('مستنيينكم الساعة 8 🙏\nهاتوا أصحابكم'), 'مستنيينكم الساعة 8 🙏\nهاتوا أصحابكم');
  assert.equal(caption(42), '');
  assert.equal(caption('x'.repeat(400)).length, 280);
  assert.equal(caption('أ'.repeat(279) + '😂').length, 279);
  assert.equal(caption('1\n2\n3\n4\n5\n6\n7\n8\n9').split('\n').length, 7, 'at most six line breaks');

  // a link's gallery keeps each item's words (only when it has some)
  const content = JSON.parse(JSON.stringify(seed));
  const link = content.sections.flatMap(s => s.links || [])[0];
  link.gallery = [
    { type: 'video', src: 'media/2026/vid-bbbbbbbb.mp4', poster: 'media/2026/vid-bbbbbbbb-480.webp', w: 1080, h: 1920, start: 4, end: 9, text: 'لحظة 😂' },
    { src: 'media/2026/img-aaaaaaaa.webp', w: 1080, h: 1350, text: '<b>كلام</b>\n\n\n\nتاني' },
    { src: 'media/2026/img-cccccccc.webp', w: 1080, h: 1080 }
  ];
  const shown = sanitizeContent(content).sections.flatMap(s => s.links || []).find(l => l.id === link.id).gallery;
  assert.deepEqual(shown.map(item => item.text), ['لحظة 😂', '<b>كلام</b>\n\n\n\nتاني', undefined]);
  assert.deepEqual([shown[0].start, shown[0].end], [4, 9]);

});
