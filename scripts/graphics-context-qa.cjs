'use strict';
// WEBGL_lose_context invokes real browser context events; no event dispatch/injection.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),output=path.resolve(process.env.QA_OUTPUT||'/tmp/tiaoyitiao-graphics-qa'),url=process.env.QA_URL||'http://127.0.0.1:4173/';fs.mkdirSync(output,{recursive:true});
const baselineCommit='1a7f1fb8f45dfbca4f0e0008d5e6b4e7ab90ff37',baseline=execFileSync('git',['show',baselineCommit+':index.html'],{cwd:root,maxBuffer:8*1024*1024}).toString(),current=fs.readFileSync(path.join(root,'index.html'),'utf8'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const progress=s=>({mode:s.mode,time:s.time,score:s.score,best:s.best,jumps:s.jumps,status:s.status,flight:s.flight,bottle:s.bottle,current:s.current,next:s.next,skin:s.skin.selected});
const results={passed:false,baselineCommit,baselineSha256:sha(baseline),productSha256:sha(current),scriptSha256:sha(fs.readFileSync(__filename)),method:'Real Chromium WEBGL_lose_context loseContext/restoreContext and browser-generated trusted events. Actual keyboard/mouse actions; no dispatchEvent or timestamp overrides.',cases:[]};
const save=()=>fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
async function state(page){return page.evaluate(()=>{const s=jumpDiagnostics.snapshot(),gl=document.getElementById('game').getContext('webgl'),notice=document.getElementById('graphics-status');return {...s,rawContextLost:gl.isContextLost(),notice:{visible:!!notice?.getClientRects().length,role:notice?.getAttribute('role'),text:notice?.textContent},oldHintVisible:!!document.getElementById('hint').getClientRects().length,menuVisible:!!document.getElementById('menu').getClientRects().length};});}
async function lose(page){
 const supported=await page.evaluate(()=>{const c=document.getElementById('game'),gl=c.getContext('webgl');window.__graphicsEvents=[];for(const type of ['webglcontextlost','webglcontextrestored'])c.addEventListener(type,e=>__graphicsEvents.push({type:e.type,trusted:e.isTrusted,timestamp:e.timeStamp,consumed:performance.now()}),{once:true});window.__graphicsExtension=gl.getExtension('WEBGL_lose_context');if(!__graphicsExtension)return false;__graphicsExtension.loseContext();return true;});
 assert.equal(supported,true,'WEBGL_lose_context must be available for this actual-browser test');await page.waitForFunction(()=>__graphicsEvents.some(e=>e.type==='webglcontextlost'));assert.equal((await state(page)).rawContextLost,true);return state(page);
}
async function restore(page,version){
 await page.evaluate(()=>__graphicsExtension.restoreContext());await page.waitForFunction(()=>__graphicsEvents.some(e=>e.type==='webglcontextrestored'));
 if(version==='current')await page.waitForFunction(()=>!document.getElementById('graphics-status').getClientRects().length);
 const s=await state(page);assert.equal(s.rawContextLost,false);return s;
}
async function rendered(page){return page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>{
 const gl=document.getElementById('game').getContext('webgl'),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let opaque=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])opaque++;resolve({width:w,height:h,nontransparent:opaque,error:gl.getError(),lost:gl.isContextLost()});
})));}
async function charge(page,ms){await page.locator('#game').focus();await page.keyboard.down('Space');await page.waitForTimeout(ms);await page.keyboard.up('Space');}
async function settled(page){await page.waitForFunction(()=>{const s=jumpDiagnostics.snapshot();return s.mode==='play'&&!s.flight&&s.status==='stop';});}
async function earn(page){await charge(page,719);await settled(page);const s=await state(page);assert.equal(s.jumps,1);assert.ok(s.score>0);return s;}
async function rejectInput(page,lost){
 // A real pointer attempt must hit the waiting overlay, never click invisible controls.
 const attempted=[];for(const id of ['resume-button','restart-button','home-button']){const box=await page.locator('#'+id).boundingBox();assert.ok(box);const point={x:box.x+box.width/2,y:box.y+box.height/2};assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.closest('#graphics-status')?.id,point),'graphics-status');await page.mouse.click(point.x,point.y);attempted.push({id,...point});}
 await page.locator('#resume-button').focus();await page.keyboard.press('Space');await page.keyboard.press('Enter');await page.keyboard.press('Escape');await page.locator('#game').focus();await charge(page,100);await page.mouse.click(25,700);await page.waitForTimeout(180);
 const after=await state(page);assert.equal(after.rawContextLost,true);assert.equal(after.paused,true);assert.equal(after.menuVisible,true);assert.deepEqual(progress(after),progress(lost));assert.equal(after.notice.visible,true);assert.equal(after.notice.role,'status');assert.match(after.notice.text,/画面.*暂停/);const accessibility=await page.locator('#graphics-status').ariaSnapshot();assert.match(accessibility,/status/);return {after,accessibility,attempted};
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  for(const name of ['baseline-hidden-play','flight-and-earned-progress','home-already-paused','invincible-recovery','ordinary-failure']){
   const version=name.startsWith('baseline')?'baseline':'current',context=await browser.newContext({viewport:{width:414,height:736},...(version==='current'&&process.env.QA_SKIP_VIDEO!=='1'?{recordVideo:{dir:output,size:{width:414,height:736}}}:{})}),page=await context.newPage(),row={name,version,passed:false,errors:[]};results.cases.push(row);page.on('pageerror',e=>row.errors.push(String(e)));
   try{
    await page.addInitScript(()=>localStorage.setItem('jump-classic-offline-v1',JSON.stringify({best:3200,records:[{score:3200,date:'2026-11-01T00:00:00.000Z'}],prefs:{skin:'silver',gameplayMode:'invincible'}})));
    await page.route(url,r=>r.fulfill({body:version==='baseline'?baseline:current,contentType:'text/html'}));await page.goto(url);await page.waitForFunction(()=>window.jumpDiagnostics);
    if(name==='home-already-paused')await page.locator('#menu-button').click();else{
     if(name==='ordinary-failure'){await page.locator('#menu-button').click();await page.locator('#invincible-button').click();await page.locator('#resume-button').click();}
     await page.locator('#start').click();await settled(page);
     if(['flight-and-earned-progress','ordinary-failure'].includes(name))row.earned=await earn(page);
     if(name==='flight-and-earned-progress'){await charge(page,50);assert.ok((await state(page)).flight);}
     if(['ordinary-failure','invincible-recovery'].includes(name)){await charge(page,2200);await page.waitForFunction(status=>{const s=jumpDiagnostics.snapshot();return status==='falling'?s.mode==='falling':s.status==='recover';},name==='ordinary-failure'?'falling':'recover');}
    }
    row.before=await state(page);row.lost=await lose(page);assert.equal(row.lost.paused,true);
    if(version==='baseline'){
     await page.locator('#resume-button').click();await charge(page,250);row.afterInput=await state(page);assert.equal(row.afterInput.paused,false);assert.ok(row.afterInput.time>row.lost.time);assert.ok(row.afterInput.flight);assert.equal(row.afterInput.oldHintVisible,false);await page.screenshot({path:path.join(output,name+'.png')});row.restored=await restore(page,version);
    }else{
     row.rejected=await rejectInput(page,row.lost);await page.screenshot({path:path.join(output,name+'-lost.png')});row.restored=await restore(page,version);assert.equal(row.restored.paused,true);assert.deepEqual(progress(row.restored),progress(row.lost));await page.waitForTimeout(160);assert.deepEqual(progress(await state(page)),progress(row.lost));
     await page.locator('#resume-button').click();
     if(name==='ordinary-failure'){await page.waitForFunction(()=>jumpDiagnostics.snapshot().mode==='over');const s=await state(page);assert.equal(s.score,row.earned.score);assert.equal(s.best,3200);assert.equal(s.invincible,false);}
     else if(name==='home-already-paused'){await page.waitForFunction(time=>jumpDiagnostics.snapshot().time>time,row.lost.time);assert.equal((await state(page)).mode,'home');}
     else{await settled(page);const s=await state(page);assert.equal(s.score,row.earned?.score||0);assert.equal(s.best,3200);assert.equal(s.skin.selected,'silver');}
     row.rendered=await rendered(page);assert.equal(row.rendered.lost,false);assert.equal(row.rendered.error,0);assert.ok(row.rendered.nontransparent>64,'A restored scene must contain real nontransparent GL pixels');row.after=await state(page);row.saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('jump-classic-offline-v1')));assert.equal(row.saved.best,3200);assert.equal(row.saved.records[0].score,3200);assert.equal(row.saved.prefs.skin,'silver');if(name==='ordinary-failure')assert.ok(row.saved.records.some(r=>r.score===row.earned.score));await page.screenshot({path:path.join(output,name+'-restored.png')});
    }
    row.events=await page.evaluate(()=>__graphicsEvents);assert.deepEqual(row.events.map(e=>[e.type,e.trusted]),[['webglcontextlost',true],['webglcontextrestored',true]]);assert.deepEqual(row.errors,[]);row.passed=true;save();console.log('PASS '+name);
   }catch(error){row.failure=String(error);save();throw error;}finally{await context.close();}
  }
  results.passed=true;save();console.log(JSON.stringify({passed:true,cases:results.cases.map(r=>r.name),output},null,2));
 }finally{await browser.close();}
})();
