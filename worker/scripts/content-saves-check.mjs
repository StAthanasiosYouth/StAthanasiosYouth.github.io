// Phase 4 P4-2 / P4-3 staging check: the content saves on the REAL staging Worker + D1.
// Needs settings.CONTENT_DRAFTS = '1' on STAGING for the run (the caller flips it, and back to '0' after),
// and the fixture drafts from scripts/content-check.mjs. Uses the staging test key (.staging-test-key.pem).
//   saves / toggles / moves / deletes (links, sections, settings, news, sessions); refusals with Apps Script's texts
//   row versions: a stale editor refused; another admin's edit lock refused
//   pages, page media, events (booking), servants, the primary-only payment approval → pay_dest
//   permissions: no token, a stranger, a non-primary approval
//   Activity: rows written by the Worker, a repeat edit merged; admin pushes queued for Apps Script (router off)
//   integrity: the reverse export is self-consistent (row and kind hashes) and equals the panel read
//   node scripts/content-saves-check.mjs
import { readFileSync } from 'node:fs';
import { createSign, createHash } from 'node:crypto';
import { signSync } from '../src/lib/sync.js';

const base = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SYNC = readFileSync(new URL('../.staging-sync-secret', import.meta.url), 'utf8').trim();
const ORIGIN = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PRIMARY = 'loadtest@staging.invalid';
const RUN = Date.now().toString(36);
const OTHER = `content-${RUN}@staging.invalid`;
const TAB = n => ('tab-' + RUN + '-' + n).padEnd(20, 'x');
const times = [];
let failed = 0;

