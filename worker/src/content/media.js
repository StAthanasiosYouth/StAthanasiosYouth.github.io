/*
 * THE MEDIA LIBRARY ON R2 (Phase 4 P4-5, docs/CONTENT-MIGRATION-PLAN.md §10).
 *
 * The library calls (Media.gs apiUploadMedia / apiMediaPreview / apiPurgeMedia …)
 * run unchanged on the Worker (runtime.js); only where the bytes live changes:
 *
 *   driveUpload_(bytes, mime, name)  → R2 'media/<name>' (put BEFORE the D1 batch, so a row
 *                                      never points at a missing file); the row keeps 'r2:<key>'
 *                                      in driveId / thumbDriveId
 *   driveDownloadBase64_(ref)        → the bytes read from R2 before the call (the preview)
 *   drive_('delete', …)              → the R2 object removed after the batch (purge)
 *
 * Upload-time GitHub copy (BACKEND-MIGRATION §8): every stored file with a site path is
 * committed to the site's repository in the background ('media.mirror' job; the publish
 * runs it first for anything still waiting), then the Media row gets publishedAt — a
 * publish never moves bytes.
 *
 * The one-time copy of the Drive library: Apps Script sends each file (signed,
 * POST /v1/sync/media-copy, ContentExport.gs mediaCopy_); checked by SHA-256 (and
 * the row's own hash for a picture), stored, the row pointed at R2.
 */

import { ApiError } from '../lib/http.js';
import { retry, cairoText } from '../lib/db.js';
import { sha256, sha256Bytes } from '../lib/hash.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { verifySync } from '../lib/sync.js';
import { githubConfig, commitFiles } from '../lib/github.js';
import { canonicalRow } from './kinds.js';
import { kindHash } from './store.js';

export const MEDIA_CALLS = new Set(['apiUploadMedia', 'apiMediaLibrary', 'apiUpdateMedia', 'apiDeleteMedia', 'apiRestoreMedia', 'apiPurgeMedia', 'apiMediaPreview', 'apiSetMediaAlt']);
export const MEDIA_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;   // Api.gs API_MAX_BODY: a video + its poster in base64
const NAME_RE = /^[a-z]{3}-[a-z0-9]{8}(?:-480)?\.(?:webp|jpg|mp4|webm|mp3|m4a)$/;
const SITE_PATH_RE = /^media\/\d{4}\/[a-z]{3}-[a-z0-9]{8}(?:-480)?\.(?:webp|jpg|mp4|webm|mp3|m4a)$/;
const MIRROR_BATCH = 20;

const signedToBytes = arr => Uint8Array.from(arr, b => (b < 0 ? b + 256 : b));
const bytesToB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToBytes = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

function bucket(env) {
  if (!env.MEDIA) throw new ApiError('disabled', 'MEDIA bucket not bound');
  return env.MEDIA;
}

/* the R2 key in a row's driveId / thumbDriveId, or '' (a Drive id: not copied yet) */
export function r2Key(ref) {
  const m = /^r2:(media\/[\w.-]+)$/.exec(String(ref || ''));
  return m ? m[1] : '';
}

/*
 * Before the call: the hooks, and the bytes the call may read (the preview).
 * → { beforeBatch(stmts, rowsAfter), afterBatch() } for runtime.js, or null.
 */
