/**
 * ONLINE BOOKING — the event page's «احجز الآن» when event.json says
 * booking.online (docs/EVENTS.md §7.1; worker/BOOKING-API.md)
 *
 * Loaded by main.js only for such an event, after view.js has drawn the
 * Phase 3 area (prices, window, the servants' WhatsApp). That area stays
 * underneath: until the live state arrives, and whenever the API can't
 * be reached or says booking is off, it is exactly what the visitor sees.
 *
 *   state  GET /v1/book/state on load and on coming back to the tab:
 *          «الحجز مفتوح» + «فاضل N مكان» / «لسه ما فتحش» (+ the date) /
 *          «الحجز اتقفل» / «اكتمل العدد»
 *   flow   a  who's coming: name, phone, counts (+ names)
 *          b  servant and method, «كلّم الخادم على واتساب» (paid events)
 *          c  proof pictures (uploaded one by one, right away), note, terms,
 *             the Turnstile check when the state names a site key (turnstile.js)
 *          → POST /v1/book/submit with the draft's requestKey
 *          done: the reference, the status link («انسخ الرابط»)
 *   mine   «حجزك B-XXXXX: قيد المراجعة» for this device's bookings here
 *
 * The draft (book-store.js) survives a trip to WhatsApp: the page opens
 * on the same step. Text only (dom.js h()), no name or phone in any URL.
 */

import { h } from '../dom.js';
import { arabicDigits } from '../words.js';
import { cue } from '../ui-sound.js';
import { stepCount, canStep, totalOf, money, waWithText } from './model.js';
import {
  liveState, stepsFor, isFree, peopleCount, peopleOf, peopleText, normPhone, checkWho, checkPay, checkSend,
  needsProof, newRequestKey, submitBody, payMessage, emptyDraft, bookingError, statusWord, statusHref,
  mineFor, isRef, isToken, PROOFS_MAX, NOTE_MAX, NAME_MAX,
  methodOnline, onlineMethodsOf, offlineServants, payCopyText, payGrouped, cashMessage
} from './book-model.js';
import { loadDraft, saveDraft, clearDraft, loadMine, rememberBooking, forgetBooking } from './book-store.js';
import { prepareImage, UNSUPPORTED } from './image.js';
import { createBookApi } from './book-api.js';
import { bookApiUrl } from './book-config.js';
import { icon } from './view.js';
import { mountTurnstile } from './turnstile.js';

const PROOF_ID = /^prf-[a-z2-7]{8}$/;

const STEP_TITLES = { a: 'مين جاي؟', b: 'الدفع', c: 'صورة التحويل وتأكيد الطلب' };

const SECTION_CLASS = { open: 'is-open', not_open: 'is-before', closed: 'is-closed', full: 'is-closed' };

const LINE_WORDS = {
  not_open: 'للاستفسار كلّم خادم من دول على واتساب',
  closed: 'لو عندك سؤال كلّم خادم من دول على واتساب',
  full: 'لو عندك سؤال كلّم خادم من دول على واتساب'
};

function randomKey() {
  const bytes = new Uint8Array(22);
  if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return newRequestKey(bytes);
}


/* =========================================================
   THE ADMIN PREVIEW (§17.10): the online look, still; no network, no storage
========================================================= */

export function previewBooking() {
  const section = document.getElementById('book');
  if (!section || section.querySelector('.bk')) return;
  section.classList.remove('is-before', 'is-closed');
  section.classList.add('is-online', 'is-open');
  section.dataset.live = 'open';
  const chip = section.querySelector('.book__state');
  if (chip) chip.textContent = 'الحجز مفتوح';
  section.append(h('div', { class: 'bk' },
    h('div', { class: 'bk__flow' },
      h('button', { class: 'btn btn--primary bk-start', type: 'button', disabled: true }, 'احجز الآن'),
      h('p', { class: 'bk-note' }, 'في المعاينة الحجز مش شغال: الزوار هيحجزوا من هنا.')
    )
  ));
}


/* =========================================================
   THE PAGE
========================================================= */

