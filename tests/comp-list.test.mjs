// Site wave 5 (S4): the «المسابقات» list (/competitions/), its home shortcut, «فكّرني» (.ics) and the sitemap entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listOf, hasCompetitions, RECENT_DAYS } from '../assets/js/comp/listing.js';
import { remindIcs } from '../assets/js/comp/remind.js';
import { loadGs } from '../tools/lib/gs.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = '2026-11-14T12:00';
const C = [
  { slug: 'old', title: 'قديمة', startAt: '2026-09-01T18:00', endAt: '2026-09-10T23:59' },
  { slug: 'done', title: 'خلصت', startAt: '2026-10-20T18:00', endAt: '2026-11-01T23:59' },
  { slug: 'soon-b', title: 'جاية ٢', startAt: '2026-11-20T18:00', endAt: '2026-11-30T23:59' },
  { slug: 'soon-a', title: 'جاية ١', startAt: '2026-11-17T18:00', endAt: '2026-11-30T23:59' },
  { slug: 'open', title: 'متاحة', startAt: '2026-11-08T18:00', endAt: '2026-11-24T23:59' },
  { slug: 'always', title: 'من غير ميعاد', startAt: '', endAt: '' }
];

test('the list: open first (ending soonest), then coming (starting soonest), then the recently finished', () => {
  const list = listOf(C, NOW);
  assert.deepEqual(list.map(c => `${c.slug}:${c.state}`), ['open:open', 'always:open', 'soon-a:soon', 'soon-b:soon', 'done:done']);
  assert.equal(RECENT_DAYS, 30);
  assert.ok(!list.some(c => c.slug === 'old'), `a competition that ended more than ${RECENT_DAYS} days ago leaves the list`);
});

test('the home shortcut shows only while the page has something', () => {
  assert.equal(hasCompetitions(C, NOW), true);
  assert.equal(hasCompetitions([C[0]], NOW), false);
  assert.equal(hasCompetitions([], NOW), false);
  assert.equal(hasCompetitions(undefined, NOW), false);
  assert.match(read('assets/js/home.js'), /hasCompetitions\(content\.competitions, nowStamp\) \? chip\('trophy', 'المسابقات', new URL\('competitions\/', ROOT\)\.href\)/);
});

test('«فكّرني»: a calendar file with the start in UTC and an alarm at the start', () => {
  const ics = remindIcs({ slug: 'soon-a', title: 'مسابقة; تجربة, ١', startAt: '2026-11-17T18:00', endAt: '2026-11-30T23:59' }, 'https://stathanasiosyouth.github.io/competition/soon-a/', Date.UTC(2026, 10, 14));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nDTSTART:20261117T160000Z\r\n/, 'Cairo 18:00 in November = 16:00 UTC');
  assert.match(ics, /\r\nDTEND:20261117T170000Z\r\n/, 'an hour long');
  assert.match(ics, /\r\nSUMMARY:بدأت: مسابقة\\; تجربة\\, ١\r\n/, 'text escaped');
  assert.match(ics, /\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\n[^\r]+\r\nTRIGGER:PT0M\r\nEND:VALARM\r\n/);
  assert.match(ics, /\r\nURL:https:\/\/stathanasiosyouth\.github\.io\/competition\/soon-a\/\r\n/);
  assert.equal(remindIcs({ slug: 'x', title: 'x', startAt: '' }, ''), null);
});

test('the page: its own SEO head; the sitemap lists it only while a competition is published', () => {
  const html = read('competitions/index.html');
  assert.match(html, /<link rel="canonical" href="https:\/\/stathanasiosyouth\.github\.io\/competitions\/">/);
  assert.doesNotMatch(html, /name="robots"/);
  assert.match(html, /<script type="module" src="\.\.\/assets\/js\/comp\/list\.js"><\/script>/);
  const gs = loadGs(['Platforms.gs', 'Content.gs', 'Hub.gs', 'CompModel.gs', 'BookModel.gs', 'Pages.gs']);
  const SITE = 'https://stathanasiosyouth.github.io/';
  const none = gs.siteSitemapXml_({ pages: [], events: [], competitions: [] }, SITE);
  assert.doesNotMatch(none, /competitions\//);
  const some = gs.siteSitemapXml_({ pages: [], events: [], competitions: [{ slug: 'quiz' }] }, SITE);
  assert.match(some, /<loc>https:\/\/stathanasiosyouth\.github\.io\/competitions\/<\/loc><\/url>\n {2}<url><loc>https:\/\/stathanasiosyouth\.github\.io\/competition\/quiz\/<\/loc>/);
});
