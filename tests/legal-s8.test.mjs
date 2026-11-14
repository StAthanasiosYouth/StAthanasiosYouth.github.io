// Site W9 (S8): privacy and terms in the text-page look — the contents strip (one chip per
// numbered section, «English» last), «باختصار» as the lead card, the English summary folded,
// legal.js for the strip and «لفوق». The text itself is untouched (only markup around it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const AR = '٠١٢٣٤٥٦٧٨٩';
const ar = n => String(n).replace(/\d/g, d => AR[d]);

for (const [page, lead, count] of [['privacy', true, 7], ['terms', false, 4]]) {
  test(`${page}: S8 markup`, () => {
    const html = read(`${page}/index.html`);
    assert.match(html, /<html lang="ar" dir="rtl" class="legal-s8">/);
    assert.match(html, /<script src="\.\.\/assets\/js\/legal\.js" defer><\/script>/);
    assert.match(html, /<header class="lbar">/, 'the site bar (wave 1) stays');
    const toc = /<nav class="legal-toc" aria-label="في الصفحة دي">([\s\S]*?)<\/nav>/.exec(html);
    assert.ok(toc, 'contents strip');
    const chips = [...toc[1].matchAll(/<a(?: class="[^"]*")? href="#([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m => [m[1], m[2]]);
    assert.equal(chips.length, count + 1);
    assert.deepEqual(chips.at(-1), ['en', 'English']);
    chips.slice(0, -1).forEach(([id, title], i) => {
      assert.match(html, new RegExp(`<section id="${id}">\\s*<h2><span class="legal-num">${ar(i + 1)}</span>${title}</h2>`), `${id} numbered ${i + 1}`);
    });
    assert.equal(/<section class="legal-lead">\s*<h2>باختصار<\/h2>/.test(html), lead);
    assert.match(html, /<section id="en" class="legal-en" lang="en" dir="ltr">\s*<details>\s*<summary><h2>[^<]+\(English summary\)<\/h2><\/summary>[\s\S]*?<\/details>\s*<\/section>/);
    for (const m of ['title', 'name="description"', 'rel="canonical"']) assert.ok(html.includes(m), m);
  });
}
