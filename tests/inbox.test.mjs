// Read state for the bell (assets/js/inbox.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyInbox, loadInbox, saveInbox, isNew, unreadCount, markOpened, markRead, pruneInbox } from '../assets/js/inbox.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    data
  };
}

const NOW = '2026-10-08T20:00';
const item = (id, publishAt) => ({ id, publishAt });

const items = [
  item('today', '2026-10-08T19:00'),
  item('two-days', '2026-10-06T10:00'),
  item('week-ago', '2026-10-01T10:00')
];


test('first visit: only the last 3 days count as new', () => {
  const inbox = emptyInbox(NOW);
  assert.equal(inbox.firstSeen, '2026-10-05T20:00');
  assert.equal(unreadCount(inbox, items), 2);
  assert.equal(isNew(inbox, items[2]), false);
});

test('opening the bell clears the badge but keeps per-item dots', () => {
  const opened = markOpened(emptyInbox(NOW), NOW);
  assert.equal(unreadCount(opened, items), 0);
  assert.equal(isNew(opened, items[0]), true, 'dot stays until tapped');
  const read = markRead(opened, 'today');
  assert.equal(isNew(read, items[0]), false);
});

test('something published after opening counts again', () => {
  const opened = markOpened(emptyInbox(NOW), NOW);
  const later = [...items, item('later', '2026-10-08T21:00')];
  assert.equal(unreadCount(opened, later), 1);
});

test('read ids are pruned when items disappear', () => {
  let inbox = markRead(markRead(emptyInbox(NOW), 'today'), 'gone');
  inbox = pruneInbox(inbox, items);
  assert.deepEqual(Object.keys(inbox.read), ['today']);
});

test('storage: round trip, corrupted data, blocked storage', () => {
  const storage = memoryStorage();
  const inbox = markRead(loadInbox(NOW, storage), 'today');
  saveInbox(inbox, storage);
  assert.deepEqual(loadInbox(NOW, storage).read, { today: true });

  const corrupted = memoryStorage({ 'athanasios.inbox.v1': '{not json' });
  assert.deepEqual(loadInbox(NOW, corrupted).read, {});

  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(loadInbox(NOW, blocked).firstSeen, '2026-10-05T20:00', 'works without storage');
});
