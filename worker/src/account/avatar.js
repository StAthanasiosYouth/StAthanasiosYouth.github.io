/*
 * The member's optional photo. The bucket is private: bytes leave it only through these routes,
 * to the member's own session or to an admin holding participants.view (routes.js, lib/perms.js).
 * The page resizes to a small square before upload (assets/js/account/photo.js); the server trusts
 * none of that and decides the type from the first bytes, so an SVG or HTML file is refused.
 * Write order as in lib/proofs.js: R2, then the row; a crash between them leaves an object the daily
 * sweep removes. The old object goes after the row moved.
 */

import { ApiError, corsHeaders } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { base32Id, randomId } from '../lib/hash.js';
import { activityStmt } from '../lib/activity.js';
import { limit } from '../lib/ratelimit.js';
import { sniffImage } from '../lib/image.js';
import { bucket } from '../lib/proofs.js';
import { requireAccount } from './session.js';
import { gate } from './routes.js';

export const AVATAR_MAX_BYTES = 64 * 1024;
export const AVATAR_PREFIX = 'avatars/';
const MIN_SIDE = 64;
const MAX_SIDE = 512;
const ORPHAN_AGE_MS = 24 * 3600 * 1000;

const auditStmt = (db, id, at, actor, action, reason = null) =>
  db.prepare('INSERT INTO participant_audit (id, participant_id, at, actor, action, reason) VALUES (?, ?, ?, ?, ?, ?)').bind(randomId('pa-', 8), id, at, actor, action, reason);

const clearStmt = (db, id, version, now) =>
  db.prepare('UPDATE participants SET avatar_key = NULL, avatar_version = ?, updated_at = ? WHERE id = ?').bind(version, now, id);

/* the same headers everywhere: a fixed type, never rendered as a document, never cached for another reader */
function imageResponse(ctx, body, { mime, etag, shared, status = 200 }) {
  return new Response(status === 304 ? null : body, {
    status,
    headers: {
      ...corsHeaders(ctx.request, ctx.env),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-site',
      'content-type': mime,
      'content-disposition': 'inline; filename="avatar"',
      'cache-control': shared ? 'private, no-store' : 'private, no-cache',
      vary: 'Authorization, Origin',
      etag,
      'x-request-id': ctx.rid
    }
  });
}

/* POST /v1/account/avatar (raw image) → { avatar: version }. Replaces the old one. */
export async function accountAvatarSave(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  await limit(ctx, 'acct.avatar', account.id, 20, 3600);
  const bytes = new Uint8Array(ctx.raw);
  if (!bytes.length) throw new ApiError('bad', 'avatar size');
  if (bytes.length > AVATAR_MAX_BYTES) throw new ApiError('toolarge', 'avatar size');
  const image = sniffImage(bytes);
  if (!image) throw new ApiError('bad', 'avatar type');
  if (image.width !== image.height || image.width < MIN_SIDE || image.width > MAX_SIDE) throw new ApiError('bad', 'avatar dimensions');

  const db = ctx.env.DB;
  const now = Date.now();
  const key = AVATAR_PREFIX + base32Id('', 16);
  const version = account.avatar_version + 1;
  await bucket(ctx.env).put(key, bytes, { httpMetadata: { contentType: image.mime }, customMetadata: { participant: account.id } });
  try {
    await retry(() => db.batch([
      db.prepare('UPDATE participants SET avatar_key = ?, avatar_version = ?, updated_at = ? WHERE id = ?').bind(key, version, now, account.id),
      auditStmt(db, account.id, now, 'self', 'avatar.set')
    ]));
  } catch (err) {
    await bucket(ctx.env).delete(key).catch(() => {});
    throw err;
  }
  if (account.avatar_key) ctx.defer(bucket(ctx.env).delete(account.avatar_key).catch(() => {}));
  return { avatar: version };
}

