// Phase 8 interactive previews (BACKEND-MIGRATION §22.1 items 13 and 24).
// Builds admin-preview.html and site-preview.html from their .src.html with the
// site's own images embedded, so each preview is one self-contained file.
//   node docs/phase8/build-preview.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const uri = (file) => `data:image/webp;base64,${readFileSync(join(root, file)).toString('base64')}`;
const head = '<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';

const IMAGES = {
  LOGO: 'assets/img/logo-256.webp',
  GAMES: 'assets/img/games-logo-480.webp',
  THEATRE: 'media/2026/img-09d4476b-480.webp',
  VOICE: 'media/2026/img-cadc4835-480.webp',
  M1: 'media/2026/img-8ffd40eb-480.webp',
  M2: 'media/2026/img-53ca69a3-480.webp',
  BUG: 'assets/img/partners/bug-logo-360.webp'
};

for (const name of ['admin-preview', 'site-preview']) {
  let out = head + readFileSync(join(here, name + '.src.html'), 'utf8');
  for (const [key, file] of Object.entries(IMAGES)) {
    if (out.includes(`%%${key}%%`)) out = out.replaceAll(`%%${key}%%`, uri(file));
  }
  writeFileSync(join(here, name + '.html'), out);
  console.log(name + '.html', Math.round(out.length / 1024), 'KB');
}
