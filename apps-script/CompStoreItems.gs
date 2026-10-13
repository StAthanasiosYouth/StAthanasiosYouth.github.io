/**
 * COMPETITIONS: THE REWARDS STORE (Phase 3). docs/COMPETITIONS.md §9.
 * (Named CompStoreItems.gs so it never clashes with Store.gs.)
 *
 * Switch: COMP_SHOP = '1' (needs the wallet). Tabs: StoreItems (draft,
 * script lock) and Redemptions (live, compLock_, next to the ledger).
 *
 * Remaining stock is derived: stock − redemptions that are not cancelled
 * (stock '' = unlimited). shopRedeem checks the item, the stock, the
 * per-person limit and the balance and writes the ledger row (redeem, −cost,
 * idemKey red:<id>) and the Redemption (pending) under ONE compLock_, so two
 * requests can never spend the same points or the last piece twice; the
 * same (participant, requestKey) gives the same redemption back.
 *
 * Statuses (admin): pending → approved → fulfilled; pending → fulfilled;
 * pending | approved → cancelled (a refund row +cost, idemKey ref:<id>,
 * once). fulfilled and cancelled are final.
 *
 * Pictures: an item's image is a Media Library id (imageRef_). Active items
 * of a switched-on store join the publish's media list (CompStore.gs
 * compDraft_ items → CompModel.gs compBuildPublic_), so the file reaches
 * the site with the next publish; «نقاطي» shows the picture only once that
 * file is published (Media.publishedAt).
 */

var SHOP_ITEM_ID = /^i-[0-9a-f]{8}$/;
var SHOP_REDEMPTION_ID = /^r-[0-9a-f]{10}$/;
var SHOP_LIMITS = { name: 60, description: 500, category: 30, cost: 1000000, stock: 100000, perPerson: 100, note: 200, page: 50, pageMax: 200 };
var SHOP_STATUSES = ['pending', 'approved', 'fulfilled', 'cancelled'];
var SHOP_STATUS_LABELS = { pending: 'مستني', approved: 'جاهزة للاستلام', fulfilled: 'اتسلمت', cancelled: 'اتلغت' };
var SHOP_NEXT = { pending: ['approved', 'fulfilled', 'cancelled'], approved: ['fulfilled', 'cancelled'], fulfilled: [], cancelled: [] };
var SHOP_IMAGES_SECONDS = 300;


/* =========================================================
   MODULE
========================================================= */

function compShopReady_() {

  return true;

}

function shopRequireOn_() {

  if (!compModules_().shop) {
    throw appError_('«متجر الجوائز» مش متفعّل.', 'فعّله من إعدادات المسابقات الأول.');
  }

}

function shopHasTab_(name) {

  var ss = compSpreadsheet_(false);

  return !!(ss && ss.getSheetByName(name));

}


/* =========================================================
   ROWS
========================================================= */

function shopNumberOrNull_(value) {

  var text = String(value === null || value === undefined ? '' : value).trim();

  return text === '' ? null : Number(text);

}

/* a StoreItems row as numbers / booleans */
function shopParseItem_(row) {

  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    image: row.image || '',
    cost: Number(row.cost) || 0,
    stock: shopNumberOrNull_(row.stock),
    perPerson: shopNumberOrNull_(row.perPerson),
    category: row.category || '',
    order: Number(row.order) || 0,
    active: compFlag_(row.active) === '1',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    __row: row.__row
  };

}

/* every item, in order */
function shopItems_() {

  if (!shopHasTab_('StoreItems')) return [];

  return compRows_(compSheet_('StoreItems')).map(shopParseItem_).sort(function (a, b) {
    return a.order === b.order ? a.__row - b.__row : a.order - b.order;
  });

}

/* every redemption row (text) */
function shopRedemptionRows_() {

  return shopHasTab_('Redemptions') ? compColumns_(compSheet_('Redemptions'), COMP_TABLES.Redemptions) : [];

}

/* { items: { itemId: taken }, mine: { itemId|pid: taken }, pending: { itemId: n } } (cancelled never count) */
function shopCounts_(redemptions) {

  var counts = { items: Object.create(null), mine: Object.create(null), pending: Object.create(null) };

  redemptions.forEach(function (r) {
    if (r.status === 'cancelled') return;
    counts.items[r.itemId] = (counts.items[r.itemId] || 0) + 1;
    counts.mine[r.itemId + '|' + r.participantId] = (counts.mine[r.itemId + '|' + r.participantId] || 0) + 1;
    if (r.status === 'pending') counts.pending[r.itemId] = (counts.pending[r.itemId] || 0) + 1;
  });

  return counts;

}

