/**
 * THE SITE'S SOUND, ON EVERY PAGE THAT BELONGS TO IT: the service pages,
 * events, competitions, «نقاطي / المتجر». The same synthesised UI sounds
 * and the same one setting as the home page (sound.js: 'athanasios.sound',
 * on unless the visitor turned it off — here or on the home page).
 *
 *   soundToggle(bar)   the 🔊/🔇 button in the page's top bar (once; before
 *                      its «ارجع للموقع» link when there is one)
 *   uiSounds(scope)    a light tap for buttons and links, delegated
 *   cue(name)          a named sound: open, close, pop, success, important…
 *
 * Nothing sounds before the visitor's first tap on the page (browsers'
 * rules; sound.js wakes on it), in a hidden tab, or with the setting off.
 */

import { play, soundEnabled, setSoundEnabled } from './sound.js';

const SVG = 'http://www.w3.org/2000/svg';

// the home page's own speaker drawings (icons.js 'sound-on' / 'sound-off')
const ICONS = {
  on: ['M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z', 'M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11'],
  off: ['M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z', 'm16 9.5 5 5M21 9.5l-5 5']
};

const TAPS = 'button, a.btn, a[class*="__home"], a[class*="__cta"], .mcard__open, [role="button"]';
// these make their own sound (a sheet opening, the speaker) or none
const QUIET = '.usound, .xp-sound, [data-quiet], [aria-haspopup="dialog"], .sheet__close, .xp-clip__toggle, .cintro__skip';

let wired = false;

export function cue(name, options) {
  play(name, options);
}

export { soundEnabled };


function speaker(on) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'usound__icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  ICONS[on ? 'on' : 'off'].forEach((d, i) => {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    if (i === 0) path.setAttribute('class', 'usound__body');
    svg.appendChild(path);
  });
  return svg;
}


/* the toggle: the same words and behaviour as the home page's */
export function soundToggle(bar) {

  if (!bar || bar.querySelector('.usound')) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'usound';

  const paint = () => {
    const on = soundEnabled();
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'أصوات الواجهة: شغالة' : 'أصوات الواجهة: مقفولة');
    button.title = on ? 'اقفل الأصوات' : 'شغّل الأصوات';
    button.replaceChildren(speaker(on));
  };

  button.addEventListener('click', () => {
    setSoundEnabled(!soundEnabled());
    paint();
    if (soundEnabled()) play('success');
    document.dispatchEvent(new CustomEvent('athanasios:sound', { detail: { on: soundEnabled(), from: '' } }));
  });

  // another tab (the home page) changed it, or a sheet's own speaker did
  addEventListener('storage', event => { if (event.key === 'athanasios.sound') paint(); });
  document.addEventListener('athanasios:sound', event => { if (event.detail && event.detail.from) paint(); });

  paint();
  const home = bar.querySelector('a[class$="__home"]');
  if (home) home.before(button);
  else bar.appendChild(button);
  return button;

}


/* a light tap for every button and link that does something, delegated once */
export function uiSounds(scope = document) {

  if (wired) return;
  wired = true;

  scope.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest(TAPS) : null;
    if (!target || target.closest(QUIET) || target.disabled || target.getAttribute('aria-disabled') === 'true') return;
    play('tap');
  });

}
