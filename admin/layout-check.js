/*
 * LAYOUT CHECK (only with ?layout in the address): finds anything wider than
 * the page — the source of a sideways scrollbar — and names it in a small
 * panel, so a screenshot shows the exact element. Reads the page only.
 */
(function () {

  'use strict';

  if (!/[?&]layout\b/.test(location.search)) return;

  function describe(el) {
    var name = el.tagName.toLowerCase();
    if (el.id) name += '#' + el.id;
    var cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    if (cls) name += '.' + cls;
    return name;
  }

  function scan() {
    var root = document.documentElement;
    var width = root.clientWidth;
    var lines = ['page ' + root.scrollWidth + ' / view ' + width];
    var all = document.querySelectorAll('body *');

    for (var i = 0; i < all.length && lines.length < 12; i++) {
      var el = all[i];
      if (el.closest('#layout-check')) continue;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      var cs = getComputedStyle(el);
      // something sticking out of the page
      if (r.right > width + 0.5 || r.left < -0.5) {
        lines.push('OUT ' + describe(el) + ' [' + Math.round(r.left) + '…' + Math.round(r.right) + '] ' + cs.position);
      }
      // a box that scrolls sideways on its own
      else if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && /auto|scroll/.test(cs.overflowX)) {
        lines.push('SCROLL ' + describe(el) + ' ' + el.scrollWidth + '/' + el.clientWidth);
      }
    }

    var box = document.getElementById('layout-check');
    if (!box) {
      box = document.createElement('pre');
      box.id = 'layout-check';
      document.body.appendChild(box);
    }
    box.textContent = lines.join('\n');
  }

  window.addEventListener('load', function () {
    scan();
    setInterval(scan, 2000);
  });

})();
