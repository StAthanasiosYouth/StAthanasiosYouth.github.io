// Generates the first content.json + meeting.ics from apps-script/Seed.gs,
// using the same buildPublicContent() the Apps Script publisher uses.
// After the admin is set up, publishing from the admin replaces these files.

import { writeFileSync } from 'node:fs';
import { loadGs, sha256, ROOT } from './lib/gs.mjs';
import { cairoNow, utcStamp } from './lib/time.mjs';
import { SITE_URL } from './site.config.mjs';

const gs = loadGs();
const now = new Date();

const result = gs.buildPublicContent(gs.seedDraft(), {
  now: cairoNow(now),
  hash: sha256,
  publishedAt: now.toISOString()
});

if (result.errors.length) {
  console.error('Seed has errors:', result.errors);
  process.exit(1);
}

for (const w of result.warnings) console.warn('warning:', w.where, '-', w.message);

writeFileSync(`${ROOT}content.json`, JSON.stringify(result.content, null, 2) + '\n');

const ics = gs.buildMeetingIcs(result.content, cairoNow(now).slice(0, 10), utcStamp(now), SITE_URL);
writeFileSync(`${ROOT}meeting.ics`, ics);

console.log(`content.json written (revision ${result.content.revision}), meeting.ics ${ics.length} bytes`);
