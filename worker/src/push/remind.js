/*
 * «فكّرني لما تبدأ» (site wave 5, S4; owner 2026-11-14): a push to ONE device when ONE competition starts.
 *
 *   POST /v1/push/remind { token, slug, on } → { ok, on, at } | { ok: false, code }
 *     on: true asks, false cancels. The device must already be a public push device (/v1/push/subscribe first:
 *     the page turns notifications on in the same tap). The start comes from the live content, never the page.
 *     codes: invalid · no_device (subscribe first) · not_found (no such published competition) · started (too late)
 *
 * remindTick (the minute cron, only while PUSH_SENDER = 'worker'): what is due goes to its devices through startSend
 * (one send per competition and minute; each row is marked done right after, so nothing goes twice). Before sending:
 *   - the start is read again from the live content: moved later → waits; gone → dropped;
 *   - the competition's own push to everyone (a bell item aimed at it, sent by autobell or «إشعارات الموبايل»
 *     from an hour before the start) already reached these devices → the reminder is marked done, not sent twice;
 *   - more than OVERDUE_MS late (the sender was off) → dropped.
 * The broadcast itself is untouched: a bell item that goes out AFTER the reminder still reaches everyone.
 */

import { retry } from '../lib/db.js';
import { logLine } from '../lib/log.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { pushHash } from './devices.js';
import { startSend, senderOn } from './send.js';
import { serviceAccount, model } from './fcm.js';
import { liveContent } from './screen.js';
import { wallMs, OVERDUE_MS } from './schedule.js';

const TOKEN = /^(?:[\w:-]{100,400}|[\w-]{22})$/;
const SLUG = /^[a-z0-9-]{2,40}$/;
const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const COVER_MS = 3600000;     // a broadcast for the competition from an hour before its start covers the reminder
export const PER_DEVICE = 20;        // reminders one device may hold
const BATCH = 500;
const TTL = 2 * 3600;

const compOf = (content, slug) => ((content && Array.isArray(content.competitions)) ? content.competitions : []).find(c => c && c.slug === slug) || null;
const startOf = comp => (comp && WALL.test(String(comp.startAt || '')) ? wallMs(comp.startAt) : null);

export async function pushRemind(ctx) {
  const body = ctx.body || {};
  const token = typeof body.token === 'string' && TOKEN.test(body.token) ? body.token : '';
  const slug = typeof body.slug === 'string' && SLUG.test(body.slug) ? body.slug : '';
  if (!token || !slug || typeof body.on !== 'boolean') return { ok: false, code: 'invalid' };
  await limit(ctx, 'push.remind', clientIp(ctx.request), 30, 60);
  const db = ctx.env.DB;
  const id = await pushHash(token);
  if (!body.on) {
    await retry(() => db.prepare('DELETE FROM push_reminders WHERE device_id = ? AND slug = ?').bind(id, slug).run());
    return { ok: true, on: false };
  }
  const now = Date.now();
  const [device, held] = await retry(() => db.batch([
    db.prepare("SELECT id FROM push_devices WHERE id = ? AND audience = 'public'").bind(id),
    db.prepare('SELECT COUNT(*) AS n FROM push_reminders WHERE device_id = ? AND sent_ms IS NULL AND slug <> ?').bind(id, slug)
  ]));
  if (!device.results[0]) return { ok: false, code: 'no_device' };
  const at = startOf(compOf(await liveContent(db), slug));
  if (at === null) return { ok: false, code: 'not_found' };
  if (at <= now) return { ok: false, code: 'started' };
  if (held.results[0].n >= PER_DEVICE) return { ok: false, code: 'invalid' };
  await retry(() => db.prepare(`INSERT INTO push_reminders (device_id, slug, at_ms, created_ms) VALUES (?, ?, ?, ?)
    ON CONFLICT(device_id, slug) DO UPDATE SET at_ms = excluded.at_ms, sent_ms = NULL`).bind(id, slug, at, now).run());
  return { ok: true, on: true, at };
}

/* the minute cron → { sent, covered, dropped } | null */
export async function remindTick(env, now = Date.now(), doFetch) {
  const db = env.DB;
  if (!(await senderOn(db)) || !serviceAccount(env)) return null;
  const due = (await retry(() => db.prepare('SELECT device_id, slug, at_ms FROM push_reminders WHERE sent_ms IS NULL AND at_ms <= ? ORDER BY at_ms LIMIT ?').bind(now, BATCH).all())).results;
  if (!due.length) return null;
  const content = await liveContent(db);
  const out = { sent: 0, covered: 0, dropped: 0 };
  for (const slug of [...new Set(due.map(r => r.slug))]) {
    const rows = due.filter(r => r.slug === slug);
    const comp = compOf(content, slug);
    const at = startOf(comp);
    if (at === null || now - at > OVERDUE_MS) {
      await retry(() => db.prepare('DELETE FROM push_reminders WHERE slug = ? AND sent_ms IS NULL AND at_ms <= ?').bind(slug, now).run());
      out.dropped += rows.length;
      continue;
    }
    if (at > now) {
      // the start moved later: wait for it
      await retry(() => db.prepare('UPDATE push_reminders SET at_ms = ? WHERE slug = ? AND sent_ms IS NULL').bind(at, slug).run());
      continue;
    }
    const items = (content.notifications || []).filter(n => n && n.id && n.target && n.target.kind === 'competition' && n.target.slug === slug).map(n => n.id);
    const broadcast = items.length ? await retry(() => db.prepare(`SELECT 1 FROM push_sends WHERE audience = 'public' AND ref IN (${items.map(() => '?').join(',')})
      AND status <> 'failed' AND started_ms >= ? LIMIT 1`).bind(...items, at - COVER_MS).first()) : null;
    const devices = rows.map(r => r.device_id);
    const mark = () => retry(() => db.prepare(`UPDATE push_reminders SET sent_ms = ? WHERE slug = ? AND sent_ms IS NULL AND device_id IN (${devices.map(() => '?').join(',')})`).bind(now, slug, ...devices).run());
    if (broadcast) {
      await mark();
      out.covered += rows.length;
      continue;
    }
    const message = model({
      kind: 'public', id: 'remind-' + slug, title: '🏆 المسابقة بدأت: ' + String(comp.title || '').slice(0, 60),
      body: 'دلوقتي تقدر تدخل وتجاوب.', url: '/competition/' + slug + '/', tag: 'comp-' + slug, group: 'competitions'
    });
    await startSend(env, { audience: 'public', ref: 'remind:' + slug, sendKey: ('remind-' + slug + '-' + Math.floor(now / 60000)).slice(0, 64), message, ttl: TTL, devices, now, doFetch });
    await mark();
    out.sent += rows.length;
  }
  logLine({ kind: 'cron', job: 'push.remind', ...out });
  return out;
}

/* housekeeping (the daily cron): reminders done or past more than a week */
export const oldRemindersStmt = (db, now) => db.prepare('DELETE FROM push_reminders WHERE at_ms < ?').bind(now - 7 * 86400000);
