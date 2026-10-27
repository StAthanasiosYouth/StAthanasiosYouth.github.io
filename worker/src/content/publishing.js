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

export const BUILD_CALLS = new Set(['apiReview', 'apiPreview', 'apiPublish']);
const CLAIM_MS = 2 * 60 * 1000;
const EMPTY_COMPS = { index: [], live: {}, withdrawn: [], byId: {}, slugs: {}, media: [] };
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();

let shellCache = { at: 0, text: '' };

async function pageShell(ctx) {
  if (shellCache.text && Date.now() - shellCache.at < 10 * 60 * 1000) return shellCache.text;
  const cfg = githubConfig(ctx.env);
  if (cfg.error) return '';
  const text = await readText(cfg, 'pages/index.html', ctx.fetch);
  if (text) shellCache = { at: Date.now(), text };
  return text;
}

async function claim(db, now) {
  const id = randomId('pcl-');
  const r = await retry(() => db.prepare(
    "UPDATE settings SET value = ?, updated_at = ? WHERE key = 'PUBLISH_CLAIM' AND (value = '' OR CAST(substr(value, instr(value, ':') + 1) AS INTEGER) < ?)"
  ).bind(id + ':' + (now + CLAIM_MS), now, now).run());
  if (!r.meta || r.meta.changes !== 1) throw new ApiError('busy', 'a publish is running');
  return id;
}

async function release(db, id) {
  await retry(() => db.prepare("UPDATE settings SET value = '' WHERE key = 'PUBLISH_CLAIM' AND value LIKE ?").bind(id + ':%').run()).catch(() => {});
}

/*
 * Before the call: everything the build reads, then the hooks. Returns
 * { statements(), finish(), release() } for runtime.js (null for other calls).
 */
export async function setupBuild(ctx, { fn, g, hooks, services, email }) {
  if (!BUILD_CALLS.has(fn)) return null;
  const db = ctx.env.DB;
  const publishing = fn === 'apiPublish';
  const now = Date.now();
  const claimId = publishing ? await claim(db, now) : null;

  try {
    const { results: live } = await retry(() => db.prepare('SELECT kind, key, hash, body FROM published_revisions WHERE live = 1').all());
    const liveHash = new Map(live.map(r => [r.kind + '\u0000' + r.key, r.hash]));
    const siteRow = live.find(r => r.kind === 'content' && r.key === 'site');
    const liveContent = siteRow ? JSON.parse(siteRow.body) : null;
    hooks.use('workerLiveContent_', () => (liveContent ? JSON.parse(JSON.stringify(liveContent)) : null));
    hooks.use('publishMode_', () => 'worker');
    // nothing live yet = the first publish (the Worker is the truth; GitHub is only its mirror)
    hooks.use('lastPublished_', () => null);
    hooks.use('fetchPublishedContent_', () => null);

    // the build's own library index, as the competitions' part needs it (one dry build, nothing written)
    let media = {};
    hooks.use('compDraft_', () => ({ points: null, modules: {} }));
    hooks.use('compBuildPublic_', (draft, c) => { media = c.media || {}; return JSON.parse(JSON.stringify(EMPTY_COMPS)); });
    const wall = g.cairoNow_();
    g.buildPublicContent(g.readDraft_(), { now: wall, hash: g.sha256Hex_ });

    const pkg = await compPackage(ctx, { mode: publishing ? 'publish' : 'review', now: wall, media, by: email });
    hooks.use('compDraft_', () => (pkg.none ? null : { points: pkg.points, modules: pkg.modules }));
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
    if (publishing) {
      const shell = await pageShell(ctx);
      if (shell) services.CacheService.getScriptCache().put('pages:shell', shell, 600);
    }

    let mirrorId = null;
    return {
      pkg,
      // the revisions this publish stores, in the caller's batch
      async statements() {
        if (!sent) return [];
        const prepared = await preparePublish(db, { id: 'pub-' + sent.revision + '-' + sent.at, mode: 'worker', by: sent.by || email, at: sent.at, files: sent.files });
        if (prepared.replayed) return [];
        if (prepared.result.changed.length) mirrorId = prepared.result.id;
        return prepared.stmts;
      },
      // after the batch: the mirror, and Apps Script told what went live
      async finish() {
        if (mirrorId && ctx.env.JOBS) ctx.defer(ctx.env.JOBS.send(makeJob('publish.mirror', { id: mirrorId })));
        if (commit) {
          const stamp = g.nowStamp_();
          try {
            await commitComps(ctx, commit, stamp);
          } catch (err) {
            if (ctx.env.JOBS) await ctx.env.JOBS.send(makeJob('comp.commit', { ...commit, stamp })).catch(() => {});
            else console.warn('comp commit not sent: ' + (err && err.message));
          }
        }
      },
      release: () => (claimId ? release(db, claimId) : null)
    };
  } catch (err) {
    if (claimId) await release(db, claimId);
    throw err;
  }
}
