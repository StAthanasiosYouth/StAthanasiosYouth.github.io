// P3 review server: the repository (like docs/daily-bread/tools/static.mjs) + the owner's saints pictures, READ ONLY,
// as small thumbnails made on request (sharp, kept in tools/.cache/p3-thumbs/, never in the repo, never on the site).
// Nothing in the owner's folder is written, moved or renamed. Without the folder the preview shows letters instead.
//   node docs/daily-bread/saints/p3/tools/serve.mjs [port=4341] → http://localhost:4341/docs/daily-bread/saints/p3/
//   GET /__pic/<w>/<album src>   → a webp <w> px wide (w = 160 | 360 | 720)
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = normalize(join(HERE, '..', '..', '..', '..', '..'));
const PORT = Number(process.argv[2] || 4341);
const { load, picturesDir } = await import(pathToFileURL(join(ROOT, 'tools/lib/saints.mjs')).href);
const PICS = picturesDir(load());
const MOD = [join(ROOT, 'tools'), 'D:/private_projects/athanasios-links/tools'].find(d => existsSync(join(d, 'node_modules', 'sharp')));
const sharp = createRequire(join(MOD, 'package.json'))('sharp');
const CACHE = join(ROOT, 'tools', '.cache', 'p3-thumbs');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8'
};
const send = (res, code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };

async function picture(res, w, src) {
  if (!PICS || ![160, 360, 720].includes(w) || src.includes('..')) return send(res, 404, 'text/plain', 'no picture');
  const file = normalize(join(PICS, src));
  if (!file.startsWith(normalize(PICS)) || !existsSync(file)) return send(res, 404, 'text/plain', 'no picture');
  const key = join(CACHE, createHash('sha1').update(w + '|' + src).digest('hex') + '.webp');
  if (!existsSync(key)) {
    await mkdir(CACHE, { recursive: true });
    await writeFile(key, await sharp(file).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer());
  }
  res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'max-age=3600' });
  res.end(await readFile(key));
}

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const pic = /^\/__pic\/(\d+)\/(.+)$/.exec(path);
    if (pic) return await picture(res, +pic[1], pic[2]);
    if (path === '/__pic-status') return send(res, 200, 'application/json', JSON.stringify({ pictures: !!PICS }));
    if (/\/\./.test(path)) throw new Error('hidden');
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || !(await stat(file)).isFile()) throw new Error('no');
    send(res, 200, TYPES[extname(file)] || 'application/octet-stream', await readFile(file));
  } catch {
    send(res, 404, 'text/plain', 'not found');
  }
}).listen(PORT, () => console.log(`P3 preview on http://localhost:${PORT}/docs/daily-bread/saints/p3/ (pictures: ${PICS ? 'yes, read only' : 'no'})`));
