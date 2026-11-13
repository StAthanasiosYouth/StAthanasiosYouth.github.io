/*
 * INTRO: which opening the home page plays (classic script in <head>: decides before the first paint).
 * Site redesign W3 (approved S1 + S2 «دخلة المخدوم»):
 *  - no account on this device yet → the card intro (intro-card.js): the gate («أهلاً بيك», the big logo; its
 *    press is the touch the browser needs before sound), then the card, the phone's scan, the dive into the code,
 *    the church and the two saints, and «اعمل حسابك في دقيقة». Every visit until the person makes an account.
 *  - an account on this device → the member's short welcome (intro-member.js): the gold ring, the logo, their
 *    name, the next meeting, and the logo flies into the top bar. Every visit.
 * A visit = once per tab session. A tap never cuts either short (owner, 2026-11-11). Never in the admin's preview,
 * in a frame, for a deep link (#…), with reduced motion, or on data saver.
 * <html data-intro="card|member">; main.js loads the module, the module removes the attribute when it ends.
 */
(function () {

  'use strict';

  var html = document.documentElement;
  var SEEN = 'athanasios:intro';
  var SESSION_KEY = 'athanasios.account.v1';
  /* this device has had an account: the card intro is over for good (kept after a sign-out) */
  var MEMBER = 'athanasios.intro.member.v1';

  function store(name) { try { return window[name] || null; } catch (e) { return null; } }
  function get(s, key) { try { return s ? s.getItem(key) : null; } catch (e) { return null; } }
  function signedIn() {
    var list = [store('sessionStorage'), store('localStorage')];
    for (var i = 0; i < list.length; i++) {
      try {
        var v = JSON.parse(get(list[i], SESSION_KEY) || 'null');
        if (v && typeof v.token === 'string' && /^as1\./.test(v.token)) return true;
      }
      catch (e) { /* not a session */ }
    }
    return false;
  }
  function framed() {
    try { return window.top !== window.self; }
    catch (e) { return true; }
  }

  // a held moment of the card intro, for the comparison shots with the approved S1 (intro-card.js)
  if (/[?&]ic-freeze=\d/.test(location.search)) { html.setAttribute('data-intro', 'card'); return; }

  var member = signedIn();
  if (member) {
    try { localStorage.setItem(MEMBER, '1'); } catch (e) { /* the session says it anyway */ }
  }

  if (
    html.hasAttribute('data-preview') ||
    (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ||
    location.hash.length > 1 ||
    framed() ||
    // an automated browser (tests, audits) only when it asks: ?ic=1
    (navigator.webdriver && !/[?&]ic=1/.test(location.search)) ||
    !!(navigator.connection && navigator.connection.saveData) ||
    get(store('sessionStorage'), SEEN) === '1' ||
    !document.documentElement.animate || !window.CSS || !CSS.supports('translate', '1px')
  ) {
    return;
  }

  try { sessionStorage.setItem(SEEN, '1'); }
  catch (e) { /* it plays this once anyway */ }

  html.setAttribute('data-intro', member ? 'member' : get(store('localStorage'), MEMBER) === '1' ? 'none' : 'card');
  if (html.getAttribute('data-intro') === 'none') html.removeAttribute('data-intro');

}());
