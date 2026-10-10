/**
 * CONTENT
 *
 * Loads content.json (published from the admin) and validates it again on
 * the client. The publisher already validated it; this is defence in depth,
 * so a hand-edited or corrupted file still cannot inject a dangerous link.
 *
 * Returning visitors see the last copy from localStorage instantly while the
 * fresh file loads.
 */

import { LINK_ICON_NAMES } from './icons.js';
import { setServerTime } from './schedule.js';

const CACHE_KEY = 'athanasios.content.v1';

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/* images are always this site's own published files */
const MEDIA_PATH = /^media\/\d{4}\/img-[a-z0-9]{8}(-480)?\.(webp|jpg)$/;

/* a scene's video clip and its poster frame (link galleries only) */
const VIDEO_PATH = /^media\/\d{4}\/vid-[a-z0-9]{8}\.(mp4|webm)$/;
const POSTER_PATH = /^media\/\d{4}\/vid-[a-z0-9]{8}-480\.(webp|jpg)$/;

const NOTIFICATION_TYPES = ['general', 'meeting', 'news', 'game', 'important', 'competition', 'activity'];

const SECTION_KINDS = ['meeting', 'featured', 'news', 'games', 'items', 'location', 'links', 'contacts', 'support', 'share'];

const SECTION_THEMES = ['gold', 'ember', 'azure', 'rose', 'emerald', 'night'];

const SURFACES = ['glass', 'dark', 'filled', 'none'];


/* ---------- primitives ---------- */

/* a link-experience key (same rule as platforms.js; the registry itself
   loads with the scenes, not with the page) */
function experienceKey(value) {
  const key = String(value == null ? '' : value).trim().toLowerCase();
  return /^[a-z][a-z0-9-]{0,23}$/.test(key) ? key : '';
}

function text(value, max = 300) {

  return typeof value === 'string' ? value.trim().slice(0, max) : '';

}


/* a scene item's words (Content.gs galleryText_): plain text, 7 lines, 280 */
export const caption = value => (typeof value === 'string'
  ? value.replace(/\r\n?/g, '\n').replace(/[\0-\t\v-\x1f\x7f-\x9f]/g, '').split('\n').slice(0, 7).join('\n').trim().slice(0, 280).replace(/[\ud800-\udbff]$/, '')
  : '');


export function safeHttps(value) {

  if (typeof value !== 'string') {
    return '';
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) {
      return '';
    }
    return url.href;
  }
  catch {
    return '';
  }

}


function safeContactHref(action) {

  if (!action || typeof action.href !== 'string') {
    return '';
  }

  if (action.type === 'call') {
    return /^tel:\+\d{8,15}$/.test(action.href) ? action.href : '';
  }

  if (action.type === 'whatsapp') {
    const href = safeHttps(action.href);
    return href && /^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(href) ? href : '';
  }

  return '';

}


function dateTime(value) {

  return typeof value === 'string' && DATE_TIME.test(value) ? value : '';

}


function number(value, min, max) {

  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;

}


/* ---------- shapes ---------- */

function cleanLink(raw) {

  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const url = safeHttps(raw.url);
  const title = text(raw.title, 60);

  if (!url || !title) {
    return null;
  }

  return {
    id: text(raw.id, 60),
    title,
    subtitle: text(raw.subtitle, 140),
    cta: text(raw.cta, 24),
    url,
    icon: LINK_ICON_NAMES.includes(raw.icon) ? raw.icon : 'link',
    style: raw.style === 'tile' ? 'tile' : 'card',
    badge: text(raw.badge, 16),
    startAt: dateTime(raw.startAt),
    endAt: dateTime(raw.endAt),
    // any registry-shaped key (platforms.js); one the site doesn't know yet
    // still opens the generic scene
    experience: experienceKey(raw.experience) === 'none' ? '' : experienceKey(raw.experience),
    // the scene's own photos and video clips (optional, up to 6)
    gallery: list(raw.gallery).map(item => withText(item.type === 'text' ? { type: 'text' } : item.type === 'video' ? cleanVideo(item) : cleanImage(item), caption(item.text), item.from)).filter(Boolean).slice(0, 12)
  };

}

/* + its words and who says them (chat scenes); words only: { type: 'text', text } */
/* a card's «شكل العرض» (cardlayout.js; '' = auto / as on desktop) */
const display = x => ({ display: /^(compact|side|banner|stack)$/.test(x.display) ? x.display : '', displayMobile: /^(auto|compact|side|banner|stack)$/.test(x.displayMobile) ? x.displayMobile : '' });

