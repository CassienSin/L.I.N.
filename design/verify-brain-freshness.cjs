const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),session=JSON.parse(fs.readFileSync(path.join(root,'voice/runtime/session.json'),'utf8'));
const url=new URL(session.url),base=url.origin,token=new URLSearchParams(url.hash.slice(1)).get('token');
const headers={'X-Lin-Token':token,'Content-Type':'application/json'},tag='Freshness'+crypto.randomBytes(4).toString('hex');
const file=path.join(root,'Lin Brain',tag+'.txt'),delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,body){return fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});}
async function idle(){for(let i=0;i<120;i++){const s=await(await api('/api/status')).json();if(s.ready&&!s.busy)return;await delay(500);}throw Error('Not idle');}
(async()=>{
 await idle();const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#ask').disabled);
  fs.writeFileSync(file,`${tag}: the current project color is jade.\n`,{flag:'wx'});
  await page.locator('#request-mode').selectOption('brain');await page.locator('#request-input').fill(tag);
  await page.locator('#ask').click();await page.locator('#answer-sources button').first().waitFor({state:'visible',timeout:15000});
  await delay(2000);assert.ok(await page.locator('#answer-sources button').count()>0,'Current citations disappeared on revision notification');
  assert.match((await page.locator('#sentences').textContent()),/jade/);
  await page.locator('#interrupt-anywhere').click();await idle();
  fs.writeFileSync(file,`${tag}: the current project color is coral.\n`);
  await page.waitForFunction(()=>document.querySelector('#answer-sources').hidden,null,{timeout:10000});
  assert.equal(await page.locator('#sentences li').count(),0);
  await page.locator('#ask').click();await page.locator('#answer-sources button').first().waitFor({state:'visible',timeout:15000});
  assert.match(await page.locator('#sentences').textContent(),/coral/);
  await page.locator('#interrupt-anywhere').click();await idle();
  const result={passed:true,checks:['New-query citations survive the matching revision update','Later file edits clear stale cards and replay','Next search uses the changed passage']};
  fs.writeFileSync(path.join(root,'voice/brain-benchmark/freshness-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{
  await browser.close();if(fs.existsSync(file))fs.unlinkSync(file);await idle();await api('/api/brain/refresh',{});
 }
})().catch(e=>{console.error(e);process.exit(1)});
