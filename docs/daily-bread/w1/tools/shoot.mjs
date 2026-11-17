// W1 shots: every screen in screens.json, phone 390 × 844 (2x) and desktop 1440 × 900, saved as WebP in w1/shots/.
// Needs docs/daily-bread/tools/static.mjs on 4340.  Usage: node docs/daily-bread/w1/tools/shoot.mjs [id-prefix …]
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const W1 = join(HERE, '..');
const ROOT = join(W1, '..', '..', '..');
const OUT = join(W1, 'shots');
mkdirSync(OUT, { recursive: true });
const MOD = [join(ROOT, 'tools'), 'D:/private_projects/athanasios-links/tools'].find(d => existsSync(join(d, 'node_modules', 'puppeteer-core')));
const req = createRequire(join(MOD, 'package.json'));
const puppeteer = req('puppeteer-core');
const sharp = req('sharp');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const only = process.argv.slice(2);
const screens = JSON.parse(readFileSync(join(W1, 'screens.json'), 'utf8')).filter(s => !only.length || only.some(p => s.id.startsWith(p)));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'] });
const page = await browser.newPage();
async function shot(s, kind) {
  const vp = kind === 'm' ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : kind === 'd' ? { width: 1440, height: 900, deviceScaleFactor: 1 } : { width: s.w, height: s.h, deviceScaleFactor: 1 };
  await page.setViewport(vp);
  await page.goto('http://localhost:4340/docs/daily-bread/w1/' + s.url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await new Promise(r => setTimeout(r, s.wait || 1800));
  const buf = await page.screenshot({ fullPage: !!(s.full && kind === 'm'), type: 'png' });
  const name = `${s.id}${kind === 's' ? '' : '-' + kind}.webp`;
  await sharp(buf).webp({ quality: 90 }).toFile(join(OUT, name));
  console.log('shot', name);
}
for (const s of screens) {
  if (s.single) { await shot(s, 's'); continue; }
  if (s.m) await shot(s, 'm');
  if (s.d) await shot(s, 'd');
}
await browser.close();
