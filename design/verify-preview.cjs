const fs = require('fs');
const { chromium } = require('C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = 'C:/Users/Aljho/.codex/visualizations/2026/10/21/01a15c8e-b980-7050-9318-868012372a00';
(async()=>{
  const browser = await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1040,height:1000},colorScheme:'dark'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file:///'+root+'/lin-preview.html');
  const frame=page.frameLocator('iframe');
  const app=frame.locator('[data-layout="orbit"]');
  await app.locator('[data-command="search"]').first().waitFor();
  await page.screenshot({path:root+'/lin-orbit-desktop.png',fullPage:true});
  await app.locator('[data-command="search"]').first().click();
  await app.getByText('Found the context you need.').waitFor();
  await app.locator('[data-source="proposal"]').click();
  await app.getByText('Northstar proposal.pdf · page 2').waitFor();
  await app.locator('[data-replay]').click();
  await app.locator('.lin-focus').waitFor();
  await app.locator('[data-approval]').click();
  await app.locator('[data-network]').click();
  if(!await app.locator('[data-approve]').isDisabled())throw Error('Offline approval must be disabled');
  await app.locator('[data-reject]').click();
  await app.getByText('Kept unsent.').waitFor();
  await app.locator('[data-page="activity"]').click();
  await app.getByRole('heading',{name:'Email rejected'}).waitFor();
  await app.locator('[data-page="home"]').click();
  await app.locator('[data-command="web"]').click();
  await app.getByText('Live research is unavailable offline.').waitFor();
  await app.locator('[data-network]').click();
  await app.locator('[data-approval]').click();
  await app.locator('[data-approve]').click();
  await app.getByText('Approval recorded in the preview.').waitFor();
  await app.locator('[data-page="brain"]').click();
  await app.locator('[data-brain-search]').fill('Northstar');
  if(await app.locator('[data-memories] .lin-row').count()!==1)throw Error('Search did not filter');
  await app.locator('[data-forget]').click();
  await app.getByText('No matching example memories.').waitFor();
  await app.locator('[data-page="home"]').click();
  await app.locator('[data-command="remember"]').click();
  await app.locator('[data-save-memory]').waitFor();
  await app.locator('[data-save-memory]').click();
  await app.locator('[data-brain-search]').fill('first hour');
  if(!await app.getByText('Your demo request',{exact:false}).count())throw Error('Memory not saved');
  await app.locator('[data-page="today"]').click();
  await app.locator('[data-task="0"]').check();
  await app.getByText('1 of 4 completed in this preview').waitFor();
  await app.locator('[data-page="home"]').click();
  await app.locator('[data-command="search"]').first().click();
  await app.locator('[data-stop]').click();
  await app.getByRole('heading',{name:'Stopped.',exact:true}).waitFor();
  const inside=page.frames().find(f=>f!==page.mainFrame());
  const layoutChecks=[];
  for(const width of [1040,736,390,320]){
    await page.setViewportSize({width,height:1000});
    for(const theme of ['dark','light']){
      await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
      for(const layout of ['orbit','focus']){
        await inside.evaluate(layout=>{document.querySelectorAll('[data-variant]').forEach(s=>s.hidden=s.querySelector('.lin-app').dataset.layout!==layout);},layout);
        const active=frame.locator(`[data-layout="${layout}"]`);
        for(const view of ['home','today','brain','activity','connections']){
          await active.locator(`[data-page="${view}"]`).click();
          const size=await inside.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
          if(size.scroll>size.client+1)throw Error(`Overflow ${width}/${theme}/${layout}/${view}: ${JSON.stringify(size)}`);
        }
        await active.locator('[data-page="home"]').click();
        if(theme==='dark'&&(width===1040||width===390))await page.screenshot({path:`${root}/lin-${layout}-${width}.png`,fullPage:true});
        layoutChecks.push({width,theme,layout,views:5});
      }
    }
  }
  await browser.close();
  if(errors.length)throw Error(errors.join('\n'));
  console.log(JSON.stringify({passed:true,functionalChecks:['source detail','caption highlight','offline approval blocked','rejection receipt','offline web blocked','approval receipt','memory search','forget memory','save memory','task completion','cancellation'],layoutChecks},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
