/**
 * RENDER
 *
 * Builds the widgets from sanitized content, in the order of the page
 * layout (layout.js): the sections the admin switched on, each showing
 * only inside its own time window (Cairo). The hero is always first and
 * the footer always last. Default order (older content):
 *   hero → meeting → banner → featured → news → games → location
 *   → link sections → service contact → technical support → share → footer
 */

import { h, external } from './dom.js';
import { go } from './router.js';
import { iconNode, isBrandIcon } from './icons.js';
import { meetingStatus, meetingJourney, fromDayNumber, isWithinWindow, calendarDates } from './schedule.js';
import { journeyElement } from './journey.js';
import { describeMeeting, formatDate, DAY_SHORT } from './words.js';
import { bannerWidget, newsSection, gamesSection, liveGameWidget, meetingTopic, visibleNews, gameStates, sectionBanner } from './hub.js';
import { updateBell, visibleNotifications } from './bell.js';
import { liveSections } from './layout.js';
import { itemsSection, visibleItems } from './items.js';
import { wake } from './motion.js';
import { choreograph, motionTier } from './feel.js';
import { hasScene } from './xp.js';
import { play } from './sound.js';
import { pageUrl } from './share.js';


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

    // the top bar's compact name: the name's lead words
    const compact = document.querySelector('.topbar__name');
    if (compact) compact.textContent = words.length > 5 ? words.slice(0, 3).join(' ') : site.name;

  }

  taglineEl.textContent = site.tagline;
  taglineEl.hidden = !site.tagline;

}


/* =========================================================
   MEETING
========================================================= */

/* sessions-only setups (no weekly rule) still get a meeting widget */
const NO_WEEKLY = { title: 'الاجتماع', day: null, time: '', durationMinutes: null, note: '', skipDates: [], ics: '' };

