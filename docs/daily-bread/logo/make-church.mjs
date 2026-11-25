// «مناسبات كنيستنا» — the section's medallion, a sibling of «خبزنا اليومي» logo B (owner 2026-11-25: a logo that sits
// beside خبزنا's, legendary, not ordinary; Abu Sefein, since an occasion belongs to the whole church).
// The same ring, crosses, signature and family seal as logo B; inside: a crimson night, the church in light, and behind
// it Abu Sefein's two swords crossed (أبو سيفين = «father of the two swords»), a martyr's crown where they cross.
// Every part is a named layer, for the intro.   node docs/daily-bread/logo/make-church.mjs → church-a.svg
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const B = fs.readFileSync(path.join(HERE, 'logo-b-family.svg'), 'utf8').replace(/\r\n/g, '\n').split('\n');
const head = B.slice(0, B.findIndex(l => l.includes('</defs>'))).join('\n');
const ring = B.slice(B.findIndex(l => l.includes('<g id="ring">')), B.findIndex(l => l.includes('<g id="scene"'))).join('\n');
const crossOf = l => l.match(/<g fill="#f2d28b" id="top-cross">.*?<\/g>/)[0];
const topCross = crossOf(B.find(l => l.includes('id="top-cross"')));
const seal = B.slice(B.findIndex(l => l.includes('<g id="family-seal">')), B.lastIndexOf('</svg>')).join('\n');

// a Coptic cross (the ring's own shape), centred at (x, y), size s
const cross = (x, y, s, fill) => {
  const a = 9.3 * s, b = 29 * s, r = 4.9 * s, c = b - a * 0.0;
  return `<g fill="${fill}" transform="translate(${x} ${y})"><path d="M${-a},${-b} H${a} V${-a} H${b} V${a} H${a} V${b} H${-a} V${a} H${-b} V${-a} H${-a} Z"/>` +
    [[-a, -b], [0, -b - r * 0.9], [a, -b], [b, -a], [b + r * 0.9, 0], [b, a], [a, b], [0, b + r * 0.9], [-a, b], [-b, a], [-b - r * 0.9, 0], [-b, -a]].map(([cx, cy]) => `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"/>`).join('') + '</g>';
};
// one sword, upright, tip up; the two are turned ±34° (and made smaller) about the crossing point, above the dome
const sword = id => `<g id="${id}">
      <path d="M500,300 L516,338 L516,690 L484,690 L484,338 Z" fill="url(#blade)" stroke="#f2d28b" stroke-width="3"/>
      <path d="M500,318 L500,684" stroke="#9aa6b8" stroke-width="3" opacity=".7"/>
      <rect x="436" y="688" width="128" height="20" rx="10" fill="url(#gilt)" stroke="#5a3a12" stroke-width="2"/>
      <circle cx="436" cy="698" r="11" fill="#f2d28b"/><circle cx="564" cy="698" r="11" fill="#f2d28b"/>
      <rect x="490" y="708" width="20" height="62" rx="6" fill="#5a1a1f" stroke="#c99a4a" stroke-width="2"/>
      <circle cx="500" cy="782" r="14" fill="url(#gilt)" stroke="#5a3a12" stroke-width="2"/>
    </g>`;

