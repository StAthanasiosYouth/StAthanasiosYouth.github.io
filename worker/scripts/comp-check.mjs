// Live STAGING check for batch 4 (docs/PHASE5-PLAN.md P5-7, P5-8): a competition pushed with its key, played by
// accounts; crediting, the visibility hold, a guest's stamp; grading; the store under a race; the real cron and queue.
// Uses only @staging.invalid addresses: nothing is emailed. Cleans up after itself. Run from worker/: node scripts/comp-check.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { signSync } from '../src/lib/sync.js';
import { msStamp } from '../src/book/model.js';

const base = process.argv[2] || 'https://athanasios-api-staging.menazak-lab.workers.dev';
if (!/staging/.test(base)) { console.error('refusing: staging only'); process.exit(2); }
const ORIGIN = 'https://stathanasiosyouth.github.io';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SYNC = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const RUN = Date.now().toString(36);
const stamp = String(Date.now()).slice(-6);
const HOUR = 3600000;
const SLUG = 'chk-' + RUN;
const SLUG2 = 'chk2-' + RUN;
const COMP = 'c-chk' + RUN;
const COMP2 = 'c-ch2' + RUN;
const ITEM = 'i-' + (Date.now() % 0xffffffff).toString(16).padStart(8, '0');
let failed = 0;
let serial = 0;
let tsBump = 0;

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
}
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { shell: true, encoding: 'utf8' });
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
async function member(birthDate = '2000-03-12') {
  serial++;
  const f = { email: `cmp-${RUN}-${serial}@staging.invalid`, phone: '012' + stamp + String(serial).padStart(2, '0'), name: 'مينا زكريا فؤاد', birthDate, turnstile: TOKEN };
  const s = await call('POST', '/v1/account/register/start', f);
  const d = await call('POST', '/v1/account/register/verify', { pendingId: s.body.pendingId, code: s.body.testCode });
  const si = await call('POST', '/v1/account/signin', { email: f.email, password: d.body.password, turnstile: TOKEN });
  return { ...f, token: si.body.session.token, id: si.body.account.id };
}
const key = () => 'chk-' + RUN + '-' + String(++serial).padStart(6, '0');
const def = (over = {}) => ({
  schema: 1, id: COMP, slug: SLUG, title: 'مسابقة الفحص', shortTitle: 'الفحص', startAt: '', endAt: '', resultsAt: '', participation: 'registered', scoring: true, resultShow: 'both', answersShow: 'immediately', answersAt: '',
  showPoints: true, wallet: true, attempts: 1, layout: 'one', shuffleQ: false, shuffleC: false, timeLimit: 0, maxSubmissions: 0,
  questions: [
    { id: 'q1', type: 'single', text: 'سؤال', help: '', media: null, required: true, points: 10, choices: [{ id: 'a', text: 'أ' }, { id: 'b', text: 'ب' }], correct: 'a', explanation: 'سر-الشرح', review: '' },
    { id: 'q2', type: 'long', text: 'مقال', help: '', media: null, required: false, points: 5, choices: [], correct: null, explanation: '', review: 'manual' }
  ],
  ...over
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

const before = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('MEMBER_EMAIL', 'SHOP_MODE', 'SHOP_ALLOW_CANCEL', 'SHOP_OPENS_AT', 'SHOP_CLOSES_AT')").map(r => [r.key, r.value]));
sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%' OR key LIKE 'comp.%' OR key LIKE 'shop.%' OR key LIKE 'sync.%'");
sql("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'");
sql("UPDATE settings SET value = '1' WHERE key = 'MEMBER_EMAIL'");

try {
  check('the push needs its signature', (await call('POST', '/v1/sync/comp-live', { comps: [] })).status === 401);
  const pushed = await sync('/v1/sync/comp-live', { comps: [{ slug: SLUG, compId: COMP, version: 'v1', def: def(), closedAt: '', finalizedAt: '' }] });
  check('a competition pushed, with its key', pushed.status === 200, pushed.body);

  check('no session → session', (await call('POST', '/v1/comp/start', { slug: SLUG, clientKey: key() })).body.code === 'session');
  const a = await member();
  const k = key();
  const s = await call('POST', '/v1/comp/start', { slug: SLUG, clientKey: k }, a.token);
  check('start: an attempt', s.status === 200 && !!s.body.attempt.id, s.body);
  check('… never the key or the explanation', !JSON.stringify(s.body).includes('correct') && !JSON.stringify(s.body).includes('سر-الشرح'));
  const again = await call('POST', '/v1/comp/start', { slug: SLUG, clientKey: key() }, a.token);
  check('… another device gets the same attempt', again.body.attempt.id === s.body.attempt.id && again.body.attempt.clientKey === k, again.body.attempt);
  const sent = await call('POST', '/v1/comp/submit', { token: s.body.attempt.token, clientKey: k, answers: { q1: 'a', q2: 'مقال طويل' } }, a.token);
  check('submit: the automatic part graded and credited at once', sent.status === 200 && sent.body.result.score === 10 && sent.body.result.pending === 1 && sent.body.result.pointsAwarded === 10, sent.body);
  check('… the review shows the key now the policy allows', JSON.stringify(sent.body.result.review || []).includes('سر-الشرح'));
  const twice = await call('POST', '/v1/comp/submit', { token: s.body.attempt.token, clientKey: k, answers: { q1: 'b' } }, a.token);
  check('… sent again: the stored result, nothing changes', twice.body.result.score === 10);
  check('… the second attempt is refused', (await call('POST', '/v1/comp/start', { slug: SLUG, clientKey: key() }, a.token)).body.code === 'limit');
  const me = await call('POST', '/v1/comp/me', {}, a.token);
  check('«نقاطي»: the balance and the history', me.body.balance === 10 && me.body.history[0].slug === SLUG && me.body.features.shop === true, me.body);

  const graded = await admin('POST', `comp/submissions/${s.body.attempt.id}/grade`, { grades: { q2: true } });
  check('a servant grades the essay: its points land', graded.status === 200 && graded.body.submission.status === 'graded' && graded.body.submission.score === 15, graded.body);
  check('… the balance follows', (await call('POST', '/v1/comp/me', {}, a.token)).body.balance === 15);
  const list = await admin('GET', `comp/${COMP}/submissions`);
  check('the results list: first place', list.body.submissions[0].rank === 1, list.body);

  // a guest
  const g = await member('1980-01-01');
  const gk = key();
  const gs = await call('POST', '/v1/comp/start', { slug: SLUG, clientKey: gk }, g.token);
  const gr = await call('POST', '/v1/comp/submit', { token: gs.body.attempt.token, clientKey: gk, answers: { q1: 'a' } }, g.token);
  check('a guest plays, stamped, no points', gr.status === 200 && gr.body.result.noPoints === true && gr.body.result.score === 10, gr.body);
  const row = sql(`SELECT elig, age_min, age_max, no_points FROM submissions WHERE id = '${gs.body.attempt.id}'`)[0];
  check('… the snapshot', row.elig === 'guest' && row.age_min === 18 && row.age_max === 30 && row.no_points === 1, row);
  check('… zero in the ledger', sql(`SELECT COUNT(*) AS n FROM points_ledger WHERE participant_id = '${g.id}'`)[0].n === 0);
  const ranked = (await admin('GET', `comp/${COMP}/submissions`)).body.submissions.find(x => x.guest);
  check('… a badge, no rank', ranked && ranked.rank === null, ranked);

  // the visibility hold
  const soon = msStamp(Date.now() + HOUR);
  const held = await sync('/v1/sync/comp-live', { comps: [{ slug: SLUG2, compId: COMP2, version: 'v1', def: def({ id: COMP2, slug: SLUG2, resultsAt: soon, answersShow: 'never' }), closedAt: '', finalizedAt: '' }] });
  check('a competition with a results date', held.status === 200, held.body);
  const h = await member();
  const hk = key();
  const hs = await call('POST', '/v1/comp/start', { slug: SLUG2, clientKey: hk }, h.token);
  const hr = await call('POST', '/v1/comp/submit', { token: hs.body.attempt.token, clientKey: hk, answers: { q1: 'a' } }, h.token);
  check('held: no score, no points in the reply', hr.status === 200 && hr.body.result.score === undefined && hr.body.result.pointsAwarded === undefined && hr.body.result.resultsAt === soon, hr.body);
  const hm = await call('POST', '/v1/comp/me', {}, h.token);
  check('… the member sees 0, the ledger has it', hm.body.balance === 0 && sql(`SELECT SUM(amount) AS n FROM points_ledger WHERE participant_id = '${h.id}'`)[0].n === 10, hm.body.balance);
  check('… the admin sees it', (await admin('GET', 'participants/' + h.id)).body.points.balance === 10);
  check('… no email yet', sql(`SELECT COUNT(*) AS n FROM member_outbox WHERE participant_id = '${h.id}' AND kind = 'res.result'`)[0].n === 0);
  await sync('/v1/sync/comp-live', { comps: [{ slug: SLUG2, compId: COMP2, version: 'v1', def: {}, closedAt: '', finalizedAt: msStamp(Date.now()) }] }).catch(() => null);
  const fin = await sync('/v1/sync/comp-live', { comps: [{ slug: SLUG2, compId: COMP2, version: 'v1', def: def({ id: COMP2, slug: SLUG2, resultsAt: soon, answersShow: 'never' }), closedAt: '', finalizedAt: msStamp(Date.now()) }] });
  check('finalize arrives', fin.status === 200, fin.body);
  const t0 = Date.now();
  let released = false;
  while (!released && Date.now() - t0 < 150000) {
    await sleep(10000);
    released = (await call('POST', '/v1/comp/me', {}, h.token)).body.balance === 10;
  }
  check('the real cron releases it: the balance shows', released);
  const open = () => sql(`SELECT COUNT(*) AS n FROM member_outbox WHERE kind LIKE 'res.%' AND status IN ('queued', 'failed') AND participant_id = '${h.id}'`)[0].n;
  const t1 = Date.now();
  while (open() && Date.now() - t1 < 150000) await sleep(10000);
  const res = sql(`SELECT status, error FROM member_outbox WHERE participant_id = '${h.id}' AND kind = 'res.result'`);
  check('… one result email, to the test inbox', res.length === 1 && res[0].status === 'sent' && res[0].error === 'test inbox', res);

  // the store
  check('the schedule', (await admin('POST', 'store/schedule', { mode: 'open', allowCancel: true })).status === 200);
  const imported = await sync('/v1/sync/store-import', { items: [{ id: ITEM, name: 'جايزة الفحص', description: '', cost: 10, stock: 2, perPerson: 1, category: '', order: 0, active: true }] });
  check('prizes import', imported.status === 200, imported.body);
  const buyers = [a];
  for (let i = 0; i < 3; i++) {
    const m = await member();
    await admin('POST', `participants/${m.id}/points`, { amount: 50, note: 'فحص', key: 'chk-seed-' + m.id.slice(2) });
    buyers.push(m);
  }
  const race = await Promise.all(buyers.map((m, i) => call('POST', '/v1/shop/redeem', { itemId: ITEM, requestKey: `chk-${RUN}-r${i}` }, m.token)));
  check('stock 2, four at once → exactly 2', race.filter(r => r.status === 200).length === 2 && race.filter(r => r.body.code === 'stock').length === 2, race.map(r => r.body.code || r.status));
  check('… only those two charged', sql(`SELECT COUNT(*) AS n FROM points_ledger WHERE kind = 'spend' AND ref IN (SELECT 'red:' || id FROM redemptions WHERE item_id = '${ITEM}')`)[0].n === 2);
  const winner = race.findIndex(r => r.status === 200);
  const rid = race[winner].body.redemption.id;
  const replay = await call('POST', '/v1/shop/redeem', { itemId: ITEM, requestKey: `chk-${RUN}-r${winner}` }, buyers[winner].token);
  check('the same key = the same request', replay.body.redemption.id === rid, replay.body);
  check('a guest is refused on the server', (await call('POST', '/v1/shop/redeem', { itemId: ITEM, requestKey: `chk-${RUN}-g` }, g.token)).body.code === 'not_eligible');
  const canClose = await admin('GET', 'points/seasons');
  const season = canClose.body.seasons.find(x => x.status === 'active');
  const pre = await admin('GET', `points/seasons/${season.id}/preview`);
  const refused = await admin('POST', `points/seasons/${season.id}/close`, { key: pre.body.key, next: { name: 'لن يحدث' } });
  check('a season with open requests can not close', refused.body.code === 'final' && refused.body.openRequests >= 1, refused.body);
  const before2 = (await call('POST', '/v1/comp/me', {}, buyers[winner].token)).body.balance;
  const ok = await admin('POST', `store/redemptions/${rid}/status`, { status: 'approved' });
  check('admin approves', ok.status === 200, ok.body);
  const back = await admin('POST', `store/redemptions/${rid}/status`, { status: 'cancelled', note: 'خلصت' });
  check('admin cancels', back.status === 200, back.body);
  check('… refunded once', (await call('POST', '/v1/comp/me', {}, buyers[winner].token)).body.balance === before2 + 10);
  check('… a second cancel is refused', (await admin('POST', `store/redemptions/${rid}/status`, { status: 'cancelled' })).status === 409);
  const t2 = Date.now();
  const openStore = () => sql(`SELECT COUNT(*) AS n FROM member_outbox WHERE entity_id = '${rid}' AND status IN ('queued', 'failed')`)[0].n;
  while (openStore() && Date.now() - t2 < 150000) await sleep(10000);
  const mails = sql(`SELECT kind, status FROM member_outbox WHERE entity_id = '${rid}'`);
  check('store email: receipt + cancelled sent; approved superseded by the cancel', mails.some(m => m.kind === 'store.cancelled' && m.status === 'sent') && mails.some(m => m.kind === 'store.requested'), mails);

  const scan = JSON.stringify(sql(`SELECT * FROM member_outbox WHERE participant_id = '${a.id}'`)) + JSON.stringify(sql("SELECT * FROM activity WHERE action IN ('review', 'redemption.status') ORDER BY at DESC LIMIT 30"));
  check('no key, answer or address in the outbox or activity', !scan.includes('سر-الشرح') && !scan.includes('مقال طويل') && !scan.includes(a.email));
} finally {
  const q = "(SELECT id FROM participants WHERE email LIKE 'cmp-" + RUN + "%')";
  sql(`DELETE FROM redemptions WHERE item_id = '${ITEM}'`);
  sql(`DELETE FROM store_items WHERE id = '${ITEM}'`);
  sql(`DELETE FROM submissions WHERE comp_id IN ('${COMP}', '${COMP2}')`);
  sql(`DELETE FROM comp_live WHERE comp_id IN ('${COMP}', '${COMP2}')`);
  sql(`DELETE FROM comp_versions WHERE comp_id IN ('${COMP}', '${COMP2}')`);
  sql(`DELETE FROM points_ledger WHERE participant_id IN ${q}`);
  sql(`DELETE FROM member_outbox WHERE participant_id IN ${q}`);
  sql(`DELETE FROM account_sessions WHERE participant_id IN ${q}`);
  sql(`DELETE FROM participant_audit WHERE participant_id IN ${q}`);
  sql(`DELETE FROM participants WHERE email LIKE 'cmp-${RUN}%'`);
  sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%' OR key LIKE 'comp.%' OR key LIKE 'shop.%'");
  for (const [k, v] of Object.entries(before)) sql(`UPDATE settings SET value = '${v}' WHERE key = '${k}'`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
