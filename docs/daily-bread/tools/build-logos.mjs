// «خبزنا اليومي» — logo concepts (study only, docs/daily-bread/STUDY.md §6).
// Builds layered, editable SVGs (each layer is a named <g id="…">, Illustrator turns them into layers).
// Usage: node docs/daily-bread/tools/build-logos.mjs  → docs/daily-bread/logo/*.svg
//
// Text stays live text (fonts: Aref Ruqaa + Cairo, both SIL OFL, in assets/fonts/). After approval the
// final files get the text converted to outlines in Illustrator, so they open the same on any machine.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'logo');
mkdirSync(OUT, { recursive: true });

const C = {
  ink: '#020914', navy9: '#061a31', navy8: '#0b2a4c', navy7: '#12385f',
  gold: '#d7aa50', goldHi: '#f2d28b', goldDeep: '#8c6423',
  carmine: '#c8433a', maroon: '#6e1f24', maroonDeep: '#4a1216',
  cream: '#f7ecd6', paper: '#fbf3e2'
};

const FONTS = `
  @font-face { font-family: 'Aref Ruqaa'; font-weight: 700; src: url('../../../assets/fonts/aref-ruqaa-arabic.woff2') format('woff2'); }
  @font-face { font-family: 'Cairo'; font-weight: 200 900; src: url('../../../assets/fonts/cairo-arabic.woff2') format('woff2'); }
  .ruqaa { font-family: 'Aref Ruqaa', serif; font-weight: 700; }
  .cairo { font-family: 'Cairo', sans-serif; }`;

const f = n => Math.round(n * 10) / 10;

/* Coptic cross: a plus whose four arms end in three small lobes (the Coptic "budded" cross) */
function copticCross(cx, cy, s, fill, extra = '') {
  const a = s * 0.16;               // half arm width
  const L = s * 0.5;                // arm length from centre
  const r = s * 0.085;              // lobe radius
  let d = `M${f(cx - a)},${f(cy - L)} H${f(cx + a)} V${f(cy - a)} H${f(cx + L)} V${f(cy + a)} H${f(cx + a)} V${f(cy + L)} H${f(cx - a)} V${f(cy + a)} H${f(cx - L)} V${f(cy - a)} H${f(cx - a)} Z`;
  let lobes = '';
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const ex = cx + dx * L, ey = cy + dy * L;
    // three lobes across the arm's end
    const px = -dy, py = dx;
    for (const k of [-1, 0, 1]) {
      const off = k === 0 ? r * 0.9 : 0;
      lobes += `<circle cx="${f(ex + dx * off + px * k * a * 0.95)}" cy="${f(ey + dy * off + py * k * a * 0.95)}" r="${f(r)}"/>`;
    }
  }
  return `<g fill="${fill}" ${extra}><path d="${d}"/>${lobes}</g>`;
}

