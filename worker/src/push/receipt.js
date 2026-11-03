/*
 * A push's delivery receipt (Phase 6, the admin closed-app push): FCM's 200 only says Google took the message. The
 * admin app's service worker (admin/sw.js) says what happened on the device itself:
 *
 *   POST /v1/push/receipt { id, shown, error?, open? }   (no credential: a service worker has none)
 *
 *   id     the outbox row the push carried (data.id, 'ntf-…'), or 'test'
 *   shown  showNotification resolved (true) or threw (false, with its error's name and message)
 *   open   an admin window was open when it came (the app was not closed)
 *
 * - Taken only for a push the Worker actually sent (a push_sends row with that ref), once (the activity row's id is
 *   the ref's), so nobody can fill the log. Rate-limited per IP. Nothing about the device or a token is kept.
 * - Kept as a technical activity row (hidden from «سجل النشاط»): read with the D1 console when a push goes missing.
 */

import { retry } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { limit, clientIp } from '../lib/ratelimit.js';

const REF = /^(ntf-[0-9a-f]{6,}|test:[^\s]{3,120})$/;

export async function pushReceipt(ctx) {
  const body = ctx.body || {};
  const id = String(body.id || '');
  if (!REF.test(id)) return { taken: false };
  await limit(ctx, 'push.receipt', clientIp(ctx.request), 30, 60);
  const db = ctx.env.DB;
  const send = await retry(() => db.prepare("SELECT id FROM push_sends WHERE audience = 'admin' AND ref = ? ORDER BY started_ms DESC LIMIT 1").bind(id).first());
  if (!send) return { taken: false };
  const shown = body.shown === true;
  const error = String(body.error == null ? '' : body.error).replace(/[\u0000-\u001f]/g, ' ').slice(0, 160);
  const r = await retry(() => activityStmt(db, {
    id: 'act-rc' + send.id.slice(3, 15), orIgnore: true, actor: 'system', action: 'push.receipt', entityType: 'push', entityId: id,
    summary: (shown ? 'shown' : 'not shown: ' + error) + (body.open === true ? ' (admin open)' : ' (app closed)'), source: 'system'
  }).run());
  return { taken: r.meta.changes === 1 };
}
