// Serves the real admin panel (apps-script/*.html) with google.script.run
// forwarded to the real .gs code running in a fake Apps Script world
// (tests/fakes/gas.mjs). Used by tools/admin-preview.mjs and the admin e2e.

import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT } from './gs.mjs';

const SHIM = `<script>
// google.script.run stand-in: forwards calls to the preview server
(function () {
  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return function (fn) { return runner(fn, fail); };
        if (name === 'withFailureHandler') return function (fn) { return runner(ok, fn); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          fetch('/api/' + name, { method: 'POST', body: JSON.stringify(args) })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              if (res.ok) { if (ok) ok(res.value); }
              else if (fail) fail(new Error(res.error));
            })
            .catch(function () { if (fail) fail(new Error('NetworkError: Connection failure due to HTTP 0')); });
        };
      }
    });
  }
  window.google = { script: { run: runner() } };
})();
</script>`;

export function adminPage() {

  const read = name => readFileSync(`${ROOT}apps-script/${name}.html`, 'utf8');

  // doGet adds this with addMetaTag() in production
  return read('Admin')
    .replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
    .replace(/<\?!= include_\('(\w+)'\) \?>/g, (_, name) => (name === 'AdminScript' ? SHIM : '') + read(name));

}

/**
 * options.world   a createWorld() result, already set up
 * options.admin   the signed-in email
 * options.latency ms added to every call ("feels like the network")
 * options.calls   optional array that receives every api call name
 */
export function createAdminServer({ world, admin, latency = 250, calls = null }) {

  return createServer((req, res) => {

    if (req.method === 'POST' && req.url.startsWith('/api/')) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const name = req.url.slice(5);
        if (calls) calls.push(name);
        let payload;
        try {
          if (!/^api\w+$/.test(name) || typeof world.gs[name] !== 'function') throw new Error('unknown function ' + name);
          payload = { ok: true, value: JSON.parse(JSON.stringify(world.as(admin).gs[name](...JSON.parse(body || '[]')) ?? null)) };
        }
        catch (error) {
          payload = { ok: false, error: error.message };
        }
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(payload));
        }, latency);
      });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(adminPage());

  });

}


/* =========================================================
   THE OFFICIAL ADMIN PAGE (GitHub Pages /admin/), locally
========================================================= */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.ics': 'text/calendar; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

// like _config.yml: these never reach the website
const PRIVATE = /^\/(apps-script|tools|tests|docs|node_modules)(\/|$)|\/\.|\.md$/i;

/** the fake deployment the page talks to (intercepted in the browser) */
export const TEST_API = 'https://script.google.com/macros/s/AKfycbTESTdeploymentForRefineB_e2e/exec';
export const TEST_CLIENT = 'test-client.apps.googleusercontent.com';
export const TEST_FALLBACK = 'https://script.google.com/macros/s/AKfycbFALLBACKrecoveryAdmin_e2e/exec';

/**
 * The site (GitHub Pages-like) with the static admin at /admin/.
 * options.world      the fake Apps Script world (owner mode) behind the API
 * options.config     () => the admin/config.js values for this moment
 * options.claims     () => claims for the next test sign-in token (GET /__test/token)
 * /content.json is the last one published to the fake GitHub (else the repo's).
 */
export function createSiteServer({ world, config, claims = () => ({}) }) {

  return createServer((req, res) => {

    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);

      if (path === '/admin/config.js') {
        res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
        res.end(`window.ADMIN_CONFIG = Object.freeze(${JSON.stringify(config())});\n`);
        return;
      }

      if (path === '/__test/token') {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end(world.issueToken(claims()));
        return;
      }

      const published = path === '/content.json' && world.github.files()['content.json'];
      if (published) {
        res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(published);
        return;
      }

      if (PRIVATE.test(path)) throw new Error('private');
      const file = normalize(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
      if (!file.startsWith(normalize(ROOT)) || !statSync(file).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(readFileSync(file));
    }
    catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
    }

  });

}

