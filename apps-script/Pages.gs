/**
 * SERVICE PAGES, EVENTS, SERVANTS AND HOME ENTRIES. docs/EVENTS.md §1, §2,
 * §8, §17 (Phase 1 + Phase 3).
 *
 * Storage: the private competitions spreadsheet (CompStore.gs helpers;
 * tabs Pages, PageMedia, Events, Servants, PayMethods made on first use, no
 * migration). Drafts are read through the cache `pages:draft`, dropped by
 * every write and by the review / publish (compDropDraft_).
 *
 * Home entries (§1.2): every page / event may own ONE Activities card in
 * the content Sheet (lazy column `page` / `event` = the owner's id), made
 * and kept in step by homeSync_ on every save. The card's order, its
 * shapes and its section (through its Type) work like any activity; its
 * words, picture and dates follow the owner at publish (Hub.gs).
 *
 * Publish (one commit with content.json, like competitions):
 *   pagesBuildPublic_  → content.json `pages` / `events`, the card data
 *                        Hub.gs links, the media to publish, problems
 *   pagesPublishFiles_ → <slug>/index.html + page.json,
 *                        events/<slug>/index.html + event.json,
 *                        and { withdrawn:true } for ones taken down
 *   pagesAfterCommit_  → liveV / publishedAt (or liveV cleared)
 */

var PAGE_ID = /^pg-[a-z0-9]{8}$/;
var PAGE_MEDIA_ID = /^pm-[a-z0-9]{8}$/;
var EVENT_ID = /^evt-[a-z0-9]{8}$/;
var SERVANT_ID = /^srv-[a-z0-9]{8}$/;

/* top-level paths a page can never take (the repository's own folders join them at save) */
var PAGE_RESERVED_SLUGS = ['admin', 'assets', 'media', 'points', 'competition', 'competitions', 'events', 'event', 'pages', 'page',
  'privacy', 'terms', 'review', 'tools', 'docs', 'tests', 'apps-script', 'index', 'preview', 'new', 'card-athanasios',
  'graphify-out', 'node-modules', 'content', 'manifest', 'sw', 'robots', 'meeting', 'live', 'favicon', 'api'];

var PAGE_LIMITS = {
  title: 60,
  tagline: 120,
  description: 2000,
  teamTitle: 60,
  teamText: 300,
  teamMessage: 300,
  team: 6,
  media: 60,
  mediaTitle: 80,
  mediaText: 300,
  duration: 10,
  ctaLabel: 30,
  homeCta: 24,
  servantName: 60,
  role: 40,
  note: 200,
  servants: 200
};

/* an event's home card stays this long after the event ends («خلصت»), then it's gone */
var HOME_EVENT_HOURS = 12;

/* the home section of service pages, and the card types the system adds when missing */
var HOME_SERVICES_SECTION = { key: 'services', kind: 'items', title: 'خدماتنا' };
var HOME_SEED_TYPES = [
  { key: 'funday', label: 'يوم ترفيهي', section: 'activities', icon: 'star', theme: 'emerald', ctaDefault: 'التفاصيل', notifyTemplate: 'يوم ترفيهي: {title}' },
  { key: 'service', label: 'خدمة', section: 'services', icon: 'theatre', theme: 'night', ctaDefault: 'التفاصيل', notifyTemplate: '{title}' }
];

var PAGE_DEFAULT_TEAM_TITLE = 'عايز تنضم لفريق المسرح؟';
var PAGE_DEFAULT_CTA = 'شاهد المسرحية كاملة';

/*
 * Partners a page / an event may be «بإشراف» (docs/EVENTS.md §12). One so
 * far, with its logo committed in the repository (assets/img/partners/), so
 * nothing about it lives in the Sheet: a page / an event stores only the key.
 */
var PAGE_PARTNERS = {
  bug: {
    key: 'bug',
    name: 'Brave Under Grace – B.U.G.',
    short: 'B.U.G.',
    logo: { src: 'assets/img/partners/bug-logo-720.webp', thumb: 'assets/img/partners/bug-logo-360.webp', w: 720, h: 305, alt: 'شعار Brave Under Grace – B.U.G.' },
    mark: { src: 'assets/img/partners/bug-mark-96.webp', w: 306, h: 96, alt: 'B.U.G.' },
    url: null
  }
};

/* a stored partner key → the published partner object (a copy), or null */
function pagesPartner_(key) {

  var partner = PAGE_PARTNERS[contentLine_(key)];

  return partner ? JSON.parse(JSON.stringify(partner)) : null;

}

/* this execution's draft */
var PAGES_DRAFT_ = null;


/* =========================================================
   STORAGE
========================================================= */

function pagesNewId_(prefix) {

  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);

}

/* a tab's rows, or [] while the tab (or the spreadsheet) doesn't exist yet: reads never make tabs */
function pagesRows_(name) {

  var ss = compSpreadsheet_(false);

  if (!ss || !ss.getSheetByName(name)) return [];

  return compRows_(compSheet_(name));

}

/* the payment methods: the tab, or the seed while it's empty */
function pagesMethods_(rows) {

  rows = (rows || []).filter(function (r) { return BOOK_METHOD_KEY.test(r.key); });

  if (rows.length) {
    return rows.sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
  }

  return PAY_METHOD_SEED.map(function (m, i) {
    return { key: m.key, label: m.label, icon: m.icon, needsProof: m.needsProof, order: String((i + 1) * 10), active: '1' };
  });

}

/**
 * { pages, media, events, servants, methods } (rows without __row), or
 * null without the competitions spreadsheet. Cached; every write drops it.
 */
function pagesDraft_() {

  if (PAGES_DRAFT_) return PAGES_DRAFT_;

  if (!String(PropertiesService.getScriptProperties().getProperty('COMP_SHEET_ID') || '').trim()) {
    return null;
  }

  var data = null;
  var text = compCacheGet_('pages:draft');

  if (text) {
    try {
      data = JSON.parse(text);
    }
    catch (ignored) {
      data = null;
    }
  }

  if (!data || !Array.isArray(data.pages) || !Array.isArray(data.events)) {
    try {
      data = {
        pages: pagesRows_('Pages').map(compStrip_),
        media: pagesRows_('PageMedia').map(compStrip_),
        events: pagesRows_('Events').map(compStrip_),
        servants: pagesRows_('Servants').map(compStrip_),
        methods: pagesMethods_(pagesRows_('PayMethods').map(compStrip_))
      };
    }
    catch (error) {
      console.warn('pages: draft not read: ' + ((error && error.message) || error));
      return { error: 'مقدرناش نقرا بيانات الصفحات والفعاليات دلوقتي. جرّب تاني بعد شوية.', pages: [], media: [], events: [], servants: [], methods: pagesMethods_([]) };
    }
    compCachePut_('pages:draft', JSON.stringify(data), COMP_DRAFT_SECONDS);
  }

  PAGES_DRAFT_ = data;

  return data;

}

function pagesDropDraft_() {

  PAGES_DRAFT_ = null;
  compCacheDrop_('pages:draft');

}


/*
 * An admin change under the script lock: the spreadsheet exists, the
 * Activity rows the change noted are written after it succeeded, the
 * drafts are dropped.
 */
function pagesWrite_(label, change) {

  var email = currentEmail_();
  var lock = LockService.getScriptLock();
  var result;

  // the secrets are made before the lock (never inside it)
  compEnsureSecrets_();
  lock.waitLock(20000);

  try {
    compSpreadsheet_(true);
    takeActivityNotes_();
    result = tableScope_(function () { return change(email); });
    pagesDropDraft_();
    log_(email, 'pages.' + label, typeof result === 'string' ? result : '');
    takeActivityNotes_().forEach(function (entry) { activity_(entry); });
  }
  finally {
    takeActivityNotes_();
    pagesDropDraft_();
    lock.releaseLock();
  }

  return result;

}

/* one row by id: { t, row } or null */
function pagesFind_(name, id) {

  var t = compSheet_(name);
  var n = compFindRow_(t, 'id', id);

  return n ? { t: t, row: compRowAt_(t, n) } : null;

}

function pagesJson_(text, fallback) {

  if (!text) return fallback;

  try {
    var value = JSON.parse(text);
    return value === null || value === undefined ? fallback : value;
  }
  catch (ignored) {
    return fallback;
  }

}

function pagesValidId_(id, pattern, label) {

  if (typeof id !== 'string' || !pattern.test(id)) {
    throw appError_(label + ' مش صحيح.', 'افتح الصفحة تاني.');
  }

}


/* =========================================================
   INPUT CHECKS (the editor's values → stored cells)
========================================================= */

/* the library's rows by id (content Sheet; one read per action) */
function pagesLibrary_() {

  var byId = Object.create(null);

  readOptionalTable_('Media').forEach(function (row) { byId[row.id] = row; });

  return byId;

}

/* an image id from the library, or '' (problem when missing / a video) */
function pagesImageInput_(value, label, library, problems, required) {

  var id = contentLine_(value);

  if (!id) {
    if (required) problems.push(label + ' مطلوبة');
    return '';
  }

  if (/^vid-/.test(id)) {
    problems.push(label + ': المكان ده بياخد صورة بس، مش فيديو');
    return '';
  }

  var row = /^img-[a-z0-9]{8}$/.test(id) ? library[id] : null;

  if (!row || row.deletedAt) {
    problems.push(label + ': الصورة مش موجودة في المكتبة');
    return '';
  }

  return id;

}

