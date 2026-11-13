/**
 * The member's welcome (site redesign W3, approved S2 «دخلة المخدوم», docs/site-redesign/member-intro.js): for
 * someone with an account on this device, each visit, ~2.1 s.
 *   0.00–0.70  a gold ring draws itself around the centre, a light point at its tip; faint gold rays turn behind
 *   0.28–0.85  the logo opens inside the ring; ~0.70 bloom + a light sweep (a soft bell if the browser allows sound)
 *   0.60–1.15  «صباح الخير / مساء الخير» · the first name in Ruqaa, right to left · a gold rule · the next meeting
 *   1.30–2.08  the text lifts away, the ring opens out, the logo flies on a curve into the top bar; the page rises
 *   2.08       the bar's logo lands with a small gold pulse
 * A tap never cuts it short (owner, 2026-11-11). main.js calls it once the page is drawn.
 */

import { readFace } from './account/link.js';
import { soundEnabled } from './sound.js';

const ROOT = new URL('../../', import.meta.url);
const EXPO = 'cubic-bezier(.16,1,.3,1)';
const QUART = 'cubic-bezier(.76,0,.24,1)';
const OUT = 'cubic-bezier(.22,1,.36,1)';
const DAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>';

function store(name) {
  try { return globalThis[name] || null; }
  catch { return null; }
}

function sheet() {
  if (document.querySelector('link[data-intro-css]')) return Promise.resolve();
  return new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('assets/css/intro.css', ROOT).href;
    link.dataset.introCss = '';
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    document.head.append(link);
  });
}

/* «الاجتماع الأحد ٨ بالليل · فاضل ٥ أيام» from the meeting's status (schedule.js), or nothing */
export function meetingChip(status, now = new Date()) {
  const start = status && (status.start || status.next && status.next.start || status.nextStart);
  const when = start instanceof Date ? start : start ? new Date(start) : null;
  if (!when || Number.isNaN(when.getTime())) return '';
  const h = when.getHours(), hour = h % 12 || 12;
  const part = h < 12 ? 'الصبح' : h < 17 ? 'الضهر' : 'بالليل';
  const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(when) - midnight(now)) / 864e5);
  if (days < 0) return '';
  const left = days === 0 ? 'النهارده' : days === 1 ? 'بكرة' : days === 2 ? 'بعد يومين' : `فاضل ${AR(days)} ${days <= 10 ? 'أيام' : 'يوم'}`;
  return `الاجتماع ${DAYS[when.getDay()]} ${AR(hour)} ${part} · <b>${left}</b>`;
}

