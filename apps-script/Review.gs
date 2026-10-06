/**
 * REVIEW: what publishing will change, in plain words.
 *
 * describeChanges(previous, next, now) compares the live content.json with
 * the draft's and returns one entry per change a visitor would notice:
 *   { group, tone: 'add' | 'change' | 'remove', text, when }
 * grouped for the admin's review (الاجتماع، الأخبار، المسابقات…).
 * "when" says when a scheduled thing shows up (Cairo time), if later.
 * summarizeChanges() is the same list as plain lines.
 *
 * Pure: no Sheet, no network (tested in Node).
 */

var REVIEW_GROUPS = [
  { key: 'meeting', title: 'الاجتماع', icon: 'church' },
  { key: 'news', title: 'الأخبار', icon: 'megaphone' },
  { key: 'games', title: 'الألعاب', icon: 'star' },
  { key: 'competitions', title: 'المسابقات', icon: 'trophy' },
  { key: 'activities', title: 'الفعاليات', icon: 'calendar' },
  { key: 'notifications', title: 'الجرس', icon: 'bell' },
  { key: 'page', title: 'شكل الصفحة', icon: 'layers' },
  { key: 'links', title: 'اللينكات', icon: 'link' },
  { key: 'info', title: 'بيانات الموقع والتواصل', icon: 'globe' }
];

var REVIEW_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
var REVIEW_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];


/* "2026-10-11" / "2026-10-11T20:00" -> "الأحد ١١ أكتوبر" / "الأحد ١١ أكتوبر، ٨:٠٠ م" */
function reviewWhen_(value) {

  var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(String(value || ''));

  if (!m) {
    return '';
  }

  var day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  var text = REVIEW_DAYS[day.getUTCDay()] + ' ' + (+m[3]) + ' ' + REVIEW_MONTHS[+m[2] - 1];

  if (m[4] !== undefined) {
    var h = +m[4];
    text += '، ' + ((h % 12) || 12) + ':' + m[5] + (h < 12 ? ' ص' : ' م');
  }

  return text.replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; });

}

/* "20:00" -> "٨:٠٠ م" */
function reviewTime_(time) {

  var m = /^(\d{2}):(\d{2})$/.exec(String(time || ''));

  if (!m) {
    return '';
  }

  var h = +m[1];

  return (((h % 12) || 12) + ':' + m[2] + (h < 12 ? ' ص' : ' م')).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; });

}


