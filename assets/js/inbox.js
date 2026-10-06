/**
 * INBOX: read state for the notification bell, per browser.
 *
 * Stored in localStorage (tiny; IndexedDB isn't needed):
 *   firstSeen   items older than this never count as new. On a first visit
 *               it starts 3 days back, so a newcomer sees recent news as new
 *               without a pile of old unread items.
 *   lastOpened  opening the bell clears the badge (items up to then are "seen")
 *   read        ids the visitor tapped (their "new" dot goes away)
 *
 * All stamps are Cairo wall time "YYYY-MM-DDTHH:MM".
 */

import { addMinutes } from './schedule.js';

const KEY = 'athanasios.inbox.v1';

const FIRST_VISIT_WINDOW = 3 * 24 * 60;


export function emptyInbox(nowStamp) {

  return { firstSeen: addMinutes(nowStamp, -FIRST_VISIT_WINDOW), lastOpened: '', read: {} };

}


export function loadInbox(nowStamp, storage = globalThis.localStorage) {

  try {
    const raw = JSON.parse(storage.getItem(KEY) || 'null');
    if (raw && typeof raw.firstSeen === 'string' && raw.read && typeof raw.read === 'object') {
      return { firstSeen: raw.firstSeen, lastOpened: typeof raw.lastOpened === 'string' ? raw.lastOpened : '', read: raw.read };
    }
  }
  catch {
    // blocked or corrupted storage: start fresh (in memory)
  }

  const inbox = emptyInbox(nowStamp);
  saveInbox(inbox, storage);

  return inbox;

}


export function saveInbox(inbox, storage = globalThis.localStorage) {

  try {
    storage.setItem(KEY, JSON.stringify(inbox));
  }
  catch {
    // private mode: read state just won't persist
  }

}


/* Is this item new to this visitor (shows a dot)? */
export function isNew(inbox, item) {

  return item.publishAt > inbox.firstSeen && !inbox.read[item.id];

}


/* Badge count: new items published since the bell was last opened. */
export function unreadCount(inbox, items) {

  const since = inbox.lastOpened > inbox.firstSeen ? inbox.lastOpened : inbox.firstSeen;

  return items.filter(item => item.publishAt > since && !inbox.read[item.id]).length;

}


export function markOpened(inbox, nowStamp) {

  return { ...inbox, lastOpened: nowStamp };

}


export function markRead(inbox, id) {

  return { ...inbox, read: { ...inbox.read, [id]: true } };

}


/* Forget ids that are no longer published (keeps storage small). */
export function pruneInbox(inbox, items) {

  const live = new Set(items.map(item => item.id));
  const read = {};

  for (const id of Object.keys(inbox.read)) {
    if (live.has(id)) read[id] = true;
  }

  return { ...inbox, read };

}
