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

/* ---------- sounds (owner 2026-11-25: simple, calm, elegant, spiritual; nothing loud or showy) ----------
 * Made in the browser (Web Audio), no files: a soft far church bell, a low warm drone, a gentle two-note chime, and a
 * slow phrase in the church's mode, played softly like a cantor's opening. Quiet master volume, a soft room echo,
 * slow attacks. The real hymn openings (Abu Sefein's doxology, Pope Athanasius) wait for the owner's OK to download
 * and the right to use them; until then these stand in.
 */
let ctx = null, room = null, out = null;
function ac() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  out = ctx.createGain(); out.gain.value = 0.55; out.connect(ctx.destination);
  // a soft room: two short feedback echoes, low-passed
  room = ctx.createGain(); room.gain.value = 0.28;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
  [0.11, 0.23].forEach(t => { const d = ctx.createDelay(1); d.delayTime.value = t; const fb = ctx.createGain(); fb.gain.value = 0.38; d.connect(fb).connect(d); room.connect(d); d.connect(lp); });
  lp.connect(out);
  return ctx;
}
const send = node => { node.connect(out); node.connect(room); };
/* a far church bell: few partials, soft strike, long gentle decay */
function bell(at = 0, base = 220, gain = 0.09, len = 4.5) {
  const a = ac(), t = a.currentTime + at;
  [[1, 1], [2.0, .4], [2.76, .22], [5.4, .06]].forEach(([m, g]) => {
    const o = a.createOscillator(), v = a.createGain();
    o.type = 'sine'; o.frequency.value = base * m;
    v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(gain * g, t + 0.02); v.gain.exponentialRampToValueAtTime(0.0001, t + len / (0.8 + m * 0.3));
    o.connect(v); send(v); o.start(t); o.stop(t + len);
  });
}
/* a slow, soft phrase in the church's mode, like a cantor's first words (sine + a little warmth) */
function phrase(at, notes, { step = 0.42, gain = 0.07 } = {}) {
  const a = ac(); let t = a.currentTime + at;
  for (const [f, d = 1] of notes) {
    const o = a.createOscillator(), o2 = a.createOscillator(), v = a.createGain(), dur = step * d;
    o.type = 'sine'; o2.type = 'triangle'; o.frequency.value = f; o2.frequency.value = f; o2.detune.value = 4;
    const g2 = a.createGain(); g2.gain.value = 0.25;
    v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(gain, t + 0.12); v.gain.setValueAtTime(gain, t + dur * 0.7); v.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
    o.connect(v); o2.connect(g2).connect(v); send(v); o.start(t); o2.start(t); o.stop(t + dur + 0.6); o2.stop(t + dur + 0.6);
    t += dur;
  }
}
/* a low warm drone, for a repose */
function drone(at = 0, f = 146.8, len = 3.6, gain = 0.045) {
  const a = ac(), t = a.currentTime + at;
  [f, f * 1.5].forEach((fr, i) => { const o = a.createOscillator(), v = a.createGain(); o.type = 'sine'; o.frequency.value = fr; v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(gain * (i ? .4 : 1), t + 1.1); v.gain.exponentialRampToValueAtTime(0.0001, t + len); o.connect(v); send(v); o.start(t); o.stop(t + len + 0.1); });
}
const chime = (at = 0) => { bell(at, 659, 0.035, 2.4); bell(at + 0.5, 880, 0.028, 2.4); };
// D (ré) mode, as many Coptic hymns: D E F G A
const N = { D: 293.7, E: 329.6, F: 349.2, G: 392, A: 440 };
const SOUND = {
  patron: () => { bell(0.1, 196, 0.08); phrase(0.7, [[N.D], [N.F], [N.G, 1.5], [N.F], [N.E], [N.D, 2]]); },  // one far bell, then a short soft phrase
  repose: () => drone(0.1),                                                                      // a low drone only, no bell
  pope: () => { chime(0.2); phrase(1.0, [[N.A], [N.G], [N.A, 2]], { gain: 0.05, step: 0.5 }); },     // a soft chime, three slow notes
  family: () => { bell(0.2, 262, 0.07, 3.6); phrase(0.9, [[N.G], [N.A], [N.G, 2]], { gain: 0.05 }); }
};

