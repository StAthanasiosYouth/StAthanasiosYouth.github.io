/*
 * /v1/account/* — the youth account's public API (docs/YOUTH-ACCOUNTS-PLAN.md
 * §6, §8, §10, docs/PHASE5-PLAN.md P5-1, P5-2). Off until accounts_mode = 'on'.
 *
 * Existence answers are the owner's decision (§8.4): explicit, and only behind
 * Turnstile, rate limits and uniform timing. «نسيت الباسورد» is always neutral.
 * Replies and logs never hold a code, a password or a token, except the one
 * reply that hands a new password to its owner.
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { randomId, base32Id, pseudonym } from '../lib/hash.js';
import { activityStmt } from '../lib/activity.js';
import { hit, limit, clientIp } from '../lib/ratelimit.js';
import { checkTurnstile, turnstileSiteKey } from '../book/turnstile.js';
import { SUPPORT_PHONE, SUPPORT_WHATSAPP, SUPPORT_EMAIL } from '../notify/templates.js';
import {
  cleanEmail, validEmail, disposableEmail, canonEmail, phoneParts, checkName, normName, firstName, checkBirthDate, rulesFrom, eligibility
} from './model.js';
import {
  generatePassword, passwordHash, passwordEncrypt, generateCode, cleanCode, codeHash, sameHex
} from './secret.js';
import { newSession, requireAccount, endSession, revokeAllStmt } from './session.js';
import { CODE_MINUTES, isTestInbox, codesReady, codeRow, sendCode } from './mail.js';
import { memberEmailStmt, GROUPS, ALWAYS_ON } from '../notify/member.js';
import { memberPoints } from '../points/ledger.js';
import { accountBookings, accountBookingLink } from '../book/account.js';

const SETTINGS = ['accounts_mode', 'OTP_EMAIL', 'age_min', 'age_max', 'age_warn_days', 'session_days_device', 'session_hours_shared', 'discovery_daily_cap',
  'GMAIL_HEALTH', 'MAIL_DAILY_TARGET', 'MAIL_ADMIN_BUDGET', 'MAIL_RESERVE_CRITICAL', 'MAIL_RESERVE_OTP', 'MAIL_RESERVE_MEMBER', 'support_contact'];
const CODE_TTL_MS = CODE_MINUTES * 60000;
const PENDING_TTL_MS = 30 * 60000;
const RESEND_MS = 60000;
const MAX_TRIES = 5;
const CODES_PER_DAY = 5;
const FAIL_CHALLENGE = 5;      // wrong passwords on one account before the visible check
const FAIL_COOLDOWN = 10;      // … before 15 minutes of rest (never a permanent lock)
const FAIL_WINDOW_S = 15 * 60;
const FAIL_IP_HOURLY = 30;
const FAIL_GLOBAL_MINUTE = 120;
const DUMMY_PASSWORD = 'not-a-real-password';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readSettings(db) {
  const { results } = await retry(() => db.prepare(`SELECT key, value FROM settings WHERE key IN (${SETTINGS.map(() => '?').join(',')})`).bind(...SETTINGS).all());
  return Object.fromEntries(results.map(r => [r.key, r.value]));
}

const configured = env => !!(env.PW_PEPPER && env.PW_KEY && env.OTP_PEPPER);

const supportOf = settings => {
  try {
    return settings.support_contact ? JSON.parse(settings.support_contact) : null;
  } catch {
    return null;
  }
};

/* every route but config: off, or missing a key → «تسجيل الدخول متوقف مؤقتًا» */
async function gate(ctx) {
  const settings = await readSettings(ctx.env.DB);
  if (settings.accounts_mode !== 'on' || !configured(ctx.env)) throw new ApiError('accounts_off');
  return settings;
}

/* §8.4: the existing and the missing branch take the same time */
async function padded(ctx, fn) {
  const minMs = ctx.env.ACCOUNT_PAD_MS != null ? Number(ctx.env.ACCOUNT_PAD_MS) : 300;
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    const left = minMs - (Date.now() - t0);
    if (left > 0) await sleep(left);
  }
}

