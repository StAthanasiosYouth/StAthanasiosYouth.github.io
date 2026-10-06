/**
 * VERTICAL family: Snapchat and any full-screen vertical platform (stories,
 * snaps, reels). Our photos full-bleed (the link's «صور المشهد», else our
 * newest posters), the platform's accent ring and glyph, story progress.
 *
 * Entrance: the first snap opens from the ring. Alive: snaps advance every
 * few seconds (progress bars fill, a soft swipe), reactions rise; emoji
 * drift in from the edges. Our own interpretation, not the apps' interfaces.
 *
 * The "stories" scene uses this same renderer (stories.js).
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, edge, floats, media, pick, LOGO, EASE, SPRING } from './kit.js';

export function play(stage, { quick, reduced, lite, content, sound, link, platform }, variant = 'snap') {

  const tl = timeline({ quick, reduced, lite });
  const pics = media(link, content, 3);
  const count = Math.max(3, pics.length);
  const glyph = platform.icon || (link.icon !== 'link' ? link.icon : 'photos');

  const bars = Array.from({ length: count }, () => h('span', { class: 'vt-bar' }, h('i')));
  const frames = Array.from({ length: count }, (_, i) => h('div', { class: `vt-frame vt-frame--${i % 3}` },
    pics[i] ? h('img', { src: pics[i], alt: '' }) : h('span', { class: 'vt-frame__art' }, iconNode(glyph))
  ));
  const track = h('div', { class: 'vt-track' }, frames);
  track.style.setProperty('--count', String(count));

  const ring = h('span', { class: 'vt-ring' }, h('img', { src: LOGO, alt: '' }));

  const phone = h('div', { class: `xp-phone vt vt--${variant} vt--${platform.key}` },
    h('div', { class: 'vt-viewport' }, track),
    h('div', { class: 'vt-bars' }, bars),
    h('div', { class: 'vt-top' },
      ring,
      h('span', { class: 'vt-top__name' }, 'أسرة البابا أثناسيوس'),
      h('span', { class: 'vt-top__glyph' }, iconNode(glyph))
    ),
    h('div', { class: 'vt-reply' }, h('span', { class: 'vt-reply__field' }, 'ابعت رد…'), h('span', { class: 'vt-reply__heart' }, '♥'))
  );

  stage.append(phone);

  let current = 0;

  const show = index => {
    track.style.transform = `translateX(${-100 * index / count}%)`;
    bars.forEach((bar, i) => {
      bar.firstChild.getAnimations().forEach(a => a.cancel());
      bar.firstChild.style.transform = i < index ? 'scaleX(1)' : 'scaleX(0)';
    });
  };

  // final frame: the first snap, its bar full
  show(0);
  bars[0].firstChild.style.transform = 'scaleX(1)';

  /* ---------- entrance ---------- */

  tl.from(phone, [{ transform: 'scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700, easing: SPRING });
  tl.from(ring, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700, delay: 200, easing: SPRING });
  tl.from(bars[0].firstChild, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: quick ? 900 : 2200, delay: 400, easing: 'linear' });
  tl.at(400, () => sound('open', { passive: true }));

  /* ---------- alive ---------- */

  const settled = quick ? 1300 : 2600;
  const snap = 3400;

  tl.every(snap, () => {
    const from = current;
    current = (current + 1) % count;
    track.animate([{ transform: `translateX(${-100 * from / count}%)` }, { transform: `translateX(${-100 * current / count}%)` }], { duration: 560, easing: EASE });
    show(current);
    bars[current].firstChild.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: snap * (lite ? 1.8 : 1), easing: 'linear', fill: 'forwards' });
    sound('tap', { passive: true });
  }, { jitter: 0, delay: settled });

  floats(tl, phone, { glyphs: ['♥', '😍', '🔥', '👏'], x: [76, 88], y: [84, 90], rise: [110, 170], drift: 16, size: [1, 1.35], every: 1100, max: 5, delay: settled, name: 'vt-react' });

  // (B) from the edges
  const emoji = ['♥', '😍', '🔥', '✨'].concat(platform.key === 'snapchat' ? ['👻'] : []);
  edge(tl, stage, { every: 1400, max: 5, items: () => ({ text: pick(emoji), className: 'xp-edge__item--vt' }) });

  return tl;

}
