// Rebuilds the Latin subsets of Cairo, smaller than the stock Google Fonts
// "latin" subset (33 KB, which loaded on every first visit).
//
// Why: the page is Arabic. What it really needs from a Latin font is the
// punctuation inside Arabic sentences (. : « » – — …), Western digits (phone
// numbers) and the "QR" of the share button. Accented Latin letters and
// symbols never appear. So:
//
//   cairo-latin.woff2          digits, punctuation, « » × – — ‘ ’ “ ” • …, Q R
//                              (about 12 KB; loads on every visit)
//   cairo-latin-letters.woff2  A-Z a-z (about 12 KB; loads only when a
//                              published text really contains English)
//
// The space (U+0020 / U+00A0) comes from the Arabic files, which contain it
// (main.css: unicode-range of the Arabic faces), so an Arabic sentence never
// pulls in a Latin file just for its spaces. Characters outside every range
// (é, ©, ...) fall back to the system font: still readable.
//
// The files come from the Google Fonts API (`text=` subsetting, same font
// version 3.130 as cairo-arabic.woff2, variable weight 400-800 kept).
// Keep the ranges here and the unicode-range lines in main.css in sync.
//
// Usage: cd tools && node subset-fonts.mjs

import { writeFileSync } from 'node:fs';
import { ROOT } from './lib/gs.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export const SUBSETS = {
  'cairo-latin.woff2': '21-40,51-52,5b-60,7b-7e,ab,bb,d7,2013-2014,2018-2019,201c-201d,2022,2026',
  'cairo-latin-letters.woff2': '41-5a,61-7a'
};

const chars = ranges => String.fromCodePoint(...ranges.split(',').flatMap(range => {
  const [from, to = from] = range.split('-').map(hex => parseInt(hex, 16));
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}));

for (const [file, ranges] of Object.entries(SUBSETS)) {

  const api = `https://fonts.googleapis.com/css2?family=Cairo:wght@400..800&text=${encodeURIComponent(chars(ranges))}`;
  const css = await (await fetch(api, { headers: { 'User-Agent': UA } })).text();
  const url = (css.match(/url\((https:[^)]+)\)/) || [])[1];
  if (!url) throw new Error(`no font in the answer for ${file}:\n${css}`);

  const font = Buffer.from(await (await fetch(url)).arrayBuffer());
  if (font.toString('latin1', 0, 4) !== 'wOF2') throw new Error(`${file}: not a woff2 file`);

  writeFileSync(`${ROOT}assets/fonts/${file}`, font);
  console.log(`${file}: ${(font.length / 1024).toFixed(1)} KB  (${css.match(/unicode-range: ([^;]+)/)[1]})`);

}
