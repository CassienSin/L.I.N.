(() => {
 'use strict';
 // Hands-free conversation. Press the microphone once and talk; a pause ends your turn.
 // Lin never hears herself: the microphone is ignored while she thinks or speaks.
 const SILENCE_MS_DEFAULT = 700;      // quiet time that ends your turn (adjustable in About you)
 const SPEECH_START_MS = 150;         // sound this long counts as you starting to speak
 const MAX_TURN_MS = 30000;           // longest single turn
 const QUIET_RESTART_MS = 12000;      // start a fresh recording if nothing was said for this long
 const QUIET_OFF_MS = 120000;         // turn hands-free off after two quiet minutes
 const LEVEL_EVERY_MS = 50;           // setInterval, not requestAnimationFrame, so a background tab keeps listening
 const $ = s => document.querySelector(s), button = $('#record'), status = $('#mic-status');
 const token = sessionStorage.getItem('lin-session-token') || '';
 let ready = false, backendBusy = false, closed = false, linBusy = false;
 let active = false, phase = 'off', serial = 0, stream = null, audioCtx = null, analyser = null, samples = null, levelTimer = 0;
 let recorder = null, mime = '', turnStart = 0, lastVoice = 0, voiceSince = 0, quietSince = 0, floor = .01, controller = null;
 let silenceMs = SILENCE_MS_DEFAULT, review = false, resumeTimer = 0;

 function broadcast(busy, label, state = 'ready') { document.dispatchEvent(new CustomEvent('lin:mic-state', {detail: {busy, label, state}})); }
 function say(text) { status.textContent = text; }
 function controls() {
   button.disabled = closed || (!active && (!ready || backendBusy));
   button.classList.toggle('on', active);
   button.setAttribute('aria-pressed', String(active));
   button.setAttribute('aria-label', active ? (linBusy ? 'Interrupt Lin and talk' : 'Stop talking hands-free') : 'Talk hands-free');
   $('#mic-indicator').textContent = active ? 'on' : 'off';
 }
 function level(value) { $('#orb').style.setProperty('--mic', value.toFixed(3)); }

 function stopRecorder(discard = true) {
   if (!recorder) return;
   const r = recorder; recorder = null;
   if (discard) r.ondataavailable = r.onstop = null;
   if (r.state !== 'inactive') try { r.stop(); } catch {}
 }

 function stop(message = 'Hands-free off. Microphone off.') {
   serial++; active = false; phase = 'off'; clearTimeout(resumeTimer);
   controller?.abort(); controller = null; stopRecorder(true);
   clearInterval(levelTimer); levelTimer = 0; level(0);
   if (stream) { stream.getTracks().forEach(t => { t.onended = null; t.stop(); }); stream = null; }
   if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; analyser = null; }
   say(message); controls(); broadcast(false, 'READY WHEN YOU ARE');
 }

 function startRecorder(run) {
   const chunks = [], r = new MediaRecorder(stream, {mimeType: mime, audioBitsPerSecond: 64000});
   r.ondataavailable = e => { if (run === serial && e.data.size) chunks.push(e.data); };
   r.onstop = () => { if (run === serial && phase === 'transcribing') upload(new Blob(chunks, {type: mime}), run); };
   r.onerror = () => { if (run === serial) stop('The microphone recording failed. Press the microphone to try again.'); };
   r.start(200); recorder = r; turnStart = performance.now(); voiceSince = 0;
 }

 function listen() {
   if (!active || closed) return;
   clearTimeout(resumeTimer);
   if (linBusy) { phase = 'deaf'; stopRecorder(true); say('Lin is answering. I’ll listen again when she’s done. Press Space to interrupt.'); controls(); broadcast(false, null); return; }
   phase = 'listening'; startRecorder(serial); quietSince = quietSince || performance.now();
   say('Listening. Just talk.'); controls(); broadcast(true, 'LISTENING', 'listening');
 }

 function endTurn() {
   if (phase !== 'speaking') return;
   phase = 'transcribing'; say('Got it. Transcribing on this computer…'); controls(); broadcast(true, 'TRANSCRIBING', 'transcribing');
   const r = recorder; recorder = null; if (r && r.state !== 'inactive') r.stop();
 }

 function sample() {
   if (!analyser) return;
   analyser.getFloatTimeDomainData(samples);
   let sum = 0; for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
   const rms = Math.sqrt(sum / samples.length), now = performance.now();
   const threshold = Math.max(.012, floor * 3.2);
   if (phase === 'listening' || phase === 'speaking') level(Math.min(1, rms / (threshold * 3))); else level(0);
   if (phase === 'listening') {
     if (rms < threshold) { floor = floor * .97 + rms * .03; voiceSince = 0; }
     else if (!voiceSince) voiceSince = now;
     if (voiceSince && now - voiceSince >= SPEECH_START_MS) { phase = 'speaking'; lastVoice = now; quietSince = 0; say('Hearing you…'); }
     else if (now - turnStart > QUIET_RESTART_MS) { stopRecorder(true); startRecorder(serial); }
     if (quietSince && now - quietSince > QUIET_OFF_MS) stop('Hands-free turned off after two quiet minutes. Microphone off.');
   } else if (phase === 'speaking') {
     if (rms >= threshold * .7) lastVoice = now;
     if (now - lastVoice >= silenceMs || now - turnStart >= MAX_TURN_MS) endTurn();
   }
 }

 async function upload(blob, run) {
   if (run !== serial) return;
   if (blob.size < 100) { listen(); return; }
   if (blob.size > 2 * 1024 * 1024) { say('That was too long for one turn. Try a shorter request.'); listen(); return; }
   controller = new AbortController();
   try {
     const res = await fetch('/api/transcribe', {method: 'POST', headers: {'X-Lin-Token': token, 'Content-Type': blob.type}, body: blob, signal: controller.signal});
     const result = await res.json(); controller = null;
     if (run !== serial) return;
     if (!res.ok) throw Error(result.error || 'Local transcription failed.');
     if (result.no_speech || !result.text?.trim()) { say('I didn’t catch that. Still listening.'); phase = 'off'; listen(); return; }
     const text = result.text.trim().slice(0, 1000), input = $('#request-input');
     input.value = text; input.dispatchEvent(new Event('input'));
     if (review) { stop(`I heard: “${text}”. Edit it if you like, then press Enter.`); input.focus(); return; }
     phase = 'sent'; say(`You said: “${text}”`); controls(); broadcast(false, null);
     $('#ask-form').requestSubmit();
     // If Lin did not start (for example, still loading), keep listening.
     resumeTimer = setTimeout(() => { if (active && phase === 'sent' && !linBusy) listen(); }, 1500);
   } catch (err) {
     if (run !== serial) return;
     if (err.name === 'AbortError') return;
     say(err.message + ' Still listening.'); phase = 'off'; listen();
   }
 }

 async function start() {
   if (active || !ready || backendBusy || closed) return;
   if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { say('Microphone capture is unavailable in this browser.'); $('#mic-recovery').hidden = false; return; }
   mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t)) || '';
   if (!mime) { say('This browser cannot record a supported audio format.'); $('#mic-recovery').hidden = false; return; }
   const run = ++serial; active = true; phase = 'requesting'; controls();
   say('Waiting for your browser’s microphone permission…'); broadcast(true, 'WAITING FOR MICROPHONE', 'requesting');
   try {
     const acquired = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: false});
     if (run !== serial) { acquired.getTracks().forEach(t => t.stop()); return; }
     stream = acquired; $('#mic-recovery').hidden = true;
     stream.getTracks().forEach(t => { t.onended = () => { if (run === serial) stop('Microphone disconnected. Hands-free off.'); }; });
     audioCtx = new AudioContext(); const source = audioCtx.createMediaStreamSource(stream);
     analyser = audioCtx.createAnalyser(); analyser.fftSize = 1024; samples = new Float32Array(analyser.fftSize); source.connect(analyser);
     floor = .01; quietSince = performance.now(); levelTimer = setInterval(sample, LEVEL_EVERY_MS);
     listen();
   } catch (err) {
     if (run !== serial) return;
     const messages = {NotAllowedError: 'Microphone access was not granted.', SecurityError: 'This browser blocked the microphone.', NotFoundError: 'No microphone was found. Connect one and try again.', NotReadableError: 'The microphone is busy. Close other recording apps and retry.'};
     stop((messages[err.name] || 'Could not start the microphone.') + ' Help is in About you.');
     $('#mic-recovery').hidden = !['NotAllowedError', 'SecurityError'].includes(err.name);
   }
 }

 button.addEventListener('click', () => {
   if (!active) return start();
   if (linBusy) { document.dispatchEvent(new Event('lin:interrupt')); return; }
   stop();
 });
 document.addEventListener('keydown', e => {
   if (e.key !== ' ' || !active || !linBusy) return;
   if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement?.tagName || '')) return;
   e.preventDefault(); document.dispatchEvent(new Event('lin:interrupt'));
 });
 document.addEventListener('lin:work-state', e => {
   const was = linBusy; linBusy = !!e.detail.lin; closed = !!e.detail.closed;
   if (active && linBusy && (phase === 'listening' || phase === 'speaking' || phase === 'sent')) {
     // Lin started talking: go deaf, discard anything recorded.
     clearTimeout(resumeTimer); stopRecorder(true); phase = 'deaf'; level(0);
     say('Lin is answering. I’ll listen again when she’s done. Press Space to interrupt.'); broadcast(false, null);
   } else if (active && was && !linBusy && (phase === 'deaf' || phase === 'sent')) {
     resumeTimer = setTimeout(listen, 350);
   }
   controls();
 });
 document.addEventListener('lin:mic-settings', e => { silenceMs = e.detail.silenceMs || SILENCE_MS_DEFAULT; review = !!e.detail.review; });
 $('#open-browser').addEventListener('click', async () => {
   if (closed || active) return;
   try {
     const res = await fetch('/api/open-browser', {method: 'POST', headers: {'X-Lin-Token': token, 'Content-Type': 'application/json'}, body: '{}'});
     const result = await res.json(); if (!res.ok) throw Error(result.error || 'Could not open the browser.');
     say('Lin opened in your default browser. Press the microphone there and allow access.');
   } catch (err) { say(err.message); }
 });
 $('#use-transcript').addEventListener('click', () => { const t = $('#transcript').value.trim(); if (t) { $('#request-input').value = t; $('#request-input').dispatchEvent(new Event('input')); } });
 document.addEventListener('lin:recognition-status', e => {
   const s = e.detail || {}; ready = !!s.ready; backendBusy = !!s.busy && phase !== 'transcribing';
   if (!ready && active) stop(s.error || 'Local transcription is unavailable. Hands-free off.');
   if (!active && !ready) say(s.error || 'Loading local English recognition…');
   else if (!active && status.textContent === 'Loading local English recognition…') say('Press the microphone and just talk.');
   controls();
 });
 document.addEventListener('lin:cancel-mic', () => stop());
 document.addEventListener('lin:close-mic', () => { closed = true; stop('Session closed. Microphone off.'); });
 window.addEventListener('pagehide', () => stop());
 window.linMic = {state: () => ({active, phase, linBusy, silenceMs})};
 controls();
})();
