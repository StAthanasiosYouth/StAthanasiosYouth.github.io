/**
 * Boot: show the cached copy instantly (returning visitors), fetch the
 * published content.json, and keep the meeting widget current.
 */

import { fetchContent, readCached } from './content.js';
import { renderPage, renderError, tickMeeting, visibilityKey } from './render.js';
import { zonedNow, stamp } from './schedule.js';
import { shareLink, openQr } from './share.js';

let current = null;
let shownKey = '';

const actions = {
  share: () => shareLink(current.site),
  qr: () => openQr(current.site)
};


function clock() {

  const now = zonedNow(current ? current.timezone : 'Africa/Cairo');

  return { now, stamp: stamp(now) };

}


function show(content, animate) {

  current = content;

  const time = clock();

  renderPage(content, time, actions, { animate });
  shownKey = visibilityKey(content, time.stamp);

}


async function load() {

  const cached = readCached();

  if (cached && !current) {
    show(cached, true);
  }

  try {
    const fresh = await fetchContent();
    // compare the content itself, not just the revision label of the cached copy
    if (!current || JSON.stringify(fresh) !== JSON.stringify(current)) {
      show(fresh, !current);
    }
  }
  catch (error) {
    console.warn(error);
    if (!current) {
      renderError(load);
    }
  }

}


/* Meeting wording changes with the clock; scheduled links come and go. */
function tick() {

  if (!current || document.hidden) {
    return;
  }

  const time = clock();

  if (visibilityKey(current, time.stamp) !== shownKey) {
    show(current, false);
  }
  else {
    tickMeeting(time.now);
  }

}

setInterval(tick, 20000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    tick();
    // pick up a publish that happened while the tab was in the background
    if (current) load();
  }
});

/* This page is never meant to be embedded by another site (clickjacking).
   GitHub Pages can't send frame headers, so leave the frame instead. */
if (window.top !== window.self) {
  try {
    window.top.location.replace(window.location.href);
  }
  catch {
    // sandboxed frame: nothing more we can do
  }
}

load();
