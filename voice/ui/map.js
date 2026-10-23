(() => {
 'use strict';
 const $=s=>document.querySelector(s),svg=$('#brain-map'),camera=$('#map-camera');
 const token=sessionStorage.getItem('lin-session-token')||'',NS='http://www.w3.org/2000/svg';
 const groups={notes:{title:'Notes',color:'#79dce0',x:230,y:240},personal:{title:'Personal',color:'#b1a0ec',x:750,y:220},business:{title:'Business',color:'#e6bb74',x:650,y:540}};
 let data=null,visible=[],selected=null,version=-1,loading=false,active=false,selectionRequest=0,closed=false;
 let cameraState={x:0,y:0,k:1},bounds={x:0,y:0,w:1000,h:700},drag=null;
 async function api(path){const r=await fetch(path,{headers:{'X-Lin-Token':token}});const d=await r.json();if(!r.ok)throw Error(d.error||'The local map is unavailable.');return d;}
 function el(tag,attrs={},text){const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;}
 function transform(){camera.setAttribute('transform',`translate(${cameraState.x} ${cameraState.y}) scale(${cameraState.k})`);}
 function fit(){cameraState.k=Math.min(1.5,900/bounds.w,590/bounds.h);cameraState.x=500-(bounds.x+bounds.w/2)*cameraState.k;cameraState.y=350-(bounds.y+bounds.h/2)*cameraState.k;transform();}
 function zoom(factor,p={x:500,y:350}){const old=cameraState.k,next=Math.max(.12,Math.min(5,old*factor));cameraState.x=p.x-(p.x-cameraState.x)*next/old;cameraState.y=p.y-(p.y-cameraState.y)*next/old;cameraState.k=next;transform();}
 function point(e){return new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());}
 function clearInspector(message='Choose a note or memory to see what Lin actually knows.'){
   selectionRequest++;$('#map-title').textContent='A little space to grow.';$('#map-meta').textContent=message;$('#map-content').textContent='';$('#map-passage').hidden=true;$('label[for="map-passage"]').hidden=true;
 }
 function highlight(){camera.querySelectorAll('[data-id]').forEach(n=>n.classList.toggle('selected',n.dataset.id===selected));$('#map-list').querySelectorAll('button').forEach(n=>n.setAttribute('aria-pressed',String(n.dataset.id===selected)));}
 async function showSource(node,sid){
   const request=++selectionRequest;$('#map-content').textContent='Loading source…';
   try{const source=await api('/api/sources/'+sid);if(request!==selectionRequest||selected!==node.id)return;
     $('#map-meta').textContent=source.kind==='file'?`${source.path} · ${source.where||`lines ${source.line_start}–${source.line_end}`}${source.document?' · read from '+source.document:''}`:`${groups[source.scope].title} memory · revision ${source.revision} · saved explicitly by you`;
     $('#map-content').textContent=source.body;
   }catch(e){if(request===selectionRequest){$('#map-content').textContent='';$('#map-meta').textContent=e.message;}}
 }
 function select(node){
   selected=node.id;clearInspector();highlight();$('#map-title').textContent=node.title;
   const select=$('#map-passage');select.replaceChildren();
   if(node.kind==='file'){
     for(const p of node.passages){const option=document.createElement('option');option.value=p.id;option.textContent=p.where?p.where[0].toUpperCase()+p.where.slice(1):`Lines ${p.start}–${p.end}`;select.append(option);}
     select.hidden=node.passages.length<2;$('label[for="map-passage"]').hidden=select.hidden;
     showSource(node,select.value);
   }else showSource(node,node.source_id);
 }
 function draw(resetCamera=false){
   if(!data)return;
   const query=$('#map-search').value.trim().toLocaleLowerCase(),filter=$('#map-filter').value;
   visible=data.nodes.filter(n=>(filter==='all'||n.group===filter)&&n.title.toLocaleLowerCase().includes(query));
   if(selected&&!visible.some(n=>n.id===selected)){selected=null;clearInspector('This item is outside the current view. Select another item.');}
   camera.replaceChildren();const positions=new Map(),points=[{x:490,y:350}];
   const largest=Math.max(0,...Object.keys(groups).map(key=>visible.filter(n=>n.group===key).length));
   const spread=Math.max(280,(58+Math.sqrt(largest)*27)*2.1);
   const layout=Object.fromEntries(Object.entries(groups).map(([key,g],i)=>{const a=[-160,-40,70][i]*Math.PI/180;return [key,{...g,x:490+Math.cos(a)*spread,y:350+Math.sin(a)*spread}];}));
   const branches=Object.entries(layout).filter(([key])=>filter==='all'||filter===key);
   svg.classList.toggle('dense',visible.length>35);
   for(const [key,g] of branches){
     const items=visible.filter(n=>n.group===key),radius=Math.max(95,Math.sqrt(items.length)*27);
     // Deterministic sunflower placement; zero force simulation or idle animation.
     items.forEach((n,i)=>{const angle=i*2.39996323,r=58+radius*Math.sqrt((i+.5)/Math.max(items.length,1));positions.set(n.id,{x:g.x+Math.cos(angle)*r,y:g.y+Math.sin(angle)*r});});
     points.push(g);camera.append(el('line',{x1:490,y1:350,x2:g.x,y2:g.y,class:'map-edge'}));
   }
   for(const edge of data.edges){const p=positions.get(edge.to),g=layout[edge.from.replace('group-','')];if(p&&g)camera.append(el('line',{x1:g.x,y1:g.y,x2:p.x,y2:p.y,class:'map-edge'}));}
   const root=el('g',{class:'map-root',transform:'translate(490 350)','aria-hidden':'true'});
   root.append(el('circle',{r:53,fill:'url(#map-glow)',stroke:'#5babb9'}),el('circle',{r:63,class:'root-orbit'}),el('text',{'text-anchor':'middle',x:3,y:8},'LIN'));camera.append(root);
   for(const [key,g] of branches){
     const count=visible.filter(n=>n.group===key).length,hub=el('g',{class:'map-hub',transform:`translate(${g.x} ${g.y})`,'aria-hidden':'true'});
     hub.append(el('circle',{r:25,fill:g.color,'fill-opacity':'.18',stroke:g.color}),el('text',{'text-anchor':'middle',y:5,fill:g.color},String(count)),el('text',{'text-anchor':'middle',y:48,fill:g.color},g.title));camera.append(hub);
   }
   for(const node of visible){
     const p=positions.get(node.id);points.push(p);
     const n=el('g',{class:'map-node',transform:`translate(${p.x} ${p.y})`,role:'button',tabindex:'0','aria-label':`${node.title}, ${groups[node.group].title}`,'data-id':node.id});
     const label=node.title.length>25?node.title.slice(0,23)+'…':node.title;
     n.append(el('title',{},node.title),el('rect',{x:-20,y:-20,width:visible.length>35?40:label.length*8+40,height:40,fill:'transparent'}),el('circle',{r:node.kind==='file'?11:8,fill:groups[node.group].color}),el('text',{x:16,y:5},label));
     n.addEventListener('click',()=>{if(!drag?.moved)select(node);});
     n.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();select(node);}});camera.append(n);
   }
   const xs=points.map(p=>p.x),ys=points.map(p=>p.y);bounds={x:Math.min(...xs)-65,y:Math.min(...ys)-65,w:Math.max(...xs)-Math.min(...xs)+300,h:Math.max(...ys)-Math.min(...ys)+140};
   const list=$('#map-list');list.replaceChildren();
   for(const node of visible){const b=document.createElement('button');b.type='button';b.dataset.id=node.id;b.textContent=`${node.title} · ${groups[node.group].title}`;b.addEventListener('click',()=>select(node));list.append(b);}
   if(!visible.length){const p=document.createElement('p');p.textContent='No items in this view.';list.append(p);}
   $('#map-count').textContent=`${data.nodes.length} real item${data.nodes.length===1?'':'s'}`;
   $('#map-status').textContent=`${visible.length} of ${data.nodes.length} item${data.nodes.length===1?'':'s'} shown. `+(!data.status.connected?'Notes folder disconnected. ':data.nodes.length?'':'Add a note or save a memory to begin. ')+(data.status.warning||'');
   highlight();if(resetCamera)fit();
 }
 async function refresh(){
   if(loading||closed)return;loading=true;
   try{const next=await api('/api/brain/graph');if(closed)return;
     const first=!data,changed=version!==next.status.revision;data=next;version=next.status.revision;
     const old=selected;
     if(first||changed)draw(first);
     if(old){const node=visible.find(n=>n.id===old);if(node)select(node);else{selected=null;clearInspector('The selected item changed, was removed, or is disconnected.');highlight();}}
   }catch(e){version=-1;$('#map-status').textContent=e.message;clearInspector('Could not refresh the map. Source details have been cleared.');}
   finally{loading=false;}
 }
 $('#view-map').addEventListener('click',()=>document.dispatchEvent(new CustomEvent('lin:view',{detail:'map'})));
 $('#map-manage').addEventListener('click',()=>$('#view-brain').click());
 document.addEventListener('lin:view',e=>{active=e.detail==='map';if(active)refresh();});
 document.addEventListener('lin:brain-status',e=>{if(active&&e.detail&&e.detail.revision!==version){if(selected)clearInspector('Refreshing changed source…');refresh();}});
 document.addEventListener('lin:work-state',e=>{closed=e.detail.closed;if(closed){data=null;selected=null;camera.replaceChildren();$('#map-list').replaceChildren();clearInspector('This session is closed. Reopen Lin to use the map.');$('#map-status').textContent='Session closed.';}});
 $('#map-search').addEventListener('input',()=>draw(true));$('#map-filter').addEventListener('change',()=>draw(true));
 if(matchMedia('(max-width:780px)').matches)$('.map-list-panel').open=true;
 $('#map-passage').addEventListener('change',()=>{const node=visible.find(n=>n.id===selected);if(node)showSource(node,$('#map-passage').value);});
 $('#map-fit').addEventListener('click',fit);$('#map-in').addEventListener('click',()=>zoom(1.25));$('#map-out').addEventListener('click',()=>zoom(.8));
 svg.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.12:1/1.12,point(e));},{passive:false});
 svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;const p=point(e);drag={id:e.pointerId,start:p,x:cameraState.x,y:cameraState.y,moved:false};});
 svg.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const p=point(e),dx=p.x-drag.start.x,dy=p.y-drag.start.y;if(Math.hypot(dx,dy)>5){drag.moved=true;svg.setPointerCapture(e.pointerId);}if(drag.moved){cameraState.x=drag.x+dx;cameraState.y=drag.y+dy;transform();}});
 svg.addEventListener('pointerup',()=>{setTimeout(()=>drag=null,0);});svg.addEventListener('pointercancel',()=>drag=null);
 svg.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0')fit();else if(e.key==='+'||e.key==='=')zoom(1.25);else if(e.key==='-')zoom(.8);else{cameraState.x+=e.key==='ArrowLeft'?40:e.key==='ArrowRight'?-40:0;cameraState.y+=e.key==='ArrowUp'?40:e.key==='ArrowDown'?-40:0;transform();}}});
})();
