// Minimal static server for local preview (GitHub Pages-like).
// Usage: node tools/serve.mjs [port]   → http://localhost:4321/

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { ROOT } from './lib/gs.mjs';

const PORT = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) || process.env.PORT || 4321);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8'
};

// same exclusions as _config.yml, so preview matches production
// case-insensitive (Windows paths) and no dot-folders (.git, .claude)
const PRIVATE = /^\/(apps-script|tools|tests|docs|node_modules)(\/|$)|\/\.|\.md$/i;

// --demo: published files come from tools/demo.mjs output instead
const DEMO = process.argv.includes('--demo');
const DEMO_FILES = /^\/(content\.json|live\.json|meeting\.ics|media\/.+)$/;

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (PRIVATE.test(path)) throw Object.assign(new Error('private'), { code: 'ENOENT' });
    if (path.endsWith('/')) path += 'index.html';
    const base = DEMO && DEMO_FILES.test(path) ? join(ROOT, 'tools/.cache/demo') : ROOT;
    const file = normalize(join(base, path));
    if (!file.startsWith(normalize(base))) throw Object.assign(new Error('outside'), { code: 'ENOENT' });
    if (!(await stat(file)).isFile()) throw Object.assign(new Error('dir'), { code: 'ENOENT' });
    const body = await readFile(file);
    const headers = {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'max-age=0, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes'
    };
    // byte ranges, like GitHub Pages (videos seek with them)
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      const from = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
      const to = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${from}-${to}/${body.length}` });
      res.end(body.subarray(from, to + 1));
      return;
    }
    res.writeHead(200, headers);
    res.end(body);
  }
  catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}/`));
