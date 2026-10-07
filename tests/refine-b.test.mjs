// Refine B: the official admin's API (doPost + Google ID tokens), the
// allowlist from the panel, both deployment modes, and the generated
// static admin (admin/ is current, strict CSP, no secrets).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createWorld } from './fakes/gas.mjs';
import { ROOT } from '../tools/lib/gs.mjs';
import { buildAdmin } from '../tools/build-admin.mjs';

const ADMIN = 'menazakmena@gmail.com';
const SECOND = 'second.admin@gmail.com';
const STRANGER = 'someone@gmail.com';
const CLIENT = '1234-abc.apps.googleusercontent.com';

const plain = value => JSON.parse(JSON.stringify(value));
const parse = text => JSON.parse(text);

/* the API deployment: runs as the owner, anyone may call it */
function apiWorld(options = {}) {
  const world = createWorld({ executeAs: 'USER_DEPLOYING', ...options });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'ghp_SECRETsecretSECRETsecret1234567890');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');
  world.properties.set('ADMIN_CLIENT_ID', CLIENT);
  // requests come from github.io with no Google session: anonymous
  world.as('');
  return world;
}

/* the recovery admin: runs as the visitor */
function htmlWorld() {
  const world = createWorld();
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');
  return world;
}

const ARGS = {
  apiState: [], apiReview: [], apiPreview: [], apiPublish: ['x'], apiCheckGithub: [],
  apiSaveLink: [{ title: 'x', url: 'https://a.com', section: 'social' }], apiSetLinkEnabled: ['facebook', false],
  apiDeleteLink: ['facebook'], apiMoveLink: ['facebook', 1], apiSaveSection: [{ key: 'xx', title: 'x' }, true],
  apiSetSectionEnabled: ['social', false], apiDeleteSection: ['social'], apiMoveSection: ['social', 1],
  apiSaveContact: [{ name: 'x', phone: '01012345678', method: 'call' }], apiDeleteContact: ['tech-support'],
  apiMoveContact: ['tech-support', -1], apiSaveSettings: [{ 'site.tagline': 'x' }], apiResolveMapsUrl: ['https://maps.app.goo.gl/x'],
  apiSaveItem: ['news', { title: 'x' }], apiImportPreview: ['date\n2099-01-01'], apiImportApply: ['date\n2099-01-01', {}],
  apiSetLiveStage: ['2099-01-01', null], apiDeleteItem: ['news', 'x'], apiSetItemArchived: ['news', 'x', true],
  apiDuplicateItem: ['news', 'x'], apiSetItemEnabled: ['news', 'x', false], apiUploadMedia: [{}], apiCheckMedia: [],
  apiMediaLibrary: [], apiUpdateMedia: ['img-x', {}], apiDeleteMedia: ['img-x'], apiRestoreMedia: ['img-x'],
  apiPurgeMedia: ['img-x'], apiMediaPreview: ['img-x'], apiSetMediaAlt: ['img-x', 'x'], apiPlanMigration: [], apiMigrate: [],
  apiAdmins: [], apiAddAdmin: ['x@gmail.com'], apiRemoveAdmin: [SECOND],
  apiSessionStart: [{ device: 'x' }], apiSessionResume: [{ device: 'x' }], apiHeartbeat: [{}], apiSessionEnd: []
};

/*
 * A signed-in page: it starts its session (Presence.gs, tests/admin-rel.test.mjs)
 * and then sends every call with the token and that session id.
 */
function signedIn(world, token) {
  const started = world.post({ fn: 'apiSessionStart', args: [{ device: 'test', force: true, state: false }], token });
  assert.equal(started.ok, true, `session: ${started.error}`);
  return (fn, args = []) => world.post({ fn, args, token, sid: started.result.sid });
}

/* everything that can change on a call */
const snapshot = world => JSON.stringify({ props: [...world.properties], sheets: world.spreadsheet.getSheets().map(s => [s.name, s.data]), head: world.github.head });


/* ---------------- dispatch ---------------- */

