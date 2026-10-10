/**
 * The scenes' in-app UI glyphs: the shapes the real apps use for their
 * own buttons (TikTok's rail, Instagram's heart / bubble / plane, the
 * Facebook thumb, chat send / mic, player and timeline controls), drawn
 * here as small inline SVG in currentColor (1em, so the existing sizes and
 * colours apply). Our own drawings of those common shapes — not the apps'
 * files. Emoji stay where the apps use emoji (reactions).
 * Loaded with the scenes only (never on the first page load).
 */

const NS = 'http://www.w3.org/2000/svg';

/* 24 × 24; "f:" = filled (holes by even-odd), else stroked */
const SHAPES = {
  heart: 'f:M12 20.7l-1.4-1.3C5.4 14.7 2 11.6 2 7.8 2 4.7 4.4 2.3 7.5 2.3c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1 3.1 0 5.5 2.4 5.5 5.5 0 3.8-3.4 6.9-8.6 11.6z',
  heartLine: 'M12 20l-1.2-1.1C5.9 14.5 3 11.8 3 8.3 3 5.6 5.1 3.5 7.7 3.5c1.6 0 3.2.8 4.3 2.1 1.1-1.3 2.7-2.1 4.3-2.1 2.6 0 4.7 2.1 4.7 4.8 0 3.5-2.9 6.2-7.8 10.6z',
  // TikTok: a round bubble with three dots, a ribbon, a bent arrow
  bubble: 'f:M12 3c-5.4 0-9.5 3.6-9.5 8.2 0 2.5 1.2 4.6 3.2 6.1-.2 1.4-.9 2.6-1.9 3.5 2 0 3.7-.6 5-1.6.9.2 2 .3 3.2.3 5.4 0 9.5-3.6 9.5-8.3S17.4 3 12 3zM7.3 11.2a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0zm3.4 0a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0zm3.4 0a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0z',
  bookmark: 'f:M6.5 2.5h11c.8 0 1.5.7 1.5 1.5v17.4l-7-4.7-7 4.7V4c0-.8.7-1.5 1.5-1.5z',
  shareTT: 'f:M13.5 3.6v4.6C7.4 8.7 3.5 12.7 3 19.8c2.1-3.8 5.4-5.6 10.5-5.7v4.6l8-7.6z',
  // Instagram / Threads: outline bubble with its tail, the paper plane
  comment: 'M20.5 16.5A9 9 0 1 0 17 20l4.5 1.4z',
  plane: 'M21.5 2.5L10.6 13.4M21.5 2.5l-6.8 19-4.1-8.1-8.1-4.1z',
  // Facebook / YouTube: the thumb, a round bubble, the share arrow
  thumb: 'M7.5 10.5v10h-4v-10zm0 0L11.3 3c1.6 0 2.7 1.3 2.7 2.8v3.7h5.2c1.3 0 2.2 1.2 1.9 2.4l-1.6 6.9c-.2 1-1.1 1.7-2.1 1.7H7.5',
  talk: 'M12 3.5c-4.8 0-8.5 3.4-8.5 7.6 0 2.4 1.2 4.5 3.1 5.9V21l3.4-1.9c.6.1 1.3.2 2 .2 4.8 0 8.5-3.4 8.5-7.6S16.8 3.5 12 3.5z',
  share: 'M14 4.5v4C7.5 9 4 13.4 3.5 19.5c2.2-3.6 5.5-5.2 10.5-5.2v4.2l7-7z',
  // chats: send, microphone, emoji, paper clip
  send: 'f:M3 20.5L21.5 12 3 3.5l.1 6.6L15 12 3.1 13.9z',
  mic: 'M12 14.5a3 3 0 0 0 3-3v-6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm6-3a6 6 0 0 1-12 0m6 6v3',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-3.5-6.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2M9 9.5h.01M15 9.5h.01',
  clip: 'M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8',
  // X: the reply bubble, the repost loop, views, share
  reply: 'M8.5 4.5h7a5.5 5.5 0 0 1 0 11h-2.8L8 19.5v-4.1A5.5 5.5 0 0 1 8.5 4.5z',
  repost: 'M4.5 9.5l3-3 3 3M7.5 7v8.5a2 2 0 0 0 2 2H14m5.5-3l-3 3-3-3m3 2.5V8.5a2 2 0 0 0-2-2H10',
  views: 'M5 20v-8M10 20V5M15 20v-6M20 20V9',
  upload: 'M12 3.5v11M7.5 8 12 3.5 16.5 8M4.5 14.5v4a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4',
  // Threads' repost: the round loop
  loop: 'M17 3l3 3-3 3M20 6H9a5 5 0 0 0-5 5M7 21l-3-3 3-3m-3 3h11a5 5 0 0 0 5-5',
  // the players: shuffle, previous, next, repeat, liked, down
  shuffle: 'M3 7h3.5L17 17h4M3 17h3.5l3-3M14.5 10l2.5-3h4M18 4l3 3-3 3M18 14l3 3-3 3',
  prev: 'f:M5 5h2.2v14H5zm14.5 0v14L8.8 12z',
  next: 'f:M16.8 5H19v14h-2.2zM4.5 5v14l10.7-7z',
  repeat: 'M17 2.5L20.5 6 17 9.5M3.5 11V9a3 3 0 0 1 3-3h14M7 21.5L3.5 18 7 14.5M20.5 13v2a3 3 0 0 1-3 3h-14',
  liked: 'f:M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.5 14.2L6.3 12l1.4-1.4 2.8 2.8 5.8-5.8 1.4 1.4z',
  down: 'M6 9l6 6 6-6'
};

/* <svg class="xp-ui …"> of a SHAPES name; flip: mirrored upside down (the thumb down) */
export function ui(name, className = '', { flip = false } = {}) {

  const shape = SHAPES[name] || '';
  const filled = shape.startsWith('f:');
  const svg = document.createElementNS(NS, 'svg');
  const path = document.createElementNS(NS, 'path');

  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `xp-ui xp-ui--${name}${className ? ` ${className}` : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  if (flip) svg.style.transform = 'scaleY(-1)';
  path.setAttribute('d', filled ? shape.slice(2) : shape);
  if (filled) {
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('fill-rule', 'evenodd');
  }
  else {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.append(path);
  return svg;

}
