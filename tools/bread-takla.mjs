#!/usr/bin/env node
/*
 * «خبزنا اليومي» — a month of suggestions from St-Takla.org (W7 part A, docs/daily-bread/progress/W7.md).
 *
 *   node tools/bread-takla.mjs --month 2026-12 [--out suggest/2026-12.json] [--cache .takla-cache]
 *
 * Two parts, because one is tied to a date and the other is not (owner, 2026-11-19):
 *   days   — the program's topics, day 1…N of the program, never tied to a date. Each day has three options from
 *            Pope Shenouda III's «كلمة منفعة» / «مقالات روحية»: the message, and the Bible verse it quotes
 *            (verse + the passage around it, resolved later against Van Dyck by the admin, as the Excel).
 *   feasts — the Cairo DATES of the month on which someone in the fixed saints registry (daily-bread/saints/registry.json)
 *            has a feast (Coptic days turned into Gregorian by code). Who, the picture and the praise come from the
 *            registry; the short word comes from St-Takla's katameros page for that date (its synaxarium), with its link.
 *            The member page shows it on that date only, whatever program day it is.
 *
 * Every text keeps its page link and St-Takla's own links inside the words (their terms, FAQ 043).
 * Polite: one request at a time, a second apart, cached on disk; a page that fails is skipped, never retried in a loop.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from './lib/takla.mjs';
import { BOOKS, parseRef } from '../assets/js/bread/refs.js';
import { loadForFeasts as loadSaints, feastsOfMonth } from './lib/saints.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://st-takla.org/';
const KM = SITE + 'Full-Free-Coptic-Books/His-Holiness-Pope-Shenouda-III-Books-Online/01-Words-of-Spiritual-Benefit_Pope-Shenouda/';
const SP = SITE + 'Full-Free-Coptic-Books/His-Holiness-Pope-Shenouda-III-Books-Online/02-Spiritual-Articles/';
const INDEXES = [1, 2, 3, 4, 5, 6, 7].map(i => KM + '000-Kelmet-Manfa3a_index-0' + i + '.html').concat(SP + '00-Makalat-Rohia-Pope-Shenoda-Third-index.html');
export const katamerosUrl = d => `${SITE}zJ/index.php/ar-readings-katamares?view=reading-arabic&dbl=ar&iday=${d.getUTCDate()}&imonth=${d.getUTCMonth() + 1}&iyear=${d.getUTCFullYear()}`;
const MED_MAX = 700;
const FEAST_MAX = 450;
const OPTIONS = 3;
const UA = 'Mozilla/5.0 (compatible; daily-reading-fetcher/1.0)';

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const ar = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let last = 0;
async function get(url, cache) {
  const file = path.join(cache, url.replace(/^https:\/\//, '').replace(/[^\w.-]+/g, '_').slice(-180));
  if (fs.existsSync(file)) return T.decode(fs.readFileSync(file));
  const wait = 1000 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    if (!r.ok) { console.warn('skip', r.status, url); return null; }
    const bytes = new Uint8Array(await r.arrayBuffer());
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(file, bytes);
    return T.decode(bytes);
  } catch (e) { console.warn('skip', e.message, url); return null; }
}

/* the same order every run: a fixed shuffle of the pool, so a month never depends on what ran before */
function shuffle(list, seed) {
  const a = list.slice();
  let x = seed >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const bookName = code => { const b = BOOKS.find(x => x[0] === code); return b[0] === 'PSA' ? 'مزمور' : b[1]; };

export async function month(ym, { cache, bibleDir = path.join(ROOT, 'assets/bible/vd'), saints = loadSaints() } = {}) {
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const books = fs.readdirSync(bibleDir).filter(f => /^[0-9A-Z]{3}\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(bibleDir, f), 'utf8')));
  const gospels = ['MAT', 'MRK', 'LUK', 'JHN'];
  books.sort((a, b) => gospels.includes(b.id) - gospels.includes(a.id));
  const verses = T.verseIndex(books);
  const chapterLen = (code, ch) => books.find(b => b.id === code).chapters[ch - 1].length;

  // ---- the topics: messages, not tied to a date
  const pool = [];
  for (const u of INDEXES) {
    const html = await get(u, cache);
    if (!html) continue;
    for (const m2 of html.matchAll(/href\s*=\s*"(\d{2,3}-[^"#]+\.html)"/g)) {
      const url = new URL(m2[1], u).href;
      if (!pool.includes(url)) pool.push(url);
    }
  }
  if (!pool.length) throw new Error('no St-Takla pages reachable');
  const order = shuffle(pool.sort(), 20261119);
  let cursor = (Math.round((Date.UTC(y, m - 1, 1) - Date.UTC(2026, 0, 1)) / 864e5) * OPTIONS) % order.length;
  const used = new Set();

  // a written reference «(مت48:5)»: St-Takla writes verse:chapter or chapter:verse, so try both against Van Dyck
  function refHit(refs) {
    for (const r of refs) {
      const m = /\(([^()\d]+?)\s*(\d+)\s*[:：]\s*(\d+)/.exec(r);
      if (!m) continue;
      for (const [ch, v] of [[+m[3], +m[2]], [+m[2], +m[3]]]) {
        const p = parseRef(`${m[1].trim()} ${ch}: ${v}`);
        if (p.ok && books.find(b => b.id === p.book)?.chapters[ch - 1]?.[v - 1]) return { book: p.book, ch, v };
      }
    }
    return null;
  }

  async function nextMessage() {
    for (let tries = 0; tries < 60; tries++) {
      const url = order[cursor % order.length];
      cursor++;
      if (used.has(url)) continue;
      used.add(url);
      const html = await get(url, cache);
      const a = html && T.parseArticle(html, url);
      if (!a || !a.paras.length) continue;
      const hit = T.findVerse(verses, a.quotes) || refHit(a.refs);
      if (!hit) continue;
      const verseRef = `${bookName(hit.book)} ${ar(hit.ch)}: ${ar(hit.v)}`;
      const from = Math.max(1, hit.v - 3), to = Math.min(chapterLen(hit.book, hit.ch), hit.v + 4);
      const readingRef = `${bookName(hit.book)} ${ar(hit.ch)}: ${ar(from)}-${ar(to)}`;
      return { title: a.title.slice(0, 80), verseRef, readingRef, meditation: T.excerpt(a.paras, MED_MAX), sourceUrl: url, sourceRefs: a.book ? 'كتاب «' + a.book + '»' : '' };
    }
    return null;
  }

  const out = [];
  for (let d = 1; d <= days; d++) {
    const options = [];
    for (let i = 0; i < OPTIONS; i++) { const msg = await nextMessage(); if (msg) options.push(msg); }
    out.push({ n: d, pick: 0, options });
    process.stdout.write('.');
  }
  process.stdout.write('\n');

  // ---- the feasts: tied to a Cairo date
  const feasts = [];
  for (const hit of feastsOfMonth(saints, ym)) {
    const date = new Date(hit.date + 'T00:00:00Z');
    const url = katamerosUrl(date);
    // the short word: the synaxarium paragraph whose title the registry wrote down for this day (never a name guess)
    let sec = null;
    if (hit.feast.title) {
      const html = await get(url, cache);
      const k = html && T.parseKatameros(html);
      sec = k && sectionFor(k.saints, hit.feast.title);
    }
    feasts.push(feastEntry(hit, sec, url));
    process.stdout.write('·');
  }
  process.stdout.write('\n');
  return { schema: 2, month: ym, made: new Date().toISOString(), source: SITE, days: out, feasts };
}

/* the synaxarium section of a katameros page whose title is the registry's title (folded; «( 15 بـؤونة)» tails dropped) */
export function sectionFor(sections, title) {
  const key = t => T.fold(String(t).replace(/\(\s*\d+\s*[^)]*\)\s*$/, '')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const want = key(title);
  if (!want) return null;
  return sections.find(s => s.title && key(s.title) === want) || sections.find(s => s.title && (key(s.title).includes(want) || want.includes(key(s.title)))) || null;
}

/*
 * One feast of the month file: who and the picture and praise from the registry; the word from the synaxarium (with
 * St-Takla's link), or the registry's own words for a modern day that is not in the synaxarium (with its source).
 */
export function feastEntry(hit, sec, katUrl) {
  const p = hit.person, f = hit.feast;
  const word = sec ? T.excerpt(sec.paras, FEAST_MAX) : (p.word || p.note || `النهارده ${f.kind} ${p.name}.`);
  return {
    date: hit.date, on: true, id: p.id, name: p.name, kind: f.kind, title: (sec ? sec.title : f.kind + ' ' + p.name).slice(0, 120),
    word, sourceUrl: sec ? katUrl : f.source,
    img: p.image ? '/' + p.image.file : null, imgPage: p.image ? p.image.source : null,
    praise: p.praise ? p.praise.source : null, praiseTitle: p.praise ? p.praise.title || null : null, praiseText: p.praise ? p.praise.text : null,
    others: hit.others
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const ym = arg('month', next.toISOString().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) { console.error('--month YYYY-MM'); process.exit(2); }
  let out = arg('out', path.join(ROOT, 'suggest', ym + '.json'));
  if (/[/]$/.test(out)) out = path.join(out, ym + '.json'); // a folder: the month's file inside it
  const cache = arg('cache', path.join(ROOT, '.takla-cache'));
  const data = await month(ym, { cache });
  const empty = data.days.filter(d => !d.options.length).length;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data) + '\n');
  console.log(`${out}: ${data.days.length} days (${empty} empty), ${data.feasts.length} feasts`);
  if (empty > data.days.length / 2) process.exit(1);
}