/* wheat: one stalk from (x,y) leaning by angle, n grain pairs */
function wheat(x, y, len, angle, color, n = 7) {
  const rad = angle * Math.PI / 180;
  const ux = Math.sin(rad), uy = -Math.cos(rad);
  const tx = x + ux * len, ty = y + uy * len;
  let g = `<path d="M${f(x)},${f(y)} Q${f(x + ux * len * 0.5 + uy * 6)},${f(y + uy * len * 0.5 - ux * 6)} ${f(tx)},${f(ty)}" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i < n; i++) {
    const t = 0.45 + i * (0.55 / n);
    const gx = x + ux * len * t, gy = y + uy * len * t;
    const deg = angle;
    g += `<ellipse cx="${f(gx - uy * 7)}" cy="${f(gy + ux * 7)}" rx="5" ry="11" transform="rotate(${f(deg - 28)} ${f(gx - uy * 7)} ${f(gy + ux * 7)})" fill="${color}"/>`;
    g += `<ellipse cx="${f(gx + uy * 7)}" cy="${f(gy - ux * 7)}" rx="5" ry="11" transform="rotate(${f(deg + 28)} ${f(gx + uy * 7)} ${f(gy - ux * 7)})" fill="${color}"/>`;
  }
  g += `<ellipse cx="${f(tx)}" cy="${f(ty)}" rx="4.5" ry="10" transform="rotate(${f(angle)} ${f(tx)} ${f(ty)})" fill="${color}"/>`;
  return g;
}

/* the open book, centred on x=500; pages as two curved leaves, gilt edges, cover, ribbon */
function book({ cover = C.maroon, ribbon = C.carmine, page = C.paper, line = '#c9b48a', y = 0 } = {}) {
  const T = v => f(v + y);
  let lines = '';
  for (let i = 0; i < 7; i++) {
    const o = i * 13;
    lines += `<path d="M${470},${T(668 + o)} C${430},${T(650 + o)} ${350},${T(646 + o)} ${282},${T(660 + o)}" />`;
    lines += `<path d="M${530},${T(668 + o)} C${570},${T(650 + o)} ${650},${T(646 + o)} ${718},${T(660 + o)}" />`;
  }
  return `
  <g id="book">
    <path id="book-cover" d="M500,${T(668)} C420,${T(630)} 300,${T(628)} 214,${T(652)} L200,${T(790)} C300,${T(770)} 420,${T(778)} 500,${T(812)} C580,${T(778)} 700,${T(770)} 800,${T(790)} L786,${T(652)} C700,${T(628)} 580,${T(630)} 500,${T(668)} Z" fill="${cover}"/>
    <path id="book-gilt" d="M500,${T(652)} C424,${T(616)} 312,${T(612)} 228,${T(636)} L216,${T(774)} C312,${T(754)} 424,${T(760)} 500,${T(796)} C576,${T(760)} 688,${T(754)} 784,${T(774)} L772,${T(636)} C688,${T(612)} 576,${T(616)} 500,${T(652)} Z" fill="url(#gilt)"/>
    <path id="page-left" d="M500,${T(640)} C426,${T(600)} 320,${T(596)} 240,${T(620)} L230,${T(758)} C320,${T(738)} 426,${T(744)} 500,${T(782)} Z" fill="${page}"/>
    <path id="page-right" d="M500,${T(640)} C574,${T(600)} 680,${T(596)} 760,${T(620)} L770,${T(758)} C680,${T(738)} 574,${T(744)} 500,${T(782)} Z" fill="${page}"/>
    <path id="page-shade" d="M500,${T(640)} C490,${T(700)} 492,${T(740)} 500,${T(782)} C508,${T(740)} 510,${T(700)} 500,${T(640)} Z" fill="#000" opacity=".12"/>
    <g id="page-lines" stroke="${line}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".85">${lines}</g>
    <path id="ribbon" d="M506,${T(650)} L520,${T(842)} L510,${T(830)} L498,${T(846)} L494,${T(652)} Z" fill="${ribbon}"/>
  </g>`;
}

function bread(x = 0, y = 0) {
  return `
  <g id="bread" transform="translate(${x} ${y})">
    <path d="M196,${818} C180,770 222,738 284,734 C352,730 392,760 398,800 C402,826 380,838 300,840 C230,842 202,838 196,818 Z" fill="url(#crust)"/>
    <path d="M236,${756} C252,748 268,748 282,754 M286,${748} C302,742 318,744 332,752 M334,${752} C348,750 362,756 372,766" stroke="#f3d39a" stroke-width="5" fill="none" stroke-linecap="round" opacity=".9"/>
    <path d="M210,${822} C260,832 340,832 392,816" stroke="#5a3210" stroke-width="3" fill="none" opacity=".35"/>
  </g>`;
}

function lantern(x, y, s = 1, glow = '#ffd98a') {
  return `
  <g id="lantern" transform="translate(${x} ${y}) scale(${s})">
    <circle cx="0" cy="40" r="120" fill="url(#lampGlow)"/>
    <path d="M-34,-70 C-34,-130 34,-130 34,-70" stroke="#2a1d10" stroke-width="7" fill="none"/>
    <path d="M-40,-62 L40,-62 L30,-40 L-30,-40 Z" fill="#3a2a16"/>
    <rect x="-44" y="-40" width="88" height="128" rx="10" fill="${glow}" opacity=".95"/>
    <rect x="-44" y="-40" width="88" height="128" rx="10" fill="none" stroke="#2a1d10" stroke-width="7"/>
    <path d="M-44,24 H44 M0,-40 V88" stroke="#2a1d10" stroke-width="3" opacity=".35"/>
    ${copticCross(0, 24, 58, '#7a3a12')}
    <path d="M-52,88 H52 L42,108 H-42 Z" fill="#3a2a16"/>
  </g>`;
}

function church(x, y, s = 1, fill = '#e7cf9a', shade = '#c6a56a') {
  return `
  <g id="church" transform="translate(${x} ${y}) scale(${s})">
    <rect x="-70" y="-40" width="140" height="90" fill="${fill}"/>
    <rect x="-22" y="-90" width="44" height="60" fill="${fill}"/>
    <path d="M-22,-90 A22,24 0 0 1 22,-90 Z" fill="${shade}"/>
    <path d="M-62,-40 A26,28 0 0 1 -10,-40 Z" fill="${shade}"/>
    <path d="M10,-40 A26,28 0 0 1 62,-40 Z" fill="${shade}"/>
    <path d="M-10,50 V18 A10,11 0 0 1 10,18 V50 Z" fill="#7a5a2a"/>
    <path d="M-46,4 V-12 A6,7 0 0 1 -34,-12 V4 Z M34,4 V-12 A6,7 0 0 1 46,-12 V4 Z M-6,-58 V-70 A6,7 0 0 1 6,-70 V-58 Z" fill="#7a5a2a"/>
    <path d="M0,-114 V-124 M-5,-119 H5 M-36,-68 V-78 M-41,-73 H-31 M36,-68 V-78 M31,-73 H41" stroke="${shade}" stroke-width="3"/>
  </g>`;
}

function defs(kind) {
  const sky = kind === 'family'
    ? `<stop offset="0" stop-color="${C.navy8}"/><stop offset=".42" stop-color="#3c4f7a"/><stop offset=".66" stop-color="#c98a5a"/><stop offset=".8" stop-color="#f2c47a"/><stop offset="1" stop-color="#f7dc9b"/>`
    : `<stop offset="0" stop-color="#8fa6c8"/><stop offset=".38" stop-color="#e9b98e"/><stop offset=".66" stop-color="#f7cf8b"/><stop offset="1" stop-color="#fbe6b4"/>`;
  return `
  <defs>
    <style>${FONTS}</style>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${sky}</linearGradient>
    <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fffbe8"/><stop offset=".25" stop-color="#ffe7a6" stop-opacity=".95"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
    <radialGradient id="lampGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd27a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
    <linearGradient id="gilt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.goldHi}"/><stop offset="1" stop-color="${C.goldDeep}"/></linearGradient>
    <linearGradient id="crust" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d7964a"/><stop offset=".6" stop-color="#a4602a"/><stop offset="1" stop-color="#6e3a14"/></linearGradient>
    <linearGradient id="goldRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.goldHi}"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.goldDeep}"/></linearGradient>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c79a5c"/><stop offset="1" stop-color="#8a6236"/></linearGradient>
    <clipPath id="disc"><circle cx="500" cy="500" r="${kind === 'family' ? 392 : 478}"/></clipPath>
    <path id="ringTop" d="M 64,500 A 436,436 0 0 1 936,500"/>
    <path id="ringBottom" d="M 38,500 A 462,462 0 0 0 962,500"/>
  </defs>`;
}

function rays(cx, cy, n = 18, r1 = 60, r2 = 420, color = '#fff3cf', op = 0.22) {
  let p = '';
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i + 0.5) * Math.PI / n;
    const w = 0.035;
    p += `M${f(cx + Math.cos(a - w) * r1)},${f(cy + Math.sin(a - w) * r1)} L${f(cx + Math.cos(a) * r2)},${f(cy + Math.sin(a) * r2)} L${f(cx + Math.cos(a + w) * r1)},${f(cy + Math.sin(a + w) * r1)} Z `;
  }
  return `<path id="rays" d="${p}" fill="${color}" opacity="${op}"/>`;
}

function scene(kind, dy = 0) {
  const hills = kind === 'family' ? ['#5d5a73', '#8a6a5a'] : ['#c79a7a', '#b68660'];
  return `
  <g id="scene" clip-path="url(#disc)">
    <rect id="sky" x="0" y="0" width="1000" height="1000" fill="url(#sky)"/>
    <g id="landscape" transform="translate(0 ${dy})">
    ${rays(500, 620)}
    <circle id="sun-disc" cx="500" cy="620" r="210" fill="url(#sun)"/>
    <path id="hills-far" d="M0,640 C120,600 220,612 300,628 C380,600 460,604 540,626 C640,596 760,600 1000,630 V1000 H0 Z" fill="${hills[0]}" opacity=".55"/>
    ${church(770, 600, 0.95)}
    <path id="hills-near" d="M0,690 C160,660 300,676 420,690 C560,670 720,664 1000,684 V1000 H0 Z" fill="${hills[1]}" opacity=".75"/>
    <path id="table" d="M0,792 C200,770 800,770 1000,792 V1000 H0 Z" fill="url(#ground)"/>
    ${lantern(kind === 'family' ? 205 : 170, 610, kind === 'family' ? 0.72 : 0.78)}
    ${book()}
    ${bread(0, 0)}
    <g id="wheat">
      ${wheat(232, 868, 190, 62, '#c99135')}
      ${wheat(226, 878, 205, 70, '#e3b862')}
      ${wheat(240, 874, 170, 52, '#f2d28b')}
    </g>

    </g>
  </g>`;
}

/* A — «الفجر»: close to the owner's reference (warm sky, maroon type, maroon signature band) */
function logoDawn() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000" direction="rtl">
  <title>خبزنا اليومي — المقترح أ «الفجر»</title>
  ${defs('dawn')}
  <g id="ring"><circle cx="500" cy="500" r="496" fill="url(#goldRing)"/><circle cx="500" cy="500" r="484" fill="${C.cream}"/></g>
  ${scene('dawn', -62)}
  <g id="band" clip-path="url(#disc)">
    <path d="M0,808 C200,782 800,782 1000,808 V1000 H0 Z" fill="${C.maroon}"/>
    <path d="M40,808 C240,784 760,784 960,808" stroke="${C.gold}" stroke-width="5" fill="none"/>
    <text class="cairo" x="500" y="840" text-anchor="middle" font-size="22" font-weight="600" fill="${C.cream}">إعداد وإشراف</text>
    <text class="cairo" x="500" y="874" text-anchor="middle" font-size="27" font-weight="800" fill="${C.goldHi}">أسرة البابا أثناسيوس الرسولي للشباب</text>
    <text class="cairo" x="500" y="904" text-anchor="middle" font-size="22" font-weight="600" fill="${C.cream}">كنيسة أبي سيفين بسفاجا</text>
    <circle cx="500" cy="946" r="34" fill="${C.maroonDeep}" stroke="${C.gold}" stroke-width="3"/>
    <image id="family-logo" href="../../../assets/img/logo-256.webp" x="468" y="914" width="64" height="64"/>
  </g>
  <g id="title">
    ${copticCross(500, 110, 92, C.maroon, 'id="top-cross" stroke="' + C.gold + '" stroke-width="3"')}
    <path d="M300,190 C380,150 620,150 700,190" stroke="${C.maroon}" stroke-width="6" fill="none" stroke-linecap="round"/>
    <text class="ruqaa" x="500" y="330" text-anchor="middle" font-size="168" fill="${C.maroon}" stroke="${C.cream}" stroke-width="10" paint-order="stroke">خبزنا اليومي</text>
    <path d="M300,370 C420,340 600,390 720,350" stroke="${C.gold}" stroke-width="7" fill="none" stroke-linecap="round"/>
  </g>
  <g id="tagline">
    <path d="M250,402 L760,396 L748,456 L262,462 Z" fill="${C.maroon}" opacity=".92"/>
    <text class="cairo" x="505" y="442" text-anchor="middle" font-size="34" font-weight="700" fill="${C.cream}">كلمة من الإنجيل تقوّيك كل يوم</text>
  </g>
</svg>`;
}

