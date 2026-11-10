import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
const root = process.argv[2], port = Number(process.argv[3]);
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
createServer(async (q, r) => {
  const u = new URL(q.url, 'http://x');
  let p = normalize(decodeURIComponent(u.pathname)).replace(/^([\/])+/, '');
  // the public-site S2 final mockup runs the live home code, which mounts its home-only parts (the bottom bar) on the home address
  if (u.pathname === '/index.html' && u.searchParams.has('s2')) p = 'docs/site-redesign/final.html';
  // S6: a sample event with online booking (the live page engine + booking.js; API: tools/book-mock.mjs). ?s6=1 adds the redesign layer
  if (u.pathname === '/events/s6-sample/' || u.pathname === '/events/s6-sample/index.html') p = u.searchParams.has('s6') ? 'docs/site-redesign/s6/new.html' : 'docs/site-redesign/s6/now.html';
  if (u.pathname === '/events/s6-sample/event.json') p = 'docs/site-redesign/s6/event.json';
  // S7: the account and «نقاطي» pages with the redesign layer (?s7=1)
  const s7 = /^\/(account|points)\/(index\.html)?$/.exec(u.pathname);
  if (s7 && u.searchParams.has('s7')) p = `docs/site-redesign/s7/${s7[1]}.html`;
  else if (s7 && u.searchParams.has('api')) p = `docs/site-redesign/s7/${s7[1]}-now.html`;
  // S5: a service page with the redesign layer, at its own address (the page engine reads ./page.json next to it)
  const svc = /^\/(black-theatre|silenttheatre)\/(index\.html|page\.json)$/.exec(u.pathname);
  if (svc && svc[2] === 'index.html' && u.searchParams.has('s5')) p = `docs/site-redesign/svc/${svc[1]}.html`;
  if (svc && svc[2] === 'page.json' && /[?&]s5=1/.test(q.headers.referer || '') && /[?&]team=1/.test(q.headers.referer || '') && existsSync(join(root, `docs/site-redesign/svc/${svc[1]}.page.json`))) p = `docs/site-redesign/svc/${svc[1]}.page.json`;
  // S8: privacy and terms with the redesign layer (?s8=1)
  const s8 = /^\/(privacy|terms)\/(index\.html)?$/.exec(u.pathname);
  if (s8 && u.searchParams.has('s8')) p = `docs/site-redesign/s8/${s8[1]}.html`;
  if (p.includes('..')) { r.writeHead(403).end(); return; }
  if (!extname(p)) p = join(p, 'index.html');
  try { const b = await readFile(join(root, p)); r.writeHead(200, { 'content-type': T[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(b); }
  catch {
    // like GitHub Pages: a missing page gets the site's 404.html (with ?s8=1, the redesigned one)
    if (/\.html$/.test(p)) {
      try { const b = await readFile(join(root, u.searchParams.has('s8') ? 'docs/site-redesign/s8/404.html' : '404.html')); r.writeHead(404, { 'content-type': T['.html'], 'cache-control': 'no-store' }).end(b); return; } catch {}
    }
    r.writeHead(404).end('404');
  }
}).listen(port, '127.0.0.1', () => console.log('proposal on ' + port));
