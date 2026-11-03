/*
 * The push sender (docs/PHASE6-PLAN.md Step 4b): Push.gs pushSendItem_ / pushFanout_ / pushCleanup_ and
 * NotifyClaim.gs adminPushTo_, on the Worker. Switch: settings.PUSH_SENDER = 'worker' (else Apps Script sends).
 *
 * - A send is a push_sends row and queue messages of ≤ PART_SIZE devices ('push.fanout'), never a loop in the cron:
 *   one consumer run may reach 50 outside addresses (jobs.js). A message carries device ids, never a token.
 * - A part is taken once (push_parts); a message delivered twice sends nothing twice.
 * - Transient failures get one more round, RETRY_DELAY_S later. A token FCM calls gone is deleted; one that failed
 *   MAX_FAILS sends in a row too, and a visitor's not seen for STALE_MS (housekeeping).
 * - Admin pushes: the router's push rows leave from the outbox here (adminPushTick, the minute cron), to the named
 *   admin's devices, sparing the device whose panel is in sight (D1 admin_sessions) unless the row is critical.
 *   While PUSH_SENDER = 'worker' the claim feed hands Apps Script nothing (notify/claim.js).
 */

import { ApiError } from '../lib/http.js';
import { retry, cairoText } from '../lib/db.js';
import { randomId } from '../lib/hash.js';
import { logLine } from '../lib/log.js';
import { cleanLabel } from '../admin/session.js';
import { serviceAccount, accessToken, forgetAccessToken, model, fcmMessage, sendOne, checkKey } from './fcm.js';
import { sources, messageFor, deadStmts, backoffMs, MAX_ATTEMPTS } from '../notify/claim.js';
import { makeJob } from '../jobs.js';

export const PART_SIZE = 45;
export const RETRY_DELAY_S = 30;
export const PART_LEASE_MS = 5 * 60000;
export const MAX_FAILS = 5;
export const STALE_MS = 270 * 86400000;
export const ADMIN_TTL = 86400;
export const PRESENT_MS = 70 * 1000;          // Presence.gs PRESENCE_ONLINE_SECONDS
export const ADMIN_LEASE_MS = 10 * 60000;     // an outbox row's send may take a retry round
export const ADMIN_CLAIM_MAX = 40;
export const SEND_COOLDOWN_MS = 60000;
export const SENDS_PER_DAY = 10;
const SENDING_STALE_MS = 10 * 60000;
const ID = /^h[0-9a-f]{40}$/;

export async function senderOn(db) {
  return (await retry(() => db.prepare("SELECT value FROM settings WHERE key = 'PUSH_SENDER'").first('value'))) === 'worker';
}

const inList = list => list.map(() => '?').join(',');

async function enqueue(env, payloads, delaySeconds, doFetch) {
  if (!env.JOBS) {
    // no queue (a test, a local run): here and now
    for (const p of payloads) await runPart(env, p, doFetch);
    return;
  }
  for (const p of payloads) await env.JOBS.send(makeJob('push.fanout', p), delaySeconds ? { delaySeconds } : undefined);
}

/*
 * One send → { id, targets } | { replay: row }. `devices`: push_devices ids of one audience.
 * message: the model (fcm.js); ttl in seconds.
 */
export async function startSend(env, { audience, ref, sendKey = null, by = '', message, ttl, devices, now = Date.now(), doFetch }) {
  const db = env.DB;
  const ids = [...new Set(devices)].filter(x => ID.test(x));
  const parts = [];
  for (let i = 0; i < ids.length; i += PART_SIZE) parts.push(ids.slice(i, i + PART_SIZE));
  const id = randomId('ps-');
  const r = await retry(() => db.prepare(`INSERT INTO push_sends (id, send_key, audience, ref, status, by, started_ms, targets, parts, message, ttl)
    VALUES (?, ?, ?, ?, 'sending', ?, ?, ?, ?, ?, ?) ON CONFLICT(send_key) DO NOTHING`)
    .bind(id, sendKey, audience, ref, by, now, ids.length, parts.length, JSON.stringify(message), ttl).run());
  if (!r.meta.changes) return { replay: await retry(() => db.prepare('SELECT * FROM push_sends WHERE send_key = ?').bind(sendKey).first()) };
  logLine({ kind: 'push', send: id, audience, targets: ids.length, parts: parts.length });
  try {
    await enqueue(env, parts.map((list, i) => ({ send: id, part: 'p' + i, ids: list, round: 0 })), 0, doFetch);
  } catch (err) {
    await retry(() => db.prepare("UPDATE push_sends SET status = 'failed', finished_ms = ?, failed = targets, error = 'queue' WHERE id = ? AND status = 'sending'").bind(Date.now(), id).run());
    throw err;
  }
  return { id, targets: ids.length };
}

