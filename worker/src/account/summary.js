/*
 * GET /v1/account/summary: the account's first page in one light request, so opening it never needs
 * /v1/comp/me. Only what the home draws: the balance, what's coming, the latest results and orders.
 * The score and points rules are the competitions' own (historyOf): nothing shows before its time.
 */

import { retry } from '../lib/db.js';
import { HELD_SQL, activeSeason } from '../points/ledger.js';
import { accountBookings } from '../book/account.js';
import { historyOf } from '../comp/runtime.js';
import { wallOf } from '../comp/model.js';
import { redemptionsOf, storeOf } from '../store/shop.js';
import { gate, accountViewOf } from './routes.js';
import { requireAccount } from './session.js';
import { eligibility, rulesFrom } from './model.js';

const FRESH_MS = 7 * 24 * 3600 * 1000;

export async function accountSummary(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  const db = ctx.env.DB;
  const now = Date.now();
  const wall = wallOf(now);
  const state = eligibility(account, rulesFrom(settings), now).state;
  const season = await activeSeason(db);
  const [balance, history, orders, store, { bookings }] = await Promise.all([
    season ? retry(() => db.prepare(`SELECT COALESCE(SUM(l.amount), 0) AS n FROM points_ledger l WHERE l.participant_id = ? AND l.season_id = ? AND ${HELD_SQL}`).bind(account.id, season.id).first('n')) : 0,
    historyOf(db, account.id, wall, 6),
    redemptionsOf(db, account.id, season, settings, wall),
    storeOf(db, wall),
    accountBookings(ctx, account)
  ]);
  const today = wall.slice(0, 10);
  return {
    account: accountViewOf(account, settings, now),
    points: { balance, season: season ? season.name : '', frozen: state !== 'eligible' && balance > 0 },
    bookings: {
      total: bookings.length,
      coming: bookings.filter(b => ['pending', 'confirmed'].includes(b.status) && (!b.startAt || b.startAt.slice(0, 10) >= today)),
      rejected: bookings.filter(b => b.status === 'rejected').slice(0, 1)
    },
    results: {
      count: history.length,
      latest: history.slice(0, 3),
      fresh: history.filter(x => x.releasedMs && now - x.releasedMs < FRESH_MS && x.score !== null).slice(0, 1)
    },
    orders: { count: orders.length, latest: orders.slice(0, 3), ready: orders.filter(o => o.status === 'approved').slice(0, 1) },
    store: { state: store.state }
  };
}
