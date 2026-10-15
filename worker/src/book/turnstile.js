/*
 * Cloudflare Turnstile on the public booking submit (worker/BOOKING-API.md
 * «Turnstile»). The event page shows the widget when GET /v1/book/state
 * says `turnstile: <site key>`, and sends its token as `turnstile` with
 * POST /v1/book/submit. The token is checked once with siteverify:
 *
 *   - TURNSTILE_SECRET set   → a token is required and must verify
 *                              (production: and be issued for SITE_URL's host);
 *   - not set, production    → submit refused (`disabled`): never open
 *                              without it;
 *   - not set, elsewhere     → skipped (unit tests, local).
 *
 * Tokens are single use: a replay of the same requestKey is answered before
 * this check, and the page asks for a fresh token after any error.
 * Proof uploads are not gated (they come before the token; they are budgeted
 * per IP, unclaimed ones are deleted after 24 h).
 */

import { ApiError } from '../lib/http.js';
import { logLine } from '../lib/log.js';

export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;

export function turnstileSiteKey(env) {
  return env.TURNSTILE_SECRET && env.TURNSTILE_SITEKEY ? String(env.TURNSTILE_SITEKEY) : null;
}

export async function checkTurnstile(ctx, token, ip) {
  const env = ctx.env;
  if (!env.TURNSTILE_SECRET) {
    if (env.ENVIRONMENT === 'production') throw new ApiError('disabled', 'TURNSTILE_SECRET not set');
    return { skipped: true };
  }
  token = String(token || '');
  if (!token || token.length > 2048) throw new ApiError('turnstile', 'missing');

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  let out;
  try {
    // called unbound, like the other fetches (a Workers fetch called as ctx.fetch(...) throws «Illegal invocation»)
    const fetchImpl = ctx.fetch;
    const res = await fetchImpl(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    out = await res.json();
  } catch (err) {
    logLine({ lvl: 'warn', kind: 'turnstile', msg: 'siteverify unreachable', err: String(err && err.message).slice(0, 200) });
    throw new ApiError('busy', 'siteverify unreachable');
  }
  if (!out || out.success !== true) {
    throw new ApiError('turnstile', 'rejected', { reasons: (out && Array.isArray(out['error-codes']) ? out['error-codes'] : []).slice(0, 4).map(String) });
  }
  if (env.ENVIRONMENT === 'production') {
    const host = new URL(env.SITE_URL).hostname;
    if (out.hostname !== host) throw new ApiError('turnstile', 'hostname', { reasons: ['hostname'] });
  }
  return { ok: true };
}
