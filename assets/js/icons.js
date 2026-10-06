/**
 * ICONS
 *
 * Service icons: 24px line icons, stroke 1.6, with a soft "duo" fill layer,
 * in the same spirit as صوتك يهمنا. Brand glyphs come from simple-icons.
 *
 * The markup here is static and trusted. Content from content.json only
 * selects an icon by name; unknown names fall back to "link".
 * No inline style attributes (blocked by the page CSP).
 */

import { BRAND_ICONS } from './icons-brand.js';

const LINE_ICONS = {

  voice:
    '<path class="duo" d="M5.5 4h13A2.5 2.5 0 0 1 21 6.5v8a2.5 2.5 0 0 1-2.5 2.5H12l-4.5 3.6V17h-2A2.5 2.5 0 0 1 3 14.5v-8A2.5 2.5 0 0 1 5.5 4Z"/>' +
    '<path class="beat" d="M12 13.8s-3.1-1.9-3.1-4a1.6 1.6 0 0 1 3.1-.7 1.6 1.6 0 0 1 3.1.7c0 2.1-3.1 4-3.1 4Z"/>',

  form:
    '<rect class="duo" x="5" y="4" width="14" height="17" rx="2.5"/>' +
    '<path d="M9 4.2V3.5A1.5 1.5 0 0 1 10.5 2h3A1.5 1.5 0 0 1 15 3.5v.7"/>' +
    '<path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/>',

  calendar:
    '<rect class="duo" x="3.5" y="5" width="17" height="15.5" rx="2.5"/>' +
    '<path d="M3.5 9.5h17M8 3v4M16 3v4"/>' +
    '<path d="M8 13.5h2M14 13.5h2M8 16.5h2"/>',

  'calendar-plus':
    '<rect class="duo" x="3.5" y="5" width="17" height="15.5" rx="2.5"/>' +
    '<path d="M3.5 9.5h17M8 3v4M16 3v4"/>' +
    '<path d="M12 12.3v5.4M9.3 15h5.4"/>',

  ticket:
    '<path class="duo" d="M3.5 7.5A1.5 1.5 0 0 1 5 6h14a1.5 1.5 0 0 1 1.5 1.5V10a2 2 0 0 0 0 4v2.5A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5V14a2 2 0 0 0 0-4Z"/>' +
    '<path d="M14.5 6v2M14.5 11v2M14.5 16v2"/>',

  bus:
    '<rect class="duo" x="4.5" y="3.5" width="15" height="14" rx="3"/>' +
    '<path d="M4.5 11h15M8 17.5v2.5M16 17.5v2.5M8.5 6.5h7"/>' +
    '<circle cx="8" cy="14.3" r=".9"/><circle cx="16" cy="14.3" r=".9"/>',

  book:
    '<path class="duo" d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5Z"/>' +
    '<path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/>' +
    '<path d="M12 6.5v7M9.5 9h5"/>',

  music:
    '<path d="M9 18V6l10-2v12"/>' +
    '<circle class="duo" cx="6.5" cy="18" r="2.5"/>' +
    '<circle class="duo" cx="16.5" cy="16" r="2.5"/>',

  photos:
    '<rect class="duo" x="3" y="5" width="18" height="14" rx="2.5"/>' +
    '<circle cx="9" cy="10" r="1.6"/>' +
    '<path d="m3.5 17 5-4.5 3.5 3 3-2.5 5.5 4.5"/>',

  video:
    '<rect class="duo" x="3" y="6" width="13" height="12" rx="2.5"/>' +
    '<path d="m16 10.5 5-3v9l-5-3"/>',

  church:
    '<path d="M12 2v4M10.3 3.6h3.4"/>' +
    '<path class="duo" d="M7.5 11.2a4.5 4.5 0 0 1 9 0v9.3h-9Z"/>' +
    '<path d="M4 20.5h16M10.5 20.5v-3.2a1.5 1.5 0 0 1 3 0v3.2"/>',

  cross:
    '<path class="duo" d="M10.2 3h3.6l-.9 8.1 8.1-.9v3.6l-8.1-.9.9 8.1h-3.6l.9-8.1-8.1.9v-3.6l8.1.9Z"/>',

  heart:
    '<path class="duo beat" d="M12 20.5s-7.5-4.6-7.5-10A4.25 4.25 0 0 1 12 7.6a4.25 4.25 0 0 1 7.5 2.9c0 5.4-7.5 10-7.5 10Z"/>',

  star:
    '<path class="duo" d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7Z"/>',

  megaphone:
    '<path class="duo" d="M4 10v4a1 1 0 0 0 1 1h2l8 4.5v-15L7 9H5a1 1 0 0 0-1 1Z"/>' +
    '<path d="M7.5 15l1.2 4.5M18.5 9.5a3.5 3.5 0 0 1 0 5"/>',

  gift:
    '<rect class="duo" x="3.5" y="9" width="17" height="4" rx="1"/>' +
    '<path d="M5 13v7.5h14V13M12 9v11.5"/>' +
    '<path d="M12 9S10.5 4 8 4.5 7 9 12 9Zm0 0s1.5-5 4-4.5S17 9 12 9Z"/>',

  users:
    '<circle class="duo" cx="9" cy="8" r="3.5"/>' +
    '<path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',

  map:
    '<path class="duo" d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/>' +
    '<circle cx="12" cy="9.5" r="2.5"/>',

  'map-view':
    '<path class="duo" d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2Z"/>' +
    '<path d="M9 4.5v13M15 6.5v13"/>',

  directions:
    '<path class="duo" d="M11.3 2.7a1 1 0 0 1 1.4 0l8.6 8.6a1 1 0 0 1 0 1.4l-8.6 8.6a1 1 0 0 1-1.4 0l-8.6-8.6a1 1 0 0 1 0-1.4Z"/>' +
    '<path d="M14.5 14v-2.5A1.5 1.5 0 0 0 13 10H8.5"/>' +
    '<path d="m10.5 8-2 2 2 2"/>',

  info:
    '<circle class="duo" cx="12" cy="12" r="9"/>' +
    '<path d="M12 11v5.5M12 7.6v.1"/>',

  alert:
    '<path class="duo" d="M10.3 4.2a2 2 0 0 1 3.4 0l7.4 12.8a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3Z"/>' +
    '<path d="M12 9.5v4M12 16.8v.1"/>',

  sparkle:
    '<path class="duo" d="M11 3c.6 3.6 2.4 5.4 6 6-3.6.6-5.4 2.4-6 6-.6-3.6-2.4-5.4-6-6 3.6-.6 5.4-2.4 6-6Z"/>' +
    '<path d="M18.5 14c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z"/>',

  mail:
    '<rect class="duo" x="3" y="5.5" width="18" height="13" rx="2.5"/>' +
    '<path d="m4 7.5 8 5.5 8-5.5"/>',

  link:
    '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/>' +
    '<path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',

  /* ---------- interface ---------- */

  bell:
    '<path class="duo bell-body" d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z"/>' +
    '<path class="bell-clapper" d="M10 20.5a2 2 0 0 0 4 0"/>' +
    '<path d="M12 3v2"/>',

  'sound-on':
    '<path class="duo" d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/>' +
    '<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',

  'sound-off':
    '<path class="duo" d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/>' +
    '<path d="m16 9.5 5 5M21 9.5l-5 5"/>',

  phone:
    '<path class="duo" d="M6.6 3.5h2.6l1.6 4.2-2 1.3a10.5 10.5 0 0 0 6.2 6.2l1.3-2 4.2 1.6v2.6a2.1 2.1 0 0 1-2.1 2.1A15.4 15.4 0 0 1 4.5 5.6a2.1 2.1 0 0 1 2.1-2.1Z"/>',

  share:
    '<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/>' +
    '<path d="m8.7 10.8 6.6-4M8.7 13.2l6.6 4"/>',

  qr:
    '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/>' +
    '<rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/>' +
    '<rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/>' +
    '<path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 18.5v2M18.5 14h2"/>',

  /* points left: "forward" in a right-to-left layout */
  arrow:
    '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',

  external:
    '<path d="M14 4h6v6M20 4l-9 9"/>' +
    '<path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',

  close:
    '<path d="M6 6l12 12M18 6 6 18"/>',

  download:
    '<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M5 19.5h14"/>',

  copy:
    '<rect x="8" y="8" width="12" height="12" rx="2"/>' +
    '<path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',

  check:
    '<path d="M5 12.5l4.5 4.5L19 7.5"/>',

  clock:
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',

  trophy:
    '<path class="duo" d="M7 4h10v5a5 5 0 0 1-10 0Z"/>' +
    '<path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 7.8 11M17 6h2.5v1.5a3.5 3.5 0 0 1-3.3 3.5M12 14v3.5M8.5 20.5h7M9.5 17.5h5v3h-5Z"/>',

  theatre:
    '<path class="duo" d="M4 4.5c2.6 1 5.4 1 8 0v6.2A4 4 0 0 1 8 14.7a4 4 0 0 1-4-4Z"/>' +
    '<path d="M12 9.3c2.6 1 5.4 1 8 0v6.2a4 4 0 0 1-4 4 4 4 0 0 1-4-4"/>' +
    '<path d="M6.3 8.6h.01M9.7 8.6h.01M6.6 11.4a2 2 0 0 0 2.8 0M14.3 13.4h.01M17.7 13.4h.01M14.6 16.8a2 2 0 0 1 2.8 0"/>',

  chevron:
    '<path d="m6 9 6 6 6-6"/>',

  retry:
    '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'
};