export async function setupMedia(ctx, { fn, args, hooks, loaded }) {
  if (!MEDIA_CALLS.has(fn) && fn !== 'apiPublish') return null;
  const env = ctx.env;
  const puts = [];
  const deletes = [];
  const reads = new Map();

  if (fn === 'apiMediaPreview') {
    const row = loaded.rows.media.find(r => r.id === String(args[0] || ''));
    for (const ref of row ? [row.data.thumbDriveId, row.data.driveId] : []) {
      const key = r2Key(ref);
      if (!key || reads.has(ref)) continue;
      const obj = await bucket(env).get(key);
      if (obj) reads.set(ref, bytesToB64(new Uint8Array(await new Response(obj.body).arrayBuffer())));
    }
  }

  hooks.use('driveUpload_', (bytes, mime, name) => {
    if (!NAME_RE.test(String(name))) throw new Error('اسم الملف مش مقبول');
    const key = 'media/' + name;
    puts.push({ key, mime: String(mime), bytes: signedToBytes(bytes) });
    return 'r2:' + key;
  });
  hooks.use('driveDownloadBase64_', ref => {
    if (!reads.has(ref)) throw new Error('ملف الصورة مش موجود');
    return reads.get(ref);
  });
  hooks.use('drive_', (method, url) => {
    // only the purge reaches here (uploads go through driveUpload_ above)
    if (String(method).toLowerCase() !== 'delete') throw new Error('Drive is not used on the Worker');
    const ref = decodeURIComponent(String(url).split('/').pop() || '');
    if (r2Key(ref)) deletes.push(r2Key(ref));
    return { getResponseCode: () => 204, getContentText: () => '' };
  });

  return {
    /* R2 first (a row never points at a missing file), then the media_files rows join the batch */
    async beforeBatch(db, stmts, mediaRows, now) {
      if (!puts.length) return;
      const where = new Map();
      for (const row of mediaRows) {
        if (r2Key(row.driveId)) where.set(r2Key(row.driveId), { id: row.id, part: 'full', site: row.path });
        if (r2Key(row.thumbDriveId)) where.set(r2Key(row.thumbDriveId), { id: row.id, part: 'thumb', site: row.thumb });
      }
      for (const p of puts) {
        const w = where.get(p.key);
        // a file no saved row points at (a refused save): not stored
        if (!w) continue;
        const sha = await sha256Bytes(p.bytes);
        await bucket(env).put(p.key, p.bytes, { httpMetadata: { contentType: p.mime }, customMetadata: { sha256: sha, media: w.id } });
        stmts.push(db.prepare(
          "INSERT INTO media_files (key, media_id, part, mime, bytes, sha256, source, site_path, mirrored_ms, created_ms, deleted_ms) VALUES (?, ?, ?, ?, ?, ?, 'upload', ?, NULL, ?, NULL) " +
          'ON CONFLICT(key) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes, sha256 = excluded.sha256, site_path = excluded.site_path, mirrored_ms = NULL, deleted_ms = NULL'
        ).bind(p.key, w.id, w.part, p.mime, p.bytes.length, sha, SITE_PATH_RE.test(String(w.site || '')) ? w.site : null, now));
      }
    },
    async afterBatch(db, now) {
      for (const key of deletes) {
        await bucket(env).delete(key).catch(() => {});
        await retry(() => db.prepare('UPDATE media_files SET deleted_ms = ? WHERE key = ?').bind(now, key).run());
      }
      if (puts.length && env.JOBS) await env.JOBS.send({ type: 'media.mirror', id: 'job-m' + now, at: now, payload: {} }).catch(() => {});
    }
  };
}

/*
 * A Media row changed outside a call (publishedAt, its R2 refs): rewritten with its hash, version + 1,
 * and the kind's version AND hash (draft_kinds = its rows: store.js kindHash). The batch holds only if
 * no Media row moved since the read (draft_guard on the kind's version); else it is read again.
 */
async function updateMediaRow(db, id, change, by) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [one, all, kind] = await retry(() => db.batch([
      db.prepare("SELECT version, data FROM draft_rows WHERE kind = 'media' AND id = ? AND deleted_ms IS NULL").bind(id),
      db.prepare("SELECT id, hash FROM draft_rows WHERE kind = 'media' AND deleted_ms IS NULL ORDER BY pos, id"),
      db.prepare("SELECT version FROM draft_kinds WHERE kind = 'media'")
    ]));
    const row = one.results[0];
    if (!row || !kind.results[0]) return false;
    const data = canonicalRow('media', { ...JSON.parse(row.data), ...change });
    const text = JSON.stringify(data);
    const hash = await sha256(text);
    const kindSum = await kindHash(all.results.map(r => (r.id === id ? { id, hash } : r)));
    const now = Date.now();
    try {
      await retry(() => db.batch([
        db.prepare("INSERT INTO draft_guard (ok) SELECT CASE WHEN (SELECT version FROM draft_kinds WHERE kind = 'media') = ? THEN 1 ELSE 0 END").bind(kind.results[0].version),
        db.prepare('DELETE FROM draft_guard'),
        db.prepare("UPDATE draft_kinds SET version = version + 1, hash = ?, source = 'worker', updated_ms = ?, updated_by = ? WHERE kind = 'media'").bind(kindSum, now, by),
        db.prepare("UPDATE draft_rows SET data = ?, hash = ?, version = version + 1, kver = (SELECT version FROM draft_kinds WHERE kind = 'media'), updated_ms = ?, updated_by = ? WHERE kind = 'media' AND id = ?")
          .bind(text, hash, now, by, id)
      ]));
      return true;
    } catch (err) {
      if (!/CHECK constraint failed/i.test(String(err && err.message))) throw err;
    }
  }
  throw new Error('media row ' + id + ': the library kept changing');
}

/*
 * The upload-time GitHub copy: files not on the site yet → one commit → mirrored, and each
 * Media row whose files are all there gets publishedAt. Idempotent; the queue / the publish retry it.
 */
