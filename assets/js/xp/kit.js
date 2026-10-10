/**
 * Scene kit for the mini-experiences.
 *
 * A scene builds its FINAL frame in the DOM, then animates from its start
 * state with fill "backwards" (so with reduced motion, nothing animates
 * and the visitor simply sees the finished picture). Everything is
 * cancelled when the sheet closes. Quick mode (later visits) runs faster.
 *
 * After the entrance, scenes stay alive with AMBIENT activity (reactions,
 * new messages, counters…), all through one pooled engine (ambient()):
 *   - a cap of live nodes per layer; nodes are recycled, never piled up
 *   - transform / opacity only
 *   - paused while the tab is hidden, gone when the sheet closes
 *   - lite tier: slower and fewer, no edge layer; reduced motion: nothing
 *
 * Decorative reactions never live inside the phone: they float in the
 * stage's OUTER effects layer (.xp-fx, a sibling of the phone over the
 * whole stage and the sheet's side padding), so they cross the phone's
 * edges unclipped. The layer ends with the stage (it can never cover the
 * sheet's button or its close button) and never takes a pointer.
 */

import { h } from '../dom.js';
import { DAY_NAMES, formatTime } from '../words.js';
import { POSTERS, CLIPS } from './library.js';
import { caption } from './talk.js';

export const LOGO = 'assets/img/logo-128.webp';

export const EASE = 'cubic-bezier(.16, 1, .3, 1)';
export const SPRING = globalThis.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)')
  ? 'linear(0, 0.079, 0.268, 0.499, 0.724, 0.912, 1.048, 1.129, 1.163, 1.161, 1.136, 1.099, 1.061, 1.027, 1, 0.983, 0.974, 0.972, 0.975, 0.981, 0.987, 0.993, 0.998, 1.002, 1.004, 1.005, 1.004, 1.003, 1.002, 1)'
  : 'cubic-bezier(.34, 1.56, .64, 1)';

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = list => list[Math.floor(Math.random() * list.length)];


/**
 * One scene's clock: the entrance (at, from), loops and ambient layers.
 * Options: quick (later visits), reduced (prefers-reduced-motion), lite
 * (weak phone / data saver: fewer, slower, no edge layer).
 */
export function timeline({ quick = false, reduced = false, lite = false } = {}) {

  const speed = quick ? 0.4 : 1;
  const timers = new Set();
  const running = new Set();
  const loops = new Set();
  const layers = new Set();
  const moving = new Set();
  const waits = new Set();
  const videos = new Set();
  const owned = new Set();
  let stopped = false;
  let hidden = typeof document !== 'undefined' && document.hidden;

  let held = [];

  const onVisibility = () => {
    if (stopped) return;
    hidden = document.hidden;
    // everything moving inside the scene (one-off pops and counters too)
    if (hidden) {
      held = tl.root && tl.root.getAnimations ? tl.root.getAnimations({ subtree: true }).filter(a => a.playState === 'running') : [];
      held.forEach(a => a.pause());
    }
    else {
      held.forEach(a => a.play());
      held = [];
    }
    loops.forEach(a => (hidden ? a.pause() : a.play()));
    moving.forEach(a => (hidden ? a.pause() : a.play()));
    layers.forEach(layer => (hidden ? layer.pause() : layer.resume()));
    waits.forEach(wait => (hidden ? wait.pause() : wait.resume()));
    videos.forEach(video => (hidden ? video.pause() : video.play().catch(() => {})));
  };

  if (!reduced) document.addEventListener('visibilitychange', onVisibility);

  const tl = {
    quick,
    reduced,
    lite,
    speed,
    root: null,      // the stage (set by the engine): all of it pauses in a hidden tab

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

    /* a continuous animation (paused in hidden tabs, cancelled on stop) */
    loop(el, keyframes, { duration = 4000, delay = 0, easing = 'ease-in-out', direction = 'normal' } = {}) {
      if (reduced || stopped || !el || !el.animate) return null;
      const animation = el.animate(keyframes, {
        duration: duration * (lite ? 1.4 : 1),
        delay: delay * speed,
        easing,
        direction,
        iterations: Infinity
      });
      if (hidden) animation.pause();
      loops.add(animation);
      return animation;
    },

    /*
     * A move that STAYS: el animates to the last keyframe and keeps it
     * (committed to its style when done). For scenes that run a long loop
     * (voice.js). Paused in hidden tabs, cancelled on stop.
     */
    move(el, keyframes, { duration = 500, delay = 0, easing = EASE } = {}) {
      if (reduced || stopped || !el || !el.animate) return null;
      const animation = el.animate(keyframes, { duration, delay, easing, fill: 'both' });
      if (hidden) animation.pause();
      moving.add(animation);
      animation.finished.then(() => {
        moving.delete(animation);
        if (stopped) return;
        try { animation.commitStyles(); } catch { /* detached */ }
        animation.cancel();
      }, () => moving.delete(animation));
      return animation;
    },

    /* run fn after ms (not scaled), the clock paused while the tab is hidden */
    later(ms, fn) {
      if (reduced || stopped) return null;
      let id = 0;
      let left = ms;
      let since = 0;
      const wait = {
        pause() { if (!id) return; clearTimeout(id); id = 0; left -= performance.now() - since; },
        resume() { if (id || stopped) return; since = performance.now(); id = setTimeout(done, Math.max(0, left)); },
        cancel() { clearTimeout(id); id = 0; waits.delete(wait); }
      };
      const done = () => { id = 0; waits.delete(wait); if (!stopped) fn(); };
      waits.add(wait);
      if (!hidden) wait.resume();
      return wait;
    },

    /* a pooled ambient layer (see ambient() below) */
    ambient(layer, options) {
      if (reduced || stopped || !layer || (lite && options.edge)) return null;
      const engine = ambient(layer, { ...options, lite, delay: (options.delay || 0) * speed, hidden: () => hidden });
      layers.add(engine);
      return engine;
    },

    /* fn every ms (± jitter), as long as the scene lives (no nodes) */
    every(ms, fn, { jitter = 0.3, delay = 0 } = {}) {
      return tl.ambient(document.createElement('i'), { every: ms, jitter, delay, max: 0, spawn: fn });
    },

    /* a <video> of the scene: plays while open and visible, unloaded on stop */
    video(el, on = true) {
      if (reduced || stopped || !el || !el.play) return null;
      if (!on) {
        videos.delete(el);
        el.pause();
        // a playlist clip that isn't on screen keeps nothing loaded
        if (el.dataset.src && el.getAttribute('src')) {
          el.removeAttribute('src');
          el.load();
          owned.delete(el);
        }
        return el;
      }
      if (el.dataset.src && !el.getAttribute('src')) el.src = el.dataset.src;
      videos.add(el);
      owned.add(el);
      if (!hidden) el.play().catch(() => {});
      return el;
    },

    stop() {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      timers.forEach(clearTimeout);
      timers.clear();
      running.forEach(a => a.cancel());
      running.clear();
      loops.forEach(a => a.cancel());
      loops.clear();
      moving.forEach(a => a.cancel());
      moving.clear();
      waits.forEach(wait => wait.cancel());
      waits.clear();
      layers.forEach(layer => layer.stop());
      layers.clear();
      owned.forEach(video => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      });
      videos.clear();
      owned.clear();
    }
  };

  return tl;

}


