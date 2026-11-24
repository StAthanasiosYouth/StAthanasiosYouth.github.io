// «خبزنا اليومي» P4 — the saints' pictures on the member side and in the monthly suggestion: a media library picture is
// accepted on the feast card, «صورة تعبيرية» only when the file says so, the album's picture of the day in the
// St-Takla suggestion, one lazy picture on the card, the label styled in bread.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feastOn } from '../assets/js/bread/model.js';
import { feastEntry } from '../tools/bread-takla.mjs';

const base = { date: '2026-12-04', name: 'أبي سيفين', title: 't', word: 'w', url: 'https://st-takla.org/k' };

test('feast card: a media library picture is kept, with «صورة تعبيرية» only when imgAi is true', () => {
  const ai = feastOn({ feasts: [{ ...base, img: '/media/2026/img-0000000a.webp', imgAi: true }] }, '2026-12-04');
  assert.deepEqual([ai.img, ai.imgAi], ['/media/2026/img-0000000a.webp', true]);
  const real = feastOn({ feasts: [{ ...base, img: '/media/2026/img-0000000a.webp' }] }, '2026-12-04');
  assert.equal(real.imgAi, false);
  assert.equal(feastOn({ feasts: [{ ...base, img: '/media/2026/img-0000000a.webp', imgAi: 'true' }] }, '2026-12-04').imgAi, false, 'only a real true');
  assert.equal(feastOn({ feasts: [{ ...base, img: '/media/../x.webp', imgAi: true }] }, '2026-12-04').img, '', 'nothing outside the library');
  assert.equal(feastOn({ feasts: [{ ...base, imgAi: true }] }, '2026-12-04').imgAi, false, 'no picture, no label');
});

test('the monthly suggestion: the album picture of the day first (media library), else the old St-Takla copy', () => {
  const person = { id: 'mercurius', name: 'أبي سيفين', image: { file: 'assets/img/saints/mercurius.webp', source: 'https://x.org/p' }, album: [{ media: 'media/2026/img-0000000a.webp', type: 'ai', main: true }] };
  const hit = { date: '2026-12-04', person, feast: { kind: 'تكريس كنيسته', coptic: '3-25', source: 'https://st-takla.org/s' }, others: [] };
  const e = feastEntry(hit, null, 'https://st-takla.org/k');
  assert.deepEqual([e.img, e.imgAi, e.imgPage], ['/media/2026/img-0000000a.webp', true, null]);
  const old = feastEntry({ ...hit, person: { ...person, album: [] } }, null, 'https://st-takla.org/k');
  assert.deepEqual([old.img, old.imgAi], ['/assets/img/saints/mercurius.webp', false]);
});

test('the card markup: one lazy picture, the label inside the picture frame; bread.css styles it', () => {
  const page = readFileSync(new URL('../assets/js/bread/page.js', import.meta.url), 'utf8');
  assert.match(page, /class="br-feast__img"[^>]*loading="lazy"/);
  assert.match(page, /f\.imgAi \? '<span class="br-feast__ai">صورة تعبيرية<\/span>'/);
  const css = readFileSync(new URL('../assets/css/bread.css', import.meta.url), 'utf8');
  assert.match(css, /\.br-feast__pic \{ position: relative;/);
  assert.match(css, /\.br-feast__ai \{/);
});

test('the admin: «رسم / أيقونة» is a type; AI and painted pictures carry the label; the feasts list shows the 480 copy', () => {
  const sa = readFileSync(new URL('../apps-script/AdminSaints.html', import.meta.url), 'utf8');
  assert.match(sa, /\['art', 'رسم \/ أيقونة'\]/);
  assert.match(sa, /a\.type === 'ai' \|\| a\.type === 'art'/);
  const br = readFileSync(new URL('../apps-script/AdminBread.html', import.meta.url), 'utf8');
  assert.match(br, /imgAi: f\.img && f\.imgAi \? true : undefined/);
  assert.match(br, /'-480\.\$1'/);
});
