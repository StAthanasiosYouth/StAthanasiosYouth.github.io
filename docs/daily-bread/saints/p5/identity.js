/*
 * «مناسبات كنيستنا» — the section's identity (owner 2026-11-25), a preview to approve before it is built:
 *   1. the two logos side by side: «خبزنا اليومي» (logo B, the dawn) and «مناسبات كنيستنا» (the crimson night, Abu
 *      Sefein's two swords crossed over the church, a martyr's crown where they cross)
 *   2. the section's entrance: ≈ 2.6 s, once a day on the first visit of «كنيستنا», never in between
 *   3. how an occasion appears, by its nature: our patron (swords, gold dust, the bell) · a repose (a candle's light,
 *      slow, no bell) · the Pope and the fathers (light from above, a soft chime) · a family feast (the seal turns)
 * Light on purpose: one SVG (≈ 12 KB, inlined), no new pictures, no sound files (the sounds are made by the browser,
 * Web Audio, a few ms of work), only transform/opacity animations; reduced motion → a plain fade; no sound before a tap.
 *   ?t=ms  freeze the entrance at that moment (screenshots)    &show=intro|types   one part only
 */
const q = new URLSearchParams(location.search);
const ROOT = '../../../../';
const app = document.getElementById('app');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const [B, C] = await Promise.all([ROOT + 'assets/img/bread/logo-b.svg', ROOT + 'docs/daily-bread/logo/church-a.svg'].map(u => fetch(u).then(r => r.text()).then(t => t.replace(/^<\?xml[^>]*>\s*/, ''))));
// the SVGs point at fonts and the seal relative to their own folder: here they are inlined, so from this page
const fix = (svg, from) => svg.replace(/url\('\.\.\/\.\.\/\.\.\/assets\//g, `url('${from}assets/`).replace(/href="\.\.\/\.\.\/\.\.\/assets\//g, `href="${from}assets/`);
// each inlined copy gets its own ids (the same id twice on a page points every copy at the first one)
let nth = 0;
const own = svg => { const p = 'l' + (++nth) + '-'; return { p, svg: svg.replace(/id="([^"]+)"/g, 'id="' + p + '$1"').replace(/url\(#([^)]+)\)/g,'url(#' + p + '$1)').replace(/href="#([^"]+)"/g, 'href="#' + p + '$1"') }; };
const LB = fix(B, ROOT), LC = fix(C, ROOT);
const LOGO_B = () => own(LB).svg, LOGO_C = () => own(LC).svg;

/* ---------- sounds: made in the browser, no files ---------- */
let ctx = null;
const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
function bell(at = 0, base = 392, gain = 0.22, len = 3.2) {
  const a = ac(), t = a.currentTime + at;
  [[1, 1], [2.0, .55], [2.4, .4], [3.0, .25], [4.2, .16], [5.4, .1]].forEach(([m, g]) => {
    const o = a.createOscillator(), v = a.createGain();
    o.frequency.value = base * m; o.type = 'sine';
    v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(gain * g, t + 0.006); v.gain.exponentialRampToValueAtTime(0.0001, t + len / (0.6 + m * 0.25));
    o.connect(v).connect(a.destination); o.start(t); o.stop(t + len);
  });
}
function shing(at = 0) {
  const a = ac(), t = a.currentTime + at, n = a.sampleRate * 0.6, buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  const s = a.createBufferSource(), f = a.createBiquadFilter(), v = a.createGain();
  s.buffer = buf; f.type = 'bandpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(7200, t + 0.35); f.Q.value = 6;
  v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(0.35, t + 0.02); v.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  s.connect(f).connect(v).connect(a.destination); s.start(t);
  [2637, 3951].forEach((fr, i) => { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = fr; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 - i * 0.02, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9); o.connect(g).connect(a.destination); o.start(t); o.stop(t + 1); });
}
function hum(at = 0) { // a repose: one low, warm tone, very soft
  const a = ac(), t = a.currentTime + at, o = a.createOscillator(), v = a.createGain();
  o.frequency.value = 196; o.type = 'sine'; v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(0.06, t + 0.6); v.gain.exponentialRampToValueAtTime(0.0001, t + 3);
  o.connect(v).connect(a.destination); o.start(t); o.stop(t + 3.1);
}
const chime = (at = 0) => { bell(at, 784, 0.09, 2); bell(at + 0.18, 1047, 0.07, 2); };
const SOUND = { patron: () => { shing(0.62); bell(1.05); }, repose: () => hum(0.1), pope: () => chime(0.3), family: () => { bell(0.4, 523, 0.14, 2.6); } };

/* ---------- the page ---------- */
app.innerHTML = `
  <header class="id-h"><p class="id-k">P5 · المعاينة</p><h1>هوية «مناسبات كنيستنا»</h1><p>شعار جنب «خبزنا اليومي»، ودخلة للقسم، وطريقة ظهور لكل نوع مناسبة. الأصوات بتشتغل بعد دوسة بس.</p></header>

  <section class="id-sec" id="pair"><h2>١. الشعارين جنب بعض</h2>
    <div class="id-pair"><figure>${LOGO_B()}<figcaption>خبزنا اليومي · الفجر والكلمة</figcaption></figure><span class="id-pair__line" aria-hidden="true"></span><figure>${LOGO_C()}<figcaption>مناسبات كنيستنا · سيفين أبي سيفين وإكليله فوق كنيستنا</figcaption></figure></div>
    <div class="id-bar"><span class="id-bar__chip">${LOGO_B()}</span><b>خبزنا اليومي</b><span class="id-bar__sep"></span><span class="id-bar__chip id-bar__chip--c">${LOGO_C()}</span><b>مناسبات كنيستنا</b><small>الشريط اللي فوق: الشعارين صغيرين</small></div>
  </section>

  <section class="id-sec" id="intro"><h2>٢. دخلة «كنيستنا»</h2><p>أول مرة في اليوم بس، حوالي ٢٫٦ ثانية، والصفحة جاهزة تحتها.</p>
    <button class="id-btn" type="button" data-play="intro">▶ شغّل الدخلة بالصوت</button>
    <div class="id-stage" id="stage"></div>
  </section>

  <section class="id-sec" id="types"><h2>٣. ظهور كل مناسبة حسب طبيعتها</h2>
    <div class="id-types">
      ${card('patron', 'عيد استشهاد شفيع كنيستنا', 'الشهيد العظيم أبي سيفين', '/media/2026/img-f6438158.webp', 'السيفين بيلمعوا، ونور دهبي بيعدّي، وجرس الكنيسة')}
      ${card('repose', 'ذكرى نياحة أسقفنا الراحل', 'الأنبا ثاؤفيلس أول أسقف للبحر الأحمر', '/media/2026/img-cf1afea8.webp', 'نور شمعة هادي، والظهور بطيء، ومن غير جرس')}
      ${card('pope', 'عيد جلوس قداسة البابا', 'البابا تواضروس الثاني', '/media/2026/img-bc3f23c3.webp', 'نور نازل من فوق، ونغمة خفيفة')}
      ${card('family', 'عيد شفيع أسرتنا', 'البابا أثناسيوس الرسولي', '/media/2026/img-d6052d80.webp', 'ختم الأسرة بيلف ويستقر، وجرس صغير')}
    </div>
  </section>`;
function card(type, title, who, img, note) {
  return `<article class="id-card id-card--${type}" data-type="${type}"><div class="id-card__fx" aria-hidden="true"></div>
    <div class="id-card__arch">${img ? `<img src="${ROOT.slice(0, -1)}${img}" alt="">` : `<span class="id-card__ph">${type === 'repose' ? '✝' : type === 'pope' ? '☧' : '✠'}</span>`}</div>
    <div class="id-card__body"><p class="id-card__k">${{ patron: 'شفيع كنيستنا', repose: 'تذكار', pope: 'قداسة البابا', family: 'شفيع أسرتنا' }[type]}</p><h3>${title}</h3><p>${who}</p><small>${note}</small></div>
    <button class="id-btn id-btn--sm" type="button" data-play="${type}">▶ شوف الظهور</button></article>`;
}

/* ---------- the entrance ---------- */
const E = 'cubic-bezier(.22, 1, .36, 1)';
function intro({ hold = null, sound = false } = {}) {
  const st = document.getElementById('stage');
  const L = own(LC);
  st.innerHTML = `<div class="id-in"><div class="id-in__bloom"></div><div class="id-in__logo">${L.svg}</div><div class="id-in__flash"></div><div class="id-in__dust"></div></div>`;
  const s = st.querySelector('svg'), $ = id => s.querySelector('#' + L.p + id);
  const anims = [];
  // a step's easing is per keyframe; the whole animation runs linear (else the curve squeezes the later steps)
  const A = (el, kf, o = {}) => { if (!el) return; const ease = o.easing || E; anims.push(el.animate(kf.map((k, i) => (i < kf.length - 1 && !k.easing ? { ...k, easing: ease } : k)), { fill: 'both', ...o, easing: 'linear' })); };
  if (reduced) { A(st.querySelector('.id-in__logo'), [{ opacity: 0 }, { opacity: 1 }], { duration: 600 }); return; }
  A(st.querySelector('.id-in__bloom'), [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 700 });
  A($('ring'), [{ opacity: 0, transform: 'rotate(-40deg) scale(.86)' }, { opacity: 1, transform: 'none' }], { duration: 900, delay: 100 });
  A($('night-sky'), [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 150 });
  A($('halo-glow'), [{ opacity: 0, transform: 'scale(.3)' }, { opacity: .75, transform: 'none' }], { duration: 900, delay: 500 });
  A($('stars'), [{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 500 });
  // the swords fly in from both sides and meet with a flash (≈ 0.62 s, the «shing»)
  A($('sword-a').parentNode, [{ transform: 'translate(-420px, 160px) rotate(-60deg)', opacity: 0 }, { opacity: 1, offset: .3 }, { transform: 'translate(500px, 515px) rotate(-36deg) scale(.9) translate(-500px, -530px)', opacity: 1 }], { duration: 560, delay: 120, easing: 'cubic-bezier(.5, 0, .2, 1.25)' });
  A($('sword-b').parentNode, [{ transform: 'translate(1420px, 160px) rotate(60deg)', opacity: 0 }, { opacity: 1, offset: .3 }, { transform: 'translate(500px, 515px) rotate(36deg) scale(.9) translate(-500px, -530px)', opacity: 1 }], { duration: 560, delay: 120, easing: 'cubic-bezier(.5, 0, .2, 1.25)' });
  A(st.querySelector('.id-in__flash'), [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1)', offset: .25 }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 650, delay: 640 });
  A($('crown'), [{ transform: 'translate(500px, 380px) scale(.62)', opacity: 0 }, { transform: 'translate(500px, 486px) scale(.62)', opacity: 1 }], { duration: 600, delay: 900, easing: 'cubic-bezier(.34, 1.56, .64, 1)' });
  A($('hills'), [{ transform: 'translateY(120px)' }, { transform: 'none' }], { duration: 700, delay: 700 });
  A($('church'), [{ transform: 'translateY(200px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 800, delay: 820 });
  A($('windows'), [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 1350 });
  A($('title'), [{ opacity: 0, transform: 'translateY(-26px) scale(1.08)' }, { opacity: 1, transform: 'none' }], { duration: 650, delay: 1250 });
  A($('tagline'), [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 1650 });
  A($('family-seal'), [{ opacity: 0, transform: 'rotate(-90deg)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 1750 });
  A(st.querySelector('.id-in__dust'), [{ opacity: 0 }, { opacity: 1, offset: .3 }, { opacity: 0 }], { duration: 1600, delay: 700 });
  A(st.querySelector('.id-in__logo'), [{ transform: 'none' }, { transform: 'none', offset: .8 }, { transform: 'translate(0, -34%) scale(.26)', opacity: 1 }], { duration: 2600 });
  A(st.querySelector('.id-in'), [{ opacity: 1 }, { opacity: 1, offset: .82 }, { opacity: 0 }], { duration: 2600 });
  if (hold != null) anims.forEach(a => { a.pause(); a.currentTime = hold; });
  else if (sound) { shing(0.62); bell(1.0); bell(1.85, 392, 0.12); }
}
function reveal(type) {
  const c = app.querySelector(`.id-card--${type}`);
  c.classList.remove('is-in'); void c.offsetWidth; c.classList.add('is-in');
  if (!reduced) SOUND[type]();
}
app.addEventListener('click', e => {
  const b = e.target.closest('[data-play]'); if (!b) return;
  if (b.dataset.play === 'intro') intro({ sound: true }); else reveal(b.dataset.play);
});
if (q.get('t') != null) intro({ hold: +q.get('t') });
else intro({ hold: 2050 });
if (q.get('show')) document.querySelectorAll('.id-sec').forEach(s => { s.hidden = s.id !== q.get('show') && !(q.get('show') === 'types' && s.id === 'types'); });
if (q.get('reveal')) { app.querySelectorAll('.id-card').forEach(c => c.classList.add('is-in', 'is-held')); }
document.documentElement.dataset.ready = '1';