/**
 * The pooled ambient engine.
 *
 * layer   the element the nodes live in
 * every   ms between spawns (± jitter, a fraction); lite: ×1.8
 * max     the most nodes this layer ever creates (lite: ~60%); 0 = no
 *         nodes, spawn(null) is just called on the beat
 * recycle when every node is busy, reuse the oldest instead of skipping
 *         (chat bubbles: the oldest message scrolls away)
 * make()  builds one node (default: <span class="xp-amb">)
 * spawn(node, n) sets the node up and returns its Animation(s); the node
 *         is free again when they finish. n counts spawns.
 * every <= 0: nothing on its own; engine.burst(count, spawn) spawns up to
 *         count nodes at once (an effect) from the same pool.
 */
export function ambient(layer, { every = 1200, jitter = 0.35, max = 6, delay = 0, recycle = false, lite = false, name = 'amb', make, spawn, hidden = () => document.hidden }) {

  const pool = [];
  const cap = max ? Math.max(1, Math.ceil(max * (lite ? 0.6 : 1))) : 0;
  const pace = every * (lite ? 1.8 : 1);
  let timer = 0;
  let count = 0;
  let stopped = false;
  let paused = false;

  const build = () => {
    const node = make ? make() : h('span', { class: 'xp-amb', 'aria-hidden': 'true' });
    node.classList.add('xp-amb');
    node.dataset.amb = name;
    node.dataset.cap = String(cap);
    node.dataset.uses = '0';
    node.__busy = [];
    layer.append(node);
    pool.push(node);
    return node;
  };

  const release = (node, animation) => {
    node.__busy = node.__busy.filter(a => a !== animation);
  };

  const take = () => {
    if (recycle) {
      // visible items (messages): grow to the cap, then reuse the oldest
      if (pool.length < cap) return build();
      const node = pool.shift();
      pool.push(node);
      node.__busy.forEach(a => a.cancel());
      node.__busy = [];
      return node;
    }
    return pool.find(n => !n.__busy.length) || (pool.length < cap ? build() : null);
  };

  const run = (node, fn) => {
    node.dataset.uses = String(Number(node.dataset.uses) + 1);
    const result = fn(node, count);
    [].concat(result || []).forEach(animation => {
      if (!animation || !animation.finished) return;
      if (paused) animation.pause();
      node.__busy.push(animation);
      animation.finished.then(() => release(node, animation), () => release(node, animation));
    });
  };

  const tick = () => {
    timer = 0;
    if (stopped || paused) return;
    count += 1;
    if (!cap) {
      spawn(null, count);
    }
    else {
      const node = take();
      if (node) run(node, spawn);
    }
    schedule();
  };

  const schedule = (wait = pace * (1 + (Math.random() * 2 - 1) * jitter)) => {
    if (stopped || paused || timer || every <= 0) return;
    timer = setTimeout(tick, Math.max(60, wait));
  };

  const engine = {
    pause() {
      paused = true;
      clearTimeout(timer);
      timer = 0;
      pool.forEach(node => node.__busy.forEach(a => a.pause()));
    },
    resume() {
      if (stopped) return;
      paused = false;
      pool.forEach(node => node.__busy.forEach(a => a.play()));
      schedule();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      pool.forEach(node => {
        node.__busy.forEach(a => a.cancel());
        node.remove();
      });
      pool.length = 0;
    },
    burst(n, fn = spawn) {
      if (stopped) return;
      for (let i = 0; i < n; i++) {
        const node = take();
        if (!node) break;
        count += 1;
        run(node, fn);
      }
    },
    get size() { return pool.length; }
  };

  if (hidden()) paused = true;
  else schedule(delay || pace * Math.random());

  return engine;

}


