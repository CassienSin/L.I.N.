// Browser checks for Claude as the online brain (Phase 2), with demo data and a stand-in for Claude Code that never
// connects anywhere (voice/claude_stand_in.py), so these checks never use your Claude plan.
// Ask me first shows "Send to Claude?" with the exact text, nothing is sent until you hold Send, the answer streams
// with a Sent to Claude card and honest lines; Answer on this PC keeps it here; Claude for conversation sends
// directly; private conversations stay on this PC; a usage limit falls back to the local brain; Off means off.
// Usage: node design/verify-claude.cjs   (Lin must be running with demo data and LIN_CLAUDE_STAND_IN_FILE set)
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LIN_PLAYWRIGHT||'C:/Users/Aljho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.env.LIN_ROOT||path.join(__dirname,'..')),runtime=process.env.LIN_RUNTIME||path.join(root,'voice/runtime');
const session=JSON.parse(fs.readFileSync(path.join(runtime,'session.json'),'utf8')),url=new URL(session.url),base=url.origin;
const headers={'X-Lin-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
const modeFile=process.env.LIN_CLAUDE_STAND_IN_FILE;
const checks=[],delay=ms=>new Promise(r=>setTimeout(r,ms)),started=Date.now();
const step=m=>console.error(`[${((Date.now()-started)/1000).toFixed(1)}s] ${m}`),pass=m=>{step('passed: '+m);checks.push(m);};
setTimeout(()=>{step('Timed out after 15 minutes');process.exit(2);},15*60*1000).unref();
async function api(route,body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
async function idle(){for(let i=0;i<480;i++){const s=await api('/api/status');if(s.ready&&!s.busy&&s.reasoning.ready&&!s.reasoning.busy)return s;await delay(500);}throw Error('Lin did not become idle');}
let browser;
(async()=>{
 try{
  assert.ok(modeFile,'Start demo Lin with LIN_CLAUDE_STAND_IN_FILE set, so the stand-in answers instead of Claude Code');
  const stand=m=>fs.writeFileSync(modeFile,m);
  stand('ok');
  const status=await api('/api/claude/check',{});
  assert.ok(status.demo,'these checks run on demo data only');
  assert.equal(status.method,'claude.ai');assert.ok(status.plan,'the stand-in reports a Claude plan sign-in');
  await api('/api/claude',{mode:'ask',model:'sonnet'});
  browser=await chromium.launch(process.env.LIN_CHANNEL==='none'?{headless:true}:{channel:process.env.LIN_CHANNEL||'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(()=>{try{localStorage.setItem('lin-greet-voice','off')}catch{}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await idle();await page.goto(session.url);await page.waitForTimeout(1500);
  const sentences=()=>page.locator('#sentences').textContent();
  async function ask(text,until){step('asking: '+text);await idle();await page.waitForFunction(()=>!document.querySelector('#ask').disabled,null,{timeout:120000});
    await page.locator('#request-mode').selectOption('chat');await page.locator('#request-input').fill(text);await page.locator('#ask').click();
    await page.waitForFunction(()=>['speaking','complete'].includes(document.body.dataset.state)||!!document.querySelector('#answer-actions .action-card'),null,{timeout:240000});
    await idle();}

  // 1. Settings show the choice, the sign-in and what Claude sees.
  await page.locator('#view-settings').click();
  await page.waitForFunction(()=>/Signed in with your Claude plan/.test(document.querySelector('#claude-state')?.textContent||''),null,{timeout:15000});
  assert.ok(await page.locator('input[name=claude-mode][value=ask]').isChecked());
  assert.equal(await page.locator('#claude-model').inputValue(),'sonnet');
  assert.match(await page.locator('.claude-set').textContent(),/Never your notes, memories, tasks, calendar, profile or files/);
  assert.match(await page.locator('#brain-chip').textContent(),/\+ Claude/);
  await page.keyboard.press('Escape');await page.locator('#view-home').click();
  pass('Settings · Brain shows Ask me first, Sonnet, “Signed in with your Claude plan” and exactly what Claude can see; the chip reads “+ Claude”');

  // 2. Ask me first: a hard question gets the card with the exact text, and a quick click sends nothing.
  const q1='Explain how a load balancer spreads traffic across servers, step by step';
  await ask(q1);
  const offer=page.locator('#answer-actions .action-card.claude-offer.state-proposed');await offer.waitFor({state:'visible',timeout:60000});
  assert.match(await offer.locator('pre.claude-text').textContent(),/\[My question\]\nExplain how a load balancer/);
  assert.match(await page.locator('#answer-actions .unchecked-card').textContent(),/Nothing has been sent to Claude/);
  const before=(await api('/api/claude')).sent_this_week;
  await offer.locator('button.primary').click();await delay(800);
  assert.equal((await api('/api/claude')).sent_this_week,before,'a quick click sends nothing');
  pass('“Send to Claude?” shows the exact text that would be sent; a quick click sends nothing');

  // 3. Holding Send streams Claude's answer, with the Sent to Claude card and honest lines.
  await offer.locator('button.primary').click({delay:900});
  await page.locator('#answer-actions .claude-card').waitFor({state:'visible',timeout:60000});
  await page.waitForFunction(()=>/Here is what I think/.test(document.querySelector('#sentences')?.textContent||''),null,{timeout:60000});
  await idle();
  const card=page.locator('#answer-actions .claude-card');
  assert.match(await card.locator('pre.claude-text').textContent(),/Explain how a load balancer/);
  assert.match(await card.textContent(),/You approved it on the card · through Claude Code on this PC · nothing else left this PC/);
  assert.match(await page.locator('#answer-actions .unchecked-card').textContent(),/Claude saw only the text on this card/);
  assert.equal((await api('/api/claude')).sent_this_week,before+1);
  pass('Holding Send streams Claude’s answer into Lin’s voice, with a Sent to Claude card (the exact text) and “Claude saw only the text on this card”');

  // 4. Answer on this PC keeps it here.
  await ask('Compare the pros and cons of SQL and NoSQL databases for a small clinic app');
  const offer2=page.locator('#answer-actions .action-card.claude-offer.state-proposed');await offer2.waitFor({state:'visible',timeout:60000});
  await offer2.locator('button:not(.primary)').first().click();
  await page.waitForFunction(()=>!document.querySelector('#answer-actions .claude-offer.state-proposed')&&document.querySelector('#request-echo')?.textContent.includes('SQL and NoSQL'),null,{timeout:60000});
  await page.waitForFunction(()=>['speaking','complete'].includes(document.body.dataset.state),null,{timeout:240000});await idle();
  assert.equal(await page.locator('#answer-actions .claude-card').count(),0,'nothing went to Claude');
  assert.equal((await api('/api/claude')).sent_this_week,before+1);
  pass('“Answer on this PC” answers with the local brain and sends nothing to Claude');

  // 5. Claude for conversation: everyday questions go straight to Claude, and the follow-up carries the last exchange.
  await page.locator('#view-settings').click();await page.locator('input[name=claude-mode][value=always]').check();
  await page.waitForFunction(()=>/Claude \+/.test(document.querySelector('#brain-chip')?.textContent||''),null,{timeout:10000});
  await page.keyboard.press('Escape');
  await ask('What are good ways to stay focused while studying?');
  await page.locator('#answer-actions .claude-card').waitFor({state:'visible',timeout:60000});
  assert.equal(await page.locator('#answer-actions .action-card').count(),0,'no approval card in this mode');
  assert.match(await page.locator('#answer-actions .claude-card pre').textContent(),/\[Our last exchange, for context\]/);
  assert.match(await page.locator('#answer-actions .claude-card').textContent(),/Claude answers conversation/);
  pass('“Claude for conversation” sends everyday questions straight to Claude; the card shows the last exchange was included');

  // 6. Tasks are still answered on this PC.
  await ask('What tasks are left?');
  assert.equal(await page.locator('#answer-actions .claude-card').count(),0);
  assert.ok(await page.locator('#answer-actions .checked-card').count()>0,'answered from the saved tasks');
  pass('“What tasks are left?” is still answered from your saved tasks on this PC');

  // 7. Private conversations never leave this PC.
  await ask("Don't save this conversation");
  await ask('Ask Claude how to write a good thesis abstract');
  assert.match(await sentences(),/private, so it stays on this PC/);
  await ask('Start saving again');
  pass('In a private conversation, “ask Claude …” is refused: it stays on this PC');

  // 8. A usage limit falls back to the local brain and says so.
  stand('limit');
  await ask('What are some good habits for learning a new language?');
  await page.locator('#answer-actions .claude-card').waitFor({state:'visible',timeout:60000});
  assert.match(await sentences(),/usage limit is reached/i);
  assert.match(await page.locator('#answer-actions .claude-card').textContent(),/Claude couldn’t answer/);
  assert.match(await page.locator('#answer-actions .unchecked-card').textContent(),/answered on this PC/);
  const limited=await api('/api/claude');assert.ok(limited.limited&&!limited.ready);
  await page.waitForFunction(()=>document.querySelector('#brain-chip')?.classList.contains('warn'),null,{timeout:10000});
  stand('ok');
  pass('When the Claude usage limit is reached, Lin says so and answers on this PC; the chip turns amber');

  // 9. Off means off.
  await page.locator('#view-settings').click();await page.locator('input[name=claude-mode][value=off]').check();
  await page.waitForFunction(()=>!/Claude/.test(document.querySelector('#brain-chip')?.textContent||''),null,{timeout:10000});
  await page.keyboard.press('Escape');
  await ask('Ask Claude what the tallest mountain in Africa is');
  assert.match(await sentences(),/Claude is turned off/);
  pass('With On this PC only, “ask Claude …” answers that Claude is turned off and sends nothing');

  assert.deepEqual(errors,[]);
  const output={passed:true,checks,date:new Date().toISOString()};
  fs.mkdirSync(path.join(root,'voice/brain-benchmark'),{recursive:true});
  fs.writeFileSync(path.join(root,'voice/brain-benchmark/claude-results.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
 }finally{if(browser)await browser.close();if(modeFile)try{fs.writeFileSync(modeFile,'ok')}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1});
