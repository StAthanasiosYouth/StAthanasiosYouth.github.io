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
import { formatStamp } from '../words.js';

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
  not_found: 'الجايزة دي مش موجودة دلوقتي'
};

/** portalMe reply → what the dashboard shows (null when unusable). */
export function sanitizeMe(raw) {

  if (!raw || typeof raw !== 'object' || !raw.participant || typeof raw.participant !== 'object') return null;

  const name = text(raw.participant.name, 80);
  if (!name) return null;

  const features = raw.features && typeof raw.features === 'object' ? raw.features : {};
  const wallet = features.wallet === true;
  const shop = wallet && features.shop === true;

  return {
    participant: { name, group: text(raw.participant.group, 60) },
    features: { wallet, shop },
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
      requestedAt: cleanStamp(r.requestedAt)
    })).filter(r => r.itemName),
    shop: shop ? list(raw.shop).slice(0, 200).map(i => ({
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
