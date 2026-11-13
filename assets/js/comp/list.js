/**
 * «المسابقات» — /competitions/ (site redesign S4, PLAN §1 decision 6): one place for every competition.
 *
 *   content.json competitions[] (the published index) → each one's comp.json (the counts) → a card:
 *   open (متاحة دلوقتي · فاضل N أيام · ابدأ), coming (بتبدأ بعد … · its date · فكّرني), finished (خلصت · your score).
 *   A finished one stays listed RECENT_DAYS after its end. Filters: الكل · متاحة دلوقتي · جاية · خلصت.
 *   Signed in: the balance («رصيدك … نقطة ‹», to «نقاطي») and the score of a finished one, from /v1/account/summary.
 *
 * The home's «المسابقات» shortcut opens this page while it has something to show (home.js).
 */

import { h } from '../dom.js';
import { fetchPublished } from '../content-source.js';
import { setServerTime, zonedNow, stamp, realMinutesBetween } from '../schedule.js';
import { formatDate, formatTime, untilText, stampDate, arabicDigits as ar } from '../words.js';
import { soundToggle, uiSounds } from '../ui-sound.js';
import { accountBadge } from '../account/link.js';
import { mountNav, homeLink } from '../nav.js';
import { accountSession } from './accounts.js';
import { bookApiUrl } from '../page/book-config.js';
import * as F from './flow.js';
import { icon, leftText } from './view.js';
import { remindButton } from './remind.js';
import { listOf } from './listing.js';

const ROOT = new URL('../../../', import.meta.url);
const main = document.getElementById('comp-main');
const live = document.getElementById('comp-live');
const nowStamp = () => stamp(zonedNow());

const announce = message => {
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = message; }, 30);
};

async function json(url, kind, slug) {
  for (const cache of ['no-cache', 'force-cache']) {
    try {
      const response = await fetchPublished(url, { cache, credentials: 'same-origin' }, { kind, slug });
      if (!response.ok) continue;
      if (cache === 'no-cache' && kind === 'content') setServerTime(response.headers.get('Date'));
      return await response.json();
    }
    catch {
      // offline: the browser's copy next
    }
  }
  return null;
}

/* the signed-in member's balance and latest results (nothing when signed out or offline) */
async function summary() {
  const session = accountSession();
  if (!session) return null;
  try {
    const response = await fetch(`${bookApiUrl()}/v1/account/summary`, { headers: { Authorization: `Bearer ${session.token}` }, credentials: 'omit', cache: 'no-store' });
    const data = await response.json();
    return data && data.ok ? data : null;
  }
  catch {
    return null;
  }
}

/* a Cairo wall stamp in formatDate()'s parts */
const dayOf = s => { const d = stampDate(s); return { day: d.d, month: d.m, weekday: d.weekday, minutes: d.minutes }; };

const KIND_ICON = { open: 'cup', soon: 'book', done: 'padlock' };
const TABS = [['all', 'الكل'], ['open', 'متاحة دلوقتي'], ['soon', 'جاية'], ['done', 'خلصت']];

function card(c, def, result, now) {
  const page = new URL(`competition/${c.slug}/`, ROOT).href;
  const parts = [];
  if (c.state === 'done') {
    parts.push(`خلصت يوم ${formatDate(dayOf(c.endAt), false)}`);
  }
  else if (def) {
    if (def.questionCount) parts.push(F.countQuestions(def.questionCount));
    if (def.showPoints && def.totalPoints) parts.push(F.countPoints(def.totalPoints));
    if (def.timeLimit && c.state === 'open') parts.push(F.countMinutesShort(def.timeLimit));
  }

  const meta = [];
  if (c.state === 'open') {
    meta.push(h('span', { class: 'cc__chip cc__chip--open' }, 'متاحة دلوقتي'));
    const minutes = c.endAt ? realMinutesBetween(now, c.endAt) : null;
    if (minutes > 0) meta.push(h('span', { class: 'cc__chip' }, leftText(Math.ceil(minutes / 1440))));
    meta.push(h('span', { class: 'cc__go', 'aria-hidden': 'true' }, 'ابدأ ‹'));
  }
  else if (c.state === 'soon') {
    const d = dayOf(c.startAt);
    meta.push(h('span', { class: 'cc__chip cc__chip--soon' }, `بتبدأ ${untilText(Math.max(0, realMinutesBetween(now, c.startAt) || 0))}`));
    meta.push(h('span', { class: 'cc__chip' }, `${formatDate(d)} · ${formatTime(d.minutes)}`));
    const [bell, note] = remindButton({ slug: c.slug, title: c.title, word: 'فكّرني', className: 'cc__go cc__go--ghost', announce });
    meta.push(bell, note);
  }
  else {
    meta.push(h('span', { class: 'cc__chip cc__chip--done' }, 'خلصت'));
    if (result && result.score !== null && result.score !== undefined && result.maxScore) {
      meta.push(h('span', { class: 'cc__score' }, 'درجتك ', h('b', {}, ar(result.score)), ` من ${ar(result.maxScore)}`,
        result.pointsAwarded > 0 ? ` · +${ar(result.pointsAwarded)} نقطة` : ''));
    }
  }

  return h('article', { class: `cc${c.state === 'done' ? ' cc--done' : ''}`, 'data-k': c.state },
    h('span', { class: 'cc__ic', 'aria-hidden': 'true' }, icon(KIND_ICON[c.state])),
    h('div', {},
      h('h2', {}, h('a', { class: 'cc__link', href: page }, c.title)),
      parts.length ? h('p', {}, parts.join(' · ')) : null),
    h('div', { class: 'cc__meta' }, meta));
}

