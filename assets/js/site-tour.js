/**
 * THE SITE WALKTHROUGH (owner, 2026-11-14): «شرح الموقع», the same idea as the account's first-time cards
 * (account/onboard.js) for the whole site, now that it is official. Each card has a small moving drawing made of
 * the site's own parts (never screenshots: they would go stale with the content and weigh on a phone), so its
 * words are plain text to edit here.
 *
 *  - Opens once per device, after the card intro's «ادخل الموقع» (main.js); any time from «المزيد» → «شرح الموقع»
 *    (index.html#site-tour).
 *  - The support card uses the real people from the content (photo and name), else their initial.
 *  - The last card: install the site as a web app now (the browser's own prompt when it offers one, else how);
 *    later the welcome page gets a third button for the Android app.
 */

import { h } from './dom.js';
import { cue } from './ui-sound.js';
import { readCached, fetchContent } from './content.js';
import { canPrompt, promptInstall } from './install.js';
import { BRAND_ICONS } from './icons-brand.js';

const brand = key => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'st-brand__ic');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', (BRAND_ICONS[key] || BRAND_ICONS.facebook).path);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
};

/* the family's social pages from the content (their scene pictures and clip posters), else the usual four */
function socialsOf(content) {
  const known = ['facebook', 'instagram', 'tiktok', 'whatsapp', 'youtube', 'telegram'];
  const links = (Array.isArray(content.sections) ? content.sections : []).flatMap(s => s.links || [])
    .filter(l => known.includes(l.icon)).slice(0, 4)
    .map(l => ({
      key: l.icon,
      title: l.title,
      media: (l.gallery || []).map(g => g.poster || g.thumb || g.src).filter(Boolean).slice(0, 3)
    }));
  const list = links.length >= 2 ? links : [
    { key: 'facebook', title: 'فيسبوك', media: [] }, { key: 'instagram', title: 'إنستجرام', media: [] },
    { key: 'tiktok', title: 'تيك توك', media: [] }, { key: 'whatsapp', title: 'جروب الواتساب', media: [] }];
  for (const s of list) {
    s.media = s.media.map(src => (/^https?:/.test(src) ? src : asset(src)));
    while (s.media.length < 3) s.media.push('');
  }
  return list;
}

const ROOT = new URL('../../', import.meta.url);
const asset = path => new URL(path, ROOT).href;
const SEEN = 'athanasios.siteTour';
const AR = '٠١٢٣٤٥٦٧٨٩';
const ar = n => String(n).replace(/\d/g, d => AR[d]);

export function tourSeen() {
  try { return localStorage.getItem(SEEN) === '1'; }
  catch { return true; }
}

function markSeen() {
  try { localStorage.setItem(SEEN, '1'); }
  catch { /* private mode: it may show again, that's all */ }
}

/* a tiny outline icon (the site's icon look), so this module needs nothing else to draw */
const PATHS = {
  calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20',
  theatre: 'M4 4h16v6a8 8 0 0 1-16 0zM8.5 9h.01M15.5 9h.01M9 13.5c1.6 1.2 4.4 1.2 6 0',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  home: 'M3 11l9-7 9 7M5 9.5V20h14V9.5',
  voice: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  more: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  sound: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8',
  ticket: 'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  android: 'M7 10h10v8H7zM9 18v3M15 18v3M5 11v5M19 11v5M8.5 7.5L7 5M15.5 7.5L17 5M8 10a4 4 0 0 1 8 0',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chat: 'M4 12a8 8 0 1 1 3.5 6.6L4 20l1.3-3.6A8 8 0 0 1 4 12z',
  gift: 'M4 10h16v4H4zM6 14h12v7H6zM12 10v11M12 10S10.5 5 8 5.5 7.5 9 12 10zM12 10s1.5-5 4-4.5.5 3.5-4 4.5',
  bus: 'M5 4h14v13H5zM5 11h14M8 17v3M16 17v3M8 14h.01M16 14h.01',
  music: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H4zM17 14h3v6h-3z'
};
const ic = name => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'st-ic');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', PATHS[name] || PATHS.star);
  svg.append(path);
  return svg;
};

