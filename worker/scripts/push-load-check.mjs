// Load check on STAGING (Phase 6 Step 6): one live bell item to N made-up devices (default 500), through the
// minute cron, the queue and the real FCM (a made-up device: FCM refuses it, nobody gets anything).
// Turns PUSH_SENDER and PUSH_AUTO_BELL on for the check and puts them back; the site's live content is put back too.
// Run from worker/: node scripts/push-bell-check.mjs
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const RUN = Date.now().toString(36);
const NOTIF = 'notif-chk' + RUN;
const N = Number(process.argv[2]) || 500;
const TOKENS = Array.from({ length: N }, (_, i) => ('chk_' + RUN + '_load_' + i + '_').padEnd(150, 'x'));
const idOf = t => 'h' + createHash('sha256').update(t).digest('hex').slice(0, 40);   // push/devices.js pushHash
let failed = 0;

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
}
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { encoding: 'utf8', shell: true });
  if (r.status !== 0) throw new Error('d1: ' + String(r.stderr).slice(0, 300));
  return JSON.parse(r.stdout)[0].results;
}
/* a statement too long or too quoted for a command line: from a file */
function sqlFile(statement) {
  const file = join(mkdtempSync(join(tmpdir(), 'bellchk-')), 'stmt.sql');
  writeFileSync(file, statement);
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--file', file], { encoding: 'utf8', shell: true });
  if (r.status !== 0) throw new Error('d1 file: ' + String(r.stderr).slice(0, 300));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const wallIn = min => new Date(Date.now() + 2 * 3600000 + min * 60000).toISOString().slice(0, 16);

const before = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('PUSH_SENDER', 'PUSH_AUTO_BELL', 'PUSH_AUTO_BELL_SINCE')").map(r => [r.key, r.value]));
const liveBefore = (sql("SELECT id, body FROM published_revisions WHERE kind = 'content' AND key = 'site' AND live = 1")[0]) || null;
const REV = 'rev-chk' + RUN;

try {
  const content = liveBefore ? JSON.parse(liveBefore.body) : { schema: 3, notifications: [] };
  content.notifications = [...(content.notifications || []), { id: NOTIF, type: 'general', title: 'فحص', message: 'فحص', target: null, image: null, publishAt: wallIn(-1), expireAt: wallIn(600) }];
  const body = JSON.stringify(content).replace(/'/g, "''");
  const maxRev = sql("SELECT COALESCE(MAX(rev), 0) AS n FROM published_revisions WHERE kind = 'content' AND key = 'site'")[0].n;
  for (let i = 0; i < N; i += 100) sqlFile(TOKENS.slice(i, i + 100).map(t => `INSERT INTO push_devices (id, token, audience, created_ms, last_ms) VALUES ('${idOf(t)}', '${t}', 'public', 1, ${Date.now()});`).join('\n'));
  sql(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('PUSH_AUTO_BELL_SINCE', '${wallIn(-30)}', 0, 'check') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  sql("UPDATE published_revisions SET live = 0 WHERE kind = 'content' AND key = 'site' AND live = 1");
  sqlFile(`INSERT INTO published_revisions (id, kind, key, rev, hash, body, live, publish_id, published_at) VALUES ('${REV}', 'content', 'site', ${maxRev + 1}, 'chk', '${body}', 1, 'pub-chk', ${Date.now()})`);
  sql(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('PUSH_SENDER', 'worker', 0, 'check'), ('PUSH_AUTO_BELL', '1', 0, 'check') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

  const t0 = Date.now();
  let send = null;
  for (let i = 0; i < 60 && !(send && send.finished_ms); i++) {
    await wait(6000);
    send = sql(`SELECT status, targets, sent, removed, failed, parts, parts_done, error, send_key, started_ms, finished_ms FROM push_sends WHERE ref = '${NOTIF}'`)[0];
  }
  if (send && send.finished_ms) console.log('fan-out:', N, 'devices in', send.parts, 'parts, sent to FCM and finished in', Math.round((send.finished_ms - send.started_ms) / 1000), 's (from the switch:', Math.round((Date.now() - t0) / 1000), 's)');
  check('the minute cron sent the live bell item by itself', !!send && send.send_key === 'bell-' + NOTIF, send);
  check('… every part ran, FCM refused every made-up device, all removed, no auth error', send && send.finished_ms && send.parts_done === send.parts && send.removed === N && !send.error, send);
  await wait(70000);
  check('… once: no second send a minute later', sql(`SELECT COUNT(*) AS n FROM push_sends WHERE ref = '${NOTIF}'`)[0].n === 1);
} finally {
  const put = (key, value) => (value == null ? sql(`DELETE FROM settings WHERE key = '${key}'`) : sql(`UPDATE settings SET value = '${value}' WHERE key = '${key}'`));
  put('PUSH_SENDER', before.PUSH_SENDER);
  put('PUSH_AUTO_BELL', before.PUSH_AUTO_BELL);
  put('PUSH_AUTO_BELL_SINCE', before.PUSH_AUTO_BELL_SINCE);
  sql(`DELETE FROM published_revisions WHERE id = '${REV}'`);
  if (liveBefore) sql(`UPDATE published_revisions SET live = 1 WHERE id = '${liveBefore.id}'`);
  sql(`DELETE FROM push_parts WHERE send_id IN (SELECT id FROM push_sends WHERE ref = '${NOTIF}')`);
  sql(`DELETE FROM push_sends WHERE ref = '${NOTIF}'`);
  sql(`DELETE FROM push_devices WHERE token LIKE 'chk_${RUN}%'`);
}
const after = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('PUSH_SENDER', 'PUSH_AUTO_BELL', 'PUSH_AUTO_BELL_SINCE')").map(r => [r.key, r.value]));
check('the switches are back as they were', JSON.stringify(after) === JSON.stringify(before), { before, after });
const liveNow = sql("SELECT id FROM published_revisions WHERE kind = 'content' AND key = 'site' AND live = 1")[0];
check('the live content is back as it was', (liveNow && liveNow.id) === (liveBefore && liveBefore.id), liveNow);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
