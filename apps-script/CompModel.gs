/**
 * COMPETITIONS: THE MODEL (pure — no Google services; runs in Apps Script
 * and in Node: tests/comp-model.test.mjs). docs/COMPETITIONS.md §1–§4.
 *
 *   compValidateComp_(input, ctx)       a competition from the builder → stored row + problems
 *   compValidateQuestion_(input, ctx)   a question from the editor / an import row → stored row + problems
 *   compParseComp_(row), compParseQuestion_(row)   stored text → typed values
 *   compPublishProblems_(comp, questions, modules) what blocks a publish
 *   compStatus_(comp, def, now, opts)   draft | scheduled | open | closed | results | archived
 *   compDefinition_(comp, questions, media)        the live definition (PRIVATE parts included)
 *   compPublicDef_(def, version, publishedAt)      comp.json (no question text, no answers)
 *   compPublicQuestion_(q, showPoints, choiceOrder) what compStart sends for one question
 *   compStubHtml_(def, siteUrl)         competition/<slug>/index.html
 *   compBuildPublic_(draft, ctx)        everything competitions add to a publish
 *
 * Stored rows are text (the Sheet is '@' formatted): booleans '1' / '',
 * numbers as digits, JSON columns as compact JSON. Dates are Cairo wall
 * clock "YYYY-MM-DD HH:MM" in the Sheet and "YYYY-MM-DDTHH:MM" in JSON.
 */

var COMP_LIMITS = {
  title: 80, shortTitle: 30, description: 600, instructions: 2000, ctaLabel: 24, successText: 300,
  text: 600, infoText: 2000, help: 300, choice: 200, choicesMin: 2, choicesMax: 8, explanation: 1000,
  points: 10000, questions: 300, accepted: 20, fieldLabel: 40, options: 12, option: 40,
  attempts: 20, timeLimit: 600, maxSubmissions: 100000, fieldValue: 80, name: 60
};

var COMP_QTYPES = ['single', 'multi', 'truefalse', 'short', 'long', 'number', 'info'];
var COMP_RESULT_SHOW = ['none', 'score', 'points', 'both'];
var COMP_ANSWERS_SHOW = ['never', 'immediately', 'afterClose', 'atDate'];
var COMP_LAYOUTS = ['paged', 'single'];
var COMP_REVIEWS = ['auto', 'manual', 'fallback'];
var COMP_FIELD_KEYS = ['name', 'phone', 'age', 'church', 'group', 'custom1', 'custom2', 'custom3'];
var COMP_FIELD_MODES = ['required', 'optional', 'hidden'];
var COMP_GRACE_MINUTES = 3;
var COMP_DEFAULT_POINTS = 100;
var COMP_DEFAULT_CTA = 'ابدأ المسابقة';
var COMP_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;
var COMP_RESERVED_SLUGS = ['index', 'assets', 'admin', 'points', 'media', 'preview', 'new', 'comp', 'competition', 'competitions'];
var COMP_ID = /^cmp-[0-9a-f]{8}$/;
var COMP_QID = /^q-[0-9a-f]{8}$/;
var COMP_CHOICE_ID = /^c-[0-9a-z]{6}$/;
var COMP_SUBMISSION_ID = /^s-[0-9a-f]{12}$/;
var COMP_SITE_URL = 'https://stathanasiosyouth.github.io/';
var COMP_SITE_NAME = 'أسرة البابا أثناسيوس – سفاجا';

/* the public site's Content-Security-Policy (index.html): stubs carry exactly the same one (tested) */
var COMP_SITE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; font-src 'self'; connect-src 'self' https://script.google.com https://script.googleusercontent.com https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com; frame-src https://www.google.com; object-src 'none'; base-uri 'none'; form-action 'none'; upgrade-insecure-requests";

/* «مسابقة جديدة»: presets only fill defaults (§3.2); `needs` = the module it requires */
var COMP_PRESETS = {
  survey: { label: 'استبيان بسيط', participation: 'open', scoring: '', resultShow: 'none', answersShow: 'never', wallet: '', needs: '' },
  scored: { label: 'مسابقة عامة بدرجات', participation: 'open', scoring: '1', resultShow: 'score', answersShow: 'afterClose', wallet: '', needs: '' },
  coded: { label: 'مسابقة بأكواد', participation: 'registered', scoring: '1', resultShow: 'both', answersShow: 'never', wallet: '', needs: 'registry' },
  points: { label: 'مسابقة نقاط', participation: 'registered', scoring: '1', resultShow: 'points', answersShow: 'never', wallet: '1', needs: 'wallet' }
};

/* the participant form (open mode): every key, in this order; name + phone on by default */
var COMP_FIELD_DEFAULTS = [
  { key: 'name', label: 'الاسم', type: 'text', mode: 'required' },
  { key: 'phone', label: 'رقم الموبايل', type: 'phone', mode: 'required' },
  { key: 'age', label: 'السن', type: 'number', mode: 'hidden' },
  { key: 'church', label: 'الكنيسة', type: 'text', mode: 'hidden' },
  { key: 'group', label: 'الفصل / المجموعة', type: 'text', mode: 'hidden' },
  { key: 'custom1', label: 'سؤال إضافي ١', type: 'text', mode: 'hidden' },
  { key: 'custom2', label: 'سؤال إضافي ٢', type: 'text', mode: 'hidden' },
  { key: 'custom3', label: 'سؤال إضافي ٣', type: 'text', mode: 'hidden' }
];

var COMP_TYPE_LABELS = { single: 'اختيار واحد', multi: 'اختيارات متعددة', truefalse: 'صح وغلط', short: 'إجابة قصيرة', long: 'إجابة مفتوحة', number: 'رقم', info: 'فقرة' };


/* =========================================================
   SMALL HELPERS
========================================================= */

function compText_(value) {

  return contentText_(value);

}

function compLine_(value) {

  return contentLine_(value);

}

function compFlag_(value) {

  return value === true || value === '1' || value === 1 || contentBool_(value) ? '1' : '';

}

function compArabicDigits_(value) {

  return String(value).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; });

}

/* "YYYY-MM-DD HH:MM" stored form ('' = empty, null = not a date) */
function compStoredDate_(value, endOfDay) {

  var stamp = contentDateTime_(value, endOfDay);

  return stamp === null ? null : stamp ? stamp.replace('T', ' ') : '';

}

/* stored form → "YYYY-MM-DDTHH:MM" ('' when empty or broken) */
function compWall_(value) {

  return contentDateTime_(value, false) || '';

}

function compInt_(value, min, max, fallback) {

  var number = contentNumber_(value);

  if (number === null) return fallback;
  if (isNaN(number) || Math.round(number) !== number || number < min || number > max) return NaN;

  return number;

}

function compJson_(text, fallback) {

  if (text === null || text === undefined || text === '') return fallback;
  if (typeof text !== 'string') return text;

  try {
    return JSON.parse(text);
  }
  catch (ignored) {
    return fallback;
  }

}

/* a simple deterministic generator for ids in pure code (Apps Script passes its own) */
function compCounterIds_(prefix, size) {

  var n = 0;

  return function () {
    n++;
    return prefix + ('000000000000' + n.toString(16)).slice(-size);
  };

}

