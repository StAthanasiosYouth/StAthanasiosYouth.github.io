/**
 * SERVICE PAGES AND EVENTS — view (DOM)
 *
 * Text only (dom.js h(): strings become text nodes, never HTML). Every link
 * and picture comes from model.js, already checked. Built from scratch on
 * each render (the admin preview re-renders the whole page); the booking
 * counter only updates its own numbers and the WhatsApp links, so nothing
 * loses focus while counting.
 *
 *   page    hero (cover / muted clip), title, tagline, description, the
 *           video cards (YouTube-style), the team
 *   event   cover hero, kind chip, title, when / where, body, gallery,
 *           «احجز الآن» (prices + optional counter, the window, the
 *           servants' WhatsApp), terms
 *   events  the published events (content.json events[]), upcoming first;
 *           with services and news: the «الكل ‹» pages (lists.js)
 *   partner «بإشراف» (§12): one quiet co-brand line under the title, the
 *           chip on the list's cards (collab.js plays the intro)
 */

import { h } from '../dom.js';
import { formatStamp, formatTime, arabicDigits } from '../words.js';
import { stampToMinutes } from '../schedule.js';
import {
  bookingPhase, entryCta, startCounts, stepCount, canStep, totalOf, seatsOf, money,
  bookingMessage, waWithText, eventHref
} from './model.js';
import { createLists } from './lists.js';


/* ---------- small inline icons (static, trusted markup built as nodes) ---------- */

const ICONS = {
  play: [['M8 5.5v13l10.5-6.5Z', 'fill']],
  clock: ['M12 7.5V12l3 2', 'M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z'],
  map: ['M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z', 'M14.5 9.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z'],
  external: ['M14 4h6v6M20 4l-9 9', 'M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10'],
  arrow: ['M19 12H5', 'm11 6-6 6 6 6'],
  home: ['M4 11 12 4l8 7', 'M6.5 9.5V20h11V9.5'],
  calendar: ['M3.5 7.5a2.5 2.5 0 0 1 2.5-2.5h12a2.5 2.5 0 0 1 2.5 2.5v10.5a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5Z', 'M3.5 9.5h17M8 3v4M16 3v4'],
  users: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M2.5 20a6.5 6.5 0 0 1 13 0', 'M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 20a6.5 6.5 0 0 0-3-5.5'],
  minus: ['M6 12h12'],
  plus: ['M12 6v12M6 12h12'],
  pause: [['M7 5h3.5v14H7ZM13.5 5H17v14h-3.5Z', 'fill']],
  // the service page's own (site redesign S5): the round play, share, «شاهد كاملة ↗»
  'play-round': [['M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z', 'fill']],
  share: ['M15.5 5.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0Z', 'M3.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0Z', 'M15.5 18.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0Z', 'm8.2 10.8 7.6-4M8.2 13.2l7.6 4'],
  'open-full': ['M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4'],
  theatre: ['M4 4.5c2.6 1 5.4 1 8 0v6.2A4 4 0 0 1 8 14.7a4 4 0 0 1-4-4Z', 'M12 9.3c2.6 1 5.4 1 8 0v6.2a4 4 0 0 1-4 4 4 4 0 0 1-4-4'],
  whatsapp: [['M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51-.17-.01-.37-.01-.57-.01-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.06 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35m-5.42 7.4h0a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.23-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.81 11.81 0 0 0 12.05 0C5.5 0 .16 5.33.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.33 11.89-11.89a11.82 11.82 0 0 0-3.48-8.41Z', 'fill']]
};

const SVG = 'http://www.w3.org/2000/svg';

export function icon(name, extra = '') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', `ic ic--${name}${extra ? ` ${extra}` : ''}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const entry of ICONS[name] || []) {
    const [d, kind] = Array.isArray(entry) ? entry : [entry, ''];
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    if (kind === 'fill') path.setAttribute('class', 'ic__fill');
    svg.appendChild(path);
  }
  return svg;
}


/* =========================================================
   WORDS
========================================================= */

const KIND_WORDS = { trip: 'رحلة', conference: 'مؤتمر', funday: 'يوم ترفيهي' };

