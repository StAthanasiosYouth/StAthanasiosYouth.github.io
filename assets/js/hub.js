/**
 * HUB WIDGETS: pinned banner, news, games, the meeting topic, section
 * banners. Built with h() (text only, no HTML from content), timed in
 * Cairo wall time. The sheets' content is in detail.js (loaded with them).
 */

import { h, external } from './dom.js';
import { iconNode } from './icons.js';
import { gameState, isPublished } from './schedule.js';
import { formatStamp, relativeTime, untilText, formatTime } from './words.js';
import { go } from './router.js';
import { particles, swapText } from './motion.js';


/* =========================================================
   IMAGES
========================================================= */

export function picture(image, { sizes = '(min-width: 1024px) 360px, 92vw', className = '', eager = false } = {}) {

  if (!image) return null;

  const img = h('img', {
    class: className,
    src: image.thumb,
    srcset: image.thumb !== image.src ? `${image.thumb} 480w, ${image.src} 1600w` : null,
    sizes,
    width: image.w,
    height: image.h,
    alt: image.alt || '',
    loading: eager ? null : 'lazy',
    decoding: 'async'
  });

  // the picture's own colour while it loads (CSSOM: the CSP blocks style="")
  if (image.color) img.style.backgroundColor = image.color;

  return img;

}


/*
 * An item's picture, never an empty box: its own poster, else its
 * section's banner, else built-in art in the section's colour.
 */
export function posterOrFallback(image, section = {}, options = {}) {

  if (image) return picture(image, options);
  if (section.banner) return picture(section.banner, options);

  return art(section, options.icon);

}


/* built-in art: the section's colour, a quiet cross lattice, its icon */
export function art(section = {}, iconName = '') {

  return h('span', { class: 'art', 'data-theme': section.theme || null, 'aria-hidden': 'true' },
    h('span', { class: 'art__glow' }),
    iconNode(section.icon || iconName || 'cross', 'art__icon')
  );

}


/*
 * A section's own banner, above its content. Banners are often text-heavy
 * (the admin's designed artwork), so the slot follows the banner's own
 * shape (--banner-ar, main.css), within a sensible height range. When the
 * slot still differs noticeably from the banner (very tall or very wide
 * artwork, a capped band on desktop), the whole banner is shown (contain)
 * on an intentional surround: the same picture blurred (full tier) or a
 * light in its colour. A small difference just fills the slot (cover).
 */
const BANNER_SIZES = '(min-width: 1024px) 760px, 92vw';

const bannerFit = typeof ResizeObserver === 'function'
  ? new ResizeObserver(entries => {
    for (const { target, contentRect } of entries) {
      // a re-render replaced it (it reports a last, empty size): let it go
      if (!target.isConnected) { bannerFit.unobserve(target); continue; }
      if (!contentRect.width || !contentRect.height) continue;
      const slot = contentRect.width / contentRect.height;
      const off = Math.abs(slot / Number(target.dataset.ar) - 1);
      target.dataset.fit = off < 0.035 ? 'cover' : 'contain';
    }
  })
  : null;

export function sectionBanner(section = {}) {

  const banner = section.banner;

  if (!banner) return null;

  const ratio = banner.w && banner.h ? banner.w / banner.h : 16 / 6;

  const img = picture(banner, { sizes: BANNER_SIZES, className: 'section-banner__img' });

  const wrap = h('div', { class: 'section-banner', 'data-ar': ratio.toFixed(4), 'data-fit': 'cover' },
    img,
    // the surround (blurred anyway: the thumbnail; lazy, so only fetched when it shows)
    h('img', { class: 'section-banner__ambient', src: banner.thumb, alt: '', 'aria-hidden': 'true', loading: 'lazy', decoding: 'async' })
  );

  // the full-size file only when the banner comes near the screen (a phone's
  // first visit gets the thumbnail; a banner on the first screen is sharp at once)
  const srcset = img.getAttribute('srcset');
  if (srcset && bannerNear) {
    img.removeAttribute('srcset');
    img.dataset.srcset = srcset;
    bannerNear.observe(img);
  }

  // CSSOM (the CSP blocks style=""): the banner's own shape and colour
  wrap.style.setProperty('--banner-ar', ratio.toFixed(4));
  if (banner.color) wrap.style.setProperty('--tint', banner.color);
  bannerFit?.observe(wrap);

  return wrap;

}

/* right after the page is built (render.js): a banner already on the first
   screen gets its full-size file before the browser even fetches the
   thumbnail (one download, sharp at once) */
