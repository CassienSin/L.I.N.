(() => {
 'use strict';
 // Approval cards, checked-source cards and the Activity receipt list.
 // Nothing here changes data without an explicit click on Approve or Undo.
 const $=s=>document.querySelector(s),token=sessionStorage.getItem('lin-session-token')||'';
 let busy=false,closed=false,activityRevision=null,activeView='chat',loading=false,current=null,timer=0;
 const STATE={proposed:'Waiting for your approval',executed:'Done',rejected:'Declined',expired:'Expired · nothing changed',failed:'Not made',unknown:'Unconfirmed',undone:'Undone',executing:'Working…'};
 function node(tag,text,className){const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=text;if(className)n.className=className;return n;}
 async function api(path,body){
   const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'X-Lin-Token':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
   const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Lin could not reach the local action service.');return d;
 }
 function stamp(iso){return iso?new Date(iso).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';}

 // ---- Checked sources --------------------------------------------------
 function checkedCard(job){
   const c=job.checked,box=node('section','','checked-card');box.setAttribute('aria-label','Checked sources');
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

 // ---- Approval card -----------------------------------------------------
 function field(label,input){const wrap=node('label','','action-field');wrap.append(node('span',label),input);return wrap;}
 function select(options,value){const s=document.createElement('select');for(const [v,l] of options){const o=node('option',l);o.value=v;s.append(o);}s.value=value;return s;}
 function proposalCard(action){
   current=action;clearInterval(timer);
   const box=node('section','','action-card state-'+action.state);box.dataset.id=action.id;box.setAttribute('aria-label','Proposed change');
   const head=node('div','','checked-head');head.append(node('span',action.state==='proposed'?'Waiting for your approval':'Receipt','eyebrow'),node('span',STATE[action.state]||action.state,'action-state'));box.append(head);
   box.append(node('p',action.description,'action-description'));
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
     const approve=node('button','Approve','primary'),reject=node('button','Decline');approve.type=reject.type='button';
     const sync=()=>{approve.textContent=edited()?'Update details':'Approve';};
     if(inputs)Object.values(inputs).forEach(i=>i.addEventListener('input',sync));
     approve.addEventListener('click',async()=>{
       approve.disabled=reject.disabled=true;
       try{
         if(edited()){
           const fields=Object.fromEntries(Object.entries(inputs).map(([k,i])=>[k,value(k,i)]));
           const r=await api('/api/actions/revise',{id:action.id,fields});replace(box,proposalCard(r.action));
           $('.action-card .action-status').textContent='Details updated. Review them, then press Approve.';return;
         }
         if(action.tool==='save_note')window.linOwnBrainWrite=Date.now();
         const r=await api('/api/actions/approve',{id:action.id,hash:action.hash});replace(box,proposalCard(r.action));
         if(r.message){$('.action-card .action-status').textContent=r.message;if(r.action.state==='executed')document.dispatchEvent(new CustomEvent('lin:say',{detail:{text:r.message}}));}
         refreshActivity();
       }catch(err){status.textContent=err.message;approve.disabled=reject.disabled=false;refreshActivity();}
     });
     reject.addEventListener('click',async()=>{approve.disabled=reject.disabled=true;try{const r=await api('/api/actions/reject',{id:action.id});replace(box,proposalCard(r.action));refreshActivity();}catch(err){status.textContent=err.message;approve.disabled=reject.disabled=false;}});
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
   box.append(node('p',action.state==='proposed'?(action.tool==='mcp'?'Nothing runs until you approve.':'Nothing changes until you approve. Editing a detail requires approving again.'):`Receipt · ${STATE[action.state]||action.state} ${stamp(action.decided_at)}`,'checked-foot'));
   return box;
 }
 function replace(oldNode,newNode){oldNode.replaceWith(newNode);}

 function render(job){
   const slot=$('#answer-actions');slot.replaceChildren();clearInterval(timer);current=null;
   if(job.checked)slot.append(checkedCard(job));
   if(job.action)slot.append(proposalCard(job.action));
   if(job.tool_error&&!job.action){const p=node('p',job.tool_error,'checked-note warn');slot.append(p);}
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
 document.addEventListener('lin:response-cleared',()=>{clearInterval(timer);current=null;$('#answer-actions').replaceChildren();$('#answer-actions').hidden=true;});

 // ---- Activity ----------------------------------------------------------
 async function refreshActivity(){
   if(loading||closed)return;loading=true;
   try{
     const data=await api('/api/actions');activityRevision=data.revision;
     const list=$('#activity-list');list.replaceChildren();
     if(!data.actions.length)list.append(node('p','No actions yet. Ask Lin to add a task or mark one done, and the proposal and receipt will appear here.','empty-plan'));
     for(const a of data.actions){
       const card=node('article','','activity-item state-'+a.state);card.dataset.id=a.id;
       card.append(node('span',`${STATE[a.state]||a.state} · ${stamp(a.created_at)}`,'event-time'),node('h3',a.description),node('p',`You asked: “${a.request}”`));
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
