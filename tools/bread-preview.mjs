// «خبزنا اليومي» W5: the member page on this machine, against the REAL Worker code on SQLite with W1's sample program
// (day 5 of 30). Site http://localhost:4760/daily-bread/ · API http://localhost:4761 (set by ?api= on localhost).
//   node --experimental-sqlite --no-warnings tools/bread-preview.mjs [--off] [--late] [--over]
import { startWorld, seedFor } from '../tests/bread-world.mjs';
import { cairoDay, dayAdd } from '../worker/src/bread/model.js';

const off = process.argv.includes('--off');
const w = await startWorld({ sitePort: 4760, apiPort: 4761, module: !off });
if (!process.argv.includes('--none')) {
  const p = await w.program({ dayNo: 5 });
  if (process.argv.includes('--over')) await w.startOn(p.id, dayAdd(cairoDay(), -40));
  const seed = seedFor(p.id, 30, 4, 0);
  const m = await w.member();
  const g = await w.member({ guest: true });
  console.log(JSON.stringify({ program: p.id, seed, eligible: m, guest: g }, null, 1));
  console.log(`${w.LOCAL}/daily-bread/?api=${encodeURIComponent(w.API)}`);
}
