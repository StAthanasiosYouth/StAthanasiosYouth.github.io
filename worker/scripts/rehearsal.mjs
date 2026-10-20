// Phase 1.5 step 9 — the STAGING rehearsal (BOOKING-PHASE1-COMPLETION-PLAN §4.8 stage 1).
// Live, on the staging Worker, with staging test identities:
//   A. the permission matrix with the presets (PERMS_ENFORCE=1 on staging only, restored);
//   B. the router: one item per level and module family, dedupe, the acknowledged claim,
//      retries → dead letter → a critical alarm, the flood guard;
//   C. the email quota with NO email sent (budget 0: critical waits as deferred_quota and
//      still goes by push; important goes into the summary);
//   D. a revoked Gmail token (simulated: Google refuses a fake refresh token; the real
//      secret is never touched), then healthy again;
//   E. «حالة النظام» shows all of it.
// Everything it switches is switched back (finally): router off, email off, enforce off,
// budget defaults, rehearsal admins removed, its waiting email rows dismissed.
// Real emails are NOT part of this script. Run: node scripts/rehearsal.mjs  (~6–8 min)
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { signSync } from '../src/lib/sync.js';

const base = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SYNC = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const P = 'loadtest@staging.invalid';
const RUN = Date.now().toString(36);
const T = `rh-treasurer-${RUN}@staging.invalid`;
const S = `rh-servant-${RUN}@staging.invalid`;
const V = `rh-viewer-${RUN}@staging.invalid`;
const EV = 'evt-rh' + RUN;
const SLUG = 'rh-' + RUN;
const SRV_A = 'srv-aaaa1111';
const SRV_B = 'srv-bbbb2222';
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + String(JSON.stringify(detail)).slice(0, 400))); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIN = 60000;

