/**
 * SEED DATA
 *
 * Initial content written to the Sheet by setup() (only into empty tabs), and
 * used by tools/build-seed.mjs to generate the first content.json.
 * After setup, the Sheet is the source of truth; editing this file does not
 * change a Sheet that already has data.
 */

var SETTINGS_SPEC = [
  // [key, seed value, Arabic help shown in the Sheet and the admin]
  ['site.name', 'أسرة البابا أثناسيوس لخدمة شعب كنيستها الحبيبة في سفاجا', 'الاسم الرسمي اللي بيظهر فوق في الصفحة'],
  ['site.tagline', 'كل اللي يخصّ اجتماعنا… في مكان واحد', 'جملة قصيرة تحت الاسم'],
  ['site.shareText', 'كل حاجة تخص اجتماعنا في كنيسة أبي سيفين – سفاجا في لينك واحد', 'النص اللي بيتبعت مع اللينك لما حد يعمل مشاركة'],

  ['meeting.enabled', true, 'إظهار معاد الاجتماع'],
  ['meeting.title', 'اجتماع الشباب', 'اسم الاجتماع'],
  ['meeting.day', 'الأحد', 'يوم الاجتماع'],
  ['meeting.time', '20:00', 'الساعة بنظام 24 ساعة، مثلاً 20:00 يعني 8 بالليل'],
  ['meeting.durationMinutes', '', 'مدة الاجتماع بالدقايق. لو فاضية الموقع مش هيقول إن الاجتماع "شغال دلوقتي"'],
  ['meeting.note', '', 'ملاحظة صغيرة تظهر مع المعاد (اختياري)'],
  ['meeting.skipDates', '', 'تواريخ مفيهاش اجتماع، مفصولة بفاصلة. مثال: 2026-10-12, 2026-10-19'],

  ['location.name', 'كنيسة أبي سيفين – سفاجا', 'اسم المكان'],
  ['location.address', 'سفاجا، البحر الأحمر', 'العنوان أو وصف المكان'],
  ['location.note', '', 'ملاحظة زي اسم القاعة أو الدور (اختياري)'],
  ['location.mapsUrl', 'https://maps.app.goo.gl/eCUtm5AftfTzSXmV7', 'لينك جوجل ماب'],
  ['location.lat', 26.7314392, 'خط العرض (للخريطة والاتجاهات)'],
  ['location.lng', 33.9379229, 'خط الطول (للخريطة والاتجاهات)'],

  ['notifications.historyDays', 14, 'الإشعارات بتفضل ظاهرة في الجرس كام يوم (لو مالهاش ميعاد اختفاء)'],
  ['games.endedHours', 12, 'اللعبة بتفضل ظاهرة كام ساعة بعد ما تخلص وعليها "انتهت"'],

  // legacy: replaced by pinned news; setup() migrates an enabled announcement
  ['announcement.enabled', false, 'إظهار الإعلان'],
  ['announcement.text', '', 'نص الإعلان'],
  ['announcement.tone', 'info', 'info = عادي، alert = تنبيه (زي إلغاء اجتماع)، celebrate = مناسبة حلوة'],
  ['announcement.linkUrl', '', 'لينك للتفاصيل (اختياري، لازم يبدأ بـ https://)'],
  ['announcement.linkLabel', '', 'نص زرار اللينك (اختياري)'],
  ['announcement.expiresAt', '', 'آخر يوم يظهر فيه الإعلان، مثال: 2026-10-20 (اختياري)']
];


var SEED_SECTIONS = [
  { key: 'social', title: 'تابعنا', order: 10, enabled: true },
  { key: 'links', title: 'روابط تانية', order: 20, enabled: true }
];


var SEED_LINKS = [
  {
    id: 'your-voice-matters',
    enabled: true,
    order: 10,
    section: '',
    style: 'card',
    featured: true,
    title: 'صوتك يهمنا',
    subtitle: 'قول رأيك، اطلب حد يكلمك، أو اطلب صلاة',
    cta: 'ابعت دلوقتي',
    url: 'https://stathanasiosyouth.github.io/your-voice-matters/',
    icon: 'voice',
    badge: '',
    startAt: '',
    endAt: ''
  },
  {
    id: 'facebook',
    enabled: true,
    order: 20,
    section: 'social',
    style: 'tile',
    featured: false,
    title: 'فيسبوك',
    subtitle: 'الأخبار والإعلانات',
    cta: '',
    url: 'https://www.facebook.com/Pope.Athanasius.The.Apostolic.Safaga',
    icon: 'facebook',
    badge: '',
    startAt: '',
    endAt: ''
  },
  {
    id: 'instagram',
    enabled: true,
    order: 30,
    section: 'social',
    style: 'tile',
    featured: false,
    title: 'إنستجرام',
    subtitle: 'صور وستوريز',
    cta: '',
    url: 'https://www.instagram.com/pope.athanasiustheapostolic/',
    icon: 'instagram',
    badge: '',
    startAt: '',
    endAt: ''
  },
  {
    id: 'tiktok',
    enabled: true,
    order: 40,
    section: 'social',
    style: 'tile',
    featured: false,
    title: 'تيك توك',
    subtitle: 'فيديوهات قصيرة',
    cta: '',
    url: 'https://www.tiktok.com/@stathanasios.safaga',
    icon: 'tiktok',
    badge: '',
    startAt: '',
    endAt: ''
  }
];


var SEED_CONTACTS = [
  {
    id: 'service-leader',
    enabled: true,
    order: 10,
    kind: 'service',
    name: 'فادي يوسف',
    role: 'أمين الخدمة',
    description: 'لأي سؤال أو حاجة تخص الاجتماع والخدمة',
    phone: '+20 12 20129458',
    method: 'call',
    message: ''
  },
  {
    id: 'tech-support',
    enabled: true,
    order: 20,
    kind: 'support',
    name: 'مينا زكريا',
    role: 'الدعم الفني',
    description: 'الدعم الفني لصفحات أسرة البابا أثناسيوس الرسولي',
    phone: '01276162016',
    method: 'whatsapp',
    message: 'أهلاً يا مينا، عندي مشكلة أو استفسار في صفحات أسرة البابا أثناسيوس:\n'
  }
];


var SEED_SESSIONS = [];

var SEED_NEWS = [];

var SEED_GAMES = [];

var SEED_NOTIFICATIONS = [];


function seedDraft() {

  var settings = {};

  SETTINGS_SPEC.forEach(function (row) {
    settings[row[0]] = row[1];
  });

  return {
    settings: settings,
    sections: SEED_SECTIONS,
    links: SEED_LINKS,
    contacts: SEED_CONTACTS,
    sessions: SEED_SESSIONS,
    news: SEED_NEWS,
    games: SEED_GAMES,
    notifications: SEED_NOTIFICATIONS,
    media: []
  };

}
