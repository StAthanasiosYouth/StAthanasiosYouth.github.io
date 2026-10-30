/*
 * Route table. Each route: method, path (":id" params), auth ('public' |
 * 'admin' | 'sync'), raw (an upload body, with maxBytes) — everything else is
 * JSON. Booking routes join here in the pilot, behind the BOOKING_MODULE
 * switch (settings table).
 */

import { ApiError, fileResponse } from './lib/http.js';
import { queryActivity, activityStmt, forwardedStmt } from './lib/activity.js';
import { begin, finishStmt, abandon, idempotencyKey } from './lib/idempotency.js';
import { limit, clientIp } from './lib/ratelimit.js';
import { retry } from './lib/db.js';
import { sha256Bytes } from './lib/hash.js';
import { putProof, readProof, deleteProof, sweepProofs } from './lib/proofs.js';
import { PROOF_MAX_BYTES } from './lib/image.js';
import { verifySync, syncStampStmt } from './lib/sync.js';
import { grantsSnapshot } from './lib/perms.js';
import { accountsList, accountAdd, accountUpdate, accountRemove } from './lib/accounts.js';
import { sessionStart, sessionResume, sessionRenew, sessionEnd, sessionPark, sessionHeartbeat, syncSession } from './admin/session.js';
import { deviceTrust, deviceForget, deviceSignIn } from './admin/devices.js';
import { adminMe, adminRename } from './admin/me.js';
import { notifyClaim } from './notify/claim.js';
import { tokenHealth } from './notify/email.js';
import { diagMailSample } from './notify/samples.js';
import { bookPayRequest, bookPayRequestWithdraw, adminClaimReject } from './book/claims.js';
import { notifySettingsGet, notifySettingsSave, notifyMeGet, notifyMeSave, notifyStatus, notifyDismiss } from './notify/settings.js';
import { housekeeping, blankPhones } from './scheduled.js';
import { makeJob } from './jobs.js';
import { bookState, bookProof, bookSubmit, bookStatus, bookWithdraw } from './book/public.js';
import {
  adminModule, adminModuleSet, adminEvents, adminEventRefresh, adminBookings, adminBooking, adminCreate, adminConfirm,
  adminReject, adminCancel, adminReopen, adminUpdate, adminPaymentAdd, adminPaymentVoid, adminCancelAll, adminSummary, adminExport, adminReport, adminLock, adminUnlock, proofTarget, adminHandovers, adminHandoverAdd, adminHandoverVoid, adminFinance, adminReminders, adminReminderAdd
} from './book/admin.js';
import { rowFromJson, saveRow } from './book/event.js';
import { syncBookNews, diagNews } from './book/news.js';
import { syncPayDest, bookPay } from './book/pay.js';
import { syncPublish, publicContent, publicPage, publicEvent, publicComp, publicIcs, PUBLISH_MAX_BYTES } from './publish.js';
import { shadowCheck, shadowStatus } from './publish-shadow.js';
import { mirrorStatus } from './publish-mirror.js';
import { publishRevisions, publishRestore } from './publish-restore.js';
import { syncContentImport, syncContentExport, syncContentNotify, adminDrafts, adminDraftsExport, adminDraftsStatus, adminReviewInput, IMPORT_MAX_BYTES } from './content/routes.js';
import { adminContentCall, adminMediaUpload, MEDIA_UPLOAD_MAX_BYTES } from './content/runtime.js';
import { syncCompSig } from './content/comps.js';
import { syncMediaCopy, adminMediaStatus } from './content/media.js';
import { accountConfig, accountSignin, accountRegisterStart, accountRegisterVerify, accountMe, accountLogout, accountForgot, accountForgotVerify } from './account/routes.js';

/* GET /v1/admin/publish/status — the last publishes + the shadow gate (docs/PUBLISH-SEPARATION-PLAN.md P2-2) */
async function publishStatus(ctx) {
  return { ...(await shadowStatus(ctx.env.DB)), mirror: await mirrorStatus(ctx.env) };
}