/* ---------- the page ---------- */
app.innerHTML = `
  <header class="id-h"><p class="id-k">P5 · المعاينة</p><h1>هوية «مناسبات كنيستنا»</h1><p>شعار جنب «خبزنا اليومي»، ودخلة للقسم، وطريقة ظهور لكل نوع مناسبة. الأصوات هادية وروحانية، وبتشتغل بعد دوسة بس.</p></header>

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
      ${card('patron', 'عيد استشهاد شفيع كنيستنا', 'الشهيد العظيم أبي سيفين', '/media/2026/img-f6438158.webp', '«تعالوا نتهلل بالألحان» من المديح، وكلامه بيتكتب مع الصوت، ولما يتقال «فيلوباتير مارقوريوس» الصوت يهدى والكارت يظهر')}
      ${card('repose', 'ذكرى نياحة أسقفنا الراحل', 'الأنبا ثاؤفيلس أول أسقف للبحر الأحمر', '/media/2026/img-cf1afea8.webp', 'نور شمعة هادي، والظهور بطيء، ونغمة واطية بس من غير جرس')}
      ${card('pope', 'عيد جلوس قداسة البابا', 'البابا تواضروس الثاني', '/media/2026/img-bc3f23c3.webp', 'نور نازل من فوق، ورنتين رقاق وتلات نغمات بطيئة')}
      ${card('family', 'عيد شفيع أسرتنا', 'البابا أثناسيوس الرسولي', '/media/2026/img-d6052d80.webp', '«أثناسيوس يا رسول» من المديح بنفس الطريقة، لحد «بنيوت أفا أثناسيوس»')}
    </div>
  </section>`;
function card(type, title, who, img, note) {
  return `<article class="id-card id-card--${type}" data-type="${type}"><div class="id-card__fx" aria-hidden="true"></div>
    <div class="id-card__arch">${img ? `<img src="${ROOT.slice(0, -1)}${img}" alt="">` : `<span class="id-card__ph">${type === 'repose' ? '✝' : type === 'pope' ? '☧' : '✠'}</span>`}</div>
    <div class="id-card__body"><p class="id-card__k">${{ patron: 'شفيع كنيستنا', repose: 'تذكار', pope: 'قداسة البابا', family: 'شفيع أسرتنا' }[type]}</p><h3>${title}</h3><p>${who}</p><small>${note}</small></div>
    <button class="id-btn id-btn--sm" type="button" data-play="${type}">▶ شوف الظهور</button></article>`;
}

/* ---------- an event (owner 2026-11-25): the opening of the hymn sung in church, its words written with the voice ----------
 * Abu Sefein: «تعالوا نتهلل بالألحان» … until «فيلوباتير مارقوريوس» (CTV, «مديح القديس فيلوباتير مرقوريوس أبو سيفين»).
 * Pope Athanasius: «أثناسيوس يا رسول» … until «بنيوت أفا أثناسيوس» (ME Sat, «مديح لتمجيد البابا أثناسيوس الرسولي»).
 * The clip ends right at the end of the name (a short ≈ 0.6 s fade, nothing sung after it); the saint's picture shows
 * faintly while the name is sung; the card comes as the voice fades. No channel line (owner). The word times are the recording's own (faster-whisper,
 * checked against the hymn's text). No sound allowed → the words still come, by the clock.
 */
