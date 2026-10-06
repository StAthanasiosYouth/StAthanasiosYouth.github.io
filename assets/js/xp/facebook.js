/**
 * Facebook: a feed of our posts sliding by, reactions bubbling up
 * (👍 ❤️ 😂 😮), a count that climbs. "هنا هتتابع أخبارنا وإعلاناتنا".
 * Then it stays alive: the feed drifts between posts, reactions keep
 * coming, comments slide in, the count ticks; reactions and comment
 * bubbles drift in from the edges.
 * Our own interpretation, not Facebook's interface.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, float, floats, edge, media, climb, tickUp, lines, rand, pick, LOGO, EASE, SPRING } from './kit.js';

const REACTIONS = ['👍', '❤️', '😮', '👍', '❤️', '👍', '😂', '❤️', '👍'];
const LIVE = ['👍', '❤️', '😂', '😮', '👍', '❤️'];

function post(src, wide) {

  return h('div', { class: 'fb-post' },
    h('div', { class: 'fb-post__head' },
      h('img', { class: 'fb-post__avatar', src: LOGO, alt: '' }),
      h('span', { class: 'fb-post__lines' }, h('i'), h('i'))
    ),
    h('div', { class: `fb-post__media${wide ? ' is-wide' : ''}` }, src ? h('img', { src, alt: '' }) : h('span', { class: 'fb-post__art' })),
    h('div', { class: 'fb-post__foot' }, h('i'), h('i'), h('i'))
  );

}

export function play(stage, { quick, reduced, lite, content, sound, link }) {

  const tl = timeline({ quick, reduced, lite });
  const pics = media(link, content, 3);
  const feed = h('div', { class: 'fb-feed' }, post(pics[0], false), post(pics[1], true), post(pics[2], false));
  const count = h('span', { class: 'fb-count__n' });
  const bar = h('div', { class: 'fb-react' },
    h('span', { class: 'fb-react__faces' }, '👍', '❤️', '😮'),
    h('span', { class: 'fb-count' }, count),
    h('span', { class: 'fb-react__like' }, '👍 أعجبني')
  );
  const comments = h('div', { class: 'fb-comments' });

  const phone = h('div', { class: 'xp-phone fb' },
    h('div', { class: 'fb-top' },
      h('span', { class: 'fb-top__logo' }, iconNode('facebook')),
      h('span', { class: 'fb-top__name' }, 'أسرة البابا أثناسيوس'),
      h('span', { class: 'fb-top__follow' }, 'متابَع ✓')
    ),
    h('div', { class: 'fb-viewport' }, feed, comments),
    bar
  );

  stage.append(phone);

  // the phone rises in, the feed scrolls to the second post
  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 650, easing: SPRING });
  tl.from(feed, [{ transform: 'translateY(0)' }, { transform: 'translateY(-34%)' }], { duration: 1600, delay: 900, easing: 'cubic-bezier(.45, 0, .2, 1)' });
  feed.classList.add('is-scrolled');
  tl.from(bar, [{ transform: 'translateY(100%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 500, delay: 500, easing: EASE });

  const start = 128;
  climb(count, start, tl, { from: 96, steps: REACTIONS.length, start: 700, every: quick ? 120 : 230 });

  REACTIONS.forEach((emoji, i) => {
    tl.at(700 + i * (quick ? 120 : 230), () => {
      float(phone, emoji, { x: 8 + (i % 3) * 6, y: 86, drift: (i % 2 ? -1 : 1) * (10 + i * 2), rise: 150 + (i % 3) * 30, size: 1.25 + (i % 2) * 0.25 });
      if (i % 3 === 0) sound('pop', { passive: true });
    });
  });

  /* ---------- alive ---------- */

  const settled = 2700;

  // the feed keeps drifting between the posts, slowly
  tl.at(settled, () => tl.loop(feed, [
    { transform: 'translateY(-34%)' },
    { transform: 'translateY(-34%)', offset: 0.18 },
    { transform: 'translateY(-8%)', offset: 0.5 },
    { transform: 'translateY(-8%)', offset: 0.68 },
    { transform: 'translateY(-34%)' }
  ], { duration: 11000, easing: 'cubic-bezier(.45, 0, .25, 1)' }));

  // reactions keep coming from the bar; the count follows
  floats(tl, phone, { glyphs: LIVE, x: [6, 22], y: [84, 88], rise: [110, 170], drift: 22, size: [1.1, 1.45], every: 1100, max: 5, delay: settled, name: 'fb-react' });
  tickUp(tl, count, { from: start, step: [1, 4], every: 2300, delay: settled });

  // a comment slides in over the feed, stays a moment, leaves
  tl.ambient(comments, {
    every: 3400, max: 2, delay: settled + 600, name: 'fb-comment',
    make: () => h('span', { class: 'fb-comment' }, h('img', { src: LOGO, alt: '' }), h('span', { class: 'fb-comment__bubble' }, lines(2))),
    spawn: node => {
      node.lastChild.lastChild.lastChild.style.width = `${Math.round(rand(35, 75))}%`;
      return node.animate([
        { transform: 'translateX(-24px)', opacity: 0 },
        { transform: 'none', opacity: 1, offset: 0.12 },
        { transform: 'none', opacity: 1, offset: 0.82 },
        { transform: 'translateY(-10px)', opacity: 0 }
      ], { duration: 3000, easing: EASE });
    }
  });

  // (B) from the edges: reactions and little comment bubbles
  edge(tl, stage, {
    every: 1300, max: 6,
    items: () => (Math.random() < 0.3 ? { node: h('span', { class: 'xp-bubble xp-bubble--fb' }, lines(2)) } : pick(LIVE))
  });

  return tl;

}