/* B — «الأسرة»: same scene inside the family logo's own frame (navy ring with lettering, gold hairline, crosses at the sides) */
function logoFamily() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000" direction="rtl">
  <title>خبزنا اليومي — المقترح ب «الأسرة»</title>
  ${defs('family')}
  <g id="ring">
    <circle cx="500" cy="500" r="498" fill="${C.navy8}"/>
    <circle cx="500" cy="500" r="490" fill="none" stroke="${C.gold}" stroke-width="3"/>
    <circle cx="500" cy="500" r="398" fill="none" stroke="url(#goldRing)" stroke-width="12"/>
    <!-- the signature, split over the ring like the family logo: credit on top, the church below -->
    <text id="ring-credit" class="cairo" font-size="33" font-weight="700" fill="${C.goldHi}"><textPath href="#ringTop" startOffset="50%" text-anchor="middle"><tspan font-weight="500" fill="${C.gold}">إعداد وإشراف</tspan>  أسرة البابا أثناسيوس الرسولي للشباب</textPath></text>
    <text id="ring-church" class="cairo" font-size="37" font-weight="700" fill="${C.goldHi}"><textPath href="#ringBottom" startOffset="50%" text-anchor="middle">كنيسة أبي سيفين بسفاجا</textPath></text>
    ${copticCross(54, 500, 50, C.gold)}
    ${copticCross(946, 500, 50, C.gold)}
  </g>
  ${scene('family')}
  <g id="title" clip-path="url(#disc)">
    ${copticCross(500, 172, 70, C.goldHi, 'id="top-cross"')}
    <text class="ruqaa" x="500" y="338" text-anchor="middle" font-size="146" fill="${C.goldHi}" stroke="${C.navy9}" stroke-width="12" paint-order="stroke">خبزنا اليومي</text>
    <path d="M360,384 C440,366 560,398 640,378" stroke="${C.gold}" stroke-width="5" fill="none" stroke-linecap="round"/>
  </g>
  <g id="tagline" clip-path="url(#disc)">
    <text class="cairo" x="500" y="440" text-anchor="middle" font-size="38" font-weight="700" fill="#fff6e0" stroke="${C.navy9}" stroke-width="7" paint-order="stroke" stroke-linejoin="round">كلمة من الإنجيل تقوّيك كل يوم</text>
  </g>
  <!-- the family's own logo, small, as a seal at the foot of the book -->
  <g id="family-seal">
    <circle cx="500" cy="846" r="44" fill="${C.navy9}" stroke="url(#goldRing)" stroke-width="5"/>
    <clipPath id="sealClip"><circle cx="500" cy="846" r="38"/></clipPath>
    <image href="../../../assets/img/logo-256.webp" x="462" y="808" width="76" height="76" clip-path="url(#sealClip)"/>
  </g>
