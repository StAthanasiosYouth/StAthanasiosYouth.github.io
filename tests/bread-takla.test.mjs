/*
 * «خبزنا اليومي» W7 part A — the St-Takla parsers (tools/lib/takla.mjs) and the member side of a source and a feast.
 * The pages here are small made-up copies of St-Takla's page SHAPES (no text of theirs is kept in the repo).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../tools/lib/takla.mjs';
import { saintOf } from '../tools/bread-takla.mjs';
import { cleanTopic, feastOn } from '../assets/js/bread/model.js';

const enc1256 = s => {
  // windows-1256 for the Arabic letters used below (Node has no encoder for it): via a reverse table of the decoder
  const dec = new TextDecoder('windows-1256');
  const map = new Map();
  for (let b = 0; b < 256; b++) map.set(dec.decode(new Uint8Array([b])), b);
  return new Uint8Array([...s].map(ch => { const b = map.get(ch); if (b === undefined) throw new Error('no byte for ' + ch); return b; }));
};

const ARTICLE = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1256"></head><body>
<h2><a href="index.html">كلمة منفعة - البابا</a></h2>
<h1><a href="https://st-takla.org/"><span>12- عنوان التجربة</span></a></h1>
<p><span class="hidable hidden">ص 11</span>فقرة أولى عن <a href="../../x/God.html">الله</a> والمحبة.</p>
<table><tr><td><img src="pic.jpg" alt="St-Takla.org Image"><p class="caption">St-Takla.org Image: x</p></td></tr></table>
<p>وقال الرب "من وجد نفسه يضيعها، ومن أضاع نفسه من أجلي يجدها" وهذا كلام جميل.</p>
<p>رابط خارجي <a href="https://example.com/a">هنا</a> بس.</p>
<img src="Related_.jpg"><p>* من قسم كلمة: آخر</p></body></html>`;

test('parseArticle: windows-1256, title without its number, the book, St-Takla links kept, others dropped, footer cut', () => {
  const html = T.decode(enc1256(ARTICLE));
  const a = T.parseArticle(html, 'https://st-takla.org/Books/A/B/12-x.html');
  assert.equal(a.title, 'عنوان التجربة');
  assert.equal(a.book, 'كلمة منفعة - البابا');
  assert.equal(a.paras[0], 'فقرة أولى عن [الله](https://st-takla.org/Books/x/God.html) والمحبة.');
  assert.ok(!a.paras.some(p => /ص 11|St-Takla\.org Image|من قسم/.test(p)), 'page numbers, pictures and the footer are gone');
  assert.ok(a.paras.some(p => p === 'رابط خارجي هنا بس.'), 'a link off St-Takla becomes its words');
  assert.deepEqual(a.quotes, ['من وجد نفسه يضيعها، ومن أضاع نفسه من أجلي يجدها']);
});

test('findVerse: a quote found inside one Van Dyck verse (tashkeel and hamza folded); excerpt keeps whole paragraphs', () => {
  const idx = T.verseIndex([{ id: 'MAT', chapters: [[], [], [], [], [], [], [], [], [], ['', 'مَنْ وَجَدَ حَيَاتَهُ يُضِيعُهَا، وَمَنْ أَضَاعَ حَيَاتَهُ مِنْ أَجْلِي يَجِدُهَا']] }]);
  assert.deepEqual(T.findVerse(idx, ['شيء آخر تماما هنا', 'ومن أضاع حياته من أجلي يجدها']), { book: 'MAT', ch: 10, v: 2 });
  assert.equal(T.findVerse(idx, ['لا يوجد هذا الكلام']), null);
  assert.equal(T.excerpt(['أ'.repeat(10), 'ب'.repeat(10), 'ج'.repeat(50)], 30), 'أأأأأأأأأأ\n\nبببببببببب\n\n…');
});

test('parseKatameros: the liturgy psalm and Gospel, and the synaxarium stories with their titles', () => {
  const html = `<div>السنكسار</div><div>اليوم 25 من الشهر المبارك هاتور</div><div>25- اليوم الخامس والعشرون - شهر هاتور</div>
<div>استشهاد القديس مرقوريوس أبى سيفين</div><div>في مثل هذا اليوم استشهد القديس</div><div>وكان شجاعا.</div>
<div>تذكار آخر</div><div>في مثل هذا اليوم أيضا</div><div>&uarr; أعلى الصفحة &uarr;</div>
<div>مزمور القداس</div><div>مزامير 45 : 14 - 15</div><div>إنجيل القداس</div><div>فصل شريف</div><div>متى 25 : 1 - 13</div>`;
  const k = T.parseKatameros(html);
  assert.equal(k.psalm, 'مزامير 45: 14 - 15');
  assert.equal(k.gospel, 'متى 25: 1 - 13');
  assert.deepEqual(k.saints.map(s => s.title), ['استشهاد القديس مرقوريوس أبى سيفين', 'تذكار آخر']);
  assert.equal(k.saints[0].paras[0], 'في مثل هذا اليوم استشهد القديس وكان شجاعا.');
  assert.equal(saintOf(k.saints[0].title).name.startsWith('الشهيد العظيم أبي سيفين'), true);
  assert.equal(saintOf('نياحة القديس هرمينا السائح'), null, 'whole words only: «هرمينا» is not «مار مينا»');
  assert.equal(saintOf('نياحة البابا غبريال السادس'), null, 'a pope named Gabriel is not the archangel');
});

test('member side: a topic keeps a St-Takla source only; a feast shows on its own date with St-Takla links only', () => {
  const day = { program: 'brd-0123456789', n: 3, title: 'ع', verseRef: 'ر', verse: 'ن', readingRef: 'ر', reading: [{ book: 'يوحنا', chapter: 3, verses: [[16, 'ن']] }], meditation: 'م' };
  assert.deepEqual(cleanTopic({ ...day, source: { url: 'https://st-takla.org/a.html', refs: 'كتاب' } }, 'brd-0123456789', 3).source, { url: 'https://st-takla.org/a.html', refs: 'كتاب' });
  assert.equal(cleanTopic({ ...day, source: { url: 'https://evil.example/a' } }, 'brd-0123456789', 3).source, undefined);
  const file = { feasts: [{ date: '2026-12-04', name: 'أبي سيفين', title: 't', word: 'w', url: 'https://st-takla.org/k', img: 'https://evil.example/x.jpg' }] };
  assert.equal(feastOn(file, '2026-12-05'), null);
  const f = feastOn(file, '2026-12-04');
  assert.equal(f.name, 'أبي سيفين');
  assert.equal(f.img, '', 'a picture from anywhere else is dropped');
  assert.equal(feastOn({ feasts: [{ ...file.feasts[0], url: 'https://evil.example/' }] }, '2026-12-04'), null);
});
