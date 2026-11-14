/**
 * HOME (site redesign S2, W4): the home page's own arrangement of the live widgets.
 *
 * render.js builds every widget as before (the scenes on تابعنا and صوتك يهمنا, the ringing phone, the support chat,
 * the meeting card and its week, the map, share/QR); this module only places them and adds the new parts:
 *   · Suggestions on top: the featured cards, then the services (content.json featured[], then the «خدماتنا» section,
 *     PLAN §1.5), one slide per view, turning by themselves every 5 s, dots, and the quick links under them
 *   · beside them (desktop) / under them (phone): the guest's account nudge or the member's greeting + the meeting
 *   · «الفعاليات الجاية» and «جديد الأسرة» as rails (only when something is published: an empty section is not built),
 *     «خدماتنا» a rail on the phone, «الكل ‹» on each
 *   · the two people cards as a pair on wider screens
 * The rest keeps the admin's order (layout.js). Nothing here is sample data.
 */

import { h } from './dom.js';
import { iconNode } from './icons.js';
import { go } from './router.js';
import { MONTH_NAMES, arabicDigits, relativeTime, stampDate as parts, eventWhen as whenLine } from './words.js';
import { entryButton, entryHref, typeOf, visibleItems, partnerChip } from './items.js';
import { sectionBanner } from './hub.js';
import { readSession, readFace } from './account/link.js';
import { bookApiUrl } from './page/book-config.js';
import { hasCompetitions } from './comp/listing.js';

const ROOT = new URL('../../', import.meta.url);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

let slideTimer = 0;


function storage(name) {
  try {
    return globalThis[name] || null;
  }
  catch {
    return null;
  }
}

const signedIn = () => !!readSession(storage('localStorage'), storage('sessionStorage'));


/* ---------- section heads: the live title + «الكل ‹» + arrows (desktop) ---------- */

function allLink(href, count) {
  return h('a', { class: 's2-all', href: new URL(href, ROOT).href }, `الكل${count ? ` (${count})` : ''} ‹`);
}

function arrows(label) {
  return h('span', { class: 's2-arrows' },
    h('button', { type: 'button', 'data-dir': '1', 'aria-label': `${label}: السابق` }, iconNode('chevron')),
    h('button', { type: 'button', 'data-dir': '-1', 'aria-label': `${label}: التالي` }, iconNode('chevron')));
}

function head(icon, title, id, href, count) {
  return h('div', { class: 'section-head s2-head' },
    h('h2', { class: 'widget__title', id }, iconNode(icon), title),
    href ? allLink(href, count) : null,
    arrows(title));
}


/* ---------- Suggestions ---------- */

/* a service as a slide: the same card as «صوتك يهمنا» (the featured card), with its own poster in the same
   banner shape (the slides keep one height) */
function serviceSlide(item, type, shape) {
  const href = entryHref(item);
  const card = h('article', { class: 'widget featured', 'data-slide': 'service' },
    h('div', { class: 'featured__art', 'aria-hidden': 'true' }, iconNode(type.icon || 'theatre')),
    h('div', { class: 'featured__body' },
      h('h2', { class: 'featured__title' }, h('a', { class: 'stretched', href }, item.title)),
      item.subtitle ? h('p', { class: 'featured__text' }, item.subtitle) : null,
      h('span', { class: 'featured__cta', 'aria-hidden': 'true' }, 'ادخل صفحة الفريق', iconNode('arrow'))));
  if (item.image) {
    card.prepend(sectionBanner({ banner: shape ? { ...item.image, w: shape.w, h: shape.h } : item.image }));
    card.classList.add('has-banner');
  }
  return card;
}

