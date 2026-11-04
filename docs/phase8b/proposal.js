/* Phase 8B proposal: every screen of the redesign, filled with what the live admin holds today
   (the owner's screenshots of 2026-11-04 and the real field lists in apps-script/Admin*.html).
   ?s=<screen>  — the screen;  ?intro=1 — play the welcome;  ?accent=gold — the other accent. */
(function () {
  var I = window.ADMIN_ICONS;
  var EXTRA = {
    wallet: '<svg class="icon icon--line" viewBox="0 0 24 24"><path class="duo" d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v1H6.5A2.5 2.5 0 0 0 4 10.5Z"/><path d="M4 7.5v9A2.5 2.5 0 0 0 6.5 19H19a1 1 0 0 0 1-1v-8a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 1 4 5.5"/><path d="M16 13.5h.01"/></svg>',
    cash: '<svg class="icon icon--line" viewBox="0 0 24 24"><rect class="duo" x="3" y="6" width="18" height="12" rx="2.5"/><rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/></svg>',
    swap: '<svg class="icon icon--line" viewBox="0 0 24 24"><path d="M7 7h12l-3-3M17 17H5l3 3"/></svg>',
    grid: '<svg class="icon icon--line" viewBox="0 0 24 24"><rect class="duo" x="4" y="4" width="7" height="7" rx="2"/><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
    palette: '<svg class="icon icon--line" viewBox="0 0 24 24"><path class="duo" d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.3-1-1.6-1-2.6 0-.8.6-1.4 1.4-1.4H16a5 5 0 0 0 5-5C21 6.2 17 3 12 3Z"/><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.3-1-1.6-1-2.6 0-.8.6-1.4 1.4-1.4H16a5 5 0 0 0 5-5C21 6.2 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/></svg>',
    history: '<svg class="icon icon--line" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
    userx: '<svg class="icon icon--line" viewBox="0 0 24 24"><circle class="duo" cx="10" cy="8" r="4"/><circle cx="10" cy="8" r="4"/><path d="M3 20a7 7 0 0 1 11.5-5.4M17 15l4 4m0-4-4 4"/></svg>',
    filter: '<svg class="icon icon--line" viewBox="0 0 24 24"><path class="duo" d="M4 5h16l-6 7.5V19l-4-2v-4.5Z"/><path d="M4 5h16l-6 7.5V19l-4-2v-4.5Z"/></svg>',
    archive: '<svg class="icon icon--line" viewBox="0 0 24 24"><rect class="duo" x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/></svg>',
    key: '<svg class="icon icon--line" viewBox="0 0 24 24"><circle class="duo" cx="8" cy="15" r="4"/><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8m-3 3 2 2m-4 0 1.5 1.5"/></svg>',
    device: '<svg class="icon icon--line" viewBox="0 0 24 24"><rect class="duo" x="7" y="3" width="10" height="18" rx="2.5"/><rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/></svg>',
    cake: '<svg class="icon icon--line" viewBox="0 0 24 24"><path class="duo" d="M4 13h16v7H4z"/><path d="M4 20h16M4 13h16v7M6 13v-3h12v3M12 10V7m0-3v.01"/></svg>'
  };
  function ic(n, cls) { var s = EXTRA[n] || I[n] || I.info; return cls ? '<span class="' + cls + '">' + s + '</span>' : s; }
  var Q = new URLSearchParams(location.search);
  var S = Q.get('s') || 'home';
  if (Q.get('accent')) document.documentElement.dataset.accent = Q.get('accent');
  if (Q.get('still')) document.documentElement.classList.add('no-anim');
  var LOGO = '../../assets/img/logo-256.webp';
  var IMG = { a: '../../media/2026/img-09d4476b-480.webp', b: '../../media/2026/img-8ffd40eb-480.webp', c: '../../media/2026/img-53ca69a3-480.webp', bug: '../../assets/img/partners/bug-logo-360.webp' };

  /* ---------- shell: the live rail, exactly its groups and order ---------- */
  var NAV = [
    ['الشغل', [['home', 'grid', 'الرئيسية'], ['comps', 'trophy', 'المسابقات'], ['youth', 'users', 'الشباب'], ['pages', 'theatre', 'الفعاليات والصفحات'], ['bookings', 'ticket', 'الحجوزات والفلوس']]],
    ['الموقع', [['content', 'megaphone', 'المحتوى'], ['page', 'layers', 'الصفحة'], ['media', 'photos', 'الصور والملفات']]],
    ['الفريق', [['activity', 'clock', 'سجل النشاط']]]
  ];
  var AREA_OF = { home: 'home', editor: 'pages', events: 'pages', 'event-menu': 'pages', 'event-delete': 'pages', servants: 'pages', publish: 'home', 'publish-changes': 'home', 'publish-history': 'settings', 'comp-new': 'comps', youth: 'youth', bookings: 'bookings', finance: 'bookings', paymethods: 'bookings', settings: 'settings', team: 'settings', 'team-remove': 'settings', 'servant-remove': 'pages', intro: 'home' };
  var TITLE = { home: ['لوحة التحكم', 'الرئيسية'], pages: ['الفعاليات والصفحات', 'الفعاليات'], comps: ['المسابقات', 'المسابقات'], youth: ['الشباب', 'حسابات الشباب'], bookings: ['الحجوزات والفلوس', 'الحجوزات'], settings: ['لوحة التحكم', 'الإعدادات'] };
  var area = AREA_OF[S] || 'home';

  function rail() {
    var h = '<aside class="rail"><div class="brand"><img src="' + LOGO + '" alt=""><div><b>لوحة التحكم</b><small>أسرة البابا أثناسيوس – سفاجا</small></div></div>';
    NAV.forEach(function (g) {
      h += '<div class="rail__grp">' + g[0] + '</div>';
      g[1].forEach(function (n) { h += '<a class="nav' + (n[0] === area ? ' is-on' : '') + '">' + ic(n[1]) + n[2] + '</a>'; });
    });
    h += '<div class="rail__foot"><a class="nav' + (area === 'settings' ? ' is-on' : '') + '">' + ic('gear') + 'الإعدادات</a><a class="nav">' + ic('globe') + 'افتح الموقع</a>' +
      '<a class="nav">' + ic('layers') + 'صغّر القائمة</a><div class="me"><span class="avatar">م</span><div><b>مينا زكريا</b><small>الأدمن الأساسي</small></div></div><a class="nav nav--danger">' + ic('logout') + 'خروج</a></div></aside>';
    return h;
  }
  function top() {
    var t = TITLE[area] || TITLE.home;
    return '<header class="top"><div class="top__title"><small>' + t[0] + '</small><b>' + t[1] + '</b></div><button class="vhelp" title="فيديو شرح · قريبًا" aria-label="فيديو شرح">' + ic('video') + '</button><span class="top__sp"></span>' +
      '<span class="pill"><span class="dot"></span>الموقع متحدث</span>' +
      '<span class="search">' + ic('eye') + 'دوّر أو روح لأي قسم…<span class="kbd">Ctrl K</span></span>' +
      '<button class="iconbtn">' + ic('bell') + '<span class="badge">١</span></button>' +
      '<button class="btn btn--primary">' + ic('send') + 'راجع وانشر</button><button class="mechip"><span class="avatar">م</span>مينا</button></header>' +
      '<header class="mtop"><img src="' + LOGO + '" alt=""><div><small>' + t[0] + '</small><b>' + t[1] + '</b></div><span class="sp"></span><button class="iconbtn">' + ic('bell') + '<span class="badge">١</span></button><button class="iconbtn" style="background:var(--grad);color:var(--acc-ink);border:0">' + ic('send') + '</button></header>';
  }
  function dock() {
    var d = [['home', 'grid', 'الرئيسية'], ['comps', 'trophy', 'المسابقات'], ['youth', 'users', 'الشباب'], ['bookings', 'ticket', 'الحجوزات'], ['more', 'dots', 'المزيد']];
    return '<nav class="dock">' + d.map(function (n) { return '<a class="' + (n[0] === area || (n[0] === 'more' && ['pages', 'settings'].indexOf(area) !== -1) ? 'is-on' : '') + '">' + ic(n[1]) + n[2] + '</a>'; }).join('') + '</nav>';
  }
  function tabs(list, on) { return '<div class="tabs">' + list.map(function (t) { return '<button class="tab' + (t === on ? ' is-on' : '') + '">' + t + '</button>'; }).join('') + '</div>'; }
  function sw(on) { return '<span class="switch' + (on ? ' is-on' : '') + '"></span>'; }
  function field(label, input, hint, cls, count) { return '<div class="field ' + (cls || 'c12') + '"><label>' + label + '</label>' + input + (hint || count ? '<div class="hint"><span>' + (hint || '') + '</span><span>' + (count || '') + '</span></div>' : '') + '</div>'; }
  function inp(v, ph, cls) { return '<input class="input ' + (cls || '') + '" value="' + (v || '') + '" placeholder="' + (ph || '') + '">'; }

  /* ---------- screens ---------- */
  var V = {};

  V.home = function () {
    return '<section class="card card--glow hero"><span class="hero__art"></span><div style="flex:1"><small class="muted">الأربع ٤ نوفمبر ٢٠٢٦</small><h1>مساء الخير يا <em>مينا</em></h1><p>مفيش حاجة مستنياك دلوقتي. كله تمام.</p></div>' +
      '<div class="row"><button class="btn">' + ic('plus') + 'خبر</button><button class="btn">' + ic('plus') + 'فعالية</button><button class="btn">' + ic('bell') + 'إشعار</button></div></section>' +
      '<div class="grid g4 kpis" style="margin-top:18px">' +
      [['megaphone', 'أخبار ظاهرة', '٠', ''], ['calendar', 'جاي في أسبوعين', '٠', 'أخبار وألعاب وفعاليات'], ['bell', 'إشعارات في الجرس', '١', ''], ['star', 'ألعاب', '٠', '']].map(function (k) { return '<div class="kpi"><small>' + ic(k[0], 'ico-sm') + k[1] + '</small><b>' + k[2] + '</b>' + (k[3] ? '<small style="font-weight:500">' + k[3] + '</small>' : '') + '</div>'; }).join('') + '</div>' +
      '<div class="grid" style="grid-template-columns:1.6fr 1fr;margin-top:18px" data-cols>' +
      '<div class="grid">' +
      '<section class="card"><div class="card__head"><span class="chipico chipico--ok">' + ic('check') + '</span><div><h3>الموقع متحدث</h3><p>كل اللي في المسودة ظاهر على الموقع</p></div><span class="sp"></span><button class="btn btn--sm">' + ic('external') + 'افتح الموقع</button></div>' +
      '<div class="grid g3"><div><small class="muted">آخر نشر</small><b style="display:block">الأربع ٤ نوفمبر · ٢:١٣ م</b></div><div><small class="muted">نشره</small><b style="display:block">مينا زكريا</b></div><div><small class="muted">تغييرات مستنية</small><b style="display:block">مفيش</b></div></div></section>' +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('ticket') + '</span><div><h3>الحجوزات</h3><p>مفيش طلبات حجز مستنية مراجعة ✓</p></div><span class="sp"></span><button class="btn btn--sm">' + ic('ticket') + 'كل الحجوزات</button></div>' +
      '<div class="grid g3"><div class="kpi"><small>طلبات جديدة</small><b>٠</b></div><div class="kpi"><small>إثباتات دفع مستنية</small><b>٠</b></div><div class="kpi"><small>مرتجعات مطلوبة</small><b>٠</b></div></div></section>' +
      '<div class="grid g2"><section class="card"><div class="card__head"><span class="chipico">' + ic('church') + '</span><h3>الاجتماع الجاي</h3></div><div class="meet"><div class="meet__day"><b>٨</b><small>الأحد</small></div><div><b style="font-size:16px">الأحد ٨ نوفمبر · ٨:٠٠ م</b> <span class="tag tag--acc">بعد ٤ أيام</span><p class="muted" style="margin:4px 0 10px">لسه مفيش موضوع للاجتماع ده</p><button class="btn btn--sm">' + ic('plus') + 'ضيف الموضوع</button></div></div></section>' +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('sparkle') + '</span><h3>اعمل حاجة جديدة</h3></div><div class="quick">' +
      [['church', 'موضوع اجتماع'], ['megaphone', 'خبر'], ['trophy', 'مسابقة'], ['calendar', 'فعالية'], ['star', 'لعبة'], ['bell', 'إشعار']].map(function (q) { return '<button><span class="chipico">' + ic(q[0]) + '</span>' + q[1] + '</button>'; }).join('') + '</div></section></div>' +
      '</div>' +
      '<div class="grid" style="align-content:start"><section class="card"><div class="card__head"><span class="chipico chipico--info">' + ic('users') + '</span><h3>المتصلين دلوقتي</h3></div><p class="muted" style="margin:0">مفيش أدمن تاني فاتح دلوقتي.</p></section>' +
      '<section class="card feed"><div class="card__head"><span class="chipico">' + ic('clock') + '</span><h3>آخر نشاط</h3><span class="sp"></span><button class="btn btn--sm btn--ghost">كل النشاط</button></div><div class="list">' +
      '<div class="item"><span class="avatar">م</span><div class="item__main"><b style="font-size:13.5px">مينا زكريا شاف باسورد مشترك <span class="x">٤ مرات</span></b><small>آخرها من ٣٧ دقيقة</small></div></div>' +
      '<div class="item"><span class="avatar">م</span><div class="item__main"><b style="font-size:13.5px">مينا زكريا شاف باسورد مشترك</b><small>من ٤٩ دقيقة</small></div></div>' +
      '<div class="item"><span class="avatar">م</span><div class="item__main"><b style="font-size:13.5px">مينا زكريا نشر تحديث للموقع</b><small>الأربع ٢:١٣ م</small></div></div>' +
      '</div></section></div></div>';
  };

  V.events = function (menu) {
    var rows = [
      ['تجربة حجز', 'رحلة · الجمعة ٦ نوفمبر، ١٠:٠٠ ص', '/events/tgrba/', IMG.a, ['<span class="tag">في الأرشيف</span>', '<span class="tag">الكارت مخفي</span>', '<span class="tag tag--acc">فيه حجز · ٥ مكان</span>']],
      ['اختبار نظام الحجز - مؤقت', 'رحلة · السبت ٣١ أكتوبر، ٦:٠٠ م', '/events/booking-test-temp/', IMG.b, ['<span class="tag">في الأرشيف</span>', '<span class="tag">الكارت مخفي</span>', '<span class="tag tag--acc">فيه حجز · ٣٠ مكان</span>', '<span class="tag tag--danger">الحجز قفل: عدّى ميعاد القفل</span>', '<span class="tag">خلصت</span>', '<span class="tag tag--info">بإشراف B.U.G</span>']],
      ['test-2', 'رحلة · الجمعة ٢٣ أكتوبر، ١٠:٠٠ ص', '/events/test/', IMG.c, ['<span class="tag">في الأرشيف</span>', '<span class="tag">الكارت مخفي</span>', '<span class="tag tag--acc">فيه حجز · ٢٠ مكان</span>', '<span class="tag tag--danger">الحجز قفل: الفعالية بدأت</span>', '<span class="tag tag--info">بإشراف B.U.G</span>']]
    ];
    return tabs(['صفحات الخدمة', 'الفعاليات', 'الخدام'], 'الفعاليات') +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('theatre') + '</span><div><h3>الفعاليات</h3><p>رحلات ومؤتمرات وأيام ترفيهية — كل واحدة ليها صفحة (الموقع/events/…) وحجز من الموقع نفسه</p></div><span class="sp"></span>' +
      '<button class="btn">' + ic('layers') + 'ترتيب الكروت</button><button class="btn">' + ic('archive') + 'الأرشيف <span class="badge">٣</span></button><button class="btn btn--primary">' + ic('plus') + 'فعالية جديدة</button></div>' +
      '<div class="row" style="margin-bottom:14px"><div class="seg"><span class="is-on">الكل (٣)</span><span>شغالة (٠)</span><span>في الأرشيف (٣)</span></div><span class="sp"></span><span class="search" style="width:260px">' + ic('filter') + 'دوّر باسم الفعالية…</span></div>' +
      '<div class="list">' + rows.map(function (r, i) {
        return '<div class="item" style="position:relative"><img class="item__thumb" src="' + r[3] + '" alt=""><div class="item__main"><b>' + r[0] + '</b><small>' + r[1] + ' · <span class="mono">' + r[2] + '</span></small><div class="item__tags">' + r[4].join('') + '</div></div>' +
          '<button class="btn btn--sm btn--ghost">' + ic('eye') + 'معاينة</button><button class="btn btn--sm">' + ic('edit') + 'تعديل</button><button class="iconbtn" style="width:34px;height:34px' + (menu && i === 0 ? ';border-color:var(--acc)' : '') + '">' + ic('dots') + '</button>' +
          (menu && i === 0 ? '<div class="menu" style="top:58px;left:14px"><a>' + ic('copy') + 'اعمل نسخة منها</a><a>' + ic('retry') + 'رجّع من الأرشيف</a><a>' + ic('link') + 'انسخ الرابط</a><hr><a class="danger">' + ic('trash') + 'امسح الفعالية…</a></div>' : '') + '</div>';
      }).join('') + '</div></section>';
  };
  V['event-menu'] = function () { return V.events(true); };

  V.editor = function () {
    var nav = [['١', 'الأساسيات', 'on'], ['٢', 'المواعيد والمكان', 'done'], ['٣', 'الصور', ''], ['٤', 'الحجز', ''], ['٥', 'الأسعار والسن', ''], ['٦', 'الدفع', 'warn'], ['٧', 'الخدام', ''], ['٨', 'الظهور', '']];
    return V.events() + '<div class="scrim"><div class="modal">' +
      '<div class="modal__head"><span class="chipico">' + ic('theatre') + '</span><div><h2>تعديل: تجربة حجز</h2><p>رحلة · <span class="mono">/events/tgrba/</span> · في الأرشيف</p></div><span class="sp"></span>' +
      '<button class="btn btn--sm btn--ghost">' + ic('eye') + 'معاينة</button><button class="btn btn--sm btn--ghost">' + ic('ticket') + 'صفحة الحجز</button><button class="vhelp" title="فيديو شرح · قريبًا" aria-label="فيديو شرح">' + ic('video') + '</button><button class="iconbtn">' + ic('close') + '</button></div>' +
      '<div class="modal__body"><nav class="mnav">' + nav.map(function (n) { return '<a class="' + (n[2] === 'on' ? 'is-on' : n[2] === 'done' ? 'is-done' : '') + '"><span class="n">' + (n[2] === 'done' ? '✓' : n[0]) + '</span>' + n[1] + (n[2] === 'warn' ? '<span class="warn"></span>' : '') + '</a>'; }).join('') + '</nav>' +
      '<div class="mcontent">' +
      '<div class="msec"><h4>' + ic('edit', 'ico-sm') + 'الأساسيات</h4><p>النوع والاسم والرابط — اللي الناس بتشوفه الأول</p><div class="fgrid">' +
      field('النوع', '<div class="seg"><span class="is-on">رحلة</span><span>مؤتمر</span><span>يوم ترفيهي</span></div>', 'اليوم الترفيهي نوع لوحده (مش رحلة)', 'c12') +
      field('العنوان', inp('تجربة حجز'), '', 'c6', '٩ / ٦٠') + field('العنوان المختصر', inp('', 'اختياري: للكارت'), '', 'c6', '٠ / ٢٤') +
      field('الرابط', '<div class="pre">' + inp('tgrba', '', 'input--ltr') + '<span>/events/</span></div>', 'الرابط مبيتغيرش بعد النشر', 'c6') +
      field('الملخص', inp('رحلة يوم كامل', ''), '', 'c6', '١٣ / ١٢٠') +
      field('التفاصيل', '<textarea class="input" rows="3">البرنامج ومواعيد التحرك…</textarea>', '', 'c12', '٢٤ / ٢٠٠٠') + '</div></div>' +
      '<div class="msec"><h4>' + ic('calendar', 'ico-sm') + 'المواعيد والمكان</h4><p>الموقع بيحسب «خلصت» و«بدأت» من المواعيد دي</p><div class="fgrid">' +
      field('بتبدأ', inp('الجمعة ٦ نوفمبر ٢٠٢٦ · ١٠:٠٠ ص', '', 'is-focus'), '', 'c6') + field('بتخلص', inp('الجمعة ٦ نوفمبر ٢٠٢٦ · ١٠:٠٠ م'), '', 'c6') +
      field('المكان', inp('', 'مثلًا: دير الأنبا بولا'), '', 'c6', '٠ / ٨٠') + field('لينك المكان', inp('', 'https://maps.google.com/…', 'input--ltr'), 'اختياري: جوجل ماب', 'c6') +
      field('الشروط', '<textarea class="input" rows="2" placeholder="اختياري"></textarea>', '', 'c12', '٠ / ١٠٠٠') + '</div></div>' +
      '<div class="msec"><h4>' + ic('photos', 'ico-sm') + 'الصور</h4><p>صورة الكارت والمعرض</p><div class="fgrid"><div class="c6"><div class="drop"><img src="' + IMG.a + '" style="width:100%;border-radius:12px;aspect-ratio:16/9;object-fit:cover" alt=""><button class="btn btn--sm">' + ic('photos') + 'غيّر من المكتبة</button></div></div><div class="c6"><div class="drop" style="height:100%">' + ic('upload') + '<b>المعرض (٠ / ١٢)</b><small>اسحب صور هنا أو اختار من المكتبة</small></div></div></div></div>' +
      '</div>' +
      '<aside class="maside"><h5>هتظهر كده في الموقع</h5><div class="prevcard"><img src="' + IMG.a + '" alt=""><div><b>تجربة حجز</b><small class="muted">رحلة · الجمعة ٦ نوفمبر</small><div class="row" style="margin-top:8px"><span class="tag tag--acc">احجز مكانك</span></div></div></div>' +
      '<div class="hr"></div><h5>قبل النشر</h5><ul class="checklist"><li class="ok">' + ic('check', 'ico-sm') + 'العنوان والرابط</li><li class="ok">' + ic('check', 'ico-sm') + 'المواعيد</li><li class="ok">' + ic('check', 'ico-sm') + 'صورة الكارت</li><li class="no">' + ic('alert', 'ico-sm') + 'الدفع: مفيش آخر ميعاد</li></ul>' +
      '<div class="hr"></div><h5>إدارة</h5><div class="stack"><button class="btn btn--sm btn--block">' + ic('retry') + 'رجّع من الأرشيف</button><button class="btn btn--sm btn--block btn--danger">' + ic('trash') + 'امسح الفعالية…</button></div></aside></div>' +
      '<div class="modal__foot"><button class="btn btn--primary" style="min-width:150px">' + ic('check') + 'احفظ</button><button class="btn btn--ghost">إلغاء</button><span class="sp"></span><span class="saved">' + ic('clock', 'ico-sm') + 'المسودة اتحفظت تلقائي من ثواني · Ctrl+S</span><button class="btn btn--sm">التالي: الصور ‹</button></div></div></div>';
  };

  V['comp-new'] = function () {
    return '<div class="tabs"><button class="tab is-on">المسابقات</button><button class="tab">الإعدادات</button></div><section class="card"><div class="card__head"><span class="chipico">' + ic('trophy') + '</span><div><h3>المسابقات</h3><p>كل مسابقة ليها صفحتها وأسئلتها ونتيجتها</p></div><span class="sp"></span><button class="btn btn--primary">' + ic('plus') + 'مسابقة جديدة</button></div><div class="drop" style="padding:50px">' + ic('trophy') + '<b>مفيش مسابقات لسه</b><small>دوس «مسابقة جديدة»: اسم ونوع ومواعيد، وبعدين الأسئلة</small></div></section>' +
      '<div class="scrim"><div class="modal modal--md"><div class="modal__head"><span class="chipico">' + ic('trophy') + '</span><div><h2>مسابقة جديدة</h2><p>٣ خطوات — تقدر تغيّر أي حاجة بعدين</p></div><span class="sp"></span><button class="vhelp" title="فيديو شرح · قريبًا" aria-label="فيديو شرح">' + ic('video') + '</button><button class="iconbtn">' + ic('close') + '</button></div>' +
      '<div class="modal__body"><div class="steps" style="margin-bottom:22px"><div class="step is-on"><i>١</i><span>الاسم والنوع</span></div><span class="bar"></span><div class="step"><i>٢</i><span>المواعيد</span></div><span class="bar"></span><div class="step"><i>٣</i><span>الرابط</span></div></div>' +
      '<div class="fgrid">' + field('اسم المسابقة <span class="req">*</span>', inp('', 'مثلًا: مسابقة الكتاب المقدس — الصوم الكبير', 'is-focus'), '', 'c12', '٠ / ٨٠') + '</div>' +
      '<div class="field" style="margin-top:18px"><label>نوع المسابقة</label><div class="grid g3">' +
      [['form', 'استبيان بسيط', 'أسئلة من غير درجات: رأي، تسجيل. اللي بيبعت بيشوف رسالة شكر.', ''], ['check', 'مسابقة عامة بدرجات', 'الإجابات بتتصحح لوحدها، وكل واحد بيشوف نتيجته النهائية بس.', 'is-on'], ['star', 'مسابقة نقاط', 'الإجابات بتتصحح لوحدها، والدرجة بتتحول نقاط في محفظة المشترك.', '']].map(function (c) { return '<div class="choice ' + c[3] + '" style="flex-direction:column"><div class="row" style="width:100%"><span class="chipico">' + ic(c[0]) + '</span><span class="sp"></span><span class="radio"></span></div><b>' + c[1] + '</b><small>' + c[2] + '</small></div>'; }).join('') +
      '</div><div class="hint">النوع بيملا الإعدادات الأولى بس — تقدر تغيّر أي حاجة بعدين</div></div></div>' +
      '<div class="modal__foot"><button class="btn btn--primary" style="min-width:150px">التالي ‹</button><button class="btn btn--ghost">إلغاء</button></div></div></div>';
  };

  function publishBase(changes) {
    var body = changes
      ? '<div class="list">' + [['theatre', 'فعالية «تجربة حجز»', 'اتعدّلت: المواعيد والصورة', 'مينا زكريا · من ٥ دقايق', 'tag--warn', 'اتعدّل'], ['megaphone', 'خبر «رحلة الغردقة»', 'جديد · هيظهر في الرئيسية', 'مينا زكريا · من ساعة', 'tag--ok', 'جديد'], ['photos', 'صورتين في المكتبة', 'هيترفعوا مع النشر', 'مينا زكريا · النهارده', 'tag--info', 'ملفات']].map(function (r) { return '<div class="item"><span class="chipico">' + ic(r[0]) + '</span><div class="item__main"><b>' + r[1] + ' <span class="tag ' + r[4] + '">' + r[5] + '</span></b><small>' + r[2] + ' · ' + r[3] + '</small></div><button class="btn btn--sm btn--ghost">' + ic('eye') + 'شوف الفرق</button></div>'; }).join('') + '</div>' +
        '<div class="toggle-row" style="margin-top:14px">' + sw(true) + '<div><b>ابعت إشعار للمشتركين بالخبر الجديد</b><small>«رحلة الغردقة» عليه علامة إشعار عند النشر</small></div></div>'
      : '<div class="drop" style="padding:36px"><span class="chipico chipico--ok" style="width:56px;height:56px">' + ic('check') + '</span><b style="font-size:17px;color:var(--text)">الموقع متحدث</b><small>مفيش تغييرات في المسودة عن اللي على الموقع.</small><small>آخر نشر: الأربع ٤ نوفمبر · ٢:١٣ م · مينا زكريا</small></div>';
    return V.home() + '<div class="scrim"><div class="modal modal--md"><div class="modal__head"><span class="chipico">' + ic('send') + '</span><div><h2>راجع وانشر</h2><p>' + (changes ? '٣ تغييرات مستنية النشر' : 'كل حاجة منشورة') + '</p></div><span class="sp"></span><button class="btn btn--sm btn--ghost">' + ic('history') + 'النسخ السابقة</button><button class="vhelp" title="فيديو شرح · قريبًا" aria-label="فيديو شرح">' + ic('video') + '</button><button class="iconbtn">' + ic('close') + '</button></div>' +
      '<div class="modal__body"><div class="steps" style="margin-bottom:20px"><div class="step is-on"><i>١</i><span>راجع التغييرات</span></div><span class="bar"></span><div class="step"><i>٢</i><span>انشر</span></div><span class="bar"></span><div class="step"><i>٣</i><span>ظهر على الموقع</span></div></div>' + body + '</div>' +
      '<div class="modal__foot"><button class="btn btn--primary" style="min-width:170px"' + (changes ? '' : ' disabled') + '>' + ic('send') + (changes ? 'انشر ٣ تغييرات' : 'نشر التغييرات') + '</button><button class="btn btn--ghost">إلغاء</button>' + (changes ? '<span class="sp"></span><button class="btn btn--sm btn--ghost">' + ic('retry') + 'ارجع للمنشور</button>' : '') + '</div></div></div>';
  }
  V.publish = function () { return publishBase(false); };
  V['publish-changes'] = function () { return publishBase(true); };

  V['publish-history'] = function () {
    var days = [['النهارده · الأربع ٤ نوفمبر', [['٢:١٣ م', 'مينا زكريا', true], ['٢:١٠ م', 'مينا زكريا'], ['٢:٠٧ م', 'مينا زكريا'], ['٢:٠٦ م', 'مينا زكريا']]], ['التلات ٣ نوفمبر', [['٩:١٠ م', 'مينا زكريا'], ['٦:٤٩ م', 'مينا زكريا'], ['٦:٣٤ م', 'حساب الأسرة'], ['٥:٥٨ م', 'حساب الأسرة'], ['٥:٥٧ م', 'حساب الأسرة'], ['٥:٠١ م', 'حساب الأسرة'], ['٢:٣٤ م', 'مينا زكريا'], ['١:٤٥ م', 'مينا زكريا']]]];
    return settingsShell('publish', '<section class="card"><div class="card__head"><span class="chipico">' + ic('history') + '</span><div><h3>النسخ المنشورة</h3><p>كل نشر نسخة كاملة من الموقع. ترجع لأي واحدة بضغطة، والرجوع نفسه بيتسجل كنشر جديد.</p></div></div>' +
      days.map(function (d) {
        return '<h4 style="margin:18px 0 10px;font-size:13px;color:var(--text-3)">' + d[0] + ' · ' + d[1].length + ' نشر</h4><div class="list">' + d[1].map(function (r) {
          return '<div class="item"><span class="chipico ' + (r[2] ? 'chipico--ok' : '') + '">' + ic(r[2] ? 'check' : 'send') + '</span><div class="item__main"><b>' + r[0] + (r[2] ? ' <span class="tag tag--ok">اللي على الموقع دلوقتي</span>' : '') + '</b><small>نشرها ' + r[1] + '</small></div>' + (r[2] ? '' : '<button class="btn btn--sm">' + ic('retry') + 'ارجع للنسخة دي</button>') + '</div>';
        }).join('') + '</div>';
      }).join('') + '<button class="btn btn--ghost btn--block" style="margin-top:14px">اعرض الأقدم (٣١ أكتوبر وقبله)</button></section>');
  };

  V.youth = function () {
    return tabs(['حسابات الشباب', 'الطلبات', 'الإعدادات'], 'حسابات الشباب') +
      '<div class="row" style="margin-bottom:16px"><button class="btn btn--sm btn--ghost">' + ic('arrow') + 'رجوع للحسابات</button></div>' +
      '<div class="acct"><div class="grid">' +
      '<section class="card card--glow profile"><span class="avatar avatar--lg">م</span><h2>مينا زكريا عطاالله</h2><div class="row" style="justify-content:center;margin-top:8px"><span class="tag tag--ok">' + ic('check', 'ico-sm') + 'مؤهل</span><span class="tag tag--info">إيميل متأكد</span><span class="tag">١٩ سنة</span></div>' +
      '<div class="row" style="justify-content:center;margin-top:14px"><button class="btn btn--sm">' + ic('photos') + 'الصورة</button><button class="btn btn--sm btn--danger">' + ic('trash') + 'امسح الصورة</button></div>' +
      '<div class="kv">' +
      '<div><span>' + ic('key', 'ico-sm') + 'رقم الحساب</span><b class="mono">p-ahtj7xz3</b><em><button class="btn btn--sm btn--ghost">' + ic('copy') + '</button></em></div>' +
      '<div><span>' + ic('mail', 'ico-sm') + 'الإيميل</span><b class="mono" style="font-size:12.5px">menazakmena@gmail.com</b><em><button class="btn btn--sm btn--ghost">' + ic('edit') + '</button></em></div>' +
      '<div><span>' + ic('phone', 'ico-sm') + 'الموبايل</span><b class="mono">01276162016</b><em><button class="btn btn--sm btn--ghost">' + ic('edit') + '</button></em></div>' +
      '<div><span>' + ic('cake', 'ico-sm') + 'الميلاد</span><b>١٧ يناير ٢٠٠٧</b><em><button class="btn btn--sm btn--ghost">' + ic('edit') + '</button></em></div>' +
      '<div><span>' + ic('user', 'ico-sm') + 'اتعمل</span><b>بنفسه · ٣٠ أكتوبر ٢٠٢٦، ١٠:٤٧ م</b><em></em></div>' +
      '</div></section></div>' +
      '<div class="grid">' +
      '<section class="card"><div class="card__head"><span class="chipico chipico--warn">' + ic('lock') + '</span><div><h3>الباسورد الحالي</h3><p>ليك إنت بس — وكل عرض بيتسجل في السجل</p></div></div><div class="secret"><b class="mono" style="font-size:16px;letter-spacing:.12em">MZD4-••••-••••</b><span class="sp"></span><button class="btn btn--sm">' + ic('eye') + 'اعرض</button><button class="btn btn--sm">' + ic('copy') + 'نسخ</button><button class="btn btn--sm">' + ic('retry') + 'ولّد جديد</button></div></section>' +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('gear') + '</span><h3>إجراءات الحساب</h3></div><div class="qa">' +
      [['edit', 'تعديل البيانات', ''], ['mail', 'تصحيح الإيميل', ''], ['phone', 'تصحيح الموبايل', ''], ['cake', 'تصحيح الميلاد', ''], ['shield', 'الأهلية', ''], ['key', 'باسورد جديد', 'warn'], ['logout', 'اخرج من كل الأجهزة', 'warn'], ['lock', 'وقّف الحساب', 'danger']].map(function (b) { return '<button' + (b[2] === 'danger' ? ' style="color:var(--danger)"' : '') + '><span class="chipico ' + (b[2] ? 'chipico--' + b[2] : '') + '">' + ic(b[0]) + '</span>' + b[1] + '</button>'; }).join('') + '</div></section>' +
      '<div class="grid g2"><section class="card"><div class="card__head"><span class="chipico">' + ic('star') + '</span><h3>النقاط</h3><span class="sp"></span><span class="tag">الموسم الحالي</span></div><div class="points"><span class="big">٠</span><div><b>نقطة</b><small class="muted" style="display:block">مفيش حركات في الموسم ده</small></div></div><div class="row" style="margin-top:16px"><button class="btn btn--sm">' + ic('edit') + 'تعديل نقاط</button><button class="btn btn--sm">' + ic('swap') + 'نقل نقاط</button></div></section>' +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('device') + '</span><h3>الأجهزة</h3><span class="sp"></span><span class="tag">١ جهاز</span></div><div class="item" style="padding:10px 12px"><span class="chipico">' + ic('device') + '</span><div class="item__main"><b style="font-size:13.5px">Android · Chrome</b><small>آخر دخول النهارده</small></div><button class="btn btn--sm btn--ghost">اخرّجه</button></div></section></div>' +
      '<section class="card"><div class="row" style="margin-bottom:14px"><div class="seg"><span class="is-on">' + ic('clock', 'ico-sm') + 'تاريخ الحساب</span><span>' + ic('ticket', 'ico-sm') + 'الحجوزات</span><span>' + ic('mail', 'ico-sm') + 'الإيميلات</span><span>' + ic('trophy', 'ico-sm') + 'المسابقات</span></div></div>' +
      '<ul class="timeline"><li><b>مينا زكريا شاف الباسورد</b><small>من ٣٧ دقيقة</small></li><li><b>الإيميل اتأكد بالكود</b><small>٣٠ أكتوبر، ١٠:٤٩ م</small></li><li><b>الحساب اتعمل من الموقع</b><small>٣٠ أكتوبر، ١٠:٤٧ م</small></li></ul></section>' +
      '</div></div>';
  };

  function servantsList() {
    return [['اختبار الحجز - مؤقت', '+201276162016 · اختبار مؤقت', ['<span class="tag tag--ok">رقمه ظاهر للزوار</span>', '<span class="tag">موقوف</span>']], ['كريستين عماد', '+201205955243 · منسق أسرة', ['<span class="tag">رقمه مش ظاهر</span>', '<span class="tag tag--ok">إنستاباي معتمد</span>', '<span class="tag tag--warn">المحفظة محتاج اعتماد</span>']], ['مينا زكريا عطاالله متى', '+201276162016 · منسق عام', ['<span class="tag tag--ok">رقمه ظاهر للزوار</span>', '<span class="tag tag--ok">إنستاباي معتمد</span>', '<span class="tag tag--warn">المحفظة محتاج اعتماد</span>']]];
  }
  V.servants = function () {
    return tabs(['صفحات الخدمة', 'الفعاليات', 'الخدام'], 'الخدام') + '<section class="card"><div class="card__head"><span class="chipico">' + ic('users') + '</span><div><h3>الخدام</h3><p>قايمة واحدة للخدام المسؤولين عن الحجز في الفعاليات</p></div><span class="sp"></span><button class="btn btn--primary">' + ic('plus') + 'خادم جديد</button></div><div class="list">' +
      servantsList().map(function (s) { return '<div class="item"><span class="avatar" style="background:var(--p-raised);color:var(--text-2)">' + ic('user') + '</span><div class="item__main"><b>' + s[0] + '</b><small class="ltr">' + s[1] + '</small><div class="item__tags">' + s[2].join('') + '</div></div><button class="btn btn--sm">' + ic('edit') + 'تعديل</button><button class="iconbtn" style="width:34px;height:34px">' + ic('dots') + '</button></div>'; }).join('') + '</div></section>' +
      '<div class="scrim"><div class="modal modal--md"><div class="modal__head"><span class="chipico">' + ic('user') + '</span><div><h2>تعديل: مينا زكريا عطاالله متى</h2><p>منسق عام · <span class="ltr">+201276162016</span></p></div><span class="sp"></span><button class="vhelp" title="فيديو شرح · قريبًا" aria-label="فيديو شرح">' + ic('video') + '</button><button class="iconbtn">' + ic('close') + '</button></div>' +
      '<div class="modal__body"><div class="fgrid">' + field('الاسم', inp('مينا زكريا عطاالله متى'), '', 'c6', '٢٢ / ٦٠') + field('الدور', inp('منسق عام'), '', 'c6', '٩ / ٤٠') + field('رقم الموبايل', inp('01276162016', '', 'input--ltr'), '', 'c6') + field('ملاحظة (للأدمن بس)', inp('', 'مبتظهرش في الموقع'), '', 'c6', '٠ / ٢٠٠') + '</div>' +
      '<div class="hr"></div><h4 style="margin:0 0 4px">' + 'أرقام الدفع</h4><p class="muted" style="margin:0 0 14px;font-size:12.5px">الرقم مبيظهرش للزوار في خطوة الدفع غير بعد ما يعتمده الأدمن الأساسي. أي تغيير محتاج اعتماد تاني.</p>' +
      '<div class="grid g2">' +
      '<div class="card" style="padding:16px"><div class="row"><span class="chipico">' + ic('swap') + '</span><div><b>إنستاباي</b><small class="mono muted" style="display:block">012 7616 2016</small></div><span class="sp"></span><span class="tag tag--ok">معتمد للزوار</span></div><div class="fgrid" style="margin-top:12px">' + field('رقم إنستاباي', inp('01276162016', '', 'input--ltr'), '', 'c12') + '</div><button class="btn btn--sm btn--ghost" style="margin-top:10px">شيل الاعتماد</button></div>' +
      '<div class="card" style="padding:16px;border-color:rgb(242 195 91 / .35)"><div class="row"><span class="chipico chipico--warn">' + ic('wallet') + '</span><div><b>المحفظة</b><small class="mono muted" style="display:block">012 7616 2016 (من رقم الموبايل)</small></div><span class="sp"></span><span class="tag tag--warn">مش ظاهر للزوار</span></div><div class="fgrid" style="margin-top:12px">' + field('رقم المحفظة', inp('', 'فاضي = رقم الموبايل', 'input--ltr'), '', 'c12') + '</div><button class="btn btn--sm btn--primary" style="margin-top:10px">' + ic('check') + 'اعتمد الرقم ده</button></div>' +
      '</div><div class="fgrid" style="margin-top:14px">' + field('اسم المستفيد', inp('', 'اختياري: الاسم اللي بيظهر في التحويل'), 'بيظهر للزوار جنب الرقم', 'c12') + '</div></div>' +
      '<div class="modal__foot"><button class="btn btn--primary" style="min-width:150px">' + ic('check') + 'احفظ</button><button class="btn btn--ghost">إلغاء</button><span class="sp"></span><button class="btn btn--sm btn--danger">' + ic('trash') + 'شيل الخادم…</button></div></div></div>';
  };

  V.paymethods = function () {
    var m = [['cash', 'cash', 'كاش', 'بيتسجل من اللوحة بس بعد ما الخادم يستلم', false, false, true, '٣ خدام'], ['instapay', 'swap', 'إنستاباي', 'الزوار بيحولوا ويرفعوا صورة التحويل', true, true, true, '٢ أرقام معتمدة'], ['wallet', 'wallet', 'محفظة', 'الزوار بيحولوا ويرفعوا صورة التحويل', true, true, true, '٠ أرقام معتمدة · ٢ مستنيين']];
    return tabs(['الحجوزات', 'الفلوس', 'طرق الدفع'], 'طرق الدفع') +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('wallet') + '</span><div><h3>طرق الدفع</h3><p>اللي الخدام بيقبلوه. كل طريقة وتحكماتها في كارت واحد، والحفظ لكل كارت لوحده.</p></div></div><div class="grid g3">' +
      m.map(function (x) {
        return '<div class="card" style="padding:18px"><div class="row"><span class="chipico">' + ic(x[1]) + '</span><div><b style="font-size:16px">' + x[2] + '</b><small class="mono muted" style="display:block">' + x[0] + '</small></div><span class="sp"></span><small class="muted" style="font-weight:700">متاحة</small>' + sw(x[6]) + '</div>' +
          '<p class="muted" style="font-size:12.5px;margin:10px 0 14px">' + x[3] + '</p>' +
          '<div class="stack"><div class="toggle-row">' + sw(x[4]) + '<div><b>محتاج إثبات دفع</b><small>صورة التحويل إجبارية</small></div></div><div class="toggle-row">' + sw(x[5]) + '<div><b>الزوار يدفعوا بيها من الموقع</b><small>' + (x[5] ? 'بتظهر في خطوة الدفع' : 'مقفولة: بتظهر للمعلومة بس') + '</small></div></div></div>' +
          '<div class="hr"></div><div class="row"><span class="tag ' + (x[7].indexOf('مستنيين') !== -1 ? 'tag--warn' : 'tag--acc') + '">' + x[7] + '</span><span class="sp"></span><button class="btn btn--sm">احفظ</button></div></div>';
      }).join('') + '</div></section>' +
      '<section class="card" style="margin-top:18px"><div class="card__head"><span class="chipico chipico--warn">' + ic('shield') + '</span><div><h3>أرقام مستنية اعتمادك</h3><p>مفيش رقم بيظهر للزوار قبل ما تعتمده</p></div></div><div class="tablewrap"><table class="table cards"><thead><tr><th>الخادم</th><th>الطريقة</th><th>الرقم</th><th>الحالة</th><th></th></tr></thead><tbody>' +
      [['كريستين عماد', 'محفظة', '0120 595 5243'], ['مينا زكريا عطاالله متى', 'محفظة', '012 7616 2016']].map(function (r) { return '<tr><td><b>' + r[0] + '</b></td><td data-l="الطريقة:">' + r[1] + '</td><td class="mono">' + r[2] + '</td><td><span class="tag tag--warn">مستني اعتماد</span></td><td style="text-align:end"><button class="btn btn--sm btn--primary">' + ic('check') + 'اعتمد</button></td></tr>'; }).join('') + '</tbody></table></div></section>';
  };

  V.bookings = function () {
    var rows = [['مينا زكريا', 'تجربة حجز', '٢', '٣٬٠٠٠', '٣٬٠٠٠', '٠', 'tag--ok', 'مؤكد', 'إنستاباي'], ['كريستين عماد', 'تجربة حجز', '١', '١٬٥٠٠', '٥٠٠', '١٬٠٠٠', 'tag--warn', 'قيد المراجعة', 'كاش'], ['اختبار الحجز - مؤقت', 'اختبار نظام الحجز - مؤقت', '٣', '٤٬٥٠٠', '٠', '٤٬٥٠٠', 'tag--danger', 'اتلغى · مرتجع', 'محفظة']];
    return tabs(['الحجوزات', 'الفلوس', 'طرق الدفع'], 'الحجوزات') +
      '<div class="grid g4 kpis">' + [['ticket', 'طلبات جديدة', '٠', 0], ['check', 'مؤكدة', '٥', 55], ['wallet', 'إثباتات مستنية', '٠', 0], ['retry', 'مرتجعات مطلوبة', '٠', 0]].map(function (k) { return '<div class="kpi"><small>' + ic(k[0], 'ico-sm') + k[1] + '</small><b>' + k[2] + '</b><div class="bar"><i style="width:' + k[3] + '%"></i></div></div>'; }).join('') + '</div>' +
      '<section class="card" style="margin-top:18px"><div class="card__head"><span class="chipico">' + ic('ticket') + '</span><div><h3>الحجوزات</h3><p>اختار فعالية، وفلتر بالحالة أو الخادم</p></div><span class="sp"></span><button class="btn">' + ic('download') + 'تصدير Excel</button><button class="btn btn--primary">' + ic('plus') + 'حجز كاش</button></div>' +
      '<div class="row" style="margin-bottom:14px"><div class="seg"><span class="is-on">تجربة حجز</span><span>اختبار نظام الحجز</span><span>test-2</span></div><span class="sp"></span><div class="seg"><span class="is-on">الكل</span><span>جديد</span><span>مؤكد</span><span>ملغي</span></div></div>' +
      '<div class="tablewrap"><table class="table cards"><thead><tr><th>الاسم</th><th>الفعالية</th><th>العدد</th><th>المطلوب</th><th>المدفوع</th><th>الباقي</th><th>الطريقة</th><th>الحالة</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td><b>' + r[0] + '</b></td><td data-l="">' + r[1] + '</td><td data-l="العدد:" class="num">' + r[2] + '</td><td data-l="المطلوب:" class="num">' + r[3] + ' ج</td><td data-l="المدفوع:" class="num" style="color:var(--ok)">' + r[4] + ' ج</td><td data-l="الباقي:" class="num" style="color:' + (r[5] === '٠' ? 'var(--text-3)' : 'var(--warn)') + '">' + r[5] + ' ج</td><td data-l="">' + r[8] + '</td><td><span class="tag ' + r[6] + '">' + r[7] + '</span></td><td style="text-align:end"><button class="btn btn--sm">افتح</button></td></tr>'; }).join('') +
      '</tbody></table></div><p class="muted" style="font-size:12px;margin:10px 0 0">صفوف المثال من أسماء الخدام والفعاليات الحقيقية — المبالغ توضيحية لحد ما أشوف بيانات الحجز الفعلية.</p></section>';
  };

  V.finance = function () {
    return tabs(['الحجوزات', 'الفلوس', 'طرق الدفع'], 'الفلوس') +
      '<div class="grid g4 kpis">' + [['wallet', 'المطلوب كله', '٩٬٠٠٠ ج'], ['check', 'اتحصّل', '٣٬٥٠٠ ج'], ['clock', 'الباقي على الناس', '٥٬٥٠٠ ج'], ['retry', 'مرتجعات', '٠ ج']].map(function (k, i) { return '<div class="kpi"><small>' + ic(k[0], 'ico-sm') + k[1] + '</small><b>' + k[2] + '</b><div class="bar"><i style="width:' + [100, 39, 61, 0][i] + '%"></i></div></div>'; }).join('') + '</div>' +
      '<div class="grid g2" style="margin-top:18px"><section class="card"><div class="card__head"><span class="chipico">' + ic('users') + '</span><h3>مع كل خادم</h3></div><div class="tablewrap"><table class="table"><thead><tr><th>الخادم</th><th>كاش</th><th>تحويلات</th><th>سلّم</th></tr></thead><tbody>' +
      [['مينا زكريا عطاالله متى', '٠', '٣٬٠٠٠', '—'], ['كريستين عماد', '٥٠٠', '٠', 'لسه']].map(function (r) { return '<tr><td><b>' + r[0] + '</b></td><td class="num">' + r[1] + '</td><td class="num">' + r[2] + '</td><td>' + (r[3] === 'لسه' ? '<span class="tag tag--warn">لسه</span>' : r[3]) + '</td></tr>'; }).join('') + '</tbody></table></div></section>' +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('clock') + '</span><h3>آخر الدفعات</h3><span class="sp"></span><button class="btn btn--sm">' + ic('download') + 'تصدير</button></div><ul class="timeline"><li><b>٣٬٠٠٠ ج · إنستاباي</b><small>مينا زكريا · تجربة حجز · سجلها مينا زكريا</small></li><li><b>٥٠٠ ج · كاش</b><small>كريستين عماد · تجربة حجز · مع كريستين عماد</small></li></ul></section></div>' +
      '<p class="muted" style="font-size:12px">المبالغ هنا توضيحية؛ الترتيب والأعمدة هي اللي هتتنفذ.</p>';
  };

  function settingsShell(on, content) {
    var g = [['الحساب', [['me', 'user', 'حسابي والشكل'], ['notify', 'bell', 'إشعاراتي']]], ['الموقع', [['site', 'globe', 'بيانات الموقع'], ['content', 'megaphone', 'المحتوى والظهور'], ['publish', 'history', 'النشر والنسخ']]], ['الفريق', [['team', 'shield', 'الفريق والصلاحيات']]], ['النظام', [['system', 'gear', 'حالة النظام'], ['guide', 'book', 'دليل الأدمن']]]];
    return '<div class="set"><nav class="setnav">' + g.map(function (x, i) { return (i ? '<hr>' : '') + '<small class="muted" style="padding:4px 12px;font-weight:700;font-size:11px">' + x[0] + '</small>' + x[1].map(function (n) { return '<a class="' + (n[0] === on ? 'is-on' : '') + '">' + ic(n[1]) + n[2] + '</a>'; }).join(''); }).join('') + '</nav><div class="grid">' + content + '</div></div>';
  }
  V.settings = function () {
    return settingsShell('me',
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('user') + '</span><div><h3>حسابي</h3><p>إنت داخل بـ menazakmena@gmail.com</p></div></div>' +
      '<div class="setrow"><span class="avatar">م</span><div class="setrow__t"><b>مينا زكريا</b><small>اسمك في اللوحة والسجل</small></div><button class="btn btn--sm">' + ic('edit') + 'غيّر الاسم</button></div>' +
      '<div class="setrow"><div class="setrow__t"><b>الدور</b><small>الأدمن الأساسي: صلاحياته كاملة ومينفعش يتشال</small></div><span class="tag tag--acc">الأدمن الأساسي</span></div>' +
      '<div class="setrow"><div class="setrow__t"><b>الأجهزة اللي داخل منها</b><small>٢ جهاز · الكمبيوتر ده وموبايل Android</small></div><button class="btn btn--sm">إدارة الأجهزة</button></div>' +
      '<div class="setrow"><div class="setrow__t"><b style="color:var(--danger)">خروج</b><small>من الجهاز ده بس</small></div><button class="btn btn--sm btn--danger">' + ic('logout') + 'خروج</button></div></section>' +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('palette') + '</span><div><h3>الشكل</h3><p>بيتحفظ على حسابك ويمشي معاك على كل جهاز</p></div><span class="sp"></span><button class="btn btn--sm btn--ghost">' + ic('play') + 'شوف شاشة البداية</button></div>' +
      '<div class="setrow"><div class="setrow__t"><b>الوضع</b></div><div class="seg"><span class="is-on">داكن</span><span>فاتح</span><span>زي الجهاز</span></div></div>' +
      '<div class="setrow"><div class="setrow__t"><b>اللون</b><small>لون الأزرار والتحديد</small></div><div class="swatches"><i style="background:#d7aa50"></i><i class="is-on" style="background:#4cc3cb"></i><i style="background:#e0736b"></i><i style="background:#7fb4ff"></i><i style="background:#5ad7a0"></i><i style="background:#b39cff"></i></div></div>' +
      '<div class="setrow"><div class="setrow__t"><b>الكثافة</b><small>المسافات بين العناصر</small></div><div class="seg"><span class="is-on">مريحة</span><span>مضغوطة</span></div></div>' +
      '<div class="setrow"><div class="setrow__t"><b>الحركة</b><small>«خفيفة» بتشيل الجزيئات والانتقالات الكبيرة</small></div><div class="seg"><span class="is-on">كاملة</span><span>خفيفة</span><span>من غير</span></div></div>' +
      '<div class="setrow"><div class="setrow__t"><b>الأصوات</b><small>صوت خفيف مع النشر والحفظ</small></div>' + sw(false) + '</div></section>');
  };

  function teamRows() {
    return [['مينا زكريا', 'menazakmena@gmail.com', 'الأدمن الأساسي', 'tag--acc', 'متصل دلوقتي', true], ['حساب الأسرة', 'family account', 'أدمن', '', 'آخر دخول ٣ نوفمبر', false], ['كريستين عماد', 'خادمة · منسق أسرة', 'خادم: حجوزات بس', 'tag--info', 'آخر دخول من يومين', false]];
  }
  V.team = function (menu) {
    return settingsShell('team', '<section class="card"><div class="card__head"><span class="chipico">' + ic('shield') + '</span><div><h3>الفريق والصلاحيات</h3><p>مين يقدر يدخل اللوحة وكل واحد يقدر يعمل إيه</p></div><span class="sp"></span><button class="btn btn--primary">' + ic('plus') + 'ضيف حد للفريق</button></div><div class="list">' +
      teamRows().map(function (r, i) {
        return '<div class="item" style="position:relative"><span class="avatar">' + r[0][0] + '</span><div class="item__main"><b>' + r[0] + ' <span class="tag ' + r[3] + '">' + r[2] + '</span></b><small>' + r[1] + ' · ' + r[4] + '</small></div>' +
          (r[5] ? '<span class="muted" style="font-size:12px">' + ic('lock', 'ico-sm') + ' مينفعش يتشال</span>' : '<button class="btn btn--sm">' + ic('shield') + 'الصلاحيات</button><button class="iconbtn" style="width:34px;height:34px' + (menu && i === 2 ? ';border-color:var(--acc)' : '') + '">' + ic('dots') + '</button>') +
          (menu && i === 2 ? '<div class="menu" style="top:58px;left:14px"><a>' + ic('shield') + 'غيّر الصلاحيات</a><a>' + ic('logout') + 'اخرّجه من كل الأجهزة</a><hr><a class="danger">' + ic('userx') + 'شيله من الإدارة…</a></div>' : '') + '</div>';
      }).join('') + '</div></section>');
  };
  V['team-remove'] = function () {
    return V.team(true) + '<div class="scrim"><div class="modal modal--md"><div class="modal__head"><span class="chipico chipico--danger">' + ic('userx') + '</span><div><h2>تشيل «كريستين عماد» إزاي؟</h2><p>اختار اللي إنت عاوزه بالظبط — مفيش حاجة بتحصل قبل التأكيد</p></div><span class="sp"></span><button class="iconbtn">' + ic('close') + '</button></div>' +
      '<div class="modal__body"><div class="stack">' +
      '<div class="opt is-on"><span class="radio" style="border-color:var(--acc);box-shadow:inset 0 0 0 4px var(--bg),inset 0 0 0 10px var(--acc)"></span><div><b>شيل صلاحيتها من الإدارة بس</b> <span class="tag tag--ok">بترجع</span><ul><li>مش هتقدر تدخل لوحة التحكم، وكل أجهزتها هتخرج دلوقتي</li><li>تفضل في قايمة «الخدام» للحجوزات، وأرقام الدفع بتاعتها زي ما هي</li><li>السجل والحجوزات اللي سجلتها بتفضل باسمها</li><li>تقدر ترجّعها بعدين من «الفريق ← اللي اتشالوا»</li></ul></div></div>' +
      '<div class="opt opt--danger"><span class="radio"></span><div><b style="color:var(--danger)">احذف الخادم نهائي</b> <span class="tag tag--danger">مبترجعش</span><ul><li>بتتشال من الإدارة ومن قايمة الخدام في كل الفعاليات</li><li>أرقام إنستاباي والمحفظة بتتمسح ومبتظهرش للزوار</li><li>الحجوزات والفلوس اللي معاها: لازم تتنقل لخادم تاني الأول (مطلوب قبل الحذف)</li><li>السجل بيفضل، والاسم يظهر فيه «خادم اتحذف»</li></ul></div></div>' +
      '</div></div>' +
      '<div class="modal__foot"><button class="btn btn--primary">' + ic('userx') + 'شيل الصلاحية</button><button class="btn btn--ghost">لأ، سيبها</button></div></div></div>';
  };
  V['servant-remove'] = function () {
    return V.servantsPlain() + '<div class="scrim"><div class="modal modal--sm"><div class="modal__head"><span class="chipico chipico--danger">' + ic('trash') + '</span><div><h2>احذف «اختبار الحجز - مؤقت» نهائي؟</h2><p>الخطوة دي مبترجعش</p></div></div>' +
      '<div class="modal__body"><div class="danger-zone"><ul class="checklist"><li class="no">' + ic('alert', 'ico-sm') + 'مربوط بـ٣ فعاليات: هيتشال منها</li><li class="no">' + ic('alert', 'ico-sm') + 'معاه حجزين: هيتنقلوا لـ«مينا زكريا عطاالله متى»</li><li class="ok">' + ic('check', 'ico-sm') + 'مفيش فلوس معاه لسه متسلمتش</li></ul></div>' +
      '<div class="field" style="margin-top:14px"><label>انقل الحجوزات لـ</label><div class="input" style="display:flex;align-items:center">مينا زكريا عطاالله متى</div></div>' +
      '<div class="typed" style="margin-top:14px"><b style="font-size:13px">اكتب <span style="color:var(--danger)">احذف</span> عشان تأكد</b><input class="input is-focus" value="احذف"></div></div>' +
      '<div class="modal__foot"><button class="btn btn--danger-solid">' + ic('trash') + 'احذف نهائي</button><button class="btn btn--ghost">لأ</button></div></div></div>';
  };
  V.servantsPlain = function () { var h = V.servants(); return h.slice(0, h.indexOf('<div class="scrim">')); };
  V['event-delete'] = function () {
    return V.events() + '<div class="scrim"><div class="modal modal--sm"><div class="modal__head"><span class="chipico chipico--danger">' + ic('trash') + '</span><div><h2>تمسح «تجربة حجز»؟</h2><p>الفعالية اتنشرت قبل كده وفيها حجوزات</p></div></div>' +
      '<div class="modal__body"><div class="stack"><div class="opt is-on"><span class="radio" style="border-color:var(--acc);box-shadow:inset 0 0 0 4px var(--bg),inset 0 0 0 10px var(--acc)"></span><div><b>سيبها في الأرشيف</b> <span class="tag tag--ok">آمن</span><ul><li>الرابط يقول «الفعالية دي مش متاحة»</li><li>الحجوزات والفلوس محفوظة للتقارير</li></ul></div></div>' +
      '<div class="opt opt--danger"><span class="radio"></span><div><b style="color:var(--danger)">امسحها نهائي من اللوحة</b> <span class="tag tag--danger">مبترجعش</span><ul><li>بتتمسح هي وكارتها وصورها من المسودة</li><li>٥ حجوزات وسجل فلوسها بيتصدروا Excel تلقائي قبل المسح</li><li>محتاج تكتب اسم الفعالية للتأكيد</li></ul></div></div></div></div>' +
      '<div class="modal__foot"><button class="btn btn--primary">' + ic('archive') + 'خليها في الأرشيف</button><button class="btn btn--ghost">إلغاء</button></div></div></div>' +
      '<div class="toast">' + ic('check') + 'اتنقلت للأرشيف<button class="btn btn--sm">تراجع</button></div>';
  };

  V.intro = V.home;

  /* ---------- round 2 screens (proposal-2.js) ---------- */
  var AV = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a6f8f"/><stop offset="1" stop-color="#123a5c"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="25" r="11" fill="#cfe7f0"/><path d="M10 60c2-13 11-20 22-20s20 7 22 20z" fill="#cfe7f0"/></svg>');
  var ME = '<span class="avatar avatar--img"><img src="' + AV + '" alt=""></span>';
  if (window.MORE) window.MORE({ NAV: NAV, V: V, ic: ic, tabs: tabs, sw: sw, field: field, inp: inp, settingsShell: settingsShell, IMG: IMG, LOGO: LOGO, AREA_OF: AREA_OF, TITLE: TITLE, ME: ME, AV: AV });
  area = AREA_OF[S] || 'home';

  /* ---------- paint ---------- */
  var html = (V[S] || V.home)();
  var shell = '<div class="app">' + rail() + '<div class="main">' + top() + '<main class="view">' + html.replace(/<div class="scrim">[\s\S]*$/, '') + '</main></div>' + dock() + '</div>' + (html.match(/<div class="scrim">[\s\S]*$/) || [''])[0];
  // round 2: every admin can have a photo; مينا has one here, the others keep their letter
  document.body.innerHTML = Q.get('letters') ? shell : shell.replace(/<span class="avatar">م<\/span>/g, ME);
  if (window.matchMedia('(max-width: 760px)').matches) document.querySelectorAll('[data-cols]').forEach(function (n) { n.style.gridTemplateColumns = '1fr'; });

  /* ---------- the intro: the approved preview's motion, ported 1:1 ---------- */
  function dust(cv, dur) {
    var ctx = cv.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight, ps = [], start = performance.now();
    cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var c = getComputedStyle(document.documentElement).getPropertyValue('--acc-hi-rgb').trim().split(/\s+/).join(',');
    for (var i = 0; i < 48; i++) ps.push({ x: Math.random() * w, y: h * (0.3 + Math.random() * 0.8), r: 0.6 + Math.random() * 1.9, v: 0.15 + Math.random() * 0.55, a: Math.random() * 6.28, s: 0.5 + Math.random() });
    (function frame(t) {
      if (!cv.isConnected) return;
      var k = (t - start) / dur, fade = k < 0.15 ? k / 0.15 : k > 0.85 ? Math.max(0, (1 - k) / 0.15) : 1;
      ctx.clearRect(0, 0, w, h);
      ps.forEach(function (p) { p.y -= p.v; p.x += Math.sin(p.a += 0.02) * 0.25; var tw = 0.5 + 0.5 * Math.sin(p.a * 3 * p.s); ctx.beginPath(); ctx.fillStyle = 'rgba(' + c + ',' + ((0.08 + 0.32 * tw) * fade).toFixed(3) + ')'; ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); });
      if (k < 1) requestAnimationFrame(frame);
    })(start);
  }
  function playIntro(freezeAt) {
    var app = document.querySelector('.app');
    var el = document.createElement('div');
    el.className = 'intro';
    el.innerHTML = '<div class="intro__bg"><div class="intro__rays"></div><canvas class="intro__dust"></canvas></div><div class="intro__core"><div class="intro__mark"><span class="intro__halo"></span><span class="intro__ring"></span><img class="intro__logo" src="' + LOGO + '" alt=""><span class="intro__sweep"><i></i></span></div><div class="intro__text"><p class="intro__title">لوحة التحكم</p><p class="intro__sub">أهلًا يا مينا · أسرة البابا أثناسيوس الرسولي · سفاجا</p></div><div class="intro__load"><span class="intro__progress"><i></i></span><span class="intro__status">بنجهز لوحتك…</span></div></div>';
    document.body.appendChild(el);
    app.classList.add('is-intro', 'is-entering');
    setTimeout(function () { app.classList.remove('is-entering'); }, 1300);
    dust(el.querySelector('canvas'), 2600);
    var anims = [], D = 1900, E = 'cubic-bezier(.16,1,.3,1)', done = false;
    function A(sel, kf, o) { var a = el.querySelector(sel).animate(kf, Object.assign({ fill: 'both', easing: 'cubic-bezier(.22,1,.36,1)' }, o)); anims.push(a); return a; }
    A('.intro__rays', [{ opacity: 0, transform: 'rotate(0deg)' }, { opacity: 1, transform: 'rotate(8deg)' }], { duration: 2600, easing: 'linear' });
    A('.intro__halo', [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 1000, delay: 100 });
    A('.intro__logo', [{ opacity: 0, transform: 'scale(.9)', filter: 'blur(10px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { duration: 850, delay: 150, easing: E });
    A('.intro__ring', [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 450, easing: E });
    A('.intro__sweep i', [{ left: '-60%' }, { left: '140%' }], { duration: 750, delay: 850, easing: 'ease-in-out' });
    A('.intro__title', [{ opacity: 0, transform: 'translateY(12px)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { duration: 750, delay: 600, easing: E });
    A('.intro__sub', [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 900, easing: E });
    A('.intro__load', [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 300 });
    A('.intro__progress i', [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: D, easing: 'linear' });
    var status = el.querySelector('.intro__status');
    setTimeout(function () { status.textContent = 'اللوحة جاهزة ✓'; }, 800);
    if (freezeAt != null) { anims.forEach(function (a) { a.pause(); a.currentTime = freezeAt; }); return; }
    var timer = setTimeout(function () { exit(false); }, D);
    el.addEventListener('click', function () { exit(true); });
    function exit(fast) {
      if (done) return; done = true; clearTimeout(timer);
      anims.forEach(function (a) { try { a.finish(); } catch (e) {} });
      ['.intro__text', '.intro__load', '.intro__halo', '.intro__ring', '.intro__sweep'].forEach(function (s) { el.querySelector(s).animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: fast ? 160 : 320, fill: 'both', easing: 'ease-in' }); });
      el.querySelector('.intro__bg').animate([{ opacity: 1 }, { opacity: 0 }], { duration: fast ? 260 : 520, delay: fast ? 60 : 300, fill: 'both', easing: 'ease-in-out' });
      // the logo travels to its home in the rail (or the phone's top bar)
      var logo = el.querySelector('.intro__logo'), t = [document.querySelector('.brand img'), document.querySelector('.mtop img')].filter(function (n) { return n && n.offsetParent; })[0];
      var end = function () { el.remove(); app.classList.remove('is-intro'); };
      if (!t) { setTimeout(end, 600); return; }
      var a = logo.getBoundingClientRect(), b = t.getBoundingClientRect();
      var dx = (b.left + b.width / 2) - (a.left + a.width / 2), dy = (b.top + b.height / 2) - (a.top + a.height / 2), sc = b.width / a.width;
      logo.animate([{ transform: 'none' }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')' }], { duration: fast ? 420 : 760, easing: E, fill: 'both' }).onfinish = end;
    }
  }
  if (S === 'intro' || Q.get('intro')) playIntro(Q.get('freeze') != null ? Number(Q.get('freeze')) : null);
  window.playIntro = playIntro;
})();