function compEscapeHtml_(value) {

  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

}


/* =========================================================
   SLUGS
========================================================= */

/* null when fine, else the Arabic problem */
function compSlugProblem_(slug) {

  if (!slug) return 'رابط المسابقة مطلوب (حروف إنجليزي صغيرة وأرقام وشرطة، مثلاً christmas-2026)';
  if (!COMP_SLUG.test(slug) || /--/.test(slug)) return 'رابط المسابقة: من ٢ لـ ٤٠ حرف، حروف إنجليزي صغيرة وأرقام وشرطة (مش في الأول ولا الآخر)';
  if (COMP_RESERVED_SLUGS.indexOf(slug) !== -1) return 'رابط المسابقة ده محجوز، اختار غيره';

  return null;

}


/* =========================================================
   PARTICIPANT FORM SPEC (§3.3)
========================================================= */

/* the builder's list → every key in order, checked; problems pushed */
function compFieldsSpec_(value, problems) {

  var list = Array.isArray(value) ? value : compJson_(value, null);
  var given = Object.create(null);

  (Array.isArray(list) ? list : []).forEach(function (item) {
    if (item && typeof item === 'object' && COMP_FIELD_KEYS.indexOf(item.key) !== -1 && !given[item.key]) given[item.key] = item;
  });

  return COMP_FIELD_DEFAULTS.map(function (base) {

    var item = given[base.key] || {};
    var label = compLine_(item.label) || base.label;
    var mode = COMP_FIELD_MODES.indexOf(item.mode) !== -1 ? item.mode : (given[base.key] ? 'hidden' : base.mode);
    var type = base.type;

    if (label.length > COMP_LIMITS.fieldLabel) problems.push('بيانات المشترك «' + label.slice(0, 20) + '»: الاسم أطول من ' + COMP_LIMITS.fieldLabel + ' حرف');

    var field = { key: base.key, label: label, type: type, mode: mode };

    if (base.type === 'text' && base.key !== 'name' && item.type === 'select') {
      var options = (Array.isArray(item.options) ? item.options : []).map(compLine_).filter(Boolean);
      var unique = options.filter(function (o, i) { return options.indexOf(o) === i; });
      if (unique.length < 2) problems.push('بيانات المشترك «' + label + '»: الاختيارات لازم تكون ٢ على الأقل');
      if (unique.length > COMP_LIMITS.options) problems.push('بيانات المشترك «' + label + '»: أقصى عدد اختيارات ' + COMP_LIMITS.options);
      if (unique.some(function (o) { return o.length > COMP_LIMITS.option; })) problems.push('بيانات المشترك «' + label + '»: الاختيار أطول من ' + COMP_LIMITS.option + ' حرف');
      field.type = 'select';
      field.options = unique.slice(0, COMP_LIMITS.options);
    }

    return field;

  });

}


/**
 * A participant's form (open mode) against the live spec.
 * → { name, phone ('+…' | ''), fields: { key: value }, problem: { field, message } | null }
 */
/**
 * An Egyptian mobile number in any usual form → '+201XXXXXXXXX', else ''.
 * The same rules as the registry's normPhoneEg_ (CompRegistry.gs), copied
 * here so the engine works (and is tested) without that module: Arabic /
 * Persian digits, spaces, dashes, dots, parentheses and bidi marks are
 * forgiven; +20 / 0020 / 20 and the trunk 0 (also after "+20 0…") dropped.
 */
function compNormPhoneEg_(value) {

  var text = contentDigits_(value === null || value === undefined ? '' : String(value))
    .replace(/[‎‏؜‪-‮⁦-⁩﻿]/g, '')
    .replace(/[\s \-‐-―.()\/]/g, '');
  var plus = text.charAt(0) === '+';
  var digits = plus ? text.slice(1) : text;

  if (!/^\d+$/.test(digits)) return '';

  if (plus) {
    if (digits.indexOf('20') !== 0) return '';
    digits = digits.slice(2);
  }
  else if (digits.indexOf('0020') === 0) {
    digits = digits.slice(4);
  }
  else if (digits.indexOf('20') === 0 && digits.length >= 11) {
    digits = digits.slice(2);
  }

  if (digits.charAt(0) === '0') digits = digits.slice(1);

  return /^1[0125]\d{8}$/.test(digits) ? '+20' + digits : '';

}


function compFieldValues_(spec, input) {

  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  var out = { name: '', phone: '', fields: {}, problem: null };

  (spec || []).some(function (field) {

    if (field.mode === 'hidden') return false;

    var raw = input[field.key];
    var text = typeof raw === 'string' || typeof raw === 'number' ? compLine_(raw) : '';
    var fail = function (message) { out.problem = { field: field.key, message: message }; return true; };

    if (!text) {
      return field.mode === 'required' ? fail(field.label + ' مطلوب') : false;
    }

    if (field.type === 'phone') {
      var phone = normalizePhone(text);
      var egyptian = compNormPhoneEg_(text);
      if (!phone && !egyptian) return fail('رقم الموبايل مش صحيح (مثال: 01012345678)');
      // one identity per person (uniquePhone, attempts): +20 010…, 0020 10…, 010…, 10… are the same
      // number; any other number is its digits
      out.phone = egyptian || '+' + phone.e164;
      return false;
    }

    if (field.type === 'number') {
      var age = contentNumber_(text);
      if (age === null || isNaN(age) || Math.round(age) !== age || age < 3 || age > 120) return fail(field.label + ': اكتب رقم صحيح');
      out.fields[field.key] = String(age);
      return false;
    }

    if (field.type === 'select') {
      if ((field.options || []).indexOf(text) === -1) return fail(field.label + ': اختار من الاختيارات');
      out.fields[field.key] = text;
      return false;
    }

    var max = field.key === 'name' ? COMP_LIMITS.name : COMP_LIMITS.fieldValue;
    if (text.length > max) return fail(field.label + ' أطول من ' + max + ' حرف');

    if (field.key === 'name') out.name = text;
    else out.fields[field.key] = text;

    return false;

  });

  return out;

}


/* =========================================================
   COMPETITION (Competitions row)
========================================================= */

/* the builder's columns, in Sheet order (the rest are the server's) */
var COMP_EDITABLE = ['slug', 'title', 'shortTitle', 'description', 'instructions', 'ctaLabel', 'banner', 'icon', 'theme',
  'startAt', 'endAt', 'participation', 'scoring', 'resultShow', 'resultsAt', 'answersShow', 'answersAt', 'showPoints', 'wallet',
  'attempts', 'layout', 'shuffleQ', 'shuffleC', 'timeLimit', 'maxSubmissions', 'uniquePhone', 'fields', 'successText', 'enabled'];

/**
 * input: the builder's fields (anything missing keeps `ctx.existing`'s value).
 * ctx = { existing: stored row | null, modules: { registry, wallet }, slugs: [other slugs],
 *         mediaOk(id) → bool }
 * → { record: { column: text }, problems: [] }
 */
