/**
 * MEETING JOURNEY (the strip under the meeting countdown)
 *
 * Seven days ending on the next meeting. A gold line fills from the start
 * of the strip to "now" (it moves through the day, not once a day), a dim
 * line continues to the meeting marker, and everything glows a little more
 * as the meeting gets closer (--energy, 0..1). Today and the meeting day
 * look different. All motion is CSS; this only sets numbers.
 */

import { h } from './dom.js';
import { DAY_SHORT, arabicDigits } from './words.js';

export function journeyElement() {

  const days = h('ol', { class: 'journey__days' });

  const root = h('div', { class: 'journey', 'aria-hidden': 'true' },
    h('div', { class: 'journey__rail' },
      h('span', { class: 'journey__track' }),
      h('span', { class: 'journey__fill' }),
      h('span', { class: 'journey__goal' },
        h('span', { class: 'journey__spark' }),
        h('span', { class: 'journey__spark' }),
        h('span', { class: 'journey__spark' })
      ),
      h('span', { class: 'journey__now' }, h('span', { class: 'journey__pulse' }))
    ),
    days
  );

  let daysKey = '';

  function update(journey) {

    root.dataset.phase = journey.phase;
    root.classList.toggle('journey--far', journey.far);
    root.style.setProperty('--now', journey.nowPos.toFixed(4));
    root.style.setProperty('--goal', journey.meetingPos.toFixed(4));
    root.style.setProperty('--energy', journey.energy.toFixed(3));
    root.style.setProperty('--live', journey.liveProgress === null ? '0' : journey.liveProgress.toFixed(3));

    // the day cells change at most once a day
    const key = journey.days.map(d => `${d.iso}${d.isToday ? '*' : ''}${d.isMeeting ? 'm' : ''}${d.isCancelled ? 'x' : ''}`).join();

    if (key !== daysKey) {
      daysKey = key;
      days.replaceChildren(...journey.days.map(d => h('li', {
        class: ['journey__day', d.isToday && 'is-today', d.isMeeting && 'is-meeting', d.isPassed && 'is-passed', d.isCancelled && 'is-cancelled'].filter(Boolean).join(' ')
      },
      h('span', { class: 'journey__name' }, d.isToday ? 'النهارده' : DAY_SHORT[d.weekday]),
      h('span', { class: 'journey__num' }, arabicDigits(d.day))
      )));
    }

  }

  return { el: root, update };

}
