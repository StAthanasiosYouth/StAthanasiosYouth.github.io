/**
 * SERVICE PAGES AND EVENTS — pure model (docs/EVENTS.md §17)
 *
 * No DOM, no network, no storage: runs in the browser and in Node (tests).
 *  - the slug rules for top-level pages (/<slug>/) and events (/events/<slug>/)
 *  - sanitizers for page.json, event.json and their withdrawn form
 *  - the home card's button (the label table of §1.2 / §17.7), shared by
 *    items.js (home page) and the /events/ list
 *  - the booking area's arithmetic and its WhatsApp text (§17.6)
 *
 * Every field is checked again here, like content.js does for content.json:
 * media only from this site's media/ folder, links only https, WhatsApp only
 * wa.me. A file that fails returns null and the page says it's unavailable.
 */

import { formatStamp } from '../words.js';

/* the address part of a page or an event: 2–40, no dash at either end */
export const PAGE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;

/* top-level names a service page can never take (Pages.gs PAGE_RESERVED; sw.js has its own copy) */
export const PAGE_RESERVED = [
  'admin', 'assets', 'media', 'points', 'competition', 'events', 'pages', 'privacy', 'terms',
  'review', 'tools', 'docs', 'tests', 'apps-script', 'index', 'preview', 'new', 'card-athanasios'
];

export const EVENT_KINDS = ['trip', 'conference', 'funday'];

export const SECTION_THEMES = ['gold', 'ember', 'azure', 'rose', 'emerald', 'night'];

export const DEFAULT_TEAM_TITLE = 'عايز تنضم لفريق المسرح؟';
export const DEFAULT_MEDIA_CTA = 'شاهد المسرحية كاملة';

export const eventSlug = value => (typeof value === 'string' && PAGE_SLUG.test(value) ? value : '');
export const pageSlug = value => (eventSlug(value) && !PAGE_RESERVED.includes(value) ? value : '');

/* the same-tab address of an internal page, relative to the site root */
export const pageHref = slug => (pageSlug(slug) ? `${slug}/` : '');
export const eventHref = slug => (eventSlug(slug) ? `events/${slug}/` : '');

/* a site path that is a page or an event: /<slug>/ or /events/<slug>/ (sw.js has its own copy) */
export function isEntryPath(pathname) {
  const event = /^\/events\/([^/]+)\/$/.exec(pathname || '');
  if (event) return !!eventSlug(event[1]);
  const page = /^\/([^/]+)\/$/.exec(pathname || '');
  return !!(page && pageSlug(page[1]));
}


/* =========================================================
   PRIMITIVES (the same rules as content.js)
========================================================= */

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/* images and clips are always this site's own published files */
const IMAGE_PATH = /^media\/\d{4}\/img-[a-z0-9]{8}(-480)?\.(webp|jpg)$/;
const VIDEO_PATH = /^media\/\d{4}\/vid-[a-z0-9]{8}\.(mp4|webm)$/;
const POSTER_PATH = /^media\/\d{4}\/vid-[a-z0-9]{8}-480\.(webp|jpg)$/;

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const list = value => (Array.isArray(value) ? value.filter(isObject) : []);

export const stamp = value => (typeof value === 'string' && STAMP.test(value) ? value : '');

