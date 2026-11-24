/*
 * «خبزنا اليومي» — the saints and church people registry: ONE rulebook for the Worker (P3 admin routes, the feasts
 * tab), the tools (tools/lib/saints.mjs adds the file reads) and the tests. Pure: no fs, no D1.
 *
 * Schema 2 (P2, 2026-11-24; P3 additions marked). A person:
 *   class    'reposed' (the «النهارده تذكار…» card) | 'living' («مناسبات كنيستنا» only, never the saints card)
 *   status   'complete' | 'incomplete', with `missing` = the fields still empty ('feasts', 'album'). Computed from the
 *            data (withStatus), never typed by hand. Nobody is removed for missing data: a person without a day stays,
 *            but never reaches the automatic feasts or notifications until a day with its source is added.
 *   feasts   [{ kind, coptic: 'M-D' | gregorian: 'MM-DD', year?, source, more?: [url], title?, note? }] — yearly days
 *   milestones? [{ kind, date | month | year (until?), source | 'owner', status: confirmed|film|conflict|pending, note? }]
 *   sources? [url] · pending? [{ field, need, checked: [url], note? }] · praise? { text, source, title? } · word?
 *   album    [{ src?, media?, type: 'ai' | 'photo', main?, stage?, occasion?, caption?, credit?, crop?: { x, y, z } }]
 *            src = the owner's picture file (P2, internal); media = the site's media library path (P4); crop (P3, owner
 *            2026-11-24): the point kept in view (% of the picture) and the zoom (1–3) for the admin's small frames.
 * Top level `occasions`: church days that are not a person: { id, name, kind?, coptic | gregorian, year?, repeat?:
 * 'yearly' | 'once' (P3), date? (once: 'YYYY-MM-DD'), source, more?, note? }. «مناسبات كنيستنا» only.
 */
import { daysOfMonth, monthDays } from './coptic.js';

