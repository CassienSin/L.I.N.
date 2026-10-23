const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const session=JSON.parse(fs.readFileSync(path.join(root,'voice/runtime/session.json'),'utf8'));
const mode=process.argv[2]||'ready';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(session.url);
  await page.waitForFunction(()=>!document.querySelector('#demo').disabled,null,{timeout:60000});
  if(mode==='shutdown'){
   await page.locator('#shutdown').click();
   await page.waitForFunction(()=>document.querySelector('#voice-state').textContent==='SESSION CLOSED');
   if(!await page.locator('#generate').isDisabled())throw Error('Generation enabled after shutdown');
   console.log('Unload control stopped the service and disabled generation.');
  }else{
   console.log('Freshly launched local voice session became ready.');
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
