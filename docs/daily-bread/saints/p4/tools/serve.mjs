// P4 review server: the repository (like docs/daily-bread/tools/static.mjs) + the prepared pictures, READ ONLY,
// from D:/private_projects/khobzna-work/p4-pictures (made by prepare.mjs, outside the repo: nothing is imported
// before the owner approves). Without that folder the page shows the colours only.
//   node docs/daily-bread/saints/p4/tools/serve.mjs [port=4344] → http://localhost:4344/docs/daily-bread/saints/p4/
//   GET /__p4/<person>-<n>[-480|-160].webp
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = normalize(join(HERE, '..', '..', '..', '..', '..'));
const PICS = process.env.P4_PICS || 'D:/private_projects/khobzna-work/p4-pictures';
const PORT = Number(process.argv[2] || 4344);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8'
};
const send = (res, code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const pic = /^\/__p4\/([a-z0-9]+-\d+(?:-480|-160)?\.webp)$/.exec(path);
    if (pic) return send(res, 200, 'image/webp', await readFile(join(PICS, pic[1])));
    if (/\/\./.test(path)) throw new Error('hidden');
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || !(await stat(file)).isFile()) throw new Error('no');
    send(res, 200, TYPES[extname(file)] || 'application/octet-stream', await readFile(file));
  } catch {
    send(res, 404, 'text/plain', 'not found');
  }
}).listen(PORT, () => console.log('P4 review on http://localhost:' + PORT + '/docs/daily-bread/saints/p4/'));
