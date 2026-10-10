// The admin fix pass in a real browser (the official /admin/ against the
// real .gs code in a fake Apps Script world): a publish under way reopens
// at its step (never a second publish), and an upload stays listed while
// the admin moves between screens (never a second upload).
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/fix-admin.e2e.mjs

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4545;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const BASE = `${SITE}/`;
const ADMIN_URL = `${BASE}admin/`;
const ADMIN = 'menazakmena@gmail.com';
const DESKTOP = { width: 1440, height: 900 };

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

let world;
let server;
let browser;

test.before(async () => {
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', BASE);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  world.gs.SESSION_STALE_SECONDS = 0;
  world.as('');
  const config = { apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK };
  server = createSiteServer({ world: { issueToken: c => world.issueToken(c), get github() { return world.github; } }, config: () => config, claims: () => ({ email: ADMIN }) });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => (server ? server.close(resolve) : resolve()));
});

async function open(viewport = DESKTOP) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  const google = await interceptGoogle(page, { post: body => world.post(body) }, { site: { origin: SITE, local: LOCAL } });
  await page.setViewport(viewport);
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
  // `fn` calls wait until window.__release[fn]() (counted in window.__calls)
  await page.evaluate(() => {
    const real = A.call;
    window.__calls = {};
    window.__release = {};
    window.__hold = new Set();
    A.call = function (fn) {
      const args = arguments;
      window.__calls[fn] = (window.__calls[fn] || 0) + 1;
      if (!window.__hold.has(fn)) return real.apply(A, args);
      return new Promise(resolve => { window.__release[fn] = () => resolve(real.apply(A, args)); });
    };
  });
  return { page, problems, close: () => context.close() };

}

const current = page => page.evaluate(() => {
  const step = document.querySelector('dialog.sheet[open] .stepper[data-publish] .is-current');
  return step ? [...step.parentNode.children].indexOf(step) : -1;
});

test('a publish under way: closing the editor and opening it again shows the same job at its step', async () => {

  const { page, problems, close } = await open();

  await page.evaluate(() => A.go('settings'));
  await page.waitForSelector('.card .input');
  await page.evaluate(() => {
    const field = [...document.querySelectorAll('.field')].find(f => f.dataset.label === 'الجملة التعريفية');
    const input = field.querySelector('input, textarea');
    input.value = 'نشر وهو مقفول';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    field.closest('.card').querySelector('.btn--primary').click();
  });
  await page.waitForFunction(() => A.setting('site.tagline') === 'نشر وهو مقفول');

  await page.evaluate(() => window.__hold.add('apiPublish'));
  await page.click('#publish-open');
  await page.waitForSelector('dialog.sheet[open] .changes');
  await page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .sheet__foot .btn--primary')][0].click());
  await page.waitForFunction(() => window.__release.apiPublish);
  const before = await current(page);
  assert.ok(before >= 1, `publishing shows a later step (${before})`);

  // closed while it runs, then opened again: the same step, no new review, no second publish
  await page.evaluate(() => A.closeSheet());
  await page.waitForFunction(() => !document.querySelector('dialog.sheet[open]'));
  await page.click('#publish-open');
  await page.waitForSelector('dialog.sheet[open] .stepper[data-publish]');
  assert.equal(await current(page), before, 'reopened at the same step');
  assert.equal(await page.$('dialog.sheet[open] .changes'), null, 'not the review again');

  // it finishes while closed; reopened, it shows where the same job got to
  await page.evaluate(() => A.closeSheet());
  await page.evaluate(() => window.__release.apiPublish());
  await page.waitForFunction(() => A.publishState() && A.publishState().step >= 2, { timeout: 20000 });
  await page.click('#publish-open');
  await page.waitForSelector('dialog.sheet[open] .stepper[data-publish]');
  assert.ok(await current(page) >= 2 || await page.$('dialog.sheet[open] .note--ok'), 'the job moved on');
  assert.equal(await page.evaluate(() => window.__calls.apiPublish), 1, 'published once');
  assert.match(String(world.github.files()['content.json']), /نشر وهو مقفول/);
  assert.deepEqual(problems, []);
  await close();

});

