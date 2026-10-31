/**
 * YOUTH ACCOUNT: the signed-in pages. The first page answers «is anything needed from me?», then lists
 * every section with its state in words. Every route the emails link to stays (docs/EMAIL-DEEP-LINKS.md).
 * A computer keeps the sections in a rail beside the content. Answers are kept a minute, so going back
 * and forth costs nothing; whatever changes something forgets what it changed.
 */

import { h, external } from '../dom.js';
import { cue } from '../ui-sound.js';
import { arDigits, dateText, cleanRoute, attention, whenText, relativeText, msDateText, comingFirst } from './model.js';
import { ic, arch, fillArch, chip, row, rows, list, section, empty, note, head, skeleton, toast } from './parts.js';
import { transition, countUp, firstArrival } from './motion.js';

const KEEP_MS = 60000;

const BOOKING = { pending: ['قيد المراجعة', 'gold'], confirmed: ['مؤكد', 'ok'], rejected: ['مرفوض', 'alert'], cancelled: ['ملغي', ''], withdrawn: ['اتسحب', ''] };
const ORDER = { pending: ['مستني', 'gold'], approved: ['جاهزة للاستلام', 'ok'], fulfilled: ['اتسلمت', ''], cancelled: ['اتلغت', ''] };
const RESULT = { submitted: ['اتبعتت', ''], pending_review: ['مستني مراجعة', 'gold'], graded: ['اتصححت', 'ok'] };
const LEDGER = { earn: 'نقاط مسابقة', competition: 'نقاط مسابقة', correction: 'تصحيح نتيجة', manual: 'من الخدمة', transfer: 'نقل', spend: 'طلب من المتجر', refund: 'رجوع نقاط' };
const FAIL = 'حصلت مشكلة. جرّب تاني.';