/* a hit on a counter, without raising it: { count, retryAfter } */
async function peek(ctx, bucket, who, windowS, nowMs = Date.now()) {
  const window = Math.floor(nowMs / 1000 / windowS) * windowS;
  const key = bucket + ':' + await pseudonym(ctx.env, who || 'unknown');
  const row = await retry(() => ctx.env.DB.prepare('SELECT count FROM rate_limits WHERE key = ? AND window = ?').bind(key, window).first());
  return { count: row ? row.count : 0, retryAfter: window + windowS - Math.floor(nowMs / 1000) };
}

const failHit = async (ctx, bucket, who, max, windowS) => hit(ctx.env.DB, bucket + ':' + await pseudonym(ctx.env, who || 'unknown'), max, windowS);

const findByCanon = (db, canon) => retry(() => db.prepare("SELECT * FROM participants WHERE email_canon = ? AND status <> 'deleted'").bind(canon).first());

function accountView(account, settings, now = Date.now()) {
  const e = eligibility(account, rulesFrom(settings), now);
  return {
    id: account.id,
    name: account.name,
    firstName: firstName(account.name),
    email: account.email,
    phone: account.phone,
    birthDate: account.birth_date,
    eligible: e.state === 'eligible',
    eligibility: { state: e.state, soon: e.soon, leavesAt: e.soon ? e.leavesAt : null }
  };
}

const invalid = (field, message) => new ApiError('invalid', field, { field, message });

function emailOf(body) {
  const email = cleanEmail(body.email);
  if (!validEmail(email)) throw invalid('email', 'اكتب إيميلك صح.');
  return email;
}

/* GET /v1/account/config: what the page needs before it draws the form */
export async function accountConfig(ctx) {
  const settings = await readSettings(ctx.env.DB);
  return {
    mode: settings.accounts_mode === 'on' && configured(ctx.env) ? 'on' : 'off',
    turnstile: turnstileSiteKey(ctx.env),
    support: { whatsapp: SUPPORT_WHATSAPP, phone: SUPPORT_PHONE, email: SUPPORT_EMAIL, ...(supportOf(settings) || {}) }
  };
}

/*
 * POST /v1/account/signin { email, password?, turnstile, shared? }
 * Email only → { exists }. Email + password → a session, or { exists: false }, or
 * `password` (challenge: show the check) / `rate` (cool-down) / `blocked`.
 */
export async function accountSignin(ctx) {
  const settings = await gate(ctx);
  const body = ctx.body || {};
  const ip = clientIp(ctx.request);
  const email = emailOf(body);
  const password = typeof body.password === 'string' ? body.password.slice(0, 80) : '';

  if (password) {
    const byIp = await peek(ctx, 'acct.login.fail.ip', ip, 3600);
    if (byIp.count >= FAIL_IP_HOURLY) throw new ApiError('rate', 'acct.login.fail.ip', { retryAfter: byIp.retryAfter });
    const all = await peek(ctx, 'acct.login.fail.all', 'all', 60);
    if (all.count >= FAIL_GLOBAL_MINUTE) throw new ApiError('busy', 'acct.login.fail.all');
  } else {
    await discoveryBudget(ctx, ip, settings);
  }
  await checkTurnstile(ctx, body.turnstile, ip);

  return padded(ctx, async () => {
    const db = ctx.env.DB;
    const account = await findByCanon(db, canonEmail(email));
    const hash = await passwordHash(ctx.env, password || DUMMY_PASSWORD);   // the same work either way
    if (!password) {
      if (!account) await noAccountCount(ctx);
      return { exists: !!account };
    }
    if (!account) {
      await discoveryBudget(ctx, ip, settings);
      await noAccountCount(ctx);
      return { exists: false };
    }
    const fails = await peek(ctx, 'acct.login.fail', account.id, FAIL_WINDOW_S);
    if (fails.count >= FAIL_COOLDOWN) throw new ApiError('rate', 'acct.login.fail', { retryAfter: fails.retryAfter });
    if (!sameHex(hash, account.pw_hash)) {
      const r = await failHit(ctx, 'acct.login.fail', account.id, FAIL_COOLDOWN, FAIL_WINDOW_S);
      await failHit(ctx, 'acct.login.fail.ip', ip, FAIL_IP_HOURLY, 3600);
      await failHit(ctx, 'acct.login.fail.all', 'all', FAIL_GLOBAL_MINUTE, 60);
      throw new ApiError('password', 'wrong', { exists: true, challenge: r.count >= FAIL_CHALLENGE });
    }
    if (account.status === 'blocked') throw new ApiError('blocked');
    const now = Date.now();
    const session = await newSession(ctx, account, body.shared === true ? 'shared' : 'device', settings, now);
    const signinStmts = [session.stmt];
    // a device this account never used (§4.1, opt-in; the sender checks the choice at send time)
    const seen = await retry(() => db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(device = ?), 0) AS same FROM account_sessions WHERE participant_id = ?').bind(session.device, account.id).first());
    if (seen.total > 0 && !seen.same) {
      signinStmts.push(memberEmailStmt(db, { kind: 'acct.dev', participantId: account.id, entityType: 'session', entityId: session.id, dedupeKey: 'acct:dev:' + session.id, now }));
    }
    await retry(() => db.batch(signinStmts));
    return { exists: true, session: { token: session.token, kind: session.kind, expiresAt: session.expiresAt }, account: accountView(account, settings, now) };
  });
}