/* POST /v1/admin/publish/shadow-check { seed } — one comparison now (seed: copy files D1 lacks from the site) */
async function publishShadowCheck(ctx) {
  await limit(ctx, 'publish.shadow', ctx.actor.email, 6, 60);
  return shadowCheck(ctx.env, { fetchImpl: ctx.fetch, seed: ctx.body && ctx.body.seed === true, settle: false });
}

export const VERSION = '0.3.0';

async function health(ctx) {
  return { service: 'athanasios-api', env: ctx.env.ENVIRONMENT || 'unknown', version: VERSION, colo: ctx.colo, time: Date.now() };
}

async function healthDeep(ctx) {
  await limit(ctx, 'health', clientIp(ctx.request), 30, 60);
  const t0 = Date.now();
  const db = await retry(() => ctx.env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM d1_migrations) AS migrations, (SELECT COUNT(*) FROM admins WHERE active = 1) AS admins, (SELECT value FROM settings WHERE key = 'SYNC_TS_admins') AS adminsSync"
  ).first()).catch(() => null);
  const dbMs = Date.now() - t0;
  let storage = 'not-configured';
  if (ctx.env.PROOFS) {
    // a read of a key that never exists: proves the binding and permission, writes nothing
    try { await ctx.env.PROOFS.head('health/never-exists'); storage = 'ok'; } catch { storage = 'error'; }
  }
  return {
    db: db ? { ok: true, ms: dbMs, migrations: db.migrations } : { ok: false },
    admins: db ? { active: db.admins, syncedAt: db.adminsSync ? Number(db.adminsSync) : null } : null,
    storage,
    queue: ctx.env.JOBS ? 'bound' : 'not-configured',
    googleClient: !!ctx.env.GOOGLE_CLIENT_ID,
    version: VERSION
  };
}

async function whoami(ctx) {
  return { email: ctx.actor.email, name: ctx.actor.name, role: ctx.actor.role };
}

/* GET /v1/admin/activity?limit&before&actor&family&section&from&to&id&view=log — the unified «سجل النشاط» (lib/activity.js) */
async function activity(ctx) {
  const q = Object.fromEntries(['limit', 'before', 'actor', 'family', 'section', 'from', 'to', 'id', 'view'].map(k => [k, ctx.url.searchParams.get(k) || '']));
  return retry(() => queryActivity(ctx.env.DB, q));
}

/*
 * Diagnostics for the foundation (admin only): one idempotent write — an
 * activity row + a background job — exactly once per Idempotency-Key.
 */
async function diagEcho(ctx) {
  const key = idempotencyKey(ctx.request);
  const scope = 'diag.echo:' + ctx.actor.email;
  const started = await begin(ctx.env.DB, scope, key, ctx.body);
  if (started.replay) return { __replay: started.replay };
  try {
    const ref = key.slice(0, 40);
    const body = { echo: String(ctx.body.note || '').slice(0, 80), ref };
    await retry(() => ctx.env.DB.batch([
      activityStmt(ctx.env.DB, { id: 'act-e' + ref.replace(/[^A-Za-z0-9]/g, '').slice(0, 30), orIgnore: true, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'diag.echo', summary: 'foundation check' }),
      finishStmt(ctx.env.DB, started.claim, 200, { ok: true, ...body })
    ]));
    if (ctx.env.JOBS) ctx.defer(ctx.env.JOBS.send(makeJob('diag.ping', { ref })));
    return body;
  } catch (err) {
    await abandon(ctx.env.DB, started.claim).catch(() => {});
    throw err;
  }
}

/* ---------------- private proofs (R2) ---------------- */

const TEST_RETENTION_MAX_MS = 24 * 3600 * 1000;

/*
 * POST /v1/admin/proofs?purpose=test   body: the image bytes (webp/jpeg)
 * Until the booking pilot, only `test` proofs can be uploaded here; the
 * booking routes will call putProof() themselves with a booking/payment id.
 */
