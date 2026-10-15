/*
 * Fixed-window rate limits in D1: exact across all edge locations (one
 * writer), one small upsert per checked request. Keys are salted hashes.
 */

import { ApiError } from './http.js';
import { pseudonym } from './hash.js';

export async function hit(db, key, limit, windowS, nowMs = Date.now()) {
  const window = Math.floor(nowMs / 1000 / windowS) * windowS;
  const row = await db.prepare(
    'INSERT INTO rate_limits (key, window, count) VALUES (?, ?, 1) ON CONFLICT(key, window) DO UPDATE SET count = count + 1 RETURNING count'
  ).bind(key, window).first();
  const count = row ? row.count : 1;
  return { ok: count <= limit, count, retryAfter: window + windowS - Math.floor(nowMs / 1000) };
}

/* Throws ApiError('rate') when over. `who` is an IP or an email; it is hashed. */
export async function limit(ctx, bucket, who, max, windowS) {
  const key = bucket + ':' + await pseudonym(ctx.env, who || 'unknown');
  const r = await hit(ctx.env.DB, key, max, windowS);
  if (!r.ok) throw new ApiError('rate', bucket, { retryAfter: r.retryAfter });
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || '';
}