export function sharpenVisibleBanners(root) {

  for (const img of root.querySelectorAll('.section-banner__img[data-srcset]')) {
    const r = img.getBoundingClientRect();
    if (r.top < innerHeight + 80 && r.bottom > -80 && !img.srcset) {
      img.srcset = img.dataset.srcset;
      bannerNear?.unobserve(img);
    }
  }

}

const bannerNear = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting && target.isConnected) continue;
      bannerNear.unobserve(target);
      if (isIntersecting) target.srcset = target.dataset.srcset;
    }
  }, { rootMargin: '80px 0px' })
  : null;


/* =========================================================
   VISIBILITY
========================================================= */

export function visibleNews(content, nowStamp) {

  return content.news.filter(item => isPublished(item, nowStamp));

}


export function gameStates(content, nowStamp) {

  return content.games
    .map(game => ({ game, ...gameState(game, nowStamp) }))
    .filter(item => item.state !== 'hidden');

}


/* =========================================================
   PINNED BANNER (replaces the legacy announcement)
========================================================= */

const BANNER_LOOK = {
  info: { icon: 'megaphone', label: 'إعلان' },
  alert: { icon: 'alert', label: 'تنبيه' },
  celebrate: { icon: 'sparkle', label: 'مناسبة' }
};

export function bannerWidget(item) {

  const look = BANNER_LOOK[item.tone] || BANNER_LOOK.info;
  const hasDetails = item.body || item.image;

  return h('section', { class: `widget announcement announcement--${item.tone}`, 'data-area': 'announcement', 'aria-label': look.label },
    h('span', { class: 'announcement__icon', 'aria-hidden': 'true' }, iconNode(look.icon)),
    h('div', { class: 'announcement__body' },
      h('span', { class: 'announcement__label' }, look.label),
      h('p', { class: 'announcement__text' }, item.title),
      item.summary ? h('p', { class: 'announcement__sub' }, item.summary) : null
    ),
    hasDetails
      ? h('button', { class: 'btn btn--small', type: 'button', onclick: () => go('news', item.id) }, 'التفاصيل', iconNode('arrow'))
      : item.link
        ? h('a', { class: 'btn btn--small', ...external(item.link.url) }, item.link.label, iconNode('arrow'))
        : null
  );

}


/* «شكل العرض» — one engine for every picture card (news lead, games, items):
   compact | side (wide cards, else stack) | banner | stack. '' = auto by the
   picture: ≥ 1.9 wide → banner; else small cards: landscape → side on wide
   screens, otherwise compact; big cards (big): side on wide screens, stack on
   phones. displayMobile '' = as on desktop. */
const LAYOUTS = ['compact', 'side', 'banner', 'stack'];
const WIDE = typeof matchMedia === 'function' ? matchMedia('(min-width: 640px)') : null;

export function cardLayout(item, image, wide, big = false) {
  const r = image && image.w && image.h ? image.w / image.h : 0;
  const pick = mode => (LAYOUTS.includes(mode) ? mode : r >= 1.9 ? 'banner' : big ? (wide && r ? 'side' : 'stack') : wide && r >= 1.15 ? 'side' : 'compact');
  return pick(wide || !LAYOUTS.concat('auto').includes(item.displayMobile) ? item.display : item.displayMobile);
}

/* card, its picture box, its words: the layout classes, the picture's shape (--r) and colour (CSSOM: CSP) */
export function layCard(card, media, body, item, image, big = false) {
  const d = cardLayout(item, image, true, big);
  const m = cardLayout(item, image, false, big);
  const r = image && image.w && image.h ? image.w / image.h : 0.8;
  card.classList.add('lay', `is-${WIDE && !WIDE.matches ? m : d}`);
  card.dataset.d = d;
  card.dataset.m = m;
  media.classList.add('lay__media');
  body.classList.add('lay__body');
  media.style.setProperty('--r', String(Math.round(Math.min(6, Math.max(0.4, r)) * 1000) / 1000));
  if (image && image.color) media.style.setProperty('--fill', image.color);
  // the file for the size it shows at: a small card the thumbnail, a wide one the full picture
  const img = media.querySelector('img[srcset]');
  const at = small => (small ? '150px' : '92vw');
  if (img) img.sizes = `(min-width: 1024px) ${d === 'compact' ? '150px' : '1040px'}, (min-width: 640px) ${at(d === 'compact')}, ${at(m === 'compact')}`;
  return card;
}

