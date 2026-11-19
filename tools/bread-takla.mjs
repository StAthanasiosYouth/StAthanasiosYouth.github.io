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
 *   feasts — the Cairo DATES of the month on which a well-known saint or feast falls (St-Takla's katameros page for
 *            that date: its synaxarium). A short word about the saint, a picture from St-Takla's gallery, the link.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://st-takla.org/';
const KM = SITE + 'Full-Free-Coptic-Books/His-Holiness-Pope-Shenouda-III-Books-Online/01-Words-of-Spiritual-Benefit_Pope-Shenouda/';
const SP = SITE + 'Full-Free-Coptic-Books/His-Holiness-Pope-Shenouda-III-Books-Online/02-Spiritual-Articles/';
const INDEXES = [1, 2, 3, 4, 5, 6, 7].map(i => KM + '000-Kelmet-Manfa3a_index-0' + i + '.html').concat(SP + '00-Makalat-Rohia-Pope-Shenoda-Third-index.html');
const GALLERY = ['01-Alef-A-E-I-O', '02-Beh-B-P', '05-Geem', '12-Sein', '13-Shein', '18-Ein', '22-Kaf', '24-Meem', '25-Noun', '27-Yeh']
  .map(x => SITE + 'Gallery/Saints-and-Figures/' + x + '.html').concat(SITE + 'Gallery/Saint-Mary.html', SITE + 'Gallery/Angels-and-Archangels.html');
export const katamerosUrl = d => `${SITE}zJ/index.php/ar-readings-katamares?view=reading-arabic&dbl=ar&iday=${d.getUTCDate()}&imonth=${d.getUTCMonth() + 1}&iyear=${d.getUTCFullYear()}`;
const MED_MAX = 700;
const FEAST_MAX = 450;
const OPTIONS = 3;
const UA = 'Mozilla/5.0 (compatible; daily-reading-fetcher/1.0)';

/*
 * The saints and feasts the youth know (the owner: «عيد حد من القديسين بشكل عام»). `match`: words in the synaxarium
 * title (folded, T.fold); `name`: how the card says it; `pic`: words in St-Takla's gallery album name.
 * The admin can switch any feast off before approving the month.
 */
export const SAINTS = [
  { match: ['مرقوريوس', 'ابي سيفين', 'ابو سيفين'], name: 'الشهيد العظيم أبي سيفين (فيلوباتير مرقوريوس)', pic: ['سيفين', 'مرقوريوس'], album: 'Gallery/Saints-and-Figures/20-Feh/Saint-Philopatir-Markorios.html' },
  { match: ['جاورجيوس', 'جرجس'], name: 'الشهيد العظيم مار جرجس', pic: ['جرجس', 'جاورجيوس'] },
  { match: ['مار مينا', 'مارمينا', 'مينا العجايبي'], name: 'الشهيد مار مينا العجايبي', pic: ['مارمينا', 'مار مينا'] },
  { match: ['مرقس الرسول', 'مرقس الانجيلي', 'مار مرقس', 'مارمرقس'], name: 'مار مرقس الرسول', pic: ['مرقس الرسول'] },
  { match: ['والده الاله', 'العذراء مريم', 'السيده العذراء', 'القديسه مريم العذراء'], name: 'السيدة العذراء مريم', pic: ['العذراء'], album: 'Gallery/Saint-Mary/07-Mother-of-God-Theotokos.html' },
  { match: ['انطونيوس'], name: 'القديس الأنبا أنطونيوس', pic: ['انطونيوس'] },
  { match: ['الانبا بولا', 'بولا اول السواح'], name: 'القديس الأنبا بولا', pic: ['بولا'] },
  { match: ['اثناسيوس الرسولي'], name: 'القديس البابا أثناسيوس الرسولي', pic: ['اثناسيوس'] },
  { match: ['دميانه'], name: 'الشهيدة دميانة', pic: ['دميانه'] },
  { match: ['مارينا'], name: 'الشهيدة مارينا', pic: ['مارينا'] },
  { match: ['ابانوب'], name: 'الشهيد أبانوب', pic: ['ابانوب'] },
  { match: ['موسي الاسود', 'موسي القوي'], name: 'القديس الأنبا موسى الأسود', pic: ['موسي'] },
  { match: ['برسوم العريان'], name: 'القديس الأنبا برسوم العريان', pic: ['برسوم'] },
  { match: ['كيرلس السادس'], name: 'القديس البابا كيرلس السادس', pic: ['كيرلس السادس'] },
  { match: ['تكلا هيمانوت'], name: 'القديس الأنبا تكلا هيمانوت', pic: ['تكلا'] },
  { match: ['يوحنا المعمدان', 'يوحنا السابق'], name: 'القديس يوحنا المعمدان', pic: ['المعمدان'] },
  { match: ['رئيس الملائكه ميخائيل', 'الملاك ميخائيل', 'رئيس الملائكه الجليل ميخائيل'], name: 'رئيس الملائكة ميخائيل', pic: ['ميخائيل'] },
  { match: ['الملاك غبريال', 'رئيس الملائكه غبريال', 'الملاك جبرائيل'], name: 'الملاك غبريال', pic: ['غبريال'] },
  { match: ['بطرس وبولس'], name: 'الرسولين بطرس وبولس', pic: ['بطرس'] },
  { match: ['اسطفانوس', 'استفانوس'], name: 'القديس استفانوس أول الشهداء', pic: ['استفانوس', 'اسطفانوس'] },
  { match: ['الانبا ابرام'], name: 'القديس الأنبا إبرآم', pic: ['ابرام'] },
  { match: ['الانبا شنوده رئيس المتوحدين'], name: 'القديس الأنبا شنودة رئيس المتوحدين', pic: ['شنوده رئيس'] },
  { match: ['الانبا كاراس'], name: 'القديس الأنبا كاراس', pic: ['كاراس'] },
  { match: ['الانبا رويس', 'فريج'], name: 'القديس الأنبا رويس', pic: ['رويس'] },
  { match: ['مكسيموس ودوماديوس'], name: 'القديسين مكسيموس ودوماديوس', pic: ['مكسيموس'] },
  { match: ['يوحنا القصير'], name: 'القديس الأنبا يوحنا القصير', pic: ['يوحنا القصير'] },
  { match: ['الانبا مقار', 'مقاريوس الكبير'], name: 'القديس الأنبا مقار الكبير', pic: ['مقار'] },
  { match: ['الانبا بيشوي'], name: 'القديس الأنبا بيشوي', pic: ['بيشوي'] },
  { match: ['يوليانه', 'بربارة'], name: 'الشهيدة بربارة', pic: ['بربارة'] }
];

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

