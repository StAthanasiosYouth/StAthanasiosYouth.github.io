/**
 * RENDER
 *
 * Builds the widgets from sanitized content. Widget order in the DOM follows
 * the agreed priority (mobile reads top to bottom):
 *   hero → meeting → announcement → featured → location → link sections
 *   → service contact → technical support → share → footer
 */

import { h, external } from './dom.js';
import { iconNode, isBrandIcon } from './icons.js';
import { meetingStatus, fromDayNumber, isWithinWindow, calendarDates } from './schedule.js';
import { describeMeeting, formatDate, DAY_SHORT } from './words.js';
import { bannerWidget, newsSection, gamesSection, liveGameWidget, meetingTopic, visibleNews, gameStates } from './hub.js';
import { updateBell, visibleNotifications } from './bell.js';
import { wake } from './motion.js';
import { play } from './sound.js';


/* =========================================================
   HERO
========================================================= */

export function updateHero(site) {

  const nameEl = document.getElementById('site-name');
  const taglineEl = document.getElementById('site-tagline');

  if (site.name) {

    const words = site.name.split(/\s+/);

    // long names: the first three words lead, the rest sit underneath
    if (words.length > 5) {
      nameEl.className = 'hero__name';
      nameEl.replaceChildren(
        h('span', { class: 'hero__name-lead' }, words.slice(0, 3).join(' ')),
        ' ',
        h('span', { class: 'hero__name-rest' }, words.slice(3).join(' '))
      );
    }
    else {
      nameEl.className = 'hero__name hero__name--single';
      nameEl.textContent = site.name;
    }

    document.title = site.name;

  }

  taglineEl.textContent = site.tagline;
  taglineEl.hidden = !site.tagline;

}


/* =========================================================
   MEETING
========================================================= */

/* sessions-only setups (no weekly rule) still get a meeting widget */
const NO_WEEKLY = { title: 'الاجتماع', day: null, time: '', durationMinutes: null, note: '', skipDates: [], ics: '' };

