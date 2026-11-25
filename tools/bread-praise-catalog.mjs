#!/usr/bin/env node
/*
 * «خبزنا اليومي» — the praises (التماجيد) on St-Takla.org, as a catalog to choose from (owner 2026-11-25: «التمجيد
 * المعروف … هتدور انتا ونا هراجع»). Reads St-Takla's glorification indexes (the old Praise-indexes and the newer
 * /lyrics/ar/praise/<letter>/), then each page's own song data (schema.org MusicComposition: name, lyricist, lyrics).
 * Nothing goes to the site from here: the owner chooses, tools/bread-praise-import.mjs takes only what he chose.
 *
 *   node tools/bread-praise-catalog.mjs   → D:/private_projects/khobzna-work/p5b/praise-catalog.json
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.P5B_DIR || 'D:/private_projects/khobzna-work/p5b';
const BASE = 'https://st-takla.org';
const INDEX = ['01-Saints-Glorification-Alef', '02-Saints-Glorification-Beh', '03-Saints-Glorification-Teh', '04-Saints-Glorification-Theh', '05-Saints-Glorification-Geem', '06-Saints-Glorification-Hah', '07-Saints-Glorification-Khah', '10-Saints-Glorification-Reh', '12-Saints-Glorification-Sein', '13-Saints-Glorification-Shein', '18-Saints-Glorification-Ein', '19-Saints-Glorification-Ghein', '20-Saints-Glorification-Feh', '21-Saints-Glorification-Kaf', '22-Saints-Glorification-Kaaf', '23-Saints-Glorification-Laam', '24-Saints-Glorification-Meem', '25-Saints-Glorification-Noun', '28-Saints-Glorification-Yeh']
  .map(n => `${BASE}/Lyrics-Spiritual-Songs/10-Coptic-Praises-Glorification-Madae7/Praise-indexes/${n}.html`);
const LETTERS = ['alif', 'baa', 'taa', 'thaa', 'geem', 'haa', 'khaa', 'dal', 'raa', 'zay', 'seen', 'sheen', 'sad', 'tah', 'ain', 'ghain', 'faa', 'qaf', 'kef', 'lam', 'meem', 'noon', 'waw', 'yaa']
  .map(l => `${BASE}/lyrics/ar/praise/${l}/`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (khobzna catalog)' } });
      if (r.status === 404) return '';
      if (r.ok) return await r.text();
    } catch { /* again */ }
    await sleep(1500);
  }
  return '';
}
const links = new Set();
for (const u of [...INDEX, ...LETTERS]) {
  const html = await get(u);
  for (const m of html.matchAll(/href="([^"]+\.html)"/g)) {
    const abs = new URL(m[1], u).href.split('#')[0];
    if (/\/lyrics\/ar\/praise\/[a-z]+\/[a-z0-9-]+\.html$/.test(abs) || (/10-Coptic-Praises-Glorification-Madae7\/[^/]+\.html$/.test(abs) && !/Praise-indexes/.test(abs))) links.add(abs);
  }
  await sleep(300);
}
console.log(links.size, 'pages');
const out = [];
const list = [...links];
for (let i = 0; i < list.length; i += 6) {
  const batch = await Promise.all(list.slice(i, i + 6).map(async url => {
    const html = await get(url);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
    const song = blocks.flatMap(b => b['@graph'] || [b]).find(x => x && x['@type'] === 'MusicComposition');
    if (!song || !song.lyrics || !song.lyrics.text) return null;
    return {
      url, name: String(song.name || '').trim(), lyricist: (song.lyricist || []).map(a => a.name).join('، '),
      about: (song.about || []).map(a => a.name), lines: song.lyrics.text.split('\n').map(l => l.trim()).filter(Boolean)
    };
  }));
  out.push(...batch.filter(Boolean));
  await sleep(400);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'praise-catalog.json'), JSON.stringify(out, null, 1));
console.log(out.length, 'praises with their text →', path.join(OUT, 'praise-catalog.json'));
