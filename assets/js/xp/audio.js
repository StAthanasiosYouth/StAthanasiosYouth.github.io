/**
 * The scenes' sound: realistic, subtle phone-interaction sounds, all
 * synthesised here (Web Audio, nothing downloaded, no app's audio copied).
 * Loaded with the scenes (and the contact cards), never with the page.
 *
 *   key     a soft touchscreen key tap (one per typed character; random
 *           pitch/level per tap; typing stops = taps stop, by design)
 *   send    a short clean "sent" swish      pop    a message arriving
 *   react   a small reaction pop            like   a heart / like
 *   tick    delivered / read, barely there  swipe  a reel swipe (whoosh)
 *   whoosh  a paper plane / fly-by          notify a new post / mail
 *   ring    a soft call pulse
 *
 * A tiny mixer on the page's one AudioContext (sound.js): every voice →
 * a bus gain → a compressor → a limiter → the speakers. At most 3 voices
 * at once (extras are dropped, never queued), each category throttled so
 * nothing stacks into noise. The page's sound setting rules: off by
 * default, nothing before a gesture, nothing in a hidden tab. Lite tier:
 * no key taps, half the rate; reduced motion: no ambient sounds at all.
 */

import { audio, soundEnabled } from '../sound.js';

const MAX_VOICES = 3;

/* the least time between two sounds of a category (ms) */
const GAP = { key: 55, send: 300, pop: 220, react: 150, like: 260, tick: 260, swipe: 650, whoosh: 900, notify: 900, ring: 1400 };

/* the old UI names the scenes used */
const ALIAS = { tap: 'react', success: 'like', open: 'swipe' };

let bus = null;
let noiseBuffer = null;
const active = [];

function chain(ctx) {

  if (bus && bus.context === ctx) return bus;

  const gain = ctx.createGain();
  gain.gain.value = 0.2;   // a little above the UI sounds (0.12), never harsh

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 8;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.16;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;

  gain.connect(compressor).connect(limiter).connect(ctx.destination);

  const length = Math.ceil(ctx.sampleRate * 0.5);
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  bus = { context: ctx, input: gain };
  return bus;

}

const vary = (value, amount) => value * (1 + (Math.random() * 2 - 1) * amount);


/* one voice: its own gain into the bus; tone() and hiss() build it */
function voice(ctx, length, level) {

  const out = ctx.createGain();
  out.gain.value = level;
  out.connect(bus.input);
  const t = ctx.currentTime + 0.005;

  const tone = (freq, at, dur, { type = 'sine', gain = 1, glide = 0, attack = 0.004 } = {}) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t + at);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t + at + dur * 0.8);
    env.gain.setValueAtTime(0.0001, t + at);
    env.gain.exponentialRampToValueAtTime(gain, t + at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
    osc.connect(env).connect(out);
    osc.start(t + at);
    osc.stop(t + at + dur + 0.02);
  };

  const hiss = (at, dur, { from = 2000, to = from, q = 1.2, gain = 1, peak = 0.3 } = {}) => {
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    src.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t + at);
    if (to !== from) filter.frequency.exponentialRampToValueAtTime(to, t + at + dur);
    env.gain.setValueAtTime(0.0001, t + at);
    env.gain.exponentialRampToValueAtTime(gain, t + at + Math.max(0.002, dur * peak));
    env.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
    src.connect(filter).connect(env).connect(out);
    src.start(t + at, Math.random() * 0.3);
    src.stop(t + at + dur + 0.02);
  };

  active.push(performance.now() + length * 1000 + 30);
  return { tone, hiss };

}


