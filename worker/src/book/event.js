/*
 * The bookable definition of an event = its PUBLISHED event.json (what the
 * visitor saw: prices, capacity, window, servants, methods). Read from the
 * site and kept in D1 `event_cfg`; re-read when older than maxAgeMs, or on
 * an admin's «حدّث بيانات الفعالية» after a publish. Never edited here.
 *
 * Staging tests may store a fixture instead (POST /v1/admin/diag/event-fixture).
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { stampMs, priceRev, methodOnline } from './model.js';

const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const FRESH_MS = 60 * 1000;

export function rowToEvent(row) {
  if (!row) return null;
  return {
    id: row.id, slug: row.slug, title: row.title, startAt: row.start_at, endAt: row.end_at, endMs: row.end_ms,
    booking: row.booking ? JSON.parse(row.booking) : null, online: !!row.online, capacity: row.capacity,
    priceRev: row.price_rev, revision: row.revision, withdrawn: !!row.withdrawn, source: row.source, fetchedAt: row.fetched_at
  };
}

/* event.json → an event_cfg row (throws bad on a malformed file) */
export function rowFromJson(json, source, now = Date.now()) {
  if (!json || json.schema !== 1 || !SLUG.test(String(json.slug || ''))) throw new ApiError('bad', 'event.json shape');
  if (json.withdrawn) return { withdrawn: true, slug: json.slug };
  if (!/^evt-[a-z0-9]{4,}$/.test(String(json.id || ''))) throw new ApiError('bad', 'event id');
  const b = json.booking && typeof json.booking === 'object' ? json.booking : null;
  if (b && (!b.pricing || !Array.isArray(b.pricing.categories) || !b.pricing.categories.length)) throw new ApiError('bad', 'pricing');
  const endMs = stampMs(json.endAt) || stampMs(json.startAt);
  if (!endMs) throw new ApiError('bad', 'startAt');
  const booking = b ? {
    online: b.online === true,
    opensAt: b.opensAt || '', closesAt: b.closesAt || '',
    capacity: b.capacity == null ? null : Number(b.capacity),
    showLeft: b.showLeft !== false,
    showLeftBelow: b.showLeftBelow == null ? 20 : Number(b.showLeftBelow),
    perBookingMax: Number(b.perBookingMax) || 10,
    collectNames: b.collectNames === true,
    participants: b.participants === true,
    pricing: { mode: b.pricing.mode === 'group' ? 'group' : 'single', categories: b.pricing.categories.map(c => ({
      key: String(c.key), label: String(c.label || c.key), group: ['adult', 'child', 'companion'].includes(c.group) ? c.group : 'adult',
      price: Math.max(0, Math.floor(Number(c.price) || 0)), seat: c.seat !== false, min: Number(c.min) || 0, max: c.max == null ? 30 : Number(c.max), note: String(c.note || ''),
      ageMin: Number.isInteger(c.ageMin) ? c.ageMin : null, ageMax: Number.isInteger(c.ageMax) ? c.ageMax : null
    })) },
    payment: { mode: b.payment && b.payment.mode === 'installments' ? 'installments' : 'full', minFirst: Number(b.payment && b.payment.minFirst) || 0, finalDueAt: (b.payment && b.payment.finalDueAt) || '' },
    methods: (b.methods || []).map(m => ({ key: String(m.key), label: String(m.label || m.key), needsProof: m.needsProof === true, online: methodOnline(m) })),
    servants: (b.servants || []).map(s => ({ id: String(s.id), name: String(s.name || ''), methods: (s.methods || []).map(String) }))
  } : null;
  return {
    id: json.id, slug: json.slug, title: String(json.title || '').slice(0, 120), start_at: json.startAt, end_at: json.endAt || '', end_ms: endMs,
    booking: booking ? JSON.stringify(booking) : null, online: booking && booking.online ? 1 : 0,
    capacity: booking ? booking.capacity : null, price_rev: booking ? priceRev(booking.pricing) : '', revision: String(json.v || json.revision || ''),
    withdrawn: 0, source, fetched_at: now
  };
}

export async function saveRow(env, row) {
  await retry(() => env.DB.prepare(
    `INSERT INTO event_cfg (id, slug, title, start_at, end_at, end_ms, booking, online, capacity, price_rev, revision, withdrawn, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, title = excluded.title, start_at = excluded.start_at, end_at = excluded.end_at,
       end_ms = excluded.end_ms, booking = excluded.booking, online = excluded.online, capacity = excluded.capacity,
       price_rev = excluded.price_rev, revision = excluded.revision, withdrawn = 0, source = excluded.source, fetched_at = excluded.fetched_at`
  ).bind(row.id, row.slug, row.title, row.start_at, row.end_at, row.end_ms, row.booking, row.online, row.capacity, row.price_rev, row.revision, row.withdrawn, row.source, row.fetched_at).run());
}

async function fetchFromSite(env, slug, fetchImpl) {
  const site = String(env.SITE_URL || 'https://stathanasiosyouth.github.io').replace(/\/$/, '');
  // a unique query: past any CDN copy, so a fresh publish counts within a minute
  const res = await fetchImpl(`${site}/events/${slug}/event.json?w=${Date.now()}`, { headers: { accept: 'application/json', 'user-agent': 'athanasios-api' }, cf: { cacheTtl: 0 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError('busy', 'event.json ' + res.status);
  return res.json();
}

/*
 * The event by slug: D1 copy when fresh, else the site's event.json.
 * Throws not_found (no such published event) — fixtures are never replaced
 * by the site (staging tests own them).
 */
export async function loadEvent(ctx, slug, { maxAgeMs = FRESH_MS, force = false } = {}) {
  if (!SLUG.test(String(slug || ''))) throw new ApiError('not_found', 'slug');
  const now = Date.now();
  const row = await retry(() => ctx.env.DB.prepare('SELECT * FROM event_cfg WHERE slug = ?').bind(slug).first());
  if (row && (row.source === 'fixture' || (!force && now - row.fetched_at < maxAgeMs))) {
    if (row.withdrawn) throw new ApiError('not_found', 'withdrawn');
    return rowToEvent(row);
  }
  let json;
  try {
    json = await fetchFromSite(ctx.env, slug, ctx.fetch);
  } catch (err) {
    if (row && !row.withdrawn) return rowToEvent(row);      // the site is slow: the last copy will do
    throw err;
  }
  if (!json) {
    if (row) await ctx.env.DB.prepare('UPDATE event_cfg SET withdrawn = 1, fetched_at = ? WHERE id = ?').bind(now, row.id).run();
    throw new ApiError('not_found', 'no event.json');
  }
  const next = rowFromJson(json, 'site', now);
  if (next.withdrawn) {
    if (row) await ctx.env.DB.prepare('UPDATE event_cfg SET withdrawn = 1, fetched_at = ? WHERE id = ?').bind(now, row.id).run();
    throw new ApiError('not_found', 'withdrawn');
  }
  await saveRow(ctx.env, next);
  return rowToEvent(next);
}

export async function eventById(ctx, id) {
  const row = await retry(() => ctx.env.DB.prepare('SELECT * FROM event_cfg WHERE id = ?').bind(id).first());
  if (!row) throw new ApiError('not_found', 'event');
  return rowToEvent(row);
}

/* seats taken = Σ seats_actual of confirmed bookings (§9, never from a cache) */
export async function seatsTaken(env, eventId) {
  const r = await retry(() => env.DB.prepare("SELECT COALESCE(SUM(seats_actual), 0) AS n FROM bookings WHERE event_id = ? AND status = 'confirmed'").bind(eventId).first());
  return r.n;
}
