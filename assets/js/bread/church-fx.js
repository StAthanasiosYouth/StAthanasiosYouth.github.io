/*
 * «مناسبات كنيستنا» — the section's identity on the page (owner 2026-11-25, approved on the preview
 * docs/daily-bread/saints/p5/identity.html; decisions in docs/daily-bread/saints/DECISIONS-2026-11-25.md §6, §9, §10):
 *   entrance()   the «كنيستنا» tab's entrance, ≈ 2.6 s, the first visit of the day only: the medallion
 *                (assets/img/bread/church-logo.svg) builds itself, the two swords meet, the crown, the church, the title
 *   reveal(root) each occasion card appears by its nature, once a day each:
 *                  our patron and our family's patron → the opening of the hymn sung in church, its words written with
 *                  the voice, the saint's picture faint behind the name, then the card (assets/media/bread/*-open)
 *                  a repose → a candle's light, slow · the Pope / a bishop → light from above · others → a soft rise
 * Light: the SVG (≈ 21 KB) only on the entrance; a hymn clip (≈ 65 KB) only on its day; the other sounds are made by
 * the browser (Web Audio), quiet. No sound without the site's sound on and a tap first; reduced motion → a fade.
 */
import { soundEnabled } from '../sound.js';

const ROOT = new URL('../../../', import.meta.url);
const A = p => new URL(p, ROOT).href;
const html = document.documentElement;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const canSound = () => soundEnabled() && (!navigator.userActivation || navigator.userActivation.hasBeenActive);

/* ---------- quiet sounds, made in the browser ---------- */
let ctx = null, out = null, room = null;
function ac() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  ctx = new C(); out = ctx.createGain(); out.gain.value = 0.5; out.connect(ctx.destination);
  room = ctx.createGain(); room.gain.value = 0.28;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
  [0.11, 0.23].forEach(t => { const d = ctx.createDelay(1); d.delayTime.value = t; const fb = ctx.createGain(); fb.gain.value = 0.38; d.connect(fb).connect(d); room.connect(d); d.connect(lp); });
  lp.connect(out);
  return ctx;
}
const send = n => { n.connect(out); n.connect(room); };
function bell(at = 0, base = 220, gain = 0.09, len = 4.5) {
  const a = ac(); if (!a) return; const t = a.currentTime + at;
  [[1, 1], [2.0, .4], [2.76, .22], [5.4, .06]].forEach(([m, g]) => {
    const o = a.createOscillator(), v = a.createGain();
    o.frequency.value = base * m; v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(gain * g, t + 0.02); v.gain.exponentialRampToValueAtTime(0.0001, t + len / (0.8 + m * 0.3));
    o.connect(v); send(v); o.start(t); o.stop(t + len);
  });
}
function drone(at = 0, f = 146.8, len = 3.6, gain = 0.045) {
  const a = ac(); if (!a) return; const t = a.currentTime + at;
  [f, f * 1.5].forEach((fr, i) => { const o = a.createOscillator(), v = a.createGain(); o.frequency.value = fr; v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(gain * (i ? .4 : 1), t + 1.1); v.gain.exponentialRampToValueAtTime(0.0001, t + len); o.connect(v); send(v); o.start(t); o.stop(t + len + 0.1); });
}
const chime = (at = 0) => { bell(at, 659, 0.035, 2.4); bell(at + 0.5, 880, 0.028, 2.4); };

