/**
 * «نقاطي» — the participant portal and rewards store (points/index.html)
 *
 * One stable page, no per-participant URLs. The participant logs in with
 * their code (compCode → «الكود مسجل باسم …» → confirm); the participant
 * token (ptoken, 3 h) lives in this tab's sessionStorage only and «خروج»
 * forgets it. portalMe draws the dashboard: name, balance and ledger
 * (wallet on), competition history (+ «شوف إجاباتك» → portalReview), the
 * store and the requests (shop on). shopRedeem carries a requestKey made
 * once per confirmed request and reused on every retry of it.
 * Contract: docs/COMPETITIONS.md §5.1, §7.4, §8, §9.
 */

import { h } from '../dom.js';
import { COMP_CONFIG } from './config.js';
import { createApi } from './api.js';
import { createView } from './view.js';
import { normalizeCode, formatCode, sanitizeResult, resultSummary, countPoints } from './flow.js';
import {
  sanitizeMe, formatAmount, dateText, historyLines, groupShop, itemAvailability, redeemPreview,
  sanitizeRedeem, redeemError, KEEP_KEY, KIND_LABELS, REDEMPTION_LABELS, HISTORY_LABELS,
  readToken, writeToken, clearToken
} from './portal-model.js';

const ROOT = new URL('../../../', import.meta.url);
const main = document.getElementById('comp-main');
const live = document.getElementById('comp-live');

const view = createView({ main, live, timer: null, net: null, rootUrl: ROOT, mediaUrl: src => new URL(src, ROOT).href });
const { icon, picture, btn, heading, errorBox, reviewList, codeForm, confirmBox, homeHref } = view.parts;

const api = createApi({ url: COMP_CONFIG.apiUrl });

const session = () => {
  try {
    return globalThis.sessionStorage || null;
  }
  catch {
    return null;
  }
};

function uuid() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
}

const S = {
  screen: 'loading',
  error: '',
  busy: false,
  codeValue: '',
  participant: null,
  ptoken: '',
  me: null,
  review: null,
  reviewTitle: '',
  notice: '',
  ordering: null,       // the item in the confirm sheet
  orderError: '',
  pendingKeys: new Map() // itemId → requestKey of a request that may have landed
};

let lastScreen = '';

function announce(message) {
  view.announce(message);
}

function render({ focus = true } = {}) {
  const changed = S.screen !== lastScreen;
  main.dataset.state = S.screen;
  const scroll = window.scrollY;
  main.replaceChildren(screens[S.screen]());
  // the store's confirm sheet is a real modal dialog (focus kept inside, Esc closes)
  const sheet = main.querySelector('dialog.order');
  if (sheet && !sheet.open && typeof sheet.showModal === 'function') {
    sheet.showModal();
    const alert = sheet.querySelector('.alert');
    if (alert) alert.focus();
  }
  if (changed && focus) {
    const target = main.querySelector('[data-focus]');
    window.scrollTo(0, 0);
    if (target) target.focus({ preventScroll: true });
  }
  else if (!changed) window.scrollTo(0, scroll);
  lastScreen = S.screen;
}


/* =========================================================
   LOGIN
========================================================= */

const loginModel = () => ({
  state: { name: S.screen, error: S.error, participant: S.participant },
  codeValue: S.codeValue,
  busy: S.busy,
  hideCodeBack: true,
  actions: {
    codeSubmit,
    back: () => { S.participant = null; S.ptoken = ''; S.error = ''; S.screen = 'code'; render(); },
    confirm: () => {
      writeToken(session(), S.ptoken);
      S.participant = null;
      loadMe();
    }
  }
});

async function codeSubmit(raw) {
  S.codeValue = String(raw || '').slice(0, 20);
  const code = normalizeCode(raw);
  if (!code) {
    S.error = 'الكود ٨ حروف وأرقام، زي ATH-K7P2-9QXM.';
    render();
    return;
  }
  S.busy = true;
  S.error = '';
  render();
  const reply = await api.call('compCode', { code: formatCode(code) });
  S.busy = false;
  if (reply.ok && reply.participant && typeof reply.ptoken === 'string') {
    S.ptoken = reply.ptoken;
    S.codeValue = '';
    S.participant = { name: String(reply.participant.name || '').slice(0, 80), group: String(reply.participant.group || '').slice(0, 60) };
    S.screen = 'confirm';
    render();
    return;
  }
  if (reply.code === 'disabled' || reply.code === 'not_found') {
    S.screen = 'unavailable';
    render();
    return;
  }
  S.error = reply.code === 'busy' ? 'محاولات كتير، استنى شوية وجرّب تاني.'
    : reply.code === 'network' ? 'النت فاصل أو ضعيف، جرّب تاني.'
      : reply.code === 'code' ? (reply.message || 'الكود ده مش صح، راجع الحروف والأرقام.') : (reply.message || 'حصلت مشكلة، جرّب تاني.');
  render();
}

