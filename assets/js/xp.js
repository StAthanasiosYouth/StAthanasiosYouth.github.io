/**
 * MINI-EXPERIENCES: the door. A link with an experience opens a short scene
 * in a sheet, with a clear button to the real page (xp/engine.js, the
 * scenes in xp/, the registry in platforms.js). First page load: tiny;
 * the rest loads as a scene is about to open.
 */

import { h, external } from './dom.js';
import { openSheet } from './sheet.js';

/* same rule as platforms.js experienceKey() (the registry loads later) */
const KEY = /^[a-z][a-z0-9-]{0,23}$/;

let engine = null;
let loading = null;

function load() {

  if (!loading) {
    loading = import('./xp/engine.js').then(module => (engine = module), error => {
      loading = null;
      throw error;
    });
  }

  return loading;

}


/**
 * Can this page show a scene for that experience key? render.js only routes a
 * link to a scene when this says yes (otherwise the link opens directly).
 * Every valid key does: the registry's scenes, and the generic branded scene
 * for a key this version doesn't know yet.
 */
export function hasScene(key) {

  return typeof key === 'string' && KEY.test(key) && key !== 'none' && key !== 'auto';

}


/* start fetching as the finger lands, so the scene is ready by the click */
export function prepareExperience(key) {

  if (!hasScene(key)) return;
  load().then(module => module.prepare(key)).catch(() => {});

}


/**
 * Opens the scene for a link (link.experience is the key).
 * context: { content } for scenes that show real public bits (posters,
 * the meeting time). onClose: called when the sheet closes.
 */
export function openExperience(link, context, onClose) {

  if (engine) {
    engine.open(link, context, onClose);
    return;
  }

  const hash = location.hash;

  load()
    .then(module => {
      // the visitor may have gone back while it loaded
      if (location.hash === hash) module.open(link, context, onClose);
    })
    .catch(() => {
      // offline: still a way to the page
      openSheet({
        title: link.title,
        content: h('div', { class: 'xp' }, h('a', { class: 'btn btn--primary btn--block xp__cta', ...external(link.url) }, link.cta || 'افتح')),
        variant: 'xp',
        onClose
      });
    });

}
