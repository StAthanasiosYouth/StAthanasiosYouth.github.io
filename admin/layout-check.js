/*
 * LAYOUT CHECK (only with ?layout in the address): finds what makes the page
 * wider than the window — the source of a sideways scrollbar — and names it
 * in a small panel, so one screenshot shows the exact element. Reads only.
 *
 * Positions are measured from the page itself (not the scrolled view), and
 * every element is ranked by how far it sticks out, worst first.
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
    var view = root.clientWidth;
    // page coordinates: undo the horizontal scroll (RTL scrolls to negative)
    var shift = window.scrollX || 0;
    var rows = [];
    var all = document.querySelectorAll('body *');

    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest('#layout-check')) continue;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      var left = r.left + shift;
      var right = r.right + shift;
      var out = Math.max(0, right - view) + Math.max(0, -left);
      if (out > 0.5) rows.push({ el: el, left: left, right: right, out: out });
    }

    rows.sort(function (a, b) { return b.out - a.out; });

    var lines = ['page ' + root.scrollWidth + ' / view ' + view + ' / scrolled ' + Math.round(shift)];

    rows.slice(0, 6).forEach(function (row) {
      var cs = getComputedStyle(row.el);
      lines.push('OUT ' + Math.round(row.out) + 'px ' + describe(row.el) +
        ' [' + Math.round(row.left) + '…' + Math.round(row.right) + '] ' + cs.position +
        (row.el.getAttribute('style') ? ' style="' + row.el.getAttribute('style').slice(0, 80) + '"' : ''));
    });

    if (rows[0]) {
      lines.push('worst: ' + rows[0].el.outerHTML.replace(/\s+/g, ' ').slice(0, 160));
    }

    lines.push('body: ' + Array.prototype.map.call(document.body.children, describe).join(' | '));

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
