/*
 * SHADOW COMPARISON (Phase 2 step 2, docs/PUBLISH-SEPARATION-PLAN.md §6 P2-2)
 *
 * While PUBLISH_MODE='shadow', Apps Script still commits to GitHub and then
 * posts the same files here. Every 15 minutes this reads what GitHub Pages
 * actually serves (content.json, meeting.ics and every page / event /
 * competition content.json lists) and compares it with the live D1 revision:
 *
 *   equal     same sha-256
 *   lag       the site still shows an older D1 revision (Pages build pending)
 *   mismatch  the site shows text D1 never stored
 *   missing   on the site but not in D1 (seed: copied in), or in D1 only
 *   error     the site could not be read
 *
 * One `shadow_checks` row per run; the gate is 1–2 weeks of clean runs
 * (every file equal). It runs only once a publish has been posted, so an
 * environment that never got one (production before P2-2) does nothing.
 */

import { retry } from './lib/db.js';
import { sha256, randomId } from './lib/hash.js';
import { liveStmts, slugOk } from './publish.js';
import { logLine } from './lib/log.js';

export const SHADOW_EVERY_MIN = 15;
const SETTLE_MS = 10 * 60 * 1000;         // a publish younger than this: Pages may still be building
const MAX_FILES = 40;                     // site reads per run (Free: 50 subrequests per invocation)
const DAY = 24 * 3600 * 1000;

/* the files content.json says are published: [{ kind, key, path }] */
export function shadowTargets(content) {
  const out = [{ kind: 'content', key: 'site', path: 'content.json' }, { kind: 'ics', key: 'site', path: 'meeting.ics' }];
  const list = (arr, kind, path) => (Array.isArray(arr) ? arr : []).forEach(x => {
    const slug = x && typeof x.slug === 'string' ? x.slug : '';
    if (slugOk(slug)) out.push({ kind, key: slug, path: path(slug) });
  });
  list(content.pages, 'page', s => `${s}/page.json`);
  list(content.events, 'event', s => `events/${s}/event.json`);
  list(content.competitions, 'comp', s => `competition/${s}/comp.json`);
  return out;
}

