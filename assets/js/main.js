/**
 * Boot: show the cached copy instantly (returning visitors), fetch the
 * published content.json, keep time-based states current, and wire the
 * top bar (bell, sound), the sheets and deep links.
 */

import { fetchContent, readCached } from './content.js';
import { renderPage, renderError, tickPage, visibilityKey, meetingSnapshot } from './render.js';
import { zonedNow, stamp, meetingStatus } from './schedule.js';
import { shareLink, openQr, shareRow } from './share.js';
import { startRouter, resolveRoute, go, leave, parseHash } from './router.js';
import { openSheet, closeSheet, sheetStyles } from './sheet.js';
import { openBell } from './bell.js';
import { gameStates, visibleNews } from './hub.js';
import { itemSheetContent, typeOf, visibleItems } from './items.js';
import { isSectionLive, liveSections } from './layout.js';
import { openExperience, prepareExperience, hasScene } from './xp.js';
import { iconNode } from './icons.js';
import { particles } from './motion.js';
import { startFeel } from './feel.js';
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
    else {
      // same content, but the server's clock is known now: apply it at once
      // (the cached render used the device clock, which may be wrong)
      tick();
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

  // a deep link never opens something whose section isn't showing
  const live = section => isSectionLive(current, time.stamp, section);
  const share = (hash, title) => shareRow(current.site, hash, title);

  if (route.name === 'notifications') {
    openBell(current, time.stamp);
    return;
  }

  if (route.name === 'news') {
    const item = live('news') && visibleNews(current, time.stamp).find(n => n.id === route.id);
    if (!item) return missing();
    withDetail(d => openSheet({ title: item.title, content: d.newsSheetContent(item, time.stamp, share), onClose }));
    return;
  }

  if (route.name === 'activity') {
    const item = (current.activities || []).find(a => a.id === route.id);
    const section = item && liveSections(current, time.stamp).find(s => s.key === item.section);
    if (!item || !section || !visibleItems(current, item.section, time.stamp).includes(item)) return missing();
    withDetail(d => openSheet({ title: item.title, content: itemSheetContent(item, typeOf(current, item), section, time.stamp, share, d.mediaHero), onClose }));
    return;
  }

  if (route.name === 'follow') {
    const link = followableLink(route.id, time.stamp);
    if (!link) return missing();
    openExperience(link, { content: current }, onClose);
    return;
  }

  if (route.name === 'game') {
    const entry = live('games') && gameStates(current, time.stamp).find(g => g.game.id === route.id);
    if (!entry) return missing();
    withDetail(d => {
      const { node, card } = d.gameSheetContent(entry, share);
      sheetCards = [card];
      openSheet({ title: entry.game.title, content: node, onClose });
    });
    return;
  }

  if (route.name === 'meeting') {
    if (!live('meeting')) return missing();
    const status = meetingSnapshot() || meetingStatus(current.meeting, time.now, current.sessions);
    const title = status && status.state === 'live' ? 'الاجتماع دلوقتي'
      : status && status.session && status.session.topic ? 'الاجتماع الجاي' : (current.meeting ? current.meeting.title : 'الاجتماع');
    withDetail(d => openSheet({ title, content: d.meetingSheetContent(current, status, time.stamp), onClose }));
  }

}


/* the sheets' content (detail.js) is not part of the first visit: it comes
   with the sheets' stylesheet (the first touch, or a deep link). A route
   that changed meanwhile is not opened late. */
let detailModule = null;

const detail = () => (detailModule ||= import('./detail.js'));

function withDetail(open) {

  const hash = location.hash;

  detail().then(module => {
    if (location.hash === hash) open(module);
  }).catch(error => console.warn(error));

}


/* a link with a mini-experience that is showing right now */
function followableLink(id, nowStamp) {

  const live = new Set(liveSections(current, nowStamp).map(s => s.key));
  const candidates = [
    ...(live.has('featured') ? current.featured : []),
    ...current.sections.filter(s => live.has(s.key)).flatMap(s => s.links)
  ];

  return candidates.find(link => link.id === id && hasScene(link.experience)) || null;

}


/* a shared link to something that already expired */
function missing() {

  history.replaceState(history.state, '', location.href.split('#')[0]);
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

  scrollBar(bar, hero.querySelector('.hero__name'));

  // a soft tap sound on buttons and cards (only when enabled)
  document.addEventListener('click', event => {
    if (event.target.closest('#sound-toggle, .sheet__close')) return;
    if (event.target.closest('button, a.btn, .tile, .row-link, .note-item, .news-card, .news-lead')) play('tap');
  });

  // a social link: its scene starts loading as the finger lands (or the mouse arrives)
  const prepare = event => {
    const link = event.target.closest && event.target.closest('[data-experience]');
    if (link) prepareExperience(link.dataset.experience);
  };
  document.addEventListener('pointerdown', prepare, { passive: true });
  document.addEventListener('pointerover', prepare, { passive: true });

  // the sheets' stylesheet: on the first touch, click or key, before any
  // sheet can open (a deep link loads it itself)
  const warm = () => {
    sheetStyles();
    detail();
    for (const type of ['pointerdown', 'keydown']) document.removeEventListener(type, warm, true);
  };
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, warm, { capture: true, passive: true });

  particles(hero.querySelector('.hero__dust'), 'dust');

}