/* the 'push.fanout' job: one part of one send. Idempotent */
export async function runPart(env, payload, doFetch = (...a) => fetch(...a), now = Date.now()) {
  const db = env.DB;
  const sendId = String(payload.send || '');
  const part = String(payload.part || '');
  const round = Number(payload.round) || 0;
  const ids = (Array.isArray(payload.ids) ? payload.ids : []).filter(x => ID.test(String(x))).slice(0, PART_SIZE);
  if (!/^ps-[0-9a-f]{6,}$/.test(sendId) || !/^[pr]\d{1,4}$/.test(part)) return { skipped: 'bad' };

  const taken = await retry(() => db.prepare(`INSERT INTO push_parts (send_id, part, taken_ms) VALUES (?, ?, ?)
    ON CONFLICT(send_id, part) DO UPDATE SET taken_ms = excluded.taken_ms WHERE push_parts.done_ms IS NULL AND push_parts.taken_ms < ?`)
    .bind(sendId, part, now, now - PART_LEASE_MS).run());
  if (!taken.meta.changes) return { skipped: 'taken' };

  const send = await retry(() => db.prepare('SELECT id, audience, ref, message, ttl, status FROM push_sends WHERE id = ?').bind(sendId).first());
  if (!send) return { skipped: 'gone' };
  const devices = ids.length ? (await retry(() => db.prepare(`SELECT id, token, platform FROM push_devices WHERE audience = ? AND id IN (${inList(ids)})`).bind(send.audience, ...ids).all())).results : [];
  const m = JSON.parse(send.message);
  const account = serviceAccount(env);
  // notOurs: failed through no fault of the device (no key, the key refused): never counted against it
  const out = { ok: [], dead: [], retry: [], failed: [], notOurs: new Set(), error: null };

  if (!account) {
    out.failed = devices.map(d => d.id);
    out.failed.forEach(id => out.notOurs.add(id));
    out.error = 'no key';
  } else if (devices.length) {
    let token = null;
    try {
      token = await accessToken(account, doFetch, { now });
    } catch (err) {
      out.error = err && err.code === 'auth' ? 'auth' : 'token';
    }
    const results = token ? await Promise.all(devices.map(d => sendOne(account, token, fcmMessage(d, m, send.ttl, now), doFetch))) : devices.map(() => 'auth');
    if (results.includes('auth')) {
      // the next round asks Google for a fresh token
      forgetAccessToken(account);
      out.error = out.error || 'auth';
    }
    devices.forEach((d, i) => {
      const kind = results[i] === 'auth' ? 'retry' : results[i];
      if (results[i] === 'auth') out.notOurs.add(d.id);
      (kind === 'ok' ? out.ok : kind === 'dead' ? out.dead : out.retry).push(d.id);
    });
  }
  const again = round === 0 && out.retry.length ? out.retry : [];
  if (!again.length) out.failed.push(...out.retry);

  const blamed = out.failed.filter(id => !out.notOurs.has(id));
  const stmts = [];
  if (out.ok.length) stmts.push(db.prepare(`UPDATE push_devices SET fails = 0 WHERE id IN (${inList(out.ok)})`).bind(...out.ok));
  if (blamed.length) stmts.push(db.prepare(`UPDATE push_devices SET fails = fails + 1 WHERE id IN (${inList(blamed)})`).bind(...blamed));
  const worn = blamed.length ? db.prepare(`DELETE FROM push_devices WHERE fails >= ? AND id IN (${inList(blamed)})`).bind(MAX_FAILS, ...blamed) : null;
  const gone = out.dead.length ? db.prepare(`DELETE FROM push_devices WHERE id IN (${inList(out.dead)})`).bind(...out.dead) : null;
  const firstRemove = stmts.length;
  if (gone) stmts.push(gone);
  if (worn) stmts.push(worn);
  const removes = stmts.length - firstRemove;
  stmts.push(db.prepare('UPDATE push_parts SET done_ms = ? WHERE send_id = ? AND part = ?').bind(now, sendId, part));
  // the removed count is added after the deletes, from their own result
  const counter = stmts.length;
  stmts.push(db.prepare(`UPDATE push_sends SET sent = sent + ?, failed = failed + ?, parts = parts + ?, parts_done = parts_done + 1, error = COALESCE(?, error) WHERE id = ?`)
    .bind(out.ok.length, out.failed.length, again.length ? 1 : 0, out.error, sendId));
  stmts.push(db.prepare(`UPDATE push_sends SET status = CASE WHEN sent > 0 THEN 'sent' ELSE 'failed' END, finished_ms = ? WHERE id = ? AND status = 'sending' AND parts_done >= parts`).bind(now, sendId));
  const r = await retry(() => db.batch(stmts));
  let removed = 0;
  for (let i = firstRemove; i < firstRemove + removes; i++) removed += r[i].meta.changes;
  if (removed) await retry(() => db.prepare('UPDATE push_sends SET removed = removed + ? WHERE id = ?').bind(removed, sendId).run());
  const finished = r[counter + 1].meta.changes === 1;

  if (again.length) {
    try {
      await enqueue(env, [{ send: sendId, part: 'r' + part.slice(1), ids: again, round: 1 }], RETRY_DELAY_S, doFetch);
    } catch {
      // no second round: they count as failed now
      await retry(() => db.batch([
        db.prepare(`UPDATE push_sends SET failed = failed + ?, parts_done = parts_done + 1 WHERE id = ?`).bind(again.length, sendId),
        db.prepare(`UPDATE push_sends SET status = CASE WHEN sent > 0 THEN 'sent' ELSE 'failed' END, finished_ms = ? WHERE id = ? AND status = 'sending' AND parts_done >= parts`).bind(now, sendId)
      ]));
    }
  }
  if (finished && send.audience === 'admin') await adminFinished(env, sendId, now);
  logLine({ kind: 'push', send: sendId, part, ok: out.ok.length, dead: out.dead.length, retry: again.length, failed: out.failed.length, error: out.error });
  return { ok: out.ok.length, dead: out.dead.length, retry: again.length, failed: out.failed.length, removed, finished };
}

