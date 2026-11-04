/**
 * GAME INTRO: a short, lively welcome into a game or a challenge (Phase 8 track P, owner 2026-11-04).
 *
 * Part of the page, not a separate scene: it lies over the place the game opens in (the game's sheet, or the
 * competition page under its own top bar), on the site's navy, and opens onto the content once it is ready.
 * About 1.2 s: light bursts behind, the family's seal drops in, the games mark springs up with a tilt, a few
 * sparks fly, «يلا نلعب» — then the panel opens and the content rises. With a partner the two marks meet on
 * either side of a gold ×, so the collaboration reads at a glance.
 *
 * Every time a game or a competition is opened (owner, 2026-11-04); a tap ends it at once. Nothing under reduced
 * motion, data saver, a hidden tab or a frame; a weak phone gets it without the turning light and the blurs.
 *
 * Kinds: 'game' (the games' sheets on the home page) and 'challenge' (a competition page). Phase 10's live
 * games (quiz, buzzer, …) are designed in as the kind 'live' (its own words and colour below) but nothing calls
 * it: the games themselves are not built yet (BACKEND-MIGRATION §22.3).
 */

const ROOT = new URL('../../', import.meta.url);
const KINDS = {
  game: { word: 'يلا نلعب!', tone: 'gold' },
  challenge: { word: 'جاهز للتحدي؟', tone: 'gold' },
  // Phase 10 (not enabled): a live game in the meeting
  live: { word: 'اللعبة بدأت!', tone: 'violet', enabled: false }
};
const SPARKS = 8;

function reduced() {
  return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function weak() {
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  return (cores <= 4 && memory <= 4) || memory <= 2;
}

function framed() {
  try { return window.top !== window.self; }
  catch { return true; }
}

/* whether it would play now (callers keep the content hidden only then) */
export function gameIntroWanted(key, kind = 'game') {
  const k = KINDS[kind];
  return !!k && k.enabled !== false && !!key && !reduced() && !framed() &&
    document.visibilityState !== 'hidden' && !(navigator.connection && navigator.connection.saveData) &&
    typeof document.getAnimations === 'function';
}

/* its look is in nav.css (nav.js loads it): wait for it, briefly, so the intro never shows unstyled */
function styled() {
  const has = () => !!getComputedStyle(document.documentElement).getPropertyValue('--nav-css').trim();
  if (has()) return Promise.resolve(true);
  let link = document.querySelector('link[data-nav-css]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('assets/css/nav.css', ROOT).href;
    link.dataset.navCss = '';
    document.head.append(link);
  }
  return new Promise(resolve => {
    const done = () => resolve(has());
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', () => resolve(false), { once: true });
    setTimeout(done, 1500);
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function picture(src, className, alt = '') {
  const img = el('img', className);
  img.src = new URL(src, ROOT).href;
  img.alt = alt;
  img.decoding = 'async';
  img.draggable = false;
  return img;
}

/*
 * host     the element the game opens in (it is covered while the intro plays)
 * key      a stable name for this game ('game:<id>', 'comp:<slug>')
 * kind     'game' | 'challenge' ('live' is Phase 10, off)
 * partner  { name, logo: { src } } from content.partners, or null
 * fixedTop the page's own top bar, when the intro lies over the page (it stays above it)
 * ready    () => boolean: the content is drawn (the intro waits for it, briefly)
 * → a Promise, settled when the content is showing
 */
export function playGameIntro(host, options = {}) {
  if (!host || !gameIntroWanted(options.key, options.kind || 'game')) return Promise.resolve(false);
  return styled().then(ok => (ok ? run(host, options) : false));
}

function run(host, { kind = 'game', partner = null, fixedTop = null, ready = () => true } = {}) {
  const look = KINDS[kind];
  const stage = el('div', `gintro gintro--${kind} gintro--${look.tone}${weak() ? ' gintro--lite' : ''}${partner ? ' gintro--duo' : ''}${fixedTop ? ' gintro--page' : ''}`);
  stage.setAttribute('aria-hidden', 'true');
  if (fixedTop) {
    const bottom = Math.max(0, Math.round(fixedTop.getBoundingClientRect().bottom));
    stage.style.top = bottom + 'px';
  }
  stage.append(el('span', 'gintro__rays'), el('span', 'gintro__glow'));
  const marks = el('div', 'gintro__marks');
  marks.append(picture('assets/img/logo-256.webp', 'gintro__seal'));
  if (partner && partner.logo && partner.logo.src) {
    marks.append(el('span', 'gintro__x', '×'), picture((partner.mark && partner.mark.src) || partner.logo.src, 'gintro__partner', partner.name || ''));
  }
  stage.append(marks);
  stage.append(picture('assets/img/games-logo-480.webp', 'gintro__games'));
  stage.append(el('p', 'gintro__word', look.word));
  for (let i = 1; i <= SPARKS; i++) stage.append(el('span', `gintro__spark gintro__spark--${i}`));

  if (!fixedTop && getComputedStyle(host).position === 'static') host.classList.add('gintro-host');
  host.classList.add('gintro-covered');
  (fixedTop ? document.body : host).append(stage);

  return new Promise(resolve => {
    let done = false;
    const timers = [];
    const finish = () => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      removeEventListener('pointerdown', onTap, true);
      stage.remove();
      host.classList.remove('gintro-covered');
      host.classList.add('gintro-arrive');
      setTimeout(() => host.classList.remove('gintro-arrive', 'gintro-host'), 700);
      resolve(true);
    };
    const open = () => {
      let waited = 0;
      (function check() {
        if (done) return;
        if (!ready() && waited < 1500) { waited += 100; timers.push(setTimeout(check, 100)); return; }
        stage.classList.add('is-open');
        host.classList.remove('gintro-covered');
        host.classList.add('gintro-arrive');
        timers.push(setTimeout(finish, 520));
      })();
    };
    // a tap ends it (and goes through to whatever it was on)
    const onTap = () => finish();
    addEventListener('pointerdown', onTap, true);
    timers.push(setTimeout(open, 1150));
    timers.push(setTimeout(finish, 3200));
  });
}
