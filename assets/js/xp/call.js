/**
 * CALL family: a phone call (and any "call us" platform). Our logo in the
 * middle, the call ringing (waves going out), the green answer button
 * breathing, «بيرن…».
 *
 * Alive: the waves keep going out, the phone glyph rings now and then;
 * small hearts and dots drift in from the edges. Calm, never loud.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, edge, pick, LOGO, SPRING } from './kit.js';

export function play(stage, { quick, reduced, lite, sound, link, platform }) {

  const tl = timeline({ quick, reduced, lite });
  const waves = [0, 1, 2].map(() => h('span', { class: 'cl-wave' }));
  const avatar = h('span', { class: 'cl-avatar' }, waves, h('img', { src: LOGO, alt: '' }));
  const answer = h('span', { class: 'cl-btn cl-btn--answer' }, iconNode('phone'));
  const status = h('span', { class: 'cl-status' }, 'بيرن…');

  const phone = h('div', { class: `xp-phone cl cl--${platform.key}` },
    h('div', { class: 'cl-head' }, h('span', { class: 'cl-name' }, link.title || platform.label), status),
    avatar,
    h('div', { class: 'cl-actions' },
      h('span', { class: 'cl-btn cl-btn--decline' }, iconNode('phone')),
      answer
    )
  );

  stage.append(phone);

  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 620, easing: SPRING });
  tl.from(avatar, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700, delay: 200, easing: SPRING });
  tl.at(600, () => sound('pop', { passive: true }));

  // the waves go out, one after another, all the time
  waves.forEach((wave, i) => tl.loop(wave, [
    { transform: 'scale(.8)', opacity: 0.55 },
    { transform: 'scale(1.9)', opacity: 0 }
  ], { duration: 2400, delay: 500 + i * 800, easing: 'cubic-bezier(.2, .6, .35, 1)' }));

  tl.loop(answer, [{ transform: 'none' }, { transform: 'scale(1.1)', offset: 0.15 }, { transform: 'none', offset: 0.3 }, { transform: 'none' }], { duration: 1600, delay: 800 });

  // the glyph rings now and then
  tl.every(2600, () => {
    if (answer.firstChild.animate) answer.firstChild.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-14deg)' }, { transform: 'rotate(12deg)' }, { transform: 'rotate(-8deg)' }, { transform: 'rotate(0)' }], { duration: 600 });
  }, { delay: 1200, jitter: 0.1 });

  edge(tl, stage, { every: 1700, max: 4, items: () => ({ text: pick(['♥', '📞', '✨']), className: 'xp-edge__item--cl' }) });

  return tl;

}
