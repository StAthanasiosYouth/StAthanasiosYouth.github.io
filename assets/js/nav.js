/**
 * NAV: one navigation for every public page (docs/PHASE8-PLAN.md §1, BACKEND-MIGRATION §22.1 item 24).
 *
 *  - Phones: a bottom bar of three slots + «حسابي» + «المزيد». On the home page the three slots are the places
 *    nearest to where you are (the section you are in, lit, and its neighbours; «الرئيسية» is the top), and they
 *    follow the scroll; on any other page they are «الرئيسية · الفعاليات · المسابقات». «حسابي» never moves: the
 *    account icon leaves the top bar for it (nav.css). «المزيد» opens every other place in one sheet.
 *    Wide screens keep today's navigation.
 *  - The top bar's «ارجع للموقع» shows as a Home icon (nav.css; the link and its text stay for no-JS and the
 *    builders' markup). It and «الرئيسية» go back in history when the page before was the home page, so the
 *    visitor lands where they were; otherwise they open the home page.
 *  - Same-origin pages are fetched on intent (touch / hover), so the next page is ready. The move between pages
 *    is a cross-document view transition (each page's own CSS opts in).
 *
 * Real URLs, deep links, push taps and the browser's Back are untouched. Nothing runs inside a frame (the
 * admin's preview). Imported once by each page's entry module: mountNav().
 */

import { accountBadge } from './account/link.js';

const ROOT = new URL('../../', import.meta.url);
const PHONE = '(max-width: 767px)';
const SVG = 'http://www.w3.org/2000/svg';
/* the site's line icons: 24px, stroke 1.6, a soft duo layer (icons.js) */
const ICONS = {
  home: ['M4 10.6 12 4l8 6.6V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5h-6v5.5H5.5A1.5 1.5 0 0 1 4 19z', 'M4 10.6 12 4l8 6.6'],
  calendar: ['M6 5h12a2.5 2.5 0 0 1 2.5 2.5v10.5a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V7.5A2.5 2.5 0 0 1 6 5z', 'M3.5 9.5h17M8 3v4M16 3v4M8 13.5h2M14 13.5h2M8 16.5h2'],
  trophy: ['M8 4h8v5a4 4 0 0 1-8 0z', 'M8 6H5.5a2.5 2.5 0 0 0 2.6 3.6M16 6h2.5a2.5 2.5 0 0 1-2.6 3.6M12 13v3.5M8.5 20.5h7M9.5 16.5h5'],
  more: ['M5.5 4.5h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM14.5 13.5h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z', 'M5.5 4.5h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM14.5 4.5h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM5.5 13.5h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM14.5 13.5h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z']
};
/* the home page's sections «الفعاليات» lands on, the first one that is showing */
const EVENT_SECTIONS = ['activities', 'services', 'competitions'];

let mounted = false;
/* while «الفعاليات» scrolls the page there, its light stays on (no flicker on the way) */
let showing = null;
let barRef = null;
let contentPromise = null;
const prefetched = new Set();

/* the move between pages, decided on the page being left (its listener is there in time):
   - a page that sends the visitor straight on (signed out «نقاطي» → the account) makes no half transition
   - the account page has its own choreography (DESIGN.md, «العتبة»: signing in is its own transition), so the
     move into or out of it is plain
   - an aborted transition is never an error on the page */
const quiet = vt => { for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) if (p && p.catch) p.catch(() => {}); };
const ownMotion = url => { try { return /^\/account\//.test(new URL(url).pathname.slice(ROOT.pathname.length - 1)); } catch { return false; } };
if (typeof addEventListener === 'function') {
  addEventListener('pageswap', event => {
    const vt = event.viewTransition;
    if (!vt) return;
    quiet(vt);
    const to = event.activation && event.activation.entry && event.activation.entry.url;
    if ((event.activation && event.activation.navigationType === 'replace') || ownMotion(location.href) || (to && ownMotion(to))) vt.skipTransition();
  });
  addEventListener('pagereveal', event => {
    if (event.viewTransition) quiet(event.viewTransition);
  });
}

function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'icon icon--line');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const [duo, line] = ICONS[name];
  for (const [d, cls] of [[duo, 'duo'], [line, '']]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    if (cls) path.setAttribute('class', cls);
    svg.append(path);
  }
  return svg;
}

