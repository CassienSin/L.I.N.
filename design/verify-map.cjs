const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),session=JSON.parse(fs.readFileSync(path.join(root,'voice/runtime/session.json'),'utf8'));
const url=new URL(session.url),base=url.origin,token=new URLSearchParams(url.hash.slice(1)).get('token');
const headers={'X-Lin-Token':token,'Content-Type':'application/json'},tag='MapCheck'+crypto.randomBytes(4).toString('hex');
const file=path.join(root,'Lin Brain',tag+'.md');let memory,browser,disconnected=false;
async function api(route,body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
const checks=[];
(async()=>{
 try{
  assert.equal((await fetch(base+'/api/brain/graph')).status,401);
  assert.equal((await api('/api/status')).brain.connected,true,'Test requires connected folder');
  fs.writeFileSync(file,Array.from({length:28},(_,i)=>`${tag} line ${i+1}: test passage.`).join('\n'),{flag:'wx'});
  memory=await api('/api/memories/save',{title:tag+' preference',fact:'The test color is jade.','scope':'personal'});memory=memory.memory||memory;
  await api('/api/brain/refresh',{});
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:'))external.push(r.url());});
  await page.goto(session.url);await page.locator('#view-map').click();
  await page.locator(`.map-node[data-id="${memory.id}"]`).waitFor();
  await page.locator('.map-list-panel summary').click();
  const memoryButton=page.locator(`#map-list button[data-id="${memory.id}"]`);
  await memoryButton.click();await page.waitForFunction(()=>document.querySelector('#map-content').textContent.includes('jade'));
  checks.push('Authenticated local graph and exact saved fact inspection');
  await page.locator('#map-search').fill(tag);assert.equal(await page.locator('.map-node').count(),2);
  await page.locator('#map-filter').selectOption('notes');assert.equal(await page.locator('.map-node').count(),1);
  await page.locator('.map-node').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#map-content').textContent.includes('line 1:'));
  await page.locator('#map-passage').selectOption({index:1});await page.waitForFunction(()=>document.querySelector('#map-content').textContent.includes('line 13:'));
  checks.push('Title and scope filters, keyboard selection, exact multi-passage inspection');
  const before=await page.locator('#map-camera').getAttribute('transform');await page.locator('#map-in').click();assert.notEqual(await page.locator('#map-camera').getAttribute('transform'),before);
  await page.locator('#brain-map').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('0');assert.equal(await page.locator('#map-camera').getAttribute('transform'),before);
  const box=await page.locator('#brain-map').boundingBox();await page.mouse.move(box.x+30,box.y+150);await page.mouse.down();await page.mouse.move(box.x+90,box.y+190);await page.mouse.up();assert.notEqual(await page.locator('#map-camera').getAttribute('transform'),before);await page.locator('#map-fit').click();
  checks.push('Pan, zoom, fit and keyboard navigation');
  await api('/api/brain/connect',{connected:false});disconnected=true;
  await page.waitForFunction(()=>!document.querySelector('.map-node'),null,{timeout:15000});
  assert.equal(await page.locator('#map-content').textContent(),'');
  await api('/api/brain/connect',{connected:true});disconnected=false;
  await page.locator('.map-node').waitFor();await page.locator('.map-node').click();
  checks.push('Disconnection removes note nodes and clears selected source; reconnect restores them');
  fs.writeFileSync(file,tag+' updated exact text.');
  await page.waitForFunction(()=>document.querySelector('#map-content').textContent.includes('updated exact text'),null,{timeout:15000});
  assert.equal(await page.locator('#map-passage').isVisible(),false);
  fs.unlinkSync(file);await page.waitForFunction(()=>!document.querySelector('.map-node'),null,{timeout:15000});assert.equal(await page.locator('#map-content').textContent(),'');
  checks.push('Selected note updates live and deleted source clears');
  await page.locator('#map-filter').selectOption('all');await memoryButton.click();
  memory=await api('/api/memories/save',{...memory,fact:'The test color is coral.',scope:'business'});memory=memory.memory||memory;
  await page.waitForFunction(()=>document.querySelector('#map-content').textContent.includes('coral'),null,{timeout:15000});assert.match(await page.locator('#map-meta').textContent(),/Business/);
  await page.locator('#map-search').fill('');await page.locator('.map-list-panel summary').click();
  await page.screenshot({path:path.join(root,'design/brain-map-desktop.png'),fullPage:true});
  for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');}
  await page.screenshot({path:path.join(root,'design/brain-map-mobile.png'),fullPage:true});
  await api('/api/memories/forget',{id:memory.id,revision:memory.revision});memory=null;
  await page.waitForFunction(()=>document.querySelector('#map-content').textContent==='',null,{timeout:15000});
  checks.push('Live memory correction, scope change and forgetting; responsive 390/320 layouts');
  await page.locator('#view-chat').click();assert.equal(await page.locator('#chat-workspace').isVisible(),true);assert.equal(await page.locator('#map-workspace').isVisible(),false);
  await page.locator('#voice-preview summary').click();await page.waitForFunction(()=>!document.querySelector('#demo').disabled,null,{timeout:60000});
  await page.locator('#demo').click();await page.waitForFunction(()=>document.body.dataset.state==='speaking');
  await page.locator('#view-map').click();await page.waitForFunction(()=>document.querySelector('#audio').currentTime>.4);
  assert.equal(await page.locator('#audio').evaluate(n=>n.paused),false);await page.locator('#interrupt-anywhere').click();
  await page.waitForFunction(()=>document.querySelector('#audio').paused);
  checks.push('Voice continues across workspace switches and global interruption works from the map');
  await page.locator('#view-brain').click();assert.equal(await page.locator('#brain-workspace').isVisible(),true);assert.equal(await page.locator('#chat-workspace').isVisible(),false);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);checks.push('Workspace navigation, reduced-motion mode, no JavaScript errors or external requests');
  fs.writeFileSync(path.join(root,'voice/brain-benchmark/map-results.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks}));
 }finally{
  if(browser)await browser.close();if(memory)await api('/api/memories/forget',{id:memory.id,revision:memory.revision});
  if(disconnected)await api('/api/brain/connect',{connected:true});
  if(fs.existsSync(file))fs.unlinkSync(file);await api('/api/brain/refresh',{});
 }
})().catch(e=>{console.error(e);process.exit(1)});
