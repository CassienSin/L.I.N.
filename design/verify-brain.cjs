const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),stage=process.argv[2]||'prepare';
const session=JSON.parse(fs.readFileSync(path.join(root,'voice/runtime/session.json'),'utf8'));
const url=new URL(session.url),base=url.origin,token=new URLSearchParams(url.hash.slice(1)).get('token');
const headers={'X-Lin-Token':token,'Content-Type':'application/json'},pause=ms=>new Promise(r=>setTimeout(r,ms));
const stateFile=path.join(root,'voice/runtime/brain-test-state.json');
let fixture=stage==='resume'?JSON.parse(fs.readFileSync(stateFile,'utf8')):{tag:'LinTest'+crypto.randomBytes(4).toString('hex'),checks:[]};
const checks=fixture.checks;
async function api(route,body){return fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});}
async function idle(){for(let i=0;i<180;i++){const s=await(await api('/api/status')).json();if(s.error||s.reasoning?.error)throw Error(s.error||s.reasoning.error);if(s.ready&&s.reasoning?.ready&&!s.busy)return;await pause(500);}throw Error('Lin not ready');}
async function refresh(page){await idle();await page.locator('#view-brain').click();await page.locator('#refresh-brain').click();await page.waitForFunction(()=>document.querySelector('#memory-status').textContent==='Notes refreshed from disk.');}
async function ask(page,text,mode='chat'){
 await idle();await page.locator('#view-chat').click();await page.waitForFunction(()=>!document.querySelector('#ask').disabled);
 await page.locator('#request-mode').selectOption(mode);await page.locator('#request-input').fill(text);await page.locator('#ask').click();
 await page.waitForFunction(()=>document.querySelectorAll('#sentences li').length>0,null,{timeout:60000});
 return (await page.locator('#sentences li').allTextContents()).join(' ');
}
async function stop(page){if(!await page.locator('#interrupt-anywhere').isDisabled())await page.locator('#interrupt-anywhere').click();await idle();await page.waitForTimeout(1700);}
(async()=>{
 await idle();const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[],outside=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base+'/')&&!r.url().startsWith('blob:'))outside.push(r.url());});
 await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#ask').disabled,null,{timeout:60000});
 if(stage==='prepare'){
  assert.equal((await fetch(base+'/api/memories/save',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await api('/api/brain/open-folder',{path:'C:/'})).status,400);
  assert.equal((await api('/api/memories/save',{title:'bad',fact:'bad',scope:'unknown'})).status,400);
  const before=(await(await api('/api/brain')).json()).memories.length;
  await ask(page,`Remember this: The ${fixture.tag} project color is cobalt.`);
  await page.locator('#brain-workspace').waitFor({state:'visible'});
  assert.match(await page.locator('#memory-fact').inputValue(),/cobalt/);
  assert.equal((await(await api('/api/brain')).json()).memories.length,before);
  await stop(page);
  await page.locator('#memory-title').fill(fixture.tag+' project color');await page.locator('#memory-scope').selectOption('business');await page.locator('#save-memory').click();
  await page.waitForFunction(()=>document.querySelector('#memory-status').textContent.startsWith('Saved on this computer.'));
  const record=(await(await api('/api/brain')).json()).memories.find(m=>m.title===fixture.tag+' project color');assert.ok(record);fixture.memoryId=record.id;
  fs.writeFileSync(stateFile,JSON.stringify(fixture));
  checks.push('Remember this prepares a review; only Save persists; authentication and fixed folder action validated');
  const first=await ask(page,`What is the ${fixture.tag} project color?`);assert.match(first,/cobalt/i);
  await page.waitForFunction(()=>document.body.dataset.state==='speaking',null,{timeout:30000});await stop(page);
  await page.locator('#view-brain').click();const item=page.locator(`[data-id="${fixture.memoryId}"]`);
  await item.locator('[data-action=edit]').click();await page.locator('#memory-fact').fill(`The ${fixture.tag} project color is amber.`);await page.locator('#save-memory').click();
  await page.waitForFunction(()=>document.querySelector('#memory-status').textContent.startsWith('Saved on this computer.'));
  await item.locator('[data-action=history]').click();await page.locator('#source-dialog').waitFor({state:'visible'});assert.match(await page.locator('#source-content').textContent(),/cobalt/);await page.locator('#close-source').click();
  checks.push('Local model uses saved fact with voice; correction keeps history and invalidates recent context');
  fixture.file=path.join(root,'Lin Brain',fixture.tag+'-contract.txt');fs.writeFileSync(fixture.file,`${fixture.tag} Saffron contract\nThe Saffron deposit is 35 percent.\nDelivery takes nine working days.\n`,{flag:'wx'});fs.writeFileSync(stateFile,JSON.stringify(fixture));
  await refresh(page);
  const answer=await ask(page,`${fixture.tag} Saffron deposit`,'brain');assert.match(answer,/35 percent/);
  await page.locator('#answer-sources button').first().click();await page.locator('#source-dialog').waitFor({state:'visible'});
  assert.match(await page.locator('#source-meta').textContent(),/lines 1–3/);assert.equal(await page.locator('#source-content pre').textContent(),fs.readFileSync(fixture.file,'utf8').trimEnd());
  await page.locator('#close-source').click();await stop(page);
  const data=await(await api('/api/brain')).json();assert.ok(data.status.files>=2);
  await page.screenshot({path:path.join(__dirname,'brain-answer-desktop.png'),fullPage:true});
  await page.locator('#view-brain').click();await page.screenshot({path:path.join(__dirname,'brain-memory-desktop.png'),fullPage:true});
  await page.locator('#connect-brain').click();await page.waitForFunction(()=>document.querySelector('#connect-brain').textContent==='Reconnect folder');
  const unavailable=await ask(page,'Saffron deposit','brain');assert.doesNotMatch(unavailable,/35 percent/);await stop(page);
  await page.locator('#view-brain').click();await page.locator('#connect-brain').click();await page.waitForFunction(()=>document.querySelector('#connect-brain').textContent==='Disconnect folder');
  fs.writeFileSync(fixture.file,`${fixture.tag} Saffron contract\nThe Saffron deposit is 45 percent.\n`);
  const changed=await ask(page,'Saffron deposit','brain');assert.match(changed,/45 percent/);assert.doesNotMatch(changed,/35 percent/);await stop(page);
  checks.push('Exact file/line evidence, disconnect without deletion, and immediate changed-file lookup');
  for(const width of [1280,780,390,320]){await page.setViewportSize({width,height:1000});await page.locator('#view-brain').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(width===390)await page.screenshot({path:path.join(__dirname,'brain-memory-mobile.png'),fullPage:true});}
  checks.push('Brain and memory interface fits desktop and small screens');
  fixture.checks=checks;fixture.pid=session.pid;fs.writeFileSync(stateFile,JSON.stringify(fixture,null,2));
  console.log(JSON.stringify({stage,passed:true,checks,next:'Restart the service, then run resume.'},null,2));
 }else{
  assert.notEqual(session.pid,fixture.pid,'Persistence must be tested across a real service restart');
  const record=(await(await api('/api/brain')).json()).memories.find(m=>m.id===fixture.memoryId);assert.equal(record.revision,2);assert.match(record.fact,/amber/);
  const answer=await ask(page,`What is the ${fixture.tag} project color?`);assert.match(answer,/amber/i);assert.doesNotMatch(answer,/cobalt/i);await stop(page);
  await page.locator('#view-brain').click();await page.locator(`[data-id="${fixture.memoryId}"] [data-action=forget]`).click();
  await page.waitForFunction(()=>document.querySelector('#memory-status').textContent.startsWith('Forgotten.'));
  assert.equal((await(await api(`/api/memories/${fixture.memoryId}/history`)).json()).history.length,0);
  assert.equal((await api('/api/sources/'+fixture.memoryId)).status,410);
  fs.unlinkSync(fixture.file);await refresh(page);
  const absent=await ask(page,fixture.tag,'brain');assert.match(absent,/could not find/i);await stop(page);
  checks.push('Actual restart recalls the corrected fact; Forget removes fact/history; deleted test file stops matching');
  const result={passed:true,checks,corrected_answer:answer};fs.writeFileSync(path.join(root,'voice/brain-benchmark/integration-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }
 assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
