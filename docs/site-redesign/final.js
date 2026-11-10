/* S2 FINAL — the redesign layer on top of the LIVE home page (final.html loads the real main.css / main.js / content.json).
   Everything the live site already does keeps working because it IS the live code: the scenes on تابعنا and صوتك يهمنا,
   the ringing phone card, the support chat card, the meeting card and its week journey, the map, share/QR, the bell,
   the sound, the floating bottom bar. This file only re-arranges the page and adds the new parts:
     · the top bar always compact with the logo (the big hero is gone; the logo lives in the intros)
     · Suggestions on top: slides that turn by themselves (the live «صوتك يهمنا» card + service slides), dots, quick chips
     · the guest account nudge / the member greeting
     · «الفعاليات الجاية» and «جديد الأسرة» rails (examples marked «مثال»: nothing is published today)
     · «خدماتنا» as a slider on the phone, «الكل ‹» on each section
     · desktop: Suggestions and the meeting side by side on top
   ?v=guest (default) | member · ?intro=1 plays the member intro (member) · ?still=1 stops the slides for screenshots */
(function () {
  'use strict';
  var Q = new URLSearchParams(location.search);
  var V = Q.get('v') === 'member' ? 'member' : 'guest';
  var STILL = !!Q.get('still');
  var html = document.documentElement;
  html.setAttribute('data-s2', V);
  if (STILL) html.classList.add('s2-still');
  var I = window.SITE_ICONS || {};
  function ic(n) { return I[n] || I.link || ''; }
  var D = 'docs/site-redesign/';
  var M = 'media/2026/';

  var EVENTS = [
    { d: '١٤', m: 'نوفمبر', t: 'يوم ترفيهي على البحر', s: 'السبت · من ٩ الصبح', img: M + 'img-53ca69a3.webp', tag: 'احجز مكانك' },
    { d: '٢٠', m: 'نوفمبر', t: 'رحلة دير الأنبا أنطونيوس', s: 'الجمعة · يوم كامل', img: M + 'img-8ffd40eb.webp', tag: 'فاضل ١٢ مكان' },
    { d: '١٨', m: 'ديسمبر', t: 'مؤتمر الشباب ٢٠٢٦', s: '١٨–٢٠ ديسمبر', img: M + 'img-af6b0c28.webp', tag: 'التسجيل قريب' }
  ];
  var NEWS = [['megaphone', 'ميعاد مؤتمر الشباب اتحدد', 'النهارده', true], ['calendar', 'اجتماع الأحد في القاعة الكبيرة', 'من يومين', false], ['trophy', 'نتيجة مسابقة الكتاب المقدس', 'الأسبوع اللي فات', false]];

  function el(h) { var t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; }
  function head(icon, title, href, count) {
    return '<div class="section-head s2-head"><h2 class="widget__title">' + ic(icon) + title + '</h2>' +
      (href ? '<a class="s2-all" href="' + href + '">الكل' + (count ? ' (' + count + ')' : '') + ' ‹</a>' : '') +
      '<span class="s2-arrows"><button type="button" data-dir="1" aria-label="السابق">' + ic('chevron') + '</button><button type="button" data-dir="-1" aria-label="التالي">' + ic('chevron') + '</button></span></div>';
  }
  function allHref(page) { return D + 'home.html?v=' + V + '&page=' + page; }

  /* ---------- build once the live page has rendered its widgets ---------- */
  var hub = document.getElementById('main');
  var done = false;
  function ready() { return hub.querySelector('article.featured') && hub.querySelector('.items--services') && hub.querySelector('.person-card.support') && hub.querySelector('footer.footer'); }

  function apply() {
    if (done || !ready()) return;
    done = true;
    var q = function (s) { return hub.querySelector(s); };
    var featured = q('article.featured'), meeting = q('section.meeting'), services = q('.items--services'), location_ = q('section.location'),
      social = q('.links-section'), contact = q('.person-card.contact'), support = q('.person-card.support'), share = q('section.share'), footer = q('footer.footer');

    /* Suggestions: the live featured card is slide 1; the services become the next slides (same card markup) */
    var sugg = el('<section class="s2-sugg" data-area="s2-sugg" aria-label="مقترحات"><div class="s2-sugg__track"></div><div class="s2-sugg__dots"></div><div class="s2-chips"></div></section>');
    var track = sugg.querySelector('.s2-sugg__track');
    track.appendChild(featured);
    [['المسرح الأسود', 'حكايات بالنور والظل… ورسالة بتوصل من غير كلام', 'img-09d4476b', 'black-theatre/', 'theatre', 'خدماتنا'],
     ['المسرح صامت', 'فن بلا كلمات… ورسالة تلمس القلوب', 'img-685492a2', 'silenttheatre/', 'theatre', 'خدماتنا']].forEach(function (s) {
      var c = featured.cloneNode(true);
      c.classList.remove('is-new'); c.removeAttribute('data-dynamic');
      var img = c.querySelectorAll('.section-banner img');
      [].forEach.call(img, function (im) { im.src = M + s[2] + '-480.webp'; im.removeAttribute('srcset'); im.removeAttribute('data-srcset'); im.loading = 'eager'; });
      var a = c.querySelector('.featured__title a'); a.textContent = s[0]; a.href = s[3]; a.removeAttribute('data-experience'); a.removeAttribute('aria-haspopup'); a.removeAttribute('target');
      c.querySelector('.featured__text').textContent = s[1];
      var cta = c.querySelector('.featured__cta'); cta.firstChild.textContent = 'ادخل صفحة الفريق';
      var art = c.querySelector('.featured__art'); if (art) art.innerHTML = ic(s[4]);
      track.appendChild(c);
    });
    [].forEach.call(track.children, function (s, i) { s.classList.add('s2-slide'); s.insertAdjacentHTML('afterbegin', '<span class="s2-slide__tag">' + (i ? ic('theatre') + 'خدماتنا' : ic('star') + 'مميز') + '</span>'); });
    var dots = sugg.querySelector('.s2-sugg__dots');
    dots.innerHTML = [].map.call(track.children, function (s, i) { return '<button type="button" aria-label="شريحة ' + (i + 1) + '"' + (i ? '' : ' class="on"') + '><i></i></button>'; }).join('');
    var chips = [['calendar', 'الاجتماع الجاي', '#s2-meet'], ['map', 'مكان الاجتماع', '#location-map'], ['trophy', 'المسابقات', 'competition/'], ['star', V === 'member' ? 'نقاطي: ٠' : 'نقاطي', 'points/'], ['phone', 'كلّم الخدمة', '#s2-contact']];
    sugg.querySelector('.s2-chips').innerHTML = chips.map(function (c) { return '<a class="s2-chip" href="' + c[2] + '">' + ic(c[0]) + c[1] + '</a>'; }).join('');

    /* side column: the account nudge / greeting + the live meeting card */
    var side = el('<div class="s2-side" data-area="s2-side"></div>');
    side.appendChild(V === 'guest'
      ? el('<div class="widget s2-join"><span class="s2-join__ic">' + ic('user') + '</span><div><b>اعمل حسابك في دقيقة</b><small>علشان تحجز في الفعاليات، وتتابع نقطك والمسابقات</small></div><a class="btn btn--primary btn--small" href="account/">اعمل حساب</a><button class="s2-join__x" type="button" aria-label="مش دلوقتي">×</button></div>')
      : el('<div class="widget s2-join s2-join--member"><span class="s2-join__av">م</span><div><b>أهلًا يا مينا 👋</b><small>نقطك ٠ · مفيش حجوزات مستنية</small></div><button class="s2-join__tint" type="button"><i></i>لون الموقع</button></div>'));
    meeting.id = meeting.id || 's2-meet';
    side.appendChild(meeting);

    /* new sections */
    var events = el('<section class="widget s2-sec" data-area="s2-events" aria-label="الفعاليات الجاية">' + head('calendar', 'الفعاليات الجاية', allHref('events'), EVENTS.length) +
      '<div class="s2-rail s2-rail--ev">' + EVENTS.map(function (e) { return '<a class="s2-ev" href="' + allHref('events') + '"><span class="s2-ex">مثال</span><img src="' + e.img + '" alt="" loading="lazy"><div class="s2-ev__body"><span class="s2-ev__date"><b>' + e.d + '</b><small>' + e.m + '</small></span><h3>' + e.t + '</h3><p>' + e.s + '</p><span class="s2-ev__tag">' + e.tag + '</span></div></a>'; }).join('') + '</div></section>');
    var news = el('<section class="widget s2-sec" data-area="s2-news" aria-label="جديد الأسرة">' + head('megaphone', 'جديد الأسرة', allHref('news'), NEWS.length) +
      '<div class="s2-rail s2-rail--nw">' + NEWS.map(function (n) { return '<a class="s2-nw" href="' + allHref('news') + '"><span class="s2-nw__ic">' + ic(n[0]) + '</span><div><b>' + n[1] + '</b><small>' + n[2] + '</small></div>' + (n[3] ? '<span class="s2-nw__new">جديد</span>' : '') + '<span class="s2-ex s2-ex--b">مثال</span></a>'; }).join('') + '</div></section>');

    /* «خدماتنا»: same live cards, a slider on the phone, «الكل ‹» in its head */
    var sh = services.querySelector('.section-head');
    if (sh) { sh.classList.add('s2-head'); sh.insertAdjacentHTML('beforeend', '<a class="s2-all" href="' + allHref('services') + '">الكل (2) ‹</a>'); }
    services.querySelector('.items__list').classList.add('s2-rail', 's2-rail--sv');

    contact.id = contact.id || 's2-contact';
    var people = el('<div class="s2-people" data-area="s2-people"></div>');
    people.appendChild(contact); people.appendChild(support);

    /* the order */
    [sugg, side, events, services, news, location_, social, people, share, footer].forEach(function (n) { if (n) hub.appendChild(n); });
    html.classList.add('s2-ready');

    slides(track, dots);
    [].forEach.call(document.querySelectorAll('.s2-head .s2-arrows button'), function (b) {
      b.addEventListener('click', function () { var r = b.closest('.widget').querySelector('.s2-rail'); r.scrollBy({ left: Number(b.dataset.dir) * r.clientWidth * .8, behavior: 'smooth' }); });
    });
    var tb = document.querySelector('.s2-join__tint'); if (tb) tb.addEventListener('click', function () { window.S2Tint && window.S2Tint.open(); });
    window.S2_TOAST = function (t) { var el = document.getElementById('toast'); if (!el) return; el.textContent = t; el.classList.add('is-visible'); clearTimeout(window.S2_TOAST.t); window.S2_TOAST.t = setTimeout(function () { el.classList.remove('is-visible'); }, 2400); };
    var x = document.querySelector('.s2-join__x'); if (x) x.addEventListener('click', function () { x.closest('.s2-join').remove(); });
    if (window.S2_RUN_INTRO) requestAnimationFrame(function () { requestAnimationFrame(window.S2_RUN_INTRO); });
  }

  /* Suggestions: one slide per view, turns by itself every 5 s, stops while touched */
  function slides(track, dots) {
    var n = track.children.length, cur = 0, timer = null;
    function go(i, smooth) { cur = (i + n) % n; var s = track.children[cur]; track.scrollTo({ left: s.offsetLeft - track.offsetLeft - (track.clientWidth - s.clientWidth) / 2, behavior: smooth === false ? 'auto' : 'smooth' }); mark(); }
    function mark() { [].forEach.call(dots.children, function (d, i) { d.classList.toggle('on', i === cur); }); }
    function arm() { clearInterval(timer); if (!STILL) timer = setInterval(function () { go(cur + 1); }, 5000); }
    track.addEventListener('scroll', function () {
      var mid = track.getBoundingClientRect().left + track.clientWidth / 2, best = 0, bd = 1e9;
      [].forEach.call(track.children, function (s, i) { var r = s.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - mid); if (d < bd) { bd = d; best = i; } });
      if (best !== cur) { cur = best; mark(); }
    }, { passive: true });
    ['pointerdown', 'touchstart'].forEach(function (t) { track.addEventListener(t, arm, { passive: true }); });
    [].forEach.call(dots.children, function (d, i) { d.addEventListener('click', function () { go(i); arm(); }); });
    arm();
  }

  var mo = new MutationObserver(function () { apply(); if (done) mo.disconnect(); });
  mo.observe(hub, { childList: true, subtree: true });
  apply();
})();
