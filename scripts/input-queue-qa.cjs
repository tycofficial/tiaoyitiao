'use strict';
// Native browser events only. A real JS busy loop delays dispatch; timestamps are never supplied or overwritten.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {attach,helperSha256}=require('./qa-telemetry.cjs');
const root=path.join(__dirname,'..'),output=path.resolve(process.env.QA_OUTPUT||'/tmp/tiaoyitiao-input-queue'),url=process.env.QA_URL||'http://127.0.0.1:4173/',baselineCommit='622d96d9b9699d7f39add8020dde3fd4ee750400';fs.mkdirSync(output,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),current=fs.readFileSync(path.join(root,'index.html'),'utf8'),scriptSha256=sha(fs.readFileSync(__filename));
const near=(a,b,label,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,label+': '+a+' vs '+b);
async function settled(page){await page.waitForFunction(()=>{const s=jumpDiagnostics.snapshot();return s.mode==='play'&&!s.flight&&s.status==='stop';},{},{timeout:15000});}
async function reset(page){await page.locator('#menu-button').click();await page.locator('#restart-button').click();await settled(page);await page.locator('#game').focus();}
async function input(page,cdp,type,{blockMs=0,holdMs=50,repeat=false,id}={}){
 await page.evaluate(id=>{window.__qaTiming.active=id;window.__qaTiming.testBlocks=[];},id);if(type==='mouse')await page.mouse.move(200,560);
 const down=()=>type==='mouse'?page.mouse.down():type==='keyboard'?page.keyboard.down('Space'):cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y:560}]});
 const up=()=>type==='mouse'?page.mouse.up():type==='keyboard'?page.keyboard.up('Space'):cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const start=performance.now();await down();const downAck=performance.now();
 const blocker=blockMs?page.evaluate(ms=>{const start=performance.now();while(performance.now()-start<ms){}window.__qaTiming.testBlocks.push({startMs:start,endMs:performance.now()});},blockMs):Promise.resolve();
 if(repeat)await page.keyboard.down('Space');
 await new Promise(resolve=>setTimeout(resolve,holdMs));const releaseRequest=performance.now();await up();const releaseAck=performance.now();await blocker;
 const result=await page.evaluate(id=>{const t=window.__qaTiming,s=jumpDiagnostics.snapshot();t.active=null;return {events:t.events.filter(e=>e.id===id),blocks:t.testBlocks,longTasks:t.longTasks,flight:s.flight,mode:s.mode};},id);
 const a=result.events.find(e=>e.phase==='capture'&&['pointerdown','keydown'].includes(e.type)),b=result.events.find(e=>e.phase==='capture'&&['pointerup','keyup'].includes(e.type));assert.ok(a&&b);assert.equal(a.trusted,true);assert.equal(b.trusted,true);assert.ok(result.flight);
 return {...result,type,requestedHoldMs:holdMs,requestedBlockMs:blockMs,node:{start,downAck,releaseRequest,releaseAck},eventHoldMs:b.eventMs-a.eventMs,captureHoldMs:b.pageMs-a.pageMs,releaseQueueMs:b.pageMs-b.eventMs,consumedHoldMs:result.flight.hold*1000};
}
function verifyPhysics(row){const hold=row.eventHoldMs/1000,frames=Math.min(99,hold*60),y=2.75-.033875*frames,vy=+Math.min(135+hold*15,180).toFixed(2),vz=+Math.min(hold*70,150).toFixed(2),roundedY=+y.toFixed(2),a=+((-vy+Math.sqrt(Math.max(0,vy*vy-1440*(2.75-roundedY))))/-720).toFixed(2),time=+(vy/360-a).toFixed(2);near(row.flight.start[1],y,'Release pose uses actual held time');near(row.flight.vy,vy,'Unchanged velocity mapping');near(row.flight.end[0]-row.flight.start[0],+(vz*time).toFixed(2),'Unchanged rounded range');}
async function boundaries(page,cdp){
 const checks=[];await reset(page);const repeated=await input(page,cdp,'keyboard',{holdMs:100,repeat:true,id:1000});assert.ok(repeated.events.some(e=>e.phase==='capture'&&e.repeat));near(repeated.consumedHoldMs,repeated.eventHoldMs,'Repeat must not reset the original start',.001);verifyPhysics(repeated);await settled(page);checks.push('A real repeated Space keydown does not reset the charge.');
 await reset(page);await page.keyboard.down('Space');await page.keyboard.press('Escape');await page.keyboard.up('Space');let state=await page.evaluate(()=>jumpDiagnostics.snapshot());assert.equal(state.paused,true);assert.equal(state.flight,null);assert.equal(state.status,'stop');await page.locator('#resume-button').click();checks.push('Escape cancels a held Space; late keyup cannot launch after pausing.');
 await reset(page);await page.mouse.move(200,560);await page.mouse.down();await page.keyboard.press('Escape');await page.locator('#restart-button').focus();await page.keyboard.press('Enter');await page.mouse.up();await page.mouse.up();state=await page.evaluate(()=>jumpDiagnostics.snapshot());assert.equal(state.flight,null);assert.equal(state.jumps,0);assert.equal(state.score,0);checks.push('Keyboard restart while the mouse is held rejects its late and duplicate releases.');
 await reset(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y:560}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});state=await page.evaluate(()=>jumpDiagnostics.snapshot());assert.equal(state.status,'stop');assert.equal(state.flight,null);checks.push('A native touch cancellation clears the preparation without jumping.');
 await reset(page);await page.evaluate(()=>{window.__qaTiming.active=1001;const game=document.getElementById('game');game.addEventListener('gotpointercapture',e=>window.__qaGotCapture={trusted:e.isTrusted,eventMs:e.timeStamp,id:e.pointerId},{once:true});game.addEventListener('lostpointercapture',e=>window.__qaLostCapture={trusted:e.isTrusted,eventMs:e.timeStamp},{once:true});});await page.mouse.move(200,560);await page.mouse.down();await page.mouse.move(201,560);assert.equal(await page.evaluate(()=>window.__qaGotCapture.trusted),true);await page.evaluate(()=>document.getElementById('game').releasePointerCapture(window.__qaGotCapture.id));await page.mouse.move(202,560);await page.waitForFunction(()=>jumpDiagnostics.snapshot().status==='stop');assert.equal(await page.evaluate(()=>window.__qaLostCapture.trusted),true);await page.mouse.up();state=await page.evaluate(()=>jumpDiagnostics.snapshot());assert.equal(state.flight,null);checks.push('The browser lost-capture event cancels the clock and rejects the following release.');
 await reset(page);await page.keyboard.press('Escape');await page.locator('#resume-button').focus();await page.evaluate(()=>{window.__qaResume={};document.getElementById('resume-button').addEventListener('click',()=>window.__qaResume.resumedAt=performance.now(),{once:true});window.addEventListener('keydown',e=>{if(e.code==='Space'){const s=jumpDiagnostics.snapshot();window.__qaResume.space={eventMs:e.timeStamp,handledMs:performance.now(),trusted:e.isTrusted,paused:s.paused,status:s.status};}});});const blocker=page.evaluate(()=>{const start=performance.now();while(performance.now()-start<200){}});await new Promise(r=>setTimeout(r,20));const enter=page.keyboard.down('Enter');await new Promise(r=>setTimeout(r,30));const space=page.keyboard.down('Space');await Promise.all([blocker,enter,space]);await page.keyboard.up('Enter');await page.keyboard.up('Space');state=await page.evaluate(()=>jumpDiagnostics.snapshot());assert.equal(state.paused,false);assert.equal(state.status,'stop');assert.equal(state.flight,null);const resume=await page.evaluate(()=>window.__qaResume);assert.equal(resume.space.trusted,true);assert.equal(resume.space.paused,false);assert.equal(resume.space.status,'stop');assert.ok(resume.space.eventMs<resume.resumedAt&&resume.space.handledMs>=resume.resumedAt);checks.push('A native Space event queued before resume is consumed after resume without starting a stale charge.');
 return {checks,repeated,resume,capture:await page.evaluate(()=>({got:window.__qaGotCapture,lost:window.__qaLostCapture}))};
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),results=[],boundaryResults=[];let id=0;
 try{
 const baseline=execFileSync('git',['show',baselineCommit+':index.html'],{cwd:root,maxBuffer:8*1024*1024}).toString();
 for(const [version,source]of process.env.QA_BASELINE_ONLY==='1'?[['baseline',baseline]]:[['baseline',baseline],['current',current]]){
  const context=await browser.newContext({viewport:{width:414,height:736},hasTouch:true,isMobile:true}),page=await context.newPage(),probe=await attach(page,version),cdp=await context.newCDPSession(page);await page.route(url,r=>r.fulfill({body:source,contentType:'text/html'}));await probe.goto(url);await probe.ready();await page.locator('#start').click();await settled(page);
  for(const type of ['mouse','keyboard','touch'])for(const blockMs of [0,200]){
   let queued=blockMs===0;
   for(let attempt=1;attempt<=(blockMs?2:1);attempt++){
    await reset(page);const row=await input(page,cdp,type,{blockMs,id:++id});row.version=version;row.attempt=attempt;row.queueObserved=blockMs>0&&row.releaseQueueMs>100;results.push(row);
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:false,incomplete:true,productSha256:sha(current),baselineCommit,scriptSha256,helperSha256,results,boundaryResults},null,2));
    if(blockMs)assert.ok(row.blocks.length===1&&row.blocks[0].endMs-row.blocks[0].startMs>=200);
    if(version==='current'){near(row.consumedHoldMs,row.eventHoldMs,'Actual event interval is used',.001);verifyPhysics(row);}else if(row.queueObserved)assert.ok(row.consumedHoldMs-row.eventHoldMs>100,'Must reproduce the inflated baseline charge');
    console.log(JSON.stringify({version,type,blockMs,attempt,queueObserved:row.queueObserved,eventMs:row.eventHoldMs,consumedMs:row.consumedHoldMs,releaseQueueMs:row.releaseQueueMs,range:row.flight.end[0]-row.flight.start[0]}));await settled(page);
    if(!blockMs||row.queueObserved){queued=true;break;}
    row.note='The host/native release occurred too late to demonstrate queued dispatch; retain this real hold and try this setup once more.';
   }
   assert.ok(queued,'Could not produce the required native release queue within two attempts; do not claim this coverage');
  }
  if(version==='current'){await reset(page);const row=await input(page,cdp,'keyboard',{holdMs:2200,id:++id});row.version=version;near(row.consumedHoldMs,row.eventHoldMs,'Genuine long input is not capped to its request',.001);verifyPhysics(row);results.push(row);await settled(page);boundaryResults.push(await boundaries(page,cdp));}
  const telemetry=await probe.collect();assert.deepEqual(telemetry.errors,[]);await context.close();
 }
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,productSha256:sha(current),baselineCommit,scriptSha256,helperSha256,method:'Real CDP/Playwright mouse, keyboard and touch. An actual 200 ms main-thread task runs concurrently with a host release timer; no timestamp argument or property override is used.',results,boundaryResults},null,2));
 }finally{await browser.close();}
})();