const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 500))); if (!ok) failed++; };
const sha = t => createHash('sha256').update(t, 'utf8').digest('hex');
function google(email, sub) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: email.split('@')[0], iat: now, exp: now + 3600 });
  return 'Bearer ' + head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function call(auth, method, path, body) {
  const t0 = Date.now();
  const res = await fetch(base + path, { method, headers: { origin: ORIGIN, ...(auth ? { authorization: auth } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const out = { status: res.status, body: await res.json().catch(() => null), ms: Date.now() - t0 };
  if (path === '/v1/admin/content/call') times.push(out.ms);
  return out;
}
async function sync(path, body) {
  const raw = JSON.stringify(body);
  const ts = String(Date.now());
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'text/plain', 'x-sync-ts': ts, 'x-sync-signature': await signSync(SYNC, ts, raw) }, body: raw });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const errText = b => { try { const p = JSON.parse(b.error); return p.message; } catch { return b && (b.error || b.code); } };

const P = google(PRIMARY, 'loadtest-1');
const status = await call(P, 'GET', '/v1/admin/content/status');
if (!status.body || status.body.writer !== 'worker') { console.error('CONTENT_DRAFTS is not 1 on staging (writer: ' + (status.body && status.body.writer) + ')'); process.exit(1); }

const ps = await call(P, 'POST', '/v1/admin/session/start', { device: 'Content check', tab: TAB(1), force: true });
check('primary session', ps.status === 200, ps.body);
const PT = 'Bearer ' + ps.body.token;
const run = (fn, args, expect) => call(PT, 'POST', '/v1/admin/content/call', { fn, args, expect });
const drafts = async (q = '') => (await call(PT, 'GET', '/v1/admin/content/drafts' + q)).body.kinds;

/* ---------- P4-2 ---------- */
const title = 'لينك فحص ' + RUN;
const c1 = await run('apiSaveLink', [{ title, url: 'https://example.com/' + RUN, section: 'social', icon: 'link' }]);
check('link saved', c1.status === 200 && c1.body.changed.includes('links'), c1.body);
let link = (await drafts('?kinds=links')).links.rows.find(r => r.data.title === title);
check('link in the panel read', !!link, null);
const u1 = await run('apiSaveLink', [{ id: link.id, title: title + ' ٢', url: 'https://example.com/' + RUN, section: 'social' }], { ['links:' + link.id]: link.version });
check('edit at the version opened → ok', u1.status === 200, u1.body);
const u2 = await run('apiSaveLink', [{ id: link.id, title: title + ' ٣', url: 'https://example.com/' + RUN, section: 'social' }], { ['links:' + link.id]: link.version });
check('second edit from the same old version → stale 409', u2.status === 409 && u2.body.code === 'stale', u2.body);
const u3 = await run('apiSaveLink', [{ id: link.id, title: title + ' ٣', url: 'https://example.com/' + RUN, section: 'social' }]);
check('repeat edit (no version sent) → ok', u3.status === 200, u3.body);
const bad = await run('apiSaveLink', [{ title: '', url: 'http://x.com', section: 'social' }]);
check('invalid link refused with Apps Script\'s words', bad.status === 400 && /العنوان مطلوب/.test(bad.body.error) && /https/.test(bad.body.error), bad.body);
check('toggle', (await run('apiSetLinkEnabled', [link.id, false])).status === 200, null);
check('move', (await run('apiMoveLink', [link.id, -1])).status === 200, null);
const sec = await run('apiSaveSection', [{ key: 'chk' + RUN.slice(-5), title: 'قسم فحص', theme: 'azure' }, true]);
check('section saved', sec.status === 200, sec.body);
check('settings saved', (await run('apiSaveSettings', [{ 'site.tagline': 'فحص ' + RUN }])).status === 200, null);
const nw = await run('apiSaveItem', ['news', { title: 'خبر فحص ' + RUN, summary: 'سطر' }]);
check('news saved', nw.status === 200, nw.body);
check('session saved', (await run('apiSaveItem', ['sessions', { date: '2099-01-0' + (1 + (Date.now() % 8)), topic: 'فحص', speaker: 'خادم' }])).status === 200, null);

const before = (await drafts('?kinds=links,news')).links.version;
await run('apiSaveLink', [{ title: 'لينك تاني ' + RUN, url: 'https://example.com/b' + RUN, section: 'social' }]);
const delta = (await drafts(`?kinds=links&since=links:${before}`)).links;
check('delta read: only the new row', delta.delta === true && delta.rows.length === 1 && delta.rows[0].data.title === 'لينك تاني ' + RUN, delta);

// another admin's open editor
await call(P, 'POST', '/v1/admin/accounts', { email: OTHER, grants: {} });
const O = google(OTHER, 'content-' + RUN);
const os = await call(O, 'POST', '/v1/admin/session/start', { device: 'Check B', tab: TAB(2), force: true });
const OT = 'Bearer ' + os.body.token;
const hb = await call(OT, 'POST', '/v1/admin/session/heartbeat', { area: 'links', locks: ['links:' + link.id] });
check('other admin holds the link lock', hb.status === 200 && hb.body.locks['links:' + link.id].granted === true, hb.body);
const lk = await run('apiSaveLink', [{ id: link.id, title: title + ' ٤', url: 'https://example.com/' + RUN, section: 'social' }]);
check('save while the other admin edits → locked', lk.status === 409 && lk.body.code === 'locked' && /بيعدّل ده دلوقتي/.test(lk.body.error), lk.body);
await call(OT, 'POST', '/v1/admin/session/heartbeat', { area: 'links', locks: [] });
check('delete after the lock is released', (await run('apiDeleteLink', [link.id])).status === 200, null);

/* ---------- P4-3 ---------- */
const all = await drafts('?kinds=media,servants,pages,events');
const mediaId = all.media.rows[0] && all.media.rows[0].id;
const sv = await run('apiServantSave', [null, { name: 'خادم فحص ' + RUN, phone: '01000000002', role: 'خادم', instapayNumber: '01200000002', payName: 'خادم فحص' }]);
check('servant saved', sv.status === 200, sv.body);
const svId = (await drafts('?kinds=servants')).servants.rows.find(r => r.data.name === 'خادم فحص ' + RUN).id;
const slug = 'p4chk-' + RUN;
const pg = await run('apiPageSave', [null, { slug, title: 'صفحة فحص', tagline: 'فحص', description: 'فحص', cover: mediaId, team: [svId], home: { show: true } }]);
check('page saved (slug checked against the staging repo)', pg.status === 200, pg.body);
const reserved = await run('apiPageSave', [null, { slug: 'admin', title: 'محجوز', cover: mediaId }]);
check('reserved slug refused', reserved.status === 400 && /محجوز/.test(reserved.body.error), reserved.body);
const pageId = (await drafts('?kinds=pages')).pages.rows.find(r => r.data.slug === slug).id;
check('page media saved', (await run('apiPageMediaSave', [pageId, null, { title: 'مقطع', cover: mediaId, source: 'link', fullUrl: 'https://youtu.be/abc' }])).status === 200, null);
const ev = await run('apiEventSave', [null, {
  slug: 'p4evt-' + RUN, kind: 'trip', title: 'رحلة فحص', summary: 'فحص', cover: mediaId, startAt: '2099-12-10 07:00', endAt: '2099-12-10 22:00', locationName: 'سفاجا',
  booking: { opensAt: '2099-11-01 10:00', closesAt: '2099-12-05 22:00', capacity: 40, pricing: { mode: 'group', categories: [{ label: 'الحاجز', price: 1500 }] }, payment: { mode: 'full' } },
  servants: [{ id: svId, methods: ['cash'] }], home: { show: false }
}]);
check('event with booking saved', ev.status === 200, ev.body);
const evId = (await drafts('?kinds=events')).events.rows.find(r => r.data.slug === 'p4evt-' + RUN).id;
const notPrimary = await call(OT, 'POST', '/v1/admin/content/call', { fn: 'apiServantPayApprove', args: [svId, 'instapay', '01200000002', true] });
check('payment approval by a non-primary admin refused', notPrimary.status === 400 && /الرئيسي/.test(notPrimary.body.error), notPrimary.body);
const ap = await run('apiServantPayApprove', [svId, 'instapay', '01200000002', true]);
check('primary approves the payment number', ap.status === 200, ap.body);
check('event archived + deleted', (await run('apiEventArchive', [evId, true])).status === 200 && (await run('apiEventDelete', [evId])).status === 200, null);
check('page deleted', (await run('apiPageDelete', [pageId])).status === 200, null);

/* ---------- permissions ---------- */
check('no token → 401', (await call(null, 'POST', '/v1/admin/content/call', { fn: 'apiPages', args: [] })).status === 401, null);
check('not an admin → 403', (await call(google('stranger-' + RUN + '@staging.invalid', 'x-' + RUN), 'POST', '/v1/admin/content/call', { fn: 'apiPages', args: [] })).status === 403, null);
check('a call outside the list → 400', (await run('apiCheckGithub', [])).status === 400, null);

/* ---------- Activity + pushes ---------- */
const act = await call(P, 'GET', '/v1/admin/activity?limit=100');
const mine = (act.body.rows || act.body.items || []).filter(r => String(r.title || r.entityTitle || r.entity_title || '').includes(RUN) || String(r.summary || '').includes(RUN));
check('Activity rows from the Worker saves', mine.length >= 5, act.body && Object.keys(act.body));
const queued = await sync('/v1/sync/content-notify', { at: Date.now() });
check('admin pushes queued for Apps Script (router off): creates are «pending:now»', queued.status === 200 && queued.body.items.some(i => i.notified === 'pending:now' && String(i.title).includes(RUN)), queued.body);

/* ---------- integrity ---------- */
const exp = await call(P, 'GET', '/v1/admin/content/export');
const st = (await call(P, 'GET', '/v1/admin/content/status')).body;
const read = await drafts();
let consistent = true;
for (const [kind, k] of Object.entries(exp.body.kinds)) {
  const keyCol = { settings: 'key', sections: 'key', sessions: 'date', types: 'key', pay_methods: 'key' }[kind] || 'id';
  const rows = k.rows.map(cells => Object.fromEntries(k.columns.map((c, i) => [c, cells[i]])));
  const hashes = rows.map(r => sha(JSON.stringify(r)));
  const kindHash = sha(rows.map((r, i) => String(r[keyCol]) + ':' + hashes[i]).join('\n'));
  const meta = st.kinds.find(m => m.kind === kind);
  const ok = kindHash === k.hash && hashes.every((h, i) => h === k.hashes[i]) && (!meta || meta.hash === k.hash) && read[kind].rows.length === rows.length;
  if (!ok) { consistent = false; console.log('  mismatch in ' + kind); }
}
check('integrity: export rows = hashes = draft_kinds = panel read, every kind', consistent, null);

await call(P, 'POST', '/v1/admin/accounts/' + encodeURIComponent(OTHER) + '/remove');
times.sort((a, b) => a - b);
console.log(`\ncontent calls: ${times.length}, median ${times[Math.floor(times.length / 2)]} ms, p90 ${times[Math.floor(times.length * 0.9)]} ms, max ${times.at(-1)} ms`);
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
