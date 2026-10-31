/*
 * /v1/admin/participants/* — accounts in the admin (docs/YOUTH-ACCOUNTS-PLAN.md §6.5, §11, §12, §16, §17;
 * docs/MEMBER-NOTIFICATIONS-PLAN.md §6, §9). Permissions per the Phase 1.5 grants (lib/perms.js). No admin
 * action needs an OTP. Every action writes participant_audit (old → new, never a password) and an activity
 * row without personal data; replies carry a password only to the admin who just issued or viewed it.
 */

import { SUPPORT_NAME, SUPPORT_PHONE } from '../notify/templates.js';
import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { randomId, base32Id } from '../lib/hash.js';
import { activityStmt } from '../lib/activity.js';
import { heldScope } from '../lib/perms.js';
import { limit } from '../lib/ratelimit.js';
import { memberEmailStmt, KINDS } from '../notify/member.js';
import { pointsOf } from '../points/ledger.js';
import {
  cleanEmail, validEmail, disposableEmail, canonEmail, phoneParts, checkName, normName, checkBirthDate, rulesFrom, eligibility, firstName
} from './model.js';
import { generatePassword, passwordHash, passwordEncrypt, passwordDecrypt } from './secret.js';
import { revokeAllStmt } from './session.js';
import { removeAvatarByAdmin } from './avatar.js';

const PID = /^p-[a-z2-7]{8}$/;
const REASON_MAX = 300;
const DAY = 24 * 3600 * 1000;
const EMAIL_CHECKS = ['in_person_readback', 'member_typed', 'confirmed_by_whatsapp'];
const SUPPORT_CHECKS = ['in_person', 'details_match', 'support_call'];
const SETTINGS = ['age_min', 'age_max', 'age_warn_days', 'support_contact'];
const FIELD_MAX = 120;

const invalid = (field, message) => new ApiError('invalid', field, { field, message });
const clip = (v, n = FIELD_MAX) => String(v == null ? '' : v).trim().slice(0, n);

function reasonOf(body, required = true) {
  const reason = clip(body.reason, REASON_MAX);
  if (required && reason.length < 2) throw invalid('reason', 'اكتب السبب.');
  return reason || null;
}

function emailInput(body) {
  const email = cleanEmail(body.email);
  if (!validEmail(email)) throw invalid('email', 'الإيميل مش صح.');
  if (disposableEmail(email)) throw invalid('email', 'الإيميل ده مؤقت. استخدم الإيميل الأساسي.');
  if (cleanEmail(body.emailConfirm) !== email) throw invalid('emailConfirm', 'الإيميل مش زي اللي فوق. اكتبه تاني.');
  if (!EMAIL_CHECKS.includes(body.checkMethod)) throw invalid('checkMethod', 'اختار اتأكدت من الإيميل إزاي.');
  return email;
}

async function settingsOf(db) {
  const { results } = await retry(() => db.prepare(`SELECT key, value FROM settings WHERE key IN (${SETTINGS.map(() => '?').join(',')})`).bind(...SETTINGS).all());
  return Object.fromEntries(results.map(r => [r.key, r.value]));
}

async function personOr404(db, id) {
  if (!PID.test(id)) throw new ApiError('not_found', 'id');
  const p = await retry(() => db.prepare('SELECT * FROM participants WHERE id = ?').bind(id).first());
  if (!p || p.status === 'deleted') throw new ApiError('not_found', 'participant');
  return p;
}

