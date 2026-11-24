/*
 * «خبزنا اليومي» — the saints and church people registry (daily-bread/saints/registry.json), read once a month by
 * tools/bread-takla.mjs. No name matching, no search: who, which days, which picture and which praise are written
 * in the file by hand and checked here (owner, 2026-11-19).
 *
 * Schema 2 (P2, 2026-11-24). A person:
 *   class    'reposed' (the «النهارده تذكار…» card) | 'living' («مناسبات كنيستنا» only, never the saints card)
 *   status   'complete' | 'incomplete', with `missing` = the fields still empty ('feasts', 'album').
 *            Nobody is removed for missing data. A person missing 'feasts' stays in the file but never reaches the
 *            automatic feasts or notifications, until a day with its source is added (and status/missing follow).
 *   feasts   [{ kind, coptic: 'M-D' | gregorian: 'MM-DD', year?, source, more?: [url], title?, note? }] — the yearly
 *            days. coptic = 1 توت … 13 النسيء, turned into a Gregorian date by code; gregorian = modern events.
 *   milestones? [{ kind, date: 'YYYY-MM-DD' | month: 'YYYY-MM' | year: YYYY (until?), source, more?, status: confirmed|film|conflict|pending, note? }]
 *            — one-time events of a life (for a timeline), never a yearly feast. source 'owner' (status pending) = told by
 *            the owner, not yet written anywhere.
 *   sources? [url] · pending? [{ field, need, checked: [url], note? }] — what is still to find (the Deep Research list).
 *   album    [{ src, type: 'ai' | 'photo' }] — the owner's picture files (src relative to `picturesRoot`), not yet
 *            imported into the site (P4). `image` stays the site file (assets/img/saints/…) or null.
 * Top level `occasions`: church days that are not a person (e.g. the Red Sea diocese), «مناسبات كنيستنا» only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { daysOfMonth, monthDays } from './coptic.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTRY = path.join(ROOT, 'daily-bread', 'saints', 'registry.json');
export const IMG_DIR = 'assets/img/saints/';
export const CLASSES = ['reposed', 'living'];
export const MISSABLE = ['feasts', 'album'];
export const MILESTONE_STATUS = ['confirmed', 'film', 'conflict', 'pending'];
/* a milestone the owner told us, not yet written anywhere: source 'owner', status 'pending' (never a feast) */
export const OWNER = 'owner';
export const ALBUM_TYPES = ['ai', 'photo'];

export function load(file = REGISTRY) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/* the owner's picture folder, if it is on this machine: in the checkout, or in the main checkout of a worktree */
export function picturesDir(reg, root = ROOT) {
  if (!reg || !reg.picturesRoot) return null;
  const tries = [path.join(root, reg.picturesRoot)];
  const m = /^(.*)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/.exec(root);
  if (m) tries.push(path.join(m[1], reg.picturesRoot));
  return tries.find(d => fs.existsSync(d)) || null;
}

/* what a person still lacks: the rule the file's status/missing must follow */
export function missingOf(p) {
  const out = [];
  if (!Array.isArray(p.feasts) || !p.feasts.length) out.push('feasts');
  if (!Array.isArray(p.album) || !p.album.length) out.push('album');
  return out;
}

/* may this person reach the automatic days (feasts card, occasions, notifications)? Only with a day. */
export const scheduled = p => Array.isArray(p.feasts) && p.feasts.length > 0 && Array.isArray(p.missing) && !p.missing.includes('feasts');

