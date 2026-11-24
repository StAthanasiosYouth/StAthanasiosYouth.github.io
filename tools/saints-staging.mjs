// «خبزنا اليومي» P3 on STAGING (docs/daily-bread/saints/P3-PLAN.md §8): the saints registry routes against the Staging
// Worker and D1 (migrations 0035 + 0036 applied), with BREAD_SAINTS on in Staging only for the run:
//   the seed (108 + 1) → the first publish (saints.json, snapshot, mirror job) → the feasts tab reads it → Mar Isaac's
//   test day saved (status computed) → reviewed (he joins) → published → in the month's feasts → a stale save refused
//   → back to the first publish (restore = published again) → BREAD_SAINTS back as it was.
// Touches nothing else: never NOTIFY_*, PUSH_*, PERMS_ENFORCE, BREAD_MODULE or BREAD_PUSH; no push of any kind (the registry
// sends none). The production Worker is never asked. Run from the repo root:
//   STAGING_KEYS_DIR=<folder with .staging-test-key.pem> node tools/saints-staging.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { join } from 'node:path';
import { ROOT } from './lib/gs.mjs';
import { toCoptic, toGregorian } from './lib/coptic.mjs';

const BASE = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const KEYS = process.env.STAGING_KEYS_DIR || join(ROOT, 'worker');
const PEM = readFileSync(join(KEYS, '.staging-test-key.pem'), 'utf8');
let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
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
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: 'check', iat: now, exp: now + 3600 });
  return head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function call(method, path, body, token) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, { method, headers: { origin: ORIGIN, authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ms: Date.now() - t0, body: await res.json().catch(() => null) };
}
const P = google('loadtest@staging.invalid', 'loadtest-1');
const admin = (method, path, body) => call(method, '/v1/admin/' + path, body, P);

const settingsBefore = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('BREAD_SAINTS', 'BREAD_MODULE', 'BREAD_PUSH', 'NOTIFY_ROUTER', 'PUSH_SENDER', 'PERMS_ENFORCE')").map(r => [r.key, r.value]));
console.log('Staging settings before:', JSON.stringify(settingsBefore));
check('0035 + 0036 applied: the seed is there', sql("SELECT COUNT(*) AS n FROM saints_items WHERE kind = 'person'")[0].n === 108);

try {
  check('switch off → disabled', (await admin('GET', 'bread/saints')).body.code === 'disabled');
  check('BREAD_SAINTS on (Staging only, for the run)', (await admin('POST', 'bread/settings', { saints: true })).status === 200);
  const list = await admin('GET', 'bread/saints');
  check('the list: 108 people + 1 occasion', list.status === 200 && list.body.items.length === 109, list.body);
  console.log('     GET saints: ' + list.ms + ' ms');

  // the first publish (or a later one, if Staging already has one)
  let rv = await admin('GET', 'bread/saints/review');
  check('review: no problems', rv.status === 200 && rv.body.errors.length === 0, rv.body);
  let pub = null;
  if (rv.body.first || rv.body.changes.length) {
    pub = await admin('POST', 'bread/saints/publish', { expect: rv.body.expect });
    check('publish → saints.json + snapshot', pub.status === 200 && pub.body.rev >= 1, pub.body);
    console.log('     publish: ' + pub.ms + ' ms (rev ' + (pub.body && pub.body.rev) + ')');
  }
  const base = (await admin('GET', 'bread/saints/history')).body.publishes[0].rev;
  const live = sql("SELECT length(body) AS n, body FROM published_revisions WHERE kind = 'bread' AND key = 'saints' AND live = 1")[0];
  check('the published file has no internal parts', live && !/"pending"|"src"|"note"/.test(live.body), live && live.n);
  check('a bread publish job for the mirror', sql("SELECT COUNT(*) AS n FROM publish_jobs WHERE mode = 'bread' AND id = (SELECT publish_id FROM saints_snapshots ORDER BY rev DESC LIMIT 1)")[0].n === 1);
  const feb = await admin('GET', 'bread/saints/feasts?month=2027-02');
  check('«الأعياد» reads it: Anba Theophilus on 12 Feb 2027', feb.body.ready && feb.body.feasts.some(f => f.id === 'theophilus' && f.date === '2027-02-12'), feb.body);

  // Mar Isaac: a test day (17 Kiahk) → saved, complete → joins → published → in its month
  const mar = list.body.items.find(i => i.id === 'isaacsyrian');
  const day = { kind: 'نياحته (فحص Staging)', coptic: '4-17', source: 'https://st-takla.org/' };
  const saved = await admin('POST', 'bread/saints/item', { kind: 'person', rev: mar.rev, item: { ...mar.data, feasts: [day] } });
  check('save: status computed (complete)', saved.status === 200 && saved.body.item.data.status === 'complete' && saved.body.item.state === 'changed', saved.body);
  const stale = await admin('POST', 'bread/saints/item', { kind: 'person', rev: mar.rev, item: mar.data });
  check('a stale rev is refused (409)', stale.status === 409, stale.body);
  rv = await admin('GET', 'bread/saints/review');
  check('review: Mar Isaac joins the automatic feasts', rv.body.joins.some(j => j.id === 'isaacsyrian'), rv.body);
  pub = await admin('POST', 'bread/saints/publish', { expect: rv.body.expect });
  check('publish', pub.status === 200, pub.body);
  const y = toCoptic(new Date().toISOString().slice(0, 10)).y;
  const iso = toGregorian(y, 4, 17);
  const month = await admin('GET', 'bread/saints/feasts?month=' + iso.slice(0, 7));
  check('his day is in ' + iso.slice(0, 7) + ' with no code change and no import', month.body.feasts.some(f => f.date === iso && (f.id === 'isaacsyrian' || f.others.some(o => /إسحق/.test(o)))), month.body.feasts.map(f => f.date + ' ' + f.id));

  // back: the registry as it was (restore = published again as a new one)
  const back = await admin('POST', 'bread/saints/restore', { rev: base, confirm: true });
  check('restore to rev ' + base, back.status === 200, back.body);
  const after = await admin('GET', 'bread/saints');
  check('Mar Isaac back without a day, all published', after.body.items.find(i => i.id === 'isaacsyrian').data.feasts.length === 0 && after.body.changes === 0, after.body.changes);
} finally {
  const was = settingsBefore.BREAD_SAINTS === '1';
  await admin('POST', 'bread/settings', { saints: was });
  const now = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('BREAD_SAINTS', 'BREAD_MODULE', 'BREAD_PUSH', 'NOTIFY_ROUTER', 'PUSH_SENDER', 'PERMS_ENFORCE')").map(r => [r.key, r.value]));
  console.log('Staging settings after: ', JSON.stringify(now));
  const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  check('every switch as it was', same(now, settingsBefore), { before: settingsBefore, after: now });
}
console.log(failed ? `${failed} FAILED` : 'ALL OK');
process.exit(failed ? 1 : 0);
