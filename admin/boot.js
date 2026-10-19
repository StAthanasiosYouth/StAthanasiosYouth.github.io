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
 *    page decides nothing about access. window.AdminWorker: the same for
 *    the new backend (config.workerUrl, «الحجوزات»): JSON with the Google
 *    ID token as a Bearer header, retried with the same Idempotency-Key.
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
 * 7. A reload is almost invisible: this tab's sessionStorage keeps ONLY the
 *    server's opaque session id (with this page load's id), where the admin
 *    was, and unsaved editor values (A.keep, A.restore in AdminScript) —
 *    never the token, nothing from Google. Leaving parks the session (a
 *    beacon); the next page load shows only «جاري استعادة الجلسة...», gets a
 *    fresh token from Google (silently when it can, else its button right
 *    there), and apiSessionResume picks up the SAME session: no takeover
 *    question, locks and presence kept. The sid alone opens nothing: every
 *    call still needs the token. Expired → the usual sign-in; replaced →
 *    «الجلسة اتقفلت…».
 * 8. Links into the panel (#open/…, #activity/…): from admin notifications
 *    (admin/sw.js) — followed once the panel is drawn (A.openLink).
 * 9. The admin app (window.AdminApp): install, its own service worker
 *    (/admin/sw.js, scope /admin/, separate from the site's /sw.js), and
 *    this device's admin notifications (admin/push.js, loaded on demand).
 *    The heartbeat also brings what the other admins just did: in-panel
 *    toasts (A.activityToasts) instead of a push while the panel is open.
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
  var WORKER = /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(config.workerUrl || '') ? config.workerUrl : '';
  var TIMING = timing(config.timing);

  var A = window.A;
  var gate = document.getElementById('gate');
  var panel = document.getElementById('gate-panel');
  var shell = document.getElementById('shell');

  var session = null;          // { token, email, exp } — memory only
  var sid = '';                // this tab's server session — memory only
  var TAB = randomId();        // this page load: a retry from here is never "another device"
  // opened from the admin app's own icon: its manifest start_url is /admin/?app=admin
  // (kept in the address through reloads and links; a tab or another app has no such mark)
  var LAUNCHED = /(?:^|[?&])app=admin(?:&|$)/.test(window.location.search.slice(1));
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
  var saved = null;            // { sid, tab, left } this tab had before a reload: to resume
  var restoring = false;       // the compact «جاري استعادة الجلسة...» gate is in charge


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

    // the installed admin app (its own window), not a browser tab
    if (appMode() === 'admin-app') browser = 'التطبيق';

    return (label + (browser ? ' – ' + browser : '')).slice(0, 40);

  }


  /* opened as the installed admin app (its own window, from the home screen) */
  function standalone() {

    try {
      return !!((window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: window-controls-overlay)').matches)) ||
        window.navigator.standalone === true);
    }
    catch (ignored) {
      return false;
    }

  }

  /*
   * Where this page runs, as far as the platform lets us know:
   *  'admin-app'  its own window AND opened from the admin app's icon (the
   *               manifest's start_url mark): the installed «لوحة تحكم الأسرة»
   *  'other-app'  an app window without that mark: possibly another app that
   *               holds /admin/ (an old site app whose scope was "/"), a
   *               shortcut, or the admin app opened from a plain link —
   *               never claimed to be the admin app
   *  'browser'    a normal browser tab
   */
  function appMode() {

    if (!standalone()) return 'browser';
    return LAUNCHED ? 'admin-app' : 'other-app';

  }

  /* 'ios' | 'android' | 'desktop' (for the install help and the device list) */
  function platform() {

    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';

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
    // signed out / another account: the Worker credential of the old one goes with it
    if (!value || (wkCache && wkCache.email && wkCache.email !== value.email)) wkCache = null;

  }


  /* ---------- 7. this tab's storage: the sid, where you were, unsaved edits ---------- */

  /*
   * sessionStorage (this tab only, gone when it closes), namespaced, JSON.
   * Only these names, and never anything from Google: 'session' = { sid,
   * tab } (the server's opaque id and the page load it belongs to), 'ui'
   * and 'draft' (AdminScript, A.keep). Every access may fail (private
   * mode, storage off): then a reload simply signs in again.
   */
  var keep = (function () {

    var PREFIX = 'athanasios-admin.';
    var NAMES = ['session', 'ui', 'draft'];
    var MAX = 120000;           // characters per entry: unsaved text, never media
    var closed = false;         // signed out: nothing is written any more

    function allowed(name) {
      return NAMES.indexOf(name) !== -1;
    }

    return {
      get: function (name) {
        if (!allowed(name)) return null;
        try {
          var text = window.sessionStorage.getItem(PREFIX + name);
          var value = text ? JSON.parse(text) : null;
          return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
        }
        catch (error) {
          return null;
        }
      },
      set: function (name, value) {
        if (!allowed(name) || closed) return false;
        try {
          var text = JSON.stringify(value);
          if (text.length > MAX) return false;
          window.sessionStorage.setItem(PREFIX + name, text);
          return true;
        }
        catch (error) {
          return false;
        }
      },
      drop: function (name) {
        if (!allowed(name)) return;
        try { window.sessionStorage.removeItem(PREFIX + name); }
        catch (ignored) { /* nothing to drop */ }
      },
      clear: function () {
        NAMES.forEach(function (name) {
          try { window.sessionStorage.removeItem(PREFIX + name); }
          catch (ignored) { /* nothing to drop */ }
        });
      },
      /* sign out: everything goes, and stays gone until the page reloads */
      close: function () {
        closed = true;
        this.clear();
      },
      /* «خروج» in this tab: no automatic sign-in until Google (kept apart from clear()) */
      signedOut: function (value) {
        try {
          if (value === true) window.sessionStorage.setItem(PREFIX + 'signed-out', '1');
          else if (value === false) window.sessionStorage.removeItem(PREFIX + 'signed-out');
          return window.sessionStorage.getItem(PREFIX + 'signed-out') === '1';
        }
        catch (error) {
          return false;
        }
      }
    };

  })();

  /* the panel's share (AdminScript): where you were, and an editor's unsaved values */
  if (A) {
    A.keep = {
      get: function (name) { return name === 'session' ? null : keep.get(name); },
      set: function (name, value) { return name === 'session' ? false : keep.set(name, value); },
      drop: function (name) { if (name !== 'session') keep.drop(name); }
    };
  }

  var SID = /^[\w-]{16,64}$/;

  /* the session this tab had before the reload, or null */
  function savedSession() {

    var value = keep.get('session');
    if (!value || !SID.test(value.sid || '')) return null;
    return { sid: value.sid, tab: SID.test(value.tab || '') ? value.tab : '', left: value.left === true };

  }

  /* this tab's session now (or none) */
  function storeSession(left) {

    if (sid) keep.set('session', left ? { sid: sid, tab: TAB, left: true } : { sid: sid, tab: TAB });
    else keep.drop('session');

  }

  function forgetSession() {

    saved = null;
    keep.drop('session');

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

    remember({ token: token, email: claims.email, exp: claims.exp, via: 'google' });
    trust.googleArrived();

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
    if (verifying === claims.email && (gate.dataset.state === 'loading' || gate.dataset.stage === 'server' || gate.dataset.stage === 'dashboard')) return;

    // after a reload: the same session again; else a new one
    if (saved) resume();
    else enter();

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

    lastCall = Date.now();

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

  /*
   * Wakes the API's runtime (Apps Script starts cold after a quiet while:
   * 5–15 s) so the real calls find it warm: fn 'warm' is answered at the top
   * of doPost, before any token, Sheet or property. Fire and forget: sent at
   * once on load (Google sign-in is still on screen), and again when the tab
   * comes back after WARM_IDLE without a request.
   */
  var WARM_IDLE = 5 * 60000;
  var lastCall = 0;

  function warm() {

    if (!API || typeof fetch !== 'function') return;

    lastCall = Date.now();

    try {
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: '{"fn":"warm"}',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        referrerPolicy: 'no-referrer'
      }).catch(function () {});
    }
    catch (ignored) {
      // only a head start
    }

  }

  function warmIfIdle() {

    if (document.visibilityState !== 'hidden' && Date.now() - lastCall > WARM_IDLE) warm();

  }

  function failure(reply) {

    var error = new Error(reply.error || JSON.stringify({ appError: 1, message: 'حصلت مشكلة غير متوقعة.' }));
    error.apiCode = reply.code || '';
    return error;

  }

  /* a token that is still good, or a sign-in first */
  function token() {

    if (fresh(session)) return Promise.resolve(session.token);
    // the installed admin app: its trusted device first (no Google screen), else Google
    return trust.signIn().then(function (value) { return value || signInAgain(); });

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
        if (reply.code === 'reauth' && !retried.reauth) {
          // this needs Google itself, not the remembered device: sign in with Google, then the same call
          trust.needGoogle();
          remember(null);
          return call(name, args, { auth: retried.auth, session: retried.session, reauth: true });
        }
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
          storeSession();
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

    if (state !== 'loading' && state !== 'restoring') verifying = '';
    // after a reload: the compact gate (no intro), until the panel or the usual sign-in
    if (state !== 'problem') restoring = state === 'restoring';
    document.documentElement.classList.toggle('is-restoring', restoring);
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

  /*
   * After a reload: only «جاري استعادة الجلسة...» (no intro, no account), the
   * same words restore.js already put on screen before anything loaded.
   * extra: Google's button and a line, when Google wants a click.
   */
  function showRestoring(stage, extra) {

    var note = h('p', { class: 'gate__note gate__note--slow', role: 'status', hidden: true });

    showGate('restoring', [
      h('p', { class: 'gate__status', role: 'status' },
        h('span', { class: 'gate__line', 'aria-hidden': 'true' }, h('i')),
        h('span', { class: 'gate__verify', text: 'جاري استعادة الجلسة...' })),
      extra || null,
      note
    ], stage);

    return {
      slow: function (message) {
        note.textContent = message;
        note.hidden = false;
        gate.dataset.slow = '1';
      }
    };

  }

  /* the panel is on its way: the restore look, or «جاري التحقق...» */
  function progress(step, stage) {

    return restoring ? showRestoring(stage) : showVerifying(step, stage);

  }

  /*
   * A reload of a tab that had a session: a fresh token from Google first —
   * silently (auto-select) when it can; if Google wants a click, its button
   * right here, under the same words — then resume().
   */
  function restore() {

    if (fresh(session)) { resume(); return; }

    var my = nextAttempt();
    var host = h('div', { class: 'gate__google', hidden: true });
    var line = h('p', { class: 'gate__note', hidden: true, text: 'جوجل محتاج تأكيد — دوس على الزرار وهتكمّل من مكانك.' });
    var view = showRestoring('google', h('div', { class: 'gate__restore-google' }, host, line));
    var offered = false;

    var stopSlow = watchdog(TIMING.gisSlow, function () {
      if (my !== attempt) return;
      view.slow('جوجل بياخد وقت أطول من العادي… لو النت ضعيف استنى شوية.');
    });

    function offer(id) {
      if (offered || my !== attempt) return;
      offered = true;
      host.hidden = false;
      line.hidden = false;
      renderButton(host, id);
      gate.dataset.stage = 'signin';
    }

    loadGis()
      .then(function (id) {
        stopSlow();
        if (my !== attempt) return;
        // a returning admin is signed in without a click; if nothing comes, the button
        var stopSilent = watchdog(TIMING.silent, function () { offer(id); });
        try {
          id.prompt(function (moment) {
            try {
              if (moment && ((moment.isNotDisplayed && moment.isNotDisplayed()) ||
                  (moment.isSkippedMoment && moment.isSkippedMoment()) ||
                  (moment.isDismissedMoment && moment.isDismissedMoment()))) {
                stopSilent();
                offer(id);
              }
            }
            catch (ignored) {
              offer(id);
            }
          });
        }
        catch (error) {
          stopSilent();
          offer(id);
        }
      })
      .catch(function (error) {
        stopSlow();
        if (my !== attempt) return;
        showProblem('مقدرناش نفتح تسجيل الدخول بتاع جوجل.', 'اتأكد من النت، وإن المتصفح مش مانع accounts.google.com، وجرّب تاني.', error.message, restore);
      });

  }

  /*
   * The same session as before the reload (apiSessionResume): the panel's
   * state comes with it (one round trip). Never the takeover question for
   * this tab; anything else falls back to the usual sign-in.
   */
  function resume() {

    var current = session;
    var before = saved;

    if (!before) { enter(); return; }
    if (!fresh(current)) { restore(); return; }

    var my = nextAttempt();
    var signal = controller ? controller.signal : undefined;
    var view = showRestoring('server');
    var stopSlow = watchdog(TIMING.slow, function () {
      if (my !== attempt) return;
      view.slow('بياخد وقت أطول من العادي… الخادم بيصحى لو بقاله فترة من غير استخدام.');
    });

    verifying = current.email;

    post('apiSessionResume', [{ device: DEVICE, tab: TAB, prev: before.tab, left: before.left }], current.token, before.sid, { timeout: TIMING.fail, signal: signal })
      .then(function (reply) {
        stopSlow();
        if (my !== attempt) return;

        var result = reply.ok ? reply.result || {} : {};

        if (reply.ok && result.sid && result.state) {
          saved = null;
          sid = result.sid;
          storeSession();
          openPanel(result.state, my);
          return;
        }

        // from here on, the usual way in: this sid is not ours to resume
        if (reply.code === 'session_replaced') {
          forgetSession();
          var info = parsed(failure(reply));
          showRevoked(info.message, info.hint);
          return;
        }
        if (reply.code === 'session_expired') {
          forgetSession();
          enter();
          return;
        }
        if (reply.ok && result.active) {
          // the same sid live in another tab (a duplicated tab): asked, like any other
          forgetSession();
          showSessionActive(result.active);
          return;
        }
        if (!reply.ok && (reply.code === 'denied' || reply.code === 'auth')) {
          if (reply.code === 'denied') keep.clear();
          refused(reply, current, {});
          return;
        }

        var details = reply.ok ? { message: 'رد خادم لوحة التحكم مش مفهوم.', hint: 'غالبًا نشر الـ API في Apps Script محتاج يتحدّث (docs/ADMIN-SETUP.md).', details: JSON.stringify(result).slice(0, 200) } : parsed(failure(reply));
        showProblem(details.message, details.hint, details.details, resume);
      })
      .catch(function (error) {
        stopSlow();
        if (my !== attempt) return;
        var info = error.aborted
          ? { message: 'الاتصال بخادم لوحة التحكم اتقطع.', hint: 'جرّب تاني.', details: 'apiSessionResume: aborted by the browser' }
          : parsed(error);
        showProblem(info.message, info.hint, info.details, resume);
      });

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
        storeSession();
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
      keep.clear();
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

  /*
   * The new backend (worker/, docs/BACKEND-MIGRATION.md) checks the same
   * Google sign-in: one quiet call per page, after the panel opens. Nothing
   * is shown and nothing waits on it; it binds this Google account to its
   * admin row there. A remembered device's token is Apps Script's own: skipped.
   */
  var workerChecked = false;

  function checkWorker() {

    if (workerChecked || !WORKER || !session || session.via !== 'google' || typeof fetch !== 'function') return;
    workerChecked = true;

    try {
      fetch(WORKER + '/v1/admin/whoami', {
        headers: { authorization: 'Bearer ' + session.token },
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer'
      }).catch(function () {});
    }
    catch (ignored) {
      // only a check
    }

  }

  /*
   * window.AdminWorker: the new backend's admin routes (worker/BOOKING-API.md),
   * beside AdminTransport. JSON in and out (or raw bytes: a proof image up, a
   * proof's bytes down) with this tab's GOOGLE ID token as
   * `Authorization: Bearer`. A remembered device's token is Apps Script's
   * own: a device session gets code 'google' («الحجوزات محتاجة دخول بحساب
   * جوجل») and google() offers the usual Google sign-in over the panel.
   * Timeouts like AdminTransport. Network errors, timeouts, 5xx and 'busy'
   * are tried again (backoff) with the SAME Idempotency-Key, so a write is
   * never made twice. A failure is an Error that A.fail / A.parseError show
   * as is (the server's Arabic message), carrying code, field, warnings,
   * left and the whole reply. options.quiet: never asks for a sign-in (the
   * module check: anything wrong just hides the bookings).
   */
  var WORKER_BACKOFF = [700, 2000];

  // this page load's edit session (x-edit-session): the booking edit locks
  // (worker/src/book/locks.js) belong to it, and its own writes pass them
  var EDIT_SESSION = (function () {
    var bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    return 'es' + Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  })();

  function workerError(message, hint, extra) {

    extra = extra || {};
    var error = appError(message, hint, extra.details);
    error.parsed = { message: message, hint: hint || '', details: extra.details || '', field: extra.field || '' };
    error.code = error.apiCode = extra.code || '';
    error.field = extra.field || '';
    error.status = extra.status || 0;
    error.reply = extra.reply || null;
    error.retry = !!extra.retry;
    return error;

  }

  function needsGoogle() {

    return workerError('الحجوزات محتاجة دخول بحساب جوجل.', 'ادخل بحساب جوجل وكمّل من مكانك.', { code: 'google' });

  }

  /*
   * The Worker's credential for this panel: the panel's OWN session turned into a
   * short-lived signed token (Apps Script apiWorkerSession, ~15 min, memory only),
   * whether the panel signed in with Google or as the installed app's trusted
   * device. So «الحجوزات» never asks for Google again while the panel is signed
   * in. Renewed a minute before it ends; Google is asked only when the panel's
   * own session can't give one (it ended, or the server says so).
   */
  var wkCache = null;      // { token, exp (ms) }
  var wkPending = null;

  function forgetWorkerSession() {
    wkCache = null;
  }

  function workerSession() {

    if (wkCache && wkCache.exp - Date.now() > 60000) return Promise.resolve(wkCache.token);
    if (wkPending) return wkPending;
    if (!sid || !session) return Promise.reject(needsGoogle());

    // the panel's own token first (a device's renews silently; a Google one may need the usual renewal)
    var own = fresh(session) ? Promise.resolve(session.token)
      : session.via === 'device' ? trust.signIn().then(function (value) { if (!value) throw needsGoogle(); return value; })
        : Promise.reject(needsGoogle());

    wkPending = own.then(function (value) {
      return post('apiWorkerSession', [], value, sid, { timeout: TIMING.fail });
    }).then(function (reply) {
      var r = reply && reply.ok && reply.result;
      if (!r || !/^wk1\./.test(String(r.token)) || !isFinite(Number(r.exp))) throw needsGoogle();
      wkCache = { token: String(r.token), exp: Number(r.exp) * 1000, email: session ? session.email : '' };
      return wkCache.token;
    });
    wkPending.then(function () { wkPending = null; }, function () { wkPending = null; });

    return wkPending;

  }

  /* a fresh GOOGLE token (never the device's): Google again when this one is past its hour */
  function googleToken(quiet) {

    if (session && session.via === 'google' && fresh(session)) return Promise.resolve(session.token);
    if (quiet || (session && session.via === 'device')) return Promise.reject(needsGoogle());
    return signInAgain().then(function (value) {
      if (session && session.via === 'google' && fresh(session)) return value;
      throw needsGoogle();
    });

  }

  function workerFetch(method, path, body, tokenValue, options) {

    var abort = typeof AbortController === 'function' ? new AbortController() : null;
    var timedOut = false;
    var timer = abort ? setTimeout(function () { timedOut = true; abort.abort(); }, TIMING.fail) : null;
    var headers = { authorization: 'Bearer ' + tokenValue, accept: options.raw ? '*/*' : 'application/json' };
    var payload;

    if (typeof Blob === 'function' && body instanceof Blob) {
      payload = body;
      headers['content-type'] = options.contentType || body.type || 'application/octet-stream';
    }
    else if (body !== undefined && body !== null) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    headers['x-edit-session'] = EDIT_SESSION;

    return fetch(WORKER + path, {
      method: method,
      headers: headers,
      body: payload,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: abort ? abort.signal : undefined
    }).then(function (response) {
      if (options.raw && response.ok) return response.blob().then(function (blob) { return { blob: blob }; });
      return response.text().then(function (text) {
        var reply = null;
        try { reply = JSON.parse(text); }
        catch (ignored) { reply = null; }
        return { status: response.status, reply: reply, text: text };
      });
    }).then(function (result) {
      if (timer) clearTimeout(timer);
      return result;
    }, function (error) {
      if (timer) clearTimeout(timer);
      if (timedOut) throw workerError('الخادم مردّش في الوقت المعتاد.', 'ممكن النت ضعيف. جرّب تاني.', { code: 'timeout', retry: true, details: method + ' ' + path + ': no answer after ' + Math.round(TIMING.fail / 1000) + ' s' });
      throw workerError('الاتصال بالإنترنت اتقطع.', 'اتأكد من النت وجرّب تاني.', { code: 'network', retry: true, details: String(error && error.message || error) });
    });

  }

  function workerCall(method, path, body, options) {

    options = options || {};

    if (!WORKER) return Promise.reject(workerError('الحجوزات مش متاحة هنا.', '', { code: 'off' }));

    var tries = 0;
    var signedInAgain = false;

    function once() {
      // the panel's own session first; Google itself only if that can't give one
      return workerSession().catch(function (error) {
        if (session && session.via === 'google') return googleToken(options.quiet);
        throw error;
      })
        .then(function (value) { return workerFetch(method, path, body, value, options); })
        .then(function (result) {
          if (result.blob) return result.blob;
          var reply = result.reply;
          if (reply && reply.ok === true) return reply;
          if (!reply || typeof reply !== 'object' || reply.ok !== false) {
            throw workerError('رد الخادم مش مفهوم.', 'جرّب تاني بعد شوية.', { code: 'error', status: result.status, retry: result.status >= 500, details: 'HTTP ' + result.status + ' ' + String(result.text || '').slice(0, 200) });
          }
          throw workerError(String(reply.message || 'حصلت مشكلة غير متوقعة.'), String(reply.hint || ''), {
            code: String(reply.code || ''), field: String(reply.field || ''), status: result.status, reply: reply,
            retry: reply.code === 'busy' || result.status >= 500, details: reply.requestId ? 'requestId ' + reply.requestId : ''
          });
        })
        .catch(function (error) {
          // Google's token refused: sign in with Google again, then the same call (once)
          // the Worker refused the credential (ended, or the allowlist changed): a fresh one, once
          if (error.code === 'auth' && !signedInAgain) {
            signedInAgain = true;
            forgetWorkerSession();
            return once();
          }
          if (error.retry && tries < WORKER_BACKOFF.length) {
            var wait = WORKER_BACKOFF[tries++];
            return new Promise(function (resolve) { setTimeout(resolve, wait); }).then(once);
          }
          throw error;
        });
    }

    return once();

  }

  var workerApi = {
    available: function () { return !!WORKER; },
    /* 'google' | 'device' | '' */
    via: function () { return session ? session.via || '' : ''; },
    /* this page's edit session (the booking locks) */
    editSession: function () { return EDIT_SESSION; },
    call: function (method, path, body, options) { return workerCall(method, path, body, options); },
    /* raw bytes up (a proof image), with its Idempotency-Key */
    upload: function (path, blob, options) { return workerCall('POST', path, blob, options); },
    /* raw bytes down (a proof image) → a Blob */
    blob: function (path) { return workerCall('GET', path, undefined, { raw: true }); },
    /* the usual Google sign-in over the panel (a device session that needs Google) */
    google: function () {
      trust.needGoogle();
      return signInAgain();
    }
  };

  /* draws the panel behind the gate; the gate goes only once it is drawn */
  function openPanel(state, my) {

    progress('بنجهز اللوحة…', 'dashboard');
    checkWorker();

    window.AdminTransport = { call: call };
    window.AdminWorker = WORKER ? workerApi : null;
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
      // where the admin was before a reload (area, sub-tab): drawn there straight away
      if (A.restore) A.restore.view();
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
      // the scroll position, the editor that was open and its unsaved values —
      // before the first heartbeat, so the editor's lock is asked for, never let go
      if (A.restore) {
        try { A.restore.rest(); }
        catch (error) { if (window.console) console.warn('[admin] restore', error); }
      }
      collab.begin();
      // a link this page was opened with (an admin notification): there now
      links.ready();
      app.ready();
      trust.panelOpen();
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
    restoring = false;
    document.documentElement.classList.remove('is-restoring');

    return '';

  }

  /* from the open panel back to the gate (taken over, or the session can't go on) */
  function toGate() {

    if (phase !== 'app') return;

    collab.stop();
    sid = '';
    forgetSession();
    phase = 'gate';
    // an open editor's unsaved values stay in this tab: they come back after signing in again
    if (A.restore) A.restore.hold();
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

  /* this device's admin notifications off (never blocks the sign-out for long) */
  function leavePush() {

    var push = window.AdminApp && window.AdminApp.push;

    // (push.js: the server row for this device's token, if it has one; the browser's subscription where allowed)
    if (!push || !('serviceWorker' in navigator)) return Promise.resolve();

    return Promise.race([
      push.disable().catch(function () {}),
      new Promise(function (resolve) { setTimeout(resolve, 6000); })
    ]);

  }

  /* a step that may never answer (a sleeping network, a stuck worker) can't hold the sign-out */
  function bounded(promise, ms) {

    return Promise.race([
      Promise.resolve(promise).catch(function () {}),
      new Promise(function (resolve) { setTimeout(resolve, ms); })
    ]);

  }

  function signOut() {

    A.confirmLeave().then(function (ok) {
      if (!ok) return false;
      return A.confirm({
        tone: 'warn',
        title: 'تسجيل الخروج',
        message: 'أنت على وشك تسجيل الخروج، هل أنت متأكد؟',
        confirmLabel: 'تسجيل الخروج',
        cancelLabel: 'إلغاء'
      });
    }).then(function (ok) {
      if (!ok) return;
      A.dirty = false;
      // at once: the panel answers the tap; nothing else can be clicked meanwhile
      try {
        document.body.classList.add('is-signing-out');
        var note = document.createElement('div');
        note.className = 'signing-out';
        note.setAttribute('role', 'status');
        note.textContent = 'بنخرجك…';
        document.body.appendChild(note);
      }
      catch (error) {
        // only feedback
      }
      // this tab won't sign itself in again (a remembered device, a saved session) until Google
      keep.signedOut(true);
      // «خروج» first, while the session still works: no more admin notifications on this
      // device (its subscription goes, the server's row too), and the installed app forgets
      // its device credential; then the session ends
      var live = sid && fresh(session);
      // the notifications and the remembered device go side by side (they still need the
      // session), then the session ends; every step bounded: the whole sign-out stays under ~6 s
      var ending = bounded(Promise.all([
        bounded(live ? leavePush() : null, 3500),
        bounded(trust.forget(), 3500)
      ]), 3600).then(function () {
        return bounded(live ? post('apiSessionEnd', [], session.token, sid, { timeout: 2500 }) : null, 2500);
      });
      collab.stop();
      // nothing of this admin stays in the tab: no session to resume, no place, no drafts
      keep.close();
      ending.then(function () {
        // (only now: the steps above still needed this session)
        sid = '';
        remember(null);
        try {
          if (window.google && window.google.accounts && window.google.accounts.id) window.google.accounts.id.disableAutoSelect();
        }
        catch (error) {
          // signed out here anyway
        }
        // the sign-in screen, from the start (no hash: nothing opens by itself)
        window.location.replace(window.location.href.split('#')[0]);
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
      // the menu's numbers: competitions to review, store requests (Presence.gs adminBadges_)
      if (result.badges && A.setBadges) A.setBadges(result.badges);
      // what the other admins just did (instead of a push while this panel is open)
      if (result.activity && A.activityToasts) {
        try { A.activityToasts(result.activity); }
        catch (error) { if (window.console) console.warn('[admin] activity', error); }
      }
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
      // (the installed app's device renews silently, so its heartbeat goes on)
      if (!fresh(session)) {
        if (session && session.via === 'device') trust.signIn().then(function (value) { schedule(value ? 0 : TIMING.beat); });
        else schedule(TIMING.beat);
        return;
      }

      inflight = true;
      lastBeat = Date.now();

      post('apiHeartbeat', [{ area: place.area, view: place.view, item: editing(), locks: lockKeys(), since: A.activitySince ? A.activitySince() : undefined }], session.token, sid, { timeout: TIMING.beatFail })
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
        // tell the server the panel is out of sight: admin pushes reach this
        // device again at once, not ~70 s later (AdminNotify.gs adminPresent_)
        if (sid && fresh(session)) {
          post('apiHeartbeat', [{ area: place.area, view: place.view, item: editing(), locks: lockKeys(), hidden: true }], session.token, sid, { timeout: TIMING.beatFail })
            .catch(function () { /* the panel then counts as away after ~70 s anyway */ });
        }
      }
    });

    // leaving (a reload, or closing the tab: the page can't tell): this tab
    // notes that this page load left (a duplicated tab never has that), and
    // the session is parked — not live for anyone else, its locks kept a few
    // seconds, for this tab to resume. Best effort: if the beacon never
    // arrives, the session goes quiet and runs out by itself.
    window.addEventListener('pagehide', function () {
      if (!sid) return;
      storeSession(true);
      if (!fresh(session) || !navigator.sendBeacon) return;
      try {
        navigator.sendBeacon(API, new Blob([JSON.stringify({ fn: 'apiSessionEnd', args: [{ park: true, tab: TAB }], token: session.token, sid: sid })], { type: 'text/plain;charset=utf-8' }));
      }
      catch (ignored) {
        // the locks run out by themselves
      }
    });

    // back from the back/forward cache: still here after all (the beat unparks the session, or finds it gone and starts a new one)
    window.addEventListener('pageshow', function (event) {
      if (!event.persisted) return;
      if (sid) storeSession();
      if (running) beat();
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


  /*
   * 8. Links into the panel: '#open/<kind>/<id>', '#open/settings',
   *    '#activity', '#activity/<id>' — from an admin notification (the
   *    worker opens /admin/#…, or tells an open admin window where to go)
   *    or from a link. Taken out of the address bar at once (a reload never
   *    opens it again) and followed once the panel is drawn; A.openLink
   *    (AdminActivity) goes there the usual way (unsaved changes asked first).
   */
  var links = (function () {

    var LINK = /^#(?:open\/[a-z]{1,20}(?:\/[\w-]{1,80})?|activity(?:\/act-[0-9a-f]{12})?)$/;
    var pending = '';

    function take(hash) {

      if (!LINK.test(hash || '')) return false;
      pending = hash;
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search); }
      catch (ignored) { /* the hash stays; harmless */ }
      follow();
      return true;

    }

    function follow() {

      if (!pending || phase !== 'app' || !A.openLink) return;
      var hash = pending;
      pending = '';
      Promise.resolve(A.openLink(hash)).catch(function (error) {
        if (window.console) console.warn('[admin] link', error);
      });

    }

    take(window.location.hash);

    window.addEventListener('hashchange', function () { take(window.location.hash); });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', function (event) {
        var data = event.data;
        if (!data || data.type !== 'athanasios-admin:open' || typeof data.url !== 'string') return;
        try {
          var url = new URL(data.url, window.location.origin);
          if (url.origin === window.location.origin && url.pathname === window.location.pathname) take(url.hash);
        }
        catch (ignored) {
          // not a link of ours
        }
      });
    }

    return { ready: follow };

  })();


  /*
   * 9. The admin app (window.AdminApp, for A.appCard in AdminActivity):
   *    - install: the browser's own prompt (Android / desktop Chrome, Edge),
   *      kept for the «ثبّت التطبيق» button; iPhone: «إضافة إلى الشاشة
   *      الرئيسية» from Safari (the card explains it);
   *    - its service worker, /admin/sw.js (scope /admin/, push and taps only,
   *      no cache), registered once the panel is open;
   *    - admin notifications on this device: admin/push.js, loaded only when
   *      the card asks (or for an occasional token refresh of a subscribed
   *      device). The permission prompt opens inside the tap.
   */
  var app = (function () {

    var deferred = null;
    var listeners = [];
    var worker = null;
    var module = null;

    function changed() {
      listeners.forEach(function (fn) { try { fn(); } catch (ignored) { /* a card that's gone */ } });
    }

    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferred = event;
      changed();
    });

    window.addEventListener('appinstalled', function () {
      deferred = null;
      changed();
    });

    /* the admin worker, active (never the site's /sw.js) */
    function registration() {

      if (!('serviceWorker' in navigator)) return Promise.reject(new Error('هنا مفيش دعم للإشعارات.'));

      if (!worker) {
        worker = navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
          var pending = reg.installing || reg.waiting;
          if (reg.active || !pending) return reg;
          return new Promise(function (resolve) {
            pending.addEventListener('statechange', function () {
              if (pending.state === 'activated') resolve(reg);
            });
            setTimeout(function () { resolve(reg); }, 8000);
          });
        });
        worker.catch(function () { worker = null; });
      }

      return worker;

    }

    function pushModule() {

      if (!module) {
        module = import('./push.js');
        module.catch(function () { module = null; });
      }

      return module;

    }

    function support() {

      var ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!ok) return platform() === 'ios' && !standalone() ? 'ios-install' : 'unsupported';
      if (window.Notification.permission === 'denied') return 'denied';
      return 'ok';

    }

    var info = function () { return { platform: platform(), device: DEVICE }; };

    /*
     * Is THE ADMIN APP installed on this device? The browser answers for the
     * admin manifest only (related_applications lists itself; Chrome on
     * Android and desktop): true / false, or null when it can't tell (Safari,
     * Firefox, older Chrome). Never true for the site's app or a shortcut.
     */
    var related = null;

    function installedHere() {

      if (installedNow) return Promise.resolve(true);
      if (!navigator.getInstalledRelatedApps) return Promise.resolve(null);
      if (!related) {
        related = Promise.race([
          navigator.getInstalledRelatedApps().then(function (apps) {
            return (apps || []).some(function (a) {
              return a && a.platform === 'webapp' && /\/admin\/manifest\.webmanifest$/.test(String(a.url || ''));
            });
          }),
          new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 3000); })
        ]).catch(function () { return null; });
        // asked again later (it may be installed meanwhile)
        related.then(function () { setTimeout(function () { related = null; }, 15000); });
      }
      return related;

    }

    var installedNow = false;
    var lastPush = null;

    window.addEventListener('appinstalled', function () {
      installedNow = true;
      changed();
    });

    window.AdminApp = {

      standalone: standalone,
      mode: appMode,
      platform: platform,
      installedHere: installedHere,
      justInstalled: function () { return installedNow; },
      canInstall: function () { return !!deferred; },

      /* resolves true when the admin accepted */
      install: function () {
        var event = deferred;
        if (!event) return Promise.resolve(false);
        deferred = null;
        event.prompt();
        return event.userChoice.then(function (choice) {
          changed();
          return !!choice && choice.outcome === 'accepted';
        }, function () { return false; });
      },

      onChange: function (fn) { listeners.push(fn); },

      push: {
        support: support,
        status: function () {
          // the browser's own subscription decides (push.js), so a reopened panel shows the truth
          return Promise.all([pushModule(), registration().catch(function () { return null; })]).then(function (both) {
            return both[0].status(A.call, both[1], info());
          }).then(function (result) {
            lastPush = result;
            return result;
          });
        },
        /* the last known state, for an instant first draw (then status() confirms it) */
        lastStatus: function () { return lastPush; },
        /* must be called inside the tap: the permission prompt opens first */
        enable: function () {
          var asked = window.Notification.permission === 'granted'
            ? Promise.resolve('granted')
            : new Promise(function (resolve) {
              // older Safari answers through a callback, newer browsers with a promise
              var answer = window.Notification.requestPermission(resolve);
              if (answer && typeof answer.then === 'function') answer.then(resolve, function () { resolve('default'); });
            });
          return asked.then(function (answer) {
            if (answer !== 'granted') {
              throw new Error(answer === 'denied'
                ? 'الإشعارات اتقفلت للموقع ده. افتحها من إعدادات الموقع في المتصفح وجرّب تاني.'
                : 'محتاجين توافق على الإشعارات علشان تشتغل.');
            }
            return Promise.all([pushModule(), registration()]);
          }).then(function (both) {
            return both[0].enable(A.call, both[1], info());
          });
        },
        disable: function () {
          return Promise.all([pushModule(), registration().catch(function () { return null; })]).then(function (both) {
            return both[0].disable(A.call, both[1]);
          });
        },
        removeDevice: function (id) {
          return pushModule().then(function (m) { return m.removeDevice(A.call, id); });
        }
      }

    };

    return {
      /* the panel is open: the worker (quietly), and an occasional token check of a subscribed device */
      ready: function () {
        var later = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1500); };
        later(function () {
          registration().then(function (reg) {
            // only where notifications are allowed; push.js checks whether this device
            // turned admin notifications on and is due a check (every few days) before
            // it loads anything else
            if (!('Notification' in window) || window.Notification.permission !== 'granted') return;
            return pushModule().then(function (m) { return m.refresh(A.call, reg, info()); });
          }).catch(function (error) {
            if (window.console) console.warn('[admin] app worker', error);
          });
        });
      }
    };

  })();


  /*
   * 10. «خليك داخل» on the installed admin app (apps-script/AdminDevice.gs,
   *     admin/device.js). Only when this window was opened from the admin
   *     app's own icon (appMode 'admin-app'); a browser tab never keeps
   *     anything. After a real Google sign-in the server gives this phone a
   *     device credential (30 days from THAT sign-in, never extended by use),
   *     kept only as a non-extractable key. A later launch (or an expired
   *     hour) gets a short-lived access token with it — no Google screen. It
   *     ends with «خروج», at its end date, when the admin is removed, or when
   *     the server says so; then it's Google as usual. A call that needs
   *     Google itself (adding/removing admins) answers 'reauth': Google again.
   */
  var trust = (function () {

    var module = null;
    var pending = null;
    var googleNeeded = false;
    var trusting = false;
    var current = '';      // this phone's device id (replaced by the next Google sign-in)
    var started = null;    // the session deviceSignIn opened with the token (a launch: one round trip)

    function on() {
      return appMode() === 'admin-app';
    }

    function deviceModule() {
      if (!module) {
        module = import('./device.js');
        module.catch(function () { module = null; });
      }
      return module;
    }

    /* a fresh access token from this phone's device credential, or null (none, gone, not the app, trouble) */
    function signIn(start) {

      if (!on() || googleNeeded) return Promise.resolve(null);
      if (pending) return pending;

      pending = deviceModule().then(function (m) {
        if (!m.supported()) return null;
        return m.load().then(function (record) {
          if (!record) return null;
          current = record.deviceId;
          return m.challenge(record)
            .then(function (payload) {
              // a launch without a session in this tab: the panel's session comes back in the same answer
              if (start) payload.start = start;
              return post('deviceSignIn', [payload], '', '', { timeout: TIMING.fail });
            })
            .then(function (reply) {
              if (reply && reply.ok && reply.token && isFinite(Number(reply.exp))) {
                remember({ token: reply.token, email: String(reply.email || '').toLowerCase(), exp: Number(reply.exp), via: 'device' });
                started = start && reply.session && typeof reply.session === 'object' ? reply.session : null;
                return reply.token;
              }
              // the server says this device is no more: forget it here too, then Google as usual
              if (reply && /^(device|expired|denied|bad)$/.test(String(reply.code || ''))) {
                current = '';
                return m.forget().then(function () { return null; });
              }
              return null;
            });
        });
      }).catch(function () { return null; });

      pending.then(function () { pending = null; });

      return pending;

    }

    /* right after a real Google sign-in in the app, with the panel open: remember this phone */
    function trustNow() {

      if (!on() || trusting || !sid || !session || session.via !== 'google' || !fresh(session)) return;

      trusting = true;

      deviceModule().then(function (m) {
        if (!m.supported()) return null;
        return post('apiTrustDevice', [{ label: DEVICE, previous: current || undefined }], session.token, sid, { timeout: TIMING.fail })
          .then(function (reply) {
            if (!reply || !reply.ok || !reply.result || !reply.result.deviceId) return null;
            current = reply.result.deviceId;
            return m.save(reply.result);
          });
      }).catch(function (error) {
        if (window.console) console.warn('[admin] device', error);
      }).then(function () {
        trusting = false;
      });

    }

    return {
      signIn: signIn,
      needGoogle: function () { googleNeeded = true; },
      googleArrived: function () {
        googleNeeded = false;
        keep.signedOut(false);
        if (phase === 'app') trustNow();
      },
      panelOpen: trustNow,

      /* «خروج»: the server and this phone forget the device (before the session ends) */
      forget: function () {
        if (!on() && !current) return Promise.resolve();
        return deviceModule().then(function (m) {
          var tell = current && sid && fresh(session)
            ? post('apiForgetDevice', [{ deviceId: current }], session.token, sid, { timeout: 4000 }).catch(function () {})
            : Promise.resolve();
          return tell.then(function () { current = ''; return m.forget(); });
        }).catch(function () {});
      },

      /* the first thing on a page load: the app's device, else the usual (restore after a reload, or Google) */
      start: function () {
        if (keep.signedOut()) {
          // after «خروج»: the Google button, nothing automatic (whatever a cleanup step may have missed)
          saved = null;
          showSignIn();
          return;
        }
        if (!on()) {
          if (saved) restore();
          else showSignIn();
          return;
        }
        var my = nextAttempt();
        var view = showRestoring('device');
        var stopSlow = watchdog(TIMING.slow, function () {
          if (my === attempt) view.slow('بياخد وقت أطول من العادي… الخادم بيصحى لو بقاله فترة من غير استخدام.');
        });
        signIn(saved ? null : { device: DEVICE, tab: TAB }).then(function (value) {
          stopSlow();
          if (my !== attempt) return;
          var opened = started;
          started = null;
          if (value) {
            if (saved) resume();
            // the session came with the token: straight into the panel (no second wait)
            else if (opened && opened.sid && opened.state) {
              sid = opened.sid;
              storeSession();
              openPanel(opened.state, my);
            }
            else if (opened && opened.active) showSessionActive(opened.active);
            else enter();
            return;
          }
          if (saved) restore();
          else showSignIn();
        });
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
    if (!event.persisted || phase !== 'gate') return;
    if (gate.dataset.state === 'restoring') { restore(); return; }
    if (gate.dataset.state !== 'loading') return;
    if (fresh(session)) enter();
    else showSignIn();
  });

  // the API wakes up while Google signs in (and after a quiet while away)
  warm();
  window.addEventListener('focus', warmIfIdle);
  document.addEventListener('visibilitychange', warmIfIdle);

  // a reload of a tab that had a session: the same session again; else the sign-in
  saved = savedSession();

  trust.start();

})();
