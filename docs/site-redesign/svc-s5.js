/* S5 — the service pages redesign, a layer on the LIVE page engine (black-theatre/, silenttheatre/; served with ?s5=1).
   The engine draws the page from page.json; this re-arranges and adds, never changes what the engine does:
   · the bar like the home (logo + the name in Ruqaa)
   · under the banner: «▶ اتفرّج على أحدث عرض» (opens the first clip in the live player) and «شارك»
   · a section bar that follows the scroll: العروض · عن الخدمة · الفريق
   · the shows first; on each card the clip's length and «شاهد المسرحية كاملة ↗» (the page's own fullUrl)
   · «عن الخدمة» as a card with the partner's logo; the team as cards; «خدمات تانية» from content.json; share at the end
   At build time this becomes the engine's own markup (page/view.js) and page.css. */
(function () {
  'use strict';
  var doc = document, html = doc.documentElement;
  var AR = '٠١٢٣٤٥٦٧٨٩';
  function ar(n) { return String(n).replace(/\d/g, function (d) { return AR[d]; }); }
  function h(tag, cls, txt) { var n = doc.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  function svg(m) { var t = doc.createElement('template'); t.innerHTML = m.trim(); return t.content.firstChild; }
  var IC = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4M8.2 13.2l7.6 4"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/></svg>',
    film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M3.5 9.5h17M3.5 14.5h17M8 5v14M16 5v14"/></svg>'
  };
  var data = null;
  var here = location.pathname.split('/')[1];
  fetch('page.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { data = d; decorate(); }).catch(function () {});
  var others = [];
  fetch('../content.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) { others = (c.pages || []).filter(function (p) { return p.slug !== here; }); decorate(); }).catch(function () {});

  function done(el) { if (!el || el.dataset.s5) return true; el.dataset.s5 = '1'; return false; }
  function section(el, id) { if (el) el.id = el.id || id; return el; }

  function decorate() {
    var main = doc.getElementById('page-main'), svc = main && main.querySelector('article.svc');
    if (!svc) return;
    html.classList.add('s5');
    var hero = svc.querySelector('.phero'), about = svc.querySelector('.pg-about'), mediaHead = svc.querySelector('#media-title'), team = svc.querySelector('.team');
    var media = mediaHead && mediaHead.closest('.pg-section');
    section(media, 's5-shows'); section(about, 's5-about'); section(team, 's5-team');

    /* under the banner: the two actions */
    if (hero && !done(hero)) {
      var acts = h('div', 's5-acts');
      var first = svc.querySelector('[data-media]');
      if (first) { var play = h('button', 'btn btn--primary s5-play'); play.type = 'button'; play.appendChild(svg('<span class="s5-ic">' + IC.play + '</span>')); play.appendChild(h('span', '', 'اتفرّج على أحدث عرض')); play.addEventListener('click', function () { first.click(); }); acts.appendChild(play); }
      var sh = h('button', 'btn s5-share'); sh.type = 'button'; sh.appendChild(svg('<span class="s5-ic">' + IC.share + '</span>')); sh.appendChild(h('span', '', 'شارك'));
      sh.addEventListener('click', function () { var u = location.origin + location.pathname; if (navigator.share) navigator.share({ title: doc.title, url: u }).catch(function () {}); else if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { sh.lastChild.textContent = 'اتنسخ اللينك ✓'; }); });
      acts.appendChild(sh);
      hero.querySelector('.phero__text').appendChild(acts);
    }

    /* the section bar */
    if (!svc.querySelector('.s5-tabs')) {
      var tabs = h('nav', 's5-tabs'); tabs.setAttribute('aria-label', 'أقسام الصفحة');
      [[media, 'العروض'], [about, 'عن الخدمة'], [team, 'الفريق']].forEach(function (t) { if (!t[0]) return; var a = h('a', '', t[1]); a.href = '#' + t[0].id; tabs.appendChild(a); });
      if (tabs.children.length > 1) { hero.after(tabs); spy(tabs); }
    }

    /* the shows first */
    if (media && about && media.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_PRECEDING) about.before(media);

    /* each show: its length and the full play */
    if (data && media && !done(media.querySelector('.mgrid'))) {
      (data.media || []).forEach(function (m, i) {
        var btn = media.querySelector('[data-media="' + m.id + '"]'); if (!btn) return;
        var card = btn.closest('.mcard');
        if (i === 0) card.classList.add('s5-latest');
        if (m.clip && m.clip.end) { var sec = Math.max(1, Math.round(m.clip.end - (m.clip.start || 0))); var chip = h('span', 's5-len', 'مقطع · ' + (sec < 60 ? ar(sec) + ' ثانية' : ar(Math.round(sec / 60)) + ' دقيقة')); card.querySelector('.mcard__media').appendChild(chip); }
        if (i === 0) card.querySelector('.mcard__media').appendChild(h('span', 's5-new', 'أحدث عرض'));
        if (m.fullUrl) { var a = h('a', 's5-full'); a.href = m.fullUrl; a.target = '_blank'; a.rel = 'noopener'; a.appendChild(h('span', '', m.ctaLabel || 'شاهد كاملة')); a.appendChild(svg('<span class="s5-ic">' + IC.ext + '</span>')); card.querySelector('.mcard__body').appendChild(a); }
      });
    }

    /* «عن الخدمة»: a titled card with the partner */
    if (about && !done(about)) {
      about.prepend(h('h2', 'pg-head__title s5-h', 'عن الخدمة'));
      var p = data && data.partner;
      if (p && p.logo) { var plate = h('div', 's5-partner'); var im = h('img'); im.src = '../' + (p.logo.thumb || p.logo.src); im.alt = p.logo.alt || ''; plate.appendChild(im); plate.appendChild(h('span', '', 'بالتعاون مع ' + (p.name || ''))); about.appendChild(plate); }
    }

    /* «خدمات تانية» */
    if (others.length && !svc.querySelector('.s5-more')) {
      var more = h('section', 'pg-section s5-more'); more.appendChild(h('h2', 'pg-head__title s5-h', 'خدمات تانية'));
      var ul = h('ul', 's5-more__list');
      others.forEach(function (o) {
        var li = h('li'), a = h('a', 's5-more__card'); a.href = '../' + o.slug + '/index.html?s5=1';
        if (o.cover) { var im = h('img'); im.src = '../' + (o.cover.thumb || o.cover.src); im.alt = ''; im.loading = 'lazy'; a.appendChild(im); }
        var b = h('div', 's5-more__body'); b.appendChild(h('b', '', o.title)); if (o.tagline) b.appendChild(h('small', '', o.tagline)); a.appendChild(b);
        a.appendChild(svg('<span class="s5-more__go" aria-hidden="true">‹</span>'));
        li.appendChild(a); ul.appendChild(li);
      });
      more.appendChild(ul); svc.appendChild(more);
    }
  }

  function spy(tabs) {
    var links = [].slice.call(tabs.querySelectorAll('a'));
    function mark() {
      var y = 140, cur = links[0];
      links.forEach(function (a) { var s = doc.querySelector(a.getAttribute('href')); if (s && s.getBoundingClientRect().top < y) cur = a; });
      links.forEach(function (a) { a.classList.toggle('on', a === cur); });
    }
    addEventListener('scroll', mark, { passive: true }); mark();
  }

  new MutationObserver(function () { decorate(); }).observe(doc.getElementById('page-main') || doc.body, { childList: true, subtree: false });
  doc.addEventListener('DOMContentLoaded', decorate);
})();
