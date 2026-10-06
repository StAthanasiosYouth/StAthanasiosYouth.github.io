/**
 * Facebook: a feed of our posts sliding by, reactions bubbling up
 * (👍 ❤️ 😮), a count that climbs. "هنا هتتابع أخبارنا وإعلاناتنا".
 * Our own interpretation, not Facebook's interface.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, float, posters, climb, LOGO, EASE, SPRING } from './kit.js';

const REACTIONS = ['👍', '❤️', '😮', '👍', '❤️', '👍', '😮', '❤️', '👍'];

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

export function play(stage, { quick, reduced, content, sound }) {

  const tl = timeline({ quick, reduced });
  const pics = posters(content, 3);
  const feed = h('div', { class: 'fb-feed' }, post(pics[0], false), post(pics[1], true), post(pics[2], false));
  const count = h('span', { class: 'fb-count__n' });
  const bar = h('div', { class: 'fb-react' },
    h('span', { class: 'fb-react__faces' }, '👍', '❤️', '😮'),
    h('span', { class: 'fb-count' }, count),
    h('span', { class: 'fb-react__like' }, '👍 أعجبني')
  );

  const phone = h('div', { class: 'xp-phone fb' },
    h('div', { class: 'fb-top' },
      h('span', { class: 'fb-top__logo' }, iconNode('facebook')),
      h('span', { class: 'fb-top__name' }, 'أسرة البابا أثناسيوس'),
      h('span', { class: 'fb-top__follow' }, 'متابَع ✓')
    ),
    h('div', { class: 'fb-viewport' }, feed),
    bar
  );

  stage.append(phone);

  // the phone rises in, the feed scrolls to the second post
  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 650, easing: SPRING });
  tl.from(feed, [{ transform: 'translateY(0)' }, { transform: 'translateY(-34%)' }], { duration: 1600, delay: 900, easing: 'cubic-bezier(.45, 0, .2, 1)' });
  feed.classList.add('is-scrolled');
  tl.from(bar, [{ transform: 'translateY(100%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 500, delay: 500, easing: EASE });

  climb(count, 128, tl, { from: 96, steps: REACTIONS.length, start: 700, every: quick ? 120 : 230 });

  REACTIONS.forEach((emoji, i) => {
    tl.at(700 + i * (quick ? 120 : 230), () => {
      float(phone, emoji, { x: 8 + (i % 3) * 6, y: 86, drift: (i % 2 ? -1 : 1) * (10 + i * 2), rise: 150 + (i % 3) * 30, size: 1.25 + (i % 2) * 0.25 });
      if (i % 3 === 0) sound('pop', { passive: true });
    });
  });

  return tl;

}
