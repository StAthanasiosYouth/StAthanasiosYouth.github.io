// Site redesign W2: assets/js/look.js — the member's site colour before the first paint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const SRC = readFileSync(new URL('assets/js/look.js', ROOT), 'utf8');

function store(init = {}) {
  const map = new Map(Object.entries(init));
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), map };
}
function run({ local = store(), tab = store() } = {}) {
  const props = new Map(), attrs = {};
  const html = {
    style: { setProperty: (k, v) => props.set(k, v), removeProperty: k => props.delete(k) },
    setAttribute: (k, v) => { attrs[k] = v; }
  };
  const window = { localStorage: local, sessionStorage: tab };
  vm.runInNewContext(SRC, { window, document: { documentElement: html } });
  return { look: window.SiteLook, props, attrs, local, tab };
}
const SESSION = JSON.stringify({ token: 'as1.test', email: 'a@x.io' });
const LOOK = 'athanasios.account.look.v1';

test('no session on this device: gold, nothing set', () => {
  const r = run({ local: store({ [LOOK]: JSON.stringify({ tint: 'sea' }) }) });
  assert.equal(r.look.current(), 'gold');
  assert.equal(r.props.size, 0);
  assert.equal(r.attrs['data-tint'], 'gold');
});

test('a session with a kept colour: every gold token swapped before the first paint', () => {
  const r = run({ local: store({ 'athanasios.account.v1': SESSION, [LOOK]: JSON.stringify({ tint: 'sea' }) }) });
  assert.equal(r.look.current(), 'sea');
  assert.equal(r.attrs['data-tint'], 'sea');
  assert.equal(r.props.get('--gold-rgb'), '76, 195, 203');
  assert.equal(r.props.get('--gold-hi-rgb'), '159, 231, 236');
  assert.equal(r.props.get('--gold-deep-rgb'), '11, 63, 79');
  // a shade keeps its lightness and takes the colour's hue
  const [r1, g1, b1] = r.props.get('--gold-f7dc9e-rgb').split(', ').map(Number);
  assert.ok(g1 > r1 && b1 > r1, 'a light gold became a light sea');
  // every token of the CSS is set
  const css = readFileSync(new URL('assets/css/main.css', ROOT), 'utf8');
  const names = [...css.matchAll(/^\s*(--gold[a-z0-9-]*-rgb):/gm)].map(m => m[1]);
  for (const n of names) assert.ok(r.props.has(n), n);
});

test('a shared device: the session in this tab, the colour beside it', () => {
  const tab = store({ 'athanasios.account.v1': SESSION, [LOOK]: JSON.stringify({ tint: 'rose' }) });
  const r = run({ tab });
  assert.equal(r.look.current(), 'rose');
  r.look.remember('violet');
  assert.equal(JSON.parse(tab.getItem(LOOK)).tint, 'violet');
  assert.equal(r.local.getItem(LOOK), null);
});

test('back to gold removes the swap; an unknown colour is gold', () => {
  const r = run({ local: store({ 'athanasios.account.v1': SESSION, [LOOK]: JSON.stringify({ tint: 'ember' }) }) });
  assert.ok(r.props.size > 0);
  r.look.apply('gold');
  assert.equal(r.props.size, 0);
  assert.equal(r.look.apply('red'), 'gold');
  const bad = run({ local: store({ 'athanasios.account.v1': SESSION, [LOOK]: '{broken' }) });
  assert.equal(bad.look.current(), 'gold');
});

test('the seven colours, in the order of the sheet, the same as the Worker accepts', () => {
  const r = run();
  assert.deepEqual([...r.look.order], ['gold', 'sea', 'emerald', 'rose', 'ember', 'violet', 'silver']);
  const worker = readFileSync(new URL('worker/src/account/routes.js', ROOT), 'utf8');
  assert.match(worker, /TINTS = \['gold', 'sea', 'emerald', 'rose', 'ember', 'violet', 'silver'\]/);
});

test('every public page loads look.js before its first stylesheet', () => {
  const pages = ['index.html', '404.html', 'account/index.html', 'points/index.html', 'privacy/index.html', 'terms/index.html', 'black-theatre/index.html', 'silenttheatre/index.html', 'pages/index.html', 'events/index.html', 'competition/index.html'];
  for (const p of pages) {
    const html = readFileSync(new URL(p, ROOT), 'utf8');
    const look = html.indexOf('js/look.js"></script>');
    assert.ok(look > 0, p + ' has look.js');
    assert.ok(look < html.indexOf('rel="stylesheet"'), p + ': look.js before the CSS');
    assert.match(html, /script-src 'self'/, p + ' lets it run');
  }
  for (const gs of ['apps-script/Pages.gs', 'apps-script/CompModel.gs']) {
    const s = readFileSync(new URL(gs, ROOT), 'utf8');
    assert.ok(s.indexOf('assets/js/look.js') > 0 && s.indexOf('assets/js/look.js') < s.indexOf('rel="stylesheet"'), gs);
  }
});

test('the migration only adds', () => {
  const dir = new URL('worker/migrations/', ROOT);
  const f = readdirSync(dir).find(n => /member_tint/.test(n));
  const sql = readFileSync(new URL(f, dir), 'utf8').replace(/--.*$/gm, '').trim();
  assert.equal(sql, 'ALTER TABLE participants ADD COLUMN site_tint TEXT;');
});
