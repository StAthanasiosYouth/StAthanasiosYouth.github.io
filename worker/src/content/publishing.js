/*
 * REVIEW AND PUBLISH ON THE WORKER (Phase 4 P4-4 / P4-6, docs/CONTENT-MIGRATION-PLAN.md §9).
 *
 * apiReview / apiPreview / apiPublish run the SAME Publish.gs code as today
 * (reviewNow_, apiPreview, publishNow_) on the drafts held in memory
 * (runtime.js). This module gives that code what it used to fetch:
 *
 *   what is live        the live content.json in published_revisions (workerLiveContent_)
 *   the competitions    their part from Apps Script / comp_package (comps.js; hybrid, one button)
 *   the page shell      pages/index.html from the site's repository (pagesShellText_ cache)
 *   where files go      publishToWorker_ collects them; the caller stores them in the SAME D1
 *                       batch as the drafts' after-publish changes (pages' liveV, Activity) —
 *                       live at once, the GitHub mirror follows in the background
 *   media bytes         none: the library's files go to GitHub when uploaded (P4-5, media.js)
 *
 * One publish at a time: settings.PUBLISH_CLAIM (a claim with an expiry), not a lock.
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { randomId } from '../lib/hash.js';
import { githubConfig, readText } from '../lib/github.js';
import { preparePublish, pathKind } from '../publish.js';
import { makeJob } from '../jobs.js';
import { compPackage, compCommitOf, commitComps } from './comps.js';
import { sha256Sync } from './services.js';
import { runtimePoints } from '../store/shop.js';

export const BUILD_CALLS = new Set(['apiReview', 'apiPreview', 'apiPublish']);

/*
 * Calls whose answer is NOT the panel state (P4-7: every other call answers with apiStateFor_,
 * like Apps Script, so the page redraws exactly as today — that state holds the build's status,
 * hence the same competitions' part as a review).
 */
export const STATE_FREE = new Set([
  'apiServants', 'apiServantSave', 'apiServantSetActive', 'apiPayMethodsSave', 'apiServantPayApprove',
  'apiPages', 'apiPage', 'apiPageSave', 'apiPageSetEnabled', 'apiPageArchive', 'apiPageDelete',
  'apiPageMediaSave', 'apiPageMediaOrder', 'apiPageMediaDelete', 'apiPagePreview',
  'apiEvents', 'apiEvent', 'apiEventSave', 'apiEventSetEnabled', 'apiEventArchive', 'apiEventDelete',
  'apiMediaPreview', 'apiMediaLibrary', 'apiImportPreview'
]);
const CLAIM_MS = 2 * 60 * 1000;
const EMPTY_COMPS = { index: [], live: {}, withdrawn: [], byId: {}, slugs: {}, media: [] };
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();

/*
 * The page shell (pages/index.html, Pages.gs pagesShellText_): kept in D1 (settings PAGES_SHELL,
 * the text with when it was read) so a publish never waits for GitHub; read again in the
 * background after SHELL_FRESH_MS (it changes only when the site's code does).
 */
const SHELL_FRESH_MS = 6 * 3600 * 1000;

async function fetchShell(ctx) {
  const cfg = githubConfig(ctx.env);
  if (cfg.error) return '';
  const text = await readText(cfg, 'pages/index.html', ctx.fetch);
  // kept even when empty (no shell in the repository: Pages.gs uses its built-in copy, as Apps Script did)
  await retry(() => ctx.env.DB.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('PAGES_SHELL', ?, ?, 'worker') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(text || '', Date.now()).run()).catch(() => {});
  return text;
}

async function pageShell(ctx) {
  const row = await retry(() => ctx.env.DB.prepare("SELECT value, updated_at FROM settings WHERE key = 'PAGES_SHELL'").first()).catch(() => null);
  if (row) {
    if (Date.now() - row.updated_at > SHELL_FRESH_MS) ctx.defer(fetchShell(ctx));
    return row.value;
  }
  return fetchShell(ctx);
}

async function release(db, id) {
  await retry(() => db.prepare("UPDATE settings SET value = '' WHERE key = 'PUBLISH_CLAIM' AND value LIKE ?").bind(id + ':%').run()).catch(() => {});
}

/*
 * Before the call: everything the build reads, then the hooks. Returns
 * { statements(), finish(), release() } for runtime.js (null for other calls).
 */