function suggestions(featured, services, servicesSection, chips) {
  const track = h('div', { class: 's2-sugg__track' });
  const tag = (icon, word) => h('span', { class: 's2-slide__tag', 'aria-hidden': 'true' }, iconNode(icon), word);

  featured.forEach(el => track.append(el));
  services.forEach(el => track.append(el));
  [...track.children].forEach((slide, i) => {
    slide.classList.add('s2-slide');
    slide.prepend(i < featured.length ? tag('star', 'مميز') : tag(servicesSection.icon || 'theatre', servicesSection.title || 'خدماتنا'));
  });

  const n = track.children.length;
  const dots = h('div', { class: 's2-sugg__dots', hidden: n < 2 },
    [...track.children].map((s, i) => h('button', { type: 'button', class: i ? null : 'on', 'aria-label': `شريحة ${arabicDigits(i + 1)} من ${arabicDigits(n)}` }, h('i'))));

  return h('section', { class: 's2-sugg', 'data-area': 's2-sugg', 'aria-label': 'مقترحات' }, track, dots,
    h('nav', { class: 's2-chips', 'aria-label': 'اختصارات' }, chips));
}

/* one slide per view, turning by itself every 5 s; a touch, a dot or the keyboard inside restarts the wait */
function turnSlides(section) {
  clearInterval(slideTimer);
  const track = section.querySelector('.s2-sugg__track');
  const dots = section.querySelector('.s2-sugg__dots');
  const n = track.children.length;
  let cur = 0;

  const mark = () => [...dots.children].forEach((d, i) => {
    d.classList.toggle('on', i === cur);
    d.setAttribute('aria-current', i === cur ? 'true' : 'false');
  });
  const goTo = (i, smooth = true) => {
    cur = (i + n) % n;
    const s = track.children[cur];
    track.scrollTo({ left: s.offsetLeft - track.offsetLeft - (track.clientWidth - s.clientWidth) / 2, behavior: smooth && !reduced.matches ? 'smooth' : 'auto' });
    mark();
  };
  const arm = () => {
    clearInterval(slideTimer);
    // still slides: reduced motion, a hidden page (no turning nobody sees), one slide
    if (n > 1 && !reduced.matches) slideTimer = setInterval(() => { if (!document.hidden && section.isConnected) goTo(cur + 1); }, 5000);
    // the bar under the current dot fills again from the start
    // (a fresh bar, not a class toggle: the dot keeps its width, nothing moves)
    const bar = dots.querySelector('.on i');
    if (bar) bar.replaceWith(h('i'));
  };

  track.addEventListener('scroll', () => {
    const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
    let best = 0, bd = 1e9;
    [...track.children].forEach((s, i) => {
      const r = s.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < bd) { bd = d; best = i; }
    });
    if (best !== cur) { cur = best; mark(); }
  }, { passive: true });
  ['pointerdown', 'touchstart', 'focusin'].forEach(t => track.addEventListener(t, arm, { passive: true }));
  [...dots.children].forEach((d, i) => d.addEventListener('click', () => { goTo(i); arm(); }));
  mark();
  arm();
}


/* ---------- quick links ---------- */

function chip(icon, word, target) {
  const attrs = typeof target === 'string'
    ? { href: target }
    : {
      href: `#${target.id}`,
      onclick: event => {
        event.preventDefault();
        target.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
      }
    };
  return h('a', { class: 's2-chip', ...attrs }, iconNode(icon), h('span', {}, word));
}


/* ---------- the guest's nudge / the member's greeting ---------- */

const NUDGE_KEY = 'athanasios.home.nudge.v1';

function nudge() {
  try {
    if (storage('sessionStorage')?.getItem(NUDGE_KEY) === 'off') return null;
  }
  catch { /* it shows */ }
  const card = h('div', { class: 'widget s2-join', 'data-area': 's2-join' },
    h('span', { class: 's2-join__ic', 'aria-hidden': 'true' }, iconNode('user')),
    h('div', {}, h('b', {}, 'اعمل حسابك في دقيقة'), h('small', {}, 'علشان تحجز في الفعاليات، وتتابع نقطك والمسابقات')),
    h('a', { class: 'btn btn--primary btn--small', href: new URL('account/', ROOT).href }, 'اعمل حساب'),
    h('button', {
      class: 's2-join__x', type: 'button', 'aria-label': 'مش دلوقتي',
      onclick: () => {
        try { storage('sessionStorage')?.setItem(NUDGE_KEY, 'off'); } catch { /* gone for this page */ }
        const next = card.nextElementSibling;
        card.remove();
        next?.querySelector('a, button')?.focus({ preventScroll: true });
      }
    }, '×'));
  return card;
}

