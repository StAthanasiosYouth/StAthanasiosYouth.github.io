// Final polish, public scenes (unit): the real material's manifest (files
// present, small, modest in total), the scenes' words (nothing private),
// and the scenes' sound mixer (voices, throttling, tiers, the setting).
//
// Run: cd tools && node --test ../tests/final-s.test.mjs

import { readFileSync, statSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';

/* the browser bits the modules touch */
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
globalThis.document = { hidden: false, createElement: () => ({}) };
globalThis.CSS = { supports: () => true };
const activation = { hasBeenActive: false };
Object.defineProperty(globalThis, 'navigator', { value: { userActivation: activation }, configurable: true });

let now = 0;
globalThis.performance = { now: () => now };

const stats = { contexts: 0, starts: 0 };
const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
const node = () => ({ connect: t => t, gain: param(), frequency: param(), Q: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
class FakeContext {
  constructor() { stats.contexts += 1; this.state = 'running'; this.sampleRate = 8000; this.destination = node(); }
  get currentTime() { return now / 1000; }
  resume() {}
  createGain() { return node(); }
  createBiquadFilter() { return node(); }
  createDynamicsCompressor() { return node(); }
  createOscillator() { return { ...node(), type: '', start() { stats.starts += 1; }, stop() {} }; }
  createBufferSource() { return { ...node(), buffer: null, start() { stats.starts += 1; }, stop() {} }; }
  createBuffer(c, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
}
globalThis.window = { AudioContext: FakeContext };

const { POSTERS, CLIPS } = await import('../assets/js/xp/library.js');
const talk = await import('../assets/js/xp/talk.js');
const { mixer } = await import('../assets/js/xp/audio.js');


test('the real material: every file present and small, modest in total', () => {
  assert.ok(POSTERS.length >= 6 && CLIPS.length >= 4);
  let total = 0;
  for (const poster of POSTERS) {
    const size = statSync(ROOT + poster.src).size;
    total += size;
    assert.ok(size <= 40 * 1024, `${poster.src}: ${size}`);
    assert.ok(poster.topic && /^\d{4}-\d{2}-\d{2}$/.test(poster.date));
  }
  for (const clip of CLIPS) {
    const video = statSync(ROOT + clip.src).size;
    const still = statSync(ROOT + clip.poster).size;
    total += video + still;
    assert.ok(video <= 300 * 1024, `${clip.src}: ${video}`);
    assert.ok(still <= 40 * 1024, `${clip.poster}: ${still}`);
    assert.ok(clip.caption && clip.duration > 2 && clip.duration < 6.5);
    assert.deepEqual([clip.w, clip.h], [360, 640]);
    // an MP4 (ftyp box), H.264 inside
    const head = readFileSync(ROOT + clip.src).subarray(0, 4096).toString('latin1');
    assert.match(head, /ftyp/);
    assert.match(readFileSync(ROOT + clip.src).toString('latin1'), /avc1/);
  }
  assert.ok(total < 3 * 1024 * 1024, `total ${Math.round(total / 1024)} KB`);
  assert.ok(existsSync(`${ROOT}tools/build-xp-media.mjs`), 'reproducible');
});

test('the words: believable, varied, nothing private', () => {
  const all = [talk.GROUP, talk.MINE, talk.REPLIES, talk.COMMENTS, talk.PAGE_REPLIES, talk.QUICK].flat();
  assert.ok(talk.GROUP.length >= 15 && talk.COMMENTS.length >= 8 && talk.QUICK.length >= 8);
  assert.ok(new Set(all).size === all.length, 'no line twice');
  const lengths = talk.GROUP.map(s => s.length);
  assert.ok(Math.min(...lengths) <= 6 && Math.max(...lengths) >= 40, 'very short to longer');
  for (const line of all) {
    assert.doesNotMatch(line, /(\+?\d[\d\s-]{6,}|[٠-٩]{7,}|01[0125]\d{8})/, `no phone number: ${line}`);
    assert.doesNotMatch(line, /@\w+\.\w+/, `no address: ${line}`);
  }
  // senders: initials or roles only
  for (const who of talk.WHO) assert.match(who, /^[ء-ي]\.$/);
  assert.equal(talk.SERVANT, 'خادم الاجتماع');
  const posts = talk.pagePosts({ sessions: [] });
  assert.ok(posts.some(p => p.text.includes('صوتكم يهمنا')));
  assert.ok(posts.some(p => p.text.includes(talk.PAGE.quoteBy)));
  assert.ok(posts.some(p => p.poster && p.text.includes(p.poster.topic)));
});

test('mixer: on by default, nothing before a gesture, a mute is kept', () => {
  store.delete('athanasios.sound');
  const sound = mixer({});
  activation.hasBeenActive = false;
  now = 1000;
  assert.equal(sound('pop'), false, 'no gesture yet');
  assert.equal(stats.contexts, 0, 'no AudioContext before a gesture');
  activation.hasBeenActive = true;
  now = 2000;
  assert.equal(sound('pop'), true, 'on by default, after a gesture');
  assert.equal(stats.contexts, 1);
  store.set('athanasios.sound', 'off');
  now = 3000;
  assert.equal(sound('pop'), false, 'a mute is kept');
  store.set('athanasios.sound', 'on');
  document.hidden = true;
  now = 4000;
  assert.equal(sound('pop'), false, 'hidden tab');
  document.hidden = false;
  sound.stop();
  now = 5000;
  assert.equal(sound('pop'), false, 'stopped');
});

test('mixer: at most 3 voices, each category throttled', () => {
  store.set('athanasios.sound', 'on');
  activation.hasBeenActive = true;
  const sound = mixer({});
  now = 100000;
  const results = ['pop', 'react', 'like', 'notify', 'ring'].map(name => sound(name));
  assert.deepEqual(results, [true, true, true, false, false], 'the 4th voice at once is dropped');
  now += 600;
  assert.equal(sound('pop'), true, 'voices end, room again');
  now += 100;
  assert.equal(sound('pop'), false, 'a pop again so soon: throttled');
  now += 1000;
  // key taps: fast, but never closer than 55 ms
  assert.equal(sound('key'), true);
  now += 20;
  assert.equal(sound('key'), false);
  now += 60;
  assert.equal(sound('key'), true);
});

test('mixer: reduced motion is quiet (the speaker\'s own confirmation only); lite has no key taps', () => {
  store.set('athanasios.sound', 'on');
  activation.hasBeenActive = true;
  now = 200000;
  const reduced = mixer({ reduced: true });
  assert.equal(reduced('pop'), false);
  assert.equal(reduced('like', { force: true }), true);
  now = 300000;
  const lite = mixer({ lite: true });
  assert.equal(lite('key'), false);
  assert.equal(lite('pop'), true);
  now += 300;
  assert.equal(lite('pop'), false, 'lite: twice the gap');
});

test('scene clips: the link\'s own videos first (admin order, their segments), then the bundled game clips', async () => {
  const { sceneClips, pictures } = await import('../assets/js/xp/kit.js');
  const link = {
    gallery: [
      { src: 'media/2026/img-aaaaaaaa.webp', thumb: 'media/2026/img-aaaaaaaa-480.webp', w: 1200, h: 1500, alt: 'a' },
      { type: 'video', src: 'media/2026/vid-bbbbbbbb.mp4', poster: 'media/2026/vid-bbbbbbbb-480.webp', w: 1080, h: 1920, alt: 'b', start: 4, end: 9 },
      { type: 'video', src: 'media/2026/vid-cccccccc.webm', poster: 'media/2026/vid-cccccccc-480.webp', w: 1920, h: 1080, alt: 'c' }
    ]
  };
  const clips = sceneClips(link, Infinity, { order: ['timer'] });
  assert.deepEqual(clips.slice(0, 2).map(c => [c.src, c.start, c.end, c.caption]), [
    ['media/2026/vid-bbbbbbbb.mp4', 4, 9, ''],
    ['media/2026/vid-cccccccc.webm', 0, 0, '']
  ]);
  assert.equal(clips[2].id, 'timer', 'then the bundled ones, the asked order first');
  assert.equal(clips.length, 2 + CLIPS.length);
  assert.ok(clips.slice(2).every(c => c.start === 0 && c.end === 0 && c.caption));
  assert.deepEqual(sceneClips(null, 2).map(c => c.id), CLIPS.slice(0, 2).map(c => c.id), 'no gallery: the bundled clips');
  assert.equal(sceneClips(link, 1)[0].src, 'media/2026/vid-bbbbbbbb.mp4');
  // pictures: images only
  assert.deepEqual(pictures(link, 2).map(p => p.src), ['media/2026/img-aaaaaaaa-480.webp', POSTERS[0].src]);
});

test('clip segments: start/end clamp to the real duration', async () => {
  const { segment } = await import('../assets/js/xp/kit.js');
  assert.deepEqual(segment(0, 0, 12), [0, 12], 'the whole clip');
  assert.deepEqual(segment(4, 9, 12), [4, 9]);
  assert.deepEqual(segment(4, 30, 12), [4, 12], 'end past the video: its end');
  assert.deepEqual(segment(15, 20, 12), [0, 12], 'start past the end: from 0');
  assert.deepEqual(segment(4, 2, 12), [4, 12], 'an end before the start: to the end');
  assert.deepEqual(segment(3, 0, NaN), [3, Infinity], 'duration not known yet');
});
