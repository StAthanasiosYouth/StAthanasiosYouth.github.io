/*
 * «بإشراف» A PARTNER: the collaboration ident (docs/EVENTS.md §12). A
 * classic script in the page shell's <head>, so it decides before the first
 * paint; it does nothing unless the stub says <html data-partner="<key>">.
 *
 * About 2.35 s, CSS only (page.css INTRO), no sound — a short cinematic
 * logo reveal over the page, which main.js renders underneath from the
 * first frame:
 *   0.00–0.35  dark stage, letterbox bars slide in
 *   0.20–0.70  our seal comes out of the depth on the RIGHT (3D turn, blur off, gold halo)
 *   0.45–0.90  the partner's logo, in its own colours, the same on the LEFT
 *   0.90–1.20  both turn to the camera and draw toward the centre
 *   1.05–1.45  the mark: two crossing strokes of light (gold × the partner's spectrum), a flare
 *   1.25–1.65  the two separate and rise; their names come in under them
 *   1.55–1.95  one light sweep, a few motes
 *   1.95–2.35  the bars open, the stage lifts and fades into the page
 *
 * Plays once a session per partner, with motion allowed, no #hash (deep
 * links), a visible tab, not framed, no data saver, not the admin preview,
 * and getAnimations. A weak device gets the same ident without the 3D and
 * the blurs (.cintro--lite). It starts when both logos are decoded (or after
 * 700 ms). Any tap, click or key skips it (that first input is spent on it);
 * a hidden tab ends it; it is gone 3.3 s after it started whatever happens.
 * The overlay is aria-hidden and never takes focus.
 */