let summaryAsked = null;

/* «نقطك ٠ · مفيش حجوزات مستنية»: the account's summary, asked once per page */
function fillSummary(line) {
  const session = readSession(storage('localStorage'), storage('sessionStorage'));
  if (!session) return;
  summaryAsked ||= fetch(`${bookApiUrl()}/v1/account/summary`, { headers: { authorization: `Bearer ${session.token}` } })
    .then(res => res.json())
    .then(reply => (reply && reply.ok ? reply : null))
    .catch(() => null);
  summaryAsked.then(reply => {
    if (!reply || !line.isConnected) return;
    const balance = Number(reply.points && reply.points.balance) || 0;
    const coming = (reply.bookings && reply.bookings.coming) || [];
    const waiting = coming.filter(b => b.status === 'pending' || Number(b.left) > 0).length;
    const pts = document.querySelector('.s2-chip[href$="points/"] span');
    if (pts) pts.textContent = `نقاطي: ${arabicDigits(balance)}`;
    line.textContent = `نقطك ${arabicDigits(balance)} · ${waiting ? `${arabicDigits(waiting)} ${waiting === 1 ? 'حجز مستني' : 'حجوزات مستنية'}` : 'مفيش حجوزات مستنية'}`;
  });
}

async function openLook() {
  const session = readSession(storage('localStorage'), storage('sessionStorage'));
  const { openTint } = await import('./tint.js');
  const { toast } = await import('./share.js');
  openTint({
    save: async tint => {
      const res = await fetch(`${bookApiUrl()}/v1/account/prefs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session ? session.token : ''}` },
        body: JSON.stringify({ prefs: { tint } })
      });
      const reply = await res.json().catch(() => ({}));
      if (!reply.ok || reply.tint !== tint) throw new Error(reply.code || 'tint');
    },
    onSaved: tint => toast(`اتحفظ اللون: ${window.SiteLook.tints[tint].name}`)
  });
}

function greeting() {
  const face = readFace(storage('localStorage'), storage('sessionStorage')) || {};
  const name = String(face.firstName || '').trim();
  const line = h('small', {}, ' ');
  const avatar = face.photo && /^data:image\/(?:webp|jpeg);base64,/.test(face.photo)
    ? h('span', { class: 's2-join__av', 'aria-hidden': 'true' }, h('img', { src: face.photo, alt: '' }))
    : h('span', { class: 's2-join__av', 'aria-hidden': 'true' }, name ? Array.from(name)[0] : iconNode('user'));
  const card = h('div', { class: 'widget s2-join s2-join--member', 'data-area': 's2-join' },
    avatar,
    h('div', {}, h('b', {}, name ? `أهلًا يا ${name} 👋` : 'أهلًا بيك 👋'), line),
    window.SiteLook ? h('button', { class: 's2-join__tint', type: 'button', onclick: openLook }, h('i', { 'aria-hidden': 'true' }), 'لون الموقع') : null);
  fillSummary(line);
  return card;
}


/* ---------- «الفعاليات الجاية» ---------- */

function eventCard(item, nowStamp, partners) {
  const entry = entryButton(item, nowStamp);
  const href = entry ? entry.href : `#activity/${item.id}`;
  const open = entry ? null : event => { event.preventDefault(); go('activity', item.id); };
  const when = item.startAt ? parts(item.startAt) : null;
  const tag = (entry && (entry.chip || entry.label)) || '';
  return h('a', { class: 's2-ev', href, onclick: open, 'data-entry': entry ? entry.kind : null },
    item.image ? h('img', { src: item.image.thumb || item.image.src, alt: '', loading: 'lazy', decoding: 'async' }) : null,
    h('div', { class: 's2-ev__body' },
      when ? h('span', { class: 's2-ev__date' }, h('b', {}, arabicDigits(when.d)), h('small', {}, MONTH_NAMES[when.m - 1])) : null,
      h('h3', {}, item.title),
      partnerChip(item, partners),
      when ? h('p', {}, whenLine(item)) : item.subtitle ? h('p', {}, item.subtitle) : null,
      tag ? h('span', { class: 's2-ev__tag' }, tag) : null));
}