function shopAvailable_(item, counts) {

  return item.stock === null ? null : Math.max(0, item.stock - (counts.items[item.id] || 0));

}

/* for compDraft_ (the publish's media list): [{ id, name, image, active }] */
function compShopDraftItems_() {

  return shopItems_().map(function (i) { return { id: i.id, name: i.name, image: i.image, active: i.active }; });

}


/* =========================================================
   PICTURES
========================================================= */

/* { imageId: image object } of PUBLISHED library images (the public may only point at files on the site) */
function shopPublishedImages_() {

  var cache = CacheService.getScriptCache();
  var cached = null;

  try {
    cached = cache.get('shop:img');
  }
  catch (ignored) {
    cached = null;
  }

  if (cached) {
    var parsed = compJson_(cached, null);
    if (parsed && typeof parsed === 'object') return parsed;
  }

  var wanted = Object.create(null);

  shopItems_().forEach(function (i) { if (i.image) wanted[i.image] = true; });

  var rows = Object.keys(wanted).length ? readOptionalTable_('Media').filter(function (r) { return wanted[r.id] && r.publishedAt && !r.deletedAt; }) : [];
  var index = mediaIndex_(rows);
  var out = {};

  Object.keys(index).forEach(function (id) { out[id] = index[id]; });

  try {
    cache.put('shop:img', JSON.stringify(out), SHOP_IMAGES_SECONDS);
  }
  catch (ignored) {
    // read again next time
  }

  return out;

}

function shopDropImages_() {

  try {
    CacheService.getScriptCache().remove('shop:img');
  }
  catch (ignored) {
    // five minutes at most
  }

}


/* =========================================================
   ADMIN: ITEMS
========================================================= */

function shopAdminItem_(item, counts, library, published) {

  return {
    id: item.id,
    name: item.name,
    description: item.description,
    image: item.image,
    imageObj: item.image && library[item.image] ? library[item.image] : null,
    imagePublished: !!(item.image && published[item.image]),
    cost: item.cost,
    stock: item.stock,
    perPerson: item.perPerson,
    category: item.category,
    order: item.order,
    active: item.active,
    redeemed: counts.items[item.id] || 0,
    pending: counts.pending[item.id] || 0,
    available: shopAvailable_(item, counts),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };

}

/**
 * → { ready, items: [AdminItem], categories: [text], modules, limits, statuses }
 * AdminItem = { id, name, description, image, imageObj (library image object | null), imagePublished,
 *               cost, stock (null = unlimited), perPerson (null = no limit), category, order, active,
 *               redeemed (not cancelled), pending, available (null = unlimited), createdAt, updatedAt }
 */
function apiShopItems() {

  assertAdmin_();

  var result = { ready: !!compSpreadsheet_(false), items: [], categories: [], modules: compModules_(), limits: SHOP_LIMITS, statuses: SHOP_STATUS_LABELS };

  if (!result.ready) return result;

  var items = shopItems_();
  var counts = shopCounts_(shopRedemptionRows_());
  var mediaRows = readOptionalTable_('Media');
  var library = mediaIndex_(mediaRows);
  var published = Object.create(null);

  mediaRows.forEach(function (r) { if (r.publishedAt && !r.deletedAt) published[r.id] = true; });

  result.items = items.map(function (i) { return shopAdminItem_(i, counts, library, published); });

  // the price against the active season's theoretical maximum (CompSeasons.gs): for premium prizes
  var maximum = 0;

  try {
    maximum = typeof seasonMaxima_ === 'function' && compModules_().wallet ? (seasonMaxima_()[seasonActiveId_()] || {}).max || 0 : 0;
  }
  catch (ignored) {
    maximum = 0;
  }

  result.seasonMax = maximum;
  result.items.forEach(function (i) { i.pctOfMax = maximum ? Math.round(i.cost * 100 / maximum) : null; });
  result.categories = items.map(function (i) { return i.category; }).filter(function (c, i, all) { return c && all.indexOf(c) === i; });

  return result;

}


