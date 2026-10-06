/**
 * MAIL family: email and any "write to us" platform. An envelope arrives,
 * opens, the letter rises with our logo; the inbox below fills.
 *
 * Alive: new messages arrive in the inbox now and then (unread dot, the
 * oldest leaves), the letter floats gently; little envelopes drift in
 * from the edges.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, edge, lines, rand, pick, LOGO, EASE, SPRING } from './kit.js';

function row(unread = false) {

  return h('div', { class: `ml-row${unread ? ' is-unread' : ''}` }, h('img', { src: LOGO, alt: '' }), lines(2), h('i', { class: 'ml-dot' }));

}

export function play(stage, { quick, reduced, lite, sound, platform }) {

  const tl = timeline({ quick, reduced, lite });
  const flap = h('span', { class: 'ml-flap' });
  const letter = h('span', { class: 'ml-letter' }, h('img', { src: LOGO, alt: '' }), lines(3));
  const envelope = h('span', { class: 'ml-envelope' }, h('span', { class: 'ml-back' }), letter, h('span', { class: 'ml-front' }), flap);
  const rows = [row(true), row(), row()];
  const inbox = h('div', { class: 'ml-inbox' }, rows);

  const phone = h('div', { class: `xp-phone ml ml--${platform.key}` },
    h('div', { class: 'ml-top' }, h('span', { class: 'ml-top__glyph' }, iconNode(platform.icon || 'mail')), h('span', {}, 'الوارد'), h('b', { class: 'ml-badge' }, '١')),
    h('div', { class: 'ml-stage' }, envelope),
    inbox
  );

  stage.append(phone);

  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 620, easing: SPRING });
  tl.from(envelope, [{ transform: 'translate(-120px, -40px) rotate(-14deg) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 760, delay: 250, easing: SPRING });
  tl.from(flap, [{ transform: 'rotateX(0)' }, { transform: 'rotateX(0)', offset: 0.3 }, { transform: 'rotateX(180deg)' }], { duration: 700, delay: 900, easing: EASE });
  tl.from(letter, [{ transform: 'translateY(46%)' }, { transform: 'translateY(46%)', offset: 0.4 }, { transform: 'none' }], { duration: 1100, delay: 1000, easing: EASE });
  tl.at(1400, () => sound('success', { passive: true }));
  rows.forEach((r, i) => tl.from(r, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 1500 + i * 160, easing: EASE }));

  const settled = 2600;

  tl.at(settled, () => tl.loop(letter, [{ transform: 'none' }, { transform: 'translateY(-5px)' }, { transform: 'none' }], { duration: 3200 }));

  // new mail arrives at the top; the oldest leaves
  tl.ambient(inbox, {
    every: 3800, max: 3, recycle: true, delay: settled + 600, name: 'ml-row',
    make: () => row(true),
    spawn: node => {
      node.classList.add('is-unread');
      node.children[1].lastChild.style.width = `${Math.round(rand(35, 75))}%`;
      inbox.prepend(node);
      [...inbox.children].slice(3).forEach(old => { if (!old.classList.contains('xp-amb')) old.remove(); });
      [...inbox.children].slice(1).forEach(old => old.classList.remove('is-unread'));
      sound('pop', { passive: true });
      return node.animate([{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 460, easing: EASE });
    }
  });

  edge(tl, stage, { every: 1600, max: 4, items: () => ({ text: pick(['✉️', '💌', '✨']), className: 'xp-edge__item--ml' }) });

  return tl;

}
