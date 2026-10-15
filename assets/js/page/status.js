/**
 * ONLINE BOOKING — the status view (docs/EVENTS.md §7.1; worker/BOOKING-API.md)
 *
 * /events/<slug>/#b/<token>: the token lives only in the address
 * fragment (never sent to a server as part of an address, never in a
 * referrer: the API calls carry no referrer). The view sits right under
 * the event's hero: the status, the people, the money when confirmed
 * (due / paid / remaining), the reason when rejected or cancelled, and
 * «إلغاء الطلب» while pending (asked twice) → POST /v1/book/withdraw.
 * Only for an event whose booking is online (main.js decides).
 */

import { h } from '../dom.js';
import { cue } from '../ui-sound.js';
import { tokenFromHash, statusView, bookingError, newRequestKey } from './book-model.js';
import { rememberBooking } from './book-store.js';
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

  function render(view, { notice = '' } = {}) {

    const rows = view.rows.map(([label, value]) => h('div', {}, h('dt', {}, label), h('dd', {}, value)));
    const actionsEl = h('div', { class: 'bk-actions' });

    function idle() {
      const cancel = view.canWithdraw ? h('button', { class: 'btn bstat__cancel', type: 'button' }, 'إلغاء الطلب') : null;
      if (cancel) cancel.addEventListener('click', ask);
      actionsEl.replaceChildren(...[cancel, back()].filter(Boolean));
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
