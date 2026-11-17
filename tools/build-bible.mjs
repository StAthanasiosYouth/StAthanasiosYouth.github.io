// «خبزنا اليومي» W2 — builds the verified Van Dyck text the feature reads from.
//
//   node tools/build-bible.mjs <path/to/arb-vd_usfm.zip> [--date YYYY-MM-DD]
//
// Input: the Arabic Van Dyck USFM zip from eBible.org (Public Domain), https://ebible.org/details.php?id=arb-vd
//        (file https://ebible.org/Scriptures/arb-vd_usfm.zip). Keep the download outside the repo: it is data only.
//        The zip is read in memory (nothing is extracted to disk).
// Output: assets/bible/vd/<BOOK>.json — one file per book of the 66 (decision 5), with tashkeel:
//           { id, name, title, chapters: [[verse 1, verse 2, …], …], titles?: { "<psalm>": "…" }, letters?: { "<psalm>": { "<verse>": "أ" } } }
//         Psalms keep the Van Dyck (Hebrew) numbering; the Agpeya number comes from agpeyaPsalm() in assets/js/bread/text.js (decision 6).
//         assets/bible/vd/SOURCE.json — where the text came from, the eBible version, and sha256 of the zip, of each USFM file and of each output.
//
// What is kept: verse text, the psalm superscriptions (\d, part of Van Dyck) and the Psalm 119 letters (\qa).
// What is dropped: the \s1 section headings (unvocalised editorial headings added to the source, not Van Dyck text),
//                  the book headers (\toc, \mt) apart from \h, and paragraph markers.
// The build fails on anything unexpected: an unknown marker, a missing book, a chapter count different from refs.js,
// a gap in the verse numbers, or a verse that is empty or carries Latin letters / digits / markup.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOKS } from '../assets/js/bread/refs.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = `${ROOT}assets/bible/vd/`;
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

// ---- a minimal zip reader (stored + deflate), enough for eBible's zips ----
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad zip entry ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`zip entry ${name}: unsupported method ${method}`);
    if (data.length !== usize) throw new Error(`zip entry ${name}: size mismatch`);
    files.set(name, data);
  }
  return files;
}

// ---- USFM → book ----
const IGNORED = new Set(['toc1', 'toc2', 'toc3', 'mt1', 'cl', 'p', 'nb', 'qc', 's1']);
const clean = s => s.replace(/[‎‏﻿]/g, '').replace(/\s+/g, ' ').trim();

export function parseUsfm(text, expect) {
  const book = { id: null, name: expect.name, title: null, chapters: [] };
  const titles = {}, letters = {};
  let verses = null, verse = null, pendingLetter = null, headings = 0;
  const finishVerse = () => {
    if (!verse) return;
    const t = clean(verse.text);
    if (!t) throw new Error(`${book.id} ${book.chapters.length}:${verse.n} is empty`);
    if (/[A-Za-z0-9\\|*]/.test(t)) throw new Error(`${book.id} ${book.chapters.length}:${verse.n} has unexpected characters: ${t.slice(0, 60)}`);
    verses.push(t);
    verse = null;
  };
  // every marker starts a line in these files; a line without a marker continues the current verse
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^\\([a-z]+\d*)(?:\s+(.*))?$/.exec(line.trim());
    if (!m) {
      if (!verse) throw new Error(`${book.id}: text outside a verse: ${line.slice(0, 60)}`);
      verse.text += ' ' + line;
      continue;
    }
    const [, tag, rest = ''] = m;
    if (/\\/.test(rest) && tag !== 'v') throw new Error(`${book.id}: inline marker in \\${tag}: ${rest.slice(0, 60)}`);
    if (tag === 'id') { book.id = rest.trim().split(/\s+/)[0]; continue; }
    if (tag === 'h') { book.title = clean(rest); continue; }
    if (tag === 'c') {
      finishVerse();
      const n = Number(rest.trim());
      if (n !== book.chapters.length + 1) throw new Error(`${book.id}: chapter ${rest} after ${book.chapters.length}`);
      verses = [];
      book.chapters.push(verses);
      continue;
    }
    if (tag === 'v') {
      finishVerse();
      const vm = /^(\d+)\s+(.*)$/.exec(rest);
      if (!vm) throw new Error(`${book.id} ${book.chapters.length}: bad verse line ${line.slice(0, 40)}`);
      if (/\\/.test(vm[2])) throw new Error(`${book.id} ${book.chapters.length}:${vm[1]}: inline marker`);
      const n = Number(vm[1]);
      if (!verses || n !== verses.length + 1) throw new Error(`${book.id} ${book.chapters.length}: verse ${n} after ${verses ? verses.length : 'no chapter'}`);
      verse = { n, text: vm[2] };
      if (pendingLetter) { (letters[book.chapters.length] ||= {})[n] = pendingLetter; pendingLetter = null; }
      continue;
    }
    if (tag === 'd') {
      finishVerse();
      if (!verses || verses.length) throw new Error(`${book.id} ${book.chapters.length}: \\d not at the start of a chapter`);
      // a few psalms (56, 57, 59, 88) carry their superscription on two \d lines: keep both, in order
      const n = book.chapters.length;
      titles[n] = titles[n] ? `${titles[n]} ${clean(rest)}` : clean(rest);
      continue;
    }
    if (tag === 'qa') { finishVerse(); pendingLetter = clean(rest); continue; }
    if (IGNORED.has(tag)) { finishVerse(); if (tag === 's1') headings++; continue; }
    throw new Error(`${book.id}: unknown USFM marker \\${tag}`);
  }
  finishVerse();
  if (book.id !== expect.code) throw new Error(`expected ${expect.code}, the file says ${book.id}`);
  if (book.chapters.length !== expect.chapters) throw new Error(`${book.id}: ${book.chapters.length} chapters, refs.js says ${expect.chapters}`);
  if (Object.keys(titles).length) book.titles = titles;
  if (Object.keys(letters).length) book.letters = letters;
  return { book, headings };
}

