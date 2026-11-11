'use strict';
// Observation only: never rewrites event timestamps, charge duration or game state.
const crypto=require('node:crypto'),fs=require('node:fs');
const now=()=>({wallMs:Date.now(),monotonicMs:performance.now()});
const bounded=async fn=>{let timer;try{return await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Telemetry read exceeded 3000 ms')),3000);})]);}catch(error){return {error:String(error)};}finally{clearTimeout(timer);}};
async function attach(page,label){
 const inputs=[],navigations=[],pageEvents=[],errors=[],consoleIssues=[];let sequence=0,cdp;
 await page.addInitScript(()=>{
  const data=window.__qaTiming={active:null,events:[],longTasks:[],rafGaps:[],marks:[],longTaskSupported:false};
  const stamp=()=>({wallMs:Date.now(),pageMs:performance.now()});
  const mark=name=>data.marks.push({name,...stamp(),visibility:document.visibilityState});
  for(const type of ['keydown','keyup','pointerdown','pointerup'])window.addEventListener(type,event=>{if(data.active===null||('code'in event&&event.code!=='Space'))return;data.events.push({id:data.active,phase:'capture',type,eventMs:event.timeStamp,trusted:event.isTrusted,pointerType:event.pointerType||null,pointerId:event.pointerId??null,repeat:event.repeat||false,...stamp()});},true);
  for(const type of ['DOMContentLoaded','load','visibilitychange','pagehide'])window.addEventListener(type,()=>mark(type),true);
  try{const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())if(data.longTasks.length<150)data.longTasks.push({startMs:entry.startTime,durationMs:entry.duration,name:entry.name});});observer.observe({type:'longtask',buffered:true});data.longTaskSupported=true;}catch{}
  let previous;function frame(t){if(previous!==undefined&&t-previous>50&&data.rafGaps.length<150)data.rafGaps.push({startMs:previous,durationMs:t-previous});previous=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);
  mark('init');
 });
 page.on('pageerror',error=>errors.push({at:now(),error:String(error)}));
 page.on('console',message=>{if(['warning','error'].includes(message.type())&&consoleIssues.length<50)consoleIssues.push({at:now(),type:message.type(),text:message.text().slice(0,500)});});
 page.on('request',request=>{if(request.isNavigationRequest())pageEvents.push({name:'request',at:now(),url:request.url()});});
 page.on('response',response=>{if(response.request().isNavigationRequest())pageEvents.push({name:'response',at:now(),url:response.url(),status:response.status()});});
 page.on('requestfinished',request=>{if(request.isNavigationRequest())pageEvents.push({name:'requestfinished',at:now(),url:request.url(),timing:request.timing()});});
 page.on('requestfailed',request=>{if(request.isNavigationRequest())pageEvents.push({name:'requestfailed',at:now(),url:request.url(),failure:request.failure()});});
 for(const name of ['domcontentloaded','load','crash'])page.on(name,()=>pageEvents.push({name,at:now()}));
 try{cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');}catch{}
 async function arm(){await page.evaluate(()=>{
  const data=window.__qaTiming;if(data.armed)return;data.armed=true;
  for(const type of ['keydown','keyup','pointerdown','pointerup'])window.addEventListener(type,event=>{
   if(data.active===null||('code'in event&&event.code!=='Space'))return;
   const entry={id:data.active,phase:'after-handler',type,wallMs:Date.now(),pageMs:performance.now()};
   if(type==='keyup'||type==='pointerup'){const state=window.jumpDiagnostics?.snapshot();entry.consumedHoldMs=state?.flight?.hold*1000;entry.hit=state?.flight?.hit;entry.mode=state?.mode;entry.status=state?.status;}
   data.events.push(entry);
  });
 });}
 async function goto(url){const navigation={url,start:now()};navigations.push(navigation);try{const response=await page.goto(url,{waitUntil:'load',timeout:30000});navigation.status=response?.status();return response;}catch(error){navigation.error=String(error);throw error;}finally{navigation.end=now();}}
 async function ready(){const start=now();await page.waitForFunction(()=>window.jumpDiagnostics);await arm();pageEvents.push({name:'diagnostics-ready',start,end:now()});}
 async function press(seconds,{pointer=false,touch=false,x=200,y=560}={}){
  const id=++sequence,record={id,requestedHoldMs:seconds*1000,pointer,touch,start:now(),steps:[]};inputs.push(record);
  if(pointer)await page.mouse.move(x,y);
  await page.evaluate(id=>{window.__qaTiming.active=id;},id);
  async function step(name,fn){const row={name,start:now()};record.steps.push(row);try{return await fn();}finally{row.end=now();row.elapsedMs=row.end.monotonicMs-row.start.monotonicMs;}}
  await step('down',()=>touch?cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]}):pointer?page.mouse.down():page.keyboard.down('Space'));
  await step('waitForTimeout',()=>page.waitForTimeout(seconds*1000));
  await step('up',()=>touch?cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}):pointer?page.mouse.up():page.keyboard.up('Space'));
  const result=await page.evaluate(id=>{const data=window.__qaTiming,state=jumpDiagnostics.snapshot();data.active=null;return {snapshot:state,events:data.events.filter(e=>e.id===id),longTasks:data.longTasks,rafGaps:data.rafGaps,timeOrigin:performance.timeOrigin,read:{wallMs:Date.now(),pageMs:performance.now()}};},id);
  record.end=now();record.events=result.events;record.timeOrigin=result.timeOrigin;record.read=result.read;record.after={mode:result.snapshot.mode,status:result.snapshot.status,score:result.snapshot.score,jumps:result.snapshot.jumps,flight:result.snapshot.flight};
  const down=result.events.find(e=>e.phase==='capture'&&(e.type==='keydown'||e.type==='pointerdown')),up=result.events.find(e=>e.phase==='capture'&&(e.type==='keyup'||e.type==='pointerup')),consumed=result.events.find(e=>e.phase==='after-handler'&&(e.type==='keyup'||e.type==='pointerup'));
  record.consumedHoldMs=consumed?.consumedHoldMs;
  if(down&&up){record.captureIntervalMs=up.pageMs-down.pageMs;record.eventTimestampIntervalMs=up.eventMs-down.eventMs;record.longTasks=result.longTasks.filter(t=>t.startMs+t.durationMs>=down.pageMs&&t.startMs<=up.pageMs);record.rafGaps=result.rafGaps.filter(t=>t.startMs+t.durationMs>=down.pageMs&&t.startMs<=up.pageMs);}
  return {snapshot:result.snapshot,record};
 }
 async function collect(){
  const runtime=page.isClosed()?{closed:true}:await bounded(()=>page.evaluate(()=>({timeOrigin:performance.timeOrigin,now:performance.now(),navigation:performance.getEntriesByType('navigation').map(e=>e.toJSON()),visibility:document.visibilityState,timing:window.__qaTiming})));
  const metrics=!cdp||page.isClosed()?null:await bounded(async()=>{const result=await cdp.send('Performance.getMetrics');return Object.fromEntries(result.metrics.filter(m=>['TaskDuration','ScriptDuration','LayoutDuration','JSHeapUsedSize','Nodes','Documents','Frames'].includes(m.name)).map(m=>[m.name,m.value]));});
  return {label,inputs,navigations,pageEvents,errors,consoleIssues,runtime,metrics};
 }
 return {label,inputs,goto,ready,arm,press,collect};
}
async function processInfo(browser){return bounded(async()=>{const session=await browser.newBrowserCDPSession();try{return await session.send('SystemInfo.getProcessInfo');}finally{await session.detach();}});}
module.exports={attach,processInfo,helperSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')};
