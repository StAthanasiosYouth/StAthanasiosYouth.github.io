/**
 * YOUTH ACCOUNT: how the page moves. A real cross-screen transition where the browser has View
 * Transitions, the arch staged once a visit, numbers that count up. Only transform, opacity and
 * filter move. Reduced motion: nothing moves, states just change. A weak phone: no blur, no stagger
 * (html[data-motion], the home page's own tier). Without any of it the page is simply there.
 */

const html = document.documentElement;
const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

function weakDevice() {
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  const saveData = navigator.connection && navigator.connection.saveData;
  return (cores <= 4 && memory <= 4) || memory <= 2 || !!saveData;
}

export const reduced = () => reducedQuery.matches;

export function setTier() {
  html.dataset.motion = reduced() ? 'reduced' : weakDevice() ? 'lite' : 'full';
}

/*
 * change(): the DOM swap. kind: forward | back | fade | enter | leave, read by account.css on html[data-vt].
 * Never throws and never delays the swap for long: a browser without it just swaps.
 */
export function transition(kind, change) {
  if (reduced() || html.dataset.motion === 'lite' || typeof document.startViewTransition !== 'function' || document.hidden) {
    change();
    return;
  }
  html.dataset.vt = kind;
  try {
    const run = document.startViewTransition(change);
    run.finished.catch(() => {}).finally(() => { if (html.dataset.vt === kind) delete html.dataset.vt; });
    run.ready.catch(() => {});
    run.updateCallbackDone.catch(() => {});
  }
  catch {
    delete html.dataset.vt;
    change();
  }
}

/* the balance and the band's numbers climb to their value, once; the text is always the right number at rest */
export function countUp(el, to, format) {
  if (reduced() || html.dataset.motion === 'lite' || !(to > 0)) {
    el.textContent = format(to);
    return;
  }
  el.textContent = format(0);
  const started = performance.now();
  const span = Math.min(900, 420 + to * 2);
  const step = now => {
    const t = Math.min(1, (now - started) / span);
    const eased = 1 - Math.pow(1 - t, 4);
    el.textContent = format(t === 1 ? to : Math.round(to * eased));
    if (t < 1 && el.isConnected) requestAnimationFrame(step);
    else el.textContent = format(to);
  };
  requestAnimationFrame(step);
}

const STAGED = 'athanasios.account.staged.v1';

/* the arch's arrival plays once a visit; deep links and returning to the home just appear */
export function firstArrival() {
  if (reduced()) return false;
  try {
    if (sessionStorage.getItem(STAGED)) return false;
    sessionStorage.setItem(STAGED, '1');
  }
  catch { /* played again next time */ }
  return true;
}

export function resetArrival() {
  try {
    sessionStorage.removeItem(STAGED);
  }
  catch { /* nothing kept */ }
}

/* a moment of light on the arch when the photo changed */
export function bloom(arch) {
  if (!arch || reduced()) return;
  arch.classList.remove('is-bloom');
  void arch.getBoundingClientRect();
  arch.classList.add('is-bloom');
  setTimeout(() => arch.classList.remove('is-bloom'), 1100);
}