const sameDay = (a, b) => a.slice(0, 10) === b.slice(0, 10);
const minutesOfDay = value => (stampToMinutes(value) ?? 0) % 1440;

/** «السبت ١٧ أكتوبر من ٧ بالليل لـ ١٠ بالليل» / «من … لحد …» */
export function whenText(startAt, endAt) {
  if (!endAt) return formatStamp(startAt);
  if (sameDay(startAt, endAt)) return `${formatStamp(startAt, { withTime: false })} من ${formatTime(minutesOfDay(startAt))} لـ ${formatTime(minutesOfDay(endAt))}`;
  return `من ${formatStamp(startAt)} لحد ${formatStamp(endAt)}`;
}

/** «الحجز من … لحد …» ('' opensAt = from now; '' closesAt = until the start) */
export function windowText(booking, startAt) {
  const closesAt = booking.closesAt || startAt;
  if (booking.opensAt && closesAt) return `الحجز من ${formatStamp(booking.opensAt)} لحد ${formatStamp(closesAt)}`;
  if (closesAt) return `الحجز مفتوح لحد ${formatStamp(closesAt)}`;
  return booking.opensAt ? `الحجز من ${formatStamp(booking.opensAt)}` : '';
}

const paragraphs = (text, className) => text.split(/\n{2,}/).map(part => h('p', { class: className }, part));


/* =========================================================
   VIEW
========================================================= */

