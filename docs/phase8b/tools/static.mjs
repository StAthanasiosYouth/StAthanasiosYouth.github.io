import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
const root = process.argv[2], port = Number(process.argv[3]);
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
createServer(async (q, r) => {
  let p = normalize(decodeURIComponent(new URL(q.url, 'http://x').pathname)).replace(/^([\/])+/, '');
  if (p.includes('..')) { r.writeHead(403).end(); return; }
  if (!extname(p)) p = join(p, 'index.html');
  try { const b = await readFile(join(root, p)); r.writeHead(200, { 'content-type': T[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(b); }
  catch { r.writeHead(404).end('404'); }
}).listen(port, '127.0.0.1', () => console.log('proposal on ' + port));
