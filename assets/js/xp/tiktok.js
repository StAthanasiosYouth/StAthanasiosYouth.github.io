/**
 * TikTok: the link's playlist (kit.js), one after the other, For You
 * style — the admin's own clips (each playing its start → end segment) and
 * pictures (photo posts, slowly panning), in its order, with its words;
 * else our game segments playing for real — short silent moments of
 * «أسئلة سريعة»، «لعبة الـTimer»… (library.js). The side rail counting up,
 * hearts streaming, fast comments, a swipe up to the next item, then from
 * the first again. "فيديوهات قصيرة ولحظات من الخدمة".
 * Alive: the item plays (the scrubber runs), heart bursts out over the
 * phone's edge, comments fly by; hearts, «+١» and comment streaks around
 * (beside the sheet on wide screens). Lite / reduced motion: the poster
 * frames, no video (reduced: the first item, still).
 * Our own interpretation, not TikTok's interface.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { deck, timeline, float, floats, spray, side, climb, tickUp, playlist, cycle, mediaNode, words, fitWords, bubble, chip, pick, compact, LOGO, EASE, SPRING } from './kit.js';
import { PAGE, QUICK, WHO } from './talk.js';

const nextQuick = deck(QUICK);

const ORDER = ['asela', 'timer', 'saboona', 'sot', 'khamen', 'metgawzeen'];

/* a photo post: shown this long (ms), slowly panning */
const PHOTO = 4000;

