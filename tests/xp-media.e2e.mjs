// Every scene that shows the admin's pictures, with a picture of every shape
// (9:16, 4:5, 1:1, 16:9, 4:1), measured in headless Chrome
// (tools/xp-media-matrix.mjs). The one sizing rule (kit.js mediaNode):
//  - never stretched;
//  - feeds and messages: the box is the picture's shape: no blurred bands,
//    nothing cut; a feed card is its full width; only a feed cuts a 9:16
//    poster to 4:5, at most 30 %, keeping its top;
//  - frames (stories, players, covers): the picture at its own shape inside
//    (no bands around the picture itself), or filling the frame when it is
//    within 8 % of its shape.
// Phone for every scene; the scenes' phone mock is the same size on a
// desktop, checked there for a feed, a chat and a frame.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ROOT } from '../tools/lib/gs.mjs';
import { SHAPES, SCENES, testPicture, matrixContent, matrixPage, openAndMeasure, closeScene, chromePath } from '../tools/xp-media-matrix.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4940;
const FEEDS = ['facebook', 'x', 'threads', 'telegram'];   // telegram: its channel post is a feed card
const FRAMES = ['instagram', 'tiktok', 'snapchat', 'youtube', 'spotify'];

let server;
let browser;
const pictures = {};
let content;

test.before(async () => {
  for (const shape of Object.keys(SHAPES)) pictures[shape] = await testPicture(shape);
  content = matrixContent(JSON.parse(readFileSync(`${ROOT}content.json`, 'utf8')));
  server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT)], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
});

test.after(async () => {
  await browser?.close();
  server?.kill();
});


function check(key, shape, m) {

  const where = `${key} ${shape}`;
  assert.ok(m, `${where}: the picture shows`);
  assert.ok(Math.abs(m.stretch - 1) <= 0.02, `${where}: not stretched (${m.stretch})`);
  assert.ok(m.bandX <= 2 && m.bandY <= 2, `${where}: no bands beside or above the picture (${m.bandX} / ${m.bandY})`);

  const [w, h] = SHAPES[shape];
  const cut = (m.cropX + m.cropY) / (m.cropX ? m.box[0] + m.cropX : m.box[1] + m.cropY);

  if (FRAMES.includes(key)) {
    assert.ok(m.fit === 'framed' || m.fit === 'bleed', `${where}: framed (${m.fit})`);
    if (m.fit === 'bleed') assert.ok(cut <= 0.08, `${where}: a near fit loses at most 8 % (${cut.toFixed(3)})`);
    return;
  }

  if (FEEDS.includes(key)) {
    assert.ok(m.gap <= 2, `${where}: a feed picture is the card's full width (gap ${m.gap})`);
    if (w / h < 4 / 5) {
      assert.equal(m.fit, 'cover', `${where}: a tall poster is cut like the platform does`);
      assert.ok(cut <= 0.3, `${where}: at most 30 % (${cut.toFixed(3)})`);
      assert.equal(m.cropX, 0);
      return;
    }
  }

  assert.equal(m.cropX + m.cropY, 0, `${where}: nothing cut`);

}


test('phone: every scene × every shape — true shape, no bands, the platform\'s framing', async () => {
  const { context, page } = await matrixPage(browser, PORT, 'phone', content, pictures);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const key of SCENES) {
    for (const shape of Object.keys(SHAPES)) {
      const m = await openAndMeasure(page, `mx-${key}-${shape}`);
      await closeScene(page);
      check(key, shape, m);
    }
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('desktop: a feed, a chat and a frame measure the same', async () => {
  const { context, page } = await matrixPage(browser, PORT, 'desktop', content, pictures);
  for (const key of ['facebook', 'whatsapp', 'instagram']) {
    for (const shape of Object.keys(SHAPES)) {
      const m = await openAndMeasure(page, `mx-${key}-${shape}`);
      await closeScene(page);
      check(key, shape, m);
    }
  }
  await context.close();
});
