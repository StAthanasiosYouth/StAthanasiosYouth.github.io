/*
 * Phase 8 A1 (docs/PHASE8-PLAN.md §2): an admin's look of the panel, theirs only.
 * The panel keeps a copy on the device (applied before the first paint, admin/restore.js) and
 * this is the copy that follows the admin to any other device. Nothing here changes what an
 * admin may do: no permission, no audit row (it is a personal preference, like a theme).
 *
 *   GET  /v1/admin/me           → … prefs (adminMe, me.js)
 *   POST /v1/admin/me/prefs     { theme?, accent?, density?, motion?, sound? } → { prefs }
 *
 * Only known keys and values are kept; anything else is dropped, a missing key keeps its value.
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { limit } from '../lib/ratelimit.js';

export const PREF_DEFAULTS = Object.freeze({ theme: 'dark', accent: 'gold', density: 'comfortable', motion: 'full', sound: false });

const CHOICES = {
  theme: ['dark', 'light', 'system'],
  accent: ['gold', 'sea', 'carmine', 'azure', 'emerald', 'violet'],
  density: ['comfortable', 'compact'],
  motion: ['full', 'lite', 'off']
};

/* the known keys with valid values only (from `input`, else `base`) */
export function cleanPrefs(input, base = PREF_DEFAULTS) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = { ...PREF_DEFAULTS, ...base };
  for (const [key, allowed] of Object.entries(CHOICES)) {
    if (allowed.includes(src[key])) out[key] = src[key];
  }
  if (typeof src.sound === 'boolean') out.sound = src.sound;
  return out;
}

export async function readPrefs(env, email) {
  const row = await retry(() => env.DB.prepare('SELECT prefs FROM admin_prefs WHERE email = ?').bind(email).first());
  if (!row) return { ...PREF_DEFAULTS };
  try {
    return cleanPrefs(JSON.parse(row.prefs));
  }
  catch {
    return { ...PREF_DEFAULTS };
  }
}

/* POST /v1/admin/me/prefs */
export async function adminPrefsSave(ctx) {
  await limit(ctx, 'admin.prefs', ctx.actor.email, 60, 60);
  const body = ctx.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('bad', 'prefs');
  const prefs = cleanPrefs(body, await readPrefs(ctx.env, ctx.actor.email));
  const now = Date.now();
  await retry(() => ctx.env.DB.prepare(
    'INSERT INTO admin_prefs (email, prefs, updated_ms) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET prefs = excluded.prefs, updated_ms = excluded.updated_ms'
  ).bind(ctx.actor.email, JSON.stringify(prefs), now).run());
  return { prefs };
}