</svg>`;
}

/* C — «العلامة»: the small mark (app icon, notification badge, favicon): an arch, an open book whose top is a loaf, the cross rising like the sun */
function mark({ bg = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>خبزنا اليومي — العلامة</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.goldHi}"/><stop offset="1" stop-color="${C.gold}"/></linearGradient>
    <radialGradient id="dawn" cx=".5" cy=".62" r=".55"><stop offset="0" stop-color="#f7cf8b" stop-opacity=".55"/><stop offset="1" stop-color="#f7cf8b" stop-opacity="0"/></radialGradient>
  </defs>
  ${bg ? `<rect id="tile" width="512" height="512" rx="112" fill="${C.navy8}"/>` : ''}
  <g id="arch" fill="none" stroke="url(#g)" stroke-width="10">
    <path d="M136,420 V214 A120,120 0 0 1 376,214 V420"/>
    <path d="M154,420 V218 A102,102 0 0 1 358,218 V420" stroke-width="3" opacity=".7"/>
  </g>
  <circle cx="256" cy="300" r="140" fill="url(#dawn)"/>
  ${copticCross(256, 196, 70, C.goldHi, 'id="cross"')}
  <g id="loaf-book">
    <path d="M256,300 C222,270 170,266 148,280 L148,380 C176,368 222,370 256,394 C290,370 336,368 364,380 L364,280 C342,266 290,270 256,300 Z" fill="${C.paper}"/>
    <path d="M256,300 C222,270 170,266 148,280 L148,380 C176,368 222,370 256,394 C290,370 336,368 364,380 L364,280 C342,266 290,270 256,300 Z" fill="none" stroke="url(#g)" stroke-width="8" stroke-linejoin="round"/>
    <path d="M256,300 V394" stroke="${C.gold}" stroke-width="6"/>
    <path d="M176,306 C196,300 214,302 230,312 M176,330 C196,324 214,326 230,336 M282,312 C298,302 316,300 336,306 M282,336 C298,326 316,324 336,330" stroke="#c9a058" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M250,394 L256,440 L262,394 Z" fill="${C.carmine}"/>
  </g>
</svg>`;
}

