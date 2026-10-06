/**
 * PLAYER family: YouTube and any future video platform. A video playing
 * (our photo as the frame), its progress bar, our channel row with the
 * subscribe button, likes and comments; skinned by the registry accent.
 *
 * Entrance: the player opens, play is pressed, the bar starts, subscribed ✓.
 * Alive: the video keeps playing (progress, a soft Ken Burns on the frame),
 * likes tick, comments slide in, thumbs and hearts rise; hearts and
 * comment bubbles drift in from the edges.
 * Our own interpretation, not the apps' interfaces.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, edge, floats, tickUp, climb, media, lines, rand, pick, compact, LOGO, EASE, SPRING } from './kit.js';

export function play(stage, { quick, reduced, lite, content, sound, link, platform }) {

  const tl = timeline({ quick, reduced, lite });
  const pics = media(link, content, 3);
  const glyph = platform.icon || (link.icon !== 'link' ? link.icon : 'video');

  const frame = h('span', { class: 'pl-frame' }, pics[0] ? h('img', { src: pics[0], alt: '' }) : h('span', { class: 'pl-frame__art' }, iconNode(glyph)));
  const playButton = h('span', { class: 'pl-play' }, '▶');
  const progress = h('span', { class: 'pl-progress' }, h('i'));
  const time = h('span', { class: 'pl-time' }, '٤:١٢ / ١٨:٣٠');
  const likes = h('b');
  const comments = h('div', { class: 'pl-comments' },
    h('span', { class: 'pl-comment' }, h('span', { class: 'pl-comment__avatar' }), lines(2)),
    h('span', { class: 'pl-comment' }, h('span', { class: 'pl-comment__avatar pl-comment__avatar--b' }), lines(1))
  );
  const subscribe = h('span', { class: 'pl-sub' }, 'مشترك ✓');

  const phone = h('div', { class: `xp-phone pl pl--${platform.key}` },
    h('div', { class: 'pl-top' }, h('span', { class: 'pl-top__glyph' }, iconNode(glyph)), h('span', { class: 'pl-top__name' }, platform.label || link.title)),
    h('div', { class: 'pl-video' }, frame, playButton, time, progress),
    h('div', { class: 'pl-info' },
      lines(2, 'pl-title'),
      h('span', { class: 'pl-channel' }, h('img', { src: LOGO, alt: '' }), h('span', { class: 'pl-channel__name' }, 'أسرة البابا أثناسيوس'), subscribe),
      h('span', { class: 'pl-actions' }, h('span', { class: 'pl-like' }, '👍 ', likes), h('span', {}, '👎'), h('span', {}, '↗ مشاركة'))
    ),
    h('div', { class: 'pl-more' }, pics.slice(1).map(src => h('span', { class: 'pl-thumb' }, h('img', { src, alt: '' }))), pics.length < 2 ? [h('span', { class: 'pl-thumb' }), h('span', { class: 'pl-thumb' })] : null),
    comments
  );

  stage.append(phone);

  /* ---------- entrance ---------- */

  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 620, easing: SPRING });
  playButton.classList.add('is-done');
  tl.from(playButton, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1)', opacity: 1, offset: 0.5 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 900, delay: 400, easing: EASE });
  tl.at(800, () => sound('tap', { passive: true }));
  tl.from(progress.firstChild, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(.23)' }], { duration: quick ? 900 : 2200, delay: 800, easing: 'linear' });
  tl.from(subscribe, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 500, delay: 1600, easing: EASE });
  tl.at(1600, () => sound('success', { passive: true }));
  [...comments.children].forEach((c, i) => tl.from(c, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 1900 + i * 300, easing: EASE }));

  climb(likes, 1240, tl, { from: 1020, steps: 8, start: 900, every: quick ? 90 : 180, format: compact });

  /* ---------- alive ---------- */

  const settled = 2900;

  // the video plays on
  tl.at(settled, () => {
    tl.loop(progress.firstChild, [{ transform: 'scaleX(.23)' }, { transform: 'scaleX(1)' }], { duration: 26000, easing: 'linear' });
    tl.loop(frame.firstChild, [{ transform: 'scale(1)' }, { transform: 'scale(1.08) translate(-2%, -1%)' }], { duration: 9000, direction: 'alternate' });
  });

  tickUp(tl, likes, { from: 1240, step: [2, 9], every: 1700, format: compact, delay: settled });
  floats(tl, phone, { glyphs: ['👍', '❤️', '👍'], x: [8, 20], y: [52, 56], rise: [70, 110], drift: 12, size: [0.9, 1.2], every: 1500, max: 4, delay: settled, name: 'pl-like' });

  tl.ambient(comments, {
    every: 3600, max: 3, recycle: true, delay: settled + 800, name: 'pl-comment',
    make: () => h('span', { class: 'pl-comment' }, h('span', { class: 'pl-comment__avatar' }), lines(2)),
    spawn: (node, n) => {
      node.firstChild.className = `pl-comment__avatar${n % 2 ? ' pl-comment__avatar--b' : ''}`;
      node.lastChild.lastChild.style.width = `${Math.round(rand(30, 70))}%`;
      comments.prepend(node);
      [...comments.children].slice(3).forEach(old => { if (!old.classList.contains('xp-amb')) old.remove(); });
      return node.animate([{ opacity: 0, transform: 'translateY(-12px)' }, { opacity: 1, transform: 'none' }], { duration: 460, easing: EASE });
    }
  });

  // (B) from the edges
  edge(tl, stage, {
    every: 1400, max: 5,
    items: () => (Math.random() < 0.4 ? { node: h('span', { class: 'xp-bubble xp-bubble--pl' }, lines(Math.random() < 0.5 ? 1 : 2)) } : pick(['👍', '❤️', '🙏', '🔥']))
  });

  return tl;

}
