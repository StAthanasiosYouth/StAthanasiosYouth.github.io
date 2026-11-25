#!/usr/bin/env node
/*
 * «خبزنا اليومي» P5b — the full text of a praise from its source page, for the ones the review left with a link only
 * (owner 2026-11-25: «اللي معاه الرابط بس، حاول تجيب النص الكامل من المصدر»). Never made up: the page's own Arabic
 * lines, as they are; a page that is gone or gives no clean text → null (the praise stays a candidate).
 *   tasbeha.org (new layout): one stanza per .sync-para, its .sync-arabic lines
 *   st-takla.org rituals/praises (windows-1256): the Arabic lines after «تنسيق مختلف»
 *   st-takla.org lyrics (new): the song's JSON-LD (MusicComposition)
 *   node tools/bread-praise-fetch.mjs <url>   → prints the verses
 */
const clean = s => String(s || '').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/^[+\-•]\s*/, '').trim();
const ARABIC = /[؀-ۿ]{2}/;
const chunk = (lines, n = 4) => { const v = []; for (let i = 0; i < lines.length; i += n) v.push(lines.slice(i, i + n)); return v; };
/* a long line of a liturgical text → its sentences, each at most 200 characters */
const split = l => (l.length <= 200 ? [l] : l.split(/(?<=[.:،])\s+/).flatMap(x => (x.length <= 200 ? [x] : x.match(/.{1,190}(\s|$)/g).map(y => y.trim()))).filter(Boolean));

export async function fetchText(url) {
  let res;
  try { res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (khobzna praises)' } }); } catch { return null; }
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  let html = buf.toString('utf8');
  if (/charset=windows-1256/i.test(html.slice(0, 5000))) html = new TextDecoder('windows-1256').decode(buf);
  if (/tasbeha\.org/.test(url)) {
    const paras = html.split(/<div class="sync-para"/).slice(1).map(p => [...p.matchAll(/<div class="sync-arabic[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map(m => clean(m[1].replace(/<[^>]+>/g, ''))).filter(l => ARABIC.test(l)).flatMap(split));
    const verses = paras.filter(p => p.length).flatMap(p => (p.length > 6 ? chunk(p) : [p]));
    return verses.length ? { verses } : null;
  }
  if (/st-takla\.org/.test(url)) {
    const song = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean)
      .flatMap(b => b['@graph'] || [b]).find(x => x && x['@type'] === 'MusicComposition' && x.lyrics && x.lyrics.text);
    if (song) { const lines = song.lyrics.text.split('\n').map(clean).filter(Boolean); return lines.length ? { verses: chunk(lines) } : null; }
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|td)>/gi, '\n').replace(/<[^>]+>/g, '').split('\n').map(clean).filter(Boolean);
    const at = text.indexOf('تنسيق مختلف');
    if (at < 0) return null;
    // numbered stanzas («1-», «2-»…), or one stanza a line (the doxologies)
    const verses = [];
    let numbered = false;
    for (const l of text.slice(at + 1)) {
      if (/^\d+\s*-$/.test(l)) { numbered = true; verses.push([]); continue; }
      if (!ARABIC.test(l) || /\|/.test(l) || /^الكتاب المقدس/.test(l)) break;
      if (numbered && verses.length) verses[verses.length - 1].push(...split(l)); else verses.push(split(l));
    }
    const out = verses.filter(v => v.length).flatMap(v => (v.length > 6 ? chunk(v) : [v]));
    return out.length ? { verses: out } : null;
  }
  return null;
}

if (process.argv[1] && process.argv[1].endsWith('bread-praise-fetch.mjs') && process.argv[2]) {
  const t = await fetchText(process.argv[2]);
  console.log(t ? t.verses.map((v, i) => (i + 1) + '. ' + v.join(' / ')).join('\n') : 'no clean text');
}
