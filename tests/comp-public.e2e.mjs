// The competition engine (competition/index.html + assets/js/comp/*) in
// headless Chrome, against a MOCK of the public API (§5: compStart,
// compSubmit, compResult, compCode) answered in the browser the way Apps
// Script does it (POST → 302 → googleusercontent echo). comp.json fixtures
// come from tests/fixtures/comp/ through this test's own server (never
// committed into competition/); stubs are made from the shell exactly like
// the publisher does (="../ → ="../../, <html data-slug>).
//
// Run: cd tools && node --test ../tests/comp-public.e2e.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT } from '../tools/lib/gs.mjs';
import { PUSH_CONFIG } from '../assets/js/push-config.js';
import { zonedNow, stamp, addMinutes } from '../assets/js/schedule.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 4961;
const BASE = `http://localhost:${PORT}`;
const API = PUSH_CONFIG.apiUrl;
const SHOTS = `${ROOT}tools/.cache/comp/`;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const PHONE = { width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1 };
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

const FIX = `${ROOT}tests/fixtures/comp/`;
const BASE_DEF = JSON.parse(readFileSync(`${FIX}quiz.json`, 'utf8'));
const QUESTIONS = JSON.parse(readFileSync(`${FIX}quiz.questions.json`, 'utf8'));
const SHELL = readFileSync(`${ROOT}competition/index.html`, 'utf8');

const now = () => stamp(zonedNow('Africa/Cairo'));


/* =========================================================
   FIXTURES (dates relative to now, Cairo wall time)
========================================================= */

function definitions() {
  const t = now();
  return {
    quiz: BASE_DEF,
    'quiz-single': { ...BASE_DEF, slug: 'quiz-single', id: 'cmp-single01', layout: 'single', resultShow: 'score', answersShow: 'never', showPoints: '', theme: 'emerald' },
    'quiz-closed': { ...BASE_DEF, slug: 'quiz-closed', id: 'cmp-closed01', startAt: addMinutes(t, -2880), endAt: addMinutes(t, -60), resultsAt: addMinutes(t, 1440) },
    'quiz-soon': { ...BASE_DEF, slug: 'quiz-soon', id: 'cmp-soon0001', startAt: addMinutes(t, 3 * 1440 + 120), endAt: addMinutes(t, 5 * 1440), theme: 'rose' },
    'quiz-reg': { ...BASE_DEF, slug: 'quiz-reg', id: 'cmp-reg00001', participation: 'registered', resultShow: 'points', wallet: '1', answersShow: 'never', theme: 'gold' },
    'quiz-timed': { ...BASE_DEF, slug: 'quiz-timed', id: 'cmp-timed001', timeLimit: 1, answersShow: 'never' },
    'quiz-gone': { schema: 1, slug: 'quiz-gone', withdrawn: true }
  };
}

/** the main site's content.json + a competitions card, a bell item and the index */
function siteContent() {
  const t = now();
  const content = JSON.parse(readFileSync(`${ROOT}content.json`, 'utf8'));
  content.types = [{ key: 'competition', label: 'مسابقة', icon: 'trophy', theme: 'gold', banner: null }];
  content.activities = [{
    id: 'act-quiz0001', type: 'competition', section: 'competitions', title: 'مسابقة يونان', subtitle: 'جاوب واكسب',
    description: '', image: null, cta: { label: 'ادخل المسابقة', url: 'https://example.org/old-form' },
    location: '', startAt: addMinutes(t, -60), endAt: addMinutes(t, 3 * 1440), visibleFrom: '', visibleUntil: '', competition: 'quiz'
  }];
  content.notifications = [{
    id: 'notif-act-quiz0001', type: 'competition', title: 'مسابقة يونان فتحت', message: 'ادخل جاوب دلوقتي',
    target: { kind: 'competition', slug: 'quiz' }, image: null, publishAt: addMinutes(t, -30), expireAt: ''
  }];
  content.competitions = [{ id: 'cmp-quiz0001', slug: 'quiz', title: BASE_DEF.title, shortTitle: BASE_DEF.shortTitle, startAt: '', endAt: '', v: BASE_DEF.v }];
  return content;
}

