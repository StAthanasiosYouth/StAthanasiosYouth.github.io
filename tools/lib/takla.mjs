/*
 * «خبزنا اليومي» — St-Takla.org suggestions (W7 part A, docs/daily-bread/progress/W7.md).
 *
 * Pure parsers: no network here (tools/bread-takla.mjs fetches). St-Takla's terms (FAQ 043): the source page is named
 * with its link, and the links inside the copied text stay links. So the text keeps them as [words](https://…).
 *
 *   decode(bytes)               → the page as a string (windows-1256 or utf-8, from its own <meta charset>)
 *   parseArticle(html, url)     → { title, book, paras: [rich text], quotes: [«…» / "…" strings], refs: ['(مت48:5)'] }
 *   parseKatameros(html)        → { psalm: 'مزامير 45 : 14 - 15', gospel: 'متى 25 : 1 - 13', saints: [{ title, paras }] }
 *   excerpt(paras, max)         → the first whole paragraphs that fit in max characters (links count as their words)
 *   verseIndex(books) / findVerse(index, quotes) → the Van Dyck verse a quote comes from, or null
 */

const ENTITIES = { nbsp: ' ', quot: '"', amp: '&', lt: '<', gt: '>', laquo: '«', raquo: '»', uarr: '↑', hellip: '…', ndash: '–', mdash: '—' };

export function decode(bytes) {
  const head = Buffer.from(bytes.slice(0, 4096)).toString('latin1');
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(head);
  let enc = m ? m[1].toLowerCase() : 'utf-8';
  if (enc === 'windows-1252' || enc === 'iso-8859-1') enc = 'utf-8'; // their Joomla pages say 1252 but carry entities / utf-8
  try { return new TextDecoder(enc).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

export const entities = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

const abs = (href, base) => {
  try {
    const u = new URL(entities(href).trim(), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.replace(/^http:/, 'https:') : null;
  } catch { return null; }
};
const space = s => s.replace(/[\s ]+/g, ' ').trim();

/*
 * HTML → paragraphs of plain text with links kept as [words](url). Only links to st-takla.org stay links
 * (their own internal links, FAQ 043 «أ»); anything else becomes its words.
 */
export function rich(html, base) {
  let s = html
    .replace(/<(script|style|table|button)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<span[^>]*class="[^"]*hidable[^"]*"[^>]*>[\s\S]*?<\/span>/gi, ' ') // printed page numbers «ص 12»
    .replace(/<img[^>]*>/gi, ' ')
    .replace(/\s+/g, ' ');
  s = s.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const words = space(entities(inner.replace(/<[^>]+>/g, ' ')));
    const url = abs(href, base);
    if (!words) return ' ';
    return url && /^https:\/\/(www\.)?st-takla\.org\//.test(url) && url.replace(/\/$/, '') !== 'https://st-takla.org' ? `\u0001${words}\u0002${url}\u0003` : ` ${words} `;
  });
  s = s.replace(/<\/(p|div|h\d|li|td|tr)>|<br\s*\/?>/gi, '\u0004').replace(/<[^>]+>/g, ' ');
  s = entities(s);
  return s.split('\u0004').map(space)
    .map(p => p.replace(/\s*\u0001([^\u0002]*)\u0002([^\u0003]*)\u0003\s*/g, ' [$1]($2) ').replace(/ +/g, ' ').trim()
      .replace(/ ([.,،:؛!?؟)…])/g, '$1').replace(/\( /g, '('))
    .filter(p => p && !/^St-Takla\.org Image|صورة في \[?موقع الأنبا تكلا/.test(p));
}

/* the words of a rich text (links → their words) */
export const plain = s => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

const QUOTE = /["“”«»]([^"“”«»]{12,400})["“”«»]/g;

/* an article page («كلمة منفعة», «مقالات روحية»): the text between its <h1> and the «* من قسم» footer */
export function parseArticle(html, url) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!h1) return null;
  const title = space(entities(h1[1].replace(/<[^>]+>/g, ' '))).replace(/^\d+\s*[-–.]\s*/, '');
  const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html);
  const book = h2 ? space(entities(h2[1].replace(/<[^>]+>/g, ' '))).replace(/^كتاب\s+/, '') : '';
  let body = html.slice(h1.index + h1[0].length);
  const end = body.search(/Related_\.jpg|\*\s*من قسم/);
  if (end > 0) body = body.slice(0, end);
  const paras = rich(body, url);
  const text = paras.map(plain).join('\n');
  const quotes = [...text.matchAll(QUOTE)].map(m => m[1].trim());
  const refs = [...text.matchAll(/\(([^()\d]{1,14}?)\s*(\d+)\s*[:：]\s*(\d+)(?:\s*[-–]\s*(\d+))?\)/g)].map(m => m[0]);
  return { title, book, url, paras, quotes, refs };
}

