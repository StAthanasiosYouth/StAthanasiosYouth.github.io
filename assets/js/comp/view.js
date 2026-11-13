/**
 * COMPETITION VIEW (DOM)
 *
 * Text only (dom.js h(): strings become text nodes, never HTML), real form
 * controls (radio / checkbox / input / textarea in fieldsets with legends),
 * labels, large touch targets, RTL. Each step gets its own screen; moving
 * to a new step moves the focus to its heading and announces it politely.
 * Typing never re-renders (update() only touches the progress, the jump
 * grid and the clock), so nothing loses focus while answering.
 */

import { h } from '../dom.js';
import {
  ar, countQuestions, countPoints, countMinutesShort, stampText, startsInText, answerText,
  isAnswered, progress, unanswered, resultSummary, LIMITS
} from './flow.js';
import { realMinutesBetween } from '../schedule.js';
import { remindMe } from './remind.js';

/* ---------- small inline icons (static, trusted markup built as nodes) ---------- */

const ICONS = {
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  cross: ['M6 6l12 12M18 6 6 18'],
  clock: ['M12 7.5V12l3 2', 'M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z'],
  next: ['M19 12H5', 'm11 6-6 6 6 6'],
  prev: ['M5 12h14', 'm13 6 6 6-6 6'],
  trophy: ['M7 4h10v5a5 5 0 0 1-10 0Z', 'M7 6H4.5v1.5A3.5 3.5 0 0 0 7.8 11M17 6h2.5v1.5a3.5 3.5 0 0 1-3.3 3.5M12 14v3.5M8.5 20.5h7M9.5 17.5h5v3h-5Z'],
  offline: ['M3 3l18 18', 'M8.5 16.5a5 5 0 0 1 7 0M5 12.6a10 10 0 0 1 5-2.5M19 12.6a10 10 0 0 0-2.3-1.6M2 8.8a15 15 0 0 1 4.5-2.7M22 8.8A15 15 0 0 0 11 5', 'M12 20h.01'],
  lock: ['M6.5 10.5h11v9h-11Z', 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5'],
  home: ['M4 11 12 4l8 7', 'M6.5 9.5V20h11V9.5'],
  gift: ['M4 9.5h16v3H4Z', 'M5.5 12.5V20h13v-7.5M12 9.5V20', 'M12 9.5C10 9.5 7.5 8.8 7.5 7a2 2 0 0 1 4.5-.5v3Zm0 0c2 0 4.5-.7 4.5-2.5a2 2 0 0 0-4.5-.5'],
  bag: ['M5.5 8.5h13l-1 11.5h-11Z', 'M9 8.5V7a3 3 0 0 1 6 0v1.5'],
  list: ['M9 6.5h11M9 12h11M9 17.5h11', 'M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01'],
  logout: ['M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4', 'M10 8l-4 4 4 4M6 12h10'],
  /* site redesign S4 */
  ask: ['M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8h.01', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
  star: ['m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z'],
  watch: ['M12 7v5l3 2', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
  /* the list's cards (comp-list.html): open · coming · finished */
  cup: ['M8 4h8v5a4 4 0 0 1-8 0Z', 'M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M9.5 17h5'],
  book: ['M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3Z', 'M5 16.5a3 3 0 0 1 3-3h11M9 8h6'],
  padlock: ['M7.5 10.5h9a2.5 2.5 0 0 1 2.5 2.5v4.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 17.5V13a2.5 2.5 0 0 1 2.5-2.5Z', 'M8 10.5V8a4 4 0 0 1 8 0v2.5']
};

/* the S4 rings: a track and a stroke that a CSS custom property fills (CSSOM: the CSP blocks style="") */
function ring(cls, r, size) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const on of [false, true]) {
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', String(size / 2));
    c.setAttribute('cy', String(size / 2));
    c.setAttribute('r', String(r));
    c.setAttribute('pathLength', '100');
    if (on) c.setAttribute('class', 'on');
    svg.appendChild(c);
  }
  return svg;
}

const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];

/** «فاضل N أيام» before a deadline (the list page too) */
export function leftText(days) {
  return days === 1 ? 'آخر يوم' : days === 2 ? 'فاضل يومين' : `فاضل ${ar(days)}${days <= 10 ? ' أيام' : ' يوم'}`;
}

/* a count as a tile: ٦ over أسئلة (flow.js's words, the number apart) */
function tileParts(textValue, n) {
  const m = textValue.match(/[٠-٩\d]+/);
  return m ? { num: m[0], label: textValue.replace(m[0], '').trim() } : { num: ar(n), label: textValue.split(' ')[0] };
}

const SVG = 'http://www.w3.org/2000/svg';