/* the item input (fields left out keep the stored value) → { record, problems } */
function shopValidateItem_(input, existing, taken) {

  var problems = [];
  var pick = function (key) { return input[key] !== undefined ? input[key] : existing ? existing[key] : undefined; };
  var record = {};

  record.name = contentLine_(pick('name'));
  if (!record.name) problems.push('اسم الجايزة مطلوب');
  else if (record.name.length > SHOP_LIMITS.name) problems.push('اسم الجايزة أطول من ' + regAr_(SHOP_LIMITS.name) + ' حرف');

  record.description = contentText_(pick('description')).trim();
  if (record.description.length > SHOP_LIMITS.description) problems.push('الوصف أطول من ' + regAr_(SHOP_LIMITS.description) + ' حرف');

  record.image = input.image !== undefined ? imageRef_(input.image, problems) : (existing ? existing.image : '');

  var cost = compInt_(pick('cost'), 1, SHOP_LIMITS.cost, NaN);
  if (isNaN(cost)) problems.push('النقاط المطلوبة لازم تكون رقم صحيح من ١ لـ مليون');
  record.cost = isNaN(cost) ? '' : String(cost);

  var stockValue = pick('stock');
  var stock = stockValue === null || stockValue === undefined || String(stockValue).trim() === '' ? null : compInt_(stockValue, 0, SHOP_LIMITS.stock, NaN);
  if (stock !== null && isNaN(stock)) problems.push('الكمية لازم تكون رقم صحيح من ٠ لـ ١٠٠٠٠٠ (أو فاضية = من غير حد)');
  else if (stock !== null && stock < taken) problems.push('الكمية أقل من اللي اتطلب فعلًا (' + regAr_(taken) + ')');
  record.stock = stock === null || isNaN(stock) ? '' : String(stock);

  var perValue = pick('perPerson');
  var per = perValue === null || perValue === undefined || String(perValue).trim() === '' ? null : compInt_(perValue, 1, SHOP_LIMITS.perPerson, NaN);
  if (per !== null && isNaN(per)) problems.push('الحد لكل مشترك لازم يكون رقم من ١ لـ ١٠٠ (أو فاضي = من غير حد)');
  record.perPerson = per === null || isNaN(per) ? '' : String(per);

  record.category = contentLine_(pick('category'));
  if (record.category.length > SHOP_LIMITS.category) problems.push('التصنيف أطول من ' + regAr_(SHOP_LIMITS.category) + ' حرف');

  var active = pick('active');
  record.active = active === undefined ? true : (active === true || compFlag_(active) === '1');

  if (input.order !== undefined) {
    var order = contentNumber_(input.order);
    if (order !== null && !isNaN(order)) record.order = String(order);
  }

  return { record: record, problems: problems };

}


/**
 * Adds (no input.id) or edits an item: { id?, name, description, image, cost, stock, perPerson, category,
 * order, active }. → { item: AdminItem }
 */
function apiShopItemSave(input) {

  assertAdmin_();
  shopRequireOn_();

  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  var id = input.id === undefined || input.id === null || input.id === '' ? '' : compValidId_(input.id, SHOP_ITEM_ID, 'معرّف الجايزة');

  var savedId = compWrite_('shop.item', function () {

    if (id) assertUnlocked_('shopitem:' + id);

    var t = compSheet_('StoreItems');
    var rows = compRows_(t);
    var current = id ? rows.filter(function (r) { return r.id === id; })[0] : null;

    if (id && !current) throw new Error('الجايزة مش موجودة');

    var taken = id ? (shopCounts_(shopRedemptionRows_()).items[id] || 0) : 0;
    var checked = shopValidateItem_(input, current ? shopParseItem_(current) : null, taken);

    if (checked.problems.length) fail_(checked.problems);

    var record = checked.record;
    var stamp = compNow_().stamp;

    record.updatedAt = stamp;

    if (current) {
      compUpdate_(t, current.__row, record, current);
      activityNote_({ action: 'update', type: 'shopitem', id: id, title: record.name, changes: activityDiff_(compStrip_(current), record) });
      shopDropImages_();
      return id;
    }

    record.id = 'i-' + compRandomHex_(4);
    record.order = record.order || String(rows.reduce(function (m, r) { var o = Number(r.order) || 0; return o > m ? o : m; }, 0) + 10);
    record.createdAt = stamp;
    compAppend_(t, [record]);
    activityNote_({ action: 'create', type: 'shopitem', id: record.id, title: record.name });
    shopDropImages_();

    return record.id;

  });

  return { item: apiShopItems().items.filter(function (i) { return i.id === savedId; })[0] };

}


/** Deletes an item nobody ever asked for (otherwise: switch it off). → { deleted, id } */
function apiShopItemDelete(id) {

  assertAdmin_();
  shopRequireOn_();
  compValidId_(id, SHOP_ITEM_ID, 'معرّف الجايزة');

  compWrite_('shop.delete', function () {

    assertUnlocked_('shopitem:' + id);

    var t = compSheet_('StoreItems');
    var row = compRows_(t).filter(function (r) { return r.id === id; })[0];

    if (!row) throw new Error('الجايزة مش موجودة');

    if (shopRedemptionRows_().some(function (r) { return r.itemId === id; })) {
      throw appError_('الجايزة دي اتطلبت قبل كده، ومينفعش تتمسح.', 'وقّفها (مش ظاهرة) بدل ما تمسحها: الطلبات القديمة بتفضل محفوظة.');
    }

    compDeleteRows_(t, [row.__row]);
    activityNote_({ action: 'delete', type: 'shopitem', id: id, title: row.name });
    shopDropImages_();

    return id;

  });

  return { deleted: true, id: id };

}


