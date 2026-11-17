/*
 * «خبزنا اليومي» — W1 intro sound: two ORIGINAL samples for the owner to choose from (decision 3: original sound).
 * Both are synthesized here (Web Audio), nothing is downloaded or sampled from a recording.
 * The same code schedules into a live AudioContext (the prototype) or an OfflineAudioContext
 * (tools/render-sound.mjs → sound/intro-a.m4a|.opus, intro-b.*: the files W5 ships, < 60 KB each).
 *
 * Timing is locked to the intro (intro.js): the light blooms at 0, the book opens at ≈ 0.8 s,
 * the cross comes down with ONE bell at 2.05 s, the logo hands over to the page at 2.4–3.0 s.
 *
 *   «أ — فجر»     a warm pad that opens like the dawn (Dadd9, a filter rising with the sun) + one soft high bell
 *   «ب — ترنيمة»  a harp-like arpeggio climbing as the book opens + one low church bell
 */

export const BELL_AT = 2.05;
export const LENGTH = 3.8; // with the tail
export const SAMPLES = {
  a: { name: 'أ — فجر', hint: 'نغمة دافية بتفتح مع النور، وجرس خفيف عالي مع نزول الصليب' },
  b: { name: 'ب — ترنيمة', hint: 'نغمات زي القيثارة طالعة مع فتح الكتاب، وجرس كنيسة واطي مع نزول الصليب' }
};

const hz = n => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz

function reverb(ctx, seconds = 2.6, decay = 3.2) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1; // deterministic noise
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = rnd() * Math.pow(1 - i / len, decay);
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}

function bus(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
  const dry = ctx.createGain(); dry.gain.value = 0.8;
  const wet = ctx.createGain(); wet.gain.value = 0.42;
  const rv = reverb(ctx);
  dry.connect(comp); wet.connect(rv); rv.connect(comp); comp.connect(master); master.connect(ctx.destination);
  const input = ctx.createGain();
  input.connect(dry); input.connect(wet);
  return { input, master };
}

/* a bell: inharmonic partials, each its own decay (the higher, the shorter) */
function bell(ctx, out, t, base, gain, decay, partials) {
  partials.forEach(([ratio, amp], i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = base * ratio;
    const d = decay / (1 + i * 0.35);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * amp, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + d + 0.05);
  });
}

function sampleA(ctx, out, t0) {
  // the pad: D3 A3 E4 F#4 A4, two slightly detuned voices each; the filter rises with the sun
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(320, t0);
  lp.frequency.exponentialRampToValueAtTime(2400, t0 + 2.1);
  lp.frequency.exponentialRampToValueAtTime(1300, t0 + 3.4);
  const pad = ctx.createGain();
  pad.gain.setValueAtTime(0, t0);
  pad.gain.linearRampToValueAtTime(0.16, t0 + 1.3);
  pad.gain.setValueAtTime(0.16, t0 + 2.3);
  pad.gain.exponentialRampToValueAtTime(0.0008, t0 + 3.6);
  pad.connect(lp); lp.connect(out);
  [50, 57, 64, 66, 69].forEach((n, i) => {
    for (const det of [-5, 5]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = i < 2 ? 'triangle' : 'sine';
      o.frequency.value = hz(n);
      o.detune.value = det;
      g.gain.value = [0.5, 0.42, 0.32, 0.28, 0.22][i];
      o.connect(g); g.connect(pad);
      o.start(t0); o.stop(t0 + 3.7);
    }
  });
  // a breath of light: a high shimmer while the ring draws
  const sh = ctx.createGain();
  sh.gain.setValueAtTime(0, t0 + 1.0);
  sh.gain.linearRampToValueAtTime(0.018, t0 + 1.7);
  sh.gain.exponentialRampToValueAtTime(0.0005, t0 + 3.2);
  sh.connect(out);
  for (const n of [81, 86]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(n); o.connect(sh); o.start(t0 + 1); o.stop(t0 + 3.3); }
  // the bell: a soft, high one (D5) with the cross
  bell(ctx, out, t0 + BELL_AT, hz(74), 0.13, 2.6, [[1, 1], [2.0, 0.42], [2.76, 0.24], [3.5, 0.12], [5.4, 0.06], [0.5, 0.3]]);
}

function sampleB(ctx, out, t0) {
  // a low drone under everything
  const dr = ctx.createGain();
  dr.gain.setValueAtTime(0, t0);
  dr.gain.linearRampToValueAtTime(0.07, t0 + 0.9);
  dr.gain.setValueAtTime(0.07, t0 + 2.4);
  dr.gain.exponentialRampToValueAtTime(0.0005, t0 + 3.6);
  dr.connect(out);
  for (const n of [38, 45]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(n); o.connect(dr); o.start(t0); o.stop(t0 + 3.7); }
  // the harp: D4 F#4 A4 D5 E5 F#5 A5 climbing while the book opens
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 3200; lp.connect(out);
  [62, 66, 69, 74, 76, 78, 81].forEach((n, i) => {
    const t = t0 + 0.32 + i * 0.2;
    for (const [type, mul, amp] of [['triangle', 1, 0.16], ['sine', 2, 0.05]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = hz(n) * mul;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 1.5);
      o.connect(g); g.connect(lp);
      o.start(t); o.stop(t + 1.6);
    }
  });
  // the church bell: low (D4), hum / prime / minor third / fifth / nominal
  bell(ctx, out, t0 + BELL_AT, hz(62), 0.17, 3.2, [[0.5, 0.55], [1, 1], [1.2, 0.5], [1.5, 0.32], [2, 0.38], [2.5, 0.12], [3, 0.08]]);
}

/* schedule one sample into any (Offline)AudioContext, starting at t0 */
export function schedule(ctx, which, t0 = ctx.currentTime + 0.02) {
  const { input } = bus(ctx);
  (which === 'b' ? sampleB : sampleA)(ctx, input, t0);
  return t0;
}

/* encode an AudioBuffer as 16-bit PCM WAV (for tools/render-sound.mjs) */
export function wav(buffer) {
  const ch = buffer.numberOfChannels, rate = buffer.sampleRate, n = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, rate, true); data.setUint32(28, rate * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  w(36, 'data'); data.setUint32(40, n * ch * 2, true);
  let o = 44;
  const chans = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Uint8Array(data.buffer);
}
