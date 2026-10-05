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

const CACHE_KEY = 'athanasios.content.v1';

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;


/* ---------- primitives ---------- */

function text(value, max = 300) {

  return typeof value === 'string' ? value.trim().slice(0, max) : '';

}


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
    endAt: dateTime(raw.endAt)
  };

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
        action: { type: contact.action.type, href }
      };
    })
    .filter(Boolean);

  return {
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

  const raw = await response.json();
  const content = sanitizeContent(raw);

  writeCache(raw);

  return content;

}