const auditStmt = (db, { id, at, actor, action, field = null, oldValue = null, newValue = null, reason = null, check = null }) =>
  db.prepare('INSERT INTO participant_audit (id, participant_id, at, actor, action, field, old_value, new_value, reason, check_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(randomId('pa-', 8), id, at, actor, action, field, oldValue, newValue, reason, check);

/* the activity row: who, which id, what kind of change. Never a name, email, phone, date or password */
const act = (ctx, at, action, id, summary, severity) => activityStmt(ctx.env.DB, {
  at, actor: ctx.actor.email, actorName: ctx.actor.name, action, entityType: 'participant', entityId: id, summary, severity
});

const rowView = (p, rules, now) => {
  const e = eligibility(p, rules, now);
  return {
    id: p.id, name: p.name, email: p.email, emailVerified: !!p.email_verified_at, emailVia: p.email_verified_via || null, phone: p.phone, birthDate: p.birth_date, age: e.age,
    eligibility: { state: e.state, source: e.source, soon: e.soon, leavesAt: e.soon ? e.leavesAt : null, override: p.eligibility_override || null },
    group: p.grp || '', church: p.church || '', servant: p.servant || '', status: p.status, createdVia: p.created_via, createdAt: p.created_at,
    avatar: p.avatar_key ? p.avatar_version : null
  };
};

/* GET /v1/admin/participants?q=&status=&state=&offset=&limit= */
export async function adminParticipants(ctx) {
  const db = ctx.env.DB;
  const u = ctx.url.searchParams;
  const q = clip(u.get('q'), 80);
  const limitN = Math.min(100, Math.max(1, Number(u.get('limit')) || 50));
  const offset = Math.max(0, Number(u.get('offset')) || 0);
  const where = ["status <> 'deleted'"];
  const args = [];
  if (q) {
    const phone = phoneParts(q);
    where.push('(name_norm LIKE ? OR email_canon LIKE ? OR phone_norm LIKE ?)');
    args.push('%' + normName(q) + '%', '%' + q.toLowerCase() + '%', phone ? phone.phoneNorm : '%' + q.replace(/\D/g, '').replace(/^0/, '') + '%');
    if (!q.replace(/\D/g, '')) args[args.length - 1] = '-';
  }
  if (u.get('status') === 'blocked') where.push("status = 'blocked'");
  const clause = where.join(' AND ');
  const [rows, count, season] = await retry(() => db.batch([
    db.prepare(`SELECT *, (SELECT COALESCE(SUM(l.amount), 0) FROM points_ledger l WHERE l.participant_id = participants.id AND l.season_id = (SELECT id FROM seasons WHERE status = 'active')) AS balance
      FROM participants WHERE ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...args, limitN, offset),
    db.prepare(`SELECT COUNT(*) AS n FROM participants WHERE ${clause}`).bind(...args),
    db.prepare("SELECT id, name FROM seasons WHERE status = 'active'")
  ]));
  const rules = rulesFrom(await settingsOf(db));
  const now = Date.now();
  let people = rows.results.map(p => ({ ...rowView(p, rules, now), balance: p.balance }));
  const state = u.get('state');
  if (state === 'guest' || state === 'eligible') people = people.filter(p => p.eligibility.state === state);
  return {
    people, total: count.results[0].n, offset, limit: limitN, season: season.results[0] || null,
    can: { add: (await heldScope(ctx, 'participants.add')) !== '', manage: (await heldScope(ctx, 'participants.manage')) === 'all', viewPassword: ctx.actor.role === 'primary', export: (await heldScope(ctx, 'exports.export_pii')) === 'all' }
  };
}

/* §17.2: GET /v1/admin/participants/review — self-registered accounts, newest first, with what looks odd */
export async function adminParticipantsReview(ctx) {
  const db = ctx.env.DB;
  const rules = rulesFrom(await settingsOf(db));
  const now = Date.now();
  const rows = (await retry(() => db.prepare("SELECT * FROM participants WHERE created_via = 'self' AND status <> 'deleted' ORDER BY created_at DESC LIMIT 100").all())).results;
  const twins = (await retry(() => db.prepare("SELECT name_norm, birth_date, phone_norm FROM participants WHERE status <> 'deleted' AND name_norm IN (SELECT name_norm FROM participants GROUP BY name_norm HAVING COUNT(*) > 1)").all())).results;
  const byIp = new Map();
  for (const r of rows) if (r.reg_ip_hash) byIp.set(r.reg_ip_hash, [...(byIp.get(r.reg_ip_hash) || []), r]);
  const people = rows.map(p => {
    const flags = [];
    const same = twins.filter(t => t.name_norm === p.name_norm && t.phone_norm !== p.phone_norm);
    if (same.some(t => t.birth_date === p.birth_date)) flags.push('same_name_dob');
    else if (same.length) flags.push('same_name');
    const view = rowView(p, rules, now);
    const dob = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.birth_date);
    for (const edge of [rules.min, rules.max + 1]) {
      const at = Date.UTC(Number(dob[1]) + edge, Number(dob[2]) - 1, Number(dob[3]));
      if (Math.abs(at - now) <= 30 * DAY) flags.push('near_edge');
    }
    const peers = byIp.get(p.reg_ip_hash) || [];
    if (peers.filter(o => Math.abs(o.created_at - p.created_at) <= 3600000).length >= 5) flags.push('many_from_one_source');
    if (peers.some(o => o.id !== p.id && o.created_at < p.created_at && p.created_at - o.created_at <= 3600000 && eligibility(o, rules, now).state === 'guest')) flags.push('after_guest_same_source');
    return { ...view, flags: [...new Set(flags)] };
  });
  return { people };
}

/* §19: GET /v1/admin/participants/export — by id; never a credential */
export async function adminParticipantsExport(ctx) {
  const db = ctx.env.DB;
  await limit(ctx, 'participants.export', ctx.actor.email, 10, 600);
  const rules = rulesFrom(await settingsOf(db));
  const now = Date.now();
  const rows = (await retry(() => db.prepare(`SELECT id, name, email, email_verified_at, phone, birth_date, status, eligibility_override, grp, church, servant, notes,
      (SELECT COALESCE(SUM(l.amount), 0) FROM points_ledger l WHERE l.participant_id = participants.id AND l.season_id = (SELECT id FROM seasons WHERE status = 'active')) AS balance
    FROM participants WHERE status <> 'deleted' ORDER BY created_at`).all())).results;
  await retry(() => activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'export', entityType: 'participant', summary: 'تصدير الحسابات: ' + rows.length }).run());
  return {
    rows: rows.map(p => {
      const e = eligibility(p, rules, now);
      return {
        id: p.id, name: p.name, email: p.email, emailVerified: !!p.email_verified_at, phone: p.phone, birthDate: p.birth_date, age: e.age,
        eligibility: e.state, eligibilitySource: e.source, frozen: e.state === 'guest' && p.balance > 0 ? p.balance : 0, status: p.status,
        group: p.grp || '', church: p.church || '', servant: p.servant || '', notes: p.notes || ''
      };
    })
  };
}

/*
 * POST /v1/admin/participants { name, email, emailConfirm, checkMethod, phone, birthDate, group, church, servant, notes }
 * §6.5: no OTP; active and administratively verified at once. The password goes to this admin, once.
 */
export async function adminParticipantCreate(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  await limit(ctx, 'participants.add', ctx.actor.email, 60, 600);
  const name = checkName(body.name);
  if (!name.name) throw invalid('name', name.message);
  const email = emailInput(body);
  const phone = phoneParts(body.phone);
  if (!phone) throw invalid('phone', 'اكتب رقم موبايل مصري صح.');
  const birth = checkBirthDate(body.birthDate);
  if (!birth.birthDate) throw invalid('birthDate', birth.message);
  const id = base32Id('p-', 8);
  const password = generatePassword();
  const now = Date.now();
  const canon = canonEmail(email);
  try {
    await retry(async () => db.batch([
      db.prepare(`INSERT INTO participants (id, name, name_norm, email, email_canon, email_verified_at, email_source, email_verified_via, phone, phone_norm, birth_date, grp, church, servant, notes, pw_hash, pw_enc, pw_version, pw_issued_at, pw_issued_by, created_via, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'admin', 'admin', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'admin', ?, ?)`).bind(
        id, name.name, normName(name.name), email, canon, now, phone.phone, phone.phoneNorm, birth.birthDate, clip(body.group) || null, clip(body.church) || null, clip(body.servant) || null, clip(body.notes, 500) || null,
        await passwordHash(ctx.env, password), await passwordEncrypt(ctx.env, id, 1, password), now, ctx.actor.email, now, now),
      auditStmt(db, { id, at: now, actor: ctx.actor.email, action: 'register.admin', check: body.checkMethod }),
      act(ctx, now, 'participant.add', id, 'حساب جديد من الأدمن'),
      memberEmailStmt(db, { kind: 'acct.new', participantId: id, dedupeKey: 'acct:new:' + id, now })
    ]));
  } catch (err) {
    const m = String(err && err.message);
    if (/UNIQUE/i.test(m) && /email_canon|participants_email/.test(m)) throw new ApiError('dup_email', 'email', { field: 'email', message: 'الإيميل ده عليه حساب بالفعل.', hint: undefined });
    if (/UNIQUE/i.test(m) && /phone_norm|participants_phone/.test(m)) throw new ApiError('dup_phone', 'phone', { field: 'phone', message: 'رقم الموبايل ده مسجّل في حساب تاني.', hint: undefined });
    throw err;
  }
  return { id, password };
}

/* GET /v1/admin/participants/:id — the person sheet (§12.1) */
export async function adminParticipant(ctx) {
  const db = ctx.env.DB;
  const p = await personOr404(db, ctx.params.id);
  const rules = rulesFrom(await settingsOf(db));
  const now = Date.now();
  const view = rowView(p, rules, now);
  const [sessions, audit, bookings, mail, lastEmail] = await retry(() => db.batch([
    db.prepare('SELECT device, kind, last_seen FROM account_sessions WHERE participant_id = ? AND revoked_at IS NULL AND expires_at > ? AND pw_version = ? ORDER BY last_seen DESC LIMIT 30').bind(p.id, now, p.pw_version),
    db.prepare('SELECT at, actor, action, field, old_value, new_value, reason, check_method FROM participant_audit WHERE participant_id = ? ORDER BY at DESC LIMIT 100').bind(p.id),
    db.prepare('SELECT b.id, b.ref, b.status, b.booker_age, b.age_source, b.dob_mismatch, e.title FROM bookings b LEFT JOIN event_cfg e ON e.id = b.event_id WHERE b.participant_id = ? ORDER BY b.created_ms DESC LIMIT 50').bind(p.id),
    db.prepare("SELECT id, kind, tier, status, created_ms, sent_ms FROM member_outbox WHERE participant_id = ? AND class <> 'otp' ORDER BY created_ms DESC LIMIT 30").bind(p.id),
    db.prepare("SELECT at FROM participant_audit WHERE participant_id = ? AND action = 'email.change' ORDER BY at DESC LIMIT 1").bind(p.id)
  ]));
  return {
    person: {
      ...view, notes: p.notes || '', blockedAt: p.blocked_at, blockedReason: p.blocked_reason || '', pwIssuedAt: p.pw_issued_at, pwIssuedBy: p.pw_issued_by,
      emailChangedRecently: !!(lastEmail.results[0] && now - lastEmail.results[0].at < 7 * DAY)
    },
    points: await pointsOf(db, p.id, view.eligibility.state),
    sessions: sessions.results.map(s => ({ device: s.device || 'جهاز', kind: s.kind, lastSeen: s.last_seen })),
    audit: audit.results.map(a => ({ at: a.at, actor: a.actor, action: a.action, field: a.field, oldValue: a.old_value, newValue: a.new_value, reason: a.reason, check: a.check_method })),
    bookings: bookings.results.map(b => ({ id: b.id, ref: b.ref, status: b.status, event: b.title || '', age: b.booker_age, ageSource: b.age_source, mismatch: !!b.dob_mismatch })),
    mail: mail.results.map(m => ({ id: m.id, kind: m.kind, tier: m.tier, status: m.status, at: m.created_ms, sentAt: m.sent_ms })),
    can: { edit: (await heldScope(ctx, 'participants.edit')) === 'all', manage: (await heldScope(ctx, 'participants.manage')) === 'all', viewPassword: ctx.actor.role === 'primary', points: (await heldScope(ctx, 'points.edit')) === 'all', transfer: (await heldScope(ctx, 'points.approve')) === 'all' }
  };
}

/* POST /:id/profile { name, group, church, servant, notes, reason } — a name change needs its reason */
export async function adminParticipantProfile(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const p = await personOr404(db, ctx.params.id);
  const name = body.name === undefined ? { name: p.name } : checkName(body.name);
  if (!name.name) throw invalid('name', name.message);
  const nameChanged = name.name !== p.name;
  const reason = reasonOf(body, nameChanged);
  const next = { grp: body.group === undefined ? p.grp : clip(body.group) || null, church: body.church === undefined ? p.church : clip(body.church) || null, servant: body.servant === undefined ? p.servant : clip(body.servant) || null, notes: body.notes === undefined ? p.notes : clip(body.notes, 500) || null };
  const changed = ['grp', 'church', 'servant', 'notes'].filter(k => (next[k] || null) !== (p[k] || null));
  if (!nameChanged && !changed.length) return adminParticipant(ctx);
  const now = Date.now();
  await retry(() => db.batch([
    db.prepare('UPDATE participants SET name = ?, name_norm = ?, grp = ?, church = ?, servant = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ?').bind(name.name, normName(name.name), next.grp, next.church, next.servant, next.notes, now, p.id),
    ...(nameChanged ? [auditStmt(db, { id: p.id, at: now, actor: ctx.actor.email, action: 'profile.edit', field: 'name', oldValue: p.name, newValue: name.name, reason })] : []),
    ...changed.map(k => auditStmt(db, { id: p.id, at: now, actor: ctx.actor.email, action: 'profile.edit', field: k, oldValue: p[k], newValue: next[k], reason })),
    act(ctx, now, 'participant.edit', p.id, 'عدّل بيانات مشترك')
  ]));
  return adminParticipant(ctx);
}

/*
 * POST /:id/email { email, emailConfirm, checkMethod, reason, override } (participants.manage)
 * §11, §12.2: administratively verified, sessions end, one change per 7 days unless the Primary overrides,
 * a notice to the old address (when it was verified) and to the new one, a critical notification.
 */
export async function adminParticipantEmail(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const p = await personOr404(db, ctx.params.id);
  const email = emailInput(body);
  const reason = reasonOf(body);
  const now = Date.now();
  const canon = canonEmail(email);
  if (canon === p.email_canon) throw invalid('email', 'ده نفس الإيميل الحالي.');
  const last = await retry(() => db.prepare("SELECT at FROM participant_audit WHERE participant_id = ? AND action = 'email.change' ORDER BY at DESC LIMIT 1").bind(p.id).first('at'));
  if (last && now - last < 7 * DAY && !(body.override === true && ctx.actor.role === 'primary')) throw new ApiError('recent', 'email', { message: 'الإيميل ده اتغير من أقل من ٧ أيام.', hint: 'الأدمن الأساسي بس يقدر يغيّره قبل كده.' });
  const version = p.version + 1;
  try {
    await retry(() => db.batch([
      db.prepare("UPDATE participants SET email = ?, email_canon = ?, email_verified_at = ?, email_source = 'admin', email_verified_via = 'admin', updated_at = ?, version = ? WHERE id = ?").bind(email, canon, now, now, version, p.id),
      revokeAllStmt(db, p.id, now),
      auditStmt(db, { id: p.id, at: now, actor: ctx.actor.email, action: 'email.change', field: 'email', oldValue: p.email, newValue: email, reason, check: body.checkMethod }),
      act(ctx, now, 'participant.email', p.id, 'غيّر إيميل مشترك', 'critical'),
      memberEmailStmt(db, { kind: 'acct.new', participantId: p.id, dedupeKey: `acct:email:new:${p.id}:${version}`, now }),
      ...(p.email_verified_at ? [memberEmailStmt(db, { kind: 'acct.email', participantId: p.id, toEmail: p.email, dedupeKey: `acct:email:${p.id}:${version}`, now })] : [])
    ]));
  } catch (err) {
    if (/UNIQUE/i.test(String(err && err.message))) throw new ApiError('dup_email', 'email', { field: 'email', message: 'الإيميل ده عليه حساب بالفعل.', hint: undefined });
    throw err;
  }
  return adminParticipant(ctx);
}

/* POST /:id/phone { phone, reason } (participants.manage) — sessions end; a critical notification */
export async function adminParticipantPhone(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const p = await personOr404(db, ctx.params.id);
  const phone = phoneParts(body.phone);
  if (!phone) throw invalid('phone', 'اكتب رقم موبايل مصري صح.');
  const reason = reasonOf(body);
  if (phone.phoneNorm === p.phone_norm) throw invalid('phone', 'ده نفس الرقم الحالي.');
  const now = Date.now();
  try {
    await retry(() => db.batch([
      db.prepare('UPDATE participants SET phone = ?, phone_norm = ?, updated_at = ?, version = version + 1 WHERE id = ?').bind(phone.phone, phone.phoneNorm, now, p.id),
      revokeAllStmt(db, p.id, now),
      auditStmt(db, { id: p.id, at: now, actor: ctx.actor.email, action: 'phone.change', field: 'phone', oldValue: p.phone, newValue: phone.phone, reason }),
      act(ctx, now, 'participant.phoneFix', p.id, 'غيّر موبايل مشترك', 'critical')
    ]));
  } catch (err) {
    if (/UNIQUE/i.test(String(err && err.message))) throw new ApiError('dup_phone', 'phone', { field: 'phone', message: 'رقم الموبايل ده مسجّل في حساب تاني.', hint: undefined });
    throw err;
  }
  return adminParticipant(ctx);
}

/* POST /:id/dob { birthDate, reason } (participants.manage) — future checks only: past stamps and snapshots stay */
export async function adminParticipantDob(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const p = await personOr404(db, ctx.params.id);
  const birth = checkBirthDate(body.birthDate);
  if (!birth.birthDate) throw invalid('birthDate', birth.message);
  const reason = reasonOf(body);
  if (birth.birthDate === p.birth_date) throw invalid('birthDate', 'ده نفس التاريخ الحالي.');
  const now = Date.now();
  await retry(() => db.batch([
    db.prepare('UPDATE participants SET birth_date = ?, updated_at = ?, version = version + 1 WHERE id = ?').bind(birth.birthDate, now, p.id),
    auditStmt(db, { id: p.id, at: now, actor: ctx.actor.email, action: 'dob.correct', field: 'birth_date', oldValue: p.birth_date, newValue: birth.birthDate, reason }),
    act(ctx, now, 'participant.dob', p.id, 'صحّح تاريخ ميلاد مشترك', 'critical')
  ]));
  return adminParticipant(ctx);
}

/* POST /:id/eligibility { override: 'guest'|'eligible'|'auto', reason } (participants.manage) */
export async function adminParticipantEligibility(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const p = await personOr404(db, ctx.params.id);
  if (!['guest', 'eligible', 'auto'].includes(body.override)) throw invalid('override', 'اختار الأهلية.');
  const value = body.override === 'auto' ? null : body.override;
  const reason = reasonOf(body);
  const now = Date.now();
  await retry(() => db.batch([
    db.prepare('UPDATE participants SET eligibility_override = ?, updated_at = ?, version = version + 1 WHERE id = ?').bind(value, now, p.id),
    auditStmt(db, { id: p.id, at: now, actor: ctx.actor.email, action: 'eligibility', field: 'eligibility_override', oldValue: p.eligibility_override, newValue: value, reason }),
    act(ctx, now, 'participant.eligibility', p.id, 'غيّر أهلية مشترك')
  ]));
  return adminParticipant(ctx);
}

/*
 * POST /:id/view-password { reason? } — §12.3: Primary Admin only, any time, unlimited. Reads the
 * current password; writes nothing to the credential, ends no session. Logged. No rate limit by decision.
 */
export async function adminParticipantViewPassword(ctx) {
  if (ctx.actor.role !== 'primary') throw new ApiError('denied', 'primary only', { perm: 'primary' });
  const db = ctx.env.DB;
  const p = await personOr404(db, ctx.params.id);
  const password = await passwordDecrypt(ctx.env, p.id, p.pw_version, p.pw_enc);
  const now = Date.now();
  await retry(() => db.batch([
    auditStmt(db, { id: p.id, at: now, actor: ctx.actor.email, action: 'password.view', reason: reasonOf(ctx.body || {}, false) }),
    act(ctx, now, 'password.view', p.id, 'شاف باسورد مشترك')
  ]));
  return { password };
}

/*
 * POST /:id/reset-password { reason, support?, checkMethod? } (participants.manage) — §11: a new password,
 * every session ends, a notice (never the password), a critical notification. It's handed over privately.
 */
export async function adminParticipantResetPassword(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const p = await personOr404(db, ctx.params.id);
  const reason = reasonOf(body);
  if (body.support === true && !SUPPORT_CHECKS.includes(body.checkMethod)) throw invalid('checkMethod', 'اختار اتأكدت من الشخص إزاي.');
  const password = generatePassword();
  const version = p.pw_version + 1;
  const now = Date.now();
  await retry(async () => db.batch([
    db.prepare("UPDATE participants SET pw_hash = ?, pw_enc = ?, pw_version = ?, pw_issued_at = ?, pw_issued_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
      .bind(await passwordHash(ctx.env, password), await passwordEncrypt(ctx.env, p.id, version, password), version, now, ctx.actor.email, now, p.id),
    revokeAllStmt(db, p.id, now),
    auditStmt(db, { id: p.id, at: now, actor: ctx.actor.email, action: body.support === true ? 'password.reset.support' : 'password.reset', reason, check: body.support === true ? body.checkMethod : null }),
    act(ctx, now, 'participant.reset', p.id, 'عمل باسورد جديد لمشترك', 'critical'),
    memberEmailStmt(db, { kind: 'acct.pw', participantId: p.id, entityVersion: version, dedupeKey: `acct:pw:${p.id}:${version}`, now })
  ]));
  return { password };
}

/* POST /:id/block { reason } (participants.edit): sessions end at once; a critical notification */
export async function adminParticipantBlock(ctx) {
  const db = ctx.env.DB;
  const p = await personOr404(db, ctx.params.id);
  const reason = reasonOf(ctx.body || {});
  if (p.status === 'blocked') return adminParticipant(ctx);
  const now = Date.now();
  await retry(() => db.batch([
    db.prepare("UPDATE participants SET status = 'blocked', blocked_at = ?, blocked_reason = ?, updated_at = ?, version = version + 1 WHERE id = ?").bind(now, reason, now, p.id),
    revokeAllStmt(db, p.id, now),
    auditStmt(db, { id: p.id, at: now, actor: ctx.actor.email, action: 'block', reason }),
    act(ctx, now, 'participant.block', p.id, 'وقّف حساب مشترك', 'critical')
  ]));
  return adminParticipant(ctx);
}

/* POST /:id/unblock { reason } (participants.manage) */
export async function adminParticipantUnblock(ctx) {
  const db = ctx.env.DB;
  const p = await personOr404(db, ctx.params.id);
  const reason = reasonOf(ctx.body || {});
  if (p.status !== 'blocked') return adminParticipant(ctx);
  const now = Date.now();
  await retry(() => db.batch([
    db.prepare("UPDATE participants SET status = 'active', blocked_at = NULL, blocked_reason = NULL, updated_at = ?, version = version + 1 WHERE id = ?").bind(now, p.id),
    auditStmt(db, { id: p.id, at: now, actor: ctx.actor.email, action: 'unblock', reason }),
    act(ctx, now, 'participant.unblock', p.id, 'رجّع حساب مشترك')
  ]));
  return adminParticipant(ctx);
}

/* POST /:id/avatar/delete { reason } (participants.edit): a photo that shouldn't be there; the member can add another */
export async function adminParticipantAvatarDelete(ctx) {
  const p = await personOr404(ctx.env.DB, ctx.params.id);
  await removeAvatarByAdmin(ctx, p, reasonOf(ctx.body || {}));
  return adminParticipant(ctx);
}

/* POST /:id/sessions/revoke (participants.manage): «اخرج من كل الأجهزة» */
export async function adminParticipantRevoke(ctx) {
  const db = ctx.env.DB;
  const p = await personOr404(db, ctx.params.id);
  const now = Date.now();
  await retry(() => db.batch([
    revokeAllStmt(db, p.id, now),
    auditStmt(db, { id: p.id, at: now, actor: ctx.actor.email, action: 'session.revoke' }),
    act(ctx, now, 'participant.sessions', p.id, 'خرّج مشترك من كل الأجهزة')
  ]));
  return adminParticipant(ctx);
}

/*
 * POST /:id/resend { outboxId } — MEMBER §9: one Tier 1 email again, once per 24 h; never a code.
 * participants.manage or bookings.manage.
 */
export async function adminParticipantResend(ctx) {
  const db = ctx.env.DB;
  if ((await heldScope(ctx, 'participants.manage')) !== 'all' && (await heldScope(ctx, 'bookings.manage')) !== 'all') throw new ApiError('denied', 'perm', { perm: 'participants.manage' });
  const p = await personOr404(db, ctx.params.id);
  const row = await retry(() => db.prepare('SELECT * FROM member_outbox WHERE id = ? AND participant_id = ?').bind(String((ctx.body || {}).outboxId || ''), p.id).first());
  if (!row) throw new ApiError('not_found', 'outbox');
  if (row.tier !== 1 || row.class === 'otp' || !KINDS[row.kind]) throw invalid('outboxId', 'الإيميل ده مينفعش يتبعت تاني.');
  const now = Date.now();
  const r = await retry(() => db.batch([
    memberEmailStmt(db, { kind: row.kind, participantId: p.id, entityType: row.entity_type, entityId: row.entity_id, entityVersion: row.entity_version, dedupeKey: `resend:${row.id}:${Math.floor(now / DAY)}`, now }),
    act(ctx, now, 'member.mail.resend', p.id, 'بعت إيميل لمشترك تاني')
  ]));
  if (r[0].meta.changes !== 1) throw new ApiError('recent', 'resend', { message: 'الإيميل ده اتبعت تاني النهارده.', hint: 'جرّب بكرة.' });
  return { resent: true };
}

/* GET + POST /v1/admin/participants/settings — the Admin age range and the Technical Support contact (§11) */
export async function adminParticipantSettings(ctx) {
  const s = await settingsOf(ctx.env.DB);
  let support = null;
  try { support = s.support_contact ? JSON.parse(s.support_contact) : null; } catch { support = null; }
  return { ageMin: Number(s.age_min), ageMax: Number(s.age_max), warnDays: Number(s.age_warn_days), support, supportDefault: { name: SUPPORT_NAME, phone: SUPPORT_PHONE } };
}

export async function adminParticipantSettingsSave(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const now = Date.now();
  const set = (key, value) => db.prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by').bind(key, value, now, ctx.actor.email);
  const stmts = [];
  const whole = (v, min, max) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max;
  if (body.ageMin !== undefined || body.ageMax !== undefined) {
    if (!whole(body.ageMin, 0, 120) || !whole(body.ageMax, 0, 120) || Number(body.ageMin) > Number(body.ageMax)) throw invalid('age', 'النطاق العمري مش صح.');
    stmts.push(set('age_min', String(Number(body.ageMin))), set('age_max', String(Number(body.ageMax))));
  }
  if (body.warnDays !== undefined) {
    if (!whole(body.warnDays, 0, 365)) throw invalid('warnDays', 'عدد الأيام مش صح.');
    stmts.push(set('age_warn_days', String(Number(body.warnDays))));
  }
  if (body.support !== undefined) {
    if (body.support === null) stmts.push(set('support_contact', ''));
    else {
      const phone = phoneParts(body.support.phone);
      const name = clip(body.support.name, 60);
      if (!phone || name.length < 2) throw invalid('support', 'اكتب اسم ورقم الدعم الفني صح.');
      stmts.push(set('support_contact', JSON.stringify({ id: clip(body.support.id, 40) || null, name, phone: phone.phone, whatsapp: 'https://wa.me/20' + phone.phoneNorm })));
    }
  }
  if (!stmts.length) return adminParticipantSettings(ctx);
  stmts.push(activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'participant.settings', entityType: 'settings', entityId: 'participants', summary: 'غيّر إعدادات الحسابات', severity: 'important' }));
  await retry(() => db.batch(stmts));
  return adminParticipantSettings(ctx);
}

export { firstName };