/* exactly what the publisher's compStubHtml_ must do (plus its own head tags) */
export function stubFromShell(html, slug) {
  return html.replace(/(\s(?:href|src)=")\.\.\//g, '$1../../').replace('<html lang="ar" dir="rtl">', `<html lang="ar" dir="rtl" data-slug="${slug}">`);
}

const PREVIEW_PARENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>preview parent</title></head>
<body><iframe id="frame" title="preview" src="/competition/index.html?preview" width="390" height="800"></iframe>
<script>
window.msgs = [];
window.grade = { status: 'graded', score: 7, maxScore: 10, correctCount: 2, gradableCount: 3 };
addEventListener('message', function (e) {
  if (e.origin !== location.origin) return;
  window.msgs.push(e.data);
  if (e.data && e.data.type === 'athanasios:comp-preview-submit') {
    window.lastSubmit = e.data;
    e.source.postMessage({ type: 'athanasios:comp-preview-result', id: e.data.id, result: window.grade }, location.origin);
  }
});
</script></body></html>`;


/* =========================================================
   SERVER (site files + test-only fixture routes)
========================================================= */

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.ics': 'text/calendar' };
const PRIVATE = /^\/(apps-script|tools|tests|docs|node_modules)(\/|$)|\/\.|\.md$/i;

let server;
let browser;
let served = [];

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    served.push(path);
    const defs = definitions();
    let m;
    if (path === '/__test/preview-parent.html') return send(res, 200, TYPES['.html'], PREVIEW_PARENT);
    if (path === '/content.json') return send(res, 200, TYPES['.json'], JSON.stringify(siteContent()));
    if ((m = /^\/competition\/([a-z0-9-]+)\/(index\.html)?$/.exec(path)) && defs[m[1]]) return send(res, 200, TYPES['.html'], stubFromShell(SHELL, m[1]));
    if ((m = /^\/competition\/([a-z0-9-]+)\/comp\.json$/.exec(path))) {
      return defs[m[1]] ? send(res, 200, TYPES['.json'], JSON.stringify(defs[m[1]])) : send(res, 404, 'text/plain', '404');
    }
    try {
      if (PRIVATE.test(path)) throw new Error('private');
      const file = normalize(join(ROOT, path.endsWith('/') ? `${path}index.html` : path));
      if (!file.startsWith(normalize(ROOT)) || !statSync(file).isFile()) throw new Error('no');
      return send(res, 200, TYPES[extname(file)] || 'application/octet-stream', readFileSync(file));
    }
    catch {
      return send(res, 404, 'text/plain', '404');
    }
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  server?.close();
});


/* =========================================================
   MOCK API (the contract's public actions, with fixture data)
========================================================= */

const digits = s => String(s).replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x660));

function createMock({ busyOnce = false, timedMs = 6000 } = {}) {

  const defs = definitions();
  const mock = { calls: [], attempts: new Map(), results: new Map(), busyOnce, offline: false, outside: [] };
  let seq = 0;

  const publicQuestions = def => QUESTIONS.map(q => ({
    id: q.id, type: q.type, text: q.text, help: q.help, media: q.media, choices: q.choices, required: q.required === '1',
    ...(def.showPoints === '1' ? { points: q.points } : {})
  }));

  function grade(def, answers) {
    let score = 0; let maxScore = 0; let correctCount = 0; let gradableCount = 0; let pending = 0;
    const review = [];
    for (const q of QUESTIONS) {
      if (q.type === 'info') continue;
      gradableCount += 1;
      maxScore += q.points;
      const a = answers[q.id];
      let ok = false;
      if (a === undefined || a === '' || (Array.isArray(a) && !a.length)) ok = false;
      else if (q.type === 'multi') ok = [...a].sort().join() === [...q.correct].sort().join();
      else if (q.type === 'short') ok = q.correct.includes(String(a).trim()) ? true : (q.review === 'fallback' ? null : false);
      else if (q.type === 'number') ok = Number(digits(a)) === Number(q.correct);
      else if (q.type === 'long') ok = null;
      else ok = a === q.correct;
      const pts = ok === true ? q.points : 0;
      if (ok === true) { score += pts; correctCount += 1; }
      if (ok === null) pending += 1;
      review.push({ id: q.id, type: q.type, text: q.text, media: q.media, choices: q.choices, answer: a ?? null, correct: q.correct, ok, pts, explanation: q.explanation, explanationMedia: null });
    }
    const result = { status: pending ? 'pending_review' : 'graded', submittedAt: now() };
    if (def.resultShow === 'score' || def.resultShow === 'both') Object.assign(result, { score, maxScore, correctCount, gradableCount, pending });
    if ((def.resultShow === 'points' || def.resultShow === 'both') && def.wallet === '1' && !pending) result.pointsAwarded = score * 10;
    if (def.answersShow === 'immediately') result.review = review;
    else if (def.answersShow === 'atDate') result.answersAt = addMinutes(now(), 1440);
    return result;
  }

  mock.post = body => {
    const { fn, args } = JSON.parse(body);
    const arg = args[0] || {};
    mock.calls.push({ fn, arg });

    if (fn === 'compCode') {
      return digits(arg.code).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^ATH/, '') === '2345678A'
        ? { ok: true, participant: { name: 'مينا عادل', group: 'ثانوي' }, ptoken: 'pt1.good.sig' }
        : { ok: false, code: 'code', message: 'الكود ده مش صح، راجع الحروف والأرقام.' };
    }

    if (fn === 'compStart') {
      const def = defs[arg.slug];
      if (!def || def.withdrawn) return { ok: false, code: 'not_found', message: 'المسابقة مش موجودة' };
      if (def.endAt && now() > def.endAt) return { ok: false, code: 'closed', message: 'المسابقة خلصت' };
      if (def.participation === 'registered' && arg.ptoken !== 'pt1.good.sig') return { ok: false, code: 'session', message: 'سجّل بالكود تاني' };
      if (arg.hp) return { ok: false, code: 'bad', message: 'x' };
      const existing = mock.attempts.get(arg.clientKey);
      const attempt = existing || { token: `at1.${++seq}.sig`, id: `s-${seq}`, startedAt: now(), deadlineMs: def.timeLimit ? Date.now() + timedMs : 0, slug: arg.slug };
      mock.attempts.set(arg.clientKey, attempt);
      return {
        ok: true,
        attempt: { token: attempt.token, id: attempt.id, startedAt: attempt.startedAt, deadlineMs: attempt.deadlineMs, resumed: !!existing },
        comp: { v: def.v, layout: def.layout, showPoints: def.showPoints === '1', timeLimit: def.timeLimit, total: QUESTIONS.length },
        questions: publicQuestions(def)
      };
    }

    if (fn === 'compSubmit') {
      if (mock.busyOnce) {
        mock.busyOnce = false;
        return { ok: false, code: 'busy', message: 'ضغط' };
      }
      const attempt = [...mock.attempts.values()].find(a => a.token === arg.token);
      if (!attempt) return { ok: false, code: 'expired', message: 'انتهت' };
      if (!mock.results.has(attempt.token)) {
        const result = grade(defs[attempt.slug], arg.answers || {});
        mock.results.set(attempt.token, { receipt: `rc1.${attempt.id}.sig`, result });
      }
      return { ok: true, ...mock.results.get(attempt.token) };
    }

    if (fn === 'compResult') {
      const found = [...mock.results.values()].find(r => r.receipt === arg.receipt);
      return found ? { ok: true, result: found.result } : { ok: false, code: 'not_found', message: '' };
    }

    return { ok: false, code: 'bad', message: 'unknown' };
  };

  mock.fns = name => mock.calls.filter(c => c.fn === name);

  return mock;

}


/* =========================================================
   PAGES
========================================================= */

async function open(path, { viewport = PHONE, mock = createMock(), bypassCSP = false, reducedMotion = true } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const echoes = new Map();
  let echo = 0;

  page.on('console', msg => { if (msg.type() === 'error' && /CSP|Content Security|Refused/i.test(msg.text())) problems.push(`console: ${msg.text()}`); });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('securitypolicyviolation', e => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  if (bypassCSP) await page.setBypassCSP(true);
  if (reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport(viewport);

  await page.setRequestInterception(true);
  page.on('request', async request => {
    const url = request.url();
    try {
      if (url === API && request.method() === 'POST') {
        if (mock.offline) return request.abort('internetdisconnected');
        const reply = mock.post(request.postData() || '{}');
        const key = `k${++echo}`;
        echoes.set(key, JSON.stringify(reply));
        return request.respond({ status: 302, headers: { Location: `https://script.googleusercontent.com/macros/echo?user_content_key=${key}`, 'Access-Control-Allow-Origin': '*' }, body: '' });
      }
      if (url.startsWith('https://script.googleusercontent.com/macros/echo?')) {
        if (mock.offline) return request.abort('internetdisconnected');
        return request.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: echoes.get(new URL(url).searchParams.get('user_content_key')) || '{}' });
      }
      if (/^(https?:\/\/(localhost|127\.0\.0\.1)[:/]|data:|blob:|about:)/.test(url)) return request.continue();
      mock.outside.push(url);
      return request.respond({ status: 204, body: '' });
    }
    catch (error) {
      problems.push(`intercept: ${error.message}`);
      return request.abort().catch(() => {});
    }
  });

  await page.goto(BASE + path, { waitUntil: 'networkidle0' });

  return { context, page, problems, mock };

}