/* ---------- admin pushes from the outbox ---------- */

/* the device label of the admin's panel when it is open and in sight now, else null (AdminNotify.gs adminPresentDevice_) */
export function presentDevice(s, now) {
  if (!s || !s.sid || s.parked_ms != null || s.hidden_ms != null || !(now - s.seen_ms < PRESENT_MS)) return null;
  return String(cleanLabel(s.device, 40) || '').toLowerCase();
}

/* the device whose panel is in sight gets the toast instead; one we can't tell apart counts as that one */
export function spared(label, looking) {
  if (looking === null) return false;
  let d = String(cleanLabel(label, 40) || '').toLowerCase();
  if (d === 'جهاز') d = '';
  return !d || !looking || looking === 'جهاز' || d === looking;
}

/* an outbox row's answer, as notify/claim.js handles Apps Script's */
async function outboxAnswer(db, id, ok, reason, now) {
  const row = await retry(() => db.prepare("SELECT id, kind, channel, attempts FROM notify_outbox WHERE id = ? AND channel = 'push'").bind(id).first());
  if (!row) return;
  const why = String(reason || '').slice(0, 200) || null;
  if (ok) await retry(() => db.prepare("UPDATE notify_outbox SET status = 'sent', sent_ms = ?, claim_id = NULL, error = ? WHERE id = ?").bind(now, why, id).run());
  else if (row.attempts >= MAX_ATTEMPTS) await retry(() => db.batch(deadStmts(db, row, why || 'push failed', now)));
  else await retry(() => db.prepare("UPDATE notify_outbox SET status = 'failed', next_ms = ?, claim_id = NULL, error = ? WHERE id = ?").bind(now + backoffMs(row.attempts), why || 'push failed', id).run());
}

