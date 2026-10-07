/*
 * THE OFFICIAL ADMIN PAGE: sign-in, the line to the server, working together.
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
 *    (doPost) as text/plain JSON { fn, args, token, sid }, no cookies. The
 *    server verifies the token with Google, checks the allowlist, and that
 *    sid is this account's one live session (apps-script/Presence.gs); this
 *    page decides nothing about access.
 * 4. Before the panel: the gate, always on this same URL, one stage at a
 *    time — loading Google → waiting for the sign-in → asking the server →
 *    drawing the panel. Every stage has a watchdog: "slower than usual"
 *    first, then a clear Arabic message with «جرّب تاني», never a blank
 *    page. Once Google answers, the gate says «جاري التحقق...» (with the
 *    account) while the server and the panel get ready, and closes
 *    Google's own prompt. The gate goes away only once the panel is drawn
 *    AND measured on screen (reveal()); a request the browser itself
 *    dropped (a phone freezing the tab behind Google's sign-in) is a
 *    «جرّب تاني», never a page left waiting. The recovery admin (Apps
 *    Script) is a small link, never a redirect.
 * 5. One session per Google account: signing in asks the server for a
 *    session; if the account is live on another device the gate asks
 *    before taking over. A tab that was taken over goes back to the gate.
 * 6. Working together (A.collab): a heartbeat every ~25 s while the page is
 *    visible says where this admin is and which item it edits, keeps the
 *    edit locks, and brings back who else is online.
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
  var TIMING = timing(config.timing);

  var A = window.A;
  var gate = document.getElementById('gate');
  var panel = document.getElementById('gate-panel');
  var shell = document.getElementById('shell');

  var session = null;          // { token, email, exp } — memory only
  var sid = '';                // this tab's server session — memory only
  var TAB = randomId();        // this page load: a retry from here is never "another device"
  var DEVICE = deviceLabel();
  var phase = 'gate';          // 'gate' until the panel is drawn, then 'app'
  var attempt = 0;             // the gate's current try: answers to older ones are ignored
  var controller = null;       // aborts the gate's request when a newer try starts
  var gis = null;              // promise: google.accounts.id
  var gisTries = 0;
  var waiting = null;          // a sign-in the panel is waiting for
  var reauth = null;           // the «ادخل تاني» dialog
  var restarting = null;       // a quiet new session (the server forgot this one)
  var verifying = '';          // the account the gate is verifying now («جاري التحقق...»)


  /*
   * How long each stage may take, in ms. config.timing may shorten them
   * (the end-to-end tests do); real pages leave it out.
   */
  function timing(custom) {

    var base = {
      gisSlow: 6000,      // Google's script: "slower than usual" …
      gisFail: 20000,     // … then a message and «جرّب تاني»
      button: 8000,       // the Google button should be on screen by now
      silent: 5000,       // how long the "signing you in" hint may stay
      slow: 7000,         // the server: "slower than usual" (a cold start takes ~5–15 s) …
      fail: 45000,        // … then the request is aborted: message and «جرّب تاني»
      render: 15000,      // drawing the panel
      beat: 25000,        // the heartbeat, while the page is visible
      beatFail: 20000     // a heartbeat that takes longer is dropped
    };

    if (custom && typeof custom === 'object') {
      Object.keys(base).forEach(function (key) {
        var value = Number(custom[key]);
        if (isFinite(value) && value >= 50 && value <= 600000) base[key] = value;
      });
    }

    return base;

  }


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

  function ago(seconds) {

    return A && A.ago ? A.ago(seconds) : '';

  }

  function watchdog(ms, fn) {

    var timer = setTimeout(fn, ms);
    return function () { clearTimeout(timer); };

  }

  function randomId() {

    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');

  }

  /* «موبايل أندرويد – Chrome», «كمبيوتر ويندوز – Edge»: coarse, nothing that identifies anyone */
  function deviceLabel() {

    var ua = navigator.userAgent || '';
    var data = navigator.userAgentData;
    var touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    var tablet = /iPad|Tablet/i.test(ua) || touchMac || (/Android/i.test(ua) && !/Mobile/i.test(ua));
    var mobile = (data && data.mobile === true) || /Mobi|iPhone|iPod/i.test(ua);
    var os = /Android/i.test(ua) ? 'أندرويد'
      : /iPhone|iPod/i.test(ua) ? 'آيفون'
      : /iPad/i.test(ua) || touchMac ? 'آيباد'
      : /Windows/i.test(ua) ? 'ويندوز'
      : /CrOS/.test(ua) ? 'كروم بوك'
      : /Mac OS X|Macintosh/i.test(ua) ? 'ماك'
      : /Linux/i.test(ua) ? 'لينكس' : '';
    var browser = /Edg(A|iOS)?\//.test(ua) ? 'Edge'
      : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
      : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /Firefox|FxiOS/.test(ua) ? 'Firefox'
      : /CriOS|Chrome\//.test(ua) ? 'Chrome'
      : /Safari/.test(ua) ? 'Safari' : '';
    var kind = tablet ? 'تابلت' : mobile ? 'موبايل' : 'كمبيوتر';
    var label = os === 'آيفون' || os === 'آيباد' ? os : kind + (os ? ' ' + os : '');

    return (label + (browser ? ' – ' + browser : '')).slice(0, 40);

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

      // a retry asks again for real: a stalled first request would hold up the same URL
      var script = h('script', { src: GIS_SRC + (gisTries++ ? '?retry=' + gisTries : ''), async: true });
      var timer = setTimeout(function () {
        script.remove();
        reject(new Error('Google Identity Services: timed out after ' + Math.round(TIMING.gisFail / 1000) + ' s'));
      }, TIMING.gisFail);
      script.addEventListener('load', function () { clearTimeout(timer); ready(); });
      script.addEventListener('error', function () { clearTimeout(timer); script.remove(); reject(new Error('Google Identity Services: could not load ' + GIS_SRC)); });
      document.head.appendChild(script);

    });

    // a failed load can be tried again
    gis.catch(function () { gis = null; });

    return gis;

  }

  function googleButton(host) {

    return loadGis().then(function (id) {
      renderButton(host, id);
      return id;
    });

  }

  function renderButton(host, id) {

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

  }

  /*
   * Google may sign a returning admin in without a click (auto-select). The
   * button is on screen anyway; the prompt's notifications only tidy up the
   * hint, and nothing waits for them (FedCM reports little, and on some
   * phones nothing comes back at all).
   */
  function quietPrompt(id, hint) {

    var shown = false;
    var stop = function () {};

    function done() {
      stop();
      if (hint && shown) hint.hidden = true;
    }

    if (hint) {
      hint.textContent = 'جاري التحقق... لو دخلت قبل كده، جوجل هيدخّلك لوحده — أو دوس على الزرار.';
      hint.hidden = false;
      shown = true;
      stop = watchdog(TIMING.silent, done);
    }

    try {
      id.prompt(function (moment) {
        try {
          if (!moment) return;
          if ((moment.isNotDisplayed && moment.isNotDisplayed()) ||
              (moment.isSkippedMoment && moment.isSkippedMoment()) ||
              (moment.isDismissedMoment && moment.isDismissedMoment())) {
            done();
          }
        }
        catch (ignored) {
          done();
        }
      });
    }
    catch (error) {
      done();
    }

  }

  function onCredential(response) {

    var token = response && response.credential;
    var claims = claimsOf(token);

    if (!claims) {
      if (phase === 'gate' && !waiting) {
        showProblem('جوجل رجّع دخول مش مفهوم.', 'جرّب تدخل تاني.', '', function () { showSignIn(); });
      }
      return;
    }

    remember({ token: token, email: claims.email, exp: claims.exp });

    // Google's own prompt (One Tap / FedCM) has done its job: close it, so
    // nothing of Google's stays over the page while we verify
    cancelPrompt();

    if (waiting) {
      var done = waiting;
      waiting = null;
      closeReauth();
      done.resolve(token);
    }

    if (phase !== 'gate') return;

    // Google may answer twice (auto-select, then the prompt): the same
    // account already being verified is not a new try
    if (verifying === claims.email && gate.dataset.state === 'loading') return;

    enter();

  }

  function cancelPrompt() {

    try {
      if (window.google && window.google.accounts && window.google.accounts.id && window.google.accounts.id.cancel) {
        window.google.accounts.id.cancel();
      }
    }
    catch (ignored) {
      // nothing open
    }

  }


  /* ---------- 3. the transport ---------- */

  /*
   * One request. options.timeout aborts it (an AbortController: no request
   * is left hanging); options.signal aborts it from outside (a newer try).
   */
  function post(name, args, tokenValue, sidValue, options) {

    options = options || {};

    var abort = typeof AbortController === 'function' ? new AbortController() : null;
    var timedOut = false;
    var timer = null;
    var body = { fn: name, args: args || [], token: tokenValue };

    if (sidValue) body.sid = sidValue;

    if (abort && options.signal) {
      if (options.signal.aborted) abort.abort();
      else options.signal.addEventListener('abort', function () { abort.abort(); });
    }

    if (abort && options.timeout) {
      timer = setTimeout(function () { timedOut = true; abort.abort(); }, options.timeout);
    }

    function finish() {
      if (timer) clearTimeout(timer);
    }

    return fetch(API, {
      method: 'POST',
      // text/plain: a "simple" request, so no CORS preflight (Apps Script can't answer one)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: abort ? abort.signal : undefined
    })
      .then(function (response) {
        if (!response.ok) {
          throw appError('خادم لوحة التحكم مردّش صح.', 'جرّب تاني بعد شوية.', 'HTTP ' + response.status);
        }
        return response.text();
      })
      .then(function (text) {
        finish();
        var reply = null;
        try { reply = JSON.parse(text); }
        catch (error) { reply = null; }
        if (!reply || typeof reply !== 'object' || typeof reply.ok !== 'boolean') {
          throw appError('رد خادم لوحة التحكم مش مفهوم.', 'غالبًا نشر الـ API في Apps Script محتاج مراجعة (docs/ADMIN-SETUP.md).', String(text).slice(0, 300));
        }
        return reply;
      }, function (error) {
        finish();
        if (timedOut) {
          var late = appError('خادم لوحة التحكم مردّش في الوقت المعتاد.', 'ممكن النت ضعيف، أو الخادم لسه بيصحى. جرّب تاني.', name + ': no answer after ' + Math.round(options.timeout / 1000) + ' s');
          late.timeout = true;
          throw late;
        }
        if (error && error.name === 'AbortError') error.aborted = true;
        throw error;
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

    retried = retried || {};

    if (!sid) {
      return Promise.reject(appError('لوحة التحكم مقفولة دلوقتي.', 'ادخل تاني.'));
    }

    return token()
      .then(function (value) { return post(name, args, value, sid); })
      .then(function (reply) {
        if (reply.ok) return reply.result;
        if (reply.code === 'auth' && !retried.auth) {
          // the server no longer takes this token: sign in again, then the same call
          remember(null);
          return call(name, args, { auth: true, session: retried.session });
        }
        if (reply.code === 'session_expired' && !retried.session) {
          // the server forgot this session (signed out elsewhere, or its cache): a new one, then the same call
          return restart().then(function () { return call(name, args, { auth: retried.auth, session: true }); });
        }
        if (reply.code === 'session_replaced') revoke(reply);
        throw failure(reply);
      });

  }

  /* a new session for the open panel, without asking (nobody else is live), or the takeover question */
  function restart() {

    if (restarting) return restarting;

    restarting = token()
      .then(function (value) { return post('apiSessionStart', [{ device: DEVICE, tab: TAB, state: false }], value, '', { timeout: TIMING.fail }); })
      .then(function (reply) {
        var result = reply.ok && reply.result || {};
        if (result.sid) {
          sid = result.sid;
          collab.soon();
          return;
        }
        if (result.active) {
          toGate();
          showSessionActive(result.active);
          throw appError('الحساب ده شغال دلوقتي على جهاز تاني.', 'ادخل تاني من هنا لو عايز تكمّل.');
        }
        throw failure(reply);
      });

    restarting.then(function () { restarting = null; }, function () { restarting = null; });

    return restarting;

  }


  /* ---------- re-sign-in over the open panel ---------- */

  function signInAgain() {

    if (!waiting) {
      var deferred = {};
      deferred.promise = new Promise(function (resolve, reject) { deferred.resolve = resolve; deferred.reject = reject; });
      waiting = deferred;
      openReauth();
      // Google may sign the same account in again without a click
      loadGis().then(function (id) { quietPrompt(id, null); }).catch(function () {});
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

  /* state: what the gate says; stage: where the sign-in is (loading only) */
  function showGate(state, nodes, stage) {

    if (state !== 'loading') verifying = '';
    // before the panel, the gate is always on screen (never a blank page)
    if (phase === 'gate') gate.hidden = false;
    gate.dataset.state = state;
    if (stage) gate.dataset.stage = stage;
    else delete gate.dataset.stage;
    delete gate.dataset.slow;
    panel.replaceChildren.apply(panel, nodes.filter(Boolean));
    var small = document.getElementById('gate-fallback');
    var link = document.getElementById('fallback-link');
    if (small && link && FALLBACK) {
      link.href = FALLBACK;
      small.hidden = state === 'unconfigured' || state === 'preparing';
    }

  }

  /* a newer try: the old one's request stops, its answers are ignored */
  function nextAttempt() {

    if (controller) controller.abort();
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    return ++attempt;

  }

  /*
   * Google said who you are; now the server and the panel: «جاري التحقق...»
   * with the account and the step, on the sign-in screen itself. It stays
   * until the panel is drawn; anything that stalls turns into «جرّب تاني».
   */
  function showVerifying(step, stage) {

    var note = h('p', { class: 'gate__note gate__note--slow', role: 'status', hidden: true });
    var email = session && session.email || '';

    showGate('loading', [
      h('h2', { class: 'gate__heading', text: 'ادخل بحساب جوجل' }),
      h('p', { class: 'gate__status', role: 'status' },
        h('span', { class: 'gate__line', 'aria-hidden': 'true' }, h('i')),
        h('span', { class: 'gate__verify', text: 'جاري التحقق...' })),
      email ? h('p', { class: 'gate__email', dir: 'ltr', text: email }) : null,
      h('p', { class: 'gate__note gate__step', text: step }),
      note
    ], stage);

    verifying = email;

    return {
      slow: function (message) {
        note.textContent = message;
        note.hidden = false;
        gate.dataset.slow = '1';
      }
    };

  }

  /* options.silent === false: no automatic sign-in (after «إلغاء») */
  function showSignIn(note, options) {

    options = options || {};

    var my = nextAttempt();
    var host = h('div', { class: 'gate__google' },
      h('p', { class: 'gate__status', role: 'status' },
        h('span', { class: 'gate__line', 'aria-hidden': 'true' }, h('i')),
        h('span', { text: 'بنجهز زرار جوجل…' })));
    var hint = h('p', { class: 'gate__note gate__note--slow', role: 'status', hidden: true });

    showGate('signin', [
      h('h2', { class: 'gate__heading', text: 'ادخل بحساب جوجل' }),
      note ? h('p', { class: 'gate__note gate__note--warn', role: 'status', text: note }) : null,
      host,
      hint,
      h('p', { class: 'gate__note', text: 'بحساب جوجل المسموح له بس. مفيش باسوردات.' })
    ], 'google');

    var stopSlow = watchdog(TIMING.gisSlow, function () {
      if (my !== attempt) return;
      hint.textContent = 'جوجل بياخد وقت أطول من العادي… لو النت ضعيف استنى شوية.';
      hint.hidden = false;
    });

    loadGis()
      .then(function (id) {
        stopSlow();
        if (my !== attempt) return;
        hint.hidden = true;
        renderButton(host, id);
        gate.dataset.stage = 'signin';

        // the button should be there by now (a blocked Google frame, a broken network): say so
        watchdog(TIMING.button, function () {
          if (my !== attempt || host.offsetHeight > 20) return;
          hint.replaceChildren(
            document.createTextNode('زرار جوجل مظهرش. '),
            h('button', { class: 'gate__link gate__link--button', type: 'button', text: 'جرّب تاني', onclick: function () { showSignIn(note, options); } })
          );
          hint.hidden = false;
        });

        if (options.silent !== false) quietPrompt(id, hint);
      })
      .catch(function (error) {
        stopSlow();
        if (my !== attempt) return;
        showProblem('مقدرناش نفتح تسجيل الدخول بتاع جوجل.', 'اتأكد من النت، وإن المتصفح مش مانع accounts.google.com، وجرّب تاني.', error.message, function () { showSignIn(note, options); });
      });

  }

  function showDenied(email) {

    var host = h('div', { class: 'gate__google' });

    nextAttempt();
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

    nextAttempt();
    showGate('problem', [
      h('div', { class: 'gate__message', role: 'alert' },
        h('p', { class: 'gate__message-title', text: title }),
        hint ? h('p', { class: 'gate__message-hint', text: hint }) : null,
        details ? h('details', { class: 'gate__details' }, h('summary', { text: 'تفاصيل تقنية' }), h('pre', { dir: 'ltr', text: details })) : null
      ),
      retry ? h('div', { class: 'gate__actions' }, h('button', { class: 'gate__btn', type: 'button', text: 'جرّب تاني', onclick: retry })) : null
    ]);

  }

  /* this account is live on another device or tab */
  function showSessionActive(active) {

    nextAttempt();
    showGate('session-active', [
      h('div', { class: 'gate__message gate__message--info', role: 'alert' },
        h('p', { class: 'gate__message-title', text: 'الحساب ده شغال دلوقتي على جهاز تاني.' }),
        h('p', { class: 'gate__device' }, glyph('globe'), h('span', { text: active.device || 'جهاز تاني' })),
        h('p', { class: 'gate__message-hint', text: 'آخر نشاط ' + ago(active.seen) + ' · داخل ' + ago(active.since) + '.' }),
        h('p', { class: 'gate__message-hint', text: 'لو دخلت هنا، الجهاز التاني هيخرج على طول، واللي مش محفوظ عليه هيضيع.' })
      ),
      h('div', { class: 'gate__actions gate__actions--stack' },
        h('button', { class: 'gate__btn', type: 'button', text: 'إنهاء الجلسة الأخرى والدخول هنا', onclick: function () { enter({ force: true }); } }),
        h('button', { class: 'gate__btn gate__btn--ghost', type: 'button', text: 'إلغاء', onclick: function () {
          showSignIn('تمام — الجهاز التاني فضل شغال. تقدر تدخل هنا وقت ما تحب.', { silent: false });
        } })
      )
    ]);

  }

  /* this tab was taken over (or the server lost it): back at the gate */
  function showRevoked(message, hint) {

    nextAttempt();
    showGate('revoked', [
      h('div', { class: 'gate__message gate__message--danger', role: 'alert' },
        h('p', { class: 'gate__message-title', text: message || 'الجلسة اتقفلت لأنك دخلت من جهاز تاني.' }),
        h('p', { class: 'gate__message-hint', text: hint || 'لو عايز تكمّل من هنا، ادخل تاني — الجهاز التاني هيخرج.' })
      ),
      h('div', { class: 'gate__actions' },
        h('button', { class: 'gate__btn', type: 'button', text: 'ادخل من هنا تاني', onclick: function () {
          if (fresh(session)) enter();
          else showSignIn();
        } })
      )
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

  /*
   * Asks the server for this tab's session; the answer brings the panel's
   * state too (one round trip). options.force: end the other session.
   * Safe to repeat (a retry): an older try's answer is dropped, and the
   * server knows this page load (TAB), so it never asks about "another device".
   */
  function enter(options) {

    options = options || {};

    var current = session;

    if (!fresh(current)) {
      showSignIn('الدخول انتهى. ادخل تاني.');
      return;
    }

    var my = nextAttempt();
    var signal = controller ? controller.signal : undefined;
    var view = showVerifying(options.force ? 'بنقفل الجلسة التانية وبنفتح هنا…' : 'بنفتح لوحة التحكم…', 'server');
    var stopSlow = watchdog(TIMING.slow, function () {
      if (my !== attempt) return;
      view.slow('بياخد وقت أطول من العادي… الخادم بيصحى لو بقاله فترة من غير استخدام، وده ممكن ياخد لحد ١٥ ثانية.');
    });

    post('apiSessionStart', [{ device: DEVICE, tab: TAB, force: options.force === true }], current.token, '', { timeout: TIMING.fail, signal: signal })
      .then(function (reply) {
        stopSlow();
        if (my !== attempt) return;
        if (!reply.ok) { refused(reply, current, options); return; }

        var result = reply.result || {};

        if (result.active) {
          showSessionActive(result.active);
          return;
        }

        if (!result.sid || !result.state) {
          showProblem('رد خادم لوحة التحكم مش مفهوم.', 'غالبًا نشر الـ API في Apps Script محتاج يتحدّث (docs/ADMIN-SETUP.md).', JSON.stringify(result).slice(0, 200), function () { enter(options); });
          return;
        }

        sid = result.sid;
        openPanel(result.state, my);
      })
      .catch(function (error) {
        stopSlow();
        // a newer try took over: its own answer decides
        if (my !== attempt) return;
        // stopped by the browser itself (the tab was frozen or put away while
        // Google's sign-in was in front): never a page left waiting — try again
        var info = error.aborted
          ? { message: 'الاتصال بخادم لوحة التحكم اتقطع.', hint: 'جرّب تاني.', details: 'apiSessionStart: aborted by the browser' }
          : parsed(error);
        showProblem(info.message, info.hint, info.details, function () { enter(options); });
      });

  }

  function refused(reply, current, options) {

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
      showProblem(details.message, details.hint, '', function () { enter(options); });
    }
    else {
      showProblem(details.message, details.hint, details.details, function () { enter(options); });
    }

  }

  /* draws the panel behind the gate; the gate goes only once it is drawn */
  function openPanel(state, my) {

    showVerifying('بنجهز اللوحة…', 'dashboard');

    window.AdminTransport = { call: call };
    A.signOut = signOut;
    A.collab = collab.api;

    var settled = false;
    var stop = watchdog(TIMING.render, function () {
      if (settled || my !== attempt) return;
      settled = true;
      showProblem('اللوحة بتاخد وقت طويل تتفتح.', 'جرّب تاني. لو فضلت كده، استخدم لوحة الطوارئ.', 'render: no answer after ' + Math.round(TIMING.render / 1000) + ' s', function () { enter(); });
    });

    var drawn;

    try {
      drawn = A.start(state);
    }
    catch (error) {
      if (window.console) console.error('[admin] start', error);
      drawn = false;
    }

    Promise.resolve(drawn).then(function (ok) {
      stop();
      if (settled || my !== attempt) return;
      settled = true;
      if (ok === false) {
        showProblem('لوحة التحكم مفتحتش.', 'جرّب تاني. لو المشكلة فضلت، استخدم لوحة الطوارئ.', '', function () { enter(); });
        return;
      }
      var blank = reveal();
      if (blank) {
        showProblem('لوحة التحكم مظهرتش على الشاشة.', 'جرّب تاني. لو المشكلة فضلت، استخدم لوحة الطوارئ.', 'render: ' + blank, function () { enter(); });
        return;
      }
      phase = 'app';
      collab.begin();
    });

  }

  /*
   * The gate → the panel, in one go (no frame is painted in between): the
   * panel is shown and measured first; only a panel that really has
   * something on screen replaces the gate. Returns '' when it did, else
   * what was wrong (the gate stays, the panel is hidden again).
   */
  function reveal() {

    var view = document.getElementById('view');

    shell.hidden = false;

    var box = view ? view.getBoundingClientRect() : null;
    var problem = !view ? 'no #view'
      : !view.childElementCount ? 'the view is empty'
      : !(box.width > 0 && box.height > 0) ? 'the view has no size (' + Math.round(box.width) + '×' + Math.round(box.height) + ')'
      : '';

    if (problem) {
      shell.hidden = true;
      return problem;
    }

    gate.hidden = true;
    document.body.classList.remove('is-gated');

    return '';

  }

  /* from the open panel back to the gate (taken over, or the session can't go on) */
  function toGate() {

    if (phase !== 'app') return;

    collab.stop();
    sid = '';
    phase = 'gate';
    A.dirty = false;
    closeReauth();
    Array.prototype.forEach.call(document.querySelectorAll('dialog[open]'), function (dialog) {
      try { dialog.close(); }
      catch (ignored) { /* closed anyway */ }
      if (dialog.id !== 'sheet') dialog.remove();
    });
    shell.hidden = true;
    gate.hidden = false;
    document.body.classList.add('is-gated');
    window.scrollTo(0, 0);

  }

  function revoke(reply) {

    if (phase !== 'app') return;
    var info = parsed(failure(reply));
    toGate();
    showRevoked(info.message, info.hint);

  }

  function signOut() {

    A.confirmLeave().then(function (ok) {
      if (!ok) return;
      A.dirty = false;
      var ending = sid && fresh(session)
        ? post('apiSessionEnd', [], session.token, sid, { timeout: 4000 }).catch(function () {})
        : Promise.resolve();
      collab.stop();
      sid = '';
      ending.then(function () {
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
    });

  }


  /* ---------- 6. working together: heartbeat, presence, edit locks ---------- */

  var collab = (function () {

    var running = false;
    var timer = null;
    var inflight = false;
    var again = false;
    var lastBeat = 0;
    var place = { area: '', view: '' };
    var handles = [];   // { keys, info, onStatus }

    function schedule(ms) {
      clearTimeout(timer);
      if (running) timer = setTimeout(beat, ms);
    }

    /* soon, not now: an editor closing and the next one opening are one beat */
    function soon() {
      schedule(250);
    }

    function lockKeys() {
      var keys = [];
      handles.forEach(function (handle) {
        handle.keys.forEach(function (key) {
          if (keys.indexOf(key) === -1 && keys.length < 6) keys.push(key);
        });
      });
      return keys;
    }

    /* what this admin is editing: the newest lock it holds (an editor over a settings card); only reading one isn't editing */
    function editing() {
      for (var i = handles.length - 1; i >= 0; i--) {
        var info = handles[i].info;
        if (!handles[i].denied) return { kind: info.kind || '', id: info.id || '', label: info.label || '' };
      }
      return null;
    }

    function statusOf(handle, locks) {
      var denied = null;
      for (var i = 0; i < handle.keys.length; i++) {
        var status = locks[handle.keys[i]];
        if (!status) return null;   // asked for after this beat left: the next one answers
        if (!status.granted && !denied) denied = status;
      }
      return denied || { granted: true };
    }

    function apply(result) {
      if (A.renderPresence) A.renderPresence(result.others || []);
      // a long publish held the server's lock: nothing decided about locks this time
      if (result.busy) return;
      var locks = result.locks || {};
      handles.slice().forEach(function (handle) {
        var status = statusOf(handle, locks);
        if (!status || handles.indexOf(handle) === -1) return;
        handle.denied = !status.granted;
        handle.onStatus(status);
      });
    }

    function beat() {

      clearTimeout(timer);

      if (!running || !sid) return;
      // paused while hidden; visibilitychange brings it back
      if (document.visibilityState === 'hidden') return;
      if (inflight) { again = true; return; }
      // never a sign-in prompt from the background: the next thing the admin does renews the token
      if (!fresh(session)) { schedule(TIMING.beat); return; }

      inflight = true;
      lastBeat = Date.now();

      post('apiHeartbeat', [{ area: place.area, view: place.view, item: editing(), locks: lockKeys() }], session.token, sid, { timeout: TIMING.beatFail })
        .then(function (reply) {
          if (!running) return;
          if (reply.ok) apply(reply.result || {});
          else if (reply.code === 'session_replaced') revoke(reply);
          else if (reply.code === 'session_expired') restart().catch(function () {});
        })
        .catch(function () {
          // offline for a moment: the next beat
        })
        .then(function () {
          inflight = false;
          if (!running) return;
          if (again) { again = false; schedule(0); }
          else schedule(TIMING.beat);
        });

    }

    document.addEventListener('visibilitychange', function () {
      if (!running) return;
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastBeat > 3000) beat();
        else schedule(TIMING.beat);
      }
      else {
        clearTimeout(timer);
      }
    });

    // leaving (reload, closing the tab, sign-in elsewhere in this tab): end the session now.
    // Best effort: if it never arrives, the session and its locks run out by themselves.
    window.addEventListener('pagehide', function () {
      if (!sid || !fresh(session) || !navigator.sendBeacon) return;
      try {
        navigator.sendBeacon(API, new Blob([JSON.stringify({ fn: 'apiSessionEnd', args: [], token: session.token, sid: sid })], { type: 'text/plain;charset=utf-8' }));
      }
      catch (ignored) {
        // the locks run out by themselves
      }
    });

    // back from the back/forward cache: the server ended that session; the beat finds out and starts a new one
    window.addEventListener('pageshow', function (event) {
      if (event.persisted && running) beat();
    });

    return {
      begin: function () {
        running = true;
        beat();
      },
      stop: function () {
        running = false;
        clearTimeout(timer);
        handles = [];
        if (A.renderPresence) A.renderPresence([]);
      },
      soon: function () {
        if (running) soon();
      },
      api: {
        /* info: { key | keys, kind, id, label }; onStatus({ granted } | { granted: false, holder }) */
        lock: function (info, onStatus) {
          var handle = { keys: info.keys || [info.key], info: info, onStatus: onStatus };
          handles.push(handle);
          if (running) soon();
          return {
            release: function () {
              var index = handles.indexOf(handle);
              if (index === -1) return;
              handles.splice(index, 1);
              if (running) soon();
            }
          };
        },
        where: function (area, view) {
          place = { area: area || '', view: view || '' };
        }
      }
    };

  })();


  /* ---------- start ---------- */

  if (!A || !A.start) {
    showProblem('لوحة التحكم مفتحتش.', 'اعمل Refresh للصفحة.', 'admin-app.js did not load', function () { window.location.reload(); });
    return;
  }

  if (!CLIENT || !API) {
    showUnconfigured();
    return;
  }

  // back from the back/forward cache while still at the gate: whatever was
  // in flight is gone, so verify again (or show the button) — never a page
  // left on «جاري التحقق...»
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted || phase !== 'gate' || gate.dataset.state !== 'loading') return;
    if (fresh(session)) enter();
    else showSignIn();
  });

  showSignIn();

})();