/* the rail keeps its section's place on the page: its area (the bottom bar, #to-… links), the admin's banner,
   theme, surface and line under the title */
function adopt(rail, from) {
  for (const key of ['theme', 'surface']) if (from.dataset[key]) rail.dataset[key] = from.dataset[key];
  const banner = from.querySelector(':scope > .section-banner');
  if (banner) {
    rail.prepend(banner);
    rail.classList.add('has-banner');
  }
  const sub = from.querySelector('.section-head__sub');
  if (sub) rail.querySelector('.s2-head').after(sub);
  return rail;
}

function eventsSection(section, items, nowStamp, partners) {
  return h('section', { class: 'widget s2-sec', 'data-area': 'items', 'data-key': section.key, 'aria-labelledby': 's2-events-title' },
    head(section.icon || 'calendar', section.title === 'الفعاليات' || !section.title ? 'الفعاليات الجاية' : section.title, 's2-events-title', 'events/', items.length),
    h('div', { class: 's2-rail s2-rail--ev' }, items.map(item => eventCard(item, nowStamp, partners))));
}


/* ---------- «جديد الأسرة» ---------- */

function newsCard(item, nowStamp) {
  const fresh = item.publishAt && item.publishAt.slice(0, 10) === nowStamp.slice(0, 10);
  return h('a', { class: 's2-nw', href: `#news/${item.id}`, onclick: event => { event.preventDefault(); go('news', item.id); } },
    h('span', { class: 's2-nw__ic', 'aria-hidden': 'true' }, iconNode(item.icon || 'megaphone')),
    h('div', {}, h('b', {}, item.title), item.publishAt ? h('small', {}, relativeTime(item.publishAt, nowStamp)) : null),
    fresh ? h('span', { class: 's2-nw__new' }, 'جديد') : null);
}

function newsRail(section, items, nowStamp) {
  return h('section', { class: 'widget s2-sec', 'data-area': 'news', 'aria-labelledby': 's2-news-title' },
    head(section.icon || 'megaphone', section.title || 'جديد الأسرة', 's2-news-title', 'news/', items.length),
    h('div', { class: 's2-rail s2-rail--nw' }, items.map(item => newsCard(item, nowStamp))));
}


/* ---------- the arrangement ---------- */

/* the phone's bottom bar shows this icon for the section (nav.js placeTab): the one chosen in the admin */
function tabIcon(el, name) {
  if (el && name) el.dataset.tabIcon = name;
  return el;
}

/**
 * flow: render.js's widgets in the admin's order ({ el, kind, section }); returns the page's top-level elements.
 * extra: { content, nowStamp, news (the visible news, the pinned one left out), points (content.points) }
 */
