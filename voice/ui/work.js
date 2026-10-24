(() => {
 'use strict';
 // Live work panel: what Lin is doing right now, step by step, with how long each step took.
 const $ = s => document.querySelector(s), panel = $('#work-panel'), list = $('#work-steps');
 let current = null, hideTimer = 0;
 const seconds = ms => ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms + ' ms';
 function render(job) {
   const steps = job.steps || [];
   if (!steps.length) return;
   clearTimeout(hideTimer);
   if (current !== job.id) { current = job.id; list.replaceChildren(); }
   panel.hidden = false; panel.classList.remove('leaving');
   steps.forEach((s, i) => {
     let li = list.children[i];
     if (!li) { li = document.createElement('li'); li.append(document.createElement('span'), document.createElement('span'), document.createElement('span')); li.children[0].className = 'work-mark'; li.children[1].className = 'work-text'; li.children[2].className = 'work-time'; list.append(li); }
     li.className = 'work-step state-' + s.state;
     li.children[0].textContent = s.state === 'done' ? '✓' : s.state === 'waiting' ? '…' : '';
     li.children[1].textContent = s.text;
     li.children[2].textContent = s.state === 'done' && s.ms ? seconds(s.ms) : '';
   });
   const last = steps[steps.length - 1], finished = last.text === 'Done' || job.status === 'cancelled' || job.status === 'error';
   $('#work-title').textContent = finished ? (job.status === 'cancelled' ? 'Stopped' : job.status === 'error' ? 'Something went wrong' : `Done in ${seconds(Math.round(last.at * 1000))}`) : last.state === 'waiting' ? 'Waiting for you' : 'Working on it';
   panel.dataset.state = finished ? 'done' : last.state;
   if ((finished || last.state === 'waiting') && !(window.linWorkKeep && window.linWorkKeep())) hideTimer = setTimeout(() => { panel.classList.add('leaving'); hideTimer = setTimeout(() => { panel.hidden = true; }, 400); }, finished ? 4000 : 9000);
 }
 document.addEventListener('lin:job', e => { if (e.detail && e.detail.kind === 'answer') render(e.detail); });
 document.addEventListener('lin:response-cleared', () => { clearTimeout(hideTimer); panel.hidden = true; current = null; list.replaceChildren(); });
 $('#work-close').addEventListener('click', () => { clearTimeout(hideTimer); panel.hidden = true; });
})();