export async function setupBuild(ctx, { fn, g, hooks, services, email }) {
  if (!BUILD_CALLS.has(fn) && STATE_FREE.has(fn)) return null;
  const db = ctx.env.DB;
  const publishing = fn === 'apiPublish';
  const now = Date.now();
  // a publish takes the claim in the same round trip as its reads (released by its own write batch)
  const claimId = publishing ? randomId('pcl-') : null;
  const claimStmt = claimId ? [db.prepare(
    "UPDATE settings SET value = ?, updated_at = ? WHERE key = 'PUBLISH_CLAIM' AND (value = '' OR CAST(substr(value, instr(value, ':') + 1) AS INTEGER) < ?) RETURNING key"
  ).bind(claimId + ':' + (now + CLAIM_MS), now, now)] : [];
  let claimed = false;

  try {
    // the build's own library index, as the competitions' part needs it (Content.gs: mediaIndex_(draft.media))
    const wall = g.cairoNow_();
    const media = g.mediaIndex_(g.readDraft_().media);

    // in parallel: the claim + what is live (every file's hash, the text of content.json only), the
    // competitions' part, the page shell (a publish)
    const [reads, pkg, shell] = await Promise.all([
      retry(() => db.batch([
        ...claimStmt,
        db.prepare('SELECT kind, key, hash FROM published_revisions WHERE live = 1'),
        db.prepare("SELECT body FROM published_revisions WHERE live = 1 AND kind = 'content' AND key = 'site'")
      ])),
      compPackage(ctx, { mode: publishing ? 'publish' : BUILD_CALLS.has(fn) ? 'review' : 'state', now: wall, media, by: email }),
      publishing ? pageShell(ctx) : null
    ]);
    if (claimId) {
      claimed = reads[0].results.length === 1;
      if (!claimed) throw new ApiError('busy', 'a publish is running');
    }
    const [hashes, site] = claimId ? reads.slice(1) : reads;
    if (shell) services.CacheService.getScriptCache().put('pages:shell', shell, 600);
    const liveHash = new Map(hashes.results.map(r => [r.kind + '\u0000' + r.key, r.hash]));
    const liveContent = site.results[0] ? JSON.parse(site.results[0].body) : null;
    hooks.use('workerLiveContent_', () => (liveContent ? JSON.parse(JSON.stringify(liveContent)) : null));
    hooks.use('publishMode_', () => 'worker');
    // nothing live yet = the first publish (the Worker is the truth; GitHub is only its mirror)
    hooks.use('lastPublished_', () => null);
    hooks.use('fetchPublishedContent_', () => null);

    const points = await runtimePoints(ctx.env.DB, pkg.none ? null : pkg.points);
    hooks.use('compDraft_', () => (pkg.none && !points ? null : { points, modules: pkg.modules }));
    hooks.use('compBuildPublic_', (draft, c) => {
      (pkg.errors || []).forEach(e => c.error(e.where, e.message));
      (pkg.warnings || []).forEach(w => c.warn(w.where, w.message));
      return pkg.built ? JSON.parse(JSON.stringify(pkg.built)) : JSON.parse(JSON.stringify(EMPTY_COMPS));
    });
    hooks.use('compReviewInfo_', () => ({ ...(pkg.reviewInfo || {}) }));
    hooks.use('compPublishFiles_', () => ({ ...(pkg.files || {}) }));
    hooks.use('compWriteSnapshots_', () => 0);   // Apps Script wrote them when it prepared the part

    let commit = null;
    let sent = null;
    hooks.use('compAfterCommit_', () => { commit = compCommitOf(pkg); });
    hooks.use('publishClaim_', () => claimId || 'review');
    hooks.use('publishDropClaim_', () => {});
    hooks.use('publishShadow_', () => {});
    hooks.use('mediaForPublish_', () => ({ binaries: {}, ids: [] }));
    hooks.use('githubCommitFiles_', () => { throw new Error('a publish commits no media: the library sends them at upload'); });
    hooks.use('publishToWorker_', (files, revision, at, by) => {
      sent = { files, revision, at, by };
      const unchanged = Object.entries(files).every(([path, text]) => {
        const where = pathKind(path);
        return where && liveHash.get(where.kind + '\u0000' + where.key) === hex(sha256Sync(enc.encode(text)));
      });
      return { unchanged, live: true };
    });
    let mirrorId = null;
    let released = false;
    // the claim ends with the publish's own write batch (no extra round trip)
    const releaseStmt = () => (claimId ? [db.prepare("UPDATE settings SET value = '' WHERE key = 'PUBLISH_CLAIM' AND value LIKE ?").bind(claimId + ':%')] : []);
    return {
      pkg,
      // the revisions this publish stores, in the caller's batch
      async statements() {
        if (!sent) return releaseStmt();
        const prepared = await preparePublish(db, { id: 'pub-' + sent.revision + '-' + sent.at, mode: 'worker', by: sent.by || email, at: sent.at, files: sent.files });
        if (prepared.replayed) return releaseStmt();
        if (prepared.result.changed.length) mirrorId = prepared.result.id;
        return prepared.stmts.concat(releaseStmt());
      },
      // after the batch, never on the admin's wait: the mirror, and Apps Script told what went live
      async finish() {
        released = true;
        if (mirrorId && ctx.env.JOBS) ctx.defer(ctx.env.JOBS.send(makeJob('publish.mirror', { id: mirrorId })));
        if (commit) {
          const stamp = g.nowStamp_();
          ctx.defer(commitComps(ctx, commit, stamp).catch(err => {
            if (ctx.env.JOBS) return ctx.env.JOBS.send(makeJob('comp.commit', { ...commit, stamp }));
            console.warn('comp commit not sent: ' + (err && err.message));
          }));
        }
      },
      // a publish that stopped before its write batch: the claim goes now
      release: () => (claimId && !released ? release(db, claimId) : null)
    };
  } catch (err) {
    // the claim may have been taken in the same batch as a read that failed after it: release ours (only ours)
    if (claimId) await release(db, claimId);
    throw err;
  }
}
