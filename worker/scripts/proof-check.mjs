// STAGING-ONLY live check of private proofs (R2) and the admin allowlist sync.
// Uses the staging test key (.staging-test-key.pem) and .staging-sync-secret
// (both git-ignored). Needs `sharp` (tools/node_modules) for real images.
// Usage: node scripts/proof-check.mjs [stagingUrl]
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createSign, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signSync } from '../src/lib/sync.js';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const BUCKET = 'athanasios-proofs-staging';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SYNC = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const sharp = createRequire(process.env.SHARP_FROM || 'D:/private_projects/athanasios-events/tools/package.json')('sharp');
// wrangler's own entry with this node (no npx/.cmd: works on Windows too)
const WRANGLER = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url);
let failed = 0;
const results = {};

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 300)));
  if (!ok) failed++;
}
function token() {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'loadtest-1', email: 'loadtest@staging.invalid', email_verified: true, name: 'Load Test', iat: now, exp: now + 3600 });
  return head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
const AUTH = 'Bearer ' + token();
async function call(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const t = performance.now();
  const res = await fetch(base + path, { method, body, headers: { origin: ORIGIN, ...(auth ? { authorization: AUTH } : {}), ...headers } });
  const type = res.headers.get('content-type') || '';
  const out = { status: res.status, headers: res.headers, ms: Math.round(performance.now() - t) };
  if (type.startsWith('application/json')) out.json = await res.json(); else out.bytes = Buffer.from(await res.arrayBuffer());
  return out;
}
const r2 = (...args) => { try { return execFileSync(process.execPath, [fileURLToPath(WRANGLER), 'r2', 'object', ...args, '--remote'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return String(e.stdout) + String(e.stderr); } };
const upload = (bytes, type, extra = {}) => call('/v1/admin/proofs?purpose=test', { method: 'POST', body: bytes, headers: { 'content-type': type, 'idempotency-key': 'chk-' + randomUUID(), ...extra } });

// --- the allowlist sync first (the test admin must stay on the list) ---
async function sync(list, ts = Date.now()) {
  const raw = JSON.stringify({ admins: list });
  return call('/v1/sync/admins', { method: 'POST', body: raw, auth: false, headers: { 'content-type': 'application/json', 'x-sync-ts': String(ts), 'x-sync-signature': await signSync(SYNC, String(ts), raw) } });
}
const t0 = Date.now();
const s1 = await sync([{ email: 'loadtest@staging.invalid', name: 'Load Test', primary: true }, { email: 'removed-later@staging.invalid', name: 'X' }], t0);
check('sync: signed allowlist accepted', s1.status === 200 && s1.json.active === 2, s1.json);
const s2 = await sync([{ email: 'loadtest@staging.invalid', name: 'Load Test', primary: true }], t0 + 1);
check('sync: removal accepted', s2.status === 200 && s2.json.active === 1, s2.json);
const replay = await sync([{ email: 'loadtest@staging.invalid', primary: true }], t0 + 1);
check('sync: replay refused (409)', replay.status === 409, replay.json);
const forged = await call('/v1/sync/admins', { method: 'POST', body: '{"admins":[{"email":"evil@x.com","primary":true}]}', auth: false, headers: { 'x-sync-ts': String(Date.now()), 'x-sync-signature': 'v1=' + '0'.repeat(64) } });
check('sync: forged signature refused (401)', forged.status === 401, forged.json);
const deep = await call('/v1/health/deep', { auth: false });
check('deep health: storage ok, 1 active admin, sync time', deep.json.storage === 'ok' && deep.json.admins.active === 1 && deep.json.admins.syncedAt === t0 + 1, deep.json);
const who = await call('/v1/admin/whoami');
check('synced admin signs in', who.status === 200, who.json);

// --- real images ---
const jpeg = await sharp({ create: { width: 1280, height: 960, channels: 3, background: { r: 30, g: 90, b: 160 } } }).composite([{ input: Buffer.from('<svg width="1280" height="960"><text x="80" y="480" font-size="120" fill="white">إيصال تجربة 1500</text></svg>'), top: 0, left: 0 }]).jpeg({ quality: 80 }).toBuffer();
const webp = await sharp(jpeg).resize(800).webp({ quality: 82 }).toBuffer();
const png = await sharp(jpeg).resize(200).png().toBuffer();
const huge = await sharp({ create: { width: 3000, height: 400, channels: 3, background: '#888' } }).jpeg().toBuffer();
const heavy = Buffer.concat([jpeg, Buffer.alloc(950 * 1024 - jpeg.length, 7)]);

// --- upload / replay / read / delete ---
const key = 'chk-' + randomUUID();
const up = await call('/v1/admin/proofs?purpose=test', { method: 'POST', body: jpeg, headers: { 'content-type': 'image/jpeg', 'idempotency-key': key } });
check('upload JPEG (' + jpeg.length + ' B)', up.status === 200 && /^prf-[a-z2-7]{8}$/.test(up.json.proof.id) && up.json.proof.width === 1280, up.json);
results.uploadMs = up.ms;
const id = up.json.proof.id;
check('reply has no URL / storage key', !/https?:|r2\.dev|proofs\//.test(JSON.stringify(up.json)), up.json);
const again = await call('/v1/admin/proofs?purpose=test', { method: 'POST', body: jpeg, headers: { 'content-type': 'image/jpeg', 'idempotency-key': key } });
check('same key → same proof (replay)', again.json.proof.id === id && again.headers.get('idempotency-replayed') === '1', again.json);
const w = await upload(webp, 'image/webp');
check('upload WebP', w.status === 200 && w.json.proof.mime === 'image/webp', w.json);

const anon = await call('/v1/admin/proofs/' + id, { auth: false });
check('read without admin → 401', anon.status === 401, anon.json);
const read = await call('/v1/admin/proofs/' + id);
results.readMs = read.ms;
check('read → identical bytes', read.status === 200 && read.bytes && Buffer.compare(read.bytes, jpeg) === 0, { status: read.status, n: read.bytes && read.bytes.length });
check('read headers: no-store, sandbox, nosniff, jpeg', read.headers.get('cache-control') === 'private, no-store' && /sandbox/.test(read.headers.get('content-security-policy')) && read.headers.get('x-content-type-options') === 'nosniff' && read.headers.get('content-type') === 'image/jpeg', [...read.headers]);

const del = await call('/v1/admin/proofs/' + id, { method: 'DELETE' });
results.deleteMs = del.ms;
check('delete → deleted', del.status === 200 && del.json.deleted === true, del.json);
const del2 = await call('/v1/admin/proofs/' + id, { method: 'DELETE' });
check('delete again → idempotent', del2.status === 200 && del2.json.deleted === false, del2.json);
check('read after delete → 404', (await call('/v1/admin/proofs/' + id)).status === 404);

// --- refusals ---
check('PNG refused (400)', (await upload(png, 'image/jpeg')).status === 400);
check('> 900 KB refused (413)', (await upload(heavy, 'image/jpeg')).status === 413);
check('3000 px refused (400)', (await upload(huge, 'image/jpeg')).status === 400);

// --- retention + orphans ---
const short = await upload(jpeg, 'image/jpeg', { 'x-test-retention-ms': '1000' });
check('upload with 1 s retention (staging only)', short.status === 200, short.json);
const dir = mkdtempSync(join(tmpdir(), 'orphan-'));
writeFileSync(join(dir, 'o.jpg'), jpeg);
const orphanKey = 'proofs/2026/10/prf-orphanxx';
r2('put', `${BUCKET}/${orphanKey}`, '--file', join(dir, 'o.jpg'), '--content-type', 'image/jpeg');
rmSync(dir, { recursive: true, force: true });
await new Promise(r => setTimeout(r, 1500));
const hk = await call('/v1/admin/diag/housekeeping', { method: 'POST', body: JSON.stringify({ orphanAgeMs: 0 }), headers: { 'content-type': 'application/json' } });
check('housekeeping: ≥1 expired, ≥1 orphan removed', hk.status === 200 && hk.json.proofs.expired >= 1 && hk.json.proofs.orphans >= 1, hk.json);
check('expired proof unreadable', (await call('/v1/admin/proofs/' + short.json.proof.id)).status === 404);
const orphanGone = r2('get', `${BUCKET}/${orphanKey}`, '--pipe');
check('orphan object gone from R2', /not exist|not found|404|NoSuchKey/i.test(orphanGone), orphanGone.slice(0, 120));
check('live WebP still readable', (await call('/v1/admin/proofs/' + w.json.proof.id)).status === 200);
await call('/v1/admin/proofs/' + w.json.proof.id, { method: 'DELETE' });

// --- no public URL ---
const devUrl = execFileSync(process.execPath, [fileURLToPath(WRANGLER), 'r2', 'bucket', 'dev-url', 'get', BUCKET], { encoding: 'utf8' });
check('r2.dev public URL disabled', /disabled/i.test(devUrl), devUrl.trim());

console.log(JSON.stringify(results));
process.exit(failed ? 1 : 0);