const withText = (item, text, from) => (!item || (!item.src && !text) ? null : { ...item, ...(text && { text }), ...(/^(us|them)$/.test(from) && { from }) });


/* { type: 'video', src, poster, w, h, alt, start, end } — end 0 = to the end.
   thumb = the poster, for code that only shows pictures. */
export function cleanVideo(raw) {

  if (!raw || typeof raw !== 'object' || !VIDEO_PATH.test(raw.src || '') || !POSTER_PATH.test(raw.poster || '')) {
    return null;
  }

  const w = number(raw.w, 1, 10000);
  const h = number(raw.h, 1, 10000);

  if (w === null || h === null) {
    return null;
  }

  const start = number(raw.start, 0, 600) || 0;
  const end = number(raw.end, 0, 600) || 0;

  return {
    type: 'video',
    src: raw.src,
    poster: raw.poster,
    thumb: raw.poster,
    w: Math.round(w),
    h: Math.round(h),
    alt: text(raw.alt, 140),
    start,
    end: end > start ? end : 0
  };

}


function cleanImage(raw) {

  if (!raw || typeof raw !== 'object' || !MEDIA_PATH.test(raw.src || '')) {
    return null;
  }

  const w = number(raw.w, 1, 10000);
  const h = number(raw.h, 1, 10000);

  if (w === null || h === null) {
    return null;
  }

  const image = {
    src: raw.src,
    thumb: MEDIA_PATH.test(raw.thumb || '') ? raw.thumb : raw.src,
    w: Math.round(w),
    h: Math.round(h),
    alt: text(raw.alt, 140)
  };

  // the loading colour, only when the publisher sent a valid one
  if (typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color)) {
    image.color = raw.color;
  }

  return image;

}


const list = value => (Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : []);

const cleanId = value => (typeof value === 'string' && /^[\w-]{1,60}$/.test(value) ? value : '');


/* a meeting's program: stages in order, each after the one before
   (anything out of order or overlapping is dropped); null = none */
function cleanProgram(raw) {

  const stages = [];

  for (const s of list(raw).slice(0, 24)) {
    const stage = { title: text(s.title, 40), start: dateTime(s.start), end: dateTime(s.end) };
    const last = stages[stages.length - 1];
    if (stage.title && stage.start && stage.start < stage.end && (!last || stage.start >= last.end)) stages.push(stage);
  }

  return stages.length ? stages : null;

}


