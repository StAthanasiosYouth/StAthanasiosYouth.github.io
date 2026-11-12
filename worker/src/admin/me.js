/*
 * Phase 3 P3-3 (docs/ADMIN-PLATFORM-PLAN.md): who the signed-in admin is and
 * what they may do — the panel's navigation model from D1 — and the admins'
 * display names, owned by D1 (admins.name) instead of the ADMIN_NAMES Script
 * Property (apps-script/Activity.gs apiSetAdminName, ported: same rules,
 * same audit row). Apps Script reads the names back through the grants
 * snapshot (lib/perms.js grantsSnapshot, `name`).
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { limit } from '../lib/ratelimit.js';
import { PERMS, heldScope } from '../lib/perms.js';
import { platformOn } from './session.js';
import { readPrefs } from './prefs.js';

export const NAME_MIN = 2;
export const NAME_MAX = 40;
// controls, soft hyphen, Arabic letter mark, Hangul fillers, zero-width/bidi, variation selectors, BOM (Activity.gs ADMIN_NAME_STRIP)
const STRIP = /[\u0000-\u001f\u007f-\u009f­؜ᅟᅠ᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;

export function cleanName(v) {
  return String(v == null ? '' : v).normalize('NFC').replace(STRIP, '').replace(/\s+/g, ' ').trim();
}

/* two names that read the same are the same (case, Arabic diacritics/tatweel, alef/yeh/teh forms) */
export function nameKey(v) {
  return cleanName(v).toLowerCase().replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[\s._\-'"«»()]/g, '');
}

/*
 * GET /v1/admin/me → { email, name, primary, servantId, enforce, platform, perms: { perm: 'all' | 'own' }, prefs }
 * `perms` holds only what the admin may do (the same rule every route checks: lib/perms.js heldScope).
 */
export async function adminMe(ctx) {
  const row = await retry(() => ctx.env.DB.prepare(
    "SELECT a.name, a.servant_id, (SELECT value FROM settings WHERE key = 'PERMS_ENFORCE') AS enforce, (SELECT value FROM settings WHERE key = 'GAMES_MODULE') AS games FROM admins a WHERE a.email = ?"
  ).bind(ctx.actor.email).first());
  const perms = {};
  for (const p of PERMS) {
    const s = await heldScope(ctx, p);
    if (s) perms[p] = s;
  }
  return {
    email: ctx.actor.email,
    name: (row && row.name) || ctx.actor.email.split('@')[0],
    primary: ctx.actor.role === 'primary',
    servantId: (row && row.servant_id) || null,
    enforce: !!row && row.enforce === '1',
    platform: await platformOn(ctx.env),
    perms,
    // Phase 8 A1: the admin's own look of the panel (prefs.js)
    prefs: await readPrefs(ctx.env, ctx.actor.email),
    // Phase 8 A7: the games corner's locked «قريبًا» entry (off unless GAMES_MODULE = '1'; no Phase 10 code)
    modules: { games: !!row && row.games === '1' }
  };
}

/*
 * POST /v1/admin/accounts/:email/name { name } — '' clears it (the email's local part is shown).
 * Unique by nameKey. → { email, name, names, canManage, canRename }
 * Who (owner 2026-11-12, whatever PERMS_ENFORCE says): the account itself, the Primary Admin, or an
 * admin the Primary Admin granted accounts.rename. Anyone else: denied.
 */
export async function adminRename(ctx) {
  await limit(ctx, 'admin.rename', ctx.actor.email, 20, 60);
  const email = String(ctx.params.email || '').trim().toLowerCase();
  const canRename = ctx.actor.role === 'primary' || (await heldScope(ctx, 'accounts.rename')) === 'all';
  if (email !== String(ctx.actor.email || '').toLowerCase() && !canRename) throw new ApiError('denied', 'rename another admin', { perm: 'accounts.rename' });
  const clean = cleanName(ctx.body && ctx.body.name);
  if (clean && (clean.length < NAME_MIN || clean.length > NAME_MAX)) throw new ApiError('invalid', 'name length', { field: 'name' });
  if (clean && (/[@<>{}[\]\\/|`=]/.test(clean) || !/[A-Za-zء-ي]/.test(clean))) throw new ApiError('invalid', 'name chars', { field: 'name' });

  const db = ctx.env.DB;
  const all = (await retry(() => db.prepare('SELECT email, name FROM admins WHERE active = 1').all())).results;
  const row = all.find(a => a.email === email);
  if (!row) throw new ApiError('not_found', 'admin');
  if (clean) {
    const key = nameKey(clean);
    const taken = all.some(a => a.email !== email && (nameKey(a.name || '') === key || nameKey(a.email.split('@')[0]) === key));
    if (taken) throw new ApiError('conflict', 'name taken', { field: 'name' });
  }
  const before = row.name || email.split('@')[0];
  if ((row.name || '') !== clean) {
    await retry(() => db.batch([
      db.prepare('UPDATE admins SET name = ? WHERE email = ? AND active = 1').bind(clean || null, email),
      activityStmt(db, {
        actor: ctx.actor.email, actorName: ctx.actor.name, action: 'admin.rename', entityType: 'admins', entityId: email, entityTitle: email,
        summary: 'غيّر اسم «' + email + '»', changes: { from: before, to: clean || email.split('@')[0] }
      })
    ]));
  }
  const names = Object.fromEntries(all.map(a => [a.email, a.email === email ? (clean || email.split('@')[0]) : (a.name || a.email.split('@')[0])]));
  return { email, name: names[email], names, canManage: (await heldScope(ctx, 'accounts.manage')) === 'all', canRename };
}