function meetingWidget(content, now) {

  const meeting = content.meeting || NO_WEEKLY;

  const headline = h('p', { class: 'meeting__headline' });
  const detail = h('p', { class: 'meeting__detail' });
  const week = h('ol', { class: 'week', 'aria-hidden': 'true' });
  const note = meeting.note ? h('p', { class: 'meeting__note' }, meeting.note) : null;
  const skipNote = h('p', { class: 'meeting__note meeting__note--skip', hidden: true });
  const topicSlot = h('div', { class: 'meeting__topic' });
  let lastState = null;
  let lastTopicKey = null;

  const googleLink = h('a', { class: 'btn btn--small', ...external('https://calendar.google.com/') },
    iconNode('calendar'),
    'Google Calendar'
  );

  const calendarMenu = h('div', { class: 'cal-menu', id: 'cal-menu', hidden: true },
    googleLink,
    meeting.ics
      ? h('a', { class: 'btn btn--small', href: meeting.ics, type: 'text/calendar' },
        iconNode('download'),
        'iPhone / Outlook / تقويم تاني'
      )
      : null
  );

  const calendarToggle = h('button', {
    class: 'btn btn--small',
    type: 'button',
    'aria-expanded': 'false',
    'aria-controls': 'cal-menu',
    onclick: () => {
      const open = calendarMenu.hidden;
      calendarMenu.hidden = !open;
      calendarToggle.setAttribute('aria-expanded', String(open));
    }
  },
  iconNode('calendar-plus'),
  'أضف للتقويم'
  );

  const section = h('section', { class: 'widget meeting', 'data-area': 'meeting', 'aria-labelledby': 'meeting-title' },
    h('div', { class: 'meeting__top' },
      h('h2', { class: 'widget__title', id: 'meeting-title' }, iconNode('clock'), meeting.title),
      meeting.day !== null ? h('span', { class: 'meeting__repeat' }, `كل ${DAY_SHORT[meeting.day]}`) : null
    ),
    headline,
    detail,
    note,
    skipNote,
    topicSlot,
    week,
    h('div', { class: 'meeting__actions' }, calendarToggle, calendarMenu)
  );

  function update(currentNow) {

    const status = meetingStatus(content.meeting, currentNow, content.sessions);

    if (!status) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    const words = describeMeeting(status);
    const live = status.state === 'live';

    headline.replaceChildren(
      live ? h('span', { class: 'live-dot', 'aria-hidden': 'true' }) : '',
      words.headline
    );

    detail.textContent = words.detail;
    section.classList.toggle('meeting--live', live);

    // went live while someone was looking
    if (live && lastState && lastState !== 'live') wake(section);
    lastState = status.state;

    if (status.skipped.length) {
      const first = status.skipped[0];
      const cancelled = (content.sessions || []).find(s => s.date === first && s.status === 'cancelled');
      skipNote.replaceChildren(iconNode('alert'), `مفيش اجتماع ${formatDate(fromDayNumber(dayNumberOf(first)))}${cancelled && cancelled.note ? ` — ${cancelled.note}` : ''}`);
      skipNote.hidden = false;
    }
    else {
      skipNote.hidden = true;
    }

    // the topic block appears when its session becomes visible
    const session = status.session;
    const topicKey = session ? `${session.date}|${session.topic}|${session.speaker}` : '';
    if (topicKey !== lastTopicKey) {
      topicSlot.replaceChildren(meetingTopic(session) || '');
      lastTopicKey = topicKey;
    }

    currentStatus = status;

    const skipDates = new Set([
      ...meeting.skipDates,
      ...(content.sessions || []).filter(s => s.status === 'cancelled').map(s => s.date)
    ]);
    const meetingOffset = live ? 0 : status.daysUntil;

    week.replaceChildren(...Array.from({ length: 7 }, (_, offset) => {
      const day = fromDayNumber(currentNow.dayNumber + offset);
      const classes = ['week__day'];
      if (offset === 0) classes.push('is-today');
      if (offset === meetingOffset) classes.push('is-meeting');
      if (offset > 0 && offset < meetingOffset) classes.push('is-between');
      if (skipDates.has(day.iso)) classes.push('is-skipped');
      return h('li', { class: classes.join(' ') },
        h('span', {}, offset === 0 ? 'النهارده' : DAY_SHORT[day.weekday]),
        h('span', { class: 'week__dot' })
      );
    }));

    const place = content.location ? [content.location.name, content.location.address].filter(Boolean).join('، ') : '';
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `${meeting.title} — ${content.site.name}`,
      dates: calendarDates(status),
      ctz: content.timezone,
      details: [meeting.note, content.site.name].filter(Boolean).join('\n')
    });
    if (meeting.day !== null) params.set('recur', `RRULE:FREQ=WEEKLY;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][meeting.day]}`);
    if (place) params.set('location', place);

    googleLink.href = `https://calendar.google.com/calendar/render?${params}`;

  }

  update(now);

  return { el: section, update };

}


function dayNumberOf(iso) {

  const [y, m, d] = iso.split('-').map(Number);

  return Math.round(Date.UTC(y, m - 1, d) / 86400000);

}


/* =========================================================
   ANNOUNCEMENT
========================================================= */

const ANNOUNCEMENT_LOOK = {
  info: { icon: 'megaphone', label: 'إعلان' },
  alert: { icon: 'alert', label: 'تنبيه' },
  celebrate: { icon: 'sparkle', label: 'مناسبة' }
};

function announcementWidget(announcement) {

  const look = ANNOUNCEMENT_LOOK[announcement.tone];

  return h('section', { class: `widget announcement announcement--${announcement.tone}`, 'data-area': 'announcement', 'aria-label': look.label },
    h('span', { class: 'announcement__icon', 'aria-hidden': 'true' }, iconNode(look.icon)),
    h('div', { class: 'announcement__body' },
      h('span', { class: 'announcement__label' }, look.label),
      h('p', { class: 'announcement__text' }, announcement.text)
    ),
    announcement.link
      ? h('a', { class: 'btn btn--small', ...external(announcement.link.url) },
        announcement.link.label,
        iconNode('arrow')
      )
      : null
  );

}


/* =========================================================
   FEATURED SERVICE
========================================================= */

