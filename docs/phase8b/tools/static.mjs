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
  // S5: a service page with the redesign layer, at its own address (the page engine reads ./page.json next to it)
  const svc = /^\/(black-theatre|silenttheatre)\/(index\.html|page\.json)$/.exec(u.pathname);
  if (svc && svc[2] === 'index.html' && u.searchParams.has('s5')) p = `docs/site-redesign/svc/${svc[1]}.html`;
  if (svc && svc[2] === 'page.json' && /[?&]s5=1/.test(q.headers.referer || '') && /[?&]team=1/.test(q.headers.referer || '') && existsSync(join(root, `docs/site-redesign/svc/${svc[1]}.page.json`))) p = `docs/site-redesign/svc/${svc[1]}.page.json`;
  if (p.includes('..')) { r.writeHead(403).end(); return; }
  if (!extname(p)) p = join(p, 'index.html');
  try { const b = await readFile(join(root, p)); r.writeHead(200, { 'content-type': T[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(b); }
  catch { r.writeHead(404).end('404'); }
}).listen(port, '127.0.0.1', () => console.log('proposal on ' + port));