function compValidateComp_(input, ctx) {

  input = input && typeof input === 'object' ? input : {};
  ctx = ctx || {};

  var existing = ctx.existing || {};
  var modules = ctx.modules || {};
  var problems = [];
  var pick = function (key) { return input[key] !== undefined ? input[key] : existing[key]; };
  var line = function (key, max, label, required) {
    var text = compLine_(pick(key));
    if (required && !text) problems.push(label + ' مطلوب');
    if (text.length > max) problems.push(label + ' أطول من ' + max + ' حرف');
    return text;
  };
  var block = function (key, max, label) {
    var text = compText_(pick(key)).replace(/\n{3,}/g, '\n\n');
    if (text.length > max) problems.push(label + ' أطول من ' + max + ' حرف');
    return text;
  };
  var media = function (key, label) {
    var id = compLine_(pick(key));
    if (id && (!/^img-[a-z0-9]{8}$/.test(id) || (ctx.mediaOk && !ctx.mediaOk(id)))) problems.push(label + ': الصورة مش موجودة');
    return id;
  };
  var date = function (key, endOfDay, label) {
    var stored = compStoredDate_(pick(key), endOfDay);
    if (stored === null) {
      problems.push(label + ' مش مفهوم (اكتبه كده: 2026-10-20 18:00)');
      return compLine_(pick(key));
    }
    return stored;
  };
  var oneOf = function (key, allowed, fallback, label) {
    var value = compLine_(pick(key));
    if (!value) return fallback;
    if (allowed.indexOf(value) === -1) {
      problems.push(label + ': الاختيار ده مش معروف');
      return fallback;
    }
    return value;
  };
  var integer = function (key, min, max, fallback, label) {
    var value = compInt_(pick(key), min, max, fallback);
    if (isNaN(value)) {
      problems.push(label + ': رقم صحيح من ' + min + ' لـ ' + max);
      return String(fallback);
    }
    return String(value);
  };

  var slug = compLine_(pick('slug')).toLowerCase();
  var slugProblem = compSlugProblem_(slug);

  if (slugProblem) problems.push(slugProblem);
  else if ((ctx.slugs || []).indexOf(slug) !== -1) problems.push('في مسابقة تانية بنفس الرابط ده');

  // links people already have keep working: the slug is fixed after the first publish
  if (existing.slug && existing.publishedAt && slug !== existing.slug) {
    problems.push('رابط المسابقة مينفعش يتغير بعد أول نشر');
    slug = existing.slug;
  }

  var theme = compLine_(pick('theme')).toLowerCase();

  if (theme && SECTION_THEMES.indexOf(theme) === -1) {
    problems.push('الشكل مش معروف');
    theme = '';
  }

  var record = {
    slug: slug,
    title: line('title', COMP_LIMITS.title, 'اسم المسابقة', true),
    shortTitle: line('shortTitle', COMP_LIMITS.shortTitle, 'الاسم المختصر', false),
    description: block('description', COMP_LIMITS.description, 'الوصف'),
    instructions: block('instructions', COMP_LIMITS.instructions, 'التعليمات'),
    ctaLabel: line('ctaLabel', COMP_LIMITS.ctaLabel, 'نص زرار البداية', false),
    banner: media('banner', 'البانر'),
    icon: media('icon', 'الأيقونة'),
    theme: theme,
    startAt: date('startAt', false, 'ميعاد البداية'),
    endAt: date('endAt', true, 'ميعاد النهاية'),
    participation: oneOf('participation', ['open', 'registered'], 'open', 'طريقة الاشتراك'),
    scoring: compFlag_(pick('scoring')),
    resultShow: oneOf('resultShow', COMP_RESULT_SHOW, 'none', 'النتيجة'),
    resultsAt: date('resultsAt', false, 'ميعاد ظهور النتيجة'),
    answersShow: oneOf('answersShow', COMP_ANSWERS_SHOW, 'never', 'الإجابات الصحيحة'),
    answersAt: date('answersAt', false, 'ميعاد ظهور الإجابات'),
    showPoints: compFlag_(pick('showPoints')),
    wallet: compFlag_(pick('wallet')),
    attempts: integer('attempts', 1, COMP_LIMITS.attempts, 1, 'عدد المحاولات'),
    layout: oneOf('layout', COMP_LAYOUTS, 'paged', 'شكل الأسئلة'),
    shuffleQ: compFlag_(pick('shuffleQ')),
    shuffleC: compFlag_(pick('shuffleC')),
    timeLimit: integer('timeLimit', 0, COMP_LIMITS.timeLimit, 0, 'الوقت بالدقايق'),
    maxSubmissions: integer('maxSubmissions', 0, COMP_LIMITS.maxSubmissions, 0, 'أقصى عدد مشاركات'),
    uniquePhone: compFlag_(pick('uniquePhone')),
    fields: JSON.stringify(compFieldsSpec_(pick('fields'), problems)),
    successText: block('successText', COMP_LIMITS.successText, 'رسالة بعد الإرسال'),
    enabled: compFlag_(pick('enabled'))
  };

  // no score, nothing score-like to show
  if (!record.scoring) {
    record.resultShow = 'none';
    record.wallet = '';
  }

  if (record.participation === 'registered' && !modules.registry) {
    problems.push('«مسابقة بأكواد» محتاجة تفعيل المشاركين بالأكواد الأول');
  }

  if (record.wallet && (!modules.wallet || record.participation !== 'registered' || !record.scoring)) {
    problems.push('النقاط في المحفظة محتاجة: مسابقة بأكواد + درجات + تفعيل المحفظة');
  }

  if (record.uniquePhone && record.participation === 'open') {
    var phoneField = compJson_(record.fields, []).filter(function (f) { return f.key === 'phone'; })[0];
    if (!phoneField || phoneField.mode !== 'required') problems.push('«مشاركة واحدة لكل رقم» محتاجة رقم الموبايل يكون إجباري');
  }

  var start = compWall_(record.startAt);
  var end = compWall_(record.endAt);

  if (start && end && start >= end) problems.push('ميعاد البداية لازم يكون قبل النهاية');
  if (record.answersShow === 'atDate' && !record.answersAt) problems.push('حدد ميعاد ظهور الإجابات');
  if (record.answersShow !== 'atDate') record.answersAt = '';

  return { record: record, problems: problems };

}


