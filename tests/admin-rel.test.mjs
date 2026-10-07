// Admin reliability / collaboration (server side, apps-script/Presence.gs):
// one live session per Google account, who is online, and edit locks that
// the save / delete / archive / toggle functions enforce — in API mode only.
// The recovery admin (HtmlService) is unchanged.
//
// Browser side: tests/admin-rel.e2e.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './fakes/gas.mjs';

const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'second.admin@gmail.com';
const THIRD = 'third.admin@gmail.com';
const CLIENT = '1234-abc.apps.googleusercontent.com';

const plain = value => JSON.parse(JSON.stringify(value));

function apiWorld() {
  const world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'ghp_SECRETsecretSECRETsecret1234567890');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');
  world.properties.set('ADMIN_CLIENT_ID', CLIENT);
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}, ${THIRD}`);
  // two news items to edit
  const gs = world.gs;
  gs.apiSaveItem('news', { id: 'news-aaaa1111', title: 'خبر أول', summary: 'x' });
  gs.apiSaveItem('news', { id: 'news-bbbb2222', title: 'خبر تاني', summary: 'x' });
  world.as('');
  return world;
}

/* a browser tab: its token, its session */
function tab(world, email, options = {}) {
  const token = world.issueToken({ email });
  const page = {
    token,
    sid: '',
    start(extra = {}) {
      const reply = world.post({ fn: 'apiSessionStart', args: [{ device: options.device || 'كمبيوتر ويندوز – Chrome', tab: options.tab, ...extra }], token });
      if (reply.ok && reply.result.sid) page.sid = reply.result.sid;
      return reply;
    },
    call(fn, ...args) { return world.post({ fn, args, token, sid: page.sid }); },
    beat(info = {}) { return page.call('apiHeartbeat', info); }
  };
  return page;
}

const newsIds = world => world.gs.readTable_('News').map(r => r.id);


/* ---------------- one session per account ---------------- */

test('session: start issues a random sid with the state; a second device is told, not let in; force takes over at once', () => {
  const world = apiWorld();
  const laptop = tab(world, ADMIN, { device: 'كمبيوتر ويندوز – Chrome' });
  const phone = tab(world, ADMIN, { device: 'موبايل أندرويد – Chrome' });

  const first = laptop.start();
  assert.equal(first.ok, true);
  assert.match(first.result.sid, /^[0-9a-f-]{36}$/, 'a UUID from the server');
  assert.equal(first.result.state.user, ADMIN, 'the panel state comes with it (one round trip)');
  assert.equal(laptop.call('apiState').ok, true);

  world.advance(20_000);
  const busy = phone.start();
  assert.equal(busy.ok, true);
  assert.equal(busy.result.sid, undefined, 'no session for the second device');
  assert.equal(busy.result.state, undefined);
  assert.deepEqual(plain(busy.result.active), { device: 'كمبيوتر ويندوز – Chrome', since: 20, seen: 20 });
  assert.equal(laptop.call('apiState').ok, true, 'the first one keeps working');

  const forced = phone.start({ force: true });
  assert.equal(forced.ok, true);
  assert.notEqual(forced.result.sid, first.result.sid);
  assert.equal(phone.call('apiState').ok, true);

  // the old tab stops at once, for every function
  for (const fn of Object.keys(world.gs.apiFunctions_()).filter(f => f !== 'apiSessionStart')) {
    const reply = laptop.call(fn);
    assert.equal(reply.ok, false, fn);
    assert.equal(reply.code, 'session_replaced', fn);
  }
  assert.equal(JSON.parse(laptop.call('apiState').error).message, 'الجلسة اتقفلت لأنك دخلت من جهاز تاني.');
  assert.ok(world.spreadsheet.getSheetByName('Log').data.some(r => r[2] === 'session.takeover'), 'a takeover is logged');
});

test('session: a stale one (no heartbeat ~90 s) is replaced without asking; a retry from the same page is never "another device"', () => {
  const world = apiWorld();
  const old = tab(world, ADMIN);
  old.start();
  world.advance(91_000);
  const fresh = tab(world, ADMIN);
  const reply = fresh.start();
  assert.ok(reply.result.sid, 'taken over without a question');
  assert.equal(old.call('apiState').code, 'session_replaced', 'the stale tab is out when it wakes up');

  // the same page load (tab id) asking again, e.g. after a timeout, gets a session
  const page = tab(world, SECOND, { tab: 'tab-0123456789abcdef0123' });
  const one = page.start();
  const two = page.start();
  assert.ok(one.result.sid && two.result.sid && one.result.sid !== two.result.sid);
  assert.equal(page.call('apiState').ok, true);
  // its panel is drawn (a heartbeat); a session that never got that far on a
  // look-alike device is a reload mid-sign-in instead (tests/prog-b.test.mjs)
  page.beat({ area: 'home' });
  // a different page load of the same account is asked
  assert.ok(tab(world, SECOND, { tab: 'tab-ffffffffffffffffffff' }).start().result.active);
});

test('session: every call without a valid sid fails closed (missing, malformed, wrong, someone else\'s); nothing runs', () => {
  const world = apiWorld();
  const mine = tab(world, ADMIN);
  const other = tab(world, SECOND);
  mine.start();
  other.start();
  const before = JSON.stringify(world.spreadsheet.getSheets().map(s => [s.name, s.data]));

  for (const fn of Object.keys(world.gs.apiFunctions_()).filter(f => f !== 'apiSessionStart')) {
    for (const [kind, sid] of [['missing', undefined], ['empty', ''], ['short', 'abc'], ['object', { a: 1 }], ['wrong', '00000000-0000-4000-8000-000000000000'], ['other account', other.sid]]) {
      const body = { fn, args: [], token: mine.token };
      if (sid !== undefined) body.sid = sid;
      const reply = world.post(body);
      assert.equal(reply.ok, false, `${fn} ${kind}`);
      assert.equal(reply.code, 'session_replaced', `${fn} ${kind}`);
    }
  }
  assert.equal(JSON.stringify(world.spreadsheet.getSheets().map(s => [s.name, s.data])), before, 'nothing changed');

  // the sid is not a credential: without a good token it is nothing
  for (const token of [undefined, '', world.issueToken({ email: 'someone@gmail.com' })]) {
    const reply = world.post({ fn: 'apiState', args: [], token, sid: mine.sid });
    assert.ok(['auth', 'denied'].includes(reply.code));
  }
  // another admin's token with my sid: refused (the email comes from the token only)
  assert.equal(world.post({ fn: 'apiState', args: [], token: world.issueToken({ email: THIRD }), sid: mine.sid }).ok, false);
});

test('session: ended (sign out / page closed) or forgotten → session_expired, and the page simply starts a new one', () => {
  const world = apiWorld();
  const page = tab(world, ADMIN);
  page.start();
  page.call('apiHeartbeat', { locks: ['news:news-aaaa1111'] });
  assert.equal(page.call('apiSessionEnd').result.ended, true);
  const reply = page.call('apiState');
  assert.equal(reply.code, 'session_expired');
  assert.ok(![...world.cache.keys()].some(k => k.startsWith('adm:lck:')), 'its locks went with it');

  // nobody else is on: starting again needs no question
  const again = page.start({ state: false });
  assert.ok(again.result.sid);
  assert.equal(again.result.state, null, 'a quiet restart: no state');
  assert.equal(page.call('apiState').ok, true);

  // the cache forgot it (6 h, or evicted): the same
  for (const key of [...world.cache.keys()].filter(k => k.startsWith('adm:ses:'))) world.cache.delete(key);
  assert.equal(page.call('apiState').code, 'session_expired');

  // but a tab that was taken over stays "replaced" even after the new one signs out
  const a = tab(world, SECOND);
  const b = tab(world, SECOND);
  a.start();
  b.start({ force: true });
  b.call('apiSessionEnd');
  assert.equal(a.call('apiState').code, 'session_replaced');
});

test('heartbeat keeps the session live; without it the session goes stale', () => {
  const world = apiWorld();
  const page = tab(world, ADMIN);
  page.start();
  world.advance(80_000);
  assert.equal(page.beat({ area: 'home' }).ok, true);
  world.advance(80_000);
  assert.ok(tab(world, ADMIN).start().result.active, '160 s later, still live thanks to the heartbeat');
  world.advance(91_000);
  assert.ok(tab(world, ADMIN).start().result.sid, 'no heartbeat for 91 s: stale');
});

test('HtmlService (the recovery admin) does not take part and is unchanged', () => {
  const world = createWorld();
  world.as(ADMIN).gs.setup();
  const gs = world.as(ADMIN).gs;
  assert.deepEqual(plain(gs.apiSessionStart({ device: 'x' })), { off: true });
  assert.deepEqual(plain(gs.apiHeartbeat({ locks: ['news:x'] })), { off: true });
  assert.deepEqual(plain(gs.apiSessionEnd()), { off: true });
  assert.equal(world.cache.size, 0, 'nothing stored');
  assert.equal(plain(gs.apiState()).user, ADMIN, 'calls need no sid there');
  gs.apiSaveItem('news', { id: 'news-cccc3333', title: 'x', summary: 'y' });
  assert.throws(() => world.as('someone@gmail.com').gs.apiSessionStart({}), /مش مسموح/, 'still guarded');

  // an API session's lock does not stop the recovery admin (behaviour unchanged there)
  const api = apiWorld();
  const page = tab(api, ADMIN);
  page.start();
  page.beat({ locks: ['news:news-aaaa1111'] });
  assert.doesNotThrow(() => api.as(ADMIN).gs.apiSaveItem('news', { id: 'news-aaaa1111', title: 'من لوحة الطوارئ', summary: 'x' }));
});


/* ---------------- presence ---------------- */

test('presence: the others online with where they are and what they edit — never yourself, never the expired, nothing else', () => {
  const world = apiWorld();
  const a = tab(world, ADMIN, { device: 'كمبيوتر ويندوز – Chrome' });
  const b = tab(world, SECOND, { device: 'موبايل أندرويد – Chrome' });
  a.start();
  b.start();

  a.beat({ area: 'content', view: 'news', item: { kind: 'news', id: 'news-aaaa1111', label: 'خبر «خبر أول»' } });
  world.advance(5_000);
  const seen = b.beat({ area: 'home', view: '', item: null });
  assert.equal(seen.ok, true);
  assert.deepEqual(plain(seen.result.others), [{
    email: ADMIN, name: 'menazakmena', device: 'كمبيوتر ويندوز – Chrome', seen: 5,
    area: 'content', view: 'news', item: { kind: 'news', id: 'news-aaaa1111', label: 'خبر «خبر أول»' }
  }]);

  const back = a.beat({ area: 'content', view: 'news' });
  assert.deepEqual(back.result.others.map(o => o.email), [SECOND], 'yourself is never "someone else"');
  assert.equal(back.result.others[0].area, 'home');

  const text = JSON.stringify(back.result) + JSON.stringify(seen.result);
  for (const secret of [a.sid, b.sid, a.token, b.token]) assert.ok(!text.includes(secret), 'no sid or token of anyone');

  world.advance(71_000);
  assert.deepEqual(plain(b.beat({}).result.others), [], 'gone after ~70 s without a heartbeat');
  assert.deepEqual(plain(a.beat({}).result.others).map(o => o.email), [SECOND], 'and back with the next one');

  // removed from the allowlist: not listed (and refused)
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${THIRD}`);
  assert.deepEqual(plain(a.beat({}).result.others), []);
  assert.equal(b.beat({}).code, 'denied');
});

