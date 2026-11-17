// «خبزنا اليومي» — W1 final identity files from the APPROVED logo B «الأسرة» (docs/daily-bread/logo/logo-b-family.svg,
// approved 2026-11-14; its drawing is not changed here) + the small mark (concept C), refined to match logo B.
//
//   node docs/daily-bread/tools/static.mjs        (review server on 4340, must be running)
//   node docs/daily-bread/w1/tools/build-identity.mjs
//
// Output: docs/daily-bread/w1/identity/
//   src/   live-text sources (editable: Aref Ruqaa + Cairo, SIL OFL, from assets/fonts/)
//   svg/   the final SVGs: every text converted to outlines (paths), layers kept as named groups (<g id="…">),
//          the family seal embedded (raster: no vector of the family logo exists in the repo)
//   pdf/   vector PDF of each SVG (opens in Illustrator; File → Save As → .ai)
//   png/   every size the site, the notifications and the share card need
//
// Text → outlines: Chrome shapes the Arabic (HarfBuzz) and prints it to PDF; poppler's pdftocairo (already installed)
// turns the PDF glyphs into paths; the paths replace each <text> in place. Nothing is downloaded.

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const W1 = join(HERE, '..');
const ID = join(W1, 'identity');
const REL = 'docs/daily-bread/w1/identity';
const SERVER = 'http://localhost:4340';
const MOD = [join(ROOT, 'tools'), 'D:/private_projects/athanasios-links/tools'].find(d => existsSync(join(d, 'node_modules', 'puppeteer-core')));
const req = createRequire(join(MOD, 'package.json'));
const puppeteer = req('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const TMP = join(tmpdir(), 'bread-w1-outline');
for (const d of ['src', 'svg', 'pdf', 'png']) mkdirSync(join(ID, d), { recursive: true });
mkdirSync(TMP, { recursive: true });

/* ---------- palette (the site's tokens + logo B's own) ---------- */
const C = {
  ink: '#020914', navy9: '#061a31', navy8: '#0b2a4c', navy7: '#12385f',
  gold: '#d7aa50', goldHi: '#f2d28b', goldDeep: '#8c6423',
  carmine: '#c8433a', maroon: '#6e1f24', maroonDeep: '#4a1216',
  cream: '#f7ecd6', paper: '#fbf3e2'
};
const FONTS = `
  @font-face { font-family: 'Aref Ruqaa'; font-weight: 700; src: url('/assets/fonts/aref-ruqaa-arabic.woff2') format('woff2'); }
  @font-face { font-family: 'Cairo'; font-weight: 200 900; src: url('/assets/fonts/cairo-arabic.woff2') format('woff2'); }
  .ruqaa { font-family: 'Aref Ruqaa', serif; font-weight: 700; }
  .cairo { font-family: 'Cairo', sans-serif; }`;
const f = n => Math.round(n * 10) / 10;

/* the Coptic budded cross — the same drawing as logo B (tools/build-logos.mjs) */
function copticCross(cx, cy, s, fill, extra = '') {
  const a = s * 0.16, L = s * 0.5, r = s * 0.085;
  const d = `M${f(cx - a)},${f(cy - L)} H${f(cx + a)} V${f(cy - a)} H${f(cx + L)} V${f(cy + a)} H${f(cx + a)} V${f(cy + L)} H${f(cx - a)} V${f(cy + a)} H${f(cx - L)} V${f(cy - a)} H${f(cx - a)} Z`;
  let lobes = '';
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const ex = cx + dx * L, ey = cy + dy * L, px = -dy, py = dx;
    for (const k of [-1, 0, 1]) {
      const off = k === 0 ? r * 0.9 : 0;
      lobes += `<circle cx="${f(ex + dx * off + px * k * a * 0.95)}" cy="${f(ey + dy * off + py * k * a * 0.95)}" r="${f(r)}"/>`;
    }
  }
  return `<g fill="${fill}" ${extra}><path d="${d}"/>${lobes}</g>`;
}