/* stored row → typed competition */
function compParseComp_(row) {

  row = row || {};

  var num = function (value, fallback) { var n = contentNumber_(value); return n === null || isNaN(n) ? fallback : n; };

  return {
    id: compLine_(row.id),
    slug: compLine_(row.slug),
    title: compLine_(row.title),
    shortTitle: compLine_(row.shortTitle),
    description: compText_(row.description),
    instructions: compText_(row.instructions),
    ctaLabel: compLine_(row.ctaLabel),
    banner: compLine_(row.banner),
    icon: compLine_(row.icon),
    theme: compLine_(row.theme),
    startAt: compWall_(row.startAt),
    endAt: contentDateTime_(row.endAt, true) || '',
    participation: row.participation === 'registered' ? 'registered' : 'open',
    scoring: compFlag_(row.scoring) === '1',
    resultShow: COMP_RESULT_SHOW.indexOf(row.resultShow) !== -1 ? row.resultShow : 'none',
    resultsAt: compWall_(row.resultsAt),
    answersShow: COMP_ANSWERS_SHOW.indexOf(row.answersShow) !== -1 ? row.answersShow : 'never',
    answersAt: compWall_(row.answersAt),
    showPoints: compFlag_(row.showPoints) === '1',
    wallet: compFlag_(row.wallet) === '1',
    attempts: Math.max(1, Math.min(COMP_LIMITS.attempts, num(row.attempts, 1))),
    layout: row.layout === 'single' ? 'single' : 'paged',
    shuffleQ: compFlag_(row.shuffleQ) === '1',
    shuffleC: compFlag_(row.shuffleC) === '1',
    timeLimit: Math.max(0, Math.min(COMP_LIMITS.timeLimit, num(row.timeLimit, 0))),
    maxSubmissions: Math.max(0, Math.min(COMP_LIMITS.maxSubmissions, num(row.maxSubmissions, 0))),
    uniquePhone: compFlag_(row.uniquePhone) === '1',
    fields: compFieldsSpec_(row.fields, []),
    successText: compText_(row.successText),
    enabled: compFlag_(row.enabled) === '1',
    cardId: compLine_(row.cardId),
    liveVersion: compLine_(row.liveVersion),
    publishedAt: compLine_(row.publishedAt),
    closedAt: compWall_(row.closedAt),
    finalizedAt: compLine_(row.finalizedAt),
    archived: compFlag_(row.archived) === '1',
    createdBy: compLine_(row.createdBy),
    createdAt: compLine_(row.createdAt),
    updatedAt: compLine_(row.updatedAt)
  };

}


/* =========================================================
   QUESTIONS (Questions row)
========================================================= */

/**
 * input: the editor's question { id?, type, text, help, media, choices:
 * [{ id?, text, correct? }], correct, points, required, explanation,
 * explanationMedia, review, enabled }. `correct` may be a choice id (or
 * ids), a choice's position (number, 0-based), 't'/'f', accepted answers
 * (array or text split on |), or a number; choices may instead carry
 * correct: true.
 * ctx = { existing: stored row | null, mediaOk(id), newChoiceId(), defaultPoints }
 * → { record, problems, warnings }
 * A missing key is not a problem here (a draft may be half done): it is a
 * publish problem (compQuestionProblems_), shown as a warning.
 */
function compValidateQuestion_(input, ctx) {

  input = input && typeof input === 'object' ? input : {};
  ctx = ctx || {};

  var existing = ctx.existing ? compParseQuestion_(ctx.existing) : null;
  var problems = [];
  var newChoiceId = ctx.newChoiceId || compCounterIds_('c-', 6);
  var type = compLine_(input.type !== undefined ? input.type : existing && existing.type).toLowerCase();

  if (COMP_QTYPES.indexOf(type) === -1) {
    problems.push('نوع السؤال مش معروف');
    type = 'single';
  }

  var text = compText_(input.text).replace(/\n{3,}/g, '\n\n');
  var maxText = type === 'info' ? COMP_LIMITS.infoText : COMP_LIMITS.text;

  if (!text) problems.push(type === 'info' ? 'نص الفقرة مطلوب' : 'نص السؤال مطلوب');
  if (text.length > maxText) problems.push((type === 'info' ? 'نص الفقرة' : 'نص السؤال') + ' أطول من ' + maxText + ' حرف');

  var help = compLine_(input.help);
  if (help.length > COMP_LIMITS.help) problems.push('التوضيح الصغير أطول من ' + COMP_LIMITS.help + ' حرف');

  var media = function (value, label) {
    var id = compLine_(value);
    if (id && (!/^img-[a-z0-9]{8}$/.test(id) || (ctx.mediaOk && !ctx.mediaOk(id)))) problems.push(label + ': الصورة مش موجودة');
    return id;
  };

  /* ---- choices ---- */

  var choices = [];
  var flagged = [];

  if (type === 'single' || type === 'multi') {

    var list = Array.isArray(input.choices) ? input.choices : [];
    var used = Object.create(null);
    var texts = Object.create(null);

    list.forEach(function (item, i) {
      var choice = item && typeof item === 'object' ? item : { text: item };
      var label = compLine_(choice.text);
      if (!label) return;
      var id = typeof choice.id === 'string' && COMP_CHOICE_ID.test(choice.id) && !used[choice.id] ? choice.id : '';
      while (!id || used[id]) id = newChoiceId();
      used[id] = true;
      if (label.length > COMP_LIMITS.choice) problems.push('الاختيار ' + (i + 1) + ' أطول من ' + COMP_LIMITS.choice + ' حرف');
      var key = compNormalizeText_(label);
      if (texts[key]) problems.push('الاختيار «' + label.slice(0, 30) + '» متكرر');
      texts[key] = true;
      choices.push({ id: id, text: label, given: choice.id, index: i });
      if (choice.correct === true) flagged.push(id);
    });

    if (choices.length < COMP_LIMITS.choicesMin) problems.push('لازم اختيارين على الأقل');
    if (choices.length > COMP_LIMITS.choicesMax) problems.push('أقصى عدد اختيارات ' + COMP_LIMITS.choicesMax);

  }

  /* ---- the key ---- */

  var correct = null;
  var raw = input.correct;
  var choiceRef = function (value) {
    if (typeof value === 'number' && isFinite(value)) {
      var byIndex = choices.filter(function (c) { return c.index === value; })[0];
      return byIndex ? byIndex.id : null;
    }
    var text = compLine_(value);
    var byId = choices.filter(function (c) { return c.id === text || (c.given && c.given === text); })[0];
    return byId ? byId.id : null;
  };

  if (type === 'single') {
    var single = flagged.length ? flagged[0] : (compEmpty_(raw) ? null : choiceRef(Array.isArray(raw) ? raw[0] : raw));
    if (flagged.length > 1) problems.push('السؤال ده «اختيار واحد»: علّم إجابة صحيحة واحدة بس');
    if (!compEmpty_(raw) && !flagged.length && !single) problems.push('الإجابة الصحيحة مش من الاختيارات');
    correct = single || null;
  }
  else if (type === 'multi') {
    var picks = flagged.length ? flagged : (Array.isArray(raw) ? raw : compEmpty_(raw) ? [] : [raw]).map(choiceRef);
    if (picks.some(function (p) { return !p; })) problems.push('إجابة صحيحة مش من الاختيارات');
    var set = choices.map(function (c) { return c.id; }).filter(function (id) { return picks.indexOf(id) !== -1; });
    correct = set.length ? set : null;
  }
  else if (type === 'truefalse') {
    var tf = compNormalizeText_(raw);
    correct = ['t', 'true', 'صح', 'صحيح', '1'].indexOf(tf) !== -1 ? 't' : ['f', 'false', 'غلط', 'خطا', 'خطأ', '0'].indexOf(tf) !== -1 ? 'f' : null;
    if (raw === true) correct = 't';
    if (raw === false) correct = 'f';
    if (!compEmpty_(raw) && correct === null && typeof raw !== 'boolean') problems.push('الإجابة الصحيحة لازم تكون صح أو غلط');
  }
  else if (type === 'short') {
    var accepted = (Array.isArray(raw) ? raw : compEmpty_(raw) ? [] : String(raw).split('|')).map(compLine_).filter(Boolean);
    var seen = Object.create(null);
    accepted = accepted.filter(function (a) { var k = compNormalizeText_(a); if (seen[k]) return false; seen[k] = true; return true; });
    if (accepted.length > COMP_LIMITS.accepted) problems.push('أقصى عدد إجابات مقبولة ' + COMP_LIMITS.accepted);
    if (accepted.some(function (a) { return a.length > COMP_ANSWER_LIMITS.short; })) problems.push('إجابة مقبولة أطول من ' + COMP_ANSWER_LIMITS.short + ' حرف');
    correct = accepted.slice(0, COMP_LIMITS.accepted);
  }
  else if (type === 'number') {
    if (!compEmpty_(raw)) {
      correct = compNumberText_(typeof raw === 'number' ? raw : String(raw));
      if (!correct) {
        problems.push('الإجابة الصحيحة لازم تكون رقم');
        correct = null;
      }
    }
  }

  /* ---- the rest ---- */

  var pointsValue = input.points === undefined || input.points === '' || input.points === null ? (ctx.defaultPoints === undefined ? COMP_DEFAULT_POINTS : ctx.defaultPoints) : input.points;
  var points = compInt_(pointsValue, 0, COMP_LIMITS.points, COMP_DEFAULT_POINTS);

  if (isNaN(points)) {
    problems.push('الدرجة: رقم صحيح من ٠ لـ ' + COMP_LIMITS.points);
    points = 0;
  }

  var review = compLine_(input.review).toLowerCase();
  if (type === 'long') review = 'manual';
  else if (type !== 'short') review = 'auto';
  else if (COMP_REVIEWS.indexOf(review) === -1) review = 'auto';

  var explanation = compText_(input.explanation).replace(/\n{3,}/g, '\n\n');
  if (explanation.length > COMP_LIMITS.explanation) problems.push('شرح الإجابة أطول من ' + COMP_LIMITS.explanation + ' حرف');

  var record = {
    type: type,
    text: text,
    help: help,
    media: media(input.media, 'صورة السؤال'),
    choices: JSON.stringify(choices.map(function (c) { return { id: c.id, text: c.text }; })),
    correct: correct === null ? '' : JSON.stringify(correct),
    points: String(type === 'info' ? 0 : points),
    required: type === 'info' ? '' : (input.required === undefined ? (existing ? (existing.required ? '1' : '') : '1') : compFlag_(input.required)),
    explanation: type === 'info' ? '' : explanation,
    explanationMedia: type === 'info' ? '' : media(input.explanationMedia, 'صورة الشرح'),
    review: review,
    enabled: input.enabled === undefined ? (existing ? (existing.enabled ? '1' : '') : '1') : compFlag_(input.enabled)
  };

  var parsed = compParseQuestion_(record);
  var warnings = compQuestionProblems_(parsed, true);

  return { record: record, problems: problems, warnings: warnings };

}


