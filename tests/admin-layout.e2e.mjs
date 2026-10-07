// /admin/ never scrolls sideways, even with what Google's sign-in adds to the
// page: its screen-reader announcer is parked at left:-10000px from script
// (allowed by the CSP), which in this right-to-left page would otherwise add
// 10,000px of empty sideways scroll. Real scrollbars (Windows-like).
//
// Run: cd tools && npm run e2e

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4477;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

let server;
let browser;

test.before(async () => {
  server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT)], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
});

test.after(async () => {
  await browser?.close();
  server?.kill();
});

test('Google\'s announcer at left:-10000px adds no sideways scroll (RTL), desktop and phone', async () => {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844, isMobile: true, hasTouch: true }]) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'load' });
    // what Google's sign-in script does after "Signed in"
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'g_a11y_announcement';
      Object.assign(div.style, { position: 'absolute', left: '-10000px', width: '1px', height: '1px', overflow: 'hidden' });
      const span = document.createElement('span');
      span.setAttribute('role', 'alert');
      span.textContent = 'Signed in';
      div.append(span);
      document.body.append(div);
    });
    const size = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
    assert.equal(size.page, size.view, `page width = view width at ${viewport.width}px`);
    assert.equal(await page.$eval('#g_a11y_announcement', n => n.textContent), 'Signed in', 'still there for screen readers');
    await page.close();
  }
});
