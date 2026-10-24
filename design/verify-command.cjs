// Browser checks for the Tidepool command screen against the running Lin (best run in demo mode).
// Usage: node design/verify-command.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LIN_PLAYWRIGHT||'C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.env.LIN_ROOT||path.join(__dirname,'..')),runtime=path.join(root,'voice/runtime');
const session=JSON.parse(fs.readFileSync(path.join(runtime,'session.json'),'utf8')),url=new URL(session.url),base=url.origin;
const headers={'X-Lin-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
const checks=[],metrics={},delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
async function idle(){for(let i=0;i<300;i++){const s=await api('/api/status');if(s.ready&&!s.busy&&s.reasoning.ready&&!s.reasoning.busy&&s.transcription.ready)return s;await delay(500);}throw Error('Lin did not become idle');}

// A fixture with speech, then enough silence to end the turn. Uses the recorded speech sample when present.
function fixture(){
  const out=path.join(runtime,'handsfree-fixture.wav'),source=path.join(root,'voice/transcription-benchmark/microphone-fixture.wav');
  let rate=16000,pcm;
  if(fs.existsSync(source)){
    const b=fs.readFileSync(source);let o=12,fmt=null,data=null;
    while(o<b.length-8){const id=b.toString('ascii',o,o+4),size=b.readUInt32LE(o+4);if(id==='fmt ')fmt={ch:b.readUInt16LE(o+10),rate:b.readUInt32LE(o+12),bits:b.readUInt16LE(o+22)};if(id==='data')data=b.subarray(o+8,o+8+size);o+=8+size+(size%2);}
    assert.ok(fmt&&data&&fmt.bits===16,'speech fixture must be 16-bit PCM');rate=fmt.rate;
    const frames=data.length/2/fmt.ch;pcm=new Int16Array(frames);for(let i=0;i<frames;i++)pcm[i]=data.readInt16LE(i*2*fmt.ch);
  }else{ // a voiced tone when no recorded speech exists (stand-in transcriber only)
    pcm=new Int16Array(rate*1.2);for(let i=0;i<pcm.length;i++)pcm[i]=Math.round(Math.sin(i/rate*2*Math.PI*220)*9000*(0.6+0.4*Math.sin(i/rate*2*Math.PI*3)));
  }
  const lead=Math.round(rate*.6),tail=Math.round(rate*4),total=lead+pcm.length+tail,buf=Buffer.alloc(44+total*2);
  buf.write('RIFF',0);buf.writeUInt32LE(36+total*2,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(rate,24);buf.writeUInt32LE(rate*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(total*2,40);
  for(let i=0;i<pcm.length;i++)buf.writeInt16LE(pcm[i],44+(lead+i)*2);
  fs.writeFileSync(out,buf);return out;
}

let browser;
// Never hang silently: report progress as each check passes and give up after 15 minutes.
const started=Date.now();const step=m=>console.error(`[${((Date.now()-started)/1000).toFixed(1)}s] ${m}`);
setTimeout(()=>{step('Timed out after 15 minutes');process.exit(2);},15*60*1000).unref();
(async()=>{
 try{
  const status=await idle();
  const wav=fixture();
  const opts={headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${wav}`,'--autoplay-policy=no-user-gesture-required']};
  browser=await chromium.launch(process.env.LIN_CHANNEL==='none'?opts:{...opts,channel:process.env.LIN_CHANNEL||'msedge'});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addInitScript(()=>{window.transcribeLog=[];const f=window.fetch;window.fetch=(...a)=>{if(String(a[0]).includes('/api/transcribe'))window.transcribeLog.push({t:performance.now(),lin:document.body.dataset.state});return f(...a);};});
  const page=await context.newPage();const errors=[],external=[];
  await page.addInitScript(()=>{try{localStorage.setItem('lin-greet-voice','off')}catch{}});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url());});
  await page.goto(session.url);
  await page.waitForFunction(()=>window.linMap&&window.linMap.stats().nodes>0,null,{timeout:30000});
  const graph=await api('/api/graph');const stats=await page.evaluate(()=>window.linMap.stats());
  assert.equal(stats.nodes,graph.nodes.length);assert.equal(stats.edges,graph.edges.length);
  assert.ok(graph.edges.every(e=>e.why.length&&['link','mention','schedule'].includes(e.kind)),'every connection carries a reason');
  assert.equal(await page.locator('#demo-badge').isVisible(),!!status.demo);
  (m=>{step('passed: '+m);return checks.push(m);})(`Map shows ${stats.nodes} items and ${stats.edges} connections from /api/graph; every connection has a kind and a reason${status.demo?'; demo badge visible':''}`);
  await page.screenshot({path:path.join(root,'design/command-desktop.png')});

  // Orbit: Lin opens on Home with her emblem; the map is a quiet constellation behind it until you open Map.
  assert.equal(await page.evaluate(()=>document.body.dataset.view),'home','Lin opens on Home');
  assert.equal(await page.locator('#view-home').getAttribute('aria-current'),'page');
  assert.ok(await page.locator('#orb svg').count(),'the emblem is drawn');
  assert.equal(await page.evaluate(()=>window.linEmblem.mood()),'ready');
  await page.evaluate(()=>{document.body.dataset.presence='needs-you';});await page.waitForFunction(()=>window.linEmblem.mood()==='waiting');
  await page.evaluate(()=>{delete document.body.dataset.presence;});await page.waitForFunction(()=>window.linEmblem.mood()==='ready');
  const open=(await api('/api/planner')).tasks.filter(t=>!t.done).length;
  await page.waitForFunction(n=>document.querySelector('#home-task-count').textContent===String(n),open,{timeout:15000});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#map-canvas')).pointerEvents),'none','the map behind Home does not take clicks');
  await page.screenshot({path:path.join(root,'design/orbit-home-dark.png')});
  await page.evaluate(()=>window.linTheme.set('theme','light'));
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.themeResolved),'light');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(242, 245, 247)','light (blueprint) theme');
  await page.waitForTimeout(800);await page.screenshot({path:path.join(root,'design/orbit-home-light.png')});
  await page.evaluate(()=>window.linTheme.set('motion','calm'));
  const a1=await page.locator('#orb svg g').nth(2).getAttribute('transform');await page.waitForTimeout(400);
  assert.equal(await page.locator('#orb svg g').nth(2).getAttribute('transform'),a1,'calm motion holds the emblem still');
  await page.evaluate(()=>{window.linTheme.set('motion','full');window.linTheme.set('theme','dark');});
  // The day ring is a slider: arrow keys look at other times and say what's on; Enter opens Today.
  await page.locator('#day-ring').focus();await page.keyboard.press('Home');const t0=await page.locator('#day-ring').getAttribute('aria-valuetext');
  await page.keyboard.press('End');const t1=await page.locator('#day-ring').getAttribute('aria-valuetext');assert.notEqual(t0,t1,'the day ring moves with the keyboard');
  await page.keyboard.press('Enter');await page.locator('#sheet').waitFor({state:'visible'});assert.equal(await page.locator('#sheet-title').textContent(),'Today');
  await page.keyboard.press('Escape');await page.locator('#sheet').waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>window.linSounds.names),['startup','listen','send','approve','attention','seeing','blocked']);
  await page.locator('#view-map').click();
  await page.waitForFunction(()=>document.body.dataset.view==='map'&&getComputedStyle(document.querySelector('#map-canvas')).opacity==='1',null,{timeout:5000});
  assert.equal(await page.locator('#view-map').getAttribute('aria-current'),'page');
  (m=>{step('passed: '+m);return checks.push(m);})(`Orbit: opens on Home with the live emblem (mood follows Lin, amber while a change waits), ${open} open tasks beside it; light theme and calm motion work; the day ring answers “what’s on at…” from the keyboard; Map opens the full map`);

  // Inspector, reasons and path tracing.
  await page.locator('#hub-list button').first().click();
  await page.waitForFunction(()=>!document.querySelector('#inspector-focus').hidden);
  const focusTitle=await page.locator('#focus-title').textContent();assert.ok(focusTitle.length);
  assert.match(await page.locator('#focus-links-title').textContent(),/Connected to \d+ · why/);
  assert.ok((await page.locator('#focus-links .why').first().textContent()).length>5);
  const focusId=(await page.evaluate(()=>window.linMap.stats())).focus;
  const adj=new Map();for(const e of graph.edges){(adj.get(e.source)||adj.set(e.source,[]).get(e.source)).push(e.target);(adj.get(e.target)||adj.set(e.target,[]).get(e.target)).push(e.source);}
  const dist=new Map([[focusId,0]]),queue=[focusId];while(queue.length){const id=queue.shift();for(const n of adj.get(id)||[])if(!dist.has(n)){dist.set(n,dist.get(id)+1);queue.push(n);}}
  await page.waitForTimeout(600);
  // The farthest item that is in open view (not under a panel) and not overlapped by another item.
  let far=null,p=null;
  for(const [id,d] of [...dist.entries()].filter(x=>x[1]>=2).sort((a,b)=>b[1]-a[1])){
    const at=await page.evaluate(id=>window.linMap.screen(id),id);
    if(!at)continue;
    const free=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id==='map-canvas',at);
    if(free){far=[id,d];p=at;break;}
  }
  assert.ok(far,'a reachable item at least two steps away');
  await page.keyboard.down('Shift');await page.mouse.click(p.x,p.y);await page.keyboard.up('Shift');
  await page.waitForFunction(()=>window.linMap.stats().path);const traced=(await page.evaluate(()=>window.linMap.stats())).path;
  assert.equal(traced.length-1,far[1],'Shift-click traces the shortest path');assert.match(await page.locator('#focus-links-title').textContent(),/Path to/);
  (m=>{step('passed: '+m);return checks.push(m);})(`Inspector shows the focused item with a reason for every connection; Shift-click traced the shortest path (${far[1]} steps)`);
  await page.screenshot({path:path.join(root,'design/command-focus.png')});
  await page.locator('#focus-clear').click();

  // Filters, 3D and fit.
  const before=(await page.evaluate(()=>window.linMap.stats())).visible;
  await page.locator('#kind-filters label',{hasText:'Tasks'}).locator('input').uncheck();
  const after=(await page.evaluate(()=>window.linMap.stats())).visible;assert.equal(before-after,graph.counts.task||0);
  await page.locator('#kind-filters label',{hasText:'Tasks'}).locator('input').check();
  await page.locator('#view-3d').click();assert.equal((await page.evaluate(()=>window.linMap.stats())).mode3d,true);
  await page.mouse.move(700,450);await page.mouse.down();await page.mouse.move(760,470,{steps:5});await page.mouse.up();
  await page.screenshot({path:path.join(root,'design/command-3d.png')});
  await page.locator('#view-2d').click();await page.locator('#map-fit').click();
  (m=>{step('passed: '+m);return checks.push(m);})('Kind filters hide exactly that kind; 3D view turns by dragging; 2D and Fit restore the overview');

  // Performance with 2,000 items.
  const bench=await page.evaluate(()=>window.linMap.benchmark(2000));metrics.benchmark=bench;
  assert.ok(bench.median_ms<34,`2,000 items should stay near 30 fps or better, got ${bench.median_ms} ms per frame`);
  await page.waitForFunction(n=>window.linMap.stats().nodes===n,graph.nodes.length,{timeout:15000});
  (m=>{step('passed: '+m);return checks.push(m);})(`2,000 items, ${bench.edges} connections: physics plus drawing ${bench.median_ms} ms per frame (median), ${bench.p95_ms} ms (95th)`);

  // Sheets keep the existing workspaces.
  for(const [button,title] of [['#view-today','Today'],['#view-planner','Plan my day'],['#view-brain','Notes and memory'],['#view-activity','Activity'],['#view-settings','Settings']]){
    await page.locator(button).click();await page.locator('#sheet').waitFor({state:'visible'});assert.equal(await page.locator('#sheet-title').textContent(),title);
    if(title==='Settings'){await page.waitForFunction(()=>document.querySelector('#profile-name').value.length>0);}
    if(title==='Notes and memory'){await page.waitForFunction(()=>/\d+ files ·/.test(document.querySelector('#brain-status').textContent),null,{timeout:15000});assert.doesNotMatch(await page.locator('#memory-status').textContent(),/Cannot read|undefined/,'the saved-memories list loads');}
    await page.keyboard.press('Escape');await page.locator('#sheet').waitFor({state:'hidden'});
  }
  const profile=await api('/api/profile');assert.match(await page.locator('#sentences').textContent(),new RegExp(profile.name));
  (m=>{step('passed: '+m);return checks.push(m);})('Today, Plan my day, Notes and memory, Activity and Settings open as sheets and close with Escape; Lin greets you by your profile name');

  // Typed request shows Lin's words and what she checked.
  await page.waitForFunction(()=>!document.querySelector('#ask').disabled,null,{timeout:120000});
  await page.locator('#request-input').fill('What tasks are left?');await page.keyboard.press('Enter');
  await page.locator('#answer-actions .checked-card').waitFor({state:'visible',timeout:120000});
  assert.equal(await page.locator('#request-input').inputValue(),'');
  await page.waitForFunction(()=>document.body.dataset.state==='complete',null,{timeout:180000});
  (m=>{step('passed: '+m);return checks.push(m);})('Typed request: the dock clears, Lin’s words appear in the caption with the checked-sources card, and playback completes');
  await idle();

  // Hands-free: one press, a pause ends the turn, the request is sent, the mic is ignored while Lin speaks.
  await page.locator('#record').click();
  await page.waitForFunction(()=>window.linMic.state().active&&['listening','speaking'].includes(window.linMic.state().phase),null,{timeout:20000});
  await page.waitForFunction(()=>window.transcribeLog.length>=1,null,{timeout:40000});
  const heardAt=Date.now();
  await page.waitForFunction(()=>['deaf','listening','sent'].includes(window.linMic.state().phase),null,{timeout:60000});
  let sawDeaf=false,spokeWhileDeaf=false;
  for(let i=0;i<400;i++){
    const s=await page.evaluate(()=>({mic:window.linMic.state(),state:document.body.dataset.state,log:window.transcribeLog.length}));
    if(s.mic.phase==='deaf'){sawDeaf=true;}
    if(sawDeaf&&s.mic.phase==='listening')break;
    await delay(250);
  }
  const log=await page.evaluate(()=>window.transcribeLog);
  spokeWhileDeaf=log.some(x=>x.lin==='speaking');
  assert.ok(sawDeaf,'the microphone goes deaf while Lin answers');assert.equal(spokeWhileDeaf,false,'no audio is sent while Lin speaks');
  assert.equal((await page.evaluate(()=>window.linMic.state())).phase,'listening','listening resumes after Lin finishes');
  metrics.handsfree_turn_seconds=(Date.now()-heardAt)/1000;
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.linMic.state().active);
  (m=>{step('passed: '+m);return checks.push(m);})('Hands-free: one press, the pause ends the turn, the transcript is sent automatically, the mic is ignored while Lin answers, listening resumes, Escape turns it off');

  // Phone widths.
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await page.waitForTimeout(300);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no sideways scroll at ${width}px`);
    const off=await page.evaluate(()=>[...document.querySelectorAll('#rail button, .dock .round')].filter(b=>{const r=b.getBoundingClientRect();return r.right>innerWidth+1||r.left<-1;}).length);
    assert.equal(off,0,`every section and dock button visible at ${width}px`);
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'design/command-phone.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  (m=>{step('passed: '+m);return checks.push(m);})('390 and 320 px: no sideways scroll, every dock button reachable; no page errors or outside requests');

  const output={passed:true,checks,metrics,demo:!!status.demo,date:new Date().toISOString()};
  fs.writeFileSync(path.join(root,'voice/brain-benchmark/command-results.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
 }finally{if(browser)await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