/* logo B's open book (same paths), in logo B's 1000-unit space */
function book({ lines = true, lineW = 2.4, gap = 0, mono = false } = {}) {
  let ls = '';
  for (let i = 0; i < 7; i++) {
    const o = i * 13;
    ls += `<path d="M470,${668 + o} C430,${650 + o} 350,${646 + o} 282,${660 + o}"/><path d="M530,${668 + o} C570,${650 + o} 650,${646 + o} 718,${660 + o}"/>`;
  }
  if (mono) {
    return `<path d="M${500 - gap},640 C${426 - gap},600 320,596 240,620 L230,758 C320,738 ${426 - gap},744 ${500 - gap},782 Z"/>` +
      `<path d="M${500 + gap},640 C${574 + gap},600 680,596 760,620 L770,758 C680,738 ${574 + gap},744 ${500 + gap},782 Z"/>` +
      `<path d="M${500 - gap},800 C420,768 300,760 200,790 L206,812 C300,786 420,792 ${500 - gap},826 Z M${500 + gap},800 C580,768 700,760 800,790 L794,812 C700,786 580,792 ${500 + gap},826 Z"/>`;
  }
  return `
    <path id="book-cover" d="M500,668 C420,630 300,628 214,652 L200,790 C300,770 420,778 500,812 C580,778 700,770 800,790 L786,652 C700,628 580,630 500,668 Z" fill="${C.maroon}"/>
    <path id="book-gilt" d="M500,652 C424,616 312,612 228,636 L216,774 C312,754 424,760 500,796 C576,760 688,754 784,774 L772,636 C688,612 576,616 500,652 Z" fill="url(#mGilt)"/>
    <path id="page-left" d="M500,640 C426,600 320,596 240,620 L230,758 C320,738 426,744 500,782 Z" fill="${C.paper}"/>
    <path id="page-right" d="M500,640 C574,600 680,596 760,620 L770,758 C680,738 574,744 500,782 Z" fill="${C.paper}"/>
    <path id="page-shade" d="M500,640 C490,700 492,740 500,782 C508,740 510,700 500,640 Z" fill="#000" opacity=".14"/>
    ${lines ? `<g id="page-lines" stroke="#c9b48a" stroke-width="${lineW}" fill="none" stroke-linecap="round" opacity=".85">${ls}</g>` : ''}
    <path id="ribbon" d="M506,650 L520,842 L510,830 L498,846 L494,652 Z" fill="${C.carmine}"/>`;
}

function rays(cx, cy, n, r1, r2, color = '#fff3cf', op = 0.22) {
  let p = '';
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i + 0.5) * Math.PI / n, w = 0.05;
    p += `M${f(cx + Math.cos(a - w) * r1)},${f(cy + Math.sin(a - w) * r1)} L${f(cx + Math.cos(a) * r2)},${f(cy + Math.sin(a) * r2)} L${f(cx + Math.cos(a + w) * r1)},${f(cy + Math.sin(a + w) * r1)} Z `;
  }
  return `<path id="rays" d="${p}" fill="${color}" opacity="${op}"/>`;
}

/*
 * Mark C, refined to match logo B (W1): concept C's iconostasis arch (the site's own arch) now opens on logo B's dawn —
 * the same sky, sun, rays and ground — with logo B's book (maroon cover, gilt, paper, red ribbon) and logo B's cross
 * rising like the sun. Gold arch in logo B's ring gradient.
 *   mode 'full'   ≥ 96 px (app icon, notification icon, lockups)
 *   mode 'small'  ≤ 48 px (favicon): no rays, no page lines, a heavier arch, a larger cross
 *   mode 'mono'   one colour (Android notification badge: only the alpha is used), transparent
 *   tile: 'round' (rounded navy square), 'full' (maskable: navy to the edges, the drawing inside the safe circle (radius 40 %)), false
 */
