import { createRequire } from 'node:module';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
for (const s of (process.argv[2] || 'home,editor,publish,publish-changes,publish-history,comp-new,youth,servants,paymethods,bookings,finance,settings,team,team-remove,servant-remove,events,event-menu,event-delete,media,media-select,media-item,media-trash,activity,activity-item,activity-manage,youth-list,me-avatar,comps,comp-work,team-add,team-perms,team-confirm,team-enforce,denied').split(',')) {
  await p.goto('http://127.0.0.1:4330/docs/phase8b/?still=1&s=' + s, { waitUntil: 'networkidle0' });
  const r = await p.evaluate(() => { const W = innerWidth; const bad = [...document.querySelectorAll('body *')].filter(n => { const b = n.getBoundingClientRect(); return b.width && (b.right > W + 1 || b.left < -1) && !n.closest('.seg,.tabs,.mnav,.setnav,.tablewrap,.intro'); }).slice(0, 3).map(n => n.className + ':' + Math.round(n.getBoundingClientRect().right)); return { sw: document.documentElement.scrollWidth, bad }; });
  if (r.bad.length) console.log(s, JSON.stringify(r));
}
await b.close();