export function createView({ main, live, rootUrl, mediaUrl, onClip }) {

  const homeHref = new URL('index.html', rootUrl).href;

  function announce(message) {
    if (!live) return;
    live.textContent = '';
    setTimeout(() => { live.textContent = message; }, 60);
  }

  function show(state, ...children) {
    main.dataset.state = state;
    main.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    main.replaceChildren(...children);
  }

  function picture(image, { className = '', sizes = '(min-width: 1024px) 1200px, 100vw', eager = false } = {}) {
    if (!image) return null;
    const img = h('img', {
      class: className,
      src: mediaUrl(image.thumb),
      srcset: image.thumb !== image.src ? `${mediaUrl(image.thumb)} 480w, ${mediaUrl(image.src)} 1600w` : null,
      sizes,
      width: image.w,
      height: image.h,
      alt: image.alt || '',
      loading: eager ? null : 'lazy',
      fetchpriority: eager ? 'high' : null,
      decoding: 'async'
    });
    if (image.color) img.style.backgroundColor = image.color;   // CSSOM (the CSP blocks style="")
    return img;
  }

  /* a quiet stand-in when there's no picture: the theme's light and an icon */
  const art = name => h('span', { class: 'art', 'aria-hidden': 'true' }, icon(name, 'art__icon'));

  const homeLink = (label = 'ارجع للموقع') => h('a', { class: 'btn btn--primary', href: homeHref }, icon('home'), label);


  /* ---------- states ---------- */

  function loading() {
    show('loading',
      h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('span', { class: 'skeleton__hero' }), h('span', { class: 'skeleton__line' }), h('span', { class: 'skeleton__line is-short' })),
      h('p', { class: 'visually-hidden' }, 'بنحمّل الصفحة…')
    );
  }

  function unavailable(message = 'الصفحة دي مش متاحة دلوقتي') {
    show('unavailable',
      h('section', { class: 'pg-empty' },
        icon('theatre', 'pg-empty__icon'),
        h('h1', { class: 'pg-empty__title', tabindex: '-1' }, message),
        h('p', { class: 'muted' }, 'ممكن تكون اتشالت أو لسه ما اتنشرتش. شوف الجديد في الموقع.'),
        homeLink()
      )
    );
  }

  function error(message, retry) {
    show('error',
      h('section', { class: 'pg-empty' },
        h('h1', { class: 'pg-empty__title', tabindex: '-1' }, message),
        retry ? h('button', { class: 'btn btn--primary', type: 'button', onclick: retry }, 'جرّب تاني') : null,
        homeLink()
      )
    );
  }


  /* =========================================================
     HERO
  ========================================================= */

  /* the blurred copy behind a banner that doesn't fill the box (its own shape is kept) */
  const ambient = image => h('img', { class: 'phero__ambient', src: mediaUrl(image.thumb || image.src), alt: '', 'aria-hidden': 'true', decoding: 'async' });

  /*
   * A service page's banner: visual only (the words go under it), whole at
   * its own shape on every screen (no crop), height-capped, on a blurred
   * copy of itself; a clip loops muted (its poster under reduced motion).
   */
  function heroMedia(hero, cover, reduced) {

    // a muted looping clip (poster only under reduced motion)
    if (hero && hero.type === 'video') {
      const poster = cover || { src: hero.poster, thumb: hero.poster, w: hero.w, h: hero.h, alt: hero.alt };
      const ar = `${hero.w} / ${hero.h}`;
      if (reduced) return { node: [ambient(poster), picture(poster, { className: 'phero__img', eager: true })], ar: `${poster.w} / ${poster.h}` };
      const fragment = hero.start || hero.end ? `#t=${hero.start}${hero.end ? `,${hero.end}` : ''}` : '';
      const video = h('video', {
        class: 'phero__img phero__video',
        src: `${mediaUrl(hero.src)}${fragment}`,
        poster: mediaUrl(cover ? cover.src : hero.poster),
        width: hero.w,
        height: hero.h,
        muted: true,
        loop: true,
        autoplay: true,
        playsinline: true,
        preload: 'metadata',
        disablepictureinpicture: true,
        'aria-hidden': 'true'
      });
      video.muted = true;
      // a loop between start and end (the fragment only plays it once)
      video.addEventListener('timeupdate', () => {
        if (hero.end && video.currentTime >= hero.end) video.currentTime = hero.start || 0;
      });
      const toggle = h('button', { class: 'phero__toggle', type: 'button', 'aria-label': 'وقّف الفيديو', 'aria-pressed': 'false' }, icon('pause'));
      toggle.addEventListener('click', () => {
        const stop = !video.paused;
        if (stop) video.pause();
        else video.play().catch(() => {});
        toggle.dataset.user = stop ? 'paused' : '';
        toggle.setAttribute('aria-pressed', String(stop));
        toggle.setAttribute('aria-label', stop ? 'شغّل الفيديو' : 'وقّف الفيديو');
        toggle.replaceChildren(icon(stop ? 'play' : 'pause'));
      });
      // only while on screen (battery, data)
      if (typeof IntersectionObserver === 'function') {
        new IntersectionObserver(([entry]) => {
          if (!entry.isIntersecting) video.pause();
          else if (!toggle.dataset.user) video.play().catch(() => {});
        }).observe(video);
      }
      return { node: [ambient(poster), video], toggle, ar };
    }

    const image = hero || cover;
    if (!image) return { node: art('theatre') };
    return { node: [ambient(image), picture(image, { className: 'phero__img', eager: true })], ar: `${image.w} / ${image.h}` };

  }

  /* an event's cover (often a poster with words): whole, at its own shape, on a blurred copy */
  function posterMedia(image) {
    if (!image) return { node: art('calendar') };
    return {
      node: [
        h('img', { class: 'phero__ambient', src: mediaUrl(image.thumb), alt: '', 'aria-hidden': 'true', decoding: 'async' }),
        picture(image, { className: 'phero__img', eager: true })
      ],
      ar: `${image.w} / ${image.h}`
    };
  }

  /*
   * «بإشراف» a partner inside the page (§12): one quiet line under the
   * title — our seal · أسرة البابا أثناسيوس × Brave Under Grace · their
   * letters (transparent, their own colours). The show is collab.js's intro.
   */
  function cobrand(partner) {
    if (!partner) return null;
    const ours = path => new URL(path, rootUrl).href;
    const mark = partner.mark || null;
    const name = h('bdi', { class: 'cobrand__name cobrand__name--partner' }, partner.name.replace(/\s*[–-]\s*B\.U\.G\.?$/, ''));
    // real spaces between the parts (screen readers and copy-paste); «×» is read as «بالتعاون مع»
    return h('p', { class: 'cobrand', 'data-partner': partner.key },
      h('img', { class: 'cobrand__seal', src: ours('assets/img/partners/athanasios-family-240.webp'), width: 240, height: 243, alt: '', decoding: 'async' }),
      ' ',
      h('span', { class: 'cobrand__name' }, 'أسرة البابا أثناسيوس'),
      ' ',
      h('span', { class: 'cobrand__x', 'aria-hidden': 'true' }, '×'),
      ' ',
      h('span', { class: 'visually-hidden' }, 'بالتعاون مع'),
      ' ',
      partner.url ? h('a', { class: 'cobrand__link', href: partner.url, target: '_blank', rel: 'noopener' }, name) : name,
      mark ? ' ' : null,
      mark ? h('img', { class: 'cobrand__mark', src: mediaUrl(mark.src), width: mark.w, height: mark.h, alt: '', decoding: 'async' }) : null
    );
  }

  /* the banner (visual only), then the words under it: kicker, title, lead, the co-brand line, extra */
  function hero({ media, kicker, title, lead, extra, poster = false, banner = false, partner = null }) {
    const box = h('div', { class: 'phero__media' }, media.node, h('span', { class: 'phero__scrim', 'aria-hidden': 'true' }));
    if (media.ar) box.style.setProperty('--ar', media.ar);   // CSSOM (the CSP blocks style="")
    return h('header', { class: `phero${poster ? ' phero--poster' : ''}${banner ? ' phero--banner' : ''}` },
      box,
      media.toggle || null,
      h('div', { class: 'phero__text' },
        kicker || null,
        h('h1', { class: 'phero__title', id: 'page-title', tabindex: '-1' }, title),
        lead ? h('p', { class: 'phero__lead' }, lead) : null,
        cobrand(partner),
        extra || null
      )
    );
  }


  /* =========================================================
     SERVICE PAGE
  ========================================================= */

  function mediaCard(card, index, cards) {

    const isClip = card.source === 'clip';
    const titleId = `m-${card.id}`;

    const trigger = isClip
      ? h('button', { class: 'stretched', type: 'button', 'aria-haspopup': 'dialog', 'data-media': card.id, id: titleId }, card.title)
      : h('a', { class: 'stretched', href: card.fullUrl, target: '_blank', rel: 'noopener', 'data-media': card.id, id: titleId },
        card.title,
        h('span', { class: 'visually-hidden' }, ' (بيفتح في صفحة جديدة)')
      );

    if (isClip) trigger.addEventListener('click', () => onClip(cards, index, trigger));

    // S5: the clip's length, «أحدث عرض» on the first, «شاهد كاملة ↗» (the card's own full link)
    const clipLength = isClip && card.clip && card.clip.end ? Math.max(1, Math.round(card.clip.end - (card.clip.start || 0))) : 0;
    const full = card.fullUrl
      ? h('a', { class: 'svc-full', href: card.fullUrl, target: '_blank', rel: 'noopener' },
        h('span', {}, card.ctaLabel || 'شاهد كاملة'), icon('open-full', 'svc-ic'),
        h('span', { class: 'visually-hidden' }, ' (بيفتح في صفحة جديدة)'))
      : null;

    return h('article', { class: `mcard${isClip ? '' : ' mcard--link'}${index === 0 ? ' svc-latest' : ''}` },
      h('div', { class: 'mcard__media' },
        picture(card.cover, { className: 'mcard__img', sizes: '(min-width: 1024px) 380px, (min-width: 640px) 46vw, 92vw' }),
        h('span', { class: 'mcard__play', 'aria-hidden': 'true' }, icon(isClip ? 'play' : 'external')),
        card.duration ? h('span', { class: 'mcard__dur' }, card.duration) : null,
        clipLength ? h('span', { class: 'svc-len' }, `مقطع · ${clipLength < 60 ? `${arabicDigits(clipLength)} ثانية` : `${arabicDigits(Math.round(clipLength / 60))} دقيقة`}`) : null,
        index === 0 ? h('span', { class: 'svc-new' }, 'أحدث عرض') : null
      ),
      h('div', { class: 'mcard__body' },
        h('h3', { class: 'mcard__title' }, trigger),
        card.text ? h('p', { class: 'mcard__text' }, card.text) : null,
        full
      )
    );

  }

  /* one person, one compact card: picture or initial · name, role (, chips) · WhatsApp */
  function person(p, { chips = null, wa = null, waLabel = 'ابعت على واتساب' } = {}) {
    const initial = Array.from(p.name.replace(/^(أ\.|م\.|د\.|ابونا|أبونا)\s*/, ''))[0] || '؟';
    return h('article', { class: 'person' },
      p.image
        ? h('span', { class: 'person__avatar' }, picture(p.image, { sizes: '56px' }))
        : h('span', { class: 'person__avatar person__avatar--initial', 'aria-hidden': 'true' }, initial),
      h('div', { class: 'person__who' },
        h('h3', { class: 'person__name' }, p.name),
        p.role ? h('p', { class: 'person__role' }, p.role) : null,
        chips
      ),
      wa ? h('a', { class: 'btn btn--wa person__wa', href: wa, target: '_blank', rel: 'noopener', 'aria-label': `${waLabel} لـ${p.name}`, 'data-wa': p.id || '' }, icon('whatsapp'), h('span', { class: 'person__wa-label' }, 'واتساب')) : null
    );
  }

  function page(data, { reduced = false } = {}) {

    const clips = data.media.filter(card => card.source === 'clip');

    /* S5, under the banner: «▶ اتفرّج على أحدث عرض» (the first card, as a tap on it would) and «شارك» */
    let first = null;
    const play = data.media.length
      ? h('button', { class: 'btn btn--primary svc-play', type: 'button' }, h('span', { class: 'svc-ic svc-ic--round' }, icon('play-round')), h('span', {}, 'اتفرّج على أحدث عرض'))
      : null;
    if (play) play.addEventListener('click', () => { if (first) first.click(); });
    const share = h('button', { class: 'btn svc-share', type: 'button' }, icon('share', 'svc-ic'), h('span', {}, 'شارك'));
    share.addEventListener('click', () => {
      const url = location.origin + location.pathname;
      if (navigator.share) navigator.share({ title: document.title, url }).catch(() => {});
      else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
          share.lastChild.textContent = 'اتنسخ اللينك ✓';
          announce('اتنسخ اللينك');
        }).catch(() => {});
      }
    });

    const shows = data.media.length
      ? h('section', { class: 'pg-section', id: 'svc-shows', 'aria-labelledby': 'media-title' },
        h('div', { class: 'pg-head' },
          h('h2', { class: 'pg-head__title', id: 'media-title' }, clips.length ? 'اتفرّج' : 'العروض'),
          h('p', { class: 'pg-head__count' }, clips.length ? `${arabicDigits(clips.length)} ${clips.length >= 3 && clips.length <= 10 ? 'فيديوهات' : 'فيديو'}` : '')
        ),
        h('ul', { class: 'mgrid' }, data.media.map((card, i) => h('li', {}, mediaCard(card, i, data.media))))
      )
      : null;
    if (shows) first = shows.querySelector('[data-media]');

    /* «عن الخدمة»: a titled card, the partner's logo at its foot */
    const p = data.partner;
    const about = data.description
      ? h('section', { class: 'pg-section pg-about', id: 'svc-about', 'aria-labelledby': 'about-title' },
        h('h2', { class: 'pg-head__title svc-h', id: 'about-title' }, 'عن الخدمة'),
        paragraphs(data.description, 'pg-about__p'),
        p && p.logo
          ? h('div', { class: 'svc-partner' },
            h('img', { src: new URL(p.logo.thumb || p.logo.src, rootUrl).href, alt: p.logo.alt || '', decoding: 'async', loading: 'lazy' }),
            h('span', {}, `بالتعاون مع ${p.name || ''}`))
          : null
      )
      : null;

    const team = data.team
      ? h('section', { class: 'pg-section team', id: 'svc-team', 'aria-labelledby': 'team-title' },
        h('div', { class: 'team__intro' },
          icon('users', 'team__icon'),
          h('h2', { class: 'team__title', id: 'team-title' }, data.team.title),
          data.team.text ? h('p', { class: 'team__text' }, data.team.text) : null
        ),
        data.team.people.length ? h('ul', { class: 'people' }, data.team.people.map(p => h('li', {}, person(p, { wa: p.wa })))) : null
      )
      : null;

    /* the section bar that follows the scroll: العروض · عن الخدمة · الفريق */
    const parts = [[shows, 'العروض'], [about, 'عن الخدمة'], [team, 'الفريق']].filter(([el]) => el);
    const tabs = parts.length > 1
      ? h('nav', { class: 'svc-tabs', 'aria-label': 'أقسام الصفحة' }, parts.map(([el, label]) => h('a', { href: `#${el.id}` }, label)))
      : null;

    const article = h('article', { class: 'svc' },
      hero({ media: heroMedia(data.hero, data.cover, reduced), title: data.title, lead: data.tagline, partner: data.partner, banner: true, extra: h('div', { class: 'svc-acts' }, play, share) }),
      tabs,
      shows,
      about,
      team
    );
    show('ready', article);
    if (tabs) spy(tabs);
    moreServices(article, data.slug);

  }

  /* the section bar: the section at the top of the screen is «on» */
  let spyOff = null;
  function spy(tabs) {
    if (spyOff) spyOff();
    const links = [...tabs.querySelectorAll('a')];
    const mark = () => {
      let cur = links[0];
      for (const a of links) {
        const s = document.getElementById(a.getAttribute('href').slice(1));
        if (s && s.getBoundingClientRect().top < 140) cur = a;
      }
      for (const a of links) {
        a.classList.toggle('on', a === cur);
        if (a === cur) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    };
    addEventListener('scroll', mark, { passive: true });
    spyOff = () => removeEventListener('scroll', mark);
    mark();
  }

  /* «خدمات تانية»: the other published service pages (content.json), at the end */
  async function moreServices(article, slug) {
    let pages = [];
    try {
      const res = await fetch(new URL('content.json', rootUrl), { cache: 'no-cache' });
      if (!res.ok) return;
      const { sanitizeContent } = await import('../content.js');
      pages = sanitizeContent(await res.json()).pages.filter(o => o.slug !== slug);
    }
    catch {
      return;
    }
    if (!pages.length || !article.isConnected || article.querySelector('.svc-more')) return;
    article.appendChild(h('section', { class: 'pg-section svc-more', 'aria-labelledby': 'more-title' },
      h('h2', { class: 'pg-head__title svc-h', id: 'more-title' }, 'خدمات تانية'),
      h('ul', { class: 'svc-more__list' }, pages.map(o => h('li', {},
        h('a', { class: 'svc-more__card', href: new URL(`${o.slug}/`, rootUrl).href },
          o.cover ? h('img', { src: mediaUrl(o.cover.thumb || o.cover.src), alt: '', loading: 'lazy', decoding: 'async', width: o.cover.w, height: o.cover.h }) : null,
          h('div', { class: 'svc-more__body' }, h('b', {}, o.title), o.tagline ? h('small', {}, o.tagline) : null),
          h('span', { class: 'svc-more__go', 'aria-hidden': 'true' }, '‹')
        )
      )))
    ));
  }


  /* =========================================================
     EVENT
  ========================================================= */

  function gallery(items) {
    return h('section', { class: 'pg-section', 'aria-labelledby': 'gallery-title' },
      h('h2', { class: 'pg-head__title', id: 'gallery-title' }, 'صور'),
      h('ul', { class: 'gallery' }, items.map(item => h('li', { class: 'gallery__item' },
        item.type === 'video'
          ? h('video', {
            class: 'gallery__media',
            src: `${mediaUrl(item.src)}${item.start || item.end ? `#t=${item.start}${item.end ? `,${item.end}` : ''}` : ''}`,
            poster: mediaUrl(item.poster),
            controls: true,
            playsinline: true,
            preload: 'none',
            width: item.w,
            height: item.h,
            'aria-label': item.alt || 'فيديو'
          })
          : picture(item, { className: 'gallery__media', sizes: '(min-width: 1024px) 380px, 46vw' })
      )))
    );
  }

  /* the «احجز الآن» area while booking is through the servants (online: false) */
  function bookingArea(event, nowStamp) {

    const booking = event.booking;
    const phase = bookingPhase(booking, event.startAt, nowStamp);
    // «إضافة فرد»: people are added one by one in the booking itself — no counter here, just the prices (with their ages)
    const group = booking.pricing.mode === 'group' && !booking.participants;
    const methodLabel = new Map(booking.methods.map(m => [m.key, m.label]));

    let counts = startCounts(booking);
    let touched = false;

    const total = h('output', { class: 'prices__total-n', 'aria-live': 'polite' }, money(totalOf(booking, counts)));
    const steppers = [];
    const waLinks = [];

    function refresh() {
      total.textContent = money(totalOf(booking, counts));
      for (const s of steppers) {
        s.out.textContent = arabicDigits(counts[s.key] || 0);
        s.minus.disabled = !canStep(booking, counts, s.key, -1);
        s.plus.disabled = !canStep(booking, counts, s.key, +1);
      }
      for (const { link, servant } of waLinks) link.href = waWithText(servant.wa, bookingMessage(event, servant, touched ? counts : null));
    }

    function stepper(c) {
      const out = h('output', { class: 'stepper__n' }, arabicDigits(counts[c.key] || 0));
      const minus = h('button', { class: 'stepper__btn', type: 'button', 'aria-label': `قلّل ${c.label}` }, icon('minus'));
      const plus = h('button', { class: 'stepper__btn', type: 'button', 'aria-label': `زوّد ${c.label}` }, icon('plus'));
      const step = delta => () => {
        const next = stepCount(booking, counts, c.key, delta);
        if (next === counts) return;
        counts = next;
        touched = true;
        refresh();
        announce(`${c.label}: ${arabicDigits(counts[c.key])}، الإجمالي ${money(totalOf(booking, counts))}`);
      };
      minus.addEventListener('click', step(-1));
      plus.addEventListener('click', step(+1));
      steppers.push({ key: c.key, out, minus, plus });
      return h('div', { class: 'stepper', role: 'group', 'aria-label': `عدد ${c.label}` }, minus, out, plus);
    }

    const rows = booking.pricing.categories.map(c => h('li', { class: 'price' },
      h('div', { class: 'price__who' },
        h('span', { class: 'price__label' }, c.label),
        booking.participants && (c.ageMin != null || c.ageMax != null)
          ? h('span', { class: 'price__note' }, c.ageMin != null && c.ageMax != null ? `من ${arabicDigits(c.ageMin)} لـ ${arabicDigits(c.ageMax)} سنة` : c.ageMin != null ? `من ${arabicDigits(c.ageMin)} سنة` : `لحد ${arabicDigits(c.ageMax)} سنة`)
          : c.note ? h('span', { class: 'price__note' }, c.note) : null
      ),
      h('span', { class: 'price__amount' }, money(c.price)),
      group && c.min !== c.max ? stepper(c) : group ? h('span', { class: 'stepper stepper--fixed' }, arabicDigits(c.min)) : null
    ));

    const STATE = {
      before: ['is-before', 'الحجز لسه ما فتحش', 'للاستفسار كلّم خادم من دول على واتساب'],
      open: ['is-open', 'الحجز مفتوح', 'للحجز كلّم خادم من دول على واتساب'],
      closed: ['is-closed', 'الحجز اتقفل', 'لو عندك سؤال كلّم خادم من دول على واتساب']
    }[phase];

    const servants = booking.servants.map(s => {
      const chips = s.methods.length
        ? h('ul', { class: 'chips', 'aria-label': 'طرق الدفع' }, s.methods.map(k => h('li', { class: 'chip' }, methodLabel.get(k))))
        : null;
      const card = person(s, { chips, wa: s.wa ? waWithText(s.wa, bookingMessage(event, s)) : null });
      const link = card.querySelector('.btn--wa');
      if (link) waLinks.push({ link, servant: s });
      return h('li', {}, card);
    });

    const pay = booking.payment;
    const payText = pay.mode === 'installments'
      ? `تقدر تدفع على دفعات: أول دفعة ${pay.minFirst ? `${money(pay.minFirst)} على الأقل` : 'باللي تقدر عليه'}${pay.finalDueAt ? `، والباقي قبل ${formatStamp(pay.finalDueAt)}` : ''}.`
      : 'الدفع كامل مع الحجز.';

    const section = h('section', { class: `pg-section book ${STATE[0]}`, id: 'book', 'aria-labelledby': 'book-title', 'data-phase': phase },
      h('div', { class: 'book__head' },
        h('h2', { class: 'book__title', id: 'book-title', tabindex: '-1' }, 'احجز الآن'),
        h('p', { class: 'book__state' }, STATE[1])
      ),
      windowText(booking, event.startAt) ? h('p', { class: 'book__window' }, icon('calendar'), windowText(booking, event.startAt)) : null,
      h('div', { class: 'prices' },
        group ? h('p', { class: 'prices__hint' }, 'حدد العدد وهنحسبلك الإجمالي (اختياري).') : null,
        h('ul', { class: 'prices__list', 'aria-label': 'الأسعار' }, rows),
        group ? h('p', { class: 'prices__total' }, h('span', {}, 'الإجمالي'), total) : null,
        group && booking.perBookingMax ? h('p', { class: 'prices__note' }, `أقصى عدد في الحجز الواحد ${arabicDigits(booking.perBookingMax)}.`) : null
      ),
      h('p', { class: 'book__pay' }, payText),
      booking.capacity ? h('p', { class: 'book__cap' }, 'الأماكن محدودة، احجز بدري.') : null,
      servants.length && booking.contactOnPage !== false
        ? [h('p', { class: 'book__line' }, STATE[2]), h('ul', { class: 'people people--servants' }, servants)]
        : null
    );

    refresh();
    return { node: section, phase };

  }

  function event(data, nowStamp, { reduced = false } = {}) {

    const booking = data.booking ? bookingArea(data, nowStamp) : null;
    const kind = data.kindLabel || KIND_WORDS[data.kind] || '';

    const jump = booking
      ? h('button', { class: 'btn btn--primary phero__cta', type: 'button' }, booking.phase === 'open' ? 'احجز الآن' : 'الأسعار والحجز', icon('arrow'))
      : null;
    if (jump) {
      jump.addEventListener('click', () => {
        const target = document.getElementById('book-title');
        target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        target.focus({ preventScroll: true });
      });
    }

    show('ready',
      h('article', { class: 'evt' },
        hero({
          media: posterMedia(data.cover),
          poster: true,
          kicker: kind ? h('p', { class: 'chip chip--kind' }, kind) : null,
          title: data.title,
          lead: data.summary,
          extra: jump,
          partner: data.partner
        }),

        h('section', { class: 'facts', 'aria-label': 'المعاد والمكان' },
          h('p', { class: 'fact' }, icon('clock'), h('span', {}, whenText(data.startAt, data.endAt))),
          data.location
            ? h('p', { class: 'fact' }, icon('map'),
              h('span', {}, data.location.name),
              data.location.url ? h('a', { class: 'fact__link', href: data.location.url, target: '_blank', rel: 'noopener' }, 'افتح الخريطة', h('span', { class: 'visually-hidden' }, ' (بيفتح في صفحة جديدة)')) : null
            )
            : null
        ),

        data.body ? h('section', { class: 'pg-section pg-about', 'aria-label': 'التفاصيل' }, paragraphs(data.body, 'pg-about__p')) : null,

        data.gallery.length ? gallery(data.gallery) : null,

        booking ? booking.node : null,

        data.terms
          ? h('section', { class: 'pg-section terms', 'aria-labelledby': 'terms-title' },
            h('h2', { class: 'pg-head__title', id: 'terms-title' }, 'الشروط'),
            paragraphs(data.terms, 'terms__p')
          )
          : null
      )
    );

    return { phase: booking ? booking.phase : '' };

  }


  // «الكل ‹» (S2): the events, the services and the news
  const lists = createLists({ show, picture, rootUrl, homeHref, announce });

  return { loading, unavailable, error, page, event, events: lists.events, services: lists.services, news: lists.news, announce };

}
