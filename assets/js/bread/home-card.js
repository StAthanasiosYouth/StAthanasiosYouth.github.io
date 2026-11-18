/*
 * «خبزنا اليومي» — the home page card (decision 13; W1 shot 10-home): beside the account nudge / greeting, before the
 * meeting («اجتماع الشباب»). Only while the section is open (gate.js); its look (bread.css) and its day file load
 * then, never before. Today's topic is this device's own (the same order as the section's page).
 */
import { breadGate } from './gate.js';
import { AR, cairoDay, programsOn, dayOf, newSeed, SEED } from './model.js';
import { loadDay } from './api.js';

const ROOT = new URL('../../../', import.meta.url);
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* fine */ } } };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let styled = null;
function styles() {
  return (styled ||= new Promise(ok => {
    if (document.querySelector('link[data-bread]')) { ok(); return; }
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = new URL('assets/css/bread.css', ROOT).href;
    l.dataset.bread = '';
    l.onload = l.onerror = () => ok();
    document.head.append(l);
  }));
}

let card = null;
/** puts the card into the home page `main` (again after a re-render); quiet when the section is closed */
export async function placeCard(main) {
  const gate = await breadGate();
  if (!gate.on || !gate.index) return;
  const day = cairoDay();
  const { live } = programsOn(gate.index, day);
  if (!live) return;
  if (!card) {
    let seed = ls.get('bread.seed');
    if (!seed || !SEED.test(seed)) { seed = newSeed(); ls.set('bread.seed', seed); }
    const kept = ls.get('bread.kept.' + live.id);
    if (kept && SEED.test(kept)) seed = kept;
    const info = dayOf(live, day, seed, ls.get('bread.joined.' + live.id));
    const [topic] = await Promise.all([info ? loadDay(live.id, info.n) : null, styles()]);
    if (!topic) return;
    const read = ls.get('bread.read') === day;
    card = document.createElement('a');
    card.className = 'widget br-home';
    card.href = new URL('daily-bread/', ROOT).href;
    card.setAttribute('aria-label', 'خبزنا اليومي: ' + topic.title);
    card.innerHTML = `<img class="br-home__mark" src="${new URL('assets/img/bread/mark-128.webp', ROOT).href}" alt="" width="64" height="64">
      <div class="br-home__head"><span class="br-home__name">خبزنا اليومي</span><span class="br-home__chip">اليوم ${AR(info.dayNo)} من ${AR(info.ofDays)}</span></div>
      <p class="br-home__topic">${esc(topic.title)}</p>
      <p class="br-home__verse">«${esc(topic.verse)}» <small>${esc(topic.verseRef)}</small></p>
      <div class="br-home__acts">${read
        ? '<span class="br-home__done"><svg class="icon icon--line" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>قريتها النهارده</span><span class="btn btn--small br-home__again">افتح تاني</span>'
        : '<span class="btn btn--primary btn--small">اقرا كلمة النهارده<svg class="icon icon--line" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg></span>'}</div>`;
  }
  if (card.isConnected) return;
  const side = main.querySelector('.s2-side');
  const meet = main.querySelector('.s2-side .widget.meeting, .widget.meeting');
  if (meet && meet.parentNode) meet.parentNode.insertBefore(card, meet);
  else if (side) side.append(card);
}
