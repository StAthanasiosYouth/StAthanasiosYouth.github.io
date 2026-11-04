/*
 * Phase 8 A1: this admin's look of the panel (theme, accent, density, motion)
 * on <html> before anything is drawn (not deferred), from the copy kept on this
 * device (AdminScript.html «LOOK»), so the first frame is in the right colours;
 * and (A2) whether the rail is folded, so it never jumps. It reads those two
 * entries, keeps only known values, and sends nothing.
 */
(function () {
  try {
    document.documentElement.setAttribute('data-rail', window.localStorage.getItem('athanasios-admin.rail') === 'closed' ? 'closed' : 'open');
  }
  catch (ignored) {
    // the rail open
  }
  try {
    var p = JSON.parse(window.localStorage.getItem('athanasios-admin.prefs.v1') || 'null');
    p = p && (p.prefs || p);
    if (!p) return;
    var root = document.documentElement;
    var mq = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
    var pick = function (v, list, d) { return list.indexOf(v) !== -1 ? v : d; };
    var theme = pick(p.theme, ['dark', 'light', 'system'], 'dark');
    root.setAttribute('data-mode', theme === 'light' || (theme === 'system' && mq('(prefers-color-scheme: light)')) ? 'light' : 'dark');
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-accent', pick(p.accent, ['gold', 'sea', 'carmine', 'azure', 'emerald', 'violet'], 'gold'));
    root.setAttribute('data-density', pick(p.density, ['comfortable', 'compact'], 'comfortable'));
    root.setAttribute('data-motion', mq('(prefers-reduced-motion: reduce)') ? 'off' : pick(p.motion, ['full', 'lite', 'off'], 'full'));
  }
  catch (ignored) {
    // no copy here: the default look
  }
})();