/* a library token (img-… or vid-…[@start-end]) → the stored token, '' when empty */
function pagesTokenInput_(value, label, library, problems, allowImage) {

  var text = contentLine_(value);

  if (!text) return '';

  var item = parseGalleryToken_(text);

  if (!item || (item.kind === 'image' && !allowImage)) {
    problems.push(label + ': ' + (allowImage ? 'صورة أو فيديو من المكتبة' : 'فيديو من المكتبة'));
    return '';
  }

  var row = library[item.id];

  if (!row || row.deletedAt) {
    problems.push(label + ': ' + (item.kind === 'video' ? 'الفيديو' : 'الصورة') + ' مش موجود في المكتبة');
    return '';
  }

  var clip = galleryClipProblem_(item);

  if (clip) {
    problems.push(label + ': ' + clip);
    return '';
  }

  return galleryToken_(item);

}

/* «الصفحة الرئيسية» (§1.2) → { show, cta, display, displayMobile } */
function homeInput_(value, problems) {

  value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  return {
    show: value.show === true,
    cta: input_(value.cta, PAGE_LIMITS.homeCta, 'نص زرار الكارت', problems, false),
    display: oneOfDisplay_(value.display, ITEM_DISPLAYS, problems, 'شكل الكارت'),
    displayMobile: oneOfDisplay_(value.displayMobile, ['auto'].concat(ITEM_DISPLAYS), problems, 'شكل الكارت على الموبايل')
  };

}

/* a slug: syntax, reserved words, unique among `others`, locked once live */
function pagesSlugInput_(value, existing, others, reserved, problems) {

  var slug = contentLine_(value).toLowerCase();

  if (existing && (existing.liveV || existing.publishedAt) && existing.slug && slug !== existing.slug) {
    problems.push('رابط الصفحة مينفعش يتغير بعد النشر (اللينكات اللي الناس معاها هتبوظ)');
    return existing.slug;
  }

  if (!COMP_SLUG.test(slug) || /--/.test(slug)) {
    problems.push('الرابط: من ٢ لـ ٤٠ حرف، حروف إنجليزي صغيرة وأرقام وشرطة (مش في الأول ولا الآخر)');
    return slug;
  }

  if (reserved && reserved.indexOf(slug) !== -1) {
    problems.push('الرابط ده محجوز في الموقع، اختار غيره');
  }

  if (others.indexOf(slug) !== -1) {
    problems.push('الرابط ده مستخدم قبل كده، اختار غيره');
  }

  return slug;

}

/* the repository's top-level names (GitHub; cached 6 h): a page at /<slug>/ never overwrites one */
function pagesRepoRoots_() {

  var cache = CacheService.getScriptCache();
  var text = cache.get('pages:roots');

  if (text) {
    try {
      return JSON.parse(text);
    }
    catch (ignored) {
      // read again
    }
  }

  try {
    var list = github_('get', '/contents/?ref=' + encodeURIComponent(githubConfig_().branch));
    var names = (Array.isArray(list) ? list : []).map(function (entry) { return String(entry.name || '').toLowerCase(); });
    cache.put('pages:roots', JSON.stringify(names), 21600);
    return names;
  }
  catch (error) {
    return [];
  }

}

/* a page row's own slug folder as GitHub sees it: '' unless this page made it */
function pagesReserved_(ownSlug) {

  var roots = pagesRepoRoots_().filter(function (name) { return name !== ownSlug; });

  return PAGE_RESERVED_SLUGS.concat(roots.map(function (name) { return name.replace(/\.[a-z0-9]+$/, ''); }));

}

function pageInput_(input, existing, others, reserved, library, servants, problems) {

  var home = homeInput_(input.home, problems);
  var team = Array.isArray(input.team) ? input.team.filter(function (id) { return typeof id === 'string'; }) : [];

  if (team.length > PAGE_LIMITS.team) problems.push('فريق الصفحة: ' + PAGE_LIMITS.team + ' أشخاص بالكتير');

  team = team.slice(0, PAGE_LIMITS.team).filter(function (id, i, all) {
    if (all.indexOf(id) !== i) return false;
    if (!servants[id]) {
      problems.push('فريق الصفحة: فيه خادم مش موجود في القائمة');
      return false;
    }
    return true;
  });

  var cardType = contentLine_(input.cardType).toLowerCase() || 'service';

  if (!/^[a-z0-9-]{1,30}$/.test(cardType)) {
    problems.push('نوع الكارت مش صحيح');
    cardType = 'service';
  }

  var theme = contentLine_(input.theme);

  var record = {
    slug: pagesSlugInput_(input.slug, existing, others, reserved, problems),
    title: input_(input.title, PAGE_LIMITS.title, 'العنوان', problems, true),
    tagline: input_(input.tagline, PAGE_LIMITS.tagline, 'السطر القصير', problems, false),
    description: textBlock_(input.description, PAGE_LIMITS.description, 'الوصف', problems),
    hero: pagesTokenInput_(input.hero, 'الصورة أو الفيديو الرئيسي', library, problems, true),
    cover: pagesImageInput_(input.cover, 'صورة الغلاف', library, problems, home.show),
    cardType: cardType,
    theme: SECTION_THEMES.indexOf(theme) !== -1 ? theme : '',
    teamTitle: input_(input.teamTitle, PAGE_LIMITS.teamTitle, 'عنوان الفريق', problems, false),
    teamText: textBlock_(input.teamText, PAGE_LIMITS.teamText, 'كلام الفريق', problems),
    teamMessage: textBlock_(input.teamMessage, PAGE_LIMITS.teamMessage, 'رسالة الواتساب', problems),
    team: team,
    enabled: input.enabled !== false,
    partner: PAGE_PARTNERS[input.partner] ? input.partner : '',
    home: home
  };

  if (input.order !== undefined && input.order !== '') {
    var order = contentNumber_(input.order);
    record.order = order === null || isNaN(order) ? '' : order;
  }

  return record;

}

function pageMediaInput_(input, library, problems) {

  var source = input.source === 'link' ? 'link' : 'clip';
  var fullRaw = contentLine_(input.fullUrl);
  var fullUrl = safeHttpsUrl(fullRaw);

  if (fullRaw && !fullUrl) problems.push('لينك المسرحية كاملة لازم يبدأ بـ https://');

  var clip = pagesTokenInput_(input.clip, 'الفيديو', library, problems, false);

  if (source === 'clip' && !clip) problems.push('اختار الفيديو من المكتبة (أو خلّي الكارت «لينك بس»)');
  if (source === 'link' && !fullUrl) problems.push('الكارت ده «لينك بس»: حط لينك المسرحية كاملة');

  return {
    title: input_(input.title, PAGE_LIMITS.mediaTitle, 'العنوان', problems, true),
    text: textBlock_(input.text, PAGE_LIMITS.mediaText, 'الكلام', problems),
    duration: input_(input.duration, PAGE_LIMITS.duration, 'المدة', problems, false),
    cover: pagesImageInput_(input.cover, 'صورة الكارت', library, problems, true),
    source: source,
    clip: source === 'clip' ? clip : '',
    fullUrl: fullUrl || '',
    ctaLabel: input_(input.ctaLabel, PAGE_LIMITS.ctaLabel, 'نص الزرار', problems, false),
    enabled: input.enabled !== false
  };

}

function eventInput_(input, existing, others, library, servants, methods, problems) {

  var home = homeInput_(input.home, problems);
  var kind = EVENT_KINDS[input.kind] ? input.kind : '';

  if (!kind) problems.push('نوع الفعالية: رحلة أو مؤتمر أو يوم ترفيهي');

  var startAt = bookStamp_(input.startAt, false, 'ميعاد البداية', problems);
  var endAt = bookStamp_(input.endAt, true, 'ميعاد النهاية', problems);

  if (!startAt) problems.push('ميعاد البداية مطلوب');
  if (startAt && endAt && endAt <= startAt) problems.push('ميعاد النهاية لازم يكون بعد البداية');

  var locationRaw = contentLine_(input.locationUrl);
  var locationUrl = safeHttpsUrl(locationRaw);

  if (locationRaw && !locationUrl) problems.push('لينك المكان لازم يبدأ بـ https://');

  var galleryList = Array.isArray(input.gallery) ? input.gallery : String(input.gallery || '').split(',');
  var gallery = galleryList.map(function (t) { return contentLine_(t); }).filter(Boolean);

  if (gallery.length > BOOK_LIMITS.gallery) problems.push('صور الفعالية: ' + BOOK_LIMITS.gallery + ' بالكتير');

  gallery = gallery.slice(0, BOOK_LIMITS.gallery).map(function (token, i) {
    return pagesTokenInput_(token, 'صور الفعالية (' + (i + 1) + ')', library, problems, true);
  }).filter(Boolean);

  var methodKeys = methods.map(function (m) { return m.key; });
  var list = Array.isArray(input.servants) ? input.servants : [];

  if (list.length > BOOK_LIMITS.servants) problems.push('الخدام المسؤولين: ' + BOOK_LIMITS.servants + ' بالكتير');

  var seen = Object.create(null);
  var eventServants = [];

  list.slice(0, BOOK_LIMITS.servants).forEach(function (s) {
    var id = s && typeof s.id === 'string' ? s.id : '';
    if (!servants[id]) {
      problems.push('الخدام المسؤولين: فيه خادم مش موجود في القائمة');
      return;
    }
    if (seen[id]) return;
    seen[id] = true;
    var keys = (Array.isArray(s.methods) ? s.methods : []).filter(function (k, i, all) { return methodKeys.indexOf(k) !== -1 && all.indexOf(k) === i; });
    eventServants.push({ id: id, methods: keys });
  });

  var booking = bookBookingInput_(input.booking, startAt, problems);
  var theme = contentLine_(input.theme);

  return {
    slug: pagesSlugInput_(input.slug, existing, others, ['index', 'new', 'preview'], problems),
    kind: kind || 'trip',
    title: input_(input.title, BOOK_LIMITS.title, 'العنوان', problems, true),
    shortTitle: input_(input.shortTitle, BOOK_LIMITS.shortTitle, 'العنوان المختصر', problems, false),
    summary: input_(input.summary, BOOK_LIMITS.summary, 'الملخص', problems, false),
    body: textBlock_(input.body, BOOK_LIMITS.body, 'التفاصيل', problems),
    cover: pagesImageInput_(input.cover, 'صورة الغلاف', library, problems, home.show),
    gallery: gallery.join(','),
    startAt: startAt,
    endAt: endAt,
    locationName: input_(input.locationName, BOOK_LIMITS.locationName, 'المكان', problems, false),
    locationUrl: locationUrl || '',
    theme: SECTION_THEMES.indexOf(theme) !== -1 ? theme : '',
    terms: textBlock_(input.terms, BOOK_LIMITS.terms, 'الشروط', problems),
    booking: booking,
    servants: eventServants,
    enabled: input.enabled !== false,
    partner: PAGE_PARTNERS[input.partner] ? input.partner : '',
    home: home
  };

}

