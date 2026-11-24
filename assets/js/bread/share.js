/*
 * «خبزنا اليومي» — the share-verse image, drawn on a <canvas> in the page (no server), 1080 × 1080, the composition of
 * the approved docs/daily-bread/w1/share.html (.br-card1080 in bread.css): logo B's dawn sky and rays, the mark and
 * the name at the top, the verse in Amiri with gold «», the reference, the family's name and the link, the hills.
 */
import { stripTashkeel } from './text.js';

const S = 1080;
const SKY = [[0, '#0b2a4c'], [0.34, '#10335a'], [0.62, '#3c4f7a'], [0.84, '#7d6170'], [1, '#c98a5a']];
const HILLS = [
  ['M0,40 C120,10 220,24 300,34 C380,6 460,10 540,30 C640,4 760,8 1000,36 V150 H0 Z', '#5d5a73', 0.55],
  ['M0,84 C160,58 300,72 420,82 C560,62 720,58 1000,76 V150 H0 Z', '#8a6a5a', 0.8],
  ['M0,118 C200,100 800,100 1000,118 V150 H0 Z', '#c79a5c', 1]
];
export const SITE_LINK = 'stathanasiosyouthsafaga.social/daily-bread';

const loadImage = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

function background(c) {
  const lin = c.createLinearGradient(0, 0, 0, S);
  SKY.forEach(([o, col]) => lin.addColorStop(o, col));
  c.fillStyle = lin;
  c.fillRect(0, 0, S, S);
  // radial-gradient(80% 50% at 50% 108%, …): an ellipse 864 × 540 around (540, 1166)
  c.save();
  c.translate(540, S * 1.08);
  c.scale(1, 540 / 864);
  const glow = c.createRadialGradient(0, 0, 0, 0, 0, 864);
  glow.addColorStop(0, 'rgba(255, 243, 207, .7)');
  glow.addColorStop(0.3, 'rgba(247, 220, 155, .35)');
  glow.addColorStop(0.66, 'rgba(201, 138, 90, 0)');
  c.fillStyle = glow;
  c.fillRect(-1200, -1800, 2400, 3600);
  c.restore();
  // the rays: a 2376 px disc whose bottom is 70 % below the card (centre ≈ (540, 648)), 2.2° of light every 10°,
  // faded by radial-gradient(closest-side, #000 18%, transparent 72%), at opacity .45
  const R = 1188, cx = 540, cy = S + 0.7 * S - R;
  const fade = c.createRadialGradient(cx, cy, 0.18 * R, cx, cy, 0.72 * R);
  fade.addColorStop(0, 'rgba(255, 243, 207, .063)');
  fade.addColorStop(1, 'rgba(255, 243, 207, 0)');
  c.fillStyle = fade;
  c.beginPath();
  for (let a = 0; a < 360; a += 10) {
    const a0 = (a - 90) * Math.PI / 180, a1 = (a + 2.2 - 90) * Math.PI / 180;
    c.moveTo(cx, cy);
    c.arc(cx, cy, 0.72 * R, a0, a1);
    c.closePath();
  }
  c.fill();
  // the hills (viewBox 1000 × 150, stretched over the bottom 150 px)
  c.save();
  c.translate(0, S - 150);
  c.scale(S / 1000, 1);
  for (const [d, fill, alpha] of HILLS) { c.globalAlpha = alpha; c.fillStyle = fill; c.fill(new Path2D(d)); }
  c.restore();
  c.globalAlpha = 1;
}

/* words → lines no wider than `max` with the font set on c */
function wrap(c, text, max) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (line && c.measureText(next).width > max) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/* one RTL line made of runs [{ text, font, color }], centred on x = 540 */
function drawRuns(c, runs, y) {
  let total = 0;
  for (const r of runs) { c.font = r.font; r.w = c.measureText(r.text).width; total += r.w; }
  let x = S / 2 + total / 2;
  c.direction = 'rtl';
  c.textAlign = 'right';
  for (const r of runs) { c.font = r.font; c.fillStyle = r.color; c.fillText(r.text, x, y); x -= r.w; }
}

