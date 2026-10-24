(() => {
 'use strict';
 // Lin's sounds: short and soft, made on this PC with Web Audio (no files, nothing downloaded).
 // They follow what Lin is actually doing, stay quiet when she is muted or sounds are off in Settings > Look,
 // and never play over her voice.
 const $ = s => document.querySelector(s);
 let ctx = null, master = null, hum = null, lastState = document.body.dataset.state, lastPresence = document.body.dataset.presence;
 const enabled = () => (window.linTheme?.get('sounds') ?? 'on') !== 'off' && !$('#mute')?.checked;
 const allowed = () => !navigator.userActivation || navigator.userActivation.hasBeenActive || document.documentElement.dataset.autoplay === '1';
 function audio() {
   if (!ctx && !allowed()) return null;  // browsers only allow sound after your first click or key press
   if (!ctx) {
     const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
     ctx = new C(); master = ctx.createGain(); master.gain.value = .55; master.connect(ctx.destination);
   }
   if (ctx.state === 'suspended') ctx.resume().catch(() => {});
   return ctx.state === 'running' ? ctx : null;
 }
 // Browsers allow sound only after the first click or key; get ready then.
 for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => audio(), {once: true, capture: true});

 function tone(c, out, t, freq, start, dur, type, gain, endFreq) {
   const o = c.createOscillator(), g = c.createGain();
   o.type = type; o.frequency.setValueAtTime(freq, t + start);
   if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + start + dur);
   g.gain.setValueAtTime(.0001, t + start); g.gain.exponentialRampToValueAtTime(gain, t + start + .015); g.gain.exponentialRampToValueAtTime(.0001, t + start + dur);
   o.connect(g); g.connect(out); o.start(t + start); o.stop(t + start + dur + .05);
 }
 const SOUNDS = {
   startup: (c, o, t) => { tone(c, o, t, 220, 0, .7, 'sine', .12, 660); tone(c, o, t, 880, .62, .35, 'sine', .12); tone(c, o, t, 1320, .72, .5, 'sine', .09); },
   listen: (c, o, t) => { tone(c, o, t, 880, 0, .14, 'sine', .16); tone(c, o, t, 1320, .09, .22, 'sine', .12); },
   send: (c, o, t) => { tone(c, o, t, 420, 0, .22, 'sine', .1, 960); },
   approve: (c, o, t) => { tone(c, o, t, 1400, 0, .05, 'triangle', .18); tone(c, o, t, 2100, .06, .09, 'triangle', .12); },
   attention: (c, o, t) => { tone(c, o, t, 660, 0, .18, 'sine', .08); tone(c, o, t, 990, .14, .26, 'sine', .07); },
   seeing: (c, o, t) => { tone(c, o, t, 523.25, 0, .5, 'sine', .08); tone(c, o, t, 659.25, 0, .5, 'sine', .07); tone(c, o, t, 783.99, .1, .45, 'sine', .05); },
   blocked: (c, o, t) => { tone(c, o, t, 262, 0, .16, 'sine', .14, 220); tone(c, o, t, 196, .13, .26, 'sine', .12, 175); }
 };
 const played = [];
 function play(name) {
   if (!enabled() || document.body.dataset.state === 'speaking') return false;
   const c = audio(); if (!c) return false;
   SOUNDS[name](c, master, c.currentTime + .02); played.push({name, at: Date.now()}); if (played.length > 30) played.shift();
   return true;
 }
 // The thinking hum: two close low notes that beat slowly, until she starts to speak.
 function startHum() {
   if (hum || !enabled()) return; const c = audio(); if (!c) return;
   const g = c.createGain(); g.gain.setValueAtTime(.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(.05, c.currentTime + .6); g.connect(master);
   const oscs = [110, 111.6, 165].map((f, i) => { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; const og = c.createGain(); og.gain.value = i === 2 ? .35 : 1; o.connect(og); og.connect(g); o.start(); return o; });
   hum = {g, oscs}; played.push({name: 'think', at: Date.now()});
 }
 function stopHum() {
   if (!hum || !ctx) return; const {g, oscs} = hum; hum = null;
   g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setValueAtTime(Math.max(.0001, g.gain.value), ctx.currentTime); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .35);
   for (const o of oscs) o.stop(ctx.currentTime + .4);
 }
 const THINKING = new Set(['thinking', 'transcribing']);
 new MutationObserver(() => {
   const state = document.body.dataset.state, presence = document.body.dataset.presence;
   if (state !== lastState) {
     if (state === 'listening') play('listen');
     if (THINKING.has(state)) startHum(); else stopHum();
     if (state === 'error' && lastState !== 'error') play('blocked');
     lastState = state;
   }
   if (presence !== lastPresence) { if (presence === 'needs-you') play('attention'); lastPresence = presence; }
 }).observe(document.body, {attributes: true, attributeFilter: ['data-state', 'data-presence']});
 $('#ask-form')?.addEventListener('submit', () => play('send'), true);
 document.addEventListener('lin:approved', e => play(e.detail?.state === 'executed' ? 'approve' : 'blocked'));
 document.addEventListener('lin:declined', () => play('blocked'));
 $('#mute')?.addEventListener('change', () => { if ($('#mute').checked) stopHum(); });
 document.addEventListener('lin:theme', () => { if (!enabled()) stopHum(); });
 // The wake-up chime plays once, when the start-up sequence runs and the browser allows sound.
 // (In the browser that is only when sound is already allowed; the Windows app will allow it from the start.)
 if (document.documentElement.dataset.reopened !== '1') setTimeout(() => play('startup'), 250);
 window.linSounds = {play, names: Object.keys(SOUNDS), played: () => played.slice(), humming: () => !!hum};
})();
