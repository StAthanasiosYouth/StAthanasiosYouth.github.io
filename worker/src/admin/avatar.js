/*
 * Phase 8B W6 (B12, me-avatar.png): an admin's own photo. The panel crops it to a circle and squeezes it
 * (≤ 200 KB); it shows in the rail, the top bar, «مين فاتح دلوقتي», the log and the team. Never on the
 * public site, and nothing here changes what an admin may do. Each admin sets or removes their own only.
 *
 *   POST /v1/admin/me/avatar          { image: 'data:image/webp;base64,…' } → { avatars }
 *   POST /v1/admin/me/avatar/delete   → { avatars }
 *   GET  /v1/admin/avatars            → { avatars: { <email>: { src, v } } }   (active admins only)
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { limit } from '../lib/ratelimit.js';

export const AVATAR_MAX = 200 * 1024;
const PREFIX = /^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;
const MAGIC = {
  webp: b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  jpeg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
};

/* the image as given, or ApiError('invalid') */
export function cleanAvatar(value) {
  const m = PREFIX.exec(String(value || ''));
  if (!m) throw new ApiError('invalid', 'image type', { field: 'image' });
  let bytes;
  try { bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); }
  catch { throw new ApiError('invalid', 'image data', { field: 'image' }); }
  if (bytes.length < 64 || bytes.length > AVATAR_MAX) throw new ApiError('invalid', 'image size', { field: 'image' });
  if (!MAGIC[m[1]](bytes)) throw new ApiError('invalid', 'image bytes', { field: 'image' });
  return 'data:image/' + m[1] + ';base64,' + m[2];
}

async function all(env) {
  const rows = await retry(() => env.DB.prepare(
    'SELECT v.email, v.image, v.updated_ms FROM admin_avatars v JOIN admins a ON a.email = v.email WHERE a.active = 1'
  ).all());
  return Object.fromEntries(rows.results.map(r => [r.email, { src: r.image, v: r.updated_ms }]));
}

/* GET /v1/admin/avatars */
export async function adminAvatars(ctx) {
  return { avatars: await all(ctx.env) };
}

/* POST /v1/admin/me/avatar */
export async function adminAvatarSave(ctx) {
  await limit(ctx, 'admin.avatar', ctx.actor.email, 20, 600);
  const image = cleanAvatar(ctx.body && ctx.body.image);
  await retry(() => ctx.env.DB.prepare(
    'INSERT INTO admin_avatars (email, image, updated_ms) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET image = excluded.image, updated_ms = excluded.updated_ms'
  ).bind(ctx.actor.email, image, Date.now()).run());
  return { avatars: await all(ctx.env) };
}

/* POST /v1/admin/me/avatar/delete */
export async function adminAvatarDelete(ctx) {
  await limit(ctx, 'admin.avatar', ctx.actor.email, 20, 600);
  await retry(() => ctx.env.DB.prepare('DELETE FROM admin_avatars WHERE email = ?').bind(ctx.actor.email).run());
  return { avatars: await all(ctx.env) };
}
