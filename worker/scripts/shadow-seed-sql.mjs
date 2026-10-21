// Phase 2 P2-2: the production seed without an admin session. Reads what GitHub Pages serves now
// (the same files src/publish-shadow.js shadowTargets compares) and writes the SQL that the
// `seed` run would store: live revisions (rev 1) + one publish_jobs row of mode 'seed'.
// Only for an EMPTY published_revisions (it refuses nothing itself: check first).
//   node scripts/shadow-seed-sql.mjs out.sql
//   npx wrangler d1 execute athanasios-prod --remote --file out.sql
import { writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { shadowTargets } from '../src/publish-shadow.js';

const SITE = 'https://stathanasiosyouth.github.io';
const out = process.argv[2];
if (!out) { console.error('usage: node scripts/shadow-seed-sql.mjs out.sql'); process.exit(1); }

const now = Date.now();
const read = async path => { const r = await fetch(`${SITE}/${path}?seed=${now}`); return r.ok ? r.text() : null; };
const q = v => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
const sha = t => createHash('sha256').update(t, 'utf8').digest('hex');

const contentText = await read('content.json');
const content = JSON.parse(contentText);
const id = 'seed-' + now;
const rows = [];
for (const t of shadowTargets(content)) {
  const text = t.path === 'content.json' ? contentText : await read(t.path);
  if (text == null) { console.log('skip (not on the site): ' + t.path); continue; }
  let withdrawn = 0;
  try { withdrawn = JSON.parse(text).withdrawn === true ? 1 : 0; } catch { /* ics */ }
  rows.push({ id: 'rev' + randomBytes(6).toString('hex'), kind: t.kind, key: t.key, hash: sha(text), body: text, withdrawn, path: t.path });
}
const sql = rows.map(r =>
  `INSERT INTO published_revisions (id, kind, key, rev, hash, body, withdrawn, live, publish_id, published_by, published_at) VALUES (${[r.id, r.kind, r.key, 1, r.hash, r.body, r.withdrawn, 1, id, 'shadow-seed', now].map(q).join(', ')});`);
sql.push(`INSERT INTO publish_jobs (id, mode, revision, hash, state, files, changed, result, by, at, created_at, updated_at) VALUES (${[id, 'seed', content.revision || null, sha(rows.map(r => r.hash).join('\n')), 'live', rows.length, rows.length, '{}', 'shadow-seed', now, now, now].map(q).join(', ')});`);
writeFileSync(out, sql.join('\n') + '\n');
for (const r of rows) console.log(`${r.kind}:${r.key}  ${r.hash.slice(0, 12)}  ${r.body.length} chars  (${r.path})`);
console.log(`${rows.length} revisions → ${out}`);
