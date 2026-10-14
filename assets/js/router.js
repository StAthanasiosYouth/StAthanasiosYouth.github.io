/**
 * ROUTER: shareable deep links for the sheets.
 *   #notifications   the bell
 *   #news/<id>       a news item
 *   #game/<id>       a game
 *   #activity/<id>   a competition, trip, play...
 *   #follow/<link>   a social link's mini-experience
 *   #meeting         the next meeting (topic, speaker, upcoming)
 *   #competition/<slug>  another page: competition/<slug>/ (the engine)
 *   #points          another page: points/ («نقاطي»)
 *   #event/<slug>    another page: events/<slug>/ (an event)
 *   #page/<slug>     another page: <slug>/ (a service page)
 *
 * In-app taps push a history entry, so the phone's back button closes the
 * sheet. A link opened from outside (share, notification) is cleaned up
 * without leaving a dead back step.
 */

import { closeSheet } from './sheet.js';
import { pageHref, eventHref } from './page/model.js';

let handler = () => {};
let appDepth = 0;
let expecting = false;


export function parseHash(hash) {

  const match = /^#(notifications|meeting|news|game|activity|follow)(?:\/([\w-]{1,60}))?$/.exec(hash || '');

  if (!match) return null;
  if (['news', 'game', 'activity', 'follow'].includes(match[1]) && !match[2]) return null;

  return { name: match[1], id: match[2] || '' };

}


const SLUG = /^[a-z0-9-]{2,40}$/;

/**
 * Hashes that are other pages of the site, relative to the site root:
 * #competition/<slug> → 'competition/<slug>/', #points → 'points/',
 * #event/<slug> → 'events/<slug>/', #page/<slug> → '<slug>/', else ''.
 */
export function pageForHash(hash) {

  const competition = /^#competition\/([^/?#]*)\/?$/.exec(hash || '');

  if (competition) return SLUG.test(competition[1]) ? `competition/${competition[1]}/` : '';
  if (/^#points\/?$/.test(hash || '')) return 'points/';

  const entry = /^#(event|page)\/([^/?#]*)\/?$/.exec(hash || '');

  if (entry) return entry[1] === 'event' ? eventHref(entry[2]) : pageHref(entry[2]);

  return '';

}


/* The other page replaces this history entry, so the back button returns
   to the site (a kept #competition/… entry would redirect again). */
export function followPageHash(hash = location.hash) {

  const page = pageForHash(hash);

  if (!page) return false;

  location.replace(new URL(page, document.baseURI).href);

  return true;

}


export function startRouter(open) {

  handler = open;

  window.addEventListener('hashchange', () => {
    if (followPageHash()) return;
    const route = parseHash(location.hash);
    // a change we didn't make is the back button (or a typed link)
    if (expecting) expecting = false;
    else appDepth = route ? Math.max(0, appDepth - 1) : 0;
    if (route) handler(route);
    else closeSheet({ fromRoute: true });
  });

}


/* Re-evaluate the current hash (first load, or after content arrives). */
export function resolveRoute() {

  const route = parseHash(location.hash);

  if (route) handler(route);

}


export function go(name, id) {

  const hash = `#${name}${id ? `/${id}` : ''}`;

  if (location.hash === hash) {
    handler(parseHash(hash));
    return;
  }

  appDepth += 1;
  expecting = true;
  location.hash = hash;

}


/* Called when the visitor closes a sheet. */
export function leave({ fromRoute = false } = {}) {

  if (fromRoute || !parseHash(location.hash)) {
    return;
  }

  if (appDepth > 0) {
    appDepth -= 1;
    expecting = true;
    history.back();
  }
  else {
    history.replaceState(history.state, '', location.href.split('#')[0]);
  }

}