function describeChanges(previous, next, now) {

  var entries = [];

  function add(group, tone, text, when) {
    entries.push({ group: group, tone: tone, text: text, when: when || '' });
  }

  if (!previous) {
    add('info', 'add', 'أول نشر للموقع');
    return entries;
  }

  function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // a scheduled thing that isn't visible yet: say when it will be
  function later(at) {
    var stamp = String(at || '').replace(' ', 'T');
    return now && stamp && stamp > String(now).replace(' ', 'T') ? 'يظهر ' + reviewWhen_(stamp) : '';
  }

  // gone only because its time ended: not news for the admin
  function expired(until) {
    var stamp = String(until || '').replace(' ', 'T');
    return !!(now && stamp && stamp <= String(now).replace(' ', 'T'));
  }

  /* ---------- site ---------- */

  if (!same(previous.site, next.site)) {
    add('info', 'change', 'تعديل في بيانات الموقع (الاسم / الجملة التعريفية / نص المشاركة)');
  }

  /* ---------- meeting ---------- */

  if (!same(previous.meeting, next.meeting)) {
    if (!next.meeting) {
      add('meeting', 'remove', 'إخفاء ركن الاجتماع من الموقع');
    }
    else if (!previous.meeting) {
      add('meeting', 'add', 'إظهار ركن الاجتماع على الموقع');
    }
    else if (previous.meeting.day !== next.meeting.day || previous.meeting.time !== next.meeting.time) {
      add('meeting', 'change', 'معاد الاجتماع بقى: كل ' + REVIEW_DAYS[next.meeting.day] + '، ' + reviewTime_(next.meeting.time));
    }
    else {
      add('meeting', 'change', 'تعديل في بيانات الاجتماع');
    }
  }

  diffById_(previous.sessions || [], next.sessions || [], function (s) { return s.date; }, {
    added: function (s) {
      if (s.status === 'cancelled') {
        add('meeting', 'remove', 'مفيش اجتماع ' + reviewWhen_(s.date));
      }
      else if (s.topic) {
        add('meeting', 'add', 'موضوع الاجتماع (' + reviewWhen_(s.date) + '): ' + s.topic, later(s.visibleFrom));
      }
      else {
        add('meeting', 'add', 'اجتماع ' + reviewWhen_(s.date));
      }
    },
    removed: function (s) {
      if (!expired(s.date + 'T23:59')) {
        add('meeting', 'remove', 'شيل اجتماع ' + reviewWhen_(s.date) + (s.topic ? ' (' + s.topic + ')' : ''));
      }
    },
    changed: function (before, after) {
      if (same(before, after)) return;
      if (after.status === 'cancelled' && before.status !== 'cancelled') {
        add('meeting', 'remove', 'إلغاء اجتماع ' + reviewWhen_(after.date));
      }
      else if (before.status === 'cancelled' && after.status !== 'cancelled') {
        add('meeting', 'add', 'الاجتماع راجع ' + reviewWhen_(after.date));
      }
      else if (after.topic && before.topic !== after.topic) {
        add('meeting', 'change', 'موضوع الاجتماع (' + reviewWhen_(after.date) + '): ' + after.topic, later(after.visibleFrom));
      }
      else {
        add('meeting', 'change', 'تعديل في اجتماع ' + reviewWhen_(after.date) + (after.topic ? ' (' + after.topic + ')' : ''));
      }
    }
  });

  if (!same(previous.location, next.location)) {
    add('info', next.location ? 'change' : 'remove', next.location ? 'تعديل في مكان الاجتماع' : 'إخفاء مكان الاجتماع');
  }

  if (!same(previous.announcement, next.announcement)) {
    if (!next.announcement) {
      add('page', 'remove', 'إخفاء الإعلان');
    }
    else if (!previous.announcement) {
      add('page', 'add', 'إعلان جديد: ' + next.announcement.text.slice(0, 60));
    }
    else {
      add('page', 'change', 'تعديل الإعلان');
    }
  }

  /* ---------- news, games, activities, notifications ---------- */

  // visible later: 'يظهر …'; visible now but starting later: 'يبدأ …'
  function startsLater(item) {
    return later(item.visibleFrom) || later(item.startAt).replace(/^يظهر/, 'يبدأ');
  }

  function items(name, group, words, showAt, endAt) {
    var when = function (item) { return showAt ? later(showAt(item)) : startsLater(item); };
    diffById_(previous[name] || [], next[name] || [], function (item) { return item.id; }, {
      added: function (item) { add(group(item), 'add', words(item).added + ': ' + item.title, when(item)); },
      removed: function (item) {
        if (!expired(endAt(item))) add(group(item), 'remove', words(item).removed + ': ' + item.title);
      },
      changed: function (before, after) {
        if (!same(before, after)) add(group(after), 'change', words(after).changed + ': ' + after.title, when(after));
      }
    });
  }

  var constant = function (value) { return function () { return value; }; };

  items('news', constant('news'),
    constant({ added: 'خبر جديد', removed: 'خبر هيختفي', changed: 'تعديل خبر' }),
    function (n) { return n.publishAt; }, function (n) { return n.expireAt; });

  items('games', constant('games'),
    constant({ added: 'لعبة جديدة', removed: 'لعبة هتختفي', changed: 'تعديل لعبة' }),
    null, function (g) { return g.endedUntil || g.endAt; });

  var typeLabels = {};
  (next.types || []).concat(previous.types || []).forEach(function (t) {
    if (!typeLabels[t.key]) typeLabels[t.key] = t.label;
  });

  items('activities',
    function (a) { return a.section === 'competitions' ? 'competitions' : 'activities'; },
    function (a) {
      if (a.section === 'competitions') {
        return { added: 'مسابقة جديدة', removed: 'مسابقة هتختفي', changed: 'تعديل مسابقة' };
      }
      var kind = typeLabels[a.type] ? ' (' + typeLabels[a.type] + ')' : '';
      return { added: 'فعالية جديدة' + kind, removed: 'فعالية هتختفي' + kind, changed: 'تعديل فعالية' + kind };
    },
    null, function (a) { return a.visibleUntil || a.endAt; });

  items('notifications', constant('notifications'),
    constant({ added: 'إشعار جديد في الجرس', removed: 'إشعار هيختفي من الجرس', changed: 'تعديل إشعار' }),
    function (n) { return n.publishAt; }, function (n) { return n.expireAt; });

  /* ---------- the page: sections, their order and look ---------- */

  if (next.layout && !previous.layout) {
    add('page', 'change', 'شكل الصفحة الجديد: ترتيب الأقسام وألوانها وظهورها');
  }
  else if (next.layout && previous.layout) {
    diffById_(previous.layout, next.layout, function (s) { return s.key; }, {
      added: function (s) { add('page', 'add', 'قسم هيظهر: ' + s.title, later(s.visibleFrom)); },
      removed: function (s) { add('page', 'remove', 'قسم هيختفي: ' + s.title); },
      changed: function (before, after) {
        if (!same(before, after)) add('page', 'change', 'تعديل قسم: ' + after.title, later(after.visibleFrom));
      }
    });

    // the order of the sections on both pages (ones shown or hidden don't count)
    var key = function (s) { return s.key; };
    var nextKeys = next.layout.map(key);
    var common = previous.layout.map(key).filter(function (k) { return nextKeys.indexOf(k) !== -1; });
    var nextOrder = nextKeys.filter(function (k) { return common.indexOf(k) !== -1; });
    if (!same(common, nextOrder)) {
      add('page', 'change', 'ترتيب أقسام الصفحة اتغير');
    }
  }

  // types go public with their first item: only edits to them are news
  diffById_(previous.types || [], next.types || [], function (t) { return t.key; }, {
    added: function () {},
    removed: function () {},
    changed: function (before, after) {
      if (!same(before, after)) add('page', 'change', 'تعديل نوع فعالية: ' + after.label);
    }
  });

  /* ---------- links ---------- */

  function allLinks(content) {
    var list = [];
    (content.featured || []).forEach(function (link, i) {
      list.push({ link: link, place: 'featured:' + i });
    });
    (content.sections || []).forEach(function (section) {
      section.links.forEach(function (link, i) {
        list.push({ link: link, place: section.key + ':' + i });
      });
    });
    return list;
  }

  diffById_(allLinks(previous), allLinks(next), function (item) { return item.link.id; }, {
    added: function (item) { add('links', 'add', 'رابط جديد: ' + item.link.title); },
    removed: function (item) { add('links', 'remove', 'إخفاء/حذف رابط: ' + item.link.title); },
    changed: function (before, after) {
      if (!same(before.link, after.link)) {
        add('links', 'change', 'تعديل رابط: ' + after.link.title);
      }
      else if (before.place !== after.place) {
        add('links', 'change', 'تغيير ترتيب/مكان: ' + after.link.title);
      }
    }
  });

  // link groups' titles / order (the layout above covers them when both have one)
  if (!(previous.layout && next.layout) &&
      !same((previous.sections || []).map(sectionHead_), (next.sections || []).map(sectionHead_))) {
    add('links', 'change', 'تعديل في الأقسام (العناوين أو الترتيب)');
  }

  /* ---------- contacts ---------- */

  var contactsBefore = entries.length;

  diffById_(previous.contacts || [], next.contacts || [], function (c) { return c.id; }, {
    added: function (c) { add('info', 'add', 'جهة تواصل جديدة: ' + c.name); },
    removed: function (c) { add('info', 'remove', 'إخفاء/حذف جهة تواصل: ' + c.name); },
    changed: function (before, after) {
      if (!same(before, after)) add('info', 'change', 'تعديل جهة تواصل: ' + after.name);
    }
  });

  var order = function (list) { return list.map(function (c) { return c.id; }); };

  if (entries.length === contactsBefore && !same(order(previous.contacts || []), order(next.contacts || []))) {
    add('info', 'change', 'تغيير ترتيب جهات التواصل');
  }

  return entries;

}


