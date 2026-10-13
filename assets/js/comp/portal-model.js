/**
 * «نقاطي» — PORTAL MODEL (pure: no DOM, no network — tested in Node)
 *
 * What the portal page may show from portalMe / shopRedeem replies
 * (re-validated, never trusted), the Arabic labels, the store's
 * availability rules and the participant token's (sessionStorage) memo.
 * Contract: docs/COMPETITIONS.md §5.1 (portalMe, portalReview, shopRedeem),
 * §7.4, §8, §9.
 */

import { cleanImage, cleanStamp, countPoints, ar } from './flow.js';
import { formatStamp, leftText } from '../words.js';
import { realMinutesBetween } from '../schedule.js';

export const TOKEN_KEY = 'athanasios.portal.v1';

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const num = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const int = value => (Number.isInteger(value) ? value : null);
const cleanId = value => (typeof value === 'string' && /^[\w-]{1,60}$/.test(value) ? value : '');
const list = value => (Array.isArray(value) ? value.filter(x => x && typeof x === 'object') : []);

export const KIND_LABELS = {
  competition: 'مسابقة',
  correction: 'تعديل نتيجة',
  manual: 'تعديل من الخدام',
  redeem: 'جايزة',
  refund: 'استرجاع'
};

export const REDEMPTION_LABELS = {
  pending: 'مستني',
  approved: 'جاهزة للاستلام',
  fulfilled: 'اتسلمت',
  cancelled: 'اتلغت (النقاط رجعت)'
};

export const HISTORY_LABELS = {
  submitted: 'اتبعتت',
  pending_review: 'مستني مراجعة',
  graded: 'اتصححت',
  void: 'اتلغت',
  in_progress: 'لسه مكملتش'
};

export const REDEEM_ERRORS = {
  insufficient: 'رصيدك مش كفاية',
  stock: 'الجايزة دي خلصت',
  per_person: 'وصلت للحد المسموح من الجايزة دي',
  disabled: 'الجوايز مش متاحة دلوقتي',
  busy: 'فيه ضغط كبير دلوقتي، جرّب كمان شوية',
  network: 'النت فاصل أو ضعيف، جرّب تاني (طلبك مش هيتكرر)',
  not_found: 'الجايزة دي مش موجودة دلوقتي',
  shop_closed: 'المتجر قفل دلوقتي — طلباتك محفوظة'
};

/** portalMe reply → what the dashboard shows (null when unusable). */
export function sanitizeMe(raw) {

  if (!raw || typeof raw !== 'object' || !raw.participant || typeof raw.participant !== 'object') return null;

  const name = text(raw.participant.name, 80);
  if (!name) return null;

  const features = raw.features && typeof raw.features === 'object' ? raw.features : {};
  const wallet = features.wallet === true;
  const shop = wallet && features.shop === true;
  // §18.4: `shop` = the prizes (as in §5.1); `store` = { state, opensAt, closesAt, allowCancel }
  const items = Array.isArray(raw.shop) ? raw.shop : [];

  return {
    participant: { name, group: text(raw.participant.group, 60) },
    features: { wallet, shop },
    store: shop ? sanitizeStore(raw.store) : null,
    season: wallet ? sanitizeSeason(raw.season) : null,
    seasons: wallet ? list(raw.seasons).slice(0, 100).map(cleanPastSeason).filter(Boolean) : [],
    balance: wallet ? num(raw.balance) : null,
    ledger: wallet ? list(raw.ledger).slice(0, 500).map(l => ({
      amount: int(l.amount) ?? 0,
      kind: KIND_LABELS[l.kind] ? l.kind : 'manual',
      note: text(l.note, 200),
      compTitle: text(l.compTitle, 80),
      createdAt: cleanStamp(l.createdAt)
    })) : [],
    history: list(raw.history).slice(0, 500).map(h => ({
      submissionId: cleanId(h.submissionId || h.id),
      compId: cleanId(h.compId),
      title: text(h.title, 80) || 'مسابقة',
      slug: typeof h.slug === 'string' && /^[a-z0-9-]{2,40}$/.test(h.slug) ? h.slug : '',
      submittedAt: cleanStamp(h.submittedAt),
      status: HISTORY_LABELS[h.status] ? h.status : 'submitted',
      score: num(h.score),
      maxScore: num(h.maxScore),
      pointsAwarded: num(h.pointsAwarded),
      pending: num(h.pending),
      canReview: h.canReview === true && !!cleanId(h.submissionId || h.id)
    })),
    redemptions: list(raw.redemptions).slice(0, 200).map(r => ({
      id: cleanId(r.id),
      itemName: text(r.itemName, 60),
      cost: int(r.cost) ?? 0,
      status: REDEMPTION_LABELS[r.status] ? r.status : 'pending',
      requestedAt: cleanStamp(r.requestedAt),
      canCancel: r.canCancel === true && r.status === 'pending' && !!cleanId(r.id)
    })).filter(r => r.itemName),
    shop: shop ? list(items).slice(0, 200).map(i => ({
      id: cleanId(i.id),
      name: text(i.name, 60),
      description: text(i.description, 500),
      image: cleanImage(i.image),
      cost: int(i.cost),
      category: text(i.category, 30),
      available: int(i.available),           // null = unlimited
      perPersonLeft: int(i.perPersonLeft)    // null = no per-person limit
    })).filter(i => i.id && i.name && i.cost !== null && i.cost > 0) : []
  };

}

