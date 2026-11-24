// P4 — the one-time import for PRODUCTION, from inside the admin (the owner's own sign-in): copies the prepared pictures
// to media/import-p4/ with p4.json (what each album item gets). The admin's «الشخصيات» shows «استورد صور الألبومات»
// while that file is on the site, uploads each picture through the normal media flow (apiUploadMedia), fills the albums,
// and the folder is deleted right after (the library's own copies are mirrored to media/YYYY/ by then).
// The site serves this folder for that short time: so no owner file names (src) and no source / terms here; the importer
// writes a short generic credit by type (internal, never in saints.json), the full record stays in p4/pictures.json.
//   node docs/daily-bread/saints/p4/tools/stage-import.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = normalize(join(HERE, '..', '..', '..', '..', '..'));
const DATA = JSON.parse(readFileSync(join(HERE, '..', 'pictures.json'), 'utf8'));
const OUT = join(ROOT, 'media', 'import-p4');
mkdirSync(OUT, { recursive: true });

const byPerson = new Map();
for (const x of DATA.pictures) byPerson.set(x.person, (byPerson.get(x.person) || 0) + 1);
const pictures = DATA.pictures.map(x => {
  for (const s of ['', '-480', '-160']) copyFileSync(join(DATA.out, x.key + s + '.webp'), join(OUT, x.key + s + '.webp'));
  const a = { key: x.key, person: x.person, alt: x.name.slice(0, 120), w: x.card.w, h: x.card.h, color: x.color, type: x.type };
  if (x.main && byPerson.get(x.person) > 1) a.main = true;
  for (const k of ['stage', 'occasion', 'caption']) if (x[k]) a[k] = x[k];
  a.crop = x.crop;
  if (x.fresh) a.fresh = true;   // a new file (not the owner's): the old owner file name is not put beside it
  return a;
});
writeFileSync(join(OUT, 'p4.json'), JSON.stringify({ about: 'P4 one-time import (docs/daily-bread/saints/P4-PROGRESS.md). Deleted after the import.', pictures }) + '\n');
console.log(pictures.length + ' pictures → media/import-p4/');
