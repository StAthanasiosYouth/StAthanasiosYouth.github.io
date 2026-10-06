/**
 * «صوتك يهمنا»: the dedicated scene (registry key "voice").
 *
 * An interactive web version of the service's own video
 * (your-voice-matters: video/scene.html + timeline.json): the same navy and
 * gold, the gold extruded headline with the white heart, the logo medallion,
 * the glassy rounded tiles with gold line icons, each option's own effect,
 * the chips with the gold spotlight pill, «١ من ٧», the 7-icon dock, the
 * bokeh and the star field. Not a social scene: personal, warm, calm.
 *
 * A compressed loop of the 9:16 video:
 *   intro (medallion + headline) → hook lines → the 7 options, each with
 *   its effect, dock highlight and counter → the promise → hook → …
 * Later visits: a short intro. Reduced motion: one still frame (the
 * medallion, the headline, the dock). Desktop (wide sheet): the 16:9
 * composition, and a calm side layer behind the sheet: small anonymous
 * message bubbles, hearts, a notification pulse, light, drifting in from
 * the left, the right and the bottom (never over the sheet).
 *
 * Everything runs through the kit: moves and waits pause in hidden tabs,
 * particles are pooled, all of it stops when the sheet closes.
 * Styles: assets/css/xp-voice.css (loaded with this scene).
 */

import { h } from '../dom.js';
import { timeline, edge, rand, pick, digits, EASE } from './kit.js';

const LOGO = 'assets/img/logo-256.webp';

/* the video's own words (timeline.json) */
const INTRO = { title: 'صوتك يهمنا', sub: 'إحنا عايزين نسمعك' };
const HOOK = ['عندك فكرة حلوة؟', 'في حاجة مضايقاك؟', 'محتاج حد يسمعك؟'];
const HOOK_FINAL = 'إحنا هنا علشان نسمعك';
const PROMISE_HEAD = 'وصوتك بيوصلنا…';
const PROMISE = ['بخصوصية تامة', 'من غير اسم لو حابب', 'في أي وقت', 'من موبايلك'];

const OPTIONS = [
  { type: 'suggestion', effect: 'confetti', mood: 'joy', title: 'عندي رأي أو اقتراح', line: 'فكرة جديدة أو حاجة شايف إننا نقدر نطورها', chips: ['فكرة', 'تطوير', 'ممكن من غير اسم'] },
  { type: 'complaint', effect: 'calm', mood: 'calm', title: 'في حاجة مضايقاني', line: 'قول اللي جواك براحتك، وكلامك هيتسمع باهتمام', chips: ['من غير اسم لو حابب', 'بخصوصية'] },
  { type: 'contact', effect: 'ripple', mood: 'joy', title: 'محتاج حد يتواصل معايا', line: 'حد من الخدمة هيكلمك… بالطريقة اللي تريحك', chips: ['واتساب', 'مكالمة', 'زيارة'] },
  { type: 'followup', effect: 'hearts', mood: 'warm', title: 'في شخص محتاج نفتقده', line: 'حد غايب عننا؟ قولنا وإحنا نطمن عليه', chips: ['افتقاد', 'نطمن عليه'] },
  { type: 'prayer', effect: 'embers', mood: 'warm', title: 'محتاج صلاة أو مشورة', line: 'اطلب صلاة، أو اتكلم مع حد يسمعك', chips: ['صلاة', 'مشورة', 'إحنا بنصلي معاك'] },
  { type: 'positive', effect: 'heartBurst', mood: 'joy', title: 'حابب أقول حاجة حلوة', line: 'تشجيع أو موقف حلو… كلمتك بتفرق معانا', chips: ['تشجيع', 'موقف حلو'] },
  { type: 'participate', effect: 'stars', mood: 'joy', title: 'حابب أشارك أو أساعد', line: 'عندك موهبة؟ مكانك محجوز معانا', chips: ['ميديا', 'تنظيم', 'ترانيم', 'أنشطة'] }
];

/* the side layer's anonymous voices (shapes of what people send, no names) */
const NOTES = [
  ['suggestion', 'عندي فكرة…'], ['contact', 'ممكن حد يكلمني؟'], ['prayer', 'صلّوا عشاني 🙏'],
  ['positive', 'شكرًا ليكم ♥'], ['participate', 'حابب أساعد'], ['complaint', 'محتاج حد يسمعني'],
  ['followup', 'صاحبي غايب بقاله فترة'], ['suggestion', 'نفسنا نعمل يوم رياضي']
];