/** «+٧٠٠» / «−٢٠٠» (show inside dir="ltr") */
export function formatAmount(amount) {
  return `${amount < 0 ? '−' : '+'}${ar(Math.abs(amount))}`;
}

export const dateText = stamp => (stamp ? formatStamp(stamp) : '');

/** what one history row says besides its title */
export function historyLines(item) {
  const lines = [];
  if (item.score !== null && item.maxScore !== null) lines.push(`درجتك ${ar(item.score)}/${ar(item.maxScore)}`);
  if (item.pointsAwarded !== null && item.pointsAwarded > 0) lines.push(`حصلت على ${countPoints(item.pointsAwarded)}`);
  if ((item.pending || 0) > 0 || item.status === 'pending_review') lines.push('مستني مراجعة');
  return lines;
}

/** categories in first-seen order; one unnamed group when there are none */
export function groupShop(items) {
  const groups = [];
  for (const item of items) {
    let group = groups.find(g => g.category === item.category);
    if (!group) groups.push(group = { category: item.category, items: [] });
    group.items.push(item);
  }
  return groups;
}

/**
 * Can this item be ordered right now? { canOrder, reason, notes[] }
 * reason: 'stock' | 'per_person' | 'insufficient' | ''
 */
export function itemAvailability(item, balance) {
  const notes = [];
  if (item.available !== null && item.available > 0) notes.push(`فاضل ${ar(item.available)}`);
  if (item.perPersonLeft !== null && item.perPersonLeft > 0) notes.push(`تقدر تطلب ${ar(item.perPersonLeft)} كمان`);
  if (item.available === 0) return { canOrder: false, reason: 'stock', label: 'خلصت', notes: [] };
  if (item.perPersonLeft === 0) return { canOrder: false, reason: 'per_person', label: 'وصلت للحد المسموح', notes };
  if (balance !== null && balance < item.cost) return { canOrder: false, reason: 'insufficient', label: 'رصيدك مش كفاية', notes };
  return { canOrder: true, reason: '', label: 'اطلب', notes };
}

/** the confirm sheet's sentence: «هيتخصم ٧٠٠ نقطة، رصيدك هيبقى ٨٥٠» */
export function redeemPreview(item, balance) {
  if (balance === null) return { text: `هيتخصم ${countPoints(item.cost)}`, enough: true };
  const after = balance - item.cost;
  return after < 0
    ? { text: `الجايزة دي محتاجة ${countPoints(item.cost)}، ورصيدك ${ar(balance)}`, enough: false }
    : { text: `هيتخصم ${countPoints(item.cost)}، رصيدك هيبقى ${ar(after)}`, enough: true };
}

