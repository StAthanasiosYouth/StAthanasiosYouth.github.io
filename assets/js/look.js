/*
 * LOOK: the member's site colour («لون الموقع», site redesign W2 / approved S3). A classic script in every page's
 * <head>, before the stylesheets, so the first paint is already in the member's colour (no flash of gold).
 *
 * Every gold in the site CSS is a token triplet (--gold-…-rgb, W1). For a colour other than gold this sets each
 * triplet on <html> to the same shade of the chosen colour, by the rule the approved preview used
 * (docs/site-redesign/tint.js): the named golds take the colour's own roles (main, hi, soft, deep, light, ink,
 * mid = a quarter of the way to deep); every other gold keeps its lightness and takes the colour's hue and
 * relative saturation. The navy, the logo, the church art, the platforms' colours and the red alerts stay.
 *
 * The choice lives in the account (/v1/account/prefs → prefs.tint) with a copy beside the session on this device
 * (athanasios.account.look.v1), so it shows at once. No session on this device: gold.
 * No request here, nothing else loaded: assets/js/tint.js is the «لون الموقع» sheet.
 */
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

  /* the CSS tokens (the block in main.css, page.css, comp.css, legal.css, xp-clip.css): [gold value, role or null = shade] */
  var TOKENS = {
    'gold': [[215, 170, 80], 'main'],
    'gold-1a1205': [[26, 18, 5], null],
    'gold-1b1203': [[27, 18, 3], null],
    'gold-3b2a0a': [[59, 42, 10], null],
    'gold-4e3e1e': [[78, 62, 30], null],
    'gold-6f4f1b': [[111, 79, 27], 'deep'],
    'gold-8a6a2c': [[138, 106, 44], null],
    'gold-8c6423': [[140, 100, 35], 'deep'],
    'gold-a8792b': [[168, 121, 43], null],
    'gold-a97b2c': [[169, 123, 44], null],
    'gold-b8862f-shade': [[184, 134, 47], null],
    'gold-b8862f': [[184, 134, 47], 'mid'],
    'gold-b98a35': [[185, 138, 53], null],
    'gold-c39340': [[195, 147, 64], null],
    'gold-c89235': [[200, 146, 53], null],
    'gold-c8973f': [[200, 151, 63], null],
    'gold-c99135': [[201, 145, 53], 'mid'],
    'gold-c99a45': [[201, 154, 69], null],
    'gold-c9ad74': [[201, 173, 116], null],
    'gold-d8ab51': [[216, 171, 81], null],
    'gold-dcb45f': [[220, 180, 95], null],
    'gold-e3b862': [[227, 184, 98], null],
    'gold-e3cf9f': [[227, 207, 159], null],
    'gold-e6be64': [[230, 190, 100], null],
    'gold-e9d3a1': [[233, 211, 161], null],
    'gold-f0d28c': [[240, 210, 140], null],
    'gold-f0d296': [[240, 210, 150], null],
    'gold-f0d8a0': [[240, 216, 160], null],
    'gold-f2dcaa': [[242, 220, 170], null],
    'gold-f4dfae': [[244, 223, 174], null],
    'gold-f6dda0': [[246, 221, 160], null],
    'gold-f6dfa4': [[246, 223, 164], null],
    'gold-fff1c9': [[255, 241, 201], null],
    'gold-fff6dc': [[255, 246, 220], null],
    'gold-deep': [[107, 76, 23], 'deep'],
    'gold-e0b55c': [[224, 181, 92], null],
    'gold-e7c27a': [[231, 194, 122], null],
    'gold-f2e4c4': [[242, 228, 196], null],
    'gold-f3d48e': [[243, 212, 142], null],
    'gold-f7d796': [[247, 215, 150], null],
    'gold-f7dc9b': [[247, 220, 155], null],
    'gold-f7dc9e': [[247, 220, 158], null],
    'gold-f7e2ad': [[247, 226, 173], null],
    'gold-fbf6ec': [[251, 246, 236], null],
    'gold-ffe9ba': [[255, 233, 186], 'light'],
    'gold-fff4d6': [[255, 244, 214], 'light'],
    'gold-hi': [[242, 210, 139], 'hi'],
    'gold-ink': [[27, 19, 6], 'ink'],
    'gold-light': [[255, 236, 190], 'light'],
    'gold-soft': [[231, 207, 156], 'soft']
  };

  var SESSION_KEY = 'athanasios.account.v1';
  var LOOK_KEY = 'athanasios.account.look.v1';
  var html = document.documentElement;

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
  function mix(a, b, t) { return a.map(function (v, i) { return v + (b[i] - v) * t; }); }
  var SG = hsl([215, 170, 80])[1];

  /* { '--gold-…-rgb': 'r, g, b' } for a colour */
  function values(id) {
    var t = T[id], out = {}, tm = hsl(t.main);
    Object.keys(TOKENS).forEach(function (name) {
      var src = TOKENS[name][0], r = TOKENS[name][1], c;
      if (r === 'mid') c = mix(t.main, t.deep, .25);
      else if (r) c = t[r];
      else { var h = hsl(src); c = rgb([tm[0], Math.min(1, tm[1] * h[1] / SG), h[2]]); }
      out['--' + name + '-rgb'] = c.map(Math.round).join(', ');
    });
    return out;
  }

  function apply(id) {
    if (!T[id]) id = 'gold';
    var st = html.style;
    if (id === 'gold') Object.keys(TOKENS).forEach(function (name) { st.removeProperty('--' + name + '-rgb'); });
    else { var v = values(id); Object.keys(v).forEach(function (k) { st.setProperty(k, v[k]); }); }
    html.setAttribute('data-tint', id);
    current = id;
    return id;
  }

  function store(name) { try { return window[name] || null; } catch (e) { return null; } }
  function read(s, key) { try { return JSON.parse(s.getItem(key) || 'null'); } catch (e) { return null; } }
  /* the store that holds this device's session (this tab first, as link.js), or null */
  function home() {
    var list = [store('sessionStorage'), store('localStorage')];
    for (var i = 0; i < list.length; i++) {
      var v = list[i] && read(list[i], SESSION_KEY);
      if (v && typeof v.token === 'string' && /^as1\./.test(v.token)) return list[i];
    }
    return null;
  }
  function saved() {
    var s = home(), v = s && read(s, LOOK_KEY);
    return v && T[v.tint] ? v.tint : 'gold';
  }
  /* keep the account's colour beside the session (no session: nothing kept) */
  function remember(id) {
    var s = home();
    if (!s || !T[id]) return;
    try { s.setItem(LOOK_KEY, JSON.stringify({ tint: id })); } catch (e) { /* full or blocked: next time it is gold until the account loads */ }
  }

  var current = 'gold';
  apply(saved());

  /* a page the browser keeps and shows again (back/forward cache: the home's button goes back in history) and
     another tab of the site take the colour chosen meanwhile, without a reload */
  function again() { var id = saved(); if (id !== current) apply(id); }
  window.addEventListener('pageshow', function (e) { if (e.persisted) again(); });
  window.addEventListener('storage', function (e) { if (!e.key || e.key === LOOK_KEY || e.key === SESSION_KEY) again(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') again(); });

  window.SiteLook = {
    tints: T,
    order: ORDER,
    values: values,
    apply: apply,
    remember: remember,
    saved: saved,
    current: function () { return current; },
    LOOK_KEY: LOOK_KEY
  };
})();
