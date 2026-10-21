/*
 * Apps Script → Worker sync (server to server), e.g. the admin allowlist.
 *
 *   x-sync-ts:        epoch ms when Apps Script signed it
 *   x-sync-signature: v1=<hex HMAC-SHA256(SYNC_SECRET, ts + "." + raw body)>
 *
 * Accepted only within ±5 minutes, with a constant-time compare, and only
 * when newer than the last accepted sync of the same kind (no replays).
 * Apps Script holds the same secret in its Script Properties
 * (WORKER_SYNC_SECRET; apps-script/WorkerSync.gs).
 */

import { ApiError } from './http.js';
import { hex } from './hash.js';

const SKEW_MS = 5 * 60 * 1000;
const enc = new TextEncoder();

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSync(secret, ts, raw) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'v1=' + hex(await crypto.subtle.sign('HMAC', key, enc.encode(ts + '.' + raw)));
}

/* Returns the parsed body; throws auth on any doubt. */
export async function verifySync(env, request, raw, kind, now = Date.now(), { monotonic = true } = {}) {
  if (!env.SYNC_SECRET) throw new ApiError('disabled', 'SYNC_SECRET not set');
  const ts = Number(request.headers.get('x-sync-ts'));
  const sig = request.headers.get('x-sync-signature') || '';
  if (!ts || Math.abs(now - ts) > SKEW_MS) throw new ApiError('auth', 'sync ts');
  if (!safeEqual(sig, await signSync(env.SYNC_SECRET, String(ts), raw))) throw new ApiError('auth', 'sync signature');

  // a read-only question (monotonic: false) may repeat; a change never does
  const last = monotonic ? await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('SYNC_TS_' + kind).first() : null;
  if (last && Number(last.value) >= ts) throw new ApiError('conflict', 'sync replay');

  let body;
  try { body = JSON.parse(raw); } catch { throw new ApiError('bad', 'sync json'); }
  return { body, ts };
}

export function syncStampStmt(db, kind, ts) {
  return db.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, 'apps-script') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE CAST(settings.value AS INTEGER) < CAST(excluded.value AS INTEGER)")
    .bind('SYNC_TS_' + kind, String(ts), Date.now());
}