/* one line of text */
export function line(value, max) {
  return typeof value === 'string' ? value.replace(/[\0-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).replace(/[\ud800-\udbff]$/, '') : '';
}

/* text with paragraphs (line breaks kept, at most two in a row) */
export function para(value, max) {
  return typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').replace(/[\0-\t\v-\x1f\x7f-\x9f]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max).replace(/[\ud800-\udbff]$/, '')
    : '';
}

const id = value => (typeof value === 'string' && /^[\w-]{1,60}$/.test(value) ? value : '');
const version = value => (typeof value === 'string' && /^[\w.-]{1,40}$/.test(value) ? value : '');
const key = value => (typeof value === 'string' && /^[a-z][a-z0-9_]{1,19}$/.test(value) ? value : '');

function int(value, min, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function size(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 10000 ? Math.round(value) : null;
}

export function safeHttps(value) {
  if (typeof value !== 'string' || value.length > 2000) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return '';
    return url.href;
  }
  catch {
    return '';
  }
}

/* WhatsApp: https://wa.me/<digits> only; withText also allows a prefilled ?text= */
export function waLink(value, { withText = false } = {}) {
  const href = safeHttps(value);
  if (!href) return '';
  const url = new URL(href);
  if (url.hostname !== 'wa.me' || !/^\/\d{8,15}$/.test(url.pathname) || url.hash || url.port) return '';
  if (!url.search) return href;
  if (!withText) return '';
  const params = [...url.searchParams.keys()];
  return params.length === 1 && params[0] === 'text' ? href : '';
}

/* the same Image shape as content.json */
export function cleanImage(raw) {
  if (!isObject(raw) || !IMAGE_PATH.test(raw.src || '')) return null;
  const w = size(raw.w);
  const h = size(raw.h);
  if (w === null || h === null) return null;
  const image = { src: raw.src, thumb: IMAGE_PATH.test(raw.thumb || '') ? raw.thumb : raw.src, w, h, alt: line(raw.alt, 140) };
  if (typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color)) image.color = raw.color;
  return image;
}

/* { type: 'video', src, poster, thumb, w, h, alt, start, end } — end 0 = to the end */
export function cleanVideo(raw) {
  if (!isObject(raw) || !VIDEO_PATH.test(raw.src || '') || !POSTER_PATH.test(raw.poster || '')) return null;
  const w = size(raw.w);
  const h = size(raw.h);
  if (w === null || h === null) return null;
  const seconds = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 600 ? value : 0);
  const start = seconds(raw.start);
  const end = seconds(raw.end);
  return { type: 'video', src: raw.src, poster: raw.poster, thumb: raw.poster, w, h, alt: line(raw.alt, 140), start, end: end > start ? end : 0 };
}

const cleanMedia = raw => (isObject(raw) && raw.type === 'video' ? cleanVideo(raw) : cleanImage(raw));

const theme = value => (SECTION_THEMES.includes(value) ? value : '');


/* =========================================================
   PARTNERS (§12): «بإشراف» a partner, e.g. B.U.G.
========================================================= */

/* a partner's key and its pictures: committed files under assets/img/partners/ only */
export const PARTNER_KEY = /^[a-z]{2,12}$/;
const PARTNER_IMAGE = /^assets\/img\/partners\/[a-z0-9][a-z0-9-]{0,60}\.(webp|png)$/;

export const partnerKey = value => (typeof value === 'string' && PARTNER_KEY.test(value) ? value : '');

function partnerImage(raw, withThumb = false) {
  if (!isObject(raw) || !PARTNER_IMAGE.test(raw.src || '')) return null;
  const w = size(raw.w);
  const h = size(raw.h);
  if (w === null || h === null) return null;
  const image = { src: raw.src, w, h, alt: line(raw.alt, 140) };
  return withThumb ? { src: image.src, thumb: PARTNER_IMAGE.test(raw.thumb || '') ? raw.thumb : raw.src, w, h, alt: image.alt } : image;
}

/**
 * { key, name, short, logo, mark, url } → the same, checked; null when the
 * key, the name or the logo is unusable. The mark (the letters only, for
 * small sizes) is optional: null = the chip shows the words alone.
 */
export function cleanPartner(raw) {
  if (!isObject(raw)) return null;
  const k = partnerKey(raw.key);
  const name = line(raw.name, 80);
  const logo = partnerImage(raw.logo, true);
  if (!k || !name || !logo) return null;
  return { key: k, name, short: line(raw.short, 24) || line(name, 24), logo, mark: partnerImage(raw.mark), url: safeHttps(raw.url) || null };
}

