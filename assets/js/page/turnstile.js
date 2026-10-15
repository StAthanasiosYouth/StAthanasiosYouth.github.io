/**
 * CLOUDFLARE TURNSTILE — the «I'm not a robot» check before a booking is
 * sent (worker/BOOKING-API.md «Turnstile»).
 *
 * Only when GET /v1/book/state names a site key: the script
 * (challenges.cloudflare.com, allowed by the page shells' CSP: script-src
 * and frame-src) is loaded once, on the send step only, and rendered
 * explicitly in the given box. The token is single use: after any failed
 * send the widget is reset for a fresh one.
 *
 *   mountTurnstile(box, siteKey, { onChange }) → { token(), reset(), remove(), ready }
 *   onChange(token|'')   '' while there is none (expired, failed, reset)
 *
 * The script failing to load is told through onChange('') + onError: the
 * page then says the check couldn't load (the Worker refuses a send
 * without a token anyway).
 */

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const SITE_KEY = /^[0-9A-Za-z_-]{10,80}$/;

const loading = new WeakMap();    // window → the script's promise (one script per page)

export function loadTurnstile(doc = document, win = window) {
  if (win.turnstile) return Promise.resolve(win.turnstile);
  if (loading.has(win)) return loading.get(win);
  const promise = new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => (win.turnstile ? resolve(win.turnstile) : reject(new Error('turnstile missing'))));
    script.addEventListener('error', () => reject(new Error('turnstile blocked')));
    doc.head.appendChild(script);
  }).catch(error => {
    loading.delete(win);
    throw error;
  });
  loading.set(win, promise);
  return promise;
}

export function mountTurnstile(box, siteKey, { onChange = () => {}, onError = () => {}, doc = document, win = window } = {}) {
  let id = null;
  let value = '';
  let gone = false;
  const set = token => {
    value = token;
    onChange(token);
  };
  const ready = loadTurnstile(doc, win).then(ts => {
    if (gone) return;
    id = ts.render(box, {
      sitekey: siteKey,
      action: 'book',
      language: 'ar',
      theme: 'auto',
      // flexible needs ≥ 300 px; a phone's form is narrower (≈ 260 px at 360): compact, never clipped
      size: box.clientWidth && box.clientWidth < 300 ? 'compact' : 'flexible',
      'refresh-expired': 'auto',
      callback: token => set(String(token || '')),
      'expired-callback': () => set(''),
      'timeout-callback': () => set(''),
      'error-callback': () => {
        set('');
        onError();
        return true;
      }
    });
  }, () => {
    if (gone) return;
    set('');
    onError();
  });
  return {
    ready,
    token: () => value,
    reset() {
      set('');
      if (id !== null && win.turnstile) win.turnstile.reset(id);
    },
    remove() {
      gone = true;
      if (id !== null && win.turnstile) win.turnstile.remove(id);
      id = null;
    }
  };
}
