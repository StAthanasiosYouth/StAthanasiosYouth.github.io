// Live STAGING check for Phase 6 Step 2 (docs/PHASE6-PLAN.md): the menu numbers and the season picker answer from D1.
// Makes one planned season and removes it. Run from worker/: node scripts/comp-reads-check.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const NAME = 'فحص-' + Date.now().toString(36);
let failed = 0;

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
}
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { encoding: 'utf8', shell: true });
  if (r.status !== 0) throw new Error('d1: ' + String(r.stderr).slice(0, 300));
  return JSON.parse(r.stdout)[0].results;
}
function google(email, sub) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: 'check', iat: now, exp: now + 3600 });
  return head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function call(method, path, body, token) {
  const res = await fetch(base + '/v1/admin/' + path, { method, headers: { origin: ORIGIN, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const P = google('loadtest@staging.invalid', 'loadtest-1');

check('no credential: refused', (await call('GET', 'comp/badges')).status === 401);
check('no credential: seasons refused', (await call('GET', 'comp/seasons')).status === 401);
const outsider = google('nobody@staging.invalid', 'nobody-1');
check('not an admin: refused', (await call('GET', 'comp/badges', null, outsider)).status === 403);

const badges = await call('GET', 'comp/badges', null, P);
const [counts] = sql("SELECT (SELECT COUNT(*) FROM submissions WHERE status = 'pending_review') AS comps, (SELECT COUNT(*) FROM redemptions WHERE status = 'pending') AS shop");
check('the numbers equal D1', badges.status === 200 && badges.body.comps === counts.comps && badges.body.shop === counts.shop, { badges, counts });

const saved = await call('POST', 'points/seasons', { name: NAME }, P);
check('a season made on the accounts side', saved.status === 200, saved);
try {
  const seasons = await call('GET', 'comp/seasons', null, P);
  const made = seasons.status === 200 && seasons.body.seasons.find(s => s.name === NAME);
  check('it reaches the competition picker', !!made && made.status === 'planned', seasons);
  check('its id fits the competition field', !!made && /^sea-[0-9a-z]{4,12}$/.test(made.id), made);
} finally {
  sql(`DELETE FROM seasons WHERE name = '${NAME}' AND status = 'planned'`);
}
check('the check removed its season', sql(`SELECT COUNT(*) AS n FROM seasons WHERE name = '${NAME}'`)[0].n === 0);

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