/* the app's line icons, with their small living details (CSS) */
const ICONS = {
  suggestion:
    '<path class="duo" d="M12 3a6 6 0 0 0-3.6 10.8c.75.56 1.1 1.35 1.1 2.2v1h5v-1c0-.85.35-1.64 1.1-2.2A6 6 0 0 0 12 3Z"/>' +
    '<path d="M10 20.5h4"/><path d="M10.5 11.5 12 13l1.5-1.5"/>' +
    '<g class="rays"><path d="M2.5 9H4"/><path d="M20 9h1.5"/><path d="M4.9 3.4l1 1"/><path d="M19.1 3.4l-1 1"/></g>',
  complaint:
    '<path class="duo" d="M7 14.5A4 4 0 0 1 8 6.6A5 5 0 0 1 17 7.2A3.7 3.7 0 0 1 17.5 14.5Z"/>' +
    '<path class="drop" d="M8.5 17.5l-.8 2.2"/><path class="drop d2" d="M12.5 17.5l-.8 2.2"/><path class="drop d3" d="M16.5 17.5l-.8 2.2"/>',
  contact:
    '<path class="duo" d="M6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5v-8A2.5 2.5 0 0 1 6.5 3Z"/>' +
    '<circle class="dot" cx="8.5" cy="9.5" r="1.15"/><circle class="dot d1" cx="12" cy="9.5" r="1.15"/><circle class="dot d2" cx="15.5" cy="9.5" r="1.15"/>',
  followup:
    '<circle class="duo" cx="9" cy="7.5" r="3.5"/><path d="M2.5 20.5a6.5 6.5 0 0 1 10.6-5"/>' +
    '<path class="duo beat" d="M17.5 21s-4-2.4-4-5.1a2.1 2.1 0 0 1 4-1 2.1 2.1 0 0 1 4 1c0 2.7-4 5.1-4 5.1Z"/>',
  prayer:
    '<path d="M6.5 21h11"/><rect class="duo" x="9.5" y="12" width="5" height="9" rx="1"/><path d="M12 10.6V12"/>' +
    '<path class="duo flame" d="M12 3c1.8 2.2 2.6 3.6 2.6 5a2.6 2.6 0 0 1-5.2 0c0-1.4.8-2.8 2.6-5Z"/>' +
    '<g class="rays"><path d="M5 8h1.5"/><path d="M17.5 8H19"/><path d="M6.6 3.4l1 1"/><path d="M17.4 3.4l-1 1"/></g>',
  positive:
    '<path class="duo" d="M11 3c.6 3.6 2.4 5.4 6 6-3.6.6-5.4 2.4-6 6-.6-3.6-2.4-5.4-6-6 3.6-.6 5.4-2.4 6-6Z"/>' +
    '<path class="duo twinkle" d="M18.5 14c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z"/>' +
    '<g class="twinkle d4"><path d="M5.5 16.5v3"/><path d="M4 18h3"/></g>',
  participate:
    '<path class="duo piece" d="M5.5 7.5h3.5a2 2 0 1 1 4 0h3.5v3.5a2 2 0 1 1 0 4v3.5h-3.5a2 2 0 1 0-4 0h-3.5v-3.5a2 2 0 1 0 0-4Z"/>'
};

const HEART = '<path d="M12 21s-7.2-4.45-9.55-8.6C.45 8.86 2.2 4.5 6.45 4.5c2.27 0 4.03 1.24 5.55 3.1 1.52-1.86 3.28-3.1 5.55-3.1 4.25 0 6 4.36 4 7.9C19.2 16.55 12 21 12 21Z"/>';

const PALETTES = {
  confetti: ['#f2d28b', '#d7aa50', '#ffffff', '#5fa8ff', '#55d59a', '#ff8fb1'],
  calm: ['#a9c8ea', '#d2e4f8', '#82aadc'],
  gold: ['#f2d28b', '#ffe7b0', '#d7aa50'],
  hearts: ['#ff7a9c', '#ff9fb6', '#f2d28b', '#ffffff'],
  warmHearts: ['#f5d48f', '#f0b989', '#e8a0a0'],
  embers: ['#ffd98a', '#ffc266', '#fff1cc']
};

/* the video's "back" ease (an overshoot), and its "in" for exits */
const BACK = 'cubic-bezier(.3, 1.55, .55, 1)';
const IN = 'cubic-bezier(.55, 0, .9, .4)';

const parser = document.createElement('template');

