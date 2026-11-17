// Renders the two intro sound samples (w1/sound.js) offline in Chrome, then encodes them with the local ffmpeg:
//   sound/intro-a.m4a + .opus (+ .wav master), sound/intro-b.*   — AAC for iPhone/Safari, Opus for the rest.
// Needs docs/daily-bread/tools/static.mjs on 4340.  Usage: node docs/daily-bread/w1/tools/render-sound.mjs
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const OUT = join(HERE, '..', 'sound');
mkdirSync(OUT, { recursive: true });
const MOD = [join(ROOT, 'tools'), 'D:/private_projects/athanasios-links/tools'].find(d => existsSync(join(d, 'node_modules', 'puppeteer-core')));
const puppeteer = createRequire(join(MOD, 'package.json'))('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:4340/docs/daily-bread/w1/tools/blank.html');
for (const which of ['a', 'b']) {
  const bytes = await page.evaluate(async which => {
    const m = await import('/docs/daily-bread/w1/sound.js');
    const ctx = new OfflineAudioContext(2, Math.ceil(48000 * m.LENGTH), 48000);
    m.schedule(ctx, which, 0.02);
    const buf = await ctx.startRendering();
    // normalise to -1 dBFS peak
    let peak = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) for (const s of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(s));
    const k = 0.89 / (peak || 1);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
    return Array.from(m.wav(buf));
  }, which);
  const wavPath = join(OUT, `intro-${which}.wav`);
  writeFileSync(wavPath, Buffer.from(bytes));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-af', 'afade=t=out:st=3.3:d=0.5', '-c:a', 'libopus', '-b:a', '64k', join(OUT, `intro-${which}.opus`)]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-af', 'afade=t=out:st=3.3:d=0.5', '-c:a', 'aac', '-b:a', '96k', join(OUT, `intro-${which}.m4a`)]);
  console.log(which, ['wav', 'opus', 'm4a'].map(x => x + ' ' + Math.round(statSync(join(OUT, `intro-${which}.${x}`)).size / 1024) + ' KB').join(' · '));
}
await browser.close();
