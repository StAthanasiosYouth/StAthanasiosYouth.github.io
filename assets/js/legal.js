/*
 * The text pages in the S8 look (/about/, /about-site/; privacy and terms in W9):
 * the contents strip lights the section being read, and «لفوق» shows after a
 * long scroll. The markup is all in the page; without this file it still reads
 * and every link works.
 */
(function () {
  'use strict';

  var toc = document.querySelector('.legal-toc');
  if (!toc) return;

  var links = [].slice.call(toc.querySelectorAll('a[href^="#"]'));
  var smooth = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  var up = document.createElement('button');
  up.type = 'button';
  up.className = 'legal-up';
  up.setAttribute('aria-label', 'لفوق');
  up.tabIndex = -1;
  up.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 14 6-6 6 6"/></svg>';
  up.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    var first = document.querySelector('.lbar__brand');
    if (first) first.focus({ preventScroll: true });
  });
  document.body.appendChild(up);

  var queued = false;

  function spy() {
    queued = false;
    var current = null;
    links.forEach(function (a) {
      var target = document.getElementById(a.getAttribute('href').slice(1));
      if (target && target.getBoundingClientRect().top < 160) current = a;
    });
    links.forEach(function (a) {
      var on = a === current;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    if (current) {
      var r = current.getBoundingClientRect();
      var t = toc.getBoundingClientRect();
      if (r.left < t.left || r.right > t.right) toc.scrollBy({ left: r.left - t.left - 20, behavior: smooth ? 'smooth' : 'auto' });
    }
    var show = window.scrollY > 600;
    up.classList.toggle('is-on', show);
    up.tabIndex = show ? 0 : -1;
  }

  window.addEventListener('scroll', function () {
    if (!queued) { queued = true; requestAnimationFrame(spy); }
  }, { passive: true });

  spy();
})();
