/**
 * THE 404 SHELL (Phase 2 P2-5, docs/PUBLISH-SEPARATION-PLAN.md; BACKEND-MIGRATION §19)
 *
 * GitHub Pages answers every missing path with /404.html. With PUBLISH_MODE
 * 'worker' a new page, event or competition is live on the Worker before its
 * stub (/<slug>/index.html …) reaches GitHub through the mirror. This shell
 * shows it in that gap: for /<slug>/, /events/<slug>/ and /competition/<slug>/
 * it fetches the matching shell (pages/index.html, competition/index.html),
 * makes its URLs absolute, adds data-kind / data-slug as a stub would, and
 * writes it in place; the page engine then loads the content as usual
 * (content-source.js: the Worker, else the static file). Anything else keeps
 * the plain «الصفحة دي مش موجودة» page. Crawlers and link previews get the
 * real stub (200, Open Graph tags) once the mirror has committed it.
 */

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;
// top-level folders that are never a page (Pages.gs PAGE_RESERVED_SLUGS, the site's own folders)
const RESERVED = ['admin', 'assets', 'media', 'points', 'competition', 'competitions', 'events', 'event', 'pages', 'page',
  'privacy', 'terms', 'review', 'tools', 'docs', 'tests', 'apps-script', 'index', 'preview', 'new', 'card-athanasios',
  'graphify-out', 'node-modules', 'content', 'manifest', 'sw', 'robots', 'meeting', 'live', 'favicon', 'api', '404'];

const ok = slug => SLUG.test(slug) && !/--/.test(slug);

/** the path → { kind: 'page' | 'event' | 'comp', slug, shell } or null */
export function routeOf(pathname) {
  const path = String(pathname || '').replace(/\/index\.html$/, '/');
  let m;
  if ((m = /^\/events\/([^/]+)\/?$/.exec(path)) && ok(m[1])) return { kind: 'event', slug: m[1], shell: '/pages/index.html' };
  if ((m = /^\/competition\/([^/]+)\/?$/.exec(path)) && ok(m[1])) return { kind: 'comp', slug: m[1], shell: '/competition/index.html' };
  if ((m = /^\/([^/]+)\/?$/.exec(path)) && ok(m[1]) && !RESERVED.includes(m[1])) return { kind: 'page', slug: m[1], shell: '/pages/index.html' };
  return null;
}

/** a shell's text → the stub this route would get: absolute URLs, its kind and slug on <html> */
export function shellFor(text, route) {
  const attrs = (route.kind === 'comp' ? '' : ` data-kind="${route.kind}"`) + ` data-slug="${route.slug}"`;
  return String(text)
    .replace(/(\s(?:href|src)=")\.\.\//g, '$1/')
    .replace('<html lang="ar" dir="rtl">', `<html lang="ar" dir="rtl"${attrs}>`);
}

async function boot() {
  const route = routeOf(location.pathname);
  if (!route) return;
  // relative files (event.json next to the page) need the folder form
  if (!location.pathname.endsWith('/') && !location.pathname.endsWith('/index.html')) {
    history.replaceState(null, '', location.pathname + '/' + location.search + location.hash);
  }
  let text;
  try {
    const response = await fetch(route.shell, { cache: 'no-cache', credentials: 'same-origin' });
    if (!response.ok) return;
    text = await response.text();
  }
  catch {
    return;                         // offline: the plain 404 page stays
  }
  if (!/<html lang="ar" dir="rtl">/.test(text)) return;
  document.open();
  document.write(shellFor(text, route));
  document.close();
}

if (typeof document !== 'undefined' && typeof location !== 'undefined' && document.documentElement.dataset.shell === '404') boot();
