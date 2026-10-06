/**
 * SOUND
 *
 * Optional UI sounds, synthesized with Web Audio (no files to download).
 * Silent by default; the 🔇/🔊 toggle remembers the choice on this device.
 * Sounds only answer the visitor's own taps, except "ready" / "important"
 * which play only if sound is on, the tab is visible, and audio was already
 * unlocked by an earlier tap.
 *
 * Character: short, soft, glassy. Peak level about -18 dBFS.
 */

const KEY = 'athanasios.sound';

let context = null;
let master = null;

export function soundEnabled() {

  try {
    return localStorage.getItem(KEY) === 'on';
  }
  catch {
    return false;
  }

}


export function setSoundEnabled(on) {

  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  }
  catch {
    // private mode
  }

  if (on) {
    unlock();
  }

}


/* Must run inside a tap handler the first time (browser autoplay rules). */
function unlock() {

  try {
    if (!context) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      context = new AudioCtx();
      master = context.createGain();
      master.gain.value = 0.12;
      master.connect(context.destination);
    }
    if (context.state === 'suspended') {
      context.resume();
    }
  }
  catch {
    context = null;
  }

  return context;

}


function tone(freq, start, duration, { type = 'sine', gain = 1, glideTo = null, attack = 0.006 } = {}) {

  const t = context.currentTime + start;
  const osc = context.createOscillator();
  const env = context.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + duration);

  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.05);

}


function noise(start, duration, { from = 1800, to = 3800, gain = 0.5 } = {}) {

  const t = context.currentTime + start;
  const length = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const env = context.createGain();

  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + duration);

  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + duration * 0.35);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  source.connect(filter).connect(env).connect(master);
  source.start(t);

}


const SOUNDS = {
  // barely-there click
  tap: () => {
    tone(1650, 0, 0.035, { type: 'triangle', gain: 0.35, attack: 0.002 });
  },
  // soft glassy rise
  open: () => {
    noise(0, 0.18, { from: 900, to: 3200, gain: 0.35 });
    tone(880, 0.02, 0.16, { gain: 0.25, glideTo: 1320 });
  },
  close: () => {
    noise(0, 0.15, { from: 3000, to: 900, gain: 0.3 });
    tone(1180, 0, 0.12, { gain: 0.2, glideTo: 780 });
  },
  // a soft bubble (reactions, messages)
  pop: () => {
    tone(740, 0, 0.09, { gain: 0.3, glideTo: 1180, attack: 0.004 });
  },
  // two-note major third
  success: () => {
    tone(1046.5, 0, 0.28, { gain: 0.4 });
    tone(1318.5, 0.08, 0.34, { gain: 0.35 });
  },
  // warm rising arpeggio with a shimmer
  ready: () => {
    [659.3, 830.6, 987.8, 1318.5].forEach((f, i) => tone(f, i * 0.07, 0.42, { gain: 0.32 }));
    noise(0.2, 0.35, { from: 4000, to: 7000, gain: 0.12 });
  },
  // single low bell with a quiet harmonic
  important: () => {
    tone(392, 0, 0.9, { gain: 0.45 });
    tone(784, 0, 0.7, { gain: 0.12 });
    tone(1176, 0.01, 0.5, { gain: 0.06 });
  }
};


/**
 * Plays a named sound if the visitor enabled sounds.
 * passive: true for sounds not caused by a tap (needs an unlocked context).
 */
export function play(name, { passive = false } = {}) {

  if (!soundEnabled() || !SOUNDS[name] || document.hidden) {
    return;
  }

  if (passive && (!context || context.state !== 'running')) {
    return;
  }

  if (!unlock()) {
    return;
  }

  try {
    SOUNDS[name]();
  }
  catch {
    // never let a sound break the page
  }

}
