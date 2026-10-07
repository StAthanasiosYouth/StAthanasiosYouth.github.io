// final/r — a reload of the admin is almost invisible (server side + static
// checks). apps-script/Presence.gs: a page that leaves parks its session
// (apiSessionEnd { park }), and the same tab picks it up again
// (apiSessionResume): same sid, locks and presence, never the takeover
// question; a duplicated tab or another device is still asked; expired /
// replaced sessions fall back to the usual sign-in. admin/boot.js keeps only
// the opaque sid, where the admin was and unsaved editor values in this tab's
// sessionStorage — never the token.
//
// Browser side: tests/final-r.e2e.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT } from '../tools/lib/gs.mjs';
import { createWorld } from './fakes/gas.mjs';

const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'second.admin@gmail.com';
const CLIENT = '1234-abc.apps.googleusercontent.com';
const LAPTOP = 'كمبيوتر ويندوز – Chrome';

const plain = value => JSON.parse(JSON.stringify(value));
const tabId = n => `tab-${String(n).padStart(20, '0')}`;

function apiWorld() {
  const world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'ghp_SECRETsecretSECRETsecret1234567890');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');
  world.properties.set('ADMIN_CLIENT_ID', CLIENT);
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  world.gs.apiSaveItem('news', { id: 'news-aaaa1111', title: 'خبر أول', summary: 'x' });
  world.as('');
  return world;
}

/* one page load: its token, its tab id, its session */
function pageLoad(world, email, tab, device = LAPTOP, claims = {}) {
  const token = world.issueToken({ email, ...claims });
  const page = {
    token, tab, sid: '',
    start(extra = {}) {
      const reply = world.post({ fn: 'apiSessionStart', args: [{ device, tab, ...extra }], token });
      if (reply.ok && reply.result.sid) page.sid = reply.result.sid;
      return reply;
    },
    /* after a reload: the sid (and the page load) this tab kept */
    resume(kept, extra = {}) {
      const reply = world.post({ fn: 'apiSessionResume', args: [{ device, tab, prev: kept.tab, left: kept.left, ...extra }], token, sid: kept.sid });
      if (reply.ok && reply.result.sid) page.sid = reply.result.sid;
      return reply;
    },
    park() { return world.post({ fn: 'apiSessionEnd', args: [{ park: true, tab }], token, sid: page.sid }); },
    call(fn, ...args) { return world.post({ fn, args, token, sid: page.sid }); },
    beat(info = {}) { return page.call('apiHeartbeat', info); }
  };
  return page;
}

const record = (world, email) => {
  const key = [...world.cache.keys()].find(k => k.startsWith('adm:ses:') && JSON.parse(world.cache.get(k).value).email === email);
  return key ? JSON.parse(world.cache.get(key).value) : null;
};
const lockOf = (world, key) => {
  const entry = world.cache.get(`adm:lck:${key}`);
  return entry ? JSON.parse(entry.value) : null;
};


/* ---------------- resume ---------------- */

test('a reload of the same tab resumes the SAME session: sid, locks, presence kept; no takeover question; state in one round trip', () => {
  const world = apiWorld();
  const before = pageLoad(world, ADMIN, tabId(1));
  before.start();
  before.beat({ area: 'content', view: 'news', item: { kind: 'news', id: 'news-aaaa1111', label: 'خبر' }, locks: ['news:news-aaaa1111'] });
  const other = pageLoad(world, SECOND, tabId(9), 'موبايل أندرويد – Chrome');
  other.start();
  other.beat({ area: 'home' });
  const since = record(world, ADMIN).since;

  // the page leaves (pagehide): parked, with the lock
  world.advance(2000);
  assert.deepEqual(plain(before.park().result), { parked: true });
  assert.ok(record(world, ADMIN).parked, 'parked');
  assert.equal(lockOf(world, 'news:news-aaaa1111').sid, before.sid, 'the lock stays during the reload');
  // the other admin still sees it held, and the admin online
  const seen = other.beat({ locks: ['news:news-aaaa1111'] }).result;
  assert.equal(seen.locks['news:news-aaaa1111'].granted, false, 'nobody slips in during a reload');
  assert.deepEqual(seen.others.map(o => o.email), [ADMIN]);

  // the new page load, with a fresh token from Google
  world.advance(3000);
  const after = pageLoad(world, ADMIN, tabId(2));
  const reply = after.resume({ sid: before.sid, tab: before.tab, left: true });
  assert.equal(reply.ok, true, reply.error);
  assert.equal(reply.result.sid, before.sid, 'the same session');
  assert.equal(reply.result.resumed, true);
  assert.equal(reply.result.active, undefined, 'never the takeover question');
  assert.equal(reply.result.state.user, ADMIN, 'the panel state comes with it');

  const now = record(world, ADMIN);
  assert.equal(now.parked, undefined, 'not parked any more');
  assert.equal(now.tab, tabId(2), 'it belongs to the new page load');
  assert.equal(now.since, since, 'the same session, from the same start');
  assert.deepEqual(now.locks, ['news:news-aaaa1111']);
  assert.equal(after.beat({ locks: ['news:news-aaaa1111'] }).result.locks['news:news-aaaa1111'].granted, true, 'its lock, still');
  assert.equal(after.call('apiState').ok, true);
  assert.equal(before.call('apiState').ok, true, 'the sid is the same one (the old page load is gone anyway)');
  assert.ok(!world.spreadsheet.getSheetByName('Log').data.some(r => r[2] === 'session.takeover'), 'not a takeover');

  // a late goodbye from the page load that already left changes nothing
  world.post({ fn: 'apiSessionEnd', args: [{ park: true, tab: tabId(1) }], token: before.token, sid: before.sid });
  assert.equal(record(world, ADMIN).parked, undefined, 'the old page load can\'t park the new one');
});

