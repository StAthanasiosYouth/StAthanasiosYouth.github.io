/**
 * EVENTS: THE PURE MODEL. docs/EVENTS.md §2, §3, §17.6.
 *
 * No Google API calls: the same code runs in Apps Script (Pages.gs, the
 * publish) and in Node (tests). Holds the event kinds, the booking spec
 * (window, capacity, pricing, payment mode) as the editor sends it and as
 * it is stored, the price arithmetic, and the public `booking` block of
 * event.json.
 *
 * Phase 3 publishes events for display: `booking.online` is false and the
 * page sends people to a servant on WhatsApp. Phase 4 adds the engine.
 */

var EVENT_KINDS = {
  trip: { label: 'رحلة', icon: 'bus', theme: 'azure', cta: 'احجز الآن' },
  conference: { label: 'مؤتمر', icon: 'users', theme: 'gold', cta: 'احجز الآن' },
  funday: { label: 'يوم ترفيهي', icon: 'star', theme: 'emerald', cta: 'احجز الآن' }
};

/* online: may a VISITOR pay this way on the site ('1' / '0'; cash is servant-assisted, Phase 1) */
var PAY_METHOD_SEED = [
  { key: 'cash', label: 'كاش', icon: '', needsProof: '', online: '0' },
  { key: 'instapay', label: 'إنستاباي', icon: '', needsProof: '1', online: '1' },
  { key: 'wallet', label: 'محفظة', icon: '', needsProof: '1', online: '1' }
];

/*
 * Is a PayMethods row an online one (the visitor pays on the site and sends
 * a proof)? '1' / '0' as saved; a row from before the column (blank): a
 * method that needs a proof is online, one that doesn't (cash) isn't — the
 * same rule as the Worker's methodOnline (worker/src/book/model.js).
 */
function bookMethodOnline_(m) {

  var value = m ? m.online : '';

  if (value === true || value === '1' || value === 1) return true;
  if (value === false || value === '0' || value === 0) return false;

  return !!m && contentBool_(m.needsProof);

}

var BOOK_LIMITS = {
  title: 80,
  shortTitle: 30,
  summary: 200,
  body: 3000,
  terms: 800,
  locationName: 80,
  categories: 6,
  categoryLabel: 30,
  categoryNote: 60,
  price: 200000,
  perBookingMax: 30,
  categoryMax: 30,
  capacity: 100000,
  servants: 12,
  gallery: 8,
  methodLabel: 24
};

var BOOK_CATEGORY_KEY = /^[a-z][a-z0-9_]{1,15}$/;
var BOOK_METHOD_KEY = /^[a-z][a-z0-9_]{1,19}$/;
var BOOK_GROUPS = ['adult', 'child', 'companion'];


/* a whole number from the editor (Arabic digits too): the number, '' when empty, NaN when not whole */
function bookWhole_(value) {

  var text = contentDigits_(value === null || value === undefined ? '' : String(value)).replace(/[\s,٬]/g, '');

  if (!text) return '';
  if (!/^\d+$/.test(text)) return NaN;

  return Number(text);

}


/* a Cairo stamp from the editor → 'YYYY-MM-DD HH:MM' ('' empty); a bad one is a problem */
function bookStamp_(value, endOfDay, label, problems) {

  var text = contentDigits_(value === null || value === undefined ? '' : String(value)).replace('T', ' ');

  if (!text) return '';

  var wall = contentDateTime_(text, endOfDay);

  if (!wall) {
    problems.push(label + ' مش مفهوم (اكتبه كده: 2026-10-20 18:00)');
    return '';
  }

  return wall.replace('T', ' ');

}


/**
 * The pricing as the editor sends it → the stored spec (§3), problems
 * named «الأسعار: …». The first category is always the applicant (min =
 * max = 1); `single` keeps the applicant only.
 */