/* stored row → typed question */
function compParseQuestion_(row) {

  row = row || {};

  var type = COMP_QTYPES.indexOf(row.type) !== -1 ? row.type : 'single';
  var choices = compJson_(row.choices, []);
  var correct = compJson_(row.correct, null);
  var order = contentNumber_(row.order);
  var points = contentNumber_(row.points);

  choices = (Array.isArray(choices) ? choices : []).filter(function (c) {
    return c && typeof c === 'object' && typeof c.id === 'string' && typeof c.text === 'string';
  }).map(function (c) { return { id: c.id, text: c.text }; });

  return {
    id: compLine_(row.id),
    compId: compLine_(row.compId),
    order: order === null || isNaN(order) ? 0 : order,
    type: type,
    text: compText_(row.text),
    help: compLine_(row.help),
    media: compLine_(row.media),
    choices: type === 'single' || type === 'multi' ? choices : [],
    correct: correct,
    points: type === 'info' || points === null || isNaN(points) ? 0 : points,
    required: type !== 'info' && compFlag_(row.required) === '1',
    explanation: compText_(row.explanation),
    explanationMedia: compLine_(row.explanationMedia),
    review: type === 'long' ? 'manual' : type === 'short' && COMP_REVIEWS.indexOf(row.review) !== -1 ? row.review : 'auto',
    enabled: compFlag_(row.enabled) === '1'
  };

}


/* a question's problems for a publish (scoring on: the key must be complete) */
function compQuestionProblems_(q, scoring) {

  var problems = [];
  var ids = (q.choices || []).map(function (c) { return c.id; });

  if (!q.text) problems.push('النص فاضي');

  if ((q.type === 'single' || q.type === 'multi') && ids.length < COMP_LIMITS.choicesMin) problems.push('لازم اختيارين على الأقل');

  if (!scoring) return problems;

  if (q.type === 'single' && (typeof q.correct !== 'string' || ids.indexOf(q.correct) === -1)) problems.push('مفيش إجابة صحيحة');
  if (q.type === 'multi' && (!Array.isArray(q.correct) || !q.correct.length || q.correct.some(function (id) { return ids.indexOf(id) === -1; }))) problems.push('مفيش إجابة صحيحة');
  if (q.type === 'truefalse' && q.correct !== 't' && q.correct !== 'f') problems.push('مفيش إجابة صحيحة (صح ولا غلط؟)');
  if (q.type === 'number' && compNumber_(String(q.correct === null ? '' : q.correct)) === null) problems.push('الإجابة الصحيحة لازم تكون رقم');
  if (q.type === 'short' && q.review !== 'manual' && (!Array.isArray(q.correct) || !q.correct.length)) problems.push('مفيش إجابات مقبولة (أو خليه مراجعة يدوي)');

  return problems;

}


/* questions as the definition orders them (order, then their place in the Sheet) */
function compSortQuestions_(questions) {

  return questions
    .map(function (q, i) { return { q: q, i: i }; })
    .sort(function (a, b) { return a.q.order === b.q.order ? a.i - b.i : a.q.order - b.q.order; })
    .map(function (x) { return x.q; });

}


/* =========================================================
   STATUS (§2) — the server is the authority
========================================================= */

/**
 * comp: compParseComp_ row; def: the LIVE definition (its dates) or null;
 * now: "YYYY-MM-DDTHH:MM" Cairo; opts.live: the public's view (a published
 * competition keeps running until the next publish, whatever the draft's
 * «enabled» / «archived» says); opts.graceMinutes: for submits.
 */
