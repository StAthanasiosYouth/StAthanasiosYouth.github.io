/**
 * Boot: show the cached copy instantly (returning visitors), fetch the
 * published content.json, keep time-based states current, and wire the
 * top bar (bell, sound), the sheets and deep links.
 */

import { fetchContent, readCached } from './content.js';
import { renderPage, renderError, tickPage, visibilityKey, meetingSnapshot } from './render.js';
import { zonedNow, stamp, meetingStatus } from './schedule.js';
import { shareLink, openQr, shareTarget } from './share.js';
import { startRouter, resolveRoute, go, leave } from './router.js';
import { openSheet, closeSheet } from './sheet.js';
import { openBell } from './bell.js';
import { newsSheetContent, gameSheetContent, meetingSheetContent, gameStates, visibleNews } from './hub.js';
import { iconNode } from './icons.js';
import { particles } from './motion.js';
import { play, soundEnabled, setSoundEnabled } from './sound.js';

let current = null;
let shownKey = '';
let sheetCards = [];

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
    resolveRoute();
  }

  try {
    const fresh = await fetchContent();
    // compare the content itself, not just the revision label of the cached copy
    if (!current || JSON.stringify(fresh) !== JSON.stringify(current)) {
      const first = !current;
      show(fresh, first);
      if (first) resolveRoute();
    }
  }
  catch (error) {
    console.warn(error);
    if (!current) {
      renderError(load);
    }
  }

}


/* Countdowns tick; scheduled things appear, open and expire on time. */
function tick() {

  if (!current || document.hidden) {
    return;
  }

  const time = clock();

  if (visibilityKey(current, time.stamp) !== shownKey) {
    show(current, false);
  }
  else {
    tickPage(current, time);
  }

  for (const card of sheetCards) {
    const entry = gameStates(current, time.stamp).find(g => g.game.id === card.id);
    if (entry) card.update(entry);
  }

}


/* =========================================================
   SHEETS (deep links)
========================================================= */

function openRoute(route) {

  if (!current) {
    return;
  }

  const time = clock();
  const onClose = ({ fromRoute }) => {
    sheetCards = [];
    leave({ fromRoute });
  };

  sheetCards = [];

  if (route.name === 'notifications') {
    openBell(current, time.stamp);
    return;
  }

  if (route.name === 'news') {
    const item = visibleNews(current, time.stamp).find(n => n.id === route.id);
    if (!item) return missing();
    openSheet({ title: item.title, content: newsSheetContent(item, time.stamp, shareTarget(current.site)), onClose });
    return;
  }

  if (route.name === 'game') {
    const entry = gameStates(current, time.stamp).find(g => g.game.id === route.id);
    if (!entry) return missing();
    const { node, card } = gameSheetContent(entry, shareTarget(current.site));
    sheetCards = [card];
    openSheet({ title: entry.game.title, content: node, onClose });
    return;
  }

  if (route.name === 'meeting') {
    const status = meetingSnapshot() || meetingStatus(current.meeting, time.now, current.sessions);
    const title = status && status.session && status.session.topic ? 'الاجتماع الجاي' : (current.meeting ? current.meeting.title : 'الاجتماع');
    openSheet({ title, content: meetingSheetContent(current, status, time.stamp), onClose });
  }

}


/* a shared link to something that already expired */
function missing() {

  history.replaceState(history.state, '', location.pathname + location.search);
  closeSheet({ silent: true });

}


/* =========================================================
   TOP BAR
========================================================= */

function setupTopbar() {

  const bell = document.getElementById('bell');
  const sound = document.getElementById('sound-toggle');
  const bar = document.getElementById('topbar');
  const hero = document.querySelector('.hero');

  bell.addEventListener('click', () => {
    if (current) go('notifications');
  });

  const paintSound = () => {
    const on = soundEnabled();
    sound.replaceChildren(iconNode(on ? 'sound-on' : 'sound-off'));
    sound.setAttribute('aria-pressed', String(on));
    sound.setAttribute('aria-label', on ? 'أصوات الواجهة: شغالة' : 'أصوات الواجهة: مقفولة');
  };

  sound.addEventListener('click', () => {
    const on = !soundEnabled();
    setSoundEnabled(on);
    paintSound();
    if (on) play('success');
  });

  paintSound();

  // the compact name shows once the big hero has scrolled away
  new IntersectionObserver(entries => {
    bar.classList.toggle('is-compact', !entries[0].isIntersecting);
  }, { rootMargin: '-60px 0px 0px 0px' }).observe(hero.querySelector('.hero__name'));

  // a soft tap sound on buttons and cards (only when enabled)
  document.addEventListener('click', event => {
    if (event.target.closest('#sound-toggle, .sheet__close')) return;
    if (event.target.closest('button, a.btn, .tile, .row-link, .note-item, .news-card, .news-lead')) play('tap');
  });

  particles(hero.querySelector('.hero__dust'), 'dust');

}


/* =========================================================
   START
========================================================= */

setInterval(tick, 15000);

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

setupTopbar();
startRouter(openRoute);
load();
