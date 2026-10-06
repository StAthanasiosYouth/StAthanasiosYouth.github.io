/**
 * TikTok: a vertical clip playing, the side rail (heart, comments, share)
 * counting up, hearts streaming, comments sliding in, a quick swipe to the
 * next clip. "فيديوهات قصيرة ولحظات من الخدمة".
 * Then it stays alive: a calm heart stream, counters, new comments, the
 * progress bar running, now and then a swipe to the other clip; hearts
 * and emoji drift in from the edges.
 * Our own interpretation, not TikTok's interface.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, float, floats, edge, climb, tickUp, media, lines, rand, pick, compact, LOGO, EASE, SPRING } from './kit.js';

function clip(index, src) {

  return h('div', { class: `tt-clip tt-clip--${index}` },
    src ? h('img', { class: 'tt-clip__img', src, alt: '' }) : null,
    h('span', { class: 'tt-blob tt-blob--a' }),
    h('span', { class: 'tt-blob tt-blob--b' })
  );

}

export function play(stage, { quick, reduced, lite, content, sound, link }) {

  const tl = timeline({ quick, reduced, lite });
  const pics = media(link, content, 2);
  const clips = h('div', { class: 'tt-clips' }, clip(0, pics[0]), clip(1, pics[1]));
  const likes = h('span', { class: 'tt-rail__n' });
  const comments = h('span', { class: 'tt-rail__n' });
  const heartButton = h('span', { class: 'tt-rail__btn tt-rail__btn--heart' }, '♥');
  const scrub = h('span', { class: 'tt-scrub' }, h('i'));
  const playIcon = h('span', { class: 'tt-play' }, '▶');
  const chipA = h('span', { class: 'tt-chip' }, h('i'), h('i'));
  const chipB = h('span', { class: 'tt-chip' }, h('i'));
  const chips = h('span', { class: 'tt-chips' }, chipA, chipB);

  const phone = h('div', { class: 'xp-phone tt' },
    h('div', { class: 'tt-viewport' }, clips),
    playIcon,
    h('div', { class: 'tt-rail' },
      h('img', { class: 'tt-rail__avatar', src: LOGO, alt: '' }),
      h('span', { class: 'tt-rail__item' }, heartButton, likes),
      h('span', { class: 'tt-rail__item' }, h('span', { class: 'tt-rail__btn' }, '💬'), comments),
      h('span', { class: 'tt-rail__item' }, h('span', { class: 'tt-rail__btn' }, '↗'))
    ),
    h('div', { class: 'tt-caption' },
      h('span', { class: 'tt-caption__handle' }, iconNode('tiktok'), '@stathanasios.safaga'),
      h('span', { class: 'tt-caption__lines' }, h('i'), h('i')),
      chips
    ),
    scrub
  );

  stage.append(phone);

  tl.from(phone, [{ transform: 'translateY(30px) rotate(-1.5deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 650, easing: SPRING });

  // play: the icon pops away, the scrubber runs
  tl.from(playIcon, [{ transform: 'scale(1.4)', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }], { duration: 500, delay: 450, easing: EASE });
  playIcon.classList.add('is-done');
  tl.from(scrub.firstChild, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: quick ? 1300 : 2800, delay: 500, easing: 'linear' });

  climb(likes, 2400, tl, { from: 1760, steps: 10, start: 700, every: quick ? 90 : 190, format: compact });
  climb(comments, 86, tl, { from: 61, steps: 5, start: 900, every: quick ? 150 : 320 });

  // hearts stream from the heart button
  for (let i = 0; i < 9; i++) {
    tl.at(700 + i * (quick ? 90 : 190), () => {
      float(phone, '♥', { x: 86 - (i % 2) * 3, y: 52, drift: (i % 2 ? 1 : -1) * (6 + i), rise: 120 + i * 6, size: 0.9 + (i % 3) * 0.2, className: 'xp-float--tt' });
      if (i % 3 === 1) sound('tap', { passive: true });
    });
  }
  tl.at(650, () => heartButton.animate && heartButton.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 380, easing: SPRING }));

  // comments slide in
  tl.from(chipA, [{ transform: 'translateX(-30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 450, delay: 1200, easing: EASE });
  tl.from(chipB, [{ transform: 'translateX(-30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 450, delay: 1600, easing: EASE });

  // swipe up to the next clip (the final frame shows clip 2)
  tl.from(clips, [
    { transform: 'translateY(0)' },
    { transform: 'translateY(0)', offset: 0.7 },
    { transform: 'translateY(-50%)' }
  ], { duration: quick ? 1000 : 2600, delay: 300, easing: 'cubic-bezier(.7, 0, .2, 1)' });
  tl.at(quick ? 1000 : 2400, () => sound('open', { passive: true }));

  /* ---------- alive ---------- */

  const settled = 3000;

  // the clip keeps playing: the progress bar loops
  tl.at(settled, () => tl.loop(scrub.firstChild, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 6000, easing: 'linear' }));

  // a calm heart stream from the heart button, the counters following
  floats(tl, phone, { glyphs: ['♥'], x: [80, 88], y: [50, 54], rise: [110, 160], drift: 14, size: [0.8, 1.2], every: 650, max: 6, delay: settled, className: 'xp-float--tt', name: 'tt-heart' });
  tickUp(tl, likes, { from: 2400, step: [3, 12], every: 1500, format: compact, delay: settled });
  tickUp(tl, comments, { from: 86, step: [1, 2], every: 3800, delay: settled + 900 });

  // a new comment arrives; the oldest one leaves
  tl.ambient(chips, {
    every: 3200, max: 3, recycle: true, delay: settled + 1500, name: 'tt-comment',
    make: () => h('span', { class: 'tt-chip' }, h('i'), h('i')),
    spawn: node => {
      node.lastChild.style.width = `${Math.round(rand(30, 70))}%`;
      chips.append(node);
      [...chips.children].slice(0, -3).forEach(old => old.remove());
      return node.animate([{ transform: 'translateX(-30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 450, easing: EASE });
    }
  });

  // now and then: swipe to the other clip
  let shown = 1;
  tl.every(7000, () => {
    const from = shown;
    shown = 1 - shown;
    clips.style.transform = `translateY(${-50 * shown}%)`;
    clips.animate([{ transform: `translateY(${-50 * from}%)` }, { transform: `translateY(${-50 * shown}%)` }], { duration: 700, easing: 'cubic-bezier(.7, 0, .2, 1)' });
    sound('open', { passive: true });
  }, { jitter: 0.15, delay: settled + 4000 });

  // (B) from the edges
  edge(tl, stage, {
    every: 1200, max: 6,
    items: () => (Math.random() < 0.25 ? { node: h('span', { class: 'xp-bubble xp-bubble--tt' }, lines(1)) } : { text: pick(['♥', '♥', '😂', '🔥', '👏']), className: 'xp-edge__item--tt' })
  });

  return tl;

}
