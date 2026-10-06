/**
 * Instagram: a story ring that fills, three vertical frames that swipe,
 * a double-tap heart. "صور وستوريز من كل اجتماع".
 * Then it stays alive: the stories keep playing (bars fill, frames swipe),
 * the ring's gradient turns slowly, hearts rise; hearts and little
 * comment bubbles drift in from the edges.
 * Photos: the link's own («صور المشهد»), else our newest posters.
 * Our own interpretation, not Instagram's interface.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, float, floats, edge, media, lines, pick, LOGO, EASE, SPRING } from './kit.js';

export function play(stage, { quick, reduced, lite, content, sound, link }) {

  const tl = timeline({ quick, reduced, lite });
  const pics = media(link, content, 3);

  const bars = [0, 1, 2].map(() => h('span', { class: 'ig-bar' }, h('i')));
  const frames = [0, 1, 2].map(i => h('div', { class: `ig-frame ig-frame--${i}` },
    pics[i] ? h('img', { src: pics[i], alt: '' }) : null,
    h('span', { class: 'ig-frame__caption' }, h('i'), h('i'))
  ));
  const track = h('div', { class: 'ig-track' }, frames);
  const heart = h('span', { class: 'ig-heart' }, '♥');
  const glow = h('span', { class: 'ig-ring__glow' });
  const ring = h('span', { class: 'ig-ring' }, glow, h('img', { src: LOGO, alt: '' }));

  const phone = h('div', { class: 'xp-phone ig' },
    h('div', { class: 'ig-bars' }, bars),
    h('div', { class: 'ig-top' },
      ring,
      h('span', { class: 'ig-top__name' }, 'pope.athanasius'),
      h('span', { class: 'ig-top__glyph' }, iconNode('instagram'))
    ),
    h('div', { class: 'ig-viewport' }, track),
    heart
  );

  stage.append(phone);

  const step = quick ? 520 : 1000;

  tl.from(phone, [{ transform: 'scale(.92)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 600, easing: SPRING });
  tl.from(ring, [{ transform: 'rotate(-120deg) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 900, delay: 150, easing: SPRING });

  // the bars fill one after the other; the frames swipe with them
  bars.forEach((bar, i) => {
    tl.from(bar.firstChild, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: step, delay: 300 + i * step, easing: 'linear' });
  });

  // the final frame is the third: the track shows it; it travels there
  tl.from(track, [
    { transform: 'translateX(0)' },
    { transform: 'translateX(0)', offset: 0.3 },
    { transform: 'translateX(-33.333%)', offset: 0.42 },
    { transform: 'translateX(-33.333%)', offset: 0.72 },
    { transform: 'translateX(-66.666%)' }
  ], { duration: 300 + 3 * step, easing: EASE });
  tl.at(300 + step * 1.1, () => sound('tap', { passive: true }));
  tl.at(300 + step * 2.1, () => sound('tap', { passive: true }));

  // double tap: a heart
  const tapAt = 300 + step * 1.55;
  tl.from(heart, [
    { transform: 'scale(0)', opacity: 0 },
    { transform: 'scale(0)', opacity: 0, offset: 0.0001 },
    { transform: 'scale(1.25)', opacity: 1, offset: 0.35 },
    { transform: 'scale(1)', opacity: 1, offset: 0.55 },
    { transform: 'scale(1.1)', opacity: 0 }
  ], { duration: 1100, delay: tapAt, easing: EASE });
  heart.classList.add('is-done');
  tl.at(tapAt, () => {
    sound('success', { passive: true });
    for (let i = 0; i < 6; i++) float(phone, '♥', { x: 40 + i * 4, y: 55, drift: (i - 3) * 14, rise: 110 + i * 10, size: 0.9 + (i % 2) * 0.4, className: 'xp-float--ig' });
  });

  /* ---------- alive ---------- */

  const settled = 300 + 3 * step + 200;

  // the ring's gradient turns slowly (the logo stays still)
  tl.loop(glow, [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 6000, easing: 'linear' });

  // the stories keep playing: a bar fills, the next frame slides in
  let current = 2;
  const story = 3600;
  const show = index => {
    track.style.transform = `translateX(${-33.333 * index}%)`;
    bars.forEach((bar, i) => {
      bar.firstChild.getAnimations().forEach(a => a.cancel());
      bar.firstChild.style.transform = i < index ? 'scaleX(1)' : 'scaleX(0)';
    });
    const fill = bars[index].firstChild.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: story * (lite ? 1.8 : 1), easing: 'linear', fill: 'forwards' });
    return fill;
  };

  tl.every(story, () => {
    const from = current;
    current = (current + 1) % 3;
    track.animate([{ transform: `translateX(${-33.333 * from}%)` }, { transform: `translateX(${-33.333 * current}%)` }], { duration: 520, easing: EASE });
    show(current);
    sound('tap', { passive: true });
  }, { jitter: 0, delay: settled + 800 });

  // hearts rise from the bottom corner
  floats(tl, phone, { glyphs: ['♥', '♥', '❤️'], x: [74, 88], y: [82, 90], rise: [120, 180], drift: 18, size: [0.9, 1.3], every: 900, max: 5, delay: settled, className: 'xp-float--ig', name: 'ig-heart' });

  // (B) from the edges
  edge(tl, stage, {
    every: 1300, max: 6,
    items: () => (Math.random() < 0.3 ? { node: h('span', { class: 'xp-bubble xp-bubble--ig' }, lines(1)) } : { text: pick(['♥', '♥', '😍', '🔥']), className: 'xp-edge__item--ig' })
  });

  return tl;

}