/* St-Takla's Joomla katameros page for one Gregorian day: the liturgy psalm and Gospel, and the day's synaxarium */
export function parseKatameros(html) {
  const lines = rich(html, 'https://st-takla.org/').flatMap(p => p.split('\n')).map(plain);
  const REF = /^(\S+(?:\s\S+)?)\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?$/;
  const after = label => {
    const i = lines.findIndex(l => l === label);
    if (i < 0) return null;
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) if (REF.test(lines[j])) return lines[j];
    return null;
  };
  const saints = [];
  const si = lines.findIndex(l => l === 'السنكسار');
  if (si >= 0) {
    let cur = null;
    for (let j = si + 1; j < lines.length; j++) {
      const l = lines[j];
      if (/^↑|^مزمور القداس$|^إنجيل القداس$/.test(l)) break;
      if (/^في مثل هذا اليوم/.test(l)) {
        const title = lines[j - 1] && lines[j - 1].length <= 90 && !/^\d+-\s*اليوم/.test(lines[j - 1]) ? lines[j - 1] : '';
        if (cur && title && cur.paras[cur.paras.length - 1] === title) cur.paras.pop();
        cur = { title, paras: [l] };
        saints.push(cur);
      } else if (cur) cur.paras.push(l);
    }
  }
  for (const s of saints) s.paras = [s.paras.join(' ').replace(/\s+/g, ' ').trim()];
  return { psalm: after('مزمور القداس'), gospel: after('إنجيل القداس'), saints };
}

/* the first whole paragraphs within max characters; a first paragraph longer than max is cut at a sentence end */
export function excerpt(paras, max = 900) {
  const out = [];
  let size = 0;
  for (const p of paras) {
    const len = plain(p).length + (out.length ? 2 : 0);
    if (size + len > max) {
      if (!out.length) {
        const words = plain(p);
        const cut = Math.max(words.lastIndexOf('.', max), words.lastIndexOf('،', max), words.lastIndexOf('!', max));
        out.push((cut > max / 3 ? words.slice(0, cut + 1) : words.slice(0, max)).trim() + ' …');
      } else out.push('…');
      break;
    }
    out.push(p);
    size += len;
  }
  return out.join('\n\n');
}

/* ---------- finding the verse a quote comes from (Van Dyck, assets/bible/vd) ---------- */

export const fold = s => String(s).replace(/[ً-ْٰـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[^ء-ي\s]/g, ' ').replace(/\s+/g, ' ').trim();

/* books: [{ id, chapters: [[text, …], …] }] (New Testament first, so a Gospel quote wins over a parallel) */
export function verseIndex(books) {
  const all = [];
  for (const b of books) b.chapters.forEach((vs, c) => vs.forEach((t, v) => all.push({ book: b.id, ch: c + 1, v: v + 1, f: ' ' + fold(t) + ' ' })));
  return all;
}

/* the first quote (of at least 3 words) found inside one verse → { book, ch, v } */
export function findVerse(index, quotes) {
  for (const q of quotes) {
    const parts = fold(q).split(/\s*\.\.\.?\s*|\s*…\s*/).map(x => x.trim()).filter(x => x.split(' ').length >= 3);
    for (const part of parts) {
      const key = ' ' + part + ' ';
      const hit = index.find(e => e.f.includes(key));
      if (hit) return { book: hit.book, ch: hit.ch, v: hit.v };
    }
  }
  return null;
}
