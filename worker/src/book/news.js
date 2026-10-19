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
// v2: a claim not acked within this is handed out again (the same claim)
export const CLAIM_TTL_MS = 12 * 60 * 1000;
const MAX_GROUPS = 20;
const CLAIM_RE = /^nc-[0-9a-f]{16}$/;

function claimIdOf() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return 'nc-' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

const pendingOf = `(SELECT COUNT(*) FROM bookings b WHERE b.event_id = n.event_id AND b.status = 'pending')`;

function group(n, count) {
  return {
    eventId: n.event_id, slug: n.slug || '', title: n.title, count, pending: n.pending,
    firstAt: cairoText(n.first_ms), lastAt: cairoText(n.last_ms)
  };
}

/*
 * v2 (at least once, B7): returns the claims Apps Script must announce, each
 * with a claimId it acks afterwards (ackNews). An unacked claim older than
 * CLAIM_TTL_MS is handed out again with the SAME id and count; Apps Script
 * skips the push for an id it already announced and just acks it.
 * New bookings landing while a claim is open wait for the next claim.
 */
export async function claimNewsV2(env, now = Date.now()) {
  const db = env.DB;
  const stale = (await retry(() => db.prepare(`SELECT n.event_id, n.title, n.first_ms, n.last_ms, n.claim_id, n.claim_count, e.slug, ${pendingOf} AS pending
      FROM book_news n LEFT JOIN event_cfg e ON e.id = n.event_id
      WHERE n.claim_id IS NOT NULL AND n.claim_ms <= ? ORDER BY n.claim_ms LIMIT ?`).bind(now - CLAIM_TTL_MS, MAX_GROUPS).all())).results;
  const fresh = (await retry(() => db.prepare(`SELECT n.event_id, n.title, n.unsent, n.first_ms, n.last_ms, e.slug, ${pendingOf} AS pending
      FROM book_news n LEFT JOIN event_cfg e ON e.id = n.event_id
      WHERE n.claim_id IS NULL AND n.unsent > 0 AND (n.sent_ms IS NULL OR n.sent_ms <= ?) ORDER BY n.first_ms LIMIT ?`).bind(now - NEWS_COOLDOWN_MS, MAX_GROUPS).all())).results;
  const fresh2 = fresh.map(n => ({ ...n, claim_id: claimIdOf(), claim_count: n.unsent }));
  const all = stale.concat(fresh2).slice(0, MAX_GROUPS);
  if (!all.length) return [];
  const r = await retry(() => db.batch(all.map(n => n.unsent === undefined
    ? db.prepare('UPDATE book_news SET claim_ms = ? WHERE event_id = ? AND claim_id = ?').bind(now, n.event_id, n.claim_id)
    : db.prepare(`UPDATE book_news SET claim_id = ?, claim_count = ?, claim_ms = ?
        WHERE event_id = ? AND claim_id IS NULL AND unsent >= ? AND (sent_ms IS NULL OR sent_ms <= ?)`).bind(n.claim_id, n.claim_count, now, n.event_id, n.claim_count, now - NEWS_COOLDOWN_MS))));
  return all.filter((n, i) => r[i].meta.changes === 1).map(n => ({ ...group(n, n.claim_count), claimId: n.claim_id }));
}

/* v2: these claims were announced → their counts are done, the cooldown starts */
export async function ackNews(env, ids, now = Date.now()) {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter(id => CLAIM_RE.test(id)).slice(0, MAX_GROUPS);
  if (!list.length) return 0;
  const db = env.DB;
  const r = await retry(() => db.batch(list.map(id => db.prepare(`UPDATE book_news SET unsent = unsent - claim_count, sent_ms = ?,
      first_ms = CASE WHEN unsent - claim_count > 0 THEN last_ms ELSE NULL END,
      claim_id = NULL, claim_count = NULL, claim_ms = NULL
    WHERE claim_id = ?`).bind(now, id))));
  return r.reduce((n, x) => n + (x.meta.changes || 0), 0);
}

/* v1 (at most once): what the deployed Apps Script before Phase 1 asks for */
export async function claimNews(env, now = Date.now()) {
  const db = env.DB;
  const due = (await retry(() => db.prepare(`SELECT n.event_id, n.title, n.unsent, n.first_ms, n.last_ms, e.slug,
        (SELECT COUNT(*) FROM bookings b WHERE b.event_id = n.event_id AND b.status = 'pending') AS pending
      FROM book_news n LEFT JOIN event_cfg e ON e.id = n.event_id
      WHERE n.unsent > 0 AND (n.sent_ms IS NULL OR n.sent_ms <= ?) ORDER BY n.first_ms LIMIT ?`).bind(now - NEWS_COOLDOWN_MS, MAX_GROUPS).all())).results;
  if (!due.length) return [];
  const r = await retry(() => db.batch(due.map(n => db.prepare(`UPDATE book_news SET unsent = unsent - ?, sent_ms = ?,
        first_ms = CASE WHEN unsent - ? > 0 THEN last_ms ELSE NULL END
      WHERE event_id = ? AND claim_id IS NULL AND unsent >= ? AND (sent_ms IS NULL OR sent_ms <= ?)`).bind(n.unsent, now, n.unsent, n.event_id, n.unsent, now - NEWS_COOLDOWN_MS))));
  return due.filter((n, i) => r[i].meta.changes === 1).map(n => group(n, n.unsent));
}

/*
 * POST /v1/sync/book-news (signed by Apps Script)
 *   {}                      v1: at most once (the claim is final)
 *   { v: 2 }                v2: groups carry claimId; Apps Script acks them
 *   { v: 2, ack: [ids] }    v2: acks the claims it announced (and claims nothing)
 */
export async function syncBookNews(ctx) {
  await limit(ctx, 'sync.news', clientIp(ctx.request), 30, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { body, ts } = await verifySync(ctx.env, ctx.request, raw, 'booknews');
  const db = ctx.env.DB;
  await retry(() => db.batch([syncStampStmt(db, 'booknews', ts)]));
  const v2 = body && body.v === 2;
  if (v2 && Array.isArray(body.ack)) {
    const acked = await ackNews(ctx.env, body.ack);
    if (acked) await retry(() => activityStmt(db, { actor: 'apps-script', action: 'booknews.ack', entityType: 'bookings', summary: body.ack.join(' ').slice(0, 300), changes: { acked } }).run());
    return { acked };
  }
  const groups = v2 ? await claimNewsV2(ctx.env) : await claimNews(ctx.env);
  if (groups.length) {
    await retry(() => activityStmt(db, { actor: 'apps-script', action: 'booknews.claim', entityType: 'bookings', summary: groups.map(g => g.eventId + ':' + g.count + (g.claimId ? ':' + g.claimId : '')).join(' ').slice(0, 300) }).run());
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