const state = page => page.$eval('#comp-main', m => m.dataset.state);
const waitState = (page, name, timeout = 8000) => page.waitForFunction(n => document.getElementById('comp-main')?.dataset.state === n, { timeout }, name);
const textOf = (page, selector) => page.$eval(selector, el => el.textContent.trim());
const clickText = (page, selector, words) => page.evaluate((s, w) => {
  const el = [...document.querySelectorAll(s)].find(e => e.textContent.includes(w));
  if (!el) throw new Error(`no ${s} with ${w}`);
  el.click();
}, selector, words);
const next = page => page.click('[data-next]');
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const storage = (page, slug) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), `athanasios.comp.v1:${slug}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function axe(page, label) {
  await page.evaluate(AXE);
  const results = await page.evaluate(tags => axe.run(document, { runOnly: { type: 'tag', values: tags } }), AXE_TAGS);
  assert.deepEqual(results.violations.map(v => `${label} ${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`), []);
}

async function fillIdentity(page) {
  await page.type('#f-name', 'مارك ميلاد');
  await page.type('#f-phone', '01012345678');
  await page.select('#f-church', 'أبي سيفين');
  await page.click('button[type="submit"]');
}

/** paged flow: answers q1..q3 (single, multi, tf) */
async function answerFirstThree(page) {
  await waitState(page, 'question');
  await clickText(page, 'label.choice', 'ترشيش');
  await next(page);
  await page.waitForFunction(() => document.querySelector('[data-q="q-multi002"]'));
  await clickText(page, 'label.choice', 'النوتية');
  await clickText(page, 'label.choice', 'رئيس النوتية');
  await next(page);
  await page.waitForFunction(() => document.querySelector('[data-q="q-tf000003"]'));
}


/* =========================================================
   TESTS
========================================================= */

test('open competition, phone: intro → form → all 7 types → reload restores → review → submit → result with answers', async () => {

  const { context, page, problems, mock } = await open('/competition/quiz/');

  // intro
  await waitState(page, 'intro');
  assert.equal(await textOf(page, '.hero__title'), BASE_DEF.title);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'azure');
  assert.match(await textOf(page, '.chips'), /٦ أسئلة/);
  assert.match(await textOf(page, '.chips'), /٥٠ نقطة/);
  assert.match(await textOf(page, '.note'), /اقرا السؤال كويس/);
  assert.match(await page.title(), /سفر يونان/);
  assert.ok(await overflow(page) <= 0, 'no horizontal scroll at 360px');
  await page.screenshot({ path: `${SHOTS}mobile-intro.png` });

  // identity: required fields checked here first
  await page.click('[data-cta]');
  await waitState(page, 'identity');
  assert.equal(await page.$('#f-age'), null, 'hidden fields are not asked');
  assert.ok(await page.$('.consent a[href$="/privacy/#competitions"]'), 'consent line links to the privacy policy');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#f-name[aria-invalid="true"]');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'f-name', 'focus on the first invalid field');
  await page.type('#f-phone', '123');
  await page.type('#f-name', 'مارك ميلاد');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#f-phone[aria-invalid="true"]');
  await page.$eval('#f-phone', el => { el.value = ''; });
  await page.type('#f-phone', '٠١٠١٢٣٤٥٦٧٨');
  await page.select('#f-church', 'أبي سيفين');
  await page.click('button[type="submit"]');

  // start
  await answerFirstThree(page);
  const start = mock.fns('compStart')[0].arg;
  assert.equal(start.slug, 'quiz');
  assert.match(start.clientKey, /^[0-9a-f-]{36}$/);
  assert.deepEqual(start.fields, { name: 'مارك ميلاد', phone: '01012345678', church: 'أبي سيفين' });
  assert.equal(start.hp, '');
  assert.match(await textOf(page, '[data-progress-step]'), /سؤال ٣ من ٧/);
  assert.match(await textOf(page, '[data-progress-answered]'), /جاوبت ٢ من ٦/);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('q__text')), true, 'focus moved to the question');
  assert.match(await textOf(page, '.q__pts'), /٥ نقط/);

  // reload in the middle: same step, same answers, no new start call
  const saved = await storage(page, 'quiz');
  assert.equal(saved.step, 'q:2');
  assert.deepEqual(saved.answers, { 'q-single01': 'c-aaaa02', 'q-multi002': ['c-bbbb01', 'c-bbbb02'] });
  assert.equal(saved.clientKey, start.clientKey);
  await page.reload({ waitUntil: 'networkidle0' });
  await waitState(page, 'question');
  assert.ok(await page.$('[data-q="q-tf000003"]'), 'back on the true/false question');
  assert.equal(mock.fns('compStart').length, 1, 'resumed from the phone, no second start');
  await page.click('.actions--bar .btn:not([data-next])');   // السابق
  await page.waitForSelector('[data-q="q-multi002"]');
  assert.deepEqual(await page.$$eval('[data-q="q-multi002"] input:checked', els => els.map(e => e.value)), ['c-bbbb01', 'c-bbbb02']);
  assert.ok(await page.$('[data-q="q-multi002"] .q__media img[src$="media/2026/img-5d2af330-480.webp"]'), 'question picture from the site root');
  await next(page);

  // true/false, info, short, number (validated), long (optional, skipped)
  await clickText(page, 'label.choice', 'صح');
  await next(page);
  await page.waitForSelector('[data-q="q-info0004"]');
  await next(page);
  await page.waitForSelector('[data-q="q-short005"]');
  await page.type('#a-q-short005', 'يقطينة');
  await next(page);
  await page.waitForSelector('[data-q="q-number06"]');
  await page.type('#a-q-number06', 'أربعين');
  await next(page);
  await page.waitForSelector('[data-q="q-number06"] .field__error');
  assert.match(await textOf(page, '[data-q="q-number06"] .field__error'), /اكتب رقم/);
  await page.$eval('#a-q-number06', el => { el.value = ''; });
  await page.type('#a-q-number06', '٤٠');
  await next(page);
  await page.waitForSelector('[data-q="q-long0007"]');
  await page.screenshot({ path: `${SHOTS}mobile-question.png` });
  assert.ok(await overflow(page) <= 0);

  // jump grid
  await page.click('.jump__toggle');
  assert.equal(await page.$$eval('.jump__btn.is-done', els => els.length), 6, 'answered + info');
  await next(page);

  // review: the optional long one is listed, not required
  await waitState(page, 'review');
  assert.match(await textOf(page, '.review__count'), /جاوبت ٥ من ٦ أسئلة/);
  assert.deepEqual(await page.$$eval('[data-missing]', els => els.map(e => e.dataset.missing)), ['6']);
  assert.equal(await page.$('.review__item.is-required'), null);
  await page.screenshot({ path: `${SHOTS}mobile-review.png` });
  await page.click('[data-submit]');
  await page.waitForSelector('[data-confirm]');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'confirm-t');
  await page.click('[data-confirm]');

  // result
  await waitState(page, 'result');
  await page.waitForSelector('.result__line--score');
  assert.equal(await textOf(page, '.result__title'), 'إجاباتك وصلت ✓ ربنا يباركك');
  assert.equal(await textOf(page, '.result__line--score'), 'درجتك ٥٠/٥٠');
  assert.match(await textOf(page, '.result__line--correct'), /جاوبت صح على ٥ من ٦ أسئلة/);
  assert.equal(await page.$('.result__line--pending'), null);
  assert.equal(await page.$$eval('.answer', els => els.length), 6, 'the review list (answersShow immediately)');
  assert.equal(await page.$$eval('.answer--ok', els => els.length), 5);
  assert.match(await textOf(page, '[data-review="q-long0007"]'), /مجاوبتش/);
  assert.match(await textOf(page, '[data-review="q-single01"]'), /ترشيش/);
  const submit = mock.fns('compSubmit')[0].arg;
  assert.deepEqual(submit, {
    token: 'at1.1.sig', clientKey: start.clientKey,
    answers: { 'q-single01': 'c-aaaa02', 'q-multi002': ['c-bbbb01', 'c-bbbb02'], 'q-tf000003': 't', 'q-short005': 'يقطينة', 'q-number06': '٤٠' }
  });
  const kept = await storage(page, 'quiz');
  assert.deepEqual(Object.keys(kept).sort(), ['at', 'receipt', 'submittedAt'], 'only the receipt is kept');
  assert.equal(kept.receipt, 'rc1.s-1.sig');
  await page.screenshot({ path: `${SHOTS}mobile-result.png`, fullPage: true });
  assert.ok(await overflow(page) <= 0);

  // reopening: the result again, from the server (compResult with the receipt)
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.result__line--score');
  assert.equal(mock.fns('compResult').at(-1).arg.receipt, 'rc1.s-1.sig');
  assert.equal(mock.fns('compSubmit').length, 1);

  assert.deepEqual(mock.outside, [], 'no other third-party requests');
  assert.deepEqual(problems, [], 'no CSP violations or page errors');
  await context.close();

});


test('accessibility (axe) and layout on every screen, phone and desktop', async () => {

  for (const [name, viewport] of Object.entries({ mobile: PHONE, desktop: DESKTOP })) {
    const { context, page, problems } = await open('/competition/quiz/', { viewport, bypassCSP: true });
    await waitState(page, 'intro');
    await axe(page, `${name} intro`);
    if (name === 'desktop') await page.screenshot({ path: `${SHOTS}desktop-intro.png` });
    await page.click('[data-cta]');
    await waitState(page, 'identity');
    await axe(page, `${name} identity`);
    await fillIdentity(page);
    await waitState(page, 'question');
    await clickText(page, 'label.choice', 'نينوى');
    await axe(page, `${name} question`);
    if (name === 'desktop') await page.screenshot({ path: `${SHOTS}desktop-question.png` });
    assert.ok(await overflow(page) <= 0, `${name}: no horizontal scroll`);
    // touch targets
    const small = await page.$$eval('#comp-main button, #comp-main a[href], .choice', els => els
      .filter(el => el.offsetParent !== null && !el.closest('details:not([open])'))
      .map(el => { const r = el.getBoundingClientRect(); return { t: el.textContent.trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter(r => r.w < 44 || r.h < 44));
    assert.deepEqual(small, [], 'touch targets ≥ 44px');
    for (let i = 0; i < 7; i += 1) await next(page);
    await waitState(page, 'review');
    await axe(page, `${name} review`);
    if (name === 'desktop') await page.screenshot({ path: `${SHOTS}desktop-review.png` });
    await page.click('[data-submit]');
    await page.waitForSelector('.alert');   // required questions missing
    assert.match(await textOf(page, '.alert'), /مطلوبة/);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('is-required')), true);
    await context.close();
    assert.deepEqual(problems.filter(p => !p.includes('CSP')), []);
  }

  // the result screen (with its review list), desktop
  const mock = createMock();
  const { context, page } = await open('/competition/quiz/', { viewport: DESKTOP, bypassCSP: true, mock });
  await page.evaluate(() => { localStorage.clear(); });
  await page.click('[data-cta]');
  await fillIdentity(page);
  await waitState(page, 'question');
  await clickText(page, 'label.choice', 'نينوى');
  await next(page);
  await clickText(page, 'label.choice', 'ملك نينوى');
  await next(page);
  await clickText(page, 'label.choice', 'غلط');
  await next(page);
  await next(page);
  await page.type('#a-q-short005', 'شجرة');
  await next(page);
  await page.type('#a-q-number06', '3');
  await next(page);
  await next(page);
  await waitState(page, 'review');
  await page.click('[data-submit]');
  await page.click('[data-confirm]');
  await page.waitForSelector('.result__line--score');
  assert.equal(await textOf(page, '.result__line--score'), 'درجتك ٠/٥٠');
  assert.match(await textOf(page, '.result__line--pending'), /فيه إجابات بتتراجع/);
  assert.equal(await page.$$eval('.answer--no', els => els.length) >= 4, true);
  await axe(page, 'desktop result');
  await page.screenshot({ path: `${SHOTS}desktop-result.png`, fullPage: true });
  assert.ok(await overflow(page) <= 0);
  await context.close();

});


test('single-page layout; the result without a review list when the server sends none', async () => {

  const { context, page, problems, mock } = await open('/competition/quiz-single/');
  await waitState(page, 'intro');
  await page.click('[data-cta]');
  await fillIdentity(page);
  await waitState(page, 'single');
  assert.equal(await page.$$eval('.q', els => els.length), 7, 'every question on one page');
  assert.equal(await page.$('.q__pts'), null, 'points hidden (showPoints off)');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'emerald');
  await clickText(page, '[data-q="q-single01"] label.choice', 'ترشيش');
  await clickText(page, '[data-q="q-multi002"] label.choice', 'النوتية');
  await clickText(page, '[data-q="q-tf000003"] label.choice', 'صح');
  await page.type('#a-q-short005', 'يقطينة');
  await page.type('#a-q-number06', 'xx');
  assert.match(await textOf(page, '[data-progress-step]'), /جاوبت ٥ من ٦/);
  await next(page);   // راجع وابعت → the invalid number is pointed at first
  await page.waitForSelector('[data-q="q-number06"] .field__error');
  assert.equal(await page.evaluate(() => document.activeElement.closest('[data-q]').dataset.q), 'q-number06');
  await page.$eval('#a-q-number06', el => { el.value = ''; });
  await page.type('#a-q-number06', '40');
  await page.screenshot({ path: `${SHOTS}mobile-single.png` });
  await next(page);
  await waitState(page, 'review');
  await page.click('[data-submit]');
  await page.click('[data-confirm]');
  await waitState(page, 'result');
  await page.waitForSelector('.result__line--score');
  assert.equal(await textOf(page, '.result__line--score'), 'درجتك ٤٠/٥٠');
  assert.equal(await page.$('.answers'), null, 'no review list (answersShow never)');
  assert.equal(mock.fns('compSubmit').length, 1);
  assert.deepEqual(problems, []);
  await context.close();

});


test('offline at submit: queued with the Arabic message, sent when the connection is back', async () => {

  const { context, page, problems, mock } = await open('/competition/quiz/');
  await page.click('[data-cta]');
  await fillIdentity(page);
  await answerFirstThree(page);
  for (let i = 0; i < 5; i += 1) await next(page);
  await waitState(page, 'review');

  mock.offline = true;
  await page.setOfflineMode(true);
  await page.click('[data-submit]');
  await page.waitForSelector('.alert');   // required ones missing first
  await page.click('[data-missing="2"]');
  await page.waitForSelector('[data-q="q-tf000003"]');
  await clickText(page, 'label.choice', 'صح');
  for (const id of ['q-tf000003', 'q-info0004']) { await page.waitForSelector(`[data-q="${id}"]`); await next(page); }
  await page.waitForSelector('[data-q="q-short005"]');
  await page.type('#a-q-short005', 'يقطينة');
  await next(page);
  await page.type('#a-q-number06', '40');
  await next(page);
  await next(page);
  await waitState(page, 'review');
  assert.equal(await page.$('#comp-net').then(n => n.evaluate(e => e.hidden)), false, 'the connection bar shows');
  await page.click('[data-submit]');
  await page.click('[data-confirm]');
  await waitState(page, 'queued');
  assert.equal(await textOf(page, '.queued .step__title'), 'النت فاصل، إجاباتك محفوظة على الموبايل وهتتبعت أول ما يرجع');
  assert.equal((await storage(page, 'quiz')).pending, true, 'the queued submit is remembered');
  assert.equal(mock.fns('compSubmit').length, 0);

  // back online: sent by itself
  mock.offline = false;
  await page.setOfflineMode(false);
  await waitState(page, 'result');
  await page.waitForSelector('.result__line--score');
  assert.equal(mock.fns('compSubmit').length, 1);
  assert.equal((await storage(page, 'quiz')).receipt, 'rc1.s-1.sig');
  assert.deepEqual(problems, []);
  await context.close();

});


test('busy once: the submit is retried with the same keys and lands once', async () => {

  const mock = createMock({ busyOnce: true });
  const { context, page, problems } = await open('/competition/quiz-single/', { mock });
  await page.click('[data-cta]');
  await fillIdentity(page);
  await waitState(page, 'single');
  for (const [q, w] of [['q-single01', 'ترشيش'], ['q-multi002', 'النوتية'], ['q-tf000003', 'غلط']]) await clickText(page, `[data-q="${q}"] label.choice`, w);
  await page.type('#a-q-short005', 'يقطينة');
  await page.type('#a-q-number06', '40');
  await next(page);
  await waitState(page, 'review');
  await page.click('[data-submit]');
  await page.click('[data-confirm]');
  await page.waitForSelector('.result__line--score', { timeout: 15000 });
  const submits = mock.fns('compSubmit');
  assert.equal(submits.length, 2, 'busy, then retried');
  assert.deepEqual(submits[0].arg, submits[1].arg, 'same token, clientKey and answers');
  assert.equal(mock.results.size, 1);
  assert.deepEqual(problems, []);
  await context.close();

});


test('closed competition: no start button, results date; scheduled one: countdown; withdrawn: unavailable', async () => {

  let { context, page, problems } = await open('/competition/quiz-closed/');
  await waitState(page, 'closed');
  assert.match(await textOf(page, '.status--closed'), /المسابقة خلصت/);
  assert.match(await textOf(page, '.status--closed'), /النتايج هتظهر/);
  assert.equal(await page.$('[data-cta]'), null);
  assert.deepEqual(problems, []);
  await context.close();

  ({ context, page, problems } = await open('/competition/quiz-soon/'));
  await waitState(page, 'scheduled');
  assert.match(await textOf(page, '[data-countdown]'), /^تبدأ بعد ٣ أيام$/);
  assert.match(await textOf(page, '.status--soon'), /الساعة/);
  assert.equal(await page.$('[data-cta]'), null);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'rose');
  await page.screenshot({ path: `${SHOTS}mobile-scheduled.png` });
  await context.close();

  ({ context, page, problems } = await open('/competition/quiz-gone/'));
  await waitState(page, 'unavailable');
  assert.match(await textOf(page, '#comp-main h1'), /مش متاحة/);
  await context.close();

  ({ context, page } = await open('/competition/?s=quiz-closed'));
  await waitState(page, 'closed');
  await context.close();

  ({ context, page } = await open('/competition/'));
  await waitState(page, 'unavailable');
  await context.close();

});


test('device clock 5 hours off: the countdown follows the server Date header', async () => {

  const { context, page } = await open('/competition/quiz-soon/', { reducedMotion: true });
  await page.evaluateOnNewDocument(() => {
    const real = Date.now;
    Date.now = () => real() - 5 * 3600000;
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await waitState(page, 'scheduled');
  assert.match(await textOf(page, '[data-countdown]'), /^تبدأ بعد ٣ أيام$/);
  await context.close();

});


test('registered competition: code → «الكود مسجل باسم …» → start with the participant token', async () => {

  const { context, page, problems, mock } = await open('/competition/quiz-reg/');
  await waitState(page, 'intro');
  assert.match(await textOf(page, '.intro__body'), /بالكود/);
  await page.click('[data-cta]');
  await waitState(page, 'code');
  await page.type('#f-code', 'abc');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#f-code-err');
  assert.equal(mock.fns('compCode').length, 0, 'a malformed code never reaches the server');
  await page.$eval('#f-code', el => { el.value = ''; });
  await page.type('#f-code', 'ATH-2345-6789');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.getElementById('f-code-err')?.textContent.includes('مش صح'));
  await page.$eval('#f-code', el => { el.value = ''; });
  await page.type('#f-code', 'ath 2345 678a');
  await page.click('button[type="submit"]');
  await waitState(page, 'confirm');
  assert.equal(mock.fns('compCode').at(-1).arg.code, 'ATH-2345-678A');
  assert.equal(await textOf(page, '#comp-main h1'), 'الكود مسجل باسم');
  assert.equal(await textOf(page, '.who__name'), 'مينا عادل');
  await clickText(page, 'button', 'لا، مش أنا');
  await waitState(page, 'code');
  await page.type('#f-code', 'ATH2345678A');
  await page.click('button[type="submit"]');
  await waitState(page, 'confirm');
  await clickText(page, 'button', 'أيوه، ده أنا');
  await waitState(page, 'question');
  const start = mock.fns('compStart')[0].arg;
  assert.equal(start.ptoken, 'pt1.good.sig');
  assert.equal(start.fields, undefined, 'registered: no typed identity');
  // answer everything required and submit: points result
  await clickText(page, 'label.choice', 'ترشيش');
  await next(page);
  await clickText(page, 'label.choice', 'النوتية');
  await clickText(page, 'label.choice', 'رئيس النوتية');
  await next(page);
  await clickText(page, 'label.choice', 'صح');
  await next(page);
  await next(page);
  await page.type('#a-q-short005', 'اليقطينة');
  await next(page);
  await page.type('#a-q-number06', '40');
  await next(page);
  await next(page);
  await page.click('[data-submit]');
  await page.click('[data-confirm]');
  await page.waitForSelector('.result__line--points');
  assert.equal(await textOf(page, '.result__line--points'), 'حصلت على ٥٠٠ نقطة');
  assert.equal(await page.$('.result__line--score'), null, 'points only (resultShow points)');
  assert.deepEqual(problems, []);
  await context.close();

});


test('time limit: the clock runs from the server deadline and submits by itself at zero', async () => {

  const mock = createMock({ timedMs: 4000 });
  const { context, page, problems } = await open('/competition/quiz-timed/', { mock });
  assert.match(await textOf(page, '.chips'), /الوقت دقيقة/);
  await page.click('[data-cta]');
  await fillIdentity(page);
  await waitState(page, 'question');
  await page.waitForSelector('#comp-timer:not([hidden])');
  assert.match(await textOf(page, '#comp-timer'), /٠٠:٠[٠-٥]/);
  await clickText(page, 'label.choice', 'ترشيش');
  await page.waitForFunction(() => document.getElementById('comp-timer').classList.contains('is-low'));
  await waitState(page, 'result', 10000);
  const submit = mock.fns('compSubmit')[0].arg;
  assert.deepEqual(submit.answers, { 'q-single01': 'c-aaaa02' }, 'what was answered went out');
  assert.equal(await page.$eval('#comp-timer', t => t.hidden), true);
  assert.deepEqual(problems, []);
  await context.close();

});


test('main site: a competition card opens the engine in the same tab; the bell too; #competition/<slug> redirects', async () => {

  const { context, page, problems } = await open('/');
  await page.waitForSelector('main[data-state="ready"]');
  const cta = await page.waitForSelector('.item-card__cta[data-competition="quiz"]');
  assert.deepEqual(await cta.evaluate(a => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), text: a.textContent })), { href: 'competition/quiz/', target: null, text: 'ادخل المسابقة' });
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), cta.evaluate(a => a.click())]);
  assert.equal(new URL(page.url()).pathname, '/competition/quiz/');
  await waitState(page, 'intro');

  // the bell
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('main[data-state="ready"]');
  await page.click('#bell');
  const note = await page.waitForSelector('dialog.sheet--panel[open] a.note-item[data-competition="quiz"]');
  assert.equal(await note.evaluate(a => a.getAttribute('href')), 'competition/quiz/');
  assert.equal(await note.evaluate(a => a.getAttribute('target')), null);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), note.evaluate(a => a.click())]);
  assert.equal(new URL(page.url()).pathname, '/competition/quiz/');

  // deep links
  await page.goto(`${BASE}/#competition/quiz`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => location.pathname === '/competition/quiz/');
  await waitState(page, 'intro');
  await page.goto(`${BASE}/index.html#competition/NOT_A_SLUG`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('main[data-state="ready"]');
  assert.equal(new URL(page.url()).pathname, '/index.html');

  assert.deepEqual(problems.filter(p => !/Refused to apply inline style/.test(p)), []);
  await context.close();

});


