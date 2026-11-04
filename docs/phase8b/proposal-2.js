/* Phase 8B round 2 (owner 2026-11-04): media, activity, youth list, admin photo, competitions,
   team / roles / permissions. Same tokens, icons and patterns as round 1 (approved).
   The permissions model is the Worker's own: worker/src/lib/perms.js (CATALOG, scopes all/own, PRESETS,
   PRIMARY_DEFAULT, PERMS_ENFORCE). */
if (window.ADMIN_ICONS && !window.ADMIN_ICONS.play) window.ADMIN_ICONS.play = '<svg class="icon icon--line" viewBox="0 0 24 24"><path class="duo" d="M8 5.5v13l10.5-6.5Z"/><path d="M8 5.5v13l10.5-6.5Z"/></svg>';
window.MORE = function (P) {
  var V = P.V, ic = P.ic, tabs = P.tabs, sw = P.sw, field = P.field, inp = P.inp, IMG = P.IMG, ME = P.ME;
  ['media', 'media-item', 'media-select', 'media-trash'].forEach(function (k) { P.AREA_OF[k] = 'media'; });
  ['activity', 'activity-item', 'activity-manage'].forEach(function (k) { P.AREA_OF[k] = 'activity'; });
  ['youth-list'].forEach(function (k) { P.AREA_OF[k] = 'youth'; });
  ['comps', 'comp-work'].forEach(function (k) { P.AREA_OF[k] = 'comps'; });
  ['me-avatar', 'team', 'team-add', 'team-perms', 'team-confirm', 'team-remove', 'team-enforce'].forEach(function (k) { P.AREA_OF[k] = 'settings'; });
  ['denied'].forEach(function (k) { P.AREA_OF[k] = 'bookings'; });
  P.TITLE.media = ['الموقع', 'الصور والملفات'];
  P.TITLE.activity = ['الفريق', 'سجل النشاط'];
  P.TITLE.comps = ['المسابقات', 'المسابقات'];
  var M = '../../media/2026/';

  /* ============ الصور والملفات ============ */
  var LIB = [
    ['img-09d4476b', 'المسرح الأسود', 'صورة', '1600×1000', '182 KB', 'مستخدمة في ٣ أماكن', 1],
    ['img-685492a2', 'المسرح صامت', 'صورة', '1600×1000', '164 KB', 'مستخدمة في ٢', 1],
    ['img-cadc4835', 'الروابط المميزة', 'صورة', '1200×1200', '96 KB', 'مستخدمة في ١', 1],
    ['vid-0e05ae88', '', 'فيديو', '0:12', '2.1 MB', 'مستخدم في ١', 1],
    ['img-8ffd40eb', '', 'صورة', '1600×900', '141 KB', 'مش مستخدمة', 0],
    ['img-53ca69a3', '', 'صورة', '1600×900', '133 KB', 'مستخدمة في ١', 1],
    ['vid-10486833', '', 'فيديو', '0:08', '1.4 MB', 'مستخدم في ١', 1],
    ['img-3bd86461', '', 'صورة', '1080×1350', '120 KB', 'مش مستخدمة', 0],
    ['img-4f71317c', '', 'صورة', '1600×1000', '150 KB', 'مستخدمة في ١', 1],
    ['vid-16578d0e', '', 'فيديو', '0:15', '2.6 MB', 'مش مستخدم', 0],
    ['img-592fd134', '', 'صورة', '1600×1000', '158 KB', 'مستخدمة في ١', 1],
    ['img-5d2af330', '', 'صورة', '1200×1200', '88 KB', 'مش مستخدمة', 0],
    ['vid-2b939f69', '', 'فيديو', '0:10', '1.9 MB', 'مستخدم في ١', 1],
    ['img-af6b0c28', '', 'صورة', '1600×900', '139 KB', 'مستخدمة في ١', 1],
    ['img-b0d59876', '', 'صورة', '1600×900', '127 KB', 'مش مستخدمة', 0]
  ];
  function tile(m, sel, i) {
    var vid = m[2] === 'فيديو';
    return '<figure class="tile' + (sel && sel.indexOf(i) !== -1 ? ' is-sel' : '') + (sel ? ' is-picking' : '') + '"><img src="' + M + m[0] + '-480.webp" alt="">' +
      (vid ? '<span class="tile__dur">' + ic('play', 'ico-sm') + m[3] + '</span>' : '') + (sel ? '<span class="tile__check">' + ic('check') + '</span>' : '') +
      '<figcaption><b>' + (m[1] || '<span class="muted">من غير اسم</span>') + '</b><small>' + m[2] + ' · ' + m[4] + '</small></figcaption>' +
      '<span class="tile__use ' + (m[6] ? '' : 'is-free') + '">' + (m[6] ? ic('link', 'ico-sm') : '') + m[5] + '</span></figure>';
  }
  function mediaTop(on, picking) {
    return '<section class="card"><div class="card__head"><span class="chipico">' + ic('photos') + '</span><div><h3>الصور والملفات</h3><p>كل البوسترات والبانرات ومقاطع المشاهد في مكان واحد. الصورة بتتصغر وتتضغط لوحدها، والمكررة مبتترفعش تاني.</p></div><span class="sp"></span>' +
      (picking ? '' : '<button class="btn">' + ic('check') + 'اختيار</button><button class="btn btn--primary">' + ic('upload') + 'رفع صورة أو فيديو</button>') + '</div>' +
      '<div class="grid g4 kpis" style="margin-bottom:16px">' + [['photos', 'صور', '١٦'], ['video', 'فيديوهات', '١٥'], ['music', 'أصوات', '١'], ['trash', 'المحذوفة', '٠']].map(function (k) { return '<div class="kpi"><small>' + ic(k[0], 'ico-sm') + k[1] + '</small><b>' + k[2] + '</b></div>'; }).join('') + '</div>' +
      '<div class="row" style="margin-bottom:16px"><div class="seg">' + [['الكل (٣٢)', 'all'], ['صور', 'img'], ['فيديوهات', 'vid'], ['أصوات', 'aud'], ['مش مستخدمة', 'free'], ['المحذوفة', 'trash']].map(function (s) { return '<span class="' + (s[1] === on ? 'is-on' : '') + '">' + s[0] + '</span>'; }).join('') + '</div><span class="sp"></span>' +
      '<div class="seg"><span class="is-on">' + ic('grid', 'ico-sm') + '</span><span>' + ic('layers', 'ico-sm') + '</span></div><span class="search" style="width:260px">' + ic('filter') + 'دوّر بالاسم أو الوصف…</span></div>';
  }
  V.media = function () {
    return mediaTop('all') + '<div class="drop drop--wide" style="margin-bottom:16px">' + ic('upload') + '<b>اسحب صور أو فيديو هنا</b><small>الفيديو (حتى لو كبير جدًا): بتختار منه جزء من ثانية لـ ٣٠ ثانية، والمقطع بس هو اللي بيترفع</small></div>' +
      '<div class="tiles">' + LIB.map(function (m, i) { return tile(m, null, i); }).join('') + '</div><button class="btn btn--ghost btn--block" style="margin-top:14px">اعرض كمان (١٧)</button></section>';
  };
  V['media-select'] = function () {
    var sel = [4, 7, 9, 11];
    return mediaTop('free', true) + '<div class="tiles">' + LIB.filter(function (m) { return !m[6]; }).concat(LIB.filter(function (m) { return m[6]; }).slice(0, 6)).map(function (m, i) { return tile(m, sel.map(function (x, j) { return j; }), i); }).join('') + '</div></section>' +
      '<div class="bulk"><b>٤ مختارة</b><small class="muted">كلهم مش مستخدمين</small><span class="sp"></span><button class="btn btn--sm btn--ghost">اختار الكل</button><button class="btn btn--sm btn--danger">' + ic('trash') + 'شيل المختارة</button><button class="btn btn--sm">خلّص الاختيار</button></div>';
  };
  V['media-trash'] = function () {
    return mediaTop('trash') + '<div class="drop" style="padding:44px">' + ic('trash') + '<b>المحذوفة فاضية</b><small>اللي بتشيله بيفضل هنا لحد ما ترجّعه أو تمسحه نهائي. المستخدم في مكان مبيتشالش.</small></div></section>';
  };
  V['media-item'] = function () {
    var m = LIB[0];
    return V.media() + '<div class="scrim"><div class="modal modal--viewer"><div class="modal__head"><span class="chipico">' + ic('photos') + '</span><div><h2>المسرح الأسود</h2><p class="mono">' + m[0] + ' · ' + m[3] + ' · ' + m[4] + '</p></div><span class="sp"></span><button class="iconbtn" style="transform:rotate(-90deg)">' + ic('chevron') + '</button><button class="iconbtn" style="transform:rotate(90deg)">' + ic('chevron') + '</button><button class="iconbtn">' + ic('close') + '</button></div>' +
      '<div class="viewer"><div class="viewer__stage"><img src="' + M + m[0] + '-1200.webp" onerror="this.src=\'' + M + m[0] + '-480.webp\'" alt=""><button class="btn btn--sm viewer__full">' + ic('external') + 'شوفها بالحجم الكامل</button></div>' +
      '<aside class="viewer__side"><div class="fgrid">' + field('اسم الصورة', inp('المسرح الأسود'), 'علشان تلاقيها بسهولة', 'c12') + field('الوصف', inp('', 'مثلاً: الشباب في رحلة الغردقة'), 'للي بيستخدم قارئ شاشة', 'c12') + '</div>' +
      '<div class="kv" style="margin-top:6px"><div><span>النوع</span><b>صورة · WebP</b><em></em></div><div><span>المقاس</span><b class="mono">1600×1000</b><em></em></div><div><span>الحجم</span><b class="mono">182 KB</b><em></em></div><div><span>على الموقع</span><b><span class="tag tag--ok">منشورة</span></b><em></em></div></div>' +
      '<h5 style="margin:16px 0 8px;font-size:12px;color:var(--text-3)">مستخدمة في</h5><div class="list">' +
      [['theatre', 'صفحة الخدمة «المسرح الأسود»', 'البانر'], ['layers', 'الصفحة الرئيسية', 'كارت «خدماتنا»'], ['megaphone', 'خبر «رحلة الغردقة»', 'الصورة']].map(function (u) { return '<div class="item" style="padding:10px 12px"><span class="chipico" style="width:32px;height:32px">' + ic(u[0], 'ico-sm') + '</span><div class="item__main"><b style="font-size:13px">' + u[1] + '</b><small>' + u[2] + '</small></div><button class="btn btn--sm btn--ghost">افتح</button></div>'; }).join('') + '</div>' +
      '<div class="note-warn" style="margin-top:14px">' + ic('lock', 'ico-sm') + 'مستخدمة، فمش هتتشال لحد ما تغيّرها في الأماكن دي.</div></aside></div>' +
      '<div class="modal__foot"><button class="btn btn--primary">' + ic('check') + 'احفظ</button><button class="btn">' + ic('copy') + 'انسخ الرابط</button><span class="sp"></span><button class="btn btn--sm btn--danger" disabled>' + ic('trash') + 'شيلها</button></div></div></div>';
  };

  /* ============ سجل النشاط ============ */
  var FEED = [
    ['النهارده', [
      ['م', 'مينا زكريا', 'شاف باسورد مشترك', 'مينا زكريا عطاالله', 'الشباب', 'key', '٨:١٢ م', '٤ مرات', 'acc'],
      ['م', 'مينا زكريا', 'نشر تحديث للموقع', '٣ تغييرات', 'النشر', 'send', '٢:١٣ م', '', 'ok'],
      ['م', 'مينا زكريا', 'عدّل فعالية', 'تجربة حجز', 'الفعاليات', 'edit', '٢:٠٥ م', '', ''],
      ['م', 'مينا زكريا', 'اعتمد رقم دفع', 'إنستاباي · مينا زكريا عطاالله متى', 'الحجوزات والفلوس', 'shield', '١:٤٠ م', '', 'warn'],
      ['م', 'مينا زكريا', 'شال صورة', 'img-b208504b', 'الصور', 'trash', '١:٢٢ م', '', 'danger']]],
    ['امبارح · التلات ٣ نوفمبر', [
      ['ح', 'حساب الأسرة', 'نشر تحديث للموقع', '', 'النشر', 'send', '٦:٣٤ م', '٤ مرات', 'ok'],
      ['م', 'مينا زكريا', 'غيّر صلاحيات', 'كريستين عماد → خادم – حجوزات', 'الصلاحيات والأمان', 'shield', '٢:٣٤ م', '', 'warn'],
      ['م', 'مينا زكريا', 'أرشف فعالية', 'اختبار نظام الحجز - مؤقت', 'الفعاليات', 'archive', '١:٤٥ م', '', '']]]
  ];
  function feedRow(r, on) {
    return '<div class="arow' + (on ? ' is-on' : '') + '"><span class="avatar">' + r[0] + '</span><span class="arow__ic chipico ' + (r[8] ? 'chipico--' + (r[8] === 'acc' ? '' : r[8]) : '') + '">' + ic(r[5], 'ico-sm') + '</span>' +
      '<div class="item__main"><b><span class="arow__who">' + r[1] + '</span> ' + r[2] + (r[3] ? ' <span class="t2">«' + r[3] + '»</span>' : '') + (r[7] ? ' <span class="x">' + r[7] + '</span>' : '') + '</b><small>' + r[4] + '</small></div><span class="muted arow__t">' + r[6] + '</span><button class="btn btn--sm btn--ghost">افتح</button></div>';
  }
  function activityBase(sel) {
    return tabs(['السجل', 'الأرشيف', 'تطبيق الإدارة'], 'السجل') +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('clock') + '</span><div><h3>سجل النشاط</h3><p>كل اللي اتعمل في لوحة التحكم: مين عمل إيه وإمتى. «افتح» بتوديك للحاجة نفسها.</p></div><span class="sp"></span><button class="btn">' + ic('download') + 'تصدير</button><button class="btn">' + ic('archive') + 'إدارة السجل</button></div>' +
      '<div class="filters"><div class="fpill is-on">' + ic('users', 'ico-sm') + 'كل الأدمنز</div><div class="fpill">' + ic('layers', 'ico-sm') + 'كل الأقسام</div><div class="fpill">' + ic('edit', 'ico-sm') + 'كل العمليات</div><div class="fpill">' + ic('calendar', 'ico-sm') + 'آخر ٧ أيام</div><span class="sp"></span><span class="search" style="width:240px">' + ic('filter') + 'دوّر في السجل…</span></div>' +
      '<div class="chips-row"><span class="tag tag--acc">النشر ٥</span><span class="tag">الفعاليات ٢</span><span class="tag">الشباب ٤</span><span class="tag">الحجوزات والفلوس ١</span><span class="tag">الصلاحيات والأمان ١</span><span class="tag">الصور ١</span></div>' +
      FEED.map(function (d, di) { return '<h4 class="aday">' + d[0] + '</h4><div class="list">' + d[1].map(function (r, i) { return feedRow(r, sel && di === 1 && i === 1); }).join('') + '</div>'; }).join('') +
      '<button class="btn btn--ghost btn--block" style="margin-top:14px">اعرض أقدم</button></section>';
  }
  V.activity = function () { return activityBase(false); };
  V['activity-item'] = function () {
    return activityBase(true) + '<div class="scrim"><div class="modal modal--md"><div class="modal__head"><span class="chipico chipico--warn">' + ic('shield') + '</span><div><h2>مينا زكريا غيّر صلاحيات «كريستين عماد»</h2><p>التلات ٣ نوفمبر · ٢:٣٤ م · الصلاحيات والأمان</p></div><span class="sp"></span><button class="iconbtn">' + ic('close') + '</button></div>' +
      '<div class="modal__body"><div class="grid g2"><div class="card" style="padding:16px"><small class="muted">كان</small><b style="display:block;margin:4px 0 10px">مشاهد</b><div class="row"><span class="tag">يشوف كل الأقسام</span></div></div><div class="card" style="padding:16px;border-color:var(--p-acc-line)"><small class="muted">بقى</small><b style="display:block;margin:4px 0 10px">خادم – حجوزات</b><div class="row"><span class="tag tag--acc">الحجوزات: يشوف</span><span class="tag tag--acc">الفعاليات: يشوف</span><span class="tag tag--warn">يسجّل حجز كاش · بتوعه بس</span></div></div></div>' +
      '<div class="kv" style="margin-top:16px"><div><span>عمله</span><b>مينا زكريا · menazakmena@gmail.com</b><em></em></div><div><span>من</span><b>كمبيوتر · Chrome</b><em></em></div><div><span>نوع الصف</span><b>أمان (محمي سنة كاملة)</b><em></em></div></div></div>' +
      '<div class="modal__foot"><button class="btn btn--primary">' + ic('shield') + 'افتح صلاحيات كريستين</button><button class="btn btn--ghost">قفل</button><span class="sp"></span><button class="btn btn--sm btn--ghost">' + ic('copy') + 'انسخ رقم الحدث</button></div></div></div>';
  };
  V['activity-manage'] = function () {
    return activityBase(false) + '<div class="scrim"><div class="modal modal--md"><div class="modal__head"><span class="chipico">' + ic('archive') + '</span><div><h2>إدارة السجل</h2><p>السجل بيتنضف لوحده كل ليلة: بيفضل آخر سنة وبحد أقصى ٥٢٥٠ صف</p></div><span class="sp"></span><button class="iconbtn">' + ic('close') + '</button></div>' +
      '<div class="modal__body"><div class="field"><label>الصفوف</label><div class="grid g2"><div class="choice is-on"><span class="radio"></span><div><b>الصفوف التقنية بس</b><small>زي الإيصالات وفحص الطوابير: أكبر جزء من السجل ومحدش بيحتاجه</small></div></div><div class="choice"><span class="radio"></span><div><b>كل الصفوف</b><small>ما عدا الأمان والصلاحيات من آخر سنة (محمية)</small></div></div></div></div>' +
      '<div class="field" style="margin-top:16px"><label>الفترة</label><div class="seg"><span>أقدم من ٣ شهور</span><span class="is-on">أقدم من ٦ شهور</span><span>أقدم من سنة</span><span>لحد يوم…</span></div><div class="hint">أقل حاجة ٣ شهور: الأحدث من كده بيفضل</div></div>' +
      '<div class="preview-box"><div><b style="font-size:24px">١٬٢٤٠</b><small class="muted">صف هيتأثر · أقدم صف ١٢ مايو ٢٠٢٦</small></div><div class="bar"><i style="width:24%"></i></div></div>' +
      '<div class="grid g2" style="margin-top:14px"><div class="opt is-on"><span class="radio" style="border-color:var(--acc);box-shadow:inset 0 0 0 4px var(--bg),inset 0 0 0 10px var(--acc)"></span><div><b>أرشفهم</b> <span class="tag tag--ok">بترجع</span><ul><li>بيتشالوا من السجل ويتحفظوا في «الأرشيف»</li><li>تفتح أي أرشيف وتصدّره</li></ul></div></div><div class="opt opt--danger"><span class="radio"></span><div><b style="color:var(--danger)">امسحهم</b> <span class="tag tag--danger">مبترجعش</span><ul><li>الأحسن تأرشف الأول</li><li>المسح نفسه بيتسجل كصف واحد</li></ul></div></div></div></div>' +
      '<div class="modal__foot"><button class="btn btn--primary">' + ic('archive') + 'أرشف ١٬٢٤٠ صف</button><button class="btn btn--ghost">إلغاء</button></div></div></div>';
  };

  /* ============ حسابات الشباب: القايمة ============ */
  var PEOPLE = [
    ['مينا زكريا عطاالله', '01276162016', 'menazakmena@gmail.com', 'ok', 'مؤهل', 1, '', 0, 'p-ahtj7xz3'],
    ['كريستين عماد', '01205955243', 'christine.emad@…', 'ok', 'مؤهل (يدوي)', 0, '', 120, ''],
    ['حساب تجربة', '01000000001', 'test.youth@example.com', 'warn', 'ضيف', 0, 'الإيميل مش متأكد', 0, ''],
    ['اختبار الحجز - مؤقت', '01276162016', 'booking.test@example.com', 'danger', 'موقوف', 0, '', 0, '']
  ];
  V['youth-list'] = function () {
    return tabs(['حسابات الشباب', 'حسابات جديدة', 'النتايج', 'المتجر', 'المواسم'], 'حسابات الشباب') +
      '<div class="grid g4 kpis" style="margin-bottom:18px">' + [['users', 'كل الحسابات', '٤'], ['check', 'مؤهل', '٢'], ['user', 'ضيف', '١'], ['lock', 'موقوف', '١']].map(function (k) { return '<div class="kpi"><small>' + ic(k[0], 'ico-sm') + k[1] + '</small><b>' + k[2] + '</b></div>'; }).join('') + '</div>' +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('users') + '</span><div><h3>حسابات الشباب</h3><p>اضغط على أي كارت تفتح الحساب. الموبايل والإيميل بيتنسخوا بلمسة.</p></div><span class="sp"></span><button class="btn">' + ic('gear') + 'الإعدادات</button><button class="btn btn--ghost">' + ic('download') + 'تصدير Excel</button><button class="btn btn--primary">' + ic('plus') + 'حساب جديد</button></div>' +
      '<div class="row" style="margin-bottom:16px"><span class="search" style="width:340px;display:flex">' + ic('filter') + 'دوّر بالاسم أو الإيميل أو الموبايل…</span><span class="sp"></span><div class="seg"><span class="is-on">الكل</span><span>مؤهل</span><span>ضيف</span><span>موقوف</span></div></div>' +
      '<div class="ycards">' + PEOPLE.map(function (p, i) {
        return '<article class="yc' + (p[3] === 'danger' ? ' is-blocked' : '') + '"><span class="yc__face">' + (i === 0 ? '<img src="' + P.AV + '" alt="">' : p[0].charAt(0)) + '<i class="yc__dot yc__dot--' + p[3] + '"></i></span>' +
          '<div class="yc__main"><b>' + p[0] + '</b><div class="item__tags" style="margin:4px 0 8px"><span class="tag tag--' + p[3] + '">' + p[4] + '</span>' + (p[6] ? '<span class="tag tag--danger">' + p[6] + '</span>' : '') + (p[7] ? '<span class="tag tag--info">' + p[7] + ' نقطة</span>' : '') + '</div>' +
          '<button class="yc__copy">' + ic('phone', 'ico-sm') + '<bdi class="mono">' + p[1] + '</bdi>' + ic('copy', 'ico-sm') + '</button><button class="yc__copy">' + ic('mail', 'ico-sm') + '<bdi class="mono">' + p[2] + '</bdi>' + ic('copy', 'ico-sm') + '</button></div>' +
          '<span class="yc__go">' + ic('chevron') + '</span></article>';
      }).join('') + '</div><p class="muted" style="font-size:12px;margin:12px 0 0">الحساب الأول بياناته من صورتك. التلاتة التانيين أمثلة لحالات تانية (مؤهل يدوي، ضيف، موقوف)، والقايمة الحقيقية هتيجي من الـWorker زي دلوقتي.</p></section>';
  };

  /* ============ صورة الأدمن ============ */
  V['me-avatar'] = function () {
    return P.settingsShell('me', '<section class="card"><div class="card__head"><span class="chipico">' + ic('user') + '</span><div><h3>حسابي</h3><p>إنت داخل بـ menazakmena@gmail.com</p></div></div>' +
      '<div class="setrow"><span class="avatar avatar--img" style="width:64px;height:64px"><img src="' + P.AV + '" alt=""></span><div class="setrow__t"><b>صورتك الشخصية</b><small>اختيارية. بتظهر في القائمة، والشريط اللي فوق، والمتصلين دلوقتي، والسجل، والنشر. من غيرها بيظهر أول حرف من اسمك.</small></div><button class="btn btn--sm">' + ic('upload') + 'غيّر الصورة</button><button class="btn btn--sm btn--danger">' + ic('trash') + 'شيلها</button></div>' +
      '<div class="setrow"><span class="avatar">م</span><div class="setrow__t"><b>مينا زكريا</b><small>اسمك في اللوحة والسجل</small></div><button class="btn btn--sm">' + ic('edit') + 'غيّر الاسم</button></div>' +
      '<div class="setrow"><div class="setrow__t"><b>الدور</b><small>الأدمن الأساسي: صلاحياته كاملة ومينفعش يتشال</small></div><span class="tag tag--acc">الأدمن الأساسي</span></div></section>') +
      '<div class="scrim"><div class="modal modal--sm"><div class="modal__head"><span class="chipico">' + ic('photos') + '</span><div><h2>صورتك الشخصية</h2><p>حرّك وكبّر لحد ما وشك يبقى في الدايرة</p></div><span class="sp"></span><button class="iconbtn">' + ic('close') + '</button></div>' +
      '<div class="modal__body"><div class="crop"><img src="' + P.AV + '" alt=""><span class="crop__ring"></span></div><div class="row" style="margin-top:14px">' + ic('photos', 'ico-sm') + '<input type="range" class="range" value="40"><span class="muted" style="font-size:12px">تكبير</span></div>' +
      '<div class="row" style="margin-top:14px;justify-content:center">' + ['', 'sm'].map(function (s) { return '<span class="avatar avatar--img" style="width:' + (s ? 30 : 46) + 'px;height:' + (s ? 30 : 46) + 'px"><img src="' + P.AV + '" alt=""></span>'; }).join('') + '<small class="muted">كده هتظهر في القائمة والسجل</small></div>' +
      '<p class="muted" style="font-size:12px;margin:14px 0 0">بتتقص دايرة وتتضغط (أقصى ٢٠٠ KB)، ومبتظهرش في الموقع العام. أي أدمن يقدر يشيل صورته في أي وقت.</p></div>' +
      '<div class="modal__foot"><button class="btn btn--primary">' + ic('check') + 'احفظ الصورة</button><button class="btn btn--ghost">إلغاء</button><span class="sp"></span><button class="btn btn--sm">' + ic('upload') + 'اختار صورة تانية</button></div></div></div>';
  };

  /* ============ المسابقات ============ */
  var COMPS = [
    ['مسابقة الكتاب المقدس — الصوم الكبير', 'مسابقة عامة بدرجات', 'check', 'ok', 'مفتوحة', 'لحد الجمعة ١٣ نوفمبر', '٢٤ شارك · ٣ محتاجين مراجعة', 64],
    ['مسابقة نقاط الشهر', 'مسابقة نقاط', 'star', 'info', 'مجدولة', 'بتفتح الأحد ١٥ نوفمبر ٧:٠٠ م', '١٢ سؤال', 0],
    ['استبيان رحلة الغردقة', 'استبيان بسيط', 'form', '', 'مسودة', 'من غير مواعيد', 'مخفية لحد ما تتنشر', 0]
  ];
  V.comps = function () {
    return tabs(['المسابقات', 'الإعدادات'], 'المسابقات') +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('trophy') + '</span><div><h3>المسابقات</h3><p>كل مسابقة ليها صفحتها وأسئلتها ونتيجتها. اعمل جديدة: اسم ونوع ومواعيد، وبعدين الأسئلة.</p></div><span class="sp"></span><button class="btn">' + ic('archive') + 'المؤرشفة</button><button class="btn btn--primary">' + ic('plus') + 'مسابقة جديدة</button></div>' +
      '<div class="row" style="margin-bottom:16px"><div class="seg"><span class="is-on">الكل (٣)</span><span>مفتوحة (١)</span><span>مجدولة (١)</span><span>مسودة (١)</span><span>مقفولة (٠)</span></div><span class="sp"></span><span class="search" style="width:260px">' + ic('filter') + 'دوّر باسم المسابقة أو الرابط…</span></div>' +
      '<div class="ccards">' + COMPS.map(function (c) {
        return '<article class="cc"><div class="cc__band cc__band--' + (c[3] || 'muted') + '"></div><div class="row"><span class="chipico ' + (c[3] ? 'chipico--' + c[3] : '') + '">' + ic(c[2]) + '</span><div style="flex:1;min-width:0"><b class="cc__t">' + c[0] + '</b><small class="muted">' + c[1] + '</small></div><span class="tag ' + (c[3] ? 'tag--' + c[3] : '') + '">' + c[4] + '</span></div>' +
          '<div class="cc__facts"><span>' + ic('calendar', 'ico-sm') + c[5] + '</span><span>' + ic('users', 'ico-sm') + c[6] + '</span></div>' +
          (c[7] ? '<div class="kpi" style="padding:10px 12px;margin-top:10px"><small>اتصححت ٦٤٪</small><div class="bar"><i style="width:' + c[7] + '%"></i></div></div>' : '') +
          '<div class="row" style="margin-top:14px"><button class="btn btn--sm btn--primary">افتح</button><button class="btn btn--sm btn--ghost">' + ic('eye') + 'معاينة</button><span class="sp"></span><button class="iconbtn" style="width:34px;height:34px">' + ic('dots') + '</button></div></article>';
      }).join('') + '</div><p class="muted" style="font-size:12px;margin:12px 0 0">في صورتك القايمة فاضية؛ المسابقات الـ٣ دي أمثلة علشان يبان شكل الكارت في كل حالة.</p></section>';
  };
  V['comp-work'] = function () {
    var T = ['نظرة عامة', 'الأساسيات', 'الأسئلة', 'القواعد', 'الدرجة والنقاط', 'الإشعارات', 'المعاينة', 'المشاركات', 'المراجعة', 'النتائج'];
    return '<div class="row" style="margin-bottom:14px"><button class="btn btn--sm btn--ghost">' + ic('arrow') + 'كل المسابقات</button></div>' +
      '<section class="card card--glow hero" style="margin-bottom:16px"><span class="hero__art"></span><span class="chipico chipico--ok" style="width:56px;height:56px">' + ic('check') + '</span><div style="flex:1"><div class="row"><h1 style="font-size:22px">مسابقة الكتاب المقدس — الصوم الكبير</h1><span class="tag tag--ok">مفتوحة</span></div><p>مسابقة عامة بدرجات · <span class="mono">/competition/bible-lent/</span> · لحد الجمعة ١٣ نوفمبر ١١:٥٩ م</p></div><div class="row"><button class="btn">' + ic('copy') + 'انسخ الرابط</button><button class="btn">' + ic('eye') + 'جرّبها</button></div></section>' +
      '<div class="tabs" style="width:100%">' + T.map(function (t, i) { return '<button class="tab' + (i === 0 ? ' is-on' : '') + '">' + t + (t === 'المراجعة' ? ' <span class="badge">٣</span>' : '') + '</button>'; }).join('') + '</div>' +
      '<div class="grid g4 kpis">' + [['users', 'شاركوا', '٢٤'], ['check', 'اتصححت', '٢١'], ['alert', 'محتاجة مراجعة', '٣'], ['star', 'متوسط الدرجة', '٧٫٤ / ١٠']].map(function (k) { return '<div class="kpi"><small>' + ic(k[0], 'ico-sm') + k[1] + '</small><b>' + k[2] + '</b></div>'; }).join('') + '</div>' +
      '<div class="grid g2" style="margin-top:18px"><section class="card"><div class="card__head"><span class="chipico chipico--warn">' + ic('alert') + '</span><h3>محتاجة رأيك</h3><span class="sp"></span><button class="btn btn--sm">روح للمراجعة</button></div><div class="list">' +
      [['س٤ · إجابة مفتوحة', '«بولس الرسول» — ٢ إجابات زي بعض'], ['س٩ · إجابة قصيرة', '«يوحنا» بدل «يوحنا المعمدان»']].map(function (r) { return '<div class="item" style="padding:10px 12px"><div class="item__main"><b style="font-size:13.5px">' + r[0] + '</b><small>' + r[1] + '</small></div><button class="btn btn--sm btn--ghost">صح</button><button class="btn btn--sm btn--ghost">غلط</button></div>'; }).join('') + '</div></section>' +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('clock') + '</span><h3>المواعيد</h3></div><ul class="timeline"><li><b>فتحت</b><small>الأحد ١ نوفمبر · ٧:٠٠ م</small></li><li><b>تنبيه قبل النهاية بساعة</b><small>الجمعة ١٣ نوفمبر · ١٠:٥٩ م</small></li><li><b>بتقفل · والنتيجة تظهر</b><small>الجمعة ١٣ نوفمبر · ١١:٥٩ م</small></li></ul></section></div>' +
      '<p class="muted" style="font-size:12px">مثال لمسابقة مفتوحة علشان يبان شكل كل جزء. التبويبات الـ١٠ هي نفس اللي في المسابقة دلوقتي.</p>';
  };

  /* ============ الفريق والأدوار والصلاحيات ============ */
  var MODS = [
    ['content', 'المحتوى', 'megaphone', ['view', 'edit', 'delete']], ['publish', 'النشر', 'send', ['publish']], ['events', 'الفعاليات والخدام', 'theatre', ['view', 'add', 'edit', 'delete']],
    ['bookings', 'الحجوزات', 'ticket', ['view', 'create_cash', 'edit', 'approve', 'manage']], ['finance', 'الفلوس', 'wallet', ['view', 'manage']], ['exports', 'التصدير', 'download', ['export', 'export_pii']],
    ['competitions', 'المسابقات', 'trophy', ['view', 'add', 'edit', 'delete', 'approve']], ['store', 'المتجر', 'gift', ['view', 'add', 'edit', 'delete', 'approve']], ['points', 'النقاط', 'star', ['view', 'edit', 'approve']],
    ['participants', 'المشتركين', 'users', ['view', 'add', 'edit', 'manage']], ['media', 'الصور والفيديو', 'photos', ['view', 'add', 'delete']], ['push', 'الإشعارات', 'bell', ['view', 'manage']],
    ['accounts', 'الحسابات والصلاحيات', 'shield', ['view', 'manage']], ['activity', 'سجل النشاط', 'clock', ['view', 'manage']], ['notifications', 'إعدادات الإشعارات', 'mail', ['view', 'manage']], ['system', 'النظام', 'gear', ['view', 'manage']]
  ];
  var VERB = { view: 'يشوف', add: 'يضيف', edit: 'يعدّل', delete: 'يمسح', approve: 'يعتمد', publish: 'ينشر', export: 'يصدّر', export_pii: 'يصدّر بأرقام التليفونات', manage: 'يدير', create_cash: 'يسجّل حجز كاش' };
  var SENSITIVE = { 'accounts.manage': 1, 'notifications.manage': 1, 'participants.manage': 1, 'activity.manage': 1, 'exports.export_pii': 1, 'finance.manage': 1, 'system.manage': 1, 'publish.publish': 1 };
  var ROLES = [['treasurer', 'أمين الصندوق', 'wallet', 'الحجوزات والفلوس والتصدير'], ['servant_bookings', 'خادم – حجوزات', 'ticket', 'يشوف الحجوزات ويسجّل كاش لنفسه'], ['content_editor', 'محرر المحتوى', 'megaphone', 'المحتوى والفعاليات والصور والنشر'], ['viewer', 'مشاهد', 'eye', 'يشوف كل حاجة من غير تعديل'], ['custom', 'مخصص', 'gear', 'تختار الصلاحيات بنفسك']];
  // خادم – حجوزات, the preset the Worker defines (perms.js PRESETS.servant_bookings)
  var GRANTS = { 'bookings.view': 'all', 'events.view': 'all', 'bookings.create_cash': 'own' };
  var TEAM = [
    ['م', 'مينا زكريا', 'menazakmena@gmail.com', 'primary', 'الأدمن الأساسي', 'كل الصلاحيات', 'متصل دلوقتي', 'مينا زكريا عطاالله متى'],
    ['ح', 'حساب الأسرة', 'حساب الأسرة على جوجل', 'content_editor', 'محرر المحتوى', '١١ صلاحية', 'آخر دخول التلات ٣ نوفمبر', ''],
    ['ك', 'كريستين عماد', 'christine.emad@…', 'servant_bookings', 'خادم – حجوزات', '٣ صلاحيات · كاش بتاعها بس', 'آخر دخول من يومين', 'كريستين عماد']
  ];
  function teamCard(t, i, menu) {
    var primary = t[3] === 'primary';
    return '<article class="tm' + (primary ? ' is-primary' : '') + '" style="position:relative"><div class="row" style="flex-wrap:nowrap"><span class="avatar" style="width:46px;height:46px;font-size:17px">' + t[0] + '</span><div style="flex:1;min-width:0"><b style="font-size:15px">' + t[1] + '</b><small class="muted" style="display:block" dir="auto">' + t[2] + '</small></div>' +
      (primary ? '<span class="tag tag--acc">' + ic('lock', 'ico-sm') + 'الأساسي</span>' : '<button class="iconbtn" style="width:34px;height:34px' + (menu && i === 2 ? ';border-color:var(--acc)' : '') + '">' + ic('dots') + '</button>') + '</div>' +
      '<div class="tm__role"><span class="chipico" style="width:34px;height:34px">' + ic(primary ? 'shield' : ROLES.filter(function (r) { return r[0] === t[3]; })[0][2], 'ico-sm') + '</span><div><b>' + t[4] + '</b><small class="muted" style="display:block">' + t[5] + '</small></div></div>' +
      '<div class="cc__facts"><span>' + ic('clock', 'ico-sm') + t[6] + '</span>' + (t[7] ? '<span>' + ic('user', 'ico-sm') + 'مربوط بالخادم «' + t[7] + '»</span>' : '<span class="muted">' + ic('user', 'ico-sm') + 'مش مربوط بخادم</span>') + '</div>' +
      (primary ? '<p class="muted" style="font-size:12px;margin:12px 0 0">صلاحياته كاملة ومينفعش يتغير أو يتشال.</p>' : '<div class="row" style="margin-top:12px"><button class="btn btn--sm btn--primary">' + ic('shield') + 'الدور والصلاحيات</button><button class="btn btn--sm btn--ghost">' + ic('eye') + 'شوف اللوحة بعينه</button></div>') +
      (menu && i === 2 ? '<div class="menu" style="top:64px;left:14px"><a>' + ic('shield') + 'غيّر الدور والصلاحيات</a><a>' + ic('user') + 'غيّر الخادم المربوط</a><a>' + ic('logout') + 'اخرّجها من كل الأجهزة</a><hr><a class="danger">' + ic('userx') + 'شيلها من الإدارة…</a></div>' : '') + '</article>';
  }
  function teamBody(menu) {
    return '<div class="enforce"><span class="chipico chipico--ok">' + ic('shield') + '</span><div style="flex:1"><b>الصلاحيات مطبقة على السيرفر</b><small class="muted" style="display:block">كل طلب بيتراجع في الـWorker: اللي مش مسموح له بحاجة مبيقدرش يعملها حتى لو فتح الرابط مباشرة. الأقسام اللي مش ليه مبتظهرش أصلًا.</small></div><button class="btn btn--sm btn--ghost">إزاي بتشتغل؟</button></div>' +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('shield') + '</span><div><h3>الفريق والصلاحيات</h3><p>٣ من ٢٠ · مين يدخل اللوحة، ودوره، والمسموح له بيه</p></div><span class="sp"></span><button class="btn">' + ic('userx') + 'اللي اتشالوا (١)</button><button class="btn btn--primary">' + ic('plus') + 'ضيف خادم للإدارة</button></div>' +
      '<div class="tcards">' + TEAM.map(function (t, i) { return teamCard(t, i, menu); }).join('') + '</div></section>' +
      '<section class="card"><div class="card__head"><span class="chipico">' + ic('layers') + '</span><div><h3>الأدوار الجاهزة</h3><p>الدور بيملا الصلاحيات أول مرة بس، وبعدين تقدر تزوّد أو تشيل لكل خادم لوحده</p></div></div><div class="grid g4">' +
      ROLES.slice(0, 4).map(function (r) { return '<div class="kpi"><small>' + ic(r[2], 'ico-sm') + r[1] + '</small><p class="muted" style="margin:6px 0 0;font-size:12.5px">' + r[3] + '</p></div>'; }).join('') + '</div></section>';
  }
  V.team = function (menu) { return P.settingsShell('team', teamBody(menu)); };
  function permMatrix(g, changed) {
    return '<div class="pm">' + MODS.map(function (m) {
      var on = m[3].filter(function (a) { return g[m[0] + '.' + a]; }).length;
      return '<div class="pm__row' + (on ? ' has' : '') + '"><div class="pm__mod"><span class="chipico" style="width:32px;height:32px">' + ic(m[2], 'ico-sm') + '</span><b>' + m[1] + '</b>' + (on ? '<span class="badge">' + on + '</span>' : '') + '</div><div class="pm__acts">' +
        m[3].map(function (a) { var k = m[0] + '.' + a, v = g[k]; return '<span class="pchip' + (v ? ' is-on' : '') + (changed && changed[k] ? ' is-new' : '') + (SENSITIVE[k] ? ' is-sens' : '') + '">' + (v ? ic('check', 'ico-sm') : '') + VERB[a] + (v === 'own' ? ' <em>بتوعه بس</em>' : '') + (SENSITIVE[k] ? ic('alert', 'ico-sm') : '') + '</span>'; }).join('') + '</div></div>';
    }).join('') + '</div>';
  }
  V['team-perms'] = function () {
    var g = Object.assign({}, GRANTS, { 'bookings.edit': 'all', 'exports.export_pii': 'all' });
    return V.team() + '<div class="scrim"><div class="modal"><div class="modal__head"><span class="avatar" style="width:40px;height:40px">ك</span><div><h2>الدور والصلاحيات: كريستين عماد</h2><p>christine.emad@… · مربوطة بالخادم «كريستين عماد»</p></div><span class="sp"></span><button class="btn btn--sm btn--ghost">' + ic('eye') + 'شوف اللوحة بعينها</button><button class="iconbtn">' + ic('close') + '</button></div>' +
      '<div class="modal__body"><nav class="mnav"><small class="muted" style="display:block;padding:4px 12px 8px;font-weight:700;font-size:11px">الدور</small>' + ROLES.map(function (r) { return '<a class="' + (r[0] === 'custom' ? 'is-on' : '') + '">' + ic(r[2], 'ico-sm') + r[1] + '</a>'; }).join('') + '<p class="muted" style="font-size:11.5px;padding:10px 12px 0;margin:0">اخترت «خادم – حجوزات» وزوّدت عليه، فبقى «مخصص».</p></nav>' +
      '<div class="mcontent"><div class="row" style="margin-bottom:14px"><div class="seg"><span class="is-on">كل الأقسام</span><span>اللي متاح بس (٥)</span></div><span class="sp"></span><small class="muted">' + ic('alert', 'ico-sm') + ' = صلاحية حساسة محتاجة تأكيد</small></div>' + permMatrix(g, { 'bookings.edit': 1, 'exports.export_pii': 1 }) + '</div>' +
      '<aside class="maside"><h5>هتقدر تعمل إيه</h5><ul class="checklist"><li class="ok">' + ic('check', 'ico-sm') + 'تشوف الحجوزات والفعاليات</li><li class="ok">' + ic('check', 'ico-sm') + 'تسجّل حجز كاش (بتاعها بس)</li><li class="ok">' + ic('check', 'ico-sm') + 'تعدّل الحجوزات</li><li class="no">' + ic('alert', 'ico-sm') + 'تصدّر بأرقام التليفونات</li></ul>' +
      '<div class="hr"></div><h5>مش هتشوف</h5><p class="muted" style="font-size:12.5px;margin:0">المحتوى، الصفحة، الصور، المسابقات، الشباب، سجل النشاط، الإعدادات — مش هيظهروا في القائمة، والسيرفر هيرفض أي طلب ليهم.</p>' +
      '<div class="hr"></div><h5>نطاق «بتوعه بس»</h5><p class="muted" style="font-size:12.5px;margin:0">الحجوزات اللي على اسم الخادم المربوط بس. لو مفيش خادم مربوط، الصلاحية دي مبتشتغلش.</p></aside></div>' +
      '<div class="modal__foot"><button class="btn btn--primary">' + ic('check') + 'راجع التغييرات (٢)</button><button class="btn btn--ghost">إلغاء</button><span class="sp"></span><span class="saved">' + ic('info', 'ico-sm') + 'مفيش حاجة بتتغير قبل التأكيد</span></div></div></div>';
  };
  V['team-confirm'] = function () {
    return V.team() + '<div class="scrim"><div class="modal modal--sm"><div class="modal__head"><span class="chipico chipico--warn">' + ic('shield') + '</span><div><h2>تأكد تغيير صلاحيات كريستين عماد</h2><p>تغيير حساس: بيتسجل في «الصلاحيات والأمان»</p></div></div>' +
      '<div class="modal__body"><div class="list"><div class="item" style="padding:10px 12px"><span class="chipico chipico--ok" style="width:32px;height:32px">' + ic('plus', 'ico-sm') + '</span><div class="item__main"><b style="font-size:13.5px">الحجوزات: يعدّل</b><small>كل الحجوزات</small></div></div>' +
      '<div class="item" style="padding:10px 12px;border-color:rgb(242 195 91 / .4)"><span class="chipico chipico--warn" style="width:32px;height:32px">' + ic('alert', 'ico-sm') + '</span><div class="item__main"><b style="font-size:13.5px">التصدير: يصدّر بأرقام التليفونات</b><small>هتقدر تنزّل ملفات فيها موبايلات وإيميلات الشباب</small></div></div></div>' +
      '<div class="typed" style="margin-top:14px;border-color:rgb(242 195 91 / .4)"><b style="font-size:13px">علشان فيه صلاحية حساسة: اكتب <span style="color:var(--warn)">أكّد</span></b><input class="input is-focus" value="أكّد"></div>' +
      '<p class="muted" style="font-size:12px;margin:12px 0 0">التغيير بيتطبق على طول: لو كريستين فاتحة اللوحة دلوقتي، القائمة بتتحدث عندها في الطلب الجاي. وبيوصلك إشعار إدارة.</p></div>' +
      '<div class="modal__foot"><button class="btn btn--primary">' + ic('check') + 'أكّد التغيير</button><button class="btn btn--ghost">رجوع</button></div></div></div>';
  };
  V['team-add'] = function () {
    return V.team() + '<div class="scrim"><div class="modal modal--md"><div class="modal__head"><span class="chipico">' + ic('plus') + '</span><div><h2>ضيف خادم للإدارة</h2><p>٣ خطوات — مفيش حاجة بتتحفظ قبل الآخر</p></div><span class="sp"></span><button class="iconbtn">' + ic('close') + '</button></div>' +
      '<div class="modal__body"><div class="steps" style="margin-bottom:20px"><div class="step is-done"><i>✓</i><span>مين</span></div><span class="bar is-done"></span><div class="step is-on"><i>٢</i><span>الدور</span></div><span class="bar"></span><div class="step"><i>٣</i><span>راجع وأكّد</span></div></div>' +
      '<div class="item" style="margin-bottom:16px"><span class="avatar">ب</span><div class="item__main"><b>بيشوي ماهر</b><small class="mono">bishoy.maher@gmail.com · مربوط بالخادم «بيشوي ماهر»</small></div><button class="btn btn--sm btn--ghost">' + ic('edit') + 'غيّر</button></div>' +
      '<div class="field"><label>الدور</label><div class="grid g3">' + ROLES.map(function (r, i) { return '<div class="choice' + (i === 1 ? ' is-on' : '') + '" style="flex-direction:column"><div class="row" style="width:100%"><span class="chipico">' + ic(r[2]) + '</span><span class="sp"></span><span class="radio"></span></div><b>' + r[1] + '</b><small>' + r[3] + '</small></div>'; }).join('') + '</div><div class="hint">الدور بيملا الصلاحيات بس. هتقدر تعدّلها في الخطوة الجاية أو بعدين.</div></div>' +
      '<div class="toggle-row" style="margin-top:14px">' + sw(true) + '<div><b>ابعتله إيميل بالدعوة</b><small>فيه رابط اللوحة، ولازم يدخل بنفس حساب جوجل ده</small></div></div></div>' +
      '<div class="modal__foot"><button class="btn btn--primary" style="min-width:150px">التالي: راجع ‹</button><button class="btn btn--ghost">رجوع</button></div></div></div>';
  };
  V['team-enforce'] = function () {
    return P.settingsShell('team', '<section class="card"><div class="card__head"><span class="chipico chipico--warn">' + ic('shield') + '</span><div><h3>تطبيق الصلاحيات</h3><p>مرة واحدة قبل التشغيل: راجع كل واحد هيشوف إيه</p></div></div>' +
      '<div class="tablewrap"><table class="table cards"><thead><tr><th>الأدمن</th><th>الدور</th><th>هيشوف</th><th>مش هيشوف</th><th></th></tr></thead><tbody>' +
      [['حساب الأسرة', 'محرر المحتوى', 'المحتوى، الصفحة، الصور، الفعاليات، النشر', 'الحجوزات والفلوس، الشباب، الإعدادات'], ['كريستين عماد', 'خادم – حجوزات', 'الحجوزات (عرض + كاش بتاعها)، الفعاليات (عرض)', 'كل الباقي']].map(function (r) { return '<tr><td><b>' + r[0] + '</b></td><td data-l="الدور:">' + r[1] + '</td><td data-l="هيشوف:" style="color:var(--ok)">' + r[2] + '</td><td data-l="مش هيشوف:" class="muted">' + r[3] + '</td><td style="text-align:end"><button class="btn btn--sm btn--ghost">' + ic('eye') + 'بعينه</button></td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="setrow" style="margin-top:12px"><div class="setrow__t"><b>شغّل الصلاحيات</b><small>بيتجرب على Staging الأول. ترجّعه بلمسة لو حد اتقفل عليه حاجة محتاجها.</small></div>' + sw(false) + '</div></section>');
  };
  V.denied = function () {
    // the rail of a «خادم – حجوزات»: only the areas the grants allow (no المحتوى / الشباب / الإعدادات …)
    document.documentElement.dataset.role = 'servant';
    P.NAV.length = 0;
    P.NAV.push(['الشغل', [['home', 'grid', 'الرئيسية'], ['pages', 'theatre', 'الفعاليات'], ['bookings', 'ticket', 'الحجوزات والفلوس']]]);
    return '<div class="preview-as"><span class="avatar" style="width:28px;height:28px;font-size:12px">ك</span><b>بتشوف اللوحة بعين «كريستين عماد» · خادم – حجوزات</b><span class="sp"></span><button class="btn btn--sm">' + ic('close') + 'ارجع لعينك</button></div>' +
      '<section class="card" style="text-align:center;padding:56px 24px;max-width:620px;margin:40px auto"><span class="chipico chipico--warn" style="width:64px;height:64px;margin:0 auto 16px">' + ic('lock') + '</span><h3 style="margin:0 0 6px;font-size:20px">«الفلوس» مش متاحة لحسابك</h3><p class="muted" style="margin:0 0 18px">صلاحياتك: الحجوزات (عرض + حجز كاش بتاعك) والفعاليات (عرض). لو محتاجها، اطلبها من الأدمن الأساسي.</p><div class="row" style="justify-content:center"><button class="btn btn--primary">' + ic('ticket') + 'روح للحجوزات</button><button class="btn">' + ic('mail') + 'اطلب الصلاحية</button></div></section>';
  };
};
