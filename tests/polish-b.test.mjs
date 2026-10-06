// Final Polish, Agent B (unit): the experience door's contract, the brand
// glyphs, media usage for the new fields, the /admin/ gateway's page.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ROOT } from '../tools/lib/gs.mjs';
import { PLATFORMS, SCENES, platformOf } from '../assets/js/platforms.js';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const ADMIN = 'menazakmena@gmail.com';
const plain = value => JSON.parse(JSON.stringify(value));

// xp.js imports the sheet and the icons, which parse markup with a <template>
globalThis.document ??= { createElement: () => ({ content: {} }) };
const { hasScene } = await import('../assets/js/xp.js');


/* ---------------- the experience door ---------------- */

test('hasScene: true for every valid key (registry or not), false otherwise', () => {
  for (const key of Object.keys(PLATFORMS)) assert.equal(hasScene(key), true, key);
  for (const key of ['future-app', 'mastodon', 'a', 'web']) assert.equal(hasScene(key), true, key);
  for (const key of ['', 'none', 'auto', 'Bad Key', '1abc', 'x'.repeat(25), undefined, null, 7]) assert.equal(hasScene(key), false, String(key));
});

test('every scene the registry names has a renderer (and stories/vertical/browser too)', () => {
  for (const scene of SCENES) {
    const source = readFileSync(`${ROOT}assets/js/xp/${scene}.js`, 'utf8');
    assert.match(source, /export function play\(stage, /, scene);
  }
  assert.equal(platformOf('future-app').scene, 'browser', 'unknown keys: the generic scene');
});

test('the first page load stays light: xp.js never imports the registry or a scene', () => {
  const door = readFileSync(`${ROOT}assets/js/xp.js`, 'utf8');
  const imports = [...door.matchAll(/^import .* from '(.+)';$/gm)].map(m => m[1]);
  assert.deepEqual(imports.sort(), ['./dom.js', './sheet.js']);
  assert.match(door, /import\('\.\/xp\/engine\.js'\)/, 'the engine loads on demand');
});

test('scene code animates transform / opacity only (and no inline style attributes)', () => {
  for (const scene of [...SCENES, 'kit', 'engine']) {
    const source = readFileSync(`${ROOT}assets/js/xp/${scene}.js`, 'utf8');
    assert.doesNotMatch(source, /setAttribute\('style'|style="/, `${scene}: no inline style attributes (CSP)`);
    // keyframe objects: only transform / opacity (the WhatsApp entrance
    // keeps its original ✓✓ colour + clip keyframes)
    const checked = scene === 'whatsapp' ? source.replace(/tl\.from\(ticks, \[[\s\S]*?\]\, \{/, '') : source;
    for (const frame of checked.matchAll(/\{ ?((?:transform|opacity|offset|[a-zA-Z]+): [^{}]*)\}/g)) {
      const props = [...frame[1].matchAll(/(?:^|, )([a-zA-Z]+):/g)].map(m => m[1]);
      if (!props.includes('transform') && !props.includes('opacity')) continue;
      const other = props.filter(p => !['transform', 'opacity', 'offset', 'easing'].includes(p));
      assert.deepEqual(other, [], `${scene}: ${frame[0]}`);
    }
  }
});


/* ---------------- brand glyphs ---------------- */

test('the compacted brand glyphs draw the same as simple-icons (pixel check)', async () => {
  const sharp = require('sharp');
  const si = require('simple-icons');
  const { BRAND_ICONS } = await import('../assets/js/icons-brand.js');
  const KEYS = { facebook: 'siFacebook', instagram: 'siInstagram', tiktok: 'siTiktok', youtube: 'siYoutube', whatsapp: 'siWhatsapp', telegram: 'siTelegram', spotify: 'siSpotify', messenger: 'siMessenger', discord: 'siDiscord', x: 'siX', threads: 'siThreads', snapchat: 'siSnapchat' };
  const draw = d => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24"><path d="${d}"/></svg>`)).ensureAlpha().extractChannel(3).raw().toBuffer();
  for (const [name, key] of Object.entries(KEYS)) {
    assert.ok(BRAND_ICONS[name], name);
    const [a, b] = await Promise.all([draw(BRAND_ICONS[name].path), draw(si[key].path)]);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    assert.ok(diff / a.length < 1.5, `${name}: mean alpha difference ${(diff / a.length).toFixed(2)}`);
  }
});

test('every registry icon is a link icon the admin can pick', async () => {
  const { LINK_ICON_NAMES } = await import('../assets/js/icons.js');
  for (const [key, p] of Object.entries(PLATFORMS)) {
    if (p.icon) assert.ok(LINK_ICON_NAMES.includes(p.icon), `${key}: ${p.icon}`);
  }
});


/* ---------------- media usage for the schema-4 fields ---------------- */

const webp = fill => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(40, fill)]).toString('base64');

test('a person\'s photo and a scene\'s photos are «used»: the library shows it and won\'t delete them', () => {
  const w = createWorld();
  const gs = w.as(ADMIN).gs;
  gs.setup();
  const up = fill => plain(gs.apiUploadMedia({ full: webp(fill), thumb: webp(fill), mime: 'image/webp', width: 256, height: 256, alt: 'صورة ' + fill })).media.id;
  const avatar = up(51);
  const photo = up(52);
  const support = plain(gs.apiState()).draft.contacts.find(c => c.kind === 'support');
  gs.apiSaveContact({ ...support, image: avatar });
  const link = plain(gs.apiState()).draft.links.find(l => l.icon === 'instagram');
  gs.apiSaveLink({ ...link, gallery: [photo] });

  const library = plain(gs.apiMediaLibrary());
  const usage = id => library.items.find(i => i.id === id).usage.map(u => u.area);
  assert.deepEqual(usage(avatar), ['contacts']);
  assert.deepEqual(usage(photo), ['links']);
  assert.throws(() => gs.apiDeleteMedia(avatar), /مستخدمة|used/);
});


/* ---------------- the /admin/ gateway ---------------- */

const EXEC = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

test('/admin/: one admin URL (refresh = button), noindex, no-referrer, strict CSP, no inline code', () => {
  const html = readFileSync(`${ROOT}admin/index.html`, 'utf8');
  const button = /<a class="gate__enter" id="enter" href="([^"]+)"/.exec(html)[1];
  const refresh = /<meta http-equiv="refresh" content="\d+; url=([^"]+)">/.exec(html)[1];
  assert.match(button, EXEC);
  assert.equal(refresh, button, 'the no-JS refresh and the button go to the same place');
  assert.equal([...html.matchAll(/script\.google\.com\/macros/g)].length, 2, 'the URL is only in those two places');

  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  for (const rule of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "base-uri 'none'", "form-action 'none'"]) assert.ok(csp.includes(rule), rule);
  assert.doesNotMatch(html, /\sstyle=|<style|<script>|\son[a-z]+="/, 'no inline style or script');
  assert.doesNotMatch(html, /<iframe/, 'the admin is never embedded');

  const js = readFileSync(`${ROOT}admin/admin.js`, 'utf8');
  assert.doesNotMatch(js, /script\.google\.com\/macros\/s\/AK/, 'admin.js reads the URL from the button');
  assert.match(js, /location\.replace/);
  assert.match(js, /window\.top !== window\.self/, 'frame-busting');

  assert.match(readFileSync(`${ROOT}robots.txt`, 'utf8'), /^Disallow: \/admin\/$/m);
  const index = readFileSync(`${ROOT}index.html`, 'utf8');
  assert.doesNotMatch(index, /admin\//, 'not linked from the public page');
});