export const CLASSES = ['reposed', 'living'];
export const MISSABLE = ['feasts', 'album'];
export const MILESTONE_STATUS = ['confirmed', 'film', 'conflict', 'pending'];
export const OWNER = 'owner';
export const ALBUM_TYPES = ['ai', 'photo'];
export const IMG_DIR = 'assets/img/saints/';
export const ID_RE = /^[a-z0-9]+$/;
export const LIMITS = { name: 120, kind: 120, title: 200, note: 1500, need: 400, praise: 1500, word: 2000, stage: 80, caption: 200, src: 300, album: 40, feasts: 12, milestones: 40, sources: 20, more: 10 };
const URL_RE = /^https:\/\/[^\s<>"']+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MEDIA_RE = /^media\/\d{4}\/[a-z]{3}-[a-z0-9]{8}\.(?:webp|jpg)$/;
const realDate = s => typeof s === 'string' && DATE_RE.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

/* what a person still lacks: the rule status/missing follow */
export function missingOf(p) {
  const out = [];
  if (!Array.isArray(p.feasts) || !p.feasts.length) out.push('feasts');
  if (!Array.isArray(p.album) || !p.album.length) out.push('album');
  return out;
}

/* the person with status/missing computed from its data (P3: the Worker writes them, the admin never types them) */
export function withStatus(p) {
  const missing = missingOf(p);
  return { ...p, status: missing.length ? 'incomplete' : 'complete', missing };
}

/* may this person reach the automatic days (feasts card, occasions, notifications)? Only with a day. */
export const scheduled = p => Array.isArray(p.feasts) && p.feasts.length > 0 && Array.isArray(p.missing) && !p.missing.includes('feasts');

const text = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const optText = (v, max) => v == null || (typeof v === 'string' && v.length <= max);

function checkDay(f, e, { occasion = false } = {}) {
  const who = `«${f && f.kind || (f && f.name) || '?'}»`;
  if (!f || typeof f !== 'object') { e('يوم مش مفهوم.'); return; }
  if (!occasion && !text(f.kind, LIMITS.kind)) e('يوم من غير نوع (kind).');
  if (occasion && f.kind != null && !optText(f.kind, LIMITS.title)) e(`${who}: وصف المناسبة طويل.`);
  if (typeof f.source !== 'string' || !URL_RE.test(f.source)) e(`${who}: المصدر لازم رابط https.`);
  if (f.more != null && (!Array.isArray(f.more) || f.more.length > LIMITS.more)) e(`${who}: المصادر الزيادة لازم قايمة (لحد ${LIMITS.more}).`);
  for (const u of Array.isArray(f.more) ? f.more : []) if (typeof u !== 'string' || !URL_RE.test(u)) e(`${who}: رابط زيادة مش https.`);
  if (!optText(f.title, LIMITS.title) || !optText(f.note, LIMITS.note)) e(`${who}: العنوان أو الملحوظة طويلين.`);
  if (f.year != null && !(Number.isInteger(f.year) && f.year > 0 && f.year < 2100)) e(`${who}: السنة «${f.year}» مش صح.`);
  if (occasion && f.repeat != null && f.repeat !== 'yearly' && f.repeat !== 'once') e(`${who}: التكرار لازم كل سنة أو مرة واحدة.`);
  if (occasion && f.repeat === 'once') {
    // one time: a full date (P3); shown in its own year only
    if (!realDate(f.date)) e(`${who}: المناسبة اللي مرة واحدة لازم ليها تاريخ كامل (YYYY-MM-DD).`);
    if (f.coptic != null || f.gregorian != null) e(`${who}: المرة الواحدة بتاريخها بس.`);
    return;
  }
  if (f.date != null) e(`${who}: التاريخ الكامل للمناسبة اللي مرة واحدة بس.`);
  const c = f.coptic, g = f.gregorian;
  if ((c == null) === (g == null)) { e(`${who}: لازم coptic أو gregorian (واحد بس).`); return; }
  if (c != null) {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(c);
    if (!m || +m[1] < 1 || +m[1] > 13 || +m[2] < 1 || +m[2] > (+m[1] === 13 ? 6 : 30)) e(`${who}: اليوم القبطي «${c}» مش صح.`);
  } else if (typeof g !== 'string' || !/^\d{2}-\d{2}$/.test(g) || !realDate(`2028-${g}`)) e(`${who}: اليوم الميلادي «${g}» مش صح.`);
  else if (f.year != null && g !== '02-29' && !realDate(`${f.year}-${g}`)) e(`${who}: ${f.year}-${g} مش تاريخ.`);
}

function checkAlbumItem(a, e, opts) {
  if (!a || typeof a !== 'object') { e('album: صورة مش مفهومة.'); return; }
  const hasSrc = a.src != null, hasMedia = a.media != null;
  if (!hasSrc && !hasMedia) e('album: الصورة لازم ليها ملف (src) أو صورة من المكتبة (media).');
  if (hasSrc && (typeof a.src !== 'string' || !a.src.trim() || a.src.includes('..') || a.src.length > LIMITS.src)) e('album: src فاضي أو غلط.');
  if (hasMedia && (typeof a.media !== 'string' || !MEDIA_RE.test(a.media))) e('album: الصورة لازم من مكتبة الصور (media/YYYY/…).');
  if (!ALBUM_TYPES.includes(a.type)) e(`album: النوع «${a.type}» لازم ai أو photo.`);
  if (a.main != null && typeof a.main !== 'boolean') e('album: «الأساسية» لازم آه أو لأ.');
  if (!optText(a.stage, LIMITS.stage) || !optText(a.occasion, LIMITS.kind) || !optText(a.caption, LIMITS.caption) || !optText(a.credit, LIMITS.caption)) e('album: المرحلة أو المناسبة أو الوصف طويل.');
  if (a.crop != null) {
    const c = a.crop, n = v => typeof v === 'number' && isFinite(v);
    if (typeof c !== 'object' || !n(c.x) || !n(c.y) || !n(c.z) || c.x < 0 || c.x > 100 || c.y < 0 || c.y > 100 || c.z < 1 || c.z > 3) e('album: ظبط الصورة مش صح (x و y من ٠ لـ ١٠٠، والتكبير من ١ لـ ٣).');
  }
  if (hasSrc && opts.pictureExists && !opts.pictureExists(a.src)) e(`album: الملف «${a.src}» مش موجود في فولدر الصور.`);
}

/* one person's problems, as plain sentences (empty = fine). cats = the categories map. */
export function checkPerson(p, { cats = {}, imageExists = null, pictureExists = null, statusTyped = true } = {}) {
  const errs = [];
  const who = (p && p.id) || '?';
  const e = m => errs.push(`${who}: ${m}`);
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !ID_RE.test(p.id) || p.id.length > 40) { e('id لازم حروف إنجليزي صغيرة وأرقام بس.'); return errs; }
  if (!text(p.name, LIMITS.name)) e('الاسم فاضي أو طويل.');
  if (!cats[p.cat]) e(`المجموعة «${p.cat}» مش في categories.`);
  if (!CLASSES.includes(p.class)) e(`class لازم ${CLASSES.join(' أو ')}.`);
  if (!Array.isArray(p.feasts) || p.feasts.length > LIMITS.feasts) { e(`feasts لازم قايمة (ممكن تبقى فاضية، لحد ${LIMITS.feasts}).`); return errs; }
  for (const f of p.feasts) checkDay(f, e);
  if (statusTyped) {
    const want = missingOf(p);
    if (!Array.isArray(p.missing) || p.missing.join() !== want.join()) e(`missing لازم [${want.join(', ')}].`);
    if (p.status !== (want.length ? 'incomplete' : 'complete')) e(`status لازم «${want.length ? 'incomplete' : 'complete'}».`);
  }
  if (p.milestones != null && (!Array.isArray(p.milestones) || p.milestones.length > LIMITS.milestones)) e('milestones لازم قايمة.');
  for (const m of Array.isArray(p.milestones) ? p.milestones : []) {
    if (!m || !text(m.kind, LIMITS.title)) e('محطة من غير نوع (kind).');
    if (m && m.source === OWNER) { if (m.status !== 'pending') e(`محطة «${m.kind}»: اللي من صاحب المشروع حالتها pending لحد ما يبقى ليها مصدر.`); }
    else if (!m || typeof m.source !== 'string' || !URL_RE.test(m.source)) e(`محطة «${m && m.kind}»: المصدر لازم رابط https.`);
    for (const u of (m && m.more) || []) if (typeof u !== 'string' || !URL_RE.test(u)) e(`محطة «${m.kind}»: رابط زيادة مش https.`);
    if (!MILESTONE_STATUS.includes(m && m.status)) e(`محطة «${m && m.kind}»: status لازم ${MILESTONE_STATUS.join('/')}.`);
    if (m && m.date != null && !realDate(m.date)) e(`محطة «${m.kind}»: التاريخ «${m.date}» مش صح.`);
    if (m && m.month != null && !(/^\d{4}-(0[1-9]|1[0-2])$/.test(m.month))) e(`محطة «${m.kind}»: الشهر «${m.month}» مش صح (YYYY-MM).`);
    if (m && m.year != null && !(Number.isInteger(m.year) && m.year > 0 && m.year < 2100)) e(`محطة «${m.kind}»: السنة مش صح.`);
    if (m && m.until != null && !(Number.isInteger(m.until) && m.until > 0 && m.until < 2100)) e(`محطة «${m.kind}»: «لحد سنة» مش صح.`);
    if (m && [m.date, m.month, m.year].filter(x => x != null).length > 1) e(`محطة «${m.kind}»: date أو month أو year، واحد بس.`);
    if (m && !optText(m.note, LIMITS.note)) e(`محطة «${m.kind}»: الملحوظة طويلة.`);
  }
  if (p.sources != null && (!Array.isArray(p.sources) || p.sources.length > LIMITS.sources)) e('sources لازم قايمة.');
  for (const u of Array.isArray(p.sources) ? p.sources : []) if (typeof u !== 'string' || !URL_RE.test(u)) e('sources: رابط مش https.');
  for (const q of Array.isArray(p.pending) ? p.pending : []) {
    if (!q || !MISSABLE.concat('milestones').includes(q.field) || !text(q.need, LIMITS.need)) e('pending: لازم field و need.');
    for (const u of (q && q.checked) || []) if (typeof u !== 'string' || !URL_RE.test(u)) e('pending: رابط مش https.');
  }
  if (!Array.isArray(p.album) || p.album.length > LIMITS.album) e(`album لازم قايمة (لحد ${LIMITS.album}).`);
  for (const a of Array.isArray(p.album) ? p.album : []) checkAlbumItem(a, e, { pictureExists });
  if (Array.isArray(p.album) && p.album.filter(a => a && a.main).length > 1) e('album: صورة أساسية واحدة بس.');
  if (p.praise != null) {
    const q = p.praise;
    if (!q || !text(q.text, LIMITS.praise)) e('التمجيد: النص فاضي أو طويل (لحد ١٥٠٠ حرف).');
    if (!q || typeof q.source !== 'string' || !URL_RE.test(q.source)) e('التمجيد: المصدر لازم رابط https.');
  }
  if (!optText(p.word, LIMITS.word)) e('الكلمة طويلة.');
  if (p.image != null) {
    const im = p.image;
    if (!im || typeof im.file !== 'string' || !im.file.startsWith(IMG_DIR) || !/\.(webp|jpg|png)$/.test(im.file)) e(`الصورة لازم ملف تحت ${IMG_DIR}.`);
    else if (imageExists && !imageExists(im.file)) e(`الصورة ${im.file} مش موجودة.`);
    if (!im || typeof im.source !== 'string' || !URL_RE.test(im.source)) e('الصورة: مصدرها لازم رابط https.');
    if (!im || !text(im.license, 200)) e('الصورة: الرخصة مش مكتوبة.');
  }
  return errs;
}