test('API: dispatches exactly the api* functions, listed by name, nothing else', () => {
  const world = apiWorld();
  const listed = Object.keys(world.gs.apiFunctions_()).sort();
  const all = Object.keys(world.gs).filter(k => /^api[A-Z]\w*$/.test(k) && !k.endsWith('_') && typeof world.gs[k] === 'function').sort();
  assert.deepEqual(listed, all, 'every api* function is listed, and only those');
  for (const name of listed) assert.equal(typeof world.gs.apiFunctions_()[name], 'function', name);
  assert.deepEqual(Object.keys(ARGS).sort(), listed, 'this test covers every one of them');

  const token = world.issueToken({ email: ADMIN });
  const before = snapshot(world);
  for (const fn of ['setup', 'migrate', 'checkSheet', 'clearStrayIds', 'checkMedia', 'planMigration', 'doGet', 'doPost',
    'apiFunctions_', 'assertAdmin_', 'adminEmails_', 'readDraft_', 'githubConfig_', 'constructor', '__proto__', 'toString',
    'hasOwnProperty', 'eval', 'Function', 'PropertiesService', 'buildPublicContent', 'apiState ', '']) {
    const reply = world.post({ fn, args: [], token });
    assert.equal(reply.ok, false, fn);
    assert.equal(reply.code, 'fn', fn);
    assert.equal(reply.mime, 'JSON');
  }
  assert.equal(snapshot(world), before, 'nothing ran');
});

test('API: an allowlisted Google account works, as itself', () => {
  const world = apiWorld();
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  const token = world.issueToken({ email: 'Second.Admin@Gmail.com' });

  const call = signedIn(world, token);
  const state = call('apiState');
  assert.equal(state.ok, true);
  assert.equal(state.mime, 'JSON');
  assert.equal(state.result.user, SECOND, 'the verified token email, lower-cased');

  const saved = call('apiSaveSettings', [{ 'site.tagline': 'من الـ API' }]);
  assert.equal(saved.ok, true);
  const log = world.spreadsheet.getSheetByName('Log').data;
  assert.equal(log.at(-1)[1], SECOND, 'logged as the token\'s account');
  assert.equal(world.gs.API_REQUEST_, null, 'request identity is cleared after the request');

  // a validation error comes back in the same shape google.script.run gives the page
  const bad = call('apiSaveLink', [{ title: '', url: 'https://a.com', section: 'social' }]);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /العنوان مطلوب/);
  assert.equal(bad.code, '');
});

test('API: no / bad / expired / wrong-audience / wrong-issuer / unverified token fails closed for EVERY function', () => {
  const world = apiWorld();
  const now = Math.floor(Date.now() / 1000);
  const tokens = {
    missing: undefined,
    empty: '',
    garbage: 'not-a-token',
    unknown: 'aaaaaaaaaaaa.bbbbbbbbbbbbbbbb.cccccccccccc',
    expired: world.issueToken({ email: ADMIN, exp: String(now - 10) }),
    wrongAudience: world.issueToken({ email: ADMIN, aud: 'someone-else.apps.googleusercontent.com' }),
    wrongIssuer: world.issueToken({ email: ADMIN, iss: 'https://evil.example.com' }),
    unverified: world.issueToken({ email: ADMIN, email_verified: 'false' }),
    noEmail: world.issueToken({ email: '' }),
    huge: 'a'.repeat(3000) + '.' + 'b'.repeat(3000) + '.c'
  };
  // Google itself says this one is fine, but it is past exp by our clock
  tokens.staleButVerified = world.issueToken({ email: ADMIN });
  world.idTokens.get(tokens.staleButVerified).exp = String(now - 1);
  world.idTokens.set(tokens.staleButVerified, { ...world.idTokens.get(tokens.staleButVerified) });

  const before = snapshot(world);
  for (const [kind, token] of Object.entries(tokens)) {
    for (const [fn, args] of Object.entries(ARGS)) {
      const body = { fn, args };
      if (token !== undefined) body.token = token;
      const reply = world.post(body);
      assert.equal(reply.ok, false, `${kind} ${fn}`);
      assert.equal(reply.code, 'auth', `${kind} ${fn}`);
      assert.equal(reply.result, undefined);
      assert.match(JSON.parse(reply.error).message, /لازم تدخل بحساب جوجل/);
    }
  }
  assert.equal(snapshot(world), before, 'nothing changed');
});

