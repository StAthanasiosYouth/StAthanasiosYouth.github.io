// The ONE fit rule for the scenes (sheets.css "MINI-EXPERIENCES",
// engine.js fitStage), on many screens (tools/xp-fit-matrix.mjs SCREENS:
// 280 × 653 up to 440 × 956, the Galaxy S20 FE with and without Chrome's
// bars, short phones, landscape, tablet, desktop):
//  - every scene fits: the sheet inside the visible screen, the button on
//    screen and clickable, nothing sideways or scrolling, the controls
//    clear of each other, the phone 9:16 and not too small;
//  - the WhatsApp poster (the S20 FE report): whole on the FIRST open, still
//    whole after newer messages, the same size when opened again;
//  - a slow picture, and a picture whose stored size is wrong: the box has
//    its final shape before / after it arrives (no bands, nothing cut);
//  - rotating the phone, resizing the window: refitted at once.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ROOT } from '../tools/lib/gs.mjs';
import { SCENES, SHAPES, testPicture, matrixContent, measureMedia, pathOf, chromePath } from '../tools/xp-media-matrix.mjs';
import { SCREENS, fitPage, openScene, fitOf, closeIt, problems, measureFit } from '../tools/xp-fit-matrix.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4950;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let server;
let browser;
const pictures = {};
let base;

test.before(async () => {
  for (const shape of Object.keys(SHAPES)) pictures[shape] = await testPicture(shape);
  base = JSON.parse(readFileSync(`${ROOT}content.json`, 'utf8'));
  server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT)], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
});

test.after(async () => {
  await browser?.close();
  server?.kill();
});


test('every scene fits every screen (23 screens × 12 scenes)', async () => {
  const content = matrixContent(base);
  const failures = [];
  for (const screen of Object.keys(SCREENS)) {
    const { context, page } = await fitPage(browser, PORT, screen, pictures, content);
    for (const key of SCENES) {
      await openScene(page, `mx-${key}-4x5`);
      const issues = problems(await fitOf(page));
      if (issues.length) failures.push(`${screen} ${key}: ${issues.join('; ')}`);
      await closeIt(page);
    }
    await context.close();
  }
  assert.deepEqual(failures, []);
});


/* the WhatsApp poster, measured once its message is on screen */
async function posterNow(page) {
  await page.waitForFunction(() => {
    const msg = document.querySelector('dialog[open] .wa-msg.is-current');
    return msg && getComputedStyle(msg).opacity === '1' && msg.getAnimations().every(a => a.playState !== 'running');
  }, { timeout: 10000 });
  const media = await page.evaluate(measureMedia);
  const fit = await page.evaluate(measureFit);
  return { media, whole: fit.currentWhole };
}

for (const screen of ['s20fe-bars', 's20fe', '280x653', '360x560-bars']) {
  for (const shape of ['4x5', '9x16']) {
    test(`WhatsApp ${shape} poster on ${screen}: whole on the first open, after new messages, and when opened again`, async () => {
      const { context, page } = await fitPage(browser, PORT, screen, pictures, matrixContent(base, ['whatsapp']));
      await openScene(page, `mx-whatsapp-${shape}`);
      const first = await posterNow(page);
      assert.equal(first.whole, true, 'the whole message on screen');
      assert.deepEqual([first.media.bandX, first.media.bandY, first.media.cropX, first.media.cropY], [0, 0, 0, 0], 'the whole picture, no bands');
      assert.ok(Math.abs(first.media.stretch - 1) <= 0.02);
      // newer messages arrive (two rounds of the chatter, the typing dots between):
      // whole all along (a sample may fall between a change and its next frame, never two)
      let streak = 0;
      for (let t = 0; t < 40; t++) {
        await sleep(300);
        const now = await page.evaluate(measureFit);
        streak = now.currentWhole === false ? streak + 1 : 0;
        assert.ok(streak < 2, `still whole while newer messages arrive (at ${((t + 1) * 0.3).toFixed(1)}s: ${JSON.stringify(now.currentAt)})`);
      }
      assert.equal((await page.evaluate(measureFit)).currentWhole, true, 'still whole after newer messages');
      assert.deepEqual((await page.evaluate(measureMedia)).box, first.media.box, 'the same size');
      await closeIt(page);
      await openScene(page, `mx-whatsapp-${shape}`);
      const again = await posterNow(page);
      assert.equal(again.whole, true);
      assert.deepEqual(again.media.box, first.media.box, 'the same size when opened again');
      await context.close();
    });
  }
}