// ---- main ----
function main() {
  const args = process.argv.slice(2);
  const zipPath = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--date');
  const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : new Date().toISOString().slice(0, 10);
  if (!zipPath) { console.error('usage: node tools/build-bible.mjs <arb-vd_usfm.zip> [--date YYYY-MM-DD]'); process.exit(2); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) { console.error('--date must be YYYY-MM-DD'); process.exit(2); }

  const zip = readFileSync(zipPath);
  const files = readZip(zip);
  const usfm = [...files.keys()].filter(n => /\.usfm$/i.test(n));
  const byCode = new Map(usfm.map(n => [(/^\d+-([0-9A-Z]{3})/.exec(basename(n)) || [])[1], n]));
  const extra = [...byCode.keys()].filter(c => !BOOKS.some(b => b[0] === c));
  if (extra.length) console.log(`skipped (not in the 66 books, decision 5): ${extra.join(', ')}`);

  const copr = files.get('copr.htm') ? files.get('copr.htm').toString('utf8').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') : '';
  const version = (/HTML generated with Haiola by eBible\.org (.+?) from source files dated (.+?)\s*(?:$|[^\w ])/.exec(copr) || []);
  if (!/Public Domain/.test(copr)) throw new Error('copr.htm does not say Public Domain: stop and check the source');

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const books = {};
  let verses = 0, dropped = 0;
  for (const [code, name, chapters] of BOOKS) {
    const entry = byCode.get(code);
    if (!entry) throw new Error(`missing book ${code} in the zip`);
    const src = files.get(entry);
    const { book, headings } = parseUsfm(src.toString('utf8'), { code, name, chapters });
    const json = JSON.stringify(book) + '\n';
    writeFileSync(`${OUT}${code}.json`, json);
    const count = book.chapters.reduce((a, c) => a + c.length, 0);
    verses += count; dropped += headings;
    books[code] = {
      file: `${code}.json`, bytes: Buffer.byteLength(json), sha256: sha256(json),
      chapters: book.chapters.length, verses: count,
      usfm: { file: basename(entry), sha256: sha256(src) }
    };
  }

  const source = {
    text: 'الكتاب المقدس — ترجمة فاندايك (البستاني–فاندايك)',
    license: 'Public Domain (eBible.org copr.htm)',
    source: {
      page: 'https://ebible.org/details.php?id=arb-vd',
      url: 'https://ebible.org/Scriptures/arb-vd_usfm.zip',
      file: basename(zipPath),
      bytes: zip.length,
      sha256: sha256(zip),
      downloaded: dateArg,
      ebibleGenerated: version[1] || null,
      sourceFilesDated: version[2] || null
    },
    rules: {
      books: '66 books only (decision 5); anything else in the zip is skipped',
      tashkeel: 'kept as in the source; stripTashkeel() in assets/js/bread/text.js hides it (decision 4)',
      psalms: 'Van Dyck (Hebrew) numbering; agpeyaPsalm() in assets/js/bread/text.js gives the Agpeya number (decision 6)',
      kept: 'verse text, psalm superscriptions (titles), Psalm 119 letters (letters)',
      dropped: `section headings (\\s1, ${dropped} of them: editorial, not Van Dyck), book headers apart from \\h, paragraph markers`,
      cleanup: 'whitespace collapsed, bidi marks (U+200E/U+200F) removed; no other change to the text'
    },
    built: { tool: 'tools/build-bible.mjs', books: Object.keys(books).length, verses },
    books
  };
  writeFileSync(`${OUT}SOURCE.json`, JSON.stringify(source, null, 2) + '\n');
  const left = readdirSync(OUT).length;
  console.log(`assets/bible/vd: ${Object.keys(books).length} books, ${verses} verses, ${left} files; zip sha256 ${source.source.sha256}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
