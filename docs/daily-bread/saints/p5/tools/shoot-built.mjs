// P5: the BUILT member page (the real /daily-bread/ on the real Worker code, tests/bread-world.mjs) at the approved
// design's states, desktop 1440 and phone 390 → p5/built/*.webp, for compare.html (the design-match rule). The albums
// of the published registry (daily-bread/data/saints.json, P4's pictures) are put in the world first, then the
// registry is published by the real admin routes; the page's clock is moved to each day (Date.now only).
//   node --experimental-sqlite --no-warnings docs/daily-bread/saints/p5/tools/shoot-built.mjs [only-prefix…]
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const P5 = join(HERE, '..');
const ROOT = join(HERE, '..', '..', '..', '..', '..');
const imp = p => import(pathToFileURL(join(ROOT, p)).href);
const { startWorld, seedFor, prime, CHROME } = await imp('tests/bread-world.mjs');
const { dayAdd } = await imp('worker/src/bread/model.js');
const req = createRequire(join(ROOT, 'tools', 'package.json'));
const puppeteer = req('puppeteer-core');
const sharp = req('sharp');
const ONLY = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const STATES = [
  ['01-patron', '2026-12-04', {}],
  ['02-patron-open', '2026-12-04', { open: true, full: true }],
  ['02c-praise-full', '2026-12-04', { praise: true }],
  ['03-diocese-and-feast', '2027-06-14', { full: true }],
  ['04-repose-stack', '2027-02-12', {}],
  ['05-pictures', '2027-02-12', { pics: true }],
  ['06-two-fathers', '2027-03-20', {}],
  ['08-pope-rest', '2026-11-18', { rest: true }],
  ['11-church-tab', '2026-11-25', { church: true, full: true }],
  ['12-church-open', '2026-11-25', { church: true, openOcc: 'redseadiocese' }],
  ['14-bishop', '2027-06-09', {}],
  ['16-pope', '2027-11-18', {}],
  ['17-pope-feast', '2027-05-10', { full: true }],
  ['18-family', '2027-05-15', {}]
];

const w = await startWorld({ sitePort: 4776, apiPort: 4777 });
const prog = await w.program({ dayNo: 5 });
const seed = seedFor(prog.id, 30, 4, 0);
await w.setting('BREAD_SAINTS', '1');
await w.setting('BREAD_OCCASIONS', '1');
// P4's albums (the media library pictures in the repo), as on production
const pub = JSON.parse(readFileSync(join(ROOT, 'daily-bread', 'data', 'saints.json'), 'utf8'));
for (const p of pub.people) if (p.album) await w.h.db.prepare("UPDATE saints_items SET data = json_set(data, '$.album', json(?)) WHERE kind = 'person' AND id = ?").bind(JSON.stringify(p.album), p.id).run();
const rv = await w.admin('GET', 'bread/saints/review');
if ((await w.admin('POST', 'bread/saints/publish', { expect: rv.body.expect })).status !== 200) throw new Error('publish');
const feast = (date, name, person, kind, word, img, imgAi) => ({ date, name, word, url: 'https://st-takla.org/', person, kind, img, imgAi });
const pic = id => { const p = pub.people.find(x => x.id === id); const a = p.album.find(x => x.main) || p.album[0]; return ['/' + a.media, a.type !== 'photo']; };
for (const [month, list] of [
  ['2026-12', [feast('2026-12-04', 'الشهيد العظيم أبي سيفين (فيلوباتير مرقوريوس)', 'mercurius', 'استشهاده', 'فيلوباتير مرقوريوس كان قائد في الجيش الروماني، وظهر له ملاك الرب وإداه سيف تاني، ومن هنا اتسمّى «أبو سيفين».\n\nلما الإمبراطور ديسيوس طلب من الجنود يبخّروا للأوثان رفض، واتعذّب كتير وفضل ثابت لحد ما استشهد.', ...pic('mercurius'))]],
  ['2027-06', [feast('2027-06-14', 'الشهيد أباسخيرون القليني', 'abaskhiron', 'استشهاده', 'جندي من قلين، اعترف بالمسيح قدام الوالي ورفض يبخّر للأوثان، واستشهد.', ...pic('abaskhiron'))]],
  ['2027-05', [feast('2027-05-10', 'القديس البابا كيرلس السادس', 'cyril6', 'عيد جلوسه', 'كلمة السنكسار من «الأعياد».', ...pic('cyril6')), feast('2027-05-15', 'القديس البابا أثناسيوس الرسولي', 'athanasius', 'نياحته', 'البابا العشرين من بابوات الإسكندرية، حامي الإيمان.', ...pic('athanasius'))]]
]) if ((await w.admin('POST', 'bread/feasts', { month, feasts: list })).status !== 200) throw new Error('feasts ' + month);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
mkdirSync(join(P5, 'built'), { recursive: true });
for (const [id, day, o] of STATES) {
  if (ONLY.length && !ONLY.some(p => id.startsWith(p))) continue;
  await w.startOn(prog.id, o.rest ? dayAdd(day, 3) : dayAdd(day, -4));
  for (const [k, vp] of [['d', { width: 1440, height: 900 }], ['m', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(vp);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await prime(page, w.API, { seed, extra: { ['bread.joined.' + prog.id]: dayAdd(day, -4) } });
    const at = Date.parse(day + 'T09:00:00Z');
    await page.evaluateOnNewDocument(at => { const shift = at - Date.now(); const now = Date.now.bind(Date); Date.now = () => now() + shift; }, at);
    await page.goto(w.LOCAL + '/daily-bread/?from=signin' + (o.church ? '&s=church' : ''), { waitUntil: 'networkidle0' });
    await page.waitForSelector(o.church ? '.ch' : '.br-dawn', { timeout: 20000 });
    await sleep(400);   // the page's CSP refuses injected styles: reduced motion (set before the load) keeps it still
    if (o.open) await page.evaluate(() => document.querySelector('.oc details')?.setAttribute('open', ''));
    if (o.praise) await page.evaluate(() => document.querySelector('[data-praise]').click());
    if (o.pics) await page.evaluate(() => document.querySelector('.oc__more-pics').click());
    if (o.openOcc) await page.evaluate(id => document.querySelector(`[data-open="${id}"]`).click(), o.openOcc);
    await sleep(1200);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) console.log('HORIZONTAL SCROLL', id, k, over);
    await sharp(await page.screenshot({ fullPage: !!o.full })).webp({ quality: 80 }).toFile(join(P5, 'built', `${id}-${k}.webp`));
    await ctx.close();
    console.log('built', id, k);
  }
}
await browser.close();
await w.close();
process.exit(0);
