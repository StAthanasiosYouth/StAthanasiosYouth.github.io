// Site redesign W1: no identity gold is written as a fixed value in the site CSS — every one is a --gold* token,
// so the member's site colour (W2, assets/js/look.js) is one token swap before the first paint.
// "Identity gold" = the same rule the approved S3 preview used to recolour the live CSS (docs/site-redesign/tint.js):
// the named golds, plus any colour with the gold's hue (32°–50°) and saturation .28–.86 at lightness .06–.96.
// Brand yellows (more saturated) and the %23-encoded colours inside data: URIs are not identity gold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const CSS = new URL('assets/css/', ROOT);
const BASES = ['main.css', 'page.css', 'comp.css', 'legal.css', 'xp-clip.css'];
const files = readdirSync(CSS).filter(f => f.endsWith('.css'));
const read = f => readFileSync(new URL(f, CSS), 'utf8');

function hsl(c) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
  return [h, s, l];
}
// the named golds, per form, as tint.js lists them
const NAMED = {
  rgb: new Set(['242,210,139', '215,170,80', '231,207,156', '184,134,47', '201,145,53', '255,236,190', '255,233,186', '107,76,23', '27,19,6']),
  hex: new Set(['242,210,139', '215,170,80', '231,207,156', '201,154,67', '27,19,6', '107,76,23', '111,79,27', '140,100,35', '255,244,214'])
};
function isGold(c, form) {
  if (NAMED[form].has(c.join(','))) return true;
  const [h, s, l] = hsl(c);
  return h >= 32 && h <= 50 && s >= .28 && s <= .86 && l >= .06 && l <= .96;
}
function fixedGolds(css) {
  const out = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, 'url()');
  for (const m of plain.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let x = m[1]; if (x.length === 3) x = [...x].map(ch => ch + ch).join('');
    const c = [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16));
    if (isGold(c, 'hex')) out.push(m[0]);
  }
  for (const m of plain.matchAll(/(?:rgba?|hsla?)\(\s*(\d{1,3})\s*,?\s*(\d{1,3})\s*,?\s*(\d{1,3})\b/g)) {
    if (/^hsl/.test(m[0])) continue;
    const c = [+m[1], +m[2], +m[3]];
    if (isGold(c, 'rgb')) out.push(m[0]);
  }
  return out;
}
function block(css) {
  const m = css.match(/\/\* gold tokens \(site redesign W1\)[\s\S]*?\/\* end gold tokens \*\//);
  return m && m[0];
}
export function tokenTable() {
  const b = block(read('main.css'));
  return [...b.matchAll(/--(gold[a-z0-9-]*)-rgb:\s*(\d+),\s*(\d+),\s*(\d+);/g)].map(m => [m[1], [+m[2], +m[3], +m[4]]]);
}

test('no identity gold is written as a fixed value in assets/css (0 left)', () => {
  const left = {};
  for (const f of files) { const g = fixedGolds(read(f)); if (g.length) left[f] = g; }
  const total = Object.values(left).reduce((n, g) => n + g.length, 0);
  assert.equal(total, 0, 'fixed golds left: ' + JSON.stringify(left));
});

test('the gold token block is the same in every base sheet', () => {
  const first = block(read(BASES[0]));
  assert.ok(first, 'main.css has the block');
  for (const f of BASES) assert.equal(block(read(f)), first, f + ' block differs from main.css');
});

test('every --gold*-rgb used is defined, and every defined one is used', () => {
  const defined = new Set(tokenTable().map(t => t[0]));
  const used = new Set();
  for (const f of files) for (const m of read(f).matchAll(/var\(--(gold[a-z0-9-]*)-rgb\)/g)) used.add(m[1]);
  for (const u of used) assert.ok(defined.has(u), '--' + u + '-rgb is used but not defined');
  for (const d of defined) assert.ok(used.has(d), '--' + d + '-rgb is defined but never used');
});
test('look.js knows every token, with the same values as the CSS', () => {
  const js = readFileSync(new URL('assets/js/look.js', ROOT), 'utf8');
  for (const [name, c] of tokenTable()) {
    const re = new RegExp("'" + name + "':\\s*\\[\\[" + c.join(',\\s*') + '\\]');
    assert.match(js, re, name + ' missing or different in look.js');
  }
});
