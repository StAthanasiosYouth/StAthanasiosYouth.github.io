// «خبزنا اليومي» P4 — the saints' pictures into the media library and the albums (docs/daily-bread/saints/P4-PROGRESS.md).
// Through the NORMAL media flow: POST /v1/admin/media/upload (apiUploadMedia, the same body the admin sends: the card
// copy as `full`, the 480 copy as `thumb`, the 160 `tiny`, the colour, the size, alt = the person's name), then each
// person's album saved with its rev (POST bread/saints/item), the review, the publish (saints.json), the feasts tab read.
// Safe to run again: the library answers `duplicate` for a picture it has (same hash), and an album already filled the
// same way is not saved twice. BREAD_SAINTS is on for the run only, then back as it was. Never NOTIFY_*, PUSH_*,
// PERMS_ENFORCE, BREAD_MODULE or BREAD_PUSH; no push of any kind.
//   STAGING_KEYS_DIR=<folder with .staging-test-key.pem> node tools/saints-pictures-import.mjs            (Staging)
//   Production: not from this tool without the owner's explicit yes (P4-PROGRESS.md).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { join } from 'node:path';
import { ROOT } from './lib/gs.mjs';

const BASE = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const KEYS = process.env.STAGING_KEYS_DIR || join(ROOT, 'worker');
const PEM = readFileSync(join(KEYS, '.staging-test-key.pem'), 'utf8');
const P4 = join(ROOT, 'docs', 'daily-bread', 'saints', 'p4');
const DATA = JSON.parse(readFileSync(join(P4, 'pictures.json'), 'utf8'));
const PICS = process.env.P4_PICS || DATA.out;
const MAP_FILE = join(P4, 'import-staging.json');
const SWITCHES = "('BREAD_SAINTS', 'BREAD_MODULE', 'BREAD_PUSH', 'NOTIFY_ROUTER', 'PUSH_SENDER', 'PERMS_ENFORCE', 'CONTENT_DRAFTS')";
// Staging keeps CONTENT_DRAFTS = '0' (the fixture drafts, CONTENT-MIGRATION-PLAN §14): '1' for the run only, as there,
// then the row exactly as it was. Production is '1' already (the Worker writes the library).

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + String(JSON.stringify(detail)).slice(0, 400)));
  if (!ok) failed++;
}
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { shell: true, encoding: 'utf8', cwd: join(ROOT, 'worker') });
  if (r.status !== 0) throw new Error('d1: ' + String(r.stderr).slice(0, 300));
  return JSON.parse(r.stdout)[0].results;
}
function google(email, sub) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: 'P4 import', iat: now, exp: now + 3600 });
  return head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function call(method, path, body, token) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + path, { method, headers: { origin: ORIGIN, authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const out = { status: res.status, body: await res.json().catch(() => null) };
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
    return out;
  }
}
const G = google('loadtest@staging.invalid', 'loadtest-1');
const admin = (method, path, body) => call(method, '/v1/admin/' + path, body, G);
const b64 = f => readFileSync(join(PICS, f)).toString('base64');

const before = Object.fromEntries(sql(`SELECT key, value FROM settings WHERE key IN ${SWITCHES}`).map(r => [r.key, r.value]));
console.log('Staging settings before:', JSON.stringify(before));

