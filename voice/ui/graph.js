(() => {
 'use strict';
 // Lin's living map. Canvas (not SVG) with a spatial grid for repulsion, so 2,000 items stay smooth.
 const $ = s => document.querySelector(s);
 const token = sessionStorage.getItem('lin-session-token') || '';
 const canvas = $('#map-canvas'), ctx = canvas.getContext('2d');
 const reduced = matchMedia('(prefers-reduced-motion: reduce)');
 const KINDS = {
   note: {label: 'Notes', color: '#7EE8CF'}, topic: {label: 'People and topics', color: '#8CB8FF'},
   task: {label: 'Tasks', color: '#FF8F7A'}, memory: {label: 'Memories', color: '#EFE6D2'}, event: {label: 'Events', color: '#E0B85C'}
 };
 const EDGES = {link: {label: 'Links', color: '#7EE8CF'}, mention: {label: 'Mentions', color: '#EFE6D2'}, schedule: {label: 'Scheduling', color: '#E0B85C'}};
 const SINGULAR = {note: 'Note', topic: 'Topic', task: 'Task', memory: 'Memory', event: 'Event'};
 const PULSE_EVERY_MS = 2600, PULSE_MS = 1400, FOCAL = 900;

 let nodes = [], edges = [], byId = new Map(), adj = new Map(), data = null;
 // Fly-to-source: passage/memory id -> map node, the nodes an answer used, and the camera flight in progress.
 let sourceIndex = new Map(), answerSources = null, flight = null;
 // Neighbourhoods: named groups from the server; zoomed out, the map shows their names instead of every label.
 let clusterInfo = new Map(), clustered = false, clusterBoxes = [];
 const OVERVIEW_ZOOM = .75;
 const overview = () => clustered && cam.k < OVERVIEW_ZOOM;
 let shownKinds = new Set(Object.keys(KINDS)), shownEdges = new Set(Object.keys(EDGES));
 let focus = null, hover = null, path = null, pathEdges = new Set(), query = '';
 let mode3d = false, cam = {x: 0, y: 0, k: 1}, rot = {yaw: .6, pitch: .28};
 let alpha = 1, repel = 120, linkLength = 100, dirty = true, fitted = false, pulses = [], lastPulse = 0;
 let width = 0, height = 0, dpr = 1, drag = null, loading = false, revision = null, closed = false;
 const sprites = {};

 function hash(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
 function api(path) { return fetch(path, {headers: {'X-Lin-Token': token}}).then(async r => { const d = await r.json(); if (!r.ok) throw Error(d.error || 'The map is unavailable.'); return d; }); }
 function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
 const visible = n => shownKinds.has(n.kind);
 const edgeVisible = e => shownEdges.has(e.kind) && visible(e.a) && visible(e.b);

 function sprite(color) {
   if (sprites[color]) return sprites[color];
   const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
   const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32); grad.addColorStop(0, color + '88'); grad.addColorStop(.35, color + '33'); grad.addColorStop(1, color + '00');
   g.fillStyle = grad; g.fillRect(0, 0, 64, 64); return sprites[color] = c;
 }

 function resize() {
   dpr = Math.min(2, window.devicePixelRatio || 1); width = innerWidth; height = innerHeight;
   canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); dirty = true;
 }

 function load(next) {
   data = next; revision = next.revision;
   const old = byId; byId = new Map(); adj = new Map();
   nodes = next.nodes.map(raw => {
     const prev = old.get(raw.id), h = hash(raw.id), a = h * Math.PI * 2, d = 60 + hash(raw.id + 'r') * 260;
     // New items start near their neighbourhood, so groups form as separate islands.
     const g = raw.cluster && raw.cluster !== 'c-other' ? hash(raw.cluster) * Math.PI * 2 : null, gx = g === null ? 0 : Math.cos(g) * 320, gy = g === null ? 0 : Math.sin(g) * 320, spread = g === null ? 1 : .35;
     const n = Object.assign(prev || {x: gx + Math.cos(a) * d * spread, y: gy + Math.sin(a) * d * spread, z: (hash(raw.id + 'z') - .5) * 300, vx: 0, vy: 0, vz: 0, seed: h * 100}, raw);
     n.r = 4 + Math.sqrt(raw.degree) * 3 + (raw.degree >= 8 ? 4 : 0); n.color = (KINDS[raw.kind] || KINDS.note).color;
     byId.set(n.id, n); adj.set(n.id, []); return n;
   });
   clusterInfo = new Map((next.clusters || []).map(c => [c.id, {...c, members: []}]));
   for (const n of nodes) { const c = clusterInfo.get(n.cluster); if (c) c.members.push(n); }
   clustered = clusterInfo.size >= 2 && nodes.length >= 30;
   renderClusters();
   sourceIndex = new Map();
   for (const n of nodes) { if (n.source_id) sourceIndex.set(n.source_id, n.id); for (const p of n.passages || []) sourceIndex.set(p.id, n.id); }
   if (answerSources) { answerSources = new Set([...answerSources].filter(id => byId.has(id))); if (!answerSources.size) answerSources = null; }
   edges = [];
   for (const raw of next.edges) {
     const a = byId.get(raw.source), b = byId.get(raw.target); if (!a || !b) continue;
     const e = {...raw, a, b, key: raw.source + '|' + raw.target}; edges.push(e); adj.get(a.id).push(e); adj.get(b.id).push(e);
   }
   if (focus && !byId.has(focus.id)) setFocus(null); else if (focus) { focus = byId.get(focus.id); renderInspector(); }
   if (path && path.some(id => !byId.has(id))) { path = null; pathEdges = new Set(); }
   alpha = Math.max(alpha, old.size ? .35 : 1); renderLens(); renderHubs(); renderList();
   $('#map-status').textContent = nodes.length ? `${nodes.length} items · ${edges.length} connections` : 'Your map is empty. Add notes to your Lin Brain folder, save a memory, add a task or import a calendar.';
   $('#demo-badge').hidden = !next.demo;
   if (!fitted && nodes.length) { for (let i = 0; i < (reduced.matches ? 400 : 160); i++) tick(); fit(); fitted = true; }
   dirty = true;
 }

 async function refresh() {
   if (loading || closed || document.hidden) return; loading = true;
   try { const next = await api('/api/graph'); if (next.revision !== revision) load(next); }
   catch (err) { $('#map-status').textContent = err.message; }
   finally { loading = false; }
 }

 // Physics: grid repulsion within a cutoff, springs along connections, gentle pull to the centre.
 function tick() {
   const live = nodes.filter(visible); if (!live.length) return;
   const cell = Math.max(60, repel * 1.7), grid = new Map();
   for (const n of live) { const k = Math.floor(n.x / cell) + ',' + Math.floor(n.y / cell); (grid.get(k) || grid.set(k, []).get(k)).push(n); }
   const strength = repel * repel * .5;
   for (const n of live) {
     const gx = Math.floor(n.x / cell), gy = Math.floor(n.y / cell);
     for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
       const bucket = grid.get((gx + i) + ',' + (gy + j)); if (!bucket) continue;
       for (const m of bucket) {
         if (m === n) continue;
         const dx = n.x - m.x, dy = n.y - m.y, dz = mode3d ? n.z - m.z : 0, d2 = dx * dx + dy * dy + dz * dz + .01;
         if (d2 > cell * cell * 2.2) continue;
         const f = Math.min(8, strength / d2) * alpha;
         n.vx += dx * f / 10; n.vy += dy * f / 10; if (mode3d) n.vz += dz * f / 10;
       }
     }
   }
   for (const e of edges) {
     if (!edgeVisible(e)) continue;
     const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, dz = mode3d ? e.b.z - e.a.z : 0, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
     const pull = (d - linkLength) / d * .04 * alpha * (e.kind === 'link' ? 1.2 : .8);
     e.a.vx += dx * pull; e.a.vy += dy * pull; e.b.vx -= dx * pull; e.b.vy -= dy * pull;
     if (mode3d) { e.a.vz += dz * pull; e.b.vz -= dz * pull; }
   }
   if (clustered) {
     const centre = new Map();
     for (const n of live) { const c = centre.get(n.cluster) || centre.set(n.cluster, {x: 0, y: 0, z: 0, k: 0}).get(n.cluster); c.x += n.x; c.y += n.y; c.z += n.z; c.k++; }
     for (const n of live) { const c = centre.get(n.cluster); if (!c || c.k < 3 || n.cluster === 'c-other') continue; n.vx += (c.x / c.k - n.x) * .02 * alpha; n.vy += (c.y / c.k - n.y) * .02 * alpha; if (mode3d) n.vz += (c.z / c.k - n.z) * .02 * alpha; }
   }
   for (const n of live) {
     const lonely = adj.get(n.id).length ? 1 : 3;
     n.vx -= n.x * .0018 * alpha * lonely; n.vy -= n.y * .0018 * alpha * lonely; n.vz -= n.z * .002 * alpha;
     if (n.pinned) { n.vx = n.vy = n.vz = 0; continue; }
     n.vx *= .78; n.vy *= .78; n.vz *= .78;
     n.x += Math.max(-30, Math.min(30, n.vx)); n.y += Math.max(-30, Math.min(30, n.vy));
     if (mode3d) n.z += Math.max(-30, Math.min(30, n.vz)); else n.z *= .8;
   }
   alpha = Math.max(.004, alpha * .985);
 }

 function project(n, t) {
   let x = n.x, y = n.y, z = mode3d ? n.z : 0;
   if (!reduced.matches && alpha < .05) { x += Math.sin(t * .0007 + n.seed) * 1.3; y += Math.cos(t * .0006 + n.seed * 1.7) * 1.3; }
   if (mode3d) {
     const cy = Math.cos(rot.yaw), sy = Math.sin(rot.yaw), cp = Math.cos(rot.pitch), sp = Math.sin(rot.pitch);
     const x1 = x * cy + z * sy, z1 = -x * sy + z * cy, y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
     const p = FOCAL / (FOCAL + z2);
     return {x: width / 2 + cam.x + x1 * p * cam.k, y: height / 2 + cam.y + y1 * p * cam.k, s: p * cam.k, depth: z2};
   }
   return {x: width / 2 + cam.x + x * cam.k, y: height / 2 + cam.y + y * cam.k, s: cam.k, depth: 0};
 }

 function litSet() {
   const subject = hover || focus; const set = new Set();
   if (subject) { set.add(subject.id); for (const e of adj.get(subject.id) || []) if (edgeVisible(e)) { set.add(e.a.id); set.add(e.b.id); } }
   if (path) path.forEach(id => set.add(id));
   if (answerSources) for (const id of answerSources) { set.add(id); for (const e of adj.get(id) || []) if (edgeVisible(e)) { set.add(e.a.id); set.add(e.b.id); } }
   return set;
 }

 function draw(t) {
   ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
   ctx.fillStyle = '#051519'; ctx.fillRect(0, 0, width, height);
   const subject = hover || focus, lit = litSet(), dimming = !!(subject || path || answerSources);
   for (const n of nodes) n.p = visible(n) ? project(n, t) : null;
   // Connections, grouped by kind so dashes and colours change rarely.
   for (const kind of Object.keys(EDGES)) {
     ctx.strokeStyle = EDGES[kind].color; ctx.setLineDash(kind === 'mention' ? [4, 4] : []);
     for (const pass of [0, 1]) {
       ctx.beginPath(); let any = false;
       for (const e of edges) {
         if (e.kind !== kind || !edgeVisible(e)) continue;
         const strong = pathEdges.has(e.key) || (subject && (e.a === subject || e.b === subject));
         if ((pass === 1) !== !!strong) continue;
         ctx.moveTo(e.a.p.x, e.a.p.y); ctx.lineTo(e.b.p.x, e.b.p.y); any = true;
       }
       if (!any) continue;
       ctx.globalAlpha = pass ? .85 : dimming ? .05 : (kind === 'link' ? .2 : .13); ctx.lineWidth = pass ? (path ? 2.2 : 1.5) : 1; ctx.stroke();
     }
   }
   ctx.setLineDash([]); ctx.globalAlpha = 1;
   // Idle pulses travel along a random connection.
   if (!reduced.matches && !document.hidden) {
     if (t - lastPulse > PULSE_EVERY_MS && edges.length) { const choices = edges.filter(edgeVisible); if (choices.length) pulses.push({e: choices[Math.floor(Math.random() * choices.length)], t0: t}); lastPulse = t; }
     pulses = pulses.filter(p => t - p.t0 < PULSE_MS && edgeVisible(p.e));
     for (const p of pulses) {
       const k = (t - p.t0) / PULSE_MS, x = p.e.a.p.x + (p.e.b.p.x - p.e.a.p.x) * k, y = p.e.a.p.y + (p.e.b.p.y - p.e.a.p.y) * k;
       ctx.globalAlpha = Math.sin(k * Math.PI) * .9; ctx.drawImage(sprite(EDGES[p.e.kind].color), x - 9, y - 9, 18, 18);
       ctx.fillStyle = '#FFF8EA'; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 6.283); ctx.fill();
     }
     ctx.globalAlpha = 1;
   }
   const order = nodes.filter(n => n.p); if (mode3d) order.sort((a, b) => b.p.depth - a.p.depth);
   const q = query.toLocaleLowerCase();
   for (const n of order) {
     const r = Math.max(1.5, n.r * n.p.s), on = !dimming || lit.has(n.id), depthFade = mode3d ? Math.max(.35, Math.min(1, 1 - n.p.depth / 900)) : 1;
     ctx.globalAlpha = (on ? 1 : .12) * depthFade;
     if (on && (n.degree >= 4 || lit.has(n.id))) ctx.drawImage(sprite(n.color), n.p.x - r * 2.6, n.p.y - r * 2.6, r * 5.2, r * 5.2);
     ctx.fillStyle = n.color; ctx.beginPath(); ctx.arc(n.p.x, n.p.y, n === hover ? r * 1.25 : r, 0, 6.283); ctx.fill();
     if (n === focus || (path && (n.id === path[0] || n.id === path[path.length - 1]))) { ctx.strokeStyle = '#EFE6D2'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(n.p.x, n.p.y, r + 6, 0, 6.283); ctx.stroke(); }
     if (answerSources && answerSources.has(n.id)) { const glow = reduced.matches ? .8 : .55 + .35 * Math.sin(t / 380); ctx.strokeStyle = `rgba(126,232,207,${glow})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(n.p.x, n.p.y, r + 10, 0, 6.283); ctx.stroke(); }
     if (q && n.title.toLocaleLowerCase().includes(q)) { ctx.strokeStyle = '#7EE8CF'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(n.p.x, n.p.y, r + 4, 0, 6.283); ctx.stroke(); }
   }
   ctx.globalAlpha = 1;
   const placed = drawLabels(order, lit, dimming);
   clusterBoxes = overview() ? drawClusters(placed, dimming) : [];
 }

 // Zoomed out: a soft region and a name for each neighbourhood. Click a name to open it.
 function drawClusters(placed, dimming) {
   const boxes = [];
   for (const c of clusterInfo.values()) {
     const pts = c.members.filter(n => n.p); if (pts.length < 3 || c.id === 'c-other') continue;
     const x = pts.reduce((s, n) => s + n.p.x, 0) / pts.length, y = pts.reduce((s, n) => s + n.p.y, 0) / pts.length;
     const d = pts.map(n => Math.hypot(n.p.x - x, n.p.y - y)).sort((a, b) => a - b), r = Math.max(28, d[Math.floor(d.length * .7)] + 16);
     ctx.globalAlpha = dimming ? .25 : 1;
     ctx.fillStyle = 'rgba(126,232,207,.035)'; ctx.strokeStyle = 'rgba(126,232,207,.16)'; ctx.lineWidth = 1;
     ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); ctx.stroke();
     ctx.font = `600 ${c.size >= 20 ? 16 : 14}px Bahnschrift, 'Segoe UI', sans-serif`;
     const text = c.name, sub = `${c.size} items`, w = Math.max(ctx.measureText(text).width, 50);
     const box = {x: x - w / 2 - 8, y: y - 13, w: w + 16, h: 34, c};
     if (placed.some(b => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) continue;
     placed.push(box); boxes.push(box);
     ctx.fillStyle = 'rgba(5,21,25,.78)'; ctx.fillRect(box.x, box.y, box.w, box.h);
     ctx.fillStyle = '#EFE6D2'; ctx.textBaseline = 'top'; ctx.textAlign = 'center'; ctx.fillText(text, x, box.y + 3);
     ctx.font = `400 11px Bahnschrift, 'Segoe UI', sans-serif`; ctx.fillStyle = 'rgba(227,241,238,.6)'; ctx.fillText(sub, x, box.y + 20); ctx.textAlign = 'left';
   }
   ctx.globalAlpha = 1;
   return boxes;
 }
 function openCluster(c) {
   const members = c.members.filter(visible); if (!members.length) return;
   setFocus(null, true); flyTo(camFor(members.length === 1 ? members : members, members.length === 1 ? 1.4 : undefined));
   $('#map-status').textContent = `${c.name} · ${c.size} items · ${c.why}`; dirty = true;
 }
 function renderClusters() {
   const box = $('#cluster-list'); if (!box) return; box.replaceChildren();
   const list = [...clusterInfo.values()].filter(c => c.id !== 'c-other').slice(0, 10);
   $('#cluster-section').hidden = !clustered || !list.length;
   for (const c of list) {
     const b = el('button', ''); b.type = 'button'; b.title = c.why;
     b.append(el('span', '', c.name), el('span', 'count', String(c.size)));
     b.addEventListener('click', () => openCluster(c)); box.append(b);
   }
 }

 // Most connected first; any label that would overlap one already placed is skipped.
 function drawLabels(order, lit, dimming) {
   const placed = [], q = query.toLocaleLowerCase();
   const ranked = order.slice().sort((a, b) => score(b) - score(a));
   const far = overview();
   function score(n) { return (n === focus ? 1e6 : 0) + (n === hover ? 1e6 : 0) + (lit.has(n.id) && dimming ? 1e4 : 0) + (q && n.title.toLocaleLowerCase().includes(q) ? 5e3 : 0) + n.degree; }
   let count = 0;
   for (const n of ranked) {
     if (count >= 70) break;
     const important = n === focus || n === hover || (dimming && lit.has(n.id)) || (q && n.title.toLocaleLowerCase().includes(q));
     if (!important && (dimming || n.degree < 2 || far)) continue;
     const size = n === focus || n === hover ? 15 : n.degree >= 8 ? 13 : 12;
     ctx.font = `${n === focus ? 500 : 400} ${size}px Bahnschrift, 'Segoe UI', sans-serif`;
     const text = n.title.length > 34 ? n.title.slice(0, 33) + '…' : n.title, w = ctx.measureText(text).width;
     const r = n.r * n.p.s, box = {x: n.p.x - w / 2 - 3, y: n.p.y + r + 4, w: w + 6, h: size + 4};
     if (placed.some(b => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) continue;
     placed.push(box); count++;
     ctx.globalAlpha = important || !dimming ? 1 : .35; ctx.fillStyle = 'rgba(5,21,25,.65)'; ctx.fillRect(box.x, box.y, box.w, box.h);
     ctx.fillStyle = '#E3F1EE'; ctx.textBaseline = 'top'; ctx.fillText(text, box.x + 3, box.y + 2);
   }
   ctx.globalAlpha = 1;
   return placed;
 }

 function loop(t) {
   if (alpha > .005 && !drag?.rotating) { tick(); dirty = true; }
   if (flight) {
     const u = Math.min(1, (t - flight.t0) / flight.ms), ease = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
     for (const k of ['x', 'y', 'k']) cam[k] = flight.from[k] + (flight.to[k] - flight.from[k]) * ease;
     if (u >= 1) flight = null; dirty = true;
   }
   if (answerSources && !reduced.matches) dirty = true;
   if (dirty || pulses.length || (!reduced.matches && alpha < .05) || t - lastPulse > PULSE_EVERY_MS) { draw(t); dirty = false; }
   requestAnimationFrame(loop);
 }

 function hit(x, y) {
   let best = null, bestD = Infinity;
   for (const n of nodes) {
     if (!n.p) continue; const r = Math.max(6, n.r * n.p.s + 5), d = Math.hypot(n.p.x - x, n.p.y - y);
     if (d < r && (d < bestD || (mode3d && best && n.p.depth < best.p.depth))) { best = n; bestD = d; }
   }
   return best;
 }

 function panelRect() {
   const left = $('#inspector').offsetParent ? $('#inspector').getBoundingClientRect().right + 20 : 20;
   const lens = $('#lens').offsetParent ? $('#lens').getBoundingClientRect().left - 20 : width - 20;
   const bottom = $('.conversation').getBoundingClientRect().top - 20;
   return {left: Math.min(left, width * .45), right: Math.max(lens, width * .55), top: 96, bottom: Math.max(bottom, height * .45)};
 }

 function fit() {
   const live = nodes.filter(visible); if (!live.length) return;
   const box = panelRect(), saved = cam.k; cam = {x: 0, y: 0, k: 1};
   const pts = live.map(n => project(n, 0)), minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x)), minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
   const k = Math.max(.15, Math.min(2.2, (box.right - box.left) / Math.max(80, maxX - minX), (box.bottom - box.top) / Math.max(80, maxY - minY)) * .9);
   cam.k = isFinite(k) ? k : saved;
   cam.x = (box.left + box.right) / 2 - width / 2 - ((minX + maxX) / 2 - width / 2) * cam.k;
   cam.y = (box.top + box.bottom) / 2 - height / 2 - ((minY + maxY) / 2 - height / 2) * cam.k;
   dirty = true;
 }

 function zoomAt(factor, x = width / 2, y = height / 2) {
   const next = Math.max(.12, Math.min(6, cam.k * factor)), ratio = next / cam.k;
   cam.x = x - width / 2 - (x - width / 2 - cam.x) * ratio; cam.y = y - height / 2 - (y - height / 2 - cam.y) * ratio; cam.k = next; dirty = true;
 }

 // Shortest path by breadth-first search over visible connections.
 function trace(from, to) {
   const prev = new Map([[from.id, null]]), queue = [from.id];
   while (queue.length) {
     const id = queue.shift(); if (id === to.id) break;
     for (const e of adj.get(id)) { if (!edgeVisible(e)) continue; const other = e.a.id === id ? e.b.id : e.a.id; if (!prev.has(other)) { prev.set(other, e); queue.push(other); } }
   }
   if (!prev.has(to.id)) return null;
   const ids = [to.id], keys = new Set(); let id = to.id;
   while (prev.get(id)) { const e = prev.get(id); keys.add(e.key); id = e.a.id === id ? e.b.id : e.a.id; ids.unshift(id); }
   return {ids, keys};
 }

 function setFocus(n, quiet = false) {
   focus = n; path = null; pathEdges = new Set(); dirty = true;
   document.body.classList.toggle('focused', !!n); renderInspector();
   if (!quiet) document.dispatchEvent(new CustomEvent('lin:map-focus', {detail: n ? {id: n.id, title: n.title, kind: n.kind} : null}));
 }

 function centreOn(n) { const p = project(n, 0), box = panelRect(); cam.x += (box.left + box.right) / 2 - p.x; cam.y += (box.top + box.bottom) / 2 - p.y; dirty = true; }

 // Camera targets for a flight: centre one node at a zoom, or frame a group of nodes.
 function camFor(list, zoom) {
   const saved = {...cam}, box = panelRect();
   if (list.length === 1) { cam.k = zoom; const p = project(list[0], 0); const to = {x: cam.x + (box.left + box.right) / 2 - p.x, y: cam.y + (box.top + box.bottom) / 2 - p.y, k: zoom}; cam = saved; return to; }
   cam = {x: 0, y: 0, k: 1};
   const pts = list.map(n => project(n, 0)), minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x)), minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
   const k = Math.max(.15, Math.min(2.2, Math.min((box.right - box.left) / Math.max(120, maxX - minX), (box.bottom - box.top) / Math.max(120, maxY - minY)) * .8));
   const to = {x: (box.left + box.right) / 2 - width / 2 - ((minX + maxX) / 2 - width / 2) * k, y: (box.top + box.bottom) / 2 - height / 2 - ((minY + maxY) / 2 - height / 2) * k, k};
   cam = saved; return to;
 }
 function flyTo(to) { if (reduced.matches) { cam = {...to}; flight = null; dirty = true; return; } flight = {from: {...cam}, to, t0: performance.now(), ms: 1100}; }

 // The answer used these sources: one note -> fly to it and open it; four or more -> light up the whole cluster.
 function showSources(ids) {
   const list = [...new Set(ids.map(id => sourceIndex.get(id)).filter(Boolean))].map(id => byId.get(id)).filter(n => n && visible(n));
   if (!list.length) return;
   answerSources = new Set(list.map(n => n.id)); path = null; pathEdges = new Set();
   if (list.length >= 4) {
     setFocus(null, true); flyTo(camFor(list));
     $('#map-status').textContent = `Lin answered from ${list.length} sources · lit up on the map`;
   } else {
     setFocus(list[0]); flyTo(camFor([list[0]], Math.max(cam.k, 1.4)));
     $('#map-status').textContent = list.length === 1 ? `Lin answered from ${list[0].title}` : `Lin answered from ${list[0].title} and ${list.length - 1} more`;
   }
   dirty = true;
 }
 function clearSources() { if (answerSources) { answerSources = null; dirty = true; } }
 document.addEventListener('lin:answer-context', e => {
   const job = e.detail || {};
   // Only answers that used your notes or memories move the map; small talk leaves it where it is.
   const ids = [];
   if (job.mode === 'brain') for (const s of job.sources || []) ids.push(s.id);
   if (job.checked && job.checked.tool === 'notes') for (const item of job.checked.items || []) ids.push(item.id);
   if (ids.length) showSources(ids);
 });
 document.addEventListener('lin:response-cleared', clearSources);
 // A note Lin just saved: wait for it to appear on the map, then fly to it.
 document.addEventListener('lin:fly-to-path', e => {
   const want = String(e.detail || '').replace(/\\/g, '/'); let tries = 0;
   const look = () => {
     const n = nodes.find(x => x.path && x.path.replace(/\\/g, '/') === want);
     if (n) { answerSources = new Set([n.id]); setFocus(n); flyTo(camFor([n], Math.max(cam.k, 1.4))); $('#map-status').textContent = `Saved to Lin Brain · ${n.title}`; dirty = true; return; }
     if (++tries < 25) { refresh(); setTimeout(look, 1000); }
   };
   look();
 });

 function linkRow(e, from) {
   const other = e.a === from ? e.b : e.a, b = el('button', '');
   b.type = 'button'; const dot = el('span', 'kind-dot'); dot.style.background = other.color;
   b.append(dot, el('span', '', other.title), el('span', 'why', e.why[0]));
   b.addEventListener('click', () => { setFocus(other); centreOn(other); });
   return b;
 }

 function renderInspector() {
   $('#inspector-empty').hidden = !!focus; $('#inspector-focus').hidden = !focus;
   if (!focus) return;
   $('#focus-dot').style.background = focus.color; $('#focus-kind').textContent = SINGULAR[focus.kind] || focus.kind;
   $('#focus-title').textContent = focus.title; $('#focus-detail').textContent = focus.detail || '';
   $('#focus-flag').hidden = !focus.flag; $('#focus-text').textContent = focus.preview || '';
   const list = $('#focus-links'); list.replaceChildren();
   if (path) {
     $('#focus-links-title').textContent = `Path to ${byId.get(path[path.length - 1]).title} · ${path.length - 1} step${path.length === 2 ? '' : 's'}`;
     for (let i = 1; i < path.length; i++) {
       const a = byId.get(path[i - 1]), b = byId.get(path[i]), e = adj.get(a.id).find(x => x.a === b || x.b === b);
       if (e) list.append(linkRow(e, a));
     }
   } else {
     const links = adj.get(focus.id).filter(edgeVisible).sort((x, y) => ({link: 0, schedule: 1, mention: 2}[x.kind] - {link: 0, schedule: 1, mention: 2}[y.kind]));
     $('#focus-links-title').textContent = links.length ? `Connected to ${links.length} · why` : 'No connections in this view';
     links.slice(0, 30).forEach(e => list.append(linkRow(e, focus)));
   }
   $('#focus-open').hidden = !['note', 'memory', 'task', 'event'].includes(focus.kind);
   $('#focus-open').textContent = {note: 'Open passage', memory: 'Open memory', task: 'Open in Plan', event: 'Open in Today'}[focus.kind] || 'Open';
 }

 function renderHubs() {
   const box = $('#hub-list'); box.replaceChildren();
   for (const h of (data?.hubs || [])) {
     const n = byId.get(h.id); if (!n) continue;
     const b = el('button', ''); b.type = 'button'; const dot = el('span', 'kind-dot'); dot.style.background = n.color;
     b.append(dot, el('span', '', n.title), el('span', 'count', String(n.degree)));
     b.addEventListener('click', () => { setFocus(n); centreOn(n); }); box.append(b);
   }
   if (!box.children.length) box.append(el('p', 'hint', 'Nothing is connected yet.'));
 }

 function renderList() {
   const box = $('#map-list'); box.replaceChildren();
   nodes.filter(visible).slice().sort((a, b) => a.title.localeCompare(b.title)).slice(0, 400).forEach(n => {
     const b = el('button', ''); b.type = 'button'; const dot = el('span', 'kind-dot'); dot.style.background = n.color;
     b.append(dot, el('span', '', n.title)); b.setAttribute('aria-label', `${n.title}, ${SINGULAR[n.kind]}, ${n.degree} connections`);
     b.addEventListener('click', () => { setFocus(n); centreOn(n); }); box.append(b);
   });
 }

 function renderLens() {
   const kinds = $('#kind-filters'), links = $('#edge-filters'); kinds.replaceChildren(); links.replaceChildren();
   for (const [k, v] of Object.entries(KINDS)) {
     const label = el('label', ''), box = document.createElement('input'), dot = el('span', 'kind-dot');
     box.type = 'checkbox'; box.checked = shownKinds.has(k); dot.style.background = v.color;
     box.addEventListener('change', () => { box.checked ? shownKinds.add(k) : shownKinds.delete(k); alpha = Math.max(alpha, .4); renderList(); renderInspector(); dirty = true; });
     label.append(box, dot, el('span', '', v.label), el('span', 'n', String(data?.counts?.[k] || 0))); kinds.append(label);
   }
   for (const [k, v] of Object.entries(EDGES)) {
     const label = el('label', ''), box = document.createElement('input'), sample = el('span', 'edge-sample ' + k);
     box.type = 'checkbox'; box.checked = shownEdges.has(k); sample.style.borderTopColor = v.color;
     box.addEventListener('change', () => { box.checked ? shownEdges.add(k) : shownEdges.delete(k); alpha = Math.max(alpha, .3); renderInspector(); dirty = true; });
     label.append(box, sample, el('span', '', v.label), el('span', 'n', String(data?.edge_counts?.[k] || 0))); links.append(label);
   }
 }

 function setMode(three) {
   mode3d = three; $('#view-2d').setAttribute('aria-pressed', String(!three)); $('#view-3d').setAttribute('aria-pressed', String(three));
   if (three) for (const n of nodes) n.z = (hash(n.id + 'z') - .5) * 320;
   alpha = .8; for (let i = 0; i < 60; i++) tick(); fit();
 }

 // Pointer: drag a node to move it, drag empty space to pan (or turn, in 3D), click to focus,
 // Shift-click a second item to trace the path between them.
 canvas.addEventListener('pointerdown', e => {
   flight = null; clearSources();
   canvas.setPointerCapture(e.pointerId); const n = hit(e.offsetX, e.offsetY);
   drag = {x: e.offsetX, y: e.offsetY, moved: 0, node: n && !mode3d ? n : null, target: n, rotating: mode3d && !n, shift: e.shiftKey};
   if (drag.node) drag.node.pinned = true;
   canvas.classList.add('dragging');
 });
 canvas.addEventListener('pointermove', e => {
   if (!drag) {
     const n = hit(e.offsetX, e.offsetY); if (n !== hover) { hover = n; dirty = true; canvas.classList.toggle('pointing', !!n); }
     return;
   }
   const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.offsetX; drag.y = e.offsetY;
   if (drag.node && drag.moved > 3) { drag.node.x += dx / cam.k; drag.node.y += dy / cam.k; alpha = Math.max(alpha, .25); }
   else if (drag.rotating) { rot.yaw += dx * .006; rot.pitch = Math.max(-1.3, Math.min(1.3, rot.pitch + dy * .006)); }
   else if (!drag.node) { cam.x += dx; cam.y += dy; }
   dirty = true;
 });
 function endDrag(e) {
   if (!drag) return; const d = drag; drag = null; canvas.classList.remove('dragging');
   if (d.node) d.node.pinned = false;
   if (d.moved < 5 && !d.target) {
     const hitBox = clusterBoxes.find(b => d.x >= b.x && d.x <= b.x + b.w && d.y >= b.y && d.y <= b.y + b.h);
     if (hitBox) { openCluster(hitBox.c); return; }
   }
   if (d.moved < 5) {
     const n = d.target;
     if (n && (d.shift || e.shiftKey) && focus && n !== focus) {
       const found = trace(focus, n); if (found) { path = found.ids; pathEdges = found.keys; } else { path = null; pathEdges = new Set(); $('#map-status').textContent = `No path between ${focus.title} and ${n.title} in this view.`; }
       renderInspector(); dirty = true;
     } else setFocus(n || null);
   }
 }
 canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', () => { if (drag?.node) drag.node.pinned = false; drag = null; });
 canvas.addEventListener('pointerleave', () => { if (!drag && hover) { hover = null; dirty = true; } });
 canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * .0015), e.offsetX, e.offsetY); }, {passive: false});
 canvas.addEventListener('keydown', e => {
   const step = 40, keys = {ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step]};
   if (keys[e.key]) { cam.x += keys[e.key][0]; cam.y += keys[e.key][1]; dirty = true; e.preventDefault(); }
   else if (e.key === '+' || e.key === '=') zoomAt(1.2); else if (e.key === '-') zoomAt(1 / 1.2); else if (e.key === '0') fit();
 });

 $('#map-search').addEventListener('input', e => { query = e.target.value.trim(); dirty = true; });
 $('#map-search').addEventListener('keydown', e => {
   if (e.key !== 'Enter') return; const q = query.toLocaleLowerCase(); if (!q) return;
   const match = nodes.filter(n => visible(n) && n.title.toLocaleLowerCase().includes(q)).sort((a, b) => b.degree - a.degree)[0];
   const hood = !match && [...clusterInfo.values()].find(c => c.name.toLocaleLowerCase().includes(q));
   if (match) { setFocus(match); flyTo(camFor([match], Math.max(cam.k, 1.2))); }
   else if (hood) openCluster(hood);
   else $('#map-status').textContent = `Nothing on the map is called “${query}”.`;
 });
 $('#view-2d').addEventListener('click', () => setMode(false));
 $('#view-3d').addEventListener('click', () => setMode(true));
 $('#map-fit').addEventListener('click', fit);
 $('#force-repel').addEventListener('input', e => { repel = Number(e.target.value); alpha = Math.max(alpha, .5); });
 $('#force-link').addEventListener('input', e => { linkLength = Number(e.target.value); alpha = Math.max(alpha, .5); });
 $('#focus-clear').addEventListener('click', () => setFocus(null));
 $('#focus-ask').addEventListener('click', () => {
   if (!focus) return; const input = $('#request-input');
   input.value = focus.kind === 'task' ? `When can I work on ${focus.title}?` : focus.kind === 'event' ? `What should I prepare for ${focus.title}?` : `What do my notes say about ${focus.title}?`;
   input.dispatchEvent(new Event('input')); input.focus();
 });
 $('#focus-open').addEventListener('click', async () => {
   if (!focus) return;
   if (focus.kind === 'task') return document.dispatchEvent(new CustomEvent('lin:view', {detail: 'planner'}));
   if (focus.kind === 'event') return document.dispatchEvent(new CustomEvent('lin:view', {detail: 'today'}));
   try {
     const s = await api('/api/sources/' + focus.source_id);
     $('#source-title').textContent = s.kind === 'file' ? focus.title : s.title;
     $('#source-meta').textContent = s.kind === 'file' ? `${s.path} · ${s.where||`lines ${s.line_start}–${s.line_end}`}${s.document?' · read from '+s.document:''}` : `Saved by you · ${s.scope} · revision ${s.revision}`;
     const pre = document.createElement('pre'); pre.textContent = s.body; $('#source-content').replaceChildren(pre); $('#source-dialog').showModal();
   } catch (err) { $('#map-status').textContent = err.message; }
 });
 document.addEventListener('lin:graph-refresh', refresh);
 document.addEventListener('lin:close-mic', () => {});
 document.addEventListener('lin:work-state', e => { closed = !!e.detail.closed; });
 document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
 window.addEventListener('resize', () => { resize(); });
 // Hooks for the automated checks; they read state or measure, and never change your data.
 function benchmark(count) {
   const saved = data, fake = {nodes: [], edges: [], counts: {}, edge_counts: {}, hubs: [], revision: 'benchmark', demo: saved?.demo};
   const kinds = Object.keys(KINDS), kindsEdge = Object.keys(EDGES);
   for (let i = 0; i < count; i++) fake.nodes.push({id: 'b' + i, kind: kinds[i % 5], title: 'Item ' + i, degree: 0, preview: '', cluster: 'bc' + (i % 20)});
   fake.clusters = Array.from({length: 20}, (_, i) => ({id: 'bc' + i, name: 'Group ' + i, size: Math.ceil(count / 20), why: 'benchmark', kinds: {}}));
   for (let i = 1; i < count; i++) for (const j of [Math.floor(hash('p' + i) * i), Math.floor(hash('q' + i) * i)]) if (j !== i) { fake.edges.push({source: 'b' + j, target: 'b' + i, kind: kindsEdge[i % 3], why: ['benchmark']}); fake.nodes[i].degree++; fake.nodes[j].degree++; }
   const before = fitted; fitted = true; load(fake); alpha = 1;
   const times = []; for (let f = 0; f < 90; f++) { const t0 = performance.now(); tick(); draw(performance.now()); times.push(performance.now() - t0); }
   times.sort((a, b) => a - b); fitted = before; revision = null; refresh();
   return {nodes: count, edges: fake.edges.length, median_ms: +times[45].toFixed(2), p95_ms: +times[85].toFixed(2)};
 }
 window.linMap = {fit, benchmark, focusById: id => { const n = byId.get(id); if (n) { setFocus(n); centreOn(n); } },
   screen: id => { const n = byId.get(id); return n && n.p ? {x: n.p.x, y: n.p.y} : null; },
   stats: () => ({nodes: nodes.length, edges: edges.length, visible: nodes.filter(visible).length, focus: focus?.id || null, path: path ? path.slice() : null, mode3d, revision,
                  sources: answerSources ? [...answerSources] : [], flying: !!flight, camera: {...cam}}),
   showSources,
   clusters: () => [...clusterInfo.values()].map(c => ({id: c.id, name: c.name, size: c.size, why: c.why})),
   overview, clusterBoxes: () => clusterBoxes.map(b => ({name: b.c.name, x: b.x + b.w / 2, y: b.y + b.h / 2})), zoomTo: k => { zoomAt(k / cam.k); }};
 resize(); refresh(); setInterval(refresh, 5000); requestAnimationFrame(loop);
})();
