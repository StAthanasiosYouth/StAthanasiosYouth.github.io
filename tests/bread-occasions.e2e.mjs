// «خبزنا اليومي» P5 «مناسبات كنيستنا» (docs/daily-bread/saints/P5-PLAN.md): the member page in Chrome, its real CSP,
// against the REAL Worker code on SQLite (tests/bread-world.mjs): the registry published by the real admin routes (the
// 0037 seed), the feasts file published, the page's clock moved to the occasion's day (Date.now only).
//   off (BREAD_OCCASIONS = 0): nothing · Abu Sefein: one card, never in «نحب نفكّرك», the word, the full praise
//   14 June: the diocese + «نحب نفكّرك» apart · the pictures viewer · the «كنيستنا» tab (phone + desktop) · no program
//   Pope Athanasius (the family's patron) · a reposed pope's touch · no horizontal scroll · the P5b key
// Run: cd tools && node --experimental-sqlite --no-warnings --test --test-concurrency=1 ../tests/bread-occasions.e2e.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { startWorld, seedFor, prime, CHROME } from './bread-world.mjs';
import { dayAdd } from '../worker/src/bread/model.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const PROD = 'https://athanasios-api.menazak-lab.workers.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let w, browser, prog, seed;

test.before(async () => {
  w = await startWorld({ sitePort: 4766, apiPort: 4767 });
  prog = await w.program({ dayNo: 5 });
  seed = seedFor(prog.id, 30, 4, 0);
  await w.setting('BREAD_SAINTS', '1');
  const rv = await w.admin('GET', 'bread/saints/review');
  const pub = await w.admin('POST', 'bread/saints/publish', { expect: rv.body.expect });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  // the feasts files: Abu Sefein on 25 Hatour (as the «الأعياد» tab publishes it), the martyr Abaskhiron on 14 June
  const feast = (date, name, person, kind, word) => ({ date, name, word, url: 'https://st-takla.org/zJ/example.html', person, kind });
  for (const [month, list] of [
    ['2026-12', [feast('2026-12-04', 'الشهيد العظيم أبي سيفين (فيلوباتير مرقوريوس)', 'mercurius', 'استشهاده', 'كلمة السنكسار عن أبي سيفين.')]],
    ['2027-06', [feast('2027-06-14', 'الشهيد أباسخيرون القليني', 'abaskhiron', 'استشهاده', 'كلمة عن أباسخيرون.')]],
    ['2027-05', [{ ...feast('2027-05-01', 'الشهيد العظيم مار جرجس', 'george', 'استشهاده', 'في مثل هذا اليوم، الموافق ٢٣ برموده، كلام اليوم عن مار جرجس.'), praise: 'https://tasbeha.org/hymn_library/view/153', praiseTitle: 'السلام لك يا جاورجيوس ذو الاسم العظيم', praiseText: 'السلام لك يا جاورجيوس', praiseId: 'pr1' }, feast('2027-05-10', 'القديس البابا كيرلس السادس', 'cyril6', 'عيد جلوسه', 'كلمة عن البابا كيرلس.'), feast('2027-05-15', 'القديس البابا أثناسيوس الرسولي', 'athanasius', 'نياحته', 'كلمة السنكسار عن البابا أثناسيوس.')]]
  ]) assert.equal((await w.admin('POST', 'bread/feasts', { month, feasts: list })).status, 200);
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});
test.after(async () => {
  await browser?.close();
  await w?.close();
});