function compStatus_(comp, def, now, opts) {

  opts = opts || {};

  if (!opts.live && comp.archived) return 'archived';
  if (!comp.liveVersion) return 'draft';
  if (!opts.live && !comp.enabled) return 'draft';

  var source = def || comp;
  var grace = opts.graceMinutes || 0;
  var end = source.endAt ? (grace ? wallAdd_(source.endAt, grace) : source.endAt) : '';
  var closedAt = comp.closedAt ? (grace ? wallAdd_(comp.closedAt, grace) : comp.closedAt) : '';

  if (source.startAt && now < source.startAt) return 'scheduled';

  var closed = (end && now > end) || (closedAt && now >= closedAt);

  if (!closed) return 'open';

  return comp.finalizedAt || (source.resultsAt && now >= source.resultsAt) ? 'results' : 'closed';

}


/*
 * Are the submissions over for good (nobody can still send)? The effective
 * end = the earlier of endAt and closedAt, plus the submit grace and the
 * deadline slack (an attempt in its grace must not see the key). Finalized
 * results count as over. No end and no close = never over by itself.
 * def: the live definition (dates "YYYY-MM-DDTHH:MM"); state: { closedAt, finalizedAt }.
 */
function compSubmissionsOver_(def, state, now) {

  if (state && state.finalizedAt) return true;

  var ends = [def.endAt, state && state.closedAt].filter(Boolean).sort();

  return !!ends.length && now > wallAdd_(ends[0], COMP_GRACE_MINUTES + 1);

}

/*
 * May the answers (key, explanations) be shown now? immediately = once it
 * started; afterClose = once the submissions are over (compSubmissionsOver_);
 * atDate = from answersAt; never = never. The ONE rule for compResult_, the
 * portal's «canReview» and which explanation pictures a publish sends out.
 */
function compAnswersOpen_(def, state, now) {

  if (def.answersShow === 'immediately') return !def.startAt || now >= def.startAt;
  if (def.answersShow === 'afterClose') return compSubmissionsOver_(def, state, now);
  if (def.answersShow === 'atDate') return !!def.answersAt && now >= def.answersAt;

  return false;

}


/* =========================================================
   DEFINITION (§4.2) AND PUBLIC FILES (§4.3)
========================================================= */

/**
 * The live definition: the competition and its enabled questions in order,
 * with the private parts (correct, explanation, review). media: Content.gs
 * mediaIndex_ (image objects like content.json's).
 */
function compDefinition_(comp, questions, media) {

  media = media || {};

  var image = function (id) { return id && media[id] ? media[id] : null; };

  return {
    schema: 1,
    id: comp.id,
    slug: comp.slug,
    title: comp.title,
    shortTitle: comp.shortTitle,
    description: comp.description,
    instructions: comp.instructions,
    ctaLabel: comp.ctaLabel || COMP_DEFAULT_CTA,
    banner: image(comp.banner),
    icon: image(comp.icon),
    theme: comp.theme,
    startAt: comp.startAt,
    endAt: comp.endAt,
    resultsAt: comp.resultsAt,
    participation: comp.participation,
    scoring: comp.scoring,
    resultShow: comp.resultShow,
    answersShow: comp.answersShow,
    answersAt: comp.answersAt,
    showPoints: comp.showPoints,
    wallet: comp.wallet,
    attempts: comp.attempts,
    layout: comp.layout,
    shuffleQ: comp.shuffleQ,
    shuffleC: comp.shuffleC,
    timeLimit: comp.timeLimit,
    maxSubmissions: comp.maxSubmissions,
    uniquePhone: comp.uniquePhone,
    fields: comp.participation === 'open' ? comp.fields : [],
    successText: comp.successText,
    questions: compSortQuestions_(questions.filter(function (q) { return q.enabled; })).map(function (q) {
      return {
        id: q.id,
        type: q.type,
        text: q.text,
        help: q.help,
        media: image(q.media),
        choices: q.choices,
        required: q.required,
        points: q.points,
        correct: q.type === 'long' || q.type === 'info' ? null : q.correct,
        explanation: q.explanation,
        explanationMedia: image(q.explanationMedia),
        review: q.review
      };
    })
  };

}


/*
 * First 16 hex of a KEYED hash of the definition JSON: content-addressed
 * (deterministic for one deployment) but never sha256 of the private
 * definition, which is public as `v` and could be brute-forced offline for
 * the key. hash: CompCrypto.gs compKeyedHash_ (HMAC-SHA256 with COMP_SECRET).
 */
function compVersion_(def, hash) {

  return hash ? hash(JSON.stringify(def)).slice(0, 16) : '';

}


/* gradable = everything but info */
function compTotalPoints_(def) {

  if (!def.scoring) return 0;

  return def.questions.reduce(function (sum, q) { return q.type === 'info' ? sum : sum + (Number(q.points) || 0); }, 0);

}


/** comp.json: what anyone may read. NO question text, choices, answers or explanations. */
function compPublicDef_(def, version, publishedAt) {

  return {
    schema: 1,
    id: def.id,
    slug: def.slug,
    v: version,
    title: def.title,
    shortTitle: def.shortTitle,
    description: def.description,
    instructions: def.instructions,
    ctaLabel: def.ctaLabel,
    banner: def.banner,
    icon: def.icon,
    theme: def.theme,
    startAt: def.startAt,
    endAt: def.endAt,
    resultsAt: def.resultsAt,
    participation: def.participation,
    scoring: def.scoring,
    resultShow: def.resultShow,
    answersShow: def.answersShow,
    answersAt: def.answersAt,
    showPoints: def.showPoints,
    wallet: def.wallet,
    attempts: def.attempts,
    layout: def.layout,
    timeLimit: def.timeLimit,
    fields: def.fields,
    successText: def.successText,
    questionCount: def.questions.filter(function (q) { return q.type !== 'info'; }).length,
    totalPoints: compTotalPoints_(def),
    publishedAt: publishedAt || ''
  };

}


/* the withdrawn variant (links keep working; the page says it's gone) */
function compWithdrawnDef_(slug) {

  return { schema: 1, slug: slug, withdrawn: true };

}


/**
 * One question as compStart sends it: never correct / explanation / review.
 * choiceOrder: the served order of its choice ids (shuffle), else as stored.
 */
function compPublicQuestion_(q, showPoints, choiceOrder) {

  var choices = q.choices.map(function (c) { return { id: c.id, text: c.text }; });

  if (choiceOrder && choiceOrder.length === choices.length) {
    choices = choiceOrder.map(function (id) { return choices.filter(function (c) { return c.id === id; })[0]; }).filter(Boolean);
  }

  var out = { id: q.id, type: q.type, text: q.text, help: q.help, media: q.media, choices: choices, required: q.required };

  if (showPoints && q.type !== 'info') out.points = q.points;

  return out;

}


/* =========================================================
   THE STUB PAGE: competition/<slug>/index.html
   Made from the engine shell, competition/index.html (the public engine's
   file: same CSP as the site, every asset URL starting "../", one empty
   mount point that assets/js/comp/main.js fills). Publish reads the
   committed shell (CompPublish.gs compShellText_, cached); when it can't,
   COMP_SHELL_FALLBACK (a copy of the shell's shape) is used. The stub is
   the shell with:
     - every href="../ and src="../ one level deeper ("../../"),
     - <html … data-slug="<slug>" data-v="<version>">,
     - the shell's own title / description / canonical / og:* / twitter:*
       removed and the competition's put in their place (absolute URLs).
   Nothing else changes, so later shell edits reach every stub.
========================================================= */

