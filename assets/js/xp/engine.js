/**
 * MINI-EXPERIENCES: the engine (loaded with the first scene, never with the
 * page; assets/js/xp.js is the small door that loads it).
 *
 * Any link experience goes through the registry (platforms.js):
 *   key → PLATFORMS[key].scene → assets/js/xp/<scene>.js
 * Keys the registry doesn't know get the generic branded scene ("browser").
 * Several platforms share a scene family (chat, feed, player…) and pass
 * their own skin (accent, icon, words) through `platform`.
 *
 * - First visit (per key, per device): the full scene; the button arrives
 *   within a second. Later visits: a short version, the button at once.
 *   localStorage "athanasios.xp.v1"; blocked storage = first visit.
 * - Reduced motion: the scene's final frame, no movement.
 * - The copy and the button never wait for the scene module or its styles.
 * - The button is the real link (new tab); words:
 *     line = registry line (generic: the link title)
 *     sub  = link.subtitle || registry sub
 *     cta  = link.cta || registry cta (the «صوتك يهمنا» scene keeps its own)
 */

import { h, external } from '../dom.js';
import { iconNode } from '../icons.js';
import { isReduced } from '../motion.js';
import { play } from '../sound.js';
import { openSheet } from '../sheet.js';
import { PLATFORMS, platformOf } from '../platforms.js';

const STORE = 'athanasios.xp.v1';

/* the bespoke CTA colours live in main.css; every other platform paints
   its button with its registry accent (xp.css) */
const OWN_CTA = ['facebook', 'instagram', 'tiktok', 'whatsapp', 'voice', 'web'];

/* scenes with a stylesheet of their own (besides xp.css) */
const OWN_STYLES = { voice: 'xp-voice.css' };

const sheets = {};

function stylesheet(name) {

  if (!sheets[name]) {
    sheets[name] = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL(`../../css/${name}`, import.meta.url).href;
      link.addEventListener('load', resolve);
      link.addEventListener('error', () => {
        link.remove();
        delete sheets[name];
        reject(new Error(name));
      });
      document.head.append(link);
    });
  }

  return sheets[name];

}

function sceneOf(key) {

  return platformOf(key).scene || 'browser';

}

function styles(scene) {

  return Promise.all([stylesheet('xp.css'), OWN_STYLES[scene] ? stylesheet(OWN_STYLES[scene]) : null]);

}

const modules = {};

function sceneModule(scene) {

  if (!modules[scene]) {
    modules[scene] = import(`./${scene}.js`).catch(error => {
      delete modules[scene];
      throw error;
    });
  }

  return modules[scene];

}


export function prepare(key) {

  const scene = sceneOf(key);
  styles(scene).catch(() => {});
  sceneModule(scene).catch(() => {});

}


/* how many times this device opened each experience */
const memory = {};

function seenCount(key) {

  try {
    const data = JSON.parse(localStorage.getItem(STORE) || '{}');
    return Number(data[key]) || 0;
  }
  catch {
    return memory[key] || 0;
  }

}

function markSeen(key) {

  memory[key] = (memory[key] || 0) + 1;

  try {
    const data = JSON.parse(localStorage.getItem(STORE) || '{}');
    data[key] = (Number(data[key]) || 0) + 1;
    localStorage.setItem(STORE, JSON.stringify(data));
  }
  catch {
    // private mode: in-memory for this visit only
  }

}


export function hostOf(url) {

  try {
    return new URL(url).hostname.replace(/^www\./, '');
  }
  catch {
    return '';
  }

}


/* the button's wording */
function ctaLabel(link, key, platform) {

  // the «صوتك يهمنا» scene ends on its own words (the video's «ابعت صوتك»)
  if (key === 'voice') return platform.cta;

  // a WhatsApp link that isn't a group invite: "open", not "join"
  if (key === 'whatsapp' && !/^https:\/\/chat\.whatsapp\.com\//.test(link.url)) return 'افتح واتساب';

  return link.cta || platform.cta || 'افتح';

}


/* readable text on an accent colour */
function onAccent(hex) {

  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return '#fff';
  const [r, g, b] = m.slice(1).map(v => parseInt(v, 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#0b1420' : '#fff';

}


/**
 * Opens the scene for a link (link.experience is the key).
 * context: { content }. onClose: called when the sheet closes.
 */
export function open(link, context, onClose) {

  const key = link.experience;
  const known = Object.prototype.hasOwnProperty.call(PLATFORMS, key);
  const platform = { ...platformOf(key), key, known };
  const scene = sceneOf(key);
  const first = seenCount(key) === 0;
  const tier = document.documentElement.dataset.motion;
  const reduced = isReduced() || tier === 'reduced';
  const lite = !reduced && tier === 'lite';
  let stopScene = () => {};
  let closed = false;

  markSeen(key);

  const glyph = link.icon && link.icon !== 'link' ? link.icon : (platform.icon || 'link');
  const stage = h('div', { class: `xp-stage xp-stage--${scene}`, 'aria-hidden': 'true', 'data-platform': key });
  const cta = h('a', {
    class: `btn btn--primary btn--block xp__cta xp__cta--${OWN_CTA.includes(key) ? key : 'accent'}`,
    ...external(link.url),
    onclick: () => play('success')
  },
    iconNode(glyph),
    ctaLabel(link, key, platform),
    iconNode('external')
  );

  const accent = platform.accent || '#d7aa50';
  [stage, cta].forEach(node => {
    node.style.setProperty('--xp-accent', accent);
    node.style.setProperty('--xp-on-accent', onAccent(accent));
  });

  const line = platform.line || link.title;
  const sub = link.subtitle || platform.sub || hostOf(link.url);

  const content = h('div', { class: `xp xp--${scene} xp--${key}${first && !reduced ? ' is-first' : ''}` },
    stage,
    h('div', { class: 'xp__copy' },
      line ? h('p', { class: 'xp__line' }, line) : null,
      sub && sub !== line ? h('p', { class: 'xp__sub' }, sub) : null
    ),
    h('div', { class: 'xp__actions' }, cta)
  );

  // the button arrives early in the first scene, at once afterwards
  if (first && !reduced) {
    content.classList.add('cta-pending');
    setTimeout(() => content.classList.remove('cta-pending'), 900);
  }

  openSheet({
    title: link.title || platform.label,
    content,
    variant: 'xp',
    onClose: info => {
      closed = true;
      stopScene();
      if (onClose) onClose(info);
    }
  });

  // the sheet may still be on its way (its own styles load first): the
  // scene starts once the stage is really on screen, never after a close
  const opened = performance.now();
  const start = module => {
    // closed, or replaced by another sheet (no close callback then)
    if (closed || performance.now() - opened > 10000) return;
    if (!stage.isConnected || !stage.getClientRects().length) {
      requestAnimationFrame(() => start(module));
      return;
    }
    const running = module.play(stage, { quick: !first, reduced, lite, content: context.content || {}, sound: play, link, platform });
    if (!running || !running.stop) return;
    // another sheet can replace this one without a close: stop with it
    const watch = setInterval(() => { if (!stage.isConnected) stopScene(); }, 1000);
    stopScene = () => {
      clearInterval(watch);
      running.stop();
      stopScene = () => {};
    };
  };

  Promise.all([sceneModule(scene), styles(scene)])
    .then(([module]) => start(module))
    .catch(error => {
      console.warn('scene', error);
      stage.classList.add('is-static');
    });

  return content;

}
