// «خبزنا اليومي» P5 «مناسبات كنيستنا» on STAGING (docs/daily-bread/saints/P5-PLAN.md §8): the Staging Worker and D1
// (migration 0037 applied). For the run only, in Staging only: BREAD_SAINTS (the registry routes), then BREAD_MODULE +
// BREAD_OCCASIONS (the public file). Everything back as it was at the end, the switches' rows exactly.
//   the seed (16 occasions, the diocese changed, Abu Sefein's tamgeed) → the review → the publish writes saints.json AND
//   occasions.json → the public file is `disabled` while BREAD_OCCASIONS is off → on: the file (16, the two patrons, the
//   35 verses) → an occasion saved with a person's day (and a bad link refused) → back to the publish before the run.
// Never NOTIFY_*, PUSH_*, PERMS_ENFORCE; no push of any kind (P5 sends none). The production Worker is never asked.
//   STAGING_KEYS_DIR=<folder with .staging-test-key.pem> node tools/occasions-staging.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { join } from 'node:path';
import { ROOT } from './lib/gs.mjs';

const BASE = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const KEYS = process.env.STAGING_KEYS_DIR || join(ROOT, 'worker');
const PEM = readFileSync(join(KEYS, '.staging-test-key.pem'), 'utf8');
const SWITCHES = "('BREAD_SAINTS', 'BREAD_MODULE', 'BREAD_PUSH', 'BREAD_OCCASIONS', 'NOTIFY_ROUTER', 'NOTIFY_EMAIL', 'PUSH_SENDER', 'PERMS_ENFORCE', 'CONTENT_DRAFTS')";
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
  const headers = { origin: ORIGIN, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ms: Date.now() - t0, body: await res.json().catch(() => null) };
}
const P = google('loadtest@staging.invalid', 'loadtest-1');
const admin = (method, path, body) => call(method, '/v1/admin/' + path, body, P);

const before = sql(`SELECT key, value, updated_at, updated_by FROM settings WHERE key IN ${SWITCHES}`);
console.log('Staging switches before:', before.map(r => r.key + '=' + r.value).join(' '));
check('0037 applied: 16 occasions, BREAD_OCCASIONS = 0', sql("SELECT COUNT(*) AS n FROM saints_items WHERE kind = 'occasion'")[0].n === 16 && before.find(r => r.key === 'BREAD_OCCASIONS').value === '0');
const merc = JSON.parse(sql("SELECT data FROM saints_items WHERE kind = 'person' AND id = 'mercurius'")[0].data);
check('Abu Sefein: the tamgeed sung in church (35 verses, avarewase.org)', merc.praise.verses.length === 35 && /avarewase/.test(merc.praise.source), merc.praise.source);

