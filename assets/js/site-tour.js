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
import { readCached } from './content.js';
import { canPrompt, promptInstall } from './install.js';

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
  check: 'M5 12.5l4.5 4.5L19 7.5'
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
function people() {
  const content = readCached() || {};
  const list = Array.isArray(content.contacts) ? content.contacts : [];
  const pick = kind => list.find(c => c && c.kind === kind) || null;
  return { service: pick('service'), support: pick('support') };
}
const face = (person, fallback) => person && person.image && person.image.thumb
  ? h('span', { class: 'st-face' }, h('img', { src: person.image.thumb, alt: '', width: 52, height: 52, decoding: 'async' }))
  : h('span', { class: 'st-face st-face--letter' }, Array.from((person && person.name) || fallback)[0]);

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
  const { service, support } = people();
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
      text: 'موضوع كل اجتماع وفقراته بيظهروا هنا. عاوز تقرا فقرة بالظبط؟ دوس عليها وهتتفتح قدامك كاملة.',
      art: () => h('div', { class: 'st-m' },
        h('div', { class: 'st-card' },
          h('span', { class: 'st-card__k' }, ic('book'), 'موضوع الاجتماع'),
          h('b', { class: 'st-topic' }, 'إيمان بيعيش'),
          h('div', { class: 'st-list' },
            h('span', {}, h('i', {}, ar(1)), 'الترانيم'),
            h('span', { class: 'is-open' }, h('i', {}, ar(2)), 'الكلمة', finger(), h('em', { class: 'st-lines' }, h('u', {}), h('u', {}), h('u', {}))),
            h('span', {}, h('i', {}, ar(3)), 'المسابقة'))))
    },
    {
      title: 'خدماتنا',
      text: 'فرق الخدمة وأعمالها، زي مسرحيات فريق B.U.G (المسرح الصامت والمسرح الأسود). دوس «شاهد أعمالنا» وادخل صفحة الفريق.',
      art: () => h('div', { class: 'st-m st-services' },
        img('assets/img/partners/bug-logo-360.webp', 'st-bug', 160),
        h('div', { class: 'st-duo' },
          h('div', { class: 'st-card st-card--s' }, ic('theatre'), h('b', {}, 'المسرح الصامت'), h('span', { class: 'st-btn' }, 'شاهد أعمالنا')),
          h('div', { class: 'st-card st-card--s' }, ic('theatre'), h('b', {}, 'المسرح الأسود'), h('span', { class: 'st-btn' }, 'شاهد أعمالنا', finger()))))
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
      title: 'محتاج حد؟',
      text: `سؤال عن الاجتماع أو الأنشطة أو الخدمة؟ كلّم ${serviceName}، أمين الخدمة. مشكلة في الموقع أو حسابك أو نقطك؟ ${supportName} في الدعم الفني بيحلها معاك على واتساب. هتلاقيهم آخر الرئيسية.`,
      art: () => h('div', { class: 'st-m st-help' },
        h('div', { class: 'st-person st-person--call' },
          face(service, 'أ'), h('span', {}, h('b', {}, serviceName), 'أمين الخدمة'),
          h('span', { class: 'st-ring' }, ic('phone'))),
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

export async function openSiteTour({ onDone = null } = {}) {
  if (open) return;
  open = true;
  await loadCss();

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
    next.textContent = last ? 'يلا نبدأ' : 'التالي';
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