/* the page on `day` (its clock moved), the program live that day (day 5) unless `program: false` */
async function open(day, { width = 390, height = 844, program = true, path = '/daily-bread/?from=signin', fx = false } = {}) {
  await w.startOn(prog.id, program ? dayAdd(day, -4) : dayAdd(day, 3));
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
  await page.setViewport({ width, height, isMobile: width < 700, hasTouch: width < 700 });
  await page.setRequestInterception(true);
  page.on('request', r => (r.url().startsWith(PROD) ? r.abort() : r.continue()));
  // the section's effects (P5 identity) are off in these tests, on in their own
  await prime(page, w.API, { seed, extra: { ['bread.joined.' + prog.id]: dayAdd(day, -4), ...(fx ? {} : { 'bread.fx': 'off' }) } });
  const at = Date.parse(day + 'T09:00:00Z');
  await page.evaluateOnNewDocument(at => { const shift = at - Date.now(); const now = Date.now.bind(Date); Date.now = () => now() + shift; }, at);
  await page.goto(w.LOCAL + path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.br-dawn, .br-rest, .ch', { timeout: 20000 });
  await sleep(500);
  return { page, ctx, errors };
}
const text = (page, sel) => page.$eval(sel, n => n.textContent.replace(/\s+/g, ' ').trim());
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('off (BREAD_OCCASIONS = 0): no card, no «كنيستنا», «نحب نفكّرك» as before', async () => {
  await w.setting('BREAD_OCCASIONS', '0');
  const { page, ctx, errors } = await open('2026-12-04');
  assert.equal(await page.$('.oc'), null);
  assert.equal(await page.$('[data-tab="church"]'), null);
  assert.match(await text(page, '.br-feast__name'), /أبي سيفين/, 'the feasts card shows the day as today');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Abu Sefein (25 Hatour): ONE card at the top of the day, never again in «نحب نفكّرك»; the word, the days, the full praise', async () => {
  await w.setting('BREAD_OCCASIONS', '1');
  const { page, ctx, errors } = await open('2026-12-04');
  await page.waitForSelector('.oc--patron');
  assert.ok(await page.$eval('.oc--patron', n => n.nextElementSibling && n.nextElementSibling.classList.contains('br-day')), 'above the date and the verse');
  assert.equal(await page.$('.br-feast'), null, 'no second card for him');
  assert.match(await text(page, '.oc__title'), /عيد استشهاد شفيع كنيستنا/);
  assert.match(await page.$eval('.oc--patron', n => n.dataset.key), /^occ:abusefeinmartyrdom:2026$/, 'P5b key');
  assert.ok(await page.$('.oc--patron .oc-arch img'), 'his picture (the AI label comes with the P4 album, imported on production)');
  await page.click('.oc__more > summary');
  assert.match(await text(page, '.oc__more-body'), /كلمة السنكسار عن أبي سيفين/, 'the feasts file word');
  assert.equal(await page.$$eval('.oc__day', n => n.length), 3);
  assert.ok(await page.$('.oc__day[aria-current="date"]'));
  // owner 2026-11-25: the praise is whole in the card, every stanza with its response, no button
  assert.equal(await page.$('.oc--patron [data-praise]'), null);
  assert.equal(await page.$$eval('.oc--patron .oc__praise-st', n => n.length), 35);
  assert.match(await text(page, '.oc--patron .oc__praise-st'), /تعالوا نتهلل بالألحان/);
  assert.match(await text(page, '.oc--patron .oc__praise--full'), /avarewase\.org/);
  assert.ok(await noScroll(page) <= 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('14 June: «عيد إيبارشيتنا» stands for Anba Theophilus\'s ordination; «نحب نفكّرك» keeps the martyr of the day, apart; the pictures viewer', async () => {
  const { page, ctx, errors } = await open('2027-06-14', { width: 1440, height: 900 });
  await page.waitForSelector('.oc--memorial');
  assert.equal(await page.$$eval('.oc', n => n.length), 1);
  assert.match(await text(page, '.oc__who'), /مثلث الرحمات الأنبا ثاؤفيلس/);
  assert.match(await text(page, '.br-feast__name'), /أباسخيرون/);
  assert.equal(await page.$$eval('.oc__pics--stack .oc-arch', n => n.length), 3);
  assert.match(await page.$eval('.oc-arch img', i => i.style.objectPosition || 'none'), /%|none/);
  await page.click('.oc__more-pics');
  await page.waitForSelector('dialog.oc-view[open]');
  assert.match(await text(page, '.oc-view__n'), /١ \/ ٣/);
  await page.click('.oc-view__btn[data-step="1"]');
  assert.match(await text(page, '.oc-view__n'), /٢ \/ ٣/);
  assert.match(await text(page, '.oc-view__cap'), /تدشين مذبح/);
  await page.click('[data-close-view]');
  assert.ok(await page.$('.br-church-top'), '«كنيستنا» in the top bar on wide screens');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the «كنيستنا» tab (phone, owner 2026-11-25): no occasion today → a calm empty state + «مناسباتنا الجاية» (the nearest 4); a tap opens that day\'s card; no archive', async () => {
  let { page, ctx, errors } = await open('2026-11-25');
  await page.waitForSelector('.tabbar [data-tab="church"]');
  assert.equal(await page.$$eval('.tabbar__slots .tabbar__tab', n => n.length), 4, 'النهارده · كنيستنا · إعداداتي · الموقع');
  await page.click('.tabbar [data-tab="church"]');
  await page.waitForSelector('.ch');
  assert.ok(page.url().includes('s=church'));
  assert.match(await text(page, '.ch-empty'), /مفيش مناسبات خاصة بكنيستنا النهارده/);
  assert.equal(await page.$('.ch-patron, .ch-family, .ch-month, .ch-row'), null, 'no patron boxes, no list by month');
  assert.match(await text(page, '.ch-next'), /عيد استشهاد شفيع كنيستنا.*فاضل ٩ أيام/);
  if (process.env.SAINTS_SHOTS) { await sleep(300); await page.screenshot({ path: '../docs/daily-bread/saints/p5/shots/p5-church-empty-built-m.png' }); }
  await page.click('[data-next]');
  await page.waitForSelector('dialog.ch-nextsheet[open] .ch-nx');
  assert.equal(await page.$$eval('dialog.ch-nextsheet .ch-nx', n => n.length), 4);
  assert.match(await text(page, 'dialog.ch-nextsheet .ch-nx__left'), /^٩/);
  if (process.env.SAINTS_SHOTS) { await sleep(400); await page.screenshot({ path: '../docs/daily-bread/saints/p5/shots/p5-church-next-built-m.png' }); }
  await page.click('dialog.ch-nextsheet .ch-nx[data-open="abusefeinmartyrdom"]');
  await page.waitForSelector('dialog.ch-sheet:not(.ch-nextsheet)[open] .oc');
  assert.match(await text(page, 'dialog.ch-sheet .oc__title'), /عيد استشهاد شفيع كنيستنا/);
  await page.click('[data-sheet-close]');
  assert.ok(await noScroll(page) <= 1);
  await page.goBack();
  await page.waitForSelector('.br-dawn');
  assert.deepEqual(errors, []);
  await ctx.close();
  // a day with an occasion: its card, and «مناسباتنا الجاية» under it
  ({ page, ctx, errors } = await open('2026-12-04', { path: '/daily-bread/?s=church' }));
  await page.waitForSelector('.ch .oc');
  assert.equal(await page.$('.ch-empty'), null);
  assert.ok(await page.$('.ch-next'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('no program today: the card stays, under «قريب»; Pope Athanasius has his own seal card, «نحب نفكّرك» never repeats him', async () => {
  const { page, ctx, errors } = await open('2027-05-15', { program: false });
  await page.waitForSelector('.br-rest');
  await page.waitForSelector('.oc--family');
  assert.match(await text(page, '.oc--family .oc__title'), /شفيع أسرتنا/);
  assert.ok(await page.$('.oc-seal__logo'), 'the family\'s logo on the seal');
  await page.click('.oc--family .oc__more > summary');
  assert.match(await text(page, '.oc--family .oc__more-body'), /كلمة السنكسار عن البابا أثناسيوس/);
  assert.equal(await page.$$eval('.oc--family .oc__day', n => n.length), 2);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a reposed pope in «نحب نفكّرك»: «من بطاركة كنيستنا»; the Pope\'s own card is the light one', async () => {
  let { page, ctx, errors } = await open('2027-05-10');
  await page.waitForSelector('.br-feast--pope');
  assert.match(await text(page, '.br-feast__badge'), /من بطاركة كنيستنا/);
  assert.deepEqual(errors, []);
  await ctx.close();
  ({ page, ctx, errors } = await open('2026-11-18', { width: 1440, height: 900 }));
  await page.waitForSelector('.oc--pope');
  assert.match(await text(page, '.oc__badge'), /قداسة البابا/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('P5b: a saint\'s day praise shows whole in «نحب نفكّرك» (owner: no button), from praises.json; the words are the day\'s own', async () => {
  const { page, ctx, errors } = await open('2027-05-01');
  await page.waitForSelector('.br-feast');
  assert.match(await text(page, '.br-feast'), /كلام اليوم عن مار جرجس/);
  await page.waitForSelector('.br-feast .br-feast__praise--full .br-feast__st', { timeout: 10000 });
  assert.ok((await page.$$('.br-feast .br-feast__st')).length >= 10, 'every stanza');
  assert.match(await text(page, '.br-feast .br-feast__praise-title'), /جاورجيوس.*تمجيد/);
  assert.equal(await page.$('[data-feast-praise]'), null, 'no button');
  assert.equal(await noScroll(page), 0);
  if (process.env.SAINTS_SHOTS) { await page.$eval('.br-feast', n => n.scrollIntoView()); await sleep(400); await page.screenshot({ path: '../docs/daily-bread/saints/p5/shots/p5b-feast-card-m.png', fullPage: true }); }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('P5b seasons: a Kiahk day with no saint\'s card → «نحب نفكّرك» carries «يا م ر ي م» whole; a day in no season → nothing', async () => {
  let { page, ctx, errors } = await open('2026-12-20');
  await page.waitForSelector('.br-feast--season .br-feast__st', { timeout: 10000 });
  assert.match(await text(page, '.br-feast--season'), /كيهك/);
  assert.match(await text(page, '.br-feast--season .br-feast__praise-title'), /م ر ي م/);
  assert.ok((await page.$$('.br-feast--season .br-feast__st')).length >= 10);
  assert.equal(await noScroll(page), 0);
  if (process.env.SAINTS_SHOTS) { await page.$eval('.br-feast--season', n => n.scrollIntoView()); await sleep(400); await page.screenshot({ path: '../docs/daily-bread/saints/p5/shots/p5b-season-kiahk-m.png' }); }
  assert.deepEqual(errors, []);
  await ctx.close();
  ({ page, ctx, errors } = await open('2027-09-01'));
  await sleep(1500);
  assert.equal(await page.$('.br-feast--season'), null);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('P5 identity (owner 2026-11-25): Abu Sefein\'s day opens with the hymn\'s words written in time, his picture behind the name, then the card; once a day; the «كنيستنا» entrance once a day; the logo pair', async () => {
  await w.setting('BREAD_OCCASIONS', '1');
  let { page, ctx, errors } = await open('2026-12-04', { fx: true });
  await page.waitForSelector('.oc--patron');
  await page.waitForSelector('.oc--patron .oc-ev');
  assert.match(await text(page, '.oc-ev'), /تعالوا نتهلل بالألحان.*فيلوباتير مارقوريوس/);
  await page.waitForFunction(() => document.querySelectorAll('.oc-ev [data-t].on').length >= 2, { timeout: 5000 });   // the first words, in time
  await sleep(1200);
  if (process.env.SAINTS_SHOTS) await page.screenshot({ path: '../docs/daily-bread/saints/p5/shots/p5-identity-hymn-built-m.png' });
  // a tap skips to the card
  await page.click('.oc-ev');
  await page.waitForFunction(() => !document.querySelector('.oc-ev') && document.querySelector('.oc--patron.oc--shown'), { timeout: 5000 });
  await page.goto(w.LOCAL + '/daily-bread/?from=signin', { waitUntil: 'domcontentloaded' });   // a new visit, without the section's own intro
  await page.waitForSelector('.oc--patron');
  await sleep(600);
  assert.equal(await page.$('.oc-ev'), null, 'once a day');
  // the tab: its entrance (first visit of the day), and the two logos side by side
  await page.click('.tabbar [data-tab="church"]');
  await page.waitForSelector('.ch-in svg [id$="sword-a"]');
  if (process.env.SAINTS_SHOTS) { await sleep(1500); await page.screenshot({ path: '../docs/daily-bread/saints/p5/shots/p5-identity-entrance-built-m.png' }); }
  await page.waitForFunction(() => !document.querySelector('.ch-in'), { timeout: 6000 });
  assert.equal(await page.$$eval('.ch-pair img', n => n.length), 2);
  assert.match(await text(page, '.ch h1'), /مناسبات كنيستنا/);
  if (process.env.SAINTS_SHOTS) await page.screenshot({ path: '../docs/daily-bread/saints/p5/shots/p5-identity-tab-built-m.png' });
  assert.deepEqual(errors, []);
  await ctx.close();
});