/* =========================================================
   ADMIN: REDEMPTIONS
========================================================= */

function shopAdminRedemption_(r, people) {

  var p = people[r.participantId] || {};

  return {
    id: r.id,
    participantId: r.participantId,
    participantName: p.name || '',
    group: p.group || '',
    itemId: r.itemId,
    itemName: r.itemName,
    cost: Number(r.cost) || 0,
    status: r.status,
    statusLabel: SHOP_STATUS_LABELS[r.status] || r.status,
    next: SHOP_NEXT[r.status] || [],
    requestedAt: r.requestedAt,
    handledBy: r.handledBy || '',
    handledAt: r.handledAt || '',
    note: r.note || '',
    refunded: !!r.refundLedgerId
  };

}

function shopPeople_() {

  var people = Object.create(null);

  regRows_().forEach(function (r) { people[r.id] = { name: r.name, group: r.group || '' }; });

  return people;

}

/**
 * query: { status: 'all' | 'open' (pending + approved) | <status>, participant (id), item (id), q (name / item),
 *          offset, limit ≤ 200 }   (newest first)
 * → { items: [AdminRedemption], total, offset, limit, counts: { all, pending, approved, fulfilled, cancelled } }
 * AdminRedemption = { id, participantId, participantName, group, itemId, itemName, cost, status, statusLabel,
 *                     next: [status], requestedAt, handledBy, handledAt, note, refunded }
 */
function apiShopRedemptions(query) {

  assertAdmin_();

  query = query && typeof query === 'object' && !Array.isArray(query) ? query : {};

  var limit = Math.max(1, Math.min(SHOP_LIMITS.pageMax, Math.floor(Number(query.limit)) || SHOP_LIMITS.page));
  var offset = Math.max(0, Math.floor(Number(query.offset)) || 0);
  var counts = { all: 0, pending: 0, approved: 0, fulfilled: 0, cancelled: 0 };
  var result = { items: [], total: 0, offset: offset, limit: limit, counts: counts };

  if (!compSpreadsheet_(false)) return result;

  var people = shopPeople_();
  var status = typeof query.status === 'string' ? query.status : 'all';
  var search = normName_(typeof query.q === 'string' ? query.q.slice(0, 60) : '');
  var rows = shopRedemptionRows_();

  rows.forEach(function (r) {
    counts.all++;
    if (counts[r.status] !== undefined) counts[r.status]++;
  });

  var found = rows.filter(function (r) {
    if (status === 'open' && r.status !== 'pending' && r.status !== 'approved') return false;
    if (status !== 'all' && status !== 'open' && r.status !== status) return false;
    if (typeof query.participant === 'string' && query.participant && r.participantId !== query.participant) return false;
    if (typeof query.item === 'string' && query.item && r.itemId !== query.item) return false;
    if (search) {
      var p = people[r.participantId] || {};
      if (normName_(p.name).indexOf(search) === -1 && normName_(r.itemName).indexOf(search) === -1 && r.id !== search) return false;
    }
    return true;
  }).reverse();

  result.total = found.length;
  result.items = found.slice(offset, offset + limit).map(function (r) { return shopAdminRedemption_(r, people); });

  return result;

}


/**
 * status: approved | fulfilled | cancelled (see SHOP_NEXT); note ≤ 200 (optional). The same status again
 * changes nothing (a second cancel refunds nothing). A cancel refunds the cost once (refund row
 * idemKey ref:<id>). → { redemption: AdminRedemption, balance, changed }
 */
