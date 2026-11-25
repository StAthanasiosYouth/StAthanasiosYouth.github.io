/*
 * «خبزنا اليومي» — the page's pure rules (docs/daily-bread/STUDY.md §7.2, progress/W3.md). No DOM, no network.
 *
 * - orderFor is byte-for-byte worker/src/bread/model.js (= the prototype's): FNV-1a of `seed|programId` seeds
 *   mulberry32, Fisher–Yates over 0…n-1. Same seed → the same order on every device and on the server.
 * - The day is the Cairo calendar day. d = days since the program's startsOn; the person's topic n = order[d] + 1.
 * - A late joiner (first seen after the program began) keeps the global d (same topic as the server), but the page
 *   counts their own days: «اليوم ١ من ١٩», and says once «هتشارك في الـ١٩ يوم الباقيين».
 */

export function hash32(text) {
  let h = 2166136261;
  for (const c of text) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function orderFor(seedKey, programId, n) {
  const rnd = mulberry32(hash32(seedKey + '|' + programId));
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ---------- Cairo days ---------- */

const DAY_MS = 86400000;
let cairoFmt = null;
/* 'YYYY-MM-DD' in Cairo for the instant `now` */
export function cairoDay(now = Date.now()) {
  try {
    cairoFmt ||= new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
    return cairoFmt.format(new Date(now));
  }
  catch {
    return new Date(now + 2 * 3600000).toISOString().slice(0, 10);
  }
}
export const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY_MS);
export const dayAdd = (day, k) => new Date(Date.parse(day + 'T00:00:00Z') + k * DAY_MS).toISOString().slice(0, 10);

/* ---------- the index (daily-bread/data/index.json) ---------- */

export const PROGRAM_ID = /^brd-[0-9a-f]{10}$/;
export const SEED = /^[A-Za-z0-9_-]{6,64}$/;

const cleanProgram = p => (p && PROGRAM_ID.test(p.id) && Number.isInteger(p.days) && p.days > 0 && p.days <= 120 && DAY.test(p.startsOn) && DAY.test(p.endsOn)
  ? { id: p.id, name: String(p.name || '').slice(0, 80), days: p.days, startsOn: p.startsOn, endsOn: p.endsOn } : null);

/* index → { live, next, last } for `day`: live = the program on today, next = the one after, last = the newest that ended */
export function programsOn(index, day) {
  const list = (index && Array.isArray(index.programs) ? index.programs : []).map(cleanProgram).filter(Boolean);
  const live = list.filter(p => p.startsOn <= day && day <= p.endsOn).sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1))[0] || null;
  const next = list.filter(p => p.startsOn > day).sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1))[0] || null;
  const last = list.filter(p => p.endsOn < day).sort((a, b) => (a.endsOn < b.endsOn ? 1 : -1))[0] || null;
  return { live, next, last };
}

/*
 * The person's day in program p → { d, n, dayNo, ofDays, late, firstDay }
 *   joined: the Cairo day this device (or account) first opened p, or null (= today)
 */
export function dayOf(p, day, seed, joined = null) {
  const d = dayDiff(day, p.startsOn);
  if (d < 0 || d >= p.days) return null;
  const n = orderFor(seed, p.id, p.days)[d] + 1;
  const from = joined && DAY.test(joined) && joined >= p.startsOn && joined <= day ? joined : day;
  const lateBy = dayDiff(from, p.startsOn);
  const late = lateBy > 0;
  return { d, n, late, dayNo: late ? dayDiff(day, from) + 1 : d + 1, ofDays: late ? p.days - lateBy : p.days, firstDay: from === day, lateBy };
}

/* ---------- words ---------- */

export const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const DAYS_AR = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
/* 'YYYY-MM-DD' → «التلات ١٧ نوفمبر» */
export function dateText(day) {
  const t = new Date(day + 'T12:00:00Z');
  return DAYS_AR[t.getUTCDay()] + ' ' + AR(t.getUTCDate()) + ' ' + MONTHS_AR[t.getUTCMonth()];
}
/* 'HH:MM' (24 h) → ['٨:٠٠', 'ص'] */
export function clock(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const h12 = h % 12 || 12;
  return [AR(h12) + ':' + AR(String(m).padStart(2, '0')), h < 12 ? 'ص' : 'م'];
}
/* a program's name without its «سلسلة «…»» wrapping, for «أهلاً بيك في «…»» */
export const bareName = name => String(name || '').replace(/^سلسلة\s*«/, '').replace(/»$/, '').replace(/^«|»$/g, '');

