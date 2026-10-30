// Generates the youth account secrets (src/account/secret.js) and pipes each one
// straight into `wrangler secret put`: nothing is printed or written to disk.
// Staging by default; production only with --production. Refuses to run twice on
// purpose: new PW_PEPPER / PW_KEY values would make every existing password unreadable.
//   node scripts/account-secrets.mjs [--production]
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const production = process.argv.includes('--production');
const envArgs = production ? [] : ['--env', 'staging'];
const SECRETS = { PW_PEPPER: 48, PW_KEY: 32, OTP_PEPPER: 48 };

const list = spawnSync('npx', ['wrangler', 'secret', 'list', ...envArgs], { shell: true, encoding: 'utf8' });
if (list.status !== 0) { console.error('could not list the secrets'); process.exit(1); }
const existing = Object.keys(SECRETS).filter(name => list.stdout.includes(`"${name}"`));
if (existing.length) { console.error('already set, nothing changed: ' + existing.join(', ')); process.exit(1); }

for (const [name, bytes] of Object.entries(SECRETS)) {
  const put = spawnSync('npx', ['wrangler', 'secret', 'put', name, ...envArgs], { shell: true, input: randomBytes(bytes).toString('base64'), stdio: ['pipe', 'ignore', 'inherit'] });
  if (put.status !== 0) { console.error('failed: ' + name); process.exit(1); }
  console.log('set ' + name);
}
