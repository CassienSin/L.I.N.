// Browser-only synthetic capacity fixture. Nothing is written to Lin's database.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),session=JSON.parse(fs.readFileSync(path.join(root,'voice/runtime/session.json'),'utf8'));
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}});await page.goto(session.url);await page.locator('#view-map').click();
  await page.waitForFunction(()=>document.querySelector('#map-count').textContent.includes('real item'));
  await page.screenshot({path:path.join(root,'design/brain-map-current.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'design/brain-map-current-mobile.png'),fullPage:true});
  const stress=await browser.newPage({viewport:{width:1280,height:950}});
  await stress.route('**/api/brain/graph',async route=>{
   const original=await route.fetch(),data=await original.json();
   data.nodes=Array.from({length:400},(_,i)=>({id:'fixture-'+i,title:i===0?'<img src=x onerror=alert(1)>':'Synthetic capacity item '+i,kind:i<200?'file':'memory',group:i<200?'notes':i<300?'personal':'business',source_id:'not-a-real-source',passages:[{id:'not-a-real-source',start:1,end:1}]}));
   data.edges=data.nodes.map(n=>({from:'group-'+n.group,to:n.id,relation:'contains'}));
   await route.fulfill({response:original,json:data});
  });
  await stress.goto(session.url);await stress.locator('#view-map').click();await stress.waitForFunction(()=>document.querySelectorAll('.map-node').length===400);
  assert.equal(await stress.locator('#brain-map').evaluate(n=>n.classList.contains('dense')),true);
  assert.equal(await stress.locator('#map-workspace img').count(),0);
  assert.equal(await stress.locator('#map-list button').count(),400);
  await stress.locator('#map-filter').selectOption('business');assert.equal(await stress.locator('.map-node').count(),100);
  await stress.locator('#map-search').fill('item 399');assert.equal(await stress.locator('.map-node').count(),1);
  await stress.locator('#map-search').fill('no such item');assert.equal(await stress.locator('.map-node').count(),0);
  assert.match(await stress.locator('#map-status').textContent(),/0 of 400/);
  const mobile=await browser.newPage({viewport:{width:390,height:844}});await mobile.goto(session.url);await mobile.locator('#view-map').click();assert.equal(await mobile.locator('.map-list-panel').evaluate(n=>n.open),true);
  console.log('PASS: 400-item synthetic map, filtering, safe text rendering, empty results, mobile item list; current real map screenshots saved.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