function servantInput_(input, library, problems) {

  var phoneRaw = contentLine_(input.phone);
  var phone = phoneRaw ? normalizePhone(phoneRaw) : null;

  if (phoneRaw && !phone) problems.push('رقم الموبايل مش صحيح');

  var publicWa = input.publicWa === true;

  if (publicWa && !phone) problems.push('علشان رقمه يظهر للزوار على واتساب، لازم رقم موبايل');

  return {
    name: input_(input.name, PAGE_LIMITS.servantName, 'الاسم', problems, true),
    phone: phone ? '+' + phone.e164 : '',
    role: input_(input.role, PAGE_LIMITS.role, 'الدور', problems, false),
    image: pagesImageInput_(input.image, 'الصورة', library, problems, false),
    active: input.active !== false,
    publicWa: publicWa,
    note: input_(input.note, PAGE_LIMITS.note, 'الملاحظة', problems, false)
  };

}


/* =========================================================
   HOME ENTRIES (§1.2)
========================================================= */

/* a Types row the system needs (event kinds, `service`): made once when missing */
function homeEnsureType_(key) {

  ensureTable_('Types');

  if (findRow_('Types', 'key', key)) return;

  var seed = HOME_SEED_TYPES.concat(SEED_TYPES).filter(function (t) { return t.key === key; })[0];

  if (!seed) return;

  upsertRow_('Types', 'key', {
    key: seed.key, enabled: true, label: seed.label, section: seed.section, icon: seed.icon, theme: seed.theme,
    banner: '', ctaDefault: seed.ctaDefault, notifyTemplate: seed.notifyTemplate,
    order: nextOrder_(readOptionalTable_('Types'), function () { return true; }), updatedAt: nowStamp_()
  });

}

/* «خدماتنا»: the Sections row, right after «الفعاليات», made once */
function homeEnsureServices_() {

  if (findRow_('Sections', 'key', HOME_SERVICES_SECTION.key)) return;

  var rows = readTable_('Sections');
  var activities = rows.filter(function (r) { return r.key === 'activities'; })[0];
  var after = activities ? contentNumber_(activities.order) : null;
  var next = rows
    .map(function (r) { return contentNumber_(r.order); })
    .filter(function (o) { return o !== null && !isNaN(o) && (after === null || o > after); })
    .sort(function (a, b) { return a - b; })[0];
  var order = after === null || isNaN(after)
    ? nextOrder_(rows, function () { return true; })
    : (next !== undefined ? Math.round((after + (next - after) / 2) * 100) / 100 : after + 1);

  upsertRow_('Sections', 'key', {
    key: HOME_SERVICES_SECTION.key,
    kind: HOME_SERVICES_SECTION.kind,
    title: HOME_SERVICES_SECTION.title,
    order: order,
    enabled: true
  });

}

/* the Cairo wall stamp `hours` after another ('YYYY-MM-DD HH:MM' in and out) */
function homeAddHours_(stamp, hours) {

  var ms = compWallMs_(String(stamp || '').replace(' ', 'T'));

  return isNaN(ms) ? '' : compStampOf_(ms + hours * 3600000);

}

/*
 * The owner's card: made on its first «إظهار», updated on every save, off
 * (enabled false) when hidden or when the owner is off / archived. Never
 * deleted here. kind: 'page' | 'event'; owner: the stored row (+ parsed
 * home). Returns the card id ('' when there is none).
 */
function homeSync_(kind, owner) {

  var home = typeof owner.home === 'object' && owner.home ? owner.home : pagesJson_(owner.home, {});
  var ownerOn = contentBool_(owner.enabled) && !contentBool_(owner.archived);
  var wanted = !!home.show && ownerOn;
  var cardId = contentLine_(owner.cardId);

  ensureTable_('Activities');

  var exists = cardId ? !!findRow_('Activities', 'id', cardId) : false;

  if (!exists && !wanted) return '';

  var type = kind === 'page' ? (contentLine_(owner.cardType) || 'service') : owner.kind;

  homeEnsureType_(type);

  var typeRow = readOptionalTable_('Types').filter(function (t) { return t.key === type; })[0];

  if (typeRow && contentLine_(typeRow.section) === HOME_SERVICES_SECTION.key) homeEnsureServices_();

  var record = {
    id: exists ? cardId : pagesNewId_('act'),
    enabled: wanted,
    type: type,
    title: contentLine_(owner.title).slice(0, ACTIVITY_LIMITS.title),
    subtitle: contentLine_(kind === 'page' ? owner.tagline : owner.summary).slice(0, ACTIVITY_LIMITS.subtitle),
    image: contentLine_(owner.cover),
    ctaLabel: contentLine_(home.cta).slice(0, ACTIVITY_LIMITS.cta),
    url: '',
    location: kind === 'event' ? contentLine_(owner.locationName) : '',
    startAt: kind === 'event' ? contentLine_(owner.startAt) : '',
    endAt: kind === 'event' ? contentLine_(owner.endAt) : '',
    visibleUntil: kind === 'event' ? homeAddHours_(owner.endAt || owner.startAt, HOME_EVENT_HOURS) : '',
    display: home.display || '',
    displayMobile: home.displayMobile || '',
    updatedAt: nowStamp_()
  };

  record[kind] = owner.id;

  if (!exists) {
    record.order = nextOrder_(readOptionalTable_('Activities'), function () { return true; });
  }

  lazyColumns_('Activities', record);
  upsertRow_('Activities', 'id', record);

  return record.id;

}

/* the card as the editor shows it: { id, show, order, position, of, section } or null */
function homeCardInfo_(cardId) {

  if (!cardId) return null;

  var rows = readOptionalTable_('Activities');
  var card = rows.filter(function (r) { return r.id === cardId; })[0];

  if (!card) return null;

  var sections = Object.create(null);

  readOptionalTable_('Types').forEach(function (t) { sections[t.key] = contentLine_(t.section); });

  var section = sections[card.type] || '';
  var order = function (r) { var o = contentNumber_(r.order); return o === null || isNaN(o) ? 1e9 : o; };
  var same = rows.filter(function (r) { return contentBool_(r.enabled) && !contentBool_(r.archived) && sections[r.type] === section; })
    .sort(function (a, b) { return order(a) - order(b); });
  var position = same.map(function (r) { return r.id; }).indexOf(cardId);

  return {
    id: cardId,
    show: contentBool_(card.enabled),
    order: card.order,
    section: section,
    position: position === -1 ? 0 : position + 1,
    of: same.length
  };

}

/**
 * «ترتيب الكروت في الصفحة الرئيسية»: the cards of one items section
 * (activities, services…), in this order → orders 10, 20, … (ids not
 * named keep their place after them). Returns the fresh state.
 */
function apiHomeOrder(sectionKey, ids) {

  assertAdmin_();

  sectionKey = contentLine_(sectionKey).toLowerCase();
  ids = Array.isArray(ids) ? ids.filter(function (x) { return typeof x === 'string' && /^[\w-]{1,60}$/.test(x); }).slice(0, 200) : [];

  if (!/^[a-z0-9-]{1,40}$/.test(sectionKey)) throw appError_('القسم مش معروف.', '');

  return mutate_('home.order', sectionKey, function () {

    ensureTable_('Activities');

    var sections = Object.create(null);

    readOptionalTable_('Types').forEach(function (t) { sections[t.key] = contentLine_(t.section); });

    var order = function (r) { var o = contentNumber_(r.order); return o === null || isNaN(o) ? 1e9 : o; };
    var cards = readOptionalTable_('Activities').filter(function (r) { return sections[r.type] === sectionKey; })
      .sort(function (a, b) { return order(a) - order(b); });
    var rank = Object.create(null);

    ids.forEach(function (x, i) { rank[x] = i; });

    cards.sort(function (a, b) {
      var ra = rank[a.id] === undefined ? 1e6 + order(a) : rank[a.id];
      var rb = rank[b.id] === undefined ? 1e6 + order(b) : rank[b.id];
      return ra - rb;
    });

    cards.forEach(function (card, i) {
      if (order(card) !== (i + 1) * 10) upsertRow_('Activities', 'id', { id: card.id, order: (i + 1) * 10 });
    });

    activityNote_({ action: 'reorder', type: 'activities', id: sectionKey, title: '', changes: { count: cards.length } });

    return 'ترتيب ' + cards.length;

  });

}

