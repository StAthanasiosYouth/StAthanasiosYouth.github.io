/**
 * ITEMS: competitions, trips, plays, conferences... (content.activities)
 *
 * One generic model; the type (content.types) gives the label, icon,
 * colour and default banner, and the section (المسابقات / الفعاليات / any
 * "items" section) says where it shows. Competitions open their link only
 * between startAt and endAt; for other activities the dates are the
 * event's own and the link (e.g. registration) works any time.
 * A card linked to a competition of the engine (item.competition = slug)
 * opens competition/<slug>/ in the same tab (docs/COMPETITIONS.md §4.5).
 * A card linked to a service page (item.page) or an event (item.event)
 * opens <slug>/ or events/<slug>/ in the same tab, with the automatic
 * button of docs/EVENTS.md §17.7 (the admin's ctaLabel wins), and a card
 * «بإشراف» a partner (item.partner, a key of content.partners) carries its
 * small chip (§12).
 */

import { h, external } from './dom.js';
import { iconNode } from './icons.js';
import { visibilityState } from './schedule.js';
import { formatStamp, untilText } from './words.js';
import { posterOrFallback, layCard } from './hub.js';
import { go } from './router.js';
import { entryCta, pageHref, eventHref } from './page/model.js';

const SECTION_ICONS = { competitions: 'trophy', activities: 'calendar', services: 'theatre' };

const SECTION_TITLES = { competitions: 'المسابقات', activities: 'الفعاليات', services: 'خدماتنا' };


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


/* the engine's page for a linked competition, relative to the site root */
export function competitionHref(item) {

  return item && typeof item.competition === 'string' && /^[a-z0-9-]{2,40}$/.test(item.competition) ? `competition/${item.competition}/` : '';

}


/* a linked service page / event: its own page, relative to the site root */
export function entryHref(item) {

  if (item && item.page) return pageHref(item.page);
  if (item && item.event) return eventHref(item.event);

  return '';

}


/* a linked card's button: { href, kind, label, chip } (the label table, §17.7); null = not linked */
export function entryButton(item, nowStamp) {

  const href = entryHref(item);

  if (!href) return null;

  const kind = item.page ? 'page' : 'event';
  const { label, chip } = entryCta(kind, kind === 'page' ? { watch: item.watch } : { booking: item.booking, startAt: item.startAt }, nowStamp, item.ctaLabel);

  return { href, kind, label, chip };

}


/* the main button: competitions only while open; others any time */
function cta(item, state, competition, nowStamp, small = false) {

  const engine = competitionHref(item);
  const entry = entryButton(item, nowStamp);

  // a service page / an event: same tab, our own page, any time
  if (entry) {
    return h('a', { class: `btn btn--primary ${small ? 'btn--small ' : ''}item-card__cta`, href: entry.href, 'data-entry': entry.kind },
      entry.label,
      iconNode('arrow')
    );
  }

  if (!item.cta && !engine) return null;

  if ((competition || engine) && state.state !== 'open' && state.state !== 'always') {
    return h('span', { class: `btn ${small ? 'btn--small ' : ''}item-card__cta is-waiting`, 'aria-disabled': 'true' },
      iconNode('clock'),
      state.state === 'soon' ? 'لسه مبدأتش' : 'خلصت'
    );
  }

  // the competition engine: same tab, our own page
  if (engine) {
    return h('a', { class: `btn btn--primary ${small ? 'btn--small ' : ''}item-card__cta`, href: engine, 'data-competition': item.competition },
      item.ctaLabel || (item.cta && item.cta.label) || 'ادخل المسابقة',
      iconNode('arrow')
    );
  }

  return h('a', { class: `btn btn--primary ${small ? 'btn--small ' : ''}item-card__cta`, ...external(item.cta.url) },
    item.cta.label,
    iconNode('external')
  );

}


/* «بإشراف B.U.G.»: the partner's mark on a small light plate (never on navy) and its short name
   (docs/EVENTS.md §12); content.js already kept item.partner only when content.partners has it */
export function partnerChip(item, partners) {

  const partner = item && item.partner && partners && Object.prototype.hasOwnProperty.call(partners, item.partner) ? partners[item.partner] : null;

  if (!partner) return null;

  const mark = partner.mark;

  return h('p', { class: 'item-card__partner', 'data-partner': partner.key },
    mark
      ? h('span', { class: 'partner-plate', 'aria-hidden': 'true' },
        h('img', { src: mark.src, width: mark.w, height: mark.h, alt: '', loading: 'lazy', decoding: 'async' }))
      : null,
    h('span', {}, 'بإشراف ', h('bdi', {}, partner.short))
  );

}


