(() => {
 'use strict';
 const $ = s => document.querySelector(s);
 const audio = $('#audio'), input = $('#response-input');
 const supplied = new URLSearchParams(location.hash.slice(1)).get('token');
 if (supplied) { sessionStorage.setItem('lin-session-token', supplied); history.replaceState(null, '', '/'); }
 const token = sessionStorage.getItem('lin-session-token') || '';
 const reduced = matchMedia('(prefers-reduced-motion: reduce)');
 let epoch = 0, jobId = null, pollTimer, engineTimer, engineReady = false, engineBusy = false;
 let buffers = [], texts = [], current = -1, done = false, paused = false, running = false;
 let ctx, analyser, samples, raf = 0, requestedAt = 0, firstPlayed = false;
 let micBusy = false;
 let reasoningReady = false, reasoningBusy = false, answerMode = false;
 let requestRevision=null,knowledgeRevision=0;
 let spokenPlanRevision=null,latestPlanRevision=null;
 let spokenBriefRevision=null,latestBriefAsOf='';
 let sayText=null,lastVerification=null;
 let pending=null;   // a follow-up request from a card: {claude: approval id, text} or {local: true, text}
 // While Claude is answering, the emblem and the place chip show the link is open.
 function online(on) {
   document.body.dataset.online = on ? 'claude' : '';
   const t = $('#place-text'); if (t) t.textContent = on ? 'Online · Claude' : 'On this PC';
 }
 let conversation = sessionStorage.getItem('lin-conversation');
 if (!/^[a-f0-9]{32}$/.test(conversation || '')) {
   conversation = crypto.randomUUID().replaceAll('-', '');
   sessionStorage.setItem('lin-conversation', conversation);
 }
 // Reopened Lin: carry on the conversation from where it was saved (it lives on this PC, not in the browser).
 const newConversation = () => { conversation = crypto.randomUUID().replaceAll('-', ''); sessionStorage.setItem('lin-conversation', conversation); };
 fetch('/api/conversation/resume', {method: 'POST', headers: {'X-Lin-Token': sessionStorage.getItem('lin-session-token') || '', 'Content-Type': 'application/json'}, body: JSON.stringify({conversation})})
   .then(r => r.ok ? r.json() : null).then(d => {
     if (!d || !d.resumed || !/^[a-f0-9]{32}$/.test(d.conversation || '')) return;
     conversation = d.conversation; sessionStorage.setItem('lin-conversation', conversation);
     const at = new Date(d.updated_at).toLocaleTimeString('en-PH', {timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit'});
     const note = document.querySelector('#context-state'); if (note) note.textContent = `Picking up our conversation from ${at}: “${d.title}”.`;
     document.dispatchEvent(new CustomEvent('lin:conversation-resumed', {detail: d}));
   }).catch(() => {});
 const canvas = $('#waveform'), pen = canvas.getContext('2d');
 const clock = s => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
 function state(name, label) { document.body.dataset.state = name; $('#voice-state').textContent = label; }
 function controls() {
   $('#generate').disabled = !engineReady || engineBusy || running || micBusy;
   $('#demo').disabled = !engineReady || engineBusy || running || micBusy;
   $('#ask').disabled = !engineReady || !reasoningReady || reasoningBusy || engineBusy || running || micBusy;
   $('#clear-context').disabled = running || engineBusy || reasoningBusy || micBusy || !engineReady;
   $('#pause').disabled = !running || !buffers.length;
   $('#pause').textContent = paused ? 'Resume' : 'Pause';
   $('#stop').disabled = !running;
   $('#replay').disabled = running || micBusy || !buffers.length;
   $('#interrupt-anywhere').disabled = !running;
   document.dispatchEvent(new CustomEvent('lin:work-state',{detail:{busy:running||engineBusy||reasoningBusy||micBusy,lin:running||engineBusy||reasoningBusy,closed:$('#shutdown').disabled,voiceReady:engineReady}}));
 }
 async function api(path, options = {}) {
   const res = await fetch(path, {...options, headers: {'X-Lin-Token': token, 'Content-Type': 'application/json', ...options.headers}});
   if (!res.ok) { const data = await res.json().catch(() => ({})); throw Error(data.error || 'The local voice connection failed.'); }
   return res;
 }
 async function refreshEngine() {
   try {
     const s = await (await api('/api/status')).json();
     engineReady = s.ready; engineBusy = s.busy;
     document.dispatchEvent(new CustomEvent('lin:status',{detail:s}));
     reasoningReady = !!s.reasoning?.ready; reasoningBusy = !!s.reasoning?.busy;
     document.dispatchEvent(new CustomEvent('lin:brain-status',{detail:s.brain}));
     document.dispatchEvent(new CustomEvent('lin:planner-status',{detail:{revision:s.planner_revision}}));
     document.dispatchEvent(new CustomEvent('lin:today-status',{detail:{revision:s.today_revision,asof:s.today_asof}}));
     document.dispatchEvent(new CustomEvent('lin:actions-status',{detail:{revision:s.actions_revision}}));
     $('#reasoning-state').textContent = s.reasoning?.error || (!reasoningReady ? 'Loading local reasoning…' : reasoningBusy ? 'Thinking on this computer…' : 'Local reasoning ready · English');
     document.dispatchEvent(new CustomEvent('lin:recognition-status', {detail:s.transcription}));
     $('#engine-dot').classList.toggle('ready', s.ready && !s.busy);
     $('#engine-state').textContent = s.error || (!s.ready ? 'Loading voice on this computer…' : s.busy ? 'Generating locally…' : 'Local voice ready · English');
     if (s.error && !running && !micBusy) state('error', 'VOICE UNAVAILABLE');
     controls();
   } catch (err) {
     engineReady = false; reasoningReady = false; controls(); $('#engine-state').textContent = err.message;
     $('#reasoning-state').textContent = 'Local reasoning unavailable. Reopen Lin to reconnect.';
     document.dispatchEvent(new CustomEvent('lin:recognition-status', {detail:{ready:false,error:'The local service is unavailable.'}}));
   }
 }
 function audioGraph() {
   try {
     if (!ctx) {
       ctx = new AudioContext();
       const source = ctx.createMediaElementSource(audio);
       analyser = ctx.createAnalyser(); analyser.fftSize = 512;
       source.connect(analyser); analyser.connect(ctx.destination);
       samples = new Uint8Array(analyser.fftSize);
     }
     return ctx.resume().catch(() => {});
   } catch { return Promise.resolve(); }
 }
 function frame() {
   cancelAnimationFrame(raf); raf = 0;
   const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
   $('#progress').value = duration ? audio.currentTime / duration : 0;
   $('#clock').textContent = `${clock(audio.currentTime)} / ${clock(duration)}`;
   pen.clearRect(0, 0, canvas.width, canvas.height);
   pen.strokeStyle = '#79dce0'; pen.lineWidth = 1.5; pen.beginPath();
   let energy = 0;
   if (analyser && !audio.paused && !audio.ended && !audio.muted && !reduced.matches) {
     analyser.getByteTimeDomainData(samples);
     for (let i = 0; i < samples.length; i++) {
       const value = (samples[i] - 128) / 128;
       energy += value * value;
       const x = i / (samples.length - 1) * canvas.width, y = canvas.height / 2 + value * canvas.height * .85;
       i ? pen.lineTo(x, y) : pen.moveTo(x, y);
     }
     energy = Math.min(1, Math.sqrt(energy / samples.length) * 5);
   } else { pen.moveTo(0, 32); pen.lineTo(canvas.width, 32); }
   pen.stroke(); $('#orb').style.setProperty('--energy', energy.toFixed(3));
   if (!audio.paused && !audio.ended && running) raf = requestAnimationFrame(frame);
 }
 function drawSentences() {
   const list = $('#sentences'); list.replaceChildren();
   texts.forEach((text, index) => {
     const li = document.createElement('li'); li.textContent = text; li.dataset.index = index;
     list.append(li);
   });
 }
 function highlight() {
   $('#sentences').querySelectorAll('li').forEach((li, i) => {
     li.classList.toggle('active', i === current);
     li.classList.toggle('done', i < current);
     if (i === current) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
   });
 }
 function clearSource() { audio.pause(); audio.removeAttribute('src'); audio.load(); frame(); }
 function releaseBuffers() { buffers.forEach(b => URL.revokeObjectURL(b.url)); buffers = []; }
 function finished() {
   running = false; paused = false; online(false); state('complete', 'READY WHEN YOU ARE');
   // How smooth it was: the longest pause between two sentences (the voice plan's target is under 200 ms).
   const longest = gaps.length ? Math.max(...gaps) : null;
   $('#detail').textContent = 'Finished. Replay the response whenever you like.' + (longest !== null ? ` Longest pause between sentences: ${longest} ms.` : '');
   $('#sentences').querySelectorAll('li').forEach(li => { li.classList.remove('active'); li.classList.add('done'); li.removeAttribute('aria-current'); });
   controls(); frame();
 }
 async function playCurrent(run) {
   try { await audio.play(); }
   catch (err) {
     if (run !== epoch || !running) return;
     paused = true; state('paused', 'READY TO PLAY');
     $('#detail').textContent = 'Press Resume to enable audio playback.'; controls();
   }
 }
 function advance(run) {
   if (run !== epoch || !running || paused || audio.hasAttribute('src')) return;
   if (current + 1 < buffers.length) {
     current++; audio.src = buffers[current].url; highlight();
     $('#source-label').textContent = buffers[current].cached ? 'Saved audio' : 'New local speech';
     playCurrent(run);
   } else if (done) finished();
   else state('waiting', 'PREPARING NEXT SENTENCE');
 }
 async function poll(run) {
   if (run !== epoch || !jobId) return;
   try {
     const job = await (await api(`/api/jobs/${jobId}`)).json();
     if (run !== epoch) return;
     document.dispatchEvent(new CustomEvent('lin:job', {detail: job}));
     const viaClaude = job.decision?.tool === 'claude' && !job.checked?.fallback;
     online(viaClaude && job.status === 'thinking');
     if (answerMode && job.texts.length > texts.length) {
       const first = !texts.length;
       texts = job.texts; drawSentences(); highlight();
       if (first) {
         $('#source-label').textContent = viaClaude ? 'Claude’s answer · spoken on this computer' : 'Answer generated on this computer';
         $('#context-state').textContent = 'Recent chat stays in this session. Only facts you explicitly save become lasting memory.';
         document.dispatchEvent(new CustomEvent('lin:answer-context',{detail:job}));
         lastVerification = job.verification ?? null;
         const ready = job.first_text_seconds ?? job.reasoning_seconds ?? 0;
         $('#detail').textContent = job.streaming ? `First sentence ready in ${ready.toFixed(2)} s. Lin speaks while she finishes the rest…` : `Answer ready in ${ready.toFixed(2)} s. Preparing her voice…`;
       }
     }
     if (answerMode && texts.length && (job.verification ?? null) !== lastVerification) {
       lastVerification = job.verification ?? null;
       document.dispatchEvent(new CustomEvent('lin:answer-context',{detail:job}));
     }
     for (const segment of job.segments.slice(buffers.length)) {
       const response = await api(`/api/jobs/${jobId}/audio/${segment.index}`);
       const blob = await response.blob();
       if (run !== epoch) return;
       buffers.push({...segment, url: URL.createObjectURL(blob)});
       advance(run);
     }
     if (job.status === 'error') throw Error(job.error || 'Local speech generation failed.');
     if (job.status === 'cancelled') { interrupt(); return; }
     done = job.status === 'complete';
     if (job.status === 'thinking') state('thinking', viaClaude ? 'ASKING CLAUDE' : 'THINKING LOCALLY');
     else advance(run);
     controls();
     if (!done) pollTimer = setTimeout(() => poll(run), 250);
     else refreshEngine();
   } catch (err) {
     if (run !== epoch) return;
     interrupt(); state('error', 'VOICE STOPPED'); $('#detail').textContent = err.message;
   }
 }
 async function start(demo = false, ask = false, planRevision = null, briefRevision = null) {
   if (running || micBusy || !engineReady || engineBusy) return;
   const asked = pending; pending = null;
   const askText = asked ? asked.text : $('#request-input').value;
   if (ask && (!reasoningReady || reasoningBusy || !askText.trim())) return;
   const run = ++epoch; requestedAt = performance.now(); firstPlayed = false;
   requestRevision=null;
   spokenPlanRevision=planRevision;
   spokenBriefRevision=briefRevision;
   running = true; paused = false; done = false; current = -1; jobId = null; gaps = []; endedAt = 0;
   clearTimeout(pollTimer); clearSource(); releaseBuffers();
   texts = []; answerMode = ask; lastVerification = null; drawSentences();
   document.dispatchEvent(new Event('lin:response-cleared'));
   $('#request-echo').hidden = !ask;
   $('#request-echo').textContent = ask ? askText.trim() : '';
   state(ask ? 'thinking' : 'preparing', ask ? 'THINKING LOCALLY' : demo ? 'LOADING SAVED INTRODUCTION' : 'PREPARING YOUR RESPONSE');
   $('#detail').textContent = demo ? 'Playing the saved example; no new generation is needed.' : 'The first sentence will play as soon as it is ready.';
   $('#source-label').textContent = demo ? 'Saved introduction' : 'Generating locally';
   if (ask) $('#detail').textContent = 'Lin is considering your request on this computer. You can interrupt at any time.';
   controls(); audioGraph();
   if (ask && matchMedia('(max-width: 780px)').matches) $('#caption').scrollIntoView({block:'center',behavior:reduced.matches?'instant':'smooth'});
   try {
     const response = await (await api(briefRevision!==null ? '/api/today/speak' : planRevision!==null ? '/api/planner/speak' : ask ? '/api/ask' : demo ? '/api/demo' : '/api/speak', {method:'POST', body:JSON.stringify(briefRevision!==null ? {revision:briefRevision} : planRevision!==null ? {revision:planRevision} : ask ? {text:askText, conversation, mode:asked ? 'chat' : $('#request-mode').value, ...(asked?.claude ? {claude:asked.claude} : {}), ...(asked?.local ? {local:true} : {})} : demo ? {} : {text:sayText??input.value})})).json();
     sayText=null;
     if (run !== epoch) {
       await api(`/api/jobs/${response.id}/cancel`, {method:'POST', body:'{}'}).catch(() => {});
       return;
     }
     jobId = response.id; requestRevision=response.brain_revision??null;
     if (ask && !asked) { $('#request-input').value=''; $('#request-input').dispatchEvent(new Event('input')); }
     if(planRevision!==null){
       spokenPlanRevision=response.plan_revision;
       if(latestPlanRevision!==null&&latestPlanRevision>spokenPlanRevision){interrupt();return;}
       $('#request-echo').hidden=false;$('#request-echo').textContent='Your focus plan · based on your saved tasks and time budget';
     }
     if(briefRevision!==null){spokenBriefRevision=response.brief_revision;$('#request-echo').hidden=false;$('#request-echo').textContent='Today’s briefing · imported calendar and saved tasks · Manila time';}
     if(ask && requestRevision!==null && knowledgeRevision>requestRevision){interrupt();return;}
     texts = response.texts; drawSentences(); poll(run);
   } catch (err) {
     if (run !== epoch) return;
     running = false; state('error', 'COULD NOT START'); $('#detail').textContent = err.message;
     controls(); refreshEngine();
   }
 }
 function interrupt() {
   const old = jobId; epoch++; jobId = null; running = false; paused = false; online(false);
   clearTimeout(pollTimer); clearSource(); state('stopped', 'INTERRUPTED');
   $('#detail').textContent = 'Playback stopped. Any unfinished sentence is discarded; local computation may take a moment to finish.';
   $('#sentences').querySelectorAll('li').forEach(li => { li.classList.remove('active'); li.removeAttribute('aria-current'); });
   controls();
   if (old) api(`/api/jobs/${old}/cancel`, {method:'POST', body:'{}'}).then(refreshEngine).catch(() => {});
 }
 $('#speak-form').addEventListener('submit', e => { e.preventDefault(); start(); });
 $('#ask-form').addEventListener('submit', e => {
   e.preventDefault();
   if($('#request-mode').value==='chat'&&/^(please\s+)?plan my day[.!?]?$/i.test($('#request-input').value.trim())){
     document.dispatchEvent(new CustomEvent('lin:view',{detail:'planner'}));return;
   }
   if($('#request-mode').value==='chat'&&/^(please\s+)?brief me[.!?]?$/i.test($('#request-input').value.trim())){
     document.dispatchEvent(new CustomEvent('lin:view',{detail:'today'}));return;
   }
   start(false, true);
 });
 document.addEventListener('lin:speak-plan',e=>{
   if(!Number.isInteger(e.detail.revision)||running||micBusy||!engineReady||engineBusy)return;
   document.dispatchEvent(new CustomEvent('lin:view',{detail:'chat'}));start(false,false,e.detail.revision);
 });
 // From the "Send to Claude?" card: once Lin is free, ask again with the approval (or here, on this PC).
 function whenFree(request) {
   if (running) interrupt();
   let tries = 0;
   const tick = () => {
     if (!running && !micBusy && engineReady && !engineBusy && reasoningReady && !reasoningBusy) { pending = request; start(false, true); return; }
     if (++tries < 80) setTimeout(tick, 250);
     else $('#detail').textContent = 'Lin is still busy. Ask again in a moment.';
   };
   tick();
 }
 document.addEventListener('lin:send-claude', e => { if (/^[a-f0-9]{32}$/.test(e.detail?.id || '') && e.detail.question) whenFree({claude: e.detail.id, text: e.detail.question}); });
 document.addEventListener('lin:ask-local', e => { if (e.detail?.question) whenFree({local: true, text: e.detail.question}); });
 document.addEventListener('lin:say',e=>{
   if(typeof e.detail.text!=='string'||running||micBusy||!engineReady||engineBusy)return;
   sayText=e.detail.text;start();
 });
 document.addEventListener('lin:speak-briefing',e=>{
   if(typeof e.detail.revision!=='string'||running||micBusy||!engineReady||engineBusy)return;
   document.dispatchEvent(new CustomEvent('lin:view',{detail:'chat'}));start(false,false,null,e.detail.revision);
 });
 document.addEventListener('lin:today-status',e=>{
   if(!e.detail.asof||e.detail.asof<latestBriefAsOf)return;latestBriefAsOf=e.detail.asof;
   if(spokenBriefRevision===null||e.detail.revision===spokenBriefRevision)return;
   if(running)interrupt();clearSource();releaseBuffers();texts=[];current=-1;drawSentences();spokenBriefRevision=null;
   $('#request-echo').hidden=true;$('#detail').textContent='Your briefing changed. Review Today before listening again.';controls();
 });
 document.addEventListener('lin:planner-status',e=>{
   const revision=e.detail.revision;if(!Number.isInteger(revision))return;
   latestPlanRevision=Math.max(latestPlanRevision??0,revision);
   if(spokenPlanRevision===null||revision<=spokenPlanRevision)return;
   if(running)interrupt();
   clearSource();releaseBuffers();texts=[];current=-1;drawSentences();spokenPlanRevision=null;
   $('#request-echo').hidden=true;$('#detail').textContent='Your plan changed. Review the current plan before listening again.';controls();
 });
 $('#request-input').addEventListener('input', () => { $('#request-count').textContent = `${$('#request-input').value.length} / 1000`; });
 $('#clear-context').addEventListener('click', async () => {
   $('#clear-context').disabled = true;
   try {
     await api('/api/conversation/clear', {method:'POST', body:JSON.stringify({conversation})});
     newConversation();  // a fresh conversation; the saved one stays on this PC until you ask Lin to forget it
     epoch++; jobId = null; clearTimeout(pollTimer); clearSource(); releaseBuffers();
     texts = []; current = -1; drawSentences(); $('#request-echo').hidden = true; $('#request-echo').textContent = '';
     $('#request-input').value = ''; $('#request-input').dispatchEvent(new Event('input'));
     $('#transcript').value = ''; $('#transcript-panel').hidden = true;
     $('#mic-timer').textContent = '0:00 / 0:30';
     $('#mic-status').textContent = 'Microphone off. Press Talk to Lin when you’re ready.';
     $('#context-state').textContent = 'Started a new conversation. Earlier ones stay saved on this PC until you ask Lin to forget them.';
     $('#source-label').textContent = 'Ready for a new conversation';
     document.dispatchEvent(new Event('lin:response-cleared'));
     $('#detail').textContent = 'Previous exchanges will not be included in new requests.';
     state('ready', 'READY WHEN YOU ARE');
   } catch (err) { $('#context-state').textContent = err.message; }
   finally { controls(); }
 });
 $('#demo').addEventListener('click', () => start(true));
 document.addEventListener('lin:interrupt',()=>{if(running)interrupt();});
 document.addEventListener('lin:knowledge-changed',e=>{
   knowledgeRevision=e.detail.revision;
   // A note Lin itself just saved (or undid) does not make the answer on screen stale.
   if(window.linOwnBrainWrite&&Date.now()-window.linOwnBrainWrite<20000){window.linOwnBrainWrite=0;return;}
   if(running && (requestRevision===null || knowledgeRevision<=requestRevision))return;
   if(running)interrupt();
   clearSource();releaseBuffers();texts=[];drawSentences();
   document.dispatchEvent(new Event('lin:response-cleared'));
   $('#request-echo').hidden=true;$('#request-echo').textContent='';
   $('#context-state').textContent='Saved facts or notes changed. Recent context was reset to avoid stale answers.';
   $('#detail').textContent='Search again to use the current sources.';
   controls();
 });
 $('#stop').addEventListener('click', interrupt);
 $('#pause').addEventListener('click', () => {
   if (!running) return;
   paused = !paused;
   if (paused) { audio.pause(); state('paused', 'PAUSED'); $('#detail').textContent = 'Paused. The highlighted sentence stays with your place.'; frame(); }
   else { audioGraph(); if (audio.hasAttribute('src')) playCurrent(epoch); else advance(epoch); }
   controls();
 });
 $('#replay').addEventListener('click', () => {
   if (!buffers.length || running || micBusy) return;
   epoch++; jobId = null; current = -1; done = true; paused = false; running = true; gaps = []; endedAt = 0;
   texts = buffers.map(b => b.text);
   buffers.forEach(b => { b.cached = true; });
   requestedAt = performance.now(); firstPlayed = false;
   clearSource(); drawSentences(); controls(); audioGraph(); advance(epoch);
 });
 $('#mute').addEventListener('change', e => { audio.muted = e.target.checked; frame(); });
 audio.addEventListener('playing', () => {
   if (!running || paused) { audio.pause(); return; }
   state('speaking', 'SPEAKING'); highlight();
   if (endedAt) { gaps.push(Math.round(performance.now() - endedAt)); endedAt = 0; }
   window.linVoiceGaps = gaps;
   if (!firstPlayed) {
     firstPlayed = true;
     $('#detail').textContent = `Playback started in ${((performance.now()-requestedAt)/1000).toFixed(2)} s${buffers[current]?.cached ? ' from saved audio' : ' for new speech'}.`;
   } else $('#detail').textContent = `Speaking sentence ${current + 1} of ${texts.length}.`;
   frame();
 });
 // Straight on to the next sentence: no pause/reload in between (that left an audible gap).
 let endedAt = 0, gaps = [];
 audio.addEventListener('ended', () => { endedAt = performance.now(); audio.removeAttribute('src'); advance(epoch); });
 audio.addEventListener('waiting', () => { if (running && !paused) { state('waiting', 'BUFFERING AUDIO'); frame(); } });
 audio.addEventListener('timeupdate', frame);
 audio.addEventListener('pause', frame);
 audio.addEventListener('error', () => {
   if (!audio.hasAttribute('src') || !running) return;
   interrupt(); state('error', 'PLAYBACK UNAVAILABLE'); $('#detail').textContent = 'The audio could not be played. Try replaying the response.';
 });
 input.addEventListener('input', () => { $('#char-count').textContent = `${input.value.length} / 600`; });
 input.dispatchEvent(new Event('input'));
 document.addEventListener('lin:mic-state', e => {
   micBusy = e.detail.busy;
   if (micBusy && running) interrupt();
   if (e.detail.label) state(e.detail.state || 'ready', e.detail.label);
   controls();
 });
 document.addEventListener('keydown', e => {
   if (e.key !== 'Escape') return;
   if (micBusy) document.dispatchEvent(new Event('lin:cancel-mic'));
   else if (running) interrupt();
 });
 $('#shutdown').addEventListener('click', async () => {
   document.dispatchEvent(new Event('lin:close-mic'));
   interrupt(); clearInterval(engineTimer); releaseBuffers();
   try { await api('/api/shutdown', {method:'POST',body:'{}'}); }
   catch (err) { $('#detail').textContent = err.message; return; }
   engineReady = false; reasoningReady = false; $('#shutdown').disabled = true; controls();
   $('#reasoning-state').textContent = 'Local reasoning unloaded. Session context discarded.';
   $('#engine-state').textContent = 'Local voice unloaded. Reopen with the launcher.';
   state('stopped', 'SESSION CLOSED');
 });
 window.addEventListener('pagehide', () => {
   if (jobId) fetch(`/api/jobs/${jobId}/cancel`, {method:'POST',keepalive:true,headers:{'X-Lin-Token':token,'Content-Type':'application/json'},body:'{}'}).catch(() => {});
 });
 frame(); refreshEngine(); engineTimer = setInterval(refreshEngine, 1500);
})();