/** content.json `partners`: { <key>: partner } (each entry under its own key) */
export function cleanPartners(raw) {
  const out = {};
  if (!isObject(raw)) return out;
  for (const [k, value] of Object.entries(raw).slice(0, 20)) {
    const partner = cleanPartner(value);
    if (partner && partner.key === k) out[k] = partner;
  }
  return out;
}

function withdrawn(raw) {
  return raw.withdrawn === true ? { withdrawn: true, slug: line(raw.slug, 40) } : null;
}


/* =========================================================
   page.json (§17.5)
========================================================= */

function cleanMediaCard(raw) {
  const cover = cleanImage(raw.cover);
  const title = line(raw.title, 80);
  const clip = cleanVideo(raw.clip);
  const fullUrl = safeHttps(raw.fullUrl) || null;
  if (!cover || !title || !id(raw.id)) return null;
  // a clip card whose clip is missing still works as a link card, if it has one
  const source = raw.source === 'clip' && clip ? 'clip' : fullUrl ? 'link' : '';
  if (!source) return null;
  return {
    id: raw.id,
    title,
    text: line(raw.text, 300),
    duration: line(raw.duration, 10),
    cover,
    source,
    clip: source === 'clip' ? clip : null,
    fullUrl,
    ctaLabel: line(raw.ctaLabel, 30) || DEFAULT_MEDIA_CTA
  };
}

function cleanPerson(raw) {
  const name = line(raw.name, 60);
  if (!name) return null;
  return { id: id(raw.id), name, role: line(raw.role, 40), image: cleanImage(raw.image), wa: waLink(raw.wa, { withText: true }) || null };
}

/** page.json → the page, { withdrawn: true, slug }, or null (unusable) */
export function sanitizePage(raw) {

  if (!isObject(raw) || raw.schema !== 1) return null;

  const gone = withdrawn(raw);
  if (gone) return gone;

  const slug = pageSlug(raw.slug);
  const title = line(raw.title, 60);
  if (!slug || !title) return null;

  const seen = new Set();
  const media = list(raw.media).map(cleanMediaCard).filter(card => card && !seen.has(card.id) && seen.add(card.id)).slice(0, 60);

  let team = null;
  if (isObject(raw.team)) {
    const people = list(raw.team.people).map(cleanPerson).filter(Boolean).slice(0, 6);
    const text = line(raw.team.text, 300);
    if (people.length || text) team = { title: line(raw.team.title, 60) || DEFAULT_TEAM_TITLE, text, people };
  }

  return {
    id: id(raw.id),
    v: version(raw.v),
    slug,
    title,
    tagline: line(raw.tagline, 120),
    description: para(raw.description, 2000),
    theme: theme(raw.theme),
    cover: cleanImage(raw.cover),
    hero: cleanMedia(raw.hero),
    partner: cleanPartner(raw.partner),
    media,
    team,
    publishedAt: stamp(raw.publishedAt)
  };

}


/* =========================================================
   event.json (§17.6)
========================================================= */

const GROUPS = ['adult', 'child', 'companion'];

function cleanCategory(raw) {
  const k = typeof raw.key === 'string' && /^[a-z][a-z0-9_]{1,15}$/.test(raw.key) ? raw.key : '';
  const label = line(raw.label, 30);
  const price = int(raw.price, 0, 200000);
  if (!k || !label || price === null) return null;
  const min = int(raw.min, 0, 50) ?? 0;
  const max = Math.max(min, int(raw.max, 0, 50) ?? min);
  return { key: k, label, group: GROUPS.includes(raw.group) ? raw.group : 'adult', price, seat: raw.seat !== false, min, max, note: line(raw.note, 60) };
}

