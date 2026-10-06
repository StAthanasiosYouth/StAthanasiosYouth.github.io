/**
 * /admin/: a short entry, then the admin panel (Apps Script) replaces this
 * page in the same tab (the back button doesn't come back here).
 * The URL is the button's own href (admin/index.html); nothing else.
 */

(function () {

  'use strict';

  /* never inside someone else's frame (clickjacking), like the site */
  if (window.top !== window.self) {
    try {
      window.top.location.replace(window.location.href);
    }
    catch (error) {
      // sandboxed frame: nothing more we can do
    }
    return;
  }

  var enter = document.getElementById('enter');
  var target = enter && enter.href;

  if (!target || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(target)) return;

  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.documentElement.classList.add(reduced ? 'is-still' : 'is-going');

  // the short entry (the line fills), then away; at once with reduced motion
  setTimeout(function () {
    window.location.replace(target);
  }, reduced ? 0 : 850);

})();
