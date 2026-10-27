/*
 * GitHub (Git Data API) for the publish mirror (Phase 2 P2-4): one commit with
 * several text files, fast-forward only — the same steps and the same fixed,
 * non-personal identity as Apps Script's githubCommitFiles_ (Publish.gs).
 *
 *   GET  /branches/<branch>    head commit + its tree
 *   POST /git/trees            base_tree + the files inline
 *   POST /git/commits          (skipped when the tree did not change)
 *   PATCH /git/refs/heads/<b>  force: false; a 422 (someone pushed) → once more from the new head
 *
 * Config: vars GITHUB_REPO ("owner/name"), GITHUB_BRANCH; secret GITHUB_TOKEN
 * (fine-grained, Contents read/write on that one repository). Anything but
 * production refuses the production repository, so staging can never write
 * to the live site.
 */

export const PRODUCTION_REPO = 'StAthanasiosYouth/StAthanasiosYouth.github.io';
const API = 'https://api.github.com';
const IDENTITY = { name: 'Athanasius Portal Admin', email: 'portal-admin@users.noreply.github.com' };
const REPO = /^[\w.-]+\/[\w.-]+$/;

export class GitHubError extends Error {
  constructor(status, detail) {
    super(`GitHub ${status}${detail ? ': ' + detail : ''}`);
    this.status = status;
  }
}

/* { repo, branch, token } or null with the reason */
export function githubConfig(env) {
  const repo = String(env.GITHUB_REPO || '').trim();
  const branch = String(env.GITHUB_BRANCH || 'main').trim();
  if (!REPO.test(repo)) return { error: 'GITHUB_REPO not set' };
  if (env.ENVIRONMENT !== 'production' && repo.toLowerCase() === PRODUCTION_REPO.toLowerCase()) return { error: 'the production repository is refused outside production' };
  if (!env.GITHUB_TOKEN) return { error: 'GITHUB_TOKEN not set' };
  return { repo, branch, token: env.GITHUB_TOKEN };
}

async function gh(cfg, fetchImpl, method, path, body, meta = null) {
  const res = await fetchImpl(`${API}/repos/${cfg.repo}${path}`, {
    method,
    headers: {
      authorization: 'Bearer ' + cfg.token,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'athanasios-api',
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (meta) meta.expires = res.headers.get('github-authentication-token-expiration') || '';
  if (res.ok) return text ? JSON.parse(text) : null;
  let detail = '';
  try { detail = JSON.parse(text).message || ''; } catch { detail = ''; }
  throw new GitHubError(res.status, String(detail).slice(0, 120));
}

/*
 * files: { path: text }. → { sha, unchanged: false } for a new commit, or
 * { sha: head, unchanged: true } when the branch already has exactly these files.
 */
export async function commitFiles(cfg, files, message, fetchImpl = fetch, binaries = {}) {
  const entries = Object.keys(files).sort().map(path => ({ path, mode: '100644', type: 'blob', content: files[path] }));
  // pictures / videos (Phase 4 media): one blob each, base64
  for (const path of Object.keys(binaries).sort()) {
    const blob = await gh(cfg, fetchImpl, 'POST', '/git/blobs', { content: toBase64(binaries[path]), encoding: 'base64' });
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const head = await gh(cfg, fetchImpl, 'GET', '/branches/' + encodeURIComponent(cfg.branch));
    const parent = head.commit.sha;
    const baseTree = head.commit.commit.tree.sha;
    const tree = await gh(cfg, fetchImpl, 'POST', '/git/trees', { base_tree: baseTree, tree: entries });
    if (tree.sha === baseTree) return { sha: parent, unchanged: true };
    const commit = await gh(cfg, fetchImpl, 'POST', '/git/commits', { message, tree: tree.sha, parents: [parent], author: IDENTITY, committer: IDENTITY });
    try {
      await gh(cfg, fetchImpl, 'PATCH', '/git/refs/heads/' + encodeURIComponent(cfg.branch), { sha: commit.sha, force: false });
      return { sha: commit.sha, unchanged: false };
    } catch (err) {
      if (!(err instanceof GitHubError) || err.status !== 422 || attempt === 1) throw err;
    }
  }
  throw new GitHubError(422, 'branch moved twice');
}

/*
 * Can the token read and write the branch, without changing anything?
 * Read: the branch head. Write: POST /git/trees (Contents write) with the
 * head's own tree and one of its files unchanged → GitHub answers with the
 * head's tree itself (content-addressed: no new object, no commit, no ref
 * moved). → { head, expires } (the token's expiry date when GitHub sends it).
 */
export async function checkAccess(cfg, fetchImpl = fetch) {
  const meta = {};
  const head = await gh(cfg, fetchImpl, 'GET', '/branches/' + encodeURIComponent(cfg.branch), null, meta);
  const baseTree = head.commit.commit.tree.sha;
  const listing = await gh(cfg, fetchImpl, 'GET', '/git/trees/' + baseTree);
  const blob = (listing.tree || []).find(e => e.type === 'blob');
  if (!blob) throw new GitHubError(0, 'the branch has no file to check with');
  const tree = await gh(cfg, fetchImpl, 'POST', '/git/trees', { base_tree: baseTree, tree: [{ path: blob.path, mode: blob.mode, type: 'blob', sha: blob.sha }] });
  if (tree.sha !== baseTree) throw new GitHubError(0, 'the unchanged tree came back different');
  return { head: head.commit.sha, expires: meta.expires || '' };
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* one text file of the branch, or '' when it is missing / unreadable (the page and competition shells) */
export async function readText(cfg, path, fetchImpl = fetch) {
  try {
    const file = await gh(cfg, fetchImpl, 'GET', '/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(cfg.branch));
    const raw = atob(String(file.content || '').replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
  } catch {
    return '';
  }
}

/* the branch's top-level names (the page slug check), or null */
export async function rootNames(cfg, fetchImpl = fetch) {
  try {
    const list = await gh(cfg, fetchImpl, 'GET', '/contents/?ref=' + encodeURIComponent(cfg.branch));
    return Array.isArray(list) ? list.map(e => String(e.name || '').toLowerCase()) : null;
  } catch {
    return null;
  }
}
