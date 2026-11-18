/*
 * «خبزنا اليومي» — the intro (decision 15): the approved W1 intro (docs/daily-bread/w1/intro.js), its motion unchanged. Built on logo B's own named layers (the outlined, approved SVG).
 *
 *   ≈ 3.0 s, full screen, no skip button, a tap does not cut it (the page is already there underneath and the
 *   intro hands over to it by itself). Plays on EVERY new entry to the section (push, home card, menu, a link),
 *   again after leaving and coming back the same day, and on a back-button return from the bfcache (pageshow,
 *   persisted). Never on in-page navigation (font size, tashkeel, «إشعاراتي», writing or editing a reflection,
 *   returning after sign-in: that return carries ?from=signin).
 *
 *   Timeline (s)  0.00 the dark breathes: a warm light blooms low in the centre
 *                 0.15 the sky of logo B comes in; 0.25 the sun rises, its rays turn into place; the hills settle
 *                 0.75 the book opens upward from its spine (a spring), the ribbon drops, bread, wheat, lantern, church
 *                 1.20 the gold ring draws itself round; the signature on the ring turns into place
 *                 1.45 the name writes in from right to left; 1.75 the tagline rises
 *                 1.90 the cross comes down in light — the bell at 2.05 s; 2.10 the family seal settles
 *                 2.40 the logo glides to its place in the top bar, the dark lifts, the page arrives (3.0 s)
 *   Sound         one file (sound/intro-a|b), tried once; if the browser blocks it, the intro goes on silently
 *                 and a small «الصوت مقفول على الجهاز ده» shows — nothing waits. The site's mute applies.
 *   Reduced motion  the logo fades in and out (≈ 1.1 s), nothing moves.   lite: no blur, no dust.
 */

const EASE = 'cubic-bezier(.22, 1, .36, 1)';
const SOFT = 'cubic-bezier(.4, 0, .2, 1)';
const SPRING = 'linear(0, .006, .025 2.8%, .101 6.1%, .539 18.9%, .721 25.3%, .849 31.5%, .937 38.1%, .968 41.8%, .991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001)';

let svgCache = null;
/* the logo's markup (fetched once; the page starts this early). Offline / failed: '' and the intro still runs. */
export async function logoSvg(src) {
  if (!svgCache) svgCache = fetch(src).then(r => (r.ok ? r.text() : '')).then(t => t.replace(/^<\?xml[^>]*>\s*/, ''), () => '');
  return svgCache;
}

/* try the sound once; resolve true if it plays. `src` may be a list: the first file this browser can play. */
function trySound(src, muted) {
  if (muted || !src) return Promise.resolve(false);
  if (Array.isArray(src)) {
    const probe = document.createElement('audio');
    src = src.find(u => probe.canPlayType(/\.opus$/.test(u) ? 'audio/ogg; codecs=opus' : 'audio/mp4; codecs="mp4a.40.2"')) || src[0];
  }
  const a = new Audio(src);
  a.preload = 'auto';
  a.volume = 0.85;
  return a.play().then(() => true, () => false);
}

/**
 * playIntro({ logo, sound, target, hold, reduced, lite, muted, onArrive })
 *   logo     URL of the outlined logo B SVG
 *   sound    URL of the chosen sound file (or null)
 *   target   the element the logo glides into (the top bar's mark)
 *   hold     ms: freeze at this moment (review screenshots only)
 */
