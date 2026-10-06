/**
 * FEED family: X, Threads, and any future "timeline" platform. A column of
 * short posts from us (logo, handle, text lines, sometimes a photo, the
 * action row), skinned by the registry (accent, icon).
 *
 * Entrance: the timeline drops in post by post, a like lands. Alive: new
 * posts slide in at the top under a «منشورات جديدة» pill, likes and
 * reposts tick, hearts pop; hearts and short bubbles drift in from the
 * edges. Our own interpretation, not the apps' interfaces.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, edge, floats, media, lines, rand, pick, compact, meetingLine, LOGO, EASE, SPRING } from './kit.js';

const HANDLE = '@stathanasios';

function post({ src, text, n = 2, likes = 40 }) {

  const like = h('b', { 'data-n': likes }, compact(likes));
  const repost = h('b', { 'data-n': Math.round(likes / 4) }, compact(Math.round(likes / 4)));

  return h('div', { class: 'fd-post' },
    h('img', { class: 'fd-post__avatar', src: LOGO, alt: '' }),
    h('span', { class: 'fd-post__body' },
      h('span', { class: 'fd-post__who' }, h('b', {}, 'أسرة البابا أثناسيوس'), h('span', { class: 'fd-post__handle' }, HANDLE)),
      text ? h('span', { class: 'fd-post__text' }, text) : lines(n),
      src ? h('span', { class: 'fd-post__photo' }, h('img', { src, alt: '' })) : null,
      h('span', { class: 'fd-post__actions' },
        h('span', {}, '💬'),
        h('span', { class: 'fd-repost' }, '🔁 ', repost),
        h('span', { class: 'fd-like' }, '♥ ', like),
        h('span', {}, '↗')
      )
    )
  );

}

export function play(stage, { quick, reduced, lite, content, sound, link, platform }) {

  const tl = timeline({ quick, reduced, lite });
  const pics = media(link, content, 2);
  const glyph = platform.icon || (link.icon !== 'link' ? link.icon : 'megaphone');

  const posts = [
    post({ text: meetingLine(content, 'كل الجديد هنا أول بأول ✨'), likes: 128 }),
    post({ src: pics[0], n: 1, likes: 312 }),
    post({ n: 2, likes: 57 })
  ];
  const list = h('div', { class: 'fd-list' }, posts);
  const pill = h('span', { class: 'fd-pill' }, '↑ منشورات جديدة');

  const phone = h('div', { class: `xp-phone fd fd--${platform.key}` },
    h('div', { class: 'fd-top' },
      h('img', { class: 'fd-top__avatar', src: LOGO, alt: '' }),
      h('span', { class: 'fd-top__glyph' }, iconNode(glyph)),
      h('span', { class: 'fd-top__spacer' })
    ),
    h('div', { class: 'fd-tabs' }, h('span', { class: 'is-on' }, 'لك'), h('span', {}, 'متابَع')),
    h('div', { class: 'fd-viewport' }, list, pill)
  );

  stage.append(phone);

  /* ---------- entrance ---------- */

  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 620, easing: SPRING });
  posts.forEach((p, i) => {
    tl.from(p, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 450 + i * (quick ? 140 : 280), easing: EASE });
  });

  const firstLike = posts[0].querySelector('.fd-like');
  tl.at(1700, () => {
    firstLike.classList.add('is-on');
    if (firstLike.animate) firstLike.animate([{ transform: 'scale(1.5)' }, { transform: 'none' }], { duration: 420, easing: SPRING });
    sound('pop', { passive: true });
  });
  if (reduced) firstLike.classList.add('is-on');

  /* ---------- alive ---------- */

  const settled = 2600;

  // a new post slides in at the top; the oldest goes
  tl.ambient(list, {
    every: 4600, max: 3, recycle: true, delay: settled + 1200, name: 'fd-post',
    make: () => h('div', { class: 'fd-post' }),
    spawn: (node, n) => {
      const next = post({ src: n % 2 ? pics[1] : null, n: n % 3 ? 1 : 2, likes: Math.round(rand(8, 40)) });
      node.className = 'fd-post xp-amb';
      node.replaceChildren(...next.childNodes);
      list.prepend(node);
      [...list.children].slice(5).forEach(old => { if (!old.classList.contains('xp-amb')) old.remove(); });
      if (pill.animate) pill.animate([{ transform: 'translate(-50%, -16px)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%, 0)', opacity: 1, offset: 0.8 }, { transform: 'translate(-50%, -10px)', opacity: 0 }], { duration: 2200, easing: EASE });
      sound('tap', { passive: true });
      return [
        node.animate([{ opacity: 0, transform: 'translateY(-30px)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: EASE }),
        list.animate([{ transform: 'translateY(-34px)' }, { transform: 'none' }], { duration: 520, easing: EASE })
      ];
    }
  });

  // likes and reposts tick on what's on screen
  tl.every(1400, () => {
    const counters = [...list.querySelectorAll('.fd-like b, .fd-repost b')].slice(0, 6);
    if (!counters.length) return;
    const counter = pick(counters);
    const value = Number(counter.dataset.n) + Math.round(rand(1, 5));
    counter.dataset.n = String(value);
    counter.textContent = compact(value);
    const action = counter.parentNode;
    if (action.classList.contains('fd-like')) action.classList.add('is-on');
    if (action.animate) action.animate([{ transform: 'scale(1.3)' }, { transform: 'none' }], { duration: 340, easing: EASE });
  }, { delay: settled });

  floats(tl, phone, { glyphs: ['♥'], x: [20, 70], y: [72, 86], rise: [80, 130], drift: 16, size: [0.9, 1.2], every: 1300, max: 4, delay: settled, className: 'xp-float--fd', name: 'fd-heart' });

  // (B) from the edges
  edge(tl, stage, {
    every: 1500, max: 5,
    items: () => (Math.random() < 0.45 ? { node: h('span', { class: 'xp-bubble xp-bubble--fd' }, lines(Math.random() < 0.5 ? 1 : 2)) } : { text: pick(['♥', '🔁', '💬']), className: 'xp-edge__item--fd' })
  });

  return tl;

}
