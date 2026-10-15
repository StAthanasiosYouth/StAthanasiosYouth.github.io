/*
 * «New bookings» for the admin push (docs/EVENTS.md §7.3).
 *
 * The Worker has neither the admins' devices nor their presence: both live
 * in Apps Script (AdminNotify.gs, Presence.gs). So the Worker only COUNTS:
 * each visitor booking adds one to its event's `book_news` row, in the same
 * batch as the booking. Apps Script asks every few minutes (time trigger,
 * apps-script/BookNotify.gs) with the signed sync channel:
 *
 *   POST /v1/sync/book-news   (lib/sync.js signature, kind 'booknews')
 *   → { groups: [{ eventId, slug, title, count, pending, firstAt, lastAt }] }
 *
 * and turns each group into ONE Activity row + push («٣ حجوزات جديدة –
 * رحلة الإسكندرية», link /admin/#open/bookings/<eventId>): absent admins get
 * the push, admins with the panel open get the toast.
 *
 * Grouping: an event is handed out at most once per NEWS_COOLDOWN_MS; its
 * bookings in between wait and come together in the next group.
 * Claiming subtracts exactly what was read, so a booking that lands during
 * the claim is kept for the next one. At most once: a group handed out is
 * not handed out again (a lost reply loses that push, never doubles it).
 * Nothing personal leaves: no names, phones, refs or amounts.
 */

import { ApiError } from '../lib/http.js';
import { retry, cairoText } from '../lib/db.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { verifySync, syncStampStmt } from '../lib/sync.js';
import { activityStmt } from '../lib/activity.js';

export const NEWS_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_GROUPS = 20;

export async function claimNews(env, now = Date.now()) {
  const db = env.DB;
  const due = (await retry(() => db.prepare(`SELECT n.event_id, n.title, n.unsent, n.first_ms, n.last_ms, e.slug,
        (SELECT COUNT(*) FROM bookings b WHERE b.event_id = n.event_id AND b.status = 'pending') AS pending
      FROM book_news n LEFT JOIN event_cfg e ON e.id = n.event_id
      WHERE n.unsent > 0 AND (n.sent_ms IS NULL OR n.sent_ms <= ?) ORDER BY n.first_ms LIMIT ?`).bind(now - NEWS_COOLDOWN_MS, MAX_GROUPS).all())).results;
  if (!due.length) return [];
  const r = await retry(() => db.batch(due.map(n => db.prepare(`UPDATE book_news SET unsent = unsent - ?, sent_ms = ?,
        first_ms = CASE WHEN unsent - ? > 0 THEN last_ms ELSE NULL END
      WHERE event_id = ? AND unsent >= ? AND (sent_ms IS NULL OR sent_ms <= ?)`).bind(n.unsent, now, n.unsent, n.event_id, n.unsent, now - NEWS_COOLDOWN_MS))));
  return due.filter((n, i) => r[i].meta.changes === 1).map(n => ({
    eventId: n.event_id, slug: n.slug || '', title: n.title, count: n.unsent, pending: n.pending,
    firstAt: cairoText(n.first_ms), lastAt: cairoText(n.last_ms)
  }));
}

/* POST /v1/sync/book-news (signed by Apps Script) */
export async function syncBookNews(ctx) {
  await limit(ctx, 'sync.news', clientIp(ctx.request), 30, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { ts } = await verifySync(ctx.env, ctx.request, raw, 'booknews');
  const db = ctx.env.DB;
  await retry(() => db.batch([syncStampStmt(db, 'booknews', ts)]));
  const groups = await claimNews(ctx.env);
  if (groups.length) {
    await retry(() => activityStmt(db, { actor: 'apps-script', action: 'booknews.claim', entityType: 'bookings', summary: groups.map(g => g.eventId + ':' + g.count).join(' ').slice(0, 300) }).run());
  }
  return { groups };
}

/* STAGING ONLY: what is waiting, without claiming (the live check) */
export async function diagNews(ctx) {
  if (ctx.env.ENVIRONMENT !== 'staging') throw new ApiError('notfound');
  const id = String(ctx.url.searchParams.get('eventId') || '');
  const row = await retry(() => ctx.env.DB.prepare('SELECT event_id, unsent, first_ms, last_ms, sent_ms FROM book_news WHERE event_id = ?').bind(id).first());
  return { news: row || null };
}