test('an upload stays listed (name, progress, result) after leaving «الصور» and coming back', async () => {

  const { page, problems, close } = await open();

  await page.evaluate(() => { window.__hold.add('apiUploadMedia'); A.go('media'); });
  await page.waitForSelector('input[type="file"]');
  const file = `${ROOT}tools/.cache/fix-admin-upload.png`;
  const sharp = require('sharp');
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#d7aa50' } }).png().toFile(file);
  const input = await page.$('input[type="file"]');
  await input.uploadFile(file);
  await page.waitForFunction(() => window.__release.apiUploadMedia, { timeout: 20000 });

  // away and back while it is still sending
  await page.evaluate(() => A.go('settings'));
  await page.waitForSelector('.card .input');
  assert.equal(await page.evaluate(() => A.uploads.length), 1);
  await page.evaluate(() => A.go('media'));
  await page.waitForFunction(() => [...document.querySelectorAll('.uploads .uploads__name, .upload')].some(n => n.textContent.includes('fix-admin-upload')), { timeout: 10000 });

  // it ends: the same entry says so, and it was sent once
  await page.evaluate(() => window.__release.apiUploadMedia());
  await page.waitForFunction(() => A.uploads.length === 1 && A.uploads[0].stage === 'done', { timeout: 20000 });
  assert.equal(await page.evaluate(() => window.__calls.apiUploadMedia), 1, 'uploaded once');
  assert.ok(readFileSync(file).length > 0);
  assert.deepEqual(problems, []);
  await close();

});

