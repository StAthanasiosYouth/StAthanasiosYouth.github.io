/* S2 — member intro v2: plays each visit for someone who already has an account (?intro=1&v=member).
   0.00–0.70  a gold ring draws itself around the centre, a light point at its tip; faint gold rays turn behind
   0.28–0.85  the logo opens inside the ring; ~0.70 bloom + a light sweep across it (soft bell if sound is allowed)
   0.60–1.15  «مساء الخير» · the name in Ruqaa revealed right-to-left · gold rule · chip with the next meeting
   1.30–2.08  text lifts away, the ring opens out, the logo flies on a curve into the top bar; the page rises in behind
   2.08       the bar logo lands with a small gold pulse
   ?freeze=<ms> holds one moment for review frames. Tap skips. Reduced motion: no intro. */
(function () {
  var Q = new URLSearchParams(location.search);
  if (!Q.get('intro') || Q.get('v') !== 'member' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var FREEZE = Q.get('freeze') != null ? Number(Q.get('freeze')) : null;
  var EXPO = 'cubic-bezier(.16,1,.3,1)', QUART = 'cubic-bezier(.76,0,.24,1)', OUT = 'cubic-bezier(.22,1,.36,1)';
  var target = document.querySelector('.top__brand img');
  var hr = new Date().getHours(), hi = hr < 12 ? 'صباح الخير' : 'مساء الخير';
  var CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>';
  var el = document.createElement('div');
  el.className = 'mi';
  el.innerHTML = '<div class="mi__bg"><div class="mi__art"></div><div class="mi__veil"></div></div>' +
    '<div class="mi__stage"><div class="mi__core"><div class="mi__seal">' +
    '<span class="mi__bloom"></span>' +
    '<svg class="mi__svg" viewBox="0 0 100 100"><defs><linearGradient id="miGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1c9"/><stop offset=".5" stop-color="#e3b862"/><stop offset="1" stop-color="#a97b2c"/></linearGradient></defs>' +
    '<circle class="mi__track" cx="50" cy="50" r="48"/><circle class="mi__draw" cx="50" cy="50" r="48" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg>' +
    '<span class="mi__head"><i></i></span>' +
    '<div class="mi__disc"><img src="../../assets/img/logo-512.png" alt=""><span class="mi__shine"></span></div>' +
    '</div><div class="mi__text"><span class="mi__hi">' + hi + '</span><span class="mi__name">مينا</span><span class="mi__rule"></span>' +
    '<span class="mi__chip">' + CAL + 'الاجتماع الأحد ٨ بالليل · <b>فاضل ٥ أيام</b></span></div></div></div>';
  document.body.appendChild(el);
  target.classList.add('is-waiting');
  var $ = function (s) { return el.querySelector(s); }, anims = [];
  function A(n, kf, o) { var a = (typeof n === 'string' ? $(n) : n).animate(kf, Object.assign({ fill: 'both', easing: EXPO }, o)); anims.push(a); return a; }

  // background: faint gold rays turn slowly behind the seal
  A('.mi__art', [{ transform: 'rotate(-8deg) scale(.9)', opacity: 0 }, { transform: 'rotate(0deg) scale(1)', opacity: 1, offset: .5 }, { transform: 'rotate(4deg) scale(1.04)', opacity: 1 }], { duration: 2000, easing: OUT });
  // 1) the ring draws itself, a light point rides its tip
  A('.mi__draw', [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: 700, easing: QUART });
  A('.mi__head', [{ transform: 'rotate(0deg)', opacity: 1 }, { transform: 'rotate(360deg)', opacity: 1, offset: .96 }, { transform: 'rotate(360deg)', opacity: 0 }], { duration: 730, easing: QUART });
  A('.mi__track', [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
  // 2) the logo opens inside the ring, bloom + light sweep when the ring closes
  A('.mi__disc', [{ clipPath: 'circle(0% at 50% 50%)', transform: 'scale(1.12)' }, { clipPath: 'circle(50% at 50% 50%)', transform: 'scale(1)' }], { duration: 560, delay: 280 });
  A('.mi__disc img', [{ filter: 'brightness(1.8) saturate(.4)' }, { filter: 'brightness(1) saturate(1)' }], { duration: 700, delay: 300 });
  A('.mi__bloom', [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)', offset: .35 }, { opacity: .35, transform: 'scale(1.15)' }], { duration: 900, delay: 640, easing: 'ease-out', fill: 'backwards' });
  A('.mi__shine', [{ transform: 'translateX(70%)' }, { transform: 'translateX(-70%)' }], { duration: 650, delay: 700, easing: 'cubic-bezier(.4,0,.2,1)' });
  // 3) the greeting
  A('.mi__hi', [{ opacity: 0, transform: 'translateY(6px)', letterSpacing: '.3em' }, { opacity: 1, transform: 'none', letterSpacing: '.02em' }], { duration: 520, delay: 600 });
  A('.mi__name', [{ clipPath: 'inset(-40% -10% -40% 110%)', transform: 'translateX(-10px)' }, { clipPath: 'inset(-40% -10% -40% -10%)', transform: 'none' }], { duration: 560, delay: 700, easing: QUART });
  A('.mi__rule', [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }], { duration: 500, delay: 860 });
  A('.mi__chip', [{ opacity: 0, transform: 'translateY(8px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 460, delay: 960 });

  // 4) exit, measured from the real top-bar logo
  var seal = $('.mi__seal'), a = seal.getBoundingClientRect(), b = target.getBoundingClientRect();
  var dx = (b.left + b.width / 2) - (a.left + a.width / 2), dy = (b.top + b.height / 2) - (a.top + a.height / 2), sc = b.width / a.width;
  var T0 = 1300, FLY = 720;
  A('.mi__text', [{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateY(-14px)', filter: 'blur(4px)' }], { duration: 320, delay: T0, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
  A('.mi__svg', [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.5)' }], { duration: 420, delay: T0 + 40, easing: 'ease-out', fill: 'forwards' });
  A('.mi__bloom', [{ opacity: .35 }, { opacity: 0 }], { duration: 300, delay: T0 + 40, fill: 'forwards' });
  // a gentle arc: a small drift first, then up into the bar
  A(seal, [
    { transform: 'translate(0px,0px) scale(1)' },
    { transform: 'translate(' + dx * .18 + 'px,' + (dy * .1 + 8) + 'px) scale(1.04)', offset: .16 },
    { transform: 'translate(' + dx * .72 + 'px,' + dy * .86 + 'px) scale(' + (sc * 1.5) + ')', offset: .78 },
    { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')' }
  ], { duration: FLY, delay: T0 + 60, easing: 'cubic-bezier(.55,.05,.25,1)', fill: 'forwards' });
  A('.mi__bg', [{ opacity: 1 }, { opacity: 0 }], { duration: 560, delay: T0 + 180, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
  // the page rises in behind: bar slides down, sections lift one after another
  var top = document.querySelector('.top'), parts = [].slice.call(document.querySelectorAll('main > *')).slice(0, 6);
  anims.push(top.animate([{ transform: 'translateY(-100%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 520, delay: T0 + 200, easing: EXPO, fill: 'backwards' }));
  parts.forEach(function (p, i) { anims.push(p.animate([{ transform: 'translateY(26px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 640, delay: T0 + 300 + i * 70, easing: EXPO, fill: 'backwards' })); });
  var LAND = T0 + 60 + FLY, END = LAND + 20;

  // sound: only if the browser already allows it (no gate for members)
  try {
    var AC = window.AudioContext || window.webkitAudioContext, ac = AC && new AC();
    if (ac && ac.state === 'running' && FREEZE == null) {
      var bus = ac.createGain(); bus.gain.value = .5; bus.connect(ac.destination);
      var bell = function (t, f, g, d) { var o = ac.createOscillator(), e = ac.createGain(), s = ac.currentTime + t; o.type = 'sine'; o.frequency.value = f; e.gain.setValueAtTime(0, s); e.gain.linearRampToValueAtTime(g, s + .01); e.gain.exponentialRampToValueAtTime(.0001, s + d); o.connect(e); e.connect(bus); o.start(s); o.stop(s + d + .05); };
      [[.68, 784, .16, 1.6], [.68, 1568, .05, 1.1], [.78, 1175, .1, 1.4], [LAND / 1000, 1318, .07, .7]].forEach(function (x) { bell.apply(null, x); });
    } else if (ac) ac.close();
  } catch (e) {}

  function done() { target.classList.remove('is-waiting'); target.classList.add('is-landed'); el.remove(); }
  if (FREEZE != null) { anims.forEach(function (x) { x.pause(); x.currentTime = FREEZE; }); if (FREEZE >= END) { el.remove(); target.classList.remove('is-waiting'); } return; }
  setTimeout(done, END);
  el.addEventListener('click', function () { anims.forEach(function (x) { try { x.finish(); } catch (e) {} }); done(); });
})();