/* a linked card is never deleted / archived from the activities list: it's hidden from its page (Items.gs) */
function homeRefuseLinked_(kind, key, verb) {

  if (kind !== 'activities' && kind !== 'competitions') return;

  var row = readOptionalTable_('Activities').filter(function (r) { return r.id === key; })[0];

  if (row && (row.page || row.event)) {
    var owner = row.page ? 'الصفحة' : 'الفعالية';
    throw appError_('الكارت ده تبع ' + owner + ' «' + contentLine_(row.title) + '»، ومينفعش ' + verb + ' من هنا.',
      'اخفيه من ' + (row.page ? 'صفحة الخدمة' : 'الفعالية') + ' نفسها («إظهار في الصفحة الرئيسية») بدل ما ' + (verb === 'يتمسح' ? 'تمسحه' : 'تأرشفه') + '.');
  }

}

/*
 * A linked card switched on / off from the activities list: the owner's
 * «إظهار في الصفحة الرئيسية» follows (Items.gs). → true when it was a
 * linked card (handled), false otherwise.
 */
function homeSetShowFromCard_(card, on) {

  var kind = card.page ? 'page' : card.event ? 'event' : '';

  if (!kind || !compSpreadsheet_(false)) return false;

  var found = pagesFind_(kind === 'page' ? 'Pages' : 'Events', kind === 'page' ? card.page : card.event);

  if (!found) return false;

  var home = pagesJson_(found.row.home, {});

  home.show = !!on;

  var owner = Object.assign({}, found.row, { home: home });

  compUpdate_(found.t, found.row.__row, { home: home, cardId: homeSync_(kind, owner), updatedAt: compNow_().stamp }, found.row);
  pagesDropDraft_();

  return true;

}


/* =========================================================
   ADMIN: SERVANTS AND PAYMENT METHODS
========================================================= */

function servantOut_(row) {

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    role: row.role,
    image: row.image,
    active: contentBool_(row.active),
    publicWa: contentBool_(row.publicWa),
    note: row.note,
    updatedAt: row.updatedAt
  };

}

function apiServants() {

  assertAdmin_();

  var draft = pagesDraft_() || { servants: [], methods: pagesMethods_([]) };

  return {
    servants: draft.servants.map(servantOut_).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }),
    methods: draft.methods.map(function (m) { return { key: m.key, label: m.label, needsProof: contentBool_(m.needsProof), active: contentBool_(m.active) }; }),
    limits: PAGE_LIMITS
  };

}

function apiServantSave(id, input) {

  assertAdmin_();

  if (id !== null && id !== '') pagesValidId_(id, SERVANT_ID, 'معرّف الخادم');

  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  var savedId = pagesWrite_('servant.save', function () {

    var t = compSheet_('Servants');
    var problems = [];
    var record = servantInput_(input, pagesLibrary_(), problems);
    var found = id ? pagesFind_('Servants', id) : null;

    if (id && !found) throw new Error('الخادم مش موجود');
    if (id) assertUnlocked_('servant:' + id);
    if (!id && compRows_(t).length >= PAGE_LIMITS.servants) problems.push('القائمة فيها ' + PAGE_LIMITS.servants + ' خادم بالفعل');
    if (problems.length) fail_(problems);

    var stamp = compNow_().stamp;

    record.updatedAt = stamp;

    if (found) {
      compUpdate_(t, found.row.__row, record, found.row);
      activityNote_({ action: 'update', type: 'servant', id: id, title: record.name, changes: activityDiff_(compStrip_(found.row), record) });
      return id;
    }

    record.id = pagesNewId_('srv');
    record.createdAt = stamp;
    compAppend_(t, [record]);
    activityNote_({ action: 'create', type: 'servant', id: record.id, title: record.name });

    return record.id;

  });

  var row = pagesFind_('Servants', savedId).row;

  return { servant: servantOut_(row) };

}

function apiServantSetActive(id, on) {

  assertAdmin_();
  pagesValidId_(id, SERVANT_ID, 'معرّف الخادم');

  pagesWrite_('servant.active', function () {
    var found = pagesFind_('Servants', id);
    if (!found) throw new Error('الخادم مش موجود');
    compUpdate_(found.t, found.row.__row, { active: on === true, updatedAt: compNow_().stamp }, found.row);
    activityNote_({ action: on === true ? 'enable' : 'disable', type: 'servant', id: id, title: found.row.name });
  });

  return apiServants();

}

/* the payment methods' names / order / on-off (keys stay; new keys allowed) */
function apiPayMethodsSave(list) {

  assertAdmin_();

  list = Array.isArray(list) ? list.slice(0, 12) : [];

  pagesWrite_('methods.save', function () {

    var problems = [];
    var seen = Object.create(null);
    var records = list.map(function (m, i) {
      m = m && typeof m === 'object' ? m : {};
      var key = contentLine_(m.key).toLowerCase();
      if (!BOOK_METHOD_KEY.test(key) || seen[key]) {
        problems.push('طريقة الدفع (' + (i + 1) + '): المفتاح لازم يكون إنجليزي صغير ومش متكرر');
      }
      seen[key] = true;
      return {
        key: key,
        label: input_(m.label, BOOK_LIMITS.methodLabel, 'اسم طريقة الدفع', problems, true),
        icon: '',
        needsProof: m.needsProof === true,
        order: String((i + 1) * 10),
        active: m.active !== false
      };
    });

    if (!records.length) problems.push('لازم طريقة دفع واحدة على الأقل');
    if (problems.length) fail_(problems);

    var t = compSheet_('PayMethods');
    var rows = compRows_(t);

    if (rows.length) compDeleteRows_(t, rows.map(function (r) { return r.__row; }));
    compAppend_(t, records);
    activityNote_({ action: 'settings', type: 'servant', id: 'methods', title: 'طرق الدفع', changes: { count: records.length } });

  });

  return apiServants();

}


/* =========================================================
   ADMIN: SERVICE PAGES
========================================================= */

function pageOut_(row) {

  return {
    id: row.id,
    slug: row.slug,
    enabled: contentBool_(row.enabled),
    archived: contentBool_(row.archived),
    order: row.order,
    title: row.title,
    tagline: row.tagline,
    description: row.description,
    hero: row.hero,
    cover: row.cover,
    cardType: row.cardType || 'service',
    theme: row.theme,
    teamTitle: row.teamTitle,
    teamText: row.teamText,
    teamMessage: row.teamMessage,
    team: pagesJson_(row.team, []),
    cardId: row.cardId,
    home: pagesJson_(row.home, { show: false, cta: '', display: '', displayMobile: '' }),
    partner: PAGE_PARTNERS[row.partner] ? row.partner : '',
    live: !!row.liveV,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt
  };

}

function pageMediaOut_(row) {

  return {
    id: row.id,
    pageId: row.pageId,
    order: row.order,
    enabled: contentBool_(row.enabled),
    title: row.title,
    text: row.text,
    duration: row.duration,
    cover: row.cover,
    source: row.source === 'link' ? 'link' : 'clip',
    clip: row.clip,
    fullUrl: row.fullUrl,
    ctaLabel: row.ctaLabel
  };

}

function pagesSortByOrder_(rows) {

  var order = function (r) { var o = Number(r.order); return isFinite(o) && r.order !== '' ? o : 1e9; };

  return rows.slice().sort(function (a, b) { return order(a) - order(b); });

}

/* the Types a page card can take (any enabled type; the section decides where it shows) */
function pagesCardTypes_() {

  var have = readOptionalTable_('Types').filter(function (t) { return contentBool_(t.enabled); })
    .map(function (t) { return { key: t.key, label: t.label, section: t.section }; });

  HOME_SEED_TYPES.concat(SEED_TYPES).forEach(function (t) {
    if (!have.some(function (h) { return h.key === t.key; })) have.push({ key: t.key, label: t.label, section: t.section });
  });

  return have.filter(function (t) { return t.section !== 'competitions'; });

}

function apiPages() {

  assertAdmin_();

  var draft = pagesDraft_() || { pages: [], media: [], servants: [] };
  var mediaByPage = Object.create(null);

  draft.media.forEach(function (m) {
    var list = mediaByPage[m.pageId] = mediaByPage[m.pageId] || { all: 0, clips: 0 };
    if (!contentBool_(m.enabled)) return;
    list.all++;
    if (m.source !== 'link' && m.clip) list.clips++;
  });

  return {
    pages: pagesSortByOrder_(draft.pages).map(function (row) {
      var out = pageOut_(row);
      var counts = mediaByPage[row.id] || { all: 0, clips: 0 };
      out.mediaCount = counts.all;
      out.clipCount = counts.clips;
      out.card = homeCardInfo_(row.cardId);
      return out;
    }),
    servants: draft.servants.map(servantOut_),
    types: pagesCardTypes_(),
    limits: PAGE_LIMITS,
    siteUrl: githubConfig_().siteUrl || COMP_SITE_URL
  };

}

function apiPage(id) {

  assertAdmin_();
  pagesValidId_(id, PAGE_ID, 'معرّف الصفحة');

  var draft = pagesDraft_() || { pages: [], media: [], servants: [] };
  var row = draft.pages.filter(function (r) { return r.id === id; })[0];

  if (!row) throw appError_('الصفحة دي مش موجودة.', 'يمكن اتمسحت. ارجع للقائمة.');

  return {
    page: pageOut_(row),
    media: pagesSortByOrder_(draft.media.filter(function (m) { return m.pageId === id; })).map(pageMediaOut_),
    card: homeCardInfo_(row.cardId),
    servants: draft.servants.map(servantOut_),
    types: pagesCardTypes_(),
    limits: PAGE_LIMITS
  };

}