/* sessions, news, games, notifications (schema 2; empty for schema 1) */
function cleanHub(raw) {

  const sessions = list(raw.sessions)
    .filter(s => DATE.test(s.date || ''))
    .map(s => ({
      date: s.date,
      time: /^\d{2}:\d{2}$/.test(s.time || '') ? s.time : '',
      topic: text(s.topic, 80),
      speaker: text(s.speaker, 60),
      description: text(s.description, 600),
      image: cleanImage(s.image),
      status: s.status === 'cancelled' ? 'cancelled' : 'normal',
      note: text(s.note, 200),
      visibleFrom: dateTime(s.visibleFrom),
      durationMinutes: number(s.durationMinutes, 15, 600),
      program: cleanProgram(s.program)
    }));

  const news = list(raw.news)
    .map(n => {
      const link = n.link && safeHttps(n.link.url);
      return {
        id: cleanId(n.id),
        title: text(n.title, 80),
        summary: text(n.summary, 200),
        body: text(n.body, 1500),
        image: cleanImage(n.image),
        link: link ? { url: link, label: text(n.link.label, 30) || 'التفاصيل' } : null,
        badge: text(n.badge, 16),
        featured: n.featured === true,
        pinned: n.pinned === true,
        tone: ['info', 'alert', 'celebrate'].includes(n.tone) ? n.tone : 'info',
        publishAt: dateTime(n.publishAt),
        expireAt: dateTime(n.expireAt),
        ...display(n)
      };
    })
    .filter(n => n.id && n.title);

  const games = list(raw.games)
    .map(g => ({
      id: cleanId(g.id),
      title: text(g.title, 60),
      description: text(g.description, 300),
      image: cleanImage(g.image),
      url: safeHttps(g.url),
      buttonLabel: text(g.buttonLabel, 24),
      visibleFrom: dateTime(g.visibleFrom),
      startAt: dateTime(g.startAt),
      endAt: dateTime(g.endAt),
      afterEnd: g.afterEnd === 'hide' ? 'hide' : 'show',
      endedUntil: dateTime(g.endedUntil),
      ...display(g)
    }))
    .filter(g => g.id && g.title && g.url && g.startAt && g.endAt);

  const notifications = list(raw.notifications)
    .map(n => {
      const t = n.target;
      let target = null;
      if (t && t.kind === 'meeting') target = { kind: 'meeting' };
      else if (t && (t.kind === 'news' || t.kind === 'game' || t.kind === 'activity') && cleanId(t.id)) target = { kind: t.kind, id: t.id };
      else if (t && t.kind === 'url' && safeHttps(t.url)) target = { kind: 'url', url: safeHttps(t.url) };
      return {
        id: cleanId(n.id),
        type: NOTIFICATION_TYPES.includes(n.type) ? n.type : 'general',
        title: text(n.title, 60),
        message: text(n.message, 200),
        target,
        image: cleanImage(n.image),
        publishAt: dateTime(n.publishAt),
        expireAt: dateTime(n.expireAt)
      };
    })
    .filter(n => n.id && n.title && n.publishAt);

  // competitions, trips, plays... and their types (schema 3)
  const types = list(raw.types)
    .map(t => ({
      key: cleanId(t.key),
      label: text(t.label, 30),
      icon: LINK_ICON_NAMES.includes(t.icon) ? t.icon : '',
      theme: SECTION_THEMES.includes(t.theme) ? t.theme : '',
      banner: cleanImage(t.banner)
    }))
    .filter(t => t.key && t.label);

  const typeKeys = new Set(types.map(t => t.key));

  const activities = list(raw.activities)
    .map(a => {
      const url = a.cta && safeHttps(a.cta.url);
      return {
        id: cleanId(a.id),
        type: cleanId(a.type),
        section: typeof a.section === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(a.section) ? a.section : '',
        title: text(a.title, 80),
        subtitle: text(a.subtitle, 140),
        description: text(a.description, 1500),
        image: cleanImage(a.image),
        cta: url ? { label: text(a.cta.label, 24) || 'التفاصيل', url } : null,
        location: text(a.location, 120),
        startAt: dateTime(a.startAt),
        endAt: dateTime(a.endAt),
        visibleFrom: dateTime(a.visibleFrom),
        visibleUntil: dateTime(a.visibleUntil),
        ...display(a)
      };
    })
    .filter(a => a.id && a.title && a.section && typeKeys.has(a.type));

  return { sessions, news, games, notifications, activities, types };

}