let base = null;
try {
  check('BREAD_SAINTS on (Staging only, for the run)', (await admin('POST', 'bread/settings', { saints: true })).status === 200);
  const hist = await admin('GET', 'bread/saints/history');
  base = hist.body.publishes.length ? hist.body.publishes[0].rev : null;
  const rv = await admin('GET', 'bread/saints/review');
  const again = !rv.body.changes.length;   // a second run: the P5 publish is already on Staging
  check('review: no problems' + (again ? ' (already published)' : '; the 16 occasions and Abu Sefein in the changes'), rv.status === 200 && rv.body.errors.length === 0 && (again || (rv.body.changes.filter(c => c.kind === 'occasion').length >= 15 && rv.body.changes.some(c => c.id === 'mercurius'))), rv.body.errors || rv.body);
  console.log('     review: ' + rv.ms + ' ms');
  if (!again) {
    const pub = await admin('POST', 'bread/saints/publish', { expect: rv.body.expect });
    check('publish → saints.json + occasions.json', pub.status === 200, pub.body);
    console.log('     publish: ' + pub.ms + ' ms (rev ' + (pub.body && pub.body.rev) + ')');
  }
  const occ = sql("SELECT length(body) AS n, body FROM published_revisions WHERE kind = 'bread' AND key = 'occasions' AND live = 1")[0];
  const file = JSON.parse(occ.body);
  check('occasions.json: 16, the two patrons, small, nothing internal', file.occasions.length === 16 && file.patrons.patron && file.patrons.family && occ.n < 30000 && !/"src"|"credit"|"pending"/.test(occ.body), { n: occ.n, len: file.occasions.length });
  if (!again) check('a mirror job for each file', sql("SELECT COUNT(*) AS n FROM publish_jobs WHERE mode = 'bread' AND created_at >= " + (Date.now() - 600000))[0].n >= 2);

  const off = await call('GET', '/v1/bread/file/occasions');
  check('public file: `disabled` while the switches are off', off.body && off.body.code === 'disabled', off.body);
  check('BREAD_MODULE + BREAD_OCCASIONS on (Staging only)', (await admin('POST', 'bread/settings', { module: true, occasions: true })).status === 200);
  const on = await call('GET', '/v1/bread/file/occasions');
  check('public file: 16 occasions, Abu Sefein\'s 35 verses', on.status === 200 && on.body.occasions.length === 16 && on.body.patrons.patron.praise.verses.length === 35, on.status);
  console.log('     GET occasions: ' + on.ms + ' ms');

  // an occasion with a person's day: saved; a link to a day that is not there: refused
  const list = await admin('GET', 'bread/saints');
  const it = list.body.items.find(i => i.id === 'ibrahimpriest');
  const s = await admin('POST', 'bread/saints/item', { kind: 'occasion', rev: it.rev, item: { ...it.data, lead: it.data.lead + ' (فحص Staging)' } });
  check('save an occasion (from a person\'s day)', s.status === 200 && s.body.item.state === 'changed', s.body);
  const bad = await admin('POST', 'bread/saints/item', { kind: 'occasion', rev: 0, item: { id: 'stagingx', name: 'x', type: 'fathers', from: { person: 'ibrahimisravim', feast: 'مش موجود' }, headline: 'x' } });
  check('a link to a missing day is refused', bad.status === 400, bad.body);
  // owner 2026-11-25: «من غير مصدر مكتوب» (source owner) is saved; nothing at all is refused with the reason
  const own = await admin('POST', 'bread/saints/item', { kind: 'occasion', rev: 0, item: { id: 'stagingowner', name: 'x', type: 'fathers', gregorian: '06-06', source: 'owner', headline: 'النهارده (فحص Staging)' } });
  check('«من غير مصدر مكتوب» saved', own.status === 200, own.body);
  const none = await admin('POST', 'bread/saints/item', { kind: 'occasion', rev: 0, item: { id: 'stagingnone', name: 'x', gregorian: '06-06', headline: 'x' } });
  check('no source at all: refused with the reason', none.status === 400 && /المصدر/.test(JSON.stringify(none.body)), none.body);
  if (own.status === 200) check('the test occasion removed', (await admin('POST', 'bread/saints/item/delete', { kind: 'occasion', id: 'stagingowner', rev: own.body.item.rev })).status === 200);
} finally {
  // the test edit back («رجّع» = the published version); the P5 publish itself stays on Staging (the seed is what the
  // owner looks at there; a restore to the publish before would drop the 0037 seed from the drafts). base: for the log.
  const rv2 = await admin('POST', 'bread/saints/item/revert', { kind: 'occasion', id: 'ibrahimpriest' });
  check('the test edit reverted (publish before the run: rev ' + base + ')', rv2.status === 200, rv2.body);
  for (const r of before) sql(`UPDATE settings SET value = '${r.value}', updated_at = ${r.updated_at}, updated_by = '${String(r.updated_by).replace(/'/g, "''")}' WHERE key = '${r.key}'`);
  const now = sql(`SELECT key, value, updated_at, updated_by FROM settings WHERE key IN ${SWITCHES}`);
  console.log('Staging switches after: ', now.map(r => r.key + '=' + r.value).join(' '));
  check('every switch exactly as it was', JSON.stringify(now.sort((a, b) => a.key < b.key ? -1 : 1)) === JSON.stringify(before.sort((a, b) => a.key < b.key ? -1 : 1)));
}
console.log(failed ? `${failed} FAILED` : 'ALL OK');
process.exit(failed ? 1 : 0);