function cleanBooking(raw) {

  if (!isObject(raw)) return null;

  const pricing = isObject(raw.pricing) ? raw.pricing : {};
  const keys = new Set();
  let categories = list(pricing.categories).map(cleanCategory).filter(c => c && !keys.has(c.key) && keys.add(c.key)).slice(0, 6);
  const mode = pricing.mode === 'group' ? 'group' : 'single';
  if (mode === 'single') categories = categories.slice(0, 1);
  if (!categories.length) return null;

  const methodKeys = new Set();
  const methods = list(raw.methods)
    .map(m => ({ key: key(m.key), label: line(m.label, 24), icon: id(m.icon) }))
    .filter(m => m.key && m.label && !methodKeys.has(m.key) && methodKeys.add(m.key))
    .slice(0, 8);

  const servants = list(raw.servants)
    .map(s => {
      const name = line(s.name, 60);
      if (!name) return null;
      const own = Array.isArray(s.methods) ? [...new Set(s.methods.filter(m => methodKeys.has(m)))] : [];
      return { id: id(s.id), name, role: line(s.role, 40), image: cleanImage(s.image), wa: waLink(s.wa) || null, methods: own };
    })
    .filter(Boolean)
    .slice(0, 12);

  const pay = isObject(raw.payment) ? raw.payment : {};
  const capacity = int(raw.capacity, 1, 100000);

  return {
    // this build has no booking engine: the area is always the servants' WhatsApp (§17)
    online: false,
    opensAt: stamp(raw.opensAt),
    closesAt: stamp(raw.closesAt),
    capacity,
    perBookingMax: int(raw.perBookingMax, 1, 50) ?? 10,
    collectNames: raw.collectNames === true,
    pricing: { mode, categories },
    payment: {
      mode: pay.mode === 'installments' ? 'installments' : 'full',
      minFirst: int(pay.minFirst, 0, 200000) ?? 0,
      finalDueAt: stamp(pay.finalDueAt)
    },
    methods,
    servants
  };

}

/** event.json → the event, { withdrawn: true, slug }, or null (unusable) */
export function sanitizeEvent(raw) {

  if (!isObject(raw) || raw.schema !== 1) return null;

  const gone = withdrawn(raw);
  if (gone) return gone;

  const slug = eventSlug(raw.slug);
  const title = line(raw.title, 80);
  const startAt = stamp(raw.startAt);
  if (!slug || !title || !startAt) return null;

  const endAt = stamp(raw.endAt);
  const place = isObject(raw.location) ? { name: line(raw.location.name, 80), url: safeHttps(raw.location.url) || null } : null;

  return {
    id: id(raw.id),
    v: version(raw.v),
    slug,
    kind: EVENT_KINDS.includes(raw.kind) ? raw.kind : '',
    kindLabel: line(raw.kindLabel, 30),
    title,
    shortTitle: line(raw.shortTitle, 30),
    summary: line(raw.summary, 200),
    body: para(raw.body, 3000),
    theme: theme(raw.theme),
    cover: cleanImage(raw.cover),
    gallery: list(raw.gallery).map(cleanMedia).filter(Boolean).slice(0, 8),
    startAt,
    endAt: endAt > startAt ? endAt : '',
    location: place && place.name ? place : null,
    terms: para(raw.terms, 800),
    partner: cleanPartner(raw.partner),
    booking: cleanBooking(raw.booking),
    publishedAt: stamp(raw.publishedAt)
  };

}

/** the admin preview's data, by kind */
export function sanitizeEntry(kind, raw) {
  if (kind === 'page') return sanitizePage(raw);
  if (kind === 'event') return sanitizeEvent(raw);
  return null;
}


/* =========================================================
   THE HOME CARD'S BUTTON (§1.2, §17.7) — also the /events/ list
========================================================= */

/** before | open | closed: the booking window by Cairo wall time
    ('' opensAt = open from publish; '' closesAt = open until startAt) */
export function bookingPhase(booking, startAt, nowStamp) {
  if (!booking) return '';
  const closesAt = booking.closesAt || startAt || '';
  if (booking.opensAt && nowStamp < booking.opensAt) return 'before';
  if (closesAt && nowStamp > closesAt) return 'closed';
  return 'open';
}