function apiShopRedemptionStatus(id, status, note) {

  assertAdmin_();
  shopRequireOn_();
  compValidId_(id, SHOP_REDEMPTION_ID, 'رقم الطلب');

  if (SHOP_STATUSES.indexOf(status) === -1 || status === 'pending') throw new Error('الحالة مش مفهومة');

  var text = note === undefined || note === null ? null : contentLine_(note);

  if (text !== null && text.length > SHOP_LIMITS.note) throw appError_('الملاحظة أطول من ٢٠٠ حرف.', '', '', 'note');

  var out = { changed: false, pid: '' };

  compLiveWrite_('redemption.status', function (email) {

    var t = compSheet_('Redemptions');
    var rowNumber = compFindRow_(t, 'id', id);
    var row = rowNumber ? compRowAt_(t, rowNumber) : null;

    if (!row) throw new Error('الطلب مش موجود');

    out.pid = row.participantId;

    if (row.status === status) return 'same';

    if ((SHOP_NEXT[row.status] || []).indexOf(status) === -1) {
      throw appError_('مينفعش الطلب يتحول من «' + (SHOP_STATUS_LABELS[row.status] || row.status) + '» لـ «' + SHOP_STATUS_LABELS[status] + '».',
        row.status === 'fulfilled' ? 'الطلب اتسلم خلاص.' : row.status === 'cancelled' ? 'الطلب اتلغى والنقاط رجعت.' : '');
    }

    var stamp = compNow_().stamp;
    var patch = { status: status, handledBy: email, handledAt: stamp, updatedAt: stamp };

    if (text !== null) patch.note = text;

    if (status === 'cancelled' && !row.refundLedgerId) {
      patch.refundLedgerId = shopRefund_(row, email).id;
    }

    compUpdate_(t, rowNumber, patch, row);
    out.changed = true;

    activityNote_({ action: 'redemption.status', type: 'redemption', id: id, title: row.itemName, changes: { status: status } });

    return status;

  });

  var row = shopRedemptionRows_().filter(function (r) { return r.id === id; })[0];

  return { redemption: shopAdminRedemption_(row, shopPeople_()), balance: walletBalance_(out.pid, true), changed: out.changed };

}


/* =========================================================
   PORTAL AND PUBLIC
========================================================= */

/* «نقاطي»: { redemptions: [{ id, itemName, cost, status, requestedAt }], shop: [{ id, name, description, image,
   cost, category, available, perPersonLeft }] } */
function shopPortal_(pid) {

  var redemptions = shopRedemptionRows_();
  var counts = shopCounts_(redemptions);
  var images = shopPublishedImages_();

  return {
    redemptions: redemptions.filter(function (r) { return r.participantId === pid; }).reverse().slice(0, 200).map(function (r) {
      return { id: r.id, itemName: r.itemName, cost: Number(r.cost) || 0, status: r.status, requestedAt: r.requestedAt, canCancel: shopCanCancel_(r) };
    }),
    shop: shopItems_().filter(function (i) { return i.active; }).map(function (i) {
      return {
        id: i.id,
        name: i.name,
        description: i.description,
        image: i.image && images[i.image] ? images[i.image] : null,
        cost: i.cost,
        category: i.category,
        available: shopAvailable_(i, counts),
        perPersonLeft: i.perPerson === null ? null : Math.max(0, i.perPerson - (counts.mine[i.id + '|' + pid] || 0))
      };
    })
  };

}


/*
 * The same request again (under compLock_): a request whose charge was never linked is
 * settled first — its ledger row (idemKey red:<id>) is linked when it exists, otherwise it
 * is charged now, or cancelled when the balance no longer covers it.
 */
function shopSettle_(row, pid) {

  var t = compSheet_('Redemptions');
  var status = row.status;

  if (!row.ledgerId && row.status !== 'cancelled') {
    var rowNumber = compFindRow_(t, 'id', row.id);
    var charged = walletLedger_().filter(function (l) { return l.idemKey === 'red:' + row.id; })[0];
    if (!charged) {
      var cost = Number(row.cost) || 0;
      if (walletBalance_(pid, true) < cost) {
        if (rowNumber) compUpdate_(t, rowNumber, { status: 'cancelled', note: 'ما اتخصمش', updatedAt: compNow_().stamp }, null);
        return compFail_('insufficient', 'رصيدك مش كفاية.', { balance: walletBalance_(pid, true) });
      }
      charged = walletAppend_([{ participantId: pid, amount: -cost, kind: 'redeem', refType: 'redemption', refId: row.id, note: row.itemName, idemKey: 'red:' + row.id, actor: '' }])[0];
    }
    if (rowNumber) compUpdate_(t, rowNumber, { ledgerId: charged.id }, null);
  }

  return { ok: true, redemption: { id: row.id, status: status, itemName: row.itemName, cost: Number(row.cost) || 0 }, balance: walletBalance_(pid, true), replay: true };

}


/**
 * shopRedeem { ptoken, itemId, requestKey } → { ok, redemption: { id, status, itemName, cost }, balance }.
 * Everything under one compLock_: the same requestKey → the same redemption; item active; stock left;
 * the per-person limit; balance ≥ cost; then the ledger row and the Redemption.
 */
