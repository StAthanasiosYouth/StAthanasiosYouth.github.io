/*
 * «خبزنا اليومي» P3 — the admin's copy of the Coptic calendar (apps-script/AdminSaints.html, a classic script) gives
 * the same dates as the shared one (worker/src/bread/coptic.js); the seed migration is the registry; the published
 * registry is what the monthly suggestion reads once it exists; P2's file stays off GitHub Pages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { toGregorian, toCoptic, monthDays } from '../tools/lib/coptic.mjs';
import { load, loadForFeasts, publicFile, feastsOfMonth } from '../tools/lib/saints.mjs';

const ROOT = new URL('../', import.meta.url);

test('the admin\'s Coptic calendar = the shared one (every day 1900–2100 both ways, every Coptic month end)', () => {
  const html = readFileSync(new URL('apps-script/AdminSaints.html', ROOT), 'utf8');
  const block = html.slice(html.indexOf('/* COPTIC START */'), html.indexOf('/* COPTIC END */'));
  assert.ok(block.length > 500, 'the marked block is there');
  const ctx = {};
  vm.runInNewContext(block + '\nthis.out = { toGregorian, toCoptic, monthDays };', ctx);
  const a = ctx.out;
  for (let t = Date.UTC(1900, 0, 1); t < Date.UTC(2100, 0, 1); t += 864e5 * 3) {
    const iso = new Date(t).toISOString().slice(0, 10);
    assert.deepEqual({ ...a.toCoptic(iso) }, toCoptic(iso), iso);
  }
  for (let y = 1616; y < 1820; y++) for (let m = 1; m <= 13; m++) {
    assert.equal(a.monthDays(y, m), monthDays(y, m));
    assert.equal(a.toGregorian(y, m, a.monthDays(y, m)), toGregorian(y, m, monthDays(y, m)));
  }
});

test('the seed migration (worker/migrations/0036) is the registry', () => {
  const out = execFileSync(process.execPath, [new URL('tools/bread-saints-seed.mjs', ROOT).pathname.replace(/^\/([A-Z]:)/, '$1'), '--check'], { encoding: 'utf8' });
  assert.match(out, /the seed is the registry/);
});

test('the monthly suggestion reads the published registry once it exists (a completed day joins with no import)', () => {
  const reg = load();
  const dir = mkdtempSync(join(tmpdir(), 'saints-'));
  const pub = join(dir, 'saints.json');
  assert.equal(loadForFeasts({ published: pub }).people.length, 108, 'nothing published: P2\'s file');
  const mar = reg.people.find(p => p.id === 'isaacsyrian');
  mar.feasts = [{ kind: 'نياحته', coptic: '4-17', source: 'https://st-takla.org/example.html' }];
  writeFileSync(pub, JSON.stringify(publicFile(reg)));
  const got = loadForFeasts({ published: pub });
  assert.ok(feastsOfMonth(got, '2026-12').some(h => h.person.id === 'isaacsyrian' || h.others.includes(mar.name)), 'the published day is in the month');
  assert.ok(!JSON.stringify(got).includes('"pending"'), 'the published file has no internal notes');
});

test('P2\'s registry file stays off GitHub Pages (owner file names, research notes)', () => {
  const cfg = readFileSync(new URL('_config.yml', ROOT), 'utf8');
  assert.match(cfg, /^\s*-\s*daily-bread\/saints\s*$/m);
});