const svg = `${head.replace('<title>خبزنا اليومي — المقترح ب «الأسرة»</title>', '<title>مناسبات كنيستنا — شعار القسم (2026-11-25)</title>')}
    <radialGradient id="night" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#9b2b35"/><stop offset=".45" stop-color="#5a1520"/><stop offset="1" stop-color="#1c060b"/></radialGradient>
    <radialGradient id="halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff1c8" stop-opacity=".95"/><stop offset=".35" stop-color="#f2c47a" stop-opacity=".55"/><stop offset="1" stop-color="#f2c47a" stop-opacity="0"/></radialGradient>
    <linearGradient id="blade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e8edf5"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="#aeb8c8"/></linearGradient>
    <linearGradient id="stone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbeed2"/><stop offset="1" stop-color="#d1ad6c"/></linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7" result="b"/><feColorMatrix in="b" values="1 0 0 0 .95  0 1 0 0 .8  0 0 1 0 .45  0 0 0 .8 0"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <linearGradient id="earth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d0f17"/><stop offset="1" stop-color="#14040a"/></linearGradient>
  </defs>
${ring}
  <g id="scene" clip-path="url(#disc)">
    <rect id="night-sky" x="0" y="0" width="1000" height="1000" fill="url(#night)"/>
    <g id="stars" fill="#f2d28b">${[[300, 470, 3], [690, 455, 3.4], [250, 560, 2.4], [760, 545, 2.6], [345, 395, 2], [655, 385, 2.2], [215, 470, 1.8], [790, 470, 1.8]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
    <circle id="halo-glow" cx="500" cy="520" r="240" fill="url(#halo)" opacity=".75"/>
    <g id="swords" filter="url(#glow)">
      <g transform="translate(500 515) rotate(-36) scale(.9) translate(-500 -530)">${sword('sword-a')}</g>
      <g transform="translate(500 515) rotate(36) scale(.9) translate(-500 -530)">${sword('sword-b')}</g>
    </g>
    <g id="crown" transform="translate(500 486) scale(.62)">
      <path d="M-46,10 L-50,-26 L-24,-6 L0,-36 L24,-6 L50,-26 L46,10 Z" fill="url(#gilt)" stroke="#5a3a12" stroke-width="2.5"/>
      <rect x="-48" y="8" width="96" height="14" rx="5" fill="#f2d28b" stroke="#5a3a12" stroke-width="2"/>
      <circle cx="0" cy="-38" r="6" fill="#fff3cf"/><circle cx="-50" cy="-28" r="5" fill="#fff3cf"/><circle cx="50" cy="-28" r="5" fill="#fff3cf"/>
    </g>
    <path id="hills" d="M0,770 C150,735 300,742 420,758 C560,740 720,736 1000,762 V1000 H0 Z" fill="url(#earth)"/>
    <g id="church">
      <rect x="340" y="640" width="50" height="135" fill="url(#stone)"/><rect x="610" y="640" width="50" height="135" fill="url(#stone)"/>
      <path d="M340,642 A25,25 0 0 1 390,642 Z" fill="url(#stone)"/><path d="M610,642 A25,25 0 0 1 660,642 Z" fill="url(#stone)"/>
      ${cross(365, 596, 0.55, '#f2d28b')}${cross(635, 596, 0.55, '#f2d28b')}
      <rect x="390" y="680" width="220" height="95" fill="url(#stone)"/>
      <rect x="440" y="640" width="120" height="44" fill="url(#stone)"/>
      <path d="M430,642 A70,70 0 0 1 570,642 Z" fill="url(#stone)"/>
      ${cross(500, 540, 0.7, '#fff3cf')}
      <g id="windows" fill="#ffd27a">
        <path d="M484,775 V738 A16,16 0 0 1 516,738 V775 Z" fill="#5a1520"/><path d="M488,775 V740 A12,12 0 0 1 512,740 V775 Z"/>
        <path d="M418,742 V718 A10,10 0 0 1 438,718 V742 Z"/><path d="M562,742 V718 A10,10 0 0 1 582,718 V742 Z"/>
        <path d="M357,700 V682 A8,8 0 0 1 373,682 V700 Z"/><path d="M627,700 V682 A8,8 0 0 1 643,682 V700 Z"/>
        <path d="M466,664 V650 A7,7 0 0 1 480,650 V664 Z"/><path d="M493,664 V648 A7,7 0 0 1 507,648 V664 Z"/><path d="M520,664 V650 A7,7 0 0 1 534,650 V664 Z"/>
      </g>
    </g>
  </g>
  <g id="title" clip-path="url(#disc)">
    ${topCross}
    <text class="ruqaa" x="500" y="296" text-anchor="middle" font-size="112" fill="#f2d28b" stroke="#2a0a10" stroke-width="11" paint-order="stroke">مناسبات كنيستنا</text>
  </g>
  <g id="tagline" clip-path="url(#disc)">
    <text class="cairo" x="500" y="352" text-anchor="middle" font-size="34" font-weight="700" fill="#fff6e0" stroke="#2a0a10" stroke-width="7" paint-order="stroke">أعيادنا وتذكاراتنا في يومها</text>
  </g>
${seal}
</svg>
`;
fs.writeFileSync(path.join(HERE, 'church-a.svg'), svg);
console.log('church-a.svg', svg.length, 'bytes');