function mark({ mode = 'full', tile = 'round' } = {}) {
  const small = mode === 'small', mono = mode === 'mono';
  const arch = (r, x0, x1, yb) => `M${x0},${yb} V240 A${r},${r} 0 0 1 ${x1},240 V${yb}`;
  const ink = mono ? '#ffffff' : null;
  const body = mono ? `
    <g id="arch" fill="none" stroke="${ink}" stroke-width="26" stroke-linejoin="round"><path d="${arch(128, 128, 384, 448)}"/></g>
    ${copticCross(256, 200, 112, ink, 'id="cross"')}
    <g id="book" fill="${ink}" transform="translate(56 92) scale(.4)">${book({ mono: true, gap: 9 })}</g>` : `
    <defs>
      <linearGradient id="mSky" x1="0" y1="112" x2="0" y2="440" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.navy8}"/><stop offset=".42" stop-color="#3c4f7a"/><stop offset=".68" stop-color="#c98a5a"/><stop offset=".84" stop-color="#f2c47a"/><stop offset="1" stop-color="#f7dc9b"/></linearGradient>
      <radialGradient id="mSun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fffbe8"/><stop offset=".25" stop-color="#ffe7a6" stop-opacity=".95"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
      <linearGradient id="mGilt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.goldHi}"/><stop offset="1" stop-color="${C.goldDeep}"/></linearGradient>
      <linearGradient id="mRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.goldHi}"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.goldDeep}"/></linearGradient>
      <linearGradient id="mGround" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c79a5c"/><stop offset="1" stop-color="#8a6236"/></linearGradient>
      <clipPath id="mWindow"><path d="${arch(116, 140, 372, 448)} Z"/></clipPath>
    </defs>
    <g id="window" clip-path="url(#mWindow)">
      <rect id="sky" x="100" y="100" width="312" height="360" fill="url(#mSky)"/>
      ${small ? '' : rays(256, 336, 14, 40, 260)}
      <circle id="sun-disc" cx="256" cy="336" r="${small ? 96 : 170}" fill="url(#mSun)"/>
      <path id="hills" d="M100,352 C150,334 200,340 236,348 C290,330 340,334 412,350 V460 H100 Z" fill="#5d5a73" opacity=".55"/>
      <path id="table" d="M100,404 C180,394 332,394 412,404 V460 H100 Z" fill="url(#mGround)"/>
    </g>
    <g id="arch" fill="none" stroke-linejoin="round">
      <path d="${arch(128, 128, 384, 448)}" stroke="url(#mRing)" stroke-width="${small ? 20 : 13}"/>
      ${small ? '' : `<path d="${arch(110, 146, 366, 448)}" stroke="${C.gold}" stroke-width="3" opacity=".7"/>`}
    </g>
    ${copticCross(256, small ? 200 : 212, small ? 112 : 88, C.goldHi, 'id="cross"')}
    <g id="book" transform="translate(56 ${small ? 98 : 92}) scale(.4)">${book({ lines: !small, lineW: 6 })}</g>`;
  const content = small ? `<g id="mark" transform="translate(256 256) scale(1.16) translate(-256 -280)">${body}</g>` : `<g id="mark" transform="translate(0 -24)">${body}</g>`;
  let bg = '';
  if (tile === 'round') bg = `<rect id="tile" width="512" height="512" rx="112" fill="${C.navy8}"/>`;
  if (tile === 'full') bg = `<rect id="tile" width="512" height="512" fill="${C.navy8}"/>`;
  const inner = tile === 'full' ? `<g transform="translate(256 256) scale(.95) translate(-256 -256)">${content}</g>` : content;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" width="512" height="512">
  <title>خبزنا اليومي — العلامة</title>
  ${bg}${inner}
</svg>`;
}

/* the name with the mark: horizontal (page header, admin, documents) */
function lockup({ dark = true } = {}) {
  const t = dark ? C.goldHi : C.maroon, s = dark ? '#b9c5d5' : '#5a4a3a';
  const m = mark({ tile: 'round' }).replace(/^<svg[^>]*>|<\/svg>$/g, '').replace(/<title>.*?<\/title>/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1200 360" width="1200" height="360" direction="rtl">
  <title>خبزنا اليومي — الاسم مع العلامة</title>
  <defs><style>${FONTS}</style></defs>
  <rect id="ground" width="1200" height="360" rx="40" fill="${dark ? C.navy9 : C.paper}"/>
  <g id="mark-c" transform="translate(904 44) scale(.535)">${m}</g>
  <text id="name" class="ruqaa" x="872" y="196" text-anchor="start" font-size="150" fill="${t}">خبزنا اليومي</text>
  <text id="tagline" class="cairo" x="872" y="280" text-anchor="start" font-size="44" font-weight="600" fill="${s}">كلمة من الإنجيل تقوّيك كل يوم</text>
</svg>`;
}