// a turned tablet: each card swaps to its other layout
if (WIDE) WIDE.addEventListener('change', () => document.querySelectorAll('.lay[data-d]').forEach(card => { card.classList.remove(`is-${card.dataset.d}`, `is-${card.dataset.m}`); card.classList.add(`is-${WIDE.matches ? card.dataset.d : card.dataset.m}`); }));


/* =========================================================
   NEWS: «جديد الأسرة»
========================================================= */

export function newsSection(items, nowStamp, section = {}) {

  const lead = items.find(item => item.featured) || null;
  const rest = items.filter(item => item !== lead);

  return h('section', { class: 'widget news', 'data-area': 'news', 'data-theme': section.theme || null, 'aria-labelledby': 'news-title' },
    h('div', { class: 'section-head' },
      h('h2', { class: 'widget__title', id: 'news-title' }, iconNode(section.icon || 'megaphone'), section.title || 'جديد الأسرة'),
      section.subtitle ? h('p', { class: 'section-head__sub' }, section.subtitle) : null
    ),
    lead ? newsLead(lead, nowStamp, section) : null,
    rest.length
      ? h('ul', { class: 'news__rail', 'aria-label': 'أخبار تانية' }, rest.map(item => h('li', {}, newsCard(item, nowStamp, section))))
      : null
  );

}


export function newsLead(item, nowStamp, section = {}) {

  const media = h('div', { class: 'news-lead__media' }, posterOrFallback(item.image, section, { sizes: '(min-width: 1024px) 520px, 92vw', icon: 'megaphone' }));
  const body = h('div', { class: 'news-lead__body' },
      h('div', { class: 'news__meta' },
        item.badge ? h('span', { class: 'badge' }, item.badge) : null,
        item.publishAt ? h('span', { class: 'news__date' }, relativeTime(item.publishAt, nowStamp)) : null
      ),
      h('h3', { class: 'news-lead__title' },
        h('a', { class: 'stretched', href: `#news/${item.id}`, onclick: event => { event.preventDefault(); go('news', item.id); } }, item.title)
      ),
      item.summary ? h('p', { class: 'news-lead__summary' }, item.summary) : null,
      h('span', { class: 'news__more', 'aria-hidden': 'true' }, 'اقرأ أكتر', iconNode('arrow'))
  );

  return layCard(h('article', { class: 'news-lead' }, media, body), media, body, item, item.image || section.banner, true);

}


function newsCard(item, nowStamp, section = {}) {

  return h('article', { class: 'news-card' },
    h('div', { class: 'news-card__media' }, posterOrFallback(item.image, section, { sizes: '220px', icon: 'megaphone' })),
    h('div', { class: 'news-card__body' },
      h('div', { class: 'news__meta' },
        item.badge ? h('span', { class: 'badge' }, item.badge) : null,
        item.publishAt ? h('span', { class: 'news__date' }, relativeTime(item.publishAt, nowStamp)) : null
      ),
      h('h3', { class: 'news-card__title' },
        h('a', { class: 'stretched', href: `#news/${item.id}`, onclick: event => { event.preventDefault(); go('news', item.id); } }, item.title)
      ),
      item.summary ? h('p', { class: 'news-card__summary' }, item.summary) : null
    )
  );

}


/* =========================================================
   GAMES: «تحديات وألعاب»
========================================================= */

function gameTimeText(entry) {

  const { game, state } = entry;

  if (state === 'soon') return `تبدأ ${formatStamp(game.startAt)} — ${untilText(entry.minutesUntil)}`;
  if (state === 'open') return `شغالة لحد ${formatTime(stampMinutes(game.endAt))} — فاضل ${untilText(entry.minutesLeft).replace(/^بعد /, '')}`;

  return `انتهت ${formatStamp(game.endAt)}`;

}


function stampMinutes(stamp) {

  const [hh, mm] = stamp.slice(11, 16).split(':').map(Number);

  return hh * 60 + mm;

}


const STATE_LABEL = {
  soon: 'قريبًا',
  open: 'اللعبة جاهزة دلوقتي 🔥',
  ended: 'انتهت'
};


/**
 * One game card. Returns { el, update(entry) } so the countdown can tick
 * without rebuilding the card. Live cards get embers and a moving rim.
 */
