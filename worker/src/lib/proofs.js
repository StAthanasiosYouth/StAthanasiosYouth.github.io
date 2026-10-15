/*
 * Private proofs (payment screenshots, booking attachments) in R2.
 *
 * - The bucket is private (no r2.dev URL, no custom domain, no presigned
 *   URLs). Bytes leave it only through readProof(), behind admin auth.
 * - D1 `proofs` holds the reference (r2_key), hash, size and retention date;
 *   never the bytes.
 * - Write order: R2 first, then the D1 row; if the row fails the object is
 *   deleted again. A crash between the two leaves an object with no row:
 *   the daily sweep removes such orphans after ORPHAN_AGE_MS.
 * - Delete: R2 object first, then the row is marked (kept for accounting).
 */

import { ApiError } from './http.js';
import { sha256Bytes, base32Id } from './hash.js';
import { cairoText, retry } from './db.js';
import { sniffImage, PROOF_MAX_BYTES, PROOF_MAX_SIDE } from './image.js';

export const PROOF_PREFIX = 'proofs/';
export const RETENTION_DEFAULT_MS = 60 * 24 * 3600 * 1000;   // EVENTS.md §10: 60 days (after the event's end, for bookings)
export const ORPHAN_AGE_MS = 24 * 3600 * 1000;
const SWEEP_MAX = 100;

export function bucket(env) {
  if (!env.PROOFS) throw new ApiError('disabled', 'PROOFS not bound');
  return env.PROOFS;
}

/*
 * `extra(row)` → more statements committed in the SAME D1 batch as the
 * proof row (audit row, idempotency answer, the booking's proof list…).
 */