/* Icons that admins can choose for links (keep in sync with Content.gs ICON_NAMES). */
export const LINK_ICON_NAMES = [
  'voice', 'facebook', 'instagram', 'tiktok', 'youtube', 'whatsapp',
  'telegram', 'spotify', 'form', 'calendar', 'ticket', 'bus', 'book',
  'music', 'photos', 'video', 'church', 'cross', 'heart', 'star',
  'megaphone', 'gift', 'users', 'map', 'info', 'link', 'trophy', 'theatre',
  'messenger', 'discord', 'x', 'threads', 'snapchat', 'mail', 'phone'
];


export function isBrandIcon(name) {

  return Object.prototype.hasOwnProperty.call(BRAND_ICONS, name);

}


/* extraClass is added to the base 'icon icon--line|brand' classes */
export function iconSvg(name, extraClass = '') {

  let body;
  let kind;

  if (isBrandIcon(name)) {
    body = `<path d="${BRAND_ICONS[name].path}"/>`;
    kind = 'brand';
  }
  else {
    body = LINE_ICONS[name] || LINE_ICONS.link;
    kind = 'line';
  }

  return `<svg class="icon icon--${kind}${extraClass ? ` ${extraClass}` : ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

}


/* Parses the trusted markup into a node (avoids innerHTML on content nodes). */
const parser = document.createElement('template');

export function iconNode(name, extraClass) {

  parser.innerHTML = iconSvg(name, extraClass);

  return parser.content.firstElementChild;

}