const money = n => arDigits(Number(n) || 0) + ' جنيه';
const depth = route => (route === '#me' ? 0 : route.split('/').length - 1);
const safeSlug = slug => /^[a-z0-9-]{1,60}$/.test(String(slug || ''));
const greet = () => (Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Cairo' }).format(new Date())) < 12 ? 'صباح الخير' : 'مساء الخير');

export function createMine({ main, S, authed, api, sessionOver, signOut, openForgot, onPhoto }) {

  const memo = new Map();
  let route = '#me';
  let shown = false;
  let latest = 0;
  let toured = false;
  let tourTimer = 0;

  /* ---------- data ---------- */

  async function load(method, path, body) {
    const kept = memo.get(path);
    if (kept && Date.now() - kept.at < KEEP_MS) return kept.reply;
    const reply = await authed(method, path, body);
    if (reply.ok) memo.set(path, { at: Date.now(), reply });
    return reply;
  }
  const isKept = path => {
    const kept = memo.get(path);
    return !!kept && Date.now() - kept.at < KEEP_MS;
  };
  const forget = (...paths) => paths.forEach(p => memo.delete(p));
  const keep = (path, reply) => memo.set(path, { at: Date.now(), reply });

  const person = () => ({ firstName: S.account.firstName, photo: S.photo.url });

  /* the photo's bytes need the session, so it arrives as a blob: (the page's CSP allows those) */
  async function loadPhoto() {
    const version = S.account.avatar;
    if (!version) {
      setPhoto('', 0);
      onPhoto(null, 0);
      return;
    }
    if (S.photo.version === version) return;
    const blob = await api.avatar(version);
    if (S.account && S.account.avatar === version && blob) {
      setPhoto(URL.createObjectURL(blob), version);
      onPhoto(blob, version);
    }
  }
  function setPhoto(url, version) {
    if (S.photo.url && S.photo.url !== url) URL.revokeObjectURL(S.photo.url);
    S.photo = { url, version };
    main.querySelectorAll('[data-arch]').forEach(a => fillArch(a, person()));
    main.querySelectorAll('[data-photo-state]').forEach(paintPhotoWords);
  }

  async function openPhoto() {
    const { openPhotoSheet } = await import('./photo.js');
    openPhotoSheet(person(), {
      save: async blob => {
        const reply = await api.avatarSave(blob);
        if (reply.code === 'session') {
          sessionOver();
          return { ok: true };
        }
        if (!reply.ok) return { ok: false, message: reply.code === 'network' ? 'النت قطع. صورتك ما اتغيرتش.' : reply.message };
        const url = URL.createObjectURL(blob);
        S.account.avatar = reply.avatar;
        setPhoto(url, reply.avatar);
        onPhoto(blob, reply.avatar);
        forget('/v1/account/summary');
        return { ok: true, photo: url };
      },
      remove: async () => {
        const reply = await authed('POST', '/v1/account/avatar/delete', {});
        if (reply.code === 'session') {
          sessionOver();
          return { ok: true };
        }
        if (!reply.ok) return { ok: false, message: reply.code === 'network' ? 'النت قطع. جرّب تاني.' : reply.message };
        S.account.avatar = null;
        setPhoto('', 0);
        onPhoto(null, 0);
        forget('/v1/account/summary');
        return { ok: true };
      },
      after: () => { const a = main.querySelector('[data-arch]'); if (a) a.focus({ preventScroll: true }); }
    });
  }

  /* ---------- the first-time walkthrough ---------- */

  async function openTourNow(mark) {
    const { openTour } = await import('./onboard.js');
    openTour(person(), {
      guest: !!(S.account.eligibility && S.account.eligibility.state === 'guest'),
      onDone: () => {
        if (!mark) return;
        if (S.account) S.account.onboarded = true;
        forget('/v1/account/summary');
        authed('POST', '/v1/account/onboarded', {});
      }
    });
  }

  /* once, on the account's first page: someone who signed in to finish a competition or a booking isn't held up */
  function tourIfNew() {
    if (toured || !S.account || S.account.onboarded) return;
    clearTimeout(tourTimer);
    tourTimer = setTimeout(() => {
      if (toured || !S.account || S.account.onboarded || route !== '#me' || document.querySelector('dialog[open]')) return;
      toured = true;
      openTourNow(true).catch(() => { toured = false; });
    }, 900);
  }

  /* ---------- the frame ---------- */

  const railLink = (href, icon, text, match) => h('a', { class: 'ac-rail__a', href, 'data-rail': match, 'data-nav': href.split('/')[1] || 'home' }, ic(icon), text);
  const signoutButton = cls => h('button', { type: 'button', class: 'ac-signout ' + (cls || ''), 'data-logout': '', 'data-quiet': '', onclick: () => signOut(false) }, ic('logout'), 'خروج');

  function rail() {
    return h('aside', { class: 'ac-rail', 'aria-label': 'حسابي' },
      h('div', { class: 'ac-rail__who' },
        arch(person(), { size: 'm', onEdit: openPhoto }),
        h('p', { class: 'ac-rail__name' }, S.account.name),
        h('p', { class: 'ac-rail__email', dir: 'ltr' }, S.account.email)),
      h('nav', { class: 'ac-rail__nav' },
        railLink('#me', 'home', 'الرئيسية', 'home'),
        railLink('#me/bookings', 'ticket', 'حجوزاتي', 'bookings'),
        railLink('#me/results', 'trophy', 'مسابقاتي ونتايجي', 'results'),
        railLink('#me/points', 'star', 'نقاطي والمتجر', 'points'),
        railLink('#me/orders', 'bag', 'طلباتي', 'orders'),
        h('span', { class: 'ac-rail__sep' }),
        railLink('#me/profile', 'user', 'بياناتي', 'profile'),
        railLink('#me/notifications', 'bell', 'الإشعارات', 'notifications'),
        railLink('#me/security', 'shield', 'أمان الحساب', 'security'),
        railLink('#me/support', 'help', 'الدعم الفني', 'support')),
      signoutButton());
  }

  function frame() {
    let wrap = main.querySelector('.ac-wrap');
    if (!wrap) {
      wrap = h('div', { class: 'ac-wrap' });
      main.replaceChildren(h('div', { class: 'ac-shell' }, rail(), wrap));
    }
    const part = route.split('/')[1] || 'home';
    main.querySelectorAll('[data-rail]').forEach(a => {
      if (a.dataset.rail === part) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    return wrap;
  }

  /* one screen in place. kind: the transition; none when the content only replaces its own skeleton */
  function put(view, kind) {
    // a transition runs its swap a frame later: the answer may arrive first, and the last screen asked for wins
    const mine = ++latest;
    const change = () => {
      if (mine !== latest) return;
      const wrap = frame();
      wrap.replaceChildren(view);
      main.dataset.state = 'ready';
      if (kind) scrollTo({ top: 0 });
      const title = view.querySelector('h1');
      if (title) title.focus({ preventScroll: true });
    };
    if (kind) transition(kind, change);
    else change();
  }

  function failed(titleText, reply, back) {
    const view = h('div', { class: 'ac-view' }, head(titleText, back),
      h('div', { class: 'ac-empty' }, h('span', { class: 'ac-empty__ic' }, ic('wifi')),
        h('p', { class: 'ac-empty__t' }, reply.code === 'network' ? 'مقدرناش نوصل دلوقتي' : 'مقدرناش نفتح الصفحة'),
        h('p', { class: 'ac-empty__s', role: 'alert' }, reply.message || FAIL),
        h('button', { type: 'button', class: 'btn btn--primary', 'data-retry': '', onclick: () => open(route, 'fade') }, 'جرّب تاني')));
    cue('nope', { passive: true });
    return view;
  }

  /* a page with data: at once when the answer is kept, else its skeleton first */
  async function pageWith(method, path, kind, titleText, back, draw) {
    const mine = route;
    if (!isKept(path)) {
      put(skeleton(), kind);
      kind = '';
    }
    const reply = await load(method, path, method === 'POST' ? {} : undefined);
    if (mine !== route || !S.account) return;
    if (reply.code === 'session') {
      sessionOver();
      return;
    }
    if (!reply.ok) {
      put(failed(titleText, reply, back), kind);
      return;
    }
    const view = draw(reply);
    if (!kind) view.classList.add('ac-in');
    put(view, kind);
  }

  /* ---------- the first page ---------- */

  const words = s => {
    const coming = comingFirst(s.bookings.coming);
    const latest = s.results.latest[0];
    const ready = s.orders.ready[0];
    return {
      bookings: coming.length ? coming[0].event + (coming.length === 2 ? ' وحجز تاني' : coming.length > 2 ? ' و' + arDigits(coming.length - 1) + ' حجوزات تانية' : '') : s.bookings.total ? 'مفيش حجوزات جاية' : 'لسه مفيش حجوزات',
      results: !s.results.count ? 'لسه ما شاركتش' : latest.score !== null ? latest.title + '، ' + arDigits(latest.score) + ' من ' + arDigits(latest.maxScore) : latest.title,
      points: s.points.frozen ? arDigits(s.points.balance) + ' نقطة متجمدة' : s.points.balance ? arDigits(s.points.balance) + ' نقطة' + (s.points.season ? '، ' + s.points.season : '') : 'لسه مفيش نقط',
      orders: ready ? ready.itemName + ' جاهزة للاستلام' : s.orders.count ? arDigits(s.orders.count) + ' طلب' : 'لسه ما طلبتش حاجة'
    };
  };

  const activityRows = w => rows(
    row({ icon: 'ticket', title: 'حجوزاتي', sub: w.bookings, href: '#me/bookings', attrs: { 'data-nav': 'bookings' } }),
    row({ icon: 'trophy', title: 'مسابقاتي ونتايجي', sub: w.results, href: '#me/results', attrs: { 'data-nav': 'results' } }),
    row({ icon: 'star', title: 'نقاطي والمتجر', sub: w.points, href: '#me/points', attrs: { 'data-nav': 'points' } }),
    row({ icon: 'bag', title: 'طلباتي', sub: w.orders, href: '#me/orders', attrs: { 'data-nav': 'orders' } }));

  const accountRows = () => rows(
    row({ icon: 'user', title: 'بياناتي', sub: 'اسمك وإيميلك وموبايلك', href: '#me/profile', attrs: { 'data-nav': 'profile' } }),
    row({ icon: 'bell', title: 'الإشعارات', sub: 'الإيميلات اللي بتوصلك', href: '#me/notifications', attrs: { 'data-nav': 'notifications' } }),
    row({ icon: 'shield', title: 'أمان الحساب', sub: 'الأجهزة والباسورد', href: '#me/security', attrs: { 'data-nav': 'security' } }),
    row({ icon: 'help', title: 'الدعم الفني', sub: 'مشكلة أو تصحيح بيانات', href: '#me/support', attrs: { 'data-nav': 'support' } }));

  const hero = (hi, sub, staged) => h('section', { class: 'ac-hero' + (staged ? ' is-staged' : '') },
    arch(person(), { size: 'l', onEdit: openPhoto }),
    h('h1', { class: 'ac-hero__hi', tabindex: '-1' }, hi),
    h('p', { class: 'ac-hero__sub' }, sub));

  const nowList = s => {
    const items = attention(s, { money });
    return items.length ? h('section', { class: 'ac-now', 'aria-label': 'محتاج منك', 'data-now': '' }, items.map(i => h('a', { class: 'ac-now__item' + (i.tone ? ' ac-now__item--' + i.tone : ''), href: i.route },
      ic(i.icon),
      h('span', { class: 'ac-now__text' }, h('span', { class: 'ac-now__t' }, i.title), i.sub ? h('span', { class: 'ac-now__s' }, i.sub) : null),
      ic('go', 'ac-row__go')))) : null;
  };

  const seg = (href, value, label, gold, staged) => {
    const n = h('span', { class: 'ac-band__n' }, arDigits(value));
    if (staged) countUp(n, value, arDigits);
    return h('a', { class: 'ac-band__seg' + (gold ? ' ac-band__seg--gold' : ''), href }, n, h('span', { class: 'ac-band__l' }, label));
  };

  /* on a computer the rail lists the sections, so this space shows what's next instead */
  function deskRow(s) {
    const coming = comingFirst(s.bookings.coming).slice(0, 2);
    const recent = [
      ...s.results.latest.map(x => ({ at: x.submittedAt, icon: 'trophy', title: x.title, sub: resultWords(x), href: '#me/results/' + x.slug })),
      ...s.orders.latest.map(x => ({ at: x.requestedAt, icon: 'bag', title: x.itemName, sub: (ORDER[x.status] || [''])[0] + '، ' + arDigits(x.cost) + ' نقطة', href: '#me/orders/' + x.id }))
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 3);
    return h('div', { class: 'ac-deskrow' },
      section('الجاي', coming.length
        ? h('ul', { class: 'ac-rows' }, coming.map(bookingItem))
        : rows(row({ icon: 'ticket', title: 'مفيش حجوزات جاية', sub: 'الفعاليات في الصفحة الرئيسية للموقع' }))),
      section('آخر نشاط', recent.length
        ? rows(...recent.map(r => row(r)))
        : rows(row({ icon: 'trophy', title: 'لسه مفيش نشاط', sub: 'مسابقاتك وطلباتك هتظهر هنا' }))));
  }

  function homeOf(s) {
    const A = S.account;
    const staged = firstArrival();
    const w = words(s);
    const eligible = A.eligibility && A.eligibility.state !== 'guest';
    const isNew = !s.bookings.total && !s.results.count && !s.orders.count && !s.points.balance;
    const site = new URL('../', location.href).href;

    if (isNew) {
      const step = (n, done, title, sub, props) => h(props.href ? 'a' : 'button', { class: 'ac-row', type: props.href ? null : 'button', ...props },
        h('span', { class: 'ac-step' + (done ? ' ac-step--done' : '') }, done ? ic('check') : arDigits(n)),
        h('span', { class: 'ac-row__body' }, h('span', { class: 'ac-row__t' }, title), h('span', { class: 'ac-row__s' }, sub)),
        ic('go', 'ac-row__go'));
      return h('div', { class: 'ac-view', 'data-home': '' },
        hero('أهلاً بيك يا ' + A.firstName, eligible ? 'حسابك جاهز. ده مكانك في الأسرة.' : 'بتشارك معانا كضيف.', staged),
        section('تبدأ منين؟', rows(
          step(1, !!A.avatar, 'حط صورتك', 'اختياري. تقدر تغيّرها أو تمسحها في أي وقت', { onclick: openPhoto, 'data-quiet': '' }),
          step(2, false, 'شارك في مسابقة', eligible ? 'بتكسب منها نقط تبدّلها بهدايا' : 'المسابقات مفتوحة ليك كضيف', { href: site }),
          step(3, false, 'احجز فعالية', 'الرحلات والمؤتمرات والأيام الروحية', { href: site }))),
        h('div', { class: 'ac-groups ac-groups--m' }, section('نشاطي', activityRows(w)), section('حسابي', accountRows())),
        signoutButton('ac-signout--m'));
    }

    return h('div', { class: 'ac-view' + (staged ? ' ac-in ac-in--slow' : ''), 'data-home': '' },
      hero(greet() + ' يا ' + A.firstName, eligible ? s.points.season || 'أسرة البابا أثناسيوس' : 'بتشارك معانا كضيف', staged),
      nowList(s),
      h('nav', { class: 'ac-band', 'aria-label': 'ملخص' },
        seg('#me/points', s.points.balance, 'نقطة', true, staged),
        seg('#me/bookings', s.bookings.coming.length, 'حجز جاي', false, staged),
        seg('#me/results', s.results.count, 'مسابقة', false, staged)),
      h('div', { class: 'ac-groups ac-groups--m' }, section('نشاطي', activityRows(w)), section('حسابي', accountRows())),
      deskRow(s),
      signoutButton('ac-signout--m'));
  }

  function viewHome(kind) {
    const path = '/v1/account/summary';
    if (isKept(path)) {
      const reply = memo.get(path).reply;
      S.account = { ...reply.account, onboarded: reply.account.onboarded || S.account.onboarded };
      put(homeOf(reply), kind);
      loadPhoto();
      tourIfNew();
      return;
    }
    // the greeting is there at once; what needs the server fills in under it
    const A = S.account;
    put(h('div', { class: 'ac-view' }, hero(greet() + ' يا ' + A.firstName, ' ', false), h('div', { class: 'ac-sk' }, h('i', { class: 'ac-sk--b' }), h('i', {}), h('i', {}))), kind);
    loadPhoto();
    load('GET', path).then(reply => {
      if (route !== '#me' || !S.account) return;
      if (reply.code === 'session') {
        sessionOver();
        return;
      }
      if (!reply.ok) {
        put(failed('حسابي', reply, '#me'), '');
        return;
      }
      S.account = { ...reply.account, onboarded: reply.account.onboarded || S.account.onboarded };
      put(homeOf(reply), '');
      loadPhoto();
      tourIfNew();
    });
  }

  /* ---------- bookings ---------- */

  function payBar(b) {
    if (!b.total || !['confirmed', 'pending'].includes(b.status)) return null;
    const fill = h('span', { class: 'ac-pay__fill' + (b.left ? '' : ' ac-pay__fill--full') });
    fill.style.setProperty('--paid', Math.min(1, b.paid / b.total));
    return h('span', { class: 'ac-pay' },
      h('span', { class: 'ac-pay__bar' }, fill),
      h('span', { class: 'ac-pay__txt' }, b.left ? 'دفعت ' + money(b.paid) + ' من ' + money(b.total) : 'مدفوع بالكامل'));
  }

  const bookingItem = b => h('li', { class: 'acct__booking' }, h('a', { class: 'ac-item', href: '#me/bookings/' + encodeURIComponent(b.ref) },
    h('span', { class: 'ac-item__top' }, h('span', { class: 'ac-item__t' }, b.event), chip(BOOKING[b.status] || [b.status, ''])),
    b.startAt ? h('span', { class: 'ac-item__s' }, whenText(b.startAt)) : null,
    payBar(b)));

  function bookingOne(all, ref) {
    const b = all.find(x => x.ref === ref);
    if (!b) return h('div', { class: 'ac-view' }, head('حجوزاتي', '#me/bookings'), note('مش لاقيين ده.'));
    const page = safeSlug(b.slug) && b.statusToken ? new URL('../events/' + b.slug + '/#b/' + b.statusToken, location.href).href : '';
    const fact = (label, value, ltr) => h('div', { class: 'ac-fact' }, h('dt', {}, label), h('dd', { dir: ltr ? 'ltr' : null }, value));
    return h('div', { class: 'ac-view', 'data-booking': b.ref }, head('تفاصيل الحجز', '#me/bookings'),
      h('section', { class: 'ac-ticket' },
        h('div', { class: 'ac-item__top' }, h('h2', { class: 'ac-ticket__t' }, b.event), chip(BOOKING[b.status] || [b.status, ''])),
        h('dl', { class: 'ac-facts' },
          b.startAt ? fact('الميعاد', whenText(b.startAt)) : null,
          fact('رقم الحجز', b.ref, true),
          b.total ? fact('المطلوب', money(b.total)) : null,
          b.total ? fact('المدفوع', money(b.paid)) : null),
        payBar(b),
        b.reason ? note(b.reason) : null,
        b.left > 0 && b.status === 'confirmed' ? h('p', { class: 'ac-lead' }, 'الباقي ' + money(b.left) + (b.dueAt ? ' قبل ' + whenText(b.dueAt) : '')) : null,
        page && b.left > 0 && b.status === 'confirmed' ? h('a', { class: 'btn btn--primary', href: page, 'data-pay': '' }, 'ادفع الباقي') : null,
        page && !(b.left > 0 && b.status === 'confirmed') && ['pending', 'confirmed'].includes(b.status) ? h('a', { class: 'btn', href: page, 'data-open-status': '' }, 'افتح صفحة الحجز') : null));
  }

  function viewBookings(ref, kind) {
    const site = new URL('../', location.href).href;
    return pageWith('GET', '/v1/account/bookings', kind, 'حجوزاتي', ref ? '#me/bookings' : '#me', reply => {
      if (ref) return bookingOne(reply.bookings, ref);
      const coming = comingFirst(reply.bookings.filter(b => ['pending', 'confirmed'].includes(b.status) && !isPast(b)));
      const past = reply.bookings.filter(b => !coming.includes(b));
      return h('div', { class: 'ac-view' }, head('حجوزاتي'),
        !reply.bookings.length ? empty('ticket', 'مفيش حجوزات مربوطة بحسابك لسه', 'لو حجزت قبل كده من غير حساب، افتح رابط حالة الحجز ودوس «اربطه بحسابي».', h('a', { class: 'btn btn--primary', href: site }, 'شوف الفعاليات')) : null,
        coming.length ? section('الجاية', list('data-bookings', coming.map(bookingItem))) : null,
        past.length ? section('اللي فات', list(coming.length ? 'data-bookings-past' : 'data-bookings', past.map(bookingItem))) : null);
    });
  }

  const isPast = b => !!b.startAt && b.startAt.slice(0, 10) < new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

  /* ---------- results ---------- */

  const resultWords = x => (x.score !== null ? 'الدرجة ' + arDigits(x.score) + ' من ' + arDigits(x.maxScore) + (x.pointsAwarded ? '، كسبت ' + arDigits(x.pointsAwarded) + ' نقطة' : '') : 'النتيجة هتظهر قريب.');

  function viewResults(slug, kind) {
    const site = new URL('../', location.href).href;
    const portal = new URL('../points/', location.href).href;
    return pageWith('POST', '/v1/comp/me', kind, 'مسابقاتي ونتايجي', slug ? '#me/results' : '#me', me => {
      const shownList = slug ? me.history.filter(x => x.slug === slug) : me.history;
      return h('div', { class: 'ac-view' }, head(slug ? 'نتيجتك' : 'مسابقاتي ونتايجي', slug ? '#me/results' : '#me'),
        slug && !shownList.length ? note('مش لاقيين ده.') : null,
        !slug && !shownList.length ? empty('trophy', 'لسه ما شاركتش في مسابقات', 'كل مسابقة بتشارك فيها بتظهر هنا بنتيجتها ونقطها.', h('a', { class: 'btn btn--primary', href: site }, 'شوف المسابقات')) : null,
        shownList.length ? list('data-results', shownList.map(x => h('li', {}, h(slug ? 'div' : 'a', { class: 'ac-item' + (slug ? ' ac-item--static' : ''), href: slug ? null : '#me/results/' + x.slug },
          h('span', { class: 'ac-item__top' }, h('span', { class: 'ac-item__t' }, x.title), chip(RESULT[x.status] || ['', ''])),
          h('span', { class: 'ac-item__s' }, resultWords(x)),
          slug && x.canReview ? h('a', { class: 'ac-link', href: portal }, 'راجع إجاباتك') : null)))) : null);
    });
  }

  /* ---------- points ---------- */

  function viewPoints(kind) {
    return pageWith('GET', '/v1/account/points', kind, 'نقاطي والمتجر', '#me', reply => {
      const open = reply.store && (reply.store.state === 'open' || reply.store.state === 'preview');
      const portal = new URL('../points/', location.href).href;
      const shop = cls => (open && !reply.frozen
        ? h('a', { class: 'btn ' + cls, href: portal, 'data-store': '' }, 'افتح المتجر')
        : h('button', { type: 'button', class: 'btn ' + cls, disabled: true, 'data-store': 'closed' }, reply.frozen ? 'رصيدك متجمد' : 'المتجر مقفول دلوقتي'));
      if (!reply.balance && !reply.ledger.length && !reply.seasons.length) {
        return h('div', { class: 'ac-view' }, head('نقاطي والمتجر'),
          h('span', { hidden: true, 'data-balance': '0' }),
          empty('star', 'لسه مفيش نقط في الموسم ده', 'شارك في مسابقة وهتبدأ تجمع نقط تبدّلها بهدايا من المتجر.', shop('')));
      }
      const number = h('p', { class: 'ac-bal__n' }, arDigits(reply.balance));
      countUp(number, reply.balance, arDigits);
      return h('div', { class: 'ac-view' }, head('نقاطي والمتجر'),
        h('section', { class: 'ac-bal' + (reply.frozen ? ' ac-bal--frozen' : ''), 'data-balance': String(reply.balance) },
          number,
          h('p', { class: 'ac-bal__u' }, 'نقطة' + (reply.season ? '، ' + reply.season.name : '')),
          shop('btn--primary ac-bal__cta')),
        reply.frozen ? note('رصيدك متجمد: النقط اللي جمعتها محفوظة، بس مش هتقدر تستخدمها طول ما سنك خارج النطاق العمري للخدمة. لو بياناتك غلط، كلّم الخدمة.', { alert: true, attrs: { 'data-frozen': '' } }) : null,
        reply.ledger.length
          ? section('حركة النقط', list('data-ledger', reply.ledger.map(l => h('li', {}, h('div', { class: 'ac-row ac-row--static' },
            h('span', { class: 'ac-row__body' },
              h('span', { class: 'ac-row__t' }, l.title || l.note || LEDGER[l.kind] || 'حركة نقط'),
              h('span', { class: 'ac-row__s' }, [l.title || l.note ? LEDGER[l.kind] : '', l.title && l.note ? l.note : '', msDateText(l.at)].filter(Boolean).join('، '))),
            h('span', { class: l.amount > 0 ? 'ac-led--plus' : 'ac-led--minus', dir: 'ltr' }, (l.amount > 0 ? '+' : '−') + arDigits(Math.abs(l.amount))))))))
          : h('p', { class: 'ac-lead' }, 'لسه مفيش حركة في الموسم ده.'),
        reply.seasons.length ? section('مواسم فاتت', h('ul', { class: 'ac-rows', 'data-seasons': '' }, reply.seasons.map(s => h('li', {}, row({ title: s.name, end: arDigits(s.final) + ' نقطة' }))))) : null);
    });
  }

  /* ---------- orders ---------- */

  function viewOrders(id, kind) {
    return pageWith('POST', '/v1/comp/me', kind, 'طلباتي', id ? '#me/orders' : '#me', me => {
      const shownList = id ? me.redemptions.filter(x => x.id === id) : me.redemptions;
      const cancelOf = x => {
        const start = h('button', { type: 'button', class: 'ac-link', 'data-cancel-order': x.id, onclick: () => {
          const yes = h('button', { type: 'button', class: 'btn ac-btn--danger', 'data-cancel-yes': '' }, 'أيوه، الغي الطلب');
          yes.addEventListener('click', async () => {
            yes.disabled = true;
            const reply = await authed('POST', '/v1/shop/cancel', { redemptionId: x.id });
            if (!reply.ok) {
              yes.disabled = false;
              cue('nope');
              toast(reply.message || FAIL, 'err');
              return;
            }
            forget('/v1/comp/me', '/v1/account/summary', '/v1/account/points');
            cue('success');
            toast('اتلغى الطلب ورجعت نقطك.');
            open(route, '');
          });
          start.replaceWith(h('div', { class: 'ac-btns ac-btns--2' }, yes, h('button', { type: 'button', class: 'btn', onclick: () => open(route, '') }, 'لأ، سيبه')));
        } }, 'الغي الطلب');
        return start;
      };
      return h('div', { class: 'ac-view' }, head(id ? 'طلبك' : 'طلباتي', id ? '#me/orders' : '#me'),
        id && !shownList.length ? note('مش لاقيين ده.') : null,
        !id && !shownList.length ? empty('bag', 'لسه ما طلبتش حاجة من المتجر', 'لما تجمع نقط، تقدر تبدّلها بهدايا من المتجر.', h('a', { class: 'btn', href: '#me/points' }, 'شوف نقطك')) : null,
        shownList.length ? list('data-orders', shownList.map(x => h('li', {}, h('div', { class: 'ac-item ac-item--static' },
          h('div', { class: 'ac-item__top' }, h('span', { class: 'ac-item__t' }, x.itemName), chip(ORDER[x.status] || ['', ''])),
          h('span', { class: 'ac-item__s' }, arDigits(x.cost) + ' نقطة'),
          x.canCancel ? cancelOf(x) : null)))) : null);
    });
  }

  /* ---------- profile ---------- */

  function paintPhotoWords(box) {
    box.replaceChildren(
      h('p', { class: 'ac-who__t' }, S.photo.url ? 'صورتك' : 'مفيش صورة لسه'),
      h('p', { class: 'ac-who__s' }, 'اختيارية. بتظهر ليك إنت، وللخدام المسؤولين عن حسابات الشباب.'),
      h('button', { type: 'button', class: 'ac-link', 'data-quiet': '', 'data-photo-open': '', onclick: openPhoto }, S.photo.url ? 'غيّرها أو امسحها' : 'حط صورة'));
  }

  const correctionLink = () => {
    const s = S.config && S.config.support;
    if (!s || !s.whatsapp) return null;
    let href = s.whatsapp;
    try {
      const url = new URL(s.whatsapp);
      url.searchParams.set('text', 'عايز أصحح بياناتي في حسابي.');
      href = url.href;
    }
    catch { /* the number as it is */ }
    return h('a', { class: 'btn ac-btn--wa', ...external(href), 'data-support': '' }, ic('whatsapp'), 'صحّح بياناتي مع الدعم');
  };

  function viewProfile(kind) {
    const A = S.account;
    const fact = (label, value, ltr) => h('div', { class: 'ac-fact' }, h('dt', {}, label), h('dd', { dir: ltr ? 'ltr' : null }, value));
    const words2 = h('div', { 'data-photo-state': '' });
    paintPhotoWords(words2);
    put(h('div', { class: 'ac-view' }, head('بياناتي'),
      h('div', { class: 'ac-who' }, arch(person(), { size: 's', onEdit: openPhoto, cls: 'ac-who__arch' }), words2),
      h('section', { class: 'ac-rows ac-rows--pad' }, h('dl', { class: 'ac-facts', 'data-facts': '' },
        fact('الاسم', A.name), fact('الإيميل', A.email, true), fact('الموبايل', A.phone, true), fact('تاريخ الميلاد', dateText(A.birthDate)))),
      A.eligibility && A.eligibility.state === 'guest' ? note('حسابك خارج النطاق العمري للخدمة، فتقدر تشارك كضيف بدون نقاط.', { attrs: { 'data-guest': '' } }) : null,
      A.eligibility && A.eligibility.soon ? note('سنك قرب يخرج من النطاق العمري للخدمة.') : null,
      h('p', { class: 'ac-note' }, ic('lock'), h('span', {}, 'البيانات دي مقفولة عشان تفضل صحيحة في الحجوزات والمسابقات. لو في حاجة غلط، الدعم الفني بيصلّحها.')),
      correctionLink()), kind);
    loadPhoto();
  }

  /* ---------- notifications ---------- */

  function viewPrefs(kind) {
    return pageWith('GET', '/v1/account/prefs', kind, 'الإشعارات', '#me', reply => {
      const line = group => {
        const status = h('span', { class: 'ac-saved', 'aria-live': 'polite' });
        const box = h('input', { type: 'checkbox', role: 'switch', id: 'pref-' + group.key, 'data-pref': group.key, checked: group.on || null });
        box.addEventListener('change', async () => {
          const wanted = box.checked;
          box.disabled = true;
          status.className = 'ac-saved';
          status.textContent = '';
          const saved = await authed('POST', '/v1/account/prefs', { prefs: { [group.key]: wanted } });
          box.disabled = false;
          if (saved.code === 'session') {
            sessionOver();
            return;
          }
          if (!saved.ok) {
            box.checked = !wanted;
            status.className = 'ac-saved ac-saved--err';
            status.textContent = saved.message && saved.code !== 'network' ? saved.message : 'مقدرناش نحفظ. جرّب تاني.';
            cue('nope');
            return;
          }
          box.checked = saved.groups.find(g => g.key === group.key).on;
          keep('/v1/account/prefs', saved);
          status.textContent = 'اتحفظ';
          cue('pop');
          setTimeout(() => { status.textContent = ''; }, 1800);
        });
        return h('label', { class: 'ac-row', for: 'pref-' + group.key, 'data-quiet': '' },
          h('span', { class: 'ac-row__body' }, h('span', { class: 'ac-row__t' }, group.label), status),
          h('span', { class: 'ac-sw' }, box, h('span', { class: 'ac-sw__track' }), h('span', { class: 'ac-sw__dot' })));
      };
      return h('div', { class: 'ac-view' }, head('الإشعارات'),
        h('p', { class: 'ac-lead' }, 'الإيميلات اللي تحب توصلك عن حسابك. عمرنا ما هنبعتلك إعلانات.'),
        h('div', { class: 'ac-rows', 'data-prefs': '' }, reply.groups.map(line)),
        section('دول بيوصلوك على طول', h('ul', { class: 'ac-rows ac-always', 'data-always': '' }, reply.always.map(text => h('li', {}, ic('check'), text)))));
    });
  }

  /* ---------- security ---------- */

  function viewSecurity(kind) {
    return pageWith('GET', '/v1/account/security', kind, 'أمان الحساب', '#me', reply => {
      const everywhere = h('button', { type: 'button', class: 'btn', 'data-logout-all': '', onclick: () => {
        const yes = h('button', { type: 'button', class: 'btn ac-btn--danger', 'data-logout-all-yes': '' }, 'أيوه، اخرج');
        yes.addEventListener('click', async () => {
          yes.disabled = true;
          await authed('POST', '/v1/account/logout', { all: true });
          signOut(false, { done: true, notice: 'خرجت من كل الأجهزة.' });
        });
        everywhere.replaceWith(h('div', { class: 'ac-btns' },
          h('p', { class: 'ac-lead' }, 'هتخرج من الأجهزة كلها، حتى الجهاز ده.'),
          h('div', { class: 'ac-btns ac-btns--2' }, yes, h('button', { type: 'button', class: 'btn', onclick: () => open(route, '') }, 'لأ'))));
      } }, 'اخرج من كل الأجهزة');
      const desk = /Windows|Mac|Linux/;
      return h('div', { class: 'ac-view' }, head('أمان الحساب'),
        section('حسابك مفتوح على', list('data-sessions', reply.sessions.map(s => h('li', {}, h('div', { class: 'ac-row ac-row--static' },
          h('span', { class: 'ac-row__ic' }, ic(desk.test(s.device) ? 'desktop' : 'mobile')),
          h('span', { class: 'ac-row__body' },
            h('span', { class: 'ac-row__t', dir: 'ltr' }, s.device),
            h('span', { class: 'ac-row__s' }, (s.current ? 'الجهاز ده' : 'آخر نشاط ' + relativeText(s.lastSeen)) + (s.kind === 'shared' ? '، جهاز مشترك' : ''))),
          s.current ? chip(['دلوقتي', 'ok']) : null))))),
        h('p', { class: 'ac-lead' }, 'لو في جهاز مش بتاعك، اخرج من كل الأجهزة وكلّم الدعم الفني.'),
        everywhere,
        section('الباسورد', rows(row({ icon: 'key', title: 'عايز باسورد جديد؟', sub: 'هنبعت كود على إيميلك. الجديد بيخرّجك من كل الأجهزة.', onclick: openForgot, attrs: { 'data-new-password': '' } }))),
        section('الجهاز ده', rows(row({ icon: 'logout', title: 'خروج وانسَ الجهاز ده', sub: 'لو الجهاز مش بتاعك', onclick: () => signOut(true), attrs: { 'data-logout-forget': '', 'data-quiet': '' } }))));
    });
  }

  /* ---------- support ---------- */

  function viewSupport(kind) {
    const s = (S.config && S.config.support) || {};
    put(h('div', { class: 'ac-view' }, head('الدعم الفني'),
      h('p', { class: 'ac-lead' }, 'في مشكلة في حسابك أو بياناتك محتاجة تتصلح؟ كلّم ' + (s.name || 'الدعم الفني') + '.'),
      rows(row({ icon: 'home', title: 'إزاي تستخدم حسابك', sub: 'شرح سريع لكل أقسام حسابك', onclick: () => openTourNow(false), attrs: { 'data-tour-open': '', 'data-quiet': '' } })),
      rows(
        s.whatsapp ? row({ icon: 'whatsapp', title: 'واتساب', sub: 'أسرع طريقة', href: s.whatsapp, attrs: { target: '_blank', rel: 'noopener', 'data-support': '' } }) : null,
        s.phone ? row({ icon: 'phone', title: 'مكالمة', sub: h('span', { dir: 'ltr' }, s.phone), href: 'tel:' + s.phone }) : null,
        s.email ? row({ icon: 'mail', title: 'إيميل', sub: h('span', { dir: 'ltr' }, s.email), href: 'mailto:' + s.email }) : null)), kind);
  }

  /* ---------- routes ---------- */

  function open(next, kind) {
    route = next;
    S.route = next;
    const part = next.split('/');
    if (part[1] === 'security') viewSecurity(kind);
    else if (part[1] === 'notifications') viewPrefs(kind);
    else if (part[1] === 'points') viewPoints(kind);
    else if (part[1] === 'profile') viewProfile(kind);
    else if (part[1] === 'support') viewSupport(kind);
    else if (part[1] === 'bookings') viewBookings(part[2] || '', kind);
    else if (part[1] === 'results') viewResults(part[2] || '', kind);
    else if (part[1] === 'orders') viewOrders(part[2] || '', kind);
    else viewHome(kind);
  }

  function openRoute({ kind = '' } = {}) {
    const next = cleanRoute(location.hash) || '#me';
    const was = route;
    const auto = !shown ? '' : depth(next) > depth(was) ? 'forward' : depth(next) < depth(was) ? 'back' : 'fade';
    if (shown && next !== was && !kind) cue('page', { passive: true });
    shown = true;
    open(next, kind || auto);
    loadPhoto();
  }

  return {
    openRoute,
    keep,
    reset() {
      memo.clear();
      shown = false;
      toured = false;
      clearTimeout(tourTimer);
      route = '#me';
      if (S.photo.url) URL.revokeObjectURL(S.photo.url);
      S.photo = { url: '', version: 0 };
    }
  };

}

export const brokenHome = retryFn => h('div', { class: 'ac-gate' }, h('div', { class: 'ac-empty' }, h('span', { class: 'ac-empty__ic' }, ic('wifi')),
  h('h1', { class: 'ac-empty__t', tabindex: '-1' }, 'مقدرناش نوصل دلوقتي'),
  h('p', { class: 'ac-empty__s' }, 'اتأكد من النت وجرّب تاني. بياناتك في أمان.'),
  h('button', { type: 'button', class: 'btn btn--primary', onclick: retryFn }, 'جرّب تاني')));