export async function mirrorMedia(env, fetchImpl = fetch, now = Date.now()) {
  const db = env.DB;
  const { results } = await retry(() => db.prepare(
    'SELECT key, media_id, site_path FROM media_files WHERE mirrored_ms IS NULL AND deleted_ms IS NULL AND site_path IS NOT NULL ORDER BY created_ms LIMIT ?'
  ).bind(MIRROR_BATCH).all());
  if (!results.length) return { mirrored: 0 };
  const cfg = githubConfig(env);
  if (cfg.error) throw new Error('media mirror: ' + cfg.error);
  const binaries = {};
  for (const f of results) {
    const obj = await bucket(env).get(f.key);
    if (obj) binaries[f.site_path] = new Uint8Array(await new Response(obj.body).arrayBuffer());
  }
  const commit = await commitFiles(cfg, {}, 'Media ' + results.map(f => f.media_id).filter((v, i, a) => a.indexOf(v) === i).join(', ') + ' (' + cairoText(now) + ' Cairo)', fetchImpl, binaries);
  await retry(() => db.prepare('UPDATE media_files SET mirrored_ms = ? WHERE key IN (SELECT value FROM json_each(?))').bind(now, JSON.stringify(results.map(f => f.key))).run());
  const ids = [...new Set(results.map(f => f.media_id))];
  for (const id of ids) {
    const waiting = await retry(() => db.prepare('SELECT COUNT(*) AS n FROM media_files WHERE media_id = ? AND deleted_ms IS NULL AND site_path IS NOT NULL AND mirrored_ms IS NULL').bind(id).first());
    if (waiting.n === 0) await updateMediaRow(db, id, { publishedAt: cairoText(now) }, 'media-mirror');
  }
  return { mirrored: results.length, commit: commit.sha };
}

/*
 * POST /v1/sync/media-copy (signed, Apps Script): one Drive file of the library.
 * { id, part: 'full' | 'thumb', mime, data: base64, sha256 } → stored in R2, the row pointed at it.
 */
export async function syncMediaCopy(ctx) {
  await limit(ctx, 'sync.media', clientIp(ctx.request), 120, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { body } = await verifySync(ctx.env, ctx.request, raw, 'media-copy', Date.now(), { monotonic: false });
  const db = ctx.env.DB;
  const id = String(body.id || '');
  const part = body.part === 'thumb' ? 'thumb' : body.part === 'full' ? 'full' : '';
  if (!/^[a-z]{3}-[a-z0-9]{8}$/.test(id) || !part) throw new ApiError('bad', 'id / part');
  const row = await retry(() => db.prepare("SELECT data FROM draft_rows WHERE kind = 'media' AND id = ? AND deleted_ms IS NULL").bind(id).first());
  if (!row) throw new ApiError('not_found', 'media row');
  const data = JSON.parse(row.data);
  const site = part === 'full' ? data.path : data.thumb;
  const name = String(site || '').split('/').pop();
  if (!NAME_RE.test(name)) throw new ApiError('bad', 'site path');
  const bytes = b64ToBytes(String(body.data || ''));
  const sha = await sha256Bytes(bytes);
  if (sha !== String(body.sha256 || '')) throw new ApiError('bad', 'sha256 differs');
  // a picture's full file: the library's own fingerprint (Media.gs bytesHash_) must match too
  if (part === 'full' && data.hash && /^img-/.test(id) && data.hash !== sha) throw new ApiError('bad', 'not the file the library knows');
  const key = 'media/' + name;
  const have = await bucket(ctx.env).head(key);
  if (!have) await bucket(ctx.env).put(key, bytes, { httpMetadata: { contentType: String(body.mime || '') }, customMetadata: { sha256: sha, media: id } });
  const now = Date.now();
  await retry(() => db.prepare(
    "INSERT INTO media_files (key, media_id, part, mime, bytes, sha256, source, site_path, mirrored_ms, created_ms, deleted_ms) VALUES (?, ?, ?, ?, ?, ?, 'drive', ?, ?, ?, NULL) " +
    'ON CONFLICT(key) DO UPDATE SET sha256 = excluded.sha256, bytes = excluded.bytes'
  ).bind(key, id, part, String(body.mime || ''), bytes.length, sha, SITE_PATH_RE.test(String(site)) ? site : null, data.publishedAt ? now : null, now).run());
  const column = part === 'full' ? 'driveId' : 'thumbDriveId';
  if (data[column] !== 'r2:' + key) await updateMediaRow(db, id, { [column]: 'r2:' + key }, 'media-copy');
  return { id, part, key, bytes: bytes.length, stored: !have };
}

/* GET /v1/admin/content/media-status: the copy's and the mirror's progress */
export async function adminMediaStatus(ctx) {
  const db = ctx.env.DB;
  const [rows, files] = await retry(() => db.batch([
    db.prepare("SELECT json_extract(data, '$.id') AS id, json_extract(data, '$.driveId') AS d, json_extract(data, '$.thumbDriveId') AS t, json_extract(data, '$.deletedAt') AS gone FROM draft_rows WHERE kind = 'media' AND deleted_ms IS NULL"),
    db.prepare('SELECT source, COUNT(*) AS n, SUM(bytes) AS bytes, SUM(CASE WHEN mirrored_ms IS NULL AND site_path IS NOT NULL AND deleted_ms IS NULL THEN 1 ELSE 0 END) AS waiting FROM media_files GROUP BY source')
  ]));
  const onDrive = rows.results.filter(r => (r.d && !r2Key(r.d)) || (r.t && !r2Key(r.t)));
  return { rows: rows.results.length, onDrive: onDrive.length, onDriveIds: onDrive.slice(0, 50).map(r => r.id), files: files.results };
}
