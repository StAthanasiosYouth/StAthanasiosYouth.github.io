/**
 * SOUND: UI sounds, synthesized with Web Audio (no files). On by default;
 * the 🔇/🔊 toggle remembers a mute on this device (else for the visit).
 * Nothing is created before the visitor's first gesture, which wakes it.
 * "ready" / "important" need it awake. Soft, glassy (~-18 dBFS); the
 * scenes' mixer (xp/audio.js, lazy) shares the one AudioContext.
 */

const KEY = 'athanasios.sound';

let context = null;
let master = null;
let visit = true;

export function soundEnabled() {

  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored === 'on';
  }
  catch { /* blocked: this visit's choice */ }
  return visit;

}


export function setSoundEnabled(on) {

  visit = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  }
  catch { /* private mode */ }

  if (on) audio();

}


/* the shared context (created / resumed only after a gesture), or null */
export function audio() {

  const active = navigator.userActivation;

  try {
    if (!context) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx || (active && !active.hasBeenActive)) return null;
      context = new AudioCtx();
      master = context.createGain();
      master.gain.value = 0.12;
      master.connect(context.destination);
    }
    if (context.state === 'suspended' && (!active || active.hasBeenActive)) context.resume();
  }
  catch {
    context = null;
  }

  return context;

}

/* the first real gesture wakes the audio (autoplay rules), if sound is on */
const WAKE = ['pointerdown', 'keydown', 'touchend'];
const wake = () => {
  if (soundEnabled() && audio()) WAKE.forEach(type => removeEventListener(type, wake, true));
};
if (typeof addEventListener === 'function') WAKE.forEach(type => addEventListener(type, wake, true));


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
  tap: () => tone(1650, 0, 0.03, { type: 'triangle', gain: 0.16, attack: 0.002 }),
  open: () => {
    noise(0, 0.18, { from: 900, to: 3200, gain: 0.24 });
    tone(880, 0.02, 0.16, { gain: 0.18, glideTo: 1320 });
  },
  close: () => {
    noise(0, 0.15, { from: 3000, to: 900, gain: 0.2 });
    tone(1180, 0, 0.12, { gain: 0.14, glideTo: 780 });
  },
  pop: () => tone(740, 0, 0.09, { gain: 0.3, glideTo: 1180, attack: 0.004 }),
  success: () => {
    tone(1046.5, 0, 0.28, { gain: 0.4 });
    tone(1318.5, 0.08, 0.34, { gain: 0.35 });
  },
  ready: () => {
    [659.3, 830.6, 987.8, 1318.5].forEach((f, i) => tone(f, i * 0.07, 0.42, { gain: 0.32 }));
    noise(0.2, 0.35, { from: 4000, to: 7000, gain: 0.12 });
  },
  important: () => {
    tone(392, 0, 0.9, { gain: 0.45 });
    tone(784, 0, 0.7, { gain: 0.12 });
    tone(1176, 0.01, 0.5, { gain: 0.06 });
  }
};


/* passive: not caused by a tap (needs a running context) */
export function play(name, { passive = false } = {}) {

  if (!soundEnabled() || !SOUNDS[name] || document.hidden) return;
  if (passive && (!context || context.state !== 'running')) return;
  if (!audio()) return;

  try {
    SOUNDS[name]();
  }
  catch { /* never break the page */ }

}