async function adminFinished(env, sendId, now) {
  const s = await retry(() => env.DB.prepare('SELECT ref, status, error FROM push_sends WHERE id = ?').bind(sendId).first());
  if (!s || !/^ntf-/.test(s.ref)) return;
  await outboxAnswer(env.DB, s.ref, s.status === 'sent', s.status === 'sent' ? '' : s.error || 'error', now);
}

/* the minute cron (notify/tick.js): lease the due push rows and send them. → { leased, sent, done } | null */
export async function adminPushTick(env, now = Date.now(), doFetch) {
  const db = env.DB;
  const set = Object.fromEntries((await retry(() => db.prepare("SELECT key, value FROM settings WHERE key IN ('PUSH_SENDER', 'NOTIFY_ROUTER')").all())).results.map(r => [r.key, r.value]));
  if (set.PUSH_SENDER !== 'worker' || set.NOTIFY_ROUTER !== '1') return null;

  const stmts = [];
  // rows out of attempts with no answer: dead (claim.js step 2)
  const stale = (await retry(() => db.prepare("SELECT id, kind, channel FROM notify_outbox WHERE channel = 'push' AND status IN ('queued', 'failed') AND next_ms <= ? AND attempts >= ?").bind(now, MAX_ATTEMPTS).all())).results;
  for (const row of stale) stmts.push(...deadStmts(db, row, 'no answer after ' + MAX_ATTEMPTS + ' tries', now));
  const claim = randomId('clm-');
  stmts.push(db.prepare(`UPDATE notify_outbox SET claim_id = ?, next_ms = ?, attempts = attempts + 1
    WHERE id IN (SELECT id FROM notify_outbox WHERE channel = 'push' AND status IN ('queued', 'failed') AND next_ms <= ? AND attempts < ?
      ORDER BY CASE level WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, created_ms LIMIT ?)`).bind(claim, now + ADMIN_LEASE_MS, now, MAX_ATTEMPTS, ADMIN_CLAIM_MAX));
  await retry(() => db.batch(stmts));
  const rows = (await retry(() => db.prepare("SELECT id, recipient, kind, level, activity_ids FROM notify_outbox WHERE claim_id = ? ORDER BY CASE level WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, created_ms").bind(claim).all())).results;
  if (!rows.length) return { leased: 0 };

  const emails = [...new Set(rows.map(r => r.recipient))];
  const [active, devices, sessions, busy] = await retry(() => db.batch([
    db.prepare(`SELECT email FROM admins WHERE active = 1 AND email IN (${inList(emails)})`).bind(...emails),
    db.prepare(`SELECT id, email, device FROM push_devices WHERE audience = 'admin' AND email IN (${inList(emails)})`).bind(...emails),
    db.prepare(`SELECT email, sid, device, seen_ms, parked_ms, hidden_ms FROM admin_sessions WHERE email IN (${inList(emails)})`).bind(...emails),
    db.prepare(`SELECT ref FROM push_sends WHERE audience = 'admin' AND status = 'sending' AND started_ms > ? AND ref IN (${inList(rows.map(r => r.id))})`).bind(now - SENDING_STALE_MS, ...rows.map(r => r.id))
  ]));
  const admins = new Set(active.results.map(a => a.email));
  const inFlight = new Set(busy.results.map(b => b.ref));
  const session = new Map(sessions.results.map(s => [s.email, s]));
  const src = await sources(db, rows.flatMap(r => { try { return JSON.parse(r.activity_ids) || []; } catch { return []; } }));
  const keyed = !!serviceAccount(env);
  const out = { leased: rows.length, sent: 0, done: 0 };

  for (const row of rows) {
    // its send is still going (a slow round): its result answers the row
    if (inFlight.has(row.id)) continue;
    const m = messageFor(row, src);
    if (!m) {
      await retry(() => db.prepare("UPDATE notify_outbox SET status = 'dismissed', claim_id = NULL, error = 'activity gone' WHERE id = ?").bind(row.id).run());
      continue;
    }
    // nothing to send to is an answer too (NotifyClaim.gs notifyDeliver_)
    let reason = '';
    if (!keyed) reason = 'off';
    else if (!admins.has(row.recipient)) reason = 'not admin';
    const looking = row.level === 'critical' ? null : presentDevice(session.get(row.recipient), now);
    const mine = devices.results.filter(d => d.email === row.recipient);
    const targets = mine.filter(d => !spared(d.device, looking)).map(d => d.id);
    if (!reason && !targets.length) reason = mine.length ? 'present' : 'none';
    if (reason) {
      await outboxAnswer(db, row.id, true, reason, now);
      out.done++;
      continue;
    }
    const message = model({ kind: 'admin', id: row.id, title: m.title, body: m.body, url: m.url, tag: m.tag, group: 'admin' });
    await startSend(env, { audience: 'admin', ref: row.id, by: '', message, ttl: ADMIN_TTL, devices: targets, now, doFetch });
    out.sent++;
  }
  logLine({ kind: 'cron', job: 'push.admin', ...out });
  return out;
}