function featuredWidget(link) {

  return h('article', { class: 'widget featured', 'data-area': 'featured' },
    h('div', { class: 'featured__art', 'aria-hidden': 'true' }, iconNode(link.icon)),
    h('div', { class: 'featured__body' },
      h('h2', { class: 'featured__title' },
        h('a', { class: 'stretched', ...external(link.url) }, link.title),
        link.badge ? h('span', { class: 'badge' }, link.badge) : null
      ),
      link.subtitle ? h('p', { class: 'featured__text' }, link.subtitle) : null,
      h('span', { class: 'featured__cta', 'aria-hidden': 'true' }, link.cta || 'افتح', iconNode('arrow'))
    )
  );

}


/* =========================================================
   LOCATION
========================================================= */

/* A stylized, not-to-scale map: Red Sea hills to the west, the coast and
   the sea to the east, a pin for the church. Static, trusted markup. */
const MAP_ART = `
<svg class="mapart" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="mapart-sea" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#0b3f4f"/>
      <stop offset="1" stop-color="#0f5e6d"/>
    </linearGradient>
    <radialGradient id="mapart-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#d7aa50" stop-opacity=".35"/>
      <stop offset="1" stop-color="#d7aa50" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="320" height="150" fill="#071d36"/>
  <g fill="none" stroke="#f2d28b" stroke-opacity=".08">
    <path d="M-10 128C30 98 60 106 92 76S132 44 150-10"/>
    <path d="M-10 148C40 116 72 124 108 92S152 58 174-10"/>
    <path d="M-10 106C20 80 46 88 74 60S112 28 130-10"/>
    <path d="M-10 84C16 64 36 68 56 46S90 14 106-10"/>
    <path d="M-10 62C10 48 24 50 38 34S66 4 80-10"/>
  </g>
  <path d="M236-5C226 30 242 56 230 86S218 128 226 160H330V-5Z" fill="url(#mapart-sea)"/>
  <path d="M236-5C226 30 242 56 230 86S218 128 226 160" fill="none" stroke="#4cc3cb" stroke-opacity=".55" stroke-width="1.2"/>
  <g fill="none" stroke="#4cc3cb" stroke-opacity=".3" stroke-linecap="round">
    <path d="M262 34q6-4 12 0t12 0"/>
    <path d="M280 112q6-4 12 0t12 0"/>
    <path d="M252 132q6-4 12 0t12 0"/>
  </g>
  <text class="mapart__label" x="281" y="80" text-anchor="middle" direction="rtl">البحر الأحمر</text>
  <g fill="none" stroke="#f2d28b" stroke-opacity=".2" stroke-linecap="round" stroke-width="2.2">
    <path d="M-5 96C60 92 126 88 200 84"/>
    <path d="M150 160C166 124 182 104 200 84S218 40 224-5"/>
  </g>
  <circle cx="200" cy="84" r="34" fill="url(#mapart-glow)"/>
  <g transform="translate(200 84)">
    <circle class="mapart__ring" r="12" fill="none" stroke="#4cc3cb" stroke-width="1.5"/>
    <circle class="mapart__ring mapart__ring--late" r="12" fill="none" stroke="#4cc3cb" stroke-width="1.5"/>
    <ellipse cx="0" cy="1" rx="6" ry="2" fill="#000" fill-opacity=".35"/>
    <path d="M0 0C-8-8-11-13-11-19a11 11 0 0 1 22 0C11-13 8-8 0 0Z" fill="#d7aa50"/>
    <g fill="none" stroke="#061a31" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M-4.6-14.2v-3.8a4.6 4.6 0 0 1 9.2 0v3.8Z"/>
      <path d="M0-26.4v3.6M-1.7-24.8h3.4"/>
    </g>
  </g>
</svg>`;

