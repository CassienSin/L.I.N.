(() => {
 'use strict';
 const $=s=>document.querySelector(s),token=sessionStorage.getItem('lin-session-token')||'';
 const priorities={1:'High',2:'Normal',3:'Low'};
 let data=null,editing=null,busy=false,closed=false,voiceReady=false,mutating=false,loading=false,active=false,dirty=false;
 async function api(path,body){const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'X-Lin-Token':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Local planning is unavailable.');return d;}
 function text(tag,value,className){const n=document.createElement(tag);n.textContent=value;if(className)n.className=className;return n;}
 function controls(){
   for(const id of ['save-task','build-plan'])$('#'+id).disabled=closed||mutating||busy||!data;
   $('#refresh-tasks').disabled=closed||mutating||busy;
   $('#read-plan').disabled=closed||mutating||busy||!voiceReady||dirty||!data?.plan.steps.length;
   $('#task-list').querySelectorAll('button').forEach(b=>b.disabled=closed||mutating||busy);
 }
 function resetEditor(){editing=null;$('#task-form').reset();$('#task-editor-title').textContent='Add a task';$('#save-task').textContent='Add task';$('#cancel-task').hidden=true;}
 function settingsNote(){ $('#plan-settings-note').textContent=dirty?'Settings changed. Build my plan to apply them.':'Breaks count toward your available time.';$('#plan-settings-note').classList.toggle('dirty',dirty);controls(); }
 function render(next,resetPrefs=false){
   if(data&&next.revision<data.revision)return;
   const first=!data;data=next;
   if(first||resetPrefs||!dirty){$('#plan-minutes').value=data.preferences.minutes;$('#plan-break').value=data.preferences.pause;$('#plan-scope').value=data.preferences.scope;dirty=false;}
   const list=$('#task-list');list.replaceChildren();
   if(!data.tasks.length)list.append(text('p','No tasks yet. Add one small, clear task to begin.','empty-plan'));
   for(const task of data.tasks){
     const card=text('article','',`task-item${task.done?' is-done':''}`);card.dataset.id=task.id;
     card.append(text('h3',task.title),text('p',`${task.scope} · ${priorities[task.priority]} priority · ${task.minutes} min${task.done?' · Done':''}`));
     const actions=text('div','','brain-actions');
     for(const [action,label] of [['done',task.done?'Reopen':'Mark done'],['edit','Edit'],['remove','Remove']]){const b=text('button',label);b.type='button';b.dataset.action=action;actions.append(b);}
     card.append(actions);list.append(card);
   }
   const plan=data.plan,steps=$('#plan-steps');steps.replaceChildren();
   $('#plan-total').textContent=`${plan.used} / ${plan.available} MIN`;
   if(!plan.steps.length)steps.append(text('li',plan.deferred.length?'None of these tasks fit. Increase the available time or edit an estimate to plan a smaller piece of work.':'No open tasks in this scope. Add a task, reopen one, or change the scope.','empty-plan'));
   for(const [index,step] of plan.steps.entries()){
     const li=text('li','');li.dataset.id=step.id;
     if(step.break_before)li.append(text('p',`${step.start-step.break_before}–${step.start} min · Take a ${step.break_before}-minute break`,'plan-break'));
     const card=text('div','','plan-step');card.append(text('span',`${step.start}–${step.end} MIN · STEP ${index+1}`,'step-time'),text('strong',step.title),text('small',`${step.minutes} min · ${step.scope} · ${priorities[step.priority]} priority`));li.append(card);steps.append(li);
   }
   $('#plan-free').textContent=`${plan.work} minutes of work + ${plan.breaks} minutes of breaks. ${plan.free} minutes stay free.`;
   const deferred=$('#plan-deferred');deferred.replaceChildren();
   if(plan.deferred.length){deferred.append(text('h3',`${plan.deferred.length} left outside this plan`));for(const task of plan.deferred)deferred.append(text('p',`${task.title} · ${priorities[task.priority]} priority · ${task.reason}`));}
   settingsNote();document.dispatchEvent(new CustomEvent('lin:planner-status',{detail:{revision:data.revision}}));
 }
 async function refresh(){
   if(loading||closed)return;loading=true;
   try{render(await api('/api/planner'));}
   catch(e){$('#planner-status').textContent=e.message;data=null;$('#plan-steps').replaceChildren();$('#plan-deferred').replaceChildren();$('#plan-total').textContent='Unavailable';$('#plan-free').textContent='Refresh to load your current plan.';controls();}
   finally{loading=false;}
 }
 async function change(action,body={},revision=data?.revision){
   if(busy||mutating||closed||!data)return false;mutating=true;controls();
   try{render(await api('/api/planner/'+action,{...body,revision}),action==='plan');$('#planner-status').textContent=action==='plan'?'Plan updated from your saved tasks. No calendar events were created.':action==='remove'?'Task removed from this computer.':'Saved on this computer. Your plan has been updated.';return true;}
   catch(e){$('#planner-status').textContent=e.message+(editing?' Cancel the edit and reopen the task to use its current version.':'');await refresh();return false;}
   finally{mutating=false;controls();}
 }
 $('#view-planner').addEventListener('click',()=>document.dispatchEvent(new CustomEvent('lin:view',{detail:'planner'})));
 document.addEventListener('lin:view',e=>{active=e.detail==='planner';if(active)refresh();});
 document.addEventListener('lin:planner-status',e=>{if(active&&!mutating&&Number.isInteger(e.detail.revision)&&(!data||e.detail.revision>data.revision))refresh();});
 document.addEventListener('lin:work-state',e=>{busy=e.detail.busy;closed=e.detail.closed;voiceReady=e.detail.voiceReady;controls();if(closed)$('#planner-status').textContent='Session closed. Tasks remain saved on this computer.';});
 $('#refresh-tasks').addEventListener('click',refresh);$('#cancel-task').addEventListener('click',resetEditor);
 $('#task-form').addEventListener('submit',async e=>{e.preventDefault();const body={title:$('#task-title').value,scope:$('#task-scope').value,minutes:Number($('#task-minutes').value),priority:Number($('#task-priority').value)};if(editing)body.id=editing.id;if(await change('save',body,editing?.revision??data?.revision))resetEditor();});
 $('#task-list').addEventListener('click',async e=>{
   const b=e.target.closest('button[data-action]');if(!b)return;const task=data?.tasks.find(t=>t.id===b.closest('[data-id]').dataset.id);if(!task)return;
   if(b.dataset.action==='edit'){editing={id:task.id,revision:data.revision};$('#task-title').value=task.title;$('#task-scope').value=task.scope;$('#task-minutes').value=task.minutes;$('#task-priority').value=task.priority;$('#task-editor-title').textContent='Edit task';$('#save-task').textContent='Save changes';$('#cancel-task').hidden=false;$('#task-title').focus();}
   else if(await change(b.dataset.action,{id:task.id,done:!task.done})){if(editing?.id===task.id)resetEditor();}
 });
 $('#plan-form').addEventListener('input',()=>{dirty=true;settingsNote();});
 $('#plan-form').addEventListener('submit',async e=>{e.preventDefault();await change('plan',{minutes:Number($('#plan-minutes').value),pause:Number($('#plan-break').value),scope:$('#plan-scope').value});});
 $('#read-plan').addEventListener('click',()=>{if(!$('#read-plan').disabled)document.dispatchEvent(new CustomEvent('lin:speak-plan',{detail:{revision:data.revision}}));});
 refresh().then(()=>{if(data)$('#planner-status').textContent='Tasks and planning settings stay on this computer.';});
})();
