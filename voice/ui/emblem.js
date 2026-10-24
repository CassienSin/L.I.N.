(() => {
 'use strict';
 // Lin's emblem: rings, a sweep, two orbits and an eye. Its mood comes from what Lin is actually doing
 // (body data-state and data-presence), and it follows her voice (--energy) and yours (--mic).
 // Motion runs in one animation loop so speed eases between moods instead of jumping; calm motion holds it still.
 const NS = 'http://www.w3.org/2000/svg';
 const orb = document.querySelector('#orb');
 if (!orb) return;
 const MOODS = {
   ready: {speed: 1, breath: 4.5, code: 'READY', word: 'ready'},
   listening: {speed: .85, breath: 1.8, code: 'LISTEN', word: 'listening'},
   thinking: {speed: 2.3, breath: 2.6, code: 'THINK', word: 'thinking'},
   speaking: {speed: 1.2, breath: 1.2, code: 'VOICE', word: 'speaking'},
   waiting: {speed: .5, breath: 3.2, code: 'WAITING', word: 'waiting for your approval'},
   seeing: {speed: 1.5, breath: 2.2, code: 'SEEING', word: 'looking at your screen'},
   offline: {speed: .15, breath: 8, code: 'OFFLINE', word: 'offline'},
   online: {speed: 1.8, breath: 2.2, code: 'LINK · CLAUDE', word: 'asking Claude online'}
 };
 const STATE_TO_MOOD = {listening: 'listening', recording: 'listening', thinking: 'thinking', preparing: 'thinking', transcribing: 'thinking',
   speaking: 'speaking', waiting: 'speaking', seeing: 'seeing', error: 'offline', stopped: 'ready', paused: 'ready', complete: 'ready', ready: 'ready'};

 function make(tag, attrs, parent) {
   const n = document.createElementNS(NS, tag);
   for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
   if (parent) parent.append(n);
   return n;
 }
 const id = 'lin-e', url = s => `url(#${id}-${s})`;
 const svg = make('svg', {viewBox: '0 0 400 400', 'aria-hidden': 'true', focusable: 'false'});
 const defs = make('defs', {}, svg);
 function gradient(name, kind, attrs, stops) {
   const g = make(kind, {id: `${id}-${name}`, ...attrs}, defs);
   for (const [offset, cls, opacity, color] of stops) {
     const s = make('stop', {offset}, g);
     if (cls) s.setAttribute('class', cls); if (color) s.setAttribute('stop-color', color);
     if (opacity !== undefined) s.setAttribute('stop-opacity', opacity);
   }
   return g;
 }
 const haloGrad = gradient('halo', 'radialGradient', {cx: .5, cy: .5, r: .5}, [[0, 'ln-s-halo', .38], [.55, 'ln-s-halo', .11], [1, 'ln-s-halo', 0]]);
 gradient('core', 'radialGradient', {cx: .36, cy: .3, r: .8}, [[0, '', 1, '#FFFFFF'], [.12, 'ln-s-c1'], [.3, 'ln-s-c2'], [.58, 'ln-s-c3'], [.84, 'ln-s-c4'], [1, '', 1, '#030810']]);
 gradient('iris', 'radialGradient', {cx: .5, cy: .5, r: .5}, [[0, '', 1, '#010A10'], [.5, '', 1, '#042A38'], [.82, 'ln-s-c3'], [1, 'ln-s-c1']]);
 gradient('sat', 'radialGradient', {cx: .5, cy: .5, r: .5}, [[0, '', 1, '#FFFFFF'], [.35, 'ln-s-1', .8], [1, 'ln-s-1', 0]]);
 const sweepGrad = gradient('sweep', 'linearGradient', {gradientUnits: 'userSpaceOnUse', x1: 200, y1: 32, x2: 308, y2: 71}, [[0, 'ln-s-1', 0], [1, 'ln-s-1', .32]]);
 make('path', {id: `${id}-text`, d: 'M200 200 m-183 0 a183 183 0 1 1 366 0 a183 183 0 1 1 -366 0'}, defs);
 const clip = make('clipPath', {id: `${id}-clip`}, defs); make('circle', {cx: 200, cy: 200, r: 89}, clip);

 // Layers, outermost first. Each has an assembly delay for the start-up sequence.
 const layers = [];
 const layer = (delay, detail) => { const g = make('g', detail ? {class: 'ln-detail'} : {}, svg); layers.push({g, delay}); return g; };

 const L0 = layer(.55);
 const halo = make('circle', {cx: 200, cy: 200, r: 190, fill: url('halo')}, L0);

 const L1 = layer(.05, true);
 for (const [x1, y1, x2, y2] of [[200, 2, 200, 12], [200, 388, 200, 398], [2, 200, 12, 200], [388, 200, 398, 200]]) make('line', {x1, y1, x2, y2, class: 'ln-c1', 'stroke-opacity': .55, 'stroke-width': 1.2}, L1);
 const textRing = make('g', {}, L1);
 const text = make('text', {class: 'ln-text', 'font-size': 8.2, 'letter-spacing': 2.6, 'fill-opacity': .62}, textRing);
 const tp = make('textPath', {href: `#${id}-text`}, text);
 tp.textContent = 'LIN · LOCAL INTELLIGENCE NETWORK · ON THIS PC · OFFLINE READY · LIN · LOCAL INTELLIGENCE NETWORK · ON THIS PC · ';

 const L2 = layer(0);
 const ticks = make('g', {}, L2);
 make('circle', {cx: 200, cy: 200, r: 171, fill: 'none', class: 'ln-c1', 'stroke-opacity': .42, 'stroke-width': 1, 'stroke-dasharray': '0.9 3.58'}, ticks);
 make('circle', {cx: 200, cy: 200, r: 171, fill: 'none', class: 'ln-c1', 'stroke-opacity': .85, 'stroke-width': 7, 'stroke-dasharray': '1.6 87.94'}, ticks);

 const L3 = layer(.25, true);
 const sweep = make('g', {}, L3);
 make('path', {d: 'M200 200 L200 32 A168 168 0 0 1 308 71 Z', fill: url('sweep')}, sweep);
 make('line', {x1: 200, y1: 200, x2: 308, y2: 71, class: 'ln-c2', 'stroke-opacity': .5, 'stroke-width': .8}, sweep);

 const L4 = layer(.12);
 const seg = make('g', {}, L4);
 make('circle', {cx: 200, cy: 200, r: 156, fill: 'none', class: 'ln-c1', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-dasharray': '140 22 46 30 10 30 210 40 26 30 120 276.2'}, seg);
 make('circle', {cx: 200, cy: 44, r: 3.4, class: 'ln-f2'}, seg);
 make('circle', {cx: 356, cy: 200, r: 2.4, class: 'ln-f2', 'fill-opacity': .8}, seg);

 const L5 = layer(.2);
 const arcA = make('circle', {cx: 200, cy: 200, r: 142, fill: 'none', class: 'ln-c2', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-dasharray': '64 828.2'}, L5);
 const arcB = make('circle', {cx: 200, cy: 200, r: 142, fill: 'none', class: 'ln-c3', 'stroke-width': 1.2, 'stroke-linecap': 'round', 'stroke-dasharray': '28 864.2'}, L5);
 make('circle', {cx: 200, cy: 200, r: 142, fill: 'none', class: 'ln-c1', 'stroke-opacity': .16, 'stroke-width': 1}, L5);

 const L6 = layer(.3, true);
 const dots = make('g', {}, L6);
 make('circle', {cx: 200, cy: 200, r: 128, fill: 'none', class: 'ln-c1', 'stroke-opacity': .55, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-dasharray': '0.01 8.03'}, dots);

 const L7 = layer(.35);
 make('path', {d: 'M52 200 a148 34 0 1 1 296 0', fill: 'none', class: 'ln-c3', 'stroke-opacity': .35, 'stroke-width': 1, transform: 'rotate(32 200 200)'}, L7);
 make('path', {d: 'M30 200 a170 44 0 1 1 340 0', fill: 'none', class: 'ln-c1', 'stroke-opacity': .32, 'stroke-width': 1.2, transform: 'rotate(-24 200 200)'}, L7);

 // The core and its eye.
 const L8 = layer(.4);
 const core = make('g', {}, L8);
 make('circle', {cx: 200, cy: 200, r: 90, fill: url('core')}, core);
 const inner = make('g', {'clip-path': url('clip')}, core);
 make('ellipse', {cx: 200, cy: 200, rx: 88, ry: 24, fill: 'none', stroke: '#FFFFFF', 'stroke-opacity': .14, 'stroke-width': .8}, inner);
 const mer1 = make('ellipse', {cx: 200, cy: 200, rx: 88, ry: 88, fill: 'none', stroke: '#FFFFFF', 'stroke-opacity': .16, 'stroke-width': .8}, inner);
 const mer2 = make('ellipse', {cx: 200, cy: 200, rx: 44, ry: 88, fill: 'none', stroke: '#FFFFFF', 'stroke-opacity': .1, 'stroke-width': .8}, inner);
 const sheen = make('g', {}, inner);
 make('ellipse', {cx: 200, cy: 128, rx: 34, ry: 9, fill: '#FFFFFF', 'fill-opacity': .16}, sheen);
 make('circle', {cx: 200, cy: 200, r: 90, fill: 'none', class: 'ln-c2', 'stroke-opacity': .4, 'stroke-width': 1.2}, core);
 const iris = make('g', {}, core);
 make('circle', {cx: 200, cy: 200, r: 60, fill: 'none', stroke: '#EFFFFF', 'stroke-opacity': .6, 'stroke-width': 1, 'stroke-dasharray': '2 4.3'}, iris);
 const aper = make('g', {class: 'ln-detail'}, core);
 for (let i = 0; i < 6; i++) {
   const a = i * Math.PI / 3, c = Math.cos(a), s = Math.sin(a);
   make('line', {x1: 200 + 50 * s, y1: 200 - 50 * c, x2: 200 + 32 * s, y2: 200 - 32 * c, stroke: '#EFFFFF', 'stroke-opacity': .5, 'stroke-width': 1, 'stroke-linecap': 'round'}, aper);
 }
 make('circle', {cx: 200, cy: 200, r: 46, fill: 'none', stroke: '#E6FFFF', 'stroke-opacity': .55, 'stroke-width': 1.1}, core);
 const pupil = make('circle', {cx: 200, cy: 200, r: 29, fill: url('iris')}, core);
 const spark = make('circle', {cx: 200, cy: 200, r: 6, class: 'ln-f2', 'fill-opacity': .9}, core);
 make('ellipse', {cx: 180, cy: 170, rx: 15, ry: 7.5, fill: '#FFFFFF', 'fill-opacity': .8, transform: 'rotate(-32 180 170)'}, core);

 // Front halves of both orbits, with a satellite on each.
 const L9 = layer(.5);
 const orbitA = make('g', {transform: 'rotate(-24 200 200)'}, L9);
 make('path', {d: 'M30 200 a170 44 0 0 0 340 0', fill: 'none', class: 'ln-c1', 'stroke-opacity': .85, 'stroke-width': 1.5}, orbitA);
 const satA = make('g', {}, orbitA); make('circle', {r: 10, fill: url('sat')}, satA); make('circle', {r: 3.6, fill: '#FFFFFF'}, satA);
 const orbitB = make('g', {transform: 'rotate(32 200 200)'}, L9);
 make('path', {d: 'M52 200 a148 34 0 0 0 296 0', fill: 'none', class: 'ln-c3', 'stroke-opacity': .7, 'stroke-width': 1.1}, orbitB);
 const satB = make('g', {}, orbitB); make('circle', {r: 7, class: 'ln-f3', 'fill-opacity': .35}, satB); make('circle', {r: 2.8, class: 'ln-f3'}, satB);

 const L10 = layer(.6, true);
 const corner = make('text', {x: 14, y: 26, class: 'ln-text', 'font-size': 7.5, 'letter-spacing': 1.5, 'fill-opacity': .7}, L10); corner.textContent = 'CORE · 01';
 const code = make('text', {x: 386, y: 384, class: 'ln-text', 'font-size': 7.5, 'letter-spacing': 1.5, 'fill-opacity': .7, 'text-anchor': 'end'}, L10); code.textContent = 'READY';

 orb.replaceChildren(svg);
 orb.classList.add('emblem');

 // ----- Mood -----
 let mood = 'ready';
 function readMood() {
   const b = document.body;
   if (b.dataset.presence === 'needs-you') return 'waiting';
   const m = STATE_TO_MOOD[b.dataset.state] || 'ready';
   return m === 'thinking' && b.dataset.online === 'claude' ? 'online' : m;   // the link to Claude is open
 }
 function setMood() {
   const next = readMood();
   if (next === mood && orb.dataset.mood) return;
   mood = next; orb.dataset.mood = mood; code.textContent = MOODS[mood].code;
   const label = document.querySelector('#voice-state'); if (label) label.dataset.mood = mood;
   if (!orb.getAttribute('aria-label') || /^Lin(,|$)/.test(orb.getAttribute('aria-label'))) orb.setAttribute('aria-label', `Lin, ${MOODS[mood].word}`);
   wake();
 }
 new MutationObserver(setMood).observe(document.body, {attributes: true, attributeFilter: ['data-state', 'data-presence', 'data-online']});

 // Small sizes drop the fine detail that would only blur.
 new ResizeObserver(([entry]) => { orb.classList.toggle('small', entry.contentRect.width < 140); }).observe(orb);

 // ----- Motion -----
 const rot = (g, deg) => g.setAttribute('transform', `rotate(${deg.toFixed(2)} 200 200)`);
 const calm = () => document.documentElement.dataset.motion === 'calm';
 let speed = 1, phase = 0, breathT = 0, last = 0, born = null, running = false, energy = 0, mic = 0;
 const num = name => { const v = parseFloat(orb.style.getPropertyValue(name)); return Number.isFinite(v) ? v : 0; };
 function render(dt) {
   const m = MOODS[mood];
   speed += (m.speed - speed) * Math.min(1, dt * 2.2);
   phase += dt * speed; breathT += dt / m.breath;
   energy += (num('--energy') - energy) * Math.min(1, dt * 12);
   mic += (num('--mic') - mic) * Math.min(1, dt * 14);
   const voice = mood === 'listening' ? mic : energy;
   const breath = .5 + .5 * Math.sin(breathT * 2 * Math.PI);
   rot(textRing, phase / 60 * 360); rot(ticks, -phase / 40 * 360); rot(sweep, phase / 5 * 360);
   rot(seg, phase / 22 * 360); rot(dots, -phase / 40 * 360); rot(iris, -phase / 9 * 360); rot(aper, phase / 12 * 360);
   rot(sheen, phase / 16 * 360);
   arcA.setAttribute('stroke-dashoffset', (-(phase / 3.2 % 1) * 892.2).toFixed(1));
   arcB.setAttribute('stroke-dashoffset', ((phase / 4.6 % 1) * 892.2).toFixed(1));
   mer1.setAttribute('rx', (46 + 42 * Math.cos(phase / 6 * 2 * Math.PI)).toFixed(1));
   mer2.setAttribute('rx', (46 + 42 * Math.cos(phase / 6 * 2 * Math.PI + 2.1)).toFixed(1));
   halo.setAttribute('r', (182 + 14 * breath + voice * 14).toFixed(1));
   halo.setAttribute('opacity', Math.min(1, .68 + .3 * breath + voice * .35).toFixed(2));
   pupil.setAttribute('r', (27 + 3 * breath + voice * 6).toFixed(1));
   spark.setAttribute('fill-opacity', (.5 + .5 * breath).toFixed(2));
   const k = 1 + voice * .045;
   core.setAttribute('transform', `translate(200 200) scale(${k.toFixed(3)}) translate(-200 -200)`);
   satellite(satA, 170, 44, phase / 8); satellite(satB, 148, 34, phase / 13);
   // Start-up: rings assemble from the outside in, in about 1.6 seconds.
   if (born !== null) {
     const p = (performance.now() - born) / 1600;
     for (const {g, delay} of layers) {
       const q = Math.max(0, Math.min(1, (p - delay) / .4)), e = 1 - Math.pow(1 - q, 3);
       g.setAttribute('opacity', e.toFixed(3));
       g.setAttribute('transform', `translate(200 200) scale(${(.86 + .14 * e).toFixed(3)}) translate(-200 -200)`);
     }
     if (p > 1.05) { born = null; for (const {g} of layers) { g.removeAttribute('opacity'); g.removeAttribute('transform'); } }
   }
 }
 function satellite(g, a, b, u) {
   const t = u * 2 * Math.PI, s = Math.sin(t);
   g.setAttribute('transform', `translate(${(200 + a * Math.cos(t)).toFixed(1)} ${(200 + b * s).toFixed(1)})`);
   const front = Math.max(0, Math.min(1, (s + .15) / .3));
   g.setAttribute('opacity', (.25 + .75 * front).toFixed(2));
 }
 function frame(t) {
   const dt = last ? Math.min(.1, (t - last) / 1000) : 0; last = t;
   if (calm() || !orb.isConnected) { running = false; last = 0; still(); return; }
   if (orb.offsetParent !== null) render(dt);
   requestAnimationFrame(frame);
 }
 // Calm motion: one still frame per mood, no breathing or turning.
 function still() { born = null; for (const {g} of layers) { g.removeAttribute('opacity'); g.removeAttribute('transform'); } render(0); }
 function wake() { if (!running && !calm()) { running = true; last = 0; requestAnimationFrame(frame); } else if (calm()) still(); }
 document.addEventListener('lin:theme', wake);
 if (!calm() && document.documentElement.dataset.reopened !== '1') born = performance.now();
 setMood(); wake();
 window.linEmblem = {mood: () => mood, assembling: () => born !== null};
})();
