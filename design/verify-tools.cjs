// Browser verification of connected MCP tools against the running local session (demo data).
// Usage: node design/verify-tools.cjs   (Lin must be running; uses voice/runtime/session.json)
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LIN_PLAYWRIGHT||'C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.env.LIN_ROOT||path.join(__dirname,'..')),runtime=path.join(root,'voice/runtime');
const session=JSON.parse(fs.readFileSync(path.join(runtime,'session.json'),'utf8')),url=new URL(session.url),base=url.origin;
const headers={'X-Lin-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
const checks=[],delay=ms=>new Promise(r=>setTimeout(r,ms)),started=Date.now();
const step=m=>console.error(`[${((Date.now()-started)/1000).toFixed(1)}s] ${m}`),pass=m=>{step('passed: '+m);checks.push(m);};
setTimeout(()=>{step('Timed out after 15 minutes');process.exit(2);},15*60*1000).unref();
async function raw(route,body){return fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});}
async function api(route,body){const r=await raw(route,body),d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
async function idle(){for(let i=0;i<480;i++){const s=await api('/api/status');if(s.ready&&!s.busy&&s.reasoning.ready&&!s.reasoning.busy)return;await delay(500);}throw Error('Lin did not become idle');}
async function cleanup(){try{const d=await api('/api/mcp');if(d.servers.some(s=>s.name==='lin-test'))await api('/api/mcp/remove',{revision:d.revision,name:'lin-test'});}catch{}}
let browser;
(async()=>{
 try{
  assert.equal((await fetch(base+'/api/mcp')).status,401);
  assert.equal((await fetch(base+'/api/mcp/save',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  await cleanup();
  browser=await chromium.launch(process.env.LIN_CHANNEL==='none'?{headless:true}:{channel:process.env.LIN_CHANNEL||'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});const errors=[],external=[];
  await page.addInitScript(()=>{try{localStorage.setItem('lin-greet-voice','off')}catch{}});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:'))external.push(r.url());});
  await page.goto(session.url);await idle();

  // 1. Add the built-in test server from the Tools sheet.
  await page.locator('#view-tools').click();await page.locator('#tools-workspace').waitFor({state:'visible'});
  assert.equal(await page.locator('#sheet-title').textContent(),'Tools');
  await page.locator('#tool-preset').click();assert.equal(await page.locator('#tool-name').inputValue(),'lin-test');
  await page.locator('#tool-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('[data-server="lin-test"] .action-state')?.textContent==='Connected',null,{timeout:60000});
  const rows=await page.locator('[data-server="lin-test"] .tool-row').count();assert.equal(rows,3);
  assert.deepEqual(await page.locator('[data-server="lin-test"] .tool-row select').evaluateAll(s=>s.map(x=>x.value)),['ask','ask','ask']);
  await page.screenshot({path:path.join(root,'design/tools-desktop.png')});
  pass('Tools sheet adds the test server, shows it connected with 3 tools, all set to Ask first');

  // 2. A matching request becomes an approval card; approving runs it once and Lin says the result.
  async function ask(text){step('asking: '+text);await idle();await page.evaluate(()=>document.dispatchEvent(new CustomEvent('lin:view',{detail:'chat'})));
    await page.waitForFunction(()=>!document.querySelector('#ask').disabled,null,{timeout:120000});
    await page.locator('#request-mode').selectOption('chat');await page.locator('#request-input').fill(text);await page.locator('#ask').click();}
  const card=page.locator('#answer-actions .action-card');
  await ask('Use the lin test tools to add 2 and 3');
  await card.waitFor({state:'visible',timeout:240000});
  assert.match(await card.locator('.action-description').textContent(),/Run add_numbers from lin-test/);
  const args=JSON.parse(await card.locator('pre.tool-args').textContent());assert.deepEqual([args.a,args.b].sort(),[2,3]);
  page.on('response',r=>{if(r.url().includes('/api/actions/approve'))step(`approve answered ${r.status()} after click`);});
  page.on('console',m=>step('page console: '+m.text()));
  await card.locator('button.primary').click();
  try{await page.waitForFunction(()=>document.querySelector('#answer-actions .action-card')?.classList.contains('state-executed'),null,{timeout:120000});}
  catch(e){step('answer-actions now: '+(await page.evaluate(()=>document.querySelector('#answer-actions')?.outerHTML.slice(0,1500))));step('context: '+(await page.locator('#context-state').textContent().catch(()=>'')));throw e;}
  assert.equal((await card.locator('pre.tool-output').textContent()).trim(),'5');
  assert.match(await card.locator('.action-status').textContent(),/add_numbers says: 5/);
  pass('“Use the lin test tools to add 2 and 3” becomes an approval card with the exact arguments; approving runs it and Lin reports “5”');

  // 3. Auto: the tool runs without a card and the answer comes from its output.
  await page.locator('#view-tools').click();
  await page.locator('[data-server="lin-test"] .tool-row').filter({hasText:'Count words'}).locator('select').selectOption('auto');
  await page.waitForFunction(()=>document.querySelector('#tools-status').textContent==='word_count: Auto.');
  await ask('Use lin test to count the words in: the quick brown fox');
  await page.locator('#answer-actions .checked-card').waitFor({state:'visible',timeout:240000});
  assert.match(await page.locator('#answer-actions .checked-card .eyebrow').textContent(),/From a connected tool/);
  assert.equal((await page.locator('#answer-actions pre.tool-output').textContent()).trim(),'4 words');
  await page.waitForFunction(()=>document.body.dataset.state==='complete',null,{timeout:240000});
  pass('A tool set to Auto runs without a card; the answer shows the tool output (“4 words”) as a connected-tool card');

  // 4. Off: the tool is not offered; ordinary chat never touches tools.
  await page.locator('#view-tools').click();
  for(const [name,tool] of [['Add numbers','add_numbers'],['Count words','word_count'],['Save a test note','save_note']]){
    await page.locator('[data-server="lin-test"] .tool-row').filter({hasText:name}).locator('select').selectOption('off');
    await page.waitForFunction(t=>document.querySelector('#tools-status').textContent===`${t}: Off.`,tool,{timeout:30000});
  }
  assert.ok((await api('/api/mcp')).servers.find(s=>s.name==='lin-test').tools.every(t=>t.policy==='off'));
  const before=(await api('/api/actions')).actions.length;
  await ask('Use lin test to count the words in: hello there friend');
  await page.waitForFunction(()=>document.body.dataset.state==='complete'||document.body.dataset.state==='speaking',null,{timeout:240000});
  assert.equal(await page.locator('#answer-actions .action-card').count(),0);assert.equal((await api('/api/actions')).actions.length,before);
  pass('With every tool set to Off, the same request gets an ordinary answer and no tool runs');

  // 5. Layout and safety.
  await page.locator('#view-tools').click();
  for(const width of [390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);}
  await page.screenshot({path:path.join(root,'design/tools-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  pass('Tools sheet fits 390/320 px; no page errors or outside requests');
  const output={passed:true,checks,date:new Date().toISOString()};
  fs.writeFileSync(path.join(root,'voice/brain-benchmark/tools-results.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
 }finally{if(browser)await browser.close();await cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1});
