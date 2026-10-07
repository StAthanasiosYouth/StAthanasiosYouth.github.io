/**
 * The scenes' words: short believable posts, captions, messages, comments
 * and replies, in the youth group's own Egyptian tone. Loaded with the
 * scenes only.
 *
 * Nothing private: senders are initials or roles («م.»، «خادم الاجتماع»);
 * no phone numbers, no real chats. The page/channel names, the meeting
 * time and place, the topics and the game names are the service's own
 * public facts (its pages and posters).
 */

import { POSTERS, CLIPS } from './library.js';
import { meetingLine, pick, rand } from './kit.js';

export const PAGE = {
  facebook: 'أسرة البابا اثناسيوس للشباب بسفاجا',
  instagram: 'pope.athanasiustheapostolic',
  tiktok: 'stathanasios.safaga',
  short: 'أسرة البابا أثناسيوس',
  place: 'كنيسة أبي سيفين – سفاجا',
  quote: '«الله صار إنسانًا، لكي يصير الإنسان إلهًا بالنعمة»',
  quoteBy: 'البابا أثناسيوس الرسولي',
  tiktokBio: '✝️ St. Athanasios Youth · Faith • Friends • Family 🤍'
};

/* generic senders (initials / roles), never real names */
export const WHO = ['م.', 'ك.', 'ج.', 'ر.', 'أ.', 'س.', 'ب.', 'ن.', 'ف.'];
export const SERVANT = 'خادم الاجتماع';

/* the group, incoming: very short, medium, now and then longer */
export const GROUP = [
  'مين نازل الأحد؟ 🙋‍♂️',
  'أنا جاي بدري أساعد في الترتيب 💪',
  'الموضوع المرة دي شكله تقيل 👀',
  'حد معاه صور الأحد اللي فات؟ 📸',
  'البوستر طالع حلو أوي بجد 😍',
  'هو ٨ ولا ٨ ونص؟ 😅',
  'تمانية بالظبط يا جماعة متتأخروش 😂',
  'الأحد اللي فات كان حلو أوي، ربنا يبارك تعبكم ✨',
  'فقرة الألعاب كانت جامدة 😂😂',
  'صلّوا عشان امتحاناتي 🙏',
  'ربنا معاك 🙏',
  'هجيب صاحبي معايا المرة دي',
  'تمام 👌',
  '❤️❤️',
  'نتقابل الأحد إن شاء الله ✨',
  'مين هيجيب السماعة للترانيم؟ 🎶',
  'أنا متأخر شوية بس جاي 🏃',
  'هو فيه تحدي جديد الأسبوع ده؟ 👀',
  'لعبة التايمر محتاجة إعادة 😂',
  'حد فاكر الآية بتاعة الأحد اللي فات؟',
  'أنا لسه بفكر في الكلام اللي اتقال… كان لمسني بجد 🤍',
  'مستنيين الضيف بقى 🔥',
  'تمام يا جماعة 👍'
];

/* the visitor's own messages (typed in the bar, then sent) */
export const MINE = [
  'أنا جاي إن شاء الله 🙌',
  'متحمس للموضوع ده بجد',
  'هكون هناك ٧:٤٥',
  'ربنا يخليكم ❤️',
  'هعدّي على صاحبي ونيجي سوا',
  'أكيد 🔥',
  'مين هيقعد جنبي؟ 😂'
];

export const REPLIES = ['هنستناك 🤍', 'أحلى خبر 😍', 'تعالى بدري نشرب شاي ☕', 'ماشي يا معلم 😂', 'نورت ✨'];

/* comments under posts (Facebook, Instagram, YouTube) */
export const COMMENTS = [
  'نشوفكم الأحد 🙏',
  'موضوع مهم جدًا 👏',
  'ربنا يبارك تعبكم',
  '❤️❤️❤️',
  'أول مرة آجي، ينفع أجيب صاحبي؟',
  'البوستر تحفة 🔥',
  'محتاجين الموضوع ده أوي',
  'مين جاي؟ 🙋',
  'تسلم إيديكم ✨',
  'الحلقة دي كانت فارقة معايا بجد 🤍'
];

/* the page answering (a reply under a comment) */
export const PAGE_REPLIES = ['أكيد تعالى ومعاك صحابك 🤍', 'مستنيينك ✨', 'نورتونا 🙏'];

/* TikTok: fast comments */
export const QUICK = ['😂😂😂', 'عايزين جزء تاني 🔥', 'مين كسب في الآخر؟', 'الضحكة في الآخر 😂', 'أنا كنت هناك 🙋', 'جامد بجد 👏', 'الأحد الجاي تحدي إيه؟ 👀', 'هههههه', '🔥🔥', 'أحلى اجتماع ❤️'];

export const TIMES = ['دلوقتي', 'من ٥ دقايق', 'من ١٢ دقيقة', 'من ساعة', 'من ساعتين', 'امبارح'];


/* the next meeting's topic (published), else '' */
export function nextTopic(content) {

  const today = new Date().toISOString().slice(0, 10);
  const next = ((content && content.sessions) || []).find(s => s.status !== 'cancelled' && s.topic && s.date >= today);
  return next ? next.topic : '';

}

/* a weekly poster's caption, the way the page writes them */
export function caption(poster, i = 0) {

  const lines = [
    `«${poster.topic}» ✨ في اجتماع الأحد الساعة ٨ مساءً — ${PAGE.place}. مستنيينكم 🤍`,
    `موضوعنا: «${poster.topic}»${poster.guest ? ` مع ${poster.guest}` : ''}. تعالى ومعاك صحابك 🙏`,
    `«${poster.topic}» 👀 كلام محتاجينه كلنا.`
  ];
  return lines[i % lines.length];

}

/* posts for the page: real posters + the recent «صوتكم يهمنا» post + the bio quote */
export function pagePosts(content) {

  const topic = nextTopic(content);
  const posts = POSTERS.slice(0, 6).map((poster, i) => ({ poster, text: caption(poster, i), time: TIMES[(i + 2) % TIMES.length] }));
  posts.splice(1, 0, { text: 'حبايبنا… صوتكم يهمنا 💛 قولولنا رأيكم واقتراحاتكم، واطلبوا صلاة أو حد يكلمكم.', time: TIMES[1] });
  posts.splice(3, 0, { text: `${PAGE.quote} — ${PAGE.quoteBy}`, time: TIMES[4] });
  if (topic) posts.unshift({ text: `📣 موضوع الأحد: «${topic}» — ${meetingLine(content, '').replace(/^📣\s*/, '') || 'الساعة ٨ مساءً'}`, time: TIMES[0] });
  return posts;

}

/* a group message: { who, text } */
export function groupMessage(n) {

  return { who: n % 4 === 0 ? SERVANT : WHO[n % WHO.length], text: GROUP[n % GROUP.length] };

}

/* short announcement lines for channels (Telegram, Discord…) */
export function channelPosts(content) {

  const topic = nextTopic(content) || POSTERS[0].topic;
  return [
    meetingLine(content, '📣 الاجتماع كل أحد الساعة ٨ مساءً'),
    `📌 موضوع الأحد: «${topic}»`,
    `📸 صور اجتماع «${POSTERS[2].topic}» نزلت على الصفحة`,
    `🎮 فقرة الألعاب: «${pick(CLIPS).caption}» — مين جاهز؟ 😂`,
    `🙏 ${PAGE.quote}`,
    'حبايبنا… صوتكم يهمنا 💛',
    `📍 ${PAGE.place}`
  ];

}

/* a number near n, for counters that differ a little each visit */
export const about = n => Math.round(n * rand(0.92, 1.08));
