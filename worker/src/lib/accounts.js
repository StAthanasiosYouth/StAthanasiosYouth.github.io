/*
 * «الصلاحيات»: admin accounts + grants, owned by D1 from Phase 1.5
 * (docs/BOOKING-PHASE1-COMPLETION-PLAN.md §4.3). Apps Script mirrors the
 * active list into ADMIN_EMAILS (apps-script/Grants.gs), so its login gate
 * follows these changes within a minute.
 *
 * Protections:
 * - the Primary Admin's row is immutable through the API;
 * - nobody grants a permission (or a wider scope) they don't hold;
 * - an admin can't remove their own accounts.manage, nor themself;
 * - the last account manager can't be removed;
 * - every change needs a Google ID token (not the panel's session token or a
 *   trusted device): `google` otherwise;
 * - every change is audited (before → after, permission names only) as a
 *   critical activity row — the notification router (step 5) sends it to the Primary Admin.
 */

import { ApiError } from './http.js';
import { retry } from './db.js';
import { activityStmt } from './activity.js';
import { limit } from './ratelimit.js';
import { PERMS, PRIMARY_DEFAULT, PRESETS, heldScope } from './perms.js';

export const MAX_ADMINS = 20;
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;
const SERVANT_RE = /^srv-[a-z0-9-]{2,40}$/;
const KNOWN = new Set(PERMS);

const invalid = field => new ApiError('invalid', field, { field });
const protect = reason => new ApiError('protected', reason, { reason });

function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 254) throw invalid('email');
  return e;
}

function cleanGrants(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid('grants');
  const out = {};
  for (const [p, s] of Object.entries(v)) {
    if (!KNOWN.has(p) || (s !== 'all' && s !== 'own')) throw invalid('grants');
    out[p] = s;
  }
  return out;
}

function cleanServant(v) {
  if (v == null || v === '') return null;
  if (!SERVANT_RE.test(String(v))) throw invalid('servantId');
  return String(v);
}

function cleanName(v) {
  if (v == null) return null;
  const n = String(v).trim().slice(0, 80);
  return n || null;
}

function requireGoogle(ctx) {
  if (ctx.actor.via !== 'google-id') throw new ApiError('google', 'google id token needed');
}

/* "bookings:view+approve finance:manage(own)" — names only, short enough for the 1 KB audit */
function digest(grants) {
  const by = {};
  for (const p of Object.keys(grants).sort()) {
    const [m, a] = p.split('.');
    (by[m] = by[m] || []).push(a + (grants[p] === 'own' ? '(own)' : ''));
  }
  return Object.entries(by).map(([m, a]) => m + ':' + a.join('+')).join(' ');
}

function diff(before, after) {
  const added = {}, removed = {};
  for (const [p, s] of Object.entries(after)) if (before[p] !== s) added[p] = s;
  for (const [p, s] of Object.entries(before)) if (!(p in after)) removed[p] = s;
  return { added, removed };
}

async function loadAll(db) {
  const [admins, grants] = await retry(() => db.batch([
    db.prepare('SELECT email, name, role, active, servant_id, last_seen FROM admins ORDER BY role = \'primary\' DESC, email'),
    db.prepare('SELECT email, perm, scope FROM admin_grants')
  ]));
  const by = new Map();
  for (const g of grants.results) {
    if (!by.has(g.email)) by.set(g.email, {});
    by.get(g.email)[g.perm] = g.scope === 'own' ? 'own' : 'all';
  }
  return admins.results.map(a => ({
    email: a.email, name: a.name || '', primary: a.role === 'primary', active: !!a.active,
    servantId: a.servant_id || null, lastSeen: a.last_seen || null, grants: by.get(a.email) || {}
  }));
}

async function listing(ctx) {
  const all = await loadAll(ctx.env.DB);
  const enforce = await retry(() => ctx.env.DB.prepare("SELECT value FROM settings WHERE key = 'PERMS_ENFORCE'").first('value'));
  return {
    me: ctx.actor.email,
    canManage: (await heldScope(ctx, 'accounts.manage')) === 'all',
    enforce: enforce === '1',
    max: MAX_ADMINS,
    perms: PERMS,
    primaryDefault: PRIMARY_DEFAULT,
    presets: PRESETS,
    admins: all.filter(a => a.active)
  };
}

/* the grants the actor may give: everything new or wider must be held (an 'own' grant only as 'own') */
async function checkGrantable(ctx, before, after) {
  for (const [p, s] of Object.entries(after)) {
    if (before[p] === s || (before[p] === 'all' && s === 'own')) continue;
    const held = await heldScope(ctx, p);
    if (!(held === 'all' || (held === 'own' && s === 'own'))) throw new ApiError('denied', 'grant not held', { perm: p });
  }
}

/* after the change, someone active must still manage accounts */
export function checkManagers(all, email, after) {
  const left = all.filter(a => a.active && (a.email === email ? after !== null : true))
    .filter(a => a.primary || (a.email === email ? after && after['accounts.manage'] === 'all' : a.grants['accounts.manage'] === 'all'));
  if (!left.length) throw protect('last');
}