async function proofUpload(ctx) {
  await limit(ctx, 'proof.upload', ctx.actor.email, 60, 60);
  const key = idempotencyKey(ctx.request);
  const purpose = ctx.url.searchParams.get('purpose') || '';
  if (!['test', 'booking', 'payment'].includes(purpose)) throw new ApiError('bad', 'purpose');
  // a booking's proof: kept until the event's end + 60 days (EVENTS.md §10)
  const target = purpose === 'test' ? null : await proofTarget(ctx, ctx.url.searchParams.get('bookingId'));

  // staging only: a short retention so the cleanup can be tested
  let deleteAfterMs = target ? target.deleteAfterMs : null;
  const testRetention = Number(ctx.request.headers.get('x-test-retention-ms') || 0);
  if (testRetention) {
    if (ctx.env.ENVIRONMENT !== 'staging' || testRetention < 0 || testRetention > TEST_RETENTION_MAX_MS) throw new ApiError('bad', 'x-test-retention-ms');
    deleteAfterMs = Date.now() + testRetention;
  }

  const started = await begin(ctx.env.DB, 'proof.upload:' + ctx.actor.email, key, { sha: await sha256Bytes(ctx.raw), purpose, testRetention, bookingId: target ? target.bookingId : null });
  if (started.replay) return { __replay: started.replay };
  try {
    const out = await putProof(ctx.env, {
      bytes: ctx.raw, purpose, bookingId: target ? target.bookingId : null, by: ctx.actor.email, deleteAfterMs,
      extra: ({ proof, duplicates }) => [
        activityStmt(ctx.env.DB, { actor: ctx.actor.email, actorName: ctx.actor.name, action: 'proof.upload', entityType: 'proof', entityId: proof.id, summary: purpose + ' · ' + proof.bytes + ' bytes' }),
        finishStmt(ctx.env.DB, started.claim, 200, { ok: true, proof, duplicates })
      ]
    });
    return out;
  } catch (err) {
    await abandon(ctx.env.DB, started.claim).catch(() => {});
    throw err;
  }
}

/* GET /v1/admin/proofs/:id → the bytes, streamed; no public URL ever exists */
async function proofRead(ctx) {
  await limit(ctx, 'proof.read', ctx.actor.email, 300, 60);
  const { row, obj } = await readProof(ctx.env, ctx.params.id);
  return { __response: fileResponse(ctx, obj.body, { contentType: row.mime, length: row.bytes, filename: row.id + (row.mime === 'image/webp' ? '.webp' : '.jpg') }) };
}

/* DELETE /v1/admin/proofs/:id → file gone, row kept with deleted_at */
async function proofDelete(ctx) {
  const out = await deleteProof(ctx.env, ctx.params.id, ctx.actor.email);
  if (out.deleted) {
    await retry(() => activityStmt(ctx.env.DB, { actor: ctx.actor.email, actorName: ctx.actor.name, action: 'proof.delete', entityType: 'proof', entityId: out.proof.id, summary: out.proof.purpose }).run());
  }
  return out;
}

/* POST /v1/admin/diag/housekeeping → what the daily cron does, now */
async function diagHousekeeping(ctx) {
  await limit(ctx, 'housekeeping', ctx.actor.email, 6, 60);
  const opts = {};
  if (ctx.env.ENVIRONMENT === 'staging' && ctx.body && Number.isFinite(ctx.body.orphanAgeMs)) opts.orphanAgeMs = Math.max(0, ctx.body.orphanAgeMs);
  const removed = await housekeeping(ctx.env);
  const proofs = await sweepProofs(ctx.env, opts);
  return { removed, proofs };
}

/* ---------------- Apps Script → Worker sync ---------------- */

const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;

/*
 * POST /v1/sync/admins  (signed by Apps Script, lib/sync.js)
 * body: { admins: [{ email, name, primary }] }
 * Phase 1.5: D1 owns admins + grants («الصلاحيات», lib/accounts.js) and Apps
 * Script mirrors D1 (apps-script/Grants.gs). An older Apps Script still pushing
 * here only refreshes the names of existing rows (and, on a D1 without any
 * Primary Admin yet, marks the listed primary): it never adds, removes,
 * re-activates or demotes anyone.
 */
