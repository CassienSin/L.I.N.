// Browser checks for the live work panel, the greeting, "what I couldn't check" and Save to brain (demo data).
// Usage: node design/verify-presence.cjs   (Lin must be running with demo data)
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.LIN_PLAYWRIGHT||'C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.env.LIN_ROOT||path.join(__dirname,'..')),runtime=path.join(root,'voice/runtime');
const session=JSON.parse(fs.readFileSync(path.join(runtime,'session.json'),'utf8')),url=new URL(session.url),base=url.origin;
const headers={'X-Lin-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
const checks=[],delay=ms=>new Promise(r=>setTimeout(r,ms)),started=Date.now(),tag='Save check '+crypto.randomBytes(3).toString('hex');
const step=m=>console.error(`[${((Date.now()-started)/1000).toFixed(1)}s] ${m}`),pass=m=>{step('passed: '+m);checks.push(m);};
setTimeout(()=>{step('Timed out after 15 minutes');process.exit(2);},15*60*1000).unref();
async function api(route,body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
async function idle(){for(let i=0;i<480;i++){const s=await api('/api/status');if(s.ready&&!s.busy&&s.reasoning.ready&&!s.reasoning.busy)return;await delay(500);}throw Error('Lin did not become idle');}
let browser;
// Remove test notes left by an earlier interrupted run (through Undo, so only unedited test notes go).
async function cleanup(){try{for(const a of (await api('/api/actions')).actions)if(a.tool==='save_note'&&a.can_undo&&/^Save check /.test(a.payload.title))await fetch(base+'/api/actions/undo',{method:'POST',headers,body:JSON.stringify({id:a.id})});}catch{}}
(async()=>{
 try{
  await cleanup();
  assert.equal((await fetch(base+'/api/greeting')).status,401);
  browser=await chromium.launch(process.env.LIN_CHANNEL==='none'?{headless:true}:{channel:process.env.LIN_CHANNEL||'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:'))external.push(r.url());});
  await idle();await page.goto(session.url);
  const profile=await api('/api/profile'),greeting=(await api('/api/greeting')).text;

  // 1. Greeting with real numbers, spoken after the first click.
  assert.match(greeting,new RegExp(`^Good (morning|afternoon|evening), ${profile.name}\\.`));assert.match(greeting,/Lin Brain has \d+ notes? and \d+ memor/);assert.match(greeting,/open task|task list is clear/);
  await page.waitForFunction(t=>document.querySelector('#sentences').textContent.includes(t),greeting,{timeout:120000});
  await page.mouse.click(700,300);
  await page.waitForFunction(()=>document.body.dataset.state==='speaking',null,{timeout:60000});
  const energy=await page.evaluate(async()=>{let max=0;for(let i=0;i<30;i++){max=Math.max(max,+getComputedStyle(document.querySelector('#orb')).getPropertyValue('--energy')||0);await new Promise(r=>setTimeout(r,100));}return max;});
  assert.ok(energy>0.05,`the pearl should follow Lin's voice, peak energy ${energy}`);
  await page.waitForFunction(()=>document.body.dataset.state==='complete',null,{timeout:120000});
  pass(`Greeting uses real numbers (“${greeting.slice(0,70)}…”) and is spoken after the first click; the pearl follows her voice (peak ${energy.toFixed(2)})`);

  async function ask(text,mode='chat'){step('asking: '+text);await idle();await page.waitForFunction(()=>!document.querySelector('#ask').disabled,null,{timeout:120000});
    await page.locator('#request-mode').selectOption(mode);await page.locator('#request-input').fill(text);await page.locator('#ask').click();}
  const stepsText=()=>page.evaluate(()=>[...document.querySelectorAll('#work-steps .work-text')].map(x=>x.textContent));

  // 2. Live work panel for a direct lookup and for a written answer.
  await ask('What tasks are left?');
  await page.locator('#work-panel').waitFor({state:'visible',timeout:60000});
  await page.waitForFunction(()=>/^Done in/.test(document.querySelector('#work-title').textContent),null,{timeout:120000});
  let s=await stepsText();
  for(const want of ['Understanding your request','Checking your saved tasks','Reading the exact answer from your data','Giving it a voice','Done'])assert.ok(s.includes(want),`missing step “${want}” in ${JSON.stringify(s)}`);
  assert.ok(await page.locator('#work-steps .work-time').evaluateAll(t=>t.some(x=>/\d/.test(x.textContent))));
  await page.screenshot({path:path.join(root,'design/work-panel.png')});
  pass(`A direct lookup shows its steps live with timings: ${s.join(' → ')}`);
  await ask('Give me one tip for staying focused.');
  // Plain chat either thinks it through or recalls matching saved facts first (the demo has memories about focus).
  await page.waitForFunction(()=>[...document.querySelectorAll('#work-steps .work-text')].some(x=>x.textContent==='Thinking it through'||/^Recalling \d+ saved fact/.test(x.textContent)),null,{timeout:120000});
  await page.waitForFunction(()=>/^Done in/.test(document.querySelector('#work-title').textContent),null,{timeout:240000});
  s=await stepsText();assert.ok(s.includes('Speaking while she finishes the answer'),JSON.stringify(s));
  pass(`A written answer shows: ${s.join(' → ')}`);

  // 3. What I couldn't check.
  await page.locator('#answer-actions .unchecked-card').waitFor({state:'visible',timeout:30000});
  assert.match(await page.locator('#answer-actions .unchecked-card').textContent(),/general knowledge|saved facts? from your memories/);
  await ask('panel feedback zeppelin','brain');
  await page.waitForFunction(()=>/zeppelin/.test(document.querySelector('#answer-actions .unchecked-card')?.textContent||''),null,{timeout:120000});
  pass('Answers say what was not checked: general-knowledge chat says so, and a notes search names the word nothing mentioned (“zeppelin”)');

  // 4. Save to brain: approval card with editable title, the note appears on the map and Undo removes it.
  await page.waitForFunction(()=>!document.querySelector('#save-answer').disabled,null,{timeout:120000});
  await page.locator('#save-answer').click();
  const card=page.locator('#answer-actions .action-card.state-proposed');await card.waitFor({state:'visible',timeout:30000});
  assert.match(await card.locator('.action-description').textContent(),/Save “.+” to Lin Brain · Saved answers\//);
  assert.match(await card.locator('pre.note-preview').textContent(),/## You asked[\s\S]*panel feedback zeppelin[\s\S]*## Lin said/);
  const before=(await api('/api/graph')).nodes.length;
  await card.locator('input').fill(tag);assert.equal(await card.locator('button.primary').textContent(),'Update details');await card.locator('button.primary').click();
  await page.waitForFunction(t=>document.querySelector('#answer-actions .action-card.state-proposed .action-description')?.textContent.includes(t),tag);
  await page.locator('#answer-actions .action-card.state-proposed button.primary').click();
  await page.waitForFunction(()=>document.querySelector('#answer-actions .action-card')?.classList.contains('state-executed'),null,{timeout:30000});
  await page.waitForFunction(t=>document.querySelector('#map-status').textContent.includes(t),tag,{timeout:40000});
  const g=await api('/api/graph'),saved=g.nodes.find(n=>n.title===tag);assert.ok(saved&&saved.path.replace(/\\/g,'/').startsWith('Saved answers/'),'saved note on the map');
  assert.equal((await page.evaluate(()=>window.linMap.stats())).focus,saved.id);assert.equal(g.nodes.length,before+1);
  await page.screenshot({path:path.join(root,'design/save-to-brain.png')});
  await page.locator('#answer-actions .action-card button',{hasText:'Undo'}).click();
  await page.waitForFunction(()=>document.querySelector('#answer-actions .action-card')?.classList.contains('state-undone'),null,{timeout:30000});
  for(let i=0;i<20&&(await api('/api/graph')).nodes.some(n=>n.title===tag);i++)await delay(1000);
  assert.ok(!(await api('/api/graph')).nodes.some(n=>n.title===tag),'undo removes the note');
  pass('Save to brain asks first with an editable title, writes the note into Lin Brain, flies the map to it, and Undo removes it');

  // 5. Layout and safety.
  for(const width of [390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);}
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  pass('Fits 390/320 px; no page errors or outside requests');
  const output={passed:true,checks,date:new Date().toISOString()};
  fs.writeFileSync(path.join(root,'voice/brain-benchmark/presence-results.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
 }finally{if(browser)await browser.close().catch(()=>{});await cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1});