const img = (src, cls, size = 96) => h('img', { class: cls, src: asset(src), alt: '', width: size, height: size, decoding: 'async' });
const chip = (icon, word) => h('span', { class: 'st-chip' }, ic(icon), word);
const finger = () => h('span', { class: 'st-tap', 'aria-hidden': 'true' });

/* the real people from the content: «أمين الخدمة» (service) and «الدعم الفني» (support) */
function people(content) {
  const list = Array.isArray(content.contacts) ? content.contacts : [];
  const pick = kind => list.find(c => c && c.kind === kind) || null;
  return { service: pick('service'), support: pick('support') };
}
const photoOf = (person, big) => person && person.image && (big ? person.image.src || person.image.thumb : person.image.thumb || person.image.src);
const face = (person, fallback, big = false) => photoOf(person, big)
  ? h('span', { class: 'st-face' + (big ? ' st-face--big' : '') }, h('img', { src: asset(photoOf(person, big)), alt: '', width: big ? 120 : 52, height: big ? 120 : 52, decoding: 'async' }))
  : h('span', { class: 'st-face st-face--letter' + (big ? ' st-face--big' : '') }, Array.from((person && person.name) || fallback)[0]);

/* the latest meeting that has a poster or a program, else an example */
function meeting(content) {
  const sessions = (Array.isArray(content.sessions) ? content.sessions : []).filter(s => s && s.status !== 'cancelled');
  const best = sessions.filter(s => s.image || s.program).slice(-1)[0] || sessions.slice(-1)[0] || {};
  const parts = best.program && best.program.length >= 4 ? best.program.map(p => p.title).slice(0, 4) : ['الترانيم', 'الصلاة', 'الكلمة', 'المسابقة'];
  return { topic: best.topic || 'موضوع الاجتماع', poster: best.image && best.image.src ? asset(best.image.src) : '', parts };
}

/* the service pages' own covers (the B.U.G posters) */
function covers(content) {
  return (Array.isArray(content.pages) ? content.pages : [])
    .map(p => ({ title: p.title, src: p.cover && (p.cover.src || p.cover.thumb) }))
    .filter(p => p.src).slice(0, 2);
}