test('API: an ID token is never put in a URL, and verification is cached per token until it expires', () => {
  const world = apiWorld();
  const token = world.issueToken({ email: ADMIN });
  const call = signedIn(world, token);
  assert.equal(call('apiAdmins').ok, true);
  assert.equal(call('apiAdmins').ok, true);
  assert.equal(call('apiState').ok, true);
  assert.equal(world.tokeninfo.calls, 1, 'Google asked once');

  const [key, entry] = [...world.cache].find(([k]) => k.startsWith('idtoken:'));
  assert.match(key, /^idtoken:[0-9a-f]{64}$/, 'keyed by the token\'s hash');
  assert.ok(!key.includes(token) && !entry.value.includes(token), 'the token itself is not stored');
  assert.ok(entry.seconds > 3500 && entry.seconds <= 3600, `kept until the token expires (${entry.seconds} s)`);

  // a bad token is remembered too (Google is not asked again and again)
  world.post({ fn: 'apiState', args: [], token: 'aaaaaaaaaaaa.bbbbbbbbbbbbbbbb.cccccccccccc' });
  world.post({ fn: 'apiState', args: [], token: 'aaaaaaaaaaaa.bbbbbbbbbbbbbbbb.cccccccccccc' });
  assert.equal(world.tokeninfo.calls, 2);

  // a cached token is still checked: the client ID changed → refused
  world.properties.set('ADMIN_CLIENT_ID', 'other.apps.googleusercontent.com');
  assert.equal(world.post({ fn: 'apiState', args: [], token }).code, 'auth');
  // … and so is its expiry
  world.properties.set('ADMIN_CLIENT_ID', CLIENT);
  const cached = JSON.parse(world.cache.get(key).value);
  world.cache.get(key).value = JSON.stringify({ ...cached, exp: Math.floor(Date.now() / 1000) - 5 });
  assert.equal(world.post({ fn: 'apiState', args: [], token }).code, 'auth');
});