test('presence: labels are cleaned and bounded; unknown places, kinds and lock keys are dropped', () => {
  const world = apiWorld();
  const [RLO, LRI] = [0x202E, 0x2066].map(c => String.fromCharCode(c));
  const evil = 'A' + RLO + 'evil' + String.fromCharCode(0, 10) + '<img src=x onerror=alert(1)>' + LRI + 'x'.repeat(300);
  const a = tab(world, ADMIN, { device: evil });
  a.start({ device: evil });
  const reply = a.beat({
    area: 'Content<script>', view: 'news',
    item: { kind: 'evil', id: '../../etc', label: evil },
    locks: ['news:news-aaaa1111', 'evil:x', 'news:../x', 'news:' + 'a'.repeat(200), 42, null, { k: 1 }, 'settings:a', 'settings:b', 'settings:c', 'settings:d', 'settings:e', 'settings:f']
  });
  assert.equal(reply.ok, true);
  assert.deepEqual(Object.keys(reply.result.locks), ['news:news-aaaa1111', 'settings:a', 'settings:b', 'settings:c', 'settings:d', 'settings:e'], 'clean keys only, at most 6');

  const b = tab(world, SECOND);
  b.start();
  const [shown] = b.beat({}).result.others;
  assert.equal(shown.area, '');
  assert.equal(shown.view, 'news');
  assert.equal(shown.item.kind, '');
  assert.equal(shown.item.id, '');
  for (const value of [shown.device, shown.item.label]) {
    assert.ok(value.length <= 80);
    assert.ok(![...value].some(ch => { const c = ch.charCodeAt(0); return c < 32 || (c >= 0x202A && c <= 0x202E) || (c >= 0x2066 && c <= 0x2069) || ch === '<' || ch === '>'; }), value);
  }
  assert.ok(shown.device.length <= 40);
  assert.match(shown.device, /^A evil img src=x onerror=alert\(1\) x+$/);
});

