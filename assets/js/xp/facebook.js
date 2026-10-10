/**
 * Facebook: our page's feed — a real feed, one post per item of the link's
 * playlist (kit.js: the admin's own pictures and clips, in its order, each
 * with its own words, and its words-only posts), scrolling post by post
 * through ALL of them, then
 * from the top again. No gallery: the real weekly posters with their
 * captions, with the «صوتكم يهمنا» post and the Pope Athanasius quote
 * between them. Reactions bubble up (👍 ❤️ 😂 😮), comments arrive, a
 * comment is typed in the bar and posted. "هنا هتتابع أخبارنا وإعلاناتنا".
 * Alive: the feed moves to the next post (a clip plays its segment
 * first), reactions pop out over the phone's edges, comments and replies
 * slide in, shares tick; comment bubbles and «شارك» hints drift around
 * (and beside the sheet on wide screens). Our own interpretation, not
 * Facebook's interface.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { deck, timeline, float, floats, spray, side, playlist, cycle, mediaNode, words, fitWords, FEED, climb, tickUp, typeInto, bubble, chip, pick, compact, digits, LOGO, EASE, SPRING } from './kit.js';
import { PAGE, COMMENTS, PAGE_REPLIES, WHO, TIMES, pagePosts } from './talk.js';
import { ui } from './glyphs.js';

const nextComment = deck(COMMENTS);

const REACTIONS = ['👍', '❤️', '😮', '👍', '❤️', '👍', '😂', '❤️', '👍'];
const LIVE = ['👍', '❤️', '😂', '😮', '👍', '❤️', '🥰'];
const LIKES = [128, 74, 212, 96, 157, 63];

/* an own picture or clip the admin left without words */
const GENERIC = `من اجتماعنا 🤍 كل أحد الساعة ٨ مساءً — ${PAGE.place}`;

function post({ item, text, time }, likes, tl, advance) {

  const count = h('span', { class: 'fb-post__n' }, compact(likes));
  return h('div', { class: 'fb-post', 'data-item': item ? item.id : null },
    h('div', { class: 'fb-post__head' },
      h('img', { class: 'fb-post__avatar', src: LOGO, alt: '' }),
      h('span', { class: 'fb-post__who' }, h('b', {}, PAGE.facebook), h('i', {}, `${time} · 🌐`))
    ),
    words(text, { className: 'fb-post__text', lines: 5, more: '… عرض المزيد' }),
    item && item.kind !== 'text' ? mediaNode(item, tl, { className: 'fb-post__media', ratio: FEED, advance }) : null,
    h('div', { class: 'fb-post__counts' }, h('span', { class: 'fb-post__faces' }, '👍❤️'), count, h('span', { class: 'fb-post__more' }, `${digits(Math.round(likes / 9))} تعليق · ${digits(Math.round(likes / 30) + 1)} مشاركة`)),
    h('div', { class: 'fb-post__actions' }, h('span', {}, ui('thumb'), 'أعجبني'), h('span', {}, ui('talk'), 'تعليق'), h('span', {}, ui('share'), 'مشاركة'))
  );

}

function comment(who, text, { page = false } = {}) {

  return h('span', { class: `fb-comment${page ? ' fb-comment--page' : ''}` },
    page ? h('img', { src: LOGO, alt: '' }) : h('i', { class: 'fb-comment__face' }, who.replace('.', '')),
    h('span', { class: 'fb-comment__bubble' }, h('b', {}, page ? PAGE.short : who), text)
  );

}