const map = {};
const drafts = sql("SELECT value, updated_at, updated_by FROM settings WHERE key = 'CONTENT_DRAFTS'")[0];
try {
  if (drafts && drafts.value !== '1') sql("UPDATE settings SET value = '1', updated_by = 'p4-import' WHERE key = 'CONTENT_DRAFTS'");
  // 1. the panel session (the upload route needs one), then every picture through the library
  const s = await call('POST', '/v1/admin/session/start', { device: 'P4 import', force: true }, G);
  check('panel session', s.status === 200 && s.body && s.body.token, s.body);
  const T = s.body.token;
  let dup = 0;
  for (const x of DATA.pictures) {
    const up = await call('POST', '/v1/admin/media/upload', {
      mime: 'image/webp', full: b64(x.key + '.webp'), thumb: b64(x.key + '-480.webp'), tiny: b64(x.key + '-160.webp'), tinyMime: 'image/webp',
      color: x.color, width: x.card.w, height: x.card.h, alt: x.name.slice(0, 120), name: x.key
    }, T);
    const m = up.body && up.body.ok && up.body.result && up.body.result.media;
    if (!m) { check('upload ' + x.key, false, up); throw new Error('upload refused: stopped'); }
    if (up.body.result.duplicate) dup++;
    map[x.key] = { id: m.id, path: m.path, thumb: m.thumb };
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  check(`the library has all ${DATA.pictures.length} pictures (${dup} were there already)`, Object.keys(map).length === DATA.pictures.length);
  writeFileSync(MAP_FILE, JSON.stringify({ env: 'staging', at: new Date().toISOString(), media: map }, null, 1) + '\n');

  // 2. the albums (BREAD_SAINTS on for the run only)
  check('BREAD_SAINTS on (Staging only, for the run)', (await admin('POST', 'bread/settings', { saints: true })).status === 200);
  const list = (await admin('GET', 'bread/saints')).body.items;
  let saved = 0, same = 0;
  for (const it of list.filter(i => i.kind === 'person' && !i.deleted)) {
    const mine = DATA.pictures.filter(x => x.person === it.id && map[x.key]);
    if (!mine.length) continue;
    const album = mine.map(x => {
      const a = { media: map[x.key].path, type: x.type };
      if (x.src) a.src = x.src;
      if (x.main && mine.length > 1) a.main = true;
      if (x.stage) a.stage = x.stage;
      if (x.occasion) a.occasion = x.occasion;
      if (x.caption) a.caption = x.caption;
      a.credit = (x.source + ' · ' + x.terms).slice(0, 200);   // source and terms: internal only (never published)
      a.crop = x.crop;
      return a;
    });
    if (JSON.stringify(it.data.album) === JSON.stringify(album)) { same++; continue; }
    const r = await admin('POST', 'bread/saints/item', { kind: 'person', rev: it.rev, item: { ...it.data, album } });
    if (r.status !== 200) { check('album ' + it.id, false, r.body); continue; }
    saved++;
  }
  check(`albums: ${saved} saved, ${same} already the same`, saved + same === new Set(DATA.pictures.map(x => x.person)).size);

  // 3. review → publish (Staging's saints.json) → the feasts tab reads the album pictures
  const rv = await admin('GET', 'bread/saints/review');
  check('review: no problems', rv.status === 200 && rv.body.errors.length === 0, rv.body);
  if (rv.body.first || rv.body.changes.length) {
    const pub = await admin('POST', 'bread/saints/publish', { expect: rv.body.expect });
    check('publish → saints.json', pub.status === 200 && pub.body.rev >= 1, pub.body);
  }
  const live = sql("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = 'saints' AND live = 1")[0];
  const file = JSON.parse(live.body);
  const withAlbum = file.people.filter(p => p.album && p.album.length).length;
  check(`the published file: ${withAlbum} people with pictures`, withAlbum === new Set(DATA.pictures.map(x => x.person)).size);
  check('the published file has no src and no credit', !/"src"|"credit"/.test(live.body));
  const th = file.people.find(p => p.id === 'theophilus');
  check('Anba Theophilus: 7 pictures, one main', th.album.length === 7 && th.album.filter(a => a.main).length === 1, th.album);
  const feb = (await admin('GET', 'bread/saints/feasts?month=2027-02')).body.feasts.find(f => f.id === 'theophilus');
  check('feasts 2027-02: Anba Theophilus with his repose picture, no label', feb && /^\/media\/\d{4}\/img-/.test(feb.img) && feb.imgAi === false && th.album.find(a => '/' + a.media === feb.img).occasion === 'نياحته', feb);
  const dec = (await admin('GET', 'bread/saints/feasts?month=2026-12')).body.feasts.find(f => f.id === 'mercurius');
  check('feasts 2026-12: Abi Sefein (AI) with «صورة تعبيرية»', dec && dec.imgAi === true && /^\/media\//.test(dec.img), dec);
} finally {
  await admin('POST', 'bread/settings', { saints: before.BREAD_SAINTS === '1' });
  if (drafts) sql(`UPDATE settings SET value = '${drafts.value}', updated_at = ${Number(drafts.updated_at)}, updated_by = '${String(drafts.updated_by).replace(/'/g, '')}' WHERE key = 'CONTENT_DRAFTS'`);
  const after = Object.fromEntries(sql(`SELECT key, value FROM settings WHERE key IN ${SWITCHES}`).map(r => [r.key, r.value]));
  console.log('Staging settings after: ', JSON.stringify(after));
  check('every switch as it was', JSON.stringify(after) === JSON.stringify(before), { before, after });
}
console.log(failed ? `\n${failed} FAILED` : '\nALL OK');
process.exit(failed ? 1 : 0);