async function readSite(env, fetchImpl, path, now) {
  const site = String(env.SITE_URL || 'https://stathanasiosyouth.github.io').replace(/\/$/, '');
  const res = await fetchImpl(`${site}/${path}?shadow=${now}`, { headers: { 'user-agent': 'athanasios-api' }, cf: { cacheTtl: 0 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

/*
 * One comparison run. seed: files the site has and D1 doesn't are stored as
 * live revisions (publish id 'seed-…'), so a first shadow period starts from
 * the whole site, not only from what later publishes happen to touch.
 */
export async function shadowCheck(env, { now = Date.now(), fetchImpl = fetch, seed = false, settle = true } = {}) {
  const db = env.DB;
  const jobs = await retry(() => db.prepare("SELECT COUNT(*) AS n, MAX(at) AS last FROM publish_jobs WHERE mode <> 'seed'").first());
  if (!seed && !jobs.n) return { skipped: 'no publish posted yet' };
  if (settle && jobs.last && now - jobs.last < SETTLE_MS) return { skipped: 'a publish is settling' };

  const files = [];
  let content;
  try {
    const text = await readSite(env, fetchImpl, 'content.json', now);
    content = text == null ? null : JSON.parse(text);
    if (!content) throw new Error('no content.json');
    files.push({ ...shadowTargets({})[0], text });
  } catch (err) {
    return record(db, now, [{ kind: 'content', key: 'site', state: 'error', note: String(err.message).slice(0, 80) }], 0);
  }
  const targets = shadowTargets(content).slice(1);
  const truncated = targets.length > MAX_FILES - 1;
  for (const t of targets.slice(0, MAX_FILES - 1)) {
    try { files.push({ ...t, text: await readSite(env, fetchImpl, t.path, now) }); }
    catch (err) { files.push({ ...t, error: String(err.message).slice(0, 80) }); }
  }

  const all = await retry(() => db.prepare(
    "SELECT kind, key, rev, hash, live FROM published_revisions WHERE kind IN ('content', 'ics', 'page', 'event', 'comp')"
  ).all());
  const byKey = new Map();
  for (const r of all.results) {
    const k = r.kind + '\u0000' + r.key;
    if (!byKey.has(k)) byKey.set(k, { live: null, hashes: new Set(), rev: 0 });
    const e = byKey.get(k);
    e.hashes.add(r.hash);
    e.rev = Math.max(e.rev, r.rev);
    if (r.live) e.live = r.hash;
  }

  const results = [];
  const toSeed = [];
  for (const f of files) {
    const d1 = byKey.get(f.kind + '\u0000' + f.key);
    const base = { kind: f.kind, key: f.key };
    if (f.error) { results.push({ ...base, state: 'error', note: f.error }); continue; }
    if (f.text == null) { results.push({ ...base, state: 'missing', note: 'listed, not on the site' }); continue; }
    const hash = await sha256(f.text);
    if (!d1 || !d1.live) {
      if (seed) {
        toSeed.push({ id: randomId('rev'), kind: f.kind, key: f.key, rev: (d1 ? d1.rev : 0) + 1, hash, body: f.text, withdrawn: isWithdrawn(f.text) });
        results.push({ ...base, state: 'seeded' });
      } else {
        results.push({ ...base, state: 'missing', note: 'not in D1' });
      }
      continue;
    }
    if (d1.live === hash) results.push({ ...base, state: 'equal' });
    else if (d1.hashes.has(hash)) results.push({ ...base, state: 'lag' });
    else results.push({ ...base, state: 'mismatch', site: hash.slice(0, 12), d1: d1.live.slice(0, 12) });
  }
  if (truncated) results.push({ kind: 'content', key: 'site', state: 'error', note: 'more than ' + MAX_FILES + ' files: the rest not compared' });

  if (toSeed.length) {
    const id = 'seed-' + now;
    const stmts = liveStmts(db, id, 'shadow-seed', now, toSeed);
    stmts.push(db.prepare(
      "INSERT INTO publish_jobs (id, mode, revision, hash, state, files, changed, result, by, at, created_at, updated_at) VALUES (?, 'seed', ?, ?, 'live', ?, ?, '{}', 'shadow-seed', ?, ?, ?)"
    ).bind(id, typeof content.revision === 'string' ? content.revision.slice(0, 80) : null, await sha256(toSeed.map(r => r.hash).join('\n')), toSeed.length, toSeed.length, now, now, now));
    await retry(() => db.batch(stmts));
  }
  return record(db, now, results, toSeed.length);
}

async function record(db, now, results, seeded) {
  const count = s => results.filter(r => r.state === s).length;
  const row = {
    at: now, total: results.length, equal: count('equal'), lag: count('lag'), mismatch: count('mismatch'),
    missing: count('missing'), seeded, errors: count('error')
  };
  const off = results.filter(r => r.state !== 'equal');
  const detail = JSON.stringify(off.slice(0, 60));
  await retry(() => db.prepare(
    'INSERT INTO shadow_checks (at, total, equal, lag, mismatch, missing, seeded, errors, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(row.at, row.total, row.equal, row.lag, row.mismatch, row.missing, row.seeded, row.errors, detail).run());
  logLine({ kind: 'cron', job: 'shadow', ...row });
  return { ...row, clean: row.equal + row.seeded === row.total, detail: off };
}

function isWithdrawn(text) {
  try { const v = JSON.parse(text); return v && v.withdrawn === true ? 1 : 0; } catch { return 0; }
}

/* the gate: since when every run has been clean (seeded counts as clean: it is the starting point) */
export async function shadowStatus(db, now = Date.now()) {
  const [jobs, last, dirty, first] = await Promise.all([
    retry(() => db.prepare('SELECT id, mode, revision, state, files, changed, by, at FROM publish_jobs ORDER BY at DESC LIMIT 10').all()),
    retry(() => db.prepare('SELECT * FROM shadow_checks ORDER BY at DESC LIMIT 1').first()),
    retry(() => db.prepare('SELECT MAX(at) AS at FROM shadow_checks WHERE equal + seeded < total').first()),
    retry(() => db.prepare('SELECT MIN(at) AS at, COUNT(*) AS n FROM shadow_checks').first())
  ]);
  const cleanFrom = dirty && dirty.at
    ? await retry(() => db.prepare('SELECT MIN(at) AS at FROM shadow_checks WHERE at > ?').bind(dirty.at).first('at'))
    : first.at;
  return {
    jobs: jobs.results,
    last: last ? { ...last, detail: JSON.parse(last.detail || '[]') } : null,
    checks: first.n,
    lastDirtyAt: dirty && dirty.at ? dirty.at : null,
    cleanSince: cleanFrom || null,
    cleanDays: cleanFrom ? Math.floor((now - cleanFrom) / DAY * 10) / 10 : 0
  };
}