/* §21.4: per IP 10 / 10 min and 40 / day; everyone 400 / day, with one admin alert at half of it (§8.4) */
async function discoveryBudget(ctx, ip, settings) {
  await limit(ctx, 'acct.discover', ip, 10, 600);
  await limit(ctx, 'acct.discover.day', ip, 40, 86400);
  const cap = Number(settings.discovery_daily_cap) || 400;
  const all = await failHit(ctx, 'acct.discover.all', 'all', cap, 86400);
  if (!all.ok) throw new ApiError('rate', 'acct.discover.all', { retryAfter: all.retryAfter });
  if (all.count === Math.ceil(cap / 2)) {
    const day = Math.floor(Date.now() / 86400000);
    ctx.defer(retry(() => activityStmt(ctx.env.DB, {
      id: 'act-ad' + day, orIgnore: true, actor: 'system', action: 'account.discover.high', entityType: 'notify', severity: 'important',
      summary: 'نص الحد اليومي لنموذج الدخول اتستهلك'
    }).run()));
  }
}

/* «حالة النظام»: how many asked about an email with no account today */
const noAccountCount = ctx => failHit(ctx, 'acct.discover.none', 'all', Number.MAX_SAFE_INTEGER, 86400);

/* per IP; per email 5 a day (over either: the friendly limit message) */
async function codeBudget(ctx, ip, canon) {
  const byEmail = await failHit(ctx, 'acct.otp.send', canon, CODES_PER_DAY, 86400);
  if (!byEmail.ok) throw new ApiError('otp_limit');
  const byIp = await failHit(ctx, 'acct.otp.send.ip', ip, 20, 3600);
  if (!byIp.ok) throw new ApiError('otp_limit');
}

/*
 * POST /v1/account/register/start { email, phone, name, birthDate, hp, turnstile }
 * → { pendingId, email, minutes, resendAfter }. Nothing but a pending row exists until
 * the code is right. Asking again (resend, an edited form) replaces the pending row.
 */