/* ---------- a send to the visitors (the screen and the schedule, Step 4c) ---------- */

const refuse = (message, hint, code = 'invalid') => new ApiError(code, 'push', { message, hint });

/*
 * One live bell item to every visitor's device, once (Push.gs pushSendItem_'s rules): a repeated sendKey gets its
 * first result, a second send of the item is refused, SEND_COOLDOWN_MS between sends and SENDS_PER_DAY a Cairo day.
 * The caller has checked the item is live. topic: only devices that kept it.
 */
export async function publicSend(env, { notifId, sendKey, by = '', message, ttl, topic = null, now = Date.now(), doFetch }) {
  const db = env.DB;
  if (!/^[\w-]{1,80}$/.test(String(notifId || '')) || !/^[\w-]{8,64}$/.test(String(sendKey || ''))) throw refuse('الطلب مش مفهوم.', 'اعمل Refresh للصفحة.');
  if (!serviceAccount(env)) throw refuse('إشعارات الموبايل لسه مش متظبطة.', 'FCM_SERVICE_ACCOUNT ناقص على الـWorker.', 'unavailable');
  const m = model({ ...message, kind: 'public', id: notifId });
  if (!m) throw refuse('العنوان فاضي.', '');
  const dayStart = Date.parse(cairoText(now).slice(0, 10) + 'T00:00:00Z') - (Date.parse(cairoText(now).replace(' ', 'T') + ':00Z') - Math.floor(now / 60000) * 60000);
  const [same, item, last, today] = await retry(() => db.batch([
    db.prepare('SELECT * FROM push_sends WHERE send_key = ?').bind(sendKey),
    db.prepare("SELECT status, started_ms FROM push_sends WHERE audience = 'public' AND ref = ? ORDER BY started_ms DESC").bind(notifId),
    db.prepare("SELECT MAX(started_ms) AS at FROM push_sends WHERE audience = 'public'"),
    db.prepare("SELECT COUNT(*) AS n FROM push_sends WHERE audience = 'public' AND started_ms >= ?").bind(dayStart)
  ]));
  if (same.results[0]) return { replay: true, send: same.results[0] };
  const done = item.results.find(x => x.status === 'sent');
  if (done) return { already: true, send: done };
  if (item.results.some(x => x.status === 'sending' && now - x.started_ms < SENDING_STALE_MS)) throw refuse('الإشعار ده بيتبعت دلوقتي.', 'استنى دقيقة وبص على السجل.', 'conflict');
  const lastAt = last.results[0].at || 0;
  if (now - lastAt < SEND_COOLDOWN_MS) throw refuse('استنى دقيقة بين كل إشعار والتاني.', 'باقي ' + Math.ceil((lastAt + SEND_COOLDOWN_MS - now) / 1000) + ' ثانية.', 'rate_limited');
  if (today.results[0].n >= SENDS_PER_DAY) throw refuse('وصلنا للحد: ' + SENDS_PER_DAY + ' إشعارات في اليوم.', 'الإشعارات الكتير بتخلي الناس تقفلها. كمّل بكرة.', 'rate_limited');
  const devices = (await retry(() => (topic
    ? db.prepare("SELECT id FROM push_devices WHERE audience = 'public' AND EXISTS (SELECT 1 FROM json_each(push_devices.topics) WHERE value = ?)").bind(topic)
    : db.prepare("SELECT id FROM push_devices WHERE audience = 'public'")).all())).results.map(d => d.id);
  if (!devices.length) throw refuse('مفيش مشتركين لسه.', 'أول ما حد يفعّل الإشعارات من الموقع هيظهر هنا.');
  return startSend(env, { audience: 'public', ref: notifId, sendKey, by, message: m, ttl, devices, now, doFetch });
}