test('a reload whose goodbye never arrived still resumes (this page load said it left); a quiet session too', () => {
  const world = apiWorld();
  const before = pageLoad(world, ADMIN, tabId(1));
  before.start();
  before.beat({ area: 'home' });

  // no beacon reached the server: the session still looks live
  world.advance(4000);
  const after = pageLoad(world, ADMIN, tabId(2));
  const reply = after.resume({ sid: before.sid, tab: tabId(1), left: true });
  assert.equal(reply.result.sid, before.sid, 'the tab itself said its page load left');

  // a tab that was put away (no heartbeat ~90 s), then reloaded: also the same session
  world.advance(120_000);
  const later = pageLoad(world, ADMIN, tabId(3));
  assert.equal(later.resume({ sid: before.sid, tab: tabId(2), left: false }).result.sid, before.sid);
});

test('a duplicated tab (same sid, the first tab still live, no "left") is asked, like another device; another device too', () => {
  const world = apiWorld();
  const first = pageLoad(world, ADMIN, tabId(1));
  first.start();
  first.beat({ area: 'home' });
  world.advance(5000);

  // the browser copied the first tab's storage: same sid, its page load, but it never left
  const copy = pageLoad(world, ADMIN, tabId(2));
  const asked = copy.resume({ sid: first.sid, tab: tabId(1), left: false });
  assert.equal(asked.ok, true);
  assert.equal(asked.result.sid, undefined, 'no session for the copy');
  assert.deepEqual(plain(asked.result.active), { device: LAPTOP, since: 5, seen: 5 });
  // a wrong page load claiming it left: asked too
  assert.ok(copy.resume({ sid: first.sid, tab: tabId(7), left: true }).result.active);
  assert.equal(first.call('apiState').ok, true, 'the first tab goes on');

  // another device, normal sign-in: asked, as before
  assert.ok(pageLoad(world, ADMIN, tabId(5), 'موبايل أندرويد – Chrome').start().result.active);
});

test('parked = not live: another device gets in without a question; the parked tab then hears «الجلسة اتقفلت…»', () => {
  const world = apiWorld();
  const laptop = pageLoad(world, ADMIN, tabId(1));
  laptop.start();
  laptop.beat({ area: 'home', locks: ['news:news-aaaa1111'] });
  laptop.park();

  const phone = pageLoad(world, ADMIN, tabId(2), 'موبايل أندرويد – Chrome');
  const started = phone.start();
  assert.ok(started.result.sid, 'no question: the laptop\'s page had left');
  assert.equal(lockOf(world, 'news:news-aaaa1111'), null, 'its locks went with it');

  const back = pageLoad(world, ADMIN, tabId(3)).resume({ sid: laptop.sid, tab: tabId(1), left: true });
  assert.equal(back.ok, false);
  assert.equal(back.code, 'session_replaced');
  assert.equal(JSON.parse(back.error).message, 'الجلسة اتقفلت لأنك دخلت من جهاز تاني.');
  // … even after the phone signs out (the old sid stays "taken over")
  phone.call('apiSessionEnd');
  assert.equal(pageLoad(world, ADMIN, tabId(4)).resume({ sid: laptop.sid, tab: tabId(1), left: true }).code, 'session_replaced');
});

