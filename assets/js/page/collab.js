/*
 * «بإشراف» A PARTNER: the collaboration ident (docs/EVENTS.md §12). A
 * classic script in the page shell's <head>, so it decides before the first
 * paint; it does nothing unless the stub says <html data-partner="<key>">.
 *
 * About 2.35 s over the whole screen (100vw × 100dvh), the motion in CSS
 * (page.css INTRO), the sound synthesised here on the same clock; main.js
 * renders the page underneath from the first frame:
 *   0.00–0.35  dark stage, letterbox bars slide in        · a low swell rises
 *   0.20–0.70  our seal comes out of the depth on the RIGHT · a whoosh (right)
 *   0.45–0.90  the partner's logo, the same on the LEFT     · a whoosh (left)
 *   0.90–1.20  both turn to the camera and draw toward the centre
 *   1.05–1.45  the mark: two crossing strokes of light, a flare · the hit, a bell
 *   1.25–1.65  the two separate and rise; their names come in under them
 *   1.55–1.95  one light sweep, a few motes                 · an airy sweep, sparkles
 *   1.95–2.35  the bars open, the stage lifts into the page · the tail fades
 *
 * It plays every time the visitor comes into the page (a new load, or the
 * page coming back from the back/forward cache) — never again for a resize,
 * a turn of the phone or a re-render, which never run this script. Skipped
 * with reduced motion, a #hash (deep link), a hidden tab, framed, data
 * saver, the admin preview, and without getAnimations. A weak device gets
 * the same ident without the 3D and the blurs (.cintro--lite).
 *
 * The sound follows the site's own setting (localStorage 'athanasios.sound',
 * on unless 'off'); a browser that won't start audio without a tap on this
 * page just gets the ident in silence. «تخطي» (or any tap, click or key —
 * that first input is spent on it) ends it at once, the sound fading out; a
 * hidden tab ends it; it is gone 3.3 s after it started whatever happens.
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
  var SOUND_KEY = 'athanasios.sound';      // sound.js: the site's one sound setting

  var partner = /^[a-z]{2,12}$/.test(key) && Object.prototype.hasOwnProperty.call(PARTNERS, key) ? PARTNERS[key] : null;
  var script = document.currentScript;

  if (!partner || !script || !script.src) return;

  var root = new URL('../../../', script.src);
  var INPUTS = ['pointerdown', 'keydown', 'wheel'];

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

  function soundOn() {
    try { return localStorage.getItem(SOUND_KEY) !== 'off'; }
    catch (error) { return true; }
  }

  function allowed() {
    return !(
      new URLSearchParams(location.search).has('preview') ||
      html.hasAttribute('data-preview') ||
      (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ||
      location.hash.length > 1 ||
      document.visibilityState === 'hidden' ||
      framed() || saveData() ||
      typeof document.getAnimations !== 'function'
    );
  }

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


  /*
   * THE SOUND: a short cinematic score, synthesised (no file to fetch),
   * every cue at its time on the ident's clock. Quiet by design: one bus,
   * a soft room, a limiter. score(t0) → { stop() } — stop fades it out.
   */
  function score(goAt) {

    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !soundOn()) return null;

    var ctx;
    try { ctx = new Ctx({ latencyHint: 'interactive' }); }
    catch (error) { return null; }

    var stopped = false;
    var master = ctx.createGain();
    master.gain.value = 0;
    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    master.connect(limiter);
    limiter.connect(ctx.destination);

    // a soft room (a generated tail, no file)
    var room = ctx.createConvolver();
    var length = Math.floor(ctx.sampleRate * 1.8);
    var tail = ctx.createBuffer(2, length, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var data = tail.getChannelData(c);
      for (var i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
    }
    room.buffer = tail;
    var wet = ctx.createGain();
    wet.gain.value = 0.32;
    room.connect(wet);
    wet.connect(master);

    var noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    var white = noise.getChannelData(0);
    for (var n = 0; n < white.length; n++) white[n] = Math.random() * 2 - 1;

    function out(node, pan, send) {
      var to = node;
      if (pan && ctx.createStereoPanner) {
        var p = ctx.createStereoPanner();
        p.pan.value = pan;
        node.connect(p);
        to = p;
      }
      to.connect(master);
      if (send) {
        var s = ctx.createGain();
        s.gain.value = send;
        to.connect(s);
        s.connect(room);
      }
    }

    function env(gain, at, peak, attack, release) {
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
    }

    // filtered noise: a whoosh / a riser / a sweep
    function air(at, length, from, to, peak, pan, q, send) {
      var src = ctx.createBufferSource();
      src.buffer = noise;
      var band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = q || 1.2;
      band.frequency.setValueAtTime(from, at);
      band.frequency.exponentialRampToValueAtTime(to, at + length);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + length * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, at + length);
      src.connect(band);
      band.connect(g);
      out(g, pan, send);
      src.start(at);
      src.stop(at + length + 0.05);
    }

    // a tone: a bell partial, a sub, a sparkle
    function tone(at, freq, peak, attack, release, type, pan, send, glideTo) {
      var o = ctx.createOscillator();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, at);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + attack + release);
      var g = ctx.createGain();
      env(g, at, peak, attack, release);
      o.connect(g);
      out(g, pan, send);
      o.start(at);
      o.stop(at + attack + release + 0.05);
    }

    function cues(t0) {
      var now = ctx.currentTime;
      var at = function (s) { return Math.max(now + 0.01, t0 + s); };
      var due = function (s, length) { return t0 + s + length > now + 0.02; };

      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.9, now + 0.12);

      // 0.00 the room opens: a low swell and a rising air
      if (due(0, 1.05)) {
        tone(at(0), 55, 0.22, 0.85, 0.5, 'sine', 0, 0.1);
        tone(at(0), 82.4, 0.08, 0.9, 0.45, 'triangle', 0, 0.2);
        air(at(0.05), 1.0, 260, 2600, 0.07, 0, 0.9, 0.3);
      }
      // 0.20 / 0.45 the two logos come out of the depth (ours right, theirs left)
      if (due(0.2, 0.5)) air(at(0.2), 0.5, 2200, 420, 0.12, 0.55, 1.4, 0.35);
      if (due(0.45, 0.5)) air(at(0.45), 0.5, 2200, 420, 0.12, -0.55, 1.4, 0.35);
      // 1.05 the mark: a soft hit, a sub drop, a metallic shimmer, a gold bell (1.18)
      if (due(1.05, 0.9)) {
        tone(at(1.05), 110, 0.5, 0.005, 0.55, 'sine', 0, 0.15, 38);
        air(at(1.05), 0.12, 5000, 1800, 0.08, 0, 0.8, 0.5);
        [523.25, 1318.5, 2093, 2793.8].forEach(function (f, k) {
          tone(at(1.06 + k * 0.008), f, 0.045, 0.004, 0.9, 'sine', k % 2 ? -0.25 : 0.25, 0.7);
        });
      }
      if (due(1.18, 1.4)) {
        tone(at(1.18), 880, 0.07, 0.006, 1.4, 'sine', 0, 0.8);
        tone(at(1.18), 1318.5, 0.04, 0.006, 1.1, 'sine', 0.15, 0.8);
        tone(at(1.18), 1760, 0.025, 0.006, 0.8, 'sine', -0.15, 0.8);
      }
      // 1.50 the light sweep: air across the stage (left to right), sparkles with the motes
      if (due(1.5, 0.5)) air(at(1.5), 0.5, 2400, 9000, 0.05, 0, 3, 0.6);
      [[1.55, 2637], [1.62, 3136], [1.7, 3951]].forEach(function (cue, k) {
        if (due(cue[0], 0.4)) tone(at(cue[0]), cue[1], 0.018, 0.004, 0.4, 'sine', k - 1 ? 0.4 : -0.4, 0.9);
      });
      // 1.95 the stage lifts: a soft chord and a falling air
      if (due(1.95, 0.9)) {
        tone(at(1.95), 110, 0.06, 0.08, 0.8, 'sine', 0, 0.5);
        tone(at(1.95), 164.8, 0.04, 0.08, 0.8, 'sine', 0, 0.5);
        air(at(1.95), 0.45, 1600, 300, 0.05, 0, 1, 0.4);
      }
    }

    function begin() {
      if (stopped) return;
      // the score is laid on the ident's own clock (it may start a little late)
      var late = (performance.now() - goAt) / 1000;
      cues(ctx.currentTime - Math.max(0, late));
    }

    if (ctx.state === 'running') begin();
    else {
      var resumed = ctx.resume ? ctx.resume() : null;
      if (resumed && resumed.then) resumed.then(function () { if (ctx.state === 'running') begin(); }, function () {});
    }

    return {
      stop: function (fast) {
        if (stopped) return;
        stopped = true;
        try {
          var now = ctx.currentTime;
          master.gain.cancelScheduledValues(now);
          master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
          master.gain.exponentialRampToValueAtTime(0.0001, now + (fast ? 0.18 : 0.6));
        }
        catch (error) { /* closing anyway */ }
        setTimeout(function () { if (ctx.close) ctx.close().catch(function () {}); }, fast ? 300 : 800);
      }
    };

  }


  /* one showing of the ident: built, played, gone */
  function play() {

    if (html.getAttribute('data-collab-state') === 'playing') return;

    html.setAttribute('data-collab', 'full');
    html.setAttribute('data-collab-state', 'playing');

    var timers = [];
    var started = false;
    var sound = null;

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

    // «تخطي»: a real target (any tap anywhere skips too); never in the tab order
    var skip = el('button', 'cintro__skip', 'تخطي');
    skip.type = 'button';
    skip.tabIndex = -1;
    overlay.appendChild(skip);

    // before <body> exists the overlay goes on <html>, over everything, from the first paint
    (document.body || html).appendChild(overlay);

    /* the ident runs once both logos can be drawn (no logo popping in late) */
    function start() {
      if (started || !overlay) return;
      started = true;
      overlay.className += ' is-go';
      sound = score(performance.now());
      timers.push(setTimeout(finish, FULL + 50));
    }

    function decoded(img) {
      return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
    }

    Promise.all([decoded(ours.img), decoded(theirs.img)]).then(start);
    timers.push(setTimeout(start, WAIT));

    function finish(skipped) {
      if (!overlay) return;
      html.setAttribute('data-collab-state', 'done');
      timers.forEach(clearTimeout);
      INPUTS.forEach(function (type) { removeEventListener(type, onInput, true); });
      document.removeEventListener('visibilitychange', onHidden);
      removeEventListener('pagehide', onLeave);
      if (sound) sound.stop(skipped === true);
      sound = null;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
      html.removeAttribute('data-collab');
    }

    /* the first input ends it, and is spent on that: the tap never reaches the page underneath */
    function onInput(event) {
      if (!overlay) return;
      if (event.type !== 'wheel') {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        if (event.type === 'pointerdown') swallowClick();
      }
      finish(true);
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
      if (document.hidden) finish(true);
    }

    function onLeave() {
      finish(true);
    }

    INPUTS.forEach(function (type) { addEventListener(type, onInput, { capture: true, passive: type === 'wheel' }); });
    document.addEventListener('visibilitychange', onHidden);
    addEventListener('pagehide', onLeave);

    overlay.addEventListener('animationend', function (event) {
      if (event.target === overlay && event.animationName === 'cintro-out') finish();
    });

    timers.push(setTimeout(finish, HARD));

  }

  if (allowed()) play();

  // back to this page from the back/forward cache: the visitor came in again
  addEventListener('pageshow', function (event) {
    if (event.persisted && allowed()) play();
  });

}());