/** shopRedeem reply → { redemption, balance } (null when unusable) */
export function sanitizeRedeem(raw) {
  if (!raw || typeof raw !== 'object' || !raw.redemption || typeof raw.redemption !== 'object') return null;
  return {
    redemption: {
      id: cleanId(raw.redemption.id),
      status: REDEMPTION_LABELS[raw.redemption.status] ? raw.redemption.status : 'pending',
      itemName: text(raw.redemption.itemName, 60),
      cost: int(raw.redemption.cost) ?? 0
    },
    balance: num(raw.balance)
  };
}

export const redeemError = reply => REDEEM_ERRORS[reply && reply.code] || (reply && typeof reply.message === 'string' && reply.message.trim()) || 'حصلت مشكلة، جرّب تاني';

/** codes after which a retry must reuse the same requestKey (the order may have landed) */
export const KEEP_KEY = new Set(['network', 'busy']);


/* =========================================================
   v2: store schedule, cancel, seasons (docs/COMPETITIONS.md §18.3, §18.4)
========================================================= */

const STORE_STATES = ['open', 'scheduled', 'closed'];

/** portalMe `shop` state → { state, opensAt, closesAt, allowCancel }; a server
    that doesn't send it yet (v1) = open, as before */
export function sanitizeStore(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    state: STORE_STATES.includes(s.state) ? s.state : 'open',
    opensAt: cleanStamp(s.opensAt),
    closesAt: cleanStamp(s.closesAt),
    allowCancel: s.allowCancel === true
  };
}

/** the active season (balance and ledger belong to it), null when none */
export function sanitizeSeason(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = text(raw.name, 60);
  if (!name) return null;
  const max = num(raw.maxTheoretical);
  return {
    id: cleanId(raw.id),
    name,
    startAt: cleanStamp(raw.startAt),
    endAt: cleanStamp(raw.endAt),
    earned: num(raw.earned) ?? 0,
    maxTheoretical: max !== null && max > 0 ? max : 0
  };
}

function cleanPastSeason(raw) {
  const name = text(raw.name, 60);
  if (!name) return null;
  return {
    id: cleanId(raw.id),
    name,
    startAt: cleanStamp(raw.startAt),
    endAt: cleanStamp(raw.endAt),
    final: num(raw.final) ?? 0,
    earned: num(raw.earned) ?? 0,
    spent: num(raw.spent) ?? 0
  };
}

const dayOnly = stamp => (stamp ? formatStamp(stamp, { withTime: false }) : '');

/** «من الخميس ١ أكتوبر لحد السبت ٣١ أكتوبر» (whatever is known) */
export function seasonDates(season) {
  const from = dayOnly(season.startAt);
  const to = dayOnly(season.endAt);
  if (from && to) return `من ${from} لحد ${to}`;
  if (from) return `من ${from}`;
  if (to) return `لحد ${to}`;
  return '';
}

/** the season bar: «جمعت ٧٠٠ نقطة من أقصى ١٢٠٠» + the meter's fill (0..1); no meter without a max */
export function seasonProgress(season) {
  if (!season) return null;
  if (!(season.maxTheoretical > 0)) return { text: `جمعت ${countPoints(season.earned)} في الموسم ده`, ratio: null };
  return {
    text: `جمعت ${countPoints(season.earned)} من أقصى ${ar(season.maxTheoretical)}`,
    ratio: Math.max(0, Math.min(1, season.earned / season.maxTheoretical))
  };
}

/** a past season's line: «جمعت ٩٠٠ · صرفت ٣٠٠ · فضل ٦٠٠» */
export function pastSeasonLine(season) {
  return `جمعت ${ar(season.earned)} · صرفت ${ar(season.spent)} · آخر رصيد ${ar(season.final)}`;
}

/**
 * The store's words at this moment (Cairo stamp, the device's clock; the
 * server decides): { headline, countdown, due }. due = the opening/closing
 * time has passed here (ask the server again).
 */