async function boot() {

  main.replaceChildren(h('p', { class: 'muted cl__wait', 'aria-busy': 'true' }, 'جاري التحميل…'));

  const raw = await json(new URL('content.json', ROOT), 'content', '');
  if (!raw) {
    main.replaceChildren(h('p', { class: 'cl__empty', role: 'alert' }, 'مش قادرين نحمّل المسابقات. اتأكد من النت وجرّب تاني.'));
    return;
  }
  const { sanitizeContent } = await import('../content.js');
  const content = sanitizeContent(raw);
  const now = nowStamp();
  const list = listOf(content.competitions, now);

  const [defs, me] = await Promise.all([
    Promise.all(list.map(async c => {
      if (c.state === 'done') return null;
      const d = await json(new URL(F.compJsonPath(c.slug, c.v), ROOT), 'comp', c.slug);
      const def = d ? F.sanitizeDefinition(d) : null;
      return def && !def.withdrawn ? def : null;
    })),
    summary()
  ]);
  const results = new Map(((me && me.results && me.results.latest) || []).map(r => [r.slug, r]));

  const cards = list.map((c, i) => card(c, defs[i], results.get(c.slug), now));
  const grid = h('div', { class: 'cl__grid' }, cards);
  const empty = h('p', { class: 'cl__empty', hidden: cards.length ? '' : null }, 'مفيش مسابقات دلوقتي. أول ما تنزل مسابقة هيوصلك إشعار.');

  const count = k => (k === 'all' ? cards.length : cards.filter(n => n.dataset.k === k).length);
  const tabs = cards.length ? h('div', { class: 'cl__tabs', role: 'group', 'aria-label': 'فلترة' },
    TABS.filter(([k]) => k === 'all' || count(k) > 0).map(([k, word], i) => h('button', {
      type: 'button', class: i ? '' : 'on', 'aria-pressed': i ? 'false' : 'true',
      onclick: event => {
        for (const b of event.currentTarget.parentNode.children) {
          b.classList.toggle('on', b === event.currentTarget);
          b.setAttribute('aria-pressed', String(b === event.currentTarget));
        }
        for (const n of cards) n.hidden = k !== 'all' && n.dataset.k !== k;
        announce(`${ar(count(k))} ${count(k) === 1 ? 'مسابقة' : 'مسابقات'}`);
      }
    }, word, h('small', {}, ar(count(k)))))) : null;

  const balance = me && me.points && content.points
    ? h('a', { class: 'cl__bal', href: new URL(content.points.url || 'points/', ROOT).href }, 'رصيدك ', h('b', {}, ar(me.points.balance || 0)), ' نقطة ‹')
    : null;

  main.dataset.state = 'list';
  main.replaceChildren(
    h('div', { class: 'cl__head' },
      h('div', {},
        h('h1', { id: 'page-title', tabindex: '-1' }, 'المسابقات'),
        h('p', {}, 'جاوب، واكسب نقط تبدّلها من متجر «نقاطي».')),
      balance),
    tabs,
    grid,
    empty
  );

}

if (main) {
  const bar = document.querySelector('.cbar');
  const home = homeLink(bar);
  soundToggle(bar);
  accountBadge(bar, ROOT, { before: home });
  mountNav();
  uiSounds();
  boot();
}
