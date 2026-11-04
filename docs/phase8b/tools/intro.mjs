import { createRequire } from 'node:module';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const [w, vp] of Object.entries({ desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } })) {
  const p = await b.newPage(); await p.setViewport(vp);
  for (const t of [250, 700, 1100, 1800]) {
    await p.goto(`http://127.0.0.1:4330/docs/phase8b/?s=intro&freeze=${t}`, { waitUntil: 'networkidle0' });
    await p.evaluate(() => document.fonts.ready); await new Promise(r => setTimeout(r, 250));
    await p.screenshot({ path: `shots/${w}/intro-${t}.png` });
  }
  // the exit: logo flies to the rail / top bar
  await p.goto(`http://127.0.0.1:4330/docs/phase8b/?s=intro`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2050));
  await p.screenshot({ path: `shots/${w}/intro-exit.png` });
  await p.close();
}
await b.close(); console.log('intro frames ok');
