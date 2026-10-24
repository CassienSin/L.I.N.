(() => {
 'use strict';
 // Approval cards, checked-source cards and the Activity receipt list.
 // Nothing here changes data without an explicit approval (hold, or press twice) or Undo.
 const $=s=>document.querySelector(s),token=sessionStorage.getItem('lin-session-token')||'';
 let busy=false,closed=false,activityRevision=null,activeView='chat',loading=false,current=null,timer=0;
 const STATE={proposed:'Waiting for your approval',executed:'Done',rejected:'Declined',expired:'Expired · nothing changed',failed:'Not made',unknown:'Unconfirmed',undone:'Undone',executing:'Working…'};
 function node(tag,text,className){const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=text;if(className)n.className=className;return n;}
 async function api(path,body){
   const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'X-Lin-Token':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
   const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Lin could not reach the local action service.');return d;
 }
 function stateLabel(a){return a.tool==='send_to_claude'?({executed:'Sent to Claude',rejected:'Kept on this PC'}[a.state]||STATE[a.state]||a.state):(STATE[a.state]||a.state);}
 function stamp(iso){return iso?new Date(iso).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';}

 // ---- Checked sources --------------------------------------------------
 function checkedCard(job){
   const c=job.checked;
   if(c.tool==='claude')return claudeCard(job);
   const box=node('section','','checked-card');box.setAttribute('aria-label','Checked sources');
   const head=node('div','','checked-head');head.append(node('span',c.tool==='mcp'?'From a connected tool':'Checked on this computer','eyebrow'),node('span',c.label,'checked-label'));box.append(head);
   if(c.tool==='mcp'){
     if(Object.keys(c.arguments||{}).length)box.append(node('pre',JSON.stringify(c.arguments,null,2),'tool-args'));
     box.append(node('pre',c.text,'tool-output'));
     box.append(node('p',`${job.verification==='tool'?'Lin answered from this output':'You heard the tool output directly'} · ${c.checked_label||''}`,'checked-foot'));
     return box;
   }
   if(c.note)box.append(node('p',c.note,'checked-note'+(c.stale||c.available===false?' warn':'')));
   const list=node('ul','','checked-list');
   const add=(main,sub,extra)=>{const li=node('li');li.append(node('strong',main));if(sub)li.append(node('span',sub));if(extra)li.append(extra);list.append(li);};
   if(c.tool==='agenda')for(const e of c.events)add(e.title,[e.all_day?'All day':`${e.start}–${e.end}`,e.status,e.tentative?'tentative':null,e.location].filter(Boolean).join(' · '));
   if(c.tool==='free_time'){
     for(const g of c.gaps)add(`Free ${g.start}–${g.end}`,`${g.minutes} minutes`);
     for(const b of c.busy)add(b.title,`Busy ${b.start}–${b.end}${b.tentative?' · tentative':''}`);
     if(c.window)box.append(node('p',`Window: ${c.window} · gaps under 15 minutes are not listed`,'checked-note'));
   }
   if(c.tool==='conversations')for(const it of c.items||[])add(it.when[0].toUpperCase()+it.when.slice(1),`You: ${it.question} · Lin: ${it.answer}`);
   if(c.tool==='tasks'){for(const t of c.tasks)add(t.title,`${t.scope} · ${t.minutes} min · ${t.priority} priority`);if(c.more)add(`${c.more} more`,'See Plan my day');}
   if(c.tool==='plan'){for(const s of c.steps)add(s.title,`minute ${s.from_minute}–${s.to_minute} · ${s.minutes} min`);box.append(node('p',`${c.used} of ${c.available} minutes used · ${c.deferred} did not fit · ${c.note}`,'checked-note'));}
   if(c.tool==='notes')for(const item of c.items){
     const open=node('button',item.kind==='file'?`Open passage · ${item.where||`lines ${item.lines[0]}–${item.lines[1]}`}`:'Open saved memory','source-reference');open.type='button';
     open.addEventListener('click',async()=>{try{const s=await api('/api/sources/'+item.id);$('#source-title').textContent=s.title;$('#source-meta').textContent=s.kind==='file'?`${s.path} · ${s.where||`lines ${s.line_start}–${s.line_end}`}${s.document?' · read from '+s.document:''}`:`Saved explicitly by you · ${s.scope}`;const pre=node('pre',s.body);$('#source-content').replaceChildren(pre);$('#source-dialog').showModal();}catch(err){open.textContent=err.message;open.disabled=true;}});
     add(item.title,item.text.slice(0,160)+(item.text.length>160?'…':''),open);
   }
   if(c.tool==='document'){
     for(const s of job.sources||[]){
       const where=s.where||`lines ${s.line_start}–${s.line_end}`;
       const open=node('button',`Open passage · ${where}`,'source-reference');open.type='button';
       open.addEventListener('click',()=>{$('#source-title').textContent=s.title;$('#source-meta').textContent=`${s.path} · ${where}${s.document?' · read from '+s.document:''}`;$('#source-content').replaceChildren(node('pre',s.body));$('#source-dialog').showModal();});
       const text=s.body.replace(/^(## Page \d+|<!-- Slide number: \d+ -->)\s*/,'');
       add(where[0].toUpperCase()+where.slice(1),text.slice(0,160)+(text.length>160?'…':''),open);
     }
     box.append(list);
     box.append(node('p',`${job.verification==='document'?'Lin answered from these passages only':'Lin could not write an answer, so you heard the closest passage'} · ${c.whole?'the whole file':`${c.read} of ${c.total} passages`}`,'checked-foot'));
     return box;
   }
   if(!list.children.length&&c.available!==false)list.append(node('li','Nothing matched in this source.','muted'));
   box.append(list);
   box.append(node('p',`${job.verification==='exact'?'Answered directly from this data':job.verification==='passed'?'Lin’s answer was checked against this data':job.verification?'Lin’s wording did not match this data, so you heard the exact summary instead':'Checked data'} · ${c.checked_label||''}`,'checked-foot'));
   return box;
 }

 // What went to Claude, word for word, and what came back.
 function claudeCard(job){
   const c=job.checked,failed=c.fallback&&!c.partial,box=node('section','','checked-card claude-card');box.setAttribute('aria-label','Sent to Claude');
   const head=node('div','','checked-head');head.append(node('span',failed?'Claude couldn’t answer':'Sent to Claude','eyebrow'),node('span',c.label,'checked-label'));box.append(head);
   if(c.fallback)box.append(node('p',c.fallback+(failed?' Lin answered on this PC instead.':''),'checked-note warn'));
   box.append(node('pre',c.text,'tool-args claude-text'));
   box.append(node('p',`${c.how} · through Claude Code on this PC · nothing else left this PC`,'checked-foot'));
   return box;
 }

 // ---- Approval card -----------------------------------------------------
 function field(label,input){const wrap=node('label','','action-field');wrap.append(node('span',label),input);return wrap;}
 function select(options,value){const s=document.createElement('select');for(const [v,l] of options){const o=node('option',l);o.value=v;s.append(o);}s.value=value;return s;}
 function proposalCard(action){
   current=action;clearInterval(timer);
   const claude=action.tool==='send_to_claude';
   const box=node('section','','action-card state-'+action.state+(claude?' claude-offer':''));box.dataset.id=action.id;box.setAttribute('aria-label',claude?'Send to Claude?':'Proposed change');
   const head=node('div','','checked-head');head.append(node('span',action.state==='proposed'?(claude?'Send to Claude?':'Waiting for your approval'):'Receipt','eyebrow'),node('span',stateLabel(action),'action-state'));box.append(head);
   box.append(node('p',action.description,'action-description'));
   if(claude){
     box.append(node('p',action.state==='proposed'?`Only this text goes to Claude (${action.payload.label}), through Claude Code on this PC with your Claude plan. Nothing is sent until you hold Send.`:action.state==='executed'?`You approved sending this text to Claude (${action.payload.label}), once.`:'This text was not sent to Claude.','checked-note'));
     box.append(node('pre',action.payload.text,'tool-args claude-text'));
   }
   if(action.tool==='mcp'){
     const p=action.payload;
     box.append(node('p',`Lin will send these details to ${p.server}. ${p.read_only?'The server says this tool only reads.':'This tool may change things.'}`,'checked-note'));
     box.append(node('pre',JSON.stringify(p.arguments,null,2),'tool-args'));
     if(action.result&&action.result.text)box.append(node('pre',action.result.text,'tool-output'));
   }
   let inputs=null;
   if(action.state==='proposed'&&action.tool==='add_task'){
     const p=action.payload;inputs={title:node('input'),scope:select([['personal','Personal'],['business','Business']],p.scope),priority:select([['high','High'],['normal','Normal'],['low','Low']],p.priority),minutes:node('input')};
     inputs.title.value=p.title;inputs.title.maxLength=80;inputs.minutes.type='number';inputs.minutes.min=1;inputs.minutes.max=480;inputs.minutes.value=p.minutes;
     const grid=node('div','','action-fields');grid.append(field('Task',inputs.title),field('Scope',inputs.scope),field('Priority',inputs.priority),field('Minutes',inputs.minutes));box.append(grid);
   }
   const status=node('p','','action-status');status.setAttribute('role','status');
   const buttons=node('div','','brain-actions');
   if(action.state==='proposed'&&action.tool==='save_note'){
     inputs={title:node('input')};inputs.title.value=action.payload.title;inputs.title.maxLength=80;
     const grid=node('div','','action-fields note-fields');grid.append(field('Note title',inputs.title));box.append(grid);
   }
   if(action.tool==='save_note'){
     const body=action.payload.body;box.append(node('pre',body.slice(0,700)+(body.length>700?'\n…':''),'tool-output note-preview'));
     if(action.state==='executed'&&action.result)document.dispatchEvent(new CustomEvent('lin:fly-to-path',{detail:action.result.path}));
   }
   const value=(k,i)=>k==='minutes'?Number(i.value):k==='title'?i.value.trim():i.value;
   const edited=()=>inputs&&Object.entries(inputs).some(([k,i])=>value(k,i)!==action.payload[k]);
   if(action.state==='proposed'){
     const approve=node('button',claude?'Hold to send to Claude':'Hold to approve','primary hold'),reject=node('button',claude?'Answer on this PC':'Decline');approve.type=reject.type='button';
     const hold=holdToApprove(approve,status,()=>!edited(),go);
     const sync=()=>{hold.label(edited()?'Update details':claude?'Hold to send to Claude':'Hold to approve');approve.classList.toggle('hold',!edited());};
     if(inputs)Object.values(inputs).forEach(i=>i.addEventListener('input',sync));
     async function go(){
       approve.disabled=reject.disabled=true;
       try{
         if(edited()){
           const fields=Object.fromEntries(Object.entries(inputs).map(([k,i])=>[k,value(k,i)]));
           const r=await api('/api/actions/revise',{id:action.id,fields});replace(box,proposalCard(r.action));
           $('.action-card .action-status').textContent='Details updated. Review them, then hold to approve.';return;
         }
         if(action.tool==='save_note')window.linOwnBrainWrite=Date.now();
         const r=await api('/api/actions/approve',{id:action.id,hash:action.hash});const receipt=proposalCard(r.action);replace(box,receipt);keepReceipt={node:receipt,at:Date.now()};
         document.dispatchEvent(new CustomEvent('lin:approved',{detail:{state:r.action.state}}));
         if(claude&&r.action.state==='executed')document.dispatchEvent(new CustomEvent('lin:send-claude',{detail:{id:action.id,question:action.payload.question}}));
         if(r.message){$('.action-card .action-status').textContent=r.message;if(r.action.state==='executed')document.dispatchEvent(new CustomEvent('lin:say',{detail:{text:r.message}}));}
         refreshActivity();
       }catch(err){status.textContent=err.message;approve.disabled=reject.disabled=false;refreshActivity();}
     }
     reject.addEventListener('click',async()=>{approve.disabled=reject.disabled=true;try{const r=await api('/api/actions/reject',{id:action.id});replace(box,proposalCard(r.action));document.dispatchEvent(new Event('lin:declined'));if(claude)document.dispatchEvent(new CustomEvent('lin:ask-local',{detail:{question:action.payload.question}}));refreshActivity();}catch(err){status.textContent=err.message;approve.disabled=reject.disabled=false;}});
     buttons.append(approve,reject);
     const left=node('span','','action-timer');buttons.append(left);
     const ends=Date.now()+action.seconds_left*1000;
     const tick=()=>{const s=Math.max(0,Math.round((ends-Date.now())/1000));left.textContent=s?`Expires in ${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`:'Expired';if(!s){approve.disabled=true;clearInterval(timer);}};
     tick();timer=setInterval(tick,1000);
   }else if(action.can_undo){
     const undo=node('button','Undo');undo.type='button';
     undo.addEventListener('click',async()=>{undo.disabled=true;if(action.tool==='save_note')window.linOwnBrainWrite=Date.now();try{const r=await api('/api/actions/undo',{id:action.id});replace(box,proposalCard(r.action));$('.action-card .action-status').textContent=action.tool==='save_note'?'Undone. The note was removed from Lin Brain.':'Undone. Your task list is back as it was.';refreshActivity();}catch(err){status.textContent=err.message;undo.disabled=false;}});
     buttons.append(undo);
   }
   if(action.note)status.textContent=action.note;
   box.append(buttons,status);
   box.append(node('p',action.state==='proposed'?(claude?'Nothing is sent until you approve. Answer on this PC keeps it here.':action.tool==='mcp'?'Nothing runs until you approve.':'Nothing changes until you approve. Editing a detail requires approving again.'):`Receipt · ${stateLabel(action)} ${stamp(action.decided_at)}`,'checked-foot'));
   return box;
 }
 function replace(oldNode,newNode){oldNode.replaceWith(newNode);}

 // A fact you mentioned, offered as a memory. Nothing is saved unless you press Save.
 function suggestionCard(s){
   const box=node('section','','checked-card suggestion-card');box.setAttribute('aria-label','Suggested memory');
   const head=node('div','','checked-head');head.append(node('span','Remember this?','eyebrow'),node('span',s.title,'checked-label'));box.append(head);
   box.append(node('p',`You said: “${s.fact}”`,'action-description'));
   const status=node('p','','action-status');status.setAttribute('role','status');
   const buttons=node('div','','brain-actions'),yes=node('button','Save as a memory','primary'),no=node('button','Not now');yes.type=no.type='button';
   yes.addEventListener('click',async()=>{
     yes.disabled=no.disabled=true;
     try{window.linOwnBrainWrite=Date.now();await api('/api/memories/save',{title:s.title,fact:s.fact,scope:s.scope});box.classList.add('saved');buttons.remove();status.textContent='Saved to your memories. Edit or forget it any time in Notes.';}
     catch(err){status.textContent=/Interrupt Lin/.test(err.message)?'Lin is still speaking. Press Save again when she has finished.':err.message;yes.disabled=no.disabled=false;}
   });
   no.addEventListener('click',()=>box.remove());
   buttons.append(yes,no);box.append(buttons,status,node('p','Lin noticed this in what you said. Nothing is saved unless you press Save.','checked-foot'));
   return box;
 }

 // Hold to approve: a press has to be held while the ring fills (about 0.7 s), so nothing is approved by a stray click.
 // From the keyboard or a screen reader, press it twice within 3 seconds. `ready()` says whether holding applies right now.
 const HOLD_MS=700,ARM_MS=3000;
 function holdToApprove(button,status,ready,run){
   let start=0,frame=0,armed=0,armTimer=0,label=button.textContent;
   const set=v=>button.style.setProperty('--hold',v.toFixed(3));
   const reset=()=>{cancelAnimationFrame(frame);start=0;set(0);button.classList.remove('holding');};
   const done=()=>{reset();disarm();document.dispatchEvent(new Event('lin:approve-hold-complete'));run();};
   const disarm=()=>{clearTimeout(armTimer);armed=0;button.classList.remove('armed');if(ready())button.textContent=label;};
   button.addEventListener('pointerdown',e=>{
     if(!ready()||button.disabled||e.button!==0)return;
     e.preventDefault();button.setPointerCapture?.(e.pointerId);start=performance.now();button.classList.add('holding');
     const step=t=>{const k=Math.min(1,(t-start)/HOLD_MS);set(k);if(k>=1){done();return;}frame=requestAnimationFrame(step);};
     frame=requestAnimationFrame(step);
   });
   const release=()=>{if(!start)return;const held=performance.now()-start;reset();if(held<HOLD_MS)status.textContent='Keep holding until the ring fills to approve. From the keyboard, press it twice.';};
   button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
   button.addEventListener('click',e=>{
     if(!ready()){run();return;}                 // editing: "Update details" is an ordinary button
     if(e.detail!==0)return;                      // a pointer click is handled by holding
     if(armed&&Date.now()-armed<ARM_MS){done();return;}
     armed=Date.now();button.classList.add('armed');button.textContent='Press again to approve';status.textContent='Press again within 3 seconds to approve.';
     clearTimeout(armTimer);armTimer=setTimeout(()=>{disarm();status.textContent='';},ARM_MS);
   });
   return {label:v=>{label=v;if(!armed)button.textContent=v;}};
 }

 function render(job){
   const slot=$('#answer-actions');slot.replaceChildren();clearInterval(timer);current=null;
   if(job.checked)slot.append(checkedCard(job));
   if(job.action)slot.append(proposalCard(job.action));
   if(job.tool_error&&!job.action){const p=node('p',job.tool_error,'checked-note warn');slot.append(p);}
   if(job.suggest_memory)slot.append(suggestionCard(job.suggest_memory));
   if(job.unchecked&&job.unchecked.length){
     const box=node('section','','unchecked-card');box.setAttribute('aria-label',"What Lin couldn't check");
     box.append(node('span',"What I couldn't check",'eyebrow'));const ul=node('ul');for(const line of job.unchecked)ul.append(node('li',line));box.append(ul);slot.append(box);
   }
   slot.hidden=!slot.children.length;
 }
 document.addEventListener('lin:answer-context',e=>render(e.detail));

 // ---- Save to brain -------------------------------------------------------
 const save=$('#save-answer');let saveJob=null;
 document.addEventListener('lin:job',e=>{
   const j=e.detail;if(!j||j.kind!=='answer')return;
   if(saveJob!==j.id){saveJob=j.id;save.textContent='Save to brain';}
   save.disabled=!(j.status==='complete'&&j.answer);
   if(j.status==='complete'&&j.unchecked&&!$('#answer-actions .unchecked-card'))render(j);
 });
 document.addEventListener('lin:response-cleared',()=>{saveJob=null;save.disabled=true;save.textContent='Save to brain';});
 save.addEventListener('click',async()=>{
   if(!saveJob)return;save.disabled=true;
   try{
     const r=await api('/api/actions/save-answer',{id:saveJob});const slot=$('#answer-actions');
     slot.querySelector('.action-card.state-proposed')?.remove();slot.append(proposalCard(r.action));slot.hidden=false;
     slot.querySelector('.action-card').scrollIntoView({block:'nearest'});save.textContent='Review the note below';refreshActivity();
   }catch(err){save.textContent=err.message.slice(0,60);save.disabled=false;}
 });
 // When Lin speaks the confirmation of a change you just approved, the receipt (with Undo) stays on screen.
 let keepReceipt=null;
 document.addEventListener('lin:response-cleared',()=>{
   clearInterval(timer);current=null;const slot=$('#answer-actions');slot.replaceChildren();slot.hidden=true;
   if(keepReceipt&&Date.now()-keepReceipt.at<3000){slot.append(keepReceipt.node);slot.hidden=false;}
   keepReceipt=null;
 });

 // ---- Activity ----------------------------------------------------------
 async function refreshActivity(){
   if(loading||closed)return;loading=true;
   try{
     const data=await api('/api/actions');activityRevision=data.revision;
     const list=$('#activity-list');list.replaceChildren();
     if(!data.actions.length)list.append(node('p','No actions yet. Ask Lin to add a task or mark one done, and the proposal and receipt will appear here.','empty-plan'));
     for(const a of data.actions){
       const card=node('article','','activity-item state-'+a.state);card.dataset.id=a.id;
       card.append(node('span',`${stateLabel(a)} · ${stamp(a.created_at)}`,'event-time'),node('h3',a.description),node('p',`You asked: “${a.request}”`));
       if(a.note)card.append(node('p',a.note,'warn'));
       if(a.state==='proposed'||a.can_undo){
         const open=node('button',a.state==='proposed'?'Review':'Undo');open.type='button';
         open.addEventListener('click',async()=>{
           if(a.state==='proposed'){document.dispatchEvent(new CustomEvent('lin:view',{detail:'chat'}));const slot=$('#answer-actions');slot.replaceChildren(proposalCard(a));slot.hidden=false;slot.scrollIntoView({block:'center'});return;}
           open.disabled=true;try{await api('/api/actions/undo',{id:a.id});await refreshActivity();$('#activity-status').textContent='Undone.';}catch(err){$('#activity-status').textContent=err.message;open.disabled=false;}
         });
         card.append(open);
       }
       list.append(card);
     }
     $('#activity-status').textContent=`${data.actions.length} recent actions · kept on this computer`;
   }catch(err){$('#activity-status').textContent=err.message;}
   finally{loading=false;}
 }
 $('#view-activity').addEventListener('click',()=>document.dispatchEvent(new CustomEvent('lin:view',{detail:'activity'})));
 $('#refresh-activity').addEventListener('click',refreshActivity);
 document.addEventListener('lin:view',e=>{activeView=e.detail;if(activeView==='activity')refreshActivity();});
 document.addEventListener('lin:actions-status',e=>{
   const revision=e.detail.revision;if(!Number.isInteger(revision)||revision===activityRevision)return;
   if(activeView==='activity')refreshActivity();else activityRevision=null;
   if(current){api('/api/actions').then(d=>{const a=d.actions.find(x=>x.id===current?.id);const box=$('.action-card');if(a&&box&&a.state!==current.state)replace(box,proposalCard(a));}).catch(()=>{});}
 });
 document.addEventListener('lin:work-state',e=>{busy=e.detail.busy;closed=e.detail.closed;});
})();
