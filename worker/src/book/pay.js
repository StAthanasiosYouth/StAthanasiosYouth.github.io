/*
 * InstaPay / wallet destinations (docs/BOOKING-PHASE1-COMPLETION-PLAN.md §4.7).
 *
 * Apps Script owns the Servants registry: each servant's optional
 * instapayNumber / walletNumber (else their phone as the fallback) and the
 * PRIMARY ADMIN's approval of the number that would be shown. Only approved,
 * valid numbers are pushed here (signed, the whole set each time):
 *
 *   POST /v1/sync/pay-dest   (lib/sync.js, kind 'paydest')
 *     { dests: [{ servantId, method, number, name, source: 'own'|'phone', approvedAt, approvedBy }] }
 *
 * The booking page asks for one at its payment step — the numbers are never
 * in event.json (published files stay in the public GitHub history):
 *
 *   POST /v1/book/pay { slug, servantId, method, counts? }
 *     → { number: '01xxxxxxxxx', name, method, amount, mode, minFirst }
 *
 * Settings `PAY_DEST` = '1' turns both on: the payment card, and the submit
 * check that an InstaPay / wallet choice has an approved destination.
 */

import { ApiError } from '../lib/http.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { retry } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { verifySync, syncStampStmt } from '../lib/sync.js';
import { loadEvent } from './event.js';
import { bookingOn } from './public.js';
import { bookingForToken, payableWhy } from './claims.js';
import { localPhone, methodOnline, checkCounts, quote, windowState, stampMs } from './model.js';

const SERVANT_RE = /^srv-[a-z0-9]{4,40}$/;
const METHOD_RE = /^[a-z][a-z0-9_]{1,19}$/;
const MAX_DESTS = 200;

let settingCache = { at: 0, on: false };

/* is the payment card (and its submit check) on? (settings PAY_DEST, cached 10 s) */
export async function payDestRequired(env, now = Date.now()) {
  if (now - settingCache.at < 10_000) return settingCache.on;
  const row = await retry(() => env.DB.prepare("SELECT value FROM settings WHERE key = 'PAY_DEST'").first());
  settingCache = { at: now, on: !!row && row.value === '1' };
  return settingCache.on;
}
export function forgetPayDest() { settingCache = { at: 0, on: false }; }

/* the approved destination of one servant × method, or null */
export async function payDest(env, servantId, method) {
  return retry(() => env.DB.prepare('SELECT servant_id, method, number, name, source FROM pay_dest WHERE servant_id = ? AND method = ?').bind(String(servantId || ''), String(method || '')).first());
}

/* POST /v1/sync/pay-dest (signed by Apps Script): the whole approved set replaces the old one */
export async function syncPayDest(ctx) {
  await limit(ctx, 'sync.pay', clientIp(ctx.request), 30, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { body, ts } = await verifySync(ctx.env, ctx.request, raw, 'paydest');
  const list = Array.isArray(body.dests) ? body.dests : null;
  if (!list || list.length > MAX_DESTS) throw new ApiError('bad', 'dests');
  const now = Date.now();
  const seen = new Set();
  const dests = list.map(d => {
    const servantId = String(d && d.servantId || '');
    const method = String(d && d.method || '');
    const number = localPhone(d && d.number);
    const source = d && d.source === 'phone' ? 'phone' : d && d.source === 'own' ? 'own' : '';
    const approvedMs = Number(d && d.approvedAt);
    const approvedBy = String(d && d.approvedBy || '').trim().toLowerCase().slice(0, 200);
    if (!SERVANT_RE.test(servantId) || !METHOD_RE.test(method) || !number || !source || !(approvedMs > 0) || !approvedBy) throw new ApiError('bad', 'dest');
    const key = servantId + '|' + method;
    if (seen.has(key)) throw new ApiError('bad', 'duplicate');
    seen.add(key);
    return { servantId, method, number, name: String(d.name || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 60), source, approvedMs, approvedBy };
  });

  const db = ctx.env.DB;
  const stmts = [db.prepare('DELETE FROM pay_dest')];
  for (const d of dests) {
    stmts.push(db.prepare('INSERT INTO pay_dest (servant_id, method, number, name, source, approved_ms, approved_by, synced_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(d.servantId, d.method, d.number, d.name, d.source, d.approvedMs, d.approvedBy, now));
  }
  stmts.push(syncStampStmt(db, 'paydest', ts));
  // counts only: never a number in the audit
  stmts.push(activityStmt(db, { actor: 'apps-script', action: 'paydest.sync', entityType: 'settings', entityId: 'pay_dest', summary: dests.length + ' approved' }));
  await retry(() => db.batch(stmts));
  return { approved: dests.length };
}

/* POST /v1/book/pay — the payment card's destination (the visitor reached the payment step) */
export async function bookPay(ctx) {
  if (!(await bookingOn(ctx.env))) throw new ApiError('disabled', 'module off');
  if (!(await payDestRequired(ctx.env))) throw new ApiError('disabled', 'pay dest off');
  await limit(ctx, 'book.pay', clientIp(ctx.request), 30, 600);
  const body = ctx.body || {};
  const event = await loadEvent(ctx, body.slug);
  const now = Date.now();
  const w = windowState(event, now);
  // a confirmed participant paying what is left (§4.10): their status token opens the card after booking
  // closed, and the amount is what they still owe (server-derived)
  const payer = body.token ? await bookingForToken(ctx, body.token).catch(() => null) : null;
  const paying = !!(payer && payer.b.event_id === event.id && !payableWhy(payer));
  if (!w.open && !paying) throw new ApiError(w.reason === 'not_open' ? 'not_open' : w.reason === 'closed' ? 'closed' : 'disabled', 'window', w.reason === 'not_open' ? { opensAt: w.opensAt } : {});
  const b = event.booking;
  const servant = b.servants.find(s => s.id === body.servantId);
  if (!servant) throw new ApiError('invalid', 'servantId', { field: 'servantId' });
  const m = b.methods.find(x => x.key === body.method);
  if (!m || !servant.methods.includes(m.key) || !methodOnline(m)) throw new ApiError('invalid', 'method', { field: 'method' });
  const dest = await payDest(ctx.env, servant.id, m.key);
  if (!dest) throw new ApiError('invalid', 'method', { field: 'method', reason: 'unavailable' });

  const checked = body.counts ? checkCounts(b, body.counts) : { problem: 'none' };
  const amount = paying ? payer.balance : checked.problem ? null : quote(b.pricing, checked.counts);
  const finalDueMs = b.payment.finalDueAt ? stampMs(b.payment.finalDueAt) : null;
  return {
    __cache: 'no-store',
    method: m.key,
    number: dest.number,
    name: dest.name || '',
    amount,
    mode: b.payment.mode,
    minFirst: b.payment.mode === 'installments' ? b.payment.minFirst : null,
    finalDueAt: finalDueMs ? b.payment.finalDueAt : ''
  };
}