function meetingWidget(content, now, layoutSection = {}) {

  const meeting = content.meeting || NO_WEEKLY;

  const headline = h('p', { class: 'meeting__headline' });
  const detail = h('p', { class: 'meeting__detail' });
  const journey = journeyElement();
  // the countdown, spoken once in a while (not every tick) for screen readers
  const spoken = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
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

  const section = h('section', { class: 'widget meeting', 'data-area': 'meeting', 'data-theme': layoutSection.theme || null, 'aria-labelledby': 'meeting-title' },
    h('div', { class: 'meeting__top' },
      h('h2', { class: 'widget__title', id: 'meeting-title' }, iconNode('clock'), meeting.title),
      meeting.day !== null ? h('span', { class: 'meeting__repeat' }, `كل ${DAY_SHORT[meeting.day]}`) : null
    ),
    headline,
    detail,
    note,
    skipNote,
    topicSlot,
    journey.el,
    spoken,
    h('div', { class: 'meeting__actions' }, calendarToggle, calendarMenu)
  );

  function update(currentNow) {

    const status = meetingStatus(content.meeting, currentNow, content.sessions);

    if (!status) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    const cancelledDates = (content.sessions || []).filter(s => s.status === 'cancelled').map(s => s.date).concat(meeting.skipDates);
    const trip = meetingJourney(status, currentNow, cancelledDates);
    const words = describeMeeting(status, trip.remaining);
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

    journey.update(trip);
    section.dataset.phase = trip.phase;
    section.style.setProperty('--energy', trip.energy.toFixed(3));

    // the live region speaks when the wording changes, not every 15 seconds
    const sentence = `${words.headline}. ${words.detail}`;
    if (spoken.dataset.said !== words.headline) {
      spoken.dataset.said = words.headline;
      spoken.textContent = sentence;
    }

    const place = content.location ? [content.location.name, content.location.address].filter(Boolean).join('، ') : '';
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `${meeting.title} — ${content.site.name}`,
      dates: calendarDates(status),
      ctz: content.timezone,
      details: [meeting.note, content.site.name, pageUrl()].filter(Boolean).join('\n')
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


/*
 * A social link opens its mini-experience on a plain tap/click/Enter. It
 * stays a real link: ctrl/cmd/middle-click and "open in new tab" still go
 * straight to the platform, and without JavaScript it is a normal link.
 */
function linkAttrs(link) {

  if (!hasScene(link.experience)) return external(link.url);

  return {
    ...external(link.url),
    'aria-haspopup': 'dialog',
    'data-experience': link.experience,
    onclick: event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      go('follow', link.id);
    }
  };

}


function tile(link) {

  return h('li', {},
    h('a', { class: 'tile', ...linkAttrs(link) },
      link.badge ? h('span', { class: 'badge' }, link.badge) : null,
      appIcon(link.icon),
      h('span', { class: 'tile__title' }, link.title),
      link.subtitle ? h('span', { class: 'tile__sub' }, link.subtitle) : null
    )
  );

}


function row(link) {

  return h('li', {},
    h('a', { class: 'row-link', ...linkAttrs(link) },
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

  return h('section', { class: 'widget links-section', 'data-area': 'section', 'data-theme': section.theme || null, 'aria-labelledby': id },
    h('h2', { class: 'widget__title', id }, section.title),
    section.subtitle ? h('p', { class: 'section-head__sub' }, section.subtitle) : null,
    tiles.length ? h('ul', { class: 'tiles' }, tiles.map(tile)) : null,
    rows.length ? h('ul', { class: 'rows' }, rows.map(row)) : null
  );

}


/* =========================================================
   CONTACTS
========================================================= */

/*
 * The service leader and the technical support are one matched pair:
 *   head (avatar or arch monogram, name, role)
 *   → a "stage" of the same height (a ringing phone / a short WhatsApp chat)
 *   → the action, aligned at the bottom.
 * The stage is decoration around real words (contact.intro / reply); the
 * button never waits for it.
 */
const SERVICE_INTRO = 'عندك سؤال أو محتاج تتكلم؟';
const SUPPORT_INTRO = 'معايا مشكلة';
const SUPPORT_REPLY = 'أهلاً بيك 👋 ابعتلي المشكلة أو التفاصيل وأنا هساعدك إن شاء الله.';

function contactButton(contact) {

  if (contact.action.type === 'call') {
    return h('a', {
      class: 'btn btn--call btn--primary',
      href: contact.action.href,
      'aria-label': `اتصال بـ${contact.name} على ${contact.phoneDisplay}`
    },
    h('span', { class: 'btn__label' }, iconNode('phone'), 'اتصال'),
    h('span', { class: 'phone-number ltr' }, contact.phoneDisplay)
    );
  }

  return h('a', {
    class: 'btn btn--whatsapp',
    ...external(contact.action.href),
    'aria-label': `تواصل مع ${contact.name} على واتساب`
  },
  iconNode('whatsapp'),
  'تواصل على واتساب'
  );

}


/* a small picture of the person, else the arch with their initial */
function avatar(contact, className = 'person__avatar') {

  if (contact.image) {
    return h('span', { class: `${className} ${className}--photo`, 'aria-hidden': 'true' },
      h('img', { src: contact.image.thumb, width: 52, height: 52, alt: '', decoding: 'async', loading: 'lazy' }));
  }

  return h('span', { class: className, 'aria-hidden': 'true' }, Array.from(contact.name)[0]);

}


function personHead(contact, titleId) {

  return h('div', { class: 'person__head' },
    avatar(contact),
    h('div', { class: 'person__who' },
      h('h2', { class: 'person__name', id: titleId }, contact.name),
      contact.role ? h('p', { class: 'person__role' }, contact.role) : null
    )
  );

}


/* more than one person of a kind: the others in a compact row each */
function morePeople(contacts) {

  return contacts.slice(1).map(contact => h('div', { class: 'person person--more' },
    personHead(contact, null),
    contactButton(contact)
  ));

}


function contactsWidget(contacts) {

  const lead = contacts[0];

  // the phone rings softly: waves around a phone, the invitation beside it
  const stage = h('div', { class: 'person__stage ring' },
    h('span', { class: 'ring__phone', 'aria-hidden': 'true' },
      h('span', { class: 'ring__wave' }),
      h('span', { class: 'ring__wave' }),
      h('span', { class: 'ring__wave' }),
      h('span', { class: 'ring__glyph' }, iconNode('phone'))
    ),
    h('div', { class: 'ring__copy' },
      h('p', { class: 'ring__intro' }, lead.intro || SERVICE_INTRO),
      lead.description ? h('p', { class: 'ring__desc' }, lead.description) : null
    )
  );

  liveWhileVisible(stage);

  return h('section', { class: 'widget person-card contact', 'data-area': 'contacts', 'aria-labelledby': 'contacts-title' },
    personHead(lead, 'contacts-title'),
    stage,
    h('div', { class: 'person__actions' }, contactButton(lead)),
    morePeople(contacts)
  );

}


/* the waves move only while the card is on screen (full tier: CSS) */
function liveWhileVisible(el) {

  if (!('IntersectionObserver' in window)) return;

  new IntersectionObserver(entries => {
    for (const entry of entries) el.classList.toggle('is-live', entry.isIntersecting);
  }, { threshold: 0.3 }).observe(el);

}


function supportWidget(contacts) {

  const lead = contacts[0];
  const reply = lead.reply || SUPPORT_REPLY;

  // a short WhatsApp-like conversation: real words, read as a list
  const chat = h('div', { class: 'person__stage chat' },
    lead.description ? h('p', { class: 'chat__chip' }, lead.description) : null,
    h('ol', { class: 'chat__log', 'aria-label': `محادثة مع ${lead.name}` },
      h('li', { class: 'chat__msg chat__msg--out' },
        h('span', { class: 'visually-hidden' }, 'إنت: '),
        h('span', { class: 'chat__text' }, lead.intro || SUPPORT_INTRO),
        h('span', { class: 'chat__meta', 'aria-hidden': 'true' }, tickMarks(''), tickMarks(' chat__ticks--seen')),
        h('span', { class: 'chat__reaction', 'aria-hidden': 'true' }, '❤️')
      ),
      h('li', { class: 'chat__msg chat__msg--in' },
        avatar(lead, 'chat__avatar'),
        h('span', { class: 'chat__typing', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
        h('span', { class: 'chat__bubble' },
          h('span', { class: 'chat__from' }, lead.name, h('span', { class: 'visually-hidden' }, ': ')),
          h('span', { class: 'chat__text' }, reply)
        )
      )
    )
  );

  const section = h('section', { class: 'widget person-card support', 'data-area': 'support', 'aria-labelledby': 'support-title' },
    personHead(lead, 'support-title'),
    chat,
    h('div', { class: 'person__actions' }, contactButton(lead)),
    morePeople(contacts)
  );

  playOnce(chat);

  return section;

}


/* two read ticks (they turn blue once "seen") */
function tickMarks(extra) {

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 18 12');
  svg.setAttribute('class', `chat__ticks${extra}`);
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm1 6.5 3.2 3.2L11 2.5M7.4 9.2l.5.5L14.7 2.5');
  svg.append(path);

  return svg;

}


/*
 * The conversation plays once per visit, when it scrolls into view, and
 * rests on its final frame. Before that it waits on its first frame
 * (.is-armed). Reduced motion (or no IntersectionObserver): the final frame
 * at once. Lite: the same story, shorter (main.css).
 */
let chatPlayed = false;

function playOnce(stage) {

  if (chatPlayed || motionTier() === 'reduced' || !('IntersectionObserver' in window)) return;

  stage.classList.add('is-armed');

  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    chatPlayed = true;
    stage.classList.add('is-playing');
    // after the last step the class goes: the final frame is the resting state
    setTimeout(() => stage.classList.remove('is-armed', 'is-playing'), motionTier() === 'lite' ? 2600 : 5200);
  }, { threshold: 0.6 });

  observer.observe(stage);

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

  const sections = liveSections(content, nowStamp);
  const live = new Set(sections.map(s => s.key));

  const news = live.has('news') ? visibleNews(content, nowStamp) : [];
  const pinned = news.find(item => item.pinned) || null;

  // a pinned news item replaces the legacy announcement (both belong to news)
  const announcement = live.has('news') && !pinned && content.announcement && (!content.announcement.expiresAt || nowStamp <= content.announcement.expiresAt)
    ? content.announcement
    : null;

  const featured = live.has('featured') ? content.featured.filter(link => isWithinWindow(link, nowStamp)) : [];

  const linkGroups = new Map(content.sections
    .map(section => [section.key, { section, links: section.links.filter(link => isWithinWindow(link, nowStamp)) }])
    .filter(([, item]) => item.links.length));

  const games = live.has('games') ? gameStates(content, nowStamp) : [];

  return {
    sections,
    live,
    announcement,
    pinned,
    news: news.filter(item => item !== pinned),
    liveGames: games.filter(g => g.state === 'open'),
    // upcoming first, finished last
    otherGames: games.filter(g => g.state === 'soon').concat(games.filter(g => g.state === 'ended')),
    featured,
    linkGroups
  };

}


/* Changes whenever something appears, disappears or changes state. */
export function visibilityKey(content, nowStamp) {

  const parts = visibleParts(content, nowStamp);

  return [
    parts.sections.map(s => s.key).join(','),
    parts.announcement ? 'a' : '',
    parts.pinned ? parts.pinned.id : '',
    parts.news.map(item => item.id).join(','),
    gameStates(content, nowStamp).map(g => `${g.game.id}:${g.state}`).join(','),
    visibleNotifications(content, nowStamp).map(n => n.id).join(','),
    parts.featured.map(link => link.id).join(','),
    parts.sections.filter(s => s.kind === 'items').map(s => visibleItems(content, s.key, nowStamp).map(i => i.id).join(',')).join('|'),
    [...parts.linkGroups.values()].map(item => item.links.map(link => link.id).join(',')).join('|')
  ].join('#');

}


/*
 * Desktop pairs two widgets side by side when they fit together at both
 * breakpoints: hero + meeting (5 + 7), featured + location (7 + 5), or the
 * two people, service + support (6 + 6, a matched pair). Anything else
 * takes the full row.
 */
const WIDE_SPAN = { featured: 7, location: 5, contacts: 6, support: 6 };

function pairsWith(a, b) {

  if (a.kind === 'hero') return b.kind === 'meeting';
  return !!WIDE_SPAN[a.kind] && !!WIDE_SPAN[b.kind] && WIDE_SPAN[a.kind] + WIDE_SPAN[b.kind] === 12;

}

function pairUp(flow) {

  for (let i = 0; i < flow.length; i++) {
    const a = flow[i];
    const b = flow[i + 1];
    if (b && pairsWith(a, b)) {
      a.el.removeAttribute('data-wide');
      b.el.removeAttribute('data-wide');
      i++;
    }
    else {
      a.el.setAttribute('data-wide', '');
    }
  }

}


/*
 * A section's own look, applied in one place for every kind (the meeting,
 * links, contacts, share, a kind added later...): the banner the admin
 * chose goes on top of the section's first widget; the theme tints it.
 */
function dressSection(el, section) {

  if (section.banner && !el.querySelector(':scope > .section-banner')) {
    el.prepend(sectionBanner(section));
    el.classList.add('has-banner');
  }

  if (section.theme && !el.hasAttribute('data-theme')) {
    el.dataset.theme = section.theme;
  }

}


export function renderPage(content, clock, actions, { animate = false } = {}) {

  const main = document.getElementById('main');
  const hero = main.querySelector('[data-area="hero"]');

  updateHero(content.site);

  const parts = visibleParts(content, clock.stamp);
  const flow = [];
  // owner: the layout section a widget belongs to (its banner and theme)
  let owner = null;
  const add = (el, kind, by = owner) => { if (el) flow.push({ el, kind, section: by }); };

  meetingHandle = null;
  gameCards = [];

  const banner = parts.pinned ? bannerWidget(parts.pinned) : parts.announcement ? announcementWidget(parts.announcement) : null;
  const gamesLayout = parts.sections.find(s => s.key === 'games') || {};
  const liveGames = parts.liveGames.map(entry => liveGameWidget(entry, gamesLayout));
  let bannerPlaced = false;

  const placeBanner = () => {
    if (banner && !bannerPlaced) add(banner, 'banner', null);
    bannerPlaced = true;
  };

  // (a live game sits under the meeting, outside its own section's place)
  const placeLiveGames = () => {
    liveGames.splice(0).forEach(item => { add(item.el, 'live-game', null); gameCards.push(...item.cards); });
  };

  // the top banner sits right under the meeting when the meeting comes first
  if (!parts.sections.length || parts.sections[0].kind !== 'meeting') placeBanner();

  for (const section of parts.sections) {

    owner = section;

    switch (section.kind) {

      case 'meeting':
        if (content.meeting || content.sessions.length) {
          meetingHandle = meetingWidget(content, clock.now, section);
          add(meetingHandle.el, 'meeting');
          // a game that is open right now goes straight under the meeting
          placeLiveGames();
        }
        placeBanner();
        break;

      case 'featured':
        parts.featured.forEach(link => add(featuredWidget(link), 'featured'));
        break;

      case 'news':
        if (parts.news.length) add(newsSection(parts.news, clock.stamp, section), 'news');
        break;

      case 'games': {
        placeLiveGames();
        if (parts.otherGames.length) {
          const games = gamesSection(parts.otherGames, section);
          add(games.el, 'games');
          gameCards.push(...games.cards);
        }
        break;
      }

      case 'location':
        if (content.location) add(locationWidget(content.location), 'location');
        break;

      case 'links': {
        const group = parts.linkGroups.get(section.key);
        if (group) add(sectionWidget({ ...group.section, title: section.title || group.section.title, subtitle: section.subtitle, theme: section.theme, banner: section.banner }, group.links), 'links');
        break;
      }

      case 'contacts': {
        const service = content.contacts.filter(c => c.kind === 'service');
        if (service.length) add(contactsWidget(service), 'contacts');
        break;
      }

      case 'support': {
        const support = content.contacts.filter(c => c.kind === 'support');
        if (support.length) add(supportWidget(support), 'support');
        break;
      }

      case 'share':
        add(shareWidget(actions), 'share');
        break;

      case 'items': {
        const items = visibleItems(content, section.key, clock.stamp);
        if (items.length) add(itemsSection(section, items, content, clock.stamp), 'items');
        break;
      }

      default:
        break;

    }

  }

  owner = null;

  // live games whose section comes after everything else
  placeLiveGames();

  // every section, whatever its kind: its banner and theme, once, on its first widget
  const dressed = new Set();
  for (const item of flow) {
    if (!item.section || dressed.has(item.section)) continue;
    dressed.add(item.section);
    dressSection(item.el, item.section);
  }

  pairUp([{ el: hero, kind: 'hero' }, ...flow]);

  const widgets = flow.map(item => item.el).concat(footer(content));

  main.querySelectorAll('[data-dynamic]').forEach(el => el.remove());

  widgets.forEach(el => el.setAttribute('data-dynamic', ''));
  main.append(...widgets);
  main.dataset.state = 'ready';

  // on screen: a staggered entrance; further down: rise in when scrolled to
  if (animate) choreograph(widgets);

  // a game opened while the visitor was here: wake its card up
  const states = new Map(gameStates(content, clock.stamp).map(g => [g.game.id, g.state]));
  if (!animate && !document.hidden) {
    for (const item of parts.liveGames) {
      if (previousGameStates.get(item.game.id) === 'soon') {
        const card = main.querySelector('.live-game .game');
        if (card) wake(card, 'is-waking', 2200);
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