/* trusted static markup only (the icons above) */
function svg(body, className = '') {

  parser.innerHTML = `<svg class="vo-icon ${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  return parser.content.firstElementChild;

}

const icon = type => svg(ICONS[type] || '');

/* one span per word, so the words can flip in one by one (as in the video) */
function words(text, className = '') {

  const host = h('span', { class: `vo-words ${className}` });
  text.split(' ').forEach((word, i, all) => {
    host.append(h('span', { class: 'vo-w' }, word));
    if (i < all.length - 1) host.append(' ');
  });
  return host;

}

const wordsOf = node => [...node.querySelectorAll('.vo-w')];


export function play(stage, { quick, reduced, lite, sound, link }) {

  const tl = timeline({ quick, reduced, lite });

  /* ---------- build ---------- */

  const bokeh = Array.from({ length: 7 }, () => h('span', { class: 'vo-bokeh' }));
  const stars = h('div', { class: 'vo-stars' });
  const fx = h('div', { class: 'vo-fx' });

  const brand = h('div', { class: 'vo-brand' },
    h('img', { src: LOGO, alt: '' }),
    h('span', { class: 'vo-brand__text' }, h('b', {}, INTRO.title), h('span', {}, 'أسرة البابا أثناسيوس الرسولي للشباب'))
  );

  const rings = [0, 1].map(() => h('span', { class: 'vo-ring' }));
  const coin = h('span', { class: 'vo-coin' }, h('img', { src: LOGO, alt: '' }));
  const heart = h('span', { class: 'vo-heart' }, svg(HEART));
  const introTitle = h('span', { class: 'vo-intro__title' }, words(INTRO.title, 'vo-gold'), heart);
  const introSub = words(INTRO.sub, 'vo-intro__sub');
  const intro = h('section', { class: 'vo-scene vo-intro' }, h('span', { class: 'vo-medal' }, rings, coin), introTitle, introSub);

  const hookLines = HOOK.map(text => words(text, 'vo-hook__line'));
  const hookFinal = words(HOOK_FINAL, 'vo-gold vo-hook__final');
  const hookList = h('span', { class: 'vo-hook__lines' }, hookLines);
  const hook = h('section', { class: 'vo-scene vo-hook' }, hookList, h('span', { class: 'vo-hook__end' }, hookFinal));

  const tileIcon = h('span', { class: 'vo-tile__icon' });
  const tile = h('span', { class: 'vo-tile' }, h('span', { class: 'vo-tile__face' }), tileIcon);
  const glow = h('span', { class: 'vo-glow' });
  const visual = h('span', { class: 'vo-visual' }, glow, tile);
  const count = h('span', { class: 'vo-count' });
  const optTitle = h('span', { class: 'vo-opt__title' });
  const optLine = h('span', { class: 'vo-opt__line' });
  const chips = h('span', { class: 'vo-chips' });
  const optText = h('span', { class: 'vo-opt__text' }, count, optTitle, optLine, chips);
  const option = h('section', { class: 'vo-scene vo-opt' }, visual, optText);

  const dots = OPTIONS.map(o => h('span', { class: 'vo-pdot' }, icon(o.type)));
  const dock = h('div', { class: 'vo-dock' }, dots);

  const face = h('span', { class: 'vo-face' }, h('span', { class: 'vo-gold' }, PROMISE[0]));
  const promiseHead = words(PROMISE_HEAD, 'vo-gold vo-promise__head');
  const promise = h('section', { class: 'vo-scene vo-promise' }, promiseHead, h('span', { class: 'vo-cube' }, face));

  const canvas = h('div', { class: `vo${reduced ? ' vo--still' : ''}` },
    h('span', { class: 'vo-bokehs' }, bokeh),
    stars,
    intro, hook, option, promise,
    dock,
    brand,
    fx
  );

  stage.append(canvas);

  /* ---------- reduced motion: one still frame ---------- */

  if (reduced) {
    intro.classList.add('is-on');
    return tl;
  }

  /* a fresh state: whatever an earlier move still holds is dropped first */
  const set = (el, styles) => {
    el.getAnimations().forEach(a => a.cancel());
    Object.assign(el.style, styles);
  };

  const show = scene => [intro, hook, option, promise].forEach(s => s.classList.toggle('is-on', s === scene));
  const fade = (el, to, duration = 350, from = to ? 0 : 1) => tl.move(el, [{ opacity: from }, { opacity: to }], { duration, easing: EASE });

  const flipIn = (list, delay, { stagger = 70, duration = 450 } = {}) => list.forEach((w, i) => tl.move(w, [
    { opacity: 0, transform: 'translateY(.4em) rotateX(-100deg)' },
    { opacity: 1, transform: 'none' }
  ], { duration, delay: delay + i * stagger, easing: BACK }));

  const flipOut = (list, { duration = 380 } = {}) => list.forEach(w => tl.move(w, [
    { opacity: 1, transform: 'none' },
    { opacity: 0, transform: 'translateY(-.4em) rotateX(70deg)' }
  ], { duration, easing: IN }));

  /* ---------- the background: bokeh, the star field ---------- */

  bokeh.forEach((b, i) => tl.loop(b, [
    { transform: 'translate(0, 0)', opacity: 0.55 },
    { transform: `translate(${i % 2 ? 26 : -22}%, ${i % 3 ? -18 : 14}%)`, opacity: 1 },
    { transform: 'translate(0, 0)', opacity: 0.55 }
  ], { duration: 9000 + i * 1300, easing: 'ease-in-out' }));

  // stars come towards the viewer, faster on each cut (the video's warp)
  const starfield = tl.ambient(stars, {
    every: 240, max: 18, name: 'vo-star',
    make: () => h('i', { class: 'vo-star' }),
    spawn: node => warp(node, 1)
  });

  function warp(node, boost) {
    const angle = rand(0, Math.PI * 2);
    const near = rand(0.05, 0.2);
    const far = rand(0.55, 0.8);
    node.classList.toggle('is-gold', Math.random() < 0.55);
    node.style.left = `${50 + Math.cos(angle) * near * 50}%`;
    node.style.top = `${48 + Math.sin(angle) * near * 50}%`;
    const dx = Math.cos(angle) * far * canvas.clientWidth * 0.5;
    const dy = Math.sin(angle) * far * canvas.clientHeight * 0.5;
    return node.animate([
      { transform: 'translate(0, 0) scale(.3)', opacity: 0 },
      { transform: `translate(${dx * 0.3}px, ${dy * 0.3}px) scale(.7)`, opacity: 0.9, offset: 0.4 },
      { transform: `translate(${dx}px, ${dy}px) scale(1.5)`, opacity: 0 }
    ], { duration: rand(1800, 2800) / boost, easing: 'cubic-bezier(.5, 0, .9, .6)' });
  }

  const cut = () => starfield && starfield.burst(lite ? 3 : 7, node => warp(node, 2.6));

  /* ---------- the effects (one pool) ---------- */

  const particles = tl.ambient(fx, {
    every: 0, max: lite ? 30 : 56, name: 'vo-fx',
    make: () => h('span', { class: 'vo-p' }),
    spawn: () => null
  });

  /* tile centre, in px of the canvas */
  function centre() {
    const a = tile.getBoundingClientRect();
    const b = canvas.getBoundingClientRect();
    return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2, r: a.width / 2 };
  }

  function particle(node, { kind, color, text = '', x, y, frames, duration, delay = 0, easing = 'cubic-bezier(.2, .7, .35, 1)', size = 1, ring = 0 }) {
    node.className = `vo-p vo-p--${kind} xp-amb`;
    node.textContent = text;
    node.style.width = node.style.height = ring ? `${ring}px` : '';
    node.style.marginLeft = node.style.marginTop = ring ? `${-ring / 2}px` : '';
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.color = color;
    node.style.fontSize = `${size}em`;
    return node.animate(frames, { duration, delay, easing, fill: 'backwards' });
  }

  function effect(kind) {

    if (!particles) return;

    const c = centre();
    const u = canvas.clientWidth / 100;
    const n = count => Math.round(count * (lite ? 0.5 : 1));

    const go = (count, make) => particles.burst(n(count), node => particle(node, make()));

    if (kind === 'confetti') {
      go(32, () => {
        const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
        const s = rand(c.r * 1.2, c.r * 3);
        const spin = rand(-540, 540);
        return {
          kind: 'confetti', color: pick(PALETTES.confetti), x: c.x, y: c.y, duration: rand(2000, 2700), delay: rand(0, 100),
          frames: [
            { transform: 'translate(0, 0) rotate(0)', opacity: 1 },
            { transform: `translate(${Math.cos(a) * s}px, ${Math.sin(a) * s}px) rotate(${spin * 0.4}deg) scaleY(.4)`, opacity: 1, offset: 0.35 },
            { transform: `translate(${Math.cos(a) * s * 1.25}px, ${Math.sin(a) * s * 0.6 + 26 * u}px) rotate(${spin}deg) scaleY(1)`, opacity: 0 }
          ]
        };
      });
    }

    if (kind === 'calm') {
      go(14, () => {
        const x = c.x + rand(-1.6, 1.6) * c.r;
        const rise = rand(10, 22) * u;
        return {
          kind: 'dot', color: pick(PALETTES.calm), x, y: c.y + rand(0.6, 1.6) * c.r, duration: rand(2600, 3300), delay: rand(0, 1000), easing: 'linear', size: rand(0.7, 1.2),
          frames: [
            { transform: 'translate(0, 0)', opacity: 0 },
            { transform: `translate(${rand(-2, 2) * u}px, ${-rise * 0.4}px)`, opacity: 0.7, offset: 0.3 },
            { transform: `translate(${rand(-3, 3) * u}px, ${-rise}px)`, opacity: 0 }
          ]
        };
      });
    }

    if (kind === 'ripple') {
      for (let i = 0; i < 3; i++) {
        particles.burst(1, node => {
          return particle(node, {
            kind: 'ring', ring: c.r * 2, color: '#f2d28b', x: c.x, y: c.y, duration: 1700, delay: i * 520, easing: 'cubic-bezier(.2, .6, .35, 1)',
            frames: [{ transform: 'scale(.95)', opacity: 0.75 }, { transform: 'scale(2)', opacity: 0 }]
          });
        });
      }
      go(10, () => {
        const a = rand(0, Math.PI * 2);
        return {
          kind: 'dot', color: pick(PALETTES.gold), x: c.x + Math.cos(a) * c.r * 1.35, y: c.y + Math.sin(a) * c.r * 1.25, duration: rand(2200, 2800), delay: rand(0, 600), size: rand(0.6, 1),
          frames: [{ transform: 'translate(0, 0)', opacity: 0 }, { transform: `translate(0, ${-2 * u}px)`, opacity: 0.85, offset: 0.3 }, { transform: `translate(${rand(-2, 2) * u}px, ${-6 * u}px)`, opacity: 0 }]
        };
      });
    }

    if (kind === 'hearts') {
      go(11, () => {
        const rise = rand(24, 36) * u;
        const sway = rand(-4, 4) * u;
        return {
          kind: 'heart', text: '♥', color: pick(PALETTES.warmHearts), x: c.x + rand(-1.5, 1.5) * c.r, y: c.y + rand(1.1, 1.7) * c.r, duration: rand(2400, 3000), delay: rand(0, 1100), easing: 'linear', size: rand(1.2, 2),
          frames: [
            { transform: 'translate(0, 0) rotate(-8deg)', opacity: 0 },
            { transform: `translate(${sway}px, ${-rise * 0.35}px) rotate(6deg)`, opacity: 0.9, offset: 0.25 },
            { transform: `translate(${-sway}px, ${-rise * 0.7}px) rotate(-6deg)`, opacity: 0.8, offset: 0.65 },
            { transform: `translate(${sway}px, ${-rise}px) rotate(4deg)`, opacity: 0 }
          ]
        };
      });
    }

    if (kind === 'embers') {
      go(16, () => {
        const rise = rand(18, 36) * u;
        return {
          kind: 'dot', color: pick(PALETTES.embers), x: c.x + rand(-0.25, 0.25) * c.r, y: c.y - c.r * 0.45, duration: rand(1800, 2600), delay: rand(0, 1800), easing: 'cubic-bezier(.3, .5, .5, 1)', size: rand(0.5, 1),
          frames: [
            { transform: 'translate(0, 0)', opacity: 0 },
            { transform: `translate(${rand(-3, 3) * u}px, ${-rise * 0.3}px)`, opacity: 1, offset: 0.2 },
            { transform: `translate(${rand(-6, 6) * u}px, ${-rise}px) scale(.5)`, opacity: 0 }
          ]
        };
      });
    }

    if (kind === 'heartBurst' || kind === 'stars') {
      const isStar = kind === 'stars';
      go(isStar ? 18 : 16, () => {
        const a = isStar ? rand(0, Math.PI * 2) : rand(-Math.PI * 0.95, -Math.PI * 0.05);
        const s = rand(c.r * 1.2, c.r * 2.4);
        return {
          kind: isStar ? 'star' : 'heart', text: isStar ? '★' : '♥',
          color: isStar ? pick([...PALETTES.gold, '#ffffff']) : pick(PALETTES.hearts),
          x: c.x, y: c.y, duration: rand(2000, 2700), delay: rand(0, 100), size: isStar ? rand(1, 1.7) : rand(1.3, 2.2),
          frames: [
            { transform: 'translate(0, 0) scale(.4)', opacity: 1 },
            { transform: `translate(${Math.cos(a) * s}px, ${Math.sin(a) * s - (isStar ? 4 * u : 0)}px) scale(1) rotate(${rand(-60, 60)}deg)`, opacity: 1, offset: 0.4 },
            { transform: `translate(${Math.cos(a) * s * 1.2}px, ${Math.sin(a) * s + 18 * u}px) scale(.85) rotate(${rand(-120, 120)}deg)`, opacity: 0 }
          ]
        };
      });
    }

  }

  /* ---------- the loop ---------- */

  const rest = [];
  const keep = animation => { if (animation) rest.push(animation); return animation; };
  const release = () => { rest.splice(0).forEach(a => a.cancel()); };

  function runIntro(next) {

    show(intro);
    const s = quick ? 0.55 : 1;

    tl.move(coin, [
      { opacity: 0, transform: 'perspective(700px) translateZ(-420px) rotateY(900deg)' },
      { opacity: 1, transform: 'perspective(700px) translateZ(0) rotateY(0)' }
    ], { duration: 1200 * s, easing: 'cubic-bezier(.2, .7, .3, 1)' });
    rings.forEach((ring, i) => keep(tl.loop(ring, [{ transform: 'scale(.95)', opacity: 0.8 }, { transform: 'scale(1.7)', opacity: 0 }], { duration: 1000, delay: 1000 * s + i * 500, easing: 'ease-out' })));
    flipIn(wordsOf(introTitle), 900 * s, { stagger: 120, duration: 500 });
    tl.move(heart, [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 420, delay: 1400 * s, easing: BACK });
    tl.later(1800 * s, () => keep(tl.loop(heart, [{ transform: 'scale(1)' }, { transform: 'scale(1.14)', offset: 0.15 }, { transform: 'scale(.97)', offset: 0.28 }, { transform: 'scale(1)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 1000, easing: 'ease-in-out' })));
    flipIn(wordsOf(introSub), 1900 * s, { stagger: 80, duration: 400 });

    const end = 3400 * s;
    tl.later(end - 350, () => {
      tl.move(intro, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.1)' }], { duration: 350, easing: IN });
      fade(brand, 1, 400);
    });
    tl.later(end, () => {
      release();
      set(intro, { opacity: '', transform: '' });
      cut();
      next();
    });

  }

  function runHook(next) {

    show(hook);
    set(hook, { opacity: '1' });
    set(hookList, { opacity: '1', transform: 'none' });
    hookLines.forEach(line => set(line, { opacity: '1' }));
    set(hookFinal.parentNode, { opacity: '0', transform: 'none' });

    hookLines.forEach((line, i) => {
      flipIn(wordsOf(line), i * 750, { stagger: 70, duration: 400 });
      if (i) tl.later(i * 750, () => fade(hookLines[i - 1], 0.38, 300, 1));
    });

    tl.later(2300, () => tl.move(hookList, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-12%) scale(.8)' }], { duration: 300, easing: IN }));
    tl.later(2560, () => {
      set(hookFinal.parentNode, { opacity: '1' });
      tl.move(hookFinal.parentNode, [{ transform: 'scale(.45)' }, { transform: 'none' }], { duration: 600, easing: BACK });
      flipIn(wordsOf(hookFinal), 0, { stagger: 70, duration: 450 });
      keep(tl.loop(hookFinal.parentNode, [{ transform: 'scale(1)' }, { transform: 'scale(1.03)', offset: 0.12 }, { transform: 'scale(1)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 500, delay: 700 }));
      sound('success', { passive: true });
    });
    tl.later(4050, () => fade(hook, 0, 300, 1));
    tl.later(4350, () => { release(); cut(); next(); });

  }

  function runOptions(next) {

    show(option);
    set(option, { opacity: '1' });
    tl.move(dock, [
      { opacity: 0, transform: 'translateX(50%) perspective(900px) rotateX(32deg) translateY(60%)' },
      { opacity: 1, transform: 'translateX(50%) perspective(900px) rotateX(32deg) translateY(0)' }
    ], { duration: 450, easing: EASE });
    const sway = keep(tl.loop(visual, [
      { transform: 'translateY(0) rotateY(-9deg) rotateX(4deg)' },
      { transform: 'translateY(-3%) rotateY(9deg) rotateX(-4deg)' },
      { transform: 'translateY(0) rotateY(-9deg) rotateX(4deg)' }
    ], { duration: 3600, easing: 'ease-in-out' }));

    let index = 0;

    const one = () => {

      const o = OPTIONS[index];
      const calm = o.type === 'complaint' || o.type === 'prayer';

      option.className = `vo-scene vo-opt is-on mood-${o.mood}`;
      tileIcon.replaceChildren(icon(o.type));
      count.textContent = `${digits(index + 1)} من ${digits(OPTIONS.length)}`;
      optTitle.replaceChildren(words(o.title));
      optLine.textContent = o.line;
      chips.replaceChildren(...o.chips.map(text => h('span', { class: 'vo-chip' }, text)));
      dots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));
      set(optText, { opacity: '1', transform: 'none' });

      tl.move(tile, [
        { opacity: 0, transform: 'perspective(800px) translateZ(-320px) rotateY(-130deg)' },
        { opacity: 1, transform: 'perspective(800px) translateZ(0) rotateY(0)' }
      ], { duration: 650, easing: BACK });
      tl.move(glow, [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 600, easing: EASE });
      tl.move(count, [{ opacity: 0, transform: 'rotateX(-90deg)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 100, easing: BACK });
      flipIn(wordsOf(optTitle), 150, { stagger: 60, duration: 450 });
      tl.move(optLine, [{ opacity: 0, transform: 'translateY(30%)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 450, easing: EASE });
      [...chips.children].forEach((chip, c) => tl.move(chip, [{ opacity: 0, transform: 'rotateY(-90deg)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 700 + c * 125, easing: BACK }));
      tl.later(350, () => effect(o.effect));
      sound('tap', { passive: true });

      // the spotlight: a gold pill walks over the chips (slower for the calm ones)
      const step = calm ? 1000 : 500;
      for (let k = 0, t = 1300; t < 2700; k++, t += step) {
        tl.later(t, () => [...chips.children].forEach((chip, c) => chip.classList.toggle('is-lit', c === k % chips.children.length)));
      }
      tl.later(2700, () => [...chips.children].forEach(chip => chip.classList.remove('is-lit')));

      // out
      tl.later(2650, () => {
        tl.move(tile, [{ opacity: 1, transform: 'perspective(800px) translateZ(0) rotateY(0)' }, { opacity: 0, transform: 'perspective(800px) translateZ(-260px) rotateY(95deg)' }], { duration: 380, easing: IN });
        tl.move(glow, [{ opacity: 1 }, { opacity: 0 }], { duration: 380 });
        tl.move(optText, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-14%)' }], { duration: 380, easing: IN });
      });

      tl.later(3050, () => {
        index += 1;
        cut();
        if (index < OPTIONS.length) one();
        else {
          if (sway) sway.cancel();
          dots.forEach(dot => dot.classList.remove('is-active'));
          tl.move(dock, [
            { opacity: 1, transform: 'translateX(50%) perspective(900px) rotateX(32deg) translateY(0)' },
            { opacity: 0, transform: 'translateX(50%) perspective(900px) rotateX(32deg) translateY(60%)' }
          ], { duration: 350, easing: IN });
          release();
          next();
        }
      });

    };

    one();

  }

  function runPromise(next) {

    show(promise);
    set(promise, { opacity: '1' });
    tl.move(promise, [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: 500, easing: BACK });
    flipIn(wordsOf(promiseHead), 50, { stagger: 70, duration: 400 });

    PROMISE.forEach((text, i) => tl.later(i * 900, () => {
      if (i) {
        // one quarter turn, like a dial
        tl.move(face, [{ transform: 'rotateX(0)', opacity: 1 }, { transform: 'rotateX(90deg)', opacity: 0 }], { duration: 200, easing: IN });
        tl.later(200, () => {
          face.firstChild.textContent = text;
          tl.move(face, [{ transform: 'rotateX(-90deg)', opacity: 0 }, { transform: 'rotateX(0)', opacity: 1 }], { duration: 420, easing: BACK });
        });
      }
      else {
        face.firstChild.textContent = text;
        tl.move(face, [{ transform: 'rotateX(-90deg) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 500, delay: 200, easing: BACK });
      }
    }));

    tl.later(3700, () => tl.move(promise, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.15)' }], { duration: 350, easing: IN }));
    tl.later(4050, () => { cut(); next(); });

  }

  const cycle = () => runHook(() => runOptions(() => runPromise(cycle)));

  brand.style.opacity = '0';
  runIntro(cycle);

  /* ---------- around it: the side layer (wide screens) or the edges ---------- */

  const dialog = stage.closest('dialog');
  const wide = dialog && matchMedia('(min-width: 1024px) and (min-height: 700px)').matches;

  if (wide && !lite) {
    const side = h('div', { class: 'vo-side', 'aria-hidden': 'true' });
    dialog.append(side);
    sideLayer(tl, side, stage);
    const stop = tl.stop;
    tl.stop = () => { stop(); side.remove(); };
  }
  else {
    edge(tl, stage, { every: 1500, max: 4, items: () => ({ text: pick(['♥', '✦', '♥', '✧']), className: 'xp-edge__item--vo' }) });
  }

  return tl;

}


/**
 * The calm side layer behind the sheet: anonymous message bubbles (the
 * kind of things people send), hearts, a «رسالة جديدة» pulse, light.
 * They enter from the left, the right or the bottom corners, drift a
 * little towards the sheet and fade. Never over the sheet (they live
 * behind it), never many at once.
 */
function sideLayer(tl, layer, stage) {

  let turn = 0;
  // each side has a few lanes, so two bubbles never sit on each other
  const LANES = [0.28, 0.42, 0.56, 0.7, 0.84];
  const busy = { left: LANES.map(() => 0), right: LANES.map(() => 0) };

  tl.ambient(layer, {
    every: 1500, max: 8, edge: true, name: 'vo-side', delay: 1200,
    make: () => h('span', { class: 'vo-side__item' }),
    spawn: node => {
      const panel = stage.closest('.sheet__panel');
      const box = panel ? panel.getBoundingClientRect() : { left: innerWidth / 2 - 300, right: innerWidth / 2 + 300 };
      const gapLeft = box.left - 40;
      const gapRight = innerWidth - box.right - 40;
      turn += 1;
      const left = (turn % 2 === 1 && gapLeft > 120) || gapRight < 120;
      const room = left ? gapLeft : gapRight;
      if (room < 90) return null;

      const now = performance.now();
      const duration = rand(6500, 8500);
      const lanes = busy[left ? 'left' : 'right'];
      const free = lanes.map((until, i) => (until < now ? i : -1)).filter(i => i >= 0);
      let kind = pick(['note', 'note', 'note', 'heart', 'pulse', 'light', 'light']);
      // no free lane: only a small light, rising from the bottom
      if (!free.length) kind = 'light';
      const fromBottom = kind === 'light' || kind === 'heart' ? Math.random() < 0.5 || !free.length : false;

      node.className = `vo-side__item vo-side__item--${kind} xp-amb`;
      if (kind === 'note') {
        const [type, text] = pick(NOTES);
        node.replaceChildren(h('span', { class: 'vo-side__icon' }, icon(type)), h('span', {}, text));
      }
      else if (kind === 'pulse') {
        node.replaceChildren(h('i', { class: 'vo-side__dot' }), 'رسالة جديدة');
      }
      else node.replaceChildren(kind === 'heart' ? '♥' : '');

      const width = kind === 'note' ? Math.min(240, room - 24) : kind === 'pulse' ? 150 : 40;
      const x = left ? rand(24, Math.max(30, room - width)) : box.right + 40 + rand(0, Math.max(6, room - width - 16));
      let y = innerHeight + 10;
      if (!fromBottom) {
        const lane = pick(free);
        lanes[lane] = now + duration * 0.85;
        y = LANES[lane] * innerHeight;
      }
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.style.maxWidth = `${width}px`;

      const toward = (left ? 1 : -1) * rand(10, 34);
      // in a lane: a short rise (it stays in its lane); from the bottom: a long one
      const rise = fromBottom ? rand(innerHeight * 0.35, innerHeight * 0.55) : rand(50, 80);
      return node.animate([
        { transform: `translate(${-toward}px, 20px) scale(.92)`, opacity: 0 },
        { transform: `translate(0, ${-rise * 0.2}px) scale(1)`, opacity: kind === 'light' ? 0.8 : 1, offset: 0.18 },
        { transform: `translate(${toward * 0.6}px, ${-rise * 0.75}px) scale(1)`, opacity: kind === 'light' ? 0.6 : 0.9, offset: 0.78 },
        { transform: `translate(${toward}px, ${-rise}px) scale(.96)`, opacity: 0 }
      ], { duration, easing: 'cubic-bezier(.3, .4, .4, 1)' });
    }
  });

}