test('scene content: a chat link takes words-only messages with who says them; a TikTok link keeps them but does not offer them', async () => {

  const { page, problems, close } = await open();

  const link = await page.evaluate(() => A.state.draft.links.find(l => l.icon === 'whatsapp' || l.experience === 'whatsapp'));
  assert.ok(link, 'a WhatsApp link in the seed');
  await page.evaluate(id => A.editLink(A.state.draft.links.find(l => l.id === id)), link.id);
  await page.waitForSelector('dialog.sheet[open] .gallery-picker');
  assert.match(await page.$eval('dialog.sheet[open] .gallery-picker .field__label', n => n.textContent), /محتوى المشهد/);

  // on screen as soon as the editor opens (no change of «التجربة» first), used like a person would
  const shown = handle => handle.evaluate(n => !n.hidden && !n.disabled && !!n.offsetParent && n.getBoundingClientRect().height > 0 && getComputedStyle(n).visibility === 'visible');
  const addButton = await page.evaluateHandle(() => [...document.querySelectorAll('dialog.sheet[open] .gallery-picker button')].find(b => b.textContent.includes('رسالة / منشور نصي')));
  assert.ok(await shown(addButton), '«+ رسالة / منشور نصي» visible right away');
  const froms = await page.$$('dialog.sheet[open] .gallery-picker__from');
  const rows = await page.$$('dialog.sheet[open] .gallery-picker__item');
  assert.equal(froms.length, rows.length, '«مين بيقول» on every item of a chat scene');
  for (const select of froms) assert.ok(await shown(select), '«مين بيقول» visible right away');
  const addText = async () => {
    await addButton.evaluate(b => b.scrollIntoView({ block: 'center' }));
    await addButton.click();
  };
  const item = async index => (await page.$$('dialog.sheet[open] .gallery-picker__item'))[index];
  const type = async (index, text) => {
    const area = await (await item(index)).$('.gallery-picker__say-input');
    assert.ok(await shown(area), 'the message box is visible');
    await area.click();
    await area.type(text);
  };
  const before = rows.length;
  await addText();
  await type(before, 'يا جماعة متنسوش اجتماع الأحد');
  await addText();
  await type(before + 1, 'مين جاي بدري؟');
  const who = await (await item(before + 1)).$('.gallery-picker__from');
  assert.ok(await shown(who), '«مين بيقول» visible on the new message');
  assert.equal(await who.evaluate(s => s.value), 'us', 'a new message: ours by default');
  await who.select('them');

  // an empty message blocks saving
  await addText();
  await page.evaluate(() => document.querySelector('dialog.sheet[open] .sheet__foot .btn--primary').click());
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(await page.evaluate(() => document.querySelector('dialog.sheet').open), true, 'not saved with an empty message');
  await page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .gallery-picker__item')].pop().querySelector('.gallery-picker__remove').click());

  await page.evaluate(() => document.querySelector('dialog.sheet[open] .sheet__foot .btn--primary').click());
  await page.waitForFunction(() => !document.querySelector('dialog.sheet').open, { timeout: 15000 });
  const saved = JSON.parse(world.gs.readTable_('Links').find(l => l.id === link.id).gallery);
  assert.deepEqual(saved.slice(-2), [{ text: 'يا جماعة متنسوش اجتماع الأحد', from: 'us' }, { text: 'مين جاي بدري؟', from: 'them' }]);

  // published in order, ready for the scene
  world.as(ADMIN);
  const built = JSON.parse(JSON.stringify(world.gs.buildDraft_()));
  world.as('');
  const published = [...built.content.featured, ...built.content.sections.flatMap(s => s.links)].find(l => l.id === link.id);
  assert.deepEqual(published.gallery.slice(-2), [{ type: 'text', text: 'يا جماعة متنسوش اجتماع الأحد', from: 'us' }, { type: 'text', text: 'مين جاي بدري؟', from: 'them' }]);

  // the same link opening TikTok: the messages stay (said plainly), no button to add more, no «مين بيقول»
  await page.evaluate(id => A.editLink(A.state.draft.links.find(l => l.id === id)), link.id);
  await page.waitForSelector('dialog.sheet[open] .gallery-picker');
  await page.evaluate(() => {
    const select = [...document.querySelectorAll('dialog.sheet[open] select')].find(s => [...s.options].some(o => o.value === 'tiktok'));
    select.value = 'tiktok';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const state = await page.evaluate(() => ({
    add: [...document.querySelectorAll('dialog.sheet[open] .gallery-picker button')].find(b => b.textContent.includes('رسالة / منشور نصي')).hidden,
    from: document.querySelectorAll('dialog.sheet[open] .gallery-picker__from').length,
    words: document.querySelectorAll('dialog.sheet[open] .gallery-picker__item[data-kind=text]').length,
    note: document.querySelector('dialog.sheet[open] .gallery-picker__item[data-kind=text] .gallery-picker__msg')?.textContent || ''
  }));
  assert.deepEqual([state.add, state.from, state.words], [true, 0, 2]);
  assert.match(state.note, /مبيعرضش/);
  assert.deepEqual(problems, []);
  await close();

});

test('help «؟»: the screen\'s own topic from admin/help.json, on top of an open editor without touching it (desktop + phone)', async () => {

  const shown = handle => handle.evaluate(n => !n.hidden && !!n.offsetParent && n.getBoundingClientRect().height > 0 && getComputedStyle(n).visibility === 'visible');
  const press = async handle => { await handle.evaluate(n => n.scrollIntoView({ block: 'center' })); await handle.click(); };

  for (const viewport of [{ width: 1366, height: 900 }, { width: 412, height: 915, isMobile: true, hasTouch: true }]) {
    const { page, problems, close } = await open(viewport);
    for (const [area, sub, title] of [['home', null, 'الرئيسية'], ['content', 'news', 'الأخبار'], ['content', 'meetings', 'الاجتماعات'], ['page', 'links', 'الروابط'], ['media', null, 'الصور'], ['settings', null, 'الإعدادات']]) {
      await page.evaluate((a, s) => A.go(a, s || undefined), area, sub);
      await new Promise(resolve => setTimeout(resolve, 300));
      const button = await page.$('#help-open');
      assert.ok(await shown(button), `«؟» visible on ${area}/${sub || ''} (${viewport.width})`);
      await press(button);
      await page.waitForSelector('dialog.help[open] .help__title');
      assert.equal(await page.$eval('dialog.help[open] .help__title', n => n.textContent), title);
      assert.ok(await page.$$eval('dialog.help[open] .help__item', n => n.length) >= 2);
      // another topic from the list, then closed with its own button
      await press(await page.$('dialog.help[open] .help__chips button'));
      await page.waitForFunction(t => document.querySelector('dialog.help[open] .help__title')?.textContent !== t, {}, title);
      await press(await page.$('dialog.help[open] .help__head .icon-btn'));
      await page.waitForFunction(() => !document.querySelector('dialog.help[open]'));
    }

    // the editor's «؟»: over the news editor, which keeps what was typed
    await page.evaluate(() => A.go('content', 'news'));
    await new Promise(resolve => setTimeout(resolve, 300));
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.trim() === '+ خبر')));
    await page.waitForSelector('dialog.sheet[open] .help-btn');
    await new Promise(resolve => setTimeout(resolve, 500));
    const field = await page.evaluateHandle(() => [...document.querySelectorAll('dialog.sheet[open] input, dialog.sheet[open] textarea')].find(n => n.offsetParent));
    await press(field);
    await page.keyboard.type('خبر تجربة');
    const help = await page.$('dialog.sheet[open] .help-btn');
    assert.ok(await shown(help), 'the editor\'s «؟» visible');
    await press(help);
    await page.waitForSelector('dialog.help[open] .help__title');
    assert.equal(await page.$eval('dialog.help[open] .help__title', n => n.textContent), 'الأخبار');
    await page.screenshot({ path: `${ROOT}tools/.cache/help-${viewport.width}.png` });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.help[open]'));
    assert.equal(await page.evaluate(() => !!document.querySelector('dialog.sheet[open]')), true, 'the editor stays open');
    assert.equal(await field.evaluate(n => n.value), 'خبر تجربة', 'what was typed is still there');
    assert.deepEqual(problems, []);
    await close();
  }

});