const OPEN = {
  patron: { src: 'sound/mercurius-open', from: 3.65, end: 21.6, face: '/media/2026/img-f6438158.webp', lines: [
    [['تعالوا', 4.05], ['نتهلل', 5.03], ['بالألحان', 6.53]], [['ونرتل', 8.11], ['للفادي', 9.93], ['الديان', 11.15]],
    [['في', 12.47], ['عيد', 12.87], ['الشهيد', 13.31], ['بطل', 14.87], ['الإيمان', 15.43]], [['فيلوباتير', 16.81], ['مارقوريوس', 19.15]]] },
  family: { src: 'sound/athanasius-open', from: 8.05, end: 21.45, face: '/media/2026/img-d6052d80.webp', lines: [
    [['أثناسيوس', 8.46], ['يا', 10.88], ['رسول', 11.18]], [['حبنا', 12.48], ['لك', 13.78], ['على', 14.62], ['طول', 14.96]],
    [['كلنا', 15.58], ['بأجمعنا', 16.42], ['نقول', 18.0]], [['بنيوت', 18.88], ['أفا', 19.78], ['أثناسيوس', 20.42]]] }
};
const pickSrc = base => (document.createElement('audio').canPlayType('audio/ogg; codecs=opus') ? base + '.opus?v=2' : base + '.m4a?v=2');
function event(type, { at = null } = {}) {
  const o = OPEN[type], c = app.querySelector('.id-card--' + type);
  c.classList.remove('is-in', 'is-done'); c.classList.add('is-event');
  c.querySelector('.id-ev')?.remove();
  c.insertAdjacentHTML('afterbegin', `<div class="id-ev" aria-hidden="true">${o.lines.map((l, i) => `<p class="id-ev__l${i === o.lines.length - 1 ? ' id-ev__l--name' : ''}">${l.map(([w, t]) => `<span data-t="${(t - o.from).toFixed(2)}">${w}</span>`).join(' ')}</p>`).join('')}</div>`);
  // owner: when the name is sung, the saint's picture comes in, faintly, behind the words
  c.querySelector('.id-ev').insertAdjacentHTML('afterbegin', `<img class="id-ev__face" src="${ROOT.slice(0, -1)}${o.face}" alt="">`);
  const ev = c.querySelector('.id-ev'), words = [...ev.querySelectorAll('[data-t]')], last = o.end - o.from;
  const finish = () => { ev.classList.add('is-out'); c.classList.remove('is-event'); c.classList.add('is-in', 'is-done'); setTimeout(() => ev.remove(), 1200); };
  const nameAt = +ev.querySelector('.id-ev__l--name [data-t]').dataset.t, face = ev.querySelector('.id-ev__face');
  const paint = now => { words.forEach(w => w.classList.toggle('on', now >= +w.dataset.t)); face.classList.toggle('on', now >= nameAt); return now >= last; };
  if (at != null) { paint(at); if (at >= last) finish(); return; }
  const audio = new Audio(pickSrc(o.src)); audio.volume = 0.8;
  const t0 = performance.now(); let playing = false;
  audio.play().then(() => { playing = true; }, () => {});
  const tick = () => { const now = playing ? audio.currentTime : (performance.now() - t0) / 1000; if (paint(now)) finish(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
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
  A($('sword-a').parentNode, [{ transform: 'translate(-420px, 160px) rotate(-60deg)', opacity: 0 }, { opacity: 1, offset: .3 }, { transform: 'translate(500px, 470px) rotate(-40deg) scale(.62) translate(-500px, -530px)', opacity: 1 }], { duration: 560, delay: 120, easing: 'cubic-bezier(.5, 0, .2, 1.25)' });
  A($('sword-b').parentNode, [{ transform: 'translate(1420px, 160px) rotate(60deg)', opacity: 0 }, { opacity: 1, offset: .3 }, { transform: 'translate(500px, 470px) rotate(40deg) scale(.62) translate(-500px, -530px)', opacity: 1 }], { duration: 560, delay: 120, easing: 'cubic-bezier(.5, 0, .2, 1.25)' });
  A(st.querySelector('.id-in__flash'), [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1)', offset: .25 }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 650, delay: 640 });
  A($('crown'), [{ transform: 'translate(500px, 370px) scale(.72)', opacity: 0 }, { transform: 'translate(500px, 458px) scale(.72)', opacity: 1 }], { duration: 600, delay: 900, easing: 'cubic-bezier(.34, 1.56, .64, 1)' });
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
  else if (sound) { drone(0, 146.8, 2.6, 0.03); bell(0.62, 196, 0.07); }   // calm: a low swell, one far bell as the swords meet
}
function reveal(type) {
  const c = app.querySelector(`.id-card--${type}`);
  c.classList.remove('is-in'); void c.offsetWidth; c.classList.add('is-in');
  if (!reduced) SOUND[type]();
}
app.addEventListener('click', e => {
  const b = e.target.closest('[data-play]'); if (!b) return;
  if (b.dataset.play === 'intro') intro({ sound: true }); else if (OPEN[b.dataset.play]) event(b.dataset.play); else reveal(b.dataset.play);
});
if (q.get('t') != null) intro({ hold: +q.get('t') });
else intro({ hold: 2050 });
if (q.get('show')) document.querySelectorAll('.id-sec').forEach(s => { s.hidden = s.id !== q.get('show') && !(q.get('show') === 'types' && s.id === 'types'); });
if (q.get('event')) event(q.get('event'), { at: q.get('at') != null ? +q.get('at') : null });
if (q.get('reveal')) { app.querySelectorAll('.id-card').forEach(c => c.classList.add('is-in', 'is-held')); }
document.documentElement.dataset.ready = '1';