/*
 * The bar follows the scroll continuously (main.css, "top bar"):
 * --brand-at = how far the page scrolls before the hero's name passes under
 * the bar (the compact name glides in from there). Browsers without
 * scroll-driven animations get --p / --pb from here, once per frame.
 * .is-compact (the reduced-motion end state) flips when the name is gone.
 */
function scrollBar(bar, name) {

  const RANGE = 120;
  const BRAND = 90;
  const native = typeof CSS !== 'undefined' && CSS.supports('animation-timeline: scroll()');
  let brandAt = 160;
  let pending = false;

  const measure = () => {
    // layout position (offsets ignore the hero's own scroll transform)
    let top = name.offsetHeight;
    for (let el = name; el; el = el.offsetParent) top += el.offsetTop;
    brandAt = Math.max(24, Math.round(top - bar.offsetHeight - 28));
    bar.style.setProperty('--brand-at', `${brandAt}px`);
  };

  const clamp = v => Math.min(1, Math.max(0, v));

  const paint = () => {
    pending = false;
    if (document.documentElement.dataset.motion === 'reduced') {
      bar.style.removeProperty('--p');
      bar.style.removeProperty('--pb');
      return;
    }
    const y = scrollY;
    bar.style.setProperty('--p', clamp(y / RANGE).toFixed(3));
    bar.style.setProperty('--pb', clamp((y - brandAt) / BRAND).toFixed(3));
  };

  const schedule = () => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(paint);
    }
  };

  // again whenever the page above the fold reflows (fonts, the rendered
  // widgets next to the hero on desktop, a rotated phone)
  measure();
  new ResizeObserver(() => { measure(); if (!native) schedule(); }).observe(document.getElementById('main'));

  if (!native) {
    addEventListener('scroll', schedule, { passive: true });
    schedule();
  }

  new IntersectionObserver(entries => {
    bar.classList.toggle('is-compact', !entries[0].isIntersecting);
  }, { rootMargin: `-${bar.offsetHeight + 4}px 0px 0px 0px` }).observe(name);

}


/* =========================================================
   PUSH NOTIFICATIONS
   push.js (and Firebase) load only when something needs doing; this
   reads the device's memo (push-env.js MEMO_KEY) to decide.
========================================================= */

const PUSH_MEMO = 'athanasios.push.v1';
// the token refresh and the invitation's gap (push-env.js REFRESH_MS, NUDGE_GAP_MS)
const PUSH_WEEK_MS = 7 * 86400000;

function startPush() {

  const nav = navigator;
  const supported = 'serviceWorker' in nav && 'PushManager' in window && 'Notification' in window;

  // a notification tapped while the site is open: sw.js asks us to open its item
  if ('serviceWorker' in nav) {
    nav.serviceWorker.addEventListener('message', event => {
      const data = event.data;
      if (!data || data.type !== 'athanasios:open' || typeof data.url !== 'string') return;
      const url = new URL(data.url, location.href);
      const route = url.origin === location.origin ? parseHash(url.hash) : null;
      if (route) go(route.name, route.id);
    });
  }

  let memo = {};
  try {
    memo = JSON.parse(localStorage.getItem(PUSH_MEMO) || 'null') || {};
    // one visit per browser session (for the invitation, from the second visit)
    if (!sessionStorage.getItem(PUSH_MEMO)) {
      sessionStorage.setItem(PUSH_MEMO, '1');
      memo.visits = (Number(memo.visits) || 0) + 1;
      localStorage.setItem(PUSH_MEMO, JSON.stringify(memo));
    }
  }
  catch {
    return;   // no storage: nothing to remember, nothing to refresh
  }

  const later = run => setTimeout(() => {
    const idle = window.requestIdleCallback || (fn => fn());
    idle(() => import('./push.js').then(run).catch(error => console.warn(error)));
  }, 6000);

  if (memo.token) {
    // subscribed: confirm the token weekly, or tidy up if it was turned off in the browser
    if (!supported || Notification.permission !== 'granted' || !(Date.now() - (Number(memo.at) || 0) < PUSH_WEEK_MS)) {
      later(push => push.refresh());
    }
    return;
  }

  if (supported && Notification.permission === 'default' && (Number(memo.visits) || 0) >= 2 &&
      (Number(memo.nudges) || 0) < 2 && Date.now() - (Number(memo.nudgedAt) || 0) >= PUSH_WEEK_MS) {
    later(push => push.maybeNudge());
  }

}


/* =========================================================
   START
========================================================= */

function startSite() {

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

  startFeel();
  setupTopbar();
  startRouter(openRoute);
  load();
  startPush();

}


/* the admin's preview (preview.js): same page, the draft instead of content.json */
function startPreview() {

  startFeel();
  setupTopbar();
  startRouter(openRoute);
  setInterval(tick, 15000);

  import('./preview.js').then(({ listen }) => listen(content => {
    const first = !current;
    closeSheet({ silent: true });
    show(content, true);
    if (first) resolveRoute();
  }));

}


if (document.documentElement.hasAttribute('data-preview')) {
  startPreview();
}
else {
  startSite();
}