const URL_RE = /^https:\/\/[^\s<>"']+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = s => DATE_RE.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

function checkDay(f, e) {
  if (!f || typeof f.kind !== 'string' || !f.kind.trim()) e('يوم من غير نوع (kind).');
  if (!f || typeof f.source !== 'string' || !URL_RE.test(f.source)) e(`«${f && f.kind}»: المصدر لازم رابط https.`);
  for (const u of (f && f.more) || []) if (typeof u !== 'string' || !URL_RE.test(u)) e(`«${f.kind}»: رابط زيادة مش https.`);
  if (f && f.year != null && !(Number.isInteger(f.year) && f.year > 0 && f.year < 2100)) e(`«${f.kind}»: السنة «${f.year}» مش صح.`);
  const c = f && f.coptic, g = f && f.gregorian;
  if ((c == null) === (g == null)) { e(`«${f && f.kind}»: لازم coptic أو gregorian (واحد بس).`); return; }
  if (c != null) {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(c);
    if (!m || +m[1] < 1 || +m[1] > 13 || +m[2] < 1 || +m[2] > (+m[1] === 13 ? 6 : 30)) e(`«${f.kind}»: اليوم القبطي «${c}» مش صح.`);
  } else if (!/^\d{2}-\d{2}$/.test(g) || !realDate(`2028-${g}`)) e(`«${f.kind}»: اليوم الميلادي «${g}» مش صح.`);
  else if (f.year != null && g !== '02-29' && !realDate(`${f.year}-${g}`)) e(`«${f.kind}»: ${f.year}-${g} مش تاريخ.`);
}

/* every problem in the registry, as plain sentences (empty = fine). With `pictures` (a folder), album files must exist. */
export function check(reg, { root = ROOT, pictures = null } = {}) {
  const errs = [];
  if (!reg || reg.schema !== 2 || !Array.isArray(reg.people)) return ['الملف مش بالشكل المتوقع (schema 2, people[]).'];
  const cats = reg.categories || {};
  const ids = new Set();
  for (const p of reg.people) {
    const who = (p && p.id) || '?';
    const e = m => errs.push(`${who}: ${m}`);
    if (!p || typeof p.id !== 'string' || !/^[a-z0-9]+$/.test(p.id)) { e('id لازم حروف إنجليزي صغيرة وأرقام بس.'); continue; }
    if (ids.has(p.id)) e('id متكرر.');
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 120) e('الاسم فاضي أو طويل.');
    if (!cats[p.cat]) e(`المجموعة «${p.cat}» مش في categories.`);
    if (!CLASSES.includes(p.class)) e(`class لازم ${CLASSES.join(' أو ')}.`);
    if (!Array.isArray(p.feasts)) { e('feasts لازم قايمة (ممكن تبقى فاضية).'); continue; }
    for (const f of p.feasts) checkDay(f, e);
    // status and missing follow the data: a day filled in reaches the automatic days at once
    const want = missingOf(p);
    if (!Array.isArray(p.missing) || p.missing.join() !== want.join()) e(`missing لازم [${want.join(', ')}].`);
    if (p.status !== (want.length ? 'incomplete' : 'complete')) e(`status لازم «${want.length ? 'incomplete' : 'complete'}».`);
    for (const m of p.milestones || []) {
      if (!m || typeof m.kind !== 'string' || !m.kind.trim()) e('محطة من غير نوع (kind).');
      if (m && m.source === OWNER) { if (m.status !== 'pending') e(`محطة «${m.kind}»: اللي من صاحب المشروع حالتها pending لحد ما يبقى ليها مصدر.`); }
      else if (!m || typeof m.source !== 'string' || !URL_RE.test(m.source)) e(`محطة «${m && m.kind}»: المصدر لازم رابط https.`);
      for (const u of (m && m.more) || []) if (typeof u !== 'string' || !URL_RE.test(u)) e(`محطة «${m.kind}»: رابط زيادة مش https.`);
      if (!MILESTONE_STATUS.includes(m && m.status)) e(`محطة «${m && m.kind}»: status لازم ${MILESTONE_STATUS.join('/')}.`);
      if (m && m.date != null && !realDate(m.date)) e(`محطة «${m.kind}»: التاريخ «${m.date}» مش صح.`);
      if (m && m.month != null && !(/^\d{4}-(0[1-9]|1[0-2])$/.test(m.month))) e(`محطة «${m.kind}»: الشهر «${m.month}» مش صح (YYYY-MM).`);
      if (m && [m.date, m.month, m.year].filter(x => x != null).length > 1) e(`محطة «${m.kind}»: date أو month أو year، واحد بس.`);
    }
    for (const u of p.sources || []) if (typeof u !== 'string' || !URL_RE.test(u)) e('sources: رابط مش https.');
    for (const q of p.pending || []) {
      if (!q || !MISSABLE.concat('milestones').includes(q.field) || typeof q.need !== 'string' || !q.need.trim()) e('pending: لازم field و need.');
      for (const u of (q && q.checked) || []) if (typeof u !== 'string' || !URL_RE.test(u)) e('pending: رابط مش https.');
    }
    if (!Array.isArray(p.album)) e('album لازم قايمة.');
    for (const a of p.album || []) {
      if (!a || typeof a.src !== 'string' || !a.src.trim() || a.src.includes('..')) { e('album: src فاضي أو غلط.'); continue; }
      if (!ALBUM_TYPES.includes(a.type)) e(`album: النوع «${a.type}» لازم ai أو photo.`);
      if (pictures && !fs.existsSync(path.join(pictures, a.src))) e(`album: الملف «${a.src}» مش موجود في فولدر الصور.`);
    }
    if (p.praise != null) {
      const q = p.praise;
      if (typeof q.text !== 'string' || !q.text.trim() || q.text.length > 1500) e('التمجيد: النص فاضي أو طويل (لحد ١٥٠٠ حرف).');
      if (typeof q.source !== 'string' || !URL_RE.test(q.source)) e('التمجيد: المصدر لازم رابط https.');
    }
    if (p.image != null) {
      const im = p.image;
      if (typeof im.file !== 'string' || !im.file.startsWith(IMG_DIR) || !/\.(webp|jpg|png)$/.test(im.file)) e(`الصورة لازم ملف تحت ${IMG_DIR}.`);
      else if (!fs.existsSync(path.join(root, im.file))) e(`الصورة ${im.file} مش موجودة.`);
      if (typeof im.source !== 'string' || !URL_RE.test(im.source)) e('الصورة: مصدرها لازم رابط https.');
      if (typeof im.license !== 'string' || !im.license.trim()) e('الصورة: الرخصة مش مكتوبة.');
    }
  }
  if (reg.occasions != null && !Array.isArray(reg.occasions)) errs.push('occasions لازم قايمة.');
  for (const o of reg.occasions || []) {
    const who = (o && o.id) || '?';
    const e = m => errs.push(`${who}: ${m}`);
    if (!o || typeof o.id !== 'string' || !/^[a-z0-9]+$/.test(o.id)) { e('id لازم حروف إنجليزي صغيرة وأرقام بس.'); continue; }
    if (ids.has(o.id)) e('id متكرر.');
    ids.add(o.id);
    if (typeof o.name !== 'string' || !o.name.trim()) e('الاسم فاضي.');
    checkDay(o, e);
  }
  return errs;
}

