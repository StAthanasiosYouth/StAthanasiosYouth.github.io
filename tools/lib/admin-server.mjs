// Serves the real admin panel (apps-script/*.html) with google.script.run
// forwarded to the real .gs code running in a fake Apps Script world
// (tests/fakes/gas.mjs). Used by tools/admin-preview.mjs and the admin e2e.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
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
