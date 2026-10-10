// Admin QA crawler: every screen, tab, add / edit editor, switch, choice, select,
// ↑ / ↓ and delete → cancel, with REAL clicks at desktop and phone width; checks
// the editor stays whole (no scrolled shell, title and footer visible and
// clickable, no blank body, nothing sideways), typed values survive, no errors.
// Needs the local admin: node admin-preview.mjs 4322   Then: node qa-admin.mjs [desktop|phone]
// Prints only problems (and what it visited).
import { createRequire } from 'node:module';
import { ROOT } from './lib/gs.mjs';
const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const VIEWS = { desktop: { width: 1366, height: 900 }, phone: { width: 412, height: 915, isMobile: true, hasTouch: true } };
const ONLY = process.argv[2] || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
// like a person: bring it to the middle of the screen (clear of the phones' dock), then click
const press = async h => { await h.evaluate(n => n.scrollIntoView({ block: 'center' })); await h.click(); };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const issues = [];
const visited = [];
let checked = 0;

for (const [vname, viewport] of Object.entries(VIEWS)) {
  if (ONLY && ONLY !== vname) continue;
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.setViewport(viewport);
  await page.goto('http://127.0.0.1:4322/', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.A && A.state, { timeout: 20000 });
  const bad = (where, what) => issues.push(`[${vname}] ${where}: ${what}`);
  const flushErrors = where => { while (errors.length) bad(where, `error ${errors.shift().slice(0, 140)}`); };

  // a real click on the first visible element matching fn(text, node)
  const clickWhere = async (scope, test) => {
    for (let i = 0; i < 4; i++) {
      const handle = await page.evaluateHandle((s, t) => {
        const ok = new Function('text', 'node', `return (${t})(text, node)`);
        return [...document.querySelectorAll(s)].find(n => n.offsetParent && n.getBoundingClientRect().height > 0 && ok(n.textContent.trim(), n)) || null;
      }, scope, test.toString());
      if (!(await handle.evaluate(n => !!n))) return false;
      try { await handle.click(); return true; } catch { await sleep(300); }
    }
    return false;
  };

  const tabsNow = () => page.evaluate(() => [...document.querySelectorAll('nav.tabs button.tab')].map(n => n.textContent.trim()).join(',') + ' @' + location.hash + ' main:' + ((document.querySelector('.app__main h1, .app__main h2') || {}).textContent || '').trim().slice(0, 20));
  const pageCheck = async where => {
    if (process.env.TRACE) console.log('TRACE', where, await tabsNow());
    const s = await page.evaluate(() => ({
      over: document.scrollingElement.scrollWidth - innerWidth,
      main: (document.querySelector('main, #main, .main') || document.body).innerText.trim().length
    }));
    if (s.over > 1) bad(where, `page overflows sideways by ${s.over}px`);
    if (s.main < 20) bad(where, 'empty main');
    flushErrors(where);
  };

  const sheetCheck = async where => {
    checked += 1;
    const s = await page.evaluate(() => {
      const d = document.querySelector('dialog.sheet[open]');
      if (!d) return null;
      const title = d.querySelector('#sheet-title') || d.querySelector('h2');
      const body = d.querySelector('.sheet__body');
      const foot = d.querySelector('.sheet__foot');
      const primary = foot && [...foot.querySelectorAll('button')].find(b => b.offsetParent);
      const hit = el => { if (!el) return null; const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (top === el || el.contains(top)); };
      const tr = title && title.getBoundingClientRect();
      return {
        shellScroll: d.scrollTop + d.scrollLeft,
        titleShown: !!tr && tr.top >= 0 && tr.bottom <= innerHeight,
        body: body ? body.scrollHeight : 0,
        bodyText: body ? body.innerText.trim().length : 0,
        sideways: body ? body.scrollWidth - body.clientWidth : 0,
        footHit: primary ? hit(primary) : 'none',
        inView: (() => { const r = d.getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1 && r.height > 80; })()
      };
    });
    if (!s) { bad(where, 'sheet not open'); return false; }
    if (s.shellScroll) bad(where, `sheet shell scrolled (${s.shellScroll})`);
    if (!s.titleShown) bad(where, 'sheet title off screen');
    if (s.body < 60 || s.bodyText < 5) bad(where, 'blank sheet body');
    if (s.sideways > 1) bad(where, `sheet body overflows sideways ${s.sideways}px`);
    if (s.footHit === false) bad(where, 'footer button covered / not clickable');
    if (!s.inView) bad(where, 'sheet outside viewport');
    flushErrors(where);
    return true;
  };

  // every visible switch / checkbox / select in the open sheet, with real input; text values must survive
  const exercise = async where => {
    const values = () => page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] input[type=text], dialog.sheet[open] input:not([type]), dialog.sheet[open] textarea')].map(n => n.value).join('|'));
    const typed = await page.evaluateHandle(() => [...document.querySelectorAll('dialog.sheet[open] input[type=text], dialog.sheet[open] input:not([type]), dialog.sheet[open] textarea')].find(n => n.offsetParent && !n.readOnly && !n.disabled) || null);
    if (await typed.evaluate(n => !!n)) {
      try { await typed.click(); await page.keyboard.type('ق'); } catch { bad(where, 'first text field not clickable'); }
    }
    const before = await values();
    const n = await page.evaluate(() => document.querySelectorAll('dialog.sheet[open] label.switch, dialog.sheet[open] label.check, dialog.sheet[open] label.choice, dialog.sheet[open] label.swatch').length);
    for (let i = 0; i < n; i++) {
      const h = await page.evaluateHandle(k => [...document.querySelectorAll('dialog.sheet[open] label.switch, dialog.sheet[open] label.check, dialog.sheet[open] label.choice, dialog.sheet[open] label.swatch')][k] || null, i);
      if (!(await h.evaluate(x => !!x && !!x.offsetParent))) continue;
      const label = (await h.evaluate(x => x.textContent.trim().slice(0, 26)));
      try { await press(h); } catch { bad(where, `«${label}» not clickable`); continue; }
      await sleep(250);
      await sheetCheck(`${where} › «${label}»`);
    }
    const selects = await page.$$('dialog.sheet[open] select');
    for (const sel of selects) {
      const info = await sel.evaluate(s => ({ shown: !!s.offsetParent, opts: [...s.options].map(o => o.value), now: s.value, label: s.getAttribute('aria-label') || '' }));
      if (!info.shown || info.opts.length < 2) continue;
      const other = info.opts.find(v => v !== info.now);
      await sel.select(other);
      await sleep(250);
      await sheetCheck(`${where} › select ${info.label.slice(0, 20)}=${other}`);
      await sel.select(info.now);
    }
    const after = await values();
    if (before !== after) bad(where, 'typed / existing text changed by toggles or selects');
  };

  const closeSheet = async where => {
    const closed = await clickWhere('dialog.sheet[open] .sheet__close, dialog.sheet[open] [aria-label="قفل"], dialog.sheet[open] .icon-btn[aria-label*="قفل"]', () => true);
    if (!closed) { bad(where, 'no visible close button'); await page.evaluate(() => A.closeSheet && A.closeSheet()); }
    await sleep(350);
    // a «discard changes?» question
    for (let k = 0; k < 2; k++) {
      const asked = await clickWhere('dialog[open] button', t => /تجاهل|من غير حفظ|اقفل من غير|أيوه|تجاهل التعديلات|خروج/.test(t));
      if (!asked) break;
      await sleep(300);
    }
    if (await page.evaluate(() => !!document.querySelector('dialog.sheet[open]'))) { bad(where, 'sheet did not close'); await page.evaluate(() => { A.dirty = false; A.closeSheet(); }); await sleep(300); }
    flushErrors(where);
  };

  const navs = await page.evaluate(() => [...new Set([...document.querySelectorAll('nav:not(.tabs) a, nav:not(.tabs) button')].filter(n => n.offsetParent).map(n => n.textContent.trim()).filter(Boolean))]);
  for (const nav of navs) {
    const navHandle = await page.evaluateHandle(t => [...document.querySelectorAll('nav:not(.tabs) a, nav:not(.tabs) button')].find(x => x.offsetParent && x.textContent.trim() === t), nav);
    try { await navHandle.click(); } catch { bad(`«${nav}»`, 'nav item not clickable'); continue; }
    await sleep(600);
    await pageCheck(`«${nav}»`);
    // its tabs (sub-sections), each in turn
    const tabs = await page.evaluate(() => [...document.querySelectorAll('nav.tabs button.tab, main [role=tab]')].filter(n => n.offsetParent).map(n => n.textContent.trim()));
    for (const tab of (tabs.length ? tabs : [''])) {
      if (tab) {
        const h = await page.evaluateHandle(t => [...document.querySelectorAll('nav.tabs button.tab, main [role=tab]')].find(n => n.offsetParent && n.textContent.trim() === t), tab);
        try { await h.click(); } catch (e) { const cover = await page.evaluate(t => { const b = [...document.querySelectorAll('nav.tabs button.tab')].find(n => n.textContent.trim() === t); if (!b) return 'gone'; const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return `rect ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} covered by ${top ? top.tagName + '.' + top.className + ' «' + top.textContent.trim().slice(0, 30) + '»' : 'none'} conn=${b.isConnected}`; }, tab); bad(`«${nav}» › ${tab}`, 'tab not clickable: ' + e.message.slice(0, 50) + ' | ' + cover); }
        await sleep(500);
        await pageCheck(`«${nav}» › ${tab}`);
      }
      const where = `«${nav}»${tab ? ` › ${tab}` : ''}`;
      // inline controls (no sheet): each one with a real click, the page still whole
      if (/الإعدادات|المكان/.test(where)) {
        const count = await page.evaluate(() => document.querySelectorAll('.app__main label.switch, .app__main label.check, .app__main label.choice, .app__main label.swatch').length);
        for (let i = 0; i < Math.min(count, 14); i++) {
          const h = await page.evaluateHandle(k => [...document.querySelectorAll('.app__main label.switch, .app__main label.check, .app__main label.choice, .app__main label.swatch')][k] || null, i);
          if (!(await h.evaluate(x => !!x && !!x.offsetParent))) continue;
          const name = await h.evaluate(x => x.textContent.trim().slice(0, 22));
          try { await press(h); } catch { bad(where, `«${name}» not clickable`); continue; }
          await sleep(250);
          await pageCheck(`${where} › «${name}»`);
          if (await page.evaluate(() => !!document.querySelector('dialog.sheet[open]'))) await closeSheet(`${where} › «${name}»`);
        }
        visited.push('INLINE ' + where + ' ' + count);
      }
      visited.push('VIEW ' + where);
      // add buttons (+ …) then the first edit button: open, exercise, close, reopen
      const openers = await page.evaluate(() => {
        const visible = [...document.querySelectorAll('main button, .app__main button')].filter(b => b.offsetParent && b.getBoundingClientRect().height > 0 && !b.disabled);
        const add = visible.filter(b => /^\+|^＋|زوّد|إضافة|جديد|استيراد/.test(b.textContent.trim())).map(b => b.textContent.trim());
        const edit = visible.filter(b => /تعديل|عدّل/.test(b.textContent.trim() + (b.getAttribute('aria-label') || ''))).map(b => b.textContent.trim() || b.getAttribute('aria-label'));
        const pick = [...edit.filter(t => /واتساب|فيسبوك/.test(t)), ...edit].slice(0, 4);
        return [...new Set([...add, ...pick])].slice(0, 7);
      });
      // reorder: ↓ then ↑ on the first row, the list the same after
      const order = () => page.evaluate(() => [...document.querySelectorAll('.app__main [aria-label^="تعديل "]')].map(b => b.getAttribute('aria-label')).join('|'));
      const down = await page.evaluateHandle(() => [...document.querySelectorAll('.app__main button')].find(b => b.offsetParent && /^لتحت/.test(b.getAttribute('aria-label') || '') && !b.disabled) || null);
      if (await down.evaluate(x => !!x)) {
        const was = await order();
        try { await press(down); await sleep(500); const moved = await order(); if (moved === was) bad(where, '↓ changed nothing'); const up = await page.evaluateHandle(() => [...document.querySelectorAll('.app__main button')].filter(b => b.offsetParent && /^لفوق/.test(b.getAttribute('aria-label') || '') && !b.disabled)); const ups = await up.evaluate(l => l.length); await page.evaluate(() => { const l = [...document.querySelectorAll('.app__main button')].filter(b => b.offsetParent && /^لفوق/.test(b.getAttribute('aria-label') || '') && !b.disabled); l[0] && l[0].scrollIntoView({ block: 'center' }); });
          const second = await page.evaluateHandle(() => [...document.querySelectorAll('.app__main button')].filter(b => b.offsetParent && /^لفوق/.test(b.getAttribute('aria-label') || '') && !b.disabled)[0] || null);
          if (ups && await second.evaluate(x => !!x)) { await press(second); await sleep(500); }
          await pageCheck(where + ' › reorder'); } catch (e) { bad(where, 'reorder buttons not clickable ' + e.message.slice(0, 60)); }
      }
      // delete: asks first; cancel keeps it
      const del = await page.evaluateHandle(() => [...document.querySelectorAll('.app__main button')].find(b => b.offsetParent && /^مسح/.test(b.getAttribute('aria-label') || b.textContent.trim())) || null);
      if (await del.evaluate(x => !!x)) {
        const was = await order();
        try { await press(del); await sleep(500); const asked = await page.evaluate(() => !!document.querySelector('dialog[open]')); if (!asked) bad(where, 'delete did not ask first'); else { const cancel = await clickWhere('dialog[open] button', t => /إلغاء|لأ|رجوع|خليه/.test(t)); if (!cancel) bad(where, 'delete question has no visible cancel'); await sleep(400); } if ((await order()) !== was) bad(where, 'cancelled delete still removed something'); } catch (e) { bad(where, 'delete not clickable'); }
        flushErrors(where);
      }
      for (const opener of openers) {
        const label = `${where} › ${opener.slice(0, 24)}`;
        const ok = await page.evaluate(t => { const b = [...document.querySelectorAll('main button, .app__main button')].find(x => x.offsetParent && (x.textContent.trim() === t || x.getAttribute('aria-label') === t)); if (!b) return false; b.scrollIntoView({ block: 'center' }); return true; }, opener);
        if (!ok) continue;
        const h = await page.evaluateHandle(t => [...document.querySelectorAll('main button, .app__main button')].find(x => x.offsetParent && (x.textContent.trim() === t || x.getAttribute('aria-label') === t)), opener);
        try { await h.click(); } catch { bad(label, 'opener not clickable'); continue; }
        await sleep(700);
        if (!(await page.evaluate(() => !!document.querySelector('dialog.sheet[open]')))) {
          // a library / file picker, or a menu: close anything open and move on
          await page.keyboard.press('Escape');
          await sleep(300);
          flushErrors(label);
          continue;
        }
        visited.push(label);
        if (!(await sheetCheck(`${label} (open)`))) continue;
        await exercise(label);
        await closeSheet(label);
        // reopen: still whole
        try { const again = await page.evaluateHandle(t => [...document.querySelectorAll('main button, .app__main button')].find(x => x.offsetParent && (x.textContent.trim() === t || x.getAttribute('aria-label') === t)), opener); await again.click(); await sleep(600); if (await page.evaluate(() => !!document.querySelector('dialog.sheet[open]'))) { await sheetCheck(`${label} (reopened)`); await closeSheet(`${label} (reopened)`); } } catch { bad(label, 'reopen failed'); }
      }
    }
  }

  // the publish review
  if (await clickWhere('#publish-open', () => true)) {
    await sleep(1500);
    await sheetCheck('publish review');
    await closeSheet('publish review');
  }
  else bad('publish', '#publish-open not visible / clickable');
  await page.close();
}
await browser.close();
console.log(visited.join(String.fromCharCode(10)));
console.log(`sheets checked: ${checked}`);
console.log(issues.length ? [...new Set(issues)].join('\n') : 'no issues');