export async function playIntro(o) {
  const html = document.documentElement;
  const reduced = o.reduced ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lite = o.lite ?? html.dataset.motion === 'lite';
  const el = document.createElement('div');
  el.className = 'br-intro';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="br-intro__bloom"></div><div class="br-intro__stage">${await logoSvg(o.logo)}<div class="br-intro__dust"></div></div>
    <p class="br-intro__mute"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="m16 10 4 4m0-4-4 4"/></svg>الصوت مقفول على الجهاز ده</p>`;
  document.body.appendChild(el);
  html.classList.add('br-intro-on');
  const svg = el.querySelector('svg');
  if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); }
  const $ = id => svg.querySelector('#' + id);
  const anims = [];
  const A = (node, frames, opts) => { if (!node) return null; const a = node.animate(frames, { fill: 'both', ...opts }); anims.push(a); return a; };
  const opac = n => (n && n.getAttribute('opacity')) || 1;

  trySound(o.sound, o.muted).then(ok => { if (!ok && o.sound && !o.muted) el.querySelector('.br-intro__mute').classList.add('is-on'); });

  if (reduced || !svg) {
    A(el.querySelector('.br-intro__stage'), [{ opacity: 0 }, { opacity: 1, offset: .35 }, { opacity: 1, offset: .72 }, { opacity: 0 }], { duration: 1100, easing: 'linear' });
    A(el, [{ opacity: 1 }, { opacity: 1, offset: .72 }, { opacity: 0 }], { duration: 1100 });
    return finish(1100);
  }

  // view-box origins for SVG groups
  const vb = (node, x, y) => { if (node) { node.style.transformBox = 'view-box'; node.style.transformOrigin = `${x}px ${y}px`; } };
  const fb = node => { if (node) { node.style.transformBox = 'fill-box'; node.style.transformOrigin = '50% 50%'; } };

  // 0.00 the bloom
  A(el.querySelector('.br-intro__bloom'), [{ opacity: 0, scale: .4 }, { opacity: 1, scale: 1, offset: .55 }, { opacity: .55, scale: 1.08 }], { duration: 2300, easing: SOFT });
  // 0.15 sky · 0.25 sun + rays · hills
  A(svg.querySelector('rect#sky'), [{ opacity: 0 }, { opacity: 1 }], { delay: 100, duration: 1000, easing: SOFT });
  // the scene opens like an iris from the dark (logo B's own disc clip, its radius only)
  A(svg.querySelector('#disc circle'), [{ r: '40px' }, { r: '392px' }], { delay: 60, duration: 1250, easing: 'cubic-bezier(.65, 0, .25, 1)' });
  vb($('sun-disc'), 500, 620);
  A($('sun-disc'), [{ opacity: 0, transform: 'translateY(150px) scale(.45)' }, { opacity: 1, transform: 'none' }], { delay: 250, duration: 1300, easing: EASE });
  vb($('rays'), 500, 620);
  A($('rays'), [{ opacity: 0, transform: 'rotate(-16deg) scale(.7)' }, { opacity: opac($('rays')), transform: 'none' }], { delay: 380, duration: 1500, easing: EASE });
  A($('hills-far'), [{ opacity: 0, transform: 'translateY(46px)' }, { opacity: opac($('hills-far')), transform: 'none' }], { delay: 420, duration: 1100, easing: EASE });
  A($('hills-near'), [{ opacity: 0, transform: 'translateY(80px)' }, { opacity: opac($('hills-near')), transform: 'none' }], { delay: 520, duration: 1100, easing: EASE });
  A($('church'), [{ opacity: 0, transform: 'translate(770px, 636px) scale(.95)' }, { opacity: 1, transform: 'translate(770px, 600px) scale(.95)' }], { delay: 700, duration: 1000, easing: EASE });
  A($('table'), [{ transform: 'translateY(70px)' }, { transform: 'none' }], { delay: 560, duration: 1000, easing: EASE });
  // 0.75 the book opens upward from its spine; the ribbon drops
  vb($('book'), 500, 812);
  A($('book'), [{ opacity: 0, transform: 'scale(.6, .06)' }, { opacity: 1, transform: 'scale(.9, .3)', offset: .18 }, { opacity: 1, transform: 'none' }], { delay: 750, duration: 1050, easing: SPRING });
  A($('ribbon'), [{ transform: 'translateY(-70px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { delay: 1150, duration: 700, easing: SPRING });
  A($('bread'), [{ opacity: 0, transform: 'translate(-40px, 30px)' }, { opacity: 1, transform: 'none' }], { delay: 950, duration: 800, easing: EASE });
  A($('wheat'), [{ opacity: 0, transform: 'translate(-30px, 40px) rotate(-6deg)' }, { opacity: 1, transform: 'none' }], { delay: 1050, duration: 850, easing: EASE });
  const lantern = $('lantern');
  if (lantern) A(lantern, [{ opacity: 0, transform: 'translate(205px, 580px) scale(.72)' }, { opacity: 1, transform: 'translate(205px, 610px) scale(.72)' }], { delay: 900, duration: 900, easing: EASE });
  // 1.20 the ring draws round; its signature turns in
  const ring = $('ring');
  const goldRing = ring && ring.querySelectorAll('circle')[2];
  vb(ring, 500, 500);
  A(ring, [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { delay: 1100, duration: 800, easing: EASE });
  if (goldRing) {
    goldRing.setAttribute('pathLength', '100');
    goldRing.style.strokeDasharray = '100';
    A(goldRing, [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { delay: 1150, duration: 900, easing: SOFT });
  }
  for (const id of ['ring-credit', 'ring-church']) { vb($(id), 500, 500); A($(id), [{ opacity: 0, transform: `rotate(${id === 'ring-credit' ? -10 : 10}deg)` }, { opacity: 1, transform: 'none' }], { delay: 1350, duration: 900, easing: EASE }); }
  // 1.45 the name writes in from right to left · 1.75 the tagline
  A($('title-text'), [{ clipPath: 'inset(-20% -2% -20% 102%)', opacity: 1 }, { clipPath: 'inset(-20% -2% -20% -2%)', opacity: 1 }], { delay: 1450, duration: 650, easing: 'cubic-bezier(.5, 0, .2, 1)' });
  A(svg.querySelector('#title > path'), [{ opacity: 0, transform: 'scaleX(.2)' }, { opacity: 1, transform: 'none' }], { delay: 1850, duration: 500, easing: EASE });
  fb(svg.querySelector('#title > path'));
  A($('tagline'), [{ opacity: 0, transform: 'translateY(16px)', filter: lite ? 'none' : 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { delay: 1750, duration: 600, easing: EASE });
  // 1.90 the cross comes down in light (the bell at 2.05)
  A($('top-cross'), [{ opacity: 0, transform: 'translateY(-80px)' }, { opacity: 1, transform: 'translateY(4px)', offset: .8 }, { opacity: 1, transform: 'none' }], { delay: 1900, duration: 420, easing: 'cubic-bezier(.3, 0, .2, 1)' });
  A(el.querySelector('.br-intro__bloom'), [{ filter: 'brightness(1)' }, { filter: 'brightness(1.9)' }, { filter: 'brightness(1)' }], { delay: 2050, duration: 600, easing: SOFT, composite: 'add' });
  // 2.10 the family seal
  fb($('family-seal'));
  A($('family-seal'), [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], { delay: 2100, duration: 600, easing: SPRING });
  // dust rising through the light (full tier only)
  if (!lite) {
    const dust = el.querySelector('.br-intro__dust');
    for (let i = 0; i < 18; i++) {
      const d = document.createElement('i');
      const x = 30 + ((i * 37) % 40), y = 70 + ((i * 13) % 20);
      d.style.left = x + '%'; d.style.top = y + '%';
      dust.appendChild(d);
      A(d, [{ opacity: 0, transform: 'translateY(0)' }, { opacity: .9, offset: .3 }, { opacity: 0, transform: `translateY(-${120 + (i % 5) * 40}px) translateX(${(i % 2 ? 1 : -1) * (10 + i)}px)` }], { delay: 700 + i * 70, duration: 1900, easing: 'ease-out' });
    }
  }
  // 2.40 the hand-over: the logo glides into the top bar's mark, the dark lifts
  const stage = el.querySelector('.br-intro__stage');
  if (o.target && o.target.getBoundingClientRect().width) {
    const s = stage.getBoundingClientRect(), t = o.target.getBoundingClientRect();
    const dx = (t.left + t.width / 2) - (s.left + s.width / 2), dy = (t.top + t.height / 2) - (s.top + s.height / 2), k = t.width / s.width;
    A(stage, [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 1, offset: .82 }, { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 0 }], { delay: 2400, duration: 600, easing: 'cubic-bezier(.6, 0, .2, 1)' });
  } else {
    A(stage, [{ transform: 'none', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }], { delay: 2400, duration: 600, easing: EASE });
  }
  A(el, [{ backgroundColor: 'rgba(1, 5, 12, 1)' }, { opacity: 1, offset: .3 }, { opacity: 0 }], { delay: 2450, duration: 550, easing: SOFT });
  setTimeout(() => o.onArrive && o.onArrive(), 2450);

  return finish(3000);

  function finish(total) {
    if (o.hold != null) {
      anims.forEach(a => { a.pause(); a.currentTime = o.hold; });
      if (o.hold >= 2450 && o.onArrive) o.onArrive();
      return Promise.resolve(el);
    }
    return new Promise(res => setTimeout(() => {
      el.remove();
      html.classList.remove('br-intro-on');
      res(null);
    }, total));
  }
}

/*
 * When does it play? (decision 15, the rule W5 implements; the prototype runs it as written)
 *   - a load of /daily-bread/ that is not ?from=signin   → play
 *   - pageshow with event.persisted (back from the bfcache) → play
 *   - anything inside the page (history.pushState screens, controls) → never
 */
export function shouldPlayOnLoad(search = location.search) {
  const q = new URLSearchParams(search);
  return q.get('from') !== 'signin' && q.get('intro') !== '0';
}
