(() => {
 'use strict';
 // Home in the Orbit look: the rail, the day ring around the emblem, open tasks on the left, Lin Brain on the right,
 // and the Look settings. Everything shown comes from Lin's own endpoints; nothing here changes your data.
 const $ = s => document.querySelector(s);
 const token = sessionStorage.getItem('lin-session-token') || '';
 const SHEETS = ['brain', 'planner', 'today', 'activity', 'tools', 'settings'];
 const ZONE = 'Asia/Manila';
 const api = path => fetch(path, {headers: {'X-Lin-Token': token}}).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || 'Lin is unavailable.'); return d; });
 const go = name => document.dispatchEvent(new CustomEvent('lin:view', {detail: name}));
 const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

 // ----- Views: Home and Map are places; the other sections open as sheets over them. -----
 let base = 'home';
 function current(name) {
   for (const b of document.querySelectorAll('#rail button')) {
     const mine = b.dataset.view || b.dataset.sheet;
     if (mine === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
   }
 }
 document.addEventListener('lin:view', e => {
   const name = e.detail;
   if (name === 'home' || name === 'map') {
     base = name; document.body.dataset.view = name;
     $('#map-canvas').tabIndex = name === 'map' ? 0 : -1;  // the map behind Home is scenery, not a control
     if (name === 'home') document.body.classList.remove('lens-open');
     window.dispatchEvent(new Event('resize'));
   }
   current(SHEETS.includes(name) ? name : base);
 });
 $('#view-home').addEventListener('click', () => go('home'));
 $('#view-map').addEventListener('click', () => go('map'));
 $('#home-open-map').addEventListener('click', () => go('map'));
 $('#home-open-plan').addEventListener('click', () => go('planner'));
 // Selecting something on the map from a search or an answer while on Home shows it on the map.
 document.addEventListener('lin:show-map', () => go('map'));

 // ----- Status: date, brain, tasks, Lin Brain -----
 const dateFmt = new Intl.DateTimeFormat('en-GB', {timeZone: ZONE, weekday: 'long', day: 'numeric', month: 'long'});
 const timeFmt = new Intl.DateTimeFormat('en-PH', {timeZone: ZONE, hour: 'numeric', minute: '2-digit'});
 function date() { const p = Object.fromEntries(dateFmt.formatToParts(new Date()).map(x => [x.type, x.value])); $('#home-date').textContent = `${p.weekday} · ${p.day} ${p.month}`; }
 let plannerRevision = null, todayRevision = null, lastConversations = null;
 document.addEventListener('lin:status', e => {
   const s = e.detail || {};
   const r = s.reasoning || {};
   const local = r.switching ? 'switching' : /35B/i.test(r.model || '') ? 'Smart' : 'Fast', c = s.claude || {};
   $('#brain-chip').textContent = c.mode === 'always' ? `Brain · Claude + ${local}` : c.mode === 'ask' ? `Brain · ${local} + Claude` : `Brain · ${local}`;
   $('#brain-chip').classList.toggle('warn', c.mode && c.mode !== 'off' && c.checked && !c.ready);
   $('#brain-chip').title = c.mode && c.mode !== 'off' ? (c.ready ? 'Claude is ready through Claude Code.' : c.limited ? 'Claude’s usage limit is reached; Lin answers on this PC.' : c.message || '') : 'Lin thinks only on this PC.';
   lastConversations = s.conversations; brain(s.brain);
   if (s.planner_revision !== undefined && s.planner_revision !== plannerRevision) { plannerRevision = s.planner_revision; tasks(); }
   if (s.today_revision && s.today_revision !== todayRevision) { todayRevision = s.today_revision; ring(); }
 });
 function brain(b) {
   if (!b) return;
   const docs = b.documents?.read || 0, notes = Math.max(0, (b.files || 0) - docs), memories = b.memories || 0;
   $('#home-brain-count').textContent = String(notes + docs + memories);
   $('#home-brain-detail').textContent = b.connected === false ? 'Your Lin Brain folder is disconnected.' : `${plural(notes, 'note', 'notes')} · ${plural(docs, 'document', 'documents')} · ${plural(memories, 'memory', 'memories')}`;
   const c = lastConversations;
   if (c && c.conversations) $('#home-brain-detail').textContent += ` · ${plural(c.conversations, 'conversation', 'conversations')}`;
   const reading = $('#home-brain-reading');
   reading.hidden = !b.documents?.reading; reading.textContent = b.documents?.reading ? 'Reading new documents…' : '';
 }
 async function tasks() {
   try {
     const d = await api('/api/planner');
     const open = d.tasks.filter(t => !t.done);
     $('#home-task-count').textContent = String(open.length);
     const list = $('#home-task-list'); list.replaceChildren();
     for (const t of open.slice(0, 3)) {
       const li = document.createElement('li'), b = document.createElement('button'), dot = document.createElement('span'), title = document.createElement('span');
       b.type = 'button'; dot.className = 'prio' + (t.priority === 1 ? ' high' : ''); title.textContent = t.title;
       b.append(dot, title); b.setAttribute('aria-label', `${t.title}${t.priority === 1 ? ', high priority' : ''}. Open Plan my day`);
       b.addEventListener('click', () => go('planner')); li.append(b); list.append(li);
     }
     if (!open.length) { const li = document.createElement('li'); li.className = 'home-note muted'; li.textContent = 'Nothing open. Your list is clear.'; list.append(li); }
     else if (open.length > 3) { const li = document.createElement('li'); li.className = 'home-note muted'; li.textContent = `and ${open.length - 3} more`; list.append(li); }
   } catch {}
 }

 // ----- The day ring: today's calendar around the emblem, with the time now. -----
 // Drag along it (or focus it and use the arrow keys) to see what's on at any time; tap an event to open Today.
 const NS = 'http://www.w3.org/2000/svg', svg = $('#day-ring');
 let today = null, geo = null, scrub = null, scrubTimer = 0, press = null;
 const make = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent.append(n); return n; };
 const hourName = h => h === 0 || h === 24 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`;
 let todayLoaded = false;
 async function ring() { try { today = await api('/api/today'); } catch { today = null; } todayLoaded = true; draw(); document.dispatchEvent(new Event('lin:today-loaded')); }
 function describe(ms) {
   if (!geo) return '';
   const at = geo.timed.find(e => new Date(e.start).getTime() <= ms && ms < new Date(e.end).getTime());
   if (at) return {title: at.title, sub: `until ${timeFmt.format(new Date(at.end))}`, event: at};
   const next = geo.timed.filter(e => new Date(e.start).getTime() > ms).sort((x, y) => new Date(x.start) - new Date(y.start))[0];
   if (!today?.source) return {title: 'No calendar yet', sub: 'import one in Today'};
   return next ? {title: 'Free', sub: `until ${timeFmt.format(new Date(next.start))} · ${next.title}`} : {title: 'Free', sub: 'for the rest of the day'};
 }
 function draw() {
   const size = $('#orb').getBoundingClientRect().width;
   if (!size) return;
   const r = size * .7, W = r * 2 + 2, c = W / 2, SWEEP = 270;
   svg.setAttribute('viewBox', `0 0 ${W} ${W}`); svg.replaceChildren();
   const now = new Date();
   let first = 7, last = 22, timed = [], startOfDay = null;
   if (today && today.date) {
     startOfDay = new Date(today.date + 'T00:00:00+08:00').getTime();
     timed = (today.events || []).filter(e => !e.all_day);
     for (const e of timed) { const a = (new Date(e.start) - startOfDay) / 3.6e6, b = (new Date(e.end) - startOfDay) / 3.6e6; first = Math.min(first, Math.floor(Math.max(0, a))); last = Math.max(last, Math.ceil(Math.min(24, b))); }
   } else {
     const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now).map(x => [x.type, x.value]));
     startOfDay = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+08:00`).getTime();
   }
   const hours = last - first, from = startOfDay + first * 3.6e6, to = startOfDay + last * 3.6e6;
   const angle = ms => -SWEEP / 2 + Math.max(0, Math.min(1, (ms - from) / (to - from))) * SWEEP;
   const pt = (deg, rad) => { const t = deg * Math.PI / 180; return [c + rad * Math.sin(t), c - rad * Math.cos(t)]; };
   const arc = (a, b, rad = r) => { const [x1, y1] = pt(a, rad), [x2, y2] = pt(b, rad); return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${rad} ${rad} 0 ${b - a > 180 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
   const anchor = deg => { const s = Math.sin(deg * Math.PI / 180); return s > .25 ? 'start' : s < -.25 ? 'end' : 'middle'; };
   geo = {c, r, SWEEP, from, to, first, last, timed, angle};
   if (scrub !== null) scrub = Math.max(from, Math.min(to, scrub));
   const scrubA = scrub === null ? null : angle(scrub);
   make('path', {d: arc(-SWEEP / 2, SWEEP / 2), class: 'track'}, svg);
   const perHour = r * (SWEEP / hours) * Math.PI / 180;
   make('path', {d: arc(-SWEEP / 2, SWEEP / 2), class: 'hours', 'stroke-dasharray': `1.4 ${(perHour - 1.4).toFixed(2)}`}, svg);
   const nowA = angle(now.getTime()), inDay = now.getTime() > from && now.getTime() < to;
   if (inDay) make('path', {d: arc(-SWEEP / 2, nowA), class: 'past'}, svg);
   const next = timed.filter(e => new Date(e.start) > now).sort((a, b) => new Date(a.start) - new Date(b.start))[0];
   const hot = scrub === null ? null : describe(scrub).event;
   const labels = [];
   for (const e of timed) {
     const a = angle(new Date(e.start).getTime()), b = Math.max(a + 1.2, angle(new Date(e.end).getTime()));
     const done = new Date(e.end) <= now, cls = done ? 'done' : e === next ? 'next' : '';
     const p = make('path', {d: arc(a, b), class: `event ${cls}${e === hot ? ' hot' : ''}`}, svg); p.dataset.id = e.id;
     labels.push({a: (a + b) / 2, e, cls: cls || 'event-label', rank: done ? 2 : e === next ? 0 : 1});
   }
   make('path', {d: arc(-SWEEP / 2, SWEEP / 2), class: 'hit'}, svg);
   // A few labels, nearest first, never on top of each other or of the marker.
   const placed = [];
   if (size >= 150) for (const l of labels.sort((x, y) => x.rank - y.rank)) {
     if (placed.length >= 4 || placed.some(p => Math.abs(p - l.a) < 16) || (inDay && Math.abs(nowA - l.a) < 10) || (scrubA !== null && Math.abs(scrubA - l.a) < 22)) continue;
     placed.push(l.a);
     const [x, y] = pt(l.a, r + 16);
     const title = l.e.title.length > 24 ? l.e.title.slice(0, 23) + '…' : l.e.title;
     make('text', {x: x.toFixed(1), y: (y + 4).toFixed(1), class: l.cls, 'text-anchor': anchor(l.a)}, svg).textContent = `${timeFmt.format(new Date(l.e.start)).replace(/\s?[AP]M$/i, '')} ${title}`;
   }
   if (inDay && (scrubA === null || Math.abs(scrubA - nowA) > 14)) {
     const [x1, y1] = pt(nowA, r - 12), [x2, y2] = pt(nowA, r + 22);
     make('line', {x1, y1, x2, y2, class: 'now-line'}, svg);
     make('circle', {cx: x2, cy: y2, r: 4.5, class: 'now-dot'}, svg);
     const [tx, ty] = pt(nowA, r + 34);
     make('text', {x: tx.toFixed(1), y: (ty + 4).toFixed(1), class: 'now', 'text-anchor': anchor(nowA)}, svg).textContent = `Now · ${timeFmt.format(now)}`;
   }
   document.body.classList.toggle('ring-scrub', scrubA !== null && size < 240);
   if (scrubA !== null) {
     const d = describe(scrub), [x1, y1] = pt(scrubA, r - 14), [x2, y2] = pt(scrubA, r);
     make('line', {x1, y1, x2, y2, class: 'scrub-line'}, svg);
     make('circle', {cx: x2, cy: y2, r: 7, class: 'scrub-dot'}, svg);
     // Beside the marker on wide screens; centred under the emblem on small ones, so it never runs off the edge.
     const small = size < 240, [tx, ty] = small ? [c, c + r * .86] : pt(scrubA, r + 24), below = !small && Math.cos(scrubA * Math.PI / 180) < -.3, side = small ? 'middle' : anchor(scrubA);
     make('text', {x: tx.toFixed(1), y: (ty + (below ? 14 : 0)).toFixed(1), class: 'scrub', 'text-anchor': side}, svg).textContent = `${timeFmt.format(new Date(scrub))} · ${d.title.length > 26 ? d.title.slice(0, 25) + '…' : d.title}`;
     make('text', {x: tx.toFixed(1), y: (ty + (below ? 30 : 16)).toFixed(1), class: 'scrub-sub', 'text-anchor': side}, svg).textContent = d.sub;
   }
   const [lx, ly] = pt(-SWEEP / 2, r), [rx, ry] = pt(SWEEP / 2, r);
   make('text', {x: (lx - 8).toFixed(1), y: (ly + 22).toFixed(1), 'text-anchor': 'end'}, svg).textContent = hourName(first);
   make('text', {x: (rx + 8).toFixed(1), y: (ry + 22).toFixed(1), 'text-anchor': 'start'}, svg).textContent = hourName(last);
   // A slider for keyboards and screen readers: the time you are looking at, and what's on then.
   const words = !today?.source ? 'No calendar imported yet.' : !timed.length ? 'Nothing scheduled today.' :
     `${plural(timed.length, 'event', 'events')} today.${next ? ` Next: ${next.title} at ${timeFmt.format(new Date(next.start))}.` : ' Nothing else today.'}`;
   const at = scrub ?? Math.max(from, Math.min(to, now.getTime())), d = describe(at);
   svg.setAttribute('role', 'slider'); svg.removeAttribute('aria-hidden');
   svg.setAttribute('aria-label', `Day ring. ${words} Use the arrow keys to look at other times; Enter opens Today.`);
   svg.setAttribute('aria-valuemin', String(first * 60)); svg.setAttribute('aria-valuemax', String(last * 60));
   svg.setAttribute('aria-valuenow', String(Math.round((at - startOfDay) / 60000)));
   svg.setAttribute('aria-valuetext', `${timeFmt.format(new Date(at))}, ${d.title}${d.sub ? ', ' + d.sub : ''}`);
   svg.tabIndex = document.body.classList.contains('answering') || size < 150 ? -1 : 0;
 }
 const timeAt = e => {
   const box = svg.getBoundingClientRect(), k = box.width / (geo.c * 2);
   const dx = e.clientX - (box.left + box.width / 2), dy = e.clientY - (box.top + box.height / 2);
   let deg = Math.atan2(dx, -dy) * 180 / Math.PI; deg = Math.max(-geo.SWEEP / 2, Math.min(geo.SWEEP / 2, deg));
   return {ms: geo.from + (deg + geo.SWEEP / 2) / geo.SWEEP * (geo.to - geo.from), dist: Math.hypot(dx, dy) / k};
 };
 const snap = ms => Math.round(ms / 300000) * 300000;  // five-minute steps
 function release(later = 2500) { clearTimeout(scrubTimer); scrubTimer = setTimeout(() => { if (document.activeElement !== svg) { scrub = null; svg.classList.remove('scrubbing'); draw(); } }, later); }
 svg.addEventListener('pointerdown', e => {
   if (!geo || !(e.target.classList.contains('hit') || e.target.classList.contains('event'))) return;
   e.preventDefault(); svg.setPointerCapture(e.pointerId); clearTimeout(scrubTimer);
   press = {x: e.clientX, y: e.clientY, moved: false, event: e.target.classList.contains('event') ? e.target.dataset.id : null};
   scrub = snap(timeAt(e).ms); svg.classList.add('scrubbing'); draw();
 });
 svg.addEventListener('pointermove', e => {
   if (!press) return;
   if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) press.moved = true;
   scrub = snap(timeAt(e).ms); draw();
 });
 const up = () => {
   if (!press) return;
   const tapped = !press.moved && (press.event || describe(scrub).event);
   press = null; svg.classList.remove('scrubbing');
   if (tapped) { scrub = null; draw(); go('today'); return; }
   release();
 };
 svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
 svg.addEventListener('focus', () => { if (scrub === null && geo) { scrub = snap(Math.max(geo.from, Math.min(geo.to, Date.now()))); draw(); } });
 svg.addEventListener('blur', () => release(800));
 svg.addEventListener('keydown', e => {
   if (!geo) return;
   const step = {ArrowRight: 15, ArrowUp: 15, ArrowLeft: -15, ArrowDown: -15, PageUp: 60, PageDown: -60}[e.key];
   if (step !== undefined) { e.preventDefault(); scrub = snap((scrub ?? Date.now()) + step * 60000); draw(); return; }
   if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); scrub = e.key === 'Home' ? geo.from : geo.to; draw(); return; }
   if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('today'); return; }
   if (e.key === 'Escape' && scrub !== null) { e.stopPropagation(); scrub = null; draw(); }
 });
 new ResizeObserver(() => draw()).observe($('#orb'));
 setInterval(() => { date(); if (scrub === null) draw(); }, 60000);

 // ----- Answering: Home makes room, and the answer is wired to the source it came from. -----
 const wire = document.createElementNS(NS, 'svg'); wire.setAttribute('class', 'source-wire'); wire.setAttribute('aria-hidden', 'true'); document.body.append(wire);
 const wide = () => document.body.dataset.view === 'home' && innerWidth >= 1180 && innerHeight >= 640;
 let wireFrame = 0;
 function answering() {
   const on = !$('#request-echo').hidden;
   if (on !== document.body.classList.contains('answering')) { document.body.classList.toggle('answering', on); draw(); }
   scheduleWire();
 }
 function scheduleWire() { cancelAnimationFrame(wireFrame); wireFrame = requestAnimationFrame(drawWire); }
 function drawWire() {
   wire.replaceChildren();
   const card = $('#answer-actions .checked-card') || $('#answer-actions .action-card'), words = $('#sentences');
   if (!document.body.classList.contains('answering') || !wide() || !card || $('#answer-actions').hidden || !words.textContent.trim()) return;
   const range = document.createRange(); range.selectNodeContents(words);
   const a = range.getBoundingClientRect(), b = card.getBoundingClientRect(), side = $('#answer-actions').getBoundingClientRect();
   if (!a.width || !b.width || b.top > side.bottom - 20 || b.bottom < side.top) return;
   const x1 = a.right + 14, y1 = a.top + Math.min(a.height / 2, 40), x2 = b.left - 10, y2 = Math.max(side.top + 12, b.top + 26), mid = (x1 + x2) / 2;
   if (x2 - x1 < 30) return;
   const d = `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
   for (const cls of ['wire-glow', '']) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); if (cls) p.setAttribute('class', cls); wire.append(p); }
   for (const [x, y] of [[x1, y1], [x2, y2]]) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 3); wire.append(c); }
 }
 new MutationObserver(answering).observe($('#request-echo'), {attributes: true, attributeFilter: ['hidden']});
 new MutationObserver(scheduleWire).observe($('#caption-body'), {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class']});
 $('#answer-actions').addEventListener('scroll', scheduleWire);
 addEventListener('resize', scheduleWire);
 document.addEventListener('lin:view', () => setTimeout(scheduleWire, 50));
 window.linWorkKeep = () => document.body.classList.contains('answering') && wide();

 // ----- Start-up: the emblem assembles while Lin really checks her voice, brain, memory and calendar. -----
 // Opening Lin again within five minutes skips straight to the last frame.
 const boot = $('#boot'), bootStarted = Date.now();
 let bootDone = document.documentElement.dataset.reopened === '1';
 if (bootDone) boot.remove(); else document.body.classList.add('booting');
 function bootLine(key, text, ok) {
   let li = boot.querySelector(`[data-k="${key}"]`);
   if (!li) { li = document.createElement('li'); li.dataset.k = key; boot.append(li); setTimeout(() => li.classList.add('shown'), 40 + boot.children.length * 160); }
   li.textContent = text; li.classList.toggle('ok', ok); li.classList.toggle('wait', !ok);
 }
 let lastBoot = {};
 document.addEventListener('lin:today-loaded', () => { if (!bootDone && lastBoot.detail) document.dispatchEvent(new CustomEvent('lin:status', {detail: lastBoot.detail})); });
 document.addEventListener('lin:status', e => {
   if (bootDone) return;
   lastBoot = {detail: e.detail};
   const s = e.detail || {}, r = s.reasoning || {}, b = s.brain;
   bootLine('voice', s.error ? 'Voice · unavailable · typing works' : s.ready ? 'Voice · ready' : 'Voice · still loading · typing works now', !!s.ready);
   bootLine('brain', r.error ? 'Brain · unavailable' : r.ready ? `Brain · ${/35B/i.test(r.model || '') ? 'Smart' : 'Fast'} · ${(r.model || '').split('·')[0].trim()}` : 'Brain · loading', !!r.ready);
   if (b) bootLine('memory', `Memory · ${(b.files || 0) + (b.memories || 0)} items`, true);
   const m = s.meaning;
   if (m && (m.ready || !/not installed/.test(m.error || ''))) bootLine('meaning', m.ready ? `Meaning · ${m.items.toLocaleString()} indexed${m.pending ? ` · ${m.pending} to go` : ''}` : 'Meaning · loading', !!m.ready);
   const c = s.claude;
   if (c && c.mode !== 'off') bootLine('claude', c.ready ? 'Link · Claude ready' : c.limited ? 'Link · Claude limit reached' : !c.checked ? 'Link · checking Claude' : 'Link · Claude not signed in', !!c.ready);
   const t = today, next = t?.events?.filter(x => !x.all_day && new Date(x.start) > new Date()).sort((x, y) => new Date(x.start) - new Date(y.start))[0];
   if (todayLoaded) bootLine('calendar', !t?.source ? 'Calendar · none imported' : next ? `Calendar · next ${timeFmt.format(new Date(next.start))}` : 'Calendar · clear for today', true);
   const allOk = s.ready && r.ready && todayLoaded, waited = Date.now() - bootStarted;
   if ((allOk && waited > 1800) || waited > 60000) {
     bootDone = true; setTimeout(() => { boot.classList.add('done'); setTimeout(() => { document.body.classList.remove('booting'); boot.remove(); }, 650); }, allOk ? 1600 : 0);
   }
 });

 // ----- Look: theme, contrast, motion (Settings) -----
 function syncLook() {
   const theme = window.linTheme?.get('theme') || 'dark';
   for (const r of document.querySelectorAll('input[name=look-theme]')) r.checked = r.value === theme;
   $('#look-contrast').checked = window.linTheme?.get('contrast') === 'more';
   $('#look-motion').checked = window.linTheme?.get('motion') === 'calm';
   $('#look-sounds').checked = window.linTheme?.get('sounds') !== 'off';
   $('#look-captions').checked = window.linTheme?.get('captions') === 'large';
   if (window.linTheme?.get('captions') === 'large' && $('#caption').classList.contains('collapsed')) $('#caption-hide').click();
 }
 for (const r of document.querySelectorAll('input[name=look-theme]')) r.addEventListener('change', () => { if (r.checked) window.linTheme?.set('theme', r.value); });
 $('#look-contrast').addEventListener('change', e => window.linTheme?.set('contrast', e.target.checked ? 'more' : 'normal'));
 $('#look-motion').addEventListener('change', e => window.linTheme?.set('motion', e.target.checked ? 'calm' : 'full'));
 $('#look-captions').addEventListener('change', e => window.linTheme?.set('captions', e.target.checked ? 'large' : 'auto'));
 $('#look-sounds').addEventListener('change', e => window.linTheme?.set('sounds', e.target.checked ? 'on' : 'off'));
 $('#look-sound-test').addEventListener('click', () => { if (!window.linSounds?.play('listen')) $('#look-sound-test').textContent = $('#mute').checked ? 'Lin is muted' : 'Sounds are off'; });
 document.addEventListener('lin:theme', () => { syncLook(); draw(); });

 $('#map-canvas').tabIndex = -1;
 date(); syncLook(); current('home'); tasks(); ring();
 window.linHome = {view: () => base, ring: () => ({labels: [...svg.querySelectorAll('text')].map(t => t.textContent), events: svg.querySelectorAll('.event').length, value: svg.getAttribute('aria-valuetext')})};
})();
