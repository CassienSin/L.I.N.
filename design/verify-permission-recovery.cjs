const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),session=JSON.parse(fs.readFileSync(path.join(root,'voice/runtime/session.json'),'utf8'));
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:1000}});
  let opens=0,requests=0;
  await page.addInitScript(()=>{window.captureRequests=0;navigator.mediaDevices.getUserMedia=()=>{window.captureRequests++;return Promise.reject(new DOMException('Permission denied','NotAllowedError'));};});
  await page.route('**/api/open-browser',route=>{opens++;assert.equal(route.request().method(),'POST');assert.ok(route.request().headers()['x-lin-token']);return route.fulfill({status:200,contentType:'application/json',body:'{"opened":true}'});});
  await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#record').disabled);
  assert.equal(await page.evaluate(()=>window.captureRequests),0);
  assert.equal(await page.locator('#mic-recovery').isHidden(),true);
  await page.locator('#record').click();await page.locator('#mic-recovery').waitFor({state:'visible'});
  assert.match(await page.locator('#mic-status').textContent(),/No recording started/);
  assert.equal(await page.locator('#mic-indicator').textContent(),'microphone off');
  await page.locator('#open-browser').click();
  await page.waitForFunction(()=>document.querySelector('#mic-status').textContent.includes('default browser'));
  assert.equal(opens,1);assert.equal(await page.evaluate(()=>window.captureRequests),1);
  for(const width of [1000,390,320]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  const result={passed:true,checks:['Permission denial displays actionable recovery with microphone off','Recovery is an explicit authenticated request','Recovery does not request microphone access again','Recovery panel fits at 1000, 390 and 320 px','Real microphone never accessed in this test']};
  fs.writeFileSync(path.join(root,'voice/transcription-benchmark/permission-recovery-results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
