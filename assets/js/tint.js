/*
 * «لون الموقع»: the sheet where a member picks the site's colour (site redesign W2, approved S3).
 * The site recolours under the sheet while they choose (look.js swaps the gold tokens); «احفظ اللون» keeps it in
 * the account (the caller's save) and beside the session; «رجّع الذهبي» goes back to gold; × or the scrim close it
 * without changing anything. A sheet from below on a phone, a window in the middle on a computer.
 * Its look is assets/css/tint.css, loaded with the first opening.
 */

const CSS = new URL('../css/tint.css', import.meta.url).href;
let cssReady = null;

function loadCss() {
  if (!cssReady) {
    cssReady = new Promise(resolve => {
      if (document.querySelector('link[data-tint-css]')) return resolve();
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS;
      link.dataset.tintCss = '';
      link.onload = link.onerror = () => resolve();
      document.head.append(link);
    });
  }
  return cssReady;
}

const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') for (const [p, x] of Object.entries(v)) n.style.setProperty(p, x);
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined) n.append(k);
  return n;
}

function swatch(id, t) {
  return el('button', {
    type: 'button', class: 'tint-opt', 'data-id': id, 'aria-pressed': 'false',
    style: { '--m': hex(t.main), '--h': hex(t.hi), '--d': hex(t.deep), '--k': hex(t.ink) }
  },
  el('span', { class: 'tint-opt__sw' }, el('i')),
  el('span', { class: 'tint-opt__name' }, t.name),
  el('small', {}, t.note || ' '),
  el('span', { class: 'tint-opt__demo' }, el('em'), el('b')),
  el('span', { class: 'tint-opt__ok', 'aria-hidden': 'true' }, '✓'));
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/*
 * openTint({ save }) → the sheet. save(id) keeps the colour in the account (a promise; a rejection keeps the sheet
 * open and says so). onSaved(id) is told after it is kept.
 */
export async function openTint({ save, onSaved } = {}) {
  const look = window.SiteLook;
  if (!look || document.querySelector('.tint-sheet')) return;
  await loadCss();
  const saved = look.current();
  const before = document.activeElement;
  let busy = false;

  const close = keep => {
    if (!keep && look.current() !== saved) look.apply(saved);
    document.removeEventListener('keydown', onKey, true);
    w.classList.remove('is-open');
    setTimeout(() => w.remove(), reduced() ? 0 : 320);
    if (before && before.focus) before.focus({ preventScroll: true });
  };
  const mark = () => {
    for (const b of w.querySelectorAll('.tint-opt')) {
      const on = b.dataset.id === look.current();
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  const msg = el('p', { class: 'tint-msg', role: 'status', hidden: '' });
  const saveBtn = el('button', { type: 'button', class: 'btn btn--primary tint-save' }, 'احفظ اللون');
  const box = el('section', { class: 'tint-sheet__box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tint-t' },
    el('span', { class: 'tint-sheet__grip', 'aria-hidden': 'true' }),
    el('header', {},
      el('div', {}, el('h2', { id: 'tint-t' }, 'لون الموقع'), el('p', {}, 'اختار اللون اللي تحبه. بيتحفظ في حسابك، والموقع بيفتح بيه على أي جهاز تدخل منه.')),
      el('button', { type: 'button', class: 'tint-x', 'aria-label': 'اقفل' }, '×')),
    el('div', { class: 'tint-grid' }, look.order.map(id => swatch(id, look.tints[id]))),
    el('p', { class: 'tint-note' }, 'الموقع بيتلوّن قدامك وإنت بتختار. اللوجو وصور الكنيسة وألوان فيسبوك وتيك توك بيفضلوا زي ما هما.'),
    msg,
    el('footer', {}, saveBtn, el('button', { type: 'button', class: 'btn tint-reset' }, 'رجّع الذهبي')));
  const w = el('div', { class: 'tint-sheet' }, el('div', { class: 'tint-sheet__scrim' }), box);

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
    if (e.key !== 'Tab') return;
    const f = [...box.querySelectorAll('button:not([disabled])')];
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }

  box.querySelector('.tint-grid').addEventListener('click', e => {
    const b = e.target.closest('.tint-opt');
    if (!b) return;
    look.apply(b.dataset.id);
    msg.hidden = true;
    mark();
  });
  box.querySelector('.tint-reset').addEventListener('click', () => { look.apply('gold'); msg.hidden = true; mark(); });
  box.querySelector('.tint-x').addEventListener('click', () => close(false));
  w.querySelector('.tint-sheet__scrim').addEventListener('click', () => close(false));
  saveBtn.addEventListener('click', async () => {
    if (busy) return;
    const id = look.current();
    busy = true;
    saveBtn.disabled = true;
    try {
      if (save) await save(id);
      look.remember(id);
      close(true);
      if (onSaved) onSaved(id);
    }
    catch {
      msg.textContent = 'مقدرناش نحفظ اللون دلوقتي. جرّب تاني بعد شوية.';
      msg.hidden = false;
    }
    finally {
      busy = false;
      saveBtn.disabled = false;
    }
  });

  document.body.append(w);
  mark();
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => {
    w.classList.add('is-open');
    (box.querySelector('.tint-opt.is-on') || box.querySelector('.tint-x')).focus({ preventScroll: true });
  });
}
