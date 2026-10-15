/*
 * D1 access with retries for transient failures.
 *
 * Phase 0 saw 1 in 300 burst writes fail with "D1_ERROR: Network connection
 * lost". Retrying is only safe because every write is idempotent: creates
 * carry UNIQUE keys, updates are guarded (`WHERE … AND status = 'pending'`).
 * Never wrap a non-idempotent statement in `retry`.
 */

const TRANSIENT = /network connection lost|storage caused object to be reset|internal error|overloaded|timed? ?out|connection reset|try again|D1_ERROR: (?:.*)?(?:reset|timeout)/i;

export function isTransient(err) {
  return TRANSIENT.test(String(err && (err.message || err)));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function retry(fn, { attempts = 3, base = 60 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTransient(err) || i === attempts - 1) throw err;
      await sleep(base * Math.pow(3, i) + Math.random() * base);
    }
  }
  throw last;
}

/* Cairo wall-clock text, like the Sheets data (YYYY-MM-DD HH:MM). */
export function cairoText(ms) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
