/*
 * CONTENT DRAFT KINDS (Phase 4, docs/CONTENT-MIGRATION-PLAN.md §3).
 *
 * Every draft entity the admin edits today, with the Sheet tab it comes from
 * and that tab's columns in the Sheet's own order. The columns are the
 * contract with Apps Script: apps-script/Store.gs TABLES (the content Sheet)
 * and apps-script/CompStore.gs COMP_TABLES (the pages / events tabs of the
 * private spreadsheet). test/content-kinds.test.mjs reads both files and
 * fails when they drift apart.
 *
 * key: the column that names a row (unique per kind). sheet: 'content' (the
 * site's Sheet) | 'comp' (the competitions spreadsheet).
 */

export const KINDS = Object.freeze({
  settings: { tab: 'Settings', sheet: 'content', key: 'key', columns: ['key', 'value', 'help'] },
  sections: {
    tab: 'Sections', sheet: 'content', key: 'key',
    columns: ['key', 'title', 'order', 'enabled', 'kind', 'subtitle', 'icon', 'theme', 'banner', 'visibleFrom', 'visibleUntil', 'surface', 'surfaceMobile']
  },
  links: {
    tab: 'Links', sheet: 'content', key: 'id',
    columns: ['id', 'enabled', 'order', 'section', 'style', 'featured', 'title', 'subtitle', 'cta', 'url', 'icon', 'badge', 'startAt', 'endAt', 'updatedAt', 'experience', 'gallery']
  },
  contacts: {
    tab: 'Contacts', sheet: 'content', key: 'id',
    columns: ['id', 'enabled', 'order', 'kind', 'name', 'role', 'description', 'phone', 'method', 'message', 'updatedAt', 'image', 'intro', 'reply']
  },
  sessions: {
    tab: 'Sessions', sheet: 'content', key: 'date',
    columns: ['date', 'enabled', 'time', 'topic', 'speaker', 'description', 'image', 'status', 'note', 'visibleFrom', 'updatedAt', 'durationMinutes', 'program']
  },
  news: {
    tab: 'News', sheet: 'content', key: 'id',
    columns: ['id', 'enabled', 'featured', 'pinned', 'tone', 'title', 'summary', 'body', 'image', 'linkUrl', 'linkLabel', 'badge', 'publishAt', 'expireAt', 'updatedAt', 'archived', 'display', 'displayMobile']
  },
  games: {
    tab: 'Games', sheet: 'content', key: 'id',
    columns: ['id', 'enabled', 'title', 'description', 'image', 'url', 'buttonLabel', 'visibleFrom', 'startAt', 'endAt', 'afterEnd', 'updatedAt', 'archived', 'display', 'displayMobile']
  },
  notifications: {
    tab: 'Notifications', sheet: 'content', key: 'id',
    columns: ['id', 'enabled', 'type', 'title', 'message', 'target', 'image', 'publishAt', 'expireAt', 'updatedAt', 'archived']
  },
  media: {
    tab: 'Media', sheet: 'content', key: 'id', private: ['driveId', 'thumbDriveId'],
    columns: ['id', 'path', 'thumb', 'width', 'height', 'alt', 'mime', 'driveId', 'thumbDriveId', 'uploadedAt', 'publishedAt', 'name', 'tiny', 'color', 'hash', 'bytes', 'deletedAt']
  },
  activities: {
    tab: 'Activities', sheet: 'content', key: 'id',
    columns: ['id', 'enabled', 'type', 'title', 'subtitle', 'description', 'image', 'ctaLabel', 'url', 'location', 'startAt', 'endAt', 'visibleFrom', 'visibleUntil', 'order', 'archived', 'updatedAt', 'display', 'displayMobile', 'competition', 'page', 'event']
  },
  types: {
    tab: 'Types', sheet: 'content', key: 'key',
    columns: ['key', 'enabled', 'label', 'section', 'icon', 'theme', 'banner', 'ctaDefault', 'notifyTemplate', 'order', 'updatedAt']
  },
  pages: {
    tab: 'Pages', sheet: 'comp', key: 'id',
    columns: ['id', 'slug', 'enabled', 'archived', 'order', 'title', 'tagline', 'description', 'hero', 'cover', 'cardType', 'theme',
      'partner', 'teamTitle', 'teamText', 'teamMessage', 'team', 'home', 'cardId', 'liveV', 'publishedAt', 'createdBy', 'createdAt', 'updatedAt']
  },
  page_media: {
    tab: 'PageMedia', sheet: 'comp', key: 'id',
    columns: ['id', 'pageId', 'order', 'enabled', 'title', 'text', 'duration', 'cover', 'source', 'clip', 'fullUrl', 'ctaLabel', 'updatedAt', 'audioMode', 'audio']
  },
  events: {
    tab: 'Events', sheet: 'comp', key: 'id',
    columns: ['id', 'slug', 'kind', 'enabled', 'archived', 'title', 'shortTitle', 'summary', 'body', 'cover', 'gallery', 'startAt', 'endAt',
      'locationName', 'locationUrl', 'theme', 'partner', 'terms', 'booking', 'servants', 'home', 'cardId', 'liveV', 'publishedAt',
      'createdBy', 'createdAt', 'updatedAt']
  },
  servants: {
    // phones and payment numbers: admin-only, never in a published file (they never were)
    tab: 'Servants', sheet: 'comp', key: 'id', private: ['phone', 'instapayNumber', 'walletNumber'],
    columns: ['id', 'name', 'phone', 'role', 'image', 'active', 'publicWa', 'note', 'createdAt', 'updatedAt',
      'instapayNumber', 'walletNumber', 'payName', 'instapayApproved', 'instapayApprovedAt', 'instapayApprovedBy', 'walletApproved', 'walletApprovedAt', 'walletApprovedBy']
  },
  pay_methods: { tab: 'PayMethods', sheet: 'comp', key: 'key', columns: ['key', 'label', 'icon', 'needsProof', 'order', 'active', 'online'] }
});

