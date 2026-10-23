const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),session=JSON.parse(fs.readFileSync(path.join(root,'voice/runtime/session.json'),'utf8'));
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${path.join(root,'voice/transcription-benchmark/microphone-fixture.wav')}`]});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
   window.tracks=[];navigator.mediaDevices.getUserMedia=async(...args)=>{const s=await original(...args);window.tracks.push(...s.getTracks());return s;};
  });
  await page.goto(session.url);await page.waitForFunction(()=>!document.querySelector('#record').disabled);
  await page.locator('#record').click();await page.waitForFunction(()=>document.body.dataset.state==='listening');
  const start=Date.now();
  await page.waitForFunction(()=>document.querySelector('#mic-indicator').textContent==='microphone off',null,{timeout:35000});
  const stopped=Date.now()-start;assert.ok(stopped>=29000&&stopped<33000);
  assert.ok(await page.evaluate(()=>window.tracks.every(t=>t.readyState==='ended')));
  // Cancel a pending transcription response and verify it cannot repopulate the UI.
  await page.locator('#discard').click();
  await page.waitForTimeout(6000);
  assert.equal(await page.locator('#transcript-panel').isHidden(),true);
  const result={passed:true,automatic_stop_ms:stopped,checks:['Automatic 30-second stop releases all tracks','Discarded in-flight transcription cannot restore the transcript']};
  fs.writeFileSync(path.join(root,'voice/transcription-benchmark/deadline-results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
