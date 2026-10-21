// Phase 2 step 1 on staging (docs/PUBLISH-SEPARATION-PLAN.md §5): a signed publish of the
// repo's real published files, the public reads (exact text, ETag, 304, CORS), a retry,
// a refusal, and a multi-statement publish (3 × 200 KB pages under check-big-*).
// Staging only; no switch is changed; it reads the staging sync secret from .staging-sync-secret.
//   node scripts/publish-check.mjs
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';

const base = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const ORIGIN = 'https://stathanasiosyouth.github.io';
const SECRET = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const repo = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const RUN = Date.now().toString(36);
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + String(JSON.stringify(detail)).slice(0, 300))); if (!ok) failed++; };
const sha = t => createHash('sha256').update(t).digest('hex');

async function post(body) {
  const raw = JSON.stringify(body);
  const ts = String(Date.now());
  const sig = 'v1=' + createHmac('sha256', SECRET).update(ts + '.' + raw).digest('hex');
  const res = await fetch(base + '/v1/sync/publish', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-ts': ts, 'x-sync-signature': sig }, body: raw });
  const out = { status: res.status, body: await res.json().catch(() => null) };
  await new Promise(r => setTimeout(r, 5));   // the next signature is newer
  return out;
}
async function get(path, headers = {}) {
  const t0 = Date.now();
  const res = await fetch(base + path, { headers: { origin: ORIGIN, ...headers } });
  return { status: res.status, headers: res.headers, text: await res.text(), ms: Date.now() - t0 };
}

const files = {
  'content.json': repo('content.json'),
  'events/test/event.json': repo('events/test/event.json'),
  'events/test/index.html': repo('events/test/index.html'),
  'black-theatre/page.json': repo('black-theatre/page.json'),
  'black-theatre/index.html': repo('black-theatre/index.html'),
  'competition/test/comp.json': repo('competition/test/comp.json'),
  'competition/test/index.html': repo('competition/test/index.html'),
  'meeting.ics': repo('meeting.ics')
};

const id = 'check-' + RUN;
const r1 = await post({ id, mode: 'shadow', by: 'publish-check@staging.invalid', at: Date.now(), files });
check('publish accepted', r1.status === 200, r1);
const r2 = await post({ id, mode: 'shadow', by: 'publish-check@staging.invalid', at: Date.now(), files });
check('retry → the stored reply', r2.status === 200 && r2.body.replayed === true, r2);

for (const [route, path] of [['/v1/public/content', 'content.json'], ['/v1/public/event/test', 'events/test/event.json'],
  ['/v1/public/page/black-theatre', 'black-theatre/page.json'], ['/v1/public/comp/test', 'competition/test/comp.json'], ['/v1/public/ics', 'meeting.ics']]) {
  const g = await get(route);
  check(route + ' exact text', g.status === 200 && sha(g.text) === sha(files[path]), { status: g.status, len: g.text.length });
  check(route + ' CORS + no-cache', g.headers.get('access-control-allow-origin') === ORIGIN && g.headers.get('cache-control') === 'no-cache', [...g.headers]);
  const etag = g.headers.get('etag');
  const again = await get(route, { 'if-none-match': etag });
  check(route + ' 304 (' + again.ms + ' ms)', again.status === 304, { status: again.status, etag, back: again.headers.get('etag') });
}
check('a stub is never served', (await get('/v1/public/page/events')).status === 404);

const bad = await post({ id: 'check-bad-' + RUN, mode: 'shadow', at: Date.now(), files: { 'events/check-bad/event.json': JSON.stringify({ slug: 'check-bad', people: [{ phone: '0100' }] }) } });
check('private data refused', bad.status === 400, bad);

const big = {};
for (let i = 1; i <= 3; i++) big[`check-big-${i}/page.json`] = JSON.stringify({ slug: `check-big-${i}`, run: RUN, text: 'ن'.repeat(100 * 1024) });
const rb = await post({ id: 'check-big-' + RUN, mode: 'shadow', at: Date.now(), files: big });
check('3 × 200 KB in one publish (several insert statements)', rb.status === 200 && rb.body.changed.length === 3, rb);
const gb = await get('/v1/public/page/check-big-3');
check('big page read back', gb.status === 200 && JSON.parse(gb.text).run === RUN, { status: gb.status });

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