/* ---------- the entrance ---------- */
let svgText = null;
const logo = () => (svgText ||= fetch(A('assets/img/bread/church-logo.svg')).then(r => (r.ok ? r.text() : ''), () => ''));
let nth = 0;
const own = svg => { const p = 'cl' + (++nth) + '-'; return { p, svg: svg.replace(/^<\?xml[^>]*>\s*/, '').replace(/id="([^"]+)"/g, `id="${p}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`).replace(/href="#([^"]+)"/g, `href="#${p}$1"`) }; };
const E = 'cubic-bezier(.22, 1, .36, 1)';
export async function entrance(day, { force = false } = {}) {
  if (!force && (store.get('bread.ch.in') === day || store.get('bread.fx') === 'off')) return;
  if (!force) store.set('bread.ch.in', day);
  const text = await logo();
  if (!text) return;
  const L = own(text);
  const el = document.createElement('div');
  el.className = 'ch-in'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="ch-in__bloom"></div><div class="ch-in__logo">${L.svg}</div><div class="ch-in__flash"></div>`;
  document.body.append(el);
  const s = el.querySelector('svg'), $ = id => s.querySelector('#' + L.p + id);
  const anims = [];
  const go = (node, kf, o = {}) => { if (!node) return; const ease = o.easing || E; anims.push(node.animate(kf.map((k, i) => (i < kf.length - 1 && !k.easing ? { ...k, easing: ease } : k)), { fill: 'both', ...o, easing: 'linear' })); };
  if (reduced()) {
    go(el, [{ opacity: 0 }, { opacity: 1, offset: .3 }, { opacity: 1, offset: .7 }, { opacity: 0 }], { duration: 1400 });
  } else {
    go(el.querySelector('.ch-in__bloom'), [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 700 });
    go($('ring'), [{ opacity: 0, transform: 'rotate(-40deg) scale(.86)' }, { opacity: 1, transform: 'none' }], { duration: 900, delay: 100 });
    go($('night-sky'), [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 150 });
    go($('halo-glow'), [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'none' }], { duration: 900, delay: 500 });
    go($('stars'), [{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 500 });
    go($('sword-a') && $('sword-a').parentNode, [{ transform: 'translate(-420px, 160px) rotate(-60deg)', opacity: 0 }, { opacity: 1, offset: .3 }, { transform: 'translate(500px, 470px) rotate(-40deg) scale(.62) translate(-500px, -530px)', opacity: 1 }], { duration: 560, delay: 120, easing: 'cubic-bezier(.5, 0, .2, 1.25)' });
    go($('sword-b') && $('sword-b').parentNode, [{ transform: 'translate(1420px, 160px) rotate(60deg)', opacity: 0 }, { opacity: 1, offset: .3 }, { transform: 'translate(500px, 470px) rotate(40deg) scale(.62) translate(-500px, -530px)', opacity: 1 }], { duration: 560, delay: 120, easing: 'cubic-bezier(.5, 0, .2, 1.25)' });
    go(el.querySelector('.ch-in__flash'), [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1)', offset: .25 }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 650, delay: 640 });
    go($('crown'), [{ transform: 'translate(500px, 370px) scale(.72)', opacity: 0 }, { transform: 'translate(500px, 458px) scale(.72)', opacity: 1 }], { duration: 600, delay: 900, easing: 'cubic-bezier(.34, 1.56, .64, 1)' });
    go($('hills'), [{ transform: 'translateY(120px)' }, { transform: 'none' }], { duration: 700, delay: 700 });
    go($('church'), [{ transform: 'translate(500px, 980px) scale(.86) translate(-500px, -780px)', opacity: 0 }, { transform: 'translate(500px, 780px) scale(.86) translate(-500px, -780px)', opacity: 1 }], { duration: 800, delay: 820 });
    go($('windows'), [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 1350 });
    go($('title'), [{ opacity: 0, transform: 'translateY(-26px) scale(1.08)' }, { opacity: 1, transform: 'none' }], { duration: 650, delay: 1250 });
    go($('tagline'), [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 1650 });
    go($('family-seal'), [{ opacity: 0, transform: 'rotate(-90deg)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 1750 });
    go(el.querySelector('.ch-in__logo'), [{ transform: 'none' }, { transform: 'none', offset: .8 }, { transform: 'translateY(-30vh) scale(.2)' }], { duration: 2600 });
    go(el, [{ opacity: 1 }, { opacity: 1, offset: .82 }, { opacity: 0 }], { duration: 2600 });
    if (canSound()) { drone(0, 146.8, 2.6, 0.03); bell(0.62, 196, 0.07); }
  }
  await Promise.all(anims.map(a => a.finished.catch(() => {})));
  el.remove();
}

/* ---------- the hymn openings (the recordings the owner chose; the words and times are the recordings' own) ---------- */
const OPEN = {
  patron: { src: 'assets/media/bread/mercurius-open', from: 3.65, end: 21.85, lines: [
    [['تعالوا', 4.05], ['نتهلل', 5.03], ['بالألحان', 6.53]], [['ونرتل', 8.11], ['للفادي', 9.93], ['الديان', 11.15]],
    [['في', 12.47], ['عيد', 12.87], ['الشهيد', 13.31], ['بطل', 14.87], ['الإيمان', 15.43]], [['فيلوباتير', 16.81], ['مارقوريوس', 19.15]]] },
  family: { src: 'assets/media/bread/athanasius-open', from: 8.05, end: 22.12, lines: [
    [['أثناسيوس', 8.46], ['يا', 10.88], ['رسول', 11.18]], [['حبنا', 12.48], ['لك', 13.78], ['على', 14.62], ['طول', 14.96]],
    [['كلنا', 15.58], ['بأجمعنا', 16.42], ['نقول', 18.0]], [['بنيوت', 18.88], ['أفا', 19.78], ['أثناسيوس', 20.42]]] }
};
const pick = base => A(base + (document.createElement('audio').canPlayType('audio/ogg; codecs=opus') ? '.opus' : '.m4a'));
/*
 * One opening = one timeline (its voice, or the clock), kept here while it runs: the page redraws its cards often, and
 * a redrawn card picks the same opening up where it is, the same voice going on.
 */
const RUN = new Map();   // occasion id → { o, audio, t0, playing, done }
function hymn(id, o) {
  const run = { o, audio: canSound() ? new Audio(pick(o.src)) : null, t0: performance.now(), playing: false, done: false };
  RUN.set(id, run);
  if (run.audio) {
    run.audio.volume = 0.8;
    run.audio.addEventListener('ended', () => { run.done = true; });
    run.audio.play().then(() => { run.playing = true; }, () => {});
  }
  return run;
}
const nowOf = run => (run.playing ? run.audio.currentTime : (performance.now() - run.t0) / 1000);
function attach(card, run) {
  const o = run.o, face = card.querySelector('.oc__pics img, .oc-seal img');
  card.classList.add('oc--event');
  card.insertAdjacentHTML('afterbegin', `<div class="oc-ev" aria-hidden="true">${face ? `<img class="oc-ev__face" src="${face.currentSrc || face.src}" alt="">` : ''}${o.lines.map((l, i) => `<p class="oc-ev__l${i === o.lines.length - 1 ? ' oc-ev__l--name' : ''}">${l.map(([w, t]) => `<span data-t="${(t - o.from).toFixed(2)}">${w}</span>`).join(' ')}</p>`).join('')}</div>`);
  const ev = card.querySelector('.oc-ev'), words = [...ev.querySelectorAll('[data-t]')], last = o.end - o.from;
  const nameAt = +ev.querySelector('.oc-ev__l--name [data-t]').dataset.t, img = ev.querySelector('.oc-ev__face');
  const finish = () => {
    run.done = true;
    // the opening gives its place to the card itself, which rises in
    ev.remove(); card.classList.remove('oc--event'); card.classList.add('oc--shown');
  };
  const paint = now => { words.forEach(w => w.classList.toggle('on', now >= +w.dataset.t)); if (img) img.classList.toggle('on', now >= nameAt); return now >= last - 0.2; };
  const tick = () => {
    if (!card.isConnected) return;   // redrawn: the new card goes on with the same run
    if (run.done || paint(nowOf(run))) { finish(); return; }
    requestAnimationFrame(tick);
  };
  paint(nowOf(run));
  requestAnimationFrame(tick);
  // a tap on the card skips to it
  ev.addEventListener('click', () => { if (run.audio) run.audio.pause(); finish(); }, { once: true });
}

/* ---------- each card by its nature, once a day ---------- */
export function reveal(root, day, { force = false } = {}) {
  if (!force && store.get('bread.fx') === 'off') return;   // the tests (and nobody else) turn the effects off
  for (const card of root.querySelectorAll('.oc[data-occasion]:not(.oc--fx)')) {
    card.classList.add('oc--fx');
    const id = card.dataset.occasion, key = 'bread.oc.fx.' + id;
    const running = RUN.get(id);
    if (!force && running && !running.done && !card.closest('dialog')) { attach(card, running); continue; }
    if (!force && (store.get(key) === day || card.closest('dialog'))) continue;
    if (!force) store.set(key, day);
    if (force && running) { running.done = true; if (running.audio) running.audio.pause(); }
    if (reduced()) { card.classList.add('oc--soft'); continue; }
    if (card.classList.contains('oc--patron')) attach(card, hymn(id, OPEN.patron));
    else if (card.classList.contains('oc--family')) attach(card, hymn(id, OPEN.family));
    else if (card.classList.contains('oc--memorial')) { card.classList.add('oc--candle'); if (canSound()) drone(0.1); }
    else if (card.classList.contains('oc--pope') || card.classList.contains('oc--bishop')) { card.classList.add('oc--light'); if (canSound()) chime(0.2); }
    else card.classList.add('oc--soft');
  }
}
