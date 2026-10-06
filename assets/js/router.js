/**
 * ROUTER: shareable deep links for the sheets.
 *   #notifications   the bell
 *   #news/<id>       a news item
 *   #game/<id>       a game
 *   #meeting         the next meeting (topic, speaker, upcoming)
 *
 * In-app taps push a history entry, so the phone's back button closes the
 * sheet. A link opened from outside (share, notification) is cleaned up
 * without leaving a dead back step.
 */

import { closeSheet } from './sheet.js';

let handler = () => {};
let appDepth = 0;
let expecting = false;


export function parseHash(hash) {

  const match = /^#(notifications|meeting|news|game)(?:\/([\w-]{1,60}))?$/.exec(hash || '');

  if (!match) return null;
  if ((match[1] === 'news' || match[1] === 'game') && !match[2]) return null;

  return { name: match[1], id: match[2] || '' };

}


export function startRouter(open) {

  handler = open;

  window.addEventListener('hashchange', () => {
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
    history.replaceState(history.state, '', location.pathname + location.search);
  }

}
