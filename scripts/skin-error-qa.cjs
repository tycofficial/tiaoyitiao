'use strict';
// Fault injection affects only isolated test-browser objects, never the HTML file or saved user data.
const {chromium}=require('playwright');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const assets=JSON.parse(fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>const ASSETS=(\{[\s\S]*?\});<\/script>/)[1]);
const output=path.resolve(process.env.QA_OUTPUT||'/tmp/tiaoyitiao-skin-error-qa');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const results=[];
 async function run(name,init,check,source){const context=await browser.newContext({viewport:{width:414,height:736}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));if(init)await page.addInitScript(init);try{const url=process.env.QA_URL||'http://127.0.0.1:4173/';if(source)await page.route(url,r=>r.fulfill({body:source,contentType:'text/html'}));await page.goto(url);const evidence=await check(page);assert.deepEqual(errors,[]);await page.screenshot({path:path.join(output,name+'.png')});results.push({name,passed:true,evidence});}catch(error){results.push({name,passed:false,error:String(error),errors});process.exitCode=1;}finally{await context.close();}}
 await run('skins-menu-escape',null,async page=>{
   await page.waitForFunction(()=>window.jumpDiagnostics);await page.locator('#home-skin').click();await page.locator('#menu-button').click();
   assert.equal(await page.locator('#skins').isVisible(),false);assert.equal(await page.evaluate(()=>jumpDiagnostics.snapshot().paused),true);
   await page.keyboard.press('Escape');assert.equal(await page.locator('#menu').isVisible(),false);assert.equal(await page.locator('#home').isVisible(),true);
   return {paused:await page.evaluate(()=>jumpDiagnostics.snapshot().paused),dialogs:await page.locator('[role=dialog]:visible').count()};
 });
 const playable=async (page,unavailable=['classic','silver','gold'])=>{
   await page.waitForFunction(()=>window.jumpDiagnostics);await page.locator('#home-skin').click();await page.waitForTimeout(100);
   const statuses=await page.locator('.skin-status').allTextContents();
   for(const [i,id] of ['classic','silver','gold'].entries()){
     const failed=unavailable.includes(id);assert.equal(statuses[i].includes('预览暂不可用'),failed);
     assert.equal(await page.locator('#skin-'+id+' .skin-preview-error').isVisible(),failed);
     assert.equal(await page.locator('#'+id+'-preview').evaluate(e=>getComputedStyle(e).visibility==='hidden'),failed);
   }
   if(!unavailable.includes('classic'))assert.equal(await page.locator('#classic-preview').getAttribute('src'),assets['res/defaultBottlePoster.png'],'The historical classic poster must survive generated-preview faults');
   const diagnostic=await page.evaluate(()=>jumpDiagnostics.snapshot().skin);
   await page.screenshot({path:path.join(output,'fallback-'+Object.values(diagnostic.previewIssues)[0].replace(/[^a-z0-9-]/gi,'-')+'.png')});await page.locator('#skin-back').click();await page.locator('#start').click();
   assert.equal(await page.evaluate(()=>jumpDiagnostics.snapshot().mode),'play');return {statuses,diagnostic};
 };
 const denyPreviewWebGL=()=>{
   const get=HTMLCanvasElement.prototype.getContext;window.__previewWebGLDenied=0;
   HTMLCanvasElement.prototype.getContext=function(type,...args){if(/webgl/i.test(type)&&this.id!=='game'){window.__previewWebGLDenied++;return null;}return get.call(this,type,...args);};
   if(!localStorage.getItem('jump-classic-offline-v1'))localStorage.setItem('jump-classic-offline-v1',JSON.stringify({best:3200,records:[{score:3200,date:'2026-11-01T00:00:00.000Z'}],prefs:{skin:'silver',gameplayMode:'invincible'}}));
 };
 const baselineCommit='68625b153a7510982b8f2067e687b7c7d7fd6117',baseline=execFileSync('git',['show',baselineCommit+':index.html'],{cwd:path.join(__dirname,'..'),maxBuffer:8*1024*1024}).toString();
 await run('baseline-preview-webgl-context-error',denyPreviewWebGL,async page=>{
   await page.waitForFunction(()=>document.getElementById('load-error').textContent.includes('无法启动'));
   const result=await page.evaluate(()=>({ready:!!window.jumpDiagnostics,loading:!document.getElementById('loading').classList.contains('hidden'),denied:window.__previewWebGLDenied,mainWebGL:!!document.getElementById('game').getContext('webgl'),error:document.getElementById('load-error').textContent}));
   assert.equal(result.ready,false);assert.equal(result.loading,true);assert.equal(result.mainWebGL,true);assert.ok(result.denied>0);return result;
 },baseline);
 await run('preview-webgl-context-error',denyPreviewWebGL,async page=>{
   const evidence=await playable(page,['silver','gold']),state=()=>page.evaluate(()=>jumpDiagnostics.snapshot());
   assert.equal((await state()).skin.selected,'silver');assert.ok((await state()).skin.maps.every(src=>src?.startsWith('reconstructed/silver/')));assert.ok(await page.evaluate(()=>window.__previewWebGLDenied>0));
   await page.locator('#home-button').click();await page.locator('#home-skin').click();await page.locator('#skin-gold').click();assert.ok((await state()).skin.maps.every(src=>src?.startsWith('reconstructed/gold/')));
   await page.locator('#skin-classic').click();assert.ok((await state()).skin.maps.every(src=>src?.startsWith('res/')));await page.locator('#skin-gold').click();await page.locator('#skin-back').click();
   await page.reload();await page.waitForFunction(()=>window.jumpDiagnostics);assert.equal((await state()).skin.selected,'gold');await page.locator('#start').click();await page.locator('#game').focus();await page.keyboard.down('Space');await page.waitForTimeout(60);await page.keyboard.up('Space');
   await page.waitForFunction(()=>{const s=jumpDiagnostics.snapshot();return s.mode==='play'&&!s.flight&&s.status==='stop';});const after=await state();assert.equal(after.score,0);assert.equal(after.best,3200);assert.equal(after.invincible,true);assert.equal(after.skin.selected,'gold');
   const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('jump-classic-offline-v1')));assert.equal(saved.best,3200);assert.equal(saved.records[0].score,3200);assert.equal(saved.prefs.skin,'gold');return {...evidence,after:{mode:after.mode,status:after.status,score:after.score,best:after.best,skin:after.skin},saved};
 });
 await run('main-webgl-context-error',()=>{
   const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(/webgl/i.test(type)&&this.id==='game')return null;return get.call(this,type,...args);};
 },async page=>{await page.waitForFunction(()=>document.getElementById('load-error').textContent.includes('无法启动'));assert.equal(await page.evaluate(()=>!!window.jumpDiagnostics),false);return page.locator('#load-error').innerText();});
 await run('preview-decode-error',()=>{
   const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
   Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){
     if(this.onload&&String(this.onload).includes('images.set(key,image)')&&value.startsWith('data:image/png'))return descriptor.set.call(this,'data:image/png;base64,AAAA');
     return descriptor.set.call(this,value);
   }});
 },page=>playable(page,['silver','gold']));
 await run('preview-encode-error',()=>{
   const encode=HTMLCanvasElement.prototype.toDataURL;
   HTMLCanvasElement.prototype.toDataURL=function(...args){if(this.width===256&&this.height===512)throw new DOMException('QA encoding failure','EncodingError');return encode.apply(this,args);};
 },page=>playable(page,['silver','gold']));
 await run('preview-display-error',()=>{
   const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
   Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){
     return descriptor.set.call(this,this.id.endsWith('-preview')?'data:image/png;base64,AAAA':value);
   }});
 },playable);
 await run('embedded-image-decode-error',()=>{
   const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');let injected=false;
   Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){
     if(!injected&&this.onload&&this.onerror&&value.startsWith('data:image/png')){injected=true;return descriptor.set.call(this,'data:image/png;base64,AAAA');}
     return descriptor.set.call(this,value);
   }});
 },async page=>{await page.waitForFunction(()=>document.getElementById('load-error').textContent.includes('无法启动'));return page.locator('#load-error').innerText();});
 const productSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..','index.html'))).digest('hex');
 const scriptSha256=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({productSha256,scriptSha256,baselineCommit,results},null,2));await browser.close();console.log(JSON.stringify(results.map(({name,passed,error})=>({name,passed,error})),null,2));
})();