/* lockup: mark + wordmark + tagline (horizontal, for the page header and the admin) */
function lockup({ dark = true } = {}) {
  const t = dark ? C.goldHi : C.maroon, s = dark ? '#b9c5d5' : '#5a4a3a';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 360" width="1200" height="360" direction="rtl">
  <title>خبزنا اليومي — الاسم مع العلامة</title>
  <defs><style>${FONTS}</style></defs>
  ${dark ? `<rect width="1200" height="360" rx="40" fill="${C.navy9}"/>` : `<rect width="1200" height="360" rx="40" fill="${C.paper}"/>`}
  <g transform="translate(912 52) scale(.5)">${mark().replace(/^<svg[^>]*>|<\/svg>$/g, '').replace(/<title>.*?<\/title>/, '')}</g>
  <text class="ruqaa" x="880" y="196" text-anchor="start" font-size="150" fill="${t}">خبزنا اليومي</text>
  <text class="cairo" x="880" y="278" text-anchor="start" font-size="44" font-weight="600" fill="${s}">كلمة من الإنجيل تقوّيك كل يوم</text>
</svg>`;
}

const files = {
  'logo-a-dawn.svg': logoDawn(),
  'logo-b-family.svg': logoFamily(),
  'mark-c.svg': mark(),
  'mark-c-transparent.svg': mark({ bg: false }),
  'lockup-dark.svg': lockup({ dark: true }),
  'lockup-light.svg': lockup({ dark: false })
};
for (const [name, svg] of Object.entries(files)) writeFileSync(join(OUT, name), svg + '\n');
console.log('wrote', Object.keys(files).join(', '));
