/* S7 — account + «نقاطي» redesign, a layer on the LIVE pages (account/, points/; served with ?s7=1).
   The pages already got their own design in Phase 6; this keeps it and adds:
   · account: «لون الموقع» (S3) in «حسابي», opening the colour sheet (tint.js) right here
   · store: every prize in one grid (two on a phone, no half-empty rows), filter chips by category,
     the category on each card, a picture per kind instead of the same cup, and on a prize the balance
     can't cover yet a bar «فاضلك ٣٠ نقطة» instead of «رصيدك مش كفاية»
   At build time these become account/home.js, comp/portal.js and their CSS. */
(function () {
  'use strict';
  var doc = document, html = doc.documentElement;
  var AR = '٠١٢٣٤٥٦٧٨٩';
  function ar(n) { return String(n).replace(/\d/g, function (d) { return AR[d]; }); }
  function en(s) { return String(s).replace(/[٠-٩]/g, function (d) { return AR.indexOf(d); }).replace(/[٬,]/g, ''); }
  function h(tag, cls, txt) { var n = doc.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  function svg(m) { var t = doc.createElement('template'); t.innerHTML = m.trim(); return t.content.firstChild; }
  html.classList.add('s7');
  var ART = {
    'هدايا': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v7h14v-7M12 8.5v11M12 8.5S10.5 4 8 4.5 7 8.5 12 8.5ZM12 8.5S13.5 4 16 4.5s1 4-4 4Z"/></svg>',
    'كتب': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3Z"/><path d="M5 16.5a3 3 0 0 1 3-3h11M12 7v4M10 9h4"/></svg>',
    'لبس': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M9 4 4 6.5 5.5 11 8 10v10h8V10l2.5 1L20 6.5 15 4c-.6 1.3-1.7 2-3 2s-2.4-.7-3-2Z"/></svg>',
    'خصومات': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12V5.5a2 2 0 0 1 2-2H12l8.5 8.5-8.5 8.5Z"/><circle cx="8" cy="8" r="1.4"/><path d="m10 15 5-5"/></svg>'
  };

  /* ---------- account: «لون الموقع» in «حسابي» ---------- */
  function account() {
    var rows = [].slice.call(doc.querySelectorAll('a.ac-row[href="#me/notifications"]'));
    rows.forEach(function (n) {
      var li = n.closest('li') || n; if (li.parentElement.querySelector('[data-s7-tint]')) return;
      var row = h('button', 'ac-row'); row.type = 'button'; row.dataset.s7Tint = '1';
      row.appendChild(svg('<span class="s7-row-ic" aria-hidden="true"><i></i></span>'));
      var body = h('span', 'ac-row__body'); body.appendChild(h('span', 'ac-row__t', 'لون الموقع')); body.appendChild(h('span', 'ac-row__s', 'الموقع بيفتح باللون اللي تختاره'));
      row.appendChild(body);
      var go = n.querySelector('.ac-row__go'); if (go) row.appendChild(go.cloneNode(true));
      row.addEventListener('click', function () { if (window.S2Tint) window.S2Tint.open(); });
      if (li === n) { row.className = n.className; li.after(row); } else { var nli = h('li'); nli.appendChild(row); li.after(nli); }
    });
  }

  /* ---------- store ---------- */
  var cat = 'الكل';
  function store() {
    var groups = [].slice.call(doc.querySelectorAll('.shop__group'));
    if (!groups.length) return;
    var first = groups[0]; if (first.dataset.s7) return; first.dataset.s7 = '1';
    var balance = +(en((doc.querySelector('.portal__balance') || {}).textContent || '').match(/\d+/) || [0])[0];
    var all = h('div', 'shop s7-shop'), cats = [];
    groups.forEach(function (g) {
      var name = ((g.querySelector('.shop__cat') || {}).textContent || '').trim();
      if (name) cats.push(name);
      [].slice.call(g.querySelectorAll('.shop__item')).forEach(function (it) {
        it.dataset.cat = name;
        var media = it.querySelector('.shop__media--art');
        if (media && ART[name]) { media.innerHTML = ''; media.appendChild(svg('<span class="s7-art">' + ART[name] + '</span>')); }
        var body = it.querySelector('.shop__body'); if (body && name) body.prepend(h('span', 's7-cat', name));
        var off = it.querySelector('.shop__off'), cost = +(en((it.querySelector('.shop__cost') || {}).textContent || '').match(/\d+/) || [0])[0];
        if (off && cost > balance && /كفاية/.test(off.textContent)) {
          var need = h('div', 's7-need'); var bar = h('span', 's7-need__bar'); var fill = h('i'); fill.style.width = Math.round(balance / cost * 100) + '%'; bar.appendChild(fill);
          need.appendChild(bar); need.appendChild(h('span', 's7-need__t', 'فاضلك ' + ar(cost - balance) + ' نقطة'));
          off.replaceWith(need);
        }
        all.appendChild(it);
      });
    });
    var chips = h('div', 's7-cats'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'الأنواع');
    ['الكل'].concat(cats).forEach(function (c) {
      var b = h('button', c === cat ? 'on' : '', c); b.type = 'button';
      b.addEventListener('click', function () { cat = c; [].forEach.call(chips.children, function (x) { x.classList.toggle('on', x === b); }); [].forEach.call(all.children, function (it) { it.hidden = c !== 'الكل' && it.dataset.cat !== c; }); });
      chips.appendChild(b);
    });
    first.before(chips); first.before(all);
    groups.forEach(function (g) { g.remove(); });
  }

  function run() { account(); store(); }
  new MutationObserver(run).observe(doc.body || doc.documentElement, { childList: true, subtree: true });
  doc.addEventListener('DOMContentLoaded', run);
})();
