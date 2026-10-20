/*
 * Admin permissions (Phase 1.5, docs/BOOKING-PHASE1-COMPLETION-PLAN.md §4.3).
 *
 * Explicit grants `module.action` in D1 `admin_grants`, scope 'all' | 'own'
 * (own = the admin's linked servant, admins.servant_id). One route →
 * permission table (ROUTE_PERMS); index.js checks it for every admin route.
 *
 * Switch PERMS_ENFORCE (D1 settings) — '1' enforces the grants. Anything else
 * (the default, and the §8 rollback) keeps today's access: every active admin
 * holds every permission except the Primary-Admin defaults below, which stay
 * Primary-only (or an explicit grant) whatever the switch says.
 * The Primary Admin always holds every permission, scope 'all'.
 */

import { ApiError } from './http.js';
import { retry } from './db.js';

const CATALOG = {
  content: ['view', 'edit', 'delete'],
  publish: ['publish'],
  events: ['view', 'add', 'edit', 'delete'],
  bookings: ['view', 'create_cash', 'edit', 'approve', 'manage'],
  finance: ['view', 'manage'],
  exports: ['export', 'export_pii'],
  competitions: ['view', 'add', 'edit', 'delete', 'approve'],
  store: ['view', 'add', 'edit', 'delete', 'approve'],
  points: ['view', 'edit', 'approve'],
  participants: ['view', 'add', 'edit', 'manage'],
  media: ['view', 'add', 'delete'],
  push: ['view', 'manage'],
  accounts: ['view', 'manage'],
  activity: ['view'],
  notifications: ['view', 'manage'],
  system: ['view', 'manage']
};

export const PERMS = Object.freeze(Object.entries(CATALOG).flatMap(([m, actions]) => actions.map(a => m + '.' + a)));
const KNOWN = new Set(PERMS);

/* Never granted by default: the Primary Admin's, until they grant them (§4.3; YOUTH-ACCOUNTS-PLAN §12.2). */
export const PRIMARY_DEFAULT = Object.freeze(['accounts.manage', 'notifications.manage', 'participants.manage']);

/* Any active admin, no grant needed. */
export const ANY_ADMIN = '*';

/*
 * 'METHOD /path' → the permission (or all of a list) the route needs.
 * Every admin route in routes.js must be here (perms.test.mjs); an unmapped
 * one is denied while PERMS_ENFORCE is on.
 */
export const ROUTE_PERMS = Object.freeze({
  'GET /v1/admin/whoami': ANY_ADMIN,
  'GET /v1/admin/activity': 'activity.view',
  'POST /v1/admin/diag/echo': 'system.manage',
  'POST /v1/admin/diag/housekeeping': 'system.manage',
  'POST /v1/admin/diag/event-fixture': 'system.manage',
  'POST /v1/admin/diag/retention': 'system.manage',
  'GET /v1/admin/diag/book-news': 'system.view',
  'POST /v1/admin/proofs': 'bookings.edit',
  'GET /v1/admin/proofs/:id': 'bookings.view',
  'DELETE /v1/admin/proofs/:id': 'bookings.manage',

  'GET /v1/admin/book/module': 'bookings.view',
  'POST /v1/admin/book/module': 'bookings.manage',
  'GET /v1/admin/book/events': 'bookings.view',
  'POST /v1/admin/book/events/:slug/refresh': 'bookings.edit',
  'POST /v1/admin/book/events/:id/cancel-all': 'bookings.manage',
  'GET /v1/admin/book/bookings': 'bookings.view',
  'POST /v1/admin/book/bookings': 'bookings.create_cash',
  'GET /v1/admin/book/bookings/:id': 'bookings.view',
  'POST /v1/admin/book/bookings/:id/lock': 'bookings.edit',
  'DELETE /v1/admin/book/bookings/:id/lock': 'bookings.edit',
  'POST /v1/admin/book/bookings/:id/confirm': 'bookings.approve',
  'POST /v1/admin/book/bookings/:id/reject': 'bookings.approve',
  'POST /v1/admin/book/bookings/:id/cancel': 'bookings.manage',
  'POST /v1/admin/book/bookings/:id/reopen': 'bookings.manage',
  'POST /v1/admin/book/bookings/:id/update': 'bookings.edit',
  'POST /v1/admin/book/bookings/:id/payments': ['bookings.approve', 'finance.manage'],
  'POST /v1/admin/book/payments/:id/void': 'finance.manage',
  'GET /v1/admin/book/summary': 'bookings.view',
  'GET /v1/admin/book/export': 'exports.export',
  'GET /v1/admin/book/events/:id/handovers': 'finance.view',
  'GET /v1/admin/book/finance': 'finance.view',
  'GET /v1/admin/book/events/:id/reminders': 'bookings.view',
  'POST /v1/admin/book/events/:id/reminders': 'bookings.edit',
  'POST /v1/admin/book/events/:id/handovers': 'finance.manage',
  'POST /v1/admin/book/handovers/:id/void': 'finance.manage'
});

