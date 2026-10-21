// Phase 2 P2-9: the full staging rehearsal before the cutover (docs/PUBLISH-SEPARATION-PLAN.md §9).
// Runs the staging checks in order and prints one summary. Staging only; no switch is changed.
//   1 publish-check   signed publish, public reads (exact text, ETag/304, CORS), refusals, big publish
//   2 shadow-check    the comparison against the real Pages site (seed, shadow publish, clean)
//   3 mirror-check    PUBLISH_MODE='worker': live at once, the mirror's commit to the TEST repository
//   4 restore-check   «ارجع للنسخة دي»: live at once, stale view refused, mirrored
// Then the local checks (Chrome): see §9 "Local".
//   node scripts/phase2-rehearsal.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const steps = ['publish-check', 'shadow-check', 'mirror-check', 'restore-check'];
const results = [];
for (const name of steps) {
  const t0 = Date.now();
  console.log(`\n=== ${name}`);
  const run = spawnSync(process.execPath, [dir + name + '.mjs'], { stdio: 'inherit' });
  results.push({ name, ok: run.status === 0, s: Math.round((Date.now() - t0) / 1000) });
}
console.log('\n=== summary');
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name} (${r.s} s)`);
process.exit(results.every(r => r.ok) ? 0 : 1);
