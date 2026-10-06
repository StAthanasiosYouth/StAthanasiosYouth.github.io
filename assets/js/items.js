/**
 * ITEMS: competitions, trips, plays, conferences... (content.activities)
 *
 * One generic model; the type (content.types) gives the label, icon,
 * colour and default banner, and the section (المسابقات / الفعاليات / any
 * "items" section) says where it shows. Competitions open their link only
 * between startAt and endAt; for other activities the dates are the
 * event's own and the link (e.g. registration) works any time.
 */

import { h, external } from './dom.js';
import { iconNode } from './icons.js';
import { visibilityState } from './schedule.js';
import { formatStamp, untilText } from './words.js';
import { posterOrFallback, mediaHero } from './hub.js';
import { go } from './router.js';

const SECTION_ICONS = { competitions: 'trophy', activities: 'calendar' };
const SECTION_TITLES = { competitions: 'المسابقات', activities: 'الفعاليات' };


/** Items of a section that show right now. */
export function visibleItems(content, sectionKey, nowStamp) {

  return (content.activities || []).filter(item =>
    item.section === sectionKey &&
    visibilityState({ from: item.visibleFrom, until: item.visibleUntil }, nowStamp) === 'live'
  );

}


export function typeOf(content, item) {

  return (content.types || []).find(t => t.key === item.type) || { key: item.type, label: '', icon: '', theme: '', banner: null };

}


function minutesBetween(from, to) {

  const toMinutes = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16)) / 60000;

  return toMinutes(to) - toMinutes(from);

}


/* soon / open / ended, from startAt and endAt (Cairo wall time) */
export function itemState(item, nowStamp) {

  if (item.startAt && nowStamp < item.startAt) return { state: 'soon', minutesUntil: minutesBetween(nowStamp, item.startAt) };
  if (item.endAt && nowStamp > item.endAt) return { state: 'ended' };
  if (item.startAt || item.endAt) return { state: 'open' };
  return { state: 'always' };

}


function stateLabel(state, competition) {

  if (state.state === 'soon') return competition ? `تبدأ ${untilText(state.minutesUntil)}` : `${untilText(state.minutesUntil)}`;
  if (state.state === 'open') return competition ? 'متاحة دلوقتي 🔥' : 'شغالة دلوقتي';
  if (state.state === 'ended') return competition ? 'خلصت' : 'خلصت';
  return '';

}


/* the main button: competitions only while open; others any time */
function cta(item, state, competition, small = false) {

  if (!item.cta) return null;

  if (competition && state.state !== 'open' && state.state !== 'always') {
    return h('span', { class: `btn ${small ? 'btn--small ' : ''}item-card__cta is-waiting`, 'aria-disabled': 'true' },
      iconNode('clock'),
      state.state === 'soon' ? 'لسه مبدأتش' : 'خلصت'
    );
  }

  return h('a', { class: `btn btn--primary ${small ? 'btn--small ' : ''}item-card__cta`, ...external(item.cta.url) },
    item.cta.label,
    iconNode('external')
  );

}


export function itemCard(item, type, section, nowStamp) {

  const competition = section.key === 'competitions';
  const state = itemState(item, nowStamp);
  const label = stateLabel(state, competition);
  const theme = type.theme || section.theme || null;
  const fallback = { theme, icon: type.icon || SECTION_ICONS[section.key] || 'calendar', banner: type.banner || section.banner };

  return h('article', { class: `item-card item-card--${state.state}`, 'data-theme': theme },
    h('div', { class: 'item-card__media' }, posterOrFallback(item.image, fallback, { sizes: '(min-width: 1024px) 300px, 46vw', icon: fallback.icon })),
    h('div', { class: 'item-card__body' },
      h('p', { class: 'item-card__meta' },
        type.label ? h('span', { class: 'item-card__type' }, iconNode(type.icon || fallback.icon), type.label) : null,
        label ? h('span', { class: 'item-card__state' }, label) : null
      ),
      h('h3', { class: 'item-card__title' },
        h('a', { class: 'stretched', href: `#activity/${item.id}`, onclick: event => { event.preventDefault(); go('activity', item.id); } }, item.title)
      ),
      item.subtitle ? h('p', { class: 'item-card__sub' }, item.subtitle) : null,
      item.startAt || item.location
        ? h('p', { class: 'item-card__when' },
          item.startAt ? h('span', {}, iconNode('clock'), formatStamp(item.startAt)) : null,
          item.location ? h('span', {}, iconNode('map'), item.location) : null
        )
        : null,
      h('div', { class: 'item-card__actions' }, cta(item, state, competition, true))
    )
  );

}


export function itemsSection(section, items, content, nowStamp) {

  const id = `items-${section.key}`;

  return h('section', { class: `widget items items--${section.key}`, 'data-area': 'items', 'data-key': section.key, 'data-theme': section.theme || null, 'aria-labelledby': id },
    h('div', { class: 'section-head' },
      h('h2', { class: 'widget__title', id }, iconNode(section.icon || SECTION_ICONS[section.key] || 'calendar'), section.title || SECTION_TITLES[section.key] || 'الفعاليات'),
      section.subtitle ? h('p', { class: 'section-head__sub' }, section.subtitle) : null
    ),
    h('ul', { class: 'items__list' }, items.map(item => h('li', {}, itemCard(item, typeOf(content, item), section, nowStamp))))
  );

}


export function itemSheetContent(item, type, section, nowStamp, shareRow) {

  const competition = section.key === 'competitions';
  const state = itemState(item, nowStamp);
  const label = stateLabel(state, competition);
  const media = item.image || type.banner || section.banner;

  return h('article', { class: 'detail', 'data-theme': type.theme || section.theme || null },
    mediaHero(media),
    h('p', { class: 'detail__kicker' }, type.label || SECTION_TITLES[section.key] || ''),
    label ? h('p', { class: `detail__state item-card__state is-${state.state}` }, label) : null,
    item.subtitle ? h('p', { class: 'detail__lead' }, item.subtitle) : null,
    item.startAt ? h('p', { class: 'detail__when' }, iconNode('clock'), formatStamp(item.startAt), item.endAt ? ` ← ${formatStamp(item.endAt)}` : '') : null,
    item.location ? h('p', { class: 'detail__when' }, iconNode('map'), item.location) : null,
    item.description ? h('p', { class: 'detail__body' }, item.description) : null,
    h('div', { class: 'detail__actions' }, cta(item, state, competition)),
    shareRow(`#activity/${item.id}`, item.title)
  );

}