export function sanitizeContent(raw) {

  if (!raw || typeof raw !== 'object' || typeof raw.site !== 'object') {
    throw new Error('content.json has an unexpected shape');
  }

  const site = {
    name: text(raw.site.name, 120),
    tagline: text(raw.site.tagline, 140),
    shareText: text(raw.site.shareText, 200)
  };

  let meeting = null;

  if (raw.meeting && typeof raw.meeting === 'object') {
    const day = Number.isInteger(raw.meeting.day) && raw.meeting.day >= 0 && raw.meeting.day <= 6 ? raw.meeting.day : null;
    const time = typeof raw.meeting.time === 'string' && /^\d{2}:\d{2}$/.test(raw.meeting.time) ? raw.meeting.time : '';
    if (day !== null && time) {
      const duration = number(raw.meeting.durationMinutes, 1, 600);
      meeting = {
        title: text(raw.meeting.title, 60) || 'الاجتماع',
        day,
        time,
        durationMinutes: duration === null ? null : Math.round(duration),
        note: text(raw.meeting.note, 200),
        skipDates: Array.isArray(raw.meeting.skipDates) ? raw.meeting.skipDates.filter(d => typeof d === 'string' && DATE.test(d)) : [],
        ics: typeof raw.meeting.ics === 'string' && /^[\w.-]+\.ics$/.test(raw.meeting.ics) ? raw.meeting.ics : ''
      };
    }
  }

  let location = null;

  if (raw.location && typeof raw.location === 'object' && text(raw.location.name)) {
    const lat = number(raw.location.lat, -90, 90);
    const lng = number(raw.location.lng, -180, 180);
    location = {
      name: text(raw.location.name, 60),
      address: text(raw.location.address, 160),
      note: text(raw.location.note, 200),
      mapsUrl: safeHttps(raw.location.mapsUrl),
      directionsUrl: safeHttps(raw.location.directionsUrl),
      lat: lat !== null && lng !== null ? lat : null,
      lng: lat !== null && lng !== null ? lng : null
    };
  }

  let announcement = null;

  if (raw.announcement && typeof raw.announcement === 'object' && text(raw.announcement.text)) {
    const link = raw.announcement.link && safeHttps(raw.announcement.link.url);
    announcement = {
      text: text(raw.announcement.text, 280),
      tone: ['info', 'alert', 'celebrate'].includes(raw.announcement.tone) ? raw.announcement.tone : 'info',
      link: link ? { url: link, label: text(raw.announcement.link.label, 30) || 'التفاصيل' } : null,
      expiresAt: dateTime(raw.announcement.expiresAt)
    };
  }

  const featured = (Array.isArray(raw.featured) ? raw.featured : []).map(cleanLink).filter(Boolean);

  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .filter(section => section && typeof section === 'object')
    .map(section => ({
      key: text(section.key, 32),
      title: text(section.title, 40),
      links: (Array.isArray(section.links) ? section.links : []).map(cleanLink).filter(Boolean)
    }))
    .filter(section => section.links.length);

  const contacts = (Array.isArray(raw.contacts) ? raw.contacts : [])
    .map(contact => {
      if (!contact || typeof contact !== 'object') {
        return null;
      }
      const href = safeContactHref(contact.action);
      const name = text(contact.name, 60);
      if (!href || !name) {
        return null;
      }
      return {
        id: text(contact.id, 60),
        kind: contact.kind === 'support' ? 'support' : 'service',
        name,
        role: text(contact.role, 60),
        description: text(contact.description, 140),
        phoneDisplay: text(contact.phoneDisplay, 24),
        action: { type: contact.action.type, href },
        // the person card (schema 4, optional): avatar and its words
        image: cleanImage(contact.image),
        intro: text(contact.intro, 80),
        reply: text(contact.reply, 200)
      };
    })
    .filter(Boolean);

  // schema 3: the sections in order; null = older content (fixed order)
  const layout = Array.isArray(raw.layout)
    ? list(raw.layout)
      .map(s => ({
        key: typeof s.key === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(s.key) ? s.key : '',
        kind: SECTION_KINDS.includes(s.kind) ? s.kind : '',
        title: text(s.title, 40),
        subtitle: text(s.subtitle, 140),
        icon: LINK_ICON_NAMES.includes(s.icon) ? s.icon : '',
        theme: SECTION_THEMES.includes(s.theme) ? s.theme : '',
        banner: cleanImage(s.banner),
        visibleFrom: dateTime(s.visibleFrom),
        visibleUntil: dateTime(s.visibleUntil),
        // «شكل الخلفية»: everywhere, and phones only ('' = the default look)
        surface: SURFACES.includes(s.surface) ? s.surface : '',
        surfaceMobile: SURFACES.includes(s.surfaceMobile) ? s.surfaceMobile : ''
      }))
      .filter(s => s.key && s.kind)
    : null;

  return {
    ...cleanHub(raw),
    layout,
    revision: text(raw.revision, 40),
    publishedAt: text(raw.publishedAt, 40),
    timezone: text(raw.timezone, 40) || 'Africa/Cairo',
    site,
    meeting,
    location,
    announcement,
    featured,
    sections,
    contacts
  };

}


/* ---------- loading ---------- */

export function readCached() {

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? sanitizeContent(JSON.parse(raw)) : null;
  }
  catch {
    return null;
  }

}


function writeCache(raw) {

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(raw));
  }
  catch {
    // private mode / storage full: the page still works without it
  }

}


/* "no-cache" revalidates with the server every time (cheap 304s), so a
   publish shows up as soon as GitHub Pages has deployed it. */
export async function fetchContent() {

  const response = await fetch('content.json', { cache: 'no-cache' });

  if (!response.ok) {
    throw new Error(`content.json: HTTP ${response.status}`);
  }

  // GitHub Pages' clock corrects a wrong device clock (games, countdowns)
  setServerTime(response.headers.get('Date'));

  const raw = await response.json();
  const content = sanitizeContent(raw);

  writeCache(raw);

  return content;

}