test('a parked session\'s locks and presence end after a short grace; a heartbeat (back from the cache) unparks it', () => {
  const world = apiWorld();
  world.gs.SESSION_PARK_SECONDS = 5;
  const a = pageLoad(world, ADMIN, tabId(1));
  const b = pageLoad(world, SECOND, tabId(2));
  a.start();
  b.start();
  a.beat({ locks: ['news:news-aaaa1111'] });
  a.park();
  world.advance(3000);
  assert.equal(b.beat({ locks: ['news:news-aaaa1111'] }).result.locks['news:news-aaaa1111'].granted, false, 'within the grace');
  world.advance(3000);
  const later = b.beat({ locks: ['news:news-aaaa1111'] }).result;
  assert.equal(later.locks['news:news-aaaa1111'].granted, true, 'free after the grace');
  assert.deepEqual(later.others, [], 'and not shown online');

  // its tab comes back from the back/forward cache: a heartbeat, and it is here again
  a.beat({ area: 'home' });
  assert.equal(record(world, ADMIN).parked, undefined);
  assert.deepEqual(b.beat({ locks: ['news:news-aaaa1111'] }).result.others.map(o => o.email), [ADMIN]);
});

test('expired: ended, forgotten, or too old → session_expired (the page signs in as usual); the wrong account gets nothing', () => {
  const world = apiWorld();
  const page = pageLoad(world, ADMIN, tabId(1));
  page.start();
  const kept = { sid: page.sid, tab: tabId(1), left: true };

  // signed out (ended for real)
  page.call('apiSessionEnd');
  const ended = pageLoad(world, ADMIN, tabId(2)).resume(kept);
  assert.equal(ended.code, 'session_expired');
  assert.equal(JSON.parse(ended.error).message, 'الجلسة انتهت.');

  // too long ago: ends now, its locks too
  const old = pageLoad(world, ADMIN, tabId(3));
  old.start();
  old.beat({ locks: ['news:news-aaaa1111'] });
  old.park();
  world.advance(7201_000);
  // a fresh token by the world's clock (two hours on)
  const later = { exp: String(Math.floor(Date.now() / 1000) + 7201 + 3600) };
  assert.equal(pageLoad(world, ADMIN, tabId(4), LAPTOP, later).resume({ sid: old.sid, tab: tabId(3), left: true }).code, 'session_expired');
  assert.equal(record(world, ADMIN), null, 'gone');
  assert.equal(lockOf(world, 'news:news-aaaa1111'), null);

  // another admin's token with my sid: never mine (the email comes from the token only)
  const mine = pageLoad(world, ADMIN, tabId(5), LAPTOP, later);
  mine.start();
  const theirs = pageLoad(world, SECOND, tabId(6), LAPTOP, later).resume({ sid: mine.sid, tab: tabId(5), left: true });
  assert.equal(theirs.ok, false);
  assert.equal(theirs.code, 'session_expired', 'they have no session: the usual sign-in');
  assert.equal(record(world, SECOND), null, 'nothing made for them');
  assert.equal(mine.call('apiState').ok, true, 'mine untouched');
});

test('resume fails closed: no token, a stranger, a malformed sid; the sid alone is nothing', () => {
  const world = apiWorld();
  const page = pageLoad(world, ADMIN, tabId(1));
  page.start();
  const args = [{ device: 'x', tab: tabId(2), prev: tabId(1), left: true }];

  for (const token of [undefined, '', 'aaaaaaaaaaaa.bbbbbbbbbbbbbbbb.cccccccccccc']) {
    assert.equal(world.post({ fn: 'apiSessionResume', args, token, sid: page.sid }).code, 'auth');
  }
  assert.equal(world.post({ fn: 'apiSessionResume', args, token: world.issueToken({ email: 'someone@gmail.com' }), sid: page.sid }).code, 'denied');
  for (const sid of [undefined, '', 'abc', { a: 1 }, '<script>']) {
    const body = { fn: 'apiSessionResume', args, token: page.token };
    if (sid !== undefined) body.sid = sid;
    assert.equal(world.post(body).code, 'session_replaced', `sid ${JSON.stringify(sid)}`);
  }
  // removed from the allowlist since: refused, even with its own sid
  world.properties.set('ADMIN_EMAILS', SECOND);
  assert.equal(world.post({ fn: 'apiSessionResume', args, token: page.token, sid: page.sid }).code, 'denied');
});

