/*
 * THE OFFICIAL ADMIN PAGE: sign-in and the line to the server.
 *
 * 1. Never runs inside someone else's frame (clickjacking): it leaves the
 *    frame, and if it can't, it stops.
 * 2. "Sign in with Google" (Google Identity Services) gives a Google ID
 *    token: who you are, signed by Google, valid one hour. It is kept in
 *    memory only (never in any browser storage: this origin is
 *    shared with other project sites), never used past its expiry, and
 *    renewed by signing in again — silently when Google can, otherwise with
 *    the button, over the open panel, so nothing being edited is lost.
 * 3. window.AdminTransport: every A.call() goes to the Apps Script API
 *    (doPost) as text/plain JSON { fn, args, token }, no cookies. The
 *    server verifies the token with Google and checks the allowlist; this
 *    page decides nothing about access.
 * 4. Before the panel: the gate (sign in / not set up yet / not allowed),
 *    always on this same URL. The recovery admin (Apps Script) is a small
 *    link, never a redirect.
 *
 * Settings: admin/config.js.
 */

(function () {

  'use strict';

  /* ---------- 1. frames ---------- */

  if (window.top !== window.self) {
    document.documentElement.classList.add('is-framed');
    try {
      window.top.location.replace(window.location.href);
    }
    catch (error) {
      // sandboxed: we simply don't start
    }
    return;
  }

  var EXEC = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]{20,}\/exec$/;
  var CLIENT_ID = /^[\w-]+\.apps\.googleusercontent\.com$/;
  var GIS_SRC = 'https://accounts.google.com/gsi/client';
  var MARGIN_SECONDS = 60;     // a token this close to its end is renewed first

  var config = window.ADMIN_CONFIG || {};
  var API = EXEC.test(config.apiUrl || '') ? config.apiUrl : '';
  var CLIENT = CLIENT_ID.test(config.clientId || '') ? config.clientId : '';
  var FALLBACK = EXEC.test(config.fallbackUrl || '') ? config.fallbackUrl : '';

  var A = window.A;
  var gate = document.getElementById('gate');
  var panel = document.getElementById('gate-panel');
  var shell = document.getElementById('shell');

  var session = null;          // { token, email, exp }
  var phase = 'gate';          // 'gate' until the panel is open, then 'app'
  var gis = null;              // promise: google.accounts.id
  var waiting = null;          // a sign-in the panel is waiting for
  var reauth = null;           // the «ادخل تاني» dialog


  /* ---------- small DOM helpers (textContent only) ---------- */

  function h(tag, attrs) {

    var node = document.createElement(tag);

    Object.keys(attrs || {}).forEach(function (name) {
      var value = attrs[name];
      if (value === null || value === undefined || value === false) return;
      if (name === 'class') node.className = value;
      else if (name === 'text') node.textContent = value;
      else if (name.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? '' : String(value));
    });

    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }

    return node;

  }

  function glyph(name) {

    return A && A.icon ? A.icon(name) : null;

  }

  function appError(message, hint, details) {

    return new Error(JSON.stringify({ appError: 1, message: message, hint: hint || '', details: details || '', field: '' }));

  }

  function parsed(error) {

    if (A && A.parseError) return A.parseError(error);
    return { message: String(error && error.message || error), hint: '', details: '' };

  }


  /* ---------- the ID token ---------- */

  /* the token's own claims, for timing and display only (the server verifies) */
  function claimsOf(token) {

    try {
      var part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (part.length % 4) part += '=';
      var json = decodeURIComponent(Array.prototype.map.call(atob(part), function (c) {
        return '%' + ('0' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      var claims = JSON.parse(json);
      return claims && typeof claims.email === 'string' && isFinite(Number(claims.exp)) ? { email: claims.email.toLowerCase(), exp: Number(claims.exp) } : null;
    }
    catch (error) {
      return null;
    }

  }

  function fresh(value) {

    return !!(value && value.token && value.exp * 1000 - Date.now() > MARGIN_SECONDS * 1000);

  }

  /* memory only: a reload signs in again (silently when Google can) */
  function remember(value) {

    session = value;

  }


  /* ---------- Google Identity Services ---------- */

  function loadGis() {

    if (gis) return gis;

    gis = new Promise(function (resolve, reject) {

      function ready() {
        var id = window.google && window.google.accounts && window.google.accounts.id;
        if (!id) { reject(new Error('Google Identity Services did not load')); return; }
        var last = session && session.email;
        id.initialize({
          client_id: CLIENT,
          callback: onCredential,
          auto_select: true,
          cancel_on_tap_outside: false,
          context: 'signin',
          itp_support: true,
          use_fedcm_for_prompt: true,
          login_hint: last || undefined
        });
        resolve(id);
      }

      if (window.google && window.google.accounts && window.google.accounts.id) { ready(); return; }

      var script = h('script', { src: GIS_SRC, async: true });
      var timer = setTimeout(function () { reject(new Error('Google Identity Services: timed out')); }, 20000);
      script.addEventListener('load', function () { clearTimeout(timer); ready(); });
      script.addEventListener('error', function () { clearTimeout(timer); reject(new Error('Google Identity Services: could not load ' + GIS_SRC)); });
      document.head.appendChild(script);

    });

    // a failed load can be tried again
    gis.catch(function () { gis = null; });

    return gis;

  }

  function googleButton(host) {

    return loadGis().then(function (id) {
      host.replaceChildren();
      id.renderButton(host, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        logo_alignment: 'left',
        locale: 'ar',
        width: Math.max(220, Math.min(320, host.clientWidth || 300))
      });
      return id;
    });

  }

  function onCredential(response) {

    var token = response && response.credential;
    var claims = claimsOf(token);

    if (!claims) return;

    remember({ token: token, email: claims.email, exp: claims.exp });

    if (waiting) {
      var done = waiting;
      waiting = null;
      closeReauth();
      done.resolve(token);
    }

    if (phase === 'gate') enter();

  }


  /* ---------- 3. the transport ---------- */

  function post(name, args, token) {

    return fetch(API, {
      method: 'POST',
      // text/plain: a "simple" request, so no CORS preflight (Apps Script can't answer one)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: name, args: args || [], token: token }),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer'
    })
      .then(function (response) {
        if (!response.ok) {
          throw appError('خادم لوحة التحكم مردّش صح.', 'جرّب تاني بعد شوية.', 'HTTP ' + response.status);
        }
        return response.text();
      })
      .then(function (text) {
        var reply = null;
        try { reply = JSON.parse(text); }
        catch (error) { reply = null; }
        if (!reply || typeof reply !== 'object' || typeof reply.ok !== 'boolean') {
          throw appError('رد خادم لوحة التحكم مش مفهوم.', 'غالبًا نشر الـ API في Apps Script محتاج مراجعة (docs/ADMIN-SETUP.md).', String(text).slice(0, 300));
        }
        return reply;
      });

  }

  function failure(reply) {

    var error = new Error(reply.error || JSON.stringify({ appError: 1, message: 'حصلت مشكلة غير متوقعة.' }));
    error.apiCode = reply.code || '';
    return error;

  }

  /* a token that is still good, or a sign-in first */
  function token() {

    if (fresh(session)) return Promise.resolve(session.token);
    return signInAgain();

  }

  function call(name, args, retried) {

    return token()
      .then(function (value) { return post(name, args, value); })
      .then(function (reply) {
        if (reply.ok) return reply.result;
        if (reply.code === 'auth' && !retried) {
          // the server no longer takes this token: sign in again, then the same call
          remember(null);
          return call(name, args, true);
        }
        throw failure(reply);
      });

  }


  /* ---------- re-sign-in over the open panel ---------- */

  function signInAgain() {

    if (!waiting) {
      var deferred = {};
      deferred.promise = new Promise(function (resolve, reject) { deferred.resolve = resolve; deferred.reject = reject; });
      waiting = deferred;
      openReauth();
      // Google may sign the same account in again without a click
      loadGis().then(function (id) { id.prompt(); }).catch(function () {});
    }

    return waiting.promise;

  }

  function openReauth() {

    if (reauth) return;

    var host = h('div', { class: 'reauth__button' });
    var note = h('p', { class: 'reauth__error', role: 'alert', hidden: true });

    reauth = h('dialog', { class: 'modal modal--info reauth', 'aria-labelledby': 'reauth-title', 'aria-describedby': 'reauth-text' },
      h('span', { class: 'modal__icon', 'aria-hidden': 'true' }, glyph('user')),
      h('h2', { class: 'modal__title', id: 'reauth-title', text: 'الدخول محتاج يتجدد' }),
      h('p', { class: 'modal__text', id: 'reauth-text', text: 'ادخل تاني بحساب جوجل وكمّل من مكانك — اللي بتعدّله مش هيضيع.' }),
      host,
      note,
      h('div', { class: 'modal__actions' },
        h('button', { class: 'btn btn--ghost', type: 'button', text: 'مش دلوقتي', onclick: cancelReauth })
      )
    );

    reauth.addEventListener('cancel', function (event) { event.preventDefault(); cancelReauth(); });
    document.body.appendChild(reauth);
    reauth.showModal();

    googleButton(host).catch(function (error) {
      note.textContent = 'مقدرناش نفتح تسجيل الدخول بتاع جوجل. اتأكد من النت وجرّب تاني.';
      note.hidden = false;
      if (window.console) console.warn('[admin]', error.message);
    });

  }

  function closeReauth() {

    if (!reauth) return;
    var dialog = reauth;
    reauth = null;
    if (dialog.open) dialog.close();
    dialog.remove();

  }

  function cancelReauth() {

    closeReauth();
    if (waiting) {
      var done = waiting;
      waiting = null;
      done.reject(appError('لازم تدخل بحساب جوجل علشان تكمّل.', 'اللي بتعدّله لسه مفتوح: دوس حفظ تاني وادخل.'));
    }

  }


  /* ---------- 4. the gate ---------- */

  function fallbackLink(label, className) {

    return FALLBACK ? h('a', { class: className || 'gate__link', href: FALLBACK, rel: 'noreferrer', text: label }) : null;

  }

  function showGate(state, nodes) {

    gate.dataset.state = state;
    panel.replaceChildren.apply(panel, nodes.filter(Boolean));
    var small = document.getElementById('gate-fallback');
    var link = document.getElementById('fallback-link');
    if (small && link && FALLBACK) {
      link.href = FALLBACK;
      small.hidden = state === 'unconfigured' || state === 'preparing';
    }

  }

  function showLoading(text) {

    showGate('loading', [
      h('p', { class: 'gate__status', role: 'status' },
        h('span', { class: 'gate__line', 'aria-hidden': 'true' }, h('i')),
        h('span', { text: text }))
    ]);

  }

  function showSignIn(note) {

    var host = h('div', { class: 'gate__google' });

    showGate('signin', [
      h('h2', { class: 'gate__heading', text: 'ادخل بحساب جوجل' }),
      note ? h('p', { class: 'gate__note gate__note--warn', role: 'status', text: note }) : null,
      host,
      h('p', { class: 'gate__note', text: 'بحساب جوجل المسموح له بس. مفيش باسوردات.' })
    ]);

    googleButton(host)
      .then(function (id) { id.prompt(); })
      .catch(function (error) {
        showProblem('مقدرناش نفتح تسجيل الدخول بتاع جوجل.', 'اتأكد من النت، وإن المتصفح مش مانع accounts.google.com، وجرّب تاني.', error.message, function () { showSignIn(); });
      });

  }

  function showDenied(email) {

    var host = h('div', { class: 'gate__google' });

    showGate('denied', [
      h('div', { class: 'gate__message gate__message--danger', role: 'alert' },
        h('p', { class: 'gate__message-title', text: 'الحساب ده مش مسموح له يدخل لوحة التحكم.' }),
        email ? h('p', { class: 'gate__email', dir: 'ltr', text: email }) : null,
        h('p', { class: 'gate__message-hint', text: 'لو المفروض يكون مسموح لك، اطلب من أدمن يضيف الإيميل ده من «الإعدادات ← صلاحيات لوحة التحكم». أو ادخل بحساب تاني:' })
      ),
      host
    ]);

    loadGis().then(function (id) {
      // the next sign-in asks which account
      if (id.disableAutoSelect) id.disableAutoSelect();
      return googleButton(host);
    }).catch(function () {});

  }

  function showProblem(title, hint, details, retry) {

    showGate('problem', [
      h('div', { class: 'gate__message', role: 'alert' },
        h('p', { class: 'gate__message-title', text: title }),
        hint ? h('p', { class: 'gate__message-hint', text: hint }) : null,
        details ? h('details', { class: 'gate__details' }, h('summary', { text: 'تفاصيل تقنية' }), h('pre', { dir: 'ltr', text: details })) : null
      ),
      retry ? h('div', { class: 'gate__actions' }, h('button', { class: 'gate__btn', type: 'button', text: 'جرّب تاني', onclick: retry })) : null
    ]);

  }

  /* not set up yet: config.js has no client ID (or no API URL yet) */
  function showUnconfigured() {

    var preparing = !!CLIENT && !API;

    showGate(preparing ? 'preparing' : 'unconfigured', [
      h('div', { class: 'gate__message gate__message--info' },
        h('p', { class: 'gate__message-title', text: preparing ? 'لوحة التحكم لسه بتتجهز.' : 'لوحة التحكم هنا لسه مش متظبطة.' }),
        h('p', { class: 'gate__message-hint', text: preparing
          ? 'خطوة النشر الأخيرة لسه ما خلصتش. لحد ما تخلص، استخدم لوحة الطوارئ — نفس اللوحة ونفس البيانات.'
          : 'محتاجة إعداد مرة واحدة (تسجيل الدخول بجوجل). لحد ما يتعمل، استخدم لوحة الطوارئ — نفس اللوحة ونفس البيانات.' })
      ),
      FALLBACK ? h('div', { class: 'gate__actions' }, fallbackLink('افتح لوحة الطوارئ (Apps Script)', 'gate__btn')) : null
    ]);

  }


  /* ---------- into the panel ---------- */

  /* checks the sign-in with the server and loads the panel in one call */
  function enter() {

    var current = session;

    showLoading('بنفتح لوحة التحكم…');

    post('apiState', [], current.token)
      .then(function (reply) {
        if (session !== current) return;
        if (reply.ok) { open(reply.result); return; }

        var details = parsed(failure(reply));

        if (reply.code === 'denied') {
          remember(null);
          showDenied(current.email);
        }
        else if (reply.code === 'auth') {
          remember(null);
          showProblem('جوجل دخّلك، بس خادم لوحة التحكم مقبلش الدخول.', 'غالبًا ADMIN_CLIENT_ID في Script Properties مش نفس clientId في admin/config.js (docs/ADMIN-SETUP.md).', details.message, function () { showSignIn(); });
        }
        else if (reply.code === 'config') {
          showProblem(details.message, details.hint, '', function () { enter(); });
        }
        else {
          showProblem(details.message, details.hint, details.details, function () { enter(); });
        }
      })
      .catch(function (error) {
        if (session !== current) return;
        var info = parsed(error);
        showProblem(info.message, info.hint, info.details, function () { enter(); });
      });

  }

  function open(state) {

    phase = 'app';
    window.AdminTransport = { call: call };
    A.signOut = signOut;
    gate.hidden = true;
    shell.hidden = false;
    document.body.classList.remove('is-gated');
    A.start(state);

  }

  function signOut() {

    A.confirmLeave().then(function (ok) {
      if (!ok) return;
      A.dirty = false;
      remember(null);
      try {
        if (window.google && window.google.accounts && window.google.accounts.id) window.google.accounts.id.disableAutoSelect();
      }
      catch (error) {
        // signed out here anyway
      }
      // the same URL, from the start (the sign-in screen)
      window.location.reload();
    });

  }


  /* ---------- start ---------- */

  if (!A || !A.start) {
    showProblem('لوحة التحكم مفتحتش.', 'اعمل Refresh للصفحة.', 'admin-app.js did not load', function () { window.location.reload(); });
    return;
  }

  if (!CLIENT || !API) {
    showUnconfigured();
    return;
  }

  showLoading('بنجهز تسجيل الدخول…');
  showSignIn();

})();
