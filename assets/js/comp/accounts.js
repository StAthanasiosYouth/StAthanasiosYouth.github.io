/**
 * COMPETITIONS AND «نقاطي» ON ACCOUNTS (docs/PHASE5-PLAN.md P5-8): once the Worker says accounts are on,
 * the same pages talk to it, signed in, with the same reply shapes. Before that nothing changes: the
 * code login on Apps Script stays. The last answer is remembered, so a moment without the Worker can't
 * send anyone back to the old login. Sign-in itself happens on /account/, which brings them back here.
 */

import { bookApiUrl } from '../page/book-config.js';
import { readSession, clearSession, RETURN_KEY, cleanReturn } from '../account/model.js';
import { retryDelay, RETRYABLE } from './flow.js';

const MODE_KEY = 'athanasios.account.mode.v1';
const CONFIG_TIMEOUT_MS = 4000;

const store = name => {
  try {
    return globalThis[name] || null;
  }
  catch {
    return null;
  }
};

const read = key => {
  try {
    return store('localStorage') ? store('localStorage').getItem(key) : null;
  }
  catch {
    return null;
  }
};

const remember = value => {
  try {
    if (store('localStorage')) store('localStorage').setItem(MODE_KEY, value);
  }
  catch { /* asked again next time */ }
};

/* are accounts on? The Worker's word, else the last one heard, else no */
export async function accountsOn(fetchImpl = (...a) => fetch(...a)) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS) : null;
  try {
    const response = await fetchImpl(bookApiUrl() + '/v1/account/config', { credentials: 'omit', cache: 'no-store', signal: controller ? controller.signal : undefined });
    const data = await response.json();
    const on = !!data && data.ok === true && data.mode === 'on';
    remember(on ? 'on' : 'off');
    return on;
  }
  catch {
    return read(MODE_KEY) === 'on';
  }
  finally {
    if (timer) clearTimeout(timer);
  }
}

export const accountSession = () => readSession(store('localStorage'), store('sessionStorage'));

export const dropAccountSession = () => clearSession(store('localStorage'), store('sessionStorage'));

/* off to /account/; it brings them back to this page after signing in */
export function goSignIn(rootUrl) {
  const path = location.pathname + location.search;
  try {
    if (cleanReturn(path) && store('sessionStorage')) store('sessionStorage').setItem(RETURN_KEY, path);
  }
  catch { /* the account page still opens */ }
  location.href = new URL('account/', rootUrl).href;
}

const ROUTES = {
  compStart: '/v1/comp/start', compSubmit: '/v1/comp/submit', compResult: '/v1/comp/result', portalMe: '/v1/comp/me', portalReview: '/v1/comp/result',
  shopRedeem: '/v1/shop/redeem', shopCancel: '/v1/shop/cancel'
};
const NETWORK_MESSAGE = 'مش قادرين نوصل للسيرفر دلوقتي.';

/* the same call() as api.js: { ok: true, … } or { ok: false, code, message }; never throws */
export function createWorkerApi({ fetchImpl = (...a) => fetch(...a), sleep = ms => new Promise(r => setTimeout(r, ms)), random = Math.random, timeoutMs = 25000, retries = 4 } = {}) {

  async function once(fn, arg) {
    const path = ROUTES[fn];
    if (!path) return { ok: false, code: 'bad', message: '' };
    const session = accountSession();
    if (!session) return { ok: false, code: 'session', message: '' };
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(bookApiUrl() + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token },
        body: JSON.stringify(arg || {}),
        credentials: 'omit',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });
      const data = await response.json().catch(() => null);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, code: 'network', message: NETWORK_MESSAGE };
      if (data.ok === true) return data;
      if (data.code === 'accounts_off') return { ok: false, code: 'disabled', message: data.message || '' };
      if (data.code === 'rate') return { ok: false, code: 'busy', message: data.message || '' };
      if (response.status >= 500) return { ok: false, code: 'network', message: NETWORK_MESSAGE };
      return { ...data, ok: false, code: typeof data.code === 'string' ? data.code : 'bad', message: typeof data.message === 'string' ? data.message.slice(0, 300) : '' };
    }
    catch {
      return { ok: false, code: 'network', message: NETWORK_MESSAGE };
    }
    finally {
      if (timer) clearTimeout(timer);
    }
  }

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

/* the name and the state the competition's first screens need */
export async function accountSummary(fetchImpl = (...a) => fetch(...a)) {
  const session = accountSession();
  if (!session) return null;
  try {
    const response = await fetchImpl(bookApiUrl() + '/v1/account/me', { headers: { Authorization: 'Bearer ' + session.token }, credentials: 'omit' });
    const data = await response.json();
    return data && data.ok ? data.account : null;
  }
  catch {
    return null;
  }
}
