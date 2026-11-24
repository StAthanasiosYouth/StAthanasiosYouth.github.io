// P3: real screenshots of the prototype (docs/daily-bread/saints/p3/admin.html) at 1440 (desktop) and 390 (phone).
//   node docs/daily-bread/saints/p3/tools/serve.mjs 4342   (must be running; the owner pictures, read only)
//   node docs/daily-bread/saints/p3/tools/shoot.mjs [name…] → docs/daily-bread/saints/p3/shots/<name>-d.png / -m.webp
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const P3 = join(HERE, '..');
const ROOT = join(HERE, '..', '..', '..', '..', '..');
const MOD = [join(ROOT, 'tools'), 'D:/private_projects/athanasios-links/tools'].find(d => existsSync(join(d, 'node_modules', 'puppeteer-core')));
const req = createRequire(join(MOD, 'package.json'));
const puppeteer = req('puppeteer-core');
const sharp = req('sharp');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
// P3_PICS=1: through tools/serve.mjs (4342) with the owner's pictures → shots-local/ (gitignored: the pictures stay off
// the public repository until P4); otherwise through docs/daily-bread/tools/static.mjs (4341), letters only → shots/
const PICS = process.env.P3_PICS === '1';
const BASE = `http://localhost:${PICS ? 4342 : 4341}/docs/daily-bread/saints/p3/admin.html`;
const OUT = PICS ? 'shots-local' : 'shots';

export const SHOTS = [
  ['01-people', '?s=people&dirty=1&v=large&g=cat', 'الشخصيات: صور كبيرة، مجمّعين بالمجموعة'],
  ['01a-people-large', '?s=people&v=large&g=cat#list', 'صور كبيرة: القايمة نفسها'],
  ['01b-people-medium', '?s=people&v=medium&g=cat#list', 'صور متوسطة'],
  ['01c-people-list', '?s=people&v=list&g=#list', 'قايمة'],
  ['01d-people-details', '?s=people&v=details&g=#list', 'تفاصيل'],
  ['02-people-incomplete', '?s=people&f=incomplete&v=large&g=#list', 'فلتر «بيانات ناقصة»'],
  ['03-person-theophilus', '?s=person&id=theophilus', 'الشخص: الأنبا ثاؤفيلس (أيام، محطات، ألبوم)'],
  ['04-person-day', '?s=person&id=mary&m=day&i=0', 'تعديل يوم: قبطي ← ميلادي على طول'],
  ['05-person-incomplete', '?s=person&id=isaacsyrian', 'شخص بياناته ناقصة: مار إسحق'],
  ['06-person-newday', '?s=person&id=isaacsyrian&m=newday', 'يوم جديد لشخص ناقص'],
  ['07-person-living', '?s=person&id=isaacnabih', 'أب حي: القمص إسحاق نبيه'],
  ['08-person-milestone', '?s=person&id=isaacnabih&m=ms&i=0', 'محطة بالشهر بس (القمصية، أغسطس ٢٠١٩)'],
  ['09-person-photo', '?s=person&id=theophilus&m=photo&i=-1', 'الألبوم: ضيف صورة من المكتبة'],
  ['10-occasions', '?s=occasions', 'المناسبات'],
  ['11-occasion-new', '?s=occasions&m=new&i=-1', 'مناسبة جديدة: كل سنة أو مرة واحدة'],
  ['12-publish', '?s=publish&demo=complete', 'راجع وانشر'],
  ['13-published', '?s=publish&done=1', 'اتنشر + النشرات اللي فاتت'],
  ['14-delete', '?s=person&id=isaacsyrian&m=delete', 'شيل شخص (بتأكيد مكتوب)']
];

const only = process.argv.slice(2);
mkdirSync(join(P3, OUT), { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const problems = [];
for (const [name, qs] of SHOTS) {
  if (only.length && !only.some(o => name.startsWith(o))) continue;
  for (const [suf, vp] of [['d', { width: 1440, height: 900 }], ['m', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const page = await browser.newPage();
    page.on('pageerror', e => { problems.push(`${name}-${suf}: ${e.message}`); console.log(name, suf, e.message); });
    await page.setViewport(vp);
    await page.goto(BASE + qs, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__ready, { timeout: 10000 });
    await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }' });
    if (qs.endsWith('#list')) await page.evaluate(() => { const v = document.querySelector('.sa-viewbar'); window.scrollTo(0, v.getBoundingClientRect().top + scrollY - 90); });
    await page.evaluate(() => Promise.all([...document.images].filter(i => i.getBoundingClientRect().top < innerHeight * 2).map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))));
    await new Promise(r => setTimeout(r, 500));
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (wide) problems.push(`${name}-${suf}: side scroll`);
    await sharp(await page.screenshot()).webp({ quality: 82 }).toFile(join(P3, OUT, `${name}-${suf}.webp`));
    
    await page.close();
  }
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'ALL OK');
