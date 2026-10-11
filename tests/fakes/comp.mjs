// Shared set-up for the competitions tests (tests/comp-*.test.mjs): the API
// deployment (runs as the owner) with GitHub configured, an admin that
// calls through doPost exactly like /admin/ (ID token + session), the
// public calls, and small builders.

import assert from 'node:assert/strict';
import { createWorld } from './gas.mjs';

export const ADMIN = 'menazakmena@gmail.com';
export const SECOND = 'second.admin@gmail.com';
export const STRANGER = 'someone@gmail.com';
export const SITE = 'https://stathanasiosyouth.github.io/';
export const CLIENT = '1234-abc.apps.googleusercontent.com';
export const plain = value => JSON.parse(JSON.stringify(value));

/* the smallest bytes that pass the upload's WebP signature check (fill: a different image) */
export const webp = (fill = 7) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(40, fill)]);

export function compWorld(options = {}) {
  const world = createWorld({ executeAs: 'USER_DEPLOYING', ...options });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', SITE);
  world.properties.set('ADMIN_CLIENT_ID', CLIENT);
  world.properties.set('ADMIN_EMAILS', `${ADMIN}, ${SECOND}`);
  world.as('');
  return world;
}

/* an error reply's Arabic message (appError_ JSON or plain text) */
export function errorText(error) {
  try {
    const parsed = JSON.parse(error);
    return parsed.message + (parsed.hint ? ' | ' + parsed.hint : '');
  }
  catch (ignored) {
    return String(error);
  }
}

/**
 * An admin signed in to /admin/: call(fn, ...args) → result, or throws an
 * Error with the Arabic message (and .code). The ID token always expires an
 * hour after the WORLD's clock, and a lapsed session is started again, so
 * tests can move time forward freely.
 */
export function adminApi(world, email = ADMIN) {
  let token = '';
  let sid = '';
  let until = 0;

  const signIn = () => {
    until = world.now() + 3_000_000;
    token = world.issueToken({ email, exp: String(Math.floor(world.now() / 1000) + 3600) });
    const started = world.post({ fn: 'apiSessionStart', args: [{ device: 'test', force: true, state: false }], token });
    assert.equal(started.ok, true, `session: ${started.error}`);
    sid = started.result.sid;
  };

  const call = (fn, ...args) => {
    if (!token || world.now() > until) signIn();
    let reply = world.post({ fn, args, token, sid });
    if (!reply.ok && /^(auth|session_replaced|session_expired)$/.test(reply.code)) {
      signIn();
      reply = world.post({ fn, args, token, sid });
    }
    if (!reply.ok) {
      const error = new Error(errorText(reply.error));
      error.code = reply.code;
      throw error;
    }
    return reply.result;
  };

  call.sid = () => sid;
  call.raw = (fn, ...args) => {
    if (!token || world.now() > until) signIn();
    return world.post({ fn, args, token, sid });
  };

  return call;
}

/* a public call (no token): the reply object */
export const pub = (world, fn, arg) => {
  const reply = world.post({ fn, args: arg === undefined ? [] : [arg] });
  delete reply.mime;
  return reply;
};

/* a client key like the page's (a UUID) */
let keys = 0;
export const clientKey = () => `key-${Date.now().toString(36)}-${(++keys).toString(36).padStart(6, '0')}`;

/* Cairo wall clock "YYYY-MM-DD HH:MM", minutes from the world's now */
export function wallAt(world, minutes = 0) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(world.now() + minutes * 60000)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/* review + publish; returns { revision, commit, files } */
export function publish(world, call) {
  const review = call('apiReview');
  assert.deepEqual(review.errors, [], 'no publish errors: ' + JSON.stringify(review.errors));
  const result = call('apiPublish', review.revision);
  return { ...result, review, files: world.github.files() };
}

/* a typical scored competition with a few questions of every kind */
export function scoredComp(call, overrides = {}) {
  const created = call('apiCompCreate', { preset: 'scored', title: 'مسابقة الكتاب المقدس', slug: 'bible-quiz', enabled: true, description: 'اختبر معلوماتك', ...overrides });
  const id = created.comp.id;
  const q = input => call('apiCompQuestionSave', id, input).question;
  const questions = {
    single: q({ type: 'single', text: 'مين بنى الفلك؟', choices: [{ text: 'نوح', correct: true }, { text: 'موسى' }, { text: 'إبراهيم' }], points: 10 }),
    multi: q({ type: 'multi', text: 'اختار الأناجيل', choices: [{ text: 'متى', correct: true }, { text: 'مرقس', correct: true }, { text: 'أعمال الرسل' }], points: 10 }),
    tf: q({ type: 'truefalse', text: 'داود قتل جليات', correct: 'صح', points: 5 }),
    short: q({ type: 'short', text: 'اسم أول سفر؟', correct: ['التكوين', 'سفر التكوين'], points: 5 }),
    number: q({ type: 'number', text: 'كام سفر في العهد الجديد؟', correct: '٢٧', points: 5 }),
    long: q({ type: 'long', text: 'اكتب تأمل قصير', points: 10, required: false }),
    info: q({ type: 'info', text: 'الجزء التاني من المسابقة' })
  };
  return { id, comp: created.comp, questions };
}
