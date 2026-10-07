/*
 * Runs first, before anything is drawn (not deferred): when this tab had an
 * admin session before a reload, the gate starts compact — only «جاري
 * استعادة الجلسة...» (gate.css, html.is-restoring) — so the full sign-in
 * screen never flashes. It only looks for the session id that boot.js keeps
 * in this tab's sessionStorage; it reads nothing else and sends nothing.
 */
(function () {
  try {
    var text = window.sessionStorage.getItem('athanasios-admin.session');
    if (text && /"sid":"[\w-]{16,64}"/.test(text) && window.top === window.self) {
      document.documentElement.classList.add('is-restoring');
    }
  }
  catch (ignored) {
    // no storage here: the usual sign-in
  }
})();