export async function accountRegisterStart(ctx) {
  const settings = await gate(ctx);
  const body = ctx.body || {};
  const ip = clientIp(ctx.request);
  if (body.hp) throw new ApiError('bad', 'hp');
  await limit(ctx, 'acct.register', ip, 30, 3600);
  await limit(ctx, 'acct.register.day', ip, 100, 86400);

  const email = emailOf(body);
  if (disposableEmail(email)) throw invalid('email', 'الإيميل ده مؤقت. استخدم إيميلك الأساسي.');
  const phone = phoneParts(body.phone);
  if (!phone) throw invalid('phone', 'اكتب رقم موبايل مصري صح.');
  const name = checkName(body.name);
  if (!name.name) throw invalid('name', name.message);
  const birth = checkBirthDate(body.birthDate);
  if (!birth.birthDate) throw invalid('birthDate', birth.message);
  await checkTurnstile(ctx, body.turnstile, ip);

  const db = ctx.env.DB;
  const now = Date.now();
  const canon = canonEmail(email);
  const taken = await retry(() => db.prepare("SELECT email_canon, phone_norm FROM participants WHERE (email_canon = ? OR phone_norm = ?) AND status <> 'deleted' LIMIT 2").bind(canon, phone.phoneNorm).all());
  if (taken.results.some(r => r.email_canon === canon)) throw new ApiError('dup_email');
  if (taken.results.length) throw new ApiError('dup_phone');

  const old = await retry(() => db.prepare('SELECT id, sends, last_sent_at FROM pending_registrations WHERE email_canon = ?').bind(canon).first());
  if (old && now - old.last_sent_at < RESEND_MS) throw new ApiError('otp_wait', 'cooldown', { retryAfter: Math.ceil((RESEND_MS - (now - old.last_sent_at)) / 1000) });
  const testInbox = isTestInbox(ctx.env, email);
  if (!testInbox && !(await codesReady(ctx.env, settings, now))) throw new ApiError('mail_down');
  await codeBudget(ctx, ip, canon);

  const id = old ? old.id : randomId('reg-', 12);
  const sends = old ? old.sends + 1 : 1;
  const code = generateCode();
  const data = JSON.stringify({ name: name.name, email, phone: phone.phone, phoneNorm: phone.phoneNorm, birthDate: birth.birthDate });
  const row = codeRow(db, { kind: 'otp_register', dedupeKey: `otp:reg:${id}:${sends}`, now });
  await retry(async () => db.batch([
    db.prepare(`INSERT INTO pending_registrations (id, email_canon, data, code_hash, code_expires_at, tries, sends, last_sent_at, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      ON CONFLICT(email_canon) DO UPDATE SET data = excluded.data, code_hash = excluded.code_hash, code_expires_at = excluded.code_expires_at, tries = 0, sends = excluded.sends, last_sent_at = excluded.last_sent_at, ip_hash = excluded.ip_hash`)
      .bind(id, canon, data, await codeHash(ctx.env, 'register', id, code), now + CODE_TTL_MS, sends, now, await pseudonym(ctx.env, ip), now),
    row.stmt
  ]));
  sendCode(ctx, { to: email, code, purpose: 'verify', outboxId: row.id, support: supportOf(settings), now });
  return { pendingId: id, email, minutes: CODE_MINUTES, resendAfter: RESEND_MS / 1000, ...(testInbox ? { testCode: code } : {}) };
}

/* a wrong code: one try less, or the code is dead */
function wrongCode(triesAfter) {
  const left = MAX_TRIES - triesAfter;
  if (left <= 0) return new ApiError('otp_dead');
  return new ApiError('otp_bad', 'wrong', { left, message: 'الكود غلط، فاضل لك ' + String(left).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]) + ' محاولات.' });
}

const uniqueField = err => {
  const m = String(err && err.message);
  if (!/UNIQUE/i.test(m)) return '';
  return /email_canon|participants_email/.test(m) ? 'email' : /phone_norm|participants_phone/.test(m) ? 'phone' : '';
};

/*
 * POST /v1/account/register/verify { pendingId, code } → { email, password, firstName, eligible }
 * A right code creates the account, verified, with its generated password, in one
 * batch (the UNIQUE indexes are the final guard). This reply is the only time the
 * password leaves without a Primary Admin; the page shows it as a real sign-in form.
 */
