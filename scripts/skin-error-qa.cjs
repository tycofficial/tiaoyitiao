'use strict';
// Fault injection affects only isolated test-browser objects, never the HTML file or saved user data.
const {chromium}=require('playwright');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const assets=JSON.parse(fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>const ASSETS=(\{[\s\S]*?\});<\/script>/)[1]);
const output=path.resolve(process.env.QA_OUTPUT||'/tmp/tiaoyitiao-skin-error-qa');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const results=[];
 async function run(name,init,check){const context=await browser.newContext({viewport:{width:414,height:736}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));if(init)await page.addInitScript(init);try{await page.goto(process.env.QA_URL||'http://127.0.0.1:4173/');const evidence=await check(page);assert.deepEqual(errors,[]);await page.screenshot({path:path.join(output,name+'.png')});results.push({name,passed:true,evidence});}catch(error){results.push({name,passed:false,error:String(error),errors});process.exitCode=1;}finally{await context.close();}}
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
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({productSha256,results},null,2));await browser.close();console.log(JSON.stringify(results,null,2));
})();