export function icon(name, extra = '') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', `ic${extra ? ` ${extra}` : ''}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of ICONS[name] || []) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}


/* =========================================================
   VIEW
========================================================= */

export function createView({ main, live, timer, net, rootUrl, mediaUrl }) {

  let lastKey = '';
  let lastModel = null;

  const resolve = src => mediaUrl(src);
  const homeHref = new URL('index.html', rootUrl).href;

  function picture(image, { className = '', sizes = '(min-width: 760px) 680px, 92vw', eager = false } = {}) {
    if (!image) return null;
    const img = h('img', {
      class: className,
      src: resolve(image.thumb),
      srcset: image.thumb !== image.src ? `${resolve(image.thumb)} 480w, ${resolve(image.src)} 1600w` : null,
      sizes,
      width: image.w,
      height: image.h,
      alt: image.alt || '',
      loading: eager ? null : 'lazy',
      decoding: 'async'
    });
    if (image.color) img.style.backgroundColor = image.color;   // CSSOM (the CSP blocks style="")
    return img;
  }

  function announce(message) {
    if (!live) return;
    live.textContent = '';
    // a fresh text node is announced again even when the words repeat
    setTimeout(() => { live.textContent = message; }, 30);
  }

  const btn = (label, onclick, { kind = '', iconName = '', iconAfter = false, type = 'button', ...attrs } = {}) => h('button', {
    class: `btn${kind ? ` btn--${kind}` : ''}`, type, onclick, ...attrs
  }, !iconAfter && iconName ? icon(iconName) : null, label, iconAfter && iconName ? icon(iconName) : null);

  const heading = (textValue, level = 'h1', cls = 'step__title') => h(level, { class: cls, tabindex: '-1', 'data-focus': '' }, textValue);

  const errorBox = message => (message ? h('p', { class: 'alert', role: 'alert', tabindex: '-1' }, message) : null);

  /* ---------- hero (banner or built-in art) ---------- */

  function hero(def, compact = false) {
    const media = def.banner
      ? h('figure', { class: 'hero__media' }, picture(def.banner, { eager: true, className: 'hero__img' }))
      : h('div', { class: 'hero__art', 'aria-hidden': 'true' }, def.icon ? picture(def.icon, { eager: true, className: 'hero__icon-img', sizes: '96px' }) : icon('trophy', 'hero__icon'));
    if (def.banner && def.banner.w && def.banner.h) media.style.setProperty('--ar', `${def.banner.w} / ${def.banner.h}`);
    return h('header', { class: `hero${compact ? ' hero--compact' : ''}${def.banner ? '' : ' cx-hero'}` },
      media,
      h('p', { class: 'hero__kicker' }, 'مسابقة'),
      compact ? h('p', { class: 'hero__title' }, def.title) : heading(def.title, 'h1', 'hero__title')
    );
  }

  /* S4: the numbers as three tiles (أسئلة · نقطة · دقايق) */
  function stats(def) {
    const items = [];
    if (def.questionCount) items.push(['ask', tileParts(countQuestions(def.questionCount), def.questionCount)]);
    if (def.showPoints && def.totalPoints) items.push(['star', tileParts(countPoints(def.totalPoints), def.totalPoints)]);
    if (def.timeLimit) items.push(['watch', tileParts(countMinutesShort(def.timeLimit), def.timeLimit)]);
    return items.length ? h('ul', { class: 'cx-stats', 'aria-label': 'عن المسابقة' }, items.map(([ic, t]) => h('li', { class: 'cx-stat' },
      h('span', { class: 'cx-stat__ic' }, icon(ic)),
      h('b', { class: 'cx-stat__n' }, t.num),
      h('span', { class: 'cx-stat__l' }, t.label)))) : null;
  }

  /* S4: the deadline, with «فاضل N أيام» while it is open */
  function until(m, kind) {
    const def = m.def;
    if (!def.endAt || kind === 'closed') return null;
    const minutes = kind === 'open' ? realMinutesBetween(m.nowStamp, def.endAt) : null;
    const days = minutes > 0 ? Math.ceil(minutes / 1440) : 0;
    return h('p', { class: 'cx-until' },
      h('span', { class: 'cx-until__ic' }, icon('watch')),
      h('span', {}, `متاحة لحد ${stampText(def.endAt)}`),
      days > 0 ? h('b', { class: 'cx-until__left' }, leftText(days)) : null);
  }

  /* S4: «قبل ما تبدأ» as numbered steps when it has more than one line */
  function instructions(textValue) {
    const lines = String(textValue).split('\n').map(s => s.trim()).filter(Boolean);
    return lines.length > 1
      ? h('ol', { class: 'cx-steps' }, lines.map(l => h('li', {}, l)))
      : h('p', { class: 'note__text' }, textValue);
  }

  /* S4: «فكّرني لما تبدأ» (remind.js) */
  function remindButton(def) {
    const page = new URL(def.slug ? `competition/${def.slug}/` : 'competitions/', rootUrl).href;
    const b = btn('فكّرني لما تبدأ', () => {
      if (!remindMe({ slug: def.slug, title: def.title, startAt: def.startAt, endAt: def.endAt }, page)) return;
      b.textContent = 'هنفكّرك ✓';
      b.disabled = true;
      announce('اتنزّل ملف التذكير، افتحه علشان يتضاف لتقويمك');
    }, { kind: 'primary', class: 'btn btn--primary cx-remind' });
    return b;
  }

  /* =========================================================
     SCREENS
  ========================================================= */

  const screens = {

    loading: () => h('div', { class: 'step step--center', 'aria-busy': 'true' }, h('p', { class: 'muted' }, 'جاري تحميل المسابقة…')),

    unavailable: m => h('section', { class: 'step step--center card' },
      icon('lock', 'step__icon'),
      heading('المسابقة دي مش متاحة دلوقتي'),
      h('p', { class: 'muted' }, m.state.error || 'ممكن تكون اتشالت أو لسه متنشرتش. تابع الموقع علشان تعرف الجديد.'),
      h('a', { class: 'btn btn--primary', href: homeHref }, icon('home'), 'ارجع للموقع')
    ),

    error: m => h('section', { class: 'step step--center card' },
      icon('cross', 'step__icon'),
      heading(m.state.error || 'حصلت مشكلة'),
      m.state.fatal ? null : h('p', { class: 'muted' }, 'جرّب تاني بعد شوية.'),
      m.retryLoad ? btn('جرّب تاني', m.actions.retryLoad, { kind: 'primary' }) : null,
      h('a', { class: 'btn', href: homeHref }, icon('home'), 'ارجع للموقع')
    ),

    intro: m => introScreen(m, 'open'),
    scheduled: m => introScreen(m, 'scheduled'),
    closed: m => introScreen(m, 'closed'),

    entering: () => screens.starting(),

    starting: () => h('div', { class: 'step step--center', 'aria-busy': 'true' }, heading('بنجهز الأسئلة…', 'h1', 'step__title step__title--quiet')),

    question: m => questionScreen(m),

    single: m => singleScreen(m),

    review: m => reviewScreen(m),

    submitting: m => h('div', { class: 'step step--center card', 'aria-busy': 'true' },
      heading(m.state.timeUp ? 'الوقت خلص — بنبعت إجاباتك…' : 'بنبعت إجاباتك…'),
      h('p', { class: 'muted' }, 'ثواني ومتقفلش الصفحة.')
    ),

    queued: m => h('section', { class: 'step step--center card queued' },
      icon('offline', 'step__icon'),
      heading(m.queueReason === 'busy' ? 'فيه ضغط على السيرفر دلوقتي، إجاباتك محفوظة على الموبايل وهنبعتها تاني لوحدنا' : 'النت فاصل، إجاباتك محفوظة على الموبايل وهتتبعت أول ما يرجع'),
      h('p', { class: 'muted' }, m.state.timeUp ? 'الوقت خلص، وإجاباتك اتقفلت زي ما هي.' : 'سيب الصفحة مفتوحة أو ارجعلها بعدين، هتتبعت لوحدها.'),
      btn('جرّب دلوقتي', m.actions.retrySubmit, { kind: 'primary' })
    ),

    result: m => resultScreen(m)

  };

  /* ---------- intro / scheduled / closed ---------- */

  function introScreen(m, kind) {
    const def = m.def;
    const status = kind === 'scheduled'
      ? h('div', { class: 'status status--soon', role: 'status' },
        icon('clock'),
        h('p', {}, h('strong', { 'data-countdown': '' }, startsInText(m.startsIn)), h('span', {}, stampText(def.startAt))))
      : kind === 'closed'
        ? h('div', { class: 'status status--closed', role: 'status' },
          icon('lock'),
          h('p', {}, h('strong', {}, 'المسابقة خلصت'),
            m.receipt ? h('span', {}, 'بنجيب نتيجتك…') : def.resultsAt && m.nowStamp < def.resultsAt && def.resultShow !== 'none' ? h('span', {}, `النتايج هتظهر ${stampText(def.resultsAt)}`) : h('span', {}, 'شكرًا لكل اللي شاركوا.')))
        : null;

    // S4: the status is the news, so it leads the card; «فكّرني» before a start; a finished one drops its instructions and deadline
    return h('div', { class: 'step intro' },
      hero(def),
      h('section', { class: 'card intro__body' },
        status,
        kind === 'scheduled' && def.startAt ? remindButton(def) : null,
        stats(def),
        until(m, kind),
        def.description ? h('p', { class: 'intro__desc' }, def.description) : null,
        def.instructions && kind !== 'closed' ? h('div', { class: 'note' }, h('h2', { class: 'note__title' }, 'قبل ما تبدأ'), instructions(def.instructions)) : null,
        kind === 'open' ? h('p', { class: 'muted' }, 'هتدخل المسابقة بحسابك.') : null,
        errorBox(m.state.error),
        kind === 'open' && def.wallet && def.showPoints && def.totalPoints
          ? h('p', { class: 'cx-reward' }, h('span', {}, icon('star')), h('span', {},`اكسب لحد ${countPoints(def.totalPoints)} تتضاف لرصيدك في «نقاطي»`))
          : null,
        kind === 'open'
          ? h('div', { class: 'actions actions--sticky' }, btn(def.ctaLabel, m.actions.begin, { kind: 'primary', iconName: 'next', iconAfter: true, 'data-cta': '' }))
          : null,
        kind !== 'open' ? h('div', { class: 'actions' }, h('a', { class: 'btn', href: homeHref }, icon('home'), 'ارجع للموقع')) : null
      )
    );
  }

  /* ---------- questions ---------- */

  function questionBlock(m, q, index, { numbered = false, badge = false } = {}) {

    const value = m.answers[q.id];
    const pts = m.comp && m.comp.showPoints && q.points ? h('span', { class: 'q__pts' }, countPoints(q.points)) : null;
    const errorId = `q-${q.id}-err`;
    const helpId = q.help ? `q-${q.id}-help` : null;
    const error = m.state.error && (m.state.index === index || m.state.focus === index) ? m.state.error : (m.answerErrors || {})[q.id] || '';
    const num = numbered ? h('span', { class: 'q__num' }, `${ar(index + 1)}. `) : null;

    if (q.type === 'info') {
      return h('section', { class: 'q q--info card', 'data-q': q.id, 'aria-labelledby': `q-${q.id}-t` },
        h('h2', { class: 'q__text', id: `q-${q.id}-t`, tabindex: '-1', 'data-qfocus': String(index) }, q.text),
        q.help ? h('p', { class: 'q__help' }, q.help) : null,
        q.media ? h('figure', { class: 'q__media' }, picture(q.media)) : null
      );
    }

    const onValue = v => m.actions.answer(q.id, v);
    let control;
    const name = `a-${q.id}`;

    if (q.type === 'single' || q.type === 'truefalse') {
      const options = q.type === 'truefalse' ? [{ id: 't', text: 'صح' }, { id: 'f', text: 'غلط' }] : q.choices;
      control = h('div', { class: `choices${q.type === 'truefalse' ? ' choices--tf' : ''}` }, options.map((c, i) => h('label', { class: 'choice' },
        h('input', { type: 'radio', name, value: c.id, checked: value === c.id ? '' : null, required: q.required ? '' : null, onchange: event => onValue(event.target.value) }),
        h('span', { class: 'cx-letter', 'aria-hidden': 'true' }, LETTERS[i] || ''),
        h('span', { class: 'choice__text' }, c.text)
      )));
    }
    else if (q.type === 'multi') {
      const box = h('div', { class: 'choices' }, q.choices.map((c, i) => h('label', { class: 'choice choice--multi' },
        h('input', { type: 'checkbox', name, value: c.id, checked: Array.isArray(value) && value.includes(c.id) ? '' : null, onchange: () => onValue([...box.querySelectorAll('input:checked')].map(x => x.value)) }),
        h('span', { class: 'cx-letter', 'aria-hidden': 'true' }, LETTERS[i] || ''),
        h('span', { class: 'choice__text' }, c.text)
      )));
      control = h('div', {}, h('p', { class: 'q__hint' }, 'ممكن تختار أكتر من إجابة'), box);
    }
    else if (q.type === 'long') {
      control = h('textarea', { class: 'field__input field__input--long', id: name, name, rows: '5', maxlength: String(LIMITS.long), 'aria-labelledby': `q-${q.id}-t`, 'aria-describedby': [helpId, error ? errorId : ''].filter(Boolean).join(' ') || null, required: q.required ? '' : null, oninput: event => onValue(event.target.value) });
      control.value = typeof value === 'string' ? value : '';
    }
    else {
      control = h('input', {
        class: `field__input${q.type === 'number' ? ' field__input--num' : ''}`, id: name, name, type: 'text',
        inputmode: q.type === 'number' ? 'decimal' : null, dir: q.type === 'number' ? 'ltr' : null, autocomplete: 'off',
        maxlength: String(q.type === 'number' ? LIMITS.number : LIMITS.short), 'aria-labelledby': `q-${q.id}-t`,
        'aria-describedby': [helpId, error ? errorId : ''].filter(Boolean).join(' ') || null, 'aria-invalid': error ? 'true' : null,
        required: q.required ? '' : null, value: typeof value === 'string' ? value : '', oninput: event => onValue(event.target.value)
      });
    }

    const grouped = q.type === 'single' || q.type === 'truefalse' || q.type === 'multi';

    return h(grouped ? 'fieldset' : 'div', {
      class: `q card${error ? ' has-error' : ''}`, 'data-q': q.id,
      'aria-describedby': grouped ? ([helpId, error ? errorId : ''].filter(Boolean).join(' ') || null) : null
    },
    h(grouped ? 'legend' : 'p', { class: 'q__text', id: `q-${q.id}-t`, tabindex: '-1', 'data-qfocus': String(index) },
      num, q.text,
      q.required ? h('span', { class: 'req' }, ' (مطلوب)') : null),
    badge ? h('span', { class: 'cx-qnum', 'aria-hidden': 'true' }, ar(index + 1)) : null,
    pts,
    q.help ? h('p', { class: 'q__help', id: helpId }, q.help) : null,
    q.media ? h('figure', { class: 'q__media' }, picture(q.media)) : null,
    control,
    error ? h('p', { class: 'field__error', id: errorId, role: 'alert' }, error) : null
    );

  }

  function progressBlock(m, index) {
    const p = progress(m.questions, m.answers);
    const total = m.questions.length;
    const label = index === undefined ? `جاوبت ${ar(p.answered)} من ${ar(p.total)}` : `سؤال ${ar(index + 1)} من ${ar(total)}`;
    const ratio = index === undefined ? (p.total ? p.answered / p.total : 0) : (index + 1) / total;
    const bar = h('div', { class: 'progress__bar' });
    bar.style.setProperty('--p', String(Math.round(ratio * 1000) / 1000));
    return h('div', { class: 'progress' },
      h('p', { class: 'progress__text' }, h('span', { 'data-progress-step': '' }, label),
        index === undefined ? null : h('span', { class: 'progress__answered', 'data-progress-answered': '' }, `جاوبت ${ar(p.answered)} من ${ar(p.total)}`)),
      h('div', { class: 'progress__track', role: 'progressbar', 'aria-label': 'التقدم', 'aria-valuemin': '0', 'aria-valuemax': String(index === undefined ? p.total : total), 'aria-valuenow': String(index === undefined ? p.answered : index + 1), 'data-progress-bar': '' }, bar)
    );
  }

  function jumpGrid(m, current) {
    // S4: the numbers always on show (the toggle hidden by comp.css), the answered ones filled
    return h('details', { class: 'jump cx-jump', open: '' },
      h('summary', { class: 'jump__toggle' }, 'كل الأسئلة'),
      h('nav', { 'aria-label': 'الأسئلة' },
        h('ol', { class: 'jump__grid' }, m.questions.map((q, i) => {
          const done = q.type === 'info' || isAnswered(q, m.answers[q.id]);
          return h('li', {}, h('button', {
            type: 'button',
            class: `jump__btn${done ? ' is-done' : ''}${i === current ? ' is-current' : ''}`,
            'aria-current': i === current ? 'step' : null,
            'aria-label': `سؤال ${ar(i + 1)}${q.type === 'info' ? '' : done ? '، متجاوب' : '، لسه'}`,
            'data-jump': String(i),
            onclick: () => m.actions.jump(i)
          }, ar(i + 1)));
        }))
      )
    );
  }

  function questionScreen(m) {
    const index = m.state.index;
    const q = m.questions[index];
    const last = index === m.questions.length - 1;
    return h('div', { class: 'step step--q' },
      h('div', { class: 'qhead' }, h('h1', { class: 'qhead__title' }, m.def.title), progressBlock(m, index), jumpGrid(m, index)),
      questionBlock(m, q, index, { badge: true }),
      h('div', { class: 'actions actions--bar' },
        index > 0 ? btn('السابق', m.actions.prev, { iconName: 'prev' }) : h('span', { class: 'actions__spacer' }),
        btn(last ? 'راجع إجاباتك' : 'التالي', m.actions.next, { kind: 'primary', iconName: 'next', iconAfter: true, 'data-next': '' })
      )
    );
  }

  function singleScreen(m) {
    return h('div', { class: 'step step--single' },
      hero(m.def, true),
      h('div', { class: 'qhead' }, progressBlock(m)),
      h('h1', { class: 'visually-hidden', tabindex: '-1', 'data-focus': '' }, `أسئلة ${m.def.title}`),
      m.questions.map((q, i) => questionBlock(m, q, i, { numbered: q.type !== 'info' })),
      h('div', { class: 'actions actions--bar' }, btn('راجع وابعت', m.actions.review, { kind: 'primary', iconName: 'next', iconAfter: true, 'data-next': '' }))
    );
  }

  /* S4: a ring of how many are answered («٥ من ٦») */
  function donut(done, total) {
    const svg = ring('cx-donut__ring', 52, 120);
    svg.lastChild.style.setProperty('--to', String(total ? 100 - (done / total) * 100 : 100));
    return h('div', { class: 'cx-donut', 'aria-hidden': 'true' }, svg, h('b', {}, ar(done), h('small', {}, `من ${ar(total)}`)));
  }

  function reviewScreen(m) {
    const p = progress(m.questions, m.answers);
    const missing = unanswered(m.questions, m.answers);
    const required = missing.filter(x => x.required);
    return h('section', { class: 'step card review' },
      heading('راجع قبل ما تبعت'),
      donut(p.answered, p.total),
      h('p', { class: 'review__count' },`جاوبت ${ar(p.answered)} من ${countQuestions(p.total)}`),
      missing.length
        ? h('div', {},
          h('h2', { class: 'review__sub' }, required.length ? 'فيه أسئلة لسه متجاوبتش (المطلوب لازم يتجاوب):' : 'الأسئلة دي لسه متجاوبتش:'),
          h('ul', { class: 'review__list' }, missing.map(x => h('li', {}, h('button', {
            type: 'button', class: `review__item${x.required ? ' is-required' : ''}`, 'data-missing': String(x.index), onclick: () => m.actions.jump(x.index)
          }, h('span', { class: 'review__num' }, `سؤال ${ar(x.index + 1)}`), h('span', { class: 'review__q' }, m.questions[x.index].text), x.required ? h('span', { class: 'req' }, 'مطلوب') : null)))))
        : h('p', { class: 'ok-line' }, icon('check'), 'جاوبت على كل الأسئلة'),
      errorBox(m.state.error),
      m.confirming
        ? h('div', { class: 'confirm', role: 'group', 'aria-labelledby': 'confirm-t' },
          h('p', { class: 'confirm__text', id: 'confirm-t', tabindex: '-1' }, 'متأكد؟ بعد ما تبعت مش هتقدر تغيّر إجاباتك.'),
          h('div', { class: 'actions' },
            btn('أيوه، ابعت', m.actions.confirmSubmit, { kind: 'primary', 'data-confirm': '' }),
            btn('لسه', m.actions.cancelSubmit)))
        : h('div', { class: 'actions' },
          btn('ابعت الإجابات', m.actions.submit, { kind: 'primary', 'data-submit': '' }),
          btn('ارجع للأسئلة', m.actions.prev, { iconName: 'prev' }))
    );
  }

  /* ---------- result ---------- */

  function resultScreen(m) {

    if (m.resultLoading) {
      return h('div', { class: 'step step--center card', 'aria-busy': 'true' }, heading('إجاباتك وصلت ✓'), h('p', { class: 'muted' }, 'بنجيب نتيجتك…'));
    }

    const summary = resultSummary(m.result, m.def, { noPoints: !!m.noPoints });
    const r = m.result || {};
    // S4: a score ring that fills, «+٣٥ نقطة · اتضافت لرصيدك», «روح لنقاطي», a short gold burst
    const scored = summary.lines.some(l => l.kind === 'score') && Number(r.maxScore) > 0;
    const earned = summary.lines.some(l => l.kind === 'points');
    let badge = h('div', { class: 'result__badge', 'aria-hidden': 'true' }, icon(r.status === 'void' ? 'cross' : 'check'));
    if (scored) {
      const svg = ring('cx-score__ring', 68, 160);
      const defs = document.createElementNS(SVG, 'defs');
      const grad = document.createElementNS(SVG, 'linearGradient');
      for (const [k, v] of [['id', 'cx-score-g'], ['x1', '0'], ['y1', '0'], ['x2', '1'], ['y2', '1']]) grad.setAttribute(k, v);
      for (const [o, c] of [['0', 'var(--gold-hi)'], ['1', 'var(--gold)']]) {
        const stop = document.createElementNS(SVG, 'stop');
        stop.setAttribute('offset', o);
        stop.setAttribute('stop-color', c);
        grad.appendChild(stop);
      }
      defs.appendChild(grad);
      svg.prepend(defs);
      svg.lastChild.style.setProperty('--to', String(100 - Math.max(0, Math.min(1, r.score / r.maxScore)) * 100));
      badge = h('div', { class: 'cx-score', 'aria-hidden': 'true' }, svg, h('b', {}, ar(r.score), h('small', {}, `من ${ar(r.maxScore)}`)));
    }
    const lines = summary.lines.map(l => {
      if (l.kind === 'score' && scored) return h('li', { class: 'result__line result__line--score visually-hidden', 'data-kind': l.kind }, l.text);
      if (l.kind === 'points') {
        return h('li', { class: 'result__line result__line--earned', 'data-kind': l.kind },
          h('p', { class: 'cx-earned' }, h('span', {}, icon('star')), h('b', {}, `+${ar(r.pointsAwarded)} نقطة`), h('span', {}, 'اتضافت لرصيدك')));
      }
      return h('li', { class: `result__line result__line--${l.kind}`, 'data-kind': l.kind }, l.text);
    });

    const card = h('section', { class: 'card result__card', 'aria-labelledby': 'result-t' },
      badge,
      h('h1', { class: 'result__title', id: 'result-t', tabindex: '-1', 'data-focus': '' }, summary.headline),
      h('p', { class: 'result__comp' }, m.def.title),
      lines.length ? h('ul', { class: 'result__lines' }, lines) : null,
      m.resultNote ? h('p', { class: 'muted' }, m.resultNote) : null,
      h('div', { class: 'actions' },
        earned ? h('a', { class: 'btn cx-points', href: new URL('points/', rootUrl).href }, 'روح لنقاطي') : null,
        m.canRetry ? btn('حاول مرة تانية', m.actions.again, { kind: 'primary' }) : null,
        h('a', { class: `btn${m.canRetry ? '' : ' btn--primary'}`, href: homeHref }, icon('home'), 'ارجع للموقع'))
    );
    if (scored || earned) burst(card);

    return h('div', { class: 'step result' }, card, summary.review ? reviewList(summary.review) : null);

  }

  /* the gold burst when the result shows (once per drawing; none with «تقليل الحركة») */
  let burstKey = '';
  function burst(card) {
    const key = `${m0(lastModel)}`;
    if (key === burstKey || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    burstKey = key;
    const b = h('div', { class: 'cx-burst', 'aria-hidden': 'true' });
    for (let i = 0; i < 26; i++) {
      const p = h('i');
      p.style.setProperty('--a', `${(i * 360) / 26}deg`);
      p.style.setProperty('--d', `${60 + (i % 5) * 22}px`);
      p.style.setProperty('--t', `${(i % 3) * 60}ms`);
      b.appendChild(p);
    }
    card.appendChild(b);
    setTimeout(() => b.remove(), 1600);
  }
  const m0 = m => (m && m.result ? `${m.result.submittedAt || ''}:${m.result.score ?? ''}` : '');

  function reviewList(items) {
    return h('section', { class: 'answers', 'aria-labelledby': 'answers-t' },
      h('h2', { class: 'answers__title', id: 'answers-t' }, 'الإجابات'),
      h('ol', { class: 'answers__list' }, items.map((item, i) => {
        const mine = answerText(item, item.answer);
        const right = answerText(item, item.correct);
        const mark = item.ok === true ? 'ok' : item.ok === false ? 'no' : 'wait';
        return h('li', { class: `answer card answer--${mark}`, 'data-review': item.id },
          h('p', { class: 'answer__head' },
            h('span', { class: 'answer__mark', 'aria-hidden': 'true' }, mark === 'ok' ? '✓' : mark === 'no' ? '✕' : '…'),
            h('span', { class: 'visually-hidden' }, mark === 'ok' ? 'إجابة صح: ' : mark === 'no' ? 'إجابة غلط: ' : 'بتتراجع: '),
            h('span', { class: 'answer__q' }, `${ar(i + 1)}. ${item.text}`)),
          item.media ? h('figure', { class: 'q__media' }, picture(item.media)) : null,
          item.type === 'info' ? null : h('p', { class: 'answer__row' }, h('span', { class: 'answer__label' }, 'إجابتك: '), mine || 'مجاوبتش'),
          right && item.ok !== true ? h('p', { class: 'answer__row answer__row--right' }, h('span', { class: 'answer__label' }, 'الإجابة الصح: '), right) : null,
          item.pts !== null && item.type !== 'info' ? h('p', { class: 'answer__pts' }, countPoints(item.pts)) : null,
          item.explanation ? h('p', { class: 'answer__why' }, item.explanation) : null,
          item.explanationMedia ? h('figure', { class: 'q__media' }, picture(item.explanationMedia)) : null
        );
      }))
    );
  }

  /* =========================================================
     RENDER / UPDATE
  ========================================================= */

  /** draws the step; moves the focus + announces when the step changed */
  function render(m) {

    lastModel = m;
    const key = `${m.state.name}:${m.state.index ?? ''}:${m.state.focus ?? ''}`;
    const changed = key !== lastKey;
    const keepScroll = !changed;
    const scroll = keepScroll ? window.scrollY : 0;

    main.dataset.state = m.state.name;
    main.replaceChildren((screens[m.state.name] || screens.error)(m));

    if (keepScroll) window.scrollTo(0, scroll);

    if (changed && m.focus !== false) {
      const target = m.state.focus !== undefined
        ? main.querySelector(`[data-qfocus="${m.state.focus}"]`)
        : m.state.name === 'question'
          ? main.querySelector(`[data-qfocus="${m.state.index}"]`)
          : main.querySelector('[data-focus]');
      if (target) {
        if (m.state.focus !== undefined) target.scrollIntoView({ block: 'start', behavior: 'auto' });
        else window.scrollTo(0, 0);
        target.focus({ preventScroll: true });
      }
      if (m.state.name === 'question') announce(`سؤال ${ar(m.state.index + 1)} من ${ar(m.questions.length)}`);
    }
    else if (m.state.error) {
      const alert = main.querySelector('[aria-invalid="true"], .has-error input, .alert');
      if (alert && alert.focus) alert.focus({ preventScroll: false });
    }

    lastKey = key;
    update(m);

  }

  /** progress, jump grid, clock, connection — never rebuilds the step */
  function update(m = lastModel) {

    if (!m) return;

    if (m.questions && m.questions.length) {
      const p = progress(m.questions, m.answers);
      const answered = main.querySelector('[data-progress-answered]');
      if (answered) answered.textContent = `جاوبت ${ar(p.answered)} من ${ar(p.total)}`;
      if (m.state.name === 'single') {
        const step = main.querySelector('[data-progress-step]');
        if (step) step.textContent = `جاوبت ${ar(p.answered)} من ${ar(p.total)}`;
        const track = main.querySelector('[data-progress-bar]');
        if (track) {
          track.setAttribute('aria-valuenow', String(p.answered));
          track.firstElementChild.style.setProperty('--p', String(p.total ? Math.round((p.answered / p.total) * 1000) / 1000 : 0));
        }
      }
      for (const button of main.querySelectorAll('[data-jump]')) {
        const i = Number(button.dataset.jump);
        const q = m.questions[i];
        const done = q.type === 'info' || isAnswered(q, m.answers[q.id]);
        button.classList.toggle('is-done', done);
        button.setAttribute('aria-label', `سؤال ${ar(i + 1)}${q.type === 'info' ? '' : done ? '، متجاوب' : '، لسه'}`);
      }
    }

    const countdown = main.querySelector('[data-countdown]');
    if (countdown && m.startsIn !== undefined) countdown.textContent = startsInText(m.startsIn);

    if (timer) {
      const showClock = typeof m.clock === 'string' && ['question', 'single', 'review'].includes(m.state.name);
      timer.hidden = !showClock;
      if (showClock) {
        // S4: a ring that empties with the time (built once, so its 1 s transition runs)
        let clock = timer.querySelector('.cbar__clock');
        if (!clock || !timer.querySelector('.cx-ring')) {
          clock = h('span', { class: 'cbar__clock', dir: 'ltr' });
          timer.replaceChildren(ring('cx-ring', 15, 36), h('span', { class: 'visually-hidden' }, 'الوقت الباقي: '), clock);
        }
        clock.textContent = m.clock;
        const limit = m.def && m.def.timeLimit ? m.def.timeLimit * 60000 : 0;
        if (limit && Number.isFinite(m.clockLeft)) {
          timer.querySelector('.cx-ring .on').style.setProperty('--to', String(100 - Math.max(0, Math.min(1, m.clockLeft / limit)) * 100));
        }
        timer.classList.toggle('is-low', !!m.clockLow);
      }
    }

    if (net) {
      net.hidden = m.online !== false || m.state.name === 'queued';
      if (!net.hidden) net.textContent = 'النت فاصل دلوقتي — إجاباتك بتتحفظ على الموبايل.';
    }

  }

  /* building blocks for other pages of the engine (portal.js «نقاطي») */
  const parts = {
    icon, picture, btn, heading, errorBox, reviewList,
    homeHref
  };

  return { render, update, announce, parts };

}
