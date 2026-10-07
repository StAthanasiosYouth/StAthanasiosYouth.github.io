/**
 * Facebook: our page's feed — the real weekly posters with their captions,
 * the «صوتكم يهمنا» post, the Pope Athanasius quote — sliding by, reactions
 * bubbling up (👍 ❤️ 😂 😮), comments arriving, a comment typed in the bar
 * and posted. "هنا هتتابع أخبارنا وإعلاناتنا".
 * Alive: the feed drifts between posts, reactions pop out over the
 * phone's edges, comments and replies slide in, shares tick; comment
 * bubbles and «شارك» hints drift around (and beside the sheet on wide
 * screens). Our own interpretation, not Facebook's interface.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { deck, timeline, float, floats, spray, side, pictures, climb, tickUp, typeInto, bubble, chip, pick, compact, digits, LOGO, EASE, SPRING } from './kit.js';
import { PAGE, COMMENTS, PAGE_REPLIES, WHO, pagePosts } from './talk.js';

const nextComment = deck(COMMENTS);

const REACTIONS = ['👍', '❤️', '😮', '👍', '❤️', '👍', '😂', '❤️', '👍'];
const LIVE = ['👍', '❤️', '😂', '😮', '👍', '❤️', '🥰'];

function post({ text, time, src, wide }, likes) {

  const count = h('span', { class: 'fb-post__n' }, compact(likes));
  return h('div', { class: 'fb-post' },
    h('div', { class: 'fb-post__head' },
      h('img', { class: 'fb-post__avatar', src: LOGO, alt: '' }),
      h('span', { class: 'fb-post__who' }, h('b', {}, PAGE.facebook), h('i', {}, `${time} · 🌐`))
    ),
    h('p', { class: 'fb-post__text' }, text),
    src ? h('div', { class: `fb-post__media${wide ? ' is-wide' : ''}` }, h('img', { src, alt: '', decoding: 'async' })) : null,
    h('div', { class: 'fb-post__counts' }, h('span', { class: 'fb-post__faces' }, '👍❤️'), count, h('span', { class: 'fb-post__more' }, `${digits(Math.round(likes / 9))} تعليق · ${digits(Math.round(likes / 30) + 1)} مشاركة`)),
    h('div', { class: 'fb-post__actions' }, h('span', {}, '👍 أعجبني'), h('span', {}, '💬 تعليق'), h('span', {}, '↗ مشاركة'))
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
  const pics = pictures(link, 4);
  const texts = pagePosts(content);
  const own = !!(link.gallery && link.gallery.length);

  // posts: a poster with its caption, the page's words, another poster…
  const specs = [0, 1, 2].map(i => {
    const pic = pics[i];
    const words = i === 1 ? texts.find(t => !t.poster) : null;
    if (words) return { ...words, src: null };
    const fromLibrary = !own && pic && pic.topic;
    return { text: fromLibrary ? texts.find(t => t.poster && t.poster.src === pic.src).text : texts[0].text, time: ['من ساعة', 'امبارح', 'من ٣ أيام'][i], src: pic && pic.src, wide: pic && pic.w > pic.h };
  });
  const posts = specs.map((spec, i) => post(spec, [128, 74, 212][i]));
  const feed = h('div', { class: 'fb-feed' }, posts);
  const count = h('span', { class: 'fb-count__n' });
  const bar = h('div', { class: 'fb-react' },
    h('span', { class: 'fb-react__faces' }, '👍', '❤️', '😮'),
    h('span', { class: 'fb-count' }, count),
    h('span', { class: 'fb-react__like' }, '👍 أعجبني')
  );
  const comments = h('div', { class: 'fb-comments' });
  const field = h('span', { class: 'fb-compose__field' }, 'اكتب تعليق…');
  const compose = h('div', { class: 'fb-compose' }, h('i', { class: 'fb-compose__me' }), field, h('span', { class: 'fb-compose__send' }, '➤'));

  const phone = h('div', { class: 'xp-phone fb' },
    h('div', { class: 'fb-top' },
      h('span', { class: 'fb-top__logo' }, iconNode('facebook')),
      h('span', { class: 'fb-top__name' }, h('b', {}, PAGE.facebook), h('i', {}, '١٫٣ ألف متابع')),
      h('span', { class: 'fb-top__follow' }, 'متابَع ✓')
    ),
    h('div', { class: 'fb-viewport' }, feed, comments),
    bar,
    compose
  );

  stage.append(phone);

  // the phone rises in, the feed scrolls to the second post
  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 650, easing: SPRING });
  tl.from(feed, [{ transform: 'translateY(0)' }, { transform: 'translateY(-30%)' }], { duration: 1600, delay: 900, easing: 'cubic-bezier(.45, 0, .2, 1)' });
  feed.classList.add('is-scrolled');
  tl.at(900, () => sound('swipe'));
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

  // the feed keeps drifting between the posts, slowly
  tl.at(settled, () => tl.loop(feed, [
    { transform: 'translateY(-30%)' },
    { transform: 'translateY(-30%)', offset: 0.2 },
    { transform: 'translateY(-4%)', offset: 0.5 },
    { transform: 'translateY(-4%)', offset: 0.68 },
    { transform: 'translateY(-58%)', offset: 0.9 },
    { transform: 'translateY(-30%)' }
  ], { duration: 14000, easing: 'cubic-bezier(.45, 0, .25, 1)' }));

  // reactions keep coming from the bar, out over the phone's edge; the count follows
  floats(tl, phone, { glyphs: LIVE, x: [4, 20], y: [84, 88], rise: [120, 190], drift: 46, size: [1.1, 1.5], every: 900, max: 6, delay: settled, name: 'fb-react', sound, cue: 'react' });
  tickUp(tl, count, { from: start, step: [1, 4], every: 2100, delay: settled });

  // comments arrive (now and then the page answers); the oldest leaves
  let said = 1;
  const show = node => {
    comments.append(node);
    [...comments.children].slice(0, -2).forEach(old => old.remove());
    node.animate([{ transform: 'translateX(-24px) scale(.94)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 460, easing: SPRING });
  };
  tl.every(4200, () => {
    said += 1;
    const page = said % 4 === 0;
    show(comment(pick(WHO), page ? pick(PAGE_REPLIES) : COMMENTS[said % COMMENTS.length], { page }));
    sound('pop');
  }, { delay: settled + 900 });

  // the visitor types a comment in the bar, posts it
  const typeOne = () => {
    typeInto(tl, field, pick(['نشوفكم الأحد 🙏', 'موضوع مهم جدًا', 'جاي إن شاء الله ❤️', 'تسلم إيديكم']), {
      sound,
      done: () => {
        show(comment('أنا', field.textContent));
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
