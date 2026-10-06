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
 *   - spawns stay inside the stage (its layers clip), so they can never
 *     cover the sheet's button or its close button
 */

import { h } from '../dom.js';
import { DAY_NAMES, formatTime } from '../words.js';

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
  let stopped = false;
  let hidden = typeof document !== 'undefined' && document.hidden;

  const onVisibility = () => {
    if (stopped) return;
    hidden = document.hidden;
    loops.forEach(a => (hidden ? a.pause() : a.play()));
    moving.forEach(a => (hidden ? a.pause() : a.play()));
    layers.forEach(layer => (hidden ? layer.pause() : layer.resume()));
    waits.forEach(wait => (hidden ? wait.pause() : wait.resume()));
  };

  if (!reduced) document.addEventListener('visibilitychange', onVisibility);

  const tl = {
    quick,
    reduced,
    lite,
    speed,

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
    }
  };

  return tl;

}


/**
 * The pooled ambient engine.
 *
 * layer   the element the nodes live in (it should clip: overflow hidden)
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


/* a reaction that floats up from (x, y) in % of the stage, then disappears
   (one-off, for the entrance; ambient layers recycle their own nodes) */
export function float(stage, text, { x = 50, y = 80, drift = 0, rise = 120, size = 1, duration = 1600, className = '' } = {}) {

  const bubble = h('span', { class: `xp-float ${className}`, 'aria-hidden': 'true' }, text);
  place(bubble, x, y, size);
  stage.append(bubble);

  if (!bubble.animate) {
    bubble.remove();
    return;
  }

  const animation = bubble.animate(floatFrames(drift, rise), { duration, easing: 'cubic-bezier(.2, .6, .3, 1)', fill: 'forwards' });
  animation.finished.then(() => bubble.remove(), () => bubble.remove());

}

function place(node, x, y, size = 1) {

  node.style.insetInlineStart = `${x}%`;
  node.style.top = `${y}%`;
  node.style.fontSize = `${size}em`;

}

const floatFrames = (drift, rise) => [
  { transform: 'translate(0, 0) scale(.4)', opacity: 0 },
  { transform: `translate(${drift * 0.3}px, -${rise * 0.25}px) scale(1.15)`, opacity: 1, offset: 0.18 },
  { transform: `translate(${drift}px, -${rise}px) scale(.9)`, opacity: 0 }
];


/**
 * Ambient floats (reactions, hearts) rising inside a layer: a pooled
 * version of float(). glyphs: strings, or a function returning one.
 */
export function floats(tl, layer, { glyphs, x = [40, 60], y = [80, 90], rise = [90, 150], drift = 24, size = [1, 1.4], every = 700, max = 6, duration = 1900, className = '', name = 'float', delay = 0 }) {

  return tl.ambient(layer, {
    every, max, name, delay,
    make: () => h('span', { class: `xp-float xp-float--amb ${className}`, 'aria-hidden': 'true' }),
    spawn: node => {
      node.textContent = typeof glyphs === 'function' ? glyphs() : pick(glyphs);
      place(node, rand(x[0], x[1]), rand(y[0], y[1]), rand(size[0], size[1]));
      return node.animate(floatFrames(rand(-drift, drift), rand(rise[0], rise[1])), { duration: duration * rand(0.85, 1.15), easing: 'cubic-bezier(.2, .6, .3, 1)' });
    }
  });

}


/**
 * The EDGE layer (B): gentle activity entering from the outer edges of the
 * stage (left, right, bottom), passing behind the phone. Not in the lite
 * tier. items: strings (emoji) or functions returning a node's content
 * (a node, or text); className per item via { text, className } objects.
 */
export function edge(tl, stage, { items, every = 1500, max = 5, name = 'edge', delay = 900 }) {

  if (tl.reduced || tl.lite) return null;

  let layer = stage.querySelector(':scope > .xp-edge');

  if (!layer) {
    layer = h('div', { class: 'xp-edge', 'aria-hidden': 'true' });
    stage.prepend(layer);
  }

  let side = 0;

  return tl.ambient(layer, {
    every, max, name, delay, edge: true,
    make: () => h('span', { class: 'xp-edge__item' }),
    spawn: node => {
      const item = typeof items === 'function' ? items() : pick(items);
      const spec = typeof item === 'object' && !(item instanceof Node) ? item : { text: item };
      node.className = `xp-edge__item xp-amb ${spec.className || ''}`;
      node.replaceChildren(spec.node || spec.text || '');

      // left, right, left, right, bottom-left / bottom-right
      side = (side + 1) % 5;
      const fromBottom = side === 4;
      const left = fromBottom ? Math.random() < 0.5 : side % 2 === 0;
      const width = layer.clientWidth || 300;
      const height = layer.clientHeight || 300;
      const gutter = Math.max(28, Math.min(150, width * 0.2));
      const x = left ? rand(4, gutter - 24) : width - rand(28, gutter);
      const y = fromBottom ? height + 10 : rand(height * 0.35, height * 0.9);
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.style.fontSize = `${rand(0.9, 1.25)}em`;

      const dx = fromBottom ? rand(-14, 14) : (left ? 1 : -1) * rand(10, 26);
      const dy = fromBottom ? -rand(height * 0.45, height * 0.7) : -rand(40, 110);
      const enterX = fromBottom ? 0 : (left ? -1 : 1) * 30;

      return node.animate([
        { transform: `translate(${enterX}px, 0) scale(.7)`, opacity: 0 },
        { transform: `translate(${enterX * 0.2 + dx * 0.3}px, ${dy * 0.25}px) scale(1)`, opacity: 0.9, offset: 0.25 },
        { transform: `translate(${dx}px, ${dy * 0.75}px) scale(1)`, opacity: 0.75, offset: 0.7 },
        { transform: `translate(${dx * 1.2}px, ${dy}px) scale(.92)`, opacity: 0 }
      ], { duration: rand(3200, 4600), easing: 'cubic-bezier(.25, .6, .35, 1)' });
    }
  });

}


/* Arabic digits, for counters */
export const digits = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

/* 1200 → ١٫٢ ألف; counters on the screens */
export const compact = n => (n >= 1000 ? `${digits((Math.round(n / 100) / 10).toString()).replace('.', '٫')} ألف` : digits(n));


/* a few public poster thumbnails to make the scenes feel like ours */
export function posters(content, count = 3) {

  const images = [];
  const add = image => { if (image && image.thumb && !images.includes(image.thumb)) images.push(image.thumb); };

  (content.news || []).forEach(n => add(n.image));
  (content.activities || []).forEach(a => add(a.image));
  (content.sessions || []).forEach(s => add(s.image));

  return images.slice(0, count);

}


/**
 * The photos a scene shows: the link's own (chosen in the admin, «صور
 * المشهد») when it has them, else our newest published posters. Never
 * anything fetched from the platform.
 */
export function media(link, content, count = 3) {

  const own = ((link && link.gallery) || []).map(image => image.thumb || image.src).filter(Boolean);
  const pics = own.length ? own : posters(content || {}, count);

  return pics.slice(0, count);

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
export function tickUp(tl, el, { from, step = [1, 3], every = 2200, format = digits, delay = 2600 }) {

  let value = from;

  return tl.every(every, () => {
    value += Math.round(rand(step[0], step[1]));
    el.textContent = format(value);
    if (el.animate) el.animate([{ transform: 'translateY(3px)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: EASE });
  }, { delay });

}


/* the short "lines of text" placeholders the screens use */
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