/**
 * → a <canvas> 1080 × 1080 with the day's verse
 *   { verse, verseRef, plain, mark (URL of the mark image) }
 */
export async function drawShare({ verse, verseRef, plain = false, mark }) {
  const fonts = ['62px Amiri', '700 62px Cairo', '800 34px Cairo', '600 23px Cairo', '700 64px "Aref Ruqaa"'];
  try { await Promise.all(fonts.map(f => document.fonts.load(f, 'خبزنا «» ١'))); } catch { /* system fonts */ }
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const c = cv.getContext('2d');
  background(c);
  c.textBaseline = 'alphabetic';
  c.shadowColor = 'rgba(2, 9, 20, .5)';

  // the head: the mark (84, r 20) and the name, centred, 70 px from the top
  const img = mark ? await loadImage(mark).catch(() => null) : null;
  c.font = '700 64px "Aref Ruqaa", serif';
  const nameW = c.measureText('خبزنا اليومي').width;
  const headW = (img ? 84 + 18 : 0) + nameW;
  const right = S / 2 + headW / 2;
  c.direction = 'rtl'; c.textAlign = 'right'; c.fillStyle = '#f2d28b';
  if (img) {
    c.save();
    c.beginPath();
    c.roundRect(right - 84, 70, 84, 84, 20);
    c.clip();
    c.drawImage(img, right - 84, 70, 84, 84);
    c.restore();
  }
  c.fillText('خبزنا اليومي', right - (img ? 102 : 0), 70 + 84 / 2 + 26);

  // the verse: Amiri 62 / 1.75, shrinks for a long verse, in the middle between the head and the foot
  const text = (plain ? stripTashkeel(verse) : verse).replace(/\s+/g, ' ').trim();
  let size = 62, lines;
  for (;;) {
    c.font = `${size}px Amiri, serif`;
    lines = wrap(c, '«' + text + '»', S - 2 * 84);
    if (lines.length * size * 1.75 + 74 <= 620 || size <= 34) break;
    size -= 2;
  }
  const lh = size * 1.75;
  const block = lines.length * lh + 20 + 54;
  let y = 154 + (832 - 154 - block) / 2;
  c.shadowBlur = 30; c.shadowOffsetY = 4;
  lines.forEach((line, i) => {
    const runs = [];
    let body = line;
    if (i === 0) { runs.push({ text: '«', font: `700 ${size}px Cairo, sans-serif`, color: '#d7aa50' }); body = body.slice(1); }
    const close = i === lines.length - 1;
    if (close) body = body.slice(0, -1);
    runs.push({ text: body, font: `${size}px Amiri, serif`, color: '#fff6e0' });
    if (close) runs.push({ text: '»', font: `700 ${size}px Cairo, sans-serif`, color: '#d7aa50' });
    drawRuns(c, runs, y + lh * 0.62);
    y += lh;
  });
  c.shadowBlur = 0; c.shadowOffsetY = 0;
  drawRuns(c, [{ text: verseRef, font: '800 34px Cairo, sans-serif', color: '#f2d28b' }], y + 20 + 38);

  // the foot: the family's name, the link (left to right)
  drawRuns(c, [{ text: 'أسرة البابا أثناسيوس الرسولي للشباب – سفاجا', font: '800 27px Cairo, sans-serif', color: '#f2d28b' }], 832 + 32);
  c.direction = 'ltr'; c.textAlign = 'center'; c.font = '600 23px Cairo, sans-serif'; c.fillStyle = 'rgba(255, 246, 224, .78)';
  c.fillText(SITE_LINK, S / 2, 832 + 32 + 38);
  return cv;
}

export const toBlob = cv => new Promise(ok => cv.toBlob(ok, 'image/png'));