export async function accountRegisterVerify(ctx) {
  const settings = await gate(ctx);
  const body = ctx.body || {};
  await limit(ctx, 'acct.otp.try.ip', clientIp(ctx.request), 60, 600);
  const pendingId = String(body.pendingId || '');
  const code = cleanCode(body.code);
  if (!/^reg-[0-9a-f]{24}$/.test(pendingId)) throw new ApiError('otp_expired');
  if (!/^\d{6}$/.test(code)) throw invalid('code', 'الكود ٦ أرقام.');
  const db = ctx.env.DB;
  const now = Date.now();
  const pending = await retry(() => db.prepare('SELECT * FROM pending_registrations WHERE id = ?').bind(pendingId).first());
  if (!pending || pending.created_at + PENDING_TTL_MS < now || pending.code_expires_at < now) throw new ApiError('otp_expired');
  if (pending.tries >= MAX_TRIES) throw new ApiError('otp_dead');
  if (!sameHex(await codeHash(ctx.env, 'register', pendingId, code), pending.code_hash)) {
    const row = await retry(() => db.prepare('UPDATE pending_registrations SET tries = tries + 1 WHERE id = ? RETURNING tries').bind(pendingId).first());
    throw wrongCode(row ? row.tries : MAX_TRIES);
  }

  const form = JSON.parse(pending.data);
  const id = base32Id('p-', 8);
  const password = generatePassword();
  const account = {
    id, name: form.name, status: 'active', birth_date: form.birthDate, eligibility_override: null, email: form.email, phone: form.phone, pw_version: 1
  };
  const stmts = [
    db.prepare(`INSERT INTO participants (id, name, name_norm, email, email_canon, email_verified_at, email_source, email_verified_via, phone, phone_norm, birth_date, pw_hash, pw_enc, pw_version, pw_issued_at, pw_issued_by, created_via, reg_ip_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'self', 'otp', ?, ?, ?, ?, ?, 1, ?, 'self', 'self', ?, ?, ?)`)
      .bind(id, form.name, normName(form.name), form.email, pending.email_canon, now, form.phone, form.phoneNorm, form.birthDate, await passwordHash(ctx.env, password), await passwordEncrypt(ctx.env, id, 1, password), now, pending.ip_hash, now, now),
    db.prepare('INSERT INTO participant_audit (id, participant_id, at, actor, action) VALUES (?, ?, ?, ?, ?)').bind(randomId('pa-', 8), id, now, 'self', 'register'),
    activityStmt(db, { at: now, actor: 'account', action: 'account.register', entityType: 'participant', entityId: id, summary: 'حساب جديد' }),
    db.prepare('DELETE FROM pending_registrations WHERE id = ?').bind(pendingId)
  ];
  try {
    await retry(() => db.batch(stmts));
  } catch (err) {
    const field = uniqueField(err);
    if (!field) throw err;
    await retry(() => db.prepare('DELETE FROM pending_registrations WHERE id = ?').bind(pendingId).run());
    throw new ApiError(field === 'email' ? 'dup_email' : 'dup_phone');
  }
  const view = accountView(account, settings, now);
  return { email: form.email, password, firstName: view.firstName, eligible: view.eligible };
}

/* GET /v1/account/me */
export async function accountMe(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  return { account: accountView(account, settings) };
}

/* GET /v1/account/bookings: this account's bookings */
export async function accountBookingsList(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  return accountBookings(ctx, account);
}

/* POST /v1/account/bookings/link { token } */
export async function accountBookingsLink(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  return accountBookingLink(ctx, account);
}

/* GET /v1/account/points: «نقاطي» */
export async function accountPoints(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  return memberPoints(ctx, account, settings);
}

/* GET /v1/account/security: where this account is signed in. Device families only. */
export async function accountSecurity(ctx) {
  const settings = await gate(ctx);
  const { account, session } = await requireAccount(ctx, settings);
  const now = Date.now();
  const { results } = await retry(() => ctx.env.DB.prepare('SELECT id, device, kind, last_seen FROM account_sessions WHERE participant_id = ? AND revoked_at IS NULL AND expires_at > ? AND pw_version = ? ORDER BY last_seen DESC LIMIT 30').bind(account.id, now, account.pw_version).all());
  return { sessions: results.map(r => ({ device: r.device || 'جهاز', kind: r.kind, lastSeen: r.last_seen, current: r.id === session.id })) };
}