/* the approved logo B, unchanged in drawing: fonts from the site root, the seal from the 512 px family logo, ids for its two unnamed texts */
function logoB() {
  let s = readFileSync(join(ROOT, 'docs/daily-bread/logo/logo-b-family.svg'), 'utf8');
  s = s.replace(/url\('\.\.\/\.\.\/\.\.\/assets\/fonts\//g, "url('/assets/fonts/")
    .replace(/href="\.\.\/\.\.\/\.\.\/assets\/img\/logo-256\.webp"/, 'href="/assets/img/logo-512.png"')
    .replace('<text class="ruqaa" x="500" y="338"', '<text id="title-text" class="ruqaa" x="500" y="338"')
    .replace('<text class="cairo" x="500" y="440"', '<text id="tagline-text" class="cairo" x="500" y="440"')
    .replace('<svg xmlns="http://www.w3.org/2000/svg"', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"')
    .replace('— المقترح ب «الأسرة»', '— اللوجو المعتمد «الأسرة»');
  return s;
}

const SOURCES = {
  'logo-b-family': logoB(),
  'mark-c': mark({ tile: 'round' }),
  'mark-c-transparent': mark({ tile: false }),
  'mark-c-small': mark({ mode: 'small', tile: 'round' }),
  'mark-c-maskable': mark({ tile: 'full' }),
  'mark-c-mono': mark({ mode: 'mono', tile: false }),
  'lockup-dark': lockup({ dark: true }),
  'lockup-light': lockup({ dark: false })
};
for (const [n, s] of Object.entries(SOURCES)) writeFileSync(join(ID, 'src', n + '.svg'), s + '\n');

/* ---------- text → outlines ---------- */
function movePath(d, dx, dy, k) {
  const out = [];
  const tok = d.match(/[MLCZmlcz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let pair = [];
  for (const t of tok) {
    if (/[A-Za-z]/.test(t)) {
      if (/[a-z]/.test(t) && t !== 'z') throw new Error('relative path command from pdftocairo: ' + t);
      out.push(t.toUpperCase()); continue;
    }
    pair.push(+t);
    if (pair.length === 2) { out.push(f2((pair[0] + dx) * k) + ',' + f2((pair[1] + dy) * k)); pair = []; }
  }
  return out.join(' ');
}
const f2 = n => Math.round(n * 100) / 100;

async function outline(page, name, w, h) {
  const url = `${SERVER}/${REL}/src/${name}.svg`;
  await page.setViewport({ width: w, height: h });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const runs = await page.evaluate(() => {
    const NS = 'http://www.w3.org/2000/svg';
    const st = document.createElementNS(NS, 'style');
    st.textContent = '.ol-mode * { visibility: hidden !important } .ol-mode clipPath, .ol-mode clipPath * { visibility: visible !important } .ol-mode .ol-on, .ol-mode .ol-on * { visibility: visible !important; stroke: none !important } .ol-mode .ol-on .ol-off { visibility: hidden !important }';
    document.documentElement.appendChild(st);
    const list = [];
    [...document.querySelectorAll('text')].forEach((t, i) => {
      t.dataset.ol = i;
      const own = [...t.querySelectorAll('tspan[fill]')];
      own.forEach((sp, j) => { sp.dataset.olRun = j; list.push({ i, run: j, fill: sp.getAttribute('fill') }); });
      list.push({ i, run: -1, fill: t.getAttribute('fill'), stroke: t.getAttribute('stroke'), sw: t.getAttribute('stroke-width'), lj: t.getAttribute('stroke-linejoin'), id: t.id, label: t.textContent.replace(/\s+/g, ' ').trim() });
    });
    return list;
  });
  const paths = {};
  for (const r of runs) {
    await page.evaluate(r => {
      const root = document.documentElement;
      root.classList.add('ol-mode');
      document.querySelectorAll('.ol-on,.ol-off').forEach(n => n.classList.remove('ol-on', 'ol-off'));
      const t = document.querySelector(`text[data-ol="${r.i}"]`);
      if (r.run === -1) { t.classList.add('ol-on'); t.querySelectorAll('tspan[data-ol-run]').forEach(sp => sp.classList.add('ol-off')); }
      else { t.classList.add('ol-on'); t.querySelectorAll('tspan[data-ol-run]').forEach(sp => { if (sp.dataset.olRun !== String(r.run)) sp.classList.add('ol-off'); }); }
      // a run's own fill must not be "none" for the PDF glyphs to exist
      [t, ...t.querySelectorAll('*')].forEach(n => n.style && (n.style.fill = '#000'));
    }, r);
    const pdf = join(TMP, `${name}-${r.i}-${r.run}.pdf`), svg = pdf.replace(/\.pdf$/, '.svg');
    await page.pdf({ path: pdf, width: w + 'px', height: h + 'px', printBackground: false, pageRanges: '1' });
    execFileSync('pdftocairo', ['-svg', pdf, svg]);
    const out = readFileSync(svg, 'utf8');
    const glyphs = {};
    for (const m of out.matchAll(/<g id="(glyph-[\d-]+)">([\s\S]*?)<\/g>/g)) glyphs[m[1]] = [...m[2].matchAll(/ d="([^"]*)"/g)].map(x => x[1]);
    const uses = [...out.matchAll(/<use xlink:href="#(glyph-[\d-]+)"([^>]*)\/>/g)];
    let d = '';
    for (const u of uses) {
      const xy = u[2].match(/x="([-\d.e]+)" y="([-\d.e]+)"/);
      if (!xy || /transform/.test(u[2])) throw new Error(`${name}: glyph placed with a transform, not supported: ${u[0]}`);
      for (const p of glyphs[u[1]] || []) d += movePath(p, +xy[1], +xy[2], 4 / 3) + ' ';
    }
    if (!d.trim()) throw new Error(`${name}: no glyphs for text ${r.i} run ${r.run}`);
    (paths[r.i] ||= []).push({ ...r, d: d.trim() });
  }
  // replace each <text> with its outlines, in the page's own DOM, then serialise
  const svg = await page.evaluate(paths => {
    const NS = 'http://www.w3.org/2000/svg';
    document.querySelectorAll('style').forEach(s => s.remove());
    document.documentElement.classList.remove('ol-mode');
    if (!document.documentElement.getAttribute('class')) document.documentElement.removeAttribute('class');
    for (const [i, rs] of Object.entries(paths)) {
      const t = document.querySelector(`text[data-ol="${i}"]`);
      const base = rs.find(r => r.run === -1);
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('id', base.id || `text-${i}`);
      g.setAttribute('data-text', base.label);
      if (base.stroke && base.stroke !== 'none') {
        const s = document.createElementNS(NS, 'path');
        s.setAttribute('d', rs.map(r => r.d).join(' '));
        s.setAttribute('fill', base.stroke); s.setAttribute('stroke', base.stroke); s.setAttribute('stroke-width', base.sw);
        if (base.lj) s.setAttribute('stroke-linejoin', base.lj);
        s.setAttribute('data-part', 'outline-stroke');
        g.appendChild(s);
      }
      for (const r of rs) {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', r.d); p.setAttribute('fill', r.fill || base.fill);
        g.appendChild(p);
      }
      t.replaceWith(g);
    }
    document.querySelectorAll('textPath').forEach(n => n.remove());
    return new XMLSerializer().serializeToString(document.documentElement);
  }, paths);
  return svg;
}

const SIZES = { 'logo-b-family': [1000, 1000], 'lockup-dark': [1200, 360], 'lockup-light': [1200, 360] };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
const seal = 'data:image/png;base64,' + readFileSync(join(ROOT, 'assets/img/logo-512.png')).toString('base64');
for (const name of Object.keys(SOURCES)) {
  const [w, h] = SIZES[name] || [512, 512];
  let svg = /<text/.test(SOURCES[name]) ? await outline(page, name, w, h) : SOURCES[name];
  svg = svg.replace(/(<image[^>]*?) href="\/assets\/img\/logo-512\.png"/, `$1 xlink:href="${seal}"`)
    .replace(/<defs>\s*<\/defs>/, '');
  if (!/^<\?xml/.test(svg)) svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg;
  if (/<text|@font-face|\/assets\//.test(svg)) throw new Error(name + ': live text or an external reference is left');
  writeFileSync(join(ID, 'svg', name + '.svg'), svg + '\n');
  console.log('svg', name, Math.round(svg.length / 1024) + ' KB');
}

/* ---------- PDF (vector) ---------- */
for (const name of Object.keys(SOURCES)) {
  const [w, h] = SIZES[name] || [512, 512];
  await page.setViewport({ width: w, height: h });
  await page.goto(`${SERVER}/${REL}/svg/${name}.svg`, { waitUntil: 'networkidle0' });
  await page.pdf({ path: join(ID, 'pdf', name + '.pdf'), width: w + 'px', height: h + 'px', printBackground: true, pageRanges: '1' });
}
console.log('pdf done');

/* ---------- PNG ---------- */
async function png(svgName, out, w, h, { bg = 'transparent', scale = 1, pad = 0 } = {}) {
  const src = `${SERVER}/${REL}/svg/${svgName}.svg`;
  await page.setViewport({ width: Math.max(w, 800), height: Math.max(h, 600), deviceScaleFactor: 1 });
  await page.goto(SERVER + '/docs/daily-bread/w1/tools/blank.html'); // same origin, no CSP
  await page.setContent(`<!doctype html><html><body style="margin:0;background:${bg};width:${w}px;height:${h}px;display:grid;place-items:center;overflow:hidden;position:absolute;left:0;top:0">
    <img src="${src}" style="width:${(w - 2 * pad) * scale}px;height:${(h - 2 * pad) * scale}px;object-fit:contain"></body></html>`, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: join(ID, 'png', out), omitBackground: bg === 'transparent', type: 'png', clip: { x: 0, y: 0, width: w, height: h } });
}
// logo B
for (const s of [2048, 1024, 512, 256]) await png('logo-b-family', `logo-b-family-${s}.png`, s, s);
// app icons (the mark: the full logo cannot be read at home-screen size)
await png('mark-c', 'icon-512.png', 512, 512);
await png('mark-c', 'icon-192.png', 192, 192);
await png('mark-c-maskable', 'icon-maskable-512.png', 512, 512);
await png('mark-c-maskable', 'icon-maskable-192.png', 192, 192);
await png('mark-c-maskable', 'apple-touch-icon-180.png', 180, 180);
// favicon: the simplified mark
await png('mark-c-small', 'favicon-48.png', 48, 48);
await png('mark-c-small', 'favicon-32.png', 32, 32);
await png('mark-c-small', 'favicon-16.png', 16, 16);
// notifications: the icon (colour) and the badge (Android uses only its alpha: white on transparent)
await png('mark-c', 'push-icon-192.png', 192, 192);
await png('mark-c-mono', 'push-badge-96.png', 96, 96);
await png('mark-c-mono', 'push-badge-72.png', 72, 72);
// lockups
await png('lockup-dark', 'lockup-dark-1200.png', 1200, 360);
await png('lockup-light', 'lockup-light-1200.png', 1200, 360);
await png('lockup-dark', 'lockup-dark-600.png', 600, 180);

/* composed cards: the notification's big picture (2:1) and the share card (OG 1200×630), both from logo B */
async function card(out, w, h, html) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(SERVER + '/docs/daily-bread/w1/tools/blank.html'); // same origin, no CSP
  await page.setContent(`<!doctype html><html lang="ar" dir="rtl"><head><style>
    @font-face { font-family: 'Aref Ruqaa'; font-weight: 700; src: url('${SERVER}/assets/fonts/aref-ruqaa-arabic.woff2') format('woff2'); }
    @font-face { font-family: 'Cairo'; font-weight: 200 900; src: url('${SERVER}/assets/fonts/cairo-arabic.woff2') format('woff2'); }
    html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
    body{font-family:Cairo,sans-serif;color:#f5f7fb;background:radial-gradient(120% 90% at 70% 120%, #c98a5a 0%, #3c4f7a 38%, #0b2a4c 64%, #061a31 100%)}
    .lat{position:absolute;inset:0;opacity:.07;background-image:radial-gradient(circle at 1px 1px,#f2d28b 1.2px,transparent 1.3px);background-size:26px 26px}
    .ruqaa{font-family:'Aref Ruqaa',serif;font-weight:700}
  </style></head><body>${html}</body></html>`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(ID, 'png', out), type: 'png' });
}
const LOGO = `${SERVER}/${REL}/svg/logo-b-family.svg`;
await card('og-1200x630.png', 1200, 630, `<div class="lat"></div>
  <img src="${LOGO}" style="position:absolute;right:70px;top:45px;width:540px;height:540px;filter:drop-shadow(0 30px 60px rgba(0,0,0,.45))">
  <div style="position:absolute;left:70px;top:150px;width:520px;text-align:right">
    <div class="ruqaa" style="font-size:108px;line-height:1.05;color:#f2d28b">خبزنا اليومي</div>
    <div style="font-size:36px;font-weight:700;margin-top:18px">كلمة من الإنجيل تقوّيك كل يوم</div>
    <div style="height:3px;width:120px;background:#d7aa50;margin:28px 0 22px auto;border-radius:3px"></div>
    <div style="font-size:21px;line-height:1.6;color:#b9c5d5">إعداد وإشراف أسرة البابا أثناسيوس الرسولي للشباب<br>كنيسة أبي سيفين بسفاجا</div>
  </div>`);
await card('push-image-1024x512.png', 1024, 512, `<div class="lat"></div>
  <img src="${LOGO}" style="position:absolute;right:56px;top:36px;width:440px;height:440px;filter:drop-shadow(0 24px 48px rgba(0,0,0,.45))">
  <div style="position:absolute;left:60px;top:150px;width:440px;text-align:right">
    <div class="ruqaa" style="font-size:88px;line-height:1.05;color:#f2d28b">خبزنا اليومي</div>
    <div style="font-size:30px;font-weight:700;margin-top:14px">كلمة النهارده مستنياك</div>
  </div>`);
await browser.close();
rmSync(TMP, { recursive: true, force: true });
console.log('png done');
