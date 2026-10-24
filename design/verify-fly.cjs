// Browser check for fly-to-source on the demo data: answers from notes move the map to their sources.
// Usage: node design/verify-fly.cjs   (Lin must be running with demo data)
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LIN_PLAYWRIGHT||'C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.env.LIN_ROOT||path.join(__dirname,'..')),runtime=path.join(root,'voice/runtime');
const session=JSON.parse(fs.readFileSync(path.join(runtime,'session.json'),'utf8')),url=new URL(session.url),base=url.origin;
const headers={'X-Lin-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
const checks=[],delay=ms=>new Promise(r=>setTimeout(r,ms)),started=Date.now();
const step=m=>console.error(`[${((Date.now()-started)/1000).toFixed(1)}s] ${m}`),pass=m=>{step('passed: '+m);checks.push(m);};
setTimeout(()=>{step('Timed out after 10 minutes');process.exit(2);},10*60*1000).unref();
async function api(route){const r=await fetch(base+route,{headers});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
async function idle(){for(let i=0;i<480;i++){const s=await api('/api/status');if(s.ready&&!s.busy&&s.reasoning.ready&&!s.reasoning.busy)return;await delay(500);}throw Error('Lin did not become idle');}
let browser;
(async()=>{
 try{
  browser=await chromium.launch(process.env.LIN_CHANNEL==='none'?{headless:true}:{channel:process.env.LIN_CHANNEL||'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];await page.addInitScript(()=>{try{localStorage.setItem('lin-greet-voice','off')}catch{}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(session.url);await idle();
  await page.waitForFunction(()=>window.linMap&&window.linMap.stats().nodes>10,null,{timeout:60000});
  await page.locator('#view-map').click();await page.waitForFunction(()=>document.body.dataset.view==='map');  // fly-to-source happens on the Map
  const graph=await api('/api/graph');
  async function ask(text,mode){step('asking: '+text);await idle();await page.waitForFunction(()=>!document.querySelector('#ask').disabled,null,{timeout:120000});
    await page.locator('#request-mode').selectOption(mode);await page.locator('#request-input').fill(text);await page.locator('#ask').click();}

  // 1. Search my brain: the camera flies to the top source note, which is focused and glowing.
  const camBefore=(await page.evaluate(()=>window.linMap.stats())).camera;
  await ask('panel feedback','brain');
  await page.waitForFunction(()=>window.linMap.stats().sources.length>0,null,{timeout:180000});
  await page.waitForFunction(()=>!window.linMap.stats().flying,null,{timeout:10000});
  const s=await page.evaluate(()=>window.linMap.stats());
  const top=graph.nodes.find(n=>n.id===s.focus);assert.ok(top&&['note','memory'].includes(top.kind),JSON.stringify(s));
  assert.ok(s.sources.includes(s.focus));assert.notDeepEqual(s.camera,camBefore);
  const pos=await page.evaluate(id=>window.linMap.screen(id),s.focus);
  const box=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));assert.ok(pos.x>box.w*.2&&pos.x<box.w*.8&&pos.y>60&&pos.y<box.h*.8,JSON.stringify(pos));
  assert.equal(await page.locator('#focus-title').textContent(),top.title);
  assert.match(await page.locator('#map-status').textContent(),/Lin answered from/);
  await page.screenshot({path:path.join(root,'design/fly-to-source.png')});
  pass(`“Search my brain: panel feedback” flies the map to “${top.title}”, opens it in the inspector and lights its neighbours`);

  // 2. Four or more sources light the whole cluster instead of flying to one.
  const ids=graph.nodes.filter(n=>n.kind==='note'&&n.passages&&n.passages.length).slice(0,5).map(n=>n.passages[0].id);
  await page.evaluate(list=>window.linMap.showSources(list),ids);
  await page.waitForFunction(()=>!window.linMap.stats().flying,null,{timeout:10000});
  const c=await page.evaluate(()=>window.linMap.stats());assert.equal(c.sources.length,5);assert.equal(c.focus,null);
  for(const id of c.sources){const p=await page.evaluate(x=>window.linMap.screen(x),id);assert.ok(p.x>0&&p.x<box.w&&p.y>0&&p.y<box.h,`${id} off screen`);}
  assert.match(await page.locator('#map-status').textContent(),/5 sources/);
  pass('An answer that drew on 5 sources frames and lights the whole cluster, with every source on screen');

  // 2b. Neighbourhoods: zoomed out, the map names its groups instead of every item; a click opens one.
  const hoods=await page.evaluate(()=>window.linMap.clusters());assert.ok(hoods.length>=3&&hoods.some(h=>h.name==='Capstone'),JSON.stringify(hoods));
  await page.evaluate(()=>{document.dispatchEvent(new CustomEvent('lin:response-cleared'));window.linMap.fit();window.linMap.zoomTo(.4);});
  await page.waitForFunction(()=>window.linMap.overview()&&window.linMap.clusterBoxes().length>=3,null,{timeout:10000});
  await page.screenshot({path:path.join(root,'design/map-neighbourhoods.png')});
  const open=await page.evaluate(()=>window.linMap.clusterBoxes().filter(b=>document.elementFromPoint(b.x,b.y)?.id==='map-canvas'));
  assert.ok(open.length,'a neighbourhood name is clickable');const pick=open.find(b=>b.name==='Capstone')||open[0];
  const kBefore=(await page.evaluate(()=>window.linMap.stats())).camera.k;
  await page.mouse.click(pick.x,pick.y);
  await page.waitForFunction(()=>!window.linMap.stats().flying,null,{timeout:10000});
  assert.match(await page.locator('#map-status').textContent(),new RegExp(pick.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' · \\d+ items'));
  assert.ok((await page.evaluate(()=>window.linMap.stats())).camera.k>kBefore,'opening a neighbourhood zooms in');
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('lin:response-cleared')));
  await page.locator('#map-search').fill('Journal');await page.locator('#map-search').press('Enter');
  await page.waitForFunction(()=>/Journal/.test(document.querySelector('#map-status').textContent),null,{timeout:10000});
  await page.locator('#map-search').fill('');
  assert.ok(await page.locator('#cluster-list button').count()>=3);
  pass(`Zoomed out, the map names ${hoods.length} neighbourhoods (${hoods.slice(0,4).map(h=>h.name).join(', ')}…); clicking “${pick.name}” opens it; searching a group name finds it`);

  // 3. Small talk leaves the map alone.
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('lin:response-cleared')));
  await page.waitForFunction(()=>!window.linMap.stats().flying,null,{timeout:10000});
  const still=(await page.evaluate(()=>window.linMap.stats())).camera;
  await ask('How are you today?','chat');
  await page.waitForFunction(()=>['speaking','complete'].includes(document.body.dataset.state),null,{timeout:240000});
  const after=await page.evaluate(()=>window.linMap.stats());assert.deepEqual(after.sources,[]);assert.deepEqual(after.camera,still);
  assert.deepEqual(errors,[]);
  pass('Small talk does not move the map; no page errors');
  const output={passed:true,checks,date:new Date().toISOString()};
  fs.writeFileSync(path.join(root,'voice/brain-benchmark/fly-results.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
 }finally{if(browser)await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
