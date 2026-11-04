/* Phase 8B round 3 (owner 2026-11-04): المحتوى (الاجتماعات، الأخبار، الفعاليات، الإشعارات)، صفحات الخدمة،
   التقارير المالية، إشعارات الموبايل، وباقي الإعدادات. Rounds 1–2 are approved and untouched.
   Data: content.json / black-theatre/page.json as published, the owner's screenshots, and the real field lists of
   apps-script/AdminContent.html, AdminItems.html, AdminPages.html, AdminBook.html, AdminPush.html, AdminPage.html. */
(function () {
  var prev = window.MORE;
  window.MORE = function (P) {
    if (prev) prev(P);
    var V = P.V, ic = P.ic, tabs = P.tabs, sw = P.sw, field = P.field, inp = P.inp, IMG = P.IMG;
    var M = '../../media/2026/';
    var map = {
      content: ['meetings', 'session-edit', 'news', 'news-edit', 'cards', 'card-edit', 'card-types', 'bell', 'bell-edit', 'games-soon'],
      notify: ['push', 'push-send'],
      pages: ['svcpages', 'svcpage-edit', 'svc-clip'],
      bookings: ['fin-report', 'fin-ledger', 'fin-handover'],
      settings: ['set-notify', 'set-site', 'set-content', 'set-system', 'set-guide']
    };
    Object.keys(map).forEach(function (a) { map[a].forEach(function (k) { P.AREA_OF[k] = a === 'notify' ? 'content' : a; }); });
    P.TITLE.content = ['الموقع', 'المحتوى'];

    var CT = ['الاجتماعات', 'الأخبار', 'ركن الألعاب', 'كروت المسابقات', 'الفعاليات', 'كروت خدماتنا', 'الإشعارات', 'إشعارات الموبايل'];
    function ctabs(on) {
      return '<div class="tabs">' + CT.map(function (t) {
        if (t === 'الألعاب') return '<button class="tab is-soon" disabled>' + t + ' <span class="tag" style="height:20px">قريبًا</span></button>';
        return '<button class="tab' + (t === on ? ' is-on' : '') + '">' + t + '</button>';
      }).join('') + '</div>';
    }
    function sec(icon, title, hint, body) { return '<div class="msec"><h4>' + ic(icon, 'ico-sm') + title + '</h4>' + (hint ? '<p>' + hint + '</p>' : '') + body + '</div>'; }
    function mnav(list, on) { return '<nav class="mnav">' + list.map(function (n, i) { return '<a class="' + (i === on ? 'is-on' : '') + '"><span class="n">' + '١٢٣٤٥٦٧٨'[i] + '</span>' + n + '</a>'; }).join('') + '</nav>'; }
    function bigModal(icon, title, sub, nav, content, aside, foot) {
      return '<div class="scrim"><div class="modal"><div class="modal__head"><span class="chipico">' + ic(icon) + '</span><div><h2>' + title + '</h2><p>' + sub + '</p></div><span class="sp"></span><button class="btn btn--sm btn--ghost">' + ic('eye') + 'معاينة</button><button class="vhelp" title="فيديو شرح · قريبًا" aria-label="فيديو شرح">' + ic('video') + '</button><button class="iconbtn">' + ic('close') + '</button></div>' +
        '<div class="modal__body">' + nav + '<div class="mcontent">' + content + '</div><aside class="maside">' + aside + '</aside></div>' +
        '<div class="modal__foot">' + (foot || '<button class="btn btn--primary" style="min-width:150px">' + ic('check') + 'احفظ</button><button class="btn btn--ghost">إلغاء</button><span class="sp"></span><span class="saved">' + ic('clock', 'ico-sm') + 'بيتحفظ كمسودة لحد «راجع وانشر»</span>') + '</div></div></div>';
    }
    function mdModal(icon, title, sub, body, foot, tone) {
      return '<div class="scrim"><div class="modal modal--md"><div class="modal__head"><span class="chipico ' + (tone || '') + '">' + ic(icon) + '</span><div><h2>' + title + '</h2><p>' + sub + '</p></div><span class="sp"></span><button class="vhelp" title="فيديو شرح · قريبًا" aria-label="فيديو شرح">' + ic('video') + '</button><button class="iconbtn">' + ic('close') + '</button></div><div class="modal__body">' + body + '</div><div class="modal__foot">' + foot + '</div></div></div>';
    }
    var saveFoot = '<button class="btn btn--primary" style="min-width:150px">' + ic('check') + 'احفظ</button><button class="btn btn--ghost">إلغاء</button>';
    function notifyRow(label, hint, on) { return '<div class="toggle-row">' + sw(on) + '<div><b>' + label + '</b><small>' + hint + '</small></div></div>'; }

    /* ================= الاجتماعات ================= */
    var SUNDAYS = [['٨', 'نوفمبر', 'بعد ٤ أيام'], ['١٥', 'نوفمبر', ''], ['٢٢', 'نوفمبر', ''], ['٢٩', 'نوفمبر', ''], ['٦', 'ديسمبر', '']];
    V.meetings = function () {
      return ctabs('الاجتماعات') +
        '<div class="grid" style="grid-template-columns:1fr 1.6fr" data-cols>' +
        '<section class="card card--glow"><div class="card__head"><span class="chipico">' + ic('church') + '</span><div><h3>الميعاد الأسبوعي</h3><p>بيظهر في «ركن الاجتماع» وفي ملف التقويم</p></div><span class="sp"></span><button class="btn btn--sm">' + ic('edit') + 'تعديل</button></div>' +
        '<div class="meet"><div class="meet__day"><b>' + ic('calendar') + '</b><small>كل أحد</small></div><div><b style="font-size:18px">اجتماع الشباب</b><p class="muted" style="margin:2px 0 0">الأحد · ٨:٠٠ م · ساعتين</p></div></div>' +
        '<div class="hr"></div><div class="kv" style="margin:0"><div><span>ملاحظة</span><b class="muted">مفيش</b><em></em></div><div><span>أيام مفيش فيها اجتماع</span><b class="muted">مفيش</b><em><button class="btn btn--sm btn--ghost">' + ic('plus') + '</button></em></div><div><span>التقويم</span><b class="mono">meeting.ics</b><em><button class="btn btn--sm btn--ghost">' + ic('copy') + '</button></em></div></div></section>' +
        '<section class="card"><div class="card__head"><span class="chipico">' + ic('calendar') + '</span><div><h3>الاجتماعات الجاية</h3><p>كل أحد ليه كارت: حط الموضوع والمتكلم، وهيظهر للشباب في ميعاده</p></div><span class="sp"></span><button class="btn">' + ic('upload') + 'برنامج الاجتماع</button><button class="btn btn--primary">' + ic('plus') + 'اجتماع</button></div>' +
        '<div class="list">' + SUNDAYS.map(function (d, i) {
          return '<div class="item"><div class="meet__day" style="width:62px;padding:6px 0"><b style="font-size:22px">' + d[0] + '</b><small>' + d[1] + '</small></div><div class="item__main"><b>' + (i === 0 ? 'الأحد ٨ نوفمبر · ٨:٠٠ م' : 'الأحد ' + d[0] + ' ' + d[1]) + (d[2] ? ' <span class="tag tag--acc">' + d[2] + '</span>' : '') + '</b><small>لسه مفيش موضوع</small></div><button class="btn btn--sm">' + ic('plus') + 'ضيف الموضوع</button></div>';
        }).join('') + '</div></section></div>';
    };
    V['session-edit'] = function () {
      return V.meetings() + mdModal('church', 'اجتماع الأحد ٨ نوفمبر', 'اجتماع الشباب · ٨:٠٠ م',
        '<div class="fgrid">' + field('الموضوع', inp('حياة التسليم', '', 'is-focus'), '', 'c8', '١١ / ٨٠') + field('التاريخ', inp('الأحد ٨ نوفمبر ٢٠٢٦'), '', 'c4') +
        field('الخادم / المتكلم', inp('أبونا أنطوني عياد'), '', 'c6', '١٧ / ٦٠') + field('المدة بالدقايق', inp('١٢٠'), 'فاضي = المدة الأسبوعية', 'c3') +
        field('الحالة', '<div class="seg"><span class="is-on">في ميعاده</span><span>اتلغى</span></div>', '', 'c3') +
        field('وصف', '<textarea class="input" rows="3" placeholder="اختياري: كلمتين عن الموضوع"></textarea>', '', 'c12', '٠ / ٥٠٠') + '</div>' +
        '<div class="hr"></div>' + notifyRow('ابعت إشعار بالموضوع', 'بيظهر في الجرس لما الموضوع يتنشر', true) +
        '<p class="muted" style="font-size:12px;margin:12px 0 0">مثال: الموضوع والمتكلم من بيانات التجربة؛ الاجتماعات الحقيقية لسه مفيهاش مواضيع.</p>',
        saveFoot + '<span class="sp"></span><button class="btn btn--sm btn--danger">' + ic('trash') + 'امسح الموضوع</button>');
    };

    /* ================= الأخبار ================= */
    V.news = function () {
      return ctabs('الأخبار') + '<section class="card"><div class="card__head"><span class="chipico">' + ic('megaphone') + '</span><div><h3>جديد الأسرة</h3><p>الأخبار اللي بتظهر في الصفحة الرئيسية: إعلان، رحلة، تسجيل… كل خبر ليه ميعاد يظهر ويختفي.</p></div><span class="sp"></span><button class="btn btn--primary">' + ic('plus') + 'خبر</button></div>' +
        '<div class="row" style="margin-bottom:14px"><div class="seg"><span class="is-on">ظاهرة (٠)</span><span>جاية (٠)</span><span>خلصت (٠)</span></div></div>' +
        '<div class="drop" style="padding:46px"><span class="chipico" style="width:56px;height:56px">' + ic('megaphone') + '</span><b style="font-size:16px;color:var(--text)">مفيش أخبار دلوقتي</b><small>الصفحة الرئيسية بتخبي قسم «جديد الأسرة» لوحدها لحد ما تضيف خبر.</small><button class="btn btn--primary" style="margin-top:8px">' + ic('plus') + 'اكتب أول خبر</button></div>' +
        '<h4 class="aday">هيبان كده لما يبقى فيه أخبار</h4><div class="list"><div class="item"><img class="item__thumb" src="' + M + 'img-cadc4835-480.webp" alt=""><div class="item__main"><b>رحلة الغردقة <span class="tag tag--warn">جديد</span> <span class="tag tag--acc">' + ic('star', 'ico-sm') + 'مميز</span></b><small>سجّل اسمك قبل الخميس · ظاهر لحد الخميس ١٢ نوفمبر</small><div class="item__tags"><span class="tag tag--ok">ظاهر</span><span class="tag">' + ic('bell', 'ico-sm') + 'عليه إشعار</span></div></div><button class="btn btn--sm">' + ic('edit') + 'تعديل</button><button class="iconbtn" style="width:34px;height:34px">' + ic('dots') + '</button></div></div></section>';
    };
    V['news-edit'] = function () {
      return V.news() + bigModal('megaphone', 'خبر جديد', 'جديد الأسرة · بيتحفظ مسودة لحد النشر', mnav(['الخبر', 'الزرار واللينك', 'الشكل', 'المواعيد', 'الإشعار'], 0),
        sec('edit', 'الخبر', 'العنوان والسطر القصير بيظهروا على الكارت؛ التفاصيل لما حد يفتحه', '<div class="fgrid">' + field('العنوان', inp('رحلة الغردقة', '', 'is-focus'), '', 'c6', '١١ / ٦٠') + field('سطر قصير', inp('سجّل اسمك قبل الخميس'), '', 'c6', '٢٠ / ١٢٠') + field('التفاصيل', '<textarea class="input" rows="4">يوم كامل على البحر… التفاصيل والأسعار في الاستمارة.</textarea>', '', 'c12', '٤٢ / ٢٠٠٠') + '</div>') +
        sec('link', 'الزرار واللينك', 'اختياري: لو فيه استمارة أو صفحة', '<div class="fgrid">' + field('لينك', inp('https://forms.gle/example', '', 'input--ltr'), '', 'c8') + field('نص الزرار', inp('سجّل دلوقتي'), '', 'c4', '١٠ / ٢٤') + '</div>') +
        sec('sparkle', 'الشكل', '', '<div class="fgrid">' + field('شارة', '<div class="seg"><span>من غير</span><span class="is-on">جديد</span><span>مهم</span><span>آخر فرصة</span></div>', '', 'c12') + field('شكل الشريط', '<div class="seg"><span class="is-on">صورة</span><span>أيقونة</span><span>لون بس</span></div>', 'الصورة بتكسب لو الاتنين موجودين', 'c8') + '<div class="c4">' + notifyRow('مميز', 'بيظهر كبير فوق', true) + '</div></div>') +
        sec('calendar', 'المواعيد', 'فاضي = من وقت النشر ولحد ما تشيله', '<div class="fgrid">' + field('يتنشر', inp('من وقت النشر'), '', 'c6') + field('يختفي', inp('الخميس ١٢ نوفمبر ٢٠٢٦ · ١١:٥٩ م'), '', 'c6') + '</div>') +
        sec('bell', 'الإشعار', '', notifyRow('إشعار في الجرس لما الخبر يتنشر', 'بيظهر للزوار في 🔔 وممكن تبعته موبايل من «إشعارات الموبايل»', true)),
        '<h5>هيظهر كده في الرئيسية</h5><div class="prevcard"><img src="' + M + 'img-cadc4835-480.webp" alt=""><div><div class="row"><b>رحلة الغردقة</b><span class="tag tag--warn">جديد</span></div><small class="muted">سجّل اسمك قبل الخميس</small><div class="row" style="margin-top:8px"><span class="tag tag--acc">سجّل دلوقتي</span></div></div></div>' +
        '<div class="hr"></div><h5>قبل النشر</h5><ul class="checklist"><li class="ok">' + ic('check', 'ico-sm') + 'العنوان والسطر القصير</li><li class="ok">' + ic('check', 'ico-sm') + 'اللينك شغال</li><li class="ok">' + ic('check', 'ico-sm') + 'ميعاد الاختفاء</li></ul>');
    };

    /* ================= الفعاليات (كروت) ================= */
    var CARDS = [['المسرح الأسود', 'حكايات بالنور والظل… ورسالة بتوصل من غير كلام', 'img-09d4476b'], ['المسرح صامت', 'فن بلا كلمات… ورسالة تلمس القلوب 🎭', 'img-685492a2']];
    V.cards = function () {
      return ctabs('كروت خدماتنا') + '<section class="card"><div class="card__head"><span class="chipico">' + ic('layers') + '</span><div><h3>كروت خدماتنا</h3><p>الكروت اللي بتظهر في قسم «خدماتنا» في الرئيسية. اسحب علشان تغيّر الترتيب.</p></div><span class="sp"></span><button class="btn">' + ic('gear') + 'أنواع الكروت</button><button class="btn btn--primary">' + ic('plus') + 'كارت</button></div>' +
        '<div class="ccards">' + CARDS.map(function (c) {
          return '<article class="cc" style="padding:0"><img src="' + M + c[2] + '-480.webp" alt="" style="width:100%;aspect-ratio:16/8;object-fit:cover;display:block"><div style="padding:14px 16px 16px"><div class="row"><span class="grip muted">' + ic('grip') + '</span><div style="flex:1;min-width:0"><b class="cc__t">' + c[0] + '</b><small class="muted">' + c[1] + '</small></div></div>' +
            '<div class="item__tags" style="margin-top:10px"><span class="tag tag--ok">ظاهر</span><span class="tag">' + ic('theatre', 'ico-sm') + 'خدمة</span><span class="tag">بانر</span><span class="tag tag--info">بيفتح صفحة الخدمة</span></div>' +
            '<div class="row" style="margin-top:12px"><button class="btn btn--sm btn--primary">' + ic('edit') + 'تعديل</button><button class="btn btn--sm btn--ghost">' + ic('eye') + 'معاينة</button><span class="sp"></span><button class="iconbtn" style="width:34px;height:34px">' + ic('dots') + '</button></div></div></article>';
        }).join('') + '</div></section>';
    };
    V['card-edit'] = function () {
      return V.cards() + bigModal('layers', 'تعديل: المسرح الأسود', 'كارت في «خدماتنا» · نوعه خدمة', mnav(['الكارت', 'الصورة والشكل', 'الزرار', 'المواعيد'], 0),
        sec('edit', 'الكارت', '', '<div class="fgrid">' + field('النوع', '<div class="seg"><span class="is-on">' + ic('theatre', 'ico-sm') + 'خدمة</span><span>+ نوع جديد</span></div>', '', 'c12') + field('العنوان', inp('المسرح الأسود'), '', 'c6', '١٢ / ٦٠') + field('سطر قصير', inp('حكايات بالنور والظل… ورسالة بتوصل من غير كلام'), '', 'c6', '٤٦ / ١٢٠') + field('التفاصيل', '<textarea class="input" rows="2" placeholder="اختياري"></textarea>', '', 'c8', '٠ / ٥٠٠') + field('المكان', inp('', 'اختياري'), '', 'c4') + '</div>') +
        sec('photos', 'الصورة والشكل', '', '<div class="fgrid"><div class="c6"><div class="drop"><img src="' + M + 'img-09d4476b-480.webp" style="width:100%;border-radius:12px;aspect-ratio:16/9;object-fit:cover" alt=""><button class="btn btn--sm">' + ic('photos') + 'غيّر من المكتبة</button></div></div><div class="c6 stack">' + field('الشكل', '<div class="seg"><span class="is-on">بانر</span><span>كارت</span><span>صف</span></div>', '', '') + field('القسم', '<div class="seg"><span class="is-on">خدماتنا</span><span>الفعاليات</span></div>', '', '') + '</div></div>') +
        sec('link', 'الزرار', '', '<div class="fgrid">' + field('اللينك', '<div class="input" style="display:flex;align-items:center;gap:8px">' + ic('theatre', 'ico-sm') + 'صفحة الخدمة «المسرح الأسود» <span class="mono muted">/black-theatre/</span></div>', '', 'c8') + field('نص الزرار', inp('', 'افتراضي النوع: اعرف أكتر'), '', 'c4') + '</div>') +
        sec('calendar', 'المواعيد', 'اختياري: للكروت اللي ليها ميعاد', '<div class="fgrid">' + field('بيبدأ', inp('', '—'), '', 'c3') + field('بيخلص', inp('', '—'), '', 'c3') + field('يظهر من', inp('', 'من النشر'), '', 'c3') + field('يختفي بعد', inp('', 'مبيختفيش'), '', 'c3') + '</div>'),
        '<div class="row" style="margin-bottom:10px"><h5 style="margin:0">المعاينة</h5><span class="sp"></span><div class="seg"><span class="is-on">' + ic('device', 'ico-sm') + '</span><span>' + ic('grid', 'ico-sm') + '</span></div></div><div class="prevcard"><img src="' + M + 'img-09d4476b-480.webp" alt=""><div><b>المسرح الأسود</b><small class="muted">حكايات بالنور والظل… ورسالة بتوصل من غير كلام</small><div class="row" style="margin-top:8px"><span class="tag tag--acc">اعرف أكتر</span></div></div></div>' +
        '<div class="hr"></div><h5>إدارة</h5><div class="stack"><button class="btn btn--sm btn--block">' + ic('eye-off') + 'خبّي الكارت</button><button class="btn btn--sm btn--block btn--danger">' + ic('trash') + 'امسح الكارت…</button></div>');
    };
    V['card-types'] = function () {
      return V.cards() + mdModal('gear', 'أنواع الكروت', 'النوع بيحدد الأيقونة واللون ونص الزرار الافتراضي',
        '<div class="list"><div class="item"><span class="chipico">' + ic('theatre') + '</span><div class="item__main"><b>خدمة <span class="mono muted" style="font-size:12px">service</span></b><small>اللون: ليلي · مستخدم في ٢ كروت</small></div><button class="btn btn--sm">' + ic('edit') + 'تعديل</button></div></div>' +
        '<div class="card" style="padding:16px;margin-top:14px"><b>نوع جديد</b><div class="fgrid" style="margin-top:12px">' + field('اسم النوع', inp('', 'مثلًا: رحلة'), '', 'c6') + field('مفتاح النوع', inp('', 'trip', 'input--ltr'), 'إنجليزي، مبيتغيرش بعدين', 'c6') +
        field('الأيقونة', '<div class="row">' + ['theatre', 'bus', 'church', 'music', 'trophy', 'heart', 'star', 'calendar'].map(function (n, i) { return '<span class="chipico' + (i === 1 ? '' : '') + '" style="width:36px;height:36px;' + (i === 1 ? 'box-shadow:0 0 0 2px var(--acc)' : '') + '">' + ic(n, 'ico-sm') + '</span>'; }).join('') + '</div>', '', 'c12') +
        field('اللون', '<div class="swatches"><i style="background:#0b2a4c"></i><i class="is-on" style="background:#2f9aa1"></i><i style="background:#d7aa50"></i><i style="background:#e0736b"></i><i style="background:#5ad7a0"></i></div>', '', 'c6') + field('نص الزرار الافتراضي', inp('', 'احجز مكانك'), '', 'c6') + field('نص الإشعار', inp('', 'رحلة جديدة: {العنوان}'), '', 'c12') + '</div></div>',
        '<button class="btn btn--primary">' + ic('plus') + 'ضيف النوع</button><button class="btn btn--ghost">قفل</button>');
    };

    /* ================= الإشعارات (الجرس) ================= */
    V.bell = function () {
      return ctabs('الإشعارات') + '<section class="card"><div class="card__head"><span class="chipico">' + ic('bell') + '</span><div><h3>جرس الإشعارات</h3><p>اللي بيظهر للزوار في 🔔 على الموقع. كل إشعار ليه ميعاد يظهر ويختفي، وتقدر تبعته موبايل كمان.</p></div><span class="sp"></span><button class="btn">' + ic('send') + 'إشعارات الموبايل</button><button class="btn btn--primary">' + ic('plus') + 'إشعار</button></div>' +
        '<div class="row" style="margin-bottom:14px"><div class="seg"><span class="is-on">ظاهرة (١)</span><span>جاية (٠)</span><span>خلصت (٠)</span></div></div>' +
        '<div class="list"><div class="item"><span class="chipico chipico--info">' + ic('bell') + '</span><div class="item__main"><b>🔔 تجربة إشعارات موقع الأسرة نسخ</b><small>ده إشعار تجريبي للتأكد إن إشعارات موقع الأسرة بتوصلك حتى لو الموقع مقفول.</small><div class="item__tags"><span class="tag tag--ok">ظاهر في الجرس</span><span class="tag">عام</span><span class="tag">من التلات ٣ نوفمبر ١:٤٤ م لحد التلات ١٧ نوفمبر</span><span class="tag tag--acc">' + ic('send', 'ico-sm') + 'اتبعت موبايل</span></div></div><button class="btn btn--sm">' + ic('edit') + 'تعديل</button><button class="iconbtn" style="width:34px;height:34px">' + ic('dots') + '</button></div></div></section>';
    };
    V['bell-edit'] = function () {
      return V.bell() + mdModal('bell', 'تعديل: 🔔 تجربة إشعارات موقع الأسرة نسخ', 'ظاهر في الجرس لحد التلات ١٧ نوفمبر',
        '<div class="grid" style="grid-template-columns:1fr 260px;gap:20px" data-cols><div><div class="fgrid">' + field('العنوان', inp('🔔 تجربة إشعارات موقع الأسرة نسخ'), '', 'c12', '٣٢ / ٦٠') + field('الرسالة', '<textarea class="input" rows="3">ده إشعار تجريبي للتأكد إن إشعارات موقع الأسرة بتوصلك حتى لو الموقع مقفول.</textarea>', '', 'c12', '٧٨ / ٢٠٠') +
        field('النوع', '<div class="seg"><span class="is-on">عام</span><span>مهم</span><span>تذكير</span></div>', '', 'c12') +
        field('لما حد يدوس عليه يفتح', '<div class="seg"><span class="is-on">مفيش</span><span>الرئيسية</span><span>ركن الاجتماع</span><span>خبر</span><span>فعالية</span><span>لينك</span></div>', '', 'c12') +
        field('يظهر في الجرس', inp('التلات ٣ نوفمبر · ١:٤٤ م'), '', 'c6') + field('يختفي من الجرس', inp('التلات ١٧ نوفمبر · ١:٤٤ م'), '', 'c6') + '</div></div>' +
        '<div><h5 style="margin:0 0 10px;font-size:12px;color:var(--text-3)">في الجرس على الموقع</h5><div class="phone-mini"><div class="phone-mini__bar">' + ic('bell', 'ico-sm') + '<b>الإشعارات</b></div><div class="phone-mini__n"><span class="chipico chipico--info" style="width:30px;height:30px">' + ic('bell', 'ico-sm') + '</span><div><b>🔔 تجربة إشعارات موقع الأسرة نسخ</b><small>ده إشعار تجريبي للتأكد إن إشعارات موقع الأسرة بتوصلك…</small></div></div></div></div></div>',
        saveFoot + '<span class="sp"></span><button class="btn btn--sm">' + ic('send') + 'ابعته موبايل…</button><button class="btn btn--sm btn--danger">' + ic('trash') + 'امسح</button>');
    };
    V['games-soon'] = function () {
      return ctabs('الألعاب') + '<section class="card" style="text-align:center;padding:60px 24px"><span class="chipico" style="width:64px;height:64px;margin:0 auto 16px">' + ic('star') + '</span><h3 style="margin:0 0 6px;font-size:20px">الألعاب · قريبًا</h3><p class="muted" style="margin:0">نظام الألعاب هيتعمل في Phase 10. القسم مقفول لحد ما نبدأ.</p></section>';
    };

    /* ================= إشعارات الموبايل ================= */
    V.push = function () {
      return ctabs('إشعارات الموبايل') +
        '<div class="grid g4 kpis">' + [['users', 'مشتركين', '٣'], ['device', 'أندرويد', '٢'], ['device', 'آيفون', '١'], ['send', 'اتبعت النهارده', '٠ من ٣']].map(function (k) { return '<div class="kpi"><small>' + ic(k[0], 'ico-sm') + k[1] + '</small><b>' + k[2] + '</b></div>'; }).join('') + '</div>' +
        '<div class="grid" style="grid-template-columns:1.5fr 1fr;margin-top:18px" data-cols><section class="card"><div class="card__head"><span class="chipico">' + ic('bell') + '</span><div><h3>ظاهرة على الموقع دلوقتي (١)</h3><p>اختار إشعار من الجرس وابعته للموبايلات. كل إشعار بيتبعت مرة واحدة بس.</p></div></div>' +
        '<div class="item"><span class="chipico chipico--info">' + ic('bell') + '</span><div class="item__main"><b>🔔 تجربة إشعارات موقع الأسرة نسخ</b><small>متاح لحد التلات ١٧ نوفمبر · بيفتح الصفحة الرئيسية</small></div><span class="tag tag--ok">' + ic('check', 'ico-sm') + 'اتبعت</span></div>' +
        '<div class="note-warn" style="margin-top:14px;background:var(--info-soft);color:var(--info)">' + ic('info', 'ico-sm') + 'الحد ٣ في اليوم، ودقيقة بين كل واحد والتاني. الإشعارات القليلة المهمة بتخلي الناس تسيبها شغالة.</div></section>' +
        '<section class="card"><div class="card__head"><span class="chipico">' + ic('clock') + '</span><h3>آخر الإرسالات</h3></div><ul class="timeline"><li><b>🔔 تجربة إشعارات موقع الأسرة نسخ</b><small>التلات ٣ نوفمبر ١:٤٥ م · وصل لـ٣ من ٤ أجهزة · جهاز اتشال قديم</small></li></ul><button class="btn btn--sm btn--ghost" style="margin-top:6px">' + ic('check') + 'اختبر الإعداد</button></section></div>' +
        '<p class="muted" style="font-size:12px">عدد المشتركين والأجهزة توضيحي؛ الإشعار وميعاده من الموقع المنشور.</p>';
    };
    V['push-send'] = function () {
      return V.push() + mdModal('send', 'ابعت إشعار موبايل', 'لكل المشتركين (٣ أجهزة) · مينفعش يترجع',
        '<div class="grid" style="grid-template-columns:1fr 280px;gap:22px" data-cols><div><div class="fgrid">' + field('العنوان', inp('🔔 تجربة إشعارات موقع الأسرة نسخ'), 'للإشعار ده بس — إشعار الجرس زي ما هو', 'c12', '٣٢ / ٦٥') + field('الكلام', '<textarea class="input" rows="3">ده إشعار تجريبي للتأكد إن إشعارات موقع الأسرة بتوصلك حتى لو الموقع مقفول.</textarea>', '', 'c12', '٧٨ / ١٧٨') + field('الصورة (بتظهر على أندرويد)', '<div class="drop" style="padding:14px;grid-auto-flow:column">' + ic('photos') + '<small>اختار من المكتبة · اختياري</small></div>', '', 'c12') + field('لما يدوسوا عليه', '<div class="input" style="display:flex;align-items:center;gap:8px">' + ic('home', 'ico-sm') + 'بيفتح الصفحة الرئيسية على الموقع</div>', '', 'c12') + '</div></div>' +
        '<div><h5 style="margin:0 0 10px;font-size:12px;color:var(--text-3)">شكل الإشعار على الموبايل</h5><div class="lock"><span class="lock__t">١:٤٥</span><div class="lock__n"><img src="' + P.LOGO + '" alt=""><div><small>أسرة البابا أثناسيوس - سفاجا · دلوقتي</small><b>🔔 تجربة إشعارات موقع الأسرة نسخ</b><p>ده إشعار تجريبي للتأكد إن إشعارات موقع الأسرة بتوصلك حتى لو الموقع مقفول.</p></div></div></div></div></div>',
        '<button class="btn btn--primary">' + ic('send') + 'ابعت دلوقتي</button><button class="btn btn--ghost">لأ، استنى</button><span class="sp"></span><span class="saved">' + ic('alert', 'ico-sm') + 'باقي ٣ إرسالات النهارده</span>');
    };

    /* ================= صفحات الخدمة ================= */
    var PAGES = [['المسرح الأسود', 'حكايات بالنور والظل… ورسالة بتوصل من غير كلام', 'img-09d4476b', '/black-theatre/', '٢ مقطع'], ['المسرح صامت', 'فن بلا كلمات… ورسالة تلمس القلوب 🎭', 'img-685492a2', '/silenttheatre/', '١ مقطع']];
    V.svcpages = function () {
      return tabs(['صفحات الخدمة', 'الفعاليات', 'الخدام'], 'صفحات الخدمة') + '<section class="card"><div class="card__head"><span class="chipico">' + ic('theatre') + '</span><div><h3>صفحات الخدمة</h3><p>صفحة كاملة لكل خدمة (الموقع/black-theatre/): غلاف، وصف، مقاطع فيديو، فريق الخدمة، وكارت في الرئيسية.</p></div><span class="sp"></span><button class="btn">' + ic('archive') + 'الأرشيف</button><button class="btn">' + ic('layers') + 'ترتيب كروت «خدماتنا»</button><button class="btn btn--primary">' + ic('plus') + 'صفحة جديدة</button></div>' +
        '<div class="ccards">' + PAGES.map(function (p) {
          return '<article class="cc" style="padding:0"><div style="position:relative"><img src="' + M + p[2] + '-480.webp" alt="" style="width:100%;aspect-ratio:16/8;object-fit:cover;display:block"><img src="' + IMG.bug + '" alt="" style="position:absolute;bottom:10px;inset-inline-start:10px;height:26px;border-radius:6px;background:rgb(0 0 0 / .5);padding:3px 6px"></div><div style="padding:14px 16px 16px"><b class="cc__t">' + p[0] + '</b><small class="muted">' + p[1] + '</small>' +
            '<div class="cc__facts"><span class="mono">' + ic('link', 'ico-sm') + p[3] + '</span><span>' + ic('video', 'ico-sm') + p[4] + '</span><span>' + ic('users', 'ico-sm') + 'بإشراف B.U.G</span></div>' +
            '<div class="item__tags" style="margin-top:10px"><span class="tag tag--ok">منشورة</span><span class="tag tag--acc">كارت في الرئيسية</span></div>' +
            '<div class="row" style="margin-top:12px"><button class="btn btn--sm btn--primary">' + ic('edit') + 'إدارة الصفحة</button><button class="btn btn--sm btn--ghost">' + ic('external') + 'افتحها</button><span class="sp"></span><button class="iconbtn" style="width:34px;height:34px">' + ic('dots') + '</button></div></div></article>';
        }).join('') + '</div><p class="muted" style="font-size:12px;margin:12px 0 0">عدد المقاطع في «المسرح صامت» من غير تأكيد؛ الباقي من الصفحات المنشورة.</p></section>';
    };
    V['svcpage-edit'] = function () {
      var clips = [['🎭 ميدلي العذراء', 'BUG – Brave Under Grace · Black Theater Team', 'img-8ffd40eb', '0:00 → 0:06'], ['جاء المخلص', 'من غير وصف', 'img-53ca69a3', '0:00 → 0:22']];
      return V.svcpages() + bigModal('theatre', 'إدارة الصفحة: المسرح الأسود', '<span class="mono">/black-theatre/</span> · منشورة · بإشراف B.U.G', mnav(['الأساسيات', 'الغلاف والبانر', 'المقاطع (٢)', 'فريق الخدمة', 'الظهور'], 2),
        sec('edit', 'الأساسيات', '', '<div class="fgrid">' + field('الرابط', '<div class="pre">' + inp('black-theatre', '', 'input--ltr') + '<span>/</span></div>', 'الرابط مبيتغيرش بعد النشر', 'c4') + field('العنوان', inp('المسرح الأسود'), '', 'c4', '١٢ / ٦٠') + field('السطر القصير', inp('حكايات بالنور والظل… ورسالة بتوصل من غير كلام'), '', 'c4', '٤٦ / ١٢٠') +
          field('الوصف', '<textarea class="input" rows="3">فريق المسرح الأسود بيقدم عروض قصيرة بتعتمد على الإضاءة والحركة والمؤثرات البصرية، وكل عرض بيحكي فكرة ورسالة بطريقة مختلفة ومميزة.</textarea>', '', 'c12', '٢٤٠ / ٢٠٠٠') + '</div>') +
        sec('video', 'المقاطع', 'اسحب علشان تغيّر الترتيب. كل مقطع: جزء قصير بيشتغل في الصفحة، وصورة كارت، ولينك للفيديو الكامل.', '<div class="list">' + clips.map(function (c, i) {
          return '<div class="item"><span class="grip muted">' + ic('grip') + '</span><div style="position:relative"><img class="item__thumb" src="' + M + c[2] + '-480.webp" alt="" style="width:86px;height:56px"><span class="tile__dur" style="top:4px;inset-inline-start:4px;padding:1px 6px;font-size:10px">' + ic('play', 'ico-sm') + '</span></div><div class="item__main"><b>' + c[0] + '</b><small>' + c[1] + '</small><div class="item__tags"><span class="tag">' + ic('video', 'ico-sm') + 'المقطع <bdi class="mono">' + c[3] + '</bdi>' + '</span><span class="tag">' + ic('music', 'ico-sm') + 'بصوته</span></div></div><button class="btn btn--sm">' + ic('edit') + 'تعديل</button><button class="iconbtn" style="width:34px;height:34px">' + ic('dots') + '</button></div>';
        }).join('') + '<button class="btn btn--ghost btn--block">' + ic('plus') + 'مقطع جديد</button></div>') +
        sec('users', 'فريق الخدمة', 'آخر الصفحة: مين بيخدم وإزاي حد ينضم', '<div class="fgrid">' + field('عنوان الفريق', inp('', 'مثلًا: انضم لفريق المسرح'), '', 'c6', '٠ / ٦٠') + field('رسالة الواتساب', inp('', 'السلام… عاوز أنضم للمسرح الأسود'), 'بتتكتب جاهزة لما حد يدوس «كلمنا»', 'c6', '٠ / ٢٠٠') + field('كلام الفريق', '<textarea class="input" rows="2" placeholder="اختياري"></textarea>', '', 'c12', '٠ / ٥٠٠') + '</div>'),
        '<h5>الصفحة على الموبايل</h5><div class="phone-mini" style="padding:0;overflow:hidden"><img src="' + M + 'img-09d4476b-480.webp" alt="" style="width:100%;aspect-ratio:16/10;object-fit:cover;display:block"><div style="padding:10px 12px"><b style="font-size:14px">المسرح الأسود</b><small class="muted" style="display:block;font-size:11px">حكايات بالنور والظل…</small><div class="row" style="gap:6px;margin-top:8px"><img src="' + M + 'img-8ffd40eb-480.webp" style="width:48%;border-radius:8px" alt=""><img src="' + M + 'img-53ca69a3-480.webp" style="width:48%;border-radius:8px" alt=""></div></div></div>' +
        '<div class="hr"></div><h5>الشريك</h5><div class="item" style="padding:10px"><img src="' + IMG.bug + '" alt="" style="height:24px"><div class="item__main"><b style="font-size:13px">Brave Under Grace – B.U.G.</b></div></div>' +
        '<div class="hr"></div><h5>إدارة</h5><div class="stack"><button class="btn btn--sm btn--block">' + ic('archive') + 'أرشيف</button></div>');
    };
    V['svc-clip'] = function () {
      return V.svcpages() + mdModal('video', 'تعديل المقطع: 🎭 ميدلي العذراء', 'المسرح الأسود · المقطع ١ من ٢',
        '<div class="msec"><h4>' + ic('video', 'ico-sm') + '١. المقطع اللي بيشتغل جوه الصفحة وصوته</h4><div class="clip"><img src="' + M + 'vid-1dab96f8-480.webp" onerror="this.src=\'' + M + 'img-8ffd40eb-480.webp\'" alt=""><span class="clip__play">' + ic('play') + '</span></div>' +
        '<div class="trim"><div class="trim__track">' + Array(24).join('<i></i>') + '<span class="trim__sel" style="right:0;width:27%"></span></div><div class="row" style="margin-top:6px"><small class="muted">من <b class="mono">0:00</b> لحد <b class="mono">0:06</b> · ٦ ثواني</small><span class="sp"></span><small class="muted">من ثانية لـ٣٠ ثانية</small></div></div>' +
        '<div class="fgrid" style="margin-top:12px">' + field('صوت المقطع', '<div class="seg"><span class="is-on">صوته الأصلي</span><span>من غير صوت</span><span>ملف صوت</span></div>', '', 'c12') + '</div></div>' +
        '<div class="msec"><h4>' + ic('photos', 'ico-sm') + '٢. صورة الكارت</h4><div class="item"><img class="item__thumb" src="' + M + 'img-8ffd40eb-480.webp" alt="" style="width:96px;height:60px"><div class="item__main"><b style="font-size:13.5px">img-8ffd40eb</b><small>1600×900</small></div><button class="btn btn--sm">' + ic('photos') + 'غيّر</button></div></div>' +
        '<div class="msec"><h4>' + ic('edit', 'ico-sm') + '٣. العنوان والوصف</h4><div class="fgrid">' + field('عنوان الفيديو', inp('🎭 ميدلي العذراء'), '', 'c6', '١٤ / ٦٠') + field('المدة (اختياري)', inp('', 'مثلًا ٤:٣٠'), '', 'c6') + field('وصف قصير', '<textarea class="input" rows="2">BUG – Brave Under Grace\nBlack Theater Team</textarea>', '', 'c12', '٤١ / ٢٠٠') + '</div></div>' +
        '<div class="msec" style="margin:0"><h4>' + ic('external', 'ico-sm') + '٤. الفيديو الكامل</h4><div class="fgrid">' + field('لينك الفيديو الكامل', inp('', 'https://youtube.com/…', 'input--ltr'), 'اختياري: زرار «شوف العرض كامل»', 'c12') + '</div></div>',
        saveFoot + '<span class="sp"></span><button class="btn btn--sm btn--danger">' + ic('trash') + 'شيل المقطع</button>');
    };

    /* ================= التقارير المالية ================= */
    function finFilters(on) {
      return '<div class="filters"><div class="fpill is-on">' + ic('ticket', 'ico-sm') + 'كل الفعاليات (مجمّع)</div><div class="fpill">' + ic('users', 'ico-sm') + 'كل الخدام</div><div class="fpill">' + ic('wallet', 'ico-sm') + 'كل الطرق</div><div class="fpill">' + ic('calendar', 'ico-sm') + 'لحد دلوقتي</div><span class="sp"></span>' + (on ? '<span class="search" style="width:240px">' + ic('filter') + 'دوّر بالاسم أو رقم الحجز…</span>' : '<button class="btn btn--sm">' + ic('download') + 'قايمة الأفراد</button><button class="btn btn--sm btn--primary">' + ic('download') + 'التقرير المالي الكامل (Excel)</button>') + '</div>';
    }
    V['fin-report'] = function () {
      var K = [['check', 'الإجمالي المتأكد', '٣٬٥٠٠ ج', 'دفعات سجّلها أدمن', 'ok'], ['wallet', 'في عهدة الخدام', '٣٬٥٠٠ ج', 'كاش + تحويلات على أرقامهم', ''], ['send', 'اتسلّم للخدمة', '٣٬٠٠٠ ج', '', 'ok'], ['clock', 'لسه مع الخدام', '٥٠٠ ج', 'في العهدة − اللي اتسلّم', 'warn'], ['ticket', 'مستني التأكيد', '٠ ج', '٠ طلب — متوقع، مش فلوس', ''], ['users', 'لسه على الناس', '٥٬٥٠٠ ج', 'باقي الحجوزات المؤكدة', 'warn'], ['alert', 'محتاج مراجعة', '٠ ج', 'تحويلات قديمة: مش معروف راحت على أنهي رقم', '']];
      return tabs(['الحجوزات', 'الفلوس', 'طرق الدفع'], 'الفلوس') +
        '<div class="row" style="margin-bottom:14px"><div class="seg"><span>الملخص</span><span class="is-on">التقرير التفصيلي</span><span>سجل الدفعات</span><span>التسليمات</span></div></div>' + finFilters(false) +
        '<div class="grid g4 kpis" style="margin-top:6px">' + K.map(function (k) { return '<div class="kpi"' + (k[4] === 'warn' ? ' style="border-color:rgb(242 195 91 / .3)"' : '') + '><small>' + ic(k[0], 'ico-sm') + k[1] + '</small><b' + (k[4] ? ' style="color:var(--' + k[4] + ')"' : '') + '>' + k[2] + '</b>' + (k[3] ? '<small style="font-weight:500">' + k[3] + '</small>' : '') + '</div>'; }).join('') + '</div>' +
        '<section class="card" style="margin-top:18px"><div class="card__head"><span class="chipico">' + ic('ticket') + '</span><h3>حسب الفعالية</h3></div><div class="tablewrap"><table class="table cards"><thead><tr><th>الفعالية</th><th>الحجوزات</th><th>المطلوب</th><th>اتحصّل</th><th>الباقي</th><th>مرتجع</th><th></th></tr></thead><tbody>' +
        [['تجربة حجز', '٢', '٤٬٥٠٠', '٣٬٥٠٠', '١٬٠٠٠', '٠'], ['اختبار نظام الحجز - مؤقت', '١', '٤٬٥٠٠', '٠', '٤٬٥٠٠', '٠'], ['test-2', '٠', '٠', '٠', '٠', '٠']].map(function (r) { return '<tr><td><b>' + r[0] + '</b></td><td data-l="الحجوزات:" class="num">' + r[1] + '</td><td data-l="المطلوب:" class="num">' + r[2] + ' ج</td><td data-l="اتحصّل:" class="num" style="color:var(--ok)">' + r[3] + ' ج</td><td data-l="الباقي:" class="num" style="color:var(--warn)">' + r[4] + ' ج</td><td data-l="مرتجع:" class="num">' + r[5] + '</td><td style="text-align:end"><button class="btn btn--sm">افتح</button></td></tr>'; }).join('') + '</tbody></table></div></section>' +
        '<section class="card" style="margin-top:18px"><div class="card__head"><span class="chipico">' + ic('users') + '</span><div><h3>الخدام</h3><p>فلوس كل خادم حسب طريقة الدفع. اختار فعالية علشان تسجّل تسليم أو تفتح الحجوزات ورا كل رقم.</p></div></div><div class="tablewrap"><table class="table cards"><thead><tr><th>الخادم</th><th>كاش</th><th>إنستاباي</th><th>محفظة</th><th>في العهدة</th><th>اتسلّم</th><th>لسه معاه</th></tr></thead><tbody>' +
        [['مينا زكريا عطاالله متى', '٠', '٣٬٠٠٠', '٠', '٣٬٠٠٠', '٣٬٠٠٠', '٠'], ['كريستين عماد', '٥٠٠', '٠', '٠', '٥٠٠', '٠', '٥٠٠']].map(function (r) { return '<tr><td><b>' + r[0] + '</b></td>' + r.slice(1).map(function (v, i) { return '<td data-l="' + ['كاش:', 'إنستاباي:', 'محفظة:', 'العهدة:', 'اتسلّم:', 'لسه معاه:'][i] + '" class="num"' + (i === 5 && v !== '٠' ? ' style="color:var(--warn)"' : '') + '>' + v + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></section>' +
        '<p class="muted" style="font-size:12px">«قايمة الأفراد» فيها الأسماء وأرقام الحجز بس (تتبعت في جروب). «التقرير المالي» فيه الموبايلات والفلوس: للمسؤولين بس (صلاحية «يصدّر بأرقام التليفونات»). المبالغ توضيحية.</p>';
    };
    V['fin-ledger'] = function () {
      var R = [['٣٬٠٠٠', 'إنستاباي', 'مينا زكريا', 'تجربة حجز · BK-1042', 'مع مينا زكريا عطاالله متى', 'الأربع ٤ نوفمبر ٢:٤٠ م', 'مينا زكريا', 'payment', ''], ['٥٠٠', 'كاش', 'كريستين عماد', 'تجربة حجز · BK-1043', 'مع كريستين عماد', 'الأربع ٤ نوفمبر ١:١٠ م', 'كريستين عماد', 'payment', ''], ['٢٠٠', 'كاش', 'كريستين عماد', 'تجربة حجز · BK-1043', 'مع كريستين عماد', 'الأربع ٤ نوفمبر ١:٠٥ م', 'كريستين عماد', 'payment', 'void'], ['٣٬٠٠٠', 'تسليم للخدمة', 'مينا زكريا عطاالله متى', 'كل التحويلات', '', 'الأربع ٤ نوفمبر ٣:٠٠ م', 'مينا زكريا', 'handover', '']];
      return tabs(['الحجوزات', 'الفلوس', 'طرق الدفع'], 'الفلوس') +
        '<div class="row" style="margin-bottom:14px"><div class="seg"><span>الملخص</span><span>التقرير التفصيلي</span><span class="is-on">سجل الدفعات</span><span>التسليمات</span></div></div>' + finFilters(true) +
        '<div class="chips-row"><span class="tag tag--acc">دفعات ٣</span><span class="tag">مرتجعات ٠</span><span class="tag">تسليمات ١</span><span class="tag tag--danger">ملغية ١</span></div>' +
        '<section class="card" style="margin-top:12px;padding:0;overflow:hidden"><div class="tablewrap" style="border:0;border-radius:0"><table class="table cards"><thead><tr><th>المبلغ</th><th>الطريقة</th><th>الاسم</th><th>الحجز</th><th>الفلوس فين</th><th>إمتى</th><th>سجّلها</th><th></th></tr></thead><tbody>' +
        R.map(function (r) { var v = r[8] === 'void'; return '<tr' + (v ? ' class="is-void"' : '') + '><td class="num" style="color:' + (v ? 'var(--text-3)' : r[7] === 'handover' ? 'var(--info)' : 'var(--ok)') + '">' + (v ? '<s>' + r[0] + ' ج</s>' : r[0] + ' ج') + '</td><td data-l=""><span class="tag ' + (r[7] === 'handover' ? 'tag--info' : '') + '">' + r[1] + '</span>' + (v ? ' <span class="tag tag--danger">ملغية</span>' : '') + '</td><td><b>' + r[2] + '</b></td><td data-l="" class="muted">' + r[3] + '</td><td data-l="" class="muted">' + r[4] + '</td><td data-l="" class="muted">' + r[5] + '</td><td data-l="سجّلها:">' + r[6] + '</td><td style="text-align:end"><button class="btn btn--sm btn--ghost">' + ic('dots') + '</button></td></tr>'; }).join('') +
        '</tbody></table></div></section><p class="muted" style="font-size:12px">الصف الملغي بيفضل متشطب عليه ومبيتحسبش. لو المبلغ غلط: الغيه وسجّل الصح. الأرقام وأرقام الحجز توضيحية.</p>';
    };
    V['fin-handover'] = function () {
      return V['fin-report']() + mdModal('send', 'تسجيل تسليم فلوس للخدمة', 'تجربة حجز · كريستين عماد',
        '<div class="grid g3 kpis"><div class="kpi"><small>في عهدتها</small><b>٥٠٠ ج</b></div><div class="kpi"><small>اتسلّم قبل كده</small><b>٠ ج</b></div><div class="kpi" style="border-color:rgb(242 195 91 / .3)"><small>لسه معاها</small><b style="color:var(--warn)">٥٠٠ ج</b></div></div>' +
        '<div class="fgrid" style="margin-top:16px">' + field('المبلغ اللي اتسلّم', '<div class="pre">' + inp('٥٠٠', '', 'is-focus') + '<span>جنيه</span></div>', 'من صفر لحد ٥٠٠', 'c6') + field('طريقة الدفع', '<div class="seg"><span class="is-on">كاش</span><span>إنستاباي</span><span>محفظة</span></div>', '', 'c6') + field('استلمها', inp('مينا زكريا'), '', 'c6') + field('ملاحظة', inp('', 'اختياري'), '', 'c6') + '</div>' +
        '<p class="muted" style="font-size:12px;margin:12px 0 0">بيتسجل في «التسليمات» وفي سجل النشاط. لو اتسجل غلط: «إلغاء تسليم» من السجل.</p>',
        '<button class="btn btn--primary">' + ic('check') + 'سجّل التسليم</button><button class="btn btn--ghost">إلغاء</button>');
    };

    /* ================= الإعدادات الفرعية ================= */
    V['set-site'] = function () {
      return P.settingsShell('site', '<section class="card"><div class="card__head"><span class="chipico">' + ic('globe') + '</span><div><h3>بيانات الموقع</h3><p>بتظهر في عنوان الموقع، وفي المشاركة على واتساب وفيسبوك</p></div></div>' +
        '<div class="grid" style="grid-template-columns:1fr 300px;gap:22px" data-cols><div class="fgrid">' + field('اسم الخدمة الرسمي <span class="req">*</span>', inp('أسرة البابا أثناسيوس الرسولي - سفاجا'), '', 'c12', '٣٥ / ٦٠') + field('الجملة التعريفية', inp('', 'مثلًا: اجتماع الشباب كل أحد'), '', 'c12', '٠ / ١٢٠') + field('نص المشاركة', '<textarea class="input" rows="3" placeholder="الكلام اللي بيتبعت مع اللينك"></textarea>', '', 'c12', '٠ / ٢٠٠') + '</div>' +
        '<div><h5 style="margin:0 0 10px;font-size:12px;color:var(--text-3)">لما حد يشارك اللينك</h5><div class="share"><img src="' + P.LOGO + '" alt=""><div><small class="mono">stathanasiosyouth.github.io</small><b>أسرة البابا أثناسيوس الرسولي - سفاجا</b><p>اجتماع الشباب كل أحد…</p></div></div></div></div>' +
        '<div class="row" style="margin-top:16px"><button class="btn btn--primary">' + ic('check') + 'احفظ</button><span class="saved">بيتحفظ مسودة لحد «راجع وانشر»</span></div></section>') ;
    };
    V['set-content'] = function () {
      return P.settingsShell('content', '<section class="card"><div class="card__head"><span class="chipico">' + ic('megaphone') + '</span><div><h3>المحتوى والظهور</h3><p>إمتى الحاجات بتختفي لوحدها من الموقع</p></div></div>' +
        '<div class="setrow"><div class="setrow__t"><b>الإشعارات بتفضل في الجرس كام يوم</b><small>لو الإشعار مالوش ميعاد اختفاء</small></div><div class="pre" style="width:150px"><input class="input" value="١٤"><span>يوم</span></div></div>' +
        '<div class="setrow"><div class="setrow__t"><b>اللعبة بتفضل ظاهرة كام ساعة بعد ما تخلص</b><small>كروت «ركن الألعاب» في الاجتماع (مش قسم الألعاب الجاي في Phase 10)</small></div><div class="pre" style="width:150px"><input class="input" value="٢٤"><span>ساعة</span></div></div>' +
        '<div class="row" style="margin-top:16px"><button class="btn btn--primary">' + ic('check') + 'احفظ</button></div></section>');
    };
    var NG = [['النشر', [['نشر الموقع', 1, 0, 1, 0], ['إشعار للزوار', 1, 0, 0, 0]]], ['الحجوزات', [['حجوزات جديدة من الموقع', 1, 0, 1, 0], ['حجز كاش من أدمن', 0, 0, 1, 0], ['تأكيد / رفض / إلغاء حجز', 0, 0, 1, 0]]], ['الفلوس', [['دفعة اتسجلت', 0, 0, 1, 0], ['تسليم فلوس للخدمة', 1, 1, 0, 0], ['إلغاء دفعة', 1, 1, 0, 0]]], ['الحسابات والصلاحيات', [['أدمن جديد اتضاف', 1, 1, 0, 1], ['صلاحيات أدمن اتغيرت', 1, 1, 0, 1], ['دخول من جهاز تاني', 1, 1, 0, 1]]], ['النظام', [['مهمة في الخلفية فشلت', 1, 1, 0, 1], ['إرسال الإيميلات واقف', 1, 1, 0, 1]]]];
    V['set-notify'] = function () {
      return P.settingsShell('notify', '<section class="card"><div class="card__head"><span class="chipico">' + ic('bell') + '</span><div><h3>إعدادات الإشعارات</h3><p>إيه اللي يتبعت لمين، إشعار ولا إيميل ولا في ملخص اليوم. بيوصل كل أدمن حسب صلاحياته. للأدمن الأساسي.</p></div></div>' +
        '<div class="enforce" style="margin-bottom:16px"><span class="chipico chipico--ok">' + ic('mail') + '</span><div style="flex:1"><b>الإيميلات شغالة</b><small class="muted" style="display:block">من athanasius.youth.safaga@gmail.com · ملخص اليوم الساعة ٩:٠٠ م بتوقيت القاهرة</small></div><button class="btn btn--sm">' + ic('edit') + 'الميعاد والحصص</button></div>' +
        '<div class="tablewrap"><table class="table nt"><thead><tr><th>الحدث</th><th>إشعار</th><th>إيميل</th><th>ملخص اليوم</th><th></th></tr></thead><tbody>' +
        NG.map(function (g) { return '<tr class="nt__g"><td colspan="5">' + g[0] + '</td></tr>' + g[1].map(function (r) { return '<tr><td><b>' + r[0] + '</b></td>' + [1, 2, 3].map(function (i) { return '<td data-l="' + ['', 'إشعار', 'إيميل', 'ملخص'][i] + '">' + sw(!!r[i]) + '</td>'; }).join('') + '<td>' + (r[4] ? '<span class="tag tag--warn">' + ic('lock', 'ico-sm') + 'إجباري</span>' : '') + '</td></tr>'; }).join(''); }).join('') +
        '</tbody></table></div>' +
        '<div class="grid g3 kpis" style="margin-top:16px"><div class="kpi"><small>الهدف اليومي (كل الإيميلات)</small><b>٤٥٠</b><small style="font-weight:500">في حدود جيميل (~٥٠٠)</small></div><div class="kpi"><small>محجوز لأكواد التأكيد</small><b>١٠٠</b></div><div class="kpi"><small>محجوز لإيميلات الأعضاء</small><b>١٥٠</b></div></div>' +
        '<div class="row" style="margin-top:16px"><button class="btn btn--primary">' + ic('check') + 'احفظ الإعدادات</button><span class="saved">الإجباري (الأمان والنظام) مبيتقفلش</span></div><p class="muted" style="font-size:12px">الاختيارات هنا توضيحية؛ القايمة الكاملة (٤٠+ حدث في ١٦ قسم) هي نفس اللي في الـWorker.</p></section>');
    };
    V['set-system'] = function () {
      var S = [['ok', 'globe', 'الموقع', 'آخر نشر الأربع ٤ نوفمبر ٢:١٣ م · النسخة على الموقع زي المسودة'], ['ok', 'layers', 'السيرفر', 'شغال · آخر تحديث الأربع ٤ نوفمبر'], ['ok', 'photos', 'رفع الصور والفيديو', 'شغال · ٣٢ ملف'], ['ok', 'mail', 'الإيميلات', 'اتبعت النهارده ١٢ من ٤٥٠'], ['ok', 'bell', 'إشعارات الموبايل', 'متظبطة · ٣ مشتركين'], ['warn', 'shield', 'الصلاحيات', 'لسه مقفولة: كل الأدمنز شايفين كل حاجة'], ['ok', 'retry', 'نسخة الريبو (في الخلفية)', 'آخر مزامنة بعد النشر بدقيقة']];
      return P.settingsShell('system', '<section class="card"><div class="card__head"><span class="chipico">' + ic('gear') + '</span><div><h3>حالة النظام</h3><p>كل جزء شغال ولا لأ، من غير تفاصيل تقنية</p></div><span class="sp"></span><button class="btn">' + ic('retry') + 'افحص تاني</button></div><div class="list">' +
        S.map(function (s) { return '<div class="item"><span class="chipico chipico--' + s[0] + '">' + ic(s[1]) + '</span><div class="item__main"><b>' + s[2] + '</b><small>' + s[3] + '</small></div><span class="tag tag--' + s[0] + '">' + (s[0] === 'ok' ? 'تمام' : 'محتاج قرار') + '</span>' + (s[2] === 'رفع الصور والفيديو' ? '<button class="btn btn--sm btn--ghost">اختبر الرفع</button>' : s[2] === 'الصلاحيات' ? '<button class="btn btn--sm">افتح</button>' : '') + '</div>'; }).join('') +
        '</div><p class="muted" style="font-size:12px;margin:12px 0 0">اتشال من هنا: GitHub، Script Properties، Google Drive، «افتح الشيت». الأرقام توضيحية.</p></section>');
    };
    V['set-guide'] = function () {
      var T = [['church', 'إزاي أضيف موضوع اجتماع', 'المحتوى ← الاجتماعات'], ['megaphone', 'إزاي أكتب خبر ويظهر في الرئيسية', 'المحتوى ← الأخبار'], ['theatre', 'فعالية جديدة بحجز', 'الفعاليات والصفحات'], ['ticket', 'مراجعة طلب حجز وتسجيل دفعة', 'الحجوزات والفلوس'], ['trophy', 'مسابقة من الأول للنتيجة', 'المسابقات'], ['send', 'النشر والرجوع لنسخة قديمة', 'راجع وانشر'], ['shield', 'إضافة خادم للإدارة وصلاحياته', 'الإعدادات ← الفريق'], ['photos', 'رفع صورة أو مقطع فيديو', 'الصور والملفات']];
      return P.settingsShell('guide', '<section class="card"><div class="card__head"><span class="chipico">' + ic('book') + '</span><div><h3>دليل الأدمن</h3><p>كل خانة معناها إيه، وإزاي تعمل كل حاجة خطوة بخطوة. زرار «؟» في أي شاشة بيفتح الجزء بتاعها على طول.</p></div></div>' +
        '<span class="search" style="width:100%;display:flex;margin-bottom:16px">' + ic('filter') + 'دوّر في الدليل…</span><div class="grid g2">' +
        T.map(function (t) { return '<div class="item"><span class="chipico">' + ic(t[0]) + '</span><div class="item__main"><b>' + t[1] + '</b><small>' + t[2] + '</small></div><span class="muted" style="transform:rotate(90deg)">' + ic('chevron') + '</span></div>'; }).join('') + '</div></section>');
    };
  };
})();
