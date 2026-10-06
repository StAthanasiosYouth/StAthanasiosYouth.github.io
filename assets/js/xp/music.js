/**
 * MUSIC family: Spotify and any future audio platform. "Now playing": the
 * cover (our photo, or our logo on the accent), the title, an equalizer,
 * the progress bar and the controls; skinned by the registry accent.
 *
 * Entrance: the cover drops in, play is pressed, the equalizer wakes up.
 * Alive: the song plays on (progress, equalizer, the cover breathing with
 * the beat), notes rise; notes drift in from the edges.
 * Our own interpretation, not the apps' interfaces.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, edge, floats, media, pick, LOGO, EASE, SPRING } from './kit.js';

const BARS = 14;

export function play(stage, { quick, reduced, lite, content, sound, link, platform }) {

  const tl = timeline({ quick, reduced, lite });
  const pics = media(link, content, 1);
  const glyph = platform.icon || (link.icon !== 'link' ? link.icon : 'music');

  const cover = h('span', { class: 'mu-cover' }, pics[0] ? h('img', { src: pics[0], alt: '' }) : h('img', { class: 'mu-cover__logo', src: LOGO, alt: '' }));
  const eq = h('span', { class: 'mu-eq' }, Array.from({ length: BARS }, () => h('i')));
  const progress = h('span', { class: 'mu-progress' }, h('i'), h('b'));
  const playButton = h('span', { class: 'mu-play' }, h('span', { class: 'mu-play__pause' }));

  const phone = h('div', { class: `xp-phone mu mu--${platform.key}` },
    h('div', { class: 'mu-top' }, h('span', { class: 'mu-top__down' }, '⌄'), h('span', { class: 'mu-top__what' }, 'بيشتغل دلوقتي'), h('span', { class: 'mu-top__glyph' }, iconNode(glyph))),
    cover,
    h('div', { class: 'mu-meta' },
      h('span', { class: 'mu-title' }, link.subtitle || 'ترانيم الاجتماع'),
      h('span', { class: 'mu-artist' }, 'أسرة البابا أثناسيوس'),
      h('span', { class: 'mu-heart' }, '♥')
    ),
    eq,
    progress,
    h('div', { class: 'mu-time' }, h('span', {}, '١:٢٤'), h('span', {}, '٤:٠٨')),
    h('div', { class: 'mu-controls' }, h('span', {}, '⇄'), h('span', {}, '⏮'), playButton, h('span', {}, '⏭'), h('span', {}, '↻'))
  );

  stage.append(phone);

  const bars = [...eq.children];
  const heights = bars.map((_, i) => (0.35 + 0.6 * Math.abs(Math.sin(i * 1.7))).toFixed(2));
  bars.forEach((bar, i) => { bar.style.transform = `scaleY(${heights[i]})`; });

  /* ---------- entrance ---------- */

  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 620, easing: SPRING });
  tl.from(cover, [{ transform: 'translateY(-20px) scale(.85) rotate(-4deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 760, delay: 200, easing: SPRING });
  tl.from(playButton, [{ transform: 'scale(1)' }, { transform: 'scale(.82)', offset: 0.4 }, { transform: 'none' }], { duration: 420, delay: 900, easing: EASE });
  tl.at(900, () => sound('tap', { passive: true }));
  bars.forEach((bar, i) => tl.from(bar, [{ transform: 'scaleY(.08)' }, { transform: `scaleY(${heights[i]})` }], { duration: 500, delay: 1000 + i * 30, easing: SPRING }));
  tl.from(progress.firstChild, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(.34)' }], { duration: quick ? 900 : 2000, delay: 900, easing: 'linear' });

  /* ---------- alive ---------- */

  const settled = 2400;

  tl.at(settled, () => {
    // the equalizer dances (each bar its own pace), the cover breathes
    bars.forEach((bar, i) => tl.loop(bar, [
      { transform: `scaleY(${heights[i]})` },
      { transform: `scaleY(${(0.2 + 0.8 * Math.abs(Math.sin(i * 2.3 + 1))).toFixed(2)})` },
      { transform: `scaleY(${(0.15 + 0.5 * Math.abs(Math.cos(i * 1.3))).toFixed(2)})` },
      { transform: `scaleY(${heights[i]})` }
    ], { duration: 900 + (i % 5) * 170, easing: 'ease-in-out' }));
    tl.loop(cover, [{ transform: 'scale(1)' }, { transform: 'scale(1.025)', offset: 0.12 }, { transform: 'scale(1)', offset: 0.5 }, { transform: 'scale(1)' }], { duration: 500, easing: 'ease-out' });
    tl.loop(progress.firstChild, [{ transform: 'scaleX(.34)' }, { transform: 'scaleX(1)' }], { duration: 30000, easing: 'linear' });
  });

  floats(tl, phone, { glyphs: ['♪', '♫', '♪'], x: [30, 70], y: [40, 50], rise: [70, 120], drift: 26, size: [1, 1.5], every: 1300, max: 4, delay: settled, className: 'xp-float--mu', name: 'mu-note' });

  // (B) from the edges
  edge(tl, stage, { every: 1300, max: 5, items: () => ({ text: pick(['♪', '♫', '♪', '♥']), className: 'xp-edge__item--mu' }) });

  return tl;

}