export function checkOccasion(o) {
  const errs = [];
  const who = (o && o.id) || '?';
  const e = m => errs.push(`${who}: ${m}`);
  if (!o || typeof o.id !== 'string' || !ID_RE.test(o.id) || o.id.length > 40) { e('id لازم حروف إنجليزي صغيرة وأرقام بس.'); return errs; }
  if (!text(o.name, LIMITS.name)) e('الاسم فاضي.');
  checkDay(o, e, { occasion: true });
  return errs;
}

/* every problem in the registry, as plain sentences (empty = fine) */
export function check(reg, opts = {}) {
  const errs = [];
  if (!reg || reg.schema !== 2 || !Array.isArray(reg.people)) return ['الملف مش بالشكل المتوقع (schema 2, people[]).'];
  const cats = reg.categories || {};
  const ids = new Set();
  for (const p of reg.people) {
    const pe = checkPerson(p, { ...opts, cats });
    errs.push(...pe);
    if (p && typeof p.id === 'string') { if (ids.has(p.id)) errs.push(`${p.id}: id متكرر.`); ids.add(p.id); }
  }
  if (reg.occasions != null && !Array.isArray(reg.occasions)) errs.push('occasions لازم قايمة.');
  for (const o of reg.occasions || []) {
    errs.push(...checkOccasion(o));
    if (o && typeof o.id === 'string') { if (ids.has(o.id)) errs.push(`${o.id}: id متكرر.`); ids.add(o.id); }
  }
  return errs;
}

