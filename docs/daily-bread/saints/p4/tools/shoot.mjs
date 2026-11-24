// P4: real screenshots of the review page at 1440 (desktop) and 390 (phone), full length, every picture loaded.
//   node docs/daily-bread/saints/p4/tools/serve.mjs 4344   (must be running)
//   node docs/daily-bread/saints/p4/tools/shoot.mjs        → docs/daily-bread/saints/p4/shots-local/<name>-d.webp / -m.webp
// shots-local/ is gitignored: the owner's pictures stay off the public repository until the owner approves (like P3).
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'shots-local');
const ROOT = join(HERE, '..', '..', '..', '..', '..');
const MOD = [join(ROOT, 'tools'), 'D:/private_projects/athanasios-links/tools'].find(d => existsSync(join(d, 'node_modules', 'puppeteer-core')));
const req = createRequire(join(MOD, 'package.json'));
const puppeteer = req('puppeteer-core');
const sharp = req('sharp');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const BASE = `http://localhost:${process.env.P4_PORT || 4344}/docs/daily-bread/saints/p4/`;

const SHOTS = [
  ['01-all', '', 'الصفحة كلها: الملخص، والقرارات، والكارت، والأنبا ثاؤفيلس، وكل الصور بالمجموعة', true],
  ['02-attention', '?f=att#grid', 'محتاج انتباه بس', true],
  ['03-theophilus-main', '?open=theophilus-6', 'الأنبا ثاؤفيلس: الصورة الأساسية المقترحة', false],
  ['04-living-angelos', '?open=angelosmourad-1', 'أب حي: ظبط الصورة من P3', false],
  ['05-ai-card', '?open=mercurius-1', 'صورة ذكاء اصطناعي في الكارت: «صورة تعبيرية»', false],
  ['06-art-habib', '?open=habibgirgis-1', 'رسم في فولدر الصور الحقيقية', false]
];
const SIZES = [['d', 1440, 900], ['m', 390, 844]];

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--font-render-hinting=none'] });
const problems = [];
try {
  for (const [name, q, , full] of SHOTS) {
    for (const [s, w, h] of SIZES) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h, deviceScaleFactor: s === 'm' ? 2 : 1, isMobile: s === 'm', hasTouch: s === 'm' });
      await page.goto(BASE + q, { waitUntil: 'networkidle0' });
      // every picture now (the page itself loads them lazily), then wait for them
      await page.evaluate(async () => {
        for (const img of document.images) img.loading = 'eager';
        await Promise.all([...document.images].map(i => (i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))));
        if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
      });
      await new Promise(r => setTimeout(r, 300));
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 0) problems.push(`${name}-${s}: horizontal scroll ${over}px`);
      const broken = await page.evaluate(() => [...document.images].filter(i => !i.naturalWidth).length);
      if (broken) problems.push(`${name}-${s}: ${broken} pictures did not load`);
      const png = await page.screenshot({ fullPage: full && !q.includes('#'), type: 'png' });
      // WEBP stops at 16383 px: a long page is saved in parts (-1, -2 …)
      const { height } = await sharp(png, { limitInputPixels: false }).metadata();
      const CUT = 15000;
      if (height <= CUT) await sharp(png, { limitInputPixels: false }).webp({ quality: 78 }).toFile(join(OUT, `${name}-${s}.webp`));
      else for (let i = 0, top = 0; top < height; i++, top += CUT) {
        await sharp(png, { limitInputPixels: false }).extract({ left: 0, top, width: (await sharp(png, { limitInputPixels: false }).metadata()).width, height: Math.min(CUT, height - top) })
          .webp({ quality: 78 }).toFile(join(OUT, `${name}-${s}-${i + 1}.webp`));
      }
      await page.close();
      process.stdout.write(name + '-' + s + ' ');
    }
  }
} finally {
  await browser.close();
}
console.log('\n' + (problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no horizontal scroll, every picture loaded'));