export function itemCard(item, type, section, nowStamp, partners = {}) {

  const entry = entryButton(item, nowStamp);
  const competition = !entry && (section.key === 'competitions' || !!competitionHref(item));
  const state = itemState(item, nowStamp);
  const label = (entry && entry.chip) || stateLabel(state, competition);
  const theme = type.theme || section.theme || null;
  const fallback = { theme, icon: type.icon || SECTION_ICONS[section.key] || 'calendar', banner: type.banner || section.banner };

  const media = h('div', { class: 'item-card__media' }, posterOrFallback(item.image, fallback, { sizes: '(min-width: 1024px) 480px, 46vw', icon: fallback.icon }));
  const body = h('div', { class: 'item-card__body' },
      h('p', { class: 'item-card__meta' },
        type.label ? h('span', { class: 'item-card__type' }, iconNode(type.icon || fallback.icon), type.label) : null,
        label ? h('span', { class: 'item-card__state' }, label) : null
      ),
      h('h3', { class: 'item-card__title' },
        entry
          // the whole card opens the page (same tab)
          ? h('a', { class: 'stretched', href: entry.href }, item.title)
          : h('a', { class: 'stretched', href: `#activity/${item.id}`, onclick: event => { event.preventDefault(); go('activity', item.id); } }, item.title)
      ),
      partnerChip(item, partners),
      item.subtitle ? h('p', { class: 'item-card__sub' }, item.subtitle) : null,
      item.startAt || item.location
        ? h('p', { class: 'item-card__when' },
          item.startAt ? h('span', {}, iconNode('clock'), formatStamp(item.startAt)) : null,
          item.location ? h('span', {}, iconNode('map'), item.location) : null
        )
        : null,
      h('div', { class: 'item-card__actions' }, cta(item, state, competition, nowStamp, true))
  );

  return layCard(h('article', { class: `item-card item-card--${state.state}`, 'data-theme': theme, 'data-entry': entry ? entry.kind : null }, media, body), media, body, item, item.image || fallback.banner);

}


export function itemsSection(section, items, content, nowStamp) {

  const id = `items-${section.key}`;

  return h('section', { class: `widget items items--${section.key}`, 'data-area': 'items', 'data-key': section.key, 'data-theme': section.theme || null, 'aria-labelledby': id },
    h('div', { class: 'section-head' },
      h('h2', { class: 'widget__title', id }, iconNode(section.icon || SECTION_ICONS[section.key] || 'calendar'), section.title || SECTION_TITLES[section.key] || 'الفعاليات'),
      section.subtitle ? h('p', { class: 'section-head__sub' }, section.subtitle) : null
    ),
    h('ul', { class: 'items__list' }, items.map(item => h('li', {}, itemCard(item, typeOf(content, item), section, nowStamp, content.partners))))
  );

}


/* hero: detail.js mediaHero (the sheets' lazy module, passed in by main.js) */
export function itemSheetContent(item, type, section, nowStamp, shareRow, hero) {

  const entry = entryButton(item, nowStamp);
  const competition = !entry && (section.key === 'competitions' || !!competitionHref(item));
  const state = itemState(item, nowStamp);
  const label = (entry && entry.chip) || stateLabel(state, competition);
  const media = item.image || type.banner || section.banner;

  return h('article', { class: 'detail', 'data-theme': type.theme || section.theme || null },
    hero(media),
    h('p', { class: 'detail__kicker' }, type.label || SECTION_TITLES[section.key] || ''),
    label ? h('p', { class: `detail__state item-card__state is-${state.state}` }, label) : null,
    item.subtitle ? h('p', { class: 'detail__lead' }, item.subtitle) : null,
    item.startAt ? h('p', { class: 'detail__when' }, iconNode('clock'), formatStamp(item.startAt), item.endAt ? ` ← ${formatStamp(item.endAt)}` : '') : null,
    item.location ? h('p', { class: 'detail__when' }, iconNode('map'), item.location) : null,
    item.description ? h('p', { class: 'detail__body' }, item.description) : null,
    h('div', { class: 'detail__actions' }, cta(item, state, competition, nowStamp)),
    shareRow(`#activity/${item.id}`, item.title)
  );

}
