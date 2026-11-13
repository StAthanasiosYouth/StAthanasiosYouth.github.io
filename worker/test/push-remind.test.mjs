// Site wave 5 (S4 «فكّرني لما تبدأ»): one device, one competition, a push at its start — and never twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.mjs';
import { pushHash } from '../src/push/devices.js';
import { forgetAccessToken, OAUTH_URL } from '../src/push/fcm.js';
import { runPart } from '../src/push/send.js';
import { remindTick, COVER_MS } from '../src/push/remind.js';
import { wallMs } from '../src/push/schedule.js';
import { cairoText } from '../src/lib/db.js';

const tok = n => ('tok_ok_' + n + '_').padEnd(150, 'x');
const pem = async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  return '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----\n';
};
const ACCOUNT = JSON.stringify({ project_id: 'athanasios-test', client_email: 'push-sender@athanasios-test.iam.gserviceaccount.com', private_key: await pem() });
const fcm = () => {
  const sends = [];
  const f = async (url, init) => {
    if (url === OAUTH_URL) return Response.json({ access_token: 'at', expires_in: 3600 });
    sends.push(JSON.parse(init.body).message);
    return Response.json({ name: 'x' });
  };
  return { f, sends };
};

const wall = ms => cairoText(ms).replace(' ', 'T');   // Cairo wall time, summer or winter

async function world({ startAt, notifications = [] } = {}) {
  forgetAccessToken();
  const h = harness({ env: { ADMIN_EMAILS: '', FCM_SERVICE_ACCOUNT: ACCOUNT } });
  await h.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('PUSH_SENDER', 'worker', 0)").run();
  const content = (start, notes) => JSON.stringify({ notifications: notes, competitions: [{ slug: 'quiz', title: 'مسابقة التجربة', startAt: start, endAt: '' }] });
  await h.db.prepare("INSERT INTO published_revisions (id, kind, key, rev, hash, body, live, publish_id, published_at) VALUES ('rev-1', 'content', 'site', 1, 'h', ?, 1, 'pub-1', 0)").bind(content(startAt, notifications)).run();
  const republish = (start, notes = notifications) => h.db.prepare("UPDATE published_revisions SET body = ? WHERE id = 'rev-1'").bind(content(start, notes)).run();
  const device = async token => {
    const id = await pushHash(token);
    await h.db.prepare("INSERT INTO push_devices (id, token, audience, topics, created_ms, last_ms) VALUES (?, ?, 'public', '[]', 1, 1)").bind(id, token).run();
    return id;
  };
  const remind = (token, on, slug = 'quiz') => h.call('/v1/push/remind', { method: 'POST', body: { token, slug, on } });
  const rows = () => h.db.prepare('SELECT * FROM push_reminders ORDER BY device_id').all().then(r => r.results);
  const drain = async f => { for (let list = h.sent.splice(0); list.length; list = h.sent.splice(0)) for (const j of list) if (j.type === 'push.fanout') await runPart(h.env, j.payload, f); };
  return { h, device, remind, rows, drain, republish };
}

test('asking and cancelling: a subscribed device only, a published competition not started yet', async () => {
  const start = wall(Date.now() + 3 * 86400000);
  const w = await world({ startAt: start });
  assert.equal((await w.remind(tok(1), true)).body.code, 'no_device', 'turn notifications on first');
  await w.device(tok(1));
  const on = await w.remind(tok(1), true);
  assert.deepEqual([on.body.ok, on.body.on, on.body.at], [true, true, wallMs(start)]);
  assert.equal((await w.rows()).length, 1);
  assert.equal((await w.remind(tok(1), true)).body.ok, true, 'again: still one');
  assert.equal((await w.rows()).length, 1);
  assert.equal((await w.remind(tok(1), true, 'nope')).body.code, 'not_found');
  assert.equal((await w.remind('short', true)).body.code, 'invalid');
  const off = await w.remind(tok(1), false);
  assert.deepEqual([off.body.ok, off.body.on], [true, false]);
  assert.equal((await w.rows()).length, 0);

  const late = await world({ startAt: wall(Date.now() - 60000) });
  await late.device(tok(2));
  assert.equal((await late.remind(tok(2), true)).body.code, 'started');
});

test('the start: only the devices that asked, once; a moved start waits; the competition\'s own push covers it', async () => {
  const startMs = Math.floor((Date.now() + 86400000) / 60000) * 60000;
  const w = await world({ startAt: wall(startMs) });
  await w.device(tok(1));
  await w.device(tok(2));
  await w.device(tok(3));   // never asked
  await w.remind(tok(1), true);
  await w.remind(tok(2), true);

  assert.equal(await remindTick(w.h.env, startMs - 60000), null, 'nothing before the start');

  // the admin moves the start an hour later: the reminder follows
  await w.republish(wall(startMs + 3600000));
  assert.deepEqual(await remindTick(w.h.env, startMs + 60000), { sent: 0, covered: 0, dropped: 0 });
  assert.ok((await w.rows()).every(r => r.at_ms === startMs + 3600000 && r.sent_ms === null));

  const { f, sends } = fcm();
  const r = await remindTick(w.h.env, startMs + 3600000, f);
  assert.deepEqual(r, { sent: 2, covered: 0, dropped: 0 });
  await w.drain(f);
  assert.equal(sends.length, 2, 'the two that asked, not the third');
  assert.equal(sends[0].data.url, '/competition/quiz/');
  assert.match(sends[0].data.title, /المسابقة بدأت: مسابقة التجربة/);
  assert.equal(await remindTick(w.h.env, startMs + 3660000, f), null, 'nothing twice');

  // a competition that also has its own push to everyone (a bell item aimed at it), sent at its start
  const s2 = Math.floor((Date.now() + 2 * 86400000) / 60000) * 60000;
  const notes = [{ id: 'n-quiz', type: 'competition', title: 'مسابقة جديدة', target: { kind: 'competition', slug: 'quiz' } }];
  const b = await world({ startAt: wall(s2), notifications: notes });
  await b.device(tok(4));
  await b.remind(tok(4), true);
  await b.h.db.prepare("INSERT INTO push_sends (id, audience, ref, status, by, started_ms, targets, parts, message, ttl) VALUES ('ps-aaaaaa', 'public', 'n-quiz', 'sent', 'auto', ?, 1, 1, '{}', 60)").bind(s2 - COVER_MS + 60000).run();
  assert.deepEqual(await remindTick(b.h.env, s2), { sent: 0, covered: 1, dropped: 0 }, 'one push for one thing');
  assert.ok((await b.rows())[0].sent_ms);

  // taken down before it started: dropped
  const c = await world({ startAt: wall(s2) });
  await c.device(tok(5));
  await c.remind(tok(5), true);
  await c.h.db.prepare("UPDATE published_revisions SET body = '{\"notifications\":[],\"competitions\":[]}'").run();
  assert.deepEqual(await remindTick(c.h.env, s2), { sent: 0, covered: 0, dropped: 1 });
  assert.equal((await c.rows()).length, 0);
});