test('a slow picture: its box has the final shape before it arrives; nothing moves when it does', async () => {
  const content = matrixContent(base, ['whatsapp', 'facebook', 'tiktok']);
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/content.json')) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(content) });
    const shape = Object.keys(pictures).find(k => url.endsWith(`/${pathOf(k)}`));
    if (shape) { setTimeout(() => req.respond({ status: 200, contentType: 'image/webp', body: pictures[shape] }), 2500); return; }
    return req.continue();
  });
  await page.setViewport(SCREENS['s20fe-bars']);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#main[data-state="ready"]');
  for (const key of ['facebook', 'tiktok']) {
    await page.evaluate(id => { location.hash = `#follow/${id}`; }, `mx-${key}-4x5`);
    await page.waitForSelector('dialog[open] .xp-media[data-id^="own-"]');
    // layout size (an entrance animation's scale doesn't count)
    const box = () => page.$eval('dialog[open] .xp-media[data-id^="own-"]', el => [el.offsetWidth, el.offsetHeight, el.className]);
    const before = await box();
    await page.waitForFunction(() => document.querySelector('dialog[open] .xp-media[data-id^="own-"] .xp-media__main').naturalWidth > 0, { timeout: 10000 });
    await sleep(300);
    assert.deepEqual(await box(), before, `${key}: the same box before and after the picture arrives`);
    const m = await page.evaluate(measureMedia);
    assert.ok(m.bandX <= 2 && m.bandY <= 2, `${key}: no bands`);
    await closeIt(page);
  }
  await context.close();
});

test('a picture whose stored size is wrong takes its real shape once it arrives', async () => {
  // the content says square; the picture is 4:5
  const content = matrixContent(base, ['whatsapp', 'facebook', 'instagram']);
  for (const link of content.sections[0].links) {
    if (link.id.endsWith('-4x5') && link.gallery) { link.gallery[0].w = 1000; link.gallery[0].h = 1000; }
  }
  const { context, page } = await fitPage(browser, PORT, '390x844', pictures, content);
  for (const key of ['whatsapp', 'facebook', 'instagram']) {
    await openScene(page, `mx-${key}-4x5`);
    await sleep(key === 'whatsapp' ? 2500 : 600);
    const m = await page.evaluate(measureMedia);
    assert.ok(m, key);
    assert.ok(m.bandX <= 2 && m.bandY <= 2, `${key}: no bands (${m.bandX}/${m.bandY})`);
    assert.equal(m.cropX + m.cropY, 0, `${key}: nothing cut`);
    assert.ok(Math.abs(m.stretch - 1) <= 0.02);
    await closeIt(page);
  }
  await context.close();
});

test('rotating the phone and resizing the window refit the open scene at once', async () => {
  const { context, page } = await fitPage(browser, PORT, '390x844', pictures, matrixContent(base, ['tiktok', 'whatsapp']));
  for (const key of ['tiktok', 'whatsapp']) {
    await openScene(page, `mx-${key}-4x5`);
    const upright = await fitOf(page);
    assert.deepEqual(problems(upright), [], `${key} upright`);
    for (const screen of ['land-844x390', '320x568', 's20fe-bars', '390x844']) {
      await page.setViewport(SCREENS[screen]);
      await sleep(500);
      const fit = await fitOf(page);
      assert.deepEqual(problems(fit), [], `${key} after turning to ${screen}`);
    }
    const landscape = await (async () => { await page.setViewport(SCREENS['land-844x390']); await sleep(500); return fitOf(page); })();
    assert.ok(landscape.zoom < upright.zoom, 'smaller on its side');
    await page.setViewport(SCREENS['390x844']);
    await sleep(400);
    await closeIt(page);
  }
  await context.close();
});
