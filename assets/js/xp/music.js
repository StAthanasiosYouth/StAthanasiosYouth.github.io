/**
 * MUSIC family: Spotify and any future audio platform. "Now playing": the
 * cover (our poster, or our logo on the accent), the title — the meeting's
 * hymns, or a podcast episode named after a real topic — an equalizer,
 * the progress bar and the controls; skinned by the registry accent.
 *
 * Entrance: the cover drops in, play is pressed, the equalizer wakes up.
 * Alive: the track plays (progress, equalizer, the cover breathing), now
 * and then the next track (the cover and title change); notes, small
 * equalizers and «التالي» pills drift around the phone.
 * Our own interpretation, not the apps' interfaces.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, spray, side, floats, pictures, chip, pick, LOGO, EASE, SPRING } from './kit.js';
import { POSTERS } from './library.js';

const BARS = 14;

export function play(stage, { quick, reduced, lite, sound, link, platform }) {

  const tl = timeline({ quick, reduced, lite });
  const pics = pictures(link, 3, { wide: false });
  const glyph = platform.icon || (link.icon !== 'link' ? link.icon : 'music');

  // the queue: the link's own words first, then episodes named after real topics
  const queue = [
    { title: link.subtitle || 'ترانيم اجتماع الأحد', src: pics[0] && pics[0].src },
    ...POSTERS.slice(0, 4).map(p => ({ title: `بودكاست الاجتماع · «${p.topic}»`, src: p.w < p.h ? p.src : null }))
  ];
  let playing = 0;

  const coverImg = queue[0].src ? h('img', { src: queue[0].src, alt: '' }) : h('img', { class: 'mu-cover__logo', src: LOGO, alt: '' });
  const cover = h('span', { class: 'mu-cover' }, coverImg);
  const title = h('span', { class: 'mu-title' }, queue[0].title);
  const eq = h('span', { class: 'mu-eq' }, Array.from({ length: BARS }, () => h('i')));
  const progress = h('span', { class: 'mu-progress' }, h('i'), h('b'));
  const playButton = h('span', { class: 'mu-play' }, h('span', { class: 'mu-play__pause' }));

  const phone = h('div', { class: `xp-phone mu mu--${platform.key}` },
    h('div', { class: 'mu-top' }, h('span', { class: 'mu-top__down' }, '⌄'), h('span', { class: 'mu-top__what' }, 'بيشتغل دلوقتي'), h('span', { class: 'mu-top__glyph' }, iconNode(glyph))),
    cover,
    h('div', { class: 'mu-meta' },
      title,
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
  tl.at(900, () => sound('react'));
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

  // the next track: the cover and the title change
  tl.every(9000, () => {
    playing = (playing + 1) % queue.length;
    const track = queue[playing];
    title.textContent = track.title;
    coverImg.className = track.src ? '' : 'mu-cover__logo';
    coverImg.src = track.src || LOGO;
    cover.animate([{ transform: 'translateX(-30px) scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 520, easing: SPRING });
    title.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 400, easing: EASE });
    sound('swipe');
  }, { jitter: 0.1, delay: settled + 6000 });

  floats(tl, phone, { glyphs: ['♪', '♫', '♪'], x: [10, 90], y: [34, 48], rise: [80, 140], drift: 60, size: [1, 1.5], every: 1200, max: 5, delay: settled, className: 'xp-float--mu', name: 'mu-note' });

  // (B) around the phone: notes, little equalizers, what's next
  const mini = () => h('span', { class: 'xp-eq' }, h('i'), h('i'), h('i'), h('i'));
  spray(tl, stage, {
    every: 1250, max: 6, sound, paths: ['out', 'rise', 'orbit'],
    items: () => {
      const roll = Math.random();
      if (roll < 0.18) return { node: mini(), path: 'rise' };
      if (roll < 0.3) return { node: chip(`⏭ التالي: ${queue[(playing + 1) % queue.length].title.replace('بودكاست الاجتماع · ', '')}`, 'mu'), path: 'in' };
      if (roll < 0.38) return { node: chip('♥ اتضافت للمفضلة', 'mu'), path: 'rise', sound: 'like' };
      return { text: pick(['♪', '♫', '♪', '♥']), className: 'xp-edge__item--mu', path: pick(['out', 'orbit']) };
    }
  });

  side(tl, stage, { items: () => (Math.random() < 0.4 ? { node: chip(`♪ ${pick(queue).title}`, 'mu') } : { text: pick(['♪', '♫']), className: 'xp-edge__item--mu' }) });

  return tl;

}