function shopRedeemAction_(arg) {

  arg = compArg_(arg);

  if (!arg || typeof arg.itemId !== 'string' || !SHOP_ITEM_ID.test(arg.itemId) ||
      typeof arg.requestKey !== 'string' || !COMP_CLIENT_KEY.test(arg.requestKey)) {
    return compFail_('bad');
  }

  var participant = compParticipantFromToken_(arg.ptoken);

  if (!participant) return compFail_('session');

  var pid = participant.id;

  // outside the points age range: the balance and history stay, ordering doesn't (§19.3)
  if (typeof regEligibilityOf_ === 'function' && regEligibilityOf_(participant).state === 'out') {
    return compFail_('not_eligible', REG_AGE_NOTICE);
  }

  var lock = compLock_();

  if (!lock) return compFail_('busy');

  var reply = null;

  try {

    var redemptions = shopRedemptionRows_();
    // a request that failed before it was charged (cancelled, no ledger row) is not "the same request"
    var same = redemptions.filter(function (r) { return r.participantId === pid && r.requestKey === arg.requestKey && !(r.status === 'cancelled' && !r.ledgerId); })[0];

    if (same) {
      reply = shopSettle_(same, pid);
      return reply;
    }

    // the store's own window (§18.3): a request that already landed is answered above even when closed
    if (shopState_(shopSettings_(), compNow_().wall).state !== 'open') {
      reply = compFail_('shop_closed');
      return reply;
    }

    var item = shopItems_().filter(function (i) { return i.id === arg.itemId; })[0];

    if (!item || !item.active) {
      reply = compFail_('not_found', 'الجايزة دي مش متاحة دلوقتي.');
      return reply;
    }

    var counts = shopCounts_(redemptions);
    var available = shopAvailable_(item, counts);

    if (available !== null && available <= 0) {
      reply = compFail_('stock', 'الجايزة دي خلصت.');
      return reply;
    }

    if (item.perPerson !== null && (counts.mine[item.id + '|' + pid] || 0) >= item.perPerson) {
      reply = compFail_('per_person', 'وصلت للحد المسموح من الجايزة دي.');
      return reply;
    }

    var balance = walletBalance_(pid, true);

    if (balance < item.cost) {
      reply = compFail_('insufficient', 'رصيدك مش كفاية.', { balance: balance });
      return reply;
    }

    var id = 'r-' + compRandomHex_(5);
    var stamp = compNow_().stamp;
    var t = compSheet_('Redemptions');

    // 1. the request (not charged yet: ledgerId empty)
    var rowNumber = compAppend_(t, [{
      id: id,
      participantId: pid,
      itemId: item.id,
      itemName: item.name,
      cost: String(item.cost),
      status: 'pending',
      requestKey: arg.requestKey,
      ledgerId: '',
      refundLedgerId: '',
      requestedAt: stamp,
      handledBy: '',
      handledAt: '',
      note: '',
      updatedAt: stamp,
      seasonId: walletSeasonNow_()
    }])[0];

    // claim, then verify (§18.2): the request is in the sheet; the sheet's own row order
    // decides who got the last one. Counted again from the written rows: if ours is past
    // the stock, it is cancelled here, before any point moves.
    if (item.stock !== null) {
      SpreadsheetApp.flush();
      var taken = 0;
      compColumns_(t, ['itemId', 'status']).forEach(function (r) {
        if (r.__row <= rowNumber && r.itemId === item.id && r.status !== 'cancelled') taken++;
      });
      if (taken > item.stock) {
        compUpdate_(t, rowNumber, { status: 'cancelled', note: 'الجايزة خلصت', updatedAt: stamp }, null);
        reply = compFail_('stock', 'الجايزة دي خلصت.');
        return reply;
      }
    }

    // 2. the charge; if it fails the request is cancelled (never an uncharged prize)
    var entry;

    try {
      entry = walletAppend_([{ participantId: pid, amount: -item.cost, kind: 'redeem', refType: 'redemption', refId: id, note: item.name, idemKey: 'red:' + id, actor: '' }])[0];
    }
    catch (error) {
      try {
        compUpdate_(t, rowNumber, { status: 'cancelled', note: 'ما اتخصمش', updatedAt: stamp }, null);
      }
      catch (ignored) {
        // a replay with the same key settles it (shopSettle_)
      }
      throw error;
    }

    // 3. the link (if this fails, the ledger row's refId still names the request: shopSettle_ heals it)
    try {
      compUpdate_(t, rowNumber, { ledgerId: entry.id }, null);
    }
    catch (ignored) {
      // healed on a replay / by the ledger's refId
    }

    reply = { ok: true, redemption: { id: id, status: 'pending', itemName: item.name, cost: item.cost }, balance: balance - item.cost };

  }
  finally {
    lock.releaseLock();
  }

  return reply;

}


