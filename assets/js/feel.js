/**
 * FEEL: how the page answers the hand (touch) and the mouse.
 *
 * - Motion tier on <html data-motion>: "full", "lite" (a weak phone, a
 *   data saver, or frames that measure slow in the first seconds) and
 *   "reduced" (prefers-reduced-motion). CSS scales effects down by tier.
 * - Mouse (hover + fine pointer): a soft light follows the pointer over
 *   cards, and posters inside them shift a few pixels (depth).
 * - Touch: a ripple from the exact touch point. Purely visual: the tap
 *   itself is never delayed or swallowed (no double-tap needed, ever).
 * - Reveals: sections below the fold rise in as they scroll into view;
 *   their icon pops, then their cards follow in a short stagger.
 */

const html = document.documentElement;
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

const CARDS = '.tile, .featured, .item-card, .news-card, .news-lead, .game, .topic, .row-link';
const PRESSABLE = `${CARDS}, .btn, .note-item, .share-row .btn, .topbar__btn`;

let slowFrames = 0;

/* one decorative layer per card: the light and the ripples live in it,
   clipped to the card's own rounded shape */
function fxLayer(target) {

  let layer = target.querySelector(':scope > .fx');
  if (!layer) {
    layer = document.createElement('span');
    layer.className = 'fx';
    layer.setAttribute('aria-hidden', 'true');
    target.append(layer);
  }
  return layer;

}


/* ---------- tier ---------- */

function weakDevice() {

  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  const saveData = navigator.connection && navigator.connection.saveData;

  return cores <= 4 && memory <= 4 || memory <= 2 || !!saveData;

}

export function motionTier() {

  return html.dataset.motion || 'full';

}

function setTier() {

  html.dataset.motion = reducedQuery.matches ? 'reduced' : (weakDevice() || slowFrames >= 6 ? 'lite' : 'full');

}

/* watch the first 2.5 s: many slow frames = this phone wants less */
function measureFrames() {

  if (reducedQuery.matches || !globalThis.requestAnimationFrame) return;

  let last = performance.now();
  const until = last + 2500;

  function frame(now) {
    if (now - last > 50) slowFrames++;
    last = now;
    if (now < until) requestAnimationFrame(frame);
    else setTier();
  }

  requestAnimationFrame(frame);

}


/* ---------- mouse: light + depth ---------- */

function pointerLight() {

  let pending = null;
  let current = null;

  function apply() {
    const { card, x, y } = pending;
    pending = null;
    const rect = card.getBoundingClientRect();
    const px = (x - rect.left) / rect.width;
    const py = (y - rect.top) / rect.height;
    card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    // posters drift a little against the pointer (depth)
    card.style.setProperty('--px', `${((0.5 - px) * 8).toFixed(2)}px`);
    card.style.setProperty('--py', `${((0.5 - py) * 8).toFixed(2)}px`);
  }

  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || !finePointer.matches || motionTier() !== 'full') return;
    const card = event.target.closest && event.target.closest(CARDS);
    if (card !== current) {
      if (current) current.classList.remove('is-lit');
      current = card;
      if (card) {
        fxLayer(card);
        card.classList.add('is-lit');
      }
    }
    if (!card) return;
    if (!pending) requestAnimationFrame(apply);
    pending = { card, x: event.clientX, y: event.clientY };
  }, { passive: true });

  document.addEventListener('pointerleave', () => {
    if (current) current.classList.remove('is-lit');
    current = null;
  });

}


/* ---------- touch: ripple ---------- */

function ripples() {

  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || motionTier() === 'reduced') return;
    const target = event.target.closest && event.target.closest(PRESSABLE);
    if (!target || target.matches(':disabled, [aria-disabled="true"]')) return;

    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.6;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.setAttribute('aria-hidden', 'true');
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    fxLayer(target).append(ripple);

    const done = () => ripple.remove();
    ripple.addEventListener('animationend', done, { once: true });
    setTimeout(done, 900);
  }, { passive: true });

}


/* ---------- reveals ---------- */

let observer = null;

function revealObserver() {

  if (observer) return observer;

  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      reveal(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  return observer;

}

function reveal(widget) {

  // the cards inside follow the widget, one after another
  widget.querySelectorAll(':scope li, :scope .item-card, :scope .game').forEach((child, i) => {
    child.style.setProperty('--j', String(Math.min(i, 8)));
  });
  widget.classList.remove('will-reveal');
  widget.classList.add('is-revealed');

}

/**
 * Called after the page's widgets are in the DOM. Widgets on screen enter
 * with a stagger; the rest wait until they scroll in. Reduced / lite:
 * everything simply shows.
 */
export function choreograph(widgets) {

  const tier = motionTier();

  if (tier === 'reduced' || !('IntersectionObserver' in window)) {
    return;
  }

  const fold = innerHeight * 0.92;
  let index = 0;

  for (const widget of widgets) {
    const top = widget.getBoundingClientRect().top;
    if (top < fold) {
      widget.classList.add('is-entering', 'is-new');
      widget.style.setProperty('--i', String(index++));
      widget.addEventListener('animationend', event => {
        if (event.target === widget) widget.classList.remove('is-entering');
      });
    }
    else if (tier === 'full') {
      widget.classList.add('will-reveal');
      revealObserver().observe(widget);
    }
  }

}


/* ---------- start ---------- */

export function startFeel() {

  setTier();
  measureFrames();
  reducedQuery.addEventListener?.('change', setTier);
  pointerLight();
  ripples();

}
