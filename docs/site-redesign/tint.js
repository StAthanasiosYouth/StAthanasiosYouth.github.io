/* S3 — the member's site colour («لون الموقع»), on the S2 final page (final.html, the live code).
   The live CSS writes the gold two ways: tokens (--gold, --gold-hi…) and ~half as fixed values (rgba(215, 170, 80, …)).
   For a true preview this file re-colours the live stylesheets themselves as they load: every gold value, token or fixed,
   becomes the chosen colour (glows, hairlines, buttons, titles, the bar). The navy, the logo, the church art, the brand
   colours of the platforms and the red alerts stay as they are. At build time the fixed values become tokens and this
   runs as one small token swap before the first paint (BRIEF §3).
   ?tint=<id> shows a colour · ?picker=1 opens the sheet · the choice is kept (here in localStorage; on the site: the account). */
(function () {
  'use strict';
  var T = {
    gold:    { name: 'ذهبي',    note: 'الأصلي', main: [215, 170, 80],  hi: [242, 210, 139], soft: [231, 207, 156], deep: [107, 76, 23],  light: [255, 236, 190], ink: [27, 19, 6] },
    sea:     { name: 'فيروزي',  note: 'لون البحر الأحمر', main: [76, 195, 203],  hi: [159, 231, 236], soft: [191, 233, 236], deep: [11, 63, 79],   light: [214, 248, 250], ink: [3, 33, 38] },
    emerald: { name: 'زمردي',   note: '', main: [79, 202, 140],  hi: [166, 239, 200], soft: [195, 236, 214], deep: [14, 74, 48],   light: [214, 250, 230], ink: [4, 34, 20] },
    rose:    { name: 'وردي',    note: '', main: [232, 120, 159], hi: [248, 185, 207], soft: [242, 207, 219], deep: [93, 26, 51],   light: [253, 224, 234], ink: [46, 8, 22] },
    ember:   { name: 'برتقالي', note: '', main: [239, 138, 76],  hi: [255, 195, 154], soft: [246, 210, 184], deep: [110, 42, 18],  light: [255, 230, 212], ink: [46, 18, 4] },
    violet:  { name: 'بنفسجي',  note: '', main: [154, 149, 238], hi: [207, 204, 255], soft: [220, 218, 248], deep: [37, 34, 107],  light: [233, 232, 255], ink: [18, 16, 61] },
    silver:  { name: 'فضي',     note: '', main: [176, 190, 210], hi: [226, 233, 243], soft: [213, 220, 231], deep: [52, 64, 82],   light: [240, 244, 250], ink: [14, 20, 30] }
  };
  var ORDER = ['gold', 'sea', 'emerald', 'rose', 'ember', 'violet', 'silver'];
  var KEY = 's2.site-tint';
  var html = document.documentElement;
  var Q = new URLSearchParams(location.search);
  var cur = Q.get('tint') || (function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } })() || 'gold';
  if (!T[cur]) cur = 'gold';

  function hex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join(''); }
  function mix(a, b, t) { return a.map(function (v, i) { return v + (b[i] - v) * t; }); }
  /* gold value → role (the live CSS's golds) */
  var RGB = [[[242, 210, 139], 'hi'], [[215, 170, 80], 'main'], [[231, 207, 156], 'soft'], [[184, 134, 47], 'mid'], [[201, 145, 53], 'mid'], [[255, 236, 190], 'light'], [[255, 233, 186], 'light'], [[107, 76, 23], 'deep'], [[27, 19, 6], 'ink']];
  var HEX = [['#f2d28b', 'hi'], ['#d7aa50', 'main'], ['#e7cf9c', 'soft'], ['#c99a43', 'mid'], ['#1b1306', 'ink'], ['#6b4c17', 'deep'], ['#6f4f1b', 'deep'], ['#8c6423', 'deep'], ['#fff4d6', 'light']];
  function hsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
    if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
    return [h, s, l];
  }
  function rgb(x) {
    var h = x[0], s = x[1], l = x[2], c = (1 - Math.abs(2 * l - 1)) * s, k = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, v;
    v = h < 60 ? [c, k, 0] : h < 120 ? [k, c, 0] : h < 180 ? [0, c, k] : h < 240 ? [0, k, c] : h < 300 ? [k, 0, c] : [c, 0, k];
    return v.map(function (q) { return (q + m) * 255; });
  }
  function role(t, r) { return r === 'mid' ? mix(t.main, t.deep, .25) : t[r]; }
  function recolor(css, id, base) {
    var t = T[id];
    RGB.forEach(function (p) {
      var c = role(t, p[1]).map(Math.round);
      css = css.replace(new RegExp('(rgba?\\(\\s*)' + p[0][0] + '(\\s*,?\\s*)' + p[0][1] + '(\\s*,?\\s*)' + p[0][2] + '\\b', 'g'), '$1' + c[0] + '$2' + c[1] + '$3' + c[2]);
    });
    HEX.forEach(function (p) { css = css.replace(new RegExp(p[0], 'gi'), hex(role(t, p[1]))); });
    // every other shade of the identity gold (the live CSS has ~30: darker for pressed buttons, lighter for glints):
    // same lightness, the chosen colour's hue and saturation. Brand yellows (Instagram, the Mac dots…) are more saturated and stay.
    var tm = hsl(t.main), SG = hsl([215, 170, 80])[1];
    function shade(c) { var h = hsl(c); if (h[0] < 32 || h[0] > 50 || h[1] < .28 || h[1] > .86 || h[2] < .06 || h[2] > .96) return null; return rgb([tm[0], Math.min(1, tm[1] * h[1] / SG), h[2]]); }
    css = css.replace(/#([0-9a-f]{6})\b/gi, function (m, x) { var n = shade([parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]); return n ? hex(n) : m; });
    css = css.replace(/(rgba?\(\s*)(\d{1,3})(\s*,?\s*)(\d{1,3})(\s*,?\s*)(\d{1,3})\b/g, function (m, a, r, s1, g, s2, b) { var n = shade([+r, +g, +b]); return n ? a + Math.round(n[0]) + s1 + Math.round(n[1]) + s2 + Math.round(n[2]) : m; });
    // the sheet now lives inline: its relative urls (fonts, images) keep pointing where they did
    return css.replace(/url\(\s*(['"]?)(?!data:|https?:|\/|#)([^'")]+)\1\s*\)/g, function (m, q, u) { return 'url("' + new URL(u, base).href + '")'; });
  }

  var SRC = {};          // href → original text
  function ours(link) { return /\/(assets\/css|docs\/site-redesign)\//.test(link.href) && !/gallery|changes/i.test(link.href); }
  function paint(link) {
    if (!ours(link)) return Promise.resolve();
    var href = link.href;
    var got = SRC[href] ? Promise.resolve(SRC[href]) : fetch(href, { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) { SRC[href] = t; return t; });
    return got.then(function (text) {
      var st = link.nextElementSibling && link.nextElementSibling.dataset && link.nextElementSibling.dataset.tintFor === href ? link.nextElementSibling : null;
      if (cur === 'gold') { if (st) st.remove(); link.disabled = false; return; }
      if (!st) { st = document.createElement('style'); st.dataset.tintFor = href; link.after(st); }
      st.textContent = recolor(text, cur, href);
      link.disabled = true;
    }).catch(function () {});
  }
  function paintAll() { return Promise.all([].map.call(document.querySelectorAll('link[rel="stylesheet"]'), paint)); }

  // hold the first paint while a non-gold page is being coloured (no flash of gold)
  var hold = document.createElement('style');
  hold.textContent = 'html.tint-pending body { opacity: 0 !important; }';
  document.head.appendChild(hold);
  function set(id, opts) {
    if (!T[id]) return;
    cur = id;
    html.setAttribute('data-tint', id);
    if (opts && opts.save) { try { localStorage.setItem(KEY, id); } catch (e) {} }
    return paintAll().then(function () { html.classList.remove('tint-pending'); document.dispatchEvent(new CustomEvent('s2:tint', { detail: id })); });
  }
  html.setAttribute('data-tint', cur);
  if (cur !== 'gold') { html.classList.add('tint-pending'); setTimeout(function () { html.classList.remove('tint-pending'); }, 2500); }
  // stylesheets the live modules add later (the bar, the sheets, the map) get the colour too
  new MutationObserver(function (ms) {
    ms.forEach(function (m) { [].forEach.call(m.addedNodes, function (n) { if (n.tagName === 'LINK' && n.rel === 'stylesheet') n.addEventListener('load', function () { paint(n); }, { once: true }); }); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', function () { set(cur); if (Q.get('picker')) open(); });

  /* ---------- the sheet: «لون الموقع» ---------- */
  var saved = cur;
  function swatch(id) {
    var t = T[id], m = hex(t.main), h = hex(t.hi), d = hex(t.deep);
    return '<button type="button" class="tint-opt" data-id="' + id + '" aria-pressed="false" style="--m:' + m + ';--h:' + h + ';--d:' + d + ';--k:' + hex(t.ink) + '">' +
      '<span class="tint-opt__sw"><i></i></span><span class="tint-opt__name">' + t.name + '</span>' + (t.note ? '<small>' + t.note + '</small>' : '<small>&nbsp;</small>') +
      '<span class="tint-opt__demo"><em></em><b></b></span><span class="tint-opt__ok" aria-hidden="true">✓</span></button>';
  }
  function open() {
    if (document.querySelector('.tint-sheet')) return;
    saved = cur;
    var w = document.createElement('div');
    w.className = 'tint-sheet';
    w.innerHTML = '<div class="tint-sheet__scrim"></div><section class="tint-sheet__box" role="dialog" aria-modal="true" aria-labelledby="tint-t">' +
      '<span class="tint-sheet__grip" aria-hidden="true"></span>' +
      '<header><div><h2 id="tint-t">لون الموقع</h2><p>اختار اللون اللي تحبه. بيتحفظ في حسابك، والموقع بيفتح بيه على أي جهاز تدخل منه.</p></div><button type="button" class="tint-x" aria-label="اقفل">×</button></header>' +
      '<div class="tint-grid">' + ORDER.map(swatch).join('') + '</div>' +
      '<p class="tint-note">الموقع بيتلوّن قدامك وإنت بتختار. اللوجو وصور الكنيسة وألوان فيسبوك وتيك توك بيفضلوا زي ما هما.</p>' +
      '<footer><button type="button" class="btn btn--primary tint-save">احفظ اللون</button><button type="button" class="btn tint-reset">رجّع الذهبي</button></footer></section>';
    document.body.appendChild(w);
    mark();
    w.querySelector('.tint-grid').addEventListener('click', function (e) { var b = e.target.closest('.tint-opt'); if (b) set(b.dataset.id).then(mark); });
    w.querySelector('.tint-save').addEventListener('click', function () { set(cur, { save: true }); saved = cur; close(true); });
    w.querySelector('.tint-reset').addEventListener('click', function () { set('gold').then(mark); });
    w.querySelector('.tint-x').addEventListener('click', function () { close(false); });
    w.querySelector('.tint-sheet__scrim').addEventListener('click', function () { close(false); });
    requestAnimationFrame(function () { w.classList.add('is-open'); });
  }
  function mark() { [].forEach.call(document.querySelectorAll('.tint-opt'), function (b) { var on = b.dataset.id === cur; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); }); }
  function close(keep) {
    var w = document.querySelector('.tint-sheet'); if (!w) return;
    if (!keep && cur !== saved) set(saved);
    w.classList.remove('is-open'); setTimeout(function () { w.remove(); }, 320);
    if (keep && window.S2_TOAST) window.S2_TOAST('اتحفظ اللون: ' + T[cur].name);
  }
  window.S2Tint = { set: set, open: open, list: ORDER, names: T };
})();