async function syncAdmins(ctx) {
  await limit(ctx, 'sync', clientIp(ctx.request), 30, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { body, ts } = await verifySync(ctx.env, ctx.request, raw, 'admins');
  const list = Array.isArray(body.admins) ? body.admins : null;
  if (!list || !list.length || list.length > 50) throw new ApiError('bad', 'admins');
  const admins = list.map(a => ({ email: String(a.email || '').trim().toLowerCase(), name: String(a.name || '').slice(0, 80), primary: a.primary === true }));
  if (admins.some(a => !EMAIL_RE.test(a.email))) throw new ApiError('bad', 'email');
  if (admins.filter(a => a.primary).length > 1) throw new ApiError('bad', 'primary');

  const db = ctx.env.DB;
  const stmts = admins.filter(a => a.name).map(a => db.prepare('UPDATE admins SET name = ? WHERE email = ?').bind(a.name, a.email));
  const primary = admins.find(a => a.primary);
  if (primary) stmts.push(db.prepare("UPDATE admins SET role = 'primary' WHERE email = ? AND active = 1 AND NOT EXISTS (SELECT 1 FROM admins WHERE role = 'primary')").bind(primary.email));
  stmts.push(syncStampStmt(db, 'admins', ts));
  stmts.push(activityStmt(db, { actor: 'apps-script', action: 'admins.sync', entityType: 'admins', summary: admins.length + ' listed (names only)', source: 'apps-script' }));
  await retry(() => db.batch(stmts));
  return { active: await retry(() => db.prepare('SELECT COUNT(*) AS n FROM admins WHERE active = 1').first('n')) };
}

/*
 * POST /v1/sync/grants  (signed by Apps Script, lib/sync.js) → the grants snapshot
 * D1 owns admins + grants from Phase 1.5 (BOOKING-PHASE1-COMPLETION-PLAN §4.3): Apps
 * Script pulls this, caches it 60 s, keeps a last-good copy (apps-script/Grants.gs).
 */
async function syncGrants(ctx) {
  await limit(ctx, 'sync.grants', clientIp(ctx.request), 120, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { ts } = await verifySync(ctx.env, ctx.request, raw, 'grants');
  await retry(() => syncStampStmt(ctx.env.DB, 'grants', ts).run());
  return grantsSnapshot(ctx.env.DB);
}

/*
 * POST /v1/sync/activity  (signed by Apps Script; apps-script/WorkerSync.gs activityForward_)
 * body: { rows: [{ id, at, cairo, actor, actorName, action, type, entityId, title, summary, changes, ref, count, device, severity }] }
 * Upserts by id (lib/activity.js forwardedStmt): resends and merged rows never duplicate.
 */
const ACT_ID = /^act-[0-9a-f]{12}$/;
const ACT_NAME = /^[a-z][a-zA-Z._]{1,59}$/;
async function syncActivity(ctx) {
  await limit(ctx, 'sync.activity', clientIp(ctx.request), 60, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { body, ts } = await verifySync(ctx.env, ctx.request, raw, 'activity');
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows || rows.length > 250) throw new ApiError('bad', 'rows');
  for (const r of rows) {
    if (!r || !ACT_ID.test(String(r.id)) || !Number.isFinite(Number(r.at)) || Number(r.at) <= 0 || !ACT_NAME.test(String(r.action)) || !r.actor) throw new ApiError('bad', 'row');
    r.at = Number(r.at);
  }
  const db = ctx.env.DB;
  await retry(() => db.batch([...rows.map(r => forwardedStmt(db, r)), syncStampStmt(db, 'activity', ts)]));
  return { stored: rows.length };
}

/*
 * STAGING ONLY: the hourly Gmail token check, now. simulate: 'revoked' runs it with a
 * refresh token Google refuses (as after a password change) — the real secret is
 * never touched; the next plain call (or the next hour) restores the health.
 */
async function diagGmailHealth(ctx) {
  if (ctx.env.ENVIRONMENT !== 'staging') throw new ApiError('notfound');
  const simulate = ctx.body && ctx.body.simulate === 'revoked';
  return { simulated: simulate, health: await tokenHealth(simulate ? { ...ctx.env, GMAIL_REFRESH_TOKEN: 'revoked-rehearsal' } : ctx.env) };
}

/* STAGING ONLY: store an event definition directly (tests own it; the site is never read for it) */
async function diagEventFixture(ctx) {
  if (ctx.env.ENVIRONMENT !== 'staging') throw new ApiError('notfound');
  const row = rowFromJson(ctx.body, 'fixture');
  if (row.withdrawn) throw new ApiError('bad', 'withdrawn');
  await saveRow(ctx.env, row);
  return { id: row.id, slug: row.slug, online: !!row.online };
}

/*
 * STAGING ONLY: the phone retention (scheduled.js blankPhones) for ONE event,
 * as if run at `atMs` — so the 12-month rule is checked without waiting.
 */
async function diagRetention(ctx) {
  if (ctx.env.ENVIRONMENT !== 'staging') throw new ApiError('notfound');
  const eventId = String(ctx.body.eventId || '');
  if (!/^evt-[a-z0-9-]{2,60}$/.test(eventId)) throw new ApiError('bad', 'eventId');
  const at = Number(ctx.body.atMs);
  if (!Number.isFinite(at)) throw new ApiError('bad', 'atMs');
  return { blanked: await blankPhones(ctx.env, at, { eventId }) };
}

export const ROUTES = [
  { method: 'GET', path: '/v1/health', auth: 'public', handler: health },
  { method: 'GET', path: '/v1/health/deep', auth: 'public', handler: healthDeep },
  { method: 'GET', path: '/v1/admin/whoami', auth: 'admin', handler: whoami },
  { method: 'GET', path: '/v1/admin/activity', auth: 'admin', handler: activity },
  { method: 'POST', path: '/v1/admin/diag/echo', auth: 'admin', handler: diagEcho },
  { method: 'POST', path: '/v1/admin/diag/housekeeping', auth: 'admin', handler: diagHousekeeping },
  { method: 'POST', path: '/v1/admin/proofs', auth: 'admin', raw: true, maxBytes: PROOF_MAX_BYTES, handler: proofUpload },
  { method: 'GET', path: '/v1/admin/proofs/:id', auth: 'admin', handler: proofRead },
  { method: 'DELETE', path: '/v1/admin/proofs/:id', auth: 'admin', handler: proofDelete },
  { method: 'GET', path: '/v1/admin/accounts', auth: 'admin', handler: accountsList },
  { method: 'POST', path: '/v1/admin/accounts', auth: 'admin', maxBytes: 8 * 1024, handler: accountAdd },
  { method: 'POST', path: '/v1/admin/accounts/:email', auth: 'admin', maxBytes: 8 * 1024, handler: accountUpdate },
  { method: 'POST', path: '/v1/admin/accounts/:email/remove', auth: 'admin', handler: accountRemove },
  { method: 'POST', path: '/v1/admin/accounts/:email/name', auth: 'admin', maxBytes: 1024, handler: adminRename },
  { method: 'GET', path: '/v1/admin/me', auth: 'admin', handler: adminMe },

  // Phase 3 admin platform (admin/session.js, docs/ADMIN-PLATFORM-PLAN.md): off until ADMIN_PLATFORM = '1'
  { method: 'POST', path: '/v1/admin/session/start', auth: 'admin', anySession: true, maxBytes: 2048, handler: sessionStart },
  { method: 'POST', path: '/v1/admin/session/resume', auth: 'admin', anySession: true, maxBytes: 2048, handler: sessionResume },
  { method: 'POST', path: '/v1/admin/session/heartbeat', auth: 'admin', needSession: true, maxBytes: 4096, handler: sessionHeartbeat },
  { method: 'POST', path: '/v1/admin/session/renew', auth: 'admin', anySession: true, maxBytes: 1024, handler: sessionRenew },
  { method: 'POST', path: '/v1/admin/session/end', auth: 'admin', anySession: true, handler: sessionEnd },
  { method: 'POST', path: '/v1/admin/devices/trust', auth: 'admin', anySession: true, maxBytes: 1024, handler: deviceTrust },
  { method: 'POST', path: '/v1/admin/devices/forget', auth: 'admin', anySession: true, maxBytes: 1024, handler: deviceForget },
  { method: 'POST', path: '/v1/public/device/sign-in', auth: 'public', maxBytes: 2048, handler: deviceSignIn },
  { method: 'POST', path: '/v1/admin/session/park', auth: 'public', raw: true, maxBytes: 4096, handler: sessionPark },
  { method: 'POST', path: '/v1/sync/session', auth: 'sync', raw: true, maxBytes: 4096, handler: syncSession },
  { method: 'GET', path: '/v1/admin/notify/settings', auth: 'admin', handler: notifySettingsGet },
  { method: 'POST', path: '/v1/admin/notify/settings', auth: 'admin', maxBytes: 64 * 1024, handler: notifySettingsSave },
  { method: 'GET', path: '/v1/admin/notify/me', auth: 'admin', handler: notifyMeGet },
  { method: 'POST', path: '/v1/admin/notify/me', auth: 'admin', maxBytes: 32 * 1024, handler: notifyMeSave },
  { method: 'GET', path: '/v1/admin/notify/status', auth: 'admin', handler: notifyStatus },
  { method: 'POST', path: '/v1/admin/notify/outbox/:id/dismiss', auth: 'admin', handler: notifyDismiss },
  { method: 'POST', path: '/v1/sync/admins', auth: 'sync', raw: true, maxBytes: 16 * 1024, handler: syncAdmins },
  { method: 'POST', path: '/v1/admin/diag/event-fixture', auth: 'admin', handler: diagEventFixture },
  { method: 'POST', path: '/v1/admin/diag/gmail-health', auth: 'admin', handler: diagGmailHealth },
  { method: 'POST', path: '/v1/admin/diag/mail-sample', auth: 'admin', handler: diagMailSample },
  { method: 'POST', path: '/v1/admin/diag/retention', auth: 'admin', handler: diagRetention },
  { method: 'GET', path: '/v1/admin/diag/book-news', auth: 'admin', handler: diagNews },
  { method: 'POST', path: '/v1/sync/book-news', auth: 'sync', raw: true, maxBytes: 4 * 1024, handler: syncBookNews },
  { method: 'POST', path: '/v1/sync/notify-claim', auth: 'sync', raw: true, maxBytes: 32 * 1024, handler: notifyClaim },
  { method: 'POST', path: '/v1/sync/activity', auth: 'sync', raw: true, maxBytes: 512 * 1024, handler: syncActivity },
  { method: 'POST', path: '/v1/sync/grants', auth: 'sync', raw: true, maxBytes: 1024, handler: syncGrants },
  { method: 'POST', path: '/v1/sync/pay-dest', auth: 'sync', raw: true, maxBytes: 64 * 1024, handler: syncPayDest },

  // published content (Phase 2, docs/PUBLISH-SEPARATION-PLAN.md §5)
  { method: 'POST', path: '/v1/sync/publish', auth: 'sync', raw: true, maxBytes: PUBLISH_MAX_BYTES, handler: syncPublish },
  { method: 'GET', path: '/v1/public/content', auth: 'public', handler: publicContent },
  { method: 'GET', path: '/v1/public/page/:slug', auth: 'public', handler: publicPage },
  { method: 'GET', path: '/v1/public/event/:slug', auth: 'public', handler: publicEvent },
  { method: 'GET', path: '/v1/public/comp/:slug', auth: 'public', handler: publicComp },
  { method: 'GET', path: '/v1/public/ics', auth: 'public', handler: publicIcs },
  { method: 'GET', path: '/v1/admin/publish/status', auth: 'admin', handler: publishStatus },
  { method: 'POST', path: '/v1/admin/publish/shadow-check', auth: 'admin', handler: publishShadowCheck },
  { method: 'GET', path: '/v1/admin/publish/revisions', auth: 'admin', handler: publishRevisions },
  { method: 'POST', path: '/v1/admin/publish/restore', auth: 'admin', maxBytes: 1024, handler: publishRestore },

  // Phase 4 — content drafts in D1 (docs/CONTENT-MIGRATION-PLAN.md)
  { method: 'POST', path: '/v1/sync/content-import', auth: 'sync', raw: true, maxBytes: IMPORT_MAX_BYTES, handler: syncContentImport },
  { method: 'POST', path: '/v1/sync/content-export', auth: 'sync', raw: true, maxBytes: 1024, handler: syncContentExport },
  { method: 'POST', path: '/v1/sync/content-notify', auth: 'sync', raw: true, maxBytes: 1024, handler: syncContentNotify },
  { method: 'GET', path: '/v1/admin/content/drafts', auth: 'admin', handler: adminDrafts },
  { method: 'GET', path: '/v1/admin/content/export', auth: 'admin', handler: adminDraftsExport },
  { method: 'GET', path: '/v1/admin/content/status', auth: 'admin', handler: adminDraftsStatus },
  { method: 'POST', path: '/v1/admin/content/call', auth: 'admin', needSession: true, maxBytes: 256 * 1024, handler: adminContentCall },
  { method: 'POST', path: '/v1/sync/comp-sig', auth: 'sync', raw: true, maxBytes: 1024, handler: syncCompSig },
  { method: 'POST', path: '/v1/admin/media/upload', auth: 'admin', needSession: true, maxBytes: MEDIA_UPLOAD_MAX_BYTES, handler: adminMediaUpload },
  { method: 'POST', path: '/v1/sync/media-copy', auth: 'sync', raw: true, maxBytes: MEDIA_UPLOAD_MAX_BYTES, handler: syncMediaCopy },
  { method: 'GET', path: '/v1/admin/content/media-status', auth: 'admin', handler: adminMediaStatus },
  { method: 'GET', path: '/v1/admin/content/review-input', auth: 'admin', handler: adminReviewInput },

  // Phase 5 — youth accounts (account/routes.js, docs/YOUTH-ACCOUNTS-PLAN.md): off until accounts_mode = 'on'
  { method: 'GET', path: '/v1/account/config', auth: 'public', handler: accountConfig },
  { method: 'POST', path: '/v1/account/signin', auth: 'public', maxBytes: 8 * 1024, handler: accountSignin },
  { method: 'POST', path: '/v1/account/register/start', auth: 'public', maxBytes: 8 * 1024, handler: accountRegisterStart },
  { method: 'POST', path: '/v1/account/register/verify', auth: 'public', maxBytes: 1024, handler: accountRegisterVerify },
  { method: 'GET', path: '/v1/account/me', auth: 'public', handler: accountMe },
  { method: 'POST', path: '/v1/account/logout', auth: 'public', maxBytes: 1024, handler: accountLogout },
  { method: 'POST', path: '/v1/account/forgot', auth: 'public', maxBytes: 4 * 1024, handler: accountForgot },
  { method: 'POST', path: '/v1/account/forgot/verify', auth: 'public', maxBytes: 1024, handler: accountForgotVerify },

  // booking — public (docs/EVENTS.md §6, worker/BOOKING-API.md)
  { method: 'GET', path: '/v1/book/state', auth: 'public', handler: bookState },
  { method: 'POST', path: '/v1/book/proof', auth: 'public', raw: true, maxBytes: PROOF_MAX_BYTES, handler: bookProof },
  { method: 'POST', path: '/v1/book/submit', auth: 'public', maxBytes: 16 * 1024, handler: bookSubmit },
  { method: 'POST', path: '/v1/book/status', auth: 'public', maxBytes: 4 * 1024, handler: bookStatus },
  { method: 'POST', path: '/v1/book/withdraw', auth: 'public', maxBytes: 4 * 1024, handler: bookWithdraw },
  { method: 'POST', path: '/v1/book/pay', auth: 'public', maxBytes: 4 * 1024, handler: bookPay },
  { method: 'POST', path: '/v1/book/pay-request', auth: 'public', maxBytes: 8 * 1024, handler: bookPayRequest },
  { method: 'POST', path: '/v1/book/pay-request/withdraw', auth: 'public', maxBytes: 4 * 1024, handler: bookPayRequestWithdraw },

  // booking — admin
  { method: 'GET', path: '/v1/admin/book/module', auth: 'admin', handler: adminModule },
  { method: 'POST', path: '/v1/admin/book/module', auth: 'admin', handler: adminModuleSet },
  { method: 'GET', path: '/v1/admin/book/events', auth: 'admin', handler: adminEvents },
  { method: 'POST', path: '/v1/admin/book/events/:slug/refresh', auth: 'admin', handler: adminEventRefresh },
  { method: 'POST', path: '/v1/admin/book/events/:id/cancel-all', auth: 'admin', handler: adminCancelAll },
  { method: 'GET', path: '/v1/admin/book/bookings', auth: 'admin', handler: adminBookings },
  { method: 'POST', path: '/v1/admin/book/bookings', auth: 'admin', handler: adminCreate },
  { method: 'GET', path: '/v1/admin/book/bookings/:id', auth: 'admin', handler: adminBooking },
  { method: 'POST', path: '/v1/admin/book/bookings/:id/lock', auth: 'admin', handler: adminLock },
  { method: 'DELETE', path: '/v1/admin/book/bookings/:id/lock', auth: 'admin', handler: adminUnlock },
  { method: 'POST', path: '/v1/admin/book/bookings/:id/confirm', auth: 'admin', handler: adminConfirm },
  { method: 'POST', path: '/v1/admin/book/bookings/:id/reject', auth: 'admin', handler: adminReject },
  { method: 'POST', path: '/v1/admin/book/bookings/:id/cancel', auth: 'admin', handler: adminCancel },
  { method: 'POST', path: '/v1/admin/book/bookings/:id/reopen', auth: 'admin', handler: adminReopen },
  { method: 'POST', path: '/v1/admin/book/bookings/:id/update', auth: 'admin', handler: adminUpdate },
  { method: 'POST', path: '/v1/admin/book/bookings/:id/payments', auth: 'admin', handler: adminPaymentAdd },
  { method: 'POST', path: '/v1/admin/book/claims/:id/reject', auth: 'admin', handler: adminClaimReject },
  { method: 'POST', path: '/v1/admin/book/payments/:id/void', auth: 'admin', handler: adminPaymentVoid },
  { method: 'GET', path: '/v1/admin/book/summary', auth: 'admin', handler: adminSummary },
  { method: 'GET', path: '/v1/admin/book/export', auth: 'admin', handler: adminExport },
  { method: 'GET', path: '/v1/admin/book/report', auth: 'admin', handler: adminReport },
  // per-servant accounting: money handed over to the service (append-only, voidable)
  { method: 'GET', path: '/v1/admin/book/events/:id/handovers', auth: 'admin', handler: adminHandovers },
  { method: 'GET', path: '/v1/admin/book/finance', auth: 'admin', handler: adminFinance },
  { method: 'GET', path: '/v1/admin/book/events/:id/reminders', auth: 'admin', handler: adminReminders },
  { method: 'POST', path: '/v1/admin/book/events/:id/reminders', auth: 'admin', handler: adminReminderAdd },
  { method: 'POST', path: '/v1/admin/book/events/:id/handovers', auth: 'admin', handler: adminHandoverAdd },
  { method: 'POST', path: '/v1/admin/book/handovers/:id/void', auth: 'admin', handler: adminHandoverVoid }
];

const COMPILED = ROUTES.map(r => {
  const names = [];
  const re = new RegExp('^' + r.path.replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
  return { route: r, re, names };
});

/* { route, params } or throws notfound / method */
export function match(method, path) {
  const hits = COMPILED.map(c => ({ c, m: c.re.exec(path) })).filter(x => x.m);
  if (!hits.length) throw new ApiError('notfound');
  const hit = hits.find(x => x.c.route.method === method);
  if (!hit) throw new ApiError('method');
  const params = {};
  hit.c.names.forEach((n, i) => { params[n] = decodeURIComponent(hit.m[i + 1]); });
  return { route: hit.c.route, params };
}