function apiPageSave(id, input) {

  assertAdmin_();

  if (id !== null && id !== '') pagesValidId_(id, PAGE_ID, 'معرّف الصفحة');

  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  // the repository's folders (a network call: before the lock)
  var reserved = pagesReserved_(id ? ((pagesDraft_() || { pages: [] }).pages.filter(function (r) { return r.id === id; })[0] || {}).slug : '');

  var savedId = pagesWrite_('page.save', function () {

    var t = compSheet_('Pages');
    var rows = compRows_(t);
    var found = id ? rows.filter(function (r) { return r.id === id; })[0] : null;

    if (id && !found) throw new Error('الصفحة مش موجودة');
    if (id) assertUnlocked_('page:' + id);

    var servants = Object.create(null);

    pagesRows_('Servants').forEach(function (s) { servants[s.id] = s; });

    var problems = [];
    var record = pageInput_(input, found, rows.filter(function (r) { return r.id !== id; }).map(function (r) { return r.slug; }),
      reserved, pagesLibrary_(), servants, problems);

    if (problems.length) fail_(problems);

    var stamp = compNow_().stamp;
    var rowId = found ? id : pagesNewId_('pg');
    var owner = Object.assign({}, found || {}, record, { id: rowId, archived: found ? found.archived : '' });

    record.updatedAt = stamp;
    record.cardId = homeSync_('page', owner);

    if (found) {
      compUpdate_(t, found.__row, record, found);
      activityNote_({ action: 'update', type: 'page', id: rowId, title: record.title, changes: pagesHomeChange_(activityDiff_(compStrip_(found), record), found, record) });
    }
    else {
      record.id = rowId;
      record.createdAt = stamp;
      record.createdBy = currentEmail_();
      if (record.order === undefined || record.order === '') record.order = nextOrder_(rows, function () { return true; });
      compAppend_(t, [record]);
      activityNote_({ action: 'create', type: 'page', id: rowId, title: record.title });
    }

    return rowId;

  });

  return apiPage(savedId);

}

/* «الصفحة الرئيسية: ظاهر/مخفي» in an edit's Activity row */
function pagesHomeChange_(changes, before, record) {

  var was = !!pagesJson_(before.home, {}).show;
  var now = !!(record.home && record.home.show);

  changes = changes && typeof changes === 'object' ? changes : {};

  if (was !== now) changes.home = now ? 'ظاهر في الصفحة الرئيسية' : 'مخفي من الصفحة الرئيسية';

  return changes;

}

function apiPageSetEnabled(id, on) {

  assertAdmin_();
  pagesValidId_(id, PAGE_ID, 'معرّف الصفحة');

  pagesOwnerFlag_('Pages', 'page', id, { enabled: on === true }, on === true ? 'enable' : 'disable');

  return apiPage(id);

}

function apiPageArchive(id, on) {

  assertAdmin_();
  pagesValidId_(id, PAGE_ID, 'معرّف الصفحة');

  pagesOwnerFlag_('Pages', 'page', id, { archived: on === true }, on === true ? 'archive' : 'unarchive');

  return apiPage(id);

}

/* on / off / archive of a page or an event: its card follows */
function pagesOwnerFlag_(table, kind, id, change, action) {

  pagesWrite_(kind + '.' + action, function () {
    var found = pagesFind_(table, id);
    if (!found) throw new Error(kind === 'page' ? 'الصفحة مش موجودة' : 'الفعالية مش موجودة');
    assertUnlocked_(kind + ':' + id);
    var owner = Object.assign({}, found.row, change);
    change.cardId = homeSync_(kind, owner);
    change.updatedAt = compNow_().stamp;
    compUpdate_(found.t, found.row.__row, change, found.row);
    activityNote_({ action: action, type: kind, id: id, title: found.row.title });
  });

}

/* only a page that was never published (its link isn't out there): else hide / archive it */
function apiPageDelete(id) {

  assertAdmin_();
  pagesValidId_(id, PAGE_ID, 'معرّف الصفحة');

  pagesWrite_('page.delete', function () {

    var found = pagesFind_('Pages', id);

    if (!found) throw new Error('الصفحة مش موجودة');
    assertUnlocked_('page:' + id);

    if (found.row.liveV || found.row.publishedAt) {
      throw appError_('الصفحة دي اتنشرت قبل كده، فمينفعش تتمسح.', 'اقفلها أو حطها في الأرشيف وانشر: الرابط هيقول إنها مش متاحة.');
    }

    pagesDeleteCard_(found.row.cardId);

    var media = compSheet_('PageMedia');
    var mine = compColumns_(media, ['id', 'pageId']).filter(function (r) { return r.pageId === id; }).map(function (r) { return r.__row; });

    if (mine.length) compDeleteRows_(media, mine);
    compDeleteRows_(found.t, [found.row.__row]);
    activityNote_({ action: 'delete', type: 'page', id: id, title: found.row.title });

  });

  return apiPages();

}

/* the owner is gone: so is its card (content Sheet) */
function pagesDeleteCard_(cardId) {

  if (!cardId) return;

  ensureTable_('Activities');

  var rowNumber = findRow_('Activities', 'id', cardId);

  if (rowNumber) {
    sheet_('Activities').deleteRow(rowNumber);
    tableTouch_('Activities');
  }

}

function apiPageMediaSave(pageId, id, input) {

  assertAdmin_();
  pagesValidId_(pageId, PAGE_ID, 'معرّف الصفحة');

  if (id !== null && id !== '') pagesValidId_(id, PAGE_MEDIA_ID, 'معرّف الكارت');

  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  pagesWrite_('pagemedia.save', function () {

    var page = pagesFind_('Pages', pageId);

    if (!page) throw new Error('الصفحة مش موجودة');
    assertUnlocked_('page:' + pageId);

    var t = compSheet_('PageMedia');
    var rows = compRows_(t).filter(function (r) { return r.pageId === pageId; });
    var found = id ? rows.filter(function (r) { return r.id === id; })[0] : null;
    var problems = [];
    var record = pageMediaInput_(input, pagesLibrary_(), problems);

    if (id && !found) throw new Error('الكارت مش موجود');
    if (!found && rows.length >= PAGE_LIMITS.media) problems.push('الصفحة فيها ' + PAGE_LIMITS.media + ' كارت بالفعل');
    if (problems.length) fail_(problems);

    record.updatedAt = compNow_().stamp;

    if (found) {
      compUpdate_(t, found.__row, record, found);
    }
    else {
      record.id = pagesNewId_('pm');
      record.pageId = pageId;
      record.order = String(nextOrder_(rows, function () { return true; }));
      compAppend_(t, [record]);
    }

    // a «شاهد» card label may follow (watch): the card's own words don't change, the page does
    compUpdate_(page.t, page.row.__row, { updatedAt: record.updatedAt }, page.row);
    activityNote_({ action: 'update', type: 'page', id: pageId, title: page.row.title, changes: { media: record.title } });

  });

  return apiPage(pageId);

}

function apiPageMediaOrder(pageId, ids) {

  assertAdmin_();
  pagesValidId_(pageId, PAGE_ID, 'معرّف الصفحة');

  ids = Array.isArray(ids) ? ids.filter(function (x) { return typeof x === 'string' && PAGE_MEDIA_ID.test(x); }) : [];

  pagesWrite_('pagemedia.order', function () {

    var t = compSheet_('PageMedia');
    var rows = compRows_(t).filter(function (r) { return r.pageId === pageId; });
    var rank = Object.create(null);

    ids.forEach(function (x, i) { rank[x] = i; });

    var ordered = pagesSortByOrder_(rows).sort(function (a, b) {
      var ra = rank[a.id] === undefined ? 1e6 : rank[a.id];
      var rb = rank[b.id] === undefined ? 1e6 : rank[b.id];
      return ra - rb;
    });

    var updates = ordered.map(function (r, i) { return { row: r.__row, record: { order: String((i + 1) * 10) } }; });

    if (updates.length) compUpdateMany_(t, updates);
    activityNote_({ action: 'reorder', type: 'page', id: pageId, title: '', changes: { count: updates.length } });

  });

  return apiPage(pageId);

}

function apiPageMediaDelete(id) {

  assertAdmin_();
  pagesValidId_(id, PAGE_MEDIA_ID, 'معرّف الكارت');

  var pageId = '';

  pagesWrite_('pagemedia.delete', function () {
    var found = pagesFind_('PageMedia', id);
    if (!found) throw new Error('الكارت مش موجود');
    pageId = found.row.pageId;
    assertUnlocked_('page:' + pageId);
    compDeleteRows_(found.t, [found.row.__row]);
    activityNote_({ action: 'update', type: 'page', id: pageId, title: '', changes: { mediaRemoved: found.row.title } });
  });

  return apiPage(pageId);

}


/* =========================================================
   ADMIN: EVENTS
========================================================= */

function eventOut_(row) {

  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    kindLabel: EVENT_KINDS[row.kind] ? EVENT_KINDS[row.kind].label : '',
    enabled: contentBool_(row.enabled),
    archived: contentBool_(row.archived),
    title: row.title,
    shortTitle: row.shortTitle,
    summary: row.summary,
    body: row.body,
    cover: row.cover,
    gallery: row.gallery ? row.gallery.split(',') : [],
    startAt: row.startAt,
    endAt: row.endAt,
    locationName: row.locationName,
    locationUrl: row.locationUrl,
    theme: row.theme,
    terms: row.terms,
    booking: bookSpecParse_(row.booking),
    servants: pagesJson_(row.servants, []),
    cardId: row.cardId,
    home: pagesJson_(row.home, { show: false, cta: '', display: '', displayMobile: '' }),
    partner: PAGE_PARTNERS[row.partner] ? row.partner : '',
    live: !!row.liveV,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt
  };

}

