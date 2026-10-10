// Deploys the Apps Script API (the deployment admin/config.js apiUrl points at)
// with the web-app settings that deployment needs, then puts the repository
// manifest back.
//
// apps-script/appsscript.json keeps the settings of the fallback Apps Script
// admin (executes as the user accessing it, Google accounts only). The API
// deployment must instead execute as the owner and accept anonymous requests
// at the transport level — every admin action is still checked by the Google
// ID token / server session (Auth.gs); only the narrow public handlers (route,
// pushSubscribe, pushUnsubscribe)
// answer without them. Pushing the repository manifest as-is to the API
// deployment makes every /admin/ request land on Google's sign-in page.
//
// Usage: cd tools && node deploy-api.mjs "v22: what changed"
// Needs clasp signed in and apps-script/.clasp.json (git-ignored).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { ROOT } from './lib/gs.mjs';

const API_WEBAPP = { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' };

const description = process.argv[2];
if (!description) {
  console.error('usage: node deploy-api.mjs "vNN: what changed"');
  process.exit(1);
}

const config = readFileSync(`${ROOT}admin/config.js`, 'utf8');
const id = (config.match(/apiUrl:\s*'https:\/\/script\.google\.com\/macros\/s\/([\w-]+)\/exec'/) || [])[1];
if (!id) {
  console.error('no API deployment id in admin/config.js (apiUrl)');
  process.exit(1);
}

const dir = `${ROOT}apps-script`;
const path = `${dir}/appsscript.json`;
const original = readFileSync(path, 'utf8');
const manifest = JSON.parse(original);
// clasp on Windows is a .cmd shim
const clasp = (...args) => execFileSync('clasp', args, { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });

let failed = false;
try {
  writeFileSync(path, `${JSON.stringify({ ...manifest, webapp: { ...manifest.webapp, ...API_WEBAPP } }, null, 2)}\n`);
  clasp('push', '-f');
  clasp('deploy', '-i', id, '-d', JSON.stringify(description));
}
catch (error) {
  failed = true;
  console.error(`deploy failed: ${error.message}`);
}
finally {
  // the repository manifest, byte for byte
  writeFileSync(path, original);
}

if (failed) process.exit(1);
console.log(`API deployment ${id} updated (${API_WEBAPP.executeAs}, ${API_WEBAPP.access}); repository manifest restored.`);