/* GET /v1/account/prefs: «إشعاراتي» (§8) */
export async function accountPrefs(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  return prefsView(ctx, account);
}

async function prefsView(ctx, account) {
  const { results } = await retry(() => ctx.env.DB.prepare('SELECT grp, mode FROM member_prefs WHERE participant_id = ?').bind(account.id).all());
  const saved = Object.fromEntries(results.map(r => [r.grp, r.mode]));
  return {
    groups: Object.entries(GROUPS).map(([key, g]) => ({ key, label: g.label, optIn: g.tier === 3, on: saved[key] ? saved[key] === 'on' : g.tier === 2 })),
    always: ALWAYS_ON
  };
}

/* POST /v1/account/prefs { prefs: { group: true|false } }: only the member changes these, never an admin */
export async function accountPrefsSave(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  await limit(ctx, 'acct.prefs', account.id, 30, 60);
  const prefs = ctx.body && ctx.body.prefs;
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) throw new ApiError('bad', 'prefs');
  const db = ctx.env.DB;
  const now = Date.now();
  const stmts = [];
  for (const [key, on] of Object.entries(prefs)) {
    if (!GROUPS[key] || typeof on !== 'boolean') throw new ApiError('bad', 'prefs');
    stmts.push(db.prepare('INSERT INTO member_prefs (participant_id, grp, mode, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(participant_id, grp) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at').bind(account.id, key, on ? 'on' : 'off', now));
  }
  if (stmts.length) await retry(() => db.batch(stmts));
  return prefsView(ctx, account);
}

/* POST /v1/account/logout { all? }: this device, or every device. Quiet without a session. */
export async function accountLogout(ctx) {
  await gate(ctx);
  const body = ctx.body || {};
  const now = Date.now();
  const ended = await endSession(ctx, now);
  if (ended && body.all === true) await retry(() => revokeAllStmt(ctx.env.DB, ended.participant_id, now).run());
  return { signedOut: true };
}

/*
 * POST /v1/account/forgot { email, turnstile } → always the same reply (§10). A code goes
 * only to an active account with a verified email, within the limits. Nothing changes
 * yet: the old password keeps working, so knowing an email can't force a reset.
 */
export async function accountForgot(ctx) {
  const settings = await gate(ctx);
  const body = ctx.body || {};
  const ip = clientIp(ctx.request);
  await limit(ctx, 'acct.forgot', ip, 10, 3600);
  const email = emailOf(body);
  await checkTurnstile(ctx, body.turnstile, ip);
  const reply = { sent: true, minutes: CODE_MINUTES, resendAfter: RESEND_MS / 1000 };
  return padded(ctx, async () => {
    const db = ctx.env.DB;
    const now = Date.now();
    const canon = canonEmail(email);
    const account = await findByCanon(db, canon);
    if (!account || account.status !== 'active' || !account.email_verified_at) return reply;
    const old = await retry(() => db.prepare("SELECT created_at FROM otp_codes WHERE participant_id = ? AND purpose = 'recover'").bind(account.id).first());
    if (old && now - old.created_at < RESEND_MS) return reply;
    const testInbox = isTestInbox(ctx.env, account.email);
    if (!testInbox && !(await codesReady(ctx.env, settings, now))) return reply;
    const byEmail = await failHit(ctx, 'acct.otp.send', canon, CODES_PER_DAY, 86400);
    if (!byEmail.ok) return reply;
    const code = generateCode();
    const row = codeRow(db, { kind: 'otp_recover', participantId: account.id, dedupeKey: `otp:rec:${account.id}:${now}`, now });
    await retry(async () => db.batch([
      db.prepare(`INSERT INTO otp_codes (participant_id, purpose, code_hash, expires_at, tries, created_at) VALUES (?, 'recover', ?, ?, 0, ?)
        ON CONFLICT(participant_id, purpose) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0, used_at = NULL, created_at = excluded.created_at`)
        .bind(account.id, await codeHash(ctx.env, 'recover', account.id, code), now + CODE_TTL_MS, now),
      row.stmt
    ]));
    sendCode(ctx, { to: account.email, code, purpose: 'recovery', outboxId: row.id, support: supportOf(settings), now });
    return { ...reply, ...(testInbox ? { testCode: code } : {}) };
  });
}