export const KIND_NAMES = Object.freeze(Object.keys(KINDS));

/*
 * The competitions' drafts (docs/PHASE5-PLAN.md §3o): answers included, so never in the panel's
 * drafts read, the content import or the export; only the admin's competition calls read them.
 */
export const COMP_KINDS = Object.freeze({
  competitions: {
    tab: 'Competitions', sheet: 'comp', key: 'id',
    columns: ['id', 'slug', 'title', 'shortTitle', 'description', 'instructions', 'ctaLabel', 'banner', 'icon', 'theme',
      'startAt', 'endAt', 'participation', 'scoring', 'resultShow', 'resultsAt', 'answersShow', 'answersAt', 'showPoints', 'wallet',
      'attempts', 'layout', 'shuffleQ', 'shuffleC', 'timeLimit', 'maxSubmissions', 'uniquePhone', 'fields', 'successText', 'enabled',
      'cardId', 'liveVersion', 'publishedAt', 'closedAt', 'finalizedAt', 'archived', 'createdBy', 'createdAt', 'updatedAt', 'seasonId', 'allowGuests']
  },
  questions: {
    tab: 'Questions', sheet: 'comp', key: 'id',
    columns: ['id', 'compId', 'order', 'type', 'text', 'help', 'media', 'choices', 'correct', 'points', 'required', 'explanation',
      'explanationMedia', 'review', 'enabled', 'updatedAt']
  }
});

export const COMP_KIND_NAMES = Object.freeze(Object.keys(COMP_KINDS));

/* every kind a call of the admin runs over */
export const RUN_KINDS = Object.freeze({ ...KINDS, ...COMP_KINDS });
export const RUN_KIND_NAMES = Object.freeze(Object.keys(RUN_KINDS));

/* a row key: printable, short (ids, keys, dates as the Sheets hold them) */
const KEY_RE = /^[^\u0000-\u001f\u007f]{1,120}$/;

export function validKey(value) {
  return typeof value === 'string' && KEY_RE.test(value) && value.trim() === value;
}

/* a cell as the Sheets readers return it: text, number or boolean */
export function validCell(value) {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/*
 * The row in the kind's column order, every column present, nothing else.
 * Throws on a missing or unknown column or a value of another type: the copy
 * must be exact, so nothing is guessed or filled in.
 */
export function canonicalRow(kind, row) {
  const spec = RUN_KINDS[kind];
  if (!spec) throw new Error('unknown kind ' + kind);
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(kind + ': row is not an object');
  const out = {};
  for (const column of spec.columns) {
    if (!Object.prototype.hasOwnProperty.call(row, column)) throw new Error(kind + ': missing column ' + column);
    const value = row[column];
    if (!validCell(value)) throw new Error(kind + ': bad value in ' + column);
    out[column] = value;
  }
  for (const column of Object.keys(row)) {
    if (!spec.columns.includes(column)) throw new Error(kind + ': unknown column ' + column);
  }
  return out;
}

export function rowKey(kind, row) {
  return String(row[RUN_KINDS[kind].key]);
}
