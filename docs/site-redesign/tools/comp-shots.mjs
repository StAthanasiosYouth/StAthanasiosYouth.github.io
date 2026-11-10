// S4: every state of the LIVE competition engine (preview mode, sample competition), today (layer=0) and redesigned.
//   node docs/site-redesign/tools/comp-shots.mjs [now|new|both]     (static server on :4330)
// Output: shots/changes/<phone|desktop>/<now|new>-comp-<step>.png  (whole page height of the engine)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const OUT = 'D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/docs/site-redesign/shots/changes';
const WHICH = process.argv[2] || 'both';
const V = { phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, desktop: { width: 1440, height: 900, deviceScaleFactor: 1 } };
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const log = [];
for (const [w, vp] of Object.entries(V)) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  for (const mode of (WHICH === 'both' ? ['now', 'new'] : [WHICH])) {
    const p = await b.newPage(); await p.setViewport(vp);
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const fr = () => p.frames().find(f => f.url().includes('/competition/'));
    async function open(state) {
      await p.goto(`http://127.0.0.1:4330/docs/site-redesign/comp-final.html?still=1&state=${state}${mode === 'now' ? '&layer=0' : ''}`, { waitUntil: 'networkidle0' });
      await p.waitForFunction(() => document.documentElement.dataset.step, { timeout: 15000 }); await wait(900);
    }
    async function shot(name) {
      await fr().evaluate(() => document.fonts.ready); await wait(500);
      const h = await fr().evaluate(() => Math.max(document.documentElement.scrollHeight, innerHeight));
      await p.evaluate(h => { const f = document.getElementById('engine'); f.style.height = h + 'px'; document.body.style.height = 'auto'; document.documentElement.style.height = 'auto'; }, h);
      await wait(400);
      await p.screenshot({ path: `${OUT}/${w}/${mode}-comp-${name}.png`, fullPage: true });
      await p.evaluate(() => { const f = document.getElementById('engine'); f.style.height = ''; document.body.style.height = ''; document.documentElement.style.height = ''; });
      await wait(200);
    }
    const click = t => fr().evaluate(t => { const n = [...document.querySelectorAll('button, a')].find(x => x.offsetParent && x.innerText.trim().includes(t)); if (n) n.click(); return !!n; }, t);
    const pick = t => fr().evaluate(t => { const n = [...document.querySelectorAll('label')].find(x => x.offsetParent && x.innerText.trim().includes(t)); if (n) n.click(); return !!n; }, t);
    const type = v => fr().evaluate(v => { const n = [...document.querySelectorAll('input:not([type=radio]):not([type=checkbox]), textarea')].find(x => x.offsetParent); if (!n) return false; n.focus(); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); return true; }, v);

    await open('scheduled'); await shot('scheduled');
    await open('closed'); await shot('closed');
    await open('open'); await shot('intro');
    await click('ابدأ'); await wait(1300);
    await pick('متياس'); await wait(300); await shot('q-single');
    await click('التالي'); await wait(700); await pick('صح'); await wait(300); await shot('q-truefalse');
    await click('التالي'); await wait(700); await pick('إسطفانوس'); await pick('فيلبس'); await wait(300); await shot('q-multi');
    await click('التالي'); await wait(700); await type('٣٠٠٠'); await wait(300); await shot('q-number');
    await click('التالي'); await wait(700);
    await click('التالي'); await wait(700); await type('«لأنكم ستنالون قوة متى حل الروح القدس عليكم»'); await shot('q-long');
    if (!(await click('راجع'))) await click('التالي'); await wait(900); await shot('review');
    const btns = await fr().evaluate(() => [...document.querySelectorAll('button')].filter(n => n.offsetParent).map(n => n.innerText.trim()).filter(Boolean));
    const send = btns.find(t => /ابعت|سلّم|سلم|إرسال|خلّصت|خلصت/.test(t));
    if (send) await click(send);
    await wait(500); await shot('confirm'); await click('أيوه'); await wait(300); await shot('submitting');
    await p.waitForFunction(() => document.documentElement.dataset.step || true); await wait(2200); await shot('result');
    log.push(`${w} ${mode} errors ${errs.length} ${errs.slice(0, 2).join(' | ')} · review buttons: ${btns.join(' / ')}`);
    await p.close();
  }
}
await b.close();
console.log(log.join('\n'));
// the list page (new)
{
  const b2 = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const [w, vp] of Object.entries(V)) {
    const p = await b2.newPage(); await p.setViewport(vp);
    await p.goto('http://127.0.0.1:4330/docs/site-redesign/comp-list.html', { waitUntil: 'networkidle0' }); await p.evaluate(() => document.fonts.ready); await wait(500);
    await p.screenshot({ path: `${OUT}/${w}/new-comp-list.png`, fullPage: true }); await p.close();
  }
  await b2.close();
}
