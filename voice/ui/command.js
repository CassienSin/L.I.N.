(() => {
 'use strict';
 // The command screen around the map: sheets, the day ribbon, status, presence and your profile.
 const $ = s => document.querySelector(s);
 const token = sessionStorage.getItem('lin-session-token') || '';
 const SHEETS = {brain: 'Notes and memory', planner: 'Plan my day', today: 'Today', activity: 'Activity', tools: 'Tools', settings: 'About you'};
 let todayRevision = null, profile = null, profileName = '', lastStatus = null, actionsRevision = null, opener = null;
 async function api(path, body) {
   const r = await fetch(path, {method: body === undefined ? 'GET' : 'POST', headers: {'X-Lin-Token': token, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
   const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || 'Lin is unavailable.'); return d;
 }
 const store = {get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} }};

 // Sheets open over the map; the map and the conversation stay where they were.
 document.addEventListener('lin:view', e => {
   const name = e.detail, open = name in SHEETS;
   $('#sheet').hidden = !open; $('#sheet-scrim').hidden = !open;
   if (open) {
     if (!opener) opener = document.activeElement;
     $('#sheet-title').textContent = SHEETS[name]; $('#sheet').scrollTop = 0;
     requestAnimationFrame(() => $('#view-chat').focus({preventScroll: true}));
     if (name === 'settings') { loadProfile(); loadBrain(); }
   } else if (opener && document.contains(opener)) { opener.focus({preventScroll: true}); opener = null; }
 });
 $('#view-settings').addEventListener('click', () => document.dispatchEvent(new CustomEvent('lin:view', {detail: 'settings'})));
 $('#sheet-scrim').addEventListener('click', () => document.dispatchEvent(new CustomEvent('lin:view', {detail: 'chat'})));
 document.addEventListener('keydown', e => {
   const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
   if (e.key === 'Escape' && !$('#sheet').hidden && !$('#source-dialog').open) document.dispatchEvent(new CustomEvent('lin:view', {detail: 'chat'}));
   if (e.key === '/' && !typing && $('#sheet').hidden) { e.preventDefault(); $('#request-input').focus(); }
 });

 // Lens pop-over on narrower windows.
 $('#lens-open').addEventListener('click', () => document.body.classList.toggle('lens-open'));
 $('#lens-close').addEventListener('click', () => document.body.classList.remove('lens-open'));

 // Caption: hide the controls until Lin has something to say; let the person tuck it away.
 const caption = $('#caption');
 function syncCaption() {
   const idle = !!$('#sentences .placeholder') || !$('#sentences').children.length;
   caption.classList.toggle('idle', idle);
   const active = $('#sentences li.active'); if (active) active.scrollIntoView({block: 'nearest'});
 }
 new MutationObserver(syncCaption).observe($('#sentences'), {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
 $('#caption-hide').addEventListener('click', () => {
   const hidden = caption.classList.toggle('collapsed');
   $('#caption-hide').textContent = hidden ? 'Show' : 'Hide'; $('#caption-hide').setAttribute('aria-expanded', String(!hidden));
 });
 document.addEventListener('lin:response-cleared', () => { caption.classList.remove('collapsed'); $('#caption-hide').textContent = 'Hide'; });
 function greet() {
   const placeholder = $('#sentences .placeholder');
   if (placeholder) placeholder.textContent = `${profileName ? 'Hi ' + profileName + '. ' : ''}Ask me anything, or press the microphone and just talk.`;
 }

 // Status chips from the same poll the conversation uses.
 document.addEventListener('lin:status', e => {
   const s = e.detail; lastStatus = s;
   $('#demo-badge').hidden = !s.demo;
   const chip = $('#voice-chip');
   const text = s.error ? 'Voice unavailable' : !s.ready ? 'Voice loading…' : s.reasoning?.error ? 'Reasoning unavailable' : !s.reasoning?.ready ? 'Reasoning loading…' : 'Voice ready';
   chip.textContent = text; chip.classList.toggle('warn', text !== 'Voice ready');
   if (s.today_revision && s.today_revision !== todayRevision) { todayRevision = s.today_revision; ribbon(); }
   if (Number.isInteger(s.actions_revision) && s.actions_revision !== actionsRevision) { actionsRevision = s.actions_revision; presence(); }
 });
 document.addEventListener('lin:planner-status', () => document.dispatchEvent(new Event('lin:graph-refresh')));
 document.addEventListener('lin:knowledge-changed', () => document.dispatchEvent(new Event('lin:graph-refresh')));

 // Lin shows "needs you" whenever a change waits for approval.
 async function presence() {
   try {
     const d = await api('/api/actions');
     const waiting = d.actions.some(a => a.state === 'proposed');
     if (waiting) document.body.dataset.presence = 'needs-you'; else delete document.body.dataset.presence;
     $('#orb').setAttribute('aria-label', waiting ? 'Lin is waiting for your approval' : 'Lin');
   } catch {}
 }

 // Day ribbon: today's events, the free gaps between them and the current time.
 const fmt = d => d.toLocaleTimeString('en-PH', {timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit'});
 async function ribbon() {
   const items = $('#ribbon-items'), hours = $('#ribbon-hours'), label = $('#ribbon-label'), now = new Date();
   try {
     const t = await api('/api/today');
     items.replaceChildren(); hours.replaceChildren();
     const day = new Date(t.generated_at), base = new Date(day); base.setUTCHours(-8, 0, 0, 0);
     const startOfDay = new Date(t.date + 'T00:00:00+08:00').getTime();
     const timed = t.events.filter(e => !e.all_day);
     let first = 7, last = 21;
     for (const e of timed) { const a = (new Date(e.start) - startOfDay) / 3.6e6, b = (new Date(e.end) - startOfDay) / 3.6e6; first = Math.min(first, Math.floor(Math.max(0, a))); last = Math.max(last, Math.ceil(Math.min(24, b))); }
     const span = (last - first) * 3.6e6, pos = ms => Math.max(0, Math.min(100, (ms - startOfDay - first * 3.6e6) / span * 100));
     const nowPct = pos(now.getTime());
     const past = document.createElement('div'); past.className = 'ribbon-past'; past.style.width = nowPct + '%'; items.append(past);
     for (const e of timed) {
       const a = pos(new Date(e.start).getTime()), b = pos(new Date(e.end).getTime()), block = document.createElement('div');
       block.className = 'ribbon-event' + (e.status === 'Finished' ? ' past' : '') + (e.tentative ? ' tentative' : '');
       block.style.left = a + '%'; block.style.width = Math.max(.8, b - a) + '%'; block.title = `${e.title}, ${fmt(new Date(e.start))} to ${fmt(new Date(e.end))}`;
       items.append(block);
     }
     const n = $('#ribbon-now'); n.hidden = nowPct <= 0 || nowPct >= 100; n.style.left = nowPct + '%';
     const marks = [first, Math.round(first + (last - first) / 3), Math.round(first + (last - first) * 2 / 3), last];
     for (const h of marks) { const s = document.createElement('span'); s.style.left = ((h - first) / (last - first) * 100) + '%'; s.textContent = h === 0 || h === 24 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? h + ' AM' : (h - 12) + ' PM'; hours.append(s); }
     const upcoming = timed.filter(e => new Date(e.end) > now).sort((a, b) => new Date(a.start) - new Date(b.start));
     const current = upcoming.find(e => new Date(e.start) <= now), next = upcoming.find(e => new Date(e.start) > now);
     let text;
     if (!t.source) text = 'No calendar yet · import one in Today';
     else if (!t.covered) text = 'Calendar import does not cover today · refresh it in Today';
     else if (current) text = `Now: ${current.title} until ${fmt(new Date(current.end))}`;
     else if (next) text = `Now ${fmt(now)} · next ${next.title} at ${fmt(new Date(next.start))}`;
     else text = timed.length ? `Now ${fmt(now)} · nothing else today` : `Now ${fmt(now)} · nothing scheduled today`;
     label.textContent = text + (t.stale ? ' · import is over a day old' : '');
     $('#day-ribbon').setAttribute('aria-label', `Today: ${timed.length} timed events. ${text}`);
   } catch (err) { label.textContent = err.message; }
 }
 $('#ribbon-label').addEventListener('click', () => document.dispatchEvent(new CustomEvent('lin:view', {detail: 'today'})));
 setInterval(ribbon, 60000);

 // About you.
 async function loadProfile() {
   try {
     profile = await api('/api/profile'); profileName = profile.name;
     $('#profile-name').value = profile.name; $('#profile-about').value = profile.about; $('#profile-tone').value = profile.tone;
     $('#profile-status').textContent = profile.demo ? 'This is the invented demo profile. Your real profile is not loaded in demo mode.' : 'Saved on this computer.';
     greet();
   } catch (err) { $('#profile-status').textContent = err.message; }
 }
 $('#profile-form').addEventListener('submit', async e => {
   e.preventDefault(); if (!profile) return;
   $('#profile-save').disabled = true;
   try {
     profile = await api('/api/profile/save', {revision: profile.revision, name: $('#profile-name').value, about: $('#profile-about').value, tone: $('#profile-tone').value});
     profileName = profile.name; greet(); $('#profile-status').textContent = 'Saved. Lin uses this from your next question.';
   } catch (err) { $('#profile-status').textContent = err.message; }
   finally { $('#profile-save').disabled = false; }
 });

 // Hands-free settings, remembered per browser only.
 const silence = $('#silence-ms'), review = $('#mic-review');
 silence.value = store.get('lin-silence-ms') || silence.value; review.checked = store.get('lin-mic-review') === '1';
 function micSettings() {
   $('#silence-value').textContent = (Number(silence.value) / 1000).toFixed(1) + ' s';
   store.set('lin-silence-ms', silence.value); store.set('lin-mic-review', review.checked ? '1' : '0');
   document.dispatchEvent(new CustomEvent('lin:mic-settings', {detail: {silenceMs: Number(silence.value), review: review.checked}}));
 }
 silence.addEventListener('input', micSettings); review.addEventListener('change', micSettings);

 // Brain choice: Fast (4B on the processor) or Smart (35B, also on the graphics card). Switching takes about a minute.
 let brainNotes = {};
 async function loadBrain() {
   try {
     const b = await api('/api/brain'); brainNotes = b.notes || {};
     for (const r of document.querySelectorAll('input[name=brain-mode]')) { r.checked = r.value === b.mode; r.disabled = !b.available[r.value] || !!b.switching; }
     $('#brain-note').textContent = brainNotes[b.mode] || '';
     $('#brain-state').textContent = b.switching ? `Switching to ${b.switching}…` : b.reasoning.error || (b.reasoning.ready ? `Using ${b.reasoning.model}${b.reasoning.gpu_layers ? ' with the graphics card' : ' on the processor'}.` : 'Loading…');
   } catch (err) { $('#brain-state').textContent = err.message; }
 }
 for (const r of document.querySelectorAll('input[name=brain-mode]')) r.addEventListener('change', async () => {
   if (!r.checked) return;
   for (const x of document.querySelectorAll('input[name=brain-mode]')) x.disabled = true;
   try { await api('/api/brain', {mode: r.value}); $('#brain-note').textContent = brainNotes[r.value] || ''; $('#brain-state').textContent = `Switching to ${r.value}… this takes about a minute. Lin can't answer until it's done.`; }
   catch (err) { $('#brain-state').textContent = err.message; loadBrain(); }
 });
 let wasSwitching = false;
 document.addEventListener('lin:status', e => {
   const sw = e.detail.reasoning?.switching;
   if (wasSwitching && !sw) loadBrain();
   wasSwitching = !!sw;
 });

 // Greeting with real numbers, once per Lin session. Spoken after your first click or key press,
 // because browsers only allow sound after you interact with the page.
 let greeted = false;
 const greetKey = 'lin-greeted-' + token.slice(0, 12);
 const greetVoice = $('#greet-voice');
 greetVoice.checked = store.get('lin-greet-voice') !== 'off';
 greetVoice.addEventListener('change', () => store.set('lin-greet-voice', greetVoice.checked ? 'on' : 'off'));
 document.addEventListener('lin:status', async e => {
   const s = e.detail;
   if (greeted || !s.ready || !s.reasoning?.ready || s.busy) return;
   greeted = true;
   let seen = false; try { seen = sessionStorage.getItem(greetKey) === '1'; } catch {}
   try {
     const g = await api('/api/greeting');
     const placeholder = $('#sentences .placeholder'); if (placeholder) placeholder.textContent = g.text;
     document.body.dataset.greeting = g.text;
     if (seen || !greetVoice.checked) return;
     try { sessionStorage.setItem(greetKey, '1'); } catch {}
     const say = () => document.dispatchEvent(new CustomEvent('lin:say', {detail: {text: g.text}}));
     if (navigator.userActivation?.hasBeenActive) say();
     else { const once = () => { removeEventListener('pointerdown', once, true); removeEventListener('keydown', once, true); setTimeout(say, 150); }; addEventListener('pointerdown', once, true); addEventListener('keydown', once, true); }
   } catch {}
 });
 loadProfile(); ribbon(); presence(); micSettings(); syncCaption();
})();