function writeStmts(db, ctx, { email, name, servantId, grants, action, summary, changes, add }) {
  const now = Date.now();
  const stmts = [];
  if (add) {
    stmts.push(db.prepare(
      "INSERT INTO admins (email, name, role, active, created_at, servant_id) VALUES (?, ?, 'admin', 1, ?, ?) " +
      "ON CONFLICT(email) DO UPDATE SET active = 1, name = COALESCE(excluded.name, admins.name), servant_id = excluded.servant_id WHERE admins.role != 'primary'"
    ).bind(email, name, now, servantId));
  } else if (grants) {
    stmts.push(db.prepare("UPDATE admins SET servant_id = ?, name = COALESCE(?, name) WHERE email = ? AND role != 'primary'").bind(servantId, name, email));
  } else {
    stmts.push(db.prepare("UPDATE admins SET active = 0 WHERE email = ? AND role != 'primary'").bind(email));
  }
  stmts.push(db.prepare('DELETE FROM admin_grants WHERE email = ?').bind(email));
  for (const [p, s] of Object.entries(grants || {})) {
    stmts.push(db.prepare('INSERT INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)').bind(email, p, s, ctx.actor.email, now));
  }
  stmts.push(activityStmt(db, {
    actor: ctx.actor.email, actorName: ctx.actor.name, action, entityType: 'admin', entityId: email, entityTitle: email,
    summary, changes, severity: 'critical'
  }));
  return stmts;
}

/* GET /v1/admin/accounts (accounts.view) */
export async function accountsList(ctx) {
  return listing(ctx);
}

/* POST /v1/admin/accounts { email, name?, servantId?, grants } (accounts.manage, Google) */
export async function accountAdd(ctx) {
  requireGoogle(ctx);
  await limit(ctx, 'accounts', ctx.actor.email, 30, 60);
  const email = cleanEmail(ctx.body.email);
  const grants = cleanGrants(ctx.body.grants || {});
  const servantId = cleanServant(ctx.body.servantId);
  const name = cleanName(ctx.body.name);
  const all = await loadAll(ctx.env.DB);
  const row = all.find(a => a.email === email);
  if (row && row.primary) throw protect('primary');
  if (row && row.active) throw new ApiError('conflict', 'exists', { field: 'email' });
  if (all.filter(a => a.active).length >= MAX_ADMINS) throw protect('max');
  await checkGrantable(ctx, {}, grants);
  await retry(() => ctx.env.DB.batch(writeStmts(ctx.env.DB, ctx, {
    email, name, servantId, grants, add: true, action: 'accounts.add',
    summary: 'ضاف «' + email + '» للوحة التحكم (' + Object.keys(grants).length + ' صلاحية)', changes: { after: digest(grants), servant: servantId }
  })));
  return listing(ctx);
}

/* POST /v1/admin/accounts/:email { grants, servantId?, name? } (accounts.manage, Google) */
export async function accountUpdate(ctx) {
  requireGoogle(ctx);
  await limit(ctx, 'accounts', ctx.actor.email, 30, 60);
  const email = cleanEmail(ctx.params.email);
  const grants = cleanGrants(ctx.body.grants);
  const servantId = cleanServant(ctx.body.servantId);
  const name = cleanName(ctx.body.name);
  const all = await loadAll(ctx.env.DB);
  const row = all.find(a => a.email === email && a.active);
  if (!row) throw new ApiError('not_found', 'admin');
  if (row.primary) throw protect('primary');
  if (email === ctx.actor.email && row.grants['accounts.manage'] && grants['accounts.manage'] !== row.grants['accounts.manage']) throw protect('self');
  await checkGrantable(ctx, row.grants, grants);
  checkManagers(all, email, grants);
  const { added, removed } = diff(row.grants, grants);
  if (!Object.keys(added).length && !Object.keys(removed).length && servantId === row.servantId && (name === null || name === row.name)) return listing(ctx);
  await retry(() => ctx.env.DB.batch(writeStmts(ctx.env.DB, ctx, {
    email, name, servantId, grants, action: 'accounts.grants',
    summary: 'غيّر صلاحيات «' + email + '» (+' + Object.keys(added).length + ' −' + Object.keys(removed).length + ')',
    changes: { added: digest(added), removed: digest(removed), servant: servantId === row.servantId ? undefined : { from: row.servantId, to: servantId } }
  })));
  return listing(ctx);
}

/* POST /v1/admin/accounts/:email/remove (accounts.manage, Google) — the row stays inactive (its Google sub binding too) */
export async function accountRemove(ctx) {
  requireGoogle(ctx);
  await limit(ctx, 'accounts', ctx.actor.email, 30, 60);
  const email = cleanEmail(ctx.params.email);
  const all = await loadAll(ctx.env.DB);
  const row = all.find(a => a.email === email && a.active);
  if (!row) throw new ApiError('not_found', 'admin');
  if (row.primary) throw protect('primary');
  if (email === ctx.actor.email) throw protect('self');
  checkManagers(all, email, null);
  await retry(() => ctx.env.DB.batch(writeStmts(ctx.env.DB, ctx, {
    email, grants: null, action: 'accounts.remove', summary: 'شال صلاحية «' + email + '»', changes: { before: digest(row.grants) }
  })));
  return listing(ctx);
}
