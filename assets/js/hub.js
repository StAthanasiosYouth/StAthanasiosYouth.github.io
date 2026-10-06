/**
 * HUB WIDGETS: pinned banner, news, games, and the detail sheets
 * (news, game, meeting). Everything is built with h() (text only, no HTML
 * from content) and timed in Cairo wall time.
 */

import { h, external } from './dom.js';
import { iconNode } from './icons.js';
import { gameState, isPublished, upcomingSessions } from './schedule.js';
import { formatStamp, relativeTime, untilText, formatDate, formatTime, DAY_NAMES } from './words.js';
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


/* a section's own banner, above its content */
export function sectionBanner(section = {}) {

  if (!section.banner) return null;

  return h('div', { class: 'section-banner' }, picture(section.banner, { sizes: '(min-width: 1024px) 760px, 92vw' }));

}


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


/* =========================================================
   NEWS: «جديد الأسرة»
========================================================= */

export function newsSection(items, nowStamp, section = {}) {

  const lead = items.find(item => item.featured) || null;
  const rest = items.filter(item => item !== lead);

  return h('section', { class: 'widget news', 'data-area': 'news', 'data-theme': section.theme || null, 'aria-labelledby': 'news-title' },
    sectionBanner(section),
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


function newsLead(item, nowStamp, section = {}) {

  return h('article', { class: 'news-lead' },
    h('div', { class: 'news-lead__media' }, posterOrFallback(item.image, section, { sizes: '(min-width: 1024px) 520px, 92vw', icon: 'megaphone' })),
    h('div', { class: 'news-lead__body' },
      h('div', { class: 'news__meta' },
        item.badge ? h('span', { class: 'badge' }, item.badge) : null,
        item.publishAt ? h('span', { class: 'news__date' }, relativeTime(item.publishAt, nowStamp)) : null
      ),
      h('h3', { class: 'news-lead__title' },
        h('a', { class: 'stretched', href: `#news/${item.id}`, onclick: event => { event.preventDefault(); go('news', item.id); } }, item.title)
      ),
      item.summary ? h('p', { class: 'news-lead__summary' }, item.summary) : null,
      h('span', { class: 'news__more', 'aria-hidden': 'true' }, 'اقرأ أكتر', iconNode('arrow'))
    )
  );

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


export function newsSheetContent(item, nowStamp, shareItem) {

  return h('article', { class: 'detail' },
    item.image ? h('div', { class: 'detail__media' }, picture(item.image, { sizes: '(min-width: 720px) 560px, 100vw', eager: true })) : null,
    h('div', { class: 'detail__meta' },
      item.badge ? h('span', { class: 'badge' }, item.badge) : null,
      item.publishAt ? h('span', {}, formatStamp(item.publishAt)) : null
    ),
    item.summary ? h('p', { class: 'detail__lead' }, item.summary) : null,
    item.body ? h('p', { class: 'detail__body' }, item.body) : null,
    h('div', { class: 'detail__actions' },
      item.link ? h('a', { class: 'btn btn--primary', ...external(item.link.url) }, item.link.label, iconNode('external')) : null,
      h('button', { class: 'btn', type: 'button', onclick: () => shareItem(`#news/${item.id}`, item.title) }, iconNode('share'), 'شارك الخبر')
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

  const card = h('article', { class: `game game--${entry.state}${live ? ' game--live' : ''}`, 'data-game': game.id },
    canvas,
    h('div', { class: 'game__media' }, posterOrFallback(game.image, section, { sizes: live ? '(min-width: 1024px) 420px, 92vw' : '160px', icon: 'star' })),
    h('div', { class: 'game__body' },
      stateLabel,
      h('h3', { class: 'game__title' }, game.title),
      game.description && live ? h('p', { class: 'game__desc' }, game.description) : null,
      time,
      h('div', { class: 'game__actions' },
        button,
        inSheet ? null : h('button', { class: 'btn btn--small btn--ghost', type: 'button', onclick: () => go('game', game.id) }, 'التفاصيل')
      )
    )
  );

  let embers = null;

  function update(next) {

    card.className = `game game--${next.state}${live ? ' game--live' : ''}`;
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
    sectionBanner(layoutSection),
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


export function gameSheetContent(entry, shareItem) {

  const { game } = entry;
  const card = gameCard(entry, { inSheet: true });

  return {
    node: h('article', { class: 'detail' },
      game.image ? h('div', { class: 'detail__media' }, picture(game.image, { sizes: '(min-width: 720px) 560px, 100vw', eager: true })) : null,
      game.description ? h('p', { class: 'detail__body' }, game.description) : null,
      h('div', { class: 'detail__game' }, card.el),
      h('div', { class: 'detail__actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => shareItem(`#game/${game.id}`, game.title) }, iconNode('share'), 'شارك التحدي')
      )
    ),
    card
  };

}


/* =========================================================
   MEETING TOPIC + DETAIL
========================================================= */

/* The "موضوع الاجتماع" block inside the meeting widget. */
export function meetingTopic(session, meetingSection = {}) {

  if (!session || !session.topic) return null;

  const poster = session.image || meetingSection.banner || null;

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


export function meetingSheetContent(content, status, nowStamp) {

  const session = status && status.session;
  const meeting = content.meeting;
  const upcoming = upcomingSessions(content.sessions, nowStamp, 5)
    .filter(s => !session || s.date !== session.date);

  const when = status
    ? `${status.daysUntil > 6 ? formatDate(status.date) : DAY_NAMES[status.date.weekday]} الساعة ${formatTime(status.startMinutes)}`
    : '';

  return h('article', { class: 'detail' },
    session && session.image ? h('div', { class: 'detail__media' }, picture(session.image, { sizes: '(min-width: 720px) 560px, 100vw', eager: true })) : null,
    session && session.topic ? h('p', { class: 'detail__kicker' }, 'موضوع الاجتماع') : null,
    session && session.topic ? h('p', { class: 'detail__topic' }, session.topic) : null,
    session && session.speaker ? h('p', { class: 'detail__lead' }, `مع ${session.speaker}`) : null,
    when ? h('p', { class: 'detail__when' }, iconNode('clock'), when) : null,
    session && session.description ? h('p', { class: 'detail__body' }, session.description) : null,
    session && session.note ? h('p', { class: 'detail__note' }, session.note) : null,
    meeting && meeting.note ? h('p', { class: 'detail__note' }, meeting.note) : null,
    upcoming.length
      ? h('section', { class: 'detail__upcoming' },
        h('h3', {}, 'الاجتماعات الجاية'),
        h('ul', {}, upcoming.map(s => h('li', { class: s.status === 'cancelled' ? 'is-cancelled' : '' },
          h('span', { class: 'detail__date' }, formatDate(fromIso(s.date))),
          h('span', {}, s.status === 'cancelled' ? `مفيش اجتماع${s.note ? ` — ${s.note}` : ''}` : (s.topic || 'الاجتماع'))
        )))
      )
      : null
  );

}


function fromIso(iso) {

  const [year, month, day] = iso.split('-').map(Number);

  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };

}