/*
 * POST /v1/account/forgot/verify { email, code } → { email, password }
 * A right code issues a new password: pw_version + 1 ends every session on every device.
 * Without a live code the answers look the same as for a wrong one, so this
 * route says nothing about whether the email has an account.
 */
export async function accountForgotVerify(ctx) {
  await gate(ctx);
  const body = ctx.body || {};
  await limit(ctx, 'acct.otp.try.ip', clientIp(ctx.request), 60, 600);
  const email = emailOf(body);
  const code = cleanCode(body.code);
  if (!/^\d{6}$/.test(code)) throw invalid('code', 'الكود ٦ أرقام.');
  return padded(ctx, async () => {
    const db = ctx.env.DB;
    const now = Date.now();
    const canon = canonEmail(email);
    const account = await findByCanon(db, canon);
    const live = account && account.status === 'active'
      ? await retry(() => db.prepare("SELECT * FROM otp_codes WHERE participant_id = ? AND purpose = 'recover' AND expires_at >= ?").bind(account.id, now).first())
      : null;
    if (live && live.tries >= MAX_TRIES) throw new ApiError('otp_dead');
    if (!live) {
      const r = await failHit(ctx, 'acct.otp.try.none', canon, MAX_TRIES, 600);
      throw wrongCode(r.count);
    }
    if (!sameHex(await codeHash(ctx.env, 'recover', account.id, code), live.code_hash)) {
      const row = await retry(() => db.prepare("UPDATE otp_codes SET tries = tries + 1 WHERE participant_id = ? AND purpose = 'recover' RETURNING tries").bind(account.id).first());
      throw wrongCode(row ? row.tries : MAX_TRIES);
    }
    const password = generatePassword();
    const version = account.pw_version + 1;
    // §6.5: the first recovery on an admin-entered email proves the mailbox, and is told: to it, and to the Primary Admin
    const firstRecovery = account.email_verified_via === 'admin';
    await retry(async () => db.batch([
      ...(firstRecovery ? [
        db.prepare("UPDATE participants SET email_verified_via = 'otp' WHERE id = ?").bind(account.id),
        memberEmailStmt(db, { kind: 'acct.rec1', participantId: account.id, dedupeKey: 'acct:rec1:' + account.id, now }),
        activityStmt(db, { at: now, actor: 'account', action: 'account.recovery.first', entityType: 'participant', entityId: account.id, severity: 'critical', summary: 'أول استرجاع بإيميل دخّله أدمن' })
      ] : []),
      db.prepare("UPDATE participants SET pw_hash = ?, pw_enc = ?, pw_version = ?, pw_issued_at = ?, pw_issued_by = 'reset', updated_at = ?, version = version + 1 WHERE id = ?")
        .bind(await passwordHash(ctx.env, password), await passwordEncrypt(ctx.env, account.id, version, password), version, now, now, account.id),
      revokeAllStmt(db, account.id, now),
      db.prepare("DELETE FROM otp_codes WHERE participant_id = ? AND purpose = 'recover'").bind(account.id),
      db.prepare('INSERT INTO participant_audit (id, participant_id, at, actor, action) VALUES (?, ?, ?, ?, ?)').bind(randomId('pa-', 8), account.id, now, 'self', 'password.reset.self'),
      activityStmt(db, { at: now, actor: 'account', action: 'account.password.reset', entityType: 'participant', entityId: account.id, summary: 'باسورد جديد بكود الاسترجاع' })
    ]));
    return { email: account.email, password, firstName: firstName(account.name) };
  });
}