/**
 * The automatic label and chip of a linked card. kind: 'event' | 'page';
 * entry: { booking, startAt } (event) or { watch } (page); the admin's
 * override (ctaLabel) wins over the label, never over the chip.
 * Returns { label, chip, phase }.
 */
export function entryCta(kind, entry, nowStamp, override = '') {

  let label = 'اعرف التفاصيل';
  let chip = '';
  let phase = '';

  if (kind === 'event' && entry && entry.booking) {
    phase = bookingPhase(entry.booking, entry.startAt, nowStamp);
    if (phase === 'open') label = 'احجز الآن';
    else if (phase === 'closed') chip = 'الحجز اتقفل';
    else chip = `الحجز يفتح ${formatStamp(entry.booking.opensAt, { withTime: false })}`;
  }
  else if (kind === 'page' && entry && entry.watch === true) {
    label = 'شاهد';
  }

  return { label: override || label, chip, phase };

}

/** an event's last moment on the site: endAt + 12 h, or startAt + 12 h */
export function eventHideAt(event) {
  const base = stamp(event && event.endAt) || stamp(event && event.startAt);
  if (!base) return '';
  const d = new Date(Date.UTC(+base.slice(0, 4), +base.slice(5, 7) - 1, +base.slice(8, 10), +base.slice(11, 13) + 12, +base.slice(14, 16)));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** the /events/ list: still showing, upcoming and running first (by start), finished last */
export function eventsList(events, nowStamp) {
  const live = (events || []).filter(e => e && e.startAt && nowStamp <= eventHideAt(e));
  const over = e => nowStamp > (e.endAt || e.startAt);
  return live.slice().sort((a, b) => (over(a) - over(b)) || (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
}


/* =========================================================
   BOOKING AREA (§17.6, online: false)
========================================================= */

/** each category's starting count (its minimum) */
export function startCounts(booking) {
  const counts = {};
  for (const c of booking ? booking.pricing.categories : []) counts[c.key] = c.min;
  return counts;
}

export function seatsOf(booking, counts) {
  return booking.pricing.categories.reduce((sum, c) => sum + (c.seat ? counts[c.key] || 0 : 0), 0);
}

export function totalOf(booking, counts) {
  return booking.pricing.categories.reduce((sum, c) => sum + (counts[c.key] || 0) * c.price, 0);
}

/** one step of a category's counter, within its min/max and the seats per booking */
export function stepCount(booking, counts, categoryKey, delta) {
  const c = booking.pricing.categories.find(x => x.key === categoryKey);
  if (!c) return counts;
  const next = Math.min(c.max, Math.max(c.min, (counts[c.key] || 0) + delta));
  if (next === (counts[c.key] || 0)) return counts;
  const out = { ...counts, [c.key]: next };
  if (delta > 0 && c.seat && seatsOf(booking, out) > booking.perBookingMax) return counts;
  return out;
}

export function canStep(booking, counts, categoryKey, delta) {
  return stepCount(booking, counts, categoryKey, delta) !== counts;
}

const arDigits = value => String(value).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

/** 1500 → «١٬٥٠٠ جنيه», 0 → «مجانًا» */
export function money(amount) {
  if (!amount) return 'مجانًا';
  return `${arDigits(String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '٬'))} جنيه`;
}

/** the WhatsApp message to a servant: the event, a request to book, and the counter if it was used */
export function bookingMessage(event, servant, counts = null) {
  const lines = [`سلام يا ${servant.name}، عايز أحجز في «${event.title}».`];
  const booking = event.booking;
  if (counts && booking) {
    for (const c of booking.pricing.categories) {
      const n = counts[c.key] || 0;
      if (n) lines.push(`- ${c.label}: ${arDigits(n)}`);
    }
    lines.push(`الإجمالي: ${money(totalOf(booking, counts))}`);
  }
  return lines.join('\n');
}

/** wa.me/<digits> + ?text= (the servant's link has no query of its own) */
export function waWithText(wa, message) {
  const base = waLink(wa);
  return base ? `${base}?text=${encodeURIComponent(message)}` : '';
}
