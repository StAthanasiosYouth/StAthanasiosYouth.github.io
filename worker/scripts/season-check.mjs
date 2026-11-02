// Live STAGING check for Phase 6 Step 3 (docs/PHASE6-PLAN.md): a competition's points land in its own season, a closed
// season gets nothing, closing refuses open requests and a second close; a prize keeps its picture.
// Uses only @staging.invalid addresses: nothing is emailed. Puts the seasons back and cleans up. Run from worker/: node scripts/season-check.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { signSync } from '../src/lib/sync.js';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const ORIGIN = 'https://stathanasiosyouth.github.io';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SYNC = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const RUN = Date.now().toString(36);
const stamp = String(Date.now()).slice(-6);
const SLUG = 'sea-' + RUN;
const COMP = 'c-sea' + RUN;
const PIC = 'img-' + (RUN + 'aaaaaaaa').slice(-8);
let failed = 0;
let serial = 0;
let tsBump = 0;

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
}
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { encoding: 'utf8', shell: true });
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
  const res = await fetch(base + path, { method, headers: { origin: ORIGIN, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const P = google('loadtest@staging.invalid', 'loadtest-1');
const admin = (method, path, body) => call(method, '/v1/admin/' + path, body, P);
async function sync(path, payload) {
  const raw = JSON.stringify(payload);
  const ts = String(Date.now() + (++tsBump) * 50);
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-ts': ts, 'x-sync-signature': await signSync(SYNC, ts, raw) }, body: raw });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function member() {
  serial++;
  const f = { email: `sea-${RUN}-${serial}@staging.invalid`, phone: '012' + stamp + String(serial).padStart(2, '0'), name: 'مينا زكريا فؤاد', birthDate: '2000-03-12', turnstile: TOKEN };
  const s = await call('POST', '/v1/account/register/start', f);
  const d = await call('POST', '/v1/account/register/verify', { pendingId: s.body.pendingId, code: s.body.testCode });
  const si = await call('POST', '/v1/account/signin', { email: f.email, password: d.body.password, turnstile: TOKEN });
  return { ...f, token: si.body.session.token, id: si.body.account.id };
}
const key = () => 'sea-' + RUN + '-' + String(++serial).padStart(6, '0');
const def = () => ({
  schema: 1, id: COMP, slug: SLUG, title: 'مسابقة المواسم', shortTitle: 'المواسم', startAt: '', endAt: '', resultsAt: '', participation: 'registered', scoring: true, resultShow: 'both', answersShow: 'immediately',
  showPoints: true, wallet: true, attempts: 1, layout: 'one', shuffleQ: false, shuffleC: false, timeLimit: 0, maxSubmissions: 0,
  questions: [{ id: 'q1', type: 'single', text: 'سؤال', help: '', media: null, required: true, points: 10, choices: [{ id: 'a', text: 'أ' }, { id: 'b', text: 'ب' }], correct: 'a', explanation: '', review: 'auto' }]
});
const choose = seasonId => sql(`INSERT INTO draft_rows (kind, id, pos, kver, data, hash, updated_ms) VALUES ('competitions', '${COMP}', 9999, 1, json_object('id', '${COMP}', 'seasonId', '${seasonId}'), 'chk', 0) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data`);
const play = async m => {
  const clientKey = key();
  const s = await call('POST', '/v1/comp/start', { slug: SLUG, clientKey }, m.token);
  return call('POST', '/v1/comp/submit', { token: s.body.attempt.token, clientKey, answers: { q1: 'a' } }, m.token);
};
const seasonsOf = id => sql(`SELECT season_id, SUM(amount) AS n FROM points_ledger WHERE participant_id = '${id}' GROUP BY season_id`);

const [{ id: ACTIVE }] = sql("SELECT id FROM seasons WHERE status = 'active'");
const before = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('MEMBER_EMAIL', 'SHOP_MODE', 'SHOP_ALLOW_CANCEL', 'SHOP_OPENS_AT', 'SHOP_CLOSES_AT')").map(r => [r.key, r.value]));
const beforeSeasons = JSON.stringify(sql('SELECT id, status FROM seasons ORDER BY id'));
const beforeTotals = sql(`SELECT COUNT(*) AS n FROM season_totals WHERE season_id = '${ACTIVE}'`)[0].n;
sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%' OR key LIKE 'comp.%' OR key LIKE 'shop.%' OR key LIKE 'sync.%' OR key LIKE 'points.%'");
sql("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'");
sql("UPDATE settings SET value = '' WHERE key = 'MEMBER_EMAIL'");
let NEXT = '';
let ITEM = '';

try {
  const pushed = await sync('/v1/sync/comp-live', { comps: [{ slug: SLUG, compId: COMP, version: 'v1', def: def(), closedAt: '', finalizedAt: '' }] });
  check('a competition pushed', pushed.status === 200, pushed.body);

  // the season a competition chose
  const made = await admin('POST', 'points/seasons', { name: 'موسم الفحص ' + RUN });
  NEXT = made.body.seasons.find(s => s.name === 'موسم الفحص ' + RUN).id;
  await choose(NEXT);
  const a = await member();
  check('it plays', (await play(a)).status === 200);
  const landed = seasonsOf(a.id);
  check('the points land in the competition\'s own season', landed.length === 1 && landed[0].season_id === NEXT && landed[0].n === 10, landed);
  check('… the active balance stays apart', (await call('POST', '/v1/comp/me', {}, a.token)).body.balance === 0);

  // what the admin's list says
  const list = (await admin('GET', 'points/seasons')).body;
  const shown = list.seasons.find(s => s.id === NEXT);
  check('the list carries the numbers', list.active === ACTIVE && typeof shown.maxTheoretical === 'number' && typeof shown.expected === 'number' && typeof shown.competitions === 'number', shown);
  check('… the active one its top balance', typeof list.seasons.find(s => s.id === ACTIVE).topBalance === 'number');

  // a prize's picture
  sql(`INSERT INTO draft_rows (kind, id, pos, kver, data, hash, updated_ms) VALUES ('media', '${PIC}', 9999, 1, json_object('id', '${PIC}', 'path', 'media/2026/${PIC}.webp', 'thumb', 'media/2026/${PIC}-480.webp', 'width', 640, 'height', 480, 'alt', 'فحص', 'publishedAt', '2026-11-02 10:00'), 'chk', 0)`);
  check('the schedule', (await admin('POST', 'store/schedule', { mode: 'open', allowCancel: true })).status === 200);
  check('a picture outside the library is refused', (await admin('POST', 'store/items', { name: 'جايزة', cost: 10, image: 'img-zzzzzzzz' })).body.code === 'invalid');
  const saved = await admin('POST', 'store/items', { name: 'جايزة الفحص ' + RUN, cost: 10, image: PIC });
  const item = saved.body.items.find(i => i.name === 'جايزة الفحص ' + RUN);
  ITEM = item.id;
  check('the admin reads the id back', item.image === PIC, item);

  // closing
  const b = await member();
  await admin('POST', `participants/${b.id}/points`, { amount: 50, note: 'فحص', key: 'sea-seed-' + b.id.slice(2) });
  const seen = (await call('POST', '/v1/comp/me', {}, b.token)).body.shop.find(i => i.id === ITEM);
  check('a member gets the file on the site', !!seen && seen.image && seen.image.src === `media/2026/${PIC}.webp`, seen);
  const bought = await call('POST', '/v1/shop/redeem', { itemId: ITEM, requestKey: `sea-${RUN}-r1` }, b.token);
  check('a prize request', bought.status === 200, bought.body);
  const pre = (await admin('GET', `points/seasons/${ACTIVE}/preview`)).body;
  const refused = await admin('POST', `points/seasons/${ACTIVE}/close`, { key: pre.key, next: NEXT });
  check('a season with an open request can\'t close', refused.body.code === 'final' && refused.body.openRequests === 1, refused.body);
  const cancelled = await admin('POST', `store/redemptions/${bought.body.redemption.id}/status`, { status: 'cancelled' });
  check('the request cancelled', cancelled.status === 200, cancelled.body);
  check('… the refund in the same season', seasonsOf(b.id).find(s => s.season_id === ACTIVE).n === 50, seasonsOf(b.id));
  const fresh = (await admin('GET', `points/seasons/${ACTIVE}/preview`)).body;
  const closed = await admin('POST', `points/seasons/${ACTIVE}/close`, { key: fresh.key, next: NEXT });
  check('with none open it closes, the chosen one next', closed.status === 200 && closed.body.active === NEXT, closed.body);
  check('… a second close is refused', (await admin('POST', `points/seasons/${ACTIVE}/close`, { key: fresh.key, next: NEXT })).status === 409);
  check('… the planned points count now', (await call('POST', '/v1/comp/me', {}, a.token)).body.balance === 10);

  // a competition tied to the closed season
  await choose(ACTIVE);
  const c = await member();
  check('it still takes the answer', (await play(c)).status === 200);
  check('… a closed season gets no points', seasonsOf(c.id).length === 0, seasonsOf(c.id));
} finally {
  const q = "(SELECT id FROM participants WHERE email LIKE 'sea-" + RUN + "%')";
  sql(`DELETE FROM redemptions WHERE item_id = '${ITEM}'`);
  sql(`DELETE FROM store_items WHERE id = '${ITEM}'`);
  sql(`DELETE FROM draft_rows WHERE kind = 'media' AND id = '${PIC}'`);
  sql(`DELETE FROM draft_rows WHERE kind = 'competitions' AND id = '${COMP}'`);
  sql(`DELETE FROM submissions WHERE comp_id = '${COMP}'`);
  sql(`DELETE FROM comp_live WHERE comp_id = '${COMP}'`);
  sql(`DELETE FROM comp_versions WHERE comp_id = '${COMP}'`);
  sql(`DELETE FROM points_ledger WHERE participant_id IN ${q}`);
  sql(`DELETE FROM member_outbox WHERE participant_id IN ${q}`);
  sql(`DELETE FROM account_sessions WHERE participant_id IN ${q}`);
  sql(`DELETE FROM participant_audit WHERE participant_id IN ${q}`);
  sql(`DELETE FROM participants WHERE email LIKE 'sea-${RUN}%'`);
  // the seasons as they were
  if (NEXT) sql(`DELETE FROM season_totals WHERE season_id = '${NEXT}'`);
  if (!beforeTotals) sql(`DELETE FROM season_totals WHERE season_id = '${ACTIVE}'`);
  if (NEXT) sql(`DELETE FROM seasons WHERE id = '${NEXT}'`);
  sql(`UPDATE seasons SET status = 'active', closed_ms = NULL, closed_by = NULL WHERE id = '${ACTIVE}'`);
  sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%' OR key LIKE 'comp.%' OR key LIKE 'shop.%' OR key LIKE 'points.%'");
  for (const [k, v] of Object.entries(before)) sql(`UPDATE settings SET value = '${v}' WHERE key = '${k}'`);
  check('the seasons are back as they were', JSON.stringify(sql('SELECT id, status FROM seasons ORDER BY id')) === beforeSeasons);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