function locationWidget(location) {

  const art = document.createElement('template');
  art.innerHTML = MAP_ART.trim();

  const map = h('div', { class: 'location__map', id: 'location-map' }, art.content.firstElementChild);

  const toggle = h('button', {
    class: 'btn',
    type: 'button',
    'aria-expanded': 'false',
    'aria-controls': 'location-map',
    onclick: () => {
      const show = !map.classList.contains('is-live');
      if (show) {
        const query = location.lat !== null ? `${location.lat},${location.lng}` : location.name;
        const src = `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=16&hl=ar&output=embed`;
        map.replaceChildren(h('iframe', {
          src,
          title: `خريطة: ${location.name}`,
          loading: 'lazy',
          referrerpolicy: 'strict-origin-when-cross-origin',
          allowfullscreen: true
        }));
      }
      else {
        const fresh = document.createElement('template');
        fresh.innerHTML = MAP_ART.trim();
        map.replaceChildren(fresh.content.firstElementChild);
      }
      map.classList.toggle('is-live', show);
      toggle.setAttribute('aria-expanded', String(show));
      toggle.lastChild.textContent = show ? 'اخفي الخريطة' : 'عرض الخريطة';
    }
  },
  iconNode('map-view'),
  h('span', {}, 'عرض الخريطة')
  );

  const maps = location.mapsUrl || location.directionsUrl;

  return h('section', { class: 'widget location', 'data-area': 'location', 'aria-labelledby': 'location-title' },
    map,
    h('div', { class: 'location__body' },
      h('h2', { class: 'widget__title', id: 'location-title' }, iconNode('map', 'icon--sea'), 'مكان الاجتماع'),
      h('p', { class: 'location__name' }, location.name),
      location.address ? h('p', { class: 'location__address' }, location.address) : null,
      location.note ? h('p', { class: 'location__note' }, location.note) : null,
      h('div', { class: 'location__actions' },
        maps
          ? h('a', { class: 'btn btn--primary', ...external(maps) }, iconNode('map'), 'فتح في خرائط جوجل')
          : null,
        location.directionsUrl
          ? h('a', { class: 'btn', ...external(location.directionsUrl) }, iconNode('directions'), 'الاتجاهات')
          : null,
        toggle
      )
    )
  );

}


/* =========================================================
   LINK SECTIONS
========================================================= */

function appIcon(name) {

  return h('span', { class: `app-icon${isBrandIcon(name) ? ` app-icon--${name}` : ''}`, 'aria-hidden': 'true' }, iconNode(name));

}


function tile(link) {

  return h('li', {},
    h('a', { class: 'tile', ...external(link.url) },
      link.badge ? h('span', { class: 'badge' }, link.badge) : null,
      appIcon(link.icon),
      h('span', { class: 'tile__title' }, link.title),
      link.subtitle ? h('span', { class: 'tile__sub' }, link.subtitle) : null
    )
  );

}


function row(link) {

  return h('li', {},
    h('a', { class: 'row-link', ...external(link.url) },
      appIcon(link.icon),
      h('span', { class: 'row-link__text' },
        h('span', { class: 'row-link__title' }, link.title, link.badge ? h('span', { class: 'badge' }, link.badge) : null),
        link.subtitle ? h('span', { class: 'row-link__sub' }, link.subtitle) : null
      ),
      iconNode('arrow', 'row-link__go')
    )
  );

}


function sectionWidget(section, links) {

  const id = `section-${section.key}`;
  const tiles = links.filter(link => link.style === 'tile');
  const rows = links.filter(link => link.style !== 'tile');

  return h('section', { class: 'widget links-section', 'data-area': 'section', 'aria-labelledby': id },
    h('h2', { class: 'widget__title', id }, section.title),
    tiles.length ? h('ul', { class: 'tiles' }, tiles.map(tile)) : null,
    rows.length ? h('ul', { class: 'rows' }, rows.map(row)) : null
  );

}


/* =========================================================
   CONTACTS
========================================================= */

function contactButton(contact, primary) {

  const number = h('span', { class: 'phone-number ltr' }, contact.phoneDisplay);

  if (contact.action.type === 'call') {
    return h('a', {
      class: `btn btn--call${primary ? ' btn--primary' : ''}`,
      href: contact.action.href,
      'aria-label': `اتصال بـ${contact.name} على ${contact.phoneDisplay}`
    },
    h('span', { class: 'btn__label' }, iconNode('phone'), 'اتصال'),
    number
    );
  }

  return h('a', {
    class: 'btn btn--whatsapp',
    ...external(contact.action.href),
    'aria-label': `راسل ${contact.name} على واتساب`
  },
  iconNode('whatsapp'),
  'واتساب'
  );

}