test('news editor: the «مميز» / «مثبت» switches, alone and together, never scroll the editor away (real clicks, desktop + phone)', async () => {

  for (const viewport of [{ width: 1366, height: 900 }, { width: 412, height: 915, isMobile: true, hasTouch: true }]) {
    const { page, problems, close } = await open(viewport);
    await page.evaluate(() => A.go('content', 'news'));
    await new Promise(resolve => setTimeout(resolve, 300));
    const add = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.trim() === '+ خبر'));
    await add.evaluate(n => n.scrollIntoView({ block: 'center' }));
    await add.click();
    await page.waitForSelector('dialog.sheet[open] .switch');
    await new Promise(resolve => setTimeout(resolve, 500));
    const title = await page.evaluateHandle(() => [...document.querySelectorAll('dialog.sheet[open] input, dialog.sheet[open] textarea')].find(n => n.offsetParent));
    await title.click();
    await page.keyboard.type('خبر مهم');

    const whole = () => page.evaluate(() => {
      const d = document.querySelector('dialog.sheet[open]');
      const head = d.querySelector('#sheet-title').getBoundingClientRect();
      const save = [...d.querySelectorAll('.sheet__foot button')].find(b => b.offsetParent).getBoundingClientRect();
      const hit = document.elementFromPoint(save.left + save.width / 2, save.top + save.height / 2);
      return { shell: d.scrollTop, head: head.top >= 0 && head.bottom <= innerHeight, save: !!hit && !!hit.closest('.sheet__foot'), body: d.querySelector('.sheet__body').innerText.trim().length > 50 };
    });
    for (const label of ['مميز', 'مثبت', 'مميز', 'مثبت', 'مثبت', 'مميز']) {
      const sw = await page.evaluateHandle(l => [...document.querySelectorAll('dialog.sheet[open] .switch')].find(s => s.textContent.includes(l)), label);
      await sw.evaluate(n => n.scrollIntoView({ block: 'center' }));
      await sw.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      assert.deepEqual(await whole(), { shell: 0, head: true, save: true, body: true }, `after «${label}» (${viewport.width})`);
    }
    assert.equal(await title.evaluate(n => n.value), 'خبر مهم');
    assert.deepEqual(problems, []);
    await close();
  }

});

