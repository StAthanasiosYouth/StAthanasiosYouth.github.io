/**
 * A SERVICE PAGE'S CLIP SOUND (page/video.js; docs/EVENTS.md §17.9)
 *
 * What a video card plays when its cover is opened, chosen in the admin
 * («صوت المقطع»), card.audio.mode:
 *   original  the preview's own sound
 *   custom    the card's own music / sound (card.audio.src), the preview muted
 *   none      silence
 * Only ever ONE source: the other is muted (custom never lets the clip's
 * own sound through). Everything fades: in as the sheet opens, out as it
 * closes, across when the visitor goes to the next / previous clip; a hidden
 * tab pauses it all. The site's one sound setting (sound.js) wins: off =
 * everything silent. Gentle levels.
 *
 * The fades go through the site's AudioContext (sound.js, awake after the
 * visitor's tap) so they are smooth on every phone (iPhones ignore an
 * element's volume); before that tap (a shared #v/ link) the elements play
 * muted, and the first tap brings the sound in.
 */

import { audio, soundEnabled } from '../sound.js';

const LEVEL = { original: 0.9, custom: 0.55, none: 0 };
const FADE_IN = 0.9;
const FADE_OUT = 0.5;

export const AUDIO_MODES = ['original', 'custom', 'none'];

export function modeOf(card) {
  const a = card && card.audio;
  const mode = a && AUDIO_MODES.includes(a.mode) ? a.mode : 'original';
  return mode === 'custom' && !(a && a.src) ? 'none' : mode;
}

export function createClipAudio(video, { mediaUrl }) {

  // the soundtrack's own element (in the sheet, never shown)
  const track = document.createElement('audio');
  track.className = 'xp-clip__soundtrack';
  track.hidden = true;
  track.preload = 'auto';
  track.loop = true;

  let ctx = null;
  const gains = { video: null, track: null };
  const timers = { video: 0, track: 0 };
  let mode = 'none';
  let src = '';
  let live = false;          // the sheet wants sound now (open, visible, playing)
  let stopTimer = 0;

  /* the elements through the site's context (once, after a gesture) */
  function wire() {
    if (ctx) return true;
    const context = audio();
    if (!context || typeof context.createMediaElementSource !== 'function') return false;
    try {
      [['video', video], ['track', track]].forEach(([name, el]) => {
        const gain = context.createGain();
        gain.gain.value = 0;
        context.createMediaElementSource(el).connect(gain).connect(context.destination);
        gains[name] = gain;
        cancelAnimationFrame(timers[name]);
        el.volume = 1;      // the gain does the fading from now on
      });
      ctx = context;
      return true;
    }
    catch {
      return false;
    }
  }

  /* one element's level, faded (seconds) */
  function level(name, target, seconds) {
    const el = name === 'video' ? video : track;
    cancelAnimationFrame(timers[name]);
    if (ctx && gains[name]) {
      const g = gains[name].gain;
      const now = ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(target, now + Math.max(0.01, seconds));
      return;
    }
    // no context yet: the element's own volume (smooth where the browser allows)
    const from = el.volume;
    const start = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / (Math.max(0.01, seconds) * 1000));
      try { el.volume = Math.max(0, Math.min(1, from + (target - from) * k)); }
      catch { /* read-only (iPhone) */ }
      if (k < 1) timers[name] = requestAnimationFrame(step);
    };
    step();
  }

  const heard = () => soundEnabled() && !document.hidden;

  /* the elements' mute follows the mode (custom / none: the clip is never heard) */
  function mutes() {
    video.muted = mode !== 'original' || !soundEnabled() || (!ctx && !navigator.userActivation?.hasBeenActive);
  }

  return {

    /** the card about to show (before its clip loads) */
    set(card) {
      clearTimeout(stopTimer);
      mode = modeOf(card);
      const next = mode === 'custom' ? mediaUrl(card.audio.src) : '';
      if (next !== src) {
        track.pause();
        src = next;
        if (src) track.src = src;
        else { track.removeAttribute('src'); track.load(); }
      }
      level('video', 0, 0.01);
      level('track', 0, 0.01);
      mutes();
      return mode;
    },

    get mode() { return mode; },

    /** the soundtrack's element (video.js keeps it in the sheet) */
    element: track,

    /** the clip has started: bring its sound in */
    start() {
      live = true;
      wire();
      mutes();
      if (!heard()) return;
      if (mode === 'original') {
        level('video', LEVEL.original, FADE_IN);
      }
      else if (mode === 'custom') {
        track.currentTime = 0;
        track.play().then(() => level('track', LEVEL.custom, FADE_IN), () => {});
      }
    },

    /** paused (a tap on the clip, a hidden tab): the sound goes with it */
    pause() {
      live = false;
      level('video', 0, 0.2);
      level('track', 0, 0.25);
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => track.pause(), 280);
    },

    /** playing again */
    resume() {
      clearTimeout(stopTimer);
      live = true;
      wire();
      mutes();
      if (!heard()) return;
      if (mode === 'original') level('video', LEVEL.original, 0.4);
      else if (mode === 'custom') track.play().then(() => level('track', LEVEL.custom, 0.5), () => {});
    },

    /** fade everything out; resolves when silent (then the caller swaps / unloads) */
    fadeOut(seconds = FADE_OUT) {
      live = false;
      level('video', 0, seconds);
      level('track', 0, seconds);
      clearTimeout(stopTimer);
      return new Promise(resolve => {
        stopTimer = setTimeout(() => {
          track.pause();
          resolve();
        }, seconds * 1000 + 30);
      });
    },

    /** closed: silent at once after the fade, nothing left playing or loading */
    stop(seconds = FADE_OUT) {
      const done = this.fadeOut(seconds).then(() => {
        track.pause();
        if (src) { track.removeAttribute('src'); track.load(); src = ''; }
      });
      return done;
    },

    /** the site's sound setting changed (the speaker) */
    setting() {
      mutes();
      if (!soundEnabled()) {
        level('video', 0, 0.3);
        level('track', 0, 0.3);
        clearTimeout(stopTimer);
        stopTimer = setTimeout(() => track.pause(), 330);
        return;
      }
      if (live) this.resume();
    },

    /** for tests and the admin preview */
    get state() {
      return {
        mode,
        src: track.getAttribute('src') || '',
        trackPaused: track.paused,
        videoMuted: video.muted,
        wired: !!ctx,
        videoLevel: gains.video ? +gains.video.gain.value.toFixed(2) : +video.volume.toFixed(2),
        trackLevel: gains.track ? +gains.track.gain.value.toFixed(2) : +track.volume.toFixed(2)
      };
    }

  };

}
