#!/usr/bin/env node
/*
 * «خبزنا اليومي» P5b — the praises (التماجيد والمدائح والذكصولوجيات…) of the saints card, from the review the owner
 * brought (khobzna-praise-review.json, his GPT's research, 2026-11-25) → daily-bread/saints/praises-seed.json, the
 * list 0038 seeds (tools/bread-occasions-seed.mjs style: only where a person has no list yet).
 *
 * The owner's rules (2026-11-25): the praises actually sung in our churches, not any madih with the name; several per
 * person (a main one, and others for a day, a feast, a season); nothing «بالعافية»; a candidate never replaces what
 * is there before the owner confirms it. So: everything here is a CANDIDATE (admin only, never on the site), except
 * what the owner himself named: Abu Sefein «تعالوا نتهلل بالألحان», Mar Girgis «السلام لك يا جاورجيوس», the Virgin
 * «السلام لك يا مريم يا أم الله القدوس» (main) and «يا م ر ي م» (Kiahk).
 * The text is fetched where the source page gives it cleanly (St-Takla's song data, tasbeha.org's Arabic blocks);
 * elsewhere the candidate keeps its link and the text is pasted in the admin.
 *
 *   node tools/bread-praise-seed.mjs   (reads D:/private_projects/khobzna-work/p5b/khobzna-praise-review.json)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN = process.env.P5B_DIR || 'D:/private_projects/khobzna-work/p5b';
const OUT = path.join(ROOT, 'daily-bread', 'saints', 'praises-seed.json');
const review = JSON.parse(fs.readFileSync(path.join(IN, 'khobzna-praise-review.json'), 'utf8'));
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'daily-bread', 'data', 'saints.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// what the owner named himself (2026-11-25): confirmed
// (text: where the review's page has none or was removed, a copy the same text is on; the review's link stays in `more`)
const OWNER = [
  { person: 'george', match: /جاورجيوس/, main: true, text: 'https://tasbeha.org/hymn_library/view/153' },
  { person: 'mary', match: /يا أم الله القدوس/, main: true, text: 'https://st-takla.org/Lyrics-Spiritual-Songs/08-Coptic-Taraneem-Kalemat_Meem-Noun/Madi7_Al-Kedisa-Al-3athra2-Mariam-1-Ya-Om-Allah-Al-Koddoos.html' },
  { person: 'mary', match: /م ر ي م|م\. ر\. ي\. م/, context: 'تسبحة كيهك وسهرات العذراء', text: 'https://st-takla.org/Lyrics-Spiritual-Songs/09-Coptic-Taraneem-Kalemat_Heh-Waw-Yeh/Ya-Mariam-Ya-Sett-El-Abkar.html' }
];
const TYPE = t => (/ذكصولوجية/.test(t) ? 'doxology' : /إبصالية/.test(t) ? 'psali' : /تسبحة/.test(t) ? 'tasbeha' : /لحن/.test(t) ? 'lahn' : /^تمجيد/.test(t) ? 'tamgeed' : 'madih');
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const chunk = (lines, n = 4) => { const v = []; for (let i = 0; i < lines.length; i += n) v.push(lines.slice(i, i + n)); return v; };

async function get(url) {
  for (let t = 0; t < 3; t++) {
    try { const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (khobzna praises)' } }); if (r.ok) return Buffer.from(await r.arrayBuffer()); if (r.status === 404) return null; } catch { /* again */ }
    await sleep(1200);
  }
  return null;
}
/* the text, when the page gives it cleanly → { verses, author? } | null */
async function textOf(url) {
  const buf = await get(url);
  if (!buf) return null;
  let html = buf.toString('utf8');
  if (/charset=windows-1256/i.test(html.slice(0, 4000))) html = new TextDecoder('windows-1256').decode(buf);
  if (/st-takla\.org/.test(url)) {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
    const song = blocks.flatMap(b => b['@graph'] || [b]).find(x => x && x['@type'] === 'MusicComposition');
    if (!song || !song.lyrics || !song.lyrics.text) return null;
    const lines = song.lyrics.text.split('\n').map(clean).filter(Boolean);
    return { verses: chunk(lines), author: (song.lyricist || []).map(a => a.name).join('، ') };
  }
  if (/tasbeha\.org/.test(url)) {
    const blocks = [...html.matchAll(/<div[^>]*class="[^"]*hp-prose-ar[^"]*"[^>]*>([\s\S]*?)<\/div>/g)]
      .map(m => m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').split('\n').map(clean).filter(Boolean))
      .filter(b => b.length);
    if (!blocks.length) return null;
    // the first block is often the title line alone
    const verses = blocks[0].length === 1 && blocks.length > 1 ? blocks.slice(1) : blocks;
    return { verses: verses.flatMap(v => (v.length > 6 ? chunk(v) : [v])) };
  }
  return null;
}

const out = {};
let fetched = 0, linkOnly = 0;
for (const p of review.people) {
  if (!reg.people.find(x => x.id === p.id)) continue;
  const list = [];
  const add = (r, extra = {}) => {
    if (!r || !r.url || !r.title) return;
    if (list.some(x => x.source === r.url && x.title === clean(r.title))) return;
    list.push({ id: 'pr' + (list.length + 1), type: TYPE(r.type || ''), title: clean(r.title), source: r.url, status: 'candidate', ...(r.context ? { context: clean(r.context) } : {}), ...(r.evidence && /^https:/.test(r.evidence) ? { more: [r.evidence] } : {}), ...extra });
  };
  if (p.recommendation) add(p.recommendation, { main: true });
  for (const v of p.variants || []) add(v);
  // Abu Sefein: the owner's own choice, already in the registry with its text
  if (p.id === 'mercurius') {
    const m = reg.people.find(x => x.id === 'mercurius').praise;
    list.length = 0;
    list.push({ id: 'pr1', type: 'tamgeed', title: m.title, opening: m.verses[0][0], source: m.source, status: 'confirmed', main: true, refrain: m.refrain, verses: m.verses });
  }
  for (const o of OWNER.filter(o => o.person === p.id)) {
    const it = list.find(x => o.match.test(x.title));
    if (it) {
      it.status = 'confirmed';
      if (o.main) { list.forEach(x => { delete x.main; }); it.main = true; }
      if (o.context) it.context = o.context;
      if (o.text && o.text !== it.source) { it.more = [...new Set([it.source, ...(it.more || [])])]; it.source = o.text; }
    }
  }
  for (const it of list) {
    if (it.verses) continue;
    const t = await textOf(it.source);
    await sleep(250);
    if (t && t.verses.length) { it.verses = t.verses; it.opening = t.verses[0][0]; if (t.author) it.author = t.author; fetched++; } else linkOnly++;
  }
  if (list.length) out[p.id] = list;
}
// a confirmed praise must have its text
for (const [id, list] of Object.entries(out)) for (const it of list) if (it.status === 'confirmed' && !it.verses) { it.status = 'candidate'; console.log('kept as candidate (no text):', id, it.title); }
fs.writeFileSync(OUT, JSON.stringify({ about: 'P5b: the praises per person from the owner\'s review (2026-11-25). candidate = admin only until the owner confirms; confirmed = what the owner named. 0038 seeds a person\'s list only if it has none.', praises: out }, null, 1) + '\n');
const n = Object.values(out).flat();
console.log(`${Object.keys(out).length} people, ${n.length} praises (${n.filter(x => x.status === 'confirmed').length} confirmed), text fetched for ${fetched}, link only ${linkOnly} → ${path.relative(ROOT, OUT)}`);
