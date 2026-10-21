// Phase 2 shadow period: a READ-ONLY report of the production gate (docs/PUBLISH-SEPARATION-PLAN.md §9).
// Only SELECTs through wrangler (your Cloudflare login); nothing is written, no switch, no request to the site.
//   node scripts/shadow-watch.mjs            production
//   node scripts/shadow-watch.mjs --staging  staging
// Reads: the shadow publishes Apps Script posted, the 15-minute comparison runs (shadow_checks), the
// clean streak (the gate: 7–14 days), and the files of the last run that was not clean.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const staging = process.argv.includes('--staging');
const db = staging ? 'athanasios-staging' : 'athanasios-prod';
const bin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const DAY = 24 * 3600 * 1000;

function select(sql) {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('read-only: SELECT only');
  const out = execFileSync(process.execPath, [bin, 'd1', 'execute', db, '--remote', '--json', '--command', sql, ...(staging ? ['--env', 'staging'] : [])],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out)[0].results;
}
const when = ms => (ms ? new Date(ms + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' Cairo' : '—');

const [jobs] = select("SELECT COUNT(*) AS n, MIN(at) AS first, MAX(at) AS last, (SELECT revision FROM publish_jobs WHERE mode = 'shadow' ORDER BY at DESC LIMIT 1) AS rev FROM publish_jobs WHERE mode = 'shadow'");
const [runs] = select('SELECT COUNT(*) AS n, MIN(at) AS first, MAX(at) AS last, SUM(CASE WHEN equal + seeded < total THEN 1 ELSE 0 END) AS dirty, MAX(CASE WHEN equal + seeded < total THEN at END) AS lastDirty FROM shadow_checks');
const [last] = select('SELECT at, total, equal, lag, mismatch, missing, errors, detail FROM shadow_checks ORDER BY at DESC LIMIT 1').concat([null]);
const dirtyRows = runs.lastDirty ? select(`SELECT at, lag, mismatch, missing, errors, detail FROM shadow_checks WHERE at = ${Number(runs.lastDirty)}`) : [];
const cleanFrom = runs.lastDirty
  ? (select(`SELECT MIN(at) AS at FROM shadow_checks WHERE at > ${Number(runs.lastDirty)}`)[0] || {}).at
  : runs.first;
const now = Date.now();

console.log(`${staging ? 'STAGING' : 'PRODUCTION'} shadow period — ${when(now)}\n`);
console.log(`shadow publishes   ${jobs.n}${jobs.n ? `  (first ${when(jobs.first)}, last ${when(jobs.last)}, revision ${jobs.rev})` : '  — none yet: PUBLISH_MODE=shadow and a real publish start it'}`);
console.log(`comparison runs    ${runs.n}${runs.n ? `  (every 15 min since ${when(runs.first)}, last ${when(runs.last)})` : ''}`);
if (runs.n && now - runs.last > 40 * 60 * 1000) console.log('  ! no run in the last 40 minutes: check the Worker cron / logs');
console.log(`not clean          ${runs.dirty || 0}${runs.lastDirty ? `  (last ${when(runs.lastDirty)})` : ''}`);
const days = cleanFrom ? Math.floor((now - cleanFrom) / DAY * 10) / 10 : 0;
const hours = cleanFrom ? Math.floor((now - cleanFrom) / 3600e3) : 0;
console.log(`clean streak       ${days} days (${hours} h)${cleanFrom ? ` since ${when(cleanFrom)}` : ''}   gate: 7–14 days → ${days >= 7 ? 'MET (7+)' : 'not yet'}`);
if (last) console.log(`last run           ${last.equal}/${last.total} equal, lag ${last.lag}, mismatch ${last.mismatch}, missing ${last.missing}, errors ${last.errors}`);
for (const d of dirtyRows) {
  console.log(`\nlast not-clean run (${when(d.at)}): lag ${d.lag}, mismatch ${d.mismatch}, missing ${d.missing}, errors ${d.errors}`);
  for (const f of JSON.parse(d.detail || '[]')) console.log(`  · ${f.kind}:${f.key} ${f.state}${f.note ? ' — ' + f.note : ''}${f.site ? ` (site ${f.site} / D1 ${f.d1})` : ''}`);
}
console.log('\nlag right after a publish is normal (GitHub Pages builds ~1 min; runs wait 10 min after a publish).');
