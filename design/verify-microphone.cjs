const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const http=require('node:http');
const {chromium}=require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),session=JSON.parse(fs.readFileSync(path.join(root,'voice/runtime/session.json'),'utf8'));
const parsed=new URL(session.url),origin=parsed.origin,token=new URLSearchParams(parsed.hash.slice(1)).get('token');
const headers={'X-Lin-Token':token};
const fixture=path.join(root,'voice/transcription-benchmark/microphone-fixture.wav');
const checks=[],timings={};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,options={}){return fetch(origin+route,{...options,headers:{...headers,...options.headers}})}
async function oversizeHeader(){return new Promise((resolve,reject)=>{
 const req=http.request(origin+'/api/transcribe',{method:'POST',headers:{...headers,'Content-Type':'audio/wav','Content-Length':2*1024*1024+1}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end();
});}
(async()=>{
 for(let i=0;i<100;i++){
  const s=await(await api('/api/status')).json();
  if(s.transcription?.error)throw Error(s.transcription.error);
  if(s.ready&&s.transcription?.ready)break;
  if(i===99)throw Error('Voice/transcription not ready');
  await delay(500);
 }
 assert.equal((await fetch(origin+'/api/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:Buffer.from('fake')})).status,401);
 assert.equal((await api('/api/transcribe',{method:'POST',headers:{'Content-Type':'text/plain'},body:'fake'})).status,415);
 assert.equal(await oversizeHeader(),413);
 assert.equal((await api('/api/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:'not audio'})).status,400);
 checks.push('Authentication, MIME, size and malformed audio validation');
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${fixture}`]});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:1100}});
  await context.addInitScript(()=>{
   const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
   window.captureTracks=[];window.captureCalls=0;window.delayPermission=false;
   navigator.mediaDevices.getUserMedia=async(...args)=>{
    window.captureCalls++;const stream=await original(...args);window.captureTracks.push(...stream.getTracks());
    if(window.delayPermission)await new Promise(r=>setTimeout(r,500));
    return stream;
   };
  });
  const page=await context.newPage(),errors=[],external=[];let uploads=0;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/transcribe'))uploads++;if(!r.url().startsWith(origin+'/')&&!r.url().startsWith('blob:'))external.push(r.url());});
  await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#record').disabled);
  assert.equal(await page.evaluate(()=>window.captureCalls),0);
  await page.locator('#record').click();await page.waitForFunction(()=>document.body.dataset.state==='listening');
  assert.equal(await page.locator('#mic-indicator').textContent(),'microphone ON');
  assert.equal(await page.locator('#generate').isDisabled(),true);
  await page.waitForTimeout(4300);
  const started=Date.now();await page.locator('#record').click();
  await page.locator('#transcript-panel').waitFor({state:'visible',timeout:15000});
  timings.finish_to_review_ms=Date.now()-started;
  const transcript=await page.locator('#transcript').inputValue();
  assert.match(transcript,/pause my voice/i);assert.match(transcript,/interrupt me at any time/i);
  assert.equal(await page.locator('#mic-indicator').textContent(),'microphone off');
  assert.ok(await page.evaluate(()=>window.captureTracks.every(t=>t.readyState==='ended')));
  assert.equal(await page.locator('body').getAttribute('data-state'),'ready');
  const edited='This is the reviewed microphone transcript.';
  await page.locator('#transcript').fill(edited);await page.locator('#use-transcript').click();
  assert.equal(await page.locator('#request-input').inputValue(),edited);
  await page.locator('#voice-preview summary').click();
  await page.locator('#response-input').fill(edited);
  await page.locator('#generate').click();await page.waitForFunction(()=>document.body.dataset.state==='speaking',null,{timeout:15000});
  assert.equal(await page.locator('#sentences li.active').textContent(),edited);
  await page.locator('#stop').click();
  checks.push('No capture on load; fake microphone -> WebM -> local transcript -> edit -> actual voice read-back');
  await page.screenshot({path:path.join(__dirname,'microphone-desktop.png'),fullPage:true});
  const previousUploads=uploads;
  await page.locator('#record').click();await page.waitForFunction(()=>document.body.dataset.state==='listening');
  await page.keyboard.press('Escape');await page.waitForTimeout(300);
  assert.equal(uploads,previousUploads);assert.ok(await page.evaluate(()=>window.captureTracks.every(t=>t.readyState==='ended')));
  checks.push('Escape discards recording without transcription request and releases tracks');
  await page.evaluate(()=>{window.delayPermission=true;});
  await page.locator('#record').click();await page.locator('#discard').click();await page.waitForTimeout(800);
  assert.ok(await page.evaluate(()=>window.captureTracks.every(t=>t.readyState==='ended')));
  assert.equal(uploads,previousUploads);await page.evaluate(()=>{window.delayPermission=false;});
  checks.push('Discard during pending permission also closes the late-arriving stream');
  await page.locator('#record').click();await page.waitForFunction(()=>document.body.dataset.state==='listening');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.ok(await page.evaluate(()=>window.captureTracks.every(t=>t.readyState==='ended')));
  await page.evaluate(()=>{delete document.hidden;});assert.equal(uploads,previousUploads);
  checks.push('Hidden-page cancellation releases tracks and discards audio');
  for(const width of [1280,780,390,320]){
   await page.setViewportSize({width,height:1100});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(width===390)await page.screenshot({path:path.join(__dirname,'microphone-mobile.png'),fullPage:true});
  }
  const denied=await context.newPage();
  await denied.addInitScript(()=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));});
  await denied.goto(session.url);await denied.waitForFunction(()=>!document.querySelector('#record').disabled);
  await denied.locator('#record').click();await denied.waitForFunction(()=>document.querySelector('#mic-status').textContent.includes('not granted'));
  assert.equal(await denied.locator('#mic-indicator').textContent(),'microphone off');
  checks.push('Permission denial recovers to microphone off; responsive at four widths');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  checks.push('No page errors or external requests; only synthetic microphone audio used');
  fs.writeFileSync(path.join(root,'voice/transcription-benchmark/integration-results.json'),JSON.stringify({passed:true,checks,timings,recognized_text:transcript},null,2));
  console.log(JSON.stringify({passed:true,checks,timings,recognized_text:transcript},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
