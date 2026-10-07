/**
 * The contact / support cards' small extra life, loaded only once a card
 * is on screen (render.js), never with the page:
 *   - service (the ringing phone): little help signs (؟ 💬 🙏 ♥) rising
 *     softly from the phone with each ring;
 *   - support (the chat): a reaction or two floating up from the ❤️ as it
 *     lands, in step with the chat's own CSS cycle;
 *   - sound (only if the visitor turned sounds on): a soft call pulse as
 *     the finger lands on «اتصال», a "sent" swish on WhatsApp, and the
 *     chat's reply pop + reaction pop once per visit.
 * Calm: at most two signs at a time, paused off screen and in hidden
 * tabs; lite tier: the sounds only; reduced motion: nothing moves.
 */

import { h } from '../dom.js';
import { ambient, rand, pick } from './kit.js';
import { mixer } from './audio.js';

let styles = null;

function stylesheet() {

  if (!styles) {
    styles = new Promise(resolve => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('../../css/xp-cards.css', import.meta.url).href;
      link.onload = link.onerror = resolve;
      document.head.append(link);
    });
  }

  return styles;

}

let heard = false;

export function enhance(stage, kind) {

  if (!stage || stage.dataset.alive) return;
  stage.dataset.alive = kind;

  const tier = document.documentElement.dataset.motion || 'full';
  const sound = mixer({ reduced: tier === 'reduced', lite: tier === 'lite' });
  const card = stage.closest('.person-card');
  const button = card && card.querySelector('.person__actions a');

  // the visitor's own touch: a soft answer (only if sounds are on)
  if (button) button.addEventListener('pointerdown', () => sound(kind === 'ring' ? 'ring' : 'send', { force: true }), { passive: true });

  if (tier !== 'full') return;

  stylesheet().then(() => (kind === 'ring' ? ring(stage) : chat(stage, sound)));

}


/* runs `start` while the stage is on screen and the tab visible */
function whileSeen(stage, engine) {

  let seen = false;
  const update = () => (seen && !document.hidden && stage.isConnected ? engine.resume() : engine.pause());
  new IntersectionObserver(entries => {
    seen = entries.some(entry => entry.isIntersecting);
    update();
  }, { threshold: 0.3 }).observe(stage);
  document.addEventListener('visibilitychange', update);
  engine.pause();

}

function layer(stage) {

  const fx = h('span', { class: 'card-fx', 'aria-hidden': 'true' });
  stage.append(fx);
  return fx;

}


/* the ringing phone: help signs rising from it, with the ring */
function ring(stage) {

  const fx = layer(stage);
  const phone = stage.querySelector('.ring__phone');

  const engine = ambient(fx, {
    every: 3200, jitter: 0.2, max: 2, name: 'card-sign',
    make: () => h('span', { class: 'card-sign' }),
    spawn: node => {
      node.textContent = pick(['؟', '💬', '🙏', '♥', '؟']);
      const box = stage.getBoundingClientRect();
      const at = phone.getBoundingClientRect();
      node.style.left = `${at.left - box.left + at.width * rand(0.25, 0.75)}px`;
      node.style.top = `${at.top - box.top + at.height * 0.2}px`;
      const dx = rand(-22, 22);
      return node.animate([
        { transform: 'translate(-50%, 6px) scale(.6)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.3}px), -10px) scale(1)`, opacity: 0.9, offset: 0.25 },
        { transform: `translate(calc(-50% + ${dx}px), -46px) scale(.9)`, opacity: 0 }
      ], { duration: 2600, easing: 'cubic-bezier(.25, .6, .35, 1)' });
    }
  });

  whileSeen(stage, engine);

}


/* the support chat: in step with its CSS cycle (render.js / main.css) */
function chat(stage, sound) {

  const fx = layer(stage);
  const out = stage.querySelector('.chat__msg--out');
  const heart = stage.querySelector('.chat__reaction');
  if (!out || !heart) return;

  const engine = ambient(fx, {
    every: 0, max: 2, name: 'card-react',
    make: () => h('span', { class: 'card-sign card-sign--react' }),
    spawn: node => {
      node.textContent = pick(['❤️', '🙏', '👍', '❤️']);
      const box = stage.getBoundingClientRect();
      const at = heart.getBoundingClientRect();
      node.style.left = `${at.left - box.left + at.width / 2}px`;
      node.style.top = `${at.top - box.top}px`;
      const dx = rand(-16, 16);
      return node.animate([
        { transform: 'translate(-50%, 0) scale(.5)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.3}px), -12px) scale(1.1)`, opacity: 1, offset: 0.2 },
        { transform: `translate(calc(-50% + ${dx}px), -52px) scale(.9)`, opacity: 0 }
      ], { duration: 2000, easing: 'cubic-bezier(.25, .6, .35, 1)' });
    }
  });

  whileSeen(stage, engine);

  const cycle = Number.parseFloat(getComputedStyle(stage).getPropertyValue('--cycle')) * 1000 || 4400;
  const timers = [];
  const onCycle = event => {
    if (event.target !== out || !event.animationName.startsWith('loop-')) return;
    timers.forEach(clearTimeout);
    timers.length = 0;
    // the reply lands (~45% of the cycle), then the ❤️ (~60%)
    if (!heard) {
      timers.push(setTimeout(() => sound('pop'), cycle * 0.45));
      timers.push(setTimeout(() => { sound('react'); heard = true; }, cycle * 0.6));
    }
    timers.push(setTimeout(() => {
      if (stage.classList.contains('is-looping') && !stage.classList.contains('is-paused')) engine.burst(Math.random() < 0.5 ? 1 : 2);
    }, cycle * 0.6));
  };

  stage.addEventListener('animationstart', onCycle);
  stage.addEventListener('animationiteration', onCycle);

}
