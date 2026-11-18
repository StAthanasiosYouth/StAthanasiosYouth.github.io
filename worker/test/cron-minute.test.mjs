// W6: the minute cron reads its switches once and skips the steps that are off (docs/daily-bread/progress/W6.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.mjs';
import { scheduled, minuteSwitches } from '../src/scheduled.js';

/* counts the statements the cron sends to D1 (each costs CPU on the Free plan's 10 ms) */
function counted(env) {
  const sql = [];
  const db = env.DB;
  const wrap = stmt => new Proxy(stmt, { get: (t, k) => (k === 'bind' ? (...a) => wrap(t.bind(...a)) : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
  const DB = new Proxy(db, {
    get: (t, k) => {
      if (k === 'prepare') return q => { sql.push(q); return wrap(t.prepare(q)); };
      return typeof t[k] === 'function' ? t[k].bind(t) : t[k];
    }
  });
  return { env: { ...env, DB }, sql };
}

const setAll = (h, rows) => h.env.DB.batch(Object.entries(rows).map(([k, v]) => h.env.DB.prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, 0, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v, 'test')));
const minute = Date.UTC(2026, 10, 18, 10, 7);

test('cron minute: every switch off → one switches read, no step reads its own', async () => {
  const h = harness();
  await setAll(h, { NOTIFY_ROUTER: '0', NOTIFY_EMAIL: '0', PUSH_SENDER: 'apps-script', BREAD_MODULE: '0', BREAD_PUSH: '0', accounts_mode: 'off' });
  const { env, sql } = counted(h.env);
  await scheduled({ cron: '* * * * *', scheduledTime: minute }, env);
  assert.equal(sql.filter(q => /FROM settings WHERE key IN/.test(q)).length, 1);
  for (const k of ['COMP_IMPORT', 'PUSH_IMPORT', "'PUSH_SENDER'", 'BREAD_MODULE']) {
    assert.ok(!sql.some(q => q.includes(k) && !/WHERE key IN \(\?/.test(q)), 'no own read of ' + k);
  }
  assert.ok(!sql.some(q => /bread_slots|push_schedule|push_reminders|submissions/.test(q)));
});

test('cron minute: a switch on → its step still runs (bread, release, import)', async () => {
  const h = harness();
  await setAll(h, { PUSH_SENDER: 'worker', BREAD_MODULE: '1', BREAD_PUSH: '1', accounts_mode: 'on', COMP_IMPORT: 'dry' });
  const sw = await minuteSwitches(h.env.DB);
  assert.equal(sw.BREAD_PUSH, '1');
  const { env, sql } = counted(h.env);
  await scheduled({ cron: '* * * * *', scheduledTime: minute }, env);
  assert.ok(sql.some(q => /bread_slots/.test(q)), 'breadTick ran');
  assert.ok(sql.some(q => /FROM submissions/.test(q)), 'compReleaseTick ran');
  assert.ok(sql.some(q => q.includes("key = 'COMP_IMPORT'")), 'compImportTick ran');
  assert.ok(sql.some(q => /push_schedule/.test(q)), 'scheduleTick ran');
});