/* ---------- the outer effects layer ---------- */

/* the stage's effects layer (created once), from the stage or anything in it */
export function fxLayer(el) {

  const stage = el.classList.contains('xp-stage') ? el : (el.closest('.xp-stage') || el.parentNode || el);
  let layer = stage.querySelector(':scope > .xp-fx');

  if (!layer) {
    layer = h('div', { class: 'xp-fx', 'aria-hidden': 'true' });
    stage.append(layer);
  }

  return layer;

}

/* the phone's box inside the layer (px): x, y, pw, ph; the layer's w, h */
function geometry(layer, phone) {

  const L = layer.getBoundingClientRect();
  const P = (phone || layer).getBoundingClientRect();
  return { w: L.width || 320, h: L.height || 400, x: P.left - L.left, y: P.top - L.top, pw: P.width || 220, ph: P.height || 390 };

}

/* x, y in % of the phone (x from its inline start: the right, RTL) → px in the layer */
function onPhone(layer, phone, x, y) {

  const g = geometry(layer, phone);
  return [g.x + g.pw * (1 - x / 100), g.y + g.ph * (y / 100)];

}

const phoneOf = el => (el.classList.contains('xp-phone') ? el : el.querySelector(':scope > .xp-phone'));

/* the edge band (px) reactions may cross for depth; the content inside it stays clear */
const band = g => Math.min(14, g.pw * 0.06);

/* from a point on the phone: the drift that takes it out over the nearest side */
function exitDrift(layer, phone, left, prefer = Math.random() - 0.5) {

  const g = geometry(layer, phone);
  const toLeft = left - g.x;
  const toRight = g.x + g.pw - left;
  const goLeft = Math.abs(toLeft - toRight) < 12 ? prefer < 0 : toLeft < toRight;
  return goLeft ? -(toLeft + rand(20, 46)) : toRight + rand(20, 46);

}

/* floats leave the phone early (most of their life is beside it) */
const floatFrames = (drift, rise) => [
  { transform: 'translate(-50%, 0) scale(.4)', opacity: 0 },
  { transform: `translate(calc(-50% + ${drift * 0.82}px), -${rise * 0.22}px) scale(1.12)`, opacity: 1, offset: 0.22 },
  { transform: `translate(calc(-50% + ${drift * 1.15}px), -${rise}px) scale(.9)`, opacity: 0 }
];

function put(node, left, top, size) {

  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  if (size) node.style.fontSize = `${size}em`;

}


/* a reaction that floats up from (x, y) in % of the phone, in the effects
   layer (one-off, for the entrance; ambient layers recycle their own) */
export function float(phone, text, { x = 50, y = 80, drift = 0, rise = 120, size = 1, duration = 1600, className = '' } = {}) {

  const layer = fxLayer(phone);
  const bubble = h('span', { class: `xp-float ${className}`, 'aria-hidden': 'true' }, text);
  const [left, top] = onPhone(layer, phoneOf(phone) || phone, x, y);
  put(bubble, left, top, size);
  layer.append(bubble);

  if (!bubble.animate) {
    bubble.remove();
    return;
  }

  const animation = bubble.animate(floatFrames(exitDrift(layer, phoneOf(phone) || phone, left, drift) + drift * 0.2, rise), { duration, easing: 'cubic-bezier(.2, .6, .3, 1)', fill: 'forwards' });
  animation.finished.then(() => bubble.remove(), () => bubble.remove());

}


/**
 * Ambient floats (reactions, hearts) rising from a spot of the phone, in
 * the effects layer: a pooled version of float(). glyphs: strings, or a
 * function returning one. sound: a mixer category played as each appears.
 */
export function floats(tl, phone, { glyphs, x = [40, 60], y = [80, 90], rise = [90, 150], drift = 24, size = [1, 1.4], every = 700, max = 6, duration = 1900, className = '', name = 'float', delay = 0, sound = null, cue = '' }) {

  const layer = fxLayer(phone);

  return tl.ambient(layer, {
    every, max, name, delay,
    make: () => h('span', { class: `xp-float xp-float--amb ${className}`, 'aria-hidden': 'true' }),
    spawn: (node, n) => {
      node.textContent = typeof glyphs === 'function' ? glyphs() : pick(glyphs);
      const [left, top] = onPhone(layer, phone, rand(x[0], x[1]), rand(y[0], y[1]));
      put(node, left, top, rand(size[0], size[1]));
      const time = duration * rand(0.85, 1.15);
      if (sound && cue && n % 2) tl.later(time * 0.18, () => sound(cue));
      return node.animate(floatFrames(exitDrift(layer, phone, left) + rand(-drift, drift) * 0.2, rand(rise[0], rise[1])), { duration: time, easing: 'cubic-bezier(.2, .6, .3, 1)' });
    }
  });

}


/*
 * The paths an outer item can take (g: geometry; left: which side; w/hh:
 * the node's size). They FRAME the phone: they live in its side margins
 * and corners, and only touch its very edge (the band) for depth — never
 * lingering over the screen's content. Each returns its start (px), its
 * keyframes and its duration.
 */
