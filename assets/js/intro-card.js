/**
 * The card intro (site redesign W3, approved S1, docs/site-redesign/intro.html): for someone with no account on
 * this device yet, each visit. intro.js decided before the first paint (<html data-intro="card">); main.js loads
 * this module.
 *
 *  - The gate (new look, 2026-11-13): «أهلاً بيك», the family's logo big in the middle, and behind it, through the
 *    dark, the site itself sliding slowly by (its services, activities, videos, the meeting's games and plays). The
 *    press on the logo is the touch the browser needs before it allows sound.
 *  - Then S1 exactly: the card slams in and flips, the iPhone rises and scans its code, the camera dives into the
 *    code, the church and the two saints, the logo with its shockwave, the name, the slogan, the welcome, and
 *    «اعمل حسابك في دقيقة». A tap never cuts it short (owner, 2026-11-11). «ادخل الموقع» opens the home page under
 *    it; «اعمل حساب» the account page.
 *  - Laid out by the screen's shape (portrait / landscape), every size in viewport units; a resize re-lays-out in
 *    place at the same moment.
 * ?ic-freeze=<ms> (with ?ic=1 to force it) holds one moment, no gate and no sound: for the S1 comparison shots.
 */

import { soundEnabled } from './sound.js';

const ROOT = new URL('../../', import.meta.url);
const asset = path => new URL(path, ROOT).href;
const EXPO = 'cubic-bezier(.16,1,.3,1)';
const INOUT = 'cubic-bezier(.76,0,.24,1)';
const IN = 'cubic-bezier(.7,0,.84,0)';
const T = 6900;
const RATE = 0.68;            // S1 played slower after the welcome, on the music (owner, 2026-11-13); 1 for the comparison shots

function weak() {
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  return (cores <= 4 && memory <= 4) || memory <= 2;
}

function sheet() {
  if (document.querySelector('link[data-intro-css]')) return Promise.resolve();
  return new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = asset('assets/css/intro.css');
    link.dataset.introCss = '';
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    document.head.append(link);
  });
}

function markup() {
  const logo = asset('assets/img/intro/logo-848.webp');   // sharp on a 3× phone screen (logo-512 looked soft)
  const img = name => asset(`assets/img/intro/${name}.webp`);
  return `
<div class="ic__room"></div>
<div class="ic__site"></div>
<div class="ic__world"><div class="ic__church"></div><div class="ic__saint ic__saint--athanasius"><img src="${img('saint-athanasius')}" alt=""><span class="ic__plaque"><b>القديس أثناسيوس الرسولي</b><i>حامي الإيمان</i></span></div><div class="ic__saint ic__saint--sefein"><img src="${img('saint-sefein')}" alt=""><span class="ic__plaque"><b>الشهيد العظيم أبي سيفين</b><i>فيلوباتير مرقوريوس</i></span></div></div>
<canvas class="ic__fx"></canvas>
<div class="ic__rig">
  <div class="ic__card">
    <div class="ic__face ic__face--logo"><img src="${img('card-back')}" alt=""><span class="ic__sheen"></span></div>
    <div class="ic__face ic__face--qr"><img src="${img('card-front')}" alt=""><span class="ic__sheen"></span></div>
    <span class="ic__qrmark"></span>
  </div>
  <div class="ic__phone"><div class="ic__screen">
    <span class="ic__island"></span>
    <div class="ic__status"><span>8:00</span><span><svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg viewBox="0 0 16 12"><path d="M8 11.5 10.6 8.6a3.7 3.7 0 0 0-5.2 0Zm-4.6-5a6.6 6.6 0 0 1 9.2 0l1.5-1.6a8.8 8.8 0 0 0-12.2 0ZM.4 3.4a10.8 10.8 0 0 1 15.2 0L17 1.8a13 13 0 0 0-18 0Z"/></svg><svg viewBox="0 0 27 12"><rect x=".5" y=".5" width="22" height="11" rx="3" fill="none" stroke="#fff" stroke-opacity=".5"/><rect x="2" y="2" width="16" height="8" rx="1.6"/><rect x="24" y="4" width="2" height="4" rx="1" fill-opacity=".5"/></svg></span></div>
    <div class="ic__lock"><b>8:00</b><small>الأحد ٨ نوفمبر</small><i></i></div>
    <div class="ic__cam"><div class="ic__feed"></div>
      <div class="ic__finder"><i></i><i></i><i></i><i></i><span class="ic__laser"></span></div>
      <div class="ic__pill"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1a1400"/><path d="M12 4.5 14 12l-2 7.5L10 12Z" fill="#ffd60a"/><path d="M4.5 12 12 10l7.5 2L12 14Z" fill="#ffd60a" opacity=".55"/></svg><div><b>افتح «أسرة البابا أثناسيوس»</b><small>stathanasiosyouth.github.io</small></div></div>
      <div class="ic__modes"><span>فيديو</span><em>صورة</em><span>بورتريه</span></div><span class="ic__shutter"></span>
    </div>
    <span class="ic__glass"></span>
  </div></div>
</div>
<span class="ic__flare"></span>
<div class="ic__flash"></div>
<div class="ic__brand">
  <div class="ic__logo"><span class="ic__wave"></span><span class="ic__wave ic__wave--2"></span><img src="${logo}" alt=""></div>
  <p class="ic__name">أسرة البابا أثناسيوس</p>
  <p class="ic__sub">لخدمة شعب كنيستها الحبيبة في سفاجا</p>
  <p class="ic__slogan">كل اللي يخص اجتماعنا… في مكان واحد</p>
  <p class="ic__welcome">مرحبًا بك في تطبيق <b>أسرة البابا أثناسيوس</b> لخدمة شعب سفاجا</p>
  <div class="ic__cta"><p><b>اعمل حسابك في دقيقة</b>علشان تتابع حجوزاتك ونقطك والمسابقات، ويوصلك كل جديد.</p><div class="ic__row"><a class="is-main" href="${asset('account/')}">اعمل حساب</a><button type="button" data-enter>ادخل الموقع</button></div></div>
</div>
<span class="ic__dawn" aria-hidden="true"></span>
<div class="ic__gate">
  <video class="ic__film" muted playsinline loop preload="none" aria-hidden="true" tabindex="-1"></video>
  <div class="ic__veil"></div><div class="ic__dust"></div>
  <div class="ic__hall">
    <p class="ic__hello">أهلاً بيك<small>في أسرة البابا أثناسيوس</small></p>
    <button class="ic__seal" type="button" aria-label="ادخل — أسرة البابا أثناسيوس"><img src="${logo}" alt=""></button>
    <p class="ic__hint">دوس على اللوجو علشان تبدأ الرحلة في الموقع</p>
  </div>
  <div class="ic__shutters" aria-hidden="true"></div>
  <div class="ic__say" aria-live="polite"></div>
</div>`;
}

