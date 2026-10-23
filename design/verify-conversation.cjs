const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const session=JSON.parse(fs.readFileSync(path.join(root,'voice/runtime/session.json'),'utf8'));
const url=new URL(session.url),base=url.origin,token=new URLSearchParams(url.hash.slice(1)).get('token');
const headers={'X-Lin-Token':token,'Content-Type':'application/json'};
const delay=ms=>new Promise(r=>setTimeout(r,ms)),checks=[],timings={};
async function api(route,body){return fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});}
async function idle(){for(let i=0;i<180;i++){const s=await(await api('/api/status')).json();if(s.error||s.reasoning?.error)throw Error(s.error||s.reasoning.error);if(s.ready&&s.reasoning?.ready&&!s.busy&&!s.reasoning.busy)return s;await delay(500);}throw Error('Not ready');}
async function answer(question,conversation){await idle();const started=Date.now();const r=await api('/api/ask',{text:question,conversation});assert.equal(r.status,202);const job=await r.json();for(let i=0;i<180;i++){const j=await(await api(`/api/jobs/${job.id}`)).json();if(j.status==='error')throw Error(j.error);if(j.answer){await api(`/api/jobs/${job.id}/cancel`,{});await idle();return {...j,observed_ms:Date.now()-started};}await delay(250);}throw Error('No answer');}
(async()=>{
 await idle();
 assert.equal((await fetch(base+'/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 assert.equal((await api('/api/ask',{text:'test',conversation:'bad'})).status,400);
 assert.equal((await api('/api/ask',{text:'x'.repeat(1001),conversation:'a'.repeat(32)})).status,400);
 checks.push('Reasoning authentication and bounded request/conversation validation');
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${path.join(root,'voice/transcription-benchmark/microphone-fixture.wav')}`]});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[],external=[];let requests=0,latestJob;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().endsWith('/api/ask'))requests++;if(!r.url().startsWith(base+'/')&&!r.url().startsWith('blob:'))external.push(r.url());});
 page.on('response',async r=>{if(r.url().endsWith('/api/ask')&&r.status()===202)latestJob=await r.json();});
 await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#ask').disabled,null,{timeout:60000});
 await page.locator('#record').click();await page.waitForFunction(()=>document.body.dataset.state==='listening');await delay(4200);await page.locator('#record').click();
 await page.locator('#transcript-panel').waitFor({state:'visible',timeout:20000});
 assert.match(await page.locator('#transcript').inputValue(),/pause my voice/i);assert.equal(requests,0);
 const prompt='I have 30 minutes to prepare a client proposal and tidy my desk. Suggest a short plan.';
 await page.locator('#transcript').fill(prompt);await page.locator('#use-transcript').click();
 assert.equal(await page.locator('#request-input').inputValue(),prompt);assert.equal(requests,0);
 const started=Date.now();await page.locator('#ask').click();
 await page.waitForFunction(()=>document.querySelector('#sentences li')?.textContent.length>0,null,{timeout:60000});
 timings.request_to_answer_ms=Date.now()-started;
 const plan=(await page.locator('#sentences li').allTextContents()).join(' ');
 assert.notEqual(plan,prompt);assert.match(plan,/proposal/i);assert.match(plan,/25|twenty|first/i);
 await page.waitForFunction(()=>document.body.dataset.state==='speaking',null,{timeout:30000});
 timings.request_to_first_audio_ms=Date.now()-started;
 assert.equal(await page.locator('#mic-indicator').textContent(),'microphone off');
 await page.locator('#pause').click();const clock=await page.locator('#audio').evaluate(a=>a.currentTime);await delay(250);assert.ok(Math.abs((await page.locator('#audio').evaluate(a=>a.currentTime))-clock)<.05);
 await page.locator('#pause').click();await page.waitForFunction(()=>document.body.dataset.state==='speaking');
 checks.push('Synthetic microphone -> local transcript -> explicit review -> local answer -> actual spoken response; pause/resume');
 await page.screenshot({path:path.join(__dirname,'conversation-desktop.png'),fullPage:true});
 await page.locator('#stop').click();await idle();
 await page.waitForFunction(()=>!document.querySelector('#ask').disabled);
 await page.locator('#request-input').fill('Give me a thoughtful plan for learning a new language.');await page.locator('#ask').click();
 await page.waitForFunction(()=>document.body.dataset.state==='thinking');await delay(350);
 const conversation=await page.evaluate(()=>sessionStorage.getItem('lin-conversation'));
 assert.equal((await api('/api/conversation/clear',{conversation})).status,409);
 assert.equal((await api('/api/ask',{text:'Overlapping request',conversation})).status,409);
 await page.keyboard.press('Escape');await idle();await delay(700);
 assert.equal(await page.locator('#audio').evaluate(a=>a.paused),true);
 assert.equal(await page.locator('body').getAttribute('data-state'),'stopped');
 assert.equal(await page.locator('#sentences li').count(),0);
 checks.push('Interrupt while thinking cancels output; no late speech; overlap and in-flight clear rejected');
 const recallId='b'.repeat(32),otherId='c'.repeat(32);
 await api('/api/conversation/clear',{conversation:recallId});await api('/api/conversation/clear',{conversation:otherId});
 await answer('My example project is called Lantern. Keep that in mind for this conversation. Reply in one short sentence.',recallId);
 const recall=await answer('What is my example project called?',recallId);assert.match(recall.answer,/Lantern/i);
 const other=await answer('What is my example project called?',otherId);assert.doesNotMatch(other.answer,/Lantern/i);
 await api('/api/conversation/clear',{conversation:recallId});
 const cleared=await answer('What is my example project called?',recallId);assert.doesNotMatch(cleared.answer,/Lantern/i);
 const calendar=await answer('Check my calendar and tell me my next meeting.',otherId);assert.match(calendar.answer,/can't|cannot|don't have|unable|not have|no access/i);
 assert.doesNotMatch(calendar.answer,/help you (?:set a reminder|schedule)|I (?:can|will|have) (?:set|schedule|checked)/i);
 checks.push('Session recall, separate conversation isolation, cleared context excluded, unavailable calendar honestly disclosed');
 await page.waitForFunction(()=>!document.querySelector('#clear-context').disabled);
 await page.locator('#clear-context').click();await page.waitForFunction(()=>document.querySelector('#context-state').textContent.includes('Conversation cleared'));
 assert.equal(await page.locator('#request-input').inputValue(),'');assert.equal(await page.locator('#replay').isDisabled(),true);
 const demo=await(await api('/api/demo',{})).json();await idle();const saved=await(await api(`/api/jobs/${demo.id}`)).json();assert.ok(saved.segments.length===3&&saved.segments.every(s=>s.cached));
 for(const width of [1280,780,390,320]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(width===390)await page.screenshot({path:path.join(__dirname,'conversation-mobile.png'),fullPage:true});}
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 checks.push('Clear removes displayed text/audio, responsive at four widths, no browser errors or external requests');
 const results={passed:true,checks,timings,plan,recall:recall.answer,after_clear:cleared.answer,calendar:calendar.answer};
 fs.writeFileSync(path.join(root,'voice/reasoning-benchmark/integration-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