/* the daily bread logo is drawn inline so its words get the site's own fonts (an <img> SVG can't load fonts) */
function breadLogo() {
  const box = h('span', { class: 'st-logo st-logo--bread' });
  fetch(asset('assets/img/daily-bread-logo.svg'))
    .then(r => (r.ok ? r.text() : Promise.reject(r.status)))
    .then(text => {
      const doc = new DOMParser().parseFromString(text.replace(/\.\.\/fonts\//g, asset('assets/fonts/')), 'image/svg+xml');
      const svg = doc.documentElement;
      if (svg.nodeName !== 'svg') return;
      svg.querySelector('title')?.remove();
      svg.setAttribute('aria-hidden', 'true');
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      box.append(document.importNode(svg, true));
    })
    .catch(() => box.append(h('b', {}, 'خبزنا اليومي')));
  return box;
}

function cards() {
  const content = readCached() || {};
  const { service, support } = people(content);
  const meet = meeting(content);
  const posters = covers(content);
  const socials = socialsOf(content);
  const serviceName = (service && service.name) || 'أمين الخدمة';
  const supportName = (support && support.name) || 'الدعم الفني';
  return [
    {
      title: 'أهلاً بيك في موقع الأسرة',
      text: 'كل اللي يخص اجتماع الشباب في مكان واحد: ميعاد الاجتماع ومكانه، موضوعه وفقراته، خدماتنا، المسابقات والنقط، وطريقة توصل بيها للخدام.',
      art: () => h('div', { class: 'st-welcome' },
        h('span', { class: 'st-glow' }),
        img('assets/img/logo-256.webp', 'st-welcome__logo', 128),
        h('div', { class: 'st-orbit' },
          chip('calendar', 'الاجتماع'), chip('theatre', 'خدماتنا'), chip('trophy', 'المسابقات'), chip('user', 'حسابك')))
    },
    {
      title: 'الرئيسية: الاجتماع الجاي',
      text: 'أول حاجة تشوفها ميعاد الاجتماع الجاي والوقت الفاضل عليه. دوس «أضف للتقويم» عشان موبايلك يفكّرك، وتحته مكان الاجتماع على الخريطة.',
      art: () => h('div', { class: 'st-m' },
        h('div', { class: 'st-card' },
          h('span', { class: 'st-card__k' }, ic('calendar'), 'اجتماع الشباب'),
          h('b', { class: 'st-count' }, 'فاضل يوم و', h('span', { class: 'st-tick' }, ar(12)), ' ساعة'),
          h('div', { class: 'st-week' }, ['اثنين', 'ثلاث', 'أربع', 'خميس', 'جمعة', 'النهارده', 'أحد'].map((d, i) => h('span', { class: i === 6 ? 'is-day' : i === 5 ? 'is-now' : '' }, d))),
          h('span', { class: 'st-btn st-btn--ghost' }, ic('calendar'), 'أضف للتقويم', finger())),
        h('div', { class: 'st-chips' }, chip('calendar', 'الاجتماع الجاي'), chip('pin', 'مكان الاجتماع'), chip('star', 'نقاطي')))
    },
    {
      title: 'موضوع الاجتماع وفقراته',
      text: 'بوستر الاجتماع بيظهر هنا: دوس عليه وتقرا تفاصيل الموضوع كاملة. وتحته الفقرات، ووقت الاجتماع بتعرف الفقرة الشغالة في الكنيسة دلوقتي.',
      art: () => h('div', { class: 'st-meet' },
        h('div', { class: 'st-poster' },
          meet.poster
            ? h('img', { src: meet.poster, alt: '', decoding: 'async' })
            : h('span', { class: 'st-poster__fake' }, img('assets/img/intro/church-soft.webp', 'st-poster__bg', 320), img('assets/img/logo-128.webp', 'st-poster__logo', 48)),
          h('span', { class: 'st-poster__shine' }),
          h('b', { class: 'st-poster__t' }, meet.topic),
          finger(),
          h('span', { class: 'st-poster__sheet' }, h('b', {}, meet.topic), h('u', {}), h('u', {}), h('u', {}))),
        h('div', { class: 'st-live' },
          h('span', { class: 'st-live__now' }, h('i', {}), 'دلوقتي في الكنيسة'),
          h('div', { class: 'st-live__steps' }, meet.parts.map(t => h('span', {}, h('i', {}), t))),
          h('span', { class: 'st-live__bar' }, h('i', {}))))
    },
    {
      title: 'خدماتنا',
      text: 'فرق الخدمة وأعمالها، زي مسرحيات فريق B.U.G (المسرح الصامت والمسرح الأسود). دوس «شاهد أعمالنا» وادخل صفحة الفريق.',
      art: () => h('div', { class: 'st-services' },
        h('span', { class: 'st-spot' }),
        h('div', { class: 'st-fan' }, (posters.length ? posters : [{ title: 'المسرح الصامت' }, { title: 'المسرح الأسود' }]).map(p =>
          h('span', { class: 'st-fan__card' },
            p.src ? h('img', { src: asset(p.src), alt: '', decoding: 'async' }) : ic('theatre'),
            h('b', {}, p.title)))),
        img('assets/img/partners/bug-symbol-640.webp', 'st-bug', 240),
        h('span', { class: 'st-btn st-services__cta' }, 'شاهد أعمالنا', finger()))
    },
    {
      title: 'حسابك',
      text: 'الموقع كله شغال من غير حساب. لكن بحسابك تتابع حجوزاتك، وتشارك في المسابقات، وتجمع نقط تبدّلها بهدايا من المتجر، ويوصلك كل جديد.',
      art: () => h('div', { class: 'st-m' },
        h('div', { class: 'st-band' },
          h('span', {}, h('b', {}, ar(180)), 'نقطة'),
          h('span', {}, h('b', {}, ar(1)), 'حجز جاي'),
          h('span', {}, h('b', {}, ar(3)), 'مسابقة')),
        h('div', { class: 'st-rows' },
          h('span', {}, ic('ticket'), 'حجوزاتي'),
          h('span', {}, ic('trophy'), 'مسابقاتي ونتايجي'),
          h('span', {}, ic('star'), 'نقاطي والمتجر')),
        h('span', { class: 'st-btn st-btn--gold' }, 'اعمل حساب'))
    },
    {
      title: 'تعمل حساب إزاي',
      text: 'من «اعمل حساب»: اكتب إيميلك واسمك ورقم موبايلك وتاريخ ميلادك، راجعها، وبعدين اكتب الكود اللي هيوصلك على الإيميل. خلاص، حسابك جاهز.',
      art: () => h('div', { class: 'st-signup' },
        h('div', { class: 'st-steps' }, ['بياناتك', 'راجعها', 'الكود', 'جاهز'].map((t, i) => h('span', {}, h('i', {}, ar(i + 1)), t))),
        h('div', { class: 'st-form' },
          h('div', { class: 'st-form__p st-form__p--1' },
            h('span', { class: 'st-field' }, h('em', {}, 'الإيميل'), h('b', { class: 'st-type ltr' }, 'name@gmail.com')),
            h('span', { class: 'st-field' }, h('em', {}, 'الاسم الثلاثي'), h('b', { class: 'st-type' }, 'مينا جرجس فهمي')),
            h('span', { class: 'st-field st-field--row' }, h('em', {}, 'تاريخ الميلاد'), h('b', {}, ar(14)), h('b', {}, 'مايو'), h('b', {}, ar(2008)))),
          h('div', { class: 'st-form__p st-form__p--2' },
            h('em', {}, 'الكود اللي وصلك على الإيميل'),
            h('span', { class: 'st-code' }, [4, 8, 1, 5, 9, 2].map(d => h('b', {}, ar(d))))),
          h('div', { class: 'st-form__p st-form__p--3' },
            h('span', { class: 'st-done' }, ic('check')), h('b', {}, 'حسابك جاهز'), h('span', { class: 'st-confetti' }, Array.from({ length: 10 }, () => h('i', {}))))))
    },
    {
      title: 'المتجر',
      text: 'كل مسابقة تكسب فيها نقط. لما المتجر يفتح، اختار الهدية اللي تعجبك ودوس «استبدل»، والنقط تتخصم من رصيدك. وتتابع طلبك من «طلباتي» لحد ما تستلمه من الخدام.',
      art: () => h('div', { class: 'st-shop' },
        h('div', { class: 'st-shop__head' },
          h('span', { class: 'st-shop__open' }, h('i', {}), 'المتجر مفتوح'),
          h('span', { class: 'st-coins' }, ic('star'), h('b', { class: 'st-coins__a' }, ar(320)), h('b', { class: 'st-coins__b' }, ar(170)), 'نقطة')),
        h('div', { class: 'st-shelf' },
          [
            ['book', 'كتاب مقدس جيب', 250, 'is-a'],
            ['gift', 'ميدالية الأسرة', 150, 'is-b'],
            ['music', 'سماعة بلوتوث', 400, 'is-c']
          ].map(([icon, name, price, tone]) => h('span', { class: 'st-item ' + tone },
            h('span', { class: 'st-item__pic' }, ic(icon), h('i', { class: 'st-item__shine' })),
            h('b', {}, name),
            h('span', { class: 'st-item__price' }, ic('star'), ar(price), ' نقطة'),
            tone === 'is-b' ? h('span', { class: 'st-item__cta' }, 'استبدل', finger()) : h('span', { class: 'st-item__cta st-item__cta--off' }, price > 320 ? 'محتاج نقط' : 'استبدل')))),
        h('span', { class: 'st-shop__toast' }, ic('check'), 'اتطلبت! تابعها من «طلباتي»'))
    },
    {
      title: 'الحجوزات',
      text: 'الرحلات والمؤتمرات والأنشطة بتنزل على الموقع. دوس «احجز مكانك»، اختار عدد الأماكن، وابعت الحجز. هيظهرلك في «حجوزاتي»: حالته (مستني / مؤكد)، ودفعت كام وباقي كام، ومن هناك تدفع الباقي.',
      art: () => h('div', { class: 'st-book' },
        h('div', { class: 'st-trip' },
          h('span', { class: 'st-trip__pic' }, img('assets/img/intro/church-soft.webp', '', 320), h('i', { class: 'st-trip__sun' })),
          h('span', { class: 'st-trip__body' },
            h('span', { class: 'st-trip__k' }, ic('bus'), 'رحلة'),
            h('b', {}, 'رحلة دير الأنبا أنطونيوس'),
            h('span', { class: 'st-trip__meta' }, ic('calendar'), 'الجمعة ' + ar(5) + ' ديسمبر', h('i', {}), ar(900) + ' جنيه'),
            h('span', { class: 'st-seats' }, h('b', { class: 'st-seats__a' }, ar(12)), h('b', { class: 'st-seats__b' }, ar(11)), ' مكان فاضل'),
            h('span', { class: 'st-btn st-btn--gold st-trip__cta' }, 'احجز مكانك', finger()))),
        h('div', { class: 'st-ticket' },
          h('span', { class: 'st-ticket__top' }, h('b', {}, 'رحلة دير الأنبا أنطونيوس'), h('span', { class: 'st-ticket__chip' }, h('em', { class: 'st-ticket__wait' }, 'مستني'), h('em', { class: 'st-ticket__ok' }, ic('check'), 'مؤكد'))),
          h('span', { class: 'st-ticket__bar' }, h('i', {})),
          h('span', { class: 'st-ticket__pay' }, 'دفعت ', h('b', {}, ar(600)), ' من ' + ar(900) + ' جنيه', h('span', { class: 'st-ticket__rest' }, 'ادفع الباقي'))))
    },
    {
      title: 'تتنقل إزاي',
      text: 'على الموبايل الشريط اللي تحت بيوديك لأي حتة، و«المزيد» فيه كل صفحات الموقع. وفوق: الجرس للإشعارات، والسماعة لأصوات الموقع.',
      art: () => h('div', { class: 'st-m' },
        h('div', { class: 'st-top' }, h('span', {}, ic('bell')), h('span', {}, ic('sound')), h('i', {}), img('assets/img/logo-128.webp', 'st-top__logo', 30)),
        h('div', { class: 'st-bar' },
          h('span', {}, ic('home'), 'الرئيسية'),
          h('span', {}, ic('voice'), 'صوتك يهمنا'),
          h('span', {}, ic('calendar'), 'الاجتماع'),
          h('span', {}, ic('user'), 'حسابي'),
          h('span', {}, ic('more'), 'المزيد'),
          h('i', { class: 'st-bar__pill' })))
    },
    {
      title: 'تابعنا',
      text: 'صفحاتنا كلها في آخر الرئيسية: فيسبوك وإنستجرام وتيك توك وجروب الواتساب. دوس على أي واحدة وهتشوف الأول فيديوهاتها وصورها جوه الموقع، وبعدين تكمّل على الصفحة نفسها.',
      art: () => h('div', { class: 'st-social' },
        h('div', { class: 'st-brands' }, socials.map((s, i) => h('span', { class: 'st-brand st-brand--' + s.key },
          brand(s.key), h('b', {}, s.title), i === 0 ? finger() : null))),
        h('div', { class: 'st-reel' },
          h('span', { class: 'st-reel__head' }, brand(socials[0].key), socials[0].title),
          h('div', { class: 'st-reel__row' }, socials[0].media.map(src => h('span', { class: 'st-reel__clip' },
            src ? h('img', { src, alt: '', decoding: 'async' }) : null,
            h('i', { class: 'st-reel__play' }))))))
    },
    {
      title: 'محتاج حد؟',
      text: `سؤال عن الاجتماع أو الأنشطة أو الخدمة؟ كلّم ${serviceName}، أمين الخدمة. مشكلة في الموقع أو حسابك أو نقطك؟ ${supportName} في الدعم الفني بيحلها معاك على واتساب. هتلاقيهم آخر الرئيسية.`,
      art: () => h('div', { class: 'st-m st-help' },
        h('div', { class: 'st-pair' },
          h('div', { class: 'st-hero st-hero--call' }, face(service, 'أ', true), h('span', { class: 'st-ring' }, ic('phone')), h('b', {}, serviceName), h('em', {}, 'أمين الخدمة')),
          h('div', { class: 'st-hero st-hero--chat' }, face(support, 'د', true), h('span', { class: 'st-ring st-ring--wa' }, ic('chat')), h('b', {}, supportName), h('em', {}, 'الدعم الفني'))),
        h('div', { class: 'st-chat' },
          h('span', { class: 'st-bubble st-bubble--me' }, 'معايا مشكلة', ic('check')),
          h('span', { class: 'st-typing' }, face(support, 'د'), h('i', {}), h('i', {}), h('i', {})),
          h('span', { class: 'st-bubble st-bubble--them' }, face(support, 'د'), h('span', {}, h('b', {}, supportName), 'أهلاً بيك 👋 ابعتلي المشكلة وأنا هساعدك'))))
    },
    {
      title: 'جاي قريب',
      text: '«خبزنا اليومي»: كلمة من الإنجيل كل يوم تقوّيك، تقراها في دقيقة. و«الألعاب»: تحديات وألعاب للشباب على الموقع نفسه، بنقط ومراكز.',
      art: () => h('div', { class: 'st-m st-soon' },
        h('div', {}, breadLogo(), h('span', { class: 'st-soon__tag' }, 'قريبًا')),
        h('div', {}, h('span', { class: 'st-logo' }, img('assets/img/games-logo-480.webp', '', 240)), h('span', { class: 'st-soon__tag' }, 'قريبًا')))
    },
    {
      title: 'خلّيه تطبيق على موبايلك',
      install: true,
      text: 'تقدر دلوقتي تضيف الموقع لشاشة موبايلك ويفتح زي أي تطبيق (web app). وقريب هيبقى في صفحة الترحيب زرار تالت تنزّل بيه تطبيق مخصوص لأندرويد.',
      art: () => h('div', { class: 'st-m st-app' },
        h('div', { class: 'st-phone' },
          h('div', { class: 'st-phone__grid' }, h('i', {}), h('i', {}), h('i', {}), h('span', { class: 'st-phone__app' }, img('assets/img/icon-192.png', '', 44)), h('i', {}), h('i', {}))),
        h('div', { class: 'st-three' },
          h('span', { class: 'st-btn st-btn--gold' }, 'اعمل حساب'),
          h('span', { class: 'st-btn st-btn--ghost' }, 'ادخل الموقع'),
          h('span', { class: 'st-btn st-btn--soon' }, ic('android'), 'تطبيق أندرويد', h('em', {}, 'قريبًا'))))
    },
    {
      title: 'الشرح ده موجود دايمًا',
      text: 'لو حبيت تشوف الشرح تاني، هتلاقي زرار «شرح الموقع» في آخر الرئيسية جنب «شارك اللينك»، وكمان في «المزيد».',
      art: () => h('div', { class: 'st-m st-again' },
        h('div', { class: 'st-card st-again__box' },
          h('b', { class: 'st-again__t' }, 'شارك الصفحة'),
          h('div', { class: 'st-again__row' },
            h('span', { class: 'st-btn st-btn--gold' }, 'شارك اللينك'),
            h('span', { class: 'st-btn st-btn--ghost' }, 'اعرض QR')),
          h('span', { class: 'st-btn st-btn--ghost st-again__me' }, 'شرح الموقع', finger())),
        h('div', { class: 'st-chips' }, chip('more', 'وفي «المزيد» كمان')))
    }
  ];
}

function loadCss() {
  if (document.querySelector('link[data-site-tour]')) return Promise.resolve();
  return new Promise(resolve => {
    const link = h('link', { rel: 'stylesheet', href: asset('assets/css/tour.css'), 'data-site-tour': '' });
    link.addEventListener('load', resolve);
    link.addEventListener('error', resolve);
    document.head.append(link);
  });
}

let open = false;

export async function openSiteTour({ onDone = null, doneLabel = 'يلا نبدأ' } = {}) {
  if (open) return;
  open = true;
  await loadCss();
  if (!readCached()) await fetchContent().catch(() => null);

  const list = cards();
  const dialog = h('dialog', { class: 'st', 'aria-label': 'شرح الموقع' });
  let at = 0;
  let done = false;

  const finish = sound => {
    if (done) return;
    done = true;
    open = false;
    markSeen();
    cue(sound);
    if (dialog.open) dialog.close();
    dialog.remove();
    if (onDone) onDone();
  };

  const count = h('span', { class: 'st__n' });
  const skip = h('button', { type: 'button', class: 'st__skip', 'data-quiet': '', onclick: () => finish('close') }, 'تخطّي');
  const art = h('div', { class: 'st__art' });
  const text = h('div', { class: 'st__text', 'aria-live': 'polite' });
  const dots = h('div', { class: 'st__dots', 'aria-hidden': 'true' }, list.map(() => h('i', {})));
  const back = h('button', { type: 'button', class: 'btn', 'data-quiet': '', onclick: () => move(-1) }, 'السابق');
  const next = h('button', { type: 'button', class: 'btn btn--primary', 'data-quiet': '', onclick: () => (at === list.length - 1 ? finish('success') : move(1)) });
  const install = h('button', { type: 'button', class: 'btn st__install', 'data-quiet': '' }, ic('download'), 'ثبّت الموقع على موبايلك');
  install.addEventListener('click', async () => {
    if (await promptInstall().catch(() => false)) install.replaceChildren(ic('check'), 'اتثبّت');
    else install.hidden = !canPrompt();
  });
  const actions = h('div', { class: 'st__btns' }, back, next);

  function paint() {
    const card = list[at];
    const last = at === list.length - 1;
    count.textContent = ar(at + 1) + ' من ' + ar(list.length);
    skip.hidden = last;
    art.replaceChildren(card.art());
    const how = card.install && !canPrompt()
      ? h('p', { class: 'st__how' }, 'من قايمة المتصفح (⋮ أو زرار المشاركة) اختار «إضافة إلى الشاشة الرئيسية».')
      : null;
    install.hidden = !(card.install && canPrompt());
    text.replaceChildren(h('h2', { class: 'st__t' }, card.title), h('p', { class: 'st__p' }, card.text), how || '', install);
    [...dots.children].forEach((dot, i) => dot.classList.toggle('is-on', i === at));
    back.hidden = at === 0;
    actions.classList.toggle('is-first', at === 0);
    next.textContent = last ? doneLabel : 'التالي';
  }

  function move(step) {
    const to = at + step;
    if (to < 0 || to >= list.length) return;
    at = to;
    cue('page');
    paint();
    next.focus({ preventScroll: true });
  }

  // right to left: the next card comes from the left, so a swipe to the right goes forward
  let startX = null;
  dialog.addEventListener('pointerdown', event => { startX = event.clientX; });
  dialog.addEventListener('pointerup', event => {
    if (startX === null) return;
    const moved = event.clientX - startX;
    startX = null;
    if (moved > 45) move(1);
    else if (moved < -45) move(-1);
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') move(1);
    else if (event.key === 'ArrowRight') move(-1);
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish('close'); });

  dialog.append(h('div', { class: 'st__in' },
    h('div', { class: 'st__top' }, count, skip),
    art,
    text,
    h('div', { class: 'st__foot' }, dots, actions)));
  document.body.append(dialog);
  paint();
  dialog.showModal();
  next.focus({ preventScroll: true });
  cue('open', { passive: true });
}
