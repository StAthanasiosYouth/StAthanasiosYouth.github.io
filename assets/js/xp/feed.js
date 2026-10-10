/**
 * FEED family: X, Threads, and any future "timeline" platform. A column of
 * short posts from us — the meeting line, the Pope Athanasius quote — and
 * one post per item of the link's playlist (kit.js: the admin's own
 * pictures and clips, in its order, each with its own words, and its
 * words-only posts; else the weekly posters), with the action row,
 * skinned by the registry.
 *
 * Entrance: the timeline drops in post by post, a like lands. Alive: the
 * next playlist item arrives as a new post at the top (a clip plays its
 * segment first; after the last, the first again), now and then a text
 * post between them, under a «منشورات جديدة» pill, likes and
 * reposts tick, hearts pop out over the edge; replies, «🔁 +١» and hearts
 * drift around (beside the sheet on wide screens).
 * Our own interpretation, not the apps' interfaces.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { deck, timeline, spray, side, floats, playlist, cycle, mediaNode, words as say, fitWords, FEED, bubble, chip, rand, pick, compact, meetingLine, LOGO, EASE, SPRING } from './kit.js';
import { PAGE, COMMENTS, WHO, TIMES, channelPosts } from './talk.js';

const nextComment = deck(COMMENTS);

const HANDLE = '@stathanasios';

/* an own picture or clip the admin left without words */
const GENERIC = 'من اجتماعنا 🤍 كل أحد الساعة ٨ مساءً';

function post({ item = null, text, likes = 40, time = 'من ساعة' }, tl = null, advance = false) {

  const like = h('b', { 'data-n': likes }, compact(likes));
  const repost = h('b', { 'data-n': Math.round(likes / 4) }, compact(Math.round(likes / 4)));

  return h('div', { class: 'fd-post', 'data-item': item ? item.id : null },
    h('img', { class: 'fd-post__avatar', src: LOGO, alt: '' }),
    h('span', { class: 'fd-post__body' },
      h('span', { class: 'fd-post__who' }, h('b', {}, PAGE.short), h('span', { class: 'fd-post__handle' }, `${HANDLE} · ${time}`)),
      say(text, { className: 'fd-post__text', lines: 7, more: '… عرض المزيد' }),
      item && item.kind !== 'text' ? mediaNode(item, tl, { className: 'fd-post__photo', ratio: FEED, advance }) : null,
      h('span', { class: 'fd-post__actions' },
        h('span', {}, '💬 ', compact(Math.round(likes / 9))),
        h('span', { class: 'fd-repost' }, '🔁 ', repost),
        h('span', { class: 'fd-like' }, '♥ ', like),
        h('span', {}, '↗')
      )
    )
  );

}

export function play(stage, { quick, reduced, lite, content, sound, link, platform }) {

  const tl = timeline({ quick, reduced, lite });
  const items = playlist(link, { posters: 3, text: true });
  const own = items.length > 0 && items[0].own;
  const textOf = item => (item.own ? item.text || GENERIC : item.topic ? `«${item.topic}» 🤍 شكرًا لكل اللي جه` : item.text);
  const multi = items.length > 1;
  const glyph = platform.icon || (link.icon !== 'link' ? link.icon : 'megaphone');
  const words = channelPosts(content);

  const posts = [
    post({ text: meetingLine(content, 'كل الجديد هنا أول بأول ✨'), likes: 128, time: 'من ٥ دقايق' }),
    items[0] ? post({ item: items[0], text: textOf(items[0]), likes: 312, time: 'من ساعتين' }, tl, multi) : post({ text: words[2], likes: 312, time: 'من ساعتين' }),
    post({ text: `${PAGE.quote}\n— ${PAGE.quoteBy}`, likes: 57, time: 'امبارح' })
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
  fitWords(list);

  /* ---------- entrance ---------- */

  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 620, easing: SPRING });
  posts.forEach((p, i) => {
    tl.from(p, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 450 + i * (quick ? 140 : 280), easing: EASE });
  });

  const firstLike = posts[0].querySelector('.fd-like');
  tl.at(1700, () => {
    firstLike.classList.add('is-on');
    if (firstLike.animate) firstLike.animate([{ transform: 'scale(1.5)' }, { transform: 'none' }], { duration: 420, easing: SPRING });
    sound('like');
  });
  if (reduced) firstLike.classList.add('is-on');

  /* ---------- alive ---------- */

  const settled = 2600;
  let n = 0;

  // a new post slides in at the top; the oldest goes
  const arrive = node => {
    list.prepend(node);
    fitWords(node);
    [...list.children].slice(5).forEach(old => old.remove());
    if (pill.animate) pill.animate([{ transform: 'translate(-50%, -16px)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%, 0)', opacity: 1, offset: 0.8 }, { transform: 'translate(-50%, -10px)', opacity: 0 }], { duration: 2200, easing: EASE });
    sound('notify');
    node.animate([{ opacity: 0, transform: 'translateY(-30px)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: EASE });
    list.animate([{ transform: 'translateY(-34px)' }, { transform: 'none' }], { duration: 520, easing: EASE });
    return node;
  };

  // the playlist, item after item at the top (all of them, in order, then again)
  cycle(tl, items.length, index => {
    const node = arrive(post({ item: items[index], text: textOf(items[index]), likes: Math.round(rand(20, 90)), time: TIMES[0] }, tl, multi));
    return node.querySelector('.fd-post__photo');
  }, { first: posts[1].querySelector('.fd-post__photo'), image: 5200, delay: settled });

  // now and then words only between them (ours: only when the admin wrote none)
  if (!own) tl.every(9800, () => {
    n += 1;
    arrive(post({ text: n % 2 ? words[(n + 1) % words.length] : `${nextComment()}`, likes: Math.round(rand(8, 40)), time: TIMES[0] }));
  }, { delay: settled + 5600 });

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

  floats(tl, phone, { glyphs: ['♥'], x: [8, 30], y: [72, 86], rise: [90, 150], drift: 40, size: [0.9, 1.3], every: 1200, max: 4, delay: settled, className: 'xp-float--fd', name: 'fd-heart', sound, cue: 'like' });

  // (B) around the phone
  spray(tl, stage, {
    every: 1300, max: 6, sound, paths: ['in', 'out', 'rise'],
    items: () => {
      const roll = Math.random();
      if (roll < 0.4) return { node: bubble(nextComment(), { tone: 'fd', who: `@${pick(WHO).replace('.', '')}` }), path: 'in' };
      if (roll < 0.55) return { node: chip(pick(['🔁 +١', '♥ +٣', '💬 رد جديد']), 'fd'), path: 'rise' };
      return { text: pick(['♥', '🔁', '💬', '♥']), className: 'xp-edge__item--fd', path: 'out', sound: 'react' };
    }
  });

  side(tl, stage, { items: () => (Math.random() < 0.6 ? { node: bubble(pick(words), { tone: 'fd' }) } : { text: pick(['♥', '🔁']), className: 'xp-edge__item--fd' }) });

  return tl;

}
