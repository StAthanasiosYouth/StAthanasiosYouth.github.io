/**
 * «فكّرني لما تبدأ» (site redesign S4; owner 2026-11-14) on a competition that has not started yet:
 * a push to THIS device at the start (Worker /v1/push/remind, push/remind.js). Notifications off → the same tap
 * turns them on first (push.js remindToggle). On: «هنفكّرك ✓»; a second tap cancels.
 * The competitions' own push to everyone is untouched; when it goes out around the start it stands for the reminder.
 */

import { loadMemo } from '../push-env.js';

const ON_WORD = 'هنفكّرك ✓';

/* loaded with the button, so the tap reaches Notification.requestPermission() still inside the gesture */
let pushModule = null;
const loadPush = () => (pushModule ||= import('../push.js'));

const isOn = slug => { const list = loadMemo().reminders; return Array.isArray(list) && list.includes(slug); };

/**
 * slug, title: the competition; word: the button's own word («فكّرني لما تبدأ» / «فكّرني»); className;
 * announce(text): the page's live region. → [button, note]
 */
export function remindButton({ slug, title, word, className, announce }) {
  loadPush().catch(() => {});
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  let on = isOn(slug);
  const paint = () => {
    b.textContent = on ? ON_WORD : word;
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? `هنفكّرك لما تبدأ ${title}. دوس تاني علشان تلغي التذكير` : `فكّرني لما تبدأ ${title}`);
    b.classList.toggle('is-on', on);
  };
  paint();
  // why it could not be set (an iPhone not on the Home Screen, notifications refused): shown under the button
  const note = document.createElement('p');
  note.className = 'remind-note';
  note.hidden = true;
  const fail = text => { note.textContent = text; note.hidden = false; announce(text); };
  b.addEventListener('click', async () => {
    note.hidden = true;
    if (b.getAttribute('aria-busy') === 'true') return;
    b.setAttribute('aria-busy', 'true');
    try {
      const { remindToggle } = await loadPush();
      const r = await remindToggle(slug, !on);
      if (r.ok) {
        on = r.on;
        announce(on ? 'تمام، هيوصلك إشعار أول ما المسابقة تبدأ' : 'اتلغى التذكير');
      }
      else fail(r.text);
    }
    catch {
      fail('ما قدرناش نسجّل التذكير. جرّب تاني بعد شوية.');
    }
    finally {
      b.removeAttribute('aria-busy');
      paint();
    }
  });
  return [b, note];
}