function bookPricingInput_(value, problems) {

  value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  var mode = value.mode === 'group' ? 'group' : 'single';
  var list = Array.isArray(value.categories) ? value.categories : [];
  var seen = Object.create(null);
  var categories = [];

  if (list.length > BOOK_LIMITS.categories) {
    problems.push('الأسعار: ' + BOOK_LIMITS.categories + ' فئات بالكتير');
    list = list.slice(0, BOOK_LIMITS.categories);
  }

  list.forEach(function (raw, i) {

    raw = raw && typeof raw === 'object' ? raw : {};

    var first = i === 0;
    var key = first ? 'applicant' : contentLine_(raw.key).toLowerCase();
    var label = contentLine_(raw.label) || (first ? 'الحاجز' : '');
    var where = 'الأسعار (' + (label || ('فئة ' + (i + 1))) + '): ';
    var price = bookWhole_(raw.price);

    if (!first && !BOOK_CATEGORY_KEY.test(key)) {
      // a new row from the editor: a key from its position
      key = 'cat' + (i + 1);
    }

    if (seen[key]) {
      problems.push(where + 'الفئة متكررة');
      return;
    }

    seen[key] = true;

    if (!label) problems.push(where + 'اسم الفئة مطلوب');
    if (label.length > BOOK_LIMITS.categoryLabel) problems.push(where + 'الاسم أطول من ' + BOOK_LIMITS.categoryLabel + ' حرف');
    if (price === '' || isNaN(price) || price > BOOK_LIMITS.price) problems.push(where + 'السعر لازم يكون رقم صحيح من ٠ لـ ' + BOOK_LIMITS.price);

    var min = first ? 1 : 0;
    var max = first ? 1 : bookWhole_(raw.max);

    if (!first && (max === '' || isNaN(max) || max < 1 || max > BOOK_LIMITS.categoryMax)) {
      if (max !== '') problems.push(where + 'أقصى عدد لازم يكون من ١ لـ ' + BOOK_LIMITS.categoryMax);
      max = 10;
    }

    // an age range (participants mode, «كل فرد باسمه وسنه»): this price for ages inside it
    var ageMin = first ? '' : bookWhole_(raw.ageMin);
    var ageMax = first ? '' : bookWhole_(raw.ageMax);
    if ((ageMin !== '' && (isNaN(ageMin) || ageMin > 120)) || (ageMax !== '' && (isNaN(ageMax) || ageMax > 120))) {
      problems.push(where + 'السن لازم يكون رقم من ٠ لـ ١٢٠');
      ageMin = ageMax = '';
    }
    if (ageMin !== '' && ageMax !== '' && ageMin > ageMax) problems.push(where + 'السن «من» لازم يكون أصغر من «لحد»');

    var note = contentLine_(raw.note);

    if (note.length > BOOK_LIMITS.categoryNote) problems.push(where + 'الملاحظة أطول من ' + BOOK_LIMITS.categoryNote + ' حرف');

    categories.push({
      key: key,
      label: label.slice(0, BOOK_LIMITS.categoryLabel),
      group: first ? 'adult' : (BOOK_GROUPS.indexOf(raw.group) !== -1 ? raw.group : 'adult'),
      price: isNaN(price) || price === '' ? 0 : Math.min(price, BOOK_LIMITS.price),
      seat: first ? true : raw.seat !== false,
      min: min,
      max: max,
      note: note.slice(0, BOOK_LIMITS.categoryNote),
      ageMin: ageMin === '' ? null : ageMin,
      ageMax: ageMax === '' ? null : ageMax,
      // age eligibility (§4.9): a category switched off refuses companions priced into it (the booker's is always on)
      allowed: first ? true : raw.allowed !== false
    });

  });

  if (!categories.length) {
    problems.push('الأسعار: سعر الحاجز مطلوب');
    categories.push({ key: 'applicant', label: 'الحاجز', group: 'adult', price: 0, seat: true, min: 1, max: 1, note: '' });
  }

  if (mode === 'single' && categories.length > 1) {
    categories = categories.slice(0, 1);
  }

  return { mode: mode, categories: categories };

}


/**
 * The booking block as the editor sends it → the stored spec, or null (an
 * event without booking). Times are Cairo stamps 'YYYY-MM-DD HH:MM'.
 * startAt: the event's start (the window closes by it at the latest).
 */
