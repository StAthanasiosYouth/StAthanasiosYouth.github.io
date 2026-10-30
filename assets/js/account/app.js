/**
 * YOUTH ACCOUNT: sign-in, registration and recovery (docs/YOUTH-ACCOUNTS-PLAN.md
 * §6, §8, §10, §13; API: worker/src/account/routes.js).
 *
 * One real two-field form, both fields always usable, so a password manager can
 * fill it at any moment: email only → «متابعة» asks whether it has an account;
 * email + password → signs in directly. The password never reaches storage.
 * The server decides everything; this page only draws its answers.
 *
 * mountAccount(main, { onSignedIn }) is what competition/ and points/ will use.
 */

import { h } from '../dom.js';
import { bookApiUrl } from '../page/book-config.js';
import { mountTurnstile } from '../page/turnstile.js';
import {
  validEmail, emailTypo, maskEmail, submitLabel, arDigits, monthNames, dateText, birthDateOf, birthYears,
  readHints, addHint, removeHint, writeHints, readSession, writeSession, clearSession, cleanRoute, keepDest, takeDest, RETURN_KEY, cleanReturn
} from './model.js';

const safeStore = name => {
  try {
    return window[name];
  }
  catch {
    return null;
  }
};

export function mountAccount(main, { onSignedIn = null } = {}) {

  const local = safeStore('localStorage');
  const tab = safeStore('sessionStorage');
  const api = bookApiUrl();

  const S = {
    config: null,
    email: '',
    error: '',
    notice: '',
    known: new Map(),      // email → exists, so going back and forth costs nothing
    asked: null,           // the email the last discovery answered for
    exists: null,
    shared: false,
    form: { phone: '', name: '', year: '', month: '', day: '' },
    pendingId: '',
    fieldErrors: {},
    otp: { kind: '', minutes: 10, wait: 0 },
    issued: null,          // { email, password, firstName, eligible, first }
    account: null
  };

  let captcha = null;
  let timer = null;
  let seq = 0;

  /* ---------- the request ---------- */

  async function call(method, path, body, token) {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    try {
      const res = await fetch(api + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      return { status: res.status, ...data };
    }
    catch {
      return { ok: false, code: 'network', message: 'النت قطع. اتأكد من الاتصال وجرّب تاني.' };
    }
  }

  /* a fresh Turnstile token (single use), waiting for the widget when needed */
  function turnstileToken() {
    if (!captcha) return Promise.resolve('');
    if (captcha.token()) return Promise.resolve(captcha.token());
    return new Promise(resolve => {
      const started = Date.now();
      const look = () => {
        if (!captcha || captcha.token() || Date.now() - started > 8000) resolve(captcha ? captcha.token() : '');
        else setTimeout(look, 100);
      };
      look();
    });
  }

  function mountCheck(box) {
    if (captcha) captcha.remove();
    captcha = null;
    const key = S.config && S.config.turnstile;
    if (!key) return;
    captcha = mountTurnstile(box, key, {
      action: 'account',
      onError: () => showError('علامة التأكيد ما اشتغلتش. حدّث الصفحة أو جرّب نت تاني.')
    });
  }

  const showError = text => {
    const box = main.querySelector('[data-error]');
    if (box) {
      box.textContent = text;
      box.hidden = !text;
    }
  };

  /* ---------- small parts ---------- */

  const card = (...kids) => h('div', { class: 'card step acct' }, ...kids);
  const title = text => h('h1', { class: 'acct__title', tabindex: '-1' }, text);
  const errorLine = () => h('p', { class: 'field__error', 'data-error': '', role: 'alert', hidden: !S.error || null }, S.error);
  const noticeLine = () => (S.notice ? h('p', { class: 'acct__notice', role: 'status' }, S.notice) : null);
  const check = () => h('div', { class: 'acct__check', 'data-check': '' });
  const textBtn = (label, onclick, attrs = {}) => h('button', { type: 'button', class: 'acct__link', onclick, ...attrs }, label);

  function field(label, input, { hint = '', error = '', id = '' } = {}) {
    return h('div', { class: 'field' + (error ? ' has-error' : ''), 'data-field': id || null },
      h('label', { class: 'field__label', for: input.id }, label),
      input,
      hint ? h('p', { class: 'field__hint' }, hint) : null,
      error ? h('p', { class: 'field__error', role: 'alert' }, error) : null);
  }

  function support(lead = 'مش قادر توصل للإيميل بتاعك؟') {
    const s = S.config && S.config.support;
    if (!s) return null;
    return h('p', { class: 'acct__support' }, lead + ' ',
      h('a', { href: s.whatsapp, target: '_blank', rel: 'noopener', 'data-support': '' }, s.name ? 'كلّم ' + s.name + ' من الدعم الفني على واتساب' : 'كلّم الدعم الفني على واتساب'));
  }

  function show(view, focus) {
    if (captcha) {
      captcha.remove();
      captcha = null;
    }
    clearInterval(timer);
    main.dataset.state = 'ready';
    main.replaceChildren(view);
    const box = view.querySelector('[data-check]');
    if (box) mountCheck(box);
    const target = focus ? view.querySelector(focus) : view.querySelector('.acct__title');
    if (target) target.focus({ preventScroll: false });
  }

  /* ---------- the two-field form (§8.1, §8.2) ---------- */

  function viewSignin({ prefill = '', focusPassword = false } = {}) {
    if (prefill) S.email = prefill;
    const email = h('input', {
      class: 'field__input', type: 'email', name: 'email', id: 'acct-email', autocomplete: 'username', inputmode: 'email',
      autocapitalize: 'off', spellcheck: 'false', dir: 'ltr', required: true, value: S.email
    });
    const password = h('input', {
      class: 'field__input', type: 'password', name: 'password', id: 'acct-password', autocomplete: 'current-password', dir: 'ltr'
    });
    const toggle = h('button', { type: 'button', class: 'acct__eye', 'aria-pressed': 'false', 'aria-label': 'إظهار الباسورد' }, 'إظهار');
    toggle.addEventListener('click', () => {
      const showing = password.type === 'text';
      password.type = showing ? 'password' : 'text';
      toggle.textContent = showing ? 'إظهار' : 'إخفاء';
      toggle.setAttribute('aria-pressed', String(!showing));
      password.focus();
    });
    const hint = h('p', { class: 'field__hint', 'data-pw-hint': '' });
    const pwField = h('div', { class: 'field acct__pw', 'data-pw': '' },
      h('label', { class: 'field__label', for: 'acct-password' }, 'الباسورد بتاعك'),
      h('div', { class: 'acct__pwrow' }, password, toggle),
      hint);
    const none = h('div', { class: 'acct__none', 'data-none': '', hidden: true },
      h('p', {}, 'مفيش حساب بالإيميل ده.'),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn--primary', 'data-create': '', onclick: () => openRegister(email.value) }, 'إنشاء حساب جديد'),
        h('button', { type: 'button', class: 'btn', onclick: () => { setNone(false); email.select(); email.focus(); } }, 'جرّب إيميل تاني')));
    const submit = h('button', { class: 'btn btn--primary', type: 'submit' }, 'متابعة');
    const create = h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', 'data-create-new': '', onclick: () => openRegister(email.value) }, 'إنشاء حساب جديد'));
    const sharedBox = h('input', { type: 'checkbox', id: 'acct-shared', checked: S.shared || null });
    sharedBox.addEventListener('change', () => { S.shared = sharedBox.checked; });

    const paint = busy => {
      submit.textContent = submitLabel({ busy, password: password.value });
      submit.disabled = !!busy;
    };
    const setNone = on => {
      none.hidden = !on;
      pwField.hidden = on;
      submit.hidden = on;
      create.hidden = on;
    };
    const setHint = () => {
      hint.textContent = S.exists && S.asked === email.value.trim() ? 'أهلاً بيك تاني — اكتب الباسورد بتاعك' : 'اكتب الإيميل الأول ودوس متابعة';
      pwField.classList.toggle('is-muted', !(S.exists && S.asked === email.value.trim()) && !password.value);
    };

    email.addEventListener('input', () => {
      seq++;   // a stale answer is ignored
      S.email = email.value;
      setNone(false);
      setHint();
      showError('');
    });
    password.addEventListener('input', () => {
      paint(false);
      setHint();
    });

    const form = h('form', { class: 'form', method: 'post', novalidate: true },
      field('الإيميل', email, { id: 'email' }), pwField, none, errorLine(), check(), submit);

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const address = email.value.trim();
      const typed = password.value;
      S.error = '';
      showError('');
      if (!validEmail(address)) {
        showError('اكتب إيميلك صح.');
        email.focus();
        return;
      }
      S.email = address;
      // the answer is already known: no request for going back and forth
      if (!typed && S.known.has(address)) {
        answer(address, S.known.get(address));
        return;
      }
      const mine = ++seq;
      paint(true);
      const token = await turnstileToken();
      const reply = await call('POST', '/v1/account/signin', { email: address, password: typed || undefined, turnstile: token, shared: S.shared });
      if (captcha) captcha.reset();
      if (mine !== seq) {
        paint(false);
        return;
      }
      paint(false);
      if (reply.session) {
        await signedIn(reply, address, typed);
        return;
      }
      if (reply.ok && typeof reply.exists === 'boolean') {
        S.known.set(address, reply.exists);
        answer(address, reply.exists);
        return;
      }
      if (reply.code === 'password') {
        S.known.set(address, true);
        showError(reply.message);
        if (reply.challenge) form.querySelector('[data-check]').classList.add('is-visible');
        password.select();
        password.focus();
        return;
      }
      showError(reply.message || 'حصلت مشكلة. جرّب تاني.');
    });

    function answer(address, exists) {
      S.asked = address;
      S.exists = exists;
      if (exists) {
        setNone(false);
        setHint();
        password.focus();
      }
      else {
        setNone(true);
        none.querySelector('[data-create]').focus();
      }
    }

    paint(false);
    setHint();
    if (S.asked === S.email && S.exists === false) setNone(true);

    show(card(
      title('سجّل دخولك'),
      h('p', { class: 'acct__lead' }, 'سجّل دخولك بالإيميل والباسورد بتوعك.'),
      noticeLine(),
      form,
      create,
      h('div', { class: 'acct__row' },
        sharedBox,
        h('label', { for: 'acct-shared' }, 'ده جهاز مشترك (متفتكرنيش هنا)')),
      S.shared ? h('p', { class: 'field__hint' }, 'لو مش جهازك، متحفظش الباسورد.') : null,
      textBtn('نسيت الباسورد؟', () => viewForgot(email.value), { 'data-forgot': '' }),
      support()
    ), focusPassword ? '#acct-password' : '#acct-email');
    S.notice = '';
  }

  /* ---------- after a right password (§13.5) ---------- */

  async function signedIn(reply, email, password) {
    const kind = reply.session.kind;
    writeSession(local, tab, { token: reply.session.token, email: reply.account.email }, kind);
    if (kind !== 'shared' && local) writeHints(local, addHint(readHints(local), { firstName: reply.account.firstName, email: reply.account.email }));
    // the explicit save prompt where the browser has one; the form is replaced right after (the others take that as a login)
    if (password && window.PasswordCredential && navigator.credentials) {
      try {
        await navigator.credentials.store(new window.PasswordCredential({ id: email, password, name: reply.account.firstName }));
      }
      catch { /* the browser's own prompt still has its chance */ }
    }
    enter(reply.account);
  }

  /* signed in: the page a link was going to, once; else the account's first page */
  function enter(account) {
    S.account = account;
    // came from a page that asked for a sign-in: straight back to it
    let back = '';
    try {
      back = cleanReturn(tab ? tab.getItem(RETURN_KEY) : '');
      if (back) tab.removeItem(RETURN_KEY);
    }
    catch { back = ''; }
    if (back) {
      location.replace(back);
      return;
    }
    const dest = takeDest(tab) || (cleanRoute(location.hash) === '#me' ? '' : cleanRoute(location.hash));
    history.replaceState(null, '', location.pathname + location.search + dest);
    openRoute();
    if (onSignedIn) onSignedIn(account);
  }

  function openRoute() {
    const route = cleanRoute(location.hash);
    if (route === '#me/security') viewSecurity();
    else if (route === '#me/notifications') viewPrefs();
    else if (route === '#me/points') viewPoints();
    else if (route.startsWith('#me/bookings')) viewBookings(route.split('/')[2] || '');
    else if (route.startsWith('#me/results')) viewResults(route.split('/')[2] || '');
    else if (route.startsWith('#me/orders')) viewOrders(route.split('/')[2] || '');
    else viewHome();
  }

  /* the session ended while the page was open: sign in, then back here */
  function sessionOver() {
    keepDest(tab, location.hash);
    clearSession(local, tab);
    S.email = S.account ? S.account.email : S.email;
    S.account = null;
    S.notice = 'لازم تسجّل دخولك تاني.';
    viewSignin();
  }

  const authed = (method, path, body) => {
    const saved = readSession(local, tab);
    return call(method, path, body, saved ? saved.token : '');
  };

  /* ---------- register (§6) ---------- */

  function openRegister(email) {
    S.email = String(email || S.email).trim();
    S.fieldErrors = {};
    S.error = '';
    viewRegister();
  }

  function viewRegister() {
    const F = S.form;
    const errs = S.fieldErrors;
    const phone = h('input', { class: 'field__input', type: 'tel', name: 'phone', id: 'acct-phone', autocomplete: 'tel', inputmode: 'tel', dir: 'ltr', value: F.phone });
    const name = h('input', { class: 'field__input', type: 'text', name: 'name', id: 'acct-name', autocomplete: 'name', maxlength: '80', value: F.name });
    const options = (list, chosen, none) => [
      h('option', { value: '' }, none),
      ...list.map(([value, label]) => h('option', { value, selected: String(chosen) === String(value) || null }, label))
    ];
    const day = h('select', { class: 'field__input', id: 'acct-day', name: 'bday-day', autocomplete: 'bday-day', 'aria-label': 'اليوم' },
      ...options(Array.from({ length: 31 }, (_, i) => [i + 1, arDigits(i + 1)]), F.day, 'اليوم'));
    const month = h('select', { class: 'field__input', id: 'acct-month', name: 'bday-month', autocomplete: 'bday-month', 'aria-label': 'الشهر' },
      ...options(monthNames().map((m, i) => [i + 1, m]), F.month, 'الشهر'));
    const year = h('select', { class: 'field__input', id: 'acct-year', name: 'bday-year', autocomplete: 'bday-year', 'aria-label': 'السنة' },
      ...options(birthYears().map(y => [y, arDigits(y)]), F.year, 'السنة'));
    const hp = h('div', { class: 'hp', 'aria-hidden': 'true' }, h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' }));

    const needEmail = !validEmail(S.email);
    const address = needEmail ? h('input', {
      class: 'field__input', type: 'email', name: 'email', id: 'acct-reg-email', autocomplete: 'username', inputmode: 'email',
      autocapitalize: 'off', spellcheck: 'false', dir: 'ltr', value: S.email
    }) : null;
    const typo = needEmail ? null : emailTypo(S.email);
    const form = h('form', { class: 'form', method: 'post', novalidate: true },
      needEmail
        ? field('الإيميل', address, { id: 'email', error: errs.email })
        : h('div', { class: 'acct__email' },
          h('span', { dir: 'ltr', 'data-reg-email': '' }, S.email),
          textBtn('تعديل', () => viewSignin({ prefill: S.email }))),
      typo ? h('p', { class: 'acct__notice', role: 'status' }, 'قصدك ', h('span', { dir: 'ltr' }, typo), '؟ ', textBtn('أيوه، صلّحه', () => { S.email = typo; viewRegister(); })) : null,
      errs.email && !needEmail ? h('p', { class: 'field__error', role: 'alert' }, errs.email) : null,
      field('رقم الموبايل', phone, { id: 'phone', error: errs.phone }),
      field('الاسم الثلاثي أو الرباعي', name, { id: 'name', error: errs.name }),
      h('fieldset', { class: 'acct__dob', 'data-field': 'birthDate' },
        h('legend', { class: 'field__label' }, 'تاريخ الميلاد'),
        h('div', { class: 'acct__dobrow' }, day, month, year),
        h('p', { class: 'field__hint' }, 'التاريخ مش هيتغير بعد إنشاء الحساب، فاكتبه صح.'),
        errs.birthDate ? h('p', { class: 'field__error', role: 'alert' }, errs.birthDate) : null),
      hp,
      errorLine(),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn--primary', type: 'submit' }, 'متابعة')));

    form.addEventListener('submit', event => {
      event.preventDefault();
      Object.assign(F, { phone: phone.value, name: name.value, day: day.value, month: month.value, year: year.value });
      S.hp = hp.querySelector('input').value;
      S.fieldErrors = {};
      S.error = '';
      if (needEmail) {
        S.email = address.value.trim();
        if (!validEmail(S.email)) {
          S.fieldErrors = { email: 'اكتب إيميلك صح.' };
          viewRegister();
          return;
        }
        // the form's own hint: «قصدك …؟» once, with a way to fix it
        if (emailTypo(S.email)) {
          viewRegister();
          return;
        }
      }
      if (!birthDateOf(F.year, F.month, F.day)) {
        S.fieldErrors = { birthDate: 'اختار اليوم والشهر والسنة.' };
        viewRegister();
        return;
      }
      viewConfirm();
    });

    show(card(title('إنشاء حساب جديد'), form,
      h('p', { class: 'acct__support' }, 'بنتعامل مع بياناتك حسب ', h('a', { href: '../privacy/#accounts' }, 'سياسة الخصوصية'), '.'),
      textBtn('عندي حساب، سجّل دخول', () => viewSignin({ prefill: validEmail(S.email) ? S.email : '' }), { 'data-have-account': '' }),
      support('محتاج مساعدة؟')), needEmail ? '#acct-reg-email' : errs.phone ? '#acct-phone' : errs.name ? '#acct-name' : '#acct-phone');
  }

  function viewConfirm() {
    const F = S.form;
    const birth = birthDateOf(F.year, F.month, F.day);
    const go = h('button', { class: 'btn btn--primary', type: 'button', 'data-send': '' }, 'ابعت كود التحقق');
    go.addEventListener('click', async () => {
      go.disabled = true;
      go.textContent = 'بنبعت…';
      const token = await turnstileToken();
      const reply = await call('POST', '/v1/account/register/start', { email: S.email, phone: F.phone, name: F.name, birthDate: birth, hp: S.hp || '', turnstile: token });
      go.disabled = false;
      go.textContent = 'ابعت كود التحقق';
      if (captcha) captcha.reset();
      if (reply.ok) {
        S.pendingId = reply.pendingId;
        S.otp = { kind: 'register', minutes: reply.minutes, wait: reply.resendAfter, testCode: reply.testCode || '' };
        S.error = '';
        viewOtp();
        return;
      }
      if (reply.code === 'invalid' && reply.field) {
        S.fieldErrors = { [reply.field]: reply.message };
        viewRegister();
        return;
      }
      showError([reply.message, reply.hint].filter(Boolean).join(' '));
    });
    show(card(
      title('راجع بياناتك'),
      h('p', { class: 'acct__lead', 'data-confirm': '' }, 'تاريخ ميلادك ' + dateText(birth) + ' ورقمك ', h('span', { dir: 'ltr' }, F.phone), ' — صح؟'),
      h('p', { class: 'field__hint' }, 'تاريخ الميلاد مش هيتغير بعد كده.'),
      errorLine(),
      check(),
      h('div', { class: 'actions' }, go, h('button', { class: 'btn', type: 'button', onclick: viewRegister }, 'تعديل')),
      support('محتاج مساعدة؟')
    ));
  }

  /* ---------- the code (§6.6): registration and recovery share it ---------- */

  function viewOtp() {
    const O = S.otp;
    const input = h('input', {
      class: 'field__input field__input--code', id: 'acct-code', name: 'code', autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: '6', dir: 'ltr', required: true
    });
    const submit = h('button', { class: 'btn btn--primary', type: 'submit' }, 'تأكيد');
    const resend = h('button', { type: 'button', class: 'acct__link', 'data-resend': '', disabled: true });
    const form = h('form', { class: 'form', method: 'post', novalidate: true },
      field('الكود', input, { id: 'code', hint: 'الكود شغال ' + arDigits(O.minutes) + ' دقايق. الرسالة ممكن تتأخر دقيقة؛ بص في Spam كمان.' }),
      errorLine(),
      check(),
      h('div', { class: 'actions' }, submit));

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const code = input.value.trim();
      if (!code) {
        showError('اكتب الكود.');
        return;
      }
      submit.disabled = true;
      const reply = O.kind === 'register'
        ? await call('POST', '/v1/account/register/verify', { pendingId: S.pendingId, code })
        : await call('POST', '/v1/account/forgot/verify', { email: S.email, code });
      submit.disabled = false;
      if (reply.ok) {
        S.issued = { email: reply.email, password: reply.password, firstName: reply.firstName, eligible: reply.eligible, first: O.kind === 'register' };
        viewPassword();
        return;
      }
      showError([reply.message, reply.hint].filter(Boolean).join(' '));
      input.select();
    });

    let wait = O.wait;
    const tick = () => {
      resend.disabled = wait > 0;
      resend.textContent = wait > 0 ? 'ابعت الكود تاني بعد ' + arDigits(wait) + ' ثانية' : 'ابعت الكود تاني';
      wait--;
      if (wait < 0) clearInterval(timer);
    };
    resend.addEventListener('click', async () => {
      resend.disabled = true;
      const token = await turnstileToken();
      const F = S.form;
      const reply = O.kind === 'register'
        ? await call('POST', '/v1/account/register/start', { email: S.email, phone: F.phone, name: F.name, birthDate: birthDateOf(F.year, F.month, F.day), hp: S.hp || '', turnstile: token })
        : await call('POST', '/v1/account/forgot', { email: S.email, turnstile: token });
      if (captcha) captcha.reset();
      if (reply.ok) {
        O.testCode = reply.testCode || '';
        wait = reply.resendAfter;
        clearInterval(timer);
        tick();
        timer = setInterval(tick, 1000);
        showError('');
        const note = main.querySelector('[data-sent]');
        if (note) note.textContent = 'بعتنا كود جديد.';
        return;
      }
      if (reply.retryAfter) wait = reply.retryAfter;
      tick();
      showError(reply.message || 'حصلت مشكلة. جرّب تاني.');
    });

    show(card(
      title(O.kind === 'register' ? 'تأكيد الإيميل' : 'كود الاسترجاع'),
      h('p', { class: 'acct__lead' }, O.kind === 'register'
        ? 'بعتنالك كود من ٦ أرقام على '
        : 'لو الإيميل ده متأكد وعليه حساب، هيوصلك كود من ٦ أرقام خلال دقايق على ', h('span', { dir: 'ltr' }, S.email)),
      h('p', { class: 'acct__notice', 'data-sent': '', role: 'status' }),
      O.testCode ? h('p', { class: 'acct__notice', 'data-test-code': O.testCode }, 'Staging: الكود ', h('span', { dir: 'ltr' }, O.testCode)) : null,
      form,
      resend,
      textBtn(O.kind === 'register' ? 'تعديل الإيميل' : 'ارجع لتسجيل الدخول', () => viewSignin({ prefill: S.email })),
      support('الكود مش واصلك؟')
    ), '#acct-code');
    tick();
    timer = setInterval(tick, 1000);
  }

  /* ---------- «ده الباسورد بتاعك»: a real sign-in form, so the browser offers to save (§13.5) ---------- */

  function viewPassword() {
    const I = S.issued;
    const email = h('input', { class: 'field__input', type: 'email', name: 'email', id: 'acct-email', autocomplete: 'username', dir: 'ltr', value: I.email });
    const password = h('input', { class: 'field__input', type: 'password', name: 'password', id: 'acct-password', autocomplete: 'current-password', dir: 'ltr', value: I.password });
    const copied = h('p', { class: 'acct__notice', role: 'status' });
    const copy = h('button', { type: 'button', class: 'btn', 'data-copy': '' }, 'نسخ');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(I.password);
        copied.textContent = 'اتنسخ.';
      }
      catch {
        copied.textContent = 'مقدرناش ننسخ. اكتبه عندك من فوق.';
      }
    });
    const submit = h('button', { class: 'btn btn--primary', type: 'submit', 'data-enter': '' }, 'احفظه وادخل');
    const form = h('form', { class: 'form', method: 'post', novalidate: true },
      field('الإيميل', email), field('الباسورد بتاعك', password), errorLine(), check(),
      h('div', { class: 'actions' }, submit, copy), copied);

    form.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true;
      const token = await turnstileToken();
      const reply = await call('POST', '/v1/account/signin', { email: email.value.trim(), password: password.value, turnstile: token, shared: S.shared });
      submit.disabled = false;
      if (reply.session) {
        const pw = password.value;
        S.issued = null;
        await signedIn(reply, email.value.trim(), pw);
        return;
      }
      if (captcha) captcha.reset();
      showError(reply.message || 'حصلت مشكلة. جرّب تاني.');
    });

    show(card(
      title(I.first ? 'أهلاً بيك يا ' + I.firstName + ' ❤️' : 'باسورد جديد لحسابك'),
      I.first && I.eligible === false
        ? h('p', { class: 'acct__notice', 'data-guest': '' }, 'حسابك اتعمل بنجاح، لكن سنك خارج النطاق العمري للخدمة، لذلك تقدر تشارك في المسابقات كضيف بدون احتساب نقاط.')
        : null,
      h('p', { class: 'acct__lead' }, 'ده الباسورد بتاعك.'),
      h('p', { class: 'acct__password', dir: 'ltr', 'data-password': '' }, I.password),
      h('p', { class: 'acct__lead' }, 'احتفظ بيه في مكان آمن لأنه هيكون وسيلة دخولك للمسابقات والنقط والمتجر والخدمات المرتبطة بحسابك.'),
      form
    ));
  }

  /* ---------- forgot (§10): the reply is always the same ---------- */

  function viewForgot(prefill) {
    if (prefill) S.email = prefill.trim();
    const email = h('input', {
      class: 'field__input', type: 'email', name: 'email', id: 'acct-forgot', autocomplete: 'username', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', dir: 'ltr', value: S.email
    });
    const submit = h('button', { class: 'btn btn--primary', type: 'submit' }, 'ابعت الكود');
    const form = h('form', { class: 'form', method: 'post', novalidate: true },
      field('الإيميل', email), errorLine(), check(), h('div', { class: 'actions' }, submit));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const address = email.value.trim();
      if (!validEmail(address)) {
        showError('اكتب إيميلك صح.');
        return;
      }
      submit.disabled = true;
      const token = await turnstileToken();
      const reply = await call('POST', '/v1/account/forgot', { email: address, turnstile: token });
      submit.disabled = false;
      if (captcha) captcha.reset();
      if (reply.ok) {
        S.email = address;
        S.otp = { kind: 'recover', minutes: reply.minutes, wait: reply.resendAfter, testCode: reply.testCode || '' };
        viewOtp();
        return;
      }
      showError(reply.message || 'حصلت مشكلة. جرّب تاني.');
    });
    show(card(
      title('نسيت الباسورد؟'),
      h('p', { class: 'acct__lead' }, 'اكتب إيميلك وهنبعتلك كود تعمل بيه باسورد جديد. الباسورد القديم هيفضل شغال لحد ما تأكد الكود.'),
      form,
      textBtn('ارجع لتسجيل الدخول', () => viewSignin({ prefill: email.value })),
      support()
    ), '#acct-forgot');
  }

  /* ---------- the same device (§8.5) ---------- */

  function viewHints(hints) {
    const rows = hints.map(hint => h('li', { class: 'acct__hint', 'data-hint': '' },
      h('p', { class: 'acct__hintname' }, h('strong', {}, hint.firstName), ' · ', h('span', { dir: 'ltr' }, maskEmail(hint.email))),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn--primary', 'data-continue': '', onclick: () => continueAs(hint) }, 'متابعة'),
        h('button', { type: 'button', class: 'btn', 'aria-label': 'انسَ الحساب ده على الجهاز ده', 'data-forget': '', onclick: () => forget(hint) }, '✕ انسَ الحساب ده على الجهاز ده'))));
    show(card(
      title('هل تريد المتابعة بالحساب الذي استخدمته سابقًا؟'),
      h('ul', { class: 'acct__hints' }, ...rows),
      h('button', { type: 'button', class: 'btn', 'data-other': '', onclick: () => viewSignin() }, 'استخدام حساب آخر')
    ));
  }

  async function continueAs(hint) {
    const saved = readSession(local, tab);
    if (saved && saved.email && saved.email.toLowerCase() === hint.email.toLowerCase()) {
      const reply = await call('GET', '/v1/account/me', null, saved.token);
      if (reply.ok) {
        enter(reply.account);
        return;
      }
      if (reply.code === 'session') clearSession(local, tab);
    }
    // the session has ended: the form, the email in place, the password manager's turn
    S.asked = hint.email;
    S.exists = true;
    viewSignin({ prefill: hint.email, focusPassword: true });
  }

  function forget(hint) {
    const saved = readSession(local, tab);
    if (saved && saved.email && saved.email.toLowerCase() === hint.email.toLowerCase()) {
      call('POST', '/v1/account/logout', {}, saved.token);
      clearSession(local, tab);
    }
    const left = removeHint(readHints(local), hint.email);
    writeHints(local, left);
    if (left.length) viewHints(left);
    else viewSignin();
  }

  /* ---------- signed in ---------- */

  function viewHome() {
    const A = S.account;
    const guest = A.eligibility && A.eligibility.state === 'guest';
    const logout = async forgetDevice => {
      const saved = readSession(local, tab);
      if (saved) await call('POST', '/v1/account/logout', {}, saved.token);
      clearSession(local, tab);
      if (forgetDevice) writeHints(local, removeHint(readHints(local), A.email));
      S.account = null;
      S.email = forgetDevice ? '' : A.email;
      S.notice = forgetDevice ? 'خرجت، والجهاز ده نسي الحساب. الباسورد المحفوظ في المتصفح بيتمسح من إعدادات المتصفح.' : 'خرجت من حسابك.';
      S.asked = null;
      S.exists = null;
      viewSignin();
    };
    const fact = (label, value, ltr) => h('div', { class: 'acct__fact' },
      h('dt', {}, label), h('dd', { dir: ltr ? 'ltr' : null }, value));
    show(card(
      title('أهلاً بيك يا ' + A.firstName),
      guest ? h('p', { class: 'acct__notice', 'data-guest': '' }, 'حسابك خارج النطاق العمري للخدمة، فتقدر تشارك كضيف بدون نقاط.') : null,
      A.eligibility && A.eligibility.soon ? h('p', { class: 'acct__notice' }, 'سنك قرب يخرج من النطاق العمري للخدمة.') : null,
      h('dl', { class: 'acct__facts', 'data-home': '' },
        fact('الاسم', A.name),
        fact('الإيميل', A.email, true),
        fact('الموبايل', A.phone, true),
        fact('تاريخ الميلاد', dateText(A.birthDate))),
      support('بياناتك محتاجة تتصلح؟'),
      h('nav', { class: 'acct__nav', 'aria-label': 'حسابي' },
        h('a', { class: 'btn', href: '#me/bookings', 'data-nav': 'bookings' }, 'حجوزاتي'),
        h('a', { class: 'btn', href: '#me/points', 'data-nav': 'points' }, 'نقاطي'),
        h('a', { class: 'btn', href: '#me/results', 'data-nav': 'results' }, 'نتايجي'),
        h('a', { class: 'btn', href: '#me/orders', 'data-nav': 'orders' }, 'طلباتي'),
        h('a', { class: 'btn', href: '#me/notifications', 'data-nav': 'notifications' }, 'إشعاراتي'),
        h('a', { class: 'btn', href: '#me/security', 'data-nav': 'security' }, 'أمان الحساب')),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', 'data-logout': '', onclick: () => logout(false) }, 'خروج'),
        h('button', { type: 'button', class: 'btn', 'data-logout-forget': '', onclick: () => logout(true) }, 'خروج وانسَ الجهاز ده'))
    ));
  }

  const HISTORY_WORDS = { submitted: 'اتبعتت', pending_review: 'مستني مراجعة', graded: 'اتصححت' };
  const ORDER_WORDS = { pending: 'مستني', approved: 'جاهزة للاستلام', fulfilled: 'اتسلمت', cancelled: 'اتلغت' };

  async function viewMine(titleText, draw) {
    main.dataset.state = 'loading';
    const reply = await authed('POST', '/v1/comp/me', {});
    if (reply.code === 'session') {
      sessionOver();
      return;
    }
    if (!reply.ok) {
      show(card(title(titleText), h('p', { class: 'field__error', role: 'alert' }, reply.message || 'حصلت مشكلة. جرّب تاني.'), backToAccount()));
      return;
    }
    show(card(title(titleText), ...draw(reply), backToAccount()));
  }

  /* #me/results[/slug]: what the policy lets the member see now; a number only when it may show */
  function viewResults(slug) {
    return viewMine('نتايجي', me => {
      const list = slug ? me.history.filter(x => x.slug === slug) : me.history;
      return [
        slug && !list.length ? h('p', { class: 'acct__notice' }, 'مش لاقيين ده.') : null,
        !slug && !list.length ? h('p', { class: 'acct__lead' }, 'لسه ما شاركتش في مسابقات.') : null,
        h('ul', { class: 'acct__sessions', 'data-results': '' }, ...list.map(x => h('li', {},
          h('strong', {}, x.title),
          h('p', { class: 'field__hint' }, HISTORY_WORDS[x.status] || ''),
          x.score !== null ? h('p', {}, 'الدرجة ' + arDigits(x.score) + ' من ' + arDigits(x.maxScore)) : h('p', { class: 'field__hint' }, 'النتيجة هتظهر قريب.'),
          x.pointsAwarded ? h('p', {}, arDigits(x.pointsAwarded) + ' نقطة') : null))),
        h('a', { class: 'btn', href: new URL('../points/', location.href).href }, 'نقاطي والمتجر')
      ];
    });
  }

  /* #me/orders[/id] */
  function viewOrders(id) {
    return viewMine('طلباتي', me => {
      const list = id ? me.redemptions.filter(x => x.id === id) : me.redemptions;
      return [
        id && !list.length ? h('p', { class: 'acct__notice' }, 'مش لاقيين ده.') : null,
        !id && !list.length ? h('p', { class: 'acct__lead' }, 'لسه ما طلبتش حاجة من المتجر.') : null,
        h('ul', { class: 'acct__sessions', 'data-orders': '' }, ...list.map(x => h('li', {},
          h('strong', {}, x.itemName), ' · ' + arDigits(x.cost) + ' نقطة',
          h('p', { class: 'field__hint' }, ORDER_WORDS[x.status] || '')))),
        h('a', { class: 'btn', href: new URL('../points/', location.href).href }, 'نقاطي والمتجر')
      ];
    });
  }

  const money = n => arDigits(Number(n) || 0) + ' جنيه';
  const BOOKING_STATUS = { pending: 'قيد المراجعة', confirmed: 'مؤكد', rejected: 'مرفوض', cancelled: 'ملغي', withdrawn: 'اتسحب' };

  /* #me/bookings[/REF]: an unknown ref and someone else's look the same: not in the list */
  async function viewBookings(ref) {
    main.dataset.state = 'loading';
    const reply = await authed('GET', '/v1/account/bookings');
    if (reply.code === 'session') {
      sessionOver();
      return;
    }
    if (!reply.ok) {
      show(card(title('حجوزاتي'), h('p', { class: 'field__error', role: 'alert' }, reply.message || 'حصلت مشكلة. جرّب تاني.'), backToAccount()));
      return;
    }
    const shown = ref ? reply.bookings.filter(b => b.ref === ref) : reply.bookings;
    show(card(
      title('حجوزاتي'),
      ref && !shown.length ? h('p', { class: 'acct__notice' }, 'مش لاقيين ده.') : null,
      !ref && !shown.length ? h('p', { class: 'acct__lead' }, 'مفيش حجوزات مربوطة بحسابك لسه. لو حجزت قبل كده من غير حساب، افتح رابط حالة الحجز ودوس «اربطه بحسابي».') : null,
      h('ul', { class: 'acct__sessions', 'data-bookings': '' }, ...shown.map(b => h('li', { class: 'acct__booking' },
        h('strong', {}, b.event), ' · ', h('span', { dir: 'ltr' }, b.ref),
        h('p', { class: 'field__hint' }, BOOKING_STATUS[b.status] || b.status),
        ['confirmed', 'pending'].includes(b.status) ? h('p', {}, 'المطلوب ' + money(b.total) + ' · المدفوع ' + money(b.paid) + (b.left > 0 ? ' · الباقي ' + money(b.left) : '')) : null,
        b.reason ? h('p', { class: 'field__hint' }, b.reason) : null))),
      ref ? h('a', { class: 'acct__link', href: '#me/bookings' }, 'كل حجوزاتي') : null,
      backToAccount()
    ));
  }

  const KIND_WORDS = { earn: 'نقاط مسابقة', manual: 'تعديل من الخدمة', transfer: 'نقل', spend: 'طلب من المتجر', refund: 'رجوع نقاط' };

  /* #me/points: the active season's balance and movements; closed seasons below */
  async function viewPoints() {
    main.dataset.state = 'loading';
    const reply = await authed('GET', '/v1/account/points');
    if (reply.code === 'session') {
      sessionOver();
      return;
    }
    if (!reply.ok) {
      show(card(title('نقاطي'), h('p', { class: 'field__error', role: 'alert' }, reply.message || 'حصلت مشكلة. جرّب تاني.'), backToAccount()));
      return;
    }
    show(card(
      title('نقاطي'),
      h('p', { class: 'acct__password', 'data-balance': '' }, arDigits(reply.balance) + ' نقطة'),
      reply.season ? h('p', { class: 'field__hint' }, reply.season.name) : null,
      reply.frozen ? h('p', { class: 'acct__notice', 'data-frozen': '' }, 'رصيدك متجمد: النقط اللي جمعتها محفوظة، بس مش هتقدر تستخدمها طول ما سنك خارج النطاق العمري للخدمة. لو بياناتك غلط، كلّم الخدمة.') : null,
      reply.ledger.length
        ? h('ul', { class: 'acct__sessions', 'data-ledger': '' }, ...reply.ledger.map(l => h('li', {},
          h('strong', { dir: 'ltr' }, (l.amount > 0 ? '+' : '') + arDigits(l.amount)), ' ' + (KIND_WORDS[l.kind] || ''), l.note ? ' — ' + l.note : '')))
        : h('p', { class: 'acct__lead' }, 'لسه مفيش نقط في الموسم ده.'),
      reply.seasons.length ? h('p', { class: 'field__hint' }, 'مواسم فاتت: ' + reply.seasons.map(s => s.name + ' (' + arDigits(s.final) + ')').join('، ')) : null,
      backToAccount()
    ));
  }

  const backToAccount = () => h('a', { class: 'acct__link', href: '#me', 'data-back': '' }, 'ارجع لحسابي');

  /* #me/security: where this account is signed in; a security notice's button opens this */
  async function viewSecurity() {
    main.dataset.state = 'loading';
    const reply = await authed('GET', '/v1/account/security');
    if (reply.code === 'session') {
      sessionOver();
      return;
    }
    if (!reply.ok) {
      show(card(title('أمان الحساب'), h('p', { class: 'field__error', role: 'alert' }, reply.message || 'حصلت مشكلة. جرّب تاني.'), backToAccount()));
      return;
    }
    const everywhere = h('button', { type: 'button', class: 'btn', 'data-logout-all': '' }, 'اخرج من كل الأجهزة');
    everywhere.addEventListener('click', async () => {
      everywhere.disabled = true;
      await authed('POST', '/v1/account/logout', { all: true });
      clearSession(local, tab);
      S.email = S.account.email;
      S.account = null;
      S.notice = 'خرجت من كل الأجهزة.';
      history.replaceState(null, '', location.pathname + location.search);
      viewSignin();
    });
    show(card(
      title('أمان الحساب'),
      h('p', { class: 'acct__lead' }, 'الأجهزة اللي حسابك مفتوح عليها دلوقتي:'),
      h('ul', { class: 'acct__sessions', 'data-sessions': '' }, ...reply.sessions.map(s => h('li', {},
        h('strong', { dir: 'ltr' }, s.device),
        s.current ? ' (الجهاز ده)' : '',
        s.kind === 'shared' ? ' · جهاز مشترك' : ''))),
      h('p', { class: 'field__hint' }, 'لو في جهاز مش بتاعك، اخرج من كل الأجهزة وكلّم الدعم الفني.'),
      h('div', { class: 'actions' }, everywhere),
      support('محتاج مساعدة؟'),
      backToAccount()
    ));
  }

  /* #me/notifications: «إشعاراتي». Each tap saves; the server's answer is what stays drawn */
  async function viewPrefs() {
    main.dataset.state = 'loading';
    const reply = await authed('GET', '/v1/account/prefs');
    if (reply.code === 'session') {
      sessionOver();
      return;
    }
    if (!reply.ok) {
      show(card(title('إشعاراتي'), h('p', { class: 'field__error', role: 'alert' }, reply.message || 'حصلت مشكلة. جرّب تاني.'), backToAccount()));
      return;
    }
    const row = group => {
      const box = h('input', { type: 'checkbox', id: 'pref-' + group.key, 'data-pref': group.key, checked: group.on || null });
      box.addEventListener('change', async () => {
        const wanted = box.checked;
        box.disabled = true;
        showError('');
        const saved = await authed('POST', '/v1/account/prefs', { prefs: { [group.key]: wanted } });
        box.disabled = false;
        if (saved.code === 'session') {
          sessionOver();
          return;
        }
        if (!saved.ok) {
          box.checked = !wanted;
          showError(saved.message || 'مقدرناش نحفظ. جرّب تاني.');
          return;
        }
        box.checked = saved.groups.find(g => g.key === group.key).on;
      });
      return h('li', { class: 'acct__row' }, box, h('label', { for: 'pref-' + group.key }, group.label));
    };
    show(card(
      title('إشعاراتي'),
      h('p', { class: 'acct__lead' }, 'الإيميلات اللي تحب توصلك عن حسابك. عمرنا ما هنبعتلك إعلانات.'),
      h('ul', { class: 'acct__prefs', 'data-prefs': '' }, ...reply.groups.map(row)),
      errorLine(),
      h('p', { class: 'field__hint' }, 'دول بيوصلوك على طول:'),
      h('ul', { class: 'acct__always', 'data-always': '' }, ...reply.always.map(text => h('li', {}, text))),
      backToAccount()
    ));
  }

  function viewOff() {
    show(card(title('تسجيل الدخول متوقف مؤقتًا'), h('p', { class: 'acct__lead' }, 'جرّب تاني بعد شوية.'), support('محتاج مساعدة؟')));
  }

  function viewBroken() {
    show(card(
      title('مقدرناش نفتح الصفحة'),
      h('p', { class: 'acct__lead' }, 'اتأكد من النت وجرّب تاني.'),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn--primary', onclick: start }, 'جرّب تاني'))
    ));
  }

  /* ---------- start ---------- */

  async function start() {
    main.dataset.state = 'loading';
    const config = await call('GET', '/v1/account/config');
    if (!config.ok) {
      viewBroken();
      return;
    }
    S.config = config;
    if (config.mode !== 'on') {
      viewOff();
      return;
    }
    const saved = readSession(local, tab);
    const hints = readHints(local);
    if (hints.length) {
      viewHints(hints);
      return;
    }
    if (saved) {
      // a shared-device session in this tab: no card, it simply goes on
      const reply = await call('GET', '/v1/account/me', null, saved.token);
      if (reply.ok) {
        enter(reply.account);
        return;
      }
      if (reply.code === 'session') clearSession(local, tab);
    }
    viewSignin();
  }

  window.addEventListener('hashchange', () => {
    if (S.account) openRoute();
    else keepDest(tab, location.hash);
  });

  keepDest(tab, location.hash);
  start();
}
