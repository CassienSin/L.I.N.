const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'voice/runtime'),statePath=path.join(runtime,'today-test-state.json');
const session=JSON.parse(fs.readFileSync(path.join(runtime,'session.json'),'utf8')),url=new URL(session.url),base=url.origin;
const headers={'X-Lin-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
let browser,state,keep=false;const checks=[],delay=ms=>new Promise(r=>setTimeout(r,ms));
async function raw(route,body){return fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});}
async function api(route,body){const r=await raw(route,body),d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
async function idle(){for(let i=0;i<150;i++){const s=await api('/api/status');if(s.ready&&!s.busy)return;await delay(500);}throw Error('Voice not ready');}
async function cleanup(){if(!state)return;await idle();const today=await api('/api/today');if(today.source?.name===state.filename)await api('/api/calendar/forget',{revision:today.calendar_revision});const planner=await api('/api/planner');const task=planner.tasks.find(t=>t.title===state.tag);if(task)await api('/api/planner/remove',{id:task.id,revision:planner.revision});}
(async()=>{
 try{
  if(process.argv[2]==='resume'){
   state=JSON.parse(fs.readFileSync(statePath,'utf8'));assert.notEqual(session.pid,state.pid);
   const current=await api('/api/today');assert.equal(current.source.name,state.filename);assert.deepEqual(current.events.map(e=>({...e,status:undefined})),state.events.map(e=>({...e,status:undefined})));
   checks.push('Actual restart preserves the imported calendar, source metadata and occurrences');
   await cleanup();state=null;assert.equal((await api('/api/today')).source,null);
   const output={passed:true,checks:[...JSON.parse(fs.readFileSync(statePath,'utf8')).checks,...checks,'Temporary calendar and task removed after verification']};fs.writeFileSync(path.join(root,'voice/brain-benchmark/today-results.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output));return;
  }
  assert.equal((await fetch(base+'/api/today')).status,401);
  assert.equal((await fetch(base+'/api/calendar/preview',{method:'POST',body:'test',headers:{'Content-Type':'text/calendar'}})).status,401);
  let today=await api('/api/today');assert.equal(today.source,null,'Existing calendar is left untouched; test requires no imported calendar');
  const tag='TodayCheck'+crypto.randomBytes(3).toString('hex');state={tag,filename:tag+'.ics',pid:session.pid};
  let planner=await api('/api/planner');await api('/api/planner/save',{revision:planner.revision,title:tag,scope:'business',priority:1,minutes:20});
  const stamp=today.date.replaceAll('-',''),end=new Date(today.date+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);const endStamp=end.toISOString().slice(0,10).replaceAll('-','');
  const source=Buffer.from(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Lin verification//EN\r\nBEGIN:VEVENT\r\nUID:${tag}-meeting\r\nDTSTART;TZID=Asia/Manila:${stamp}T100000\r\nDTEND;TZID=Asia/Manila:${stamp}T103000\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Verification planning meeting\r\nLOCATION:Local test room\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:${tag}-day\r\nDTSTART;VALUE=DATE:${stamp}\r\nDTEND;VALUE=DATE:${endStamp}\r\nSUMMARY:Verification all-day event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1050},reducedMotion:'reduce'});const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:'))external.push(r.url());});
  await page.goto(session.url);await page.locator('#view-today').click();await page.waitForFunction(()=>document.querySelector('#today-summary').textContent.includes('No calendar'));
  assert.match(await page.locator('#today-task-count').textContent(),/1 high priority/);
  await page.locator('#calendar-file').setInputFiles({name:state.filename,mimeType:'text/calendar',buffer:source});await page.locator('#preview-calendar').click();await page.locator('#calendar-preview').waitFor({state:'visible'});
  assert.equal(await page.locator('#preview-events .agenda-item').count(),4);assert.equal((await api('/api/today')).source,null);
  await page.locator('#cancel-calendar').click();await page.locator('#calendar-preview').waitFor({state:'hidden'});assert.equal((await api('/api/today')).source,null);
  await page.locator('#preview-calendar').click();await page.locator('#calendar-preview').waitFor({state:'visible'});await page.locator('#save-calendar').click();
  await page.waitForFunction(()=>document.querySelectorAll('#today-events .agenda-item').length===2);
  assert.match(await page.locator('#today-events').textContent(),/10:00/);assert.match(await page.locator('#today-warning').textContent(),/not a live calendar/);
  checks.push('Authenticated preview, recurring occurrences, discard without saving, explicit save and correct Manila agenda');
  today=await api('/api/today');assert.ok(today.open_tasks>=1);assert.match(today.summary,/Inbox is not connected/);assert.match(today.summary,/not been fitted/);
  await page.locator('#calendar-file').setInputFiles({name:'broken.ics',mimeType:'text/calendar',buffer:Buffer.from('invalid calendar')});await page.locator('#preview-calendar').click();
  await page.waitForFunction(()=>document.querySelector('#calendar-status').textContent.includes('not a readable'));
  assert.equal((await api('/api/today')).calendar_revision,today.calendar_revision);
  assert.equal((await raw('/api/calendar/forget',{revision:today.calendar_revision-1})).status,409);
  assert.equal((await raw('/api/today/speak',{revision:'stale'})).status,409);
  checks.push('Invalid imports preserve saved data; stale removal and stale briefing requests are rejected');
  await page.screenshot({path:path.join(root,'design/today-desktop.png'),fullPage:true});
  for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.screenshot({path:path.join(root,'design/today-mobile.png'),fullPage:true});
  await page.waitForFunction(()=>!document.querySelector('#hear-today').disabled,null,{timeout:60000});await page.locator('#hear-today').click();
  await page.waitForFunction(()=>document.body.dataset.state==='speaking',null,{timeout:60000});await page.waitForFunction(()=>document.querySelector('#audio').currentTime>.2);
  assert.match(await page.locator('#request-echo').textContent(),/briefing/);assert.match(await page.locator('#sentences').textContent(),/2 events today/);
  await page.locator('#view-today').click();assert.equal(await page.locator('#audio').evaluate(n=>n.paused),false);await page.locator('#interrupt-anywhere').click();await idle();
  await page.locator('#forget-calendar').click();await page.waitForFunction(()=>document.querySelector('#today-event-count').textContent==='NO IMPORT');
  await page.waitForFunction(()=>document.querySelector('#replay').disabled);assert.equal(await page.locator('#today-events .agenda-item').count(),0);
  checks.push('Actual local spoken briefing and highlights; global interruption; removing the snapshot clears stale cards and replay');
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('lin:view',{detail:'chat'})));await page.waitForFunction(()=>!document.querySelector('#ask').disabled,null,{timeout:60000});let asked=false;page.on('request',r=>{if(r.url().endsWith('/api/ask'))asked=true;});await page.locator('#request-input').fill('Brief me');await page.locator('#ask').click();assert.equal(await page.locator('#today-workspace').isVisible(),true);assert.equal(asked,false);
  await page.locator('#calendar-file').setInputFiles({name:state.filename,mimeType:'text/calendar',buffer:source});await page.locator('#preview-calendar').click();await page.locator('#calendar-preview').waitFor({state:'visible'});await page.locator('#save-calendar').click();await page.waitForFunction(()=>document.querySelectorAll('#today-events .agenda-item').length===2);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);checks.push('Brief me phrase trigger, 390/320 layouts, no page errors or external requests');
  state.events=(await api('/api/today')).events;state.checks=checks;fs.writeFileSync(statePath,JSON.stringify(state,null,2));keep=true;console.log(JSON.stringify({phase:'ready for restart',checks}));
 }finally{if(browser)await browser.close();if(state&&!keep)await cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1});
