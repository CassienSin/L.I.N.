// Browser check: switch between the Fast and Smart brains from About you, without restarting Lin (demo data).
// Usage: node design/verify-brain-switch.cjs   (Lin must be running with demo data)
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LIN_PLAYWRIGHT||'C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.env.LIN_ROOT||path.join(__dirname,'..')),runtime=path.join(root,'voice/runtime');
const session=JSON.parse(fs.readFileSync(path.join(runtime,'session.json'),'utf8')),url=new URL(session.url),base=url.origin;
const headers={'X-Lin-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
const checks=[],delay=ms=>new Promise(r=>setTimeout(r,ms)),started=Date.now();
const step=m=>console.error(`[${((Date.now()-started)/1000).toFixed(1)}s] ${m}`),pass=m=>{step('passed: '+m);checks.push(m);};
setTimeout(()=>{step('Timed out after 12 minutes');process.exit(2);},12*60*1000).unref();
async function api(route,body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
async function ready(model){for(let i=0;i<300;i++){const s=await api('/api/status');if(s.reasoning.ready&&!s.reasoning.switching&&!s.busy&&(!model||String(s.reasoning.model).includes(model)))return s;await delay(1000);}throw Error('brain did not become ready: '+model);}
let browser;
(async()=>{
 try{
  const start=await api('/api/brain');assert.ok(start.available.smart,'the Smart brain is installed');
  browser=await chromium.launch(process.env.LIN_CHANNEL==='none'?{headless:true}:{channel:process.env.LIN_CHANNEL||'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
  await page.addInitScript(()=>{try{localStorage.setItem('lin-greet-voice','off')}catch{}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(session.url);await ready();
  await page.locator('#view-settings').click();await page.waitForFunction(()=>document.querySelector('input[name=brain-mode]:checked'));
  if(start.mode!=='fast'){await page.locator('input[name=brain-mode][value=fast]').check();await ready('4B');}
  let t=Date.now();await page.locator('input[name=brain-mode][value=smart]').check();
  await page.waitForFunction(()=>/Switching to smart/.test(document.querySelector('#brain-state').textContent),null,{timeout:10000});
  const s1=await ready('35B');const smartSeconds=((Date.now()-t)/1000).toFixed(0);
  assert.ok(s1.reasoning.gpu_layers>0,`Smart uses the graphics card (${s1.reasoning.gpu_note||''})`);
  await page.waitForFunction(()=>/Using Qwen3.6-35B/.test(document.querySelector('#brain-state').textContent),null,{timeout:30000});
  await page.keyboard.press('Escape');
  await page.locator('#request-mode').selectOption('chat');await page.locator('#request-input').fill('Give me one tip for staying focused.');await page.locator('#ask').click();
  await page.waitForFunction(()=>document.body.dataset.state==='complete',null,{timeout:240000});
  assert.ok((await page.locator('#sentences li').count())>=1);
  pass(`Switched to Smart (Qwen3.6 35B, graphics card) in ${smartSeconds} s without restarting Lin, and it answered`);
  t=Date.now();await page.locator('#view-settings').click();await page.locator('input[name=brain-mode][value=fast]').check();
  await ready('4B');const fastSeconds=((Date.now()-t)/1000).toFixed(0);
  const b=await api('/api/brain');assert.equal(b.mode,'fast');
  assert.deepEqual(errors,[]);
  pass(`Switched back to Fast (Qwen3 4B, processor) in ${fastSeconds} s; brain.json records the choice`);
  const output={passed:true,checks,date:new Date().toISOString()};
  fs.writeFileSync(path.join(root,'voice/brain-benchmark/brain-switch-results.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
 }finally{if(browser)await browser.close().catch(()=>{});try{await api('/api/brain',{mode:'fast'});}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1});
