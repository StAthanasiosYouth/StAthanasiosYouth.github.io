// «مناسبات كنيستنا» — the section's medallion, a sibling of «خبزنا اليومي» logo B.
// Owner 2026-11-25: the same spirit as logo B; Abu Sefein (an occasion belongs to the whole church); and after the
// first preview: real swords (not light sabres), a richer church, a clearer crown, a deeper crimson with light,
// the slogan «تاريخ بنعيشه... وذكريات بتجمعنا».
// The same ring, crosses, signature and family seal as logo B. Inside: a deep crimson night lit from behind the church,
// Abu Sefein's two swords crossed (أبو سيفين = «father of the two swords»), the martyr's crown where they cross, and
// our church in warm stone. Every part is a named layer, for the entrance.
//   node docs/daily-bread/logo/make-church.mjs → church-a.svg
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const B = fs.readFileSync(path.join(HERE, 'logo-b-family.svg'), 'utf8').replace(/\r\n/g, '\n').split('\n');
const head = B.slice(0, B.findIndex(l => l.includes('</defs>'))).join('\n');
const ring = B.slice(B.findIndex(l => l.includes('<g id="ring">')), B.findIndex(l => l.includes('<g id="scene"'))).join('\n');
const topCross = B.find(l => l.includes('id="top-cross"')).match(/<g fill="#f2d28b" id="top-cross">.*?<\/g>/)[0];
const seal = B.slice(B.findIndex(l => l.includes('<g id="family-seal">')), B.lastIndexOf('</svg>')).join('\n');
const n = v => +v.toFixed(1);