/* is this yearly day on this calendar day? (6 النسيء in a year that has only 5 → kept on 5 النسيء) */
function isOn(f, day) {
  if (f.gregorian) return f.gregorian === day.date.slice(5);
  const [m, d] = f.coptic.split('-').map(Number);
  return day.m === m && (day.d === d || (m === 13 && d === 6 && day.d === 5 && monthDays(day.y, 13) === 5));
}

/*
 * The feasts of a Gregorian month for the «النهارده تذكار…» card: [{ date, person, feast, others }] — one a day,
 * the first in the registry's order (the owner's order: St Mary and the angels first …); `others` = the other people
 * on that day, for the admin. Reposed people with a day only: never a living father, never a person missing a day.
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

/*
 * «مناسبات كنيستنا» of a Gregorian month (P5/P6 read this): the living fathers' days and the church's own days
 * (`occasions`): [{ date, coptic, person | null, occasion }] — every one, in date order. Only people with a day.
 */
export function occasionsOfMonth(reg, ym) {
  const people = reg.people.filter(p => p.class === 'living' && scheduled(p));
  const out = [];
  for (const day of daysOfMonth(ym)) {
    for (const p of people) for (const f of p.feasts) if (isOn(f, day)) out.push({ date: day.date, coptic: { m: day.m, d: day.d }, person: p, occasion: f });
    for (const o of reg.occasions || []) if (isOn(o, day)) out.push({ date: day.date, coptic: { m: day.m, d: day.d }, person: null, occasion: o });
  }
  return out;
}
