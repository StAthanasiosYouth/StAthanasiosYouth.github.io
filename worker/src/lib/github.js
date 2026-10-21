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

async function gh(cfg, fetchImpl, method, path, body) {
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
  if (res.ok) return text ? JSON.parse(text) : null;
  let detail = '';
  try { detail = JSON.parse(text).message || ''; } catch { detail = ''; }
  throw new GitHubError(res.status, String(detail).slice(0, 120));
}

/*
 * files: { path: text }. → { sha, unchanged: false } for a new commit, or
 * { sha: head, unchanged: true } when the branch already has exactly these files.
 */
export async function commitFiles(cfg, files, message, fetchImpl = fetch) {
  const entries = Object.keys(files).sort().map(path => ({ path, mode: '100644', type: 'blob', content: files[path] }));
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
