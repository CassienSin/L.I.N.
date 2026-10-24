(() => {
 'use strict';
 const $=s=>document.querySelector(s),token=sessionStorage.getItem('lin-session-token')||'';
 let memories=[],connected=true,editing=null,busy=false,mutating=false,closed=false,proposalJob=null,revision=null;
 async function api(path,body){
   const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'X-Lin-Token':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Local memory is unavailable.');return result;
 }
 function view(brain){
   document.dispatchEvent(new CustomEvent('lin:view',{detail:brain?'brain':'chat'}));
 }
 document.addEventListener('lin:view',e=>{
   for(const name of ['brain','planner','today','activity','tools','settings']){
     $('#'+name+'-workspace').hidden=e.detail!==name;
   }
   $('#view-chat').setAttribute('aria-pressed',String(!['brain','planner','today','activity','tools','settings'].includes(e.detail)));
 });
 function controls(){
   ['save-memory','open-brain-folder','refresh-brain','connect-brain'].forEach(id=>$('#'+id).disabled=busy||mutating||closed);
   $('#memory-list').querySelectorAll('button[data-action]').forEach(b=>b.disabled=closed||((busy||mutating)&&b.dataset.action!=='history'));
 }
 function documentsLine(d){
   if(!d)return '';
   const parts=[];
   if(d.read)parts.push(`${d.read} document${d.read===1?'':'s'} read`);
   if(d.waiting)parts.push(d.reader==='not installed'?`${d.waiting} waiting for the document readers (run design/Install-DocReaders.cmd)`:`reading ${d.waiting} more${d.reading?` (now ${d.reading})`:''}`);
   if(d.empty)parts.push(`${d.empty} with no text in them`);
   if(d.failed+d.old)parts.push(`${d.failed+d.old} Lin could not read`);
   return parts.length?' '+parts.join(' · ')+'.':'';
 }
 function status(s){
   if(!s)return;
   if(revision!==null&&s.revision<revision)return;
   connected=s.connected;$('#folder-path').textContent=s.folder;
   $('#connect-brain').textContent=connected?'Disconnect folder':'Reconnect folder';
   $('#brain-status').textContent=(connected?`${s.files} files · ${s.passages} passages · ${s.memories} saved memories.`:'Folder disconnected. Saved memories remain available.')+(connected?documentsLine(s.documents):'')+(s.warning?' '+s.warning:'')+(s.skipped?` ${s.skipped} files or oversized lines skipped.`:'');
   const problems=$('#brain-problems'),list=connected&&s.documents?s.documents.problems||[]:[];
   problems.replaceChildren(...list.map(p=>{const li=document.createElement('li'),b=document.createElement('b');b.textContent=p.path;li.append(b,' — '+p.note);return li;}));
   problems.hidden=!list.length;
   if(revision!==null&&revision!==s.revision){
     document.dispatchEvent(new CustomEvent('lin:knowledge-changed',{detail:{revision:s.revision}}));
     refresh().catch(()=>{});
   }
   revision=s.revision;
 }
 function resetEditor(){
   editing=null;$('#memory-form').reset();$('#save-memory').textContent='Save memory';$('#cancel-memory-edit').hidden=true;
 }
 function render(){
   const list=$('#memory-list');list.replaceChildren();
   if(!memories.length){const p=document.createElement('p');p.className='empty-memory';p.textContent='No saved memories yet. Add one fact above, or say “Remember this: …” in the conversation.';list.append(p);}
   for(const memory of memories){
     const card=document.createElement('article');card.className='memory-item';card.dataset.id=memory.id;
     const title=document.createElement('h3');title.textContent=memory.title;
     const meta=document.createElement('p');meta.className='small-note';meta.textContent=`${memory.scope} · revision ${memory.revision} · saved ${new Date(memory.updated_at).toLocaleString()}`;
     const fact=document.createElement('p');fact.textContent=memory.fact;
     const actions=document.createElement('div');actions.className='brain-actions';
     for(const [action,label] of [['edit','Edit'],['history','History'],['forget','Forget']]){const b=document.createElement('button');b.type='button';b.dataset.action=action;b.textContent=label;actions.append(b);}
     card.append(title,meta,fact,actions);list.append(card);
   }
   controls();
 }
 async function refresh(){const data=await api('/api/brain');memories=data.memories;render();status(data.status);return data;}
 async function mutation(path,body,message){
   if(busy||mutating||closed)return;
   mutating=true;controls();
   try{const data=await api(path,body);await refresh();$('#memory-status').textContent=message;return data;}
   catch(error){$('#memory-status').textContent=error.message;throw error;}
   finally{mutating=false;controls();}
 }
 $('#view-chat').addEventListener('click',()=>view(false));$('#view-brain').addEventListener('click',()=>{view(true);refresh().catch(e=>$('#memory-status').textContent=e.message);});
 $('#interrupt-anywhere').addEventListener('click',()=>document.dispatchEvent(new Event('lin:interrupt')));
 $('#search-brain').addEventListener('click',()=>{view(false);$('#request-mode').value='brain';$('#request-input').focus();});
 $('#reload-memories').addEventListener('click',()=>refresh().catch(e=>$('#memory-status').textContent=e.message));
 $('#cancel-memory-edit').addEventListener('click',resetEditor);
 $('#memory-form').addEventListener('submit',async e=>{
   e.preventDefault();
   const body={title:$('#memory-title').value,fact:$('#memory-fact').value,scope:$('#memory-scope').value};
   if(editing){body.id=editing.id;body.revision=editing.revision;}
   try{const result=await mutation('/api/memories/save',body,'Saved on this computer. This fact will be available after restarting Lin.');if(result)resetEditor();}catch{}
 });
 $('#memory-list').addEventListener('click',async e=>{
   const button=e.target.closest('button[data-action]');if(!button)return;
   const memory=memories.find(m=>m.id===button.closest('[data-id]').dataset.id);if(!memory)return;
   if(button.dataset.action==='edit'){
     editing={...memory};$('#memory-title').value=memory.title;$('#memory-fact').value=memory.fact;$('#memory-scope').value=memory.scope;
     $('#save-memory').textContent='Save correction';$('#cancel-memory-edit').hidden=false;$('#memory-title').focus();
     $('#memory-status').textContent='Editing the current fact. Save correction when ready.';
   }else if(button.dataset.action==='forget'){
     try{const result=await mutation('/api/memories/forget',{id:memory.id,revision:memory.revision},'Forgotten. The fact and its edit history are removed from Lin’s memory.');if(result&&editing?.id===memory.id)resetEditor();}catch{}
   }else{
     try{
       const data=await api(`/api/memories/${memory.id}/history`);
       $('#source-title').textContent=memory.title+' · edit history';$('#source-meta').textContent='Previous versions are shown here only. They are excluded from answers.';
       const content=$('#source-content');content.replaceChildren();
       if(!data.history.length){const p=document.createElement('p');p.textContent='No earlier versions.';content.append(p);}
       for(const row of data.history){const p=document.createElement('p');p.textContent=`Revision ${row.revision} · ${row.scope} · ${row.title}\n${row.fact}`;content.append(p);}
       $('#source-dialog').showModal();
     }catch(error){$('#memory-status').textContent=error.message;}
   }
 });
 $('#connect-brain').addEventListener('click',()=>mutation('/api/brain/connect',{connected:!connected},connected?'Folder disconnected. Files remain untouched.':'Folder reconnected.').catch(()=>{}));
 $('#refresh-brain').addEventListener('click',()=>mutation('/api/brain/refresh',{},'Notes refreshed from disk.').catch(()=>{}));
 $('#open-brain-folder').addEventListener('click',async()=>{try{await api('/api/brain/open-folder',{});$('#brain-status').textContent='Opened the dedicated Lin Brain folder.';}catch(e){$('#brain-status').textContent=e.message;}});
 $('#close-source').addEventListener('click',()=>$('#source-dialog').close());
 document.addEventListener('lin:brain-status',e=>status(e.detail));
 document.addEventListener('lin:work-state',e=>{busy=e.detail.busy;closed=e.detail.closed;controls();});
 document.addEventListener('lin:answer-context',e=>{
   const job=e.detail,list=$('#answer-sources');list.replaceChildren();list.hidden=!job.sources?.length;
   if(job.sources?.length){
     const title=document.createElement('h3');title.textContent=job.mode==='brain'?'Matching passages':'Saved facts supplied to Lin';list.append(title);
     for(const source of job.sources){
       const b=document.createElement('button');b.className='source-reference';b.type='button';b.textContent=source.kind==='file'?`${source.title} · ${source.where||`lines ${source.line_start}–${source.line_end}`}`:`${source.title} · ${source.scope} memory`;
       b.addEventListener('click',async()=>{try{
         const current=await api('/api/sources/'+source.id);
         $('#source-title').textContent=current.title;
         $('#source-meta').textContent=current.kind==='file'?`${current.path} · ${current.where||`lines ${current.line_start}–${current.line_end}`}${current.document?' · read from '+current.document:''}`:`Saved explicitly by you · ${current.scope} · revision ${current.revision}`;
         const quote=document.createElement('pre');quote.textContent=current.body;$('#source-content').replaceChildren(quote);$('#source-dialog').showModal();
       }catch(error){b.textContent=error.message;b.disabled=true;}});
       list.append(b);
     }
   }
   if(job.proposal&&proposalJob!==job.id){
     proposalJob=job.id;resetEditor();$('#memory-title').value=job.proposal.title;$('#memory-fact').value=job.proposal.fact;$('#memory-scope').value=job.proposal.scope;
     $('#memory-status').textContent='Prepared from your request. Review the exact fact and scope. Nothing has been saved yet.';view(true);
   }
 });
 document.addEventListener('lin:response-cleared',()=>{$('#answer-sources').replaceChildren();$('#answer-sources').hidden=true;$('#source-dialog').close();});
 refresh().catch(error=>{$('#memory-status').textContent=error.message;});
})();
