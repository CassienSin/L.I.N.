// Browser check: Lin Brain reads documents (PDF, PowerPoint) in the background, shows progress and problems,
// answers a question about a named document from its pages, and the Google preset asks for its details (demo data).
// Usage: node design/verify-docs.cjs   (Lin must be running with demo data)
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LIN_PLAYWRIGHT||'C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.env.LIN_ROOT||path.join(__dirname,'..')),runtime=path.join(root,'voice/runtime');
const session=JSON.parse(fs.readFileSync(path.join(runtime,'session.json'),'utf8')),url=new URL(session.url),base=url.origin;
const headers={'X-Lin-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
const checks=[],delay=ms=>new Promise(r=>setTimeout(r,ms)),started=Date.now();
const step=m=>console.error(`[${((Date.now()-started)/1000).toFixed(1)}s] ${m}`),pass=m=>{step('passed: '+m);checks.push(m);};
setTimeout(()=>{step('Timed out after 12 minutes');process.exit(2);},12*60*1000).unref();
async function api(route,body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
async function idle(){for(let i=0;i<480;i++){const s=await api('/api/status');if(s.ready&&!s.busy&&s.reasoning.ready&&!s.reasoning.busy)return;await delay(500);}throw Error('Lin did not become idle');}
const folder=path.join(root,'voice/demo/Lin Brain/Documents check'),samples=path.join(root,'design/doc-samples');
const files=['harbor-report.pdf','pitch.pptx','locked.pdf'];
let browser;
(async()=>{
 try{
  fs.rmSync(folder,{recursive:true,force:true});fs.mkdirSync(folder,{recursive:true});
  for(const f of files)fs.copyFileSync(path.join(samples,f),path.join(folder,f));
  let d;const t=Date.now();
  for(let i=0;i<240;i++){d=(await api('/api/status')).brain.documents;if(d&&d.read>=2&&!d.waiting&&!d.reading)break;await delay(1000);}
  assert.ok(d.read>=2&&!d.waiting,`documents were not read: ${JSON.stringify(d)}`);assert.equal(d.reader,'ready');
  assert.ok(d.problems.some(p=>/locked\.pdf$/.test(p.path)&&/password/.test(p.note)),JSON.stringify(d.problems));
  pass(`Dropped a PDF, a PowerPoint and a locked PDF into Lin Brain: read in the background in ${((Date.now()-t)/1000).toFixed(0)} s, the locked one explained`);

  browser=await chromium.launch(process.env.LIN_CHANNEL==='none'?{headless:true}:{channel:process.env.LIN_CHANNEL||'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
  await page.addInitScript(()=>{try{localStorage.setItem('lin-greet-voice','off')}catch{}});page.on('pageerror',e=>errors.push(e.message));
  await idle();await page.goto(session.url);
  await page.locator('#view-brain').click();
  await page.waitForFunction(()=>/document/.test(document.querySelector('#brain-status').textContent),null,{timeout:30000});
  assert.match(await page.locator('#brain-status').textContent(),/\d+ documents? read/);
  assert.match(await page.locator('#brain-problems').textContent(),/locked\.pdf — This PDF is password-protected/);
  await page.locator('.folder-panel').screenshot({path:path.join(root,'design/brain-documents.png')});
  pass('The Notes panel shows how many documents were read and why one could not be');

  await page.locator('#view-chat').click();
  await page.waitForFunction(()=>!document.querySelector('#ask').disabled,null,{timeout:120000});
  await page.locator('#request-mode').selectOption('chat');await page.locator('#request-input').fill('When is the next review in the harbor report?');await page.locator('#ask').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('#work-steps .work-text')].some(x=>/^Reading Documents check.harbor-report\.pdf$/.test(x.textContent)),null,{timeout:120000});
  await page.waitForFunction(()=>document.body.dataset.state==='complete',null,{timeout:240000});
  const answer=await page.locator('#sentences').textContent();
  assert.match(answer,/January/i,answer);
  const card=page.locator('#answer-actions .checked-card');await card.waitFor({state:'visible',timeout:30000});
  assert.match(await card.textContent(),/Page 3/);assert.match(await card.textContent(),/the whole file/);
  assert.match(await page.locator('#answer-actions .unchecked-card').textContent(),/Only this file was read/);
  await card.locator('button',{hasText:'page 3'}).click();
  assert.match(await page.locator('#source-meta').textContent(),/page 3 · read from the PDF text/);
  await page.keyboard.press('Escape');
  await page.screenshot({path:path.join(root,'design/document-answer.png')});
  pass(`“When is the next review in the harbor report?” read that PDF and answered from page 3: “${answer.trim().slice(0,90)}”`);

  await page.locator('#view-tools').click();await page.locator('#tool-preset-google').click();
  const env=await page.locator('#tool-env').inputValue();
  for(const k of ['GOOGLE_OAUTH_CLIENT_ID=','GOOGLE_OAUTH_CLIENT_SECRET=','USER_GOOGLE_EMAIL=','WORKSPACE_MCP_CREDENTIALS_DIR='])assert.ok(env.includes(k),env);
  assert.deepEqual(await page.locator('#tool-args').inputValue().then(v=>v.split('\n')),['--single-user','--tools','docs','drive','sheets','--read-only']);
  await page.locator('#tool-form button[type=submit]').click();
  assert.match(await page.locator('#tool-form-status').textContent(),/Fill in a value after GOOGLE_OAUTH_CLIENT_ID/);
  assert.ok(!(await api('/api/mcp')).servers.some(s=>s.name==='google'));
  pass('Google Docs, Drive & Sheets preset: read-only, and it will not start until your own client ID, secret and address are filled in');
  assert.deepEqual(errors,[]);
  const output={passed:true,checks,date:new Date().toISOString()};
  fs.writeFileSync(path.join(root,'voice/brain-benchmark/docs-browser-results.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
 }finally{if(browser)await browser.close().catch(()=>{});fs.rmSync(folder,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