function logout(message = '') {
  clearToken(session());
  Object.assign(S, { ptoken: '', me: null, review: null, participant: null, error: message, screen: 'code', ordering: null });
  S.pendingKeys.clear();
  render();
}

/** a reply that says the login is over (or the page is off) */
function handled(reply) {
  if (reply.code === 'session') {
    logout('الدخول خلص، ادخل الكود بتاعك تاني.');
    return true;
  }
  if (reply.code === 'disabled') {
    clearToken(session());
    S.screen = 'unavailable';
    render();
    return true;
  }
  return false;
}


/* =========================================================
   DASHBOARD
========================================================= */

async function loadMe({ quiet = false } = {}) {
  const ptoken = readToken(session()) || S.ptoken;
  if (!ptoken) {
    S.screen = 'code';
    render();
    return;
  }
  S.ptoken = ptoken;
  if (!quiet) {
    S.screen = 'loading';
    render({ focus: false });
  }
  const reply = await api.call('portalMe', { ptoken });
  if (!reply.ok) {
    if (handled(reply)) return;
    if (quiet) return;
    S.screen = 'failed';
    S.error = reply.code === 'network' ? 'مش قادرين نوصل دلوقتي، اتأكد من النت وجرّب تاني.' : (reply.message || 'حصلت مشكلة، جرّب تاني.');
    render();
    return;
  }
  const me = sanitizeMe(reply);
  if (!me) {
    S.screen = 'failed';
    S.error = 'حصلت مشكلة، جرّب تاني.';
    render();
    return;
  }
  S.me = me;
  if (!quiet || S.screen === 'dashboard') {
    S.screen = 'dashboard';
    render({ focus: !quiet });
  }
}

async function openReview(item) {
  S.screen = 'loading';
  render({ focus: false });
  const reply = await api.call('portalReview', { ptoken: S.ptoken, submissionId: item.submissionId });
  if (!reply.ok) {
    if (handled(reply)) return;
    S.screen = 'dashboard';
    S.notice = reply.code === 'network' ? 'النت فاصل، جرّب تاني.' : (reply.message || 'الإجابات مش متاحة دلوقتي.');
    render();
    return;
  }
  S.review = sanitizeResult(reply.result) || { status: 'submitted' };
  S.reviewTitle = item.title;
  S.screen = 'review';
  render();
}


/* =========================================================
   STORE
========================================================= */

function openOrder(item) {
  S.ordering = item;
  S.orderError = '';
  S.notice = '';
  render({ focus: false });
}

function closeOrder() {
  const item = S.ordering;
  S.ordering = null;
  S.orderError = '';
  render({ focus: false });
  const back = item && main.querySelector(`[data-item="${item.id}"] [data-order]`);
  if (back) back.focus();
}

async function confirmOrder() {
  const item = S.ordering;
  if (!item || S.busy) return;
  // one key per confirmed request; a request that may have landed keeps its key
  const requestKey = S.pendingKeys.get(item.id) || uuid();
  S.pendingKeys.set(item.id, requestKey);
  S.busy = true;
  S.orderError = '';
  render({ focus: false });
  const reply = await api.call('shopRedeem', { ptoken: S.ptoken, itemId: item.id, requestKey });
  S.busy = false;
  if (!reply.ok && KEEP_KEY.has(reply.code)) {
    S.orderError = redeemError(reply);
    render({ focus: false });
    return;
  }
  S.pendingKeys.delete(item.id);
  if (!reply.ok) {
    if (reply.code === 'session') {
      handled(reply);
      return;
    }
    S.orderError = redeemError(reply);
    render({ focus: false });
    return;
  }
  const done = sanitizeRedeem(reply);
  if (done && S.me) {
    if (done.balance !== null) S.me = { ...S.me, balance: done.balance };
    S.me = { ...S.me, redemptions: [{ ...done.redemption, requestedAt: '' }, ...S.me.redemptions] };
  }
  S.ordering = null;
  S.notice = `تم طلب «${(done && done.redemption.itemName) || item.name}» ✓ هتستلمها من الخدام لما تبقى جاهزة.`;
  render({ focus: false });
  const notice = main.querySelector('.portal__notice');
  if (notice) notice.focus();
  announce(S.notice);
  // the truth (stock, ledger, limits) from the server, quietly
  loadMe({ quiet: true });
}