/* which known saint a synaxarium title names, or null */
export function saintOf(title) {
  const f = ' ' + T.fold(title) + ' ';
  return SAINTS.find(s => s.match.some(w => f.includes(' ' + T.fold(w) + ' '))) || null;
}

/* the gallery albums: [{ words (folded), url }] from St-Takla's saints' letter pages */
async function albums(cache) {
  const out = [];
  for (const u of GALLERY) {
    const html = await get(u, cache);
    if (!html) continue;
    for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*"([^"]+\.html)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const words = T.fold(T.entities(m[2].replace(/<[^>]+>/g, ' ')));
      if (/^صور /.test(words) || words.startsWith('صور')) out.push({ words, url: new URL(T.entities(m[1]), u).href });
    }
  }
  return out;
}

/* the first picture of a saint's album → { img, page } (St-Takla's own file; shown from their site with their link) */
async function pictureOf(saint, list, cache) {
  const album = saint.album ? { url: SITE + saint.album } : list.find(a => saint.pic.some(w => a.words.includes(T.fold(w))));
  if (!album) return null;
  const html = await get(album.url, cache);
  if (!html) return null;
  // the album's pictures (thumbnails; not sub-albums «.album.jpg»), a Coptic icon first
  const thumbs = [...html.matchAll(/<img\b[^>]*class="g-thumbnail"[^>]*>/gi)].map(m => ({
    src: (/src\s*=\s*"([^"]+)"/i.exec(m[0]) || [])[1] || '', alt: (/alt\s*=\s*"([^"]*)"/i.exec(m[0]) || [])[1] || ''
  })).filter(x => /\/Gallery\/var\/thumbs\/.+\.(?:jpe?g|png|webp)(\?|$)/i.test(x.src) && !/\/\.album\./.test(x.src));
  const best = thumbs.find(x => /coptic|أيقونة|ايقونة/i.test(x.alt)) || thumbs[0];
  if (!best) return null;
  const img = new URL(T.entities(best.src).replace('/var/thumbs/', '/var/resizes/').replace(/\?.*$/, ''), album.url).href.replace(/^http:/, 'https:');
  return /^https:\/\/(www\.)?st-takla\.org\//.test(img) ? { img, page: album.url } : null;
}

export async function month(ym, { cache, bibleDir = path.join(ROOT, 'assets/bible/vd') } = {}) {
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
  const gallery = await albums(cache);
  const feasts = [];
  for (let d = 1; d <= days; d++) {
    const date = new Date(Date.UTC(y, m - 1, d));
    const url = katamerosUrl(date);
    const html = await get(url, cache);
    const k = html && T.parseKatameros(html);
    if (!k) continue;
    for (const s of k.saints) {
      const saint = s.title && saintOf(s.title);
      if (!saint) continue;
      const pic = await pictureOf(saint, gallery, cache);
      feasts.push({
        date: date.toISOString().slice(0, 10), on: true, name: saint.name, title: s.title.slice(0, 120),
        word: T.excerpt(s.paras, FEAST_MAX), sourceUrl: url, img: pic ? pic.img : null, imgPage: pic ? pic.page : null
      });
      break; // one feast a day
    }
    process.stdout.write('·');
  }
  process.stdout.write('\n');
  return { schema: 2, month: ym, made: new Date().toISOString(), source: SITE, days: out, feasts };
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
