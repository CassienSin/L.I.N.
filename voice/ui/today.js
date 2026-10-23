(() => {
 'use strict';
 const $=s=>document.querySelector(s),token=sessionStorage.getItem('lin-session-token')||'';
 let data=null,preview=null,active=false,busy=false,closed=false,ready=false,working=false,loading=false,lastAsOf='';
 const format=(iso,options)=>new Date(iso).toLocaleString('en-PH',{timeZone:'Asia/Manila',...options});
 const day=iso=>format(iso,{month:'short',day:'numeric',year:'numeric'}),hour=iso=>format(iso,{hour:'numeric',minute:'2-digit'});
 function node(tag,value,className){const n=document.createElement(tag);n.textContent=value;if(className)n.className=className;return n;}
 async function api(path,body){const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'X-Lin-Token':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'The local briefing is unavailable.');return d;}
 function controls(){
   $('#hear-today').disabled=closed||busy||working||!ready||!data;
   $('#preview-calendar').disabled=closed||working||busy;
   $('#save-calendar').disabled=closed||working||busy||!preview;
   $('#forget-calendar').disabled=closed||working||busy||!data?.source;
   $('#cancel-calendar').disabled=closed||working;$('#refresh-today').disabled=closed||working;
 }
 function eventCard(event,showDate=false){
   const card=node('article','',`agenda-item ${(event.status||'').toLowerCase()}`);card.dataset.id=event.id;
   const crossDay=day(event.start)!==day(event.end);
   const dateLabel=event.all_day?`All day · ${day(event.start)}${new Date(event.end)-new Date(event.start)>86400000?'–'+day(new Date(new Date(event.end)-86400000).toISOString()):''}`:`${showDate||crossDay?day(event.start)+' · ':''}${hour(event.start)}–${hour(event.end)}${crossDay?' ('+day(event.end)+')':''}`;
   card.append(node('span',dateLabel,'event-time'),node('h3',event.title));
   if(event.status||event.tentative)card.append(node('p',[event.status,event.tentative?'Tentative':null].filter(Boolean).join(' · ')));
   if(event.location)card.append(node('p',event.location));return card;
 }
 function render(next){
   if(next.generated_at<lastAsOf)return;lastAsOf=next.generated_at;data=next;
   $('#today-date').textContent=`${format(data.generated_at,{weekday:'long',month:'long',day:'numeric',year:'numeric'})} · Asia/Manila`;
   $('#today-summary').textContent=data.summary;
   $('#today-event-count').textContent=data.source?data.covered?`${data.events.length} EVENTS`:'OUT OF RANGE':'NO IMPORT';
   $('#today-source').textContent=data.source?`${data.source.name} · imported ${format(data.source.imported_at,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}. Coverage ends ${day(data.source.coverage_end)} at midnight.`:'Choose a calendar export below when you are ready.';
   $('#today-warning').textContent=!data.source?'No calendar connected. Lin cannot infer your availability.':!data.covered?'This snapshot does not cover today. Import a fresh calendar export.':data.stale?'Imported over 24 hours ago. Changes made in your calendar app are not reflected here.':'Imported snapshot, not a live calendar. Reimport to include changes from your calendar app.';
   const events=$('#today-events');events.replaceChildren();for(const event of data.events)events.append(eventCard(event));
   if(data.covered&&!data.events.length)events.append(node('p','No events for today in this imported snapshot.','empty-plan'));
   $('#today-task-count').textContent=`${data.open_tasks} open tasks · ${data.high_priority} high priority`;
   const tasks=$('#today-task-list');tasks.replaceChildren();
   for(const task of data.top_tasks){const card=node('article','','brief-task');card.append(node('h3',task.title),node('p',`${task.scope} · ${task.minutes} min · ${['','High','Normal','Low'][task.priority]} priority`));tasks.append(card);}
   if(!data.top_tasks.length)tasks.append(node('p','No open tasks saved. Add your next step in Plan my day.','empty-plan'));
   $('#today-plan').textContent=`Your focus plan: ${data.plan.used} / ${data.plan.available} minutes. ${data.plan.deferred} tasks did not fit. Calendar events have not been deducted from this budget.`;
   controls();document.dispatchEvent(new CustomEvent('lin:today-status',{detail:{revision:data.revision,asof:data.generated_at}}));
 }
 async function refresh(){
   if(loading||closed)return;loading=true;
   try{render(await api('/api/today'));}
   catch(e){data=null;$('#today-summary').textContent=e.message;$('#today-events').replaceChildren();$('#today-task-list').replaceChildren();$('#today-plan').textContent='Refresh to load current information.';controls();}
   finally{loading=false;}
 }
 $('#view-today').addEventListener('click',()=>document.dispatchEvent(new CustomEvent('lin:view',{detail:'today'})));
 document.addEventListener('lin:view',e=>{active=e.detail==='today';if(active)refresh();});
 document.addEventListener('lin:today-status',e=>{if(active&&e.detail.asof>=lastAsOf&&(!data||e.detail.revision!==data.revision))refresh();});
 document.addEventListener('lin:work-state',e=>{busy=e.detail.busy;closed=e.detail.closed;ready=e.detail.voiceReady;controls();});
 $('#refresh-today').addEventListener('click',refresh);$('#today-open-plan').addEventListener('click',()=>$('#view-planner').click());
 $('#hear-today').addEventListener('click',()=>{if(!$('#hear-today').disabled)document.dispatchEvent(new CustomEvent('lin:speak-briefing',{detail:{revision:data.revision}}));});
 $('#calendar-file').addEventListener('change',()=>{
   const previous=preview;preview=null;$('#calendar-preview').hidden=true;controls();
   if(previous&&!closed)api('/api/calendar/discard',{id:previous.id}).catch(()=>{});
 });
 $('#preview-calendar').addEventListener('click',async()=>{
   const file=$('#calendar-file').files[0];if(!file){$('#calendar-status').textContent='Choose an .ics file first.';return;}
   if(!file.name.toLowerCase().endsWith('.ics')||file.size>256*1024||!file.size){$('#calendar-status').textContent='Choose a nonempty .ics export up to 256 KB.';return;}
   working=true;controls();$('#calendar-status').textContent='Reading the calendar on this computer…';
   try{
     const response=await fetch('/api/calendar/preview',{method:'POST',headers:{'X-Lin-Token':token,'Content-Type':'text/calendar','X-Lin-Filename':encodeURIComponent(file.name)},body:await file.arrayBuffer()});
     const result=await response.json();if(!response.ok)throw Error(result.error||'Calendar preview failed.');preview=result;
     const cal=preview.calendar;$('#preview-description').textContent=`${cal.name} · ${cal.events.length} occurrences from ${day(cal.coverage_start)} until ${day(cal.coverage_end)} at midnight. Times in Asia/Manila.${cal.floating?' Unzoned times were interpreted as Manila time.':''}`;
     const list=$('#preview-events');list.replaceChildren();for(const event of cal.events)list.append(eventCard(event,true));if(!cal.events.length)list.append(node('p','No events in the next 30 days. Saving will replace the previous calendar with this empty snapshot.'));
     $('#calendar-preview').hidden=false;$('#calendar-status').textContent='Preview ready. Review it before saving. Your saved calendar has not changed.';
   }catch(e){$('#calendar-status').textContent=e.message;}
   finally{working=false;controls();}
 });
 $('#save-calendar').addEventListener('click',async()=>{
   if(!preview||working||busy||closed)return;working=true;controls();
   try{render(await api('/api/calendar/commit',{id:preview.id,revision:preview.revision}));preview=null;$('#calendar-preview').hidden=true;$('#calendar-file').value='';$('#calendar-status').textContent='Calendar snapshot saved on this computer. Reimport an updated export when your schedule changes.';}
   catch(e){$('#calendar-status').textContent=e.message;await refresh();}
   finally{working=false;controls();}
 });
 $('#cancel-calendar').addEventListener('click',async()=>{
   if(!preview||working)return;working=true;controls();try{await api('/api/calendar/discard',{id:preview.id});preview=null;$('#calendar-preview').hidden=true;$('#calendar-status').textContent='Preview discarded. Your saved calendar is unchanged.';}catch(e){$('#calendar-status').textContent=e.message;}finally{working=false;controls();}
 });
 $('#forget-calendar').addEventListener('click',async()=>{
   if(!data||working||busy||closed)return;working=true;controls();try{render(await api('/api/calendar/forget',{revision:data.calendar_revision}));preview=null;$('#calendar-preview').hidden=true;$('#calendar-status').textContent='Saved calendar removed. Your original file and calendar app are unchanged.';}catch(e){$('#calendar-status').textContent=e.message;await refresh();}finally{working=false;controls();}
 });
 refresh();
})();
