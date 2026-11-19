/*
 * «خبزنا اليومي» — each device's own notification, built in the QUEUE CONSUMER (push/send.js runPart), never in the
 * cron (STUDY §7.3): the cron only names the devices; here, per part (≤ 45 devices), the topic of each one:
 *   - the seed: the linked account's kept seed in the program (bread_members), else the device's own (bread_slots);
 *   - title = that topic's title, body = the start of its verse (decision 7);
 *   - a device whose person already pressed «قريت» today gets nothing (a second or third slot).
 * A send is a bread send when its ref is 'bread:<programId>:<YYYY-MM-DD>'.
 */

import { retry } from '../lib/db.js';
import { pseudonym } from '../lib/hash.js';
import { topicFor } from './model.js';

const REF = /^bread:(brd-[0-9a-f]{10}):(\d{4}-\d{2}-\d{2})$/;
const BODY_MAX = 110;
const inList = list => list.map(() => '?').join(',');

export const isBreadSend = ref => REF.test(String(ref || ''));

const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t;
};

/*
 * → { messages: Map(deviceId → model), skip: Set(deviceId) } | null (not a bread send, or nothing to say).
 * `devices`: [{ id }] of this part; `m`: the send's stored model (the fallback text).
 */
export async function personalize(env, ref, devices, m) {
  const hit = REF.exec(String(ref || ''));
  if (!hit || !devices.length) return null;
  const [, programId, day] = hit;
  const db = env.DB;
  const ids = devices.map(d => d.id);
  const [prog, slots, links] = await retry(() => db.batch([
    db.prepare('SELECT id, name, days, status, starts_on, ends_on FROM bread_programs WHERE id = ?').bind(programId),
    db.prepare(`SELECT device_id, MIN(seed) AS seed FROM bread_slots WHERE device_id IN (${inList(ids)}) GROUP BY device_id`).bind(...ids),
    db.prepare(`SELECT d.id, m.seed FROM push_devices d JOIN bread_members m ON m.participant_id = d.account_id AND m.program_id = ? WHERE d.id IN (${inList(ids)})`).bind(programId, ...ids)
  ]));
  const p = prog.results[0];
  if (!p) return null;
  const own = new Map(slots.results.map(r => [r.device_id, r.seed]));
  const kept = new Map(links.results.map(r => [r.id, r.seed]));
  const seedOf = id => kept.get(id) || own.get(id) || '';
  const plan = new Map();
  for (const id of ids) {
    const seed = seedOf(id);
    const t = seed ? topicFor(seed, p, day) : null;
    if (t) plan.set(id, { seed, n: t.n });
  }
  // no seed at all (on by default, the page never opened here): the general text; a seed with no topic today: nothing
  const skip = new Set(ids.filter(id => !plan.has(id) && seedOf(id)));
  if (!plan.size) return { messages: new Map(), skip };
  const hashes = new Map();
  for (const [id, x] of plan) hashes.set(id, (await pseudonym(env, 'bread:' + x.seed)).slice(0, 32));
  const ns = [...new Set([...plan.values()].map(x => x.n))];
  const hs = [...new Set(hashes.values())];
  const [topics, read] = await retry(() => db.batch([
    db.prepare(`SELECT n, title, verse_text FROM bread_topics WHERE program_id = ? AND n IN (${inList(ns)})`).bind(programId, ...ns),
    db.prepare(`SELECT device_hash FROM bread_opens WHERE day = ? AND kind = 'read' AND device_hash IN (${inList(hs)})`).bind(day, ...hs)
  ]));
  const byN = new Map(topics.results.map(t => [t.n, t]));
  const done = new Set(read.results.map(r => r.device_hash));
  const messages = new Map();
  for (const [id, x] of plan) {
    if (done.has(hashes.get(id))) { skip.add(id); continue; }
    const t = byN.get(x.n);
    if (!t) continue;
    messages.set(id, { ...m, title: clip(t.title, 60), body: clip('«' + clip(t.verse_text, BODY_MAX - 2) + '»', BODY_MAX) });
  }
  return { messages, skip };
}