export function arrangeHome(flow, footer, { content, nowStamp, news }) {

  const out = [];
  const featured = flow.filter(f => f.kind === 'featured').map(f => f.el);
  const featuredBanner = (flow.find(f => f.kind === 'featured') || {}).section?.banner;
  const featuredShape = featuredBanner && featuredBanner.w && featuredBanner.h ? featuredBanner : null;
  const meeting = flow.find(f => f.kind === 'meeting');
  const servicesItem = flow.find(f => f.kind === 'items' && f.section && f.section.key === 'services');
  const contact = flow.find(f => f.kind === 'contacts');
  const support = flow.find(f => f.kind === 'support');
  const location = flow.find(f => f.kind === 'location');

  /* Suggestions: the featured cards, then the services that have their own page */
  const servicesSection = servicesItem ? servicesItem.section : {};
  const serviceSlides = servicesItem
    ? visibleItems(content, 'services', nowStamp).filter(item => entryHref(item)).map(item => serviceSlide(item, typeOf(content, item), featuredShape))
    : [];

  if (meeting) meeting.el.id = 's2-meet';
  if (contact) contact.el.id = 's2-contact';
  const mapEl = location && location.el.querySelector('#location-map');
  const member = signedIn();
  const chips = [
    meeting ? chip('calendar', 'الاجتماع الجاي', meeting.el) : null,
    mapEl ? chip('map', 'مكان الاجتماع', location.el) : null,
    // site redesign W5: «المسابقات» opens /competitions/ while it has a competition (open, coming or just ended)
    hasCompetitions(content.competitions, nowStamp) ? chip('trophy', 'المسابقات', new URL('competitions/', ROOT).href) : null,
    content.points ? chip('star', 'نقاطي', new URL(content.points.url, ROOT).href) : null,
    contact ? chip('phone', 'كلّم الخدمة', contact.el) : null
  ];

  let sugg = null;
  if (featured.length || serviceSlides.length) {
    sugg = suggestions(featured, serviceSlides, servicesSection, chips);
    // the bottom bar's icon for it: the admin's choice for the section, else the first featured link's own icon
    tabIcon(sugg, (flow.find(f => f.kind === 'featured') || {}).section?.icon || ((content.featured || [])[0] || {}).icon);
    out.push(sugg);
  }

  /* beside it: the nudge / greeting, then the meeting */
  const side = h('div', { class: 's2-side', 'data-area': 's2-side' }, member ? greeting() : nudge(), meeting ? meeting.el : null);
  if (meeting) tabIcon(side, meeting.section?.icon);
  if (side.children.length) out.push(side);
  // no Suggestions: the quick links still lead the page
  if (!sugg && chips.some(Boolean)) out.unshift(h('nav', { class: 's2-chips s2-chips--alone', 'aria-label': 'اختصارات' }, chips));

  /* the rest in the admin's order */
  let people = null;
  for (const item of flow) {
    if (item.kind === 'featured' || item.kind === 'meeting') continue;
    if (item.kind === 'items' && item.section && item.section.key === 'activities') {
      const list = visibleItems(content, 'activities', nowStamp);
      out.push(tabIcon(list.length ? adopt(eventsSection(item.section, list, nowStamp, content.partners), item.el) : item.el, item.section?.icon));
      continue;
    }
    if (item.kind === 'news') {
      out.push(tabIcon(news.length ? adopt(newsRail(item.section || {}, news, nowStamp), item.el) : item.el, item.section?.icon));
      continue;
    }
    if (item === servicesItem) {
      const sh = item.el.querySelector('.section-head');
      if (sh) {
        sh.classList.add('s2-head');
        sh.append(allLink('services/', item.el.querySelectorAll('.items__list > li').length));
      }
      item.el.querySelector('.items__list')?.classList.add('s2-rail', 's2-rail--sv');
      out.push(tabIcon(item.el, item.section?.icon));
      continue;
    }
    if (item.kind === 'contacts' || item.kind === 'support') {
      if (!people) {
        people = h('div', { class: 's2-people', 'data-area': 's2-people' });
        tabIcon(people, item.section?.icon);
        out.push(people);
      }
      people.append(item.el);
      continue;
    }
    out.push(tabIcon(item.el, item.section?.icon));
  }

  out.push(footer);

  return out;

}


/* after the page is in the DOM: the slides turn, the arrows move their rail */
export function startHome(main) {

  const sugg = main.querySelector('.s2-sugg');
  if (sugg) turnSlides(sugg);
  else clearInterval(slideTimer);

  main.querySelectorAll('.s2-head .s2-arrows button').forEach(b => {
    b.addEventListener('click', () => {
      const rail = b.closest('.widget').querySelector('.s2-rail');
      rail.scrollBy({ left: Number(b.dataset.dir) * rail.clientWidth * 0.8, behavior: reduced.matches ? 'auto' : 'smooth' });
    });
  });

}
