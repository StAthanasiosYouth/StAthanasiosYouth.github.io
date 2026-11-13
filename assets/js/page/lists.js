/**
 * «الكل ‹» PAGES (site redesign S2, approved by the owner 2026-11-13): the events, the services and the news, each
 * on the pages' shell (/events/, /services/, /news/). Back to the home, the title, the line, the filters, the
 * months, and the home's own cards in a grid (one, two, three columns).
 *
 *   events    content.json events[] (eventsList: upcoming first, finished last): the home's poster cards
 *   services  the «خدماتنا» section's activities with a page: the list cards of the pages
 *   news      the published news, newest first: the home's news cards (they open on the home, #news/<id>)
 *
 * The filters only hide cards (nothing is fetched again); a group left empty hides with them.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { MONTH_NAMES, arabicDigits, relativeTime, stampDate, eventWhen } from '../words.js';
import { isPublished, visibilityState } from '../schedule.js';
import { entryCta, eventHref, pageHref } from './model.js';

const KIND_PLURAL = { trip: 'رحلات', conference: 'مؤتمرات', funday: 'أيام ترفيهية' };

const day = stamp => Date.UTC(+stamp.slice(0, 4), +stamp.slice(5, 7) - 1, +stamp.slice(8, 10)) / 864e5;


export function createLists({ show, picture, rootUrl, homeHref, announce }) {

  /* ---------- the parts every list shares ---------- */

  function head(title, line) {
    return [
      h('a', { class: 'all-back', href: homeHref }, iconNode('chevron', 'all-back__ic'), 'الرئيسية'),
      h('div', { class: 'evlist__head' },
        h('h1', { class: 'evlist__title', id: 'page-title', tabindex: '-1' }, title),
        h('p', { class: 'evlist__sub' }, line))
    ];
  }

  /* [{ key, word }]: «الكل» first; a filter shows when it would change something */
  function filters(options, cards, noun) {
    const useful = options.filter(o => {
      const n = cards.filter(c => c.dataset.k.split(' ').includes(o.key)).length;
      return n > 0 && n < cards.length;
    });
    if (!useful.length) return null;
    const bar = h('div', { class: 'all-filters', role: 'group', 'aria-label': 'فلترة' });
    const pick = (key, button) => {
      for (const b of bar.children) b.setAttribute('aria-pressed', String(b === button));
      let shown = 0;
      for (const c of cards) {
        const on = key === 'all' || c.dataset.k.split(' ').includes(key);
        c.hidden = !on;
        if (on) shown++;
      }
      // a month / a group with nothing left hides with its cards
      for (const g of bar.parentNode.querySelectorAll('.all-group')) g.hidden = ![...g.querySelectorAll('.all-grid > *')].some(c => !c.hidden);
      announce(`${arabicDigits(shown)} ${noun}`);
    };
    [{ key: 'all', word: 'الكل' }, ...useful].forEach((o, i) => {
      bar.append(h('button', { type: 'button', 'aria-pressed': i ? 'false' : 'true', onclick: event => pick(o.key, event.currentTarget) }, o.word));
    });
    return bar;
  }

  function group(title, cards, kind) {
    return h('section', { class: 'all-group' },
      title ? h('h2', { class: 'all-month' }, title) : null,
      h('div', { class: `all-grid all-grid--${kind}` }, cards));
  }

  function empty(title, line) {
    return h('div', { class: 'pg-empty pg-empty--inline' },
      iconNode('calendar', 'pg-empty__icon'),
      h('p', { class: 'pg-empty__title' }, title),
      h('p', { class: 'muted' }, line),
      h('a', { class: 'btn btn--primary', href: homeHref }, 'ارجع للموقع'));
  }

  function page(kind, title, line, body) {
    show('ready', h('section', { class: `evlist all-page all-page--${kind}`, 'aria-labelledby': 'page-title' }, ...head(title, line), ...body));
  }


  /* «بإشراف B.U.G.»: the partner's mark on its light plate and the short name (docs/EVENTS.md §12) */
  function pchip(item, partners) {
    const partner = item.partner && partners && Object.prototype.hasOwnProperty.call(partners, item.partner) ? partners[item.partner] : null;
    if (!partner) return null;
    return h('p', { class: 'pchip', 'data-partner': partner.key },
      partner.mark ? h('span', { class: 'pchip__plate', 'aria-hidden': 'true' }, h('img', { src: new URL(partner.mark.src, rootUrl).href, width: partner.mark.w, height: partner.mark.h, alt: '', loading: 'lazy', decoding: 'async' })) : null,
      h('span', {}, 'بإشراف ', h('bdi', {}, partner.short)));
  }


  /* ---------- الفعاليات ---------- */

  function eventCard(item, nowStamp, partners) {
    const over = nowStamp > (item.endAt || item.startAt);
    const { label, chip } = entryCta('event', item, nowStamp);
    const d = stampDate(item.startAt);
    const card = h('a', { class: `s2-ev${over ? ' is-over' : ''}`, href: new URL(eventHref(item.slug), rootUrl).href },
      item.cover ? picture(item.cover, { sizes: '(min-width: 1024px) 380px, (min-width: 640px) 46vw, 92vw' }) : h('span', { class: 's2-ev__art', 'aria-hidden': 'true' }, iconNode('calendar')),
      h('div', { class: 's2-ev__body' },
        h('span', { class: 's2-ev__date' }, h('b', {}, arabicDigits(d.d)), h('small', {}, MONTH_NAMES[d.m - 1])),
        h('h3', {}, item.title),
        pchip(item, partners),
        h('p', {}, eventWhen(item)),
        h('span', { class: `s2-ev__tag${over ? ' s2-ev__tag--over' : ''}` }, over ? 'خلصت' : chip || label)));
    card.dataset.k = [over ? 'over' : 'soon', item.kind].filter(Boolean).join(' ');
    return card;
  }

  function events(list, nowStamp, partners = {}) {
    const title = 'الفعاليات';
    const line = 'كل اللي جاي في مكان واحد. اضغط على أي فعالية علشان تشوف التفاصيل وتحجز.';
    if (!list.length) return page('events', title, line, [empty('مفيش فعاليات دلوقتي', 'أول ما ننزّل رحلة أو يوم جديد هتلاقيه هنا.')]);
    const over = e => nowStamp > (e.endAt || e.startAt);
    // upcoming by month, then the finished ones together
    const groups = new Map();
    for (const item of list) {
      const d = stampDate(item.startAt);
      const key = over(item) ? 'over' : `${d.y}-${d.m}`;
      if (!groups.has(key)) groups.set(key, { title: key === 'over' ? 'خلصت' : `${MONTH_NAMES[d.m - 1]} ${arabicDigits(d.y)}`, cards: [] });
      groups.get(key).cards.push(eventCard(item, nowStamp, partners));
    }
    const cards = [...groups.values()].flatMap(g => g.cards);
    const kinds = [...new Set(list.map(e => e.kind).filter(k => KIND_PLURAL[k]))].map(k => ({ key: k, word: KIND_PLURAL[k] }));
    page('events', title, line, [
      filters([{ key: 'soon', word: 'جاية' }, ...kinds, { key: 'over', word: 'خلصت' }], cards, 'فعالية'),
      ...[...groups.values()].map(g => group(g.title, g.cards, 'ev'))
    ]);
  }


  /* ---------- خدماتنا ---------- */

  function serviceCard(item, type, partners) {
    const card = h('article', { class: 'ecard all-sv' },
      h('div', { class: 'ecard__media' }, item.image ? picture(item.image, { className: 'ecard__img', sizes: '(min-width: 1024px) 380px, (min-width: 640px) 46vw, 92vw' }) : null),
      h('div', { class: 'ecard__body' },
        type.label ? h('p', { class: 'ecard__meta' }, h('span', { class: 'chip chip--kind' }, type.label)) : null,
        h('h2', { class: 'ecard__title' }, h('a', { class: 'stretched', href: new URL(pageHref(item.page), rootUrl).href }, item.title)),
        pchip(item, partners),
        item.subtitle ? h('p', { class: 'ecard__sub' }, item.subtitle) : null,
        h('span', { class: 'ecard__cta', 'aria-hidden': 'true' }, item.watch ? 'شاهد' : 'ادخل صفحة الفريق', iconNode('arrow', 'all-sv__go'))));
    card.dataset.k = item.type || '';
    return card;
  }

  function services(content, nowStamp) {
    const title = 'خدماتنا';
    const line = 'خدمات الأسرة وفرقها. كل خدمة ليها صفحتها وفيديوهاتها.';
    const types = content.types || [];
    const list = (content.activities || []).filter(a => a.section === 'services' && a.page && visibilityState({ from: a.visibleFrom, until: a.visibleUntil }, nowStamp) === 'live');
    if (!list.length) return page('services', title, line, [empty('مفيش خدمات منشورة دلوقتي', 'أول ما تتنشر خدمة هتلاقيها هنا.')]);
    const typeOf = item => types.find(t => t.key === item.type) || { label: '' };
    const cards = list.map(item => serviceCard(item, typeOf(item), content.partners || {}));
    const options = [...new Set(list.map(a => a.type))].map(key => ({ key, word: typeOf({ type: key }).label })).filter(o => o.word);
    page('services', title, line, [filters(options, cards, 'خدمة'), group('', cards, 'sv')]);
  }


  /* ---------- جديد الأسرة ---------- */

  function newsCard(item, nowStamp) {
    const fresh = !!item.publishAt && item.publishAt.slice(0, 10) === nowStamp.slice(0, 10);
    const card = h('a', { class: 's2-nw', href: new URL(`index.html#news/${item.id}`, rootUrl).href },
      h('span', { class: 's2-nw__ic', 'aria-hidden': 'true' }, iconNode(item.icon || 'megaphone')),
      h('div', {}, h('b', {}, item.title), item.publishAt ? h('small', {}, relativeTime(item.publishAt, nowStamp)) : null),
      fresh ? h('span', { class: 's2-nw__new' }, 'جديد') : null);
    card.dataset.k = fresh ? 'new' : '';
    return card;
  }

  function news(content, nowStamp) {
    const title = 'جديد الأسرة';
    const line = 'الإعلانات والأخبار بالترتيب، الأحدث الأول.';
    const list = (content.news || []).filter(n => isPublished(n, nowStamp))
      .sort((a, b) => String(b.publishAt || '').localeCompare(String(a.publishAt || '')));
    if (!list.length) return page('news', title, line, [empty('مفيش أخبار دلوقتي', 'أول ما ننزّل خبر أو إعلان هتلاقيه هنا.')]);
    const week = list.filter(n => !n.publishAt || day(nowStamp) - day(n.publishAt) < 7);
    const older = list.filter(n => !week.includes(n));
    const groups = [['الأسبوع ده', week], ['أقدم', older]].filter(([, l]) => l.length).map(([t, l]) => [t, l.map(n => newsCard(n, nowStamp))]);
    const cards = groups.flatMap(([, c]) => c);
    page('news', title, line, [filters([{ key: 'new', word: 'جديد' }], cards, 'خبر'), ...groups.map(([t, c]) => group(older.length ? t : '', c, 'nw'))]);
  }

  return { events, services, news };

}
