// Stand-ins for the Points & Store v2 admin API (docs/COMPETITIONS.md §18),
// installed into a fake world ONLY while the real server functions are not in
// this tree (tests/comp-admin3.e2e.mjs checks `typeof apiSeasons`). They
// follow the contract's reply shapes so the admin screens can be exercised;
// once the server lands, the same test runs against the real code and this
// file is not used.

export function installPtsFakes(world, admin) {

  const gs = world.gs;
  if (typeof gs.apiSeasons === 'function') return false;

  const plain = v => JSON.parse(JSON.stringify(v));
  const as = () => gs;
  const wall = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(world.now())).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  };
  const addMin = (stamp, minutes) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(stamp || '');
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + minutes * 60000);
    return d.toISOString().slice(0, 16).replace('T', ' ');
  };

  const state = {
    schedule: { mode: 'auto', opensAt: '', closesAt: '', allowCancel: false, notify: { open1d: false, open1h: false, openAt: false, close24h: false, close1h: false } },
    sends: [],
    seasons: [{ id: 'sea-first', name: 'الموسم الأول', startAt: '', endAt: '', status: 'active', notifyDays: '', closedAt: '', closedBy: '' }],
    compSeason: {},
    transfers: new Set(),
    seq: 0,
    calls: []
  };

  const auto = () => ({ authorized: false, daily: false, nextDue: state.sends.filter(s => s.status === 'pending').map(s => s.sendAt).sort()[0] || '', pending: state.sends.filter(s => s.status === 'pending').length });
  const shopState = () => {
    const s = state.schedule;
    if (s.mode !== 'auto') return s.mode;
    const now = wall();
    if (s.opensAt && now < s.opensAt) return 'scheduled';
    if (s.closesAt && now > s.closesAt) return 'closed';
    return 'open';
  };
  const schedule = () => plain({ ...state.schedule, state: shopState(), auto: auto() });
  const KINDS = { open1d: ['shop-open-1d', 'opensAt', -1440], open1h: ['shop-open-1h', 'opensAt', -60], openAt: ['shop-open', 'opensAt', 0], close24h: ['shop-close-24h', 'closesAt', -1440], close1h: ['shop-close-1h', 'closesAt', -60] };

  const maxOf = () => 15;
  const seasonOut = s => ({ ...s, maxTheoretical: s.status === 'closed' ? 0 : maxOf(), expected: s.status === 'active' ? 10 : 0, competitions: s.status === 'active' ? 1 : 0, topBalance: s.status === 'active' ? Math.max(0, ...as().apiWallet({}).items.map(i => i.balance)) : 0, participants: s.status === 'active' ? as().apiWallet({}).total : 0 });

  const fakes = {
    apiShopSchedule() { return schedule(); },
    apiShopScheduleSave(input) {
      state.calls.push(['apiShopScheduleSave', plain(input)]);
      Object.assign(state.schedule, { mode: input.mode, opensAt: input.opensAt || '', closesAt: input.closesAt || '', allowCancel: !!input.allowCancel, notify: { ...state.schedule.notify, ...(input.notify || {}) } });
      for (const [key, [kind, field, minutes]] of Object.entries(KINDS)) {
        const at = state.schedule[field];
        const existing = state.sends.find(e => e.kind === kind && e.status === 'pending');
        if (state.schedule.notify[key] && at) {
          if (existing) existing.sendAt = addMin(at, minutes);
          else state.sends.push({ id: 'psh-' + (++state.seq), notifId: 'notif-' + kind, kind, refId: '', sendAt: addMin(at, minutes), status: 'pending', result: '', updatedAt: wall() });
        }
        else if (existing) { existing.status = 'cancelled'; existing.result = 'اتشال من الاختيارات'; }
      }
      return schedule();
    },
    apiPushAuto() { return auto(); },
    apiPushSchedule() { return { entries: plain(state.sends) }; },
    apiPushScheduleCancel(id) {
      const e = state.sends.find(x => x.id === id);
      if (!e) throw new Error('الإرسال ده مش موجود');
      e.status = 'cancelled';
      e.result = 'اتلغى من لوحة التحكم';
      return { entry: plain(e) };
    },
    apiSeasons() {
      return plain({ active: state.seasons.find(s => s.status === 'active').id, seasons: state.seasons.map(seasonOut) });
    },
    apiSeasonSave(input) {
      state.calls.push(['apiSeasonSave', plain(input)]);
      if (!String(input.name || '').trim()) throw new Error('اسم الموسم مطلوب');
      let s = input.id ? state.seasons.find(x => x.id === input.id) : null;
      if (!s) { s = { id: 'sea-' + (++state.seq), status: 'planned', closedAt: '', closedBy: '' }; state.seasons.push(s); }
      Object.assign(s, { name: input.name, startAt: input.startAt || '', endAt: input.endAt || '', notifyDays: input.notifyDays === '' ? '' : Number(input.notifyDays) || '' });
      return { season: plain(seasonOut(s)) };
    },
    apiSeasonClosePreview(id) {
      const season = state.seasons.find(s => s.id === id);
      const totals = as().apiWallet({ all: false }).items.map(i => ({ pid: i.id, name: i.name, group: i.group, earned: i.earned, spent: i.spent, adjusted: i.adjusted, final: i.balance }));
      const open = as().apiShopRedemptions({ status: 'open' }).items;
      return plain({ season: seasonOut(season), totals, openRequests: open, canClose: !open.length, confirmKey: 'ck-' + id });
    },
    apiSeasonClose(id, confirmKey, next) {
      state.calls.push(['apiSeasonClose', id, confirmKey, plain(next)]);
      if (as().apiShopRedemptions({ status: 'open' }).items.length) throw new Error('فيه طلبات لسه مفتوحة في الموسم ده');
      if (confirmKey !== 'ck-' + id) throw new Error('التأكيد مش صحيح');
      const season = state.seasons.find(s => s.id === id);
      season.status = 'closed';
      season.closedAt = wall();
      season.closedBy = admin;
      let nextSeason = typeof next === 'string' ? state.seasons.find(s => s.id === next) : null;
      if (!nextSeason) { nextSeason = { id: 'sea-' + (++state.seq), name: next.name, startAt: next.startAt || '', endAt: next.endAt || '', notifyDays: '', closedAt: '', closedBy: '' }; state.seasons.push(nextSeason); }
      nextSeason.status = 'active';
      return plain({ closed: seasonOut(season), next: seasonOut(nextSeason) });
    }
  };

  const base = gs.apiFunctions_;
  const realAdjust = gs.apiWalletAdjust;
  const realParticipant = gs.apiWalletParticipant;
  const realItems = gs.apiShopItems;
  const realSave = gs.apiCompSave;
  const realComp = gs.apiComp;

  const wrapped = {
    apiWalletAdjust(id, amount, note, key, kind) {
      state.calls.push(['apiWalletAdjust', id, amount, note, key, kind]);
      const r = realAdjust(id, amount, note, key);
      if (kind === 'transfer' && r && r.entry) state.transfers.add(r.entry.id);
      return r;
    },
    apiWalletParticipant(id) {
      const r = plain(realParticipant(id));
      r.entries.forEach(e => { if (state.transfers.has(e.id)) { e.kind = 'transfer'; e.kindLabel = 'تحويل من موسم فات'; } });
      return r;
    },
    apiShopItems() {
      const r = plain(realItems());
      r.items.forEach(i => { i.pctOfMax = i.cost / maxOf(); });
      return r;
    },
    apiCompSave(id, input) {
      if (input && input.seasonId !== undefined) state.compSeason[id] = input.seasonId;
      const r = plain(realSave(id, input));
      if (state.compSeason[id] !== undefined) r.comp.seasonId = state.compSeason[id];
      return r;
    },
    apiComp(id) {
      const r = plain(realComp(id));
      if (state.compSeason[id] !== undefined) r.comp.seasonId = state.compSeason[id];
      return r;
    }
  };

  gs.apiFunctions_ = function () { return Object.assign(base(), fakes, wrapped); };
  world.ptsFakes = state;
  return true;

}