export const isHomeUrl = url => url.origin === ROOT.origin && (url.pathname === ROOT.pathname || url.pathname === ROOT.pathname + 'index.html');
const onHome = () => isHomeUrl(new URL(location.href));

/* the page before this one, in this tab, was the home page: Back returns to it as it was */
export function cameFromHome(referrer = document.referrer, entry = performance.getEntriesByType?.('navigation')[0]) {
  try {
    if (!referrer || history.length < 2) return false;
    if (entry && entry.type === 'back_forward') return false;
    return isHomeUrl(new URL(referrer));
  }
  catch {
    return false;
  }
}

function reduced() {
  return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/* the home link and the «الرئيسية» tab */
function goHome(event) {
  if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (onHome()) {
    event.preventDefault();
    scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    return;
  }
  if (cameFromHome()) {
    event.preventDefault();
    history.back();
  }
}

/* «الفعاليات» on the home page: the section, once it has been drawn (the content arrives after the page) */
export function sectionFor(doc = document) {
  for (const key of EVENT_SECTIONS) {
    const el = doc.querySelector(`[data-area="items"][data-key="${key}"]`);
    if (el) return el;
  }
  return null;
}

function showEvents({ smooth = true } = {}) {
  scrollToArea(sectionFor, { smooth, tab: 'auto' });
}

/* scroll the home page to a section once it is drawn; the bar says where we are going */
function scrollToArea(find, { smooth = true, tab: going = null } = {}) {
  let tries = 0;
  showing = going === 'auto' ? null : going;
  if (barRef) mark(barRef);
  const look = () => {
    const el = find();
    if (el) {
      if (going === 'auto') { showing = el.dataset.key || null; if (barRef) mark(barRef); }
      el.scrollIntoView({ block: 'start', behavior: smooth && !reduced() ? 'smooth' : 'auto' });
      setTimeout(() => { showing = null; if (barRef) mark(barRef); }, smooth && !reduced() ? 900 : 50);
      return;
    }
    if (tries++ < 40) setTimeout(look, 150);
    else { showing = null; if (barRef) mark(barRef); }
  };
  look();
}

function tab(href, name, word, cls) {
  const link = document.createElement(href ? 'a' : 'button');
  link.className = 'tabbar__tab' + (cls ? ' ' + cls : '');
  if (href) link.href = href;
  else link.type = 'button';
  link.dataset.tab = name;
  link.append(icon({ events: 'calendar', comps: 'trophy', more: 'more' }[name] || 'home'));
  const label = document.createElement('span');
  label.className = 'tabbar__word';
  label.textContent = word;
  link.append(label);
  return link;
}

/* which tab this page belongs to (the pages other than home) */
export function currentTab(path = location.pathname) {
  const root = ROOT.pathname;
  const rest = path.startsWith(root) ? path.slice(root.length) : path.replace(/^\//, '');
  if (rest === '' || rest === 'index.html') return 'home';
  if (/^(?:points|competition)\//.test(rest)) return 'comps';
  if (/^account\//.test(rest)) return 'account';
  return 'events';
}

/* ---------- the home page: the three places nearest to where you are ---------- */

/* short words for the bar; the rest says its own title */
const WORDS = { top: 'الرئيسية', featured: 'مميز', meeting: 'الاجتماع', news: 'الأخبار', games: 'الألعاب', competitions: 'المسابقات', activities: 'الفعاليات', services: 'خدماتنا', location: 'المكان', social: 'تابعنا', contacts: 'تواصل', support: 'الدعم', share: 'شارك', points: 'نقاطي' };
const GLYPHS = { featured: 'sparkle', meeting: 'calendar', news: 'megaphone', games: 'star', competitions: 'trophy', activities: 'ticket', services: 'church', location: 'map', social: 'users', contacts: 'phone', support: 'info', share: 'share', points: 'trophy' };
const SKIP = ['hero', 'footer', 'error', 'announcement'];

/* the home page's sections in the order they show, with «الرئيسية» (the top) first */
export function homePlaces(doc = document) {
  const main = doc.querySelector('main.hub');
  if (!main) return [];
  const places = [{ key: 'top', el: main.querySelector('[data-area="hero"]') || main, word: WORDS.top }];
  for (const el of main.querySelectorAll(':scope > [data-area]')) {
    const area = el.dataset.area;
    if (SKIP.includes(area) || el.classList.contains('skeleton')) continue;
    const key = area === 'items' ? el.dataset.key : area === 'section' ? (el.getAttribute('aria-labelledby') || '').replace(/^section-/, '') : area;
    if (!key || places.some(p => p.key === key)) continue;
    const heading = el.querySelector('h2, h3');
    places.push({ key, el, word: WORDS[key] || (heading ? heading.textContent.trim() : key) });
  }
  return places;
}

/* which place you are in: the last one whose top has passed a line a third down the screen */
export function placeIndex(places, line = innerHeight * 0.38) {
  let index = 0;
  places.forEach((p, i) => { if (i && p.el.getBoundingClientRect().top <= line) index = i; });
  return index;
}

/* three slots around the current one (it and its neighbours), never past the ends */
export function windowStart(index, count, size = 3) {
  if (count <= size) return 0;
  return Math.max(0, Math.min(index - 1, count - size));
}

let iconsModule = null;
let shownWindow = '';

function placeTab(place, current) {
  const link = document.createElement('a');
  link.className = 'tabbar__tab';
  link.href = place.key === 'top' ? new URL('index.html', ROOT).href : new URL('index.html#to-' + place.key, ROOT).href;
  link.dataset.tab = place.key;
  if (place.key === 'top') link.append(icon('home'));
  else if (iconsModule) link.append(iconsModule.iconNode(GLYPHS[place.key] || 'link'));
  else link.append(icon('more'));
  const label = document.createElement('span');
  label.className = 'tabbar__word';
  label.textContent = place.word;
  link.append(label);
  if (current) link.setAttribute('aria-current', 'location');
  link.addEventListener('click', event => {
    if (event.button > 0 || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    if (place.key === 'top') {
      showing = 'top';
      scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
      setTimeout(() => { showing = null; if (barRef) mark(barRef); }, reduced() ? 50 : 900);
      mark(barRef);
      return;
    }
    scrollToArea(() => place.el.isConnected ? place.el : areaElement({ key: place.key, kind: 'items' }), { tab: place.key });
  });
  return link;
}

let shownStart = null;
const SLIDE = 'cubic-bezier(.32, .72, 0, 1)';

/* the slots move like a strip of three: scrolling down, the far one (right) leaves to the right and the next
   comes in from the left, out of the line beside «حسابي»; scrolling up, the other way round */
function markHome(bar) {
  const slots = bar.querySelector('.tabbar__slots');
  const places = homePlaces();
  if (!places.length) return;
  let index = showing ? places.findIndex(p => p.key === showing) : -1;
  if (index < 0) index = placeIndex(places);
  const start = windowStart(index, places.length);
  const picked = places.slice(start, start + 3);
  const litKey = places[index].key;
  const key = picked.map(p => p.key).join() + '|' + litKey;
  if (key === shownWindow) return;
  shownWindow = key;
  const dir = shownStart === null || start === shownStart ? 0 : start > shownStart ? 1 : -1;
  shownStart = start;
  const old = new Map([...slots.children].filter(n => !n.inert).map(n => [n.dataset.tab, n]));
  const before = new Map([...old].map(([k, n]) => [k, n.getBoundingClientRect()]));
  const nodes = picked.map(p => old.get(p.key) || placeTab(p, false));
  const leaving = [...old].filter(([k]) => !picked.some(p => p.key === k)).map(([, n]) => n);
  slots.replaceChildren(...nodes);
  for (const n of nodes) {
    if (n.dataset.tab === litKey) n.setAttribute('aria-current', 'location');
    else n.removeAttribute('aria-current');
  }
  placeLens(bar);
  if (!dir || reduced()) return;
  const box = slots.getBoundingClientRect();
  const step = box.width / 3;
  for (const n of nodes) {
    const was = before.get(n.dataset.tab);
    const now = n.getBoundingClientRect();
    if (was) {
      const dx = was.left - now.left;
      if (Math.abs(dx) > 1) n.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 420, easing: SLIDE });
    }
    else n.animate([{ transform: `translateX(${dir > 0 ? -step : step}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: SLIDE });
  }
  for (const n of leaving) {
    const was = before.get(n.dataset.tab);
    n.inert = true;
    n.removeAttribute('aria-current');
    n.classList.add('is-leaving');
    n.style.left = (was.left - box.left) + 'px';
    n.style.width = was.width + 'px';
    slots.append(n);
    n.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${dir > 0 ? step : -step}px)`, opacity: 0 }], { duration: 360, easing: SLIDE, fill: 'forwards' })
      .finished.then(() => n.remove(), () => n.remove());
  }
}

function mark(bar) {
  if (!bar) return;
  if (onHome()) { markHome(bar); return; }
  const current = currentTab();
  for (const link of bar.querySelectorAll('[data-tab]')) {
    if (link.dataset.tab === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  placeLens(bar);
}

/* one glass lens behind the lit place: it glides from one to the next (never a jump), and keeps up
   when the bar draws in or opens. Its target is the tab's own place (offsets ignore a slide in progress). */
function placeLens(bar, instant = false) {
  const lens = bar && bar.querySelector('.tabbar__lens');
  if (!lens || !bar.isConnected) return;
  const lit = [...bar.querySelectorAll('[aria-current]')].find(n => !n.inert);
  if (!lit) { lens.style.opacity = '0'; return; }
  let x = lit.offsetLeft;
  let y = lit.offsetTop;
  const parent = lit.offsetParent;
  if (parent && parent !== bar && bar.contains(parent)) { x += parent.offsetLeft; y += parent.offsetTop; }
  if (instant || reduced()) lens.style.transition = 'none';
  lens.style.width = lit.offsetWidth + 'px';
  lens.style.height = lit.offsetHeight + 'px';
  lens.style.transform = `translate(${x}px, ${y}px)`;
  lens.style.opacity = '1';
  if (instant || reduced()) { void lens.offsetWidth; lens.style.transition = ''; }
}

function buildBar() {
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.setAttribute('aria-label', 'أقسام الموقع');
  const lens = document.createElement('span');
  lens.className = 'tabbar__lens';
  lens.setAttribute('aria-hidden', 'true');
  bar.append(lens);
  barRef = bar;
  // three slots: on the home page the places nearest to you; on any other page the way back and the main places
  const slots = document.createElement('div');
  slots.className = 'tabbar__slots';
  bar.append(slots);
  if (!onHome()) {
    const home = tab(new URL('index.html', ROOT).href, 'home', 'الرئيسية');
    home.addEventListener('click', goHome);
    slots.append(home, tab(new URL('index.html#activities', ROOT).href, 'events', 'الفعاليات'), tab(new URL('points/', ROOT).href, 'comps', 'المسابقات'));
  }
  // «حسابي» never moves: the account icon itself (its face, its sign-in and «ارجع للموقع» rules), with a word
  const account = accountBadge(bar, ROOT, { cls: 'tabbar__tab tabbar__fixed', caption: 'حسابي' });
  if (account) account.dataset.tab = 'account';
  // «المزيد»: everything else, in one sheet
  const more = tab('', 'more', 'المزيد', 'tabbar__fixed');
  more.setAttribute('aria-haspopup', 'dialog');
  more.addEventListener('click', () => openMore(more));
  bar.append(more);
  // the tab of the page you are on takes you to its top
  bar.addEventListener('click', event => {
    const link = event.target.closest('[data-tab]');
    if (!link || link.tagName !== 'A' || link.getAttribute('aria-current') !== 'page') return;
    if (new URL(link.href).pathname === location.pathname) {
      event.preventDefault();
      scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    }
  });
  mark(bar);
  return bar;
}

/* ---------- «المزيد»: every place on the site, one tap away ---------- */

const AREA_ICON = { featured: 'sparkle', meeting: 'calendar', news: 'megaphone', games: 'star', location: 'map', contacts: 'phone', support: 'info', share: 'share', points: 'trophy' };
const ITEM_ICON = { competitions: 'trophy', activities: 'ticket', services: 'church' };

/* the published content (the same file the home page reads first), once */
function siteContent() {
  contentPromise ||= fetch(new URL('content.json', ROOT).href, { cache: 'no-cache', credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : null)).catch(() => null);
  return contentPromise;
}

/* a home section's element, by its layout entry */
export function areaElement(entry, doc = document) {
  if (!entry) return null;
  if (entry.kind === 'items') return doc.querySelector(`[data-area="items"][data-key="${entry.key}"]`);
  if (entry.kind === 'links') return doc.querySelector(`section[aria-labelledby="section-${entry.key}"]`);
  return doc.querySelector(`[data-area="${entry.kind}"]`);
}

/* what «المزيد» lists: the home page's sections (in the page's order), the social pages, the site's pages */
export function moreGroups(content, { home = false, doc = document } = {}) {
  const layout = (content && content.layout) || [];
  const shown = entry => {
    if (home) return !!areaElement(entry, doc);
    if (entry.kind === 'items') return (content.activities || []).some(a => a.section === entry.key);
    if (entry.kind === 'news') return (content.news || []).length > 0;
    if (entry.kind === 'games') return (content.games || []).length > 0;
    return true;
  };
  const places = layout.filter(e => e.kind !== 'links' && shown(e)).map(e => ({
    key: e.key, kind: e.kind, title: e.title || e.key,
    icon: e.kind === 'items' ? ITEM_ICON[e.key] || 'calendar' : AREA_ICON[e.kind] || 'link'
  }));
  const social = ((content && content.sections) || []).flatMap(s => (s.links || []).filter(l => /^https:\/\//.test(l.url || '')).map(l => ({ title: l.title, url: l.url, icon: l.icon || 'link' })));
  const pages = ((content && content.pages) || []).filter(p => /^[a-z0-9-]{2,40}$/.test(p.slug || '')).map(p => ({ title: p.title, href: new URL(p.slug + '/', ROOT).href, icon: 'theatre' }));
  pages.push({ title: 'نقاطي والمسابقات', href: new URL('points/', ROOT).href, icon: 'trophy' });
  return [
    { title: 'في الرئيسية', items: places },
    { title: 'تابعنا', items: social },
    { title: 'صفحات الأسرة', items: pages }
  ].filter(g => g.items.length);
}

function closeMore(dialog) {
  if (!dialog.open) return;
  dialog.classList.add('is-closing');
  const done = () => { dialog.close(); dialog.remove(); };
  if (reduced()) done();
  else setTimeout(done, 200);
}

async function openMore(button) {
  if (document.querySelector('dialog.nav-more')) return;
  const [content, icons] = await Promise.all([siteContent(), import('./icons.js').catch(() => null)]);
  const glyph = name => (icons ? icons.iconNode(name) : icon('more'));
  iconsModule ||= icons;
  const dialog = document.createElement('dialog');
  dialog.className = 'nav-more';
  dialog.setAttribute('aria-labelledby', 'nav-more-title');
  const head = document.createElement('div');
  head.className = 'nav-more__head';
  const title = document.createElement('h2');
  title.id = 'nav-more-title';
  title.textContent = 'المزيد';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'nav-more__close';
  close.setAttribute('aria-label', 'اقفل');
  close.append(glyph('close'));
  close.addEventListener('click', () => closeMore(dialog));
  head.append(title, close);
  dialog.append(head);
  const groups = moreGroups(content || {}, { home: onHome() });
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'nav-more__group';
    const h = document.createElement('h3');
    h.textContent = group.title;
    const list = document.createElement('div');
    list.className = 'nav-more__grid';
    for (const item of group.items) {
      const link = document.createElement('a');
      link.className = 'nav-more__tile';
      if (item.url) { link.href = item.url; link.target = '_blank'; link.rel = 'noopener'; }
      else if (item.href) link.href = item.href;
      else {
        link.href = new URL('index.html#to-' + item.key, ROOT).href;
        link.addEventListener('click', event => {
          if (!onHome()) return;
          event.preventDefault();
          closeMore(dialog);
          scrollToArea(() => areaElement(item), { tab: item.key });
        });
      }
      const i = document.createElement('span');
      i.className = 'nav-more__icon';
      i.append(glyph(item.icon));
      const word = document.createElement('span');
      word.className = 'nav-more__word';
      word.textContent = item.title;
      link.append(i, word);
      list.append(link);
    }
    section.append(h, list);
    dialog.append(section);
  }
  if (!groups.length) {
    const empty = document.createElement('p');
    empty.className = 'nav-more__empty';
    empty.textContent = 'مفيش اتصال دلوقتي. جرّب تاني بعد شوية.';
    dialog.append(empty);
  }
  // a tap outside the sheet closes it; Esc too (the dialog's own cancel)
  dialog.addEventListener('click', event => { if (event.target === dialog) closeMore(dialog); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeMore(dialog); });
  dialog.addEventListener('close', () => button.focus({ preventScroll: true }));
  document.body.append(dialog);
  dialog.showModal();
}

/* a link from another page to a home section (/index.html#to-<key>): there, once it is drawn */
async function followToHash() {
  const m = /^#to-([a-z0-9-]{2,40})$/.exec(location.hash);
  if (!m || !onHome()) return;
  const content = await siteContent();
  const entry = ((content && content.layout) || []).find(e => e.key === m[1]);
  if (!entry) return;
  scrollToArea(() => areaElement(entry), { smooth: false, tab: entry.key });
  setTimeout(() => history.replaceState(history.state, '', location.pathname + location.search), 1500);
}

/* the next page, fetched while the finger is still on the link */
function prefetch(link) {
  if (!link || !link.href || link.target === '_blank' || link.hasAttribute('download')) return;
  let url;
  try {
    url = new URL(link.href);
  }
  catch {
    return;
  }
  if (url.origin !== location.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  if (/^\/(?:admin|media|assets)\//.test(url.pathname.slice(ROOT.pathname.length - 1)) || !/(?:\/|\.html)$/.test(url.pathname)) return;
  const key = url.origin + url.pathname;
  if (key === location.origin + location.pathname || prefetched.has(key) || prefetched.size > 24) return;
  prefetched.add(key);
  const hint = document.createElement('link');
  hint.rel = 'prefetch';
  hint.href = key;
  document.head.append(hint);
}

function withSheet(done) {
  if (document.querySelector('link[data-nav-css]')) { done(); return; }
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = new URL('assets/css/nav.css', ROOT).href;
  sheet.dataset.navCss = '';
  sheet.addEventListener('load', done, { once: true });
  sheet.addEventListener('error', done, { once: true });
  document.head.append(sheet);
}

export function mountNav() {
  if (mounted) return;
  mounted = true;
  try {
    if (window.top !== window.self) return;
  }
  catch {
    return;
  }

  // «ارجع للموقع» → the Home icon (the look is CSS; the name and the way home are here)
  for (const link of document.querySelectorAll('.pbar__home, .cbar__home')) {
    // the account page's link returns to the page you came from (account/app.js): its name says so
    let toHome = true;
    try { toHome = isHomeUrl(new URL(link.href)); } catch { /* the home page */ }
    const name = toHome ? 'الرئيسية' : 'ارجع للصفحة اللي كنت فيها';
    link.setAttribute('aria-label', name);
    link.title = name;
    link.addEventListener('click', goHome);
  }

  document.addEventListener('pointerdown', event => prefetch(event.target.closest?.('a[href]')), { passive: true, capture: true });
  document.addEventListener('mouseover', event => {
    const link = event.target.closest?.('a[href]');
    if (link) setTimeout(() => { if (link.matches(':hover')) prefetch(link); }, 80);
  }, { passive: true });

  withSheet(() => import('./icons.js').then(m => { iconsModule = m; }, () => {}).then(() => {
    const bar = buildBar();
    const phone = window.matchMedia ? matchMedia(PHONE) : { matches: false, addEventListener() {} };
    const place = () => {
      document.documentElement.classList.toggle('has-tabbar', phone.matches);
      if (phone.matches && !bar.isConnected) document.body.append(bar);
      if (!phone.matches && bar.isConnected) bar.remove();
    };
    place();
    requestAnimationFrame(() => placeLens(bar, true));
    // drawing in / opening, a turned phone: the lens stays on its place without lagging behind
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => placeLens(bar, true)).observe(bar);
    phone.addEventListener('change', place);
    addEventListener('hashchange', () => mark(bar));
    addEventListener('pageshow', () => mark(bar));
    if (onHome() && location.hash === '#activities') showEvents({ smooth: false });
    followToHash();
    if (onHome()) {
      const main = document.querySelector('main.hub');
      if (main) new MutationObserver(() => { shownWindow = ''; mark(bar); }).observe(main, { childList: true });
    }
    // the light follows the scroll on the home page; going down, the bar draws in to give the page room
    // (icons only), going up it opens again
    let queued = false;
    let lastY = scrollY;
    addEventListener('scroll', () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const y = scrollY;
        if (y > lastY + 8 && y > 220) bar.classList.add('is-compact');
        else if (y < lastY - 8 || y < 120) bar.classList.remove('is-compact');
        if (Math.abs(y - lastY) > 8) lastY = y;
        if (onHome()) mark(bar);
      });
    }, { passive: true });
  }));
}
