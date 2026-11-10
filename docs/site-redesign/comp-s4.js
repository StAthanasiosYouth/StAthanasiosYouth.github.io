/* S4 — the competitions redesign, a layer inside the LIVE engine page (competition/index.html, injected by comp-final.html).
   The engine redraws #comp-main on every step; this decorates each drawing (idempotent) and never changes what the engine does:
   · top bar like the home (logo + the name in Ruqaa); the timer gets a ring that empties with the time
   · intro: a drawn hero when there is no banner, the numbers as three tiles, «فاضل …» on the deadline, the instructions as steps
   · scheduled / closed: the status as a big Ruqaa line
   · questions: the question numbers always on show as a strip (answered ones filled), letters on the choices
   · review: a ring of how many are answered
   · result: a score ring, «+٣٥ نقطة» and a short gold burst; the answers as ✓ / ✕ cards
   At build time these become the engine's own markup (view.js) and comp.css; nothing here talks to the server. */
(function () {
  'use strict';
  var doc = document, html = doc.documentElement;
  var AR = '٠١٢٣٤٥٦٧٨٩';
  function ar(n) { return String(n).replace(/\d/g, function (d) { return AR[d]; }); }
  function en(s) { return String(s).replace(/[٠-٩]/g, function (d) { return AR.indexOf(d); }); }
  function h(tag, cls, txt) { var n = doc.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  function svgEl(markup) { var t = doc.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; }
  var IC = {
    q: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8h.01"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M9.5 17h5"/></svg>'
  };
  var parentSample = (function () { try { return window.parent.S4_SAMPLE; } catch (e) { return null; } })();

  /* ---------- top bar ---------- */
  function bar() {
    var cbar = doc.querySelector('.cbar'); if (!cbar || cbar.dataset.s4) return;
    cbar.dataset.s4 = '1';
  }

  /* the timer ring: the engine writes mm:ss every second */
  var LIMIT = parentSample && parentSample.definition.timeLimit ? parentSample.definition.timeLimit * 60 : 0;
  function timer() {
    var t = doc.getElementById('comp-timer'); if (!t || t.hidden) return;
    var c = t.querySelector('.cbar__clock'); if (!c) return;
    if (!t.querySelector('.s4-ring')) t.prepend(svgEl('<svg class="s4-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" pathLength="100"/><circle class="s4-ring__on" cx="18" cy="18" r="15" pathLength="100"/></svg>'));
    var m = en(c.textContent).match(/(\d+):(\d+)/); if (!m || !LIMIT) return;
    var left = (+m[1]) * 60 + (+m[2]), f = Math.max(0, Math.min(1, left / LIMIT));
    t.querySelector('.s4-ring__on').style.strokeDashoffset = String(100 - f * 100);
    t.classList.toggle('s4-low', left <= 60);
  }

  /* ---------- intro / scheduled / closed ---------- */
  function intro(main) {
    var step = main.querySelector('.step.intro'); if (!step || step.dataset.s4) return;
    step.dataset.s4 = '1';
    var hero = step.querySelector('.hero');
    if (hero && hero.querySelector('.hero__art')) hero.classList.add('s4-hero');
    var chips = step.querySelector('.chips');
    if (chips) {
      var items = [].slice.call(chips.children);
      var stats = h('div', 's4-stats');
      [[IC.q, /أسئلة|سؤال/], [IC.star, /نقط/], [IC.clock, /الوقت|دقايق|دقيقة/]].forEach(function (k) {
        var c = items.filter(function (li) { return k[1].test(li.textContent); })[0]; if (!c) return;
        var txt = c.textContent.replace('الوقت', '').trim(), num = (txt.match(/[٠-٩\d]+/) || [''])[0], label = txt.replace(num, '').trim();
        var tile = h('div', 's4-stat'); tile.appendChild(svgEl('<span class="s4-stat__ic">' + k[0] + '</span>'));
        tile.appendChild(h('b', 's4-stat__n', num)); tile.appendChild(h('span', 's4-stat__l', label));
        stats.appendChild(tile); c.hidden = true;
      });
      var until = items.filter(function (li) { return /لحد|متاحة/.test(li.textContent); })[0];
      chips.after(stats);
      if (until) {
        var line = h('p', 's4-until'); line.appendChild(svgEl('<span class="s4-until__ic">' + IC.clock + '</span>'));
        line.appendChild(h('span', '', until.textContent.trim()));
        if (main.dataset.state === 'intro') { var e = parentSample && parentSample.definition.endAt, d = e ? Math.ceil((Date.parse(e + ':00+02:00') - Date.now()) / 864e5) : 0; if (d > 0) line.appendChild(h('b', 's4-until__left', d === 1 ? 'آخر يوم' : d === 2 ? 'فاضل يومين' : 'فاضل ' + ar(d) + (d <= 10 ? ' أيام' : ' يوم'))); }
        stats.after(line); until.hidden = true;
      }
      if (!chips.querySelector('li:not([hidden])')) chips.hidden = true;
    }
    // scheduled / closed: the status is the news, so it leads the card; «فكّرني» before a start
    var status = step.querySelector('.status'), body = step.querySelector('.intro__body');
    if (status && body) {
      body.prepend(status);
      if (status.classList.contains('status--soon')) { var bell = h('button', 'btn btn--primary s4-remind', 'فكّرني لما تبدأ'); bell.type = 'button'; bell.addEventListener('click', function () { bell.textContent = 'هنفكّرك ✓'; bell.disabled = true; }); status.after(bell); }
    }
    var note = step.querySelector('.note__text');
    if (note && !note.dataset.s4) {
      note.dataset.s4 = '1';
      var lines = note.textContent.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      if (lines.length > 1) { var ol = h('ol', 's4-steps'); lines.forEach(function (l) { ol.appendChild(h('li', '', l)); }); note.replaceWith(ol); }
    }
    var cta = step.querySelector('[data-cta]');
    if (cta && parentSample && parentSample.definition.wallet && !step.querySelector('.s4-reward')) {
      var r = h('p', 's4-reward'); r.appendChild(svgEl('<span>' + IC.star + '</span>'));
      r.appendChild(h('span', '', 'اكسب لحد ' + ar(40) + ' نقطة تتضاف لرصيدك في «نقاطي»'));
      cta.closest('.actions').before(r);
    }
  }

  /* ---------- questions ---------- */
  function question(main) {
    var jump = main.querySelector('details.jump');
    if (jump) { jump.open = true; jump.classList.add('s4-jump'); }
    [].forEach.call(main.querySelectorAll('.q.card'), function (q) {
      if (q.dataset.s4) return; q.dataset.s4 = '1';
      var cur = main.querySelector('.jump__btn.is-current');
      if (cur && main.dataset.state === 'question') { var n = h('span', 's4-qnum', cur.textContent.trim()); n.setAttribute('aria-hidden', 'true'); q.prepend(n); }
      var L = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];
      [].forEach.call(q.querySelectorAll('.choice'), function (c, i) { var b = h('span', 's4-letter', L[i] || ''); b.setAttribute('aria-hidden', 'true'); c.insertBefore(b, c.querySelector('.choice__text')); });
    });
  }

  /* ---------- review ---------- */
  function review(main) {
    var sec = main.querySelector('.review'); if (!sec || sec.dataset.s4) return; sec.dataset.s4 = '1';
    var cnt = sec.querySelector('.review__count'); if (!cnt) return;
    var m = en(cnt.textContent).match(/(\d+)\D+(\d+)/); if (!m) return;
    var f = +m[1] / +m[2];
    var ring = svgEl('<div class="s4-donut" aria-hidden="true"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" pathLength="100"/><circle class="on" cx="60" cy="60" r="52" pathLength="100" style="stroke-dashoffset:' + (100 - f * 100) + '"/></svg><b>' + ar(m[1]) + '<small>من ' + ar(m[2]) + '</small></b></div>');
    cnt.before(ring);
  }

  /* ---------- result ---------- */
  function result(main) {
    var card = main.querySelector('.result__card'); if (!card || card.dataset.s4) return; card.dataset.s4 = '1';
    var score = card.querySelector('[data-kind="score"]'), pts = card.querySelector('[data-kind="points"]');
    var r = parentSample ? parentSample.result({}) : null;
    if (r && r.maxScore) {
      var f = r.score / r.maxScore;
      var ring = svgEl('<div class="s4-score" aria-hidden="true"><svg viewBox="0 0 160 160"><defs><linearGradient id="s4g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--gold-hi)"/><stop offset="1" stop-color="var(--gold)"/></linearGradient></defs><circle cx="80" cy="80" r="68" pathLength="100"/><circle class="on" cx="80" cy="80" r="68" pathLength="100" style="--to:' + (100 - f * 100) + '"/></svg><b>' + ar(r.score) + '<small>من ' + ar(r.maxScore) + '</small></b></div>');
      var badge = card.querySelector('.result__badge'); if (badge) badge.replaceWith(ring); else card.prepend(ring);
      if (score) score.hidden = true;
    }
    if (pts && r && r.pointsAwarded) {
      var chip = h('p', 's4-earned'); chip.appendChild(svgEl('<span>' + IC.star + '</span>'));
      chip.appendChild(h('b', '', '+' + ar(r.pointsAwarded) + ' نقطة')); chip.appendChild(h('span', '', 'اتضافت لرصيدك'));
      pts.replaceWith(chip);
      var go = h('a', 'btn s4-points', 'روح لنقاطي'); go.href = '../points/';
      var acts = card.querySelector('.actions'); if (acts) acts.prepend(go);
    }
    if (!html.classList.contains('s4-still')) burst(card);
  }
  function burst(card) {
    var b = h('div', 's4-burst'); b.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 26; i++) { var p = h('i'); p.style.setProperty('--a', (i * 360 / 26) + 'deg'); p.style.setProperty('--d', (60 + (i % 5) * 22) + 'px'); p.style.setProperty('--t', (i % 3) * 60 + 'ms'); b.appendChild(p); }
    card.appendChild(b); setTimeout(function () { b.remove(); }, 1600);
  }

  function decorate() {
    var main = doc.getElementById('comp-main'); if (!main) return;
    bar(); timer();
    var s = main.dataset.state;
    if (s === 'intro' || s === 'scheduled' || s === 'closed') intro(main);
    if (s === 'question' || s === 'single') question(main);
    if (s === 'review') review(main);
    if (s === 'result') result(main);
  }
  if (/[?&]still=1/.test(window.parent.location.search)) html.classList.add('s4-still');
  var queued = false;
  new MutationObserver(function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; decorate(); }); })
    .observe(doc.body, { childList: true, subtree: true, characterData: true });
  decorate();
})();
