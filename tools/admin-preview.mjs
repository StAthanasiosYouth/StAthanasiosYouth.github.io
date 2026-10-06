// Local preview of the admin panel with the real .gs code running against an
// in-memory Sheet and a fake GitHub (tests/fakes/gas.mjs). Nothing here
// touches Google or GitHub.
//
// Usage: node tools/admin-preview.mjs [port]   → http://localhost:4322/

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createWorld } from '../tests/fakes/gas.mjs';
import { ROOT } from './lib/gs.mjs';

const PORT = Number(process.argv[2] || 4322);
const ADMIN = 'menazakmena@gmail.com';

const world = createWorld();
world.as(ADMIN).gs.setup();
world.properties.set('GITHUB_TOKEN', 'test-token');
world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/athanasios-links');
world.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');

// sample content-center data, timed relative to now (Cairo)
{
  const gs = world.gs;
  const now = gs.cairoNow_().replace('T', ' ');
  const plusDays = days => gs.storedOf_(gs.wallAdd_(gs.cairoNow_(), days * 1440)).slice(0, 10);
  const sunday = (() => { for (let d = 0; d < 8; d++) { const date = plusDays(d); if (new Date(date + 'T12:00Z').getUTCDay() === 0 && d > 0) return date; } return plusDays(7); })();
  gs.apiSaveItem('sessions', { date: sunday, topic: 'حياة التسليم', speaker: 'أبونا أنطوني عياد', visibleFrom: now, notify: { topic: true } });
  gs.apiSaveItem('news', { title: 'رحلة الغردقة', summary: 'سجّل اسمك قبل الخميس', linkUrl: 'https://forms.gle/example', badge: 'جديد', featured: true, notify: { publish: true } });
  gs.apiSaveItem('games', { title: 'رحلة الاستكشاف في الكنيسة', url: 'https://example.org/explore', visibleFrom: sunday + ' 21:00', startAt: sunday + ' 22:00', endAt: sunday + ' 23:30', notify: { soon: true, start: true } });
  gs.apiSaveItem('notifications', { title: 'بوستر المؤتمر نزل', type: 'important', target: 'https://example.org/poster' });
}

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
            });
        };
      }
    });
  }
  window.google = { script: { run: runner() } };
})();
</script>`;

function page() {

  const read = name => readFileSync(`${ROOT}apps-script/${name}.html`, 'utf8');

  // doGet adds this with addMetaTag() in production
  return read('Admin')
    .replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
    .replace(/<\?!= include_\('(\w+)'\) \?>/g, (_, name) => (name === 'AdminScript' ? SHIM : '') + read(name));

}

createServer((req, res) => {

  if (req.method === 'POST' && req.url.startsWith('/api/')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const name = req.url.slice(5);
      let payload;
      try {
        if (!/^api\w+$/.test(name) || typeof world.gs[name] !== 'function') throw new Error('unknown function ' + name);
        payload = { ok: true, value: JSON.parse(JSON.stringify(world.as(ADMIN).gs[name](...JSON.parse(body || '[]')) ?? null)) };
      }
      catch (error) {
        payload = { ok: false, error: error.message };
      }
      // feel like the network
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      }, 250);
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page());

}).listen(PORT, '127.0.0.1', () => console.log(`admin preview: http://localhost:${PORT}/`));