export function mountBooking({ event, rootUrl, announce = () => {}, reduced = false }) {

  const section = document.getElementById('book');
  if (!section) return null;

  const booking = event.booking;
  const slug = event.slug;
  const api = createBookApi({ base: bookApiUrl() });
  const steps = stepsFor(booking);
  const free = isFree(booking);

  // what view.js drew, to put back on a fallback
  const chipEl = section.querySelector('.book__state');
  const lineEl = section.querySelector('.book__line');
  const heroCta = document.querySelector('.phero__cta');
  const original = {
    className: section.className,
    chip: chipEl ? chipEl.textContent : '',
    line: lineEl ? lineEl.textContent : '',
    cta: heroCta && heroCta.firstChild ? heroCta.firstChild.textContent : ''
  };

  const leftEl = h('p', { class: 'bk__left', hidden: true });
  const stateEl = h('p', { class: 'bk__state', hidden: true });
  const mineEl = h('ul', { class: 'bk__mine', 'aria-label': 'حجوزاتك', hidden: true });
  const flowEl = h('div', { class: 'bk__flow' });
  const block = h('div', { class: 'bk', hidden: true }, leftEl, stateEl, mineEl, flowEl);
  section.append(block);

  let live = null;            // liveState()
  let mode = 'start';         // start | flow | done
  let draft = loadDraft(slug, booking);
  let resumed = !!draft;
  // back from the payment app after copying the number: the card says «رجعت؟»
  const backFromApp = !!(draft && draft.pay === 'copied');
  let proofs = (draft ? draft.proofs : []).map(p => ({ id: nextId(), state: 'saved', proofId: p.proofId, claim: p.claim, url: '', blob: null, error: '' }));
  let done = null;            // the submit reply
  let sending = false;
  let lastRefresh = 0;
  let saveTimer = 0;
  let destroyed = false;
  let captcha = null;         // the send step's Turnstile (mountTurnstile), while it is drawn

  function dropCaptcha() {
    if (captcha) captcha.remove();
    captcha = null;
  }

  function nextId() {
    nextId.n = (nextId.n || 0) + 1;
    return nextId.n;
  }


  /* ---------- the draft ---------- */

  function syncProofs() {
    if (draft) draft.proofs = proofs.filter(p => p.state === 'done' || p.state === 'saved').map(p => ({ proofId: p.proofId, claim: p.claim }));
  }

  function saveNow() {
    clearTimeout(saveTimer);
    if (!draft || mode !== 'flow') return;
    syncProofs();
    saveDraft(slug, draft);
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  addEventListener('pagehide', saveNow);

  // off to InstaPay / the wallet / WhatsApp and back: iOS doesn't always fire pagehide on an app
  // switch, so the draft is also saved when the page goes out of sight; back after a while,
  // the Turnstile token (≈5 min) is renewed before the send
  let hiddenAt = 0;
  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      saveNow();
    }
    else if (hiddenAt && Date.now() - hiddenAt > 4 * 60 * 1000 && captcha) {
      captcha.reset();
    }
  }
  document.addEventListener('visibilitychange', onVisibility);


  /* ---------- the live state ---------- */

  function fallback() {
    section.className = original.className;
    delete section.dataset.live;
    if (chipEl) chipEl.textContent = original.chip;
    if (lineEl) lineEl.textContent = original.line;
    if (heroCta && heroCta.firstChild) heroCta.firstChild.textContent = original.cta;
    leftEl.hidden = true;
    stateEl.hidden = true;
    dropCaptcha();
    flowEl.replaceChildren();
    block.hidden = mineEl.hidden;
    block.dataset.live = 'fallback';
    live = { live: 'fallback' };
  }

  function applyState(next) {

    live = next;
    if (next.live === 'fallback') {
      fallback();
      return;
    }

    section.classList.remove('is-open', 'is-before', 'is-closed');
    section.classList.add('is-online', SECTION_CLASS[next.live]);
    section.dataset.live = next.live;
    block.dataset.live = next.live;
    if (chipEl) chipEl.textContent = next.chip;
    if (lineEl) lineEl.textContent = next.live === 'open' ? original.line : LINE_WORDS[next.live];
    if (heroCta && heroCta.firstChild) heroCta.firstChild.textContent = next.live === 'open' ? 'احجز الآن' : 'الأسعار والحجز';
    block.hidden = false;

    leftEl.textContent = next.live === 'open' ? next.line : '';
    leftEl.hidden = !leftEl.textContent;
    stateEl.textContent = next.live === 'open' ? '' : next.line;
    stateEl.hidden = !stateEl.textContent;

    if (next.live !== 'open') {
      if (mode === 'flow') saveNow();
      if (mode !== 'done') {
        mode = 'start';
        flowEl.replaceChildren();
      }
      return;
    }

    if (mode === 'start') {
      // a draft (back from WhatsApp, or the page was closed): the same step again
      if (draft && resumed) {
        resumed = false;
        openFlow(draft.step, { focus: false, notice: 'كمّلنا من مكان ما وقفت.' });
      }
      else renderStart();
    }

  }

  async function refresh({ force = false } = {}) {
    if (destroyed || (!force && Date.now() - lastRefresh < 10000)) return;
    lastRefresh = Date.now();
    const reply = await api.state(slug);
    if (destroyed) return;
    applyState(liveState(reply, booking));
    refreshMine();
  }


  /* ---------- «حجزك B-XXXXX: قيد المراجعة» ---------- */

  async function refreshMine() {
    const mine = mineFor(loadMine(), slug).slice(0, 3);
    if (!mine.length) {
      mineEl.hidden = true;
      mineEl.replaceChildren();
      block.hidden = live ? live.live === 'fallback' : true;
      return;
    }
    const replies = await Promise.all(mine.map(entry => api.status(entry.token)));
    if (destroyed) return;
    const items = [];
    mine.forEach((entry, i) => {
      const reply = replies[i];
      if (!reply.ok && reply.code === 'expired') {
        forgetBooking(entry.token);
        return;
      }
      const word = reply.ok ? statusWord(reply.status) : '';
      items.push(h('li', {},
        h('a', { class: 'bk-mine', href: `#b/${entry.token}`, 'data-status': reply.ok ? reply.status : '' },
          h('span', {}, 'حجزك ', h('bdi', { dir: 'ltr' }, entry.ref), word ? ': ' : ''),
          word ? h('span', { class: 'bk-mine__status' }, word) : null,
          icon('arrow', 'bk-mine__go')
        )
      ));
    });
    mineEl.replaceChildren(...items);
    mineEl.hidden = !items.length;
    block.hidden = !items.length && (!live || live.live === 'fallback');
  }


  /* ---------- the start ---------- */

  function renderStart() {
    mode = 'start';
    dropCaptcha();
    const start = h('button', { class: 'btn btn--primary bk-start', type: 'button' }, draft ? 'كمّل حجزك' : 'احجز الآن', icon('arrow'));
    start.addEventListener('click', () => {
      if (!draft) draft = emptyDraft(booking, randomKey(), Date.now());
      openFlow(draft.step, { focus: true });
    });
    const again = draft
      ? h('button', { class: 'bk-link', type: 'button', onclick: () => { startOver(); } }, 'ابدأ من الأول')
      : null;
    flowEl.replaceChildren(...[
      start,
      again,
      h('p', { class: 'bk-note' }, free ? 'سجّل اسمك والعدد، والخادم هيأكد لك.' : 'سجّل بياناتك، ادفع لخادم من خدام الرحلة، وارفع صورة الدفع.')
    ].filter(Boolean));
  }

  function startOver() {
    for (const p of proofs) if (p.url) URL.revokeObjectURL(p.url);
    proofs = [];
    clearDraft(slug);
    draft = emptyDraft(booking, randomKey(), Date.now());
    openFlow('a', { focus: true });
  }


  /* =========================================================
     THE FLOW
  ========================================================= */

  let stepEl = null;      // the current step's container
  let alertEl = null;

  function openFlow(step, { focus = true, notice = '' } = {}) {
    mode = 'flow';
    draft.step = steps.includes(step) ? step : 'a';
    saveNow();
    renderStep({ focus, notice });
  }

  function go(step) {
    draft.step = step;
    saveNow();
    renderStep({ focus: true });
  }

  function showAlert(message, tone = 'error') {
    if (!alertEl) return;
    alertEl.textContent = message;
    alertEl.dataset.tone = tone;
    alertEl.hidden = !message;
  }

  /* one field: label, control, hint, its error (aria-describedby both) */
  function field(name, label, control, hint = '') {
    const id = control.id;
    const hintEl = hint ? h('p', { class: 'bk-field__hint', id: `${id}-hint` }, hint) : null;
    const errEl = h('p', { class: 'bk-field__err', id: `${id}-err`, hidden: true });
    control.setAttribute('aria-describedby', [hint ? `${id}-hint` : '', `${id}-err`].filter(Boolean).join(' '));
    return h('div', { class: 'bk-field', 'data-field': name },
      h('label', { class: 'bk-field__label', for: id }, label),
      control,
      hintEl,
      errEl
    );
  }

  /* a group of controls (counts, choices): the error under its legend */
  function group(name, legend, ...children) {
    const errEl = h('p', { class: 'bk-field__err', id: `bk-${name}-err`, hidden: true });
    return h('fieldset', { class: 'bk-field bk-group', 'data-field': name, 'aria-describedby': `bk-${name}-err` },
      h('legend', { class: 'bk-field__label' }, legend),
      errEl,
      ...children
    );
  }

  /* problems: { field: words }; only: just these fields (the others keep what they show) */
  function showErrors(problems, { focus = true, only = null } = {}) {
    if (!stepEl) return true;
    for (const wrap of stepEl.querySelectorAll('[data-field]')) {
      if (only && !only.includes(wrap.dataset.field)) continue;
      const message = problems[wrap.dataset.field] || '';
      const err = wrap.querySelector('.bk-field__err');
      if (err) {
        err.textContent = message;
        err.hidden = !message;
      }
      wrap.classList.toggle('is-invalid', !!message);
      for (const control of wrap.querySelectorAll('input:not([type="radio"]):not([type="file"]), textarea')) {
        if (message) control.setAttribute('aria-invalid', 'true');
        else control.removeAttribute('aria-invalid');
      }
    }
    const first = Object.keys(problems).length ? stepEl.querySelector('.is-invalid') : null;
    if (first && focus) {
      const target = first.querySelector('input:not([type="file"]):not([disabled]), textarea, button:not([disabled])') || first;
      target.focus({ preventScroll: true });
      first.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    }
    return !first;
  }

  function renderStep({ focus = true, notice = '' } = {}) {

    dropCaptcha();
    const step = draft.step;
    const at = steps.indexOf(step);
    const title = step === 'c' && free ? 'تأكيد الطلب' : STEP_TITLES[step];

    alertEl = h('p', { class: 'bk-alert', role: 'alert', hidden: true });
    const heading = h('h3', { class: 'bk-flow__title', id: 'bk-step-title', tabindex: '-1' }, title);

    const body = step === 'a' ? stepWho() : step === 'b' ? stepPay() : stepSend();

    stepEl = h('div', { class: 'bk-flow', 'data-step': step },
      h('p', { class: 'bk-flow__progress' }, `خطوة ${arabicDigits(at + 1)} من ${arabicDigits(steps.length)}`),
      heading,
      alertEl,
      body
    );
    flowEl.replaceChildren(stepEl);
    if (notice) showAlert(notice, 'info');

    if (focus) {
      heading.focus({ preventScroll: true });
      stepEl.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }
    announce(`${title}، خطوة ${arabicDigits(at + 1)} من ${arabicDigits(steps.length)}`);

  }

  function actions(back, next) {
    return h('div', { class: 'bk-actions' }, next, back);
  }

  function backButton(label, onClick) {
    return h('button', { class: 'btn bk-back', type: 'button', onclick: onClick }, label);
  }


  /* ---------- a: who's coming ---------- */

  function stepWho() {

    const name = h('input', { class: 'bk-input', id: 'bk-name', name: 'name', type: 'text', autocomplete: 'name', maxlength: NAME_MAX, required: true, value: draft.fields.name });
    const phone = h('input', { class: 'bk-input bk-input--ltr', id: 'bk-phone', name: 'phone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', dir: 'ltr', maxlength: 20, required: true, value: draft.fields.phone });
    name.addEventListener('input', () => {
      draft.fields.name = name.value;
      saveSoon();
      if (name.getAttribute('aria-invalid') && name.value.trim().length >= 2) showErrors({}, { focus: false, only: ['name'] });
    });
    // gentle: a wrong number is said when the visitor leaves the box; it goes as soon as it's right
    // (never cleared on blur: the page would jump under the finger that is tapping elsewhere)
    phone.addEventListener('input', () => {
      draft.fields.phone = phone.value;
      saveSoon();
      if (phone.getAttribute('aria-invalid') && normPhone(phone.value)) showErrors({}, { focus: false, only: ['phone'] });
    });
    phone.addEventListener('blur', () => {
      if (phone.value.trim() && !normPhone(phone.value)) showErrors({ phone: 'اكتب رقم موبايل مصري صح، زي 01012345678' }, { focus: false, only: ['phone'] });
    });

    const total = h('output', { class: 'prices__total-n', 'aria-live': 'polite' }, money(totalOf(booking, draft.counts)));
    const steppers = [];
    const namesBox = h('div', { class: 'bk-names' });

    function refreshCounts() {
      total.textContent = money(totalOf(booking, draft.counts));
      for (const s of steppers) {
        s.out.textContent = arabicDigits(draft.counts[s.key] || 0);
        s.minus.disabled = !canStep(booking, draft.counts, s.key, -1);
        s.plus.disabled = !canStep(booking, draft.counts, s.key, +1);
      }
    }

    function stepper(c) {
      const out = h('output', { class: 'stepper__n' }, arabicDigits(draft.counts[c.key] || 0));
      const minus = h('button', { class: 'stepper__btn', type: 'button', 'aria-label': `قلّل ${c.label}` }, icon('minus'));
      const plus = h('button', { class: 'stepper__btn', type: 'button', 'aria-label': `زوّد ${c.label}` }, icon('plus'));
      const step = delta => () => {
        const next = stepCount(booking, draft.counts, c.key, delta);
        if (next === draft.counts) return;
        draft.counts = next;
        refreshCounts();
        renderNames();
        saveSoon();
        announce(`${c.label}: ${arabicDigits(draft.counts[c.key])}، الإجمالي ${money(totalOf(booking, draft.counts))}`);
      };
      minus.addEventListener('click', step(-1));
      plus.addEventListener('click', step(+1));
      steppers.push({ key: c.key, out, minus, plus });
      return h('div', { class: 'stepper', role: 'group', 'aria-label': `عدد ${c.label}` }, minus, out, plus);
    }

    const rows = booking.pricing.categories.map(c => h('li', { class: 'price' },
      h('div', { class: 'price__who' },
        h('span', { class: 'price__label' }, c.label),
        c.note ? h('span', { class: 'price__note' }, c.note) : null
      ),
      h('span', { class: 'price__amount' }, money(c.price)),
      c.min !== c.max ? stepper(c) : h('span', { class: 'stepper stepper--fixed' }, arabicDigits(c.min))
    ));

    function renderNames() {
      if (!booking.collectNames) return;
      const want = peopleCount(booking, draft.counts);
      const inputs = [];
      for (let i = 0; i < want; i++) {
        const input = h('input', { class: 'bk-input', id: `bk-names-${i}`, type: 'text', autocomplete: i === 0 ? 'name' : 'off', maxlength: NAME_MAX, value: draft.names[i] || (i === 0 ? draft.fields.name : '') });
        input.addEventListener('input', () => { draft.names[i] = input.value; saveSoon(); });
        inputs.push(h('div', { class: 'bk-names__row' }, h('label', { class: 'bk-field__label', for: input.id }, i === 0 ? 'الاسم ١ (انت)' : `الاسم ${arabicDigits(i + 1)}`), input));
      }
      namesBox.replaceChildren(...inputs);
    }

    const counts = group('counts', 'العدد',
      h('ul', { class: 'prices__list bk-counts', 'aria-label': 'الأسعار' }, rows),
      h('p', { class: 'prices__total' }, h('span', {}, 'الإجمالي'), total),
      booking.perBookingMax ? h('p', { class: 'prices__note' }, `أقصى عدد في الحجز الواحد ${arabicDigits(booking.perBookingMax)}.`) : null
    );

    // a bot fills every box; a person never sees this one
    const hp = h('div', { class: 'bk-hp', 'aria-hidden': 'true' },
      h('label', { for: 'bk-hp' }, 'سيب الخانة دي فاضية'),
      h('input', { id: 'bk-hp', name: 'hp', type: 'text', tabindex: '-1', autocomplete: 'off' })
    );

    const next = h('button', { class: 'btn btn--primary bk-next', type: 'submit' }, 'التالي', icon('arrow'));
    const form = h('form', { class: 'bk-form', novalidate: true },
      field('name', 'اسمك', name),
      field('phone', 'رقم موبايلك', phone, 'الخادم هيكلمك عليه، ومش بيظهر لحد.'),
      h('div', { class: 'prices bk-prices' }, counts),
      booking.collectNames ? group('names', 'أسماء اللي جايين', h('p', { class: 'bk-field__hint' }, 'اسم كل واحد جاي، وانت منهم.'), namesBox) : null,
      hp,
      actions(backButton('رجوع', () => { saveNow(); renderStart(); flowEl.querySelector('.bk-start')?.focus(); }), next)
    );

    form.addEventListener('submit', submitEvent => {
      submitEvent.preventDefault();
      draft.fields.name = name.value;
      draft.fields.phone = phone.value;
      if (booking.collectNames) draft.names = [...namesBox.querySelectorAll('input')].map(input => input.value);
      const problems = checkWho(booking, { name: name.value, phone: phone.value, counts: draft.counts, names: draft.names }, live ? live.left : null);
      if (!showErrors(problems)) return;
      go(steps[steps.indexOf('a') + 1]);
    });

    refreshCounts();
    renderNames();
    return form;

  }

  /* ---------- b: servant and method ---------- */

  /*
   * Online methods only are picked here (cash is servant-assisted: the
   * «كاش مع الخادم» card under it, WhatsApp prefilled, the servant registers
   * the booking). InstaPay / a wallet: the payment card — the amount, the
   * number the primary admin approved (POST /v1/book/pay: never in
   * event.json), «نسخ الرقم», what to do in the app, then «تم التحويل» → the
   * screenshot step. Another online method: talk to the servant as before.
   */
  const PAY_CARD = new Set(['instapay', 'wallet']);
  const payCache = new Map();         // `${servant}|${method}|${counts}` → the /v1/book/pay reply

  async function copyNumber(text, button, help) {
    let ok = false;
    try {
      if (navigator.clipboard && globalThis.isSecureContext !== false) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    }
    catch {
      ok = false;
    }
    if (!ok) {
      // older browsers: a hidden field + the copy command
      const area = h('textarea', { class: 'bk-copy-field', readonly: true, 'aria-hidden': 'true', tabindex: '-1' });
      area.value = text;
      document.body.append(area);
      area.select();
      try { ok = document.execCommand('copy'); }
      catch { ok = false; }
      area.remove();
    }
    if (ok) {
      const label = button.lastChild;
      label.textContent = 'اتنسخ الرقم ✓';
      button.classList.add('is-done');
      setTimeout(() => { label.textContent = 'نسخ الرقم'; button.classList.remove('is-done'); }, 2000);
      help.textContent = '';
      announce('اتنسخ الرقم');
      draft.pay = 'copied';
      saveNow();
    }
    else {
      // nothing could copy: select the number for a long-press copy
      const number = button.closest('.bk-paycard').querySelector('.bk-paycard__number');
      const range = document.createRange();
      range.selectNodeContents(number);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      help.textContent = 'مقدرناش ننسخ لوحدنا: اضغط على الرقم كتير واختار «نسخ».';
    }
    return ok;
  }

  function stepPay() {

    const methodOf = new Map(booking.methods.map(m => [m.key, m]));
    const servants = booking.servants.filter(s => s.id && onlineMethodsOf(booking, s).length);
    const cashServants = offlineServants(booking);
    const methodsBox = h('div', { class: 'bk-choices' });
    const payBox = h('div', { class: 'bk-wa bk-pay', 'aria-live': 'polite' });
    const next = h('button', { class: 'btn btn--primary bk-next', type: 'submit' }, h('span', {}, 'دفعت، كمّل'), icon('arrow'));
    let ready = true;                 // the next button may go on

    function servantOf() {
      return servants.find(s => s.id === draft.servantId) || null;
    }

    function setNext(label, on) {
      next.firstChild.textContent = label;
      next.disabled = !on;
      ready = on;
    }

    function talkToServant(servant) {
      const href = servant.wa ? waWithText(servant.wa, payMessage(event, servant, { name: draft.fields.name, counts: draft.counts, method: draft.method })) : '';
      payBox.replaceChildren(
        href
          ? h('a', { class: 'btn btn--wa bk-wa__btn', href, target: '_blank', rel: 'noopener', onclick: saveNow }, icon('whatsapp'), 'كلّم الخادم على واتساب', h('span', { class: 'visually-hidden' }, ' (بيفتح واتساب)'))
          : h('p', { class: 'bk-note' }, `اتفق مع ${servant.name} على الدفع.`),
        h('p', { class: 'bk-note bk-note--strong' }, 'بعد ما تدفع ارجع هنا وكمّل الحجز.')
      );
      setNext('دفعت، كمّل', true);
    }

    function amountLine(reply) {
      const total = reply && Number.isFinite(reply.amount) ? reply.amount : totalOf(booking, draft.counts);
      if (reply && reply.mode === 'installments' && reply.minFirst > 0 && reply.minFirst < total) {
        return h('p', { class: 'bk-paycard__amount' }, 'حوّل مقدم ', h('strong', {}, `${money(reply.minFirst)} على الأقل`), ` من الإجمالي ${money(total)}`);
      }
      return h('p', { class: 'bk-paycard__amount' }, 'المطلوب تحوّله: ', h('strong', {}, money(total)));
    }

    function payCard(servant, method, reply) {
      const m = methodOf.get(method);
      const label = (m && m.label) || method;
      const number = payCopyText(reply.number);
      const help = h('p', { class: 'bk-field__hint bk-paycard__help', role: 'status' });
      const copy = h('button', { class: 'btn bk-copy', type: 'button', 'data-act': 'copy-number' }, icon('copy'), h('span', {}, 'نسخ الرقم'));
      copy.addEventListener('click', () => copyNumber(number, copy, help));
      payBox.replaceChildren(h('div', { class: 'bk-paycard', 'data-method': method },
        amountLine(reply),
        h('p', { class: 'bk-paycard__label' }, `رقم ${label} بتاع ${servant.name}`),
        h('p', { class: 'bk-paycard__number', dir: 'ltr', translate: 'no' }, payGrouped(number)),
        reply.name ? h('p', { class: 'bk-paycard__name' }, 'الاسم اللي هيظهرلك: ', h('bdi', {}, reply.name)) : null,
        copy,
        help,
        h('ol', { class: 'bk-paycard__steps' },
          h('li', {}, `انسخ الرقم وافتح تطبيق ${method === 'wallet' ? 'المحفظة' : 'إنستاباي'}.`),
          h('li', {}, 'حوّل المبلغ للرقم ده.'),
          h('li', {}, 'خد سكرين شوت للتحويل.'),
          h('li', {}, 'ارجع هنا ودوس «تم التحويل» وارفع الصورة.')),
        draft.pay === 'copied' && backFromApp ? h('p', { class: 'bk-note bk-note--strong' }, 'رجعت؟ لو حوّلت دوس «تم التحويل».') : null
      ));
      if (draft.pay !== 'copied') draft.pay = 'shown';
      saveSoon();
      setNext('تم التحويل', true);
    }

    async function renderPay() {
      const servant = servantOf();
      const method = draft.method;
      if (!servant || !method) {
        payBox.replaceChildren();
        setNext('دفعت، كمّل', true);
        return;
      }
      if (!PAY_CARD.has(method)) {
        talkToServant(servant);
        return;
      }
      const key = `${servant.id}|${method}|${JSON.stringify(draft.counts)}`;
      let reply = payCache.get(key);
      if (!reply) {
        payBox.replaceChildren(h('p', { class: 'bk-note' }, 'بنجيب رقم التحويل…'));
        setNext('تم التحويل', false);
        reply = await api.pay(slug, servant.id, method, draft.counts);
        if (reply.ok || reply.code === 'invalid' || reply.code === 'disabled') payCache.set(key, reply);
      }
      // the visitor picked something else meanwhile
      if (servantOf() !== servant || draft.method !== method || destroyed) return;
      if (reply.ok && payCopyText(reply.number)) {
        payCard(servant, method, reply);
        return;
      }
      if (reply.code === 'disabled') {
        // the payment card isn't switched on: the number comes from the servant, as before
        talkToServant(servant);
        return;
      }
      const label = (methodOf.get(method) || {}).label || method;
      if (reply.code === 'invalid') {
        payBox.replaceChildren(h('p', { class: 'bk-alert', role: 'alert' }, `${label} مش متاح مع ${servant.name} دلوقتي. اختار خادم تاني أو طريقة تانية${cashServants.length ? '، أو ادفع كاش مع الخادم' : ''}.`));
        setNext('تم التحويل', false);
        return;
      }
      const again = h('button', { class: 'btn', type: 'button' }, 'جرّب تاني');
      again.addEventListener('click', () => { payCache.delete(key); renderPay(); });
      payBox.replaceChildren(h('p', { class: 'bk-alert', role: 'alert' }, bookingError(reply).message || 'مقدرناش نجيب رقم التحويل. جرّب تاني.'), again);
      setNext('تم التحويل', false);
    }

    function renderMethods() {
      const servant = servantOf();
      if (!servant) {
        methodsBox.replaceChildren();
        return;
      }
      const keys = onlineMethodsOf(booking, servant);
      if (!keys.includes(draft.method)) draft.method = keys.length === 1 ? keys[0] : '';
      methodsBox.replaceChildren(group('method', 'هتدفع إزاي؟',
        h('div', { class: 'bk-chips' }, keys.map(key => {
          const input = h('input', { type: 'radio', name: 'bk-method', value: key, id: `bk-method-${key}`, checked: draft.method === key });
          input.addEventListener('change', () => {
            draft.method = key;
            draft.pay = '';
            showErrors({}, { focus: false, only: ['method'] });
            renderPay();
            saveSoon();
          });
          return h('label', { class: 'bk-chip', for: input.id }, input, h('span', {}, (methodOf.get(key) || {}).label || key));
        }))
      ));
    }

    // «كاش مع الخادم»: for information — the servant registers the booking after taking the money
    const cashLabel = booking.methods.filter(m => !methodOnline(m)).map(m => m.label).join(' / ') || 'كاش';
    const cashCard = cashServants.length ? h('div', { class: 'bk-cash', 'data-cash': '1' },
      h('p', { class: 'bk-cash__title' }, `هتدفع ${cashLabel}؟`),
      h('p', { class: 'bk-note' }, 'بتدفع للخادم نفسه، وهو اللي بيسجّل حجزك بعد ما يستلم. مش محتاج تبعت الطلب من هنا.'),
      h('ul', { class: 'bk-cash__list' }, cashServants.map(s => h('li', { class: 'bk-cash__who' },
        h('span', { class: 'bk-pick__name' }, s.name),
        s.role ? h('span', { class: 'bk-pick__role' }, ` · ${s.role}`) : null,
        // the WhatsApp link only with the servant's consent (publicWa → event.json `wa`)
        s.wa
          ? h('a', { class: 'btn btn--wa bk-cash__wa', href: waWithText(s.wa, cashMessage(event, s, { name: draft.fields.name, counts: draft.counts })), target: '_blank', rel: 'noopener', onclick: saveNow },
            icon('whatsapp'), `واتساب ${s.name}`, h('span', { class: 'visually-hidden' }, ' (بيفتح واتساب)'))
          : h('span', { class: 'bk-note' }, ' — كلّمه في الكنيسة')
      )))
    ) : null;

    if (!servants.length) {
      // nothing to pay online here: the cash card is the way
      return h('div', { class: 'bk-form' },
        h('p', { class: 'bk-total' }, h('span', {}, 'المطلوب'), h('strong', {}, money(totalOf(booking, draft.counts)))),
        cashCard || h('p', { class: 'bk-note' }, 'الدفع للفعالية دي مع الخادم مباشرة.'),
        actions(backButton('رجوع', () => go('a')), null));
    }

    const picks = group('servantId', 'هتدفع لمين؟',
      h('div', { class: 'bk-picks' }, servants.map(s => {
        const input = h('input', { type: 'radio', name: 'bk-servant', value: s.id, id: `bk-servant-${s.id}`, checked: draft.servantId === s.id });
        input.addEventListener('change', () => {
          draft.servantId = s.id;
          draft.pay = '';
          showErrors({}, { focus: false, only: ['servantId', 'method'] });
          renderMethods();
          renderPay();
          saveSoon();
        });
        const initial = Array.from(s.name.replace(/^(أ\.|م\.|د\.|ابونا|أبونا)\s*/, ''))[0] || '؟';
        return h('label', { class: 'bk-pick', for: input.id },
          input,
          h('span', { class: 'person__avatar person__avatar--initial', 'aria-hidden': 'true' }, initial),
          h('span', { class: 'bk-pick__who' },
            h('span', { class: 'bk-pick__name' }, s.name),
            s.role ? h('span', { class: 'bk-pick__role' }, s.role) : null,
            h('span', { class: 'bk-pick__methods' }, onlineMethodsOf(booking, s).map(k => (methodOf.get(k) || {}).label).filter(Boolean).join(' · '))
          )
        );
      }))
    );

    const form = h('form', { class: 'bk-form', novalidate: true },
      h('p', { class: 'bk-total' }, h('span', {}, 'المطلوب'), h('strong', {}, money(totalOf(booking, draft.counts)))),
      picks,
      methodsBox,
      payBox,
      actions(backButton('رجوع', () => go('a')), next),
      cashCard
    );

    form.addEventListener('submit', submitEvent => {
      submitEvent.preventDefault();
      if (!ready) return;
      if (!showErrors(checkPay(booking, draft))) return;
      go('c');
    });

    renderMethods();
    renderPay();
    return form;

  }


  /* ---------- c: proof, note, terms, send ---------- */

  let proofList = null;
  let addButton = null;
  let fileInput = null;
  let sendButton = null;

  function renderProofs() {
    if (!proofList) return;
    const hadFocus = proofList.contains(document.activeElement);
    proofList.replaceChildren(...proofs.map((p, i) => {
      const n = arabicDigits(i + 1);
      const words = {
        preparing: 'بنجهّز الصورة…',
        uploading: 'بنرفع الصورة…',
        done: 'اترفعت',
        saved: 'اترفعت قبل كده',
        failed: p.error || UNSUPPORTED
      }[p.state];
      const busy = p.state === 'preparing' || p.state === 'uploading';
      return h('li', { class: 'bk-proof', 'data-state': p.state },
        p.url ? h('img', { class: 'bk-proof__img', src: p.url, alt: `صورة الدفع ${n}`, width: 56, height: 56 }) : h('span', { class: 'bk-proof__img bk-proof__img--none', 'aria-hidden': 'true' }, icon('calendar')),
        h('span', { class: 'bk-proof__text' },
          h('span', { class: 'bk-proof__name' }, `صورة ${n}`),
          h('span', { class: 'bk-proof__state', role: p.state === 'failed' ? 'alert' : null }, words),
          busy ? h('progress', { class: 'bk-proof__bar', 'aria-label': words }) : null
        ),
        h('span', { class: 'bk-proof__acts' },
          p.state === 'failed' && p.blob ? h('button', { class: 'btn bk-proof__btn', type: 'button', onclick: () => upload(p) }, 'جرّب تاني') : null,
          h('button', { class: 'btn bk-proof__btn', type: 'button', 'aria-label': `شيل صورة ${n}`, onclick: () => removeProof(p) }, 'شيل')
        )
      );
    }));
    const full = proofs.length >= PROOFS_MAX;
    if (addButton) {
      addButton.disabled = full;
      addButton.lastChild.textContent = proofs.length ? 'ضيف صورة تانية' : 'ضيف صورة';
    }
    if (sendButton) sendButton.disabled = sending;
    if (hadFocus && !proofList.contains(document.activeElement) && addButton) (addButton.disabled ? sendButton : addButton)?.focus();
  }

  function removeProof(p) {
    p.removed = true;
    if (p.url) URL.revokeObjectURL(p.url);
    proofs = proofs.filter(x => x !== p);
    syncProofs();
    saveNow();
    renderProofs();
    announce('اتشالت الصورة');
  }

  async function upload(p) {
    p.state = 'uploading';
    p.error = '';
    renderProofs();
    const reply = await api.proof(slug, p.blob);
    if (p.removed || destroyed) return;
    if (reply.ok && PROOF_ID.test(String(reply.proofId)) && typeof reply.claim === 'string' && reply.claim.length <= 400) {
      p.state = 'done';
      p.proofId = reply.proofId;
      p.claim = reply.claim;
      // the picture is on the server now; the bytes can go
      p.blob = null;
      syncProofs();
      saveNow();
      announce('اترفعت الصورة');
    }
    else {
      const problem = bookingError(reply);
      if (problem.action === 'fallback') {
        fallback();
        announce(problem.message);
        return;
      }
      p.state = 'failed';
      p.error = reply.code === 'proof' || reply.code === 'toolarge' ? UNSUPPORTED : problem.message;
    }
    renderProofs();
  }

  async function addFiles(files) {
    const room = PROOFS_MAX - proofs.length;
    for (const file of [...files].slice(0, Math.max(0, room))) {
      const p = { id: nextId(), state: 'preparing', proofId: '', claim: '', url: '', blob: null, error: '' };
      proofs.push(p);
      renderProofs();
      try {
        const prepared = await prepareImage(file);
        if (p.removed) continue;
        p.blob = prepared.blob;
        p.url = URL.createObjectURL(prepared.blob);
      }
      catch (error) {
        if (p.removed) continue;
        p.state = 'failed';
        p.error = (error && error.message) || UNSUPPORTED;
        renderProofs();
        continue;
      }
      upload(p);
    }
    if (files.length > room) announce('لحد ٣ صور بس.');
  }

  function stepSend() {

    const paid = !free;
    const proofRequired = paid && needsProof(booking, draft.method);
    let proofsBox = null;

    if (paid) {
      fileInput = h('input', { type: 'file', id: 'bk-proof-input', accept: 'image/*', multiple: true, hidden: true });
      fileInput.addEventListener('change', () => {
        const files = [...fileInput.files];
        fileInput.value = '';
        showErrors({}, { focus: false, only: ['proofs'] });
        addFiles(files);
      });
      addButton = h('button', { class: 'btn bk-add', type: 'button', 'aria-describedby': 'bk-proofs-hint' }, icon('plus'), h('span', {}, 'ضيف صورة'));
      addButton.addEventListener('click', () => fileInput.click());
      proofList = h('ul', { class: 'bk-proofs', 'aria-label': 'صور الدفع' });
      proofsBox = group('proofs', proofRequired ? 'صورة التحويل' : 'صورة الدفع (اختياري)',
        h('p', { class: 'bk-field__hint', id: 'bk-proofs-hint' }, proofRequired ? 'ارفع سكرين شوت للتحويل (من ١ لـ ٣ صور).' : 'لو معاك صورة للدفع ارفعها (لحد ٣ صور).'),
        proofList,
        addButton,
        fileInput
      );
    }
    else {
      proofList = null;
      addButton = null;
    }

    const note = h('textarea', { class: 'bk-input bk-textarea', id: 'bk-note', name: 'note', rows: 3, maxlength: NOTE_MAX }, draft.note);
    note.addEventListener('input', () => { draft.note = note.value; saveSoon(); });

    let terms = null;
    if (event.terms) {
      const box = h('input', { type: 'checkbox', id: 'bk-agree', name: 'agree', checked: draft.agreed });
      box.addEventListener('change', () => { draft.agreed = box.checked; showErrors({}, { focus: false, only: ['agreed'] }); saveSoon(); });
      terms = h('div', { class: 'bk-field bk-agree', 'data-field': 'agreed' },
        h('label', { class: 'bk-check', for: 'bk-agree' }, box, h('span', {}, 'قريت الشروط وموافق')),
        h('a', { class: 'bk-link', href: '#terms-title' }, 'اقرا الشروط'),
        h('p', { class: 'bk-field__err', id: 'bk-agree-err', hidden: true })
      );
      box.setAttribute('aria-describedby', 'bk-agree-err');
    }

    const servant = booking.servants.find(s => s.id === draft.servantId);
    const method = booking.methods.find(m => m.key === draft.method);
    const summary = h('dl', { class: 'bk-sum' },
      h('div', {}, h('dt', {}, 'الاسم'), h('dd', {}, draft.fields.name)),
      h('div', {}, h('dt', {}, 'الأفراد'), h('dd', {}, peopleText(peopleOf(booking, draft.counts)))),
      h('div', {}, h('dt', {}, 'الإجمالي'), h('dd', {}, money(totalOf(booking, draft.counts)))),
      paid && servant ? h('div', {}, h('dt', {}, 'الخادم'), h('dd', {}, servant.name)) : null,
      paid && method ? h('div', {}, h('dt', {}, 'طريقة الدفع'), h('dd', {}, method.label)) : null
    );

    // Turnstile (the Worker asks for it): a token before the send
    let checkBox = null;
    if (live && live.turnstile) {
      const widget = h('div', { class: 'bk-turnstile', id: 'bk-turnstile' });
      checkBox = group('turnstile', 'تأكيد سريع إنك مش روبوت', widget);
      captcha = mountTurnstile(widget, live.turnstile, {
        onChange: token => { if (token) showErrors({}, { focus: false, only: ['turnstile'] }); },
        onError: () => showErrors({ turnstile: 'علامة التأكيد ما اشتغلتش. حدّث الصفحة أو جرّب نت تاني.' }, { focus: false, only: ['turnstile'] })
      });
    }

    sendButton = h('button', { class: 'btn btn--primary bk-send', type: 'submit' }, 'ابعت طلب الحجز');
    const form = h('form', { class: 'bk-form', novalidate: true },
      summary,
      proofsBox,
      field('note', 'ملاحظة للخادم (اختياري)', note),
      terms,
      checkBox,
      h('p', { class: 'bk-note bk-note--strong' }, paid ? 'مكانك بيتأكد بعد مراجعة الدفع.' : 'مكانك بيتأكد بعد مراجعة الطلب.'),
      actions(backButton('رجوع', () => go(steps[steps.indexOf('c') - 1])), sendButton)
    );

    form.addEventListener('submit', submitEvent => {
      submitEvent.preventDefault();
      send();
    });

    renderProofs();
    return form;

  }

  async function send() {

    if (sending) return;
    syncProofs();
    const uploading = proofs.filter(p => p.state === 'preparing' || p.state === 'uploading').length;
    const problems = checkSend(booking, { method: draft.method, proofs: draft.proofs, agreed: draft.agreed, uploading, captcha: captcha ? { required: true, token: captcha.token() } : null }, event.terms);
    if (proofs.some(p => p.state === 'failed') && !problems.proofs) problems.proofs = 'شيل الصورة اللي ماترفعتش أو جرّبها تاني.';
    if (!showErrors(problems)) return;

    sending = true;
    sendButton.disabled = true;
    sendButton.setAttribute('aria-busy', 'true');
    sendButton.textContent = 'بنبعت…';
    showAlert('');
    saveNow();

    const hp = document.getElementById('bk-hp');
    const reply = await api.submit(submitBody(event, draft, { hp: hp ? hp.value : '', revision: live && live.revision, turnstile: captcha ? captcha.token() : '' }));
    sending = false;
    if (destroyed) return;

    if (reply.ok && isRef(reply.ref) && isToken(reply.token)) {
      finish(reply);
      return;
    }
    // a Turnstile token is good for one try: a fresh one for the next
    if (captcha) captcha.reset();

    sendButton.disabled = false;
    sendButton.removeAttribute('aria-busy');
    sendButton.textContent = 'ابعت طلب الحجز';

    const problem = reply.ok ? bookingError({ code: 'bad' }) : bookingError(reply);
    if (problem.action === 'fallback') {
      saveNow();
      fallback();
      announce(problem.message);
      return;
    }
    if (problem.action === 'refresh') {
      saveNow();
      await refresh({ force: true });
      if (live && live.live === 'open' && mode === 'flow') showAlert(problem.message);
      else {
        stateEl.textContent = problem.message;
        stateEl.hidden = false;
      }
      announce(problem.message);
      return;
    }
    if (problem.action === 'field') {
      if (problem.field === 'counts' && problem.left !== null && live) {
        live = { ...live, left: problem.left };
      }
      if (problem.step && problem.step !== draft.step) {
        draft.step = problem.step;
        saveNow();
        renderStep({ focus: false });
      }
      showAlert(problem.message);
      showErrors({ [problem.field]: problem.message });
      return;
    }
    showAlert(problem.message);
    alertEl.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });

  }


  /* ---------- done ---------- */

  function finish(reply) {

    done = reply;
    mode = 'done';
    dropCaptcha();
    clearTimeout(saveTimer);
    clearDraft(slug);
    for (const p of proofs) if (p.url) URL.revokeObjectURL(p.url);
    proofs = [];
    draft = null;
    rememberBooking({ slug, ref: reply.ref, token: reply.token });

    const link = statusHref(rootUrl, slug, reply.token);
    const linkInput = h('input', { class: 'bk-input bk-input--ltr bk-done__url', id: 'bk-link', type: 'text', readonly: true, dir: 'ltr', value: link });
    const copy = h('button', { class: 'btn bk-copy', type: 'button' }, 'انسخ الرابط');
    copy.addEventListener('click', async () => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(link);
        ok = true;
      }
      catch {
        try {
          linkInput.select();
          ok = document.execCommand('copy');
        }
        catch {
          ok = false;
        }
      }
      copy.textContent = ok ? 'اتنسخ' : 'انسخه بإيدك';
      announce(ok ? 'اتنسخ الرابط' : 'علّم على الرابط وانسخه');
      if (ok) cue('success');
      setTimeout(() => { copy.textContent = 'انسخ الرابط'; }, 2500);
    });

    const heading = h('h3', { class: 'bk-flow__title', id: 'bk-step-title', tabindex: '-1' }, 'طلبك وصل');
    flowEl.replaceChildren(h('div', { class: 'bk-flow bk-done', 'data-step': 'done' },
      heading,
      h('p', { class: 'bk-done__ref' }, h('span', {}, 'رقم الحجز'), h('bdi', { dir: 'ltr', class: 'bk-done__code' }, reply.ref)),
      h('p', { class: 'bk-done__status' }, statusWord('pending')),
      reply.priceChanged && Number.isInteger(reply.quotedTotal)
        ? h('p', { class: 'bk-alert', 'data-tone': 'info' }, `السعر اتغير من شوية. الإجمالي دلوقتي ${money(reply.quotedTotal)}.`)
        : null,
      h('p', { class: 'bk-note bk-note--strong' }, 'هتوصلك رسالة من الخادم بعد التأكيد.'),
      h('div', { class: 'bk-field' },
        h('label', { class: 'bk-field__label', for: 'bk-link' }, 'رابط متابعة الحجز'),
        h('div', { class: 'bk-done__copy' }, linkInput, copy),
        h('p', { class: 'bk-field__hint' }, 'احتفظ بالرابط ده: منه تتابع حجزك أو تلغيه.')
      ),
      h('a', { class: 'btn btn--primary bk-done__status-link', href: `#b/${reply.token}` }, 'شوف حالة الحجز')
    ));
    heading.focus({ preventScroll: true });
    flowEl.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    announce(`طلبك وصل. رقم الحجز ${reply.ref}`);
    cue('success');
    refreshMine();

  }


  /* ---------- start ---------- */

  refresh({ force: true });

  return {
    refresh,
    refreshMine,
    destroy() {
      destroyed = true;
      saveNow();
      dropCaptcha();
      removeEventListener('pagehide', saveNow);
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };

}
