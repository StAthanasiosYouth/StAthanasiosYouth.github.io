/* S2 — the members' home, built from the live content (content.json, 2026-11-10) and examples where a section is empty today. */
(function () {
  var Q = new URLSearchParams(location.search);
  var V = Q.get('v') === 'member' ? 'member' : 'guest';
  var PAGE = Q.get('page') || '';
  if (Q.get('still')) document.documentElement.classList.add('still');
  var I = window.SITE_ICONS || {};
  function ic(n) { return I[n] || I.link || ''; }
  var M = '../../media/2026/', A = '../../assets/img/';
  var ARROW = '<svg class="icon icon--line" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>';
  var ARROW_R = '<svg class="icon icon--line" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';
  var i = 0; function rise(h) { return h.replace(/class="(slide|join|meet|sec|ev|sv|nw|soc|ct)( |")/g, function (m, c, e) { return 'style="--i:' + (i++) + '" class="rise ' + c + e; }); }

  /* real content */
  var SERVICES = [
    { t: 'المسرح الأسود', s: 'حكايات بالنور والظل… ورسالة بتوصل من غير كلام', img: M + 'img-09d4476b-480.webp', kind: 'خدمة' },
    { t: 'المسرح صامت', s: 'فن بلا كلمات… ورسالة تلمس القلوب 🎭', img: M + 'img-685492a2-480.webp', kind: 'خدمة' }
  ];
  var SOCIAL = [['فيسبوك', 'الأخبار والإعلانات', 'facebook', '#1877f2'], ['إنستجرام', 'صور وستوريز', 'instagram', '#e1306c'], ['تيك توك', 'فيديوهات قصيرة', 'tiktok', '#fff'], ['جروب الواتساب', 'أخبارنا أول بأول', 'whatsapp', '#25d366']];
  var CONTACTS = [['ف', 'فادي يوسف', 'أمين الخدمة', 'لأي سؤال أو حاجة تخص الاجتماع والخدمة', 'phone', 'اتصال · 0122 012 9458'], ['م', 'مينا زكريا', 'الدعم الفني', 'لو الموقع مش شغال معاك', 'whatsapp', 'واتساب']];
  /* examples (sections empty today) */
  var EVENTS = [
    { d: '١٤', m: 'نوفمبر', t: 'يوم ترفيهي على البحر', s: 'السبت · من ٩ ص', img: M + 'img-53ca69a3.webp', tag: 'احجز مكانك', k: 'رحلات' },
    { d: '٢٠', m: 'نوفمبر', t: 'رحلة دير الأنبا أنطونيوس', s: 'الجمعة · يوم كامل', img: M + 'img-8ffd40eb.webp', tag: 'فاضل ١٢ مكان', k: 'رحلات' },
    { d: '١٨', m: 'ديسمبر', t: 'مؤتمر الشباب ٢٠٢٦', s: '١٨–٢٠ ديسمبر', img: M + 'img-af6b0c28.webp', tag: 'التسجيل قريب', k: 'مؤتمرات' }
  ];
  var NEWS = [['megaphone', 'ميعاد مؤتمر الشباب اتحدد', 'النهارده', true], ['calendar', 'اجتماع الأحد في القاعة الكبيرة', 'من يومين', false], ['trophy', 'نتيجة مسابقة الكتاب المقدس', 'الأسبوع اللي فات', false]];

  function head(icon, title, href, count) {
    return '<div class="sec__head"><h3>' + ic(icon) + title + '</h3>' + (href && href !== '#' ? '<a class="all" href="' + href + '">الكل' + (count ? ' (' + count + ')' : '') + ' ‹</a><span class="nav"><button aria-label="السابق">' + ARROW_R + '</button><button aria-label="التالي">' + ARROW + '</button></span>' : '') + '</div>';
  }
  function ev(e, ex) { return '<a class="ev" href="#">' + (ex ? '<span class="ex">مثال</span>' : '') + '<img src="' + e.img + '" alt=""><div class="ev__body"><span class="ev__date"><b>' + e.d + '</b><small>' + e.m + '</small></span><h4>' + e.t + '</h4><p>' + e.s + '</p><span class="tag">' + e.tag + '</span></div></a>'; }
  function sv(s) { return '<a class="sv" href="#"><img src="' + s.img + '" alt=""><div class="sv__body"><h4>' + s.t + '</h4><p>' + s.s + '</p><div class="sv__foot"><span class="sv__bug">بإشراف <img src="' + A + 'partners/bug-logo-360.webp" alt="B.U.G"></span><span class="sv__go">' + ARROW + '</span></div></div></a>'; }
  function nw(n, ex) { return '<a class="nw" href="#">' + (ex ? '<span class="ex" style="top:auto;bottom:10px">مثال</span>' : '') + '<span class="nw__ic">' + ic(n[0]) + '</span><div><b>' + n[1] + '</b><small>' + n[2] + '</small></div>' + (n[3] ? '<span class="new">جديد</span>' : '') + '</a>'; }

  function top() {
    return '<header class="top"><div class="wrap"><a class="top__brand" href="?v=' + V + '"><img src="' + A + 'logo-128.webp" alt=""><span><b>أسرة البابا أثناسيوس</b><small>لخدمة شعب كنيستها الحبيبة في سفاجا</small></span></a>' +
      '<button class="tbtn" aria-label="الصوت"><svg class="icon icon--line" viewBox="0 0 24 24"><path class="duo" d="M4 9.5h3.5L12 6v12l-4.5-3.5H4Z"/><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4ZM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg></button><button class="tbtn" aria-label="الإشعارات">' + ic('bell') + '<span class="dot"></span></button>' +
      (V === 'member' ? '<a class="tbtn tbtn--me" href="#">مينا<i>م</i></a>' : '<a class="tbtn tbtn--me" href="#">' + ic('user') + 'ادخل</a>') + '</div></header>';
  }
  function home() {
    var slides = [
      '<div class="slide"><img class="bg" src="' + M + 'img-cadc4835.webp" alt=""><div class="slide__body"><div class="slide__txt"><span class="slide__tag">' + ic('star') + 'مميز</span><h2>صوتك يهمنا</h2><p>قول رأيك، اطلب حد يكلمك، أو اطلب صلاة</p></div><a class="cta" href="#">ابعت دلوقتي ' + ARROW + '</a></div></div>',
      '<div class="slide"><img class="bg" src="' + M + 'img-09d4476b.webp" alt=""><div class="slide__body"><div class="slide__txt"><span class="slide__tag">' + ic('theatre') + 'خدماتنا</span><h2>المسرح الأسود</h2><p>حكايات بالنور والظل… ورسالة بتوصل من غير كلام</p></div><a class="cta" href="#">شوف الصفحة ' + ARROW + '</a></div></div>'
    ];
    var chips = [['calendar', 'الاجتماع الجاي'], ['map', 'مكان الاجتماع'], ['trophy', 'المسابقات'], ['star', V === 'member' ? 'نقاطي: ٠' : 'نقاطي'], ['phone', 'كلّم الخدمة']];
    var h = '<main class="wrap">' +
      '<div class="home"><section class="sugg" aria-label="مقترحات"><div class="sugg__track">' + slides.join('') + '</div><div class="sugg__bar"><i class="on"></i><i></i></div>' +
      '<div class="sugg__chips">' + chips.map(function (c) { return '<a class="chip" href="#">' + ic(c[0]) + c[1] + '</a>'; }).join('') + '</div></section>' +
      '<div class="home__side">' +
      (V === 'guest' ? '<div class="join"><span class="join__ic">' + ic('user') + '</span><div><b>اعمل حسابك في دقيقة</b><small>علشان تحجز وتتابع نقطك والمسابقات</small></div><a class="cta" href="#" style="height:38px;padding:0 14px;font-size:13px">اعمل حساب</a></div>' : '<div class="join" style="background:linear-gradient(90deg, rgb(215 170 80 / .12), rgb(8 33 61 / .7) 60%)"><span class="join__ic" style="font-weight:800">م</span><div><b>أهلًا يا مينا 👋</b><small>نقطك ٠ · مفيش حجوزات مستنية</small></div></div>') +
      '<section class="meet"><div class="meet__day">الأحد<small>كل أسبوع</small></div><div><b>اجتماع الشباب · ٨ بالليل <span class="meet__left">فاضل ٥ أيام</span></b><p>كنيسة أبي سيفين – سفاجا</p></div><a class="cta cta--ghost" href="#">' + ic('calendar') + 'أضف للتقويم</a>' +
      '<div class="week">' + [['اتنين', '٢'], ['تلات', '٣'], ['أربع', '٤', 'today'], ['خميس', '٥'], ['جمعة', '٦'], ['سبت', '٧'], ['أحد', '٨', 'meet-day']].map(function (d) { return '<span class="' + (d[2] || '') + '">' + d[0] + '<b>' + d[1] + '</b></span>'; }).join('') + '</div></section>' +
      '</div></div>' +
      '<section class="sec">' + head('calendar', 'الفعاليات الجاية', '?v=' + V + '&page=events', 3) + '<div class="rail rail--ev">' + EVENTS.map(function (e) { return ev(e, true); }).join('') + '</div></section>' +
      '<section class="sec">' + head('theatre', 'خدماتنا', '?v=' + V + '&page=services', 2) + '<div class="rail rail--sv">' + SERVICES.map(sv).join('') + '</div></section>' +
      '<section class="sec">' + head('megaphone', 'جديد الأسرة', '?v=' + V + '&page=news', 3) + '<div class="rail rail--nw">' + NEWS.map(function (n) { return nw(n, true); }).join('') + '</div></section>' +
      '<section class="sec">' + head('map', 'مكان الاجتماع', '#') + '<div class="place"><div class="place__txt"><b>كنيسة أبي سيفين – سفاجا</b><small>سفاجا، البحر الأحمر</small><div class="place__btns"><a class="cta" href="#">' + ic('map') + 'افتح في الخرائط</a><a class="cta cta--ghost" href="#">الاتجاهات</a></div></div><div class="place__map"></div></div></section>' +
      '<section class="sec">' + head('users', 'تابعنا', '#') + '<div class="rail rail--soc">' + SOCIAL.map(function (s) { return '<a class="soc" href="#"><i style="color:' + s[3] + '">' + ic(s[2]) + '</i><b>' + s[0] + '</b><small>' + s[1] + '</small></a>'; }).join('') + '</div></section>' +
      '<section class="sec">' + head('phone', 'تواصل معانا', '#') + '<div class="rail rail--ct">' + CONTACTS.map(function (c) { return '<div class="ct"><div class="ct__top"><span class="ct__av">' + c[0] + '</span><div><b>' + c[1] + '</b><small>' + c[2] + '</small></div></div><p style="margin:0 0 12px;color:var(--text-2);font-size:13px">' + c[3] + '</p><a class="cta' + (c[4] === 'whatsapp' ? ' cta--ghost' : '') + '" href="#">' + ic(c[4]) + c[5] + '</a></div>'; }).join('') + '</div></section>' +
      '<section class="share"><h3>شارك الصفحة</h3><p>ابعت اللينك لصحابك، أو خليهم يصوروا الكود.</p><a class="cta" href="#">' + ic('share') + 'شارك اللينك</a> <a class="cta cta--ghost" href="#">' + ic('qr') + 'اعرض QR</a></section>' +
      '<footer class="foot">أسرة البابا أثناسيوس لخدمة شعب كنيستها الحبيبة في سفاجا · كنيسة أبي سيفين – سفاجا<br>سياسة الخصوصية · شروط الاستخدام</footer></main>';
    return h;
  }
  function all() {
    var cfg = {
      events: ['الفعاليات', 'كل اللي جاي في مكان واحد. اضغط على أي فعالية علشان تشوف التفاصيل وتحجز.', ['الكل', 'جاية', 'رحلات', 'مؤتمرات', 'خلصت'], function () { return '<div class="month">نوفمبر ٢٠٢٦</div><div class="grid">' + EVENTS.slice(0, 2).map(function (e) { return ev(e, true); }).join('') + '</div><div class="month">ديسمبر ٢٠٢٦</div><div class="grid">' + ev(EVENTS[2], true) + '</div>'; }],
      services: ['خدماتنا', 'خدمات الأسرة وفرقها. كل خدمة ليها صفحتها وفيديوهاتها.', ['الكل', 'مسرح', 'كورال', 'خدمات تانية'], function () { return '<div class="grid">' + SERVICES.map(sv).join('') + '</div>'; }],
      news: ['جديد الأسرة', 'الإعلانات والأخبار بالترتيب، الأحدث الأول.', ['الكل', 'جديد', 'إعلانات', 'نتايج'], function () { return '<div class="grid">' + NEWS.map(function (n) { return nw(n, true); }).join('') + '</div>'; }]
    }[PAGE] || null;
    if (!cfg) return home();
    return '<main class="wrap"><div class="allhead"><a class="back" href="?v=' + V + '">' + ARROW_R + 'الرئيسية</a><h1>' + cfg[0] + '</h1><p>' + cfg[1] + '</p></div>' +
      '<div class="filters">' + cfg[2].map(function (f, k) { return '<button class="' + (k === 0 ? 'on' : '') + '">' + f + '</button>'; }).join('') + '</div>' + cfg[3]() +
      '<footer class="foot">أسرة البابا أثناسيوس لخدمة شعب كنيستها الحبيبة في سفاجا</footer></main>';
  }
  function dock() {
    var d = [['home', 'الرئيسية', !PAGE], ['star', 'مميز'], ['calendar', 'الفعاليات', PAGE === 'events'], ['user', 'حسابي'], ['dots', 'المزيد']];
    return '<nav class="dock">' + d.map(function (x) { return '<a class="' + (x[2] ? 'on' : '') + '" href="#">' + (ic(x[0]) || '<svg class="icon icon--line" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>') + x[1] + '</a>'; }).join('') + '</nav>';
  }
  document.getElementById('app').innerHTML = top() + rise(PAGE ? all() : home()) + dock();

  /* the Suggestions spotlight advances on its own every 5 s (and by swipe) */
  var track = document.querySelector('.sugg__track'), bars = document.querySelectorAll('.sugg__bar i'), k = 0;
  if (track && !Q.get('still') && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setInterval(function () { k = (k + 1) % bars.length; track.scrollTo({ left: -k * track.clientWidth, behavior: 'smooth' }); bars.forEach(function (b, j) { b.classList.toggle('on', j === k); }); }, 5000);
  }
  document.querySelectorAll('.sec').forEach(function (s) {
    var r = s.querySelector('.rail'), b = s.querySelectorAll('.nav button'); if (!r || b.length < 2) return;
    b[0].onclick = function () { r.scrollBy({ left: 320, behavior: 'smooth' }); };
    b[1].onclick = function () { r.scrollBy({ left: -320, behavior: 'smooth' }); };
  });
})();