export async function putProof(env, { bytes, purpose, bookingId = null, paymentId = null, by, deleteAfterMs, now = Date.now(), extra = null }) {
  const b = new Uint8Array(bytes);
  if (!b.length || b.length > PROOF_MAX_BYTES) throw new ApiError(b.length ? 'toolarge' : 'bad', 'proof size');
  const image = sniffImage(b);
  if (!image) throw new ApiError('bad', 'proof type');
  if (image.width > PROOF_MAX_SIDE || image.height > PROOF_MAX_SIDE || !image.width || !image.height) throw new ApiError('bad', 'proof dimensions');

  const hash = await sha256Bytes(b);
  // the same image already attached elsewhere (EVENTS.md §6 dupProof): reported, still accepted
  const dup = await retry(() => env.DB.prepare('SELECT id FROM proofs WHERE sha256 = ? AND deleted_at IS NULL LIMIT 5').bind(hash).all());
  const duplicates = dup.results.map(r => r.id);

  const id = base32Id('prf-', 8);
  const d = new Date(now);
  const key = `${PROOF_PREFIX}${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
  await bucket(env).put(key, b, {
    httpMetadata: { contentType: image.mime },
    customMetadata: { proof: id, purpose },
    sha256: hash
  });

  const row = {
    id, purpose, booking_id: bookingId, payment_id: paymentId, r2_key: key, mime: image.mime, bytes: b.length, sha256: hash,
    width: image.width, height: image.height, by, at: cairoText(now), at_ms: now, delete_after_ms: deleteAfterMs || now + RETENTION_DEFAULT_MS
  };
  try {
    const insert = env.DB.prepare(
      'INSERT INTO proofs (id, purpose, booking_id, payment_id, r2_key, mime, bytes, sha256, width, height, by, at, at_ms, delete_after_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(row.id, row.purpose, row.booking_id, row.payment_id, row.r2_key, row.mime, row.bytes, row.sha256, row.width, row.height, row.by, row.at, row.at_ms, row.delete_after_ms);
    const more = extra ? extra({ proof: publicMeta(row), duplicates }) : [];
    await retry(() => env.DB.batch([insert, ...more]));
  } catch (err) {
    // a retry after a lost reply may find its own row: then it did commit
    const mine = await env.DB.prepare('SELECT id FROM proofs WHERE id = ?').bind(id).first().catch(() => null);
    if (!mine) {
      await bucket(env).delete(key).catch(() => {});
      throw err;
    }
  }

  return { proof: publicMeta(row), duplicates };
}

export function publicMeta(row) {
  return {
    id: row.id, purpose: row.purpose, bookingId: row.booking_id || null, paymentId: row.payment_id || null,
    mime: row.mime, bytes: row.bytes, sha256: row.sha256, width: row.width, height: row.height,
    by: row.by, at: row.at, deleteAfterMs: row.delete_after_ms, deletedAt: row.deleted_at || null
  };
}

export async function proofRow(env, id) {
  if (!/^prf-[a-z2-7]{8}$/.test(String(id || ''))) throw new ApiError('notfound');
  const row = await retry(() => env.DB.prepare('SELECT * FROM proofs WHERE id = ?').bind(id).first());
  if (!row) throw new ApiError('notfound');
  return row;
}

/* The bytes (an R2 object body) for an admin, or notfound when deleted. */
export async function readProof(env, id) {
  const row = await proofRow(env, id);
  if (row.deleted_at) throw new ApiError('notfound', 'deleted');
  const obj = await bucket(env).get(row.r2_key);
  if (!obj) throw new ApiError('notfound', 'object missing');
  return { row, obj };
}

/* Deletes the file; the row stays with deleted_at. Idempotent. */
export async function deleteProof(env, id, by, now = Date.now()) {
  const row = await proofRow(env, id);
  if (row.deleted_at) return { deleted: false, proof: publicMeta(row) };
  await bucket(env).delete(row.r2_key);
  await retry(() => env.DB.prepare('UPDATE proofs SET deleted_at = ?, deleted_by = ?, deleted_ms = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(cairoText(now), by, now, id).run());
  return { deleted: true, proof: publicMeta({ ...row, deleted_at: cairoText(now) }) };
}

/*
 * Retention + orphans (daily cron, and the admin "run housekeeping" check).
 * Expired rows: delete their objects (one batched R2 delete), mark the rows.
 * Orphans: objects under proofs/ older than orphanAgeMs that no row names.
 */
export async function sweepProofs(env, { now = Date.now(), orphanAgeMs = ORPHAN_AGE_MS } = {}) {
  if (!env.PROOFS) return { expired: 0, orphans: 0, skipped: 'not bound' };
  const due = await env.DB.prepare('SELECT id, r2_key FROM proofs WHERE deleted_at IS NULL AND delete_after_ms < ? ORDER BY delete_after_ms LIMIT ?').bind(now, SWEEP_MAX).all();
  if (due.results.length) {
    await env.PROOFS.delete(due.results.map(r => r.r2_key));
    await env.DB.batch(due.results.map(r => env.DB.prepare("UPDATE proofs SET deleted_at = ?, deleted_by = 'retention', deleted_ms = ? WHERE id = ? AND deleted_at IS NULL").bind(cairoText(now), now, r.id)));
  }

  const listed = await env.PROOFS.list({ prefix: PROOF_PREFIX, limit: 1000 });
  const old = listed.objects.filter(o => now - new Date(o.uploaded).getTime() > orphanAgeMs);
  let orphans = [];
  if (old.length) {
    const known = new Set();
    for (let i = 0; i < old.length; i += 90) {
      const keys = old.slice(i, i + 90).map(o => o.key);
      const r = await env.DB.prepare(`SELECT r2_key FROM proofs WHERE r2_key IN (${keys.map(() => '?').join(',')}) AND deleted_at IS NULL`).bind(...keys).all();
      r.results.forEach(x => known.add(x.r2_key));
    }
    orphans = old.map(o => o.key).filter(k => !known.has(k));
    if (orphans.length) await env.PROOFS.delete(orphans.slice(0, 1000));
  }
  return { expired: due.results.length, orphans: orphans.length };
}