test('HtmlService (the recovery admin) does not take part', () => {
  const world = createWorld();
  world.as(ADMIN).gs.setup();
  const gs = world.as(ADMIN).gs;
  assert.deepEqual(plain(gs.apiSessionResume({ device: 'x' })), { off: true });
  assert.deepEqual(plain(gs.apiSessionEnd({ park: true })), { off: true });
  assert.equal(world.cache.size, 0);
  assert.throws(() => world.as('someone@gmail.com').gs.apiSessionResume({}), /مش مسموح/);
});


/* ---------------- the page: what is kept, and where ---------------- */

test('boot.js keeps only the sid (+ page load id), "ui" and "draft" in sessionStorage — never the token, nothing from Google', () => {
  const boot = readFileSync(`${ROOT}admin/boot.js`, 'utf8');
  assert.doesNotMatch(boot, /localStorage|indexedDB|document\.cookie/);

  // one helper, a fixed list of names, a size cap
  assert.match(boot, /var NAMES = \['session', 'ui', 'draft'\];/);
  assert.match(boot, /var MAX = \d+;/);
  // what goes into 'session': the sid and page load ids, nothing else
  const sets = [...boot.matchAll(/keep\.set\('(\w+)', ([^;]+)\);/g)].map(m => [m[1], m[2]]);
  assert.deepEqual([...new Set(sets.map(s => s[0]))], ['session']);
  for (const [, value] of sets) assert.doesNotMatch(value, /token|email|session\.|claims|credential/, value);
  for (const [, value] of sets) assert.match(value, /^left \? \{ sid: sid, tab: TAB, left: true \} : \{ sid: sid, tab: TAB \}$/);
  // the panel's share can't touch 'session'
  assert.match(boot, /get: function \(name\) \{ return name === 'session' \? null : keep\.get\(name\); \}/);
  // signing out clears it all
  assert.match(boot, /keep\.close\(\);/);
  // the token still in memory only
  assert.match(boot, /function remember\(value\) \{\s+session = value;\s+\}/);

  // restore.js only reads the session entry, to decide the compact gate
  const early = readFileSync(`${ROOT}admin/restore.js`, 'utf8');
  assert.doesNotMatch(early, /setItem|removeItem|fetch|XMLHttpRequest|sendBeacon|localStorage|cookie|innerHTML/);
  assert.match(early, /sessionStorage\.getItem\('athanasios-admin\.session'\)/);
  assert.ok(early.length < 1200, 'tiny: it runs before the page draws');
});

test('the drafts: plain form values only (no files), capped, cleared on save / cancel / sign-out; recovery admin unchanged', () => {
  const app = readFileSync(`${ROOT}apps-script/AdminScript.html`, 'utf8');
  // file inputs are never read; the photo picker keeps only the chosen image's id
  assert.match(app, /control\.type !== 'file'/);
  assert.match(app, /var DRAFT_TEXT_MAX = \d+;/);
  // a photo still uploading can't come back: the browser asks before leaving
  assert.match(app, /if \(A\.uploadsInFlight > 0\) return true;/);
  // closed (saved, cancelled) → gone
  assert.match(app, /sheet\.addEventListener\('close', function \(\) \{[\s\S]*?A\.keep\.drop\('draft'\)/);
  // never saved to the server by itself
  const section = /AFTER A RELOAD[\s\S]*?A\.restore = \{[\s\S]*?\n {2}\};/.exec(app)[0];
  assert.doesNotMatch(section, /A\.call\(/, 'no server call in the drafts code');
  // only the official admin (A.keep from boot.js)
  assert.match(app, /A\.keep = null;/);

  // every item editor says which item it is
  for (const [file, kinds] of [['AdminContent', ['sessions', 'news', 'games', 'notifications']], ['AdminItems', ['activities', 'types']], ['AdminPage', ['links', 'sections', 'contacts']]]) {
    const text = readFileSync(`${ROOT}apps-script/${file}.html`, 'utf8');
    for (const kind of kinds) assert.match(text, new RegExp(`draft: A\\.draftKey\\('${kind}'`), `${file}: ${kind}`);
  }
});

test('pull-to-refresh is guarded on the official admin (gate.css)', () => {
  const css = readFileSync(`${ROOT}admin/gate.css`, 'utf8');
  assert.match(css, /html,\s*body \{\s*overscroll-behavior-y: contain;\s*\}/);
});