/* =========================================================
   SCREENS
========================================================= */

const intro = () => h('header', { class: 'portal__intro' },
  h('p', { class: 'hero__kicker' }, 'نقاطي'),
  h('p', { class: 'muted' }, 'ادخل بالكود بتاعك وشوف مسابقاتك ونتايجك ونقاطك والجوايز.')
);

const section = (id, title, ...children) => h('section', { class: 'card portal__section', 'aria-labelledby': id },
  h('h2', { class: 'portal__h2', id }, title), ...children);

function historySection(me) {
  if (!me.history.length) return section('p-history', 'مسابقاتي', h('p', { class: 'muted' }, 'لسه مشاركتش في مسابقات بالكود ده.'));
  return section('p-history', 'مسابقاتي', h('ul', { class: 'plist' }, me.history.map(item => h('li', { class: 'prow', 'data-history': item.submissionId || item.compId },
    h('div', { class: 'prow__main' },
      h('p', { class: 'prow__title' }, item.title),
      h('p', { class: 'prow__meta' }, [dateText(item.submittedAt), HISTORY_LABELS[item.status]].filter(Boolean).join(' · ')),
      historyLines(item).map(line => h('p', { class: `prow__line${line === 'مستني مراجعة' ? ' is-pending' : ''}` }, line))
    ),
    item.canReview ? btn('شوف إجاباتك', () => openReview(item), { kind: 'small', 'data-review-btn': '' }) : null
  ))));
}

function ledgerSection(me) {
  return section('p-ledger', 'حركة النقاط', me.ledger.length
    ? h('ul', { class: 'plist' }, me.ledger.map(l => h('li', { class: 'prow prow--ledger', 'data-kind': l.kind },
      h('div', { class: 'prow__main' },
        h('p', { class: 'prow__title' }, KIND_LABELS[l.kind], l.compTitle ? ` — ${l.compTitle}` : ''),
        l.note ? h('p', { class: 'prow__meta' }, l.note) : null,
        l.createdAt ? h('p', { class: 'prow__meta' }, dateText(l.createdAt)) : null
      ),
      h('p', { class: `prow__amount ${l.amount < 0 ? 'is-minus' : 'is-plus'}`, dir: 'ltr' }, formatAmount(l.amount))
    )))
    : h('p', { class: 'muted' }, 'لسه مفيش حركة.'));
}

function redemptionsSection(me) {
  if (!me.features.shop && !me.redemptions.length) return null;
  return section('p-orders', 'طلباتي', me.redemptions.length
    ? h('ul', { class: 'plist' }, me.redemptions.map(r => h('li', { class: 'prow', 'data-redemption': r.id },
      h('div', { class: 'prow__main' },
        h('p', { class: 'prow__title' }, r.itemName),
        h('p', { class: 'prow__meta' }, [countPoints(r.cost), dateText(r.requestedAt)].filter(Boolean).join(' · '))
      ),
      h('p', { class: `pstatus pstatus--${r.status}` }, REDEMPTION_LABELS[r.status])
    )))
    : h('p', { class: 'muted' }, 'لسه مطلبتش جوايز.'));
}

function shopSection(me) {
  if (!me.features.shop) return null;
  if (!me.shop.length) return section('p-shop', 'الجوايز', h('p', { class: 'muted' }, 'مفيش جوايز دلوقتي، استنى الجديد.'));
  const groups = groupShop(me.shop);
  return section('p-shop', 'الجوايز', groups.map(group => h('div', { class: 'shop__group' },
    group.category && groups.length > 1 ? h('h3', { class: 'shop__cat' }, group.category) : null,
    h('ul', { class: 'shop' }, group.items.map(item => {
      const state = itemAvailability(item, me.balance);
      return h('li', { class: `shop__item${state.canOrder ? '' : ' is-off'}`, 'data-item': item.id },
        item.image ? h('figure', { class: 'shop__media' }, picture(item.image, { sizes: '(min-width: 760px) 320px, 92vw' })) : h('div', { class: 'shop__media shop__media--art', 'aria-hidden': 'true' }, icon('trophy', 'shop__icon')),
        h('div', { class: 'shop__body' },
          h('h3', { class: 'shop__name' }, item.name),
          item.description ? h('p', { class: 'shop__desc' }, item.description) : null,
          h('p', { class: 'shop__cost' }, countPoints(item.cost)),
          state.notes.length ? h('p', { class: 'shop__note' }, state.notes.join(' · ')) : null,
          state.canOrder
            ? btn('اطلب', () => openOrder(item), { kind: 'primary', 'data-order': '', 'aria-label': `اطلب ${item.name}` })
            : h('p', { class: 'shop__off', 'data-off': state.reason }, state.label)
        )
      );
    }))
  )));
}

