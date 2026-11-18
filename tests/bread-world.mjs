// «خبزنا اليومي» W5: a small world for the member page — the site over HTTP (its real CSP, the API's address let
// in) and the REAL Worker code on SQLite, with a program published by the real admin routes. Used by
// tests/bread-page.e2e.mjs, tools/audit.mjs and tools/bread-compare.mjs. Not a test file itself.
//
// The sample program is W1's (docs/daily-bread/prototype/data.js, the shots' text): 30 days, day n carries
// TOPICS[(n - 1) % 7], so the page shows exactly what the approved shots show.
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { ROOT } from '../tools/lib/gs.mjs';
import { harness, fakeGoogle } from '../worker/test/helpers.mjs';
import { orderFor, cairoDay, dayAdd } from '../worker/src/bread/model.js';
import { datedPrograms, publishStmts } from '../worker/src/bread/store.js';
import { parseRef } from '../assets/js/bread/refs.js';
import { forgetAccessToken } from '../worker/src/push/fcm.js';

// the Worker's one-line request log (lib/log.js) is noise here
const log = console.log;
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('{"t":')) return; log(...a); };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.mp4': 'video/mp4', '.ics': 'text/calendar' };
const KEYS = { PW_PEPPER: 'pepper', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp', ACCOUNT_PAD_MS: '0', BOOK_SECRET: 'b'.repeat(40) };
export const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find(existsSync);
const P = 'primary@example.com';

export const PROTO = existsSync(join(ROOT, 'docs/daily-bread/prototype/data.js')) ? await import('../docs/daily-bread/prototype/data.js') : null;

/* a W1 sample topic → the upload contract (progress/W3.md «شكل اليوم اللي بيترفع») */
export function sampleTopic(n, t) {
  const r = parseRef(t.readingRef);
  return {
    n, title: t.title, verseRef: t.verseRef, verse: t.verse, readingRef: t.readingRef,
    reading: [{ book: r.name, chapter: r.ch, verses: t.reading.map(([v, text]) => [v, text]) }],
    meditation: t.meditation, question: t.question || null
  };
}

/* a seed whose topic on day d (0-based) of a program of `days` is ≡ want (mod 7): the shots' topic */
export function seedFor(programId, days, d, want = 0) {
  for (let k = 0; k < 100000; k++) {
    const seed = 'shot-' + k.toString(36).padStart(4, '0');
    if ((orderFor(seed, programId, days)[d]) % 7 === want) return seed;
  }
  throw new Error('no seed');
}

export async function startWorld({ sitePort, apiPort, module = true, siteFixups = null } = {}) {
  forgetAccessToken();
  const LOCAL = `http://localhost:${sitePort}`;
  const API = `http://localhost:${apiPort}`;
  const g = await fakeGoogle();
  const h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ALLOWED_ORIGINS: LOCAL, ...KEYS } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'P', 'primary', 1, 0)`).run();
  await h.db.prepare("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'").run();
  const setting = (key, value) => h.db.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(value, key).run();
  await setting('BREAD_MODULE', module ? '1' : '0');
  const admin = async (method, path, body) => h.call('/v1/admin/' + path, { method, body, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: P, sub: 's-' + P })) }, fetch: g.fetch });
  const requests = [];

  const site = createServer((req, res) => {
    const url = new URL(req.url, LOCAL);
    let file = normalize(decodeURIComponent(url.pathname));
    if (file.endsWith('\\') || file.endsWith('/')) file += 'index.html';
    requests.push(url.pathname);
    // the published files: what the Worker published, as the mirror would have committed them
    const data = /^[\\/]daily-bread[\\/]data[\\/](.+)\.json$/.exec(file);
    if (data) {
      const key = data[1].replace(/\\/g, '/');
      h.db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = ? AND live = 1").bind(key).first('body').then(body => {
        if (!body || world.staticOff) { res.writeHead(404); res.end(''); return; }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(body);
      });
      return;
    }
    try {
      let body = readFileSync(join(ROOT, file));
      if (file.endsWith('.html')) body = body.toString().replace("connect-src 'self'", `connect-src 'self' ${API}`);
      if (siteFixups) body = siteFixups(file, body);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    }
    catch {
      res.writeHead(404);
      res.end('');
    }
  });
  const apiServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    const init = { method: req.method, headers };
    if (chunks.length) init.body = Buffer.concat(chunks);
    world.calls.push({ method: req.method, path: new URL(req.url, API).pathname, type: req.headers['content-type'] || '', body: chunks.length ? Buffer.concat(chunks).toString() : '' });
    if (world.apiDown) { res.destroy(); return; }
    const { handle } = await import('../worker/src/index.js');
    const reply = await handle(new Request('https://api.test' + req.url, init), h.env, { waitUntil: () => {} });
    const out = {};
    reply.headers.forEach((v, k) => { out[k] = v; });
    res.writeHead(reply.status, out);
    res.end(Buffer.from(await reply.arrayBuffer()));
  });
  await Promise.all([new Promise(r => site.listen(sitePort, r)), new Promise(r => apiServer.listen(apiPort, r))]);

  /* the W1 sample program, live today on its day `dayNo` (1-based) */
  async function program({ days = 30, dayNo = 5, name = PROTO ? PROTO.PROGRAM.name : 'برنامج تجربة' } = {}) {
    const c = await admin('POST', 'bread/programs', { name, days });
    if (c.status !== 200) throw new Error(JSON.stringify(c.body));
    const id = c.body.program.id;
    for (let i = 1; i <= days; i += 20) {
      const topics = Array.from({ length: Math.min(20, days - i + 1) }, (_, k) => sampleTopic(i + k, PROTO.TOPICS[(i + k - 1) % PROTO.TOPICS.length]));
      const r = await admin('POST', `bread/programs/${id}/topics`, { topics });
      if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    }
    const a = await admin('POST', `bread/programs/${id}/activate`, { mode: 'after' });
    if (a.status !== 200) throw new Error(JSON.stringify(a.body));
    await startOn(id, dayAdd(cairoDay(), -(dayNo - 1)));
    return { id, days };
  }
  /* moves a program's dates (and publishes the index again, as the admin's change would) */
  async function startOn(id, startsOn) {
    const p = await h.db.prepare('SELECT days FROM bread_programs WHERE id = ?').bind(id).first();
    await h.db.prepare("UPDATE bread_programs SET starts_on = ?, ends_on = ?, status = 'scheduled' WHERE id = ?").bind(startsOn, dayAdd(startsOn, p.days - 1), id).run();
    const { stmts } = await publishStmts(h.db, { rows: await datedPrograms(h.db), day: cairoDay(), by: P, now: Date.now() });
    await h.db.batch(stmts);
  }
  /* a member: eligible (by age) or guest (the override) → { email, token, firstName } */
  let serial = 0;
  async function member({ guest = false } = {}) {
    serial++;
    const email = `bread${serial}${Date.now()}@staging.invalid`;
    const s = await h.call('/v1/account/register/start', { method: 'POST', body: { email, phone: '012' + String(51000000 + serial + (Date.now() % 100000)), name: 'مارك سامي فوزي', birthDate: '2004-03-12' }, headers: { 'cf-connecting-ip': '10.1.0.' + serial } });
    if (s.status !== 200) throw new Error(JSON.stringify(s.body));
    const d = await h.call('/v1/account/register/verify', { method: 'POST', body: { pendingId: s.body.pendingId, code: s.body.testCode } });
    await h.db.prepare('UPDATE participants SET onboarded_at = 1' + (guest ? ", eligibility_override = 'guest'" : '') + ' WHERE email = ?').bind(email).run();
    const si = await h.call('/v1/account/signin', { method: 'POST', body: { email, password: d.body.password }, headers: { 'cf-connecting-ip': '10.1.1.' + serial } });
    if (si.status !== 200) throw new Error(JSON.stringify(si.body));
    return { email, token: si.body.session.token, firstName: 'مارك', id: si.body.account.id };
  }

  const world = {
    LOCAL, API, h, admin, setting, program, startOn, member, requests, calls: [], apiDown: false, staticOff: false,
    close: () => Promise.all([site, apiServer].map(s => new Promise(r => s.close(r))))
  };
  return world;
}

/* what a page needs on this device before it loads: the API's address, and maybe a seed / a session / a look */
export function prime(page, API, { seed = null, member = null, look = null, extra = null } = {}) {
  return page.evaluateOnNewDocument((api, seed, member, look, extra) => {
    try {
      if (sessionStorage.getItem('primed')) return;
      sessionStorage.setItem('primed', '1');
      localStorage.setItem('athanasios.book.api', api);
      if (seed) localStorage.setItem('bread.seed', seed);
      if (look) localStorage.setItem('bread.look', look);
      if (member) {
        localStorage.setItem('athanasios.account.v1', JSON.stringify({ token: member.token, email: member.email, firstName: member.firstName, at: Date.now() }));
        localStorage.setItem('athanasios.account.face.v1', JSON.stringify({ firstName: member.firstName, photo: '', version: 1 }));
      }
      for (const [k, v] of Object.entries(extra || {})) localStorage.setItem(k, v);
    }
    catch { /* a page without storage */ }
  }, API, seed, member, look, extra);
}
