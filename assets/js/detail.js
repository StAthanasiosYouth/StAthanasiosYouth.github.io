/**
 * DETAIL: what the sheets show (news, games, the meeting) and the poster
 * hero at their top. Loaded with the sheets (main.js), not on the first
 * visit: the page itself never needs it.
 */

import { h, external } from './dom.js';
import { iconNode } from './icons.js';
import { upcomingSessions } from './schedule.js';
import { formatStamp, formatDate, formatTime, DAY_NAMES } from './words.js';
import { openViewer } from './sheet.js';
import { gameCard } from './hub.js';
import { motionTier } from './feel.js';


/*
 * MEDIA HERO: the poster at the top of every detail sheet.
 * - Its frame has the poster's own ratio before anything loads (no jump),
 *   capped in height (main.css); the poster is never cropped or stretched
 *   (contain) and always sharp: srcset + sizes = the width it really gets.
 * - The space a tall or wide poster leaves is filled on purpose: the same
 *   picture blurred and darkened (full tier, the cached thumbnail), else a
 *   navy/gold light in the poster's own colour.
 * - A tap opens the full picture in a viewer (zoom, scroll, Esc).
 */
const SHEET_WIDTH = 552;   // the sheet's content width from 720px up
const HERO_VH = { wide: 62, narrow: 56 };

export function shapeOf(image) {

  const ratio = image.w / image.h;

  if (ratio >= 1.2) return 'wide';
  if (ratio > 0.85) return 'square';
  if (ratio >= 0.5) return 'portrait';
  return 'tall';

}

export function mediaHero(image) {

  if (!image) return null;

  const ratio = image.w / image.h;
  const r = ratio.toFixed(4);

  const img = h('img', {
    class: 'media-hero__img',
    src: image.thumb,
    srcset: image.thumb !== image.src ? `${image.thumb} 480w, ${image.src} ${Math.max(image.w, 481)}w` : null,
    // the width the poster really gets: the sheet's width, or less when its height is the limit
    sizes: `(min-width: 720px) min(${SHEET_WIDTH}px, calc(${HERO_VH.wide}vh * ${r})), min(calc(100vw - 40px), calc(${HERO_VH.narrow}vh * ${r}))`,
    width: image.w,
    height: image.h,
    alt: image.alt || '',
    decoding: 'async',
    fetchpriority: 'high'
  });

  const zoom = h('button', {
    class: 'media-hero__zoom',
    type: 'button',
    'aria-haspopup': 'dialog',
    'aria-label': image.alt ? `${image.alt} — اعرضها كاملة` : 'اعرض الصورة كاملة',
    onclick: () => openViewer(image)
  },
  img,
  h('span', { class: 'media-hero__hint', 'aria-hidden': 'true' }, expandIcon(), shapeOf(image) === 'tall' ? 'البوستر كامل' : 'كبّر')
  );

  const figure = h('figure', { class: 'media-hero', 'data-shape': shapeOf(image) },
    // the cinematic surround (decorative; only the full tier shows it, so only
    // the full tier gives it a file at all)
    h('img', { class: 'media-hero__ambient', src: motionTier() === 'full' ? image.thumb : null, alt: '', 'aria-hidden': 'true', loading: 'lazy', decoding: 'async' }),
    zoom
  );

  // CSSOM (the CSP blocks style=""): the ratio and the poster's colour
  figure.style.setProperty('--ar', `${image.w} / ${image.h}`);
  if (image.color) figure.style.setProperty('--tint', image.color);
  else if (img.complete && img.naturalWidth) tintFrom(img, figure);
  else img.addEventListener('load', () => tintFrom(img, figure), { once: true });

  return figure;

}


/* the poster's average colour, for the light around it (a same-origin
   picture, an 8×8 sample: cheap) */
function tintFrom(img, figure) {

  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 8, 8);
    const data = ctx.getImageData(0, 0, 8, 8).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
    const [r, g, b] = sum.map(v => Math.round(v / 64));
    figure.style.setProperty('--tint', `rgb(${r} ${g} ${b})`);
  }
  catch {
    // keep the default light
  }

}


function expandIcon() {

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon icon--line');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5');
  svg.append(path);

  return svg;

}


export function newsSheetContent(item, nowStamp, shareItem) {

  return h('article', { class: 'detail' },
    mediaHero(item.image),
    h('div', { class: 'detail__meta' },
      item.badge ? h('span', { class: 'badge' }, item.badge) : null,
      item.publishAt ? h('span', {}, formatStamp(item.publishAt)) : null
    ),
    item.summary ? h('p', { class: 'detail__lead' }, item.summary) : null,
    item.body ? h('p', { class: 'detail__body' }, item.body) : null,
    item.link ? h('div', { class: 'detail__actions' }, h('a', { class: 'btn btn--primary', ...external(item.link.url) }, item.link.label, iconNode('external'))) : null,
    shareItem(`#news/${item.id}`, item.title)
  );

}


export function gameSheetContent(entry, shareItem) {

  const { game } = entry;
  const card = gameCard(entry, { inSheet: true });

  return {
    node: h('article', { class: 'detail' },
      mediaHero(game.image),
      game.description ? h('p', { class: 'detail__body' }, game.description) : null,
      h('div', { class: 'detail__game' }, card.el),
      shareItem(`#game/${game.id}`, game.title)
    ),
    card
  };

}


export function meetingSheetContent(content, status, nowStamp) {

  const session = status && status.session;
  const meeting = content.meeting;
  const upcoming = upcomingSessions(content.sessions, nowStamp, 5)
    .filter(s => !session || s.date !== session.date);

  const when = status
    ? `${status.daysUntil > 6 ? formatDate(status.date) : DAY_NAMES[status.date.weekday]} الساعة ${formatTime(status.startMinutes)}`
    : '';

  return h('article', { class: 'detail' },
    session ? mediaHero(session.image) : null,
    session && session.topic ? h('p', { class: 'detail__kicker' }, 'موضوع الاجتماع') : null,
    session && session.topic ? h('p', { class: 'detail__topic' }, session.topic) : null,
    session && session.speaker ? h('p', { class: 'detail__lead' }, `مع ${session.speaker}`) : null,
    when ? h('p', { class: 'detail__when' }, iconNode('clock'), when) : null,
    session && session.description ? h('p', { class: 'detail__body' }, session.description) : null,
    session && session.note ? h('p', { class: 'detail__note' }, session.note) : null,
    meeting && meeting.note ? h('p', { class: 'detail__note' }, meeting.note) : null,
    upcoming.length
      ? h('section', { class: 'detail__upcoming' },
        h('h3', {}, 'الاجتماعات الجاية'),
        h('ul', {}, upcoming.map(s => h('li', { class: s.status === 'cancelled' ? 'is-cancelled' : '' },
          h('span', { class: 'detail__date' }, formatDate(fromIso(s.date))),
          h('span', {}, s.status === 'cancelled' ? `مفيش اجتماع${s.note ? ` — ${s.note}` : ''}` : (s.topic || 'الاجتماع'))
        )))
      )
      : null
  );

}


function fromIso(iso) {

  const [year, month, day] = iso.split('-').map(Number);

  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };

}
