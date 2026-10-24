// Browser checks for conversation memory (Phase 1) with the real local brain: Lin keeps each exchange on this PC,
// picks the conversation back up after a reload, answers "what did we talk about today?" from it, stops saving when
// asked, and forgets only after you approve.
// Usage: node design/verify-memory.cjs   (Lin must be running with demo data)
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.LIN_PLAYWRIGHT||'C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.env.LIN_ROOT||path.join(__dirname,'..')),runtime=path.join(root,'voice/runtime');
const session=JSON.parse(fs.readFileSync(path.join(runtime,'session.json'),'utf8')),url=new URL(session.url),base=url.origin;
const headers={'X-Lin-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
const checks=[],delay=ms=>new Promise(r=>setTimeout(r,ms)),started=Date.now();
const tag='quokka'+crypto.randomBytes(2).toString('hex');   // a word that appears in no note or earlier chat
const step=m=>console.error(`[${((Date.now()-started)/1000).toFixed(1)}s] ${m}`),pass=m=>{step('passed: '+m);checks.push(m);};
setTimeout(()=>{step('Timed out after 15 minutes');process.exit(2);},15*60*1000).unref();
async function api(route,body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
async function idle(){for(let i=0;i<480;i++){const s=await api('/api/status');if(s.ready&&!s.busy&&s.reasoning.ready&&!s.reasoning.busy)return s;await delay(500);}throw Error('Lin did not become idle');}
const turns=async()=>((await api('/api/status')).conversations||{}).turns||0;
let browser;
(async()=>{
 try{
  browser=await chromium.launch(process.env.LIN_CHANNEL==='none'?{headless:true}:{channel:process.env.LIN_CHANNEL||'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(()=>{try{localStorage.setItem('lin-greet-voice','off')}catch{}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await idle();await page.goto(session.url);await page.waitForTimeout(1500);
  async function ask(text){step('asking: '+text);await idle();await page.waitForFunction(()=>!document.querySelector('#ask').disabled,null,{timeout:120000});
    await page.locator('#request-mode').selectOption('chat');await page.locator('#request-input').fill(text);await page.locator('#ask').click();
    await page.waitForFunction(()=>['speaking','complete'].includes(document.body.dataset.state)||!!document.querySelector('#answer-actions .action-card'),null,{timeout:240000});
    await idle();}

  // 1. Every exchange is kept on this PC.
  const before=await turns();
  await ask(`Let's plan the ${tag} festival budget. Keep it short.`);
  assert.equal(await turns(),before+1,'the exchange was saved');
  pass(`The exchange about the ${tag} festival was saved on this PC (conversation memory now holds ${before+1} turns)`);

  // 2. A reload picks the conversation back up.
  await page.reload();await page.waitForFunction(()=>/Picking up our conversation/.test(document.querySelector('#context-state')?.textContent||''),null,{timeout:15000});
  pass('After a reload Lin picks the conversation back up (“Picking up our conversation…”)');

  // 3. Recall answers only from saved conversations, and says so.
  await ask(`What did we talk about today about the ${tag} festival?`);
  const card=page.locator('#answer-actions .checked-card');await card.waitFor({state:'visible',timeout:60000});
  assert.match(await card.textContent(),new RegExp(tag),'the card lists the saved turn');
  assert.match(await page.locator('#answer-actions .unchecked-card').textContent(),/Only our saved conversations from today were searched/);
  pass('“What did we talk about today…?” answered from the saved turn; the card lists it and the honesty line says only conversations were searched');

  // 4. Private by voice: nothing is saved until you say so.
  await ask("Don't save this conversation");
  assert.match(await page.locator('#sentences').textContent(),/won.t save anything more/i);
  const privateBefore=await turns();
  await ask(`The secret word is ${tag}x.`);
  assert.equal(await turns(),privateBefore,'nothing was saved while private');
  await ask('Start saving again');
  pass('“Don’t save this conversation” stops saving it, and “start saving again” resumes');

  // 5. Forgetting waits for approval, then the conversation is gone from her answers.
  await ask('Forget this conversation');
  const proposal=page.locator('#answer-actions .action-card.state-proposed');await proposal.waitFor({state:'visible',timeout:60000});
  assert.match(await proposal.locator('.action-description').textContent(),/Forget this conversation/);
  assert.ok((await turns())>0,'nothing is forgotten before approval');
  await proposal.locator('button.primary').click({delay:900});  // hold to approve
  await page.waitForFunction(()=>document.querySelector('#answer-actions .action-card')?.classList.contains('state-executed'),null,{timeout:30000});
  await ask(`Did we ever talk about the ${tag} festival?`);
  assert.match(await page.locator('#sentences').textContent(),/don.t have any saved conversations|not about/i,'the forgotten conversation is gone');
  pass(`“Forget this conversation” asked first; after approval, Lin no longer finds the ${tag} festival`);

  assert.deepEqual(errors,[]);
  const output={passed:true,checks,date:new Date().toISOString()};
  fs.mkdirSync(path.join(root,'voice/brain-benchmark'),{recursive:true});
  fs.writeFileSync(path.join(root,'voice/brain-benchmark/memory-results.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
 }finally{if(browser)await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