test('admin preview: definition by postMessage, no network, no storage, result from the parent', async () => {

  const mock = createMock();
  const { context, page } = await open('/__test/preview-parent.html', { mock });
  await page.waitForFunction(() => window.msgs.some(m => m.type === 'athanasios:comp-preview-ready'));
  const frame = page.frames().find(f => f !== page.mainFrame());

  const definition = { ...BASE_DEF, slug: 'draft-x', title: 'مسودة مسابقة', fields: [{ key: 'name', label: 'الاسم', type: 'text', mode: 'required' }], questions: QUESTIONS.slice(0, 3) };
  await page.evaluate(def => document.getElementById('frame').contentWindow.postMessage({ type: 'athanasios:comp-preview', definition: def, at: null, state: 'auto' }, location.origin), definition);
  await page.waitForFunction(() => window.msgs.some(m => m.type === 'athanasios:comp-preview-shown'));
  await frame.waitForFunction(() => document.getElementById('comp-main').dataset.state === 'intro');
  assert.equal(await frame.$eval('.hero__title', e => e.textContent), 'مسودة مسابقة');
  assert.match(await frame.$eval('.chips', e => e.textContent), /٣ أسئلة/);

  // a message from anyone but the parent is ignored
  await frame.evaluate(() => window.postMessage({ type: 'athanasios:comp-preview', definition: { title: 'evil' }, state: 'open' }, location.origin));
  await sleep(200);
  assert.equal(await frame.$eval('.hero__title', e => e.textContent), 'مسودة مسابقة');

  // time travel / forced states
  await page.evaluate(def => document.getElementById('frame').contentWindow.postMessage({ type: 'athanasios:comp-preview', definition: def, at: null, state: 'closed' }, location.origin), definition);
  await frame.waitForFunction(() => document.getElementById('comp-main').dataset.state === 'closed');
  await page.evaluate(def => document.getElementById('frame').contentWindow.postMessage({ type: 'athanasios:comp-preview', definition: { ...def, startAt: '2030-01-01T10:00' }, at: '2029-12-29T10:00', state: 'auto' }, location.origin), definition);
  await frame.waitForFunction(() => document.getElementById('comp-main').dataset.state === 'scheduled');
  assert.match(await frame.$eval('[data-countdown]', e => e.textContent), /تبدأ بعد ٣ أيام/);

  await page.evaluate(def => document.getElementById('frame').contentWindow.postMessage({ type: 'athanasios:comp-preview', definition: def, at: null, state: 'open' }, location.origin), definition);
  await frame.waitForFunction(() => document.getElementById('comp-main').dataset.state === 'intro');
  await frame.click('[data-cta]');
  await frame.waitForSelector('#f-name');
  await frame.type('#f-name', 'خادم بيجرب');
  await frame.click('button[type="submit"]');
  await frame.waitForFunction(() => document.getElementById('comp-main').dataset.state === 'question');
  await frame.evaluate(() => [...document.querySelectorAll('label.choice')].find(l => l.textContent.includes('ترشيش')).click());
  await frame.click('[data-next]');
  await frame.evaluate(() => [...document.querySelectorAll('label.choice')].find(l => l.textContent.includes('النوتية')).click());
  await frame.click('[data-next]');
  await frame.evaluate(() => [...document.querySelectorAll('label.choice')].find(l => l.textContent.includes('صح')).click());
  await frame.click('[data-next]');
  await frame.waitForFunction(() => document.getElementById('comp-main').dataset.state === 'review');
  await frame.click('[data-submit]');
  await frame.click('[data-confirm]');
  await frame.waitForSelector('.result__line--score');
  assert.equal(await frame.$eval('.result__line--score', e => e.textContent), 'درجتك ٧/١٠');
  const sent = await page.evaluate(() => window.lastSubmit);
  assert.deepEqual(sent.answers, { 'q-single01': 'c-aaaa02', 'q-multi002': ['c-bbbb01'], 'q-tf000003': 't' });
  assert.match(sent.id, /^[0-9a-f-]{36}$/);

  assert.equal(mock.calls.length, 0, 'the API is never called in preview');
  assert.deepEqual(served.filter(p => p.includes('draft-x')), [], 'no comp.json fetched');
  assert.deepEqual(await frame.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('athanasios.comp'))), [], 'nothing stored');
  await context.close();

  // not inside the admin: no preview
  const direct = await open('/competition/index.html?preview');
  await waitState(direct.page, 'unavailable');
  await direct.context.close();

});


test('the narrowest phones (280px): nothing wider than the screen', async () => {

  const { context, page, problems } = await open('/competition/quiz/', { viewport: { width: 280, height: 653, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
  await waitState(page, 'intro');
  assert.ok(await overflow(page) <= 0, 'intro');
  await page.click('[data-cta]');
  await waitState(page, 'identity');
  assert.ok(await overflow(page) <= 0, 'identity');
  await fillIdentity(page);
  await waitState(page, 'question');
  await page.click('.jump__toggle');
  assert.ok(await overflow(page) <= 0, 'question + jump grid');
  await page.screenshot({ path: `${SHOTS}mobile-280-question.png` });
  for (let i = 0; i < 7; i += 1) await next(page);
  await waitState(page, 'review');
  assert.ok(await overflow(page) <= 0, 'review');
  assert.deepEqual(problems, []);
  await context.close();

});
