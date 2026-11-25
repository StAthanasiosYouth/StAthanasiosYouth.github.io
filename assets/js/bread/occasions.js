/*
 * «خبزنا اليومي» P5 — «مناسبات كنيستنا» on the member page: the pure rules (docs/daily-bread/saints/P5-PLAN.md).
 * The file is daily-bread/data/occasions.json (the Worker's occasionsFile, published with the saints registry).
 * Same day rule as worker/src/bread/saints.js (isOn), on the site's copy of the Coptic calendar (./coptic.js).
 * No DOM, no network.
 */
import { toCoptic, monthDays, MONTHS } from './coptic.js';

export const MEDIA_IMG = /^\/media\/\d{4}\/[a-z]{3}-[a-z0-9]{8}\.(?:webp|jpg)$/;
const HTTPS = /^https:\/\/[^\s<>"'()[\]]+$/;
const ID = /^[a-z0-9]{1,48}$/;
const TYPES = ['patron', 'family', 'diocese', 'fathers', 'church', 'local'];
const LOOKS = ['pope', 'bishop', 'memorial'];
const s = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');
const day = o => {
  if (o.repeat === 'once' && /^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) return { repeat: 'once', date: o.date };
  if (typeof o.coptic === 'string' && /^\d{1,2}-\d{1,2}$/.test(o.coptic)) return { coptic: o.coptic, year: Number.isInteger(o.year) ? o.year : null };
  if (typeof o.gregorian === 'string' && /^\d{2}-\d{2}$/.test(o.gregorian)) return { gregorian: o.gregorian, year: Number.isInteger(o.year) ? o.year : null };
  return null;
};
const pic = p => (p && MEDIA_IMG.test(p.img || '') ? {
  img: p.img, ai: p.ai === true, caption: s(p.caption, 200),
  crop: p.crop && Number.isFinite(p.crop.x) && Number.isFinite(p.crop.y) ? { x: Math.max(0, Math.min(100, p.crop.x)), y: Math.max(0, Math.min(100, p.crop.y)) } : null
} : null);
const verses = v => (Array.isArray(v) ? v.slice(0, 150).map(x => (Array.isArray(x) ? x.slice(0, 6).map(l => s(l, 200)).filter(Boolean) : [])).filter(x => x.length) : []);
function cleanPatron(p) {
  if (!p || !ID.test(p.id || '')) return null;
  const out = { id: p.id, name: s(p.name, 120), days: (Array.isArray(p.days) ? p.days : []).map(d => { const x = day(d); return x ? { kind: s(d.kind, 120), ...x } : null; }).filter(Boolean) };
  const im = pic(p); if (im) Object.assign(out, { img: im.img, ai: im.ai, crop: im.crop });
  if (p.praise && HTTPS.test(p.praise.source || '')) {
    out.praise = { title: s(p.praise.title, 200), text: s(p.praise.text, 1500), source: p.praise.source, refrain: s(p.praise.refrain, 200), verses: verses(p.praise.verses) };
  }
  return out.name ? out : null;
}

/* the published file → a safe copy, or null */
export function cleanOccasions(file) {
  if (!file || typeof file !== 'object' || !Array.isArray(file.occasions)) return null;
  const occasions = file.occasions.slice(0, 200).map(o => {
    if (!o || !ID.test(o.id || '')) return null;
    const d = day(o);
    const headline = s(o.headline, 160);
    if (!d || !headline) return null;
    return {
      id: o.id, type: TYPES.includes(o.type) ? o.type : 'church', look: LOOKS.includes(o.look) ? o.look : '',
      badge: s(o.badge, 60), headline, who: s(o.who, 240), lead: s(o.lead, 700), names: Array.isArray(o.names) ? o.names.map(n => s(n, 120)).filter(Boolean).slice(0, 6) : [],
      pictures: (Array.isArray(o.pictures) ? o.pictures : []).map(pic).filter(Boolean).slice(0, 12),
      source: HTTPS.test(o.source || '') ? o.source : '', from: Array.isArray(o.from) ? o.from.map(x => s(x, 120)) : null,
      hides: (Array.isArray(o.hides) ? o.hides : []).filter(h => Array.isArray(h) && ID.test(h[0] || '')).map(h => [h[0], s(h[1], 120), s(h[2], 120)]),
      ...d
    };
  }).filter(Boolean);
  const types = file.types && typeof file.types === 'object' ? Object.fromEntries(TYPES.map(t => [t, s(file.types[t], 60)])) : {};
  const patrons = {};
  for (const k of ['patron', 'family']) { const p = cleanPatron(file.patrons && file.patrons[k]); if (p) patrons[k] = p; }
  return { occasions, types, patrons };
}

/* is this day on this Cairo date? (6 النسيء kept on 5 in a year that has only 5; «once»: its own date) */
export function isOn(f, iso) {
  if (f.repeat === 'once') return f.date === iso;
  if (f.gregorian) return f.gregorian === iso.slice(5);
  const [m, d] = f.coptic.split('-').map(Number);
  const c = toCoptic(iso);
  return c.m === m && (c.d === d || (m === 13 && d === 6 && c.d === 5 && monthDays(c.y, 13) === 5));
}
const addDays = (iso, k) => new Date(Date.parse(iso + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
/* the next date (from `from`, inclusive) this day falls on, within a year and a day */
export function nextDate(f, from) {
  for (let k = 0; k < 400; k++) { const iso = addDays(from, k); if (isOn(f, iso)) return iso; }
  return null;
}
/* the occasions of one Cairo date, in the registry's order (the first leads the one card) */
export const occasionsOnDay = (file, iso) => (file ? file.occasions.filter(o => isOn(o, iso)) : []);
/* what is coming, from `from` (inclusive): [{ o, at }] sorted by date */
export const upcoming = (file, from) => (file ? file.occasions.map(o => ({ o, at: o.repeat === 'once' ? (o.date >= from ? o.date : null) : nextDate(o, from) })).filter(x => x.at).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)) : []);

/* «نحب نفكّرك» never repeats a day a card stands for: by the registry's id and day, or (an older file) by the name */
export function feastHidden(feast, list) {
  if (!feast) return false;
  const hides = list.flatMap(o => o.hides);
  return hides.some(([p, k, name]) => (feast.person ? feast.person === p && (!feast.kind || feast.kind === k) : !!name && feast.name === name));
}

/* the anniversary (a day with a year): «الذكرى الـ٣٥» */
export const yearsOf = (o, iso) => (o.year ? +iso.slice(0, 4) - o.year : 0);
/* the Coptic day of a date: «٢٥ هاتور» */
export const copticDay = (iso, ar) => { const c = toCoptic(iso); return `${ar(c.d)} ${MONTHS[c.m - 1]}`; };
/* P5b's hook (reactions and comments, later): one stable key per occasion and year */
export const occasionKey = (o, iso) => `occ:${o.id}:${iso.slice(0, 4)}`;
