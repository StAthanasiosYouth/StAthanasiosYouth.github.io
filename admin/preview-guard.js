/*
 * PREVIEW GUARD — loaded first inside the admin's preview frame («معاينة»),
 * only when the admin runs on the site's own origin (GitHub Pages /admin/).
 *
 * That frame shares this origin's storage with the real site on this
 * browser. Before any of the site's code runs, give the page a storage of
 * its own, in memory, gone when the preview closes: the draft is never
 * saved as site content, and the bell, sound and scene state of the real
 * site are never touched.
 */

(function () {

  'use strict';

  if (!document.documentElement.hasAttribute('data-preview') || window.parent === window) return;

  function memoryStorage() {

    var data = new Map();

    return Object.freeze({
      get length() { return data.size; },
      key: function (index) { var keys = Array.from(data.keys()); return index >= 0 && index < keys.length ? keys[index] : null; },
      getItem: function (key) { key = String(key); return data.has(key) ? data.get(key) : null; },
      setItem: function (key, value) { data.set(String(key), String(value)); },
      removeItem: function (key) { data.delete(String(key)); },
      clear: function () { data.clear(); }
    });

  }

  ['localStorage', 'sessionStorage'].forEach(function (name) {

    var own = memoryStorage();

    try {
      Object.defineProperty(window, name, { configurable: true, enumerable: true, get: function () { return own; } });
    }
    catch (error) {
      // can't swap it: then no storage at all (the site's code copes, it's
      // the same as a browser that blocks storage)
      try { Object.defineProperty(window, name, { configurable: true, get: function () { throw new DOMException('preview', 'SecurityError'); } }); }
      catch (ignored) { /* nothing more we can do */ }
    }

  });

})();