var COMP_SHELL_FALLBACK = [
  '<!doctype html>',
  '<html lang="ar" dir="rtl">',
  '',
  '<head>',
  '',
  '  <meta charset="utf-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '  <meta http-equiv="Content-Security-Policy" content="' + COMP_SITE_CSP + '">',
  '  <meta name="referrer" content="strict-origin-when-cross-origin">',
  '  <title>المسابقات</title>',
  '  <meta name="theme-color" content="#020914">',
  '  <meta name="color-scheme" content="dark">',
  '  <meta name="format-detection" content="telephone=no">',
  '  <link rel="icon" type="image/png" sizes="32x32" href="../assets/img/favicon-32.png">',
  '  <link rel="icon" type="image/png" sizes="192x192" href="../assets/img/favicon-192.png">',
  '  <link rel="apple-touch-icon" href="../assets/img/apple-touch-icon.png">',
  '  <link rel="preload" href="../assets/fonts/cairo-arabic.woff2" as="font" type="font/woff2" crossorigin>',
  '  <link rel="stylesheet" href="../assets/css/comp.css">',
  '  <script type="module" src="../assets/js/comp/main.js"></script>',
  '',
  '</head>',
  '',
  '<body>',
  '  <a class="skip-link" href="#comp-main">انتقل للمسابقة</a>',
  '  <header class="cbar"><a class="cbar__brand" href="../"><img src="../assets/img/logo-128.webp" width="34" height="34" alt=""><span class="cbar__name">أسرة البابا أثناسيوس</span><span class="visually-hidden">— الصفحة الرئيسية</span></a><p class="cbar__timer" id="comp-timer" hidden></p></header>',
  '  <main id="comp-main" class="comp" data-state="loading" tabindex="-1">',
  '    <noscript><p class="card noscript">المسابقة محتاجة جافاسكريبت يكون شغال في المتصفح. شغّله وافتح الصفحة تاني.</p></noscript>',
  '  </main>',
  '  <p class="netbar" id="comp-net" role="status" hidden></p>',
  '  <p class="visually-hidden" id="comp-live" aria-live="polite"></p>',
  '</body>',
  '',
  '</html>',
  ''
].join('\n');


/* a shell we can build from: an Arabic page with a CSP, a head and the engine module */
function compShellOk_(shell) {

  return typeof shell === 'string' && shell.length > 0 && shell.length <= 100000 &&
    /<html\b[^>]*\blang="ar"[^>]*>/.test(shell) && shell.indexOf('</head>') !== -1 &&
    shell.indexOf('Content-Security-Policy') !== -1 && shell.indexOf('assets/js/comp/main.js') !== -1;

}

/* the competition's own head tags (absolute URLs) */
function compStubHead_(def, siteUrl) {

  var site = safeHttpsUrl(siteUrl || '') || COMP_SITE_URL;
  var base = site.replace(/\/?$/, '/');
  var url = base + 'competition/' + def.slug + '/';
  var title = def.title + ' | ' + COMP_SITE_NAME;
  var description = compLine_(def.description || def.shortTitle || def.title).slice(0, 200);
  var banner = def.banner && def.banner.src ? def.banner : null;
  var image = banner ? base + banner.src : base + 'assets/img/og-image.png';
  var alt = banner ? (banner.alt || def.title) : 'شعار أسرة البابا أثناسيوس الرسولي مع اسم الخدمة';
  var e = compEscapeHtml_;

  return [
    '  <title>' + e(title) + '</title>',
    '  <meta name="description" content="' + e(description) + '">',
    '  <link rel="canonical" href="' + e(url) + '">',
    '  <meta property="og:type" content="website">',
    '  <meta property="og:locale" content="ar_EG">',
    '  <meta property="og:site_name" content="' + e(COMP_SITE_NAME) + '">',
    '  <meta property="og:title" content="' + e(def.title) + '">',
    '  <meta property="og:description" content="' + e(description) + '">',
    '  <meta property="og:url" content="' + e(url) + '">',
    '  <meta property="og:image" content="' + e(image) + '">',
    '  <meta property="og:image:width" content="' + e(banner ? banner.w : 1200) + '">',
    '  <meta property="og:image:height" content="' + e(banner ? banner.h : 630) + '">',
    '  <meta property="og:image:alt" content="' + e(alt) + '">',
    '  <meta name="twitter:card" content="summary_large_image">',
    '  <meta name="twitter:title" content="' + e(def.title) + '">',
    '  <meta name="twitter:description" content="' + e(description) + '">',
    '  <meta name="twitter:image" content="' + e(image) + '">'
  ].join('\n');

}

/**
 * The stub for one competition. version: its definition's version
 * (data-v); shell: the committed competition/index.html text, or '' for
 * the built-in copy.
 */
