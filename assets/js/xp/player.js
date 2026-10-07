/**
 * PLAYER family: YouTube and any future video platform. One of our game
 * segments playing for real (library.js: a short silent moment), its
 * progress bar, the title, our channel row with the subscribe button,
 * likes, comments and «التالي» thumbnails; skinned by the registry accent.
 *
 * Entrance: the player opens, play is pressed, the bar starts, subscribed ✓.
 * Alive: the video plays (progress), likes tick, comments slide in; play
 * pills, «+١ 👍», «🔔 اشتراك» and hearts drift around the phone (beside
 * the sheet on wide screens). Lite / reduced: the poster frame.
 * Our own interpretation, not the apps' interfaces.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { deck, timeline, spray, side, floats, tickUp, climb, sceneClips, clipNode, bubble, chip, rand, pick, compact, LOGO, EASE, SPRING } from './kit.js';
import { COMMENTS, WHO } from './talk.js';

const nextComment = deck(COMMENTS);

/* the landscape segments: a 16:9 frame shows their whole picture */
const WIDE = ['saboona', 'timer', 'khamen', 'metgawzeen'];

function comment(who, text) {

  return h('span', { class: 'pl-comment' }, h('span', { class: 'pl-comment__avatar' }, who.replace('.', '')), h('span', { class: 'pl-comment__text' }, h('b', {}, `@${who.replace('.', '')} · من ساعة`), text));

}

export function play(stage, { quick, reduced, lite, sound, link, platform }) {

  const tl = timeline({ quick, reduced, lite });
  const glyph = platform.icon || (link.icon !== 'link' ? link.icon : 'video');
  // the link's own videos first (landscape ones lead), then our landscape segments
  const all = sceneClips(link, Infinity, { order: WIDE });
  const clips = all.filter(c => c.own && c.w >= c.h).concat(all.filter(c => c.own && c.w < c.h), all.filter(c => !c.own && WIDE.includes(c.id)));
  const main = clips[0];
  const own = clips[0].own ? null : (link.gallery || []).find(item => item.type !== 'video');

  const video = own ? h('img', { src: own.thumb || own.src, alt: '' }) : clipNode(main, tl);
  const frame = h('span', { class: 'pl-frame' }, video);
  const playButton = h('span', { class: 'pl-play' }, '▶');
  const progress = h('span', { class: 'pl-progress' }, h('i'));
  const time = h('span', { class: 'pl-time' }, '٠:٤٢ / ٢:٠٦');
  const likes = h('b');
  const comments = h('div', { class: 'pl-comments' }, comment('م.', COMMENTS[1]), comment('ك.', COMMENTS[5]));
  const subscribe = h('span', { class: 'pl-sub' }, 'مشترك ✓');

  const phone = h('div', { class: `xp-phone pl pl--${platform.key}` },
    h('div', { class: 'pl-top' }, h('span', { class: 'pl-top__glyph' }, iconNode(glyph)), h('span', { class: 'pl-top__name' }, platform.label || link.title)),
    h('div', { class: 'pl-video' }, frame, playButton, time, progress),
    h('div', { class: 'pl-info' },
      h('span', { class: 'pl-title' }, `${main.caption ? `${main.caption} 😂` : link.title || 'من اجتماعنا'} | تحديات وألعاب أسرة البابا أثناسيوس`),
      h('span', { class: 'pl-stats' }, '١٫٢ ألف مشاهدة · من ٣ أيام'),
      h('span', { class: 'pl-channel' }, h('img', { src: LOGO, alt: '' }), h('span', { class: 'pl-channel__name' }, 'أسرة البابا أثناسيوس'), subscribe),
      h('span', { class: 'pl-actions' }, h('span', { class: 'pl-like' }, '👍 ', likes), h('span', {}, '👎'), h('span', {}, '↗ مشاركة'))
    ),
    h('div', { class: 'pl-more' }, clips.slice(1).filter(c => c.poster).slice(0, 2).map(c => h('span', { class: 'pl-thumb' }, h('img', { src: c.poster, alt: '' }), h('i', {}, c.caption)))),
    comments
  );

  stage.append(phone);

  /* ---------- entrance ---------- */

  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 620, easing: SPRING });
  playButton.classList.add('is-done');
  tl.from(playButton, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1)', opacity: 1, offset: 0.5 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 900, delay: 400, easing: EASE });
  tl.at(800, () => { sound('react'); tl.video(video); });
  tl.from(progress.firstChild, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(.33)' }], { duration: quick ? 900 : 2200, delay: 800, easing: 'linear' });
  tl.from(subscribe, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 500, delay: 1600, easing: EASE });
  tl.at(1600, () => sound('like'));
  [...comments.children].forEach((c, i) => tl.from(c, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 1900 + i * 300, easing: EASE }));

  climb(likes, 1240, tl, { from: 1020, steps: 8, start: 900, every: quick ? 90 : 180, format: compact });

  /* ---------- alive ---------- */

  const settled = 2900;

  tl.at(settled, () => tl.loop(progress.firstChild, [{ transform: 'scaleX(.33)' }, { transform: 'scaleX(1)' }], { duration: 26000, easing: 'linear' }));

  tickUp(tl, likes, { from: 1240, step: [2, 9], every: 1700, format: compact, delay: settled });
  floats(tl, phone, { glyphs: ['👍', '❤️', '👍'], x: [80, 96], y: [52, 58], rise: [90, 140], drift: 40, size: [0.9, 1.25], every: 1400, max: 4, delay: settled, name: 'pl-like', sound, cue: 'react' });

  let n = 2;
  tl.every(3600, () => {
    n += 1;
    const node = comment(WHO[n % WHO.length], COMMENTS[n % COMMENTS.length]);
    comments.prepend(node);
    [...comments.children].slice(3).forEach(old => old.remove());
    node.animate([{ opacity: 0, transform: 'translateY(-12px)' }, { opacity: 1, transform: 'none' }], { duration: 460, easing: EASE });
    sound('pop');
  }, { delay: settled + 800 });

  // (B) around the phone
  spray(tl, stage, {
    every: 1300, max: 6, sound, paths: ['in', 'out', 'rise'],
    items: () => {
      const roll = Math.random();
      if (roll < 0.3) return { node: bubble(nextComment(), { tone: 'pl', who: `@${pick(WHO).replace('.', '')}` }), path: 'in' };
      if (roll < 0.48) return { node: chip(pick(['▶ ٢:٠٦', '👍 +١', '🔔 اشتراك', `👁 ${compact(Math.round(rand(1100, 1600)))}`]), 'pl'), path: 'rise' };
      return { text: pick(['👍', '❤️', '🙏', '🔥']), path: 'out', sound: 'react' };
    }
  });

  side(tl, stage, { items: () => (Math.random() < 0.6 ? { node: bubble(nextComment(), { tone: 'pl' }) } : { node: chip(pick(['▶', '👍 +١', '🔔']), 'pl') }) });

  return tl;

}