/** The same changes as plain lines (older callers and tests). */
function summarizeChanges(previous, next, now) {

  return describeChanges(previous, next, now).map(function (entry) {
    return entry.text + (entry.when ? ' — ' + entry.when : '');
  });

}


/** Entries in review order, grouped: [{ key, title, icon, items }]. */
function groupChanges_(entries) {

  return REVIEW_GROUPS.map(function (group) {
    return {
      key: group.key,
      title: group.title,
      icon: group.icon,
      items: entries.filter(function (e) { return e.group === group.key; }).map(function (e) {
        return { tone: e.tone, text: e.text, when: e.when };
      })
    };
  }).filter(function (group) { return group.items.length; });

}


function sectionHead_(section) {

  return section.key + '|' + section.title;

}


function diffById_(before, after, idOf, handlers) {

  var beforeById = Object.create(null);

  before.forEach(function (item) {
    beforeById[idOf(item)] = item;
  });

  var afterIds = Object.create(null);

  after.forEach(function (item) {
    var id = idOf(item);
    afterIds[id] = true;
    if (beforeById[id]) {
      handlers.changed(beforeById[id], item);
    }
    else {
      handlers.added(item);
    }
  });

  before.forEach(function (item) {
    if (!afterIds[idOf(item)]) {
      handlers.removed(item);
    }
  });

}