/* is this day on this calendar day? (6 النسيء in a year that has only 5 → kept on 5 النسيء; «once»: its own date) */
export function isOn(f, day) {
  if (f.repeat === 'once') return f.date === day.date;
  if (f.gregorian) return f.gregorian === day.date.slice(5);
  const [m, d] = f.coptic.split('-').map(Number);
  return day.m === m && (day.d === d || (m === 13 && d === 6 && day.d === 5 && monthDays(day.y, 13) === 5));
}

/*
 * The feasts of a Gregorian month for the «النهارده تذكار…» card: [{ date, coptic, person, feast, others }] — one a
 * day, the first in the registry's order; `others` = the other people that day. Reposed people with a day only.
 */
export function feastsOfMonth(reg, ym) {
  const people = reg.people.filter(p => p.class !== 'living' && scheduled(p));
  const out = [];
  for (const day of daysOfMonth(ym)) {
    const hits = [];
    for (const p of people) {
      const f = p.feasts.find(x => isOn(x, day));
      if (f) hits.push({ person: p, feast: f });
    }
    if (hits.length) out.push({ date: day.date, coptic: { m: day.m, d: day.d }, person: hits[0].person, feast: hits[0].feast, others: hits.slice(1).map(h => h.person.name) });
  }
  return out;
}

