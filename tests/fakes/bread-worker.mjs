// A stand-in for the Worker's «خبزنا اليومي» admin routes (worker/src/bread/admin.js, docs/daily-bread/progress/W3.md),
// for the admin e2e (tests/bread-admin.e2e.mjs): in memory, the documented shapes and codes. The day and program checks
// are the Worker's own (worker/src/bread/model.js checkProgram / checkTopic), so a day the panel would send and the
// Worker would refuse is refused here too. Not the real engine: publishing, the mirror and the tick are not here.

import { checkProgram, checkTopic, cairoDay, dayAdd, dayDiff, currentOf, nextOf, liveOn, MAX_DAYS } from '../../worker/src/bread/model.js';
import { readFileSync } from 'node:fs';
// P3: the saints registry routes (worker/src/bread/saints-admin.js), with the Worker's own rules (the shared module)
import { checkPerson, checkOccasion, check, withStatus, scheduled, feastsOfMonth, publicFile } from '../../worker/src/bread/saints.js';
import { LABELS } from '../../worker/src/bread/saints-admin.js';
const REGISTRY = JSON.parse(readFileSync(new URL('../../daily-bread/saints/registry.json', import.meta.url), 'utf8'));
// P5: the occasions 0037 adds (the diocese in its P5 form, then the 15 new ones), as D1 has them after the migrations
const SEED = JSON.parse(readFileSync(new URL('../../daily-bread/saints/occasions-seed.json', import.meta.url), 'utf8'));

export const WORKER_URL = 'https://athanasios-api.menazak-lab.workers.dev';
const TOPICS_PER_CALL = 20;
const clone = value => JSON.parse(JSON.stringify(value));
const STATUS = { invalid: 400, conflict: 409, not_found: 404, auth: 401, denied: 403, error: 500 };

class Fail extends Error {
  constructor(code, message, extra = {}) {
    super(code);
    this.code = code;
    this.msg = message;
    this.extra = extra;
  }
}