const PATHS = {
  // from the side margin up to the phone's edge (message bubbles, pills)
  in(g, left, w, hh) {
    const b = band(g);
    const room = left ? g.x : g.w - g.x - g.pw;
    const dx = (left ? 1 : -1) * rand(10, 22);
    // it may start beyond the sheet's edge (clipped there): it slides in from it
    const x = left ? g.x - w + b - Math.abs(dx) - rand(0, Math.max(0, room - w) * 0.5) : g.x + g.pw - b + Math.abs(dx) + rand(0, Math.max(0, room - w) * 0.5);
    const y = g.y + g.ph * rand(0.12, 0.86) - hh / 2;
    const dy = -rand(14, 40);
    return [x, y, [
      { transform: `translate(${-dx * 1.6}px, 12px) scale(.86)`, opacity: 0 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0.16 },
      { transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(1)`, opacity: 0.96, offset: 0.78 },
      { transform: `translate(${dx}px, ${dy}px) scale(.96)`, opacity: 0 }
    ], rand(3000, 3900)];
  },
  // a pop at the phone's edge, out into the room (reactions)
  out(g, left, w, hh) {
    const b = band(g);
    const x = left ? g.x - w / 2 + rand(0, b) : g.x + g.pw - w / 2 - rand(0, b);
    const y = g.y + g.ph * rand(0.2, 0.92) - hh / 2;
    const room = left ? g.x : g.w - g.x - g.pw;
    const dx = (left ? -1 : 1) * rand(24, Math.max(34, room - 6));
    const dy = -rand(40, 120);
    return [x, y, [
      { transform: 'translate(0, 0) scale(.3)', opacity: 0 },
      { transform: `translate(${dx * 0.35}px, ${dy * 0.12}px) scale(1.2)`, opacity: 1, offset: 0.14 },
      { transform: `translate(${dx * 0.8}px, ${dy * 0.7}px) scale(1)`, opacity: 0.9, offset: 0.7 },
      { transform: `translate(${dx}px, ${dy}px) scale(.85)`, opacity: 0 }
    ], rand(1900, 2600)];
  },
  // rising in the margin, beside the edge
  rise(g, left, w, hh) {
    const b = band(g);
    const room = left ? g.x : g.w - g.x - g.pw;
    const x = left ? g.x - w + b - rand(0, Math.max(0, room - w)) : g.x + g.pw - b + rand(0, Math.max(0, room - w));
    const y = g.y + g.ph * rand(0.78, 1) - hh / 2;
    const dy = -rand(g.ph * 0.35, g.ph * 0.62);
    const dx = (left ? -1 : 1) * rand(0, 12);
    return [x, y, [
      { transform: 'translate(0, 16px) scale(.7)', opacity: 0 },
      { transform: `translate(${dx * 0.3}px, ${dy * 0.2}px) scale(1)`, opacity: 0.95, offset: 0.2 },
      { transform: `translate(${dx}px, ${dy * 0.8}px) scale(1)`, opacity: 0.8, offset: 0.75 },
      { transform: `translate(${dx * 1.2}px, ${dy}px) scale(.9)`, opacity: 0 }
    ], rand(3200, 4400)];
  },
  // a fly-by up the margin and away past the top corner (paper planes, swipes)
  cross(g, left, w, hh) {
    const b = band(g);
    const room = left ? g.x : g.w - g.x - g.pw;
    const x = left ? g.x - w + b - rand(0, Math.max(0, room - w)) : g.x + g.pw - b + rand(0, Math.max(0, room - w));
    const y = g.y + g.ph * rand(0.8, 0.98) - hh / 2;
    const side = left ? 1 : -1;
    const dy = -(g.ph * rand(0.85, 1.05));
    return [x, y, [
      { transform: `translate(${-side * 18}px, 0) rotate(${-10 * side}deg) scale(.7)`, opacity: 0 },
      { transform: `translate(0, ${dy * 0.15}px) rotate(${-4 * side}deg) scale(1)`, opacity: 1, offset: 0.12 },
      { transform: `translate(${side * b * 0.6}px, ${dy * 0.7}px) rotate(${4 * side}deg) scale(.95)`, opacity: 0.95, offset: 0.7 },
      { transform: `translate(${-side * 30}px, ${dy}px) rotate(${-12 * side}deg) scale(.8)`, opacity: 0 }
    ], rand(2400, 3000)];
  },
  // dropping in beside the top corners (pins)
  drop(g, left, w, hh) {
    const b = band(g);
    const room = left ? g.x : g.w - g.x - g.pw;
    const x = left ? g.x - w + b - rand(0, Math.max(0, room - w)) : g.x + g.pw - b + rand(0, Math.max(0, room - w));
    const y = g.y + rand(0, g.ph * 0.3) - hh;
    const dy = rand(30, 70);
    return [x, y, [
      { transform: 'translate(0, -40px) scale(.8)', opacity: 0 },
      { transform: `translate(0, ${dy}px) scale(1)`, opacity: 1, offset: 0.3 },
      { transform: `translate(0, ${dy - 8}px) scale(1)`, opacity: 1, offset: 0.4 },
      { transform: `translate(0, ${dy}px) scale(1)`, opacity: 0.9, offset: 0.75 },
      { transform: `translate(0, ${dy + 10}px) scale(.9)`, opacity: 0 }
    ], rand(2600, 3300)];
  },
  // walking up along an edge, on its outer side
  orbit(g, left, w, hh) {
    const b = band(g);
    const x = left ? g.x - w + b : g.x + g.pw - b;
    const y = g.y + g.ph * 0.86 - hh / 2;
    const dy = -g.ph * 0.7;
    const sway = (left ? -1 : 1) * rand(6, 16);
    return [x, y, [
      { transform: 'translate(0, 0) scale(.6)', opacity: 0 },
      { transform: `translate(${sway}px, ${dy * 0.25}px) scale(1)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${sway * 0.4}px, ${dy * 0.6}px) scale(1)`, opacity: 0.9, offset: 0.6 },
      { transform: `translate(${sway}px, ${dy}px) scale(.85)`, opacity: 0 }
    ], rand(3400, 4200)];
  },
  // a pulse around the whole phone, going out past its edges (calls)
  ring(g, left, w, hh, node) {
    node.style.width = `${g.pw}px`;
    node.style.height = `${g.ph}px`;
    return [g.x, g.y, [
      { transform: 'scale(1)', opacity: 0 },
      { transform: 'scale(1.02)', opacity: 0.55, offset: 0.1 },
      { transform: 'scale(1.2, 1.1)', opacity: 0 }
    ], 2800];
  }
};

/* a reaction for narrow margins, where words would cover the screen */
const SMALL = ['❤️', '✨', '👍', '🙏'];


/**
 * The EDGE layer: platform-specific activity around the phone, entering
 * from the sides and corners and crossing its edges (paths above), in the
 * effects layer. Not in the lite tier. items: strings (emoji), nodes, or
 * { text | node, className, path, side, size, sound } (a function may
 * return one each time). sound(name) plays item.sound as it appears.
 */
export function spray(tl, stage, { items, every = 1300, max = 6, name = 'edge', delay = 900, paths = ['in', 'out', 'rise'], sound = null }) {

  if (tl.reduced || tl.lite) return null;

  const fx = fxLayer(stage);
  let layer = fx.querySelector(':scope > .xp-edge');

  if (!layer) {
    layer = h('div', { class: 'xp-edge', 'aria-hidden': 'true' });
    fx.prepend(layer);
  }

  let turn = 0;

  return tl.ambient(layer, {
    every, max, name, delay, edge: true,
    make: () => h('span', { class: 'xp-edge__item' }),
    spawn: node => {
      const item = typeof items === 'function' ? items() : pick(items);
      const spec = item && typeof item === 'object' && !(item instanceof Node) ? item : { text: item };
      const path = PATHS[spec.path] ? spec.path : paths[turn % paths.length];
      turn += 1;
      const left = spec.side ? spec.side === 'left' : Math.floor(turn / paths.length) % 2 === turn % 2;

      node.className = `xp-edge__item xp-amb xp-edge__item--${path} ${spec.className || ''}`;
      node.style.width = node.style.height = '';
      node.style.fontSize = spec.node ? '' : `${spec.size || rand(1.05, 1.45)}em`;
      node.replaceChildren(spec.node || spec.text || '');

      const phone = stage.querySelector(':scope > .xp-phone');
      const g = geometry(layer, phone);
      // narrow margins: words would cover the screen, a small reaction frames it instead
      if (spec.node && path !== 'ring' && node.offsetWidth > (left ? g.x : g.w - g.x - g.pw) + 2) {
        node.className = `xp-edge__item xp-amb xp-edge__item--${path}`;
        node.style.fontSize = '1.1em';
        node.replaceChildren(spec.alt || pick(SMALL));
      }
      const [x, y, frames, duration] = PATHS[path](g, left, node.offsetWidth || 24, node.offsetHeight || 24, node);
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      if (spec.sound && sound) tl.later(duration * 0.15, () => sound(spec.sound));
      return node.animate(frames, { duration, easing: path === 'cross' ? 'cubic-bezier(.45, .1, .4, 1)' : 'cubic-bezier(.25, .6, .35, 1)' });
    }
  });

}

/* the older name (voice.js): sides and bottom */
export const edge = (tl, stage, options) => spray(tl, stage, { paths: ['in', 'rise', 'out'], ...options });


/**
 * Wide screens: the same platform activity around the sheet, BEHIND it
 * (the «صوتك يهمنا» side layer's way): it enters from the left or right of
 * the panel in lanes, drifts toward it and fades. Never over the sheet;
 * full tier only; gone with the sheet.
 */
export function side(tl, stage, { items, every = 1800, max = 7, delay = 1400, name = 'side' }) {

  if (tl.reduced || tl.lite || typeof matchMedia !== 'function') return null;

  const dialog = stage.closest('dialog');
  if (!dialog || !matchMedia('(min-width: 1024px) and (min-height: 700px)').matches) return null;

  const layer = h('div', { class: 'xp-side', 'aria-hidden': 'true' });
  dialog.append(layer);
  const stop = tl.stop;
  tl.stop = () => { stop(); layer.remove(); };

  const LANES = [0.22, 0.36, 0.5, 0.64, 0.78];
  const busy = { left: LANES.map(() => 0), right: LANES.map(() => 0) };
  let turn = 0;

  return tl.ambient(layer, {
    every, max, name, delay, edge: true,
    make: () => h('span', { class: 'xp-side__item' }),
    spawn: node => {
      const panel = stage.closest('.sheet__panel');
      const box = panel ? panel.getBoundingClientRect() : { left: innerWidth / 2 - 300, right: innerWidth / 2 + 300 };
      const gapLeft = box.left - 40;
      const gapRight = innerWidth - box.right - 40;
      turn += 1;
      const left = (turn % 2 === 1 && gapLeft > 120) || gapRight < 120;
      const room = left ? gapLeft : gapRight;
      if (room < 90) return null;

      const now = performance.now();
      const lanes = busy[left ? 'left' : 'right'];
      const free = lanes.map((until, i) => (until < now ? i : -1)).filter(i => i >= 0);
      if (!free.length) return null;

      const item = typeof items === 'function' ? items() : pick(items);
      const spec = item && typeof item === 'object' && !(item instanceof Node) ? item : { text: item };
      node.className = `xp-side__item xp-amb ${spec.className || ''}`;
      node.style.fontSize = spec.node ? '' : '26px';
      node.replaceChildren(spec.node || spec.text || '');

      const duration = rand(6000, 8000);
      const lane = pick(free);
      lanes[lane] = now + duration * 0.8;
      const width = Math.min(node.offsetWidth || 60, room - 20);
      const x = left ? rand(20, Math.max(24, room - width - 10)) : box.right + 40 + rand(0, Math.max(6, room - width - 16));
      node.style.left = `${x}px`;
      node.style.top = `${LANES[lane] * innerHeight}px`;
      node.style.maxWidth = `${Math.max(80, room - 24)}px`;

      const toward = (left ? 1 : -1) * rand(14, 40);
      const rise = rand(40, 80);
      return node.animate([
        { transform: `translate(${-toward}px, 20px) scale(.92)`, opacity: 0 },
        { transform: `translate(0, ${-rise * 0.2}px) scale(1)`, opacity: 1, offset: 0.16 },
        { transform: `translate(${toward * 0.6}px, ${-rise * 0.75}px) scale(1)`, opacity: 0.9, offset: 0.8 },
        { transform: `translate(${toward}px, ${-rise}px) scale(.96)`, opacity: 0 }
      ], { duration, easing: 'cubic-bezier(.3, .4, .4, 1)' });
    }
  });

}


/* ---------- words and typing ---------- */

/*
 * Types text into el, one character at a time (the visitor's own message
 * in the input bar). Each character plays one soft key tap: the taps stop
 * the instant typing does (and with the scene). done() runs after.
 */
export function typeInto(tl, el, text, { sound = null, done = null, pace = [55, 125] } = {}) {

  const chars = Array.from(text);

  if (tl.reduced) {
    el.textContent = text;
    if (done) done();
    return;
  }

  let i = 0;
  el.textContent = '';
  el.classList.add('is-typing');

  const step = () => {
    i += 1;
    el.textContent = chars.slice(0, i).join('');
    if (sound && chars[i - 1].trim()) sound('key');
    if (i < chars.length) {
      tl.later(rand(pace[0], pace[1]) * (chars[i - 1] === ' ' ? 1.7 : 1), step);
    }
    else {
      el.classList.remove('is-typing');
      if (done) tl.later(240, done);
    }
  };

  tl.later(rand(pace[0], pace[1]), step);

}

/* a small message bubble with real words (the edge and side layers) */
export function bubble(text, { tone = '', who = '', meta = '' } = {}) {

  return h('span', { class: `xp-msg${tone ? ` xp-msg--${tone}` : ''}` },
    who ? h('b', { class: 'xp-msg__who' }, who) : null,
    h('span', { class: 'xp-msg__text' }, text),
    meta ? h('i', { class: 'xp-msg__meta' }, meta) : null
  );

}

/* a pill (counters, hints): «+١ 👍», «اشترك 🔔» */
export const chip = (text, tone = '') => h('span', { class: `xp-chip${tone ? ` xp-chip--${tone}` : ''}` }, text);


/* Arabic digits, for counters */
export const digits = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

/* 1200 → ١٫٢ ألف; counters on the screens */
export const compact = n => (n >= 1000 ? `${digits((Math.round(n / 100) / 10).toString()).replace('.', '٫')} ألف` : digits(n));


/* ---------- pictures ---------- */

/* a few public poster thumbnails from the page itself */
export function posters(content, count = 3) {

  const images = [];
  const add = image => { if (image && image.thumb && !images.includes(image.thumb)) images.push(image.thumb); };

  (content.news || []).forEach(n => add(n.image));
  (content.activities || []).forEach(a => add(a.image));
  (content.sessions || []).forEach(s => add(s.image));

  return images.slice(0, count);

}


/**
 * THE PLAYLIST a scene shows: one shared list, in one shape.
 *
 * The link has its own gallery (the admin's «صور وفيديوهات المشهد», at most
 * 6): EXACTLY those items, in the admin's order, pictures and clips mixed,
 * each with its own words (`text`, the admin's caption). Nothing bundled is
 * ever mixed into a configured scene.
 * No gallery: the service's bundled material (library.js) — `posters`
 * weekly posters (portrait ones only with `portrait`) and `clips` game
 * segments (`order`: ids first), interleaved (a poster, a clip, …), with
 * their default words (talk.js).
 *
 * `text`: the scene also takes the admin's words-only items (a text post,
 * a chat message: kind 'text') — only where one is natural (Facebook, the
 * feeds, the chats); elsewhere they are left out.
 * Shape: { id, kind: 'image' | 'video' | 'text', own, src, poster, w, h,
 *          text, from ('us' | 'them' | ''), alt, start, end, topic?,
 *          caption? } (end 0 = to the end).
 * Never anything fetched from the platform.
 */
export function playlist(link, { posters = 3, clips = 0, order = [], portrait = false, text = false } = {}) {

  const own = ((link && link.gallery) || []).filter(item => item && (item.src || (text && item.type === 'text' && item.text))).map((item, i) => {
    const from = item.from === 'us' || item.from === 'them' ? item.from : '';
    if (item.type === 'text') return { id: `own-${i}`, kind: 'text', own: true, src: '', poster: '', w: 0, h: 0, text: item.text.trim(), from, alt: '', start: 0, end: 0 };
    const video = item.type === 'video';
    const still = video ? item.poster || item.thumb || '' : item.thumb || item.src;
    return {
      id: `own-${i}`,
      kind: video ? 'video' : 'image',
      own: true,
      src: video ? item.src : still,
      poster: still,
      w: Number(item.w) || (video ? 360 : 400),
      h: Number(item.h) || (video ? 640 : 400),
      text: typeof item.text === 'string' ? item.text.trim() : '',
      from,
      alt: item.alt || '',
      start: video ? Math.max(0, Number(item.start) || 0) : 0,
      end: video ? Math.max(0, Number(item.end) || 0) : 0
    };
  });

  if (own.length) return own;

  const stills = POSTERS.filter(p => !portrait || p.w < p.h).slice(0, posters).map((p, i) => ({
    id: `poster-${p.date}`, kind: 'image', own: false, src: p.src, poster: p.src, w: p.w, h: p.h,
    text: caption(p, i), alt: '', start: 0, end: 0, topic: p.topic
  }));
  const ranked = order.map(id => CLIPS.find(c => c.id === id)).filter(Boolean);
  const moving = ranked.concat(CLIPS.filter(c => !ranked.includes(c))).slice(0, clips).map(c => ({
    id: c.id, kind: 'video', own: false, src: c.src, poster: c.poster, w: c.w, h: c.h,
    text: c.caption, alt: '', start: 0, end: 0, caption: c.caption
  }));

  const list = [];
  for (let i = 0; i < Math.max(stills.length, moving.length); i++) {
    if (stills[i]) list.push(stills[i]);
    if (moving[i]) list.push(moving[i]);
  }
  return list;

}

/* the next place in a playlist of n: in order, then from the start again */
export const nextIndex = (i, n) => (n > 0 ? (i + 1) % n : 0);

/* the <video> of a media node (mediaNode / clipNode), if it is one */
export const videoOf = node => (!node ? null : node.tagName === 'VIDEO' ? node : (node.querySelector && node.querySelector('video')));

/**
 * Plays a playlist of `count` items in order, then loops: show(i) puts item
 * i on screen (the scene's own way: a swipe, a scroll, a new message…) and
 * returns its media node. A picture stays `image` ms; a clip plays its
 * segment and the next item comes when it ends (never longer than `max`;
 * soon if it can't load). Only the current clip stays loaded. The first
 * item (`first`: its node) is already on screen; it moves on after `delay`
 * (+ its own time). One item, or reduced motion: nothing to advance (a
 * lone clip loops). Lite: slower (clips are posters there).
 */
export function cycle(tl, count, show, { first = null, image = 4200, max = 30000, delay = 0, start = 0 } = {}) {

  if (tl.reduced) return null;
  if (count < 2) {
    const lone = videoOf(first);
    if (lone) tl.later(delay, () => tl.video(lone));
    return null;
  }

  // `start`: the place of the item already on screen (`first`)
  let index = start;
  let wait = null;
  let video = null;

  const step = () => {
    const before = video;
    index = nextIndex(index, count);
    arm(show(index), 0);
    if (before && before !== video) tl.video(before, false);
  };
  const ended = () => step();
  const broken = () => {
    if (wait) wait.cancel();
    wait = tl.later(1200, step);
  };

  function arm(node, extra) {
    if (wait) wait.cancel();
    if (video) {
      video.removeEventListener('segmentend', ended);
      video.removeEventListener('error', broken);
    }
    video = videoOf(node);
    if (video) {
      video.addEventListener('segmentend', ended);
      video.addEventListener('error', broken);
      const mine = video;
      if (extra) tl.later(extra, () => { if (video === mine) tl.video(mine); });
      else tl.video(mine);
      wait = tl.later(extra + max, step);
    }
    else {
      wait = tl.later(extra + image * (tl.lite ? 1.5 : 1), step);
    }
  }

  arm(first, delay);

  return { get index() { return index; }, next: step };

}

/*
 * The part of a clip that plays, once its real duration is known:
 * [from, to] in seconds. A start past the end falls back to 0; an end of 0
 * (or past the video) means the end of the video.
 */
export function segment(start, end, duration) {

  const length = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const from = start > 0 && start < length ? start : 0;
  const to = end > from ? Math.min(end, length) : length;
  return [from, to];

}


/**
 * A clip (a playlist video): a muted, inline video that loads nothing until
 * its scene plays it (preload none), playing its segment (start → end);
 * else its poster frame. lite / reduced motion: the poster only.
 * By default the segment loops; with `advance` it plays once, stops and
 * tells the scene (a `segmentend` event) so the next item can come.
 */
export function clipNode(clip, tl, className = '', { advance = false } = {}) {

  if (tl.reduced || tl.lite || !clip.src) return h('img', { class: className, src: clip.poster, alt: '', decoding: 'async' });

  const part = clip.start > 0 || clip.end > 0;
  const video = h('video', { class: className, poster: clip.poster || null, preload: 'none', playsinline: '', muted: '', loop: part || advance ? null : '', disablepictureinpicture: '', 'aria-hidden': 'true' });
  video.muted = true;
  video.src = clip.src;
  // tl.video(…, false) unloads it; tl.video(…) loads it again from here
  video.dataset.src = clip.src;

  const range = () => segment(clip.start || 0, clip.end || 0, video.duration);
  const toStart = () => { video.currentTime = range()[0]; };
  let done = false;
  const end = () => {
    if (!advance) {
      toStart();
      if (video.paused && video.dataset.playing) video.play().catch(() => {});
      return;
    }
    if (done) return;
    done = true;
    video.pause();
    video.dispatchEvent(new Event('segmentend'));
  };
  video.addEventListener('play', () => { done = false; video.dataset.playing = '1'; });
  video.addEventListener('pause', () => { if (!video.ended) delete video.dataset.playing; });
  if (part || advance) video.addEventListener('ended', end);

  if (part) {
    const early = () => { if (video.currentTime < range()[0] - 0.1) toStart(); };
    video.addEventListener('loadedmetadata', early);
    video.addEventListener('loadeddata', early);
    // every frame where the browser can say so (else on timeupdate)
    const watch = () => {
      const [from, to] = range();
      if (!video.paused && video.currentTime >= to - 0.05) end();
      else if (video.currentTime < from - 0.1) toStart();
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(watch);
    };
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(watch);
    else video.addEventListener('timeupdate', watch);
  }

  return video;

}


/**
 * A playlist item on a screen: the picture, or the clip (clipNode), over a
 * blurred copy of itself, so any ratio (9:16, 4:5, 1:1, 16:9…) shows whole
 * instead of cropped ("contain"); the bundled game clips carry their own
 * fill and cover their frame. `ratio` [min, max] (w / h): the box takes the
 * item's own shape, clamped (feeds: FEED, 4:5 to 16:9); else it fills the
 * place the scene gives it. `main`: a class for the picture / video itself.
 * `advance`: see clipNode.
 */
export function mediaNode(item, tl, { className = '', main = '', ratio = null, advance = false, fit = item.own || item.kind === 'image' ? 'contain' : 'cover' } = {}) {

  const still = item.poster || item.src;
  const inner = item.kind === 'video'
    ? clipNode(item, tl, `xp-media__main ${main}`, { advance })
    : h('img', { class: `xp-media__main ${main}`, src: item.src, alt: '', decoding: 'async' });
  const box = h('span', { class: `xp-media xp-media--${fit} ${className}`, 'data-kind': item.kind, 'data-id': item.id },
    fit === 'contain' && still ? h('img', { class: 'xp-media__bg', src: still, alt: '', decoding: 'async' }) : null,
    inner
  );

  if (ratio) box.style.aspectRatio = Math.min(ratio[1], Math.max(ratio[0], (item.w || 1) / (item.h || 1))).toFixed(4);

  return box;

}

/* the feeds' media box: the item's own shape, between 4:5 and 16:9 */
export const FEED = [4 / 5, 16 / 9];


/**
 * An item's words (the admin's caption: up to 280 characters, emoji, a few
 * line breaks, Arabic or not): plain text, line breaks kept, clamped to
 * `lines` with «… المزيد» under it only when it doesn't fit (fitWords, once
 * it is on screen).
 */
export function words(text, { className = '', lines = 3, more = '… المزيد' } = {}) {

  const say = h('span', { class: `xp-say ${className}` },
    h('span', { class: 'xp-say__text', dir: 'auto' }, text),
    h('span', { class: 'xp-say__more' }, more)
  );
  say.style.setProperty('--lines', String(lines));
  return say;

}

/* shows «المزيد» under the words that are clamped (needs layout: on screen) */
export function fitWords(root) {

  const all = root.classList && root.classList.contains('xp-say') ? [root] : [...root.querySelectorAll('.xp-say')];
  all.forEach(say => {
    const text = say.firstChild;
    say.classList.toggle('is-more', text.scrollHeight > text.clientHeight + 2);
  });

}


/* a counter that climbs to its target over the scene */
export function climb(el, target, tl, { from = 0, steps = 8, start = 800, every = 220, format = digits } = {}) {

  el.textContent = format(target);

  if (tl.reduced) return;

  el.textContent = format(from);

  for (let i = 1; i <= steps; i++) {
    tl.at(start + i * every, () => { el.textContent = format(Math.round(from + (target - from) * (i / steps))); });
  }

}


/* a counter that keeps ticking up now and then while the scene is open */
export function tickUp(tl, el, { from, step = [1, 3], every = 2200, format = digits, delay = 2600, onTick = null }) {

  let value = from;

  return tl.every(every, () => {
    value += Math.round(rand(step[0], step[1]));
    el.textContent = format(value);
    if (el.animate) el.animate([{ transform: 'translateY(3px)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: EASE });
    if (onTick) onTick(value);
  }, { delay });

}


/* the short "lines of text" placeholders (the voice scene's options only) */
export const lines = (n, className = '') => h('span', { class: `xp-lines ${className}` }, Array.from({ length: n }, () => h('i')));


/* the real next-meeting line from the page (nothing private) */
export function meetingLine(content, fallback = '📣 إعلان جديد') {

  const meeting = content && content.meeting;

  if (meeting && Number.isInteger(meeting.day) && /^\d{2}:\d{2}$/.test(meeting.time)) {
    const [hh, mm] = meeting.time.split(':').map(Number);
    return `📣 الاجتماع ${DAY_NAMES[meeting.day]} الساعة ${formatTime(hh * 60 + mm)} — مستنيينك!`;
  }

  return fallback;

}


/* a shuffled deck: every item once before any comes again (no twin comments) */
export function deck(list) {

  let order = [];
  let i = 0;
  return () => {
    if (i >= order.length) {
      order = [...list].sort(() => Math.random() - 0.5);
      i = 0;
    }
    return order[i++];
  };

}