/* «مناسبات كنيستنا» of a Gregorian month (P5/P6): living fathers' days and the church's own days, in date order */
export function occasionsOfMonth(reg, ym) {
  const people = reg.people.filter(p => p.class === 'living' && scheduled(p));
  const out = [];
  for (const day of daysOfMonth(ym)) {
    for (const p of people) for (const f of p.feasts) if (isOn(f, day)) out.push({ date: day.date, coptic: { m: day.m, d: day.d }, person: p, occasion: f });
    for (const o of reg.occasions || []) if (isOn(o, day)) out.push({ date: day.date, coptic: { m: day.m, d: day.d }, person: null, occasion: o });
  }
  return out;
}

/*
 * The published file (daily-bread/data/saints.json, P3): what the site and the monthly suggestion need. Never the
 * internal parts: pending and its notes, the owner's file names (album src), picture credits, the biography
 * sources, notes, milestones not yet confirmed. Album pictures only once they are in the media library (P4).
 */
export function publicFile(reg) {
  const day = f => {
    const o = { kind: f.kind };
    if (f.coptic) o.coptic = f.coptic; else if (f.gregorian) o.gregorian = f.gregorian;
    if (f.year != null) o.year = f.year;
    if (f.title) o.title = f.title;
    o.source = f.source;
    return o;
  };
  const people = reg.people.map(p0 => {
    const p = withStatus(p0);
    const o = { id: p.id, name: p.name, cat: p.cat, class: p.class, status: p.status, missing: p.missing, feasts: p.feasts.map(day) };
    const ms = (p.milestones || []).filter(m => m.status === 'confirmed' || m.status === 'film').map(m => {
      const x = { kind: m.kind };
      for (const k of ['date', 'month', 'year', 'until']) if (m[k] != null) x[k] = m[k];
      x.source = m.source;
      return x;
    });
    if (ms.length) o.milestones = ms;
    const album = (p.album || []).filter(a => a.media).map(a => {
      const x = { media: a.media, type: a.type };
      for (const k of ['main', 'stage', 'occasion', 'caption', 'crop']) if (a[k] != null) x[k] = a[k];
      return x;
    });
    if (album.length) o.album = album;
    if (p.praise) o.praise = { text: p.praise.text, source: p.praise.source, ...(p.praise.title ? { title: p.praise.title } : {}) };
    if (p.image) o.image = { file: p.image.file, source: p.image.source };
    if (p.word) o.word = p.word;
    return o;
  });
  const occasions = (reg.occasions || []).map(o => {
    const x = { id: o.id, name: o.name };
    if (o.kind) x.kind = o.kind;
    if (o.repeat === 'once') { x.repeat = 'once'; x.date = o.date; } else { if (o.coptic) x.coptic = o.coptic; else x.gregorian = o.gregorian; if (o.year != null) x.year = o.year; }
    x.source = o.source;
    return x;
  });
  return { schema: 2, categories: reg.categories, people, occasions };
}