// a Coptic cross (the ring's own shape), centred at (x, y), size s
const cross = (x, y, s, fill) => {
  const a = 9.3 * s, b = 29 * s, r = 4.9 * s;
  return `<g fill="${fill}" transform="translate(${x} ${y})"><path d="M${n(-a)},${n(-b)} H${n(a)} V${n(-a)} H${n(b)} V${n(a)} H${n(a)} V${n(b)} H${n(-a)} V${n(a)} H${n(-b)} V${n(-a)} H${n(-a)} Z"/>` +
    [[-a, -b], [0, -b - r * 0.9], [a, -b], [b, -a], [b + r * 0.9, 0], [b, a], [a, b], [0, b + r * 0.9], [-a, b], [-b, a], [-b - r * 0.9, 0], [-b, -a]].map(([cx, cy]) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>`).join('') + '</g>';
};

/* a real sword, upright (tip at 300), its crossguard at 690: a tapered blade with a fuller, steel shading, a curved gilt
   guard, a wrapped grip and a pommel. The two are turned ±36° about the crossing point above the dome. */
const sword = id => `<g id="${id}">
      <path d="M500,292 C506,318 512,340 514,366 L517,668 L483,668 L486,366 C488,340 494,318 500,292 Z" fill="url(#steel)" stroke="#2b3038" stroke-width="2.4"/>
      <path d="M500,300 C503,330 505,352 505,372 L505,660 L500,664 Z" fill="#ffffff" opacity=".55"/>
      <path d="M497,380 L497,640 M503,380 L503,640" stroke="#5c6673" stroke-width="2.2" opacity=".8"/>
      <path d="M483,652 L517,652 L519,672 L481,672 Z" fill="url(#steelDark)"/>
      <path d="M418,676 C440,668 470,678 500,676 C530,678 560,668 582,676 C588,680 588,690 580,692 C556,688 530,694 500,694 C470,694 444,688 420,692 C412,690 412,680 418,676 Z" fill="url(#gilt2)" stroke="#4a2c0c" stroke-width="2.2"/>
      <circle cx="414" cy="684" r="9" fill="url(#gilt2)" stroke="#4a2c0c" stroke-width="2"/><circle cx="586" cy="684" r="9" fill="url(#gilt2)" stroke="#4a2c0c" stroke-width="2"/>
      <path d="M500,664 L512,684 L500,704 L488,684 Z" fill="#a32631" stroke="#4a2c0c" stroke-width="2"/>
      <rect x="489" y="694" width="22" height="70" rx="7" fill="#3a1a12" stroke="#1c0c08" stroke-width="2"/>
      <path d="M489,702 L511,712 M489,716 L511,726 M489,730 L511,740 M489,744 L511,754" stroke="#8a5a32" stroke-width="3" opacity=".85"/>
      <ellipse cx="500" cy="778" rx="16" ry="18" fill="url(#gilt2)" stroke="#4a2c0c" stroke-width="2.2"/>
      <circle cx="500" cy="778" r="6" fill="#a32631"/>
    </g>`;

/* the martyr's crown: a gilt band set with stones, five points, a cross on the middle one */
const crown = `<g id="crown" transform="translate(500 458) scale(.72)">
      <path d="M-70,22 L-78,-34 L-44,-6 L-22,-48 L0,-14 L22,-48 L44,-6 L78,-34 L70,22 Z" fill="url(#gilt2)" stroke="#3a2008" stroke-width="3" stroke-linejoin="round"/>
      <path d="M-62,10 L-66,-18 L-42,2 M62,10 L66,-18 L42,2" stroke="#fff3cf" stroke-width="2.4" fill="none" opacity=".6"/>
      <rect x="-74" y="16" width="148" height="24" rx="8" fill="url(#gilt2)" stroke="#3a2008" stroke-width="3"/>
      <circle cx="-44" cy="28" r="6.5" fill="#1f5fa8" stroke="#fff3cf" stroke-width="1.6"/><circle cx="0" cy="28" r="8" fill="#b3202c" stroke="#fff3cf" stroke-width="1.6"/><circle cx="44" cy="28" r="6.5" fill="#1f5fa8" stroke="#fff3cf" stroke-width="1.6"/>
      <circle cx="-22" cy="28" r="3.5" fill="#fff3cf"/><circle cx="22" cy="28" r="3.5" fill="#fff3cf"/>
      <circle cx="-78" cy="-36" r="6" fill="#fff3cf" stroke="#3a2008" stroke-width="2"/><circle cx="78" cy="-36" r="6" fill="#fff3cf" stroke="#3a2008" stroke-width="2"/>
      <circle cx="-22" cy="-50" r="6" fill="#fff3cf" stroke="#3a2008" stroke-width="2"/><circle cx="22" cy="-50" r="6" fill="#fff3cf" stroke="#3a2008" stroke-width="2"/>
      ${cross(0, -40, 0.62, '#fff3cf')}
    </g>`;

/* our church, in warm stone: steps, a nave with an arcade, the great dome with its ribs and lantern, two bell towers */
const tower = x => `<g>
        <rect x="${x - 28}" y="606" width="56" height="170" fill="url(#stone)"/><rect x="${x + 6}" y="606" width="22" height="170" fill="url(#stoneShade)"/>
        <rect x="${x - 32}" y="600" width="64" height="10" rx="2" fill="url(#cornice)"/><rect x="${x - 32}" y="690" width="64" height="8" rx="2" fill="url(#cornice)"/>
        <path d="M${x - 14},676 V636 A14,14 0 0 1 ${x + 14},636 V676 Z" fill="#3a0a12"/><path d="M${x - 8},650 A8,8 0 0 1 ${x + 8},650 L${x + 6},664 H${x - 6} Z" fill="#c99a4a"/>
        <path d="M${x - 10},752 V726 A10,10 0 0 1 ${x + 10},726 V752 Z" fill="#ffd27a"/>
        <path d="M${x - 30},600 C${x - 30},566 ${x + 30},566 ${x + 30},600 Z" fill="url(#dome)"/>
        <path d="M${x},570 V600 M${x - 15},577 C${x - 10},586 ${x - 8},594 ${x - 8},600 M${x + 15},577 C${x + 10},586 ${x + 8},594 ${x + 8},600" stroke="#8c6423" stroke-width="1.6" fill="none" opacity=".7"/>
        ${cross(x, 548, 0.5, '#f2d28b')}
      </g>`;
const church = `<g id="church" transform="translate(500 780) scale(.86) translate(-500 -780)">
      <ellipse cx="500" cy="782" rx="210" ry="14" fill="#000" opacity=".35"/>
      ${tower(350)}${tower(650)}
      <rect x="378" y="676" width="244" height="100" fill="url(#stone)"/>
      <rect x="560" y="676" width="62" height="100" fill="url(#stoneShade)"/>
      <rect x="372" y="668" width="256" height="12" rx="3" fill="url(#cornice)"/>
      <g id="arcade" fill="#ffd27a">
        <path d="M398,742 V716 A11,11 0 0 1 420,716 V742 Z"/><path d="M432,742 V716 A11,11 0 0 1 454,716 V742 Z"/>
        <path d="M546,742 V716 A11,11 0 0 1 568,716 V742 Z"/><path d="M580,742 V716 A11,11 0 0 1 602,716 V742 Z"/>
      </g>
      <path d="M470,776 V728 A30,30 0 0 1 530,728 V776 Z" fill="#c99a4a" stroke="#6e4a14" stroke-width="2.4"/>
      <path d="M476,776 V730 A24,24 0 0 1 524,730 V776 Z" fill="#5a1520"/><path d="M500,706 V776" stroke="#c99a4a" stroke-width="2"/>
      <circle cx="494" cy="748" r="2.4" fill="#f2d28b"/><circle cx="506" cy="748" r="2.4" fill="#f2d28b"/>
      ${cross(500, 694, 0.32, '#fff3cf')}
      <path d="M360,776 H640 L652,790 H348 Z" fill="url(#cornice)"/>
      <rect x="428" y="610" width="144" height="60" fill="url(#stone)"/><rect x="532" y="610" width="40" height="60" fill="url(#stoneShade)"/>
      <rect x="422" y="604" width="156" height="10" rx="2" fill="url(#cornice)"/>
      <g id="windows" fill="#ffd27a">
        <path d="M442,660 V632 A8,8 0 0 1 458,632 V660 Z"/><path d="M469,660 V630 A8,8 0 0 1 485,630 V660 Z"/><path d="M515,660 V630 A8,8 0 0 1 531,630 V660 Z"/><path d="M542,660 V632 A8,8 0 0 1 558,632 V660 Z"/>
        <path d="M492,660 V628 A8,8 0 0 1 508,628 V660 Z"/>
      </g>
      <path d="M420,606 C420,520 580,520 580,606 Z" fill="url(#dome)" stroke="#8c6423" stroke-width="2"/>
      <path d="M500,544 V606 M470,550 C458,568 452,588 452,606 M530,550 C542,568 548,588 548,606 M446,566 C436,580 432,594 432,606 M554,566 C564,580 568,594 568,606" stroke="#9a7230" stroke-width="2" fill="none" opacity=".75"/>
      <path d="M440,574 C452,552 474,540 494,538" stroke="#fffbe8" stroke-width="5" fill="none" stroke-linecap="round" opacity=".55"/>
      <rect x="490" y="526" width="20" height="18" rx="3" fill="url(#cornice)"/><path d="M484,528 C484,512 516,512 516,528 Z" fill="url(#dome)"/>
      ${cross(500, 488, 0.62, '#fff3cf')}
    </g>`;

const rays = Array.from({ length: 22 }, (_, i) => {
  const a = (-170 + i * (160 / 21)) * Math.PI / 180, w = 0.022;
  const p = (r, d) => `${n(500 + r * Math.cos(a + d))},${n(470 + r * Math.sin(a + d))}`;
  return `M${p(40, -w)} L${p(460, -w * 1.6)} L${p(460, w * 1.6)} L${p(40, w)} Z`;
}).join(' ');

const svg = `${head.replace('<title>خبزنا اليومي — المقترح ب «الأسرة»</title>', '<title>مناسبات كنيستنا — شعار القسم (2026-11-25)</title>')}
    <radialGradient id="night" cx=".5" cy=".6" r=".66"><stop offset="0" stop-color="#c2493f"/><stop offset=".22" stop-color="#8a1d2a"/><stop offset=".55" stop-color="#4e0b17"/><stop offset=".85" stop-color="#26050c"/><stop offset="1" stop-color="#140208"/></radialGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe8b0" stop-opacity=".9"/><stop offset=".3" stop-color="#f2b866" stop-opacity=".45"/><stop offset="1" stop-color="#f2b866" stop-opacity="0"/></radialGradient>
    <linearGradient id="raysFade" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffe7a6" stop-opacity=".0"/><stop offset=".35" stop-color="#ffe7a6" stop-opacity=".22"/><stop offset="1" stop-color="#ffe7a6" stop-opacity="0"/></linearGradient>
    <linearGradient id="steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5d6774"/><stop offset=".3" stop-color="#c9d1db"/><stop offset=".5" stop-color="#f4f7fb"/><stop offset=".62" stop-color="#9aa5b3"/><stop offset="1" stop-color="#46505c"/></linearGradient>
    <linearGradient id="steelDark" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3d4550"/><stop offset=".5" stop-color="#8d97a4"/><stop offset="1" stop-color="#363d47"/></linearGradient>
    <linearGradient id="gilt2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0c2"/><stop offset=".35" stop-color="#e7bf6a"/><stop offset=".7" stop-color="#b98a35"/><stop offset="1" stop-color="#7a5418"/></linearGradient>
    <linearGradient id="stone" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4dc"/><stop offset=".6" stop-color="#ecd3a2"/><stop offset="1" stop-color="#d2b27a"/></linearGradient>
    <linearGradient id="stoneShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c9a46a" stop-opacity=".0"/><stop offset="1" stop-color="#9c7a44" stop-opacity=".55"/></linearGradient>
    <linearGradient id="cornice" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7e3b4"/><stop offset="1" stop-color="#b48a46"/></linearGradient>
    <radialGradient id="dome" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fffaea"/><stop offset=".5" stop-color="#f0d9a6"/><stop offset="1" stop-color="#bf9654"/></radialGradient>
    <linearGradient id="earth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a0a14"/><stop offset="1" stop-color="#0e0206"/></linearGradient>
    <radialGradient id="vignette" cx=".5" cy=".5" r=".5"><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
    <filter id="shade" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#14020a" flood-opacity=".7"/></filter>
  </defs>
${ring}
  <g id="scene" clip-path="url(#disc)">
    <rect id="night-sky" x="0" y="0" width="1000" height="1000" fill="url(#night)"/>
    <path id="rays" d="${rays}" fill="url(#raysFade)"/>
    <g id="stars" fill="#f7dc9b">${[[290, 470, 2.6], [700, 452, 3], [240, 560, 2], [768, 548, 2.2], [330, 396, 1.8], [668, 384, 2], [212, 476, 1.6], [796, 474, 1.6], [400, 430, 1.4], [612, 420, 1.4]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
    <circle id="halo-glow" cx="500" cy="480" r="250" fill="url(#glow)"/>
    <path id="hills" d="M0,772 C150,742 300,750 420,762 C560,746 720,742 1000,766 V1000 H0 Z" fill="url(#earth)"/>
    <path d="M0,772 C150,742 300,750 420,762 C560,746 720,742 1000,766" stroke="#c9743f" stroke-width="2" fill="none" opacity=".35"/>
    <g filter="url(#shade)">${church}</g>
    <g id="swords" filter="url(#shade)">
      <g transform="translate(500 470) rotate(-40) scale(.62) translate(-500 -530)">${sword('sword-a')}</g>
      <g transform="translate(500 470) rotate(40) scale(.62) translate(-500 -530)">${sword('sword-b')}</g>
    </g>
    <g filter="url(#shade)">${crown}</g>
    <rect x="0" y="0" width="1000" height="1000" fill="url(#vignette)"/>
  </g>
  <g id="title" clip-path="url(#disc)">
    <g transform="translate(500 150) scale(.82) translate(-500 -172)">${topCross}</g>
    <text class="ruqaa" x="500" y="280" text-anchor="middle" font-size="112" fill="#f2d28b" stroke="#22050c" stroke-width="11" paint-order="stroke">مناسبات كنيستنا</text>
  </g>
  <g id="tagline" clip-path="url(#disc)">
    <text class="cairo" x="500" y="332" text-anchor="middle" font-size="31" font-weight="700" fill="#fff6e0" stroke="#22050c" stroke-width="7" paint-order="stroke">تاريخ بنعيشه... وذكريات بتجمعنا</text>
  </g>
${seal}
</svg>
`;
fs.writeFileSync(path.join(HERE, 'church-a.svg'), svg);
console.log('church-a.svg', svg.length, 'bytes');