(function () {

  'use strict';

  var html = document.documentElement;
  var key = html.getAttribute('data-partner') || '';

  // the partners this ident knows (pictures committed under assets/img/partners/, transparent)
  var PARTNERS = {
    bug: {
      name: 'Brave Under Grace',
      logo: 'assets/img/partners/bug-symbol-320.webp',
      logo2x: 'assets/img/partners/bug-symbol-640.webp',
      w: 640,
      h: 213
    }
  };

  var OURS = {
    name: 'أسرة البابا أثناسيوس',
    logo: 'assets/img/partners/athanasios-family-240.webp',
    logo2x: 'assets/img/partners/athanasios-family-480.webp',
    w: 480,
    h: 486
  };

  var FULL = 2350;      // ms; page.css INTRO uses the same times
  var WAIT = 700;       // the longest it waits for the logos
  var HARD = 3300;      // gone after this, whatever happens
  var DUST = 7;

  var partner = /^[a-z]{2,12}$/.test(key) && Object.prototype.hasOwnProperty.call(PARTNERS, key) ? PARTNERS[key] : null;
  var script = document.currentScript;

  if (!partner || !script || !script.src) return;

  var SESSION_KEY = 'athanasios:collab:' + key;

  /* a phone that would stutter through blurs and 3D: the light version */
  function weak() {
    var cores = navigator.hardwareConcurrency || 8;
    var memory = navigator.deviceMemory || 8;
    return cores <= 4 && memory <= 4 || memory <= 2;
  }

  function saveData() {
    return !!(navigator.connection && navigator.connection.saveData);
  }

  function framed() {
    try { return window.top !== window.self; }
    catch (error) { return true; }
  }

  function seenThisSession() {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; }
    catch (error) { return true; }      // no storage: never risk replaying it on every page
  }

  if (
    new URLSearchParams(location.search).has('preview') ||
    html.hasAttribute('data-preview') ||
    (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ||
    location.hash.length > 1 ||
    document.visibilityState === 'hidden' ||
    framed() || saveData() ||
    typeof document.getAnimations !== 'function' ||
    seenThisSession()
  ) {
    return;
  }

  try { sessionStorage.setItem(SESSION_KEY, '1'); }
  catch (error) { /* it plays this once anyway */ }

  html.setAttribute('data-collab', 'full');
  html.setAttribute('data-collab-state', 'playing');

  var root = new URL('../../../', script.src);
  var timers = [];
  var INPUTS = ['pointerdown', 'keydown', 'wheel'];
  var started = false;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function picture(className, who) {
    var img = el('img', className);
    img.src = new URL(who.logo, root).href;
    img.srcset = new URL(who.logo, root).href + ' 1x, ' + new URL(who.logo2x, root).href + ' 2x';
    img.width = who.w;
    img.height = who.h;
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    return img;
  }

  /* one identity: its logo over its glow, its name under it */
  function side(className, who, logoClass, nameClass) {
    var node = el('div', 'cintro__side ' + className);
    var emblem = el('div', 'cintro__emblem');
    emblem.appendChild(el('span', 'cintro__aura'));
    var img = picture(logoClass, who);
    emblem.appendChild(img);
    node.appendChild(emblem);
    var name = el('p', 'cintro__name ' + nameClass);
    name.appendChild(el('bdi', '', who.name));
    node.appendChild(name);
    return { node: node, img: img };
  }

  var overlay = el('div', 'cintro' + (weak() ? ' cintro--lite' : ''));
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('data-partner', key);

  overlay.appendChild(el('span', 'cintro__bar cintro__bar--top'));
  overlay.appendChild(el('span', 'cintro__bar cintro__bar--bottom'));
  overlay.appendChild(el('span', 'cintro__ambient'));

  var scene = el('div', 'cintro__scene');
  var ours = side('cintro__side--ours', OURS, 'cintro__seal', 'cintro__name--ours');
  var theirs = side('cintro__side--partner', partner, 'cintro__logo', 'cintro__name--partner');

  var mark = el('div', 'cintro__mark');
  mark.appendChild(el('span', 'cintro__stroke cintro__stroke--gold'));
  mark.appendChild(el('span', 'cintro__stroke cintro__stroke--spectrum'));
  mark.appendChild(el('span', 'cintro__ring'));
  mark.appendChild(el('span', 'cintro__flare'));

  scene.appendChild(ours.node);
  scene.appendChild(mark);
  scene.appendChild(theirs.node);

  for (var i = 1; i <= DUST; i++) scene.appendChild(el('span', 'cintro__mote cintro__mote--' + i));

  scene.appendChild(el('span', 'cintro__sweep'));
  overlay.appendChild(scene);
  overlay.appendChild(el('p', 'cintro__skip', 'اضغط للتخطي'));

  // <body> doesn't exist yet: the overlay goes on <html>, over everything, from the first paint
  html.appendChild(overlay);

  /* the ident runs once both logos can be drawn (no logo popping in late) */
  function start() {
    if (started || !overlay) return;
    started = true;
    overlay.className += ' is-go';
    timers.push(setTimeout(finish, FULL + 50));
  }

  function decoded(img) {
    return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
  }

  Promise.all([decoded(ours.img), decoded(theirs.img)]).then(start);
  timers.push(setTimeout(start, WAIT));

  function finish() {
    if (html.getAttribute('data-collab-state') === 'done') return;
    html.setAttribute('data-collab-state', 'done');
    timers.forEach(clearTimeout);
    INPUTS.forEach(function (type) { removeEventListener(type, onInput, true); });
    document.removeEventListener('visibilitychange', onHidden);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    html.removeAttribute('data-collab');
  }

  /* the first input ends it, and is spent on that: the tap never reaches the page underneath */
  function onInput(event) {
    if (html.getAttribute('data-collab-state') === 'done') return;
    if (overlay && event.type !== 'wheel') {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      if (event.type === 'pointerdown') swallowClick();
    }
    finish();
  }

  function swallowClick() {
    var stop = function (event) {
      event.preventDefault();
      event.stopPropagation();
      removeEventListener('click', stop, true);
    };
    addEventListener('click', stop, true);
    setTimeout(function () { removeEventListener('click', stop, true); }, 800);
  }

  function onHidden() {
    if (document.hidden) finish();
  }

  INPUTS.forEach(function (type) { addEventListener(type, onInput, { capture: true, passive: type === 'wheel' }); });
  document.addEventListener('visibilitychange', onHidden);

  overlay.addEventListener('animationend', function (event) {
    if (event.target === overlay && event.animationName === 'cintro-out') finish();
  });

  timers.push(setTimeout(finish, HARD));

}());