export function storeWords(store, nowStamp) {
  if (!store) return { headline: '', countdown: '', due: false };
  if (store.state === 'scheduled') {
    const minutes = store.opensAt ? realMinutesBetween(nowStamp, store.opensAt) : null;
    return {
      headline: store.opensAt ? `المتجر هيفتح يوم ${formatStamp(store.opensAt)}` : 'المتجر هيفتح قريب',
      countdown: minutes !== null && minutes > 0 ? leftText(minutes) : '',
      due: minutes !== null && minutes <= 0
    };
  }
  if (store.state === 'closed') {
    return { headline: 'المتجر مقفول دلوقتي — طلباتك محفوظة والخدام بيسلّموها', countdown: '', due: false };
  }
  const minutes = store.closesAt ? realMinutesBetween(nowStamp, store.closesAt) : null;
  return {
    headline: store.closesAt ? `المتجر مفتوح لحد ${formatStamp(store.closesAt)}` : '',
    countdown: minutes !== null && minutes > 0 && minutes < 2 * 1440 ? leftText(minutes) : '',
    due: minutes !== null && minutes <= 0
  };
}

export const CANCEL_ERRORS = {
  shop_closed: 'المتجر قفل، مينفعش تلغي الطلب دلوقتي',
  not_allowed: 'الطلب ده مينفعش يتلغي دلوقتي (ممكن الخدام بدأوا يجهزوه)',
  not_found: 'الطلب ده مش موجود',
  busy: 'فيه ضغط كبير دلوقتي، جرّب كمان شوية',
  network: 'النت فاصل أو ضعيف، جرّب تاني'
};

export const cancelError = reply => CANCEL_ERRORS[reply && reply.code] || (reply && typeof reply.message === 'string' && reply.message.trim()) || 'حصلت مشكلة، جرّب تاني';

/** «تلغي طلب «كوباية»؟ هيرجعلك ٧٠٠ نقطة، رصيدك هيبقى ١٥٥٠» */
export function cancelPreview(redemption, balance) {
  const back = `هيرجعلك ${countPoints(redemption.cost)}`;
  return balance === null ? back : `${back}، رصيدك هيبقى ${ar(balance + redemption.cost)}`;
}

/** shopCancel reply → { redemption, balance } (null when unusable) */
export function sanitizeCancel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw.redemption && typeof raw.redemption === 'object' ? raw.redemption : {};
  return {
    redemption: {
      id: cleanId(r.id),
      status: REDEMPTION_LABELS[r.status] ? r.status : 'cancelled',
      itemName: text(r.itemName, 60),
      cost: int(r.cost)
    },
    balance: num(raw.balance)
  };
}

/** the dashboard after a cancel: that request cancelled (no more cancel), the balance from the reply */
export function applyCancel(me, redemptionId, reply) {
  const done = sanitizeCancel(reply);
  return {
    ...me,
    balance: done && done.balance !== null ? done.balance : me.balance,
    redemptions: me.redemptions.map(r => (r.id === redemptionId ? { ...r, status: 'cancelled', canCancel: false } : r))
  };
}

/** a request the server just refused to cancel: no button for it any more */
export const withoutCancel = (me, redemptionId) => ({ ...me, redemptions: me.redemptions.map(r => (redemptionId === '*' || r.id === redemptionId ? { ...r, canCancel: false } : r)) });

/** the store closed under us (shop_closed): closed, nothing can be cancelled */
export const storeClosed = me => (me.store ? { ...withoutCancel(me, '*'), store: { ...me.store, state: 'closed' } } : me);


/* ---------- the participant token: this tab only (sessionStorage) ---------- */

export function readToken(storage) {
  try {
    const value = storage && storage.getItem(TOKEN_KEY);
    return typeof value === 'string' && /^pt1\.[\w.-]{1,3000}$/.test(value) ? value : '';
  }
  catch {
    return '';
  }
}

export function writeToken(storage, token) {
  try {
    if (storage && typeof token === 'string' && token) storage.setItem(TOKEN_KEY, token);
    return true;
  }
  catch {
    return false;
  }
}

export function clearToken(storage) {
  try {
    if (storage) storage.removeItem(TOKEN_KEY);
  }
  catch {
    // nothing to do
  }
}