export function routePerm(route) {
  return ROUTE_PERMS[route.method + ' ' + route.path];
}

/* The actor's grants + the switch, read once per request (one D1 round trip). */
async function loadAccess(ctx) {
  if (ctx.access) return ctx.access;
  const email = ctx.actor.email;
  const rows = (await retry(() => ctx.env.DB.prepare(
    "SELECT 'g' AS k, perm, scope FROM admin_grants WHERE email = ? " +
    "UNION ALL SELECT 's' AS k, value AS perm, NULL AS scope FROM settings WHERE key = 'PERMS_ENFORCE' " +
    "UNION ALL SELECT 'a' AS k, servant_id AS perm, NULL AS scope FROM admins WHERE email = ?"
  ).bind(email, email).all())).results;
  const grants = new Map();
  let enforce = false;
  let servantId = null;
  for (const r of rows) {
    if (r.k === 'g') grants.set(r.perm, r.scope === 'own' ? 'own' : 'all');
    else if (r.k === 's') enforce = String(r.perm) === '1';
    else if (r.k === 'a') servantId = r.perm || null;
  }
  ctx.access = { enforce, grants, servantId, primary: ctx.actor.role === 'primary' };
  return ctx.access;
}

/*
 * requirePerm(ctx, perm, { scope }) → { perm, scope, servantId }, or throws denied.
 * `perm`: a catalog key, a list (all of them), or ANY_ADMIN.
 * `scope`: what the request needs — 'own' (default: any grant does) or 'all'.
 * The returned scope is what the admin holds ('own' → the handler limits
 * itself to `servantId`; an 'own' grant without a linked servant is refused).
 */
export async function requirePerm(ctx, perm, { scope = 'own' } = {}) {
  if (!ctx.actor) throw new ApiError('auth', 'no actor');
  if (perm === ANY_ADMIN) return { perm, scope: 'all', servantId: null };
  const list = Array.isArray(perm) ? perm : [perm];
  if (!list.length || list.some(p => !KNOWN.has(p))) throw new ApiError('denied', 'perm unknown', { perm: list.join(',') || null });
  const a = await loadAccess(ctx);
  let held = 'all';
  for (const p of list) {
    let s;
    if (a.primary) s = 'all';
    else if (a.grants.has(p)) s = a.grants.get(p);
    else if (!a.enforce && !PRIMARY_DEFAULT.includes(p)) s = 'all';
    if (!s) throw new ApiError('denied', 'perm', { perm: p });
    if (s === 'own') {
      if (scope === 'all' || !a.servantId) throw new ApiError('denied', 'scope', { perm: p });
      held = 'own';
    }
  }
  return { perm, scope: held, servantId: held === 'own' ? a.servantId : null };
}

/* The route-level check (index.js): an unmapped admin route is denied while enforcing. */
export async function requireRoutePerm(ctx, route) {
  const perm = routePerm(route);
  if (perm !== undefined) return requirePerm(ctx, perm);
  const a = await loadAccess(ctx);
  if (a.enforce && !a.primary) throw new ApiError('denied', 'route unmapped');
  return null;
}