/* housekeeping: a visitor's device not seen for STALE_MS goes (Push.gs pushCleanup_) */
export const staleDevicesStmt = (db, now) => db.prepare("DELETE FROM push_devices WHERE audience = 'public' AND last_ms < ?").bind(now - STALE_MS);

/* ---------- admin routes ---------- */

/* POST /v1/admin/push/check: is the key good? No device gets anything (Push.gs apiPushCheck) */
export async function adminPushCheck(ctx) {
  const r = await checkKey(ctx.env, ctx.fetch);
  const text = {
    missing: 'FCM_SERVICE_ACCOUNT ناقص أو مش صحيح على الـWorker.',
    auth: 'جوجل رفض مفتاح الإشعارات.',
    permission: 'حساب الخدمة مالوش صلاحية Firebase Cloud Messaging API Admin، أو الـ API مقفول.',
    http: 'FCM رد بـ HTTP ' + r.status + '. جرّب تاني بعد شوية.',
    network: 'مش قادرين نوصل لجوجل دلوقتي.'
  };
  return { check: r.ok, message: r.ok ? 'الإعداد سليم ✓ جوجل قبل المفتاح والصلاحية.' : text[r.code] };
}

/* POST /v1/admin/push/test: one message to MY admin devices only, once a minute */
export async function adminPushTest(ctx) {
  const db = ctx.env.DB;
  const me = ctx.actor.email;
  if (!serviceAccount(ctx.env)) throw refuse('إشعارات الموبايل لسه مش متظبطة.', 'FCM_SERVICE_ACCOUNT ناقص على الـWorker.', 'unavailable');
  const now = Date.now();
  const recent = await retry(() => db.prepare("SELECT 1 AS y FROM push_sends WHERE audience = 'admin' AND ref = ? AND started_ms > ?").bind('test:' + me, now - SEND_COOLDOWN_MS).first());
  if (recent) throw refuse('استنى دقيقة بين كل تجربة والتانية.', '', 'rate_limited');
  const devices = (await retry(() => db.prepare("SELECT id FROM push_devices WHERE audience = 'admin' AND email = ?").bind(me).all())).results.map(d => d.id);
  if (!devices.length) throw refuse('مفيش أجهزة مفعّل عليها الإشعارات.', 'فعّل الإشعارات من «أجهزتي» الأول.');
  const message = model({ kind: 'admin', id: 'test', title: 'تجربة إشعارات لوحة التحكم', body: 'لو الرسالة دي وصلت، الإشعارات شغالة على الجهاز ده.', url: '/admin/', tag: 'adm-test', group: 'admin' });
  const r = await startSend(ctx.env, { audience: 'admin', ref: 'test:' + me, by: me, message, ttl: 600, devices, now, doFetch: ctx.fetch });
  return { targets: r.targets, send: r.id };
}
