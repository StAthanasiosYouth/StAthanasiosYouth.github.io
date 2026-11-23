// Switches the site's public address between the family's own domain and the
// GitHub Pages address — both ways, in one command, so the domain can come and
// go (it is a one-year student domain, expires 2027-11-20) without code work.
//
//   node tools/site-domain.mjs custom   → https://stathanasiosyouthsafaga.social
//   node tools/site-domain.mjs github   → https://stathanasiosyouth.github.io
//   node tools/site-domain.mjs status   → which one the files say now
//
// What it changes (only addresses search engines and link previews read):
//   - CNAME (written for custom, deleted for github: GitHub Pages follows it)
//   - canonical / og:url / og:image / JSON-LD in the site's HTML pages,
//     sitemap.xml, robots.txt, the web manifests, meeting.ics
//   - tools/site.config.mjs
//   - worker/wrangler.jsonc production SITE_URL (the Worker builds the
//     sitemap and event/competition pages with it; deploy it after).
//
// What it never changes, on purpose:
//   - ALLOWED_ORIGINS: the Worker always accepts BOTH addresses.
//   - worker/src/notify/templates.js: emails and push links stay on
//     stathanasiosyouth.github.io, which forwards to the domain while it is
//     ours and keeps working after it is gone, so no old email ever breaks.
//   - content.json / platforms hosts (the Worker's publish owns them).
//   - tests, docs, staging.
//
// .github/workflows/domain-watch.yml runs `github` on its own when the
// domain stops answering with this site.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const CUSTOM_HOST = 'stathanasiosyouthsafaga.social';
export const GITHUB_HOST = 'stathanasiosyouth.github.io';

const mode = process.argv[2];
if (!['custom', 'github', 'status'].includes(mode)) {
  console.error('Usage: node tools/site-domain.mjs custom|github|status');
  process.exit(2);
}

const path = p => ROOT + p;
const read = p => readFileSync(path(p), 'utf8');

if (mode === 'status') {
  const cname = existsSync(path('CNAME')) ? read('CNAME').trim() : '';
  const canonical = (read('index.html').match(/<link rel="canonical" href="([^"]*)"/) || [])[1] || '?';
  console.log(JSON.stringify({ cname: cname || null, canonical, mode: cname ? 'custom' : 'github' }));
  process.exit(0);
}

const [fromHost, toHost] = mode === 'custom' ? [GITHUB_HOST, CUSTOM_HOST] : [CUSTOM_HOST, GITHUB_HOST];
const from = `https://${fromHost}`;
const to = `https://${toHost}`;

// every tracked public file: pages, sitemap, robots, manifests, calendar
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const SKIP = /^(tests|docs|tools|worker|apps-script|\.github|\.claude)\//;
const PUBLIC = /\.(html|xml|txt|webmanifest|ics)$/;
const files = tracked.filter(f => !SKIP.test(f) && PUBLIC.test(f));
files.push('tools/site.config.mjs');

let changed = 0;
for (const f of files) {
  if (!existsSync(path(f))) continue;
  const before = read(f);
  const after = before.split(from).join(to);
  if (after !== before) { writeFileSync(path(f), after); changed++; }
}

// shown-as-text addresses (no scheme): the bread share card and the install card
for (const f of ['assets/js/bread/share.js', 'assets/js/intro-card.js']) {
  const before = read(f);
  const after = before.split(`${fromHost}/daily-bread`).join(`${toHost}/daily-bread`)
    .split(`<small>${fromHost}</small>`).join(`<small>${toHost}</small>`);
  if (after !== before) { writeFileSync(path(f), after); changed++; }
}

// the Worker's production SITE_URL only (the first one; staging keeps GitHub)
{
  const f = 'worker/wrangler.jsonc';
  const before = read(f);
  const after = before.replace(`"SITE_URL": "${from}"`, `"SITE_URL": "${to}"`);
  if (after !== before) { writeFileSync(path(f), after); changed++; }
}

if (mode === 'custom') {
  if (!existsSync(path('CNAME')) || read('CNAME').trim() !== CUSTOM_HOST) { writeFileSync(path('CNAME'), CUSTOM_HOST + '\n'); changed++; }
} else if (existsSync(path('CNAME'))) {
  unlinkSync(path('CNAME')); changed++;
}

console.log(`site-domain: ${mode} → ${to} (${changed} file(s) changed)`);
