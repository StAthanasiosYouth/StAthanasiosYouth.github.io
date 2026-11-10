/* S8 — privacy, terms and the 404 page: a layer on the LIVE pages (served with ?s8=1; the 404 by the review server).
   · legal pages: the site's top bar, a contents strip that follows the reading (one chip per section),
     numbered section cards, «باختصار» as the lead card, the English summary folded, a «لفوق» button
   · 404: a real page instead of two lines: the logo, the message in Ruqaa, and the places people usually look for
   Nothing in the text changes. At build time this becomes legal.css / 404.html markup. */
(function () {
  'use strict';
  var doc = document, html = doc.documentElement;
  var AR = '٠١٢٣٤٥٦٧٨٩';
  function ar(n) { return String(n).replace(/\d/g, function (d) { return AR[d]; }); }
  function h(tag, cls, txt) { var n = doc.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  function svg(m) { var t = doc.createElement('template'); t.innerHTML = m.trim(); return t.content.firstChild; }
  html.classList.add('s8');

  function bar() {
    if (doc.querySelector('.s8-bar') || doc.querySelector('.pbar')) return;
    var b = h('header', 's8-bar');
    var brand = h('a', 's8-bar__brand'); brand.href = '/';
    var img = h('img'); img.src = '/assets/img/logo-128.webp'; img.alt = ''; img.width = 36; img.height = 36;
    brand.appendChild(img); brand.appendChild(h('span', '', 'أسرة البابا أثناسيوس'));
    var home = h('a', 's8-bar__home', 'ارجع للموقع'); home.href = '/';
    b.appendChild(brand); b.appendChild(home); doc.body.prepend(b);
  }

  function legal() {
    var main = doc.querySelector('main.legal'); if (!main || main.dataset.s8) return; main.dataset.s8 = '1';
    bar();
    var secs = [].slice.call(main.querySelectorAll(':scope > section'));
    var toc = h('nav', 's8-toc'); toc.setAttribute('aria-label', 'في الصفحة دي');
    var n = 0, k = 0;
    secs.forEach(function (s) {
      var h2 = s.querySelector('h2'); if (!h2) return;
      var title = h2.textContent.trim();
      if (/English/i.test(title)) {
        var d = h('details', 's8-en'); var sum = h('summary', '', title); d.appendChild(sum);
        while (h2.nextSibling) d.appendChild(h2.nextSibling);
        h2.replaceWith(d); s.classList.add('s8-sec', 's8-sec--en'); s.id = s.id || 's8-en';
        var ae = h('a', 's8-toc__en', 'English'); ae.href = '#' + s.id; toc.appendChild(ae); return;
      }
      s.id = s.id || 's8-s' + n;
      if (n === 0 && /باختصار/.test(title)) { s.classList.add('s8-sec', 's8-lead'); n++; return; }
      n++;
      k++; s.classList.add('s8-sec'); h2.prepend(h('span', 's8-num', ar(k)));
      var a = h('a', '', title); a.href = '#' + s.id; toc.appendChild(a);
    });
    var head = main.querySelector('.legal__head'); if (head) head.after(toc);
    var links = [].slice.call(toc.querySelectorAll('a'));
    function spy() { var cur = null; links.forEach(function (a) { var s = doc.querySelector(a.getAttribute('href')); if (s && s.getBoundingClientRect().top < 160) cur = a; }); links.forEach(function (a) { a.classList.toggle('on', a === cur); }); if (cur) { var r = cur.getBoundingClientRect(), tr = toc.getBoundingClientRect(); if (r.left < tr.left || r.right > tr.right) toc.scrollBy({ left: r.left - tr.left - 20, behavior: 'smooth' }); } up.classList.toggle('is-on', scrollY > 600); }
    var up = h('button', 's8-up'); up.type = 'button'; up.setAttribute('aria-label', 'لفوق'); up.appendChild(svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 6-6 6 6"/></svg>'));
    up.addEventListener('click', function () { scrollTo({ top: 0, behavior: 'smooth' }); });
    doc.body.appendChild(up);
    addEventListener('scroll', spy, { passive: true }); spy();
  }

  function notFound() {
    if (html.dataset.shell !== '404') return;
    var main = doc.getElementById('page-main'); if (!main || main.dataset.s8 || main.querySelector('.svc, .evt')) return; main.dataset.s8 = '1';
    var card = h('section', 's8-404');
    var arch = h('div', 's8-404__arch'); var img = h('img'); img.src = '/assets/img/logo-256.webp'; img.alt = ''; arch.appendChild(img);
    card.appendChild(arch);
    card.appendChild(h('p', 's8-404__code', '٤٠٤'));
    card.appendChild(h('h1', 's8-404__t', 'الصفحة دي مش موجودة'));
    card.appendChild(h('p', 's8-404__s', 'ممكن الرابط اتكتب غلط، أو الصفحة اتشالت. جرّب حاجة من دول:'));
    var go = h('div', 's8-404__go');
    [['الرئيسية', '/', 'M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z'], ['الفعاليات', '/events/', 'M4 6.5h16v13H4zM4 10.5h16M8 4v4M16 4v4'], ['حسابي', '/account/', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0'], ['نقاطي', '/points/', 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z']].forEach(function (x) {
      var a = h('a', 's8-404__a'); a.href = x[1];
      a.appendChild(svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + x[2] + '"/></svg>'));
      a.appendChild(h('span', '', x[0])); go.appendChild(a);
    });
    card.appendChild(go);
    var home = h('a', 'btn btn--primary s8-404__home', 'افتح الصفحة الرئيسية'); home.href = '/';
    card.appendChild(home);
    main.replaceChildren(card);
  }

  function run() { legal(); notFound(); }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', run); else run();
})();
