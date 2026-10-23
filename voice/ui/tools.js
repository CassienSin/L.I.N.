(() => {
 'use strict';
 // Tools sheet: connect MCP servers, see their tools and choose Ask first / Auto / Off for each.
 const $ = s => document.querySelector(s), token = sessionStorage.getItem('lin-session-token') || '';
 let data = null, open = false, seen = null, presets = [];
 const STATE = {ready: 'Connected', starting: 'Starting…', error: 'Needs attention', stopped: 'Off'};
 const POLICY = [['ask', 'Ask first'], ['auto', 'Auto'], ['off', 'Off']];
 function node(tag, text, className) { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (className) n.className = className; return n; }
 async function api(path, body) {
   const r = await fetch(path, {method: body === undefined ? 'GET' : 'POST', headers: {'X-Lin-Token': token, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
   const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || 'Lin could not reach the tool service.'); return d;
 }
 function say(text) { $('#tools-status').textContent = text; }
 async function load() {
   try { const d = await api('/api/mcp'); presets = d.presets || []; render(d); }
   catch (err) { say(err.message); }
 }
 // Changes run one at a time so each uses the latest revision (quick clicks never look like a conflict).
 let chain = Promise.resolve();
 function change(path, body, done) { const run = chain.then(() => send(path, body, done)); chain = run.catch(() => {}); return run; }
 async function send(path, body, done) {
   try { const d = await api(path, {revision: data.revision, ...body}); render(d); if (done) say(done); return true; }
   catch (err) { say(err.message); if (/changed in another window/.test(err.message)) load(); return false; }
 }
 function render(d) {
   data = d; seen = d.status_revision;
   const list = $('#tools-list'); list.replaceChildren();
   const ready = d.servers.filter(s => s.state === 'ready').length, tools = d.servers.reduce((n, s) => n + s.tools.length, 0);
   say(d.servers.length ? `${ready} of ${d.servers.length} servers connected · ${tools} tools` : 'No servers yet. Add one below, or start with Lin test tools.');
   for (const s of d.servers) {
     const card = node('article', '', 'activity-item tool-server state-' + (s.state === 'ready' ? 'executed' : s.state === 'error' ? 'failed' : 'proposed'));
     card.dataset.server = s.name;
     const head = node('div', '', 'checked-head');
     head.append(node('h3', s.name), node('span', STATE[s.state] || s.state, 'action-state'));
     card.append(head, node('p', [s.command, ...s.args].join(' '), 'tool-command'));
     if (s.info && s.info.name) card.append(node('p', `Reports itself as ${s.info.name} ${s.info.version || ''} · protocol ${s.info.protocol || '?'}`));
     if (s.env_keys.length) card.append(node('p', 'Environment: ' + s.env_keys.join(', ')));
     if (s.error) card.append(node('p', s.error, 'warn'));
     if (s.tools.length) {
       const ul = node('ul', '', 'tool-list');
       for (const t of s.tools) {
         const li = node('li', '', 'tool-row'), text = node('div');
         text.append(node('strong', t.title || t.name));
         const hints = [t.name !== (t.title || t.name) ? t.name : null, t.read_only ? 'says it only reads' : 'may change things', t.destructive ? 'may delete or overwrite' : null].filter(Boolean).join(' · ');
         text.append(node('span', hints));
         text.append(node('span', t.flag ? 'Description hidden from Lin: it reads like instructions to Lin.' : t.description, t.flag ? 'warn' : ''));
         const sel = document.createElement('select'); sel.setAttribute('aria-label', `When Lin wants to use ${t.name}`);
         for (const [v, l] of POLICY) { const o = node('option', l); o.value = v; sel.append(o); }
         sel.value = t.policy;
         sel.addEventListener('change', async () => { sel.disabled = true; if (!await change('/api/mcp/policy', {name: s.name, tool: t.name, policy: sel.value}, `${t.name}: ${POLICY.find(p => p[0] === sel.value)[1]}.`)) sel.value = t.policy; sel.disabled = false; });
         li.append(text, sel); ul.append(li);
       }
       card.append(ul);
     }
     const buttons = node('div', '', 'brain-actions');
     const toggle = node('button', s.enabled ? 'Turn off' : 'Turn on'), restart = node('button', 'Restart'), remove = node('button', 'Remove');
     [toggle, restart, remove].forEach(b => b.type = 'button');
     toggle.addEventListener('click', () => change('/api/mcp/enable', {name: s.name, enabled: !s.enabled}));
     restart.addEventListener('click', () => change('/api/mcp/restart', {name: s.name}, `Restarting ${s.name}…`));
     restart.disabled = !s.enabled;
     let armed = false;
     remove.addEventListener('click', () => { if (!armed) { armed = true; remove.textContent = 'Press again to remove'; setTimeout(() => { armed = false; remove.textContent = 'Remove'; }, 4000); return; } change('/api/mcp/remove', {name: s.name}, `${s.name} removed.`); });
     buttons.append(toggle, restart, remove);
     if (/workspace-mcp/i.test(s.command)) {
       // Google: you sign in yourself, in your browser, on Google's own page.
       const signin = node('button', 'Sign in to Google'); signin.type = 'button'; signin.disabled = s.state !== 'ready';
       signin.addEventListener('click', async () => {
         signin.disabled = true; say('Asking Google for its sign-in page…');
         try { const r = await api('/api/mcp/google-signin', {name: s.name}); say(r.opened ? 'Google’s sign-in page is open in your browser. Sign in there and allow read access; then ask Lin about a Google Doc.' : r.message); }
         catch (err) { say(err.message); }
         signin.disabled = false;
       });
       signin.classList.add('tool-signin'); head.insertBefore(signin, head.lastChild);
     }
     card.append(buttons);
     list.append(card);
   }
 }
 const lines = v => v.split('\n').map(x => x.trim()).filter(Boolean);
 $('#tool-form').addEventListener('submit', async e => {
   e.preventDefault();
   const env = {}, status = $('#tool-form-status');
   for (const line of lines($('#tool-env').value)) { const i = line.indexOf('='); if (i < 1) { status.textContent = 'Environment lines must be NAME=value.'; return; } env[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
   const empty = Object.keys(env).filter(k => !env[k]);
   if (empty.length) { status.textContent = `Fill in a value after ${empty.join(', ')} =`; return; }
   const spec = {command: $('#tool-command').value.trim(), args: lines($('#tool-args').value), env, cwd: $('#tool-cwd').value.trim(), enabled: true};
   if (!data) await load();
   if (await change('/api/mcp/save', {name: $('#tool-name').value.trim(), spec}, `Starting ${$('#tool-name').value.trim()}…`)) { const added = $('#tool-name').value.trim().toLowerCase(); e.target.reset(); status.textContent = 'Added. Lin is starting it — new tools start as Ask first.'; const card = document.querySelector(`[data-server="${CSS.escape(added)}"]`); if (card) card.scrollIntoView({behavior: 'smooth', block: 'start'}); }
   else status.textContent = $('#tools-status').textContent;
 });
 function fill(name) {
   const p = presets.find(x => x.name === name); if (!p) return;
   $('#tool-name').value = p.name; $('#tool-command').value = p.command; $('#tool-args').value = p.args.join('\n');
   $('#tool-env').value = Object.entries(p.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'); $('#tool-cwd').value = '';
   $('#tool-form-status').textContent = p.about + '. Then press Add and start.';
   if (p.env && Object.values(p.env).some(v => !v)) { const env = $('#tool-env'); env.rows = Object.keys(p.env).length; env.focus(); env.setSelectionRange(env.value.indexOf('=') + 1, env.value.indexOf('=') + 1); }
 }
 $('#tool-preset').addEventListener('click', () => fill('lin-test'));
 $('#tool-preset-google').addEventListener('click', () => fill('google'));
 $('#view-tools').addEventListener('click', () => document.dispatchEvent(new CustomEvent('lin:view', {detail: 'tools'})));
 document.addEventListener('lin:view', e => { open = e.detail === 'tools'; if (open) load(); });
 document.addEventListener('lin:status', e => { const r = e.detail.mcp_revision; if (open && Number.isInteger(r) && r !== seen) load(); });
})();
