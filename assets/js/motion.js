/**
 * MOTION
 *
 * Small helpers on top of CSS and the Web Animations API (no library):
 * springs, text swaps, the bell swing, "wake up" moments and a tiny particle
 * engine for the hero dust and live-game embers.
 *
 * Rules (see DESIGN.md):
 *  - only transform / opacity / filter are animated
 *  - at most one continuous animation per visible card; particles pause
 *    off-screen and in background tabs
 *  - prefers-reduced-motion: no movement at all, just the final state
 */

const reducedQuery = globalThis.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

export const isReduced = () => reducedQuery.matches;

const supportsLinear = globalThis.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)');

/* real spring curves (k=170 c=20 and k=260 c=16), with a close fallback */
export const SPRING = supportsLinear
  ? 'linear(0, 0.058, 0.191, 0.351, 0.51, 0.652, 0.768, 0.858, 0.924, 0.969, 0.997, 1.014, 1.021, 1.023, 1.022, 1.019, 1.015, 1.012, 1.008, 1.005, 1.003, 1.002, 1.001, 1)'
  : 'cubic-bezier(.3, 1.3, .5, 1)';

export const BOUNCE = supportsLinear
  ? 'linear(0, 0.079, 0.268, 0.499, 0.724, 0.912, 1.048, 1.129, 1.163, 1.161, 1.136, 1.099, 1.061, 1.027, 1, 0.983, 0.974, 0.972, 0.975, 0.981, 0.987, 0.993, 0.998, 1.002, 1.004, 1.005, 1.004, 1.003, 1.002, 1)'
  : 'cubic-bezier(.34, 1.56, .64, 1)';

export const EASE_OUT = 'cubic-bezier(.16, 1, .3, 1)';


/** el.animate() that respects reduced motion (returns null when skipped). */
export function animate(el, keyframes, options) {

  if (!el || !el.animate || isReduced()) {
    return null;
  }

  return el.animate(keyframes, { fill: 'none', ...options });

}


/** Replace text with a short roll (countdowns, counters). */
export function swapText(el, text) {

  if (!el || el.textContent === text) {
    return;
  }

  if (isReduced() || !el.isConnected) {
    el.textContent = text;
    return;
  }

  const out = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-45%)' }], { duration: 140, easing: 'ease-in' });

  out.onfinish = () => {
    el.textContent = text;
    el.animate([{ opacity: 0, transform: 'translateY(45%)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: SPRING });
  };

}


/** One damped swing (never loops). */
export function swingBell(el) {

  return animate(el, [
    { transform: 'rotate(0)' },
    { transform: 'rotate(16deg)', offset: 0.15 },
    { transform: 'rotate(-12deg)', offset: 0.35 },
    { transform: 'rotate(8deg)', offset: 0.55 },
    { transform: 'rotate(-4deg)', offset: 0.75 },
    { transform: 'rotate(0)' }
  ], { duration: 900, easing: 'ease-out' });

}


export function pop(el) {

  return animate(el, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 520, easing: BOUNCE });

}


/** A card's state changed while the visitor watched: a one-time accent. */
export function wake(el, className = 'is-waking', duration = 1600) {

  if (!el || isReduced()) {
    return;
  }

  el.classList.add(className);
  setTimeout(() => el.classList.remove(className), duration);

}


/* =========================================================
   PARTICLES
   A few dozen points on one canvas; pauses whenever it can't be seen.
========================================================= */

const lowPower = () =>
  (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) ||
  (navigator.deviceMemory && navigator.deviceMemory <= 1);

const KINDS = {
  // slow gold dust drifting up through the hero
  dust: {
    count: 22,
    spawn: (w, h, p) => {
      p.x = Math.random() * w;
      p.y = Math.random() * h;
      p.vy = -(0.04 + Math.random() * 0.1);
      p.vx = (Math.random() - 0.5) * 0.04;
      p.r = 0.6 + Math.random() * 1.3;
      p.life = 0;
      p.max = 600 + Math.random() * 900;
      p.hue = 42;
    },
    alpha: p => Math.sin(Math.PI * (p.life / p.max)) * 0.55
  },
  // embers rising from the bottom of a live card
  ember: {
    count: 16,
    spawn: (w, h, p) => {
      p.x = Math.random() * w;
      p.y = h + Math.random() * 20;
      p.vy = -(0.35 + Math.random() * 0.6);
      p.vx = (Math.random() - 0.5) * 0.25;
      p.r = 0.8 + Math.random() * 1.8;
      p.life = 0;
      p.max = 140 + Math.random() * 160;
      p.hue = 24 + Math.random() * 20;
    },
    alpha: p => Math.max(0, 1 - p.life / p.max) * (0.6 + Math.random() * 0.4)
  }
};

export function particles(canvas, kind) {

  const spec = KINDS[kind];

  if (!canvas || !spec || isReduced() || lowPower() || !canvas.getContext) {
    return { stop() {} };
  }

  const ctx = canvas.getContext('2d');
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const points = Array.from({ length: spec.count }, () => ({}));

  let width = 0;
  let height = 0;
  let frame = 0;
  let visible = false;
  let stopped = false;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    points.forEach(p => { spec.spawn(width, height, p); p.life = Math.random() * p.max; });
  }

  function tick() {
    frame = 0;
    if (!visible || stopped || document.hidden) return;
    ctx.clearRect(0, 0, width, height);
    for (const p of points) {
      p.life += 1;
      p.x += p.vx;
      p.y += p.vy;
      if (p.life >= p.max || p.y < -10) spec.spawn(width, height, p);
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue}, 85%, 70%, ${spec.alpha(p).toFixed(3)})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    frame = requestAnimationFrame(tick);
  }

  function run() {
    if (!frame && visible && !stopped && !document.hidden) frame = requestAnimationFrame(tick);
  }

  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    run();
  });

  const onVisibility = () => run();

  resize();
  observer.observe(canvas);
  document.addEventListener('visibilitychange', onVisibility);

  const resizer = globalThis.ResizeObserver ? new ResizeObserver(resize) : null;
  resizer?.observe(canvas);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };

}