export function play(stage, { quick, reduced, lite, content, sound, link }) {

  const tl = timeline({ quick, reduced, lite });
  const items = playlist(link, { posters: 3, text: true });
  const own = items.length > 0 && items[0].own;

  // one post per item, in order; the bundled feed keeps the page's words between its posters
  const specs = items.map((item, i) => ({ item, text: own ? item.text || GENERIC : item.text, time: TIMES[(i + 3) % TIMES.length] }));
  if (!own) {
    pagePosts(content).filter(p => !p.poster).slice(0, specs.length).forEach((extra, i) => specs.splice(i * 2 + 1, 0, { item: null, text: extra.text, time: extra.time }));
  }
  const posts = specs.map((spec, i) => post(spec, LIKES[i % LIKES.length], tl, specs.length > 1));
  const feed = h('div', { class: 'fb-feed' }, posts);
  const count = h('span', { class: 'fb-count__n' });
  const bar = h('div', { class: 'fb-react' },
    h('span', { class: 'fb-react__faces' }, '👍', '❤️', '😮'),
    h('span', { class: 'fb-count' }, count),
    h('span', { class: 'fb-react__like' }, ui('thumb'), 'أعجبني')
  );
  const comments = h('div', { class: 'fb-comments' });
  const field = h('span', { class: 'fb-compose__field' }, 'اكتب تعليق…');
  const compose = h('div', { class: 'fb-compose' }, h('i', { class: 'fb-compose__me' }), field, h('span', { class: 'fb-compose__send' }, ui('send')));
  const viewport = h('div', { class: 'fb-viewport' }, feed, comments);

  const phone = h('div', { class: 'xp-phone fb' },
    h('div', { class: 'fb-top' },
      h('span', { class: 'fb-top__logo' }, iconNode('facebook')),
      h('span', { class: 'fb-top__name' }, h('b', {}, PAGE.facebook), h('i', {}, '١٫٣ ألف متابع')),
      h('span', { class: 'fb-top__follow' }, 'متابَع ✓')
    ),
    viewport,
    bar,
    compose
  );

  stage.append(phone);
  fitWords(feed);

  // the feed at a post: its top under the bar (never past the feed's end)
  let at = 0;
  const offset = i => Math.max(0, Math.min(posts[i].offsetTop - 8, feed.scrollHeight - viewport.clientHeight));
  const show = i => {
    const from = at;
    at = offset(i);
    posts.forEach((p, n) => p.classList.toggle('is-current', n === i));
    feed.style.transform = `translateY(${-at}px)`;
    if (feed.animate && from !== at) feed.animate([{ transform: `translateY(${-from}px)` }, { transform: `translateY(${-at}px)` }], { duration: i === 0 ? 1100 : 900, easing: 'cubic-bezier(.45, 0, .2, 1)' });
    sound('swipe');
    return posts[i].querySelector('.fb-post__media');
  };
  posts[0].classList.add('is-current');

  // the phone rises in, the first post settles
  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 650, easing: SPRING });
  tl.from(feed, [{ transform: 'translateY(40px)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 900, delay: 400, easing: EASE });
  tl.from(bar, [{ transform: 'translateY(100%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 500, delay: 500, easing: EASE });

  const start = 128;
  climb(count, start, tl, { from: 96, steps: REACTIONS.length, start: 700, every: quick ? 120 : 230 });

  REACTIONS.forEach((emoji, i) => {
    tl.at(700 + i * (quick ? 120 : 230), () => {
      float(phone, emoji, { x: 6 + (i % 3) * 7, y: 84, drift: -(26 + i * 6), rise: 150 + (i % 3) * 30, size: 1.25 + (i % 2) * 0.25 });
      if (i % 3 === 0) sound('react');
    });
  });

  // the first comment is there in the final frame
  const first = comment(pick(WHO), COMMENTS[0]);
  comments.append(first);
  tl.from(first, [{ transform: 'translateX(-24px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 450, delay: 2200, easing: SPRING });
  tl.at(2200, () => sound('pop'));

  /* ---------- alive ---------- */

  const settled = 2700;

  // post by post through every item (a clip: once its segment has played), then from the top
  cycle(tl, posts.length, show, { first: posts[0].querySelector('.fb-post__media'), image: 4400, delay: quick ? 800 : 1400 });

  // reactions keep coming from the bar, out over the phone's edge; the count follows
  floats(tl, phone, { glyphs: LIVE, x: [4, 20], y: [84, 88], rise: [120, 190], drift: 46, size: [1.1, 1.5], every: 900, max: 6, delay: settled, name: 'fb-react', sound, cue: 'react' });
  tickUp(tl, count, { from: start, step: [1, 4], every: 2100, delay: settled });

  // comments arrive (now and then the page answers); the oldest leaves
  let said = 1;
  const add = node => {
    comments.append(node);
    [...comments.children].slice(0, -2).forEach(old => old.remove());
    node.animate([{ transform: 'translateX(-24px) scale(.94)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 460, easing: SPRING });
  };
  tl.every(4200, () => {
    said += 1;
    const page = said % 4 === 0;
    add(comment(pick(WHO), page ? pick(PAGE_REPLIES) : COMMENTS[said % COMMENTS.length], { page }));
    sound('pop');
  }, { delay: settled + 900 });

  // the visitor types a comment in the bar, posts it
  const typeOne = () => {
    typeInto(tl, field, pick(['نشوفكم الأحد 🙏', 'موضوع مهم جدًا', 'جاي إن شاء الله ❤️', 'تسلم إيديكم']), {
      sound,
      done: () => {
        add(comment('أنا', field.textContent));
        sound('send');
        field.textContent = 'اكتب تعليق…';
        tl.later(9000, typeOne);
      }
    });
  };
  tl.later(settled + 2600, typeOne);

  // (B) around the phone: reactions out over the edge, comments sliding in, share hints
  spray(tl, stage, {
    every: 1050, max: 7, sound, paths: ['out', 'in', 'out', 'rise'],
    items: () => {
      const roll = Math.random();
      if (roll < 0.28) return { node: bubble(nextComment(), { tone: 'fb', who: pick(WHO) }), path: 'in' };
      if (roll < 0.38) return { node: chip(pick(['↗ شارك', '👍 +١', '💬 رد', '🔁 مشاركة']), 'fb'), path: 'rise' };
      return { text: pick(LIVE), path: 'out', sound: 'react' };
    }
  });

  side(tl, stage, {
    items: () => (Math.random() < 0.6
      ? { node: bubble(nextComment(), { tone: 'fb', who: pick(WHO), meta: pick(['دلوقتي', 'من دقيقة']) }) }
      : { text: pick(LIVE) })
  });

  return tl;

}
