/* S4: a sample competition for the live engine's preview mode (shape: docs/COMPETITIONS.md, flow.js sanitizeDefinition).
   Example only («مثال»): nothing like it is published today. */
window.S4_SAMPLE = {
  definition: {
    schema: 1, id: 'c_sample01', slug: 'safar-alamal', v: 'sample1',
    title: 'مسابقة سفر أعمال الرسل',
    shortTitle: 'أعمال الرسل',
    description: 'مسابقة على الإصحاحات من ١ لـ ٨. جاوب، واكسب نقط تبدّلها من متجر «نقاطي».',
    instructions: 'اقرا الإصحاحات من ١ لـ ٨ الأول.\nعندك ١٠ دقايق من أول ما تبدأ.\nكل سؤال ليه نقطه، والنتيجة بتظهر أول ما تخلّص.',
    ctaLabel: 'ابدأ المسابقة',
    theme: '',
    startAt: '2026-11-08T18:00', endAt: '2026-11-20T23:59', resultsAt: '', answersAt: '',
    scoring: true, resultShow: 'both', answersShow: 'immediately', showPoints: true, wallet: true,
    attempts: 1, layout: 'paged', timeLimit: 10,
    successText: 'برافو! إجاباتك وصلت، ونقطك اتضافت لرصيدك.',
    questions: [
      { id: 'q1', type: 'single', text: 'مين اللي اتختار بدل يهوذا الإسخريوطي؟', choices: [{ id: 'a', text: 'متياس' }, { id: 'b', text: 'برنابا' }, { id: 'c', text: 'إسطفانوس' }, { id: 'd', text: 'فيلبس' }], required: true, points: 10 },
      { id: 'q2', type: 'truefalse', text: 'يوم الخمسين نزل الروح القدس على التلاميذ وهما مجتمعين في العلية.', choices: [], required: true, points: 5 },
      { id: 'q3', type: 'multi', text: 'اختار أسماء الشمامسة السبعة اللي في الاختيارات (أكتر من إجابة):', help: 'اختار كل الإجابات الصح.', choices: [{ id: 'a', text: 'إسطفانوس' }, { id: 'b', text: 'فيلبس' }, { id: 'c', text: 'بروخورس' }, { id: 'd', text: 'تيموثاوس' }], required: true, points: 15 },
      { id: 'q4', type: 'number', text: 'كام واحد آمن في يوم الخمسين بعد عظة بطرس؟ (تقريبًا)', required: true, points: 10 },
      { id: 'q5', type: 'short', text: 'إيه اسم الراجل اللي كان مقعد عند باب الهيكل «الجميل»؟ (لو تعرفه)', required: false, points: 0 },
      { id: 'q6', type: 'long', text: 'إيه أكتر آية لمستك في الإصحاحات دي، وليه؟', required: false, points: 0 }
    ]
  },
  result: function (answers) {
    return {
      status: 'graded', submittedAt: '2026-11-10T20:14', score: 35, maxScore: 40, correctCount: 3, gradableCount: 4, pointsAwarded: 35,
      review: [
        { id: 'q1', type: 'single', text: 'مين اللي اتختار بدل يهوذا الإسخريوطي؟', choices: [{ id: 'a', text: 'متياس' }, { id: 'b', text: 'برنابا' }, { id: 'c', text: 'إسطفانوس' }, { id: 'd', text: 'فيلبس' }], answer: (answers && answers.q1) || 'a', correct: 'a', ok: true, pts: 10, explanation: 'أعمال ١: ٢٦ «فوقعت القرعة على متياس».' },
        { id: 'q2', type: 'truefalse', text: 'يوم الخمسين نزل الروح القدس على التلاميذ وهما مجتمعين في العلية.', choices: [], answer: 't', correct: 't', ok: true, pts: 5, explanation: '' },
        { id: 'q3', type: 'multi', text: 'اختار أسماء الشمامسة السبعة اللي في الاختيارات (أكتر من إجابة):', choices: [{ id: 'a', text: 'إسطفانوس' }, { id: 'b', text: 'فيلبس' }, { id: 'c', text: 'بروخورس' }, { id: 'd', text: 'تيموثاوس' }], answer: ['a', 'b'], correct: ['a', 'b', 'c'], ok: false, pts: 10, explanation: 'أعمال ٦: ٥ — تيموثاوس مش منهم.' },
        { id: 'q4', type: 'number', text: 'كام واحد آمن في يوم الخمسين بعد عظة بطرس؟ (تقريبًا)', choices: [], answer: '3000', correct: '3000', ok: true, pts: 10, explanation: 'أعمال ٢: ٤١ «نحو ثلاثة آلاف نفس».' }
      ]
    };
  }
};