/* m:ss in Arabic digits */
export const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return AR(Math.floor(s / 60)) + ':' + AR(String(s % 60).padStart(2, '0')); };

/* a fresh random device id (base64url, 16 chars) */
export function newSeed(cryptoObj = globalThis.crypto) {
  const b = new Uint8Array(12);
  cryptoObj.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const TAKLA_URL = /^https:\/\/(www\.)?st-takla\.org\/[^\s<>"'()[\]]*$/;
// the saints registry: a feast's source may be any https page; a picture is St-Takla's or our own copy
export const HTTPS_URL = /^https:\/\/[^\s<>"'()[\]]+$/;
export const SAINT_IMG = /^\/assets\/img\/saints\/[a-z0-9-]+\.(?:webp|jpg|png)$/;
// P4: a saint's album picture from the media library (the card copy, ~60–90 KB)
export const MEDIA_IMG = /^\/media\/\d{4}\/[a-z]{3}-[a-z0-9]{8}\.(?:webp|jpg)$/;

/*
 * W7: the month's feasts file (daily-bread/data/feasts/YYYY-MM.json) → today's feast { name, title, word, url, img } | null.
 * Tied to the Cairo DATE, not to the program day (owner, 2026-11-19). Links and the picture: St-Takla only.
 */
export function feastOn(file, day) {
  if (!file || typeof file !== 'object' || !Array.isArray(file.feasts)) return null;
  const f = file.feasts.find(x => x && x.date === day);
  if (!f) return null;
  const s = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');
  const out = {
    name: s(f.name, 120), title: s(f.title, 160), word: s(f.word, 2000), url: s(f.url, 400), img: s(f.img, 400), praise: s(f.praise, 400),
    praiseTitle: s(f.praiseTitle, 120), praiseText: s(f.praiseText, 1500)
  };
  if (!out.name || !HTTPS_URL.test(out.url)) return null;
  if (out.img && !TAKLA_URL.test(out.img) && !SAINT_IMG.test(out.img) && !MEDIA_IMG.test(out.img)) out.img = '';
  // P4: «صورة تعبيرية» on an AI or painted picture (the file's imgAi, set from the album's type)
  out.imgAi = !!out.img && f.imgAi === true;
  // P5: whose day it is (the registry's id and day): «مناسبات كنيستنا» may stand for it
  out.person = typeof f.person === 'string' && /^[a-z0-9]{1,40}$/.test(f.person) ? f.person : '';
  out.kind = out.person ? s(f.kind, 120) : '';
  if (out.praise && !HTTPS_URL.test(out.praise)) out.praise = '';
  if (!out.praise) out.praiseText = out.praiseTitle = ''; // a praise is shown only with its source
  return out;
}

/* the day file → a safe topic object, or null */
export function cleanTopic(t, programId, n) {
  if (!t || typeof t !== 'object' || t.program !== programId || t.n !== n) return null;
  const s = (v, max) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : '');
  const reading = Array.isArray(t.reading) ? t.reading.slice(0, 10).map(part => ({
    book: s(part && part.book, 40), chapter: Number(part && part.chapter) || 0,
    verses: (Array.isArray(part && part.verses) ? part.verses : []).filter(v => Array.isArray(v) && Number.isInteger(v[0]) && typeof v[1] === 'string').slice(0, 200)
  })).filter(p => p.verses.length) : [];
  const out = { n, title: s(t.title, 80), verseRef: s(t.verseRef, 80), verse: s(t.verse, 1500), verseNote: s(t.verseNote, 80), readingRef: s(t.readingRef, 80), reading, meditation: s(t.meditation, 4000), question: s(t.question, 300) };
  // W7: St-Takla's page the topic came from (the page shows the link only for https://st-takla.org)
  const src = t.source && typeof t.source === 'object' ? { url: s(t.source.url, 400), refs: s(t.source.refs, 200) } : null;
  if (src && TAKLA_URL.test(src.url)) out.source = src;
  return out.title && out.verse && out.reading.length && out.meditation ? out : null;
}