function token(email) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: email === P ? 'loadtest-1' : 'rh-' + email, email, email_verified: true, name: email.split('@')[0], iat: now, exp: now + 3600 });
  return 'Bearer ' + head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function call(email, method, path, body, extra = {}) {
  const res = await fetch(base + path, { method, headers: { origin: 'https://stathanasiosyouth.github.io', authorization: token(email), ...(body ? { 'content-type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
let lastTs = 0;
async function signed(path, payload) {
  const raw = JSON.stringify(payload);
  const ts = String(lastTs = Math.max(Date.now(), lastTs + 1));
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-ts': ts, 'x-sync-signature': await signSync(SYNC, ts, raw) }, body: raw });
  return { status: res.status, body: await res.json().catch(() => null) };
}
function sql(command) {
  const bin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const out = execFileSync(process.execPath, [bin, 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', command], { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) });
  return JSON.parse(out.slice(out.indexOf('['))).flatMap(r => r.results || []);
}
// Cairo wall clock 'YYYY-MM-DDTHH:MM' (DST-aware)
const stamp = ms => { const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day + 'T' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute; };
async function until(label, fn, tries = 18) {
  for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(10000); }
  console.log('  (gave up waiting: ' + label + ')');
  return null;
}

const fixture = {
  schema: 1, v: 'rev1', id: EV, slug: SLUG, kind: 'trip', title: 'رحلة البروفة ' + RUN,
  startAt: stamp(Date.now() + 10 * 864e5), endAt: stamp(Date.now() + 11 * 864e5),
  booking: {
    online: true, opensAt: stamp(Date.now() - 864e5), closesAt: stamp(Date.now() + 9 * 864e5), capacity: 20, showLeft: true, showLeftBelow: 5, perBookingMax: 6, collectNames: false,
    pricing: { mode: 'group', categories: [{ key: 'applicant', label: 'الحاجز', group: 'adult', price: 1500, seat: true, min: 1, max: 1, note: '' }] },
    payment: { mode: 'full', minFirst: 0, finalDueAt: '' },
    methods: [{ key: 'cash', label: 'كاش', needsProof: false }, { key: 'transfer', label: 'تحويل', needsProof: false, online: true }],
    servants: [{ id: SRV_A, name: 'مينا عادل', methods: ['cash', 'transfer'] }, { id: SRV_B, name: 'مرقس فادي', methods: ['cash'] }]
  }
};
const cash = (who, servantId, over = {}) => call(who, 'POST', '/v1/admin/book/bookings', {
  eventId: EV, requestKey: 'rh-' + Math.random().toString(36).slice(2, 12), name: 'بروفة ' + RUN, phone: '0100' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0'),
  counts: { applicant: 1 }, servantId, method: 'cash',
  payments: [{ kind: 'payment', amount: 500, servantId, method: 'cash', receivedAt: stamp(Date.now() - 60000), idemKey: 'rh-pay-' + Math.random().toString(36).slice(2, 12) }], ...over
});
const outbox = since => sql(`SELECT id, recipient, channel, kind, level, status, attempts FROM notify_outbox WHERE created_ms >= ${since} ORDER BY created_ms`);

try {
  /* ---------------- setup ---------------- */
  // test admins left by earlier staging checks: removed (only *@staging.invalid, never the Primary)
  // push rows left waiting by an interrupted earlier run: not part of this one
  sql("UPDATE notify_outbox SET status = 'dismissed', error = 'rehearsal: leftover' WHERE status IN ('queued', 'failed')");
  for (const a of sql("SELECT email FROM admins WHERE active = 1 AND role <> 'primary' AND email LIKE '%@staging.invalid'")) await call(P, 'POST', '/v1/admin/accounts/' + encodeURIComponent(a.email) + '/remove', {});
  check('fixture event', (await call(P, 'POST', '/v1/admin/diag/event-fixture', fixture)).status === 200);
  const presets = (await call(P, 'GET', '/v1/admin/accounts')).body.presets;
  for (const [email, preset, servantId] of [[T, 'treasurer', null], [S, 'servant_bookings', SRV_A], [V, 'viewer', null]]) {
    const r = await call(P, 'POST', '/v1/admin/accounts', { email, grants: presets[preset].grants, servantId });
    check(`admin with the «${presets[preset].label}» preset`, r.status === 200, r.body);
  }

  /* ---------------- A. permission matrix (enforcing) ---------------- */
  sql("UPDATE settings SET value = '1' WHERE key = 'PERMS_ENFORCE'");
  const matrix = [
    [V, 'GET', '/v1/admin/activity?view=log&limit=1', 200], [V, 'GET', '/v1/admin/book/finance?eventId=all', 200], [V, 'GET', `/v1/admin/book/report?events=${EV}`, 403],
    [V, 'GET', '/v1/admin/accounts', 403], [V, 'POST', '/v1/admin/notify/settings', 403, { email: false }], [V, 'GET', '/v1/admin/notify/me', 200],
    [V, 'POST', '/v1/admin/book/bookings/bkg-zzzzzz/confirm', 403, { version: 1 }],
    [T, 'GET', '/v1/admin/book/finance?eventId=all', 200], [T, 'GET', `/v1/admin/book/report?events=${EV}`, 200], [T, 'GET', '/v1/admin/accounts', 403],
    [T, 'POST', '/v1/admin/book/bookings/bkg-zzzzzz/confirm', 403, { version: 1 }], [T, 'GET', '/v1/admin/notify/status', 403],
    [S, 'GET', `/v1/admin/book/bookings?eventId=${EV}`, 200], [S, 'GET', '/v1/admin/book/finance?eventId=all', 403], [S, 'GET', `/v1/admin/book/report?events=${EV}`, 403],
    [S, 'POST', '/v1/admin/book/bookings/bkg-zzzzzz/confirm', 403, { version: 1 }], [S, 'GET', '/v1/admin/notify/settings', 403],
    [P, 'GET', `/v1/admin/book/report?events=${EV}`, 200], [P, 'GET', '/v1/admin/notify/status', 200]
  ];
  for (const [who, method, path, want, body] of matrix) {
    const r = await call(who, method, path, body);
    check(`matrix: ${who.split('-')[1] || 'primary'} ${method} ${path.split('?')[0]} → ${want}`, r.status === want, { status: r.status, body: r.body && (r.body.perm || r.body.code) });
  }
  const tr = await call(T, 'GET', `/v1/admin/book/report?events=${EV}`);
  check('matrix: the treasurer sees money but masked phones', tr.body && tr.body.access && tr.body.access.money === true && tr.body.access.pii === false, tr.body && tr.body.access);
  const own = await cash(S, SRV_A);
  check('matrix: the servant registers a cash booking for their own servant (pending, money recorded)', own.status === 200 && own.body.booking.status === 'pending', own.body);
  const other = await cash(S, SRV_B);
  check('matrix: … but not money for another servant (finance.manage)', other.status === 403 && other.body.perm === 'finance.manage', other.body);
  const confirmNow = await cash(S, SRV_A, { payments: undefined, confirm: { payments: [] } });
  check('matrix: … and cannot confirm at once (bookings.approve)', confirmNow.status === 403 && confirmNow.body.perm === 'bookings.approve', confirmNow.body);
  // the routing below runs ENFORCING too: recipients by real grants (the target state)

  /* ---------------- B. router: one item per level and module family ---------------- */
  const t0 = Date.now();
  const on = await call(P, 'POST', '/v1/admin/notify/settings', { router: true });
  check('router switched on («إعدادات الإشعارات»)', on.status === 200 && on.body.router === true, on.body);
  const since = Number(await until('NOTIFY_SINCE', async () => (sql("SELECT value FROM settings WHERE key = 'NOTIFY_SINCE'")[0] || {}).value));
  check('first tick: flood guard stamped (older waiting rows never sent)', since > 0 && sql(`SELECT COUNT(*) n FROM activity WHERE notified = 0 AND at < ${since}`)[0].n === 0);

  // critical (finance): the treasurer voids the servant's payment
  const bk = own.body;
  const payId = bk.payments && bk.payments[0] && bk.payments[0].id;
  const voided = await call(T, 'POST', `/v1/admin/book/payments/${payId}/void`, { reason: 'بروفة', idemKey: 'rh-void-' + RUN });
  check('critical item: a payment voided (finance)', voided.status === 200, voided.body);
  // important (bookings): a visitor's booking
  const sub = await fetch(base + '/v1/book/submit', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://stathanasiosyouth.github.io' },
    body: JSON.stringify({ slug: SLUG, requestKey: 'rh-pub-' + RUN, name: 'زائر البروفة', phone: '01011112222', counts: { applicant: 1 }, servantId: SRV_A, method: 'transfer', hp: '', revision: 'rev1', turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }) });
  check('important item: a visitor booking (bookings)', sub.status === 200);
  // important (content, from Apps Script): forwarded while the router is on → waiting for it
  const fwdId = 'act-' + (Date.now().toString(16) + '000000000000').slice(0, 12);
  const fwd = await signed('/v1/sync/activity', { rows: [{ id: fwdId, at: Date.now(), actor: 'content@staging.invalid', actorName: 'محرر', action: 'publish', type: 'site', entityId: 'site', title: 'الموقع', summary: 'نشر الموقع', count: 1, severity: 'important' }] });
  check('important item: a publish forwarded by Apps Script (content)', fwd.status === 200, fwd.body);
  check('… stored waiting for the router (not swallowed as notified)', (sql(`SELECT notified FROM activity WHERE id = '${fwdId}'`)[0] || {}).notified === 0);
  // routine (bookings): the Primary confirms the visitor's booking → nothing by default
  const pub = (await call(P, 'GET', `/v1/admin/book/bookings?eventId=${EV}`)).body.rows.find(b => b.name === 'زائر البروفة');
  const conf = await call(P, 'POST', `/v1/admin/book/bookings/${pub.id}/confirm`, { version: pub.version, overridePay: true, reason: 'بروفة', payments: [] });
  check('routine item: a booking confirmed (bookings)', conf.status === 200 || conf.status === 409, conf.body);
  // critical (system): the Gmail token "revoked"
  const rev = await call(P, 'POST', '/v1/admin/diag/gmail-health', { simulate: 'revoked' });
  check('critical item: Gmail token refused (simulated, real secret untouched)', rev.status === 200 && rev.body.health.ok === false && rev.body.health.configured === true, rev.body);

  const routed = await until('the router', async () => {
    const rows = outbox(t0);
    return ['payment.void', 'booking.new', 'publish', 'gmail.token'].every(k => rows.some(r => r.kind === k)) ? rows : null;
  });
  const rows = routed || outbox(t0);
  const to = k => rows.filter(r => r.kind === k).map(r => r.recipient + ':' + r.channel + ':' + r.level);
  check('routed: payment.void → the Primary, push, critical (never the treasurer who did it)', to('payment.void').includes(P + ':push:critical') && !to('payment.void').some(x => x.startsWith(T)), to('payment.void'));
  check('routed: booking.new → holders of bookings.approve (the Primary), not the servant/viewer', to('booking.new').includes(P + ':push:important') && !to('booking.new').some(x => x.startsWith(S) || x.startsWith(V)), to('booking.new'));
  check('routed: publish → holders of publish.publish only', to('publish').length >= 1 && to('publish').every(x => x.startsWith(P)), to('publish'));
  check('routed: gmail.token → push only (never an email about the email)', to('gmail.token').length >= 1 && to('gmail.token').every(x => x.includes(':push:')), to('gmail.token'));
  check('routine (booking.confirm) → nothing by default', !rows.some(r => r.kind === 'booking.confirm'));
  check('no email rows while NOTIFY_EMAIL is off', !rows.some(r => r.channel === 'email'));

  // dedupe: the same Apps Script row again → no second notification
  await signed('/v1/sync/activity', { rows: [{ id: fwdId, at: Date.now(), actor: 'content@staging.invalid', action: 'publish', type: 'site', summary: 'نشر الموقع', count: 2 }] });
  await sleep(70000);
  check('dedupe: a resent / merged row is not notified twice', outbox(t0).filter(r => r.kind === 'publish').length === to('publish').length);

  // the acknowledged claim (as Apps Script would), one item failing until dead
  const claim1 = await signed('/v1/sync/notify-claim', { v: 1, ack: [] });
  const items = (claim1.body && claim1.body.items) || [];
  check('claim: items handed out, critical first, with real messages', items.length >= 4 && items[0].level === 'critical' && items.every(i => i.title && i.url.startsWith('/admin/')), items.map(i => i.level + ' ' + i.title));
  // docs/EMAIL-DEEP-LINKS.md: booking / payment items open their exact record, never an email in a link
  check('claim: booking and payment items open the exact record', items.filter(i => /حجز|دفع/.test(i.title)).every(i => /^\/admin\/#open\/(booking|payments|bookings)\/(bkg|evt)-[a-z0-9]+$/.test(i.url)) && items.every(i => !/@/.test(i.url)), items.map(i => i.url));
  const victim = items.find(i => /نشر/.test(i.title)) || items[items.length - 1];
  await signed('/v1/sync/notify-claim', { v: 1, ack: items.map(i => ({ id: i.id, claim: i.claim, ok: i.id !== victim.id, reason: i.id === victim.id ? 'error' : 'rehearsal' })) });
  for (let i = 0; i < 4; i++) {
    sql(`UPDATE notify_outbox SET next_ms = 0 WHERE id = '${victim.id}'`);
    const c = await signed('/v1/sync/notify-claim', { v: 1, ack: [] });
    const again = (c.body.items || []).find(x => x.id === victim.id);
    if (again) await signed('/v1/sync/notify-claim', { v: 1, ack: [{ id: again.id, claim: again.claim, ok: false, reason: 'error' }] });
  }
  const vrow = sql(`SELECT status, attempts FROM notify_outbox WHERE id = '${victim.id}'`)[0];
  check('retry → dead after 5 attempts', vrow && vrow.status === 'dead', vrow);
  check('… and one critical «notify.failed» row for it', sql(`SELECT COUNT(*) n FROM activity WHERE action = 'notify.failed' AND entity_id = '${victim.id}' AND severity = 'critical'`)[0].n === 1);
  const okIds = items.filter(i => i.id !== victim.id).map(i => "'" + i.id + "'").join(',') || "''";
  const okRows = sql(`SELECT status FROM notify_outbox WHERE id IN (${okIds})`);
  check('the others were acknowledged → sent', okRows.length === items.length - 1 && okRows.every(r => r.status === 'sent'), okRows);

  /* ---------------- C. quota with no email sent ---------------- */
  sql("UPDATE settings SET value = '0' WHERE key IN ('MAIL_DAILY_TARGET', 'MAIL_ADMIN_BUDGET', 'MAIL_RESERVE_CRITICAL', 'MAIL_RESERVE_OTP'); UPDATE settings SET value = '1' WHERE key = 'NOTIFY_EMAIL'");
  const tq = Date.now();
  const sentBefore = sql("SELECT COALESCE(SUM(total), 0) n FROM notify_quota WHERE day LIKE 'h:%'")[0].n;
  sql(`INSERT INTO activity (id, at, cairo, actor, action, entity_type, summary, severity, notified) VALUES ('act-rq${RUN.slice(-6)}aaa', ${Date.now()}, '', 'system', 'migrate', 'data', 'بروفة الحصة', 'critical', 0)`);
  await signed('/v1/sync/activity', { rows: [{ id: 'act-' + (Date.now().toString(16) + '111111111111').slice(0, 12), at: Date.now(), actor: 'content@staging.invalid', action: 'publish', type: 'site', summary: 'نشر الموقع', count: 1 }] });
  const quotaRows = await until('quota handling', async () => {
    const r = outbox(tq).filter(x => x.channel === 'email');
    return r.length >= 2 && r.every(x => x.status !== 'queued') ? r : null;
  }, 24);
  const q = quotaRows || outbox(tq);
  check('quota: critical email over budget → deferred_quota (kept, never dropped)', q.some(x => x.kind === 'migrate' && x.channel === 'email' && x.status === 'deferred_quota'), q);
  check('quota: … and the same critical still goes by push at once', outbox(tq).some(x => x.kind === 'migrate' && x.channel === 'push'));
  check('quota: important email over budget → the daily summary', q.some(x => x.kind === 'publish' && x.channel === 'email' && x.status === 'deferred'), q);
  check('quota: no email went to Gmail (rolling counter unchanged)', sql("SELECT COALESCE(SUM(total), 0) n FROM notify_quota WHERE day LIKE 'h:%'")[0].n === sentBefore);
  sql("UPDATE settings SET value = '0' WHERE key = 'NOTIFY_EMAIL'");

  /* ---------------- E. monitoring ---------------- */
  const st = await call(P, 'GET', '/v1/admin/notify/status');
  const crit = (st.body && st.body.critical) || [];
  check('«حالة النظام»: the waiting critical email (deferred_quota) is listed', crit.some(c => c.status === 'deferred_quota'), crit);
  check('«حالة النظام»: the dead push is listed', crit.some(c => c.status === 'dead') || sql(`SELECT level FROM notify_outbox WHERE id = '${victim.id}'`)[0].level !== 'critical', crit.map(c => c.status));
  check('«حالة النظام»: Gmail shows broken', st.body && st.body.gmail && st.body.gmail.ok === false && st.body.gmail.configured === true, st.body && st.body.gmail);
  check('«حالة النظام»: per-day counts (sent, dead)', st.body && st.body.days.length > 0 && (st.body.days[0].push.sent || 0) >= 1, st.body && st.body.days[0]);

  /* ---------------- D. token healthy again ---------------- */
  const back = await call(P, 'POST', '/v1/admin/diag/gmail-health', {});
  check('Gmail token healthy again (the real secret)', back.status === 200 && back.body.health.ok === true, back.body);
  check('one «gmail.token» alert per breakage', sql(`SELECT COUNT(*) n FROM activity WHERE action = 'gmail.token' AND at >= ${t0}`)[0].n === 1);
} catch (err) {
  check('rehearsal ran to the end', false, String(err && err.stack || err));
} finally {
  sql("UPDATE settings SET value = '0' WHERE key IN ('PERMS_ENFORCE', 'NOTIFY_EMAIL', 'NOTIFY_ROUTER'); UPDATE settings SET value = '400' WHERE key = 'MAIL_DAILY_TARGET'; UPDATE settings SET value = '150' WHERE key = 'MAIL_ADMIN_BUDGET'; UPDATE settings SET value = '50' WHERE key IN ('MAIL_RESERVE_CRITICAL', 'MAIL_RESERVE_OTP')");
  sql("UPDATE notify_outbox SET status = 'dismissed', error = 'rehearsal' WHERE channel = 'email' AND status IN ('queued', 'failed', 'deferred', 'deferred_quota')");
  for (const email of [T, S, V]) await call(P, 'POST', `/v1/admin/accounts/${encodeURIComponent(email)}/remove`, {}).catch(() => {});
  const s = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('PERMS_ENFORCE', 'NOTIFY_EMAIL', 'NOTIFY_ROUTER', 'MAIL_DAILY_TARGET')").map(r => [r.key, r.value]));
  check('cleanup: enforce, email and router off; budget back to 400', s.PERMS_ENFORCE === '0' && s.NOTIFY_EMAIL === '0' && s.NOTIFY_ROUTER === '0' && s.MAIL_DAILY_TARGET === '400', s);
}
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
