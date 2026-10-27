// Phase 4 P4-7: the admin page sends exactly the Worker's content calls to the Worker
// (admin/boot.js CONTENT_FNS = src/content/runtime.js CONTENT_CALLS), and only once the
// Worker's session answer says it writes the content (boot.content, settings.CONTENT_DRAFTS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTENT_CALLS } from '../src/content/runtime.js';
import { harness, fakeGoogle } from './helpers.mjs';

test('admin/boot.js CONTENT_FNS = the Worker\'s CONTENT_CALLS', () => {
  const boot = readFileSync(new URL('../../admin/boot.js', import.meta.url), 'utf8');
  const block = /var CONTENT_FNS = \{([\s\S]*?)\};/.exec(boot);
  assert.ok(block, 'CONTENT_FNS in admin/boot.js');
  const names = [...block[1].matchAll(/(api\w+): 1/g)].map(m => m[1]).sort();
  assert.deepEqual(names, [...CONTENT_CALLS].sort());
});

test('the session answer says who writes the content: sheets while CONTENT_DRAFTS = 0, worker at 1', async () => {
  const g = await fakeGoogle();
  const h = harness({ env: { ADMIN_EMAILS: '' } });
  await h.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES ('p@example.com', 'P', 'primary', 1, 0)").run();
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'ADMIN_PLATFORM'").run();
  const start = async () => (await h.call('/v1/admin/session/start', { method: 'POST', body: { device: 'x', tab: 'tab-aaaaaaaaaaaaaaaa', force: true, boot: true }, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: 'p@example.com', sub: 'p' })) }, fetch: g.fetch })).body;
  assert.equal((await start()).boot.content, 'sheets');
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'CONTENT_DRAFTS'").run();
  assert.equal((await start()).boot.content, 'worker');
});
