// P5: the preview's screenshots, desktop 1440 and phone 390, into p5/shots/ (webp). Fails on a horizontal scroll.
// Needs the static server: node docs/daily-bread/tools/static.mjs 4345
//   node docs/daily-bread/saints/p5/tools/shoot.mjs [port=4345] [only-prefix…]
import { mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const P5 = join(HERE, '..');
const ROOT = join(HERE, '..', '..', '..', '..', '..');
const req = createRequire(join(ROOT, 'tools', 'package.json'));
const puppeteer = req('puppeteer-core');
const sharp = req('sharp');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find(existsSync);
const PORT = Number(process.argv[2] || 4345);
const ONLY = process.argv.slice(3);
const BASE = `http://localhost:${PORT}/docs/daily-bread/saints/p5/`;
export const SCREENS = [
  // id, page + query, full page?
  ['01-patron', 'member.html?d=2026-12-04', false],
  ['02-patron-open', 'member.html?d=2026-12-04&open=1', true],
  ['02c-praise-full', 'member.html?d=2026-12-04&praise=1', false],
  ['02d-praise-big', 'member.html?d=2026-12-04&praise=1&size=4', false],
  ['03-diocese-and-feast', 'member.html?d=2027-06-14', true],
  ['04-repose-stack', 'member.html?d=2027-02-12', false],
  ['05-pictures', 'member.html?d=2027-02-12&pics=1', false],
  ['06-two-fathers', 'member.html?d=2027-03-20', false],
  ['07-father-and-feast', 'member.html?d=2027-02-21', true],
  ['08-pope-rest', 'member.html?d=2026-11-18&v=rest', false],
  ['09-dawn', 'member.html?d=2027-06-14&look=dawn', false],
  ['11-church-tab', 'member.html?tab=church&d=2026-11-25', true],
  ['12-church-open', 'member.html?tab=church&d=2026-11-25&open=redseadiocese', false],
  ['13-church-today', 'member.html?tab=church&d=2026-12-04', false],
  ['10-dawn-patron', 'member.html?d=2027-06-16&look=dawn', false],
  ['20-admin-list', 'admin.html', true],
  ['21-admin-edit', 'admin.html?m=edit&id=redseadiocese', false],
  ['22-admin-new', 'admin.html?m=new', false],
  ['23-admin-card', 'admin.html?m=card&id=abusefeinmartyrdom', false]
];
const SIZES = [['d', { width: 1440, height: 900, deviceScaleFactor: 1 }], ['m', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]];
mkdirSync(join(P5, 'shots'), { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let bad = 0;
for (const [id, path, full] of SCREENS) {
  if (ONLY.length && !ONLY.some(p => id.startsWith(p))) continue;
  for (const [k, vp] of SIZES) {
    const page = await browser.newPage();
    await page.setViewport(vp);
    await page.goto(BASE + path + (path.includes('?') ? '&' : '?') + 'w=' + (k === 'd' ? 'desktop' : 'phone'), { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 15000 });
    await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }' });
    await sleep(path.includes('m=card') ? 2500 : 900);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) { bad++; console.log('HORIZONTAL SCROLL', id, k, over); }
    const png = await page.screenshot({ fullPage: full && !path.includes('m=') && !(k === 'm' && path.startsWith('admin')) });
    await sharp(png).webp({ quality: 80 }).toFile(join(P5, 'shots', `${id}-${k}.webp`));
    await page.close();
    console.log('shot', id, k);
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