function compStubHtml_(def, siteUrl, version, shell) {

  var source = compShellOk_(shell) ? shell : COMP_SHELL_FALLBACK;
  var e = compEscapeHtml_;
  var html = source.replace(/\r\n?/g, '\n')
    // comments first: a tag named inside a comment must never anchor the removals below
    .replace(/[ \t]*<!--[\s\S]*?-->[ \t]*\n?/g, '')
    .replace(/(\s(?:href|src))="\.\.\//g, '$1="../../')
    .replace(/[ \t]*<title>[\s\S]*?<\/title>[ \t]*\n?/i, '')
    .replace(/[ \t]*<meta\s+name="description"[^>]*>[ \t]*\n?/gi, '')
    .replace(/[ \t]*<link\s+rel="canonical"[^>]*>[ \t]*\n?/gi, '')
    .replace(/[ \t]*<meta\s+property="og:[^"]*"[^>]*>[ \t]*\n?/gi, '')
    .replace(/[ \t]*<meta\s+name="twitter:[^"]*"[^>]*>[ \t]*\n?/gi, '');

  html = html.replace(/<html\b([^>]*)>/, function (all, attrs) {
    return '<html' + attrs.replace(/\s+data-(slug|v)="[^"]*"/g, '') + ' data-slug="' + e(def.slug) + '" data-v="' + e(version || '') + '">';
  });

  var at = html.indexOf('</head>');

  return html.slice(0, at) + compStubHead_(def, siteUrl) + '\n\n' + html.slice(at);

}


/* =========================================================
   EVERYTHING COMPETITIONS ADD TO A PUBLISH
   Called by buildPublicContent (Content.gs) with draft.competitions:
     { comps: [stored rows], questions: [stored rows], modules: { registry, wallet }, error? }
   ctx = { media: mediaIndex_, error(where, msg), warn(where, msg), hash, now }
   → { index: content.json `competitions`, live: { id: { def, version, slug, comp, questionCount } },
       withdrawn: [{ id, slug }], byId: { id: card data }, slugs: { slug: 'live' | 'draft' },
       media: [ids] }
========================================================= */

function compBuildPublic_(draft, ctx) {

  var out = { index: [], live: {}, withdrawn: [], byId: {}, slugs: {}, media: [] };

  if (!draft) return out;

  if (draft.error) {
    ctx.error('المسابقات', draft.error);
    return out;
  }

  var media = ctx.media || {};
  var modules = draft.modules || {};
  var questionsByComp = Object.create(null);
  var seenSlugs = Object.create(null);
  var useMedia = function (id) { if (id && out.media.indexOf(id) === -1) out.media.push(id); };

  (draft.questions || []).forEach(function (row) {
    var q = compParseQuestion_(row);
    if (!q.id || !q.compId) return;
    (questionsByComp[q.compId] = questionsByComp[q.compId] || []).push(q);
  });

  (draft.comps || []).forEach(function (row) {

    var comp = compParseComp_(row);

    if (!comp.id) return;

    if (comp.slug) out.slugs[comp.slug] = 'draft';

    // not in this publish: a published one is withdrawn (its stub stays)
    if (!comp.enabled || comp.archived) {
      if (comp.liveVersion && comp.slug) out.withdrawn.push({ id: comp.id, slug: comp.slug });
      return;
    }

    var where = 'المسابقات: ' + (comp.title || comp.slug || comp.id);
    var questions = questionsByComp[comp.id] || [];
    var problems = compPublishProblems_(comp, questions, modules, media);

    if (comp.slug && seenSlugs[comp.slug]) problems.push('في مسابقتين بنفس الرابط: ' + comp.slug);
    seenSlugs[comp.slug] = true;

    if (problems.length) {
      problems.forEach(function (p) { ctx.error(where, p); });
      return;
    }

    var def = compDefinition_(comp, questions, media);
    var version = compVersion_(def, ctx.hash);
    // explanation pictures go to the (public) site only once the answers may be shown
    var answersOpen = !!ctx.now && compAnswersOpen_(def, { closedAt: comp.closedAt, finalizedAt: comp.finalizedAt }, ctx.now);

    compPublishWarnings_(comp, questions, ctx.now).forEach(function (w) { ctx.warn(where, w); });

    useMedia(comp.banner);
    useMedia(comp.icon);
    questions.forEach(function (q) {
      if (!q.enabled) return;
      useMedia(q.media);
      if (answersOpen) useMedia(q.explanationMedia);
    });

    out.slugs[comp.slug] = 'live';
    out.live[comp.id] = { def: def, version: version, slug: comp.slug, comp: comp, questionCount: def.questions.filter(function (q) { return q.type !== 'info'; }).length };
    out.index.push({ id: comp.id, slug: comp.slug, title: comp.title, shortTitle: comp.shortTitle, startAt: comp.startAt, endAt: comp.endAt, v: version });
    out.byId[comp.id] = {
      slug: comp.slug,
      title: comp.title,
      shortTitle: comp.shortTitle,
      subtitle: compLine_(comp.description).slice(0, 140),
      bannerId: comp.banner && media[comp.banner] ? comp.banner : '',
      ctaLabel: comp.ctaLabel || COMP_DEFAULT_CTA,
      startAt: comp.startAt,
      endAt: comp.endAt
    };

  });

  // the store's active items (CompStoreItems.gs): their pictures go to the site for «نقاطي»
  if (modules.shop) {
    (draft.items || []).forEach(function (item) {
      if (item && item.active && item.image && media[item.image]) useMedia(item.image);
    });
  }

  return out;

}


var COMP_WARN_QUESTION_MEDIA = 'صور الأسئلة بتبقى على الموقع من وقت النشر — متحطش صورة فيها الإجابة';
var COMP_WARN_EXPLANATION_MEDIA = 'صور شرح الإجابات مش هتتنشر غير لما الإجابات تظهر: انشر تاني بعدها علشان تظهر';
var COMP_WARN_RETRY = 'أي حد يقدر يحاول كذا مرة ويعرف الإجابات من الدرجة';

/*
 * What the builder should know before publishing (never blocks):
 *  - question pictures are public from the publish on;
 *  - explanation pictures wait for the answers (a publish after they open sends them);
 *  - an open competition that shows the score right away, without «one
 *    submission per number» and a single attempt, teaches the key by retries.
 * now: "YYYY-MM-DDTHH:MM" (the explanation note only while the answers are still closed).
 */
function compPublishWarnings_(comp, questions, now) {

  var warnings = [];
  var live = questions.filter(function (q) { return q.enabled; });

  if (live.some(function (q) { return q.media; })) warnings.push(COMP_WARN_QUESTION_MEDIA);

  if (comp.answersShow !== 'never' && live.some(function (q) { return q.explanationMedia; }) &&
      !(now && compAnswersOpen_(comp, { closedAt: comp.closedAt, finalizedAt: comp.finalizedAt }, now))) {
    warnings.push(COMP_WARN_EXPLANATION_MEDIA);
  }

  if (comp.participation === 'open' && comp.scoring && comp.resultShow !== 'none' && !comp.resultsAt &&
      !(comp.uniquePhone && comp.attempts === 1)) {
    warnings.push(COMP_WARN_RETRY);
  }

  return warnings;

}


/* what blocks publishing one competition (scoring decides whether keys are required) */
function compPublishProblems_(comp, questions, modules, media) {

  var problems = [];
  var live = questions.filter(function (q) { return q.enabled; });

  if (!comp.title) problems.push('اسم المسابقة مطلوب');

  var slugProblem = compSlugProblem_(comp.slug);
  if (slugProblem) problems.push(slugProblem);

  if (comp.participation === 'registered' && !modules.registry) problems.push('«مسابقة بأكواد» محتاجة تفعيل المشاركين بالأكواد');
  if (comp.wallet && (!modules.wallet || comp.participation !== 'registered' || !comp.scoring)) problems.push('النقاط في المحفظة محتاجة مسابقة بأكواد + درجات + تفعيل المحفظة');
  if (comp.startAt && comp.endAt && comp.startAt >= comp.endAt) problems.push('ميعاد البداية لازم يكون قبل النهاية');
  if (comp.answersShow === 'atDate' && !comp.answersAt) problems.push('حدد ميعاد ظهور الإجابات');

  [['banner', 'البانر'], ['icon', 'الأيقونة']].forEach(function (pair) {
    if (comp[pair[0]] && !media[comp[pair[0]]]) problems.push(pair[1] + ': الصورة "' + comp[pair[0]] + '" مش موجودة في المكتبة');
  });

  if (!live.some(function (q) { return q.type !== 'info'; })) problems.push('مفيش أسئلة ظاهرة');
  if (live.length > COMP_LIMITS.questions) problems.push('أقصى عدد أسئلة ' + COMP_LIMITS.questions);

  compSortQuestions_(live).forEach(function (q, i) {
    var label = 'س' + compArabicDigits_(i + 1) + ': ';
    compQuestionProblems_(q, comp.scoring).forEach(function (p) { problems.push(label + p); });
    if (q.media && !media[q.media]) problems.push(label + 'صورة السؤال مش موجودة في المكتبة');
    if (q.explanationMedia && !media[q.explanationMedia]) problems.push(label + 'صورة الشرح مش موجودة في المكتبة');
  });

  return problems;

}
