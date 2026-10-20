// Phase 1.5 step 6: the Gmail sender (OAuth refresh, MIME), the email rows'
// delivery through the queue job, the daily budget with the critical / OTP
// reserves, the daily summary, retries / dead letters and the token health.
// Google is faked; real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.mjs';
import { activityStmt } from '../src/lib/activity.js';
import { route } from '../src/notify/router.js';
import { notifyTick } from '../src/notify/tick.js';
import { JOB_TYPES } from '../src/jobs.js';
import { setGmailFetch } from '../src/notify/gmail.js';
import { allowed, budget, tokenHealth, quotaOf, hourKey } from '../src/notify/email.js';

const P = 'p@example.com', M = 'm@example.com';
const SECRETS = { GMAIL_CLIENT_ID: 'cid', GMAIL_CLIENT_SECRET: 'cs', GMAIL_REFRESH_TOKEN: 'rt' };
const set = (h, key, value) => h.db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
const outbox = h => h.db.prepare("SELECT * FROM notify_outbox WHERE channel = 'email' ORDER BY created_ms").all().then(r => r.results);

function fakeGoogle({ token = 'ok', send = () => 200 } = {}) {
  const g = { tokens: 0, mails: [] };
  setGmailFetch(async (url, init) => {
    if (url.includes('oauth2.googleapis.com/token')) {
      g.tokens++;
      if (token === 'revoked') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      return new Response(JSON.stringify({ access_token: 'at-' + g.tokens, expires_in: 3600 }));
    }
    const status = send(g.mails.length);
    const raw = JSON.parse(init.body).raw;
    g.mails.push(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (status === 200) return new Response(JSON.stringify({ id: 'msg-' + g.mails.length }));
    return new Response(JSON.stringify({ error: { status: status === 429 ? 'RESOURCE_EXHAUSTED' : 'INTERNAL', message: status === 429 ? 'quota' : 'x' } }), { status });
  });
  return g;
}
const decode = mail => {
  const parts = mail.split(/\r\n\r\n/);
  const b64 = s => Buffer.from(s.replace(/\r\n/g, '').split('--')[0], 'base64').toString('utf8');
  return { head: parts[0], text: b64(parts[2]), html: b64(parts[3]) };
};

async function world({ email = '1', secrets = true } = {}) {
  const h = harness({ env: secrets ? SECRETS : {} });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'مينا', 'primary', 1, 0), ('${M}', 'مرقس', 'admin', 1, 0)`).run();
  await set(h, 'NOTIFY_ROUTER', '1');
  await set(h, 'NOTIFY_EMAIL', email);
  await route(h.env, Date.now() - 1);
  return h;
}
const publish = (h, id, at = Date.now()) => activityStmt(h.db, { id, at, actor: M, actorName: 'مرقس', action: 'publish', entityType: 'site', summary: 'نشر الموقع' }).run();
const critical = (h, id, at = Date.now()) => activityStmt(h.db, { id, at, actor: 'system', action: 'migrate', entityType: 'data', summary: 'نقل البيانات' }).run();
async function deliver(h, now = Date.now()) {
  h.sent.length = 0;
  await notifyTick(h.env, now);
  for (const job of h.sent.filter(j => j.type === 'notify.email')) await JOB_TYPES['notify.email'](h.env, job.payload);
}

// (MIME and templates: notify-mail-format.test.mjs)

test('email: nothing while NOTIFY_EMAIL is off or Gmail is not set up; on → queued job → sent once, counted', async () => {
  const off = await world({ email: '0' });
  const g = fakeGoogle();
  await publish(off, 'act-pub00000e001');
  await deliver(off);
  assert.equal((await outbox(off)).length, 0);

  const unset = await world({ secrets: false });
  await publish(unset, 'act-pub00000e002');
  await deliver(unset);
  assert.equal((await outbox(unset))[0].status, 'queued', 'waits for the consent');
  assert.equal(g.mails.length, 0);

  const h = await world();
  await publish(h, 'act-pub00000e003');
  await deliver(h);
  const rows = await outbox(h);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recipient, P);
  assert.equal(rows[0].status, 'sent');
  assert.equal(g.mails.length, 1);
  assert.match(decode(g.mails[0]).text, /مرقس نشر الموقع/);
  const q = await h.db.prepare('SELECT total, critical FROM notify_quota').first();
  assert.deepEqual({ ...q }, { total: 1, critical: 0 });
  await deliver(h);
  assert.equal(g.mails.length, 1, 'never twice');
  assert.equal(g.tokens, 1, 'the access token is reused');
});

test('budget: non-critical stops at the admin budget minus the critical reserve; critical uses the reserve; OTP keeps its own', () => {
  const b = budget({ MAIL_DAILY_TARGET: '400', MAIL_ADMIN_BUDGET: '150', MAIL_RESERVE_CRITICAL: '50', MAIL_RESERVE_OTP: '50' });
  assert.equal(allowed('important', { total: 99, critical: 0, otp: 0 }, b), true);
  assert.equal(allowed('important', { total: 100, critical: 0, otp: 0 }, b), false);
  assert.equal(allowed('critical', { total: 100, critical: 0, otp: 0 }, b), true);
  assert.equal(allowed('critical', { total: 349, critical: 249, otp: 0 }, b), true);
  assert.equal(allowed('critical', { total: 350, critical: 250, otp: 0 }, b), false, 'the OTP reserve is never taken');
  assert.equal(allowed('otp', { total: 399, critical: 0, otp: 399 }, b), true);
  assert.equal(allowed('otp', { total: 400, critical: 0, otp: 400 }, b), false);
});

test('budget short: important goes into the summary; critical waits as deferred_quota (never lost, never expires)', async () => {
  const h = await world();
  const g = fakeGoogle();
  await set(h, 'MAIL_ADMIN_BUDGET', '50');
  await set(h, 'MAIL_RESERVE_CRITICAL', '50');      // no room for non-critical admin mail
  await set(h, 'MAIL_DAILY_TARGET', '101');
  await set(h, 'MAIL_RESERVE_OTP', '50');
  await h.db.prepare('INSERT INTO notify_quota (day, total, critical, otp) VALUES (?, 51, 0, 0)').bind(hourKey(Date.now())).run();
  await publish(h, 'act-pub00000e004');
  await critical(h, 'act-mig00000e001');
  await deliver(h);
  const rows = await outbox(h);
  assert.equal(rows.find(r => r.kind === 'publish').status, 'deferred', 'important → the summary');
  const crit = rows.find(r => r.kind === 'migrate');
  assert.equal(crit.status, 'deferred_quota');
  assert.ok(crit.next_ms > Date.now());
  assert.equal(g.mails.length, 0);
  // the next window: the budget is back
  await h.db.prepare('DELETE FROM notify_quota').run();
  await deliver(h, crit.next_ms + 1000);
  assert.equal((await outbox(h)).find(r => r.kind === 'migrate').status, 'sent');
});

test('summary: a recipient\'s due rows → ONE email, all marked sent', async () => {
  const h = await world();
  const g = fakeGoogle();
  await h.db.prepare("INSERT INTO notify_prefs (email, type, channel, mode, updated_at) VALUES (?, 'publish', 'email', 'summary', 0)").bind(P).run();
  await publish(h, 'act-pub00000e005');
  await publish(h, 'act-pub00000e006', Date.now() + 1);
  await route(h.env);
  const rows = await outbox(h);
  assert.equal(rows.length, 1);
  await deliver(h, rows[0].next_ms + 1000);
  assert.equal(g.mails.length, 1);
  const d = decode(g.mails[0]);
  assert.equal((d.text.match(/•/g) || []).length, 2, 'both items in the one summary');
  assert.ok((await outbox(h)).every(r => r.status === 'sent'));
});

test('failures: Gmail errors retry with backoff; dead after 5 → critical notify.failed (push only); Google\'s quota → summary / deferred_quota', async () => {
  const h = await world();
  fakeGoogle({ send: () => 500 });
  await publish(h, 'act-pub00000e007');
  await deliver(h);
  let row = (await outbox(h))[0];
  assert.equal(row.status, 'failed');
  assert.ok(row.next_ms > Date.now());
  for (let i = 0; i < 4; i++) {
    await h.db.prepare('UPDATE notify_outbox SET next_ms = 0').run();
    await deliver(h);
  }
  row = (await outbox(h))[0];
  assert.equal(row.status, 'dead');
  const alarm = await h.db.prepare("SELECT severity FROM activity WHERE action = 'notify.failed'").first();
  assert.equal(alarm.severity, 'critical');
  await route(h.env);
  assert.equal((await outbox(h)).filter(r => r.kind === 'notify.failed').length, 0, 'the alarm is never an email (push only)');

  fakeGoogle({ send: () => 429 });
  await critical(h, 'act-mig00000e002');
  await publish(h, 'act-pub00000e008', Date.now() + 1);
  await deliver(h);
  const rows = await outbox(h);
  assert.equal(rows.find(r => r.kind === 'migrate').status, 'deferred_quota');
  assert.equal(rows.find(r => JSON.parse(r.activity_ids).includes('act-pub00000e008')).status, 'deferred');
});

test('token health: fine → no alarm; revoked → ONE critical gmail.token row; not set up → no alarm', async () => {
  const h = await world();
  fakeGoogle();
  assert.equal((await tokenHealth(h.env)).ok, true);
  fakeGoogle({ token: 'revoked' });
  assert.equal((await tokenHealth(h.env)).ok, false);
  await tokenHealth(h.env);
  const rows = (await h.db.prepare("SELECT severity FROM activity WHERE action = 'gmail.token'").all()).results;
  assert.equal(rows.length, 1, 'once per breakage');
  const health = JSON.parse(await h.db.prepare("SELECT value FROM settings WHERE key = 'GMAIL_HEALTH'").first('value'));
  assert.deepEqual([health.ok, health.configured], [false, true]);

  const unset = await world({ secrets: false });
  assert.equal((await tokenHealth(unset.env)).configured, false);
  assert.equal(await unset.db.prepare("SELECT COUNT(*) n FROM activity WHERE action = 'gmail.token'").first('n'), 0);
  setGmailFetch(null);
});

test('rolling 24 hours (like Gmail): yesterday evening counts after midnight; an hour older than 24 h drops out', async () => {
  const h = await world();
  const at = Date.UTC(2026, 9, 20, 1, 30);                 // 01:30 UTC
  const put = (ms, n, c = 0) => h.db.prepare('INSERT INTO notify_quota (day, total, critical, otp) VALUES (?, ?, ?, 0)').bind(hourKey(ms), n, c).run();
  await put(at - 2 * 3600000, 200, 10);                    // 23:30 the evening before
  await put(at - 3600000, 150);                            // 00:30
  await put(at - 25 * 3600000, 999);                       // older than the window
  await h.db.prepare("INSERT INTO notify_quota (day, total, critical, otp) VALUES ('2026-10-20', 999, 0, 0)").run();   // an old per-day row is ignored
  assert.deepEqual({ ...(await quotaOf(h.db, at)) }, { total: 350, critical: 10, otp: 0 });
  const b = budget({});
  assert.equal(allowed('important', await quotaOf(h.db, at), b), false, 'a new calendar day does not reset the budget');
  assert.equal(allowed('critical', await quotaOf(h.db, at), b), false, '350 = target − OTP reserve');
  assert.equal(allowed('otp', await quotaOf(h.db, at), b), true, 'the OTP reserve stays free');
  assert.equal((await quotaOf(h.db, at + 22 * 3600000)).total, 150, 'the 23:30 hour left the window, 00:30 still in');
});