test('heartbeat while a long publish holds the script lock: no wait, no error, presence still answered', () => {
  const world = apiWorld();
  const a = tab(world, ADMIN);
  const b = tab(world, SECOND);
  a.start();
  b.start();
  b.beat({ area: 'media' });
  world.scriptLock.busy = true;
  const reply = a.beat({ locks: ['news:news-aaaa1111'] });
  world.scriptLock.busy = false;
  assert.equal(reply.ok, true);
  assert.equal(reply.result.busy, true);
  assert.deepEqual(plain(reply.result.locks), {}, 'no lock decided this time');
  assert.equal(reply.result.others[0].area, 'media');
});


/* ---------------- edit locks ---------------- */

test('locks: one editor per item; the other admin is told who and since when, and can still edit another item', () => {
  const world = apiWorld();
  const a = tab(world, ADMIN, { device: 'كمبيوتر ويندوز – Chrome' });
  const b = tab(world, SECOND);
  a.start();
  b.start();

  assert.deepEqual(plain(a.beat({ locks: ['news:news-aaaa1111'] }).result.locks), { 'news:news-aaaa1111': { granted: true } });
  world.advance(125_000 - 100_000);
  a.beat({ locks: ['news:news-aaaa1111'] });
  world.advance(100_000);
  a.beat({ locks: ['news:news-aaaa1111'] });

  const denied = b.beat({ locks: ['news:news-aaaa1111', 'news:news-bbbb2222'] }).result.locks;
  assert.deepEqual(plain(denied['news:news-aaaa1111']), { granted: false, holder: { email: ADMIN, name: 'menazakmena', device: 'كمبيوتر ويندوز – Chrome', since: 125 } });
  assert.deepEqual(plain(denied['news:news-bbbb2222']), { granted: true }, 'two items edited at the same time: fine');

  // the server refuses B's changes to A's item, naming A …
  const refused = [
    b.call('apiSaveItem', 'news', { id: 'news-aaaa1111', title: 'من B', summary: 'x' }),
    b.call('apiDeleteItem', 'news', 'news-aaaa1111'),
    b.call('apiSetItemArchived', 'news', 'news-aaaa1111', true),
    b.call('apiSetItemEnabled', 'news', 'news-aaaa1111', false)
  ];
  for (const reply of refused) {
    assert.equal(reply.ok, false);
    assert.equal(reply.code, 'locked');
    const error = JSON.parse(reply.error);
    assert.equal(error.message, 'menazakmena بيعدّل ده دلوقتي (من دقيقتين).');
  }
  assert.equal(world.gs.readTable_('News').find(r => r.id === 'news-aaaa1111').title, 'خبر أول', 'nothing changed');
  assert.deepEqual(plain(newsIds(world)), ['news-aaaa1111', 'news-bbbb2222']);

  // … but not to anything else, and not A's own
  assert.equal(b.call('apiSaveItem', 'news', { id: 'news-bbbb2222', title: 'B عدّل التاني', summary: 'x' }).ok, true);
  assert.equal(b.call('apiSaveItem', 'news', { title: 'جديد من B', summary: 'x' }).ok, true, 'new items need no lock');
  assert.equal(b.call('apiDuplicateItem', 'news', 'news-aaaa1111').ok, true, 'a copy reads only');
  assert.equal(a.call('apiSaveItem', 'news', { id: 'news-aaaa1111', title: 'A حفظ', summary: 'x' }).ok, true, 'the holder saves');

  // released (the editor closed: the next beat has no lock) → B can save
  a.beat({ locks: [] });
  assert.equal(b.call('apiSaveItem', 'news', { id: 'news-aaaa1111', title: 'B بعد ما A خلص', summary: 'x' }).ok, true);
  assert.deepEqual(plain(b.beat({ locks: ['news:news-aaaa1111'] }).result.locks['news:news-aaaa1111']), { granted: true });
});

