/*
 * Idempotency-Key handling for POST routes.
 *
 *   same scope + key + body  → the stored answer (header idempotency-replayed: 1)
 *   same scope + key, other body → 409 conflict
 *   a twin still running     → 409 busy (client retries shortly)
 *   a twin that died (> 60 s pending) → taken over
 *
 * This guarantees the same RESPONSE. Domain tables still carry their own
 * UNIQUE keys, so a crash between the domain write and `finish` can never
 * double-apply anything (defence in depth).
 */

import { ApiError } from './http.js';
import { sha256 } from './hash.js';

const KEY_RE = /^[A-Za-z0-9_.:-]{8,100}$/;
const STALE_MS = 60_000;

export function idempotencyKey(request, required = true) {
  const key = request.headers.get('idempotency-key');
  if (!key) {
    if (required) throw new ApiError('bad', 'idempotency-key required');
    return null;
  }
  if (!KEY_RE.test(key)) throw new ApiError('bad', 'idempotency-key shape');
  return key;
}

/* Returns { replay: {status, body} } or { claim } to pass to finish/abandon. */
export async function begin(db, scope, key, body, now = Date.now(), depth = 0) {
  const reqHash = await sha256(JSON.stringify(body || {}));
  const ins = await db.prepare(
    "INSERT INTO idempotency (scope, key, req_hash, status, created_at) VALUES (?, ?, ?, 'pending', ?) ON CONFLICT(scope, key) DO NOTHING"
  ).bind(scope, key, reqHash, now).run();
  if (ins.meta.changes === 1) return { claim: { scope, key } };

  const row = await db.prepare('SELECT req_hash, status, http_status, response, created_at FROM idempotency WHERE scope = ? AND key = ?').bind(scope, key).first();
  if (!row) {                                   // vanished (abandoned meanwhile): try once more
    if (depth > 1) throw new ApiError('busy');
    return begin(db, scope, key, body, now, depth + 1);
  }
  if (row.req_hash !== reqHash) throw new ApiError('conflict');
  if (row.status === 'done') return { replay: { status: row.http_status, body: JSON.parse(row.response) } };
  if (now - row.created_at > STALE_MS) {
    const take = await db.prepare("UPDATE idempotency SET created_at = ? WHERE scope = ? AND key = ? AND status = 'pending' AND created_at = ?")
      .bind(now, scope, key, row.created_at).run();
    if (take.meta.changes === 1) return { claim: { scope, key } };
  }
  throw new ApiError('busy');
}

export function finishStmt(db, claim, status, body) {
  return db.prepare("UPDATE idempotency SET status = 'done', http_status = ?, response = ? WHERE scope = ? AND key = ?")
    .bind(status, JSON.stringify(body), claim.scope, claim.key);
}

/* A failed attempt releases the key so the client's retry runs again. */
export function abandon(db, claim) {
  return db.prepare("DELETE FROM idempotency WHERE scope = ? AND key = ? AND status = 'pending'").bind(claim.scope, claim.key).run();
}
