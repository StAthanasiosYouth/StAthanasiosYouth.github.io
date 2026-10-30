/**
 * ONLINE BOOKING — the status view (docs/EVENTS.md §7.1; worker/BOOKING-API.md)
 *
 * /events/<slug>/#b/<token>: the token lives only in the address
 * fragment (never sent to a server as part of an address, never in a
 * referrer: the API calls carry no referrer). The view sits right under
 * the event's hero: the status, the people, the money when confirmed
 * (due / paid / remaining), the reason when rejected or cancelled, and
 * «إلغاء الطلب» while pending (asked twice) → POST /v1/book/withdraw.
 * Confirmed with money still owed: «ادفع الباقي» (§4.10) — servant + method, the
 * payment card (POST /v1/book/pay with the token), the amount sent and 1–3
 * screenshots → POST /v1/book/pay-request: a REQUEST the servant reviews, never a
 * payment; the view then shows it (pending / accepted / rejected + why).
 * Only for an event whose booking is online (main.js decides).
 */

import { h } from '../dom.js';
import { cue } from '../ui-sound.js';
import { tokenFromHash, statusView, bookingError, newRequestKey, PROOFS_MAX } from './book-model.js';
import { money } from './model.js';
import { arabicDigits } from '../words.js';
import { prepareImage, UNSUPPORTED } from './image.js';
import { mountTurnstile } from './turnstile.js';
import { rememberBooking, accountSession } from './book-store.js';
import { createBookApi } from './book-api.js';
import { bookApiUrl } from './book-config.js';

function randomKey() {
  const bytes = new Uint8Array(22);
  if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return newRequestKey(bytes);
}

/**
 * Shows the view for the token in location.hash (or closes it when there
 * is none). Returns { close() }.
 */
