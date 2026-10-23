// Sends sample requests to the running Lin and records which tool the local model chose,
// the answer, whether it passed verification, and latency. Proposals it creates are declined.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(process.env.LIN_ROOT||path.join(__dirname,'..'));
const session=JSON.parse(fs.readFileSync(path.join(root,'voice/runtime/session.json'),'utf8')),url=new URL(session.url),base=url.origin;
const headers={'X-Lin-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
async function idle(){for(let i=0;i<480;i++){const s=await api('/api/status');if(s.ready&&!s.busy&&s.reasoning.ready&&!s.reasoning.busy)return;await delay(500);}throw Error('Lin did not become idle');}
const cases=[
 ['Am I free this afternoon?','free_time'],['What do I have on tomorrow?','agenda'],['Which business tasks are still open?','tasks'],
 ['What did I write about suppliers?','notes'],['What is in my focus plan?','plan'],['Please put buying printer ink on my to-do list','add_task'],
 ['The printer ink task is finished','complete_task'],['Should I go to the gym this afternoon?','free_time'],['Is tomorrow morning a good time for a client call?','free_time'],['Write a two line thank you message for a client','none'],['Give me one tip for staying focused today','none'],
];
async function withCalendar(){
  const today=await api('/api/today');if(today.source)return null; // never replace a real import
  const d=today.date.replaceAll('-',''),t=new Date(today.date+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+1);const n=t.toISOString().slice(0,10).replaceAll('-','');
  const ev=(uid,day,a,b,title)=>`BEGIN:VEVENT\r\nUID:probe-${uid}\r\nDTSTART;TZID=Asia/Manila:${day}T${a}00\r\nDTEND;TZID=Asia/Manila:${day}T${b}00\r\nSUMMARY:${title}\r\nEND:VEVENT\r\n`;
  const ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Lin probe//EN\r\n'+ev('a',d,'1700','1800','Probe design review')+ev('b',d,'1830','1900','Probe supplier call')+ev('c',n,'0900','1000','Probe client call')+ev('d',n,'1400','1500','Probe team sync')+'END:VCALENDAR\r\n';
  const r=await fetch(base+'/api/calendar/preview',{method:'POST',headers:{...headers,'Content-Type':'text/calendar','X-Lin-Filename':'probe-calendar.ics'},body:ics});const preview=await r.json();if(!r.ok)throw Error(preview.error);
  await api('/api/calendar/commit',{id:preview.id,revision:preview.revision});return 'probe-calendar.ics';
}
(async()=>{
  const rows=[];await idle();const imported=await withCalendar();
  for(const [text,expected] of cases){
    await idle();const conversation=crypto.randomBytes(16).toString('hex');const started=Date.now();const {id}=await api('/api/ask',{text,conversation,mode:'chat'});let job;
    for(;;){job=await api('/api/jobs/'+id);if(job.texts.length||['error','cancelled'].includes(job.status))break;await delay(150);}
    const seconds=(Date.now()-started)/1000;
    for(let i=0;i<600&&job.streaming;i++){await delay(150);job=await api('/api/jobs/'+id);}
    const generated=(Date.now()-started)/1000;
    await api(`/api/jobs/${id}/cancel`,{}).catch(()=>{});
    const chosen=job.decision?.tool||'none';
    rows.push({request:text,expected,chosen,match:chosen===expected,via:job.decision?.source||'chat',args:job.decision?.args||null,
      answer:job.answer,verification:job.verification||null,proposal:job.action?.description||null,error:job.error||job.tool_error||null,seconds,generation_complete_seconds:generated,timings:job.timings||null});
    if(job.action?.state==='proposed')await api('/api/actions/reject',{id:job.action.id}).catch(()=>{});
    await api('/api/conversation/clear',{conversation}).catch(()=>{});
    console.log(`${rows.at(-1).match?'OK  ':'MISS'} ${chosen.padEnd(13)} ${(rows.at(-1).via).padEnd(5)} first ${seconds.toFixed(1)}s / all ${generated.toFixed(1)}s  ${rows.at(-1).verification||''}  ${text}`);
  }
  if(imported){await idle();const t=await api('/api/today');if(t.source?.name===imported)await api('/api/calendar/forget',{revision:t.calendar_revision});}
  const out={date:new Date().toISOString(),test_calendar:!!imported,matched:rows.filter(r=>r.match).length,total:rows.length,median_seconds:rows.map(r=>r.seconds).sort((a,b)=>a-b)[Math.floor(rows.length/2)],rows};
  fs.writeFileSync(path.join(root,'voice/brain-benchmark/routing-results.json'),JSON.stringify(out,null,2));
  console.log(`Routing matched ${out.matched}/${out.total}`);
})().catch(e=>{console.error(e);process.exitCode=1});