function contactsWidget(contacts) {

  return h('section', { class: 'widget contact', 'data-area': 'contacts', 'aria-labelledby': 'contacts-title' },
    h('h2', { class: 'widget__title', id: 'contacts-title' }, iconNode('phone'), 'تواصل مع الخدمة'),
    contacts.map(contact => h('div', { class: 'person' },
      h('div', { class: 'person__head' },
        h('span', { class: 'person__avatar', 'aria-hidden': 'true' }, Array.from(contact.name)[0]),
        h('div', {},
          h('p', { class: 'person__name' }, contact.name),
          contact.role ? h('p', { class: 'person__role' }, contact.role) : null
        )
      ),
      contact.description ? h('p', { class: 'person__desc' }, contact.description) : null,
      contactButton(contact, true)
    ))
  );

}


function supportWidget(contacts) {

  return h('section', { class: 'widget support', 'data-area': 'support', 'aria-labelledby': 'support-title' },
    h('h2', { class: 'support__title', id: 'support-title' }, iconNode('info'), contacts[0].role || 'الدعم الفني'),
    contacts.map(contact => [
      h('p', { class: 'support__desc' },
        contact.description,
        contact.description ? ' — ' : '',
        h('span', { class: 'support__name' }, contact.name)
      ),
      contactButton(contact, false)
    ])
  );

}


/* =========================================================
   SHARE + FOOTER
========================================================= */

function shareWidget(actions) {

  return h('section', { class: 'widget share', 'data-area': 'share', 'aria-labelledby': 'share-title' },
    h('div', {},
      h('h2', { class: 'share__title', id: 'share-title' }, 'شارك الصفحة'),
      h('p', { class: 'share__text' }, 'ابعت اللينك لصحابك، أو خلّيهم يصوّروا الكود.')
    ),
    h('div', { class: 'share__actions' },
      h('button', { class: 'btn btn--primary', type: 'button', onclick: actions.share }, iconNode('share'), 'شارك اللينك'),
      h('button', { class: 'btn', type: 'button', onclick: actions.qr }, iconNode('qr'), 'اعرض QR')
    )
  );

}


function footer(content) {

  return h('footer', { class: 'footer', 'data-area': 'footer' },
    iconNode('cross', 'footer__cross'),
    h('p', { class: 'footer__name' }, content.site.name),
    content.location ? h('p', {}, content.location.name) : null
  );

}


/* =========================================================
   PAGE
========================================================= */

let meetingHandle = null;
let currentStatus = null;
let gameCards = [];
let previousGameStates = new Map();


/** The meeting status the widget last showed (for the meeting sheet). */
export function meetingSnapshot() {

  return currentStatus;

}


/** Visible parts right now (dates are Cairo wall time). */
function visibleParts(content, nowStamp) {

  const news = visibleNews(content, nowStamp);
  const pinned = news.find(item => item.pinned) || null;

  // a pinned news item replaces the legacy announcement
  const announcement = !pinned && content.announcement && (!content.announcement.expiresAt || nowStamp <= content.announcement.expiresAt)
    ? content.announcement
    : null;

  const featured = content.featured.filter(link => isWithinWindow(link, nowStamp));

  const sections = content.sections
    .map(section => ({ section, links: section.links.filter(link => isWithinWindow(link, nowStamp)) }))
    .filter(item => item.links.length);

  const games = gameStates(content, nowStamp);

  return {
    announcement,
    pinned,
    news: news.filter(item => item !== pinned),
    liveGames: games.filter(g => g.state === 'open'),
    // upcoming first, finished last
    otherGames: games.filter(g => g.state === 'soon').concat(games.filter(g => g.state === 'ended')),
    featured,
    sections
  };

}


/* Changes whenever something appears, disappears or changes state. */
export function visibilityKey(content, nowStamp) {

  const parts = visibleParts(content, nowStamp);

  return [
    parts.announcement ? 'a' : '',
    parts.pinned ? parts.pinned.id : '',
    parts.news.map(item => item.id).join(','),
    gameStates(content, nowStamp).map(g => `${g.game.id}:${g.state}`).join(','),
    visibleNotifications(content, nowStamp).map(n => n.id).join(','),
    parts.featured.map(link => link.id).join(','),
    parts.sections.map(item => item.links.map(link => link.id).join(',')).join('|')
  ].join('#');

}