function bookBookingInput_(value, startAt, problems) {

  if (!value || typeof value !== 'object' || Array.isArray(value) || value.enabled === false) return null;

  var opensAt = bookStamp_(value.opensAt, false, 'الحجز يفتح', problems);
  var closesAt = bookStamp_(value.closesAt, true, 'الحجز يقفل', problems);
  var capacity = bookWhole_(value.capacity);
  var perBookingMax = bookWhole_(value.perBookingMax);
  var showLeftBelow = bookWhole_(value.showLeftBelow);
  var payment = value.payment && typeof value.payment === 'object' ? value.payment : {};
  var minFirst = bookWhole_(payment.minFirst);
  var finalDueAt = bookStamp_(payment.finalDueAt, true, 'آخر ميعاد للدفع', problems);

  if (opensAt && closesAt && opensAt >= closesAt) problems.push('الحجز: ميعاد القفل لازم يكون بعد ميعاد الفتح');
  if (closesAt && startAt && closesAt > startAt.replace('T', ' ')) problems.push('الحجز: لازم يقفل قبل ما الفعالية تبدأ أو وقتها');

  if (capacity !== '' && (isNaN(capacity) || capacity < 1 || capacity > BOOK_LIMITS.capacity)) {
    problems.push('العدد المتاح لازم يكون رقم من ١ لـ ' + BOOK_LIMITS.capacity + '، أو فاضي (من غير حد)');
    capacity = '';
  }

  if (perBookingMax !== '' && (isNaN(perBookingMax) || perBookingMax < 1 || perBookingMax > BOOK_LIMITS.perBookingMax)) {
    problems.push('أقصى عدد في الحجز الواحد لازم يكون من ١ لـ ' + BOOK_LIMITS.perBookingMax);
    perBookingMax = '';
  }

  if (minFirst !== '' && isNaN(minFirst)) {
    problems.push('أول دفعة لازم تكون رقم صحيح');
    minFirst = '';
  }

  var pricing = bookPricingInput_(value.pricing, problems);

  // age eligibility (§4.9): the main booker's age range at the event (empty = no limit)
  var age = value.bookerAge && typeof value.bookerAge === 'object' ? value.bookerAge : {};
  var ageMin = bookWhole_(age.min);
  var ageMax = bookWhole_(age.max);
  if ((ageMin !== '' && (isNaN(ageMin) || ageMin > 120)) || (ageMax !== '' && (isNaN(ageMax) || ageMax > 120))) {
    problems.push('سن الحاجز لازم يكون رقم من ٠ لـ ١٢٠');
    ageMin = ageMax = '';
  }
  if (ageMin !== '' && ageMax !== '' && ageMin > ageMax) problems.push('سن الحاجز: «من» لازم يكون أصغر من «لحد»');
  var bookerAge = ageMin === '' && ageMax === '' ? null : { min: ageMin === '' ? null : ageMin, max: ageMax === '' ? null : ageMax };

  return {
    bookerAge: bookerAge,
    ageStrict: value.ageStrict === true,
    opensAt: opensAt,
    closesAt: closesAt,
    capacity: capacity === '' ? null : capacity,
    perBookingMax: perBookingMax === '' ? 10 : perBookingMax,
    collectNames: value.collectNames === true,
    // «كل فرد باسمه وسنه»: the visitor adds people one by one (name + age); each is priced by age
    participants: value.participants === true,
    // the servants' WhatsApp (their approved public contact only): on the event page / after a booking
    contactOnPage: value.contactOnPage !== false,
    contactAfter: value.contactAfter === true,
    showLeft: value.showLeft !== false,
    showLeftBelow: showLeftBelow === '' || isNaN(showLeftBelow) ? 20 : Math.min(showLeftBelow, BOOK_LIMITS.capacity),
    pricing: pricing,
    payment: {
      mode: payment.mode === 'installments' ? 'installments' : 'full',
      minFirst: payment.mode === 'installments' && minFirst !== '' ? minFirst : 0,
      finalDueAt: payment.mode === 'installments' ? finalDueAt : ''
    }
  };

}


/* the stored JSON text → the spec, or null */
function bookSpecParse_(text) {

  if (!text) return null;

  try {
    var spec = JSON.parse(text);
    return spec && typeof spec === 'object' && !Array.isArray(spec) && spec.pricing ? spec : null;
  }
  catch (ignored) {
    return null;
  }

}


/* {categoryKey: count} → the price (§3; unknown keys count nothing) */
function bookQuote_(pricing, counts) {

  return ((pricing && pricing.categories) || []).reduce(function (sum, c) {
    var n = Number(counts && counts[c.key]) || 0;
    return sum + n * c.price;
  }, 0);

}

/* seats a booking takes: the categories that sit */
function bookSeats_(pricing, counts) {

  return ((pricing && pricing.categories) || []).reduce(function (sum, c) {
    return sum + (c.seat ? Number(counts && counts[c.key]) || 0 : 0);
  }, 0);

}

