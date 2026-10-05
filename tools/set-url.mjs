// Sets the permanent public URL everywhere it is written down:
//   tools/site.config.mjs, index.html (canonical + Open Graph tags).
// The page itself uses relative paths, so it works under any URL; these
// tags are what link previews and search engines read.
//
// Usage: npm run set-url -- https://stathanasiosyouth.github.io/
//        npm run set-url -- https://stathanasiosyouth.github.io/athanasios-links/
// Then set the same value as SITE_URL in the Apps Script Script Properties.

import { readFileSync, writeFileSync } from 'node:fs';
import { ROOT } from './lib/gs.mjs';

let url = process.argv[2] || '';

if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[\w./-]*)?$/i.test(url)) {
  console.error('Usage: npm run set-url -- https://example.org/path/');
  process.exit(1);
}

if (!url.endsWith('/')) {
  url += '/';
}

const config = `${ROOT}tools/site.config.mjs`;
writeFileSync(config, readFileSync(config, 'utf8').replace(/export const SITE_URL = '[^']*';/, `export const SITE_URL = '${url}';`));

const index = `${ROOT}index.html`;
const html = readFileSync(index, 'utf8')
  .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
  .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
  .replace(/(<meta property="og:image" content=")[^"]*(assets\/img\/og-image\.png")/, `$1${url}$2`);

writeFileSync(index, html);

console.log(`SITE_URL set to ${url}`);
console.log('Remember: Script Properties > SITE_URL in Apps Script must be the same.');