export function renderPage(content, clock, actions, { animate = false } = {}) {

  const main = document.getElementById('main');
  const hero = main.querySelector('[data-area="hero"]');

  updateHero(content.site);

  const parts = visibleParts(content, clock.stamp);
  const widgets = [];

  meetingHandle = content.meeting || content.sessions.length ? meetingWidget(content, clock.now) : null;
  gameCards = [];

  if (meetingHandle) widgets.push(meetingHandle.el);

  // a game that is open right now goes straight under the meeting
  const live = parts.liveGames.map(liveGameWidget);
  live.forEach(item => { widgets.push(item.el); gameCards.push(...item.cards); });

  if (parts.pinned) widgets.push(bannerWidget(parts.pinned));
  else if (parts.announcement) widgets.push(announcementWidget(parts.announcement));

  const featured = parts.featured.map(featuredWidget);
  widgets.push(...featured);

  if (parts.news.length) widgets.push(newsSection(parts.news, clock.stamp));

  if (parts.otherGames.length) {
    const games = gamesSection(parts.otherGames);
    widgets.push(games.el);
    gameCards.push(...games.cards);
  }

  const location = content.location ? locationWidget(content.location) : null;
  if (location) widgets.push(location);

  for (const item of parts.sections) {
    widgets.push(sectionWidget(item.section, item.links));
  }

  const service = content.contacts.filter(c => c.kind === 'service');
  const support = content.contacts.filter(c => c.kind === 'support');
  const serviceEl = service.length ? contactsWidget(service) : null;
  const supportEl = support.length ? supportWidget(support) : null;

  if (serviceEl) widgets.push(serviceEl);
  if (supportEl) widgets.push(supportEl);

  widgets.push(shareWidget(actions), footer(content));

  // widgets whose usual partner is missing take the full row
  hero.toggleAttribute('data-wide', !meetingHandle || meetingHandle.el.hidden);
  // featured + location share a row only when nothing sits between them
  const separated = parts.news.length > 0 || parts.otherGames.length > 0;
  featured.forEach(el => el.toggleAttribute('data-wide', featured.length !== 1 || !location || separated));
  if (location) location.toggleAttribute('data-wide', featured.length === 0 || separated);
  if (serviceEl) serviceEl.toggleAttribute('data-wide', !supportEl);
  if (supportEl) supportEl.toggleAttribute('data-wide', !serviceEl);

  if (animate) {
    widgets.forEach((el, index) => {
      el.classList.add('is-entering', 'is-new');
      el.style.setProperty('--i', String(index));
      el.addEventListener('animationend', event => {
        if (event.target === el) el.classList.remove('is-entering');
      });
    });
  }

  main.querySelectorAll('[data-dynamic]').forEach(el => el.remove());

  widgets.forEach(el => el.setAttribute('data-dynamic', ''));
  main.append(...widgets);
  main.dataset.state = 'ready';

  // a game opened while the visitor was here: wake its card up
  const states = new Map(gameStates(content, clock.stamp).map(g => [g.game.id, g.state]));
  if (!animate && !document.hidden) {
    for (const item of live) {
      const id = item.cards[0].id;
      if (previousGameStates.get(id) === 'soon') {
        wake(item.el.querySelector('.game'), 'is-waking', 2200);
        play('ready', { passive: true });
      }
    }
  }
  previousGameStates = states;

  updateBell(content, clock.stamp);

}


/* Every tick: meeting wording and game countdowns, without rebuilding. */
export function tickPage(content, clock) {

  meetingHandle?.update(clock.now);

  const states = new Map(gameStates(content, clock.stamp).map(g => [g.game.id, g]));

  for (const card of gameCards) {
    const entry = states.get(card.id);
    if (entry) card.update(entry);
  }

}


export function renderError(retry) {

  const main = document.getElementById('main');

  main.querySelectorAll('[data-dynamic]').forEach(el => el.remove());

  main.append(h('section', { class: 'widget state-message', 'data-dynamic': '', 'data-area': 'error', role: 'alert' },
    h('p', {}, 'مش قادرين نحمّل البيانات دلوقتي. اتأكد من النت وجرّب تاني.'),
    h('button', { class: 'btn btn--primary', type: 'button', onclick: retry }, iconNode('retry'), 'جرّب تاني')
  ));

  main.dataset.state = 'error';

}
