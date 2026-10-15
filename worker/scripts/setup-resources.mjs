// Recreate every Cloudflare resource this Worker needs in the CURRENT wrangler
// account (portability: a new account, or disaster recovery). Idempotent:
// "already exists" is fine. Prints the D1 database IDs to paste into
// wrangler.jsonc. Secrets are listed, never set from here.
//
//   npx wrangler login            (or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)
//   node scripts/setup-resources.mjs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// wrangler's own entry with this node (no npx/.cmd: works on Windows too)
const WRANGLER = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url);
const run = args => {
  try { return execFileSync(process.execPath, [fileURLToPath(WRANGLER), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
};

export const RESOURCES = {
  d1: [{ name: 'athanasios-prod', location: 'eeur' }, { name: 'athanasios-staging', location: 'eeur' }],
  queues: ['athanasios-jobs', 'athanasios-jobs-dlq', 'athanasios-jobs-staging', 'athanasios-jobs-staging-dlq'],
  r2: [{ name: 'athanasios-proofs-prod', location: 'eeur' }, { name: 'athanasios-proofs-staging', location: 'eeur' }],   // private; needs R2 enabled on the account
  secrets: {
    production: ['LOG_SALT', 'SYNC_SECRET'],
    staging: ['LOG_SALT', 'SYNC_SECRET', 'ADMIN_EMAILS', 'STAGING_TEST_JWK']
  }
};

for (const db of RESOURCES.d1) {
  const out = run(['d1', 'create', db.name, '--location', db.location]);
  console.log(`d1 ${db.name}:`, /already exists/i.test(out) ? 'exists' : /Successfully/.test(out) ? 'created' : out.trim().split('\n').pop());
}
for (const q of RESOURCES.queues) {
  const out = run(['queues', 'create', q]);
  console.log(`queue ${q}:`, /already (exists|taken)/i.test(out) ? 'exists' : /Created/.test(out) ? 'created' : out.trim().split('\n').pop());
}
for (const b of RESOURCES.r2) {
  const out = run(['r2', 'bucket', 'create', b.name, '--location', b.location]);
  // never public: make sure the r2.dev URL is off
  run(['r2', 'bucket', 'dev-url', 'disable', b.name, '--force']);
  console.log(`r2 ${b.name}:`, /already exists/i.test(out) ? 'exists' : /Created|created/.test(out) ? 'created' : out.trim().split('\n').pop());
}

const list = JSON.parse(run(['d1', 'list', '--json']) || '[]');
console.log('\nPaste into wrangler.jsonc (database_id):');
for (const db of RESOURCES.d1) {
  const found = list.find(x => x.name === db.name);
  console.log(`  ${db.name}: ${found ? found.uuid : '(not found)'}`);
}
console.log('\nThen set secrets (wrangler secret put NAME [--env staging]):');
console.log('  production:', RESOURCES.secrets.production.join(', '));
console.log('  staging:   ', RESOURCES.secrets.staging.join(', '));
console.log('Then: npm run deploy:staging && npm run deploy:production');
