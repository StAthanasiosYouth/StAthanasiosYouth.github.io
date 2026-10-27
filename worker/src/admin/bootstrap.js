/*
 * Phase 3 P3-7 (docs/ADMIN-PLATFORM-PLAN.md): what the panel needs to open,
 * besides its content state, in the SAME answer as the session (start /
 * resume with { boot: true }) — no second round trip to the Worker:
 *
 *   me        who, the name, Primary or not, the effective permissions (me.js)
 *   activity  the home card's newest rows + where the in-panel toasts start
 *   modules   which Worker modules are on («الحجوزات»)
 *
 * The content state (drafts, settings) is still Apps Script's until Phase 4;
 * the page asks it at the same time (admin/boot.js platformPost).
 */

import { queryActivity } from '../lib/activity.js';
import { retry } from '../lib/db.js';
import { bookingOn } from '../book/public.js';
import { adminMe } from './me.js';
import { draftsWriter } from '../content/store.js';

export async function bootPayload(ctx, now = Date.now()) {
  const [me, activity, book, writer] = await Promise.all([
    adminMe(ctx),
    retry(() => queryActivity(ctx.env.DB, { limit: 6, view: 'log' })).catch(() => null),
    bookingOn(ctx.env).catch(() => null),
    draftsWriter(ctx.env.DB).catch(() => 'sheets')
  ]);
  return {
    me,
    activity: activity ? { recent: activity.items, latest: activity.items.length ? activity.items[0].at : 0, now } : null,
    modules: { book: book === null ? null : !!book },
    // Phase 4: who writes the content drafts (settings.CONTENT_DRAFTS) — the page sends its content calls there
    content: writer
  };
}