/* GET /v1/account/avatar → the bytes; a shared-device session leaves nothing in the browser's cache */
export async function accountAvatarRead(ctx) {
  const settings = await gate(ctx);
  const { session, account } = await requireAccount(ctx, settings);
  await limit(ctx, 'acct.avatar.read', account.id, 120, 60);
  return { __response: await send(ctx, account, session.kind === 'shared') };
}

async function send(ctx, person, shared) {
  if (!person.avatar_key) throw new ApiError('not_found', 'avatar');
  const etag = `"av${person.avatar_version}"`;
  if (!shared && ctx.request.headers.get('if-none-match') === etag) return imageResponse(ctx, null, { mime: 'image/webp', etag, shared, status: 304 });
  const obj = await bucket(ctx.env).get(person.avatar_key);
  if (!obj) throw new ApiError('not_found', 'avatar object');
  return imageResponse(ctx, obj.body, { mime: obj.httpMetadata && obj.httpMetadata.contentType === 'image/jpeg' ? 'image/jpeg' : 'image/webp', etag, shared });
}

/* POST /v1/account/avatar/delete → { avatar: null }. Quiet when there is none. */
export async function accountAvatarDelete(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  await limit(ctx, 'acct.avatar', account.id, 20, 3600);
  if (!account.avatar_key) return { avatar: null };
  const db = ctx.env.DB;
  const now = Date.now();
  await retry(() => db.batch([clearStmt(db, account.id, account.avatar_version + 1, now), auditStmt(db, account.id, now, 'self', 'avatar.delete')]));
  ctx.defer(bucket(ctx.env).delete(account.avatar_key).catch(() => {}));
  return { avatar: null };
}

/* GET /v1/admin/participants/:id/avatar (participants.view) */
export async function adminAvatarRead(ctx) {
  await limit(ctx, 'participants.avatar', ctx.actor.email, 300, 60);
  const person = await retry(() => ctx.env.DB.prepare("SELECT avatar_key, avatar_version FROM participants WHERE id = ? AND status <> 'deleted'").bind(String(ctx.params.id)).first());
  if (!person) throw new ApiError('not_found', 'participant');
  return { __response: await send(ctx, person, true) };
}

/* the admin's removal (participants.edit): file gone, reason in the account's history, a row in the activity; never its bytes */
export async function removeAvatarByAdmin(ctx, person, reason) {
  if (!person.avatar_key) return;
  const db = ctx.env.DB;
  const now = Date.now();
  await retry(() => db.batch([
    clearStmt(db, person.id, person.avatar_version + 1, now),
    auditStmt(db, person.id, now, ctx.actor.email, 'avatar.remove', reason),
    activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'participant.avatar', entityType: 'participant', entityId: person.id, summary: 'مسح صورة مشترك', severity: 'important' })
  ]));
  await bucket(ctx.env).delete(person.avatar_key).catch(() => {});
}

/* daily: objects no live account names (a crash between the two writes, a lost delete) */
export async function sweepAvatars(env, { now = Date.now() } = {}) {
  if (!env.PROOFS) return { orphans: 0 };
  const listed = await env.PROOFS.list({ prefix: AVATAR_PREFIX, limit: 1000 });
  const old = listed.objects.filter(o => now - new Date(o.uploaded).getTime() > ORPHAN_AGE_MS);
  if (!old.length) return { orphans: 0 };
  const known = new Set();
  for (let i = 0; i < old.length; i += 90) {
    const keys = old.slice(i, i + 90).map(o => o.key);
    const r = await env.DB.prepare(`SELECT avatar_key FROM participants WHERE avatar_key IN (${keys.map(() => '?').join(',')}) AND status <> 'deleted'`).bind(...keys).all();
    r.results.forEach(x => known.add(x.avatar_key));
  }
  const orphans = old.map(o => o.key).filter(k => !known.has(k));
  if (orphans.length) await env.PROOFS.delete(orphans);
  return { orphans: orphans.length };
}
