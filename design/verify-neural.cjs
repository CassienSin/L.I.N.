const {chromium}=require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir='C:/Users/Aljho/.codex/visualizations/2026/10/21/01a15c8e-b980-7050-9318-868012372a00';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1040,height:1100},colorScheme:'dark'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('file:///'+dir+'/lin-neural-preview.html');
 const f=page.frameLocator('iframe'),root=f.locator('#lin-neural');
 await root.locator('[data-category]').first().waitFor();
 await page.screenshot({path:dir+'/neural-desktop.png',fullPage:true});
 const initial=await root.locator('[data-map-count]').textContent();
 await root.locator('#ln-node-picker').selectOption('northstar-0');
 await root.locator('.ln-inspector h3').filter({hasText:'Proposal v3'}).waitFor();
 await root.locator('[data-source]').click();
 await root.locator('.ln-source-reveal:not([hidden])').waitFor();
 await page.screenshot({path:dir+'/neural-selected.png',fullPage:true});
 await root.locator('[data-category="File"]').click();
 if(initial===await root.locator('[data-map-count]').textContent())throw Error('Filter did not change node count');
 await root.locator('[data-fit]').click();
 await root.locator('.ln-search input').fill('Northstar');
 if(!/1 example nodes/.test(await root.locator('[data-map-count]').textContent()))throw Error('Search filter mismatch');
 await root.locator('[data-fit]').click();
 await root.locator('[data-flat]').click();
 if(await root.locator('[data-flat]').getAttribute('aria-pressed')!=='true')throw Error('Flat mode missing');
 await root.locator('[data-zoom="1"]').click();
 if(await root.locator('[data-zoom-label]').textContent()!=='115%')throw Error('Zoom mismatch');
 await root.locator('[data-tool="inbox"]').click();
 await root.locator('[data-approve]').waitFor();
 await root.locator('[data-network]').click();
 if(!await root.locator('[data-approve]').isDisabled())throw Error('Offline approval enabled');
 await root.locator('[data-reject]').click();
 await root.locator('[data-view="activity"]').click();
 await root.getByRole('heading',{name:'Action rejected',exact:true}).waitFor();
 await root.locator('[data-tool="web"]').click();
 if(!/offline/i.test(await root.locator('[data-response-text]').textContent()))throw Error('Offline tool did not block');
 await root.locator('[data-network]').click();
 await root.locator('[data-tool="web"]').click();
 await root.locator('[data-approve]').click();
 if(!/Approval recorded/.test(await root.locator('[data-response-text]').textContent()))throw Error('No approval receipt');
 await root.locator('[data-tool="brief"]').click();
 await root.locator('[data-stop]:not([hidden])').click();
 if(!/Stopped/.test(await root.locator('[data-response-text]').textContent()))throw Error('Cancellation missing');
 await root.locator('[data-fit]').click();
 await root.locator('#ln-node-picker').selectOption('');
 await page.emulateMedia({reducedMotion:'reduce'});
 await root.locator('[data-motion]').click();
 if(await root.locator('[data-motion]').getAttribute('aria-pressed')!=='false')throw Error('Reduced motion ignored');
 const inside=page.frames().find(x=>x!==page.mainFrame());
 const checks=[];
 for(const width of [1040,736,390,320]){
  await page.setViewportSize({width,height:1100});
  for(const screen of ['brain','today','activity']){
   await root.locator(`[data-view="${screen}"]`).click();
   const dims=await inside.evaluate(()=>({w:document.documentElement.clientWidth,s:document.documentElement.scrollWidth}));
   if(dims.s>dims.w+1)throw Error('Overflow '+width+' '+screen+' '+JSON.stringify(dims));
   checks.push({width,screen});
  }
  await root.locator('[data-view="brain"]').click();
  if(width===390)await page.screenshot({path:dir+'/neural-mobile.png',fullPage:true});
 }
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({passed:true,initial,functionalChecks:12,layoutChecks:checks},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
