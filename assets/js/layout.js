/**
 * PAGE LAYOUT
 *
 * content.layout (schema 3) lists the page's sections in order, each with
 * its own visibility window (Cairo wall time). Sections switched off in
 * the admin are not in the list at all: nothing inside them was published.
 * Older content (schema 2) gets the order the page always had.
 */

import { visibilityState } from './schedule.js';

export const SECTION_KINDS = ['meeting', 'featured', 'news', 'games', 'items', 'location', 'links', 'contacts', 'support', 'share'];

export const SECTION_THEMES = ['gold', 'ember', 'azure', 'rose', 'emerald', 'night'];

const BEFORE_LINKS = [
  ['meeting', 'meeting'], ['featured', 'featured'], ['news', 'news'], ['games', 'games'],
  ['competitions', 'items'], ['activities', 'items'], ['location', 'location']
];

const AFTER_LINKS = [['contacts', 'contacts'], ['support', 'support'], ['share', 'share']];

const section = ([key, kind]) => ({ key, kind, title: '', subtitle: '', icon: '', theme: '', banner: null, visibleFrom: '', visibleUntil: '' });


/** Every published section, in page order. */
export function pageLayout(content) {

  if (Array.isArray(content.layout)) {
    return content.layout;
  }

  return [
    ...BEFORE_LINKS.map(section),
    ...content.sections.map(s => ({ ...section([s.key, 'links']), title: s.title })),
    ...AFTER_LINKS.map(section)
  ];

}


/** The sections showing right now. */
export function liveSections(content, nowStamp) {

  return pageLayout(content).filter(s => visibilityState({ from: s.visibleFrom, until: s.visibleUntil }, nowStamp) === 'live');

}


/** Is this section showing now? (key: meeting, news, games...) */
export function isSectionLive(content, nowStamp, key) {

  return liveSections(content, nowStamp).some(s => s.key === key);

}