/* { adult, child, companion, total } */
function bookPeople_(pricing, counts) {

  var people = { adult: 0, child: 0, companion: 0, total: 0 };

  ((pricing && pricing.categories) || []).forEach(function (c) {
    var n = Number(counts && counts[c.key]) || 0;
    people[c.group] += n;
    people.total += n;
  });

  return people;

}


/**
 * event.json `booking` (§17.6) from the stored spec. servants: the event's
 * [{ id, methods }]; servantRows: the registry by id; methodRows: the
 * payment methods; image(id): a published image or null. online: the
 * Script Property BOOKING_ONLINE ('1' = the page takes bookings through the
 * new backend, worker/BOOKING-API.md); false keeps the Phase 3 display.
 */
function bookPublicBooking_(spec, servants, servantRows, methodRows, image, online) {

  if (!spec) return null;

  var methods = Object.create(null);

  (methodRows || []).forEach(function (m) { methods[m.key] = m; });

  var usedMethods = [];
  var people = [];

  (servants || []).forEach(function (s) {
    var row = servantRows[s.id];
    if (!row || !contentBool_(row.active)) return;
    var keys = (s.methods || []).filter(function (k) { return methods[k] && contentBool_(methods[k].active); });
    keys.forEach(function (k) { if (usedMethods.indexOf(k) === -1) usedMethods.push(k); });
    var phone = row.phone ? normalizePhone(row.phone) : null;
    people.push({
      id: row.id,
      name: contentLine_(row.name).slice(0, 60),
      role: contentLine_(row.role).slice(0, 40),
      image: row.image ? image(row.image) : null,
      // only with the servant's consent («رقمه يظهر للزوار»)
      wa: contentBool_(row.publicWa) && phone ? 'https://wa.me/' + phone.e164 : null,
      methods: keys
    });
  });

  var wall = function (stamp) { return stamp ? (contentDateTime_(stamp, false) || '') : ''; };

  return {
    online: online === true,
    opensAt: wall(spec.opensAt),
    closesAt: spec.closesAt ? (contentDateTime_(spec.closesAt, true) || '') : '',
    capacity: spec.capacity === null || spec.capacity === undefined ? null : spec.capacity,
    showLeft: spec.showLeft !== false,
    showLeftBelow: spec.showLeftBelow === undefined || spec.showLeftBelow === null ? 20 : spec.showLeftBelow,
    perBookingMax: spec.perBookingMax || 10,
    collectNames: !!spec.collectNames || !!spec.participants,
    participants: !!spec.participants,
    // age eligibility (§4.9): only when set, so older events publish exactly as before
    bookerAge: spec.bookerAge ? { min: spec.bookerAge.min, max: spec.bookerAge.max } : undefined,
    ageStrict: spec.ageStrict === true ? true : undefined,
    contactOnPage: spec.contactOnPage !== false,
    contactAfter: spec.contactAfter === true,
    pricing: {
      mode: spec.pricing.mode,
      categories: spec.pricing.categories.map(function (c) {
        // participants mode: the counts come from the people list (each priced by age), so no category
        // limits but the booking's own; the age range says which price applies
        var people = !!spec.participants;
        var out = { key: c.key, label: c.label, group: c.group, price: c.price, seat: c.seat, min: people ? 0 : c.min, max: people ? (spec.perBookingMax || 10) : c.max, note: c.note };
        if (c.ageMin !== null && c.ageMin !== undefined) out.ageMin = c.ageMin;
        if (c.ageMax !== null && c.ageMax !== undefined) out.ageMax = c.ageMax;
        if (c.allowed === false) out.allowed = false;
        return out;
      })
    },
    payment: {
      mode: spec.payment && spec.payment.mode === 'installments' ? 'installments' : 'full',
      minFirst: spec.payment && spec.payment.minFirst ? spec.payment.minFirst : 0,
      finalDueAt: spec.payment && spec.payment.finalDueAt ? (contentDateTime_(spec.payment.finalDueAt, true) || '') : ''
    },
    methods: usedMethods.map(function (k) { return { key: k, label: contentLine_(methods[k].label) || k, icon: contentLine_(methods[k].icon), needsProof: contentBool_(methods[k].needsProof), online: bookMethodOnline_(methods[k]) }; }),
    servants: people
  };

}