const SOUNDS = {
  key: v => {
    // a glassy tick of the screen + the finger's soft body, never a click
    v.hiss(0, vary(0.032, 0.2), { from: vary(3200, 0.15), q: 1.6, gain: vary(0.5, 0.25), peak: 0.06 });
    v.tone(vary(1700, 0.1), 0, 0.022, { gain: 0.1, attack: 0.002 });
    v.tone(vary(210, 0.1), 0, 0.03, { gain: 0.18, attack: 0.002 });
  },
  send: v => {
    v.hiss(0, 0.13, { from: 900, to: 3400, q: 0.9, gain: 0.35 });
    v.tone(620, 0.01, 0.1, { gain: 0.28, glide: 1180 });
  },
  pop: v => {
    v.tone(vary(500, 0.05), 0, 0.12, { gain: 0.6, glide: 860 });
    v.tone(1000, 0.012, 0.08, { type: 'triangle', gain: 0.12, glide: 1500 });
  },
  react: v => {
    v.tone(vary(880, 0.08), 0, 0.07, { gain: 0.45, glide: 1500, attack: 0.003 });
    v.tone(1320, 0.03, 0.07, { gain: 0.2, glide: 2100, attack: 0.003 });
  },
  like: v => {
    v.tone(660, 0, 0.18, { gain: 0.42 });
    v.tone(990, 0.055, 0.22, { gain: 0.32 });
  },
  tick: v => {
    v.tone(2500, 0, 0.018, { gain: 0.16, attack: 0.002 });
    v.tone(2800, 0.07, 0.018, { gain: 0.13, attack: 0.002 });
  },
  swipe: v => v.hiss(0, 0.24, { from: 500, to: 2600, q: 0.8, gain: 0.42, peak: 0.45 }),
  whoosh: v => v.hiss(0, 0.42, { from: 1500, to: 380, q: 0.9, gain: 0.3, peak: 0.4 }),
  notify: v => {
    v.tone(1318.5, 0, 0.42, { gain: 0.3 });
    v.tone(1975.5, 0.06, 0.36, { gain: 0.16 });
  },
  ring: v => {
    // two soft marimba-like pulses (not any phone's ringtone)
    [0, 0.2].forEach(at => {
      v.tone(784, at, 0.32, { gain: 0.36, attack: 0.006 });
      v.tone(1176, at, 0.2, { gain: 0.12, attack: 0.006 });
    });
  }
};

const LENGTH = { key: 0.05, send: 0.15, pop: 0.13, react: 0.1, like: 0.28, tick: 0.1, swipe: 0.26, whoosh: 0.44, notify: 0.48, ring: 0.54 };


/* for the tests: the voices that really played (set __xpAudioLog = []) */
const log = (cat, extra) => {
  const sink = globalThis.__xpAudioLog;
  if (Array.isArray(sink)) sink.push({ cat, t: performance.now(), voices: active.length, ...extra });
};


/**
 * A mixer for one scene (or card). Returns sound(name): plays it now if
 * allowed, else drops it. sound.stop() ends it (nothing plays after).
 */
export function mixer({ reduced = false, lite = false, ambient = true } = {}) {

  const last = {};
  let stopped = false;

  const sound = (name, { force = false } = {}) => {
    const cat = ALIAS[name] || name;
    if (stopped || !SOUNDS[cat] || !soundEnabled() || document.hidden) return false;
    if (!force && (reduced || !ambient)) return false;
    if (lite && cat === 'key') return false;

    const now = performance.now();
    if (now - (last[cat] || -1e9) < GAP[cat] * (lite ? 2 : 1)) return false;

    // only voices still sounding count
    for (let i = active.length - 1; i >= 0; i--) if (active[i] <= now) active.splice(i, 1);
    if (active.length >= MAX_VOICES) {
      log(cat, { dropped: true });
      return false;
    }

    const ctx = audio();
    if (!ctx || ctx.state !== 'running') return false;

    try {
      chain(ctx);
      last[cat] = now;
      SOUNDS[cat](voice(ctx, LENGTH[cat], cat === 'key' ? vary(0.8, 0.2) : 1));
      log(cat);
      return true;
    }
    catch {
      return false;
    }
  };

  sound.stop = () => { stopped = true; };
  sound.reduced = reduced;
  return sound;

}