test('locks: run out ~90 s after the holder\'s last heartbeat (crashed phone), and die with a replaced or ended session', () => {
  const world = apiWorld();
  const a = tab(world, ADMIN);
  const b = tab(world, SECOND);
  a.start();
  b.start();

  a.beat({ locks: ['news:news-aaaa1111'] });
  world.advance(60_000);
  a.beat({ locks: ['news:news-aaaa1111'] });   // renewed
  world.advance(60_000);
  assert.equal(b.call('apiDeleteItem', 'news', 'news-aaaa1111').code, 'locked', '120 s after taking it, renewed at 60 s: still held');
  world.advance(31_000);
  assert.equal(b.call('apiSetItemEnabled', 'news', 'news-aaaa1111', false).ok, true, '91 s after the last heartbeat: free');
  assert.equal(b.beat({ locks: ['news:news-aaaa1111'] }).result.locks['news:news-aaaa1111'].granted, true);

  // A comes back: now B holds it
  assert.equal(a.beat({ locks: ['news:news-aaaa1111'] }).result.locks['news:news-aaaa1111'].granted, false);

  // B's account signs in elsewhere (force): B's old session's locks are dead at once
  tab(world, SECOND).start({ force: true });
  assert.equal(a.call('apiSaveItem', 'news', { id: 'news-aaaa1111', title: 'A', summary: 'x' }).ok, true);
  assert.equal(a.beat({ locks: ['news:news-aaaa1111'] }).result.locks['news:news-aaaa1111'].granted, true);

  // A signs out: free at once
  a.call('apiSessionEnd');
  const c = tab(world, THIRD);
  c.start();
  assert.equal(c.call('apiDeleteItem', 'news', 'news-aaaa1111').ok, true);
});

