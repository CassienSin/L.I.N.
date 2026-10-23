const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const launch = JSON.parse(fs.readFileSync(path.join(root, 'voice/runtime/session.json'), 'utf8'));
const url = new URL(launch.url), base = url.origin;
const token = new URLSearchParams(url.hash.slice(1)).get('token');
const headers = {'X-Lin-Token':token,'Content-Type':'application/json'};
const checks = [], timings = {};
const wait = ms => new Promise(r=>setTimeout(r,ms));
async function api(route, options={}) {
 return fetch(base+route, {...options, headers:{...headers,...options.headers}});
}
async function hostCheck() {
 return new Promise((resolve,reject)=>{
  const req=http.request(base+'/api/status',{headers:{...headers,Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});
  req.on('error',reject);req.end();
 });
}
async function idle() {
 for(let i=0;i<120;i++) {
  const s = await (await api('/api/status')).json();
  if(s.error) throw Error(s.error);
  if(s.ready&&!s.busy)return s;
  await wait(500);
 }
 throw Error('Voice did not become ready');
}
(async()=>{
 assert.equal((await fetch(base+'/api/status')).status,401);
 assert.equal((await api('/api/status',{headers:{Origin:'https://example.com'}})).status,403);
 assert.equal(await hostCheck(),403);
 assert.equal((await api('/api/speak',{method:'POST',body:JSON.stringify({text:'x'.repeat(601)})})).status,400);
 assert.equal((await api('/api/speak',{method:'POST',body:'{broken'})).status,400);
 assert.equal((await api('/voice/models/config.json')).status,404);
 checks.push('API authentication, Host and Origin checks, bounded text, malformed JSON, no arbitrary file serving');
 await idle();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}}), errors=[], outside=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const address = route.request().url();
  if(!address.startsWith(base+'/')&&!address.startsWith('blob:')){outside.push(address);return route.abort();}
  return route.continue();
 });
 await page.goto(launch.url);
 await page.locator('#voice-preview summary').click();
 await page.waitForFunction(()=>!document.querySelector('#demo').disabled);
 assert.equal(new URL(page.url()).hash,'');
 checks.push('Session token removed from visible URL; voice becomes ready');
 const savedStart=Date.now();
 await page.locator('#demo').click();
 await page.waitForFunction(()=>document.body.dataset.state==='speaking');
 timings.saved_demo_first_play_ms=Date.now()-savedStart;
 await page.waitForFunction(()=>document.querySelector('#audio').currentTime>.2);
 assert.equal(await page.locator('#sentences li.active').getAttribute('data-index'),'0');
 await page.locator('#pause').click();
 const paused=await page.locator('#audio').evaluate(a=>a.currentTime);
 await wait(350);
 assert.equal(await page.locator('#audio').evaluate(a=>a.paused),true);
 assert.ok(Math.abs((await page.locator('#audio').evaluate(a=>a.currentTime))-paused)<.05);
 assert.equal(await page.locator('body').getAttribute('data-state'),'paused');
 assert.equal(await page.locator('#orb').evaluate(e=>e.style.getPropertyValue('--energy')),'0.000');
 await page.locator('#pause').click();
 await page.waitForFunction(()=>document.querySelector('#audio').currentTime>.4);
 await page.locator('#mute').check();
 assert.equal(await page.locator('#audio').evaluate(a=>a.muted),true);
 await page.locator('#mute').uncheck();
 await page.waitForFunction(()=>document.querySelector('#sentences li.active')?.dataset.index==='1');
 checks.push('Actual playback, paused clock, resume, mute, sentence change on audio completion');
 await page.screenshot({path:path.join(__dirname,'voice-desktop.png'),fullPage:true});
 await page.locator('#stop').click();
 assert.equal(await page.locator('#audio').evaluate(a=>a.paused),true);
 assert.equal(await page.locator('#sentences li.active').count(),0);
 await wait(500);
 assert.equal(await page.locator('body').getAttribute('data-state'),'stopped');
 await page.locator('#replay').click();
 await page.waitForFunction(()=>document.body.dataset.state==='speaking');
 assert.equal(await page.locator('#source-label').textContent(),'Saved audio');
 await page.locator('#stop').click();
 await idle();
 await page.waitForFunction(()=>!document.querySelector('#generate').disabled);
 await page.locator('#response-input').fill('I can speak locally now. You can interrupt whenever you need.');
 const freshStart=Date.now();
 await page.locator('#generate').click();
 await page.waitForFunction(()=>document.body.dataset.state==='speaking',null,{timeout:30000});
 timings.new_english_first_play_ms=Date.now()-freshStart;
 assert.equal(await page.locator('#source-label').textContent(),'New local speech');
 await page.waitForFunction(()=>document.body.dataset.state==='complete',null,{timeout:30000});
 assert.equal(await page.locator('#sentences li.done').count(),2);
 checks.push('Fresh local English generation streams sentence by sentence and completes');
 await idle();
 const res=await api('/api/speak',{method:'POST',body:JSON.stringify({text:'This request checks that cancellation discards unfinished speech. A second sentence must never be generated after the cancellation.'})});
 assert.equal(res.status,202);const cancelled=await res.json();
 assert.equal((await api('/api/speak',{method:'POST',body:JSON.stringify({text:'Do not overlap requests.'})})).status,409);
 await api(`/api/jobs/${cancelled.id}/cancel`,{method:'POST',body:'{}'});
 await idle();
 const receipt=await (await api(`/api/jobs/${cancelled.id}`)).json();
 assert.equal(receipt.status,'cancelled');assert.equal(receipt.segments.length,0);
 checks.push('Cancellation discards unfinished audio; concurrent generation is rejected');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('#replay').click();
 await page.waitForFunction(()=>document.body.dataset.state==='speaking');
 assert.equal(await page.locator('#orb').evaluate(e=>getComputedStyle(e).transform),'none');
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('body').getAttribute('data-state'),'stopped');
 checks.push('Reduced motion and Escape interruption');
 for(const width of [1280,780,390,320]){
  await page.setViewportSize({width,height:1000});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow at ${width}`);
  if(width===390)await page.screenshot({path:path.join(__dirname,'voice-mobile.png'),fullPage:true});
 }
 checks.push('Responsive layout at 1280, 780, 390, 320 px');
 assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
 checks.push('No page errors or external page requests');
 const report={passed:true,checks,timings,device:(await idle()).device};
 fs.writeFileSync(path.join(root,'voice/gpu-benchmark/integration-results.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