/* =========================================================
   SCHEDULE AND PARTICIPANT CANCEL (docs/COMPETITIONS.md §18.3)
========================================================= */

var SHOP_MODES = ['auto', 'open', 'preview', 'closed'];
var SHOP_SETTINGS_CACHE = 'shop:settings';
var SHOP_NOTIFY_KEYS = ['open1d', 'open1h', 'openAt', 'close24h', 'close1h'];

/* { mode, opensAt, closesAt ('YYYY-MM-DD HH:MM' | ''), allowCancel, notify } (Script Properties, 60 s cache) */
function shopSettings_() {

  var cache = CacheService.getScriptCache();
  var hit = cache.get(SHOP_SETTINGS_CACHE);

  if (hit) {
    try {
      return JSON.parse(hit);
    }
    catch (ignored) {
      // read again below
    }
  }

  var props = PropertiesService.getScriptProperties();
  var notify = {};

  try {
    notify = JSON.parse(props.getProperty('SHOP_NOTIFY') || '{}') || {};
  }
  catch (ignored) {
    notify = {};
  }

  var settings = {
    mode: SHOP_MODES.indexOf(props.getProperty('SHOP_MODE')) !== -1 ? props.getProperty('SHOP_MODE') : 'auto',
    opensAt: String(props.getProperty('SHOP_OPENS_AT') || ''),
    closesAt: String(props.getProperty('SHOP_CLOSES_AT') || ''),
    allowCancel: props.getProperty('SHOP_ALLOW_CANCEL') === '1',
    // auto: the prizes are shown (no ordering) before opensAt (§19.1)
    preview: props.getProperty('SHOP_PREVIEW') === '1',
    notify: SHOP_NOTIFY_KEYS.reduce(function (out, key) { out[key] = !!notify[key]; return out; }, {})
  };

  cache.put(SHOP_SETTINGS_CACHE, JSON.stringify(settings), 60);

  return settings;

}

/* 'YYYY-MM-DD HH:MM' → 'YYYY-MM-DDTHH:MM' ('' stays '') */
function shopWall_(stamp) {

  return stamp ? String(stamp).replace(' ', 'T') : '';

}

/* { state: open | scheduled | closed, opensAt, closesAt, allowCancel } at the Cairo wall time nowWall */
function shopState_(settings, nowWall) {

  var opens = shopWall_(settings.opensAt);
  var closes = shopWall_(settings.closesAt);
  var state = 'open';

  if (settings.mode === 'closed') state = 'closed';
  else if (settings.mode === 'preview') state = 'preview';
  else if (settings.mode === 'auto') {
    if (opens && nowWall < opens) state = settings.preview ? 'preview' : 'scheduled';
    else if (closes && nowWall >= closes) state = 'closed';
  }

  return { state: state, opensAt: opens, closesAt: closes, allowCancel: !!settings.allowCancel };

}

/* portalMe's `store` */
function shopStoreState_() {

  return shopState_(shopSettings_(), compNow_().wall);

}

/* may the participant cancel this request now? (the season rule comes from CompWallet.gs) */
function shopCanCancel_(row) {

  if (!row || row.status !== 'pending') return false;

  var state = shopStoreState_();

  if (!state.allowCancel || state.state !== 'open') return false;

  return typeof walletSeasonIsActive_ !== 'function' || walletSeasonIsActive_(row.seasonId || '');

}

/* the refund of a request (once: idemKey ref:<id>); under compLock_ */
function shopRefund_(row, actor) {

  var key = 'ref:' + row.id;
  var existing = walletLedger_().filter(function (l) { return l.idemKey === key; })[0];

  return existing || walletAppend_([{ participantId: row.participantId, amount: Number(row.cost) || 0, kind: 'refund', refType: 'redemption', refId: row.id, note: row.itemName, idemKey: key, actor: actor || '', seasonId: row.seasonId || '' }])[0];

}

/**
 * shopCancel { ptoken, redemptionId } → { ok, redemption, balance }. Only while the store is open,
 * the setting allows it, the request is the participant's own, still pending, and in the active season.
 */
