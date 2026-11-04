/* Phase 8B round 4 (owner's final notes, 2026-11-05) — only the affected designs:
   1–2 the meeting editor (poster, the program with its stages), 3 visibility schedules wherever the admin has them,
   4 «ركن الألعاب» (content) kept apart from the Phase 10 «الألعاب» (own rail entry, «قريبًا»),
   5 clip trimming to the second, 6 the help «؟» → a video-guide icon (proposal.js / -3.js, class .vhelp).
   Real fields: apps-script/AdminContent.html (sessions + programEditor, games), AdminTrim.html. */
(function () {
  var prev = window.MORE;
  window.MORE = function (P) {
    if (prev) prev(P);
    var V = P.V, ic = P.ic, tabs = P.tabs, sw = P.sw, field = P.field, inp = P.inp;
    var M = '../../media/2026/';
    ['session-edit', 'session-program', 'games-corner', 'game-edit', 'sched-picker', 'layout-sched'].forEach(function (k) { P.AREA_OF[k] = k === 'layout-sched' ? 'page' : 'content'; });
    ['trim'].forEach(function (k) { P.AREA_OF[k] = 'media'; });
    ['help-pop'].forEach(function (k) { P.AREA_OF[k] = 'bookings'; });
    P.AREA_OF['games-soon'] = 'games';
    P.TITLE.games = ['الشغل', 'الألعاب'];
    P.TITLE.page = ['الموقع', 'الصفحة'];

    // 4: the Phase 10 games get their own rail entry, locked «قريبًا» (not the meeting's games corner)
    if (P.NAV[0] && !P.NAV[0][1].some(function (n) { return n[0] === 'games'; })) P.NAV[0][1].splice(2, 0, ['games', 'star', 'الألعاب <span class="tag tag--soon">قريبًا</span>']);

    var CT = ['الاجتماعات', 'الأخبار', 'ركن الألعاب', 'كروت المسابقات', 'الفعاليات', 'كروت خدماتنا', 'الإشعارات', 'إشعارات الموبايل'];
    function ctabs(on) { return '<div class="tabs">' + CT.map(function (t) { return '<button class="tab' + (t === on ? ' is-on' : '') + '">' + t + '</button>'; }).join('') + '</div>'; }
    function vhelp() { return '<button class="vhelp" title="فيديو شرح · قريبًا" aria-label="فيديو شرح">' + ic('video') + '</button>'; }
    function sec(icon, title, hint, body, id) { return '<div class="msec"' + (id ? ' id="' + id + '" data-focus' : '') + '><h4>' + ic(icon, 'ico-sm') + title + '</h4>' + (hint ? '<p>' + hint + '</p>' : '') + body + '</div>'; }
    function mnav(list, on) { return '<nav class="mnav">' + list.map(function (n, i) { return '<a class="' + (i === on ? 'is-on' : '') + '"><span class="n">' + '١٢٣٤٥٦٧٨'[i] + '</span>' + n + '</a>'; }).join('') + '</nav>'; }
    function big(icon, title, sub, nav, content, aside, foot) {
      return '<div class="scrim"><div class="modal"><div class="modal__head"><span class="chipico">' + ic(icon) + '</span><div><h2>' + title + '</h2><p>' + sub + '</p></div><span class="sp"></span><button class="btn btn--sm btn--ghost">' + ic('eye') + 'معاينة</button>' + vhelp() + '<button class="iconbtn">' + ic('close') + '</button></div>' +
        '<div class="modal__body">' + nav + '<div class="mcontent">' + content + '</div><aside class="maside">' + aside + '</aside></div><div class="modal__foot">' + foot + '</div></div></div>';
    }
    function md(icon, title, sub, body, foot, cls) {
      return '<div class="scrim"><div class="modal modal--md ' + (cls || '') + '"><div class="modal__head"><span class="chipico">' + ic(icon) + '</span><div><h2>' + title + '</h2><p>' + sub + '</p></div><span class="sp"></span>' + vhelp() + '<button class="iconbtn">' + ic('close') + '</button></div><div class="modal__body">' + body + '</div><div class="modal__foot">' + foot + '</div></div></div>';
    }
    var saveFoot = '<button class="btn btn--primary" style="min-width:150px">' + ic('check') + 'احفظ</button><button class="btn btn--ghost">إلغاء</button><span class="sp"></span><span class="saved">' + ic('clock', 'ico-sm') + 'بيتحفظ مسودة لحد «راجع وانشر»</span>';

    /* 3: one schedule control for every place that has «يظهر / يختفي» — date + time, quick picks, clear, and the rule in words */
    function sched(label, value, chips, hint, on) {
      return '<div class="sched' + (value ? ' has' : '') + '"><div class="sched__top"><span class="chipico" style="width:32px;height:32px">' + ic('clock', 'ico-sm') + '</span><div style="flex:1;min-width:0"><b>' + label + '</b><small>' + (value || hint) + '</small></div>' + (value ? '<button class="btn btn--sm btn--ghost">' + ic('close') + 'امسح</button>' : '') + '<button class="btn btn--sm">' + ic('calendar') + (value ? 'غيّر' : 'حدّد') + '</button></div>' +
        (chips ? '<div class="sched__chips">' + chips.map(function (c, i) { return '<span class="qchip' + (i === on ? ' is-on' : '') + '">' + c + '</span>'; }).join('') + '</div>' : '') + '</div>';
    }

    /* ================= 1–2–3: محرر الاجتماع ================= */
    var STAGES = [['تسبحة', '٨:٠٠ م', '', '٨:٠٠ ← ٨:٢٠ م', 'img-3efb3209', 'done'], ['ترانيم', '', '١٥', '٨:٢٠ ← ٨:٣٥ م', '', 'live'], ['الكلمة: حياة التسليم', '٨:٣٥ م', '', '٨:٣٥ ← ٩:٢٠ م', 'img-4f71317c', ''], ['ركن الألعاب', '', '٢٥', '٩:٢٠ ← ٩:٤٥ م', '', ''], ['الختام', '', '١٥', '٩:٤٥ ← ١٠:٠٠ م · مع نهاية الاجتماع', '', '']];
    function stageRow(s, i, open) {
      return '<li class="stage' + (s[5] === 'live' ? ' is-live' : '') + (open ? ' is-open' : '') + '"><span class="grip muted">' + ic('grip') + '</span><span class="stage__n">' + '١٢٣٤٥'[i] + '</span>' +
        '<div class="stage__img">' + (s[4] ? '<img src="' + M + s[4] + '-480.webp" alt="">' : ic('photos', 'ico-sm')) + '</div>' +
        '<div class="stage__main"><input class="input stage__title" value="' + s[0] + '"><div class="row" style="margin-top:6px;gap:6px"><span class="tag stage__span">' + ic('clock', 'ico-sm') + s[3] + '</span>' + (s[5] === 'live' ? '<span class="tag tag--ok">دلوقتي على الموقع</span>' : '') + '</div>' +
        (open ? '<div class="stage__when"><label><span>تظهر الساعة</span><input class="input" value="' + (s[1] || '') + '" placeholder="--:--"></label><span class="muted">أو</span><label><span>المدة</span><div class="pre" style="width:140px"><input class="input" value="' + (s[2] || '') + '" placeholder="دقايق"><span>دقيقة</span></div></label>' +
          '<div class="stage__pic">' + (s[4] ? '<img src="' + M + s[4] + '-480.webp" alt=""><button class="btn btn--sm btn--ghost">' + ic('trash') + 'من غير صورة</button>' : '') + '<button class="btn btn--sm">' + ic('upload') + 'ارفع</button><button class="btn btn--sm">' + ic('photos') + 'من المكتبة</button></div></div>' : '') +
        '</div><div class="stage__tools"><button class="iconbtn" style="width:32px;height:32px;transform:rotate(180deg)">' + ic('chevron', 'ico-sm') + '</button><button class="iconbtn" style="width:32px;height:32px">' + ic('chevron', 'ico-sm') + '</button><button class="iconbtn" style="width:32px;height:32px">' + ic('dots', 'ico-sm') + '</button></div></li>';
    }
    function programBlock(openIdx) {
      return '<div class="row" style="margin-bottom:12px"><div class="seg"><span class="is-on">' + ic('layers', 'ico-sm') + '٥ فقرات</span><span>٨:٠٠ ← ١٠:٠٠ م</span></div><span class="sp"></span><button class="btn btn--sm">' + ic('copy') + 'انسخ برنامج اجتماع تاني</button></div>' +
        '<ol class="stages">' + STAGES.map(function (s, i) { return stageRow(s, i, i === openIdx); }).join('') + '</ol>' +
        '<button class="btn btn--ghost btn--block" style="margin-top:10px">' + ic('plus') + 'فقرة</button>' +
        '<p class="muted" style="font-size:12px;margin:10px 0 0">كل فقرة: وقت ظهورها أو مدتها. الفقرة بتختفي لما اللي بعدها تظهر، وآخر فقرة بتخلص مع نهاية الاجتماع. الفقرة اللي شغالة بتنور على الموقع في ميعادها. الصورة اختيارية لكل فقرة.</p>';
    }
    function sessionEditor(onNav, openStage) {
      return big('church', 'اجتماع الأحد ٨ نوفمبر', 'اجتماع الشباب · ٨:٠٠ م · بيتحفظ مسودة لحد النشر', mnav(['الاجتماع', 'الموضوع', 'البوستر', 'برنامج الاجتماع', 'الظهور والإشعار'], onNav),
        (onNav === 3 ? '' : sec('calendar', 'الاجتماع', '', '<div class="fgrid">' + field('التاريخ', inp('الأحد ٨ نوفمبر ٢٠٢٦'), '', 'c4') + field('الساعة', inp('', 'فاضية = المعتاد (٨:٠٠ م)'), '', 'c4') + field('المدة بالدقايق', inp('', 'فاضية = المعتاد (١٢٠)'), '', 'c4') + field('الحالة', '<div class="seg"><span class="is-on">عادي</span><span>ملغي الأسبوع ده</span></div>', '', 'c12') + '</div>') +
          sec('edit', 'الموضوع', '', '<div class="fgrid">' + field('الموضوع', inp('حياة التسليم', '', 'is-focus'), '', 'c6', '١١ / ٨٠') + field('الخادم / المتكلم', inp('أبونا أنطوني عياد'), '', 'c6', '١٧ / ٦٠') + field('وصف', '<textarea class="input" rows="2" placeholder="اختياري"></textarea>', '', 'c12', '٠ / ٥٠٠') + '</div>') +
          sec('photos', 'بوستر الاجتماع', 'بيظهر في «ركن الاجتماع» على الموقع، وفي الإشعار', '<div class="poster"><div class="poster__img"><img src="' + M + 'img-5d2af330-480.webp" alt=""><span class="tag tag--ok poster__tag">' + ic('check', 'ico-sm') + 'البوستر</span></div><div class="poster__side"><b>img-5d2af330 · 1200×1200</b><small class="muted">من المكتبة · مستخدم هنا بس</small><div class="stack" style="margin-top:12px"><button class="btn btn--sm btn--block">' + ic('upload') + 'ارفع بوستر</button><button class="btn btn--sm btn--block">' + ic('photos') + 'اختار من المكتبة</button><button class="btn btn--sm btn--block btn--ghost">' + ic('trash') + 'من غير بوستر</button></div><small class="muted" style="display:block;margin-top:10px">من الموبايل أو الكمبيوتر — بيتصغر ويتضغط لوحده قبل الرفع</small></div></div>', onNav === 2 ? 'poster' : '')) +
        sec('layers', 'برنامج الاجتماع', 'رتّب الفقرات بالسحب أو بالأسهم. افتح أي فقرة تغيّر ميعادها أو صورتها.', programBlock(openStage), onNav === 3 ? 'prog' : '') +
        (onNav === 3 ? '' : sec('clock', 'الظهور والإشعار', '', sched('الموضوع يظهر في الموقع من', 'الخميس ٥ نوفمبر · ٨:٠٠ م', ['دلوقتي', 'الخميس الجاي ٨م', 'الجمعة الجاية', 'مسح'], '', 1) +
          '<div class="toggle-row" style="margin-top:10px">' + sw(true) + '<div><b>اعمل إشعار بالموضوع في الجرس</b><small>بيظهر للناس لما الموضوع يظهر</small></div></div>' +
          '<div class="fgrid" style="margin-top:12px">' + field('ملاحظة', inp('', 'مثلًا سبب الإلغاء، أو «الاجتماع في القاعة الكبيرة»'), '', 'c8', '٠ / ٢٠٠') + '<div class="c4" style="align-self:end"><div class="toggle-row">' + sw(true) + '<div><b>ظاهر</b></div></div></div></div>')),
        '<h5>في «ركن الاجتماع» على الموقع</h5><div class="prevcard"><img src="' + M + 'img-5d2af330-480.webp" alt="" style="aspect-ratio:1"><div><small class="muted">الأحد ٨ نوفمبر · ٨:٠٠ م</small><b>حياة التسليم</b><small class="muted">أبونا أنطوني عياد</small></div></div>' +
        '<div class="hr"></div><h5>البرنامج كده</h5><ul class="tl-mini">' + STAGES.map(function (s) { return '<li class="' + (s[5] === 'live' ? 'is-live' : s[5] === 'done' ? 'is-done' : '') + '"><b>' + s[0] + '</b><small>' + s[3].split(' · ')[0] + '</small></li>'; }).join('') + '</ul>',
        saveFoot + '<button class="btn btn--sm btn--danger">' + ic('trash') + 'امسح الاجتماع</button>');
    }
    V['session-edit'] = function () { return V.meetings() + sessionEditor(2, -1); };
    V['session-program'] = function () { return V.meetings() + sessionEditor(3, 2); };

    /* ================= 4: ركن الألعاب (المحتوى) ≠ الألعاب (Phase 10) ================= */
    V['games-corner'] = function () {
      return ctabs('ركن الألعاب') + '<section class="card"><div class="card__head"><span class="chipico">' + ic('star') + '</span><div><h3>ركن الألعاب — تحديات وألعاب</h3><p>كروت ألعاب وتحديات الاجتماع في الصفحة الرئيسية: تظهر «قريبًا»، وتبدأ في ميعادها، وتخلص. ده غير قسم «الألعاب» الجاي في Phase 10.</p></div><span class="sp"></span><button class="btn btn--primary">' + ic('plus') + 'لعبة</button></div>' +
        '<div class="row" style="margin-bottom:14px"><div class="seg"><span class="is-on">جاية وشغالة (٠)</span><span>خلصت (٠)</span></div></div>' +
        '<div class="drop" style="padding:40px"><span class="chipico" style="width:56px;height:56px">' + ic('star') + '</span><b style="font-size:16px;color:var(--text)">مفيش ألعاب دلوقتي</b><small>قسم «تحديات وألعاب» في الرئيسية بيستخبى لوحده لحد ما تضيف لعبة.</small><button class="btn btn--primary" style="margin-top:8px">' + ic('plus') + 'لعبة جديدة</button></div>' +
        '<h4 class="aday">هيبان كده لما يبقى فيه لعبة</h4><div class="list"><div class="item"><img class="item__thumb" src="' + M + 'img-592fd134-480.webp" alt=""><div class="item__main"><b>رحلة الاستكشاف في الكنيسة <span class="tag tag--info">قريبًا</span></b><small>تبدأ الأحد ٨ نوفمبر ١٠:٠٠ م · تخلص ١١:٣٠ م · بعد ما تخلص: تفضل «انتهت» شوية</small><div class="item__tags"><span class="tag">' + ic('bell', 'ico-sm') + 'تنبيه قبل بـ١٥ دقيقة</span><span class="tag">' + ic('bell', 'ico-sm') + 'تنبيه عند البداية</span></div></div><button class="btn btn--sm">' + ic('edit') + 'تعديل</button><button class="iconbtn" style="width:34px;height:34px">' + ic('dots') + '</button></div></div></section>';
    };
    V['game-edit'] = function () {
      return V['games-corner']() + big('star', 'لعبة جديدة', 'ركن الألعاب · تحديات وألعاب', mnav(['اللعبة', 'المواعيد', 'التنبيهات', 'الشكل'], 1),
        sec('edit', 'اللعبة', '', '<div class="fgrid">' + field('اسم اللعبة', inp('رحلة الاستكشاف في الكنيسة'), '', 'c6', '٢٦ / ٦٠') + field('وصف قصير', inp('', 'اختياري'), '', 'c6', '٠ / ١٢٠') + field('لينك اللعبة', inp('https://example.org/explore', '', 'input--ltr'), 'الزرار بيتفعل في ميعاد البداية', 'c8') + field('نص الزرار', inp('', 'افتراضي: ابدأ اللعب'), '', 'c4') + '<div class="c12"><div class="poster" style="grid-template-columns:200px 1fr"><div class="poster__img"><img src="' + M + 'img-592fd134-480.webp" alt=""></div><div class="poster__side"><b>بوستر اللعبة</b><div class="row" style="margin-top:10px"><button class="btn btn--sm">' + ic('upload') + 'ارفع</button><button class="btn btn--sm">' + ic('photos') + 'من المكتبة</button><button class="btn btn--sm btn--ghost">من غير</button></div></div></div></div></div>') +
        sec('clock', 'المواعيد', 'الكارت بيظهر «قريبًا»، وبعدين يبدأ، وبعدين يخلص', sched('تظهر «قريبًا» من', '', ['أول ما تنشر', 'النهارده ٨م', 'بكرة'], 'تظهر «قريبًا» أول ما تنشر', 0) +
          sched('تبدأ', 'الأحد ٨ نوفمبر · ١٠:٠٠ م', ['بعد الاجتماع', 'الأحد الجاي ١٠م'], '', -1) + sched('تخلص', 'الأحد ٨ نوفمبر · ١١:٣٠ م', ['بعد البداية بساعة', 'بعد البداية بساعة ونص'], '', 1) +
          field('بعد ما تخلص', '<div class="seg"><span class="is-on">تفضل ظاهرة «انتهت» شوية</span><span>تختفي على طول</span></div>', 'المدة من «الإعدادات ← المحتوى والظهور» (٢٤ ساعة)', 'c12')) +
        sec('bell', 'التنبيهات', '', '<div class="toggle-row">' + sw(true) + '<div><b>تنبيه قبل البداية بـ ١٥ دقيقة</b><small>«استعدوا 👀 تحدي جديد هيبدأ بعد ١٥ دقيقة»</small></div></div><div class="toggle-row" style="margin-top:10px">' + sw(true) + '<div><b>تنبيه عند البداية</b><small>«🔥 اللعبة جاهزة! ادخل دلوقتي»</small></div></div>'),
        '<h5>الكارت على الموقع</h5><div class="tlstate"><span class="is-on">قريبًا</span><span>شغالة</span><span>انتهت</span></div><div class="prevcard" style="margin-top:10px"><img src="' + M + 'img-592fd134-480.webp" alt=""><div><b>رحلة الاستكشاف في الكنيسة</b><small class="muted">تبدأ الأحد ١٠:٠٠ م</small><div class="row" style="margin-top:8px"><span class="tag">قريبًا</span></div></div></div>',
        saveFoot);
    };
    V['games-soon'] = function () {
      return '<section class="card card--glow" style="text-align:center;padding:70px 24px;max-width:720px;margin:30px auto"><span class="chipico" style="width:72px;height:72px;margin:0 auto 16px">' + ic('star') + '</span><h3 style="margin:0 0 6px;font-size:22px">الألعاب · قريبًا</h3><p class="muted" style="margin:0 0 6px">قسم مستقل لنظام الألعاب الجديد (Phase 10). مقفول لحد ما نبدأ.</p><p class="muted" style="margin:0;font-size:12.5px">ألعاب وتحديات الاجتماع موجودة دلوقتي في «المحتوى ← ركن الألعاب».</p><button class="btn" style="margin-top:16px">' + ic('star') + 'روح لركن الألعاب</button></section>';
    };

    /* 3: the shared picker, and the page's section schedules (content.json layout visibleFrom / visibleUntil) */
    V['sched-picker'] = function () {
      var days = [];
      for (var d = 1; d <= 30; d++) days.push('<span class="' + (d === 8 ? 'is-on' : d === 5 ? 'is-today' : '') + '">' + String(d).replace(/\d/g, function (x) { return '٠١٢٣٤٥٦٧٨٩'[x]; }) + '</span>');
      return V['games-corner']() + '<div class="scrim"><div class="modal modal--sm"><div class="modal__head"><span class="chipico">' + ic('clock') + '</span><div><h2>تبدأ</h2><p>اللعبة «رحلة الاستكشاف في الكنيسة»</p></div><span class="sp"></span><button class="iconbtn">' + ic('close') + '</button></div><div class="modal__body">' +
        '<div class="sched__chips" style="margin:0 0 14px">' + ['دلوقتي', 'النهارده ٨م', 'بعد الاجتماع', 'الأحد الجاي ١٠م'].map(function (c, i) { return '<span class="qchip' + (i === 2 ? ' is-on' : '') + '">' + c + '</span>'; }).join('') + '</div>' +
        '<div class="cal"><div class="row"><b>نوفمبر ٢٠٢٦</b><span class="sp"></span><button class="iconbtn" style="width:30px;height:30px;transform:rotate(-90deg)">' + ic('chevron', 'ico-sm') + '</button><button class="iconbtn" style="width:30px;height:30px;transform:rotate(90deg)">' + ic('chevron', 'ico-sm') + '</button></div><div class="cal__h">' + ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'].map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div><div class="cal__d">' + days.join('') + '</div></div>' +
        '<div class="fgrid" style="margin-top:14px">' + field('الساعة', '<div class="seg"><span>٨:٠٠ م</span><span>٩:٠٠ م</span><span class="is-on">١٠:٠٠ م</span><span>…</span></div>', '', 'c12') + '</div>' +
        '<div class="note-warn" style="margin-top:12px;background:var(--info-soft);color:var(--info)">' + ic('info', 'ico-sm') + 'الأحد ٨ نوفمبر · ١٠:٠٠ م بتوقيت مصر — بعد ٣ أيام</div></div>' +
        '<div class="modal__foot"><button class="btn btn--primary">' + ic('check') + 'تمام</button><button class="btn btn--ghost">امسح الميعاد</button></div></div></div>';
    };
    V['layout-sched'] = function () {
      var L = [['featured', 'الروابط المميزة'], ['meeting', 'ركن الاجتماع'], ['news', 'جديد الأسرة'], ['games', 'تحديات وألعاب'], ['competitions', 'المسابقات'], ['activities', 'الفعاليات'], ['services', 'خدماتنا'], ['location', 'مكان الاجتماع'], ['social', 'تابعنا'], ['contacts', 'تواصل مع الخدمة'], ['support', 'الدعم الفني'], ['share', 'شارك الصفحة']];
      return tabs(['ترتيب الصفحة', 'الروابط', 'المكان', 'التواصل'], 'ترتيب الصفحة') + '<section class="card"><div class="card__head"><span class="chipico">' + ic('layers') + '</span><div><h3>ترتيب الصفحة</h3><p>أقسام الصفحة الرئيسية بالترتيب. كل قسم ممكن يتخبّى، أو يظهر ويختفي في ميعاد.</p></div></div><div class="list">' +
        L.map(function (l, i) { var s = i === 3; return '<div class="item"><span class="grip muted">' + ic('grip') + '</span><span class="stage__n">' + String(i + 1).replace(/\d/g, function (x) { return '٠١٢٣٤٥٦٧٨٩'[x]; }) + '</span><div class="item__main"><b>' + l[1] + '</b><small>' + (s ? 'يظهر من الأحد ٨ نوفمبر ٨:٠٠ م · يختفي الاتنين ٩ نوفمبر ١٢:٠٠ ص' : 'ظاهر على طول') + '</small></div>' + (s ? '<span class="tag tag--info">' + ic('clock', 'ico-sm') + 'بميعاد</span>' : '<span class="tag tag--ok">ظاهر</span>') + '<button class="btn btn--sm">' + ic('clock') + 'الميعاد</button>' + sw(true) + '</div>'; }).join('') +
        '</div><p class="muted" style="font-size:12px;margin:12px 0 0">الأقسام والترتيب من الموقع المنشور؛ ميعاد «تحديات وألعاب» مثال.</p></section>';
    };

    /* ================= 5: قص المقطع بالثانية ================= */
    function trimBody(src, poster, opts) {
      opts = opts || {};
      var thumbs = [];
      for (var i = 0; i < 12; i++) thumbs.push('<img src="' + poster + '" alt="">');
      return '<div class="vid"><img src="' + poster + '" alt=""><span class="clip__play">' + ic('play') + '</span><span class="vid__t mono">0:03.2 / 0:22.0</span></div>' +
        '<div class="tl"><div class="tl__film">' + thumbs.join('') + '</div><span class="tl__dim" style="left:0;right:72.7%"></span><span class="tl__dim" style="left:45.5%;right:0"></span>' +
        '<span class="tl__sel" style="left:27.3%;right:54.5%"><i class="tl__h tl__h--a"></i><i class="tl__h tl__h--b"></i><em>٤٫٠ ث</em></span><span class="tl__head" style="left:41%"></span></div>' +
        '<div class="tl__ruler mono">' + ['0:00', '0:05', '0:10', '0:15', '0:20'].map(function (t) { return '<span>' + t + '</span>'; }).join('') + '</div>' +
        '<div class="grid g2" style="margin-top:16px">' +
        ['من', 'لحد'].map(function (w, i) { return '<div class="tpick"><small>' + w + '</small><div class="row" style="flex-wrap:nowrap;gap:6px"><button class="step">−١</button><button class="step">−٠٫١</button><input class="input mono tpick__v" value="' + (i ? '0:10.0' : '0:06.0') + '"><button class="step">+٠٫١</button><button class="step">+١</button></div><button class="btn btn--sm btn--ghost" style="margin-top:8px">' + ic('clock', 'ico-sm') + 'خد الوقت الحالي (' + (i ? 'O' : 'I') + ')</button></div>'; }).join('') + '</div>' +
        '<div class="tsum"><div><small class="muted">المدة</small><b>٤٫٠ ثانية</b></div><div class="seg"><span>٥ ث</span><span>١٠ ث</span><span>١٥ ث</span><span>٣٠ ث</span></div><span class="sp"></span><button class="btn btn--sm btn--primary">' + ic('play') + 'اتفرج على الجزء</button><div class="toggle-row" style="padding:6px 10px">' + sw(true) + '<b style="font-size:12.5px">كرر</b></div></div>' +
        (opts.shape ? field('الشكل', '<div class="seg"><span class="is-on">طولي ٩:١٦ (تيك توك/ريلز)</span><span>عرضي ١٦:٩ (يوتيوب)</span></div>', '', 'c12') : '') +
        '<div class="howto"><b>' + ic('info', 'ico-sm') + 'إزاي تحدد الجزء</b><ul><li><b>اسحب</b> طرف الإطار (يمين أو شمال) علشان تقصّر أو تطوّل، أو اسحب الإطار كله علشان تنقله.</li><li><b>بالثانية:</b> اكتب الوقت في «من» و«لحد»، أو دوس <b>±٠٫١</b> و<b>±١</b>.</li><li><b>من الفيديو:</b> شغّل لحد اللحظة اللي عاوزها، ودوس «خد الوقت الحالي» (أو حرف I للبداية وO للنهاية). الأسهم ← → بتحرك ٠٫١ ثانية.</li><li><b>مدة جاهزة:</b> ٥ / ١٠ / ١٥ / ٣٠ ث بتمد «لحد» من «من».</li><li>من ثانية لـ٣٠ ثانية. لو حاولت تزوّد عن ٣٠ الإطار بيقف ويقولك.</li></ul></div>';
    }
    V.trim = function () {
      return V.media() + md('video', 'قصّ مقطع للمشهد', 'برومو_1.mp4 · H.264 · 1920×1080 · 0:22 · 28.4 MB', trimBody('', M + 'vid-91def8c7-480.webp', { shape: true }) +
        '<p class="muted" style="font-size:12px;margin:12px 0 0">الصوت بيتشال. المقطع بيتعمل على جهازك، والفيديو الأصلي مش بيترفع خالص. المقطع لازم يطلع أقل من 8 MB.</p>',
        '<button class="btn btn--primary" style="min-width:170px">' + ic('check') + 'اعمل المقطع</button><button class="btn btn--ghost">إلغاء</button><span class="sp"></span><span class="saved">' + ic('info', 'ico-sm') + 'حجم متوقع ~١٫٩ MB</span>', 'modal--trim');
    };
    V['svc-clip'] = function () {
      return V.svcpages() + md('video', 'تعديل المقطع: 🎭 ميدلي العذراء', 'المسرح الأسود · المقطع ١ من ٢',
        '<div class="msec"><h4>' + ic('video', 'ico-sm') + '١. المقطع اللي بيشتغل جوه الصفحة وصوته</h4>' + trimBody('', M + 'vid-1dab96f8-480.webp') + '<div class="fgrid" style="margin-top:12px">' + field('صوت المقطع', '<div class="seg"><span class="is-on">صوته الأصلي</span><span>من غير صوت</span><span>ملف صوت</span></div>', '', 'c12') + '</div></div>' +
        '<div class="msec"><h4>' + ic('photos', 'ico-sm') + '٢. صورة الكارت</h4><div class="item"><img class="item__thumb" src="' + M + 'img-8ffd40eb-480.webp" alt="" style="width:96px;height:60px"><div class="item__main"><b style="font-size:13.5px">img-8ffd40eb</b><small>1600×900</small></div><button class="btn btn--sm">' + ic('photos') + 'غيّر</button></div></div>' +
        '<div class="msec"><h4>' + ic('edit', 'ico-sm') + '٣. العنوان والوصف</h4><div class="fgrid">' + field('عنوان الفيديو', inp('🎭 ميدلي العذراء'), '', 'c6', '١٤ / ٦٠') + field('المدة (اختياري)', inp('', 'مثلًا ٤:٣٠'), '', 'c6') + field('وصف قصير', '<textarea class="input" rows="2">BUG – Brave Under Grace\nBlack Theater Team</textarea>', '', 'c12', '٤١ / ٢٠٠') + '</div></div>' +
        '<div class="msec" style="margin:0"><h4>' + ic('external', 'ico-sm') + '٤. الفيديو الكامل</h4><div class="fgrid">' + field('لينك الفيديو الكامل', inp('', 'https://youtube.com/…', 'input--ltr'), 'اختياري: زرار «شوف العرض كامل»', 'c12') + '</div></div>',
        '<button class="btn btn--primary" style="min-width:150px">' + ic('check') + 'احفظ</button><button class="btn btn--ghost">إلغاء</button><span class="sp"></span><button class="btn btn--sm btn--danger">' + ic('trash') + 'شيل المقطع</button>');
    };

    /* ================= 6: مكان فيديو الشرح ================= */
    V['help-pop'] = function () {
      return V.bookings() + '<div class="vpop"><div class="vpop__thumb"><img src="' + P.LOGO + '" alt=""><span class="clip__play">' + ic('play') + '</span><span class="vpop__soon">قريبًا</span></div><b>فيديو شرح: الحجوزات</b><small class="muted">فيديو قصير بيشرح القسم ده خطوة بخطوة. هيتضاف بعدين.</small></div>';
    };
  };
})();