/* ================= sound (WebAudio): mix bus + synthetic hall reverb + glue compressor (S1) ================= */
function makeSound() {
  let AC, bus, verb;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const comp = AC.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.25;
    const out = AC.createGain(); out.gain.value = 1.6; comp.connect(out); out.connect(AC.destination);
    bus = AC.createGain(); bus.connect(comp);
    const len = AC.sampleRate * 2.4, imp = AC.createBuffer(2, len, AC.sampleRate);
    for (let c = 0; c < 2; c++) { const d = imp.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    const conv = AC.createConvolver(); conv.buffer = imp; verb = AC.createGain(); verb.gain.value = 0.32; verb.connect(conv); conv.connect(comp);
    if (AC.state === 'suspended') AC.resume();
  }
  catch { return null; }
  const node = (at, pan, wet) => { const g = AC.createGain(), p = AC.createStereoPanner ? AC.createStereoPanner() : null; if (p) { p.pan.setValueAtTime(pan || 0, at); g.connect(p); p.connect(bus); if (wet) p.connect(verb); } else { g.connect(bus); if (wet) g.connect(verb); } return { g, p }; };
  const osc = (type, f1, f2, at, dur, vol, o = {}) => { const t = AC.currentTime + at, x = AC.createOscillator(), n = node(t, o.pan, o.wet); x.type = type; x.frequency.setValueAtTime(f1, t); if (f2) x.frequency.exponentialRampToValueAtTime(f2, t + (o.glide || dur)); n.g.gain.setValueAtTime(0, t); n.g.gain.linearRampToValueAtTime(vol, t + (o.atk || 0.005)); n.g.gain.exponentialRampToValueAtTime(0.0001, t + dur); x.connect(n.g); x.start(t); x.stop(t + dur + 0.1); };
  const noise = (at, dur, type, f1, f2, vol, o = {}) => { const t = AC.currentTime + at, b = AC.createBuffer(1, Math.ceil(AC.sampleRate * dur), AC.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = AC.createBufferSource(), f = AC.createBiquadFilter(), n = node(t, o.pan, o.wet); s.buffer = b; f.type = type; f.Q.value = o.q || 0.9; f.frequency.setValueAtTime(f1, t); f.frequency.exponentialRampToValueAtTime(f2, t + dur); n.g.gain.setValueAtTime(0, t); n.g.gain.linearRampToValueAtTime(vol, t + dur * (o.peak || 0.1)); n.g.gain.exponentialRampToValueAtTime(0.0001, t + dur); if (n.p && o.pan2 != null) n.p.pan.linearRampToValueAtTime(o.pan2, t + dur); s.connect(f); f.connect(n.g); s.start(t); };
  const bell = (f, at, dur, vol) => { [1, 2.756, 5.404, 8.933].forEach((k, i) => { osc('sine', f * k, 0, at, dur / (1 + i * 0.8), vol / (1 + i * 1.6), { wet: true, pan: (i % 2 ? 0.25 : -0.25) }); }); };
  const SFX = [
    [0, () => { osc('sine', 150, 38, 0, 0.9, 0.55, { glide: 0.5 }); noise(0, 0.5, 'lowpass', 900, 120, 0.35, { wet: true }); osc('sawtooth', 55, 0, 0, 1.6, 0.05, { wet: true }); }],
    [40, () => { noise(0, 0.9, 'highpass', 6000, 9000, 0.05, { wet: true }); bell(1568, 0.05, 1.4, 0.05); }],
    [780, () => { noise(0, 0.75, 'bandpass', 300, 3800, 0.3, { pan: -0.8, pan2: 0.8, q: 0.7, peak: 0.55 }); osc('sine', 90, 180, 0, 0.7, 0.08); }],
    [1650, () => { noise(0, 0.45, 'bandpass', 1400, 500, 0.12, { pan: 0.3 }); osc('sine', 1900, 0, 0.4, 0.07, 0.12); osc('sine', 2600, 0, 0.44, 0.06, 0.06); }],
    [2200, () => { osc('square', 1200, 0, 0, 0.04, 0.04); osc('square', 1600, 0, 0.05, 0.04, 0.03); }],
    [2400, () => { osc('sine', 700, 2400, 0, 0.5, 0.06, { glide: 0.5, wet: true }); for (let i = 0; i < 6; i++) osc('square', 2200 + i * 140, 0, i * 0.07, 0.025, 0.025); }],
    [2950, () => { [880, 1318.5, 1760].forEach((f, i) => { osc('triangle', f, 0, i * 0.055, 0.6, 0.09, { wet: true }); }); noise(0, 0.4, 'highpass', 5000, 8000, 0.05); }],
    [3200, () => { noise(0, 0.75, 'highpass', 300, 7000, 0.22, { peak: 0.95, wet: true }); osc('sawtooth', 110, 880, 0, 0.78, 0.05, { glide: 0.75 }); osc('sine', 220, 1760, 0, 0.78, 0.05, { glide: 0.75 }); }],
    [3920, () => { osc('sine', 120, 34, 0, 1.4, 0.7, { glide: 0.6 }); noise(0, 0.8, 'lowpass', 1500, 100, 0.3, { wet: true }); [196, 293.7, 392, 493.9].forEach((f, i) => { bell(f * 2, 0.02 + i * 0.015, 3.2, 0.055); }); }],
    [4400, () => { noise(0, 1.2, 'bandpass', 2500, 6000, 0.03, { wet: true, pan: -0.4, pan2: 0.4 }); }],
    [6350, () => { osc('sine', 1046.5, 0, 0, 0.5, 0.05, { wet: true }); osc('sine', 1568, 0, 0.08, 0.6, 0.04, { wet: true }); }]
  ];
  let timers = [];
  return {
    AC, osc, noise, bell,
    play(rate = 1) { timers = SFX.map(([at, fn]) => setTimeout(() => { try { fn(); } catch { /* a missing node: silence */ } }, at / rate)); },
    stop() { timers.forEach(clearTimeout); try { setTimeout(() => AC.close(), 1500); } catch { /* already closed */ } }
  };
}

export function playCardIntro({ onEnd } = {}) {
  const html = document.documentElement;
  const Q = new URLSearchParams(location.search);
  const FREEZE = Q.get('ic-freeze') != null ? Number(Q.get('ic-freeze')) : null;
  const light = weak();

  return sheet().then(() => {
    const root = document.createElement('div');
    root.className = 'ic' + (light ? ' is-light' : '');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'أهلاً بيك في أسرة البابا أثناسيوس');
    root.innerHTML = markup();
    document.body.append(root);
    const $ = s => root.querySelector(s);
    const main = document.getElementById('main');
    const bar = document.getElementById('topbar');
    for (const n of [main, bar]) n && n.setAttribute('inert', '');

    let anims = [], L = {}, W = 0, H = 0, QXr = 0, QYr = 0, raf = 0, started = null, done = false, sound = null, fadeMusic = () => {}, rate = 1;
    const burstAt = 2950, hitAt = 3920;
    const G = (sel, kf, o) => (typeof sel === 'string' ? $(sel) : sel).animate(kf, Object.assign({ fill: 'both', easing: EXPO }, o));
    const A = (sel, kf, o) => { const n = typeof sel === 'string' ? $(sel) : sel; const a = n.animate(kf, Object.assign({ fill: 'both', easing: EXPO }, o)); a.playbackRate = rate; anims.push(a); return a; };

    /* particles (deterministic by time) */
    const cv = $('.ic__fx'), ctx = cv.getContext('2d');
    function sizeCanvas() { const dpr = Math.min(light ? 1 : 2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    const rnd = i => { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); };
    function drawFx(t) {
      ctx.clearRect(0, 0, W, H);
      const dots = light ? 20 : 40;
      for (let i = 0; i < dots; i++) { const y = (rnd(i) - (0.01 + rnd(i + 50) * 0.02) * t / 1000 + 3) % 1, a = (0.05 + 0.2 * (0.5 + 0.5 * Math.sin(i + t / 420))) * (t > hitAt ? 0.6 : 1); ctx.fillStyle = 'rgba(227,207,159,' + a.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(rnd(i + 9) * W, y * H, 0.5 + rnd(i + 3) * 1.4, 0, 6.283); ctx.fill(); }
      const burst = (t0, cx, cy, n, speed, life) => {
        const k = (t - t0) / life; if (k <= 0 || k >= 1) return;
        for (let j = 0; j < n; j++) { const ang = rnd(j + t0) * 6.283, sp = (0.35 + rnd(j * 3 + t0) * 0.65) * speed, d = sp * (1 - Math.pow(1 - k, 3)); ctx.fillStyle = 'rgba(240,222,176,' + (1 - k).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, (1 - k) * (1 + rnd(j) * 2.2), 0, 6.283); ctx.fill(); }
      };
      burst(burstAt, W / 2 + QXr, H / 2 + QYr, light ? 24 : 46, Math.min(W, H) * 0.22, 700);
      const lr = $('.ic__logo').getBoundingClientRect();
      burst(hitAt, lr.left + lr.width / 2, lr.top + lr.height / 2, light ? 40 : 80, Math.max(W, H) * 0.45, 1300);
    }

    /* layout: sizes from the screen's shape */
    function placeChurch() {
      const ch = $('.ic__church');
      if (L.portrait) { ch.style.backgroundSize = ''; ch.style.backgroundPosition = ''; return; }
      const r = $('.ic__logo').getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const k = Math.max(W / 1134, H / 543) * 1.18;
      ch.style.backgroundSize = (1134 * k) + 'px auto';
      ch.style.backgroundPosition = (cx - 567 * k) + 'px ' + (cy - 160 * k) + 'px';
    }
    function layout() {
      sizeCanvas();
      const portrait = W / H < 0.8;
      let cw, s, rz, pw;
      if (portrait) {
        cw = Math.min(0.9 * W, 760);
        const len = Math.min(0.8 * H, 0.9 * W * 1134 / 543);
        s = len / cw; rz = 84;
        pw = Math.min(0.44 * W, 0.24 * H, 330);
      }
      else {
        cw = Math.min(0.62 * W, 0.6 * H * 1134 / 543, 1500);
        s = 1.06; rz = -3;
        pw = Math.min(cw * 0.34, 0.5 * H * 71.6 / 147.6);
      }
      const ch = cw * 543 / 1134;
      const qx = -0.2376 * cw, qy = -0.017 * ch, r = rz * Math.PI / 180;
      L = { portrait, cw, s, rz, pw, QX: s * (qx * Math.cos(r) - qy * Math.sin(r)), QY: s * (qx * Math.sin(r) + qy * Math.cos(r)) };
      QXr = L.QX; QYr = L.QY;
      root.style.setProperty('--cw', cw + 'px');
      root.style.setProperty('--pw', pw + 'px');
      placeChurch();
    }
    const tf = (z, rz, sc, rx, ry) => `translateZ(${z}px) rotateZ(${rz}deg) scale(${sc}) rotateX(${rx}deg) rotateY(${ry}deg)`;

    function build() {
      anims.forEach(a => a.cancel()); anims = [];
      layout();
      const s = L.s, rz = L.rz, PX = L.QX, PY = L.QY + (L.portrait ? 0.06 * H : 0.02 * L.cw), prz = L.portrait ? -6 : -4;
      A('.ic__card', [
        { offset: 0, opacity: 0, transform: tf(-1400, -8, 1, 28, -50), easing: EXPO },
        { offset: 0.087, opacity: 1 },
        { offset: 0.35, opacity: 1, transform: tf(0, 0, 1, 6, 0), easing: 'linear' },
        { offset: 0.39, transform: tf(0, 0, 1, 6, 0), easing: INOUT },
        { offset: 0.8, opacity: 1, transform: tf(0, 0, 1, 0, 180), easing: EXPO },
        { offset: 1, opacity: 1, transform: tf(0, rz, s, 0, 180) }
      ], { duration: 2000, easing: 'linear', fill: 'forwards' });
      A('.ic__flare', [{ opacity: 0, transform: 'scaleX(.2)' }, { opacity: 1, transform: 'scaleX(1)', offset: 0.3 }, { opacity: 0, transform: 'scaleX(1.2)' }], { duration: 600, delay: 560, easing: 'ease-out' });
      A(root, [{ transform: 'none' }, { transform: 'translate(0,6px)', offset: 0.2 }, { transform: 'translate(-4px,-3px)', offset: 0.45 }, { transform: 'translate(2px,2px)', offset: 0.7 }, { transform: 'none' }], { duration: 320, delay: 620, easing: 'linear', fill: 'none' });
      A('.ic__face--logo .ic__sheen', [{ transform: 'translateX(-140%)' }, { transform: 'translateX(140%)' }], { duration: 600, delay: 450, easing: 'ease-in-out' });
      A('.ic__face--logo', [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], { duration: 820, delay: 780, easing: INOUT });
      A('.ic__face--qr', [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }], { duration: 820, delay: 780, easing: INOUT });
      A('.ic__face--qr .ic__sheen', [{ transform: 'translateX(-140%)' }, { transform: 'translateX(140%)' }], { duration: 600, delay: 1500, easing: 'ease-in-out' });
      A('.ic__phone', [{ opacity: 0, transform: `translate(${PX}px, ${PY + 0.7 * H}px) rotate(${prz - 10}deg)` }, { opacity: 1, transform: `translate(${PX}px, ${PY}px) rotate(${prz}deg)` }], { duration: 620, delay: 1650 });
      A('.ic__lock', [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.06)' }], { duration: 260, delay: 2150, easing: 'ease-in' });
      A('.ic__cam', [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 2180 });
      A('.ic__laser', [{ opacity: 0, top: '6%' }, { opacity: 1, top: '8%', offset: 0.08 }, { opacity: 1, top: '90%', offset: 0.5 }, { opacity: 1, top: '10%', offset: 0.92 }, { opacity: 0, top: '8%' }], { duration: 560, delay: 2400, easing: 'linear' });
      A('.ic__finder', [{ transform: 'translate(-50%, -50%) scale(1)' }, { transform: 'translate(-50%, -50%) scale(.86)' }], { duration: 240, delay: 2940 });
      A('.ic__qrmark', [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0.85 }], { duration: 400, delay: 2950 });
      A('.ic__pill', [{ opacity: 0, transform: 'translateY(14%) scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 2980 });
      $('.ic__rig').style.transformOrigin = `calc(50% + ${L.QX}px) calc(50% + ${L.QY}px)`;
      A('.ic__rig', [{ transform: 'scale(1)', filter: 'blur(0)', opacity: 1 }, { transform: 'scale(1.15)', filter: 'blur(0)', offset: 0.35 }, { transform: 'scale(9)', filter: light ? 'blur(0)' : 'blur(14px)', opacity: 0 }], { duration: 760, delay: 3200, easing: IN, fill: 'forwards' });
      A('.ic__room', [{ opacity: 1 }, { opacity: 0 }], { duration: 400, delay: 3600, fill: 'forwards' });
      A('.ic__flash', [{ opacity: 0 }, { opacity: 0.9, offset: 0.35 }, { opacity: 0 }], { duration: 650, delay: 3740, easing: 'ease-out' });
      A('.ic__site', [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 3820 });
      A('.ic__world', [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 3780 });
      const dim = L.portrait ? 'brightness(.36) saturate(.75) blur(4px)' : 'brightness(.34) saturate(.8) blur(2px)';
      A('.ic__church', [{ transform: 'scale(1.3)', filter: 'brightness(.9) saturate(.8) blur(2px)' }, { transform: 'scale(1)', filter: dim }], { duration: 2400, delay: 3780 });
      A('.ic__saint--athanasius', [{ opacity: 0, transform: 'translateX(-70px) scale(.9)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 850, delay: 4100 });
      A('.ic__saint--sefein', [{ opacity: 0, transform: 'translateX(70px) scale(.9)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 850, delay: 4200 });
      A('.ic__logo', [{ opacity: 0, transform: 'scale(1.6)', filter: 'blur(10px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }], { duration: 620, delay: 3900 });
      A('.ic__wave', [{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(60)' }], { duration: 1100, delay: 3940, easing: 'cubic-bezier(.2,.7,.3,1)' });
      A('.ic__wave--2', [{ opacity: 0.6, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(90)' }], { duration: 1500, delay: 4020, easing: 'cubic-bezier(.2,.7,.3,1)' });
      A('.ic__name', [{ opacity: 0, transform: 'translateY(18px) scale(.97)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 650, delay: 4350 });
      A('.ic__sub', [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 4650 });
      A('.ic__slogan', [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 5050 });
      A('.ic__welcome', [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 5450 });
      A('.ic__cta', [{ opacity: 0, transform: 'translateY(22px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 6250 });
    }

    function seek(t, paused) { anims.forEach(a => { a.currentTime = Math.min(t, 1e5); if (paused) a.pause(); }); drawFx(t); ready(t); }
    /* the account card can be used only once it is there */
    function ready(t) {
      const cta = $('.ic__cta');
      if (t >= 6250 && !cta.classList.contains('is-on')) {
        cta.classList.add('is-on');
        if (FREEZE == null) cta.querySelector('.is-main').focus({ preventScroll: true });
      }
    }
    function go() {
      build();
      started = performance.now();
      anims.forEach(a => { a.playbackRate = rate; });
      (function tick(now) {
        const t = (now - started) * rate;
        drawFx(t); ready(t);
        if (t < T + 1500) raf = requestAnimationFrame(tick);
        else done = true;
      })(started);
    }

    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const t = FREEZE != null ? FREEZE : started == null ? 0 : done ? 1e5 : (performance.now() - started) * rate;
        build(); seek(t, FREEZE != null || started == null);
      }, 120);
    };
    addEventListener('resize', onResize);

    function end() {
      if (root.classList.contains('is-leaving')) return;
      cancelAnimationFrame(raf);
      removeEventListener('resize', onResize);
      fadeMusic();
      sound && sound.stop();
      for (const n of [main, bar]) n && n.removeAttribute('inert');
      html.removeAttribute('data-intro');
      root.classList.add('is-leaving');
      setTimeout(() => { root.remove(); onEnd && onEnd(); }, 480);
      const skip = document.querySelector('.skip-link');
      (main || skip)?.focus?.({ preventScroll: true });
    }
    $('[data-enter]').addEventListener('click', end);

    if (FREEZE != null) {
      $('.ic__gate').remove();
      build(); seek(FREEZE, true);
      return { end };
    }

    build(); seek(0, true);
    const gate = $('.ic__gate');
    /* the dark cells laid over the wall along its slant, unseen until the welcome closes them one by one (the
       gate itself comes in all at once, quickly: owner, 2026-11-13) */
    const shutters = $('.ic__shutters');
    const cells = (() => {
      const cw = Math.max(150, Math.min(innerWidth, innerHeight) * 0.42), ch = cw * 0.63, list = [];
      shutters.style.setProperty('--cw', cw + 'px');
      shutters.style.setProperty('--ch', ch + 'px');
      for (let y = -2; y < Math.ceil(innerHeight / ch) + 3; y++) for (let x = -2; x < Math.ceil(innerWidth / cw) + 3; x++) {
        const c = document.createElement('i');
        c.style.left = (x * cw) + 'px';
        c.style.top = (y * ch) + 'px';
        shutters.append(c);
        list.push([c, Math.abs(Math.sin(list.length * 127.1) * 43758.5453) % 1]);
      }
      return list.sort((p, q) => p[1] - q[1]).map(c => c[0]);
    })();
    // the moving wall: ~4 minutes of the meeting's own videos that loops with no cut (tools/build-gate-world.mjs),
    // loaded at once; nothing still shows before it (owner, 2026-11-13): it fades in once it plays. A weak device or data saver: the dark gate alone.
    const film = $('.ic__film');
    if (!light && !(navigator.connection && navigator.connection.saveData)) {
      const wide = innerWidth / innerHeight > 1.25 ? '-wide' : '';
      film.addEventListener('playing', () => gate.classList.add('is-film'), { once: true });
      film.src = asset(`assets/img/intro/gate-world${wide}.mp4`);
      film.play().catch(() => { /* the dark gate stays */ });
    }
    const seal = $('.ic__seal');
    seal.focus({ preventScroll: true });
    // the welcome's music and voice: fetched once the gate is up, decoded on the press (owner, 2026-11-13)
    const take = name => fetch(asset(`assets/media/intro/${name}.mp3`)).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    // decoded before the press (an offline context needs no gesture), so the music starts the moment the logo is pressed
    const decoder = (() => { try { return new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 1, 48000); } catch { return null; } })();
    const decode = buf => (buf && decoder ? decoder.decodeAudioData(buf).catch(() => null) : null);
    const tracks = soundEnabled() ? Promise.all([take('welcome-music').then(decode), take('welcome-voice').then(decode)]) : Promise.resolve([null, null]);
    seal.addEventListener('click', () => {
      if (gate.classList.contains('is-on')) return;
      gate.classList.add('is-on');
      // the press is the gesture: the audio starts inside it
      if (soundEnabled()) sound = makeSound();
      welcome().then(() => {
        rate = RATE;
        go(); sound && sound.play(RATE);
        film.pause(); film.removeAttribute('src'); film.load(); gate.remove();
        // the card's night rises out of the welcome's black
        A('.ic__room', [{ opacity: 0 }, { opacity: 1 }], { duration: 1400, easing: 'ease-out', fill: 'backwards' }).playbackRate = 1;
        const dawn = $('.ic__dawn');
        if (dawn) G(dawn, [{ opacity: 0.9 }, { opacity: 0 }], { duration: 1600, easing: 'ease-out', fill: 'forwards' }).finished.then(() => dawn.remove(), () => {});
      });
    });

    /* The welcome (owner, 2026-11-13): one opening with the card, not a scene of its own.
       0.0  the music rises from nothing; «أهلاً بيك» and the line under the logo fade
       0.5  the wall's videos go dark one by one, a soft tick each
       2.0  the logo rises, a whoosh
       3.0  the voice: «مرحبا بيك» · «في أسرة البابا أثناسيوس الرسولي لخدمة الشباب» · «بكنيسة الشهيد العظيم أبي سيفين
            بسفاجا», each word shown as it is said; the music sinks under the voice
       11.4 the music swells back; the logo and the words leave with a soft sweep; the card comes in on the music */
    function welcome() {
      const VO_AT = 8.2, VO_SKIP = 2.2;           // the voice file is silent for its first 2.37 s
      const WORDS_AT = 1.2, DARK_AT = 2.4, DARK_FOR = 3.6, RISE_AT = 6.2, RISE_FOR = 1.6;
      const LINES = [[2.37, 'مرحبا بيك', true], [3.31, 'في أسرة البابا أثناسيوس الرسولي لخدمة الشباب'], [7.0, 'بكنيسة الشهيد العظيم أبي سيفين بسفاجا']];
      const VO_END = 10.13, OUT = VO_AT + (VO_END - VO_SKIP) + 0.5;
      const at = t => new Promise(r => setTimeout(r, t * 1000));
      const AC = sound && sound.AC;
      const t0 = AC ? AC.currentTime : 0;          // the press: the voice and the words keep this clock even if the music is late
      let music = null;
      const audio = !AC ? Promise.resolve() : Promise.race([tracks, at(2.5).then(() => [null, null])]).then(([m, v]) => {
        const now = Math.max(t0, AC.currentTime - 0.02);
        if (m) {
          // one master level (the shape of the scene) over passes that cross-fade into each other: the first pass
          // plays the track from its start, every next one replays its full part (LOOP_IN → LOOP_OUT) and fades in
          // over the end of the one before, so the music never stops and never jumps (owner, 2026-11-13: «loop»)
          const LOOP_IN = 28, LOOP_OUT = Math.min(m.duration, 93), XF = 3;
          const g = AC.createGain(); g.connect(AC.destination);
          g.gain.setValueAtTime(0, now);
          g.gain.linearRampToValueAtTime(0.78, now + 1.0);           // the music first, at once
          g.gain.setValueAtTime(0.78, t0 + VO_AT - 0.6);
          g.gain.linearRampToValueAtTime(0.3, t0 + VO_AT + 0.1);        // under the voice
          g.gain.setValueAtTime(0.3, t0 + OUT - 0.4);
          g.gain.linearRampToValueAtTime(0.72, t0 + OUT + 2.5);         // back up with the card
          g.gain.setValueAtTime(0.72, t0 + OUT + 10);
          g.gain.linearRampToValueAtTime(0.6, t0 + OUT + 14);
          const passes = [];
          let timer = 0;
          const pass = (start, from, fadeIn) => {
            const src = AC.createBufferSource(); src.buffer = m;
            const x = AC.createGain(); src.connect(x); x.connect(g);
            if (fadeIn) { x.gain.setValueAtTime(0, start); x.gain.linearRampToValueAtTime(1, start + XF); }
            const len = LOOP_OUT - from, end = start + len;
            x.gain.setValueAtTime(1, end - XF); x.gain.linearRampToValueAtTime(0, end);
            src.start(start, from, len);
            passes.push(src);
            if (passes.length > 3) passes.shift();
            // the next pass, set a few seconds before it is needed
            const next = end - XF;
            timer = setTimeout(() => pass(next, LOOP_IN, true), Math.max(0, (next - AC.currentTime - 4) * 1000));
          };
          pass(now, 0, false);
          music = { g, stop: t => { clearTimeout(timer); passes.forEach(src => { try { src.stop(t); } catch { /* ended */ } }); } };
        }
        if (v) {
          const src = AC.createBufferSource(); src.buffer = v;
          const g = AC.createGain(); g.gain.value = 1.15; src.connect(g); g.connect(AC.destination);
          src.start(t0 + VO_AT, VO_SKIP);
        }
      });
      fadeMusic = () => { if (!music) return; const t = AC.currentTime; music.g.gain.cancelScheduledValues(t); music.g.gain.setValueAtTime(music.g.gain.value, t); music.g.gain.linearRampToValueAtTime(0, t + 1.2); music.stop(t + 1.3); };
      const sfx = fn => { try { if (sound) fn(loud(sound)); } catch { /* silence */ } };
      // the welcome's sounds louder than S1's (owner): every level here × 1.8
      const loud = x => ({ ...x, osc: (t, f1, f2, at, d, v, o) => x.osc(t, f1, f2, at, d, v * 1.8, o), noise: (at, d, t, f1, f2, v, o) => x.noise(at, d, t, f1, f2, v * 1.8, o), bell: (f, at, d, v) => x.bell(f, at, d, v * 1.8) });

      // 0.0 — the words leave
      G('.ic__hello', [{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateY(-10px)', filter: 'blur(6px)' }], { duration: 1100, delay: WORDS_AT * 1000, easing: 'ease-in', fill: 'forwards' });
      G('.ic__hint', [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px)' }], { duration: 900, delay: WORDS_AT * 1000, easing: 'ease-in', fill: 'forwards' });
      sfx(x => { x.noise(0, 1.4, 'highpass', 4000, 9000, 0.03, { wet: true }); x.bell(1046.5, 0.05, 1.6, 0.03); x.osc('sine', 130, 65, 0, 1.2, 0.12, { glide: 0.8, wet: true }); });
      // 0.5 — the videos go dark one by one: dark tiles laid along the wall's own slant
      const step = DARK_FOR * 1000 / cells.length;
      cells.slice().reverse().forEach((c, i) => {
        c.getAnimations().forEach(x => x.cancel());
        c.style.opacity = '0';
        G(c, [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 700, delay: DARK_AT * 1000 + i * step, easing: 'ease-out', fill: 'forwards' });
      });
      // a soft tick as each video goes dark (a pentatonic run, left and right)
      const PENTA = [1318.5, 1568, 1760, 2093, 2349.3];
      for (let n = 0; n < 16; n++) { const t = DARK_AT + n * DARK_FOR / 16; sfx(x => { x.osc('sine', PENTA[(n * 3) % 5], 0, t, 0.12, 0.024, { wet: true, pan: (n % 2 ? 0.45 : -0.45) }); x.noise(t, 0.06, 'highpass', 6000, 9000, 0.012, { pan: (n % 2 ? 0.45 : -0.45) }); }); }
      // a breath rising into the logo's lift
      sfx(x => { x.noise(RISE_AT - 1.0, 1.2, 'highpass', 400, 6000, 0.07, { peak: 0.95, wet: true }); x.osc('sine', 220, 440, RISE_AT - 1.0, 1.2, 0.025, { glide: 1, wet: true }); });
      // 2.0 — the logo rises
      const tall = innerHeight > innerWidth;
      const box = seal.getBoundingClientRect();
      const y0 = innerHeight * (tall ? 0.27 : 0.25);
      const k = Math.min(1, (tall ? 0.36 : 0.3) * innerHeight / box.height);
      const lift = y0 - (box.top + box.height / 2);
      G(seal, [{ transform: 'none' }, { transform: 'translateY(' + lift + 'px) scale(' + k + ')' }], { duration: RISE_FOR * 1000, delay: RISE_AT * 1000, easing: 'cubic-bezier(.65,0,.2,1)', fill: 'forwards' });
      sfx(x => { x.noise(RISE_AT, RISE_FOR, 'bandpass', 250, 2600, 0.12, { pan: -0.3, pan2: 0.3, q: 0.7, peak: 0.6 }); x.osc('sine', 110, 220, RISE_AT, RISE_FOR, 0.05, { wet: true }); });
      // 3.0 — the voice, and its words as they are said
      const say = $('.ic__say');
      say.style.setProperty('--top', (y0 + box.height * k * 0.5 + Math.max(24, innerHeight * 0.04)) + 'px');
      LINES.forEach(([t, text, big], li) => {
        const line = document.createElement('p');
        line.className = 'ic__line' + (big ? ' ic__line--big' : '');
        const words = text.split(' ');
        const next = li + 1 < LINES.length ? LINES[li + 1][0] : VO_END;
        const per = Math.min(0.42, (next - t) / words.length);
        words.forEach((w, wi) => {
          const span = document.createElement('span');
          span.textContent = w;
          line.append(span, ' ');
          G(span, [{ opacity: 0, transform: 'translateY(.4em)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 520, delay: (VO_AT + t - VO_SKIP + wi * per) * 1000, easing: EXPO });
        });
        say.append(line);
      });
      // the logo settles: a low, warm landing and a bell chord
      sfx(x => { const land = RISE_AT + RISE_FOR - 0.05; x.osc('sine', 96, 46, land, 1.4, 0.32, { glide: 0.7 }); x.noise(land, 0.7, 'lowpass', 1200, 120, 0.12, { wet: true }); [392, 587.3, 784].forEach((f, i) => x.bell(f, land + 0.02 + i * 0.03, 2.8, 0.022)); });
      // a light chime as each line begins, rising
      LINES.forEach(([t], i) => sfx(x => { x.bell([1046.5, 1174.7, 1318.5][i], VO_AT + t - VO_SKIP - 0.05, 1.8, 0.016); x.noise(VO_AT + t - VO_SKIP - 0.05, 0.6, 'highpass', 7000, 10000, 0.012, { wet: true }); }));
      // more sounds, soft and in the scene's key (owner, 2026-11-13)
      sfx(x => {
        // the press: a harp-like run upward
        [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => x.osc('triangle', f, 0, 0.05 + i * 0.09, 0.9, 0.02, { wet: true, pan: -0.6 + i * 0.3 }));
        // the words lift away: a short airy rush
        x.noise(WORDS_AT, 0.9, 'bandpass', 900, 5000, 0.05, { pan: 0.3, pan2: -0.3, q: 0.6, peak: 0.4, wet: true });
        // the wall is dark: a hush, low and wide
        x.noise(DARK_AT + DARK_FOR, 1.6, 'lowpass', 600, 90, 0.08, { wet: true });
        x.osc('sine', 73.4, 0, DARK_AT + DARK_FOR, 2.2, 0.08, { wet: true });
        // the breath before the voice
        x.noise(VO_AT - 0.7, 0.8, 'bandpass', 1500, 600, 0.03, { q: 0.8, peak: 0.6, wet: true });
        // a faint glint under each word as it appears
        LINES.forEach(([t, text], li) => {
          const next = li + 1 < LINES.length ? LINES[li + 1][0] : VO_END;
          const words = text.split(' '), per = Math.min(0.42, (next - t) / words.length);
          words.forEach((w, wi) => x.osc('sine', [2093, 2349.3, 2637][(wi + li) % 3], 0, VO_AT + t - VO_SKIP + wi * per, 0.25, 0.006, { wet: true, pan: (wi % 2 ? 0.3 : -0.3) }));
        });
        // the voice ends: a gentle sparkle falling, before the leaving
        const after = VO_AT + VO_END - VO_SKIP + 0.1;
        [2637, 2349.3, 2093, 1760, 1568].forEach((f, i) => x.osc('sine', f, 0, after + i * 0.08, 0.6, 0.014, { wet: true, pan: 0.5 - i * 0.25 }));
      });
      // the end — the logo and the words leave together, the card comes in on the music
      // the whole logo (its gold rings too) gathers into a point of light, and that light opens into a soft dawn the
      // card comes out of (owner, 2026-11-13: «نمهّد لانترو الكارت»)
      G(seal.querySelector('img'), [{ filter: 'blur(0) brightness(1)' }, { filter: 'blur(6px) brightness(2.2)' }], { duration: 900, delay: OUT * 1000, easing: 'ease-in', fill: 'forwards' });
      G(seal, [{ opacity: 1, scale: '1' }, { opacity: 1, scale: '.35', offset: 0.7 }, { opacity: 0, scale: '.05' }], { duration: 1100, delay: OUT * 1000, easing: 'cubic-bezier(.6,0,.4,1)', fill: 'forwards' });
      const dawn = $('.ic__dawn');
      const sb = seal.getBoundingClientRect();
      dawn.style.left = (sb.left + sb.width / 2) + 'px';
      dawn.style.top = (sb.top + sb.height / 2) + 'px';
      G(dawn, [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(.05)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(.3)', offset: 0.35 },
        { opacity: 0.9, transform: `translate(calc(-50% + ${innerWidth / 2 - (sb.left + sb.width / 2)}px), calc(-50% + ${innerHeight / 2 - (sb.top + sb.height / 2)}px)) scale(1.4)` }
      ], { duration: 1500, delay: OUT * 1000 + 500, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' });
      sfx(x => { x.noise(OUT + 0.4, 1.6, 'highpass', 200, 4000, 0.06, { peak: 0.95, wet: true }); x.osc('sine', 196, 392, OUT + 0.5, 1.5, 0.03, { glide: 1.5, wet: true }); });   // no bell here: the card brings its own glint (owner: not the same sound twice)
      G(say, [{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateY(-14px)', filter: 'blur(8px)' }], { duration: 800, delay: OUT * 1000, easing: 'ease-in', fill: 'forwards' });
      sfx(x => {
        x.noise(OUT - 0.6, 1.0, 'highpass', 300, 5000, 0.06, { peak: 0.9, wet: true });                     // a riser into the leaving
        x.noise(OUT, 1.1, 'highpass', 600, 7000, 0.1, { peak: 0.8, wet: true }); x.osc('sine', 330, 990, OUT, 1.0, 0.03, { glide: 1, wet: true });
        [2093, 2637, 3136].forEach((f, i) => x.osc('sine', f, 0, OUT + 0.15 + i * 0.07, 0.5, 0.012, { wet: true, pan: i - 1 })); // a sparkle
      });
      return Promise.all([audio, at(OUT + 1.9)]);
    }
    // a tap anywhere else does nothing (the logo is the way in); a tap during the intro never cuts it short
    return { end };
  });
}
