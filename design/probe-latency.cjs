// Measures each stage of a spoken answer on the running Lin: routing, first sentence, first audio ready.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(process.env.LIN_ROOT||path.join(__dirname,'..'));
const session=JSON.parse(fs.readFileSync(path.join(root,'voice/runtime/session.json'),'utf8')),url=new URL(session.url),base=url.origin;
const headers={'X-Lin-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
async function idle(){for(let i=0;i<480;i++){const s=await api('/api/status');if(s.ready&&!s.busy&&s.reasoning.ready&&!s.reasoning.busy)return;await delay(300);}throw Error('Lin did not become idle');}
const shared=process.argv.includes('--same-conversation');let conversation=null;
const args=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const questions=args.length?args:shared?['What tasks are left?','Add a task to buy bond paper','What is on my calendar tomorrow?','I have 30 minutes to prepare a client proposal and tidy my desk. Help me choose what to do first.','Give me one tip for staying focused.']:[
 'I have 30 minutes to prepare a client proposal and tidy my desk. Help me choose what to do first.',
 'I have 30 minutes to prepare a client proposal and tidy my desk. Help me choose what to do first.',
 'Give me one tip for staying focused.',
 'Should I go to the gym this afternoon?'];
(async()=>{
  const rows=[];
  for(const text of questions){
    await idle();if(!shared||!conversation)conversation=crypto.randomBytes(16).toString('hex');const t0=Date.now();
    const {id}=await api('/api/ask',{text,conversation,mode:'chat'});let job,firstText=null,firstAudio=null;
    for(let i=0;i<2000;i++){job=await api('/api/jobs/'+id);
      if(firstText===null&&job.texts.length)firstText=(Date.now()-t0)/1000;
      if(firstAudio===null&&job.segments.length)firstAudio=(Date.now()-t0)/1000;
      if(['complete','error','cancelled'].includes(job.status))break;await delay(100);}
    rows.push({text,route:job.decision?.tool||'chat',first_text_s:firstText,first_audio_ready_s:firstAudio,total_s:(Date.now()-t0)/1000,
      server_first_text_s:job.first_text_seconds,segments:job.segments.map(s=>({ready_after_s:s.ready_after_seconds,gen_s:s.generation_seconds,audio_s:s.audio_seconds})),timings:job.timings,answer:job.answer});
    console.log(JSON.stringify(rows.at(-1)));
    if(job.action?.state==='proposed')await api('/api/actions/reject',{id:job.action.id}).catch(()=>{});
    if(!shared)await api('/api/conversation/clear',{conversation}).catch(()=>{});
  }
  if(shared)await api('/api/conversation/clear',{conversation}).catch(()=>{});
  fs.writeFileSync(path.join(root,'voice/brain-benchmark/'+(shared?'latency-conversation-results.json':'latency-results.json')),JSON.stringify({date:new Date().toISOString(),rows},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
