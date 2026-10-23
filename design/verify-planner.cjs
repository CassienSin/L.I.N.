const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'voice/runtime'),statePath=path.join(runtime,'planner-test-state.json');
const session=JSON.parse(fs.readFileSync(path.join(runtime,'session.json'),'utf8')),url=new URL(session.url),base=url.origin;
const headers={'X-Lin-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
const delay=ms=>new Promise(r=>setTimeout(r,ms)),checks=[];let browser,state,keep=false;
async function raw(route,body){return fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});}
async function api(route,body){const r=await raw(route,body),d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
async function idle(){for(let i=0;i<120;i++){const s=await api('/api/status');if(s.ready&&!s.busy)return;await delay(500);}throw Error('Voice not ready');}
async function mutate(action,body){const s=await api('/api/planner');return api('/api/planner/'+action,{...body,revision:s.revision});}
async function cleanup(){if(!state)return;await idle();const s=await api('/api/planner');for(const t of s.tasks.filter(t=>t.title.startsWith(state.tag)))await mutate('remove',{id:t.id});await mutate('plan',state.preferences);}
(async()=>{
 try{
  if(process.argv[2]==='resume'){
   state=JSON.parse(fs.readFileSync(statePath,'utf8'));assert.notEqual(session.pid,state.pid);
   const s=await api('/api/planner');assert.deepEqual(s.tasks.filter(t=>t.title.startsWith(state.tag)),state.tasks);assert.equal(s.plan.used,60);
   assert.deepEqual(s.preferences,{...state.preferencesAfter});
   checks.push('Actual service restart preserves tasks, edits, reopened state, plan preferences and exact plan');
   await cleanup();state=null;const after=await api('/api/planner');assert.equal(after.tasks.length,0);
   const output={passed:true,checks:[...JSON.parse(fs.readFileSync(statePath,'utf8')).checks,...checks,'Temporary tasks removed and previous preferences restored']};
   fs.writeFileSync(path.join(root,'voice/brain-benchmark/planner-results.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output));return;
  }
  assert.equal((await fetch(base+'/api/planner')).status,401);
  const initial=await api('/api/planner');assert.equal(initial.tasks.length,0,'Browser fixture requires an empty task list; existing tasks are left untouched');
  state={tag:'Test'+crypto.randomBytes(3).toString('hex'),pid:session.pid,preferences:initial.preferences};
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:'))external.push(r.url());});
  await page.goto(session.url);await page.locator('#view-planner').click();await page.waitForFunction(()=>!document.querySelector('#save-task').disabled);
  let count=0;
  for(const [title,scope,minutes,priority] of [['Client proposal','business',35,1],['Long workshop','business',70,1],['Review notes','personal',15,2],['Clear desk','personal',10,3]]){
   await page.locator('#task-title').fill(state.tag+' · '+title);await page.locator('#task-scope').selectOption(scope);await page.locator('#task-minutes').fill(String(minutes));await page.locator('#task-priority').selectOption(String(priority));await page.locator('#save-task').click();count++;
   await page.waitForFunction(n=>document.querySelectorAll('#task-list .task-item').length===n,count);
  }
  let s=await api('/api/planner');const proposal=s.tasks.find(t=>t.title.endsWith('Client proposal')),review=s.tasks.find(t=>t.title.endsWith('Review notes'));
  assert.equal(s.plan.used,55);assert.equal(s.plan.free,5);assert.equal(s.plan.steps.length,2);assert.equal(s.plan.deferred.length,2);
  assert.match(await page.locator('#plan-total').textContent(),/55 \/ 60/);assert.match(await page.locator('#plan-steps').textContent(),/40–55/);
  checks.push('Authenticated explicit task entry; priority order, exact time and break accounting; oversized tasks remain visible');
  const stale=s.revision;await mutate('save',{...review,minutes:20});
  assert.equal((await raw('/api/planner/remove',{id:proposal.id,revision:stale})).status,409);
  assert.equal((await raw('/api/planner/speak',{revision:stale})).status,409);
  await page.waitForFunction(()=>document.querySelector('#plan-total').textContent==='60 / 60 MIN');
  const card=page.locator(`.task-item[data-id="${proposal.id}"]`);
  await card.locator('[data-action="done"]').click();await page.waitForFunction(()=>document.querySelector('#plan-total').textContent==='35 / 60 MIN');
  await card.locator('[data-action="done"]').click();await page.waitForFunction(()=>document.querySelector('#plan-total').textContent==='60 / 60 MIN');
  checks.push('Corrections update the plan; done/reopen; stale writes and stale speech are rejected');
  await page.locator('#plan-scope').selectOption('business');assert.equal(await page.locator('#read-plan').isDisabled(),true);await page.locator('#build-plan').click();await page.waitForFunction(()=>document.querySelector('#plan-total').textContent==='35 / 60 MIN');
  await page.locator('#plan-scope').selectOption('all');await page.locator('#build-plan').click();await page.waitForFunction(()=>document.querySelector('#plan-total').textContent==='60 / 60 MIN');
  await page.screenshot({path:path.join(root,'design/planner-desktop.png'),fullPage:true});
  for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.screenshot({path:path.join(root,'design/planner-mobile.png'),fullPage:true});
  checks.push('Scope selection, unsaved settings prevent speech, responsive 390/320 layouts');
  await page.waitForFunction(()=>!document.querySelector('#read-plan').disabled,null,{timeout:60000});await page.locator('#read-plan').click();
  await page.waitForFunction(()=>document.body.dataset.state==='speaking',null,{timeout:60000});await page.waitForFunction(()=>document.querySelector('#audio').currentTime>.2);
  assert.match(await page.locator('#sentences').textContent(),/uses 60 of 60 minutes/);assert.match(await page.locator('#request-echo').textContent(),/focus plan/);
  await page.locator('#view-planner').click();assert.equal(await page.locator('#audio').evaluate(n=>n.paused),false);
  await page.locator('#interrupt-anywhere').click();await idle();
  await card.locator('[data-action="done"]').click();await page.waitForFunction(()=>document.querySelector('#replay').disabled);
  await card.locator('[data-action="done"]').click();await page.waitForFunction(()=>document.querySelector('#plan-total').textContent==='60 / 60 MIN');
  checks.push('Real spoken summary with playback highlights; voice continues in planner; changing tasks clears stale replay');
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('lin:view',{detail:'chat'})));await page.waitForFunction(()=>!document.querySelector('#ask').disabled,null,{timeout:60000});
  let asked=false;page.on('request',r=>{if(r.url().endsWith('/api/ask'))asked=true;});await page.locator('#request-input').fill('Plan my day');await page.locator('#ask').click();
  assert.equal(await page.locator('#planner-workspace').isVisible(),true);assert.equal(asked,false);
  checks.push('Exact Plan my day request opens the saved planner without an invented model answer');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);checks.push('No page errors or external requests');
  s=await api('/api/planner');state.tasks=s.tasks;state.preferencesAfter=s.preferences;state.checks=checks;
  fs.writeFileSync(statePath,JSON.stringify(state,null,2));keep=true;console.log(JSON.stringify({phase:'ready for restart',checks}));
 }finally{if(browser)await browser.close();if(state&&!keep)await cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1});