test('competition «شكل العرض»: auto says what it chose, the site\'s own card previewed (desktop / phone), a phone override, saved and published', async () => {

  const { page, problems, close } = await open();
  const press = async handle => { await handle.evaluate(n => n.scrollIntoView({ block: 'center' })); await handle.click(); };
  const shown = handle => handle.evaluate(n => !n.hidden && !!n.offsetParent && n.getBoundingClientRect().height > 0);

  await page.evaluate(() => A.go('content', 'competitions'));
  await new Promise(resolve => setTimeout(resolve, 300));
  await press(await page.evaluateHandle(() => [...document.querySelectorAll('.app__main button')].find(b => b.offsetParent && b.textContent.trim() === 'مسابقة جديدة')));
  await page.waitForSelector('dialog.sheet[open] .item-display');
  const title = await page.evaluateHandle(() => [...document.querySelectorAll('dialog.sheet[open] input')].find(n => n.offsetParent));
  await press(title);
  await page.keyboard.type('مسابقة الكتاب');

  // no picture: auto picks the compact card, and says so; the preview is the site's card
  await page.waitForFunction(() => /التلقائي اختار: كارت مدمج/.test(document.querySelector('dialog.sheet[open] .item-preview__auto')?.textContent || ''), { timeout: 15000 });
  const card = () => page.evaluate(() => {
    const frame = document.querySelector('dialog.sheet[open] .item-preview__frame');
    const node = frame.contentDocument.querySelector('.item-card');
    const stage = frame.parentNode.getBoundingClientRect();
    return node ? { cls: [...node.classList].find(k => k.startsWith('is-')), title: node.querySelector('.item-card__title').textContent, width: frame.offsetWidth, stage: Math.round(stage.height) } : null;
  });
  await page.waitForFunction(() => document.querySelector('dialog.sheet[open] .item-preview__frame')?.contentDocument?.querySelector('.item-card__title')?.textContent === 'مسابقة الكتاب', { timeout: 15000 });
  let now = await card();
  assert.equal(now.cls, 'is-compact');
  assert.equal(now.width, 1100, 'desktop width');
  assert.ok(now.stage > 60, 'the preview shows');
  assert.ok(await shown(await page.$('dialog.sheet[open] .item-preview__stage')));

  // «بانر عريض» by a real click: the preview follows
  await press(await page.evaluateHandle(() => [...document.querySelectorAll('dialog.sheet[open] .item-display label.choice')].find(l => l.textContent.includes('بانر عريض'))));
  await page.waitForFunction(() => document.querySelector('dialog.sheet[open] .item-preview__frame').contentDocument.querySelector('.item-card.is-banner'), { timeout: 10000 });
  assert.match(await page.$eval('dialog.sheet[open] .item-preview__auto', n => n.textContent), /سطح المكتب: بانر عريض — الموبايل: بانر عريض/);

  // the phone: «كارت مدمج» there only
  const mobile = await page.evaluateHandle(() => [...document.querySelectorAll('dialog.sheet[open] .item-display select')][0]);
  assert.ok(await shown(mobile));
  await mobile.select('compact');
  await press(await page.evaluateHandle(() => [...document.querySelectorAll('dialog.sheet[open] .item-preview__tabs button')].find(b => b.textContent === 'الموبايل')));
  await page.waitForFunction(() => document.querySelector('dialog.sheet[open] .item-preview__frame').offsetWidth === 400, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('dialog.sheet[open] .item-preview__frame').contentDocument.querySelector('.item-card.is-compact'), { timeout: 10000 });
  await page.screenshot({ path: `${ROOT}tools/.cache/display-preview.png` });

  await press(await page.$('dialog.sheet[open] .sheet__foot .btn--primary'));
  await page.waitForFunction(() => !document.querySelector('dialog.sheet').open, { timeout: 15000 });
  const saved = world.gs.readTable_('Activities').find(a => a.title === 'مسابقة الكتاب');
  assert.deepEqual([saved.display, saved.displayMobile], ['banner', 'compact'], 'stored (the columns came by themselves)');
  world.as(ADMIN);
  const built = JSON.parse(JSON.stringify(world.gs.buildDraft_()));
  world.as('');
  const published = built.content.activities.find(a => a.title === 'مسابقة الكتاب');
  assert.deepEqual([published.display, published.displayMobile], ['banner', 'compact']);
  assert.deepEqual(problems, []);
  await close();

});

