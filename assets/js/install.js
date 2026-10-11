/**
 * THE SITE APP: can it be installed here, is it installed (the SITE app,
 * never the admin app «لوحة تحكم الأسرة», which is another app at /admin/).
 *
 * main.js calls watchInstall() at start (tiny: two listeners). The bell's
 * card (push.js, loaded only when the bell opens) reads installState() and
 * calls promptInstall() inside a tap.
 *
 *  - beforeinstallprompt is kept, never preventDefault()ed: Chrome's own
 *    install suggestions stay exactly as they were.
 *  - installed? only when it can be known: this window is the installed
 *    site app (display-mode standalone on the site page — the admin app
 *    can't show this page, it's outside its scope), the browser just
 *    installed it (appinstalled), or getInstalledRelatedApps() lists the
 *    SITE manifest (manifest.webmanifest related_applications = itself).
 */

const SITE_MANIFEST = /\/manifest\.webmanifest$/;
const ADMIN_MANIFEST = /\/admin\/manifest\.webmanifest$/;

let deferred = null;
let installedNow = false;
let watching = false;
const listeners = new Set();


function changed() {

  listeners.forEach(fn => {
    try { fn(); }
    catch { /* a card that's gone */ }
  });

}


export function watchInstall(env = globalThis) {

  if (watching || !env.addEventListener) return;
  watching = true;

  env.addEventListener('beforeinstallprompt', event => {
    deferred = event;
    changed();
  });

  env.addEventListener('appinstalled', () => {
    installedNow = true;
    deferred = null;
    changed();
  });

}


export function onInstallChange(fn) {

  listeners.add(fn);
  return () => listeners.delete(fn);

}


export function canPrompt() {

  return !!deferred;

}


/* the browser's own install dialog; resolves true when accepted */
export async function promptInstall() {

  const event = deferred;

  if (!event) return false;

  deferred = null;
  changed();

  try {
    event.prompt();
    const choice = await event.userChoice;
    return !!choice && choice.outcome === 'accepted';
  }
  catch {
    return false;
  }

}


function standalone(env) {

  try {
    return env.navigator.standalone === true || !!(env.matchMedia && env.matchMedia('(display-mode: standalone)').matches);
  }
  catch {
    return false;
  }

}


/* the browser's answer about the SITE app: true / false, or null when it can't tell */
async function relatedSiteApp(env) {

  const nav = env.navigator || {};

  if (typeof nav.getInstalledRelatedApps !== 'function') return null;

  try {
    const apps = await Promise.race([
      nav.getInstalledRelatedApps(),
      new Promise(resolve => setTimeout(() => resolve(null), 3000))
    ]);
    if (!apps) return null;
    return apps.some(app => app && app.platform === 'webapp' && SITE_MANIFEST.test(String(app.url || '')) && !ADMIN_MANIFEST.test(String(app.url || '')));
  }
  catch {
    return null;
  }

}


/**
 * 'running'    this window is the installed site app
 * 'installed'  a browser tab; the site app is installed on this device
 * 'prompt'     not installed; the browser's install dialog is ready
 * 'manual'     not installed (or can't tell); the browser's menu installs it
 */
export async function installState(env = globalThis) {

  if (standalone(env)) return 'running';
  if (installedNow) return 'installed';
  if (await relatedSiteApp(env)) return 'installed';
  return deferred ? 'prompt' : 'manual';

}
