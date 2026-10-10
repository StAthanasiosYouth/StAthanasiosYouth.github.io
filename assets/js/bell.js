/**
 * BELL: the in-site notification center.
 *
 * Notifications come from content.json and appear on their publishAt (Cairo
 * time) without a new publish. Read state is per browser (inbox.js).
 * The badge counts what arrived since the bell was last opened; each item
 * keeps its own "new" dot until tapped.
 */

import { h } from './dom.js';
import { iconNode } from './icons.js';
import { isPublished } from './schedule.js';
import { liveSections } from './layout.js';
import { dayGroup, relativeTime, arabicDigits } from './words.js';
import { loadInbox, saveInbox, unreadCount, isNew, markOpened, markRead, pruneInbox } from './inbox.js';
import { openSheet } from './sheet.js';
import { go, leave } from './router.js';
import { swingBell, pop } from './motion.js';
import { play } from './sound.js';
import { picture } from './hub.js';

const TYPE = {
  general: { icon: 'info', label: 'إشعار' },
  meeting: { icon: 'church', label: 'الاجتماع' },
  news: { icon: 'megaphone', label: 'خبر' },
  game: { icon: 'star', label: 'تحدي' },
  important: { icon: 'alert', label: 'مهم' },
  competition: { icon: 'trophy', label: 'مسابقة' },
  activity: { icon: 'calendar', label: 'فعالية' }
};

let inbox = null;
let lastCount = -1;
let seenIds = null;


/* a notification about the meeting, news or games shows only while that
   section is showing (section visibility always wins) */
const SECTION_OF_TYPE = { meeting: 'meeting', news: 'news', game: 'games', competition: 'competitions' };
const SECTION_OF_TARGET = { meeting: 'meeting', news: 'news', game: 'games' };

export function visibleNotifications(content, nowStamp) {

  const live = new Set(liveSections(content, nowStamp).map(s => s.key));

  return content.notifications.filter(item => {
    if (!isPublished(item, nowStamp)) return false;
    const byType = SECTION_OF_TYPE[item.type];
    let byTarget = item.target && SECTION_OF_TARGET[item.target.kind];
    // an activity lives in its own section (المسابقات, الفعاليات...)
    if (item.target && item.target.kind === 'activity') {
      const activity = (content.activities || []).find(a => a.id === item.target.id);
      byTarget = activity ? activity.section : '__missing';
    }
    return (!byType || live.has(byType)) && (!byTarget || live.has(byTarget));
  });

}


function bellButton() {

  return document.getElementById('bell');

}


export function updateBell(content, nowStamp) {

  const button = bellButton();

  if (!button) return;

  const items = visibleNotifications(content, nowStamp);

  inbox = pruneInbox(inbox || loadInbox(nowStamp), content.notifications);

  const count = unreadCount(inbox, items);
  const badge = button.querySelector('.bell__badge');

  badge.textContent = count > 9 ? '+٩' : arabicDigits(count);
  badge.hidden = count === 0;
  button.disabled = false;
  button.setAttribute('aria-label', count ? `الإشعارات، ${arabicDigits(count)} ${count === 1 ? 'جديد' : 'جديدة'}` : 'الإشعارات');

  // something arrived while the page was open (or on load with news waiting)
  const fresh = seenIds ? items.filter(item => !seenIds.has(item.id) && isNew(inbox, item)) : [];

  if (count > 0 && (lastCount === -1 || count > lastCount)) {
    swingBell(button.querySelector('.icon'));
    pop(badge);
    if (fresh.some(item => item.type === 'important')) {
      play('important', { passive: true });
    }
  }

  lastCount = count;
  seenIds = new Set(items.map(item => item.id));

}


export function openBell(content, nowStamp) {

  const items = visibleNotifications(content, nowStamp);

  inbox = inbox || loadInbox(nowStamp);

  const groups = [];

  for (const item of items) {
    const label = dayGroup(item.publishAt, nowStamp);
    let group = groups.find(g => g.label === label);
    if (!group) groups.push(group = { label, items: [] });
    group.items.push(item);
  }

  const list = items.length
    ? h('div', { class: 'inbox' }, groups.map(group => h('section', { class: 'inbox__group' },
      h('h3', { class: 'inbox__day' }, group.label),
      h('ul', { class: 'inbox__list' }, group.items.map(item => h('li', {}, notificationRow(item, nowStamp))))
    )))
    : h('div', { class: 'inbox__empty' },
      iconNode('bell', 'inbox__empty-icon'),
      h('p', {}, 'مفيش إشعارات دلوقتي'),
      h('p', { class: 'inbox__hint' }, 'أي جديد في الأسرة هيظهر هنا.')
    );

  // notifications on this phone (push.js, loaded only now; never in the admin's preview)
  const pushSlot = h('div', { class: 'push-slot' });

  if (!document.documentElement.hasAttribute('data-preview')) {
    import('./push.js').then(push => push.fillPushSlot(pushSlot)).catch(error => console.warn(error));
  }

  openSheet({
    title: 'الإشعارات',
    variant: 'panel',
    content: [pushSlot, list],
    onClose: ({ fromRoute }) => leave({ fromRoute })
  });

  inbox = markOpened(inbox, nowStamp);
  saveInbox(inbox);
  updateBell(content, nowStamp);

}


function notificationRow(item, nowStamp) {

  const type = TYPE[item.type] || TYPE.general;
  const unread = isNew(inbox, item);
  const target = item.target;

  const row = h(target && target.kind === 'url' ? 'a' : 'button', {
    class: `note-item note-item--${item.type}${unread ? ' is-new' : ''}`,
    type: target && target.kind === 'url' ? null : 'button',
    href: target && target.kind === 'url' ? target.url : null,
    target: target && target.kind === 'url' ? '_blank' : null,
    rel: target && target.kind === 'url' ? 'noopener' : null,
    onclick: event => {
      inbox = markRead(inbox, item.id);
      saveInbox(inbox);
      row.classList.remove('is-new');
      if (!target || target.kind === 'url') return;
      event.preventDefault();
      if (target.kind === 'meeting') go('meeting');
      else go(target.kind, target.id);
    }
  },
  h('span', { class: 'note-item__icon', 'aria-hidden': 'true' }, iconNode(type.icon)),
  h('span', { class: 'note-item__text' },
    h('span', { class: 'note-item__title' }, item.title),
    item.message ? h('span', { class: 'note-item__message' }, item.message) : null,
    h('span', { class: 'note-item__time' },
      unread ? h('span', { class: 'visually-hidden' }, 'جديد، ') : null,
      `${type.label} · ${relativeTime(item.publishAt, nowStamp)}`
    )
  ),
  item.image ? h('span', { class: 'note-item__thumb' }, picture(item.image, { sizes: '56px' })) : null
  );

  return row;

}
