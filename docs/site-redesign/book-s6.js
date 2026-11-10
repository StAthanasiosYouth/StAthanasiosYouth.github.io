/* S6 — the event page + booking redesign, a layer on the LIVE page engine and booking.js (served at /events/<slug>/?s6=1).
   The engine draws and runs every step (booking.js talks to the booking API); this decorates each drawing, idempotently:
   · the bar like the home; the poster-less hero gets a date block (day, month, weekday) and «فاضل ٤ أيام»
   · the facts as two tiles (when · where), the summary price «من ١٥٠ جنيه»
   · a sticky «احجز الآن · من ١٥٠ جنيه» bar on the phone until the booking section is on screen
   · the 3 steps as a stepper (مين جاي · الدفع · التأكيد) instead of «خطوة ١ من ٣»
   · the pay card as a ticket; the done screen as a ticket with a 3-stage track (اتبعت ✓ · بيتراجع · اتأكد)
   · drops the stray «null» the live code writes beside «دفع كامل» (a live bug: booking.js planBox.replaceChildren(…, null))
   At build time these become booking.js / view.js markup and page.css. */
(function () {
  'use strict';
  var doc = document, html = doc.documentElement;
  var AR = '٠١٢٣٤٥٦٧٨٩';
  function ar(n) { return String(n).replace(/\d/g, function (d) { return AR[d]; }); }
  function h(tag, cls, txt) { var n = doc.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var DAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
  var ev = null;
  fetch('event.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { ev = d; run(); }).catch(function () {});
  function minPrice() { var c = ev && ev.booking && ev.booking.pricing && ev.booking.pricing.categories || []; var m = Math.min.apply(null, c.map(function (x) { return x.price; }).filter(function (x) { return x > 0; })); return isFinite(m) ? m : 0; }

  function hero() {
    var hr = doc.querySelector('.evt > .phero'); if (!hr || hr.dataset.s6 || !ev) return; hr.dataset.s6 = '1';
    var d = new Date(ev.startAt + ':00+02:00');
    var media = hr.querySelector('.phero__media');
    if (media && !media.querySelector('.phero__img')) {
      var blk = h('div', 's6-date'); blk.setAttribute('aria-hidden', 'true');
      blk.appendChild(h('span', 's6-date__wd', DAYS[d.getUTCDay()]));
      blk.appendChild(h('b', 's6-date__d', ar(new Date(d.getTime() + 2 * 3600e3).getUTCDate())));
      blk.appendChild(h('span', 's6-date__m', MONTHS[new Date(d.getTime() + 2 * 3600e3).getUTCMonth()]));
      media.appendChild(blk); media.classList.add('s6-media');
    }
    var days = Math.ceil((d - Date.now()) / 864e5);
    var text = hr.querySelector('.phero__text');
    if (text && days > 0) { var c = h('p', 's6-left', days === 1 ? 'بكرة!' : days === 2 ? 'فاضل يومين' : 'فاضل ' + ar(days) + ' أيام'); text.insertBefore(c, text.querySelector('.phero__title')); }
    var p = minPrice();
    if (p && text) { var pr = h('p', 's6-from'); pr.appendChild(h('span', '', 'من')); pr.appendChild(h('b', '', ar(p) + ' جنيه')); pr.appendChild(h('span', '', 'للفرد')); text.appendChild(pr); }
  }

  function sticky() {
    if (doc.querySelector('.s6-dock') || !ev) return;
    var book = doc.getElementById('book'); if (!book) return;
    var dock = h('div', 's6-dock'); var a = h('a', 'btn btn--primary', 'احجز الآن'); a.href = '#book';
    a.addEventListener('click', function (e) { e.preventDefault(); book.scrollIntoView({ behavior: 'smooth' }); });
    var info = h('div', 's6-dock__info'); info.appendChild(h('b', '', ev.shortTitle || ev.title)); var p = minPrice(); if (p) info.appendChild(h('small', '', 'من ' + ar(p) + ' جنيه · فاضل ١٢ مكان'));
    dock.appendChild(info); dock.appendChild(a); doc.body.appendChild(dock);
    new IntersectionObserver(function (es) { dock.classList.toggle('is-off', es[0].isIntersecting || scrollY < 200); }, { rootMargin: '0px 0px -20% 0px' }).observe(book);
    addEventListener('scroll', function () { if (scrollY < 200) dock.classList.add('is-off'); }, { passive: true });
    dock.classList.add('is-off');
  }

  var NAMES = ['مين جاي', 'الدفع', 'التأكيد'];
  function stepper() {
    var prog = doc.querySelector('#book .bk-flow__progress'); if (!prog || prog.dataset.s6) return; prog.dataset.s6 = '1';
    var m = prog.textContent.replace(/[٠-٩]/g, function (d) { return AR.indexOf(d); }).match(/(\d)\D+(\d)/); if (!m) return;
    var cur = +m[1], n = +m[2];
    var ol = h('ol', 's6-steps'); ol.setAttribute('aria-hidden', 'true');
    for (var i = 1; i <= n; i++) { var li = h('li', i < cur ? 'is-done' : i === cur ? 'is-on' : ''); li.appendChild(h('span', 's6-steps__n', i < cur ? '✓' : ar(i))); li.appendChild(h('span', 's6-steps__t', NAMES[i - 1] || '')); ol.appendChild(li); }
    prog.classList.add('visually-hidden'); prog.after(ol);
  }

  function nullFix() {
    [].forEach.call(doc.querySelectorAll('#book .bk-plan-wrap, #book .bk-plan, #book [class*="bk-plan"]'), function (box) {
      [].forEach.call(box.childNodes, function (n) { if (n.nodeType === 3 && n.textContent.trim() === 'null') n.remove(); });
    });
    var w = doc.createTreeWalker(doc.getElementById('book') || doc.body, NodeFilter.SHOW_TEXT);
    var kill = []; while (w.nextNode()) if (w.currentNode.textContent.trim() === 'null') kill.push(w.currentNode);
    kill.forEach(function (n) { n.remove(); });
  }

  function done() {
    var d = doc.querySelector('#book .bk-done'); if (!d || d.dataset.s6) return; d.dataset.s6 = '1';
    d.classList.add('s6-ticket');
    var track = h('ol', 's6-track');
    [['اتبعت', 'is-done'], ['الخادم بيراجع', 'is-on'], ['اتأكد', '']].forEach(function (s) { var li = h('li', s[1]); li.appendChild(h('i')); li.appendChild(h('span', '', s[0])); track.appendChild(li); });
    var st = d.querySelector('.bk-done__status'); (st || d.firstChild).after(track);
    if (ev) {
      var meta = h('div', 's6-ticket__meta');
      var dt = new Date(new Date(ev.startAt + ':00+02:00').getTime() + 2 * 3600e3);
      [['الفعالية', ev.shortTitle || ev.title], ['الميعاد', DAYS[dt.getUTCDay()] + ' ' + ar(dt.getUTCDate()) + ' ' + MONTHS[dt.getUTCMonth()]], ['المكان', ev.location && ev.location.name || '']].forEach(function (r) { var x = h('div'); x.appendChild(h('small', '', r[0])); x.appendChild(h('b', '', r[1])); meta.appendChild(x); });
      var code = d.querySelector('.bk-done__code') || d.querySelector('.bk-done__ref');
      (code || d.firstChild).after(meta);
    }
  }

  function bar() { var b = doc.querySelector('.pbar'); if (b) b.classList.add('s6-bar'); }

  function run() { html.classList.add('s6'); bar(); hero(); sticky(); stepper(); nullFix(); done(); }
  new MutationObserver(function () { run(); }).observe(doc.body, { childList: true, subtree: true });
  doc.addEventListener('DOMContentLoaded', run);
})();