function apiEvents() {

  assertAdmin_();

  var draft = pagesDraft_() || { events: [], servants: [], methods: pagesMethods_([]) };

  return {
    events: draft.events.slice().sort(function (a, b) { return a.startAt < b.startAt ? 1 : a.startAt > b.startAt ? -1 : 0; }).map(function (row) {
      var out = eventOut_(row);
      out.card = homeCardInfo_(row.cardId);
      return out;
    }),
    kinds: Object.keys(EVENT_KINDS).map(function (k) { return { key: k, label: EVENT_KINDS[k].label }; }),
    servants: draft.servants.map(servantOut_),
    methods: draft.methods.map(function (m) { return { key: m.key, label: m.label, active: contentBool_(m.active) }; }),
    limits: BOOK_LIMITS,
    siteUrl: githubConfig_().siteUrl || COMP_SITE_URL
  };

}

function apiEvent(id) {

  assertAdmin_();
  pagesValidId_(id, EVENT_ID, 'معرّف الفعالية');

  var draft = pagesDraft_() || { events: [], servants: [], methods: pagesMethods_([]) };
  var row = draft.events.filter(function (r) { return r.id === id; })[0];

  if (!row) throw appError_('الفعالية دي مش موجودة.', 'يمكن اتمسحت. ارجع للقائمة.');

  return {
    event: eventOut_(row),
    card: homeCardInfo_(row.cardId),
    kinds: Object.keys(EVENT_KINDS).map(function (k) { return { key: k, label: EVENT_KINDS[k].label }; }),
    servants: draft.servants.map(servantOut_),
    methods: draft.methods.map(function (m) { return { key: m.key, label: m.label, active: contentBool_(m.active) }; }),
    limits: BOOK_LIMITS
  };

}

function apiEventSave(id, input) {

  assertAdmin_();

  if (id !== null && id !== '') pagesValidId_(id, EVENT_ID, 'معرّف الفعالية');

  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  var savedId = pagesWrite_('event.save', function () {

    var t = compSheet_('Events');
    var rows = compRows_(t);
    var found = id ? rows.filter(function (r) { return r.id === id; })[0] : null;

    if (id && !found) throw new Error('الفعالية مش موجودة');
    if (id) assertUnlocked_('event:' + id);

    var servants = Object.create(null);

    pagesRows_('Servants').forEach(function (s) { servants[s.id] = s; });

    var problems = [];
    var record = eventInput_(input, found, rows.filter(function (r) { return r.id !== id; }).map(function (r) { return r.slug; }),
      pagesLibrary_(), servants, pagesMethods_(pagesRows_('PayMethods')), problems);

    if (problems.length) fail_(problems);

    var stamp = compNow_().stamp;
    var rowId = found ? id : pagesNewId_('evt');
    var owner = Object.assign({}, found || {}, record, { id: rowId, archived: found ? found.archived : '' });

    record.updatedAt = stamp;
    record.cardId = homeSync_('event', owner);

    if (found) {
      compUpdate_(t, found.__row, record, found);
      activityNote_({ action: 'update', type: 'event', id: rowId, title: record.title, changes: pagesHomeChange_(activityDiff_(compStrip_(found), record), found, record) });
    }
    else {
      record.id = rowId;
      record.createdAt = stamp;
      record.createdBy = currentEmail_();
      compAppend_(t, [record]);
      activityNote_({ action: 'create', type: 'event', id: rowId, title: record.title });
    }

    return rowId;

  });

  return apiEvent(savedId);

}

function apiEventSetEnabled(id, on) {

  assertAdmin_();
  pagesValidId_(id, EVENT_ID, 'معرّف الفعالية');

  pagesOwnerFlag_('Events', 'event', id, { enabled: on === true }, on === true ? 'enable' : 'disable');

  return apiEvent(id);

}

function apiEventArchive(id, on) {

  assertAdmin_();
  pagesValidId_(id, EVENT_ID, 'معرّف الفعالية');

  pagesOwnerFlag_('Events', 'event', id, { archived: on === true }, on === true ? 'archive' : 'unarchive');

  return apiEvent(id);

}

function apiEventDelete(id) {

  assertAdmin_();
  pagesValidId_(id, EVENT_ID, 'معرّف الفعالية');

  pagesWrite_('event.delete', function () {

    var found = pagesFind_('Events', id);

    if (!found) throw new Error('الفعالية مش موجودة');
    assertUnlocked_('event:' + id);

    if (found.row.liveV || found.row.publishedAt) {
      throw appError_('الفعالية دي اتنشرت قبل كده، فمينفعش تتمسح.', 'اقفلها أو حطها في الأرشيف وانشر: الرابط هيقول إنها مش متاحة.');
    }

    pagesDeleteCard_(found.row.cardId);
    compDeleteRows_(found.t, [found.row.__row]);
    activityNote_({ action: 'delete', type: 'event', id: id, title: found.row.title });

  });

  return apiEvents();

}


/* =========================================================
   PREVIEW (§17.10): the public shape from the draft
========================================================= */

/* → { kind, data, media: [{ id, src, thumb, poster, published }] } for the admin's preview frame */
function apiPagePreview(kind, id) {

  assertAdmin_();

  if (kind !== 'page' && kind !== 'event') throw appError_('نوع المعاينة مش معروف.', '');
  pagesValidId_(id, kind === 'page' ? PAGE_ID : EVENT_ID, 'المعرّف');

  var draft = pagesDraft_();
  var mediaRows = readOptionalTable_('Media');
  var built = pagesBuildPublic_(draft, {
    media: mediaIndex_(mediaRows),
    video: videoIndex_(mediaRows),
    error: function () {},
    warn: function () {},
    now: cairoNow_(new Date(Date.now())),
    hash: sha256Hex_,
    only: id,
    preview: true
  });
  var entry = built.live[id];

  if (!entry) throw appError_('مفيش حاجة تتعاين: اتأكد إن العنوان والرابط مكتوبين.', '');

  var byId = Object.create(null);

  mediaRows.forEach(function (r) { byId[r.id] = r; });

  return {
    kind: kind,
    data: entry.def,
    media: built.media.map(function (mid) {
      var r = byId[mid] || {};
      return { id: mid, src: r.path || '', thumb: r.thumb || '', published: !!r.publishedAt };
    })
  };

}


/* =========================================================
   PUBLISH: everything pages and events add (§17)
   ctx = { media: mediaIndex_, video: videoIndex_, error(where, msg), warn(where, msg), now: Cairo wall, hash }
   → { pages: [index], events: [index], live: { id: { kind, slug, def, v, row } },
       withdrawn: [{ kind, id, slug }], byId: { id: card data }, media: [ids] }
========================================================= */