test('locks: links, contacts, sections, settings groups, sessions, types and media are enforced the same way', () => {
  const world = apiWorld();
  world.as(ADMIN).gs.apiSaveItem('sessions', { date: '2026-10-11', topic: 'موضوع', notify: {} });
  world.as('');
  const a = tab(world, ADMIN);
  const b = tab(world, SECOND);
  a.start();
  b.start();
  const locks = ['links:facebook', 'contacts:tech-support', 'sections:social', 'settings:location', 'settings:games', 'sessions:2026-10-11'];
  assert.ok(Object.values(a.beat({ locks }).result.locks).every(s => s.granted));

  const refused = {
    'link save': b.call('apiSaveLink', { id: 'facebook', title: 'x', url: 'https://facebook.com/x', section: 'social' }),
    'link toggle': b.call('apiSetLinkEnabled', 'facebook', false),
    'link delete': b.call('apiDeleteLink', 'facebook'),
    'contact save': b.call('apiSaveContact', { id: 'tech-support', name: 'x', phone: '01012345678', method: 'call' }),
    'contact delete': b.call('apiDeleteContact', 'tech-support'),
    'section save': b.call('apiSaveSection', { key: 'social', title: 'x' }, false),
    'section toggle': b.call('apiSetSectionEnabled', 'social', false),
    'location': b.call('apiSaveSettings', { 'location.name': 'x' }),
    'one group of a card': b.call('apiSaveSettings', { 'notifications.historyDays': 7, 'games.endedHours': 6 }),
    'session save': b.call('apiSaveItem', 'sessions', { originalDate: '2026-10-11', date: '2026-10-11', topic: 'x', notify: {} }),
    'session moved onto a locked date': b.call('apiSaveItem', 'sessions', { date: '2026-10-11', topic: 'x', notify: {} }),
    'session delete': b.call('apiDeleteItem', 'sessions', '2026-10-11')
  };
  for (const [what, reply] of Object.entries(refused)) {
    assert.equal(reply.code, 'locked', what);
  }

  // other groups / items are free
  assert.equal(b.call('apiSaveSettings', { 'site.tagline': 'من B' }).ok, true);
  assert.equal(b.call('apiSaveSettings', { 'notifications.historyDays': 7 }).ok, true);
  assert.equal(b.call('apiMoveLink', 'facebook', 1).ok, true, 'order is not what the editor changes');

  // types and media
  const type = world.gs.readTable_('Types')[0];
  const typeKey = type.key;
  world.as(ADMIN).gs.upsertRow_('Media', 'id', { id: 'img-abcdef12', path: 'media/2026/img-abcdef12.webp', mime: 'image/webp', uploadedAt: '2026-10-01 10:00' });
  world.as('');
  a.beat({ locks: ['types:' + typeKey, 'media:img-abcdef12'] });
  assert.equal(b.call('apiSaveItem', 'types', { key: typeKey, label: 'x', section: type.section, isNew: false }).code, 'locked');
  assert.equal(b.call('apiUpdateMedia', 'img-abcdef12', { name: 'x' }).code, 'locked');
  assert.equal(b.call('apiSetMediaAlt', 'img-abcdef12', 'x').code, 'locked');
  assert.equal(b.call('apiDeleteMedia', 'img-abcdef12').code, 'locked');
});

test('locks: the editor\'s own session, the same account on a new session, and the page\'s list are what count', () => {
  const world = apiWorld();
  const a = tab(world, ADMIN);
  a.start();
  a.beat({ locks: ['news:news-aaaa1111', 'news:news-bbbb2222'] });
  // the page now edits only one: the other is let go
  a.beat({ locks: ['news:news-bbbb2222'] });
  const b = tab(world, SECOND);
  b.start();
  assert.equal(b.call('apiDeleteItem', 'news', 'news-aaaa1111').ok, true);
  assert.equal(b.call('apiDeleteItem', 'news', 'news-bbbb2222').code, 'locked');
  // the same account on another device (taken over): the old tab's lock no longer blocks
  const again = tab(world, ADMIN);
  again.start({ force: true });
  assert.equal(again.call('apiDeleteItem', 'news', 'news-bbbb2222').ok, true);
});
