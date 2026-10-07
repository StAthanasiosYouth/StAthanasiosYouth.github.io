/**
 * MAP family: Google Maps and any map link. A calm stylized map (no real
 * tiles, nothing fetched): streets, a bit of sea, the route drawing itself
 * dot by dot to our pin, the pin dropping in with rings.
 *
 * Alive: the pin pulses, a small traveller walks the route, the arrival
 * card breathes; pins and sparkles drift in from the edges.
 * Our own interpretation, not the apps' interfaces.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, spray, side, chip, pick, LOGO, EASE, SPRING } from './kit.js';

/* the route: points in % of the map (from the visitor to the church) */
const ROUTE = [[18, 88], [22, 76], [30, 70], [34, 60], [44, 56], [52, 50], [56, 42], [62, 36], [66, 30]];

function along(points, steps) {

  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    for (let k = 0; k < steps; k++) out.push([x1 + (x2 - x1) * k / steps, y1 + (y2 - y1) * k / steps]);
  }
  out.push(points[points.length - 1]);
  return out;

}

export function play(stage, { quick, reduced, lite, content, sound, link, platform }) {

  const tl = timeline({ quick, reduced, lite });
  const place = (content.location && content.location.name) || link.title;
  const dots = along(ROUTE, 3).map(([x, y]) => {
    const dot = h('i', { class: 'mp-dot' });
    dot.style.left = `${x}%`;
    dot.style.top = `${y}%`;
    return dot;
  });
  const [px, py] = ROUTE[ROUTE.length - 1];
  const rings = [0, 1].map(() => h('span', { class: 'mp-ring' }));
  const pin = h('span', { class: 'mp-pin' }, h('img', { src: LOGO, alt: '' }));
  const spot = h('span', { class: 'mp-spot' }, rings, pin);
  spot.style.left = `${px}%`;
  spot.style.top = `${py}%`;
  const me = h('span', { class: 'mp-me' });
  me.style.left = `${ROUTE[0][0]}%`;
  me.style.top = `${ROUTE[0][1]}%`;
  const walker = h('span', { class: 'mp-walker' });
  const card = h('div', { class: 'mp-card' },
    h('span', { class: 'mp-card__glyph' }, iconNode(platform.icon || 'map')),
    h('span', { class: 'mp-card__text' }, h('b', {}, place), h('span', {}, '🚶 ١٢ دقيقة · الطريق جاهز'))
  );

  const map = h('div', { class: 'mp-map' },
    h('span', { class: 'mp-sea' }),
    h('span', { class: 'mp-park' }),
    h('span', { class: 'mp-road mp-road--a' }), h('span', { class: 'mp-road mp-road--b' }), h('span', { class: 'mp-road mp-road--c' }), h('span', { class: 'mp-road mp-road--d' }),
    dots, me, walker, spot
  );

  const phone = h('div', { class: `xp-phone mp mp--${platform.key}` },
    h('div', { class: 'mp-search' }, iconNode('map'), h('span', {}, place)),
    map,
    card
  );

  stage.append(phone);

  /* ---------- entrance ---------- */

  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 620, easing: SPRING });
  tl.from(map, [{ transform: 'scale(1.18)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 1400, easing: EASE });
  tl.from(me, [{ transform: 'translate(-50%, -50%) scale(0)' }, { transform: 'translate(-50%, -50%)' }], { duration: 420, delay: 400, easing: SPRING });
  dots.forEach((dot, i) => tl.from(dot, [{ opacity: 0, transform: 'translate(-50%, -50%) scale(0)' }, { opacity: 1, transform: 'translate(-50%, -50%)' }], { duration: 260, delay: 600 + i * (quick ? 22 : 55), easing: EASE }));
  const landed = 600 + dots.length * (quick ? 22 : 55);
  tl.from(pin, [{ transform: 'translateY(-60px) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 640, delay: landed, easing: SPRING });
  tl.at(landed + 200, () => sound('like'));
  tl.from(card, [{ transform: 'translateY(100%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 520, delay: landed + 300, easing: EASE });

  /* ---------- alive ---------- */

  const settled = landed + 900;

  rings.forEach((ring, i) => tl.loop(ring, [{ transform: 'translate(-50%, -50%) scale(.4)', opacity: 0.7 }, { transform: 'translate(-50%, -50%) scale(2.4)', opacity: 0 }], { duration: 2400, delay: settled + i * 1200, easing: 'ease-out' }));
  tl.loop(pin, [{ transform: 'none' }, { transform: 'translateY(-4px)' }, { transform: 'none' }], { duration: 2400, delay: settled });

  // a small traveller walks the route, again and again
  const path = along(ROUTE, 1);
  tl.at(settled, () => tl.loop(walker, path.map(([x, y], i) => ({ transform: `translate(${x}cqw, ${y}cqh)`, opacity: i === 0 || i === path.length - 1 ? 0 : 1, offset: i / (path.length - 1) })), { duration: 7000, easing: 'linear' }));

  // (B) around the phone: pins dropping in over its edge, the way, the place
  spray(tl, stage, {
    every: 1500, max: 5, sound, paths: ['drop', 'rise', 'out'],
    items: () => {
      const roll = Math.random();
      if (roll < 0.2) return { node: chip(`📍 ${place}`, 'mp'), path: 'rise' };
      if (roll < 0.32) return { node: chip(pick(['🚶 ١٢ دقيقة', '🚗 ٤ دقايق', '⛪ وصلت']), 'mp'), path: 'rise' };
      return { text: pick(['📍', '📍', '✨', '⛪']), className: 'xp-edge__item--mp', path: 'drop', sound: 'tick' };
    }
  });

  side(tl, stage, { items: () => (Math.random() < 0.4 ? { node: chip(`📍 ${place}`, 'mp') } : { text: pick(['📍', '⛪', '✨']) }) });

  return tl;

}
