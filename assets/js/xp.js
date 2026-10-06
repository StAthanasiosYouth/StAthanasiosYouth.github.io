/**
 * MINI-EXPERIENCES (Facebook, Instagram, TikTok, WhatsApp)
 *
 * A social link doesn't send the visitor away on the first tap: it opens a
 * short scene in a sheet that says what they'll find there, with a clear
 * button to the real page. The button is a normal link (new tab), visible
 * within a second; the scene never blocks it.
 *
 * - First visit (per platform, per device): the full scene (~3 s).
 *   Later visits: a short version, the button right away.
 *   localStorage "athanasios.xp.v1"; blocked storage = first visit.
 * - Reduced motion: the scene's final frame, no movement.
 * - Scenes load only when opened (assets/js/xp/<platform>.js), with their
 *   styles (assets/css/xp.css); the copy and the button never wait for them.
 */

import { h, external } from './dom.js';
import { iconNode } from './icons.js';
import { isReduced } from './motion.js';
import { play } from './sound.js';
import { openSheet } from './sheet.js';

const STORE = 'athanasios.xp.v1';

let styles = null;

/* the scenes' own stylesheet, fetched once, with the first scene */
function sceneStyles() {

  if (!styles) {
    styles = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('../css/xp.css', import.meta.url).href;
      link.addEventListener('load', resolve);
      link.addEventListener('error', () => {
        link.remove();
        styles = null;
        reject(new Error('xp.css'));
      });
      document.head.append(link);
    });
  }

  return styles;

}

/* start fetching as the finger lands, so the scene is ready by the click */
/**
 * Can this page show a scene for that experience key? render.js only routes a
 * link to a scene when this says yes (otherwise the link opens directly).
 * CONTRACT (Final Polish): once the registry scenes and the generic scene
 * exist, every valid key returns true.
 */
export function hasScene(key) {

  return !!(key && PLATFORMS[key]);

}

export function prepareExperience(platform) {

  if (!PLATFORMS[platform]) return;
  sceneStyles().catch(() => {});
  import(`./xp/${platform}.js`).catch(() => {});

}

export const PLATFORMS = {
  facebook: {
    title: 'صفحتنا على فيسبوك',
    line: 'هنا هتتابع أخبارنا وإعلاناتنا',
    sub: 'البوسترات والمواعيد وصور كل اجتماع، أول بأول.',
    cta: 'افتح صفحتنا على فيسبوك'
  },
  instagram: {
    title: 'إنستجرام',
    line: 'صور، ستوريز، ريلز وذكريات الخدمة',
    sub: 'اللحظات الحلوة من كل اجتماع ورحلة.',
    cta: 'افتح إنستجرام'
  },
  tiktok: {
    title: 'تيك توك',
    line: 'فيديوهات قصيرة ولحظات من الخدمة',
    sub: 'دقيقة من كل حاجة حلوة بنعملها.',
    cta: 'افتح تيك توك'
  },
  whatsapp: {
    title: 'جروب الواتساب',
    line: 'خليك أول واحد يعرف',
    sub: 'المواعيد والإعلانات بتوصلك على طول.',
    cta: 'انضم لجروب الواتساب'
  }
};


/* how many times this device opened each platform's scene */
const memory = {};

function seenCount(platform) {

  try {
    const data = JSON.parse(localStorage.getItem(STORE) || '{}');
    return Number(data[platform]) || 0;
  }
  catch {
    return memory[platform] || 0;
  }

}

function markSeen(platform) {

  memory[platform] = (memory[platform] || 0) + 1;

  try {
    const data = JSON.parse(localStorage.getItem(STORE) || '{}');
    data[platform] = (Number(data[platform]) || 0) + 1;
    localStorage.setItem(STORE, JSON.stringify(data));
  }
  catch {
    // private mode: in-memory for this visit only
  }

}


/** Is this the full (first) scene, or the short one? */
export function isFirstVisit(platform) {

  return seenCount(platform) === 0;

}


/* the button's wording: a WhatsApp group invite says "join" */
function ctaLabel(link) {

  const words = PLATFORMS[link.experience];

  if (link.experience === 'whatsapp' && !/^https:\/\/chat\.whatsapp\.com\//.test(link.url)) {
    return 'افتح واتساب';
  }

  return words.cta;

}


/**
 * Opens the scene for a link (link.experience is the platform).
 * context: { content } for scenes that show real public bits (posters,
 * the meeting time). onClose: called when the sheet closes.
 */
export function openExperience(link, context, onClose) {

  const platform = link.experience;
  const words = PLATFORMS[platform];
  const first = isFirstVisit(platform);
  const reduced = isReduced();
  let stopScene = () => {};

  markSeen(platform);

  const stage = h('div', { class: `xp-stage xp-stage--${platform}`, 'aria-hidden': 'true' });
  const cta = h('a', { class: `btn btn--primary btn--block xp__cta xp__cta--${platform}`, ...external(link.url), onclick: () => play('success') },
    iconNode(platform),
    ctaLabel(link),
    iconNode('external')
  );

  const content = h('div', { class: `xp xp--${platform}${first && !reduced ? ' is-first' : ''}` },
    stage,
    h('div', { class: 'xp__copy' },
      h('p', { class: 'xp__line' }, words.line),
      h('p', { class: 'xp__sub' }, link.subtitle || words.sub)
    ),
    h('div', { class: 'xp__actions' }, cta)
  );

  // the button arrives early in the first scene, at once afterwards
  if (first && !reduced) {
    content.classList.add('cta-pending');
    setTimeout(() => content.classList.remove('cta-pending'), 900);
  }

  openSheet({
    title: link.title || words.title,
    content,
    variant: 'xp',
    onClose: info => {
      stopScene();
      if (onClose) onClose(info);
    }
  });

  Promise.all([import(`./xp/${platform}.js`), sceneStyles()])
    .then(([module]) => {
      if (!stage.isConnected) return;
      const scene = module.play(stage, { quick: !first, reduced, content: context.content, sound: play });
      stopScene = scene && scene.stop ? scene.stop : stopScene;
    })
    .catch(error => {
      console.warn('scene', error);
      stage.classList.add('is-static');
    });

  return content;

}
