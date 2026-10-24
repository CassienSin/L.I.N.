// Lin as a Windows app: the same page in three windows. ?view=quick is the Ctrl+Space quick bar, ?view=orb the
// floating emblem; no view is the main window. Runs before app.js (which tidies the address), so it reads the view first.
(() => {
 'use strict';
 const view = new URLSearchParams(location.search).get('view');
 const shell = view === 'quick' || view === 'orb' ? view : '';
 if (shell) document.documentElement.dataset.shell = shell;
 const api = () => window.pywebview && window.pywebview.api;   // only inside the app, not in a browser
 addEventListener('DOMContentLoaded', () => {
   if (shell === 'quick') {
     // Escape hides the quick bar when Lin is not listening or speaking (then Escape stops her, as usual).
     addEventListener('keydown', e => {
       if (e.key !== 'Escape') return;
       const busy = ['listening', 'recording', 'thinking', 'speaking', 'waiting', 'transcribing', 'preparing'].includes(document.body.dataset.state);
       if (!busy && api()) { e.preventDefault(); api().hide_quick(); }
     });
     const open = document.createElement('button');
     open.type = 'button'; open.id = 'shell-open'; open.className = 'shell-open'; open.textContent = 'Open Lin';
     open.title = 'Open the full Lin window';
     open.addEventListener('click', () => api() && api().open_main());
     document.querySelector('.dock')?.append(open);
   }
   if (shell === 'orb') {
     // The floating emblem: click to open Lin; it shows her mood (listening, thinking, speaking, waiting for you).
     const orb = document.querySelector('#orb');
     orb.setAttribute('role', 'button'); orb.tabIndex = 0; orb.setAttribute('aria-label', 'Open Lin');
     const go = () => api() && api().open_main();
     orb.addEventListener('click', go);
     orb.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
   }
 });
 // The app focuses the box when the quick bar opens.
 window.linFocusAsk = () => { const box = document.querySelector('#request-input'); if (box) { box.focus(); box.select(); } };
})();