/*
 * Google Identity Services, for tests: the same API surface the page uses.
 * The button asks the local test server for a token (whatever account the
 * test chose) and hands it over like Google does. prompt() signs in again
 * silently only when the test sets window.__gisSilent.
 */
export const GIS_STUB = `(function () {
  var options = null;
  function hand(selectBy) {
    fetch('/__test/token', { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (token) {
      window.__gisIssued = (window.__gisIssued || 0) + 1;
      options.callback({ credential: token, select_by: selectBy });
    });
  }
  window.google = window.google || {};
  window.google.accounts = { id: {
    initialize: function (o) { options = o; window.__gisOptions = { client_id: o.client_id, auto_select: o.auto_select }; },
    renderButton: function (host) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'gis-stub';
      button.textContent = 'تسجيل الدخول باستخدام Google';
      button.style.cssText = 'display:inline-flex;align-items:center;gap:10px;min-height:44px;padding:0 22px;border:1px solid #747775;border-radius:999px;background:#131314;color:#e3e3e3;font:600 15px Cairo,system-ui;cursor:pointer';
      var g = document.createElement('span');
      g.textContent = 'G';
      g.style.cssText = 'display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#fff;color:#4285f4;font:800 14px Arial';
      button.prepend(g);
      button.addEventListener('click', function () { hand('btn'); });
      host.appendChild(button);
    },
    prompt: function () { if (window.__gisSilent) hand('auto'); },
    disableAutoSelect: function () { window.__gisAutoDisabled = true; },
    cancel: function () {}
  } };
})();`;

/**
 * Browser side: Google sign-in and the API deployment, answered locally.
 * POST <TEST_API> → world.post(body), served the way Apps Script does it:
 * a 302 to script.googleusercontent.com, whose GET returns the JSON.
 * Everything else outside the local site is refused (and recorded).
 */
export async function interceptGoogle(page, world, { outside = [], calls = [], site = null } = {}) {

  const echoes = new Map();
  let echo = 0;

  await page.setRequestInterception(true);

  page.on('request', async request => {
    const url = request.url();
    try {
      // site = { origin: 'https://stathanasiosyouth.github.io', local: 'http://localhost:4540' }:
      // the real address, answered by the local site server
      if (site && url.startsWith(site.origin + '/')) {
        const response = await fetch(site.local + url.slice(site.origin.length), { method: request.method(), headers: { 'cache-control': 'no-store' } });
        const headers = {};
        response.headers.forEach((value, key) => { if (!/^(content-length|content-encoding|transfer-encoding|connection|keep-alive)$/i.test(key)) headers[key] = value; });
        return request.respond({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
      }
      if (url === 'https://accounts.google.com/gsi/client') {
        return request.respond({ status: 200, contentType: 'text/javascript', body: GIS_STUB });
      }
      if (url === TEST_API && request.method() === 'POST') {
        const body = request.postData() ?? (request.hasPostData() ? await request.fetchPostData() : '');
        const parsed = JSON.parse(body || '{}');
        calls.push({ fn: parsed.fn, contentType: request.headers()['content-type'], cookie: request.headers().cookie || '' });
        const reply = world.post(body);
        delete reply.mime;
        const key = `k${++echo}`;
        echoes.set(key, JSON.stringify(reply));
        return request.respond({ status: 302, headers: { Location: `https://script.googleusercontent.com/macros/echo?user_content_key=${key}`, 'Access-Control-Allow-Origin': '*' }, body: '' });
      }
      if (url.startsWith('https://script.googleusercontent.com/macros/echo?user_content_key=')) {
        const key = new URL(url).searchParams.get('user_content_key');
        return request.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: echoes.get(key) || '{}' });
      }
      if (/^(https?:\/\/(localhost|127\.0\.0\.1)[:/]|data:|blob:|about:)/.test(url)) return request.continue();
      outside.push(url);
      return request.respond({ status: 204, body: '' });
    }
    catch (error) {
      outside.push(`${url} (${error.message})`);
      return request.respond({ status: 500, body: '' }).catch(() => {});
    }
  });

  return { outside, calls };

}
