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

/* «الصلاحيات» presets: they only pre-fill the checkboxes (§4.3). perm → scope. */
const views = PERMS.filter(p => p.endsWith('.view') && p !== 'accounts.view' && p !== 'notifications.view');
const allOf = list => Object.fromEntries(list.map(p => [p, 'all']));
export const PRESETS = Object.freeze({
  treasurer: { label: 'أمين الصندوق', grants: allOf(['bookings.view', 'events.view', 'finance.view', 'finance.manage', 'exports.export', 'activity.view']) },
  servant_bookings: { label: 'خادم – حجوزات', grants: { 'bookings.view': 'all', 'events.view': 'all', 'bookings.create_cash': 'own' } },
  content_editor: { label: 'محرر المحتوى', grants: allOf(['content.view', 'content.edit', 'content.delete', 'publish.publish', 'events.view', 'events.add', 'events.edit', 'media.view', 'media.add', 'media.delete', 'push.view']) },
  viewer: { label: 'مشاهد', grants: allOf(views) }
});

/* Any active admin, no grant needed. */
export const ANY_ADMIN = '*';

/*
 * 'METHOD /path' → the permission (or all of a list) the route needs.
 * Every admin route in routes.js must be here (perms.test.mjs); an unmapped
 * one is denied while PERMS_ENFORCE is on.
 */
export const ROUTE_PERMS = Object.freeze({
  'GET /v1/admin/whoami': ANY_ADMIN,
  'GET /v1/admin/me': ANY_ADMIN,
  'POST /v1/admin/accounts/:email/name': ANY_ADMIN,
  'POST /v1/admin/session/start': ANY_ADMIN,
  'POST /v1/admin/session/resume': ANY_ADMIN,
  'POST /v1/admin/session/heartbeat': ANY_ADMIN,
  'POST /v1/admin/session/end': ANY_ADMIN,
  'GET /v1/admin/activity': 'activity.view',
  'GET /v1/admin/accounts': 'accounts.view',
  'POST /v1/admin/accounts': 'accounts.manage',
  'POST /v1/admin/accounts/:email': 'accounts.manage',
  'POST /v1/admin/accounts/:email/remove': 'accounts.manage',
  'GET /v1/admin/notify/settings': 'notifications.view',
  'POST /v1/admin/notify/settings': 'notifications.manage',
  'GET /v1/admin/notify/me': ANY_ADMIN,
  'POST /v1/admin/notify/me': ANY_ADMIN,
  'GET /v1/admin/notify/status': 'notifications.view',
  'POST /v1/admin/notify/outbox/:id/dismiss': 'notifications.manage',
  'POST /v1/admin/diag/echo': 'system.manage',
  'POST /v1/admin/diag/housekeeping': 'system.manage',
  'POST /v1/admin/diag/event-fixture': 'system.manage',
  'POST /v1/admin/diag/retention': 'system.manage',
  'POST /v1/admin/diag/gmail-health': 'system.manage',
  'POST /v1/admin/diag/mail-sample': 'system.manage',
  'GET /v1/admin/diag/book-news': 'system.view',
  'GET /v1/admin/publish/status': 'system.view',
  'POST /v1/admin/publish/shadow-check': 'system.manage',
  'GET /v1/admin/publish/revisions': 'publish.publish',
  'POST /v1/admin/publish/restore': 'publish.publish',
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
  'POST /v1/admin/book/claims/:id/reject': ['bookings.approve', 'finance.manage'],
  'GET /v1/admin/book/summary': 'bookings.view',
  'GET /v1/admin/book/export': 'exports.export',
  'GET /v1/admin/book/report': 'exports.export',
  'GET /v1/admin/book/events/:id/handovers': 'finance.view',
  'GET /v1/admin/book/finance': 'finance.view',
  'GET /v1/admin/book/events/:id/reminders': 'bookings.view',
  'POST /v1/admin/book/events/:id/reminders': 'bookings.edit',
  'POST /v1/admin/book/events/:id/handovers': 'finance.manage',
  'POST /v1/admin/book/handovers/:id/void': 'finance.manage'
});

/*
 * Routes whose handler limits itself to the admin's own servant (ctx.perm.servantId).
 * Every other route needs scope 'all', so an 'own' grant never reaches a handler that ignores it.
 */
export const OWN_SCOPE_ROUTES = Object.freeze(['POST /v1/admin/book/bookings']);

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

/* 'all' | 'own' | '' — what the signed-in admin holds of `perm` (never throws denied) */
export async function heldScope(ctx, perm) {
  const a = await loadAccess(ctx);
  if (a.primary) return 'all';
  if (a.grants.has(perm)) return a.grants.get(perm);
  return !a.enforce && !PRIMARY_DEFAULT.includes(perm) ? 'all' : '';
}

/* The route-level check (index.js): an unmapped admin route is denied while enforcing. */
export async function requireRoutePerm(ctx, route) {
  const key = route.method + ' ' + route.path;
  const perm = ROUTE_PERMS[key];
  if (perm !== undefined) return requirePerm(ctx, perm, { scope: OWN_SCOPE_ROUTES.includes(key) ? 'own' : 'all' });
  const a = await loadAccess(ctx);
  if (a.enforce && !a.primary) throw new ApiError('denied', 'route unmapped');
  return null;
}

/*
 * The grants as Apps Script reads them (POST /v1/sync/grants; apps-script/Grants.gs):
 * active admins only, each admin's grants as one letter per catalog entry
 * ('A' all, 'O' own, '-' none) so the last-good copy fits one Script Property.
 * `adminsSyncTs`: the last allowlist push from Apps Script D1 accepted (the mirror's guard).
 */
export async function grantsSnapshot(db) {
  const [admins, grants, settings] = await retry(() => db.batch([
    db.prepare('SELECT email, name, role, servant_id FROM admins WHERE active = 1 ORDER BY email'),
    db.prepare('SELECT g.email, g.perm, g.scope FROM admin_grants g JOIN admins a ON a.email = g.email AND a.active = 1'),
    db.prepare("SELECT key, value FROM settings WHERE key IN ('PERMS_ENFORCE', 'SYNC_TS_admins')")
  ]));
  const by = new Map();
  for (const g of grants.results) {
    if (!by.has(g.email)) by.set(g.email, new Map());
    by.get(g.email).set(g.perm, g.scope === 'own' ? 'O' : 'A');
  }
  const set = Object.fromEntries(settings.results.map(r => [r.key, r.value]));
  return {
    v: 1,
    enforce: set.PERMS_ENFORCE === '1',
    adminsSyncTs: Number(set.SYNC_TS_admins) || 0,
    perms: PERMS,
    primaryDefault: PRIMARY_DEFAULT,
    admins: admins.results.map(a => {
      const mine = by.get(a.email) || new Map();
      return { email: a.email, name: a.name || '', primary: a.role === 'primary', servantId: a.servant_id || null, g: PERMS.map(p => mine.get(p) || '-').join('') };
    })
  };
}
