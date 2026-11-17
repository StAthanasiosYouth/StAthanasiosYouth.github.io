/* W1 review: the «خبزنا اليومي» card inside the live home page (see home-card.html). W5 builds it in assets/js/home.js. */
import { TOPICS, PROGRAM } from '../prototype/data.js';
const q = new URLSearchParams(new URL(import.meta.url).search);
const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const t = TOPICS[+(q.get('t') || 0) % TOPICS.length];
const read = q.get('read') === '1';
const W1 = new URL('./', import.meta.url).href;
function put() {
  if (document.querySelector('.br-home')) return;
  const meet = document.querySelector('.s2-side .widget.meeting, .widget.meeting');
  if (!meet) return;
  const card = document.createElement('a');
  card.className = 'widget br-home';
  card.href = W1 + 'member.html?s=today&intro=1';
  card.setAttribute('aria-label', 'خبزنا اليومي: ' + t.title);
  card.innerHTML = `<img class="br-home__mark" src="${W1}identity/png/icon-192.png" alt="" width="64" height="64">
    <div class="br-home__head"><span class="br-home__name">خبزنا اليومي</span><span class="br-home__chip">اليوم ${AR(PROGRAM.day)} من ${AR(PROGRAM.days)}</span></div>
    <p class="br-home__topic">${t.title}</p>
    <p class="br-home__verse">«${t.verse}» <small>${t.verseRef}</small></p>
    <div class="br-home__acts">${read
      ? `<span class="br-home__done"><svg class="icon icon--line" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>قريتها النهارده</span><span class="btn btn--small br-home__again">افتح تاني</span>`
      : `<span class="btn btn--primary btn--small">اقرا كلمة النهارده<svg class="icon icon--line" viewBox="0 0 24 24"><path d="M19 12H5m6-6-6 6 6 6"/></svg></span>`}</div>`;
  meet.parentNode.insertBefore(card, meet);
  if (!put.done) { put.done = 1; setTimeout(() => card.scrollIntoView({ block: q.get('at') || 'center' }), 500); }
}
new MutationObserver(put).observe(document.documentElement, { childList: true, subtree: true });
put();