export function gameCard(entry, { live = false, inSheet = false, section = {} } = {}) {

  const { game } = entry;
  const stateLabel = h('span', { class: 'game__state' });
  const time = h('p', { class: 'game__time' });
  const button = h('a', { class: 'btn game__play' });

  const canvas = live ? h('canvas', { class: 'game__embers', 'aria-hidden': 'true' }) : null;

  const media = h('div', { class: 'game__media' }, posterOrFallback(game.image, section, { sizes: live ? '(min-width: 1024px) 420px, 92vw' : '160px', icon: 'star' }));
  const body = h('div', { class: 'game__body' },
      stateLabel,
      h('h3', { class: 'game__title' }, game.title),
      game.description && live ? h('p', { class: 'game__desc' }, game.description) : null,
      time,
      h('div', { class: 'game__actions' },
        button,
        inSheet ? null : h('button', { class: 'btn btn--small btn--ghost', type: 'button', onclick: () => go('game', game.id) }, 'التفاصيل')
      )
  );
  const card = layCard(h('article', { class: `game game--${entry.state}${live ? ' game--live' : ''}`, 'data-game': game.id }, canvas, media, body), media, body, game, game.image || section.banner, live);
  const layout = [...card.classList].filter(c => c === 'lay' || c.startsWith('is-'));

  let embers = null;

  function update(next) {

    card.className = `game game--${next.state}${live ? ' game--live' : ''}`;
    card.classList.add(...layout);
    swapText(stateLabel, STATE_LABEL[next.state]);
    swapText(time, gameTimeText(next));

    if (next.state === 'open') {
      button.className = 'btn btn--primary game__play';
      button.removeAttribute('aria-disabled');
      button.setAttribute('href', game.url);
      button.setAttribute('target', '_blank');
      button.setAttribute('rel', 'noopener');
      button.textContent = game.buttonLabel || 'ابدأ اللعب';
    }
    else {
      button.className = 'btn game__play';
      button.removeAttribute('href');
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('role', 'link');
      button.textContent = next.state === 'soon' ? 'قريبًا' : 'انتهت';
    }

    if (canvas && next.state === 'open' && !embers) embers = particles(canvas, 'ember');
    if (embers && next.state !== 'open') { embers.stop(); embers = null; }

  }

  stateLabel.textContent = STATE_LABEL[entry.state];
  time.textContent = gameTimeText(entry);
  update(entry);

  return { el: card, update, id: game.id };

}


/* «تحديات وألعاب أسرة البابا أثناسيوس للشباب» logo (assets/img/games-logo-*.webp) */
function gamesLogo(className, sizes) {

  return h('img', {
    class: className,
    src: 'assets/img/games-logo-480.webp',
    srcset: 'assets/img/games-logo-480.webp 480w, assets/img/games-logo-960.webp 960w',
    sizes,
    width: 480,
    height: 331,
    alt: 'تحديات وألعاب أسرة البابا أثناسيوس للشباب',
    decoding: 'async'
  });

}


export function gamesSection(entries, layoutSection = {}) {

  const cards = entries.map(entry => gameCard(entry, { section: layoutSection }));

  const section = h('section', { class: 'widget games', 'data-area': 'games', 'data-theme': layoutSection.theme || null, 'aria-labelledby': 'games-title' },
    h('h2', { class: 'games__head', id: 'games-title' }, gamesLogo('games__logo', '(min-width: 1024px) 300px, 240px')),
    layoutSection.subtitle ? h('p', { class: 'section-head__sub games__sub' }, layoutSection.subtitle) : null,
    h('div', { class: 'games__list' }, cards.map(card => card.el))
  );

  return { el: section, cards };

}


export function liveGameWidget(entry, section = {}) {

  const card = gameCard(entry, { live: true, section });
  const widget = h('section', { class: 'widget live-game', 'data-area': 'live-game', 'aria-label': `تحدي شغال دلوقتي: ${entry.game.title}` },
    h('div', { class: 'live-game__brand' }, gamesLogo('live-game__logo', '150px')),
    card.el
  );

  return { el: widget, cards: [card] };

}


/* =========================================================
   MEETING TOPIC + DETAIL
========================================================= */

/* The "موضوع الاجتماع" block inside the meeting widget. (The section's
   banner is on the meeting card itself now, so it isn't repeated here.) */
export function meetingTopic(session) {

  if (!session || !session.topic) return null;

  const poster = session.image || null;

  return h('button', { class: 'topic', type: 'button', onclick: () => go('meeting') },
    poster ? h('span', { class: 'topic__poster' }, picture(poster, { sizes: '72px' })) : null,
    h('span', { class: 'topic__text' },
      h('span', { class: 'topic__label' }, iconNode('book'), 'موضوع الاجتماع'),
      h('span', { class: 'topic__title' }, session.topic),
      session.speaker
        ? h('span', { class: 'topic__speaker' }, iconNode('users'), h('span', {}, `مع ${session.speaker}`))
        : null
    ),
    iconNode('arrow', 'topic__go')
  );

}