test('«شكل العرض» is one shared control: news (its «مميز» card) and games preview the site\'s own card, and save their choice', async () => {

  const { page, problems, close } = await open();
  const press = async handle => { await handle.evaluate(n => n.scrollIntoView({ block: 'center' })); await handle.click(); };
  const frameCard = selector => page.waitForFunction(s => document.querySelector('dialog.sheet[open] .item-preview__frame')?.contentDocument?.querySelector(s), { timeout: 15000 }, selector);
  const choose = label => page.evaluateHandle(l => [...document.querySelectorAll('dialog.sheet[open] .item-display label.choice')].find(c => c.textContent.includes(l)), label);

  for (const [sub, add, label, card, field, table] of [
    ['news', '+ خبر', 'شكل عرض الخبر', '.news-lead.lay', 'خبر الشكل', 'News'],
    ['games', '+ لعبة', 'شكل عرض اللعبة', '.game.lay', 'لعبة الشكل', 'Games']
  ]) {
    await page.evaluate(s => A.go('content', s), sub);
    await new Promise(resolve => setTimeout(resolve, 300));
    await press(await page.evaluateHandle(t => [...document.querySelectorAll('.app__main button')].find(b => b.offsetParent && b.textContent.trim() === t), add));
    await page.waitForSelector('dialog.sheet[open] .item-display');
    assert.equal(await page.$eval('dialog.sheet[open] .item-display .section-label', n => n.textContent), label);
    const input = await page.evaluateHandle(() => [...document.querySelectorAll('dialog.sheet[open] input')].find(n => n.offsetParent));
    await press(input);
    await page.keyboard.type(field);
    if (sub === 'games') {
      const link = await page.evaluateHandle(() => [...document.querySelectorAll('dialog.sheet[open] input[type=url]')].find(n => n.offsetParent));
      await press(link);
      await page.keyboard.type('https://example.org/game');
      // its times: the editor's own preset buttons
      for (const name of ['تبدأ', 'تخلص']) {
        await press(await page.evaluateHandle(n => [...document.querySelectorAll('dialog.sheet[open] .field')].find(f => f.dataset.label === n).querySelector('button.chip, .presets button, button'), name));
      }
    }
    await frameCard(card);
    assert.match(await page.$eval('dialog.sheet[open] .item-preview__auto', n => n.textContent), /التلقائي اختار: /);
    if (sub === 'news') assert.match(await page.$eval('dialog.sheet[open] .item-preview__note:not([hidden])', n => n.textContent), /المميز/);
    await press(await choose('كارت مدمج'));
    await frameCard(`${card}.is-compact`);
    await press(await page.$('dialog.sheet[open] .sheet__foot .btn--primary'));
    await page.waitForFunction(() => !document.querySelector('dialog.sheet').open, { timeout: 15000 }).catch(async error => { throw new Error(sub + ': ' + await page.evaluate(() => document.querySelector('dialog.sheet[open]')?.innerText.slice(0, 300))); });
    const row = world.gs.readTable_(table).find(r => r.title === field);
    assert.equal(row.display, 'compact', `${table}: stored`);
  }
  world.as(ADMIN);
  const built = JSON.parse(JSON.stringify(world.gs.buildDraft_()));
  world.as('');
  assert.equal(built.content.news.find(n => n.title === 'خبر الشكل').display, 'compact');
  assert.deepEqual(problems, []);
  await close();

});