function pagesBuildPublic_(draft, ctx) {

  var out = { pages: [], events: [], live: {}, withdrawn: [], byId: {}, media: [], partners: {} };

  if (!draft) return out;

  if (draft.error) {
    ctx.error('الصفحات والفعاليات', draft.error);
    return out;
  }

  var use = function (id) { if (id && out.media.indexOf(id) === -1) out.media.push(id); };
  var partnersUsed = {};
  var usePartner = function (key) {
    var partner = pagesPartner_(key);
    if (partner) partnersUsed[partner.key] = pagesPartner_(key);
    return partner;
  };
  var hash = ctx.hash || function (text) { return String(text.length); };

  var image = function (id, where, label) {
    id = contentLine_(id);
    if (!id) return null;
    var img = ctx.media[id];
    if (!img) {
      ctx.warn(where, label + ' "' + id + '" مش موجودة في المكتبة، ومش هتظهر');
      return null;
    }
    use(id);
    return img;
  };

  var token = function (text, where, label) {
    var item = parseGalleryToken_(text);
    if (!item) return null;
    if (item.kind === 'image') return image(item.id, where, label);
    var video = ctx.video[item.id];
    if (!video) {
      ctx.warn(where, label + ' "' + item.id + '" مش موجود في المكتبة، ومش هيظهر');
      return null;
    }
    var bad = galleryClipProblem_(item);
    use(item.id);
    return { type: 'video', src: video.src, poster: video.poster, w: video.w, h: video.h, alt: video.alt,
      start: item.clip && !bad ? item.start : 0, end: item.clip && !bad ? item.end : 0 };
  };

  var wall = function (stamp, endOfDay) { return stamp ? (contentDateTime_(stamp, endOfDay) || '') : ''; };
  var servantsById = Object.create(null);

  (draft.servants || []).forEach(function (s) { servantsById[s.id] = s; });

  var finish = function (kind, row, def) {
    var text = JSON.stringify(def);
    var v = hash(text).slice(0, 12);
    def.v = v;
    def.publishedAt = row.liveV === v && row.publishedAt ? (contentDateTime_(row.publishedAt, false) || ctx.now) : ctx.now;
    out.live[row.id] = { kind: kind, slug: row.slug, def: def, v: v, row: row };
    return v;
  };

  // the preview shows a page even while it is off
  var on = function (row) {
    return (ctx.preview || (contentBool_(row.enabled) && !contentBool_(row.archived))) && (!ctx.only || ctx.only === row.id);
  };
  var seen = { page: Object.create(null), event: Object.create(null) };


  /* ---------- service pages ---------- */

  pagesSortByOrder_(draft.pages || []).forEach(function (row) {

    if (!on(row)) return;

    var title = contentLine_(row.title);
    var where = 'صفحات الخدمة: ' + (title || row.slug || row.id);
    var slug = contentLine_(row.slug).toLowerCase();

    if (!COMP_SLUG.test(slug) || PAGE_RESERVED_SLUGS.indexOf(slug) !== -1 || seen.page[slug]) {
      ctx.error(where, 'الرابط مش صحيح أو مستخدم');
      return;
    }

    if (!title) {
      ctx.error(where, 'العنوان مطلوب');
      return;
    }

    seen.page[slug] = true;

    var media = pagesSortByOrder_((draft.media || []).filter(function (m) { return m.pageId === row.id && contentBool_(m.enabled); }))
      .map(function (m) {
        var mWhere = where + ' — ' + (contentLine_(m.title) || 'كارت');
        var cover = image(m.cover, mWhere, 'صورة الكارت');
        var clip = m.source !== 'link' && m.clip ? token(m.clip, mWhere, 'الفيديو') : null;
        var fullUrl = safeHttpsUrl(contentLine_(m.fullUrl)) || null;
        if (clip && clip.type !== 'video') clip = null;
        if (!cover || (!clip && !fullUrl)) {
          ctx.warn(mWhere, 'الكارت ناقص صورة أو فيديو/لينك، ومش هيظهر');
          return null;
        }
        return {
          id: m.id,
          title: contentLine_(m.title).slice(0, PAGE_LIMITS.mediaTitle),
          text: contentText_(m.text).slice(0, PAGE_LIMITS.mediaText),
          duration: contentLine_(m.duration).slice(0, PAGE_LIMITS.duration),
          cover: cover,
          source: clip ? 'clip' : 'link',
          clip: clip,
          fullUrl: fullUrl,
          ctaLabel: contentLine_(m.ctaLabel).slice(0, PAGE_LIMITS.ctaLabel) || PAGE_DEFAULT_CTA
        };
      }).filter(Boolean);

    var message = contentText_(row.teamMessage).slice(0, PAGE_LIMITS.teamMessage);
    var people = pagesJson_(row.team, []).map(function (sid) {
      var s = servantsById[sid];
      if (!s || !contentBool_(s.active)) return null;
      var phone = s.phone ? normalizePhone(s.phone) : null;
      if (!contentBool_(s.publicWa) || !phone) {
        ctx.warn(where, 'الخادم «' + contentLine_(s.name) + '» مش هيظهر في الفريق: رقمه مش متاح للزوار');
        return null;
      }
      return {
        id: s.id,
        name: contentLine_(s.name).slice(0, PAGE_LIMITS.servantName),
        role: contentLine_(s.role).slice(0, PAGE_LIMITS.role),
        image: s.image ? image(s.image, where, 'صورة الخادم') : null,
        wa: 'https://wa.me/' + phone.e164 + (message ? '?text=' + encodeURIComponent(message) : '')
      };
    }).filter(Boolean);

    var hero = row.hero ? token(row.hero, where, 'الصورة أو الفيديو الرئيسي') : null;
    var cover = image(row.cover, where, 'صورة الغلاف');

    var def = {
      schema: 1,
      v: '',
      id: row.id,
      slug: slug,
      title: title.slice(0, PAGE_LIMITS.title),
      tagline: contentLine_(row.tagline).slice(0, PAGE_LIMITS.tagline),
      description: contentText_(row.description).replace(/\n{3,}/g, '\n\n').slice(0, PAGE_LIMITS.description),
      theme: SECTION_THEMES.indexOf(row.theme) !== -1 ? row.theme : '',
      cover: cover,
      hero: hero || cover,
      partner: usePartner(row.partner),
      media: media,
      team: people.length ? {
        title: contentLine_(row.teamTitle).slice(0, PAGE_LIMITS.teamTitle) || PAGE_DEFAULT_TEAM_TITLE,
        text: contentText_(row.teamText).slice(0, PAGE_LIMITS.teamText),
        people: people
      } : null,
      publishedAt: ''
    };

    var v = finish('page', row, def);

    out.pages.push({ id: row.id, slug: slug, title: def.title, tagline: def.tagline, cover: cover, partner: def.partner ? def.partner.key : null, v: v });

    out.byId[row.id] = {
      kind: 'page',
      partner: def.partner ? def.partner.key : null,
      slug: slug,
      title: def.title,
      subtitle: def.tagline,
      imageId: contentLine_(row.cover),
      location: '',
      startAt: '',
      endAt: '',
      visibleUntil: '',
      watch: media.some(function (m) { return m.source === 'clip'; })
    };

  });


  /* ---------- events ---------- */

  (draft.events || []).slice().sort(function (a, b) { return a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0; }).forEach(function (row) {

    if (!on(row)) return;

    var title = contentLine_(row.title);
    var where = 'الفعاليات: ' + (title || row.slug || row.id);
    var slug = contentLine_(row.slug).toLowerCase();
    var kind = EVENT_KINDS[row.kind] ? row.kind : '';
    var startAt = wall(row.startAt, false);

    if (!COMP_SLUG.test(slug) || seen.event[slug]) {
      ctx.error(where, 'الرابط مش صحيح أو مستخدم');
      return;
    }

    if (!title || !kind || !startAt) {
      ctx.error(where, 'العنوان والنوع وميعاد البداية مطلوبين');
      return;
    }

    seen.event[slug] = true;

    var endAt = wall(row.endAt, true);
    var cover = image(row.cover, where, 'صورة الغلاف');
    var gallery = String(row.gallery || '').split(',').map(function (t) { return contentLine_(t); }).filter(Boolean)
      .map(function (t) { return token(t, where, 'صور الفعالية'); }).filter(Boolean);
    var spec = bookSpecParse_(row.booking);
    var booking = spec ? bookPublicBooking_(spec, pagesJson_(row.servants, []), servantsById, draft.methods || [],
      function (id) { return image(id, where, 'صورة الخادم'); }) : null;

    if (booking && !booking.servants.length) {
      ctx.warn(where, 'مفيش خادم مسؤول متاح للحجز، فالزوار مش هيلاقوا حد يكلموه');
    }
    if (booking) {
      booking.servants.forEach(function (s) {
        if (!s.wa) ctx.warn(where, 'الخادم «' + s.name + '» هيظهر من غير واتساب: رقمه مش متاح للزوار');
      });
    }

    var locationName = contentLine_(row.locationName).slice(0, BOOK_LIMITS.locationName);
    var locationUrl = safeHttpsUrl(contentLine_(row.locationUrl)) || null;

    var def = {
      schema: 1,
      v: '',
      id: row.id,
      slug: slug,
      kind: kind,
      kindLabel: EVENT_KINDS[kind].label,
      title: title.slice(0, BOOK_LIMITS.title),
      shortTitle: contentLine_(row.shortTitle).slice(0, BOOK_LIMITS.shortTitle),
      summary: contentLine_(row.summary).slice(0, BOOK_LIMITS.summary),
      body: contentText_(row.body).replace(/\n{3,}/g, '\n\n').slice(0, BOOK_LIMITS.body),
      theme: SECTION_THEMES.indexOf(row.theme) !== -1 ? row.theme : '',
      cover: cover,
      gallery: gallery,
      startAt: startAt,
      endAt: endAt,
      location: locationName || locationUrl ? { name: locationName, url: locationUrl } : null,
      terms: contentText_(row.terms).slice(0, BOOK_LIMITS.terms),
      partner: usePartner(row.partner),
      booking: booking,
      publishedAt: ''
    };

    var v = finish('event', row, def);
    var windowOf = booking ? { opensAt: booking.opensAt, closesAt: booking.closesAt } : null;
    var until = homeAddHours_(row.endAt || row.startAt, HOME_EVENT_HOURS);

    out.events.push({
      id: row.id, slug: slug, kind: kind, kindLabel: def.kindLabel, title: def.title, shortTitle: def.shortTitle, summary: def.summary,
      cover: cover, startAt: startAt, endAt: endAt, booking: windowOf, partner: def.partner ? def.partner.key : null, v: v
    });

    out.byId[row.id] = {
      kind: 'event',
      partner: def.partner ? def.partner.key : null,
      slug: slug,
      title: def.title,
      subtitle: def.summary,
      imageId: contentLine_(row.cover),
      location: locationName,
      startAt: startAt,
      endAt: endAt,
      visibleUntil: until ? (contentDateTime_(until, false) || '') : '',
      booking: windowOf
    };

  });


  /* ---------- taken down since the last publish ---------- */

  if (!ctx.only) {
    (draft.pages || []).forEach(function (row) {
      if (row.liveV && !out.live[row.id] && COMP_SLUG.test(row.slug)) out.withdrawn.push({ kind: 'page', id: row.id, slug: row.slug });
    });
    (draft.events || []).forEach(function (row) {
      if (row.liveV && !out.live[row.id] && COMP_SLUG.test(row.slug)) out.withdrawn.push({ kind: 'event', id: row.id, slug: row.slug });
    });
  }

  // the partners used (content.json `partners`: the home cards' chips)
  out.partners = partnersUsed;

  return out;

}


/* =========================================================
   PUBLISH: FILES AND AFTER THE COMMIT
========================================================= */

