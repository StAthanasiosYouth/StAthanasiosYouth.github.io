/*
 * A bell item becomes a push by itself (owner, 2026-11-03): the notification made with the content — «اعمل إشعار في
 * الجرس لما تظهر» on an item, or one written in «الإشعارات» — goes to the visitors' devices once it is live on the
 * site, with no separate send. Right after a publish (content/publishing.js) and on the minute cron for a scheduled one.
 *
 * - Switch: settings.PUSH_AUTO_BELL = '1', while the Worker sends (PUSH_SENDER). PUSH_AUTO_BELL_SINCE (Cairo wall) is
 *   stamped when it is first seen on: an item published before it is never sent this way, so turning it on is no flood.
 * - Through publicSend: once per item (a send from «إشعارات الموبايل» or the schedule counts), its key, the minute
 *   between sends and the day's cap. A cooldown waits for the next minute; one item per run.
 * - The bell itself is untouched: what it shows and for how long stays the build's (Hub.gs).
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { logLine } from '../lib/log.js';
import { activityStmt } from '../lib/activity.js';
import { publicSend, senderOn } from './send.js';
import { liveContent, itemState, itemMessage, itemTtl } from './screen.js';
import { wallNow } from './schedule.js';

const inList = list => list.map(() => '?').join(',');

/* → { sent } | { waiting } | { capped } | null */
export async function autoBellTick(env, now = Date.now(), doFetch) {
  const db = env.DB;
  if (!(await senderOn(db))) return null;
  const set = Object.fromEntries((await retry(() => db.prepare("SELECT key, value FROM settings WHERE key IN ('PUSH_AUTO_BELL', 'PUSH_AUTO_BELL_SINCE')").all())).results.map(r => [r.key, r.value]));
  if (set.PUSH_AUTO_BELL !== '1') return null;
  const wall = wallNow(now);
  if (!set.PUSH_AUTO_BELL_SINCE) {
    await retry(() => db.prepare("INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES ('PUSH_AUTO_BELL_SINCE', ?, ?, 'worker')").bind(wall, now).run());
    return { since: wall };
  }
  const content = await liveContent(db);
  if (!content) return null;
  const since = set.PUSH_AUTO_BELL_SINCE;
  const due = content.notifications.filter(n => n && n.id && String(n.publishAt || '') >= since && itemState(content, n, wall) === 'live');
  if (!due.length) return null;
  const done = new Set((await retry(() => db.prepare(`SELECT ref FROM push_sends WHERE audience = 'public' AND ref IN (${inList(due.map(n => n.id))})`).bind(...due.map(n => n.id)).all())).results.map(r => r.ref));
  const item = due.sort((a, b) => (a.publishAt < b.publishAt ? -1 : 1)).find(n => !done.has(n.id));
  if (!item) return null;
  try {
    const r = await publicSend(env, { notifId: item.id, sendKey: ('bell-' + item.id).slice(0, 64), by: '', message: itemMessage(item, {}), ttl: itemTtl(item, now), now, doFetch });
    logLine({ kind: 'push', job: 'auto.bell', id: item.id, targets: r.targets || 0 });
    return { sent: item.id };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    const text = String((err.extra && err.extra.message) || err.message);
    if ((err.code === 'rate' && !/اليوم/.test(text)) || err.code === 'busy') return { waiting: item.id };
    // nobody subscribed, the day's cap, no key: once in the admins' log, then it counts as handled
    await retry(() => db.batch([
      db.prepare("INSERT INTO push_sends (id, send_key, audience, ref, status, started_ms, finished_ms, message, ttl, error) VALUES (?, ?, 'public', ?, 'failed', ?, ?, '{}', 0, ?) ON CONFLICT(send_key) DO NOTHING")
        .bind('ps-' + item.id.replace(/[^\w]/g, '').slice(-20) + now.toString(16).slice(-6), ('bell-' + item.id).slice(0, 64), item.id, now, now, text.slice(0, 200)),
      activityStmt(db, { at: now, actor: 'system', action: 'push', entityType: 'notifications', entityId: item.id, entityTitle: item.title, summary: 'إشعار الجرس ما اتبعتش push: ' + text, severity: 'important' })
    ]));
    return { capped: item.id, reason: err.code };
  }
}
