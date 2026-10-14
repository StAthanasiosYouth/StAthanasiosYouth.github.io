/*
 * «بإشراف» A PARTNER: the intro (docs/EVENTS.md §12). A classic script in
 * the page shell's <head>, so it decides before the first paint; it does
 * nothing unless the stub says <html data-partner="<key>">.
 *
 * Full (≤ 1.6 s, CSS only, no sound): our arch logo centred → it slides to
 * its side while the gold hairline draws → the partner's logo comes in on
 * its light plate, the halo glints once → «أسرة البابا أثناسيوس × …» → the
 * overlay lifts away onto the hero lockup, which main.js renders underneath
 * from the first frame (page.css COLLAB).
 * Short (≤ 0.5 s): no overlay; the hero lockup cross-fades in place
 * (<html data-collab="short">).
 *
 * Plays only with a partner, motion allowed, no #hash (deep links), a
 * visible tab, not framed, not a weak device / data saver, not the admin
 * preview, and getAnimations. Once a session per partner; the full version
 * for the first 3 sessions, then the short one; not again within 6 hours.
 * Any tap or key skips it (the overlay takes only that first input); a
 * hidden tab ends it; after 2 s it is gone whatever happens. The overlay is
 * aria-hidden and never takes focus.
 */
(function () {

  'use strict';

  var html = document.documentElement;
  var key = html.getAttribute('data-partner') || '';

  // the partners this intro knows (their names in the line; pictures committed under assets/img/partners/)
  var PARTNERS = {
    bug: { name: 'Brave Under Grace', logo: 'assets/img/partners/bug-logo-720.webp', w: 720, h: 305 }
  };

  var FULL = 1600;      // ms; page.css COLLAB uses the same times
  var SHORT = 500;
  var HARD = 2000;      // the overlay is gone after this, whatever happens
  var QUIET = 6 * 3600 * 1000;
  var FULL_SESSIONS = 3;

  var partner = /^[a-z]{2,12}$/.test(key) && Object.prototype.hasOwnProperty.call(PARTNERS, key) ? PARTNERS[key] : null;
  var script = document.currentScript;

  if (!partner || !script || !script.src) return;

  var SESSION_KEY = 'athanasios:collab:' + key;
  var LOCAL_KEY = 'athanasios.collab.v1:' + key;

  function weak() {
    var cores = navigator.hardwareConcurrency || 8;
    var memory = navigator.deviceMemory || 8;
    return cores <= 4 && memory <= 4 || memory <= 2 || !!(navigator.connection && navigator.connection.saveData);
  }

  function framed() {
    try { return window.top !== window.self; }
    catch (error) { return true; }
  }

  function seenThisSession() {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; }
    catch (error) { return true; }      // no storage: never risk replaying it on every page
  }

  /* { n: sessions it played in, last: when (ms) } */
  function played() {
    try {
      var raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        var n = Math.floor(Number(raw.n));
        var last = Number(raw.last);
        return { n: n > 0 && n < 1e6 ? n : 0, last: last > 0 && isFinite(last) ? last : 0 };
      }
    }
    catch (error) { /* a broken entry counts as never */ }
    return { n: 0, last: 0 };
  }

  if (
    new URLSearchParams(location.search).has('preview') ||
    html.hasAttribute('data-preview') ||
    (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ||
    location.hash.length > 1 ||
    document.visibilityState === 'hidden' ||
    framed() || weak() ||
    typeof document.getAnimations !== 'function' ||
    seenThisSession()
  ) {
    return;
  }

  var now = Date.now();
  var before = played();

  // seen within the last 6 hours (in another session): not now
  if (before.last && now >= before.last && now - before.last < QUIET) return;

  var mode = before.n < FULL_SESSIONS ? 'full' : 'short';

  try { sessionStorage.setItem(SESSION_KEY, '1'); }
  catch (error) { /* it plays this once anyway */ }
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ n: before.n + 1, last: now })); }
  catch (error) { /* private mode: still fine */ }

  html.setAttribute('data-collab', mode);
  html.setAttribute('data-collab-state', 'playing');

  var root = new URL('../../../', script.src);
  var overlay = null;
  var timers = [];
  var INPUTS = ['pointerdown', 'keydown', 'wheel'];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function picture(className, path, w, h) {
    var img = el('img', className);
    img.src = new URL(path, root).href;
    img.width = w;
    img.height = h;
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    return img;
  }

  if (mode === 'full') {
    overlay = el('div', 'cintro');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('data-partner', key);

    var inner = el('div', 'cintro__inner');
    var stage = el('div', 'cintro__stage');

    var ours = el('span', 'cintro__ours');
    ours.appendChild(picture('cintro__seal', 'assets/img/logo-256.webp', 256, 256));

    var x = el('span', 'cintro__x');
    x.appendChild(el('span', 'cintro__line'));
    x.appendChild(el('span', 'cintro__times', '×'));
    x.appendChild(el('span', 'cintro__line'));

    var theirs = el('span', 'cintro__partner');
    var plate = el('span', 'cintro__plate');
    plate.appendChild(picture('cintro__logo', partner.logo, partner.w, partner.h));
    theirs.appendChild(el('span', 'cintro__halo'));
    theirs.appendChild(plate);

    stage.appendChild(ours);
    stage.appendChild(x);
    stage.appendChild(theirs);

    var words = el('p', 'cintro__words');
    words.appendChild(document.createTextNode('أسرة البابا أثناسيوس × '));
    var name = el('bdi', '', partner.name);
    words.appendChild(name);

    inner.appendChild(stage);
    inner.appendChild(words);
    overlay.appendChild(inner);

    // <body> doesn't exist yet: the overlay goes on <html>, over everything, from the first paint
    html.appendChild(overlay);
  }

  function finish() {
    if (html.getAttribute('data-collab-state') === 'done') return;
    html.setAttribute('data-collab-state', 'done');
    timers.forEach(clearTimeout);
    INPUTS.forEach(function (type) { removeEventListener(type, onInput, true); });
    document.removeEventListener('visibilitychange', onHidden);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    // a later re-render of the page doesn't replay the short cross-fade
    timers.push(setTimeout(function () { html.removeAttribute('data-collab'); }, mode === 'short' ? SHORT : 0));
  }

  /* the first input ends it, and is spent on that: the tap never reaches the page underneath */
  function onInput(event) {
    if (html.getAttribute('data-collab-state') === 'done') return;
    var covering = !!overlay;
    if (covering && event.type !== 'wheel') {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      if (event.type === 'pointerdown') swallowClick();
    }
    finish();
    if (mode === 'short') html.removeAttribute('data-collab');
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

  if (overlay) {
    overlay.addEventListener('animationend', function (event) {
      if (event.target === overlay && event.animationName === 'cintro-out') finish();
    });
  }
  timers.push(setTimeout(finish, mode === 'full' ? FULL + 50 : SHORT + 1500));
  timers.push(setTimeout(finish, HARD));

}());