export function showStatus({ event, announce = () => {}, reduced = false, onChange = () => {} }) {

  const token = tokenFromHash(location.hash);
  const old = document.getElementById('bstat');
  if (old) old.remove();
  if (!token) return { close() {} };

  const api = createBookApi({ base: bookApiUrl() });
  let withdrawKey = '';
  let closed = false;

  const section = h('section', { class: 'pg-section bstat', id: 'bstat', 'aria-labelledby': 'bstat-title', 'aria-busy': 'true' });
  const hero = document.querySelector('.evt > .phero');
  if (hero) hero.after(section);
  else document.getElementById('page-main')?.prepend(section);

  function close() {
    closed = true;
    section.remove();
  }

  function leave() {
    // the address without the token (the page stays where it is)
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    close();
    const title = document.getElementById('book-title') || document.getElementById('page-title');
    if (title) title.focus({ preventScroll: false });
  }

  const back = () => h('button', { class: 'btn bstat__back', type: 'button', onclick: leave }, 'ارجع لصفحة الفعالية');

  function draw(...children) {
    // (replaceChildren would write a null as the word «null»)
    section.replaceChildren(...children.filter(Boolean));
    section.setAttribute('aria-busy', 'false');
  }

  function heading(text, ref = '') {
    return h('h2', { class: 'bstat__title', id: 'bstat-title', tabindex: '-1' }, text, ref ? ' ' : null, ref ? h('bdi', { dir: 'ltr' }, ref) : null);
  }

  function focusTitle() {
    const title = document.getElementById('bstat-title');
    if (!title) return;
    title.focus({ preventScroll: true });
    section.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }

  function failed(message, retry) {
    draw(
      heading('حالة الحجز'),
      h('p', { class: 'bk-alert', role: 'alert' }, message),
      h('div', { class: 'bk-actions' },
        retry ? h('button', { class: 'btn btn--primary', type: 'button', onclick: retry }, 'جرّب تاني') : null,
        back()
      )
    );
  }

  /* the participant's payment request: pending (with «اسحب الطلب»), accepted, or rejected + why */
  function requestBlock(view) {
    const r = view.request;
    if (!r) return null;
    if (r.status === 'pending') {
      const take = h('button', { class: 'btn bstat__cancel', type: 'button', 'data-act': 'pay-withdraw' }, 'اسحب الطلب');
      take.addEventListener('click', async () => {
        take.disabled = true;
        const reply = await api.payRequestWithdraw(token);
        if (closed) return;
        load({ notice: reply.ok ? 'سحبت طلب الدفع.' : bookingError(reply).message, focus: true });
      });
      return h('div', { class: 'bstat__req', 'data-req': 'pending' },
        h('p', { class: 'bk-alert', 'data-tone': 'info', role: 'status' }, `طلب دفع ${money(r.amount)} قيد المراجعة — صورة التحويل مش تأكيد للدفع: الخادم هيراجعها ويأكّد.`),
        h('div', { class: 'bk-actions' }, take));
    }
    if (r.status === 'rejected') return h('p', { class: 'bk-alert bstat__req', 'data-req': 'rejected' }, `طلب الدفع (${money(r.amount)}) اترفض`, r.reason ? `: ${r.reason}` : '', '. تقدر تبعت طلب تاني.');
    return h('p', { class: 'bk-note bstat__req', 'data-req': 'accepted' }, `اتسجلت دفعتك (${money(r.amount)}) ✓`);
  }

  /* «ادفع الباقي»: a button that opens the form in place */
  function payEntry(view) {
    const box = h('div', { class: 'bstat__pay' });
    const open = h('button', { class: 'btn btn--primary', type: 'button', 'data-act': 'pay-open' }, `ادفع الباقي (${money(view.balance)})`);
    open.addEventListener('click', () => { box.replaceChildren(payForm(view)); box.querySelector('select, input')?.focus(); });
    box.append(h('p', { class: 'bk-note' }, `المتبقي عليك ${money(view.balance)}.`), open);
    return box;
  }

  /* the form: servant + method → the card (number, amount) → the amount sent + screenshots → the request */
  function payForm(view) {
    const booking = event.booking || {};
    const online = (booking.methods || []).filter(m => m.online);
    const servants = (booking.servants || []).filter(s => s.methods.some(k => online.some(m => m.key === k)));
    const requestKey = randomKey();
    const proofs = [];
    let captcha = null;
    let siteKey = '';
    const err = h('p', { class: 'bk-alert', role: 'alert', hidden: true });
    const say = message => { err.textContent = message; err.hidden = !message; };

    const servant = h('select', { class: 'bk-input', id: 'bpay-servant' }, h('option', { value: '' }, 'اختار الخادم'), ...servants.map(s => h('option', { value: s.id }, s.name)));
    const method = h('select', { class: 'bk-input', id: 'bpay-method', disabled: true }, h('option', { value: '' }, 'طريقة الدفع'));
    const card = h('div', { class: 'bstat__card', 'aria-live': 'polite' });
    const amountIn = h('input', { class: 'bk-input bk-input--ltr', id: 'bpay-amount', type: 'number', inputmode: 'numeric', min: 1, max: view.balance, dir: 'ltr', value: String(view.balance) });
    // the browser's own file box stays hidden; the booking form's «ضيف صورة» button opens it
    const files = h('input', { id: 'bpay-files', type: 'file', accept: 'image/*', multiple: true, hidden: true });
    const addFile = h('button', { class: 'btn bk-add', type: 'button', id: 'bpay-add' }, h('span', {}, '+ ضيف صورة التحويل'));
    addFile.addEventListener('click', () => files.click());
    const list = h('ul', { class: 'bstat__proofs' });
    const widget = h('div', { class: 'bk-turnstile' });
    const send = h('button', { class: 'btn btn--primary', type: 'submit', 'data-act': 'pay-send' }, 'ابعت صورة التحويل');

    servant.addEventListener('change', () => {
      const s = servants.find(x => x.id === servant.value);
      method.replaceChildren(h('option', { value: '' }, 'طريقة الدفع'), ...(s ? online.filter(m => s.methods.includes(m.key)).map(m => h('option', { value: m.key }, m.label)) : []));
      method.disabled = !s;
      card.replaceChildren();
    });
    method.addEventListener('change', async () => {
      card.replaceChildren();
      if (!servant.value || !method.value) return;
      card.append(h('p', { class: 'bk-note' }, 'بنجيب رقم الدفع…'));
      const reply = await api.pay(event.slug, servant.value, method.value, null, token);
      if (closed) return;
      if (!reply.ok) {
        card.replaceChildren(h('p', { class: 'bk-alert' }, reply.reason === 'unavailable' ? 'الطريقة دي مش متاحة مع الخادم ده دلوقتي. اختار غيرها أو كلّم الخادم.' : bookingError(reply).message));
        return;
      }
      const copy = h('button', { class: 'btn', type: 'button', 'data-act': 'pay-copy' }, 'نسخ الرقم');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(String(reply.number)); copy.textContent = 'اتنسخ ✓'; }
        catch { copy.textContent = 'انسخه بإيدك'; }
      });
      card.replaceChildren(
        h('p', {}, 'حوّل على الرقم ده: ', h('bdi', { dir: 'ltr', class: 'bstat__number' }, String(reply.number || '')), reply.name ? ` (باسم ${reply.name})` : ''),
        h('p', {}, `المتبقي: ${money(Number.isInteger(reply.amount) ? reply.amount : view.balance)}`),
        copy);
    });
    files.addEventListener('change', async () => {
      for (const file of [...files.files]) {
        if (proofs.length >= PROOFS_MAX) break;
        const p = { blob: null, proofId: '', claim: '' };
        try { p.blob = (await prepareImage(file)).blob; }
        catch { say(UNSUPPORTED); continue; }
        proofs.push(p);
      }
      files.value = '';
      drawProofs();
    });
    function drawProofs() {
      list.replaceChildren(...proofs.map((p, i) => {
        const remove = h('button', { class: 'btn bk-proof__btn', type: 'button' }, 'شيل');
        remove.addEventListener('click', () => { proofs.splice(i, 1); drawProofs(); });
        return h('li', {}, `صورة ${arabicDigits(i + 1)}`, ' ', remove);
      }));
      addFile.disabled = proofs.length >= PROOFS_MAX;
    }
    // Turnstile, when the booking state names a key
    api.state(event.slug).then(state => {
      if (closed || !state.ok || !state.turnstile) return;
      siteKey = state.turnstile;
      captcha = mountTurnstile(widget, siteKey, { onError: () => say('علامة التأكيد ما اشتغلتش. حدّث الصفحة أو جرّب نت تاني.') });
    });

    const form = h('form', { class: 'bk-form bstat__payform', novalidate: true },
      h('h3', { class: 'bstat__subtitle' }, 'ادفع الباقي'),
      h('div', { class: 'bk-field' }, h('label', { class: 'bk-field__label', for: servant.id }, 'الخادم'), servant),
      h('div', { class: 'bk-field' }, h('label', { class: 'bk-field__label', for: method.id }, 'هتدفع إزاي'), method),
      card,
      h('div', { class: 'bk-field' }, h('label', { class: 'bk-field__label', for: amountIn.id }, 'المبلغ اللي حوّلته'), amountIn,
        h('p', { class: 'bk-field__hint' }, `من ١ لحد ${money(view.balance)}.`)),
      h('div', { class: 'bk-field' }, h('p', { class: 'bk-field__label' }, `صورة التحويل (لحد ${arabicDigits(PROOFS_MAX)} صور)`), files, addFile, list),
      widget,
      h('p', { class: 'bk-note' }, 'صورة التحويل مش تأكيد للدفع: الخادم هيراجعها ويسجلها.'),
      err,
      h('div', { class: 'bk-actions' }, send));

    form.addEventListener('submit', async e => {
      e.preventDefault();
      say('');
      const amount = Number(amountIn.value);
      if (!servant.value || !method.value) return say('اختار الخادم وطريقة الدفع.');
      if (!Number.isInteger(amount) || amount < 1 || amount > view.balance) return say(`اكتب المبلغ اللي حوّلته (من ١ لحد ${money(view.balance)}).`);
      if (!proofs.length) return say('ارفع صورة التحويل.');
      if (siteKey && (!captcha || !captcha.token())) return say('كمّل علامة التأكيد الأول.');
      send.disabled = true;
      send.textContent = 'بنبعت…';
      for (const p of proofs) {
        if (p.proofId) continue;
        const up = await api.proof(event.slug, p.blob, token);
        if (closed) return;
        if (!up.ok) {
          send.disabled = false;
          send.textContent = 'ابعت صورة التحويل';
          return say(bookingError(up).message);
        }
        p.proofId = up.proofId;
        p.claim = up.claim;
      }
      const reply = await api.payRequest({ token, requestKey, servantId: servant.value, method: method.value, amount, proofs: proofs.map(p => ({ proofId: p.proofId, claim: p.claim })), turnstile: captcha ? captcha.token() : '' });
      if (closed) return;
      if (reply.ok) {
        announce('طلب الدفع وصل');
        cue('success');
        load({ notice: 'طلبك وصل وقيد المراجعة. هتلاقي حالته هنا.', focus: true });
        return;
      }
      send.disabled = false;
      send.textContent = 'ابعت صورة التحويل';
      if (captcha) captcha.reset();
      say(reply.code === 'conflict' ? 'عندك طلب دفع لسه بيتراجع.' : reply.field === 'amount' ? 'المبلغ أكبر من المتبقي. حدّث الصفحة.' : bookingError(reply).message);
    });
    return form;
  }


  /* signed in on this device: this booking can join the account (possession of this link; YOUTH-ACCOUNTS-PLAN §18.1) */
  function linkButton() {
    const session = accountSession();
    if (!session) return null;
    const button = h('button', { class: 'btn', type: 'button', 'data-link-account': '' }, 'اربطه بحسابي');
    button.addEventListener('click', async () => {
      button.disabled = true;
      let done = false;
      try {
        const res = await fetch(bookApiUrl() + '/v1/account/bookings/link', { method: 'POST', headers: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify({ token }) });
        done = !!(await res.json()).linked;
      }
      catch { done = false; }
      button.textContent = done ? 'اتربط بحسابك ✓' : 'مقدرناش نربطه';
    });
    return button;
  }

  function render(view, { notice = '' } = {}) {

    const rows = view.rows.map(([label, value]) => h('div', {}, h('dt', {}, label), h('dd', {}, value)));
    const actionsEl = h('div', { class: 'bk-actions' });

    function idle() {
      const cancel = view.canWithdraw ? h('button', { class: 'btn bstat__cancel', type: 'button' }, 'إلغاء الطلب') : null;
      if (cancel) cancel.addEventListener('click', ask);
      actionsEl.replaceChildren(...[cancel, linkButton(), back()].filter(Boolean));
    }

    function ask() {
      const yes = h('button', { class: 'btn bstat__yes', type: 'button' }, 'أيوه، الغي الطلب');
      const no = h('button', { class: 'btn btn--primary', type: 'button' }, 'لا، سيبه');
      const question = h('p', { class: 'bstat__ask', id: 'bstat-ask', tabindex: '-1' }, 'متأكد إنك عايز تلغي الطلب؟ مش هتقدر ترجّعه.');
      no.addEventListener('click', () => {
        idle();
        actionsEl.querySelector('.bstat__cancel')?.focus();
      });
      yes.addEventListener('click', () => withdraw(yes));
      actionsEl.replaceChildren(h('div', { class: 'bstat__confirm', role: 'group', 'aria-labelledby': 'bstat-ask' }, question, h('div', { class: 'bk-actions' }, no, yes)));
      question.focus();
    }

    async function withdraw(button) {
      button.disabled = true;
      button.textContent = 'بنلغي…';
      if (!withdrawKey) withdrawKey = randomKey();
      const reply = await api.withdraw(token, withdrawKey);
      if (closed) return;
      if (reply.ok) {
        announce('اتلغى الطلب');
        cue('success');
        onChange();
        load({ notice: 'اتلغى الطلب.', focus: true });
        return;
      }
      const problem = bookingError(reply);
      if (problem.action === 'refresh') {
        load({ notice: problem.message, focus: true });
        return;
      }
      button.disabled = false;
      button.textContent = 'أيوه، الغي الطلب';
      const alert = section.querySelector('.bstat__err');
      if (alert) {
        alert.textContent = problem.message;
        alert.hidden = false;
      }
    }

    idle();
    draw(
      h('div', { class: 'bstat__head' },
        heading('حجزك', view.ref),
        h('p', { class: 'bstat__chip', 'data-status': view.status }, view.word)
      ),
      notice ? h('p', { class: 'bk-alert', 'data-tone': 'info', role: 'status' }, notice) : null,
      view.firstName || view.title
        ? h('p', { class: 'bstat__hello' }, view.firstName ? `أهلاً ${view.firstName}` : '', view.firstName && view.title ? '، ' : '', view.title ? `ده حجزك في «${view.title}».` : '')
        : null,
      rows.length ? h('dl', { class: 'bk-sum bstat__rows' }, rows) : null,
      view.overdue ? h('p', { class: 'bk-alert' }, 'فيه باقي فات معاده. كلّم الخادم.') : null,
      view.reason ? h('p', { class: 'bstat__reason' }, h('span', {}, 'السبب: '), view.reason) : null,
      view.status === 'pending' ? h('p', { class: 'bk-note' }, 'طلبك مستني مراجعة الخادم. هتوصلك رسالة بعد التأكيد.') : null,
      view.status === 'confirmed' ? h('p', { class: 'bk-note' }, 'مكانك متأكد. نشوفك هناك!') : null,
      requestBlock(view),
      view.canPay ? payEntry(view) : null,
      h('p', { class: 'bk-alert bstat__err', role: 'alert', hidden: true }),
      actionsEl
    );

  }

  async function load({ notice = '', focus = false } = {}) {
    section.setAttribute('aria-busy', 'true');
    const reply = await api.status(token);
    if (closed) return;
    const view = reply.ok ? statusView(reply) : null;
    if (!view) {
      const problem = bookingError(reply.ok ? { code: 'bad' } : reply);
      failed(reply.code === 'expired' ? 'الرابط ده انتهى أو مش صحيح.' : problem.message, reply.code === 'expired' ? null : () => load({ focus: true }));
      if (focus) focusTitle();
      return;
    }
    // this device knows the booking from now on («حجزك …» on the event page)
    if (!reply.event || !reply.event.slug || reply.event.slug === event.slug) rememberBooking({ slug: event.slug, ref: view.ref, token });
    render(view, { notice });
    if (focus) focusTitle();
  }

  draw(heading('حالة الحجز'), h('p', { class: 'bk-note' }, 'بنجيب حالة الحجز…'));
  section.setAttribute('aria-busy', 'true');
  focusTitle();
  load({ focus: true });

  return { close };

}
