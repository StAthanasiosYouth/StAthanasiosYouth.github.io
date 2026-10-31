/**
 * YOUTH ACCOUNT: the small drawn parts every screen shares: the line icons, the arch that holds the
 * member's photo or first letter, rows, chips, the empty and notice blocks, the toast.
 */

import { h } from '../dom.js';

const SVG = 'http://www.w3.org/2000/svg';

const ICONS = {
  ticket: 'M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6zM14 5v3M14 11v2M14 16v3',
  trophy: 'M8 4h8v6a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 14v4M8 20h8M10 18h4',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z',
  bag: 'M5 8h14l1 12H4zM9 8V6a3 3 0 0 1 6 0v2',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  shield: 'M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6zM9 12l2 2 4-4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4.4 4-6 8-6s7 1.6 8 6',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.8M12 17.2v.1',
  back: 'M9 5l7 7-7 7',
  go: 'M15 5l-7 7 7 7',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8.5 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 16l-5-5-8 8',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2C10 21 3 14 3 6a2 2 0 0 1 2-2z',
  whatsapp: 'M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3zM8.7 8.2c.7-.8 1.3-.5 1.6.1l.5 1.2-.8 1a6 6 0 0 0 3 2.8l1-.9 1.3.6c.6.3.8.9.2 1.5-.9 1-2.2 1-4 .1a8 8 0 0 1-3.5-3.6c-.6-1.2-.5-2 .7-2.8z',
  mail: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.5 7l8.5 6 8.5-6',
  mobile: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  desktop: 'M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 20h6M12 16v4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  alert: 'M12 4l9 16H3zM12 10v4M12 17.2v.1',
  lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V8a4 4 0 0 1 8 0v3',
  home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-3-5-1 .6 1 3 1 5 1zM12 7c2-4 6-3 5-1-.6 1-3 1-5 1z',
  wifi: 'M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a3.5 3.5 0 0 1 4 0M12 19.5v.1',
  key: 'M15 3a6 6 0 0 0-5.6 8.2L3 17.6V21h3.4l1-1v-2h2l1.2-1.2A6 6 0 1 0 15 3zM16.5 7.5h.01',
  cross: 'M12 2v20M2 12h20M8 3h8M8 21h8M3 8v8M21 8v8'
};

export function ic(name, cls = '') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ac-ic' + (cls ? ' ' + cls : ''));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

const go = () => ic('go', 'ac-row__go');

/* the face inside an arch: the photo, or the first letter in Ruqaa */
export function fillArch(arch, { firstName = '', photo = '' }) {
  const face = arch.querySelector('.ac-arch__face');
  if (!face) return;
  const was = face.dataset.photo || '';
  if (was === photo && face.firstChild) return;
  face.dataset.photo = photo;
  if (!photo) {
    face.replaceChildren(h('span', { class: 'ac-arch__initial', 'aria-hidden': 'true' }, Array.from(firstName)[0] || ''));
    return;
  }
  const img = h('img', { class: 'ac-arch__img', src: photo, alt: 'صورتك', width: 256, height: 256, decoding: 'async' });
  face.replaceChildren(img);
}

/* size: s (rail, who), m (the default), l (the home's hero). onEdit makes it the button that opens the photo sheet */
export function arch(person, { size = 'm', onEdit = null, cls = '' } = {}) {
  const el = h(onEdit ? 'button' : 'span', {
    class: 'ac-arch ac-arch--' + size + (onEdit ? '' : ' ac-arch--static') + (cls ? ' ' + cls : ''),
    type: onEdit ? 'button' : null,
    'aria-label': onEdit ? (person.photo ? 'غيّر صورتك' : 'حط صورتك') : null,
    'data-arch': '',
    'data-quiet': onEdit ? '' : null,
    onclick: onEdit
  },
  h('span', { class: 'ac-arch__cross' }, ic('cross')),
  h('span', { class: 'ac-arch__face' }),
  onEdit ? h('span', { class: 'ac-arch__cam' }, ic('camera')) : null);
  fillArch(el, person);
  return el;
}

export const chip = ([text, tone]) => h('span', { class: 'ac-chip' + (tone ? ' ac-chip--' + tone : '') }, text);

/* one row: a link to a route or page, a button, or plain text */
export function row({ icon, title, sub, href, onclick, end, attrs = {} }) {
  const live = href || onclick;
  return h(href ? 'a' : onclick ? 'button' : 'div', {
    class: 'ac-row' + (live ? '' : ' ac-row--static'),
    href: href || null,
    type: !href && onclick ? 'button' : null,
    onclick: onclick || null,
    ...attrs
  },
  icon ? h('span', { class: 'ac-row__ic' }, ic(icon)) : null,
  h('span', { class: 'ac-row__body' }, h('span', { class: 'ac-row__t' }, title), sub ? h('span', { class: 'ac-row__s' }, sub) : null),
  end ? h('span', { class: 'ac-row__end' }, end) : null,
  live ? go() : null);
}

export const rows = (...kids) => h('div', { class: 'ac-rows' }, kids);
export const list = (name, items) => h('ul', { class: 'ac-rows', [name]: '' }, items);
export const section = (title, ...kids) => h('section', { class: 'ac-sec' }, title ? h('h2', { class: 'ac-sec__h' }, title) : null, kids);

export const empty = (icon, title, text, action) => h('div', { class: 'ac-empty' },
  h('span', { class: 'ac-empty__ic' }, ic(icon)),
  h('p', { class: 'ac-empty__t' }, title),
  h('p', { class: 'ac-empty__s' }, text),
  action || null);

export const note = (text, { alert = false, icon = '', attrs = {} } = {}) => h('p', { class: 'ac-note' + (alert ? ' ac-note--alert' : ''), role: alert ? 'alert' : null, ...attrs },
  ic(icon || (alert ? 'alert' : 'clock')), h('span', {}, text));

/* the page head of a section: back arrow + title */
export const head = (title, back = '#me') => h('header', { class: 'ac-sub' },
  h('a', { class: 'ac-sub__back', href: back, 'aria-label': 'ارجع', 'data-back': '' }, ic('back')),
  h('h1', { class: 'ac-sub__t', tabindex: '-1' }, title));

export function skeleton() {
  return h('div', { class: 'ac-view ac-sk', role: 'status', 'aria-busy': 'true', 'aria-label': 'بنحمّل' },
    h('i', { class: 'ac-sk--h' }), h('i', { class: 'ac-sk--b' }), h('i', {}), h('i', {}), h('i', {}));
}

let toastTimer = 0;
export function toast(text, kind = 'ok') {
  document.querySelector('.ac-toast')?.remove();
  const box = h('div', { class: 'ac-toast' }, h('p', { class: 'ac-toast__b ac-toast__b--' + kind, role: 'status' }, ic(kind === 'ok' ? 'check' : 'alert'), text));
  (document.querySelector('dialog[open]') || document.body).append(box);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.remove(), 3400);
}