test('API: an account that is not on the allowlist gets the Arabic «not allowed», for every function', () => {
  const world = apiWorld();
  const token = world.issueToken({ email: STRANGER });
  const before = snapshot(world);
  for (const [fn, args] of Object.entries(ARGS)) {
    const reply = world.post({ fn, args, token });
    assert.equal(reply.ok, false, fn);
    assert.equal(reply.code, 'denied', fn);
    const error = JSON.parse(reply.error);
    assert.equal(error.message, 'مش مسموح لك تستخدم لوحة التحكم.');
    assert.ok(error.hint.includes(STRANGER), 'tells them which account they used');
    assert.ok(!error.hint.includes(ADMIN), 'never who the admins are');
  }
  assert.equal(snapshot(world), before);

  // removed from the list → refused at once (the allowlist is not cached)
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${STRANGER}`);
  const call = signedIn(world, token);
  assert.equal(call('apiState').ok, true);
  world.properties.set('ADMIN_EMAILS', ADMIN);
  assert.equal(call('apiState').code, 'denied');
});

test('API: the client ID defaults to the admin page\'s; the property overrides it; aud must match exactly', () => {
  const DEFAULT = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
  const config = readFileSync(`${ROOT}admin/config.js`, 'utf8');
  assert.ok(config.includes(`clientId: '${DEFAULT}'`), 'the same value as admin/config.js');

  // no property: the default
  const world = apiWorld();
  world.properties.delete('ADMIN_CLIENT_ID');
  assert.equal(world.gs.adminClientId_(), DEFAULT);
  const forDefault = world.issueToken({ email: ADMIN, aud: DEFAULT, azp: DEFAULT });
  assert.equal(signedIn(world, forDefault)('apiState').ok, true, 'default used');
  for (const aud of [CLIENT, 'someone-else.apps.googleusercontent.com', DEFAULT.toUpperCase(), DEFAULT + ' ', 'x' + DEFAULT, '']) {
    assert.equal(world.post({ fn: 'apiState', args: [], token: world.issueToken({ email: ADMIN, aud }) }).code, 'auth', `aud ${aud}`);
  }

  // an empty / blank property is "not set"
  world.properties.set('ADMIN_CLIENT_ID', '   ');
  assert.equal(world.gs.adminClientId_(), DEFAULT);

  // the property overrides: then the default's tokens are refused
  world.properties.set('ADMIN_CLIENT_ID', CLIENT);
  world.cache.clear();
  assert.equal(world.post({ fn: 'apiState', args: [], token: forDefault }).code, 'auth', 'another aud refused');
  assert.equal(signedIn(world, world.issueToken({ email: ADMIN, aud: CLIENT }))('apiState').ok, true, 'property used');
  for (const aud of [DEFAULT, 'someone-else.apps.googleusercontent.com']) {
    assert.equal(world.post({ fn: 'apiState', args: [], token: world.issueToken({ email: ADMIN, aud }) }).code, 'auth', `aud ${aud}`);
  }
});

test('API: a malformed ADMIN_CLIENT_ID or a broken request fails closed', () => {
  const world = apiWorld();
  const token = world.issueToken({ email: ADMIN });
  world.properties.set('ADMIN_CLIENT_ID', 'not a client id');
  assert.equal(world.post({ fn: 'apiState', args: [], token }).code, 'config');
  world.properties.set('ADMIN_CLIENT_ID', CLIENT);

  for (const body of ['', 'not json', '[]', 'null', '{"fn":1}', JSON.stringify({ fn: 'apiState', args: 'x', token }),
    JSON.stringify({ fn: 'apiState', args: [1, 2, 3, 4, 5, 6, 7], token })]) {
    const reply = world.post(body);
    assert.equal(reply.ok, false, body);
    assert.equal(reply.code, 'bad', body);
  }
  const empty = JSON.parse(world.gs.doPost(undefined).getContent());
  assert.equal(empty.ok, false);
  assert.equal(world.gs.API_REQUEST_, null);
});

test('API mode never falls back to the Google session (not even the owner\'s)', () => {
  const world = apiWorld();
  // the owner's own browser, signed in to Google, but no token in the request
  world.as(ADMIN);
  assert.equal(world.gs.Session.getActiveUser().getEmail(), ADMIN, 'the session knows the owner');
  for (const fn of Object.keys(ARGS)) {
    const reply = world.post({ fn, args: ARGS[fn] });
    assert.equal(reply.code, 'auth', fn);
  }
  // inside a request the identity is the token's, whatever the session says
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  const reply = signedIn(world, world.issueToken({ email: SECOND }))('apiState');
  assert.equal(reply.result.user, SECOND);
});

test('responses never contain Script Properties, tokens or the GitHub token', () => {
  const world = apiWorld();
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  const token = world.issueToken({ email: ADMIN });
  const secrets = ['ghp_SECRETsecretSECRETsecret1234567890', CLIENT, token];
  const call = signedIn(world, token);
  const replies = [
    call('apiState'),
    call('apiReview'),
    call('apiPreview'),
    call('apiAdmins'),
    call('apiCheckGithub'),
    call('apiHeartbeat', [{}]),
    world.post({ fn: 'apiSessionStart', args: [{}], token }),
    world.post({ fn: 'apiState', args: [], token: 'aaaaaaaaaaaa.bbbbbbbbbbbbbbbb.cccccccccccc' }),
    world.post({ fn: 'apiState', args: [], token: world.issueToken({ email: STRANGER }) }),
    world.post({ fn: 'nope', args: [], token })
  ];
  for (const reply of replies) {
    const text = JSON.stringify(reply);
    for (const secret of secrets) assert.ok(!text.includes(secret), `leaked ${secret.slice(0, 12)}…`);
    assert.ok(!/ADMIN_CLIENT_ID":|GITHUB_TOKEN":|SHEET_ID":/.test(text));
  }
  // and no function hands out the properties
  assert.ok(!Object.keys(world.gs.apiFunctions_()).some(name => /propert|secret|token/i.test(name)));
});


/* ---------------- the two deployments ---------------- */

test('doGet on the API deployment (runs as owner) never serves the admin HTML', () => {
  const world = apiWorld();
  for (const visitor of ['', STRANGER, SECOND]) {
    const output = world.as(visitor).gs.doGet({ parameter: {} });
    assert.equal(output.template, undefined, `no HtmlService page for "${visitor}"`);
    assert.equal(output.getMimeType(), 'JSON');
    const body = JSON.parse(output.getContent());
    assert.equal(body.ok, false);
    assert.equal(body.code, 'api');
  }
  // the owner himself can't be told apart from the recovery admin: he gets what it gives him
  assert.equal(world.as(ADMIN).gs.doGet().template, 'Admin');
});

test('doGet on the recovery deployment (runs as the visitor) is unchanged', () => {
  const world = htmlWorld();
  assert.equal(world.as(ADMIN).gs.doGet().template, 'Admin');
  assert.equal(world.as(STRANGER).gs.doGet().template, 'NoAccess');
  // and google.script.run there still decides by the Google session
  assert.equal(plain(world.as(ADMIN).gs.apiState()).user, ADMIN);
  assert.throws(() => world.as(STRANGER).gs.apiState(), /مش مسموح/);
});

test('owner mode without the API: google.script.run-style calls get nobody (Session is empty for visitors)', () => {
  const world = apiWorld();
  for (const fn of Object.keys(ARGS)) assert.throws(() => world.as(STRANGER).gs[fn](...ARGS[fn]), /مش مسموح/, fn);
  assert.throws(() => world.as('').gs.migrate(), /مش مسموح/, 'migrate() is guarded too');
});


/* ---------------- the allowlist («صلاحيات لوحة التحكم») ---------------- */

test('allowlist: list, add (validated, lower-cased, logged), remove (logged)', () => {
  const world = htmlWorld();
  const gs = world.as(ADMIN).gs;

  let list = plain(gs.apiAdmins());
  assert.deepEqual(list, { emails: [ADMIN], primary: ADMIN, me: ADMIN, max: 20 });

  list = plain(gs.apiAddAdmin('  Second.Admin@GMAIL.com '));
  assert.deepEqual(list.emails, [ADMIN, SECOND]);
  assert.equal(world.properties.get('ADMIN_EMAILS'), `${ADMIN}, ${SECOND}`);
  assert.doesNotThrow(() => world.as(SECOND).gs.apiState(), 'the new admin gets in');

  for (const bad of ['', 'nope', 'a@b', 'a b@gmail.com', 'x@gmail.com, y@gmail.com', 'x@gmail.com;y@gmail.com', '<x@gmail.com>', 'x'.repeat(250) + '@gmail.com', null, 42, {}]) {
    assert.throws(() => world.as(ADMIN).gs.apiAddAdmin(bad), /مش مكتوب صح/, String(bad));
  }
  assert.throws(() => world.as(ADMIN).gs.apiAddAdmin(SECOND.toUpperCase()), /قبل كده/);
  assert.equal(world.properties.get('ADMIN_EMAILS'), `${ADMIN}, ${SECOND}`, 'refused adds change nothing');

  list = plain(world.as(ADMIN).gs.apiRemoveAdmin('SECOND.admin@gmail.com'));
  assert.deepEqual(list.emails, [ADMIN]);
  assert.throws(() => world.as(SECOND).gs.apiState(), /مش مسموح/, 'removed: out at once');
  assert.throws(() => world.as(ADMIN).gs.apiRemoveAdmin(SECOND), /مش في القايمة/);

  const log = world.spreadsheet.getSheetByName('Log').data.map(r => [r[1], r[2], r[3]]);
  assert.deepEqual(log.filter(r => /^admins\./.test(r[1])), [[ADMIN, 'admins.add', SECOND], [ADMIN, 'admins.remove', SECOND]]);
});

test('allowlist: the primary admin can never be removed, the list never empty, nobody removes themselves', () => {
  const world = htmlWorld();
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);

  assert.throws(() => world.as(SECOND).gs.apiRemoveAdmin(ADMIN), /الحساب الأساسي/);
  assert.throws(() => world.as(SECOND).gs.apiRemoveAdmin(' MenaZakMena@gmail.com '), /الحساب الأساسي/);
  assert.throws(() => world.as(SECOND).gs.apiRemoveAdmin(SECOND), /تشيل نفسك/);
  assert.equal(world.properties.get('ADMIN_EMAILS'), `${ADMIN}, ${SECOND}`);

  // the primary is a Script Property (default menazakmena@gmail.com)
  world.properties.set('ADMIN_PRIMARY', SECOND);
  assert.equal(plain(world.as(ADMIN).gs.apiAdmins()).primary, SECOND);
  assert.throws(() => world.as(ADMIN).gs.apiRemoveAdmin(SECOND), /الحساب الأساسي/);
  assert.doesNotThrow(() => world.as(SECOND).gs.apiRemoveAdmin(ADMIN), 'the old primary is an ordinary admin now');
  assert.equal(world.properties.get('ADMIN_EMAILS'), SECOND);

  // never empty: a lone admin who isn't the primary still can't empty it
  world.properties.set('ADMIN_PRIMARY', 'nobody@gmail.com');
  assert.throws(() => world.as(SECOND).gs.apiRemoveAdmin(SECOND), /تشيل نفسك/);
  world.properties.set('ADMIN_EMAILS', `${SECOND}, ${STRANGER}`);
  world.as(SECOND).gs.apiRemoveAdmin(STRANGER);
  assert.equal(world.properties.get('ADMIN_EMAILS'), SECOND, 'never below one');

  // the limit
  world.properties.set('ADMIN_EMAILS', Array.from({ length: 20 }, (_, i) => i ? `a${i}@gmail.com` : SECOND).join(','));
  assert.throws(() => world.as(SECOND).gs.apiAddAdmin('one-more@gmail.com'), /أقصى عدد/);
});

test('allowlist: only admins can read or change it — in both deployments', () => {
  const world = htmlWorld();
  for (const [fn, args] of [['apiAdmins', []], ['apiAddAdmin', [STRANGER]], ['apiRemoveAdmin', [ADMIN]]]) {
    assert.throws(() => world.as(STRANGER).gs[fn](...args), /مش مسموح/, fn);
  }
  assert.equal(world.properties.get('ADMIN_EMAILS'), ADMIN);

  const api = apiWorld();
  const outsider = api.issueToken({ email: STRANGER });
  assert.equal(api.post({ fn: 'apiAddAdmin', args: [STRANGER], token: outsider }).code, 'denied');
  assert.equal(api.properties.get('ADMIN_EMAILS'), ADMIN);
  const admin = api.issueToken({ email: ADMIN });
  const added = signedIn(api, admin)('apiAddAdmin', [STRANGER]);
  assert.deepEqual(added.result.emails, [ADMIN, STRANGER]);
  const asOutsider = signedIn(api, outsider);
  assert.equal(asOutsider('apiState').ok, true, 'and now they get in');
  assert.equal(asOutsider('apiRemoveAdmin', [ADMIN]).ok, false, 'but can\'t remove the primary');
});


/* ---------------- the static admin (GitHub Pages /admin/) ---------------- */

const crlf = text => text.replace(/\r\n/g, '\n');

test('admin/ is current: generated from apps-script/Admin*.html', () => {
  for (const [path, text] of Object.entries(buildAdmin())) {
    assert.ok(existsSync(`${ROOT}${path}`), `${path} exists`);
    assert.equal(crlf(readFileSync(`${ROOT}${path}`, 'utf8')), text, `${path} is stale: cd tools && npm run build-admin`);
  }
});

test('admin/: strict CSP, noindex, no-referrer, no inline code, no redirect, no iframe', () => {
  const html = crlf(readFileSync(`${ROOT}admin/index.html`, 'utf8'));
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  const rules = Object.fromEntries(csp.split(';').map(rule => rule.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));

  assert.deepEqual(rules['default-src'], ["'none'"]);
  assert.deepEqual(rules['script-src'], ["'self'", 'https://accounts.google.com/gsi/client']);
  assert.deepEqual(rules['style-src'], ["'self'", 'https://accounts.google.com/gsi/style']);
  assert.deepEqual(rules['connect-src'], ["'self'", 'https://script.google.com', 'https://script.googleusercontent.com', 'https://accounts.google.com/gsi/']);
  assert.deepEqual(rules['frame-src'], ['https://accounts.google.com/gsi/', 'https://www.google.com']);
  assert.deepEqual(rules['img-src'], ["'self'", 'data:', 'blob:']);
  assert.deepEqual(rules['object-src'], ["'none'"]);
  assert.deepEqual(rules['base-uri'], ["'self'"], "'self': the preview frame's <base> points at the site (same origin)");
  assert.deepEqual(rules['form-action'], ["'none'"]);
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp));

  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.doesNotMatch(html, /\sstyle=|<style|<script>|\son[a-z]+="/, 'no inline style or script');
  assert.doesNotMatch(html, /<iframe|http-equiv="refresh"/i, 'never embedded, never redirected');
  // restore.js first and not deferred (final/r: the compact gate after a reload, before anything is drawn)
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]), ['restore.js', 'config.js', 'admin-app.js', 'boot.js', 'layout-check.js']);

  const boot = readFileSync(`${ROOT}admin/boot.js`, 'utf8');
  assert.match(boot, /window\.top !== window\.self/, 'frame-busting');
  assert.doesNotMatch(boot, /location\.(href\s*=|assign|replace\((?!window\.location\.href))/, 'never sends the admin elsewhere');
  // the token is kept in memory only. Since final/r this tab's sessionStorage holds the
  // server's opaque session id, where the admin was and unsaved editor values — through
  // one helper (keep), never the token (tests/final-r.test.mjs checks it in detail)
  assert.doesNotMatch(boot, /localStorage|indexedDB|document\.cookie/, 'no persistent storage, no cookies');
  const keepBlock = /var keep = \(function \(\) \{[\s\S]*?\r?\n {2}\}\)\(\);/.exec(boot);
  assert.ok(keepBlock, 'one storage helper');
  assert.doesNotMatch(boot.replace(keepBlock[0], ''), /sessionStorage\s*[.[]/, 'sessionStorage only through keep');
  assert.doesNotMatch(boot, /keep\.set\([^;]*token/, 'the token is never kept');
  assert.match(boot, /'Content-Type': 'text\/plain;charset=utf-8'/, 'a simple request: no CORS preflight');
  assert.match(boot, /credentials: 'omit'/);

  const app = readFileSync(`${ROOT}admin/admin-app.js`, 'utf8');
  assert.doesNotMatch(app, /\beval\(|new Function\(|setAttribute\('style'/);

  assert.match(readFileSync(`${ROOT}robots.txt`, 'utf8'), /^Disallow: \/admin\/$/m);
});

test('admin/config.js: the one public config place — no secrets, the right shapes', () => {
  const text = readFileSync(`${ROOT}admin/config.js`, 'utf8');
  const sandbox = {};
  new Function('window', text)(sandbox);
  const config = sandbox.ADMIN_CONFIG;
  assert.deepEqual(Object.keys(config).sort(), ['apiUrl', 'clientId', 'fallbackUrl']);
  assert.ok(config.apiUrl === '' || /^https:\/\/script\.google\.com\/macros\/s\/[\w-]{20,}\/exec$/.test(config.apiUrl), 'apiUrl: empty or an /exec URL');
  assert.match(config.clientId, /^[\w-]+\.apps\.googleusercontent\.com$/, 'the OAuth client ID (public)');
  assert.match(config.fallbackUrl, /^https:\/\/script\.google\.com\/macros\/s\/AKfycbwhHMp54vLJLK5UuwH_7zByzkPRkQErcUQdvZ1ad2_AxpasNWzShoh1CT3AIOrB8Rtbvw\/exec$/);
  assert.doesNotMatch(text, /GOCSPX|client_secret|ghp_|github_pat_|AIza/, 'no secrets');

  // the deployment ids appear nowhere else in admin/
  for (const file of ['index.html', 'boot.js', 'admin-app.js', 'gate.css', 'admin.css', 'preview-guard.js', 'layout-check.js']) {
    assert.doesNotMatch(readFileSync(`${ROOT}admin/${file}`, 'utf8'), /script\.google\.com\/macros\/s\/AK|apps\.googleusercontent\.com"/, file);
  }
});

test('the manifest keeps the Drive advanced service and its scopes, and the recovery settings', () => {
  const manifest = JSON.parse(readFileSync(`${ROOT}apps-script/appsscript.json`, 'utf8'));
  // the owner mode belongs only to the API deployment's version (docs/ADMIN-SETUP.md 8.3)
  assert.deepEqual(manifest.webapp, { executeAs: 'USER_ACCESSING', access: 'ANYONE' });
  assert.deepEqual(manifest.dependencies.enabledAdvancedServices, [{ userSymbol: 'Drive', version: 'v3', serviceId: 'drive' }]);
  for (const scope of ['spreadsheets', 'drive.file', 'script.external_request', 'userinfo.email']) {
    assert.ok(manifest.oauthScopes.includes(`https://www.googleapis.com/auth/${scope}`), scope);
  }
});