function shopCancelAction_(arg) {

  arg = compArg_(arg);

  if (!arg || typeof arg.redemptionId !== 'string' || !SHOP_REDEMPTION_ID.test(arg.redemptionId)) {
    return compFail_('bad');
  }

  var participant = compParticipantFromToken_(arg.ptoken);

  if (!participant) return compFail_('session');

  var state = shopStoreState_();

  if (state.state !== 'open') return compFail_('shop_closed');
  if (!state.allowCancel) return compFail_('not_allowed');

  var lock = compLock_();

  if (!lock) return compFail_('busy');

  try {

    var t = compSheet_('Redemptions');
    var rowNumber = compFindRow_(t, 'id', arg.redemptionId);
    var row = rowNumber ? compRowAt_(t, rowNumber) : null;
    var reply = function (r) {
      return { ok: true, redemption: { id: r.id, status: 'cancelled', itemName: r.itemName, cost: Number(r.cost) || 0 }, balance: walletBalance_(participant.id, true) };
    };

    if (!row || row.participantId !== participant.id) return compFail_('not_found', 'الطلب ده مش موجود.');

    // the same cancel again (a retry): its result
    if (row.status === 'cancelled' && row.handledBy === 'participant') return reply(row);

    if (!shopCanCancel_(row)) return compFail_('not_allowed');

    var stamp = compNow_().stamp;
    var patch = { status: 'cancelled', handledBy: 'participant', handledAt: stamp, note: 'لغاه المشترك', updatedAt: stamp };

    // a request whose charge never landed has nothing to give back
    if (row.ledgerId) patch.refundLedgerId = shopRefund_(row, '').id;

    compUpdate_(t, rowNumber, patch, row);

    return reply(row);

  }
  finally {
    lock.releaseLock();
  }

}


/* the admin's view of the schedule (§18.7) */
function shopScheduleView_() {

  var settings = shopSettings_();
  var state = shopState_(settings, compNow_().wall);

  return {
    mode: settings.mode,
    opensAt: settings.opensAt,
    closesAt: settings.closesAt,
    allowCancel: settings.allowCancel,
    preview: !!settings.preview,
    state: state.state,
    notify: settings.notify,
    auto: typeof pushAutoState_ === 'function' ? pushAutoState_() : null
  };

}

function apiShopSchedule() {

  assertAdmin_();
  shopRequireOn_();

  return shopScheduleView_();

}

/**
 * input: { mode, opensAt, closesAt ('YYYY-MM-DD HH:MM' | ''), allowCancel,
 * notify: { open1d, open1h, openAt, close24h, close1h } }. Never touches points
 * or requests: closing the store keeps every request and every balance.
 */
function apiShopScheduleSave(input) {

  assertAdmin_();
  shopRequireOn_();

  input = input || {};

  var mode = SHOP_MODES.indexOf(input.mode) !== -1 ? input.mode : null;

  if (!mode) throw appError_('اختار طريقة فتح المتجر.', '', '', 'mode');

  var opens = shopStampIn_(input.opensAt, 'opensAt', 'ميعاد الفتح');
  var closes = shopStampIn_(input.closesAt, 'closesAt', 'ميعاد القفل');

  if (opens && closes && closes <= opens) {
    throw appError_('ميعاد القفل لازم يكون بعد ميعاد الفتح.', '', '', 'closesAt');
  }

  var notify = SHOP_NOTIFY_KEYS.reduce(function (out, key) { out[key] = !!(input.notify && input.notify[key]); return out; }, {});
  var before = shopSettings_();

  PropertiesService.getScriptProperties().setProperties({
    SHOP_MODE: mode,
    SHOP_OPENS_AT: opens,
    SHOP_CLOSES_AT: closes,
    SHOP_ALLOW_CANCEL: input.allowCancel ? '1' : '',
    SHOP_PREVIEW: input.preview ? '1' : '',
    SHOP_NOTIFY: JSON.stringify(notify)
  });

  CacheService.getScriptCache().remove(SHOP_SETTINGS_CACHE);

  // the linked bell items and their automatic sends (CompSchedule.gs)
  if (typeof pushScheduleSyncShop_ === 'function') pushScheduleSyncShop_();

  activity_({ action: 'settings', type: 'shopitem', id: 'schedule', title: 'مواعيد المتجر',
    changes: { mode: mode, opensAt: opens, closesAt: closes, allowCancel: !!input.allowCancel, was: before.mode } });

  return shopScheduleView_();

}

/* a Cairo stamp from the admin ('' allowed) → 'YYYY-MM-DD HH:MM' */
function shopStampIn_(value, field, label) {

  var text = String(value === undefined || value === null ? '' : value).trim();

  if (!text) return '';

  var wall = contentDateTime_(text.replace('T', ' '), false);

  if (!wall) throw appError_(label + ' مش مكتوب صح.', 'مثلاً: 2026-10-20 19:00', '', field);

  return wall.replace('T', ' ');

}