export function createBreadWorker({ origin, today = cairoDay(), admin = 'admin@test.invalid' } = {}) {

  const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' };
  const state = {
    today,
    programs: [],                      // rows like D1 bread_programs (snake_case)
    topics: new Map(),                 // id → Map(n → topic)
    daily: [],                         // { day, program_id, opens, reads, sent, reflections }
    reflections: [],                   // { id, program_id, n, day, text, state, name, created_ms, edited_ms }
    slots: [],                         // { device_id, minute }
    settings: { module: false, push: false, emptyMuted: false, defaultTime: '08:00', maxSlots: 3, saints: false, occasions: false },
    perms: { content: true, stats: true, reflections: true, saints: true },
    // P3: the draft (like D1 saints_items, seeded from P2), the publishes, the published file
    saints: {
      items: [
        ...REGISTRY.people.map((p, i) => ({ kind: 'person', id: p.id, ord: i + 1, data: withStatus(p), rev: 1, pub_rev: null, deleted: false, at: 0, by: 'P2 import' })),
        ...SEED.occasions.map((o, i) => ({ kind: 'occasion', id: o.id, ord: i + 1, data: o, rev: 1, pub_rev: null, deleted: false, at: 0, by: 'P5 seed' }))
      ],
      snapshots: [], file: null
    },
    calls: [],
    seq: 0
  };

  const pid = () => 'brd-' + (++state.seq).toString(16).padStart(10, '0');
  const find = id => {
    const p = state.programs.find(x => x.id === id);
    if (!p) throw new Fail('not_found', 'البرنامج ده مش موجود.');
    return p;
  };
  const stateOf = (p, day) => {
    if (p.status === 'draft' || p.status === 'ready') return p.status;
    if (liveOn(p, day)) return 'live';
    if (p.status === 'scheduled' && p.starts_on > day) return 'next';
    if (p.status === 'stopped' && (!p.ends_on || p.ends_on < p.starts_on)) return 'stopped';
    return 'ended';
  };
  const view = (p, extra = {}) => {
    const day = state.today;
    return {
      id: p.id, name: p.name, days: p.days, state: stateOf(p, day), startsOn: p.starts_on || null, endsOn: p.ends_on || null,
      daysLeft: liveOn(p, day) ? dayDiff(p.ends_on, day) : null, day: liveOn(p, day) ? dayDiff(day, p.starts_on) + 1 : null,
      createdMs: p.created_ms, createdBy: p.created_by, activatedMs: p.activated_ms || null, activatedBy: p.activated_by || '', stoppedMs: p.stopped_ms || null, purged: false, ...extra
    };
  };
  const dated = () => state.programs.filter(p => p.status === 'scheduled' || p.status === 'stopped');
  const need = perm => { if (!state.perms[perm]) throw new Fail('denied', 'مش مسموح لك.', { perm: 'bread.' + perm }); };
  const totalsOf = id => {
    const rows = state.daily.filter(d => d.program_id === id);
    const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
    return { opens: sum('opens'), reads: sum('reads'), sent: sum('sent'), reflections: sum('reflections') };
  };

  /* a program already set up (seed), with its days' numbers */
  function seed({ name, days, startsOn, status = 'scheduled', endsOn, by = admin, daily = [], titles = [] }) {
    const p = { id: pid(), name, days, status, starts_on: startsOn || null, ends_on: endsOn || (startsOn ? dayAdd(startsOn, days - 1) : null), created_by: by, created_ms: Date.parse('2026-11-01T08:00:00Z'), activated_by: by, activated_ms: Date.parse('2026-11-02T08:00:00Z') };
    state.programs.unshift(p);
    const t = new Map();
    for (let n = 1; n <= days; n++) t.set(n, { n, title: titles[n - 1] || 'موضوع ' + n, verseRef: 'يوحنا ٦: ٣٥', readingRef: 'يوحنا ٦: ٣٢–٣٥', question: n % 2 ? 'سؤال؟' : null });
    state.topics.set(p.id, t);
    for (const d of daily) state.daily.push({ program_id: p.id, opens: 0, reads: 0, sent: 0, reflections: 0, ...d });
    return p;
  }

  const routes = [
    ['GET', /^\/v1\/admin\/bread\/programs$/, () => {
      need('content');
      const day = state.today;
      const list = [...state.programs].sort((a, b) => b.created_ms - a.created_ms).map(p => view(p, { uploaded: (state.topics.get(p.id) || new Map()).size, totals: totalsOf(p.id) }));
      const cur = currentOf(dated(), day);
      const next = nextOf(dated(), day);
      return { today: day, current: cur ? cur.id : null, next: next ? next.id : null, programs: list, settings: clone(state.settings) };
    }],
    ['POST', /^\/v1\/admin\/bread\/programs$/, (m, body) => {
      need('content');
      const c = checkProgram(body);
      if (!c.ok) throw new Fail('invalid', 'في بيانات محتاجة تتصلح.', { errors: c.errors });
      const p = { id: pid(), name: c.name, days: c.days, status: 'draft', created_by: admin, created_ms: Date.now() };
      state.programs.push(p);
      state.topics.set(p.id, new Map());
      return { program: view(p, { uploaded: 0 }) };
    }],
    ['GET', /^\/v1\/admin\/bread\/programs\/(brd-[0-9a-f]{10})\/topics$/, m => {
      need('content');
      const p = find(m[1]);
      const t = [...(state.topics.get(p.id) || new Map()).values()].sort((a, b) => a.n - b.n);
      return { program: view(p), topics: t.map(x => ({ n: x.n, title: x.title, verseRef: x.verseRef, readingRef: x.readingRef, asked: !!x.question })) };
    }],
    ['POST', /^\/v1\/admin\/bread\/programs\/(brd-[0-9a-f]{10})\/topics$/, (m, body) => {
      need('content');
      const p = find(m[1]);
      if (p.status !== 'draft' && p.status !== 'ready') throw new Fail('invalid', 'البرنامج ده اتفعّل خلاص.');
      const list = body && body.topics;
      if (!Array.isArray(list) || !list.length || list.length > TOPICS_PER_CALL) throw new Fail('invalid', 'ابعت من ١ لـ ٢٠ يوم في المرة.');
      const errors = [];
      const ok = [];
      for (const t of list) {
        const c = checkTopic(t, p.days);
        if (!c.ok) errors.push(...c.errors);
        else ok.push(c.topic);
      }
      // the test's own refusal (a field the Worker would refuse that the panel let through)
      for (const t of ok) if (state.refuse && state.refuse(t)) errors.push({ n: t.n, field: 'meditation', message: 'التأمل فيه كلام مش مقبول.' });
      if (errors.length) throw new Fail('invalid', 'في أيام محتاجة تتصلح.', { errors });
      const map = state.topics.get(p.id);
      for (const t of ok) map.set(t.n, t);
      if (map.size === p.days) p.status = 'ready';
      const missing = [];
      for (let n = 1; n <= p.days; n++) if (!map.has(n)) missing.push(n);
      return { uploaded: map.size, days: p.days, missing, ready: map.size === p.days };
    }],
    ['POST', /^\/v1\/admin\/bread\/programs\/(brd-[0-9a-f]{10})\/activate$/, (m, body) => {
      need('content');
      const p = find(m[1]);
      const day = state.today;
      const mode = body && body.mode;
      if (mode !== 'after' && mode !== 'now' && mode !== 'on') throw new Fail('invalid', 'اختار: بعد الحالي ولا استبدال دلوقتي.');
      if (p.status !== 'ready') throw new Fail('invalid', p.status === 'draft' ? 'البرنامج لسه ناقص أيام.' : 'البرنامج ده اتفعّل قبل كده.');
      const cur = currentOf(dated(), day);
      const waiting = nextOf(dated(), day);
      let start;
      if (mode === 'on') {
        if (!body.startsOn || body.startsOn <= day) throw new Fail('invalid', 'تاريخ البداية لازم يكون يوم جاي.');
        if (waiting || (cur && body.startsOn <= cur.ends_on)) throw new Fail('conflict', 'في برنامج في الطريق.');
        start = body.startsOn;
      }
      else if (mode === 'after') {
        if (waiting) throw new Fail('conflict', 'في برنامج مستني بعد الحالي: «' + waiting.name + '».');
        start = cur ? dayAdd(cur.ends_on, 1) : day;
      }
      else {
        if (cur && body.confirm !== true) throw new Fail('invalid', 'أكّد الأول.', { needsConfirm: true });
        start = day;
        if (cur) { cur.status = 'stopped'; cur.ends_on = dayAdd(day, -1); cur.stopped_ms = Date.now(); }
      }
      Object.assign(p, { status: 'scheduled', starts_on: start, ends_on: dayAdd(start, p.days - 1), activated_ms: Date.now(), activated_by: admin });
      if (mode === 'now' && waiting) { waiting.starts_on = dayAdd(p.ends_on, 1); waiting.ends_on = dayAdd(waiting.starts_on, waiting.days - 1); }
      state.settings.emptyMuted = false;
      return { program: view(p), publish: 'pub-' + state.seq };
    }],
    ['POST', /^\/v1\/admin\/bread\/programs\/(brd-[0-9a-f]{10})\/stop$/, (m, body) => {
      need('content');
      const p = find(m[1]);
      if (!body || body.confirm !== true) throw new Fail('invalid', 'أكّد الإيقاف الأول.', { needsConfirm: true });
      const st = stateOf(p, state.today);
      if (st !== 'live' && st !== 'next') throw new Fail('invalid', 'البرنامج ده مش شغال ولا مستني.');
      Object.assign(p, { status: 'stopped', ends_on: st === 'live' ? dayAdd(state.today, -1) : null, stopped_ms: Date.now() });
      return { program: view(p) };
    }],
    ['POST', /^\/v1\/admin\/bread\/programs\/(brd-[0-9a-f]{10})\/delete$/, (m, b) => {
      need('content');
      const p = find(m[1]);
      const over = p.ends_on && p.ends_on < state.today && (p.status === 'scheduled' || p.status === 'stopped');
      if (p.status !== 'draft' && p.status !== 'ready' && !over) throw new Fail('invalid', 'البرنامج ده اتفعّل.');
      if (over && b.confirm !== true) throw new Fail('invalid', 'أكّد الأول.', { needsConfirm: true });
      state.programs = state.programs.filter(x => x.id !== p.id);
      state.topics.delete(p.id);
      return { deleted: p.id };
    }],
    ['GET', /^\/v1\/admin\/bread\/stats$/, (m, body, query) => {
      need('stats');
      const day = state.today;
      let id = query.get('program');
      if (!id) {
        const cur = currentOf(dated(), day);
        if (!cur) return { program: null, days: [], totals: null };
        id = cur.id;
      }
      const p = find(id);
      const days = state.daily.filter(d => d.program_id === p.id).sort((a, b) => (a.day < b.day ? -1 : 1)).map(d => ({ day: d.day, opens: d.opens, reads: d.reads, sent: d.sent, reflections: d.reflections }));
      const minutes = {};
      state.slots.forEach(s => { minutes[s.minute] = (minutes[s.minute] || 0) + 1; });
      const top = Object.entries(minutes).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      return {
        program: view(p), today: day, days,
        totals: { ...totalsOf(p.id), reflections: state.reflections.filter(r => r.program_id === p.id).length },
        subscribers: { devices: new Set(state.slots.map(s => s.device_id)).size, slots: state.slots.length },
        accounts: state.accounts || 0,
        topMinute: top ? Number(top[0]) : null
      };
    }],
    ['GET', /^\/v1\/admin\/bread\/reflections$/, (m, body, query) => {
      need('reflections');
      const p = find(query.get('program'));
      const before = Number(query.get('before')) || Number.MAX_SAFE_INTEGER;
      const max = 50;
      const rows = state.reflections.filter(r => r.program_id === p.id && r.created_ms < before).sort((a, b) => b.created_ms - a.created_ms).slice(0, max);
      state.reflectionReads = (state.reflectionReads || 0) + 1;
      const topics = state.topics.get(p.id) || new Map();
      return {
        program: { id: p.id, name: p.name },
        reflections: rows.map(r => ({ id: r.id, n: r.n, day: r.day, title: (topics.get(r.n) || {}).title || '', asked: !!(topics.get(r.n) || {}).question, text: r.text, state: r.state, name: r.name, createdMs: r.created_ms, editedMs: r.edited_ms || null })),
        more: rows.length === max ? rows[rows.length - 1].created_ms : null
      };
    }],
    // W7: St-Takla's month (state.suggest[month] = the file) and the month's feasts
    ['GET', /^\/v1\/admin\/bread\/suggest$/, (m, body, query) => {
      need('content');
      const month = query.get('month');
      const file = (state.suggest || {})[month];
      return file ? { month, ready: true, made: file.made, days: clone(file.days), feasts: clone(file.feasts || []) } : { month, ready: false };
    }],
    ['GET', /^\/v1\/admin\/bread\/feasts$/, (m, body, query) => {
      need('content');
      const month = query.get('month');
      const pub = (state.feasts || {})[month];
      return pub ? { month, published: true, feasts: clone(pub) } : { month, published: false, feasts: [] };
    }],
    ['POST', /^\/v1\/admin\/bread\/feasts$/, (m, b) => { need('content'); (state.feasts ||= {})[b.month] = b.feasts; return { month: b.month, feasts: b.feasts.length, publish: 'brd-pub-x' }; }],
    ...saintsRoutes(),
    ['GET', /^\/v1\/admin\/bread\/settings$/, () => { need('content'); return { settings: clone(state.settings) }; }],
    ['POST', /^\/v1\/admin\/bread\/settings$/, (m, b) => {
      need('content');
      let changed = 0;
      if (b.defaultTime !== undefined) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.defaultTime)) throw new Fail('invalid', 'الميعاد مش مفهوم.'); state.settings.defaultTime = b.defaultTime; changed++; }
      if (b.maxSlots !== undefined) { if (![1, 2, 3].includes(b.maxSlots)) throw new Fail('invalid', 'من ١ لـ ٣.'); state.settings.maxSlots = b.maxSlots; changed++; }
      if (b.emptyMuted !== undefined) { if (typeof b.emptyMuted !== 'boolean') throw new Fail('invalid', 'الطلب مش مفهوم.'); state.settings.emptyMuted = b.emptyMuted; changed++; }
      for (const k of ['module', 'push']) if (b[k] !== undefined) throw new Fail('denied', 'primary only');
      if (b.saints !== undefined) { state.settings.saints = !!b.saints; changed++; }
      if (b.occasions !== undefined) { state.settings.occasions = !!b.occasions; changed++; }   // P5
      if (!changed) throw new Fail('invalid', 'مفيش حاجة اتغيرت.');
      return { settings: clone(state.settings) };
    }]
  ];

  /* ---------- P3: the saints registry ---------- */
  function saintsRoutes() {
    const S = state.saints;
    const gate = () => { need('saints'); if (!state.settings.saints) throw new Fail('disabled', 'سجل الشخصيات لسه مقفول.'); };
    const st = r => (r.deleted ? 'deleted' : r.pub_rev == null ? 'new' : r.rev !== r.pub_rev ? 'changed' : 'published');
    const view = r => ({ kind: r.kind, id: r.id, ord: r.ord, rev: r.rev, state: st(r), at: r.at, by: r.by, data: clone(r.data) });
    const live = k => S.items.filter(r => r.kind === k && !r.deleted).sort((a, b) => a.ord - b.ord).map(r => r.data);
    const reg = () => ({ schema: 2, categories: REGISTRY.categories, people: live('person'), occasions: live('occasion') });
    const last = () => S.snapshots[S.snapshots.length - 1] || null;
    const changes = () => S.items.filter(r => st(r) !== 'published');
    const keyOf = () => JSON.stringify([last() ? last().rev : 0, S.items.map(r => r.kind + r.id + r.rev + (r.deleted ? 'x' : '')).sort()]);
    const same = (a, b) => JSON.stringify(a == null || (Array.isArray(a) && !a.length) ? null : a) === JSON.stringify(b == null || (Array.isArray(b) && !b.length) ? null : b);
    function review() {
      const before = last() ? last().data : { people: [], occasions: [] };
      const was = new Map([...before.people.map(p => ['person:' + p.id, p]), ...before.occasions.map(o => ['occasion:' + o.id, o])]);
      const on = g => new Map(g.people.map(withStatus).filter(scheduled).map(p => [p.id, p]));
      const a = on(before), z = on(reg());
      return {
        first: !last(), errors: check(reg()), expect: keyOf(), people: reg().people.length, occasions: reg().occasions.length,
        changes: changes().map(r => {
          const old = was.get(r.kind + ':' + r.id);
          const fields = old ? Object.keys({ ...old, ...r.data }).filter(k => !['status', 'missing', 'id'].includes(k) && !same(old[k], r.data[k])).map(k => ({ field: k, label: LABELS[k] || k })) : [];
          return { kind: r.kind, id: r.id, rev: r.rev, state: st(r), name: r.data.name, at: r.at, by: r.by, fields };
        }),
        joins: [...z.values()].filter(p => !a.has(p.id)).map(p => ({ id: p.id, name: p.name, class: p.class, days: p.feasts })),
        leaves: [...a.values()].filter(p => !z.has(p.id)).map(p => ({ id: p.id, name: p.name, class: p.class })),
        published: last() ? { rev: last().rev, at: last().at, by: last().by } : null
      };
    }
    function publishNow(data, note) {
      const rev = (last() ? last().rev : 0) + 1;
      S.snapshots.push({ rev, data: clone(data), people: data.people.length, occasions: data.occasions.length, note, at: Date.now(), by: admin });
      S.file = publicFile(data);
      return rev;
    }
    const row = (kind, id) => S.items.find(r => r.kind === kind && r.id === id);
    return [
      ['GET', /^\/v1\/admin\/bread\/saints$/, () => {
        gate();
        const items = S.items.slice().sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.ord - b.ord)).map(view);
        return { enabled: true, categories: REGISTRY.categories, items, changes: changes().length, published: last() ? { rev: last().rev, at: last().at, by: last().by } : null };
      }],
      ['POST', /^\/v1\/admin\/bread\/saints\/item$/, (m, b) => {
        gate();
        let item = clone(b.item || {});
        for (const k of Object.keys(item)) if (item[k] == null) delete item[k];
        if (b.kind === 'person') item = withStatus({ ...item, feasts: item.feasts || [], album: item.album || [] });
        const errors = b.kind === 'person' ? checkPerson(item, { cats: REGISTRY.categories }) : checkOccasion(item);
        if (errors.length) throw new Fail('invalid', 'فيه حاجات محتاجة تتصلح.', { errors });
        let r = row(b.kind, item.id);
        if (!b.rev) {
          if (r) throw new Fail('invalid', 'الـid ده مستعمل.');
          r = { kind: b.kind, id: item.id, ord: 1 + Math.max(0, ...S.items.filter(x => x.kind === b.kind).map(x => x.ord)), data: item, rev: 1, pub_rev: null, deleted: false, at: Date.now(), by: admin };
          S.items.push(r);
        } else {
          if (!r || r.rev !== b.rev || r.deleted) throw new Fail('stale', 'حد تاني عدّل ده من شوية.');
          Object.assign(r, { data: item, rev: r.rev + 1, at: Date.now(), by: admin });
        }
        return { item: view(r) };
      }],
      ['POST', /^\/v1\/admin\/bread\/saints\/item\/delete$/, (m, b) => {
        gate();
        const r = row(b.kind, b.id);
        if (!r || r.rev !== b.rev) throw new Fail('stale', 'حد تاني عدّل ده من شوية.');
        if (r.pub_rev == null) S.items.splice(S.items.indexOf(r), 1); else Object.assign(r, { deleted: true, rev: r.rev + 1 });
        return { ok: true };
      }],
      ['POST', /^\/v1\/admin\/bread\/saints\/item\/(restore|revert)$/, (m, b) => {
        gate();
        const r = row(b.kind, b.id);
        if (!r) throw new Fail('not_found', 'مفيش حاجة ترجع.');
        const was = last() && (b.kind === 'person' ? last().data.people : last().data.occasions).find(x => x.id === b.id);
        if (m[1] === 'restore') Object.assign(r, { deleted: false, rev: r.rev + 1 });
        else if (was) Object.assign(r, { data: clone(was), deleted: false, rev: r.rev + 1, pub_rev: r.rev + 1 });
        else S.items.splice(S.items.indexOf(r), 1);
        return { ok: true };
      }],
      ['GET', /^\/v1\/admin\/bread\/saints\/review$/, () => { gate(); return review(); }],
      ['POST', /^\/v1\/admin\/bread\/saints\/publish$/, (m, b) => {
        gate();
        const rv = review();
        if (rv.errors.length) throw new Fail('invalid', 'فيه حاجات محتاجة تتصلح قبل النشر.', { errors: rv.errors });
        if (b.expect !== rv.expect) throw new Fail('stale', 'فيه تعديل جديد. راجع تاني وانشر.');
        const rev = publishNow(reg(), rv.first ? 'أول نشرة' : rv.changes.map(c => c.name).join('، '));
        S.items = S.items.filter(r => !r.deleted);
        for (const r of S.items) r.pub_rev = r.rev;
        state.saintsPublishes = (state.saintsPublishes || 0) + 1;
        return { rev, people: reg().people.length, occasions: reg().occasions.length, joins: rv.joins, leaves: rv.leaves };
      }],
      ['GET', /^\/v1\/admin\/bread\/saints\/history$/, () => {
        gate();
        return { publishes: S.snapshots.slice().reverse().map(x => ({ rev: x.rev, people: x.people, occasions: x.occasions, note: x.note, at: x.at, by: x.by })) };
      }],
      ['POST', /^\/v1\/admin\/bread\/saints\/restore$/, (m, b) => {
        gate();
        const old = S.snapshots.find(x => x.rev === b.rev);
        if (!old || b.confirm !== true) throw new Fail('invalid', 'الطلب مش مفهوم.');
        S.items = [
          ...old.data.people.map((p, i) => ({ kind: 'person', id: p.id, ord: i + 1, data: clone(p), rev: 1, pub_rev: 1, deleted: false, at: Date.now(), by: admin })),
          ...old.data.occasions.map((o, i) => ({ kind: 'occasion', id: o.id, ord: i + 1, data: clone(o), rev: 1, pub_rev: 1, deleted: false, at: Date.now(), by: admin }))
        ];
        return { rev: publishNow(old.data, 'رجوع للنسخة ' + old.rev), from: old.rev };
      }],
      ['GET', /^\/v1\/admin\/bread\/saints\/feasts$/, (m, b, query) => {
        need('content');
        const month = query.get('month');
        if (!S.file) return { month, ready: false, feasts: [] };
        const feasts = feastsOfMonth(S.file, month).map(h => ({
          date: h.date, on: true, id: h.person.id, name: h.person.name, kind: h.feast.kind, title: h.feast.title || h.feast.kind + ' ' + h.person.name,
          word: h.person.word || 'النهارده ' + h.feast.kind + ' ' + h.person.name + '.', sourceUrl: h.feast.source, img: null, others: h.others
        }));
        return { month, ready: true, feasts };
      }]
    ];
  }

  const json = (status, body) => ({ status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });

  async function handle(request) {
    const url = new URL(request.url());
    if (url.origin !== WORKER_URL) return null;
    const method = request.method();
    if (method === 'OPTIONS') {
      return { status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'authorization, content-type, idempotency-key, accept, x-edit-session', 'access-control-max-age': '600' }, body: '' };
    }
    const headers = request.headers();
    const raw = request.hasPostData() ? (request.postData() ?? await request.fetchPostData()) ?? '' : '';
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch { body = null; } }
    const call = { method, path: url.pathname, query: url.search, body, auth: headers.authorization || '' };
    state.calls.push(call);
    try {
      if (!/^Bearer \S+/.test(call.auth)) throw new Fail('auth', 'لازم تدخل بحساب جوجل تاني.');
      for (const [verb, pattern, fn] of routes) {
        const m = verb === method && pattern.exec(url.pathname);
        if (!m) continue;
        return json(200, { ok: true, ...clone(fn(m, body || {}, url.searchParams)) });
      }
      throw new Fail('not_found', 'مش موجود.');
    }
    catch (error) {
      if (!(error instanceof Fail)) throw error;
      return json(STATUS[error.code] || 500, { ok: false, code: error.code, message: error.msg, ...error.extra });
    }
  }

  return { state, handle, seed, MAX_DAYS };

}
