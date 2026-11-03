/*
 * Structured logs (Workers Logs) — one line per request, no bodies, no
 * emails, no IPs, no tokens. Errors and slow requests are also kept in
 * D1 `api_log` (written after the response, via waitUntil).
 * Phase 7 (docs/PHASE7-PLAN.md, the p95 gate of BACKEND-MIGRATION §25):
 * env.API_LOG_SAMPLE = N also keeps about one in N other requests, so the
 * timing of routine actions can be read from D1. Unset or 0 = none.
 */

import { randomId } from './hash.js';

const SLOW_MS = 1500;

export function logLine(fields) {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...fields }));
}

export function persistIfNotable(env, ctx, entry, random = Math.random) {
  const sample = Number(env.API_LOG_SAMPLE) || 0;
  if (entry.status < 500 && entry.ms < SLOW_MS && !(sample >= 1 && random() * sample < 1)) return;
  ctx.waitUntil(
    env.DB.prepare('INSERT INTO api_log (id, at, rid, method, route, status, ms, code, colo, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(randomId('log-'), Date.now(), entry.rid, entry.method, entry.route, entry.status, entry.ms, entry.code || null, entry.colo || null, entry.actor || null)
      .run()
      .catch(err => console.log(JSON.stringify({ lvl: 'warn', msg: 'api_log write failed', err: String(err && err.message) })))
  );
}