export function play(stage, { quick, reduced, lite, sound, link }) {

  const tl = timeline({ quick, reduced, lite });
  // the link's own items (admin order), else our game segments
  const items = playlist(link, { posters: 0, clips: ORDER.length, order: ORDER });
  const multi = items.length > 1;

  const slide = item => h('div', { class: 'tt-clip', 'data-item': item.id, 'data-kind': item.kind },
    mediaNode(item, tl, { className: 'tt-clip__media', main: 'tt-clip__video', advance: multi })
  );
  let current = slide(items[0]);
  const clips = h('div', { class: 'tt-clips' }, current);
  const likes = h('span', { class: 'tt-rail__n' });
  const comments = h('span', { class: 'tt-rail__n' });
  const heartButton = h('span', { class: 'tt-rail__btn tt-rail__btn--heart' }, '♥');
  const scrub = h('span', { class: 'tt-scrub' }, h('i'));
  const playIcon = h('span', { class: 'tt-play' }, '▶');
  const text = h('span', { class: 'tt-caption__words' });
  const chips = h('span', { class: 'tt-chips' });

  // the caption follows the item on screen: the admin's words (2 lines, «… المزيد»)
  const say = item => {
    const line = item.own ? item.text || 'من اجتماعنا 🤍 #اجتماع_الشباب #سفاجا' : `${item.caption || 'من اجتماعنا'} 😂🔥 #تحديات_وألعاب #اجتماع_الشباب #سفاجا`;
    text.replaceChildren(words(line, { className: 'tt-caption__text', lines: 2 }));
    if (text.isConnected) fitWords(text);
  };
  say(items[0]);

  const phone = h('div', { class: 'xp-phone tt' },
    h('div', { class: 'tt-viewport' }, clips),
    h('div', { class: 'tt-tabs' }, h('span', {}, 'متابَعين'), h('b', {}, 'For You')),
    playIcon,
    h('div', { class: 'tt-rail' },
      h('img', { class: 'tt-rail__avatar', src: LOGO, alt: '' }),
      h('span', { class: 'tt-rail__item' }, heartButton, likes),
      h('span', { class: 'tt-rail__item' }, h('span', { class: 'tt-rail__btn' }, '💬'), comments),
      h('span', { class: 'tt-rail__item' }, h('span', { class: 'tt-rail__btn' }, '🔖'), h('span', { class: 'tt-rail__n' }, '٨٦')),
      h('span', { class: 'tt-rail__item' }, h('span', { class: 'tt-rail__btn' }, '↗'), h('span', { class: 'tt-rail__n' }, 'شارك'))
    ),
    h('div', { class: 'tt-caption' },
      chips,
      h('span', { class: 'tt-caption__handle' }, iconNode('tiktok'), `@${PAGE.tiktok}`),
      text,
      h('span', { class: 'tt-caption__sound' }, '♫ الصوت الأصلي · St. Athanasios Youth')
    ),
    scrub
  );

  stage.append(phone);
  fitWords(text);

  // a photo post pans slowly while it is on screen
  const pan = node => {
    const img = node.querySelector('img.tt-clip__video');
    if (img && node.dataset.kind === 'image') tl.move(img, [{ transform: 'scale(1)' }, { transform: 'scale(1.08) translateY(-2%)' }], { duration: PHOTO * (lite ? 1.5 : 1) + 600, easing: 'linear' });
  };
  pan(current);

  // a fast comment: initials + words (the newest three stay)
  const comment = () => {
    const node = h('span', { class: 'tt-chip' }, h('b', {}, pick(WHO)), nextQuick());
    chips.append(node);
    [...chips.children].slice(0, -3).forEach(old => old.remove());
    return node;
  };
  const firstA = comment();
  const firstB = comment();

  tl.from(phone, [{ transform: 'translateY(30px) rotate(-1.5deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 650, easing: SPRING });

  // play: the icon pops away, the scrubber runs
  tl.from(playIcon, [{ transform: 'scale(1.4)', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }], { duration: 500, delay: 450, easing: EASE });
  playIcon.classList.add('is-done');
  let running = null;
  tl.at(500, () => { running = tl.loop(scrub.firstChild, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 4200, easing: 'linear' }); });

  climb(likes, 2400, tl, { from: 1760, steps: 10, start: 700, every: quick ? 90 : 190, format: compact });
  climb(comments, 86, tl, { from: 61, steps: 5, start: 900, every: quick ? 150 : 320 });

  // hearts stream from the heart button, out past the phone's edge
  for (let i = 0; i < 9; i++) {
    tl.at(700 + i * (quick ? 90 : 190), () => {
      float(phone, '♥', { x: 92 - (i % 2) * 3, y: 52, drift: -(20 + i * 7), rise: 130 + i * 8, size: 0.9 + (i % 3) * 0.25, className: 'xp-float--tt' });
      if (i % 3 === 1) sound('like');
    });
  }
  tl.at(650, () => heartButton.animate && heartButton.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 380, easing: SPRING }));

  // comments slide in
  tl.from(firstA, [{ transform: 'translateX(-30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 450, delay: 1200, easing: EASE });
  tl.from(firstB, [{ transform: 'translateX(-30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 450, delay: 1600, easing: EASE });

  /* ---------- alive ---------- */

  const settled = 3000;

  // swipe up to the next item (a clip: once its segment has played), then the first again
  const show = i => {
    const old = current;
    current = slide(items[i]);
    clips.append(current);
    say(items[i]);
    pan(current);
    const swipe = clips.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-50%)' }], { duration: 650, easing: 'cubic-bezier(.7, 0, .2, 1)', fill: 'forwards' });
    swipe.finished.then(() => { old.remove(); swipe.cancel(); }, () => old.remove());
    if (running) running.currentTime = 0;
    sound('swipe');
    return current.firstChild;
  };
  cycle(tl, items.length, show, { first: current.firstChild, image: PHOTO, delay: 300 });

  // a calm heart stream from the heart button, the counters following
  floats(tl, phone, { glyphs: ['♥'], x: [86, 96], y: [50, 54], rise: [120, 180], drift: 40, size: [0.8, 1.25], every: 600, max: 7, delay: settled, className: 'xp-float--tt', name: 'tt-heart', sound, cue: 'like' });
  tickUp(tl, likes, { from: 2400, step: [3, 12], every: 1300, format: compact, delay: settled });
  tickUp(tl, comments, { from: 86, step: [1, 2], every: 3000, delay: settled + 900 });

  // fast comments
  tl.every(2100, () => {
    const node = comment();
    node.animate([{ transform: 'translateX(-30px) scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: SPRING });
    sound('pop');
  }, { delay: settled + 1200 });

  // (B) around the phone: heart bursts, «+١», comment streaks flying up
  spray(tl, stage, {
    every: 900, max: 8, sound, paths: ['out', 'cross', 'rise', 'out'],
    items: () => {
      const roll = Math.random();
      if (roll < 0.2) return { node: bubble(nextQuick(), { tone: 'tt', who: pick(WHO) }), path: 'in' };
      if (roll < 0.32) return { node: chip(pick(['+١ ♥', '+٣ ♥', '🔁 +١', '🔖 حفظ']), 'tt'), path: 'rise' };
      return { text: pick(['♥', '♥', '😂', '🔥', '👏']), className: 'xp-edge__item--tt', path: Math.random() < 0.3 ? 'cross' : 'out', sound: Math.random() < 0.5 ? 'like' : '' };
    }
  });

  side(tl, stage, {
    every: 1500,
    items: () => (Math.random() < 0.6 ? { node: bubble(nextQuick(), { tone: 'tt', who: pick(WHO) }) } : { text: pick(['♥', '😂', '🔥']), className: 'xp-edge__item--tt' })
  });

  return tl;

}
