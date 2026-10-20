// Email previews (nothing is sent): every template with realistic sample data,
// written as .html (as Gmail receives it), .txt (the plain-text part) and .eml
// (the full MIME message, to open in Outlook / Apple Mail / Thunderbird), plus
// two fallback views: images off, and Outlook-like (no gradients, no rounded
// corners, no background images).
//
//   node scripts/mail-preview.mjs <out-dir> [--local]
//
// --local points the images at ../assets/email/ on disk (before they are live on the site).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SITE } from '../src/notify/templates.js';
import { SAMPLES } from '../src/notify/samples.js';
import { mime } from '../src/notify/gmail.js';

const out = resolve(process.argv[2] || 'mail-preview');
const local = process.argv.includes('--local');
mkdirSync(out, { recursive: true });
const assets = pathToFileURL(resolve(import.meta.dirname, '../../assets/email')).href + '/';

const mails = Object.fromEntries(Object.entries(SAMPLES).map(([name, [, make]]) => [name, make()]));

const swap = html => (local ? html.split(SITE + '/assets/email/').join(assets) : html);
const imagesOff = html => html.replace(/<img [^>]*>/g, '').replace(/background-image:url\([^)]*\);?/g, '').replace(/ background="[^"]*"/g, '');
const outlookish = html => imagesOff(html).replace(/background-image:linear-gradient\([^;"]*\);?/g, '').replace(/border-radius:[^;"]*;?/g, '');

const index = [];
for (const [name, m] of Object.entries(mails)) {
  writeFileSync(`${out}/${name}.html`, swap(m.html));
  writeFileSync(`${out}/${name}.txt`, m.subject + '\n\n' + m.text);
  writeFileSync(`${out}/${name}.images-off.html`, imagesOff(m.html));
  writeFileSync(`${out}/${name}.outlook.html`, outlookish(m.html));
  const raw = mime({ to: 'preview@example.com', ...m, now: Date.UTC(2026, 9, 20, 19, 12) });
  writeFileSync(`${out}/${name}.eml`, Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  index.push(`${name.padEnd(16)} ${String(Buffer.byteLength(m.html)).padStart(6)} B html · subject: ${m.subject}`);
}
console.log(index.join('\n'));
