// Builds admin/review-kit.js: the browser-side «راجع» (Phase 4 P4-4, moved from Phase 2 P2-7 by the owner).
// The SAME pure builders the Worker and Apps Script run (Content.gs buildPublicContent, Review.gs
// describeChanges, Pages.gs pagesBuildPublic_ …), so the admin sees the review at once from the drafts it
// already holds, the live content.json (ETag-cached) and the competitions' part (content/comps.js).
//
//   window.ReviewKit.review({ drafts, live, comps, now }) → { revision, changes, groups, errors, warnings }
//     drafts: GET /v1/admin/content/review-input → kinds ({ kind: { rows: [{ id, data }] } })
//     live:   the live content.json (or null); comps: that reply's competitions part; now: Cairo 'YYYY-MM-DDTHH:MM'
//
// Run after changing any of FILES:  cd tools && node build-review-kit.mjs
// worker/test/review-kit.test.mjs fails when the file is stale or when its review differs from the Worker's.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ROOT } from './lib/gs.mjs';

// CompModel.gs before Pages.gs: Pages.gs reads COMP_SITE_CSP when it loads
// CompStore.gs: the Cairo wall-clock helpers (compWallMs_) the page build uses
export const FILES = ['Platforms.gs', 'Content.gs', 'Hub.gs', 'Review.gs', 'Seed.gs', 'BookModel.gs', 'CompModel.gs', 'CompStore.gs', 'Pages.gs', 'Store.gs'];

const RUNTIME = String.raw`
  /* what these files call from Apps Script, for a pure build only */
  var console = { log: function () {}, warn: function () {}, error: function () {} };
  var Utilities = {
    formatDate: function (date, timeZone, pattern) {
      var parts = {};
      new Intl.DateTimeFormat('en-US', { timeZone: timeZone === 'UTC' ? 'UTC' : timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
      return pattern.split(/('[^']*')/).map(function (chunk) {
        if (chunk.charAt(0) === "'") return chunk.slice(1, -1);
        return chunk.replace(/yyyy/g, parts.year).replace(/MM/g, parts.month).replace(/dd/g, parts.day)
          .replace(/HH/g, parts.hour).replace(/mm/g, parts.minute).replace(/ss/g, parts.second);
      }).join('');
    }
  };
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256Hex_(text) {
    var bytes = new TextEncoder().encode(String(text));
    var len = bytes.length, total = ((len + 9 + 63) >> 6) << 6, m = new Uint8Array(total);
    m.set(bytes); m[len] = 0x80;
    var dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor(len * 8 / 0x100000000)); dv.setUint32(total - 4, (len * 8) >>> 0);
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = new Array(64);
    var rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h = [(h[0] + a) >>> 0, (h[1] + b) >>> 0, (h[2] + c) >>> 0, (h[3] + d) >>> 0, (h[4] + e) >>> 0, (h[5] + f) >>> 0, (h[6] + g) >>> 0, (h[7] + hh) >>> 0];
    }
    return h.map(function (x) { return ('00000000' + x.toString(16)).slice(-8); }).join('');
  }
  /* the Script Properties a build reads (Pages.gs bookOnline_): from the review input (props) */
  var PROPS_ = {};
  var PropertiesService = { getScriptProperties: function () { return { getProperty: function (k) { return Object.prototype.hasOwnProperty.call(PROPS_, k) ? String(PROPS_[k]) : null; } }; } };
  var COMPS_ = null;
  var EMPTY_COMPS_ = { index: [], live: {}, withdrawn: [], byId: {}, slugs: {}, media: [] };
  function compBuildPublic_(draft, ctx) {
    (COMPS_ && COMPS_.errors || []).forEach(function (e) { ctx.error(e.where, e.message); });
    (COMPS_ && COMPS_.warnings || []).forEach(function (w) { ctx.warn(w.where, w.message); });
    return JSON.parse(JSON.stringify(COMPS_ && COMPS_.built || EMPTY_COMPS_));
  }
  function compReviewInfo_() { return JSON.parse(JSON.stringify(COMPS_ && COMPS_.reviewInfo || {})); }

  /* the drafts read (GET /v1/admin/content/review-input) → readDraftNow_'s shape (Store.gs) */
  function draftOf_(kinds) {
    var rows = function (kind) {
      return ((kinds[kind] && kinds[kind].rows) || []).map(function (r, i) { var copy = JSON.parse(JSON.stringify(r.data)); copy.index = i; return copy; });
    };
    var plain = function (kind) { return rows(kind).map(function (r) { delete r.index; return r; }); };
    var settings = Object.create(null);
    SETTINGS_SPEC.forEach(function (spec) { settings[spec[0]] = ''; });
    rows('settings').forEach(function (r) { if (r.key) settings[r.key] = r.value; });
    return {
      settings: settings, sections: rows('sections'), links: rows('links'), contacts: rows('contacts'), sessions: rows('sessions'),
      news: rows('news'), games: rows('games'), notifications: rows('notifications'), media: rows('media'), activities: rows('activities'), types: rows('types'),
      competitions: COMPS_ && !COMPS_.none ? { points: COMPS_.points || null, modules: COMPS_.modules || {} } : null,
      pages: { pages: plain('pages'), media: plain('page_media'), events: plain('events'), servants: plain('servants'), methods: pagesMethods_(plain('pay_methods')) }
    };
  }

  function review_(input) {
    COMPS_ = input.comps || null;
    PROPS_ = input.props || {};
    var built = buildPublicContent(draftOf_(input.drafts || {}), { now: input.now, hash: sha256Hex_ });
    var entries = describeChanges(input.live || null, built.content, input.now, { competitions: compReviewInfo_(built.competitions) });
    return {
      revision: built.content.revision,
      changes: entries.map(function (e) { return e.text + (e.when ? ' — ' + e.when : ''); }),
      groups: groupChanges_(entries),
      errors: built.errors,
      warnings: built.warnings,
      githubError: ''
    };
  }
`;

export function build() {
  const parts = FILES.map(f => `/* ---- apps-script/${f} ---- */\n` + readFileSync(`${ROOT}apps-script/${f}`, 'utf8').replace(/\r\n/g, '\n'));
  const hash = createHash('sha256').update(parts.join('\n') + RUNTIME).digest('hex').slice(0, 16);
  const text = `// GENERATED by tools/build-review-kit.mjs from apps-script/{${FILES.join(',')}} — source ${hash}.
// Do not edit: change apps-script/ and run \`cd tools && node build-review-kit.mjs\`.
/* eslint-disable */
(function (root) {
  'use strict';
  var KIT_SOURCE = '${hash}';
  var make = function () {
${parts.join('\n\n')}
    /* ---- the kit's own (declared last: they replace the files' compBuildPublic_ and friends) ---- */
${RUNTIME}
    return { review: review_, source: KIT_SOURCE };
  };
  root.ReviewKit = { source: KIT_SOURCE, review: function (input) { return make().review(input); } };
})(typeof window !== 'undefined' ? window : globalThis);
`;
  return { text, hash };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/build-review-kit.mjs')) {
  const { text, hash } = build();
  writeFileSync(`${ROOT}admin/review-kit.js`, text);
  console.log(`admin/review-kit.js: ${(text.length / 1024).toFixed(0)} KB, source ${hash}`);
}
