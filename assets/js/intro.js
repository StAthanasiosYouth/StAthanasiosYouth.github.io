/*
 * INTRO: a first visit's opening (classic script in <head>: decides before
 * the first paint). No overlay: the real hero is staged by main.css INTRO
 * while the page renders underneath; feel.js times the sections. Never in
 * the preview, with reduced motion, on weak devices / data saver, for deep
 * links, hidden tabs, frames, or twice a session. Input fast-forwards it.
 * <html data-intro="play" data-intro-state="playing|done" data-intro-at>
 */
(function () {

  'use strict';

  var html = document.documentElement;
  var KEY = 'athanasios:intro';
  var END = 2700;     // ms; main.css INTRO uses the same times
  var EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
  // the intro's own animations, and the entrances it delays
  var STAGED = /^(intro-|rise-depth$|arch-in$|cross-in$|name-in$)/;

  function seen() {
    try { return sessionStorage.getItem(KEY) === '1'; }
    catch (error) { return true; }
  }

  function weak() {
    var cores = navigator.hardwareConcurrency || 8;
    var memory = navigator.deviceMemory || 8;
    return cores <= 4 && memory <= 4 || memory <= 2 || !!(navigator.connection && navigator.connection.saveData);
  }

  function framed() {
    try { return window.top !== window.self; }
    catch (error) { return true; }
  }

  if (
    html.hasAttribute('data-preview') ||
    (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ||
    location.hash.length > 1 ||
    document.visibilityState === 'hidden' ||
    framed() || weak() || seen() ||
    !document.getAnimations || !window.CSS || !CSS.supports('translate', '1px')
  ) {
    return;
  }

  try { sessionStorage.setItem(KEY, '1'); }
  catch (error) { /* it plays this once anyway */ }

  html.setAttribute('data-intro', 'play');
  html.setAttribute('data-intro-state', 'playing');
  html.setAttribute('data-intro-at', String(Math.round(performance.now())));

  var timer = setTimeout(finish, END);

  function finish() {
    if (html.getAttribute('data-intro-state') === 'done') return;
    clearTimeout(timer);
    html.setAttribute('data-intro-state', 'done');
    EVENTS.forEach(function (type) { removeEventListener(type, skip, true); });
    document.removeEventListener('visibilitychange', onHidden);
  }

  // the visitor wants the page: what is still on its way arrives in a few frames
  function skip() {
    if (html.getAttribute('data-intro-state') === 'done') return;
    document.getAnimations().forEach(function (animation) {
      if (!STAGED.test(animation.animationName || '')) return;
      if (animation.updatePlaybackRate) animation.updatePlaybackRate(7);
      else animation.playbackRate = 7;
    });
    finish();
  }

  function onHidden() {
    if (document.hidden) skip();
  }

  EVENTS.forEach(function (type) { addEventListener(type, skip, { capture: true, passive: true }); });
  document.addEventListener('visibilitychange', onHidden);

}());
