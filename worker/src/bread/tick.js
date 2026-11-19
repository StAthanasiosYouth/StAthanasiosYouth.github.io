/*
 * «خبزنا اليومي» — breadTick, one step of the EXISTING minute cron (scheduled.js). No cron of its own: the account
 * has 4 of its 5 (STUDY §3). The 10 ms budget: one D1 round trip (the switches, today's program, this minute's
 * devices by the bread_slots_minute index), then startSend (one push_sends row + queue messages of ≤ 45 devices).
 * Each device's own title is computed in the queue consumer (bread/notify.js), never here.
 *
 * Nothing goes unless BREAD_MODULE = '1', BREAD_PUSH = '1', PUSH_SENDER = 'worker' and the FCM key is set.
 * The send key is the program, the day and the minute: a cron that runs twice sends once.
 */

import { retry, cairoText } from '../lib/db.js';
import { logLine } from '../lib/log.js';
import { startSend } from '../push/send.js';
import { serviceAccount, model } from '../push/fcm.js';
import { dailyStmt } from './store.js';

export const TTL = 6 * 3600;
const MAX_DEVICES = 5000;
/*
 * W6 (owner 2026-11-19): on by default. A public device with the site's notifications on, that never chose times and
 * never turned «فكّرني» off (bread_optout), is reminded at the default time (settings bread_default_time, else 08:00).
 */
const DEFAULT_MINUTE_SQL = "(SELECT CAST(substr(v, 1, 2) AS INTEGER) * 60 + CAST(substr(v, 4, 2) AS INTEGER) FROM (SELECT COALESCE((SELECT value FROM settings WHERE key = 'bread_default_time' AND value GLOB '[0-2][0-9]:[0-5][0-9]'), '08:00') AS v))";

/* → { devices, send } | null */
export async function breadTick(env, now = Date.now(), doFetch) {
  const db = env.DB;
  const wall = cairoText(now);
  const day = wall.slice(0, 10);
  const minute = Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16));
  const [set, prog, slots] = await retry(() => db.batch([
    db.prepare("SELECT key, value FROM settings WHERE key IN ('BREAD_MODULE', 'BREAD_PUSH', 'PUSH_SENDER')"),
    db.prepare("SELECT id FROM bread_programs WHERE status IN ('scheduled', 'stopped') AND starts_on <= ? AND ends_on >= ? AND purged_ms IS NULL ORDER BY starts_on DESC LIMIT 1").bind(day, day),
    db.prepare(`SELECT DISTINCT device_id FROM bread_slots WHERE minute = ?
      UNION SELECT d.id FROM push_devices d WHERE d.audience = 'public' AND ? = ${DEFAULT_MINUTE_SQL}
        AND NOT EXISTS (SELECT 1 FROM bread_slots s WHERE s.device_id = d.id) AND NOT EXISTS (SELECT 1 FROM bread_optout o WHERE o.device_id = d.id)
      LIMIT ?`).bind(minute, minute, MAX_DEVICES)
  ]));
  const s = Object.fromEntries(set.results.map(r => [r.key, r.value]));
  if (s.BREAD_MODULE !== '1' || s.BREAD_PUSH !== '1' || s.PUSH_SENDER !== 'worker' || !serviceAccount(env)) return null;
  const p = prog.results[0];
  const devices = slots.results.map(r => r.device_id);
  if (!p || !devices.length) return null;
  // the stored text is only the fallback: the consumer writes each device's own (bread/notify.js)
  const message = model({ kind: 'public', id: 'bread-' + day, title: 'خبزنا اليومي', body: 'كلمة النهارده مستنياك.', url: '/daily-bread/?from=push', tag: 'bread-' + day.replace(/-/g, ''), group: 'bread' });
  const r = await startSend(env, {
    audience: 'public', ref: 'bread:' + p.id + ':' + day, sendKey: ('bread-' + p.id.slice(4) + '-' + day.replace(/-/g, '') + '-' + minute).slice(0, 64),
    message, ttl: TTL, devices, now, doFetch
  });
  if (!r.replay) await retry(() => dailyStmt(db, day, p.id, 'sent', devices.length).run());
  logLine({ kind: 'cron', job: 'bread.tick', devices: devices.length, replay: !!r.replay });
  return { devices: devices.length, send: r.id || null, replay: !!r.replay };
}
