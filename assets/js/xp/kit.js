/**
 * Scene kit for the mini-experiences.
 *
 * A scene builds its FINAL frame in the DOM, then animates from its start
 * state with fill "backwards" (so with reduced motion, nothing animates
 * and the visitor simply sees the finished picture). Everything is
 * cancelled when the sheet closes. Quick mode (later visits) runs faster.
 */

import { h } from '../dom.js';

export const LOGO = 'assets/img/logo-128.webp';

export const EASE = 'cubic-bezier(.16, 1, .3, 1)';
export const SPRING = globalThis.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)')
  ? 'linear(0, 0.079, 0.268, 0.499, 0.724, 0.912, 1.048, 1.129, 1.163, 1.161, 1.136, 1.099, 1.061, 1.027, 1, 0.983, 0.974, 0.972, 0.975, 0.981, 0.987, 0.993, 0.998, 1.002, 1.004, 1.005, 1.004, 1.003, 1.002, 1)'
  : 'cubic-bezier(.34, 1.56, .64, 1)';


export function timeline({ quick = false, reduced = false } = {}) {

  const speed = quick ? 0.4 : 1;
  const timers = new Set();
  const running = new Set();
  let stopped = false;

  return {
    quick,
    reduced,

    /* run fn after ms (scaled); skipped entirely with reduced motion */
    at(ms, fn) {
      if (reduced || stopped) return;
      const id = setTimeout(() => {
        timers.delete(id);
        if (!stopped) fn();
      }, ms * speed);
      timers.add(id);
    },

    /* el.animate from a start state to the element's own (final) state */
    from(el, keyframes, { duration = 500, delay = 0, easing = EASE, iterations = 1 } = {}) {
      if (reduced || stopped || !el || !el.animate) return null;
      const animation = el.animate(keyframes, {
        duration: duration * (quick ? 0.65 : 1),
        delay: delay * speed,
        easing,
        iterations,
        fill: 'backwards'
      });
      running.add(animation);
      animation.finished.then(() => running.delete(animation), () => running.delete(animation));
      return animation;
    },

    stop() {
      stopped = true;
      timers.forEach(clearTimeout);
      timers.clear();
      running.forEach(a => a.cancel());
      running.clear();
    }
  };

}


/* a reaction that floats up from (x, y) in % of the stage, then disappears */
export function float(stage, text, { x = 50, y = 80, drift = 0, rise = 120, size = 1, duration = 1600, className = '' } = {}) {

  const bubble = h('span', { class: `xp-float ${className}`, 'aria-hidden': 'true' }, text);
  bubble.style.insetInlineStart = `${x}%`;
  bubble.style.top = `${y}%`;
  bubble.style.fontSize = `${size}em`;
  stage.append(bubble);

  if (!bubble.animate) {
    bubble.remove();
    return;
  }

  const animation = bubble.animate([
    { transform: 'translate(0, 0) scale(.4)', opacity: 0 },
    { transform: `translate(${drift * 0.3}px, -${rise * 0.25}px) scale(1.15)`, opacity: 1, offset: 0.18 },
    { transform: `translate(${drift}px, -${rise}px) scale(.9)`, opacity: 0 }
  ], { duration, easing: 'cubic-bezier(.2, .6, .3, 1)', fill: 'forwards' });

  animation.finished.then(() => bubble.remove(), () => bubble.remove());

}


/* Arabic digits, for counters */
export const digits = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);


/* a few public poster thumbnails to make the scenes feel like ours */
export function posters(content, count = 3) {

  const images = [];
  const add = image => { if (image && image.thumb && !images.includes(image.thumb)) images.push(image.thumb); };

  (content.news || []).forEach(n => add(n.image));
  (content.activities || []).forEach(a => add(a.image));
  (content.sessions || []).forEach(s => add(s.image));

  return images.slice(0, count);

}


/* a counter that climbs to its target over the scene */
export function climb(el, target, tl, { from = 0, steps = 8, start = 800, every = 220 } = {}) {

  el.textContent = digits(target);

  if (tl.reduced) return;

  el.textContent = digits(from);

  for (let i = 1; i <= steps; i++) {
    tl.at(start + i * every, () => { el.textContent = digits(Math.round(from + (target - from) * (i / steps))); });
  }

}
