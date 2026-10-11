/**
 * COMPETITION API (transport)
 *
 * The public competition actions on the Apps Script deployment (§5):
 * POST { fn, args: [arg] } as text/plain (no CORS preflight), no cookies,
 * no cache, a timeout. Network failures, timeouts, HTTP 5xx and `busy`
 * are retried with jittered backoff — the idempotency keys (clientKey,
 * the attempt token) make a repeated start/submit return the same attempt
 * or the stored result. Everything else (`invalid`, `closed`, `limit`, …)
 * is answered at once.
 *
 * call() never throws: the reply is { ok:true, … } or { ok:false, code, message }.
 * code 'network' = still unreachable after the retries.
 */

import { retryDelay, RETRYABLE } from './flow.js';

const NETWORK_MESSAGE = 'مش قادرين نوصل للسيرفر دلوقتي.';

export function request(fn, arg) {
  return JSON.stringify({ fn, args: [arg] });
}

export function createApi({
  url,
  fetchImpl = (...a) => fetch(...a),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  random = Math.random,
  timeoutMs = 25000,
  retries = 4
} = {}) {

  async function once(fn, arg) {

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: request(fn, arg),
        credentials: 'omit',
        redirect: 'follow',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) {
        return { ok: false, code: response.status >= 500 || response.status === 429 ? 'network' : 'bad', message: NETWORK_MESSAGE };
      }
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, code: 'network', message: NETWORK_MESSAGE };
      if (data.ok === true) return data;
      return { ...data, ok: false, code: typeof data.code === 'string' ? data.code : 'bad', message: typeof data.message === 'string' ? data.message.slice(0, 300) : '' };
    }
    catch {
      return { ok: false, code: 'network', message: NETWORK_MESSAGE };
    }
    finally {
      if (timer) clearTimeout(timer);
    }

  }

  /**
   * options.retries: override (0 = one try). options.shouldStop(): checked
   * before every retry (e.g. the page went offline: queue instead).
   */
  async function call(fn, arg, options = {}) {

    const max = Number.isInteger(options.retries) ? options.retries : retries;
    let reply = null;

    for (let attempt = 0; ; attempt += 1) {
      reply = await once(fn, arg);
      if (reply.ok || !RETRYABLE.has(reply.code) || attempt >= max) return reply;
      if (options.shouldStop && options.shouldStop()) return reply;
      await sleep(retryDelay(attempt, random));
    }

  }

  return { call };

}
