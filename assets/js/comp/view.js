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
  home: ['M4 11 12 4l8 7', 'M6.5 9.5V20h11V9.5']
};

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
    return h('header', { class: `hero${compact ? ' hero--compact' : ''}` },
      media,
      h('p', { class: 'hero__kicker' }, 'مسابقة'),
      compact ? h('p', { class: 'hero__title' }, def.title) : heading(def.title, 'h1', 'hero__title')
    );
  }

  function chips(def) {
    const items = [];
    if (def.questionCount) items.push(countQuestions(def.questionCount));
    if (def.showPoints && def.totalPoints) items.push(countPoints(def.totalPoints));
    if (def.timeLimit) items.push(`الوقت ${countMinutesShort(def.timeLimit)}`);
    if (def.endAt) items.push(`متاحة لحد ${stampText(def.endAt)}`);
    return items.length ? h('ul', { class: 'chips', 'aria-label': 'عن المسابقة' }, items.map(t => h('li', { class: 'chip' }, t))) : null;
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

    return h('div', { class: 'step intro' },
      hero(def),
      h('section', { class: 'card intro__body' },
        chips(def),
        def.description ? h('p', { class: 'intro__desc' }, def.description) : null,
        def.instructions ? h('div', { class: 'note' }, h('h2', { class: 'note__title' }, 'قبل ما تبدأ'), h('p', { class: 'note__text' }, def.instructions)) : null,
        kind === 'open' ? h('p', { class: 'muted' }, 'هتدخل المسابقة بحسابك.') : null,
        status,
        errorBox(m.state.error),
        kind === 'open'
          ? h('div', { class: 'actions actions--sticky' }, btn(def.ctaLabel, m.actions.begin, { kind: 'primary', iconName: 'next', iconAfter: true, 'data-cta': '' }))
          : null,
        kind !== 'open' ? h('div', { class: 'actions' }, h('a', { class: 'btn', href: homeHref }, icon('home'), 'ارجع للموقع')) : null
      )
    );
  }

  /* ---------- questions ---------- */

  function questionBlock(m, q, index, { numbered = false } = {}) {

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
      control = h('div', { class: `choices${q.type === 'truefalse' ? ' choices--tf' : ''}` }, options.map(c => h('label', { class: 'choice' },
        h('input', { type: 'radio', name, value: c.id, checked: value === c.id ? '' : null, required: q.required ? '' : null, onchange: event => onValue(event.target.value) }),
        h('span', { class: 'choice__text' }, c.text)
      )));
    }
    else if (q.type === 'multi') {
      const box = h('div', { class: 'choices' }, q.choices.map(c => h('label', { class: 'choice choice--multi' },
        h('input', { type: 'checkbox', name, value: c.id, checked: Array.isArray(value) && value.includes(c.id) ? '' : null, onchange: () => onValue([...box.querySelectorAll('input:checked')].map(i => i.value)) }),
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
    return h('details', { class: 'jump' },
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
      questionBlock(m, q, index),
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

  function reviewScreen(m) {
    const p = progress(m.questions, m.answers);
    const missing = unanswered(m.questions, m.answers);
    const required = missing.filter(x => x.required);
    return h('section', { class: 'step card review' },
      heading('راجع قبل ما تبعت'),
      h('p', { class: 'review__count' }, `جاوبت ${ar(p.answered)} من ${countQuestions(p.total)}`),
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

    return h('div', { class: 'step result' },
      h('section', { class: 'card result__card', 'aria-labelledby': 'result-t' },
        h('div', { class: 'result__badge', 'aria-hidden': 'true' }, icon(m.result && m.result.status === 'void' ? 'cross' : 'check')),
        h('h1', { class: 'result__title', id: 'result-t', tabindex: '-1', 'data-focus': '' }, summary.headline),
        h('p', { class: 'result__comp' }, m.def.title),
        summary.lines.length ? h('ul', { class: 'result__lines' }, summary.lines.map(l => h('li', { class: `result__line result__line--${l.kind}`, 'data-kind': l.kind }, l.text))) : null,
        m.resultNote ? h('p', { class: 'muted' }, m.resultNote) : null,
        h('div', { class: 'actions' },
          m.canRetry ? btn('حاول مرة تانية', m.actions.again, { kind: 'primary' }) : null,
          h('a', { class: `btn${m.canRetry ? '' : ' btn--primary'}`, href: homeHref }, icon('home'), 'ارجع للموقع'))
      ),
      summary.review ? reviewList(summary.review) : null
    );

  }

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
        timer.replaceChildren(icon('clock'), h('span', { class: 'visually-hidden' }, 'الوقت الباقي: '), h('span', { class: 'cbar__clock', dir: 'ltr' }, m.clock));
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
