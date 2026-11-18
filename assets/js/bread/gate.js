/*
 * «خبزنا اليومي» — is the section open? For the home card and the «المزيد» menu link (PLAN.md W5 «في الموقع»).
 *
 * While BREAD_MODULE ≠ 1 nothing of the section shows on the site (no card, no link). Cheap on purpose:
 *   1. the static index (daily-bread/data/index.json on GitHub Pages). Missing → closed, and the Worker is not asked.
 *   2. it exists → the Worker's index: `disabled` → closed; an answer → open; unreachable → open only if this device
 *      already saw it open (offline / slow).
 * The answer is kept for the tab for 10 minutes (sessionStorage), so moving around the site asks once.
 */
import { bookApiUrl } from '../page/book-config.js';

const ROOT = new URL('../../../', import.meta.url);
const KEY = 'bread.gate';
const TTL = 10 * 60000;
const ss = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* fine */ } } };
const known = () => { try { return localStorage.getItem('bread.on') === '1'; } catch { return false; } };

async function json(url, ms) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    const res = await fetch(url, { cache: 'no-cache', credentials: 'omit', signal: ctl ? ctl.signal : undefined });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  }
  finally { clearTimeout(t); }
}

let asked = null;
/** → { on: boolean, index } */
export function breadGate() {
  return (asked ||= (async () => {
    try {
      const kept = JSON.parse(ss.get(KEY) || 'null');
      if (kept && Date.now() - kept.at < TTL) return { on: !!kept.on, index: kept.index || null };
    }
    catch { /* ask again */ }
    let out = { on: false, index: null };
    try {
      const s = await json(new URL('daily-bread/data/index.json', ROOT).href, 6000);
      if (s.status === 200 && s.body && Array.isArray(s.body.programs)) {
        const w = await json(bookApiUrl() + '/v1/bread/file/index', 6000).catch(() => null);
        if (w && w.status === 200 && w.body && Array.isArray(w.body.programs)) out = { on: true, index: w.body };
        else if (w && w.body && w.body.code === 'disabled') out = { on: false, index: null };
        else if (known()) out = { on: true, index: s.body };
      }
    }
    catch { /* closed */ }
    ss.set(KEY, JSON.stringify({ ...out, at: Date.now() }));
    return out;
  })());
}
