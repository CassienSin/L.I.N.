// Browser verification of Lin's action layer against the running local session.
// Usage: node design/verify-actions.cjs   (Lin must be running; uses voice/runtime/session.json)
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.LIN_PLAYWRIGHT||'C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.env.LIN_ROOT||path.join(__dirname,'..')),runtime=path.join(root,'voice/runtime');
const session=JSON.parse(fs.readFileSync(path.join(runtime,'session.json'),'utf8')),url=new URL(session.url),base=url.origin;
const headers={'X-Lin-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
const checks=[],delay=ms=>new Promise(r=>setTimeout(r,ms)),tag='ActCheck'+crypto.randomBytes(3).toString('hex');
async function raw(route,body){return fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});}
async function api(route,body){const r=await raw(route,body),d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
async function idle(){for(let i=0;i<240;i++){const s=await api('/api/status');if(s.ready&&!s.busy&&s.reasoning.ready&&!s.reasoning.busy)return;await delay(500);}throw Error('Lin did not become idle');}
const mine=async()=>(await api('/api/planner')).tasks.filter(t=>t.title.includes(tag));
async function cleanup(){
  try{await idle();}catch{}
  for(const t of await mine()){const p=await api('/api/planner');await api('/api/planner/remove',{id:t.id,revision:p.revision});}
  for(const a of (await api('/api/actions')).actions)if(a.state==='proposed'&&a.description.includes(tag))await raw('/api/actions/reject',{id:a.id});
}
let browser;
// Never hang silently: report progress as each check passes and give up after 15 minutes.
const started=Date.now();const step=m=>console.error(`[${((Date.now()-started)/1000).toFixed(1)}s] ${m}`);
setTimeout(()=>{step('Timed out after 15 minutes');process.exit(2);},15*60*1000).unref();
(async()=>{
 try{
  assert.equal((await fetch(base+'/api/actions')).status,401);
  assert.equal((await fetch(base+'/api/actions/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  browser=await chromium.launch(process.env.LIN_CHANNEL==='none'?{headless:true}:{channel:process.env.LIN_CHANNEL||'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});const errors=[],external=[];
  await page.addInitScript(()=>{try{localStorage.setItem('lin-greet-voice','off')}catch{}});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:'))external.push(r.url());});
  await page.goto(session.url);
  async function ask(text){
    step('asking: '+text);
    await idle();await page.evaluate(()=>document.dispatchEvent(new CustomEvent('lin:view',{detail:'chat'})));await page.waitForFunction(()=>!document.querySelector('#ask').disabled,null,{timeout:120000});
    await page.locator('#request-mode').selectOption('chat');await page.locator('#request-input').fill(text);await page.locator('#ask').click();
  }
  const card=page.locator('#answer-actions .action-card');

  // 1. Proposal writes nothing; editing requires a fresh approval.
  await ask(`Add a task to ${tag} proposal review for 20 minutes, high priority`);
  await card.waitFor({state:'visible',timeout:120000});
  assert.match(await card.textContent(),/Waiting for your approval/);assert.match(await card.locator('.action-description').textContent(),new RegExp(`${tag} proposal review.*20 min.*high priority`));
  assert.deepEqual(await mine(),[]);
  const first=(await api('/api/actions')).actions.find(a=>a.description.includes(tag));
  await card.locator('input[type=number]').fill('35');assert.equal(await card.locator('button.primary').textContent(),'Update details');
  await card.locator('button.primary').click();await page.waitForFunction(()=>document.querySelector('#answer-actions .action-description')?.textContent.includes('35 min'));
  assert.equal((await raw('/api/actions/approve',{id:first.id,hash:first.hash})).status,409);assert.deepEqual(await mine(),[]);
  (m=>{step('passed: '+m);return checks.push(m);})('A spoken-style add request becomes an approval card; nothing is written before approval; edited details void the earlier approval');

  // 2. Approve executes exactly once and leaves an undoable receipt. A quick click is not enough: you hold until the ring fills.
  assert.equal(await card.locator('button.primary').textContent(),'Hold to approve');
  await card.locator('button.primary').click();await page.waitForTimeout(500);
  assert.ok(await page.locator('#answer-actions .action-card.state-proposed').count(),'a quick click does not approve');assert.deepEqual(await mine(),[]);
  assert.match(await card.locator('.action-status').textContent(),/Keep holding/);
  await card.locator('button.primary').click({delay:900});await page.waitForFunction(()=>document.querySelector('#answer-actions .action-card')?.classList.contains('state-executed'));
  let tasks=await mine();assert.equal(tasks.length,1);assert.equal(tasks[0].minutes,35);assert.equal(tasks[0].priority,1);
  const revised=(await api('/api/actions')).actions.find(a=>a.id===first.id);assert.equal(revised.state,'executed');
  assert.equal((await raw('/api/actions/approve',{id:first.id,hash:revised.hash})).status,409);assert.equal((await mine()).length,1);
  await page.locator('#view-activity').click();await page.waitForFunction(t=>document.querySelector('#activity-list').textContent.includes(t),tag);
  assert.match(await page.locator('#activity-list .activity-item.state-executed').first().textContent(),new RegExp(tag));
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('lin:view',{detail:'chat'})));await card.locator('button',{hasText:'Undo'}).click();
  await page.waitForFunction(()=>document.querySelector('#answer-actions .action-card')?.classList.contains('state-undone'));assert.deepEqual(await mine(),[]);
  (m=>{step('passed: '+m);return checks.push(m);})('A quick click does not approve; holding until the ring fills does. Approval executes once and verifies the new task; repeat approval is refused; Activity shows the receipt; Undo removes the task');

  // 3. Declining executes nothing.
  await ask(`Add a task to ${tag} decline check`);await card.waitFor({state:'visible',timeout:120000});
  await card.locator('button',{hasText:'Decline'}).click();await page.waitForFunction(()=>document.querySelector('#answer-actions .action-card')?.classList.contains('state-rejected'));
  assert.deepEqual(await mine(),[]);(m=>{step('passed: '+m);return checks.push(m);})('Declined proposals execute nothing');

  // 4. Completing an existing task, then undo from Activity.
  await idle();let planner=await api('/api/planner');await api('/api/planner/save',{revision:planner.revision,title:`${tag} send invoice`,scope:'business',priority:2,minutes:10});
  await ask(`Mark ${tag} send invoice as done`);await card.waitFor({state:'visible',timeout:120000});
  assert.match(await card.textContent(),new RegExp(`Mark “${tag} send invoice” as done`));assert.equal((await mine())[0].done,false);
  // From the keyboard: press it twice. The first press only arms it.
  await card.locator('button.primary').focus();await page.keyboard.press('Enter');
  assert.equal(await card.locator('button.primary').textContent(),'Press again to approve');assert.equal((await mine())[0].done,false);
  await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#answer-actions .action-card')?.classList.contains('state-executed'));
  assert.equal((await mine())[0].done,true);
  await page.locator('#view-activity').click();await page.waitForFunction(t=>document.querySelector('#activity-list').textContent.includes(t+' send invoice'),tag);
  await page.locator('#activity-list .activity-item.state-executed',{hasText:tag}).first().locator('button',{hasText:'Undo'}).click();
  await page.waitForFunction(()=>document.querySelector('#activity-status').textContent==='Undone.');assert.equal((await mine())[0].done,false);
  (m=>{step('passed: '+m);return checks.push(m);})('Mark-done requests match one saved task, change it only after approval, and can be reopened from Activity');

  // 5. A read request shows exactly what was checked.
  await ask('What tasks do I have open?');
  await page.locator('#answer-actions .checked-card').waitFor({state:'visible',timeout:180000});
  const checked=await page.locator('#answer-actions .checked-card').textContent();assert.match(checked,/Checked on this computer/);
  const job=await page.evaluate(()=>document.querySelector('#answer-actions .checked-foot').textContent);assert.ok(job.length>10);
  (m=>{step('passed: '+m);return checks.push(m);})(`Read requests show a checked-sources card (${checked.match(/Saved tasks|Focus plan|Calendar[^A-Z]*|Free time[^A-Z]*|Notes[^A-Z]*/)?.[0]||'checked data'}) with verification status`);
  await page.screenshot({path:path.join(root,'design/actions-checked-desktop.png'),fullPage:false});

  // 6. Layout and safety.
  await ask(`Add a task to ${tag} layout check`);await card.waitFor({state:'visible',timeout:120000});
  await page.screenshot({path:path.join(root,'design/actions-approval-desktop.png'),fullPage:false});
  for(const width of [390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);}
  await card.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'design/actions-approval-mobile.png'),fullPage:false});
  await card.locator('button',{hasText:'Decline'}).click();
  await page.locator('#view-activity').click();await page.screenshot({path:path.join(root,'design/activity-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  (m=>{step('passed: '+m);return checks.push(m);})('Approval card and Activity fit 390/320 px layouts; no page errors or external requests');

  // 7. Ordinary conversation streams: speech starts while the rest is still being generated.
  await page.setViewportSize({width:1440,height:1100});
  await ask('I have 30 minutes to prepare a client proposal and tidy my desk. Help me choose what to do first.');const t0=Date.now();
  await page.waitForFunction(()=>document.body.dataset.state==='speaking',null,{timeout:180000});const firstAudio=Date.now()-t0;
  const detail=await page.locator('#detail').textContent();
  await page.waitForFunction(()=>document.body.dataset.state==='complete',null,{timeout:240000});
  const spoken=await page.locator('#sentences li').count();assert.ok(spoken>=1);
  assert.deepEqual(errors,[]);
  (m=>{step('passed: '+m);return checks.push(m);})(`Conversation answers stream to the voice: first audio ${firstAudio} ms after asking, ${spoken} sentence(s) played to completion`);

  const output={passed:true,checks,timings:{request_to_first_audio_ms:firstAudio},date:new Date().toISOString()};
  fs.writeFileSync(path.join(root,'voice/brain-benchmark/actions-integration-results.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
 }finally{if(browser)await browser.close();await cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1});
