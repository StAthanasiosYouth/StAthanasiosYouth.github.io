// A Sheet shaped like the live one before the schema-3 upgrade (old
// columns, no built-in section rows, no Activities/Types tabs), with real
// content in it. Used by tests/migrate.test.mjs and tests/admin.e2e.mjs.

import { createWorld } from './gas.mjs';

const ADMIN = 'menazakmena@gmail.com';

/* the columns each tab had before schema 3 */
export const OLD_COLUMNS = {
  Sections: ['key', 'title', 'order', 'enabled'],
  Links: ['id', 'enabled', 'order', 'section', 'style', 'featured', 'title', 'subtitle', 'cta', 'url', 'icon', 'badge', 'startAt', 'endAt', 'updatedAt'],
  Sessions: ['date', 'enabled', 'time', 'topic', 'speaker', 'description', 'image', 'status', 'note', 'visibleFrom', 'updatedAt'],
  News: ['id', 'enabled', 'featured', 'pinned', 'tone', 'title', 'summary', 'body', 'image', 'linkUrl', 'linkLabel', 'badge', 'publishAt', 'expireAt', 'updatedAt'],
  Games: ['id', 'enabled', 'title', 'description', 'image', 'url', 'buttonLabel', 'visibleFrom', 'startAt', 'endAt', 'afterEnd', 'updatedAt'],
  Notifications: ['id', 'enabled', 'type', 'title', 'message', 'target', 'image', 'publishAt', 'expireAt', 'updatedAt'],
  Media: ['id', 'path', 'thumb', 'width', 'height', 'alt', 'mime', 'driveId', 'thumbDriveId', 'uploadedAt', 'publishedAt'],
  Contacts: ['id', 'enabled', 'order', 'kind', 'name', 'role', 'description', 'phone', 'method', 'message', 'updatedAt']
};

/* the columns schema 4 added (the live Sheet is at schema 3 before it) */
export const SCHEMA_4_COLUMNS = {
  Links: ['gallery'],
  Contacts: ['image', 'intro', 'reply']
};

/** A Sheet like the live one: set up by the previous version, with content. */
export function legacyWorld({ meetingEnabled = true } = {}) {

  const world = createWorld();
  const gs = world.gs;
  const saved = {};

  for (const [name, columns] of Object.entries(OLD_COLUMNS)) {
    saved[name] = gs.TABLES[name].columns;
    gs.TABLES[name].columns = columns;
  }
  const savedOptional = gs.OPTIONAL_TABLES;
  const savedRun = gs.runMigration_;
  gs.OPTIONAL_TABLES = ['Sessions', 'News', 'Games', 'Notifications', 'Media'];
  gs.runMigration_ = () => ({ changed: false, lines: [] });

  world.as(ADMIN).gs.setup();

  for (const [name, columns] of Object.entries(saved)) gs.TABLES[name].columns = columns;
  gs.OPTIONAL_TABLES = savedOptional;
  gs.runMigration_ = savedRun;
  world.properties.delete('DATA_SCHEMA');

  // live-like content
  gs.apiSaveItem('sessions', { date: '2099-10-11', topic: 'الكسل الروحى', notify: { topic: true } });
  gs.apiSaveItem('news', { title: 'رحلة الغردقة', summary: 'سجّل اسمك', notify: { publish: true } });
  if (!meetingEnabled) gs.apiSaveSettings({ 'meeting.enabled': false });

  return world;

}


/** A Sheet like the live one at schema 3: upgraded once, WhatsApp row in. */
export function schema3World() {

  const world = legacyWorld();
  const gs = world.gs;
  const saved = {};

  // migrate with the schema-3 columns, then put the current ones back
  for (const [name, extra] of Object.entries(SCHEMA_4_COLUMNS)) {
    saved[name] = gs.TABLES[name].columns;
    gs.TABLES[name].columns = saved[name].filter(column => !extra.includes(column));
  }
  world.as(ADMIN).gs.migrate();
  for (const [name, columns] of Object.entries(saved)) gs.TABLES[name].columns = columns;
  world.properties.set('DATA_SCHEMA', '3');

  return world;

}