export function playMemberIntro({ status = null, now = new Date() } = {}) {
  const html = document.documentElement;
  const target = document.querySelector('.topbar__brand img');
  if (!target) { html.removeAttribute('data-intro'); return Promise.resolve(); }
  const face = readFace(store('localStorage'), store('sessionStorage')) || {};
  const name = String(face.firstName || '').trim().slice(0, 24);

  return sheet().then(() => {
    const hi = now.getHours() < 12 ? 'صباح الخير' : 'مساء الخير';
    const chip = meetingChip(status, now);
    const el = document.createElement('div');
    el.className = 'mi';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="mi__bg"><div class="mi__art"></div><div class="mi__veil"></div></div>' +
      '<div class="mi__stage"><div class="mi__core"><div class="mi__seal">' +
      '<span class="mi__bloom"></span>' +
      '<svg class="mi__svg" viewBox="0 0 100 100"><defs><linearGradient id="miGold" x1="0" y1="0" x2="1" y2="1"><stop class="mi__g1" offset="0"/><stop class="mi__g2" offset=".5"/><stop class="mi__g3" offset="1"/></linearGradient></defs>' +
      '<circle class="mi__track" cx="50" cy="50" r="48"/><circle class="mi__draw" cx="50" cy="50" r="48" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg>' +
      '<span class="mi__head"><i></i></span>' +
      `<div class="mi__disc"><img src="${new URL('assets/img/intro/logo-848.webp', ROOT).href}" alt=""><span class="mi__shine"></span></div>` +
      '</div><div class="mi__text"><span class="mi__hi"></span><span class="mi__name"></span><span class="mi__rule"></span>' +
      (chip ? `<span class="mi__chip">${CAL}${chip}</span>` : '') + '</div></div></div>';
    el.querySelector('.mi__hi').textContent = hi;
    el.querySelector('.mi__name').textContent = name || 'أهلاً بيك';
    document.body.append(el);
    html.setAttribute('data-intro', 'member-on');
    target.classList.add('is-waiting');
    const $ = s => el.querySelector(s);
    const A = (n, kf, o) => (typeof n === 'string' ? $(n) : n).animate(kf, Object.assign({ fill: 'both', easing: EXPO }, o));

    A('.mi__art', [{ transform: 'rotate(-8deg) scale(.9)', opacity: 0 }, { transform: 'rotate(0deg) scale(1)', opacity: 1, offset: 0.5 }, { transform: 'rotate(4deg) scale(1.04)', opacity: 1 }], { duration: 2000, easing: OUT });
    A('.mi__draw', [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: 700, easing: QUART });
    A('.mi__head', [{ transform: 'rotate(0deg)', opacity: 1 }, { transform: 'rotate(360deg)', opacity: 1, offset: 0.96 }, { transform: 'rotate(360deg)', opacity: 0 }], { duration: 730, easing: QUART });
    A('.mi__track', [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
    A('.mi__disc', [{ clipPath: 'circle(0% at 50% 50%)', transform: 'scale(1.12)' }, { clipPath: 'circle(50% at 50% 50%)', transform: 'scale(1)' }], { duration: 560, delay: 280 });
    A('.mi__disc img', [{ filter: 'brightness(1.8) saturate(.4)' }, { filter: 'brightness(1) saturate(1)' }], { duration: 700, delay: 300 });
    A('.mi__bloom', [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)', offset: 0.35 }, { opacity: 0.35, transform: 'scale(1.15)' }], { duration: 900, delay: 640, easing: 'ease-out', fill: 'backwards' });
    A('.mi__shine', [{ transform: 'translateX(70%)' }, { transform: 'translateX(-70%)' }], { duration: 650, delay: 700, easing: 'cubic-bezier(.4,0,.2,1)' });
    A('.mi__hi', [{ opacity: 0, transform: 'translateY(6px)', letterSpacing: '.3em' }, { opacity: 1, transform: 'none', letterSpacing: '.02em' }], { duration: 520, delay: 600 });
    A('.mi__name', [{ clipPath: 'inset(-40% -10% -40% 110%)', transform: 'translateX(-10px)' }, { clipPath: 'inset(-40% -10% -40% -10%)', transform: 'none' }], { duration: 560, delay: 700, easing: QUART });
    A('.mi__rule', [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }], { duration: 500, delay: 860 });
    if (chip) A('.mi__chip', [{ opacity: 0, transform: 'translateY(8px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 460, delay: 960 });

    // the exit, measured from the real top-bar logo
    const seal = $('.mi__seal'), a = seal.getBoundingClientRect(), b = target.getBoundingClientRect();
    const dx = (b.left + b.width / 2) - (a.left + a.width / 2), dy = (b.top + b.height / 2) - (a.top + a.height / 2), sc = b.width / a.width;
    const T0 = 1300, FLY = 720;
    A('.mi__text', [{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateY(-14px)', filter: 'blur(4px)' }], { duration: 320, delay: T0, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    A('.mi__svg', [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.5)' }], { duration: 420, delay: T0 + 40, easing: 'ease-out', fill: 'forwards' });
    A('.mi__bloom', [{ opacity: 0.35 }, { opacity: 0 }], { duration: 300, delay: T0 + 40, fill: 'forwards' });
    A(seal, [
      { transform: 'translate(0px,0px) scale(1)' },
      { transform: `translate(${dx * 0.18}px,${dy * 0.1 + 8}px) scale(1.04)`, offset: 0.16 },
      { transform: `translate(${dx * 0.72}px,${dy * 0.86}px) scale(${sc * 1.5})`, offset: 0.78 },
      { transform: `translate(${dx}px,${dy}px) scale(${sc})` }
    ], { duration: FLY, delay: T0 + 60, easing: 'cubic-bezier(.55,.05,.25,1)', fill: 'forwards' });
    A('.mi__bg', [{ opacity: 1 }, { opacity: 0 }], { duration: 560, delay: T0 + 180, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    // the page rises in behind: the bar slides down, the first sections lift one after another
    const top = document.getElementById('topbar');
    const parts = [...document.querySelectorAll('#main > *')].filter(n => n.offsetParent && n.getBoundingClientRect().top < innerHeight).slice(0, 6);
    if (top) top.animate([{ transform: 'translateY(-100%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 520, delay: T0 + 200, easing: EXPO, fill: 'backwards' });
    parts.forEach((p, i) => p.animate([{ transform: 'translateY(26px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 640, delay: T0 + 300 + i * 70, easing: EXPO, fill: 'backwards' }));
    const LAND = T0 + 60 + FLY, END = LAND + 20;

    // sound: only if the browser already allows it (no gate for members) and the site's sounds are on
    try {
      const AC = window.AudioContext || window.webkitAudioContext, ac = soundEnabled() && AC && new AC();
      if (ac && ac.state === 'running') {
        const bus = ac.createGain(); bus.gain.value = 0.5; bus.connect(ac.destination);
        const bell = (t, f, g, d) => { const o = ac.createOscillator(), e = ac.createGain(), s = ac.currentTime + t; o.type = 'sine'; o.frequency.value = f; e.gain.setValueAtTime(0, s); e.gain.linearRampToValueAtTime(g, s + 0.01); e.gain.exponentialRampToValueAtTime(0.0001, s + d); o.connect(e); e.connect(bus); o.start(s); o.stop(s + d + 0.05); };
        [[0.68, 784, 0.16, 1.6], [0.68, 1568, 0.05, 1.1], [0.78, 1175, 0.1, 1.4], [LAND / 1000, 1318, 0.07, 0.7]].forEach(x => bell(...x));
        setTimeout(() => ac.close(), END + 1500);
      }
      else if (ac) ac.close();
    }
    catch { /* silent */ }

    return new Promise(resolve => setTimeout(() => {
      target.classList.remove('is-waiting');
      target.classList.add('is-landed');
      el.remove();
      html.removeAttribute('data-intro');
      resolve();
    }, END));
  });
}