function orderDialog(me) {
  const item = S.ordering;
  if (!item) return null;
  const preview = redeemPreview(item, me.balance);
  const dialog = h('dialog', { class: 'order card', 'aria-labelledby': 'order-t', 'aria-describedby': 'order-d', oncancel: event => { event.preventDefault(); if (!S.busy) closeOrder(); } },
    h('h2', { class: 'order__title', id: 'order-t' }, `تطلب «${item.name}»؟`),
    h('p', { class: 'order__text', id: 'order-d' }, preview.text),
    S.orderError ? errorBox(S.orderError) : null,
    h('div', { class: 'actions' },
      btn(S.busy ? 'بنطلب…' : (S.orderError && S.pendingKeys.has(item.id) ? 'جرّب تاني' : 'أيوه، اطلب'), confirmOrder, { kind: 'primary', 'data-confirm-order': '', disabled: S.busy || !preview.enough || null }),
      btn('لا', closeOrder, { disabled: S.busy || null })
    )
  );
  return dialog;
}

const screens = {

  loading: () => h('div', { class: 'step step--center', 'aria-busy': 'true' }, h('p', { class: 'muted' }, 'جاري التحميل…')),

  unavailable: () => h('section', { class: 'step step--center card' },
    icon('lock', 'step__icon'),
    heading('الصفحة دي مش متاحة دلوقتي'),
    h('p', { class: 'muted' }, 'تابع الموقع علشان تعرف الجديد.'),
    h('a', { class: 'btn btn--primary', href: homeHref }, icon('home'), 'ارجع للموقع')
  ),

  failed: () => h('section', { class: 'step step--center card' },
    heading(S.error || 'حصلت مشكلة'),
    btn('جرّب تاني', () => loadMe(), { kind: 'primary' }),
    btn('خروج', () => logout())
  ),

  code: () => h('div', { class: 'step' }, intro(), codeForm({ ...loginModel(), state: { name: 'code', error: S.error } })),

  confirm: () => h('div', { class: 'step' }, intro(), confirmBox(loginModel())),

  dashboard: () => {
    const me = S.me;
    return h('div', { class: 'step portal' },
      h('section', { class: 'card portal__me', 'aria-labelledby': 'p-me' },
        h('div', { class: 'portal__who' },
          h('p', { class: 'hero__kicker' }, 'نقاطي'),
          h('h1', { class: 'portal__name', id: 'p-me', tabindex: '-1', 'data-focus': '' }, `أهلًا يا ${me.participant.name}`),
          me.participant.group ? h('p', { class: 'muted' }, me.participant.group) : null
        ),
        me.features.wallet && me.balance !== null
          ? h('p', { class: 'portal__balance', 'data-balance': String(me.balance) }, h('span', { class: 'portal__balance-label' }, 'رصيدك'), h('strong', {}, countPoints(me.balance)))
          : null,
        btn('خروج', () => logout(), { kind: 'small', 'data-logout': '' })
      ),
      S.notice ? h('p', { class: 'portal__notice', role: 'status', tabindex: '-1' }, S.notice) : null,
      shopSection(me),
      redemptionsSection(me),
      historySection(me),
      me.features.wallet ? ledgerSection(me) : null,
      orderDialog(me)
    );
  },

  review: () => {
    const summary = resultSummary(S.review, {});
    return h('div', { class: 'step result' },
      h('section', { class: 'card', 'aria-labelledby': 'rv-t' },
        h('p', { class: 'hero__kicker' }, 'إجاباتك'),
        h('h1', { class: 'step__title', id: 'rv-t', tabindex: '-1', 'data-focus': '' }, S.reviewTitle),
        summary.lines.length ? h('ul', { class: 'result__lines result__lines--start' }, summary.lines.map(l => h('li', { class: `result__line result__line--${l.kind}` }, l.text))) : null,
        summary.review ? null : h('p', { class: 'muted' }, 'الإجابات الصحيحة لسه مش متاحة.'),
        h('div', { class: 'actions' }, btn('رجوع لنقاطي', () => { S.screen = 'dashboard'; S.review = null; render(); }, { iconName: 'prev', 'data-back': '' }))
      ),
      summary.review ? reviewList(summary.review) : null
    );
  }

};


/* =========================================================
   START
========================================================= */

if (window.top !== window.self) {
  try {
    window.top.location.replace(location.href);
  }
  catch {
    // sandboxed frame
  }
}

if (readToken(session())) loadMe();
else {
  S.screen = 'code';
  render({ focus: false });
}

