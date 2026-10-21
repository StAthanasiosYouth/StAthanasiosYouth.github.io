// Phase 2 P2-5: the 404 shell (404.html + assets/js/not-found.js) — which paths become a page,
// an event or a competition, and the shell it writes in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routeOf, shellFor } from '../assets/js/not-found.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const csp = html => /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];

test('routeOf: /<slug>/, /events/<slug>/, /competition/<slug>/ (with or without the slash); everything else null', () => {
  assert.deepEqual(routeOf('/new-trip/'), { kind: 'page', slug: 'new-trip', shell: '/pages/index.html' });
  assert.deepEqual(routeOf('/events/new-trip'), { kind: 'event', slug: 'new-trip', shell: '/pages/index.html' });
  assert.deepEqual(routeOf('/events/new-trip/index.html'), { kind: 'event', slug: 'new-trip', shell: '/pages/index.html' });
  assert.deepEqual(routeOf('/competition/q2/'), { kind: 'comp', slug: 'q2', shell: '/competition/index.html' });
  for (const p of ['/', '/admin/', '/assets/', '/events/', '/points/', '/privacy/', '/a--b/', '/x/', '/Trip/', '/events/a/b/', '/media/2026/x.webp', '/new-trip/page.json', '/../etc/']) {
    assert.equal(routeOf(p), null, p);
  }
});

test('shellFor: absolute URLs, data-kind / data-slug as a stub; the competition shell gets data-slug only', () => {
  const page = shellFor(read('pages/index.html'), routeOf('/events/new-trip/'));
  assert.match(page, /<html lang="ar" dir="rtl" data-kind="event" data-slug="new-trip">/);
  assert.match(page, /<script type="module" src="\/assets\/js\/page\/main\.js"><\/script>/);
  assert.doesNotMatch(page, /(?:href|src)="\.\.\//, 'no relative URL left');
  const comp = shellFor(read('competition/index.html'), routeOf('/competition/q2/'));
  assert.match(comp, /<html lang="ar" dir="rtl" data-slug="q2">/);
  assert.match(comp, /src="\/assets\/js\/comp\/main\.js"/);
});

test('404.html: the page shell CSP (a superset of the site and competition policies), no inline code, absolute URLs, noindex', () => {
  const html = read('404.html');
  assert.equal(csp(html), csp(read('pages/index.html')));
  assert.match(html, /<html lang="ar" dir="rtl" data-shell="404">/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline script');
  assert.doesNotMatch(html, /<style|\sstyle="/, 'no inline style');
  for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) assert.match(url, /^\//, url + ' is absolute');
  assert.match(html, /<meta name="robots" content="noindex">/);
  // the two shells it can write in, under its policy
  for (const shell of ['pages/index.html', 'competition/index.html']) assert.match(read(shell), /<html lang="ar" dir="rtl">/, shell);
});
