/**
 * BROWSER: the generic branded scene, for ANY link that has no family of
 * its own ("web", or a key this version of the site doesn't know yet).
 * Built only from the link itself: its icon, title, subtitle and domain,
 * in the platform's accent (gold for our own).
 *
 * Entrance (the launch): the address bar types the domain, the page loads,
 * the icon tile springs up with a ring of light, the title rises.
 * Alive: a slow light sweep over the tile, sparkles around it, the
 * loading line shimmering now and then; sparkles drift in from the edges.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, spray, side, floats, pick, EASE, SPRING } from './kit.js';
import { hostOf } from './engine.js';

export function play(stage, { quick, reduced, lite, sound, link, platform }) {

  const tl = timeline({ quick, reduced, lite });
  const glyph = link.icon && link.icon !== 'link' ? link.icon : (platform.icon || 'link');
  const domain = hostOf(link.url);

  const address = h('span', { class: 'br-address__text' }, domain);
  const loading = h('span', { class: 'br-loading' }, h('i'));
  const sweep = h('span', { class: 'br-sweep' });
  const halo = h('span', { class: 'br-halo' });
  const tile = h('span', { class: 'br-tile' }, iconNode(glyph), sweep);
  const title = h('span', { class: 'br-title' }, link.title || platform.label || domain);
  const sub = link.subtitle ? h('span', { class: 'br-sub' }, link.subtitle) : null;
  const blocks = h('span', { class: 'br-blocks' },
    h('span', { class: 'br-block' }, h('b', {}, '✦ من أسرة البابا أثناسيوس'), h('span', {}, link.subtitle || 'كل التفاصيل هنا')),
    h('span', { class: 'br-block' }, h('b', {}, '↗ ' + domain), h('span', {}, 'افتح اللينك من الزرار تحت')));

  const phone = h('div', { class: `xp-phone br br--${platform.key}` },
    h('div', { class: 'br-bar' },
      h('span', { class: 'br-dots' }, h('i'), h('i'), h('i')),
      h('span', { class: 'br-address' }, h('span', { class: 'br-lock' }, '🔒'), address),
      loading
    ),
    h('div', { class: 'br-page' },
      h('span', { class: 'br-hero' }, halo, tile),
      title,
      sub,
      h('span', { class: 'br-domain' }, domain),
      blocks
    )
  );

  stage.append(phone);

  /* ---------- the launch ---------- */

  tl.from(phone, [{ transform: 'translateY(30px) scale(.94)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 640, easing: SPRING });
  tl.from(address, [{ opacity: 0, transform: 'translateX(14px)' }, { opacity: 1, transform: 'none' }], { duration: quick ? 300 : 600, delay: 250, easing: EASE });
  tl.from(loading.firstChild, [{ transform: 'scaleX(0)', opacity: 1 }, { transform: 'scaleX(.7)', opacity: 1, offset: 0.6 }, { transform: 'scaleX(1)', opacity: 0 }], { duration: 1200, delay: 500, easing: EASE });
  loading.firstChild.classList.add('is-done');
  tl.from(halo, [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 900, delay: 800, easing: EASE });
  tl.from(tile, [{ transform: 'scale(.2) rotate(-14deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 820, delay: 850, easing: SPRING });
  tl.at(850, () => sound('pop'));
  [title, sub, blocks].filter(Boolean).forEach((node, i) => tl.from(node, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 1150 + i * 140, easing: EASE }));
  tl.from(sweep, [{ transform: 'translateX(-130%) skewX(-18deg)' }, { transform: 'translateX(130%) skewX(-18deg)' }], { duration: 900, delay: 1500, easing: 'ease-in-out' });

  /* ---------- alive ---------- */

  const settled = 2500;

  tl.at(settled, () => {
    tl.loop(sweep, [{ transform: 'translateX(-130%) skewX(-18deg)' }, { transform: 'translateX(-130%) skewX(-18deg)', offset: 0.7 }, { transform: 'translateX(130%) skewX(-18deg)' }], { duration: 4200, easing: 'ease-in-out' });
    tl.loop(halo, [{ transform: 'scale(1)', opacity: 0.85 }, { transform: 'scale(1.12)', opacity: 1 }, { transform: 'scale(1)', opacity: 0.85 }], { duration: 3600 });
  });

  floats(tl, phone, { glyphs: ['✦', '✧', '·'], x: [26, 72], y: [30, 40], rise: [40, 80], drift: 30, size: [0.8, 1.3], every: 900, max: 5, delay: settled, className: 'xp-float--br', name: 'br-spark' });

  spray(tl, stage, { every: 1300, max: 5, paths: ['orbit', 'out', 'rise'], items: () => ({ text: pick(['✦', '✧', '✨']), className: 'xp-edge__item--br' }) });

  side(tl, stage, { items: () => ({ text: pick(['✦', '✧', '✨']), className: 'xp-edge__item--br' }) });

  return tl;

}
