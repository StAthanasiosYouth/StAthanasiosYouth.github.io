/*
 * «خبزنا اليومي» — the pure rules (docs/daily-bread/STUDY.md §7.2, PLAN.md W3). No database here.
 *
 * - The per-person order is COMPUTED, never stored: orderFor(seed, programId, n) is the prototype's
 *   (docs/daily-bread/prototype/app.js) Fisher–Yates over 0…n-1 with mulberry32 seeded by FNV-1a of
 *   `seed|programId`. The page computes the same thing, so the same seed gives the same order everywhere.
 * - The day: d = Cairo days since the program's starts_on. Person's topic n = order[d] + 1 (topics are 1…days).
 *   A late joiner gets d from today too: the days that passed are not carried over (only the rest).
 * - The seed: the device's random id; an account keeps the device seed it first came with in a program
 *   (bread_members), so signing in mid-program never changes the order or repeats a topic.
 * - At most one program is live on a Cairo day: currentOf. «بعد الحالي» starts the day after the current one ends,
 *   by date, with no cron.
 */

import { cairoText } from '../lib/db.js';

/* ---------- the order (byte-for-byte the prototype's) ---------- */

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

export const DAY_MS = 86400000;
export const cairoDay = (now = Date.now()) => cairoText(now).slice(0, 10);
export const cairoMinute = (now = Date.now()) => { const t = cairoText(now); return Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)); };
export const dayAdd = (day, k) => new Date(Date.parse(day + 'T00:00:00Z') + k * DAY_MS).toISOString().slice(0, 10);
export const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY_MS);
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/* 'HH:MM' ↔ minute of the Cairo day */
export function minuteOf(text) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(text || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export const timeOf = minute => String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');

/* ---------- programs by date ---------- */

/* a program row is live on `day`: scheduled or stopped, with day inside [starts_on, ends_on] */
export const liveOn = (p, day) => !!p && (p.status === 'scheduled' || p.status === 'stopped') && !!p.starts_on && !!p.ends_on && p.starts_on <= day && day <= p.ends_on;

/* rows → the program live today, or null */
export const currentOf = (rows, day) => rows.filter(p => liveOn(p, day)).sort((a, b) => (a.starts_on < b.starts_on ? 1 : -1))[0] || null;

/* rows → the next scheduled program (starts after today), or null */
export const nextOf = (rows, day) => rows.filter(p => p.status === 'scheduled' && p.starts_on && p.starts_on > day).sort((a, b) => (a.starts_on < b.starts_on ? -1 : 1))[0] || null;

/* 0-based day of the program, or null outside it */
export function dayIndex(p, day) {
  if (!liveOn(p, day)) return null;
  const d = dayDiff(day, p.starts_on);
  return d >= 0 && d < p.days ? d : null;
}

/* the days after today until the end (0 on the last day) */
export const daysLeft = (p, day) => dayDiff(p.ends_on, day);

/* the seed's topic today → { d, n } (n is 1-based) | null */
export function topicFor(seed, p, day) {
  const d = dayIndex(p, day);
  if (d === null) return null;
  return { d, n: orderFor(seed, p.id, p.days)[d] + 1 };
}

/* ---------- checks ---------- */

export const SEED = /^[A-Za-z0-9_-]{6,64}$/;
export const PROGRAM_ID = /^brd-[0-9a-f]{10}$/;
export const MAX_DAYS = 120;
// W7: a topic taken from St-Takla.org names its page (their terms, FAQ 043). Only their pages are accepted as a source.
export const TAKLA_URL = /^https:\/\/(www\.)?st-takla\.org\/[^\s<>"'()\[\]]*$/;
// meditation 4000: St-Takla's own links stay inside the words as [words](url) (FAQ 043 «أ»), and the links are long
export const LIMITS = { name: 80, title: 80, ref: 80, verse: 1500, note: 80, meditation: 4000, question: 300, sourceUrl: 400, sourceRefs: 200, book: 40, verseText: 1200, verses: 200, reflection: 1000 };

const str = (v, max, { optional = false } = {}) => {
  if (v == null || v === '') return optional ? { ok: true, value: null } : { ok: false };
  if (typeof v !== 'string') return { ok: false };
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (!s) return optional ? { ok: true, value: null } : { ok: false };
  if (s.length > max) return { ok: false, long: true };
  return { ok: true, value: s };
};

/* { name, days } → { ok, name, days } | { ok: false, errors } */
export function checkProgram(body) {
  const errors = [];
  const name = str(body && body.name, LIMITS.name);
  if (!name.ok) errors.push({ field: 'name', message: name.long ? 'اسم البرنامج طويل.' : 'اكتب اسم البرنامج.' });
  const days = Number(body && body.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) errors.push({ field: 'days', message: 'عدد الأيام من ١ لـ ' + MAX_DAYS + '.' });
  return errors.length ? { ok: false, errors } : { ok: true, name: name.value, days };
}

/*
 * One uploaded day (the browser read the Excel and resolved the Bible text, STUDY §7.1). The Worker never trusts it:
 * shapes, lengths and the day number are checked here. → { ok, topic } | { ok: false, errors }
 */
export function checkTopic(t, days) {
  const errors = [];
  const err = (field, message) => errors.push({ n: t && t.n, field, message });
  if (!t || typeof t !== 'object' || Array.isArray(t)) return { ok: false, errors: [{ field: 'row', message: 'الصف مش مفهوم.' }] };
  const n = Number(t.n);
  if (!Number.isInteger(n) || n < 1 || n > days) err('n', 'رقم اليوم لازم من ١ لـ ' + days + '.');
  const fields = {
    title: str(t.title, LIMITS.title), verseRef: str(t.verseRef, LIMITS.ref), verse: str(t.verse, LIMITS.verse),
    verseNote: str(t.verseNote, LIMITS.note, { optional: true }), readingRef: str(t.readingRef, LIMITS.ref),
    meditation: str(t.meditation, LIMITS.meditation), question: str(t.question, LIMITS.question, { optional: true }),
    sourceUrl: str(t.sourceUrl, LIMITS.sourceUrl, { optional: true }), sourceRefs: str(t.sourceRefs, LIMITS.sourceRefs, { optional: true })
  };
  if (fields.sourceUrl.ok && fields.sourceUrl.value && !TAKLA_URL.test(fields.sourceUrl.value)) fields.sourceUrl = { ok: false, bad: true };
  const names = { title: 'العنوان', verseRef: 'مرجع الآية', verse: 'نص الآية', verseNote: 'ملاحظة الآية', readingRef: 'مرجع القراءة', meditation: 'التأمل', question: 'السؤال', sourceUrl: 'المصدر', sourceRefs: 'مراجع المصدر' };
  for (const [k, v] of Object.entries(fields)) if (!v.ok) err(k, v.long ? names[k] + ': أطول من المسموح.' : v.bad ? names[k] + ': لازم يكون صفحة على st-takla.org.' : names[k] + ': فاضي.');
  const reading = [];
  let verses = 0;
  if (!Array.isArray(t.reading) || !t.reading.length || t.reading.length > 10) err('reading', 'نص القراءة ناقص.');
  else {
    for (const part of t.reading) {
      const book = part && str(part.book, LIMITS.book);
      const chapter = Number(part && part.chapter);
      if (!book || !book.ok || !Number.isInteger(chapter) || chapter < 1 || chapter > 150 || !Array.isArray(part.verses) || !part.verses.length) {
        err('reading', 'جزء من القراءة مش مفهوم.');
        break;
      }
      const list = [];
      for (const v of part.verses) {
        const num = Array.isArray(v) ? Number(v[0]) : NaN;
        const text = Array.isArray(v) ? str(v[1], LIMITS.verseText) : { ok: false };
        if (!Number.isInteger(num) || num < 1 || num > 176 || !text.ok) { err('reading', 'عدد في القراءة مش مفهوم.'); break; }
        list.push([num, text.value]);
      }
      verses += list.length;
      reading.push({ book: book.value, chapter, verses: list });
    }
    if (verses > LIMITS.verses) err('reading', 'القراءة أطول من المسموح.');
  }
  if (errors.length) return { ok: false, errors };
  const v = k => fields[k].value;
  return { ok: true, topic: { n, title: v('title'), verseRef: v('verseRef'), verse: v('verse'), verseNote: v('verseNote'), readingRef: v('readingRef'), reading, meditation: v('meditation'), question: v('question'), sourceUrl: v('sourceUrl'), sourceRefs: v('sourceRefs') } };
}

/* ---------- published files (docs/daily-bread/progress/W3.md «النشر للمخدوم») ---------- */

export const filePath = key => 'daily-bread/data/' + key + '.json';
export const topicKey = (programId, n) => programId + '/' + n;

/* one day's file: the same text on GitHub Pages and from the Worker */
export function topicFile(programId, t) {
  return JSON.stringify({
    schema: 1, program: programId, n: t.n, title: t.title, verseRef: t.verseRef, verse: t.verse, verseNote: t.verseNote || undefined,
    readingRef: t.readingRef, reading: t.reading, meditation: t.meditation, question: t.question || undefined,
    source: t.sourceUrl ? { url: t.sourceUrl, refs: t.sourceRefs || undefined } : undefined
  }) + '\n';
}

/* the index: the live program and the next one, by date (the page picks the one live on its own Cairo day) */
export function indexFile(rows, day) {
  const pick = p => p && { id: p.id, name: p.name, days: p.days, startsOn: p.starts_on, endsOn: p.ends_on };
  const programs = [pick(currentOf(rows, day)), pick(nextOf(rows, day))].filter(Boolean);
  return JSON.stringify({ schema: 1, programs }) + '\n';
}

/*
 * W7: the month's feasts as approved in the admin → { ok, file } | { ok: false, errors }. Tied to Cairo dates.
 * Every link and picture is a St-Takla page (their terms, FAQ 043): name, the synaxarium's words, the source link.
 */
export const FEAST_LIMITS = { name: 120, title: 160, word: 2000, url: 400 };
export function checkFeasts(body) {
  const errors = [];
  const month = body && body.month;
  if (typeof month !== 'string' || !/^20\d\d-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, errors: [{ field: 'month', message: 'الشهر مش مفهوم.' }] };
  const list = body.feasts;
  if (!Array.isArray(list) || list.length > 31) return { ok: false, errors: [{ field: 'feasts', message: 'الأعياد لازم تكون لحد ٣١.' }] };
  const out = [];
  const seen = new Set();
  for (const f of list) {
    const date = f && f.date;
    const err = message => errors.push({ date, message });
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 7) !== month || isNaN(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) { err('التاريخ مش في الشهر.'); continue; }
    if (seen.has(date)) { err('اليوم ده متكرر.'); continue; }
    seen.add(date);
    const name = str(f.name, FEAST_LIMITS.name), title = str(f.title, FEAST_LIMITS.title, { optional: true }), word = str(f.word, FEAST_LIMITS.word);
    const url = str(f.url, FEAST_LIMITS.url), img = str(f.img, FEAST_LIMITS.url, { optional: true }), praise = str(f.praise, FEAST_LIMITS.url, { optional: true });
    if (!name.ok || !word.ok) { err('الاسم أو الكلمة فاضيين أو طوال.'); continue; }
    if (!url.ok || !TAKLA_URL.test(url.value)) { err('رابط المصدر لازم صفحة على st-takla.org.'); continue; }
    if (!img.ok || (img.value && !TAKLA_URL.test(img.value)) || !praise.ok || (praise.value && !TAKLA_URL.test(praise.value))) { err('الصورة والتمجيد لازم من st-takla.org.'); continue; }
    out.push({ date, name: name.value, title: title.ok ? title.value : null, word: word.value, url: url.value, img: img.value || undefined, praise: praise.value || undefined });
  }
  if (errors.length) return { ok: false, errors };
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { ok: true, month, file: JSON.stringify({ schema: 1, month, feasts: out }) + '\n' };
}