var PAGE_SHELL_FALLBACK = [
  '<!doctype html>',
  '<html lang="ar" dir="rtl">',
  '',
  '<head>',
  '',
  '  <meta charset="utf-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '  <meta http-equiv="Content-Security-Policy" content="' + COMP_SITE_CSP + '">',
  '  <meta name="referrer" content="strict-origin-when-cross-origin">',
  '  <title>أسرة البابا أثناسيوس</title>',
  '  <meta name="theme-color" content="#020914">',
  '  <meta name="color-scheme" content="dark">',
  '  <meta name="format-detection" content="telephone=no">',
  '  <link rel="icon" type="image/png" sizes="32x32" href="../assets/img/favicon-32.png">',
  '  <link rel="icon" type="image/png" sizes="192x192" href="../assets/img/favicon-192.png">',
  '  <link rel="apple-touch-icon" href="../assets/img/apple-touch-icon.png">',
  '  <link rel="preload" href="../assets/fonts/cairo-arabic.woff2" as="font" type="font/woff2" crossorigin>',
  '  <link rel="manifest" href="../manifest.webmanifest">',
  '  <link rel="stylesheet" href="../assets/css/page.css">',
  '  <script src="../assets/js/page/collab.js"></script>',
  '  <script type="module" src="../assets/js/page/main.js"></script>',
  '',
  '</head>',
  '',
  '<body>',
  '  <a class="skip-link" href="#page-main">انتقل للمحتوى</a>',
  '  <header class="pbar"><p class="pbar__brand"><img src="../assets/img/logo-128.webp" width="34" height="34" alt=""><span class="pbar__name">أسرة البابا أثناسيوس</span></p><a class="pbar__home" href="../">ارجع للموقع</a></header>',
  '  <main id="page-main" class="pg" data-state="loading" tabindex="-1">',
  '    <noscript><p class="pg-note">الصفحة دي محتاجة جافاسكريبت يكون شغال في المتصفح. شغّله وافتح الصفحة تاني.</p></noscript>',
  '  </main>',
  '  <p class="visually-hidden" id="page-live" aria-live="polite"></p>',
  '</body>',
  '',
  '</html>',
  ''
].join('\n');

/* a shell we can build from: an Arabic page with a CSP, a head and the page module */
function pageShellOk_(shell) {

  return typeof shell === 'string' && shell.length > 0 && shell.length <= 100000 &&
    /<html\b[^>]*\blang="ar"[^>]*>/.test(shell) && shell.indexOf('</head>') !== -1 &&
    shell.indexOf('Content-Security-Policy') !== -1 && shell.indexOf('assets/js/page/main.js') !== -1;

}

/* the committed shell (pages/index.html), cached 10 minutes; '' = use the built-in copy */
function pagesShellText_() {

  var cache = CacheService.getScriptCache();
  var cached = cache.get('pages:shell');

  if (cached) return cached;

  try {
    var file = github_('get', '/contents/pages/index.html?ref=' + encodeURIComponent(githubConfig_().branch));
    var text = Utilities.newBlob(Utilities.base64Decode(String(file.content).replace(/\s/g, ''))).getDataAsString('UTF-8');
    if (!pageShellOk_(text)) return '';
    try {
      cache.put('pages:shell', text, 600);
    }
    catch (ignored) {
      // too big for the cache: read again next time
    }
    return text;
  }
  catch (error) {
    return '';
  }

}

/* the page's own head tags (absolute URLs) */
function pageStubHead_(kind, def, siteUrl) {

  var site = safeHttpsUrl(siteUrl || '') || COMP_SITE_URL;
  var base = site.replace(/\/?$/, '/');
  var url = base + (kind === 'event' ? 'events/' : '') + def.slug + '/';
  var title = def.title + ' | ' + COMP_SITE_NAME;
  var description = contentLine_(kind === 'event' ? (def.summary || def.title) : (def.tagline || def.description || def.title)).slice(0, 200);
  var picture = def.cover && def.cover.src ? def.cover : null;
  var imageUrl = picture ? base + picture.src : base + 'assets/img/og-image.png';
  var alt = picture ? (picture.alt || def.title) : 'شعار أسرة البابا أثناسيوس الرسولي مع اسم الخدمة';
  var e = compEscapeHtml_;

  return [
    '  <title>' + e(title) + '</title>',
    '  <meta name="description" content="' + e(description) + '">',
    '  <link rel="canonical" href="' + e(url) + '">',
    '  <meta property="og:type" content="website">',
    '  <meta property="og:locale" content="ar_EG">',
    '  <meta property="og:site_name" content="' + e(COMP_SITE_NAME) + '">',
    '  <meta property="og:title" content="' + e(def.title) + '">',
    '  <meta property="og:description" content="' + e(description) + '">',
    '  <meta property="og:url" content="' + e(url) + '">',
    '  <meta property="og:image" content="' + e(imageUrl) + '">',
    '  <meta property="og:image:width" content="' + e(picture ? picture.w : 1200) + '">',
    '  <meta property="og:image:height" content="' + e(picture ? picture.h : 630) + '">',
    '  <meta property="og:image:alt" content="' + e(alt) + '">',
    '  <meta name="twitter:card" content="summary_large_image">',
    '  <meta name="twitter:title" content="' + e(def.title) + '">',
    '  <meta name="twitter:description" content="' + e(description) + '">',
    '  <meta name="twitter:image" content="' + e(imageUrl) + '">'
  ].join('\n');

}

/**
 * The stub: the shell with this page's head tags and
 * <html … data-kind data-slug data-v>. A page at /<slug>/ sits as deep as
 * the shell (/pages/); an event at /events/<slug>/ is one level deeper.
 */
function pageStubHtml_(kind, def, siteUrl, shell) {

  var source = pageShellOk_(shell) ? shell : PAGE_SHELL_FALLBACK;
  var e = compEscapeHtml_;
  var html = source.replace(/\r\n?/g, '\n')
    .replace(/[ \t]*<!--[\s\S]*?-->[ \t]*\n?/g, '')
    .replace(/[ \t]*<title>[\s\S]*?<\/title>[ \t]*\n?/i, '')
    .replace(/[ \t]*<meta\s+name="description"[^>]*>[ \t]*\n?/gi, '')
    .replace(/[ \t]*<link\s+rel="canonical"[^>]*>[ \t]*\n?/gi, '')
    .replace(/[ \t]*<meta\s+property="og:[^"]*"[^>]*>[ \t]*\n?/gi, '')
    .replace(/[ \t]*<meta\s+name="twitter:[^"]*"[^>]*>[ \t]*\n?/gi, '')
    // the shell itself is not a page people search for; a real page is
    .replace(/[ \t]*<meta\s+name="robots"[^>]*>[ \t]*\n?/gi, '');

  if (kind === 'event') {
    html = html.replace(/(\s(?:href|src))="\.\.\//g, '$1="../../');
  }

  html = html.replace(/<html\b([^>]*)>/, function (all, attrs) {
    return '<html' + attrs.replace(/\s+data-(kind|slug|v)="[^"]*"/g, '') +
      ' data-kind="' + e(kind) + '" data-slug="' + e(def.slug) + '" data-v="' + e(def.v || '') + '"' +
      (def.partner && def.partner.key ? ' data-partner="' + e(def.partner.key) + '"' : '') + '>';
  });

  var at = html.indexOf('</head>');

  return html.slice(0, at) + pageStubHead_(kind, def, siteUrl) + '\n\n' + html.slice(at);

}

/* the folder a page / an event lives in */
function pagesFolder_(kind, slug) {

  return (kind === 'event' ? 'events/' : '') + slug + '/';

}

/* any files to write? (a shell fetch only when something changed) */
function pagesNeedFiles_(built) {

  if (!built) return false;

  return built.withdrawn.length > 0 || Object.keys(built.live).some(function (id) { return built.live[id].row.liveV !== built.live[id].v; });

}

/** { path: text } for the commit (only what changed) */
function pagesPublishFiles_(built, siteUrl, shell) {

  var files = {};

  if (!built) return files;

  Object.keys(built.live).forEach(function (id) {
    var entry = built.live[id];
    if (entry.row.liveV === entry.v) return;
    if (entry.kind === 'page' && PAGE_RESERVED_SLUGS.indexOf(entry.slug) !== -1) throw new Error('رابط صفحة محجوز: ' + entry.slug);
    var folder = pagesFolder_(entry.kind, entry.slug);
    files[folder + 'index.html'] = pageStubHtml_(entry.kind, entry.def, siteUrl, shell);
    files[folder + (entry.kind === 'event' ? 'event.json' : 'page.json')] = JSON.stringify(entry.def, null, 2) + '\n';
  });

  // links people have keep working: the stub stays, the JSON says it's gone
  built.withdrawn.forEach(function (gone) {
    if (gone.kind === 'page' && PAGE_RESERVED_SLUGS.indexOf(gone.slug) !== -1) return;
    files[pagesFolder_(gone.kind, gone.slug) + (gone.kind === 'event' ? 'event.json' : 'page.json')] =
      JSON.stringify({ schema: 1, slug: gone.slug, withdrawn: true }, null, 2) + '\n';
  });

  return files;

}

/* after the commit: what is live now */
function pagesAfterCommit_(built, stamp) {

  if (!built || (!Object.keys(built.live).length && !built.withdrawn.length)) return;

  var gone = Object.create(null);

  built.withdrawn.forEach(function (w) { gone[w.id] = true; });

  ['Pages', 'Events'].forEach(function (name) {

    if (!compSpreadsheet_(false) || !compSpreadsheet_(false).getSheetByName(name)) return;

    var t = compSheet_(name);
    var updates = [];

    compColumns_(t, ['id', 'liveV', 'publishedAt']).forEach(function (row) {
      var entry = built.live[row.id];
      if (entry && (row.liveV !== entry.v || !row.publishedAt)) {
        updates.push({ row: row.__row, record: { liveV: entry.v, publishedAt: row.liveV === entry.v && row.publishedAt ? row.publishedAt : stamp } });
      }
      else if (gone[row.id] && row.liveV) {
        updates.push({ row: row.__row, record: { liveV: '' } });
      }
    });

    if (updates.length) compUpdateMany_(t, updates);

  });

  pagesDropDraft_();

}
